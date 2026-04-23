import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { fetchAllCampaigns, totalPot } from "../lib/programClient.js";
import { useConnection } from "@solana/wallet-adapter-react";
import { pingBags } from "../lib/bags.js";
import { toUSDC } from "../lib/constants.js";
import CampaignCard from "../components/CampaignCard.jsx";

export default function HomePage() {
  const [active, setActive] = useState([]);
  const [stats,  setStats]  = useState({ campaigns: 0, active: 0, pot: 0 });
  const [apiOk,  setApiOk]  = useState(null);

  const { connection } = useConnection();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const all = await fetchAllCampaigns(connection);
      const act = all.filter(c => c.status === "active");
      const pot = all.reduce((s, c) => s + totalPot(c), 0);
      setActive(act.slice(0, 6));
      setStats({ campaigns: all.length, active: act.length, pot });
      pingBags().then(setApiOk);
      setLoading(false);
    }
    load();
  }, [connection]);

  return (
    <div>
      {/* Hero */}
      <section style={{ position:"relative", padding:"88px 48px 72px", overflow:"hidden", borderBottom:"1px solid var(--border)" }}>
        <div style={{ position:"absolute", inset:0, backgroundImage:`linear-gradient(var(--border) 1px,transparent 1px),linear-gradient(90deg,var(--border) 1px,transparent 1px)`, backgroundSize:"52px 52px", opacity:.18 }} />
        <div style={{ position:"absolute", top:"-80px", right:"-80px", width:"600px", height:"600px", background:"radial-gradient(circle,rgba(56,189,248,.06) 0%,transparent 70%)", borderRadius:"50%" }} />

        <div style={{ position:"relative", zIndex:1, maxWidth:"880px", margin:"0 auto" }}>
          <div style={{ display:"flex", alignItems:"center", gap:"10px", flexWrap:"wrap", marginBottom:"28px" }}>
            <div style={{ display:"inline-flex", alignItems:"center", gap:"7px", padding:"4px 14px", background:"var(--bg2)", border:"1px solid var(--border2)", borderRadius:"100px", fontSize:".74rem" }}>
              <span style={{ width:6, height:6, borderRadius:"50%", background: apiOk===null?"var(--warning)":apiOk?"var(--green)":"var(--danger)", display:"inline-block" }} />
              <span style={{ color:"var(--text2)" }}>Bags API {apiOk===null?"connecting...":apiOk?"online":"offline"}</span>
            </div>
            <span className="badge badge-devnet">Solana DevNet</span>
            <span className="badge badge-bags">Bags Hackathon 2025</span>
          </div>

          <h1 style={{ fontSize:"clamp(2.4rem,5vw,4.5rem)", fontWeight:700, letterSpacing:"-.04em", lineHeight:1.0, marginBottom:"22px" }}>
            Fund creators.<br />
            Build the future<span style={{ color:"var(--accent)" }}>.</span>
          </h1>

          <p style={{ fontSize:"1.05rem", color:"var(--text2)", maxWidth:"540px", lineHeight:1.72, marginBottom:"36px" }}>
            BagsCreatorFund lets creators launch funding rounds backed by Bags tokens. Supporters participate, earn tokens, and share in the project treasury — all on Solana, fully transparent.
          </p>

          <div style={{ display:"flex", gap:"12px", flexWrap:"wrap" }}>
            <Link to="/create-token" className="btn btn-primary btn-lg">Launch Your Token</Link>
            <Link to="/explore" className="btn btn-secondary btn-lg">Explore Campaigns</Link>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section style={{ padding:"0 48px", borderBottom:"1px solid var(--border)", display:"flex" }}>
        {[
          { label:"Total Campaigns", value:stats.campaigns },
          { label:"Active Now",      value:stats.active, hi:true },
          { label:"Total SOL Raised",value:`${stats.pot.toFixed(3)} SOL` },
          { label:"USDC Reference",  value:`~$${toUSDC(stats.pot)}` },
        ].map((s,i) => (
          <div key={i} style={{ flex:1, padding:"26px 0", borderRight:i<3?"1px solid var(--border)":"none", paddingLeft:i>0?"36px":"0" }}>
            <div style={{ fontFamily:"var(--mono)", fontSize:"1.5rem", fontWeight:700, color:s.hi?"var(--accent)":"var(--text)" }}>{s.value}</div>
            <div style={{ fontSize:".73rem", color:"var(--text3)", marginTop:"4px", textTransform:"uppercase", letterSpacing:".06em" }}>{s.label}</div>
          </div>
        ))}
      </section>

      {/* How it works */}
      <section style={{ padding:"66px 48px", borderBottom:"1px solid var(--border)" }}>
        <div style={{ maxWidth:"960px", margin:"0 auto" }}>
          <div style={{ marginBottom:"42px" }}>
            <div className="section-label">How it works</div>
            <h2 style={{ fontSize:"1.85rem", letterSpacing:"-.03em" }}>Three steps. Full economy.</h2>
          </div>
          <div className="grid-3">
            {[
              { n:"01", icon:"🪙", title:"Create your token", body:"Define your project on Bags. Your token is minted on Solana — your project identity, treasury, and community in one on-chain object." },
              { n:"02", icon:"🎯", title:"Launch a funding round", body:"100 positions go on sale. Each purchase distributes project tokens at a fixed rate. 2% of every sale goes to your project treasury automatically." },
              { n:"03", icon:"⚡", title:"Resolve on-chain", body:"When time ends, a winning position is drawn from the Solana block hash. Winner gets the full prize pool. No winner? Funds join your treasury." },
            ].map((s,i) => (
              <div key={i} className="card" style={{ padding:"28px", position:"relative", overflow:"hidden" }}>
                <div style={{ position:"absolute", top:"-6px", right:"14px", fontFamily:"var(--mono)", fontSize:"3.2rem", fontWeight:700, color:"var(--bg3)", lineHeight:1, userSelect:"none" }}>{s.n}</div>
                <div style={{ fontSize:"1.8rem", marginBottom:"12px" }}>{s.icon}</div>
                <h3 style={{ fontSize:".95rem", fontWeight:700, marginBottom:"9px" }}>{s.title}</h3>
                <p style={{ fontSize:".82rem", color:"var(--text2)", lineHeight:1.6 }}>{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Treasury + Token callouts */}
      <section style={{ padding:"52px 48px", borderBottom:"1px solid var(--border)" }}>
        <div style={{ maxWidth:"960px", margin:"0 auto" }}>
          <div className="grid-2">
            <div className="card" style={{ padding:"30px" }}>
              <div style={{ fontSize:"1.5rem", marginBottom:"12px" }}>🏦</div>
              <h3 style={{ fontWeight:700, fontSize:".98rem", marginBottom:"10px" }}>Project Treasury</h3>
              <p style={{ fontSize:".83rem", color:"var(--text2)", lineHeight:1.68, marginBottom:"14px" }}>
                2% of every position sale flows into your project treasury. Unclaimed prizes also go there. The treasury is the economic core of your project — it accumulates SOL as your community grows.
              </p>
              <div style={{ display:"flex", flexDirection:"column", gap:"6px", fontSize:".8rem", color:"var(--text2)" }}>
                {["2% per position sale -> treasury","Unclaimed prizes -> treasury","Creator can withdraw any time","Withdrawals are visible publicly"].map(t => <div key={t}>{t}</div>)}
              </div>
            </div>
            <div className="card" style={{ padding:"30px" }}>
              <div style={{ fontSize:"1.5rem", marginBottom:"12px" }}>💎</div>
              <h3 style={{ fontWeight:700, fontSize:".98rem", marginBottom:"10px" }}>Token Economy on Bags</h3>
              <p style={{ fontSize:".83rem", color:"var(--text2)", lineHeight:1.68, marginBottom:"14px" }}>
                Every position distributes project tokens at a fixed rate. Tokens trade on bags.fm. Creators earn trading fees on every swap — forever. Launch multiple rounds with the same token to grow your community.
              </p>
              <div style={{ display:"flex", flexDirection:"column", gap:"6px", fontSize:".8rem", color:"var(--text2)" }}>
                {["Fixed rate: 1 SOL = 1,000,000 tokens","4 fee structures available","Reuse token across all your campaigns","Trade on bags.fm anytime"].map(t => <div key={t}>{t}</div>)}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Active campaigns */}
      <section style={{ padding:"60px 48px" }}>
        <div style={{ maxWidth:"1100px", margin:"0 auto" }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"28px" }}>
            <div>
              <div className="section-label">Live now</div>
              <h2 style={{ fontSize:"1.7rem", letterSpacing:"-.03em" }}>Active Campaigns</h2>
            </div>
            <Link to="/explore" className="btn btn-ghost btn-sm">View all</Link>
          </div>
          {active.length===0 ? (
            <div style={{ textAlign:"center", padding:"68px 24px", border:"1px dashed var(--border2)", borderRadius:"var(--rl)" }}>
              <div style={{ fontSize:"2.2rem", marginBottom:"12px" }}>🎯</div>
              <h3 style={{ fontWeight:700, marginBottom:"8px" }}>No active campaigns</h3>
              <p style={{ color:"var(--text2)", fontSize:".88rem", marginBottom:"22px" }}>Create a token and launch the first funding round.</p>
              <Link to="/create-token" className="btn btn-primary">Launch your token</Link>
            </div>
          ) : (
            <div className="campaign-grid">{active.map(c => <CampaignCard key={c.id} campaign={c} />)}</div>
          )}
        </div>
      </section>
    </div>
  );
}
