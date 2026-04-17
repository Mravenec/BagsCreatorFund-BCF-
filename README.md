# 🎟️ BagsCreatorFund (BCF)

> **"The Infrastructure for Trustless Creator Funding on Solana."**

BagsCreatorFund (BCF) is a decentralized, on-chain funding protocol designed for the **Bags Hackathon**. It enables creators to bootstrap projects by providing an upfront prize (The "Bait") to attract community funding through highly transparent, trustless raffles.

---

## 🚀 Hackathon Submission Details

- **App Name**: BagsCreatorFund (BCF)
- **Category**: Creator Finance (CreatorFi)
- **Token Integration**: $BAGS, USDC.
- **Track**: Bags Ecosystem Innovation
- **Differentiator**: 100% Trustless Activation & CEX-Compatible Payouts.

---

## 💡 The "Bait-and-Fund" Model

BCF turns traditional fundraising into a high-stakes participation event:
1. **Creator Bait**: The creator locks the prize (e.g., $100 USDC) into a dedicated **Vault PDA**.
2. **Trustless Activation**: The Smart Contract verifies the balance and activates the round. No middleman needed.
3. **Smart Distribution**: 
   - **Winner Found**: Participant takes the Prize; Creator takes 100% of Ticket Revenue.
   - **No Winner (Unsold Slot)**: Creator takes **Everything** (Prize + Ticket Revenue).

---

## 🛠️ Advanced Technical Architecture

### 1. Trustless On-Chain Activation
Unlike basic raffles, BCF contracts are the source of truth. The `activate_raffle` instruction performs an on-chain verification of the `Vault PDA` balance. If the creator hasn't fully funded the prize, the round cannot start.

### 2. CEX Bridge (Web2 User-Friendly)
BCF solves the "Centralized Exchange problem" for Binance and Coinbase users:
- **Unique Vault PDAs**: Each raffle has a unique on-chain vault address, eliminating mapping errors.
- **On-Chain Payout Registration**: Users without Web3 wallets can register their "Destination Wallet" on-chain during the participation flow, ensuring prizes are sent automatically to their exchange/payout address.
- **Real-Time Funding Status**: The UI displays exactly how much is missing ("Faltan $XX.XX USDC") by monitoring the ledger directly.

### 3. Verifiable Randomness
Powered by **Switchboard On-Demand**. The winning number (0-99) is generated via a VDF-based oracle, ensuring even the creator cannot predict the outcome.

---

## 💎 Bags Ecosystem Integration
- **$BAGS Native**: Designed to use $BAGS as the primary currency for high-tier raffles.
- **Creator Royalties**: Revenue is distributed directly to creators, empowering the "Bags Creator" economy.
- **Trustless Refunds**: If a raffle isn't funded within the 24-hour window, creators can withdraw their funds trustlessly.

---

## 📦 Project Structure
```text
BagsCreatorFund (BCF)/
├── programs/           # Solana Anchor Program (Rust)
├── src/                # React (Neo-Glassmorphism UI)
├── src/components/     # Modular 10x10 Matrix & UI Kits
├── src/bcf_core.json   # Synchronized IDL
└── README.md           # Documentation
```

---

## 🛡️ Security & Transparency
- **Immutable State**: Once a raffle is active, prize amounts and ticket prices are locked.
- **Escrow-as-a-Service**: Every round is siloed in its own PDA (Program Derived Address).
- **Public Audit Trail**: All funding and winner reveals are verifiable on the Solana Explorer.

---

## 🎬 Demo & Contact
- **Website**: [Demo URL Placeholder]
- **Bags Profile**: [Bags Link Placeholder]
- **X (Twitter)**: [@BagsHackathon](https://x.com/BagsHackathon)

---
*Built for the Bags Hackathon. Empowering creators through on-chain game theory.*
