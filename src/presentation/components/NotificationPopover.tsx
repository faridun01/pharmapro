import React from 'react';
import { useTranslation } from 'react-i18next';
import { 
  Bell, 
  AlertTriangle, 
  Clock, 
  ChevronRight, 
  X,
  Pill,
  Package
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface Notification {
  id: string;
  title: string;
  description: string;
  type: 'EXPIRY' | 'LOW_STOCK' | 'SYSTEM';
  time: string;
  read: boolean;
}

interface NotificationPopoverProps {
  isOpen: boolean;
  onClose: () => void;
  notifications: Notification[];
}

export const NotificationPopover: React.FC<NotificationPopoverProps> = ({ isOpen, onClose, notifications }) => {
  const { t } = useTranslation();
  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={onClose} />
          <motion.div 
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            className="absolute right-0 mt-4 w-96 bg-white rounded-4xl shadow-2xl border border-[#5A5A40]/10 z-50 overflow-hidden flex flex-col max-h-128"
          >
            <div className="p-6 border-b border-[#5A5A40]/5 flex items-center justify-between bg-[#f5f5f0]/30">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-[#5A5A40] rounded-2xl flex items-center justify-center text-white shadow-lg">
                  <Bell size={20} />
                </div>
                <div>
                  <h3 className="font-bold text-[#5A5A40]">{t('Notifications')}</h3>
                  <p className="text-[10px] text-[#5A5A40]/40 uppercase tracking-widest font-bold">
                    {notifications.filter(n => !n.read).length} {t('Unread Alerts')}
                  </p>
                </div>
              </div>
              <button onClick={onClose} className="p-2 text-[#5A5A40]/30 hover:text-[#5A5A40] transition-colors">
                <X size={20} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-3">
              {notifications.length > 0 ? (
                notifications.map((n) => (
                  <button 
                    key={n.id} 
                    className={`w-full text-left p-4 rounded-2xl border transition-all flex gap-4 group ${
                      n.read ? 'bg-white border-[#5A5A40]/5 opacity-60' : 'bg-[#f5f5f0]/50 border-[#5A5A40]/10 hover:bg-[#f5f5f0] shadow-sm'
                    }`}
                  >
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                      n.type === 'EXPIRY' ? 'bg-red-50 text-red-500' : 
                      n.type === 'LOW_STOCK' ? 'bg-amber-50 text-amber-500' : 
                      'bg-blue-50 text-blue-500'
                    }`}>
                      {n.type === 'EXPIRY' ? <Clock size={18} /> : 
                       n.type === 'LOW_STOCK' ? <Package size={18} /> : 
                       <Bell size={18} />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-start mb-1">
                        <h4 className="text-sm font-bold text-[#5A5A40] truncate">{n.title}</h4>
                        <span className="text-[10px] text-[#5A5A40]/30 font-medium whitespace-nowrap">{n.time}</span>
                      </div>
                      <p className="text-xs text-[#5A5A40]/60 line-clamp-2 leading-relaxed">{n.description}</p>
                    </div>
                  </button>
                ))
              ) : (
                <div className="h-64 flex flex-col items-center justify-center text-[#5A5A40]/20 text-center p-8">
                  <Bell size={48} strokeWidth={1} className="mb-4" />
                  <p className="text-sm font-medium italic">{t('No new notifications.')}<br/>{t('Everything is up to date.')}</p>
                </div>
              )}
            </div>

            <div className="p-4 bg-[#f5f5f0]/30 border-t border-[#5A5A40]/5">
              <button className="w-full py-3 text-xs font-bold text-[#5A5A40] uppercase tracking-widest hover:bg-[#5A5A40] hover:text-white rounded-xl transition-all flex items-center justify-center gap-2">
                {t('View All Activity')} <ChevronRight size={14} />
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};
