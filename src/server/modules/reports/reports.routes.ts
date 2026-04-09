import { Router } from 'express';
import { authenticate, type AuthedRequest } from '../../common/auth';
import { asyncHandler } from '../../common/http';
import { prisma } from '../../infrastructure/prisma';
import { ValidationError } from '../../common/errors';
import { readReportSettings, writeReportSettings } from './reportSettings.storage';
import { reportCache, CACHE_KEYS, CACHE_TTL } from '../../common/cache';

export const reportsRouter = Router();

type PeriodPreset = 'month' | 'q1' | 'q2' | 'q3' | 'q4' | 'year' | 'all';

type AgingBuckets = {
  current: number;
  bucket1_30: number;
  bucket31_60: number;
  bucket61_90: number;
  bucket90Plus: number;
  undated: number;
  total: number;
};

type InventoryDetailRow = {
  productId: string;
  name: string;
  sku: string;
  totalStock: number;
  soldUnits: number;
  returnedUnits: number;
  writeOffUnits: number;
  costValue: number;
  retailValue: number;
};

type MonthlySaleDetailRow = {
  invoiceId: string;
  invoiceNo: string;
  createdAt: Date;
  customer: string;
  paymentType: string;
  totalAmount: number;
  itemCount: number;
  soldUnits: number;
  items: Array<{
    productId: string;
    productName: string;
    sku: string;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
  }>;
};

type MonthlyProductSalesRow = {
  productId: string;
  name: string;
  sku: string;
  soldUnits: number;
  salesCount: number;
  revenue: number;
};

const emptyAging = (): AgingBuckets => ({
  current: 0,
  bucket1_30: 0,
  bucket31_60: 0,
  bucket61_90: 0,
  bucket90Plus: 0,
  undated: 0,
  total: 0,
});

const addToAging = (aging: AgingBuckets, dueDate: Date | null, amount: number, now: Date) => {
  const value = Math.max(0, Number(amount || 0));
  if (value <= 0) return;

  aging.total += value;
  if (!dueDate) {
    aging.undated += value;
    return;
  }

  const diffDays = Math.floor((now.getTime() - dueDate.getTime()) / (24 * 60 * 60 * 1000));
  if (diffDays <= 0) {
    aging.current += value;
    return;
  }
  if (diffDays <= 30) {
    aging.bucket1_30 += value;
    return;
  }
  if (diffDays <= 60) {
    aging.bucket31_60 += value;
    return;
  }
  if (diffDays <= 90) {
    aging.bucket61_90 += value;
    return;
  }
  aging.bucket90Plus += value;
};

const canManageCompanyProfile = (role: string | undefined) => {
  const normalized = String(role || '').toUpperCase();
  return normalized === 'ADMIN' || normalized === 'OWNER';
};

reportsRouter.get('/profile', authenticate, asyncHandler(async (_req, res) => {
  const state = await readReportSettings();
  res.json(state.companyProfile);
}));

reportsRouter.put('/profile', authenticate, asyncHandler(async (req, res) => {
  const authedReq = req as AuthedRequest;
  if (!canManageCompanyProfile(authedReq.user.role)) {
    throw new ValidationError('Only ADMIN or OWNER can update company profile');
  }

  const state = await readReportSettings();
  state.companyProfile = {
    ...state.companyProfile,
    ...(req.body ?? {}),
  };
  await writeReportSettings(state);
  res.json(state.companyProfile);
}));

reportsRouter.get('/templates', authenticate, asyncHandler(async (req, res) => {
  const authedReq = req as AuthedRequest;
  const state = await readReportSettings();
  res.json(state.userTemplates[authedReq.user.id] || []);
}));

reportsRouter.post('/templates', authenticate, asyncHandler(async (req, res) => {
  const authedReq = req as AuthedRequest;
  const body = req.body ?? {};
  if (!String(body.name || '').trim()) {
    throw new ValidationError('Template name is required');
  }

  const state = await readReportSettings();
  const next = {
    id: `tmpl-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: String(body.name).trim(),
    preset: body.preset || 'month',
    fromDate: String(body.fromDate || ''),
    toDate: String(body.toDate || ''),
    activeTab: body.activeTab || 'pl',
    createdAt: new Date().toISOString(),
  };

  const current = state.userTemplates[authedReq.user.id] || [];
  state.userTemplates[authedReq.user.id] = [next, ...current].slice(0, 12);
  await writeReportSettings(state);
  res.status(201).json(state.userTemplates[authedReq.user.id]);
}));

reportsRouter.delete('/templates/:id', authenticate, asyncHandler(async (req, res) => {
  const authedReq = req as AuthedRequest;
  const state = await readReportSettings();
  const current = state.userTemplates[authedReq.user.id] || [];
  state.userTemplates[authedReq.user.id] = current.filter((item) => item.id !== req.params.id);
  await writeReportSettings(state);
  res.json(state.userTemplates[authedReq.user.id]);
}));

reportsRouter.get('/preferences', authenticate, asyncHandler(async (req, res) => {
  const authedReq = req as AuthedRequest;
  const state = await readReportSettings();
  res.json(state.userPreferences[authedReq.user.id] || null);
}));

reportsRouter.put('/preferences', authenticate, asyncHandler(async (req, res) => {
  const authedReq = req as AuthedRequest;
  const state = await readReportSettings();
  state.userPreferences[authedReq.user.id] = {
    lastPreset: req.body?.lastPreset || 'month',
    lastFromDate: String(req.body?.lastFromDate || ''),
    lastToDate: String(req.body?.lastToDate || ''),
    lastActiveTab: req.body?.lastActiveTab || 'pl',
  };
  await writeReportSettings(state);
  res.json(state.userPreferences[authedReq.user.id]);
}));

const parseDate = (value: unknown): Date | null => {
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
};

const resolveRange = (preset: PeriodPreset, fromRaw: unknown, toRaw: unknown) => {
  const now = new Date();
  const explicitFrom = parseDate(fromRaw);
  const explicitTo = parseDate(toRaw);

  if (explicitFrom || explicitTo) {
    const to = explicitTo || now;
    const from = explicitFrom || new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
    return { from, to };
  }

  const to = now;
  if (preset === 'all') {
    return { from: new Date(0), to };
  }

  if (preset === 'month') {
    return { from: new Date(now.getFullYear(), now.getMonth(), 1), to };
  }

  if (preset === 'year') {
    return { from: new Date(now.getFullYear(), 0, 1), to };
  }

  const quarterMap: Record<'q1' | 'q2' | 'q3' | 'q4', number> = {
    q1: 0,
    q2: 3,
    q3: 6,
    q4: 9,
  };

  if (preset in quarterMap) {
    const quarterKey = preset as 'q1' | 'q2' | 'q3' | 'q4';
    const monthIndex = quarterMap[quarterKey];
    const from = new Date(now.getFullYear(), monthIndex, 1);
    const quarterEnd = new Date(now.getFullYear(), monthIndex + 3, 0, 23, 59, 59, 999);
    return { from, to: quarterEnd < now ? quarterEnd : now };
  }

  return { from: new Date(now.getFullYear(), now.getMonth(), 1), to };
};

const parsePositiveInt = (value: unknown, fallback: number, max: number) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(1, Math.floor(numeric)));
};

reportsRouter.get('/finance', authenticate, asyncHandler(async (req, res) => {
  const presetRaw = String(req.query.preset || 'month').toLowerCase();
  const preset: PeriodPreset = ['month', 'q1', 'q2', 'q3', 'q4', 'year', 'all'].includes(presetRaw)
    ? (presetRaw as PeriodPreset)
    : 'month';

  const { from, to } = resolveRange(preset, req.query.from, req.query.to);

  // Generate cache key based on date range
  // Use date strings to make cache consistent
  const fromStr = from.toISOString().split('T')[0];
  const toStr = to.toISOString().split('T')[0];
  const cacheKey = CACHE_KEYS.financeReport(preset, fromStr, toStr);

  // Check cache first (returns null if expired)
  const cachedResult = reportCache.get(cacheKey);
  if (cachedResult) {
    res.set('X-Cache', 'HIT');
    return res.json(cachedResult);
  }

  // Cache miss - compute report
  res.set('X-Cache', 'MISS');

  const [
    invoices,
    returns,
    writeoffs,
    payments,
    receivables,
    payables,
    expenses,
    purchaseInvoices,
    products,
    monthlyInvoices,
  ] = await Promise.all([
    prisma.invoice.findMany({
      where: { createdAt: { gte: from, lte: to } },
      select: {
        id: true,
        status: true,
        createdAt: true,
        totalAmount: true,
        taxAmount: true,
        items: {
          select: {
            productId: true,
            quantity: true,
            totalPrice: true,
            batch: { select: { costBasis: true } },
          },
        },
      },
    }),
    prisma.return.findMany({
      where: {
        createdAt: { gte: from, lte: to },
        type: 'CUSTOMER',
        status: 'COMPLETED',
      },
      select: {
        id: true,
        totalAmount: true,
        createdAt: true,
        items: {
          select: {
            productId: true,
            batchId: true,
            quantity: true,
            unitPrice: true,
            lineTotal: true,
            batch: {
              select: {
                costBasis: true,
              },
            },
          },
        },
      },
    }),
    prisma.writeOff.findMany({
      where: { createdAt: { gte: from, lte: to } },
      select: {
        id: true,
        totalAmount: true,
        createdAt: true,
        items: {
          select: {
            productId: true,
            quantity: true,
            unitCost: true,
            lineTotal: true,
          },
        },
      },
    }),
    prisma.payment.findMany({
      where: { paymentDate: { gte: from, lte: to } },
      select: {
        direction: true,
        amount: true,
        method: true,
      },
    }),
    prisma.receivable.findMany({
      where: {
        createdAt: { lte: to },
      },
      select: {
        originalAmount: true,
        paidAmount: true,
        remainingAmount: true,
        dueDate: true,
        status: true,
      },
    }),
    prisma.payable.findMany({
      where: {
        createdAt: { lte: to },
      },
      select: {
        originalAmount: true,
        paidAmount: true,
        remainingAmount: true,
        dueDate: true,
        status: true,
      },
    }),
    prisma.expense.findMany({
      where: { date: { gte: from, lte: to } },
      select: {
        category: true,
        amount: true,
        date: true,
      },
    }),
    prisma.purchaseInvoice.findMany({
      where: { invoiceDate: { gte: from, lte: to } },
      select: {
        totalAmount: true,
        discountAmount: true,
        taxAmount: true,
        paymentStatus: true,
        invoiceDate: true,
      },
    }),
    prisma.product.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        sku: true,
        totalStock: true,
        costPrice: true,
        sellingPrice: true,
      },
    }),
    prisma.invoice.findMany({
      where: {
        createdAt: {
          gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
          lte: new Date(),
        },
      },
      select: {
        id: true,
        invoiceNo: true,
        createdAt: true,
        customer: true,
        paymentType: true,
        totalAmount: true,
        paymentStatus: true,
        status: true,
        items: {
          select: {
            productId: true,
            productName: true,
            quantity: true,
            unitPrice: true,
            totalPrice: true,
            product: {
              select: {
                sku: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  const paidInvoices = invoices.filter((inv) => inv.status === 'PAID');
  const revenueGross = paidInvoices.reduce((sum, inv) => sum + Number(inv.totalAmount || 0), 0);

  const customerReturnsAmount = returns.reduce((sum, ret) => {
    const totalByItems = ret.items.reduce((iSum, item) => {
      const lineTotal = item.lineTotal != null && Number(item.lineTotal) > 0
        ? Number(item.lineTotal)
        : Number(item.quantity || 0) * Number(item.unitPrice || 0);
      return iSum + lineTotal;
    }, 0);
    const topLevel = Number(ret.totalAmount || 0);
    return sum + Math.max(topLevel, totalByItems);
  }, 0);

  const taxSales = paidInvoices.reduce((sum, inv) => sum + Number(inv.taxAmount || 0), 0);
  const taxPurchases = purchaseInvoices.reduce((sum, inv) => sum + Number(inv.taxAmount || 0), 0);
  const netRevenue = Math.max(0, revenueGross - customerReturnsAmount);

  const cogs = paidInvoices.reduce((sum, inv) => {
    const invoiceCost = inv.items.reduce((itemSum, item) => {
      const unitCost = Number(item.batch?.costBasis || 0);
      return itemSum + unitCost * Number(item.quantity || 0);
    }, 0);
    return sum + invoiceCost;
  }, 0);

  const returnedCogs = returns.reduce((sum, ret) => {
    const itemsCost = ret.items.reduce((itemSum, item) => {
      const unitCost = Number(item.batch?.costBasis || 0);
      return itemSum + unitCost * Number(item.quantity || 0);
    }, 0);
    return sum + itemsCost;
  }, 0);

  const netCogs = Math.max(0, cogs - returnedCogs);

  const writeOffAmount = writeoffs.reduce((sum, wo) => {
    const totalByItems = wo.items.reduce((iSum, item) => {
      const lineTotal = item.lineTotal != null && Number(item.lineTotal) > 0
        ? Number(item.lineTotal)
        : Number(item.quantity || 0) * Number(item.unitCost || 0);
      return iSum + lineTotal;
    }, 0);
    const topLevel = Number(wo.totalAmount || 0);
    return sum + Math.max(topLevel, totalByItems);
  }, 0);

  const expenseTotal = expenses.reduce((sum, ex) => sum + Number(ex.amount || 0), 0);
  const grossProfit = netRevenue - netCogs;
  const operatingProfit = grossProfit - expenseTotal - writeOffAmount;

  const grossMarginPct = netRevenue > 0 ? (grossProfit / netRevenue) * 100 : 0;
  const operatingMarginPct = netRevenue > 0 ? (operatingProfit / netRevenue) * 100 : 0;

  const paymentIn = payments.filter((p) => p.direction === 'IN').reduce((sum, p) => sum + Number(p.amount || 0), 0);
  const paymentOut = payments.filter((p) => p.direction === 'OUT').reduce((sum, p) => sum + Number(p.amount || 0), 0);

  const paymentBreakdown = payments.reduce<Record<string, number>>((acc, payment) => {
    const key = `${payment.direction}_${payment.method}`;
    acc[key] = (acc[key] || 0) + Number(payment.amount || 0);
    return acc;
  }, {});

  const now = new Date();
  const arAging = emptyAging();
  const apAging = emptyAging();

  for (const receivable of receivables) {
    addToAging(arAging, receivable.dueDate || null, receivable.remainingAmount, now);
  }
  for (const payable of payables) {
    addToAging(apAging, payable.dueDate || null, payable.remainingAmount, now);
  }

  const receivableTotal = receivables.reduce((sum, r) => sum + Number(r.remainingAmount || 0), 0);
  const receivableOverdue = receivables
    .filter((r) => r.dueDate && r.dueDate < now && Number(r.remainingAmount || 0) > 0)
    .reduce((sum, r) => sum + Number(r.remainingAmount || 0), 0);

  const payableTotal = payables.reduce((sum, p) => sum + Number(p.remainingAmount || 0), 0);
  const payableOverdue = payables
    .filter((p) => p.dueDate && p.dueDate < now && Number(p.remainingAmount || 0) > 0)
    .reduce((sum, p) => sum + Number(p.remainingAmount || 0), 0);

  const purchaseTotal = purchaseInvoices.reduce((sum, inv) => sum + Number(inv.totalAmount || 0), 0);

  const inventoryCostValue = products.reduce((sum, product) => {
    return sum + Number(product.totalStock || 0) * Number(product.costPrice || 0);
  }, 0);

  const inventoryRetailValue = products.reduce((sum, product) => {
    return sum + Number(product.totalStock || 0) * Number(product.sellingPrice || 0);
  }, 0);

  const inventoryDetailMap = new Map<string, InventoryDetailRow>();

  for (const product of products) {
    inventoryDetailMap.set(product.id, {
      productId: product.id,
      name: String(product.name || '-'),
      sku: String(product.sku || '-'),
      totalStock: Number(product.totalStock || 0),
      soldUnits: 0,
      returnedUnits: 0,
      writeOffUnits: 0,
      costValue: Number(product.totalStock || 0) * Number(product.costPrice || 0),
      retailValue: Number(product.totalStock || 0) * Number(product.sellingPrice || 0),
    });
  }

  for (const invoice of paidInvoices) {
    for (const item of invoice.items) {
      const row = inventoryDetailMap.get(String(item.productId || ''));
      if (!row) continue;
      row.soldUnits += Number(item.quantity || 0);
    }
  }

  for (const ret of returns) {
    for (const item of ret.items) {
      const row = inventoryDetailMap.get(String(item.productId || ''));
      if (!row) continue;
      row.returnedUnits += Number(item.quantity || 0);
    }
  }

  for (const writeOff of writeoffs) {
    for (const item of writeOff.items) {
      const row = inventoryDetailMap.get(String(item.productId || ''));
      if (!row) continue;
      row.writeOffUnits += Number(item.quantity || 0);
    }
  }

  const detailPage = parsePositiveInt(req.query.detailPage, 1, 100000);
  const detailPageSize = parsePositiveInt(req.query.detailPageSize, 25, 250);

  const inventoryDetailsAll = Array.from(inventoryDetailMap.values())
    .filter((row) => row.totalStock > 0 || row.soldUnits > 0 || row.returnedUnits > 0 || row.writeOffUnits > 0)
    .sort((left, right) => right.retailValue - left.retailValue);

  const currentMonthSaleDetails: MonthlySaleDetailRow[] = monthlyInvoices
    .filter((invoice) => invoice.status !== 'CANCELLED')
    .map((invoice) => ({
      invoiceId: invoice.id,
      invoiceNo: String(invoice.invoiceNo || invoice.id),
      createdAt: invoice.createdAt,
      customer: String(invoice.customer || 'Розничный покупатель'),
      paymentType: String(invoice.paymentType || 'CASH'),
      totalAmount: Number(invoice.totalAmount || 0),
      itemCount: invoice.items.length,
      soldUnits: invoice.items.reduce((sum, item) => sum + Number(item.quantity || 0), 0),
      items: invoice.items.map((item) => ({
        productId: String(item.productId || ''),
        productName: String(item.productName || '-'),
        sku: String(item.product?.sku || '-'),
        quantity: Number(item.quantity || 0),
        unitPrice: Number(item.unitPrice || 0),
        lineTotal: Number(item.totalPrice || 0),
      })),
    }));

  const currentMonthProductSalesMap = new Map<string, MonthlyProductSalesRow>();
  for (const sale of currentMonthSaleDetails) {
    for (const item of sale.items) {
      const existing = currentMonthProductSalesMap.get(item.productId);
      if (existing) {
        existing.soldUnits += item.quantity;
        existing.salesCount += 1;
        existing.revenue += item.lineTotal;
        continue;
      }

      currentMonthProductSalesMap.set(item.productId, {
        productId: item.productId,
        name: item.productName,
        sku: item.sku,
        soldUnits: item.quantity,
        salesCount: 1,
        revenue: item.lineTotal,
      });
    }
  }

  const currentMonthProductSales = Array.from(currentMonthProductSalesMap.values())
    .sort((left, right) => right.soldUnits - left.soldUnits || right.revenue - left.revenue);

  const inventoryDetailsStart = (detailPage - 1) * detailPageSize;
  const inventoryDetails = inventoryDetailsAll.slice(inventoryDetailsStart, inventoryDetailsStart + detailPageSize);

  const monthlyTrendMap = new Map<string, { month: string; revenue: number; expenses: number; purchases: number }>();
  for (let i = 11; i >= 0; i -= 1) {
    const cursor = new Date(to);
    cursor.setMonth(cursor.getMonth() - i);
    const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`;
    monthlyTrendMap.set(key, { month: key, revenue: 0, expenses: 0, purchases: 0 });
  }

  for (const inv of paidInvoices) {
    const key = `${inv.createdAt.getFullYear()}-${String(inv.createdAt.getMonth() + 1).padStart(2, '0')}`;
    const row = monthlyTrendMap.get(key);
    if (row) row.revenue += Number(inv.totalAmount || 0);
  }
  for (const exp of expenses) {
    const key = `${exp.date.getFullYear()}-${String(exp.date.getMonth() + 1).padStart(2, '0')}`;
    const row = monthlyTrendMap.get(key);
    if (row) row.expenses += Number(exp.amount || 0);
  }

  for (const purchase of purchaseInvoices) {
    const key = `${purchase.invoiceDate.getFullYear()}-${String(purchase.invoiceDate.getMonth() + 1).padStart(2, '0')}`;
    const row = monthlyTrendMap.get(key);
    if (row) row.purchases += Number(purchase.totalAmount || 0);
  }

  const expenseByCategory = expenses.reduce<Record<string, number>>((acc, item) => {
    const key = item.category || 'Other';
    acc[key] = (acc[key] || 0) + Number(item.amount || 0);
    return acc;
  }, {});

  const cashLike = paymentIn - paymentOut;
  const totalAssetsLike = inventoryCostValue + receivableTotal + cashLike;
  const totalLiabilitiesLike = payableTotal;
  const equityLike = totalAssetsLike - totalLiabilitiesLike;

  const balanceLike = {
    cashLike,
    inventoryCostValue,
    receivableTotal,
    payableTotal,
    totalAssetsLike,
    totalLiabilitiesLike,
    equityLike,
  };

  const result = {
    range: {
      preset,
      from,
      to,
    },
    kpi: {
      revenueGross,
      customerReturnsAmount,
      netRevenue,
      cogs: netCogs,
      grossProfit,
      grossMarginPct,
      operatingProfit,
      operatingMarginPct,
      expenseTotal,
      writeOffAmount,
      taxSales,
      taxPurchases,
      taxNet: taxSales - taxPurchases,
    },
    invoices: {
      totalCount: invoices.length,
      paidCount: invoices.filter((i) => i.status === 'PAID').length,
      pendingCount: invoices.filter((i) => i.status === 'PENDING').length,
      returnedCount: invoices.filter((i) => i.status === 'RETURNED').length,
      cancelledCount: invoices.filter((i) => i.status === 'CANCELLED').length,
      avgTicket: paidInvoices.length
        ? paidInvoices.reduce((sum, inv) => sum + Number(inv.totalAmount || 0), 0) / paidInvoices.length
        : 0,
    },
    cashflow: {
      inflow: paymentIn,
      outflow: paymentOut,
      net: paymentIn - paymentOut,
      byMethod: paymentBreakdown,
    },
    debts: {
      receivableTotal,
      receivableOverdue,
      payableTotal,
      payableOverdue,
      netWorkingCapitalExposure: receivableTotal - payableTotal,
      arAging,
      apAging,
    },
    purchases: {
      total: purchaseTotal,
      count: purchaseInvoices.length,
      unpaidCount: purchaseInvoices.filter((p) => p.paymentStatus === 'UNPAID' || p.paymentStatus === 'PARTIALLY_PAID').length,
    },
    inventory: {
      costValue: inventoryCostValue,
      retailValue: inventoryRetailValue,
      unrealizedMargin: inventoryRetailValue - inventoryCostValue,
      details: inventoryDetails,
      detailsPagination: {
        page: detailPage,
        pageSize: detailPageSize,
        totalCount: inventoryDetailsAll.length,
        pageCount: Math.max(1, Math.ceil(inventoryDetailsAll.length / detailPageSize)),
      },
    },
    balanceLike,
    expenseByCategory,
    trend: Array.from(monthlyTrendMap.values()),
    currentMonthSales: {
      from: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
      to: new Date(),
      saleDetails: currentMonthSaleDetails,
      productTotals: currentMonthProductSales,
    },
  };

  // Cache result for 10 minutes
  reportCache.set(cacheKey, result, CACHE_TTL.financeReport);

  res.json(result);
}));

/**
 * Fast dashboard metrics endpoint
 * Aggregates frequently accessed metrics with caching
 * Includes: low stock, expiring soon, unpaid invoices, daily revenue
 */
reportsRouter.get('/metrics/dashboard', authenticate, asyncHandler(async (req, res) => {
  const cacheKey = CACHE_KEYS.dashboardMetrics('global');

  // Check cache first
  const cachedResult = reportCache.get(cacheKey);
  if (cachedResult) {
    res.set('X-Cache', 'HIT');
    return res.json(cachedResult);
  }

  res.set('X-Cache', 'MISS');

  // Fetch needed data for dashboard
  const [products, invoices, batches] = await Promise.all([
    prisma.product.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        totalStock: true,
        minStock: true,
      },
    }),
    prisma.invoice.findMany({
      where: {
        createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }, // Last 7 days
      },
      select: {
        id: true,
        status: true,
        paymentStatus: true,
        totalAmount: true,
        createdAt: true,
      },
    }),
    prisma.batch.findMany({
      where: { quantity: { gt: 0 } },
      select: {
        id: true,
        productId: true,
        expiryDate: true,
        status: true,
      },
    }),
  ]);

  const now = new Date();
  const thirtyDaysLater = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  // Calculate low stock products
  const lowStockProducts = products.filter(p => p.totalStock < (p.minStock || 10)).map(p => ({
    productId: p.id,
    name: p.name,
    currentStock: p.totalStock,
    minStock: p.minStock || 10,
  }));

  // Calculate expiring/expired batches
  const expiredBatches = batches.filter(b => new Date(b.expiryDate) < now).length;
  const expiringBatches = batches.filter(b => {
    const expDate = new Date(b.expiryDate);
    return expDate >= now && expDate <= thirtyDaysLater;
  }).length;

  // Calculate unpaid invoices
  const unpaidInvoices = invoices.filter(inv => 
    inv.paymentStatus === 'UNPAID' || inv.paymentStatus === 'PARTIALLY_PAID'
  );
  const unpaidAmount = unpaidInvoices.reduce((sum, inv) => sum + Number(inv.totalAmount || 0), 0);

  // Calculate daily revenue (last 7 days)
  const paidInvoices7d = invoices.filter(inv => 
    inv.status === 'PAID' || inv.paymentStatus === 'PAID'
  );
  const revenue7d = paidInvoices7d.reduce((sum, inv) => sum + Number(inv.totalAmount || 0), 0);
  const avgDailyRevenue = paidInvoices7d.length > 0 ? revenue7d / 7 : 0;

  const result = {
    lowStock: {
      count: lowStockProducts.length,
      items: lowStockProducts.slice(0, 10), // Top 10
    },
    expiry: {
      expired: expiredBatches,
      expiringSoon: expiringBatches,
    },
    invoices: {
      unpaidCount: unpaidInvoices.length,
      unpaidAmount,
      averageUnpaid: unpaidInvoices.length > 0 ? unpaidAmount / unpaidInvoices.length : 0,
    },
    revenue: {
      last7Days: revenue7d,
      averageDaily: avgDailyRevenue,
      paidInvoiceCount: paidInvoices7d.length,
    },
    summary: {
      totalProducts: products.length,
      totalBatches: batches.length,
      alertCount: lowStockProducts.length + expiredBatches + expiringBatches,
    },
  };

  // Cache for 5 minutes
  reportCache.set(cacheKey, result, CACHE_TTL.dashboardMetrics);

  res.json(result);
}));

/**
 * Inventory status endpoint
 * Fast lookup for current stock levels with minimal computation
 */
reportsRouter.get('/metrics/inventory-status', authenticate, asyncHandler(async (req, res) => {
  const cacheKey = CACHE_KEYS.inventoryStatus();

  const cachedResult = reportCache.get(cacheKey);
  if (cachedResult) {
    res.set('X-Cache', 'HIT');
    return res.json(cachedResult);
  }

  res.set('X-Cache', 'MISS');

  // Fetch product inventory status
  const products = await prisma.product.findMany({
    where: { isActive: true },
    select: {
      id: true,
      name: true,
      sku: true,
      totalStock: true,
      minStock: true,
      costPrice: true,
      sellingPrice: true,
    },
  });

  const result = {
    timestamp: new Date(),
    totalProductCount: products.length,
    inventoryValue: {
      costBasis: products.reduce((sum, p) => sum + ((p.totalStock || 0) * (p.costPrice || 0)), 0),
      retailValue: products.reduce((sum, p) => sum + ((p.totalStock || 0) * (p.sellingPrice || 0)), 0),
    },
    stockLevels: {
      inStock: products.filter(p => p.totalStock > (p.minStock || 10)).length,
      lowStock: products.filter(p => p.totalStock > 0 && p.totalStock <= (p.minStock || 10)).length,
      outOfStock: products.filter(p => p.totalStock <= 0).length,
    },
    topProducts: products
      .sort((a, b) => ((b.totalStock || 0) * (b.sellingPrice || 0)) - ((a.totalStock || 0) * (a.sellingPrice || 0)))
      .slice(0, 5)
      .map(p => ({
        id: p.id,
        name: p.name,
        stock: p.totalStock,
        retailValue: (p.totalStock || 0) * (p.sellingPrice || 0),
      })),
  };

  // Cache for 2 minutes
  reportCache.set(cacheKey, result, CACHE_TTL.inventoryStatus);

  res.json(result);
}));
