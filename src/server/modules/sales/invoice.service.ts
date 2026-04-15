import { Prisma } from '@prisma/client';
import { prisma } from '../../infrastructure/prisma';
import { auditService } from '../../services/audit.service';
import { NotFoundError, ValidationError } from '../../common/errors';
import { computeProductStatus } from '../../common/productStatus';
import { z } from 'zod';

const PaymentPayloadSchema = z.object({
  amount: z.number().positive('Amount must be positive'),
  method: z.enum(['CASH', 'CARD', 'BANK_TRANSFER']).optional().default('CASH'),
  comment: z.string().optional(),
});

const ReturnPayloadSchema = z.object({
  reason: z.string().optional().default('Customer return'),
  refundMethod: z.enum(['CASH', 'CARD']).optional().default('CASH'),
  items: z.array(z.object({
    id: z.string(),
    quantity: z.number().positive(),
  })).min(1, 'At least one item must be returned'),
});

const UpdateInvoiceSchema = z.object({
  customer: z.string().optional(),
  taxAmount: z.number().optional(),
  discount: z.number().optional(),
  totalAmount: z.number().optional(),
  items: z.array(z.object({
    id: z.string(),
    quantity: z.number().positive(),
    unitPrice: z.number().min(0),
  })).optional(),
});

/** Collision-safe return number: timestamp + random suffix */
const generateReturnNo = () => {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `RET-${ts}-${rand}`;
};

const mapPaymentType = (value: string | undefined): 'CASH' | 'CARD' => {
  const normalized = (value || 'CASH').toUpperCase();
  if (normalized === 'CASH' || normalized === 'CARD') {
    return normalized as any;
  }
  return 'CASH';
};

const mapRefundMethod = (value: string | undefined): 'CASH' | 'CARD' => {
  const normalized = (value || 'CASH').toUpperCase();
  if (normalized === 'CASH' || normalized === 'CARD') {
    return normalized as any;
  }
  return 'CASH';
};

const mapPaymentMethod = (value: string | undefined): 'CASH' | 'CARD' | 'BANK_TRANSFER' => {
  const normalized = (value || 'CASH').toUpperCase();
  if (normalized === 'CASH' || normalized === 'CARD' || normalized === 'BANK_TRANSFER') {
    return normalized as any;
  }
  return 'CASH';
};

export class InvoiceService {
  async getInvoices(params: { page: number; limit: number; search?: string }) {
    const { page, limit, search } = params;
    const where: any = {
      ...(search ? {
        OR: [
          { invoiceNo: { contains: search, mode: 'insensitive' } },
          { customer: { contains: search, mode: 'insensitive' } },
          { id: { contains: search, mode: 'insensitive' } },
        ]
      } : {})
    };

    const [invoices, total] = await Promise.all([
      prisma.invoice.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          invoiceNo: true,
          customer: true,
          totalAmount: true,
          taxAmount: true,
          discount: true,
          paymentType: true,
          status: true,
          paymentStatus: true,
          comment: true,
          userId: true,
          createdAt: true,
          updatedAt: true,
          cashShiftId: true,
          items: {
            select: {
              id: true,
              productId: true,
              batchId: true,
              productName: true,
              batchNo: true,
              quantity: true,
              unitPrice: true,
              totalPrice: true,
            },
          },
          payments: {
            select: {
              amount: true,
            },
          },
          returns: {
            where: { status: 'COMPLETED' },
            select: {
              id: true,
              totalAmount: true,
              items: {
                select: {
                  productId: true,
                  batchId: true,
                  quantity: true,
                  unitPrice: true,
                  lineTotal: true,
                },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.invoice.count({ where }),
    ]);

    const hydratedInvoices = invoices.map((invoice) => {
      const actualPaidAmount = invoice.payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
      const outstandingAmount = Math.max(0, Number(invoice.totalAmount || 0) - actualPaidAmount);
      const returnedAmountTotal = invoice.returns.reduce((sum, ret) => sum + Number(ret.totalAmount || 0), 0);

      const returnedTotals = new Map<string, number>();
      for (const ret of invoice.returns) {
        for (const item of ret.items) {
          const key = `${item.productId}:${item.batchId || ''}`;
          returnedTotals.set(key, (returnedTotals.get(key) || 0) + Number(item.quantity || 0));
        }
      }

      const hasCompletedReturns = invoice.returns.length > 0;
      const fullyReturned = hasCompletedReturns && invoice.items.every((item) => {
        const key = `${item.productId}:${item.batchId || ''}`;
        return (returnedTotals.get(key) || 0) >= Number(item.quantity || 0);
      });

      const normalizedPaymentStatus = outstandingAmount <= 0 ? 'PAID' : actualPaidAmount > 0 ? 'PARTIALLY_PAID' : 'UNPAID';

      return {
        ...invoice,
        outstandingAmount,
        paidAmountTotal: actualPaidAmount,
        returnedAmountTotal,
        paymentStatus: normalizedPaymentStatus as any,
        status: (fullyReturned ? 'RETURNED' : hasCompletedReturns ? 'PARTIALLY_RETURNED' : invoice.status) as any,
      };
    });

    return {
      items: hydratedInvoices,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      }
    };
  }

  async getInvoiceById(id: string) {
    const invoice = await prisma.invoice.findUnique({
      where: { id },
      include: {
        items: true,
        payments: true,
        returns: { include: { items: true } },
      },
    });
    if (!invoice) throw new NotFoundError('Invoice not found');
    return { ...invoice, createdAt: new Date(invoice.createdAt) };
  }

  async addPayment(invoiceId: string, rawPayload: any, userId: string, userRole: any) {
    const parseResult = PaymentPayloadSchema.safeParse(rawPayload);
    if (!parseResult.success) {
      throw new ValidationError(`Invalid payment data: ${parseResult.error.issues.map(e => e.message).join(', ')}`);
    }
    const payload = parseResult.data;
    const paymentAmount = payload.amount;

    return prisma.$transaction(async (tx) => {
      const invoice = await tx.invoice.findUnique({
        where: { id: invoiceId },
      });

      if (!invoice) throw new NotFoundError('Invoice not found');
      if (invoice.status === 'CANCELLED' || invoice.status === 'RETURNED') {
        throw new ValidationError('Cannot add payment to cancelled or returned invoice');
      }

      const aggregate = await tx.payment.aggregate({
        where: { invoiceId },
        _sum: { amount: true },
      });

      const alreadyPaid = Number(aggregate._sum.amount || 0);
      const outstanding = Math.max(0, Number(invoice.totalAmount) - alreadyPaid);
      if (outstanding <= 0) throw new ValidationError('Invoice is already fully paid');

      const appliedAmount = Math.min(paymentAmount, outstanding);
      const nextPaid = alreadyPaid + appliedAmount;
      const nextOutstanding = Math.max(0, Number(invoice.totalAmount) - nextPaid);

      await tx.payment.create({
        data: {
          direction: 'IN',
          counterpartyType: 'OTHER',
          method: mapPaymentMethod(payload.method),
          amount: appliedAmount,
          paymentDate: new Date(),
          status: 'PAID',
          invoiceId: invoice.id,
          createdById: userId,
          comment: payload.comment || `Payment for invoice ${invoice.invoiceNo}`,
        },
      });

      const nextPaymentStatus = nextOutstanding <= 0 ? 'PAID' : nextPaid > 0 ? 'PARTIALLY_PAID' : 'UNPAID';

      const savedInvoice = await tx.invoice.update({
        where: { id: invoice.id },
        data: {
          paymentStatus: nextPaymentStatus,
          status: nextOutstanding <= 0 ? 'PAID' : 'PENDING',
        },
        include: { items: true },
      });


      await auditService.log({
        userId,
        userRole,
        module: 'sales',
        action: 'ADD_INVOICE_PAYMENT',
        entity: 'INVOICE',
        entityId: invoice.id,
        newValue: { amount: appliedAmount, method: payload.method, paymentStatus: nextPaymentStatus },
      }, tx);

      return savedInvoice;
    });
  }

  async processReturn(invoiceId: string, rawPayload: any, userId: string, userRole: any) {
    const parseResult = ReturnPayloadSchema.safeParse(rawPayload);
    if (!parseResult.success) {
      throw new ValidationError(`Invalid return data: ${parseResult.error.issues.map(e => e.message).join(', ')}`);
    }
    const payload = parseResult.data;

    return prisma.$transaction(async (tx) => {
      const invoice = await tx.invoice.findUnique({
        where: { id: invoiceId },
        include: { items: true },
      });

      if (!invoice) throw new NotFoundError('Invoice not found');
      if (invoice.status === 'CANCELLED' || invoice.status === 'RETURNED') {
        throw new ValidationError('Invoice cannot be returned');
      }

      const returnItems = [];
      let returnTotal = 0;

      for (const returnItem of payload.items) {
        const lineItem = invoice.items.find(i => i.id === returnItem.id);
        if (!lineItem) throw new ValidationError(`Item ${returnItem.id} not found in invoice`);

        const alreadyReturned = await tx.returnItem.aggregate({
          where: { invoiceItemId: lineItem.id, return: { status: 'COMPLETED' } },
          _sum: { quantity: true }
        });

        const maxReturnable = Number(lineItem.quantity) - Number(alreadyReturned._sum.quantity || 0);
        if (returnItem.quantity > maxReturnable) {
          throw new ValidationError(`Cannot return more than sold for item ${lineItem.productName}`);
        }

        returnItems.push({
          productId: lineItem.productId,
          batchId: lineItem.batchId,
          invoiceItemId: lineItem.id,
          quantity: returnItem.quantity,
          unitPrice: lineItem.unitPrice,
          lineTotal: Number(lineItem.unitPrice) * returnItem.quantity,
        });

        returnTotal += Number(lineItem.unitPrice) * returnItem.quantity;

        // Restore stock
        if (lineItem.batchId) {
          await tx.batch.update({
            where: { id: lineItem.batchId },
            data: { 
              quantity: { increment: returnItem.quantity },
              availableQty: { increment: returnItem.quantity },
              currentQty: { increment: returnItem.quantity },
            }
          });

          await tx.batchMovement.create({
            data: {
              batchId: lineItem.batchId,
              type: 'RETURN',
              quantity: returnItem.quantity,
              date: new Date(),
              description: `Return from invoice ${invoice.invoiceNo}`,
              userId: userId,
            }
          });
        }
      }

      const invoiceReturn = await tx.return.create({
        data: {
          returnNo: generateReturnNo(),
          type: 'CUSTOMER',
          invoiceId: invoice.id,
          totalAmount: returnTotal,
          refundMethod: payload.refundMethod,
          status: 'COMPLETED',
          reason: payload.reason,
          createdById: userId,
          items: { create: returnItems }
        }
      });

      // Update invoice status if everything returned
      const totalQuantity = invoice.items.reduce((sum, i) => sum + Number(i.quantity), 0);
      const totalReturned = await tx.returnItem.aggregate({
        where: { return: { invoiceId, status: 'COMPLETED' } },
        _sum: { quantity: true }
      });
      
      const isFullReturn = Number(totalReturned._sum.quantity || 0) >= totalQuantity;
      await tx.invoice.update({
        where: { id: invoiceId },
        data: { status: isFullReturn ? 'RETURNED' : 'PARTIALLY_RETURNED' }
      });


      await auditService.log({
        userId,
        userRole,
        module: 'sales',
        action: 'PROCESS_INVOICE_RETURN',
        entity: 'INVOICE',
        entityId: invoice.id,
        newValue: { returnId: invoiceReturn.id, total: returnTotal }
      }, tx);

      return invoiceReturn;
    });
  }

  async deleteInvoice(invoiceId: string, userId: string, userRole: any) {
    return prisma.$transaction(async (tx) => {
      const invoice = await tx.invoice.findUnique({
        where: { id: invoiceId },
        include: { items: true, payments: true }
      });

      if (!invoice) throw new NotFoundError('Invoice not found');
      
      // Logic for deleting: roll back stock, roll back payments, mark as CANCELLED or delete
      // In this system, we mark as inactive/cancelled to preserve audit trail
      
      for (const item of invoice.items) {
        if (item.batchId) {
          await tx.batch.update({
            where: { id: item.batchId },
            data: { 
              quantity: { increment: item.quantity },
              availableQty: { increment: item.quantity },
              currentQty: { increment: item.quantity },
            }
          });
        }
      }

      await tx.invoice.update({
        where: { id: invoiceId },
        data: { status: 'CANCELLED' }
      });

      await auditService.log({
        userId,
        userRole,
        module: 'sales',
        action: 'DELETE_INVOICE',
        entity: 'INVOICE',
        entityId: invoiceId,
        newValue: { status: 'CANCELLED' }
      }, tx);
    });
  }

  async updateInvoice(invoiceId: string, rawPayload: any, userId: string, userRole: any) {
    const parseResult = UpdateInvoiceSchema.safeParse(rawPayload);
    if (!parseResult.success) {
      throw new ValidationError(`Invalid update data: ${parseResult.error.issues.map(e => e.message).join(', ')}`);
    }
    const payload = parseResult.data;

    return prisma.$transaction(async (tx) => {
      const existing = await tx.invoice.findUnique({
        where: { id: invoiceId },
        include: { items: true }
      });

      if (!existing) throw new NotFoundError('Invoice not found');
      if (existing.status === 'CANCELLED' || existing.status === 'RETURNED') {
        throw new ValidationError('Cannot update cancelled or returned invoice');
      }

      // Simple header updates
      const updateData: any = {};
      if (payload.customer !== undefined) updateData.customer = payload.customer;
      if (payload.taxAmount !== undefined) updateData.taxAmount = payload.taxAmount;
      if (payload.discount !== undefined) updateData.discount = payload.discount;
      if (payload.totalAmount !== undefined) updateData.totalAmount = payload.totalAmount;

      // Updating items is complex because of stock
      // For this production-grade refactoring, we'll only allow header updates 
      // or simple price/qty adjustments IF stock was not already moved much.
      // But for now, we'll implement header and price updates.
      
      if (payload.items) {
          for (const item of payload.items) {
              const existingItem = existing.items.find(i => i.id === item.id);
              if (!existingItem) continue;

              if (item.quantity !== undefined && item.quantity !== Number(existingItem.quantity)) {
                  // Roll back old stock, apply new
                  const diff = item.quantity - Number(existingItem.quantity);
                  if (existingItem.batchId) {
                      await tx.batch.update({
                          where: { id: existingItem.batchId },
                          data: { 
                              quantity: { decrement: diff },
                              availableQty: { decrement: diff },
                              currentQty: { decrement: diff },
                          }
                      });
                  }
              }

              await tx.invoiceItem.update({
                  where: { id: item.id },
                  data: { 
                      quantity: item.quantity,
                      unitPrice: item.unitPrice,
                      totalPrice: (item.quantity || Number(existingItem.quantity)) * (item.unitPrice || Number(existingItem.unitPrice))
                  }
              });
          }
      }

      // Recalculate payment status based on new total and existing payments
      const aggregate = await tx.payment.aggregate({
        where: { invoiceId, status: 'PAID' },
        _sum: { amount: true },
      });
      const paidTotal = Number(aggregate._sum.amount || 0);
      const newTotal = payload.totalAmount ?? Number(existing.totalAmount);
      const remaining = Math.max(0, newTotal - paidTotal);
      
      const newPaymentStatus = remaining <= 0 ? 'PAID' : paidTotal > 0 ? 'PARTIALLY_PAID' : 'UNPAID';

      const updated = await tx.invoice.update({
        where: { id: invoiceId },
        data: {
            ...updateData,
            paymentStatus: newPaymentStatus,
        },
        include: { items: true }
      });

      await auditService.log({
        userId,
        userRole,
        module: 'sales',
        action: 'UPDATE_INVOICE',
        entity: 'INVOICE',
        entityId: invoiceId,
        oldValue: existing,
        newValue: payload
      }, tx);

      return updated;
    });
  }
}

export const invoiceService = new InvoiceService();
