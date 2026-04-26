# BagsCreatorFund (BCF) — Creator Funding Protocol

**Bags Hackathon 2025 · $1M Prize Pool**

> A permissionless funding-round protocol on Solana that drives real buy pressure on Bags tokens through the **Treasury Reinvestment Flywheel**.

---

## The Problem

Token creators launch on Bags but have no mechanism to generate **sustained buy pressure** after launch. The community buys once on the bonding curve and then waits — there's no engine to keep the token economy moving.

## The Solution: BCF Funding Rounds

BCF lets creators run transparent, on-chain funding rounds where:

- Participants buy **positions** (not just tokens) with real SOL
- A verifiable random winner is selected on-chain
- If no winner: all SOL flows to the **project treasury**
- Creator uses treasury SOL to **buy their own Bags token** — creating organic buy pressure

This is the **Proof-of-Funding flywheel**: activity in funding rounds creates real demand for the token.

---

## The Flywheel

```
Creator launches BCF campaign
        ↓
Participants buy positions with SOL
        ↓
No winner → SOL accumulates in treasury
        ↓
Creator clicks "Reinvest Treasury" in Dashboard
        ↓
BCF calls Bags trade API: SOL → creator token
        ↓
Token price rises on Meteora pool
        ↓
Higher token = more valuable campaigns
        ↓
More participants → bigger treasury → repeat ↑
```

The treasury reinvestment creates a feedback loop between campaign activity and token price. Every funding round with no winner is a scheduled buy order for the token.

---

## Dual-Network Architecture

BCF runs the **same smart contract** on both networks:

| Layer | DevNet | Mainnet |
|---|---|---|
| BCF contract | `D9KdRFUG4...` | `<your mainnet ID>` |
| Bags token | Simulated | Real (Meteora DBC) |
| SOL | Free (faucet) | Real |
| Campaigns | Real on-chain | Real on-chain |
| Treasury | Real SOL (devnet) | Real SOL |
| Reinvestment | Simulated | Live Bags trade API |

The token lives on **Mainnet** from day one (Bags handles this). The BCF contract and campaigns can be tested on DevNet first, then migrated to Mainnet by running `deploy-mainnet.sh`.

---

## Bags SDK Integration

BCF integrates all four Bags builder resources:

| Resource | How BCF uses it |
|---|---|
| `bags.fm` | Token trading page linked from every campaign |
| `docs.bags.fm` | Fee-share config, trade quote, claim transactions |
| `dev.bags.fm` | API key authentication for all Bags API calls |
| `@bagsfm/bags-sdk` | 4-step token launch flow in `CreateTokenPage` |

**Specific API endpoints used:**
- `POST /token-launch/create-token-info` — register metadata
- `POST /fee-share/config` — set creator as fee beneficiary (100%)
- `POST /token-launch/create-launch-transaction` — create Meteora DBC launch TX
- `GET /trade/quote` — get SOL→token swap quote for reinvestment
- `POST /trade/swap` — create reinvestment swap transaction
- `POST /token-launch/claim-txs/v3` — claim trading fee income

---

## Smart Contract (Anchor / Rust)

### Account Structure

```
CreatorRegistry  ["registry", creator]
  └─ project_count: u64

ProjectAccount   ["project", creator, project_index_le8]
  ├─ token_mint: Pubkey        (Bags Mainnet mint)
  ├─ treasury_lamports: u64    (= actual SOL in this PDA)
  └─ campaign_count: u64

CampaignAccount  ["campaign", creator, project_index_le8, campaign_count_le8]
  ├─ status: pending → active → settled
  ├─ prize_lamports, position_price_lamports
  ├─ positions[100]: PositionInfo (filled, owner)
  └─ total_collected, treasury_contribution

PositionVault    ["vault", campaign, position_index, recipient]
  └─ Personal escrow for CEX users (no memo required)
```

### Instructions

| Instruction | Description |
|---|---|
| `initialize_project` | Create project + auto-create registry |
| `create_campaign` | Create campaign under specific project |
| `fund_campaign` | Deposit prize SOL → activate |
| `buy_position` | Buy a position (wallet users) |
| `create_position_vault` | Create CEX vault for a position |
| `sweep_position_vault` | Sweep funded vault → assign position |
| `refund_position_vault` | Return funds if position unavailable |
| `resolve_campaign` | Pick winner via Solana slot hash |
| `claim_prize` | Winner claims prize |
| `route_no_winner_to_treasury` | No winner → funds to project treasury |
| `withdraw_treasury` | Creator withdraws from treasury |

---

## Quick Start

```bash
# Install
npm install

# DevNet (free, for testing)
cp .env.example .env
# Set VITE_NETWORK=devnet
npm run dev

# Mainnet (real SOL)
# 1. Set VITE_NETWORK=mainnet in .env
# 2. Deploy contract:
bash scripts/deploy-mainnet.sh
# 3. Update VITE_BCF_PROGRAM_ID_MAINNET in .env
npm run build
```

### Running the Watcher (CEX support)

```bash
# Auto-sweeps Position Vaults when funded
node scripts/watcher.mjs
```

---

## Environment Variables

```env
VITE_BAGS_API_KEY=bags_prod_...
VITE_BAGS_API_BASE=https://public-api-v2.bags.fm/api/v1
VITE_NETWORK=devnet                          # or: mainnet
VITE_SOLANA_RPC=https://api.devnet.solana.com
VITE_BCF_PROGRAM_ID_DEVNET=D9KdRFUG4mZ3gqgDSF8mdfDpJk7qKHsmDn8g3dRsvfBV
VITE_BCF_PROGRAM_ID_MAINNET=<mainnet_id>     # set after deploy-mainnet.sh
```

---

## What Makes BCF Unique

**For the Hackathon judges:**

- The Treasury Reinvestment feature directly connects funding round activity to token price — this is novel and specific to Bags
- CEX/exchange participation without memos (PositionVault system) makes campaigns accessible to anyone with a Binance or Coinbase account
- Unlimited tokens per wallet with fully isolated treasuries
- Verifiable on-chain randomness (Solana slot hashes — no oracle dependency)
- Full Bags SDK integration: launch, fees, trade, claim — all four pillars

**Program ID (DevNet):** `D9KdRFUG4mZ3gqgDSF8mdfDpJk7qKHsmDn8g3dRsvfBV`
**Explorer:** https://explorer.solana.com/address/D9KdRFUG4mZ3gqgDSF8mdfDpJk7qKHsmDn8g3dRsvfBV?cluster=devnet
