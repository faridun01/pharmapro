import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Pill, ShieldCheck } from 'lucide-react';

export const BootSplash: React.FC<{
  isVisible: boolean;
  statusMessage?: string;
  errorMessage?: string;
  onRetry?: () => void;
  onSaveConfig?: (url: string) => Promise<void>;
}> = ({ isVisible, statusMessage = 'Инициализация...', errorMessage, onRetry, onSaveConfig }) => {
  const [showConfig, setShowConfig] = React.useState(false);
  const [config, setConfig] = React.useState({
    host: 'localhost',
    port: '5432',
    user: 'postgres',
    password: '',
    database: 'pharmapro',
  });

  const handleApply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!onSaveConfig) return;
    
    const url = `postgresql://${config.user}:${config.password}@${config.host}:${config.port}/${config.database}`;
    await onSaveConfig(url);
    setShowConfig(false);
  };

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
              animate={errorMessage ? { scale: 0.8 } : { scale: 1 }}
              className="relative w-24 h-24 flex items-center justify-center mb-8"
            >
              <div className={`absolute inset-0 bg-[#5A5A40] blur-2xl opacity-20 ${!errorMessage && !showConfig && 'animate-pulse'}`} />
              <div className="w-20 h-20 bg-gradient-to-br from-[#5A5A40] to-[#151619] border border-white/10 rounded-[28px] flex items-center justify-center shadow-2xl relative z-10">
                <Pill size={40} className="text-white" />
              </div>
            </motion.div>

            {/* Content Area */}
            <div className="text-center w-full">
              {showConfig ? (
                <motion.form 
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  onSubmit={handleApply}
                  className="bg-white/5 border border-white/10 p-6 rounded-[32px] backdrop-blur-xl text-left"
                >
                  <h3 className="text-white font-black uppercase tracking-widest text-[10px] mb-4 text-center">Настройка базы данных</h3>
                  
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[8px] uppercase tracking-widest text-white/40 mb-1 block">Хост</label>
                        <input 
                          className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white text-xs focus:border-[#5A5A40] outline-none transition-colors"
                          value={config.host}
                          onChange={e => setConfig({...config, host: e.target.value})}
                        />
                      </div>
                      <div>
                        <label className="text-[8px] uppercase tracking-widest text-white/40 mb-1 block">Порт</label>
                        <input 
                          className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white text-xs focus:border-[#5A5A40] outline-none transition-colors"
                          value={config.port}
                          onChange={e => setConfig({...config, port: e.target.value})}
                        />
                      </div>
                    </div>
                    
                    <div>
                      <label className="text-[8px] uppercase tracking-widest text-white/40 mb-1 block">Пользователь</label>
                      <input 
                        className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white text-xs focus:border-[#5A5A40] outline-none transition-colors"
                        value={config.user}
                        onChange={e => setConfig({...config, user: e.target.value})}
                      />
                    </div>

                    <div>
                      <label className="text-[8px] uppercase tracking-widest text-white/40 mb-1 block">Пароль</label>
                      <input 
                        type="password"
                        className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white text-xs focus:border-[#5A5A40] outline-none transition-colors"
                        value={config.password}
                        onChange={e => setConfig({...config, password: e.target.value})}
                        placeholder="••••••••"
                      />
                    </div>

                    <div>
                      <label className="text-[8px] uppercase tracking-widest text-white/40 mb-1 block">Имя базы</label>
                      <input 
                        className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white text-xs focus:border-[#5A5A40] outline-none transition-colors"
                        value={config.database}
                        onChange={e => setConfig({...config, database: e.target.value})}
                      />
                    </div>
                  </div>

                  <div className="flex gap-2 mt-6">
                    <button 
                      type="button"
                      onClick={() => setShowConfig(false)}
                      className="flex-1 py-3 bg-white/5 text-white/60 font-black uppercase tracking-widest text-[8px] rounded-2xl hover:bg-white/10 transition-colors"
                    >
                      Отмена
                    </button>
                    <button 
                      type="submit"
                      className="flex-1 py-3 bg-[#5A5A40] text-white font-black uppercase tracking-widest text-[8px] rounded-2xl hover:bg-[#6e6e4f] transition-colors shadow-lg shadow-[#5A5A40]/20"
                    >
                      Применить
                    </button>
                  </div>
                </motion.form>
              ) : !errorMessage ? (
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
                  
                  <div className="space-y-3">
                    <button 
                      onClick={onRetry}
                      className="w-full py-4 bg-red-500 text-white font-black uppercase tracking-widest text-[10px] rounded-2xl hover:bg-red-600 transition-colors shadow-lg shadow-red-500/20"
                    >
                      Повторить попытку
                    </button>
                    <button 
                      onClick={() => setShowConfig(true)}
                      className="w-full py-3 bg-white/5 text-white/60 font-black uppercase tracking-widest text-[8px] rounded-xl hover:bg-white/10 transition-colors"
                    >
                      Настроить подключение
                    </button>
                  </div>
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