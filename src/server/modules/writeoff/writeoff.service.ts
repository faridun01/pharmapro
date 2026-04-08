import { prisma } from '../../infrastructure/prisma';
import { auditService } from '../../services/audit.service';
import { NotFoundError, ValidationError } from '../../common/errors';

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
      const normalizedItems: Array<{
        productId: string;
        batchId: string | null;
        quantity: number;
        unitCost: number;
        lineTotal: number;
      }> = [];

      for (const item of input.items) {
        if (!item.batchId) continue;

        const batch = await tx.batch.findUnique({ where: { id: item.batchId } });
        if (!batch) throw new NotFoundError(`Batch ${item.batchId} not found`);

        const qty = Number(item.quantity);
        if (batch.quantity < qty) {
          throw new ValidationError(
            `Insufficient stock in batch ${batch.batchNumber}: available ${batch.quantity}, requested ${qty}`,
          );
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

    return writeOff;
  }
}

export const writeOffService = new WriteOffService();
