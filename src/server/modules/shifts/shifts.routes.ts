import { Router } from 'express';
import { authenticate, type AuthedRequest } from '../../common/auth';
import { asyncHandler } from '../../common/http';
import { prisma } from '../../infrastructure/prisma';
import { auditService } from '../../services/audit.service';
import { NotFoundError, ValidationError } from '../../common/errors';

export const shiftsRouter = Router();

type ShiftWithReportData = {
  openingCash: number;
  invoices: Array<{
    totalAmount: number;
    paymentType?: string | null;
    status?: string | null;
    payments?: Array<{
      amount: number;
      direction?: 'IN' | 'OUT' | null;
      method?: string | null;
    }>;
    items: Array<{
      quantity: number;
      batch?: { costBasis: number | null } | null;
    }>;
    returns?: Array<{
      totalAmount: number | null;
      items: Array<{
        quantity: number;
        unitPrice: number | null;
        lineTotal: number | null;
        batch?: { costBasis: number | null } | null;
      }>;
    }>;
  }>;
  cashMovements: Array<{
    type: 'CASH_IN' | 'CASH_OUT';
    amount: number;
  }>;
};

const getInvoicePaidAmount = (invoice: ShiftWithReportData['invoices'][number]) => {
  const paid = (invoice.payments || [])
    .filter((payment) => payment.direction !== 'OUT' && (payment as any).status !== 'CANCELLED')
    .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);

  return Math.min(Number(invoice.totalAmount || 0), paid);
};

async function getOrCreateDefaultWarehouse(): Promise<string> {
  let wh = await prisma.warehouse.findFirst({ where: { isDefault: true } });
  if (!wh) {
    wh = await prisma.warehouse.create({ data: { code: 'MAIN', name: 'Main Warehouse', isDefault: true } });
  }
  return wh.id;
}

function calculateShiftSummary(shift: ShiftWithReportData) {
  const nonCancelledInvoices = shift.invoices.filter(inv => inv.status !== 'CANCELLED');

  const totalSales = nonCancelledInvoices.reduce((sum, inv) => sum + Number(inv.totalAmount || 0), 0);
  const returnedAmount = nonCancelledInvoices.reduce((sum, inv) => {
    return sum + (inv.returns || []).reduce((invoiceReturnSum, ret) => {
      const itemTotal = ret.items.reduce((itemSum, item) => {
        const lineTotal = Number(item.lineTotal || 0);
        if (lineTotal > 0) return itemSum + lineTotal;
        return itemSum + Number(item.quantity || 0) * Number(item.unitPrice || 0);
      }, 0);
      return invoiceReturnSum + Math.max(Number(ret.totalAmount || 0), itemTotal);
    }, 0);
  }, 0);

  const salesCogs = nonCancelledInvoices.reduce((sum, inv) => {
    return sum + inv.items.reduce((itemSum, item) => {
      return itemSum + Number(item.quantity || 0) * Number(item.batch?.costBasis || 0);
    }, 0);
  }, 0);

  const returnedCogs = nonCancelledInvoices.reduce((sum, inv) => {
    return sum + (inv.returns || []).reduce((invoiceReturnSum, ret) => {
      return invoiceReturnSum + ret.items.reduce((itemSum, item) => {
        return itemSum + Number(item.quantity || 0) * Number(item.batch?.costBasis || 0);
      }, 0);
    }, 0);
  }, 0);

  const netSales = totalSales - returnedAmount;
  const netCogs = Math.max(0, salesCogs - returnedCogs);
  const grossProfit = netSales - netCogs;

  const cashSales = nonCancelledInvoices.reduce((sum, inv) => {
    if (inv.status === 'RETURNED') return sum;
    const invoiceCash = (inv.payments || [])
      .filter((payment) => payment.direction !== 'OUT' && payment.method === 'CASH' && (payment as any).status !== 'CANCELLED')
      .reduce((paymentSum, payment) => paymentSum + Number(payment.amount || 0), 0);
    return sum + invoiceCash;
  }, 0);

  const cardSales = nonCancelledInvoices.reduce((sum, inv) => {
    if (inv.status === 'RETURNED') return sum;
    const invoiceCard = (inv.payments || [])
      .filter((payment) => payment.direction !== 'OUT' && payment.method === 'CARD' && (payment as any).status !== 'CANCELLED')
      .reduce((paymentSum, payment) => paymentSum + Number(payment.amount || 0), 0);
    return sum + invoiceCard;
  }, 0);

  const collectedSales = nonCancelledInvoices.reduce((sum, inv) => {
    if (inv.status === 'RETURNED') return sum;
    return sum + getInvoicePaidAmount(inv);
  }, 0);
  const cashIn = shift.cashMovements
    .filter((movement) => movement.type === 'CASH_IN')
    .reduce((sum, movement) => sum + Number(movement.amount || 0), 0);
  const cashOut = shift.cashMovements
    .filter((movement) => movement.type === 'CASH_OUT')
    .reduce((sum, movement) => sum + Number(movement.amount || 0), 0);
  const totalRefunds = shift.invoices.reduce((sum, inv) => {
    const invoiceRefunds = (inv.payments || [])
      .filter((payment) => payment.direction === 'OUT' && payment.method === 'CASH')
      .reduce((paymentSum, payment) => paymentSum + Number(payment.amount || 0), 0);
    return sum + invoiceRefunds;
  }, 0);

  const finalAmount = shift.openingCash + cashSales - totalRefunds + cashIn - cashOut;

  return {
    totalInvoices: shift.invoices.length,
    totalSales,
    collectedSales,
    returnedAmount,
    netSales,
    salesCogs,
    returnedCogs,
    netCogs,
    grossProfit,
    cashSales,
    cardSales,
    cashIn,
    cashOut,
    totalRefunds,
    finalAmount,
    netCash: finalAmount,
  };
}

// List recent shifts (with pagination)
shiftsRouter.get('/', authenticate, asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 25));

  const parseDate = (val: any) => {
    if (!val) return undefined;
    const d = new Date(String(val));
    return isNaN(d.getTime()) ? undefined : d;
  };

  const from = parseDate(req.query.from);
  const to = parseDate(req.query.to);

  const where: any = {};
  if (from || to) {
    where.openAt = {};
    if (from) where.openAt.gte = from;
    if (to) where.openAt.lte = to;
  }

  const [total, items] = await Promise.all([
    prisma.cashShift.count({ where }),
    prisma.cashShift.findMany({
      where,
      include: {
        cashier: { select: { name: true } },
        warehouse: { select: { name: true } },
        _count: { select: { invoices: true, cashMovements: true } },
      },
      orderBy: { openAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    })
  ]);

  res.json({
    items,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit)
    }
  });
}));

// Get my active shift
shiftsRouter.get('/active', authenticate, asyncHandler(async (req, res) => {
  const authedReq = req as AuthedRequest;
  const shift = await prisma.cashShift.findFirst({
    where: { cashierId: authedReq.user.id, status: 'OPEN' },
    include: {
      cashier: { select: { name: true } },
      warehouse: { select: { name: true } },
      cashMovements: true,
    },
  });
  res.json(shift ?? null);
}));

// Open a new shift
shiftsRouter.post('/open', authenticate, asyncHandler(async (req, res) => {
  const authedReq = req as AuthedRequest;
  const { openingCash, warehouseId: reqWarehouseId } = req.body ?? {};

  const existing = await prisma.cashShift.findFirst({
    where: { cashierId: authedReq.user.id, status: 'OPEN' },
  });
  if (existing) throw new ValidationError('A shift is already open for this cashier');

  const warehouseId = reqWarehouseId || (await getOrCreateDefaultWarehouse());

  const count = await prisma.cashShift.count();
  const shiftNo = `SHIFT-${String(count + 1).padStart(5, '0')}`;

  const shift = await prisma.cashShift.create({
    data: {
      shiftNo,
      warehouseId,
      cashierId: authedReq.user.id,
      status: 'OPEN',
      openingCash: Number(openingCash ?? 0),
    },
    include: {
      cashier: { select: { name: true } },
      warehouse: { select: { name: true } },
    },
  });

  await auditService.log({
    userId: authedReq.user.id,
    userRole: authedReq.user.role as any,
    module: 'shifts',
    action: 'OPEN_SHIFT',
    entity: 'CASH_SHIFT',
    entityId: shift.id,
    newValue: { shiftNo, openingCash: shift.openingCash },
  });

  res.status(201).json(shift);
}));

// Close a shift
shiftsRouter.post('/:id/close', authenticate, asyncHandler(async (req, res) => {
  const authedReq = req as AuthedRequest;
  const { closingCash, closeNote } = req.body ?? {};

  const shift = await prisma.cashShift.findUnique({
    where: { id: req.params.id },
    include: {
      invoices: {
        include: {
          returns: {
            where: { status: 'COMPLETED' },
            include: {
              items: {
                select: {
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
          },
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
          payments: {
            select: {
              amount: true,
              direction: true,
              method: true,
            },
          },
        },
      },
      cashMovements: true,
    },
  });
  if (!shift) throw new NotFoundError('Shift not found');
  if (shift.status !== 'OPEN') throw new ValidationError('Shift is not open');

  const summary = calculateShiftSummary(shift);
  const expectedCash = summary.finalAmount;
  const actual = Number(closingCash ?? 0);
  const discrepancy = actual - expectedCash;

  const closed = await prisma.cashShift.update({
    where: { id: shift.id },
    data: {
      status: 'CLOSED',
      closingCash: actual,
      expectedCash,
      discrepancy,
      closeAt: new Date(),
      closeNote: closeNote || null,
    },
    include: { cashier: { select: { name: true } } },
  });

  await auditService.log({
    userId: authedReq.user.id,
    userRole: authedReq.user.role as any,
    module: 'shifts',
    action: 'CLOSE_SHIFT',
    entity: 'CASH_SHIFT',
    entityId: shift.id,
    newValue: { closingCash: actual, expectedCash, discrepancy },
  });

  res.json({
    ...closed,
    summary: {
      ...summary,
      finalAmount: expectedCash,
    },
  });
}));

// Add cash movement to a shift
shiftsRouter.post('/:id/movements', authenticate, asyncHandler(async (req, res) => {
  const authedReq = req as AuthedRequest;
  const { type, amount, reason } = req.body ?? {};

  const typeVal = (type || '').toUpperCase();
  if (typeVal !== 'CASH_IN' && typeVal !== 'CASH_OUT') {
    throw new ValidationError('type must be CASH_IN or CASH_OUT');
  }
  const amountVal = Number(amount);
  if (!amountVal || amountVal <= 0) throw new ValidationError('amount must be a positive number');
  if (!reason) throw new ValidationError('reason is required');

  const shift = await prisma.cashShift.findUnique({ where: { id: req.params.id } });
  if (!shift) throw new NotFoundError('Shift not found');
  if (shift.status !== 'OPEN') throw new ValidationError('Shift is not open');

  const movement = await prisma.cashMovement.create({
    data: {
      shiftId: shift.id,
      userId: authedReq.user.id,
      type: typeVal as 'CASH_IN' | 'CASH_OUT',
      amount: amountVal,
      reason,
    },
  });

  res.status(201).json(movement);
}));

// X/Z report for a shift
shiftsRouter.get('/:id/report', authenticate, asyncHandler(async (req, res) => {
  const shift = await prisma.cashShift.findUnique({
    where: { id: req.params.id },
    include: {
      cashier: { select: { name: true } },
      warehouse: { select: { name: true } },
      invoices: {
        include: {
          returns: {
            where: { status: 'COMPLETED' },
            include: {
              items: {
                select: {
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
          },
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
          payments: {
            select: {
              amount: true,
              direction: true,
              method: true,
            },
          },
        },
      },
      cashMovements: true,
    },
  });
  if (!shift) throw new NotFoundError('Shift not found');

  const summary = calculateShiftSummary(shift);

  res.json({
    shift: {
      id: shift.id,
      shiftNo: shift.shiftNo,
      cashier: shift.cashier.name,
      warehouse: shift.warehouse.name,
      status: shift.status,
      openAt: shift.openAt,
      closeAt: shift.closeAt,
      openingCash: shift.openingCash,
      closingCash: shift.closingCash,
      expectedCash: shift.expectedCash,
      discrepancy: shift.discrepancy,
    },
    summary: {
      ...summary,
    },
    invoices: shift.invoices,
    cashMovements: shift.cashMovements,
  });
}));
