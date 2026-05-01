import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { useWallet, useConnection, useAnchorWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import {
  fetchAllProjects, fetchCreatorCampaigns, withdrawTreasuryOnChain,
  routeToTreasuryOnChain, claimPrizeOnChain, resolveCampaignOnChain,
  campaignAccountToDisplay, posStatus, fmtPos, timeLeft, isExpired,
} from "../lib/programClient.js";
import { AnchorProvider } from "@coral-xyz/anchor";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { requestAirdrop, getSOLBalance } from "../lib/solana.js";
import { bagsTokenUrl, isRealMint, getTokenMarketData, executeReinvest,
  getClaimablePositions, getClaimTransactionsV3, executeClaimTransactions,
  updateFeeShareConfig, transferFeeShareAdmin, getFeeShareAdminList,
  getLifetimeFees, checkDexscreenerAvailability } from "../lib/bags.js";
import { IS_MAINNET, NETWORK, SOL_MINT } from "../lib/constants.js";
import { useToast } from "../components/Toast.jsx";
import { sortCampaignsByPriority } from "../utils/campaignSorting.js";

export default function DashboardPage() {
  const { connection } = useConnection();
  const wallet  = useAnchorWallet();
  const { setVisible } = useWalletModal();
  const toast   = useToast(); // returns function directly

  const [projects,  setProjects]  = useState([]);  // array of all creator projects
  const [campaigns, setCampaigns] = useState([]);  // all campaigns (any project)
  const [balance,   setBalance]   = useState(0);
  const [loading,   setLoading]   = useState(true);
  const [dropping,  setDropping]  = useState(false);

  // Withdraw modal
  const [wModal, setWModal]     = useState({ show: false, project: null });
  const [wAmount, setWAmount]   = useState("");

  // Reinvest modal  
  const [rModal, setRModal]     = useState({ show: false, project: null });
  const [rAmount, setRAmount]   = useState("");
  const [rQuote,  setRQuote]    = useState(null);
  const [rLoading, setRLoading] = useState(false);
  const [rStep,   setRStep]     = useState(1);

  // Fee sharing management modal
  const [fsModal, setFsModal]   = useState({ show: false, project: null });
  const [fsClaimers, setFsClaimers] = useState([{ wallet: "", bp: 10000 }]);
  const [fsLoading, setFsLoading]   = useState(false);
  const [fsTab, setFsTab]           = useState("update"); // "update" | "transfer"
  const [fsNewAdmin, setFsNewAdmin] = useState("");

  // Claim Bags fees modal
  const [claimModal, setClaimModal]   = useState({ show: false, project: null });
  const [claimTxs, setClaimTxs]       = useState([]);
  const [claimLoading, setClaimLoading] = useState(false);

  // Token market data cache { mint → {price, volume24h, marketCap, holders} }
  const [marketData, setMarketData]   = useState({});
  const [lifetimeFees, setLifetimeFees] = useState({});

  // Claimable fees
  const [claimable, setClaimable]   = useState([]);

  // Selected project for campaign filtering (null = show all)
  const [activeProjectIndex, setActiveProjectIndex] = useState(null);

  // Live countdown
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  async function refresh() {
    const pubkeyStr = wallet?.publicKey?.toBase58();
    if (!pubkeyStr) { setLoading(false); return; }
    setLoading(true);

    const timeout = setTimeout(() => { setLoading(false); toast("Network slow. Retry.", "info"); }, 18000);

    try {
      const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });

      // 1. Fetch ALL projects for this creator
      const allProjects = await fetchAllProjects(provider, pubkeyStr);
      setProjects(allProjects);

      // 2. Fetch ALL campaigns (all projects combined)
      const raw = await fetchCreatorCampaigns(provider, pubkeyStr);
      const mapped = (raw || []).map(camp => {
        try {
          const { pda, ...acc } = camp;
          return campaignAccountToDisplay(pda, acc);
        } catch { return null; }
      }).filter(Boolean);
      setCampaigns(sortCampaignsByPriority(mapped));

      // 3. Balance
      const b = await getSOLBalance(pubkeyStr);
      setBalance(b || 0);

      // 4. Token market data + lifetime fees for each project (best-effort)
      const mdata = {}; const lfees = {};
      for (const p of allProjects) {
        if (p.mint && p.mint !== 'D9KdRFUG4mZ3gqgDSF8mdfDpJk7qKHsmDn8g3dRsvfBV') {
          const [md, lf] = await Promise.allSettled([getTokenMarketData(p.mint), getLifetimeFees(p.mint)]);
          if (md.value) mdata[p.mint] = md.value;
          if (lf.value !== null && lf.value !== undefined) lfees[p.mint] = lf.value;
        }
      }
      setMarketData(mdata);
      setLifetimeFees(lfees);

      // 5. Claimable fee positions
      try {
        const cl = await getClaimablePositions(pubkeyStr);
        setClaimable(Array.isArray(cl) ? cl : []);
      } catch { setClaimable([]); }

    } catch (e) {
      console.error("[Dashboard] error:", e.message);
      toast("Error loading data", "error");
    } finally {
      clearTimeout(timeout);
      setLoading(false);
    }
  }

  useEffect(() => {
    if (wallet?.publicKey) refresh(); else setLoading(false);
  }, [wallet?.publicKey?.toBase58()]);

  async function handleAirdrop() {
    setDropping(true);
    try {
      toast("Requesting 5 SOL airdrop...", "info");
      await requestAirdrop(wallet.publicKey.toBase58(), 5);
      await refresh();
      toast("✓ +5 SOL received!", "success");
    } catch { toast("Airdrop failed. Try in 30s", "error"); }
    finally { setDropping(false); }
  }

  const handleWithdraw = (project) => {
    setWModal({ show: true, project });
    setWAmount(project.treasury.balanceSOL.toFixed(4));
  };

  const confirmWithdraw = async () => {
    const project  = wModal.project;
    const amtSOL   = parseFloat(wAmount);
    if (isNaN(amtSOL) || amtSOL <= 0 || amtSOL > project.treasury.balanceSOL) {
      toast("Invalid amount", "error"); return;
    }
    setWModal({ show: false, project: null });
    setLoading(true);
    toast(`Withdrawing ${amtSOL} SOL from ${project.name}...`, "info");
    try {
      const provider  = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
      const lamports  = Math.floor(amtSOL * LAMPORTS_PER_SOL);
      await withdrawTreasuryOnChain(provider, {
        projectIndex:   project.projectIndex,
        amountLamports: lamports,
      });
      toast(`✓ ${amtSOL} SOL withdrawn from ${project.name}!`, "success");
      setTimeout(() => refresh(), 1200);
    } catch (e) {
      toast("Withdrawal failed: " + (e.message || ""), "error");
      setLoading(false);
    }
  };

  async function handleClaim(campaign) {
    if (!wallet) return;
    setLoading(true);
    toast("Claiming prize...", "info");
    try {
      const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
      await claimPrizeOnChain(provider, { campaignPDA: campaign.pda });
      toast("Prize claimed! 🥳", "success");
      setCampaigns(prev => prev.map(camp => 
        camp.pda === campaign.pda ? { ...camp, claimed: true } : camp
      ));
      setTimeout(() => refresh(), 1200);
    } catch (e) {
      toast("Claim error: " + (e.message || ""), "error");
      setLoading(false);
    }
  }

  async function handleRoute(campaign) {
    if (!wallet) return;
    setLoading(true);
    toast("Moving funds to treasury...", "info");
    try {
      const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
      await routeToTreasuryOnChain(provider, { campaignPDA: campaign.pda });
      toast("Funds moved to treasury ✅", "success");
      setTimeout(() => refresh(), 2000);
    } catch (e) {
      if (e.message?.includes("6015") || e.message?.includes("InsufficientFunds")) {
        toast("Funds already in treasury", "info");
        setCampaigns(prev => prev.map(c => c.pda === campaign.pda ? { ...c, prizeSOL: 0 } : c));
      } else {
        toast("Transfer failed: " + (e.message || ""), "error");
      }
      setLoading(false);
    }
  }

  async function handleResolve(campaign) {
    if (!wallet) return;
    const pda = campaign?.pda;
    if (!pda) { toast("Campaign address missing", "error"); return; }
    setLoading(true);
    toast("Resolving round on-chain...", "info");
    try {
      const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
      await resolveCampaignOnChain(provider, { campaignPDA: pda });
      toast("Round resolved! 🎲", "success");
      setTimeout(() => refresh(), 1500);
    } catch (e) {
      toast("Resolution failed: " + (e.message || ""), "error");
      setLoading(false);
    }
  }

  // ─── Open fee share manager ──────────────────────────────────────────────────
  async function openFeeShareModal(project) {
    setFsTab("update");
    setFsNewAdmin("");
    setFsLoading(true);
    setFsModal({ show: true, project });
    try {
      const admins = await getFeeShareAdminList(wallet.publicKey.toString());
      const mine = admins.find(a => a.baseMint === project.mint || a.tokenMint === project.mint);
      if (mine?.claimers) {
        setFsClaimers(mine.claimers.map(c => ({ wallet: c.wallet || c.publicKey || "", bp: c.basisPoints || c.bp || 0 })));
      } else {
        setFsClaimers([{ wallet: wallet.publicKey.toString(), bp: 10000 }]);
      }
    } catch { setFsClaimers([{ wallet: wallet.publicKey.toString(), bp: 10000 }]); }
    finally { setFsLoading(false); }
  }

  async function handleUpdateFeeShare() {
    if (!wallet || !fsModal.project) return;
    const totalBP = fsClaimers.reduce((s, c) => s + Number(c.bp), 0);
    if (totalBP !== 10000) { toast(`Total must be 10 000 bp (currently ${totalBP})`, "error"); return; }
    setFsLoading(true);
    try {
      await updateFeeShareConfig(wallet, {
        baseMint: fsModal.project.mint,
        claimersArray: fsClaimers.map(c => c.wallet),
        basisPointsArray: fsClaimers.map(c => Number(c.bp)),
      });
      toast("✅ Fee sharing updated!", "success");
      setFsModal({ show: false, project: null });
    } catch (e) { toast("Update failed: " + (e.message || ""), "error"); }
    finally { setFsLoading(false); }
  }

  async function handleTransferAdmin() {
    if (!wallet || !fsModal.project || !fsNewAdmin.trim()) { toast("Enter new admin wallet", "error"); return; }
    setFsLoading(true);
    try {
      const sig = await transferFeeShareAdmin(wallet, { baseMint: fsModal.project.mint, newAdmin: fsNewAdmin.trim() });
      toast("✅ Admin transferred! tx: " + sig.slice(0,8) + "...", "success");
      setFsModal({ show: false, project: null });
    } catch (e) { toast("Transfer failed: " + (e.message || ""), "error"); }
    finally { setFsLoading(false); }
  }

  // ─── Open claim fees modal ────────────────────────────────────────────────
  async function openClaimModal(project) {
    setClaimModal({ show: true, project });
    setClaimLoading(true);
    setClaimTxs([]);
    try {
      const txs = await getClaimTransactionsV3(wallet.publicKey.toString(), project.mint);
      setClaimTxs(Array.isArray(txs) ? txs : []);
    } catch { setClaimTxs([]); }
    finally { setClaimLoading(false); }
  }

  async function handleExecuteClaim() {
    if (!wallet || claimTxs.length === 0) return;
    setClaimLoading(true);
    try {
      const results = await executeClaimTransactions(wallet, claimTxs);
      const ok = results.filter(r => r.success).length;
      toast(`✅ ${ok}/${results.length} claim TXs confirmed!`, "success");
      setClaimModal({ show: false, project: null });
      setTimeout(() => refresh(), 2000);
    } catch (e) { toast("Claim error: " + (e.message || ""), "error"); }
    finally { setClaimLoading(false); }
  }


  const visibleCampaigns = activeProjectIndex === null
    ? campaigns
    : campaigns.filter(c => c.projectIndex === activeProjectIndex);

  // ─── Not connected ──────────────────────────────────────────────────────────
  if (!wallet) return (
    <div style={{ padding: "100px 24px", textAlign: "center" }}>
      <div style={{ fontSize: "3.5rem", marginBottom: "20px" }}>🔌</div>
      <h2 style={{ marginBottom: "12px", fontWeight: 700 }}>Creator Dashboard</h2>
      <p style={{ color: "var(--text2)", maxWidth: "420px", margin: "0 auto 28px" }}>
        Connect your wallet to manage your tokens, campaigns, and treasury.
      </p>
      <button className="btn btn-primary btn-lg" onClick={() => setVisible(true)}>Connect Wallet</button>
    </div>
  );

  if (loading) return (
    <div style={{ padding: "100px 24px", textAlign: "center" }}>
      <div className="spinner" style={{ margin: "0 auto 20px" }} />
      <p style={{ color: "var(--text3)" }}>Loading {NETWORK} data...</p>
    </div>
  );

  const totalTreasury = projects.reduce((s, p) => s + (p.treasury?.balanceSOL || 0), 0);

  return (
    <div style={{ padding: "40px 24px", maxWidth: "1200px", margin: "0 auto" }}>

      {/* ── HEADER ── */}
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: "40px", flexWrap: "wrap", gap: "16px" }}>
        <div>
          <h1 style={{ fontSize: "2rem", fontWeight: 800, marginBottom: "8px" }}>Dashboard</h1>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", color: "var(--text3)", fontSize: ".83rem" }}>
            <code style={{ background: "rgba(255,255,255,.05)", padding: "3px 7px", borderRadius: "4px" }}>
              {wallet.publicKey.toBase58().slice(0,8)}...{wallet.publicKey.toBase58().slice(-8)}
            </code>
            <button onClick={() => { navigator.clipboard.writeText(wallet.publicKey.toBase58()); toast("Copied!", "success"); }}
              style={{ background: "none", border: "none", color: "var(--accent)", cursor: "pointer" }}>📋</button>
          </div>
        </div>

        <div style={{ display: "flex", gap: "32px", alignItems: "flex-end" }}>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: ".7rem", color: "var(--text3)", textTransform: "uppercase", marginBottom: "2px" }}>{IS_MAINNET ? "Mainnet" : "DevNet"} Balance</div>
            <div style={{ fontSize: "1.3rem", fontWeight: 700, fontFamily: "var(--mono)" }}>
              {balance.toFixed(4)} <span style={{ color: "var(--accent)", fontSize: ".9rem" }}>SOL</span>
            </div>
            {!IS_MAINNET && (
              <button onClick={handleAirdrop} disabled={dropping}
                style={{ background: "none", border: "none", color: "var(--accent)", fontSize: ".78rem", cursor: "pointer", textDecoration: "underline" }}>
                {dropping ? "..." : "☁️ +5 SOL Airdrop"}
              </button>
            )}
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: ".7rem", color: "var(--text3)", textTransform: "uppercase", marginBottom: "2px" }}>Total Treasury</div>
            <div style={{ fontSize: "1.3rem", fontWeight: 700, fontFamily: "var(--mono)", color: "var(--green)" }}>
              {totalTreasury.toFixed(4)} <span style={{ fontSize: ".9rem" }}>SOL</span>
            </div>
            <div style={{ fontSize: ".7rem", color: "var(--text3)" }}>{projects.length} token{projects.length !== 1 ? "s" : ""}</div>
          </div>
        </div>
      </header>

      {/* ── TOKENS / PROJECTS SECTION ── */}
      <section style={{ marginBottom: "48px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
          <h2 style={{ fontSize: "1.2rem", fontWeight: 700 }}>
            My Tokens
            {projects.length > 0 && (
              <span style={{ marginLeft: "10px", fontSize: ".75rem", fontFamily: "var(--mono)", color: "var(--text3)", background: "var(--bg2)", padding: "2px 8px", borderRadius: "10px" }}>
                {projects.length} / ∞
              </span>
            )}
          </h2>
          <Link to="/create-token" className="btn btn-sm btn-primary">+ New Token</Link>
        </div>

        {projects.length === 0 ? (
          <div style={{ padding: "40px", textAlign: "center", background: "var(--card-bg)", borderRadius: "var(--r)", border: "1px dashed var(--border)" }}>
            <p style={{ color: "var(--text3)", marginBottom: "16px" }}>No tokens yet. Create your first to start funding campaigns.</p>
            <Link to="/create-token" className="btn btn-primary">🚀 Create Token</Link>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: "20px" }}>
            {projects.map(p => {
              const isSelected = activeProjectIndex === p.projectIndex;
              const projCampaigns = campaigns.filter(c => c.projectIndex === p.projectIndex);
              const isReal = isRealMint(p.mint);

              return (
                <div key={p.pda} className="card"
                  style={{ padding: "22px", border: isSelected ? "1px solid rgba(56,189,248,.5)" : "1px solid var(--border)", background: isSelected ? "rgba(56,189,248,.03)" : "var(--card-bg)", cursor: "pointer", transition: "var(--ease)" }}
                  onClick={() => setActiveProjectIndex(isSelected ? null : p.projectIndex)}
                >
                  {/* Token header */}
                  <div style={{ display: "flex", gap: "14px", marginBottom: "14px" }}>
                    <div style={{ width: "52px", height: "52px", borderRadius: "10px", background: "var(--bg3)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, overflow: "hidden", border: "1px solid var(--border)" }}>
                      {p.logo ? <img src={p.logo} alt={p.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span style={{ fontSize: "1.3rem" }}>🪙</span>}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "2px" }}>
                        <h3 style={{ fontWeight: 800, fontSize: "1rem", margin: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</h3>
                        <span style={{ fontSize: ".65rem", background: "rgba(56,189,248,.1)", color: "var(--accent)", padding: "1px 6px", borderRadius: "4px", fontWeight: 700, whiteSpace: "nowrap" }}>
                          #{p.projectIndex}
                        </span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                        <span style={{ fontFamily: "var(--mono)", fontSize: ".75rem", color: "var(--accent)", fontWeight: 700 }}>${p.symbol}</span>
                        <a href={bagsTokenUrl(p.mint)} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
                          style={{ fontSize: ".65rem", color: isReal ? "var(--accent)" : "var(--text3)", textDecoration: "none", background: isReal ? "rgba(56,189,248,.08)" : "rgba(255,255,255,.04)", padding: "1px 6px", borderRadius: "4px", border: "1px solid " + (isReal ? "rgba(56,189,248,.25)" : "var(--border)") }}>
                          🔗 Bags ↗
                        </a>
                      </div>
                    </div>
                  </div>

                  {/* Status badges */}
                  <div style={{ display: "flex", gap: "6px", marginBottom: "14px", flexWrap: "wrap" }}>
                    {isReal
                      ? <span style={{ fontSize: ".63rem", background: "rgba(52,211,153,.1)", color: "var(--green)", padding: "2px 7px", borderRadius: "4px", fontWeight: 600 }}>✅ Mainnet</span>
                      : <span style={{ fontSize: ".63rem", background: "rgba(251,191,36,.08)", color: "#fbbf24", padding: "2px 7px", borderRadius: "4px", fontWeight: 600 }}>⚠ Simulated</span>
                    }
                    <span style={{ fontSize: ".63rem", background: "var(--bg2)", color: "var(--text3)", padding: "2px 7px", borderRadius: "4px" }}>
                      {projCampaigns.length} campaign{projCampaigns.length !== 1 ? "s" : ""}
                    </span>
                  </div>

                  {/* Market data */}
                  {marketData[p.mint] && (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px", marginBottom: "12px" }}>
                      {[
                        ["Price", marketData[p.mint].price ? `$${Number(marketData[p.mint].price).toFixed(6)}` : "—"],
                        ["Vol 24h", marketData[p.mint].volume24h ? `$${Number(marketData[p.mint].volume24h).toLocaleString('en',{maximumFractionDigits:0})}` : "—"],
                        ["Holders", marketData[p.mint].holders || "—"],
                      ].map(([l,v]) => (
                        <div key={l} style={{ textAlign:"center", padding:"6px 4px", background:"var(--bg2)", borderRadius:"6px" }}>
                          <div style={{ fontSize:".6rem", color:"var(--text3)", textTransform:"uppercase", marginBottom:"2px" }}>{l}</div>
                          <div style={{ fontSize:".78rem", fontWeight:700, color:"var(--accent)", fontFamily:"var(--mono)" }}>{v}</div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Lifetime fees from Bags API */}
                  {lifetimeFees[p.mint] !== undefined && (
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"7px 12px", background:"rgba(52,211,153,.04)", border:"1px solid rgba(52,211,153,.1)", borderRadius:"8px", marginBottom:"10px" }}>
                      <span style={{ fontSize:".68rem", color:"var(--text3)", textTransform:"uppercase" }}>Lifetime Bags Fees</span>
                      <span style={{ fontFamily:"var(--mono)", fontSize:".8rem", fontWeight:700, color:"var(--green)" }}>
                        {typeof lifetimeFees[p.mint] === "object"
                          ? `${Number(lifetimeFees[p.mint]?.totalFees || 0).toFixed(4)} SOL`
                          : `${Number(lifetimeFees[p.mint]).toFixed(4)} SOL`}
                      </span>
                    </div>
                  )}

                  {/* Treasury */}
                  <div style={{ padding: "10px 14px", background: "rgba(52,211,153,.04)", borderRadius: "8px", border: "1px solid rgba(52,211,153,.1)", marginBottom: "14px" }}>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom: p.treasury.balanceSOL > 0 ? "10px" : "0" }}>
                      <div>
                        <div style={{ fontSize: ".62rem", color: "var(--text3)", textTransform: "uppercase", marginBottom: "2px" }}>Treasury</div>
                        <div style={{ fontSize: "1.1rem", fontWeight: 800, color: "var(--green)" }}>
                          {p.treasury.balanceSOL.toFixed(4)} SOL
                        </div>
                      </div>
                      {p.treasury.balanceSOL > 0 && (
                        <button
                          onClick={e => { e.stopPropagation(); handleWithdraw(p); }}
                          className="btn btn-sm btn-ghost" style={{ fontSize: ".72rem", padding: "5px 10px" }}>
                          ↑ Withdraw
                        </button>
                      )}
                    </div>
                    {p.treasury.balanceSOL > 0 && (
                      <button
                        onClick={e => { e.stopPropagation(); setRModal({ show: true, project: p }); setRAmount(p.treasury.balanceSOL.toFixed(4)); setRQuote(null); setRStep(1); }}
                        className="btn btn-primary btn-sm" style={{ width:"100%", fontSize:".74rem", padding:"7px", background:"linear-gradient(90deg, #7c3aed 0%, #38bdf8 100%)", border:"none" }}>
                        🔥 Reinvest in ${p.symbol} Token
                      </button>
                    )}
                  </div>

                  {/* Actions */}
                  <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                    <Link to={`/create-campaign?project=${p.projectIndex}`} onClick={e => e.stopPropagation()}
                      className="btn btn-primary" style={{ flex: 1, padding: "8px", textAlign: "center", fontSize: ".78rem" }}>
                      + Campaign
                    </Link>
                    <button onClick={e => { e.stopPropagation(); setActiveProjectIndex(isSelected ? null : p.projectIndex); }}
                      className="btn btn-ghost" style={{ flex: 1, padding: "8px", fontSize: ".78rem", color: isSelected ? "var(--accent)" : "var(--text3)" }}>
                      {isSelected ? "▲ Hide" : "▼ Campaigns"}
                    </button>
                  </div>
                  {/* Fee management row */}
                  {isReal && (
                    <div style={{ display: "flex", gap: "6px", marginTop: "8px" }}>
                      <button onClick={e => { e.stopPropagation(); openFeeShareModal(p); }}
                        className="btn btn-ghost btn-sm" style={{ flex: 1, fontSize: ".71rem", padding: "6px 8px" }}>
                        ⚙️ Fee Sharing
                      </button>
                      <button onClick={e => { e.stopPropagation(); openClaimModal(p); }}
                        className="btn btn-ghost btn-sm" style={{ flex: 1, fontSize: ".71rem", padding: "6px 8px", color: "var(--green)" }}>
                        💰 Claim Fees
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ── CAMPAIGNS SECTION ── */}
      <section>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px", flexWrap: "wrap", gap: "10px" }}>
          <h2 style={{ fontSize: "1.2rem", fontWeight: 700 }}>
            Campaigns
            {activeProjectIndex !== null && projects.find(p => p.projectIndex === activeProjectIndex) && (
              <span style={{ marginLeft: "10px", fontSize: ".8rem", color: "var(--accent)", fontWeight: 600 }}>
                — {projects.find(p => p.projectIndex === activeProjectIndex)?.name}
              </span>
            )}
          </h2>

          {/* Project filter tabs */}
          {projects.length > 1 && (
            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
              <button onClick={() => setActiveProjectIndex(null)}
                className={`btn btn-sm ${activeProjectIndex === null ? "btn-primary" : "btn-ghost"}`}
                style={{ fontSize: ".72rem", padding: "4px 10px" }}>
                All ({campaigns.length})
              </button>
              {projects.map(p => (
                <button key={p.pda} onClick={() => setActiveProjectIndex(p.projectIndex === activeProjectIndex ? null : p.projectIndex)}
                  className={`btn btn-sm ${activeProjectIndex === p.projectIndex ? "btn-primary" : "btn-ghost"}`}
                  style={{ fontSize: ".72rem", padding: "4px 10px" }}>
                  ${p.symbol} ({campaigns.filter(c => c.projectIndex === p.projectIndex).length})
                </button>
              ))}
            </div>
          )}
        </div>

        {visibleCampaigns.length === 0 ? (
          <div style={{ padding: "40px", textAlign: "center", background: "var(--card-bg)", borderRadius: "var(--r)", border: "1px dashed var(--border)" }}>
            <p style={{ color: "var(--text3)" }}>
              {activeProjectIndex !== null ? "No campaigns for this token yet." : "No campaigns yet."}
            </p>
            {projects.length > 0 && (
              <Link to={`/create-campaign${activeProjectIndex !== null ? `?project=${activeProjectIndex}` : ""}`}
                className="btn btn-primary" style={{ marginTop: "12px" }}>Create Campaign</Link>
            )}
          </div>
        ) : (
          <div>
            <CampaignSection 
              title="🔥 Active Campaigns" 
              campaigns={visibleCampaigns.filter(c => c.status === 'active')} 
              wallet={wallet} 
              projects={projects} 
              handleClaim={handleClaim} 
              handleResolve={handleResolve} 
              handleRoute={handleRoute} 
            />
            <CampaignSection 
              title="⏳ Upcoming Campaigns" 
              campaigns={visibleCampaigns.filter(c => c.status === 'pending')} 
              wallet={wallet} 
              projects={projects} 
              handleClaim={handleClaim} 
              handleResolve={handleResolve} 
              handleRoute={handleRoute} 
            />
            <CampaignSection 
              title="📊 Completed Campaigns" 
              campaigns={visibleCampaigns.filter(c => ['settled', 'finished'].includes(c.status))} 
              wallet={wallet} 
              projects={projects} 
              handleClaim={handleClaim} 
              handleResolve={handleResolve} 
              handleRoute={handleRoute} 
            />
          </div>
        )}
      </section>

      {/* ── FEE SHARING MANAGEMENT MODAL ── */}
      {fsModal.show && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.88)", backdropFilter:"blur(10px)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:1000, padding:"20px" }}>
          <div className="card" style={{ maxWidth:"520px", width:"100%", padding:"32px", maxHeight:"90vh", overflowY:"auto" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"6px" }}>
              <h2 style={{ fontWeight:800, margin:0 }}>⚙️ Manage Fee Sharing</h2>
              <button onClick={() => setFsModal({ show:false, project:null })} style={{ background:"none", border:"none", color:"var(--text3)", fontSize:"1.4rem", cursor:"pointer" }}>×</button>
            </div>
            <p style={{ color:"var(--text3)", fontSize:".84rem", marginBottom:"18px" }}>
              Token: <strong style={{ color:"var(--accent)" }}>${fsModal.project?.symbol}</strong> — Changes require a signed Mainnet transaction.
            </p>

            {/* Tabs */}
            <div style={{ display:"flex", gap:"8px", marginBottom:"20px" }}>
              {["update","transfer"].map(t => (
                <button key={t} onClick={() => setFsTab(t)}
                  className={`btn btn-sm ${fsTab === t ? "btn-primary" : "btn-ghost"}`}
                  style={{ fontSize:".76rem" }}>
                  {t === "update" ? "Update Claimers" : "Transfer Admin"}
                </button>
              ))}
            </div>

            {fsTab === "update" && (
              <div style={{ display:"flex", flexDirection:"column", gap:"12px" }}>
                {fsLoading ? <div style={{ textAlign:"center", color:"var(--text3)", padding:"20px" }}>Loading current config…</div> : (
                  <>
                    {fsClaimers.map((c, i) => (
                      <div key={i} style={{ display:"flex", gap:"8px", alignItems:"center" }}>
                        <input className="input" style={{ flex:3, fontFamily:"var(--mono)", fontSize:".78rem" }}
                          placeholder="Wallet address" value={c.wallet}
                          onChange={e => setFsClaimers(cl => cl.map((x, idx) => idx === i ? { ...x, wallet: e.target.value } : x))} />
                        <input type="number" className="input" style={{ flex:1, fontFamily:"var(--mono)" }}
                          placeholder="bp" value={c.bp}
                          onChange={e => setFsClaimers(cl => cl.map((x, idx) => idx === i ? { ...x, bp: e.target.value } : x))} />
                        <span style={{ fontSize:".72rem", color:"var(--text3)", minWidth:"32px" }}>
                          {((Number(c.bp)||0)/100).toFixed(0)}%
                        </span>
                        {fsClaimers.length > 1 && (
                          <button onClick={() => setFsClaimers(cl => cl.filter((_,idx)=>idx!==i))}
                            style={{ background:"none", border:"none", color:"var(--text3)", cursor:"pointer" }}>×</button>
                        )}
                      </div>
                    ))}
                    <div style={{ display:"flex", justifyContent:"space-between", padding:"8px 12px", background: fsClaimers.reduce((s,c)=>s+Number(c.bp),0)===10000 ? "rgba(52,211,153,.06)" : "rgba(251,59,59,.06)", borderRadius:"6px", fontSize:".8rem" }}>
                      <span>Total</span>
                      <span style={{ fontFamily:"var(--mono)", fontWeight:700, color: fsClaimers.reduce((s,c)=>s+Number(c.bp),0)===10000 ? "var(--green)" : "var(--danger)" }}>
                        {fsClaimers.reduce((s,c)=>s+Number(c.bp),0)} / 10 000 bp
                      </span>
                    </div>
                    {fsClaimers.length < 100 && (
                      <button className="btn btn-ghost" style={{ alignSelf:"flex-start", fontSize:".76rem" }}
                        onClick={() => setFsClaimers(cl => [...cl, { wallet:"", bp:0 }])}>
                        + Add claimer
                      </button>
                    )}
                    <button className="btn btn-primary" onClick={handleUpdateFeeShare} disabled={fsLoading}>
                      {fsLoading ? "Updating…" : "✅ Confirm & Sign TX"}
                    </button>
                  </>
                )}
              </div>
            )}

            {fsTab === "transfer" && (
              <div style={{ display:"flex", flexDirection:"column", gap:"14px" }}>
                <div style={{ padding:"12px 14px", background:"rgba(251,191,36,.05)", border:"1px solid rgba(251,191,36,.2)", borderRadius:"8px", fontSize:".8rem", color:"#fbbf24" }}>
                  ⚠ Transferring admin gives full fee management rights to the new wallet. This cannot be undone without their cooperation.
                </div>
                <div className="field">
                  <label className="label">New admin wallet address</label>
                  <input className="input" style={{ fontFamily:"var(--mono)", fontSize:".82rem" }}
                    placeholder="New admin public key"
                    value={fsNewAdmin} onChange={e => setFsNewAdmin(e.target.value)} />
                </div>
                <button className="btn btn-primary" onClick={handleTransferAdmin} disabled={fsLoading || !fsNewAdmin.trim()}>
                  {fsLoading ? "Transferring…" : "🔑 Transfer Admin Authority"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── CLAIM FEES MODAL ── */}
      {claimModal.show && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.88)", backdropFilter:"blur(10px)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:1000, padding:"20px" }}>
          <div className="card" style={{ maxWidth:"460px", width:"100%", padding:"32px" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"6px" }}>
              <h2 style={{ fontWeight:800, margin:0 }}>💰 Claim Bags Fees</h2>
              <button onClick={() => setClaimModal({ show:false, project:null })} style={{ background:"none", border:"none", color:"var(--text3)", fontSize:"1.4rem", cursor:"pointer" }}>×</button>
            </div>
            <p style={{ color:"var(--text3)", fontSize:".84rem", marginBottom:"20px" }}>
              Token: <strong style={{ color:"var(--accent)" }}>${claimModal.project?.symbol}</strong>
            </p>

            {claimLoading ? (
              <div style={{ textAlign:"center", padding:"24px", color:"var(--text3)" }}>
                <div className="spinner" style={{ margin:"0 auto 12px" }} />
                Loading claimable fees…
              </div>
            ) : claimTxs.length === 0 ? (
              <div style={{ textAlign:"center", padding:"24px 0", color:"var(--text3)", fontSize:".88rem" }}>
                No claimable fees at this time.<br />
                <span style={{ fontSize:".78rem" }}>Fees accumulate as your token is traded on Bags.</span>
              </div>
            ) : (
              <div style={{ display:"flex", flexDirection:"column", gap:"14px" }}>
                <div style={{ padding:"12px 14px", background:"rgba(52,211,153,.06)", border:"1px solid rgba(52,211,153,.2)", borderRadius:"8px", fontSize:".82rem" }}>
                  <strong style={{ color:"var(--green)" }}>{claimTxs.length} transaction{claimTxs.length !== 1 ? "s" : ""}</strong> ready to claim.
                  Each TX must be signed individually.
                </div>
                <button className="btn btn-primary" onClick={handleExecuteClaim} disabled={claimLoading}
                  style={{ background:"linear-gradient(90deg, #059669 0%, #34d399 100%)", border:"none" }}>
                  {claimLoading ? "Claiming…" : "💰 Sign & Claim All Fees"}
                </button>
              </div>
            )}

            <button className="btn btn-ghost" style={{ width:"100%", marginTop:"12px" }}
              onClick={() => setClaimModal({ show:false, project:null })}>Close</button>
          </div>
        </div>
      )}
      {rModal.show && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.88)", backdropFilter:"blur(10px)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:1000, padding:"20px" }}>
          <div className="card" style={{ maxWidth:"480px", width:"100%", padding:"32px" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"6px" }}>
              <h2 style={{ fontWeight:800, margin:0 }}>🔥 Reinvest Treasury</h2>
              <button onClick={() => setRModal({ show:false, project:null })} style={{ background:"none", border:"none", color:"var(--text3)", fontSize:"1.4rem", cursor:"pointer" }}>×</button>
            </div>
            <p style={{ color:"var(--text3)", fontSize:".84rem", marginBottom:"20px" }}>
              Use treasury SOL to buy <strong style={{ color:"var(--accent)" }}>${rModal.project?.symbol}</strong> on Bags.
              This creates buy pressure and increases token value.
            </p>

            {/* Flywheel explanation */}
            <div style={{ padding:"12px 14px", background:"rgba(124,58,237,.08)", border:"1px solid rgba(124,58,237,.2)", borderRadius:"8px", marginBottom:"18px", fontSize:".77rem", color:"#a78bfa", lineHeight:1.6 }}>
              <strong style={{ display:"block", marginBottom:"4px" }}>The Flywheel</strong>
              Campaign treasury → buy ${rModal.project?.symbol} → price rises → more attractive campaigns → bigger treasury → repeat
            </div>

            <label style={{ fontSize:".78rem", color:"var(--text2)", display:"block", marginBottom:"6px" }}>
              Amount to reinvest (SOL) — available: {rModal.project?.treasury.balanceSOL.toFixed(4)} SOL
            </label>
            <input type="number" value={rAmount}
              onChange={e => { setRAmount(e.target.value); setRQuote(null); }}
              className="input" style={{ marginBottom:"12px", fontSize:"1rem", fontWeight:600 }}
              max={rModal.project?.treasury.balanceSOL}
              step="0.001" />

            {/* Quote preview */}
            {rQuote && (
              <div style={{ padding:"12px 14px", background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:"8px", marginBottom:"14px", fontSize:".8rem" }}>
                <div style={{ display:"flex", justifyContent:"space-between", marginBottom:"4px" }}>
                  <span style={{ color:"var(--text3)" }}>You spend</span>
                  <span style={{ fontFamily:"var(--mono)", fontWeight:700 }}>{rAmount} SOL</span>
                </div>
                <div style={{ display:"flex", justifyContent:"space-between", marginBottom:"4px" }}>
                  <span style={{ color:"var(--text3)" }}>You receive (est.)</span>
                  <span style={{ fontFamily:"var(--mono)", fontWeight:700, color:"var(--accent)" }}>
                    {rQuote.outAmount ? Number(rQuote.outAmount / 1e6).toLocaleString() : "—"} ${rModal.project?.symbol}
                  </span>
                </div>
                <div style={{ display:"flex", justifyContent:"space-between" }}>
                  <span style={{ color:"var(--text3)" }}>Price impact</span>
                  <span style={{ fontFamily:"var(--mono)", color:Number(rQuote.priceImpactPct) > 2 ? "var(--danger)" : "var(--green)" }}>
                    {rQuote.priceImpactPct ? Number(rQuote.priceImpactPct).toFixed(2) : "—"}%
                  </span>
                </div>
              </div>
            )}

            {rStep === 1 && (
              <div style={{ fontSize:".73rem", color:"var(--text3)", padding:"8px 12px", background:"rgba(56,189,248,.05)", borderRadius:"6px", marginBottom:"14px" }}>
                Step 1: Withdraw {rAmount} SOL from treasury → your wallet
                <br/>Step 2: Swap SOL → ${rModal.project?.symbol} on Bags Mainnet
                {!IS_MAINNET && <div style={{ marginTop:"4px", color:"var(--warning)", fontWeight:600 }}>
                  ⚠ Reinvestment uses Mainnet Bags pools. DevNet SOL won't transfer.
                </div>}
              </div>
            )}

            <div style={{ display:"flex", gap:"10px" }}>
              <button className="btn btn-outline" style={{ flex:1 }} onClick={() => setRModal({ show:false, project:null })}>Cancel</button>
              {!rQuote ? (
                <button className="btn btn-secondary" style={{ flex:2 }} disabled={rLoading || !rAmount || parseFloat(rAmount)<=0}
                  onClick={async () => {
                    setRLoading(true);
                    try {
                      const lamports = Math.floor(parseFloat(rAmount) * 1e9);
                      const { getReinvestQuote } = await import("../lib/bags.js");
                      const q = await getReinvestQuote(lamports, rModal.project.mint);
                      setRQuote(q);
                    } catch(e) {
                      toast("Quote failed: " + (e.message||"").slice(0,80), "error");
                    } finally { setRLoading(false); }
                  }}>
                  {rLoading ? "Getting quote..." : "Get Quote"}
                </button>
              ) : (
                <button className="btn btn-primary" style={{ flex:2, background:"linear-gradient(90deg, #7c3aed 0%, #38bdf8 100%)", border:"none" }}
                  disabled={rLoading}
                  onClick={async () => {
                    setRLoading(true);
                    try {
                      // Step 1: withdraw from treasury
                      toast("Step 1: Withdrawing from treasury...", "info");
                      const { AnchorProvider } = await import("@coral-xyz/anchor");
                      const provider = new AnchorProvider(connection, wallet, { commitment:"confirmed" });
                      const { withdrawTreasuryOnChain } = await import("../lib/programClient.js");
                      await withdrawTreasuryOnChain(provider, {
                        projectIndex: rModal.project.projectIndex,
                        amountLamports: Math.floor(parseFloat(rAmount) * 1e9),
                      });
                      toast("Step 1 done ✓ — Step 2: Buying token on Bags...", "success");

                      // Step 2: swap on Bags
                      const { executeReinvest } = await import("../lib/bags.js");
                      const { signature } = await executeReinvest(
                        wallet,
                        Math.floor(parseFloat(rAmount) * 1e9),
                        rModal.project.mint
                      );
                      toast(`🔥 Reinvestment complete! ${rAmount} SOL → $${rModal.project.symbol} ↗`, "success");
                      setRModal({ show:false, project:null });
                      setTimeout(() => refresh(), 2000);
                    } catch(e) {
                      toast("Reinvest failed: " + (e.message||"").slice(0,100), "error");
                    } finally { setRLoading(false); }
                  }}>
                  {rLoading ? "Processing..." : `🔥 Confirm — Buy $${rModal.project?.symbol}`}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── WITHDRAW MODAL ── */}
      {wModal.show && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.85)", backdropFilter: "blur(8px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: "20px" }}>
          <div className="card" style={{ maxWidth: "420px", width: "100%", padding: "32px" }}>
            <h2 style={{ marginBottom: "6px", fontWeight: 800 }}>Withdraw Funds</h2>
            <p style={{ color: "var(--text3)", fontSize: ".85rem", marginBottom: "20px" }}>
              Treasury of <strong style={{ color: "var(--accent)" }}>${wModal.project?.symbol}</strong>
              <span style={{ marginLeft: "8px", fontSize: ".7rem", background: "var(--bg2)", padding: "2px 7px", borderRadius: "4px" }}>
                Project #{wModal.project?.projectIndex}
              </span>
            </p>

            <div style={{ background: "var(--bg2)", padding: "14px", borderRadius: "10px", marginBottom: "20px", border: "1px solid var(--border)" }}>
              <div style={{ fontSize: ".68rem", color: "var(--text3)", textTransform: "uppercase", marginBottom: "3px" }}>Available</div>
              <div style={{ fontSize: "1.5rem", fontWeight: 800, color: "var(--accent)" }}>{wModal.project?.treasury.balanceSOL.toFixed(4)} SOL</div>
            </div>

            <label style={{ display: "block", fontSize: ".78rem", color: "var(--text2)", marginBottom: "6px" }}>Amount (SOL)</label>
            <input type="number" value={wAmount} onChange={e => setWAmount(e.target.value)}
              className="input" style={{ marginBottom: "8px", fontSize: "1.1rem", fontWeight: 600 }} />
            <p style={{ fontSize: ".63rem", color: "var(--text3)", marginBottom: "16px" }}>💡 Leave ~0.002 SOL for rent-exemption.</p>

            <div style={{ padding: "8px 12px", background: "rgba(251,191,36,.06)", border: "1px solid rgba(251,191,36,.2)", borderRadius: "7px", marginBottom: "18px", fontSize: ".74rem", color: "#fbbf24" }}>
              ⚠ Withdrawals are permanent on-chain events visible to the community.
            </div>

            <div style={{ display: "flex", gap: "10px" }}>
              <button className="btn btn-outline" style={{ flex: 1 }} onClick={() => setWModal({ show: false, project: null })}>Cancel</button>
              <button className="btn btn-primary" style={{ flex: 2 }} onClick={confirmWithdraw}
                disabled={!wAmount || parseFloat(wAmount) <= 0}>Confirm</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const CampaignSection = ({ title, campaigns, wallet, projects, handleClaim, handleResolve, handleRoute }) => {
  if (campaigns.length === 0) return null;
  
  return (
    <div style={{ marginBottom: '32px' }}>
      <h2 style={{ 
        fontSize: '1.2rem', 
        fontWeight: '700', 
        marginBottom: '16px',
        color: 'var(--text)',
        display: 'flex',
        alignItems: 'center',
        gap: '8px'
      }}>
        {title}
        <span style={{ 
          fontSize: '0.8rem', 
          color: 'var(--text2)',
          fontWeight: '400'
        }}>
          ({campaigns.length})
        </span>
      </h2>
      
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: "24px" }}>
        {campaigns.map(c => {
          const isSettled = c.status === "settled";
          const isWinner  = c.hasWinner && c.winnerWallet === wallet?.publicKey?.toBase58();
          const expired   = isExpired(c);
          const proj      = projects.find(p => p.projectIndex === c.projectIndex);

          return (
            <div key={c.pda} className="card shadow-hover" style={{ padding: "22px", display: "flex", flexDirection: "column", minHeight: "260px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "14px" }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "7px", marginBottom: "4px", flexWrap: "wrap" }}>
                    <span style={{ fontSize: ".6rem", textTransform: "uppercase", fontWeight: 700, color: c.status === "active" ? "var(--green)" : "var(--text3)" }}>● {c.status}</span>
                    {proj && (
                      <span style={{ fontSize: ".62rem", color: "var(--accent)", fontWeight: 700, fontFamily: "var(--mono)", background: "rgba(56,189,248,.08)", padding: "1px 5px", borderRadius: "4px" }}>
                        ${proj.symbol} #{proj.projectIndex}
                      </span>
                    )}
                  </div>
                  <Link to={`/campaign/${c.pda}`} style={{ textDecoration: "none", color: "inherit" }}>
                    <h3 style={{ fontWeight: 800, fontSize: "1rem", margin: 0, lineHeight: 1.3 }}>{c.title}</h3>
                  </Link>
                  <div style={{ fontSize: ".7rem", color: "var(--text3)", marginTop: "3px" }}>
                    {c.status === "active"
                      ? <span style={{ color: expired ? "var(--danger)" : "var(--text2)", fontWeight: 600 }}>{timeLeft(c.deadline)}</span>
                      : <span>{c.status === "settled" ? "Finished" : "Awaiting deposit"}</span>
                    }
                  </div>
                </div>
                <span style={{ fontSize: ".7rem", fontWeight: 600, background: "var(--bg2)", padding: "3px 9px", borderRadius: "6px", border: "1px solid var(--border)", whiteSpace: "nowrap" }}>
                  🎯 {posStatus(c).toString().padStart(2, "0")}/100
                </span>
              </div>

              {isSettled && (
                <div style={{ padding: "8px 12px", borderRadius: "8px", marginBottom: "12px", background: c.hasWinner ? "rgba(56,189,248,.06)" : "rgba(52,211,153,.06)", border: "1px solid " + (c.hasWinner ? "rgba(56,189,248,.15)" : "rgba(52,211,153,.15)"), display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: ".72rem", fontWeight: 700, color: c.hasWinner ? "var(--accent)" : "var(--green)" }}>
                    {c.hasWinner ? "🏆 WINNER" : "🏦 NO WINNER"}
                  </span>
                  <span style={{ fontSize: ".68rem", color: "var(--text3)", fontFamily: "var(--mono)" }}>#{fmtPos(c.winningPosition)}</span>
                </div>
              )}

              <div style={{ display: "flex", gap: "8px", marginBottom: "16px" }}>
                {[["Collected", `${c.totalCollectedSOL.toFixed(3)} SOL`, "var(--accent)"], ["Prize", `${c.prizeSOL} SOL`, "var(--text)"]].map(([l, v, col]) => (
                  <div key={l} style={{ flex: 1, padding: "8px 10px", background: "var(--bg2)", borderRadius: "7px", border: "1px solid var(--border)" }}>
                    <div style={{ fontSize: ".58rem", color: "var(--text3)", textTransform: "uppercase", marginBottom: "1px" }}>{l}</div>
                    <div style={{ fontWeight: 800, fontSize: ".9rem", color: col }}>{v}</div>
                  </div>
                ))}
              </div>

              <div style={{ marginTop: "auto", display: "flex", gap: "8px" }}>
                <Link to={`/campaign/${c.pda}`} className="btn btn-sm btn-secondary"
                  style={{ flex: 1, textAlign: "center", fontSize: ".72rem", display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(255,255,255,.03)", border: "1px solid var(--border)" }}>
                  📋 Details
                </Link>

                {isWinner && !c.claimed && (
                  <button onClick={() => handleClaim(c)} className="btn btn-sm btn-primary" style={{ flex: 1, fontSize: ".72rem" }}>
                    ⚡ Claim
                  </button>
                )}

                {isWinner && c.claimed && (
                  <button disabled className="btn btn-sm btn-outline" style={{ flex: 1, fontSize: ".72rem", opacity: 0.7 }}>
                    ✅ Claimed
                  </button>
                )}

                {c.status === "active" && expired && (
                  <button onClick={() => handleResolve(c)} className="btn btn-sm btn-primary" style={{ flex: 1.5, fontSize: ".72rem", background: "var(--accent)" }}>
                    🎲 Resolve
                  </button>
                )}

                {isSettled && !c.hasWinner && (
                  <button onClick={() => handleRoute(c)} className="btn btn-sm btn-secondary"
                    disabled={c.prizeSOL <= 0}
                    style={{ flex: 1.5, fontSize: ".72rem", opacity: c.prizeSOL <= 0 ? 0.5 : 1 }}>
                    {c.prizeSOL <= 0 ? "✅ In Treasury" : "🏦 → Treasury"}
                  </button>
                )}

                {isSettled && c.hasWinner && (
                  <button disabled className="btn btn-sm btn-outline" style={{ flex: 1.5, fontSize: ".72rem", opacity: 0.7 }}>
                    🏆 #{fmtPos(c.winningPosition)}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
