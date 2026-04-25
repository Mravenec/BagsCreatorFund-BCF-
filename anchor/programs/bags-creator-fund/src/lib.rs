//! BagsCreatorFund v0.2 — Multi-Token On-Chain Creator Funding
//!
//! STACK OVERFLOW FIX (zero_copy):
//!   CampaignAccount is ~4920 bytes — far exceeds the 4096 byte BPF stack limit.
//!   Solution: #[account(zero_copy)] + AccountLoader<'info, CampaignAccount>
//!   This maps account data DIRECTLY from the account's memory region (heap),
//!   never copies it to the stack frame. Stack warnings disappear completely.
//!
//! BORROW-CHECKER PATTERN:
//!   With AccountLoader, use load() / load_mut() / load_init().
//!   Snapshots are still needed before CPI calls and lamport operations.

use anchor_lang::prelude::*;
use anchor_lang::system_program;

declare_id!("D9KdRFUG4mZ3gqgDSF8mdfDpJk7qKHsmDn8g3dRsvfBV");

// ─── Constants ────────────────────────────────────────────────────────────────
const POSITIONS:    usize = 100;
const TREASURY_BPS: u64   = 200;        // 2%
const MIN_PRIZE:    u64   = 1_000_000;  // 0.001 SOL
const MIN_PRICE:    u64   = 1_000;      // 0.000001 SOL
const MAX_DURATION: i64   = 30 * 86_400;

const FEE_NAME_CAP: usize = 60;
const NAME_CAP:     usize = 80;
const SYMBOL_CAP:   usize = 12;
const TITLE_CAP:    usize = 120;
const DESC_CAP:     usize = 600;

fn copy_str(src: &str, dst: &mut [u8]) {
    let b = src.as_bytes();
    let n = b.len().min(dst.len());
    dst[..n].copy_from_slice(&b[..n]);
}

// ─── Events ───────────────────────────────────────────────────────────────────
#[event] pub struct ProjectCreated    { pub creator: Pubkey, pub project_index: u64, pub token_mint: Pubkey, pub timestamp: i64 }
#[event] pub struct CampaignCreated   { pub campaign: Pubkey, pub creator: Pubkey, pub project_index: u64, pub campaign_index: u64, pub prize_lamports: u64, pub position_price_lamports: u64 }
#[event] pub struct CampaignActivated { pub campaign: Pubkey, pub deadline: i64 }
#[event] pub struct PositionPurchased { pub campaign: Pubkey, pub position_index: u8, pub buyer: Pubkey, pub price_lamports: u64, pub tokens_received: u64 }
#[event] pub struct CampaignResolved  { pub campaign: Pubkey, pub winning_position: u8, pub has_winner: bool, pub winner: Pubkey, pub total_pot: u64, pub winning_slot: u64 }
#[event] pub struct TreasuryWithdrawal{ pub project: Pubkey, pub creator: Pubkey, pub project_index: u64, pub amount_lamports: u64, pub remaining: u64 }

// ─── Data types ───────────────────────────────────────────────────────────────

/// One position slot (00–99)
#[derive(Clone, Copy)]
#[repr(C)]
pub struct PositionInfo {
    pub filled: u8,
    pub _pad:   [u8; 7],
    pub owner:  Pubkey,
} // 40 bytes, 8-byte aligned

// Safety: PositionInfo is #[repr(C)], all fields are plain data,
// all-zeros is a valid bit pattern (filled=0, pad=0, owner=default pubkey).
unsafe impl bytemuck::Zeroable for PositionInfo {}
unsafe impl bytemuck::Pod for PositionInfo {}

impl Default for PositionInfo {
    fn default() -> Self { Self { filled: 0, _pad: [0; 7], owner: Pubkey::default() } }
}

// ─── Accounts ─────────────────────────────────────────────────────────────────

/// PDA ["registry", creator]
#[account]
pub struct CreatorRegistry {
    pub creator:       Pubkey,  // 32
    pub project_count: u64,     // 8
} // disc 8 + 40 = 48

/// PDA ["project", creator, project_index_le]
#[account]
pub struct ProjectAccount {
    pub creator:           Pubkey,
    pub project_index:     u64,
    pub token_mint:        Pubkey,
    pub fee_mode_name:     [u8; FEE_NAME_CAP],
    pub project_name:      [u8; NAME_CAP],
    pub token_symbol:      [u8; SYMBOL_CAP],
    pub campaign_count:    u64,
    pub treasury_lamports: u64,
} // disc 8 + 240 = 248

/// PDA ["campaign", creator, campaign_index_le]
/// zero_copy(unsafe) → memory-mapped directly, never copied to stack.
/// Bypasses bytemuck's const-generic array check (incompatible with Rust 1.75 BPF toolchain).
/// Safety: struct is #[repr(C)] with explicit padding, all fields are plain data,
/// all-zeros is a valid bit pattern for every field.
#[account(zero_copy(unsafe))]
#[repr(C)]
pub struct CampaignAccount {
    pub creator:                 Pubkey,          // 32
    pub project_index:           u64,             // 8
    pub campaign_index:          u64,             // 8
    pub token_mint:              Pubkey,          // 32
    pub prize_lamports:          u64,             // 8
    pub position_price_lamports: u64,             // 8
    pub tokens_per_position:     u64,             // 8
    pub duration_seconds:        i64,             // 8
    pub deadline:                i64,             // 8
    pub created_at:              i64,             // 8
    pub status:                  u8,              // 1
    pub winning_position:        u8,              // 1  (255=unresolved)
    pub _pad:                    [u8; 6],         // 6  (alignment)
    pub winning_slot:            u64,             // 8
    pub winner:                  Pubkey,          // 32
    pub total_collected:         u64,             // 8
    pub treasury_contribution:   u64,             // 8
    pub title:                   [u8; TITLE_CAP], // 120
    pub description:             [u8; DESC_CAP],  // 600
    pub positions:               [PositionInfo; POSITIONS], // 4000
}
// Total: 32+8+8+32+8+8+8+8+8+8+1+1+6+8+32+8+8+120+600+4000 = 4918

// ─── Program ──────────────────────────────────────────────────────────────────
#[program]
pub mod bags_creator_fund {
    use super::*;

    pub fn initialize_project(
        ctx: Context<InitializeProject>,
        token_mint: Pubkey,
        fee_mode_name: String,
        name: String,
        symbol: String,
    ) -> Result<()> {
        let creator_key = ctx.accounts.creator.key();
        let timestamp   = Clock::get()?.unix_timestamp;

        let registry = &mut ctx.accounts.registry;
        if registry.creator == Pubkey::default() {
            registry.creator       = creator_key;
            registry.project_count = 0;
        }
        let project_index = registry.project_count;
        registry.project_count = project_index + 1;

        let project = &mut ctx.accounts.project;
        project.creator           = creator_key;
        project.project_index     = project_index;
        project.token_mint        = token_mint;
        project.campaign_count    = 0;
        project.treasury_lamports = 0;
        copy_str(&fee_mode_name, &mut project.fee_mode_name);
        copy_str(&name,          &mut project.project_name);
        copy_str(&symbol,        &mut project.token_symbol);

        emit!(ProjectCreated { creator: creator_key, project_index, token_mint, timestamp });
        Ok(())
    }

    pub fn create_campaign(
        ctx: Context<CreateCampaign>,
        project_index:           u64,
        prize_lamports:          u64,
        position_price_lamports: u64,
        tokens_per_position:     u64,
        duration_seconds:        i64,
        title:                   String,
        description:             String,
    ) -> Result<()> {
        require!(prize_lamports          >= MIN_PRIZE,    BCFError::PrizeTooSmall);
        require!(position_price_lamports >= MIN_PRICE,    BCFError::PriceTooSmall);
        require!(duration_seconds > 0 && duration_seconds <= MAX_DURATION, BCFError::InvalidDuration);

        // Snapshot project data BEFORE load_init (no &mut held)
        let creator_key      = ctx.accounts.creator.key();
        let project_creator  = ctx.accounts.project.creator;
        let token_mint       = ctx.accounts.project.token_mint;
        let campaign_index   = ctx.accounts.project.campaign_count;
        let campaign_key     = ctx.accounts.campaign.key();
        let created_at       = Clock::get()?.unix_timestamp;

        require_keys_eq!(project_creator, creator_key, BCFError::Unauthorized);

        // Initialize via AccountLoader — zero_copy, no stack copy
        {
            let mut c = ctx.accounts.campaign.load_init()?;
            c.creator                 = creator_key;
            c.project_index           = project_index;
            c.campaign_index          = campaign_index;
            c.token_mint              = token_mint;
            c.prize_lamports          = prize_lamports;
            c.position_price_lamports = position_price_lamports;
            c.tokens_per_position     = tokens_per_position;
            c.duration_seconds        = duration_seconds;
            c.deadline                = 0;
            c.created_at              = created_at;
            c.status                  = 0;
            c.total_collected         = 0;
            c.treasury_contribution   = 0;
            c.winning_position        = 255;
            c.winning_slot            = 0;
            c.winner                  = Pubkey::default();
            for p in c.positions.iter_mut() { *p = PositionInfo::default(); }
            copy_str(&title,       &mut c.title);
            copy_str(&description, &mut c.description);
        } // AccountLoader ref released

        ctx.accounts.project.campaign_count = campaign_index + 1;

        emit!(CampaignCreated { campaign: campaign_key, creator: creator_key, project_index, campaign_index, prize_lamports, position_price_lamports });
        Ok(())
    }

    pub fn fund_campaign(ctx: Context<FundCampaign>) -> Result<()> {
        // Snapshot with load() — no mutable borrow
        let (creator_key, signer_key, status, prize, duration, campaign_key) = {
            let c = ctx.accounts.campaign.load()?;
            (c.creator, ctx.accounts.creator.key(), c.status, c.prize_lamports, c.duration_seconds, ctx.accounts.campaign.key())
        };

        require_keys_eq!(creator_key, signer_key, BCFError::Unauthorized);
        require!(status == 0, BCFError::CampaignNotPending);

        let clock = Clock::get()?;

        // CPI — no AccountLoader borrow held during CPI
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.creator.to_account_info(),
                    to:   ctx.accounts.campaign.to_account_info(),
                },
            ),
            prize,
        )?;

        let deadline = clock.unix_timestamp + duration;
        {
            let mut c = ctx.accounts.campaign.load_mut()?;
            c.status   = 1;
            c.deadline = deadline;
        }

        emit!(CampaignActivated { campaign: campaign_key, deadline });
        Ok(())
    }

    pub fn buy_position(ctx: Context<BuyPosition>, position_index: u8) -> Result<()> {
        // Snapshot
        let (status, deadline, pos_filled, price, tokens_per_pos, campaign_key, creator_snap, proj_idx) = {
            let c = ctx.accounts.campaign.load()?;
            (c.status, c.deadline, c.positions[position_index as usize].filled,
             c.position_price_lamports, c.tokens_per_position, ctx.accounts.campaign.key(),
             c.creator, c.project_index)
        };
        let buyer_key    = ctx.accounts.buyer.key();
        let treasury_cut = price * TREASURY_BPS / 10_000;

        // Validate project matches campaign
        require_keys_eq!(ctx.accounts.project.creator, creator_snap, BCFError::Unauthorized);
        require!(ctx.accounts.project.project_index == proj_idx, BCFError::Unauthorized);
        require_keys_eq!(ctx.accounts.project_creator.key(), creator_snap, BCFError::Unauthorized);

        require!(status == 1, BCFError::CampaignNotActive);
        require!(Clock::get()?.unix_timestamp < deadline, BCFError::CampaignExpired);
        require!((position_index as usize) < POSITIONS, BCFError::InvalidPosition);
        require!(pos_filled == 0, BCFError::PositionTaken);

        // CPI — no AccountLoader borrow held
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.buyer.to_account_info(),
                    to:   ctx.accounts.campaign.to_account_info(),
                },
            ),
            price,
        )?;

        ctx.accounts.project.treasury_lamports += treasury_cut;

        {
            let mut c = ctx.accounts.campaign.load_mut()?;
            c.positions[position_index as usize].filled = 1;
            c.positions[position_index as usize].owner  = buyer_key;
            c.total_collected       += price;
            c.treasury_contribution += treasury_cut;
        }

        emit!(PositionPurchased { campaign: campaign_key, position_index, buyer: buyer_key, price_lamports: price, tokens_received: tokens_per_pos });
        Ok(())
    }

    pub fn record_external_payment(ctx: Context<RecordExternalPayment>, position_index: u8, payer: Pubkey) -> Result<()> {
        let (status, pos_filled, creator, price, proj_idx) = {
            let c = ctx.accounts.campaign.load()?;
            (c.status, c.positions[position_index as usize].filled, c.creator, c.position_price_lamports, c.project_index)
        };
        let authority = ctx.accounts.authority.key();

        require_keys_eq!(ctx.accounts.project.creator, creator, BCFError::Unauthorized);
        require!(ctx.accounts.project.project_index == proj_idx, BCFError::Unauthorized);
        require!(status == 1, BCFError::CampaignNotActive);
        require!((position_index as usize) < POSITIONS, BCFError::InvalidPosition);
        require!(pos_filled == 0, BCFError::PositionTaken);
        require_keys_eq!(creator, authority, BCFError::Unauthorized);

        let treasury_cut = price * TREASURY_BPS / 10_000;
        ctx.accounts.project.treasury_lamports += treasury_cut;

        let mut c = ctx.accounts.campaign.load_mut()?;
        c.positions[position_index as usize].filled = 1;
        c.positions[position_index as usize].owner  = payer;
        c.total_collected       += price;
        c.treasury_contribution += treasury_cut;
        Ok(())
    }

    pub fn resolve_campaign(ctx: Context<ResolveCampaign>) -> Result<()> {
        let (status, deadline, prize, collected, campaign_key) = {
            let c = ctx.accounts.campaign.load()?;
            (c.status, c.deadline, c.prize_lamports, c.total_collected, ctx.accounts.campaign.key())
        };

        require!(status == 1, BCFError::CampaignNotActive);
        require!(Clock::get()?.unix_timestamp >= deadline, BCFError::DeadlineNotReached);

        // Derive winner from slot hash (borrow scoped separately from campaign)
        let winning_position: u8 = {
            let slot_hashes = &ctx.accounts.slot_hashes;
            let data = slot_hashes.data.borrow();
            let num_slots = u64::from_le_bytes(data[0..8].try_into().unwrap_or([0u8; 8]));
            if num_slots > 0 {
                let hash_bytes: [u8; 8] = data[16..24].try_into().unwrap_or([0u8; 8]);
                (u64::from_le_bytes(hash_bytes) % POSITIONS as u64) as u8
            } else {
                (Clock::get()?.unix_timestamp as u64 % POSITIONS as u64) as u8
            }
        };

        let winning_slot = Clock::get()?.slot;
        // Read winning position BEFORE load_mut
        let (has_winner, winner_key) = {
            let c = ctx.accounts.campaign.load()?;
            let filled = c.positions[winning_position as usize].filled == 1;
            let w = if filled { c.positions[winning_position as usize].owner } else { Pubkey::default() };
            (filled, w)
        };
        let total_pot = prize + collected;

        {
            let mut c = ctx.accounts.campaign.load_mut()?;
            c.status           = 2;
            c.winning_position = winning_position;
            c.winning_slot     = winning_slot;
            c.winner           = winner_key;
        }

        emit!(CampaignResolved { campaign: campaign_key, winning_position, has_winner, winner: winner_key, total_pot, winning_slot });
        Ok(())
    }

    pub fn claim_prize(ctx: Context<ClaimPrize>) -> Result<()> {
        let (status, winning_pos, pos_filled, pos_owner, prize, collected) = {
            let c = ctx.accounts.campaign.load()?;
            let wp = c.winning_position;
            (c.status, wp, c.positions[wp as usize].filled, c.positions[wp as usize].owner,
             c.prize_lamports, c.total_collected)
        };
        let winner_signer = ctx.accounts.winner.key();

        require!(status == 2,        BCFError::CampaignNotSettled);
        require!(winning_pos != 255, BCFError::NotResolved);
        require!(pos_filled == 1,    BCFError::NoWinner);
        require_keys_eq!(pos_owner, winner_signer, BCFError::NotWinner);

        let total = prize + collected;
        require!(total > 0, BCFError::InsufficientFunds);

        // Lamport transfer — no AccountLoader borrow held
        **ctx.accounts.campaign.to_account_info().try_borrow_mut_lamports()? -= total;
        **ctx.accounts.winner.to_account_info().try_borrow_mut_lamports()?   += total;

        let mut c = ctx.accounts.campaign.load_mut()?;
        c.prize_lamports  = 0;
        c.total_collected = 0;
        Ok(())
    }

    pub fn route_no_winner_to_treasury(ctx: Context<RouteNoWinner>) -> Result<()> {
        let (status, winning_pos, pos_filled, prize, collected) = {
            let c = ctx.accounts.campaign.load()?;
            let wp = c.winning_position;
            (c.status, wp, c.positions[wp as usize].filled, c.prize_lamports, c.total_collected)
        };

        let camp_creator = { ctx.accounts.campaign.load()?.creator };
        let camp_proj_idx = { ctx.accounts.campaign.load()?.project_index };
        require_keys_eq!(ctx.accounts.project.creator, camp_creator, BCFError::Unauthorized);
        require!(ctx.accounts.project.project_index == camp_proj_idx, BCFError::Unauthorized);
        require_keys_eq!(ctx.accounts.project_creator.key(), camp_creator, BCFError::Unauthorized);

        require!(status == 2,        BCFError::CampaignNotSettled);
        require!(winning_pos != 255, BCFError::NotResolved);
        require!(pos_filled == 0,    BCFError::HasWinner);

        let total = prize + collected;
        require!(total > 0, BCFError::InsufficientFunds);

        // Lamport transfer — no borrow held
        **ctx.accounts.campaign.to_account_info().try_borrow_mut_lamports()?        -= total;
        **ctx.accounts.project_creator.to_account_info().try_borrow_mut_lamports()? += total;

        ctx.accounts.project.treasury_lamports += total;

        let mut c = ctx.accounts.campaign.load_mut()?;
        c.prize_lamports  = 0;
        c.total_collected = 0;
        Ok(())
    }

    pub fn withdraw_treasury(ctx: Context<WithdrawTreasury>, amount_lamports: u64) -> Result<()> {
        let proj_creator = ctx.accounts.project.creator;
        let signer_key   = ctx.accounts.creator.key();
        let treasury     = ctx.accounts.project.treasury_lamports;
        let proj_idx     = ctx.accounts.project.project_index;
        let project_key  = ctx.accounts.project.key();

        require_keys_eq!(proj_creator, signer_key, BCFError::Unauthorized);
        require!(treasury >= amount_lamports, BCFError::InsufficientFunds);
        require!(amount_lamports > 0,         BCFError::InsufficientFunds);

        **ctx.accounts.project.to_account_info().try_borrow_mut_lamports()? -= amount_lamports;
        **ctx.accounts.creator.to_account_info().try_borrow_mut_lamports()? += amount_lamports;

        let remaining = treasury - amount_lamports;
        ctx.accounts.project.treasury_lamports = remaining;

        emit!(TreasuryWithdrawal { project: project_key, creator: signer_key, project_index: proj_idx, amount_lamports, remaining });
        Ok(())
    }
}

// ─── Account Contexts ─────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct InitializeProject<'info> {
    #[account(
        init_if_needed,
        payer  = creator,
        space  = 8 + 32 + 8,
        seeds  = [b"registry", creator.key().as_ref()],
        bump,
    )]
    pub registry: Account<'info, CreatorRegistry>,

    #[account(
        init,
        payer = creator,
        space = 8 + 32 + 8 + 32 + 60 + 80 + 12 + 8 + 8,
        seeds = [b"project", creator.key().as_ref(), &registry.project_count.to_le_bytes()],
        bump,
    )]
    pub project: Account<'info, ProjectAccount>,

    #[account(mut)]
    pub creator: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(project_index: u64)]
pub struct CreateCampaign<'info> {
    // AccountLoader — zero_copy, no stack allocation for CampaignAccount
    #[account(
        init,
        payer = creator,
        space = 8 + std::mem::size_of::<CampaignAccount>(),
        seeds = [b"campaign", creator.key().as_ref(), &project.campaign_count.to_le_bytes()],
        bump,
    )]
    pub campaign: AccountLoader<'info, CampaignAccount>,

    #[account(
        mut,
        seeds = [b"project", creator.key().as_ref(), &project_index.to_le_bytes()],
        bump,
    )]
    pub project: Account<'info, ProjectAccount>,

    #[account(mut)]
    pub creator: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct FundCampaign<'info> {
    #[account(mut)]
    pub campaign: AccountLoader<'info, CampaignAccount>,
    #[account(mut)]
    pub creator: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(position_index: u8)]
pub struct BuyPosition<'info> {
    #[account(mut)]
    pub campaign: AccountLoader<'info, CampaignAccount>,

    /// Project PDA — validated in instruction handler against campaign.project_index
    #[account(mut)]
    pub project: Account<'info, ProjectAccount>,

    #[account(mut)]
    pub buyer: Signer<'info>,

    /// CHECK: identity only — validated in instruction handler
    pub project_creator: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RecordExternalPayment<'info> {
    #[account(mut)]
    pub campaign: AccountLoader<'info, CampaignAccount>,

    /// Project PDA — validated in instruction handler
    #[account(mut)]
    pub project: Account<'info, ProjectAccount>,

    #[account(mut)]
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct ResolveCampaign<'info> {
    #[account(mut)]
    pub campaign: AccountLoader<'info, CampaignAccount>,

    /// CHECK: Solana slot hashes sysvar
    #[account(address = anchor_lang::solana_program::sysvar::slot_hashes::id())]
    pub slot_hashes: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct ClaimPrize<'info> {
    #[account(mut)]
    pub campaign: AccountLoader<'info, CampaignAccount>,
    #[account(mut)]
    pub winner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RouteNoWinner<'info> {
    #[account(mut)]
    pub campaign: AccountLoader<'info, CampaignAccount>,

    /// Project PDA — validated in instruction handler
    #[account(mut)]
    pub project: Account<'info, ProjectAccount>,

    /// CHECK: validated against campaign.creator in instruction handler
    #[account(mut)]
    pub project_creator: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(amount_lamports: u64)]
pub struct WithdrawTreasury<'info> {
    #[account(
        mut,
        seeds = [b"project", creator.key().as_ref(), &project.project_index.to_le_bytes()],
        bump,
    )]
    pub project: Account<'info, ProjectAccount>,

    #[account(mut)]
    pub creator: Signer<'info>,
}

// ─── Errors ───────────────────────────────────────────────────────────────────
#[error_code]
pub enum BCFError {
    #[msg("Unauthorized")]              Unauthorized,
    #[msg("Campaign not pending")]      CampaignNotPending,
    #[msg("Campaign not active")]       CampaignNotActive,
    #[msg("Campaign not settled")]      CampaignNotSettled,
    #[msg("Campaign deadline passed")]  CampaignExpired,
    #[msg("Deadline not reached yet")]  DeadlineNotReached,
    #[msg("Not yet resolved")]          NotResolved,
    #[msg("Position has no winner")]    NoWinner,
    #[msg("Has a winner — use claim")]  HasWinner,
    #[msg("Not the winner")]            NotWinner,
    #[msg("Position already taken")]    PositionTaken,
    #[msg("Invalid position index")]    InvalidPosition,
    #[msg("Prize too small")]           PrizeTooSmall,
    #[msg("Position price too small")]  PriceTooSmall,
    #[msg("Invalid duration")]          InvalidDuration,
    #[msg("Insufficient funds")]        InsufficientFunds,
}
