import { AgingBuckets, FinanceReport, ReportRangePreset } from './types';

export const toNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const normalizeAging = (value: any): AgingBuckets => ({
  current: toNumber(value?.current),
  bucket1_30: toNumber(value?.bucket1_30),
  bucket31_60: toNumber(value?.bucket31_60),
  bucket61_90: toNumber(value?.bucket61_90),
  bucket90Plus: toNumber(value?.bucket90Plus),
  undated: toNumber(value?.undated),
  total: toNumber(value?.total),
});

export const normalizeReport = (raw: any, preset: ReportRangePreset): FinanceReport => ({
  range: {
    preset: (raw?.range?.preset || preset) as ReportRangePreset,
    from: String(raw?.range?.from || new Date().toISOString()),
    to: String(raw?.range?.to || new Date().toISOString()),
  },
  kpi: {
    revenueGross: toNumber(raw?.kpi?.revenueGross),
    retailReturnsAmount: toNumber(raw?.kpi?.customerReturnsAmount),
    netRevenue: toNumber(raw?.kpi?.netRevenue),
    cogs: toNumber(raw?.kpi?.cogs),
    grossProfit: toNumber(raw?.kpi?.grossProfit),
    grossMarginPct: toNumber(raw?.kpi?.grossMarginPct),
    operatingProfit: toNumber(raw?.kpi?.operatingProfit),
    operatingMarginPct: toNumber(raw?.kpi?.operatingMarginPct),
    expenseTotal: toNumber(raw?.kpi?.expenseTotal),
    writeOffAmount: toNumber(raw?.kpi?.writeOffAmount),
    taxSales: toNumber(raw?.kpi?.taxSales),
    taxPurchases: toNumber(raw?.kpi?.taxPurchases),
    taxNet: toNumber(raw?.kpi?.taxNet),
  },
  invoices: {
    totalCount: toNumber(raw?.invoices?.totalCount),
    paidCount: toNumber(raw?.invoices?.paidCount),
    pendingCount: toNumber(raw?.invoices?.pendingCount),
    returnedCount: toNumber(raw?.invoices?.returnedCount),
    cancelledCount: toNumber(raw?.invoices?.cancelledCount),
    avgTicket: toNumber(raw?.invoices?.avgTicket),
  },
  cashflow: {
    inflow: toNumber(raw?.cashflow?.inflow),
    outflow: toNumber(raw?.cashflow?.outflow),
    net: toNumber(raw?.cashflow?.net),
    byMethod: typeof raw?.cashflow?.byMethod === 'object' && raw?.cashflow?.byMethod ? raw.cashflow.byMethod : {},
  },
  debts: {
    payableTotal: toNumber(raw?.debts?.payableTotal),
    payableOverdue: toNumber(raw?.debts?.payableOverdue),
    apAging: normalizeAging(raw?.debts?.apAging),
  },
  purchases: {
    total: toNumber(raw?.purchases?.total),
    count: toNumber(raw?.purchases?.count),
    unpaidCount: toNumber(raw?.purchases?.unpaidCount),
  },
  inventory: {
    costValue: toNumber(raw?.inventory?.costValue),
    retailValue: toNumber(raw?.inventory?.retailValue),
    unrealizedMargin: toNumber(raw?.inventory?.unrealizedMargin),
    details: Array.isArray(raw?.inventory?.details) ? raw.inventory.details.map((d: any) => ({
      productId: String(d.productId || ''),
      name: String(d.name || '-'),
      sku: String(d.sku || '-'),
      totalStock: toNumber(d.totalStock),
      soldUnits: toNumber(d.soldUnits),
      returnedUnits: toNumber(d.returnedUnits),
      writeOffUnits: toNumber(d.writeOffUnits),
      costValue: toNumber(d.costValue),
      retailValue: toNumber(d.retailValue),
    })) : [],
  },
  balanceLike: {
    cashLike: toNumber(raw?.balanceLike?.cashLike),
    inventoryCostValue: toNumber(raw?.balanceLike?.inventoryCostValue),
    payableTotal: toNumber(raw?.balanceLike?.payableTotal),
    totalAssetsLike: toNumber(raw?.balanceLike?.totalAssetsLike),
    totalLiabilitiesLike: toNumber(raw?.balanceLike?.totalLiabilitiesLike),
    equityLike: toNumber(raw?.balanceLike?.equityLike),
  },
  expenseByCategory: typeof raw?.expenseByCategory === 'object' && raw?.expenseByCategory ? raw.expenseByCategory : {},
  trend: Array.isArray(raw?.trend) ? raw.trend.map((t: any) => ({
    month: String(t.month || ''),
    revenue: toNumber(t.revenue),
    expenses: toNumber(t.expenses),
    purchases: toNumber(t.purchases),
  })) : [],
  currentMonthSales: {
    from: String(raw?.currentMonthSales?.from || ''),
    to: String(raw?.currentMonthSales?.to || ''),
    saleDetails: Array.isArray(raw?.currentMonthSales?.saleDetails) ? raw.currentMonthSales.saleDetails.map((s: any) => ({
      invoiceId: String(s.invoiceId || ''),
      invoiceNo: String(s.invoiceNo || ''),
      createdAt: String(s.createdAt || ''),
      paymentType: String(s.paymentType || ''),
      totalAmount: toNumber(s.totalAmount),
      itemCount: toNumber(s.itemCount),
      soldUnits: toNumber(s.soldUnits),
      items: Array.isArray(s.items) ? s.items.map((i: any) => ({
        productId: String(i.productId || ''),
        productName: String(i.productName || ''),
        sku: String(i.sku || ''),
        quantity: toNumber(i.quantity),
        unitPrice: toNumber(i.unitPrice),
        unitCost: toNumber(i.unitCost),
        lineTotal: toNumber(i.lineTotal),
        lineProfit: toNumber(i.lineProfit),
      })) : [],
    })) : [],
    productTotals: Array.isArray(raw?.currentMonthSales?.productTotals) ? raw.currentMonthSales.productTotals.map((p: any) => ({
      productId: String(p.productId || ''),
      name: String(p.name || ''),
      sku: String(p.sku || ''),
      soldUnits: toNumber(p.soldUnits),
      salesCount: toNumber(p.salesCount),
      revenue: toNumber(p.revenue),
    })) : [],
  },
});

export const formatMoney = (amount: number, currency = 'UZS') => {
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: currency,
    minimumFractionDigits: 0,
  }).format(amount);
};
