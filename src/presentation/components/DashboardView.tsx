import React, { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usePharmacy } from '../context';
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

const DashboardSalesChart = lazy(async () => ({
  default: (await import('./DashboardSalesChart')).DashboardSalesChart,
}));

const startOfDay = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate());

const diffInDays = (left: Date, right: Date) => {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round((startOfDay(left).getTime() - startOfDay(right).getTime()) / msPerDay);
};

export const DashboardView: React.FC<{ onOpenInvoicePayment?: (invoiceId?: string) => void }> = ({ onOpenInvoicePayment }) => {
  const { t } = useTranslation();
  const { products, invoices, customers, user } = usePharmacy();
  const [selectedPeriodPreset, setSelectedPeriodPreset] = useState<DashboardPeriodPreset>('month');
  const [showChart, setShowChart] = useState(false);

  const formatMoney = (value: number) => `${Number(value || 0).toFixed(2)} TJS`;

  useEffect(() => {
    const timer = window.setTimeout(() => setShowChart(true), 0);
    return () => window.clearTimeout(timer);
  }, []);

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

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

  const paidInvoices = invoices.filter(
    (inv) => inv.status === 'PAID' || inv.paymentStatus === 'PAID'
  );

  const paidInvoicesInPeriod = paidInvoices.filter((inv) => {
    const created = new Date(inv.createdAt as any);
    if (Number.isNaN(created.getTime())) return false;
    return created >= dashboardPeriod.from && created <= dashboardPeriod.to;
  });

  const unpaidInvoices = invoices.filter(
    (inv) =>
      inv.status === 'PENDING' ||
      inv.paymentStatus === 'UNPAID' ||
      inv.paymentStatus === 'PARTIALLY_PAID'
  );

  const outstandingAmount = unpaidInvoices.reduce(
    (sum, inv) => sum + Number(inv.totalAmount || 0),
    0
  );

  const salesInPeriod = paidInvoicesInPeriod.reduce(
    (sum, inv) => sum + Number(inv.totalAmount || 0),
    0
  );

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

  const writeOffAmount = products.reduce((total, p) => {
    const productWriteOff = p.batches.reduce((batchSum, b) => {
      const movementCost = b.movements
        .filter((m) => {
          if (m.type !== 'WRITE_OFF') return false;
          const movementDate = new Date(m.date as any);
          return !Number.isNaN(movementDate.getTime()) && movementDate >= monthStart && movementDate <= monthEnd;
        })
        .reduce((sum, m) => sum + Number(m.quantity || 0) * Number(b.costBasis || 0), 0);
      return batchSum + movementCost;
    }, 0);
    return total + productWriteOff;
  }, 0);

  const monthlyPaidInvoices = paidInvoices.filter((inv) => {
    const created = new Date(inv.createdAt as any);
    return !Number.isNaN(created.getTime()) && created >= monthStart && created <= monthEnd;
  });

  const grossMarginInPeriod = monthlyPaidInvoices.reduce((sum, inv) => {
    const created = new Date(inv.createdAt as any);
    if (Number.isNaN(created.getTime()) || created < monthStart || created > monthEnd) return sum;

    const invoiceCost = (inv.items || []).reduce((itemSum, item) => {
      const product = products.find((p) => p.id === item.productId);
      const costPrice = Number(product?.costPrice || 0);
      return itemSum + Number(item.quantity || 0) * costPrice;
    }, 0);

    return sum + (Number(inv.totalAmount || 0) - invoiceCost);
  }, 0);

  const salesTrendData = useMemo(() => {
    if (dashboardPeriod.chartMode === 'day') {
      const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
      return Array.from({ length: daysInMonth }, (_, index) => {
        const day = new Date(now.getFullYear(), now.getMonth(), index + 1);
        const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate());
        const dayEnd = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
        const sales = paidInvoicesInPeriod.reduce((sum, inv) => {
          const created = new Date(inv.createdAt as any);
          if (Number.isNaN(created.getTime())) return sum;
          if (created >= dayStart && created < dayEnd) {
            return sum + Number(inv.totalAmount || 0);
          }
          return sum;
        }, 0);

        return {
          name: day.toLocaleDateString(undefined, { day: '2-digit', month: 'short' }),
          sales,
        };
      }).filter((_, index) => index < now.getDate());
    }

    const startMonth = dashboardPeriod.from.getMonth();
    const endMonth = dashboardPeriod.to.getMonth();
    return Array.from({ length: endMonth - startMonth + 1 }, (_, index) => {
      const monthIndex = startMonth + index;
      const monthStartPoint = new Date(now.getFullYear(), monthIndex, 1);
      const monthEndPoint = new Date(now.getFullYear(), monthIndex + 1, 1);
      const sales = paidInvoicesInPeriod.reduce((sum, inv) => {
        const created = new Date(inv.createdAt as any);
        if (Number.isNaN(created.getTime())) return sum;
        if (created >= monthStartPoint && created < monthEndPoint) {
          return sum + Number(inv.totalAmount || 0);
        }
        return sum;
      }, 0);

      return {
        name: monthStartPoint.toLocaleDateString(undefined, { month: 'short' }),
        sales,
      };
    });
  }, [dashboardPeriod.chartMode, dashboardPeriod.from, dashboardPeriod.to, now, paidInvoicesInPeriod]);

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

  const invoiceActivity = invoices.slice(0, 20).map((inv) => ({
    id: `inv-${inv.id}`,
    type: 'sale' as const,
    title: `${t('Invoice')} ${inv.invoiceNo || inv.id}`,
    time: toRelativeTime(inv.createdAt),
    amount: Number(inv.totalAmount || 0),
    date: new Date(inv.createdAt as any),
  }));

  const movementActivity = products.flatMap((p) =>
    p.batches.flatMap((b) =>
      b.movements.map((m) => ({
        id: `mov-${m.id}`,
        type:
          m.type === 'RESTOCK'
            ? ('restock' as const)
            : m.type === 'WRITE_OFF'
            ? ('writeoff' as const)
            : ('adjustment' as const),
        title:
          m.type === 'RESTOCK'
            ? `${t('Restock')} ${p.name}`
            : m.type === 'WRITE_OFF'
            ? `${t('Write-off')} ${p.name}`
            : `${t('Stock adjustment')} ${p.name}`,
        time: toRelativeTime(m.date),
        amount: Number(m.quantity || 0),
        date: new Date(m.date as any),
      }))
    )
  );

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

  const overdueReceivables = useMemo(() => {
    return invoices
      .map((invoice) => {
        const receivable = invoice.receivables?.[0];
        const remainingAmount = Number((invoice as any).outstandingAmount ?? receivable?.remainingAmount ?? 0);
        if (remainingAmount <= 0) return null;

        const customer = customers.find((item) => item.id === invoice.customerId || item.name === invoice.customer);
        const createdAt = new Date(invoice.createdAt as any);
        const dueDate = receivable?.dueDate
          ? new Date(receivable.dueDate)
          : customer?.paymentTermDays && !Number.isNaN(createdAt.getTime())
            ? new Date(createdAt.getTime() + customer.paymentTermDays * 24 * 60 * 60 * 1000)
            : null;

        if (!dueDate || Number.isNaN(dueDate.getTime())) return null;

        const daysUntilDue = diffInDays(dueDate, now);
        if (daysUntilDue >= 0) return null;

        return {
          invoiceId: invoice.id,
          invoiceNo: invoice.invoiceNo || invoice.id,
          customerName: invoice.customer || customer?.name || 'Клиент',
          customerKey: invoice.customerId || customer?.id || invoice.customer || invoice.id,
          remainingAmount,
          daysOverdue: Math.abs(daysUntilDue),
        };
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
      .sort((left, right) => {
        if (right.daysOverdue !== left.daysOverdue) return right.daysOverdue - left.daysOverdue;
        return right.remainingAmount - left.remainingAmount;
      });
  }, [customers, invoices, now]);

  const dueTomorrowReceivables = useMemo(() => {
    return invoices
      .map((invoice) => {
        const receivable = invoice.receivables?.[0];
        const remainingAmount = Number((invoice as any).outstandingAmount ?? receivable?.remainingAmount ?? 0);
        if (remainingAmount <= 0) return null;

        const customer = customers.find((item) => item.id === invoice.customerId || item.name === invoice.customer);
        const createdAt = new Date(invoice.createdAt as any);
        const dueDate = receivable?.dueDate
          ? new Date(receivable.dueDate)
          : customer?.paymentTermDays && !Number.isNaN(createdAt.getTime())
            ? new Date(createdAt.getTime() + customer.paymentTermDays * 24 * 60 * 60 * 1000)
            : null;

        if (!dueDate || Number.isNaN(dueDate.getTime())) return null;

        const daysUntilDue = diffInDays(dueDate, now);
        if (daysUntilDue !== 1) return null;

        return {
          invoiceId: invoice.id,
          invoiceNo: invoice.invoiceNo || invoice.id,
          customerName: invoice.customer || customer?.name || 'Клиент',
          remainingAmount,
        };
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
      .sort((left, right) => right.remainingAmount - left.remainingAmount);
  }, [customers, invoices, now]);

  const overdueAmountTotal = overdueReceivables.reduce((sum, item) => sum + item.remainingAmount, 0);
  const overdueCustomersCount = new Set(overdueReceivables.map((item) => item.customerKey)).size;
  const dueTomorrowAmountTotal = dueTomorrowReceivables.reduce((sum, item) => sum + item.remainingAmount, 0);

  const stats = [
    { label: t('Total Inventory'), value: totalStock.toLocaleString(), icon: Package, color: 'bg-blue-500', trend: '+12%' },
    { label: t('Low Stock Items'), value: lowStockCount.toString(), icon: AlertTriangle, color: 'bg-amber-500', trend: lowStockCount > 0 ? `${lowStockCount}` : '0' },
    { label: t('Expiring Soon'), value: expiringSoonCount.toString(), icon: Clock, color: 'bg-red-500', trend: expiringSoonCount > 0 ? `${expiringSoonCount}` : '0' },
    {
      label: `${t('Sales')} (${dashboardPeriod.label})`,
      value: formatMoney(salesInPeriod),
      icon: TrendingUp,
      color: 'bg-emerald-500',
      trend: paidInvoicesInPeriod.length > 0 ? `${paidInvoicesInPeriod.length}` : '0',
    },
  ];

  const adminCards = [
    {
      label: t('Outstanding Amount'),
      value: formatMoney(outstandingAmount),
      icon: Receipt,
      tone: 'bg-amber-100 text-amber-700',
    },
    {
      label: t('Expired Batches'),
      value: String(expiredCount),
      icon: ShieldAlert,
      tone: 'bg-red-100 text-red-700',
    },
    {
      label: `${t('Write-off Cost')} за месяц`,
      value: formatMoney(writeOffAmount),
      icon: AlertTriangle,
      tone: 'bg-orange-100 text-orange-700',
    },
    {
      label: `${t('Gross Margin')} за месяц`,
      value: formatMoney(grossMarginInPeriod),
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

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
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
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
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

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            <div className="rounded-3xl border border-red-200 bg-[linear-gradient(135deg,#fff4f4_0%,#ffe0e0_100%)] p-8 shadow-sm">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between mb-6">
                <div>
                  <div className="inline-flex items-center gap-2 rounded-full bg-red-100 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.2em] text-red-700">
                    <AlertTriangle size={14} />
                    Просроченные оплаты
                  </div>
                  <h3 className="mt-3 text-2xl font-bold text-[#5A5A40]">Контроль клиентской дебиторки</h3>
                  <p className="mt-1 text-sm text-[#5A5A40]/70">Здесь показываются только счета, по которым уже наступила просрочка оплаты.</p>
                </div>
                <button
                  type="button"
                  onClick={() => onOpenInvoicePayment?.(overdueReceivables[0]?.invoiceId)}
                  disabled={overdueReceivables.length === 0}
                  className="inline-flex items-center justify-center rounded-2xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-red-300"
                >
                  {overdueReceivables.length > 0 ? 'Открыть оплату' : 'Просрочек нет'}
                </button>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div className="rounded-2xl border border-red-100 bg-white/80 p-4">
                  <p className="text-xs font-bold uppercase tracking-widest text-[#5A5A40]/55">Сумма просрочки</p>
                  <p className="mt-2 text-3xl font-bold text-red-700">{formatMoney(overdueAmountTotal)}</p>
                </div>
                <div className="rounded-2xl border border-red-100 bg-white/80 p-4">
                  <p className="text-xs font-bold uppercase tracking-widest text-[#5A5A40]/55">Просроченных счетов</p>
                  <p className="mt-2 text-3xl font-bold text-[#5A5A40]">{overdueReceivables.length}</p>
                </div>
                <div className="rounded-2xl border border-red-100 bg-white/80 p-4">
                  <p className="text-xs font-bold uppercase tracking-widest text-[#5A5A40]/55">Клиентов с просрочкой</p>
                  <p className="mt-2 text-3xl font-bold text-[#5A5A40]">{overdueCustomersCount}</p>
                </div>
              </div>

              <div className="mt-6 space-y-3">
                {overdueReceivables.length === 0 && (
                  <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4 text-sm font-medium text-emerald-700">
                    Сейчас нет клиентских счетов с просроченной оплатой.
                  </div>
                )}

                {overdueReceivables.slice(0, 4).map((item) => (
                  <button
                    key={item.invoiceId}
                    type="button"
                    onClick={() => onOpenInvoicePayment?.(item.invoiceId)}
                    className="flex w-full items-center justify-between gap-4 rounded-2xl border border-red-100 bg-white/85 px-4 py-4 text-left transition-colors hover:bg-white"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-[#5A5A40]">{item.customerName}</p>
                      <p className="mt-1 text-xs text-[#5A5A40]/65">Счет {item.invoiceNo} • {item.daysOverdue} дн. просрочки</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-base font-bold text-red-700">{formatMoney(item.remainingAmount)}</p>
                      <p className="text-[11px] font-semibold uppercase tracking-widest text-red-500">Открыть оплату</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-3xl border border-amber-200 bg-[linear-gradient(135deg,#fff8ef_0%,#ffeacd_100%)] p-8 shadow-sm">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between mb-6">
                <div>
                  <div className="inline-flex items-center gap-2 rounded-full bg-amber-100 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.2em] text-amber-700">
                    <Clock size={14} />
                    К оплате завтра
                  </div>
                  <h3 className="mt-3 text-2xl font-bold text-[#5A5A40]">Счета на завтра</h3>
                  <p className="mt-1 text-sm text-[#5A5A40]/70">Список клиентов, по которым оплата должна поступить завтра.</p>
                </div>
                <button
                  type="button"
                  onClick={() => onOpenInvoicePayment?.(dueTomorrowReceivables[0]?.invoiceId)}
                  disabled={dueTomorrowReceivables.length === 0}
                  className="inline-flex items-center justify-center rounded-2xl bg-amber-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-amber-700 disabled:cursor-not-allowed disabled:bg-amber-300"
                >
                  {dueTomorrowReceivables.length > 0 ? 'Открыть счет' : 'Счетов нет'}
                </button>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="rounded-2xl border border-amber-100 bg-white/80 p-4">
                  <p className="text-xs font-bold uppercase tracking-widest text-[#5A5A40]/55">Сумма к оплате</p>
                  <p className="mt-2 text-3xl font-bold text-amber-700">{formatMoney(dueTomorrowAmountTotal)}</p>
                </div>
                <div className="rounded-2xl border border-amber-100 bg-white/80 p-4">
                  <p className="text-xs font-bold uppercase tracking-widest text-[#5A5A40]/55">Счетов на завтра</p>
                  <p className="mt-2 text-3xl font-bold text-[#5A5A40]">{dueTomorrowReceivables.length}</p>
                </div>
              </div>

              <div className="mt-6 space-y-3">
                {dueTomorrowReceivables.length === 0 && (
                  <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4 text-sm font-medium text-emerald-700">
                    На завтра счетов к оплате нет.
                  </div>
                )}

                {dueTomorrowReceivables.slice(0, 4).map((item) => (
                  <button
                    key={item.invoiceId}
                    type="button"
                    onClick={() => onOpenInvoicePayment?.(item.invoiceId)}
                    className="flex w-full items-center justify-between gap-4 rounded-2xl border border-amber-100 bg-white/85 px-4 py-4 text-left transition-colors hover:bg-white"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-[#5A5A40]">{item.customerName}</p>
                      <p className="mt-1 text-xs text-[#5A5A40]/65">Счет {item.invoiceNo} • оплата завтра</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-base font-bold text-amber-700">{formatMoney(item.remainingAmount)}</p>
                      <p className="text-[11px] font-semibold uppercase tracking-widest text-amber-600">Открыть счет</p>
                    </div>
                  </button>
                ))}
              </div>
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
          <div className="h-75 w-full">
            {showChart ? (
              <Suspense fallback={<div className="h-full w-full rounded-2xl bg-[#f5f5f0] animate-pulse" />}>
                <DashboardSalesChart data={salesTrendData} />
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
              <p className="text-sm text-[#5A5A40]/60">Пока нет последних операций</p>
            )}
            {recentActivity.map((activity) => (
              <div key={activity.id} className="flex gap-4">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                  activity.type === 'sale' ? 'bg-emerald-100 text-emerald-600' : 
                  activity.type === 'restock' ? 'bg-blue-100 text-blue-600' : 
                  'bg-amber-100 text-amber-600'
                }`}>
                  {activity.type === 'sale' ? <ArrowUpRight size={20} /> : 
                   activity.type === 'restock' ? <ArrowDownLeft size={20} /> : 
                   <AlertTriangle size={20} />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-[#5A5A40] truncate">{t(activity.title)}</p>
                  <p className="text-xs text-[#5A5A40]/60 mt-0.5">{activity.time}</p>
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
            {lowStockProducts.length === 0 && (
              <p className="text-sm text-[#5A5A40]/60">Критически низких остатков нет</p>
            )}
            {lowStockProducts.map((product, index) => (
              <div key={product.id} className="flex items-center justify-between gap-4 border-b border-[#5A5A40]/10 pb-4 last:border-b-0 last:pb-0">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center text-xs font-bold shrink-0">{index + 1}</div>
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-[#5A5A40] truncate">{product.name}</p>
                    <p className="text-xs text-[#5A5A40]/60">Минимум: {product.minStock || 10}</p>
                  </div>
                </div>
                <span className="text-sm font-bold text-amber-700">{product.totalStock}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white p-8 rounded-3xl shadow-sm border border-[#5A5A40]/5">
          <h3 className="text-xl font-bold text-[#5A5A40] mb-6">Скоро просроченные товары</h3>
          <div className="space-y-4">
            {expiringProducts.length === 0 && (
              <p className="text-sm text-[#5A5A40]/60">Товаров с близким сроком годности нет</p>
            )}
            {expiringProducts.map((item, index) => (
              <div key={item.id} className="flex items-center justify-between gap-4 border-b border-[#5A5A40]/10 pb-4 last:border-b-0 last:pb-0">
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`w-8 h-8 rounded-xl flex items-center justify-center text-xs font-bold shrink-0 ${item.severityRank === 0 ? 'bg-red-100 text-red-700' : item.severityRank === 1 ? 'bg-orange-100 text-orange-700' : 'bg-amber-100 text-amber-700'}`}>{index + 1}</div>
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-[#5A5A40] truncate">{item.name}</p>
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
