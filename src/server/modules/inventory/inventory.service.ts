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

export class InventoryService {
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
