// Bags API — docs.bags.fm
const BASE = import.meta.env.VITE_BAGS_API_BASE || 'https://public-api-v2.bags.fm/api/v1';
const KEY  = import.meta.env.VITE_BAGS_API_KEY;
const H    = () => ({ 'Content-Type': 'application/json', 'x-api-key': KEY });

// Health check
export async function pingBags() {
  try {
    const r = await fetch('https://public-api-v2.bags.fm/ping');
    return (await r.json()).message === 'pong';
  } catch { return false; }
}

// Create token metadata — step 1 of Bags token launch flow
// POST /token-launch/create-token-info
export async function createBagsTokenInfo({ name, symbol, description, imageUrl = '' }) {
  const r = await fetch(`${BASE}/token-launch/create-token-info`, {
    method: 'POST', headers: H(),
    body: JSON.stringify({
      name, symbol, description,
      image: imageUrl,
      twitter: '', telegram: '', website: '',
    }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.message || `Bags API error ${r.status}`);
  return data; // { metadataUri, mint?, ... }
}

// Get token info by mint
export async function getBagsToken(mint) {
  const r = await fetch(`${BASE}/token/${mint}`, { headers: H() });
  if (!r.ok) return null;
  return r.json();
}

// Get token trading fees earned
export async function getTokenFees(mint, wallet) {
  const r = await fetch(`${BASE}/token/${mint}/fees?wallet=${wallet}`, { headers: H() });
  if (!r.ok) return null;
  return r.json();
}

// Bags token URL
export const bagsTokenUrl = (mint) => `https://bags.fm/token/${mint}`;
export const bagsTradeUrl = (mint) => `https://bags.fm/trade/${mint}`;
