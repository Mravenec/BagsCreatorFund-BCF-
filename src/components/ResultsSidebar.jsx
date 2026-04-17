import React from 'react';
import { motion } from 'framer-motion';
import { History, TrendingUp, Gem, User } from 'lucide-react';

const ResultsSidebar = ({ completedRaffles }) => {
  return (
    <div className="results-sidebar-container glass shadow-2xl">
      <div className="flex items-center gap-3 mb-10 opacity-60">
        <History className="w-4 h-4 text-brand-primary" />
        <h2 className="text-[10px] font-black uppercase tracking-[0.3em] font-display">Recientes</h2>
      </div>

      {completedRaffles.length === 0 ? (
        <div className="text-center p-12 glass-card border-dashed border-white/10 opacity-50">
          <p className="text-[10px] font-black uppercase tracking-widest text-gray-700 italic">No history yet</p>
        </div>
      ) : (
        <div className="space-y-12">
          {completedRaffles.map((raffle, idx) => (
            <div key={idx}>
              <h3 className="history-group-title !text-[9px]">
                {new Date(raffle.endTime).toLocaleDateString('en-US', { day: '2-digit', month: 'short' })}
              </h3>
              <div className="space-y-4">
                <motion.div 
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="history-card group"
                >
                  <div className="flex flex-col gap-1">
                    <div className="history-time !text-[10px]">
                      {new Date(raffle.endTime).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                    </div>
                    <div className="flex items-center gap-1.5 opacity-40 group-hover:opacity-100 transition-opacity">
                      <TrendingUp className="w-3 h-3 text-brand-secondary" />
                      <span className="text-[8px] font-black uppercase tracking-widest italic">{raffle.prizePool} $BAGS</span>
                    </div>
                  </div>
                  <div className="history-bubble !w-10 !h-10 !text-[12px] shadow-lg group-hover:scale-110 transition-transform">
                    {raffle.winner ? "WIN" : "??"}
                  </div>
                </motion.div>
                <div className="flex items-center gap-2 px-2 opacity-30 text-[8px] font-black uppercase tracking-widest">
                   <User className="w-3 h-3" /> Winner: {raffle.winner || '---'}
                </div>
              </div>
            </div>
          ))}

          {/* Protocol Milestones */}
          <div className="pt-10 border-t border-white/5 space-y-6">
            <div className="flex items-center gap-2 text-[9px] font-black uppercase tracking-widest text-brand-primary italic">
              <Gem className="w-3 h-3" /> Funding Stats
            </div>
            <div className="space-y-4">
               {[
                 { label: "Total Funded", val: "14.2K $BAGS" },
                 { label: "Active Nodes", val: "128" }
               ].map((s, i) => (
                 <div key={i} className="flex justify-between items-center px-2">
                    <span className="text-[9px] font-black uppercase text-gray-500 italic">{s.label}</span>
                    <span className="text-[11px] font-black text-white">{s.val}</span>
                 </div>
               ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ResultsSidebar;
