//! BagsCreatorFund — On-chain creator funding protocol
//! Built on Solana with Anchor for the Bags Hackathon 2025
//!
//! Architecture:
//!   ProjectAccount (PDA): Creator's project identity + treasury
//!   CampaignAccount (PDA): Funding round state + position map
//!   The campaign account itself acts as the vault (holds all SOL)
//!
//! Key flows:
//!   1. Creator initializes project (links Bags token)
//!   2. Creator creates campaign + funds prize → campaign activates
//!   3. Participants buy positions (wallet or CEX)
//!   4. Time expires → anyone calls resolve (uses slot hash for randomness)
//!   5. Winner claims prize OR no-winner routes to treasury

use anchor_lang::prelude::*;
use anchor_lang::system_program;
use std::mem;
use bytemuck::{Zeroable, Pod};

declare_id!("Rx1XswVLMPFAw48m2hVbKeM3eJYkZWNLe1ER5QzLg3L");

// ─── Constants ────────────────────────────────────────────────────────────────
const MAX_TITLE:     usize = 100;
const MAX_DESC:      usize = 500;
const MAX_FEE_NAME:  usize = 40;
const POSITIONS:     usize = 100;
const TREASURY_BPS:  u64   = 200;  // 2%
const MIN_PRIZE:     u64   = 1_000_000;   // 0.001 SOL
const MIN_PRICE:     u64   = 1_000;       // 0.000001 SOL
const MAX_DURATION:  i64   = 30 * 86_400; // 30 days in seconds

// ─── Events ────────────────────────────────────────────────────────────────────
#[event]
pub struct ProjectCreated {
    pub creator:    Pubkey,
    pub token_mint: Pubkey,
    pub timestamp:  i64,
}

#[event]
pub struct CampaignCreated {
    pub campaign:                  Pubkey,
    pub creator:                   Pubkey,
    pub prize_lamports:            u64,
    pub position_price_lamports:   u64,
    pub campaign_index:            u64,
}

#[event]
pub struct CampaignActivated {
    pub campaign: Pubkey,
    pub deadline: i64,
}

#[event]
pub struct PositionPurchased {
    pub campaign:         Pubkey,
    pub position_index:   u8,
    pub buyer:            Pubkey,
    pub price_lamports:   u64,
    pub tokens_received:  u64,
}

#[event]
pub struct CampaignResolved {
    pub campaign:          Pubkey,
    pub winning_position:  u8,
    pub has_winner:        bool,
    pub winner:            Pubkey,
    pub total_pot:         u64,
    pub winning_slot:      u64,
}

#[event]
pub struct TreasuryWithdrawal {
    pub project:           Pubkey,
    pub creator:           Pubkey,
    pub amount_lamports:   u64,
    pub remaining:         u64,
}

// ─── Data Structs ─────────────────────────────────────────────────────────────
/// One position in the funding round grid (00–99)
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Zeroable, Pod)]
#[repr(C)]
pub struct PositionInfo {
    pub filled: u8,     // 1 byte
    pub _pad:   [u8; 7], // padding for 8-byte alignment
    pub owner:  Pubkey, // 32 bytes
}

impl Default for PositionInfo {
    fn default() -> Self {
        Self { filled: 0, _pad: [0; 7], owner: Pubkey::default() }
    }
}

// ─── Accounts ─────────────────────────────────────────────────────────────────
/// Creator's project account — links Bags token, holds treasury
#[account]
pub struct ProjectAccount {
    pub creator:            Pubkey,  // 32
    pub token_mint:         Pubkey,  // 32
    pub treasury_lamports:  u64,     // 8
    pub total_earned:       u64,     // 8
    pub campaign_count:     u64,     // 8
    pub bump:               u8,      // 1
    pub fee_mode_name:      String,  // 4 + MAX_FEE_NAME
}

impl ProjectAccount {
    pub const SPACE: usize = 8        // discriminator
        + 32 + 32 + 8 + 8 + 8 + 1   // fields
        + (4 + MAX_FEE_NAME);         // string
}

/// Funding campaign — holds ALL SOL (acts as vault), tracks all positions
#[account(zero_copy)]
#[repr(C)]
pub struct CampaignAccount {
    // Identity
    pub creator:                   Pubkey,  // 32
    pub project:                   Pubkey,  // 32
    pub token_mint:                Pubkey,  // 32
    // Economics
    pub prize_lamports:            u64,     // 8
    pub position_price_lamports:   u64,     // 8
    pub tokens_per_position:       u64,     // 8
    // Timing
    pub duration_seconds:          i64,     // 8
    pub deadline:                  i64,     // 8
    pub created_at:                i64,     // 8
    // Status  (0=pending, 1=active, 2=settled)
    pub status:                    u8,      // 1
    // Stats
    pub positions_filled:          u8,      // 1
    pub _pad0:                     [u8; 6], // padding for 8-byte alignment
    pub total_collected:           u64,     // 8
    pub treasury_contribution:     u64,     // 8
    // Settlement
    pub winning_position:          u8,      // 1 (255 = not resolved)
    pub has_winner:                u8,      // 0 = false, 1 = true
    pub _pad1:                     [u8; 6], // padding for 8-byte alignment
    pub winner:                    Pubkey,  // 32
    pub winning_slot:              u64,     // 8
    // Metadata
    pub campaign_index:            u64,     // 8
    pub bump:                      u8,      // 1
    pub _reserved:                 [u8; 7], // padding for alignment
    // Positions (the grid) 10x10 to satisfy bytemuck array limits
    pub positions: [[PositionInfo; 10]; 10], 
    // Text (fixed size for zero_copy) - sized to multiples of 8
    pub title:       [[u8; 8]; 13],        // 104 bytes
    pub description: [[u8; 32]; 16],       // 512 bytes
}

impl CampaignAccount {
    pub const SPACE: usize = 8 + mem::size_of::<CampaignAccount>();
}

// ─── Instruction Contexts ──────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct InitializeProject<'info> {
    #[account(
        init,
        payer  = creator,
        space  = ProjectAccount::SPACE,
        seeds  = [b"project", creator.key().as_ref()],
        bump
    )]
    pub project: Account<'info, ProjectAccount>,

    #[account(mut)]
    pub creator: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CreateCampaign<'info> {
    #[account(
        init,
        payer = creator,
        space = CampaignAccount::SPACE,
        seeds = [
            b"campaign",
            creator.key().as_ref(),
            &project.campaign_count.to_le_bytes()
        ],
        bump
    )]
    pub campaign: AccountLoader<'info, CampaignAccount>,

    #[account(
        mut,
        seeds = [b"project", creator.key().as_ref()],
        bump  = project.bump,
        has_one = creator @ BCFError::Unauthorized,
    )]
    pub project: Box<Account<'info, ProjectAccount>>,

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
pub struct BuyPosition<'info> {
    #[account(mut)]
    pub campaign: AccountLoader<'info, CampaignAccount>,

    #[account(
        mut,
        seeds = [b"project", project_creator.key().as_ref()],
        bump  = project.bump,
    )]
    pub project: Box<Account<'info, ProjectAccount>>,

    /// CHECK: Validated via seeds
    pub project_creator: AccountInfo<'info>,

    #[account(mut)]
    pub buyer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RecordExternalPayment<'info> {
    #[account(mut)]
    pub campaign: AccountLoader<'info, CampaignAccount>,

    #[account(
        mut,
        seeds = [b"project", authority.key().as_ref()],
        bump  = project.bump,
    )]
    pub project: Box<Account<'info, ProjectAccount>>,

    /// Campaign creator authorizes this after verifying CEX payment off-chain
    #[account(mut)]
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct ResolveCampaign<'info> {
    #[account(mut)]
    pub campaign: AccountLoader<'info, CampaignAccount>,

    /// CHECK: We manually read the slot hashes sysvar for randomness
    #[account(address = anchor_lang::solana_program::sysvar::slot_hashes::ID)]
    pub slot_hashes: UncheckedAccount<'info>,
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
pub struct RouteToTreasury<'info> {
    #[account(mut)]
    pub campaign: AccountLoader<'info, CampaignAccount>,

    #[account(
        mut,
        seeds = [b"project", project_creator.key().as_ref()],
        bump  = project.bump,
    )]
    pub project: Box<Account<'info, ProjectAccount>>,

    /// CHECK: Validated via seeds
    pub project_creator: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct WithdrawTreasury<'info> {
    #[account(
        mut,
        seeds = [b"project", creator.key().as_ref()],
        bump  = project.bump,
    )]
    pub project: Account<'info, ProjectAccount>,

    #[account(mut)]
    pub creator: Signer<'info>,
}

// ─── Error Codes ──────────────────────────────────────────────────────────────
#[error_code]
pub enum BCFError {
    #[msg("Invalid campaign status for this operation")]
    InvalidStatus,
    #[msg("Unauthorized: wrong signer")]
    Unauthorized,
    #[msg("Invalid amount")]
    InvalidAmount,
    #[msg("Invalid position index (must be 0–99)")]
    InvalidPosition,
    #[msg("Position already taken")]
    PositionTaken,
    #[msg("Campaign deadline has passed")]
    CampaignExpired,
    #[msg("Campaign has not expired yet")]
    NotExpired,
    #[msg("Campaign has a winner — use claim_prize")]
    HasWinner,
    #[msg("Campaign has no winner")]
    NoWinner,
    #[msg("Insufficient treasury funds")]
    InsufficientFunds,
    #[msg("String exceeds maximum length")]
    StringTooLong,
}

// ─── Program Instructions ──────────────────────────────────────────────────────
#[program]
pub mod bags_creator_fund {
    use super::*;

    /// Step 1: Creator links their Bags token to create a project on-chain
    pub fn initialize_project(
        ctx:           Context<InitializeProject>,
        token_mint:    Pubkey,
        fee_mode_name: String,
    ) -> Result<()> {
        require!(fee_mode_name.len() <= MAX_FEE_NAME, BCFError::StringTooLong);

        let p       = &mut ctx.accounts.project;
        let clock   = Clock::get()?;

        p.creator           = ctx.accounts.creator.key();
        p.token_mint        = token_mint;
        p.treasury_lamports = 0;
        p.total_earned      = 0;
        p.campaign_count    = 0;
        p.bump              = ctx.bumps.project;
        p.fee_mode_name     = fee_mode_name;

        emit!(ProjectCreated {
            creator:    p.creator,
            token_mint: p.token_mint,
            timestamp:  clock.unix_timestamp,
        });
        Ok(())
    }

    /// Step 2: Create a funding campaign associated with the project token
    pub fn create_campaign(
        ctx:                      Context<CreateCampaign>,
        prize_lamports:           u64,
        position_price_lamports:  u64,
        tokens_per_position:      u64,
        duration_seconds:         i64,
        title:                    String,
        description:              String,
    ) -> Result<()> {
        require!(title.len()       <= MAX_TITLE, BCFError::StringTooLong);
        require!(description.len() <= MAX_DESC,  BCFError::StringTooLong);
        require!(prize_lamports           >= MIN_PRIZE, BCFError::InvalidAmount);
        require!(position_price_lamports  >= MIN_PRICE, BCFError::InvalidAmount);
        require!(duration_seconds > 0 && duration_seconds <= MAX_DURATION, BCFError::InvalidAmount);

        let clock    = Clock::get()?;
        let mut campaign = ctx.accounts.campaign.load_init()?;
        let project      = &mut ctx.accounts.project;

        campaign.creator                 = ctx.accounts.creator.key();
        campaign.project                 = project.key();
        campaign.token_mint              = project.token_mint;
        campaign.prize_lamports          = prize_lamports;
        campaign.position_price_lamports = position_price_lamports;
        campaign.tokens_per_position     = tokens_per_position;
        campaign.duration_seconds        = duration_seconds;
        campaign.deadline                = 0;
        campaign.created_at              = clock.unix_timestamp;
        campaign.status                  = 0;
        campaign.positions_filled        = 0;
        campaign.total_collected         = 0;
        campaign.treasury_contribution   = 0;
        campaign.winning_position        = 255; // sentinel: not resolved
        campaign.has_winner              = 0;
        campaign.winner                  = Pubkey::default();
        campaign.winning_slot            = 0;
        
        // Copy strings to fixed-size 2D arrays
        let title_bytes = title.as_bytes();
        for i in 0..13 {
            for j in 0..8 {
                let idx = i * 8 + j;
                if idx < title_bytes.len() {
                    campaign.title[i][j] = title_bytes[idx];
                }
            }
        }

        let desc_bytes = description.as_bytes();
        for i in 0..16 {
            for j in 0..32 {
                let idx = i * 32 + j;
                if idx < desc_bytes.len() {
                    campaign.description[i][j] = desc_bytes[idx];
                }
            }
        }

        campaign.campaign_index          = project.campaign_count;
        campaign.bump                    = ctx.bumps.campaign;

        project.campaign_count = project.campaign_count.checked_add(1).unwrap();

        emit!(CampaignCreated {
            campaign:                ctx.accounts.campaign.key(),
            creator:                 campaign.creator,
            prize_lamports,
            position_price_lamports,
            campaign_index:          campaign.campaign_index,
        });
        Ok(())
    }

    /// Step 3: Creator deposits prize SOL into campaign account → activates it
    /// The campaign account itself acts as the vault (program-owned)
    pub fn fund_campaign(ctx: Context<FundCampaign>) -> Result<()> {
        let prize = {
            let campaign = ctx.accounts.campaign.load()?;
            require!(campaign.status == 0, BCFError::InvalidStatus);
            require!(campaign.creator == ctx.accounts.creator.key(), BCFError::Unauthorized);
            campaign.prize_lamports
        };

        // Transfer prize from creator to campaign account (vault)
        // We do this while campaign data is NOT borrowed to avoid AccountBorrowFailed
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

        let clock = Clock::get()?;
        let mut campaign = ctx.accounts.campaign.load_mut()?;
        campaign.status   = 1; // active
        campaign.deadline = clock.unix_timestamp + campaign.duration_seconds;

        emit!(CampaignActivated {
            campaign: ctx.accounts.campaign.key(),
            deadline: campaign.deadline,
        });
        Ok(())
    }

    /// Web3 wallet user buys a specific position (00–99)
    pub fn buy_position(ctx: Context<BuyPosition>, position_index: u8) -> Result<()> {
        require!((position_index as usize) < POSITIONS, BCFError::InvalidPosition);

        let (price, tokens, treasury_cut, row, col) = {
            let campaign = ctx.accounts.campaign.load()?;
            require!(ctx.accounts.project_creator.key() == campaign.creator, BCFError::Unauthorized);
            require!(campaign.status == 1, BCFError::InvalidStatus);

            let clock = Clock::get()?;
            require!(clock.unix_timestamp < campaign.deadline, BCFError::CampaignExpired);
            
            let r = (position_index / 10) as usize;
            let c = (position_index % 10) as usize;
            require!(campaign.positions[r][c].filled == 0, BCFError::PositionTaken);

            let p = campaign.position_price_lamports;
            let t = campaign.tokens_per_position;
            let tc = p.checked_mul(TREASURY_BPS).unwrap().checked_div(10_000).unwrap();
            (p, t, tc, r, c)
        };

        // Transfer SOL from buyer to campaign account (vault)
        // Release campaign borrow before CPI
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

        let mut campaign = ctx.accounts.campaign.load_mut()?;
        // Mark position as owned
        campaign.positions[row][col] = PositionInfo {
            filled: 1,
            _pad:   [0; 7],
            owner:  ctx.accounts.buyer.key(),
        };

        campaign.positions_filled      += 1;
        campaign.total_collected        = campaign.total_collected.checked_add(price).unwrap();
        campaign.treasury_contribution  = campaign.treasury_contribution.checked_add(treasury_cut).unwrap();

        // Increment project treasury balance (logical tracking)
        let project = &mut ctx.accounts.project;
        project.treasury_lamports = project.treasury_lamports.checked_add(treasury_cut).unwrap();
        project.total_earned      = project.total_earned.checked_add(treasury_cut).unwrap();

        emit!(PositionPurchased {
            campaign:        ctx.accounts.campaign.key(),
            position_index,
            buyer:           ctx.accounts.buyer.key(),
            price_lamports:  price,
            tokens_received: tokens,
        });
        Ok(())
    }

    /// Record a CEX/external payment after creator verifies it off-chain
    /// The creator is the trusted authority for this — all actions are on-chain and visible
    /// In production: replace with oracle or ZK proof of payment
    pub fn record_external_payment(
        ctx:            Context<RecordExternalPayment>,
        position_index: u8,
        payer:          Pubkey,
    ) -> Result<()> {
        require!((position_index as usize) < POSITIONS, BCFError::InvalidPosition);

        let mut campaign = ctx.accounts.campaign.load_mut()?;
        require!(ctx.accounts.authority.key() == campaign.creator, BCFError::Unauthorized);
        require!(campaign.status == 1, BCFError::InvalidStatus);

        let clock = Clock::get()?;
        require!(clock.unix_timestamp < campaign.deadline, BCFError::CampaignExpired);

        let row = (position_index / 10) as usize;
        let col = (position_index % 10) as usize;
        require!(campaign.positions[row][col].filled == 0, BCFError::PositionTaken);

        let price        = campaign.position_price_lamports;
        let treasury_cut = price.checked_mul(TREASURY_BPS).unwrap().checked_div(10_000).unwrap();

        // Mark position
        campaign.positions[row][col] = PositionInfo {
            filled: 1,
            _pad:   [0; 7],
            owner:  payer,
        };

        campaign.positions_filled      += 1;
        campaign.total_collected        = campaign.total_collected.checked_add(price).unwrap();
        campaign.treasury_contribution  = campaign.treasury_contribution.checked_add(treasury_cut).unwrap();

        let project = &mut ctx.accounts.project;
        project.treasury_lamports = project.treasury_lamports.checked_add(treasury_cut).unwrap();
        project.total_earned      = project.total_earned.checked_add(treasury_cut).unwrap();

        emit!(PositionPurchased {
            campaign:        ctx.accounts.campaign.key(),
            position_index,
            buyer:           payer,
            price_lamports:  price,
            tokens_received: campaign.tokens_per_position,
        });
        Ok(())
    }

    /// Resolve the campaign: derive winning position from Solana slot hash (deterministic, public)
    /// Formula: winning_position = u64::from_le_bytes(slot_hash[0..8]) % 100
    pub fn resolve_campaign(ctx: Context<ResolveCampaign>) -> Result<()> {
        let mut campaign = ctx.accounts.campaign.load_mut()?;
        require!(campaign.status == 1, BCFError::InvalidStatus);

        let clock = Clock::get()?;
        require!(clock.unix_timestamp >= campaign.deadline, BCFError::NotExpired);

        // Read slot hashes sysvar for verifiable randomness
        let slot_hashes_data = ctx.accounts.slot_hashes.try_borrow_data()?;
        let winning_position: u8 = if slot_hashes_data.len() >= 16 {
            // Layout: [u64 count][u64 slot][u8; 32 hash] ...
            // We skip count (8 bytes), skip slot (8 bytes), take first 8 bytes of hash
            let hash_bytes: [u8; 8] = slot_hashes_data[16..24]
                .try_into()
                .unwrap_or([0u8; 8]);
            let hash_num = u64::from_le_bytes(hash_bytes);
            (hash_num % (POSITIONS as u64)) as u8
        } else {
            (clock.slot % 100) as u8
        };

        campaign.winning_position = winning_position;
        let row = (winning_position / 10) as usize;
        let col = (winning_position % 10) as usize;
        let pos = campaign.positions[row][col];
        campaign.has_winner = pos.filled;
        campaign.winner     = if pos.filled == 1 { pos.owner } else { Pubkey::default() };
        campaign.status     = 2; // settled
        campaign.winning_slot = clock.slot;

        let total_pot = campaign.prize_lamports.checked_add(campaign.total_collected).unwrap();

        emit!(CampaignResolved {
            campaign:         ctx.accounts.campaign.key(),
            winning_position,
            has_winner:       campaign.has_winner == 1,
            winner:           campaign.winner,
            total_pot,
            winning_slot:     clock.slot,
        });
        Ok(())
    }

    /// Winner claims their prize — all SOL in campaign account goes to them
    pub fn claim_prize(ctx: Context<ClaimPrize>) -> Result<()> {
        let campaign = ctx.accounts.campaign.load()?;
        require!(campaign.status == 2, BCFError::InvalidStatus);
        require!(campaign.has_winner == 1, BCFError::NoWinner);
        require!(ctx.accounts.winner.key() == campaign.winner, BCFError::Unauthorized);

        let total    = campaign.prize_lamports.checked_add(campaign.total_collected).unwrap();
        let rent_min = Rent::get()?.minimum_balance(CampaignAccount::SPACE);
        let to_pay   = total.min(
            ctx.accounts.campaign.to_account_info().lamports().saturating_sub(rent_min)
        );

        require!(to_pay > 0, BCFError::InsufficientFunds);

        // Direct lamport manipulation (program owns this account)
        **ctx.accounts.campaign.to_account_info().try_borrow_mut_lamports()? -= to_pay;
        **ctx.accounts.winner.try_borrow_mut_lamports()?         += to_pay;

        Ok(())
    }

    /// Route prize to project treasury when winning position was unclaimed
    pub fn route_no_winner_to_treasury(ctx: Context<RouteToTreasury>) -> Result<()> {
        let campaign = ctx.accounts.campaign.load()?;
        require!(campaign.status == 2, BCFError::InvalidStatus);
        require!(campaign.has_winner == 0, BCFError::HasWinner);
        require!(ctx.accounts.project_creator.key() == campaign.creator, BCFError::Unauthorized);
        let total    = campaign.prize_lamports
            .checked_add(campaign.total_collected)
            .unwrap();

        let rent_min = Rent::get()?.minimum_balance(CampaignAccount::SPACE);
        let to_route = total.min(
            ctx.accounts.campaign.to_account_info().lamports().saturating_sub(rent_min)
        );

        require!(to_route > 0, BCFError::InsufficientFunds);

        // Move lamports from campaign → project account
        **ctx.accounts.campaign.to_account_info().try_borrow_mut_lamports()? -= to_route;
        **ctx.accounts.project.to_account_info().try_borrow_mut_lamports()?  += to_route;

        ctx.accounts.project.treasury_lamports = ctx.accounts.project.treasury_lamports
            .checked_add(to_route)
            .unwrap();
        ctx.accounts.project.total_earned = ctx.accounts.project.total_earned
            .checked_add(to_route)
            .unwrap();

        Ok(())
    }

    /// Creator withdraws from project treasury
    /// All withdrawals are emitted as events — fully transparent to community
    pub fn withdraw_treasury(ctx: Context<WithdrawTreasury>, amount: u64) -> Result<()> {
        let project = &mut ctx.accounts.project;
        require!(project.creator == ctx.accounts.creator.key(), BCFError::Unauthorized);
        require!(amount > 0, BCFError::InvalidAmount);
        require!(amount <= project.treasury_lamports, BCFError::InsufficientFunds);

        let rent_min = Rent::get()?.minimum_balance(ProjectAccount::SPACE);
        let available = project.to_account_info().lamports().saturating_sub(rent_min);
        let to_send   = amount.min(available);
        require!(to_send > 0, BCFError::InsufficientFunds);

        project.treasury_lamports = project.treasury_lamports.checked_sub(to_send).unwrap();

        // Direct lamport manipulation (program owns project account)
        **project.to_account_info().try_borrow_mut_lamports()?         -= to_send;
        **ctx.accounts.creator.try_borrow_mut_lamports()? += to_send;

        emit!(TreasuryWithdrawal {
            project:         project.key(),
            creator:         project.creator,
            amount_lamports: to_send,
            remaining:       project.treasury_lamports,
        });
        Ok(())
    }
}
