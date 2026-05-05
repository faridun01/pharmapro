import { Router } from 'express';
import { authenticate, requireRole, type AuthedRequest } from '../../common/auth';
import { asyncHandler } from '../../common/http';
import { ValidationError } from '../../common/errors';
import { inventoryService } from './inventory.service';
import { db } from '../../infrastructure/prisma';

export const inventoryRouter = Router();

const parsePositiveInt = (value: unknown, field: string): number => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new ValidationError(`${field} must be a positive number`);
  return n;
};

const parseNonNegative = (value: unknown, field: string): number => {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new ValidationError(`${field} must be a non-negative number`);
  return n;
};

// POST /restock — PHARMACIST, ADMIN, OWNER
inventoryRouter.post('/restock', authenticate, requireRole(['PHARMACIST', 'ADMIN', 'OWNER']), asyncHandler(async (req, res) => {
  const authedReq = req as AuthedRequest;
  const body = req.body ?? {};

  const result = await inventoryService.restock({
    productId: String(body.productId),
    batchNumber: String(body.batchNumber),
    quantity: parsePositiveInt(body.quantity, 'quantity'),
    unit: String(body.unit || 'units'),
    costBasis: parseNonNegative(body.costBasis ?? 0, 'costBasis'),
    supplierId: body.supplierId ? String(body.supplierId) : null,
    manufacturedDate: new Date(body.manufacturedDate),
    expiryDate: new Date(body.expiryDate),
  }, authedReq.user.id);

  res.status(201).json(result);
}));

// GET /purchase-invoices — PHARMACIST, ADMIN, OWNER
inventoryRouter.get('/purchase-invoices', authenticate, requireRole(['PHARMACIST', 'ADMIN', 'OWNER']), asyncHandler(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 100);
  const offset = Math.max(Number(req.query.offset) || 0, 0);

  const [invoices, total] = await Promise.all([
    db.purchaseInvoice.findMany({
      include: {
        supplier: { select: { name: true } },
        warehouse: { select: { name: true } },
        items: { include: { product: { select: { name: true } } } },
        createdBy: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    }),
    db.purchaseInvoice.count(),
  ]);

  res.json({ invoices, total, limit, offset });
}));

// POST /purchase-invoices — PHARMACIST, ADMIN, OWNER
inventoryRouter.post('/purchase-invoices', authenticate, requireRole(['PHARMACIST', 'ADMIN', 'OWNER']), asyncHandler(async (req, res) => {
  const authedReq = req as AuthedRequest;
  const body = req.body ?? {};

  const result = await inventoryService.importPurchaseInvoice({
    supplierId: String(body.supplierId),
    invoiceNumber: typeof body.invoiceNumber === 'string' ? body.invoiceNumber : undefined,
    invoiceDate: new Date(body.invoiceDate),
    discountAmount: parseNonNegative(body.discountAmount ?? 0, 'discountAmount'),
    taxAmount: parseNonNegative(body.taxAmount ?? 0, 'taxAmount'),
    status: body.status === 'POSTED' ? 'POSTED' : 'DRAFT',
    comment: typeof body.comment === 'string' ? body.comment : undefined,
    items: Array.isArray(body.items)
      ? body.items.map((item: any, idx: number) => ({
        productId: String(item.productId),
        batchNumber: String(item.batchNumber),
        quantity: parsePositiveInt(item.quantity, `items[${idx}].quantity`),
        unit: String(item.unit || 'units'),
        costBasis: parseNonNegative(item.costBasis ?? 0, `items[${idx}].costBasis`),
        wholesalePrice: item.wholesalePrice == null ? null : parseNonNegative(item.wholesalePrice, `items[${idx}].wholesalePrice`),
        manufacturedDate: new Date(item.manufacturedDate),
        expiryDate: new Date(item.expiryDate),
      }))
      : [],
  }, authedReq.user.id);

  res.status(201).json(result);
}));

// PATCH /batches/:id/quantity — ADMIN, OWNER only
inventoryRouter.patch('/batches/:id/quantity', authenticate, requireRole(['ADMIN', 'OWNER']), asyncHandler(async (req, res) => {
  const authedReq = req as AuthedRequest;
  const body = req.body ?? {};

  const result = await inventoryService.adjustBatchQuantity(
    String(req.params.id),
    parseNonNegative(body.quantity, 'quantity'),
    authedReq.user.id,
    typeof body.reason === 'string' ? body.reason : undefined,
  );

  res.json(result);
}));

// PATCH /batches/:id — ADMIN, OWNER only
inventoryRouter.patch('/batches/:id', authenticate, requireRole(['ADMIN', 'OWNER']), asyncHandler(async (req, res) => {
  const authedReq = req as AuthedRequest;
  const body = req.body ?? {};

  const result = await inventoryService.editBatch(
    String(req.params.id),
    {
      costBasis: body.costBasis !== undefined ? parseNonNegative(body.costBasis, 'costBasis') : undefined,
      quantity: body.quantity !== undefined ? parseNonNegative(body.quantity, 'quantity') : undefined,
    },
    authedReq.user.id,
  );

  res.json(result);
}));

// DELETE /batches/:id — ADMIN, OWNER only
inventoryRouter.delete('/batches/:id', authenticate, requireRole(['ADMIN', 'OWNER']), asyncHandler(async (req, res) => {
  const authedReq = req as AuthedRequest;
  const result = await inventoryService.deleteBatch(String(req.params.id), authedReq.user.id);
  res.json(result);
}));
// POST /purchase-invoices/:id/approve — PHARMACIST, ADMIN, OWNER
inventoryRouter.post('/purchase-invoices/:id/approve', authenticate, requireRole(['PHARMACIST', 'ADMIN', 'OWNER']), asyncHandler(async (req, res) => {
  const authedReq = req as AuthedRequest;
  const result = await inventoryService.approvePurchaseInvoice(req.params.id, authedReq.user.id);
  res.json(result);
}));

// PUT /purchase-invoices/:id — PHARMACIST, ADMIN, OWNER
inventoryRouter.put('/purchase-invoices/:id', authenticate, requireRole(['PHARMACIST', 'ADMIN', 'OWNER']), asyncHandler(async (req, res) => {
  const authedReq = req as AuthedRequest;
  const body = req.body ?? {};

  const result = await inventoryService.updatePurchaseInvoice(req.params.id, {
    supplierId: String(body.supplierId),
    invoiceNumber: String(body.invoiceNumber),
    invoiceDate: new Date(body.invoiceDate),
    discountAmount: parseNonNegative(body.discountAmount ?? 0, 'discountAmount'),
    taxAmount: parseNonNegative(body.taxAmount ?? 0, 'taxAmount'),
    status: body.status === 'POSTED' ? 'POSTED' : 'DRAFT',
    comment: body.comment,
    items: Array.isArray(body.items)
      ? body.items.map((item: any, idx: number) => ({
        productId: String(item.productId),
        batchNumber: String(item.batchNumber),
        quantity: parsePositiveInt(item.quantity, `items[${idx}].quantity`),
        unit: String(item.unit || 'units'),
        costBasis: parseNonNegative(item.costBasis ?? item.purchasePrice ?? 0, `items[${idx}].costBasis`),
        wholesalePrice: item.wholesalePrice == null ? null : parseNonNegative(item.wholesalePrice, `items[${idx}].wholesalePrice`),
        manufacturedDate: new Date(item.manufacturedDate),
        expiryDate: new Date(item.expiryDate),
        countryOfOrigin: item.countryOfOrigin,
      }))
      : [],
  }, authedReq.user.id);

  res.json(result);
}));

// DELETE /purchase-invoices/:id — ADMIN, OWNER only
inventoryRouter.delete('/purchase-invoices/:id', authenticate, requireRole(['ADMIN', 'OWNER']), asyncHandler(async (req, res) => {
  const authedReq = req as AuthedRequest;
  const result = await inventoryService.deletePurchaseInvoice(req.params.id, authedReq.user.id);
  res.json(result);
}));

