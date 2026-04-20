import React from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { useWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { shortAddr } from '../lib/solana.js';

const NAV = [
  { to: '/',               label: 'Home'       },
  { to: '/explore',        label: 'Explore'    },
  { to: '/create-token',   label: 'New Token'  },
  { to: '/dashboard',      label: 'Dashboard'  },
];

export default function Layout() {
  const { connected, publicKey, disconnect } = useWallet();
  const { setVisible } = useWalletModal();
  const loc = useLocation();

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>

      {/* DevNet banner */}
      <div style={{ background: 'rgba(167,139,250,.08)', borderBottom: '1px solid rgba(167,139,250,.18)', padding: '5px 24px', textAlign: 'center', fontSize: '.73rem', color: 'var(--purple)', fontWeight: 600, letterSpacing: '.06em' }}>
        🔧 SOLANA DEVNET — Use faucet SOL for testing. No real funds at risk.
      </div>

      {/* Nav */}
      <nav style={{ position: 'sticky', top: 0, zIndex: 100, background: 'rgba(11,17,32,.94)', backdropFilter: 'blur(16px)', borderBottom: '1px solid var(--border)', height: '58px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 28px' }}>

        {/* Logo */}
        <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ width: '32px', height: '32px', background: 'linear-gradient(135deg, var(--accent2), var(--accent))', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', fontWeight: 700, color: '#000' }}>BCF</span>
          </div>
          <div>
            <span style={{ fontWeight: 700, fontSize: '1rem', letterSpacing: '-.025em' }}>
              Bags<span style={{ color: 'var(--accent)' }}>Creator</span>Fund
            </span>
          </div>
          <span className="badge badge-devnet" style={{ fontSize: '.6rem' }}>devnet</span>
        </Link>

        {/* Links */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
          {NAV.map(n => (
            <Link key={n.to} to={n.to} style={{
              padding: '6px 13px', borderRadius: 'var(--r)', fontSize: '.84rem', fontWeight: 500,
              color: loc.pathname === n.to ? 'var(--accent)' : 'var(--text2)',
              background: loc.pathname === n.to ? 'var(--glow)' : 'transparent',
              transition: 'var(--ease)',
            }}>{n.label}</Link>
          ))}
        </div>

        {/* Wallet */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
          {connected ? (
            <>
              <div style={{ padding: '6px 12px', background: 'var(--bg2)', border: '1px solid var(--border2)', borderRadius: 'var(--r)', fontSize: '.75rem', color: 'var(--text2)', fontFamily: 'var(--mono)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--green)', display: 'inline-block' }} />
                {shortAddr(publicKey?.toBase58())}
              </div>
              <button className="btn btn-ghost btn-sm" onClick={disconnect}>Disconnect</button>
            </>
          ) : (
            <button className="btn btn-primary btn-sm" onClick={() => setVisible(true)}>Connect Wallet</button>
          )}
        </div>
      </nav>

      <main style={{ flex: 1 }}>
        <Outlet />
      </main>

      {/* Footer */}
      <footer style={{ borderTop: '1px solid var(--border)', padding: '26px 28px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
        <span style={{ fontWeight: 700, fontSize: '.9rem' }}>
          Bags<span style={{ color: 'var(--accent)' }}>Creator</span>Fund
          <span style={{ color: 'var(--text3)', fontWeight: 400, marginLeft: '10px', fontSize: '.76rem' }}>Bags Hackathon 2025</span>
        </span>
        <div style={{ display: 'flex', gap: '18px', fontSize: '.76rem', color: 'var(--text3)' }}>
          <a href="https://bags.fm" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--text2)' }}>bags.fm</a>
          <a href="https://docs.bags.fm" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--text2)' }}>API Docs</a>
          <span>Solana DevNet</span>
        </div>
      </footer>
    </div>
  );
}
