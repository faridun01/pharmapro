import { Router } from 'express';
import { authenticate, type AuthedRequest } from '../../common/auth';
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
  const authedReq = req as AuthedRequest;
  const { items, ...data } = req.body ?? {};

  if (!items || !Array.isArray(items) || items.length === 0) {
    throw new ValidationError('items array is required');
  }

  const typeVal = (data.type || '').toUpperCase();
  if (typeVal !== 'CUSTOMER' && typeVal !== 'SUPPLIER') {
    throw new ValidationError('type must be CUSTOMER or SUPPLIER');
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
      unitPrice: item.unitPrice ? Number(item.unitPrice) : null,
      reason: item.reason || null,
    })),
    userId: authedReq.user.id,
    userRole: authedReq.user.role,
  });

  res.status(201).json(created);
}));

returnsRouter.put('/:id/approve', authenticate, asyncHandler(async (req, res) => {
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

returnsRouter.put('/:id/reject', authenticate, asyncHandler(async (req, res) => {
  const authedReq = req as AuthedRequest;

  const ret = await prisma.return.findUnique({ where: { id: req.params.id }, select: { id: true, status: true } });
  if (!ret) throw new NotFoundError('Return not found');
  if (ret.status !== 'DRAFT') {
    throw new ValidationError(`Return is already ${ret.status.toLowerCase()}`);
  }

  const updated = await returnsService.rejectReturn(ret.id, authedReq.user.id, authedReq.user.role);
  res.json(updated);
}));
