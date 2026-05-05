import React from 'react';
import { Link } from 'react-router-dom';
import { posStatus, totalPot, timeLeft, isExpired, fmtPos } from '../lib/programClient.js';
import { toUSDC } from '../lib/constants.js';
import { shortAddr } from '../lib/solana.js';

// Quirúrgicamente limpia los títulos de Solana (bytes basura)
const sanitizeText = (text) => {
  if (!text || typeof text !== 'string') return '';
  
  // 1. Detección de Prefijo Corrupto (buscamos ';' en los primeros 12 caracteres)
  const semiIdx = text.indexOf(';');
  if (semiIdx !== -1 && semiIdx < 12) {
    const prefix = text.slice(0, semiIdx);
    // 2. Validación de Basura (buscamos caracteres de error confirmados: ʚ o U+FFFD)
    if (prefix.includes('ʚ') || prefix.includes('\uFFFD') || /^[?q\s]+$/.test(prefix)) {
      // Es basura confirmada, cortamos y entregamos el resto
      return text.slice(semiIdx + 1).trim();
    }
  }
  
  // 3. Limpieza de Caracteres Invisibles (bytes no imprimibles < 32 excepto espacio)
  return text.replace(/[\x00-\x1F\x7F-\x9F]/g, "").trim();
};

export default function CampaignCard({ campaign: c }) {
  const [timeDisplay, setTimeDisplay] = React.useState(c.deadline ? timeLeft(c.deadline) : "—");
  const sold    = posStatus(c);
  const pot     = totalPot(c);
  const expired = isExpired(c);

  React.useEffect(() => {
    if (!c.deadline || c.status !== 'active') return;
    const interval = setInterval(() => {
      setTimeDisplay(timeLeft(c.deadline));
    }, 1000);
    return () => clearInterval(interval);
  }, [c.deadline, c.status]);

  const badge = {
    pending:  <span className="badge badge-pending">◐ Pending</span>,
    active:   <span className="badge badge-active">● Active</span>,
    settled:  <span className="badge badge-settled">✦ Settled</span>,
    cancelled:<span className="badge" style={{ background:'var(--bg3)', color:'var(--text3)', border:'1px solid var(--border)' }}>Cancelled</span>,
  }[c.status];

  return (
    <Link to={`/campaign/${c.id}`} style={{ textDecoration: 'none', display: 'block' }}>
      <div className="card card-hover" style={{ padding: '22px', cursor: 'pointer', position: 'relative', overflow: 'hidden' }}>
        {c.status === 'active' && <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '2px', background: 'linear-gradient(90deg, var(--accent2), var(--accent))' }} />}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
          <div style={{ flex: 1, paddingRight: '10px' }}>
            <div style={{ fontSize: '.7rem', color: 'var(--text3)', fontFamily: 'var(--mono)', marginBottom: '4px' }}>
              ${c.tokenSymbol}
            </div>
            <h3 style={{ fontSize: '.98rem', fontWeight: 700, letterSpacing: '-.02em', lineHeight: 1.25 }}>{sanitizeText(c.title)}</h3>
          </div>
          {badge}
        </div>

        <p style={{ fontSize: '.81rem', color: 'var(--text2)', lineHeight: 1.5, marginBottom: '16px', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
          {sanitizeText(c.description)}
        </p>

        {/* Position mini-grid */}
        <div style={{ display: 'flex', gap: '2px', flexWrap: 'wrap', marginBottom: '12px' }}>
          {c.positions.map((p, i) => (
            <div key={i} style={{ width: '8px', height: '8px', borderRadius: '2px', background: c.status === 'settled' && i === c.winningPosition ? 'var(--accent)' : p.owner ? 'rgba(56,189,248,.5)' : 'var(--bg3)' }} />
          ))}
        </div>

        {/* Stats */}
        <div style={{ marginBottom: '14px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '6px' }}>
            <span style={{ fontFamily: 'var(--mono)', fontWeight: 700, fontSize: '1.15rem', color: 'var(--accent)' }}>
              {pot.toFixed(3)} SOL
            </span>
            <span style={{ fontSize: '.74rem', color: 'var(--text3)' }}>≈ ${toUSDC(pot)} prize pool</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.74rem' }}>
            <span style={{ color: 'var(--accent)', fontWeight: 600 }}>{sold}/100 positions filled</span>
            <span style={{ color: 'var(--text3)' }}>{c.positionPriceSOL} SOL each</span>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '12px', borderTop: '1px solid var(--border)', fontSize: '.72rem' }}>
          <span style={{ color: 'var(--text3)', fontFamily: 'var(--mono)' }}>{shortAddr(c.creatorWallet)}</span>
          <span style={{ fontWeight: 700, color: c.status === 'settled' ? 'var(--accent)' : expired ? 'var(--danger)' : 'var(--text2)' }}>
            {c.status === 'settled'
              ? `Winner: #${fmtPos(c.winningPosition)}`
              : timeDisplay}
          </span>
        </div>
      </div>
    </Link>
  );
}
