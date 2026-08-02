import { Router } from 'express';
import { authenticate, requireRole, type AuthedRequest } from '../../common/auth';
import { asyncHandler } from '../../common/http';
import { ValidationError } from '../../common/errors';
import { transfersService } from './transfers.service';

export const transfersRouter = Router();

// GET / — list stock transfers
transfersRouter.get('/', authenticate, asyncHandler(async (req, res) => {
  const fromWarehouseId = typeof req.query.fromWarehouseId === 'string' ? req.query.fromWarehouseId : undefined;
  const toWarehouseId = typeof req.query.toWarehouseId === 'string' ? req.query.toWarehouseId : undefined;
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const page = req.query.page ? Number(req.query.page) : undefined;
  const limit = req.query.limit ? Number(req.query.limit) : undefined;

  const result = await transfersService.listTransfers({ fromWarehouseId, toWarehouseId, status, page, limit });
  res.json(result);
}));

// GET /:id — get transfer details
transfersRouter.get('/:id', authenticate, asyncHandler(async (req, res) => {
  const result = await transfersService.getTransferById(String(req.params.id));
  res.json(result);
}));

// POST / — create new stock transfer (IN_TRANSIT)
transfersRouter.post('/', authenticate, requireRole(['WAREHOUSE_STAFF', 'PHARMACIST', 'ADMIN', 'OWNER']), asyncHandler(async (req, res) => {
  const authedReq = req as AuthedRequest;
  const body = req.body ?? {};

  if (!body.fromWarehouseId || !body.toWarehouseId) {
    throw new ValidationError('fromWarehouseId and toWarehouseId are required');
  }

  if (!Array.isArray(body.items) || body.items.length === 0) {
    throw new ValidationError('items array is required');
  }

  const result = await transfersService.createTransfer({
    fromWarehouseId: String(body.fromWarehouseId),
    toWarehouseId: String(body.toWarehouseId),
    reason: typeof body.reason === 'string' ? body.reason : undefined,
    items: body.items.map((item: any) => ({
      productId: String(item.productId),
      batchId: item.batchId ? String(item.batchId) : undefined,
      quantity: Math.max(1, Number(item.quantity) || 1),
    })),
    userId: authedReq.user.id,
  });

  res.status(201).json(result);
}));

// POST /:id/receive — receive/complete transfer
transfersRouter.post('/:id/receive', authenticate, requireRole(['WAREHOUSE_STAFF', 'PHARMACIST', 'ADMIN', 'OWNER']), asyncHandler(async (req, res) => {
  const authedReq = req as AuthedRequest;
  const result = await transfersService.receiveTransfer(String(req.params.id), authedReq.user.id);
  res.json(result);
}));

// POST /:id/cancel — cancel transfer
transfersRouter.post('/:id/cancel', authenticate, requireRole(['WAREHOUSE_STAFF', 'ADMIN', 'OWNER']), asyncHandler(async (req, res) => {
  const authedReq = req as AuthedRequest;
  const result = await transfersService.cancelTransfer(String(req.params.id), authedReq.user.id);
  res.json(result);
}));
