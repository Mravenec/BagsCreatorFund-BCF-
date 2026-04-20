/**
 * store.js — localStorage data layer
 * Simulates on-chain state for DevNet demo.
 * In production: Anchor program accounts on Solana.
 *
 * Data shapes:
 *   Token:    { id, mint, name, symbol, description, purpose, imageUrl,
 *               creatorWallet, feeModeId, feeModeName, createdAt,
 *               treasury: { balanceSOL, totalEarned, withdrawals[] } }
 *
 *   Campaign: { id, tokenMint, tokenSymbol, creatorWallet,
 *               title, description, category,
 *               prizeSOL, positionPriceSOL, tokensPerPosition,
 *               totalPositions (100), durationHours, deadline,
 *               status: 'pending'|'active'|'settled'|'cancelled',
 *               positions[100], totalRaisedSOL, totalCollectedSOL,
 *               activationTx, winningPosition, winnerWallet,
 *               winningBlockHash, totalPayout, treasuryContribution,
 *               showDonation, donationAddress, createdAt }
 */

import { TOTAL_POSITIONS, TOKENS_PER_SOL, TREASURY_FEE_PCT } from './constants.js';

const TOKEN_KEY    = 'bcf_tokens_v1';
const CAMPAIGN_KEY = 'bcf_campaigns_v1';

// ─── Generic helpers ──────────────────────────────────────────────────────────
const load = (key) => { try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch { return []; } };
const save = (key, d) => localStorage.setItem(key, JSON.stringify(d));

// ─── TOKEN STORE ──────────────────────────────────────────────────────────────
export function getTokens()               { return load(TOKEN_KEY); }
export function getToken(mint)            { return load(TOKEN_KEY).find(t => t.mint === mint) || null; }
export function getCreatorTokens(wallet)  { return load(TOKEN_KEY).filter(t => t.creatorWallet === wallet); }

export function saveToken(token) {
  const all = load(TOKEN_KEY);
  const idx = all.findIndex(t => t.mint === token.mint);
  if (idx >= 0) all[idx] = token;
  else all.unshift(token);
  save(TOKEN_KEY, all);
  return token;
}

export function createToken({ name, symbol, description, purpose, imageUrl, feeModeId, feeModeName, creatorWallet, mint, metadataUri }) {
  const token = {
    mint: mint || `devnet_${symbol.toUpperCase()}_${Date.now()}`,
    metadataUri: metadataUri || '',
    name, symbol: symbol.toUpperCase(), description, purpose, imageUrl,
    feeModeId, feeModeName,
    creatorWallet,
    createdAt: Date.now(),
    treasury: {
      balanceSOL:    0,
      totalEarned:   0,
      withdrawals:   [],
    },
  };
  return saveToken(token);
}

export function addToTreasury(mint, solAmount) {
  const token = getToken(mint);
  if (!token) return null;
  token.treasury.balanceSOL  = (token.treasury.balanceSOL  || 0) + solAmount;
  token.treasury.totalEarned = (token.treasury.totalEarned || 0) + solAmount;
  return saveToken(token);
}

export function withdrawFromTreasury(mint, solAmount, txNote = '') {
  const token = getToken(mint);
  if (!token) return null;
  const actual = Math.min(solAmount, token.treasury.balanceSOL);
  token.treasury.balanceSOL -= actual;
  token.treasury.withdrawals.push({ amount: actual, timestamp: Date.now(), note: txNote });
  return saveToken(token);
}

// ─── CAMPAIGN STORE ────────────────────────────────────────────────────────────
export function getCampaigns()             { return load(CAMPAIGN_KEY); }
export function getCampaign(id)            { return load(CAMPAIGN_KEY).find(c => c.id === id) || null; }
export function getActiveCampaigns()       { return load(CAMPAIGN_KEY).filter(c => c.status === 'active'); }
export function getCreatorCampaigns(wallet){ return load(CAMPAIGN_KEY).filter(c => c.creatorWallet === wallet); }
export function getTokenCampaigns(mint)    { return load(CAMPAIGN_KEY).filter(c => c.tokenMint === mint); }

function saveCampaign(campaign) {
  const all = load(CAMPAIGN_KEY);
  const idx = all.findIndex(c => c.id === campaign.id);
  if (idx >= 0) all[idx] = campaign;
  else all.unshift(campaign);
  save(CAMPAIGN_KEY, all);
  return campaign;
}

export function updateCampaign(id, updates) {
  const all = load(CAMPAIGN_KEY);
  const idx = all.findIndex(c => c.id === id);
  if (idx < 0) return null;
  all[idx] = { ...all[idx], ...updates };
  save(CAMPAIGN_KEY, all);
  return all[idx];
}

export function createCampaign({ tokenMint, tokenSymbol, creatorWallet, title, description, category,
  prizeSOL, positionPriceSOL, durationHours, showDonation, donationAddress }) {

  const positions = Array.from({ length: TOTAL_POSITIONS }, (_, i) => ({
    index:          i,
    owner:          null,   // wallet address
    txSignature:    null,
    source:         null,   // 'wallet' | 'exchange'
    memo:           null,
    tokensReceived: 0,
    usdcValueAtPurchase: 0,
    purchasedAt:    null,
  }));

  const id = `cmp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  return saveCampaign({
    id,
    tokenMint,
    tokenSymbol,
    creatorWallet,
    title,
    description,
    category,
    prizeSOL:          Number(prizeSOL),
    positionPriceSOL:  Number(positionPriceSOL),
    tokensPerPosition: Math.floor(Number(positionPriceSOL) * TOKENS_PER_SOL),
    totalPositions:    TOTAL_POSITIONS,
    durationHours:     Number(durationHours),
    deadline:          null,  // set on activation
    status:            'pending',
    positions,
    totalRaisedSOL:    0,   // prize deposited
    totalCollectedSOL: 0,   // from position sales
    treasuryContribution: 0,
    showDonation:      Boolean(showDonation),
    donationAddress:   donationAddress || '',
    activationTx:      null,
    winningPosition:   null,
    winnerWallet:      null,
    winningBlockHash:  null,
    totalPayout:       null,
    createdAt:         Date.now(),
  });
}

// Activate: creator has deposited prize
export function activateCampaign(id, txSignature) {
  const c = getCampaign(id);
  if (!c) return null;
  return updateCampaign(id, {
    status:        'active',
    activationTx:  txSignature,
    totalRaisedSOL: c.prizeSOL,
    deadline:      Date.now() + c.durationHours * 3600 * 1000,
  });
}

// Record a position purchase
export function purchasePosition(campaignId, { index, wallet, txSignature, source, memo, usdcRef }) {
  const c = getCampaign(campaignId);
  if (!c)                           throw new Error('Campaign not found');
  if (c.status !== 'active')        throw new Error('Campaign is not active');
  if (c.positions[index].owner)     throw new Error(`Position ${fmtPos(index)} is already taken`);

  const tokensReceived = c.tokensPerPosition;
  const treasuryCut    = (c.positionPriceSOL * TREASURY_FEE_PCT) / 100;

  const positions = [...c.positions];
  positions[index] = {
    ...positions[index],
    owner:               wallet,
    txSignature,
    source,
    memo:                memo || null,
    tokensReceived,
    usdcValueAtPurchase: Number(usdcRef || 0),
    purchasedAt:         Date.now(),
  };

  const totalCollectedSOL = c.totalCollectedSOL + c.positionPriceSOL;
  const treasuryContribution = c.treasuryContribution + treasuryCut;

  // Credit treasury for this token
  addToTreasury(c.tokenMint, treasuryCut);

  return updateCampaign(campaignId, { positions, totalCollectedSOL, treasuryContribution });
}

// Settle the campaign: pick winning position from block hash
export function settleCampaign(campaignId, blockHash) {
  const c = getCampaign(campaignId);
  if (!c) throw new Error('Campaign not found');

  // Deterministic: hash → position index
  const hashNum        = parseInt(blockHash.replace('0x','').slice(-8), 16);
  const winningPosition = hashNum % TOTAL_POSITIONS;
  const winnerWallet   = c.positions[winningPosition].owner || null;
  const totalPot       = c.prizeSOL + c.totalCollectedSOL;

  let updates = {
    status:           'settled',
    settledAt:        Date.now(),
    winningPosition,
    winningBlockHash: blockHash,
    winnerWallet,
    totalPayout:      totalPot,
  };

  // No winner → full pot goes to treasury
  if (!winnerWallet) {
    addToTreasury(c.tokenMint, totalPot);
    updates.treasuryContribution = c.treasuryContribution + totalPot;
  }

  return updateCampaign(campaignId, updates);
}

export function deleteCampaign(id) {
  save(CAMPAIGN_KEY, load(CAMPAIGN_KEY).filter(c => c.id !== id));
}

// ─── Derived helpers ──────────────────────────────────────────────────────────
export const fmtPos    = (i)  => String(i).padStart(2, '0');
export const posStatus = (c)  => c.positions.filter(p => p.owner).length;
export const totalPot  = (c)  => (c.prizeSOL || 0) + (c.totalCollectedSOL || 0);
export const isExpired = (c)  => c.deadline && Date.now() > c.deadline;

export function timeLeft(deadline) {
  if (!deadline) return '—';
  const d = deadline - Date.now();
  if (d <= 0) return 'Ended';
  const h = Math.floor(d / 3600000);
  const m = Math.floor((d % 3600000) / 60000);
  const s = Math.floor((d % 60000)   / 1000);
  if (h > 0)   return `${h}h ${m}m`;
  if (m > 0)   return `${m}m ${s}s`;
  return `${s}s`;
}
