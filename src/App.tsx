import React, { lazy, Suspense, useMemo, useState } from 'react';
import { 
  LayoutDashboard, 
  Minus,
  ShoppingCart, 
  Package, 
  History, 
  Truck, 
  BarChart3, 
  FileText,
  Settings, 
  LogOut, 
  Bell, 
  User,
  Menu,
  Square,
  X,
  Plus,
  Pill,
  AlertCircle,
  RotateCcw,
  Trash2,
  Clock
} from 'lucide-react';
import { usePharmacy } from './presentation/context';
import { useTranslation } from 'react-i18next';
import { getShiftClosedEventName, loadLatestClosedShiftNotice } from './lib/shiftCloseNotice';

type ViewErrorBoundaryState = { hasError: boolean; message: string };

type AppNotification = {
  id: string;
  title: string;
  description: string;
  type: 'EXPIRY' | 'LOW_STOCK' | 'SYSTEM' | 'PAYMENT_DUE' | 'OVERDUE_PAYMENT';
  time: string;
  read: boolean;
};

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

type View = 'dashboard' | 'notifications' | 'pos' | 'inventory' | 'batches' | 'invoices' | 'debtors' | 'suppliers' | 'reports' | 'settings' | 'returns' | 'writeoffs' | 'shifts';

const LoginView = lazy(async () => ({ default: (await import('./presentation/components/LoginView')).LoginView }));
const DashboardView = lazy(async () => ({ default: (await import('./presentation/components/DashboardView')).DashboardView }));
const NotificationsView = lazy(async () => ({ default: (await import('./presentation/components/NotificationsView')).NotificationsView }));
const POSView = lazy(async () => ({ default: (await import('./presentation/components/POSView')).POSView }));
const InventoryView = lazy(async () => ({ default: (await import('./presentation/components/InventoryView')).InventoryView }));
const InvoicesView = lazy(async () => ({ default: (await import('./presentation/components/InvoicesView')).InvoicesView }));
const BatchesView = lazy(async () => ({ default: (await import('./presentation/components/BatchesView')).BatchesView }));
const SuppliersView = lazy(async () => ({ default: (await import('./presentation/components/SuppliersView')).SuppliersView }));
const ReportsView = lazy(async () => ({ default: (await import('./presentation/components/ReportsView')).ReportsView }));
const SettingsView = lazy(async () => ({ default: (await import('./presentation/components/SettingsView')).SettingsView }));
const ImportInvoiceModal = lazy(async () => ({ default: (await import('./presentation/components/ImportInvoiceModal')).ImportInvoiceModal }));
const ReturnView = lazy(async () => ({ default: (await import('./presentation/components/ReturnView')).ReturnView }));
const WriteOffView = lazy(async () => ({ default: (await import('./presentation/components/WriteOffView')).WriteOffView }));
const ShiftView = lazy(async () => ({ default: (await import('./presentation/components/ShiftView')).ShiftView }));

const App: React.FC = () => {
  const { t } = useTranslation();
  const { user, logout, isLoading, error, invoices, products } = usePharmacy();
  const desktopControls = (window as Window & {
    pharmaproDesktop?: {
      controls?: {
        minimize: () => void;
        toggleMaximize: () => void;
        close: () => void;
      };
    };
  }).pharmaproDesktop?.controls;
  const [currentView, setCurrentView] = useState<View>('dashboard');
  const [inventorySection, setInventorySection] = useState<'catalog' | 'batches'>('catalog');
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [invoiceSearchPrefill, setInvoiceSearchPrefill] = useState('');
  const [invoicePaymentPrefillId, setInvoicePaymentPrefillId] = useState('');
  const [invoiceDetailsPrefillId, setInvoiceDetailsPrefillId] = useState('');
  const [shiftReportPrefillId, setShiftReportPrefillId] = useState('');
  const [latestClosedShiftNotice, setLatestClosedShiftNotice] = useState(loadLatestClosedShiftNotice());

  React.useEffect(() => {
    const refreshShiftNotice = () => setLatestClosedShiftNotice(loadLatestClosedShiftNotice());

    refreshShiftNotice();
    window.addEventListener('focus', refreshShiftNotice);
    window.addEventListener(getShiftClosedEventName(), refreshShiftNotice as EventListener);

    return () => {
      window.removeEventListener('focus', refreshShiftNotice);
      window.removeEventListener(getShiftClosedEventName(), refreshShiftNotice as EventListener);
    };
  }, []);


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
    const now = new Date();
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

    const paymentNotifications = invoices
      .filter((invoice) => Number(invoice.receivables?.[0]?.remainingAmount || 0) > 0)
      .map((invoice) => {
        const receivable = invoice.receivables?.[0];
        const dueDate = receivable?.dueDate ? new Date(receivable.dueDate) : null;

        if (!dueDate || Number.isNaN(dueDate.getTime())) return null;
        const daysUntilDue = diffInDays(dueDate, now);

        if (daysUntilDue === 1) {
          return {
            id: `payment-due-${invoice.id}`,
            title: 'Оплата от покупателя завтра',
            description: `${invoice.customer || 'Покупатель'}: счет ${invoice.invoiceNo} требует оплаты ${formatDueLabel(daysUntilDue)} на сумму ${Number(receivable?.remainingAmount || 0).toFixed(2)}.`,
            type: 'PAYMENT_DUE' as const,
            time: '1 день',
            read: false,
          };
        }

        if (daysUntilDue < 0) {
          return {
            id: `payment-overdue-${invoice.id}`,
            title: 'Просроченная оплата покупателя',
            description: `${invoice.customer || 'Покупатель'}: счет ${invoice.invoiceNo} просрочен на ${Math.abs(daysUntilDue)} дн. Сумма долга ${Number(receivable?.remainingAmount || 0).toFixed(2)}.`,
            type: 'OVERDUE_PAYMENT' as const,
            time: `${Math.abs(daysUntilDue)} дн.`,
            read: false,
          };
        }

        return null;
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item));

    const lowStockNotifications = products
      .filter((product) => Number(product.totalStock || 0) > 0 && Number(product.totalStock || 0) <= Number(product.minStock || 0))
      .slice(0, 4)
      .map((product) => ({
        id: `low-stock-${product.id}`,
        title: t('Low Stock Alert'),
        description: `${product.name} ниже минимального остатка. Осталось ${product.totalStock} ед.`,
        type: 'LOW_STOCK' as const,
        time: 'сейчас',
        read: false,
      }));

    const expiryNotifications = products
      .flatMap((product) => product.batches.map((batch) => ({ product, batch })))
      .map(({ product, batch }) => ({
        product,
        batch,
        daysUntilExpiry: diffInDays(new Date(batch.expiryDate), now),
      }))
      .filter(({ daysUntilExpiry }) => daysUntilExpiry >= 0 && daysUntilExpiry <= 30)
      .sort((left, right) => left.daysUntilExpiry - right.daysUntilExpiry)
      .slice(0, 4)
      .map(({ product, batch, daysUntilExpiry }) => ({
        id: `expiry-${batch.id}`,
        title: t('Expiry Warning'),
        description: `Партия ${batch.batchNumber} (${product.name}) истекает ${formatDueLabel(daysUntilExpiry)}.`,
        type: 'EXPIRY' as const,
        time: `${daysUntilExpiry} дн.`,
        read: false,
      }));

    return [...systemNotifications, ...paymentNotifications, ...lowStockNotifications, ...expiryNotifications];
  }, [invoices, latestClosedShiftNotice, products, t]);

  const notificationsCount = notifications.length;

  const openInvoicePaymentFlow = (invoiceId?: string) => {
    if (!invoiceId) {
      setCurrentView('debtors');
      return;
    }

    const invoice = invoices.find((item) => item.id === invoiceId);
    setInvoiceSearchPrefill(invoice?.invoiceNo || '');
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
      openInvoicePaymentFlow(invoiceId);
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

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f5f5f0]">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-[#5A5A40]"></div>
      </div>
    );
  }

  if (!user) {
    return (
      <Suspense
        fallback={
          <div className="min-h-screen flex items-center justify-center bg-[#f5f5f0]">
            <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-[#5A5A40]"></div>
          </div>
        }
      >
        <LoginView />
      </Suspense>
    );
  }

  return (
    <div className="flex h-screen bg-[#f5f5f0] font-sans text-[#151619] overflow-hidden">
      {/* Sidebar */}
      <aside
        className="bg-[#151619] text-white flex flex-col relative z-30 shadow-2xl pharma-sidebar"
        style={{ width: isSidebarOpen ? 280 : 80 }}
      >
        <div className="p-6 flex items-center gap-4 border-b border-white/5">
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

        <nav className="flex-1 py-8 px-4 space-y-2 overflow-y-auto custom-scrollbar">
          {menuItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setCurrentView(item.id as View)}
              className={`w-full flex items-center gap-4 px-4 py-3.5 rounded-2xl transition-all group relative ${
                currentView === item.id 
                  ? 'bg-[#5A5A40] text-white shadow-lg' 
                  : 'text-white/40 hover:text-white hover:bg-white/5'
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

        <div className="p-4 border-t border-white/5">
          <button 
            onClick={logout}
            className="w-full flex items-center gap-4 px-4 py-3.5 text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-2xl transition-all group"
          >
            <LogOut size={20} className="group-hover:-translate-x-1 transition-transform" />
            {isSidebarOpen && <span className="font-medium text-sm">{t('Sign Out')}</span>}
          </button>
        </div>

        <button 
          onClick={() => setIsSidebarOpen(!isSidebarOpen)}
          className="absolute -right-4 top-20 w-8 h-8 bg-[#5A5A40] rounded-full flex items-center justify-center text-white shadow-xl hover:scale-110 transition-transform z-40 border-4 border-[#f5f5f0]"
        >
          {isSidebarOpen ? <X size={14} /> : <Menu size={14} />}
        </button>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col relative overflow-hidden">
        {desktopControls ? (
          <div className="app-drag desktop-titlebar shrink-0 flex items-center justify-between pl-4">
            <div className="min-w-0 flex-1" />

            <div className="app-no-drag flex items-center self-stretch">
              <button
                type="button"
                onClick={() => desktopControls.minimize()}
                className="desktop-titlebar__button"
                aria-label="Minimize window"
              >
                <Minus size={14} strokeWidth={2.2} />
              </button>
              <button
                type="button"
                onClick={() => desktopControls.toggleMaximize()}
                className="desktop-titlebar__button"
                aria-label="Toggle maximize window"
              >
                <Square size={12} strokeWidth={2.1} />
              </button>
              <button
                type="button"
                onClick={() => desktopControls.close()}
                className="desktop-titlebar__button desktop-titlebar__button--close"
                aria-label="Close window"
              >
                <X size={14} strokeWidth={2.2} />
              </button>
            </div>
          </div>
        ) : null}

        {/* Error Banner */}
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

        {/* Header */}
        <header className="h-24 bg-white/80 backdrop-blur-md border-b border-[#5A5A40]/5 flex items-center justify-between px-8 shrink-0 z-20">
          <div className="flex items-center gap-6">
            <div className="flex flex-col">
              <h2 className="text-xl font-bold text-[#5A5A40]">{currentMenuItem?.label || t(currentView.replace('-', ' '))}</h2>
              <p className="text-[10px] text-[#5A5A40]/40 uppercase tracking-widest font-bold">
                {new Date().toLocaleDateString('ru-RU', { weekday: 'long', month: 'long', day: 'numeric' })}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="hidden md:flex items-center gap-2 px-4 py-2 bg-[#f5f5f0] rounded-2xl border border-[#5A5A40]/5">
              <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div>
              <span className="text-[10px] font-bold text-[#5A5A40]/60 uppercase tracking-widest">{t('Server Connected')}</span>
            </div>

            <div className="flex items-center gap-3 pl-4 border-l border-[#5A5A40]/10 ml-2">
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

        {/* View Content */}
        <div className="flex-1 overflow-y-auto p-8 custom-scrollbar relative">
          <div key={currentView} className="pharma-view-enter">
            <ViewErrorBoundary onReset={() => setCurrentView('dashboard')}>
              <Suspense
                fallback={
                  <div className="min-h-60 flex items-center justify-center">
                    <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-[#5A5A40]"></div>
                  </div>
                }
              >
                {renderView()}
              </Suspense>
            </ViewErrorBoundary>
          </div>
        </div>

        {/* Footer Info */}
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
};

export default App;
