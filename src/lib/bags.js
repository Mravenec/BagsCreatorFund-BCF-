/**
 * bags.js — Bags API v2 integration (corrected)
 * docs.bags.fm | public-api-v2.bags.fm/api/v1
 *
 * Token Launch v2 FLOW (4 steps):
 *   1. POST /token-launch/create-token-info  (FormData, NOT JSON)
 *      → { tokenMint, tokenLaunch: { uri } }
 *
 *   2. POST /fee-share/config                (JSON, required by v2)
 *      → { meteoraConfigKey, needsCreation, transactions }
 *      If needsCreation=true → wallet signs + sends those TXs first
 *
 *   3. POST /token-launch/create-launch-transaction  (JSON, new fields)
 *      → base58-encoded VersionedTransaction
 *
 *   4. Wallet signs → send to Mainnet
 */

import {
  Connection,
  VersionedTransaction,
  Transaction,
} from '@solana/web3.js';

const BASE = import.meta.env.VITE_BAGS_API_BASE || 'https://public-api-v2.bags.fm/api/v1';
const KEY  = import.meta.env.VITE_BAGS_API_KEY;

// Bags tokens live on Mainnet (Meteora DBC)
const MAINNET_RPC = 'https://api.mainnet-beta.solana.com';
export const mainnetConnection = new Connection(MAINNET_RPC, 'confirmed');

// Auth header (no Content-Type — let fetch set it for FormData)
const authHeader = () => ({ 'x-api-key': KEY });
// Auth + JSON header
const jsonHeader = () => ({ 'Content-Type': 'application/json', 'x-api-key': KEY });

// ─── Health check ─────────────────────────────────────────────────────────────
export async function pingBags() {
  try {
    const r = await fetch('https://public-api-v2.bags.fm/ping');
    return (await r.json()).message === 'pong';
  } catch { return false; }
}

// ─── Parse API error cleanly ──────────────────────────────────────────────────
async function parseError(r) {
  try {
    const d = await r.json();
    // Try various error field names
    return d?.message || d?.error || d?.reason || JSON.stringify(d);
  } catch {
    return `HTTP ${r.status}`;
  }
}

// ─── STEP 1: Register token metadata on Bags ─────────────────────────────────
// API requires multipart/form-data (NOT application/json)
// Returns: { tokenMint, metadataUri (tokenLaunch.uri) }
export async function createBagsTokenInfo({
  name, symbol, description, imageUrl = '',
  twitter = '', telegram = '', website = '',
}) {
  const form = new FormData();
  form.append('name',        name.slice(0, 32));
  form.append('symbol',      symbol.toUpperCase().replace('$', '').slice(0, 10));
  form.append('description', description.slice(0, 1000));
  // Include image either as URL or omit if empty
  if (imageUrl) form.append('imageUrl', imageUrl);
  if (twitter)  form.append('twitter',  twitter);
  if (telegram) form.append('telegram', telegram);
  if (website)  form.append('website',  website);

  const r = await fetch(`${BASE}/token-launch/create-token-info`, {
    method: 'POST',
    headers: authHeader(), // DO NOT set Content-Type — browser sets boundary automatically
    body: form,
  });

  if (!r.ok) {
    const msg = await parseError(r);
    throw new Error(`Bags API error ${r.status}: ${msg}`);
  }

  const data = await r.json();
  // v2 response: { success, response: { tokenMint, tokenMetadata, tokenLaunch: { uri, ... } } }
  const resp = data?.response;
  const tokenMint  = resp?.tokenMint;
  const metadataUri = resp?.tokenLaunch?.uri || resp?.tokenMetadata;
  if (!tokenMint) throw new Error('Bags API did not return tokenMint');
  if (!metadataUri) throw new Error('Bags API did not return metadataUri');

  return { tokenMint, metadataUri };
}

// ─── STEP 2: Create fee share config (required in v2) ────────────────────────
// Returns: { meteoraConfigKey, needsCreation, transactions, bundles }
export async function createBagsFeeShareConfig({
  payer,      // creator wallet pubkey string
  baseMint,   // tokenMint from step 1
  bagsConfigType = 'fa29606e-5e48-4c37-827f-4b03d58ee23d', // Standard 2%
}) {
  const r = await fetch(`${BASE}/fee-share/config`, {
    method: 'POST',
    headers: jsonHeader(),
    body: JSON.stringify({
      payer,
      baseMint,
      claimersArray:     [payer],   // creator gets 100% of fees
      basisPointsArray:  [10000],   // 100% in basis points
      bagsConfigType,
    }),
  });

  if (!r.ok) {
    const msg = await parseError(r);
    throw new Error(`Bags fee-share/config error ${r.status}: ${msg}`);
  }

  const data = await r.json();
  const resp = data?.response;
  return {
    meteoraConfigKey: resp?.meteoraConfigKey,
    needsCreation:    resp?.needsCreation ?? true,
    transactions:     resp?.transactions || [],  // array of { blockhash, transaction }
    bundles:          resp?.bundles || [],        // array of arrays
  };
}

// ─── STEP 2b: Sign and send fee share config transactions ─────────────────────
// Only needed when needsCreation = true
export async function sendFeeShareConfigTxs(wallet, feeShareResult) {
  const allTxs = [
    ...feeShareResult.transactions,
    ...(feeShareResult.bundles?.flat() || []),
  ];

  for (const txObj of allTxs) {
    const txBytes = Buffer.from(txObj.transaction, 'base64');
    let tx;
    try {
      tx = VersionedTransaction.deserialize(txBytes);
    } catch {
      tx = Transaction.from(txBytes);
    }

    // Update blockhash if needed
    if (txObj.blockhash?.blockhash) {
      if (tx instanceof VersionedTransaction) {
        tx.message.recentBlockhash = txObj.blockhash.blockhash;
      } else {
        tx.recentBlockhash = txObj.blockhash.blockhash;
      }
    }

    const signed = tx instanceof VersionedTransaction
      ? await wallet.signTransaction(tx)
      : await wallet.signTransaction(tx);

    const sig = await mainnetConnection.sendRawTransaction(signed.serialize(), {
      skipPreflight: false,
      maxRetries: 5,
    });
    await mainnetConnection.confirmTransaction({
      signature: sig,
      blockhash: txObj.blockhash?.blockhash,
      lastValidBlockHeight: txObj.blockhash?.lastValidBlockHeight,
    }, 'confirmed');
  }
}

// ─── STEP 3: Create token launch transaction ──────────────────────────────────
// Returns the signed base58-encoded VersionedTransaction from Bags API
export async function createBagsLaunchTransaction({
  metadataUri,   // IPFS URI from step 1
  tokenMint,     // mint from step 1
  creator,       // wallet pubkey (PublicKey or string)
  meteoraConfigKey, // from step 2
  initialBuyLamports = 0, // optional initial buy
}) {
  const r = await fetch(`${BASE}/token-launch/create-launch-transaction`, {
    method: 'POST',
    headers: jsonHeader(),
    body: JSON.stringify({
      ipfs:               metadataUri,
      tokenMint:          tokenMint,
      wallet:             creator.toString(),
      initialBuyLamports: initialBuyLamports,
      configKey:          meteoraConfigKey,
    }),
  });

  if (!r.ok) {
    const msg = await parseError(r);
    throw new Error(`Bags launch-transaction error ${r.status}: ${msg}`);
  }

  const data = await r.json();
  // v2 response: { success, response: "<base58 encoded serialized TX>" }
  const txBase58 = data?.response;
  if (!txBase58 || typeof txBase58 !== 'string') {
    throw new Error('Bags API did not return a transaction');
  }
  return { transaction: txBase58, mint: tokenMint };
}

// ─── STEP 4: Sign and send the launch TX to Mainnet ──────────────────────────
export async function executeBagsLaunchTransaction(wallet, txBase58) {
  if (!wallet?.signTransaction) throw new Error('Wallet does not support signTransaction');

  // v2 returns base58 VersionedTransaction
  let tx;
  try {
    const bs58 = await import('bs58').then(m => m.default || m);
    const txBytes = bs58.decode(txBase58);
    tx = VersionedTransaction.deserialize(txBytes);
  } catch {
    // Fallback: try base64 legacy TX (v1 compat)
    try {
      tx = Transaction.from(Buffer.from(txBase58, 'base64'));
    } catch {
      throw new Error('Could not decode Bags launch transaction');
    }
  }

  const { blockhash, lastValidBlockHeight } = await mainnetConnection.getLatestBlockhash('finalized');
  if (tx instanceof VersionedTransaction) {
    tx.message.recentBlockhash = blockhash;
  } else {
    tx.recentBlockhash = blockhash;
    tx.feePayer = wallet.publicKey;
  }

  const signedTx = await wallet.signTransaction(tx);
  const sig = await mainnetConnection.sendRawTransaction(signedTx.serialize(), {
    skipPreflight: false,
    preflightCommitment: 'confirmed',
    maxRetries: 5,
  });
  await mainnetConnection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
  return sig;
}

// ─── Combined: complete 4-step token launch ───────────────────────────────────
export async function launchBagsToken(wallet, {
  name, symbol, description, imageUrl = '',
  twitter = '', telegram = '', website = '',
  bagsConfigType = 'fa29606e-5e48-4c37-827f-4b03d58ee23d',
  initialBuyLamports = 0,
}) {
  const creatorStr = wallet.publicKey.toString();

  // Step 1: metadata
  const { tokenMint, metadataUri } = await createBagsTokenInfo({
    name, symbol, description, imageUrl, twitter, telegram, website,
  });

  // Step 2: fee share config
  const feeShareResult = await createBagsFeeShareConfig({
    payer: creatorStr,
    baseMint: tokenMint,
    bagsConfigType,
  });

  // Step 2b: sign fee share config TXs (only if new config needed)
  if (feeShareResult.needsCreation &&
      (feeShareResult.transactions.length > 0 || feeShareResult.bundles.length > 0)) {
    await sendFeeShareConfigTxs(wallet, feeShareResult);
  }

  const meteoraConfigKey = feeShareResult.meteoraConfigKey;
  if (!meteoraConfigKey) throw new Error('Bags API did not return meteoraConfigKey');

  // Step 3: create launch TX
  const { transaction, mint } = await createBagsLaunchTransaction({
    metadataUri,
    tokenMint,
    creator: creatorStr,
    meteoraConfigKey,
    initialBuyLamports,
  });

  // Step 4: sign + broadcast
  const signature = await executeBagsLaunchTransaction(wallet, transaction);
  markMintAsReal(mint);
  return { mint, signature, metadataUri };
}

// ─── Read helpers ─────────────────────────────────────────────────────────────
export async function getBagsToken(mint) {
  try {
    const r = await fetch(`${BASE}/token/${mint}`, { headers: authHeader() });
    if (!r.ok) return null;
    const d = await r.json();
    return d?.response || d;
  } catch { return null; }
}

// ─── URL builders ─────────────────────────────────────────────────────────────
export const bagsTokenUrl = (mint) => `https://bags.fm/token/${mint}`;
export const bagsTradeUrl = (mint) => `https://bags.fm/trade/${mint}`;

// ─── Track real vs simulated mints ───────────────────────────────────────────
export function markMintAsReal(mint) {
  try {
    const list = JSON.parse(localStorage.getItem('bcf_real_mints') || '[]');
    if (!list.includes(mint)) { list.push(mint); localStorage.setItem('bcf_real_mints', JSON.stringify(list)); }
  } catch {}
}

export function isRealMint(mint) {
  try {
    return JSON.parse(localStorage.getItem('bcf_real_mints') || '[]').includes(mint);
  } catch { return false; }
}

// ─── Token market data ────────────────────────────────────────────────────────
// Fetches price, volume, market cap, and holder count from Bags API
export async function getTokenMarketData(mint) {
  if (!mint || mint.length < 32) return null;
  try {
    const r = await fetch(`${BASE}/token/${mint}`, { headers: authHeader() });
    if (!r.ok) return null;
    const d = await r.json();
    const t = d?.response || d;
    return {
      price:     t?.price       || t?.priceUsd     || 0,
      volume24h: t?.volume24h   || t?.volume        || 0,
      marketCap: t?.marketCap   || t?.mcap          || 0,
      holders:   t?.holders     || t?.holderCount   || 0,
      symbol:    t?.symbol      || '???',
      name:      t?.name        || 'Unknown',
      image:     t?.image       || t?.logo          || null,
    };
  } catch { return null; }
}

// ─── Bags SDK Trade: get quote for SOL → token swap ──────────────────────────
export async function getReinvestQuote(solLamports, tokenMint) {
  if (!solLamports || !tokenMint) throw new Error('Missing params');
  const params = new URLSearchParams({
    inputMint:   'So11111111111111111111111111111111111111112', // wrapped SOL
    outputMint:  tokenMint,
    amount:      String(solLamports),
    slippageMode: 'auto',
  });
  const r = await fetch(`${BASE}/trade/quote?${params}`, { headers: authHeader() });
  if (!r.ok) {
    const msg = await parseError(r);
    throw new Error(`Bags trade/quote error ${r.status}: ${msg}`);
  }
  const d = await r.json();
  return d?.response || d;
}

// ─── Bags SDK Trade: create swap transaction ──────────────────────────────────
export async function createReinvestTransaction(quoteResponse, userPublicKey) {
  const r = await fetch(`${BASE}/trade/swap`, {
    method: 'POST',
    headers: jsonHeader(),
    body: JSON.stringify({
      quoteResponse,
      userPublicKey: userPublicKey.toString(),
    }),
  });
  if (!r.ok) {
    const msg = await parseError(r);
    throw new Error(`Bags trade/swap error ${r.status}: ${msg}`);
  }
  const d = await r.json();
  return d?.response || d; // { transaction: VersionedTransaction, computeUnitLimit, ... }
}

// ─── Execute reinvestment: SOL → creator token via Bags swap ─────────────────
// wallet must be the connected Phantom/Solflare wallet adapter
export async function executeReinvest(wallet, solLamports, tokenMint) {
  if (!wallet?.signTransaction) throw new Error('Wallet does not support signTransaction');

  // 1. Get quote
  const quote = await getReinvestQuote(solLamports, tokenMint);
  if (!quote) throw new Error('Could not get swap quote from Bags');

  // 2. Create swap transaction
  const swapData = await createReinvestTransaction(quote, wallet.publicKey);

  // 3. Decode + sign + send on Mainnet
  let tx;
  try {
    const bs58Mod = await import('bs58');
    const bs58    = bs58Mod.default || bs58Mod;
    const { VersionedTransaction } = await import('@solana/web3.js');
    const raw = typeof swapData.transaction === 'string'
      ? bs58.decode(swapData.transaction)
      : Buffer.from(swapData.transaction, 'base64');
    tx = VersionedTransaction.deserialize(raw);
  } catch {
    const { Transaction } = await import('@solana/web3.js');
    tx = Transaction.from(Buffer.from(swapData.transaction, 'base64'));
  }

  const { blockhash, lastValidBlockHeight } = await mainnetConnection.getLatestBlockhash('finalized');
  if (tx.message) {
    tx.message.recentBlockhash = blockhash; // VersionedTransaction
  } else {
    tx.recentBlockhash = blockhash;
    tx.feePayer = wallet.publicKey;
  }

  const signed = await wallet.signTransaction(tx);
  const sig = await mainnetConnection.sendRawTransaction(signed.serialize(), {
    skipPreflight: false,
    maxRetries: 5,
  });
  await mainnetConnection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
  return { signature: sig, quote };
}

// ─── Get claimable fee positions ─────────────────────────────────────────────
export async function getClaimablePositions(walletPublicKey) {
  try {
    const r = await fetch(
      `${BASE}/fee-claiming/claimable-positions?wallet=${walletPublicKey}`,
      { headers: authHeader() }
    );
    if (!r.ok) return [];
    const d = await r.json();
    return d?.response || d || [];
  } catch { return []; }
}

// ─── Get claim transactions v3 ────────────────────────────────────────────────
export async function getClaimTransactionsV3(walletPublicKey, tokenMint) {
  try {
    const r = await fetch(`${BASE}/fee-claiming/claim-transactions`, {
      method: 'POST',
      headers: jsonHeader(),
      body: JSON.stringify({
        wallet: walletPublicKey.toString(),
        baseMint: tokenMint,
      }),
    });
    if (!r.ok) return [];
    const d = await r.json();
    return d?.response || [];
  } catch { return []; }
}

// ─── Execute claim transactions ───────────────────────────────────────────────
export async function executeClaimTransactions(wallet, claimTxs) {
  const results = [];
  for (const txObj of claimTxs) {
    try {
      const txBytes = Buffer.from(txObj.transaction, 'base64');
      let tx;
      try { tx = VersionedTransaction.deserialize(txBytes); }
      catch { tx = Transaction.from(txBytes); }

      if (txObj.blockhash?.blockhash) {
        if (tx instanceof VersionedTransaction) tx.message.recentBlockhash = txObj.blockhash.blockhash;
        else tx.recentBlockhash = txObj.blockhash.blockhash;
      }

      const signed = await wallet.signTransaction(tx);
      const sig = await mainnetConnection.sendRawTransaction(signed.serialize(), { skipPreflight: false, maxRetries: 5 });
      await mainnetConnection.confirmTransaction({
        signature: sig,
        blockhash: txObj.blockhash?.blockhash,
        lastValidBlockHeight: txObj.blockhash?.lastValidBlockHeight,
      }, 'confirmed');
      results.push({ success: true, signature: sig });
    } catch (e) {
      results.push({ success: false, error: e.message });
    }
  }
  return results;
}

// ─── Fee Share Admin: get admin list ─────────────────────────────────────────
export async function getFeeShareAdminList(walletPublicKey) {
  try {
    const r = await fetch(`${BASE}/fee-share/admin/list?wallet=${walletPublicKey}`, { headers: authHeader() });
    if (!r.ok) return [];
    const d = await r.json();
    return d?.response || [];
  } catch { return []; }
}

// ─── Fee Share Admin: update config (change claimers/percentages post-launch) ─
export async function updateFeeShareConfig(wallet, { baseMint, claimersArray, basisPointsArray }) {
  const payer = wallet.publicKey.toString();
  const r = await fetch(`${BASE}/fee-share/admin/update-config`, {
    method: 'POST',
    headers: jsonHeader(),
    body: JSON.stringify({ baseMint, basisPointsArray, claimersArray, payer }),
  });
  if (!r.ok) { const msg = await parseError(r); throw new Error(`update-config error ${r.status}: ${msg}`); }
  const data = await r.json();
  const txs = data?.response?.transactions || [];
  // Sign and send each TX
  for (const txObj of txs) {
    const txBytes = Buffer.from(txObj.transaction, 'base64');
    let tx;
    try { tx = VersionedTransaction.deserialize(txBytes); } catch { tx = Transaction.from(txBytes); }
    if (txObj.blockhash?.blockhash) {
      if (tx instanceof VersionedTransaction) tx.message.recentBlockhash = txObj.blockhash.blockhash;
      else tx.recentBlockhash = txObj.blockhash.blockhash;
    }
    const signed = await wallet.signTransaction(tx);
    const sig = await mainnetConnection.sendRawTransaction(signed.serialize(), { skipPreflight: false, maxRetries: 5 });
    await mainnetConnection.confirmTransaction({ signature: sig, blockhash: txObj.blockhash?.blockhash, lastValidBlockHeight: txObj.blockhash?.lastValidBlockHeight }, 'confirmed');
  }
  return true;
}

// ─── Fee Share Admin: transfer admin authority to new wallet ─────────────────
export async function transferFeeShareAdmin(wallet, { baseMint, newAdmin }) {
  const currentAdmin = wallet.publicKey.toString();
  const r = await fetch(`${BASE}/fee-share/admin/transfer-tx`, {
    method: 'POST',
    headers: jsonHeader(),
    body: JSON.stringify({ baseMint, currentAdmin, newAdmin, payer: currentAdmin }),
  });
  if (!r.ok) { const msg = await parseError(r); throw new Error(`transfer-admin error ${r.status}: ${msg}`); }
  const data = await r.json();
  const txObj = data?.response;
  if (!txObj?.transaction) throw new Error('No transaction returned');
  const txBytes = Buffer.from(txObj.transaction, 'base64');
  let tx;
  try { tx = VersionedTransaction.deserialize(txBytes); } catch { tx = Transaction.from(txBytes); }
  if (txObj.blockhash?.blockhash) {
    if (tx instanceof VersionedTransaction) tx.message.recentBlockhash = txObj.blockhash.blockhash;
    else tx.recentBlockhash = txObj.blockhash.blockhash;
  }
  const signed = await wallet.signTransaction(tx);
  const sig = await mainnetConnection.sendRawTransaction(signed.serialize(), { skipPreflight: false, maxRetries: 5 });
  await mainnetConnection.confirmTransaction({ signature: sig, blockhash: txObj.blockhash?.blockhash, lastValidBlockHeight: txObj.blockhash?.lastValidBlockHeight }, 'confirmed');
  return sig;
}

// ─── Analytics: lifetime fees ────────────────────────────────────────────────
export async function getLifetimeFees(tokenMint) {
  try {
    const r = await fetch(`${BASE}/analytics/lifetime-fees?tokenMint=${tokenMint}`, { headers: authHeader() });
    if (!r.ok) return null;
    const d = await r.json();
    return d?.response ?? null;
  } catch { return null; }
}

// ─── Analytics: token creators ───────────────────────────────────────────────
export async function getTokenCreators(tokenMint) {
  try {
    const r = await fetch(`${BASE}/analytics/creators?tokenMint=${tokenMint}`, { headers: authHeader() });
    if (!r.ok) return [];
    const d = await r.json();
    return d?.response || [];
  } catch { return []; }
}

// ─── Analytics: claim stats ───────────────────────────────────────────────────
export async function getClaimStats(tokenMint) {
  try {
    const r = await fetch(`${BASE}/analytics/claim-stats?tokenMint=${tokenMint}`, { headers: authHeader() });
    if (!r.ok) return null;
    const d = await r.json();
    return d?.response ?? null;
  } catch { return null; }
}

// ─── Dexscreener: check availability ─────────────────────────────────────────
export async function checkDexscreenerAvailability(tokenMint) {
  try {
    const r = await fetch(`${BASE}/dexscreener/order/availability?tokenMint=${tokenMint}`, { headers: authHeader() });
    if (!r.ok) return { available: false };
    const d = await r.json();
    return d?.response || { available: false };
  } catch { return { available: false }; }
}

// ─── Dexscreener: create order ────────────────────────────────────────────────
export async function createDexscreenerOrder(wallet, { tokenMint, orderType }) {
  const payer = wallet.publicKey.toString();
  const r = await fetch(`${BASE}/dexscreener/order`, {
    method: 'POST',
    headers: jsonHeader(),
    body: JSON.stringify({ payer, tokenMint, orderType }),
  });
  if (!r.ok) { const msg = await parseError(r); throw new Error(`dexscreener order error ${r.status}: ${msg}`); }
  const d = await r.json();
  return d?.response;
}

// ─── Incorporation: create payment ───────────────────────────────────────────
export async function createIncorporationPayment(wallet, { tokenMint }) {
  const payer = wallet.publicKey.toString();
  const r = await fetch(`${BASE}/incorporate/payment`, {
    method: 'POST',
    headers: jsonHeader(),
    body: JSON.stringify({ payer, tokenMint }),
  });
  if (!r.ok) { const msg = await parseError(r); throw new Error(`incorporation payment error ${r.status}: ${msg}`); }
  const d = await r.json();
  return d?.response;
}

// ─── Incorporation: submit details ───────────────────────────────────────────
export async function submitIncorporationDetails({
  orderUUID, paymentSignature, projectName, tokenAddress,
  founders, incorporationShareBasisPoint, preferredCompanyNames,
  category, twitterHandle,
}) {
  const r = await fetch(`${BASE}/incorporate`, {
    method: 'POST',
    headers: jsonHeader(),
    body: JSON.stringify({
      orderUUID, paymentSignature, projectName, tokenAddress,
      founders, incorporationShareBasisPoint,
      preferredCompanyNames, category, twitterHandle,
    }),
  });
  if (!r.ok) { const msg = await parseError(r); throw new Error(`incorporation submit error ${r.status}: ${msg}`); }
  const d = await r.json();
  return d?.success;
}

// ─── Incorporation: start process ────────────────────────────────────────────
export async function startIncorporation({ orderUUID, tokenAddress }) {
  const r = await fetch(`${BASE}/incorporate/start`, {
    method: 'POST',
    headers: jsonHeader(),
    body: JSON.stringify({ orderUUID, tokenAddress }),
  });
  if (!r.ok) { const msg = await parseError(r); throw new Error(`incorporation start error ${r.status}: ${msg}`); }
  const d = await r.json();
  return d?.success;
}

