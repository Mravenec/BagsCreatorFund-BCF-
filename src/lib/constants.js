// ─── Network detection ────────────────────────────────────────────────────────
export const NETWORK     = import.meta.env.VITE_NETWORK    || 'devnet';
export const IS_MAINNET  = NETWORK === 'mainnet';
export const IS_DEVNET   = !IS_MAINNET;

export let SOL_PRICE_USDC = 145;

// Fetch live SOL price from Binance API to keep SOL_PRICE_USDC real-time
async function fetchRealTimeSolPrice() {
  try {
    const response = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=SOLUSDT');
    const data = await response.json();
    if (data && data.price) {
      const price = parseFloat(data.price);
      if (!isNaN(price) && price > 0) {
        SOL_PRICE_USDC = price;
      }
    }
  } catch (error) {
    console.warn('Failed to fetch real-time SOL price:', error);
  }
}

// Initial fetch and interval (every 60 seconds)
fetchRealTimeSolPrice();
setInterval(fetchRealTimeSolPrice, 60000);

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

// ─── Bags fee modes (bagsConfigType UUIDs — official from docs.bags.fm) ───────
// These names match exactly what bags.fm/launch shows in the LAUNCH TYPE dropdown
export const FEE_MODES = [
  {
    id: 'fa29606e-5e48-4c37-827f-4b03d58ee23d',
    name: 'Founder Mode',
    uiLabel: 'Earn 1% of total trading volume',
    short: '2% / 2%',
    desc: '2% fees on all trades, pre and post migration. You earn 1% of total volume. Simple and predictable.',
    creatorEarns: '1% of total trading volume',
    recommended: true,
    compounding: '25% fee compounding post-migration',
  },
  {
    id: 'd16d3585-6488-4a6c-9a6f-e6c39ca0fda3',
    name: 'Low Early → High After',
    uiLabel: '0.25% pre-migration → 1% post-migration',
    short: '0.25% → 1%',
    desc: '0.25% fees during bonding curve to attract early volume, then 1% after graduation. 50% fee compounding post-migration.',
    creatorEarns: '~0.5% blended per trade',
    recommended: false,
    compounding: '50% fee compounding post-migration',
  },
  {
    id: 'a7c8e1f2-3d4b-5a6c-9e0f-1b2c3d4e5f6a',
    name: 'High Early → Low After',
    uiLabel: '1% pre-migration → 0.25% post-migration',
    short: '1% → 0.25%',
    desc: '1% fees while on bonding curve for maximum early revenue, then 0.25% post-graduation. 50% compounding post-migration.',
    creatorEarns: '~0.5% blended per trade',
    recommended: false,
    compounding: '50% fee compounding post-migration',
  },
  {
    id: '48e26d2f-0a9d-4625-a3cc-c3987d874b9e',
    name: 'Paper Hand Tax Mode',
    uiLabel: '10% tax with 50% added to LP',
    short: '10% / 10%',
    desc: '10% fees on all trades pre and post migration. 50% of fees added to liquidity pool. Discourages early selling.',
    creatorEarns: '5% per trade',
    recommended: false,
    compounding: '50% fee compounding post-migration',
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

// ─── Incorporation categories (matches Bags API enum) ─────────────────────────
export const INCORPORATION_CATEGORIES = [
  { value: 'AI',     label: '🤖 AI'            },
  { value: 'DEFI',   label: '💎 DeFi'          },
  { value: 'INFRA',  label: '⚙️ Infrastructure' },
  { value: 'GAMING', label: '🎮 Gaming'         },
  { value: 'NFT',    label: '🖼 NFT'            },
  { value: 'MEME',   label: '🐸 Meme'           },
  { value: 'RWA',    label: '🏢 RWA'            },
  { value: 'DEPIN',  label: '📡 DePIN'          },
  { value: 'LEGAL',  label: '⚖️ Legal'          },
];

// ─── Initial buy presets (mirrors bags.fm UI buttons) ────────────────────────
// SOL amounts shown as quick-select buttons on the launch form
export const INITIAL_BUY_PRESETS_SOL = [0, 0.1, 0.5, 1, 2.5];


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
// Extra SOL the user must send on top of the position price when paying via CEX.
// Covers:
//   • Exchange withdrawal fee (typically 0.0005–0.001 SOL taken by the exchange).
//   • Solana transaction fees for purchase, resolve, and push_prize.
// The "Safe Buffer" is set to 0.01 SOL (e.g. if price=0.1, user sends 0.11).
export const CEX_FEE_BUFFER_SOL = 0.01;

// Amount retained in the Burner Wallet to act as a "Browser Crank".
// This SOL is kept after purchase to automatically trigger resolve_campaign
// and push_prize when someone visits the page after the deadline.
export const CEX_CRANK_RESERVE_SOL = 0.005;

// Absolute minimum gas needed to proceed with buy_position (in SOL).
// If the exchange took a massive fee but we still have this, we proceed.
export const CEX_MIN_GAS_SOL = 0.001;

// Minimum refund amount (lamports). If excess < this after buying position,
// it's not worth paying another TX fee to refund — the tiny amount stays in
// the burner wallet (covering dust), otherwise a full refund is sent.
export const CEX_MIN_REFUND_LAMPORTS = 10_000; // ~0.00001 SOL threshold
