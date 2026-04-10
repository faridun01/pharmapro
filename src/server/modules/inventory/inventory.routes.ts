import { Router } from 'express';
import { authenticate, type AuthedRequest } from '../../common/auth';
import { asyncHandler } from '../../common/http';
import { ValidationError } from '../../common/errors';
import { inventoryService } from './inventory.service';

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

inventoryRouter.post('/restock', authenticate, asyncHandler(async (req, res) => {
  const authedReq = req as AuthedRequest;
  const body = req.body ?? {};

  const result = await inventoryService.restock({
    productId: String(body.productId),
    batchNumber: String(body.batchNumber),
    quantity: parsePositiveInt(body.quantity, 'quantity'),
    unit: String(body.unit || 'units'),
    costBasis: parseNonNegative(body.costBasis ?? 0, 'costBasis'),
    retailPrice: body.retailPrice == null ? undefined : parseNonNegative(body.retailPrice, 'retailPrice'),
    supplierId: body.supplierId ? String(body.supplierId) : null,
    manufacturedDate: new Date(body.manufacturedDate),
    expiryDate: new Date(body.expiryDate),
  }, authedReq.user.id);

  res.status(201).json(result);
}));

inventoryRouter.post('/purchase-invoices', authenticate, asyncHandler(async (req, res) => {
  const authedReq = req as AuthedRequest;
  const body = req.body ?? {};

  const result = await inventoryService.importPurchaseInvoice({
    supplierId: String(body.supplierId),
    invoiceNumber: typeof body.invoiceNumber === 'string' ? body.invoiceNumber : undefined,
    invoiceDate: new Date(body.invoiceDate),
    discountAmount: parseNonNegative(body.discountAmount ?? 0, 'discountAmount'),
    taxAmount: parseNonNegative(body.taxAmount ?? 0, 'taxAmount'),
    comment: typeof body.comment === 'string' ? body.comment : undefined,
    items: Array.isArray(body.items)
      ? body.items.map((item: any, idx: number) => ({
        productId: String(item.productId),
        batchNumber: String(item.batchNumber),
        quantity: parsePositiveInt(item.quantity, `items[${idx}].quantity`),
        unit: String(item.unit || 'units'),
        costBasis: parseNonNegative(item.costBasis ?? 0, `items[${idx}].costBasis`),
        wholesalePrice: item.wholesalePrice == null ? null : parseNonNegative(item.wholesalePrice, `items[${idx}].wholesalePrice`),
        retailPrice: item.retailPrice == null ? null : parseNonNegative(item.retailPrice, `items[${idx}].retailPrice`),
        manufacturedDate: new Date(item.manufacturedDate),
        expiryDate: new Date(item.expiryDate),
      }))
      : [],
  }, authedReq.user.id);

  res.status(201).json(result);
}));

inventoryRouter.patch('/batches/:id/quantity', authenticate, asyncHandler(async (req, res) => {
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

inventoryRouter.patch('/batches/:id', authenticate, asyncHandler(async (req, res) => {
  const authedReq = req as AuthedRequest;
  const body = req.body ?? {};

  const result = await inventoryService.editBatch(
    String(req.params.id),
    {
      costBasis: body.costBasis !== undefined ? parseNonNegative(body.costBasis, 'costBasis') : undefined,
      retailPrice: body.retailPrice !== undefined ? parseNonNegative(body.retailPrice, 'retailPrice') : undefined,
      quantity: body.quantity !== undefined ? parseNonNegative(body.quantity, 'quantity') : undefined,
    },
    authedReq.user.id,
  );

  res.json(result);
}));

inventoryRouter.delete('/batches/:id', authenticate, asyncHandler(async (req, res) => {
  const authedReq = req as AuthedRequest;
  const result = await inventoryService.deleteBatch(String(req.params.id), authedReq.user.id);
  res.json(result);
}));
