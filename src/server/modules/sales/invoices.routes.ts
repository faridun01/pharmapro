import { Router } from 'express';
import { authenticate, type AuthedRequest } from '../../common/auth';
import { asyncHandler } from '../../common/http';
import { prisma } from '../../infrastructure/prisma';
import { auditService } from '../../services/audit.service';
import { NotFoundError, ValidationError } from '../../common/errors';
import { computeProductStatus } from '../../common/productStatus';
import { resolveCustomerDueDate } from '../../common/customerTerms';
import { reportCache } from '../../common/cache';

export const invoicesRouter = Router();

/** Collision-safe return number: timestamp + random suffix */
const generateReturnNo = () => {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `RET-${ts}-${rand}`;
};

const mapPaymentType = (value: string | undefined): 'CASH' | 'CARD' | 'CREDIT' | 'STORE_BALANCE' => {
  const normalized = (value || 'CASH').toUpperCase().replace(/\s+/g, '_');
  if (normalized === 'CASH' || normalized === 'CARD' || normalized === 'CREDIT' || normalized === 'STORE_BALANCE') {
    return normalized;
  }
  return 'CASH';
};

const mapRefundMethod = (value: string | undefined): 'CASH' | 'CARD' | 'STORE_BALANCE' => {
  const normalized = (value || 'CASH').toUpperCase().replace(/\s+/g, '_');
  if (normalized === 'CASH' || normalized === 'CARD' || normalized === 'STORE_BALANCE') {
    return normalized;
  }
  return 'CASH';
};

const mapPaymentMethod = (value: string | undefined): 'CASH' | 'CARD' | 'BANK_TRANSFER' => {
  const normalized = (value || 'CASH').toUpperCase().replace(/\s+/g, '_');
  if (normalized === 'CASH' || normalized === 'CARD' || normalized === 'BANK_TRANSFER') {
    return normalized;
  }
  return 'CASH';
};

const canDeleteInvoice = (role: string | undefined) => {
  const normalized = String(role || '').toUpperCase();
  return normalized === 'ADMIN' || normalized === 'OWNER';
};

const normalizeInvoiceItemQuantity = (value: unknown) => {
  const quantity = Math.floor(Number(value));
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new ValidationError('Invoice item quantity must be a positive integer');
  }
  return quantity;
};

const normalizeInvoiceItemUnitPrice = (value: unknown, fallback: number) => {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  const unitPrice = Number(value);
  if (!Number.isFinite(unitPrice) || unitPrice < 0) {
    throw new ValidationError('Invoice item unit price must be a valid non-negative number');
  }
  return unitPrice;
};

invoicesRouter.get('/', authenticate, asyncHandler(async (req, res) => {
  const pageRaw = Number(req.query.page ?? 1);
  const pageSizeRaw = Number(req.query.pageSize ?? 0);
  const usePagination = Number.isFinite(pageSizeRaw) && pageSizeRaw > 0;
  const page = Math.max(1, Number.isFinite(pageRaw) ? Math.floor(pageRaw) : 1);
  const pageSize = usePagination ? Math.min(500, Math.max(1, Math.floor(pageSizeRaw))) : 0;

  const [invoices, totalCount] = await Promise.all([
    prisma.invoice.findMany({
      ...(usePagination ? { skip: (page - 1) * pageSize, take: pageSize } : {}),
      select: {
        id: true,
        invoiceNo: true,
        customer: true,
        customerId: true,
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
        receivable: {
          select: {
            id: true,
            originalAmount: true,
            paidAmount: true,
            remainingAmount: true,
            status: true,
            dueDate: true,
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
    usePagination ? prisma.invoice.count() : Promise.resolve(0),
  ]);

  const hydratedInvoices = invoices.map((invoice) => {
    const actualPaidAmount = invoice.payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
    const outstandingAmount = Math.max(0, Number(invoice.totalAmount || 0) - actualPaidAmount);
    const returnedTotals = new Map<string, number>();
    const returnedAmountTotal = invoice.returns.reduce((sum, ret) => {
      const itemsTotal = ret.items.reduce((itemSum, item) => {
        const lineTotal = Number(item.lineTotal || 0);
        if (lineTotal > 0) return itemSum + lineTotal;
        return itemSum + Number(item.quantity || 0) * Number(item.unitPrice || 0);
      }, 0);
      return sum + Math.max(Number(ret.totalAmount || 0), itemsTotal);
    }, 0);

    for (const ret of invoice.returns) {
      for (const item of ret.items) {
        const key = `${item.productId}:${item.batchId || ''}`;
        returnedTotals.set(key, Number(returnedTotals.get(key) || 0) + Number(item.quantity || 0));
      }
    }

    const hasCompletedReturns = invoice.returns.length > 0;
    const fullyReturned = hasCompletedReturns && invoice.items.every((item) => {
      const key = `${item.productId}:${item.batchId || ''}`;
      return Number(returnedTotals.get(key) || 0) >= Number(item.quantity || 0);
    });

    const normalizedPaymentStatus = outstandingAmount <= 0
      ? 'PAID'
      : actualPaidAmount > 0
        ? 'PARTIALLY_PAID'
        : 'UNPAID';

    return {
      ...invoice,
      receivables: invoice.receivable ? [invoice.receivable] : [],
      outstandingAmount,
      paidAmountTotal: actualPaidAmount,
      returnedAmountTotal,
      paymentStatus: normalizedPaymentStatus,
      status: fullyReturned ? 'RETURNED' : hasCompletedReturns ? 'PARTIALLY_RETURNED' : invoice.status,
    };
  });

  if (usePagination) {
    res.setHeader('X-Page', String(page));
    res.setHeader('X-Page-Size', String(pageSize));
    res.setHeader('X-Total-Count', String(totalCount));
    res.setHeader('X-Page-Count', String(Math.max(1, Math.ceil(totalCount / pageSize))));
  }

  res.json(hydratedInvoices);
}));

invoicesRouter.post('/:id/payments', authenticate, asyncHandler(async (req, res) => {
  const authedReq = req as AuthedRequest;
  const invoiceId = req.params.id;
  const payload = req.body ?? {};

  const paymentAmount = Number(payload.amount);
  if (!Number.isFinite(paymentAmount) || paymentAmount <= 0) {
    throw new ValidationError('amount must be a positive number');
  }

  const updatedInvoice = await prisma.$transaction(async (tx) => {
    const invoice = await tx.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        receivable: true,
      },
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
    if (outstanding <= 0) {
      throw new ValidationError('Invoice is already fully paid');
    }

    const appliedAmount = Math.min(paymentAmount, outstanding);
    const nextPaid = alreadyPaid + appliedAmount;
    const nextOutstanding = Math.max(0, Number(invoice.totalAmount) - nextPaid);

    await tx.payment.create({
      data: {
        direction: 'IN',
        counterpartyType: invoice.customerId ? 'CUSTOMER' : 'OTHER',
        customerId: invoice.customerId || null,
        method: mapPaymentMethod(payload.method),
        amount: appliedAmount,
        paymentDate: new Date(),
        status: 'PAID',
        invoiceId: invoice.id,
        createdById: authedReq.user.id,
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
      include: {
        items: true,
        receivable: true,
      },
    });

    if (invoice.customerId) {
      const existingReceivable = invoice.receivable;
      if (existingReceivable) {
        await tx.receivable.update({
          where: { id: existingReceivable.id },
          data: {
            paidAmount: nextPaid,
            remainingAmount: nextOutstanding,
            status: nextOutstanding <= 0 ? 'PAID' : nextPaid > 0 ? 'PARTIAL' : 'OPEN',
          },
        });
      } else if (nextOutstanding > 0) {
        const dueDate = await resolveCustomerDueDate(tx, invoice.customerId, new Date(invoice.createdAt));
        await tx.receivable.create({
          data: {
            customerId: invoice.customerId,
            invoiceId: invoice.id,
            originalAmount: Number(invoice.totalAmount),
            paidAmount: nextPaid,
            remainingAmount: nextOutstanding,
            dueDate,
            status: nextPaid > 0 ? 'PARTIAL' : 'OPEN',
          },
        });
      }
    }

    await auditService.log({
      userId: authedReq.user.id,
      userRole: authedReq.user.role as any,
      module: 'sales',
      action: 'ADD_INVOICE_PAYMENT',
      entity: 'INVOICE',
      entityId: invoice.id,
      newValue: {
        amount: appliedAmount,
        method: mapPaymentMethod(payload.method),
        paymentStatus: nextPaymentStatus,
        remainingAmount: nextOutstanding,
      },
    }, tx);

    return savedInvoice;
  });

  res.status(201).json(updatedInvoice);
}));

invoicesRouter.post('/', authenticate, asyncHandler(async (req, res) => {
  const authedReq = req as AuthedRequest;
  const { items, ...invoiceData } = req.body ?? {};

  const created = await prisma.invoice.create({
    data: {
      invoiceNo: invoiceData.invoiceNo,
      customer: invoiceData.customer,
      totalAmount: invoiceData.totalAmount,
      taxAmount: invoiceData.taxAmount ?? 0,
      discount: invoiceData.discount ?? 0,
      paymentType: mapPaymentType(invoiceData.paymentType),
      status: 'PAID',
      userId: authedReq.user.id,
      items: {
        create: (items || []).map((item: any) => ({
          productId: item.productId,
          batchId: item.batchId,
          productName: item.productName,
          batchNo: item.batchNo,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          totalPrice: item.totalPrice,
        })),
      },
    },
    include: { items: true },
  });

  await auditService.log({
    userId: authedReq.user.id,
    userRole: authedReq.user.role as any,
    module: 'sales',
    action: 'CREATE_INVOICE',
    entity: 'INVOICE',
    entityId: created.id,
    newValue: invoiceData,
  });

  res.status(201).json(created);
}));

invoicesRouter.patch('/:id', authenticate, asyncHandler(async (req, res) => {
  const authedReq = req as AuthedRequest;
  const invoiceId = req.params.id;
  const payload = req.body ?? {};

  const updated = await prisma.$transaction(async (tx) => {
    const existing = await tx.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        items: true,
        receivable: true,
      },
    });

    if (!existing) throw new NotFoundError('Invoice not found');
    if (existing.status === 'RETURNED') throw new ValidationError('Returned invoice cannot be edited');

    const nextTaxAmount = typeof payload.taxAmount === 'number' ? payload.taxAmount : Number(existing.taxAmount || 0);
    const nextDiscount = typeof payload.discount === 'number' ? payload.discount : Number(existing.discount || 0);
    const nextCustomer = typeof payload.customer === 'string' ? payload.customer : existing.customer;
    const itemsPayload = Array.isArray(payload.items) ? payload.items : null;

    if (itemsPayload) {
      const existingItemsById = new Map(existing.items.map((item) => [item.id, item]));

      for (const rawItem of itemsPayload) {
        const itemId = String(rawItem?.id || '');
        const existingItem = existingItemsById.get(itemId);
        if (!existingItem) {
          throw new ValidationError(`Invoice item not found: ${itemId}`);
        }

        const nextQuantity = normalizeInvoiceItemQuantity(rawItem?.quantity);
        const nextUnitPrice = normalizeInvoiceItemUnitPrice(rawItem?.unitPrice, Number(existingItem.unitPrice || 0));
        const delta = nextQuantity - Number(existingItem.quantity || 0);

        if (delta !== 0) {
          const batch = await tx.batch.findUnique({ where: { id: existingItem.batchId } });
          if (!batch) {
            throw new ValidationError(`Batch not found for item ${existingItem.productName}`);
          }

          const product = await tx.product.findUnique({ where: { id: existingItem.productId } });
          if (!product) {
            throw new ValidationError(`Product not found for item ${existingItem.productName}`);
          }

          if (delta > 0) {
            const batchAvailable = Number(batch.availableQty ?? batch.quantity ?? 0);
            const productAvailable = Number(product.totalStock || 0);
            if (batchAvailable < delta || productAvailable < delta) {
              throw new ValidationError(`Insufficient stock to increase quantity for ${existingItem.productName}`);
            }
          }

          const nextBatchQuantity = Math.max(0, Number(batch.quantity || 0) - delta);
          const nextCurrentQty = Math.max(0, Number(batch.currentQty ?? batch.quantity ?? 0) - delta);
          const nextAvailableQty = Math.max(0, Number(batch.availableQty ?? batch.quantity ?? 0) - delta);
          const nextProductStock = Math.max(0, Number(product.totalStock || 0) - delta);

          await tx.batch.update({
            where: { id: batch.id },
            data: {
              quantity: nextBatchQuantity,
              currentQty: nextCurrentQty,
              availableQty: nextAvailableQty,
            },
          });

          await tx.product.update({
            where: { id: product.id },
            data: {
              totalStock: nextProductStock,
              status: computeProductStatus(nextProductStock, product.minStock),
            },
          });

          if (batch.warehouseId) {
            await tx.warehouseStock.upsert({
              where: {
                warehouseId_productId: {
                  warehouseId: batch.warehouseId,
                  productId: existingItem.productId,
                },
              },
              update: delta > 0 ? { quantity: { decrement: delta } } : { quantity: { increment: Math.abs(delta) } },
              create: {
                warehouseId: batch.warehouseId,
                productId: existingItem.productId,
                quantity: delta > 0 ? 0 : Math.abs(delta),
              },
            });
          }

          await tx.batchMovement.create({
            data: {
              batchId: batch.id,
              type: 'ADJUSTMENT',
              quantity: Math.abs(delta),
              description: `Invoice edited: ${existing.invoiceNo} (${delta > 0 ? 'increase sale qty' : 'decrease sale qty'})`,
              userId: authedReq.user.id,
            },
          });
        }

        await tx.invoiceItem.update({
          where: { id: existingItem.id },
          data: {
            quantity: nextQuantity,
            unitPrice: nextUnitPrice,
            totalPrice: nextQuantity * nextUnitPrice,
          },
        });
      }
    }

    const refreshedItems = await tx.invoiceItem.findMany({ where: { invoiceId } });
    const subtotal = refreshedItems.reduce((sum, item) => sum + Number(item.totalPrice || 0), 0);
    const nextTotalAmount = itemsPayload
      ? Math.max(0, subtotal + nextTaxAmount - nextDiscount)
      : typeof payload.totalAmount === 'number'
        ? payload.totalAmount
        : Number(existing.totalAmount || 0);

    const paymentAggregate = await tx.payment.aggregate({
      where: { invoiceId },
      _sum: { amount: true },
    });
    const paidAmount = Number(paymentAggregate._sum.amount || 0);
    const effectivePaidAmount = Math.min(paidAmount, nextTotalAmount);
    const remainingAmount = Math.max(0, nextTotalAmount - effectivePaidAmount);
    const nextPaymentStatus = remainingAmount <= 0 ? 'PAID' : effectivePaidAmount > 0 ? 'PARTIALLY_PAID' : 'UNPAID';

    const savedInvoice = await tx.invoice.update({
      where: { id: invoiceId },
      data: {
        customer: nextCustomer,
        paymentType: payload.paymentType ? mapPaymentType(payload.paymentType) : undefined,
        taxAmount: nextTaxAmount,
        discount: nextDiscount,
        totalAmount: nextTotalAmount,
        paymentStatus: nextPaymentStatus,
        status: remainingAmount <= 0 ? 'PAID' : 'PENDING',
      },
      include: {
        items: {
          include: {},
        },
        receivable: true,
      },
    });

    if (existing.customerId) {
      const existingReceivable = existing.receivable;
      if (existingReceivable) {
        await tx.receivable.update({
          where: { id: existingReceivable.id },
          data: {
            originalAmount: nextTotalAmount,
            paidAmount: effectivePaidAmount,
            remainingAmount,
            status: remainingAmount <= 0 ? 'PAID' : effectivePaidAmount > 0 ? 'PARTIAL' : 'OPEN',
          },
        });
      } else if (remainingAmount > 0) {
        const dueDate = await resolveCustomerDueDate(tx, existing.customerId, new Date(existing.createdAt));
        await tx.receivable.create({
          data: {
            customerId: existing.customerId,
            invoiceId,
            originalAmount: nextTotalAmount,
            paidAmount: effectivePaidAmount,
            remainingAmount,
            dueDate,
            status: effectivePaidAmount > 0 ? 'PARTIAL' : 'OPEN',
          },
        });
      }
    }

    await auditService.log({
      userId: authedReq.user.id,
      userRole: authedReq.user.role as any,
      module: 'sales',
      action: 'EDIT_INVOICE',
      entity: 'INVOICE',
      entityId: savedInvoice.id,
      oldValue: {
        customer: existing.customer,
        paymentType: existing.paymentType,
        taxAmount: existing.taxAmount,
        discount: existing.discount,
        totalAmount: existing.totalAmount,
        items: existing.items.map((item) => ({ id: item.id, quantity: item.quantity, unitPrice: item.unitPrice })),
      },
      newValue: payload,
    }, tx);

    return savedInvoice;
  });

  res.json(updated);
}));

invoicesRouter.post('/:id/return', authenticate, asyncHandler(async (req, res) => {
  const authedReq = req as AuthedRequest;
  const invoiceId = req.params.id;
  const payload = req.body ?? {};

  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      items: true,
      returns: {
        where: { status: 'COMPLETED' },
        include: { items: true },
      },
    },
  });

  if (!invoice) throw new NotFoundError('Invoice not found');
  if (invoice.status === 'RETURNED') throw new ValidationError('Invoice already returned');
  if (invoice.items.length === 0) throw new ValidationError('Invoice has no items to return');

  const invoiceItemsById = new Map(invoice.items.map((item) => [item.id, item]));
  const alreadyReturnedByItemKey = new Map<string, number>();
  for (const completedReturn of invoice.returns) {
    for (const item of completedReturn.items) {
      const key = `${item.productId}:${item.batchId || ''}`;
      alreadyReturnedByItemKey.set(key, Number(alreadyReturnedByItemKey.get(key) || 0) + Number(item.quantity || 0));
    }
  }

  const requestedItemsInput = Array.isArray(payload.items) && payload.items.length > 0
    ? payload.items
    : invoice.items.map((item) => ({ id: item.id, quantity: item.quantity }));

  const requestedItems = requestedItemsInput
    .map((rawItem: any) => {
      const invoiceItem = invoiceItemsById.get(String(rawItem?.id || ''));
      if (!invoiceItem) {
        throw new ValidationError(`Invoice item not found: ${String(rawItem?.id || '')}`);
      }

      const quantity = Math.floor(Number(rawItem?.quantity));
      if (!Number.isFinite(quantity) || quantity < 0) {
        throw new ValidationError(`Invalid return quantity for ${invoiceItem.productName}`);
      }

      const itemKey = `${invoiceItem.productId}:${invoiceItem.batchId || ''}`;
      const alreadyReturned = Number(alreadyReturnedByItemKey.get(itemKey) || 0);
      const maxReturnable = Math.max(0, Number(invoiceItem.quantity || 0) - alreadyReturned);
      if (quantity > maxReturnable) {
        throw new ValidationError(`Return quantity for ${invoiceItem.productName} exceeds available amount (${maxReturnable})`);
      }

      return { invoiceItem, quantity };
    })
    .filter((item) => item.quantity > 0);

  if (requestedItems.length === 0) {
    throw new ValidationError('Select at least one item to return');
  }

  const result = await prisma.$transaction(async (tx) => {
    const returnNo = generateReturnNo();
    const totalReturnAmount = requestedItems.reduce((sum, { invoiceItem, quantity }) => {
      return sum + Number(invoiceItem.unitPrice || 0) * Number(quantity || 0);
    }, 0);

    const ret = await tx.return.create({
      data: {
        returnNo,
        type: 'CUSTOMER',
        status: 'COMPLETED',
        invoiceId,
        customerName: invoice.customer || payload.customerName || 'Walk-in customer',
        refundMethod: mapRefundMethod(payload.refundMethod),
        reason: payload.reason || 'Customer return from sales history',
        note: payload.note || null,
        totalAmount: totalReturnAmount,
        createdById: authedReq.user.id,
        approvedById: authedReq.user.id,
        items: {
          create: requestedItems.map(({ invoiceItem, quantity }) => ({
            productId: invoiceItem.productId,
            batchId: invoiceItem.batchId,
            quantity,
            unitPrice: invoiceItem.unitPrice,
            lineTotal: Number(invoiceItem.unitPrice || 0) * Number(quantity || 0),
            reason: payload.reason || 'Customer return',
          })),
        },
      },
      include: { items: true },
    });

    for (const { invoiceItem, quantity } of requestedItems) {
      const batch = await tx.batch.findUnique({ where: { id: invoiceItem.batchId } });
      if (!batch) continue;

      const nextQty = Math.max(0, Number(batch.quantity) + quantity);
      const nextCurrent = Math.max(0, Number(batch.currentQty || batch.quantity) + quantity);
      const nextAvailable = Math.max(0, Number(batch.availableQty || batch.quantity) + quantity);

      await tx.batch.update({
        where: { id: batch.id },
        data: {
          quantity: nextQty,
          currentQty: nextCurrent,
          availableQty: nextAvailable,
        },
      });

      const product = await tx.product.findUnique({ where: { id: invoiceItem.productId } });
      if (!product) continue;
      const nextStock = Math.max(0, Number(product.totalStock) + quantity);

      await tx.product.update({
        where: { id: invoiceItem.productId },
        data: {
          totalStock: nextStock,
          status: computeProductStatus(nextStock, product.minStock),
        },
      });

      if (batch.warehouseId) {
        await tx.warehouseStock.upsert({
          where: {
            warehouseId_productId: {
              warehouseId: batch.warehouseId,
              productId: invoiceItem.productId,
            },
          },
          update: { quantity: { increment: quantity } },
          create: {
            warehouseId: batch.warehouseId,
            productId: invoiceItem.productId,
            quantity,
          },
        });
      }

      await tx.batchMovement.create({
        data: {
          batchId: invoiceItem.batchId,
          type: 'RETURN',
          quantity,
          description: `Customer return for invoice ${invoice.invoiceNo}`,
          userId: authedReq.user.id,
        },
      });
    }

    const returnedTotals = new Map(alreadyReturnedByItemKey);
    for (const { invoiceItem, quantity } of requestedItems) {
      const key = `${invoiceItem.productId}:${invoiceItem.batchId || ''}`;
      returnedTotals.set(key, Number(returnedTotals.get(key) || 0) + quantity);
    }

    const allItemsReturned = invoice.items.every((item) => {
      const key = `${item.productId}:${item.batchId || ''}`;
      return Number(returnedTotals.get(key) || 0) >= Number(item.quantity || 0);
    });

    const updatedInvoice = await tx.invoice.update({
      where: { id: invoiceId },
      data: allItemsReturned ? { status: 'RETURNED' } : {},
      include: { items: true },
    });

    await auditService.log({
      userId: authedReq.user.id,
      userRole: authedReq.user.role as any,
      module: 'sales',
      action: 'RETURN_INVOICE',
      entity: 'INVOICE',
      entityId: invoiceId,
      newValue: {
        returnId: ret.id,
        returnNo: ret.returnNo,
        status: allItemsReturned ? 'RETURNED' : invoice.status,
        items: requestedItems.map(({ invoiceItem, quantity }) => ({
          id: invoiceItem.id,
          productName: invoiceItem.productName,
          quantity,
        })),
      },
    }, tx);

    return { returnDoc: ret, invoice: updatedInvoice };
  });

  res.status(201).json(result);
}));

invoicesRouter.post('/:id/cancel', authenticate, asyncHandler(async (req, res) => {
  const authedReq = req as AuthedRequest;
  const invoiceId = req.params.id;
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';

  if (!canDeleteInvoice(authedReq.user.role)) {
    throw new ValidationError('Only ADMIN or OWNER can cancel invoices');
  }

  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      items: true,
      returns: { select: { id: true } },
    },
  });

  if (!invoice) throw new NotFoundError('Invoice not found');
  if (invoice.status === 'CANCELLED') throw new ValidationError('Invoice is already cancelled');
  if (invoice.status === 'RETURNED' || invoice.returns.length > 0) {
    throw new ValidationError('Invoice with returns cannot be cancelled. Use return documents instead.');
  }

  const updatedInvoice = await prisma.$transaction(async (tx) => {
    for (const item of invoice.items) {
      const batch = await tx.batch.findUnique({ where: { id: item.batchId } });
      if (!batch) continue;

      const nextQty = Math.max(0, Number(batch.quantity || 0) + item.quantity);
      const nextCurrent = Math.max(0, Number(batch.currentQty || batch.quantity || 0) + item.quantity);
      const nextAvailable = Math.max(0, Number(batch.availableQty || batch.quantity || 0) + item.quantity);

      await tx.batch.update({
        where: { id: batch.id },
        data: {
          quantity: nextQty,
          currentQty: nextCurrent,
          availableQty: nextAvailable,
        },
      });

      const product = await tx.product.findUnique({ where: { id: item.productId } });
      if (product) {
        const nextStock = Math.max(0, Number(product.totalStock || 0) + item.quantity);
        await tx.product.update({
          where: { id: product.id },
          data: {
            totalStock: nextStock,
            status: computeProductStatus(nextStock, product.minStock),
          },
        });
      }

      if (batch.warehouseId) {
        await tx.warehouseStock.upsert({
          where: {
            warehouseId_productId: {
              warehouseId: batch.warehouseId,
              productId: item.productId,
            },
          },
          update: { quantity: { increment: item.quantity } },
          create: {
            warehouseId: batch.warehouseId,
            productId: item.productId,
            quantity: item.quantity,
          },
        });
      }

      await tx.batchMovement.create({
        data: {
          batchId: item.batchId,
          type: 'ADJUSTMENT',
          quantity: item.quantity,
          description: `Invoice cancelled: ${invoice.invoiceNo}`,
          userId: authedReq.user.id,
        },
      });
    }

    await tx.payment.deleteMany({ where: { invoiceId } });
    await tx.receivable.deleteMany({ where: { invoiceId } });

    const savedInvoice = await tx.invoice.update({
      where: { id: invoiceId },
      data: {
        status: 'CANCELLED',
        paymentStatus: 'CANCELLED',
        comment: [invoice.comment, reason ? `Cancelled: ${reason}` : 'Cancelled'].filter(Boolean).join('\n'),
      },
      include: { items: true },
    });

    await auditService.log({
      userId: authedReq.user.id,
      userRole: authedReq.user.role as any,
      module: 'sales',
      action: 'CANCEL_INVOICE',
      entity: 'INVOICE',
      entityId: invoiceId,
      oldValue: {
        invoiceNo: invoice.invoiceNo,
        status: invoice.status,
        totalAmount: invoice.totalAmount,
        items: invoice.items.length,
      },
      newValue: {
        status: 'CANCELLED',
        reason: reason || null,
      },
    }, tx);

    return savedInvoice;
  });

  reportCache.invalidatePattern(/^metrics:/);
  reportCache.invalidatePattern(/^report:/);

  res.json(updatedInvoice);
}));

invoicesRouter.delete('/:id', authenticate, asyncHandler(async (req, res) => {
  const authedReq = req as AuthedRequest;
  const invoiceId = req.params.id;

  if (!canDeleteInvoice(authedReq.user.role)) {
    throw new ValidationError('Only ADMIN or OWNER can delete invoices');
  }

  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      items: true,
      returns: { select: { id: true } },
    },
  });

  if (!invoice) throw new NotFoundError('Invoice not found');
  if (invoice.status === 'RETURNED' || invoice.returns.length > 0) {
    throw new ValidationError('Returned invoice cannot be deleted');
  }

  await prisma.$transaction(async (tx) => {
    for (const item of invoice.items) {
      const batch = await tx.batch.findUnique({ where: { id: item.batchId } });
      if (!batch) continue;

      const nextQty = Math.max(0, Number(batch.quantity || 0) + item.quantity);
      const nextCurrent = Math.max(0, Number(batch.currentQty || batch.quantity || 0) + item.quantity);
      const nextAvailable = Math.max(0, Number(batch.availableQty || batch.quantity || 0) + item.quantity);

      await tx.batch.update({
        where: { id: batch.id },
        data: {
          quantity: nextQty,
          currentQty: nextCurrent,
          availableQty: nextAvailable,
        },
      });

      const product = await tx.product.findUnique({ where: { id: item.productId } });
      if (product) {
        const nextStock = Math.max(0, Number(product.totalStock || 0) + item.quantity);
        await tx.product.update({
          where: { id: product.id },
          data: {
            totalStock: nextStock,
            status: computeProductStatus(nextStock, product.minStock),
          },
        });
      }

      if (batch.warehouseId) {
        await tx.warehouseStock.upsert({
          where: {
            warehouseId_productId: {
              warehouseId: batch.warehouseId,
              productId: item.productId,
            },
          },
          update: { quantity: { increment: item.quantity } },
          create: {
            warehouseId: batch.warehouseId,
            productId: item.productId,
            quantity: item.quantity,
          },
        });
      }

      await tx.batchMovement.create({
        data: {
          batchId: item.batchId,
          type: 'ADJUSTMENT',
          quantity: item.quantity,
          description: `Invoice deleted: ${invoice.invoiceNo}`,
          userId: authedReq.user.id,
        },
      });
    }

    await tx.payment.deleteMany({ where: { invoiceId } });
    await tx.receivable.deleteMany({ where: { invoiceId } });
    await tx.invoice.delete({ where: { id: invoiceId } });

    await auditService.log({
      userId: authedReq.user.id,
      userRole: authedReq.user.role as any,
      module: 'sales',
      action: 'DELETE_INVOICE',
      entity: 'INVOICE',
      entityId: invoiceId,
      oldValue: {
        invoiceNo: invoice.invoiceNo,
        status: invoice.status,
        totalAmount: invoice.totalAmount,
        items: invoice.items.length,
      },
    }, tx);
  });

  res.json({ ok: true, deletedId: invoiceId });
}));
