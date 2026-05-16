import { prisma } from '../../infrastructure/prisma';
import { auditService } from '../../services/audit.service';
import { NotFoundError, ValidationError } from '../../common/errors';
import { reportCache } from '../../common/cache';

export type RestockItemInput = {
  productId: string;
  batchNumber: string;
  quantity: number;
  unit: string;
  costBasis: number;
  supplierId?: string | null;
  manufacturedDate: Date;
  expiryDate: Date;
};

export type PurchaseInvoiceImportItemInput = {
  productId: string;
  batchNumber: string;
  quantity: number;
  unit: string;
  costBasis: number;
  wholesalePrice?: number | null;
  manufacturedDate: Date;
  expiryDate: Date;
};

export type PurchaseInvoiceImportInput = {
  supplierId: string;
  invoiceNumber: string;
  invoiceDate: Date;
  discountAmount?: number;
  taxAmount?: number;
  comment?: string;
  items: PurchaseInvoiceImportItemInput[];
};

export type PurchaseInvoiceUpdateItemInput = PurchaseInvoiceImportItemInput & {
  id?: string;
};

export type PurchaseInvoiceUpdateInput = {
  supplierId: string;
  invoiceNumber: string;
  invoiceDate: Date;
  discountAmount?: number;
  taxAmount?: number;
  comment?: string;
  items: PurchaseInvoiceUpdateItemInput[];
};

const getBatchStatus = (expiryDate: Date): 'CRITICAL' | 'STABLE' | 'NEAR_EXPIRY' | 'EXPIRED' => {
  const diffDays = Math.ceil((expiryDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  if (diffDays <= 0) return 'EXPIRED';
  if (diffDays <= 30) return 'CRITICAL';
  if (diffDays <= 90) return 'NEAR_EXPIRY';
  return 'STABLE';
};

const mapProductStatus = (totalStock: number, minStock: number) => {
  if (totalStock <= 0) return 'OUT_OF_STOCK';
  if (totalStock < minStock) return 'LOW_STOCK';
  return 'ACTIVE';
};

const purchaseInvoiceInclude = {
  supplier: true,
  warehouse: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true, email: true } },
  items: {
    include: {
      product: {
        select: {
          id: true,
          name: true,
          sku: true,
          barcode: true,
          costPrice: true,
          sellingPrice: true,
          minStock: true,
          totalStock: true,
        },
      },
      batches: {
        include: {
          supplier: { select: { id: true, name: true } },
          movements: {
            orderBy: { date: 'desc' as const },
            take: 10,
          },
        },
      },
    },
  },
  payments: {
    select: {
      id: true,
      amount: true,
      method: true,
      paymentDate: true,
      status: true,
      comment: true,
    },
    orderBy: { paymentDate: 'desc' as const },
  },
  payables: {
    select: {
      id: true,
      originalAmount: true,
      paidAmount: true,
      remainingAmount: true,
      dueDate: true,
      status: true,
    },
  },
};

const normalizePurchaseItem = (item: PurchaseInvoiceUpdateItemInput | PurchaseInvoiceImportItemInput) => {
  const quantity = Math.floor(Number(item.quantity));
  const costBasis = Number(item.costBasis);
  const wholesalePrice = item.wholesalePrice == null ? null : Number(item.wholesalePrice);
  const manufacturedDate = new Date(item.manufacturedDate);
  const expiryDate = new Date(item.expiryDate);

  if (!item.productId) throw new ValidationError('productId is required for each purchase item');
  if (!String(item.batchNumber || '').trim()) throw new ValidationError('batchNumber is required for each purchase item');
  if (!Number.isFinite(quantity) || quantity <= 0) throw new ValidationError('quantity must be a positive number');
  if (!Number.isFinite(costBasis) || costBasis < 0) throw new ValidationError('costBasis must be a non-negative number');
  if (wholesalePrice !== null && (!Number.isFinite(wholesalePrice) || wholesalePrice < 0)) {
    throw new ValidationError('wholesalePrice must be a non-negative number');
  }
  if (Number.isNaN(manufacturedDate.getTime())) throw new ValidationError('manufacturedDate is invalid');
  if (Number.isNaN(expiryDate.getTime())) throw new ValidationError('expiryDate is invalid');

  return {
    productId: String(item.productId),
    batchNumber: String(item.batchNumber).trim(),
    quantity,
    unit: String(item.unit || 'units'),
    costBasis,
    wholesalePrice,
    manufacturedDate,
    expiryDate,
  };
};

const getBatchLinkedUsageCount = async (tx: any, batchId: string) => {
  const [linkedInvoiceItems, linkedReservations, linkedReturns, linkedWriteOffs, linkedTransfers] = await Promise.all([
    tx.invoiceItem.count({ where: { batchId } }),
    tx.reservation.count({ where: { batchId } }),
    tx.returnItem.count({ where: { batchId } }),
    tx.writeOffItem.count({ where: { batchId } }),
    tx.stockTransferItem.count({ where: { batchId } }),
  ]);

  return linkedInvoiceItems + linkedReservations + linkedReturns + linkedWriteOffs + linkedTransfers;
};

const removeUnusedPurchaseBatch = async (tx: any, batch: any, userId: string, description: string) => {
  const stockToRemove = Math.max(0, Number(batch.currentQty ?? batch.quantity ?? 0));
  const usedQuantity = Math.max(0, Number(batch.initialQty ?? stockToRemove) - Number(batch.currentQty ?? stockToRemove));
  const linkedRecords = await getBatchLinkedUsageCount(tx, batch.id);

  if (usedQuantity > 0 || linkedRecords > 0) {
    throw new ValidationError(`Cannot remove batch ${batch.batchNumber}: it already has sales or stock operations`);
  }

  await tx.batchMovement.create({
    data: {
      batchId: batch.id,
      type: 'ADJUSTMENT',
      quantity: stockToRemove,
      description,
      userId,
    },
  });

  await tx.batch.delete({ where: { id: batch.id } });

  const product = batch.product ?? await tx.product.findUnique({ where: { id: batch.productId } });
  if (product) {
    const nextTotalStock = Math.max(0, Number(product.totalStock || 0) - stockToRemove);
    await tx.product.update({
      where: { id: product.id },
      data: {
        totalStock: nextTotalStock,
        status: mapProductStatus(nextTotalStock, product.minStock),
      },
    });
  }

  if (batch.warehouseId) {
    const warehouseStock = await tx.warehouseStock.findUnique({
      where: {
        warehouseId_productId: {
          warehouseId: batch.warehouseId,
          productId: batch.productId,
        },
      },
    });

    if (warehouseStock) {
      const nextWarehouseQty = Math.max(0, Number(warehouseStock.quantity || 0) - stockToRemove);
      await tx.warehouseStock.update({
        where: {
          warehouseId_productId: {
            warehouseId: batch.warehouseId,
            productId: batch.productId,
          },
        },
        data: { quantity: nextWarehouseQty },
      });
    }
  }

  return stockToRemove;
};

export class InventoryService {
  async listPurchaseInvoices(options: { supplierId?: string; search?: string; page?: number; pageSize?: number } = {}) {
    const page = Math.max(1, Math.floor(Number(options.page || 1)));
    const pageSize = Math.min(200, Math.max(1, Math.floor(Number(options.pageSize || 50))));
    const search = String(options.search || '').trim();

    const where: any = {
      ...(options.supplierId ? { supplierId: options.supplierId } : {}),
      ...(search
        ? {
            OR: [
              { invoiceNumber: { contains: search, mode: 'insensitive' } },
              { supplier: { name: { contains: search, mode: 'insensitive' } } },
              { comment: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [invoices, totalCount] = await Promise.all([
      prisma.purchaseInvoice.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: [{ invoiceDate: 'desc' }, { createdAt: 'desc' }],
        include: {
          supplier: true,
          warehouse: { select: { id: true, name: true } },
          items: {
            select: {
              id: true,
              productId: true,
              batchNumber: true,
              quantity: true,
              purchasePrice: true,
              wholesalePrice: true,
              retailPrice: true,
              lineTotal: true,
              product: { select: { id: true, name: true, sku: true } },
              batches: {
                select: {
                  id: true,
                  quantity: true,
                  initialQty: true,
                  currentQty: true,
                  availableQty: true,
                  expiryDate: true,
                  status: true,
                },
              },
            },
          },
          payments: { select: { amount: true } },
          payables: { select: { remainingAmount: true, status: true, dueDate: true } },
        },
      }),
      prisma.purchaseInvoice.count({ where }),
    ]);

    return {
      items: invoices.map((invoice) => ({
        ...invoice,
        itemCount: invoice.items.length,
        paidAmountTotal: invoice.payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0),
        outstandingAmount: invoice.payables.reduce((sum, payable) => sum + Number(payable.remainingAmount || 0), 0),
      })),
      pagination: {
        page,
        pageSize,
        totalCount,
        pageCount: Math.max(1, Math.ceil(totalCount / pageSize)),
      },
    };
  }

  async getPurchaseInvoice(id: string) {
    if (!id) throw new ValidationError('purchaseInvoiceId is required');

    const invoice = await prisma.purchaseInvoice.findUnique({
      where: { id },
      include: purchaseInvoiceInclude,
    });

    if (!invoice) throw new NotFoundError('Purchase invoice not found');

    return {
      ...invoice,
      paidAmountTotal: invoice.payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0),
      outstandingAmount: invoice.payables.reduce((sum, payable) => sum + Number(payable.remainingAmount || 0), 0),
    };
  }

  async restock(input: RestockItemInput, userId: string) {
    if (!input.productId) throw new ValidationError('productId is required');
    if (!input.batchNumber) throw new ValidationError('batchNumber is required');
    if (!input.quantity || input.quantity <= 0) throw new ValidationError('quantity must be a positive number');

    const result = await prisma.$transaction(async (tx) => {
      const product = await tx.product.findUnique({
        where: { id: input.productId },
      });

      if (!product) throw new NotFoundError(`Product ${input.productId} not found`);

      const warehouse = await tx.warehouse.findFirst({
        where: { isDefault: true },
        orderBy: { createdAt: 'asc' },
      }) ?? await tx.warehouse.findFirst({
        orderBy: { createdAt: 'asc' },
      });

      const batch = await tx.batch.create({
        data: {
          batchNumber: input.batchNumber,
          quantity: input.quantity,
          initialQty: input.quantity,
          currentQty: input.quantity,
          reservedQty: 0,
          availableQty: input.quantity,
          unit: input.unit,
          costBasis: input.costBasis,
          purchasePrice: input.costBasis,
          retailPrice: null,
          supplierId: input.supplierId || null,
          warehouseId: warehouse?.id ?? null,
          manufacturedDate: input.manufacturedDate,
          receivedAt: new Date(),
          expiryDate: input.expiryDate,
          status: getBatchStatus(input.expiryDate),
          productId: input.productId,
        },
      });

      await tx.batchMovement.create({
        data: {
          batchId: batch.id,
          type: 'RESTOCK',
          quantity: input.quantity,
          description: `Manual restock for batch ${input.batchNumber}`,
          userId,
        },
      });

      const newTotalStock = product.totalStock + input.quantity;
      const updatedProduct = await tx.product.update({
        where: { id: product.id },
        data: {
          totalStock: newTotalStock,
          costPrice: input.costBasis || product.costPrice,
          status: mapProductStatus(newTotalStock, product.minStock),
        },
      });

      if (warehouse) {
        await tx.warehouseStock.upsert({
          where: {
            warehouseId_productId: {
              warehouseId: warehouse.id,
              productId: product.id,
            },
          },
          update: {
            quantity: { increment: input.quantity },
          },
          create: {
            warehouseId: warehouse.id,
            productId: product.id,
            quantity: input.quantity,
          },
        });
      }

      await auditService.log({
        userId,
        module: 'inventory',
        action: 'RESTOCK_PRODUCT',
        entity: 'BATCH',
        entityId: batch.id,
        newValue: {
          productId: input.productId,
          batchNumber: input.batchNumber,
          quantity: input.quantity,
          costBasis: input.costBasis,
        },
      });

      return { batch, product: updatedProduct };
    });

    // Invalidate caches after inventory changes
    reportCache.invalidatePattern(/^metrics:/);
    reportCache.invalidatePattern(/^report:/);

    return result;
  }

  async adjustBatchQuantity(batchId: string, newQuantity: number, userId: string, reason?: string) {
    if (!batchId) throw new ValidationError('batchId is required');
    if (!Number.isFinite(newQuantity) || newQuantity < 0) {
      throw new ValidationError('newQuantity must be a non-negative number');
    }

    const result = await prisma.$transaction(async (tx) => {
      const batch = await tx.batch.findUnique({
        where: { id: batchId },
        include: {
          product: {
            select: {
              id: true,
              name: true,
              totalStock: true,
              minStock: true,
            },
          },
        },
      });

      if (!batch) throw new NotFoundError(`Batch ${batchId} not found`);

      const oldQuantity = Number(batch.quantity || 0);
      const reservedQty = Number(batch.reservedQty || 0);
      const normalizedNewQuantity = Math.floor(newQuantity);

      if (normalizedNewQuantity < reservedQty) {
        throw new ValidationError(`newQuantity cannot be less than reserved quantity (${reservedQty})`);
      }

      const delta = normalizedNewQuantity - oldQuantity;
      if (delta === 0) {
        return {
          batch: {
            id: batch.id,
            batchNumber: batch.batchNumber,
            quantity: oldQuantity,
          },
          product: {
            id: batch.product.id,
            totalStock: Number(batch.product.totalStock || 0),
          },
        };
      }

      const availableQty = normalizedNewQuantity - reservedQty;

      const updatedBatch = await tx.batch.update({
        where: { id: batch.id },
        data: {
          quantity: normalizedNewQuantity,
          currentQty: normalizedNewQuantity,
          availableQty,
        },
      });

      await tx.batchMovement.create({
        data: {
          batchId: batch.id,
          type: 'ADJUSTMENT',
          quantity: Math.abs(delta),
          description: reason || `Manual adjustment ${oldQuantity} -> ${normalizedNewQuantity}`,
          userId,
        },
      });

      const newTotalStock = Math.max(0, Number(batch.product.totalStock || 0) + delta);
      const updatedProduct = await tx.product.update({
        where: { id: batch.product.id },
        data: {
          totalStock: newTotalStock,
          status: mapProductStatus(newTotalStock, batch.product.minStock),
        },
      });

      if (batch.warehouseId) {
        const warehouseStockRow = await tx.warehouseStock.findUnique({
          where: {
            warehouseId_productId: {
              warehouseId: batch.warehouseId,
              productId: batch.product.id,
            },
          },
        });

        if (!warehouseStockRow) {
          if (delta < 0) {
            throw new ValidationError('Warehouse stock row is missing for this batch');
          }
          await tx.warehouseStock.create({
            data: {
              warehouseId: batch.warehouseId,
              productId: batch.product.id,
              quantity: delta,
            },
          });
        } else {
          const newWarehouseQty = Number(warehouseStockRow.quantity || 0) + delta;
          if (newWarehouseQty < 0) {
            throw new ValidationError('Warehouse stock cannot become negative');
          }
          await tx.warehouseStock.update({
            where: {
              warehouseId_productId: {
                warehouseId: batch.warehouseId,
                productId: batch.product.id,
              },
            },
            data: {
              quantity: newWarehouseQty,
            },
          });
        }
      }

      await auditService.log({
        userId,
        module: 'inventory',
        action: 'ADJUST_BATCH_QTY',
        entity: 'BATCH',
        entityId: batch.id,
        oldValue: {
          quantity: oldQuantity,
          currentQty: batch.currentQty,
          availableQty: batch.availableQty,
          reservedQty,
        },
        newValue: {
          quantity: normalizedNewQuantity,
          currentQty: normalizedNewQuantity,
          availableQty,
          reservedQty,
          reason: reason || null,
        },
      }, tx);

      return {
        batch: {
          id: updatedBatch.id,
          batchNumber: updatedBatch.batchNumber,
          quantity: updatedBatch.quantity,
        },
        product: {
          id: updatedProduct.id,
          totalStock: updatedProduct.totalStock,
        },
      };
    });

    // Invalidate caches after inventory changes
    reportCache.invalidatePattern(/^metrics:/);
    reportCache.invalidatePattern(/^report:/);

    return result;
  }

  async importPurchaseInvoice(input: PurchaseInvoiceImportInput, userId: string) {
    if (!input.supplierId) throw new ValidationError('supplierId is required');
    if (!String(input.invoiceNumber || '').trim()) throw new ValidationError('invoiceNumber is required');
    if (!input.items.length) throw new ValidationError('At least one purchase item is required');

    const invoiceNumber = String(input.invoiceNumber || '').trim();

    const result = await prisma.$transaction(async (tx) => {
      const supplier = await tx.supplier.findUnique({ where: { id: input.supplierId } });
      if (!supplier) throw new NotFoundError(`Supplier ${input.supplierId} not found`);

      const warehouse = await tx.warehouse.findFirst({
        where: { isDefault: true },
        orderBy: { createdAt: 'asc' },
      }) ?? await tx.warehouse.findFirst({
        orderBy: { createdAt: 'asc' },
      });

      if (!warehouse) throw new ValidationError('No warehouse configured for purchase import');

      const existingInvoice = await tx.purchaseInvoice.findUnique({
        where: { invoiceNumber },
        select: { id: true },
      });

      if (existingInvoice) {
        throw new ValidationError(`Purchase invoice ${invoiceNumber} already exists`);
      }

      const grossTotal = input.items.reduce((sum, item) => sum + (Number(item.costBasis) * Number(item.quantity)), 0);
      const discountAmount = Number(input.discountAmount ?? 0);
      const taxAmount = Number(input.taxAmount ?? 0);
      const totalAmount = Math.max(0, grossTotal - discountAmount + taxAmount);

      const purchaseInvoice = await tx.purchaseInvoice.create({
        data: {
          invoiceNumber,
          supplierId: supplier.id,
          warehouseId: warehouse.id,
          invoiceDate: input.invoiceDate,
          status: 'POSTED',
          totalAmount,
          discountAmount,
          taxAmount,
          paymentStatus: 'UNPAID',
          comment: input.comment || null,
          createdById: userId,
        },
      });

      for (const item of input.items) {
        if (!item.productId) throw new ValidationError('productId is required for each purchase item');
        if (!item.batchNumber) throw new ValidationError('batchNumber is required for each purchase item');
        if (!item.quantity || item.quantity <= 0) throw new ValidationError('quantity must be a positive number');

        const product = await tx.product.findUnique({
          where: { id: item.productId },
        });

        if (!product) throw new NotFoundError(`Product ${item.productId} not found`);

        const purchaseItem = await tx.purchaseInvoiceItem.create({
          data: {
            purchaseInvoiceId: purchaseInvoice.id,
            productId: product.id,
            batchNumber: item.batchNumber,
            manufacturedDate: item.manufacturedDate,
            expiryDate: item.expiryDate,
            quantity: item.quantity,
            purchasePrice: item.costBasis,
            wholesalePrice: item.wholesalePrice ?? null,
            lineTotal: Number(item.costBasis) * Number(item.quantity),
          },
        });

        const batch = await tx.batch.create({
          data: {
            batchNumber: item.batchNumber,
            quantity: item.quantity,
            initialQty: item.quantity,
            currentQty: item.quantity,
            reservedQty: 0,
            availableQty: item.quantity,
            unit: item.unit,
            costBasis: item.costBasis,
            purchasePrice: item.costBasis,
            wholesalePrice: item.wholesalePrice ?? null,
            retailPrice: null,
            supplierId: supplier.id,
            warehouseId: warehouse.id,
            manufacturedDate: item.manufacturedDate,
            receivedAt: input.invoiceDate,
            expiryDate: item.expiryDate,
            status: getBatchStatus(item.expiryDate),
            productId: product.id,
            purchaseItemId: purchaseItem.id,
          },
        });

        await tx.batchMovement.create({
          data: {
            batchId: batch.id,
            type: 'RESTOCK',
            quantity: item.quantity,
            description: `Purchase invoice ${purchaseInvoice.invoiceNumber}`,
            userId,
          },
        });

        await tx.warehouseStock.upsert({
          where: {
            warehouseId_productId: {
              warehouseId: warehouse.id,
              productId: product.id,
            },
          },
          update: {
            quantity: { increment: item.quantity },
          },
          create: {
            warehouseId: warehouse.id,
            productId: product.id,
            quantity: item.quantity,
          },
        });

        const newTotalStock = product.totalStock + item.quantity;
        await tx.product.update({
          where: { id: product.id },
          data: {
            totalStock: newTotalStock,
            costPrice: item.costBasis,
            status: mapProductStatus(newTotalStock, product.minStock),
          },
        });
      }

      await auditService.log({
        userId,
        module: 'inventory',
        action: 'IMPORT_PURCHASE_INVOICE',
        entity: 'PURCHASE_INVOICE',
        entityId: purchaseInvoice.id,
        newValue: {
          invoiceNumber: purchaseInvoice.invoiceNumber,
          supplierId: purchaseInvoice.supplierId,
          itemCount: input.items.length,
          totalAmount,
        },
      }, tx);

      return purchaseInvoice;
    });

    // Invalidate caches after inventory changes
    reportCache.invalidatePattern(/^metrics:/);
    reportCache.invalidatePattern(/^report:/);

    return result;
  }

  async updatePurchaseInvoice(id: string, input: PurchaseInvoiceUpdateInput, userId: string) {
    if (!id) throw new ValidationError('purchaseInvoiceId is required');
    if (!input.supplierId) throw new ValidationError('supplierId is required');
    if (!String(input.invoiceNumber || '').trim()) throw new ValidationError('invoiceNumber is required');
    if (!input.items.length) throw new ValidationError('At least one purchase item is required');

    const invoiceNumber = String(input.invoiceNumber || '').trim();

    const result = await prisma.$transaction(async (tx) => {
      const existingInvoice = await tx.purchaseInvoice.findUnique({
        where: { id },
        include: {
          items: {
            include: {
              product: {
                select: {
                  id: true,
                  name: true,
                  totalStock: true,
                  minStock: true,
                },
              },
              batches: {
                include: {
                  product: {
                    select: {
                      id: true,
                      name: true,
                      totalStock: true,
                      minStock: true,
                    },
                  },
                },
              },
            },
          },
          payments: true,
          payables: true,
        },
      });

      if (!existingInvoice) throw new NotFoundError('Purchase invoice not found');

      const supplier = await tx.supplier.findUnique({ where: { id: input.supplierId } });
      if (!supplier) throw new NotFoundError(`Supplier ${input.supplierId} not found`);

      const invoiceNumberOwner = await tx.purchaseInvoice.findUnique({
        where: { invoiceNumber },
        select: { id: true },
      });

      if (invoiceNumberOwner && invoiceNumberOwner.id !== existingInvoice.id) {
        throw new ValidationError(`Purchase invoice ${invoiceNumber} already exists`);
      }

      const warehouse = await tx.warehouse.findUnique({
        where: { id: existingInvoice.warehouseId },
      }) ?? await tx.warehouse.findFirst({
        where: { isDefault: true },
        orderBy: { createdAt: 'asc' },
      }) ?? await tx.warehouse.findFirst({
        orderBy: { createdAt: 'asc' },
      });

      if (!warehouse) throw new ValidationError('No warehouse configured for purchase invoice update');

      const incomingItems = input.items.map((item) => ({
        id: item.id ? String(item.id) : undefined,
        ...normalizePurchaseItem(item),
      }));

      const existingItemsById = new Map(existingInvoice.items.map((item) => [item.id, item]));
      const incomingIds = new Set(incomingItems.map((item) => item.id).filter(Boolean) as string[]);

      for (const existingItem of existingInvoice.items) {
        if (incomingIds.has(existingItem.id)) continue;

        for (const batch of existingItem.batches) {
          const linkedRecords = await getBatchLinkedUsageCount(tx, batch.id);
          if (linkedRecords > 0) {
            throw new ValidationError(`Cannot remove ${existingItem.product.name}: its batch already has sales or stock operations`);
          }

          const stockToRemove = Math.max(0, Number(batch.quantity || 0));
          await tx.batch.delete({ where: { id: batch.id } });

          const newTotalStock = Math.max(0, Number(batch.product.totalStock || 0) - stockToRemove);
          await tx.product.update({
            where: { id: batch.product.id },
            data: {
              totalStock: newTotalStock,
              status: mapProductStatus(newTotalStock, batch.product.minStock),
            },
          });

          if (batch.warehouseId) {
            const warehouseStock = await tx.warehouseStock.findUnique({
              where: {
                warehouseId_productId: {
                  warehouseId: batch.warehouseId,
                  productId: batch.product.id,
                },
              },
            });

            if (warehouseStock) {
              const nextWarehouseQty = Math.max(0, Number(warehouseStock.quantity || 0) - stockToRemove);
              await tx.warehouseStock.update({
                where: {
                  warehouseId_productId: {
                    warehouseId: batch.warehouseId,
                    productId: batch.product.id,
                  },
                },
                data: { quantity: nextWarehouseQty },
              });
            }
          }
        }

        await tx.purchaseInvoiceItem.delete({ where: { id: existingItem.id } });
      }

      for (const item of incomingItems) {
        const product = await tx.product.findUnique({
          where: { id: item.productId },
        });

        if (!product) throw new NotFoundError(`Product ${item.productId} not found`);

        if (!item.id || !existingItemsById.has(item.id)) {
          const purchaseItem = await tx.purchaseInvoiceItem.create({
            data: {
              purchaseInvoiceId: existingInvoice.id,
              productId: product.id,
              batchNumber: item.batchNumber,
              manufacturedDate: item.manufacturedDate,
              expiryDate: item.expiryDate,
              quantity: item.quantity,
              purchasePrice: item.costBasis,
              wholesalePrice: item.wholesalePrice,
              lineTotal: item.costBasis * item.quantity,
            },
          });

          const batch = await tx.batch.create({
            data: {
              batchNumber: item.batchNumber,
              quantity: item.quantity,
              initialQty: item.quantity,
              currentQty: item.quantity,
              reservedQty: 0,
              availableQty: item.quantity,
              unit: item.unit,
              costBasis: item.costBasis,
              purchasePrice: item.costBasis,
              wholesalePrice: item.wholesalePrice,
              retailPrice: null,
              supplierId: supplier.id,
              warehouseId: warehouse.id,
              manufacturedDate: item.manufacturedDate,
              receivedAt: input.invoiceDate,
              expiryDate: item.expiryDate,
              status: getBatchStatus(item.expiryDate),
              productId: product.id,
              purchaseItemId: purchaseItem.id,
            },
          });

          await tx.batchMovement.create({
            data: {
              batchId: batch.id,
              type: 'RESTOCK',
              quantity: item.quantity,
              description: `Added to purchase invoice ${invoiceNumber}`,
              userId,
            },
          });

          await tx.warehouseStock.upsert({
            where: {
              warehouseId_productId: {
                warehouseId: warehouse.id,
                productId: product.id,
              },
            },
            update: { quantity: { increment: item.quantity } },
            create: {
              warehouseId: warehouse.id,
              productId: product.id,
              quantity: item.quantity,
            },
          });

          const newTotalStock = Number(product.totalStock || 0) + item.quantity;
          await tx.product.update({
            where: { id: product.id },
            data: {
              totalStock: newTotalStock,
              costPrice: item.costBasis,
              status: mapProductStatus(newTotalStock, product.minStock),
            },
          });

          continue;
        }

        const existingItem = existingItemsById.get(item.id)!;
        if (existingItem.productId !== item.productId) {
          throw new ValidationError('Changing product on an existing purchase line is not supported. Remove the line and add a new one before any sales.');
        }

        const batch = existingItem.batches[0];
        const oldQuantity = Number(existingItem.quantity || 0);
        const quantityDelta = item.quantity - oldQuantity;

        if (batch) {
          const usedQuantity = Math.max(0, Number(batch.initialQty || oldQuantity) - Number(batch.currentQty || 0));
          const reservedQty = Number(batch.reservedQty || 0);

          if (item.quantity < usedQuantity) {
            throw new ValidationError(`Cannot reduce ${product.name} below already used quantity (${usedQuantity})`);
          }

          const nextCurrentQty = Number(batch.currentQty || 0) + quantityDelta;
          const nextAvailableQty = nextCurrentQty - reservedQty;

          if (nextCurrentQty < reservedQty || nextAvailableQty < 0) {
            throw new ValidationError(`Cannot reduce ${product.name} below reserved quantity (${reservedQty})`);
          }

          await tx.batch.update({
            where: { id: batch.id },
            data: {
              batchNumber: item.batchNumber,
              quantity: nextCurrentQty,
              initialQty: item.quantity,
              currentQty: nextCurrentQty,
              availableQty: nextAvailableQty,
              unit: item.unit,
              costBasis: item.costBasis,
              purchasePrice: item.costBasis,
              wholesalePrice: item.wholesalePrice,
              supplierId: supplier.id,
              manufacturedDate: item.manufacturedDate,
              receivedAt: input.invoiceDate,
              expiryDate: item.expiryDate,
              status: getBatchStatus(item.expiryDate),
            },
          });

          if (quantityDelta !== 0) {
            await tx.batchMovement.create({
              data: {
                batchId: batch.id,
                type: 'ADJUSTMENT',
                quantity: Math.abs(quantityDelta),
                description: `Purchase invoice edit ${existingInvoice.invoiceNumber}: ${oldQuantity} -> ${item.quantity}`,
                userId,
              },
            });
          }

          if (batch.warehouseId && quantityDelta !== 0) {
            const warehouseStock = await tx.warehouseStock.findUnique({
              where: {
                warehouseId_productId: {
                  warehouseId: batch.warehouseId,
                  productId: product.id,
                },
              },
            });

            if (!warehouseStock && quantityDelta < 0) {
              throw new ValidationError('Warehouse stock row is missing for this purchase line');
            }

            if (warehouseStock) {
              const nextWarehouseQty = Number(warehouseStock.quantity || 0) + quantityDelta;
              if (nextWarehouseQty < 0) {
                throw new ValidationError('Warehouse stock cannot become negative');
              }
              await tx.warehouseStock.update({
                where: {
                  warehouseId_productId: {
                    warehouseId: batch.warehouseId,
                    productId: product.id,
                  },
                },
                data: { quantity: nextWarehouseQty },
              });
            } else {
              await tx.warehouseStock.create({
                data: {
                  warehouseId: batch.warehouseId,
                  productId: product.id,
                  quantity: quantityDelta,
                },
              });
            }
          }
        }

        await tx.purchaseInvoiceItem.update({
          where: { id: existingItem.id },
          data: {
            batchNumber: item.batchNumber,
            manufacturedDate: item.manufacturedDate,
            expiryDate: item.expiryDate,
            quantity: item.quantity,
            purchasePrice: item.costBasis,
            wholesalePrice: item.wholesalePrice,
            lineTotal: item.costBasis * item.quantity,
          },
        });

        if (quantityDelta !== 0 || Number(product.costPrice || 0) !== item.costBasis) {
          const newTotalStock = Math.max(0, Number(product.totalStock || 0) + quantityDelta);
          await tx.product.update({
            where: { id: product.id },
            data: {
              totalStock: newTotalStock,
              costPrice: item.costBasis,
              status: mapProductStatus(newTotalStock, product.minStock),
            },
          });
        }
      }

      const grossTotal = incomingItems.reduce((sum, item) => sum + item.costBasis * item.quantity, 0);
      const discountAmount = Number(input.discountAmount ?? 0);
      const taxAmount = Number(input.taxAmount ?? 0);
      const totalAmount = Math.max(0, grossTotal - discountAmount + taxAmount);
      const paidAmount = existingInvoice.payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
      const nextPaymentStatus = paidAmount >= totalAmount
        ? 'PAID'
        : paidAmount > 0
          ? 'PARTIALLY_PAID'
          : 'UNPAID';

      const updatedInvoice = await tx.purchaseInvoice.update({
        where: { id: existingInvoice.id },
        data: {
          invoiceNumber,
          supplierId: supplier.id,
          warehouseId: warehouse.id,
          invoiceDate: input.invoiceDate,
          totalAmount,
          discountAmount,
          taxAmount,
          paymentStatus: nextPaymentStatus,
          comment: input.comment || null,
        },
        include: purchaseInvoiceInclude,
      });

      await tx.payable.updateMany({
        where: { purchaseInvoiceId: existingInvoice.id },
        data: {
          supplierId: supplier.id,
          originalAmount: totalAmount,
          paidAmount,
          remainingAmount: Math.max(0, totalAmount - paidAmount),
          status: totalAmount - paidAmount <= 0 ? 'PAID' : paidAmount > 0 ? 'PARTIAL' : 'OPEN',
        },
      });

      await auditService.log({
        userId,
        module: 'inventory',
        action: 'UPDATE_PURCHASE_INVOICE',
        entity: 'PURCHASE_INVOICE',
        entityId: updatedInvoice.id,
        oldValue: {
          invoiceNumber: existingInvoice.invoiceNumber,
          supplierId: existingInvoice.supplierId,
          totalAmount: existingInvoice.totalAmount,
          itemCount: existingInvoice.items.length,
        },
        newValue: {
          invoiceNumber: updatedInvoice.invoiceNumber,
          supplierId: updatedInvoice.supplierId,
          totalAmount,
          itemCount: incomingItems.length,
        },
      }, tx);

      return updatedInvoice;
    }, {
      maxWait: 10000,
      timeout: 30000,
    });

    reportCache.invalidatePattern(/^metrics:/);
    reportCache.invalidatePattern(/^report:/);

    return result;
  }

  async editBatch(
    batchId: string,
    updates: {
      costBasis?: number;
      quantity?: number;
    },
    userId: string,
  ) {
    if (!batchId) throw new ValidationError('batchId is required');
    if (Object.keys(updates).length === 0) throw new ValidationError('At least one field must be updated');

    const result = await prisma.$transaction(async (tx) => {
      const batch = await tx.batch.findUnique({
        where: { id: batchId },
        include: {
          product: {
            select: {
              id: true,
              name: true,
              totalStock: true,
              minStock: true,
            },
          },
        },
      });

      if (!batch) throw new NotFoundError(`Batch ${batchId} not found`);

      const updateData: any = {};

      if (updates.costBasis !== undefined) {
        updateData.costBasis = updates.costBasis;
        updateData.purchasePrice = updates.costBasis;
      }

      let quantityDelta = 0;
      if (updates.quantity !== undefined) {
        const normalizedNewQuantity = Math.floor(updates.quantity);
        const reservedQty = Number(batch.reservedQty || 0);

        if (normalizedNewQuantity < reservedQty) {
          throw new ValidationError(`Quantity cannot be less than reserved quantity (${reservedQty})`);
        }

        quantityDelta = normalizedNewQuantity - Number(batch.quantity || 0);
        if (quantityDelta !== 0) {
          const availableQty = normalizedNewQuantity - reservedQty;
          updateData.quantity = normalizedNewQuantity;
          updateData.currentQty = normalizedNewQuantity;
          updateData.availableQty = availableQty;
        }
      }

      const updatedBatch = await tx.batch.update({
        where: { id: batchId },
        data: updateData,
      });

      // Create audit log entry for the edit
      if (quantityDelta !== 0) {
        await tx.batchMovement.create({
          data: {
            batchId: batch.id,
            type: 'ADJUSTMENT',
            quantity: Math.abs(quantityDelta),
            description: `Manual edit: quantity ${Number(batch.quantity)} -> ${updates.quantity}`,
            userId,
          },
        });
      }

      // Update product if costBasis changed
      const productUpdateData: any = {};
      if (updates.costBasis !== undefined) {
        productUpdateData.costPrice = updates.costBasis;
      }

      // Update product total stock if quantity changed
      if (quantityDelta !== 0) {
        const newTotalStock = Math.max(0, Number(batch.product.totalStock || 0) + quantityDelta);
        productUpdateData.totalStock = newTotalStock;
        productUpdateData.status = mapProductStatus(newTotalStock, batch.product.minStock);
      }

      const updatedProduct =
        Object.keys(productUpdateData).length > 0
          ? await tx.product.update({
              where: { id: batch.product.id },
              data: productUpdateData,
            })
          : batch.product;

      // Update warehouse stock if quantity changed
      if (quantityDelta !== 0 && batch.warehouseId) {
        const warehouseStockRow = await tx.warehouseStock.findUnique({
          where: {
            warehouseId_productId: {
              warehouseId: batch.warehouseId,
              productId: batch.product.id,
            },
          },
        });

        if (warehouseStockRow) {
          const newWarehouseQty = Number(warehouseStockRow.quantity || 0) + quantityDelta;
          if (newWarehouseQty < 0) {
            throw new ValidationError('Warehouse stock cannot become negative');
          }
          await tx.warehouseStock.update({
            where: {
              warehouseId_productId: {
                warehouseId: batch.warehouseId,
                productId: batch.product.id,
              },
            },
            data: {
              quantity: newWarehouseQty,
            },
          });
        }
      }

      await auditService.log({
        userId,
        module: 'inventory',
        action: 'EDIT_BATCH',
        entity: 'BATCH',
        entityId: batch.id,
        oldValue: {
          costBasis: batch.costBasis,
          quantity: batch.quantity,
        },
        newValue: {
          costBasis: updates.costBasis ?? batch.costBasis,
          quantity: updates.quantity ?? batch.quantity,
        },
      }, tx);

      return {
        batch: updatedBatch,
        product: updatedProduct,
      };
    });

    // Invalidate caches after inventory changes
    reportCache.invalidatePattern(/^metrics:/);
    reportCache.invalidatePattern(/^report:/);

    return result;
  }

  async deleteBatch(batchId: string, userId: string) {
    if (!batchId) throw new ValidationError('batchId is required');

    const result = await prisma.$transaction(async (tx) => {
      const batch = await tx.batch.findUnique({
        where: { id: batchId },
        include: {
          product: {
            select: {
              id: true,
              name: true,
              totalStock: true,
              minStock: true,
            },
          },
        },
      });

      if (!batch) throw new NotFoundError(`Batch ${batchId} not found`);

      const [linkedInvoiceItems, linkedReservations, linkedReturns, linkedWriteOffs, linkedTransfers] = await Promise.all([
        tx.invoiceItem.count({ where: { batchId } }),
        tx.reservation.count({ where: { batchId } }),
        tx.returnItem.count({ where: { batchId } }),
        tx.writeOffItem.count({ where: { batchId } }),
        tx.stockTransferItem.count({ where: { batchId } }),
      ]);

      const linkedRecords = linkedInvoiceItems + linkedReservations + linkedReturns + linkedWriteOffs + linkedTransfers;
      if (linkedRecords > 0) {
        throw new ValidationError('Cannot delete batch that already has sales, reservations, returns, write-offs, or transfers');
      }

      const stockToRemove = Math.max(0, Number(batch.currentQty ?? batch.quantity ?? 0));

      await tx.batch.delete({ where: { id: batchId } });

      const newTotalStock = Math.max(0, Number(batch.product.totalStock) - stockToRemove);
      await tx.product.update({
        where: { id: batch.product.id },
        data: {
          totalStock: newTotalStock,
          status: mapProductStatus(newTotalStock, batch.product.minStock),
        },
      });

      if (batch.warehouseId) {
        await tx.warehouseStock.updateMany({
          where: {
            warehouseId: batch.warehouseId,
            productId: batch.product.id,
          },
          data: {
            quantity: {
              decrement: stockToRemove,
            },
          },
        });
      }

      await auditService.log({
        userId,
        module: 'inventory',
        action: 'DELETE_BATCH',
        entity: 'BATCH',
        entityId: batch.id,
        oldValue: {
          productId: batch.product.id,
          productName: batch.product.name,
          batchNumber: batch.batchNumber,
          quantity: batch.quantity,
          currentQty: batch.currentQty,
        },
        newValue: null,
      }, tx);

      return {
        id: batch.id,
        batchNumber: batch.batchNumber,
        productId: batch.product.id,
        productName: batch.product.name,
      };
    });

    // Invalidate caches after inventory changes
    reportCache.invalidatePattern(/^metrics:/);
    reportCache.invalidatePattern(/^report:/);

    return result;
  }
}

export const inventoryService = new InventoryService();
