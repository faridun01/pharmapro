import { prisma } from '../../infrastructure/prisma';
import { auditService } from '../../services/audit.service';
import { NotFoundError, ValidationError } from '../../common/errors';
import { computeProductStatus } from '../../common/productStatus';
import { reportCache } from '../../common/cache';
import { computeBatchStatus } from '../../common/batchStatus';

export type SaleItemInput = {
  productId: string;
  batchId?: string; // Opt-in manual batch selection
  quantity: number;
  sellingPrice: number;
  discountAmount?: number;
  prescriptionPresented?: boolean;
};

export type CompleteSaleInput = {
  items: SaleItemInput[];
  discountAmount?: number; // Overall invoice discount
  taxAmount?: number;
  total: number;
  paymentType: 'CASH' | 'CARD' | 'CREDIT';
  customerName?: string;
  paidAmount?: number;
  userId: string;
}

const buildInvoiceNumber = () => {
  const now = new Date();
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  const suffix = String(now.getMilliseconds()).padStart(3, '0');
  return `CHK-${year}${month}${day}-${hours}${minutes}${seconds}-${suffix}`;
};

export class SalesService {
  async completeSale(input: CompleteSaleInput) {
    if (!input.items.length) {
      throw new ValidationError('At least one sale item is required');
    }

    const paidAmount = Number(input.paidAmount ?? input.total);
    if (paidAmount < 0) {
      throw new ValidationError('paidAmount cannot be negative');
    }

    const invoice = await prisma.$transaction(async (tx) => {

      const activeShift = await tx.cashShift.findFirst({
        where: {
          cashierId: input.userId,
          status: 'OPEN',
        },
        select: { id: true },
      });

      if (!activeShift) {
        throw new ValidationError('Open a shift before completing a sale');
      }

      const invoiceItems: Array<{
        productId: string;
        batchId: string;
        productName: string;
        batchNo: string;
        quantity: number;
        unitPrice: number;
        discountAmount: number;
        totalPrice: number;
      }> = [];

      const productIds = [...new Set(input.items.map((i) => i.productId))];

      // FIFO: Sort batches by received date
      const allProducts = await tx.product.findMany({
        where: { id: { in: productIds } },
        include: {
          batches: {
            where: { quantity: { gt: 0 } },
            orderBy: [
              { receivedAt: 'asc' }, // FIFO: prioritize oldest arrival
              { createdAt: 'asc' },
              { expiryDate: 'asc' },
            ],
          },
        },
      });
      const productMap = new Map(allProducts.map((p) => [p.id, p]));

      for (const item of input.items) {
        const quantity = Number(item.quantity);
        const sellingPrice = Number(item.sellingPrice);
        const itemDiscount = Number(item.discountAmount ?? 0);

        if (!item.productId) throw new ValidationError('productId is required');
        if (!quantity || quantity <= 0) throw new ValidationError('quantity must be a positive number');
        if (sellingPrice < 0) throw new ValidationError('sellingPrice cannot be negative');

        const product = productMap.get(item.productId);
        if (!product) throw new NotFoundError(`Product ${item.productId} not found`);
        if (product.totalStock < quantity) throw new ValidationError(`Insufficient stock for ${product.name}`);

        if (product.prescription && !item.prescriptionPresented) {
            throw new ValidationError(`Prescription is required for ${product.name}`);
        }

        let remainingToDeduct = quantity;
        const validBatches = product.batches.filter((batch) => batch.expiryDate > new Date());

        const targetBatches = item.batchId 
          ? validBatches.filter(b => b.id === item.batchId)
          : validBatches;

        if (item.batchId && targetBatches.length === 0) {
          throw new ValidationError(`Selected batch for ${product.name} is either expired or not found`);
        }

        const availableStock = targetBatches.reduce((sum, batch) => sum + batch.quantity, 0);
        if (availableStock < quantity) {
          throw new ValidationError(
            item.batchId 
              ? `Insufficient stock in selected batch for ${product.name}`
              : `Insufficient non-expired stock for ${product.name}`
          );
        }

        for (const batch of targetBatches) {
          if (remainingToDeduct <= 0) break;

          const deduct = Math.min(batch.quantity, remainingToDeduct);
          if (deduct <= 0) continue;

          const nextQty = Math.max(0, Number(batch.quantity) - deduct);
          const nextCurrent = Math.max(0, Number(batch.currentQty || batch.quantity) - deduct);
          const nextAvailable = Math.max(0, Number(batch.availableQty || batch.quantity) - deduct);

          await tx.batch.update({
            where: { id: batch.id },
            data: {
              quantity: nextQty,
              currentQty: nextCurrent,
              availableQty: nextAvailable,
              status: computeBatchStatus(batch.expiryDate),
            },
          });

          if (batch.warehouseId) {
            await tx.warehouseStock.upsert({
              where: {
                warehouseId_productId: {
                  warehouseId: batch.warehouseId,
                  productId: product.id,
                },
              },
              update: { quantity: { decrement: deduct } },
              create: {
                warehouseId: batch.warehouseId,
                productId: product.id,
                quantity: 0,
              },
            });
          }

          await tx.batchMovement.create({
            data: {
              batchId: batch.id,
              type: 'DISPATCH',
              quantity: deduct,
              description: `POS sale${item.batchId ? ' (Manual selection)' : ''}`,
              userId: input.userId,
            },
          });

          invoiceItems.push({
            productId: product.id,
            batchId: batch.id,
            productName: product.name,
            batchNo: batch.batchNumber,
            quantity: deduct,
            unitPrice: sellingPrice,
            discountAmount: (itemDiscount / quantity) * deduct,
            totalPrice: (deduct * sellingPrice) - ((itemDiscount / quantity) * deduct),
          });

          remainingToDeduct -= deduct;
        }

        const newTotalStock = product.totalStock - quantity;
        await tx.product.update({
          where: { id: product.id },
          data: {
            totalStock: newTotalStock,
            status: computeProductStatus(newTotalStock, product.minStock),
          },
        });
      }

      const createdInvoice = await tx.invoice.create({
        data: {
          invoiceNo: buildInvoiceNumber(),
          totalAmount: Number(input.total),
          taxAmount: Number(input.taxAmount ?? 0),
          discount: Number(input.discountAmount ?? 0),
          paymentType: input.paymentType,
          customer: input.customerName,
          status: input.paymentType === 'CREDIT' ? 'PENDING' : 'PAID',
          paymentStatus: input.paymentType === 'CREDIT' ? 'UNPAID' : 'PAID',
          userId: input.userId,
          cashShiftId: activeShift.id,
          items: {
            create: invoiceItems as any,
          },
        },
        include: {
          items: true,
        },
      });

      if (input.paymentType === 'CREDIT') {
        await tx.debt.create({
          data: {
            invoiceId: createdInvoice.id,
            customerName: input.customerName,
            originalAmount: Number(input.total),
            remainingAmount: Number(input.total),
            status: 'OPEN',
          },
        });
      }

      await auditService.log({
        userId: input.userId,
        module: 'sales',
        action: 'COMPLETE_SALE',
        entity: 'INVOICE',
        entityId: createdInvoice.id,
        newValue: {
          invoiceNo: createdInvoice.invoiceNo,
          totalAmount: createdInvoice.totalAmount,
          items: invoiceItems.length,
          paymentType: createdInvoice.paymentType,
        },
      }, tx);

      if (paidAmount > 0 && input.paymentType !== 'CREDIT') {
        await tx.payment.create({
          data: {
            direction: 'IN',
            counterpartyType: 'OTHER',
            method:
              input.paymentType === 'CARD'
                ? 'CARD'
                : 'CASH',
            amount: Math.min(paidAmount, Number(input.total)),
            paymentDate: new Date(),
            status: 'PAID',
            invoiceId: createdInvoice.id,
            createdById: input.userId,
            comment: `Auto payment for invoice ${createdInvoice.invoiceNo}`,
          },
        });
      }

      return createdInvoice;
    }, {
      maxWait: 10000,
      timeout: 20000,
    });

    // Invalidate caches after successful sale
    // Dashboard metrics depend on invoices and inventory
    reportCache.invalidatePattern(/^metrics:dashboard:/);
    // Inventory status cache depends on product stock levels
    reportCache.invalidatePattern(/^metrics:inventory:/);
    // Finance reports use invoice data
    reportCache.invalidatePattern(/^report:finance:/);

    return invoice;
  }

  async voidSale(invoiceId: string, userId: string) {
    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        items: true,
        payments: true,
      },
    });

    if (!invoice) throw new NotFoundError('Invoice not found');
    if (invoice.status === 'CANCELLED') throw new ValidationError('Invoice is already cancelled');
    if (invoice.status === 'RETURNED' || invoice.status === 'PARTIALLY_RETURNED') {
      throw new ValidationError('Returned invoices cannot be voided, use return workflow');
    }

    return await prisma.$transaction(async (tx) => {
      // 1. Restore stock
      for (const item of invoice.items) {
        await tx.batch.update({
          where: { id: item.batchId },
          data: {
            quantity: { increment: item.quantity },
            availableQty: { increment: item.quantity },
            currentQty: { increment: item.quantity },
          },
        });

        await tx.product.update({
          where: { id: item.productId },
          data: { totalStock: { increment: item.quantity } },
        });

        await tx.batchMovement.create({
          data: {
            batchId: item.batchId,
            type: 'RESTOCK',
            quantity: item.quantity,
            description: `Void sale: ${invoice.invoiceNo}`,
            userId,
          },
        });
      }

      // 2. Cancel financial entries

      if (invoice.payments.length > 0) {
        await tx.payment.updateMany({
          where: { invoiceId },
          data: { status: 'CANCELLED' },
        });
      }

      // 3. Update invoice status
      const updatedInvoice = await tx.invoice.update({
        where: { id: invoiceId },
        data: {
          status: 'CANCELLED',
          paymentStatus: 'CANCELLED',
          comment: `Voided by ${userId} at ${new Date().toISOString()}`,
        },
      });

      await auditService.log({
        userId,
        module: 'sales',
        action: 'VOID_SALE',
        entity: 'INVOICE',
        entityId: invoiceId,
        newValue: { invoiceNo: invoice.invoiceNo, status: 'CANCELLED' },
      }, tx);

      return updatedInvoice;
    });
  }

  async payDebt(invoiceId: string, input: { amount: number, paymentMethod: 'CASH' | 'CARD', userId: string }) {
    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: { debt: true }
    });

    if (!invoice) throw new NotFoundError('Invoice not found');
    if (invoice.paymentType !== 'CREDIT') throw new ValidationError('This is not a debt invoice');
    if (invoice.status === 'PAID') throw new ValidationError('This debt is already paid');

    const result = await prisma.$transaction(async (tx) => {
      const amount = Number(input.amount);
      
      // Resiliency: if debt record is missing for some reason, create it now
      let debt = invoice.debt;
      if (!debt) {
        debt = await tx.debt.create({
          data: {
            invoiceId: invoice.id,
            customerName: invoice.customer || 'Аноним',
            originalAmount: Number(invoice.totalAmount),
            remainingAmount: Number(invoice.totalAmount),
            status: 'OPEN'
          }
        });
      }

      // Update Debt
      const currentPaid = Number(debt.paidAmount || 0);
      const newPaid = currentPaid + amount;
      const totalAmount = Number(invoice.totalAmount);
      const isFullyPaid = newPaid >= totalAmount;

      const debtRecord = await tx.debt.update({
        where: { id: debt.id },
        data: {
          paidAmount: newPaid,
          remainingAmount: Math.max(0, totalAmount - newPaid),
          status: isFullyPaid ? 'PAID' : 'PARTIAL'
        }
      });

      // Record Payment
      await tx.payment.create({
        data: {
          direction: 'IN',
          counterpartyType: 'OTHER',
          method: input.paymentMethod,
          amount: amount,
          paymentDate: new Date(),
          status: 'PAID',
          invoiceId: invoice.id,
          createdById: input.userId,
          comment: `Debt payment for invoice ${invoice.invoiceNo}`,
        }
      });

      // Update Invoice Status if fully paid
      if (isFullyPaid) {
        await tx.invoice.update({
          where: { id: invoiceId },
          data: {
            status: 'PAID',
            paymentStatus: 'PAID'
          }
        });
      } else {
         await tx.invoice.update({
          where: { id: invoiceId },
          data: {
            paymentStatus: 'PARTIALLY_PAID'
          }
        });
      }

      return debtRecord;
    });

    reportCache.invalidatePattern(/^metrics:dashboard:/);
    reportCache.invalidatePattern(/^report:finance:/);
    reportCache.invalidatePattern(/^report:debts:/);

    return result;
  }
}

export const salesService = new SalesService();
