import { Router } from 'express';
import { authenticate, requireRole, type AuthedRequest } from '../../common/auth';
import { asyncHandler } from '../../common/http';
import { db } from '../../infrastructure/prisma';
import { ValidationError } from '../../common/errors';
import { readReportSettings, writeReportSettings } from './reportSettings.storage';
import { readSystemSettings, getDefaultUserPreferences } from '../system/systemSettings.storage';
import { reportCache, CACHE_KEYS, CACHE_TTL } from '../../common/cache';
import { reportService, ReportParamsSchema } from './report.service';
import { alertsService } from '../../services/alerts.service';

export const reportsRouter = Router();

type PeriodPreset = 'month' | 'q1' | 'q2' | 'q3' | 'q4' | 'year' | 'all';


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

// PUT /profile — ADMIN, OWNER only
reportsRouter.put('/profile', authenticate, requireRole(['ADMIN', 'OWNER']), asyncHandler(async (req, res) => {
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

// GET /finance — ADMIN, OWNER only (contains P&L, COGS, margins)
reportsRouter.get('/finance', authenticate, requireRole(['ADMIN', 'OWNER']), asyncHandler(async (req, res) => {
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

reportsRouter.get('/debts', authenticate, asyncHandler(async (req, res) => {
  const parseResult = ReportParamsSchema.safeParse(req.query);
  if (!parseResult.success) {
    throw new ValidationError(`Invalid parameters: ${parseResult.error.issues.map(e => e.message).join(', ')}`);
  }
  const result = await reportService.getDebtsReport(parseResult.data);
  res.json(result);
}));

reportsRouter.get('/alerts', authenticate, asyncHandler(async (_req, res) => {
  const result = await alertsService.getDashboardAlerts();
  res.json(result);
}));


reportsRouter.get('/metrics/dashboard', authenticate, asyncHandler(async (req, res) => {
  const authedReq = req as AuthedRequest;
  const sysSettings = await readSystemSettings();
  const userPrefs = sysSettings.userPreferences[authedReq.user.id] || getDefaultUserPreferences();

  const presetRaw = String(req.query.preset || 'month').toLowerCase();
  const preset: PeriodPreset = ['month', 'q1', 'q2', 'q3', 'q4', 'year', 'all'].includes(presetRaw)
    ? (presetRaw as PeriodPreset)
    : 'month';
  const { from, to } = resolveRange(preset, req.query.from, req.query.to);

  // Use user-defined thresholds
  const lowStockThreshold = userPrefs.notifications.lowStockThreshold;
  const expiryThresholdDays = userPrefs.notifications.expiryThresholdDays;
  
  const now = new Date();
  const expiryThresholdDate = new Date(now.getTime() + expiryThresholdDays * 24 * 60 * 60 * 1000);
  
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const monthEnd = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0, 23, 59, 59, 999);
  const chartMode = preset === 'month' ? 'day' : 'month';

  const [products, salesInvoicesInRange, ordinaryOpenInvoices, batches, writeoffsMonth, monthlySalesInvoices, receivables, purchasePayables, dashboardAlerts] = await Promise.all([
    db.product.findMany({
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
    db.invoice.findMany({
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
        createdAt: true,
        payments: {
          select: {
            amount: true,
          },
        },
      },
    }),
    db.invoice.findMany({
      where: {
        status: { in: ['PENDING', 'PAID'] },
        paymentStatus: { in: ['UNPAID', 'PARTIALLY_PAID'] },
      },
      select: {
        id: true,
        invoiceNo: true,
        createdAt: true,
        totalAmount: true,
        payments: {
          select: {
            amount: true,
          },
        },
      },
    }),
    db.batch.findMany({
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
    db.writeOff.findMany({
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
    db.invoice.findMany({
      where: {
        createdAt: { gte: monthStart, lte: monthEnd },
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
    db.receivable.findMany({
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
        invoice: {
          select: {
            invoiceNo: true,
          },
        },
      },
    }),
    db.payable.findMany({
      where: {
        status: { not: 'PAID' },
      },
      select: {
        remainingAmount: true,
        dueDate: true,
      },
    }),
    alertsService.getDashboardAlerts(),
  ]);

  const getInvoiceOutstanding = (invoice: { totalAmount?: number | null; receivables?: Array<{ remainingAmount?: number | null }>; payments?: Array<{ amount?: number | null }> }) => getInvoiceOutstandingAmount(invoice);

  const lowStockProducts = products
    .filter((p) => p.totalStock < Math.max(p.minStock ?? 0, lowStockThreshold))
    .map((p) => {
      const effectiveMin = Math.max(p.minStock ?? 0, lowStockThreshold);
      return {
        productId: p.id,
        name: p.name,
        currentStock: p.totalStock,
        minStock: effectiveMin,
      };
    })
    .sort((left, right) => (left.currentStock - left.minStock) - (right.currentStock - right.minStock));

  const expiringSoonCount = dashboardAlerts.expiringCount;
  const expiringItems = dashboardAlerts.alerts
    .filter(a => a.type === 'EXPIRING')
    .map(a => ({
      id: a.entityId,
      name: a.message.split(' of ')[1],
      batchNumber: a.message.split(' ')[1],
      severityRank: a.severity === 'CRITICAL' ? 1 : 2,
      severityLabel: a.severity === 'CRITICAL' ? 'Критично' : 'Скоро истекает',
    }))
    .slice(0, 5);


  const unpaidInvoices = ordinaryOpenInvoices.filter(inv => getInvoiceOutstanding(inv) > 0);
  const unpaidAmount = unpaidInvoices.reduce((sum, inv) => sum + getInvoiceOutstanding(inv), 0);

  const totalDebtorOutstanding = receivables.reduce((sum, r) => sum + Number(r.remainingAmount || 0), 0);
  const revenueInRange = salesInvoicesInRange
    .filter((invoice) => invoice.status !== 'CANCELLED')
    .reduce((sum, invoice) => sum + Number(invoice.totalAmount || 0), 0);
  const rangeDays = Math.max(1, Math.ceil((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24)) + 1);
  const avgDailyRevenue = revenueInRange / rangeDays;
  const salesByKey = new Map<string, number>();
  for (const invoice of salesInvoicesInRange) {
    const invoiceDate = new Date(invoice.createdAt);
    const key = chartMode === 'day'
      ? invoiceDate.toISOString().slice(0, 10)
      : `${invoiceDate.getFullYear()}-${String(invoiceDate.getMonth() + 1).padStart(2, '0')}`;
    salesByKey.set(key, (salesByKey.get(key) || 0) + Number(invoice.totalAmount || 0));
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

  const monthlyNetRevenue = monthlySalesInvoices
    .filter((invoice) => invoice.status !== 'CANCELLED')
    .reduce((sum, invoice) => sum + Number(invoice.totalAmount || 0), 0);

  const monthlyCogs = monthlySalesInvoices
    .filter((invoice) => invoice.status !== 'CANCELLED')
    .reduce((sum, invoice) => {
      const invoiceCogs = (invoice.items || []).reduce((itemSum, item) => {
        const itemQty = Number(item.quantity || 0);
        const itemCost = Number(item.batch?.costBasis || 0);
        return itemSum + (itemQty * itemCost);
      }, 0);
      return sum + invoiceCogs;
    }, 0);

  const grossMarginMonth = monthlyNetRevenue - monthlyCogs;
  const writeOffAmountMonth = writeoffsMonth.reduce((sum, writeoff) => sum + Number(
    writeoff.totalAmount ||
    writeoff.items.reduce((itemSum, item) => itemSum + Number(item.lineTotal || (Number(item.unitCost || 0) * Number(item.quantity || 0))), 0),
  ), 0);

  const totalReceivableOutstanding = receivables.reduce((sum, receivable) => sum + getReceivableRemainingAmount(receivable), 0);
  const payableTotal = purchasePayables.reduce((sum, payable) => sum + Number(payable.remainingAmount || 0), 0);

  const result = {
    range: { preset, from, to },
    lowStock: { count: lowStockProducts.length, items: lowStockProducts.slice(0, 10) },
    expiry: { expired: dashboardAlerts.alerts.filter(a => a.type === 'EXPIRING' && a.severity === 'CRITICAL').length, expiringSoon: expiringSoonCount },
    invoices: { unpaidCount: unpaidInvoices.length, unpaidAmount, averageUnpaid: unpaidInvoices.length > 0 ? unpaidAmount / unpaidInvoices.length : 0 },
    revenue: { total: revenueInRange, averageDaily: avgDailyRevenue, recognizedInvoiceCount: salesInvoicesInRange.length },
    revenueTrend: { mode: chartMode, items: revenueTrend },
    finance: { outstandingOrdinarySales: unpaidAmount, totalDebtorOutstanding, writeOffAmountMonth, grossMarginMonth, payableTotal },
    summary: { totalProducts: products.length, totalBatches: batches.length, alertCount: dashboardAlerts.lowStockCount + dashboardAlerts.expiringCount },
    inventoryHighlights: { totalInventoryUnits: products.reduce((sum, p) => sum + Number(p.totalStock || 0), 0), lowStockItems: lowStockProducts.slice(0, 5), expiringItems }
  };

  res.json(result);
}));

reportsRouter.get('/metrics/inventory-status', authenticate, asyncHandler(async (req, res) => {
  const cacheKey = CACHE_KEYS.inventoryStatus();
  const cachedResult = reportCache.get(cacheKey);
  if (cachedResult) return res.json(cachedResult);

  const products = await db.product.findMany({
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

reportsRouter.get('/expiry', authenticate, asyncHandler(async (req, res) => {
  const { status = 'all' } = req.query;
  const now = new Date();
  const warningThreshold = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000); // 90 days
  const criticalThreshold = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days

  const where: any = {
    quantity: { gt: 0 },
  };

  if (status === 'expired') {
    where.expiryDate = { lt: now };
  } else if (status === 'critical') {
    where.expiryDate = { gte: now, lte: criticalThreshold };
  } else if (status === 'warning') {
    where.expiryDate = { gte: criticalThreshold, lte: warningThreshold };
  }

  const batches = await db.batch.findMany({
    where,
    include: {
      product: {
        select: {
          name: true,
          sku: true,
          category: true,
        },
      },
    },
    orderBy: {
      expiryDate: 'asc',
    },
  });

  const result = batches.map(b => {
    const expiryDate = b.expiryDate ? new Date(b.expiryDate) : null;
    const daysLeft = expiryDate 
      ? Math.ceil((expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
      : null;

    let severity: 'expired' | 'critical' | 'warning' | 'normal' = 'normal';
    if (daysLeft !== null) {
      if (daysLeft < 0) severity = 'expired';
      else if (daysLeft <= 30) severity = 'critical';
      else if (daysLeft <= 90) severity = 'warning';
    }

    return {
      id: b.id,
      productId: b.productId,
      productName: b.product.name,
      sku: b.product.sku,
      category: b.product.category,
      batchNumber: b.batchNumber,
      quantity: b.quantity,
      expiryDate: b.expiryDate,
      daysLeft,
      severity,
    };
  });

  res.json(result);
}));
