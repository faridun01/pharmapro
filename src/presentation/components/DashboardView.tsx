import React, { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usePharmacy } from '../context';
import { lazyNamedImport } from '../../lib/lazyLoadComponents';
import { buildApiHeaders } from '../../infrastructure/api';
import { formatProductDisplayName } from '../../lib/productDisplay';
import { formatMoney } from './reports/utils';
import {
  TrendingUp,
  Package,
  AlertTriangle,
  ArrowUpRight,
  ArrowDownLeft,
  Clock,
  ShieldAlert,
  Activity,
  ChevronRight,
  Target
} from 'lucide-react';

type DashboardPeriodPreset = 'month' | 'q1' | 'q2' | 'q3' | 'q4' | 'year';

type DashboardMetricsResponse = {
  lowStock?: { count: number; items: Array<{ productId: string; name: string; currentStock: number; minStock: number }> };
  expiry?: { expired: number; expiringSoon: number };
  revenue?: { total: number; averageDaily: number; recognizedInvoiceCount: number };
  revenueTrend?: { mode: 'day' | 'month'; items: Array<{ key: string; name: string; sales: number }> };
  finance?: { writeOffAmountMonth: number; grossMarginMonth: number };
  inventoryHighlights?: {
    totalInventoryUnits: number;
    lowStockItems: Array<{ productId: string; name: string; currentStock: number; minStock: number }>;
    expiringItems: Array<{ id: string; name: string; batchNumber: string; daysLeft: number; severityRank: number; severityLabel: string }>;
  };
  summary?: {
    totalProducts: number;
  };
};

const DashboardSalesChart = lazyNamedImport(() => import('./DashboardSalesChart'), 'DashboardSalesChart');

export const DashboardView: React.FC = () => {
  const { t } = useTranslation();
  const { products, invoices, user } = usePharmacy();
  const [selectedPeriodPreset, setSelectedPeriodPreset] = useState<DashboardPeriodPreset>('month');
  const [showChart, setShowChart] = useState(false);
  const [serverMetrics, setServerMetrics] = useState<DashboardMetricsResponse | null>(null);


  useEffect(() => {
    const timer = window.setTimeout(() => setShowChart(true), 150);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(`/api/reports/metrics/dashboard?preset=${selectedPeriodPreset}`, {
          headers: await buildApiHeaders(),
        });
        const payload = await response.json();
        if (response.ok && !cancelled) setServerMetrics(payload);
      } catch (err) {
        console.error('Dashboard metrics load failed', err);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedPeriodPreset]);

  // Client-side calculations as fallbacks
  const now = useMemo(() => new Date(), []);
  const totalStock = useMemo(() => products.reduce((acc, p) => acc + p.totalStock, 0), [products]);

  const activityData = useMemo(() => {
    const invoiceActs = invoices.map(inv => ({
      id: inv.id,
      type: (inv.status === 'RETURNED' || inv.status === 'PARTIALLY_RETURNED') ? 'return' : 'sale',
      title: inv.status.includes('RETURN') ? `Возврат №${inv.invoiceNo}` : `Продажа №${inv.invoiceNo}`,
      amount: Number(inv.totalAmount || 0),
      time: new Date(inv.createdAt),
      subtitle: `${(inv.items || []).length} товаров • ${inv.paymentType}`
    }));

    return invoiceActs
      .sort((a, b) => b.time.getTime() - a.time.getTime())
      .slice(0, 5);
  }, [invoices]);

  const dashboardPeriodLabel = useMemo(() => {
    const labels: Record<string, string> = { month: 'Месяц', q1: 'Q1', q2: 'Q2', q3: 'Q3', q4: 'Q4', year: 'Год' };
    return labels[selectedPeriodPreset] || 'Период';
  }, [selectedPeriodPreset]);

  const stats = [
    { label: 'Номенклатура', value: serverMetrics?.summary?.totalProducts ?? products.length, sub: 'Всего товаров', icon: Package, color: 'text-blue-500', bg: 'bg-blue-50' },
    { label: 'Складской запас', value: serverMetrics?.inventoryHighlights?.totalInventoryUnits ?? totalStock, sub: 'Единиц в наличии', icon: Activity, color: 'text-emerald-500', bg: 'bg-emerald-50' },
    { label: 'Низкий остаток', value: serverMetrics?.lowStock?.count ?? 0, sub: 'Требуют закупа', icon: AlertTriangle, color: 'text-amber-500', bg: 'bg-amber-50' },
    { label: 'Срок годности', value: serverMetrics?.expiry?.expiringSoon ?? 0, sub: 'Критическая зона', icon: Clock, color: 'text-rose-500', bg: 'bg-rose-50' },
    { label: `Выручка (${dashboardPeriodLabel})`, value: formatMoney(serverMetrics?.revenue?.total ?? 0, 'TJS'), sub: `${serverMetrics?.revenue?.recognizedInvoiceCount ?? 0} чеков`, icon: TrendingUp, color: 'text-indigo-500', bg: 'bg-indigo-50' },
  ];

  return (
    <div className="max-w-[1600px] mx-auto space-y-10 pb-12 animate-in fade-in duration-700 font-normal">

      {/* Header section with period selector */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 px-1">
        <div>
          <h2 className="text-3xl font-normal text-[#151619] tracking-tight">{t('Главная панель')}</h2>
          <p className="text-[#5A5A40]/50 mt-1 text-sm uppercase tracking-widest">{t('Операционный центр аптеки')}</p>
        </div>
        <div className="flex bg-white/40 p-1 rounded-2xl border border-[#5A5A40]/5 shadow-sm">
          {(['month', 'q1', 'q2', 'q3', 'q4', 'year'] as DashboardPeriodPreset[]).map((p) => (
            <button
              key={p}
              onClick={() => setSelectedPeriodPreset(p)}
              className={`px-4 py-2 rounded-xl text-[10px] uppercase tracking-widest transition-all ${selectedPeriodPreset === p ? 'bg-[#5A5A40] text-white shadow-md' : 'text-[#5A5A40]/50 hover:bg-[#5A5A40]/5'}`}
            >
              {p === 'month' ? 'Месяц' : p.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {/* Main Stats Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-6">
        {stats.map((stat, i) => (
          <div key={i} className="group bg-white/60 hover:bg-white border border-white rounded-[2.5rem] p-7 shadow-sm hover:shadow-2xl hover:shadow-[#5A5A40]/5 transition-all relative overflow-hidden transform-gpu">
            <div className={`absolute top-0 right-0 w-32 h-32 ${stat.bg} rounded-full -mr-16 -mt-16 opacity-40 transition-transform group-hover:scale-110`} />
            <div className="relative z-10">
              <div className={`${stat.bg} ${stat.color} w-12 h-12 rounded-2xl flex items-center justify-center mb-6 shadow-inner`}>
                <stat.icon size={22} />
              </div>
              <h3 className="text-[10px] text-[#5A5A40]/40 uppercase tracking-[0.2em] mb-1">{stat.label}</h3>
              <p className={`text-xl font-normal text-[#151619] tracking-tight truncate`}>{stat.value}</p>
              <p className="text-[10px] text-[#5A5A40]/30 mt-2 italic">{stat.sub}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Secondary Row: Chart and Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

        {/* Sales Chart Container */}
        <div className="lg:col-span-2 bg-white rounded-[3rem] p-10 shadow-sm border border-white relative overflow-hidden group transform-gpu">
          <div className="flex items-center justify-between mb-10 relative z-10">
            <div className="flex items-center gap-3">
              <div className="w-1.5 h-6 bg-indigo-500 rounded-full" />
              <h3 className="text-xl font-normal text-[#151619] tracking-tight">{t('Sales Dynamics')}</h3>
            </div>
            <p className="text-[10px] text-[#5A5A40]/40 uppercase tracking-widest">{dashboardPeriodLabel} • {formatMoney(serverMetrics?.revenue?.total ?? 0, 'TJS')}</p>
          </div>

          <div className="h-[320px] w-full relative z-10">
            {showChart && serverMetrics?.revenueTrend?.items ? (
              <Suspense fallback={<div className="h-full w-full bg-[#f8f7f2] animate-pulse rounded-3xl" />}>
                <DashboardSalesChart data={serverMetrics.revenueTrend.items} />
              </Suspense>
            ) : (
              <div className="h-full w-full flex items-center justify-center bg-[#f8f7f2]/50 rounded-[2rem] border border-dashed border-[#5A5A40]/10">
                <p className="text-[10px] uppercase tracking-widest text-[#5A5A40]/30 animate-pulse">Сбор аналитики...</p>
              </div>
            )}
          </div>
        </div>

        {/* Recent Activity Mini-Widget */}
        <div className="bg-white rounded-[3rem] p-10 shadow-sm border border-white flex flex-col overflow-hidden transform-gpu">
          <div className="flex items-center justify-between mb-8">
            <h3 className="text-xl font-normal text-[#151619] tracking-tight">Активность</h3>
            <Activity size={18} className="text-[#5A5A40]/20" />
          </div>
          <div className="flex-1 space-y-6">
            {activityData.map((act) => (
              <div key={act.id} className="flex items-start gap-4 group cursor-pointer">
                <div className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 transition-transform group-hover:scale-95 ${act.type === 'sale' ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'}`}>
                  {act.type === 'sale' ? <ArrowDownLeft size={18} /> : <ArrowUpRight size={18} />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] text-[#151619] truncate font-normal">{act.title}</p>
                  <p className="text-[10px] text-[#5A5A40]/50 lowercase italic mt-0.5">{act.subtitle}</p>
                  <p className="text-[9px] text-[#5A5A40]/30 uppercase tracking-tighter mt-1">{act.time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-[13px] text-[#151619] font-normal">{Number(act.amount).toFixed(2)}</p>
                  <p className="text-[9px] text-[#5A5A40]/30">TJS</p>
                </div>
              </div>
            ))}
            {activityData.length === 0 && (
              <div className="h-full flex flex-col items-center justify-center text-center py-10">
                <Target size={32} className="text-stone-200 mb-3" />
                <p className="text-xs text-[#5A5A40]/30 font-normal italic">Сегодня без операций</p>
              </div>
            )}
          </div>
          <button className="mt-8 py-4 border border-[#5A5A40]/5 rounded-2xl text-[10px] uppercase tracking-widest text-[#5A5A40]/40 hover:bg-[#f5f5f0] hover:text-[#5A5A40] transition-all flex items-center justify-center gap-2">
            Весь журнал <ChevronRight size={12} />
          </button>
        </div>
      </div>

      {/* Critical Risks Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">

        {/* Low Stock List */}
        <div className="bg-white rounded-[3rem] p-10 shadow-sm border border-white">
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-amber-50 text-amber-600 rounded-xl"><AlertTriangle size={18} /></div>
              <h3 className="text-xl font-normal text-[#151619] tracking-tight">Пороговые остатки</h3>
            </div>
            <span className="text-[10px] bg-amber-50 text-amber-600 px-3 py-1 rounded-full uppercase tracking-widest leading-none">Внимание</span>
          </div>

          <div className="space-y-4">
            {(serverMetrics?.inventoryHighlights?.lowStockItems || []).slice(0, 5).map((item, idx) => (
              <div key={item.productId} className="flex items-center justify-between p-4 hover:bg-[#f8f7f2]/50 rounded-2xl transition-all border border-transparent hover:border-[#5A5A40]/5">
                <div className="flex items-center gap-4 min-w-0">
                  <span className="text-[10px] text-[#5A5A40]/20 font-normal">0{idx + 1}</span>
                  <div className="min-w-0">
                    <p className="text-sm text-[#151619] truncate">{item.name}</p>
                    <p className="text-[10px] text-[#5A5A40]/40 mt-0.5 uppercase tracking-widest italic">Мин: {item.minStock} ед.</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm text-amber-600 font-normal">{item.currentStock}</p>
                  <p className="text-[9px] text-[#5A5A40]/30 lowercase">осталось</p>
                </div>
              </div>
            ))}
            {(!serverMetrics?.inventoryHighlights?.lowStockItems?.length) && (
              <p className="text-xs text-[#5A5A40]/40 text-center py-6 italic font-normal uppercase tracking-widest">Все товары в достаточном количестве</p>
            )}
          </div>
        </div>

        {/* Expiry Risk List */}
        <div className="bg-white rounded-[3rem] p-10 shadow-sm border border-white">
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-rose-50 text-rose-600 rounded-xl"><ShieldAlert size={18} /></div>
              <h3 className="text-xl font-normal text-[#151619] tracking-tight">Контроль сроков</h3>
            </div>
            <span className="text-[10px] bg-rose-50 text-rose-600 px-3 py-1 rounded-full uppercase tracking-widest leading-none">Риски</span>
          </div>

          <div className="space-y-4">
            {(serverMetrics?.inventoryHighlights?.expiringItems || []).slice(0, 5).map((item, idx) => (
              <div key={item.id} className="flex items-center justify-between p-4 hover:bg-rose-50/20 rounded-2xl transition-all border border-transparent hover:border-rose-100/30">
                <div className="flex items-center gap-4 min-w-0">
                  <span className="text-[10px] text-[#5A5A40]/20 font-normal">0{idx + 1}</span>
                  <div className="min-w-0">
                    <p className="text-sm text-[#151619] truncate">{item.name}</p>
                    <p className="text-[10px] text-[#5A5A40]/40 mt-0.5 uppercase tracking-widest italic">Партия: {item.batchNumber}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className={`text-sm font-normal ${item.daysLeft <= 30 ? 'text-rose-600' : 'text-[#5A5A40]'}`}>
                    {item.daysLeft <= 0 ? 'Срок истек' : `${item.daysLeft} дн.`}
                  </p>
                  <p className="text-[9px] text-[#5A5A40]/30 lowercase">{item.daysLeft <= 0 ? 'утилизация' : 'до списания'}</p>
                </div>
              </div>
            ))}
            {(!serverMetrics?.inventoryHighlights?.expiringItems?.length) && (
              <p className="text-xs text-[#5A5A40]/40 text-center py-6 italic font-normal uppercase tracking-widest">Просроченных товаров не обнаружено</p>
            )}
          </div>
        </div>

      </div>

      {/* Finance Row (Admin only) */}
      {(user?.role === 'ADMIN' || user?.role === 'OWNER') && (
        <div className="bg-[#151619] rounded-[3rem] p-10 shadow-2xl shadow-indigo-500/10 text-white relative overflow-hidden">
          <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/10 rounded-full -mr-32 -mt-32 blur-3xl opacity-30" />
          <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-10">
            <div>
              <h3 className="text-2xl font-normal tracking-tight mb-2">Финансовый результат</h3>
              <p className="text-indigo-200/40 text-xs uppercase tracking-[0.3em]">Расчет прибыли за текущий период</p>
            </div>
            <div className="flex flex-wrap gap-12">
              <div>
                <p className="text-indigo-200/30 text-[10px] uppercase tracking-widest mb-3 italic">Валовая прибыль</p>
                <p className="text-3xl font-normal text-indigo-400 tabular-nums">{formatMoney(serverMetrics?.finance?.grossMarginMonth ?? 0, 'TJS')}</p>
              </div>
              <div className="w-px h-16 bg-white/10 hidden md:block" />
              <div>
                <p className="text-indigo-200/30 text-[10px] uppercase tracking-widest mb-3 italic">Списания за месяц</p>
                <p className="text-3xl font-normal text-rose-400 tabular-nums">-{formatMoney(serverMetrics?.finance?.writeOffAmountMonth ?? 0, 'TJS')}</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DashboardView;
