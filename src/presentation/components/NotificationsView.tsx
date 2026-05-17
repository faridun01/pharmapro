import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bell, Clock, Package, ChevronRight, Wallet } from 'lucide-react';

type NotificationItem = {
  id: string;
  title: string;
  description: string;
  type: 'EXPIRY' | 'LOW_STOCK' | 'SYSTEM' | 'PAYMENT_DUE' | 'OVERDUE_PAYMENT';
  time: string;
  read: boolean;
};

type NotificationsViewProps = {
  notifications: NotificationItem[];
  onOpenAllActivity?: () => void;
  onNotificationClick?: (id: string, linkTo: string) => void;
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
    if (type === 'PAYMENT_DUE') {
      return <Wallet size={18} />;
    }
    if (type === 'OVERDUE_PAYMENT') {
      return <Wallet size={18} />;
    }
    return <Bell size={18} />;
  };

  const renderTone = (type: NotificationItem['type']) => {
    if (type === 'EXPIRY') {
      return 'bg-red-50 text-red-500';
    }
    if (type === 'LOW_STOCK') {
      return 'bg-amber-50 text-amber-500';
    }
    if (type === 'PAYMENT_DUE') {
      return 'bg-emerald-50 text-emerald-600';
    }
    if (type === 'OVERDUE_PAYMENT') {
      return 'bg-red-50 text-red-600';
    }
    return 'bg-blue-50 text-blue-500';
  };

  const getActionLabel = (type: NotificationItem['type']) => {
    if (type === 'LOW_STOCK') return 'Открыть остатки';
    if (type === 'EXPIRY') return 'Проверить партии';
    if (type === 'PAYMENT_DUE' || type === 'OVERDUE_PAYMENT') return 'Открыть оплату';
    return 'Открыть отчет';
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="bg-white rounded-3xl border border-[#5A5A40]/10 shadow-sm p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 bg-[#5A5A40] rounded-2xl text-white flex items-center justify-center">
              <Bell size={20} />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-[#5A5A40]">{t('Notifications')}</h2>
              <p className="text-[11px] uppercase tracking-widest text-[#5A5A40]/40 font-bold">
                {unreadCount} {t('Unread Alerts')}
              </p>
            </div>
          </div>

          {onOpenAllActivity && (
            <button
              onClick={onOpenAllActivity}
              className="px-4 py-2 rounded-xl border border-[#5A5A40]/15 text-sm font-semibold text-[#5A5A40] hover:bg-[#f5f5f0] transition-all flex items-center gap-2"
            >
              {t('View All Activity')} <ChevronRight size={14} />
            </button>
          )}
        </div>
      </div>

      <div className="bg-white rounded-3xl border border-[#5A5A40]/10 shadow-sm p-4 space-y-3">
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
              className={`px-4 py-2 rounded-xl text-sm font-medium border transition-all ${filter === option.value
                ? 'bg-[#5A5A40] text-white border-[#5A5A40]'
                : 'bg-[#f5f5f0] text-[#5A5A40] border-[#5A5A40]/10 hover:bg-[#ecebe5]'
                }`}
            >
              {option.label}
            </button>
          ))}
        </div>

        {filteredNotifications.length === 0 && (
          <div className="h-52 flex items-center justify-center text-[#5A5A40]/50 text-sm">
            Нет уведомлений по выбранному фильтру.
          </div>
        )}

        {filteredNotifications.map((n) => (
          <div
            key={n.id}
            className={`p-4 rounded-2xl border transition-all flex gap-4 ${n.read
              ? 'bg-white border-[#5A5A40]/5 opacity-60'
              : 'bg-[#f5f5f0]/50 border-[#5A5A40]/10 shadow-sm hover:bg-[#ecebe5]'
              }`}
          >
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${renderTone(n.type)}`}>
              {renderIcon(n.type)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex justify-between items-start mb-1">
                <div className="flex items-center gap-2">
                  <h4 className="text-sm font-bold text-[#5A5A40] truncate">{n.title}</h4>
                  {!n.read && <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />}
                </div>
                <span className="text-[10px] text-[#5A5A40]/30 font-medium whitespace-nowrap">{n.time}</span>
              </div>
              <p className="text-xs text-[#5A5A40]/60 line-clamp-2 leading-relaxed">{n.description}</p>
              <div className="mt-3 flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => onNotificationClick?.(n.id, (n as any).linkTo)}
                  className={`px-4 py-2 rounded-xl text-xs font-bold transition-all shadow-sm ${n.read
                    ? 'bg-[#5A5A40]/5 text-[#5A5A40]/40 hover:bg-[#5A5A40]/10'
                    : 'bg-[#5A5A40] text-white hover:bg-[#4A4A30]'
                    }`}
                >
                  {n.read ? 'Просмотрено' : `Перейти в ${(n as any).linkTo === 'inventory' ? 'Склад' : (n as any).linkTo === 'batches' ? 'Партии' : (n as any).linkTo === 'shifts' ? 'Смены' : 'раздел'}`}
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
