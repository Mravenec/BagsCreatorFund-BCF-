import React, { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { createToken, getCreatorTokens } from "../lib/store.js";
import { createBagsTokenInfo } from "../lib/bags.js";
import { FEE_MODES, CATEGORIES } from "../lib/constants.js";
import { useToast } from "../components/Toast.jsx";

const STEPS = ["Token Identity", "Fee Structure", "Review & Create"];

export default function CreateTokenPage() {
  const { connected, publicKey } = useWallet();
  const { setVisible } = useWalletModal();
  const navigate = useNavigate();
  const toast = useToast();
  const [step, setStep]       = useState(0);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors]   = useState({});

  const [form, setForm] = useState({
    name: "", symbol: "", description: "", purpose: "",
    imageUrl: "", category: "tech",
    feeModeId: "fa29606e-5e48-4c37-827f-4b03d58ee23d",
  });

  const set = (k, v) => { setForm(f => ({...f, [k]:v})); setErrors(e => ({...e, [k]:""})); };
  const feeMode = FEE_MODES.find(m => m.id === form.feeModeId);

  function validate(s) {
    const e = {};
    if (s === 0) {
      if (!form.name.trim())                   e.name   = "Required";
      if (!form.symbol.trim())                  e.symbol  = "Required";
      if (form.symbol.length > 10)              e.symbol  = "Max 10 chars";
      if (form.description.trim().length < 20)  e.description = "At least 20 characters";
      if (!form.purpose.trim())                 e.purpose = "Required";
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleCreate() {
    if (!connected) { setVisible(true); return; }
    setLoading(true);
    try {
      let mint = null, metadataUri = "";
      toast("Registering token on Bags...", "info");
      try {
        const info = await createBagsTokenInfo({
          name: form.name, symbol: form.symbol.toUpperCase(),
          description: form.description + "\n\nPurpose: " + form.purpose,
          imageUrl: form.imageUrl,
        });
        mint = info.mint || info.tokenMint || null;
        metadataUri = info.metadataUri || "";
        toast("Token registered on Bags ✓", "success");
      } catch (e) {
        mint = null; // will get devnet placeholder below
        toast("Token queued (DevNet mode)", "info");
      }

      const token = createToken({
        name: form.name, symbol: form.symbol.toUpperCase(),
        description: form.description, purpose: form.purpose,
        imageUrl: form.imageUrl,
        feeModeId: form.feeModeId, feeModeName: feeMode?.name || "Standard",
        creatorWallet: publicKey.toBase58(),
        mint, metadataUri,
      });

      toast(`Token $${token.symbol} created!`, "success");
      navigate(`/create-campaign?token=${token.mint}`);
    } catch (e) {
      toast("Error: " + e.message, "error");
    } finally { setLoading(false); }
  }

  const stepContent = [
    /* Step 0 — Token Identity */
    <div key={0} style={{ display:"flex", flexDirection:"column", gap:"16px" }}>
      <div style={{ padding:"14px 16px", background:"rgba(56,189,248,.06)", border:"1px solid rgba(56,189,248,.18)", borderRadius:"var(--r)", fontSize:".82rem", color:"var(--text2)", lineHeight:1.65 }}>
        <strong style={{ color:"var(--accent)" }}>Your token is your project.</strong> It will be minted on Solana via Bags and become the economic identity of all your future funding campaigns. Think of this as your on-chain whitepaper.
      </div>
      <div className="grid-2">
        <div className="field">
          <label className="label">Token Name *</label>
          <input className={`input ${errors.name?"input-err":""}`} placeholder="My Creator Project" value={form.name} onChange={e=>set("name",e.target.value)} />
          {errors.name && <span className="err">{errors.name}</span>}
        </div>
        <div className="field">
          <label className="label">Symbol * (max 10)</label>
          <input className={`input ${errors.symbol?"input-err":""}`} placeholder="MYPROJ" maxLength={10} value={form.symbol} onChange={e=>set("symbol",e.target.value.toUpperCase())} style={{ fontFamily:"var(--mono)", letterSpacing:".08em" }} />
          {errors.symbol && <span className="err">{errors.symbol}</span>}
        </div>
      </div>
      <div className="field">
        <label className="label">Description * (min 20 chars)</label>
        <textarea className={`input ${errors.description?"input-err":""}`} placeholder="What is this project about? What problem does it solve?" value={form.description} onChange={e=>set("description",e.target.value)} style={{ minHeight:"90px" }} />
        <div style={{ display:"flex", justifyContent:"space-between" }}>
          {errors.description?<span className="err">{errors.description}</span>:<span/>}
          <span style={{ fontSize:".72rem", color:"var(--text3)" }}>{form.description.length} chars</span>
        </div>
      </div>
      <div className="field">
        <label className="label">Project Purpose * — Why are you raising funds?</label>
        <textarea className={`input ${errors.purpose?"input-err":""}`} placeholder="e.g. Building an open-source music platform. Funds go to development costs and community rewards." value={form.purpose} onChange={e=>set("purpose",e.target.value)} style={{ minHeight:"80px" }} />
        {errors.purpose && <span className="err">{errors.purpose}</span>}
      </div>
      <div className="field">
        <label className="label">Token Image URL (optional)</label>
        <input className="input" placeholder="https://example.com/logo.png" value={form.imageUrl} onChange={e=>set("imageUrl",e.target.value)} />
      </div>
      <div className="field">
        <label className="label">Category</label>
        <select className="input" value={form.category} onChange={e=>set("category",e.target.value)}>
          {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
      </div>
    </div>,

    /* Step 1 — Fee Structure */
    <div key={1} style={{ display:"flex", flexDirection:"column", gap:"12px" }}>
      <div style={{ padding:"14px 16px", background:"var(--bg2)", border:"1px solid var(--border2)", borderRadius:"var(--r)", fontSize:".82rem", color:"var(--text2)", lineHeight:1.65 }}>
        This fee is charged on every trade of your token on Bags — <strong style={{ color:"var(--text)" }}>forever</strong>. It is set permanently at token creation. Choose carefully.
      </div>
      {FEE_MODES.map(m => (
        <label key={m.id} style={{ display:"flex", alignItems:"flex-start", gap:"13px", padding:"14px 16px", background:form.feeModeId===m.id?"rgba(56,189,248,.05)":"var(--bg2)", border:`1px solid ${form.feeModeId===m.id?"rgba(56,189,248,.3)":"var(--border2)"}`, borderRadius:"var(--r)", cursor:"pointer", transition:"var(--ease)" }}>
          <input type="radio" name="fee" value={m.id} checked={form.feeModeId===m.id} onChange={()=>set("feeModeId",m.id)} style={{ marginTop:3, accentColor:"var(--accent)" }} />
          <div style={{ flex:1 }}>
            <div style={{ display:"flex", alignItems:"center", gap:"8px", marginBottom:"3px" }}>
              <span style={{ fontWeight:700, fontSize:".88rem" }}>{m.name}</span>
              <span style={{ fontFamily:"var(--mono)", fontSize:".74rem", color:"var(--accent)" }}>{m.short}</span>
              {m.recommended && <span style={{ background:"rgba(56,189,248,.14)", color:"var(--accent)", fontSize:".64rem", padding:"2px 8px", borderRadius:"100px", fontWeight:700 }}>Recommended</span>}
            </div>
            <p style={{ fontSize:".76rem", color:"var(--text3)", margin:0, lineHeight:1.5 }}>{m.desc}</p>
            <div style={{ fontSize:".74rem", color:"var(--green)", marginTop:"4px", fontWeight:600 }}>You earn: {m.creatorEarns}</div>
          </div>
        </label>
      ))}
    </div>,

    /* Step 2 — Review */
    <div key={2} style={{ display:"flex", flexDirection:"column", gap:0 }}>
      {[
        ["Token Name",   form.name],
        ["Symbol",       `$${form.symbol}`],
        ["Description",  form.description.slice(0,60) + (form.description.length>60?"...":"")],
        ["Fee Structure",feeMode?.name],
        ["Creator Earns",feeMode?.creatorEarns],
        ["Network",      "Solana DevNet"],
      ].map(([l,v],i,arr) => (
        <div key={l} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"12px 0", borderBottom:i<arr.length-1?"1px solid var(--border)":"none" }}>
          <span style={{ fontSize:".78rem", color:"var(--text3)", textTransform:"uppercase", letterSpacing:".04em" }}>{l}</span>
          <span style={{ fontWeight:600, fontSize:".88rem", maxWidth:"55%", textAlign:"right", color: l==="Creator Earns"?"var(--green)":l==="Symbol"?"var(--accent)":"var(--text)" }}>{v||"—"}</span>
        </div>
      ))}
      <div style={{ marginTop:"18px", padding:"14px 16px", background:"rgba(56,189,248,.05)", border:"1px solid rgba(56,189,248,.15)", borderRadius:"var(--r)", fontSize:".82rem", color:"var(--text2)", lineHeight:1.65 }}>
        <strong style={{ color:"var(--accent)" }}>After creating:</strong> You will be taken to create a funding campaign linked to this token. You can create multiple campaigns with the same token over time.
      </div>
      {!connected && (
        <div style={{ marginTop:"14px", padding:"13px 15px", background:"rgba(251,191,36,.08)", border:"1px solid rgba(251,191,36,.2)", borderRadius:"var(--r)", fontSize:".84rem", color:"var(--warning)" }}>
          ⚠️ Connect your wallet to create the token
        </div>
      )}
    </div>,
  ];

  return (
    <div style={{ padding:"56px 24px", maxWidth:"680px", margin:"0 auto" }}>
      <div style={{ marginBottom:"36px" }}>
        <Link to="/" style={{ fontSize:".8rem", color:"var(--text3)", display:"inline-flex", alignItems:"center", gap:"5px", marginBottom:"14px" }}>← Back</Link>
        <div className="section-label">Step 1 of 2</div>
        <h1 style={{ fontSize:"1.9rem", letterSpacing:"-.03em" }}>Create Your Token</h1>
        <p style={{ color:"var(--text2)", fontSize:".88rem", marginTop:"6px" }}>Your token is your project identity on Bags and Solana.</p>
      </div>

      {/* Step bar */}
      <div className="step-bar" style={{ marginBottom:"30px" }}>
        {STEPS.map((s,i) => (
          <div key={i} className="step-item">
            <div className={`step-track ${i<step?"done":i===step?"active":"idle"}`} />
            <div className={`step-name ${i<step?"done":i===step?"active":"idle"}`}>{s}</div>
          </div>
        ))}
      </div>

      <div className="card" style={{ padding:"30px", marginBottom:"18px" }}>
        <h2 style={{ fontWeight:700, fontSize:"1.05rem", marginBottom:"22px", paddingBottom:"14px", borderBottom:"1px solid var(--border)" }}>{STEPS[step]}</h2>
        {stepContent[step]}
      </div>

      <div style={{ display:"flex", justifyContent:"space-between", gap:"10px" }}>
        {step>0 ? <button className="btn btn-ghost" onClick={()=>setStep(s=>s-1)} disabled={loading}>← Back</button> : <div />}
        {step<STEPS.length-1
          ? <button className="btn btn-primary" onClick={()=>{ if(validate(step)) setStep(s=>s+1); }}>Continue →</button>
          : <button className="btn btn-primary" onClick={handleCreate} disabled={loading} style={{ minWidth:"160px", justifyContent:"center" }}>
              {loading ? <span style={{ display:"flex", alignItems:"center", gap:"7px" }}><span className="spin">⟳</span> Creating...</span> : "🚀 Create Token"}
            </button>
        }
      </div>
    </div>
  );
}
