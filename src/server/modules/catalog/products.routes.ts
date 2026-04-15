import { Router } from 'express';
import { authenticate, requireRole, type AuthedRequest } from '../../common/auth';
import { asyncHandler } from '../../common/http';
import { prisma } from '../../infrastructure/prisma';
import { productService } from './product.service';
import { parseAuditJson } from '../../common/utils';
import { NotFoundError, ValidationError } from '../../common/errors';

export const productsRouter = Router();

productsRouter.get('/', authenticate, asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 50));
  const search = String(req.query.search || '').trim();

  const result = await productService.getProducts({ page, limit, search });
  res.json(result);
}));

productsRouter.get('/:id', authenticate, asyncHandler(async (req, res) => {
  const product = await productService.getProductById(req.params.id);
  res.json(product);
}));

productsRouter.get('/:id/price-history', authenticate, asyncHandler(async (req, res) => {
  const history = await productService.getPriceHistory(req.params.id);
  res.json(history);
}));

// GET /barcode/:code — exact barcode lookup (for POS scanners)
// NOTE: must be placed BEFORE /:id to avoid route conflict
productsRouter.get('/barcode/:code', authenticate, asyncHandler(async (req, res) => {
  const raw = String(req.params.code || '').trim();
  if (!raw) throw new ValidationError('Barcode is required');

  // Try exact barcode match first, then SKU
  const product = await prisma.product.findFirst({
    where: {
      isActive: true,
      OR: [
        { barcode: raw },
        { sku: raw },
      ],
    },
    include: {
      batches: {
        where: { quantity: { gt: 0 } },
        orderBy: { receivedAt: 'asc' }, // FIFO order
      },
    },
  });

  if (!product) {
    throw new NotFoundError(`Товар со штрихкодом «${raw}» не найден`);
  }

  res.json(product);
}));


// POST / — PHARMACIST, ADMIN, OWNER
productsRouter.post('/', authenticate, requireRole(['PHARMACIST', 'ADMIN', 'OWNER']), asyncHandler(async (req, res) => {
  const authedReq = req as AuthedRequest;
  const created = await productService.createProduct(req.body, authedReq.user.id, authedReq.user.role);
  res.status(201).json(created);
}));

// PUT /:id — PHARMACIST, ADMIN, OWNER
productsRouter.put('/:id', authenticate, requireRole(['PHARMACIST', 'ADMIN', 'OWNER']), asyncHandler(async (req, res) => {
  const authedReq = req as AuthedRequest;
  const updated = await productService.updateProduct(req.params.id, req.body, authedReq.user.id, authedReq.user.role);
  res.json(updated);
}));

// DELETE /:id — ADMIN, OWNER only
productsRouter.delete('/:id', authenticate, requireRole(['ADMIN', 'OWNER']), asyncHandler(async (req, res) => {
  const authedReq = req as AuthedRequest;
  await productService.deleteProduct(req.params.id, authedReq.user.id, authedReq.user.role);
  res.status(204).send();
}));
