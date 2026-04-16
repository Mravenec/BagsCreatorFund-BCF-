import React, { useState, useEffect, useMemo } from 'react';
import { 
  Plus, Wallet, TrendingUp, Clock, CheckCircle2, ArrowRight, AlertCircle,
  Coins, Shield, History, Info, ExternalLink, QrCode, Copy, ChevronRight, X
} from 'lucide-react';

// Solana & Anchor Imports
import { Connection, PublicKey, clusterApiUrl } from '@solana/web3.js';
import { Program, AnchorProvider, web3, utils } from '@coral-xyz/anchor';
import { useWallet, ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider, WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { PhantomWalletAdapter, SolflareWalletAdapter } from '@solana/wallet-adapter-wallets';
import '@solana/wallet-adapter-react-ui/styles.css';

// --- PRODUCTION CONFIGURATION ---
const PROGRAM_ID = new PublicKey('BCF1111111111111111111111111111111111111111'); // Placeholder
const NETWORK = 'devnet'; // Change to 'mainnet-beta' for production
const COMMITMENT = 'processed';

const MatrixBoard = ({ selectedNumber, onSelect }) => {
  return (
    <div className="matrix-grid">
      {Array.from({ length: 100 }, (_, i) => (
        <button
          key={i}
          onClick={() => onSelect(i)}
          className={`matrix-cell ${selectedNumber === i ? 'active' : ''}`}
        >
          {i.toString().padStart(2, '0')}
        </button>
      ))}
    </div>
  );
};

const MainApp = () => {
  const { publicKey, connected, sendTransaction } = useWallet();
  const [showCreate, setShowCreate] = useState(false);
  const [selectedNumber, setSelectedNumber] = useState(null);
  const [raffles, setRaffles] = useState([]);
  const [loading, setLoading] = useState(false);

  // Initial Data Load (Mocking the connection until BCF is deployed)
  useEffect(() => {
    // In production, we would call program.account.raffle.all()
    const mockRaffles = [
      { 
        id: '1', 
        description: 'Bags Official Launch Raffle', 
        prizeAmount: 1000, 
        ticketPrice: 10, 
        status: 'Active', 
        endTime: Date.now() + 3600000,
        totalTickets: 42
      }
    ];
    setRaffles(mockRaffles);
  }, []);

  const handleCreateRaffle = async (formData) => {
    if (!connected) return alert("Connect Wallet first");
    setLoading(true);
    try {
      // In production:
      // const [rafflePda] = PublicKey.findProgramAddressSync([Buffer.from("raffle"), ...], PROGRAM_ID);
      // await program.methods.initializeRaffle(...).accounts({ raffle: rafflePda, ... }).rpc();
      console.log("Initializing Raffle on-chain...");
      setShowCreate(false);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  const [showCexBridge, setShowCexBridge] = useState(false);
  const [txid, setTxid] = useState('');
  
  const activeRaffle = {
    id: 1,
    description: "Decentralized Creator Funding #001",
    prizePool: 10000,
    ticketPrice: 100,
    ticketsSold: 14,
    totalTickets: 100,
    endTime: Date.now() + 3600000,
    probability: (1 / 100 * 100).toFixed(1)
  };

  const recentPayouts = [
    { id: 1, user: 'bags...42x', win: '10,000 $BAGS', num: '07', type: 'win' },
    { id: 2, user: 'bcf...11a', num: '64', type: 'rollover', status: 'Rolled Over' }
  ];

  return (
    <div className="min-h-screen relative overflow-hidden selection:bg-brand-purple/30">
      {/* Animated Background Blobs */}
      <div className="bg-blobs">
        <div className="blob blob-1" />
        <div className="blob blob-2" />
      </div>

      <nav className="glass-panel sticky top-0 z-50 px-8 py-4 border-b border-white/5 mx-4 mt-4 !rounded-3xl">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-gradient-to-br from-brand-purple to-[#6d28d9] rounded-2xl flex items-center justify-center shadow-2xl shadow-brand-purple/30 transform hover:rotate-6 transition-transform">
              <TrendingUp className="text-white w-7 h-7" />
            </div>
            <div>
              <h1 className="text-2xl font-extrabold tracking-tighter text-white leading-none">
                BagsCreator<span className="text-gradient">Fund</span>
              </h1>
              <div className="flex items-center gap-2 mt-1">
                <div className="w-1.5 h-1.5 rounded-full bg-brand-green animate-pulse" />
                <p className="text-[9px] font-bold uppercase tracking-[0.25em] text-gray-500 italic">
                  Risk-Based Funding Infrastructure
                </p>
              </div>
            </div>
          </div>
          
          <div className="flex items-center gap-8">
            <button 
              onClick={() => setShowCexBridge(!showCexBridge)}
              className="flex items-center gap-2 bg-white/5 hover:bg-white/10 px-4 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest text-[#94a3b8] transition-all border border-white/5"
            >
              <ArrowRightLeft className="w-4 h-4 text-brand-green" /> CEX Bridge Explorer
            </button>
            <WalletMultiButton className="!bg-brand-purple !h-11 !rounded-2xl !text-[11px] !font-bold !px-6 border-none hover:!scale-105 transition-all shadow-xl shadow-brand-purple/20" />
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto p-8 lg:p-12">
        <div className="flex flex-col lg:flex-row gap-12">
          {/* Main Interaction Area */}
          <div className="lg:w-2/3 space-y-12">
            <header className="space-y-6">
              <div className="inline-flex items-center gap-2 bg-brand-purple/10 text-brand-purple text-[10px] font-bold px-4 py-2 rounded-full uppercase tracking-widest border border-brand-purple/20">
                <Coins className="w-3.5 h-3.5" /> Featured Funding Campaign
              </div>
              <h1 className="text-7xl font-extrabold tracking-tighter leading-[0.9] text-white max-w-2xl">
                {activeRaffle.description}
              </h1>
              <p className="text-gray-400 max-w-xl text-lg font-medium leading-relaxed italic">
                Creator bootstrapping via risk. No traditional gatekeepers. High-risk, high-reward funding for the next generation of Bags builders.
              </p>
            </header>

            <AnimatePresence mode="wait">
              {showCexBridge ? (
                <motion.div 
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  className="glass-panel p-10 border-brand-green/20 relative"
                >
                  <div className="absolute top-0 right-0 p-8 opacity-5">
                    <QrCode className="w-40 h-40" />
                  </div>
                  
                  <div className="flex items-start gap-6 mb-8">
                     <div className="w-14 h-14 bg-brand-green/10 rounded-2xl flex items-center justify-center border border-brand-green/20">
                        <Shield className="w-8 h-8 text-brand-green" />
                     </div>
                     <div>
                        <h3 className="text-2xl font-bold text-white tracking-tight">Direct Deposit (CEX Bridge)</h3>
                        <p className="text-gray-500 text-sm">Deposit $BAGS directly from Binance or Coinbase.</p>
                     </div>
                  </div>

                  <div className="grid md:grid-cols-2 gap-8">
                     <div className="space-y-6">
                        <div className="p-6 bg-black/40 rounded-3xl border border-white/5">
                           <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Vault Address</p>
                           <div className="flex items-center justify-between gap-4">
                              <code className="text-brand-green text-sm font-mono truncate">BCF_VAULT_7x9...2W1</code>
                              <button className="p-2 hover:bg-white/5 rounded-lg text-gray-500 hover:text-white transition-colors">
                                 <Copy className="w-4 h-4" />
                              </button>
                           </div>
                        </div>

                        <div className="p-6 bg-red-500/10 rounded-3xl border border-red-500/20">
                           <div className="flex items-center gap-3 mb-2">
                              <AlertCircle className="w-5 h-5 text-red-500" />
                              <p className="text-[10px] font-extrabold text-red-500 uppercase tracking-widest">Mandatory Memo ID</p>
                           </div>
                           <p className="text-2xl font-bold text-red-500 font-mono">10294</p>
                           <p className="text-[9px] text-red-500/60 font-bold uppercase mt-2 leading-relaxed">
                              Funds sent without this MEMO will be marked as "Unassigned" until claimed manually.
                           </p>
                        </div>
                     </div>

                     <div className="glass-panel p-6 bg-white/5">
                        <h4 className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-4 italic">Manual Claim System</h4>
                        <p className="text-[10px] text-gray-500 mb-6">If your deposit didn't show up, enter your Transaction ID below:</p>
                        <input 
                           type="text" 
                           placeholder="Enter TXID / Hash" 
                           className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-xs mb-4 focus:border-brand-purple transition-colors font-mono"
                           value={txid}
                           onChange={(e) => setTxid(e.target.value)}
                        />
                        <button className="btn-premium w-full !py-3 !text-[10px] !tracking-widest">
                           CLAIM FUNDING POSITION
                        </button>
                     </div>
                  </div>
                </motion.div>
              ) : (
                <motion.div 
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.98 }}
                  className="glass-panel p-10"
                >
                  <div className="flex justify-between items-center mb-10">
                    <h3 className="text-[11px] font-bold uppercase tracking-widest text-gray-500 flex items-center gap-2 font-mono">
                       <QrCode className="w-4 h-4" /> Matrix (00-99) • Odds 1/100
                    </h3>
                    <div className="flex items-center gap-3 bg-brand-green/10 px-4 py-2 rounded-xl text-brand-green font-bold text-xs border border-brand-green/20">
                      <Clock className="w-4 h-4" /> Closing in 42:15
                    </div>
                  </div>
                  
                  <div className="matrix-container">
                    {Array.from({ length: 100 }, (_, i) => (
                      <div
                        key={i}
                        onClick={() => setSelectedNumber(i)}
                        className={`matrix-item ${selectedNumber === i ? 'selected' : ''}`}
                      >
                        {i.toString().padStart(2, '0')}
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Sidebar - Financial & Social Proof */}
          <aside className="lg:w-1/3 space-y-8">
            <div className="glass-panel p-8">
              <h3 className="text-[11px] font-bold uppercase tracking-widest text-gray-500 mb-8 font-mono">Live Metrics</h3>
              <div className="space-y-6">
                <div>
                  <div className="flex justify-between items-end mb-2">
                    <span className="text-[10px] uppercase font-extrabold text-gray-500 tracking-tighter">Funding Progress</span>
                    <span className="text-sm font-bold text-white">{activeRaffle.ticketsSold} / {activeRaffle.totalTickets}</span>
                  </div>
                  <div className="w-full h-2 bg-white/5 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-gradient-to-r from-brand-purple to-brand-green" 
                      style={{ width: `${(activeRaffle.ticketsSold / activeRaffle.totalTickets) * 100}%` }}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 bg-white/5 rounded-2xl border border-white/5">
                    <p className="text-[9px] uppercase font-bold text-gray-500 mb-1 tracking-widest">Prize Pool</p>
                    <p className="text-lg font-bold text-brand-green">{activeRaffle.prizePool} $BAGS</p>
                  </div>
                  <div className="p-4 bg-white/5 rounded-2xl border border-white/5">
                    <p className="text-[9px] uppercase font-bold text-gray-500 mb-1 tracking-widest">Risk Fee</p>
                    <p className="text-lg font-bold text-white">{FEE_PERCENT}%</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="glass-panel p-10 bg-brand-purple/10 border-brand-purple/30">
               {selectedNumber !== null ? (
                 <div className="space-y-6">
                   <div>
                     <p className="text-[10px] font-bold uppercase text-brand-purple mb-1">Selected Funding Slot</p>
                     <p className="text-4xl font-extrabold text-white leading-none">Number {selectedNumber.toString().padStart(2, '0')}</p>
                   </div>
                   <div className="p-4 bg-white/5 rounded-2xl text-[10px] leading-relaxed italic text-gray-400">
                     Participating in risk-based funding for "{activeRaffle.description}". All transactions are final and secured by Switchboard VRF.
                   </div>
                   <button 
                      className="btn-premium w-full text-xs font-bold"
                      onClick={() => alert(`Contributing ${activeRaffle.ticketPrice} $BAGS...`)}
                   >
                     CONTRIBUTE {activeRaffle.ticketPrice} $BAGS
                   </button>
                 </div>
               ) : (
                 <div className="flex flex-col items-center justify-center py-10 text-center space-y-4 opacity-70">
                   <Info className="w-10 h-10 text-brand-purple/50" />
                   <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-500">Select a slot or explore the CEX Bridge</p>
                 </div>
               )}
            </div>

            <div className="glass-panel p-8">
              <div className="flex items-center justify-between mb-8">
                <h3 className="text-[11px] font-bold uppercase tracking-widest flex items-center gap-2">
                   <History className="w-4 h-4 text-brand-purple" /> Resolved Rounds
                </h3>
              </div>
              
              <div className="space-y-4">
                {recentPayouts.map((item) => (
                  <div key={item.id} className="flex justify-between items-center p-4 bg-white/[0.03] rounded-2xl hover:bg-white/5 transition-all">
                    <div className="flex items-center gap-4">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold text-sm ${item.type === 'win' ? 'bg-brand-green text-black' : 'bg-white/10 text-gray-500'}`}>
                        {item.num}
                      </div>
                      <div>
                        <p className={`text-xs font-bold ${item.type === 'win' ? 'text-white' : 'text-gray-500'}`}>{item.win || item.status}</p>
                        <p className="text-[9px] text-gray-500 font-mono">{item.user}</p>
                      </div>
                    </div>
                    <ExternalLink className="w-3.5 h-3.5 text-gray-700" />
                  </div>
                ))}
              </div>
            </div>
               </button>
            </div>
          </aside>
        </div>
      </main>

      {showCreate && (
        <CreateRaffleModal 
          onClose={() => setShowCreate(false)} 
          onCreate={handleCreateRaffle}
          isLoading={loading}
        />
      )}
      
      <footer className="glass mt-20 px-12 py-10 border-t border-white/5">
         <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-8">
            <div className="text-center md:text-left">
              <p className="text-[10px] font-black uppercase tracking-[0.3em] text-gray-600 mb-2">BagsCreatorFund Ecosystem</p>
              <p className="text-[9px] text-gray-700 italic">Built for the future of creator funding. All rights reserved 2026.</p>
            </div>
            <div className="flex gap-10">
               {['Documentation', 'Governance', 'Security Audit', 'Twitter'].map(link => (
                 <a key={link} href="#" className="text-[9px] font-black uppercase tracking-widest text-gray-500 hover:text-brand-primary transition-colors">{link}</a>
               ))}
            </div>
         </div>
      </footer>
    </div>
  );
};

const CreateRaffleModal = ({ onClose, onCreate, isLoading }) => {
  const [step, setStep] = useState(1);
  const [formData, setFormData] = useState({ prize: 1000, price: 10, duration: 1, desc: "Alpha creator raffle" });

  return (
    <div className="fixed inset-0 z-200 flex items-center justify-center p-6 bg-black/90 backdrop-blur-md">
      <div className="glass-card shadow-4xl rounded-[2.5rem] w-full max-w-2xl p-12 border border-white/10 relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-brand-primary via-brand-secondary to-brand-primary animate-pulse" />
        
        <div className="flex justify-between items-center mb-10">
          <h2 className="text-3xl font-black uppercase tracking-tighter italic">
            Initialize <span className="text-brand-primary">Capital Fund</span>
          </h2>
          <button onClick={onClose} className="p-2 hover:bg-white/5 rounded-full transition-colors">
            <X className="w-6 h-6 text-gray-500" />
          </button>
        </div>

        {step === 1 ? (
          <div className="space-y-8">
            <div className="grid grid-cols-2 gap-8">
              <div className="space-y-3">
                <label className="text-[10px] font-black uppercase text-gray-500 tracking-tighter">Initial Prize ($BAGS)</label>
                <div className="relative">
                  <input 
                    type="number" 
                    value={formData.prize} 
                    onChange={(e) => setFormData({...formData, prize: e.target.value})}
                    className="w-full bg-white/5 border border-white/10 p-5 rounded-2xl text-xl font-black italic outline-none focus:border-brand-primary transition-all pr-16"
                  />
                  <Coins className="absolute right-5 top-1/2 -translate-y-1/2 w-6 h-6 text-brand-primary opacity-50" />
                </div>
              </div>
              <div className="space-y-3">
                <label className="text-[10px] font-black uppercase text-gray-500 tracking-tighter">Ticket Price</label>
                <input 
                  type="number" 
                  value={formData.price} 
                  onChange={(e) => setFormData({...formData, price: e.target.value})}
                  className="w-full bg-white/5 border border-white/10 p-5 rounded-2xl text-xl font-black italic outline-none focus:border-brand-primary transition-all"
                />
              </div>
            </div>

            <div className="space-y-3">
               <label className="text-[10px] font-black uppercase text-gray-500 tracking-tighter">Objective Description</label>
               <textarea 
                  value={formData.desc}
                  onChange={(e) => setFormData({...formData, desc: e.target.value})}
                  className="w-full bg-white/5 border border-white/10 p-5 rounded-2xl text-sm italic outline-none focus:border-brand-primary h-24"
                  placeholder="Why are you raising funds?"
               />
            </div>

            <button 
              onClick={() => setStep(2)}
              className="w-full btn-primary flex items-center justify-center gap-3 text-sm font-black uppercase tracking-[0.2em] py-5 shadow-2xl shadow-brand-primary/40"
            >
              Continue to Funding <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <div className="space-y-10 py-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
             <div className="flex flex-col items-center gap-4">
                <div className="p-6 bg-white rounded-3xl shadow-2xl">
                   <QrCode className="w-40 h-40 text-black" />
                </div>
                <div className="flex items-center gap-2 bg-brand-secondary/10 px-4 py-2 rounded-full border border-brand-secondary/20">
                   <div className="w-1.5 h-1.5 rounded-full bg-brand-secondary animate-ping" />
                   <span className="text-[10px] font-black text-brand-secondary uppercase tracking-widest">Awaiting Deposit</span>
                </div>
             </div>

             <div className="space-y-8">
               <div className="memo-box space-y-3 bg-red-500/5 border-red-500/20">
                  <p className="font-black text-xs uppercase flex items-center justify-center gap-3 text-red-400">
                    <AlertCircle className="w-5 h-5" /> Mandatory Memo Reference
                  </p>
                  <p className="bg-black/40 p-4 rounded-xl font-mono text-center text-lg text-white border border-white/10 select-all cursor-pointer hover:bg-black/60 transition-colors">
                    bcf_raffle_4821_9f3a
                  </p>
                  <p className="text-[10px] text-red-400/70 text-center leading-relaxed italic px-4">
                    Crucial for CEX users (Binance/Coinbase). Funds sent without this memo will be marked as "Unassigned" and require manual TXID claim.
                  </p>
               </div>

               <div className="bg-white/[0.03] p-6 rounded-3xl border border-white/10 space-y-4">
                  <div className="flex justify-between items-center">
                     <span className="text-[10px] font-black text-gray-600 uppercase">Deposit Amount</span>
                     <span className="text-xl font-black italic">{formData.prize} $BAGS</span>
                  </div>
                  <div className="flex justify-between items-center pt-4 border-t border-white/5">
                     <span className="text-[10px] font-black text-gray-600 uppercase">PDA Vault</span>
                     <span className="text-[10px] font-mono text-brand-secondary break-all">BCF_Vault...yU9W</span>
                  </div>
               </div>
             </div>

             <button 
               onClick={onCreate}
               disabled={isLoading}
               className="w-full btn-primary py-5 text-sm uppercase font-black"
             >
               {isLoading ? "Verifying On-Chain..." : "I've Sent the Funds"}
             </button>
          </div>
        )}
      </div>
    </div>
  );
};

const BCFAppWrapper = () => {
    const network = 'devnet';
    const endpoint = useMemo(() => clusterApiUrl(network), [network]);
    const wallets = useMemo(() => [new PhantomWalletAdapter(), new SolflareWalletAdapter()], []);

    return (
        <ConnectionProvider endpoint={endpoint}>
            <WalletProvider wallets={wallets} autoConnect>
                <WalletModalProvider>
                    <MainApp />
                </WalletModalProvider>
            </WalletProvider>
        </ConnectionProvider>
    );
};

export default BCFAppWrapper;
