import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { IS_MAINNET, NETWORK } from './constants.js';

export const RPC_URL    = import.meta.env.VITE_SOLANA_RPC
  || (IS_MAINNET ? 'https://api.mainnet-beta.solana.com' : 'https://api.devnet.solana.com');

export { NETWORK };
export const connection = new Connection(RPC_URL, 'confirmed');

// ─── Explorer links (network-aware) ──────────────────────────────────────────
const cluster = IS_MAINNET ? '' : '?cluster=devnet';
export const explorerTx   = (sig)  => `https://explorer.solana.com/tx/${sig}${cluster}`;
export const explorerAddr = (addr) => `https://explorer.solana.com/address/${addr}${cluster}`;
export const solscanTx    = (sig)  => IS_MAINNET
  ? `https://solscan.io/tx/${sig}`
  : `https://solscan.io/tx/${sig}?cluster=devnet`;

export const shortAddr = (a = '', n = 4) => `${String(a).slice(0,n)}…${String(a).slice(-n)}`;
export const fmtSOL    = (n) => `${Number(n).toFixed(4)} SOL`;

// ─── Balance ──────────────────────────────────────────────────────────────────
export async function getSOLBalance(pubkey) {
  try {
    return (await connection.getBalance(new PublicKey(pubkey))) / LAMPORTS_PER_SOL;
  } catch { return 0; }
}

// ─── Airdrop (DevNet only) ────────────────────────────────────────────────────
export async function requestAirdrop(pubkey, sol = 2) {
  if (IS_MAINNET) throw new Error('Airdrop not available on Mainnet');
  const sig = await connection.requestAirdrop(new PublicKey(pubkey), sol * LAMPORTS_PER_SOL);
  await connection.confirmTransaction(sig, 'confirmed');
  return sig;
}

export function isValidKey(str) {
  try { new PublicKey(str); return true; } catch { return false; }
}
