import React, { useMemo } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { ConnectionProvider, WalletProvider, useAnchorWallet, useConnection } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { PhantomWalletAdapter }  from '@solana/wallet-adapter-phantom';
import { SolflareWalletAdapter } from '@solana/wallet-adapter-solflare';
import { CoinbaseWalletAdapter } from '@solana/wallet-adapter-coinbase';
import { TrustWalletAdapter }    from '@solana/wallet-adapter-trust';
import { AnchorProvider }        from '@coral-xyz/anchor';
import '@solana/wallet-adapter-react-ui/styles.css';

import { RPC_URL } from './lib/solana.js';
import { BCF_PROGRAM_ID, NETWORK } from './lib/constants.js';

// Log active Program ID at startup — helps catch ID mismatch immediately
if (typeof window !== 'undefined') {
  console.log(`[BCF] Active Program ID (${NETWORK}): ${BCF_PROGRAM_ID}`);
  console.log(`[BCF] RPC: ${RPC_URL}`);
}
import { ToastProvider } from './components/Toast.jsx';
import Layout              from './components/Layout.jsx';
import HomePage            from './pages/HomePage.jsx';
import ExplorePage         from './pages/ExplorePage.jsx';
import CreateTokenPage     from './pages/CreateTokenPage.jsx';
import CreateCampaignPage  from './pages/CreateCampaignPage.jsx';
import CampaignPage        from './pages/CampaignPage.jsx';
import DashboardPage       from './pages/DashboardPage.jsx';

/**
 * AnchorContext — provides the Anchor provider to all child components.
 * Automatically uses the connected wallet adapter.
 */
export function useAnchorProvider() {
  const { connection } = useConnection();
  const wallet         = useAnchorWallet();
  return useMemo(() => {
    if (!wallet) return null;
    return new AnchorProvider(connection, wallet, { commitment: 'confirmed' });
  }, [connection, wallet]);
}

function AppRoutes() {
  return (
    <ToastProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index                   element={<HomePage />} />
            <Route path="explore"          element={<ExplorePage />} />
            <Route path="create-token"     element={<CreateTokenPage />} />
            <Route path="create-campaign"  element={<CreateCampaignPage />} />
            <Route path="campaign/:id"     element={<CampaignPage />} />
            <Route path="dashboard"        element={<DashboardPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </ToastProvider>
  );
}

export default function App() {
  const wallets = useMemo(() => [
    new PhantomWalletAdapter(),
    new SolflareWalletAdapter(),
    new CoinbaseWalletAdapter(),
    new TrustWalletAdapter(),
  ], []);

  return (
    <ConnectionProvider endpoint={RPC_URL} config={{ commitment: 'confirmed' }}>
      <WalletProvider wallets={wallets} autoConnect onError={e => console.warn('wallet:', e)}>
        <WalletModalProvider>
          <AppRoutes />
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
