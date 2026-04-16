use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use switchboard_on_demand::accounts::RandomnessAccountData;

declare_id!("BCF1111111111111111111111111111111111111111");

#[program]
pub mod bcf_core {
    use super::*;

    pub fn initialize_raffle(
        ctx: Context<InitializeRaffle>,
        prize_amount: u64,
        ticket_price: u64,
        duration: i64,
        description: String,
        donation_address: Option<Pubkey>,
    ) -> Result<()> {
        let raffle = &mut ctx.accounts.raffle;
        let clock = Clock::get()?;

        raffle.creator = ctx.accounts.creator.key();
        raffle.prize_amount = prize_amount;
        raffle.ticket_price = ticket_price;
        raffle.start_time = 0; // Set upon activation
        raffle.end_time = 0;   // Set upon activation
        raffle.expiry_time = clock.unix_timestamp + (15 * 60); // 15-minute funding window
        raffle.created_at = clock.unix_timestamp;
        raffle.status = RaffleStatus::WaitingDeposit;
        raffle.description = description;
        raffle.donation_address = donation_address;
        raffle.total_tickets_sold = 0;
        raffle.collected_funds = 0;
        raffle.winning_number = None;
        raffle.bump = ctx.bumps.raffle;
        raffle.vault_bump = ctx.bumps.vault_account;
        raffle.slots = [None; 100];

        msg!("BCF: Raffle Initialized. Waiting for bootstrap funding.");
        Ok(())
    }

    pub fn activate_raffle(ctx: Context<ActivateRaffle>) -> Result<()> {
        let raffle = &mut ctx.accounts.raffle;
        let clock = Clock::get()?;
        
        if ctx.accounts.vault_account.amount < raffle.prize_amount {
            return err!(BCFError::InsufficientPrizeDeposit);
        }

        raffle.status = RaffleStatus::Active;
        msg!("BCF: Raffle is now ACTIVE.");
        Ok(())
    }

    pub fn buy_ticket(ctx: Context<BuyTicket>, number: u8) -> Result<()> {
        let raffle = &mut ctx.accounts.raffle;
        let clock = Clock::get()?;

        if raffle.status != RaffleStatus::Active || clock.unix_timestamp > raffle.end_time {
            return err!(BCFError::RaffleNotActive);
        }

        if number > 99 || raffle.slots[number as usize].is_some() {
            return err!(BCFError::InvalidNumberSelection);
        }

        let fee = raffle.ticket_price * 25 / 1000; // 2.5%
        let net_to_pool = raffle.ticket_price - fee;

        let cpi_accounts = Transfer {
            from: ctx.accounts.buyer_token_account.to_account_info(),
            to: ctx.accounts.vault_account.to_account_info(),
            authority: ctx.accounts.buyer.to_account_info(),
        };
        token::transfer(CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts), raffle.ticket_price)?;

        raffle.slots[number as usize] = Some(ctx.accounts.buyer.key());
        raffle.total_tickets_sold += 1;
        raffle.collected_funds += net_to_pool;

        Ok(())
    }

    pub fn settle_raffle(ctx: Context<SettleRaffle>) -> Result<()> {
        let raffle = &mut ctx.accounts.raffle;
        let clock = Clock::get()?;

        if clock.unix_timestamp < raffle.end_time {
            return err!(BCFError::RaffleStillOngoing);
        }

        let randomness_data = RandomnessAccountData::parse(ctx.accounts.randomness_account.data.borrow()).unwrap();
        let random_bytes = randomness_data.get_value(clock.slot)?;
        let winning_number = (random_bytes[0] % 100) as u8;

        raffle.winning_number = Some(winning_number);
        raffle.status = RaffleStatus::Resolved;

        msg!("BCF: Winning Number revealed: #{}", winning_number);
        Ok(())
    }

    pub fn claim_universal(ctx: Context<ClaimUniversal>) -> Result<()> {
        let raffle = &mut ctx.accounts.raffle;
        
        if raffle.status != RaffleStatus::Resolved {
            return err!(BCFError::RaffleNotResolved);
        }

        let winning_number = raffle.winning_number.unwrap() as usize;
        let winner_pubkey = raffle.slots[winning_number];

        let seeds = &[
            b"raffle",
            raffle.creator.as_ref(),
            raffle.description.as_bytes(),
            &[raffle.bump],
        ];
        let signer = &[&seeds[..]];

        match winner_pubkey {
            Some(winner) => {
                if winner != ctx.accounts.claimant.key() && raffle.creator != ctx.accounts.claimant.key() {
                    return err!(BCFError::UnauthorizedClaimant);
                }

                // Transfer Prize to winner
                let prize_transfer = Transfer {
                    from: ctx.accounts.vault_account.to_account_info(),
                    to: ctx.accounts.winner_token_account.to_account_info(),
                    authority: raffle.to_account_info(),
                };
                token::transfer(CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(), prize_transfer, signer), raffle.prize_amount)?;

                // Transfer Sales to creator
                let sales_transfer = Transfer {
                    from: ctx.accounts.vault_account.to_account_info(),
                    to: ctx.accounts.creator_token_account.to_account_info(),
                    authority: raffle.to_account_info(),
                };
                token::transfer(CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(), sales_transfer, signer), raffle.collected_funds)?;
            },
            None => {
                if raffle.creator != ctx.accounts.claimant.key() {
                    return err!(BCFError::UnauthorizedClaimant);
                }

                // Transfer Everything to creator
                let total_transfer = Transfer {
                    from: ctx.accounts.vault_account.to_account_info(),
                    to: ctx.accounts.creator_token_account.to_account_info(),
                    authority: raffle.to_account_info(),
                };
                token::transfer(CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(), total_transfer, signer), ctx.accounts.vault_account.amount)?;
            }
        raffle.status = RaffleStatus::Closed;
        Ok(())
    }

    pub fn cancel_raffle(ctx: Context<CancelRaffle>) -> Result<()> {
        let raffle = &mut ctx.accounts.raffle;
        let clock = Clock::get()?;

        // Can only cancel if still waiting deposit AND 15 mins passed
        if raffle.status != RaffleStatus::WaitingDeposit {
            return err!(BCFError::RaffleNotCancellable);
        }

        if clock.unix_timestamp < raffle.expiry_time {
            return err!(BCFError::RaffleStillOngoing);
        }

        let seeds = &[
            b"raffle",
            raffle.creator.as_ref(),
            raffle.description.as_bytes(),
            &[raffle.bump],
        ];
        let signer = &[&seeds[..]];

        // Refund any partial deposited prize to creator
        if ctx.accounts.vault_account.amount > 0 {
            let refund_transfer = Transfer {
                from: ctx.accounts.vault_account.to_account_info(),
                to: ctx.accounts.creator_token_account.to_account_info(),
                authority: raffle.to_account_info(),
            };
            token::transfer(CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(), refund_transfer, signer), ctx.accounts.vault_account.amount)?;
        }

        raffle.status = RaffleStatus::Cancelled;
        Ok(())
    }

    pub fn assign_ticket_admin(ctx: Context<AssignTicketAdmin>, buyer: Pubkey, number: u8) -> Result<()> {
        let raffle = &mut ctx.accounts.raffle;
        
        if raffle.status != RaffleStatus::Active {
            return err!(BCFError::RaffleNotActive);
        }

        if number >= 100 || raffle.slots[number as usize].is_some() {
            return err!(BCFError::InvalidNumberSelection);
        }

        raffle.slots[number as usize] = Some(buyer);
        raffle.total_tickets_sold += 1;
        raffle.collected_funds += raffle.ticket_price;

        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(prize_amount: u64, ticket_price: u64, duration: i64, description: String)]
pub struct InitializeRaffle<'info> {
    #[account(
        init,
        payer = creator,
        space = 8 + Raffle::MAX_SIZE,
        seeds = [b"raffle", creator.key().as_ref(), description.as_bytes()],
        bump
    )]
    pub raffle: Account<'info, Raffle>,
    #[account(
        init,
        payer = creator,
        seeds = [b"vault", raffle.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = raffle,
    )]
    pub vault_account: Account<'info, TokenAccount>,
    pub mint: Account<'info, token::Mint>,
    #[account(mut)]
    pub creator: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct ActivateRaffle<'info> {
    #[account(mut, has_one = creator)]
    pub raffle: Account<'info, Raffle>,
    pub creator: Signer<'info>,
    #[account(mut, seeds = [b"vault", raffle.key().as_ref()], bump = raffle.vault_bump)]
    pub vault_account: Account<'info, TokenAccount>,
}

#[derive(Accounts)]
pub struct BuyTicket<'info> {
    #[account(mut)]
    pub raffle: Account<'info, Raffle>,
    #[account(mut)]
    pub buyer: Signer<'info>,
    #[account(mut)]
    pub buyer_token_account: Account<'info, TokenAccount>,
    #[account(mut, seeds = [b"vault", raffle.key().as_ref()], bump = raffle.vault_bump)]
    pub vault_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct SettleRaffle<'info> {
    #[account(mut)]
    pub raffle: Account<'info, Raffle>,
    /// CHECK: Switchboard account
    pub randomness_account: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct ClaimUniversal<'info> {
    #[account(mut)]
    pub raffle: Account<'info, Raffle>,
    #[account(mut)]
    pub claimant: Signer<'info>,
    #[account(mut, seeds = [b"vault", raffle.key().as_ref()], bump = raffle.vault_bump)]
    pub vault_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub creator_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub winner_token_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct CancelRaffle<'info> {
    #[account(mut, has_one = creator)]
    pub raffle: Account<'info, Raffle>,
    #[account(mut)]
    pub creator: Signer<'info>,
    #[account(mut, seeds = [b"vault", raffle.key().as_ref()], bump = raffle.vault_bump)]
    pub vault_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub creator_token_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct AssignTicketAdmin<'info> {
    #[account(mut)]
    pub raffle: Account<'info, Raffle>,
    pub authority: Signer<'info>, // Protocol bot or Creator
}

#[account]
pub struct Raffle {
    pub creator: Pubkey,
    pub prize_amount: u64,
    pub ticket_price: u64,
    pub start_time: i64,
    pub end_time: i64,
    pub expiry_time: i64,
    pub created_at: i64,
    pub status: RaffleStatus,
    pub description: String,
    pub donation_address: Option<Pubkey>,
    pub total_tickets_sold: u64,
    pub collected_funds: u64,
    pub winning_number: Option<u8>,
    pub bump: u8,
    pub vault_bump: u8,
    pub slots: [Option<Pubkey>; 100],
}

impl Raffle {
    pub const MAX_SIZE: usize = 32 + 8 + 8 + 8 + 8 + 8 + 1 + 64 + 33 + 8 + 8 + 2 + 1 + 1 + (100 * 33);
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum RaffleStatus {
    WaitingDeposit,
    Active,
    Resolved,
    Closed,
    Cancelled,
}

#[error_code]
pub enum BCFError {
    #[msg("Insufficient prize deposit in vault.")]
    InsufficientPrizeDeposit,
    #[msg("Raffle is not active.")]
    RaffleNotActive,
    #[msg("Invalid slot or already occupied.")]
    InvalidNumberSelection,
    #[msg("Raffle still ongoing.")]
    RaffleStillOngoing,
    #[msg("Raffle not resolved.")]
    RaffleNotResolved,
    #[msg("Unauthorized claimant.")]
    UnauthorizedClaimant,
    #[msg("Raffle cannot be cancelled in current state.")]
    RaffleNotCancellable,
}

