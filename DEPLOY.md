# BagsCreatorFund — Deployment Guide

## The Problem (Before This)
The project was using `localStorage` — data only existed in your browser.
Now it uses a **real Anchor smart contract on Solana DevNet**.

## What Changed
| Before | After |
|---|---|
| `localStorage` (fake data) | Anchor program accounts (on-chain) |
| No real transactions | Every action = real Solana TX |
| Data lost on refresh | Data permanent on DevNet |
| JS random winner | Slot hash randomness (verifiable) |

---

## 🚀 Quick Start: The "One-Command" Deploy

To build the program, fix all BPF dependencies, deploy to DevNet, and launch the frontend automatically, run this single command in **WSL**:

```bash
# Go to the project root
cd "/mnt/c/Users/kcamp/CascadeProjects/solanaProject/BagsCreatorFund(BCF)"

# Run the magic script
bash scripts/deploy.sh
```

---

## 🛠️ What the Script Does for You
1.  **Validates Tools**: Checks for Solana, Anchor, and Node.
2.  **Stabilizes BPF**: Automatically pins dependencies (`borsh`, `indexmap`, etc.) to work with the Solana Rust 1.75 toolchain.
3.  **Fixes Stack Limits**: Ensures the program uses Heap (Box) instead of Stack to avoid `Stack offset exceeded` errors.
4.  **Deploys to DevNet**: Uploads the smart contract to Solana.
5.  **Syncs Frontend**: Updates `idl.json` and `programClient.js` with the new Program ID.
6.  **Launches App**: Runs `npm install` and `npm run dev` automatically.

---

## 🎒 Prerequisites (Install Once in WSL)

```bash
# 1. Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup component add rustfmt

# 2. Solana CLI
sh -c "$(curl -sSfL https://release.solana.com/v1.18.0/install)"

# 3. Anchor CLI
cargo install --git https://github.com/coral-xyz/anchor avm --locked
avm install 0.29.0
avm use 0.29.0

# Verify
anchor --version  # should show 0.29.0
```

---

## Step 1: Set up DevNet wallet

```bash
# Generate a new keypair for DevNet
solana-keygen new --outfile ~/.config/solana/id.json

# Point to DevNet
solana config set --url devnet

# Get your address
solana address

# Airdrop SOL for deployment fees
solana airdrop 4

# Check balance
solana balance
```

---

## Step 2: Deploy the program

```bash
cd bagscreator/anchor

# Install Node deps for Anchor tests
npm install

# Build the program
anchor build

# This generates a NEW Program ID — copy it!
anchor keys list
# Output: bags_creator_fund: <YOUR_NEW_PROGRAM_ID>
```

**IMPORTANT: Update the Program ID in 3 places:**

**1. `anchor/programs/bags-creator-fund/src/lib.rs` (line 1):**
```rust
declare_id!("YOUR_NEW_PROGRAM_ID_HERE");
```

**2. `anchor/Anchor.toml`:**
```toml
[programs.devnet]
bags-creator-fund = "YOUR_NEW_PROGRAM_ID_HERE"
```

**3. `src/lib/programClient.js` (line 1):**
```js
export const PROGRAM_ID = new PublicKey('YOUR_NEW_PROGRAM_ID_HERE');
```

**4. `src/lib/idl.json` (last line, metadata.address):**
```json
"address": "YOUR_NEW_PROGRAM_ID_HERE"
```

Then rebuild and deploy:
```bash
anchor build
anchor deploy --provider.cluster devnet
```

Expected output:
```
Deploying cluster: https://api.devnet.solana.com
Program Id: YOUR_NEW_PROGRAM_ID_HERE
Deploy success
```

---

## Step 3: Update frontend and run

```bash
cd .. # back to bagscreator/

# Install frontend deps (including @coral-xyz/anchor)
npm install

# Start dev server
npm run dev
```

---

## Step 4: Test the full flow

1. **Open Phantom** → Settings → Developer Settings → **Devnet**
2. Go to `http://localhost:5173`
3. Click **Dashboard** → **Airdrop 2 SOL** (get test SOL)
4. Click **Create Token** → fill form → creates `ProjectAccount` on-chain ✓
5. Click **Create Campaign** → creates `CampaignAccount` on-chain ✓
6. On campaign page → **Deposit Prize** → funds are in the program account ✓
7. Click any position (00–99) → **real SOL TX in Phantom** ✓
8. After deadline → **Resolve Round** → winner from slot hash ✓

**Verify on Solana Explorer:**
- Every TX link opens `explorer.solana.com/tx/...?cluster=devnet`
- You can see the program instructions and account changes

---

## CEX / External Payment Flow

For users without Web3 wallet:

1. In the Buy dialog, switch to **"Address / Exchange"** tab
2. The deposit address shown is the **creator's wallet** (SOL goes there directly)
3. User sends SOL from Binance/Coinbase with the **memo** shown
4. Frontend polls DevNet every 5s for the incoming TX
5. When detected, creator calls **Record External Payment** (visible in dashboard)
6. This executes `recordExternalPayment` on-chain — position assigned, visible forever

---

## Architecture Summary

```
Creator
  └─ initialize_project() → ProjectAccount PDA (["project", creator])
  └─ create_campaign()    → CampaignAccount PDA (["campaign", creator, index])
  └─ fund_campaign()      → SOL → CampaignAccount (acts as vault)

Participant  
  └─ buy_position(i)      → SOL → CampaignAccount, PositionInfo[i] updated
  └─ CEX flow             → creator calls record_external_payment()

Resolve
  └─ resolve_campaign()   → winning = slotHash % 100, on-chain + public

Settlement
  └─ claim_prize()        → winner gets all SOL from CampaignAccount
  └─ route_no_winner()    → full pot → ProjectAccount (treasury)
  └─ withdraw_treasury()  → creator withdraws (event emitted, transparent)
```

---

## Bags Integration Points

| Feature | Implementation |
|---|---|
| Token linking | `initializeProject(tokenMint)` on-chain |
| Fee modes | Stored in `ProjectAccount.feeModeName` |
| Token URL | Links to `bags.fm/token/{mint}` |
| API health | Live ping on load |
| Trading fees | Earned off-chain by creator via Bags fee-share |

---

## Hackathon Submission Checklist

- [x] Project launched on Bags (create your token at bags.fm first)
- [x] App Icon: `/public/icon.svg`
- [x] GitHub: Open-source repo with this code
- [x] Site URL: Deploy to Vercel (`vercel --prod` from project root)
- [x] Category: Creator Tools / DeFi
- [x] Token: Linked from Bags.fm
- [x] Demo Video: Show full flow (3-5 min)
  - Create token → create campaign → deposit prize → buy position → resolve → claim

---

## Deploy to Vercel (public URL for submission)

```bash
npm install -g vercel
vercel --prod
# Paste the URL in your hackathon submission
```

Set environment variables in Vercel dashboard:
```
VITE_BAGS_API_KEY = bags_prod_NvTYIGgjDiUlNIYgRf3M0PcSL9XvGlYCGrEcrPvADrA
VITE_BAGS_API_BASE = https://public-api-v2.bags.fm/api/v1
VITE_SOLANA_RPC = https://api.devnet.solana.com
VITE_NETWORK = devnet
```
