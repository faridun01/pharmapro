import { db } from '../../infrastructure/prisma';
import { auditService } from '../../services/audit.service';
import { NotFoundError, ValidationError } from '../../common/errors';
import { computeBatchStatus } from '../../common/batchStatus';

export type CreateTransferItemInput = {
  productId: string;
  batchId?: string;
  quantity: number;
};

export type CreateTransferInput = {
  fromWarehouseId: string;
  toWarehouseId: string;
  reason?: string;
  items: CreateTransferItemInput[];
  userId: string;
};

const buildTransferNo = () => {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
  const suffix = Math.floor(1000 + Math.random() * 9000);
  return `TRF-${dateStr}-${suffix}`;
};

export class TransfersService {
  async createTransfer(input: CreateTransferInput) {
    if (input.fromWarehouseId === input.toWarehouseId) {
      throw new ValidationError('Source and destination warehouses must be different');
    }
    if (!input.items || input.items.length === 0) {
      throw new ValidationError('At least one item is required for stock transfer');
    }

    // Verify warehouses exist
    const [fromWh, toWh] = await Promise.all([
      db.warehouse.findUnique({ where: { id: input.fromWarehouseId } }),
      db.warehouse.findUnique({ where: { id: input.toWarehouseId } }),
    ]);

    if (!fromWh) throw new NotFoundError('Source warehouse not found');
    if (!toWh) throw new NotFoundError('Destination warehouse not found');

    return await db.$transaction(async (tx: any) => {
      const transferItems = [];

      for (const item of input.items) {
        if (!item.productId) throw new ValidationError('productId is required for all transfer items');
        if (!item.quantity || item.quantity <= 0) throw new ValidationError('item quantity must be positive');

        const product = await tx.product.findUnique({
          where: { id: item.productId },
          select: { id: true, name: true, totalStock: true },
        });
        if (!product) throw new NotFoundError(`Product ${item.productId} not found`);

        if (item.batchId) {
          const batch = await tx.batch.findUnique({
            where: { id: item.batchId },
          });
          if (!batch) throw new NotFoundError(`Batch ${item.batchId} not found`);
          if (batch.quantity < item.quantity) {
            throw new ValidationError(`Insufficient stock in batch ${batch.batchNumber} (available: ${batch.quantity}, requested: ${item.quantity})`);
          }
        }

        transferItems.push({
          productId: item.productId,
          batchId: item.batchId || null,
          quantity: item.quantity,
        });
      }

      const transfer = await tx.stockTransfer.create({
        data: {
          transferNo: buildTransferNo(),
          fromWarehouseId: input.fromWarehouseId,
          toWarehouseId: input.toWarehouseId,
          status: 'IN_TRANSIT',
          reason: input.reason || null,
          createdById: input.userId,
          items: {
            create: transferItems,
          },
        },
        include: {
          items: {
            include: {
              product: { select: { id: true, name: true, sku: true } },
              batch: { select: { id: true, batchNumber: true, expiryDate: true } },
            },
          },
          fromWarehouse: { select: { id: true, name: true, code: true } },
          toWarehouse: { select: { id: true, name: true, code: true } },
          createdBy: { select: { id: true, name: true, username: true } },
        },
      });

      await auditService.log({
        userId: input.userId,
        module: 'transfers',
        action: 'CREATE_TRANSFER',
        entity: 'STOCK_TRANSFER',
        entityId: transfer.id,
        newValue: {
          transferNo: transfer.transferNo,
          fromWarehouse: fromWh.name,
          toWarehouse: toWh.name,
          itemCount: transfer.items.length,
        },
      }, tx);

      return transfer;
    });
  }

  async receiveTransfer(transferId: string, userId: string) {
    const transfer = await db.stockTransfer.findUnique({
      where: { id: transferId },
      include: {
        items: {
          include: {
            product: true,
            batch: true,
          },
        },
        fromWarehouse: true,
        toWarehouse: true,
      },
    });

    if (!transfer) throw new NotFoundError('Stock transfer record not found');
    if (transfer.status === 'RECEIVED') throw new ValidationError('Transfer is already completed');
    if (transfer.status === 'CANCELLED') throw new ValidationError('Cannot receive a cancelled transfer');

    return await db.$transaction(async (tx: any) => {
      for (const item of transfer.items) {
        let sourceBatch = item.batch;

        if (!sourceBatch) {
          sourceBatch = await tx.batch.findFirst({
            where: {
              productId: item.productId,
              warehouseId: transfer.fromWarehouseId,
              quantity: { gte: item.quantity },
            },
            orderBy: { expiryDate: 'asc' },
          });
        }

        if (sourceBatch) {
          // Deduct from source batch
          await tx.batch.update({
            where: { id: sourceBatch.id },
            data: {
              quantity: { decrement: item.quantity },
              currentQty: { decrement: item.quantity },
              availableQty: { decrement: item.quantity },
              status: computeBatchStatus(sourceBatch.expiryDate),
            },
          });

          await tx.batchMovement.create({
            data: {
              batchId: sourceBatch.id,
              type: 'TRANSFER_OUT',
              quantity: item.quantity,
              description: `Transfer OUT to ${transfer.toWarehouse.name} (${transfer.transferNo})`,
              userId,
            },
          });

          // Check if target warehouse already has a batch with the same batch number
          let destBatch = await tx.batch.findFirst({
            where: {
              productId: item.productId,
              warehouseId: transfer.toWarehouseId,
              batchNumber: sourceBatch.batchNumber,
            },
          });

          if (destBatch) {
            await tx.batch.update({
              where: { id: destBatch.id },
              data: {
                quantity: { increment: item.quantity },
                currentQty: { increment: item.quantity },
                availableQty: { increment: item.quantity },
              },
            });
          } else {
            destBatch = await tx.batch.create({
              data: {
                batchNumber: sourceBatch.batchNumber,
                quantity: item.quantity,
                initialQty: item.quantity,
                currentQty: item.quantity,
                availableQty: item.quantity,
                unit: sourceBatch.unit,
                costBasis: sourceBatch.costBasis,
                purchasePrice: sourceBatch.purchasePrice,
                wholesalePrice: sourceBatch.wholesalePrice,
                retailPrice: sourceBatch.retailPrice,
                manufacturedDate: sourceBatch.manufacturedDate,
                expiryDate: sourceBatch.expiryDate,
                status: computeBatchStatus(sourceBatch.expiryDate),
                productId: item.productId,
                warehouseId: transfer.toWarehouseId,
                supplierId: sourceBatch.supplierId,
              },
            });
          }

          await tx.batchMovement.create({
            data: {
              batchId: destBatch.id,
              type: 'TRANSFER_IN',
              quantity: item.quantity,
              description: `Transfer IN from ${transfer.fromWarehouse.name} (${transfer.transferNo})`,
              userId,
            },
          });
        }

        // Update warehouseStock for source and target
        await tx.warehouseStock.upsert({
          where: {
            warehouseId_productId: {
              warehouseId: transfer.fromWarehouseId,
              productId: item.productId,
            },
          },
          create: {
            warehouseId: transfer.fromWarehouseId,
            productId: item.productId,
            quantity: 0,
          },
          update: {
            quantity: { decrement: item.quantity },
          },
        });

        await tx.warehouseStock.upsert({
          where: {
            warehouseId_productId: {
              warehouseId: transfer.toWarehouseId,
              productId: item.productId,
            },
          },
          create: {
            warehouseId: transfer.toWarehouseId,
            productId: item.productId,
            quantity: item.quantity,
          },
          update: {
            quantity: { increment: item.quantity },
          },
        });
      }

      const updated = await tx.stockTransfer.update({
        where: { id: transferId },
        data: {
          status: 'RECEIVED',
          receivedById: userId,
          receivedAt: new Date(),
        },
        include: {
          items: {
            include: {
              product: { select: { id: true, name: true, sku: true } },
              batch: { select: { id: true, batchNumber: true } },
            },
          },
          fromWarehouse: { select: { id: true, name: true } },
          toWarehouse: { select: { id: true, name: true } },
          createdBy: { select: { id: true, name: true } },
          receivedBy: { select: { id: true, name: true } },
        },
      });

      await auditService.log({
        userId,
        module: 'transfers',
        action: 'RECEIVE_TRANSFER',
        entity: 'STOCK_TRANSFER',
        entityId: transferId,
        newValue: { transferNo: transfer.transferNo, status: 'RECEIVED' },
      }, tx);

      return updated;
    });
  }

  async cancelTransfer(transferId: string, userId: string) {
    const transfer = await db.stockTransfer.findUnique({
      where: { id: transferId },
    });

    if (!transfer) throw new NotFoundError('Stock transfer record not found');
    if (transfer.status === 'RECEIVED') throw new ValidationError('Cannot cancel an already completed transfer');
    if (transfer.status === 'CANCELLED') throw new ValidationError('Transfer is already cancelled');

    const updated = await db.stockTransfer.update({
      where: { id: transferId },
      data: { status: 'CANCELLED' },
      include: {
        fromWarehouse: { select: { id: true, name: true } },
        toWarehouse: { select: { id: true, name: true } },
      },
    });

    await auditService.log({
      userId,
      module: 'transfers',
      action: 'CANCEL_TRANSFER',
      entity: 'STOCK_TRANSFER',
      entityId: transferId,
      newValue: { transferNo: transfer.transferNo, status: 'CANCELLED' },
    });

    return updated;
  }

  async getTransferById(transferId: string) {
    const transfer = await db.stockTransfer.findUnique({
      where: { id: transferId },
      include: {
        items: {
          include: {
            product: { select: { id: true, name: true, sku: true, category: true } },
            batch: { select: { id: true, batchNumber: true, expiryDate: true } },
          },
        },
        fromWarehouse: { select: { id: true, name: true, code: true } },
        toWarehouse: { select: { id: true, name: true, code: true } },
        createdBy: { select: { id: true, name: true, username: true } },
        receivedBy: { select: { id: true, name: true, username: true } },
      },
    });

    if (!transfer) throw new NotFoundError('Stock transfer record not found');
    return transfer;
  }

  async listTransfers(params?: {
    fromWarehouseId?: string;
    toWarehouseId?: string;
    status?: string;
    page?: number;
    limit?: number;
  }) {
    const page = Math.max(1, params?.page || 1);
    const limit = Math.max(1, Math.min(100, params?.limit || 50));
    const where: any = {};

    if (params?.fromWarehouseId) where.fromWarehouseId = params.fromWarehouseId;
    if (params?.toWarehouseId) where.toWarehouseId = params.toWarehouseId;
    if (params?.status) where.status = params.status;

    const [total, items] = await Promise.all([
      db.stockTransfer.count({ where }),
      db.stockTransfer.findMany({
        where,
        include: {
          items: {
            include: {
              product: { select: { id: true, name: true, sku: true } },
              batch: { select: { id: true, batchNumber: true } },
            },
          },
          fromWarehouse: { select: { id: true, name: true, code: true } },
          toWarehouse: { select: { id: true, name: true, code: true } },
          createdBy: { select: { id: true, name: true } },
          receivedBy: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return {
      items,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }
}

export const transfersService = new TransfersService();
