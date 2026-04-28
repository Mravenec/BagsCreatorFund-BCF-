// ─── Network detection ────────────────────────────────────────────────────────
export const NETWORK     = import.meta.env.VITE_NETWORK    || 'devnet';
export const IS_MAINNET  = NETWORK === 'mainnet';
export const IS_DEVNET   = !IS_MAINNET;

// ─── SOL price reference (live fetch in bags.js; this is the fallback) ────────
export const SOL_PRICE_USDC = 145;
export const toUSDC   = (sol)  => (Number(sol) * SOL_PRICE_USDC).toFixed(2);
export const fromUSDC = (usdc) => (Number(usdc) / SOL_PRICE_USDC).toFixed(4);

// ─── Native mint addresses ────────────────────────────────────────────────────
export const SOL_MINT    = 'So11111111111111111111111111111111111111112'; // wrapped SOL
export const USDC_MINT   = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

// ─── BCF program IDs (patched by deploy.sh) ──────────────────────────────────
export const BCF_PROGRAM_ID_DEVNET   = import.meta.env.VITE_BCF_PROGRAM_ID_DEVNET
  || 'ELarLMHYVxR2TndqEc6kHUSvwRyZUPHJ5BHFcD7yQtcJ';
export const BCF_PROGRAM_ID_MAINNET  = import.meta.env.VITE_BCF_PROGRAM_ID_MAINNET
  || 'ELarLMHYVxR2TndqEc6kHUSvwRyZUPHJ5BHFcD7yQtcJ'; // update after mainnet deploy
export const BCF_PROGRAM_ID          = IS_MAINNET ? BCF_PROGRAM_ID_MAINNET : BCF_PROGRAM_ID_DEVNET;

// ─── Treasury config ──────────────────────────────────────────────────────────
export const TREASURY_FEE_PCT = 2; // 2% of each position sale → treasury

// ─── Token economy ────────────────────────────────────────────────────────────
export const TOKENS_PER_SOL = 1_000_000; // 1 SOL = 1M project tokens

// ─── Bags fee modes ──────────────────────────────────────────────────────────
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
    desc: '0.25% during bonding curve to attract early volume, then 1% after graduation.',
    creatorEarns: '~0.5% per trade',
    recommended: false,
  },
  {
    id: 'a7c8e1f2-3d4b-5a6c-9e0f-1b2c3d4e5f6a',
    name: 'High Early / Low After',
    short: '1% → 0.25%',
    desc: '1% while on bonding curve for maximum early revenue, then lower 0.25% post-graduation.',
    creatorEarns: '~0.5% per trade',
    recommended: false,
  },
  {
    id: '48e26d2f-0a9d-4625-a3cc-c3987d874b9e',
    name: 'High Flat (10%)',
    short: '10% / 10%',
    desc: '10% on all trades. Maximum fee revenue with 50% compounding into pool post-graduation.',
    creatorEarns: '5% per trade',
    recommended: false,
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

export const TOTAL_POSITIONS = 100;

// ─── Watcher HTTP service ──────────────────────────────────────────────────────
// In dev: uses Vite proxy → /watcher/* → localhost:3001 (works on WSL2, Docker, etc.)
// In prod: set VITE_WATCHER_URL to your deployed watcher URL (e.g. https://watcher.myapp.com)
export const WATCHER_URL = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_WATCHER_URL)
  ? import.meta.env.VITE_WATCHER_URL
  : '/watcher';

// ─── CEX payment fee buffer ────────────────────────────────────────────────────
// Exchanges charge 0.001–0.02 SOL withdrawal fee. We recommend sending
// position_price + CEX_FEE_BUFFER_SOL to guarantee the vault receives full price.
export const CEX_FEE_BUFFER_SOL = 0.01; // 0.01 SOL buffer for exchange fees
