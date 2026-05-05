import { db } from '../../infrastructure/prisma';
import { auditService } from '../../services/audit.service';
import { NotFoundError, ValidationError } from '../../common/errors';
import { reportCache } from '../../common/cache';
import { computeBatchStatus } from '../../common/batchStatus';
import { round } from '../../common/utils';

export type RestockItemInput = {
  productId: string;
  batchNumber: string;
  quantity: number;
  unit: string;
  costBasis: number;
  supplierId?: string | null;
  manufacturedDate: Date;
  expiryDate: Date;
  countryOfOrigin?: string | null;
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
  countryOfOrigin?: string | null;
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
    if (!input.supplierId) throw new ValidationError('supplierId is required');

    const result = await db.$transaction(async (tx: any) => {
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

      if (!warehouse) throw new ValidationError('No warehouse configured for manual restock');

      const invoiceNumber = `MAN-${Date.now()}`;
      const totalAmount = round(Number(input.costBasis) * Number(input.quantity));

      const purchaseInvoice = await tx.purchaseInvoice.create({
        data: {
          invoiceNumber,
          supplierId: input.supplierId,
          warehouseId: warehouse.id,
          invoiceDate: new Date(),
          status: 'POSTED',
          totalAmount,
          discountAmount: 0,
          taxAmount: 0,
          paymentStatus: 'PAID',
          comment: `Manual restock: ${input.batchNumber}`,
          createdById: userId,
        },
      });

      await this._processPurchaseItem(tx, purchaseInvoice, input, input.supplierId, warehouse.id, userId);

      const updatedBatch = await tx.batch.findFirst({
        where: { batchNumber: input.batchNumber, productId: input.productId },
        orderBy: { createdAt: 'desc' }
      });

      await auditService.log({
        userId,
        module: 'inventory',
        action: 'RESTOCK_PRODUCT',
        entity: 'BATCH',
        entityId: updatedBatch?.id || input.batchNumber,
        newValue: {
          productId: input.productId,
          batchNumber: input.batchNumber,
          quantity: input.quantity,
          costBasis: input.costBasis,
          invoiceId: purchaseInvoice.id
        },
      });

      return { batch: updatedBatch, product: await tx.product.findUnique({ where: { id: product.id } }) };
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

    const result = await db.$transaction(async (tx: any) => {
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

  async deletePurchaseInvoice(invoiceId: string, userId: string) {
    if (!invoiceId) throw new ValidationError('invoiceId is required');

    const result = await db.$transaction(async (tx: any) => {
      const invoice = await tx.purchaseInvoice.findUnique({
        where: { id: invoiceId },
        include: {
          items: {
            include: {
              batches: true
            }
          }
        }
      });

      if (!invoice) throw new NotFoundError(`Purchase invoice ${invoiceId} not found`);

      // If POSTED, we must roll back stock
      if (invoice.status === 'POSTED') {
        for (const item of invoice.items) {
          for (const batch of item.batches) {
            // Check if any stock from this batch was sold
            const soldQty = Number(batch.initialQty) - Number(batch.currentQty);
            if (soldQty > 0) {
              throw new ValidationError(`Cannot delete invoice: ${item.batchNumber} has sales or movements (${soldQty} units sold)`);
            }

            // Roll back stock in Product
            await tx.product.update({
              where: { id: item.productId },
              data: {
                totalStock: { decrement: batch.quantity }
              }
            });

            // Roll back warehouse stock
            if (batch.warehouseId) {
              await tx.warehouseStock.update({
                where: {
                  warehouseId_productId: {
                    warehouseId: batch.warehouseId,
                    productId: item.productId
                  }
                },
                data: {
                  quantity: { decrement: batch.quantity }
                }
              });
            }

            // Delete batch movements
            await tx.batchMovement.deleteMany({
              where: { batchId: batch.id }
            });

            // Delete the batch itself
            await tx.batch.delete({ where: { id: batch.id } });
          }
        }

        // Delete associated Payable
        await tx.payable.deleteMany({
          where: { purchaseInvoiceId: invoiceId }
        });
      }

      // Delete items
      await tx.purchaseInvoiceItem.deleteMany({
        where: { purchaseInvoiceId: invoiceId }
      });

      // Delete the invoice
      await tx.purchaseInvoice.delete({ where: { id: invoiceId } });

      await auditService.log({
        userId,
        module: 'inventory',
        action: 'DELETE_PURCHASE_INVOICE',
        entity: 'PURCHASE_INVOICE',
        entityId: invoiceId,
        oldValue: {
          invoiceNumber: invoice.invoiceNumber,
          status: invoice.status,
          totalAmount: invoice.totalAmount
        },
        newValue: null
      }, tx);

      return { id: invoiceId, success: true };
    });

    reportCache.invalidatePattern(/^metrics:/);
    reportCache.invalidatePattern(/^report:/);

    return result;
  }

  async importPurchaseInvoice(input: PurchaseInvoiceImportInput, userId: string) {
    if (!input.supplierId) throw new ValidationError('supplierId is required');
    if (!String(input.invoiceNumber || '').trim()) throw new ValidationError('invoiceNumber is required');
    if (!input.items.length) throw new ValidationError('At least one purchase item is required');

    const invoiceNumber = String(input.invoiceNumber || '').trim();

    const result = await db.$transaction(async (tx: any) => {
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

      const grossTotal = round(input.items.reduce((sum, item) => sum + (Number(item.costBasis) * Number(item.quantity)), 0));
      const discountAmount = round(input.discountAmount ?? 0);
      const taxAmount = round(input.taxAmount ?? 0);
      const totalAmount = round(Math.max(0, grossTotal - discountAmount + taxAmount));

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

    const result = await db.$transaction(async (tx: any) => {
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

    const result = await db.$transaction(async (tx: any) => {
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
        countryOfOrigin: item.countryOfOrigin || null,
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
        countryOfOrigin: item.countryOfOrigin || null,
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
    return await db.$transaction(async (tx: any) => {
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

  async updatePurchaseInvoice(invoiceId: string, input: PurchaseInvoiceImportInput, userId: string) {
    if (!invoiceId) throw new ValidationError('invoiceId is required');
    if (!input.supplierId) throw new ValidationError('supplierId is required');
    if (!input.items.length) throw new ValidationError('At least one item is required');

    const result = await db.$transaction(async (tx: any) => {
      const oldInvoice = await tx.purchaseInvoice.findUnique({
        where: { id: invoiceId },
        include: {
          items: {
            include: {
              batches: true
            }
          }
        }
      });

      if (!oldInvoice) throw new NotFoundError('Purchase invoice not found');

      // If it was POSTED, we need to handle stock changes carefully.
      // Easiest is to roll back and re-apply if NOTHING WAS SOLD.
      if (oldInvoice.status === 'POSTED') {
        for (const item of oldInvoice.items) {
          for (const batch of item.batches) {
            const soldQty = Number(batch.initialQty) - Number(batch.currentQty);
            if (soldQty > 0) {
              throw new ValidationError(`Cannot edit POSTED invoice: ${item.batchNumber} has sales (${soldQty} units sold)`);
            }
            
            // Roll back
            await tx.product.update({
              where: { id: item.productId },
              data: { totalStock: { decrement: batch.quantity } }
            });

            if (batch.warehouseId) {
               await tx.warehouseStock.update({
                 where: { warehouseId_productId: { warehouseId: batch.warehouseId, productId: item.productId } },
                 data: { quantity: { decrement: batch.quantity } }
               });
            }

            await tx.batchMovement.deleteMany({ where: { batchId: batch.id } });
            await tx.batch.delete({ where: { id: batch.id } });
          }
        }
        
        // Delete Payable
        await tx.payable.deleteMany({ where: { purchaseInvoiceId: invoiceId } });
      }

      // Delete old items
      await tx.purchaseInvoiceItem.deleteMany({ where: { purchaseInvoiceId: invoiceId } });

      // Update invoice metadata
      const grossTotal = round(input.items.reduce((sum, item) => sum + (Number(item.costBasis) * Number(item.quantity)), 0));
      const discountAmount = round(input.discountAmount ?? 0);
      const taxAmount = round(input.taxAmount ?? 0);
      const totalAmount = round(Math.max(0, grossTotal - discountAmount + taxAmount));

      const updatedInvoice = await tx.purchaseInvoice.update({
        where: { id: invoiceId },
        data: {
          supplierId: input.supplierId,
          invoiceNumber: input.invoiceNumber,
          invoiceDate: input.invoiceDate,
          totalAmount,
          discountAmount,
          taxAmount,
          comment: input.comment || null,
          status: input.status === 'POSTED' ? 'POSTED' : 'DRAFT',
        },
      });

      // Re-process items
      if (updatedInvoice.status === 'POSTED') {
        for (const item of input.items) {
          await this._processPurchaseItem(tx, updatedInvoice, item, updatedInvoice.supplierId, updatedInvoice.warehouseId, userId);
        }
        
        // Re-create Payable
        if (updatedInvoice.totalAmount > 0) {
          await tx.payable.create({
            data: {
              supplierId: updatedInvoice.supplierId,
              purchaseInvoiceId: updatedInvoice.id,
              originalAmount: updatedInvoice.totalAmount,
              paidAmount: 0,
              remainingAmount: updatedInvoice.totalAmount,
              status: 'OPEN',
            },
          });
        }
      } else {
        for (const item of input.items) {
          await tx.purchaseInvoiceItem.create({
            data: {
              purchaseInvoiceId: updatedInvoice.id,
              productId: item.productId,
              batchNumber: item.batchNumber,
              manufacturedDate: item.manufacturedDate,
              expiryDate: item.expiryDate,
              countryOfOrigin: item.countryOfOrigin || null,
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
        action: 'UPDATE_PURCHASE_INVOICE',
        entity: 'PURCHASE_INVOICE',
        entityId: invoiceId,
        oldValue: { invoiceNumber: oldInvoice.invoiceNumber, status: oldInvoice.status },
        newValue: { invoiceNumber: updatedInvoice.invoiceNumber, status: updatedInvoice.status }
      }, tx);

      return updatedInvoice;
    });

    reportCache.invalidatePattern(/^metrics:/);
    reportCache.invalidatePattern(/^report:/);

    return result;
  }
  async recalculateTotalStock(productId: string) {
    if (!productId) throw new ValidationError('productId is required');

    return await db.$transaction(async (tx: any) => {
      // 1. Sum up all non-expired batches for this product across all warehouses
      const batchStats = await tx.batch.aggregate({
        where: { productId },
        _sum: {
          quantity: true,
        }
      });

      const totalQuantity = Number(batchStats._sum.quantity || 0);

      // 2. Update Product.totalStock
      const product = await tx.product.findUnique({
        where: { id: productId },
        select: { minStock: true }
      });

      if (!product) throw new NotFoundError('Product not found');

      const updatedProduct = await tx.product.update({
        where: { id: productId },
        data: {
          totalStock: totalQuantity,
          status: mapProductStatus(totalQuantity, product.minStock)
        }
      });

      // 3. Recalculate WarehouseStock per warehouse
      const warehouseBatches = await tx.batch.groupBy({
        by: ['warehouseId'],
        where: { productId, NOT: { warehouseId: null } },
        _sum: { quantity: true }
      });

      for (const group of warehouseBatches) {
        if (!group.warehouseId) continue;
        await tx.warehouseStock.upsert({
          where: {
            warehouseId_productId: {
              warehouseId: group.warehouseId,
              productId: productId
            }
          },
          update: { quantity: Number(group._sum.quantity || 0) },
          create: {
            warehouseId: group.warehouseId,
            productId: productId,
            quantity: Number(group._sum.quantity || 0)
          }
        });
      }

      return updatedProduct;
    });
  }
}

export const inventoryService = new InventoryService();

