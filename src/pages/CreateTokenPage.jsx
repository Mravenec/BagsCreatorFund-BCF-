import { IS_MAINNET, NETWORK, FEE_MODES, CATEGORIES, INITIAL_BUY_PRESETS_SOL } from '../lib/constants.js';
import React, { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useWallet, useConnection, useAnchorWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { initializeProject } from "../lib/programClient.js";
import { AnchorProvider } from "@coral-xyz/anchor";
import { launchBagsToken, markMintAsReal } from "../lib/bags.js";
import { useToast } from "../components/Toast.jsx";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";

const STEPS = ["Project Info", "Launch Type", "Fee Sharing", "Ownership", "Review & Launch"];
const bpToPercent = (bp) => ((bp / 100).toFixed(2)).replace(/\.00$/, '');
const sumBP = (arr) => arr.reduce((s, x) => s + (Number(x) || 0), 0);

export default function CreateTokenPage() {
  const { connection } = useConnection();
  const wallet  = useAnchorWallet();
  const { setVisible } = useWalletModal();
  const toast    = useToast();

  const [step, setStep]           = useState(0);
  const [loading, setLoading]     = useState(false);
  const [errors, setErrors]       = useState({});
  const [statusMsg, setStatusMsg] = useState("");
  const [created, setCreated]     = useState(null);

  const [form, setForm] = useState({
    name: "", symbol: "", description: "",
    imageUrl: "", twitter: "", website: "", category: "tech",
  });
  const [feeModeId, setFeeModeId]     = useState("fa29606e-5e48-4c37-827f-4b03d58ee23d");
  const [claimers, setClaimers]       = useState([{ wallet: "", bp: 10000 }]);
  const [initialBuySOL, setInitialBuySOL] = useState(0);

  const set = (k, v) => { setForm(f => ({ ...f, [k]: v })); setErrors(e => ({ ...e, [k]: "" })); };
  const feeMode = FEE_MODES.find(m => m.id === feeModeId);

  const addClaimer    = () => setClaimers(c => [...c, { wallet: "", bp: 0 }]);
  const removeClaimer = (i) => setClaimers(c => c.filter((_, idx) => idx !== i));
  const setClaimer    = (i, field, val) => setClaimers(c => c.map((x, idx) => idx === i ? { ...x, [field]: val } : x));
  const totalBP       = sumBP(claimers.map(c => c.bp));

  function ensureCreatorInClaimers() {
    if (wallet && claimers[0]?.wallet === "")
      setClaimers(c => c.map((x, i) => i === 0 ? { ...x, wallet: wallet.publicKey.toString() } : x));
  }

  function validate(s) {
    const e = {};
    if (s === 0) {
      if (!form.name.trim())                   e.name        = "Required";
      if (!form.symbol.trim())                 e.symbol      = "Required";
      if (form.symbol.length > 10)             e.symbol      = "Max 10 chars";
      if (form.description.trim().length < 20) e.description = "At least 20 characters";
    }
    if (s === 2) {
      claimers.forEach((c, i) => {
        if (!c.wallet.trim()) e[`claimer_${i}_wallet`] = "Required";
        if (Number(c.bp) < 0 || Number(c.bp) > 10000) e[`claimer_${i}_bp`] = "0–10000";
      });
      if (totalBP !== 10000) e.totalBP = `Total must be 10 000 bp (currently ${totalBP})`;
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function handleNext() {
    if (!validate(step)) return;
    if (step === 1) ensureCreatorInClaimers();
    setStep(s => s + 1);
  }

  async function handleCreate() {
    if (!wallet) { toast("Connect wallet first", "error"); setVisible(true); return; }
    setLoading(true); setStatusMsg("");
    let finalMint = null, isRealToken = false;
    try {
      const provider   = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
      const creatorStr = wallet.publicKey.toString();
      const cleanClaimers    = claimers.map(c => ({ wallet: c.wallet.trim() || creatorStr, bp: Number(c.bp) || 0 }));
      const claimersArray    = cleanClaimers.map(c => c.wallet);
      const basisPointsArray = cleanClaimers.map(c => c.bp);
      const initialBuyLamports = Math.floor(initialBuySOL * LAMPORTS_PER_SOL);

      setStatusMsg("📡 Launching token on Bags — follow wallet prompts…");
      toast("Launching on Bags Mainnet — wallet will ask for approval(s)", "info");
      try {
        const result = await launchBagsToken(wallet, {
          name: form.name, symbol: form.symbol.toUpperCase(),
          description: form.description, imageUrl: form.imageUrl,
          twitter: form.twitter, website: form.website,
          bagsConfigType: feeModeId, initialBuyLamports,
          _claimersArray: claimersArray, _basisPointsArray: basisPointsArray,
        });
        finalMint = result.mint; isRealToken = true;
        markMintAsReal(finalMint);
        toast(`✅ Token live on Bags! tx: ${result.signature?.slice(0,8)}...`, "success");
        setStatusMsg("✅ Token created on Bags Mainnet!");
      } catch (bagsErr) {
        const m = (bagsErr.message || "").toLowerCase();
        if (m.includes("user rejected") || m.includes("cancel")) {
          toast("Token creation cancelled.", "error"); setLoading(false); setStatusMsg(""); return;
        }
        console.warn("[BCF] Bags Mainnet error:", bagsErr.message);
        toast("⚠ Bags Mainnet failed — DevNet simulation mode.", "info");
        setStatusMsg("⚠️ DevNet simulation…");
        finalMint = `sim_${wallet.publicKey.toBase58().slice(0,8)}_${Date.now()}`;
        isRealToken = false;
      }
      setStatusMsg(`🔗 Creating BCF project on ${IS_MAINNET ? "Mainnet" : "DevNet"}…`);
      const { projectIndex } = await initializeProject(provider, {
        tokenMint: finalMint, feeModeName: feeMode?.name || "Founder Mode",
        name: form.name, symbol: form.symbol.toUpperCase(),
      });
      toast(`🎉 Token #${projectIndex} created!`, "success");
      setCreated({ mint: finalMint, projectIndex, isRealToken });
    } catch (e) {
      const errMsg = e?.message || e?.toString?.() || "Unknown error";
      console.error("[BCF] CreateToken error:", e);
      toast("Error: " + errMsg.slice(0, 120), "error");
      setStatusMsg("❌ " + errMsg.slice(0, 120));
    } finally { setLoading(false); }
  }

  function resetForAnother() {
    setForm({ name: "", symbol: "", description: "", imageUrl: "", twitter: "", website: "", category: "tech" });
    setFeeModeId("fa29606e-5e48-4c37-827f-4b03d58ee23d");
    setClaimers([{ wallet: "", bp: 10000 }]);
    setInitialBuySOL(0);
    setStep(0); setErrors({}); setStatusMsg(""); setCreated(null);
  }

  if (created) return (
    <div style={{ padding: "80px 24px", maxWidth: "560px", margin: "0 auto", textAlign: "center" }}>
      <div style={{ fontSize: "3.5rem", marginBottom: "16px" }}>🎉</div>
      <h1 style={{ fontSize: "1.8rem", fontWeight: 800, marginBottom: "8px" }}>Token Created!</h1>
      <p style={{ color: "var(--text2)", marginBottom: "28px", fontSize: ".9rem", lineHeight: 1.65 }}>
        <strong style={{ color: "var(--accent)" }}>${form.symbol.toUpperCase()}</strong> is now <strong>Project #{created.projectIndex}</strong>.<br />
        {created.isRealToken ? "Live on Bags Mainnet — visible at bags.fm/token/…" : "DevNet simulation active — token not yet live on Bags Mainnet."}
      </p>
      <div style={{ padding: "14px 18px", background: "var(--bg2)", borderRadius: "var(--r)", marginBottom: "28px", fontFamily: "var(--mono)", fontSize: ".75rem", color: "var(--text3)", wordBreak: "break-all", textAlign: "left" }}>
        <div style={{ fontSize: ".65rem", textTransform: "uppercase", marginBottom: "4px" }}>Mint Address</div>
        {created.mint}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <Link to={`/create-campaign?project=${created.projectIndex}`} className="btn btn-primary btn-lg">🚀 Create Campaign</Link>
        <Link to="/dashboard" className="btn btn-outline">📊 Go to Dashboard</Link>
        <button className="btn btn-ghost" onClick={resetForAnother}>🪙 Create Another Token</button>
      </div>
    </div>
  );

  const stepContent = [
    /* Step 0 — Project Info */
    <div key={0} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      <div style={{ padding: "13px 16px", background: "rgba(56,189,248,.06)", border: "1px solid rgba(56,189,248,.18)", borderRadius: "var(--r)", fontSize: ".82rem", color: "var(--text2)", lineHeight: 1.65 }}>
        <strong style={{ color: "var(--accent)" }}>Your token is your project identity on Bags.</strong>{" "}
        Minted on Solana Mainnet via the Bags API and linked to all future campaigns.
      </div>
      <div className="grid-2">
        <div className="field">
          <label className="label">Token Name *</label>
          <input className={`input ${errors.name ? "input-err" : ""}`} placeholder="My Creator Project" value={form.name} onChange={e => set("name", e.target.value)} />
          {errors.name && <span className="err">{errors.name}</span>}
        </div>
        <div className="field">
          <label className="label">Symbol * (max 10)</label>
          <input className={`input ${errors.symbol ? "input-err" : ""}`} placeholder="MYPROJ" maxLength={10} value={form.symbol} onChange={e => set("symbol", e.target.value.toUpperCase())} style={{ fontFamily: "var(--mono)", letterSpacing: ".08em" }} />
          {errors.symbol && <span className="err">{errors.symbol}</span>}
        </div>
      </div>
      <div className="field">
        <label className="label">Description * (min 20 chars)</label>
        <textarea className={`input ${errors.description ? "input-err" : ""}`} placeholder="What is this project about? What problem does it solve?" value={form.description} onChange={e => set("description", e.target.value)} style={{ minHeight: "80px" }} />
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          {errors.description ? <span className="err">{errors.description}</span> : <span />}
          <span style={{ fontSize: ".7rem", color: "var(--text3)" }}>{form.description.length} chars</span>
        </div>
      </div>
      <div style={{ fontSize: ".8rem", color: "var(--text3)", fontWeight: 600, marginBottom: "-8px" }}>Social links (optional)</div>
      <div className="grid-2">
        <div className="field">
          <label className="label">Token Image URL</label>
          <input className="input" placeholder="https://…" value={form.imageUrl} onChange={e => set("imageUrl", e.target.value)} />
        </div>
        <div className="field">
          <label className="label">Twitter / X</label>
          <input className="input" placeholder="@handle" value={form.twitter} onChange={e => set("twitter", e.target.value)} />
        </div>
      </div>
      <div className="grid-2">
        <div className="field">
          <label className="label">Website</label>
          <input className="input" placeholder="https://yourproject.com" value={form.website} onChange={e => set("website", e.target.value)} />
        </div>
        <div className="field">
          <label className="label">Category</label>
          <select className="input" value={form.category} onChange={e => set("category", e.target.value)}>
            {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </div>
      </div>
    </div>,

    /* Step 1 — Launch Type */
    <div key={1} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      <div style={{ padding: "13px 16px", background: "var(--bg2)", border: "1px solid var(--border2)", borderRadius: "var(--r)", fontSize: ".82rem", color: "var(--text2)", lineHeight: 1.65 }}>
        Choose your fee structure — <strong>permanent once launched</strong>. This determines how much you earn from every trade.
      </div>
      {FEE_MODES.map(m => (
        <label key={m.id} style={{ display: "flex", alignItems: "flex-start", gap: "13px", padding: "15px 16px", background: feeModeId === m.id ? "rgba(56,189,248,.05)" : "var(--bg2)", border: `1.5px solid ${feeModeId === m.id ? "rgba(56,189,248,.35)" : "var(--border2)"}`, borderRadius: "var(--r)", cursor: "pointer", transition: "var(--ease)" }}>
          <input type="radio" name="fee" value={m.id} checked={feeModeId === m.id} onChange={() => setFeeModeId(m.id)} style={{ marginTop: 4, accentColor: "var(--accent)" }} />
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "3px", flexWrap: "wrap" }}>
              <span style={{ fontWeight: 700, fontSize: ".92rem" }}>{m.name}</span>
              <span style={{ fontFamily: "var(--mono)", fontSize: ".7rem", color: "var(--accent)", background: "rgba(56,189,248,.08)", padding: "2px 7px", borderRadius: "4px" }}>{m.short}</span>
              {m.recommended && <span style={{ fontSize: ".63rem", background: "rgba(52,211,153,.12)", color: "var(--green)", padding: "2px 7px", borderRadius: "4px", fontWeight: 700 }}>Recommended</span>}
            </div>
            <p style={{ fontSize: ".75rem", color: "var(--text3)", margin: 0, lineHeight: 1.55 }}>{m.desc}</p>
            <div style={{ display: "flex", gap: "16px", marginTop: "6px" }}>
              <span style={{ fontSize: ".72rem", color: "var(--accent)", fontWeight: 600 }}>You earn: {m.creatorEarns}</span>
              <span style={{ fontSize: ".72rem", color: "var(--text3)" }}>{m.compounding}</span>
            </div>
          </div>
        </label>
      ))}
      <div style={{ padding: "14px 16px", background: "rgba(251,191,36,.04)", border: "1px solid rgba(251,191,36,.18)", borderRadius: "var(--r)", fontSize: ".8rem", color: "var(--text2)", lineHeight: 1.65 }}>
        <strong style={{ color: "#fbbf24" }}>Company Mode</strong> — Incorporate a company at launch.{" "}
        Available from the Dashboard after token creation (requires legal info from founders).
      </div>
    </div>,

    /* Step 2 — Fee Sharing */
    <div key={2} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      <div style={{ padding: "13px 16px", background: "var(--bg2)", border: "1px solid var(--border2)", borderRadius: "var(--r)", fontSize: ".82rem", color: "var(--text2)", lineHeight: 1.65 }}>
        <strong>FEE SHARING</strong> — Share fees with up to 100 creators, apps, or wallets. Total must equal <strong style={{ color: "var(--accent)" }}>100% (10 000 basis points)</strong>. Editable anytime from the Dashboard.
      </div>
      {claimers.map((c, i) => (
        <div key={i} style={{ display: "flex", gap: "10px", alignItems: "flex-start" }}>
          <div style={{ flex: 3 }} className="field">
            {i === 0 && <label className="label">Wallet / App address</label>}
            <input className={`input ${errors[`claimer_${i}_wallet`] ? "input-err" : ""}`}
              placeholder={i === 0 ? (wallet ? wallet.publicKey.toString().slice(0,20)+"…" : "Your wallet") : "Wallet or app public key"}
              value={c.wallet} onChange={e => setClaimer(i, "wallet", e.target.value)}
              style={{ fontFamily: "var(--mono)", fontSize: ".78rem" }} />
            {i === 0 && !c.wallet && wallet && (
              <button type="button" onClick={() => setClaimer(0, "wallet", wallet.publicKey.toString())}
                style={{ background: "none", border: "none", color: "var(--accent)", fontSize: ".72rem", cursor: "pointer", padding: "2px 0" }}>
                ↗ Use connected wallet
              </button>
            )}
          </div>
          <div style={{ flex: 1 }} className="field">
            {i === 0 && <label className="label">% share</label>}
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <input type="number" min={0} max={10000}
                className={`input ${errors[`claimer_${i}_bp`] ? "input-err" : ""}`}
                placeholder="10000" value={c.bp}
                onChange={e => setClaimer(i, "bp", e.target.value)}
                style={{ fontFamily: "var(--mono)" }} />
              <span style={{ fontSize: ".75rem", color: "var(--text3)", whiteSpace: "nowrap" }}>{bpToPercent(c.bp || 0)}%</span>
            </div>
          </div>
          {claimers.length > 1 && (
            <button type="button" onClick={() => removeClaimer(i)}
              style={{ marginTop: i === 0 ? "26px" : "6px", background: "none", border: "none", color: "var(--text3)", cursor: "pointer", fontSize: "1.1rem", padding: "4px" }}>×</button>
          )}
        </div>
      ))}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", background: totalBP === 10000 ? "rgba(52,211,153,.06)" : "rgba(251,59,59,.06)", border: `1px solid ${totalBP === 10000 ? "rgba(52,211,153,.2)" : "rgba(251,59,59,.25)"}`, borderRadius: "var(--r)", fontSize: ".82rem" }}>
        <span style={{ color: "var(--text3)" }}>Total allocated</span>
        <span style={{ fontFamily: "var(--mono)", fontWeight: 700, color: totalBP === 10000 ? "var(--green)" : "var(--danger)" }}>
          {totalBP} bp ({bpToPercent(totalBP)}%) {totalBP === 10000 ? "✓" : `— need ${10000 - totalBP} more bp`}
        </span>
      </div>
      {errors.totalBP && <span className="err">{errors.totalBP}</span>}
      {claimers.length < 100 && (
        <button type="button" className="btn btn-ghost" onClick={addClaimer} style={{ alignSelf: "flex-start", fontSize: ".78rem" }}>+ Add claimer</button>
      )}
    </div>,

    /* Step 3 — Ownership / Initial Buy */
    <div key={3} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      <div style={{ padding: "13px 16px", background: "var(--bg2)", border: "1px solid var(--border2)", borderRadius: "var(--r)", fontSize: ".82rem", color: "var(--text2)", lineHeight: 1.65 }}>
        <strong>Buy shares before anyone else.</strong> Purchasing at launch gives you tokens at the lowest possible bonding curve price. Optional.
      </div>
      <div className="field">
        <label className="label">Initial buy (SOL)</label>
        <div style={{ display: "flex", gap: "8px", marginBottom: "10px", flexWrap: "wrap" }}>
          {INITIAL_BUY_PRESETS_SOL.map(v => (
            <button key={v} type="button" onClick={() => setInitialBuySOL(v)}
              className={`btn btn-sm ${initialBuySOL === v ? "btn-primary" : "btn-ghost"}`}
              style={{ fontSize: ".75rem", padding: "5px 12px" }}>
              {v === 0 ? "Skip" : `${v} SOL`}
            </button>
          ))}
        </div>
        <input type="number" min={0} step={0.01} className="input" placeholder="0.00"
          value={initialBuySOL} onChange={e => setInitialBuySOL(parseFloat(e.target.value) || 0)}
          style={{ fontFamily: "var(--mono)", fontSize: "1rem" }} />
        <div style={{ fontSize: ".72rem", color: "var(--text3)", marginTop: "4px" }}>
          You need at least 0.2 SOL to cover transaction fees + any initial buy amount.
        </div>
      </div>
      <div style={{ padding: "13px 16px", background: "rgba(56,189,248,.04)", border: "1px solid rgba(56,189,248,.12)", borderRadius: "var(--r)", fontSize: ".8rem", color: "var(--text2)", lineHeight: 1.65 }}>
        <strong style={{ color: "var(--accent)" }}>Admin Settings</strong><br />
        You (<code style={{ fontSize: ".76rem" }}>{wallet ? `$${wallet.publicKey.toBase58().slice(0,8)}…` : "connected wallet"}</code>) will be the admin for this token.
        Admins can manage earnings and update fee sharing from the Dashboard at any time.
      </div>
    </div>,

    /* Step 4 — Review & Launch */
    <div key={4} style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      {[
        ["Token Name",   form.name || "—"],
        ["Symbol",       `$${form.symbol || "—"}`],
        ["Launch Type",  feeMode?.name || "—"],
        ["You Earn",     feeMode?.creatorEarns || "—"],
        ["Initial Buy",  initialBuySOL > 0 ? `${initialBuySOL} SOL` : "None"],
        ["Fee Claimers", `${claimers.length} wallet${claimers.length !== 1 ? "s" : ""}`],
        ["Network",      IS_MAINNET ? "Token → Bags Mainnet" : "Token → Bags Mainnet · Campaigns → DevNet"],
      ].map(([l, v], i, arr) => (
        <div key={l} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "11px 0", borderBottom: i < arr.length - 1 ? "1px solid var(--border)" : "none" }}>
          <span style={{ fontSize: ".78rem", color: "var(--text3)", textTransform: "uppercase" }}>{l}</span>
          <span style={{ fontWeight: 600, fontSize: ".86rem", color: l === "Symbol" ? "var(--accent)" : "var(--text)" }}>{v}</span>
        </div>
      ))}
      {claimers.some(c => c.wallet) && (
        <div style={{ marginTop: "14px", padding: "12px 14px", background: "var(--bg2)", borderRadius: "var(--r)", border: "1px solid var(--border)" }}>
          <div style={{ fontSize: ".68rem", color: "var(--text3)", textTransform: "uppercase", marginBottom: "6px" }}>Fee sharing</div>
          {claimers.map((c, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: ".75rem", marginBottom: "3px" }}>
              <span style={{ fontFamily: "var(--mono)", color: "var(--text2)" }}>{c.wallet ? c.wallet.slice(0,16)+"…" : "(empty)"}</span>
              <span style={{ color: "var(--accent)", fontWeight: 600 }}>{bpToPercent(c.bp)}%</span>
            </div>
          ))}
        </div>
      )}
      <div style={{ marginTop: "18px", padding: "13px 16px", background: "rgba(56,189,248,.04)", border: "1px solid rgba(56,189,248,.14)", borderRadius: "var(--r)", fontSize: ".8rem", color: "var(--text2)", lineHeight: 1.65 }}>
        <strong style={{ color: "var(--accent)" }}>Steps on click:</strong>
        <ol style={{ margin: "6px 0 0 16px", padding: 0, lineHeight: 1.8 }}>
          <li>Metadata uploaded to Bags (FormData)</li>
          <li>Fee-share config signed on Mainnet</li>
          <li>Launch TX signed → token minted on <strong>Mainnet</strong></li>
          {initialBuySOL > 0 && <li>Initial buy executed ({initialBuySOL} SOL)</li>}
          <li>BCF Project created on <strong>{IS_MAINNET ? "Mainnet" : "DevNet"}</strong></li>
        </ol>
        <p style={{ margin: "8px 0 0", color: "var(--text3)", fontSize: ".73rem" }}>
          ⚠ Requires ~{(0.01 + initialBuySOL).toFixed(3)} SOL on Mainnet.
        </p>
      </div>
    </div>,
  ];

  return (
    <div style={{ padding: "56px 24px", maxWidth: "680px", margin: "0 auto" }}>
      <div style={{ marginBottom: "36px" }}>
        <Link to="/dashboard" style={{ fontSize: ".8rem", color: "var(--text3)", display: "inline-flex", alignItems: "center", gap: "5px", marginBottom: "14px" }}>← Dashboard</Link>
        <h1 style={{ fontSize: "1.9rem", letterSpacing: "-.03em" }}>Launch something new</h1>
        <p style={{ color: "var(--text2)", fontSize: ".88rem", marginTop: "6px" }}>List your project. Trade shares. Get funded. — Powered by Bags API</p>
      </div>
      <div className="step-bar" style={{ marginBottom: "30px" }}>
        {STEPS.map((s, i) => (
          <div key={i} className="step-item">
            <div className={`step-track ${i < step ? "done" : i === step ? "active" : "idle"}`} />
            <div className={`step-name ${i < step ? "done" : i === step ? "active" : "idle"}`}>{s}</div>
          </div>
        ))}
      </div>
      <div className="card" style={{ padding: "30px", marginBottom: "18px" }}>
        <h2 style={{ fontWeight: 700, fontSize: "1.05rem", marginBottom: "22px", paddingBottom: "13px", borderBottom: "1px solid var(--border)" }}>{STEPS[step]}</h2>
        {stepContent[step]}
      </div>
      {loading && statusMsg && (
        <div style={{ padding: "10px 14px", background: "rgba(56,189,248,.05)", border: "1px solid rgba(56,189,248,.18)", borderRadius: "var(--r)", marginBottom: "12px", fontSize: ".82rem", color: "var(--accent)", display: "flex", alignItems: "center", gap: "8px" }}>
          <span className="spin">⟳</span> {statusMsg}
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "space-between", gap: "10px" }}>
        {step > 0
          ? <button className="btn btn-ghost" onClick={() => setStep(s => s - 1)} disabled={loading}>← Back</button>
          : <div />
        }
        {step < STEPS.length - 1
          ? <button className="btn btn-primary" onClick={handleNext}>Continue →</button>
          : <button className="btn btn-primary" onClick={handleCreate} disabled={loading} style={{ minWidth: "180px", justifyContent: "center" }}>
              {loading ? <span style={{ display: "flex", alignItems: "center", gap: "7px" }}><span className="spin">⟳</span> Launching…</span> : "🚀 Launch"}
            </button>
        }
      </div>
    </div>
  );
}
