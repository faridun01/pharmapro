import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Pill, ShieldCheck } from 'lucide-react';

export const BootSplash: React.FC<{
  isVisible: boolean;
  statusMessage?: string;
  errorMessage?: string;
  onRetry?: () => void;
}> = ({ isVisible, statusMessage = 'Инициализация...', errorMessage, onRetry }) => {
  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ opacity: 1 }}
          exit={{ opacity: 0, scale: 1.05, filter: 'blur(10px)' }}
          transition={{ duration: 0.6, ease: 'easeInOut' }}
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-[#151619] overflow-hidden"
        >
          {/* Background Decorative Elements */}
          <div className="absolute inset-0 overflow-hidden pointer-events-none">
            <motion.div 
              animate={{ 
                scale: [1, 1.1, 1],
                opacity: [0.2, 0.3, 0.2],
              }}
              transition={{ duration: 10, repeat: Infinity, ease: 'linear' }}
              className="absolute -top-1/4 -left-1/4 w-full h-full bg-[#5A5A40]/10 blur-[120px] rounded-full" 
            />
          </div>

          <div className="relative flex flex-col items-center max-w-md w-full px-10">
            {/* Main Logo Animation */}
            <motion.div
              animate={errorMessage ? { scale: 0.9 } : { scale: 1 }}
              className="relative w-24 h-24 flex items-center justify-center mb-10"
            >
              <div className={`absolute inset-0 bg-[#5A5A40] blur-2xl opacity-20 ${!errorMessage && 'animate-pulse'}`} />
              <div className="w-20 h-20 bg-gradient-to-br from-[#5A5A40] to-[#151619] border border-white/10 rounded-[28px] flex items-center justify-center shadow-2xl relative z-10">
                <Pill size={40} className="text-white" />
              </div>
              
              {!errorMessage && (
                <motion.div 
                  animate={{ rotate: 360 }}
                  transition={{ duration: 4, repeat: Infinity, ease: 'linear' }}
                  className="absolute -inset-2 border border-[#5A5A40]/30 rounded-[36px]"
                />
              )}
            </motion.div>

            {/* Content Area */}
            <div className="text-center w-full">
              {!errorMessage ? (
                <div className="pharma-fade-in">
                  <h1 className="text-3xl font-black text-white tracking-widest flex items-center justify-center gap-1 mb-6">
                    IT<span className="text-[#5A5A40]">FORCE</span>
                  </h1>
                  
                  <div className="flex flex-col items-center gap-4">
                    <p className="text-[10px] font-black uppercase tracking-[0.3em] text-[#5A5A40] animate-pulse">
                      {statusMessage}
                    </p>
                    <div className="w-48 h-[1px] bg-white/5 rounded-full overflow-hidden">
                      <motion.div 
                        animate={{ x: ['-100%', '100%'] }}
                        transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                        className="w-1/2 h-full bg-[#5A5A40]"
                      />
                    </div>
                  </div>
                </div>
              ) : (
                <motion.div 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-red-500/10 border border-red-500/20 p-6 rounded-[32px] backdrop-blur-xl"
                >
                  <h3 className="text-red-500 font-black uppercase tracking-widest text-xs mb-3">Ошибка подключения</h3>
                  <p className="text-white/60 text-xs leading-relaxed mb-6 font-medium">
                    {errorMessage.includes('PostgreSQL') 
                      ? 'Не удалось подключиться к базе данных. Пожалуйста, убедитесь, что служба PostgreSQL запущенна.'
                      : errorMessage}
                  </p>
                  <button 
                    onClick={onRetry}
                    className="w-full py-4 bg-red-500 text-white font-black uppercase tracking-widest text-[10px] rounded-2xl hover:bg-red-600 transition-colors shadow-lg shadow-red-500/20"
                  >
                    Повторить попытку
                  </button>
                </motion.div>
              )}
            </div>

            {/* Footer */}
            <div className="absolute bottom-[-140px] left-0 right-0 text-center opacity-30">
               <span className="text-[8px] font-black text-white uppercase tracking-[0.4em]">PharmaPro Enterprise v2.4</span>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
  );
};