import { prisma } from '../../infrastructure/prisma';
import { auditService } from '../../services/audit.service';
import { NotFoundError, ValidationError } from '../../common/errors';
import { reportCache } from '../../common/cache';

const VALID_REASONS = ['EXPIRED', 'DAMAGED', 'LOST', 'INTERNAL_USE', 'MISMATCH', 'BROKEN_PACKAGING', 'OTHER'] as const;
type WriteOffReasonStr = (typeof VALID_REASONS)[number];

type WriteOffItemInput = {
  productId: string;
  batchId?: string | null;
  quantity: number;
};

type CreateWriteOffInput = {
  warehouseId?: string | null;
  reason: WriteOffReasonStr;
  note?: string | null;
  items: WriteOffItemInput[];
  userId: string;
  userRole?: string;
};

const buildWriteOffNumber = () => `WO-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

const mapProductStatus = (totalStock: number, minStock: number) => {
  if (totalStock <= 0) return 'OUT_OF_STOCK';
  if (totalStock < minStock) return 'LOW_STOCK';
  return 'ACTIVE';
};

async function getOrCreateDefaultWarehouse() {
  let wh = await prisma.warehouse.findFirst({ where: { isDefault: true } });
  if (!wh) {
    wh = await prisma.warehouse.create({ data: { code: 'MAIN', name: 'Main Warehouse', isDefault: true } });
  }
  return wh.id;
}

async function restoreWriteOffItems(
  tx: Parameters<typeof prisma.$transaction>[0] extends (arg: infer T) => any ? T : never,
  writeOff: {
    writeOffNo: string;
    items: Array<{ id: string; productId: string; batchId: string | null; quantity: number }>;
  },
  userId: string,
) {
  for (const item of writeOff.items) {
    if (!item.batchId) continue;

    const [batch, product] = await Promise.all([
      tx.batch.findUnique({ where: { id: item.batchId } }),
      tx.product.findUnique({ where: { id: item.productId } }),
    ]);

    if (!batch) throw new NotFoundError(`Batch ${item.batchId} not found`);
    if (!product) throw new NotFoundError(`Product ${item.productId} not found`);

    const qty = Number(item.quantity || 0);

    await tx.batch.update({
      where: { id: item.batchId },
      data: {
        quantity: Number(batch.quantity || 0) + qty,
        currentQty: Number(batch.currentQty || batch.quantity || 0) + qty,
        availableQty: Number(batch.availableQty || batch.quantity || 0) + qty,
      },
    });

    const nextStock = Number(product.totalStock || 0) + qty;
    await tx.product.update({
      where: { id: item.productId },
      data: {
        totalStock: nextStock,
        status: mapProductStatus(nextStock, product.minStock),
      },
    });

    if (batch.warehouseId) {
      await tx.warehouseStock.upsert({
        where: {
          warehouseId_productId: {
            warehouseId: batch.warehouseId,
            productId: item.productId,
          },
        },
        update: { quantity: { increment: qty } },
        create: {
          warehouseId: batch.warehouseId,
          productId: item.productId,
          quantity: qty,
        },
      });
    }

    await tx.batchMovement.create({
      data: {
        batchId: item.batchId,
        type: 'ADJUSTMENT',
        quantity: qty,
        date: new Date(),
        description: `Write-off ${writeOff.writeOffNo} reversed`,
        userId,
      },
    });
  }
}

async function applyWriteOffItems(
  tx: Parameters<typeof prisma.$transaction>[0] extends (arg: infer T) => any ? T : never,
  writeOffNo: string,
  input: CreateWriteOffInput,
) {
  const normalizedItems: Array<{
    productId: string;
    batchId: string | null;
    quantity: number;
    unitCost: number;
    lineTotal: number;
  }> = [];

  for (const item of input.items) {
    if (!item.batchId) {
      throw new ValidationError('batchId is required for each write-off item');
    }

    const batch = await tx.batch.findUnique({ where: { id: item.batchId } });
    if (!batch) throw new NotFoundError(`Batch ${item.batchId} not found`);

    const qty = Number(item.quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      throw new ValidationError('quantity must be a positive number');
    }
    if (batch.quantity < qty) {
      throw new ValidationError(`Insufficient stock in batch ${batch.batchNumber}: available ${batch.quantity}, requested ${qty}`);
    }

    const product = await tx.product.findUnique({ where: { id: item.productId } });
    if (!product) throw new NotFoundError(`Product ${item.productId} not found`);

    const unitCost = Number(batch.costBasis || product.costPrice || 0);
    const lineTotal = unitCost * qty;
    normalizedItems.push({
      productId: item.productId,
      batchId: item.batchId || null,
      quantity: qty,
      unitCost,
      lineTotal,
    });

    await tx.batch.update({
      where: { id: item.batchId },
      data: {
        quantity: Math.max(0, Number(batch.quantity) - qty),
        currentQty: Math.max(0, Number(batch.currentQty || batch.quantity) - qty),
        availableQty: Math.max(0, Number(batch.availableQty || batch.quantity) - qty),
      },
    });

    const nextStock = Math.max(0, Number(product.totalStock) - qty);
    await tx.product.update({
      where: { id: item.productId },
      data: {
        totalStock: nextStock,
        status: mapProductStatus(nextStock, product.minStock),
      },
    });

    if (batch.warehouseId) {
      await tx.warehouseStock.upsert({
        where: {
          warehouseId_productId: {
            warehouseId: batch.warehouseId,
            productId: item.productId,
          },
        },
        update: { quantity: { decrement: qty } },
        create: {
          warehouseId: batch.warehouseId,
          productId: item.productId,
          quantity: 0,
        },
      });
    }

    await tx.batchMovement.create({
      data: {
        batchId: item.batchId,
        type: 'WRITE_OFF',
        quantity: -qty,
        date: new Date(),
        description: `Write-off ${writeOffNo}: ${input.reason}`,
        userId: input.userId,
      },
    });
  }

  return normalizedItems;
}

export class WriteOffService {
  async createWriteOff(input: CreateWriteOffInput) {
    if (!input.items.length) {
      throw new ValidationError('items array is required');
    }
    if (!VALID_REASONS.includes(input.reason)) {
      throw new ValidationError(`Invalid reason. Must be one of: ${VALID_REASONS.join(', ')}`);
    }

    const warehouseId = input.warehouseId || (await getOrCreateDefaultWarehouse());
    const writeOffNo = buildWriteOffNumber();

    const writeOff = await prisma.$transaction(async (tx) => {
      const normalizedItems = await applyWriteOffItems(tx, writeOffNo, input);

      return tx.writeOff.create({
        data: {
          writeOffNo,
          warehouseId,
          reason: input.reason,
          note: input.note || null,
          totalAmount: normalizedItems.reduce((sum, item) => sum + item.lineTotal, 0),
          createdById: input.userId,
          items: {
            create: normalizedItems.map((item) => ({
              productId: item.productId,
              batchId: item.batchId || null,
              quantity: item.quantity,
              unitCost: item.unitCost,
              lineTotal: item.lineTotal,
            })),
          },
        },
        include: { items: { include: { product: true } } },
      });
    });

    await auditService.log({
      userId: input.userId,
      userRole: input.userRole as any,
      module: 'writeoff',
      action: 'CREATE_WRITE_OFF',
      entity: 'WRITE_OFF',
      entityId: writeOff.id,
      newValue: { reason: input.reason, itemCount: input.items.length, warehouseId },
    });

    reportCache.invalidatePattern(/^metrics:/);
    reportCache.invalidatePattern(/^report:/);

    return writeOff;
  }

  async updateWriteOff(writeOffId: string, input: CreateWriteOffInput) {
    if (!writeOffId) {
      throw new ValidationError('writeOffId is required');
    }
    if (!input.items.length) {
      throw new ValidationError('items array is required');
    }
    if (!VALID_REASONS.includes(input.reason)) {
      throw new ValidationError(`Invalid reason. Must be one of: ${VALID_REASONS.join(', ')}`);
    }

    const updated = await prisma.$transaction(async (tx) => {
      const existing = await tx.writeOff.findUnique({
        where: { id: writeOffId },
        include: { items: true },
      });
      if (!existing) throw new NotFoundError(`Write-off ${writeOffId} not found`);

      await restoreWriteOffItems(tx, existing, input.userId);
      await tx.writeOffItem.deleteMany({ where: { writeOffId } });

      const normalizedItems = await applyWriteOffItems(tx, existing.writeOffNo, input);

      return tx.writeOff.update({
        where: { id: writeOffId },
        data: {
          warehouseId: input.warehouseId || existing.warehouseId,
          reason: input.reason,
          note: input.note || null,
          totalAmount: normalizedItems.reduce((sum, item) => sum + item.lineTotal, 0),
          items: {
            create: normalizedItems.map((item) => ({
              productId: item.productId,
              batchId: item.batchId || null,
              quantity: item.quantity,
              unitCost: item.unitCost,
              lineTotal: item.lineTotal,
            })),
          },
        },
        include: { items: { include: { product: true, batch: true } }, createdBy: { select: { name: true } }, warehouse: { select: { name: true } } },
      });
    });

    await auditService.log({
      userId: input.userId,
      userRole: input.userRole as any,
      module: 'writeoff',
      action: 'UPDATE_WRITE_OFF',
      entity: 'WRITE_OFF',
      entityId: updated.id,
      newValue: { reason: input.reason, itemCount: input.items.length },
    });

    reportCache.invalidatePattern(/^metrics:/);
    reportCache.invalidatePattern(/^report:/);

    return updated;
  }

  async deleteWriteOff(writeOffId: string, userId: string, userRole?: string) {
    if (!writeOffId) {
      throw new ValidationError('writeOffId is required');
    }

    const deleted = await prisma.$transaction(async (tx) => {
      const existing = await tx.writeOff.findUnique({
        where: { id: writeOffId },
        include: { items: true },
      });
      if (!existing) throw new NotFoundError(`Write-off ${writeOffId} not found`);

      await restoreWriteOffItems(tx, existing, userId);
      await tx.writeOff.delete({ where: { id: writeOffId } });

      return existing;
    });

    await auditService.log({
      userId,
      userRole: userRole as any,
      module: 'writeoff',
      action: 'DELETE_WRITE_OFF',
      entity: 'WRITE_OFF',
      entityId: deleted.id,
      newValue: { writeOffNo: deleted.writeOffNo },
    });

    reportCache.invalidatePattern(/^metrics:/);
    reportCache.invalidatePattern(/^report:/);
  }
}

export const writeOffService = new WriteOffService();
