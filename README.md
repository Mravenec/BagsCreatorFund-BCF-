# 🎟️ BagsCreatorFund (BCF)

> **"The Infrastructure for Trustless Creator Funding on Solana."**

BagsCreatorFund (BCF) is a decentralized, on-chain funding protocol designed for the **Bags Hackathon**. It enables creators to bootstrap projects by providing an upfront prize (The "Bait") to attract community funding through highly transparent, trustless raffles.

---

## 🚀 Hackathon Submission Details

- **App Name**: BagsCreatorFund (BCF)
- **Category**: Creator Finance (CreatorFi)
- **Track**: Bags Ecosystem Innovation / Creator Finance
- **Token Integration**: $BAGS, USDC.
- **GitHub**: [Link to this repository]
- **Website**: [Demo URL]
- **Contact**: [@BagsHackathon](https://x.com/BagsHackathon)

---

## 💡 The "Bait-and-Fund" Model

BCF turns traditional fundraising into a high-stakes participation event:
1. **Creator Bait**: The creator locks the prize (e.g., $100 USDC) into a dedicated **Vault PDA**.
2. **Trustless Activation**: The Smart Contract verifies the balance and activates the round automatically. No manual intervention.
3. **Smart Distribution**: 
   - **Winner Found**: Participant takes the Prize; Creator takes 100% of Ticket Revenue.
   - **No Winner (Unsold Slot)**: Creator takes **Everything** (Prize + Ticket Revenue), rewarding the creator for the "bait" risk.

---

## 🛠️ Advanced Technical Architecture

### 1. Trustless On-Chain Activation
Unlike basic raffles, BCF contracts are the source of truth. The `activate_raffle` instruction performs an on-chain verification of the `Vault PDA` balance. If the creator hasn't fully funded the prize, the round cannot start.

### 2. CEX Bridge (Web2 User-Friendly)
BCF solves the "Centralized Exchange problem" for Binance and Coinbase users:
- **Unique Vault PDAs**: Each raffle has a unique on-chain vault address, eliminating mapping errors.
- **Source Identification**: Creators can specify a "Source Wallet" for deposits without needing to connect a Web3 wallet (Zero-Touch Flow).
- **Instructional UI**: The platform provides clear instructions on exactly how much to send (Prize + Fees) to trigger activation.

### 3. Verifiable Randomness
Powered by **Switchboard On-Demand**. The winning number (0-99) is generated via a VDF-based oracle, ensuring even the creator cannot predict the outcome.

---

## 💎 Bags Ecosystem Integration
- **$BAGS Native**: Designed to use $BAGS as the primary currency for high-tier raffles.
- **Bags SDK**: Fully integrated for potential token launching and creator profiles.
- **Creator Royalties**: Revenue is distributed directly to creators, empowering the "Bags Creator" economy.

---

## 🛡️ Security & Transparency
- **Immutable State**: Once a raffle is active, prize amounts and ticket prices are locked.
- **Escrow-as-a-Service**: Every round is siloed in its own PDA (Program Derived Address).
- **Public Audit Trail**: All funding and winner reveals are verifiable on the Solana Explorer.

---

## 📖 How to Use

### For Creators:
1. Click **"Initialize New Round"**.
2. Set your prize pool, ticket cost, and duration.
3. Decide whether to show a donation address for winners.
4. Fund the **Vault PDA** provided by the system.
5. Once funded, the round goes **LIVE** automatically.

### For Participants:
1. **Web3**: Connect Phantom/Solflare and buy a slot directly.
2. **CEX Bridge**: If you only have Binance/Coinbase, follow the instructions to send the exact ticket fee to the raffle address. The protocol node detects the transaction and assigns you a slot.

---

## 🎬 Demo
- **Demo Video**: [3-5 Minute Walkthrough Placeholder]
- **Live Platform**: [Vercel/Netlify URL Placeholder]

---
*Built for the Bags Hackathon. Empowering creators through on-chain game theory.*
