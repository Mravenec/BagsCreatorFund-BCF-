import React, { useState, useEffect, useMemo } from "react";
import { fetchAllCampaigns, fetchGlobalProjects } from "../lib/programClient.js";
import { useConnection } from "@solana/wallet-adapter-react";
import { CATEGORIES } from "../lib/constants.js";
import CampaignCard from "../components/CampaignCard.jsx";
import { sortCampaignsByPriority } from '../utils/campaignSorting.js';

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
      try {
        const [camps, projects] = await Promise.all([
          fetchAllCampaigns(connection),
          fetchGlobalProjects(connection)
        ]);
        
        const enriched = camps.map(c => ({
          ...c,
          tokenSymbol: projects.find(p => p.projectIndex === c.projectIndex)?.symbol || c.tokenSymbol
        }));
        
        setAll(enriched);
      } catch (e) {
        console.error("[Explore] Load error:", e);
        const data = await fetchAllCampaigns(connection);
        setAll(data);
      }
      setLoading(false);
    }
    load();
  }, [connection]);

  // Apply filters and sorting
  const filteredAndSortedCampaigns = useMemo(() => {
    let filtered = all;

    // Search filter
    if (search) {
      const q = search.toLowerCase();
      filtered = filtered.filter(campaign => 
        campaign.title?.toLowerCase().includes(q) ||
        campaign.description?.toLowerCase().includes(q)
      );
    }

    // Status filter
    if (status !== 'all') {
      // NOTE: "settled" maps to both "settled" and "finished" logic-wise, but since the status is string, we just match it.
      filtered = filtered.filter(campaign => campaign.status === status);
    }

    // Category filter
    if (category !== 'all') {
      filtered = filtered.filter(campaign => campaign.category === category);
    }

    // Apply priority sorting
    return sortCampaignsByPriority(filtered);
  }, [all, search, status, category]);

  // Group by status
  const activeCampaigns = filteredAndSortedCampaigns.filter(c => c.status === 'active');
  const pendingCampaigns = filteredAndSortedCampaigns.filter(c => c.status === 'pending');
  const completedCampaigns = filteredAndSortedCampaigns.filter(c => ['settled', 'finished'].includes(c.status));

  return (
    <div style={{ padding:"46px 28px", maxWidth:"1200px", margin:"0 auto" }}>
      <div style={{ marginBottom:"34px" }}>
        <div className="section-label">Discover</div>
        <h1 style={{ fontSize:"2rem", letterSpacing:"-.03em", marginBottom:"6px" }}>All Campaigns</h1>
        <p style={{ color:"var(--text2)", fontSize:".88rem" }}>{filteredAndSortedCampaigns.length} campaign{filteredAndSortedCampaigns.length !== 1 ? "s" : ""} found</p>
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
      ) : filteredAndSortedCampaigns.length === 0 ? (
        <div style={{ textAlign:"center", padding:"70px 24px", border:"1px dashed var(--border2)", borderRadius:"var(--rl)" }}>
          <div style={{ fontSize:"2rem", marginBottom:"10px" }}>🔍</div>
          <h3 style={{ fontWeight:700, marginBottom:"6px" }}>No campaigns found</h3>
          <p style={{ color:"var(--text2)", fontSize:".88rem" }}>Try adjusting your filters or search terms.</p>
        </div>
      ) : (
        <>
          <CampaignSection title="🔥 Active Campaigns" campaigns={activeCampaigns} />
          <CampaignSection title="⏳ Upcoming Campaigns" campaigns={pendingCampaigns} />
          <CampaignSection title="📊 Completed Campaigns" campaigns={completedCampaigns} />
        </>
      )}
    </div>
  );
}

const CampaignSection = ({ title, campaigns }) => {
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
      
      <div className="campaign-grid">
        {campaigns.map(c => <CampaignCard key={c.id} campaign={c} />)}
      </div>
    </div>
  );
};
