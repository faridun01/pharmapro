import { Router } from 'express';
import { authenticate, requireRole, type AuthedRequest } from '../../common/auth';
import { asyncHandler } from '../../common/http';
import { prisma } from '../../infrastructure/prisma';
import { NotFoundError, ValidationError } from '../../common/errors';
import { returnsService } from './returns.service';

export const returnsRouter = Router();

returnsRouter.get('/', authenticate, asyncHandler(async (_req, res) => {
  const returns = await prisma.return.findMany({
    include: {
      items: { include: { product: true, batch: true } },
      createdBy: { select: { name: true } },
      approvedBy: { select: { name: true } },
      invoice: { select: { invoiceNo: true } },
      supplier: { select: { name: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
  res.json(returns);
}));

returnsRouter.post('/', authenticate, asyncHandler(async (req, res) => {

  // Debug logging for incoming return creation requests
  const authedReq = req as AuthedRequest;
  console.log('POST /api/returns body:', JSON.stringify(req.body, null, 2));
  console.log('Authenticated user:', authedReq.user);
  const { items, ...data } = req.body ?? {};

  // Robust validation
  if (!items || !Array.isArray(items) || items.length === 0) {
    console.error('Validation error: items array is required');
    throw new ValidationError('Не выбраны позиции для возврата (items array is required)');
  }

  const typeVal = (data.type || '').toUpperCase();
  if (typeVal !== 'CUSTOMER' && typeVal !== 'SUPPLIER') {
    console.error('Validation error: type must be CUSTOMER or SUPPLIER');
    throw new ValidationError('Тип возврата должен быть CUSTOMER или SUPPLIER');
  }

  // Validate each item
  for (const [idx, item] of items.entries()) {
    if (!item.productId || typeof item.productId !== 'string') {
      console.error(`Validation error: productId is required for item ${idx}`);
      throw new ValidationError(`Позиция №${idx + 1}: не выбран товар (productId is required)`);
    }
    if (!item.quantity || isNaN(Number(item.quantity)) || Number(item.quantity) <= 0) {
      console.error(`Validation error: quantity must be > 0 for item ${idx}`);
      throw new ValidationError(`Позиция №${idx + 1}: количество должно быть больше 0 (quantity > 0)`);
    }
    // unitPrice can be 0, so check for undefined/null only
    if (item.unitPrice === undefined || item.unitPrice === null || isNaN(Number(item.unitPrice))) {
      console.error(`Validation error: unitPrice is required for item ${idx}`);
      throw new ValidationError(`Позиция №${idx + 1}: не указана цена (unitPrice)`);
    }
  }

  const created = await returnsService.createReturn({
    type: typeVal as 'CUSTOMER' | 'SUPPLIER',
    invoiceId: data.invoiceId || null,
    supplierId: data.supplierId || null,
    customerName: data.customerName || null,
    refundMethod: data.refundMethod || null,
    reason: data.reason || null,
    note: data.note || null,
    items: items.map((item: any) => ({
      productId: item.productId,
      batchId: item.batchId || null,
      quantity: Number(item.quantity),
      unitPrice: Number(item.unitPrice),
      reason: item.reason || null,
    })),
    userId: authedReq.user.id,
    userRole: authedReq.user.role,
  });

  res.status(201).json(created);
}));

// PUT /:id/approve — PHARMACIST, ADMIN, OWNER
returnsRouter.put('/:id/approve', authenticate, requireRole(['PHARMACIST', 'ADMIN', 'OWNER']), asyncHandler(async (req, res) => {
  const authedReq = req as AuthedRequest;

  const ret = await prisma.return.findUnique({
    where: { id: req.params.id },
    select: { id: true, status: true },
  });
  if (!ret) throw new NotFoundError('Return not found');
  if (ret.status !== 'DRAFT') {
    throw new ValidationError(`Return is already ${ret.status.toLowerCase()}`);
  }

  const updated = await returnsService.approveReturn(ret.id, authedReq.user.id, authedReq.user.role);
  res.json(updated);
}));

// PUT /:id/reject — PHARMACIST, ADMIN, OWNER
returnsRouter.put('/:id/reject', authenticate, requireRole(['PHARMACIST', 'ADMIN', 'OWNER']), asyncHandler(async (req, res) => {
  const authedReq = req as AuthedRequest;

  const ret = await prisma.return.findUnique({ where: { id: req.params.id }, select: { id: true, status: true } });
  if (!ret) throw new NotFoundError('Return not found');
  if (ret.status !== 'DRAFT') {
    throw new ValidationError(`Return is already ${ret.status.toLowerCase()}`);
  }

  const updated = await returnsService.rejectReturn(ret.id, authedReq.user.id, authedReq.user.role);
  res.json(updated);
}));
