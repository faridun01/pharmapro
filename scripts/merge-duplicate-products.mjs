import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const applyMode = process.argv.includes('--apply');

function normalizeProductName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru-RU');
}

function computeProductStatus(totalStock, minStock) {
  if (totalStock <= 0) return 'OUT_OF_STOCK';
  if (totalStock <= Math.max(0, Number(minStock || 0))) return 'LOW_STOCK';
  return 'ACTIVE';
}

function pickCanonical(products) {
  return [...products].sort((left, right) => {
    const leftActive = left.isActive ? 1 : 0;
    const rightActive = right.isActive ? 1 : 0;
    if (leftActive !== rightActive) return rightActive - leftActive;
    const leftStock = Number(left.totalStock || 0);
    const rightStock = Number(right.totalStock || 0);
    if (leftStock !== rightStock) return rightStock - leftStock;
    return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
  })[0];
}

function firstNonEmpty(products, key, fallback = null) {
  for (const product of products) {
    const value = product[key];
    if (value === null || value === undefined) continue;
    if (typeof value === 'string' && value.trim() === '') continue;
    return value;
  }
  return fallback;
}

function mergeProductFields(products, canonical, totalStock) {
  const ordered = [canonical, ...products.filter((product) => product.id !== canonical.id)];
  const minStock = Math.max(...ordered.map((product) => Number(product.minStock || 0)), Number(canonical.minStock || 0));
  return {
    name: canonical.name.trim(),
    sku: firstNonEmpty(ordered, 'sku', canonical.sku),
    barcode: firstNonEmpty(ordered, 'barcode', canonical.barcode),
    internationalName: firstNonEmpty(ordered, 'internationalName', canonical.internationalName),
    category: firstNonEmpty(ordered, 'category', canonical.category),
    categoryId: firstNonEmpty(ordered, 'categoryId', canonical.categoryId),
    manufacturer: firstNonEmpty(ordered, 'manufacturer', canonical.manufacturer),
    manufacturerId: firstNonEmpty(ordered, 'manufacturerId', canonical.manufacturerId),
    dosage: firstNonEmpty(ordered, 'dosage', canonical.dosage),
    dosageUnit: firstNonEmpty(ordered, 'dosageUnit', canonical.dosageUnit),
    formId: firstNonEmpty(ordered, 'formId', canonical.formId),
    packageTypeId: firstNonEmpty(ordered, 'packageTypeId', canonical.packageTypeId),
    unitsPerPack: firstNonEmpty(ordered, 'unitsPerPack', canonical.unitsPerPack),
    minStock,
    costPrice: Number(firstNonEmpty(ordered.filter((product) => Number(product.costPrice || 0) > 0), 'costPrice', canonical.costPrice) || 0),
    sellingPrice: Number(firstNonEmpty(ordered.filter((product) => Number(product.sellingPrice || 0) > 0), 'sellingPrice', canonical.sellingPrice) || 0),
    image: firstNonEmpty(ordered, 'image', canonical.image),
    prescription: ordered.some((product) => Boolean(product.prescription)),
    markingRequired: ordered.some((product) => Boolean(product.markingRequired)),
    analogs: firstNonEmpty(ordered, 'analogs', canonical.analogs),
    isActive: true,
    totalStock,
    status: computeProductStatus(totalStock, minStock),
  };
}

async function mergeWarehouseStocks(tx, canonicalId, duplicateId) {
  await tx.warehouseStock.deleteMany({ where: { productId: duplicateId } });

  const batches = await tx.batch.findMany({
    where: { productId: canonicalId },
    select: { warehouseId: true, quantity: true },
  });

  const totalsByWarehouse = new Map();
  for (const batch of batches) {
    if (!batch.warehouseId) continue;
    totalsByWarehouse.set(
      batch.warehouseId,
      Number(totalsByWarehouse.get(batch.warehouseId) || 0) + Number(batch.quantity || 0),
    );
  }

  await tx.warehouseStock.deleteMany({ where: { productId: canonicalId } });

  for (const [warehouseId, quantity] of totalsByWarehouse.entries()) {
    await tx.warehouseStock.create({
      data: {
        warehouseId,
        productId: canonicalId,
        quantity,
      },
    });
  }
}

async function mergeProductAnalogs(tx, canonicalId, duplicateId) {
  const outgoing = await tx.productAnalog.findMany({ where: { productId: duplicateId } });
  for (const row of outgoing) {
    if (row.analogProductId === canonicalId) {
      await tx.productAnalog.delete({ where: { id: row.id } });
      continue;
    }

    const existing = await tx.productAnalog.findFirst({
      where: {
        productId: canonicalId,
        analogProductId: row.analogProductId,
      },
      select: { id: true },
    });

    if (existing) {
      await tx.productAnalog.delete({ where: { id: row.id } });
    } else {
      await tx.productAnalog.update({
        where: { id: row.id },
        data: { productId: canonicalId },
      });
    }
  }

  const incoming = await tx.productAnalog.findMany({ where: { analogProductId: duplicateId } });
  for (const row of incoming) {
    if (row.productId === canonicalId) {
      await tx.productAnalog.delete({ where: { id: row.id } });
      continue;
    }

    const existing = await tx.productAnalog.findFirst({
      where: {
        productId: row.productId,
        analogProductId: canonicalId,
      },
      select: { id: true },
    });

    if (existing) {
      await tx.productAnalog.delete({ where: { id: row.id } });
    } else {
      await tx.productAnalog.update({
        where: { id: row.id },
        data: { analogProductId: canonicalId },
      });
    }
  }
}

async function mergeDuplicateProductGroup(group) {
  const canonical = pickCanonical(group);
  const duplicates = group.filter((product) => product.id !== canonical.id);

  console.log(`\n${applyMode ? 'MERGE' : 'CHECK'}: ${canonical.name}`);
  console.log(`  canonical: ${canonical.id} (${canonical.sku})`);
  for (const duplicate of duplicates) {
    console.log(`  duplicate: ${duplicate.id} (${duplicate.sku}) stock=${duplicate.totalStock}`);
  }

  if (!applyMode || duplicates.length === 0) return;

  await prisma.$transaction(async (tx) => {
    for (const duplicate of duplicates) {
      await tx.batch.updateMany({ where: { productId: duplicate.id }, data: { productId: canonical.id } });
      await tx.invoiceItem.updateMany({ where: { productId: duplicate.id }, data: { productId: canonical.id } });
      await tx.purchaseInvoiceItem.updateMany({ where: { productId: duplicate.id }, data: { productId: canonical.id } });
      await tx.salesOrderItem.updateMany({ where: { productId: duplicate.id }, data: { productId: canonical.id } });
      await tx.returnItem.updateMany({ where: { productId: duplicate.id }, data: { productId: canonical.id } });
      await tx.writeOffItem.updateMany({ where: { productId: duplicate.id }, data: { productId: canonical.id } });
      await tx.priceHistory.updateMany({ where: { productId: duplicate.id }, data: { productId: canonical.id } });
      await tx.reservation.updateMany({ where: { productId: duplicate.id }, data: { productId: canonical.id } });
      await tx.stockTransferItem.updateMany({ where: { productId: duplicate.id }, data: { productId: canonical.id } });
      await tx.productAlias.updateMany({ where: { productId: duplicate.id }, data: { productId: canonical.id } });
      await tx.ocrRow.updateMany({ where: { matchedProductId: duplicate.id }, data: { matchedProductId: canonical.id } });

      await mergeProductAnalogs(tx, canonical.id, duplicate.id);
      await mergeWarehouseStocks(tx, canonical.id, duplicate.id);

      await tx.product.delete({ where: { id: duplicate.id } });
    }

    const refreshedProducts = await tx.product.findMany({
      where: { id: canonical.id },
      include: {
        batches: {
          select: {
            quantity: true,
          },
        },
      },
    });

    const refreshedCanonical = refreshedProducts[0];
    const totalStock = refreshedCanonical.batches.reduce((sum, batch) => sum + Number(batch.quantity || 0), 0);
    await mergeWarehouseStocks(tx, canonical.id, canonical.id);
    await tx.product.update({
      where: { id: canonical.id },
      data: mergeProductFields(group, canonical, totalStock),
    });
  });
}

async function main() {
  const products = await prisma.product.findMany({
    where: { isActive: true },
    select: {
      id: true,
      name: true,
      sku: true,
      barcode: true,
      internationalName: true,
      category: true,
      categoryId: true,
      manufacturer: true,
      manufacturerId: true,
      dosage: true,
      dosageUnit: true,
      formId: true,
      packageTypeId: true,
      unitsPerPack: true,
      totalStock: true,
      minStock: true,
      costPrice: true,
      sellingPrice: true,
      status: true,
      isActive: true,
      image: true,
      prescription: true,
      markingRequired: true,
      analogs: true,
      createdAt: true,
    },
    orderBy: [{ name: 'asc' }, { createdAt: 'asc' }],
  });

  const groups = new Map();
  for (const product of products) {
    const key = normalizeProductName(product.name);
    if (!key) continue;
    const existing = groups.get(key) || [];
    existing.push(product);
    groups.set(key, existing);
  }

  const duplicateGroups = [...groups.values()].filter((group) => group.length > 1);

  console.log(`Products checked: ${products.length}`);
  console.log(`Duplicate name groups: ${duplicateGroups.length}`);
  console.log(`Mode: ${applyMode ? 'apply' : 'dry-run'}`);

  for (const group of duplicateGroups) {
    await mergeDuplicateProductGroup(group);
  }

  if (!duplicateGroups.length) {
    console.log('No duplicate product names found.');
    return;
  }

  console.log(applyMode ? '\nDuplicate products merged successfully.' : '\nDry-run complete. Re-run with --apply to merge duplicates.');
}

main()
  .catch((error) => {
    console.error('Duplicate product merge failed:', error?.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });