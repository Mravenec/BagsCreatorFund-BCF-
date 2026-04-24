import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { useWallet, useConnection, useAnchorWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import {
  fetchProject, fetchCreatorCampaigns, withdrawTreasuryOnChain,
  routeToTreasuryOnChain, claimPrizeOnChain, fetchCampaign,
  campaignAccountToDisplay, posStatus, totalPot, fmtPos, timeLeft, isExpired,
  resolveCampaignOnChain,
} from "../lib/programClient.js";
import { AnchorProvider, BN } from "@coral-xyz/anchor";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { requestAirdrop, getSOLBalance } from "../lib/solana.js";
import { useToast } from "../components/Toast.jsx";

export default function DashboardPage() {
  const { connection } = useConnection();
  const wallet = useAnchorWallet();
  const { setVisible } = useWalletModal();
  const { toast } = useToast();

  const [tokens,    setTokens]    = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [balance,   setBalance]   = useState(0);
  const [loading,   setLoading]   = useState(true);
  const [dropping,  setDropping]  = useState(false);

  // Modal State
  const [withdrawModal, setWithdrawModal] = useState({ show: false, project: null });
  const [withdrawAmount, setWithdrawAmount] = useState("");

  // Live countdown tick
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick(n => n + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  async function refresh() {
    const pubkeyStr = wallet?.publicKey?.toBase58();
    if (!pubkeyStr) {
      console.log("[DASHBOARD DEBUG] No wallet pubkey, clearing loading");
      setLoading(false);
      return;
    }
    
    console.log("[DASHBOARD DEBUG] Refresh started for:", pubkeyStr);
    setLoading(true);
    
    // Safety Timeout: Force unlock after 12 seconds
    const timeoutId = setTimeout(() => {
      setLoading(loadingState => {
        if (loadingState) {
          console.warn("[DASHBOARD DEBUG] Refresh Timeout reached");
          toast("Network is slow. Try manual refresh.", "info");
          return false;
        }
        return loadingState;
      });
    }, 12000);

    try {
      const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
      
      // 1. Fetch Project
      console.log("[DASHBOARD DEBUG] Fetching project...");
      const project = await fetchProject(provider, pubkeyStr);
      if (project) {
        let balance = 0;
        try {
          balance = (project.treasuryLamports ? project.treasuryLamports.toNumber() : 0) / LAMPORTS_PER_SOL;
        } catch (e) { console.warn("[BCF] Treasury balance parse error:", e); }

        setTokens([{
          pda: project.pda,
          mint: project.tokenMint?.toBase58() || "???",
          symbol: project.resolvedSymbol || "BCF",
          name: project.resolvedName || "Bags Token",
          logo: project.resolvedLogo,
          description: project.resolvedDesc || "Project token created via BCF",
          feeModeName: project.feeModeName,
          treasury: { balanceSOL: balance }
        }]);
      } else {
        setTokens([]);
      }

      // 2. Fetch Campaigns
      console.log("[DASHBOARD DEBUG] Fetching campaigns...");
      const c = await fetchCreatorCampaigns(provider, pubkeyStr);
      console.log("[DASHBOARD DEBUG] Campaigns fetched:", c?.length || 0);
      
      const displayCampaigns = (c || []).map(camp => {
        try {
          const { pda, ...accountData } = camp;
          return campaignAccountToDisplay(pda, accountData);
        } catch (e) {
          console.error("[BCF] Campaign mapping error:", camp.pda, e);
          return null;
        }
      }).filter(Boolean);

      setCampaigns(displayCampaigns);

      // 3. User Balance
      const b = await getSOLBalance(pubkeyStr);
      setBalance(b || 0);

    } catch (e) {
      console.error("[DASHBOARD DEBUG] CRITICAL ERROR during refresh:");
      console.error("- Name:", e.name);
      console.error("- Message:", e.message);
      if (e.stack) console.error("- Stack:", e.stack);
      if (e.logs) console.error("- Program Logs:", e.logs);
      
      if (typeof toast === 'function') toast("Error loading data", "error");
    } finally {
      console.log("[DASHBOARD DEBUG] Refresh finally reached");
      clearTimeout(timeoutId);
      setLoading(false);
    }
  }

  useEffect(() => { 
    const pubkeyStr = wallet?.publicKey?.toBase58();
    console.log("[DASHBOARD DEBUG] useEffect trigger, pubkey:", pubkeyStr);
    
    if (pubkeyStr) {
      refresh(); 
    } else {
      setLoading(false);
    }
  }, [wallet?.publicKey?.toBase58()]);

  async function handleAirdrop() {
    if (!wallet) return;
    setDropping(true);
    try {
      toast("Requesting 2 SOL airdrop...", "info");
      await requestAirdrop(wallet.publicKey.toBase58(), 2);
      await refresh();
      toast("✓ +2 SOL received!", "success");
    } catch(e) { 
      toast("Airdrop failed. Try again in 30s", "error"); 
    } finally { 
      setDropping(false); 
    }
  }

  const handleWithdraw = (token) => {
    setWithdrawModal({ show: true, project: token });
    setWithdrawAmount(token.treasury.balanceSOL.toString());
  };

  const confirmWithdraw = async () => {
    const token = withdrawModal.project;
    const amountSOL = parseFloat(withdrawAmount);
    
    if (isNaN(amountSOL) || amountSOL <= 0 || amountSOL > token.treasury.balanceSOL) {
      if (typeof toast === 'function') toast("Invalid amount or insufficient balance", "error");
      return;
    }

    setWithdrawModal({ show: false, project: null });
    setLoading(true);
    if (typeof toast === 'function') toast(`Withdrawing ${amountSOL} SOL...`, "info");
    
    try {
      const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
      const lamports = Math.floor(amountSOL * LAMPORTS_PER_SOL);
      
      const { tx } = await withdrawTreasuryOnChain(provider, { amountLamports: lamports });
      
      console.log("[BCF] Withdraw SUCCESS:", tx);
      if (typeof toast === 'function') toast(`✓ ${amountSOL} SOL withdrawn successfully!`, "success");
      
      // Delay refresh to allow RPC to sync
      setTimeout(() => refresh(), 1200);
    } catch (e) {
      console.error("[BCF] Withdraw error:", e);
      if (typeof toast === 'function') toast("Withdrawal failed: " + (e.message || "Error"), "error");
      setLoading(false); 
    }
  }

  async function handleClaim(campaign) {
    if (!wallet) return;
    setLoading(true);
    if (typeof toast === 'function') toast("Claiming prize...", "info");
    try {
      const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
      await claimPrizeOnChain(provider, { campaignPDA: campaign.pda });
      if (typeof toast === 'function') toast("Prize claimed successfully! 🥳", "success");
      setTimeout(() => refresh(), 1200);
    } catch (e) {
      console.error("[BCF] Claim error:", e);
      if (typeof toast === 'function') toast("Claim error: " + (e.message || "Error"), "error");
      setLoading(false);
    }
  }

  async function handleRoute(campaign) {
    if (!wallet) return;
    setLoading(true);
    if (typeof toast === 'function') toast("Moving funds to treasury...", "info");
    try {
      const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
      
      // Auto-validation: Check if there are funds to move
      if (campaign.prizeSOL <= 0) {
        if (typeof toast === 'function') toast("No funds left to move", "info");
        return;
      }

      await routeToTreasuryOnChain(provider, { campaignPDA: campaign.pda });
      if (typeof toast === 'function') toast("Funds moved to treasury ✅", "success");
      
      // Update local state immediately for instant feedback
      setCampaigns(prev => prev.map(c => 
        c.pda === campaign.pda ? { ...c, prizeSOL: 0 } : c
      ));

      // Auto-refresh after a small delay to sync everything
      setTimeout(() => refresh(), 2000);
    } catch (e) {
      console.error("[BCF] Transfer error:", e);
      
      // Handle "InsufficientFunds" (6009) as a sign that it was already moved
      if (e.message?.includes("6009") || e.message?.includes("InsufficientFunds")) {
        console.log("[BCF] Funds were already in treasury, updating UI");
        setCampaigns(prev => prev.map(c => 
          c.pda === campaign.pda ? { ...c, prizeSOL: 0 } : c
        ));
        if (typeof toast === 'function') toast("Funds already in treasury", "info");
      } else {
        if (typeof toast === 'function') toast("Transfer failed: " + (e.message || "Error"), "error");
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleResolve(campaign) {
    if (!wallet) return;
    const targetPDA = campaign?.pda || campaign?.id;
    console.log("[DASHBOARD DEBUG] Resolve triggered for:", targetPDA);

    if (!targetPDA) {
      if (typeof toast === 'function') toast("Error: Campaign address missing", "error");
      return;
    }

    setLoading(true);
    if (typeof toast === 'function') toast("Resolving round on-chain...", "info");
    
    try {
      const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
      const pdaStr = typeof targetPDA === 'string' ? targetPDA : targetPDA.toString();
      
      const result = await resolveCampaignOnChain(provider, { campaignPDA: pdaStr });
      
      console.log("[DASHBOARD DEBUG] Resolve successful:", result.tx);
      if (typeof toast === 'function') toast("Round resolved! 🎲", "success");
      
      setTimeout(() => {
        console.log("[DASHBOARD DEBUG] Triggering post-resolve refresh");
        refresh();
      }, 1500);
    } catch (e) {
      console.error("[DASHBOARD DEBUG] handleResolve CRITICAL ERROR:");
      console.error("- Name:", e.name);
      console.error("- Message:", e.message);
      if (e.stack) console.error("- Stack:", e.stack);
      if (e.logs) console.error("- Program Logs:", e.logs);
      
      if (typeof toast === 'function') {
        toast("Resolution failed: " + (e.message || "Unknown error"), "error");
      }
      setLoading(false); 
    } finally {
      console.log("[DASHBOARD DEBUG] handleResolve flow finished");
    }
  }

  if (!wallet) {
    return (
      <div style={{ padding: "100px 24px", textAlign: "center" }}>
        <div style={{ fontSize: "3.5rem", marginBottom: "20px" }}>🔌</div>
        <h2 style={{ marginBottom: "12px", fontWeight: 700 }}>Creator Dashboard</h2>
        <p style={{ color: "var(--text2)", marginBottom: "28px", maxWidth: "400px", margin: "0 auto 28px" }}>
          Connect your wallet to manage your tokens, campaigns, and withdraw funds from the treasury.
        </p>
        <button className="btn btn-primary btn-lg" onClick={() => setVisible(true)}>
          Connect Wallet
        </button>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ padding: "100px 24px", textAlign: "center" }}>
        <div className="spinner" style={{ margin: "0 auto 20px" }}></div>
        <p style={{ color: "var(--text3)" }}>Loading DevNet data...</p>
      </div>
    );
  }

  return (
    <div style={{ padding: "40px 24px", maxWidth: "1100px", margin: "0 auto" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: "40px" }}>
        <div>
          <h1 style={{ fontSize: "2rem", fontWeight: 800, marginBottom: "8px" }}>Dashboard</h1>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", color: "var(--text3)", fontSize: ".85rem" }}>
            <code style={{ background: "rgba(255,255,255,0.05)", padding: "4px 8px", borderRadius: "4px" }}>
              {wallet.publicKey.toBase58()}
            </code>
            <button 
              onClick={() => {
                navigator.clipboard.writeText(wallet.publicKey.toBase58());
                toast("Address copied!", "success");
              }}
              style={{ background: "none", border: "none", color: "var(--accent)", cursor: "pointer", fontSize: "1rem" }}
              title="Copy address"
            >
              📋
            </button>
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: ".75rem", color: "var(--text3)", textTransform: "uppercase", letterSpacing: ".05em", marginBottom: "4px" }}>Your Balance</div>
          <div style={{ fontSize: "1.4rem", fontWeight: 700, fontFamily: "var(--mono)" }}>
            {balance.toFixed(4)} <span style={{ color: "var(--accent)", fontSize: "1rem" }}>SOL</span>
          </div>
          <button 
            onClick={handleAirdrop} 
            disabled={dropping}
            style={{ background: "none", border: "none", color: "var(--accent)", fontSize: ".8rem", cursor: "pointer", padding: "4px 0", textDecoration: "underline" }}
          >
            {dropping ? "Processing..." : "Request +2 SOL (Airdrop)"}
          </button>
        </div>
      </header>

      {/* Tokens Section */}
      <section style={{ marginBottom: "48px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
          <h2 style={{ fontSize: "1.2rem", fontWeight: 700 }}>My Tokens (Projects)</h2>
          {tokens.length === 0 && (
            <Link to="/create-token" className="btn btn-sm btn-outline">Create New Token</Link>
          )}
        </div>

        {tokens.length === 0 ? (
          <div style={{ padding: "40px", textAlign: "center", background: "var(--card-bg)", borderRadius: "var(--r)", border: "1px dashed var(--border)" }}>
            <p style={{ color: "var(--text3)", marginBottom: "16px" }}>You haven't created any tokens yet.</p>
            <Link to="/create-token" className="btn btn-primary">Start Now</Link>
          </div>
        ) : (
          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: "24px" }}>
            {tokens.map(t => (
              <div key={t.mint} className="card shadow-sm" style={{ padding: "24px", position: "relative", overflow: "hidden" }}>
                <div style={{ display: "flex", gap: "16px", marginBottom: "20px" }}>
                  <div style={{ width: "64px", height: "64px", borderRadius: "12px", background: "var(--bg3)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, overflow: "hidden", border: "1px solid var(--border)" }}>
                    {t.logo ? (
                      <img src={t.logo} alt={t.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    ) : (
                      <span style={{ fontSize: "1.5rem" }}>🪙</span>
                    )}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                      <h3 style={{ fontWeight: 800, fontSize: "1.2rem", margin: 0 }}>{t.name}</h3>
                      <div className="badge badge-accent" style={{ fontSize: ".7rem", padding: "3px 8px" }}>
                        {t.symbol !== "???" ? `$${t.symbol}` : t.feeModeName}
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "4px", flexWrap: "wrap" }}>
                      <code style={{ fontSize: ".65rem", color: "var(--text3)", fontFamily: "var(--mono)" }}>
                        {t.mint.slice(0,6)}...{t.mint.slice(-6)}
                      </code>
                      <button 
                        onClick={() => {
                          navigator.clipboard.writeText(t.mint);
                          if (typeof toast === 'function') toast("Mint copied!", "success");
                        }}
                        style={{ background: "none", border: "none", color: "var(--accent)", cursor: "pointer", fontSize: ".8rem", padding: 0 }}
                        title="Copy Mint"
                      >
                        📋
                      </button>
                      <span style={{ color: "var(--text3)", fontSize: "0.5rem", opacity: 0.5 }}>•</span>
                      <a 
                        href={`https://bags.fm/token/${t.mint}`} 
                        target="_blank" 
                        rel="noreferrer" 
                        className="btn btn-ghost" 
                        style={{ padding: "2px 6px", fontSize: "0.65rem", height: "auto", minHeight: "unset", color: "var(--text3)" }}
                      >
                        View on Bags ↗
                      </a>
                    </div>
                  </div>
                </div>

                <p style={{ fontSize: ".82rem", color: "var(--text2)", marginBottom: "20px", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", lineHeight: 1.5 }}>
                  {t.description}
                </p>
                
                <div style={{ background: "rgba(56,189,248,.04)", padding: "16px", borderRadius: "12px", marginBottom: "20px", border: "1px solid rgba(56,189,248,.1)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ fontSize: ".72rem", color: "var(--text3)", textTransform: "uppercase", letterSpacing: ".05em", marginBottom: "4px" }}>Project Treasury</div>
                    <div style={{ fontSize: "1.3rem", fontWeight: 800, color: "var(--green)" }}>{t.treasury?.balanceSOL?.toFixed(4) || "0.0000"} SOL</div>
                  </div>
                  {t.treasury?.balanceSOL > 0 && (
                    <button 
                      onClick={() => handleWithdraw(t)}
                      className="btn btn-sm btn-primary"
                      style={{ fontSize: ".75rem", padding: "8px 16px" }}
                    >
                      💰 Withdraw
                    </button>
                  )}
                </div>

                <div style={{ display: "flex", gap: "10px" }}>
                  <Link to="/create-campaign" className="btn btn-primary" style={{ flex: 1, padding: "10px" }}>New Campaign</Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Campaigns Section */}
      <section>
        <h2 style={{ fontSize: "1.2rem", fontWeight: 700, marginBottom: "20px" }}>My Campaigns</h2>
        {campaigns.length === 0 ? (
          <div style={{ padding: "40px", textAlign: "center", background: "var(--card-bg)", borderRadius: "var(--r)", border: "1px dashed var(--border)" }}>
            <p style={{ color: "var(--text3)" }}>You have no active or finished campaigns.</p>
          </div>
        ) : (
          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(350px, 1fr))", gap: "28px" }}>
            {campaigns.map(c => {
              const isSettled = c.status === "settled";
              const isWinner = c.hasWinner && c.winnerWallet === wallet.publicKey.toBase58();
              const canRoute = isSettled && !c.hasWinner;

              return (
                <div 
                  key={c.pda} 
                  className="card shadow-hover" 
                  style={{ 
                    padding: "24px", 
                    display: "flex", 
                    flexDirection: "column",
                    minHeight: "280px",
                    height: "100%",
                    position: "relative"
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "16px" }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                        <span style={{ fontSize: ".65rem", textTransform: "uppercase", fontWeight: 700, color: c.status === "active" ? "var(--green)" : "var(--text3)", opacity: 0.8 }}>
                          ● {c.status}
                        </span>
                        {tokens[0]?.symbol && (
                          <span style={{ fontSize: ".65rem", color: "var(--accent)", fontWeight: 700, fontFamily: "var(--mono)", background: "rgba(56,189,248,0.08)", padding: "2px 6px", borderRadius: "4px" }}>
                            ${tokens[0].symbol}
                          </span>
                        )}
                      </div>
                      <Link to={`/campaign/${c.pda}`} style={{ textDecoration: "none", color: "inherit" }}>
                        <h3 style={{ fontWeight: 800, fontSize: "1.2rem", margin: 0, lineHeight: 1.3 }}>{c.title}</h3>
                      </Link>
                      <div style={{ fontSize: ".72rem", color: "var(--text3)", marginTop: "4px", display: "flex", alignItems: "center", gap: "4px" }}>
                        <span>⏳</span>
                         {c.status === "active" ? (
                          <span style={{ fontWeight: 600, color: isExpired(c) ? "var(--danger)" : "var(--text2)" }}>
                            {timeLeft(c.deadline)}
                          </span>
                        ) : (
                          <span>{c.status === "settled" ? "Finished" : "Awaiting activation"}</span>
                        )}
                      </div>
                    </div>
                    <span style={{ fontSize: ".72rem", fontWeight: 600, color: "var(--text2)", background: "var(--bg2)", padding: "4px 10px", borderRadius: "6px", border: "1px solid var(--border)", whiteSpace: "nowrap" }}>
                      🎯 {posStatus(c).toString().padStart(2, '0')}/100
                    </span>
                  </div>

                  {isSettled && (
                    <div style={{ 
                      background: c.hasWinner ? "rgba(56,189,248,0.06)" : "rgba(52,211,153,0.06)", 
                      padding: "10px 14px", 
                      borderRadius: "10px", 
                      marginBottom: "16px", 
                      border: "1px solid " + (c.hasWinner ? "rgba(56,189,248,0.15)" : "rgba(52,211,153,0.15)"),
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center"
                    }}>
                      <span style={{ fontSize: ".75rem", fontWeight: 700, color: c.hasWinner ? "var(--accent)" : "var(--green)" }}>
                        {c.hasWinner ? "🏆 WINNER FOUND" : "🏦 NO WINNER"}
                      </span>
                      <span style={{ fontSize: ".7rem", color: "var(--text3)", fontFamily: "var(--mono)" }}>
                        Pos: #{fmtPos(c.winningPosition)}
                      </span>
                    </div>
                  )}

                  <div style={{ display: "flex", gap: "10px", marginBottom: "20px" }}>
                    <div style={{ flex: 1, padding: "10px", background: "rgba(56,189,248,0.03)", borderRadius: "8px", border: "1px solid rgba(56,189,248,0.06)" }}>
                      <div style={{ fontSize: ".6rem", color: "var(--text3)", textTransform: "uppercase", marginBottom: "2px" }}>Collected</div>
                      <div style={{ fontWeight: 800, color: "var(--accent)", fontSize: "1rem" }}>{c.totalCollectedSOL.toFixed(2)} SOL</div>
                    </div>
                    <div style={{ flex: 1, padding: "10px", background: "var(--bg2)", borderRadius: "8px", border: "1px solid var(--border)" }}>
                      <div style={{ fontSize: ".6rem", color: "var(--text3)", textTransform: "uppercase", marginBottom: "2px" }}>Prize</div>
                      <div style={{ fontWeight: 800, fontSize: "1rem" }}>{c.prizeSOL} SOL</div>
                    </div>
                  </div>

                  <div style={{ marginTop: "auto", display: "flex", gap: "10px", alignItems: "center" }}>
                    <Link 
                      to={`/campaign/${c.pda}`} 
                      className="btn btn-sm btn-secondary" 
                      style={{ 
                        flex: 1, 
                        textAlign: "center", 
                        fontSize: ".75rem",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: "4px",
                        background: "rgba(255,255,255,0.03)",
                        border: "1px solid var(--border)"
                      }}
                    >
                      📋 Details
                    </Link>
                    
                    {isWinner && (
                      <button onClick={() => handleClaim(c)} className="btn btn-sm btn-primary" style={{ flex: 1, fontSize: ".75rem" }}>
                        ⚡ Claim
                      </button>
                    )}

                    {/* New: Resolve Round button directly from Dashboard */}
                    {c.status === "active" && isExpired(c) && (
                      <button onClick={() => handleResolve(c)} className="btn btn-sm btn-primary" style={{ flex: 1.5, fontSize: ".75rem", background: "var(--accent)" }}>
                        🎲 Resolve Round
                      </button>
                    )}
                    
                    {/* Always show the action area if settled, but control button state */}
                    {isSettled && !c.hasWinner && (
                      <button 
                        onClick={() => handleRoute(c)} 
                        className="btn btn-sm btn-secondary" 
                        disabled={c.prizeSOL <= 0}
                        style={{ 
                          flex: 1.5, 
                          fontSize: ".75rem", 
                          background: c.prizeSOL <= 0 ? "rgba(255,255,255,0.05)" : "",
                          color: c.prizeSOL <= 0 ? "var(--text3)" : "",
                          border: c.prizeSOL <= 0 ? "1px solid var(--border)" : "",
                          opacity: c.prizeSOL <= 0 ? 0.6 : 1,
                          cursor: c.prizeSOL <= 0 ? "default" : "pointer"
                        }}
                      >
                        {c.prizeSOL <= 0 ? "✅ In Treasury" : "🏦 To Treasury"}
                      </button>
                    )}
                    
                    {isSettled && c.hasWinner && (
                      <button 
                        disabled
                        className="btn btn-sm btn-outline"
                        style={{ flex: 1.5, fontSize: ".75rem", opacity: 0.8 }}
                      >
                        🏆 Winner: #{fmtPos(c.winning)}
                      </button>
                    )}
                  </div>

                  {isSettled && c.winningBlockHash && (
                    <div style={{ marginTop: "12px", textAlign: "center", fontSize: ".6rem", color: "var(--text3)", fontFamily: "var(--mono)", opacity: 0.6 }}>
                      Block: {c.winningBlockHash.slice(0, 16)}...
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Withdraw Modal */}
      {withdrawModal.show && (
        <div style={{
          position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
          background: "rgba(0,0,0,0.85)", backdropFilter: "blur(8px)",
          display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
          padding: "20px"
        }}>
          <div className="card" style={{ maxWidth: "400px", width: "100%", padding: "32px", border: "1px solid var(--border)" }}>
            <h2 style={{ marginBottom: "8px", fontWeight: 800 }}>Withdraw Funds</h2>
            <p style={{ color: "var(--text3)", fontSize: ".9rem", marginBottom: "24px" }}>
              Treasury of <strong style={{ color: "var(--text1)" }}>{withdrawModal.project?.name}</strong>
            </p>
            
            <div style={{ background: "var(--bg2)", padding: "16px", borderRadius: "12px", marginBottom: "24px", border: "1px solid var(--border)" }}>
              <div style={{ fontSize: ".7rem", color: "var(--text3)", textTransform: "uppercase", marginBottom: "4px" }}>Available Balance</div>
              <div style={{ fontSize: "1.5rem", fontWeight: 800, color: "var(--accent)" }}>
                {withdrawModal.project?.treasury.balanceSOL.toFixed(4)} <span style={{ fontSize: ".9rem" }}>SOL</span>
              </div>
            </div>

            <div style={{ marginBottom: "24px" }}>
              <label style={{ display: "block", fontSize: ".8rem", color: "var(--text2)", marginBottom: "8px" }}>Amount to withdraw (SOL)</label>
              <input 
                type="number"
                value={withdrawAmount}
                onChange={(e) => setWithdrawAmount(e.target.value)}
                className="input"
                placeholder="0.00"
                style={{ fontSize: "1.1rem", fontWeight: 600 }}
              />
              <p style={{ fontSize: ".65rem", color: "var(--text3)", marginTop: "8px", fontStyle: "italic" }}>
                💡 Tip: Leave ~0.002 SOL to cover network fees and rent-exemption.
              </p>
            </div>

            <div style={{ display: "flex", gap: "12px" }}>
              <button 
                className="btn btn-outline" 
                style={{ flex: 1 }} 
                onClick={() => setWithdrawModal({ show: false, project: null })}
              >
                Cancel
              </button>
              <button 
                className="btn btn-primary" 
                style={{ flex: 2 }} 
                onClick={confirmWithdraw}
                disabled={!withdrawAmount || parseFloat(withdrawAmount) <= 0}
              >
                Confirm Withdrawal
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
