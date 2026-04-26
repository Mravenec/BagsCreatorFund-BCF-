import { IS_MAINNET, NETWORK } from '../lib/constants.js';
import React, { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useWallet, useConnection, useAnchorWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { initializeProject } from "../lib/programClient.js";
import { AnchorProvider } from "@coral-xyz/anchor";
import { launchBagsToken, markMintAsReal } from "../lib/bags.js";
import { FEE_MODES, CATEGORIES } from "../lib/constants.js";
import { useToast } from "../components/Toast.jsx";

const STEPS = ["Token Identity", "Fee Structure", "Review & Create"];

export default function CreateTokenPage() {
  const { connection } = useConnection();
  const wallet  = useAnchorWallet();
  const { setVisible } = useWalletModal();
  const navigate = useNavigate();
  const toast    = useToast();

  const [step, setStep]       = useState(0);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors]   = useState({});
  const [statusMsg, setStatusMsg] = useState("");
  const [created, setCreated] = useState(null); // { mint, projectIndex }

  const [form, setForm] = useState({
    name: "", symbol: "", description: "", purpose: "",
    imageUrl: "", category: "tech", twitter: "", website: "",
    feeModeId: "fa29606e-5e48-4c37-827f-4b03d58ee23d",
  });

  const set  = (k, v) => { setForm(f => ({ ...f, [k]: v })); setErrors(e => ({ ...e, [k]: "" })); };
  const feeMode = FEE_MODES.find(m => m.id === form.feeModeId);

  function validate(s) {
    const e = {};
    if (s === 0) {
      if (!form.name.trim())                   e.name        = "Required";
      if (!form.symbol.trim())                 e.symbol      = "Required";
      if (form.symbol.length > 10)             e.symbol      = "Max 10 chars";
      if (form.description.trim().length < 20) e.description = "At least 20 characters";
      if (!form.purpose.trim())                e.purpose     = "Required";
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleCreate() {
    if (!wallet) { toast("Connect wallet first", "error"); setVisible(true); return; }
    setLoading(true); setStatusMsg("");

    let finalMint = null;
    let isRealToken = false;

    try {
      const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });

      // ── Bags v2 Full Token Launch (4 steps) ──────────────────────────────────
      // Step 1: POST /token-launch/create-token-info (FormData)
      // Step 2: POST /fee-share/config → sign config TXs
      // Step 3: POST /token-launch/create-launch-transaction
      // Step 4: wallet signs → Mainnet
      setStatusMsg("📡 Launching token on Bags (follow wallet prompts)...");
      toast("Launching on Bags Mainnet — wallet will ask for approval(s)", "info");

      try {
        const result = await launchBagsToken(wallet, {
          name:        form.name,
          symbol:      form.symbol.toUpperCase(),
          description: `${form.description}\n\nPurpose: ${form.purpose}`,
          imageUrl:    form.imageUrl,
          twitter:     form.twitter,
          website:     form.website,
          bagsConfigType:     form.feeModeId,
          initialBuyLamports: 0,
        });
        finalMint = result.mint;
        isRealToken = true;
        markMintAsReal(finalMint);
        toast(`✅ Token live on Bags! tx: ${result.signature?.slice(0, 8)}...`, "success");
        setStatusMsg("✅ Token created on Bags Mainnet!");
      } catch (bagsErr) {
        const m = (bagsErr.message || "").toLowerCase();
        if (m.includes("user rejected") || m.includes("cancel")) {
          toast("Token creation cancelled.", "error");
          setLoading(false); setStatusMsg(""); return;
        }
        console.warn("[BCF] Bags Mainnet error:", bagsErr.message);
        toast("⚠ Bags Mainnet failed — DevNet simulation mode.", "info");
        setStatusMsg("⚠️ DevNet simulation (Bags Mainnet unavailable)...");
        // Simulation fallback: use a placeholder mint for DevNet testing
        finalMint = `sim_${wallet.publicKey.toBase58().slice(0,8)}_${Date.now()}`;
        isRealToken = false;
      }

      // ── Create on-chain project in BCF (DevNet) ─────────────────────────────
      setStatusMsg(`🔗 Creating BCF project on ${IS_MAINNET?'Mainnet':'DevNet'}...`);
      toast("Initializing on-chain project...", "info");

      const { projectIndex } = await initializeProject(provider, {
        tokenMint:   finalMint,
        feeModeName: feeMode?.name || "Standard 2%",
        name:        form.name,
        symbol:      form.symbol.toUpperCase(),
      });

      const verb = isRealToken ? "on Bags Mainnet" : "(DevNet simulation)";
      toast(`🎉 Token #${projectIndex} created ${verb}!`, "success");
      setStatusMsg("🎉 Done!");
      setCreated({ mint: finalMint, projectIndex, isRealToken });

        } catch (e) {
      // Extract real error message from Anchor/Solana errors (often lack .message)
      const errMsg = e?.message
        || e?.toString?.()?.replace(/^Error:\s*/, "")
        || (e?.logs ? "TX failed: " + (e.logs.slice(-2).join(" | ")) : null)
        || JSON.stringify(e)
        || "Unknown error";

      console.error("[BCF] CreateToken error:", {
        message: errMsg,
        logs: e?.logs,
        raw: e,
      });
      toast("Error: " + errMsg.slice(0, 120), "error");
      setStatusMsg("❌ " + errMsg.slice(0, 120));
    } finally {
      setLoading(false);
    }
  }

  function resetForAnother() {
    setForm({ name: "", symbol: "", description: "", purpose: "", imageUrl: "", category: "tech", twitter: "", website: "", feeModeId: "fa29606e-5e48-4c37-827f-4b03d58ee23d" });
    setStep(0); setErrors({}); setStatusMsg(""); setCreated(null);
  }

  // ── SUCCESS STATE ─────────────────────────────────────────────────────────
  if (created) return (
    <div style={{ padding: "80px 24px", maxWidth: "560px", margin: "0 auto", textAlign: "center" }}>
      <div style={{ fontSize: "3.5rem", marginBottom: "16px" }}>🎉</div>
      <h1 style={{ fontSize: "1.8rem", fontWeight: 800, marginBottom: "8px" }}>Token Created!</h1>
      <p style={{ color: "var(--text2)", marginBottom: "28px", fontSize: ".9rem", lineHeight: 1.65 }}>
        <strong style={{ color: "var(--accent)" }}>${form.symbol.toUpperCase()}</strong> is your{" "}
        <strong>Project #{created.projectIndex}</strong>.<br />
        {created.isRealToken
          ? "It's live on Bags Mainnet and visible at bags.fm/token/..."
          : "DevNet simulation active — token not yet live on Bags Mainnet."
        }
      </p>

      <div style={{ padding: "14px 18px", background: "var(--bg2)", borderRadius: "var(--r)", marginBottom: "28px", fontFamily: "var(--mono)", fontSize: ".75rem", color: "var(--text3)", wordBreak: "break-all", textAlign: "left" }}>
        <div style={{ fontSize: ".65rem", textTransform: "uppercase", color: "var(--text3)", marginBottom: "4px" }}>Mint Address</div>
        {created.mint}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <Link to={`/create-campaign?project=${created.projectIndex}`} className="btn btn-primary btn-lg">
          🚀 Create Campaign for this Token
        </Link>
        <button className="btn btn-outline" onClick={resetForAnother}>
          🪙 Create Another Token
        </button>
        <Link to="/dashboard" className="btn btn-ghost">
          📊 Go to Dashboard
        </Link>
      </div>
    </div>
  );

  // ── FORM STEPS ────────────────────────────────────────────────────────────
  const stepContent = [
    /* Step 0 — Token Identity */
    <div key={0} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      <div style={{ padding: "13px 16px", background: "rgba(56,189,248,.06)", border: "1px solid rgba(56,189,248,.18)", borderRadius: "var(--r)", fontSize: ".82rem", color: "var(--text2)", lineHeight: 1.65 }}>
        <strong style={{ color: "var(--accent)" }}>Your token is your project identity.</strong>{" "}
        It will be minted on Bags (Solana Mainnet) and link to all your future campaigns.
        You can create <strong>multiple tokens</strong> from one wallet.
      </div>

      <div className="grid-2">
        <div className="field">
          <label className="label">Token Name *</label>
          <input className={`input ${errors.name ? "input-err" : ""}`} placeholder="My Creator Project"
            value={form.name} onChange={e => set("name", e.target.value)} />
          {errors.name && <span className="err">{errors.name}</span>}
        </div>
        <div className="field">
          <label className="label">Symbol * (max 10)</label>
          <input className={`input ${errors.symbol ? "input-err" : ""}`} placeholder="MYPROJ"
            maxLength={10} value={form.symbol} onChange={e => set("symbol", e.target.value.toUpperCase())}
            style={{ fontFamily: "var(--mono)", letterSpacing: ".08em" }} />
          {errors.symbol && <span className="err">{errors.symbol}</span>}
        </div>
      </div>

      <div className="field">
        <label className="label">Description * (min 20 chars)</label>
        <textarea className={`input ${errors.description ? "input-err" : ""}`}
          placeholder="What is this project about? What problem does it solve?"
          value={form.description} onChange={e => set("description", e.target.value)}
          style={{ minHeight: "80px" }} />
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          {errors.description ? <span className="err">{errors.description}</span> : <span />}
          <span style={{ fontSize: ".7rem", color: "var(--text3)" }}>{form.description.length} chars</span>
        </div>
      </div>

      <div className="field">
        <label className="label">Project Purpose * — Why are you raising funds?</label>
        <textarea className={`input ${errors.purpose ? "input-err" : ""}`}
          placeholder="e.g. Open-source music platform, indie game, community fund..."
          value={form.purpose} onChange={e => set("purpose", e.target.value)}
          style={{ minHeight: "70px" }} />
        {errors.purpose && <span className="err">{errors.purpose}</span>}
      </div>

      <div className="grid-2">
        <div className="field">
          <label className="label">Token Image URL (optional)</label>
          <input className="input" placeholder="https://..." value={form.imageUrl} onChange={e => set("imageUrl", e.target.value)} />
        </div>
        <div className="field">
          <label className="label">Twitter / X (optional)</label>
          <input className="input" placeholder="@handle" value={form.twitter} onChange={e => set("twitter", e.target.value)} />
        </div>
      </div>

      <div className="grid-2">
        <div className="field">
          <label className="label">Website (optional)</label>
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

    /* Step 1 — Fee Structure */
    <div key={1} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      <div style={{ padding: "13px 16px", background: "var(--bg2)", border: "1px solid var(--border2)", borderRadius: "var(--r)", fontSize: ".82rem", color: "var(--text2)", lineHeight: 1.65 }}>
        Fee charged on every trade of your token on Bags — <strong>permanently</strong>. You earn a portion of every trade.
      </div>
      {FEE_MODES.map(m => (
        <label key={m.id} style={{ display: "flex", alignItems: "flex-start", gap: "13px", padding: "13px 16px", background: form.feeModeId === m.id ? "rgba(56,189,248,.05)" : "var(--bg2)", border: `1px solid ${form.feeModeId === m.id ? "rgba(56,189,248,.3)" : "var(--border2)"}`, borderRadius: "var(--r)", cursor: "pointer", transition: "var(--ease)" }}>
          <input type="radio" name="fee" value={m.id} checked={form.feeModeId === m.id} onChange={() => set("feeModeId", m.id)} style={{ marginTop: 3, accentColor: "var(--accent)" }} />
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: "7px", marginBottom: "2px" }}>
              <span style={{ fontWeight: 700, fontSize: ".88rem" }}>{m.name}</span>
              <span style={{ fontFamily: "var(--mono)", fontSize: ".72rem", color: "var(--accent)" }}>{m.short}</span>
              {m.recommended && <span style={{ fontSize: ".63rem", background: "rgba(52,211,153,.12)", color: "var(--green)", padding: "2px 6px", borderRadius: "4px", fontWeight: 700 }}>Recommended</span>}
            </div>
            <p style={{ fontSize: ".75rem", color: "var(--text3)", margin: 0 }}>{m.desc}</p>
            <p style={{ fontSize: ".72rem", color: "var(--accent)", margin: "3px 0 0", fontWeight: 600 }}>You earn: {m.creatorEarns}</p>
          </div>
        </label>
      ))}
    </div>,

    /* Step 2 — Review */
    <div key={2} style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      {[
        ["Token Name",    form.name],
        ["Symbol",        `$${form.symbol}`],
        ["Fee Structure", feeMode?.name],
        ["Creator Earns", feeMode?.creatorEarns],
        ["Networks", IS_MAINNET ? "Token → Bags Mainnet · Campaigns → Mainnet" : "Token → Bags Mainnet · Campaigns → DevNet"],
      ].map(([l, v], i, arr) => (
        <div key={l} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "11px 0", borderBottom: i < arr.length - 1 ? "1px solid var(--border)" : "none" }}>
          <span style={{ fontSize: ".78rem", color: "var(--text3)", textTransform: "uppercase" }}>{l}</span>
          <span style={{ fontWeight: 600, fontSize: ".86rem", color: l === "Symbol" ? "var(--accent)" : "var(--text)" }}>{v || "—"}</span>
        </div>
      ))}
      <div style={{ marginTop: "18px", padding: "13px 16px", background: "rgba(56,189,248,.04)", border: "1px solid rgba(56,189,248,.14)", borderRadius: "var(--r)", fontSize: ".8rem", color: "var(--text2)", lineHeight: 1.65 }}>
        <strong style={{ color: "var(--accent)" }}>Steps on click:</strong>
        <ol style={{ margin: "6px 0 0 16px", padding: 0, lineHeight: 1.8 }}>
          <li>Metadata registered on Bags (free)</li>
          <li>Launch TX built (free)</li>
          <li>Wallet signs → token minted on <strong>Mainnet</strong> (small fee)</li>
          <li>BCF Project #N created on <strong>DevNet</strong> (free)</li>
        </ol>
        <p style={{ margin: "8px 0 0", color: "var(--text3)", fontSize: ".73rem" }}>
          ⚠ Mainnet token creation needs ~0.01 SOL on Mainnet. DevNet campaigns use free airdrop SOL.
        </p>
      </div>
    </div>,
  ];

  return (
    <div style={{ padding: "56px 24px", maxWidth: "680px", margin: "0 auto" }}>
      <div style={{ marginBottom: "36px" }}>
        <Link to="/dashboard" style={{ fontSize: ".8rem", color: "var(--text3)", display: "inline-flex", alignItems: "center", gap: "5px", marginBottom: "14px" }}>← Dashboard</Link>
        <div className="section-label">Step 1 of 2</div>
        <h1 style={{ fontSize: "1.9rem", letterSpacing: "-.03em" }}>Create Token</h1>
        <p style={{ color: "var(--text2)", fontSize: ".88rem", marginTop: "6px" }}>Powered by Bags · Multiple tokens per wallet supported.</p>
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
          ? <button className="btn btn-primary" onClick={() => { if (validate(step)) setStep(s => s + 1); }}>Continue →</button>
          : <button className="btn btn-primary" onClick={handleCreate} disabled={loading} style={{ minWidth: "180px", justifyContent: "center" }}>
              {loading
                ? <span style={{ display: "flex", alignItems: "center", gap: "7px" }}><span className="spin">⟳</span> Creating...</span>
                : "🚀 Create Token"}
            </button>
        }
      </div>
    </div>
  );
}
