import { prisma } from '../../infrastructure/prisma';
import { z } from 'zod';

export const ReportParamsSchema = z.object({
  preset: z.enum(['month', 'q1', 'q2', 'q3', 'q4', 'year', 'all']).optional().default('month'),
  from: z.string().optional(),
  to: z.string().optional(),
});

export type ReportParams = z.infer<typeof ReportParamsSchema>;

type AgingBuckets = {
  current: number;
  bucket1_30: number;
  bucket31_60: number;
  bucket61_90: number;
  bucket90Plus: number;
  undated: number;
  total: number;
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

const resolveRange = (params: ReportParams) => {
  const { from, to, preset } = params;
  const now = new Date();

  if (from || to) {
    const explicitTo = to ? new Date(to) : now;
    const explicitFrom = from ? new Date(from) : new Date(explicitTo.getTime() - 30 * 24 * 60 * 60 * 1000);
    return { fromDate: explicitFrom, toDate: explicitTo };
  }

  let fromDate: Date;
  let toDate = now;
  switch (preset) {
    case 'q1':
      fromDate = new Date(now.getFullYear(), 0, 1);
      toDate = new Date(now.getFullYear(), 2, 31, 23, 59, 59, 999);
      break;
    case 'q2':
      fromDate = new Date(now.getFullYear(), 3, 1);
      toDate = new Date(now.getFullYear(), 5, 30, 23, 59, 59, 999);
      break;
    case 'q3':
      fromDate = new Date(now.getFullYear(), 6, 1);
      toDate = new Date(now.getFullYear(), 8, 30, 23, 59, 59, 999);
      break;
    case 'q4':
      fromDate = new Date(now.getFullYear(), 9, 1);
      toDate = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
      break;
    case 'year':
      fromDate = new Date(now.getFullYear(), 0, 1);
      break;
    case 'all':
      fromDate = new Date(2020, 0, 1);
      break;
    case 'month':
    default:
      fromDate = new Date(now.getFullYear(), now.getMonth(), 1);
      break;
  }

  return { fromDate, toDate };
};

export class ReportService {
  async getFinanceReport(params: ReportParams) {
    const { fromDate, toDate } = resolveRange(params);
    const now = new Date();

    const invoiceWhere = {
      createdAt: { gte: fromDate, lte: toDate },
      status: { not: 'CANCELLED' as const },
      paymentType: { not: 'CREDIT' as const },
    };

    const [
      invoices,
      returns,
      writeOffs,
      payables,
      batches,
      purchaseInvoices,
      payments,
      expenses,
      purchaseInvoiceItems,
      returnItems,
    ] = await Promise.all([
      prisma.invoice.findMany({
        where: invoiceWhere,
        include: {
          items: {
            include: {
              batch: {
                select: {
                  costBasis: true,
                },
              },
            },
          },
          payments: true,
        },
      }),
      prisma.return.findMany({
        where: {
          createdAt: { gte: fromDate, lte: toDate },
          status: 'COMPLETED',
        },
        select: {
          id: true,
          type: true,
          totalAmount: true,
        },
      }),
      prisma.writeOff.findMany({
        where: {
          createdAt: { gte: fromDate, lte: toDate },
        },
        include: {
          items: true,
        },
      }),
      prisma.payable.findMany({
        where: {
          status: { not: 'PAID' },
        },
      }),
      prisma.batch.findMany({
        where: {
          quantity: { gt: 0 },
        },
        include: {
          product: true,
        },
      }),
      prisma.purchaseInvoice.findMany({
        where: {
          invoiceDate: { gte: fromDate, lte: toDate },
          status: { not: 'CANCELLED' },
        },
        include: {
          items: true,
          payments: true,
          payables: true,
        },
      }),
      prisma.payment.findMany({
        where: {
          paymentDate: { gte: fromDate, lte: toDate },
          status: { not: 'CANCELLED' },
        },
      }),
      prisma.expense.findMany({
        where: {
          date: { gte: fromDate, lte: toDate },
        },
      }),
      prisma.purchaseInvoiceItem.findMany({
        where: {
          purchaseInvoice: {
            invoiceDate: { gte: fromDate, lte: toDate },
            status: { not: 'CANCELLED' },
          },
        },
      }),
      prisma.returnItem.findMany({
        where: {
          return: {
            createdAt: { gte: fromDate, lte: toDate },
            status: 'COMPLETED',
          },
        },
        select: {
          productId: true,
          quantity: true,
        },
      }),
    ]);

    const activeInvoices = invoices.filter((invoice) => invoice.status !== 'RETURNED');
    const revenueGross = activeInvoices.reduce((sum, invoice) => sum + Number(invoice.totalAmount || 0), 0);
    const salesReturnsAmount = returns
      .filter((entry) => entry.type === 'CUSTOMER')
      .reduce((sum, entry) => sum + Number(entry.totalAmount || 0), 0);
    const netRevenue = Math.max(0, revenueGross - salesReturnsAmount);
    const cogs = activeInvoices.reduce((sum, invoice) => sum + invoice.items.reduce((itemSum, item) => {
      const unitCost = Number(item.batch?.costBasis || 0);
      return itemSum + (Number(item.quantity || 0) * unitCost);
    }, 0), 0);
    const grossProfit = netRevenue - cogs;
    const grossMarginPct = netRevenue > 0 ? (grossProfit / netRevenue) * 100 : 0;

    const writeOffAmount = writeOffs.reduce((sum, entry) => sum + entry.items.reduce((itemSum, item) => itemSum + Number(item.lineTotal || (Number(item.unitCost || 0) * Number(item.quantity || 0))), 0), 0);
    const expenseTotal = expenses.reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
    const operatingProfit = grossProfit - writeOffAmount - expenseTotal;
    const operatingMarginPct = netRevenue > 0 ? (operatingProfit / netRevenue) * 100 : 0;
    const taxSales = activeInvoices.reduce((sum, invoice) => sum + Number(invoice.taxAmount || 0), 0);
    const taxPurchases = purchaseInvoices.reduce((sum, invoice) => sum + Number(invoice.taxAmount || 0), 0);

    const apAging = emptyAging();
    let payableOverdue = 0;

    for (const payable of payables) {
      const remaining = Number(payable.remainingAmount || 0);
      addToAging(apAging, payable.dueDate, remaining, now);
      if (payable.dueDate && payable.dueDate.getTime() < now.getTime()) {
        payableOverdue += remaining;
      }
    }

    const inventoryDetailMap = new Map<string, {
      productId: string;
      name: string;
      sku: string;
      totalStock: number;
      soldUnits: number;
      returnedUnits: number;
      writeOffUnits: number;
      costValue: number;
      retailValue: number;
    }>();

    let inventoryCostValue = 0;
    let inventoryRetailValue = 0;

    for (const batch of batches) {
      const quantity = Number(batch.quantity || 0);
      const costValue = quantity * Number(batch.costBasis || 0);
      const retailValue = quantity * Number(batch.product.sellingPrice || 0);
      inventoryCostValue += costValue;
      inventoryRetailValue += retailValue;

      const existing = inventoryDetailMap.get(batch.productId) || {
        productId: batch.productId,
        name: batch.product.name,
        sku: batch.product.sku,
        totalStock: 0,
        soldUnits: 0,
        returnedUnits: 0,
        writeOffUnits: 0,
        costValue: 0,
        retailValue: 0,
      };

      existing.totalStock += quantity;
      existing.costValue += costValue;
      existing.retailValue += retailValue;
      inventoryDetailMap.set(batch.productId, existing);
    }

    for (const invoice of activeInvoices) {
      for (const item of invoice.items) {
        const row = inventoryDetailMap.get(item.productId);
        if (row) row.soldUnits += Number(item.quantity || 0);
      }
    }

    for (const item of returnItems) {
      const row = inventoryDetailMap.get(item.productId);
      if (row) row.returnedUnits += Number(item.quantity || 0);
    }

    for (const writeOff of writeOffs) {
      for (const item of writeOff.items) {
        const row = inventoryDetailMap.get(item.productId);
        if (row) row.writeOffUnits += Number(item.quantity || 0);
      }
    }

    const trendMap = new Map<string, { month: string; revenue: number; expenses: number; purchases: number }>();
    for (let i = 11; i >= 0; i -= 1) {
      const date = new Date(toDate);
      date.setMonth(date.getMonth() - i);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      trendMap.set(key, { month: key, revenue: 0, expenses: 0, purchases: 0 });
    }

    for (const invoice of activeInvoices) {
      const key = `${invoice.createdAt.getFullYear()}-${String(invoice.createdAt.getMonth() + 1).padStart(2, '0')}`;
      if (trendMap.has(key)) {
        trendMap.get(key)!.revenue += Number(invoice.totalAmount || 0);
      }
    }

    for (const expense of expenses) {
      const key = `${expense.date.getFullYear()}-${String(expense.date.getMonth() + 1).padStart(2, '0')}`;
      if (trendMap.has(key)) {
        trendMap.get(key)!.expenses += Number(expense.amount || 0);
      }
    }

    for (const purchaseInvoice of purchaseInvoices) {
      const key = `${purchaseInvoice.invoiceDate.getFullYear()}-${String(purchaseInvoice.invoiceDate.getMonth() + 1).padStart(2, '0')}`;
      if (trendMap.has(key)) {
        trendMap.get(key)!.purchases += Number(purchaseInvoice.totalAmount || 0);
      }
    }

    const expenseByCategory = expenses.reduce<Record<string, number>>((acc, expense) => {
      const key = String(expense.category || 'OTHER').trim() || 'OTHER';
      acc[key] = (acc[key] || 0) + Number(expense.amount || 0);
      return acc;
    }, {});

    const byMethod = payments.reduce<Record<string, number>>((acc, payment) => {
      const key = String(payment.method || 'OTHER');
      acc[key] = (acc[key] || 0) + Number(payment.amount || 0);
      return acc;
    }, {});
    const cashflowIn = payments
      .filter((payment) => payment.direction === 'IN')
      .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
    const cashflowOut = payments
      .filter((payment) => payment.direction === 'OUT')
      .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);

    const saleDetails = activeInvoices.map((invoice) => {
      const invoicePaidAmount = invoice.payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
      const outstandingAmount = Math.max(0, Number(invoice.totalAmount || 0) - invoicePaidAmount);

      return {
        invoiceId: invoice.id,
        invoiceNo: invoice.invoiceNo,
        createdAt: invoice.createdAt.toISOString(),
        customer: invoice.customer || 'Розничный покупатель',
        paymentType: invoice.paymentType,
        totalAmount: Number(invoice.totalAmount || 0),
        paidAmount: invoicePaidAmount,
        outstandingAmount,
        itemCount: invoice.items.length,
        soldUnits: invoice.items.reduce((sum, item) => sum + Number(item.quantity || 0), 0),
        items: invoice.items.map((item) => {
          const unitCost = Number(item.batch?.costBasis || 0);
          const lineTotal = Number(item.totalPrice || 0);
          const lineProfit = lineTotal - (Number(item.quantity || 0) * unitCost);

          return {
            productId: item.productId,
            productName: item.productName,
            sku: item.batchNo || '-',
            quantity: Number(item.quantity || 0),
            unitPrice: Number(item.unitPrice || 0),
            unitCost,
            lineTotal,
            lineProfit,
          };
        }),
      };
    });

    const productTotalsMap = new Map<string, { productId: string; name: string; sku: string; soldUnits: number; salesCount: number; revenue: number }>();
    for (const sale of saleDetails) {
      for (const item of sale.items) {
        const existing = productTotalsMap.get(item.productId) || {
          productId: item.productId,
          name: item.productName,
          sku: item.sku,
          soldUnits: 0,
          salesCount: 0,
          revenue: 0,
        };
        existing.soldUnits += item.quantity;
        existing.salesCount += 1;
        existing.revenue += item.lineTotal;
        productTotalsMap.set(item.productId, existing);
      }
    }

    const paidCount = invoices.filter((invoice) => invoice.paymentStatus === 'PAID').length;
    const pendingCount = invoices.filter((invoice) => invoice.paymentStatus === 'UNPAID' || invoice.paymentStatus === 'PARTIALLY_PAID' || invoice.status === 'PENDING').length;
    const returnedCount = invoices.filter((invoice) => invoice.status === 'RETURNED' || invoice.status === 'PARTIALLY_RETURNED').length;
    const cancelledCount = invoices.filter((invoice) => invoice.status === 'CANCELLED').length;
    const totalCount = invoices.length;
    const avgTicket = activeInvoices.length > 0 ? revenueGross / activeInvoices.length : 0;
    const purchaseUnpaidCount = purchaseInvoices.filter((invoice) => invoice.paymentStatus === 'UNPAID' || invoice.paymentStatus === 'PARTIALLY_PAID').length;

    return {
      range: { preset: params.preset, from: fromDate.toISOString(), to: toDate.toISOString() },
      kpi: {
        revenueGross,
        salesReturnsAmount,
        netRevenue,
        cogs,
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
        totalCount,
        paidCount,
        pendingCount,
        returnedCount,
        cancelledCount,
        avgTicket,
      },
      cashflow: {
        inflow: cashflowIn,
        outflow: cashflowOut,
        net: cashflowIn - cashflowOut,
        byMethod,
      },
      debts: {
        payableTotal: apAging.total,
        payableOverdue,
        apAging,
      },
      purchases: {
        total: purchaseInvoices.reduce((sum, invoice) => sum + Number(invoice.totalAmount || 0), 0),
        count: purchaseInvoices.length,
        unpaidCount: purchaseUnpaidCount,
      },
      inventory: {
        costValue: inventoryCostValue,
        retailValue: inventoryRetailValue,
        unrealizedMargin: inventoryRetailValue - inventoryCostValue,
        details: Array.from(inventoryDetailMap.values()).sort((left, right) => right.retailValue - left.retailValue).slice(0, 100),
      },
      balanceLike: {
        cashLike: cashflowIn - cashflowOut,
        inventoryCostValue,
        payableTotal: apAging.total,
        totalAssetsLike: (cashflowIn - cashflowOut) + inventoryCostValue,
        totalLiabilitiesLike: apAging.total,
        equityLike: ((cashflowIn - cashflowOut) + inventoryCostValue) - apAging.total,
      },
      expenseByCategory,
      trend: Array.from(trendMap.values()),
      currentMonthSales: {
        from: fromDate.toISOString(),
        to: toDate.toISOString(),
        saleDetails,
        productTotals: Array.from(productTotalsMap.values()).sort((left, right) => right.revenue - left.revenue).slice(0, 50),
      },
      meta: {
        source: {
          invoiceCount: invoices.length,
          purchaseInvoiceCount: purchaseInvoices.length,
          paymentCount: payments.length,
          expenseCount: expenses.length,
          purchaseItemCount: purchaseInvoiceItems.length,
        },
      },
    };
  }
  async getDebtsReport(params: ReportParams) {
    const { fromDate, toDate } = resolveRange(params);
    
    const debts = await prisma.invoice.findMany({
      where: {
        paymentType: 'CREDIT',
        status: { notIn: ['CANCELLED', 'PAID'] },
      },
      include: {
        items: true,
        payments: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    const summary = debts.reduce((acc, inv) => {
      const paid = inv.payments.reduce((sum, p) => sum + p.amount, 0);
      const total = inv.totalAmount;
      const debt = total - paid;
      
      acc.totalDebt += debt;
      if (inv.paymentStatus === 'UNPAID') acc.unpaidCount++;
      if (inv.paymentStatus === 'PARTIALLY_PAID') acc.partialCount++;
      
      return acc;
    }, { totalDebt: 0, unpaidCount: 0, partialCount: 0, totalCount: debts.length });

    return { items: debts, summary };
  }
}

export const reportService = new ReportService();
