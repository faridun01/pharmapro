import { Router } from 'express';
import { authenticate, type AuthedRequest } from '../../common/auth';
import { asyncHandler } from '../../common/http';
import { prisma } from '../../infrastructure/prisma';
import { productService } from './product.service';
import { parseAuditJson } from '../../common/utils';

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

productsRouter.post('/', authenticate, asyncHandler(async (req, res) => {
  const authedReq = req as AuthedRequest;
  const created = await productService.createProduct(req.body, authedReq.user.id, authedReq.user.role);
  res.status(201).json(created);
}));

productsRouter.put('/:id', authenticate, asyncHandler(async (req, res) => {
  const authedReq = req as AuthedRequest;
  const updated = await productService.updateProduct(req.params.id, req.body, authedReq.user.id, authedReq.user.role);
  res.json(updated);
}));

productsRouter.delete('/:id', authenticate, asyncHandler(async (req, res) => {
  const authedReq = req as AuthedRequest;
  await productService.deleteProduct(req.params.id, authedReq.user.id, authedReq.user.role);
  res.status(204).send();
}));
