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
} from "../lib/programClient.js";
import { AnchorProvider } from "@coral-xyz/anchor";
import { toUSDC, TOKENS_PER_SOL, TREASURY_FEE_PCT } from "../lib/constants.js";
import { shortAddr, explorerTx, getSOLBalance, requestAirdrop } from "../lib/solana.js";
import { bagsTokenUrl } from "../lib/bags.js";
import { useToast } from "../components/Toast.jsx";

const SOL = LAMPORTS_PER_SOL;

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

  function activate(txSig) {
    setDone(true); setPolling(false);
    const updated = activateCampaign(campaign.id, txSig);
    toast("Campaign activated! 100 positions now available.", "success");
    onActivated(updated);
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
                      {balance<needed && <button className="btn btn-ghost btn-sm" onClick={handleAirdrop} style={{ fontSize:".72rem", padding:"4px 10px" }}>☁️ Airdrop</button>}
                    </div>
                  </div>
                )}
                <button className="btn btn-primary btn-full" onClick={handleWalletDeposit} disabled={sending}>
                  {sending?<span style={{ display:"flex", alignItems:"center", gap:"8px", justifyContent:"center" }}><span className="spin">⟳</span> Confirming...</span>
                    :connected?`⚡ Deposit ${needed} SOL`:"🔌 Connect Wallet First"}
                </button>
                {connected && wallet && <p style={{ textAlign:"center", fontSize:".7rem", color:"var(--text3)" }}>{wallet.adapter.name} · Solana DevNet</p>}
              </div>
            ) : (
              <div style={{ display:"flex", flexDirection:"column", gap:"12px" }}>
                <div style={{ padding:"10px 14px", background:"rgba(56,189,248,.06)", border:"1px solid rgba(56,189,248,.18)", borderRadius:"var(--r)", fontSize:".78rem", color:"var(--accent)", lineHeight:1.55 }}>
                  Works with any DevNet address, Phantom on a different device, or any exchange on mainnet.
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
                  ? <button className="btn btn-secondary btn-full" onClick={()=>{setPolling(true);toast("Monitoring DevNet for deposit...","info");}}>✓ I sent {needed} SOL — Monitor now</button>
                  : <div style={{ display:"flex", alignItems:"center", gap:"12px", padding:"13px 15px", background:"rgba(56,189,248,.07)", border:"1px solid rgba(56,189,248,.2)", borderRadius:"var(--r)" }}>
                      <span className="spin">⟳</span>
                      <div>
                        <div style={{ fontWeight:600, fontSize:".85rem", color:"var(--accent)" }}>Scanning DevNet... ({pollCount}/72)</div>
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

  const pollCount = usePollIncoming({
    active: polling && !done, connection,
    address: campaign.creatorWallet, expectedLamports: lamports,
    onFound: ({ signature, sender }) => complete(signature, sender, "exchange"),
  });

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

  function complete(txSig, wallet, source) {
    try {
      const updated = purchasePosition(campaign.id, {
        index: positionIndex, wallet, txSignature:txSig,
        source, memo, usdcRef: Number(toUSDC(price)),
      });
      setDone(true); setDoneTx(txSig); setPolling(false);
      onSuccess(updated);
      toast(`✓ Position #${fmtPos(positionIndex)} secured! +${tokens.toLocaleString()} $${campaign.tokenSymbol}`, "success");
    } catch(e) {
      console.error("[BCF] Participate error:", e);
      const m = e.message || e.toString() || "";
      if (/rejected|cancelled|canceled/i.test(m)) {
        toast("Participation cancelled", "info");
      } else if (m.includes("0x1")) {
        toast("Insufficient funds for ticket + fees", "error");
      } else {
        toast(`Failed: ${m.slice(0, 80)}...`, "error");
      }
      onClose(); 
    }
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
                      {balance<price && <button className="btn btn-ghost btn-sm" onClick={handleAirdrop} style={{ fontSize:".72rem", padding:"4px 10px" }}>☁️ Airdrop</button>}
                    </div>
                  </div>
                )}
                <button className="btn btn-primary btn-full" onClick={handleWalletBuy} disabled={sending}>
                  {sending?<span style={{ display:"flex", alignItems:"center", gap:"8px", justifyContent:"center" }}><span className="spin">⟳</span> Confirming...</span>
                    :connected?`⚡ Participate — Position #${fmtPos(positionIndex)}`:"🔌 Connect Wallet First"}
                </button>
                {connected && wallet && <p style={{ textAlign:"center", fontSize:".7rem", color:"var(--text3)" }}>{wallet.adapter.name} · Solana DevNet</p>}
              </div>
            ) : (
              <div style={{ display:"flex", flexDirection:"column", gap:"12px" }}>
                <div style={{ padding:"10px 14px", background:"rgba(56,189,248,.06)", border:"1px solid rgba(56,189,248,.18)", borderRadius:"var(--r)", fontSize:".78rem", color:"var(--accent)", lineHeight:1.55 }}>
                  Send SOL from Binance, Coinbase, or any DevNet address. Include the memo to link your payment to position #{fmtPos(positionIndex)}.
                </div>
                {[
                  { label:"Send to address", value:campaign.creatorWallet, key:"pos-addr", accent:false },
                  { label:"Memo / Tag (required)", value:memo, key:"pos-memo", accent:true },
                ].map(({label,value,key,accent})=>(
                  <div key={key}>
                    <div style={{ fontSize:".7rem", color:"var(--text3)", marginBottom:"5px" }}>{label}</div>
                    <div style={{ display:"flex", alignItems:"center", gap:"8px", padding:"10px 13px", background:"var(--bg2)", border:"1px solid var(--border2)", borderRadius:"var(--r)" }}>
                      <span style={{ flex:1, fontFamily:"var(--mono)", fontSize:accent?".88rem":".72rem", fontWeight:accent?700:400, color:accent?"var(--accent)":"var(--text2)", wordBreak:"break-all", letterSpacing:accent?".06em":"0" }}>{value}</span>
                      <button className="btn btn-ghost btn-sm" onClick={()=>copy(value,key)}>{copied===key?"✓":"Copy"}</button>
                    </div>
                    {key.includes("memo") && <p style={{ fontSize:".7rem", color:"var(--warning)", marginTop:"4px" }}>⚠️ Without memo, position #{fmtPos(positionIndex)} cannot be assigned</p>}
                  </div>
                ))}
                <div style={{ padding:"11px 14px", background:"var(--bg2)", border:"1px solid var(--border2)", borderRadius:"var(--r)", fontSize:".79rem", color:"var(--text2)", lineHeight:1.65 }}>
                  Amount: <strong style={{ color:"var(--accent)", fontFamily:"var(--mono)" }}>{price} SOL</strong> · Include memo exactly as shown
                </div>
                {!polling
                  ? <button className="btn btn-secondary btn-full" onClick={()=>{setPolling(true);toast("Monitoring DevNet...","info");}}>✓ I sent {price} SOL — Monitor now</button>
                  : <div style={{ display:"flex", alignItems:"center", gap:"12px", padding:"13px 15px", background:"rgba(56,189,248,.07)", border:"1px solid rgba(56,189,248,.2)", borderRadius:"var(--r)" }}>
                      <span className="spin">⟳</span>
                      <div>
                        <div style={{ fontWeight:600, fontSize:".85rem", color:"var(--accent)" }}>Scanning DevNet... ({pollCount}/72)</div>
                        <div style={{ fontSize:".7rem", color:"var(--text3)" }}>Every 5s · keep this open</div>
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
        
        const campaignDisplay = campaignAccountToDisplay(id, account);
        setCampaign(campaignDisplay);

        // 2. Fetch Project Identity (Secondary Data - Non-blocking)
        try {
          const project = await fetchProject(provider, account.creator.toBase58());
          if (project) {
            setToken({
              mint: project.tokenMint.toBase58(),
              symbol: project.resolvedSymbol,
              name: project.resolvedName,
              feeModeName: project.feeModeName,
              treasury: {
                balanceSOL: (project.treasuryLamports?.toNumber() || 0) / LAMPORTS_PER_SOL,
              }
            });
          }
        } catch (projErr) {
          console.warn("[BCF] Project identity fetch skipped (rate limiting?):", projErr.message || projErr);
          // Fallback minimal token info from campaign data
          setToken({
            mint: account.tokenMint.toBase58(),
            symbol: "???",
            name: "Bags Token"
          });
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
              <span className="badge badge-devnet">DevNet</span>
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
