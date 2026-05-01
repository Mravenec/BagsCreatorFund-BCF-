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
  getVaultPDA, createPositionVaultOnChain, sweepPositionVaultOnChain,
} from "../lib/programClient.js";
import { AnchorProvider } from "@coral-xyz/anchor";
import { toUSDC, TOKENS_PER_SOL, TREASURY_FEE_PCT, BCF_PROGRAM_ID, WATCHER_URL, CEX_FEE_BUFFER_SOL, IS_MAINNET, NETWORK } from "../lib/constants.js";
import { shortAddr, explorerTx, getSOLBalance, requestAirdrop } from "../lib/solana.js";
import { bagsTokenUrl } from "../lib/bags.js";
import { useToast } from "../components/Toast.jsx";
import { getToken } from "../lib/store.js";

const SOL = LAMPORTS_PER_SOL;

// ─── CEX Position Persistence ─────────────────────────────────────────────────
const CEX_STORAGE_KEY = 'bcf_cex_positions_v1';

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
      await requestAirdrop(publicKey.toBase58(), 2);
      const b = await getSOLBalance(publicKey.toBase58());
      setBalance(b);
      toast("✓ +2 SOL received!", "success");
    } catch { toast("Airdrop failed — try again in 30s", "error"); }
  }

  async function handleWalletBuy() {
    if (!connected) { setVisible(true); return; }
    
    // Refresh state first
    const provider = new AnchorProvider(connection, anchorWallet, { commitment: "confirmed" });
    const freshAccount = await fetchCampaign(provider, campaign.pda);
    if (!freshAccount || freshAccount.positions[positionIndex].filled) {
      toast(`Position #${positionIndex < 10 ? '0' + positionIndex : positionIndex} was just taken`, "error");
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
      if (/rejected|cancelled|canceled/i.test(m)) toast("Cancelled", "info");
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
              <VaultCEXTab
                campaign={campaign}
                positionIndex={positionIndex}
                price={price}
                lamports={lamports}
                connection={connection}
                anchorWallet={anchorWallet}
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


function VaultCEXTab({ campaign, positionIndex, price, lamports, connection,
                       anchorWallet, toast, copied, copy, onSuccess, onClose }) {
  const [recipientAddr, setRecipientAddr]   = useState('');
  const [addrError,     setAddrError]       = useState('');
  const [vaultPDA,      setVaultPDA]        = useState(null);
  const [vaultBalance,  setVaultBalance]    = useState(0);
  const [creating,      setCreating]        = useState(false);
  const [sweeping,      setSweeping]        = useState(false);
  const [swept,         setSwept]           = useState(false);
  const [polling,       setPolling]         = useState(false);
  const [isChecking,    setIsChecking]      = useState(false);
  const [lastChecked,   setLastChecked]     = useState(null);
  const [autoStatus,    setAutoStatus]      = useState('');   // describes what auto-action is happening

  // Refs: prevent stale-closure bugs in setInterval/async callbacks
  const sweepingRef  = useRef(false); // true while sweep TX is in-flight
  const sweptRef     = useRef(false); // true once position secured (never reset)
  const recipientRef = useRef('');    // always-current copy of recipientAddr

  // Poll every 8s while polling=true
  useEffect(() => {
    if (!polling || !vaultPDA || swept) return;
    const interval = setInterval(checkStatus, 8000);
    return () => clearInterval(interval);
  }, [polling, vaultPDA, swept, recipientAddr]); // eslint-disable-line

  // Defensive check — MUST be after all hooks
  if (!campaign || positionIndex === undefined) return null;



  // Derive vault PDA when user enters address.
  // If no wallet → auto-calls /watch-vault to pre-create the vault on-chain.
  // This ensures the vault exists before the user sends SOL, so sweepPositionVault
  // works correctly. If the watcher is down, /sweep-now still handles it via
  // createPositionVault or recordExternalPayment fallback.
  function handleAddrChange(v) {
    setRecipientAddr(v);
    recipientRef.current = v;
    setVaultPDA(null);
    setPolling(false);
    setVaultBalance(0);
    setSwept(false);
    sweepingRef.current = false;
    sweptRef.current    = false;
    setAutoStatus('');
    setAddrError('');
    if (!v.trim()) return;
    try {
      const [pda] = getVaultPDA(campaign.pda, positionIndex, v.trim());
      const pdaStr = pda.toBase58();
      setVaultPDA(pdaStr);
      setPolling(true);

      // Pre-crear vault via watcher si no hay wallet conectada
      if (!anchorWallet) {
        setAutoStatus('Reservando vault address…');
        fetch(`${WATCHER_URL}/watch-vault`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ campaign: campaign.pda, positionIndex, recipient: v.trim() }),
          signal:  AbortSignal.timeout(15000),
        })
          .then(r => r.json().catch(() => ({})))
          .then(json => {
            if (json.ok) {
              console.log('[BCF-CEX] Vault pre-creado on-chain ✅');
            } else {
              console.warn('[BCF-CEX] /watch-vault:', json.error || 'sin respuesta ok');
            }
            setAutoStatus('');
          })
          .catch(e => {
            // Watcher no disponible: el vault se creará en /sweep-now si es necesario
            console.warn('[BCF-CEX] /watch-vault no alcanzable:', e.message);
            setAutoStatus('');
          });
      }
    } catch {
      setAddrError('Invalid Solana address');
    }
  }

  // Auto-sweep helper: initialise vault if needed, then sweep
  const autoSweep = async (vPub, isProgramOwned) => {
    if (!anchorWallet) return;
    if (sweepingRef.current || sweptRef.current) return;
    sweepingRef.current = true;
    setSweeping(true);
    try {
      const provider = new AnchorProvider(connection, anchorWallet, { commitment: 'confirmed' });

      // Step A: create vault on-chain if SOL arrived before vault was initialised
      if (!isProgramOwned) {
        setAutoStatus('Initialising vault...');
        console.log('[BCF-CEX] Vault not yet program-owned — creating vault account');
        try {
          await createPositionVaultOnChain(provider, {
            campaignPDA:   campaign.pda,
            positionIndex,
            recipient:     recipientAddr,
          });
          console.log('[BCF-CEX] Vault account created');
        } catch (ce) {
          const cm = ce.message || '';
          // "already in use" means vault was just created between our check and now — fine
          if (!cm.includes('already in use') && !cm.includes('custom program error: 0x0')) throw ce;
          console.log('[BCF-CEX] Vault already exists, continuing...');
        }
      }

      // Step B: sweep — moves SOL from vault → campaign, assigns position, closes vault
      setAutoStatus('Assigning position on-chain...');
      console.log('[BCF-CEX] Sweeping vault → campaign');
      const { account } = await sweepPositionVaultOnChain(provider, {
        campaignPDA:   campaign.pda,
        positionIndex,
        recipient:     recipientAddr,
      });

      sweptRef.current = true;
      setSwept(true);
      setAutoStatus('');
      const posStr = String(positionIndex).padStart(2, '0');
      saveCEXPosition(campaign.pda, positionIndex, recipientAddr, {
        title: campaign.title, tokenSymbol: campaign.tokenSymbol,
        positionPriceSOL: campaign.positionPriceSOL,
      });
      toast(`✅ Position #${posStr} confirmed on-chain!`, 'success');
      onSuccess(campaignAccountToDisplay(campaign.pda, account));
      setTimeout(onClose, 2500);
    } catch (e) {
      setAutoStatus('');
      const m = e.message || '';
      if (m.includes('PositionTaken')) {
        toast('Position was taken by someone else while processing', 'error');
      } else if (m.includes('InsufficientFunds')) {
        toast('Vault balance still below required amount', 'error');
      } else if (!m.includes('rejected')) {
        toast('Auto-sweep failed: ' + m.slice(0, 80), 'error');
        console.error('[BCF-CEX] Auto-sweep error:', e);
      }
    } finally {
      sweepingRef.current = false;
      setSweeping(false);
    }
  };

  // ── callWatcherSweep: signs via watcher keypair — no wallet needed ──────────
  // Frontend calls WATCHER_URL/sweep-now. In dev, Vite proxies /watcher/* to
  // 127.0.0.1:3001 (watcher process). This eliminates all CORS/IPv6/WSL2 issues.
  // Source of truth: on-chain position.owner — never localStorage.
  async function callWatcherSweep() {
    if (sweepingRef.current || sweptRef.current) return;
    sweepingRef.current = true;
    setSweeping(true);
    setAutoStatus('Assigning position on-chain…');
    const recipient = recipientRef.current || recipientAddr;
    
    let fetchSuccess = false;
    let json = {};
    let resp;

    try {
      resp = await fetch(`${WATCHER_URL}/sweep-now`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ campaign: campaign.pda, positionIndex, recipient }),
        signal:  AbortSignal.timeout(35000),
      });
      json = await resp.json().catch(() => ({}));
      fetchSuccess = true;
    } catch(e) {
      setAutoStatus('');
      if (e.name === 'AbortError' || e.name === 'TimeoutError') {
        toast('Tiempo de espera agotado. El watcher puede estar procesando una TX. Intenta de nuevo.', 'error');
      } else {
        toast('No se pudo contactar al watcher. Inicia con: bash scripts/deploy.sh', 'error');
        console.warn('[BCF-CEX] Watcher inalcanzable:', e.message);
      }
      sweepingRef.current = false;
      setSweeping(false);
      return;
    }

    if (fetchSuccess) {
      if (resp.ok && json.ok) {
        // TX confirmed by watcher — verify on-chain
        try {
          const mockWallet = { publicKey: new PublicKey('11111111111111111111111111111111') };
          const prov    = new AnchorProvider(connection, mockWallet, { commitment: 'confirmed' });
          const account = await fetchCampaign(prov, campaign.pda);
          const posOwner = account?.positions?.[positionIndex]?.owner?.toBase58?.();
          
          if (posOwner && posOwner !== '11111111111111111111111111111111') {
            sweptRef.current = true;
            setSwept(true);
            setAutoStatus('');
            // localStorage hint only
            saveCEXPosition(campaign.pda, positionIndex, recipient, {
              title: campaign.title, tokenSymbol: campaign.tokenSymbol,
              positionPriceSOL: campaign.positionPriceSOL,
            });
            toast(`✅ Position #${String(positionIndex).padStart(2,'0')} secured on-chain!`, 'success');
            if (account) onSuccess(campaignAccountToDisplay(campaign.pda, account));
            setTimeout(onClose, 2500);
          } else {
            setAutoStatus('');
            console.warn('[BCF-CEX] TX sent but on-chain not yet confirmed — polling will catch it');
            toast('Transacción enviada, esperando confirmación...', 'info');
          }
        } catch (chainErr) {
          setAutoStatus('');
          console.warn('[BCF-CEX] TX sent but fetchCampaign failed:', chainErr.message);
          toast('Posición asignada, esperando sincronización de red...', 'info');
        }
      } else {
        setAutoStatus('');
        const errMsg = json.error || '';
        console.warn('[BCF-CEX] /sweep-now:', resp.status, errMsg);
        // WATCHER_DOWN = proxy 503 (watcher not running)
        if (errMsg === 'WATCHER_DOWN' || resp.status === 503 || resp.status === 502) {
          toast('El watcher no está corriendo. Usa bash scripts/deploy.sh para iniciar todo.', 'error');
        } else if (errMsg.includes('insuficientes') || errMsg.includes('underfunded') || errMsg.includes('Insufficient')) {
          toast('El vault aún no tiene fondos suficientes. Espera un momento y vuelve a intentarlo.', 'error');
        } else if (errMsg.includes('PositionTaken') || errMsg.includes('ya asignada')) {
          toast('Alguien más tomó esa posición. Elige otra.', 'error');
        } else {
          toast('Error del watcher: ' + (errMsg || `HTTP ${resp.status}`).slice(0, 100), 'error');
        }
      }
      sweepingRef.current = false;
      setSweeping(false);
    }
  }

  // Full status check: reads balance, detects funds, triggers autoSweep automatically
  const checkStatus = async () => {
    if (!vaultPDA || sweptRef.current) return; // use ref not state
    setIsChecking(true);
    try {
      console.log(`[BCF-CEX] Checking status for pos#${positionIndex} at ${vaultPDA}`);

      // 1. Balance check
      const vPub = new PublicKey(vaultPDA);
      const bal  = await connection.getBalance(vPub);
      setVaultBalance(bal);
      console.log(`[BCF-CEX] Balance: ${(bal / 1e9).toFixed(4)} SOL (need: ${price} SOL)`);

      // 2. Account ownership check
      const accInfo       = await connection.getAccountInfo(vPub);
      const isProgramOwned = accInfo && accInfo.owner.toBase58() === BCF_PROGRAM_ID;
      console.log(`[BCF-CEX] Vault exists: ${!!accInfo}, Program-owned: ${isProgramOwned}`);

      // 3. Check if position already filled (watcher may have completed it)
      const mockWallet = { publicKey: new PublicKey('11111111111111111111111111111111') };
      const provider   = new AnchorProvider(connection, mockWallet, { commitment: 'confirmed' });
      const account    = await fetchCampaign(provider, campaign.pda);
      const currentOwner = account?.positions[positionIndex]?.owner?.toBase58();
      console.log(`[BCF-CEX] Position owner on-chain: ${currentOwner || 'none'}`);

      if (currentOwner && currentOwner !== '11111111111111111111111111111111' &&
          currentOwner === recipientAddr) {
        console.log('[BCF-CEX] Position already secured!');
        sweptRef.current = true;
        setSwept(true);
        onSuccess(campaignAccountToDisplay(campaign.pda, account));
        toast(`✅ Position #${String(positionIndex).padStart(2,'0')} secured!`, 'success');
        setTimeout(onClose, 2000);
        return;
      }

      // 4. Funds present but position not yet assigned → trigger auto-sweep
      if (bal >= lamports && !swept) {
        if (anchorWallet) {
          console.log('[BCF-CEX] Funds detected — triggering auto-sweep');
          setAutoStatus('Payment detected — assigning position...');
          // Don't await here so setIsChecking(false) fires; autoSweep manages its own state
          autoSweep(vPub, isProgramOwned);
        } else {
          // No wallet: auto-call watcher sweep immediately
          console.log('[BCF-CEX] Funds detected — calling watcher /sweep-now automatically');
          setAutoStatus('Payment detected — assigning via watcher…');
          callWatcherSweep(); // guarded by sweepingRef — safe to call from interval
        }
      }
    } catch (e) {
      console.error('[BCF-CEX] Status check failed:', e);
    } finally {
      setIsChecking(false);
      setLastChecked(Date.now());
    }
  };


  async function handleManualCheck() {
    if (!vaultPDA) return;
    toast("Checking payment status...", "info");
    await checkStatus();
  }


  const vaultReady = vaultBalance >= lamports && vaultPDA;

  // Determine current step (1-4) for UI progress
  const currentStep = swept ? 4 : vaultReady ? 3 : vaultPDA ? 2 : 1;
  const fmtPos = (i) => String(i).padStart(2, '0');


  async function handleCreateVault() {
    if (!anchorWallet) {
      toast('Automatic vault initialization is handled by the platform. Just send SOL!', 'info');
      return;
    }
    if (!vaultPDA)     { toast('Enter a valid recipient address first', 'error'); return; }
    setCreating(true);
    try {
      const provider = new AnchorProvider(connection, anchorWallet, { commitment: 'confirmed' });
      await createPositionVaultOnChain(provider, {
        campaignPDA:   campaign.pda,
        positionIndex,
        recipient:     recipientAddr,
      });
      toast('Vault created! Now send exactly ' + price + ' SOL to the address below', 'success');
      setPolling(true);
    } catch(e) {
      const m = e.message || '';
      if (m.includes('PositionTaken'))     toast('Position already taken', 'error');
      else if (m.includes('already in use')) {
        toast('Vault already exists — proceed to payment', 'info');
        setPolling(true);
      }
      else if (m.includes('rejected'))     toast('Cancelled', 'info');
      else                                 toast('Create vault failed: ' + m.slice(0,80), 'error');
    } finally { setCreating(false); }
  }


  async function handleSweep() {
    if (sweepingRef.current || sweptRef.current) return;
    if (!anchorWallet) {
      toast('The watcher service will confirm this automatically. No action needed!', 'info');
      return;
    }
    sweepingRef.current = true;
    setSweeping(true);
    try {
      const provider = new AnchorProvider(connection, anchorWallet, { commitment: 'confirmed' });
      const { account } = await sweepPositionVaultOnChain(provider, {
        campaignPDA:   campaign.pda,
        positionIndex,
        recipient:     recipientAddr,
      });
      setSwept(true);
      sweptRef.current = true;
      saveCEXPosition(campaign.pda, positionIndex, recipientAddr, {
        title: campaign.title, tokenSymbol: campaign.tokenSymbol,
        positionPriceSOL: campaign.positionPriceSOL,
      });
      toast('Position #' + String(positionIndex).padStart(2,'0') + ' confirmed on-chain!', 'success');
      onSuccess(campaignAccountToDisplay(campaign.pda, account));
      setTimeout(onClose, 2000);
    } catch(e) {
      const m = e.message || '';
      if (m.includes('InsufficientFunds')) toast('Vault balance still too low — wait for funds', 'error');
      else if (m.includes('PositionTaken')) toast('Position was taken by someone else', 'error');
      else                                  toast('Sweep failed: ' + m.slice(0,80), 'error');
    } finally { sweepingRef.current = false; setSweeping(false); }
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
        <div style={{ padding:'14px', background:'rgba(251,191,36,.06)', border:'1px solid rgba(251,191,36,.25)', borderRadius:'var(--r)' }}>
          <div style={{ fontSize:'.7rem', color:'var(--amber)', fontWeight:700, marginBottom:'10px', textTransform:'uppercase', letterSpacing:'.06em' }}>
            🏆 Prize delivery — save this info
          </div>
          {[
            ['Campaign',      campaign.pda.slice(0,8)+'…'+campaign.pda.slice(-6)],
            ['Your position', '#'+fmtPos(positionIndex)],
            ['Prize address', recipientAddr],
          ].map(([label, value]) => (
            <div key={label} style={{ display:'flex', justifyContent:'space-between', gap:'8px', marginBottom:'6px' }}>
              <span style={{ fontSize:'.73rem', color:'var(--text3)' }}>{label}</span>
              <span style={{ fontSize:'.73rem', fontFamily:'var(--mono)', color:'var(--text)', wordBreak:'break-all', textAlign:'right' }}>{value}</span>
            </div>
          ))}
          <p style={{ fontSize:'.68rem', color:'var(--text3)', marginTop:'10px', lineHeight:1.5 }}>
            The watcher auto-sends the prize to your address — no wallet or action needed.
          </p>
        </div>
        <button className="btn btn-primary btn-full" onClick={() => window.location.reload()}>View Campaign</button>
      </div>
    );
  }


  return (
    <div style={{ display:'flex', flexDirection:'column', gap:'16px' }}>
      
      {/* 1. Progress Steps Indicator */}
      {!swept && (
        <div style={{ display:'flex', justifyContent:'space-between', marginBottom:'8px', padding:'0 10px' }}>
          {[1, 2, 3, 4].map(step => (
            <div key={step} style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:'4px', opacity: currentStep >= step ? 1 : 0.3 }}>
              <div style={{ 
                width:'24px', height:'24px', borderRadius:'50%', background: currentStep > step ? 'var(--green)' : currentStep === step ? 'var(--accent)' : 'var(--bg3)',
                color: currentStep >= step ? '#fff' : 'var(--text3)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'.7rem', fontWeight:700,
                border: currentStep === step ? '2px solid rgba(56,189,248,.3)' : 'none', transition:'all .3s ease'
              }}>
                {currentStep > step ? '✓' : step}
              </div>
              <div style={{ fontSize:'.55rem', color:'var(--text3)', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.5px' }}>
                {step === 1 ? 'Address' : step === 2 ? 'Vault' : step === 3 ? 'Pay' : 'Secure'}
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{ padding:'10px 14px', background:'rgba(56,189,248,.06)', border:'1px solid rgba(56,189,248,.18)', borderRadius:'var(--r)', fontSize:'.78rem', color:'var(--accent)', lineHeight:1.55 }}>
        <strong>No Wallet Needed:</strong> Each position has a unique vault address. Send SOL from any exchange — our watcher service handles the rest.
      </div>

      {/* Step 1: Address */}
      <div style={{ opacity: currentStep > 1 ? 0.7 : 1 }}>
        <div style={{ fontSize:'.7rem', color:'var(--text3)', marginBottom:'5px' }}>Step 1 — Your Solana address (will receive the position)</div>
        <input
          type="text"
          value={recipientAddr}
          onChange={e => handleAddrChange(e.target.value)}
          placeholder="Enter your Solana wallet address…"
          style={{ width:'100%', padding:'10px 13px', background:'var(--bg2)', border:'1px solid var(--border2)', borderRadius:'var(--r)', fontFamily:'var(--mono)', fontSize:'.75rem', color:'var(--text)', boxSizing:'border-box' }}
          disabled={!!vaultPDA}
        />
        {addrError && <p style={{ fontSize:'.7rem', color:'var(--danger)', marginTop:'4px' }}>{addrError}</p>}
      </div>

      {/* Step 2: Vault Setup */}
      {!vaultPDA && (
        <div style={{ display:'flex', flexDirection:'column', gap:'8px' }}>
          <button className="btn btn-secondary btn-full" onClick={handleCreateVault} disabled={creating}>
            {creating ? <span><span className="spin">⟳</span> Creating vault…</span> : anchorWallet ? '📦 Step 2 — Initialize Vault (Optional)' : '📦 Step 2 — Automatic Vault Setup'}
          </button>
          {!anchorWallet && (
            <p style={{ fontSize:'.68rem', color:'var(--text3)', textAlign:'center' }}>
              No wallet connected? No problem. The system will auto-initialize once SOL is sent.
            </p>
          )}
        </div>
      )}

      {/* Step 3: Vault Address */}
      {vaultPDA && !vaultReady && (
        <div>
          <div style={{ fontSize:'.7rem', color:'var(--text3)', marginBottom:'5px' }}>
            Step 3 — Send SOL to this vault address
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:'8px', padding:'10px 13px', background:'var(--bg2)', border:'1px solid var(--border2)', borderRadius:'var(--r)' }}>
            <span style={{ flex:1, fontFamily:'var(--mono)', fontSize:'.72rem', color:'var(--text2)', wordBreak:'break-all' }}>{vaultPDA}</span>
            <button className="btn btn-ghost btn-sm" onClick={() => copy(vaultPDA, 'vault-addr')}>{copied==='vault-addr'?'✓':'Copy'}</button>
          </div>
          <div style={{ marginTop:'6px', padding:'10px 13px', background:'rgba(251,191,36,.05)', border:'1px solid rgba(251,191,36,.2)', borderRadius:'var(--r)', fontSize:'.73rem', lineHeight:1.65, color:'var(--text2)' }}>
            <span style={{ color:'var(--amber)', fontWeight:700 }}>💸 How much to send:</span><br/>
            • Vault must receive: <strong style={{ fontFamily:'var(--mono)', color:'var(--accent)' }}>{price} SOL</strong><br/>
            • Recommended: <strong style={{ fontFamily:'var(--mono)', color:'var(--amber)' }}>≥ {(Number(price) + 0.01).toFixed(4)} SOL</strong> (covers exchange withdrawal fee ~0.001–0.02 SOL)<br/>
            <span style={{ color:'var(--text3)', fontSize:'.69rem' }}>✅ No memo required — unique to position #{fmtPos(positionIndex)}. Any surplus above {price} SOL is kept as a sweep tip.</span>
          </div>
        </div>
      )}

      {/* Payment Status Feedbacks */}
      {vaultPDA && (
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
                {autoStatus
                  ? autoStatus
                  : sweeping
                  ? 'Assigning position on-chain...'
                  : vaultReady
                  ? (anchorWallet ? 'Payment detected — assigning...' : 'Payment detected — watcher confirming...')
                  : polling
                  ? 'Awaiting payment...'
                  : 'Waiting for monitor...'}
              </div>
              <div style={{ fontSize:'.72rem', color:'var(--text3)', lineHeight: 1.3 }}>
                {vaultReady
                  ? (sweeping || autoStatus
                      ? 'Do not close this window — transaction in progress'
                      : 'Funds confirmed. Position is being secured.')
                  : `Currently: ${(vaultBalance / 1e9).toFixed(4)} / ${price} SOL`}
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
              disabled={isChecking || !vaultPDA}
              style={{ marginTop: '8px', fontSize: '.75rem', height: '32px' }}
            >
              {isChecking ? 'Checking...' : 'Check Payment Now'}
            </button>
          )}

          {/* CEX (no wallet): show Take My Position button once payment is funded */}
          {vaultReady && !anchorWallet && (
            <div style={{ marginTop:'10px', display:'flex', flexDirection:'column', gap:'8px' }}>
              <div style={{ padding:'12px', background:'rgba(52,211,153,.08)', border:'1px solid rgba(52,211,153,.2)', borderRadius:'var(--r)', fontSize:'.78rem', color:'var(--green)', lineHeight:1.55, textAlign:'center' }}>
                💰 <strong>Payment detected!</strong><br/>
                <span style={{ color:'var(--text2)', fontSize:'.75rem' }}>
                  {autoStatus || (sweeping ? 'Assigning on-chain — do not close this window…' : 'Your payment is confirmed. Click below to secure your position.')}
                </span>
              </div>
              <button
                className="btn btn-primary btn-full"
                onClick={callWatcherSweep}
                disabled={sweeping}
                style={{ fontWeight:700, fontSize:'.9rem', display:'flex', alignItems:'center', justifyContent:'center', gap:'8px' }}
              >
                {sweeping
                  ? <><span className="spin">⟳</span> Assigning on-chain…</>
                  : `🎯 Take My Position #${String(positionIndex).padStart(2,'0')} Now`}
              </button>
            </div>
          )}

          {/* Wallet connected + sweeping: show progress */}
          {vaultReady && anchorWallet && (sweeping || autoStatus) && (
            <div style={{ marginTop:'10px', padding:'12px', background:'rgba(139,92,246,.08)', border:'1px solid rgba(139,92,246,.2)', borderRadius:'var(--r)', fontSize:'.78rem', color:'#a78bfa', lineHeight:1.5, textAlign:'center', display:'flex', alignItems:'center', justifyContent:'center', gap:'8px' }}>
              <span className="spin">⟳</span>
              <span>{autoStatus || 'Assigning position on-chain...'} Do not close this window.</span>
            </div>
          )}
        </div>
      )}

      {/* Prize Info */}
      <div style={{ padding: '12px', background: 'rgba(255, 193, 7, 0.05)', border: '1px solid rgba(255, 193, 7, 0.2)', borderRadius: 'var(--r)', fontSize: '0.75rem', color: 'var(--text2)', marginTop: '4px' }}>
        <strong>🏆 Prize Information:</strong><br />
        If you win, the prize will be automatically sent to your recipient address. No additional action or wallet required.
      </div>

      {/* Fallback manual sweep button — only shown if auto-sweep stalled (no autoStatus, not sweeping, vaultReady, wallet connected) */}
      {vaultReady && anchorWallet && !sweeping && !autoStatus && !swept && (
        <div style={{ marginTop:'12px' }}>
          <button className="btn btn-primary btn-full" onClick={() => { const v = new PublicKey(vaultPDA); autoSweep(v, false); }} disabled={sweeping}>
            ⚡ Confirm Position #{String(positionIndex).padStart(2,'0')} Now
          </button>
        </div>
      )}

      <p style={{ fontSize:'.69rem', color:'var(--text3)', textAlign:'center', lineHeight:1.5, marginTop: '8px' }}>
        {polling 
          ? "Monitoring active. The system will auto-confirm once funds are detected."
          : "Manual check available if auto-monitoring is paused."}
      </p>
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
  const expired   = isExpired(campaign);
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

      {/* Settled banner */}
      {isSettled && (
        <div style={{ background:campaign.winnerWallet?"rgba(56,189,248,.04)":"rgba(52,211,153,.04)", borderBottom:`2px solid ${campaign.winnerWallet?"var(--accent)":"var(--green)"}`, padding:"28px 48px", textAlign:"center" }}>
          <div style={{ maxWidth:"760px", margin:"0 auto" }}>
            <div style={{ fontSize:"2.5rem", marginBottom:"10px" }}>{campaign.winnerWallet?"🏆":"🏦"}</div>
            <h2 style={{ fontWeight:700, fontSize:"1.4rem", marginBottom:"12px", letterSpacing:"-.02em" }}>
              {campaign.winnerWallet ? "We have a winner!" : "No winner — funds go to treasury"}
            </h2>
            <div style={{ display:"flex", justifyContent:"center", alignItems:"center", gap:"20px", flexWrap:"wrap", marginBottom:"10px" }}>
              <div style={{ display:"flex", alignItems:"center", gap:"8px" }}>
                <span style={{ fontSize:".82rem", color:"var(--text3)" }}>Winning position:</span>
                <span style={{ fontFamily:"var(--mono)", fontSize:"1.5rem", fontWeight:700, color:"var(--accent)", background:"var(--bg2)", padding:"4px 14px", borderRadius:"8px" }}>#{fmtPos(campaign.winningPosition)}</span>
              </div>
              {campaign.winnerWallet && (
                <div style={{ display:"flex", alignItems:"center", gap:"6px" }}>
                  <span style={{ fontSize:".82rem", color:"var(--text3)" }}>Winner:</span>
                  <span style={{ fontFamily:"var(--mono)", color:"var(--green)", fontWeight:600 }}>{shortAddr(campaign.winnerWallet, 6)}</span>
                </div>
              )}
              <div style={{ display:"flex", alignItems:"center", gap:"6px" }}>
                <span style={{ fontSize:".82rem", color:"var(--text3)" }}>
                  {campaign.winnerWallet?"Prize paid:":"Added to treasury:"}
                </span>
                <span style={{ fontFamily:"var(--mono)", fontWeight:700, color: campaign.winnerWallet?"var(--accent)":"var(--green)" }}>
                  {(campaign.totalPayout||pot).toFixed(3)} SOL (≈${toUSDC(campaign.totalPayout||pot)})
                </span>
              </div>
            </div>
            {campaign.winningBlockHash && (
              <div style={{ fontSize:".7rem", color:"var(--text3)", fontFamily:"var(--mono)" }}>
                Block hash: {campaign.winningBlockHash.slice(0,32)}... (verifiable draw source)
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

            <h1 style={{ fontSize:"2.1rem", fontWeight:700, letterSpacing:"-.04em", lineHeight:1.1, marginBottom:"14px" }}>{campaign.title}</h1>
            <p style={{ color:"var(--text2)", lineHeight:1.7, marginBottom:"28px", fontSize:".95rem" }}>{campaign.description}</p>

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
                      {fmtPos(i)}
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
