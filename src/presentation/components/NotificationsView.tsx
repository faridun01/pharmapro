import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bell, Clock, Package, ChevronRight, Wallet } from 'lucide-react';

export type NotificationItem = {
  id: string;
  title: string;
  description: string;
  type: 'EXPIRY' | 'LOW_STOCK' | 'SYSTEM' | 'PAYMENT_DUE' | 'OVERDUE_PAYMENT';
  time: string;
  read: boolean;
  invoiceNo?: string;
};

type NotificationsViewProps = {
  notifications: NotificationItem[];
  onOpenAllActivity?: () => void;
  onNotificationClick?: (notification: NotificationItem) => void;
};

export const NotificationsView: React.FC<NotificationsViewProps> = ({ notifications, onOpenAllActivity, onNotificationClick }) => {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<'ALL' | 'PAYMENTS' | 'LOW_STOCK' | 'EXPIRY' | 'SYSTEM'>('ALL');
  const unreadCount = notifications.filter((n) => !n.read).length;

  const filteredNotifications = useMemo(() => {
    if (filter === 'ALL') return notifications;
    if (filter === 'PAYMENTS') {
      return notifications.filter((n) => n.type === 'PAYMENT_DUE' || n.type === 'OVERDUE_PAYMENT');
    }
    return notifications.filter((n) => n.type === filter);
  }, [filter, notifications]);

  const renderIcon = (type: NotificationItem['type']) => {
    if (type === 'EXPIRY') {
      return <Clock size={18} />;
    }
    if (type === 'LOW_STOCK') {
      return <Package size={18} />;
    }
    if (type === 'PAYMENT_DUE' || type === 'OVERDUE_PAYMENT') {
      return <Wallet size={18} />;
    }
    return <Bell size={18} />;
  };

  const renderTone = (type: NotificationItem['type']) => {
    if (type === 'EXPIRY') {
      return 'bg-rose-50 text-rose-600 border border-rose-200';
    }
    if (type === 'LOW_STOCK') {
      return 'bg-amber-50 text-amber-600 border border-amber-200';
    }
    if (type === 'PAYMENT_DUE') {
      return 'bg-emerald-50 text-emerald-700 border border-emerald-200';
    }
    if (type === 'OVERDUE_PAYMENT') {
      return 'bg-rose-50 text-rose-700 border border-rose-200';
    }
    return 'bg-teal-50 text-teal-700 border border-teal-200';
  };

  const getActionLabel = (type: NotificationItem['type']) => {
    if (type === 'LOW_STOCK') return 'Перейти в Склад';
    if (type === 'EXPIRY') return 'Проверить Партии';
    if (type === 'PAYMENT_DUE' || type === 'OVERDUE_PAYMENT') return 'Открыть оплату долга';
    if (type === 'SYSTEM') return 'Перейти к сменам';
    return 'Перейти в раздел';
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="bg-white rounded-3xl border border-slate-200/80 shadow-sm p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 bg-[#0F766E] rounded-2xl text-white flex items-center justify-center shadow-md shadow-[#0F766E]/20">
              <Bell size={20} />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-slate-900 font-['Outfit']">{t('Notifications')}</h2>
              <p className="text-[11px] uppercase tracking-widest text-slate-400 font-bold mt-0.5">
                {unreadCount} {t('Unread Alerts')}
              </p>
            </div>
          </div>

          {onOpenAllActivity && (
            <button
              onClick={onOpenAllActivity}
              className="px-4 py-2 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-all flex items-center gap-2"
            >
              {t('View All Activity')} <ChevronRight size={14} />
            </button>
          )}
        </div>
      </div>

      <div className="bg-white rounded-3xl border border-slate-200/80 shadow-sm p-4 space-y-3">
        <div className="flex flex-wrap gap-2 pb-1">
          {[
            { value: 'ALL', label: 'Все' },
            { value: 'PAYMENTS', label: 'Оплаты' },
            { value: 'LOW_STOCK', label: 'Остатки' },
            { value: 'EXPIRY', label: 'Сроки годности' },
            { value: 'SYSTEM', label: 'Система' },
          ].map((option) => (
            <button
              key={option.value}
              onClick={() => setFilter(option.value as typeof filter)}
              className={`px-4 py-2 rounded-xl text-xs font-semibold border transition-all ${filter === option.value
                ? 'bg-[#0F766E] text-white border-[#0F766E] shadow-sm'
                : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                }`}
            >
              {option.label}
            </button>
          ))}
        </div>

        {filteredNotifications.length === 0 && (
          <div className="h-52 flex items-center justify-center text-slate-400 text-sm">
            Нет уведомлений по выбранному фильтру.
          </div>
        )}

        {filteredNotifications.map((n) => (
          <div
            key={n.id}
            className={`p-4 rounded-2xl border transition-all flex gap-4 ${n.read
              ? 'bg-white border-slate-100 opacity-60'
              : 'bg-slate-50/70 border-slate-200/90 shadow-sm hover:bg-slate-100/80'
              }`}
          >
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${renderTone(n.type)}`}>
              {renderIcon(n.type)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex justify-between items-start mb-1">
                <div className="flex items-center gap-2">
                  <h4 className="text-sm font-bold text-slate-900 truncate">{n.title}</h4>
                  {!n.read && <div className="w-2 h-2 bg-rose-500 rounded-full animate-pulse" />}
                </div>
                <span className="text-[10px] text-slate-400 font-medium whitespace-nowrap">{n.time}</span>
              </div>
              <p className="text-xs text-slate-600 line-clamp-2 leading-relaxed">{n.description}</p>
              <div className="mt-3 flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => onNotificationClick?.(n)}
                  className={`px-4 py-2 rounded-xl text-xs font-bold transition-all shadow-sm flex items-center gap-1.5 ${n.read
                    ? 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                    : 'bg-[#0F766E] text-white hover:bg-[#0D9488]'
                    }`}
                >
                  <span>{getActionLabel(n.type)}</span>
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
