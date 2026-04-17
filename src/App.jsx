import React, { useState, useEffect, useMemo } from 'react';
import { 
  Connection, 
  PublicKey, 
  Transaction, 
  TransactionInstruction,
  SystemProgram, 
  LAMPORTS_PER_SOL,
  clusterApiUrl,
  SYSVAR_RENT_PUBKEY,
  Keypair
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
  ArrowLeft,
  Layout,
  DollarSign,
  Users,
  Trophy,
  Heart,
  Wallet,
  Building,
  ArrowRight,
  Zap,
  Gem,
  X,
  CreditCard,
  Target,
  Globe,
  Link
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import * as anchor from "@coral-xyz/anchor";

// IDL Import
import idl from './bcf_core.json';

// Component Imports
import RaffleCard from './components/raffle/RaffleCard';
import ResultsSidebar from './components/ResultsSidebar';

// Solana Styles
import '@solana/wallet-adapter-react-ui/styles.css';

// Program Constants
const PROGRAM_ID = new PublicKey('BCF1111111111111111111111111111111111111111');

const PLATFORMS = [
  { id: 'binance', name: 'Binance', fee: 0.30, icon: Building },
  { id: 'coinbase', name: 'Coinbase', fee: 0.00, icon: Building },
  { id: 'phantom', name: 'Phantom / Wallet', fee: 0.000005, icon: Wallet },
];

const MainApp = () => {
  const { connection } = useConnection();
  const { publicKey, connected } = useWallet();
  const [raffles, setRaffles] = useState([]);
  const [selectedRaffle, setSelectedRaffle] = useState(null);
  const [selectedNumber, setSelectedNumber] = useState(null);
  const [showCexBridge, setShowCexBridge] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedPlatform, setSelectedPlatform] = useState(PLATFORMS[0]);
  const [loading, setLoading] = useState(true);

  // Form State
  const [prizeAmount, setPrizeAmount] = useState(100);
  const [ticketPrice, setTicketPrice] = useState(5);
  const [duration, setDuration] = useState(3600);
  const [description, setDescription] = useState("");
  const [donationAddr, setDonationAddr] = useState("");

  const program = useMemo(() => {
    try {
      if (!idl || !PROGRAM_ID) return null;
      return new anchor.Program(idl, PROGRAM_ID, { connection });
    } catch (err) {
      console.error("Critical: Failed to initialize Anchor Program", err);
      return null;
    }
  }, [connection]);

  useEffect(() => {
    if (program) {
      fetchRaffles();
      const interval = setInterval(fetchRaffles, 10000); // 10s for stability
      return () => clearInterval(interval);
    } else {
      setLoading(false); // Stop loading if program is broken
    }
  }, [program]);

  const fetchRaffles = async () => {
    try {
      if (!program || !program.account || !program.account.raffle) {
        console.warn("Program not ready for fetching");
        return;
      }
      
      // REAL On-Chain Fetching
      const accounts = await program.account.raffle.all();
      
      const decodedRaffles = accounts.map((acc) => {
        const data = acc.account;
        
        let statusStr = 'active';
        if (data.status) {
          if (data.status.active) statusStr = 'active';
          else if (data.status.waitingDeposit) statusStr = 'waitingDeposit';
          else if (data.status.resolved) statusStr = 'resolved';
          else if (data.status.closed) statusStr = 'closed';
          else if (data.status.cancelled) statusStr = 'cancelled';
        }

        const ticketsSold = Array.isArray(data.slots) ? data.slots.filter(s => s !== null).length : 0;

        return {
          id: acc.publicKey.toString(),
          pubkey: acc.publicKey.toString(),
          description: data.description || "Project On-Chain",
          prizePool: data.prizeAmount ? data.prizeAmount.toNumber() / 1000000 : 0,
          ticketPrice: data.ticketPrice ? data.ticketPrice.toNumber() / 1000000 : 0,
          ticketsSold: ticketsSold,
          totalTickets: 100,
          endTime: data.endTime ? data.endTime.toNumber() * 1000 : Date.now(),
          status: statusStr,
          creator: data.creator ? data.creator.toString().slice(0, 4) + '...' + data.creator.toString().slice(-4) : "---",
          winner: data.winningNumber !== null && data.winningNumber !== undefined ? data.winningNumber : null,
          donationAddress: data.donationAddress ? data.donationAddress.toString() : null,
          rawSlots: data.slots || []
        };
      });

      setRaffles(decodedRaffles);
      setLoading(false);
    } catch (err) {
      console.error("Real fetch error:", err);
      setLoading(false);
    }
  };

  const activeRaffles = raffles.filter(r => r.status !== 'resolved' && r.status !== 'cancelled' && r.status !== 'closed');
  const completedRaffles = raffles.filter(r => r.status === 'resolved');

  return (
    <div className="min-h-screen relative font-main selection:bg-brand-primary/30">
      {/* Neo-Glass Background Layers */}
      <div className="fixed inset-0 pointer-events-none -z-10">
        <div className="absolute top-[10%] left-[10%] w-[600px] h-[600px] bg-brand-primary/10 rounded-full blur-[150px] animate-pulse" />
        <div className="absolute bottom-[20%] right-[10%] w-[500px] h-[500px] bg-brand-secondary/5 rounded-full blur-[150px]" />
      </div>

      <nav className="sticky top-0 z-100 glass px-12 py-5 border-none shadow-2xl">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-4 cursor-pointer group" onClick={() => setSelectedRaffle(null)}>
            <div className="w-12 h-12 bg-gradient-to-br from-brand-primary to-purple-600 rounded-2xl flex items-center justify-center shadow-[0_0_30px_rgba(168,85,247,0.4)] group-hover:scale-110 transition-transform">
               <Gem className="text-white w-7 h-7" />
            </div>
            <div className="space-y-0.5">
              <h1 className="text-2xl font-display font-black tracking-tighter italic uppercase text-white">BAGS<span className="text-brand-primary">Fund</span></h1>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-brand-secondary shadow-[0_0_10px_#10b981]" />
                <span className="text-[9px] font-black uppercase tracking-[0.3em] text-gray-500 italic">Solana Creator Protocol</span>
              </div>
            </div>
          </div>
          
          <div className="hidden lg:flex items-center gap-12 font-black uppercase text-[10px] tracking-widest text-gray-400">
            <button 
              onClick={() => setShowCreateModal(true)}
              className="group flex items-center gap-3 text-brand-primary hover:text-white transition-all scale-105 active:scale-95"
            >
               <div className="w-8 h-8 rounded-full bg-brand-primary/10 flex items-center justify-center group-hover:bg-brand-primary/20 transition-all">
                 <Plus className="w-4 h-4" />
               </div>
               LAUNCH FUNDRAISER
            </button>
            <div className="flex items-center gap-3 opacity-60">
               <Globe className="w-3.5 h-3.5 text-brand-secondary" />
               MAINNET HUB ACTIVE
            </div>
            <WalletMultiButton className="!bg-brand-primary !h-14 !rounded-2xl !text-[10px] !font-black !px-10 hover:!brightness-110 !border-none !shadow-xl transition-all" />
          </div>
        </div>
      </nav>

      <div className="flex flex-col lg:flex-row min-h-screen">
        <main className="flex-1 p-12 lg:p-24 relative">
          <AnimatePresence mode="wait">
            {!selectedRaffle ? (
              <motion.div 
                key="grid"
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -30 }}
                className="max-w-6xl mx-auto space-y-24"
              >
                <header className="space-y-8">
                   <div className="inline-flex items-center gap-3 bg-white/5 border border-white/10 px-6 py-2 rounded-full backdrop-blur-md">
                      <Target className="w-4 h-4 text-brand-primary animate-pulse" />
                      <span className="text-[10px] font-black uppercase tracking-[0.3em] text-gray-400 italic">Community Treasury Hub</span>
                   </div>
                   <h2 className="text-8xl font-display font-black uppercase tracking-tighter italic leading-[0.85] text-white">
                     Fund your vision.<br />
                     <span className="text-brand-primary drop-shadow-[0_0_20px_rgba(168,85,247,0.3)]">Win with your community.</span>
                   </h2>
                   <p className="text-gray-500 text-lg font-main italic max-w-2xl leading-relaxed">
                     The Bags Creator Fund empowers builders to launch decentralized fundraisers. Fans participate to win big, while creators bootstrap their next world-changing project.
                   </p>
                </header>

                {loading ? (
                   <div className="h-96 flex flex-col items-center justify-center space-y-8 glass-card">
                      <Zap className="w-16 h-16 text-brand-primary animate-pulse" />
                      <div className="text-center space-y-2">
                        <p className="text-[11px] font-black uppercase tracking-[0.5em] text-brand-primary italic">Synchronizing Node</p>
                        <p className="text-[9px] font-black uppercase tracking-widest text-gray-600">Securely loading on-chain data...</p>
                      </div>
                   </div>
                ) : (
                  <div className="grid md:grid-cols-2 gap-12">
                    {activeRaffles.map((raffle) => (
                      <RaffleCard 
                        key={raffle.id} 
                        raffle={raffle} 
                        onClick={() => setSelectedRaffle(raffle)} 
                      />
                    ))}
                    {activeRaffles.length === 0 && (
                      <div 
                        className="col-span-2 glass-card p-24 text-center border-dashed border-white/10 group cursor-pointer"
                        onClick={() => setShowCreateModal(true)}
                      >
                         <div className="opacity-40 group-hover:opacity-100 transition-all space-y-6">
                            <Plus className="w-16 h-16 mx-auto text-brand-primary group-hover:rotate-90 transition-transform duration-500" />
                            <p className="text-[11px] font-black uppercase tracking-[0.3em] italic">No active fundraisers found in your programID</p>
                            <span className="inline-block text-brand-primary text-[10px] font-black tracking-widest border-b border-brand-primary pb-1">Initialize your first campaign</span>
                         </div>
                      </div>
                    )}
                  </div>
                )}
              </motion.div>
            ) : (
              <motion.div 
                key="detail"
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                className="max-w-6xl mx-auto space-y-20 pb-20"
              >
                <button 
                  onClick={() => setSelectedRaffle(null)}
                  className="flex items-center gap-3 text-[11px] font-black uppercase tracking-[0.3em] text-gray-500 hover:text-white transition-all group italic"
                >
                  <ArrowLeft className="w-5 h-5 group-hover:-translate-x-2 transition-transform" /> BACK TO POOL
                </button>

                <div className="flex flex-col lg:flex-row justify-between items-start gap-16">
                  <div className="flex-1 space-y-8">
                     <div className="flex flex-wrap gap-4">
                        <span className="glass bg-brand-primary/10 px-5 py-2 rounded-full text-[10px] font-black uppercase tracking-widest text-brand-primary shadow-lg shadow-brand-primary/10 italic">
                          ID: {selectedRaffle.pubkey.slice(0, 12)}...
                        </span>
                        <span className="glass bg-brand-secondary/10 px-5 py-2 rounded-full text-[10px] font-black uppercase tracking-widest text-brand-secondary italic">
                          Verified Creator Account
                        </span>
                     </div>
                     <h1 className="text-8xl font-display font-black uppercase italic tracking-tighter leading-[0.85] text-white">
                       {selectedRaffle.description}
                     </h1>
                     <div className="flex items-center gap-4 opacity-50">
                        <div className="w-10 h-10 rounded-full glass flex items-center justify-center font-black text-brand-primary italic text-[11px]">BC</div>
                        <span className="text-[11px] font-black uppercase tracking-[0.2em] italic">Fundraiser Lead: {selectedRaffle.creator}</span>
                     </div>
                  </div>

                  <div className="glass-card p-12 space-y-4 border-brand-secondary/30 min-w-[320px] shadow-[0_0_50px_rgba(16,185,129,0.15)]">
                     <div className="text-[11px] font-black uppercase tracking-[0.3em] text-gray-500 italic">Campaign Goal</div>
                     <div className="text-6xl font-display font-black text-brand-secondary italic tracking-tighter leading-none">
                        {selectedRaffle.prizePool} <span className="text-2xl text-white/40">$BAGS</span>
                     </div>
                     <div className="pt-6 mt-6 border-t border-white/5 space-y-4">
                        <div className="flex justify-between items-center text-[10px] font-black uppercase tracking-widest">
                           <span className="text-gray-500 italic">Ticket Cost</span>
                           <span className="text-white text-base">{selectedRaffle.ticketPrice} $BAGS</span>
                        </div>
                     </div>
                  </div>
                </div>

                <div className="grid lg:grid-cols-12 gap-20">
                   <div className="lg:col-span-8 space-y-12">
                      <div className={`glass-card p-12 relative overflow-hidden transition-all duration-700 ${selectedRaffle.status === 'resolved' ? 'grayscale opacity-70 cursor-not-allowed' : ''}`}>
                        {selectedRaffle.status === 'resolved' && (
                          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/60 backdrop-blur-[2px]">
                             <div className="glass bg-brand-primary/20 border-brand-primary/40 px-12 py-8 rounded-[3rem] text-center shadow-2xl">
                                <Trophy className="w-16 h-16 text-brand-primary mx-auto mb-6 drop-shadow-[0_0_20px_#a855f7]" />
                                <h3 className="text-6xl font-display font-black italic tracking-tighter text-white">WINNER: #{selectedRaffle.winner?.toString().padStart(2, '0')}</h3>
                                <p className="text-[11px] font-black uppercase tracking-[0.4em] text-brand-primary mt-4">CAMPAIGN RESOLVED ON-CHAIN</p>
                             </div>
                          </div>
                        )}

                        <header className="flex justify-between items-center mb-16">
                           <div className="space-y-2">
                             <h3 className="text-[11px] font-black uppercase tracking-[0.3em] text-gray-500 italic flex items-center gap-3">
                                <QrCode className="w-5 h-5 text-brand-primary" /> Matrix Slots • Total Neutrality
                             </h3>
                             <p className="text-[10px] text-gray-700 italic font-black uppercase tracking-widest leading-loose">Choose your reservation slot to participate in this bootstrap round.</p>
                           </div>
                           <div className="flex flex-col items-end">
                              <div className="flex items-center gap-3 text-brand-secondary text-[11px] font-black uppercase tracking-[0.2em] italic">
                                 <Clock className="w-4 h-4 animate-pulse" /> Finalización: 42m
                              </div>
                           </div>
                        </header>

                        <div className="matrix-10x10 shadow-inner p-2 rounded-[2rem] bg-black/20">
                          {Array.from({ length: 100 }, (_, i) => {
                            const isSold = selectedRaffle.rawSlots[i] !== null;
                            const isWinning = selectedRaffle.status === 'resolved' && selectedRaffle.winner === i;
                            return (
                              <button
                                key={i}
                                disabled={isSold || selectedRaffle.status === 'resolved'}
                                onClick={() => setSelectedNumber(i)}
                                className={`aspect-square number-grid-item !text-[10px] font-display transition-all duration-300 relative ${
                                  selectedNumber === i ? 'active scale-110 !z-20 shadow-2xl shadow-brand-primary/40' : ''
                                } ${isSold ? '!bg-white/5 !text-white/20 !border-white/5 cursor-not-allowed grayscale' : ''} ${
                                  isWinning ? '!bg-brand-primary !text-white !border-brand-primary animate-bounce scale-110 z-30' : ''
                                }`}
                              >
                                {isSold ? (isWinning ? '★' : '✕') : i.toString().padStart(2, '0')}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                   </div>

                   <aside className="lg:col-span-4 space-y-12">
                     <div className="glass-card p-12 space-y-12 relative overflow-hidden group">
                        <div className="absolute top-0 right-0 w-32 h-32 bg-brand-primary/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
                        <div className="space-y-8">
                           <div className="flex justify-between items-end">
                              <span className="text-[11px] font-black uppercase tracking-[0.3em] text-gray-500 italic">Round Velocity</span>
                              <span className="text-4xl font-display font-black text-white italic tracking-tighter">{selectedRaffle.ticketsSold}%</span>
                           </div>
                           <div className="progress-container !h-4 p-1">
                              <motion.div 
                                initial={{ width: 0 }} 
                                animate={{ width: `${selectedRaffle.ticketsSold}%` }} 
                                className="progress-fill !rounded-full shadow-[0_0_15px_rgba(168,85,247,0.5)]" 
                              />
                           </div>
                           <div className="flex justify-between text-[10px] font-black uppercase tracking-[0.2em] italic opacity-40">
                              <span>Locked: {selectedRaffle.ticketsSold} Slots</span>
                              <span>Goal: 100 Slots</span>
                           </div>
                        </div>

                        <div className="space-y-8 pt-10 border-t border-white/5">
                           {[
                             { label: "Royalty Rate", val: "5%", ico: DollarSign },
                             { label: "Reserve Pool", val: `${selectedRaffle.prizePool} BAGS`, ico: Gem },
                             { label: "Bootstrap Status", val: selectedRaffle.status.toUpperCase(), ico: Shield }
                           ].map((s, i) => (
                             <div key={i} className="flex justify-between items-center group/item hover:translate-x-1 transition-transform">
                                <div className="flex items-center gap-4">
                                   <div className="w-9 h-9 glass rounded-xl flex items-center justify-center text-brand-primary/60 group-hover/item:text-brand-primary transition-colors">
                                      <s.ico className="w-4 h-4" />
                                   </div>
                                   <span className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-500 italic">{s.label}</span>
                                </div>
                                <span className="text-[12px] font-black text-white italic">{s.val}</span>
                             </div>
                           ))}
                        </div>
                     </div>

                     <div className="space-y-6">
                        {selectedNumber !== null && selectedRaffle.status !== 'resolved' ? (
                          <motion.div 
                            initial={{ opacity: 0, scale: 0.9 }}
                            animate={{ opacity: 1, scale: 1 }}
                            className="bg-brand-primary/10 border border-brand-primary/30 rounded-[3rem] p-12 space-y-10 shadow-3xl shadow-brand-primary/10"
                          >
                             <div className="space-y-3">
                                <p className="text-[11px] font-black uppercase text-brand-primary tracking-[0.4em] italic leading-loose">Blockchain Reservation</p>
                                <p className="text-8xl font-display font-black text-white italic tracking-tighter leading-none mb-4">#{selectedNumber.toString().padStart(2, '0')}</p>
                             </div>
                             
                             <div className="space-y-4">
                                <button className="btn-primary w-full !rounded-[2rem] !py-8 !text-[12px] !font-black !uppercase !tracking-[0.3em] !shadow-2xl shadow-brand-primary/20 hover:scale-[1.02] active:scale-95 transition-all">
                                  CONFIRM WITH WEB3 WALLET
                                </button>
                                <button 
                                   onClick={() => setShowCexBridge(true)}
                                   className="w-full glass !bg-white/5 border-white/5 hover:border-white/10 rounded-[2rem] py-8 text-[11px] font-black uppercase tracking-[0.2em] text-gray-400 italic hover:text-white transition-all"
                                >
                                   PURCHASE FROM BINANCE / COINBASE
                                </button>
                             </div>
                             
                             <div className="flex items-start gap-4 p-6 glass bg-black/20 border-none rounded-3xl">
                                <Shield className="w-5 h-5 text-brand-primary shrink-0" />
                                <p className="text-[10px] text-gray-500 font-main italic leading-relaxed">
                                   Full audit trail: once confirmed, your address is hard-locked to this slot on the Solana ledger.
                                </p>
                             </div>
                          </motion.div>
                        ) : (
                          <div className={`glass-card p-12 flex flex-col items-center justify-center text-center space-y-8 min-h-[400px] ${selectedRaffle.status === 'resolved' ? 'opacity-30' : ''}`}>
                            <div className="relative">
                               <Plus className={`w-20 h-20 text-brand-primary/20 ${selectedRaffle.status !== 'resolved' ? 'animate-spin-slow' : ''}`} />
                               {selectedRaffle.status !== 'resolved' && <Zap className="w-8 h-8 text-brand-primary absolute inset-0 m-auto animate-pulse" />}
                            </div>
                            <div className="space-y-4">
                               <p className="text-[12px] font-black uppercase tracking-[0.5em] text-gray-400 italic leading-loose">
                                  {selectedRaffle.status === 'resolved' ? 'CAMPAIGN FINALIZED' : 'SELECT YOUR SEED SLOT'}
                               </p>
                               <p className="text-[10px] text-gray-700 italic font-black uppercase tracking-[0.3em] max-w-[200px] leading-relaxed mx-auto">
                                  {selectedRaffle.status === 'resolved' ? 'Wait for the next fundraiser round' : 'Pick a number from the pool above to initiate funding'}
                               </p>
                            </div>
                          </div>
                        )}
                        
                        {selectedRaffle.donationAddress && (
                           <motion.div 
                              initial={{ opacity: 0 }} 
                              animate={{ opacity: 1 }} 
                              className="glass-card p-10 !bg-brand-secondary/5 border-brand-secondary/20 flex items-center gap-6 group hover:translate-y-[-4px] transition-all cursor-pointer"
                           >
                              <div className="w-14 h-14 bg-brand-secondary/10 rounded-2xl flex items-center justify-center shrink-0 shadow-lg shadow-brand-secondary/5">
                                <Heart className="text-brand-secondary w-7 h-7" />
                              </div>
                              <div className="space-y-2">
                                <h4 className="text-[11px] font-black uppercase tracking-[0.2em] italic text-brand-secondary group-hover:text-white transition-colors">Support this Creator</h4>
                                <p className="text-[9px] text-gray-500 italic max-w-xs leading-relaxed">Direct donation address enabled for this round: {selectedRaffle.donationAddress.slice(0,18)}...</p>
                              </div>
                           </motion.div>
                        )}
                     </div>
                   </aside>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </main>

        <aside className="lg:w-1/4 min-w-[380px]">
           <ResultsSidebar completedRaffles={completedRaffles} />
        </aside>
      </div>

      <footer className="glass border-t border-white/5 px-12 py-12">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-8">
           <div className="space-y-4">
              <div className="text-[11px] font-black uppercase tracking-[0.5em] text-gray-600 italic">BAGSFund V1.0 - HACKATHON EDITION</div>
              <div className="flex gap-8 text-[9px] font-black uppercase tracking-widest text-gray-500">
                 <a href="#" className="hover:text-brand-primary transition-colors flex items-center gap-2 italic"><Globe className="w-3 h-3" /> DOCS.BAGS.FM</a>
                 <a href="#" className="hover:text-brand-primary transition-colors flex items-center gap-2 italic"><CreditCard className="w-3 h-3" /> SECURITY AUDITS</a>
                 <a href="#" className="hover:text-brand-primary transition-colors flex items-center gap-2 italic"><Link className="w-3 h-3" /> EXPLORER</a>
              </div>
           </div>
           <div className="flex items-center gap-6">
              <div className="text-right">
                <p className="text-[9px] font-black uppercase tracking-[0.2em] text-brand-primary italic">Decentralized Protocol</p>
                <p className="text-[11px] font-black text-white italic uppercase tracking-[0.3em]">Built for the Bags Hackathon</p>
              </div>
              <div className="w-px h-12 bg-white/10" />
              <div className="w-12 h-12 bg-white/5 rounded-2xl flex items-center justify-center shadow-inner">
                 <Zap className="text-brand-primary w-6 h-6 animate-pulse" />
              </div>
           </div>
        </div>
      </footer>

      {/* MODALS */}
      <AnimatePresence>
        {showCexBridge && (
          <div className="fixed inset-0 z-300 flex items-center justify-center p-8 bg-black/90 backdrop-blur-xl">
             <motion.div 
               initial={{ opacity: 0, y: 100, scale: 0.9 }}
               animate={{ opacity: 1, y: 0, scale: 1 }}
               exit={{ opacity: 0, y: 100, scale: 0.9 }}
               className="glass-card !bg-bg-surface p-16 max-w-4xl w-full space-y-16 relative shadow-[0_0_100px_rgba(0,0,0,0.8)] border-white/5"
             >
                <header className="flex justify-between items-start">
                   <div className="space-y-6">
                     <div className="inline-flex items-center gap-3 glass bg-brand-primary/10 px-6 py-2 rounded-full overflow-hidden">
                        <div className="text-brand-primary text-[11px] font-black uppercase tracking-widest italic animate-bounce">Live Bridge Active</div>
                     </div>
                     <h2 className="text-7xl font-display font-black uppercase tracking-tighter italic leading-none text-white">BINANCE / COINBASE<br /><span className="text-brand-primary">SECURE BRIDGE</span></h2>
                     <p className="text-gray-500 text-base font-main italic leading-relaxed max-w-2xl">
                        Follow these critical instructions to reserve slot <span className="text-brand-primary">#{selectedNumber?.toString().padStart(2, '0')}</span> using your exchange account. Precision is mandatory.
                     </p>
                   </div>
                   <button onClick={() => setShowCexBridge(false)} className="w-16 h-16 glass hover:bg-white/10 rounded-[2rem] flex items-center justify-center group transition-all">
                      <X className="w-8 h-8 text-gray-500 group-hover:text-white transition-colors" />
                   </button>
                </header>

                <div className="grid md:grid-cols-2 gap-16">
                   <div className="space-y-10">
                      <div className="space-y-6">
                        <p className="text-[11px] font-black uppercase tracking-[0.4em] text-gray-400 italic">Step 1: Withdrawal Setup</p>
                        <div className="glass p-10 rounded-[2.5rem] bg-black/30 border-white/5 space-y-10">
                           <div className="flex justify-between items-center group">
                              <span className="text-[11px] font-black uppercase text-gray-500 italic">Reserved Token</span>
                              <div className="flex items-center gap-3">
                                 <div className="w-8 h-8 rounded-full bg-brand-primary flex items-center justify-center shadow-lg"><Gem className="w-4 h-4 text-white" /></div>
                                 <span className="text-xl font-display font-black text-white italic tracking-tighter">$BAGS (Solana)</span>
                              </div>
                           </div>
                           <div className="flex justify-between items-center">
                              <span className="text-[11px] font-black uppercase text-gray-500 italic">Exact Recipient Amount</span>
                              <span className="text-4xl font-display font-black text-brand-secondary italic">{(selectedRaffle?.ticketPrice || 0).toFixed(2)} $BAGS</span>
                           </div>
                           <div className="p-8 bg-red-500/10 border border-red-500/20 rounded-3xl flex gap-6">
                              <AlertCircle className="w-10 h-10 text-red-500 shrink-0 mt-1" />
                              <p className="text-[11px] text-red-400 font-main italic leading-relaxed">
                                 IMPORTANT: Most exchanges deduct fees from the withdrawal. You MUST ensure the amount <span className="text-white">RECEIVED</span> is exactly {(selectedRaffle?.ticketPrice || 0).toFixed(2)}.
                              </p>
                           </div>
                        </div>
                      </div>
                   </div>

                   <div className="space-y-10">
                      <div className="space-y-6">
                         <p className="text-[11px] font-black uppercase tracking-[0.4em] text-gray-400 italic">Step 2: Destination Address</p>
                         <div className="glass-card !bg-white/5 p-10 space-y-10 border-brand-primary/20">
                            <div className="space-y-6 text-center">
                               <p className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-500 italic mb-4">Contract Direct Deposit Hash</p>
                               <div className="text-xl font-display font-black text-white break-all tracking-tighter bg-black/40 p-10 rounded-[2rem] border border-white/5 leading-relaxed selection:bg-brand-primary/40">
                                  {selectedRaffle?.pubkey}
                               </div>
                            </div>
                            <button className="btn-primary w-full !py-8 !rounded-[2rem] flex items-center justify-center gap-4 active:scale-95 transition-all">
                               <Copy className="w-5 h-5" /> COPY TARGET ADDRESS
                            </button>
                         </div>
                      </div>
                   </div>
                </div>

                <div className="flex flex-col lg:flex-row justify-between items-center gap-10 border-t border-white/5 pt-16">
                   <div className="flex items-center gap-8 opacity-40 italic">
                      <div className="flex items-center gap-3">
                         <div className="w-2 h-2 bg-brand-secondary rounded-full animate-ping" />
                         <span className="text-[10px] font-black uppercase tracking-widest text-white">Monitoring Network</span>
                      </div>
                      <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">BAGS CLOUD NODE #42X LIVE</span>
                   </div>
                   <button 
                     onClick={() => setShowCexBridge(false)}
                     className="px-16 py-6 rounded-full glass hover:bg-white/10 text-[11px] font-black uppercase tracking-[0.4em] text-white transition-all italic"
                   >
                     I HAVE SENT THE FUNDS
                   </button>
                </div>
             </motion.div>
          </div>
        )}

        {showCreateModal && (
          <div className="fixed inset-0 z-300 flex items-center justify-center p-8 bg-black/90 backdrop-blur-3xl overflow-y-auto">
             <motion.div 
               initial={{ opacity: 0, scale: 0.9, y: 50 }}
               animate={{ opacity: 1, scale: 1, y: 0 }}
               exit={{ opacity: 0, scale: 0.9, y: 50 }}
               className="glass-card !bg-bg-surface p-16 max-w-3xl w-full space-y-16 relative shadow-4xl my-auto"
             >
                <header className="flex justify-between items-start">
                   <div className="space-y-6 text-left">
                     <div className="inline-flex items-center gap-3 glass bg-brand-primary/10 px-6 py-2 rounded-full">
                        <Trophy className="w-4 h-4 text-brand-primary" />
                        <span className="text-[11px] font-black uppercase tracking-[0.3em] text-brand-primary italic">Hackathon Launchpad</span>
                     </div>
                     <h2 className="text-7xl font-display font-black uppercase tracking-tighter italic leading-none text-white">LAUNCH YOUR<br /><span className="text-brand-primary">BOOTSTRAP ROUND</span></h2>
                     <p className="text-gray-500 text-base font-main italic leading-relaxed max-w-xl">
                        Design your decentralized fundraiser. Define your goals, set your prize, and invite your community to back your vision.
                     </p>
                   </div>
                   <button onClick={() => setShowCreateModal(false)} className="w-16 h-16 glass rounded-[2rem] flex items-center justify-center hover:bg-white/5 transition-all"><X className="w-8 h-8 opacity-40" /></button>
                </header>

                <div className="grid md:grid-cols-2 gap-16">
                   <div className="space-y-12">
                      <div className="space-y-4 px-2">
                        <label className="text-[11px] font-black uppercase tracking-[0.4em] text-gray-500 italic block ml-2">Funding Goal (USDC / BAGS)</label>
                        <div className="relative group">
                           <input 
                              type="number" 
                              value={prizeAmount}
                              onChange={(e) => setPrizeAmount(e.target.value)}
                              className="w-full glass !bg-white/5 rounded-[2.5rem] p-10 text-4xl font-display font-black text-brand-secondary italic shadow-inner outline-none focus:border-brand-primary transition-all group-hover:bg-white/10"
                           />
                           <DollarSign className="absolute right-10 top-1/2 -translate-y-1/2 text-brand-secondary w-8 h-8 opacity-30 group-hover:opacity-100 transition-opacity" />
                        </div>
                      </div>
                      <div className="space-y-4 px-2">
                        <label className="text-[11px] font-black uppercase tracking-[0.4em] text-gray-500 italic block ml-2">Price Per Slot ($BAGS)</label>
                        <input 
                           type="number" 
                           value={ticketPrice}
                           onChange={(e) => setTicketPrice(e.target.value)}
                           className="w-full glass !bg-white/5 rounded-[2.5rem] p-8 text-2xl font-display font-black text-white italic shadow-inner outline-none focus:border-brand-primary transition-all hover:bg-white/10"
                        />
                      </div>
                   </div>

                   <div className="space-y-12">
                      <div className="space-y-4 px-2">
                        <label className="text-[11px] font-black uppercase tracking-[0.4em] text-gray-500 italic block ml-2">Project Vision (Pitch)</label>
                        <textarea 
                           placeholder="Describe the problem you are solving and how your community wins with you..."
                           value={description}
                           onChange={(e) => setDescription(e.target.value)}
                           className="w-full glass !bg-white/5 rounded-[2.5rem] p-8 text-lg font-main text-white italic h-44 shadow-inner outline-none focus:border-brand-primary transition-all hover:bg-white/10 resize-none"
                        />
                      </div>
                      <div className="space-y-6 pt-2">
                         <div className="flex items-center justify-between px-6 py-8 glass !bg-brand-primary/5 rounded-[2rem] border-white/5">
                            <div className="space-y-2">
                               <span className="text-[10px] font-black uppercase tracking-widest text-brand-primary italic">Donation Option</span>
                               <p className="text-[10px] text-gray-500 font-main italic">Show your support address in result page</p>
                            </div>
                            <button 
                               onClick={() => setShowDonation(!showDonation)}
                               className={`w-14 h-8 rounded-full p-1 transition-all duration-300 ${showDonation ? 'bg-brand-primary' : 'bg-white/10'}`}
                            >
                               <div className={`w-6 h-6 bg-white rounded-full transition-all duration-300 ${showDonation ? 'translate-x-6 shadow-lg shadow-brand-primary/40' : 'translate-x-0'}`} />
                            </button>
                         </div>
                         {showDonation && (
                            <motion.input 
                               initial={{ opacity: 0, scale: 0.95 }}
                               animate={{ opacity: 1, scale: 1 }}
                               type="text"
                               placeholder="Enter your SOL Donation Address..."
                               value={donationAddr}
                               onChange={(e) => setDonationAddr(e.target.value)}
                               className="w-full glass !bg-white/5 rounded-[1.5rem] p-4 text-[11px] font-black text-brand-primary italic tracking-widest outline-none focus:border-brand-primary overflow-hidden text-ellipsis"
                            />
                         )}
                      </div>
                   </div>
                </div>

                <div className="space-y-10 pt-8 border-t border-white/5">
                   <div className="p-10 glass bg-black/40 border-none rounded-[3rem] space-y-6 border border-white/5 shadow-2xl">
                      <div className="flex justify-between items-center text-3xl font-display font-black italic tracking-tighter">
                         <span className="text-gray-600 text-[11px] font-black uppercase tracking-[0.3em]">Bootstrap activation deposit</span>
                         <span className="text-white">{prizeAmount} <span className="text-brand-primary">$USDC</span></span>
                      </div>
                      <p className="text-[10px] text-gray-500 italic leading-loose text-center max-w-xl mx-auto">
                        Once you sign this transaction, the Bags protocol will allocate a unique vault for your project. You must deposit the prize pool to activate the fundraiser.
                      </p>
                   </div>
                   <button 
                     onClick={() => alert("Initializing On-Chain Fundraiser with Bags SDK Logic...")}
                     className="btn-primary w-full !rounded-[2.5rem] !py-10 !text-[12px] !font-black !uppercase !tracking-[0.5em] !shadow-3xl shadow-brand-primary/30 hover:scale-[1.01] active:scale-95 transition-all"
                   >
                     GENERATE BOOTSTRAP INSTRUCTIONS
                   </button>
                </div>
             </motion.div>
          </div>
        )}
      </AnimatePresence>
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
