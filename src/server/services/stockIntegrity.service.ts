import { prisma } from '../infrastructure/prisma';
import { computeBatchStatus } from '../common/batchStatus';
import { computeProductStatus } from '../common/productStatus';

export const buildStockIntegrityReport = async () => {
  const [products, warehouseStocks] = await Promise.all([
    prisma.product.findMany({
      where: { isActive: true },
      include: {
        batches: {
          where: {},
          select: {
            id: true,
            batchNumber: true,
            quantity: true,
            currentQty: true,
            availableQty: true,
            reservedQty: true,
            warehouseId: true,
            expiryDate: true,
          },
        },
      },
      orderBy: { name: 'asc' },
    }),
    prisma.warehouseStock.findMany({
      select: {
        warehouseId: true,
        productId: true,
        quantity: true,
      },
    }),
  ]);

  const issues: Array<Record<string, any>> = [];

  for (const product of products) {
    let batchQtySum = 0;
    let batchCurrentSum = 0;
    let batchAvailableSum = 0;
    let batchReservedSum = 0;

    for (const batch of product.batches) {
      const qty = Number(batch.quantity || 0);
      const current = Number(batch.currentQty || 0);
      const available = Number(batch.availableQty || 0);
      const reserved = Number(batch.reservedQty || 0);

      batchQtySum += qty;
      batchCurrentSum += current;
      batchAvailableSum += available;
      batchReservedSum += reserved;

      if (current !== available + reserved) {
        issues.push({
          type: 'BATCH_MISMATCH',
          productId: product.id,
          productName: product.name,
          batchId: batch.id,
          batchNumber: batch.batchNumber,
          currentQty: current,
          availableQty: available,
          reservedQty: reserved,
          message: 'currentQty must equal availableQty + reservedQty',
        });
      }

      if (qty !== current) {
        issues.push({
          type: 'BATCH_QTY_MISMATCH',
          productId: product.id,
          productName: product.name,
          batchId: batch.id,
          batchNumber: batch.batchNumber,
          quantity: qty,
          currentQty: current,
          message: 'quantity must equal currentQty for active inventory model',
        });
      }
    }

    const relatedStocks = warehouseStocks.filter((s: any) => s.productId === product.id);
    const warehouseStockSum = relatedStocks.reduce((sum: number, s: any) => sum + Number(s.quantity || 0), 0);

    if (Number(product.totalStock || 0) !== batchQtySum) {
      issues.push({
        type: 'PRODUCT_TOTAL_MISMATCH',
        productId: product.id,
        productName: product.name,
        productTotalStock: Number(product.totalStock || 0),
        batchQtySum,
        message: 'product.totalStock must equal sum(batch.quantity)',
      });
    }

    if (warehouseStockSum !== batchQtySum) {
      issues.push({
        type: 'WAREHOUSE_STOCK_MISMATCH',
        productId: product.id,
        productName: product.name,
        batchQtySum,
        warehouseStockSum,
        message: 'sum(warehouse_stock) must equal sum(batch.quantity)',
      });
    }

    if (batchCurrentSum !== batchAvailableSum + batchReservedSum) {
      issues.push({
        type: 'PRODUCT_BATCH_FIELDS_MISMATCH',
        productId: product.id,
        productName: product.name,
        batchCurrentSum,
        batchAvailableSum,
        batchReservedSum,
        message: 'sum(currentQty) must equal sum(availableQty) + sum(reservedQty)',
      });
    }
  }

  return {
    checkedProducts: products.length,
    checkedWarehouseStockRows: warehouseStocks.length,
    issuesCount: issues.length,
    issues,
    timestamp: new Date().toISOString(),
  };
};

export const applyStockIntegrityFix = async () => {
  const [products, warehouseStocks, warehouses] = await Promise.all([
    prisma.product.findMany({
      where: { isActive: true },
      include: {
        batches: {
          select: {
            id: true,
            quantity: true,
            currentQty: true,
            availableQty: true,
            reservedQty: true,
            warehouseId: true,
            expiryDate: true,
          },
        },
      },
    }),
    prisma.warehouseStock.findMany(),
    prisma.warehouse.findMany({ select: { id: true } }),
  ]);

  await prisma.$transaction(async (tx: any) => {
    for (const product of products) {
      let totalQty = 0;
      const warehouseTotals: Record<string, number> = {};

      for (const batch of product.batches) {
        const qty = Number(batch.quantity);
        totalQty += qty;

        // 1. Sync batch fields (consistency)
        const reserved = Number(batch.reservedQty || 0);
        const available = Math.max(0, qty - reserved);
        const current = qty;

        if (batch.currentQty !== current || batch.availableQty !== available) {
          await tx.batch.update({
            where: { id: batch.id },
            data: {
              currentQty: current,
              availableQty: available,
              status: computeBatchStatus(batch.expiryDate),
            },
          });
        }

        if (batch.warehouseId) {
          warehouseTotals[batch.warehouseId] = (warehouseTotals[batch.warehouseId] || 0) + qty;
        }
      }

      // 2. Sync product totalStock
      if (Number(product.totalStock) !== totalQty) {
        await tx.product.update({
          where: { id: product.id },
          data: {
            totalStock: totalQty,
            status: computeProductStatus(totalQty, product.minStock),
          },
        });
      }

      // 3. Sync warehouseStocks
      for (const wh of warehouses) {
        const actual = warehouseTotals[wh.id] || 0;
        const recorded: any = warehouseStocks.find((s: any) => s.warehouseId === wh.id && s.productId === product.id);

        if (!recorded && actual > 0) {
          await tx.warehouseStock.create({
            data: {
              warehouseId: wh.id,
              productId: product.id,
              quantity: actual,
            },
          });
        } else if (recorded && Number(recorded.quantity) !== actual) {
          await tx.warehouseStock.update({
            where: { id: recorded.id },
            data: { quantity: actual },
          });
        }
      }
    }

    // 4. Remove orphan warehouseStocks
    const validWhProdPairs = new Set(
      products.flatMap((p: any) => 
        p.batches
          .filter((b: any) => b.warehouseId)
          .map((b: any) => `${b.warehouseId!}_${p.id}`)
      )
    );

    for (const ws of warehouseStocks) {
      if (!validWhProdPairs.has(`${ws.warehouseId}_${ws.productId}`) && Number(ws.quantity) !== 0) {
        await tx.warehouseStock.update({
          where: { id: ws.id },
          data: { quantity: 0 },
        });
      }
    }
  });
};
