import { Router } from 'express';
import { authenticate, type AuthedRequest } from '../../common/auth';
import { asyncHandler } from '../../common/http';
import { ValidationError } from '../../common/errors';
import { salesService } from './sales.service';

export const salesRouter = Router();

const mapPaymentType = (value: string | undefined): 'CASH' | 'CARD' | 'CREDIT' => {
  const normalized = (value || 'CASH').toUpperCase();
  if (normalized === 'CASH' || normalized === 'CARD' || normalized === 'CREDIT') {
    return normalized as any;
  }
  throw new ValidationError('paymentType must be CASH, CARD or CREDIT');
};

salesRouter.post('/complete', authenticate, asyncHandler(async (req, res) => {
  const authedReq = req as AuthedRequest;
  const { items, discountAmount, taxAmount, total, paymentType, paidAmount, customerName } = req.body ?? {};

  if (!Array.isArray(items) || items.length === 0) {
    throw new ValidationError('items array is required');
  }

  const invoice = await salesService.completeSale({
    items: items.map((item: any) => ({
      productId: String(item.productId),
      batchId: item.batchId ? String(item.batchId) : undefined,
      quantity: Number(item.quantity),
      sellingPrice: Number(item.sellingPrice),
      discountAmount: item.discountAmount ? Number(item.discountAmount) : undefined,
      prescriptionPresented: Boolean(item.prescriptionPresented),
    })),
    discountAmount: Number(discountAmount ?? 0),
    taxAmount: Number(taxAmount ?? 0),
    total: Number(total ?? 0),
    paymentType: mapPaymentType(paymentType),
    paidAmount: paidAmount == null ? undefined : Number(paidAmount),
    customerName: customerName ? String(customerName) : undefined,
    userId: authedReq.user.id,
  });

  res.status(201).json(invoice);
}));

salesRouter.post('/pay-debt/:id', authenticate, asyncHandler(async (req, res) => {
  const authedReq = req as AuthedRequest;
  const { amount, paymentMethod } = req.body;
  
  if (!amount || amount <= 0) throw new ValidationError('Invalid amount');
  if (!['CASH', 'CARD'].includes(paymentMethod)) throw new ValidationError('Invalid payment method');

  const result = await salesService.payDebt(req.params.id, {
    amount: Number(amount),
    paymentMethod: paymentMethod as 'CASH' | 'CARD',
    userId: authedReq.user.id
  });
  
  res.json(result);
}));

salesRouter.post('/void/:id', authenticate, asyncHandler(async (req, res) => {
  const authedReq = req as AuthedRequest;
  const invoice = await salesService.voidSale(req.params.id, authedReq.user.id);
  res.json(invoice);
}));
