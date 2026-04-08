import { Router } from 'express';
import { authenticate, type AuthedRequest } from '../../common/auth';
import { ValidationError } from '../../common/errors';
import { asyncHandler } from '../../common/http';
import { prisma } from '../../infrastructure/prisma';
import { auditService } from '../../services/audit.service';

export const customersRouter = Router();

const buildNextCustomerCode = async () => {
  const customersWithCodes = await prisma.customer.findMany({
    where: {
      code: {
        not: null,
      },
    },
    select: { code: true },
  });

  const maxNumber = customersWithCodes.reduce((currentMax, customer) => {
    const nextNumber = Number(String(customer.code || '').match(/(\d+)$/)?.[1] || 0);
    return Math.max(currentMax, nextNumber);
  }, 0);

  return `CUST-${String(maxNumber + 1).padStart(4, '0')}`;
};

customersRouter.get('/', authenticate, asyncHandler(async (_req, res) => {
  const customers = await prisma.customer.findMany({
    where: { isActive: true },
    orderBy: { name: 'asc' },
  });

  if (customers.length === 0) {
    return res.json([]);
  }

  const customerIds = customers.map((customer) => customer.id);
  const now = new Date();

  const [invoiceStats, paymentStats, receivableStats, invoices, payments, receivables] = await Promise.all([
    prisma.invoice.groupBy({
      by: ['customerId'],
      where: { customerId: { in: customerIds } },
      _sum: { totalAmount: true },
      _count: { _all: true },
      _max: { createdAt: true },
    }),
    prisma.payment.groupBy({
      by: ['customerId'],
      where: {
        customerId: { in: customerIds },
        status: 'PAID',
      },
      _sum: { amount: true },
      _max: { paymentDate: true },
    }),
    prisma.receivable.groupBy({
      by: ['customerId'],
      where: { customerId: { in: customerIds } },
      _sum: { remainingAmount: true },
      _max: { dueDate: true },
    }),
    prisma.invoice.findMany({
      where: { customerId: { in: customerIds } },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        invoiceNo: true,
        customerId: true,
        createdAt: true,
        totalAmount: true,
        paymentStatus: true,
        status: true,
        items: {
          select: { id: true },
        },
        receivables: {
          select: {
            remainingAmount: true,
          },
        },
      },
    }),
    prisma.payment.findMany({
      where: {
        customerId: { in: customerIds },
        status: 'PAID',
      },
      orderBy: { paymentDate: 'desc' },
      select: {
        id: true,
        customerId: true,
        amount: true,
        paymentDate: true,
        method: true,
        comment: true,
        invoice: {
          select: { invoiceNo: true },
        },
      },
    }),
    prisma.receivable.findMany({
      where: {
        customerId: { in: customerIds },
      },
      orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        customerId: true,
        remainingAmount: true,
        dueDate: true,
        status: true,
        createdAt: true,
        invoice: {
          select: { invoiceNo: true },
        },
      },
    }),
  ]);

  const invoiceMap = new Map(invoiceStats.map((item) => [item.customerId, item]));
  const paymentMap = new Map(paymentStats.map((item) => [item.customerId, item]));
  const receivableMap = new Map(receivableStats.map((item) => [item.customerId, item]));

  const invoiceHistoryMap = new Map<string, Array<{
    id: string;
    invoiceNo: string;
    createdAt: string;
    totalAmount: number;
    paymentStatus?: string | null;
    status: string;
    outstandingAmount: number;
    itemCount: number;
  }>>();

  for (const invoice of invoices) {
    if (!invoice.customerId) continue;
    const bucket = invoiceHistoryMap.get(invoice.customerId) || [];
    if (bucket.length >= 8) continue;
    bucket.push({
      id: invoice.id,
      invoiceNo: invoice.invoiceNo,
      createdAt: invoice.createdAt.toISOString(),
      totalAmount: Number(invoice.totalAmount || 0),
      paymentStatus: invoice.paymentStatus,
      status: invoice.status,
      outstandingAmount: Number(invoice.receivables[0]?.remainingAmount || 0),
      itemCount: invoice.items.length,
    });
    invoiceHistoryMap.set(invoice.customerId, bucket);
  }

  const paymentHistoryMap = new Map<string, Array<{
    id: string;
    amount: number;
    paymentDate: string;
    method: string;
    invoiceNo?: string | null;
    comment?: string | null;
  }>>();

  for (const payment of payments) {
    if (!payment.customerId) continue;
    const bucket = paymentHistoryMap.get(payment.customerId) || [];
    if (bucket.length >= 8) continue;
    bucket.push({
      id: payment.id,
      amount: Number(payment.amount || 0),
      paymentDate: payment.paymentDate.toISOString(),
      method: payment.method,
      invoiceNo: payment.invoice?.invoiceNo || null,
      comment: payment.comment || null,
    });
    paymentHistoryMap.set(payment.customerId, bucket);
  }

  const receivableHistoryMap = new Map<string, Array<{
    id: string;
    invoiceNo?: string | null;
    remainingAmount: number;
    dueDate?: string | null;
    status: string;
    createdAt: string;
  }>>();
  const overdueDebtMap = new Map<string, number>();

  for (const receivable of receivables) {
    const bucket = receivableHistoryMap.get(receivable.customerId) || [];
    if (Number(receivable.remainingAmount || 0) > 0 && bucket.length < 8) {
      bucket.push({
        id: receivable.id,
        invoiceNo: receivable.invoice?.invoiceNo || null,
        remainingAmount: Number(receivable.remainingAmount || 0),
        dueDate: receivable.dueDate?.toISOString() || null,
        status: receivable.status,
        createdAt: receivable.createdAt.toISOString(),
      });
      receivableHistoryMap.set(receivable.customerId, bucket);
    }

    const isOverdue = receivable.dueDate && receivable.dueDate.getTime() < now.getTime() && Number(receivable.remainingAmount || 0) > 0;
    if (isOverdue) {
      overdueDebtMap.set(receivable.customerId, Number(overdueDebtMap.get(receivable.customerId) || 0) + Number(receivable.remainingAmount || 0));
    }
  }

  const enrichedCustomers = customers.map((customer) => {
    const invoice = invoiceMap.get(customer.id);
    const payment = paymentMap.get(customer.id);
    const receivable = receivableMap.get(customer.id);

    return {
      ...customer,
      summary: {
        totalPurchased: Number(invoice?._sum.totalAmount || 0),
        totalPaid: Number(payment?._sum.amount || 0),
        totalDebt: Number(receivable?._sum.remainingAmount || 0),
        overdueDebt: Number(overdueDebtMap.get(customer.id) || 0),
        invoiceCount: Number(invoice?._count._all || 0),
        lastInvoiceAt: invoice?._max.createdAt?.toISOString() || null,
        lastPaymentAt: payment?._max.paymentDate?.toISOString() || null,
        nextDueDate: receivable?._max.dueDate?.toISOString() || null,
      },
      history: {
        recentInvoices: invoiceHistoryMap.get(customer.id) || [],
        recentPayments: paymentHistoryMap.get(customer.id) || [],
        openReceivables: receivableHistoryMap.get(customer.id) || [],
      },
    };
  });

  res.json(enrichedCustomers);
}));

customersRouter.post('/', authenticate, asyncHandler(async (req, res) => {
  const authedReq = req as AuthedRequest;
  const data = req.body ?? {};

  const name = String(data.name || '').trim();
  if (!name) {
    throw new ValidationError('Customer name is required');
  }

  const requestedCode = data.code ? String(data.code).trim() : '';
  const generatedCode = await buildNextCustomerCode();

  const created = await prisma.customer.create({
    data: {
      name,
      code: requestedCode || generatedCode,
      legalName: data.legalName ? String(data.legalName).trim() : null,
      taxId: data.taxId ? String(data.taxId).trim() : null,
      phone: data.phone ? String(data.phone).trim() : null,
      email: data.email ? String(data.email).trim() : null,
      address: data.address ? String(data.address).trim() : null,
      managerName: data.managerName ? String(data.managerName).trim() : null,
      creditLimit: Number(data.creditLimit ?? 0) || 0,
      defaultDiscount: Number(data.defaultDiscount ?? 0) || 0,
      paymentTermDays: data.paymentTermDays === null || data.paymentTermDays === '' ? null : Number(data.paymentTermDays ?? 0),
      isActive: true,
    },
  });

  await auditService.log({
    userId: authedReq.user.id,
    userRole: authedReq.user.role as any,
    module: 'customers',
    action: 'CREATE_CUSTOMER',
    entity: 'CUSTOMER',
    entityId: created.id,
    newValue: created,
  });

  res.status(201).json(created);
}));

customersRouter.put('/:id', authenticate, asyncHandler(async (req, res) => {
  const authedReq = req as AuthedRequest;
  const { id } = req.params;
  const data = req.body ?? {};

  const existing = await prisma.customer.findUnique({ where: { id } });
  if (!existing || !existing.isActive) {
    return res.status(404).json({ error: 'Customer not found' });
  }

  const nextName = data.name !== undefined ? String(data.name).trim() : existing.name;
  if (!nextName) {
    throw new ValidationError('Customer name is required');
  }

  const updated = await prisma.customer.update({
    where: { id },
    data: {
      name: nextName,
      code: data.code !== undefined ? (data.code ? String(data.code).trim() : null) : existing.code,
      legalName: data.legalName !== undefined ? (data.legalName ? String(data.legalName).trim() : null) : existing.legalName,
      taxId: data.taxId !== undefined ? (data.taxId ? String(data.taxId).trim() : null) : existing.taxId,
      phone: data.phone !== undefined ? (data.phone ? String(data.phone).trim() : null) : existing.phone,
      email: data.email !== undefined ? (data.email ? String(data.email).trim() : null) : existing.email,
      address: data.address !== undefined ? (data.address ? String(data.address).trim() : null) : existing.address,
      managerName: data.managerName !== undefined ? (data.managerName ? String(data.managerName).trim() : null) : existing.managerName,
      creditLimit: data.creditLimit !== undefined ? Number(data.creditLimit ?? 0) || 0 : existing.creditLimit,
      defaultDiscount: data.defaultDiscount !== undefined ? Number(data.defaultDiscount ?? 0) || 0 : existing.defaultDiscount,
      paymentTermDays: data.paymentTermDays !== undefined
        ? (data.paymentTermDays === null || data.paymentTermDays === '' ? null : Number(data.paymentTermDays ?? 0))
        : existing.paymentTermDays,
    },
  });

  await auditService.log({
    userId: authedReq.user.id,
    userRole: authedReq.user.role as any,
    module: 'customers',
    action: 'UPDATE_CUSTOMER',
    entity: 'CUSTOMER',
    entityId: updated.id,
    oldValue: existing,
    newValue: updated,
  });

  res.json(updated);
}));

customersRouter.delete('/:id', authenticate, asyncHandler(async (req, res) => {
  const authedReq = req as AuthedRequest;
  const { id } = req.params;

  const existing = await prisma.customer.findUnique({ where: { id } });
  if (!existing || !existing.isActive) {
    return res.status(404).json({ error: 'Customer not found' });
  }

  await prisma.customer.update({
    where: { id },
    data: { isActive: false },
  });

  await auditService.log({
    userId: authedReq.user.id,
    userRole: authedReq.user.role as any,
    module: 'customers',
    action: 'DELETE_CUSTOMER',
    entity: 'CUSTOMER',
    entityId: id,
    oldValue: existing,
    newValue: { isActive: false },
  });

  res.status(204).send();
}));
