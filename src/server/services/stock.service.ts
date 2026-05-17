import { PrismaClient, Prisma } from '../infrastructure/generated-client';

/**
 * StockService ensures high integrity for inventory movements.
 * It provides atomic updates and synchronization logic.
 */
export class StockService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Recalculates and updates the total stock for a product based on its batches.
   * This is a safety synchronization method.
   */
  async syncProductStock(productId: string, tx?: Prisma.TransactionClient) {
    const client = tx || this.prisma;

    // 1. Sum up all active batches
    const aggregations = await client.batch.aggregate({
      where: { productId },
      _sum: {
        quantity: true,
        currentQty: true,
        availableQty: true,
        reservedQty: true,
      },
    });

    const totalQty = aggregations._sum.quantity || 0;

    // 2. Update product total stock
    const product = await client.product.update({
      where: { id: productId },
      data: {
        totalStock: totalQty,
        // Optional: you can add logic to update product status based on totalQty here
      },
    });

    // 3. Sync WarehouseStock rows
    const batchesByWarehouse = await client.batch.groupBy({
      by: ['warehouseId'],
      where: { productId, warehouseId: { not: null } },
      _sum: { quantity: true },
    });

    for (const group of batchesByWarehouse) {
      if (!group.warehouseId) continue;
      await client.warehouseStock.upsert({
        where: {
          warehouseId_productId: {
            warehouseId: group.warehouseId,
            productId,
          },
        },
        update: { quantity: group._sum.quantity || 0 },
        create: {
          warehouseId: group.warehouseId,
          productId,
          quantity: group._sum.quantity || 0,
        },
      });
    }

    return product;
  }

  /**
   * Atomic decrement of stock. 
   * Prevents discrepancies by using DB-level arithmetic.
   */
  static async decrementBatch(
    tx: Prisma.TransactionClient,
    batchId: string,
    quantity: number,
    productId: string,
    warehouseId: string | null
  ) {
    // 1. Decrement batch fields
    const updatedBatch = await tx.batch.update({
      where: { id: batchId },
      data: {
        quantity: { decrement: quantity },
        currentQty: { decrement: quantity },
        availableQty: { decrement: quantity },
      },
    });

    // 2. Decrement product total
    await tx.product.update({
      where: { id: productId },
      data: { totalStock: { decrement: quantity } },
    });

    // 3. Decrement warehouse stock if applicable
    if (warehouseId) {
      await tx.warehouseStock.update({
        where: {
          warehouseId_productId: {
            warehouseId,
            productId,
          },
        },
        data: { quantity: { decrement: quantity } },
      });
    }

    return updatedBatch;
  }
}

export const stockService = new StockService(require('../infrastructure/prisma').prisma);
