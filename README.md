# BagsCreatorFund (BCF) v0.2 — Multi-Token Edition

**Bags Hackathon 2025 · Prize Pool $1M**

> Creator funding rounds on Solana. Multiple tokens per wallet. Each token = independent project with its own treasury and unlimited campaigns.

---

## What's New in v0.2

| Feature | v0.1 | v0.2 |
|---|---|---|
| Tokens per wallet | **1** (PDA collision) | **∞** (registry-indexed PDAs) |
| Projects per wallet | 1 | Unlimited |
| Treasury separation | 1 shared | Per-token isolated |
| Campaign association | Implicit | Explicit `project_index` |
| Registry account | ❌ | ✅ `CreatorRegistry` PDA |

---

## Architecture

```
CreatorRegistry  (PDA: ["registry", creator])
  └─ project_count: u64      ← auto-increments on each new token

ProjectAccount   (PDA: ["project", creator, project_index_le_bytes])
  ├─ project_index: u64      ← 0, 1, 2, 3, ...
  ├─ token_mint: Pubkey      ← Bags Mainnet mint address
  ├─ project_name / symbol
  ├─ campaign_count: u64
  └─ treasury_lamports: u64

CampaignAccount  (PDA: ["campaign", creator, campaign_index_le_bytes])
  ├─ project_index: u64      ← which project this campaign belongs to
  ├─ campaign_index: u64     ← global per creator
  └─ ... prize, positions, etc.
```

**Token lives on Solana Mainnet** (Bags/Meteora DBC).  
**Campaigns live on DevNet** (BCF smart contract).

---

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Add your API key to .env
cp .env.example .env
# VITE_BAGS_API_KEY=bags_prod_...

# 3. Launch (DevNet demo — no deployment needed)
npm run dev

# 4. Deploy your own on-chain program (optional)
bash scripts/deploy.sh
```

---

## Multi-Token Flow

### Creating a second (or third) token
1. Dashboard → **+ New Token**
2. Fill in token name, symbol, fee structure
3. Wallet signs → token minted on Bags Mainnet
4. BCF auto-creates `ProjectAccount` at next available index
5. Back to dashboard — all your tokens appear as cards

### Creating a campaign for a specific token
1. Dashboard → click **+ Campaign** on any token card, OR
2. Navigate to `/create-campaign?project=0` (replace 0 with project index)
3. If you have multiple tokens, a radio-button selector appears

### Treasury per token
- Each `ProjectAccount` has its own `treasury_lamports` balance
- 2% of every position sale is credited to the parent project's treasury
- Withdraw independently per token from the Dashboard

---

## Smart Contract

### New Accounts

#### `CreatorRegistry`
```
PDA seeds: ["registry", creator]
Space: 8 + 32 + 8 = 48 bytes
Fields:
  creator: Pubkey
  project_count: u64
```
Auto-created on first `initialize_project` call (`init_if_needed`).

#### `ProjectAccount` (updated)
```
PDA seeds: ["project", creator, project_index_as_u64_le_bytes]
Space: 248 bytes
New fields vs v0.1:
  project_index: u64   ← identifies which of creator's tokens this is
  project_name:  [u8; 80]
  token_symbol:  [u8; 12]
```

#### `CampaignAccount` (updated)
```
Added field: project_index: u64  ← links back to parent project
```

### Updated Instructions

| Instruction | Change |
|---|---|
| `initialize_project` | Adds `registry` account + `name` + `symbol` args; auto-increments counter |
| `create_campaign` | First arg is now `project_index: u64` |
| `withdraw_treasury` | Identifies project by `project.project_index` in PDA |

---

## Environment Variables

```env
VITE_BAGS_API_KEY=bags_prod_...           # Your Bags API key
VITE_BAGS_API_BASE=https://public-api-v2.bags.fm/api/v1
VITE_SOLANA_RPC=https://api.devnet.solana.com
VITE_NETWORK=devnet
```

---

## Key Technical Decisions

**Why `init_if_needed` on the registry?**  
Allows `initialize_project` to be a single atomic transaction: if no registry exists, create it AND create the first project in one call. Subsequent calls just read the existing registry.

**Why is `campaign_index` global (not per-project)?**  
Keeps `CampaignAccount` PDA derivation simple. A creator's N-th campaign always lives at PDA `["campaign", creator, N]` regardless of which project it belongs to. The `project_index` field inside `CampaignAccount` handles the association.

**Why fixed byte arrays instead of Rust `String` for name/symbol?**  
Fixed size = predictable account space. No runtime serialization edge cases. `deploy.sh` generates correct IDL from Rust structs automatically on rebuild.

---

## Hackathon Judges

This project demonstrates:
- ✅ Real Bags API integration (token creation with `create-launch-transaction`)
- ✅ Multi-token support (unlimited projects per wallet)
- ✅ Transparent on-chain treasury per token
- ✅ Randomized winner selection via Solana slot hashes (verifiable, trustless)
- ✅ Clean separation of Mainnet (token) and DevNet (campaigns)

**Live at:** [Vercel deployment URL]  
**Program ID:** `Rx1XswVLMPFAw48m2hVbKeM3eJYkZWNLe1ER5QzLg3L`  
**Explorer:** https://explorer.solana.com/address/Rx1XswVLMPFAw48m2hVbKeM3eJYkZWNLe1ER5QzLg3L?cluster=devnet
