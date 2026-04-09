import { prisma } from '../../infrastructure/prisma';
import { auditService } from '../../services/audit.service';
import { NotFoundError, ValidationError } from '../../common/errors';
import { computeProductStatus } from '../../common/productStatus';
import { reportCache } from '../../common/cache';
import { resolveCustomerDueDate } from '../../common/customerTerms';

export type SaleItemInput = {
  productId: string;
  quantity: number;
  sellingPrice: number;
};

export type CompleteSaleInput = {
  items: SaleItemInput[];
  discountAmount?: number;
  taxAmount?: number;
  total: number;
  paymentType: 'CASH' | 'CARD' | 'CREDIT' | 'STORE_BALANCE';
  customer?: string;
  customerPhone?: string;
  customerId?: string;
  paidAmount?: number;
  userId: string;
};

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

    const hasOutstandingBalance = paidAmount < Number(input.total);
    const requestedCustomerName = String(input.customer || '').trim();
    const requestedCustomerPhone = String(input.customerPhone || '').trim();
    let resolvedCustomerId = input.customerId;
    let resolvedCustomerName: string | null = requestedCustomerName || null;

    const invoice = await prisma.$transaction(async (tx) => {
      if (resolvedCustomerId) {
        const customer = await tx.customer.findUnique({
          where: { id: resolvedCustomerId },
          select: { id: true, name: true },
        });

        if (!customer) {
          throw new NotFoundError(`Customer ${resolvedCustomerId} not found`);
        }

        resolvedCustomerName = customer.name;
      } else if (hasOutstandingBalance) {
        if (!requestedCustomerName) {
          throw new ValidationError('Customer name is required for credit sale');
        }

        const existingCustomer = requestedCustomerPhone
          ? await tx.customer.findFirst({
              where: {
                isActive: true,
                phone: requestedCustomerPhone,
              },
              select: { id: true, name: true },
            })
          : await tx.customer.findFirst({
              where: {
                isActive: true,
                name: requestedCustomerName,
              },
              select: { id: true, name: true },
            });

        if (existingCustomer) {
          resolvedCustomerId = existingCustomer.id;
          resolvedCustomerName = existingCustomer.name;
        } else {
          const createdCustomer = await tx.customer.create({
            data: {
              name: requestedCustomerName,
              phone: requestedCustomerPhone || null,
              isActive: true,
            },
            select: { id: true, name: true },
          });

          resolvedCustomerId = createdCustomer.id;
          resolvedCustomerName = createdCustomer.name;
        }
      }

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
        totalPrice: number;
      }> = [];

      // Single batch load — eliminates N+1 queries inside transaction
      const productIds = [...new Set(input.items.map((i) => i.productId))];
      const allProducts = await tx.product.findMany({
        where: { id: { in: productIds } },
        include: {
          batches: {
            where: { quantity: { gt: 0 } },
            orderBy: { expiryDate: 'asc' },
          },
        },
      });
      const productMap = new Map(allProducts.map((p) => [p.id, p]));

      for (const item of input.items) {
        const quantity = Number(item.quantity);
        const sellingPrice = Number(item.sellingPrice);

        if (!item.productId) throw new ValidationError('productId is required');
        if (!quantity || quantity <= 0) throw new ValidationError('quantity must be a positive number');
        if (sellingPrice < 0) throw new ValidationError('sellingPrice cannot be negative');

        const product = productMap.get(item.productId);
        if (!product) throw new NotFoundError(`Product ${item.productId} not found`);
        if (product.totalStock < quantity) throw new ValidationError(`Insufficient stock for ${product.name}`);

        const validBatches = product.batches.filter((batch) => batch.expiryDate > new Date());
        const availableStock = validBatches.reduce((sum, batch) => sum + batch.quantity, 0);
        if (availableStock < quantity) {
          throw new ValidationError(`Insufficient non-expired stock for ${product.name}`);
        }

        let remainingToDeduct = quantity;

        for (const batch of validBatches) {
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
              description: `POS sale${resolvedCustomerName ? ` for ${resolvedCustomerName}` : ''}`,
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
            totalPrice: deduct * sellingPrice,
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
          customer: resolvedCustomerName,
          customerId: resolvedCustomerId,
          totalAmount: Number(input.total),
          taxAmount: Number(input.taxAmount ?? 0),
          discount: Number(input.discountAmount ?? 0),
          paymentType: input.paymentType,
          status: paidAmount >= Number(input.total) ? 'PAID' : 'PENDING',
          paymentStatus: paidAmount >= Number(input.total) ? 'PAID' : paidAmount > 0 ? 'PARTIALLY_PAID' : 'UNPAID',
          userId: input.userId,
          cashShiftId: activeShift.id,
          items: {
            create: invoiceItems,
          },
        },
        include: {
          items: true,
        },
      });

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
          customer: resolvedCustomerName || undefined,
        },
      }, tx);

      if (resolvedCustomerId && hasOutstandingBalance) {
        const receivableDueDate = await resolveCustomerDueDate(tx, resolvedCustomerId, createdInvoice.createdAt);
        await tx.receivable.create({
          data: {
            customerId: resolvedCustomerId,
            invoiceId: createdInvoice.id,
            originalAmount: Number(input.total),
            paidAmount,
            remainingAmount: Number(input.total) - paidAmount,
            dueDate: receivableDueDate,
            status: paidAmount > 0 ? 'PARTIAL' : 'OPEN',
          },
        });
      }

      if (paidAmount > 0) {
        await tx.payment.create({
          data: {
            direction: 'IN',
            counterpartyType: resolvedCustomerId ? 'CUSTOMER' : 'OTHER',
            customerId: resolvedCustomerId,
            method:
              input.paymentType === 'CARD'
                ? 'CARD'
                : input.paymentType === 'STORE_BALANCE'
                  ? 'CREDIT_OFFSET'
                  : input.paymentType === 'CREDIT'
                    ? 'BANK_TRANSFER'
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
}

export const salesService = new SalesService();
