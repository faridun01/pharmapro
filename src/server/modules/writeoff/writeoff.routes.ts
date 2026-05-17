import { Router } from 'express';
import { authenticate, requireRole, type AuthedRequest } from '../../common/auth';
import { asyncHandler } from '../../common/http';
import { prisma } from '../../infrastructure/prisma';
import { ValidationError } from '../../common/errors';
import { writeOffService } from './writeoff.service';

export const writeoffRouter = Router();

const VALID_REASONS = ['EXPIRED', 'DAMAGED', 'LOST', 'INTERNAL_USE', 'MISMATCH', 'BROKEN_PACKAGING', 'OTHER'] as const;
type WriteOffReasonStr = (typeof VALID_REASONS)[number];

// GET / — All authenticated users can see write-offs
writeoffRouter.get('/', authenticate, asyncHandler(async (req, res) => {
  const parseDate = (val: any) => {
    if (!val) return undefined;
    const d = new Date(String(val));
    return isNaN(d.getTime()) ? undefined : d;
  };

  const from = parseDate(req.query.from);
  const to = parseDate(req.query.to);

  const where: any = {};
  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt.gte = from;
    if (to) where.createdAt.lte = to;
  }

  const writeOffs = await prisma.writeOff.findMany({
    where,
    include: {
      items: { include: { product: true, batch: true } },
      createdBy: { select: { name: true } },
      warehouse: { select: { name: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
  res.json(writeOffs);
}));

// POST / — Allowed for all roles (Service will decide if it is DRAFT or POSTED)
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

// PATCH /:id — PHARMACIST, ADMIN, OWNER
writeoffRouter.patch('/:id', authenticate, requireRole(['PHARMACIST', 'ADMIN', 'OWNER']), asyncHandler(async (req, res) => {
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

// DELETE /:id — ADMIN, OWNER only
writeoffRouter.delete('/:id', authenticate, requireRole(['ADMIN', 'OWNER']), asyncHandler(async (req, res) => {
  const authedReq = req as AuthedRequest;

  await writeOffService.deleteWriteOff(String(req.params.id), authedReq.user.id, authedReq.user.role);
  res.json({ ok: true });
}));
// POST /approve/:id — PHARMACIST, ADMIN, OWNER
writeoffRouter.post('/approve/:id', authenticate, requireRole(['PHARMACIST', 'ADMIN', 'OWNER']), asyncHandler(async (req, res) => {
  const authedReq = req as AuthedRequest;
  const result = await writeOffService.approveWriteOff(req.params.id, authedReq.user.id, authedReq.user.role);
  res.json(result);
}));

// POST /mass-expired — ADMIN, OWNER, PHARMACIST
writeoffRouter.post('/mass-expired', authenticate, requireRole(['PHARMACIST', 'ADMIN', 'OWNER']), asyncHandler(async (req, res) => {
  const authedReq = req as AuthedRequest;
  const result = await writeOffService.massWriteOffExpired(authedReq.user.id, authedReq.user.role);
  res.json(result);
}));
