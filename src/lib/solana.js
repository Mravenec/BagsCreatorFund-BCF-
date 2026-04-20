import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';

export const RPC_URL    = import.meta.env.VITE_SOLANA_RPC || 'https://api.devnet.solana.com';
export const NETWORK    = import.meta.env.VITE_NETWORK    || 'devnet';
export const connection = new Connection(RPC_URL, 'confirmed');

export const shortAddr  = (a = '', n = 4) => `${String(a).slice(0,n)}…${String(a).slice(-n)}`;
export const explorerTx = (sig)  => `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
export const explorerAddr= (addr)=> `https://explorer.solana.com/address/${addr}?cluster=devnet`;

export async function getSOLBalance(pubkey) {
  try {
    return (await connection.getBalance(new PublicKey(pubkey))) / LAMPORTS_PER_SOL;
  } catch { return 0; }
}

export async function requestAirdrop(pubkey, sol = 2) {
  const sig = await connection.requestAirdrop(new PublicKey(pubkey), sol * LAMPORTS_PER_SOL);
  await connection.confirmTransaction(sig, 'confirmed');
  return sig;
}

export function isValidKey(str) {
  try { new PublicKey(str); return true; } catch { return false; }
}

export function fmtSOL(n) { return `${Number(n).toFixed(4)} SOL`; }
