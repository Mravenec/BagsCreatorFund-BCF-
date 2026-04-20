# BagsCreatorFund

> **Bags Hackathon 2025** — On-chain creator funding rounds powered by Bags × Solana DevNet

---

## What is BagsCreatorFund?

BagsCreatorFund is a decentralized creator funding platform where:

- Creators launch a **Bags token** as their project identity
- They run **funding rounds** — 100 positions, each backed by SOL
- Every position purchase distributes **project tokens at a fixed rate**
- **2% of every sale** goes to the project **treasury** automatically
- At round end, a **verifiable on-chain draw** picks the winning position
- If a participant holds it → they win the full prize pool
- If no one holds it → the full pool goes to the **project treasury**
- The creator can **withdraw from treasury** at any time (transparently)
- Creators can run **multiple campaigns** reusing the same token

---

## Bags Integration

| Feature | Integration |
|---|---|
| Token creation | `POST /token-launch/create-token-info` |
| Fee structures | 4 real modes from Bags docs (2%, 0.25%→1%, 1%→0.25%, 10%) |
| Token trading | Links to `bags.fm/token/{mint}` |
| API health check | Live ping on app load |
| Multi-campaign | Same token reused across all campaigns |

---

## Payment Methods

| Method | How |
|---|---|
| Phantom / Solflare | Connect → click position → sign TX |
| Any DevNet address | Send SOL + memo → auto-detected (polling) |
| Binance / Coinbase | Same (mainnet version) |

---

## Quick Start

```bash
unzip bagscreator.zip && cd bagscreator
npm install
npm run dev
```

Then open `http://localhost:5173`

### Setup for DevNet
1. Phantom → Settings → Developer Settings → **Devnet**
2. Dashboard → **Airdrop 2 SOL**
3. **Create Token** → set name, symbol, fee structure
4. **Create Campaign** → set prize, position price, duration
5. Campaign page → **Deposit prize** to activate
6. Click any position to participate
7. When time ends → **Resolve Round**

---

## Environment Variables

```env
VITE_BAGS_API_KEY=your_key_here
VITE_BAGS_API_BASE=https://public-api-v2.bags.fm/api/v1
VITE_SOLANA_RPC=https://api.devnet.solana.com
VITE_NETWORK=devnet
```

---

## Project Structure

```
src/
├── lib/
│   ├── bags.js        # Bags API calls
│   ├── solana.js      # DevNet utilities
│   ├── store.js       # Data layer (tokens, campaigns, treasury)
│   └── constants.js   # SOL price, fee modes, config
├── components/
│   ├── Layout.jsx
│   ├── CampaignCard.jsx
│   └── Toast.jsx
└── pages/
    ├── HomePage.jsx
    ├── ExplorePage.jsx
    ├── CreateTokenPage.jsx    # Step 1: Bags token
    ├── CreateCampaignPage.jsx # Step 2: funding round
    ├── CampaignPage.jsx       # Positions grid + payment flows
    └── DashboardPage.jsx      # Treasury + withdrawal management
```

---

Built for **Bags Hackathon 2025** · discord.gg/bagsapp · @BagsHackathon
