import { Prisma } from '@prisma/client';
import { Router } from 'express';
import { authenticate, type AuthedRequest } from '../../common/auth';
import { asyncHandler } from '../../common/http';
import { prisma } from '../../infrastructure/prisma';
import { auditService } from '../../services/audit.service';
import { findExistingProductByName } from '../../common/productName';

export const productsRouter = Router();

const normalizeSku = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

const buildGeneratedSku = (name: string) => {
  const base = String(name || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 16);

  return `${base || 'ITEM'}-${Date.now().toString().slice(-6)}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
};

const isSkuConflictError = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError
  && error.code === 'P2002'
  && Array.isArray((error.meta as { target?: unknown } | undefined)?.target)
  && ((error.meta as { target?: unknown[] }).target || []).includes('sku');

const isBarcodeConflictError = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError
  && error.code === 'P2002'
  && Array.isArray((error.meta as { target?: unknown } | undefined)?.target)
  && ((error.meta as { target?: unknown[] }).target || []).includes('barcode');

const mapProductStatus = (status: string | undefined): 'ACTIVE' | 'LOW_STOCK' | 'OUT_OF_STOCK' | undefined => {
  if (!status) return undefined;
  const normalized = status.toUpperCase().replace(/\s+/g, '_');
  if (normalized === 'ACTIVE') return 'ACTIVE';
  if (normalized === 'LOW_STOCK' || normalized === 'LOW') return 'LOW_STOCK';
  if (normalized === 'OUT_OF_STOCK') return 'OUT_OF_STOCK';
  return undefined;
};

const mapBatchStatus = (status: string | undefined): 'CRITICAL' | 'STABLE' | 'NEAR_EXPIRY' | 'EXPIRED' => {
  const normalized = (status || 'STABLE').toUpperCase().replace(/\s+/g, '_');
  if (normalized === 'CRITICAL' || normalized === 'STABLE' || normalized === 'NEAR_EXPIRY' || normalized === 'EXPIRED') {
    return normalized;
  }
  return 'STABLE';
};

const parseAuditJson = (value: string | null) => {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

productsRouter.get('/', authenticate, asyncHandler(async (_req, res) => {
  const products = await prisma.product.findMany({
    where: { isActive: true },
    include: {
      batches: {
        where: {
          quantity: { gt: 0 },
        },
        include: {
          movements: {
            select: {
              id: true,
              type: true,
              quantity: true,
              date: true,
            },
            orderBy: { date: 'desc' },
            take: 20,
          },
          supplier: {
            select: { name: true },
          },
        },
        orderBy: { createdAt: 'desc' },
      },
    },
    orderBy: { name: 'asc' },
  });
  res.json(products);
}));

productsRouter.get('/:id', authenticate, asyncHandler(async (req, res) => {
  const product = await prisma.product.findUnique({
    where: { id: req.params.id },
    include: {
      batches: {
        where: {
          quantity: { gt: 0 },
        },
        include: {
          movements: {
            orderBy: { date: 'desc' },
            take: 50,
          },
          supplier: {
            select: { name: true },
          },
        },
      },
    },
  });

  if (!product) {
    return res.status(404).json({
      error: `Product ${req.params.id} not found`,
      code: 'PRODUCT_NOT_FOUND',
    });
  }

  res.json(product);
}));

productsRouter.get('/:id/price-history', authenticate, asyncHandler(async (req, res) => {
  const product = await prisma.product.findUnique({
    where: { id: req.params.id },
    select: { id: true },
  });

  if (!product) {
    return res.status(404).json({
      error: `Product ${req.params.id} not found`,
      code: 'PRODUCT_NOT_FOUND',
    });
  }

  const auditEntries = await prisma.auditLog.findMany({
    where: {
      entity: 'PRODUCT',
      entityId: req.params.id,
      action: 'UPDATE_PRODUCT',
    },
    include: {
      user: {
        select: {
          name: true,
          email: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 25,
  });

  const history = auditEntries
    .map((entry) => {
      const oldValue = parseAuditJson(entry.oldValue) as Record<string, unknown> | null;
      const newValue = parseAuditJson(entry.newValue) as Record<string, unknown> | null;

      const oldCostPrice = oldValue?.costPrice != null ? Number(oldValue.costPrice) : null;
      const newCostPrice = newValue?.costPrice != null ? Number(newValue.costPrice) : oldCostPrice;
      const oldSellingPrice = oldValue?.sellingPrice != null ? Number(oldValue.sellingPrice) : null;
      const newSellingPrice = newValue?.sellingPrice != null ? Number(newValue.sellingPrice) : oldSellingPrice;

      const costChanged = oldCostPrice !== newCostPrice;
      const sellingChanged = oldSellingPrice !== newSellingPrice;

      if (!costChanged && !sellingChanged) {
        return null;
      }

      return {
        id: entry.id,
        createdAt: entry.createdAt,
        actorName: entry.user?.name || entry.user?.email || 'Сотрудник',
        costPrice: {
          old: oldCostPrice,
          new: newCostPrice,
        },
        sellingPrice: {
          old: oldSellingPrice,
          new: newSellingPrice,
        },
      };
    })
    .filter(Boolean);

  res.json(history);
}));

productsRouter.post('/', authenticate, asyncHandler(async (req, res) => {
  const authedReq = req as AuthedRequest;
  const body = req.body ?? {};
  const batches = body.batches;

  // Explicit whitelist to prevent mass assignment
  const productData = {
    name: String(body.name ?? ''),
    sku: normalizeSku(body.sku) || undefined,
    category: body.category != null ? String(body.category) : undefined,
    manufacturer: body.manufacturer != null ? String(body.manufacturer) : undefined,
    barcode: body.barcode != null ? String(body.barcode) : undefined,
    minStock: body.minStock != null ? Number(body.minStock) : undefined,
    costPrice: body.costPrice != null ? Number(body.costPrice) : 0,
    sellingPrice: body.sellingPrice != null ? Number(body.sellingPrice) : 0,
    image: body.image != null ? String(body.image) : undefined,
    prescription: body.prescription != null ? Boolean(body.prescription) : undefined,
    markingRequired: body.markingRequired != null ? Boolean(body.markingRequired) : undefined,
    analogs: Array.isArray(body.analogs) ? JSON.stringify(body.analogs) : body.analogs != null ? String(body.analogs) : undefined,
  };

  const existingProduct = await findExistingProductByName(productData.name);
  if (existingProduct) {
    res.json(existingProduct);
    return;
  }

  const normalizedSku = normalizeSku(productData.sku);
  if (normalizedSku) {
    const existingBySku = await prisma.product.findFirst({
      where: {
        sku: normalizedSku,
      },
      include: { batches: true },
    });

    if (existingBySku) {
      if (existingBySku.isActive) {
        res.json(existingBySku);
        return;
      }

      const reactivatedProduct = await prisma.product.update({
        where: { id: existingBySku.id },
        data: {
          ...productData,
          sku: normalizedSku,
          status: mapProductStatus(body.status) ?? 'ACTIVE',
          isActive: true,
        },
        include: { batches: true },
      });

      res.json(reactivatedProduct);
      return;
    }
  }

  const resolvedSku = normalizedSku || buildGeneratedSku(productData.name);

  let created;

  try {
    created = await prisma.product.create({
      data: {
        ...productData,
        sku: resolvedSku,
        status: mapProductStatus(body.status) ?? 'ACTIVE',
        totalStock: 0,
        batches: {
          create: (batches || []).map((b: any) => ({
            batchNumber: b.batchNumber || b.id,
            quantity: b.quantity || 0,
            initialQty: b.initialQty || b.quantity || 0,
            currentQty: b.currentQty || b.quantity || 0,
            availableQty: b.availableQty || b.quantity || 0,
            reservedQty: b.reservedQty || 0,
            unit: b.unit || 'шт.',
            costBasis: b.costBasis,
            supplierId: b.supplierId,
            warehouseId: b.warehouseId,
            manufacturedDate: new Date(b.manufacturedDate),
            expiryDate: new Date(b.expiryDate),
            status: mapBatchStatus(b.status),
            movements: {
              create: (b.movements || []).map((m: any) => ({
                type: m.type || 'RESTOCK',
                quantity: m.quantity,
                date: new Date(m.date || new Date()),
                description: m.description,
                userId: authedReq.user.id,
              })),
            },
          })),
        },
      },
      include: { batches: true },
    });
  } catch (error) {
    if (isBarcodeConflictError(error)) {
      return res.status(409).json({ error: 'Штрихкод уже используется другим товаром', code: 'BARCODE_ALREADY_EXISTS' });
    }

    if (!isSkuConflictError(error)) {
      throw error;
    }

    const existingBySku = await prisma.product.findFirst({
      where: { sku: resolvedSku },
      include: { batches: true },
    });

    if (!existingBySku) {
      throw error;
    }

    if (!existingBySku.isActive) {
      created = await prisma.product.update({
        where: { id: existingBySku.id },
        data: {
          ...productData,
          sku: resolvedSku,
          status: mapProductStatus(body.status) ?? 'ACTIVE',
          isActive: true,
        },
        include: { batches: true },
      });
    } else {
      created = existingBySku;
    }
  }

  await auditService.log({
    userId: authedReq.user.id,
    userRole: authedReq.user.role as any,
    module: 'catalog',
    action: 'CREATE_PRODUCT',
    entity: 'PRODUCT',
    entityId: created.id,
    newValue: productData,
  });

  res.status(201).json(created);
}));

productsRouter.put('/:id', authenticate, asyncHandler(async (req, res) => {
  const authedReq = req as AuthedRequest;
  const body = req.body ?? {};

  const existing = await prisma.product.findUnique({ where: { id: req.params.id } });
  if (!existing) {
    return res.status(404).json({ error: `Product ${req.params.id} not found`, code: 'PRODUCT_NOT_FOUND' });
  }

  // Explicit whitelist to prevent mass assignment
  const allowedFields = {
    name: body.name,
    sku: body.sku,
    category: body.category,
    manufacturer: body.manufacturer,
    barcode: body.barcode,
    minStock: body.minStock !== undefined ? Number(body.minStock) : undefined,
    costPrice: body.costPrice !== undefined ? Number(body.costPrice) : undefined,
    sellingPrice: body.sellingPrice !== undefined ? Number(body.sellingPrice) : undefined,
    status: mapProductStatus(body.status) ?? undefined,
    image: body.image !== undefined ? String(body.image) : undefined,
    prescription: body.prescription !== undefined ? Boolean(body.prescription) : undefined,
    markingRequired: body.markingRequired !== undefined ? Boolean(body.markingRequired) : undefined,
    analogs: body.analogs !== undefined ? (Array.isArray(body.analogs) ? JSON.stringify(body.analogs) : String(body.analogs)) : undefined,
  };
  // Remove undefined keys
  const productData = Object.fromEntries(
    Object.entries(allowedFields).filter(([, v]) => v !== undefined),
  ) as Record<string, unknown>;

  let updated;

  try {
    updated = await prisma.product.update({
      where: { id: req.params.id },
      data: productData,
    });
  } catch (error) {
    if (isBarcodeConflictError(error)) {
      return res.status(409).json({ error: 'Штрихкод уже используется другим товаром', code: 'BARCODE_ALREADY_EXISTS' });
    }
    throw error;
  }

  await auditService.log({
    userId: authedReq.user.id,
    userRole: authedReq.user.role as any,
    module: 'catalog',
    action: 'UPDATE_PRODUCT',
    entity: 'PRODUCT',
    entityId: updated.id,
    oldValue: existing,
    newValue: productData,
  });

  res.json(updated);
}));

productsRouter.delete('/:id', authenticate, asyncHandler(async (req, res) => {
  const authedReq = req as AuthedRequest;
  const existing = await prisma.product.findUnique({
    where: { id: req.params.id },
    select: {
      id: true,
      name: true,
      sku: true,
      isActive: true,
    },
  });

  if (!existing) {
    return res.status(404).json({
      error: `Product ${req.params.id} not found`,
      code: 'PRODUCT_NOT_FOUND',
    });
  }

  await prisma.product.update({
    where: { id: req.params.id },
    data: {
      isActive: false,
    },
  });

  await auditService.log({
    userId: authedReq.user.id,
    userRole: authedReq.user.role as any,
    module: 'catalog',
    action: 'DELETE_PRODUCT',
    entity: 'PRODUCT',
    entityId: existing.id,
    oldValue: existing,
    newValue: { isActive: false },
  });

  res.status(204).send();
}));
