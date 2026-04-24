import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { useWallet, useConnection, useAnchorWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import {
  fetchProject, fetchCreatorCampaigns, withdrawTreasuryOnChain,
  campaignAccountToDisplay, posStatus, totalPot, fmtPos, timeLeft,
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

  async function refresh() {
    if (!wallet) {
      setLoading(false);
      return;
    }
    
    setLoading(true);
    const w = wallet.publicKey.toBase58();
    
    try {
      const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
      
      // 1. Fetch Project - Deep resolution from Mint
      const project = await fetchProject(provider, w);
      if (project) {
        setTokens([{
          mint: project.tokenMint?.toBase58() || "???",
          symbol: project.resolvedSymbol || "BCF",
          name: project.resolvedName || "Bags Token",
          logo: project.resolvedLogo,
          description: project.resolvedDesc || "Project token created via BCF",
          feeModeName: project.feeModeName,
          treasury: {
            balanceSOL: (project.treasuryLamports?.toNumber() || 0) / LAMPORTS_PER_SOL,
          }
        }]);
      } else {
        setTokens([]);
      }

      // 2. Fetch Campaigns
      const c = await fetchCreatorCampaigns(provider, w);
      setCampaigns(c.map(camp => campaignAccountToDisplay(camp.pda, camp)));

      // 3. Balance
      const b = await getSOLBalance(w);
      setBalance(b || 0);

    } catch (e) {
      console.error("[BCF] Dashboard refresh error:", e.message || e);
      toast("Error al cargar datos del Dashboard", "error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { 
    if (wallet) refresh(); 
    else setLoading(false);
  }, [wallet]);

  async function handleAirdrop() {
    if (!wallet) return;
    setForwarding(true);
    try {
      toast("Solicitando airdrop de 2 SOL...", "info");
      await requestAirdrop(wallet.publicKey.toBase58(), 2);
      await refresh();
      toast("✓ +2 SOL recibidos!", "success");
    } catch(e) { 
      toast("Fallo el airdrop. Intenta en 30s", "error"); 
    } finally { 
      setDropping(false); 
    }
  }

  if (!wallet) {
    return (
      <div style={{ padding: "100px 24px", textAlign: "center" }}>
        <div style={{ fontSize: "3.5rem", marginBottom: "20px" }}>🔌</div>
        <h2 style={{ marginBottom: "12px", fontWeight: 700 }}>Dashboard de Creador</h2>
        <p style={{ color: "var(--text2)", marginBottom: "28px", maxWidth: "400px", margin: "0 auto 28px" }}>
          Conecta tu wallet para gestionar tus tokens, campañas y retirar fondos de la tesorería.
        </p>
        <button className="btn btn-primary btn-lg" onClick={() => setVisible(true)}>
          Conectar Wallet
        </button>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ padding: "100px 24px", textAlign: "center" }}>
        <div className="spinner" style={{ margin: "0 auto 20px" }}></div>
        <p style={{ color: "var(--text3)" }}>Cargando datos de DevNet...</p>
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
                toast("¡Dirección copiada!", "success");
              }}
              style={{ background: "none", border: "none", color: "var(--accent)", cursor: "pointer", fontSize: "1rem" }}
              title="Copiar dirección"
            >
              📋
            </button>
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: ".75rem", color: "var(--text3)", textTransform: "uppercase", letterSpacing: ".05em", marginBottom: "4px" }}>Tu Balance</div>
          <div style={{ fontSize: "1.4rem", fontWeight: 700, fontFamily: "var(--mono)" }}>
            {balance.toFixed(4)} <span style={{ color: "var(--accent)", fontSize: "1rem" }}>SOL</span>
          </div>
          <button 
            onClick={handleAirdrop} 
            disabled={dropping}
            style={{ background: "none", border: "none", color: "var(--accent)", fontSize: ".8rem", cursor: "pointer", padding: "4px 0", textDecoration: "underline" }}
          >
            {dropping ? "Procesando..." : "Solicitar +2 SOL (Airdrop)"}
          </button>
        </div>
      </header>

      {/* Tokens Section */}
      <section style={{ marginBottom: "48px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
          <h2 style={{ fontSize: "1.2rem", fontWeight: 700 }}>Mis Tokens (Proyectos)</h2>
          {tokens.length === 0 && (
            <Link to="/create-token" className="btn btn-sm btn-outline">Crear Nuevo Token</Link>
          )}
        </div>

        {tokens.length === 0 ? (
          <div style={{ padding: "40px", textAlign: "center", background: "var(--card-bg)", borderRadius: "var(--r)", border: "1px dashed var(--border)" }}>
            <p style={{ color: "var(--text3)", marginBottom: "16px" }}>No has creado ningún token todavía.</p>
            <Link to="/create-token" className="btn btn-primary">Empezar Ahora</Link>
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
                    <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "4px" }}>
                      <code style={{ fontSize: ".65rem", color: "var(--text3)" }}>
                        {t.mint.slice(0,6)}...{t.mint.slice(-6)}
                      </code>
                      <button 
                        onClick={() => {
                          navigator.clipboard.writeText(t.mint);
                          toast("Mint copiado!", "success");
                        }}
                        style={{ background: "none", border: "none", color: "var(--accent)", cursor: "pointer", fontSize: ".8rem", padding: 0 }}
                        title="Copiar Mint"
                      >
                        📋
                      </button>
                    </div>
                  </div>
                </div>

                <p style={{ fontSize: ".82rem", color: "var(--text2)", marginBottom: "20px", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", lineHeight: 1.5 }}>
                  {t.description}
                </p>
                
                <div style={{ background: "rgba(56,189,248,.04)", padding: "16px", borderRadius: "12px", marginBottom: "20px", border: "1px solid rgba(56,189,248,.1)" }}>
                  <div style={{ fontSize: ".72rem", color: "var(--text3)", textTransform: "uppercase", letterSpacing: ".05em", marginBottom: "4px" }}>Tesorería del Proyecto</div>
                  <div style={{ fontSize: "1.3rem", fontWeight: 800, color: "var(--green)" }}>{t.treasury.balanceSOL.toFixed(4)} SOL</div>
                </div>

                <div style={{ display: "flex", gap: "10px" }}>
                  <Link to="/create-campaign" className="btn btn-primary" style={{ flex: 1, padding: "10px" }}>Nueva Campaña</Link>
                  <a href={`https://bags.fm/token/${t.mint}`} target="_blank" rel="noreferrer" className="btn btn-ghost" style={{ padding: "10px", fontSize: ".8rem" }}>Ver en Bags ↗</a>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Campaigns Section */}
      <section>
        <h2 style={{ fontSize: "1.2rem", fontWeight: 700, marginBottom: "20px" }}>Mis Campañas</h2>
        {campaigns.length === 0 ? (
          <div style={{ padding: "40px", textAlign: "center", background: "var(--card-bg)", borderRadius: "var(--r)", border: "1px dashed var(--border)" }}>
            <p style={{ color: "var(--text3)" }}>No tienes campañas activas o finalizadas.</p>
          </div>
        ) : (
          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: "20px" }}>
            {campaigns.map(c => (
              <Link key={c.pda} to={`/campaign/${c.pda}`} className="card shadow-hover" style={{ padding: "20px", textDecoration: "none", color: "inherit" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "12px" }}>
                  <span style={{ fontSize: ".7rem", textTransform: "uppercase", fontWeight: 700, color: c.status === "active" ? "var(--green)" : "var(--text3)" }}>
                    ● {c.status}
                  </span>
                  <span style={{ fontSize: ".75rem", color: "var(--text3)" }}>{fmtPos(c)} posiciones</span>
                </div>
                <h3 style={{ fontWeight: 700, marginBottom: "12px" }}>{c.title}</h3>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ fontSize: ".7rem", color: "var(--text3)" }}>Recaudado</div>
                    <div style={{ fontWeight: 700, color: "var(--accent)" }}>{c.totalCollectedSOL.toFixed(2)} SOL</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: ".7rem", color: "var(--text3)" }}>Premio</div>
                    <div style={{ fontWeight: 700 }}>{c.prizeSOL} SOL</div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
