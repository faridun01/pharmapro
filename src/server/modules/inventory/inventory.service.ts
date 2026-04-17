import { prisma } from '../../infrastructure/prisma';
import { auditService } from '../../services/audit.service';
import { NotFoundError, ValidationError } from '../../common/errors';
import { reportCache } from '../../common/cache';
import { computeBatchStatus } from '../../common/batchStatus';

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
  status?: 'DRAFT' | 'POSTED';
  items: PurchaseInvoiceImportItemInput[];
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
          status: computeBatchStatus(input.expiryDate),
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

      const updatedProduct = await tx.product.update({
        where: { id: product.id },
        data: {
          totalStock: { increment: input.quantity },
          costPrice: input.costBasis || product.costPrice,
        },
      });

      await tx.product.update({
        where: { id: product.id },
        data: {
          status: mapProductStatus(updatedProduct.totalStock, product.minStock),
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

      const updatedProduct = await tx.product.update({
        where: { id: batch.product.id },
        data: {
          totalStock: { increment: delta },
        },
      });

      await tx.product.update({
        where: { id: batch.product.id },
        data: {
          status: mapProductStatus(updatedProduct.totalStock, batch.product.minStock),
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
          status: input.status === 'POSTED' ? 'POSTED' : 'DRAFT',
          totalAmount,
          discountAmount,
          taxAmount,
          paymentStatus: 'UNPAID',
          comment: input.comment || null,
          createdById: userId,
        },
      });

      if (purchaseInvoice.status === 'POSTED') {
        for (const item of input.items) {
           await this._processPurchaseItem(tx, purchaseInvoice, item, supplier.id, warehouse.id, userId);
        }
      } else {
        // Just create items in WAIT state or similar
        for (const item of input.items) {
          await tx.purchaseInvoiceItem.create({
            data: {
              purchaseInvoiceId: purchaseInvoice.id,
              productId: item.productId,
              batchNumber: item.batchNumber,
              manufacturedDate: item.manufacturedDate,
              expiryDate: item.expiryDate,
              quantity: item.quantity,
              purchasePrice: item.costBasis,
              wholesalePrice: item.wholesalePrice ?? null,
              lineTotal: Number(item.costBasis) * Number(item.quantity),
            },
          });
        }
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
        const updatedProduct = await tx.product.update({
          where: { id: batch.product.id },
          data: {
            totalStock: { increment: quantityDelta },
          },
        });
        productUpdateData.status = mapProductStatus(updatedProduct.totalStock, batch.product.minStock);
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
        (tx as any).reservation.count({ where: { batchId } }),
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

      const updatedProduct = await tx.product.update({
        where: { id: batch.product.id },
        data: {
          totalStock: { decrement: stockToRemove },
        },
      });

      await tx.product.update({
        where: { id: batch.product.id },
        data: {
          status: mapProductStatus(updatedProduct.totalStock, batch.product.minStock),
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

  async _processPurchaseItem(tx: any, invoice: any, item: any, supplierId: string, warehouseId: string, userId: string) {
    const product = await tx.product.findUnique({ where: { id: item.productId } });
    if (!product) throw new NotFoundError(`Product ${item.productId} not found`);

    // Normalize price: might be costBasis (from manual input) or purchasePrice (from DB record)
    const rawPrice = item.costBasis ?? item.purchasePrice ?? 0;
    const price = Number.isFinite(Number(rawPrice)) ? Number(rawPrice) : 0;
    const qty = Number(item.quantity) || 0;
    const batchNo = String(item.batchNumber || 'MISSING');

    const purchaseItem = await tx.purchaseInvoiceItem.findFirst({
        where: { purchaseInvoiceId: invoice.id, productId: product.id, batchNumber: batchNo }
    }) || await tx.purchaseInvoiceItem.create({
      data: {
        purchaseInvoiceId: invoice.id,
        productId: product.id,
        batchNumber: batchNo,
        manufacturedDate: item.manufacturedDate || new Date(),
        expiryDate: item.expiryDate || new Date(),
        quantity: qty,
        purchasePrice: price,
        wholesalePrice: Number(item.wholesalePrice) || null,
        lineTotal: price * qty,
      },
    });

    const batch = await tx.batch.create({
      data: {
        batchNumber: batchNo,
        quantity: qty,
        initialQty: qty,
        currentQty: qty,
        reservedQty: 0,
        availableQty: qty,
        unit: String(item.unit || 'units'),
        costBasis: price,
        purchasePrice: price,
        wholesalePrice: Number(item.wholesalePrice) || null,
        retailPrice: null,
        supplierId,
        warehouseId,
        manufacturedDate: item.manufacturedDate || new Date(),
        receivedAt: invoice.invoiceDate || new Date(),
        expiryDate: item.expiryDate || new Date(),
        status: computeBatchStatus(item.expiryDate),
        productId: product.id,
        purchaseItemId: purchaseItem.id,
      },
    });

    await tx.batchMovement.create({
      data: {
        batchId: batch.id,
        type: 'RESTOCK',
        quantity: qty,
        description: `Purchase invoice ${invoice.invoiceNumber}`,
        userId,
      },
    });

    await tx.warehouseStock.upsert({
      where: { warehouseId_productId: { warehouseId, productId: product.id } },
      update: { quantity: { increment: item.quantity } },
      create: { warehouseId, productId: product.id, quantity: item.quantity },
    });

    const updatedProduct = await tx.product.update({
      where: { id: product.id },
      data: {
        totalStock: { increment: item.quantity },
        costPrice: price,
      },
    });

    await tx.product.update({
      where: { id: product.id },
      data: {
        status: mapProductStatus(updatedProduct.totalStock, product.minStock),
      },
    });
  }

  async approvePurchaseInvoice(invoiceId: string, userId: string) {
    return await prisma.$transaction(async (tx) => {
      const invoice = await tx.purchaseInvoice.findUnique({
        where: { id: invoiceId },
        include: { items: true },
      });
      if (!invoice) throw new NotFoundError('Invoice not found');
      if (invoice.status === 'POSTED') throw new ValidationError('Invoice already posted');

      for (const item of invoice.items) {
        await this._processPurchaseItem(tx, invoice, item, invoice.supplierId, invoice.warehouseId, userId);
      }

      const updated = await tx.purchaseInvoice.update({
        where: { id: invoiceId },
        data: { status: 'POSTED' },
      });

      // Create Payable entry for supplier debt tracking
      if (invoice.totalAmount > 0) {
        await tx.payable.create({
          data: {
            supplierId: invoice.supplierId,
            purchaseInvoiceId: invoice.id,
            originalAmount: invoice.totalAmount,
            paidAmount: 0,
            remainingAmount: invoice.totalAmount,
            status: 'OPEN',
            dueDate: null, // Could be calculated based on supplier terms
          },
        });
      }

      await auditService.log({
        userId,
        module: 'inventory',
        action: 'APPROVE_PURCHASE_INVOICE',
        entity: 'PURCHASE_INVOICE',
        entityId: invoiceId,
        newValue: { invoiceNumber: invoice.invoiceNumber },
      }, tx);

      return updated;
    });
  }
}

export const inventoryService = new InventoryService();
