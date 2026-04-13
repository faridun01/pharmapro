import { Router } from 'express';
import { authenticate, type AuthedRequest } from '../../common/auth';
import { asyncHandler } from '../../common/http';
import { prisma } from '../../infrastructure/prisma';
import { invoiceService } from './invoice.service';
import { NotFoundError, ValidationError } from '../../common/errors';

export const invoicesRouter = Router();

invoicesRouter.get('/', authenticate, asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 50));
  const search = String(req.query.search || '').trim();

  const result = await invoiceService.getInvoices({ page, limit, search });
  res.json(result);
}));

invoicesRouter.patch('/:id', authenticate, asyncHandler(async (req, res) => {
  const authedReq = req as AuthedRequest;
  const result = await invoiceService.updateInvoice(req.params.id, req.body, authedReq.user.id, authedReq.user.role);
  res.json(result);
}));

invoicesRouter.post('/:id/payments', authenticate, asyncHandler(async (req, res) => {
  const authedReq = req as AuthedRequest;
  const updatedInvoice = await invoiceService.addPayment(req.params.id, req.body, authedReq.user.id, authedReq.user.role);
  res.status(201).json(updatedInvoice);
}));

invoicesRouter.post('/:id/returns', authenticate, asyncHandler(async (req, res) => {
  const authedReq = req as AuthedRequest;
  const result = await invoiceService.processReturn(req.params.id, req.body, authedReq.user.id, authedReq.user.role);
  res.status(201).json(result);
}));

invoicesRouter.delete('/:id', authenticate, asyncHandler(async (req, res) => {
  const authedReq = req as AuthedRequest;
  await invoiceService.deleteInvoice(req.params.id, authedReq.user.id, authedReq.user.role);
  res.status(204).send();
}));

// Legacy routes (still using direct prisma for now, can be moved to service later)
invoicesRouter.get('/:id', authenticate, asyncHandler(async (req, res) => {
  const result = await invoiceService.getInvoiceById(req.params.id);
  res.json(result);
}));
