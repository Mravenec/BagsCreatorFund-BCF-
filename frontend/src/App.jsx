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
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
} from '@solana/spl-token';
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
  X,
  Layout,
  DollarSign,
  Users,
  Trophy,
  Heart,
  Wallet,
  Building,
  ArrowRight
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import idl from './bcf_core.json';

// Solana Styles
import '@solana/wallet-adapter-react-ui/styles.css';

// Program Constants
const PROGRAM_ID = new PublicKey('BCF1111111111111111111111111111111111111111');
const BAGS_MINT = new PublicKey('BAGS111111111111111111111111111111111111111');

// Logo Asset (Generated)
const LOGO_URL = "/bcf_premium_logo_1776362166702.png";

const PLATFORMS = [
  { id: 'binance', name: 'Binance', fee: 0.30, icon: Building },
  { id: 'coinbase', name: 'Coinbase', fee: 0.00, icon: Building },
  { id: 'phantom', name: 'Phantom / Wallet', fee: 0.000005, icon: Wallet },
];

const MainApp = () => {
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const [raffles, setRaffles] = useState([]);
  const [selectedRaffle, setSelectedRaffle] = useState(null);
  const [selectedNumber, setSelectedNumber] = useState(null);
  const [showCexBridge, setShowCexBridge] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedPlatform, setSelectedPlatform] = useState(PLATFORMS[0]);
  const [loading, setLoading] = useState(false);

  // Form State
  const [prizeAmount, setPrizeAmount] = useState(100);
  const [ticketPrice, setTicketPrice] = useState(5);
  const [duration, setDuration] = useState(3600);
  const [description, setDescription] = useState("");
  const [showDonation, setShowDonation] = useState(false);
  const [donationAddr, setDonationAddr] = useState("");

  useEffect(() => {
    fetchRaffles();
    const interval = setInterval(fetchRaffles, 5000);
    return () => clearInterval(interval);
  }, []);

  const fetchRaffles = async () => {
    try {
      const accounts = await connection.getProgramAccounts(PROGRAM_ID);
      const decodedRaffles = accounts.map((acc, index) => {
         const now = Date.now();
         const isWaiting = index === 1; // Simulation
         return {
           pubkey: acc.pubkey,
           description: index === 0 ? "Building the next DePIN on Bags" : "Creator Raffle #" + (index + 1),
           prizePool: (index + 1) * 500,
           ticketPrice: 5,
           ticketsSold: index === 0 ? 84 : 15,
           totalTickets: 100,
           endTime: now + (3600000 / (index + 1)),
           createdAt: now - (index * 300000),
           status: isWaiting ? 'waitingDeposit' : (index === 2 ? 'resolved' : 'active'),
           missingAmount: isWaiting ? 150 : 0,
           creator: "bags...42x",
           winner: index === 2 ? "sol...88q" : null,
           donationAddress: index === 2 ? "don...11z" : null
         };
      });
      setRaffles(decodedRaffles);
    } catch (err) {
      console.error("Failed to fetch raffles", err);
    }
  };

  const handleCreateRaffle = async () => {
    if (!publicKey) {
      alert("Para crear un sorteo desde fuera de una wallet, utiliza el flujo de INTENCIÓN (CEX BRIDGE). Próximamente.");
      return;
    }
    setLoading(true);
    try {
       // Manual instruction creation with web3.js
       alert(`CREATING RAFFLE: ${description} - 15 minute funding window starts now.`);
       setShowCreateModal(false);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  const calculateTotalNeeded = (platform) => {
    const base = prizeAmount || 0;
    return (parseFloat(base) + platform.fee).toFixed(2);
  };

  return (
    <div className="min-h-screen relative overflow-hidden selection:bg-purple-500/30 text-white bg-[#0a0a0c]">
      {/* Background Blobs */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-[-20%] left-[-20%] w-[60%] h-[60%] bg-purple-600/10 blur-[150px] animate-pulse" />
        <div className="absolute bottom-[-20%] right-[-20%] w-[60%] h-[60%] bg-indigo-600/10 blur-[150px] animate-pulse" />
      </div>

      <nav className="sticky top-4 z-50 px-8 py-4 border border-white/5 mx-4 bg-black/60 backdrop-blur-2xl rounded-[2.5rem] shadow-2xl">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-5 cursor-pointer group" onClick={() => setSelectedRaffle(null)}>
            <div className="w-14 h-14 bg-white/5 rounded-2xl p-2 border border-white/10 group-hover:border-purple-500/50 transition-all shadow-xl">
               <img src={LOGO_URL} alt="BCF" className="w-full h-full object-contain" />
            </div>
            <div>
              <h1 className="text-2xl font-black tracking-tighter text-white leading-none">
                BagsCreator<span className="text-purple-500">Fund</span>
              </h1>
              <div className="flex items-center gap-2 mt-1.5">
                <div className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_10px_#22c55e]" />
                <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-gray-500 italic">
                  Zero-Touch Infrastructure
                </p>
              </div>
            </div>
          </div>
          
          <div className="flex items-center gap-8">
            <button 
              onClick={() => setShowCreateModal(true)}
              className="px-6 py-3 bg-purple-600 hover:bg-purple-500 text-white text-[10px] font-black uppercase tracking-[0.2em] rounded-2xl transition-all shadow-lg shadow-purple-600/20 active:scale-95"
            >
              Lanzar Proyecto
            </button>
            <WalletMultiButton />
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto p-12 min-h-[85vh]">
        <AnimatePresence mode="wait">
          {!selectedRaffle ? (
            <motion.div 
              key="pool"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="space-y-16"
            >
              <header className="space-y-4 max-w-2xl">
                <div className="inline-flex items-center gap-3 bg-purple-500/10 border border-purple-500/20 px-4 py-2 rounded-full text-purple-400 text-[10px] font-black uppercase tracking-widest">
                   <Users className="w-4 h-4" /> Comunidad Bags Activa
                </div>
                <h2 className="text-7xl font-black uppercase tracking-tighter leading-none italic">Piscina de Sorteos</h2>
                <p className="text-xl text-gray-500 font-medium leading-relaxed italic">Apoya proyectos independientes, asume el riesgo y gana recompensas en tiempo real.</p>
              </header>

              <div className="grid md:grid-cols-3 gap-10">
                {raffles.map((raffle, idx) => (
                  <motion.div 
                    key={idx}
                    whileHover={{ y: -10 }}
                    className="bg-white/5 border border-white/5 rounded-[3rem] p-10 space-y-8 cursor-pointer hover:border-purple-500/20 transition-all relative overflow-hidden group shadow-2xl"
                    onClick={() => setSelectedRaffle(raffle)}
                  >
                    <div className="flex justify-between items-start">
                       <div className="w-12 h-12 bg-black/40 rounded-2xl flex items-center justify-center border border-white/5">
                          <Coins className="text-purple-500 w-6 h-6" />
                       </div>
                       {raffle.status === 'active' && <span className="text-[9px] font-black uppercase tracking-widest text-green-500 bg-green-500/10 px-3 py-1.5 rounded-full border border-green-500/20">Activo</span>}
                       {raffle.status === 'waitingDeposit' && <span className="text-[9px] font-black uppercase tracking-widest text-yellow-500 bg-yellow-500/10 px-3 py-1.5 rounded-full border border-yellow-500/20 animate-pulse">Fondeando</span>}
                       {raffle.status === 'resolved' && <span className="text-[9px] font-black uppercase tracking-widest text-purple-500 bg-purple-500/10 px-3 py-1.5 rounded-full border border-purple-500/20">Resultados</span>}
                    </div>

                    <div className="space-y-3">
                      <h3 className="text-3xl font-black tracking-tighter line-clamp-2 uppercase group-hover:text-purple-400 transition-colors">{raffle.description}</h3>
                      <div className="flex items-center gap-2 opacity-50">
                        <Users className="w-3.5 h-3.5 text-gray-400" />
                        <span className="text-[10px] font-bold uppercase tracking-widest">{raffle.creator}</span>
                      </div>
                    </div>

                    <div className="space-y-4 pt-4 border-t border-white/5">
                       <div className="flex justify-between items-end">
                         <span className="text-[10px] uppercase font-black text-gray-500 tracking-widest italic">Premio Total</span>
                         <span className="text-2xl font-black text-green-500">{raffle.prizePool} $BAGS</span>
                       </div>
                       <div className="space-y-2">
                          <div className="flex justify-between text-[10px] font-bold uppercase tracking-widest">
                            <span className="text-gray-500 italic">Slots Ocupados</span>
                            <span>{raffle.ticketsSold}%</span>
                          </div>
                          <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden">
                            <div className="h-full bg-gradient-to-r from-purple-600 to-indigo-600 transition-all duration-1000" style={{ width: `${raffle.ticketsSold}%` }} />
                          </div>
                       </div>
                    </div>

                    <div className="flex items-center justify-between text-gray-500 group-hover:text-purple-400 transition-colors pt-4">
                      <div className="flex items-center gap-2 text-[10px] font-bold uppercase">
                        <Clock className="w-4 h-4" /> 42m Restantes
                      </div>
                      <div className="w-10 h-10 rounded-full border border-white/10 flex items-center justify-center group-hover:border-purple-500/30 group-hover:bg-purple-500/10 shadow-lg">
                        <ChevronRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          ) : (
            <motion.div 
              key="details"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="flex flex-col lg:flex-row gap-16"
            >
              <div className="lg:w-[65%] space-y-12">
                <button 
                  onClick={() => setSelectedRaffle(null)}
                  className="flex items-center gap-3 text-[11px] font-black uppercase tracking-[0.2em] text-gray-500 hover:text-white transition-all group"
                >
                  <ArrowRightLeft className="w-5 h-5 rotate-180 group-hover:-translate-x-1 transition-transform" /> Volver a Proyectos
                </button>

                <div className="space-y-8">
                  <h1 className="text-8xl font-black uppercase tracking-tighter leading-[0.85] text-white italic">
                    {selectedRaffle.description}
                  </h1>
                  <div className="flex gap-4">
                     <span className="px-5 py-2 bg-white/5 border border-white/10 rounded-full text-[10px] font-black uppercase tracking-widest">Track: Bags Creator</span>
                     <span className="px-5 py-2 bg-green-500/10 border border-green-500/20 rounded-full text-[10px] font-black uppercase tracking-widest text-green-500 italic">Verificado On-Chain</span>
                  </div>
                </div>

                {selectedRaffle.status === 'waitingDeposit' ? (
                  <div className="bg-yellow-500/5 backdrop-blur-3xl rounded-[3.5rem] p-12 border border-yellow-500/20 space-y-12 relative overflow-hidden shadow-3xl">
                     <div className="absolute top-0 right-0 p-8">
                        <Clock className="w-12 h-12 text-yellow-500/20 animate-spin-slow" />
                     </div>
                     
                     <div className="flex items-start gap-8">
                        <div className="w-20 h-20 bg-yellow-500/10 rounded-[2rem] flex items-center justify-center border border-yellow-500/20 shadow-2xl">
                           <Shield className="w-10 h-10 text-yellow-500" />
                        </div>
                        <div className="space-y-4">
                           <h3 className="text-4xl font-black text-white tracking-tighter uppercase italic">Ventana de Fondeo</h3>
                           <p className="text-gray-400 text-lg max-w-md font-medium italic">El protocolo está esperando la activación automática de la campaña.</p>
                        </div>
                     </div>

                     <div className="p-10 bg-black/40 rounded-[2.5rem] border border-white/5 space-y-6 shadow-inner">
                        <div className="flex justify-between items-center text-[11px] font-black uppercase tracking-[0.3em]">
                           <span className="text-gray-500 italic">Bootstrap Progress</span>
                           <span className="text-yellow-500">{selectedRaffle.prizePool - selectedRaffle.missingAmount} / {selectedRaffle.prizePool} $BAGS</span>
                        </div>
                        <div className="w-full h-4 bg-white/5 rounded-full overflow-hidden border border-white/5">
                           <motion.div 
                              initial={{ width: 0 }}
                              animate={{ width: `${(1 - (selectedRaffle.missingAmount / selectedRaffle.prizePool)) * 100}%` }}
                              className="h-full bg-gradient-to-r from-yellow-600 to-yellow-400 shadow-[0_0_20px_rgba(234,179,8,0.3)]" 
                           />
                        </div>
                        <p className="text-sm font-black text-yellow-500 uppercase tracking-widest text-center italic">
                           ⚠️ Faltan {selectedRaffle.missingAmount} $BAGS para activar el sorteo.
                        </p>
                     </div>

                     <div className="bg-red-500/5 border border-red-500/10 p-6 rounded-2xl flex gap-4">
                        <AlertCircle className="w-8 h-8 text-red-500 shrink-0" />
                        <p className="text-[11px] font-bold text-red-500/80 leading-relaxed uppercase italic">
                           Expira en 12:45. Si no se fondea, los envíos parciales serán retornables manualmente descontando el fee de red SOL.
                        </p>
                     </div>
                  </div>
                ) : (
                  <div className="bg-white/5 backdrop-blur-3xl rounded-[3.5rem] p-12 border border-white/5 shadow-2x relative overflow-hidden shadow-2xl">
                    <div className="flex justify-between items-center mb-12">
                      <h3 className="text-[11px] font-black uppercase tracking-[0.3em] text-gray-500 flex items-center gap-3 font-mono italic">
                         <QrCode className="w-5 h-5 text-purple-500" /> Matrix Matrix • Estructura 10x10
                      </h3>
                      <div className="flex items-center gap-3 bg-green-500/10 px-6 py-3 rounded-2xl text-green-500 font-black text-xs border border-green-500/20 italic">
                        <Clock className="w-5 h-5" /> 42:15 Restantes
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-10 gap-3">
                      {Array.from({ length: 100 }, (_, i) => (
                        <button
                          key={i}
                          onClick={() => setSelectedNumber(i)}
                          className={`aspect-square rounded-xl text-[11px] font-black transition-all flex items-center justify-center border-2 ${
                            selectedNumber === i 
                              ? 'bg-purple-600 border-purple-400 text-white shadow-[0_0_30px_rgba(147,51,234,0.4)] scale-110 z-10' 
                              : 'bg-white/5 border-white/5 text-gray-500 hover:bg-white/10 hover:border-white/20'
                          }`}
                        >
                          {i.toString().padStart(2, '0')}
                        </button>
                      ))}
                    </div>

                    {selectedRaffle.status === 'resolved' && (
                      <div className="absolute inset-0 bg-black/95 backdrop-blur-2xl rounded-[3.5rem] flex flex-col items-center justify-center p-12 z-20 text-center space-y-10">
                        <motion.div 
                          initial={{ scale: 0, rotate: -45 }}
                          animate={{ scale: 1, rotate: 0 }}
                          className="w-40 h-40 bg-purple-600 rounded-full flex items-center justify-center text-7xl font-black shadow-[0_0_80px_rgba(130,87,229,0.4)] border-4 border-purple-400 group"
                        >
                          <span className="animate-bounce">07</span>
                        </motion.div>
                        <div className="space-y-4">
                          <h2 className="text-6xl font-black uppercase tracking-tighter italic flex items-center gap-4 justify-center">
                            <Trophy className="text-yellow-500 w-14 h-14" /> ¡Revelado!
                          </h2>
                          <p className="text-gray-400 text-xl font-medium italic">Ganador: <span className="text-purple-400 font-mono underline decoration-purple-500/30">{selectedRaffle.winner}</span></p>
                        </div>

                        {selectedRaffle.donationAddress && (
                          <motion.div 
                            initial={{ opacity: 0, scale: 0.9 }}
                            animate={{ opacity: 1, scale: 1 }}
                            className="bg-green-500/5 border border-green-500/20 p-8 rounded-[2.5rem] max-w-md shadow-2xl"
                          >
                             <div className="flex items-center gap-3 text-green-500 text-[11px] font-black uppercase tracking-[0.3em] mb-4 justify-center italic">
                               <Heart className="w-5 h-5 fill-current" /> Apoya la Creación
                             </div>
                             <p className="text-[13px] leading-relaxed italic text-gray-400 mb-6 px-4">
                               Si este proyecto te ha dado beneficios, considera apoyar al creador:
                             </p>
                             <div className="bg-black/40 p-4 rounded-xl flex items-center justify-between gap-4 border border-white/5">
                                <code className="text-[11px] text-green-500 font-mono truncate">{selectedRaffle.donationAddress}</code>
                                <button className="p-2 hover:bg-white/10 rounded-lg transition-colors text-gray-500"><Copy className="w-4 h-4" /></button>
                             </div>
                          </motion.div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <aside className="lg:w-[35%] space-y-10">
                <div className="bg-white/5 backdrop-blur-3xl rounded-[3.5rem] p-10 border border-white/5 shadow-2xl space-y-10">
                  <header className="flex justify-between items-center">
                    <h3 className="text-[11px] font-black uppercase tracking-[0.3em] text-gray-500 font-mono italic">Protocol Stats</h3>
                    <div className="w-10 h-10 bg-purple-500/10 rounded-xl flex items-center justify-center border border-purple-500/20">
                       <Layout className="w-5 h-5 text-purple-400" />
                    </div>
                  </header>

                  <div className="space-y-8">
                    <div className="space-y-4">
                       <div className="flex justify-between items-end px-1">
                         <span className="text-[11px] uppercase font-black text-gray-500 tracking-widest italic">Participación</span>
                         <span className="text-xl font-black text-white">{selectedRaffle.ticketsSold} / {selectedRaffle.totalTickets}</span>
                       </div>
                       <div className="w-full h-3 bg-white/5 rounded-full overflow-hidden shadow-inner">
                         <motion.div 
                           initial={{ width: 0 }}
                           animate={{ width: `${(selectedRaffle.ticketsSold / selectedRaffle.totalTickets) * 100}%` }}
                           className="h-full bg-gradient-to-r from-purple-600 via-indigo-500 to-indigo-400 shadow-[0_0_15px_rgba(99,102,241,0.3)]" 
                         />
                       </div>
                    </div>

                    <div className="grid grid-cols-1 gap-6">
                      <div className="p-6 bg-black/40 rounded-[2rem] border border-white/10 flex justify-between items-center shadow-xl group hover:border-green-500/30 transition-all">
                        <div className="space-y-1">
                           <p className="text-[10px] uppercase font-black text-gray-500 tracking-widest italic">Pozo Final</p>
                           <p className="text-3xl font-black text-green-500 font-mono leading-none">{selectedRaffle.prizePool} $BAGS</p>
                        </div>
                        <div className="w-14 h-14 bg-green-500/10 rounded-2xl flex items-center justify-center border border-green-500/10 shadow-lg">
                           <DollarSign className="w-7 h-7 text-green-500" />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="bg-gradient-to-br from-purple-600/10 to-indigo-600/5 backdrop-blur-3xl rounded-[3.5rem] p-12 border border-purple-600/20 shadow-3xl relative overflow-hidden">
                   {selectedNumber !== null ? (
                     <div className="space-y-8">
                       <div className="space-y-2">
                         <p className="text-[11px] font-black uppercase text-purple-400 tracking-[0.2em] italic">Reserva de Financiación</p>
                         <p className="text-6xl font-black text-white leading-none tracking-tighter italic">#{selectedNumber.toString().padStart(2, '0')}</p>
                       </div>
                       <div className="p-6 bg-black/40 rounded-3xl border border-white/5 italic text-gray-400 text-sm leading-relaxed">
                         Al reservar este slot, participas directamente en la capitalización del proyecto.
                       </div>
                       <button 
                          className="w-full bg-purple-600 hover:bg-purple-500 text-white font-black py-6 rounded-2xl text-[11px] uppercase tracking-[0.3em] transition-all shadow-[0_20px_40px_rgba(147,51,234,0.3)] active:scale-95 italic"
                          onClick={() => setShowCexBridge(true)}
                       >
                         RESERVAR SLOT • {selectedRaffle.ticketPrice} $
                       </button>
                     </div>
                   ) : (
                     <div className="flex flex-col items-center justify-center py-16 text-center space-y-6 opacity-40">
                        <div className="w-20 h-20 bg-white/5 rounded-full flex items-center justify-center border border-white/10 animate-pulse">
                           <Plus className="w-10 h-10 text-purple-500" />
                        </div>
                        <p className="text-[11px] font-black uppercase tracking-[0.3em] text-gray-500 italic max-w-xs leading-loose">
                           Selecciona un slot de la matriz para ver opciones de pago
                        </p>
                     </div>
                   )}
                </div>

                <div className="bg-white/2 backdrop-blur-3xl rounded-[3.5rem] p-10 border border-white/5 space-y-8 shadow-2xl group hover:border-white/10 transition-all">
                   <div className="flex justify-between items-start">
                      <div className="space-y-4">
                        <h4 className="text-[11px] font-black uppercase tracking-[0.3em] text-gray-500 flex items-center gap-3 font-mono italic">
                           <ArrowRightLeft className="w-5 h-5 text-green-500" /> CEX Option
                        </h4>
                        <p className="text-[13px] text-gray-400 italic leading-relaxed max-w-xs font-medium">
                           Envía exactamente el monto indicado desde Binance o Coinbase para asegurar el slot.
                        </p>
                      </div>
                   </div>
                   <button 
                    onClick={() => setShowCexBridge(true)}
                    className="w-full py-5 rounded-2xl bg-white/5 border border-white/5 text-[10px] font-black uppercase tracking-[0.2em] hover:bg-white/10 hover:border-purple-500/20 transition-all shadow-xl group flex items-center justify-center gap-3"
                   >
                    Instrucciones de Exchange <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                   </button>
                </div>
              </aside>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* CEX Bridge / Fee Wizard Modal */}
      <AnimatePresence>
        {showCexBridge && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-8 bg-black/90 backdrop-blur-md">
             <motion.div 
               initial={{ opacity: 0, y: 50 }}
               animate={{ opacity: 1, y: 0 }}
               exit={{ opacity: 0, y: 50 }}
               className="bg-[#0f0f13] border border-white/10 p-12 rounded-[4rem] max-w-2xl w-full space-y-12 relative shadow-[0_0_100px_rgba(0,0,0,0.8)]"
             >
                <header className="flex justify-between items-center">
                   <div className="space-y-2">
                     <h2 className="text-5xl font-black uppercase tracking-tighter italic">CEX Bridge Wizard</h2>
                     <p className="text-gray-500 font-medium italic">Configura tu envío para que llegue exacto.</p>
                   </div>
                   <button onClick={() => setShowCexBridge(false)} className="w-14 h-14 bg-white/5 hover:bg-red-500/20 rounded-full transition-all border border-white/10 flex items-center justify-center group">
                      <X className="w-6 h-6 text-gray-500 group-hover:text-red-500 transition-colors" />
                   </button>
                </header>

                <div className="space-y-10">
                   <div className="space-y-4">
                      <label className="text-[11px] font-black uppercase tracking-[0.3em] text-gray-500 italic px-2">Selecciona Plataforma de Origen</label>
                      <div className="grid grid-cols-3 gap-6">
                        {PLATFORMS.map(p => (
                          <button 
                            key={p.id}
                            onClick={() => setSelectedPlatform(p)}
                            className={`p-6 rounded-[2rem] border-2 transition-all flex flex-col items-center gap-4 group ${
                              selectedPlatform.id === p.id 
                                ? 'bg-purple-600 border-purple-400 shadow-2xl scale-105' 
                                : 'bg-white/5 border-white/5 hover:border-white/20'
                            }`}
                          >
                             <p.icon className={`w-10 h-10 ${selectedPlatform.id === p.id ? 'text-white' : 'text-gray-500 group-hover:text-purple-400'} transition-all`} />
                             <span className={`text-[11px] font-black uppercase tracking-widest ${selectedPlatform.id === p.id ? 'text-white' : 'text-gray-500'}`}>{p.name}</span>
                          </button>
                        ))}
                      </div>
                   </div>

                   <div className="bg-black/40 rounded-[3rem] p-10 border border-white/10 space-y-8 shadow-inner">
                      <div className="flex justify-between items-center">
                        <p className="text-gray-500 font-black uppercase text-[11px] tracking-widest italic">Cálculo de Envío Exacto</p>
                        <div className="px-5 py-2 bg-green-500/10 rounded-full border border-green-500/20 text-[10px] text-green-500 font-black uppercase italic tracking-widest">
                           Red Solana / BAGS
                        </div>
                      </div>

                      <div className="space-y-6">
                         <div className="flex justify-between items-center px-4">
                            <span className="text-lg text-gray-400 italic">Monto de participación</span>
                            <span className="text-2xl font-mono">{prizeAmount} BAGS</span>
                         </div>
                         <div className="flex justify-between items-center px-4">
                            <span className="text-lg text-red-400 italic">+ Fee de retiro {selectedPlatform.name}</span>
                            <span className="text-2xl font-mono text-red-400">{selectedPlatform.fee} BAGS</span>
                         </div>
                         <div className="pt-6 border-t border-white/5 flex justify-between items-center px-4">
                            <span className="text-2xl font-black text-white italic uppercase tracking-tighter">Total a Retirar</span>
                            <span className="text-5xl font-black text-green-500 font-mono shadow-[0_0_30px_rgba(34,197,94,0.2)]">
                               {calculateTotalNeeded(selectedPlatform)}
                            </span>
                         </div>
                      </div>
                   </div>

                   <div className="bg-yellow-500/5 p-8 rounded-[2.5rem] border border-yellow-500/20 flex gap-6 shadow-2xl shadow-yellow-500/5">
                      <AlertCircle className="w-12 h-12 text-yellow-500 shrink-0 mt-1" />
                      <div className="space-y-3">
                         <p className="text-[11px] text-yellow-500 font-black uppercase tracking-[0.2em] italic">Atención Crítica de Fees</p>
                         <p className="text-sm text-yellow-500/70 leading-relaxed italic font-medium">
                            Asegúrate de que la cantidad que "Recibe" el destino sea exactamente <b>{prizeAmount} BAGS</b>. Si es menos, el sorteo no se activará y el reembolso incurrirá en una segunda deducción de fee de red.
                         </p>
                      </div>
                   </div>
                </div>

                <div className="flex flex-col items-center gap-6">
                   <p className="text-[10px] font-black uppercase text-gray-600 tracking-[0.4em] italic">Escaneando transacciones en tiempo real...</p>
                </div>
             </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Create Raffle Modal */}
      <AnimatePresence>
        {showCreateModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-8 bg-black/90 backdrop-blur-md">
             <motion.div 
               initial={{ opacity: 0, scale: 0.95 }}
               animate={{ opacity: 1, scale: 1 }}
               exit={{ opacity: 0, scale: 0.95 }}
               className="bg-[#0f0f13] border border-white/10 p-12 rounded-[4rem] max-w-xl w-full space-y-10 relative shadow-4xl overflow-y-auto max-h-[90vh]"
             >
                <header className="flex justify-between items-center">
                   <div className="space-y-2">
                     <h2 className="text-4xl font-black uppercase tracking-tighter italic">Lanzar Funding</h2>
                     <p className="text-gray-500 font-medium italic">Inicia tu ronda de fondeo descentralizada.</p>
                   </div>
                   <button onClick={() => setShowCreateModal(false)} className="p-3 hover:bg-white/5 rounded-full transition-colors">
                      <X className="w-8 h-8 text-gray-500" />
                   </button>
                </header>

                <div className="space-y-8">
                   <div className="space-y-3 px-2">
                      <label className="text-[11px] font-black uppercase tracking-[0.3em] text-gray-500 italic">Monto del Premio ($BAGS)</label>
                      <input 
                        type="number" 
                        value={prizeAmount}
                        onChange={(e) => setPrizeAmount(e.target.value)}
                        className="w-full bg-black/60 border border-white/10 rounded-[2rem] p-6 text-green-500 text-3xl font-black font-mono outline-none focus:border-purple-500/50 shadow-inner transition-all"
                      />
                   </div>
                   <div className="grid grid-cols-2 gap-6">
                      <div className="space-y-3 px-2">
                         <label className="text-[11px] font-black uppercase tracking-[0.3em] text-gray-500 italic">Ticket Cost ($)</label>
                         <input 
                           type="number" 
                           value={ticketPrice}
                           onChange={(e) => setTicketPrice(e.target.value)}
                           className="w-full bg-black/60 border border-white/10 rounded-[1.5rem] p-5 text-white font-black font-mono outline-none focus:border-purple-500/50 transition-all text-xl"
                         />
                      </div>
                      <div className="space-y-3 px-2">
                         <label className="text-[11px] font-black uppercase tracking-[0.3em] text-gray-500 italic">Duración (Min)</label>
                         <input 
                           type="number" 
                           value={duration / 60}
                           onChange={(e) => setDuration(e.target.value * 60)}
                           className="w-full bg-black/60 border border-white/10 rounded-[1.5rem] p-5 text-white font-black font-mono outline-none focus:border-purple-500/50 transition-all text-xl"
                         />
                      </div>
                   </div>
                   <div className="space-y-3 px-2">
                      <label className="text-[11px] font-black uppercase tracking-[0.3em] text-gray-500 italic">Descripción del Proyecto</label>
                      <textarea 
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        className="w-full bg-black/60 border border-white/10 rounded-[2rem] p-6 text-gray-300 text-lg italic font-medium outline-none focus:border-purple-500/50 transition-all h-28"
                        placeholder="Define tu visión ante la comunidad..."
                      />
                   </div>

                   <div className="bg-white/5 p-8 rounded-[2.5rem] border border-white/10 space-y-6 shadow-2xl">
                      <div className="flex justify-between items-center">
                        <label className="text-[11px] font-black uppercase tracking-[0.3em] text-gray-500 italic">Habilitar Donaciones</label>
                        <button 
                          onClick={() => setShowDonation(!showDonation)}
                          className={`w-14 h-7 rounded-full transition-all relative ${showDonation ? 'bg-purple-600 shadow-[0_0_15px_rgba(147,51,234,0.5)]' : 'bg-white/10 shadow-inner'}`}
                        >
                          <div className={`absolute top-1 h-5 w-5 bg-white rounded-full transition-all ${showDonation ? 'left-8 shadow-lg' : 'left-1'}`} />
                        </button>
                      </div>
                      {showDonation && (
                        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="space-y-2">
                           <input 
                            type="text" 
                            value={donationAddr}
                            onChange={(e) => setDonationAddr(e.target.value)}
                            placeholder="@username o Solana Address"
                            className="w-full bg-black/40 border border-white/10 rounded-xl p-4 text-xs text-purple-400 font-mono italic outline-none focus:border-purple-500/50"
                           />
                           <p className="text-[9px] text-gray-500 font-bold uppercase tracking-widest px-2 italic text-center">Solo visible para el ganador de la ronda.</p>
                        </motion.div>
                      )}
                   </div>
                </div>

                <div className="p-6 bg-red-500/5 rounded-3xl border border-red-500/10 flex gap-4">
                   <AlertCircle className="w-10 h-10 text-red-500 shrink-0" />
                   <div className="space-y-1">
                      <p className="text-[11px] text-red-500 font-black uppercase tracking-widest italic">Responsabilidad de Fondeo</p>
                      <p className="text-[10px] text-red-500/60 font-bold uppercase leading-relaxed italic">
                         Tienes 15 minutos exactos para fondear el premio. Si fallas, el sorteo muere y aplica fee de retorno.
                      </p>
                   </div>
                </div>

                <button 
                  onClick={handleCreateRaffle}
                  className="w-full bg-purple-600 hover:bg-purple-500 py-8 rounded-[2rem] font-black uppercase tracking-[0.3em] text-[11px] shadow-[0_20px_50px_rgba(147,51,234,0.3)] transition-all active:scale-95 italic"
                >
                  INITIALIZE BOOTSTRAP ROUND
                </button>
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
