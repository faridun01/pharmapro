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

      // ── Step 2: For CUSTOMER returns — create a Payment (refund) and update Invoice ──
      if (ret.type === 'CUSTOMER' && ret.invoiceId) {
        const invoice = await tx.invoice.findUnique({
          where: { id: ret.invoiceId },
          include: { items: true, receivable: true }
        });

        if (invoice) {
          const returnAmount = Number(ret.totalAmount || 0);
          
          // 2.1 Update Invoice Items
          for (const item of ret.items) {
            const invItem = invoice.items.find(i => 
              i.productId === item.productId && 
              i.batchId === item.batchId
            );
            if (invItem) {
              const lineReturnAmount = Number(item.unitPrice || invItem.unitPrice) * item.quantity;
              await tx.invoiceItem.update({
                where: { id: invItem.id },
                data: {
                  quantity: { decrement: item.quantity },
                  totalPrice: { decrement: lineReturnAmount }
                }
              });
            }
          }

          // 2.2 Update Invoice total and status
          const updatedInvoiceTotal = Math.max(0, Number(invoice.totalAmount) - returnAmount);
          const totalRemainingQty = await tx.invoiceItem.aggregate({
            where: { invoiceId: invoice.id },
            _sum: { quantity: true }
          });
          const isFullReturn = Number(totalRemainingQty._sum.quantity || 0) === 0;

          await tx.invoice.update({
            where: { id: invoice.id },
            data: {
              totalAmount: updatedInvoiceTotal,
              status: isFullReturn ? 'RETURNED' : 'PARTIALLY_RETURNED'
            }
          });

          // 2.3 Calculate refund and update Debt
          let refundAmount = 0;
          if (invoice.receivable) {
            // Credit sale logic
            const currentPaid = Number(invoice.receivable.paidAmount);
            const newOriginalAmount = updatedInvoiceTotal;
            
            if (currentPaid > newOriginalAmount) {
              refundAmount = currentPaid - newOriginalAmount;
            }
            
            const nextPaid = currentPaid - refundAmount;
            const nextRemaining = Math.max(0, newOriginalAmount - nextPaid);

            await tx.receivable.update({
              where: { id: invoice.receivable.id },
              data: {
                originalAmount: newOriginalAmount,
                paidAmount: nextPaid,
                remainingAmount: nextRemaining,
                status: nextRemaining <= 0 ? 'PAID' : (nextPaid > 0 ? 'PARTIAL' : 'OPEN')
              }
            });
          } else {
            // Cash/Card sale logic (calculate net paid from payments)
            const paymentsIn = await tx.payment.aggregate({
              where: { invoiceId: invoice.id, direction: 'IN', status: 'PAID' },
              _sum: { amount: true }
            });
            const paymentsOut = await tx.payment.aggregate({
              where: { invoiceId: invoice.id, direction: 'OUT', status: 'PAID' },
              _sum: { amount: true }
            });
            const netPaid = Number(paymentsIn._sum.amount || 0) - Number(paymentsOut._sum.amount || 0);
            
            if (netPaid > updatedInvoiceTotal) {
              refundAmount = netPaid - updatedInvoiceTotal;
            }
          }

          // 2.4 Create refund payment if needed
          if (refundAmount > 0) {
            const refundMethod = (ret.refundMethod || 'CASH') as string;
            const methodMap: Record<string, 'CASH' | 'CARD' | 'BANK_TRANSFER'> = {
              CASH: 'CASH', CARD: 'CARD', STORE_BALANCE: 'CASH', BANK_TRANSFER: 'BANK_TRANSFER',
            };
            const paymentMethod = methodMap[refundMethod] ?? 'CASH';

            await tx.payment.create({
              data: {
                direction: 'OUT',
                counterpartyType: 'OTHER',
                invoiceId: invoice.id,
                method: paymentMethod,
                amount: refundAmount,
                paymentDate: new Date(),
                status: 'PAID',
                createdById: userId,
                comment: `Возврат покупателю по документу ${ret.returnNo} (Корректировка накладной ${invoice.invoiceNo})`,
              },
            });
          }
        }
      } else if (ret.type === 'CUSTOMER' && Number(ret.totalAmount || 0) > 0) {
        // Fallback for customer returns NOT linked to an invoice (blind refund)
        const refundAmount = Number(ret.totalAmount);
        const refundMethod = (ret.refundMethod || 'CASH') as string;
        const methodMap: Record<string, 'CASH' | 'CARD' | 'BANK_TRANSFER'> = {
          CASH: 'CASH', CARD: 'CARD', STORE_BALANCE: 'CASH', BANK_TRANSFER: 'BANK_TRANSFER',
        };
        const paymentMethod = methodMap[refundMethod] ?? 'CASH';

        await tx.payment.create({
          data: {
            direction: 'OUT',
            counterpartyType: 'OTHER',
            method: paymentMethod,
            amount: refundAmount,
            paymentDate: new Date(),
            status: 'PAID',
            createdById: userId,
            comment: `Возврат покупателю по документу ${ret.returnNo} (Без привязки к накладной)`,
          },
        });
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
