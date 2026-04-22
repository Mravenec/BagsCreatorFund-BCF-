/**
 * programClient.js — BagsCreatorFund on-chain client
 *
 * This module wraps all Anchor program calls.
 * It REPLACES localStorage for all on-chain state.
 * localStorage is only used as a cache/display layer.
 *
 * Program ID: BCFunD11111111111111111111111111111111111111
 * Network: Solana DevNet
 */

import { Program, AnchorProvider, BN, utils, web3 } from '@coral-xyz/anchor';
import { PublicKey, SystemProgram, LAMPORTS_PER_SOL, SYSVAR_SLOT_HASHES_PUBKEY } from '@solana/web3.js';
import IDL from './idl.json';

// ─── Program ID ────────────────────────────────────────────────────────────────
// IMPORTANT: Replace this after running `anchor deploy` in the anchor/ directory
export const PROGRAM_ID = new PublicKey('Rx1XswVLMPFAw48m2hVbKeM3eJYkZWNLe1ER5QzLg3L');

// ─── PDA Derivation ────────────────────────────────────────────────────────────
export function getProjectPDA(creatorPubkey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('project'), creatorPubkey.toBuffer()],
    PROGRAM_ID
  );
}

export function getCampaignPDA(creatorPubkey, campaignIndex) {
  const indexBuf = Buffer.alloc(8);
  indexBuf.writeBigUInt64LE(BigInt(campaignIndex));
  return PublicKey.findProgramAddressSync(
    [Buffer.from('campaign'), creatorPubkey.toBuffer(), indexBuf],
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
  const program = getProgram(provider);
  const creator = provider.wallet.publicKey;
  const [projectPDA] = getProjectPDA(creator);

  // Check if already initialized
  try {
    const existing = await program.account.projectAccount.fetch(projectPDA);
    return { projectPDA, account: existing, isNew: false };
  } catch {
    // Not initialized — create it
  }

  const tx = await program.methods
    .initializeProject(new PublicKey(tokenMint), feeModeName)
    .accounts({
      project:       projectPDA,
      creator:       creator,
      systemProgram: SystemProgram.programId,
    })
    .rpc({ commitment: 'confirmed' });

  const account = await program.account.projectAccount.fetch(projectPDA);
  return { projectPDA, account, tx, isNew: true };
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
  const program = getProgram(provider);
  const [projectPDA] = getProjectPDA(new PublicKey(creatorPubkey));
  try {
    const account = await program.account.projectAccount.fetch(projectPDA);
    return { pda: projectPDA.toBase58(), ...account };
  } catch {
    return null;
  }
}

export async function fetchCampaign(provider, campaignPDA) {
  const program = getProgram(provider);
  try {
    const account = await program.account.campaignAccount.fetch(new PublicKey(campaignPDA));
    return { pda: campaignPDA, ...account };
  } catch {
    return null;
  }
}

/** Fetch all campaigns for a creator by iterating their campaign count */
export async function fetchCreatorCampaigns(provider, creatorPubkey) {
  const project = await fetchProject(provider, creatorPubkey);
  if (!project) return [];

  const campaigns = [];
  const count = project.campaignCount.toNumber();

  for (let i = 0; i < count; i++) {
    const [pda] = getCampaignPDA(new PublicKey(creatorPubkey), i);
    const campaign = await fetchCampaign(provider, pda.toBase58());
    if (campaign) campaigns.push({ ...campaign, pda: pda.toBase58() });
  }
  return campaigns;
}

/** Fetch all active campaigns (uses getProgramAccounts — may be slow on DevNet) */
export async function fetchAllActiveCampaigns(connection) {
  try {
    const program = new Program(IDL, PROGRAM_ID, { connection });
    const accounts = await program.account.campaignAccount.all([
      {
        memcmp: {
          offset: 8 + 32 + 32 + 32 + 8 + 8 + 8 + 8 + 8 + 8, // offset to status field
          bytes:  utils.bytes.bs58.encode(Buffer.from([1]))   // status = 1 (active)
        }
      }
    ]);
    return accounts.map(a => ({ pda: a.publicKey.toBase58(), ...a.account }));
  } catch (e) {
    console.warn('[fetchAllActiveCampaigns]', e.message);
    return [];
  }
}

// ─── Conversion helpers ────────────────────────────────────────────────────────
/** Convert on-chain CampaignAccount to the display format used by UI components */
export function campaignAccountToDisplay(pda, account, tokenInfo = null) {
  const positions = (account.positions || []).map((p, i) => ({
    index:         i,
    owner:         p.filled ? p.owner.toBase58() : null,
    txSignature:   null,
    source:        'wallet',
    memo:          null,
    tokensReceived: account.tokensPerPosition?.toNumber() || 0,
    filled:        p.filled,
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
    title:             account.title || '',
    description:       account.description || '',
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
    hasWinner:         account.hasWinner || false,
    winnerWallet:      account.hasWinner ? account.winner?.toBase58() : null,
    totalPayout:       prizeSOL + totalCollectedSOL,
    createdAt:         account.createdAt?.toNumber() * 1000 || Date.now(),
    campaignIndex:     account.campaignIndex?.toNumber() || 0,
  };
}
