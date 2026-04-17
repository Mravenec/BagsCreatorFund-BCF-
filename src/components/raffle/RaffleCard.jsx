import React from 'react';
import { motion } from 'framer-motion';
import { Coins, Users, Clock, ChevronRight } from 'lucide-react';

const RaffleCard = ({ raffle, onClick }) => {
  const [timeLeft, setTimeLeft] = React.useState("");

  React.useEffect(() => {
    const updateTimer = () => {
      const now = Date.now();
      const diff = raffle.endTime - now;

      if (diff <= 0) {
        setTimeLeft("Ended");
        return;
      }

      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);

      setTimeLeft(`${h}h ${m}m ${s}s`);
    };

    const interval = setInterval(updateTimer, 1000);
    updateTimer();
    return () => clearInterval(interval);
  }, [raffle.endTime]);
  return (
    <motion.div 
      whileHover={{ y: -8 }}
      className="glass-card p-10 space-y-8 cursor-pointer relative overflow-hidden group"
      onClick={onClick}
    >
      <div className="flex justify-between items-start">
        <div className="w-14 h-14 bg-white/5 rounded-2xl flex items-center justify-center border border-white/5 shadow-xl group-hover:border-brand-primary/30 group-hover:bg-brand-primary/10 transition-all duration-500">
          <Coins className="text-brand-primary w-7 h-7" />
        </div>
        <div className="flex flex-col items-end gap-2">
          {raffle.status === 'active' && <span className="text-[10px] font-black uppercase tracking-[0.2em] text-brand-secondary bg-brand-secondary/10 px-4 py-2 rounded-full border border-brand-secondary/20 italic">Live Round</span>}
          {raffle.status === 'waitingDeposit' && <span className="text-[10px] font-black uppercase tracking-[0.2em] text-yellow-500 bg-yellow-500/10 px-4 py-2 rounded-full border border-yellow-500/20 animate-pulse italic">Pending Funding</span>}
          {raffle.status === 'resolved' && <span className="text-[10px] font-black uppercase tracking-[0.2em] text-brand-primary bg-brand-primary/10 px-4 py-2 rounded-full border border-brand-primary/20 italic">Settled</span>}
        </div>
      </div>

      <div className="space-y-4">
        <h3 className="text-4xl font-display font-black tracking-tighter line-clamp-2 uppercase group-hover:text-brand-primary transition-colors italic leading-none">
          {raffle.description}
        </h3>
        <div className="flex items-center gap-3 opacity-30 group-hover:opacity-60 transition-opacity">
          <div className="w-6 h-6 rounded-lg bg-white/10 flex items-center justify-center text-[10px] font-black italic">ID</div>
          <span className="text-[11px] font-black uppercase tracking-[0.3em] italic">{raffle.pubkey.slice(0, 8)}...</span>
        </div>
      </div>

      <div className="space-y-6 pt-6 border-t border-white/5">
        <div className="flex justify-between items-end">
          <div className="space-y-1">
            <p className="text-[10px] uppercase font-black text-gray-600 tracking-[0.3em] italic">Current Pool</p>
            <p className="text-3xl font-display font-black text-white italic tracking-tighter leading-none">{raffle.prizePool} <span className="text-sm opacity-30 italic font-black">BAGS</span></p>
          </div>
          <div className="text-right space-y-1">
             <p className="text-[10px] font-black uppercase tracking-widest text-brand-secondary italic">Liquidity</p>
             <p className="text-xl font-display font-black text-brand-secondary italic">{raffle.ticketsSold}%</p>
          </div>
        </div>
          <div className="progress-container">
            <motion.div 
              initial={{ width: 0 }}
              animate={{ width: `${raffle.ticketsSold}%` }}
              className="progress-fill"
            />
          </div>
      </div>

      <div className="flex items-center justify-between text-gray-500 group-hover:text-brand-primary transition-colors pt-4">
        <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest">
          <Clock className="w-3 h-3" /> {timeLeft} Remaining
        </div>
        <div className="w-10 h-10 rounded-full border border-white/10 flex items-center justify-center group-hover:border-brand-primary/30 group-hover:bg-brand-primary/10 shadow-lg">
          <ChevronRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
        </div>
      </div>
    </motion.div>
  );
};

export default RaffleCard;
