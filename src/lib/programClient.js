/**
 * programClient.js — BagsCreatorFund v0.2 on-chain client
 * Supports MULTIPLE projects (tokens) per wallet via CreatorRegistry.
 */

import { Buffer } from 'buffer';
import process from 'process';
if (typeof window    !== 'undefined') { window.Buffer    = Buffer; window.process    = process; }
if (typeof globalThis !== 'undefined') { globalThis.Buffer = Buffer; globalThis.process = process; }

import { Program, AnchorProvider, BN } from '@coral-xyz/anchor';
import {
  PublicKey, SystemProgram, LAMPORTS_PER_SOL, SYSVAR_SLOT_HASHES_PUBKEY,
} from '@solana/web3.js';
import IDL from './idl.json';
import { getBagsToken } from './bags.js';
import { BCF_PROGRAM_ID } from './constants.js';

// ─── Program ID (network-aware: devnet vs mainnet) ────────────────────────────
export const PROGRAM_ID = new PublicKey(BCF_PROGRAM_ID);
/** Verify the on-chain program exists at PROGRAM_ID (useful for debugging) */
export async function verifyProgram(connection) {
  try {
    const info = await connection.getAccountInfo(PROGRAM_ID);
    if (!info) {
      console.error('[BCF] Program NOT found at', PROGRAM_ID.toBase58(), '— wrong ID or not deployed?');
      return false;
    }
    console.log('[BCF] Program verified at', PROGRAM_ID.toBase58(), '✓');
    return true;
  } catch (e) {
    console.error('[BCF] verifyProgram error:', e.message);
    return false;
  }
}

// ─── Text helpers ─────────────────────────────────────────────────────────────
const decodeBytes = (bytes) => {
  if (!bytes) return '';
  const flat = Array.isArray(bytes[0]) ? bytes.flat() : Array.from(bytes);
  return new TextDecoder().decode(new Uint8Array(flat)).replace(/\0/g, '').trim();
};

// ─── PDA derivation ───────────────────────────────────────────────────────────

/** Registry PDA — one per creator, tracks project count */
export function getRegistryPDA(creator) {
  const pub = typeof creator === 'string' ? new PublicKey(creator) : creator;
  return PublicKey.findProgramAddressSync(
    [Buffer.from('registry'), pub.toBuffer()],
    PROGRAM_ID
  );
}

/** Project PDA — one per (creator × projectIndex) */
export function getProjectPDA(creator, projectIndex) {
  const pub = typeof creator === 'string' ? new PublicKey(creator) : creator;
  const idx = new BN(projectIndex).toArrayLike(Buffer, 'le', 8);
  return PublicKey.findProgramAddressSync(
    [Buffer.from('project'), pub.toBuffer(), idx],
    PROGRAM_ID
  );
}

/** Campaign PDA — scoped per (creator × projectIndex × campaignIndex) */
export function getCampaignPDA(creator, projectIndex, campaignIndex) {
  const pub  = typeof creator === 'string' ? new PublicKey(creator) : creator;
  const pIdx = new BN(projectIndex).toArrayLike(Buffer, 'le', 8);
  const cIdx = new BN(campaignIndex).toArrayLike(Buffer, 'le', 8);
  return PublicKey.findProgramAddressSync(
    [Buffer.from('campaign'), pub.toBuffer(), pIdx, cIdx],
    PROGRAM_ID
  );
}




// ─── Program instance ─────────────────────────────────────────────────────────
export function getProgram(provider) {
  return new Program(IDL, PROGRAM_ID, provider);
}

// ─── Identity cache (prevents 429 from Bags API) ─────────────────────────────
const CACHE = new Map();
const CACHE_TTL = 10 * 60 * 1000;
function getCached(key) {
  const e = CACHE.get(key);
  return (e && Date.now() - e.ts < CACHE_TTL) ? e.data : null;
}
function setCached(key, data) { CACHE.set(key, { data, ts: Date.now() }); }

// ─── Instructions ─────────────────────────────────────────────────────────────

/**
 * Create a new project for the creator.
 * The CreatorRegistry is auto-created on first call.
 * Returns { projectPDA, projectIndex, tx, isNew }
 */
export async function initializeProject(provider, { tokenMint, feeModeName, name, symbol }) {
  const program = getProgram(provider);
  const creator = provider.wallet?.publicKey;
  if (!creator) throw new Error('Wallet not connected');

  // Read registry to find next project index
  const [registryPDA] = getRegistryPDA(creator);
  let nextIndex = 0;
  try {
    const reg = await program.account.creatorRegistry.fetch(registryPDA);
    nextIndex = reg.projectCount.toNumber();
  } catch (_) {
    nextIndex = 0; // registry doesn't exist yet → first project
  }

  const [projectPDA] = getProjectPDA(creator, nextIndex);

  // Check if this specific project already exists (idempotent safety)
  try {
    const existing = await program.account.projectAccount.fetch(projectPDA);
    return { projectPDA: projectPDA.toBase58(), projectIndex: nextIndex, account: existing, isNew: false };
  } catch (_) {}

  let mintPub;
  try { mintPub = new PublicKey(tokenMint); }
  catch (_) { mintPub = new PublicKey('D9KdRFUG4mZ3gqgDSF8mdfDpJk7qKHsmDn8g3dRsvfBV'); }

  const tx = await program.methods
    .initializeProject(mintPub, feeModeName || 'Standard 2%', name || 'Bags Token', symbol || 'BCF')
    .accounts({
      registry:      registryPDA,
      project:       projectPDA,
      creator,
      systemProgram: SystemProgram.programId,
    })
    .rpc({ commitment: 'confirmed' });

  return { projectPDA: projectPDA.toBase58(), projectIndex: nextIndex, tx, isNew: true };
}

/**
 * Create a campaign linked to a specific project (by projectIndex).
 */
export async function createCampaignOnChain(provider, {
  projectIndex,
  prizeLamports,
  positionPriceLamports,
  tokensPerPosition,
  durationSeconds,
  title,
  description,
}) {
  const program = getProgram(provider);
  const creator = provider.wallet.publicKey;

  const [projectPDA] = getProjectPDA(creator, projectIndex);
  const projectAccount = await program.account.projectAccount.fetch(projectPDA);
  const campaignIndex  = projectAccount.campaignCount.toNumber();
  const [campaignPDA]  = getCampaignPDA(creator, projectIndex, campaignIndex);

  const tx = await program.methods
    .createCampaign(
      new BN(projectIndex),
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
      creator,
      systemProgram: SystemProgram.programId,
    })
    .rpc({ commitment: 'confirmed' });

  const account = await program.account.campaignAccount.fetch(campaignPDA);
  return { campaignPDA: campaignPDA.toBase58(), tx, account, campaignIndex, projectIndex };
}

/** Creator deposits prize SOL → activates campaign */
export async function fundCampaignOnChain(provider, { campaignPDA }) {
  const program = getProgram(provider);
  const creator = provider.wallet?.publicKey;
  if (!creator) throw new Error('Wallet not connected');

  const tx = await program.methods
    .fundCampaign()
    .accounts({
      campaign:      new PublicKey(campaignPDA),
      creator,
      systemProgram: SystemProgram.programId,
    })
    .rpc({ commitment: 'confirmed' });

  const account = await program.account.campaignAccount.fetch(new PublicKey(campaignPDA));
  return { tx, account };
}

/** Wallet user buys a specific position (0–99) */
export async function buyPositionOnChain(provider, { campaignPDA, positionIndex, recipient, signers = [] }) {
  const program  = getProgram(provider);
  const buyer    = provider.wallet?.publicKey;
  if (!buyer && signers.length === 0) throw new Error('Wallet not connected');

  // If buyer isn't connected but we have signers, assume the first signer is the buyer (e.g. Burner Wallet)
  const buyerPubkey = buyer || signers[0].publicKey;
  const recPub = recipient ? new PublicKey(recipient) : buyerPubkey;

  const campaign = await program.account.campaignAccount.fetch(new PublicKey(campaignPDA));
  const [projectPDA] = getProjectPDA(
    new PublicKey(campaign.creator),
    campaign.projectIndex.toNumber()
  );

  const tx = await program.methods
    .buyPosition(positionIndex)
    .accounts({
      campaign:       new PublicKey(campaignPDA),
      project:        projectPDA,
      buyer:          buyerPubkey,
      recipient:      recPub,
      projectCreator: new PublicKey(campaign.creator),
      systemProgram:  SystemProgram.programId,
    })
    .signers(signers)
    .rpc({ commitment: 'confirmed' });

  const updated = await program.account.campaignAccount.fetch(new PublicKey(campaignPDA));
  return { tx, account: updated };
}



/** Resolve campaign (slot hash randomness). Anyone can call after deadline. */
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

/** Winner claims prize */
export async function claimPrizeOnChain(provider, { campaignPDA }) {
  const program = getProgram(provider);
  const winner  = provider.wallet.publicKey;
  const tx = await program.methods
    .claimPrize()
    .accounts({
      campaign:      new PublicKey(campaignPDA),
      winner,
      systemProgram: SystemProgram.programId,
    })
    .rpc({ commitment: 'confirmed' });
  return { tx };
}

/** Push prize to winner (no winner signature needed) */
export async function pushPrizeOnChain(provider, { campaignPDA, winnerAddr }) {
  const program   = getProgram(provider);
  const initiator = provider.wallet.publicKey;
  const tx = await program.methods
    .pushPrize()
    .accounts({
      campaign:      new PublicKey(campaignPDA),
      winner:        new PublicKey(winnerAddr),
      initiator,
      systemProgram: SystemProgram.programId,
    })
    .rpc({ commitment: 'confirmed' });
  return { tx };
}


/** Route unclaimed prize to project treasury */
export async function routeToTreasuryOnChain(provider, { campaignPDA }) {
  const program  = getProgram(provider);
  const campaign = await program.account.campaignAccount.fetch(new PublicKey(campaignPDA));
  const [projectPDA] = getProjectPDA(
    new PublicKey(campaign.creator),
    campaign.projectIndex.toNumber()
  );

  const tx = await program.methods
    .routeNoWinnerToTreasury()
    .accounts({
      campaign:       new PublicKey(campaignPDA),
      project:        projectPDA,
      projectCreator: new PublicKey(campaign.creator),
      systemProgram:  SystemProgram.programId,
    })
    .rpc({ commitment: 'confirmed' });

  const updatedProject = await program.account.projectAccount.fetch(projectPDA);
  return { tx, project: updatedProject };
}

/** Creator deposits SOL from their Web3 wallet directly into the project treasury */
export async function depositToTreasuryOnChain(provider, { projectIndex, amountLamports }) {
  const program = getProgram(provider);
  const creator = provider.wallet.publicKey;
  if (!creator) throw new Error('Wallet not connected');

  const [projectPDA] = getProjectPDA(creator, projectIndex);

  const tx = await program.methods
    .depositToTreasury(new BN(amountLamports))
    .accounts({
      project:       projectPDA,
      creator,
      systemProgram: SystemProgram.programId,
    })
    .rpc({ commitment: 'confirmed' });

  const updated = await program.account.projectAccount.fetch(projectPDA);
  return { tx, project: updated };
}

/** Creator withdraws from a specific project treasury */
export async function withdrawTreasuryOnChain(provider, { projectIndex, amountLamports }) {
  const program = getProgram(provider);
  const creator = provider.wallet.publicKey;
  if (!creator) throw new Error('Wallet not connected');

  const [projectPDA] = getProjectPDA(creator, projectIndex);

  const tx = await program.methods
    .withdrawTreasury(new BN(amountLamports))
    .accounts({
      project: projectPDA,
      creator,
    })
    .rpc({ commitment: 'confirmed' });

  const updated = await program.account.projectAccount.fetch(projectPDA);
  return { tx, project: updated };
}




// ─── Read helpers ─────────────────────────────────────────────────────────────

/** Fetch the creator registry (returns null if never created) */
export async function fetchRegistry(provider, creatorPubkey) {
  if (!provider || !creatorPubkey) return null;
  try {
    const program = getProgram(provider);
    const [registryPDA] = getRegistryPDA(creatorPubkey);
    const info = await provider.connection.getAccountInfo(registryPDA);
    if (!info) return null;
    const reg = await program.account.creatorRegistry.fetch(registryPDA);
    return { pda: registryPDA.toBase58(), projectCount: reg.projectCount.toNumber() };
  } catch (e) {
    console.warn('[BCF] fetchRegistry:', e.message);
    return null;
  }
}

/** Fetch a single project by (creator, index). Returns enriched display object. */
export async function fetchProject(provider, creatorPubkey, projectIndex = 0) {
  if (!provider || !creatorPubkey) return null;
  try {
    const program = getProgram(provider);
    const [projectPDA] = getProjectPDA(creatorPubkey, projectIndex);

    const info = await provider.connection.getAccountInfo(projectPDA);
    if (!info) return null;

    const account = await program.account.projectAccount.fetch(projectPDA);
    return await enrichProject(projectPDA.toBase58(), account);
  } catch (e) {
    console.warn('[BCF] fetchProject:', e.message);
    return null;
  }
}

/** Fetch ALL projects for a creator (iterates registry count). */
export async function fetchAllProjects(provider, creatorPubkey) {
  if (!provider || !creatorPubkey) return [];
  try {
    const program = getProgram(provider);
    const [registryPDA] = getRegistryPDA(creatorPubkey);

    const registryInfo = await provider.connection.getAccountInfo(registryPDA);
    if (!registryInfo) return [];

    const registry = await program.account.creatorRegistry.fetch(registryPDA);
    const count    = registry.projectCount.toNumber();
    if (count === 0) return [];

    const projects = [];
    for (let i = 0; i < count; i++) {
      const [projectPDA] = getProjectPDA(creatorPubkey, i);
      try {
        const account = await program.account.projectAccount.fetch(projectPDA);
        const enriched = await enrichProject(projectPDA.toBase58(), account);
        if (enriched) projects.push(enriched);
      } catch (e) {
        console.warn(`[BCF] fetchAllProjects: project ${i} missing:`, e.message);
      }
    }
    return projects;
  } catch (e) {
    console.error('[BCF] fetchAllProjects error:', e.message);
    return [];
  }
}

/** Fetch ALL projects on the program (for Explore page enrichment) */
export async function fetchGlobalProjects(connection) {
  try {
    const program = new Program(IDL, PROGRAM_ID, { connection });
    const accounts = await program.account.projectAccount.all();
    const projects = [];
    for (const a of accounts) {
      const enriched = await enrichProject(a.publicKey.toBase58(), a.account);
      if (enriched) projects.push(enriched);
    }
    return projects;
  } catch (e) {
    console.error('[BCF] fetchGlobalProjects error:', e.message);
    return [];
  }
}


/** Enrich a raw ProjectAccount with metadata (name, symbol, logo from Bags API) */
async function enrichProject(pdaStr, account) {
  const mintStr = account.tokenMint?.toBase58?.() || account.tokenMint?.toString() || '???';

  // Read name/symbol from on-chain byte arrays
  let name   = decodeBytes(account.projectName);
  let symbol = decodeBytes(account.tokenSymbol);
  let logo   = null;
  let desc   = '';

  if (!name)   name   = 'Bags Token';
  if (!symbol) symbol = 'BCF';

  // Optionally enrich from Bags API (cached)
  const cacheKey = `bags_${mintStr}`;
  let bagsData = getCached(cacheKey);
  if (!bagsData) {
    try {
      bagsData = await getBagsToken(mintStr);
      if (bagsData) setCached(cacheKey, bagsData);
    } catch (_) {}
  }
  if (bagsData) {
    if (name   === 'Bags Token') name   = bagsData.name   || name;
    if (symbol === 'BCF')        symbol = bagsData.symbol || symbol;
    logo = bagsData.image || bagsData.logo || null;
    desc = bagsData.description || '';
  }

  const treasurySOL = account.treasuryLamports
    ? (account.treasuryLamports.toNumber?.() ?? Number(account.treasuryLamports)) / LAMPORTS_PER_SOL
    : 0;

  return {
    pda:            pdaStr,
    mint:           mintStr,
    projectIndex:   account.projectIndex?.toNumber?.() ?? Number(account.projectIndex ?? 0),
    name,
    symbol,
    logo,
    description:    desc || `Project token created via BCF`,
    feeModeName:    decodeBytes(account.feeModeName) || 'Standard 2%',
    campaignCount:  account.campaignCount?.toNumber?.() ?? 0,
    treasury:       { balanceSOL: treasurySOL },
  };
}

/** Fetch a single campaign by its PDA address */
export async function fetchCampaign(provider, campaignPDA) {
  if (!provider || !campaignPDA) return null;
  try {
    const program = getProgram(provider);
    const account = await program.account.campaignAccount.fetch(new PublicKey(campaignPDA));
    return { pda: campaignPDA, ...account };
  } catch (e) {
    console.error('[BCF] fetchCampaign error:', campaignPDA, e.message);
    return null;
  }
}

/** Fetch all campaigns for a creator (memcmp filter on creator field at offset 8) */
export async function fetchCreatorCampaigns(provider, creatorPubkey) {
  if (!provider || !creatorPubkey) return [];
  try {
    const program = getProgram(provider);
    const creator  = new PublicKey(creatorPubkey);
    const accounts = await program.account.campaignAccount.all([
      { memcmp: { offset: 8, bytes: creator.toBase58() } },
    ]);
    return accounts.map(a => ({ ...a.account, pda: a.publicKey.toBase58() }));
  } catch (e) {
    console.error('[BCF] fetchCreatorCampaigns error:', e.message);
    return [];
  }
}

/** Fetch ALL campaigns on the program (for Explore page) */
export async function fetchAllCampaigns(connection) {
  try {
    const program = new Program(IDL, PROGRAM_ID, { connection });
    const accounts = await program.account.campaignAccount.all();
    return accounts.map(a => campaignAccountToDisplay(a.publicKey.toBase58(), a.account));
  } catch (e) {
    console.error('[BCF] fetchAllCampaigns error:', e.message);
    return [];
  }
}

// ─── Display mapping ──────────────────────────────────────────────────────────

/** Convert raw CampaignAccount to a UI-ready display object */
export function campaignAccountToDisplay(pda, account, tokenInfo = null) {
  const flatPositions = Array.isArray(account.positions?.[0])
    ? account.positions.flat()
    : (account.positions || []);

  const positions = flatPositions.map((p, i) => ({
    index:          i,
    owner:          p.filled === 1 ? (p.owner?.toBase58?.() || p.owner?.toString?.() || null) : null,
    filled:         p.filled === 1,
    tokensReceived: account.tokensPerPosition?.toNumber?.() ?? 0,
    txSignature:    null,
    source:         'wallet',
    memo:           null,
    purchasedAt:    null,
  }));

  const prizeSOL          = (account.prizeLamports?.toNumber?.()         ?? 0) / LAMPORTS_PER_SOL;
  const positionPriceSOL  = (account.positionPriceLamports?.toNumber?.() ?? 0) / LAMPORTS_PER_SOL;
  const totalCollectedSOL = (account.totalCollected?.toNumber?.()        ?? 0) / LAMPORTS_PER_SOL;
  const deadline          = account.deadline ? (account.deadline.toNumber?.() ?? Number(account.deadline)) * 1000 : null;
  const projectIndex      = account.projectIndex?.toNumber?.() ?? Number(account.projectIndex ?? 0);

  const rawWinning = account.winningPosition;
  const winning = (rawWinning !== undefined && rawWinning !== 255 && rawWinning !== null) ? rawWinning : null;
  const statusStr = ['pending', 'active', 'settled'][account.status] || 'pending';

  return {
    id:                pda,
    pda,
    isOnChain:         true,
    projectIndex,
    tokenMint:         account.tokenMint?.toBase58?.() || '',
    tokenSymbol:       tokenInfo?.symbol || '???',
    tokenName:         tokenInfo?.name   || 'Unknown',
    creatorWallet:     account.creator?.toBase58?.() || '',
    title:             decodeBytes(account.title),
    description:       decodeBytes(account.description),
    prizeSOL,
    originalPrizeSOL:  prizeSOL,
    positionPriceSOL,
    tokensPerPosition: account.tokensPerPosition?.toNumber?.() ?? 0,
    durationHours:     Math.round((account.durationSeconds?.toNumber?.() ?? 0) / 3600),
    deadline,
    status:            statusStr,
    claimed:           statusStr === 'settled' && prizeSOL === 0 && totalCollectedSOL === 0,
    positions,
    totalCollectedSOL,
    treasuryContribution: (account.treasuryContribution?.toNumber?.() ?? 0) / LAMPORTS_PER_SOL,
    winningPosition:   winning,
    winning,
    winningBlockHash:  account.winningSlot?.toString() || null,
    hasWinner:         winning !== null && positions[winning]?.filled,
    winnerWallet:      (winning !== null && account.winner && account.winner.toBase58?.() !== '11111111111111111111111111111111')
                         ? account.winner.toBase58()
                         : null,
    totalPayout:       prizeSOL + totalCollectedSOL,
    createdAt:         account.createdAt?.toNumber?.() ? account.createdAt.toNumber() * 1000 : Date.now(),
    campaignIndex:     account.campaignIndex?.toNumber?.() ?? 0,
  };
}

// ─── Utility helpers ──────────────────────────────────────────────────────────
export const fmtPos    = (i)  => String(i ?? 0).padStart(2, '0');
export const posStatus = (c)  => (c.positions || []).filter(p => p.filled || p.owner).length;
export const totalPot  = (c)  => (c.prizeSOL || 0) + (c.totalCollectedSOL || 0);
export const isExpired = (c)  => c.deadline && Date.now() > c.deadline;

export function timeLeft(deadline) {
  if (!deadline) return '—';
  const d = deadline - Date.now();
  if (d <= 0) return 'Ended';
  const h = Math.floor(d / 3600000);
  const m = Math.floor((d % 3600000) / 60000);
  const s = Math.floor((d % 60000) / 1000);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
