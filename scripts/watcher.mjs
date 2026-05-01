#!/usr/bin/env node
/**
 * watcher.mjs — BCF Position Vault Watcher
 *
 * El servidor HTTP arranca PRIMERO (antes de Anchor/RPC).
 * Esto garantiza que el puerto 3001 está abierto incluso si la init de Anchor
 * tarda o falla — el health endpoint responde siempre.
 *
 * Endpoints:
 *   GET  /health       — estado del servicio
 *   POST /watch-vault  — pre-crea vault on-chain al ingresar dirección
 *   POST /sweep-now    — asigna posición (botón "Take My Position")
 *
 * Arranca con: bash scripts/deploy.sh  o  npm run watcher
 */

import fs    from 'fs';
import path  from 'path';
import http  from 'http';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Config ───────────────────────────────────────────────────────────────────
const RPC          = process.env.VITE_SOLANA_RPC   || 'https://api.devnet.solana.com';
const PROGRAM_STR  = process.env.BCF_PROGRAM_ID    || 'ELarLMHYVxR2TndqEc6kHUSvwRyZUPHJ5BHFcD7yQtcJ';
const INTERVAL_MS  = parseInt(process.env.POLL_INTERVAL_MS || '15000', 10);
const WATCHER_PORT = parseInt(process.env.WATCHER_PORT || '3001', 10);

// ─── HTTP helpers ─────────────────────────────────────────────────────────────
function setCORS(res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}
function jsonOk(res, data)          { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); }
function jsonErr(res, status, msg)  { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: msg })); }
function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = ''; req.on('data', c => { raw += c; }); req.on('end', () => resolve(raw)); req.on('error', reject);
  });
}

// ─── Estado de inicialización (el HTTP server responde siempre) ───────────────
let initDone   = false;
let initError  = null;
let program    = null;
let sweeperKey = null;
let PROGRAM_ID = null;

// ─── Accounting explícito del sweeper ─────────────────────────────────────────
// Trackea ingresos (rent reclamado + tips) vs gastos (fees TX).
// Visible en GET /health — útil para jueces y para diagnóstico.
const stats = {
  sweepsOk:      0,   // sweeps exitosos
  sweepsFailed:  0,   // sweeps fallidos (error on-chain)
  feesSpentLamp: 0,   // lamports gastados en fees (estimado: 5000 * TXs)
  rentReclaimedLamp: 0, // rent devuelto al sweeper por vaults cerrados (~2039280 lamports/vault)
  tipsReclaimedLamp: 0, // exceso sobre positionPrice recibido (buffer de CEX)
  prizesDelivered: 0,
  refundsOk:     0,   // reembolsos automáticos exitosos (posición ya tomada)
  refundsFailed: 0,   // reembolsos fallidos
  startedAt: Date.now(),
};
const VAULT_RENT_LAMPORTS = 2_039_280; // rent exacto de un PositionVault en Solana devnet
const TX_FEE_LAMPORTS     = 5_000;     // fee estimado por TX

// ─── Servidor HTTP — arranca PRIMERO ─────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  setCORS(res);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // GET /health — disponible incluso durante la init
  if (req.method === 'GET' && req.url === '/health') {
    return jsonOk(res, {
      ok:          initDone && !initError,
      initDone,
      initError:   initError ? String(initError).slice(0, 100) : null,
      uptime:      Math.floor(process.uptime()),
      sweeper:     sweeperKey ? sweeperKey.publicKey.toBase58() : null,
      accounting: {
        sweepsOk:           stats.sweepsOk,
        sweepsFailed:       stats.sweepsFailed,
        feesSpentSOL:       (stats.feesSpentLamp / 1e9).toFixed(6),
        rentReclaimedSOL:   (stats.rentReclaimedLamp / 1e9).toFixed(6),
        tipsReclaimedSOL:   (stats.tipsReclaimedLamp / 1e9).toFixed(6),
        netSOL:             ((stats.rentReclaimedLamp + stats.tipsReclaimedLamp - stats.feesSpentLamp) / 1e9).toFixed(6),
        prizesDelivered:    stats.prizesDelivered,
        refundsOk:          stats.refundsOk,
        refundsFailed:      stats.refundsFailed,
        uptimeHours:        ((Date.now() - stats.startedAt) / 3600000).toFixed(2),
      },
    });
  }

  // Rutas que requieren init completa
  if (!initDone) return jsonErr(res, 503, 'Watcher aún inicializando, reintenta en unos segundos');
  if (initError) return jsonErr(res, 500, 'Watcher falló al inicializar: ' + String(initError).slice(0, 120));

  // POST /watch-vault — pre-crea vault on-chain
  if (req.method === 'POST' && req.url === '/watch-vault') {
    let body; try { body = JSON.parse(await readBody(req)); } catch { return jsonErr(res, 400, 'JSON inválido'); }
    const { campaign, positionIndex, recipient } = body || {};
    if (!campaign || positionIndex == null || !recipient) return jsonErr(res, 400, 'Faltan campaign/positionIndex/recipient');
    try {
      const { PublicKey, SystemProgram } = await import('@solana/web3.js');
      const campPub = new PublicKey(campaign);
      const recPub  = new PublicKey(recipient);
      const [vaultPDA] = deriveVaultPDA(campPub, positionIndex, recPub);
      const accInfo    = await program.provider.connection.getAccountInfo(vaultPDA);
      const isOwned    = accInfo && accInfo.owner.toBase58() === PROGRAM_STR;
      if (isOwned) return jsonOk(res, { ok: true, vaultPDA: vaultPDA.toBase58(), alreadyExisted: true });
      await program.methods.createPositionVault(positionIndex)
        .accounts({ campaign: campPub, positionVault: vaultPDA, recipient: recPub, payer: sweeperKey.publicKey, systemProgram: SystemProgram.programId })
        .rpc({ commitment: 'confirmed' });
      return jsonOk(res, { ok: true, vaultPDA: vaultPDA.toBase58(), alreadyExisted: false });
    } catch (e) {
      const m = e.message || String(e);
      if (m.includes('already in use') || m.includes('0x0')) return jsonOk(res, { ok: true, alreadyExisted: true });
      return jsonErr(res, 500, m.slice(0, 200));
    }
  }

  // POST /sweep-now — asigna posición CEX sin wallet del usuario
  if (req.method === 'POST' && req.url === '/sweep-now') {
    let body; try { body = JSON.parse(await readBody(req)); } catch { return jsonErr(res, 400, 'JSON inválido'); }
    const { campaign, positionIndex, recipient } = body || {};
    if (!campaign || positionIndex == null || !recipient) return jsonErr(res, 400, 'Faltan campaign/positionIndex/recipient');
    console.log(`\n[/sweep-now] pos#${positionIndex} campaign ${campaign.slice(0,8)}… recipient ${recipient.slice(0,8)}…`);
    try {
      const tx = await doSweep(campaign, positionIndex, recipient);
      return jsonOk(res, { ok: true, tx });
    } catch (e) {
      const msg = (e.message || String(e)).slice(0, 200);
      console.error(`[/sweep-now] ❌ ${msg}`);
      const status = (msg.includes('nder') || msg.includes('lamports')) ? 402 : 500;
      return jsonErr(res, status, msg);
    }
  }

  // POST /refund-vault — reembolsa un vault cuya posición ya fue tomada
  if (req.method === 'POST' && req.url === '/refund-vault') {
    let body; try { body = JSON.parse(await readBody(req)); } catch { return jsonErr(res, 400, 'JSON inválido'); }
    const { campaign, positionIndex, recipient } = body || {};
    if (!campaign || positionIndex == null || !recipient) return jsonErr(res, 400, 'Faltan campaign/positionIndex/recipient');
    console.log(`\n[/refund-vault] pos#${positionIndex} campaign ${campaign.slice(0,8)}… recipient ${recipient.slice(0,8)}…`);
    try {
      const tx = await doRefund(campaign, positionIndex, recipient);
      if (!tx) return jsonOk(res, { ok: true, tx: null, info: 'Vault vacío o inexistente — nada que reembolsar' });
      return jsonOk(res, { ok: true, tx });
    } catch (e) {
      const msg = (e.message || String(e)).slice(0, 200);
      console.error(`[/refund-vault] ❌ ${msg}`);
      return jsonErr(res, 500, msg);
    }
  }

  res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: 'Not found' }));
});

server.on('error', err => {
  if (err.code === 'EADDRINUSE') { console.error(`[Watcher] ❌ Puerto ${WATCHER_PORT} ya en uso`); process.exit(1); }
  console.error('[Watcher] Error HTTP:', err.message);
});

// ── Escuchar en 0.0.0.0 (compatible con WSL2, Docker, local) ─────────────────
server.listen(WATCHER_PORT, '0.0.0.0', () => {
  console.log(`[Watcher] ✅ HTTP escuchando en 0.0.0.0:${WATCHER_PORT}`);
  // Inicializar Anchor DESPUÉS de que el puerto ya está abierto
  initAnchor();
});

// ─── Inicialización de Anchor (async, post-listen) ────────────────────────────
async function initAnchor() {
  try {
    console.log('[Watcher] Inicializando Anchor…');
    const { Connection, PublicKey, Keypair, SystemProgram } = await import('@solana/web3.js');
    const { Program, AnchorProvider, Wallet }               = await import('@coral-xyz/anchor');
    const bs58mod                                           = await import('bs58');
    const bs58                                              = bs58mod.default || bs58mod;

    PROGRAM_ID = new PublicKey(PROGRAM_STR);

    // Keypair - 4 metodos en orden de prioridad:
    // 1. WATCHER_PRIVATE_KEY: clave base58 (Mainnet/CI)
    // 2. wsl.exe cat /tmp/bcf_watcher_kp.json:
    //    deploy.sh copia el keypair Linux a /tmp; wsl.exe es el bridge
    //    definitivo para que Windows node lea archivos WSL2 sin problemas de path.
    // 3. WATCHER_KEYPAIR_JSON: bytes como JSON array (backup env-var)
    // 4. HOME fallback (Linux nativo)
    let kp;
    if (process.env.WATCHER_PRIVATE_KEY) {
      kp = Keypair.fromSecretKey(bs58.decode(process.env.WATCHER_PRIVATE_KEY));
      console.log('[Watcher] Keypair: WATCHER_PRIVATE_KEY');

    } else {
      let kpBytes = null;
      let kpSource = '';

      // Metodo A: wsl.exe bridge (WSL2 con Windows node)
      try {
        const { spawnSync } = await import('child_process');
        const r = spawnSync('wsl.exe', ['cat', '/tmp/bcf_watcher_kp.json'], { encoding: 'utf8' });
        if (r.status === 0 && r.stdout && r.stdout.trim().startsWith('[')) {
          kpBytes = JSON.parse(r.stdout.trim());
          kpSource = 'wsl.exe /tmp/bcf_watcher_kp.json (WSL2 bridge)';
        }
      } catch (_) {}

      // Metodo B: WATCHER_KEYPAIR_JSON env var
      if (!kpBytes && process.env.WATCHER_KEYPAIR_JSON) {
        try {
          kpBytes = JSON.parse(process.env.WATCHER_KEYPAIR_JSON);
          kpSource = 'WATCHER_KEYPAIR_JSON (env var)';
        } catch (_) {}
      }

      // Metodo D: HOME filesystem (Linux nativo)
      if (!kpBytes) {
        const keyPath = path.join(process.env.HOME || '~', '.config/solana/id.json');
        if (fs.existsSync(keyPath)) {
          kpBytes = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
          kpSource = keyPath;
        }
      }

      if (!kpBytes) {
        throw new Error(
          'No se encontro el keypair del sweeper.\n' +
          '  Opciones:\n' +
          '  1. Usa bash scripts/deploy.sh (exporta automaticamente)\n' +
          '  2. Define WATCHER_PRIVATE_KEY=<base58> en .env\n' +
          '  3. Asegura que ~/.config/solana/id.json existe en WSL2'
        );
      }

      kp = Keypair.fromSecretKey(Uint8Array.from(kpBytes));
      console.log('[Watcher] Keypair cargado: ' + kpSource);
    }
    sweeperKey = kp;

    // IDL
    const idlPath = path.join(__dirname, '../src/lib/idl.json');
    if (!fs.existsSync(idlPath)) throw new Error('IDL no encontrado en ' + idlPath);
    const IDL = JSON.parse(fs.readFileSync(idlPath, 'utf8'));

    // Provider + Program
    const connection = new Connection(RPC, { commitment: 'confirmed', confirmTransactionInitialTimeout: 60000 });
    const provider   = new AnchorProvider(connection, new Wallet(kp), { commitment: 'confirmed' });
    program          = new Program(IDL, PROGRAM_ID, provider);

    initDone = true;
    console.log(`[Watcher] ✅ Anchor listo`);
    console.log(`[Watcher] Sweeper : ${kp.publicKey.toBase58()}`);
    console.log(`[Watcher] Program : ${PROGRAM_STR}`);
    console.log(`[Watcher] RPC     : ${RPC}`);

    // Verificar balance del sweeper.
    // DevNet: airdrop automatico. Mainnet: cada sweep devuelve ~0.002 SOL de rent.
    const sweepBal = await connection.getBalance(kp.publicKey);
    console.log(`[Watcher] Balance sweeper: ${(sweepBal / 1e9).toFixed(4)} SOL`);
    const IS_DEVNET = RPC.includes('devnet');
    const MIN_SOL = 0.05 * 1e9; // 0.05 SOL ~ 10,000 sweeps
    if (sweepBal < MIN_SOL) {
      if (IS_DEVNET) {
        console.log('[Watcher] Balance bajo — solicitando airdrop en DevNet...');
        try {
          const sig = await connection.requestAirdrop(kp.publicKey, 2e9);
          await connection.confirmTransaction(sig, 'confirmed');
          const nb = await connection.getBalance(kp.publicKey);
          console.log('[Watcher] Airdrop OK. Balance: ' + (nb/1e9).toFixed(4) + ' SOL');
        } catch (ae) {
          console.warn('[Watcher] Airdrop fallo: ' + ae.message.slice(0,80));
          console.warn('[Watcher] Obtén SOL en https://faucet.solana.com → ' + kp.publicKey.toBase58());
        }
      } else {
        console.warn('[Watcher] BALANCE BAJO Mainnet: ' + (sweepBal/1e9).toFixed(6) + ' SOL');
        console.warn('[Watcher] Envia SOL al sweeper: ' + kp.publicKey.toBase58());
        console.warn('[Watcher] Nota: cada sweep devuelve ~0.002 SOL de rent al sweeper automaticamente.');
      }
    } else {
      console.log('[Watcher] Balance OK — ~' + Math.floor(sweepBal/5000) + ' sweeps posibles');
    }

    // Guardar refs a los módulos para uso en funciones
    global.__BCF_PublicKey    = PublicKey;
    global.__BCF_SystemProgram = SystemProgram;
    global.__BCF_bs58         = bs58;

    // Arrancar poll loop
    poll();
    setInterval(poll, INTERVAL_MS);

  } catch (e) {
    initError = e;
    console.error('[Watcher] ❌ Error de inicialización:', e.message);
    console.error('[Watcher] El servidor HTTP sigue activo — health endpoint muestra el error');
  }
}

// ─── PDA helpers (usan los módulos cargados dinámicamente) ───────────────────
function deriveVaultPDA(campPub, positionIndex, recPub) {
  const { PublicKey } = { PublicKey: global.__BCF_PublicKey };
  return PublicKey.findProgramAddressSync(
    [Buffer.from('vault'), campPub.toBuffer(), Buffer.from([positionIndex]), recPub.toBuffer()],
    PROGRAM_ID
  );
}

function deriveProjectPDA(creator, projectIndex) {
  const pub = typeof creator === 'string' ? new (global.__BCF_PublicKey)(creator) : creator;
  // BN-free LE encoding of u64
  const buf = Buffer.alloc(8);
  buf.writeUInt32LE(projectIndex >>> 0, 0);
  buf.writeUInt32LE(Math.floor(projectIndex / 0x100000000), 4);
  return (global.__BCF_PublicKey).findProgramAddressSync(
    [Buffer.from('project'), pub.toBuffer(), buf],
    PROGRAM_ID
  );
}

// ─── doRefund: devuelve el SOL del vault al recipient cuando la posición ya fue tomada ──
async function doRefund(campaignPDA, positionIndex, recipient) {
  const PublicKey     = global.__BCF_PublicKey;
  const SystemProgram = global.__BCF_SystemProgram;
  const conn          = program.provider.connection;

  const campPub = new PublicKey(campaignPDA);
  const recPub  = new PublicKey(recipient);
  const [vaultPub] = deriveVaultPDA(campPub, positionIndex, recPub);

  // Verificar que el vault existe y es del programa
  const accInfo = await conn.getAccountInfo(vaultPub);
  if (!accInfo || accInfo.owner.toBase58() !== PROGRAM_STR) {
    console.log(`[doRefund] Vault pos#${positionIndex} no existe o no pertenece al programa — nada que reembolsar`);
    return null;
  }

  const bal = await conn.getBalance(vaultPub);
  if (bal === 0) {
    console.log(`[doRefund] Vault pos#${positionIndex} vacío — nada que reembolsar`);
    return null;
  }

  // Balance guard del sweeper
  const swBal = await conn.getBalance(sweeperKey.publicKey);
  if (swBal < 0.005 * 1e9) {
    stats.refundsFailed++;
    throw new Error(`Sweeper sin fondos para reembolsar: ${(swBal/1e9).toFixed(6)} SOL`);
  }

  console.log(`[doRefund] Reembolsando ${(bal/1e9).toFixed(6)} SOL → pos#${positionIndex} → ${recipient.slice(0,8)}…`);

  const tx = await program.methods.refundPositionVault(positionIndex)
    .accounts({
      campaign:      campPub,
      positionVault: vaultPub,
      recipient:     recPub,
      initiator:     sweeperKey.publicKey,
    })
    .rpc({ commitment: 'confirmed' });

  stats.refundsOk++;
  stats.feesSpentLamp += TX_FEE_LAMPORTS;
  console.log(`[doRefund] ✅ Reembolso exitoso pos#${positionIndex} (${(bal/1e9).toFixed(6)} SOL) → ${recipient.slice(0,8)}… tx ${tx.slice(0,16)}…`);
  return tx;
}

// ─── doSweep: crea vault si hace falta, verifica balance, sweep ───────────────
async function doSweep(campaignPDA, positionIndex, recipient) {
  const PublicKey     = global.__BCF_PublicKey;
  const SystemProgram = global.__BCF_SystemProgram;
  const conn          = program.provider.connection;

  // ── Balance guard: no intentar TX si el sweeper tiene muy poco SOL ───────
  const swBal = await conn.getBalance(sweeperKey.publicKey);
  if (swBal < 0.005 * 1e9) { // 0.005 SOL mínimo (1000 TXs de reserva)
    const msg = `Sweeper sin fondos suficientes: ${(swBal/1e9).toFixed(6)} SOL. Recarga: ${sweeperKey.publicKey.toBase58()}`;
    stats.sweepsFailed++;
    throw new Error(msg);
  }

  const campPub = new PublicKey(campaignPDA);
  const recPub  = new PublicKey(recipient);
  const [vaultPub] = deriveVaultPDA(campPub, positionIndex, recPub);

  // ── Pre-validación: verificar que posición no esté ya tomada ─────────────
  try {
    const campAcc = await program.account.campaignAccount.fetch(campPub);
    const pos = campAcc.positions?.[positionIndex];
    if (pos && pos.filled === 1) {
      const takenBy = pos.owner?.toBase58?.() || 'desconocido';
      const isOwnPosition = takenBy === recipient;
      if (isOwnPosition) {
        // La misma persona ya tiene la posición (reintento o doble llamada) — no error, no reembolso
        console.log(`[doSweep] Pos#${positionIndex} ya asignada al mismo recipient ${recipient.slice(0,8)}… — ignorando`);
        throw new Error(`ALREADY_OWNED:Posición #${positionIndex} ya asignada a esta misma dirección`);
      }
      // Posición tomada por OTRA persona — auto-reembolsar el vault de este usuario
      console.log(`[doSweep] Pos#${positionIndex} ya tomada por ${takenBy.slice(0,8)}… — iniciando reembolso automático para ${recipient.slice(0,8)}…`);
      try {
        const refundTx = await doRefund(campaignPDA, positionIndex, recipient);
        if (refundTx) {
          throw new Error(`REFUNDED:${positionIndex}:${recipient}:${refundTx}`);
        } else {
          throw new Error(`Posición #${positionIndex} ya asignada a ${takenBy.slice(0,8)}… (vault vacío o inexistente)`);
        }
      } catch (re) {
        if (re.message.startsWith('REFUNDED:') || re.message.startsWith('ALREADY_OWNED:')) throw re;
        stats.refundsFailed++;
        console.error(`[doSweep] Reembolso automático falló: ${re.message.slice(0,80)}`);
        throw new Error(`Posición #${positionIndex} ya tomada — reembolso falló: ${re.message.slice(0,60)}`);
      }
    }
    if (campAcc.status !== 1) { // 1 = Active
      throw new Error(`Campaña no activa (status=${campAcc.status})`);
    }
  } catch (preE) {
    if (preE.message.startsWith('REFUNDED:') || preE.message.startsWith('ALREADY_OWNED:') ||
        preE.message.includes('ya asignada') || preE.message.includes('no activa') ||
        preE.message.includes('ya tomada')) throw preE;
    // Si falla el fetch, continuar (podría ser un RPC hiccup)
    console.warn('[doSweep] Pre-validación falló (continuando):', preE.message.slice(0,60));
  }

  // ── Verificar estado del vault ───────────────────────────────────────────
  const accInfo = await conn.getAccountInfo(vaultPub);
  const isOwned = accInfo && accInfo.owner.toBase58() === PROGRAM_STR;

  if (!isOwned) {
    const bal = await conn.getBalance(vaultPub);
    console.log(`[doSweep] Vault pos#${positionIndex} no inicializado (balance: ${bal} lamports)`);
    // Intentar crear vault (puede tener SOL previo — Solana lo permite con lamports existentes)
    try {
      await program.methods.createPositionVault(positionIndex)
        .accounts({ campaign: campPub, positionVault: vaultPub, recipient: recPub, payer: sweeperKey.publicKey, systemProgram: SystemProgram.programId })
        .rpc({ commitment: 'confirmed' });
      console.log(`[doSweep] Vault creado`);
    } catch (ce) {
      const cm = ce.message || '';
      if (cm.includes('already in use') || cm.includes('0x0')) {
        console.log('[doSweep] Vault ya existe (concurrencia)');
      } else if (bal > 0) {
        // SOL ya llegó pero no se puede crear el vault — usar recordExternalPayment
        console.warn(`[doSweep] createPositionVault falló con bal>0, usando recordExternalPayment: ${cm.slice(0,60)}`);
        const campAcc   = await program.account.campaignAccount.fetch(campPub);
        const [projPDA] = deriveProjectPDA(campAcc.creator, campAcc.projectIndex.toNumber());
        const tx = await program.methods
          .recordExternalPayment(positionIndex, recPub)
          .accounts({ campaign: campPub, project: projPDA, authority: sweeperKey.publicKey })
          .rpc({ commitment: 'confirmed' });
        stats.sweepsOk++;
        stats.feesSpentLamp += TX_FEE_LAMPORTS * 2;
        console.log(`[doSweep] ✅ recordExternalPayment pos#${positionIndex} → ${tx.slice(0,16)}…`);
        return tx;
      } else {
        throw ce;
      }
    }
  }

  // ── Verificar fondos ─────────────────────────────────────────────────────
  const balance = await conn.getBalance(vaultPub);
  const campAcc = await program.account.campaignAccount.fetch(campPub);
  const price   = campAcc.positionPriceLamports.toNumber();
  if (balance < price) throw new Error(`Vault con ${balance} lamports, se necesitan ${price} (${(price/1e9).toFixed(4)} SOL)`);

  // ── Sweep ────────────────────────────────────────────────────────────────
  console.log(`[doSweep] Sweeping pos#${positionIndex} (${balance}/${price} lamports)…`);
  const tx = await program.methods.sweepPositionVault(positionIndex)
    .accounts({ campaign: campPub, positionVault: vaultPub, recipient: recPub, sweeper: sweeperKey.publicKey, systemProgram: SystemProgram.programId })
    .rpc({ commitment: 'confirmed' });

  // Accounting: rent reclamado + tip del usuario (exceso sobre precio)
  stats.sweepsOk++;
  stats.feesSpentLamp     += TX_FEE_LAMPORTS;
  stats.rentReclaimedLamp += VAULT_RENT_LAMPORTS;
  stats.tipsReclaimedLamp += Math.max(0, balance - price);
  console.log(`[doSweep] ✅ pos#${positionIndex} → ${tx.slice(0,16)}… (rent+tip: +${((VAULT_RENT_LAMPORTS + Math.max(0,balance-price))/1e9).toFixed(4)} SOL)`);
  return tx;
}

// ─── Poll loop ────────────────────────────────────────────────────────────────
async function poll() {
  if (!initDone || initError) return;
  const bs58 = global.__BCF_bs58;
  const cycle_ts = new Date().toISOString().slice(11, 19);
  try {
    // Fase 1: Sweep vaults con fondos
    const vaults = await program.account.positionVault.all();
    if (vaults.length > 0) {
      process.stdout.write(`\n[${cycle_ts}] ${vaults.length} vault(s)\n`);
      for (const { publicKey: vk, account: va } of vaults) {
        const bal = await program.provider.connection.getBalance(vk);
        const prc = va.priceLamports.toNumber();
        if (bal < prc) { process.stdout.write(`  ⏳ pos#${va.positionIndex}: ${bal}/${prc}\n`); continue; }
        process.stdout.write(`  💰 pos#${va.positionIndex}: ${bal}/${prc} — sweeping…\n`);
        try {
          const tx = await doSweep(va.campaign.toBase58(), va.positionIndex, va.recipient.toBase58());
          process.stdout.write(`  ✅ pos#${va.positionIndex} → ${tx.slice(0,16)}…\n`);
        } catch (se) {
          const sm = se.message || '';
          if (sm.startsWith('REFUNDED:')) {
            // El reembolso ya fue manejado dentro de doSweep
            const parts = sm.split(':');
            process.stdout.write(`  💸 pos#${va.positionIndex} posición tomada — vault reembolsado automáticamente (tx ${(parts[3]||'').slice(0,12)}…)\n`);
          } else if (sm.startsWith('ALREADY_OWNED:')) {
            process.stdout.write(`  ✅ pos#${va.positionIndex} ya asignado al mismo recipient — OK\n`);
          } else if (sm.includes('PositionTaken') || sm.includes('ya asignada') || sm.includes('ya tomada')) {
            // El on-chain rechazó el sweep DESPUÉS de la pre-validación (race muy estrecho)
            // Intentar reembolso de emergencia
            process.stdout.write(`  ⚠️  pos#${va.positionIndex} PositionTaken en TX — reembolso de emergencia…\n`);
            try {
              const refTx = await doRefund(va.campaign.toBase58(), va.positionIndex, va.recipient.toBase58());
              if (refTx) {
                process.stdout.write(`  💸 Reembolso emergencia pos#${va.positionIndex} OK → ${refTx.slice(0,14)}…\n`);
              } else {
                process.stdout.write(`  ℹ️  pos#${va.positionIndex} vault vacío/inexistente — nada que reembolsar\n`);
              }
            } catch (re) {
              stats.refundsFailed++;
              process.stdout.write(`  ❌ Reembolso emergencia pos#${va.positionIndex} falló: ${(re.message||'').slice(0,60)}\n`);
            }
          } else {
            stats.sweepsFailed++;
            process.stdout.write(`  ⚠️  pos#${va.positionIndex} sweep error: ${sm.slice(0,70)}\n`);
          }
        }
      }

      // Fase 1b: Reembolsar vaults cuya posición ya fue tomada por OTRA persona
      // (cubre el caso en que un usuario wallet tomó la posición y hay un vault huérfano)
      process.stdout.write(`  🔍 Verificando vaults huérfanos (posición tomada por otro)…\n`);
      for (const { publicKey: vk, account: va } of vaults) {
        try {
          const campAcc = await program.account.campaignAccount.fetch(va.campaign);
          const pos = campAcc.positions?.[va.positionIndex];
          if (!pos || pos.filled !== 1) continue; // posición libre o no asignada
          const posOwner = pos.owner?.toBase58?.();
          const vaultRecipient = va.recipient.toBase58();
          if (posOwner === vaultRecipient) continue; // posición asignada a este mismo vault — OK
          // Posición tomada por otra persona y el vault sigue existiendo con fondos
          const bal = await program.provider.connection.getBalance(vk);
          if (bal === 0) continue;
          process.stdout.write(`  💸 Vault huérfano pos#${va.positionIndex} (tomada por ${posOwner?.slice(0,8)}…) — reembolsando ${vaultRecipient.slice(0,8)}…\n`);
          try {
            const refTx = await doRefund(va.campaign.toBase58(), va.positionIndex, vaultRecipient);
            if (refTx) process.stdout.write(`  ✅ Reembolso huérfano pos#${va.positionIndex} → ${refTx.slice(0,14)}…\n`);
          } catch (re) {
            stats.refundsFailed++;
            process.stdout.write(`  ❌ Reembolso huérfano pos#${va.positionIndex} falló: ${(re.message||'').slice(0,60)}\n`);
          }
        } catch (checkE) {
          process.stdout.write(`  ⚠️  Chequeo vault huérfano pos#${va.positionIndex}: ${(checkE.message||'').slice(0,50)}\n`);
        }
      }
    } else {
      process.stdout.write(`\r[${cycle_ts}] 0 vaults activos…`);
    }

    // Fase 2: Campañas resueltas
    const settled = await program.account.campaignAccount.all([
      { memcmp: { offset: 105, bytes: bs58.encode(Buffer.from([2])) } }
    ]);
    for (const { publicKey: ck, account: ca } of settled) {
      const wp = ca.winningPosition;
      if (wp === 255) continue;
      const total = ca.prizeLamports.toNumber() + ca.totalCollected.toNumber();
      if (total <= 0) continue;
      const pos = ca.positions[wp];
      if (pos && pos.filled === 1) {
        const winner = pos.owner;
        try {
          const tx = await program.methods.pushPrize()
            .accounts({ campaign: ck, winner, initiator: sweeperKey.publicKey, systemProgram: global.__BCF_SystemProgram.programId })
            .rpc({ commitment: 'confirmed' });
          stats.prizesDelivered++;
          stats.feesSpentLamp += TX_FEE_LAMPORTS;
          console.log(`\n  🏆 Premio ${(total/1e9).toFixed(4)} SOL → ${winner.toBase58().slice(0,8)}… tx ${tx.slice(0,16)}…`);
        } catch (e) { console.error(`  ❌ pushPrize: ${e.message?.slice(0,60)}`); }
      } else {
        try {
          const [projPDA] = deriveProjectPDA(ca.creator, ca.projectIndex.toNumber());
          const tx = await program.methods.routeNoWinnerToTreasury()
            .accounts({ campaign: ck, project: projPDA, projectCreator: ca.creator, systemProgram: global.__BCF_SystemProgram.programId })
            .rpc({ commitment: 'confirmed' });
          console.log(`\n  🏛️  Sin ganador → tesoro tx ${tx.slice(0,16)}…`);
        } catch (e) { console.error(`  ❌ routeToTreasury: ${e.message?.slice(0,60)}`); }
      }
    }
  } catch (e) {
    console.error(`\n[${cycle_ts}] Poll error: ${e.message?.slice(0,100)}`);
  }
}

console.log(`╔══════════════════════════════════════════╗`);
console.log(`║     BCF Position Vault Watcher           ║`);
console.log(`╚══════════════════════════════════════════╝`);
console.log(`Puerto   : ${WATCHER_PORT}`);
console.log(`RPC      : ${RPC}`);
console.log(`Intervalo: ${INTERVAL_MS}ms`);
console.log(`── El servidor HTTP arranca antes de Anchor ─`);
