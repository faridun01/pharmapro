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

const getPaymentsTotal = (payments?: Array<{ amount?: number | null }>) => (
  payments || []).reduce((sum, payment) => sum + Number(payment.amount || 0), 0);

const getInvoicePaidAmount = (invoice: { totalAmount?: number | null; payments?: Array<{ amount?: number | null }> }) => (
  Math.min(Number(invoice.totalAmount || 0), getPaymentsTotal(invoice.payments))
);

const getInvoiceOutstandingAmount = (invoice: {
  totalAmount?: number | null;
  receivables?: Array<{ remainingAmount?: number | null }>;
  payments?: Array<{ amount?: number | null }>;
}) => {
  const receivableRemaining = Number(invoice.receivables?.[0]?.remainingAmount ?? NaN);
  if (Number.isFinite(receivableRemaining)) {
    return Math.max(0, receivableRemaining);
  }

  return Math.max(0, Number(invoice.totalAmount || 0) - getInvoicePaidAmount(invoice));
};

const getDebtorCustomerKey = (invoice: { id: string; customerId?: string | null; customer?: string | null }) => {
  const normalizedName = String(invoice.customer || '').trim().toLocaleLowerCase('ru-RU').replace(/\s+/g, ' ');
  return invoice.customerId || (normalizedName ? `name:${normalizedName}` : invoice.id);
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
      where: {
        createdAt: { gte: from, lte: to },
        paymentType: { not: 'CREDIT' },
      },
      select: {
        id: true,
        status: true,
        paymentStatus: true,
        createdAt: true,
        totalAmount: true,
        taxAmount: true,
        receivables: {
          select: {
            remainingAmount: true,
          },
        },
        payments: {
          select: {
            amount: true,
          },
        },
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
      where: {
        paymentDate: { gte: from, lte: to },
      },
      select: {
        invoiceId: true,
        paymentDate: true,
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
        paymentType: { not: 'CREDIT' },
        status: { notIn: ['CANCELLED', 'RETURNED'] },
      },
      select: {
        id: true,
        invoiceNo: true,
        createdAt: true,
        customer: true,
        paymentType: true,
        totalAmount: true,
        receivables: {
          select: {
            remainingAmount: true,
          },
        },
        payments: {
          select: {
            amount: true,
          },
        },
        paymentStatus: true,
        status: true,
        items: {
          select: {
            productId: true,
            productName: true,
            quantity: true,
            unitPrice: true,
            totalPrice: true,
            batch: {
              select: {
                costBasis: true,
              },
            },
            product: {
              select: {
                sku: true,
                costPrice: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  const recognizedInvoices = invoices.filter((inv) => inv.status !== 'CANCELLED' && inv.status !== 'RETURNED');
  const paidInvoices = recognizedInvoices.filter((inv) => inv.paymentStatus === 'PAID');
  const revenueGross = payments
    .filter((payment) => payment.direction === 'IN' && payment.invoiceId)
    .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);

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

  const taxSales = recognizedInvoices.reduce((sum, inv) => sum + Number(inv.taxAmount || 0), 0);
  const taxPurchases = purchaseInvoices.reduce((sum, inv) => sum + Number(inv.taxAmount || 0), 0);
  const netRevenue = Math.max(0, revenueGross - customerReturnsAmount);

  const cogs = recognizedInvoices.reduce((sum, inv) => {
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

  for (const invoice of recognizedInvoices) {
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
    .map((invoice) => ({
      invoiceId: invoice.id,
      invoiceNo: String(invoice.invoiceNo || invoice.id),
      createdAt: invoice.createdAt,
      customer: String(invoice.customer || '—'),
      paymentType: String(invoice.paymentType || 'CASH'),
      totalAmount: Number(invoice.totalAmount || 0),
      paidAmount: getInvoicePaidAmount(invoice),
      outstandingAmount: getInvoiceOutstandingAmount(invoice),
      itemCount: invoice.items.length,
      soldUnits: invoice.items.reduce((sum, item) => sum + Number(item.quantity || 0), 0),
      items: invoice.items.map((item) => {
        const unitCost = Number(item.batch?.costBasis || item.product?.costPrice || 0);
        return {
          productId: String(item.productId || ''),
          productName: String(item.productName || '-'),
          sku: String(item.product?.sku || '-'),
          quantity: Number(item.quantity || 0),
          unitPrice: Number(item.unitPrice || 0),
          lineTotal: Number(item.totalPrice || 0),
          unitCost,
          lineProfit: Number(item.totalPrice || 0) - (Number(item.quantity || 0) * unitCost),
        };
      }),
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

  for (const payment of payments.filter((item) => item.direction === 'IN' && item.invoiceId)) {
    const paymentDate = new Date(payment.paymentDate);
    const key = `${paymentDate.getFullYear()}-${String(paymentDate.getMonth() + 1).padStart(2, '0')}`;
    const row = monthlyTrendMap.get(key);
    if (row) row.revenue += Number(payment.amount || 0);
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
      totalCount: recognizedInvoices.length,
      paidCount: paidInvoices.length,
      pendingCount: recognizedInvoices.filter((invoice) => invoice.paymentStatus !== 'PAID').length,
      returnedCount: invoices.filter((invoice) => invoice.status === 'RETURNED').length,
      cancelledCount: invoices.filter((invoice) => invoice.status === 'CANCELLED').length,
      avgTicket: recognizedInvoices.length
        ? recognizedInvoices.reduce((sum, inv) => sum + Number(inv.totalAmount || 0), 0) / recognizedInvoices.length
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
  const presetRaw = String(req.query.preset || 'month').toLowerCase();
  const preset: PeriodPreset = ['month', 'q1', 'q2', 'q3', 'q4', 'year', 'all'].includes(presetRaw)
    ? (presetRaw as PeriodPreset)
    : 'month';
  const { from, to } = resolveRange(preset, req.query.from, req.query.to);
  const cacheKey = CACHE_KEYS.dashboardMetrics(`${preset}:${from.toISOString().slice(0, 10)}:${to.toISOString().slice(0, 10)}`);

  // Check cache first
  const cachedResult = reportCache.get(cacheKey);
  if (cachedResult) {
    res.set('X-Cache', 'HIT');
    return res.json(cachedResult);
  }

  res.set('X-Cache', 'MISS');

  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const monthEnd = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0, 23, 59, 59, 999);
  const chartMode = preset === 'month' ? 'day' : 'month';

  // Fetch needed data for dashboard
  const [products, salesInvoicesInRange, salesPaymentsInRange, ordinaryOpenInvoices, creditInvoices, batches, writeoffsMonth, monthlySalesInvoices] = await Promise.all([
    prisma.product.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        totalStock: true,
        minStock: true,
        costPrice: true,
        sellingPrice: true,
      },
    }),
    prisma.invoice.findMany({
      where: {
        createdAt: { gte: from, lte: to },
        paymentType: { not: 'CREDIT' },
        status: { notIn: ['CANCELLED', 'RETURNED'] },
      },
      select: {
        id: true,
        invoiceNo: true,
        status: true,
        paymentStatus: true,
        totalAmount: true,
        customer: true,
        customerId: true,
        createdAt: true,
        receivables: {
          select: {
            remainingAmount: true,
            dueDate: true,
          },
        },
        payments: {
          select: {
            amount: true,
          },
        },
      },
    }),
    prisma.payment.findMany({
      where: {
        paymentDate: { gte: from, lte: to },
        direction: 'IN',
        invoiceId: { not: null },
      },
      select: {
        amount: true,
        paymentDate: true,
      },
    }),
    prisma.invoice.findMany({
      where: {
        paymentType: { not: 'CREDIT' },
        status: { in: ['PENDING', 'PAID'] },
        paymentStatus: { in: ['UNPAID', 'PARTIALLY_PAID'] },
      },
      select: {
        id: true,
        invoiceNo: true,
        customer: true,
        customerId: true,
        createdAt: true,
        totalAmount: true,
        paymentStatus: true,
        receivables: {
          select: {
            remainingAmount: true,
            dueDate: true,
          },
        },
        payments: {
          select: {
            amount: true,
          },
        },
      },
    }),
    prisma.invoice.findMany({
      where: {
        paymentType: 'CREDIT',
        status: { in: ['PENDING', 'PAID'] },
      },
      select: {
        id: true,
        invoiceNo: true,
        customer: true,
        customerId: true,
        totalAmount: true,
        receivables: {
          select: {
            remainingAmount: true,
            dueDate: true,
          },
        },
        payments: {
          select: {
            amount: true,
          },
        },
      },
    }),
    prisma.batch.findMany({
      where: {},
      select: {
        id: true,
        productId: true,
        batchNumber: true,
        product: {
          select: {
            name: true,
          },
        },
        expiryDate: true,
        status: true,
      },
    }),
    prisma.writeOff.findMany({
      where: { createdAt: { gte: monthStart, lte: monthEnd } },
      select: {
        totalAmount: true,
        items: {
          select: {
            quantity: true,
            unitCost: true,
            lineTotal: true,
          },
        },
      },
    }),
    prisma.invoice.findMany({
      where: {
        createdAt: { gte: monthStart, lte: monthEnd },
        paymentType: { not: 'CREDIT' },
        status: { notIn: ['CANCELLED', 'RETURNED'] },
      },
      select: {
        id: true,
        totalAmount: true,
        items: {
          select: {
            quantity: true,
            batch: {
              select: {
                costBasis: true,
              },
            },
          },
        },
      },
    }),
  ]);

  const now = new Date();
  const thirtyDaysLater = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const tomorrowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const tomorrowEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2);

  const getInvoiceOutstanding = (invoice: { totalAmount?: number | null; receivables?: Array<{ remainingAmount?: number | null }>; payments?: Array<{ amount?: number | null }> }) => getInvoiceOutstandingAmount(invoice);

  // Calculate low stock products
  const lowStockProducts = products
    .filter((p) => p.totalStock < (p.minStock || 10))
    .map((p) => ({
      productId: p.id,
      name: p.name,
      currentStock: p.totalStock,
      minStock: p.minStock || 10,
    }))
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
    });

  // Calculate expiring/expired batches
  const expiredBatches = batches.filter(b => new Date(b.expiryDate) < now).length;
  const expiringBatches = batches.filter(b => {
    const expDate = new Date(b.expiryDate);
    return expDate >= now && expDate <= thirtyDaysLater;
  }).length;
  const expiringItems = batches
    .map((batch) => {
      const expiryDate = new Date(batch.expiryDate);
      const daysLeft = Math.ceil((expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      if (daysLeft > 90) return null;
      return {
        id: batch.id,
        name: batch.product?.name || 'Товар',
        batchNumber: batch.batchNumber,
        daysLeft,
        severityRank: daysLeft <= 0 ? 0 : daysLeft <= 30 ? 1 : 2,
        severityLabel: daysLeft <= 0 ? 'Просрочено' : daysLeft <= 30 ? 'Критично' : 'Скоро истекает',
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .sort((left, right) => {
      if (left.severityRank !== right.severityRank) return left.severityRank - right.severityRank;
      return left.daysLeft - right.daysLeft;
    })
    .slice(0, 5);

  // Calculate ordinary unpaid invoices by real outstanding amount
  const unpaidInvoices = ordinaryOpenInvoices.filter(inv => getInvoiceOutstanding(inv) > 0);
  const unpaidAmount = unpaidInvoices.reduce((sum, inv) => sum + getInvoiceOutstanding(inv), 0);

  const debtorOpenInvoices = [...creditInvoices, ...ordinaryOpenInvoices]
    .map((invoice) => ({
      ...invoice,
      customer: String(invoice.customer || '').trim(),
    }))
    .filter((invoice) => invoice.customer && getInvoiceOutstanding(invoice) > 0);

  const totalDebtorOutstanding = debtorOpenInvoices.reduce((sum, invoice) => sum + getInvoiceOutstanding(invoice), 0);
  const totalDebtorCustomersCount = new Set(debtorOpenInvoices.map((invoice) => getDebtorCustomerKey(invoice))).size;

  const revenueInRange = salesPaymentsInRange.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  const rangeDays = Math.max(1, Math.ceil((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24)) + 1);
  const avgDailyRevenue = revenueInRange / rangeDays;

  const writeOffAmountMonth = writeoffsMonth.reduce((sum, writeoff) => {
    const itemsTotal = writeoff.items.reduce((itemSum, item) => {
      const lineTotal = item.lineTotal != null && Number(item.lineTotal) > 0
        ? Number(item.lineTotal)
        : Number(item.quantity || 0) * Number(item.unitCost || 0);
      return itemSum + lineTotal;
    }, 0);
    return sum + Math.max(Number(writeoff.totalAmount || 0), itemsTotal);
  }, 0);

  const grossMarginMonth = monthlySalesInvoices.reduce((sum, invoice) => {
    const invoiceCost = invoice.items.reduce((itemSum, item) => {
      return itemSum + Number(item.quantity || 0) * Number(item.batch?.costBasis || 0);
    }, 0);
    return sum + (Number(invoice.totalAmount || 0) - invoiceCost);
  }, 0);

  const overdueReceivables = debtorOpenInvoices
    .map((invoice) => {
      const receivable = invoice.receivables?.[0];
      const remainingAmount = getInvoiceOutstanding(invoice);
      if (remainingAmount <= 0) return null;
      const dueDate = receivable?.dueDate ? new Date(receivable.dueDate) : null;
      if (!dueDate || Number.isNaN(dueDate.getTime()) || dueDate >= now) return null;
      const daysOverdue = Math.ceil((now.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));
      return {
        invoiceId: invoice.id,
        invoiceNo: invoice.invoiceNo || invoice.id,
        customerName: invoice.customer || 'Покупатель',
        customerKey: invoice.customerId || invoice.customer || invoice.id,
        remainingAmount,
        daysOverdue,
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .sort((left, right) => right.daysOverdue - left.daysOverdue || right.remainingAmount - left.remainingAmount);

  const dueTomorrowReceivables = debtorOpenInvoices
    .map((invoice) => {
      const receivable = invoice.receivables?.[0];
      const remainingAmount = getInvoiceOutstanding(invoice);
      if (remainingAmount <= 0) return null;
      const dueDate = receivable?.dueDate ? new Date(receivable.dueDate) : null;
      if (!dueDate || Number.isNaN(dueDate.getTime()) || dueDate < tomorrowStart || dueDate >= tomorrowEnd) return null;
      return {
        invoiceId: invoice.id,
        invoiceNo: invoice.invoiceNo || invoice.id,
        customerName: invoice.customer || 'Покупатель',
        remainingAmount,
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .sort((left, right) => right.remainingAmount - left.remainingAmount);

  const revenueTrend = chartMode === 'day'
    ? (() => {
        const daysInRange = Math.max(1, Math.ceil((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24)) + 1);
        return Array.from({ length: daysInRange }, (_, index) => {
          const day = new Date(from.getFullYear(), from.getMonth(), from.getDate() + index);
          const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate());
          const dayEnd = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
          const sales = salesPaymentsInRange.reduce((sum, payment) => {
            const paymentDate = new Date(payment.paymentDate);
            if (paymentDate >= dayStart && paymentDate < dayEnd) {
              return sum + Number(payment.amount || 0);
            }
            return sum;
          }, 0);
          return {
            key: day.toISOString().slice(0, 10),
            name: day.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' }),
            sales,
          };
        });
      })()
    : (() => {
        const trendMap = new Map<string, { key: string; name: string; sales: number }>();
        const cursor = new Date(from.getFullYear(), from.getMonth(), 1);
        const endCursor = new Date(to.getFullYear(), to.getMonth(), 1);

        while (cursor <= endCursor) {
          const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`;
          trendMap.set(key, {
            key,
            name: cursor.toLocaleDateString('ru-RU', { month: 'short' }),
            sales: 0,
          });
          cursor.setMonth(cursor.getMonth() + 1);
        }

        for (const payment of salesPaymentsInRange) {
          const paymentDate = new Date(payment.paymentDate);
          const key = `${paymentDate.getFullYear()}-${String(paymentDate.getMonth() + 1).padStart(2, '0')}`;
          const bucket = trendMap.get(key);
          if (bucket) {
            bucket.sales += Number(payment.amount || 0);
          }
        }

        return Array.from(trendMap.values());
      })();

  const result = {
    range: {
      preset,
      from,
      to,
    },
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
      total: revenueInRange,
      averageDaily: avgDailyRevenue,
      recognizedInvoiceCount: salesInvoicesInRange.length,
    },
    revenueTrend: {
      mode: chartMode,
      items: revenueTrend,
    },
    finance: {
      outstandingOrdinarySales: unpaidAmount,
      totalDebtorOutstanding,
      writeOffAmountMonth,
      grossMarginMonth,
    },
    creditReceivables: {
      totalOutstandingAmount: totalDebtorOutstanding,
      totalCustomersCount: totalDebtorCustomersCount,
      openCount: debtorOpenInvoices.length,
      overdueAmountTotal: overdueReceivables.reduce((sum, item) => sum + item.remainingAmount, 0),
      overdueCount: overdueReceivables.length,
      overdueCustomersCount: new Set(overdueReceivables.map((item) => item.customerKey)).size,
      overdueItems: overdueReceivables.slice(0, 4),
      dueTomorrowAmountTotal: dueTomorrowReceivables.reduce((sum, item) => sum + item.remainingAmount, 0),
      dueTomorrowCount: dueTomorrowReceivables.length,
      dueTomorrowItems: dueTomorrowReceivables.slice(0, 4),
    },
    inventoryHighlights: {
      totalInventoryUnits: products.reduce((sum, product) => sum + Number(product.totalStock || 0), 0),
      lowStockItems: lowStockProducts.slice(0, 5),
      expiringItems,
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
