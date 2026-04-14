import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Pill, ShieldCheck } from 'lucide-react';

export const BootSplash: React.FC<{
  isVisible: boolean;
  onComplete?: () => void;
}> = ({ isVisible }) => {
  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ opacity: 1 }}
          exit={{ opacity: 0, scale: 1.1, filter: 'blur(20px)' }}
          transition={{ duration: 0.8, ease: 'easeInOut' }}
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-[#151619] overflow-hidden"
        >
          {/* Background Decorative Elements */}
          <div className="absolute inset-0 overflow-hidden pointer-events-none">
            <motion.div 
              animate={{ 
                scale: [1, 1.2, 1],
                opacity: [0.3, 0.5, 0.3],
                x: [-20, 20, -20]
              }}
              transition={{ duration: 8, repeat: Infinity, ease: 'linear' }}
              className="absolute -top-1/4 -left-1/4 w-full h-full bg-[#5A5A40]/20 blur-[120px] rounded-full" 
            />
            <motion.div 
              animate={{ 
                scale: [1, 1.3, 1],
                opacity: [0.2, 0.4, 0.2],
                y: [-30, 30, -30]
              }}
              transition={{ duration: 10, repeat: Infinity, ease: 'linear' }}
              className="absolute -bottom-1/4 -right-1/4 w-full h-full bg-[#5A5A40]/10 blur-[100px] rounded-full" 
            />
          </div>

          <div className="relative flex flex-col items-center">
            {/* Main Logo Animation */}
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.8, ease: 'backOut' }}
              className="relative w-32 h-32 flex items-center justify-center"
            >
              <div className="absolute inset-0 bg-[#5A5A40] blur-3xl opacity-20 animate-pulse" />
              <div className="w-24 h-24 bg-gradient-to-br from-[#5A5A40] to-[#151619] border border-white/10 rounded-[32px] flex items-center justify-center shadow-2xl relative z-10">
                <Pill size={48} className="text-white" />
              </div>
              
              {/* Spinning Rings */}
              <motion.div 
                animate={{ rotate: 360 }}
                transition={{ duration: 4, repeat: Infinity, ease: 'linear' }}
                className="absolute inset-0 border-2 border-[#5A5A40]/30 rounded-[40px]"
              />
            </motion.div>

            {/* ITFORCE Branding */}
            <div className="mt-12 text-center">
              <motion.div
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.4, duration: 0.6 }}
              >
                <h2 className="text-[10px] font-bold uppercase tracking-[0.5em] text-white/30 mb-2">Developed by</h2>
                <h1 className="text-4xl font-black text-white tracking-widest flex items-center gap-1">
                  IT<span className="text-[#5A5A40]">FORCE</span>
                </h1>
              </motion.div>

              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 1, duration: 1 }}
                className="mt-8 flex items-center justify-center gap-4 py-2 px-6 rounded-full border border-white/5 bg-white/2 backdrop-blur-md"
              >
                <ShieldCheck size={14} className="text-[#5A5A40]" />
                <span className="text-[9px] font-bold text-white/40 uppercase tracking-widest">Enterprise Edition v2.4</span>
              </motion.div>
            </div>

            {/* Progress indicator */}
            <div className="absolute bottom-[-100px] w-64 h-[2px] bg-white/5 rounded-full overflow-hidden">
              <motion.div 
                initial={{ x: '-100%' }}
                animate={{ x: '0%' }}
                transition={{ duration: 3.5, ease: 'easeInOut' }}
                className="w-full h-full bg-[#5A5A40]"
              />
            </div>
          </div>

          <div className="absolute bottom-12 left-0 right-0 text-center">
            <p className="text-[10px] text-white/10 font-medium tracking-tight">
              © 2026 PharmaPro Systems | Secured & Optimized by ITFORCE
            </p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};