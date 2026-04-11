import { Router } from 'express';
import { authenticate, type AuthedRequest } from '../../common/auth';
import { asyncHandler } from '../../common/http';
import { prisma } from '../../infrastructure/prisma';
import { ValidationError } from '../../common/errors';
import { writeOffService } from './writeoff.service';

export const writeoffRouter = Router();

const VALID_REASONS = ['EXPIRED', 'DAMAGED', 'LOST', 'INTERNAL_USE', 'MISMATCH', 'BROKEN_PACKAGING', 'OTHER'] as const;
type WriteOffReasonStr = (typeof VALID_REASONS)[number];

writeoffRouter.get('/', authenticate, asyncHandler(async (_req, res) => {
  const writeOffs = await prisma.writeOff.findMany({
    include: {
      items: { include: { product: true, batch: true } },
      createdBy: { select: { name: true } },
      warehouse: { select: { name: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
  res.json(writeOffs);
}));

writeoffRouter.post('/', authenticate, asyncHandler(async (req, res) => {
  const authedReq = req as AuthedRequest;
  const { items, ...data } = req.body ?? {};

  if (!items || !Array.isArray(items) || items.length === 0) {
    throw new ValidationError('items array is required');
  }

  const reason = (data.reason || 'OTHER').toUpperCase() as WriteOffReasonStr;
  if (!VALID_REASONS.includes(reason)) {
    throw new ValidationError(`Invalid reason. Must be one of: ${VALID_REASONS.join(', ')}`);
  }

  const writeOff = await writeOffService.createWriteOff({
    warehouseId: data.warehouseId || null,
    reason,
    note: data.note || null,
    items: items.map((item: any) => ({
      productId: item.productId,
      batchId: item.batchId || null,
      quantity: Number(item.quantity),
    })),
    userId: authedReq.user.id,
    userRole: authedReq.user.role,
  });

  res.status(201).json(writeOff);
}));

writeoffRouter.patch('/:id', authenticate, asyncHandler(async (req, res) => {
  const authedReq = req as AuthedRequest;
  const { items, ...data } = req.body ?? {};

  if (!items || !Array.isArray(items) || items.length === 0) {
    throw new ValidationError('items array is required');
  }

  const reason = (data.reason || 'OTHER').toUpperCase() as WriteOffReasonStr;
  if (!VALID_REASONS.includes(reason)) {
    throw new ValidationError(`Invalid reason. Must be one of: ${VALID_REASONS.join(', ')}`);
  }

  const writeOff = await writeOffService.updateWriteOff(String(req.params.id), {
    warehouseId: data.warehouseId || null,
    reason,
    note: data.note || null,
    items: items.map((item: any) => ({
      productId: item.productId,
      batchId: item.batchId || null,
      quantity: Number(item.quantity),
    })),
    userId: authedReq.user.id,
    userRole: authedReq.user.role,
  });

  res.json(writeOff);
}));

writeoffRouter.delete('/:id', authenticate, asyncHandler(async (req, res) => {
  const authedReq = req as AuthedRequest;

  await writeOffService.deleteWriteOff(String(req.params.id), authedReq.user.id, authedReq.user.role);
  res.json({ ok: true });
}));
