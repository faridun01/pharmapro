import { Prisma, ProductStatus } from '@prisma/client';
import { prisma } from '../../infrastructure/prisma';
import { auditService } from '../../services/audit.service';
import { findExistingProductByName } from '../../common/productName';
import { computeBatchStatus } from '../../common/batchStatus';
import { computeProductStatus } from '../../common/productStatus';
import { 
  buildGeneratedSku, 
  isBarcodeConflictError, 
  isSkuConflictError, 
  mapBatchStatus, 
  mapProductStatus, 
  normalizeNullableText, 
  normalizeSku,
  parseAuditJson
} from '../../common/utils';
import { NotFoundError, ValidationError } from '../../common/errors';
import { z } from 'zod';

const CreateProductSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  sku: z.string().optional().nullable(),
  category: z.string().optional().nullable(),
  manufacturer: z.string().optional().nullable(),
  countryOfOrigin: z.string().optional().nullable(),
  barcode: z.string().optional().nullable(),
  minStock: z.number().optional().default(10),
  costPrice: z.number().optional().default(0),
  sellingPrice: z.number().min(0, 'Price cannot be negative').optional().default(0),
  prescription: z.boolean().optional().default(false),
  markingRequired: z.boolean().optional().default(false),
  status: z.string().optional().nullable(),
  dosage: z.string().optional().nullable(),
  formId: z.string().optional().nullable(),
  analogs: z.union([z.array(z.string()), z.string()]).optional().nullable(),
  batches: z.array(z.object({
    id: z.string().optional(),
    batchNumber: z.string().optional(),
    quantity: z.number().optional().default(0),
    costBasis: z.number().optional(),
    supplierId: z.string().optional(),
    warehouseId: z.string().optional(),
    manufacturedDate: z.string().or(z.date()).optional(),
    expiryDate: z.string().or(z.date()).optional(),
  })).optional().default([]),
});

const UpdateProductSchema = CreateProductSchema.partial();

export class ProductService {
  async getProducts(params: { page: number; limit: number; search?: string }) {
    const { page, limit, search } = params;
    const where: Prisma.ProductWhereInput = {
      isActive: true,
      ...(search ? {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { sku: { contains: search, mode: 'insensitive' } },
          { barcode: { contains: search, mode: 'insensitive' } },
        ]
      } : {})
    };

    const [total, items] = await Promise.all([
      prisma.product.count({ where }),
      prisma.product.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        include: {
          batches: {
            where: { quantity: { gt: 0 } },
            include: {
              movements: {
                select: { id: true, type: true, quantity: true, date: true },
                orderBy: { date: 'desc' },
                take: 20,
              },
              supplier: { select: { name: true } },
            },
            orderBy: { createdAt: 'desc' },
          },
        },
        orderBy: { name: 'asc' },
      })
    ]);

    const itemsWithFreshBatchStatus = items.map((product) => ({
      ...product,
      batches: product.batches
        .map((batch) => ({
          ...batch,
          status: computeBatchStatus(batch.expiryDate),
        }))
        .sort((left, right) => new Date(left.receivedAt).getTime() - new Date(right.receivedAt).getTime()),
    }));

    return {
      items: itemsWithFreshBatchStatus,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      }
    };
  }

  async getProductById(id: string) {
    const product = await prisma.product.findUnique({
      where: { id },
      include: {
        batches: {
          include: {
            movements: { orderBy: { date: 'desc' }, take: 100 },
            supplier: { select: { name: true, contact: true } },
            warehouse: { select: { name: true } },
          },
          orderBy: { receivedAt: 'asc' },
        },
      },
    });
    if (!product) throw new NotFoundError(`Product ${id} not found`);
    return {
      ...product,
      batches: product.batches
        .map((batch) => ({
          ...batch,
          status: computeBatchStatus(batch.expiryDate),
        }))
        .sort((left, right) => new Date(left.receivedAt).getTime() - new Date(right.receivedAt).getTime()),
    };
  }

  async createProduct(rawData: any, userId: string, userRole: any) {
    const parseResult = CreateProductSchema.safeParse(rawData);
    if (!parseResult.success) {
      throw new ValidationError(`Invalid product data: ${parseResult.error.issues.map(e => e.message).join(', ')}`);
    }
    const data = parseResult.data;
    const batches = data.batches;
    const initialStock = (batches || []).reduce((sum, batch) => sum + Math.max(0, Number(batch.quantity || 0)), 0);
    
    const productData = {
      name: data.name,
      sku: normalizeSku(data.sku) || undefined,
      category: normalizeNullableText(data.category),
      manufacturer: normalizeNullableText(data.manufacturer),
      countryOfOrigin: normalizeNullableText(data.countryOfOrigin),
      barcode: normalizeNullableText(data.barcode),
      minStock: data.minStock,
      costPrice: data.costPrice,
      sellingPrice: data.sellingPrice,
      prescription: data.prescription,
      markingRequired: data.markingRequired,
      analogs: Array.isArray(data.analogs) ? JSON.stringify(data.analogs) : normalizeNullableText(data.analogs),
    };

    const existingProduct = await findExistingProductByName(
      productData.name, 
      productData.countryOfOrigin,
      data.dosage,
      data.formId
    );
    if (existingProduct) return existingProduct;

    const normalizedSku = normalizeSku(productData.sku);
    if (normalizedSku) {
      const existingBySku = await prisma.product.findFirst({
        where: { sku: normalizedSku },
        include: { batches: true },
      });

      if (existingBySku) {
        if (existingBySku.isActive) return existingBySku;

        // Reactivate
        const reactivated = await prisma.product.update({
          where: { id: existingBySku.id },
          data: {
            ...productData,
            sku: normalizedSku,
            status: mapProductStatus(data.status) ?? 'ACTIVE',
            isActive: true,
          } as any,
          include: { batches: true },
        });
        await auditService.log({ userId, userRole, module: 'catalog', action: 'REACTIVATE_PRODUCT', entity: 'PRODUCT', entityId: reactivated.id, newValue: productData });
        return reactivated;
      }
    }

    const resolvedSku = normalizedSku || buildGeneratedSku(productData.name);
    let created;

    try {
      created = await prisma.product.create({
        data: {
          ...productData,
          sku: resolvedSku,
          status: mapProductStatus(data.status) ?? computeProductStatus(initialStock, data.minStock),
          totalStock: initialStock,
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
              manufacturedDate: b.manufacturedDate ? new Date(b.manufacturedDate) : undefined,
              expiryDate: b.expiryDate ? new Date(b.expiryDate) : undefined,
              status: b.expiryDate ? computeBatchStatus(b.expiryDate) : mapBatchStatus(b.status),
              movements: {
                create: (b.movements || []).map((m: any) => ({
                  type: m.type || 'RESTOCK',
                  quantity: m.quantity,
                  date: new Date(m.date || new Date()),
                  description: m.description,
                  userId: userId,
                })),
              },
            })),
          },
        } as any,
        include: { batches: true },
      });
    } catch (error) {
      if (isBarcodeConflictError(error)) throw new ValidationError('Штрихкод уже используется другим товаром');
      if (!isSkuConflictError(error)) throw error;

      const existingBySku = await prisma.product.findFirst({ where: { sku: resolvedSku }, include: { batches: true } });
      if (!existingBySku) throw error;
      if (!existingBySku.isActive) {
        created = await prisma.product.update({
          where: { id: existingBySku.id },
          data: { ...productData, sku: resolvedSku, status: mapProductStatus(data.status) ?? 'ACTIVE', isActive: true } as any,
          include: { batches: true },
        });
      } else {
        created = existingBySku;
      }
    }

    await auditService.log({ userId, userRole, module: 'catalog', action: 'CREATE_PRODUCT', entity: 'PRODUCT', entityId: created.id, newValue: productData });
    return created;
  }

  async updateProduct(id: string, rawData: any, userId: string, userRole: any) {
    const parseResult = UpdateProductSchema.safeParse(rawData);
    if (!parseResult.success) {
      throw new ValidationError(`Invalid update data: ${parseResult.error.issues.map(e => e.message).join(', ')}`);
    }
    const data = parseResult.data;
    const existing = await prisma.product.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError(`Product ${id} not found`);

    const productData: any = {};
    if (data.name !== undefined) productData.name = data.name;
    if (data.sku !== undefined) productData.sku = normalizeSku(data.sku);
    if (data.category !== undefined) productData.category = normalizeNullableText(data.category);
    if (data.manufacturer !== undefined) productData.manufacturer = normalizeNullableText(data.manufacturer);
    if (data.countryOfOrigin !== undefined) productData.countryOfOrigin = normalizeNullableText(data.countryOfOrigin);
    if (data.barcode !== undefined) productData.barcode = normalizeNullableText(data.barcode);
    if (data.minStock !== undefined) productData.minStock = data.minStock;
    if (data.costPrice !== undefined) productData.costPrice = data.costPrice;
    if (data.sellingPrice !== undefined) productData.sellingPrice = data.sellingPrice;
    if (data.prescription !== undefined) productData.prescription = data.prescription;
    if (data.markingRequired !== undefined) productData.markingRequired = data.markingRequired;
    if (data.analogs !== undefined) productData.analogs = Array.isArray(data.analogs) ? JSON.stringify(data.analogs) : normalizeNullableText(data.analogs);

    try {
      const updated = await prisma.product.update({ where: { id }, data: productData });
      await auditService.log({ userId, userRole, module: 'catalog', action: 'UPDATE_PRODUCT', entity: 'PRODUCT', entityId: updated.id, oldValue: existing, newValue: productData });
      return updated;
    } catch (error) {
      if (isBarcodeConflictError(error)) throw new ValidationError('Штрихкод уже используется другим товаром');
      throw error;
    }
  }

  async deleteProduct(id: string, userId: string, userRole: any) {
    const existing = await prisma.product.findUnique({ where: { id }, select: { id: true, name: true, sku: true, isActive: true } });
    if (!existing) throw new NotFoundError(`Product ${id} not found`);

    await prisma.product.update({ where: { id }, data: { isActive: false } });
    await auditService.log({ userId, userRole, module: 'catalog', action: 'DELETE_PRODUCT', entity: 'PRODUCT', entityId: existing.id, oldValue: existing, newValue: { isActive: false } });
  }

  async getPriceHistory(productId: string) {
    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { id: true },
    });

    if (!product) throw new NotFoundError(`Product ${productId} not found`);

    const auditEntries = await prisma.auditLog.findMany({
      where: {
        entity: 'PRODUCT',
        entityId: productId,
        action: 'UPDATE_PRODUCT',
      },
      include: {
        user: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 25,
    });

    return auditEntries
      .map((entry) => {
        const oldValue = parseAuditJson(entry.oldValue) as Record<string, unknown> | null;
        const newValue = parseAuditJson(entry.newValue) as Record<string, unknown> | null;

        const oldCostPrice = oldValue?.costPrice != null ? Number(oldValue.costPrice) : null;
        const newCostPrice = newValue?.costPrice != null ? Number(newValue.costPrice) : oldCostPrice;
        const oldSellingPrice = oldValue?.sellingPrice != null ? Number(oldValue.sellingPrice) : null;
        const newSellingPrice = newValue?.sellingPrice != null ? Number(newValue.sellingPrice) : oldSellingPrice;

        if (oldCostPrice === newCostPrice && oldSellingPrice === newSellingPrice) return null;

        return {
          id: entry.id,
          createdAt: entry.createdAt,
          actorName: entry.user?.name || 'Сотрудник',
          costPrice: { old: oldCostPrice, new: newCostPrice },
          sellingPrice: { old: oldSellingPrice, new: newSellingPrice },
        };
      })
      .filter(Boolean);
  }
}

export const productService = new ProductService();
