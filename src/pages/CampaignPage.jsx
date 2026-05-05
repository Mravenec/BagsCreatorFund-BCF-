import React, { useState, useEffect, useRef } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { useWallet, useConnection, useAnchorWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { Transaction, SystemProgram, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import {
  fetchCampaign, fundCampaignOnChain, buyPositionOnChain,
  resolveCampaignOnChain, claimPrizeOnChain, routeToTreasuryOnChain,
  campaignAccountToDisplay, getProgram, fetchProject,
  fmtPos, posStatus, totalPot, timeLeft, isExpired,
  pushPrizeOnChain,
} from "../lib/programClient.js";
import { Keypair } from "@solana/web3.js";
import { AnchorProvider } from "@coral-xyz/anchor";
import { toUSDC, TOKENS_PER_SOL, TREASURY_FEE_PCT, BCF_PROGRAM_ID, WATCHER_URL, CEX_FEE_BUFFER_SOL, CEX_MIN_GAS_SOL, CEX_CRANK_RESERVE_SOL, CEX_MIN_REFUND_LAMPORTS, IS_MAINNET, NETWORK } from "../lib/constants.js";
import { shortAddr, explorerTx, explorerAddr, explorerBlock, getSOLBalance, requestAirdrop } from "../lib/solana.js";
import { bagsTokenUrl } from "../lib/bags.js";
import { useToast } from "../components/Toast.jsx";
import { getToken } from "../lib/store.js";

const SOL = LAMPORTS_PER_SOL;

// ─── CEX Position Persistence ─────────────────────────────────────────────────
const CEX_STORAGE_KEY = 'bcf_cex_positions_v1';

// Quirúrgicamente limpia los títulos de Solana (bytes basura)
const sanitizeText = (text) => {
  if (!text || typeof text !== 'string') return '';
  const semiIdx = text.indexOf(';');
  if (semiIdx !== -1 && semiIdx < 12) {
    const prefix = text.slice(0, semiIdx);
    if (prefix.includes('ʚ') || prefix.includes('\uFFFD') || /^[?q\s]+$/.test(prefix)) {
      return text.slice(semiIdx + 1).trim();
    }
  }
  return text.replace(/[\x00-\x1F\x7F-\x9F]/g, "").trim();
};


// saveCEXPosition: guarda un HINT local de qué dirección usó el usuario para
// pagar por CEX. Se usa ÚNICAMENTE para saber qué dirección verificar on-chain
// en la pantalla de resultado. El ganador real siempre se verifica en blockchain.
// Atacar/modificar este localStorage no otorga premios ni bypasea el contrato.
function saveCEXPosition(campaignId, positionIndex, recipientAddr, meta = {}) {
  try {
    const all = JSON.parse(localStorage.getItem(CEX_STORAGE_KEY) || '[]');
    const filtered = all.filter(p => !(p.campaignId === campaignId && p.positionIndex === positionIndex));
    const entry = { campaignId, positionIndex, recipientAddr,
      campaignTitle: meta.title || '', tokenSymbol: meta.tokenSymbol || '',
      positionPriceSOL: meta.positionPriceSOL || 0, confirmedAt: Date.now() };
    localStorage.setItem(CEX_STORAGE_KEY, JSON.stringify([...filtered, entry]));
    return entry;
  } catch(e) { console.warn('[BCF-CEX] localStorage error:', e.message); return null; }
}
function loadCEXPositions() {
  try { return JSON.parse(localStorage.getItem(CEX_STORAGE_KEY) || '[]'); } catch { return []; }
}
// getCEXPositionForCampaign: devuelve el recipientAddr guardado localmente.
// SOLO se usa como HINT — el ganador real siempre se verifica on-chain
// comparando pos.owner === recipientAddr.  Hackear localStorage aquí
// no muestra el banner porque la condición de ganador viene del chain.
function getCEXPositionForCampaign(campaignId, positionIndex) {
  return loadCEXPositions().find(p => p.campaignId === campaignId && p.positionIndex === positionIndex) || null;
}


// ─── Polling hook: watches an address for an incoming SOL transfer ────────────
function usePollIncoming({ active, connection, address, expectedLamports, onFound }) {
  const [count, setCount] = useState(0);
  const ref  = useRef(null);
  const done = useRef(false);

  useEffect(() => {
    if (!active || done.current) return;
    let n = 0;
    ref.current = setInterval(async () => {
      n++; setCount(n);
      if (n > 72) { clearInterval(ref.current); return; }
      try {
        const sigs = await connection.getSignaturesForAddress(new PublicKey(address), { limit:10 });
        for (const s of sigs) {
          if (s.blockTime && Date.now()/1000 - s.blockTime > 900) continue;
          const tx = await connection.getParsedTransaction(s.signature, { commitment:"confirmed", maxSupportedTransactionVersion:0 });
          if (!tx || tx.meta?.err) continue;
          for (const ix of tx.transaction.message.instructions) {
            if (ix.parsed?.type==="transfer" && ix.parsed?.info?.destination===address) {
              const recv = ix.parsed.info.lamports;
              if (Math.abs(recv - expectedLamports) <= expectedLamports * 0.1) {
                done.current = true;
                clearInterval(ref.current);
                onFound({ signature:s.signature, sender:ix.parsed.info.source, lamports:recv });
                return;
              }
            }
          }
        }
      } catch(e) { console.warn("[poll]", e.message); }
    }, 5000);
    return () => { clearInterval(ref.current); done.current = true; };
  }, [active]);

  return count;
}

// ─── Copy helper ──────────────────────────────────────────────────────────────
function useCopy() {
  const [copied, setCopied] = useState("");
  const copy = (text, key) => {
    navigator.clipboard.writeText(text);
    setCopied(key); setTimeout(() => setCopied(""), 2200);
  };
  return [copied, copy];
}

// ─── Browser Crank: Automatic Resolution & Payouts ────────────────────────────
/**
 * Automatically checks for expired campaigns or stuck prizes and processes them
 * using either the connected wallet (if creator) or stored Burner Wallets (if gas exists).
 */
function useBrowserCrank(campaign, connection, anchorWallet, toast, setCampaign) {
  useEffect(() => {
    if (!campaign || campaign.status === 'pending') return;

    const runCrank = async () => {
      try {
        const now = Date.now();
        const provider = anchorWallet ? new AnchorProvider(connection, anchorWallet, { commitment: "confirmed" }) : null;
        const isCreator = anchorWallet && anchorWallet.publicKey.toBase58() === campaign.creatorWallet;
        const isWinner  = anchorWallet && anchorWallet.publicKey.toBase58() === campaign.winnerWallet;

        // 1. AUTO-RESOLVE: Deadline passed but still active
        if (campaign.status === 'active' && campaign.deadline && now > campaign.deadline) {
          console.log('[Crank] Campaign expired. Attempting auto-resolve...');
          
          // Try with connected creator wallet first
          if (isCreator && provider) {
            const { account } = await resolveCampaignOnChain(provider, { campaignPDA: campaign.pda });
            const updated = campaignAccountToDisplay(campaign.pda, account);
            setCampaign(updated);
            toast("🎲 Round resolved automatically!", "success");
            return;
          }

          // Fallback: Try with ANY stored Burner Wallet for this campaign
          for (let i = 0; i < 100; i++) {
            const key = `bcf_burner_${campaign.pda}_${i}`;
            const stored = localStorage.getItem(key);
            if (stored) {
              const kp = Keypair.fromSecretKey(new Uint8Array(JSON.parse(stored)));
              const bal = await connection.getBalance(kp.publicKey);
              if (bal >= 1000000) { // Need at least ~0.001 SOL to be safe
                const mockWallet = { 
                  publicKey: kp.publicKey, 
                  signTransaction: async(tx)=>{tx.sign(kp); return tx;},
                  signAllTransactions: async(txs)=>{txs.forEach(t=>t.sign(kp)); return txs;}
                };
                const burnerProvider = new AnchorProvider(connection, mockWallet, { commitment: "confirmed" });
                const { account } = await resolveCampaignOnChain(burnerProvider, { campaignPDA: campaign.pda });
                const updated = campaignAccountToDisplay(campaign.pda, account);
                setCampaign(updated);
                toast("🎲 Round resolved automatically via Burner Wallet!", "success");
                return;
              }
            }
          }
        }

        // 2. AUTO-PAYOUT: Settled with winner but funds still in PDA
        if (campaign.status === 'settled' && campaign.hasWinner && !campaign.claimed) {
          console.log('[Crank] Prize stuck. Attempting auto-payout...');

          const winnerAddr = campaign.winnerWallet;
          if (!winnerAddr) return;

          // 1. Try with connected Winner wallet (Auto-Claim)
          if (isWinner && provider) {
             console.log('[Crank] Winner connected. Triggering auto-claim...');
             await handleClaim(); // This refreshes campaign state internally
             return;
          }

          // 2. Try with connected Creator wallet (Auto-Push)
          if (isCreator && provider) {
             console.log('[Crank] Creator connected. Triggering auto-push...');
             await pushPrizeOnChain(provider, { campaignPDA: campaign.pda, winnerAddr });
             toast("💸 Prize pushed to winner automatically!", "success");
             // Refresh campaign state
             const updatedAccount = await fetchCampaign(provider, campaign.pda);
             setCampaign(campaignAccountToDisplay(campaign.pda, updatedAccount));
             return;
          }

          // Fallback: Try with Burner Wallets
          for (let i = 0; i < 100; i++) {
            const key = `bcf_burner_${campaign.pda}_${i}`;
            const stored = localStorage.getItem(key);
            if (stored) {
              const kp = Keypair.fromSecretKey(new Uint8Array(JSON.parse(stored)));
              const bal = await connection.getBalance(kp.publicKey);
              if (bal >= 1000000) {
                const mockWallet = { 
                  publicKey: kp.publicKey, 
                  signTransaction: async(tx)=>{tx.sign(kp); return tx;},
                  signAllTransactions: async(txs)=>{txs.forEach(t=>t.sign(kp)); return txs;}
                };
                const burnerProvider = new AnchorProvider(connection, mockWallet, { commitment: "confirmed" });
                await pushPrizeOnChain(burnerProvider, { campaignPDA: campaign.pda, winnerAddr });
                toast("💸 Prize pushed to winner automatically via Burner!", "success");
                const updatedAccount = await fetchCampaign(burnerProvider, campaign.pda);
                setCampaign(campaignAccountToDisplay(campaign.pda, updatedAccount));
                return;
              }
            }
          }
        }
      } catch (err) {
        console.warn('[Crank] Background process error:', err.message || err);
      }
    };

    const interval = setInterval(runCrank, 10000); // Check every 10s
    runCrank(); // Run once on mount
    return () => clearInterval(interval);
  }, [campaign, connection, anchorWallet, toast, setCampaign]);
}

// ─── DEPOSIT MODAL — Creator deposits prize to activate ───────────────────────
function DepositModal({ campaign, connection, onClose, onActivated }) {
  const { connected, publicKey, wallet } = useWallet();
  const anchorWallet = useAnchorWallet();
  const { setVisible } = useWalletModal();
  const toast = useToast();
  const [tab,     setTab]     = useState("wallet");
  const [sending, setSending] = useState(false);
  const [polling, setPolling] = useState(false);
  const [done,    setDone]    = useState(false);
  const [balance, setBalance] = useState(null);
  const [copied, copy]        = useCopy();

  const needed     = campaign.prizeSOL;
  const lamports   = Math.floor(needed * SOL);
  const memo       = `ACTIVATE_${campaign.id.slice(-8).toUpperCase()}`;

  useEffect(() => {
    if (connected && publicKey) getSOLBalance(publicKey.toBase58()).then(setBalance);
  }, [connected, publicKey]);

  const pollCount = usePollIncoming({
    active: polling && !done, connection,
    address: campaign.creatorWallet, expectedLamports: lamports,
    onFound: ({ signature }) => activate(signature),
  });

  async function handleAirdrop() {
    try {
      toast("Requesting 2 SOL airdrop...", "info");
      await requestAirdrop(publicKey.toBase58(), 2);
      const b = await getSOLBalance(publicKey.toBase58());
      setBalance(b);
      toast("✓ +2 SOL received!", "success");
    } catch { toast("Airdrop failed — try again in 30s", "error"); }
  }

  async function handleWalletDeposit() {
    if (!connected) { setVisible(true); return; }
    if (balance !== null && balance < needed) {
      toast(`Need ${needed} SOL — balance: ${balance.toFixed(4)} SOL`, "error"); return;
    }
    setSending(true);
    try {
      const provider = new AnchorProvider(connection, anchorWallet, { commitment: "confirmed" });
      toast("Approve the prize deposit in your wallet...", "info");
      const { tx, account } = await fundCampaignOnChain(provider, { campaignPDA: campaign.pda });
      
      toast("Campaign activated!", "success");
      onActivated(campaignAccountToDisplay(campaign.pda, account));
      setTimeout(onClose, 1800);
    } catch(e) {
      console.error("[BCF] Deposit error:", e);
      const m = e.message || e.toString() || "";
      if (/rejected|cancelled|canceled/i.test(m)) {
        toast("Deposit cancelled", "info");
      } else if (m.includes("0x1")) {
        toast("Insufficient funds for prize + fees", "error");
      } else {
        toast(`Failed: ${m.slice(0, 80)}...`, "error");
      }
    } finally {
      setSending(false);
    }
  }

  async function activate(txSig) {
    setDone(true); setPolling(false);
    toast("Campaign activated! 100 positions now available.", "success");
    try {
      const mockWallet = { publicKey: new PublicKey("11111111111111111111111111111111") };
      const readProvider = new AnchorProvider(connection, mockWallet, { commitment: "confirmed" });
      const refreshed = await fetchCampaign(readProvider, campaign.pda);
      if (refreshed) onActivated(campaignAccountToDisplay(campaign.pda, refreshed));
    } catch (_) { onActivated(campaign); }
    setTimeout(onClose, 1800);
  }

  return (
    <div className="overlay" onClick={e=>e.target===e.currentTarget&&!sending&&onClose()}>
      <div className="modal" style={{ padding:"34px" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:"20px" }}>
          <div>
            <h2 style={{ fontWeight:700, fontSize:"1.2rem", marginBottom:"4px" }}>Deposit Prize to Activate</h2>
            <p style={{ color:"var(--text2)", fontSize:".83rem" }}>Send {needed} SOL to make your campaign live.</p>
          </div>
          {!sending && <button onClick={onClose} style={{ background:"none", border:"none", color:"var(--text3)", fontSize:"1.3rem", cursor:"pointer" }}>×</button>}
        </div>

        {done ? (
          <div style={{ textAlign:"center", padding:"28px 0" }}>
            <div style={{ fontSize:"3rem", marginBottom:"12px" }}>✅</div>
            <h3 style={{ fontWeight:700, color:"var(--green)", marginBottom:"8px" }}>Campaign Activated!</h3>
            <p style={{ color:"var(--text2)", fontSize:".84rem" }}>100 positions (00–99) are now available.</p>
          </div>
        ) : (
          <>
            <div style={{ padding:"16px 18px", background:"rgba(56,189,248,.05)", border:"1px solid rgba(56,189,248,.18)", borderRadius:"var(--r)", marginBottom:"18px", textAlign:"center" }}>
              <div style={{ fontSize:".7rem", color:"var(--text3)", textTransform:"uppercase", letterSpacing:".06em", marginBottom:"4px" }}>Prize to deposit</div>
              <div style={{ fontFamily:"var(--mono)", fontSize:"2rem", fontWeight:700, color:"var(--accent)" }}>{needed} SOL</div>
              <div style={{ fontSize:".75rem", color:"var(--text3)", marginTop:"4px" }}>≈ ${toUSDC(needed)} USDC · Becomes part of the winner prize pool</div>
            </div>

            <div style={{ display:"flex", background:"var(--bg2)", border:"1px solid var(--border2)", borderRadius:"var(--r)", padding:"4px", gap:"4px", marginBottom:"18px" }}>
              {[["wallet","🔐 Wallet"],["address","🏦 Address / Exchange"]].map(([k,l])=>(
                <button key={k} onClick={()=>setTab(k)} style={{ flex:1, padding:"9px", borderRadius:"6px", fontSize:".82rem", fontWeight:tab===k?700:400, background:tab===k?"var(--accent)":"transparent", color:tab===k?"#000":"var(--text3)", border:"none", cursor:"pointer", transition:"var(--ease)" }}>{l}</button>
              ))}
            </div>

            {tab==="wallet" ? (
              <div style={{ display:"flex", flexDirection:"column", gap:"10px" }}>
                {connected && balance!==null && (
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"8px 12px", background:"var(--bg2)", borderRadius:"var(--r)", fontSize:".8rem" }}>
                    <span style={{ color:"var(--text3)" }}>Your balance</span>
                    <div style={{ display:"flex", alignItems:"center", gap:"10px" }}>
                      <span style={{ fontFamily:"var(--mono)", fontWeight:700, color:balance<needed?"var(--danger)":"var(--text)" }}>{balance.toFixed(4)} SOL</span>
                      {balance<needed && !IS_MAINNET && <button className="btn btn-ghost btn-sm" onClick={handleAirdrop} style={{ fontSize:".72rem", padding:"4px 10px" }}>☁️ Airdrop</button>}
                    </div>
                  </div>
                )}
                <button className="btn btn-primary btn-full" onClick={handleWalletDeposit} disabled={sending}>
                  {sending?<span style={{ display:"flex", alignItems:"center", gap:"8px", justifyContent:"center" }}><span className="spin">⟳</span> Confirming...</span>
                    :connected?`⚡ Deposit ${needed} SOL`:"🔌 Connect Wallet First"}
                </button>
                {connected && wallet && <p style={{ textAlign:"center", fontSize:".7rem", color:"var(--text3)" }}>{wallet.adapter.name} · Solana {IS_MAINNET?"Mainnet":"DevNet"}</p>}
              </div>
            ) : (
              <div style={{ display:"flex", flexDirection:"column", gap:"12px" }}>
                <div style={{ padding:"10px 14px", background:"rgba(56,189,248,.06)", border:"1px solid rgba(56,189,248,.18)", borderRadius:"var(--r)", fontSize:".78rem", color:"var(--accent)", lineHeight:1.55 }}>
                  Works from any exchange (Binance, Coinbase) or any Solana wallet. Send SOL directly — no memo needed.
                </div>
                {[
                  { label:"Send to address", value:campaign.creatorWallet, key:"dep-addr", accent:false },
                  { label:"Memo / Tag (required)", value:memo, key:"dep-memo", accent:true },
                ].map(({label,value,key,accent})=>(
                  <div key={key}>
                    <div style={{ fontSize:".7rem", color:"var(--text3)", marginBottom:"5px" }}>{label}</div>
                    <div style={{ display:"flex", alignItems:"center", gap:"8px", padding:"10px 13px", background:"var(--bg2)", border:"1px solid var(--border2)", borderRadius:"var(--r)" }}>
                      <span style={{ flex:1, fontFamily:"var(--mono)", fontSize:accent?".88rem":".72rem", fontWeight:accent?700:400, color:accent?"var(--accent)":"var(--text2)", wordBreak:"break-all", letterSpacing:accent?".06em":"0" }}>{value}</span>
                      <button className="btn btn-ghost btn-sm" onClick={()=>copy(value,key)}>{copied===key?"✓":"Copy"}</button>
                    </div>
                    {key.includes("memo") && <p style={{ fontSize:".7rem", color:"var(--warning)", marginTop:"4px" }}>⚠️ Include memo so the system identifies your deposit</p>}
                  </div>
                ))}
                <div style={{ padding:"11px 14px", background:"var(--bg2)", border:"1px solid var(--border2)", borderRadius:"var(--r)", fontSize:".79rem", color:"var(--text2)", lineHeight:1.65 }}>
                  <strong style={{ color:"var(--text)", display:"block", marginBottom:"3px" }}>From Binance / Coinbase:</strong>
                  Withdraw → SOL → Solana network → paste address → add memo → amount <strong style={{ color:"var(--accent)" }}>{needed} SOL</strong>
                </div>
                {!polling
                  ? <button className="btn btn-secondary btn-full" onClick={()=>{setPolling(true);toast("Monitoring for deposit...","info");}}>✓ I sent {needed} SOL — Monitor now</button>
                  : <div style={{ display:"flex", alignItems:"center", gap:"12px", padding:"13px 15px", background:"rgba(56,189,248,.07)", border:"1px solid rgba(56,189,248,.2)", borderRadius:"var(--r)" }}>
                      <span className="spin">⟳</span>
                      <div>
                        <div style={{ fontWeight:600, fontSize:".85rem", color:"var(--accent)" }}>Scanning {IS_MAINNET?"Mainnet":"DevNet"}... ({pollCount}/72)</div>
                        <div style={{ fontSize:".7rem", color:"var(--text3)" }}>Every 5s · max 6 min</div>
                      </div>
                    </div>
                }
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── PARTICIPATE MODAL — Anyone buys a position ───────────────────────────────
function ParticipateModal({ campaign, positionIndex, connection, onClose, onSuccess }) {
  const { connected, publicKey, wallet } = useWallet();
  const anchorWallet = useAnchorWallet();
  const { setVisible } = useWalletModal();
  const toast = useToast();
  const [tab,     setTab]     = useState("wallet");
  const [sending, setSending] = useState(false);
  const [polling, setPolling] = useState(false);
  const [done,    setDone]    = useState(false);
  const [doneTx,  setDoneTx]  = useState("");
  const [balance, setBalance] = useState(null);
  const [copied,  copy]       = useCopy();

  const price    = campaign.positionPriceSOL;
  const lamports = Math.floor(price * SOL);
  const tokens   = campaign.tokensPerPosition;
  const treasury = (price * TREASURY_FEE_PCT / 100).toFixed(4);
  const memo     = `POS${fmtPos(positionIndex)}_${campaign.id.slice(-8).toUpperCase()}`;

  useEffect(() => {
    if (connected && publicKey) getSOLBalance(publicKey.toBase58()).then(setBalance);
  }, [connected, publicKey]);

  // (Legacy pollCount removed in favor of VaultCEXTab specialized polling)


  async function handleAirdrop() {
    try {
      toast("Requesting airdrop...", "info");
      await requestAirdrop(publicKey.toBase58(), 5);
      const b = await getSOLBalance(publicKey.toBase58());
      setBalance(b);
      toast("✓ +5 SOL received!", "success");
    } catch { toast("Airdrop failed — try again in 30s", "error"); }
  }

  async function handleWalletBuy() {
    if (!connected) { setVisible(true); return; }
    
    // Refresh state first
    const provider = new AnchorProvider(connection, anchorWallet, { commitment: "confirmed" });
    const freshAccount = await fetchCampaign(provider, campaign.pda);
    if (!freshAccount || freshAccount.positions[positionIndex].filled) {
      toast(`⚠️ Position #${positionIndex < 10 ? '0' + positionIndex : positionIndex} was just taken by someone else. No charge was made. Choose another position.`, "error");
      onClose(); return;
    }

    if (balance !== null && balance < price) {
      toast(`Need ${price} SOL — balance: ${balance.toFixed(4)} SOL`, "error"); return;
    }
    setSending(true);
    try {
      toast("Approve in your wallet...", "info");
      const { tx, account } = await buyPositionOnChain(provider, { 
        campaignPDA: campaign.pda, 
        positionIndex 
      });
      
      setDone(true); setDoneTx(tx);
      onSuccess(campaignAccountToDisplay(campaign.pda, account));
      toast(`✓ Position secured!`, "success");
    } catch(e) {
      const m = e.message||"";
      if (/rejected|cancelled|canceled/i.test(m)) toast("Cancelado", "info");
      else if (m.includes('PositionTaken')) toast(`⚠️ Position #${fmtPos(positionIndex)} was just taken by someone else. Your transaction was rejected and no charge was made. Choose another position.`, "error");
      else toast("Failed: " + m.slice(0,100), "error");
    } finally { setSending(false); }
  }


  return (
    <div className="overlay" onClick={e=>e.target===e.currentTarget&&!sending&&onClose()}>
      <div className="modal" style={{ padding:"34px" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:"20px" }}>
          <div>
            <h2 style={{ fontWeight:700, fontSize:"1.2rem", marginBottom:"4px" }}>
              Participate — Position <span style={{ fontFamily:"var(--mono)", color:"var(--accent)", fontSize:"1.25rem" }}>#{fmtPos(positionIndex)}</span>
            </h2>
            <p style={{ color:"var(--text2)", fontSize:".83rem" }}>{price} SOL → {tokens.toLocaleString()} ${campaign.tokenSymbol} tokens</p>
          </div>
          {!sending && <button onClick={onClose} style={{ background:"none", border:"none", color:"var(--text3)", fontSize:"1.3rem", cursor:"pointer" }}>×</button>}
        </div>

        {done ? (
          <div style={{ textAlign:"center", padding:"24px 0" }}>
            <div style={{ fontSize:"3rem", marginBottom:"12px" }}>✅</div>
            <h3 style={{ fontWeight:700, color:"var(--green)", marginBottom:"8px" }}>Position #{fmtPos(positionIndex)} secured!</h3>
            <p style={{ color:"var(--accent)", fontWeight:700, marginBottom:"10px" }}>+{tokens.toLocaleString()} ${campaign.tokenSymbol} distributed</p>
            <p style={{ color:"var(--text3)", fontSize:".78rem", marginBottom:"14px" }}>{treasury} SOL contributed to project treasury</p>
            {doneTx && <a href={explorerTx(doneTx)} target="_blank" rel="noopener noreferrer" style={{ color:"var(--accent)", fontSize:".78rem" }}>View on Solana Explorer ↗</a>}
          </div>
        ) : (
          <>
            <div style={{ padding:"14px 18px", background:"rgba(56,189,248,.05)", border:"1px solid rgba(56,189,248,.18)", borderRadius:"var(--r)", marginBottom:"18px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <div>
                <div style={{ fontSize:".7rem", color:"var(--text3)", textTransform:"uppercase", letterSpacing:".06em", marginBottom:"3px" }}>You pay</div>
                <div style={{ fontFamily:"var(--mono)", fontSize:"1.5rem", fontWeight:700, color:"var(--accent)" }}>{price} SOL</div>
                <div style={{ fontSize:".72rem", color:"var(--text3)" }}>≈ ${toUSDC(price)} USDC</div>
              </div>
              <div style={{ textAlign:"right" }}>
                <div style={{ fontSize:".7rem", color:"var(--text3)", textTransform:"uppercase", letterSpacing:".06em", marginBottom:"3px" }}>You receive</div>
                <div style={{ fontFamily:"var(--mono)", fontWeight:700, color:"var(--accent)", fontSize:".9rem" }}>{tokens.toLocaleString()}</div>
                <div style={{ fontSize:".72rem", color:"var(--text3)" }}>${campaign.tokenSymbol} tokens</div>
              </div>
            </div>

            <div style={{ padding:"8px 13px", background:"rgba(52,211,153,.06)", border:"1px solid rgba(52,211,153,.2)", borderRadius:"var(--r)", marginBottom:"16px", fontSize:".76rem", color:"var(--green)" }}>
              🏦 {treasury} SOL (2%) automatically goes to the project treasury
            </div>

            <div style={{ display:"flex", background:"var(--bg2)", border:"1px solid var(--border2)", borderRadius:"var(--r)", padding:"4px", gap:"4px", marginBottom:"16px" }}>
              {[["wallet","🔐 Wallet"],["address","🏦 Address / Exchange"]].map(([k,l])=>(
                <button key={k} onClick={()=>setTab(k)} style={{ flex:1, padding:"9px", borderRadius:"6px", fontSize:".82rem", fontWeight:tab===k?700:400, background:tab===k?"var(--accent)":"transparent", color:tab===k?"#000":"var(--text3)", border:"none", cursor:"pointer", transition:"var(--ease)" }}>{l}</button>
              ))}
            </div>

            {tab==="wallet" ? (
              <div style={{ display:"flex", flexDirection:"column", gap:"10px" }}>
                {connected && balance!==null && (
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"8px 12px", background:"var(--bg2)", borderRadius:"var(--r)", fontSize:".8rem" }}>
                    <span style={{ color:"var(--text3)" }}>Your balance</span>
                    <div style={{ display:"flex", alignItems:"center", gap:"10px" }}>
                      <span style={{ fontFamily:"var(--mono)", fontWeight:700, color:balance<price?"var(--danger)":"var(--text)" }}>{balance.toFixed(4)} SOL</span>
                      {balance<price && !IS_MAINNET && <button className="btn btn-ghost btn-sm" onClick={handleAirdrop} style={{ fontSize:".72rem", padding:"4px 10px" }}>☁️ Airdrop</button>}
                    </div>
                  </div>
                )}
                <button className="btn btn-primary btn-full" onClick={handleWalletBuy} disabled={sending}>
                  {sending?<span style={{ display:"flex", alignItems:"center", gap:"8px", justifyContent:"center" }}><span className="spin">⟳</span> Confirming...</span>
                    :connected?`⚡ Participate — Position #${fmtPos(positionIndex)}`:"🔌 Connect Wallet First"}
                </button>
                {connected && wallet && <p style={{ textAlign:"center", fontSize:".7rem", color:"var(--text3)" }}>{wallet.adapter.name} · Solana {IS_MAINNET?"Mainnet":"DevNet"}</p>}
              </div>
            ) : (
              <BurnerCEXTab
                campaign={campaign}
                positionIndex={positionIndex}
                price={price}
                lamports={lamports}
                connection={connection}
                toast={toast}
                copied={copied}
                copy={copy}
                onSuccess={onSuccess}
                onClose={onClose}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

function BurnerCEXTab({ campaign, positionIndex, price, lamports, connection, toast, copied, copy, onSuccess, onClose }) {
  const [recipientAddr, setRecipientAddr]   = useState('');
  const [addrError,     setAddrError]       = useState('');
  const [burnerKeypair, setBurnerKeypair]   = useState(null);
  const [vaultBalance,  setVaultBalance]    = useState(0);
  const [sweeping,      setSweeping]        = useState(false);
  const [swept,         setSwept]           = useState(false);
  const [polling,       setPolling]         = useState(false);
  const [isChecking,    setIsChecking]      = useState(false);
  const [lastChecked,   setLastChecked]     = useState(null);
  const [autoStatus,    setAutoStatus]      = useState('');
  const [refundPending, setRefundPending]   = useState(false);

  const sweepingRef  = useRef(false);
  const sweptRef     = useRef(false);
  const recipientRef = useRef('');

  // Generate or load Burner Wallet
  useEffect(() => {
    if (!recipientAddr) return;
    const key = `bcf_burner_${campaign.pda}_${positionIndex}`;
    let kp;
    try {
      const stored = localStorage.getItem(key);
      if (stored) {
        kp = Keypair.fromSecretKey(new Uint8Array(JSON.parse(stored)));
      } else {
        kp = Keypair.generate();
        localStorage.setItem(key, JSON.stringify(Array.from(kp.secretKey)));
      }
      setBurnerKeypair(kp);
      setPolling(true);
    } catch (e) {
      console.error('Burner wallet error:', e);
    }
  }, [recipientAddr, campaign.pda, positionIndex]);

  // Cleanup Burner Wallet only if it has been fully used/refunded and has NO crank reserve
  useEffect(() => {
    if (swept || refundPending) {
      const checkAndCleanup = async () => {
        if (!burnerKeypair) return;
        try {
          const bal = await connection.getBalance(burnerKeypair.publicKey);
          // If balance is below the Crank reserve, we can safely delete it.
          // Otherwise, we keep it in localStorage so it can act as a Crank later.
          if (bal < (CEX_CRANK_RESERVE_SOL * 0.9 * 1e9)) {
            const key = `bcf_burner_${campaign.pda}_${positionIndex}`;
            localStorage.removeItem(key);
          }
        } catch (e) { console.warn("Cleanup check failed", e); }
      };
      checkAndCleanup();
    }
  }, [swept, refundPending, campaign.pda, positionIndex, burnerKeypair, connection]);

  // Poll every 5s while polling=true
  useEffect(() => {
    if (!polling || !burnerKeypair || swept) return;
    const interval = setInterval(checkStatus, 5000);
    return () => clearInterval(interval);
  }, [polling, burnerKeypair, swept, recipientAddr]); // eslint-disable-line

  if (!campaign || positionIndex === undefined) return null;

  function handleAddrChange(v) {
    setRecipientAddr(v);
    recipientRef.current = v;
    setPolling(false);
    setVaultBalance(0);
    setSwept(false);
    sweepingRef.current = false;
    sweptRef.current    = false;
    setAutoStatus('');
    setAddrError('');
    if (v.trim()) {
      try { new PublicKey(v.trim()); } catch { setAddrError('Invalid Solana address'); }
    }
  }

  const checkStatus = async () => {
    if (!burnerKeypair || sweptRef.current || sweepingRef.current) return;
    setIsChecking(true);
    try {
      const bPub = burnerKeypair.publicKey;
      
      // 1. Transaction Scanning (Deterministic check)
      const sigs = await connection.getSignaturesForAddress(bPub, { limit: 5 });
      let validDeposit = false;
      let totalReceived = 0;
      
      for (const sig of sigs) {
        const tx = await connection.getParsedTransaction(sig.signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
        if (!tx || tx.meta?.err) continue;
        for (const ix of tx.transaction.message.instructions) {
          if (ix.parsed?.type === "transfer" && ix.parsed?.info?.destination === bPub.toBase58()) {
             totalReceived += ix.parsed.info.lamports;
          }
        }
      }
      
      setVaultBalance(totalReceived);
      
      // Validation logic:
      // - Target: price + buffer (0.01 SOL) -> what we want
      // - Minimum: price + gas_margin (0.001 SOL) -> what we accept to proceed
      const targetLamports  = lamports + Math.floor(CEX_FEE_BUFFER_SOL * LAMPORTS_PER_SOL);
      const minimumLamports = lamports + Math.floor(CEX_MIN_GAS_SOL * LAMPORTS_PER_SOL);

      if (totalReceived >= minimumLamports) {
        validDeposit = true;
      } else if (totalReceived > 0 && totalReceived < minimumLamports) {
        // Partial payment detected — notify user but keep polling
        const shortfall = ((targetLamports - totalReceived) / 1e9).toFixed(4);
        setAutoStatus(`⚠️ Received ${(totalReceived/1e9).toFixed(4)} SOL — need ${shortfall} more SOL`);
      }

      // Check if position already filled on-chain
      const mockWallet = { publicKey: bPub };
      const provider   = new AnchorProvider(connection, mockWallet, { commitment: 'confirmed' });
      const account    = await fetchCampaign(provider, campaign.pda);
      const currentOwner = account?.positions[positionIndex]?.owner?.toBase58();

      if (currentOwner && currentOwner !== '11111111111111111111111111111111') {
        if (currentOwner === recipientAddr) {
          sweptRef.current = true;
          setSwept(true);
          onSuccess(campaignAccountToDisplay(campaign.pda, account));
          toast(`✅ Position #${String(positionIndex).padStart(2,'0')} secured!`, 'success');
          setTimeout(onClose, 2000);
          return;
        } else if (totalReceived > 0) {
          // Position taken by someone else -> Refund
          await executeRefund(provider, bPub, totalReceived);
          return;
        }
      }

      if (validDeposit && !sweptRef.current) {
        await executePurchase(provider, bPub);
      }

    } catch (e) {
      if (sweptRef.current) return; // Silenciar falsos positivos post-éxito
      const msg = e?.message || (Object.keys(e || {}).length === 0 ? "Network/RPC timeout" : e?.toString());
      console.error('[BCF-CEX] Status check failed:', msg, e);
    } finally {
      setIsChecking(false);
      setLastChecked(Date.now());
    }
  };

  const executePurchase = async (provider, bPub) => {
    sweepingRef.current = true;
    setSweeping(true);
    setAutoStatus('Assigning position on-chain...');
    try {
      // Mock wallet provider with Burner Keypair signing
      const signTransaction = async (tx) => { tx.sign(burnerKeypair); return tx; };
      const signAllTransactions = async (txs) => { txs.forEach(tx => tx.sign(burnerKeypair)); return txs; };
      provider.wallet = { publicKey: bPub, signTransaction, signAllTransactions };

      const { account } = await buyPositionOnChain(provider, {
        campaignPDA: campaign.pda,
        positionIndex,
        recipient: recipientAddr,
        signers: [burnerKeypair]
      });

      // Refund remaining balance (change) if it exceeds the minimum refund threshold
      // Refund remaining balance (change) while retaining the Crank Reserve
      try {
        const bal = await connection.getBalance(bPub);
        const reserve = Math.floor(CEX_CRANK_RESERVE_SOL * LAMPORTS_PER_SOL);
        // Reserve 5000 lamports for the refund TX fee itself, plus the Crank Reserve
        const refundable = bal - 5000 - reserve;

        if (refundable > CEX_MIN_REFUND_LAMPORTS) {
           // Worth sending back — partial refund (leaving the reserve for auto-crank)
           const refundTx = new Transaction().add(SystemProgram.transfer({ fromPubkey: bPub, toPubkey: new PublicKey(recipientAddr), lamports: refundable }));
           refundTx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
           refundTx.feePayer = bPub;
           refundTx.sign(burnerKeypair);
           await connection.sendRawTransaction(refundTx.serialize());
           const changeSOL = (refundable / 1e9).toFixed(6);
           toast(`💸 Change of ${changeSOL} SOL refunded. Retaining gas for auto-payout.`, 'info');
        } else {
           toast(`✅ Position secured! Retaining remaining SOL for auto-payout gas.`, 'info');
        }
      } catch (e) { console.warn("Change refund failed", e); }

      sweptRef.current = true;
      setSwept(true);
      setAutoStatus('');
      saveCEXPosition(campaign.pda, positionIndex, recipientAddr, { title: campaign.title, tokenSymbol: campaign.tokenSymbol, positionPriceSOL: campaign.positionPriceSOL });
      toast(`✅ Position #${String(positionIndex).padStart(2,'0')} secured on-chain!`, 'success');
      onSuccess(campaignAccountToDisplay(campaign.pda, account));
      setTimeout(onClose, 2500);
    } catch (e) {
      setAutoStatus('');
      const m = e.message || '';
      if (m.includes('PositionTaken')) {
        await executeRefund(provider, bPub, await connection.getBalance(bPub));
      } else {
        toast('Auto-sweep failed: ' + m.slice(0, 80), 'error');
      }
    } finally {
      sweepingRef.current = false;
      setSweeping(false);
    }
  };

  const executeRefund = async (provider, bPub, bal) => {
    if (bal <= 5000) return;
    const refundable = bal - 5000;
    if (refundable < CEX_MIN_REFUND_LAMPORTS) {
      // Dust — not worth a refund TX
      console.warn('[BCF-CEX] Refund amount too small to justify TX fee, skipping.', refundable);
      return;
    }
    setRefundPending(true);
    setPolling(false);
    toast('⚠️ Position taken by another user. Refunding your payment automatically...', 'error');
    try {
      const refundTx = new Transaction().add(SystemProgram.transfer({ fromPubkey: bPub, toPubkey: new PublicKey(recipientAddr), lamports: refundable }));
      refundTx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
      refundTx.feePayer = bPub;
      refundTx.sign(burnerKeypair);
      await connection.sendRawTransaction(refundTx.serialize());
      const refundSOL = (refundable / 1e9).toFixed(4);
      toast(`✅ Refund of ${refundSOL} SOL complete. Returned to your address.`, 'success');
    } catch (e) {
      console.error("Refund failed", e);
      toast('⚠️ Auto-refund failed. Contact support with your transaction details.', 'error');
    }
  };

  async function handleManualCheck() {
    if (!burnerKeypair) return;
    toast("Checking payment status...", "info");
    await checkStatus();
  }

  const totalRequiredSOL = (price + CEX_FEE_BUFFER_SOL).toFixed(4); // e.g. 0.0210 when price=0.0200
  const vaultReady = vaultBalance >= (lamports + Math.floor(CEX_FEE_BUFFER_SOL * LAMPORTS_PER_SOL));
  const currentStep = swept ? 4 : vaultReady ? 3 : burnerKeypair ? 2 : 1;
  const vaultAddress = burnerKeypair?.publicKey.toBase58();

  if (refundPending) {
    return (
      <div style={{ display:'flex', flexDirection:'column', gap:'14px' }}>
        <div style={{ padding:'24px 20px', background:'rgba(251,113,133,.07)', border:'1px solid rgba(251,113,133,.3)', borderRadius:'var(--r)', textAlign:'center' }}>
          <div style={{ fontSize:'3rem', marginBottom:'12px' }}>💸</div>
          <h3 style={{ color:'var(--danger, #f87171)', marginBottom:'8px', fontWeight:700 }}>Position already taken</h3>
          <p style={{ fontSize:'.85rem', color:'var(--text2)', lineHeight:1.6 }}>
            Someone else bought this position while processing your payment.<br/>
            <strong style={{ color:'var(--text)' }}>Your money is being automatically refunded.</strong>
          </p>
        </div>
        <button className="btn btn-ghost btn-full" onClick={onClose} style={{ marginTop:'4px' }}>
          Close and choose another position
        </button>
      </div>
    );
  }

  if (swept) {
    return (
      <div style={{ display:'flex', flexDirection:'column', gap:'14px' }}>
        <div style={{ padding:'24px 20px', background:'rgba(52,211,153,.05)', border:'1px solid rgba(52,211,153,.2)', borderRadius:'var(--r)', textAlign:'center' }}>
          <div style={{ fontSize:'3rem', marginBottom:'12px' }}>🎉</div>
          <h3 style={{ color:'var(--green)', marginBottom:'8px' }}>Position #{fmtPos(positionIndex)} Secured!</h3>
          <p style={{ fontSize:'.85rem', color:'var(--text2)', lineHeight:1.5 }}>
            Confirmed on-chain. If this position wins, the prize is automatically sent to your address.
          </p>
        </div>
        <button className="btn btn-primary btn-full" onClick={() => window.location.reload()}>View Campaign</button>
      </div>
    );
  }

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:'16px' }}>
      <div style={{ display:'flex', justifyContent:'space-between', marginBottom:'8px', padding:'0 10px' }}>
        {[1, 2, 3].map(step => (
          <div key={step} style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:'4px', opacity: currentStep >= step ? 1 : 0.3 }}>
            <div style={{ 
              width:'24px', height:'24px', borderRadius:'50%', background: currentStep > step ? 'var(--green)' : currentStep === step ? 'var(--accent)' : 'var(--bg3)',
              color: currentStep >= step ? '#fff' : 'var(--text3)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'.7rem', fontWeight:700,
              border: currentStep === step ? '2px solid rgba(56,189,248,.3)' : 'none', transition:'all .3s ease'
            }}>
              {currentStep > step ? '✓' : step}
            </div>
            <div style={{ fontSize:'.55rem', color:'var(--text3)', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.5px' }}>
              {step === 1 ? 'Address' : step === 2 ? 'Pay' : 'Secure'}
            </div>
          </div>
        ))}
      </div>

      <div style={{ padding:'10px 14px', background:'rgba(56,189,248,.06)', border:'1px solid rgba(56,189,248,.18)', borderRadius:'var(--r)', fontSize:'.78rem', color:'var(--accent)', lineHeight:1.55 }}>
        <strong>No Wallet Needed:</strong> The system creates a temporary Burner Wallet for you. Just send SOL from any exchange!
      </div>

      <div style={{ opacity: currentStep > 1 ? 0.7 : 1 }}>
        <div style={{ fontSize:'.7rem', color:'var(--text3)', marginBottom:'5px' }}>Step 1 — Your Solana address (will receive the position)</div>
        <input
          type="text"
          value={recipientAddr}
          onChange={e => handleAddrChange(e.target.value)}
          placeholder="Enter your Solana wallet address…"
          style={{ width:'100%', padding:'10px 13px', background:'var(--bg2)', border:'1px solid var(--border2)', borderRadius:'var(--r)', fontFamily:'var(--mono)', fontSize:'.75rem', color:'var(--text)', boxSizing:'border-box' }}
          disabled={!!vaultAddress}
        />
        {addrError && <p style={{ fontSize:'.7rem', color:'var(--danger)', marginTop:'4px' }}>{addrError}</p>}
      </div>

      {vaultAddress && !vaultReady && (
        <div>
          <div style={{ fontSize:'.7rem', color:'var(--text3)', marginBottom:'5px' }}>
            Step 2 — Send SOL to this one-time address
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:'8px', padding:'10px 13px', background:'var(--bg2)', border:'1px solid var(--border2)', borderRadius:'var(--r)' }}>
            <span style={{ flex:1, fontFamily:'var(--mono)', fontSize:'.72rem', color:'var(--text2)', wordBreak:'break-all' }}>{vaultAddress}</span>
            <button className="btn btn-ghost btn-sm" onClick={() => copy(vaultAddress, 'vault-addr')}>{copied==='vault-addr'?'✓':'Copy'}</button>
          </div>
          <div style={{ marginTop:'6px', padding:'10px 13px', background:'rgba(251,191,36,.05)', border:'1px solid rgba(251,191,36,.2)', borderRadius:'var(--r)', fontSize:'.73rem', lineHeight:1.65, color:'var(--text2)' }}>
            <span style={{ color:'var(--amber)', fontWeight:700 }}>💸 Please send:</span><br/>
            • Send exactly: <strong style={{ fontFamily:'var(--mono)', color:'var(--accent)' }}>{(lamports/1e9 + CEX_FEE_BUFFER_SOL).toFixed(4)} SOL</strong><br/>
            • Includes <strong style={{ color:'var(--text)' }}>0.0100 SOL</strong> safe buffer for exchange fees & auto-payout gas.<br/>
            • <strong>Zero-Touch:</strong> Once you pay, the system will automatically resolve and send your prize if you win.
          </div>
        </div>
      )}

      {vaultAddress && (
        <div style={{ marginTop: '4px' }}>
          <div style={{ 
            padding:'12px 16px', 
            background: vaultReady ? 'rgba(52,211,153,.08)' : 'rgba(56,189,248,.05)', 
            border:`1px solid ${vaultReady?'rgba(52,211,153,.3)':'rgba(56,189,248,.18)'}`, 
            borderRadius:'var(--r)', 
            display:'flex', 
            alignItems:'center', 
            gap:'12px' 
          }}>
            {vaultReady ? (
              <span style={{ fontSize: '1.2rem' }}>✅</span>
            ) : (
              <span className={`spin ${!polling ? 'paused' : ''}`} style={{ fontSize: '1.2rem' }}>⟳</span>
            )}
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight:600, fontSize:'.85rem', color: vaultReady ? 'var(--green)' : 'var(--accent)' }}>
                {autoStatus || (sweeping ? 'Assigning position on-chain...' : vaultReady ? 'Payment detected — assigning...' : 'Awaiting payment...')}
              </div>
              <div style={{ fontSize:'.72rem', color:'var(--text3)', lineHeight: 1.3 }}>
                {vaultReady
                  ? 'Do not close this window — transaction in progress'
                  : `Currently: ${(vaultBalance / 1e9).toFixed(4)} / ${totalRequiredSOL} SOL`}
              </div>
            </div>
            {lastChecked && (
              <div style={{ fontSize: '.65rem', color: 'var(--text3)', textAlign: 'right' }}>
                Synced {new Date(lastChecked).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </div>
            )}
          </div>

          {!vaultReady && (
            <button 
              className="btn btn-ghost btn-full" 
              onClick={handleManualCheck} 
              disabled={isChecking || !vaultAddress}
              style={{ marginTop: '8px', fontSize: '.75rem', height: '32px' }}
            >
              {isChecking ? 'Checking...' : 'Check Payment Now'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────
export default function CampaignPage() {
  const { id }                             = useParams();
  const { connected, publicKey }           = useWallet();
  const anchorWallet                       = useAnchorWallet();
  const { connection }                     = useConnection();
  const { setVisible }                     = useWalletModal();
  const navigate                           = useNavigate();
  const toast                              = useToast();

  const [campaign,    setCampaign]    = useState(null);
  const [token,       setToken]       = useState(null);
  const [showDeposit, setShowDeposit] = useState(false);
  const [showBuy,     setShowBuy]     = useState(false);
  const [selectedPos, setSelectedPos] = useState(null);
  const [settling,    setSettling]    = useState(false);
  const [balance,     setBalance]     = useState(null);

  // Live countdown
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(()=>tick(n=>n+1), 1000); return ()=>clearInterval(t); }, []);

  // Serverless Auto-Crank (Background process for Resolve & Payout)
  useBrowserCrank(campaign, connection, anchorWallet, toast, setCampaign);

  useEffect(() => {
    async function load() {
      try {
        const mockWallet = { publicKey: new PublicKey("11111111111111111111111111111111") };
        const provider = new AnchorProvider(connection, mockWallet, { commitment: "confirmed" });
        
        // 1. Fetch Campaign (Primary Data)
        const account = await fetchCampaign(provider, id);
        if (!account) { navigate("/explore"); return; }
        
        const mintStr = account.tokenMint.toBase58();
        const localToken = getToken(mintStr);
        const campaignDisplay = campaignAccountToDisplay(id, account, localToken);
        setCampaign(campaignDisplay);

        // 2. Fetch Project Identity (Secondary Data - Non-blocking)
        try {
          const projIdx = account.projectIndex?.toNumber?.() ?? 0;
          const project = await fetchProject(provider, account.creator.toBase58(), projIdx);
          if (project) {
            setToken({
              mint: typeof project.tokenMint === "string" ? project.tokenMint : project.tokenMint?.toBase58?.() ?? "",
              symbol: project.symbol,
              name: project.name,
              feeModeName: project.feeModeName,
              treasury: {
                balanceSOL: project.treasury?.balanceSOL ?? 0,
              }
            });
            setCampaign(prev => ({ ...prev, tokenSymbol: project.symbol, tokenName: project.name }));
          }
        } catch (projErr) {
          console.warn("[BCF] Project identity fetch skipped (rate limiting?):", projErr.message || projErr);
          if (localToken) {
            setToken({
              mint: localToken.mint,
              symbol: localToken.symbol,
              name: localToken.name
            });
            setCampaign(prev => ({ ...prev, tokenSymbol: localToken.symbol, tokenName: localToken.name }));
          } else {
            // Fallback minimal token info from campaign data
            setToken({
              mint: mintStr,
              symbol: "???",
              name: "Bags Token"
            });
          }
        }
      } catch (e) {
        console.error("[BCF] Critical error loading campaign:", e.message || e);
        // If it's a 429, we might want to tell the user to wait
        if (e.message?.includes("429")) {
          toast("Rate limited by Solana RPC. Retrying in a moment...", "error");
        }
      }
    }
    load();
  }, [id, connection]);

  useEffect(() => {
    if (connected && publicKey) getSOLBalance(publicKey.toBase58()).then(setBalance);
    else setBalance(null);
  }, [connected, publicKey]);

  if (!campaign) return <div style={{ padding:"80px", textAlign:"center" }}><span className="spin" style={{ fontSize:"1.5rem" }}>⟳</span></div>;

  const isCreator = connected && publicKey?.toBase58()===campaign.creatorWallet;
  const expired   = campaign ? isExpired(campaign) : false;
  const sold      = posStatus(campaign);
  const pot       = totalPot(campaign);
  const isSettled = campaign.status==="settled";
  const myPositions = connected && publicKey
    ? campaign.positions.filter(p=>p.owner===publicKey.toBase58()).map(p=>p.index)
    : [];

  function handlePosClick(idx) {
    if (campaign.status!=="active") { toast("Campaign not active", "info"); return; }
    if (expired) { toast("Campaign has ended", "info"); return; }
    if (isSettled) return;
    if (campaign.positions[idx].owner) { toast(`Position #${fmtPos(idx)} is taken`, "info"); return; }
    setSelectedPos(idx); setShowBuy(true);
  }

  async function handleSettle() {
    if (!connected) { setVisible(true); return; }
    setSettling(true);
    toast("Finalizing draw on-chain...", "info");
    try {
      const provider = new AnchorProvider(connection, anchorWallet, { commitment: "confirmed" });
      const { tx, account } = await resolveCampaignOnChain(provider, { campaignPDA: campaign.pda });
      
      const updated = campaignAccountToDisplay(campaign.pda, account);
      setCampaign(updated);
      
      if (updated.winnerWallet) {
        toast(`🏆 Winner: Position #${updated.winningPosition < 10 ? '0' + updated.winningPosition : updated.winningPosition} wins!`, "success", 10000);
      } else {
        toast(`🎲 No winner — SOL remains in project treasury.`, "info", 9000);
      }
    } catch(e) {
      toast("Settlement error: " + e.message, "error");
    } finally { setSettling(false); }
  }

  async function handleClaim() {
    if (!connected) { setVisible(true); return; }
    setSettling(true);
    toast("Claiming prize...", "info");
    try {
      const provider = new AnchorProvider(connection, anchorWallet, { commitment: "confirmed" });
      await claimPrizeOnChain(provider, { campaignPDA: campaign.pda });
      toast("Prize sent to your wallet! 🥳", "success");
      // Refresh
      const account = await fetchCampaign(provider, campaign.pda);
      setCampaign(campaignAccountToDisplay(campaign.pda, account));
    } catch (e) {
      toast("Claim error: " + e.message, "error");
    } finally { setSettling(false); }
  }

  async function handleRoute() {
    if (!connected) { setVisible(true); return; }
    setSettling(true);
    toast("Moving funds to treasury...", "info");
    try {
      const provider = new AnchorProvider(connection, anchorWallet, { commitment: "confirmed" });
      await routeToTreasuryOnChain(provider, { campaignPDA: campaign.pda });
      toast("Funds transferred to project treasury ✅", "success");
      // Refresh
      const account = await fetchCampaign(provider, campaign.pda);
      setCampaign(campaignAccountToDisplay(campaign.pda, account));
    } catch (e) {
      toast("Transfer error: " + e.message, "error");
    } finally { setSettling(false); }
  }

  const statusBadge = {
    pending:  <span className="badge badge-pending">◐ Pending Deposit</span>,
    active:   <span className="badge badge-active">● Active</span>,
    settled:  <span className="badge badge-settled">✦ Settled</span>,
    cancelled:<span className="badge" style={{ background:"var(--bg3)", color:"var(--text3)", border:"1px solid var(--border)" }}>Cancelled</span>,
  }[campaign.status];

  return (
    <>
      {showDeposit && (
        <DepositModal campaign={campaign} connection={connection}
          onClose={()=>setShowDeposit(false)}
          onActivated={c=>{setCampaign(c);}} />
      )}
      {showBuy && selectedPos!==null && (
        <ParticipateModal campaign={campaign} positionIndex={selectedPos} connection={connection}
          onClose={()=>{setShowBuy(false);setSelectedPos(null);}}
          onSuccess={c=>{setCampaign(c); if(c.tokenMint) setToken(getToken(c.tokenMint));}} />
      )}

      {isSettled && (
        <div style={{ background:campaign.winnerWallet?"rgba(56,189,248,.04)":"rgba(52,211,153,.04)", borderBottom:`2px solid ${campaign.winnerWallet?"var(--accent)":"var(--green)"}`, padding:"28px 48px", textAlign:"center" }}>
          <div style={{ maxWidth:"760px", margin:"0 auto" }}>
            <div style={{ fontSize:"2.5rem", marginBottom:"10px" }}>{campaign.winnerWallet?"🏆":"🏦"}</div>
            <h2 style={{ fontWeight:700, fontSize:"1.4rem", marginBottom:"12px", letterSpacing:"-.02em" }}>
              {campaign.winnerWallet ? "We have a winner!" : "No winner — funds go to treasury"}
            </h2>
            
            {campaign.winnerWallet ? (
              <div style={{ marginBottom:"16px" }}>
                <div style={{ display:"flex", justifyContent:"center", alignItems:"center", gap:"20px", flexWrap:"wrap", marginBottom:"12px" }}>
                  <div style={{ display:"flex", alignItems:"center", gap:"8px" }}>
                    <span style={{ fontSize:".82rem", color:"var(--text3)" }}>Winning position:</span>
                    <a href={explorerAddr(campaign.pda)} target="_blank" rel="noopener noreferrer" style={{ textDecoration:"none" }}>
                      <span style={{ fontFamily:"var(--mono)", fontSize:"1.5rem", fontWeight:700, color:"var(--accent)", background:"var(--bg2)", padding:"4px 14px", borderRadius:"8px", cursor:"pointer" }} title="View Campaign on Explorer">
                        #{fmtPos(campaign.winningPosition)}
                      </span>
                    </a>
                  </div>
                  <div style={{ display:"flex", alignItems:"center", gap:"6px" }}>
                    <span style={{ fontSize:".82rem", color:"var(--text3)" }}>Winner:</span>
                    <a href={explorerAddr(campaign.winnerWallet)} target="_blank" rel="noopener noreferrer" style={{ fontFamily:"var(--mono)", color:"var(--green)", fontWeight:600, textDecoration:"none" }} title="View Winner on Explorer">
                      {shortAddr(campaign.winnerWallet, 6)}
                    </a>
                    <button 
                      onClick={() => { navigator.clipboard.writeText(campaign.winnerWallet); toast("Address copied!", "success"); }}
                      style={{ background:"none", border:"none", color:"var(--text3)", cursor:"pointer", fontSize:".8rem", padding:"2px" }}
                      title="Copy full address"
                    >
                      📋
                    </button>
                  </div>
                </div>

                <div style={{ 
                  padding:"16px", 
                  background:"linear-gradient(135deg, rgba(56,189,248,.1) 0%, rgba(56,189,248,.05) 100%)", 
                  border:"1px solid rgba(56,189,248,.3)", 
                  borderRadius:"8px", 
                  marginBottom:"12px" 
                }}>
                  <div style={{ fontSize:"1.1rem", fontWeight:700, color:"var(--accent)", marginBottom:"8px", display:"flex", alignItems:"center", justifyContent:"center", gap:"8px" }}>
                    🏆 Prize Won: {(campaign.totalPayout||pot).toFixed(3)} SOL (≈${toUSDC(campaign.totalPayout||pot)})
                  </div>
                  
                  <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(140px, 1fr))", gap:"12px", fontSize:".75rem" }}>
                    <div style={{ textAlign:"center", padding:"8px", background:"var(--bg2)", borderRadius:"4px" }}>
                      <div style={{ color:"var(--text3)", marginBottom:"2px" }}>Base Prize</div>
                      <div style={{ fontFamily:"var(--mono)", color:"var(--text)", fontWeight:600 }}>
                        {campaign.prizeSOL?.toFixed(3)} SOL
                      </div>
                    </div>
                    <div style={{ textAlign:"center", padding:"8px", background:"var(--bg2)", borderRadius:"4px" }}>
                      <div style={{ color:"var(--text3)", marginBottom:"2px" }}>From Positions</div>
                      <div style={{ fontFamily:"var(--mono)", color:"var(--text)", fontWeight:600 }}>
                        {campaign.totalCollectedSOL?.toFixed(3)} SOL
                      </div>
                    </div>
                    <div style={{ textAlign:"center", padding:"8px", background:"rgba(56,189,248,.1)", borderRadius:"4px" }}>
                      <div style={{ color:"var(--text3)", marginBottom:"2px" }}>Total Payout</div>
                      <div style={{ fontFamily:"var(--mono)", color:"var(--accent)", fontWeight:700 }}>
                        {(campaign.totalPayout||pot).toFixed(3)} SOL
                      </div>
                    </div>
                  </div>
                </div>

                <div style={{ fontSize:".7rem", color:"var(--text3)", fontFamily:"var(--mono)", wordBreak:"break-all", background:"var(--bg2)", padding:"8px", borderRadius:"4px", border:"1px solid var(--border2)", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                  <span>Winner address: {campaign.winnerWallet}</span>
                  <a href={explorerAddr(campaign.winnerWallet)} target="_blank" rel="noopener noreferrer" style={{ color:"var(--accent)", fontSize:".8rem", marginLeft:"8px" }} title="View on Solana Explorer">↗</a>
                </div>
              </div>
            ) : (
              <div style={{ display:"flex", justifyContent:"center", alignItems:"center", gap:"20px", flexWrap:"wrap", marginBottom:"10px" }}>
                <div style={{ display:"flex", alignItems:"center", gap:"8px" }}>
                  <span style={{ fontSize:".82rem", color:"var(--text3)" }}>Winning position:</span>
                  <a href={explorerAddr(campaign.pda)} target="_blank" rel="noopener noreferrer" style={{ textDecoration:"none" }}>
                    <span style={{ fontFamily:"var(--mono)", fontSize:"1.5rem", fontWeight:700, color:"var(--accent)", background:"var(--bg2)", padding:"4px 14px", borderRadius:"8px", cursor:"pointer" }} title="View Campaign on Explorer">
                      #{fmtPos(campaign.winningPosition)}
                    </span>
                  </a>
                </div>
                <div style={{ display:"flex", alignItems:"center", gap:"6px" }}>
                  <span style={{ fontSize:".82rem", color:"var(--text3)" }}>Added to treasury:</span>
                  <span style={{ fontFamily:"var(--mono)", fontWeight:700, color:"var(--green)" }}>
                    {(campaign.totalPayout||pot).toFixed(3)} SOL (≈${toUSDC(campaign.totalPayout||pot)})
                  </span>
                </div>
              </div>
            )}

            {campaign.winningBlockHash && (
              <div style={{ fontSize:".7rem", color:"var(--text3)", fontFamily:"var(--mono)", display:"flex", alignItems:"center", justifyContent:"center", gap:"6px" }}>
                Block hash: {campaign.winningBlockHash.slice(0,32)}...
                <a href={explorerBlock(campaign.winningBlockHash)} target="_blank" rel="noopener noreferrer" style={{ color:"var(--accent)", fontSize:".8rem" }} title="Verify Block on Solana Explorer">↗</a>
              </div>
            )}
            {campaign.winnerWallet && myPositions.includes(campaign.winningPosition) && (
              <div style={{ marginTop:"16px", display:"flex", flexDirection:"column", alignItems:"center", gap:"10px" }}>
                <div style={{ padding:"14px 20px", background:"rgba(56,189,248,.1)", border:"1px solid rgba(56,189,248,.3)", borderRadius:"var(--r)", fontWeight:700, color:"var(--accent)", fontSize:"1rem" }}>
                  🏆 Congratulations — you won this round!
                </div>
                <button className="btn btn-primary" onClick={handleClaim} disabled={settling}>
                  {settling ? "Processing..." : "⚡ Claim Prize"}
                </button>
              </div>
            )}
            {/* CEX winner — verificado on-chain, no en localStorage ─────────────
              Lógica:
              1. campaign.winningPosition → posición ganadora (on-chain, inmutable)
              2. campaign.positions[wp].owner → dueño on-chain (on-chain, inmutable)
              3. localStorage → solo hint del recipientAddr que usó el usuario
              4. SOLO mostramos el banner si owner on-chain === recipientAddr local
              Atacar localStorage no muestra el banner porque la verificación
              real es el campo `owner` de la posición ganadora en el blockchain.
            */}
            {(() => {
              if (campaign.status !== "settled" || campaign.winningPosition == null) return null;
              // myPositions ya maneja el caso de wallet conectada
              if (myPositions.includes(campaign.winningPosition)) return null;

              // Obtener hint de recipientAddr desde localStorage
              const hint = getCEXPositionForCampaign(campaign.pda, campaign.winningPosition);
              if (!hint?.recipientAddr) return null;

              // Verificar on-chain: el dueño de la posición ganadora debe coincidir
              // campaign.positions viene del fetch on-chain en programClient.js
              const winPos = campaign.positions?.[campaign.winningPosition];
              const onChainOwner = winPos?.owner; // PublicKey string, from blockchain
              if (!onChainOwner || onChainOwner === '11111111111111111111111111111111') return null;
              if (onChainOwner !== hint.recipientAddr) return null; // no match → no banner

              // ✅ Verificado: on-chain owner === localStorage recipientAddr
              return (
                <div style={{ marginTop:"16px", padding:"18px 22px", background:"rgba(251,191,36,.08)", border:"2px solid rgba(251,191,36,.35)", borderRadius:"var(--r)", textAlign:"center" }}>
                  <div style={{ fontSize:"2rem", marginBottom:"8px" }}>🏆</div>
                  <div style={{ fontWeight:700, color:"var(--amber)", fontSize:"1rem", marginBottom:"8px" }}>You won via Exchange payment!</div>
                  <p style={{ fontSize:".82rem", color:"var(--text2)", lineHeight:1.6, marginBottom:"10px" }}>
                    Position <strong style={{ color:"var(--amber)" }}>#{String(campaign.winningPosition).padStart(2,'0')}</strong> won.
                    Prize is being sent automatically to:
                  </p>
                  <div style={{ padding:"8px 12px", background:"var(--bg2)", border:"1px solid var(--border2)", borderRadius:"var(--r)", fontFamily:"var(--mono)", fontSize:".75rem", wordBreak:"break-all", color:"var(--accent)", marginBottom:"8px" }}>
                    {hint.recipientAddr}
                  </div>
                  <div style={{ fontSize:".7rem", padding:"6px 10px", background:"rgba(52,211,153,.06)", border:"1px solid rgba(52,211,153,.2)", borderRadius:"6px", color:"var(--green)", marginBottom:"8px" }}>
                    ✅ Verified on-chain: position owner matches your address
                  </div>
                  <p style={{ fontSize:".7rem", color:"var(--text3)" }}>No action needed — the watcher sends the prize automatically.</p>
                </div>
              );
            })()}
            {!campaign.winnerWallet && isCreator && (
              <div style={{ marginTop:"16px", display:"flex", flexDirection:"column", alignItems:"center", gap:"10px" }}>
                {campaign.prizeSOL > 0 ? (
                  <>
                    <button className="btn btn-secondary" onClick={handleRoute} disabled={settling}>
                      {settling ? "Processing..." : "🏦 Move Funds to Treasury"}
                    </button>
                    <p style={{ fontSize:".75rem", color:"var(--text3)" }}>As there was no winner, you can move the SOL to your project's treasury.</p>
                  </>
                ) : (
                  <div style={{ padding:"10px 20px", background:"rgba(52,211,153,.1)", border:"1px solid rgba(52,211,153,.2)", borderRadius:"var(--r)", color:"var(--green)", fontWeight:600 }}>
                    ✅ Funds have been successfully moved to the project treasury.
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      <div style={{ padding:"38px 28px", maxWidth:"1150px", margin:"0 auto" }}>
        <Link to="/explore" style={{ color:"var(--text3)", fontSize:".82rem", display:"inline-flex", alignItems:"center", gap:"5px", marginBottom:"26px" }}>← All Campaigns</Link>

        <div style={{ display:"grid", gridTemplateColumns:"1fr 360px", gap:"32px", alignItems:"start" }}>

          {/* LEFT */}
          <div>
            <div style={{ display:"flex", alignItems:"center", gap:"8px", marginBottom:"12px", flexWrap:"wrap" }}>
              {statusBadge}
              <span style={{ fontSize:".6rem", fontWeight:700, padding:"2px 7px", borderRadius:"4px", background: IS_MAINNET?"rgba(52,211,153,.12)":"rgba(167,139,250,.12)", color: IS_MAINNET?"var(--green)":"var(--purple)", border:`1px solid ${IS_MAINNET?"rgba(52,211,153,.3)":"rgba(167,139,250,.3)"}` }}>{IS_MAINNET?"Mainnet":"DevNet"}</span>
              {token?.symbol && <span className="badge badge-bags">${token.symbol}</span>}
            </div>

            <h1 style={{ fontSize:"2.1rem", fontWeight:700, letterSpacing:"-.04em", lineHeight:1.1, marginBottom:"14px" }}>{sanitizeText(campaign.title)}</h1>
            <p style={{ color:"var(--text2)", lineHeight:1.7, marginBottom:"28px", fontSize:".95rem" }}>{sanitizeText(campaign.description)}</p>

            {/* Position grid */}
            <div style={{ marginBottom:"28px" }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"10px", flexWrap:"wrap", gap:"8px" }}>
                <h3 style={{ fontWeight:700, fontSize:".95rem" }}>Funding Positions (00–99)</h3>
                <span style={{ fontSize:".76rem", color:"var(--text3)" }}>
                  <strong style={{ color:"var(--accent)" }}>{sold}</strong>/100 filled · {campaign.positionPriceSOL} SOL (≈${toUSDC(campaign.positionPriceSOL)}) each
                </span>
              </div>

              {/* Legend */}
              <div style={{ display:"flex", gap:"16px", marginBottom:"10px", flexWrap:"wrap" }}>
                {[
                  ["var(--bg2)", "Available — click to participate"],
                  ["rgba(56,189,248,.2)", "Filled"],
                  ["rgba(56,189,248,.38)", "Mine"],
                  ...(isSettled?[["var(--accent)","Winner"]]:[]),
                ].map(([bg,label])=>(
                  <div key={label} style={{ display:"flex", alignItems:"center", gap:"5px", fontSize:".7rem", color:"var(--text3)" }}>
                    <div style={{ width:11, height:11, borderRadius:2, background:bg, border:"1px solid var(--border2)" }} />
                    {label}
                  </div>
                ))}
              </div>

              <div className="pos-grid">
                {campaign.positions.map((pos,i) => {
                  const isMine   = myPositions.includes(i);
                  const isFilled = !!pos.owner;
                  const isWinner = isSettled && i===campaign.winningPosition;
                  const canClick = !isFilled && campaign.status==="active" && !expired;
                  let cls = "pos";
                  if (isWinner)     cls += " winner";
                  else if (isMine)  cls += " mine";
                  else if (isFilled)cls += " taken";
                  else if (!canClick)cls += " off";
                  return (
                    <div key={i} className={cls} onClick={()=>canClick&&handlePosClick(i)}
                      title={isFilled?`${shortAddr(pos.owner)}`:canClick?`Participate for ${campaign.positionPriceSOL} SOL`:fmtPos(i)}>
                      {isWinner ? (
                        <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:"0px", height: "100%", justifyContent: "center" }}>
                          <span style={{ fontSize: "1.1rem" }}>🏆</span>
                          <span style={{ fontSize: ".55rem", fontWeight: 800, marginTop: "-2px" }}>{(campaign.totalPayout||pot).toFixed(2)}</span>
                        </div>
                      ) : fmtPos(i)}
                    </div>
                  );
                })}
              </div>

              {myPositions.length>0 && (
                <div style={{ marginTop:"10px", padding:"9px 13px", background:"rgba(56,189,248,.05)", border:"1px solid rgba(56,189,248,.15)", borderRadius:"var(--r)", fontSize:".78rem", color:"var(--text2)" }}>
                  Your positions:{" "}
                  {myPositions.map(n=>(
                    <span key={n} style={{ fontFamily:"var(--mono)", fontWeight:700, color:"var(--accent)", marginLeft:"6px" }}>#{fmtPos(n)}</span>
                  ))}
                  {isSettled && myPositions.includes(campaign.winningPosition) && (
                    <span style={{ marginLeft:"10px", fontWeight:700, color:"var(--green)" }}>🏆 You won!</span>
                  )}
                </div>
              )}
            </div>

            {/* Token card */}
            {token && (
              <div style={{ padding:"20px 22px", background:"var(--bg1)", border:"1px solid var(--border)", borderRadius:"var(--rl)", marginBottom:"24px" }}>
                <div style={{ display:"flex", alignItems:"center", gap:"9px", marginBottom:"14px" }}>
                  <div style={{ width:22, height:22, background:"linear-gradient(135deg,var(--accent2),var(--accent))", borderRadius:5, display:"flex", alignItems:"center", justifyContent:"center" }}>
                    <span style={{ fontFamily:"var(--mono)", fontSize:".5rem", fontWeight:700, color:"#000" }}>BCF</span>
                  </div>
                  <span style={{ fontWeight:700, fontSize:".95rem" }}>Bags Token — ${token.symbol}</span>
                </div>
                <div className="grid-3" style={{ marginBottom:"12px" }}>
                  {[
                    ["Symbol",    "$"+token.symbol,                  "var(--accent)", true ],
                    ["Per pos.",  `${campaign.tokensPerPosition?.toLocaleString()||0}`, "var(--text)", false],
                    ["Fee mode",  token.feeModeName||"Standard 2%", "var(--green)", false],
                  ].map(([l,v,c,mono])=>(
                    <div key={l} style={{ padding:"10px 12px", background:"var(--bg2)", borderRadius:"var(--r)" }}>
                      <div style={{ fontSize:".65rem", color:"var(--text3)", textTransform:"uppercase", letterSpacing:".06em", marginBottom:"4px" }}>{l}</div>
                      <div style={{ fontWeight:700, fontSize:".85rem", color:c, fontFamily:mono?"var(--mono)":"inherit" }}>{v}</div>
                    </div>
                  ))}
                </div>
                <div style={{ fontSize:".73rem", color:"var(--text3)", fontFamily:"var(--mono)", wordBreak:"break-all", marginBottom:"10px" }}>{token.mint}</div>
                <div style={{ fontSize:".78rem", color:"var(--text2)", lineHeight:1.6, marginBottom:"12px" }}>
                  Tokens distributed at a <strong>fixed rate</strong> (no price fluctuation during the campaign). Creator earns trading fees on every future swap.
                </div>
                <a href={bagsTokenUrl(token.mint)} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm">Trade ${token.symbol} on Bags.fm →</a>
              </div>
            )}

            {/* Participation history */}
            <div>
              <h3 style={{ fontWeight:700, fontSize:".95rem", marginBottom:"14px", display:"flex", alignItems:"center", gap:"8px" }}>
                Participants
                <span style={{ background:"var(--bg3)", color:"var(--text3)", borderRadius:"100px", padding:"2px 9px", fontSize:".72rem", fontWeight:500 }}>{sold}</span>
              </h3>
              {sold===0 ? (
                <p style={{ color:"var(--text3)", fontSize:".82rem", fontStyle:"italic" }}>No positions filled yet.</p>
              ) : (
                <div style={{ display:"flex", flexDirection:"column", gap:"8px" }}>
                  {campaign.positions.filter(p=>p.owner).sort((a,b)=>(b.purchasedAt||0)-(a.purchasedAt||0)).map(p=>(
                    <div key={p.index} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"11px 15px", borderRadius:"var(--r)", background:isSettled&&p.index===campaign.winningPosition?"rgba(56,189,248,.07)":"var(--bg1)", border:`1px solid ${isSettled&&p.index===campaign.winningPosition?"rgba(56,189,248,.28)":"var(--border)"}` }}>
                      <div style={{ display:"flex", alignItems:"center", gap:"10px", flexWrap:"wrap" }}>
                        <span style={{ fontFamily:"var(--mono)", fontWeight:700, color:"var(--accent)", fontSize:".88rem", minWidth:"34px" }}>#{fmtPos(p.index)}</span>
                        <span style={{ fontFamily:"var(--mono)", fontSize:".73rem", color:"var(--text3)" }}>{shortAddr(p.owner)}</span>
                        {p.source==="exchange" && <span style={{ fontSize:".64rem", color:"var(--text3)", border:"1px solid var(--border)", padding:"1px 5px", borderRadius:"3px" }}>exchange</span>}
                        {isSettled&&p.index===campaign.winningPosition && <span className="badge badge-active" style={{ fontSize:".64rem", padding:"2px 7px" }}>🏆 winner</span>}
                      </div>
                      <div style={{ display:"flex", alignItems:"center", gap:"10px" }}>
                        <span style={{ fontFamily:"var(--mono)", fontSize:".78rem", color:"var(--accent)", fontWeight:700 }}>+{(p.tokensReceived||0).toLocaleString()} ${token?.symbol || "???"}</span>
                        {p.txSignature && <a href={explorerTx(p.txSignature)} target="_blank" rel="noopener noreferrer" style={{ fontSize:".68rem", color:"var(--text3)" }}>↗</a>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {campaign.showDonation && campaign.donationAddress && (
              <div style={{ marginTop:"22px", padding:"14px 18px", background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:"var(--r)" }}>
                <div style={{ fontSize:".72rem", color:"var(--text3)", marginBottom:"5px" }}>💙 Direct donations (optional):</div>
                <div style={{ fontFamily:"var(--mono)", fontSize:".78rem", wordBreak:"break-all", color:"var(--text2)" }}>{campaign.donationAddress}</div>
              </div>
            )}
          </div>

          {/* RIGHT — stats panel */}
          <div style={{ position:"sticky", top:"80px" }}>
            <div className="card" style={{ padding:"26px" }}>
              <div style={{ marginBottom:"5px" }}>
                <div style={{ fontSize:".7rem", color:"var(--text3)", textTransform:"uppercase", letterSpacing:".06em", marginBottom:"5px" }}>Total prize pool</div>
                <div style={{ fontFamily:"var(--mono)", fontSize:"2rem", fontWeight:700, color:"var(--accent)", letterSpacing:"-.03em" }}>{pot.toFixed(3)} SOL</div>
                <div style={{ fontSize:".74rem", color:"var(--text3)", marginTop:"2px" }}>≈ ${toUSDC(pot)} USDC</div>
                <div style={{ fontSize:".72rem", color:"var(--text3)", marginTop:"4px" }}>{campaign.prizeSOL} prize + {campaign.totalCollectedSOL.toFixed(3)} from positions</div>
              </div>

              <div style={{ display:"flex", gap:"2px", flexWrap:"wrap", margin:"14px 0 8px" }}>
                {campaign.positions.map((p,i)=>(
                  <div key={i} style={{ width:"10px", height:"10px", borderRadius:"2px", background:isSettled&&i===campaign.winningPosition?"var(--accent)":p.owner?"rgba(56,189,248,.5)":"var(--bg3)" }} />
                ))}
              </div>
              <div style={{ fontSize:".76rem", fontWeight:700, color:"var(--accent)", marginBottom:"14px" }}>{sold}/100 positions filled</div>

              {/* Treasury */}
              {token && (
                <div className="treasury-bar" style={{ marginBottom:"14px" }}>
                  <div style={{ fontSize:"1rem" }}>🏦</div>
                  <div style={{ flex:1 }}>
                    <div style={{ fontSize:".72rem", color:"var(--text3)", marginBottom:"2px" }}>Project Treasury</div>
                    <div style={{ fontFamily:"var(--mono)", fontWeight:700, color:"var(--green)", fontSize:".88rem" }}>{(token.treasury?.balanceSOL||0).toFixed(4)} SOL</div>
                  </div>
                </div>
              )}

              <div className="divider" />

              {[
                ["Time left",    campaign.status==="active"?timeLeft(campaign.deadline):campaign.status==="settled"?"Settled":"Not started",
                  expired&&campaign.status==="active"?"var(--danger)":"var(--text)"],
                ["Position price",`${campaign.positionPriceSOL} SOL (≈$${toUSDC(campaign.positionPriceSOL)})`, "var(--text)"],
                ["Prize deposit", `${campaign.prizeSOL} SOL (≈$${toUSDC(campaign.prizeSOL)})`, "var(--text)"],
                ["Creator",      shortAddr(campaign.creatorWallet,5), "var(--text2)"],
              ].map(([l,v,c])=>(
                <div key={l} style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:"11px", gap:"8px" }}>
                  <span style={{ color:"var(--text3)", fontSize:".79rem", flexShrink:0 }}>{l}</span>
                  <span style={{ fontWeight:600, fontSize:".82rem", color:c, textAlign:"right", fontFamily:l==="Creator"?"var(--mono)":"inherit" }}>{v}</span>
                </div>
              ))}

              {connected && balance!==null && (
                <div style={{ padding:"8px 12px", background:"var(--bg2)", border:"1px solid var(--border2)", borderRadius:"var(--r)", display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"14px", fontSize:".78rem" }}>
                  <span style={{ color:"var(--text3)" }}>Your balance</span>
                  <span style={{ fontFamily:"var(--mono)", fontWeight:700, color:balance<campaign.positionPriceSOL?"var(--danger)":"var(--text)" }}>{balance.toFixed(4)} SOL</span>
                </div>
              )}

              <div className="divider" />

              {/* Actions */}
              {isSettled ? (
                <div style={{ display:"flex", flexDirection:"column", gap:"10px" }}>
                  <div style={{ padding:"12px", textAlign:"center", background:"var(--bg2)", borderRadius:"var(--r)", color:"var(--text2)", fontSize:".83rem" }}>Campaign complete.</div>
                  {isCreator && <Link to={`/create-campaign?token=${campaign.tokenMint}`} className="btn btn-secondary btn-full" style={{ justifyContent:"center" }}>🔁 New campaign with ${campaign.tokenSymbol}</Link>}
                </div>
              ) : campaign.status==="pending" ? (
                isCreator ? (
                  <button className="btn btn-primary btn-full" onClick={()=>setShowDeposit(true)}>💰 Deposit {campaign.prizeSOL} SOL to Activate</button>
                ) : (
                  <div style={{ padding:"12px", textAlign:"center", background:"var(--bg2)", border:"1px solid var(--border2)", borderRadius:"var(--r)", color:"var(--text3)", fontSize:".82rem" }}>Waiting for creator to deposit prize...</div>
                )
              ) : campaign.status==="active" && expired ? (
                <button className="btn btn-primary btn-full" onClick={handleSettle} disabled={settling}>
                  {settling?<span style={{ display:"flex", alignItems:"center", gap:"7px", justifyContent:"center" }}><span className="spin">⟳</span> Drawing...</span>:"🎲 Resolve Round Now"}
                </button>
              ) : campaign.status==="active" ? (
                <div style={{ display:"flex", flexDirection:"column", gap:"10px" }}>
                  {!connected ? (
                    <button className="btn btn-primary btn-full" onClick={()=>setVisible(true)}>🔌 Connect Wallet to Participate</button>
                  ) : (
                    <div style={{ padding:"10px 13px", background:"var(--bg2)", borderRadius:"var(--r)", fontSize:".78rem", color:"var(--text2)", lineHeight:1.55 }}>
                      Click any <strong style={{ color:"var(--accent)" }}>available position</strong> in the grid to participate. Or use the Address/Exchange option.
                    </div>
                  )}
                  {isCreator && (
                    <div style={{ paddingTop:"10px", borderTop:"1px solid var(--border)", textAlign:"center", fontSize:".74rem", color:"var(--text3)" }}>
                      👤 Your campaign · {100-sold} positions remaining
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
