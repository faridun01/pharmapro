import { prisma } from '../../infrastructure/prisma';
import { auditService } from '../../services/audit.service';
import { NotFoundError, ValidationError } from '../../common/errors';
import { reportCache } from '../../common/cache';

type ReturnTypeValue = 'CUSTOMER' | 'SUPPLIER';

type CreateReturnItemInput = {
  productId: string;
  batchId?: string | null;
  quantity: number;
  unitPrice?: number | null;
  reason?: string | null;
};

type CreateReturnInput = {
  type: ReturnTypeValue;
  invoiceId?: string | null;
  supplierId?: string | null;
  customerName?: string | null;
  refundMethod?: 'CASH' | 'CARD' | 'STORE_BALANCE' | null;
  reason?: string | null;
  note?: string | null;
  items: CreateReturnItemInput[];
  userId: string;
  userRole?: string;
};

const buildReturnNumber = () => `RET-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

const mapProductStatus = (totalStock: number, minStock: number) => {
  if (totalStock <= 0) return 'OUT_OF_STOCK';
  if (totalStock < minStock) return 'LOW_STOCK';
  return 'ACTIVE';
};

export class ReturnsService {
  async createReturn(input: CreateReturnInput) {
    if (!input.items.length) {
      throw new ValidationError('items array is required');
    }

    const totalAmount = input.items.reduce((sum, item) => {
      return sum + Number(item.quantity || 0) * Number(item.unitPrice || 0);
    }, 0);

    const created = await prisma.return.create({
      data: {
        returnNo: buildReturnNumber(),
        type: input.type,
        status: 'DRAFT',
        invoiceId: input.invoiceId || null,
        supplierId: input.supplierId || null,
        customerName: input.customerName || null,
        refundMethod: input.refundMethod || null,
        reason: input.reason || null,
        note: input.note || null,
        totalAmount,
        createdById: input.userId,
        items: {
          create: input.items.map((item) => ({
            productId: item.productId,
            batchId: item.batchId || null,
            quantity: Number(item.quantity),
            unitPrice: item.unitPrice != null ? Number(item.unitPrice) : null,
            lineTotal: Number(item.quantity || 0) * Number(item.unitPrice || 0),
            reason: item.reason || null,
          })),
        },
      },
      include: { items: { include: { product: true } } },
    });

    await auditService.log({
      userId: input.userId,
      userRole: input.userRole as any,
      module: 'returns',
      action: 'CREATE_RETURN',
      entity: 'RETURN',
      entityId: created.id,
      newValue: { type: input.type, itemCount: input.items.length },
    });

    return created;
  }

  async approveReturn(returnId: string, userId: string, userRole?: string) {
    const ret = await prisma.return.findUnique({
      where: { id: returnId },
      include: { items: true },
    });
    if (!ret) throw new NotFoundError('Return not found');
    if (ret.status !== 'DRAFT') {
      throw new ValidationError(`Return is already ${ret.status.toLowerCase()}`);
    }

    const updated = await prisma.$transaction(async (tx) => {
      // ── Step 1: Restore stock for each item ──────────────────────────────────
      for (const item of ret.items) {
        if (!item.batchId) continue;

        const batch = await tx.batch.findUnique({ where: { id: item.batchId } });
        if (!batch) continue;

        let movementQty: number;
        if (ret.type === 'CUSTOMER') {
          // Customer returns goods → stock goes up
          movementQty = item.quantity;
        } else {
          // Supplier return → we send goods back → stock goes down
          if (batch.quantity < item.quantity) {
            throw new ValidationError(
              `Insufficient stock in batch ${batch.batchNumber} (available: ${batch.quantity}, requested: ${item.quantity})`,
            );
          }
          movementQty = -item.quantity;
        }

        await tx.batch.update({
          where: { id: item.batchId },
          data: {
            quantity: Math.max(0, Number(batch.quantity) + movementQty),
            currentQty: Math.max(0, Number(batch.currentQty || batch.quantity) + movementQty),
            availableQty: Math.max(0, Number(batch.availableQty || batch.quantity) + movementQty),
          },
        });

        const product = await tx.product.findUnique({ where: { id: item.productId } });
        if (!product) continue;

        const nextStock = Math.max(0, Number(product.totalStock) + movementQty);
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
            update: {
              quantity: movementQty >= 0 ? { increment: movementQty } : { decrement: Math.abs(movementQty) },
            },
            create: {
              warehouseId: batch.warehouseId,
              productId: item.productId,
              quantity: Math.max(0, movementQty),
            },
          });
        }

        await tx.batchMovement.create({
          data: {
            batchId: item.batchId,
            type: 'RETURN',
            quantity: movementQty,
            description: `Return ${ret.returnNo} - ${ret.type.toLowerCase()}`,
            userId,
          },
        });
      }

      // ── Step 2: For CUSTOMER returns — create a Payment (refund to buyer) ────
      // This is the critical fix: money leaves the pharmacy → direction=OUT
      if (ret.type === 'CUSTOMER' && Number(ret.totalAmount || 0) > 0) {
        const refundAmount = Number(ret.totalAmount);
        const refundMethod = (ret.refundMethod || 'CASH') as string;

        // Resolve customerId from the linked sale invoice
        let customerId: string | null = null;
        if (ret.invoiceId) {
          const invoice = await tx.invoice.findUnique({
            where: { id: ret.invoiceId },
            select: { customerId: true },
          });
          customerId = invoice?.customerId ?? null;
        }

        // Map refundMethod to PaymentMethod
        const methodMap: Record<string, 'CASH' | 'CARD' | 'BANK_TRANSFER'> = {
          CASH: 'CASH',
          CARD: 'CARD',
          STORE_BALANCE: 'CASH',  // store credit treated as cash refund
          BANK_TRANSFER: 'BANK_TRANSFER',
        };
        const paymentMethod = methodMap[refundMethod] ?? 'CASH';

        await tx.payment.create({
          data: {
            direction: 'OUT',
            counterpartyType: 'CUSTOMER',
            ...(customerId ? { customerId } : {}),
            ...(ret.invoiceId ? { invoiceId: ret.invoiceId } : {}),
            method: paymentMethod,
            amount: refundAmount,
            paymentDate: new Date(),
            status: 'PAID',
            createdById: userId,
            comment: `Возврат покупателю по документу ${ret.returnNo}`,
          },
        });

        // If the original invoice had a Receivable (credit sale), also reduce it
        if (ret.invoiceId && customerId) {
          const receivable = await tx.receivable.findFirst({
            where: {
              invoiceId: ret.invoiceId,
              customerId,
              status: { not: 'PAID' },
            },
          });
          if (receivable) {
            const newRemaining = Math.max(0, Number(receivable.remainingAmount || 0) - refundAmount);
            const newPaid = Number(receivable.paidAmount || 0) + refundAmount;
            await tx.receivable.update({
              where: { id: receivable.id },
              data: {
                paidAmount: newPaid,
                remainingAmount: newRemaining,
                status: newRemaining <= 0 ? 'PAID' : newPaid > 0 ? 'PARTIAL' : 'OPEN',
              },
            });
          }
        }
      }

      // ── Step 3: Mark return as COMPLETED ────────────────────────────────────
      return tx.return.update({
        where: { id: ret.id },
        data: { status: 'COMPLETED', approvedById: userId },
        include: { items: { include: { product: true } } },
      });
    });

    reportCache.invalidatePattern(/^metrics:/);
    reportCache.invalidatePattern(/^report:/);

    await auditService.log({
      userId,
      userRole: userRole as any,
      module: 'returns',
      action: 'APPROVE_RETURN',
      entity: 'RETURN',
      entityId: ret.id,
      oldValue: { status: 'DRAFT' },
      newValue: {
        status: 'COMPLETED',
        refundCreated: ret.type === 'CUSTOMER' && Number(ret.totalAmount || 0) > 0,
        refundAmount: ret.type === 'CUSTOMER' ? Number(ret.totalAmount || 0) : 0,
        refundMethod: ret.refundMethod || 'CASH',
      },
    });

    return updated;
  }

  async rejectReturn(returnId: string, userId: string, userRole?: string) {
    const ret = await prisma.return.findUnique({ where: { id: returnId } });
    if (!ret) throw new NotFoundError('Return not found');
    if (ret.status !== 'DRAFT') {
      throw new ValidationError(`Return is already ${ret.status.toLowerCase()}`);
    }

    const updated = await prisma.return.update({
      where: { id: returnId },
      data: { status: 'REJECTED', approvedById: userId },
    });

    await auditService.log({
      userId,
      userRole: userRole as any,
      module: 'returns',
      action: 'REJECT_RETURN',
      entity: 'RETURN',
      entityId: ret.id,
    });

    return updated;
  }
}

export const returnsService = new ReturnsService();
