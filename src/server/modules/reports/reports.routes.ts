import { Router } from 'express';
import { authenticate, type AuthedRequest } from '../../common/auth';
import { asyncHandler } from '../../common/http';
import { prisma } from '../../infrastructure/prisma';
import { ValidationError } from '../../common/errors';
import { readReportSettings, writeReportSettings } from './reportSettings.storage';
import { reportCache, CACHE_KEYS, CACHE_TTL } from '../../common/cache';
import { reportService, ReportParamsSchema } from './report.service';

export const reportsRouter = Router();

type PeriodPreset = 'month' | 'q1' | 'q2' | 'q3' | 'q4' | 'year' | 'all';

const getDebtorCustomerKey = (invoice: { id: string; customerId?: string | null; customer?: string | null }) => {
  const normalizedName = String(invoice.customer || '').trim().toLocaleLowerCase('ru-RU').replace(/\s+/g, ' ');
  return invoice.customerId || (normalizedName ? `name:${normalizedName}` : invoice.id);
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

const getReceivableRemainingAmount = (receivable: {
  originalAmount?: number | null;
  paidAmount?: number | null;
  remainingAmount?: number | null;
}) => {
  const explicit = Number(receivable.remainingAmount ?? NaN);
  if (Number.isFinite(explicit)) return Math.max(0, explicit);
  return Math.max(0, Number(receivable.originalAmount || 0) - Number(receivable.paidAmount || 0));
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

reportsRouter.get('/finance', authenticate, asyncHandler(async (req, res) => {
  const parseResult = ReportParamsSchema.safeParse(req.query);
  if (!parseResult.success) {
    throw new ValidationError(`Invalid parameters: ${parseResult.error.issues.map(e => e.message).join(', ')}`);
  }
  const params = parseResult.data;

  const cacheKey = CACHE_KEYS.financeReport(params.preset, params.from || 'none', params.to || 'none');
  const cachedResult = reportCache.get(cacheKey);
  
  if (cachedResult) {
    res.set('X-Cache', 'HIT');
    return res.json(cachedResult);
  }

  res.set('X-Cache', 'MISS');
  const result = await reportService.getFinanceReport(params);
  
  reportCache.set(cacheKey, result, CACHE_TTL.financeReport);
  res.json(result);
}));

reportsRouter.get('/metrics/dashboard', authenticate, asyncHandler(async (req, res) => {
  const presetRaw = String(req.query.preset || 'month').toLowerCase();
  const preset: PeriodPreset = ['month', 'q1', 'q2', 'q3', 'q4', 'year', 'all'].includes(presetRaw)
    ? (presetRaw as PeriodPreset)
    : 'month';
  const { from, to } = resolveRange(preset, req.query.from, req.query.to);
  const cacheKey = CACHE_KEYS.dashboardMetrics(`${preset}:${from.toISOString().slice(0, 10)}:${to.toISOString().slice(0, 10)}`);

  const cachedResult = reportCache.get(cacheKey);
  if (cachedResult) {
    res.set('X-Cache', 'HIT');
    return res.json(cachedResult);
  }

  res.set('X-Cache', 'MISS');

  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const monthEnd = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0, 23, 59, 59, 999);
  const chartMode = preset === 'month' ? 'day' : 'month';

  const [products, salesInvoicesInRange, ordinaryOpenInvoices, creditInvoices, batches, writeoffsMonth, monthlySalesInvoices, receivables, purchasePayables] = await Promise.all([
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
        status: { notIn: ['CANCELLED'] },
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
      where: {
        quantity: { gt: 0 },
      },
      select: {
        id: true,
        productId: true,
        batchNumber: true,
        quantity: true,
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
        status: { notIn: ['CANCELLED'] },
      },
      select: {
        id: true,
        totalAmount: true,
        status: true,
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
    prisma.receivable.findMany({
      where: {
        status: { not: 'PAID' },
      },
      select: {
        id: true,
        invoiceId: true,
        originalAmount: true,
        paidAmount: true,
        remainingAmount: true,
        dueDate: true,
        customer: {
          select: {
            name: true,
          },
        },
        invoice: {
          select: {
            invoiceNo: true,
            customer: true,
          },
        },
      },
    }),
    prisma.payable.findMany({
      where: {
        status: { not: 'PAID' },
      },
      select: {
        remainingAmount: true,
        dueDate: true,
      },
    }),
  ]);

  const now = new Date();
  const thirtyDaysLater = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const tomorrowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const tomorrowEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2);

  const getInvoiceOutstanding = (invoice: { totalAmount?: number | null; receivables?: Array<{ remainingAmount?: number | null }>; payments?: Array<{ amount?: number | null }> }) => getInvoiceOutstandingAmount(invoice);

  const lowStockProducts = products
    .filter((p) => p.totalStock < (p.minStock || 10))
    .map((p) => ({
      productId: p.id,
      name: p.name,
      currentStock: p.totalStock,
      minStock: p.minStock || 10,
    }))
    .sort((left, right) => (left.currentStock - left.minStock) - (right.currentStock - right.minStock));

  const expiredBatchesCount = batches.filter(b => Number(b.quantity || 0) > 0 && b.expiryDate && new Date(b.expiryDate) < now).length;
  const expiringBatchesCount = batches.filter(b => {
    if (!b.expiryDate) return false;
    const expDate = new Date(b.expiryDate);
    return Number(b.quantity || 0) > 0 && expDate >= now && expDate <= thirtyDaysLater;
  }).length;
  
  const expiringItems = batches
    .map((batch) => {
      if (!batch.expiryDate) return null;
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
    .filter(Boolean)
    .sort((a, b) => (a?.severityRank || 0) - (b?.severityRank || 0))
    .slice(0, 5);

  const unpaidInvoices = ordinaryOpenInvoices.filter(inv => getInvoiceOutstanding(inv) > 0);
  const unpaidAmount = unpaidInvoices.reduce((sum, inv) => sum + getInvoiceOutstanding(inv), 0);

  const debtorOpenInvoices = [...creditInvoices, ...ordinaryOpenInvoices]
    .filter((invoice) => getInvoiceOutstanding(invoice) > 0);

  const totalDebtorOutstanding = debtorOpenInvoices.reduce((sum, invoice) => sum + getInvoiceOutstanding(invoice), 0);
  const totalDebtorCustomersCount = new Set(debtorOpenInvoices.map((invoice) => getDebtorCustomerKey(invoice))).size;
  const revenueGrossInRange = salesInvoicesInRange
    .filter((invoice) => invoice.status !== 'RETURNED')
    .reduce((sum, invoice) => sum + Number(invoice.totalAmount || 0), 0);
  const returnsInRange = salesInvoicesInRange
    .filter((invoice) => invoice.status === 'RETURNED' || invoice.status === 'PARTIALLY_RETURNED')
    .reduce((sum, invoice) => sum + Number(invoice.totalAmount || 0), 0);
  const revenueInRange = Math.max(0, revenueGrossInRange - returnsInRange);
  const rangeDays = Math.max(1, Math.ceil((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24)) + 1);
  const avgDailyRevenue = revenueInRange / rangeDays;
  const salesByKey = new Map<string, number>();
  for (const invoice of salesInvoicesInRange) {
    const invoiceDate = new Date(invoice.createdAt);
    const key = chartMode === 'day'
      ? invoiceDate.toISOString().slice(0, 10)
      : `${invoiceDate.getFullYear()}-${String(invoiceDate.getMonth() + 1).padStart(2, '0')}`;
    const sign = invoice.status === 'RETURNED' || invoice.status === 'PARTIALLY_RETURNED' ? -1 : 1;
    salesByKey.set(key, (salesByKey.get(key) || 0) + (Number(invoice.totalAmount || 0) * sign));
  }

  const revenueTrend = chartMode === 'day'
    ? Array.from({ length: Math.ceil((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24)) + 1 }).map((_, i) => {
        const date = new Date(from);
        date.setDate(date.getDate() + i);
        const key = date.toISOString().slice(0, 10);
        return {
          key,
          name: date.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' }),
          sales: Number(salesByKey.get(key) || 0),
        };
      })
    : Array.from({ length: ((to.getFullYear() - from.getFullYear()) * 12) + (to.getMonth() - from.getMonth()) + 1 }).map((_, i) => {
        const date = new Date(from.getFullYear(), from.getMonth() + i, 1);
        const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        return {
          key,
          name: date.toLocaleDateString('ru-RU', { month: 'short', year: '2-digit' }),
          sales: Number(salesByKey.get(key) || 0),
        };
      });

  const monthlyRevenueGross = monthlySalesInvoices
    .filter((invoice) => invoice.status !== 'RETURNED')
    .reduce((sum, invoice) => sum + Number(invoice.totalAmount || 0), 0);
  const monthlyReturnAmount = monthlySalesInvoices
    .filter((invoice) => invoice.status === 'RETURNED' || invoice.status === 'PARTIALLY_RETURNED')
    .reduce((sum, invoice) => sum + Number(invoice.totalAmount || 0), 0);
  const monthlyCogs = monthlySalesInvoices
    .filter((invoice) => invoice.status !== 'RETURNED')
    .reduce((sum, invoice) => sum + invoice.items.reduce((itemSum, item) => itemSum + (Number(item.quantity || 0) * Number(item.batch?.costBasis || 0)), 0), 0);
  const monthlyNetRevenue = Math.max(0, monthlyRevenueGross - monthlyReturnAmount);
  const grossMarginMonth = monthlyNetRevenue - monthlyCogs;
  const writeOffAmountMonth = writeoffsMonth.reduce((sum, writeoff) => sum + Number(
    writeoff.totalAmount ||
    writeoff.items.reduce((itemSum, item) => itemSum + Number(item.lineTotal || (Number(item.unitCost || 0) * Number(item.quantity || 0))), 0),
  ), 0);

  const overdueItems = receivables
    .map((receivable) => {
      const remainingAmount = getReceivableRemainingAmount(receivable);
      if (!receivable.dueDate || remainingAmount <= 0) return null;
      const dueDate = new Date(receivable.dueDate);
      const daysOverdue = Math.floor((now.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));
      if (daysOverdue <= 0) return null;

      return {
        invoiceId: receivable.invoiceId || receivable.id,
        invoiceNo: receivable.invoice?.invoiceNo || '—',
        customerName: receivable.customer?.name || receivable.invoice?.customer || 'Покупатель',
        remainingAmount,
        daysOverdue,
      };
    })
    .filter(Boolean)
    .sort((left, right) => Number(right?.daysOverdue || 0) - Number(left?.daysOverdue || 0));

  const dueTomorrowItems = receivables
    .map((receivable) => {
      const remainingAmount = getReceivableRemainingAmount(receivable);
      if (!receivable.dueDate || remainingAmount <= 0) return null;
      const dueDate = new Date(receivable.dueDate);
      if (dueDate < tomorrowStart || dueDate >= tomorrowEnd) return null;

      return {
        invoiceId: receivable.invoiceId || receivable.id,
        invoiceNo: receivable.invoice?.invoiceNo || '—',
        customerName: receivable.customer?.name || receivable.invoice?.customer || 'Покупатель',
        remainingAmount,
      };
    })
    .filter(Boolean)
    .sort((left, right) => Number(right?.remainingAmount || 0) - Number(left?.remainingAmount || 0));

  const totalReceivableOutstanding = receivables.reduce((sum, receivable) => sum + getReceivableRemainingAmount(receivable), 0);
  const overdueAmountTotal = overdueItems.reduce((sum, item) => sum + Number(item?.remainingAmount || 0), 0);
  const overdueCustomersCount = new Set(overdueItems.map((item) => String(item?.customerName || '').toLocaleLowerCase('ru-RU'))).size;
  const dueTomorrowAmountTotal = dueTomorrowItems.reduce((sum, item) => sum + Number(item?.remainingAmount || 0), 0);
  const payableTotal = purchasePayables.reduce((sum, payable) => sum + Number(payable.remainingAmount || 0), 0);

  const result = {
    range: { preset, from, to },
    lowStock: { count: lowStockProducts.length, items: lowStockProducts.slice(0, 10) },
    expiry: { expired: expiredBatchesCount, expiringSoon: expiringBatchesCount },
    invoices: { unpaidCount: unpaidInvoices.length, unpaidAmount, averageUnpaid: unpaidInvoices.length > 0 ? unpaidAmount / unpaidInvoices.length : 0 },
    revenue: { total: revenueInRange, averageDaily: avgDailyRevenue, recognizedInvoiceCount: salesInvoicesInRange.length },
    revenueTrend: { mode: chartMode, items: revenueTrend },
    finance: { outstandingOrdinarySales: unpaidAmount, totalDebtorOutstanding, writeOffAmountMonth, grossMarginMonth, payableTotal },
    creditReceivables: {
      totalOutstandingAmount: totalReceivableOutstanding,
      totalCustomersCount: totalDebtorCustomersCount,
      openCount: receivables.filter((entry) => getReceivableRemainingAmount(entry) > 0).length,
      overdueAmountTotal,
      overdueCount: overdueItems.length,
      overdueCustomersCount,
      overdueItems: overdueItems.slice(0, 5),
      dueTomorrowAmountTotal,
      dueTomorrowCount: dueTomorrowItems.length,
      dueTomorrowItems: dueTomorrowItems.slice(0, 5),
    },
    summary: { totalProducts: products.length, totalBatches: batches.length, alertCount: lowStockProducts.length + expiredBatchesCount + expiringBatchesCount + overdueItems.length },
    inventoryHighlights: { totalInventoryUnits: products.reduce((sum, p) => sum + Number(p.totalStock || 0), 0), lowStockItems: lowStockProducts.slice(0, 5), expiringItems }
  };

  reportCache.set(cacheKey, result, CACHE_TTL.dashboardMetrics);
  res.json(result);
}));

reportsRouter.get('/metrics/inventory-status', authenticate, asyncHandler(async (req, res) => {
  const cacheKey = CACHE_KEYS.inventoryStatus();
  const cachedResult = reportCache.get(cacheKey);
  if (cachedResult) return res.json(cachedResult);

  const products = await prisma.product.findMany({
    where: { isActive: true },
    select: { id: true, name: true, sku: true, totalStock: true, minStock: true, costPrice: true, sellingPrice: true }
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
    }
  };

  reportCache.set(cacheKey, result, CACHE_TTL.inventoryStatus);
  res.json(result);
}));
