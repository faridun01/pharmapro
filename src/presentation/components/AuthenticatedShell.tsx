import React, { Suspense, useEffect, useMemo, useState } from 'react';
import {
  LayoutDashboard,
  ShoppingCart,
  Package,
  Truck,
  BarChart3,
  Settings,
  Bell,
  User,
  Users,
  Pill,
  AlertCircle,
  RotateCcw,
  Trash2,
  Clock,
  Minus,
  X,
  Square,
  CheckCircle2,
} from 'lucide-react';
import { usePharmacy } from '../context';
import { useTranslation } from 'react-i18next';
import { getShiftClosedEventName, loadLatestClosedShiftNotice } from '../../lib/shiftCloseNotice';
import { lazyNamedImport } from '../../lib/lazyLoadComponents';
import { buildApiHeaders } from '../../infrastructure/api';
import { Sidebar, SidebarView } from './Sidebar';

type ViewErrorBoundaryState = { hasError: boolean; message: string };

type AppNotification = {
  id: string;
  title: string;
  description: string;
  type: 'EXPIRY' | 'LOW_STOCK' | 'SYSTEM';
  time: string;
  read: boolean;
  invoiceNo?: string;
};

type AppNotificationMetrics = {
  inventoryHighlights?: {
    lowStockItems: Array<{ productId: string; name: string; currentStock: number; minStock: number }>;
    expiringItems: Array<{ id: string; name: string; batchNumber: string; daysLeft: number; severityRank: number; severityLabel: string }>;
  };
};

const formatDueLabel = (daysUntilDue: number) => {
  if (daysUntilDue < 0) return `${Math.abs(daysUntilDue)} дн. просрочки`;
  if (daysUntilDue === 0) return 'сегодня';
  if (daysUntilDue === 1) return 'завтра';
  return `через ${daysUntilDue} дн.`;
};

class ViewErrorBoundary extends React.Component<{ children: React.ReactNode; onReset: () => void }, ViewErrorBoundaryState> {
  constructor(props: { children: React.ReactNode; onReset: () => void }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }
  static getDerivedStateFromError(error: Error): ViewErrorBoundaryState {
    return { hasError: true, message: error?.message || 'Unknown error' };
  }
  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[view-error-boundary]', error, errorInfo);
  }
  private handleReset = () => {
    this.setState({ hasError: false, message: '' });
    this.props.onReset();
  };
  render() {
    if (this.state.hasError) {
      return (
        <div className="m-8 bg-red-50 border border-red-200 text-red-700 rounded-2xl p-6">
          <h3 className="text-lg font-bold mb-2">Ошибка экрана</h3>
          <p className="text-sm mb-4">Компонент экрана аварийно завершился: {this.state.message}</p>
          <button onClick={this.handleReset} className="px-4 py-2 rounded-xl bg-[#5A5A40] text-white text-sm font-semibold">Вернуться</button>
        </div>
      );
    }
    return this.props.children;
  }
}

const DashboardView = lazyNamedImport(() => import('./DashboardView'), 'DashboardView');
const NotificationsView = lazyNamedImport(() => import('./NotificationsView'), 'NotificationsView');
const POSView = lazyNamedImport(() => import('./POSView'), 'POSView');
const InventoryView = lazyNamedImport(() => import('./InventoryView'), 'InventoryView');
const InvoicesView = lazyNamedImport(() => import('./InvoicesView'), 'InvoicesView');
const SuppliersPage = lazyNamedImport(() => import('./SuppliersPage'), 'SuppliersPage');
const ReportsView = lazyNamedImport(() => import('./ReportsView'), 'ReportsView');
const SettingsView = lazyNamedImport(() => import('./SettingsView'), 'SettingsView');
const ReturnView = lazyNamedImport(() => import('./ReturnView'), 'ReturnView');
const WriteOffView = lazyNamedImport(() => import('./WriteOffView'), 'WriteOffView');
const ShiftView = lazyNamedImport(() => import('./ShiftView'), 'ShiftView');
const PurchasesView = lazyNamedImport(() => import('./PurchasesView'), 'PurchasesView');

const AppLoader: React.FC<{ label?: string; compact?: boolean }> = ({ label = 'Загрузка...', compact = false }) => (
  <div className={`${compact ? 'min-h-60' : 'h-full min-h-0'} flex items-center justify-center bg-[#f5f5f0]`}>
    <div className="flex flex-col items-center gap-3 text-center px-6">
      <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-[#5A5A40]" />
      <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#5A5A40]/55">{label}</p>
    </div>
  </div>
);

const DesktopTitlebar: React.FC<{ controls: any }> = ({ controls }) => (
  <div className="desktop-titlebar shrink-0 flex items-center justify-between pl-3 bg-[#151619] border-b border-white/5 h-10">
    <div className="app-drag min-w-0 flex-1 self-stretch" />
    <div className="flex items-center app-no-drag h-full">
      <button 
        onClick={() => controls.minimize()} 
        className="w-12 h-full flex items-center justify-center hover:bg-white/5 text-white/60 transition-colors"
        title="Minimize"
      >
        <Minus size={14} strokeWidth={2.2} />
      </button>
      <button 
        onClick={() => controls.toggleMaximize()} 
        className="w-12 h-full flex items-center justify-center hover:bg-white/5 text-white/60 transition-colors"
        title="Maximize"
      >
        <Square size={12} strokeWidth={2.1} />
      </button>
      <button 
        onClick={() => controls.close()} 
        className="w-12 h-full flex items-center justify-center hover:bg-red-500 hover:text-white text-white/60 transition-colors"
        title="Close"
      >
        <X size={14} strokeWidth={2.2} />
      </button>
    </div>
  </div>
);

export default function AuthenticatedShell({ onSignedOut }: { onSignedOut?: () => void }) {
  const { t } = useTranslation();
  const { user, logout, error } = usePharmacy();
  const [currentView, setCurrentView] = useState<SidebarView>('dashboard');
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [notificationMetrics, setNotificationMetrics] = useState<AppNotificationMetrics | null>(null);
  const [latestClosedShiftNotice, setLatestClosedShiftNotice] = useState(loadLatestClosedShiftNotice());

  useEffect(() => {
    const refreshShiftNotice = () => setLatestClosedShiftNotice(loadLatestClosedShiftNotice());
    window.addEventListener(getShiftClosedEventName(), refreshShiftNotice as EventListener);
    return () => window.removeEventListener(getShiftClosedEventName(), refreshShiftNotice as EventListener);
  }, []);

  useEffect(() => {
    if (!user) return;
    void (async () => {
      try {
        const response = await fetch('/api/reports/metrics/dashboard?preset=month', { headers: await buildApiHeaders() });
        const payload = await response.json().catch(() => null);
        if (response.ok) setNotificationMetrics(payload);
      } catch {}
    })();
  }, [user]);

  const menuItems = [
    { id: 'pos' as const, label: t('POS Terminal'), icon: ShoppingCart },
    { id: 'inventory' as const, label: 'Товары и партии', icon: Package },
    { id: 'invoices' as const, label: t('Sales History'), icon: Pill },
    { id: 'shifts' as const, label: t('Shifts'), icon: Clock },
    { id: 'purchases' as const, label: 'Приёмка товара', icon: CheckCircle2 },
    { id: 'suppliers' as const, label: t('Suppliers'), icon: Truck },
    { id: 'returns' as const, label: t('Returns'), icon: RotateCcw },
    { id: 'writeoffs' as const, label: t('Write-Offs'), icon: Trash2 },
    { id: 'reports' as const, label: t('Reports'), icon: BarChart3 },
    { id: 'dashboard' as const, label: t('Dashboard'), icon: LayoutDashboard },
    { id: 'notifications' as const, label: t('Notifications'), icon: Bell },
    { id: 'settings' as const, label: t('Settings'), icon: Settings },
  ];

  const notificationsCount = useMemo(() => {
    let count = 0;
    if (latestClosedShiftNotice) count++;
    return count;
  }, [latestClosedShiftNotice]);

  // Собираем уведомления из notificationMetrics
  const notifications = React.useMemo(() => {
    const arr = [];
    if (notificationMetrics?.inventoryHighlights?.lowStockItems) {
      for (const item of notificationMetrics.inventoryHighlights.lowStockItems) {
        arr.push({
          id: `lowstock-${item.productId}`,
          title: 'Низкий остаток',
          description: `Товар \"${item.name}\": ${item.currentStock} из минимальных ${item.minStock}`,
          type: 'LOW_STOCK',
          time: '',
          read: false,
        });
      }
    }
    if (notificationMetrics?.inventoryHighlights?.expiringItems) {
      for (const item of notificationMetrics.inventoryHighlights.expiringItems) {
        arr.push({
          id: `expiry-${item.id}`,
          title: 'Срок годности',
          description: `Партия \"${item.batchNumber}\" товара \"${item.name}\" истекает через ${item.daysLeft} дн.`,
          type: 'EXPIRY',
          time: '',
          read: false,
        });
      }
    }
    if (latestClosedShiftNotice) {
      arr.push({
        id: `shiftclose-${latestClosedShiftNotice.shiftId}`,
        title: 'Смена закрыта',
        description: `Смена №${latestClosedShiftNotice.shiftNo || ''} закрыта. Итог: ${Number(latestClosedShiftNotice.finalAmount).toFixed(2)} TJS, прибыль: ${Number(latestClosedShiftNotice.grossProfit).toFixed(2)} TJS`,
        type: 'SYSTEM',
        time: latestClosedShiftNotice.closedAt || '',
        read: false,
      });
    }
    return arr;
  }, [notificationMetrics, latestClosedShiftNotice]);

  const renderView = () => {
    switch (currentView) {
      case 'dashboard': return <DashboardView />;
      case 'pos': return <POSView />;
      case 'inventory': return <InventoryView />;
      case 'invoices': return <InvoicesView />;
      case 'suppliers': return <SuppliersPage />;
      case 'reports': return <ReportsView />;
      case 'returns': return <ReturnView />;
      case 'writeoffs': return <WriteOffView />;
      case 'shifts': return <ShiftView />;
      case 'purchases': return <PurchasesView />;
      case 'settings': return <SettingsView />;
      case 'notifications': return <NotificationsView notifications={notifications} onNotificationClick={() => {}} />;
      default: return <DashboardView />;
    }
  };

  if (!user) return null;

  return (
    <div className="flex h-screen bg-[#f5f5f0] font-sans text-[#151619] overflow-hidden">
      <Sidebar 
        user={user}
        currentView={currentView}
        onViewChange={setCurrentView}
        onLogout={() => { logout(); onSignedOut?.(); }}
        isSidebarOpen={isSidebarOpen}
        setIsSidebarOpen={setIsSidebarOpen}
        menuItems={menuItems}
        notificationsCount={notificationsCount}
      />

      <main className="flex-1 flex flex-col relative overflow-hidden">
        {window.pharmaproDesktop?.controls && <DesktopTitlebar controls={window.pharmaproDesktop.controls} />}
        
        <header className="h-24 bg-white/80 backdrop-blur-md border-b border-[#5A5A40]/5 flex items-center justify-between px-10 shrink-0 z-20">
          <div className="flex flex-col">
            <h2 className="text-2xl font-black text-[#151619] tracking-tight">{menuItems.find(m => m.id === currentView)?.label || 'PharmaPro'}</h2>
            <p className="text-[10px] text-[#5A5A40]/50 uppercase tracking-[0.2em] font-black">{new Date().toLocaleDateString('ru-RU', { weekday: 'long', month: 'long', day: 'numeric' })}</p>
          </div>
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2 px-4 py-2 bg-[#f5f5f0]/50 rounded-2xl border border-[#5A5A40]/10">
              <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.5)]"></div>
              <span className="text-[10px] font-black text-[#5A5A40]/60 uppercase tracking-widest">{t('Server Connected')}</span>
            </div>
          </div>
        </header>

        <div className={`flex-1 p-6 custom-scrollbar ${currentView === 'pos' ? 'overflow-hidden' : 'overflow-y-auto'}`}>
          <div key={currentView} className="pharma-view-enter">
            <ViewErrorBoundary onReset={() => setCurrentView('dashboard')}>
              <Suspense fallback={<AppLoader compact label="Загружаем раздел" />}>
                {renderView()}
              </Suspense>
            </ViewErrorBoundary>
          </div>
        </div>

        <footer className="h-10 bg-[#151619]/5 border-t border-[#5A5A40]/5 flex items-center justify-between px-10 text-[9px] text-[#5A5A40]/40 font-black uppercase tracking-[0.25em] shrink-0">
          <div className="flex items-center gap-4">
            <span className="text-[#5A5A40]/60">v2.4.0 ITFORCE</span>
            <span className="w-1 h-1 bg-[#5A5A40]/20 rounded-full"></span>
            <span>Система активна</span>
          </div>
          <span>© 2026 PharmaPro Systems</span>
        </footer>
      </main>
    </div>
  );
}
