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
  Loader2,
  FileText,
  Sparkles,
  ChevronDown
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
  const wallet = useWallet();
  const { publicKey, connected } = wallet;
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
      if (!idl || !PROGRAM_ID || !wallet.publicKey) return null;
      const provider = new anchor.AnchorProvider(connection, wallet, { preflightCommitment: 'processed' });
      return new anchor.Program(idl, PROGRAM_ID, provider);
    } catch (err) {
      console.error("Critical: Failed to initialize Anchor Program", err);
      return null;
    }
  }, [connection, wallet]);

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

  const [vaultBalance, setVaultBalance] = useState(0);

  // Watch for vault deposits
  useEffect(() => {
    if (!newRaffleInfo.vaultAccount) return;

    // Initial check
    connection.getTokenAccountBalance(newRaffleInfo.vaultAccount).then(bal => {
      setVaultBalance(Number(bal.value.amount) / 1000000);
    }).catch(() => setVaultBalance(0));

    const subscriptionId = connection.onAccountChange(
      newRaffleInfo.vaultAccount,
      async (accountInfo) => {
        // Simple token amount decoding (layout: 32 mint, 32 owner, 8 amount, ...)
        const amount = accountInfo.data.readBigUInt64LE(64); 
        const amountNum = Number(amount) / 1000000;
        setVaultBalance(amountNum);

        if (amountNum >= newRaffleInfo.prizeAmount) {
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
      <div className="fixed inset-0 pointer-events-none -z-10 overflow-hidden bg-[#030712]">
        <motion.div 
          animate={{ 
            scale: [1, 1.2, 1],
            opacity: [0.1, 0.15, 0.1] 
          }}
          transition={{ duration: 10, repeat: Infinity }}
          className="absolute top-[-10%] right-[-10%] w-[800px] h-[800px] bg-brand-primary/10 rounded-full blur-[180px]" 
        />
        <div className="absolute bottom-[-10%] left-[-10%] w-[600px] h-[600px] bg-brand-secondary/5 rounded-full blur-[150px]" />
      </div>

      <nav className="sticky top-0 z-100 glass px-12 py-6 shadow-2xl backdrop-blur-3xl">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-6 cursor-pointer group" onClick={() => setSelectedRaffle(null)}>
            <div className="w-14 h-14 bg-gradient-to-br from-brand-primary to-purple-600 rounded-2xl flex items-center justify-center shadow-[0_0_40px_rgba(168,85,247,0.4)] transition-all duration-500 group-hover:scale-110">
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
            <div className="flex items-center gap-6">
              <WalletMultiButton className="!bg-brand-primary !h-12 !px-8 !rounded-2xl !text-[10px] !font-black !uppercase !tracking-widest !border-none !shadow-lg !shadow-brand-primary/20 transition-all hover:!scale-105" />
              <button 
                onClick={() => setShowCreateModal(true)}
                className="w-12 h-12 bg-brand-primary rounded-2xl flex items-center justify-center text-white shadow-lg shadow-brand-primary/20 transition-all hover:scale-110 active:scale-95"
              >
                <Plus className="w-6 h-6" />
              </button>
            </div>
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
                <header className="space-y-12">
                   <motion.div 
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="inline-flex items-center gap-4 bg-white/5 border border-white/10 px-8 py-3 rounded-full backdrop-blur-md"
                   >
                      <Target className="w-5 h-5 text-brand-primary animate-pulse" />
                      <span className="text-[11px] font-black uppercase tracking-[0.4em] text-gray-400 italic">Infrastructure Arena</span>
                   </motion.div>
                   <h2 className="text-[9.5rem] font-display font-black uppercase tracking-tighter italic leading-[0.75] drop-shadow-2xl">
                     Build Your<br />
                     <span className="text-brand-primary bg-clip-text text-transparent bg-gradient-to-r from-brand-primary via-purple-400 to-brand-secondary">Dream Fund.</span>
                   </h2>
                   <p className="text-gray-500 text-2xl font-main italic max-w-4xl leading-relaxed">
                     A decentralized funding protocol where creators launch high-stakes rounds. Back projects, secure prizes, and redefine the Solana creator economy.
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
                  <div className="flex-1 space-y-12">
                     <div className="flex gap-6">
                        <span className="glass bg-brand-primary/10 px-8 py-3 rounded-full text-[12px] font-black uppercase tracking-[0.3em] text-brand-primary italic shadow-[0_0_20px_rgba(168,85,247,0.2)]">
                          PDA: {selectedRaffle.pubkey.slice(0, 12)}...
                        </span>
                        {selectedRaffle.status === 'waitingDeposit' && (
                          <span className="glass bg-yellow-500/10 px-8 py-3 rounded-full text-[12px] font-black uppercase tracking-[0.4em] text-yellow-500 italic animate-pulse">
                            AWAITING FUNDING
                          </span>
                        )}
                     </div>
                     <h1 className="text-[10rem] font-display font-black uppercase italic tracking-tighter leading-[0.75] drop-shadow-3xl">
                       {selectedRaffle.description}
                     </h1>
                     <div className="flex items-center gap-6 opacity-60 bg-white/5 w-fit px-10 py-6 rounded-[2.5rem] border border-white/5 hover:bg-white/10 transition-all">
                        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-brand-primary/20 to-brand-primary/10 flex items-center justify-center font-black text-brand-primary italic text-xl border border-brand-primary/20">BC</div>
                        <div className="space-y-1">
                          <p className="text-[14px] font-black uppercase tracking-[0.4em] italic text-gray-400">Project Architect</p>
                          <p className="text-[11px] text-gray-500 font-mono tracking-widest">{selectedRaffle.creator}</p>
                        </div>
                     </div>
                  </div>

                  <div className="glass-card p-16 space-y-10 border-brand-secondary/20 min-w-[420px] shadow-4xl bg-black/60 relative overflow-hidden group">
                     <div className="absolute top-0 right-0 w-32 h-32 bg-brand-secondary/5 rounded-full blur-3xl group-hover:bg-brand-secondary/10 transition-all duration-1000" />
                     <div className="text-[14px] font-black uppercase tracking-[0.6em] text-gray-500 italic">Target Liquidity</div>
                     <div className="text-[6.5rem] font-display font-black text-brand-secondary italic tracking-tighter leading-none">
                        {selectedRaffle.prizePool} <span className="text-3xl text-white/20 font-black">BAGS</span>
                     </div>
                     <div className="pt-12 mt-6 border-t border-white/5 flex justify-between items-center text-[14px] font-black uppercase tracking-[0.4em]">
                        <span className="text-gray-600 italic">Participation Fee</span>
                        <span className="text-3xl text-white font-display font-black italic">{selectedRaffle.ticketPrice} <span className="text-sm opacity-30">BAGS</span></span>
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
                           <div className="space-y-6">
                             <h3 className="text-[18px] font-black uppercase tracking-[0.5em] text-brand-primary italic flex items-center gap-4">
                                <Zap className="w-6 h-6 animate-pulse" /> SLOT MATRIX INFRASTRUCTURE
                             </h3>
                             <p className="text-[12px] text-gray-600 italic font-black uppercase tracking-[0.4em]">Each slot represents an immutable on-chain funding commitment.</p>
                           </div>
                           <div className="bg-brand-primary/10 px-10 py-5 rounded-[2.5rem] border border-brand-primary/20 shadow-[0_0_30px_rgba(168,85,247,0.1)]">
                              <div className="flex items-center gap-4 text-brand-primary text-[16px] font-black uppercase tracking-[0.4em] italic">
                                 <Clock className="w-6 h-6" /> {timeLeft || '--:--'}
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
                             <div className="space-y-6">
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
                            <span className="text-[14px] font-black uppercase tracking-[0.4em] text-gray-500 italic">FUNDING COMMITMENT</span>
                            <span className="text-[7rem] font-display font-black text-brand-secondary italic leading-none drop-shadow-2xl">{(selectedRaffle?.ticketPrice || 0).toFixed(2)}</span>
                         </div>
                         <div className="bg-red-500/10 p-10 rounded-[3rem] border border-red-500/20 flex gap-8 shadow-[0_0_40px_rgba(239,68,68,0.1)]">
                            <AlertCircle className="w-12 h-12 text-red-500 shrink-0" />
                            <p className="text-[12px] text-red-300 font-main italic leading-relaxed uppercase tracking-[0.4em]">Network verification requires exact arrival. Account for withdrawal gas fees.</p>
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
        {showCreateModal && (
          <div className="fixed inset-0 z-200 flex items-center justify-center p-8 bg-black/95 backdrop-blur-3xl overflow-y-auto">
             <motion.div 
               initial={{ opacity: 0, scale: 0.95, y: 20 }} 
               animate={{ opacity: 1, scale: 1, y: 0 }}
               exit={{ opacity: 0, scale: 0.95, y: 20 }}
               className="glass-card !bg-bg-dark/98 p-10 w-[450px] space-y-10 shadow-[0_0_150px_rgba(0,0,0,0.9)] border-white/5 relative overflow-hidden backdrop-blur-3xl"
             >
                {/* Visual Polish - Ambient Glows */}
                <div className="absolute -top-32 -left-32 w-64 h-64 bg-brand-primary/10 rounded-full blur-[100px] pointer-events-none" />
                <div className="absolute -bottom-32 -right-32 w-64 h-64 bg-brand-secondary/10 rounded-full blur-[100px] pointer-events-none" />

                <header className="relative z-10 flex flex-col items-center">
                    <div className="flex items-center justify-between w-full mb-8">
                       <div className="flex gap-1.5">
                          {[1, 2, 3].map((s) => (
                            <div key={s} className="relative h-1 w-12 bg-white/5 rounded-full overflow-hidden">
                               <motion.div 
                                 initial={false}
                                 animate={{ x: createStep >= s ? 0 : -50 }}
                                 className="absolute inset-0 bg-brand-primary shadow-[0_0_10px_#8b5cf6]"
                               />
                            </div>
                          ))}
                       </div>
                       <button onClick={() => { setShowCreateModal(false); setCreateStep(1); }} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/10 transition-colors">
                          <X className="w-5 h-5 text-white/40 hover:text-white" />
                       </button>
                    </div>
                    
                    <div className="text-center space-y-1">
                       <h2 className="text-3xl font-display font-black uppercase italic tracking-tighter leading-none">
                            {createStep === 1 ? 'Configure' : createStep === 2 ? 'Funding' : 'Launch'} <span className="text-brand-primary">Round</span>
                       </h2>
                       <p className="text-[10px] font-black uppercase tracking-[0.5em] text-white/30 italic">Protocol Phase {createStep} of 3</p>
                    </div>
                 </header>

                <div className="relative z-10">
                  {createStep === 1 && (
                    <div className="space-y-12 animate-in fade-in slide-in-from-bottom-5">
                        <div className="grid grid-cols-2 gap-10">
                           <div className="space-y-6">
                              <div className="flex items-center gap-2 ml-1 text-white/50">
                                 <Trophy className="w-3 h-3" />
                                 <label className="text-[10px] font-black uppercase tracking-widest italic">Prize Pool</label>
                              </div>
                              <div>
                                 <input 
                                    type="number" 
                                    value={newRaffleInfo.prizeAmount}
                                    onChange={(e) => setNewRaffleInfo({...newRaffleInfo, prizeAmount: e.target.value})}
                                    className="w-full bg-white/5 border border-white/10 rounded-2xl px-5 py-4 text-2xl font-display font-black italic tracking-tighter text-white focus:ring-2 focus:ring-brand-primary/20 focus:border-brand-primary/50 transition-all outline-none"
                                    placeholder="100"
                                 />
                                 <div className="text-[9px] font-black text-white/30 italic mt-5 text-right">BAGS</div>
                              </div>
                           </div>
                           <div className="space-y-6">
                              <div className="flex items-center gap-2 ml-1 text-white/50">
                                 <Coins className="w-3 h-3" />
                                 <label className="text-[10px] font-black uppercase tracking-widest italic">Slot Fee</label>
                              </div>
                              <div>
                                 <input 
                                    type="number" 
                                    value={newRaffleInfo.ticketPrice}
                                    onChange={(e) => setNewRaffleInfo({...newRaffleInfo, ticketPrice: e.target.value})}
                                    className="w-full bg-white/5 border border-white/10 rounded-2xl px-5 py-4 text-2xl font-display font-black italic tracking-tighter text-white focus:ring-2 focus:ring-brand-primary/20 focus:border-brand-primary/50 transition-all outline-none"
                                    placeholder="5"
                                 />
                                 <div className="text-[9px] font-black text-white/30 italic mt-5 text-right">BAGS</div>
                              </div>
                           </div>
                        </div>

                        <div className="space-y-6">
                           <div className="flex items-center gap-2 ml-1 text-white/50">
                              <Clock className="w-3 h-3" />
                              <label className="text-[10px] font-black uppercase tracking-widest italic">Time Horizon</label>
                           </div>
                           <div className="relative group">
                              <select 
                                value={newRaffleInfo.durationHours}
                                onChange={(e) => setNewRaffleInfo({...newRaffleInfo, durationHours: parseInt(e.target.value)})}
                                className="w-full bg-white/5 border border-white/10 rounded-2xl px-5 py-4 text-[13px] font-black uppercase tracking-widest italic text-white/80 focus:ring-2 focus:ring-brand-primary/20 focus:border-brand-primary/50 transition-all outline-none appearance-none cursor-pointer"
                              >
                                <option value="1" className="bg-bg-dark text-brand-secondary">1 Hour • Quick Strike</option>
                                <option value="24" className="bg-bg-dark text-brand-primary">24 Hours • Daily Cycle</option>
                                <option value="72" className="bg-bg-dark text-blue-400">72 Hours • Extended Pulse</option>
                                <option value="168" className="bg-bg-dark text-orange-400">168 Hours • Weekly Vision</option>
                              </select>
                              <div className="absolute right-5 top-1/2 -translate-y-1/2 pointer-events-none opacity-40">
                                 <motion.div animate={{ y: [0, 2, 0] }} transition={{ repeat: Infinity, duration: 2 }}>
                                    <ChevronDown className="w-4 h-4" />
                                 </motion.div>
                              </div>
                           </div>
                        </div>

                        <div className="space-y-3">
                           <div className="flex items-center gap-2 ml-1 text-white/50">
                              <Target className="w-3 h-3" />
                              <label className="text-[10px] font-black uppercase tracking-widest italic">Beneficiary Chain Node</label>
                           </div>
                           <input 
                              placeholder="Optional SOL Address..."
                              value={newRaffleInfo.donationAddr}
                              onChange={(e) => setNewRaffleInfo({...newRaffleInfo, donationAddr: e.target.value})}
                              className="w-full bg-white/5 border border-white/10 rounded-xl px-5 py-4 text-[11px] font-mono text-white/60 focus:border-brand-primary/50 transition-all outline-none"
                           />
                        </div>

                        <div className="space-y-3">
                           <div className="flex items-center gap-2 ml-1 text-white/50">
                              <FileText className="w-3 h-3" />
                              <label className="text-[10px] font-black uppercase tracking-widest italic">Mission Manifesto</label>
                           </div>
                           <textarea 
                              placeholder="Brief description of your funding goals..."
                              value={newRaffleInfo.description}
                              onChange={(e) => setNewRaffleInfo({...newRaffleInfo, description: e.target.value})}
                              className="w-full bg-white/5 border border-white/10 rounded-xl px-5 py-4 text-[13px] text-white/80 focus:border-brand-primary/50 transition-all outline-none h-24 resize-none leading-relaxed"
                           />
                        </div>

                        <div className="pt-12">
                           <button 
                              onClick={initializeRaffle}
                              disabled={actionLoading}
                              className="btn-primary w-full !py-5 !rounded-2xl flex items-center justify-center gap-3 shadow-2xl shadow-brand-primary/20 hover:scale-[1.02] active:scale-[0.98] transition-all"
                           >
                              {actionLoading ? <Loader2 className="animate-spin w-5 h-5 capitalize" /> : <> <Sparkles className="w-5 h-5" /> INITIALIZE ROUND </>}
                           </button>
                        </div>
                    </div>
                  )}

                  {createStep === 2 && (
                    <div className="space-y-12 animate-in zoom-in duration-700">
                       <div className="flex flex-col items-center justify-center text-center space-y-6">
                          <div className="relative">
                             <div className="w-32 h-32 rounded-full border-4 border-dashed border-brand-primary/20 animate-spin-slow" />
                             <div className="absolute inset-0 flex items-center justify-center">
                                <motion.div 
                                  animate={{ scale: [1, 1.1, 1] }} 
                                  transition={{ repeat: Infinity, duration: 2 }}
                                  className="w-16 h-16 bg-brand-primary/20 rounded-full flex items-center justify-center border border-brand-primary/40 shadow-[0_0_40px_rgba(168,85,247,0.4)]"
                                >
                                   <Zap className="w-7 h-7 text-brand-primary" />
                                </motion.div>
                             </div>
                          </div>
                          <div className="space-y-2">
                             <h3 className="text-2xl font-display font-black uppercase italic tracking-tighter">Syncing Ledger</h3>
                             <p className="text-gray-500 text-[10px] font-black uppercase tracking-[0.4em] italic">Awaiting deposit verification</p>
                          </div>
                       </div>

                       <div className="flex flex-col gap-6 bg-white/5 p-8 rounded-[2rem] border border-white/10 relative overflow-hidden">
                          <div className="space-y-4">
                             <p className="text-[10px] font-black uppercase tracking-[0.4em] text-gray-600 italic">Required</p>
                             <p className="text-5xl font-display font-black text-brand-secondary italic tracking-tighter">{newRaffleInfo.prizeAmount} <span className="text-sm opacity-30">BAGS</span></p>
                             <div className="p-4 glass bg-brand-primary/10 rounded-xl text-center border-brand-primary/20">
                                <p className="text-[9px] font-black uppercase tracking-[0.3em] text-brand-primary">STATUS</p>
                                <p className="text-lg font-display font-black italic">
                                   {vaultBalance >= newRaffleInfo.prizeAmount ? 'FUNDED' : `MISSING ${ (newRaffleInfo.prizeAmount - vaultBalance).toFixed(2) }`}
                                </p>
                             </div>
                          </div>

                          <div className="space-y-4">
                             <p className="text-[10px] font-black uppercase tracking-[0.4em] text-gray-500 italic ml-4">VAULT PDA</p>
                             <div className="glass bg-black/60 p-5 rounded-xl border border-white/10 space-y-4">
                                <div className="text-[11px] font-mono break-all text-center select-all text-gray-400">
                                   {newRaffleInfo.vaultAccount?.toString()}
                                </div>
                             </div>
                          </div>
                       </div>

                       <div className="flex flex-col gap-4">
                          <button onClick={() => { setShowCreateModal(false); setCreateStep(1); }} className="w-full py-4 glass hover:bg-white/5 rounded-xl text-[10px] font-black uppercase tracking-widest text-gray-500">ABANDON ROUND</button>
                       </div>
                    </div>
                  )}

                  {createStep === 3 && (
                     <div className="text-center space-y-12 py-10 animate-in zoom-in-50 duration-1000">
                        <div className="relative inline-block">
                           <motion.div 
                              initial={{ scale: 0 }} 
                              animate={{ scale: 1 }} 
                              className="w-32 h-32 bg-brand-secondary/20 rounded-full flex items-center justify-center border-2 border-brand-secondary/40 shadow-[0_0_80px_rgba(16,185,129,0.3)]"
                           >
                              <CheckCircle2 className="w-16 h-16 text-brand-secondary" />
                           </motion.div>
                        </div>
                        <div className="space-y-4">
                           <h3 className="text-5xl font-display font-black italic tracking-tighter uppercase leading-none text-white">ACTIVATED</h3>
                           <p className="text-gray-500 text-[12px] font-black uppercase tracking-[0.4em] italic">Fundraising pool live</p>
                        </div>
                        <button 
                           onClick={() => { setShowCreateModal(false); setCreateStep(1); setSelectedRaffle( raffles.find(r => r.pubkey === newRaffleInfo.rafflePda?.toString()) ); }}
                           className="btn-primary w-full !py-6 !rounded-xl shadow-4xl shadow-brand-primary/20 transition-all hover:scale-110 active:scale-95 text-lg"
                        >
                           LAUNCH DASHBOARD
                        </button>
                     </div>
                  )}
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
  
  const wallets = useMemo(() => [
    new PhantomWalletAdapter(), 
    new SolflareWalletAdapter(),
  ], []);

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
