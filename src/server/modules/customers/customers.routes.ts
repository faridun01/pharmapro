import { Router } from 'express';
import { authenticate, requireRole, type AuthedRequest } from '../../common/auth';
import { asyncHandler } from '../../common/http';
import { db } from '../../infrastructure/prisma';
import { NotFoundError, ValidationError } from '../../common/errors';
import { auditService } from '../../services/audit.service';

export const customersRouter = Router();

// ─── List ────────────────────────────────────────────────────────────────────
customersRouter.get(
  '/',
  authenticate,
  asyncHandler(async (req, res) => {
    const search = String(req.query.search || '').trim();
    const page   = Math.max(1, Number(req.query.page) || 1);
    const limit  = Math.max(1, Math.min(100, Number(req.query.limit) || 50));

    const where: any = {
      isActive: true,
      ...(search ? {
        OR: [
          { name:    { contains: search, mode: 'insensitive' } },
          { phone:   { contains: search } },
          { taxId:   { contains: search } },
          { code:    { contains: search, mode: 'insensitive' } },
        ],
      } : {}),
    };

    const [total, customers] = await Promise.all([
      db.customer.count({ where }),
      db.customer.findMany({
        where,
        orderBy: { name: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          receivables: {
            where:  { status: { not: 'PAID' } },
            select: { remainingAmount: true },
          },
          _count: { select: { invoices: true, returns: true } },
        },
      }),
    ]);

    const items = customers.map((c) => ({
      id:              c.id,
      code:            c.code,
      name:            c.name,
      legalName:       c.legalName,
      phone:           c.phone,
      address:         c.address,
      creditLimit:     Number(c.creditLimit || 0),
      defaultDiscount: Number(c.defaultDiscount || 0),
      isActive:        c.isActive,
      createdAt:       c.createdAt,
      totalDebt:       c.receivables.reduce((s, r) => s + Number(r.remainingAmount || 0), 0),
      invoiceCount:    c._count.invoices,
      returnCount:     c._count.returns,
    }));

    res.json({ items, pagination: { total, page, limit, totalPages: Math.ceil(total / limit) } });
  }),
);

// ─── Single customer detail ──────────────────────────────────────────────────
customersRouter.get(
  '/:id',
  authenticate,
  asyncHandler(async (req, res) => {
    const customer = await db.customer.findUnique({
      where: { id: req.params.id },
      include: {
        invoices: {
          orderBy: { createdAt: 'desc' },
          take: 20,
          select: {
            id: true, invoiceNo: true, createdAt: true,
            totalAmount: true, paymentStatus: true, paymentType: true,
          },
        },
        receivables: {
          orderBy: { createdAt: 'desc' },
          take: 10,
          select: {
            id: true, originalAmount: true, paidAmount: true,
            remainingAmount: true, status: true, dueDate: true, createdAt: true,
          },
        },
        returns: {
          orderBy: { createdAt: 'desc' },
          take: 10,
          select: {
            id: true, returnNo: true, totalAmount: true,
            status: true, createdAt: true, type: true,
          },
        },
        payments: {
          orderBy: { paymentDate: 'desc' },
          take: 15,
          select: {
            id: true, amount: true, method: true, paymentDate: true,
            direction: true, comment: true,
          },
        },
      },
    });
    if (!customer) throw new NotFoundError('Покупатель не найден');
    res.json(customer);
  }),
);

// ─── Create ───────────────────────────────────────────────────────────────────
customersRouter.post(
  '/',
  authenticate,
  requireRole(['ADMIN', 'OWNER', 'CASHIER', 'PHARMACIST']),
  asyncHandler(async (req, res) => {
    const authedReq = req as AuthedRequest;
    const { name, legalName, phone, address, taxId, creditLimit, defaultDiscount, paymentTermDays } = req.body ?? {};

    const trimmedName = String(name || '').trim();
    if (!trimmedName) throw new ValidationError('Имя покупателя обязательно');

    const created = await db.customer.create({
      data: {
        name: trimmedName,
        legalName:       String(legalName || '').trim() || null,
        phone:           String(phone || '').trim() || null,

        address:         String(address || '').trim() || null,
        taxId:           String(taxId || '').trim() || null,
        creditLimit:     Number(creditLimit) || 0,
        defaultDiscount: Number(defaultDiscount) || 0,
        paymentTermDays: paymentTermDays ? Number(paymentTermDays) : null,
      },
    });

    await auditService.log({
      userId: authedReq.user.id,
      userRole: authedReq.user.role as any,
      module: 'system',
      action: 'CREATE_CUSTOMER',
      entity: 'CUSTOMER',
      entityId: created.id,
      newValue: { name: created.name, phone: created.phone },
    });

    res.status(201).json(created);
  }),
);

// ─── Update ───────────────────────────────────────────────────────────────────
customersRouter.put(
  '/:id',
  authenticate,
  requireRole(['ADMIN', 'OWNER', 'CASHIER', 'PHARMACIST']),
  asyncHandler(async (req, res) => {
    const authedReq = req as AuthedRequest;
    const { id } = req.params;
    const existing = await db.customer.findUnique({ where: { id }, select: { id: true, name: true } });
    if (!existing) throw new NotFoundError('Покупатель не найден');

    const { name, legalName, phone, address, taxId, creditLimit, defaultDiscount, paymentTermDays, isActive } = req.body ?? {};
    const data: Record<string, any> = {};
    if (name !== undefined)            data.name            = String(name).trim();
    if (legalName !== undefined)       data.legalName       = String(legalName || '').trim() || null;
    if (phone !== undefined)           data.phone           = String(phone || '').trim() || null;

    if (address !== undefined)         data.address         = String(address || '').trim() || null;
    if (taxId !== undefined)           data.taxId           = String(taxId || '').trim() || null;
    if (creditLimit !== undefined)     data.creditLimit     = Number(creditLimit) || 0;
    if (defaultDiscount !== undefined) data.defaultDiscount = Number(defaultDiscount) || 0;
    if (paymentTermDays !== undefined) data.paymentTermDays = paymentTermDays ? Number(paymentTermDays) : null;
    if (isActive !== undefined)        data.isActive        = Boolean(isActive);

    const updated = await db.customer.update({ where: { id }, data });

    await auditService.log({
      userId: authedReq.user.id,
      userRole: authedReq.user.role as any,
      module: 'system',
      action: 'UPDATE_CUSTOMER',
      entity: 'CUSTOMER',
      entityId: id,
      newValue: data,
    });

    res.json(updated);
  }),
);

// ─── Deactivate (soft delete) ─────────────────────────────────────────────────
customersRouter.delete(
  '/:id',
  authenticate,
  requireRole(['ADMIN', 'OWNER']),
  asyncHandler(async (req, res) => {
    const authedReq = req as AuthedRequest;
    const { id } = req.params;
    const existing = await db.customer.findUnique({ where: { id }, select: { id: true, name: true, isActive: true } });
    if (!existing) throw new NotFoundError('Покупатель не найден');

    await db.customer.update({ where: { id }, data: { isActive: false } });

    await auditService.log({
      userId: authedReq.user.id,
      userRole: authedReq.user.role as any,
      module: 'system',
      action: 'DEACTIVATE_CUSTOMER',
      entity: 'CUSTOMER',
      entityId: id,
      newValue: { name: existing.name, isActive: false },
    });

    res.json({ ok: true });
  }),
);
