import React, { useState, useEffect } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { useWallet, useConnection, useAnchorWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { fetchAllProjects, createCampaignOnChain } from "../lib/programClient.js";
import { AnchorProvider } from "@coral-xyz/anchor";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { toUSDC, DURATIONS, TREASURY_FEE_PCT, CATEGORIES } from "../lib/constants.js";
import { useToast } from "../components/Toast.jsx";

const STEPS = ["Campaign Info", "Funding Economics", "Review & Launch"];

export default function CreateCampaignPage() {
  const { connection } = useConnection();
  const wallet  = useAnchorWallet();
  const { setVisible } = useWalletModal();
  const navigate = useNavigate();
  const toast    = useToast();
  const [params] = useSearchParams();

  const [step, setStep]     = useState(0);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState({});
  const [projects, setProjects] = useState([]); // all creator projects

  // Pre-selected project index from URL (?project=0)
  const urlProjectIndex = params.get("project") !== null ? parseInt(params.get("project")) : null;

  const [form, setForm] = useState({
    projectIndex:     urlProjectIndex ?? "",
    title:            "",
    description:      "",
    category:         "tech",
    prizeSOL:         "1",
    positionPriceSOL: "0.1",
    durationHours:    24,
  });

  const set = (k, v) => { setForm(f => ({ ...f, [k]: v })); setErrors(e => ({ ...e, [k]: "" })); };

  // Load all projects for this creator
  useEffect(() => {
    if (!wallet) return;
    (async () => {
      const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
      const ps = await fetchAllProjects(provider, wallet.publicKey.toBase58());
      setProjects(ps);
      // Auto-select if only one project and none pre-selected
      if (ps.length === 1 && form.projectIndex === "") {
        setForm(f => ({ ...f, projectIndex: ps[0].projectIndex }));
      }
    })();
  }, [wallet?.publicKey?.toBase58()]);

  const selectedProject = projects.find(p => p.projectIndex === Number(form.projectIndex)) || null;
  const prize      = Number(form.prizeSOL) || 0;
  const ticketPrice = Number(form.positionPriceSOL) || 0;
  const maxPot     = prize + ticketPrice * 100;
  const treasuryPerSale = (ticketPrice * TREASURY_FEE_PCT) / 100;

  function validate(s) {
    const e = {};
    if (s === 0) {
      if (form.projectIndex === "" || form.projectIndex === null) e.projectIndex = "Select a token/project";
      if (!form.title.trim())          e.title       = "Required";
      if (form.description.trim().length < 20) e.description = "At least 20 characters";
    }
    if (s === 1) {
      if (prize < 0.001)        e.prizeSOL         = "Minimum 0.001 SOL";
      if (ticketPrice < 0.00001) e.positionPriceSOL = "Too small";
      if (ticketPrice >= prize)  e.positionPriceSOL = "Should be less than the prize";
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleCreate() {
    if (!wallet) { toast("Connect wallet first", "error"); setVisible(true); return; }
    if (!selectedProject) { toast("Select a project/token first", "error"); return; }

    setLoading(true);
    try {
      const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
      toast("Creating campaign on-chain...", "info");

      const prizeLam  = Math.floor(prize       * LAMPORTS_PER_SOL);
      const priceLam  = Math.floor(ticketPrice * LAMPORTS_PER_SOL);
      const tokPerPos = Math.floor(ticketPrice * 1_000_000);
      const durSecs   = form.durationHours * 3600;

      const { campaignPDA } = await createCampaignOnChain(provider, {
        projectIndex:           selectedProject.projectIndex,
        prizeLamports:          prizeLam,
        positionPriceLamports:  priceLam,
        tokensPerPosition:      tokPerPos,
        durationSeconds:        durSecs,
        title:       form.title.trim(),
        description: form.description.trim(),
      });

      toast("🎉 Campaign created on-chain!", "success");
      navigate(`/campaign/${campaignPDA}`);
    } catch (e) {
      console.error("[BCF] createCampaign error:", e);
      toast("Error: " + (e.message || "Failed"), "error");
    } finally {
      setLoading(false);
    }
  }

  const stepContent = [
    /* Step 0 — Campaign Info */
    <div key={0} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>

      {/* Project selector */}
      <div className="field">
        <label className="label">Token / Project *</label>
        {projects.length === 0 ? (
          <div style={{ padding: "14px 16px", background: "rgba(251,191,36,.05)", border: "1px solid rgba(251,191,36,.2)", borderRadius: "var(--r)", fontSize: ".82rem", color: "#fbbf24" }}>
            ⚠ No tokens yet.{" "}
            <Link to="/create-token" style={{ color: "var(--accent)", fontWeight: 700 }}>Create your first token →</Link>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {projects.map(p => {
              const selected = Number(form.projectIndex) === p.projectIndex;
              return (
                <label key={p.pda} style={{ display: "flex", alignItems: "center", gap: "13px", padding: "12px 16px", background: selected ? "rgba(56,189,248,.05)" : "var(--bg2)", border: `1px solid ${selected ? "rgba(56,189,248,.3)" : "var(--border2)"}`, borderRadius: "var(--r)", cursor: "pointer", transition: "var(--ease)" }}>
                  <input type="radio" name="project" value={p.projectIndex} checked={selected} onChange={() => set("projectIndex", p.projectIndex)} style={{ accentColor: "var(--accent)" }} />
                  <div style={{ width: "36px", height: "36px", borderRadius: "8px", background: "var(--bg3)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, overflow: "hidden", border: "1px solid var(--border)" }}>
                    {p.logo ? <img src={p.logo} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span>🪙</span>}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "7px" }}>
                      <span style={{ fontWeight: 700, fontSize: ".88rem" }}>{p.name}</span>
                      <span style={{ fontFamily: "var(--mono)", fontSize: ".72rem", color: "var(--accent)" }}>${p.symbol}</span>
                      <span style={{ fontSize: ".62rem", background: "var(--bg3)", color: "var(--text3)", padding: "1px 5px", borderRadius: "4px" }}>#{p.projectIndex}</span>
                    </div>
                    <div style={{ fontSize: ".72rem", color: "var(--text3)" }}>
                      Treasury: {p.treasury.balanceSOL.toFixed(4)} SOL · {p.campaignCount} campaign{p.campaignCount !== 1 ? "s" : ""}
                    </div>
                  </div>
                </label>
              );
            })}
            {errors.projectIndex && <span className="err">{errors.projectIndex}</span>}
          </div>
        )}
      </div>

      <div className="field">
        <label className="label">Campaign Title *</label>
        <input className={`input ${errors.title ? "input-err" : ""}`}
          placeholder="e.g. Round 1 — Community Funding"
          value={form.title} onChange={e => set("title", e.target.value)} />
        {errors.title && <span className="err">{errors.title}</span>}
      </div>

      <div className="field">
        <label className="label">Description * (min 20 chars)</label>
        <textarea className={`input ${errors.description ? "input-err" : ""}`}
          placeholder="What is this funding round for? What will participants get?"
          value={form.description} onChange={e => set("description", e.target.value)}
          style={{ minHeight: "90px" }} />
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          {errors.description ? <span className="err">{errors.description}</span> : <span />}
          <span style={{ fontSize: ".7rem", color: "var(--text3)" }}>{form.description.length} chars</span>
        </div>
      </div>

      <div className="field">
        <label className="label">Duration</label>
        <select className="input" value={form.durationHours} onChange={e => set("durationHours", Number(e.target.value))}>
          {DURATIONS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
        </select>
      </div>
    </div>,

    /* Step 1 — Funding Economics */
    <div key={1} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      <div style={{ padding: "14px 16px", background: "rgba(56,189,248,.05)", border: "1px solid rgba(56,189,248,.15)", borderRadius: "var(--r)", fontSize: ".82rem", color: "var(--text2)", lineHeight: 1.65 }}>
        <strong style={{ color: "var(--accent)" }}>Economics:</strong> You deposit the prize SOL upfront. 100 positions go on sale. At deadline, one position wins the full pot. If unclaimed → treasury.
      </div>

      <div className="grid-2">
        <div className="field">
          <label className="label">Prize Amount (SOL) *</label>
          <input type="number" step="0.01" min="0.001" className={`input ${errors.prizeSOL ? "input-err" : ""}`}
            placeholder="1.0" value={form.prizeSOL} onChange={e => set("prizeSOL", e.target.value)} />
          <span style={{ fontSize: ".72rem", color: "var(--text3)" }}>≈ ${toUSDC(prize)} USDC</span>
          {errors.prizeSOL && <span className="err">{errors.prizeSOL}</span>}
        </div>
        <div className="field">
          <label className="label">Position Price (SOL) *</label>
          <input type="number" step="0.001" min="0.00001" className={`input ${errors.positionPriceSOL ? "input-err" : ""}`}
            placeholder="0.1" value={form.positionPriceSOL} onChange={e => set("positionPriceSOL", e.target.value)} />
          <span style={{ fontSize: ".72rem", color: "var(--text3)" }}>≈ ${toUSDC(ticketPrice)} USDC per slot</span>
          {errors.positionPriceSOL && <span className="err">{errors.positionPriceSOL}</span>}
        </div>
      </div>

      {prize > 0 && ticketPrice > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "10px" }}>
          {[
            ["Max Pot", `${maxPot.toFixed(3)} SOL`],
            ["Treasury/sale", `${treasuryPerSale.toFixed(5)} SOL`],
            ["Token ratio", `${Math.floor(ticketPrice * 1_000_000).toLocaleString()} tokens`],
          ].map(([l, v]) => (
            <div key={l} style={{ padding: "10px 12px", background: "var(--bg2)", borderRadius: "8px", border: "1px solid var(--border)" }}>
              <div style={{ fontSize: ".6rem", color: "var(--text3)", textTransform: "uppercase", marginBottom: "2px" }}>{l}</div>
              <div style={{ fontWeight: 700, fontSize: ".85rem" }}>{v}</div>
            </div>
          ))}
        </div>
      )}
    </div>,

    /* Step 2 — Review */
    <div key={2} style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      {[
        ["Token",       selectedProject ? `${selectedProject.name} ($${selectedProject.symbol}) #${selectedProject.projectIndex}` : "—"],
        ["Title",       form.title],
        ["Prize",       `${prize} SOL ≈ $${toUSDC(prize)}`],
        ["Pos. Price",  `${ticketPrice} SOL / slot`],
        ["Duration",    `${form.durationHours}h`],
        ["Network",     "Solana DevNet"],
      ].map(([l, v], i, arr) => (
        <div key={l} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "11px 0", borderBottom: i < arr.length - 1 ? "1px solid var(--border)" : "none" }}>
          <span style={{ fontSize: ".78rem", color: "var(--text3)", textTransform: "uppercase" }}>{l}</span>
          <span style={{ fontWeight: 600, fontSize: ".86rem", color: "var(--text)" }}>{v || "—"}</span>
        </div>
      ))}
      <div style={{ marginTop: "16px", padding: "12px 14px", background: "rgba(56,189,248,.04)", border: "1px solid rgba(56,189,248,.12)", borderRadius: "var(--r)", fontSize: ".8rem", color: "var(--text2)", lineHeight: 1.6 }}>
        <strong style={{ color: "var(--accent)" }}>After creating:</strong> Go to the campaign page and deposit {prize} SOL to activate it. 100 positions (00–99) will go live immediately.
      </div>
    </div>,
  ];

  return (
    <div style={{ padding: "56px 24px", maxWidth: "680px", margin: "0 auto" }}>
      <div style={{ marginBottom: "36px" }}>
        <Link to="/dashboard" style={{ fontSize: ".8rem", color: "var(--text3)", display: "inline-flex", alignItems: "center", gap: "5px", marginBottom: "14px" }}>← Dashboard</Link>
        <div className="section-label">Step 2 of 2</div>
        <h1 style={{ fontSize: "1.9rem", letterSpacing: "-.03em" }}>Create Campaign</h1>
        <p style={{ color: "var(--text2)", fontSize: ".88rem", marginTop: "6px" }}>
          {projects.length > 1
            ? `You have ${projects.length} tokens — select which one this campaign belongs to.`
            : "Set up your funding round parameters."
          }
        </p>
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
        <h2 style={{ fontWeight: 700, fontSize: "1.05rem", marginBottom: "22px", paddingBottom: "14px", borderBottom: "1px solid var(--border)" }}>{STEPS[step]}</h2>
        {!wallet ? (
          <div style={{ textAlign: "center", padding: "24px" }}>
            <p style={{ color: "var(--text2)", marginBottom: "16px" }}>Connect wallet to continue</p>
            <button className="btn btn-primary" onClick={() => setVisible(true)}>Connect Wallet</button>
          </div>
        ) : stepContent[step]}
      </div>

      {wallet && (
        <div style={{ display: "flex", justifyContent: "space-between", gap: "10px" }}>
          {step > 0
            ? <button className="btn btn-ghost" onClick={() => setStep(s => s - 1)} disabled={loading}>← Back</button>
            : <div />
          }
          {step < STEPS.length - 1
            ? <button className="btn btn-primary" onClick={() => { if (validate(step)) setStep(s => s + 1); }}>Continue →</button>
            : <button className="btn btn-primary" onClick={handleCreate} disabled={loading || projects.length === 0} style={{ minWidth: "160px", justifyContent: "center" }}>
                {loading
                  ? <span style={{ display: "flex", alignItems: "center", gap: "7px" }}><span className="spin">⟳</span> Creating...</span>
                  : "🚀 Create Campaign"}
              </button>
          }
        </div>
      )}
    </div>
  );
}
