# 🎟️ BagsCreatorFund (BCF)

> **"The Future of Risk-Based Creator Funding on Solana."**

BagsCreatorFund (BCF) is a trustless, decentralized funding protocol launched on **Bags**. It empowers creators to bootstrap their own liquidity by launching self-funded raffles where they provide the prize capital upfront to attract community participation and royalties.

---

## 🚀 Hackathon Submission Details

- **App Name**: BagsCreatorFund (BCF)
- **Category**: Creator Finance / DeFi
- **Token Integration**: $BAGS (Native), SOL, USDC.
- **Track**: Bags Ecosystem Innovation
- **Status**: Development / Hackathon Entry 2026

---

## 💡 The Problem
Traditional crowdfunding often lacks excitement and direct incentives for small contributors. Creators need a way to gamify their fundraising while maintaining 100% transparency and trust.

## ✅ The BCF Solution
BCF introduces the **"Bait-and-Fund"** model:
1. **Creator Bait**: The creator locks a prize (e.g., $1000 in $BAGS) into a Solana PDA.
2. **Community Participation**: Users buy tickets (e.g., $5) for a chance to win the prize.
3. **Smart Payouts**: 
   - If a sold number wins: Participant takes the prize; Creator takes all ticket revenue.
   - If an unsold number wins: Creator takes **everything** (Original Prize + All Revenue).

---

## 🛠️ Architecture (Pure Web3)

### 1. Smart Contract (Anchor/Rust)
The core logic resides in a Solana Program. It handles:
- **Raffle PDAs**: Each raffle is an independent, secure account.
- **Escrow Vaults**: Funds are locked until the verifiable random draw.
- **Protocol Fees**: A 2.5% fee is distributed to the Bags ecosystem/treasury.

### 2. CEX Bridge (Web2.5 UX)
BCF is compatible with **Binance, Coinbase, and Phantom**.
- **Unique Deposit Addresses (PDA)**: Every "Intent to Create/Participate" generates a unique Solana address.
- **Mandatory Memo**: Users sending from CEXs use a mandatory memo (`raffle_id:user_id`) to map their payout identity.
- **Unassigned Queue**: Deposits without memos are held for manual verification via TXID.

### 3. Verifiable Randomness
Powered by **Switchboard VRF**. The winning number (00-99) is generated on-chain, preventing manipulation by the creator or the platform.

---

## 🌐 Network Configuration

To avoid conflicts during testing and deployment, BCF supports both environments:

### 🧪 Testnet / Devnet (Current)
- **RPC**: `https://api.devnet.solana.com`
- **Program ID**: `BCF...` (To be deployed)
- **VRF Authority**: Switchboard Devnet Oracle.
- **Purpose**: Risk-free testing of the 10x10 matrix and payout logic.

### 💎 Mainnet (Production)
- **RPC**: `https://api.mainnet-beta.solana.com`
- **Program ID**: `BCF...` (Pending Audit)
- **VRF Authority**: Switchboard Mainnet Oracle.
- **Purpose**: Real $BAGS funding and high-stakes creator participation.

---

## 🔁 User Journey

### For Creators
1. **Define**: Prize amount, ticket cost, and duration.
2. **Fund**: Send funds from Phantom or Binance to the generated PDA + required Memo.
3. **Activate**: Once confirmed on-chain, the raffle goes live to the Bags community.

### For Participants
1. **Select**: Choose a lucky number from the 00-99 matrix.
2. **Pay**: One-click buy via Phantom or direct transfer from CEX.
3. **Win**: Receive payouts automatically if your number is drawn by the Oracle.

---

## 💰 Fees & Sustainability
- **Protocol Fee**: 2.5% per ticket sold.
- **Creator Royalties**: Enabled via Bags SDK integration.
- **Anti-Ghosting**: Raffles not funded within 1 hour of creation are automatically cancelled and funds returned to the creator.

---

## 📦 Project Structure
```text
BagsCreatorFund (BCF)/
├── programs/           # Solana Anchor Program (Rust)
├── frontend/           # React + Vite (Neo-Glass UI)
├── tests/              # Anchor Integration Tests
├── target/             # Compiled BPF binaries
└── README.md           # You are here
```

---

## 🛡️ Trust & Security
- **Immutable Logic**: No admin can change raffle rules once activated.
- **Proof of Funds**: All prizes are escrowed before the first ticket is sold.
- **Transparent Randomness**: Verification possible on-chain via Switchboard.

---

## 🎬 Demo & Contact
- **Website**: [Site URL Placeholder]
- **GitHub**: [Repo URL Placeholder]
- **X (Twitter)**: [@BagsHackathon](https://x.com/BagsHackathon)
- **Demo Video**: [Coming Soon ...]

---
*Built with ❤️ for the Bags Hackathon 2026. Powered by Solana.*
