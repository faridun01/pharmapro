import { Router } from 'express';
import { authenticate, type AuthedRequest } from '../../common/auth';
import { asyncHandler } from '../../common/http';
import { prisma } from '../../infrastructure/prisma';
import { auditService } from '../../services/audit.service';

export const suppliersRouter = Router();

// Получить все партии по поставщику
suppliersRouter.get('/:id/batches', authenticate, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const batches = await prisma.batch.findMany({
    where: { supplierId: id },
    include: {
      product: { select: { name: true, sku: true } },
    },
    orderBy: { expiryDate: 'asc' },
  });
  // Формируем ответ: продукт, партия, количество, срок годности
  const result = batches.map(b => ({
    batchNumber: b.batchNumber,
    productName: b.product?.name,
    productSku: b.product?.sku,
    quantity: b.quantity,
    expiryDate: b.expiryDate,
  }));
  res.json({
    count: result.length,
    nearestExpiry: result.length > 0 ? result[0].expiryDate : null,
    batches: result,
  });

}));
// Получить сводку по поставщику: партии, оплаты, долги
suppliersRouter.get('/:id/summary', authenticate, asyncHandler(async (req, res) => {
  const { id } = req.params;

  // Получаем все приходы (PurchaseInvoice) этого поставщика
  const purchaseInvoices = await prisma.purchaseInvoice.findMany({
    where: { supplierId: id },
    orderBy: { invoiceDate: 'desc' },
    include: {
      payments: true,
      payables: true,
    },
  });

  // Считаем по каждой партии: оплачено, долг
  const invoiceSummaries = purchaseInvoices.map(inv => {
    const paid = inv.payments.reduce((sum, p) => sum + (p.amount || 0), 0);
    const payable = inv.payables.length > 0 ? inv.payables[0] : null;
    return {
      id: inv.id,
      invoiceNumber: inv.invoiceNumber,
      invoiceDate: inv.invoiceDate,
      totalAmount: inv.totalAmount,
      paidAmount: paid,
      debtAmount: payable ? payable.remainingAmount : (inv.totalAmount - paid),
      status: inv.status,
      paymentStatus: inv.paymentStatus,
    };
  });

  // Общий долг и оплата по поставщику
  const allPayables = await prisma.payable.findMany({ where: { supplierId: id } });
  const allPayments = await prisma.payment.findMany({ where: { supplierId: id } });
  const totalDebt = allPayables.reduce((sum, p) => sum + (p.remainingAmount || 0), 0);
  const totalPaid = allPayments.reduce((sum, p) => sum + (p.amount || 0), 0);

  res.json({
    invoices: invoiceSummaries,
    totalDebt,
    totalPaid,
  });
}));

suppliersRouter.get('/', authenticate, asyncHandler(async (_req, res) => {
  const suppliers = await prisma.supplier.findMany({
    where: { isActive: true },
    orderBy: { createdAt: 'desc' },
  });
  res.json(suppliers);
}));

suppliersRouter.post('/', authenticate, asyncHandler(async (req, res) => {
  const authedReq = req as AuthedRequest;
  const created = await prisma.supplier.create({ data: req.body });

  await auditService.log({
    userId: authedReq.user.id,
    userRole: authedReq.user.role as any,
    module: 'suppliers',
    action: 'CREATE_SUPPLIER',
    entity: 'SUPPLIER',
    entityId: created.id,
    newValue: req.body,
  });

  res.status(201).json(created);
}));

suppliersRouter.put('/:id', authenticate, asyncHandler(async (req, res) => {
  const authedReq = req as AuthedRequest;
  const { id } = req.params;

  const existing = await prisma.supplier.findUnique({ where: { id } });
  if (!existing || !existing.isActive) {
    return res.status(404).json({ error: 'Supplier not found' });
  }

  const updated = await prisma.supplier.update({
    where: { id },
    data: {
      name: req.body?.name ?? existing.name,
      contact: req.body?.contact ?? null,
      email: req.body?.email ?? null,
      address: req.body?.address ?? null,
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

suppliersRouter.delete('/:id', authenticate, asyncHandler(async (req, res) => {
  const authedReq = req as AuthedRequest;
  const { id } = req.params;

  const existing = await prisma.supplier.findUnique({ where: { id } });
  if (!existing || !existing.isActive) {
    return res.status(404).json({ error: 'Supplier not found' });
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
