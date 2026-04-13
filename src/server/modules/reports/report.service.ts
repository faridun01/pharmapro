import { prisma } from '../../infrastructure/prisma';
import { NotFoundError, ValidationError } from '../../common/errors';
import { z } from 'zod';
import { parseAuditJson } from '../../common/utils';

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

export class ReportService {
  async getFinanceReport(params: ReportParams) {
    const { from, to, preset } = params;

    // Range logic moved from routes
    let fromDate: Date;
    let toDate: Date = to ? new Date(to) : new Date();

    if (from && to) {
      fromDate = new Date(from);
    } else {
      const now = new Date();
      switch (preset) {
        case 'q1': fromDate = new Date(now.getFullYear(), 0, 1); toDate = new Date(now.getFullYear(), 2, 31, 23, 59, 59); break;
        case 'q2': fromDate = new Date(now.getFullYear(), 3, 1); toDate = new Date(now.getFullYear(), 5, 30, 23, 59, 59); break;
        case 'q3': fromDate = new Date(now.getFullYear(), 6, 1); toDate = new Date(now.getFullYear(), 8, 30, 23, 59, 59); break;
        case 'q4': fromDate = new Date(now.getFullYear(), 9, 1); toDate = new Date(now.getFullYear(), 11, 31, 23, 59, 59); break;
        case 'year': fromDate = new Date(now.getFullYear(), 0, 1); break;
        case 'all': fromDate = new Date(2020, 0, 1); break;
        case 'month':
        default:
          fromDate = new Date(now.getFullYear(), now.getMonth(), 1);
          break;
      }
    }

    const whereRange = { createdAt: { gte: fromDate, lte: toDate } };

    // 1. KPIs
    const [invoices, returns, writeOffs, items] = await Promise.all([
      prisma.invoice.findMany({
        where: { ...whereRange, status: { notIn: ['CANCELLED'] } },
        include: { items: true, payments: true },
      }),
      prisma.return.findMany({
        where: { createdAt: { gte: fromDate, lte: toDate }, status: 'COMPLETED' },
      }),
      prisma.batchMovement.findMany({
        where: { date: { gte: fromDate, lte: toDate }, type: 'WRITE_OFF' },
        include: { batch: true },
      }),
      prisma.invoiceItem.findMany({
          where: { invoice: { ...whereRange, status: { notIn: ['CANCELLED'] } } },
          include: { batch: true }
      })
    ]);

    const revenueGross = invoices.reduce((sum, inv) => sum + Number(inv.totalAmount), 0);
    const customerReturnsAmount = returns.reduce((sum, ret) => sum + Number(ret.totalAmount), 0);
    const netRevenue = revenueGross - customerReturnsAmount;
    
    // Simple COGS calculation (sum of unitCost * quantity for sold items)
    // In production we'd use batch.costBasis
    const cogs = items.reduce((sum, item) => {
        const cost = Number(item.batch?.costBasis || 0);
        return sum + (cost * Number(item.quantity));
    }, 0);

    const grossProfit = netRevenue - cogs;
    const grossMarginPct = netRevenue > 0 ? (grossProfit / netRevenue) * 100 : 0;

    // 2. Debt Analysis
    const [receivables, payables] = await Promise.all([
      prisma.receivable.findMany({ where: { status: { not: 'PAID' } } }),
      prisma.payable.findMany({ where: { status: { not: 'PAID' } } }),
    ]);

    const now = new Date();
    const arAging = emptyAging();
    const apAging = emptyAging();

    for (const r of receivables) {
        addToAging(arAging, r.dueDate, Number(r.remainingAmount), now);
    }
    for (const p of payables) {
        addToAging(apAging, p.dueDate, Number(p.remainingAmount), now);
    }

    const receivableTotal = arAging.total;
    const payableTotal = apAging.total;

    // 3. Inventory Value & Details
    const [batches, allInvoicesForStats] = await Promise.all([
        prisma.batch.findMany({
            where: { quantity: { gt: 0 } },
            include: { product: true }
        }),
        prisma.invoice.findMany({
          where: { ...whereRange, status: { notIn: ['CANCELLED'] } },
          include: { items: true }
        })
    ]);

    const inventoryDetailMap = new Map();
    let inventoryCostValue = 0;
    let inventoryRetailValue = 0;

    for (const b of batches) {
        const costVal = Number(b.quantity) * Number(b.costBasis || 0);
        const retailVal = Number(b.quantity) * Number(b.product.sellingPrice || 0);
        inventoryCostValue += costVal;
        inventoryRetailValue += retailVal;

        const existing = inventoryDetailMap.get(b.productId) || { 
            productId: b.productId, 
            name: b.product.name, 
            sku: b.product.sku, 
            totalStock: 0, 
            soldUnits: 0, 
            returnedUnits: 0, 
            writeOffUnits: 0, 
            costValue: 0, 
            retailValue: 0 
        };
        existing.totalStock += Number(b.quantity);
        existing.costValue += costVal;
        existing.retailValue += retailVal;
        inventoryDetailMap.set(b.productId, existing);
    }

    // Add stats to inventoryDetails
    for (const inv of allInvoicesForStats) {
        for (const item of inv.items) {
            const row = inventoryDetailMap.get(item.productId);
            if (row) row.soldUnits += Number(item.quantity);
        }
    }

    // 4. Trend Analysis (12 Months)
    const trendMap = new Map();
    for (let i = 11; i >= 0; i--) {
        const d = new Date(toDate);
        d.setMonth(d.getMonth() - i);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        trendMap.set(key, { month: key, revenue: 0, expenses: 0, purchases: 0 });
    }

    // Map sales to trends
    for (const inv of invoices) {
        const key = `${inv.createdAt.getFullYear()}-${String(inv.createdAt.getMonth() + 1).padStart(2, '0')}`;
        if (trendMap.has(key)) {
            trendMap.get(key).revenue += Number(inv.totalAmount);
        }
    }

    // 5. Detailed Sales (Current Month / Preset)
    const saleDetails = invoices.map(inv => ({
        invoiceId: inv.id,
        invoiceNo: inv.invoiceNo,
        createdAt: inv.createdAt.toISOString(),
        customer: inv.customer || 'Розничный покупатель',
        paymentType: inv.paymentType,
        totalAmount: Number(inv.totalAmount),
        paidAmount: inv.payments.reduce((sum, p) => sum + Number(p.amount), 0),
        outstandingAmount: Math.max(0, Number(inv.totalAmount) - inv.payments.reduce((sum, p) => sum + Number(p.amount), 0)),
        itemCount: inv.items.length,
        soldUnits: inv.items.reduce((sum, i) => sum + Number(i.quantity), 0),
        items: inv.items.map(i => ({
            productId: i.productId,
            productName: i.productName,
            sku: i.batchNo || '-',
            quantity: Number(i.quantity),
            unitPrice: Number(i.unitPrice),
            lineTotal: Number(i.totalPrice)
        }))
    }));

    return {
      range: { preset, from: fromDate.toISOString(), to: toDate.toISOString() },
      kpi: {
        revenueGross,
        customerReturnsAmount,
        netRevenue,
        cogs,
        grossProfit,
        grossMarginPct,
        operatingProfit: grossProfit - (writeOffs.reduce((sum, w) => sum + (Number(w.quantity) * Number(w.batch?.costBasis || 0)), 0)),
        operatingMarginPct: netRevenue > 0 ? ((grossProfit - 0) / netRevenue) * 100 : 0,
        expenseTotal: 0,
        writeOffAmount: writeOffs.reduce((sum, w) => sum + (Number(w.quantity) * Number(w.batch?.costBasis || 0)), 0),
      },
      debts: {
        receivableTotal,
        payableTotal,
        arAging,
        apAging,
        netWorkingCapitalExposure: receivableTotal - payableTotal,
      },
      inventory: {
        costValue: inventoryCostValue,
        retailValue: inventoryRetailValue,
        unrealizedMargin: inventoryRetailValue - inventoryCostValue,
        details: Array.from(inventoryDetailMap.values()).sort((a, b) => b.retailValue - a.retailValue).slice(0, 50),
      },
      trend: Array.from(trendMap.values()),
      currentMonthSales: {
          from: fromDate.toISOString(),
          to: toDate.toISOString(),
          saleDetails
      }
    };
  }
}

export const reportService = new ReportService();
