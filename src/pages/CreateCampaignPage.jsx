import React, { useState, useEffect } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { getToken, getCreatorTokens, createCampaign } from "../lib/store.js";
import { toUSDC, fromUSDC, DURATIONS, TREASURY_FEE_PCT, CATEGORIES } from "../lib/constants.js";
import { useToast } from "../components/Toast.jsx";

const STEPS = ["Campaign Info", "Funding Economics", "Review & Launch"];

export default function CreateCampaignPage() {
  const { connected, publicKey } = useWallet();
  const { setVisible } = useWalletModal();
  const navigate = useNavigate();
  const toast = useToast();
  const [params] = useSearchParams();
  const [step, setStep]       = useState(0);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors]   = useState({});
  const [myTokens, setMyTokens] = useState([]);

  const [form, setForm] = useState({
    tokenMint:       params.get("token") || "",
    title:           "",
    description:     "",
    category:        "tech",
    prizeSOL:        "1",
    positionPriceSOL:"0.1",
    durationHours:   24,
    showDonation:    false,
    donationAddress: "",
  });

  useEffect(() => {
    if (connected && publicKey) {
      setMyTokens(getCreatorTokens(publicKey.toBase58()));
    }
  }, [connected, publicKey]);

  const set = (k,v) => { setForm(f=>({...f,[k]:v})); setErrors(e=>({...e,[k]:""})); };
  const selectedToken = form.tokenMint ? getToken(form.tokenMint) : null;
  const prize = Number(form.prizeSOL)||0;
  const ticketPrice = Number(form.positionPriceSOL)||0;
  const maxFromSales = ticketPrice*100;
  const maxPot = prize + maxFromSales;
  const treasuryPerSale = (ticketPrice * TREASURY_FEE_PCT) / 100;

  function validate(s) {
    const e = {};
    if (s===0) {
      if (!form.tokenMint)             e.tokenMint   = "Select a token";
      if (!form.title.trim())          e.title       = "Required";
      if (form.description.trim().length<20) e.description = "At least 20 characters";
    }
    if (s===1) {
      if (!form.prizeSOL || prize < 0.01)          e.prizeSOL        = "Min 0.01 SOL";
      if (!form.positionPriceSOL || ticketPrice<0.001) e.positionPriceSOL = "Min 0.001 SOL";
      if (ticketPrice > prize)                      e.positionPriceSOL = "Position price should not exceed jackpot";
    }
    setErrors(e);
    return Object.keys(e).length===0;
  }

  async function handleLaunch() {
    if (!connected) { setVisible(true); return; }
    setLoading(true);
    try {
      const campaign = createCampaign({
        tokenMint:        form.tokenMint,
        tokenSymbol:      selectedToken?.symbol || "???",
        creatorWallet:    publicKey.toBase58(),
        title:            form.title,
        description:      form.description,
        category:         form.category,
        prizeSOL:         prize,
        positionPriceSOL: ticketPrice,
        durationHours:    Number(form.durationHours),
        showDonation:     form.showDonation,
        donationAddress:  form.showDonation ? (form.donationAddress || publicKey.toBase58()) : "",
      });
      toast("Campaign created! Deposit prize to activate.", "success");
      navigate(`/campaign/${campaign.id}`);
    } catch(e) {
      toast("Error: " + e.message, "error");
    } finally { setLoading(false); }
  }

  const stepContent = [
    /* Step 0 — Campaign Info */
    <div key={0} style={{ display:"flex", flexDirection:"column", gap:"16px" }}>
      <div className="field">
        <label className="label">Linked Token *</label>
        {myTokens.length===0 ? (
          <div style={{ padding:"14px 16px", background:"rgba(251,191,36,.08)", border:"1px solid rgba(251,191,36,.2)", borderRadius:"var(--r)", fontSize:".83rem", color:"var(--warning)" }}>
            No tokens found. <Link to="/create-token" style={{ color:"var(--accent)" }}>Create a token first →</Link>
          </div>
        ) : (
          <select className={`input ${errors.tokenMint?"input-err":""}`} value={form.tokenMint} onChange={e=>set("tokenMint",e.target.value)}>
            <option value="">Select your token...</option>
            {myTokens.map(t => <option key={t.mint} value={t.mint}>${t.symbol} — {t.name}</option>)}
          </select>
        )}
        {errors.tokenMint && <span className="err">{errors.tokenMint}</span>}
        {selectedToken && (
          <div style={{ padding:"10px 13px", background:"var(--bg3)", borderRadius:"var(--r)", fontSize:".78rem", color:"var(--text2)", display:"flex", gap:"14px" }}>
            <span>Token: <strong style={{ color:"var(--accent)" }}>${selectedToken.symbol}</strong></span>
            <span>Fee: <strong>{selectedToken.feeModeName}</strong></span>
            <span>Treasury: <strong style={{ color:"var(--green)" }}>{selectedToken.treasury?.balanceSOL?.toFixed(4)} SOL</strong></span>
          </div>
        )}
      </div>
      <div className="field">
        <label className="label">Campaign Title *</label>
        <input className={`input ${errors.title?"input-err":""}`} placeholder="Round 1 — Community Funding" value={form.title} onChange={e=>set("title",e.target.value)} />
        {errors.title && <span className="err">{errors.title}</span>}
      </div>
      <div className="field">
        <label className="label">Description * (min 20 chars)</label>
        <textarea className={`input ${errors.description?"input-err":""}`} placeholder="What is this funding round for? What will the funds support?" value={form.description} onChange={e=>set("description",e.target.value)} style={{ minHeight:"90px" }} />
        <div style={{ display:"flex", justifyContent:"space-between" }}>
          {errors.description?<span className="err">{errors.description}</span>:<span/>}
          <span style={{ fontSize:".72rem", color:"var(--text3)" }}>{form.description.length}</span>
        </div>
      </div>
      <div className="field">
        <label className="label">Category</label>
        <select className="input" value={form.category} onChange={e=>set("category",e.target.value)}>
          {CATEGORIES.map(c=><option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
      </div>
      <div style={{ padding:"16px", background:"var(--bg2)", border:"1px solid var(--border2)", borderRadius:"var(--r)" }}>
        <label style={{ display:"flex", alignItems:"center", gap:"11px", cursor:"pointer" }}>
          <input type="checkbox" checked={form.showDonation} onChange={e=>set("showDonation",e.target.checked)} style={{ width:15, height:15, accentColor:"var(--accent)" }} />
          <div>
            <div style={{ fontWeight:600, fontSize:".88rem" }}>Show direct donation address</div>
            <div style={{ fontSize:".74rem", color:"var(--text3)" }}>Let supporters send extra support outside the campaign system</div>
          </div>
        </label>
        {form.showDonation && (
          <div className="field" style={{ marginTop:"12px" }}>
            <label className="label">Donation address (empty = your wallet)</label>
            <input className="input" placeholder="Solana address..." value={form.donationAddress} onChange={e=>set("donationAddress",e.target.value)} />
          </div>
        )}
      </div>
    </div>,

    /* Step 1 — Economics */
    <div key={1} style={{ display:"flex", flexDirection:"column", gap:"16px" }}>
      <div style={{ padding:"14px 16px", background:"rgba(56,189,248,.06)", border:"1px solid rgba(56,189,248,.18)", borderRadius:"var(--r)", fontSize:".82rem", color:"var(--text2)", lineHeight:1.65 }}>
        <strong style={{ color:"var(--accent)" }}>How this works:</strong> You deposit the prize to activate the round. 100 positions go on sale. At the end, one position wins everything. If no one holds the winning position, the full pot goes to your project treasury.
      </div>
      <div className="field">
        <label className="label">Prize Amount (SOL) — You deposit this to activate *</label>
        <div style={{ position:"relative" }}>
          <input className={`input ${errors.prizeSOL?"input-err":""}`} type="number" min="0.01" step="0.1" placeholder="1" value={form.prizeSOL} onChange={e=>set("prizeSOL",e.target.value)} style={{ paddingRight:"100px" }} />
          <span style={{ position:"absolute", right:13, top:"50%", transform:"translateY(-50%)", color:"var(--text3)", fontSize:".8rem" }}>SOL ≈ ${toUSDC(prize)}</span>
        </div>
        {errors.prizeSOL && <span className="err">{errors.prizeSOL}</span>}
      </div>
      <div className="field">
        <label className="label">Position Price (SOL each) *</label>
        <div style={{ position:"relative" }}>
          <input className={`input ${errors.positionPriceSOL?"input-err":""}`} type="number" min="0.001" step="0.01" placeholder="0.1" value={form.positionPriceSOL} onChange={e=>set("positionPriceSOL",e.target.value)} style={{ paddingRight:"100px" }} />
          <span style={{ position:"absolute", right:13, top:"50%", transform:"translateY(-50%)", color:"var(--text3)", fontSize:".8rem" }}>SOL ≈ ${toUSDC(ticketPrice)}</span>
        </div>
        {errors.positionPriceSOL && <span className="err">{errors.positionPriceSOL}</span>}
      </div>
      {prize>0 && ticketPrice>0 && (
        <div style={{ padding:"18px", background:"var(--bg2)", border:"1px solid var(--border2)", borderRadius:"var(--r)" }}>
          <div style={{ fontSize:".72rem", color:"var(--text3)", textTransform:"uppercase", letterSpacing:".06em", marginBottom:"12px" }}>Economics Preview</div>
          {[
            ["Your prize deposit",      `${prize.toFixed(3)} SOL (≈$${toUSDC(prize)})`],
            ["Position price",          `${ticketPrice.toFixed(3)} SOL × 100`],
            ["Max from position sales", `${maxFromSales.toFixed(3)} SOL`],
            ["Max total prize pool",    `${maxPot.toFixed(3)} SOL (≈$${toUSDC(maxPot)})`, true],
            ["Treasury per sale (2%)",  `${treasuryPerSale.toFixed(4)} SOL each`],
            ["Tokens per position",     `${Math.floor(ticketPrice*1000000).toLocaleString()} tokens (fixed rate)`],
          ].map(([l,v,hi])=>(
            <div key={l} style={{ display:"flex", justifyContent:"space-between", marginBottom:"7px", fontSize:".82rem" }}>
              <span style={{ color:"var(--text3)" }}>{l}</span>
              <span style={{ fontWeight:700, color:hi?"var(--accent)":l.includes("Treasury")?"var(--green)":"var(--text)", fontFamily:"var(--mono)" }}>{v}</span>
            </div>
          ))}
        </div>
      )}
      <div className="field">
        <label className="label">Duration</label>
        <select className="input" value={form.durationHours} onChange={e=>set("durationHours",Number(e.target.value))}>
          {DURATIONS.map(d=><option key={d.value} value={d.value}>{d.label}</option>)}
        </select>
      </div>
    </div>,

    /* Step 2 — Review */
    <div key={2} style={{ display:"flex", flexDirection:"column" }}>
      {[
        ["Token",           `$${selectedToken?.symbol} — ${selectedToken?.name}`],
        ["Campaign Title",  form.title],
        ["Prize (deposit)", `${prize} SOL (≈$${toUSDC(prize)})`],
        ["Position Price",  `${ticketPrice} SOL (≈$${toUSDC(ticketPrice)})`],
        ["Total Positions", "100 (00–99)"],
        ["Max Prize Pool",  `${maxPot.toFixed(3)} SOL`],
        ["Duration",        DURATIONS.find(d=>d.value===Number(form.durationHours))?.label],
        ["Treasury (2%/sale)", `${treasuryPerSale.toFixed(4)} SOL per position`],
        ["Donation Address",form.showDonation?"Visible":"Hidden"],
        ["Network",         "Solana DevNet"],
      ].map(([l,v],i,arr)=>(
        <div key={l} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"12px 0", borderBottom:i<arr.length-1?"1px solid var(--border)":"none" }}>
          <span style={{ fontSize:".78rem", color:"var(--text3)", textTransform:"uppercase", letterSpacing:".04em" }}>{l}</span>
          <span style={{ fontWeight:600, fontSize:".87rem", maxWidth:"55%", textAlign:"right", color:l.includes("Prize")||l.includes("Pool")?"var(--accent)":l.includes("Treasury")?"var(--green)":"var(--text)" }}>{v||"—"}</span>
        </div>
      ))}
      <div style={{ marginTop:"18px", padding:"14px 16px", background:"rgba(56,189,248,.05)", border:"1px solid rgba(56,189,248,.15)", borderRadius:"var(--r)", fontSize:".82rem", color:"var(--text2)", lineHeight:1.65 }}>
        <strong style={{ color:"var(--accent)" }}>Next step:</strong> After launching, go to your campaign page and deposit {prize} SOL to activate it. The 100 positions will immediately go on sale.
      </div>
      {!connected && (
        <div style={{ marginTop:"14px", padding:"13px", background:"rgba(251,191,36,.08)", border:"1px solid rgba(251,191,36,.2)", borderRadius:"var(--r)", fontSize:".84rem", color:"var(--warning)" }}>
          ⚠️ Connect your wallet to launch the campaign
        </div>
      )}
    </div>,
  ];

  return (
    <div style={{ padding:"56px 24px", maxWidth:"680px", margin:"0 auto" }}>
      <div style={{ marginBottom:"36px" }}>
        <Link to="/create-token" style={{ fontSize:".8rem", color:"var(--text3)", display:"inline-flex", alignItems:"center", gap:"5px", marginBottom:"14px" }}>← Create Token First</Link>
        <div className="section-label">Step 2 of 2</div>
        <h1 style={{ fontSize:"1.9rem", letterSpacing:"-.03em" }}>Launch Funding Campaign</h1>
        <p style={{ color:"var(--text2)", fontSize:".88rem", marginTop:"6px" }}>Create a funding round linked to your Bags token.</p>
      </div>

      <div className="step-bar" style={{ marginBottom:"30px" }}>
        {STEPS.map((s,i)=>(
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
          : <button className="btn btn-primary" onClick={handleLaunch} disabled={loading} style={{ minWidth:"160px", justifyContent:"center" }}>
              {loading?<span style={{ display:"flex", alignItems:"center", gap:"7px" }}><span className="spin">⟳</span> Creating...</span>:"🚀 Launch Campaign"}
            </button>
        }
      </div>
    </div>
  );
}
