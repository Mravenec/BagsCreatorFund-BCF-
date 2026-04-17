import React from 'react';
import { motion } from 'framer-motion';
import { Coins, Users, Clock, ChevronRight } from 'lucide-react';

const RaffleCard = ({ raffle, onClick }) => {
  return (
    <motion.div 
      whileHover={{ y: -8 }}
      className="glass-card p-10 space-y-8 cursor-pointer relative overflow-hidden group"
      onClick={onClick}
    >
      <div className="flex justify-between items-start">
        <div className="w-12 h-12 bg-white/5 rounded-2xl flex items-center justify-center border border-white/5 shadow-xl group-hover:border-brand-primary/30 transition-all">
          <Coins className="text-brand-primary w-6 h-6" />
        </div>
        {raffle.status === 'active' && <span className="text-[9px] font-black uppercase tracking-widest text-brand-secondary bg-brand-secondary/10 px-3 py-1.5 rounded-full border border-brand-secondary/20">Active</span>}
        {raffle.status === 'waitingDeposit' && <span className="text-[9px] font-black uppercase tracking-widest text-yellow-500 bg-yellow-500/10 px-3 py-1.5 rounded-full border border-yellow-500/20 animate-pulse">Funding</span>}
        {raffle.status === 'resolved' && <span className="text-[9px] font-black uppercase tracking-widest text-brand-primary bg-brand-primary/10 px-3 py-1.5 rounded-full border border-brand-primary/20">Results</span>}
      </div>

      <div className="space-y-3">
        <h3 className="text-3xl font-display font-black tracking-tighter line-clamp-2 uppercase group-hover:text-brand-primary transition-colors italic">
          {raffle.description}
        </h3>
        <div className="flex items-center gap-2 opacity-40">
          <Users className="w-3.5 h-3.5" />
          <span className="text-[10px] font-black uppercase tracking-widest">{raffle.creator}</span>
        </div>
      </div>

      <div className="space-y-5 pt-4 border-t border-white/5">
        <div className="flex justify-between items-end">
          <span className="text-[10px] uppercase font-black text-gray-500 tracking-widest italic">Prize Pool</span>
          <span className="text-2xl font-display font-black text-brand-secondary italic">{raffle.prizePool} $BAGS</span>
        </div>
        <div className="space-y-2">
          <div className="flex justify-between text-[10px] font-black uppercase tracking-widest">
            <span className="text-gray-500 italic">Participation</span>
            <span>{raffle.ticketsSold}%</span>
          </div>
          <div className="progress-container">
            <motion.div 
              initial={{ width: 0 }}
              animate={{ width: `${raffle.ticketsSold}%` }}
              className="progress-fill"
            />
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between text-gray-500 group-hover:text-brand-primary transition-colors pt-4">
        <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest">
          <Clock className="w-3 h-3" /> 42m Remaining
        </div>
        <div className="w-10 h-10 rounded-full border border-white/10 flex items-center justify-center group-hover:border-brand-primary/30 group-hover:bg-brand-primary/10 shadow-lg">
          <ChevronRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
        </div>
      </div>
    </motion.div>
  );
};

export default RaffleCard;
