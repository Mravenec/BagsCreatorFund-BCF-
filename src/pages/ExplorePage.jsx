import { IS_MAINNET, NETWORK } from '../lib/constants.js';
import React, { useState, useEffect } from "react";
import { fetchAllCampaigns } from "../lib/programClient.js";
import { useConnection } from "@solana/wallet-adapter-react";
import { CATEGORIES } from "../lib/constants.js";
import CampaignCard from "../components/CampaignCard.jsx";

const STATUS = [
  { v:"all", l:"All" }, { v:"active", l:"Active" },
  { v:"pending", l:"Pending" }, { v:"settled", l:"Settled" },
];

export default function ExplorePage() {
  const [all,      setAll]      = useState([]);
  const [status,   setStatus]   = useState("all");
  const [category, setCategory] = useState("all");
  const [search,   setSearch]   = useState("");

  const { connection } = useConnection();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const data = await fetchAllCampaigns(connection);
      setAll(data);
      setLoading(false);
    }
    load();
  }, [connection]);

  const sorted = [...all].sort((a, b) => {
    const priorities = { active: 1, pending: 2, settled: 3, cancelled: 4 };
    const pa = priorities[a.status] || 99;
    const pb = priorities[b.status] || 99;
    if (pa !== pb) return pa - pb;
    // Secondary sort: newest first
    return (b.createdAt || 0) - (a.createdAt || 0);
  });

  const filtered = sorted.filter(c => {
    if (status !== "all" && c.status !== status) return false;
    if (category !== "all" && c.category !== category) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!c.title.toLowerCase().includes(q) && !c.description?.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  return (
    <div style={{ padding:"46px 28px", maxWidth:"1200px", margin:"0 auto" }}>
      <div style={{ marginBottom:"34px" }}>
        <div className="section-label">Discover</div>
        <h1 style={{ fontSize:"2rem", letterSpacing:"-.03em", marginBottom:"6px" }}>All Campaigns</h1>
        <p style={{ color:"var(--text2)", fontSize:".88rem" }}>{all.length} campaign{all.length!==1?"s":""} on BagsCreatorFund</p>
      </div>

      <div style={{ display:"flex", gap:"10px", flexWrap:"wrap", marginBottom:"28px", padding:"18px", background:"var(--bg1)", border:"1px solid var(--border)", borderRadius:"var(--rl)" }}>
        <input className="input" placeholder="Search campaigns..." value={search} onChange={e=>setSearch(e.target.value)} style={{ flex:1, minWidth:"180px" }} />
        <select className="input" value={status} onChange={e=>setStatus(e.target.value)} style={{ width:"auto", minWidth:"130px" }}>
          {STATUS.map(s => <option key={s.v} value={s.v}>{s.l}</option>)}
        </select>
        <select className="input" value={category} onChange={e=>setCategory(e.target.value)} style={{ width:"auto", minWidth:"150px" }}>
          <option value="all">All Categories</option>
          {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
      </div>

      {loading ? (
        <div style={{ textAlign:"center", padding:"70px 24px" }}><span className="spin">⟳</span> Loading on-chain campaigns...</div>
      ) : filtered.length===0 ? (
        <div style={{ textAlign:"center", padding:"70px 24px", border:"1px dashed var(--border2)", borderRadius:"var(--rl)" }}>
          <div style={{ fontSize:"2rem", marginBottom:"10px" }}>🔍</div>
          <h3 style={{ fontWeight:700, marginBottom:"6px" }}>No campaigns found</h3>
          <p style={{ color:"var(--text2)", fontSize:".88rem" }}>Try adjusting your filters.</p>
        </div>
      ) : (
        <div className="campaign-grid">{filtered.map(c => <CampaignCard key={c.id} campaign={c} />)}</div>
      )}
    </div>
  );
}
