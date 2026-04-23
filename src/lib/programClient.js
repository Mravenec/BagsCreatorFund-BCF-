/**
 * programClient.js — BagsCreatorFund on-chain client
 */
console.log(">>> [BCF] programClient.js cargado correctamente <<<");

import { Buffer } from 'buffer';
import process from 'process';

if (typeof window !== 'undefined') {
  window.Buffer = Buffer;
  window.process = process;
}
if (typeof globalThis !== 'undefined') {
  globalThis.Buffer = Buffer;
  globalThis.process = process;
}

import { Program, AnchorProvider, BN } from '@coral-xyz/anchor';
import { PublicKey, SystemProgram, LAMPORTS_PER_SOL, SYSVAR_SLOT_HASHES_PUBKEY } from '@solana/web3.js';
import IDL from './idl.json';

// Polyfill Buffer for Anchor compatibility
if (typeof window !== 'undefined' && !window.Buffer) {
  window.Buffer = Buffer;
}

const decodeString = (bytes) => {
  if (!bytes) return '';
  // Flatten 2D array if needed
  const flatBytes = Array.isArray(bytes[0]) ? bytes.flat() : bytes;
  const text = new TextDecoder().decode(new Uint8Array(flatBytes));
  return text.replace(/\0/g, '').trim();
};

// ─── Program ID ────────────────────────────────────────────────────────────────
// IMPORTANT: Replace this after running `anchor deploy` in the anchor/ directory
export const PROGRAM_ID = new PublicKey('Rx1XswVLMPFAw48m2hVbKeM3eJYkZWNLe1ER5QzLg3L');

// ─── PDA Derivation ────────────────────────────────────────────────────────────
export function getProjectPDA(creator) {
  if (!creator) throw new Error("getProjectPDA: creator is required");
  const creatorPub = typeof creator === 'string' ? new PublicKey(creator) : creator;
  return PublicKey.findProgramAddressSync(
    [Buffer.from('project'), creatorPub.toBuffer()],
    PROGRAM_ID
  );
}

export function getCampaignPDA(creatorPubkey, index) {
  if (!creatorPubkey) throw new Error("getCampaignPDA: creatorPubkey is required");
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from('campaign'),
      creatorPubkey.toBuffer(),
      new BN(index).toArrayLike(Buffer, 'le', 8)
    ],
    PROGRAM_ID
  );
}

// ─── Program instance ──────────────────────────────────────────────────────────
export function getProgram(provider) {
  return new Program(IDL, PROGRAM_ID, provider);
}

// ─── Instructions ──────────────────────────────────────────────────────────────

/**
 * Initialize or fetch the project account for a creator.
 * Idempotent: if project already exists, returns its data.
 */
export async function initializeProject(provider, { tokenMint, feeModeName }) {
  try {
    console.log("[BCF] initializeProject START");
    console.log("[BCF] Token mint:", tokenMint);
    console.log("[BCF] Fee mode:", feeModeName);
    
    const program = getProgram(provider);
    console.log("[BCF] Program obtained successfully");
    
    const creator = provider.wallet?.publicKey;
    if (!creator) {
      throw new Error("Wallet not connected: provider.wallet.publicKey is undefined");
    }
    
    const [projectPDA] = getProjectPDA(creator);
    console.log("[BCF] Project PDA:", projectPDA.toBase58());

    // Check if already initialized
    try {
      console.log("[BCF] Checking if project already exists...");
      const existing = await program.account.projectAccount.fetch(projectPDA);
      console.log("[BCF] Project already exists, returning existing");
      return { projectPDA, account: existing, isNew: false };
    } catch (fetchErr) {
      console.log("[BCF] Project not initialized, creating new one:", fetchErr.message || fetchErr);
      // Not initialized — create it
    }

  console.log("[BCF] Creating initializeProject transaction...");
    // Defensive check for tokenMint
    let mintPub;
    try {
      mintPub = new PublicKey(tokenMint);
    } catch (e) {
      console.warn("[BCF] Invalid tokenMint provided, using fallback:", tokenMint);
      mintPub = new PublicKey("11111111111111111111111111111111");
    }

    const tx = await program.methods
      .initializeProject(mintPub, feeModeName)
      .accounts({
        project:       projectPDA,
        creator:       creator,
        systemProgram: SystemProgram.programId,
      })
      .rpc({ commitment: 'confirmed' });
    
    console.log("[BCF] Transaction successful:", tx);
    return { projectPDA, tx, isNew: true };
    
  } catch (error) {
    console.error("[BCF] initializeProject CRITICAL ERROR:", error.message || error);
    if (error.stack) console.error("[BCF] Stack Trace:", error.stack);
    throw error;
  }
}

/**
 * Create a new campaign on-chain.
 * Returns { campaignPDA, tx, account }
 */
export async function createCampaignOnChain(provider, {
  prizeLamports,
  positionPriceLamports,
  tokensPerPosition,
  durationSeconds,
  title,
  description,
}) {
  const program  = getProgram(provider);
  const creator  = provider.wallet.publicKey;
  const [projectPDA] = getProjectPDA(creator);

  // Fetch current campaign count to derive next PDA
  const projectAccount = await program.account.projectAccount.fetch(projectPDA);
  const campaignIndex  = projectAccount.campaignCount.toNumber();

  const [campaignPDA] = getCampaignPDA(creator, campaignIndex);

  const tx = await program.methods
    .createCampaign(
      new BN(prizeLamports),
      new BN(positionPriceLamports),
      new BN(tokensPerPosition),
      new BN(durationSeconds),
      title,
      description,
    )
    .accounts({
      campaign:      campaignPDA,
      project:       projectPDA,
      creator:       creator,
      systemProgram: SystemProgram.programId,
    })
    .rpc({ commitment: 'confirmed' });

  const account = await program.account.campaignAccount.fetch(campaignPDA);
  return { campaignPDA, tx, account, campaignIndex };
}

/**
 * Creator funds the campaign (deposits prize SOL → activates it).
 */
export async function fundCampaignOnChain(provider, { campaignPDA }) {
  const program = getProgram(provider);
  const creator = provider.wallet.publicKey;

  const tx = await program.methods
    .fundCampaign()
    .accounts({
      campaign:      new PublicKey(campaignPDA),
      creator:       creator,
      systemProgram: SystemProgram.programId,
    })
    .rpc({ commitment: 'confirmed' });

  const account = await program.account.campaignAccount.fetch(new PublicKey(campaignPDA));
  return { tx, account };
}

/**
 * Wallet user buys a specific position (0–99).
 */
export async function buyPositionOnChain(provider, { campaignPDA, positionIndex }) {
  const program  = getProgram(provider);
  const buyer    = provider.wallet.publicKey;
  const campaign = await program.account.campaignAccount.fetch(new PublicKey(campaignPDA));
  const [projectPDA] = getProjectPDA(new PublicKey(campaign.creator));

  const tx = await program.methods
    .buyPosition(positionIndex)
    .accounts({
      campaign:      new PublicKey(campaignPDA),
      project:       projectPDA,
      buyer:         buyer,
      systemProgram: SystemProgram.programId,
    })
    .rpc({ commitment: 'confirmed' });

  const updatedCampaign = await program.account.campaignAccount.fetch(new PublicKey(campaignPDA));
  return { tx, account: updatedCampaign };
}

/**
 * Creator records an external (CEX) payment on-chain.
 * Called after creator verifies the SOL arrived in their wallet.
 */
export async function recordExternalPaymentOnChain(provider, {
  campaignPDA,
  positionIndex,
  payer,  // PublicKey of the CEX user (string or PublicKey)
}) {
  const program  = getProgram(provider);
  const authority = provider.wallet.publicKey;
  const campaign = await program.account.campaignAccount.fetch(new PublicKey(campaignPDA));
  const [projectPDA] = getProjectPDA(new PublicKey(campaign.creator));

  const tx = await program.methods
    .recordExternalPayment(positionIndex, new PublicKey(payer))
    .accounts({
      campaign:  new PublicKey(campaignPDA),
      project:   projectPDA,
      authority: authority,
    })
    .rpc({ commitment: 'confirmed' });

  const updatedCampaign = await program.account.campaignAccount.fetch(new PublicKey(campaignPDA));
  return { tx, account: updatedCampaign };
}

/**
 * Resolve the campaign — picks winning position from Solana slot hash.
 * Can be called by anyone after the deadline.
 */
export async function resolveCampaignOnChain(provider, { campaignPDA }) {
  const program = getProgram(provider);

  const tx = await program.methods
    .resolveCampaign()
    .accounts({
      campaign:   new PublicKey(campaignPDA),
      slotHashes: SYSVAR_SLOT_HASHES_PUBKEY,
    })
    .rpc({ commitment: 'confirmed' });

  const account = await program.account.campaignAccount.fetch(new PublicKey(campaignPDA));
  return { tx, account };
}

/**
 * Winner claims their prize.
 */
export async function claimPrizeOnChain(provider, { campaignPDA }) {
  const program = getProgram(provider);
  const winner  = provider.wallet.publicKey;

  const tx = await program.methods
    .claimPrize()
    .accounts({
      campaign:      new PublicKey(campaignPDA),
      winner:        winner,
      systemProgram: SystemProgram.programId,
    })
    .rpc({ commitment: 'confirmed' });

  return { tx };
}

/**
 * Route unclaimed prize to project treasury.
 */
export async function routeToTreasuryOnChain(provider, { campaignPDA }) {
  const program   = getProgram(provider);
  const campaign  = await program.account.campaignAccount.fetch(new PublicKey(campaignPDA));
  const [projectPDA] = getProjectPDA(new PublicKey(campaign.creator));

  const tx = await program.methods
    .routeNoWinnerToTreasury()
    .accounts({
      campaign:      new PublicKey(campaignPDA),
      project:       projectPDA,
      systemProgram: SystemProgram.programId,
    })
    .rpc({ commitment: 'confirmed' });

  const updatedProject = await program.account.projectAccount.fetch(projectPDA);
  return { tx, project: updatedProject };
}

/**
 * Creator withdraws from project treasury.
 */
export async function withdrawTreasuryOnChain(provider, { amountLamports }) {
  const program  = getProgram(provider);
  const creator  = provider.wallet.publicKey;
  const [projectPDA] = getProjectPDA(creator);

  const tx = await program.methods
    .withdrawTreasury(new BN(amountLamports))
    .accounts({
      project: projectPDA,
      creator: creator,
    })
    .rpc({ commitment: 'confirmed' });

  const updatedProject = await program.account.projectAccount.fetch(projectPDA);
  return { tx, project: updatedProject };
}

// ─── Read helpers ──────────────────────────────────────────────────────────────

export async function fetchProject(provider, creatorPubkey) {
  if (!provider || !creatorPubkey) return null;
  try {
    const program = getProgram(provider);
    const [projectPDA] = getProjectPDA(creatorPubkey);
    console.log("[BCF] fetchProject at:", projectPDA.toBase58());
    const account = await program.account.projectAccount.fetch(projectPDA);
    return { pda: projectPDA.toBase58(), ...account };
  } catch (e) {
    console.warn("[BCF] No project found for:", creatorPubkey);
    return null;
  }
}

export async function fetchCampaign(provider, campaignPDA) {
  const program = getProgram(provider);
  try {
    console.log("[BCF] Fetching campaign at PDA:", campaignPDA);
    const account = await program.account.campaignAccount.fetch(new PublicKey(campaignPDA));
    return { pda: campaignPDA, ...account };
  } catch (e) {
    console.error("[BCF] Error fetching campaign:", campaignPDA, e.message || e);
    return null;
  }
}

/** Fetch all campaigns for a creator by iterating their campaign count */
export async function fetchCreatorCampaigns(provider, creatorPubkey) {
  if (!provider || !creatorPubkey) return [];
  try {
    console.log("[BCF] fetchCreatorCampaigns START for:", creatorPubkey);
    const project = await fetchProject(provider, creatorPubkey);
    if (!project) return [];

    const campaigns = [];
    const count = Number(project.campaignCount);
    console.log(`[BCF] Creator has ${count} campaigns`);

    for (let i = 0; i < count; i++) {
      try {
        const [pda] = getCampaignPDA(creatorPubkey, i);
        const campaign = await fetchCampaign(provider, pda.toBase58());
        if (campaign) campaigns.push({ ...campaign, pda: pda.toBase58() });
      } catch (inner) {
        console.warn(`[BCF] Error fetching campaign index ${i}:`, inner.message);
      }
    }
    return campaigns;
  } catch (e) {
    console.error("[BCF] fetchCreatorCampaigns CRITICAL ERROR:", e.message || e);
    return [];
  }
}

/** Fetch ALL campaigns (uses getProgramAccounts) */
export async function fetchAllCampaigns(connection) {
  console.log("[BCF] fetchAllCampaigns START");
  try {
    if (!connection) {
      console.error("[BCF] No connection provided to fetchAllCampaigns");
      return [];
    }
    console.log("[BCF] Connection endpoint:", connection.rpcEndpoint);
    console.log("[BCF] Program ID:", PROGRAM_ID?.toBase58 ? PROGRAM_ID.toBase58() : "INVALID_TYPE");
    
    const program = new Program(IDL, PROGRAM_ID, { connection });
    console.log("[BCF] Anchor Program initialized successfully");
    
    const accounts = await program.account.campaignAccount.all();
    console.log(`[BCF] Found ${accounts.length} campaigns on-chain`);
    
    return accounts.map(a => campaignAccountToDisplay(a.publicKey.toBase58(), a.account));
  } catch (e) {
    console.error('[BCF] fetchAllCampaigns CRITICAL ERROR:', e.message || e);
    if (e.stack) console.error("[BCF] Stack Trace:", e.stack);
    return [];
  }
}

// ─── Conversion helpers ────────────────────────────────────────────────────────
/** Convert on-chain CampaignAccount to the display format used by UI components */
export function campaignAccountToDisplay(pda, account, tokenInfo = null) {
  const flatPositions = (account.positions || []).flat();
  const positions = flatPositions.map((p, i) => ({
    index:         i,
    owner:         p.filled === 1 ? p.owner.toBase58() : null,
    txSignature:   null,
    source:        'wallet',
    memo:          null,
    tokensReceived: account.tokensPerPosition?.toNumber() || 0,
    filled:        p.filled === 1,
    purchasedAt:   null,
  }));

  const prizeSOL           = (account.prizeLamports?.toNumber() || 0) / LAMPORTS_PER_SOL;
  const positionPriceSOL   = (account.positionPriceLamports?.toNumber() || 0) / LAMPORTS_PER_SOL;
  const totalCollectedSOL  = (account.totalCollected?.toNumber() || 0) / LAMPORTS_PER_SOL;
  const deadline           = account.deadline?.toNumber() * 1000 || null;
  const winning            = account.winningPosition === 255 ? null : account.winningPosition;

  return {
    id:                pda,
    pda:               pda,
    isOnChain:         true,
    tokenMint:         account.tokenMint?.toBase58() || '',
    tokenSymbol:       tokenInfo?.symbol || '???',
    tokenName:         tokenInfo?.name   || 'Unknown',
    creatorWallet:     account.creator?.toBase58() || '',
    title:             decodeString(account.title),
    description:       decodeString(account.description),
    prizeSOL,
    positionPriceSOL,
    tokensPerPosition: account.tokensPerPosition?.toNumber() || 0,
    durationHours:     Math.round((account.durationSeconds?.toNumber() || 0) / 3600),
    deadline,
    status:            ['pending', 'active', 'settled'][account.status] || 'pending',
    positions,
    totalCollectedSOL,
    treasuryContribution: (account.treasuryContribution?.toNumber() || 0) / LAMPORTS_PER_SOL,
    winningPosition:   winning,
    winningBlockHash:  account.winningSlot?.toString() || null,
    hasWinner:         account.hasWinner === 1,
    winnerWallet:      account.hasWinner === 1 ? account.winner?.toBase58() : null,
    totalPayout:       prizeSOL + totalCollectedSOL,
    createdAt:         account.createdAt?.toNumber() * 1000 || Date.now(),
    campaignIndex:     account.campaignIndex?.toNumber() || 0,
  };
}

// ─── Utility helpers (migrated from store.js) ──────────────────────────────────
export const fmtPos    = (i)  => String(i).padStart(2, '0');
export const posStatus = (c)  => (c.positions || []).filter(p => p.filled || p.owner).length;
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
