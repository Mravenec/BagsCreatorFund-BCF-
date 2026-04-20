// ─── Price reference (DevNet demo — in production use Pyth oracle) ─────────────
export const SOL_PRICE_USDC = 145; // 1 SOL ≈ $145 USDC
export const toUSDC = (sol) => (Number(sol) * SOL_PRICE_USDC).toFixed(2);
export const fromUSDC = (usdc) => (Number(usdc) / SOL_PRICE_USDC).toFixed(4);

// ─── Treasury config ──────────────────────────────────────────────────────────
// Each position purchase contributes this % to the project treasury
export const TREASURY_FEE_PCT = 2; // 2% of each position sale → treasury

// ─── Token economy ────────────────────────────────────────────────────────────
// Fixed token distribution rate — never changes during a campaign
export const TOKENS_PER_SOL = 1_000_000; // 1 SOL = 1M project tokens

// ─── Bags fee modes — from docs.bags.fm/how-to-guides/customize-token-fees ───
export const FEE_MODES = [
  {
    id: 'fa29606e-5e48-4c37-827f-4b03d58ee23d',
    name: 'Standard (2% flat)',
    short: '2% / 2%',
    desc: 'Flat 2% on all trades. You earn 1%, Bags protocol earns 1%. Simple and predictable.',
    creatorEarns: '1% per trade',
    recommended: true,
  },
  {
    id: 'd16d3585-6488-4a6c-9a6f-e6c39ca0fda3',
    name: 'Low Early / High After',
    short: '0.25% → 1%',
    desc: '0.25% during bonding curve to attract early volume, then 1% after graduation with compounding.',
    creatorEarns: '~0.5% per trade',
  },
  {
    id: 'a7c8e1f2-3d4b-5a6c-9e0f-1b2c3d4e5f6a',
    name: 'High Early / Low After',
    short: '1% → 0.25%',
    desc: '1% while on bonding curve for maximum early revenue, then lower 0.25% post-graduation.',
    creatorEarns: '~0.5% per trade',
  },
  {
    id: '48e26d2f-0a9d-4625-a3cc-c3987d874b9e',
    name: 'High Flat (10%)',
    short: '10% / 10%',
    desc: '10% on all trades. Maximum fee revenue with 50% compounding into pool post-graduation.',
    creatorEarns: '5% per trade',
  },
];

export const CATEGORIES = [
  { value: 'tech',      label: '⚡ Tech & Dev'    },
  { value: 'art',       label: '🎨 Art & Design'  },
  { value: 'music',     label: '🎵 Music'          },
  { value: 'game',      label: '🎮 Games'          },
  { value: 'community', label: '🌐 Community'      },
  { value: 'defi',      label: '💎 DeFi Protocol'  },
  { value: 'content',   label: '📹 Content'        },
  { value: 'other',     label: '✨ Other'          },
];

export const DURATIONS = [
  { value: 1,   label: '1 hour (demo)'  },
  { value: 6,   label: '6 hours'        },
  { value: 24,  label: '24 hours'       },
  { value: 72,  label: '3 days'         },
  { value: 168, label: '7 days'         },
];

export const TOTAL_POSITIONS = 100; // always 00–99
