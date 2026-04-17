import React, { useState, useEffect, useMemo, useCallback } from 'react';
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
  Link,
  Loader2
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import * as anchor from "@coral-xyz/anchor";
import { getAssociatedTokenAddress, TOKEN_PROGRAM_ID } from "@solana/spl-token";

// IDL Import
import idl from './bcf_core.json';

// Component Imports
import RaffleCard from './components/raffle/RaffleCard';
import ResultsSidebar from './components/ResultsSidebar';

// Solana Styles
import '@solana/wallet-adapter-react-ui/styles.css';

// Program Constants
const PROGRAM_ID = new PublicKey('BCF1111111111111111111111111111111111111111');
// Generic USDC/BAGS Mint for Demo
const MINT_ADDRESS = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'); 

const MainApp = () => {
  const { connection } = useConnection();
  const { publicKey, connected, sendTransaction } = useWallet();
  const [raffles, setRaffles] = useState([]);
  const [selectedRaffle, setSelectedRaffle] = useState(null);
  const [selectedNumber, setSelectedNumber] = useState(null);
  const [showCexBridge, setShowCexBridge] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  // Creation Wizard State
  const [createStep, setCreateStep] = useState(1); // 1: Info, 2: Instructions, 3: Success
  const [newRaffleInfo, setNewRaffleInfo] = useState({
    prizeAmount: 100,
    ticketPrice: 5,
    description: "",
    donationAddr: "",
    vaultAccount: null,
    rafflePda: null
  });

  const program = useMemo(() => {
    try {
      if (!idl || !PROGRAM_ID) return null;
      const provider = new anchor.AnchorProvider(connection, { publicKey }, { preflightCommitment: 'processed' });
      return new anchor.Program(idl, PROGRAM_ID, provider);
    } catch (err) {
      console.error("Critical: Failed to initialize Anchor Program", err);
      return null;
    }
  }, [connection, publicKey]);

  const fetchRaffles = useCallback(async () => {
    try {
      if (!program) return;
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
          endTime: data.endTime ? data.endTime.toNumber() * 1000 : Date.now() + 3600000,
          status: statusStr,
          creator: data.creator.toString(),
          winner: data.winningNumber,
          donationAddress: data.donationAddress ? data.donationAddress.toString() : null,
          rawSlots: data.slots || [],
          vaultBump: data.vaultBump
        };
      });

      setRaffles(decodedRaffles);
      setLoading(false);
    } catch (err) {
      console.error("Fetch error:", err);
      setLoading(false);
    }
  }, [program]);

  useEffect(() => {
    fetchRaffles();
    const interval = setInterval(fetchRaffles, 15000);
    return () => clearInterval(interval);
  }, [fetchRaffles]);

  // Watch for vault deposits
  useEffect(() => {
    if (!newRaffleInfo.vaultAccount) return;

    const subscriptionId = connection.onAccountChange(
      newRaffleInfo.vaultAccount,
      async (accountInfo) => {
        const amount = accountInfo.data.readBigUInt64LE(64); // Simplified check for token amount
        if (Number(amount) / 1000000 >= newRaffleInfo.prizeAmount) {
          console.log("Deposit Detected! Activating...");
          await activateRaffle(newRaffleInfo.rafflePda);
        }
      },
      'confirmed'
    );

    return () => connection.removeAccountChangeListener(subscriptionId);
  }, [newRaffleInfo.vaultAccount, connection]);

  const initializeRaffle = async () => {
    if (!connected) return alert("Connect Wallet First");
    setActionLoading(true);
    try {
      const [rafflePda] = PublicKey.findProgramAddressSync(
        [Buffer.from("raffle"), publicKey.toBuffer(), Buffer.from(newRaffleInfo.description)],
        PROGRAM_ID
      );

      const [vaultPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), rafflePda.toBuffer()],
        PROGRAM_ID
      );

      const tx = await program.methods
        .initializeRaffle(
          new anchor.BN(newRaffleInfo.prizeAmount * 1000000),
          new anchor.BN(newRaffleInfo.ticketPrice * 1000000),
          new anchor.BN(3600), // 1 hour
          newRaffleInfo.description,
          newRaffleInfo.donationAddr ? new PublicKey(newRaffleInfo.donationAddr) : null
        )
        .accounts({
          raffle: rafflePda,
          vaultAccount: vaultPda,
          mint: MINT_ADDRESS,
          creator: publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .rpc();

      setNewRaffleInfo(prev => ({ ...prev, vaultAccount: vaultPda, rafflePda }));
      setCreateStep(2); // Show deposit instructions
      fetchRaffles();
    } catch (err) {
      console.error("Init Error:", err);
      alert("Failed to initialize: " + err.message);
    } finally {
      setActionLoading(false);
    }
  };

  const activateRaffle = async (rafflePda) => {
    try {
      await program.methods
        .activateRaffle()
        .accounts({
          raffle: rafflePda,
          vaultAccount: newRaffleInfo.vaultAccount,
        })
        .rpc();
      
      setCreateStep(3); // Success
      fetchRaffles();
    } catch (err) {
      console.error("Activation Error:", err);
    }
  };

  const buyTicket = async (number) => {
    if (!connected) return alert("Connect Wallet First");
    setActionLoading(true);
    try {
      const rafflePda = new PublicKey(selectedRaffle.pubkey);
      const [vaultPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), rafflePda.toBuffer()],
        PROGRAM_ID
      );

      const buyerAta = await getAssociatedTokenAddress(MINT_ADDRESS, publicKey);

      await program.methods
        .buyTicket(number)
        .accounts({
          raffle: rafflePda,
          buyer: publicKey,
          buyerTokenAccount: buyerAta,
          vaultAccount: vaultPda,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();

      alert("Ticket Purchased Successfully!");
      fetchRaffles();
      setSelectedNumber(null);
    } catch (err) {
      console.error("Buy Error:", err);
      alert("Purchase failed: " + err.message);
    } finally {
      setActionLoading(false);
    }
  };

  const activeRaffles = raffles.filter(r => r.status === 'active' || r.status === 'waitingDeposit');
  const completedRaffles = raffles.filter(r => r.status === 'resolved' || r.status === 'closed');

  return (
    <div className="min-h-screen relative font-main selection:bg-brand-primary/30 text-white overflow-x-hidden">
      {/* Dynamic Background */}
      <div className="fixed inset-0 pointer-events-none -z-10 bg-[#09090b]">
        <motion.div 
          animate={{ 
            scale: [1, 1.2, 1],
            opacity: [0.1, 0.15, 0.1] 
          }}
          transition={{ duration: 10, repeat: Infinity }}
          className="absolute top-[10%] left-[10%] w-[800px] h-[800px] bg-brand-primary/20 rounded-full blur-[180px]" 
        />
        <div className="absolute bottom-[10%] right-[10%] w-[600px] h-[600px] bg-brand-secondary/10 rounded-full blur-[150px]" />
      </div>

      <nav className="sticky top-0 z-100 glass px-8 py-6 border-b border-white/5 shadow-2xl backdrop-blur-3xl">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-6 cursor-pointer group" onClick={() => setSelectedRaffle(null)}>
            <div className="w-14 h-14 bg-gradient-to-br from-brand-primary to-purple-600 rounded-3xl flex items-center justify-center shadow-[0_0_40px_rgba(168,85,247,0.4)] group-hover:scale-110 transition-all duration-500">
               <Gem className="text-white w-8 h-8" />
            </div>
            <div className="space-y-1">
              <h1 className="text-3xl font-display font-black tracking-tighter italic uppercase">
                BAGS<span className="text-brand-primary">Fund</span>
              </h1>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-brand-secondary shadow-[0_0_10px_#10b981] animate-pulse" />
                <span className="text-[10px] font-black uppercase tracking-[0.4em] text-gray-500 italic">Solana Protocol Hub</span>
              </div>
            </div>
          </div>
          
          <div className="hidden lg:flex items-center gap-10">
            <button 
              onClick={() => setShowCreateModal(true)}
              className="group flex items-center gap-4 text-[11px] font-black uppercase tracking-widest text-brand-primary hover:text-white transition-all bg-brand-primary/10 px-6 py-3 rounded-2xl hover:bg-brand-primary/20"
            >
               <Plus className="w-4 h-4" /> LAUNCH ROUND
            </button>
            <WalletMultiButton className="!bg-brand-primary/10 !hover:bg-brand-primary !h-14 !rounded-2xl !text-[11px] !font-black !px-8 transition-all border border-brand-primary/20 hover:border-brand-primary" />
          </div>
        </div>
      </nav>

      <div className="flex flex-col lg:flex-row">
        <main className="flex-1 p-8 lg:p-20">
          <AnimatePresence mode="wait">
            {!selectedRaffle ? (
              <motion.div 
                key="grid"
                initial={{ opacity: 0, y: 40 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -40 }}
                className="max-w-7xl mx-auto space-y-24"
              >
                <header className="space-y-10">
                   <motion.div 
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="inline-flex items-center gap-4 bg-white/5 border border-white/10 px-8 py-3 rounded-full backdrop-blur-md"
                   >
                      <Target className="w-5 h-5 text-brand-primary animate-pulse" />
                      <span className="text-[11px] font-black uppercase tracking-[0.4em] text-gray-400 italic">Hackathon Bootstrap Arena</span>
                   </motion.div>
                   <h2 className="text-9xl font-display font-black uppercase tracking-tighter italic leading-[0.8] drop-shadow-2xl">
                     Build Your<br />
                     <span className="text-brand-primary bg-clip-text text-transparent bg-gradient-to-r from-brand-primary to-purple-400">Dream Fund.</span>
                   </h2>
                   <p className="text-gray-400 text-xl font-main italic max-w-3xl leading-relaxed">
                     A decentralized funding protocol where creators launch high-stakes bootstrap rounds. Back projects, win prizes, and redefine Solana creator finance.
                   </p>
                </header>

                {loading ? (
                   <div className="h-96 flex flex-col items-center justify-center space-y-8 glass-card">
                      <Loader2 className="w-16 h-16 text-brand-primary animate-spin" />
                      <p className="text-[12px] font-black uppercase tracking-[0.5em] text-brand-primary italic">Syncing Ledger...</p>
                   </div>
                ) : (
                  <div className="grid md:grid-cols-2 gap-10">
                    {activeRaffles.map((raffle) => (
                      <RaffleCard 
                        key={raffle.id} 
                        raffle={raffle} 
                        onClick={() => setSelectedRaffle(raffle)} 
                      />
                    ))}
                    <motion.div 
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      className="glass-card p-20 flex flex-col items-center justify-center border-dashed border-white/10 hover:border-brand-primary/40 group cursor-pointer h-full min-h-[400px]"
                      onClick={() => setShowCreateModal(true)}
                    >
                       <Plus className="w-16 h-16 text-brand-primary group-hover:rotate-90 transition-transform duration-700" />
                       <p className="text-[12px] font-black uppercase tracking-[0.4em] italic mt-8">Initialize New Round</p>
                    </motion.div>
                  </div>
                )}
              </motion.div>
            ) : (
              <motion.div 
                key="detail"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="max-w-7xl mx-auto space-y-16 pb-20"
              >
                <button 
                  onClick={() => setSelectedRaffle(null)}
                  className="flex items-center gap-4 text-[12px] font-black uppercase tracking-[0.4em] text-gray-500 hover:text-white transition-all group italic"
                >
                  <ArrowLeft className="w-6 h-6 group-hover:-translate-x-2 transition-transform" /> BACK TO POOL
                </button>

                <div className="flex flex-col lg:flex-row justify-between items-start gap-12">
                  <div className="flex-1 space-y-10">
                     <div className="flex gap-4">
                        <span className="glass bg-brand-primary/10 px-6 py-2 rounded-full text-[11px] font-black uppercase tracking-widest text-brand-primary italic shadow-lg">
                          PDA: {selectedRaffle.pubkey.slice(0, 8)}...
                        </span>
                        {selectedRaffle.status === 'waitingDeposit' && (
                          <span className="glass bg-yellow-500/10 px-6 py-2 rounded-full text-[11px] font-black uppercase tracking-widest text-yellow-500 italic animate-pulse">
                            Waiting Bootstrap
                          </span>
                        )}
                     </div>
                     <h1 className="text-8xl font-display font-black uppercase italic tracking-tighter leading-none">
                       {selectedRaffle.description}
                     </h1>
                     <div className="flex items-center gap-5 opacity-60 bg-white/5 w-fit px-8 py-4 rounded-3xl border border-white/5">
                        <div className="w-12 h-12 rounded-2xl glass flex items-center justify-center font-black text-brand-primary italic">BC</div>
                        <div className="space-y-1">
                          <p className="text-[12px] font-black uppercase tracking-[0.3em] italic">Project Lead</p>
                          <p className="text-[10px] text-gray-500">{selectedRaffle.creator}</p>
                        </div>
                     </div>
                  </div>

                  <div className="glass-card p-12 space-y-6 border-brand-secondary/30 min-w-[360px] shadow-3xl bg-black/40">
                     <div className="text-[12px] font-black uppercase tracking-[0.4em] text-gray-500 italic">Prize Pool Goal</div>
                     <div className="text-7xl font-display font-black text-brand-secondary italic tracking-tighter">
                        {selectedRaffle.prizePool} <span className="text-3xl text-white/30">$USDC</span>
                     </div>
                     <div className="pt-8 mt-4 border-t border-white/10 flex justify-between items-center text-[12px] font-black uppercase tracking-widest">
                        <span className="text-gray-500 italic">Ticket Fee</span>
                        <span className="text-2xl text-white">{selectedRaffle.ticketPrice} USDC</span>
                     </div>
                  </div>
                </div>

                <div className="grid lg:grid-cols-12 gap-16">
                   <div className="lg:col-span-8">
                      <div className={`glass-card p-12 relative overflow-hidden transition-all duration-1000 ${selectedRaffle.status === 'waitingDeposit' ? 'grayscale opacity-50' : ''}`}>
                        {selectedRaffle.status === 'resolved' && (
                          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="absolute inset-0 z-10 flex items-center justify-center bg-black/80 backdrop-blur-md">
                             <div className="glass bg-brand-primary/20 border-brand-primary/40 p-16 rounded-[4rem] text-center shadow-4xl scale-125">
                                <Trophy className="w-24 h-24 text-brand-primary mx-auto mb-8 drop-shadow-[0_0_30px_#a855f7]" />
                                <h3 className="text-7xl font-display font-black italic tracking-tighter text-white">#{selectedRaffle.winner?.toString().padStart(2, '0')}</h3>
                                <p className="text-[14px] font-black uppercase tracking-[0.5em] text-brand-primary mt-6">WINNER IDENTIFIED</p>
                             </div>
                          </motion.div>
                        )}

                        <header className="flex justify-between items-center mb-16">
                           <div className="space-y-3">
                             <h3 className="text-[14px] font-black uppercase tracking-[0.4em] text-brand-primary italic flex items-center gap-4">
                                <QrCode className="w-6 h-6" /> SLOT MATRIX SELECTION
                             </h3>
                             <p className="text-[11px] text-gray-500 italic font-black uppercase tracking-widest">Each slot is an immutable entry on the Solana ledger.</p>
                           </div>
                           <div className="bg-brand-primary/10 px-8 py-4 rounded-[2rem] border border-brand-primary/20">
                              <div className="flex items-center gap-4 text-brand-primary text-[14px] font-black uppercase tracking-[0.3em] italic">
                                 <Clock className="w-5 h-5 animate-pulse" /> 58:12
                              </div>
                           </div>
                        </header>

                        <div className="matrix-10x10 bg-black/40 p-10 rounded-[3rem] shadow-inner">
                          {Array.from({ length: 100 }, (_, i) => {
                            const isSold = selectedRaffle.rawSlots[i] !== null;
                            const isSelected = selectedNumber === i;
                            return (
                              <button
                                key={i}
                                disabled={isSold || selectedRaffle.status !== 'active' || actionLoading}
                                onClick={() => setSelectedNumber(i)}
                                className={`number-grid-item text-[12px] font-display ${
                                  isSelected ? 'active scale-125 z-20 shadow-2xl' : ''
                                } ${isSold ? '!bg-white/5 !text-white/10 !border-none opacity-40 grayscale cursor-not-allowed' : ''}`}
                              >
                                {isSold ? '✕' : i.toString().padStart(2, '0')}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                   </div>

                   <aside className="lg:col-span-4 space-y-12">
                      <div className="glass-card p-12 space-y-10 relative overflow-hidden bg-black/30">
                         <div className="flex justify-between items-end">
                            <span className="text-[12px] font-black uppercase tracking-[0.4em] text-gray-500 italic">Participation Velocity</span>
                            <span className="text-5xl font-display font-black italic">{selectedRaffle.ticketsSold}%</span>
                         </div>
                         <div className="progress-container !h-5 p-1 border border-white/5">
                            <motion.div 
                              initial={{ width: 0 }} 
                              animate={{ width: `${selectedRaffle.ticketsSold}%` }} 
                              className="progress-fill shadow-[0_0_20px_rgba(168,85,247,0.5)]" 
                            />
                         </div>
                         <div className="grid grid-cols-2 gap-8 pt-10 border-t border-white/5">
                            <div>
                               <p className="text-[10px] font-black uppercase tracking-widest text-gray-600 mb-2">Reserve Pool</p>
                               <p className="text-xl font-display font-black italic">{selectedRaffle.prizePool} USDC</p>
                            </div>
                            <div>
                               <p className="text-[10px] font-black uppercase tracking-widest text-gray-600 mb-2">Network Status</p>
                               <p className="text-xl font-display font-black italic text-brand-secondary">VERIFIED</p>
                            </div>
                         </div>
                      </div>

                      <div className="space-y-6">
                        {selectedNumber !== null && selectedRaffle.status === 'active' ? (
                          <motion.div 
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="bg-brand-primary/10 border border-brand-primary/40 rounded-[3rem] p-12 space-y-10 shadow-4xl"
                          >
                             <div className="space-y-4">
                                <p className="text-[12px] font-black uppercase text-brand-primary tracking-[0.5em] italic">LOCKING SLOT</p>
                                <p className="text-9xl font-display font-black italic tracking-tighter leading-none">#{selectedNumber.toString().padStart(2, '0')}</p>
                             </div>
                             
                             <div className="space-y-6">
                                <button 
                                  onClick={() => buyTicket(selectedNumber)}
                                  disabled={actionLoading}
                                  className="btn-primary w-full !py-10 !rounded-3xl hover:scale-[1.02] active:scale-95 transition-all flex items-center justify-center gap-4"
                                >
                                  {actionLoading ? <Loader2 className="animate-spin" /> : 'SECURE WITH WALLET'}
                                </button>
                                <button 
                                   onClick={() => setShowCexBridge(true)}
                                   className="w-full glass !bg-white/5 hover:bg-white/10 rounded-3xl py-8 text-[12px] font-black uppercase tracking-widest text-gray-400 italic hover:text-white transition-all"
                                >
                                   BINANCE / COINBASE BRIDGE
                                </button>
                             </div>
                          </motion.div>
                        ) : (
                          <div className="glass-card p-12 flex flex-col items-center justify-center text-center space-y-10 min-h-[400px] border border-white/5">
                             <div className="relative">
                               <Plus className={`w-28 h-28 text-brand-primary/10 ${selectedRaffle.status === 'active' ? 'animate-spin-slow' : ''}`} />
                               {selectedRaffle.status === 'active' && <Zap className="w-12 h-12 text-brand-primary absolute inset-0 m-auto animate-pulse shadow-[0_0_40px_rgba(168,85,247,0.5)]" />}
                             </div>
                             <p className="text-[14px] font-black uppercase tracking-[0.6em] text-gray-600 italic">
                                {selectedRaffle.status === 'waitingDeposit' ? 'ROUND INITIALIZING' : 'SELECT TARGET SLOT'}
                             </p>
                          </div>
                        )}
                      </div>
                   </aside>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </main>

        <aside className="lg:w-1/4 min-w-[420px] bg-black/40 backdrop-blur-3xl border-l border-white/5">
           <ResultsSidebar completedRaffles={completedRaffles} />
        </aside>
      </div>

      {/* CEX BRIDGE MODAL */}
      <AnimatePresence>
        {showCexBridge && (
          <div className="fixed inset-0 z-200 flex items-center justify-center p-8 bg-black/95 backdrop-blur-2xl">
             <motion.div 
               initial={{ opacity: 0, scale: 0.9 }}
               animate={{ opacity: 1, scale: 1 }}
               exit={{ opacity: 0, scale: 0.9 }}
               className="glass-card !bg-bg-dark p-16 max-w-5xl w-full space-y-16 shadow-[0_0_150px_rgba(0,0,0,1)] border-brand-primary/20"
             >
                <header className="flex justify-between items-start">
                   <div className="space-y-4">
                     <span className="text-brand-primary text-[14px] font-black uppercase tracking-[0.5em] italic">DIRECT EXCHANGE SETTLEMENT</span>
                     <h2 className="text-8xl font-display font-black uppercase italic tracking-tighter leading-none">CEX <span className="text-brand-primary text-6xl opacity-50">BRIDGE</span></h2>
                   </div>
                   <button onClick={() => setShowCexBridge(false)} className="w-16 h-16 glass rounded-full flex items-center justify-center hover:bg-white/10 transition-all"><X className="w-8 h-8" /></button>
                </header>

                <div className="grid md:grid-cols-2 gap-20">
                   <div className="space-y-12">
                      <div className="p-12 glass bg-black/50 rounded-[3rem] space-y-8 border-brand-secondary/20">
                         <div className="flex justify-between items-center">
                            <span className="text-[12px] font-black uppercase tracking-widest text-gray-500 italic">Token to Send</span>
                            <div className="flex items-center gap-4 text-2xl font-display font-black italic">USDC <div className="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center text-[10px] text-white">S</div></div>
                         </div>
                         <div className="flex justify-between items-center">
                            <span className="text-[12px] font-black uppercase tracking-widest text-gray-500 italic">Exact Amount</span>
                            <span className="text-5xl font-display font-black text-brand-secondary italic">{(selectedRaffle?.ticketPrice || 0).toFixed(2)}</span>
                         </div>
                         <div className="bg-red-500/10 p-8 rounded-3xl border border-red-500/20 flex gap-6">
                            <AlertCircle className="w-10 h-10 text-red-500 shrink-0" />
                            <p className="text-[11px] text-red-300 font-main italic leading-relaxed uppercase tracking-widest">Withdrawal fees must be added on top. System verifies exact arrival amount.</p>
                         </div>
                      </div>
                   </div>

                   <div className="space-y-10">
                      <div className="space-y-6">
                         <p className="text-[12px] font-black uppercase tracking-[0.4em] text-gray-500 italic ml-6">DESTINATION ADDRESS (PDA)</p>
                         <div className="glass-card !bg-white/5 p-12 space-y-10 border-brand-primary/40">
                            <div className="text-xl font-display font-black break-all text-center bg-black/60 p-10 rounded-3xl border border-white/5 select-all">
                               {selectedRaffle?.pubkey}
                            </div>
                            <button className="btn-primary w-full !py-8 !rounded-3xl flex items-center justify-center gap-4 shadow-3xl shadow-brand-primary/20">
                               <Copy className="w-6 h-6" /> COPY ADDRESS
                            </button>
                         </div>
                      </div>
                   </div>
                </div>

                <div className="flex justify-between items-center p-12 glass bg-brand-primary/5 rounded-[3rem] border-brand-primary/10">
                   <div className="flex items-center gap-8 italic">
                      <div className="flex items-center gap-3">
                         <div className="w-3 h-3 bg-brand-secondary rounded-full animate-ping" />
                         <span className="text-[12px] font-black uppercase tracking-[0.2em]">WATCHING NETWORK</span>
                      </div>
                      <span className="text-[11px] font-black uppercase text-gray-600">BAGSFUND NODE #01 ACTIVE</span>
                   </div>
                   <button onClick={() => setShowCexBridge(false)} className="px-16 py-6 rounded-full glass hover:bg-brand-primary/20 text-[12px] font-black uppercase tracking-[0.5em] transition-all">DISMISS</button>
                </div>
             </motion.div>
          </div>
        )}

        {/* CREATE RAFFLE MODAL (WIZARD) */}
        {showCreateModal && (
          <div className="fixed inset-0 z-200 flex items-center justify-center p-8 bg-black/95 backdrop-blur-3xl overflow-y-auto">
             <motion.div 
               initial={{ opacity: 0, y: 50 }} 
               animate={{ opacity: 1, y: 0 }}
               exit={{ opacity: 0, y: 30 }}
               className="glass-card !bg-bg-dark p-16 max-w-4xl w-full relative shadow-4xl my-auto"
             >
                <header className="flex justify-between items-start mb-16">
                   <div className="space-y-6">
                     <span className="text-brand-primary text-[14px] font-black uppercase tracking-[0.6em] italic">Step {createStep} of 3</span>
                     <h2 className="text-8xl font-display font-black italic tracking-tighter leading-none uppercase">
                        {createStep === 1 ? 'Configure' : createStep === 2 ? 'Fund' : 'Success'}<br />
                        <span className="text-brand-primary">Round</span>
                     </h2>
                   </div>
                   <button onClick={() => { setShowCreateModal(false); setCreateStep(1); }} className="w-16 h-16 glass rounded-full flex items-center justify-center"><X /></button>
                </header>

                {createStep === 1 && (
                  <div className="grid md:grid-cols-2 gap-16">
                    <div className="space-y-12">
                       <div className="space-y-4">
                          <label className="text-[12px] font-black uppercase tracking-[0.4em] text-gray-500 italic ml-6">Prize Pool ($USDC)</label>
                          <div className="relative group">
                             <input 
                                type="number" 
                                value={newRaffleInfo.prizeAmount}
                                onChange={(e) => setNewRaffleInfo({...newRaffleInfo, prizeAmount: e.target.value})}
                                className="w-full glass !bg-white/5 rounded-[2.5rem] p-10 text-5xl font-display font-black text-brand-secondary italic outline-none focus:border-brand-primary transition-all group-hover:bg-white/10"
                             />
                             <DollarSign className="absolute right-10 top-1/2 -translate-y-1/2 text-brand-secondary opacity-30" size={32} />
                          </div>
                       </div>
                       <div className="space-y-4">
                          <label className="text-[12px] font-black uppercase tracking-[0.4em] text-gray-500 italic ml-6">Cost Per Slot</label>
                          <input 
                              type="number" 
                              value={newRaffleInfo.ticketPrice}
                              onChange={(e) => setNewRaffleInfo({...newRaffleInfo, ticketPrice: e.target.value})}
                              className="w-full glass !bg-white/5 rounded-[2.5rem] p-8 text-2xl font-display font-black italic outline-none focus:border-brand-primary transition-all group-hover:bg-white/10"
                           />
                       </div>
                    </div>
                    <div className="space-y-12">
                       <div className="space-y-4">
                          <label className="text-[12px] font-black uppercase tracking-[0.4em] text-gray-500 italic ml-6">Pitch Description</label>
                          <textarea 
                             placeholder="Capture the community vision..."
                             value={newRaffleInfo.description}
                             onChange={(e) => setNewRaffleInfo({...newRaffleInfo, description: e.target.value})}
                             className="w-full glass !bg-white/5 rounded-[2.5rem] p-10 text-lg font-main italic h-48 outline-none focus:border-brand-primary transition-all group-hover:bg-white/10 resize-none"
                          />
                       </div>
                       <button 
                          onClick={initializeRaffle}
                          disabled={actionLoading}
                          className="btn-primary w-full !py-10 !rounded-[2.5rem] text-[14px] flex items-center justify-center gap-4"
                       >
                          {actionLoading ? <Loader2 className="animate-spin" /> : 'INITIALIZE ON-CHAIN PDA'}
                       </button>
                    </div>
                  </div>
                )}

                {createStep === 2 && (
                  <div className="space-y-12 animate-in fade-in slide-in-from-bottom-5 duration-700">
                     <div className="bg-yellow-500/10 border border-yellow-500/30 p-12 rounded-[3.5rem] space-y-10">
                        <div className="flex flex-col md:flex-row justify-between items-center gap-10">
                           <div className="space-y-4 flex-1">
                              <h3 className="text-[14px] font-black uppercase tracking-[0.5em] text-yellow-500 italic">BOOTSTRAP DEPOSIT REQUIRED</h3>
                              <p className="text-gray-400 font-main italic leading-relaxed">System is watching for the following deposit to activate the round. Once detected, the round starts automatically.</p>
                           </div>
                           <div className="text-right">
                              <p className="text-8xl font-display font-black text-white italic tracking-tighter leading-none">{newRaffleInfo.prizeAmount} <span className="text-2xl opacity-40">USDC</span></p>
                           </div>
                        </div>
                        <div className="p-10 glass !bg-black/50 border-white/10 rounded-[2.5rem]">
                           <div className="text-[11px] font-black uppercase tracking-[0.4em] text-gray-600 mb-6 text-center">TARGET VAULT PDA ADDRESS</div>
                           <div className="text-xl font-display font-black break-all text-center select-all">{newRaffleInfo.vaultAccount?.toString()}</div>
                        </div>
                     </div>
                     <div className="flex flex-col items-center gap-8 py-10">
                        <Loader2 className="w-12 h-12 text-brand-primary animate-spin" />
                        <div className="text-center space-y-2">
                           <p className="text-[12px] font-black uppercase tracking-[0.4em] text-brand-primary">MONITORING LEDGER</p>
                           <p className="text-[10px] text-gray-600 font-black uppercase tracking-widest italic">Round activates instantly upon funding verification</p>
                        </div>
                     </div>
                  </div>
                )}

                {createStep === 3 && (
                   <div className="text-center space-y-12 py-20 animate-in zoom-in duration-1000">
                      <div className="w-32 h-32 bg-brand-secondary/20 rounded-full flex items-center justify-center mx-auto shadow-4xl shadow-brand-secondary/30">
                         <CheckCircle2 className="w-16 h-16 text-brand-secondary" />
                      </div>
                      <div className="space-y-4">
                         <h3 className="text-7xl font-display font-black italic tracking-tighter uppercase">ROUND ACTIVATED</h3>
                         <p className="text-gray-500 text-[14px] font-black uppercase tracking-[0.4em] italic">Fundraising pool is now open to the public</p>
                      </div>
                      <button 
                         onClick={() => { setShowCreateModal(false); setCreateStep(1); }}
                         className="btn-primary px-20 py-8 !rounded-[2.5rem]"
                      >
                         ENTER HUB
                      </button>
                   </div>
                )}
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
