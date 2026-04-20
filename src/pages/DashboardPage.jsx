import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import {
  getCreatorTokens, getCreatorCampaigns, getToken,
  withdrawFromTreasury, deleteCampaign, posStatus, totalPot, fmtPos, timeLeft,
} from "../lib/store.js";
import { toUSDC } from "../lib/constants.js";
import { getSOLBalance, requestAirdrop, shortAddr, explorerAddr } from "../lib/solana.js";
import { bagsTokenUrl } from "../lib/bags.js";
import { useToast } from "../components/Toast.jsx";

export default function DashboardPage() {
  const { connected, publicKey } = useWallet();
  const { setVisible } = useWalletModal();
  const toast = useToast();

  const [tokens,    setTokens]    = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [balance,   setBalance]   = useState(null);
  const [dropping,  setDropping]  = useState(false);
  const [activeTab, setActiveTab] = useState("campaigns");

  // Withdrawal modal state
  const [withdrawToken,  setWithdrawToken]  = useState(null);
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [withdrawNote,   setWithdrawNote]   = useState("");

  function refresh() {
    if (!connected || !publicKey) return;
    const w = publicKey.toBase58();
    setTokens(getCreatorTokens(w));
    setCampaigns(getCreatorCampaigns(w));
    getSOLBalance(w).then(setBalance);
  }

  useEffect(() => { refresh(); }, [connected, publicKey]);

  async function handleAirdrop() {
    if (!connected || !publicKey) return;
    setDropping(true);
    try {
      toast("Requesting 2 SOL airdrop...", "info");
      await requestAirdrop(publicKey.toBase58(), 2);
      const b = await getSOLBalance(publicKey.toBase58());
      setBalance(b);
      toast("✓ +2 SOL received! (DevNet)", "success");
    } catch(e) { toast("Airdrop failed — try again in 30s", "error"); }
    finally { setDropping(false); }
  }

  function handleWithdraw() {
    if (!withdrawToken) return;
    const amount = Number(withdrawAmount);
    if (!amount || amount <= 0) { toast("Enter a valid amount", "error"); return; }
    if (amount > withdrawToken.treasury.balanceSOL) { toast("Exceeds treasury balance", "error"); return; }

    const pct = (amount / (withdrawToken.treasury.totalEarned||1)) * 100;
    if (pct > 30) {
      const ok = window.confirm(
        `⚠️ WARNING: You are withdrawing ${pct.toFixed(0)}% of total treasury earnings.\n\nLarge withdrawals are visible publicly and may signal a negative exit to your community.\n\nThis action is irreversible. Continue?`
      );
      if (!ok) return;
    }

    withdrawFromTreasury(withdrawToken.mint, amount, withdrawNote || "Creator withdrawal");
    toast(`Withdrew ${amount.toFixed(4)} SOL from ${withdrawToken.symbol} treasury`, "success");
    setWithdrawToken(null);
    setWithdrawAmount("");
    setWithdrawNote("");
    refresh();
  }

  function handleDeleteCampaign(id) {
    if (!window.confirm("Delete this campaign? This cannot be undone.")) return;
    deleteCampaign(id);
    setCampaigns(c => c.filter(x => x.id !== id));
    toast("Campaign deleted", "info");
  }

  const totalTreasury = tokens.reduce((s,t) => s + (t.treasury?.balanceSOL||0), 0);
  const totalCampaigns = campaigns.length;
  const activeCampaigns = campaigns.filter(c=>c.status==="active").length;
  const totalRaised = campaigns.reduce((s,c)=>s+c.totalCollectedSOL,0);

  if (!connected) return (
    <div style={{ padding:"80px 24px", textAlign:"center" }}>
      <div style={{ fontSize:"3rem", marginBottom:"14px" }}>🔌</div>
      <h2 style={{ fontWeight:700, marginBottom:"9px" }}>Connect your wallet</h2>
      <p style={{ color:"var(--text2)", marginBottom:"26px", fontSize:".9rem" }}>Connect Phantom or Solflare to manage your tokens, campaigns, and treasury.</p>
      <button className="btn btn-primary btn-lg" onClick={()=>setVisible(true)}>Connect Wallet</button>
    </div>
  );

  return (
    <div style={{ padding:"46px 28px", maxWidth:"1100px", margin:"0 auto" }}>
      {/* Header */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:"36px", flexWrap:"wrap", gap:"16px" }}>
        <div>
          <div className="section-label">Creator Dashboard</div>
          <h1 style={{ fontSize:"1.9rem", letterSpacing:"-.03em", marginBottom:"5px" }}>My Projects</h1>
          <a href={explorerAddr(publicKey.toBase58())} target="_blank" rel="noopener noreferrer" style={{ fontFamily:"var(--mono)", fontSize:".78rem", color:"var(--text3)" }}>
            {shortAddr(publicKey.toBase58(), 6)} ↗
          </a>
        </div>
        <div style={{ display:"flex", gap:"10px" }}>
          <Link to="/create-token" className="btn btn-secondary">+ New Token</Link>
          <Link to="/create-campaign" className="btn btn-primary">+ New Campaign</Link>
        </div>
      </div>

      {/* DevNet wallet card */}
      <div style={{ padding:"22px 26px", background:"var(--bg1)", border:"1px solid rgba(56,189,248,.25)", borderRadius:"var(--rl)", marginBottom:"28px", display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:"14px" }}>
        <div>
          <div style={{ fontSize:".72rem", color:"var(--accent)", textTransform:"uppercase", letterSpacing:".06em", marginBottom:"5px", fontWeight:700 }}>DevNet Balance</div>
          <div style={{ fontFamily:"var(--mono)", fontSize:"1.7rem", fontWeight:700, letterSpacing:"-.03em" }}>{balance!==null?`${balance.toFixed(4)} SOL`:"..."}</div>
          <div style={{ fontSize:".74rem", color:"var(--text3)", marginTop:"4px" }}>≈ ${toUSDC(balance||0)} USDC · DevNet faucet funds</div>
        </div>
        <button className="btn btn-secondary" onClick={handleAirdrop} disabled={dropping}>
          {dropping?<span style={{ display:"flex", alignItems:"center", gap:"7px" }}><span className="spin">⟳</span> Requesting...</span>:"☁️ Airdrop 2 SOL"}
        </button>
      </div>

      {/* Stats grid */}
      <div className="grid-3" style={{ marginBottom:"30px" }}>
        {[
          { label:"Tokens Created", value:tokens.length },
          { label:"Active Campaigns", value:activeCampaigns, green:true },
          { label:"Position Sales", value:`${totalRaised.toFixed(3)} SOL` },
        ].map((s,i)=>(
          <div key={i} className="card" style={{ padding:"20px" }}>
            <div style={{ fontFamily:"var(--mono)", fontSize:"1.45rem", fontWeight:700, color:s.green?"var(--accent)":"var(--text)" }}>{s.value}</div>
            <div style={{ fontSize:".72rem", color:"var(--text3)", marginTop:"4px", textTransform:"uppercase", letterSpacing:".06em" }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Treasury summary */}
      {totalTreasury > 0 && (
        <div style={{ padding:"20px 24px", background:"rgba(52,211,153,.06)", border:"1px solid rgba(52,211,153,.22)", borderRadius:"var(--rl)", marginBottom:"28px", display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:"14px" }}>
          <div style={{ display:"flex", alignItems:"center", gap:"14px" }}>
            <div style={{ fontSize:"1.8rem" }}>🏦</div>
            <div>
              <div style={{ fontSize:".72rem", color:"var(--green)", textTransform:"uppercase", letterSpacing:".06em", marginBottom:"3px", fontWeight:700 }}>Total Treasury Balance</div>
              <div style={{ fontFamily:"var(--mono)", fontSize:"1.4rem", fontWeight:700, color:"var(--green)" }}>{totalTreasury.toFixed(4)} SOL</div>
              <div style={{ fontSize:".74rem", color:"var(--text3)" }}>≈ ${toUSDC(totalTreasury)} USDC across all tokens</div>
            </div>
          </div>
          <div style={{ fontSize:".8rem", color:"var(--text2)", maxWidth:"280px", lineHeight:1.6 }}>
            2% of every position sale + unclaimed prizes accumulate here. Withdraw at any time — but large withdrawals are visible to your community.
          </div>
        </div>
      )}

      {/* Tabs */}
      <div style={{ display:"flex", gap:"4px", marginBottom:"22px", background:"var(--bg2)", border:"1px solid var(--border2)", borderRadius:"var(--r)", padding:"4px" }}>
        {[["campaigns","Campaigns"],["tokens","My Tokens"]].map(([k,l])=>(
          <button key={k} onClick={()=>setActiveTab(k)} style={{ flex:1, padding:"9px", borderRadius:"6px", fontSize:".85rem", fontWeight:activeTab===k?700:400, background:activeTab===k?"var(--accent)":"transparent", color:activeTab===k?"#000":"var(--text2)", border:"none", cursor:"pointer", transition:"var(--ease)" }}>{l}</button>
        ))}
      </div>

      {/* ── CAMPAIGNS TAB ── */}
      {activeTab==="campaigns" && (
        campaigns.length===0 ? (
          <div style={{ textAlign:"center", padding:"60px 24px", border:"1px dashed var(--border2)", borderRadius:"var(--rl)" }}>
            <div style={{ fontSize:"2rem", marginBottom:"10px" }}>🎯</div>
            <h3 style={{ fontWeight:700, marginBottom:"8px" }}>No campaigns yet</h3>
            <p style={{ color:"var(--text2)", marginBottom:"20px", fontSize:".88rem" }}>Create a token first, then launch a funding campaign.</p>
            <Link to="/create-token" className="btn btn-primary">Create your first token</Link>
          </div>
        ) : (
          <div style={{ display:"flex", flexDirection:"column", gap:"12px" }}>
            {campaigns.map(c=>{
              const sold = posStatus(c);
              const pot = totalPot(c);
              const badge = {
                pending:  <span className="badge badge-pending">◐ Pending</span>,
                active:   <span className="badge badge-active">● Active</span>,
                settled:  <span className="badge badge-settled">✦ Settled</span>,
              }[c.status];
              return (
                <div key={c.id} className="card" style={{ padding:"20px 22px", display:"grid", gridTemplateColumns:"1fr auto", gap:"18px", alignItems:"center" }}>
                  <div>
                    <div style={{ display:"flex", alignItems:"center", gap:"9px", marginBottom:"7px", flexWrap:"wrap" }}>
                      <span style={{ fontWeight:700, fontSize:"1rem" }}>{c.title}</span>
                      {badge}
                      <span style={{ fontFamily:"var(--mono)", fontSize:".74rem", color:"var(--accent)", opacity:.8 }}>${c.tokenSymbol}</span>
                    </div>
                    <div style={{ display:"flex", gap:"22px", flexWrap:"wrap" }}>
                      <span style={{ fontSize:".8rem", color:"var(--text2)" }}>Pool: <strong style={{ color:"var(--accent)", fontFamily:"var(--mono)" }}>{pot.toFixed(3)} SOL</strong></span>
                      <span style={{ fontSize:".8rem", color:"var(--text3)" }}>{sold}/100 positions filled</span>
                      <span style={{ fontSize:".8rem", color:"var(--text3)" }}>
                        {c.status==="settled"
                          ? c.winnerWallet ? `Winner: #${fmtPos(c.winningPosition)}` : `No winner — #${fmtPos(c.winningPosition)} → treasury`
                          : c.deadline ? timeLeft(c.deadline) : "—"}
                      </span>
                    </div>
                  </div>
                  <div style={{ display:"flex", gap:"8px", flexShrink:0 }}>
                    <Link to={`/campaign/${c.id}`} className="btn btn-ghost btn-sm">View</Link>
                    <button className="btn btn-danger btn-sm" onClick={()=>handleDeleteCampaign(c.id)}>Delete</button>
                  </div>
                </div>
              );
            })}
          </div>
        )
      )}

      {/* ── TOKENS TAB ── */}
      {activeTab==="tokens" && (
        tokens.length===0 ? (
          <div style={{ textAlign:"center", padding:"60px 24px", border:"1px dashed var(--border2)", borderRadius:"var(--rl)" }}>
            <div style={{ fontSize:"2rem", marginBottom:"10px" }}>🪙</div>
            <h3 style={{ fontWeight:700, marginBottom:"8px" }}>No tokens yet</h3>
            <p style={{ color:"var(--text2)", marginBottom:"20px", fontSize:".88rem" }}>Create your first Bags token to start fundraising.</p>
            <Link to="/create-token" className="btn btn-primary">Create your token</Link>
          </div>
        ) : (
          <div style={{ display:"flex", flexDirection:"column", gap:"16px" }}>
            {tokens.map(t=>(
              <div key={t.mint} className="card" style={{ padding:"24px" }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:"14px", flexWrap:"wrap", gap:"12px" }}>
                  <div>
                    <div style={{ display:"flex", alignItems:"center", gap:"10px", marginBottom:"4px" }}>
                      <span style={{ fontWeight:700, fontSize:"1.05rem" }}>{t.name}</span>
                      <span style={{ fontFamily:"var(--mono)", fontWeight:700, color:"var(--accent)", fontSize:".88rem" }}>${t.symbol}</span>
                    </div>
                    <p style={{ fontSize:".82rem", color:"var(--text2)", lineHeight:1.5 }}>{t.description?.slice(0,100)}{t.description?.length>100?"...":""}</p>
                  </div>
                  <div style={{ display:"flex", gap:"8px" }}>
                    <a href={bagsTokenUrl(t.mint)} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm">bags.fm →</a>
                    <Link to={`/create-campaign?token=${t.mint}`} className="btn btn-secondary btn-sm">+ Campaign</Link>
                  </div>
                </div>

                {/* Treasury section */}
                <div style={{ padding:"16px 18px", background:"rgba(52,211,153,.05)", border:"1px solid rgba(52,211,153,.18)", borderRadius:"var(--r)", display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:"12px" }}>
                  <div>
                    <div style={{ fontSize:".72rem", color:"var(--green)", textTransform:"uppercase", letterSpacing:".06em", marginBottom:"3px", fontWeight:700 }}>Treasury</div>
                    <div style={{ fontFamily:"var(--mono)", fontSize:"1.2rem", fontWeight:700, color:"var(--green)" }}>{(t.treasury?.balanceSOL||0).toFixed(4)} SOL</div>
                    <div style={{ fontSize:".73rem", color:"var(--text3)" }}>Total earned: {(t.treasury?.totalEarned||0).toFixed(4)} SOL</div>
                    {t.treasury?.withdrawals?.length>0 && (
                      <div style={{ fontSize:".72rem", color:"var(--warning)", marginTop:"3px" }}>
                        {t.treasury.withdrawals.length} withdrawal(s) — visible to community
                      </div>
                    )}
                  </div>
                  <button className="btn btn-success btn-sm" onClick={()=>setWithdrawToken(t)} disabled={(t.treasury?.balanceSOL||0)<=0}>
                    Withdraw from Treasury
                  </button>
                </div>

                {/* Withdrawal history */}
                {t.treasury?.withdrawals?.length>0 && (
                  <div style={{ marginTop:"12px" }}>
                    <div style={{ fontSize:".72rem", color:"var(--warning)", textTransform:"uppercase", letterSpacing:".06em", marginBottom:"7px", fontWeight:700 }}>⚠️ Withdrawal History (public)</div>
                    {t.treasury.withdrawals.map((w,i)=>(
                      <div key={i} style={{ display:"flex", justifyContent:"space-between", padding:"7px 0", borderBottom:i<t.treasury.withdrawals.length-1?"1px solid var(--border)":"none", fontSize:".78rem" }}>
                        <span style={{ color:"var(--text3)" }}>{new Date(w.timestamp).toLocaleDateString()} — {w.note||"Creator withdrawal"}</span>
                        <span style={{ fontFamily:"var(--mono)", color:"var(--warning)", fontWeight:700 }}>-{w.amount.toFixed(4)} SOL</span>
                      </div>
                    ))}
                  </div>
                )}

                <div style={{ display:"flex", gap:"16px", marginTop:"12px", fontSize:".75rem", color:"var(--text3)" }}>
                  <span>Fee: <strong style={{ color:"var(--text)" }}>{t.feeModeName}</strong></span>
                  <span style={{ fontFamily:"var(--mono)" }}>{t.mint.slice(0,20)}...</span>
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {/* Withdraw modal */}
      {withdrawToken && (
        <div className="overlay" onClick={e=>e.target===e.currentTarget&&setWithdrawToken(null)}>
          <div className="modal" style={{ padding:"34px" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:"20px" }}>
              <div>
                <h2 style={{ fontWeight:700, fontSize:"1.2rem", marginBottom:"4px" }}>Withdraw from ${withdrawToken.symbol} Treasury</h2>
                <p style={{ color:"var(--text2)", fontSize:".83rem" }}>Available: {withdrawToken.treasury.balanceSOL.toFixed(4)} SOL</p>
              </div>
              <button onClick={()=>setWithdrawToken(null)} style={{ background:"none", border:"none", color:"var(--text3)", fontSize:"1.3rem", cursor:"pointer" }}>×</button>
            </div>

            <div style={{ padding:"14px 16px", background:"rgba(251,191,36,.08)", border:"1px solid rgba(251,191,36,.2)", borderRadius:"var(--r)", marginBottom:"18px", fontSize:".82rem", color:"var(--warning)", lineHeight:1.65 }}>
              ⚠️ <strong>Transparency warning:</strong> All withdrawals are recorded and visible to your community. Large withdrawals may signal a negative exit and impact your token value.
            </div>

            <div className="field" style={{ marginBottom:"14px" }}>
              <label className="label">Amount to withdraw (SOL)</label>
              <input className="input" type="number" min="0.001" step="0.01" max={withdrawToken.treasury.balanceSOL} placeholder="0.5" value={withdrawAmount} onChange={e=>setWithdrawAmount(e.target.value)} />
            </div>
            <div className="field" style={{ marginBottom:"20px" }}>
              <label className="label">Note (visible to community)</label>
              <input className="input" placeholder="e.g. Development costs Q1..." value={withdrawNote} onChange={e=>setWithdrawNote(e.target.value)} />
            </div>

            <div style={{ display:"flex", gap:"10px" }}>
              <button className="btn btn-ghost btn-full" onClick={()=>setWithdrawToken(null)}>Cancel</button>
              <button className="btn btn-primary btn-full" onClick={handleWithdraw}>Confirm Withdrawal</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
