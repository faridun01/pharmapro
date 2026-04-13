export type ReportRangePreset = 'month' | 'q1' | 'q2' | 'q3' | 'q4' | 'year' | 'all';
export type ReportViewMode = 'summary' | 'detailed';

export type AgingBuckets = {
  current: number;
  bucket1_30: number;
  bucket31_60: number;
  bucket61_90: number;
  bucket90Plus: number;
  undated: number;
  total: number;
};

export type FinanceReport = {
  range: { preset: ReportRangePreset; from: string; to: string };
  kpi: {
    revenueGross: number;
    customerReturnsAmount: number;
    netRevenue: number;
    cogs: number;
    grossProfit: number;
    grossMarginPct: number;
    operatingProfit: number;
    operatingMarginPct: number;
    expenseTotal: number;
    writeOffAmount: number;
    taxSales: number;
    taxPurchases: number;
    taxNet: number;
  };
  invoices: {
    totalCount: number;
    paidCount: number;
    pendingCount: number;
    returnedCount: number;
    cancelledCount: number;
    avgTicket: number;
  };
  cashflow: {
    inflow: number;
    outflow: number;
    net: number;
    byMethod: Record<string, number>;
  };
  debts: {
    receivableTotal: number;
    receivableOverdue: number;
    payableTotal: number;
    payableOverdue: number;
    netWorkingCapitalExposure: number;
    arAging: AgingBuckets;
    apAging: AgingBuckets;
  };
  purchases: { total: number; count: number; unpaidCount: number };
  inventory: {
    costValue: number;
    retailValue: number;
    unrealizedMargin: number;
    details: Array<{
      productId: string;
      name: string;
      sku: string;
      totalStock: number;
      soldUnits: number;
      returnedUnits: number;
      writeOffUnits: number;
      costValue: number;
      retailValue: number;
    }>;
  };
  balanceLike: {
    cashLike: number;
    inventoryCostValue: number;
    receivableTotal: number;
    payableTotal: number;
    totalAssetsLike: number;
    totalLiabilitiesLike: number;
    equityLike: number;
  };
  expenseByCategory: Record<string, number>;
  trend: Array<{ month: string; revenue: number; expenses: number; purchases: number }>;
  currentMonthSales: {
    from: string;
    to: string;
    saleDetails: Array<{
      invoiceId: string;
      invoiceNo: string;
      createdAt: string;
      customer: string;
      paymentType: string;
      totalAmount: number;
      paidAmount: number;
      outstandingAmount: number;
      itemCount: number;
      soldUnits: number;
      items: Array<{
        productId: string;
        productName: string;
        sku: string;
        quantity: number;
        unitPrice: number;
        unitCost: number;
        lineTotal: number;
        lineProfit: number;
      }>;
    }>;
    productTotals: Array<{
      productId: string;
      name: string;
      sku: string;
      soldUnits: number;
      salesCount: number;
      revenue: number;
    }>;
  };
};

export const presetLabels: Record<ReportRangePreset, string> = {
  month: 'Текущий месяц',
  q1: '1 квартал',
  q2: '2 квартал',
  q3: '3 квартал',
  q4: '4 квартал',
  year: 'Год',
  all: 'Все время',
};
