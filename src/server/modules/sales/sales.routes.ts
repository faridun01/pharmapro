import { Router } from 'express';
import { authenticate, type AuthedRequest } from '../../common/auth';
import { asyncHandler } from '../../common/http';
import { ValidationError } from '../../common/errors';
import { salesService } from './sales.service';

export const salesRouter = Router();

const mapPaymentType = (value: string | undefined): 'CASH' | 'CARD' | 'CREDIT' | 'STORE_BALANCE' => {
  const normalized = (value || 'CASH').toUpperCase().replace(/\s+/g, '_');
  if (normalized === 'CASH' || normalized === 'CARD' || normalized === 'CREDIT' || normalized === 'STORE_BALANCE') {
    return normalized;
  }
  throw new ValidationError('paymentType must be CASH, CARD, CREDIT, or STORE_BALANCE');
};

salesRouter.post('/complete', authenticate, asyncHandler(async (req, res) => {
  const authedReq = req as AuthedRequest;
  const { items, discountAmount, taxAmount, total, paymentType, customer, customerPhone, customerId, paidAmount } = req.body ?? {};

  if (!Array.isArray(items) || items.length === 0) {
    throw new ValidationError('items array is required');
  }

  const invoice = await salesService.completeSale({
    items: items.map((item: any) => ({
      productId: String(item.productId),
      quantity: Number(item.quantity),
      sellingPrice: Number(item.sellingPrice),
    })),
    discountAmount: Number(discountAmount ?? 0),
    taxAmount: Number(taxAmount ?? 0),
    total: Number(total ?? 0),
    paymentType: mapPaymentType(paymentType),
    customer: typeof customer === 'string' ? customer : undefined,
    customerPhone: typeof customerPhone === 'string' ? customerPhone : undefined,
    customerId: typeof customerId === 'string' ? customerId : undefined,
    paidAmount: paidAmount == null ? undefined : Number(paidAmount),
    userId: authedReq.user.id,
  });

  res.status(201).json(invoice);
}));
