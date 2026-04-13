import React, { Suspense, useEffect, useMemo, useState } from 'react';
import {
  LayoutDashboard,
  Minus,
  ShoppingCart,
  Package,
  Truck,
  BarChart3,
  Settings,
  LogOut,
  Bell,
  User,
  Menu,
  Square,
  X,
  Pill,
  AlertCircle,
  RotateCcw,
  Trash2,
  Clock,
} from 'lucide-react';
import { usePharmacy } from '../context';
import { useTranslation } from 'react-i18next';
import { getShiftClosedEventName, loadLatestClosedShiftNotice } from '../../lib/shiftCloseNotice';
import { lazyNamedImport } from '../../lib/lazyLoadComponents';
import { buildApiHeaders } from '../../infrastructure/api';

type ViewErrorBoundaryState = { hasError: boolean; message: string };

type AppNotification = {
  id: string;
  title: string;
  description: string;
  type: 'EXPIRY' | 'LOW_STOCK' | 'SYSTEM' | 'PAYMENT_DUE' | 'OVERDUE_PAYMENT';
  time: string;
  read: boolean;
  invoiceNo?: string;
};

type AppNotificationMetrics = {
  creditReceivables?: {
    overdueItems: Array<{ invoiceId: string; invoiceNo: string; customerName: string; remainingAmount: number; daysOverdue: number }>;
    dueTomorrowItems: Array<{ invoiceId: string; invoiceNo: string; customerName: string; remainingAmount: number }>;
  };
  inventoryHighlights?: {
    lowStockItems: Array<{ productId: string; name: string; currentStock: number; minStock: number }>;
    expiringItems: Array<{ id: string; name: string; batchNumber: string; daysLeft: number; severityRank: number; severityLabel: string }>;
  };
};

type View = 'dashboard' | 'notifications' | 'pos' | 'inventory' | 'batches' | 'invoices' | 'debtors' | 'suppliers' | 'reports' | 'settings' | 'returns' | 'writeoffs' | 'shifts';

const startOfDay = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate());

const diffInDays = (left: Date, right: Date) => {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round((startOfDay(left).getTime() - startOfDay(right).getTime()) / msPerDay);
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
          <p className="text-sm mb-4">Компонент текущей страницы завершился с ошибкой: {this.state.message}</p>
          <button
            onClick={this.handleReset}
            className="px-4 py-2 rounded-xl bg-[#5A5A40] text-white text-sm font-semibold"
          >
            Вернуться на панель
          </button>
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
const SuppliersView = lazyNamedImport(() => import('./SuppliersView'), 'SuppliersView');
const ReportsView = lazyNamedImport(() => import('./ReportsView'), 'ReportsView');
const SettingsView = lazyNamedImport(() => import('./SettingsView'), 'SettingsView');
const ReturnView = lazyNamedImport(() => import('./ReturnView'), 'ReturnView');
const WriteOffView = lazyNamedImport(() => import('./WriteOffView'), 'WriteOffView');
const ShiftView = lazyNamedImport(() => import('./ShiftView'), 'ShiftView');

const DesktopTitlebar: React.FC<{
  controls: NonNullable<NonNullable<Window['pharmaproDesktop']>['controls']>;
}> = ({ controls }) => (
  <div className="desktop-titlebar shrink-0 flex items-center justify-between pl-3">
    <div className="app-drag min-w-0 flex-1 self-stretch" />

    <div className="desktop-titlebar__controls app-no-drag flex items-center self-stretch">
      <button
        type="button"
        onClick={() => controls.minimize()}
        className="desktop-titlebar__button"
        aria-label="Minimize window"
      >
        <Minus size={14} strokeWidth={2.2} />
      </button>
      <button
        type="button"
        onClick={() => controls.toggleMaximize()}
        className="desktop-titlebar__button"
        aria-label="Toggle maximize window"
      >
        <Square size={12} strokeWidth={2.1} />
      </button>
      <button
        type="button"
        onClick={() => controls.close()}
        className="desktop-titlebar__button desktop-titlebar__button--close"
        aria-label="Close window"
      >
        <X size={14} strokeWidth={2.2} />
      </button>
    </div>
  </div>
);

const AppLoader: React.FC<{
  label?: string;
  compact?: boolean;
}> = ({ label = 'Загрузка...', compact = false }) => (
  <div className={`${compact ? 'min-h-60' : 'h-full min-h-0'} flex items-center justify-center bg-[#f5f5f0]`}>
    <div className="flex flex-col items-center gap-3 text-center px-6">
      <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-[#5A5A40]" />
      <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#5A5A40]/55">{label}</p>
    </div>
  </div>
);

export default function AuthenticatedShell({ onSignedOut }: { onSignedOut?: () => void }) {
  const { t } = useTranslation();
  const { user, logout, error } = usePharmacy();
  const desktopControls = window.pharmaproDesktop?.controls;
  const [currentView, setCurrentView] = useState<View>('dashboard');
  const [inventorySection, setInventorySection] = useState<'catalog' | 'batches'>('catalog');
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [invoiceSearchPrefill, setInvoiceSearchPrefill] = useState('');
  const [invoicePaymentPrefillId, setInvoicePaymentPrefillId] = useState('');
  const [invoiceDetailsPrefillId, setInvoiceDetailsPrefillId] = useState('');
  const [shiftReportPrefillId, setShiftReportPrefillId] = useState('');
  const [latestClosedShiftNotice, setLatestClosedShiftNotice] = useState(loadLatestClosedShiftNotice());
  const [notificationMetrics, setNotificationMetrics] = useState<AppNotificationMetrics | null>(null);

  useEffect(() => {
    const refreshShiftNotice = () => setLatestClosedShiftNotice(loadLatestClosedShiftNotice());

    refreshShiftNotice();
    window.addEventListener('focus', refreshShiftNotice);
    window.addEventListener(getShiftClosedEventName(), refreshShiftNotice as EventListener);

    return () => {
      window.removeEventListener('focus', refreshShiftNotice);
      window.removeEventListener(getShiftClosedEventName(), refreshShiftNotice as EventListener);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    if (!user) {
      setNotificationMetrics(null);
      return;
    }

    void (async () => {
      try {
        const response = await fetch('/api/reports/metrics/dashboard?preset=month', {
          headers: await buildApiHeaders(),
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(payload?.error || 'Не удалось загрузить уведомления');
        }
        if (!cancelled) {
          setNotificationMetrics(payload as AppNotificationMetrics);
        }
      } catch {
        if (!cancelled) {
          setNotificationMetrics(null);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user]);

  const menuItems = [
    { id: 'pos', label: t('POS Terminal'), icon: ShoppingCart },
    { id: 'inventory', label: 'Товары и партии', icon: Package },
    { id: 'invoices', label: t('Sales History'), icon: Pill },
    { id: 'debtors', label: 'Должники', icon: User },
    { id: 'shifts', label: t('Shifts'), icon: Clock },
    { id: 'suppliers', label: t('Suppliers'), icon: Truck },
    { id: 'returns', label: t('Returns'), icon: RotateCcw },
    { id: 'writeoffs', label: t('Write-Offs'), icon: Trash2 },
    { id: 'reports', label: t('Reports'), icon: BarChart3 },
    { id: 'dashboard', label: t('Dashboard'), icon: LayoutDashboard },
    { id: 'notifications', label: t('Notifications'), icon: Bell },
    { id: 'settings', label: t('Settings'), icon: Settings },
  ];

  const currentMenuItem = menuItems.find((item) => item.id === currentView);

  const notifications: AppNotification[] = useMemo(() => {
    const systemNotifications = latestClosedShiftNotice
      ? [
          {
            id: `shift-closed-${latestClosedShiftNotice.shiftId}`,
            title: 'Смена закрыта',
            description: `${latestClosedShiftNotice.shiftNo || 'Смена'} закрыта. Отчет готов: прибыль ${Number(latestClosedShiftNotice.grossProfit || 0).toFixed(2)} TJS, продажи нетто ${Number(latestClosedShiftNotice.netSales || 0).toFixed(2)} TJS.`,
            type: 'SYSTEM' as const,
            time: 'сейчас',
            read: false,
          },
        ]
      : [];

    const overduePaymentNotifications = (notificationMetrics?.creditReceivables?.overdueItems || []).map((item) => ({
      id: `payment-overdue-${item.invoiceId}`,
      title: 'Просроченная оплата покупателя',
      description: `${item.customerName || 'Покупатель'}: счет ${item.invoiceNo} просрочен на ${Math.abs(Number(item.daysOverdue || 0))} дн. Сумма долга ${Number(item.remainingAmount || 0).toFixed(2)}.`,
      type: 'OVERDUE_PAYMENT' as const,
      time: `${Math.abs(Number(item.daysOverdue || 0))} дн.`,
      read: false,
      invoiceNo: item.invoiceNo,
    }));

    const dueTomorrowNotifications = (notificationMetrics?.creditReceivables?.dueTomorrowItems || []).map((item) => ({
      id: `payment-due-${item.invoiceId}`,
      title: 'Оплата от покупателя завтра',
      description: `${item.customerName || 'Покупатель'}: счет ${item.invoiceNo} требует оплаты ${formatDueLabel(1)} на сумму ${Number(item.remainingAmount || 0).toFixed(2)}.`,
      type: 'PAYMENT_DUE' as const,
      time: '1 день',
      read: false,
      invoiceNo: item.invoiceNo,
    }));

    const paymentNotifications = [...dueTomorrowNotifications, ...overduePaymentNotifications];

    const lowStockNotifications = [...(notificationMetrics?.inventoryHighlights?.lowStockItems || [])]
      .sort((left, right) => {
        const leftGap = Number(left.currentStock || 0) - Number(left.minStock || 10);
        const rightGap = Number(right.currentStock || 0) - Number(right.minStock || 10);
        if (leftGap !== rightGap) {
          return leftGap - rightGap;
        }

        const leftCoverage = Number(left.minStock || 10) > 0 ? Number(left.currentStock || 0) / Number(left.minStock || 10) : Number(left.currentStock || 0);
        const rightCoverage = Number(right.minStock || 10) > 0 ? Number(right.currentStock || 0) / Number(right.minStock || 10) : Number(right.currentStock || 0);
        if (leftCoverage !== rightCoverage) {
          return leftCoverage - rightCoverage;
        }

        return String(left.name || '').localeCompare(String(right.name || ''), 'ru-RU');
      })
      .slice(0, 4)
      .map((product) => ({
        id: `low-stock-${product.productId}`,
        title: t('Low Stock Alert'),
        description: `${product.name} ниже минимального остатка. Осталось ${product.currentStock} ед.`,
        type: 'LOW_STOCK' as const,
        time: 'сейчас',
        read: false,
      }));

    const expiryNotifications = (notificationMetrics?.inventoryHighlights?.expiringItems || [])
      .filter((item) => Number(item.daysLeft) >= 0 && Number(item.daysLeft) <= 30)
      .sort((left, right) => left.daysLeft - right.daysLeft)
      .slice(0, 4)
      .map((item) => ({
        id: `expiry-${item.id}`,
        title: t('Expiry Warning'),
        description: `Партия ${item.batchNumber} (${item.name}) истекает ${formatDueLabel(item.daysLeft)}.`,
        type: 'EXPIRY' as const,
        time: `${item.daysLeft} дн.`,
        read: false,
      }));

    return [...systemNotifications, ...paymentNotifications, ...lowStockNotifications, ...expiryNotifications];
  }, [latestClosedShiftNotice, notificationMetrics, t]);

  const notificationsCount = notifications.length;

  const handleLogout = () => {
    logout();
    onSignedOut?.();
  };

  const openInvoicePaymentFlow = (invoiceId?: string, invoiceNo?: string) => {
    if (!invoiceId) {
      setCurrentView('debtors');
      return;
    }

    setInvoiceSearchPrefill(invoiceNo || '');
    setInvoicePaymentPrefillId(invoiceId);
    setCurrentView('debtors');
  };

  const openInvoiceDetailsFlow = (invoiceId?: string, invoiceNo?: string) => {
    if (!invoiceId) {
      setCurrentView('invoices');
      return;
    }

    setInvoiceSearchPrefill(invoiceNo || '');
    setInvoiceDetailsPrefillId(invoiceId);
    setCurrentView('invoices');
  };

  const handleNotificationClick = (notification: AppNotification) => {
    if (notification.type === 'PAYMENT_DUE' || notification.type === 'OVERDUE_PAYMENT') {
      const invoiceId = notification.id.replace('payment-due-', '').replace('payment-overdue-', '');
      openInvoicePaymentFlow(invoiceId, notification.invoiceNo);
      return;
    }

    if (notification.type === 'LOW_STOCK') {
      setInventorySection('catalog');
      setCurrentView('inventory');
      return;
    }

    if (notification.type === 'EXPIRY') {
      setInventorySection('batches');
      setCurrentView('inventory');
      return;
    }

    if (notification.type === 'SYSTEM') {
      const shiftId = notification.id.replace('shift-closed-', '');
      setShiftReportPrefillId(shiftId);
      setCurrentView('shifts');
      return;
    }

    setCurrentView('notifications');
  };

  const renderView = () => {
    switch (currentView) {
      case 'dashboard': return <DashboardView onOpenInvoicePayment={openInvoicePaymentFlow} />;
      case 'notifications': return <NotificationsView notifications={notifications} onOpenAllActivity={() => setCurrentView('dashboard')} onNotificationClick={handleNotificationClick} />;
      case 'pos': return <POSView />;
      case 'inventory': return <InventoryView initialSection={inventorySection} />;
      case 'batches': return <InventoryView initialSection="batches" />;
      case 'invoices': return <InvoicesView viewMode="history" initialSearchTerm={invoiceSearchPrefill} initialPaymentInvoiceId={invoicePaymentPrefillId} initialDetailsInvoiceId={invoiceDetailsPrefillId} onInitialPaymentInvoiceHandled={() => setInvoicePaymentPrefillId('')} onInitialDetailsInvoiceHandled={() => setInvoiceDetailsPrefillId('')} />;
      case 'debtors': return <InvoicesView viewMode="debtors" initialSearchTerm={invoiceSearchPrefill} initialPaymentInvoiceId={invoicePaymentPrefillId} initialDetailsInvoiceId={invoiceDetailsPrefillId} onInitialPaymentInvoiceHandled={() => setInvoicePaymentPrefillId('')} onInitialDetailsInvoiceHandled={() => setInvoiceDetailsPrefillId('')} />;
      case 'suppliers': return <SuppliersView />;
      case 'reports': return <ReportsView />;
      case 'returns': return <ReturnView />;
      case 'writeoffs': return <WriteOffView />;
      case 'shifts': return <ShiftView initialReportShiftId={shiftReportPrefillId} onInitialReportHandled={() => setShiftReportPrefillId('')} />;
      case 'settings': return <SettingsView />;
      default: return <DashboardView onOpenInvoicePayment={openInvoicePaymentFlow} />;
    }
  };

  if (!user) {
    return null;
  }

  return (
    <div className="flex h-screen bg-[#f5f5f0] font-sans text-[#151619] overflow-hidden">
      <aside
        className="bg-[#151619] text-white flex flex-col relative z-30 shadow-2xl pharma-sidebar"
        style={{ width: isSidebarOpen ? 248 : 72 }}
      >
        <div className="px-5 py-6 flex items-center gap-3 border-b border-white/5">
          <div className="w-10 h-10 bg-[#5A5A40] rounded-2xl flex items-center justify-center text-white shadow-lg shrink-0">
            <Pill size={24} />
          </div>
          {isSidebarOpen && (
            <div className="flex flex-col pharma-fade-in">
              <h1 className="font-bold text-lg tracking-tight">PharmaPro</h1>
              <p className="text-[10px] text-white/40 uppercase tracking-widest font-bold">{t('Management System')}</p>
            </div>
          )}
        </div>

        <div className="flex-1 min-h-0 px-3 py-4 flex flex-col">
          <div className="flex-1 min-h-0 rounded-[28px] border border-white/6 bg-white/3 shadow-inner flex flex-col overflow-hidden">
            <nav className="flex-1 min-h-0 p-3 space-y-2 overflow-y-auto custom-scrollbar">
              {menuItems.map((item) => (
                <button
                  key={item.id}
                  onClick={() => setCurrentView(item.id as View)}
                  className={`w-full flex items-center gap-3 px-3.5 py-3 rounded-2xl transition-all group relative ${
                    currentView === item.id
                      ? 'bg-[#5A5A40] text-white shadow-lg shadow-[#5A5A40]/25'
                      : 'text-white/40 hover:text-white hover:bg-white/6'
                  }`}
                >
                  <item.icon size={20} className={currentView === item.id ? 'text-white' : 'group-hover:scale-110 transition-transform'} />
                  {isSidebarOpen && (
                    <span className="font-medium text-sm flex items-center gap-2">
                      {item.label}
                      {item.id === 'notifications' && notificationsCount > 0 ? (
                        <span className="inline-flex min-w-5 h-5 px-1.5 items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold">
                          {notificationsCount}
                        </span>
                      ) : null}
                    </span>
                  )}
                  {currentView === item.id && !isSidebarOpen && (
                    <div className="absolute left-0 w-1 h-6 bg-white rounded-r-full" />
                  )}
                  {!isSidebarOpen && item.id === 'notifications' && notificationsCount > 0 && (
                    <span className="absolute top-2 right-2 min-w-4 h-4 px-1 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center">
                      {notificationsCount}
                    </span>
                  )}
                </button>
              ))}
            </nav>

            <div className="p-3 border-t border-white/6 bg-black/10">
              <button
                onClick={handleLogout}
                className="w-full flex items-center gap-3 px-3.5 py-3 text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-2xl transition-all group"
              >
                <LogOut size={20} className="group-hover:-translate-x-1 transition-transform" />
                {isSidebarOpen && <span className="font-medium text-sm">{t('Sign Out')}</span>}
              </button>
            </div>
          </div>
        </div>

        <button
          onClick={() => setIsSidebarOpen(!isSidebarOpen)}
          className="absolute -right-4 top-20 w-8 h-8 bg-[#5A5A40] rounded-full flex items-center justify-center text-white shadow-xl hover:scale-110 transition-transform z-40 border-4 border-[#f5f5f0] app-no-drag"
        >
          {isSidebarOpen ? <X size={14} /> : <Menu size={14} />}
        </button>
      </aside>

      <main className="flex-1 flex flex-col relative overflow-hidden">
        {desktopControls ? <DesktopTitlebar controls={desktopControls} /> : null}

        {error && (
          <div className="bg-red-600 text-white px-8 py-4 flex items-center justify-between shadow-lg z-60 sticky top-0 pharma-slide-down">
            <div className="flex items-center gap-3">
              <AlertCircle className="w-5 h-5 shrink-0" />
              <p className="text-sm font-bold tracking-tight">{error}</p>
            </div>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-1.5 bg-white/20 hover:bg-white/30 rounded-lg text-xs font-bold uppercase tracking-widest transition-colors"
            >
              {t('Retry')}
            </button>
          </div>
        )}

        <header className="h-24 bg-white/80 backdrop-blur-md border-b border-[#5A5A40]/5 flex items-center justify-between px-6 shrink-0 z-20">
          <div className="flex items-center gap-4 min-w-0">
            <div className="flex flex-col">
              <h2 className="text-xl font-bold text-[#5A5A40]">{currentMenuItem?.label || t(currentView.replace('-', ' '))}</h2>
              <p className="text-[10px] text-[#5A5A40]/40 uppercase tracking-widest font-bold">
                {new Date().toLocaleDateString('ru-RU', { weekday: 'long', month: 'long', day: 'numeric' })}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden md:flex items-center gap-2 px-4 py-2 bg-[#f5f5f0] rounded-2xl border border-[#5A5A40]/5">
              <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div>
              <span className="text-[10px] font-bold text-[#5A5A40]/60 uppercase tracking-widest">{t('Server Connected')}</span>
            </div>

            <div className="flex items-center gap-3 pl-3 border-l border-[#5A5A40]/10">
              <div className="text-right hidden sm:block">
                <p className="text-sm font-bold text-[#5A5A40]">{user.name}</p>
                <p className="text-[10px] text-[#5A5A40]/40 uppercase tracking-widest font-bold">{user.role}</p>
              </div>
              <div className="w-12 h-12 bg-[#f5f5f0] rounded-2xl flex items-center justify-center text-[#5A5A40] font-bold border-2 border-white shadow-md">
                {user.name.charAt(0)}
              </div>
            </div>
          </div>
        </header>

        <div className={`flex min-h-0 flex-1 flex-col p-6 custom-scrollbar relative ${currentView === 'pos' ? 'overflow-hidden' : 'overflow-y-auto'}`}>
          <div key={currentView} className="pharma-view-enter flex h-full min-h-0 flex-col">
            <ViewErrorBoundary onReset={() => setCurrentView('dashboard')}>
              <Suspense fallback={<AppLoader compact label="Загружаем раздел" />}>
                {renderView()}
              </Suspense>
            </ViewErrorBoundary>
          </div>
        </div>

        <footer className="h-10 bg-white/50 backdrop-blur-sm border-t border-[#5A5A40]/5 flex items-center justify-between px-8 text-[10px] text-[#5A5A40]/40 font-bold uppercase tracking-widest shrink-0">
          <div className="flex items-center gap-4">
            <span>v2.4.0 Стабильная</span>
            <span className="w-1 h-1 bg-[#5A5A40]/20 rounded-full"></span>
            <span>Последняя синхронизация: только что</span>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1">
              <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full"></div>
              <span>База данных онлайн</span>
            </div>
            <span className="w-1 h-1 bg-[#5A5A40]/20 rounded-full"></span>
            <span>© 2026 Системы PharmaPro</span>
          </div>
        </footer>
      </main>
    </div>
  );
}