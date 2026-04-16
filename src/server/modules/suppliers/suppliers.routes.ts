import { Router } from 'express';
import { authenticate, requireRole, type AuthedRequest } from '../../common/auth';
import { asyncHandler } from '../../common/http';
import { prisma } from '../../infrastructure/prisma';
import { auditService } from '../../services/audit.service';
import { NotFoundError, ValidationError } from '../../common/errors';
import { reportCache } from '../../common/cache';

export const suppliersRouter = Router();

const normalizeNullable = (value: unknown) => {
  const normalized = String(value ?? '').trim();
  return normalized ? normalized : null;
};

const resolvePurchasePaymentStatus = (totalAmount: number, paidAmount: number) => {
  if (paidAmount <= 0) return 'UNPAID' as const;
  if (paidAmount >= totalAmount) return 'PAID' as const;
  return 'PARTIALLY_PAID' as const;
};

const getSupplierOverview = async (supplierId: string) => {
  const [purchaseInvoices, batches, allPayables, allPayments] = await Promise.all([
    prisma.purchaseInvoice.findMany({
      where: { supplierId },
      orderBy: [{ invoiceDate: 'desc' }],
      include: {
        payments: true,
        payables: true,
        items: {
          select: {
            quantity: true,
            lineTotal: true,
            purchasePrice: true,
            product: { select: { name: true, sku: true } }
          },
        },
      },
    }),
    prisma.batch.findMany({
      where: {
        supplierId,
        quantity: { gt: 0 },
      },
      include: {
        product: { select: { name: true, sku: true } },
      },
      orderBy: [{ expiryDate: 'asc' }, { createdAt: 'desc' }],
    }),
    prisma.payable.findMany({
      where: { supplierId },
      orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
    }),
    prisma.payment.findMany({
      where: { supplierId },
      orderBy: [{ paymentDate: 'desc' }],
    }),
  ]);

  const invoiceSummaries = purchaseInvoices.map((inv) => {
    const invoice = inv as any;
    const paidAmount = invoice.payments.reduce((sum: number, payment: any) => sum + Number(payment.amount || 0), 0);
    const payable = invoice.payables[0] || null;
    const debtAmount = payable
      ? Math.max(0, Number(payable.remainingAmount || 0))
      : Math.max(0, Number(invoice.totalAmount || 0) - paidAmount);
    const itemCount = invoice.items.reduce((sum: number, item: any) => sum + Number(item.quantity || 0), 0);

    return {
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      invoiceDate: invoice.invoiceDate,
      totalAmount: Number(invoice.totalAmount || 0),
      paidAmount,
      debtAmount,
      itemCount,
      status: invoice.status,
      paymentStatus: invoice.paymentStatus,
      // Add items for drill-down details
      items: invoice.items?.map((item: any) => ({
        productName: item.product?.name || 'Товар',
        sku: item.product?.sku || '',
        quantity: Number(item.quantity || 0),
        unitCost: Number(item.purchasePrice || 0),
        lineTotal: Number(item.lineTotal || 0)
      })) || []
    };
  });

  const batchList = batches.map((batch) => ({
    id: batch.id,
    batchNumber: batch.batchNumber,
    productName: batch.product?.name || 'Товар',
    productSku: batch.product?.sku || '—',
    quantity: Number(batch.quantity || 0),
    expiryDate: batch.expiryDate,
    costBasis: Number(batch.costBasis || 0),
  }));

  const totalDebt = allPayables.reduce((sum, payable) => sum + Number(payable.remainingAmount || 0), 0);
  const totalPaid = allPayments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  const totalAmount = purchaseInvoices.reduce((sum, invoice) => sum + Number(invoice.totalAmount || 0), 0);
  const overdueDebt = allPayables.reduce((sum, payable) => {
    if (!payable.dueDate) return sum;
    return payable.dueDate.getTime() < Date.now() ? sum + Number(payable.remainingAmount || 0) : sum;
  }, 0);

  return {
    invoices: invoiceSummaries,
    batchList,
    payments: allPayments.map((payment) => ({
      id: payment.id,
      amount: Number(payment.amount || 0),
      method: payment.method,
      paymentDate: payment.paymentDate,
      comment: payment.comment,
      purchaseInvoiceId: payment.purchaseInvoiceId,
    })),
    summary: {
      invoiceCount: purchaseInvoices.length,
      batchCount: batchList.length,
      totalAmount,
      totalDebt,
      overdueDebt,
      totalPaid,
      lastInvoiceDate: purchaseInvoices[0]?.invoiceDate || null,
      nearestExpiry: batchList[0]?.expiryDate || null,
    },
  };
};

suppliersRouter.get('/', authenticate, asyncHandler(async (_req, res) => {
  const suppliers = await prisma.supplier.findMany({
    where: { isActive: true },
    orderBy: [{ name: 'asc' }],
  });
  res.json(suppliers);
}));

suppliersRouter.get('/full', authenticate, asyncHandler(async (_req, res) => {
  const suppliers = await prisma.supplier.findMany({
    where: { isActive: true },
    orderBy: [{ name: 'asc' }],
  });

  const fullData = await Promise.all(suppliers.map(async (supplier) => {
    const overview = await getSupplierOverview(supplier.id);
    return {
      ...supplier,
      summary: overview.summary,
    };
  }));

  res.json(fullData);
}));

suppliersRouter.get('/:id/batches', authenticate, asyncHandler(async (req, res) => {
  const supplierId = req.params.id;
  const supplier = await prisma.supplier.findUnique({
    where: { id: supplierId },
    select: { id: true, isActive: true },
  });

  if (!supplier || !supplier.isActive) {
    throw new NotFoundError('Supplier not found');
  }

  const overview = await getSupplierOverview(supplierId);
  res.json({
    count: overview.batchList.length,
    nearestExpiry: overview.summary.nearestExpiry,
    batches: overview.batchList,
  });
}));

suppliersRouter.get('/:id/summary', authenticate, asyncHandler(async (req, res) => {
  const supplierId = req.params.id;
  const supplier = await prisma.supplier.findUnique({
    where: { id: supplierId },
  });

  if (!supplier || !supplier.isActive) {
    throw new NotFoundError('Supplier not found');
  }

  const overview = await getSupplierOverview(supplierId);
  res.json({
    supplier,
    ...overview,
  });
}));

// POST /invoices/:id/payments — ADMIN, OWNER
suppliersRouter.post('/invoices/:id/payments', authenticate, requireRole(['ADMIN', 'OWNER']), asyncHandler(async (req, res) => {
  const authedReq = req as AuthedRequest;
  const purchaseInvoiceId = req.params.id;
  const amount = Number(req.body?.amount || 0);
  const method = String(req.body?.method || 'CASH').toUpperCase();
  const comment = normalizeNullable(req.body?.comment);

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new ValidationError('Payment amount must be greater than 0');
  }

  if (!['CASH', 'CARD', 'BANK_TRANSFER'].includes(method)) {
    throw new ValidationError('Unsupported payment method');
  }

  const result = await prisma.$transaction(async (tx) => {
    const invoice = await tx.purchaseInvoice.findUnique({
      where: { id: purchaseInvoiceId },
      include: {
        supplier: true,
        payments: true,
        payables: true,
      },
    });

    if (!invoice) {
      throw new NotFoundError('Purchase invoice not found');
    }

    const paidBefore = invoice.payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
    const payable = invoice.payables[0] || null;
    const remainingBefore = payable
      ? Math.max(0, Number(payable.remainingAmount || 0))
      : Math.max(0, Number(invoice.totalAmount || 0) - paidBefore);

    if (amount > remainingBefore + 0.0001) {
      throw new ValidationError('Payment exceeds outstanding supplier debt');
    }

    const payment = await tx.payment.create({
      data: {
        direction: 'OUT',
        counterpartyType: 'SUPPLIER',
        supplierId: invoice.supplierId,
        purchaseInvoiceId: invoice.id,
        method: method as 'CASH' | 'CARD' | 'BANK_TRANSFER',
        amount,
        paymentDate: new Date(),
        status: 'PAID',
        createdById: authedReq.user.id,
        comment: comment || `Supplier payment for invoice ${invoice.invoiceNumber}`,
      },
    });

    const paidAfter = paidBefore + amount;
    const remainingAfter = Math.max(0, remainingBefore - amount);

    if (payable) {
      await tx.payable.update({
        where: { id: payable.id },
        data: {
          paidAmount: Math.min(Number(payable.originalAmount || 0), Number(payable.paidAmount || 0) + amount),
          remainingAmount: remainingAfter,
          status: remainingAfter <= 0 ? 'PAID' : paidAfter > 0 ? 'PARTIAL' : 'OPEN',
        },
      });
    } else if (remainingAfter > 0) {
      await tx.payable.create({
        data: {
          supplierId: invoice.supplierId,
          purchaseInvoiceId: invoice.id,
          originalAmount: Number(invoice.totalAmount || 0),
          paidAmount: paidAfter,
          remainingAmount: remainingAfter,
          status: paidAfter > 0 ? 'PARTIAL' : 'OPEN',
        },
      });
    }

    await tx.purchaseInvoice.update({
      where: { id: invoice.id },
      data: {
        paymentStatus: resolvePurchasePaymentStatus(Number(invoice.totalAmount || 0), paidAfter),
      },
    });

    await auditService.log({
      userId: authedReq.user.id,
      userRole: authedReq.user.role as any,
      module: 'suppliers',
      action: 'SUPPLIER_PAYMENT',
      entity: 'PURCHASE_INVOICE',
      entityId: invoice.id,
      newValue: {
        invoiceNumber: invoice.invoiceNumber,
        supplierId: invoice.supplierId,
        amount,
        method,
        remainingAfter,
      },
    }, tx);

    return { payment, remainingAfter };
  });

  reportCache.invalidatePattern(/^metrics:/);
  reportCache.invalidatePattern(/^report:/);

  res.status(201).json(result);
}));

// POST / — ADMIN, OWNER
suppliersRouter.post('/', authenticate, requireRole(['ADMIN', 'OWNER']), asyncHandler(async (req, res) => {
  const authedReq = req as AuthedRequest;
  const name = String(req.body?.name || '').trim();

  if (!name) {
    throw new ValidationError('Supplier name is required');
  }

  const created = await prisma.supplier.create({
    data: {
      name,
      contact: normalizeNullable(req.body?.contact),
      email: normalizeNullable(req.body?.email),
      address: normalizeNullable(req.body?.address),
    },
  });

  await auditService.log({
    userId: authedReq.user.id,
    userRole: authedReq.user.role as any,
    module: 'suppliers',
    action: 'CREATE_SUPPLIER',
    entity: 'SUPPLIER',
    entityId: created.id,
    newValue: {
      name: created.name,
      contact: created.contact,
      email: created.email,
      address: created.address,
    },
  });

  res.status(201).json(created);
}));

// PUT /:id — ADMIN, OWNER
suppliersRouter.put('/:id', authenticate, requireRole(['ADMIN', 'OWNER']), asyncHandler(async (req, res) => {
  const authedReq = req as AuthedRequest;
  const { id } = req.params;

  const existing = await prisma.supplier.findUnique({ where: { id } });
  if (!existing || !existing.isActive) {
    throw new NotFoundError('Supplier not found');
  }

  const name = String(req.body?.name ?? existing.name).trim();
  if (!name) {
    throw new ValidationError('Supplier name is required');
  }

  const updated = await prisma.supplier.update({
    where: { id },
    data: {
      name,
      contact: normalizeNullable(req.body?.contact),
      email: normalizeNullable(req.body?.email),
      address: normalizeNullable(req.body?.address),
    },
  });

  await auditService.log({
    userId: authedReq.user.id,
    userRole: authedReq.user.role as any,
    module: 'suppliers',
    action: 'UPDATE_SUPPLIER',
    entity: 'SUPPLIER',
    entityId: updated.id,
    oldValue: {
      name: existing.name,
      contact: existing.contact,
      email: existing.email,
      address: existing.address,
    },
    newValue: {
      name: updated.name,
      contact: updated.contact,
      email: updated.email,
      address: updated.address,
    },
  });

  res.json(updated);
}));

// DELETE /:id — ADMIN, OWNER
suppliersRouter.delete('/:id', authenticate, requireRole(['ADMIN', 'OWNER']), asyncHandler(async (req, res) => {
  const authedReq = req as AuthedRequest;
  const { id } = req.params;

  const existing = await prisma.supplier.findUnique({ where: { id } });
  if (!existing || !existing.isActive) {
    throw new NotFoundError('Supplier not found');
  }

  await prisma.supplier.update({
    where: { id },
    data: { isActive: false },
  });

  await auditService.log({
    userId: authedReq.user.id,
    userRole: authedReq.user.role as any,
    module: 'suppliers',
    action: 'DELETE_SUPPLIER',
    entity: 'SUPPLIER',
    entityId: id,
    oldValue: {
      name: existing.name,
      contact: existing.contact,
      email: existing.email,
      address: existing.address,
      isActive: true,
    },
    newValue: { isActive: false },
  });

  res.status(204).send();
}));
