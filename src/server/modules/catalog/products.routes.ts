import { Router } from 'express';
import { authenticate, type AuthedRequest } from '../../common/auth';
import { asyncHandler } from '../../common/http';
import { prisma } from '../../infrastructure/prisma';
import { auditService } from '../../services/audit.service';
import { findExistingProductByName } from '../../common/productName';

export const productsRouter = Router();

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
    sku: body.sku != null ? String(body.sku) : undefined,
    description: body.description != null ? String(body.description) : undefined,
    category: body.category != null ? String(body.category) : undefined,
    manufacturer: body.manufacturer != null ? String(body.manufacturer) : undefined,
    barcode: body.barcode != null ? String(body.barcode) : undefined,
    unit: body.unit != null ? String(body.unit) : undefined,
    unitsPerPack: body.unitsPerPack != null ? Math.max(2, Number(body.unitsPerPack)) : undefined,
    minStock: body.minStock != null ? Number(body.minStock) : undefined,
    retailPrice: body.retailPrice != null ? Number(body.retailPrice) : undefined,
    wholesalePrice: body.wholesalePrice != null ? Number(body.wholesalePrice) : undefined,
    costPrice: body.costPrice != null ? Number(body.costPrice) : 0,
    sellingPrice: body.sellingPrice != null ? Number(body.sellingPrice) : 0,
  };

  const existingProduct = await findExistingProductByName(productData.name);
  if (existingProduct) {
    res.json(existingProduct);
    return;
  }

  const created = await prisma.product.create({
    data: {
      ...productData,
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
    description: body.description,
    category: body.category,
    manufacturer: body.manufacturer,
    barcode: body.barcode,
    unit: body.unit,
    unitsPerPack: body.unitsPerPack !== undefined ? Math.max(2, Number(body.unitsPerPack)) : undefined,
    minStock: body.minStock !== undefined ? Number(body.minStock) : undefined,
    costPrice: body.costPrice !== undefined ? Number(body.costPrice) : undefined,
    sellingPrice: body.sellingPrice !== undefined ? Number(body.sellingPrice) : undefined,
    retailPrice: body.retailPrice !== undefined ? Number(body.retailPrice) : undefined,
    wholesalePrice: body.wholesalePrice !== undefined ? Number(body.wholesalePrice) : undefined,
    status: mapProductStatus(body.status) ?? undefined,
  };
  // Remove undefined keys
  const productData = Object.fromEntries(
    Object.entries(allowedFields).filter(([, v]) => v !== undefined),
  ) as Record<string, unknown>;

  const updated = await prisma.product.update({
    where: { id: req.params.id },
    data: productData,
  });

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
