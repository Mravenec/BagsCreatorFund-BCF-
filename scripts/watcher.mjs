#!/usr/bin/env node
/**
 * watcher.mjs — BCF Position Vault Watcher
 *
 * Works on BOTH DevNet and Mainnet.
 * Set VITE_SOLANA_RPC and BCF_PROGRAM_ID to control which network.
 *
 * Polls all PositionVault accounts on-chain every 15 seconds.
 * When a vault's balance >= price_lamports, automatically calls
 * sweep_position_vault to assign the position and close the vault.
 * If sweep fails (position taken or campaign expired), calls refund.
 *
 * Also watches for SETTLED campaigns and automatically pushes prizes
 * to winners (essential for CEX users) or routes to project treasury.
 */

import { Connection, PublicKey, Keypair, SystemProgram } from '@solana/web3.js';
import { Program, AnchorProvider, Wallet } from '@coral-xyz/anchor';
import bs58 from 'bs58';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Config ───────────────────────────────────────────────────────────────────
const RPC         = process.env.VITE_SOLANA_RPC   || 'https://api.devnet.solana.com';
const PROGRAM_ID  = new PublicKey(process.env.BCF_PROGRAM_ID || 'ELarLMHYVxR2TndqEc6kHUSvwRyZUPHJ5BHFcD7yQtcJ');
const INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || '15000', 10);

// ─── IDL ──────────────────────────────────────────────────────────────────────
const idlPath = path.join(__dirname, '../src/lib/idl.json');
if (!fs.existsSync(idlPath)) {
  console.error('[Watcher] IDL not found at', idlPath);
  process.exit(1);
}
const IDL = JSON.parse(fs.readFileSync(idlPath, 'utf8'));

// ─── Keypair ──────────────────────────────────────────────────────────────────
let sweeperKeypair;

if (process.env.WATCHER_PRIVATE_KEY) {
  sweeperKeypair = Keypair.fromSecretKey(bs58.decode(process.env.WATCHER_PRIVATE_KEY));
} else {
  const keyPath = path.join(process.env.HOME || process.env.USERPROFILE || '~',
                            '.config/solana/id.json');
  if (!fs.existsSync(keyPath)) {
    console.error('[Watcher] No keypair found. Set WATCHER_PRIVATE_KEY or ensure ~/.config/solana/id.json exists');
    process.exit(1);
  }
  sweeperKeypair = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(keyPath, 'utf8')))
  );
}

// ─── Provider + Program ───────────────────────────────────────────────────────
const connection = new Connection(RPC, 'confirmed');
const wallet     = new Wallet(sweeperKeypair);
const provider   = new AnchorProvider(connection, wallet, { commitment: 'confirmed' });
const program    = new Program(IDL, PROGRAM_ID, provider);

console.log(`╔══════════════════════════════════════════╗`);
console.log(`║     BCF Position Vault Watcher           ║`);
console.log(`╚══════════════════════════════════════════╝`);
console.log(`Sweeper : ${sweeperKeypair.publicKey.toBase58()}`);
console.log(`Program : ${PROGRAM_ID.toBase58()}`);
console.log(`RPC     : ${RPC}`);
console.log(`Interval: ${INTERVAL_MS}ms`);
console.log(`────────────────────────────────────────────`);

// ─── Poll loop ────────────────────────────────────────────────────────────────
let cycle = 0;

async function poll() {
  cycle++;
  const ts = new Date().toISOString().slice(11, 19);
  try {
    // ─── 1. DISCOVERY PHASE: Find manual transfers to uninitialized PDAs ─────
    const sigs = await connection.getSignaturesForAddress(PROGRAM_ID, { limit: 20 });
    const activeCampaigns = await program.account.campaignAccount.all([
      { memcmp: { offset: 105, bytes: bs58.encode([1]) } } // Status 1 = Active
    ]);

    for (const s of sigs) {
      if (s.err) continue;
      const tx = await connection.getParsedTransaction(s.signature, { 
        commitment: 'confirmed', maxSupportedTransactionVersion: 0 
      });
      if (!tx) continue;

      for (const ix of tx.transaction.message.instructions) {
        if (ix.programId.toBase58() === '11111111111111111111111111111111' && ix.parsed?.type === 'transfer') {
          const { source, destination, lamports } = ix.parsed.info;
          for (const camp of activeCampaigns) {
            const price = camp.account.positionPriceLamports.toNumber();
            if (lamports < price) continue;
            for (let i = 0; i < 100; i++) {
              const [pda] = PublicKey.findProgramAddressSync(
                [Buffer.from('vault'), camp.publicKey.toBuffer(), Buffer.from([i]), new PublicKey(source).toBuffer()],
                PROGRAM_ID
              );
              if (pda.toBase58() === destination) {
                const acc = await connection.getAccountInfo(pda);
                if (!acc || acc.owner.toBase58() !== PROGRAM_ID.toBase58()) {
                  console.log(`\n  ✨ [Discovery] Found manual payment for pos#${i} from ${source.slice(0,8)}…`);
                  try {
                    await program.methods.createPositionVault(i, new PublicKey(source))
                      .accounts({
                        campaign: camp.publicKey,
                        positionVault: pda,
                        creator: sweeperKeypair.publicKey,
                        systemProgram: SystemProgram.programId,
                      }).rpc({ commitment: 'confirmed' });
                    console.log(`  ✅ Vault initialized.`);
                  } catch (e) { if (!e.message.includes('already in use')) console.error(`  ❌ Init failed: ${e.message.slice(0,50)}`); }
                }
              }
            }
          }
        }
      }
    }

    // ─── 2. SWEEP PHASE: Process all initialized vaults ──────────────────────
    const vaults = await program.account.positionVault.all();

    if (vaults.length > 0) {
      console.log(`\n[${ts}] Cycle ${cycle}: ${vaults.length} initialized vault(s) found`);
      for (const { publicKey: vaultKey, account } of vaults) {
        const vaultAddr = vaultKey.toBase58();
        const posIdx    = account.positionIndex;
        const price     = account.priceLamports.toNumber();
        const recipient = account.recipient.toBase58();
        const campaign  = account.campaign.toBase58();

        const balance = await connection.getBalance(vaultKey);

        if (balance < price) {
          console.log(`  ⏳ Vault ${vaultAddr.slice(0,8)}… pos#${posIdx} balance ${balance} < ${price} — waiting`);
          continue;
        }

        console.log(`  💰 Vault ${vaultAddr.slice(0,8)}… pos#${posIdx} funded (${balance}/${price}) — sweeping…`);

        try {
          const tx = await program.methods
            .sweepPositionVault(posIdx)
            .accounts({
              campaign:      new PublicKey(campaign),
              positionVault: vaultKey,
              recipient:     new PublicKey(recipient),
              sweeper:       sweeperKeypair.publicKey,
              systemProgram: SystemProgram.programId,
            })
            .rpc({ commitment: 'confirmed' });

          console.log(`  ✅ Swept pos#${posIdx} → ${tx.slice(0, 16)}…`);

        } catch (sweepErr) {
          const msg = sweepErr.message || '';
          console.warn(`  ⚠️  Sweep failed for ${vaultAddr.slice(0,8)}…: ${msg.slice(0, 80)}`);

          // Auto-refund when position is already taken or campaign ended
          const shouldRefund = msg.includes('PositionTaken')
                            || msg.includes('CampaignExpired')
                            || msg.includes('CampaignNotActive')
                            || msg.includes('DeadlineNotReached');

          if (shouldRefund) {
            console.log(`  🔄 Refunding vault ${vaultAddr.slice(0, 8)}… → ${recipient.slice(0,8)}…`);
            try {
              const rtx = await program.methods
                .refundPositionVault(posIdx)
                .accounts({
                  campaign:      new PublicKey(campaign),
                  positionVault: vaultKey,
                  recipient:     new PublicKey(recipient),
                  initiator:     sweeperKeypair.publicKey,
                  systemProgram: SystemProgram.programId,
                })
                .rpc({ commitment: 'confirmed' });
              console.log(`  ✅ Refunded → ${rtx.slice(0, 16)}…`);
            } catch (refundErr) {
              console.error(`  ❌ Refund also failed: ${refundErr.message?.slice(0, 80)}`);
            }
          }
        }
      }
    } else {
      process.stdout.write(`\r[${ts}] Cycle ${cycle}: watching vaults & settled campaigns…`);
    }

    // ─── 2. Handle SETTLED Campaigns (Push Prizes) ───────────────────────────
    const settledCampaigns = await program.account.campaignAccount.all([
      { memcmp: { offset: 105, bytes: bs58.encode([2]) } } // Status 2 = Settled
    ]);

    for (const { publicKey: campaignKey, account: c } of settledCampaigns) {
      const wp = c.winningPosition;
      if (wp === 255) continue; // Not resolved yet

      const prize = c.prizeLamports.toNumber();
      const collected = c.totalCollected.toNumber();
      const total = prize + collected;
      
      if (total <= 0) continue; // Already paid

      const pos = c.positions[wp];
      const hasWinner = pos && pos.filled === 1;

      if (hasWinner) {
        const winner = pos.owner;
        console.log(`\n  🏆 Settled Campaign ${campaignKey.toBase58().slice(0,8)}… has winner: ${winner.toBase58().slice(0,8)}…`);
        console.log(`  🚀 Pushing prize ${total / 1e9} SOL to winner…`);
        try {
          const tx = await program.methods
            .pushPrize()
            .accounts({
              campaign: campaignKey,
              winner,
              initiator: sweeperKeypair.publicKey,
              systemProgram: SystemProgram.programId,
            })
            .rpc({ commitment: 'confirmed' });
          console.log(`  ✅ Prize pushed! Tx: ${tx.slice(0, 16)}…`);
        } catch (e) {
          console.error(`  ❌ Failed to push prize: ${e.message.slice(0,80)}`);
        }
      } else {
        // No winner -> Route to project treasury
        console.log(`\n  🏛️  Settled Campaign ${campaignKey.toBase58().slice(0,8)}… has NO winner.`);
        console.log(`  🏦 Routing ${total / 1e9} SOL to project treasury…`);
        try {
          const [projectPDA] = PublicKey.findProgramAddressSync(
            [Buffer.from('project'), c.creator.toBuffer(), c.projectIndex.toArrayLike(Buffer, 'le', 8)],
            PROGRAM_ID
          );
          const tx = await program.methods
            .routeNoWinnerToTreasury()
            .accounts({
              campaign: campaignKey,
              project: projectPDA,
              projectCreator: c.creator,
              systemProgram: SystemProgram.programId,
            })
            .rpc({ commitment: 'confirmed' });
          console.log(`  ✅ Routed to treasury! Tx: ${tx.slice(0, 16)}…`);
        } catch (e) {
          console.error(`  ❌ Failed to route to treasury: ${e.message.slice(0,80)}`);
        }
      }
    }

  } catch (e) {
    console.error(`\n[${ts}] Poll error: ${e.message?.slice(0, 120)}`);
  }
}

// Start immediately then repeat
poll();
setInterval(poll, INTERVAL_MS);
