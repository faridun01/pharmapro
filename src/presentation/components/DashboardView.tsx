import React, { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usePharmacy } from '../context';
import { lazyNamedImport } from '../../lib/lazyLoadComponents';
import { buildApiHeaders } from '../../infrastructure/api';
import { formatProductDisplayName } from '../../lib/productDisplay';
import { markRuntimeOnce } from '../../lib/runtimeMarks';
import { 
  TrendingUp, 
  Package, 
  AlertTriangle, 
  ArrowUpRight, 
  ArrowDownLeft,
  Clock,
  ShieldAlert,
  Receipt,
  Activity
} from 'lucide-react';

type DashboardPeriodPreset = 'month' | 'q1' | 'q2' | 'q3' | 'q4' | 'year';

type DashboardMetricsResponse = {
  lowStock?: { count: number; items: Array<{ productId: string; name: string; currentStock: number; minStock: number }> };
  expiry?: { expired: number; expiringSoon: number };
  invoices?: { unpaidCount: number; unpaidAmount: number; averageUnpaid: number };
  revenue?: { total: number; averageDaily: number; recognizedInvoiceCount: number };
  revenueTrend?: { mode: 'day' | 'month'; items: Array<{ key: string; name: string; sales: number }> };
  finance?: { outstandingOrdinarySales: number; totalDebtorOutstanding: number; writeOffAmountMonth: number; grossMarginMonth: number };
  inventoryHighlights?: {
    totalInventoryUnits: number;
    lowStockItems: Array<{ productId: string; name: string; currentStock: number; minStock: number }>;
    expiringItems: Array<{ id: string; name: string; batchNumber: string; daysLeft: number; severityRank: number; severityLabel: string }>;
  };
  summary?: {
    totalProducts: number;
    totalBatches: number;
    alertCount: number;
  };
};

const DashboardSalesChart = lazyNamedImport(() => import('./DashboardSalesChart'), 'DashboardSalesChart');

export const DashboardView: React.FC = () => {
  const { t } = useTranslation();
  const { products, invoices, user } = usePharmacy();
  const [selectedPeriodPreset, setSelectedPeriodPreset] = useState<DashboardPeriodPreset>('month');
  const [showChart, setShowChart] = useState(false);
  const [serverMetrics, setServerMetrics] = useState<DashboardMetricsResponse | null>(null);

  const formatMoney = (value: number) => `${Number(value || 0).toFixed(2)} TJS`;
  const getProductDisplayLabel = (productId: string | undefined, fallbackName: string) => {
    const product = products.find((entry) => entry.id === productId);
    return formatProductDisplayName({
      name: fallbackName,
      manufacturer: product?.manufacturer,
      countryOfOrigin: product?.countryOfOrigin,
    }, {
      includeManufacturer: true,
      includeCountry: true,
    });
  };

  useEffect(() => {
    const timer = window.setTimeout(() => setShowChart(true), 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    markRuntimeOnce('dashboard-view-mounted', {
      selectedPeriodPreset,
      userId: user?.id,
    });
  }, [selectedPeriodPreset, user?.id]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch(`/api/reports/metrics/dashboard?preset=${selectedPeriodPreset}`, {
          headers: await buildApiHeaders(),
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(payload?.error || 'Не удалось загрузить метрики дашборда');
        }
        if (!cancelled) {
          setServerMetrics(payload as DashboardMetricsResponse);
        }
      } catch {
        if (!cancelled) {
          setServerMetrics(null);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedPeriodPreset]);

  const now = new Date();

  const dashboardPeriod = useMemo(() => {
    if (selectedPeriodPreset === 'month') {
      return {
        from: new Date(now.getFullYear(), now.getMonth(), 1),
        to: now,
        label: 'Текущий месяц',
        chartMode: 'day' as const,
      };
    }

    if (selectedPeriodPreset === 'year') {
      return {
        from: new Date(now.getFullYear(), 0, 1),
        to: now,
        label: 'Год',
        chartMode: 'month' as const,
      };
    }

    const quarterMap: Record<'q1' | 'q2' | 'q3' | 'q4', { monthIndex: number; label: string }> = {
      q1: { monthIndex: 0, label: '1 квартал' },
      q2: { monthIndex: 3, label: '2 квартал' },
      q3: { monthIndex: 6, label: '3 квартал' },
      q4: { monthIndex: 9, label: '4 квартал' },
    };

    const quarter = quarterMap[selectedPeriodPreset as 'q1' | 'q2' | 'q3' | 'q4'];
    const from = new Date(now.getFullYear(), quarter.monthIndex, 1);
    const quarterEnd = new Date(now.getFullYear(), quarter.monthIndex + 3, 0, 23, 59, 59, 999);

    return {
      from,
      to: quarterEnd < now ? quarterEnd : now,
      label: quarter.label,
      chartMode: 'month' as const,
    };
  }, [now, selectedPeriodPreset]);

  const totalStock = products.reduce((acc, p) => acc + p.totalStock, 0);
  const lowStockCount = products.filter(p => p.totalStock < (p.minStock || 10)).length;

  const expiredCount = products.reduce((acc, p) => {
    const expired = p.batches.filter((b) => new Date(b.expiryDate).getTime() < now.getTime());
    return acc + expired.length;
  }, 0);

  const expiringSoonCount = products.reduce((acc, p) => {
    const expiring = p.batches.filter(b => {
      const daysLeft = (new Date(b.expiryDate).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24);
      return daysLeft > 0 && daysLeft < 30;
    });
    return acc + expiring.length;
  }, 0);

  const toRelativeTime = (dateValue: Date | string) => {
    const date = new Date(dateValue as any);
    if (Number.isNaN(date.getTime())) return t('unknown');
    const diffMs = now.getTime() - date.getTime();
    const mins = Math.floor(diffMs / (1000 * 60));
    if (mins < 1) return t('just now');
    if (mins < 60) return `${mins} мин. ${t('ago')}`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours} ч. ${t('ago')}`;
    const days = Math.floor(hours / 24);
    return `${days} дн. ${t('ago')}`;
  };

  const movementActivity = products.flatMap((p) =>
    p.batches.flatMap((b) =>
      b.movements.map((m) => ({
        id: `mov-${m.id}`,
        productId: p.id,
        type:
          m.type === 'RESTOCK'
            ? ('restock' as const)
            : m.type === 'WRITE_OFF'
            ? ('writeoff' as const)
            : ('adjustment' as const),
        title:
          m.type === 'RESTOCK'
            ? `${t('Restock')} ${getProductDisplayLabel(p.id, p.name)}`
            : m.type === 'WRITE_OFF'
            ? `${t('Write-off')} ${getProductDisplayLabel(p.id, p.name)}`
            : `${t('Stock adjustment')} ${getProductDisplayLabel(p.id, p.name)}`,
        time: toRelativeTime(m.date),
        amount: Number(m.quantity || 0),
        date: new Date(m.date as any),
        subtitle: m.type === 'RESTOCK' ? `Приход ${Number(m.quantity || 0)} ед.` : `Изменение ${Number(m.quantity || 0)} ед.`,
      }))
    )
  );

  const invoiceActivity = invoices.map((invoice) => {
    const isReturned = invoice.status === 'RETURNED' || invoice.status === 'PARTIALLY_RETURNED';
    const soldUnits = (invoice.items || []).reduce((sum, item) => sum + Number(item.quantity || 0), 0);

    if (isReturned) {
      return {
        id: `inv-${invoice.id}`,
        type: 'return' as const,
        title: `Возврат по накладной ${invoice.invoiceNo || invoice.id}`,
        subtitle: `${soldUnits} ед. • ${Number(invoice.totalAmount || 0).toFixed(2)} TJS`,
        amount: Number(invoice.totalAmount || 0),
        time: toRelativeTime(invoice.createdAt),
        date: new Date(invoice.createdAt as any),
      };
    }


    return {
      id: `inv-${invoice.id}`,
      type: 'sale' as const,
      title: `Продажа ${invoice.paymentType === 'CARD' ? 'по карте' : 'за наличные'}`,
      subtitle: `${soldUnits} ед. • ${Number(invoice.totalAmount || 0).toFixed(2)} TJS`,
      amount: Number(invoice.totalAmount || 0),
      time: toRelativeTime(invoice.createdAt),
      date: new Date(invoice.createdAt as any),
    };
  });

  const recentActivity = [...invoiceActivity, ...movementActivity]
    .filter((a) => !Number.isNaN(a.date.getTime()))
    .sort((a, b) => b.date.getTime() - a.date.getTime())
    .slice(0, 5);

  const lowStockProducts = products
    .filter((product) => product.totalStock < (product.minStock || 10))
    .sort((left, right) => {
      const leftGap = left.totalStock - (left.minStock || 10);
      const rightGap = right.totalStock - (right.minStock || 10);
      return leftGap - rightGap;
    })
    .slice(0, 5);

  const expiringProducts = products
    .flatMap((product) =>
      product.batches.map((batch) => {
        const expiryDate = new Date(batch.expiryDate);
        const daysLeft = Math.ceil((expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        let severityRank = 3;
        let severityLabel = 'Стабильно';
        if (daysLeft <= 0) {
          severityRank = 0;
          severityLabel = 'Просрочено';
        } else if (daysLeft <= 30) {
          severityRank = 1;
          severityLabel = 'Критично';
        } else if (daysLeft <= 90) {
          severityRank = 2;
          severityLabel = 'Скоро истекает';
        }

        return {
          id: batch.id,
          name: product.name,
          batchNumber: batch.batchNumber,
          daysLeft,
          severityRank,
          severityLabel,
        };
      })
    )
    .filter((item) => item.daysLeft <= 90)
    .sort((left, right) => {
      if (left.severityRank !== right.severityRank) return left.severityRank - right.severityRank;
      return left.daysLeft - right.daysLeft;
    })
    .slice(0, 5);

  const statTotalInventory = serverMetrics?.inventoryHighlights?.totalInventoryUnits ?? totalStock;
  const statTotalProducts = serverMetrics?.summary?.totalProducts ?? products.length;
  const statLowStockCount = serverMetrics?.lowStock?.count ?? lowStockCount;
  const statExpiringSoonCount = serverMetrics?.expiry?.expiringSoon ?? expiringSoonCount;
  const statSalesInPeriod = serverMetrics?.revenue?.total ?? 0;
  const statSalesCountInPeriod = serverMetrics?.revenue?.recognizedInvoiceCount ?? 0;
  const adminWriteOffAmount = serverMetrics?.finance?.writeOffAmountMonth ?? 0;
  const adminGrossMargin = serverMetrics?.finance?.grossMarginMonth ?? 0;
  const lowStockWidgetItems = serverMetrics?.inventoryHighlights?.lowStockItems ?? lowStockProducts.map((product) => ({ productId: product.id, name: product.name, currentStock: product.totalStock, minStock: product.minStock || 10 }));
  const expiringWidgetItems = serverMetrics?.inventoryHighlights?.expiringItems ?? expiringProducts;
  const chartData = serverMetrics?.revenueTrend?.items ?? [];

  const stats = [
    { label: 'Наименований товаров', value: statTotalProducts.toLocaleString(), icon: Package, color: 'bg-sky-500', trend: statTotalProducts > 0 ? `${statTotalProducts}` : '0' },
    { label: 'Общий остаток, шт.', value: statTotalInventory.toLocaleString(), icon: Package, color: 'bg-blue-500', trend: statTotalInventory > 0 ? `${statTotalInventory}` : '0' },
    { label: t('Low Stock Items'), value: statLowStockCount.toString(), icon: AlertTriangle, color: 'bg-amber-500', trend: statLowStockCount > 0 ? `${statLowStockCount}` : '0' },
    { label: t('Expiring Soon'), value: statExpiringSoonCount.toString(), icon: Clock, color: 'bg-red-500', trend: statExpiringSoonCount > 0 ? `${statExpiringSoonCount}` : '0' },
    {
      label: `${t('Sales')} (${dashboardPeriod.label})`,
      value: formatMoney(statSalesInPeriod),
      icon: TrendingUp,
      color: 'bg-emerald-500',
      trend: statSalesCountInPeriod > 0 ? `${statSalesCountInPeriod}` : '0',
    },
  ];

  const adminCards = [
    {
      label: t('Expired Batches'),
      value: String(expiredCount),
      icon: ShieldAlert,
      tone: 'bg-red-100 text-red-700',
    },
    {
      label: `${t('Write-off Cost')} за месяц`,
      value: formatMoney(adminWriteOffAmount),
      icon: AlertTriangle,
      tone: 'bg-orange-100 text-orange-700',
    },
    {
      label: `${t('Gross Margin')} за месяц`,
      value: formatMoney(adminGrossMargin),
      icon: Activity,
      tone: 'bg-emerald-100 text-emerald-700',
    },
  ];

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold text-[#5A5A40] tracking-tight">{t('Pharmacy Overview')}</h2>
          <p className="text-[#5A5A40]/60 mt-1 italic">{t('Real-time analytics and inventory status')}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6">
        {stats.map((stat, i) => (
          <div key={i} className="bg-white p-6 rounded-3xl shadow-sm border border-[#5A5A40]/5 hover:shadow-md transition-shadow">
            <div className="flex items-start justify-between mb-4">
              <div className={`p-3 rounded-2xl ${stat.color} text-white shadow-lg`}>
                <stat.icon size={24} />
              </div>
              <span className={`text-xs font-bold px-2 py-1 rounded-full ${stat.trend.startsWith('+') ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                {stat.trend}
              </span>
            </div>
            <h3 className="text-[#5A5A40]/60 text-sm font-medium uppercase tracking-wider">{stat.label}</h3>
            <p className="text-3xl font-bold text-[#5A5A40] mt-1">{stat.value}</p>
          </div>
        ))}
      </div>

      {(user?.role === 'ADMIN' || user?.role === 'OWNER') && (
        <div className="space-y-6">
          <div className="bg-white p-8 rounded-3xl shadow-sm border border-[#5A5A40]/5">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-bold text-[#5A5A40]">{t('Admin Risk & Finance')}</h3>
              <p className="text-sm text-[#5A5A40]/60">{t('Live operational controls')}</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {adminCards.map((card) => (
                <div key={card.label} className="rounded-2xl border border-[#5A5A40]/10 p-4">
                  <div className="flex items-center justify-between">
                    <p className="text-xs uppercase tracking-wider text-[#5A5A40]/60 font-bold">{card.label}</p>
                    <div className={`p-2 rounded-xl ${card.tone}`}>
                      <card.icon size={16} />
                    </div>
                  </div>
                  <p className="text-2xl font-bold text-[#5A5A40] mt-3">{card.value}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 bg-white p-8 rounded-3xl shadow-sm border border-[#5A5A40]/5">
          <div className="flex items-center justify-between mb-8">
            <h3 className="text-xl font-bold text-[#5A5A40]">{t('Sales Performance')}</h3>
            <select
              className="bg-[#f5f5f0] border-none rounded-xl px-4 py-2 text-sm text-[#5A5A40] outline-none"
              value={selectedPeriodPreset}
              onChange={(e) => setSelectedPeriodPreset(e.target.value as DashboardPeriodPreset)}
            >
              <option value="month">Текущий месяц</option>
              <option value="q1">1 квартал</option>
              <option value="q2">2 квартал</option>
              <option value="q3">3 квартал</option>
              <option value="q4">4 квартал</option>
              <option value="year">Год</option>
            </select>
          </div>
          <div className="h-75 w-full md:h-90">
            {showChart ? (
              <Suspense fallback={<div className="h-full w-full rounded-2xl bg-[#f5f5f0] animate-pulse" />}>
                <DashboardSalesChart data={chartData} />
              </Suspense>
            ) : (
              <div className="h-full w-full rounded-2xl bg-[#f5f5f0] animate-pulse" />
            )}
          </div>
        </div>

        <div className="bg-white p-8 rounded-3xl shadow-sm border border-[#5A5A40]/5">
          <h3 className="text-xl font-bold text-[#5A5A40] mb-6">Последняя активность</h3>
          <div className="space-y-6">
            {recentActivity.length === 0 && (
              <p className="text-sm text-[#5A5A40]/60">Пока нет свежих продаж, долгов или складских событий</p>
            )}
            {recentActivity.map((activity) => (
              <div key={activity.id} className="flex gap-4">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                  activity.type === 'sale' ? 'bg-emerald-100 text-emerald-700' :
                  activity.type === 'return' ? 'bg-orange-100 text-orange-700' :
                  activity.type === 'restock' ? 'bg-blue-100 text-blue-600' :
                  'bg-stone-100 text-stone-700'
                }`}>
                  {activity.type === 'sale' ? <TrendingUp size={20} /> :
                   activity.type === 'return' ? <ArrowUpRight size={20} /> :
                   activity.type === 'restock' ? <ArrowDownLeft size={20} /> :
                   <AlertTriangle size={20} />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-[#5A5A40] truncate">{t(activity.title)}</p>
                  <p className="text-xs text-[#5A5A40]/60 mt-0.5">{activity.subtitle}</p>
                  <p className="text-xs text-[#5A5A40]/45 mt-1">{activity.time}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-sm font-bold text-[#5A5A40]">{formatMoney(activity.amount)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="bg-white p-8 rounded-3xl shadow-sm border border-[#5A5A40]/5">
          <h3 className="text-xl font-bold text-[#5A5A40] mb-6">Товары с низким остатком</h3>
          <div className="space-y-4">
            {lowStockWidgetItems.length === 0 && (
              <p className="text-sm text-[#5A5A40]/60">Критически низких остатков нет</p>
            )}
            {lowStockWidgetItems.map((product, index) => (
              <div key={product.productId} className="flex items-center justify-between gap-4 border-b border-[#5A5A40]/10 pb-4 last:border-b-0 last:pb-0">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center text-xs font-bold shrink-0">{index + 1}</div>
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-[#5A5A40] truncate">{getProductDisplayLabel(product.productId, product.name)}</p>
                    <p className="text-xs text-[#5A5A40]/60">Минимум: {product.minStock || 10}</p>
                  </div>
                </div>
                <span className="text-sm font-bold text-amber-700">{product.currentStock}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white p-8 rounded-3xl shadow-sm border border-[#5A5A40]/5">
          <h3 className="text-xl font-bold text-[#5A5A40] mb-6">Скоро просроченные товары</h3>
          <div className="space-y-4">
            {expiringWidgetItems.length === 0 && (
              <p className="text-sm text-[#5A5A40]/60">Товаров с близким сроком годности нет</p>
            )}
            {expiringWidgetItems.map((item, index) => (
              <div key={item.id} className="flex items-center justify-between gap-4 border-b border-[#5A5A40]/10 pb-4 last:border-b-0 last:pb-0">
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`w-8 h-8 rounded-xl flex items-center justify-center text-xs font-bold shrink-0 ${item.severityRank === 0 ? 'bg-red-100 text-red-700' : item.severityRank === 1 ? 'bg-orange-100 text-orange-700' : 'bg-amber-100 text-amber-700'}`}>{index + 1}</div>
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-[#5A5A40] truncate">{getProductDisplayLabel(undefined, item.name)}</p>
                    <p className="text-xs text-[#5A5A40]/60">Партия {item.batchNumber} • {item.severityLabel}</p>
                  </div>
                </div>
                <span className={`text-sm font-bold ${item.severityRank === 0 ? 'text-red-700' : item.severityRank === 1 ? 'text-orange-700' : 'text-amber-700'}`}>{item.daysLeft <= 0 ? 'Просрочен' : `${item.daysLeft} дн.`}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
