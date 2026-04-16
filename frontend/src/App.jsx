import React, { useState, useEffect, useMemo } from 'react';
import { 
  Connection, 
  PublicKey, 
  Transaction, 
  SystemProgram, 
  LAMPORTS_PER_SOL,
  clusterApiUrl
} from '@solana/web3.js';
import { 
  ConnectionProvider, 
  WalletProvider, 
  useWallet, 
  useConnection 
} from '@solana/wallet-adapter-react';
import { 
  WalletModalProvider, 
  WalletMultiButton 
} from '@solana/wallet-adapter-react-ui';
import { 
  PhantomWalletAdapter, 
  SolflareWalletAdapter 
} from '@solana/wallet-adapter-wallets';
import { 
  TrendingUp, 
  Plus, 
  Coins, 
  QrCode, 
  Clock, 
  CheckCircle2, 
  History, 
  ChevronRight, 
  Shield, 
  Info,
  ExternalLink,
  AlertCircle,
  Copy,
  ArrowRightLeft,
  X
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

// Solana Styles
import '@solana/wallet-adapter-react-ui/styles.css';

// Constants
const PROGRAM_ID = new PublicKey('BCF1111111111111111111111111111111111111111');
const FEE_PERCENT = 2.5;

const MainApp = () => {
  const { publicKey, connected } = useWallet();
  const [selectedNumber, setSelectedNumber] = useState(null);
  const [showCexBridge, setShowCexBridge] = useState(false);
  const [txid, setTxid] = useState('');
  
  // Mock State for Hackathon Demo
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
    <div className="min-h-screen relative overflow-hidden selection:bg-brand-purple/30 text-white bg-[#0a0a0c]">
      {/* Background Effects */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-purple-600/10 blur-[120px] animate-pulse" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-green-600/10 blur-[120px] animate-pulse" />
      </div>

      <nav className="sticky top-4 z-50 px-8 py-4 border border-white/5 mx-4 bg-black/40 backdrop-blur-xl rounded-[2rem] shadow-2xl">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-gradient-to-br from-purple-600 to-indigo-700 rounded-2xl flex items-center justify-center shadow-2xl shadow-purple-600/20">
              <TrendingUp className="text-white w-7 h-7" />
            </div>
            <div>
              <h1 className="text-2xl font-extrabold tracking-tighter text-white leading-none">
                BagsCreator<span className="text-purple-500">Fund</span>
              </h1>
              <div className="flex items-center gap-2 mt-1">
                <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                <p className="text-[9px] font-bold uppercase tracking-[0.25em] text-gray-500 italic">
                  Risk-Based Funding Infrastructure
                </p>
              </div>
            </div>
          </div>
          
          <div className="flex items-center gap-6">
            <button 
              onClick={() => setShowCexBridge(!showCexBridge)}
              className="flex items-center gap-2 bg-white/5 hover:bg-white/10 px-4 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest text-gray-400 transition-all border border-white/5"
            >
              <ArrowRightLeft className="w-4 h-4 text-green-500" /> CEX Bridge
            </button>
            <WalletMultiButton />
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto p-8 lg:p-12">
        <div className="flex flex-col lg:flex-row gap-12">
          <div className="lg:w-2/3 space-y-12">
            <header className="space-y-6">
              <div className="inline-flex items-center gap-2 bg-purple-500/10 text-purple-400 text-[10px] font-bold px-4 py-2 rounded-full uppercase tracking-widest border border-purple-500/20">
                <Coins className="w-3.5 h-3.5" /> Featured Founding Round
              </div>
              <h1 className="text-7xl font-extrabold tracking-tighter leading-[0.9] text-white">
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
                  className="bg-white/5 backdrop-blur-xl rounded-[2.5rem] p-10 border border-green-500/20 relative overflow-hidden"
                >
                  <div className="flex items-start gap-6 mb-10">
                     <div className="w-14 h-14 bg-green-500/10 rounded-2xl flex items-center justify-center border border-green-500/20">
                        <Shield className="w-8 h-8 text-green-500" />
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
                              <code className="text-green-500 text-sm font-mono truncate uppercase">BCF_VAULT_7x9...2W1</code>
                              <button className="p-2 hover:bg-white/5 rounded-lg text-gray-500 transition-colors">
                                 <Copy className="w-4 h-4" />
                              </button>
                           </div>
                        </div>

                        <div className="p-6 bg-red-500/10 rounded-3xl border border-red-500/20">
                           <div className="flex items-center gap-3 mb-2">
                              <AlertCircle className="w-5 h-5 text-red-500" />
                              <p className="text-[10px] font-extrabold text-red-500 uppercase tracking-widest">Mandatory Memo ID</p>
                           </div>
                           <p className="text-3xl font-bold text-red-500 font-mono">10294</p>
                           <p className="text-[9px] text-red-500/60 font-bold uppercase mt-2 leading-relaxed">
                              Funds sent without this MEMO will be lost or require manual claim.
                           </p>
                        </div>
                     </div>

                     <div className="bg-white/5 rounded-3xl p-6 border border-white/5">
                        <h4 className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-4 italic">Claim Positions</h4>
                        <input 
                           type="text" 
                           placeholder="Enter Transaction ID (TXID)" 
                           className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-xs mb-4 focus:border-purple-500 transition-colors outline-none font-mono"
                           value={txid}
                           onChange={(e) => setTxid(e.target.value)}
                        />
                        <button className="w-full bg-purple-600 hover:bg-purple-700 text-white font-black py-4 rounded-xl text-[10px] uppercase tracking-widest transition-all shadow-xl shadow-purple-600/20">
                           VERIFY DEPOSIT
                        </button>
                     </div>
                  </div>
                </motion.div>
              ) : (
                <motion.div 
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.98 }}
                  className="bg-white/5 backdrop-blur-xl rounded-[2.5rem] p-10 border border-white/5 shadow-2xl"
                >
                  <div className="flex justify-between items-center mb-10">
                    <h3 className="text-[11px] font-bold uppercase tracking-widest text-gray-500 flex items-center gap-2 font-mono">
                       <QrCode className="w-4 h-4" /> Matrix (00-99) • 1/100 Odds
                    </h3>
                    <div className="flex items-center gap-3 bg-green-500/10 px-4 py-2 rounded-xl text-green-500 font-bold text-xs border border-green-500/20">
                      <Clock className="w-4 h-4" /> 42:15 Left
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-10 gap-2">
                    {Array.from({ length: 100 }, (_, i) => (
                      <button
                        key={i}
                        onClick={() => setSelectedNumber(i)}
                        className={`aspect-square rounded-lg text-[10px] font-bold transition-all flex items-center justify-center border ${
                          selectedNumber === i 
                            ? 'bg-purple-600 border-purple-400 text-white shadow-lg shadow-purple-600/40 scale-110 z-10' 
                            : 'bg-white/5 border-white/5 text-gray-500 hover:bg-white/10 hover:border-white/20'
                        }`}
                      >
                        {i.toString().padStart(2, '0')}
                      </button>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <aside className="lg:w-1/3 space-y-8">
            <div className="bg-white/5 backdrop-blur-xl rounded-[2.5rem] p-8 border border-white/5">
              <h3 className="text-[11px] font-bold uppercase tracking-widest text-gray-500 mb-8 font-mono">Round Metrics</h3>
              <div className="space-y-6">
                <div>
                  <div className="flex justify-between items-end mb-2">
                    <span className="text-[10px] uppercase font-extrabold text-gray-500 tracking-tighter">Funding Progress</span>
                    <span className="text-sm font-bold text-white">{activeRaffle.ticketsSold} / {activeRaffle.totalTickets}</span>
                  </div>
                  <div className="w-full h-2 bg-white/5 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-gradient-to-r from-purple-600 to-green-500 transition-all duration-1000" 
                      style={{ width: `${(activeRaffle.ticketsSold / activeRaffle.totalTickets) * 100}%` }}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 bg-white/5 rounded-2xl border border-white/5">
                    <p className="text-[9px] uppercase font-bold text-gray-500 mb-1 tracking-widest">Prize Pool</p>
                    <p className="text-lg font-bold text-green-500">{activeRaffle.prizePool} $BAGS</p>
                  </div>
                  <div className="p-4 bg-white/5 rounded-2xl border border-white/5">
                    <p className="text-[9px] uppercase font-bold text-gray-500 mb-1 tracking-widest">Protocol Fee</p>
                    <p className="text-lg font-bold text-white">{FEE_PERCENT}%</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-purple-600/10 backdrop-blur-xl rounded-[2.5rem] p-10 border border-purple-600/20 shadow-2xl shadow-purple-600/5">
               {selectedNumber !== null ? (
                 <div className="space-y-6">
                   <div>
                     <p className="text-[10px] font-bold uppercase text-purple-400 mb-1">Selected Funding Slot</p>
                     <p className="text-4xl font-extrabold text-white leading-none">Slot #{selectedNumber.toString().padStart(2, '0')}</p>
                   </div>
                   <div className="p-4 bg-white/5 rounded-2xl text-[10px] leading-relaxed italic text-gray-400 border border-white/5">
                     Participating in decentralized funding for creators. Secured by verifiable randomness.
                   </div>
                   <button 
                      className="w-full bg-purple-600 hover:bg-purple-700 text-white font-black py-5 rounded-2xl text-xs uppercase tracking-widest transition-all shadow-xl shadow-purple-600/30"
                      onClick={() => alert('Processing funding contribution...')}
                   >
                     RESERVE FOR {activeRaffle.ticketPrice} $BAGS
                   </button>
                 </div>
               ) : (
                 <div className="flex flex-col items-center justify-center py-10 text-center space-y-4 opacity-50">
                   <Info className="w-10 h-10 text-purple-400/50" />
                   <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-500">Select a matrix slot to begin funding</p>
                 </div>
               )}
            </div>

            <div className="bg-white/5 backdrop-blur-xl rounded-[2.5rem] p-8 border border-white/5">
              <h3 className="text-[11px] font-bold uppercase tracking-widest text-gray-500 mb-8 font-mono flex items-center gap-2">
                 <History className="w-4 h-4 text-purple-500" /> Recent Payouts
              </h3>
              <div className="space-y-4">
                {recentPayouts.map((item) => (
                  <div key={item.id} className="flex justify-between items-center p-4 bg-white/[0.03] rounded-2xl border border-white/5 hover:bg-white/5 transition-all">
                    <div className="flex items-center gap-4">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold text-sm ${item.type === 'win' ? 'bg-green-500 text-black' : 'bg-white/10 text-gray-500'}`}>
                        {item.num}
                      </div>
                      <div>
                        <p className={`text-xs font-bold ${item.type === 'win' ? 'text-white' : 'text-gray-500'}`}>{item.win || item.status}</p>
                        <p className="text-[9px] text-gray-500 font-mono">{item.user}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </aside>
        </div>
      </main>

      <footer className="max-w-7xl mx-auto px-12 py-20 mt-20 border-t border-white/5 flex flex-col items-center gap-8 opacity-50">
         <div className="flex items-center gap-4">
            <Shield className="w-5 h-5 text-gray-500" />
            <p className="text-[10px] font-bold uppercase tracking-[0.35em] text-gray-600">Verifiable Transparency Powered by Switchboard</p>
         </div>
      </footer>
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
