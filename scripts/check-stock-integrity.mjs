import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const fixMode = process.argv.includes('--fix');

function logIssue(issue) {
  const header = `[${issue.type}] ${issue.productName} (${issue.productId})`;
  console.log(header);
  if (issue.batchNumber) console.log(`  batch: ${issue.batchNumber}`);
  console.log(`  message: ${issue.message}`);
  const entries = Object.entries(issue).filter(([k]) => !['type', 'productName', 'productId', 'batchNumber', 'message'].includes(k));
  for (const [key, value] of entries) {
    console.log(`  ${key}: ${value}`);
  }
}

async function main() {
  const [products, warehouseStocks, warehouses] = await Promise.all([
    prisma.product.findMany({
      where: { isActive: true },
      include: {
        batches: {
          select: {
            id: true,
            batchNumber: true,
            quantity: true,
            currentQty: true,
            availableQty: true,
            reservedQty: true,
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
    prisma.warehouse.findMany({
      where: { isActive: true },
      select: { id: true, isDefault: true },
      orderBy: { createdAt: 'asc' },
    }),
  ]);

  const defaultWarehouseId = warehouses.find((w) => w.isDefault)?.id || warehouses[0]?.id || null;

  const issues = [];

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

      if (fixMode) {
        const targetCurrent = qty;
        const targetReserved = Math.max(0, Math.min(reserved, targetCurrent));
        const targetAvailable = Math.max(0, targetCurrent - targetReserved);

        await prisma.batch.update({
          where: { id: batch.id },
          data: {
            currentQty: targetCurrent,
            reservedQty: targetReserved,
            availableQty: targetAvailable,
          },
        });
      }
    }

    const relatedStocks = warehouseStocks.filter((s) => s.productId === product.id);
    const warehouseStockSum = relatedStocks.reduce((sum, s) => sum + Number(s.quantity || 0), 0);

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

    if (fixMode) {
      await prisma.product.update({
        where: { id: product.id },
        data: { totalStock: batchQtySum },
      });

      const byWarehouse = new Map();
      for (const row of warehouseStocks) {
        if (row.productId !== product.id) continue;
        byWarehouse.set(row.warehouseId, row);
      }

      let assigned = false;
      for (const existing of byWarehouse.values()) {
        assigned = true;
        await prisma.warehouseStock.updateMany({
          where: { warehouseId: existing.warehouseId, productId: product.id },
          data: { quantity: 0 },
        });
      }

      const nonZeroBatchQty = batchQtySum;
      if (defaultWarehouseId) {
        await prisma.warehouseStock.upsert({
          where: {
            warehouseId_productId: {
              warehouseId: defaultWarehouseId,
              productId: product.id,
            },
          },
          update: { quantity: nonZeroBatchQty },
          create: {
            warehouseId: defaultWarehouseId,
            productId: product.id,
            quantity: nonZeroBatchQty,
          },
        });
        assigned = true;
      }

      if (!assigned && nonZeroBatchQty > 0) {
        console.warn(`No active warehouse available for product ${product.id}; stock rows were not assigned.`);
      }
    }
  }

  console.log(`Checked products: ${products.length}`);
  console.log(`Checked warehouse stock rows: ${warehouseStocks.length}`);

  if (issues.length === 0) {
    console.log('Stock integrity check passed. No issues found.');
    process.exitCode = 0;
    return;
  }

  if (fixMode) {
    console.log(`Repair mode applied. Found ${issues.length} issue(s) before repair.`);
    console.log('Re-run without --fix to verify clean state.');
    process.exitCode = 0;
    return;
  }

  console.log(`Found ${issues.length} issue(s):`);
  for (const issue of issues) {
    logIssue(issue);
  }

  process.exitCode = 2;
}

main()
  .catch((error) => {
    console.error('Stock integrity check failed:', error?.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
