import { Router } from 'express';
import { authenticate, type AuthedRequest } from '../../common/auth';
import { asyncHandler } from '../../common/http';
import { prisma } from '../../infrastructure/prisma';
import { auditService } from '../../services/audit.service';

export const suppliersRouter = Router();

suppliersRouter.get('/', authenticate, asyncHandler(async (_req, res) => {
  const suppliers = await prisma.supplier.findMany({
    where: { isActive: true },
    orderBy: { createdAt: 'desc' },
  });
  res.json(suppliers);
}));

suppliersRouter.post('/', authenticate, asyncHandler(async (req, res) => {
  const authedReq = req as AuthedRequest;
  const created = await prisma.supplier.create({ data: req.body });

  await auditService.log({
    userId: authedReq.user.id,
    userRole: authedReq.user.role as any,
    module: 'suppliers',
    action: 'CREATE_SUPPLIER',
    entity: 'SUPPLIER',
    entityId: created.id,
    newValue: req.body,
  });

  res.status(201).json(created);
}));

suppliersRouter.put('/:id', authenticate, asyncHandler(async (req, res) => {
  const authedReq = req as AuthedRequest;
  const { id } = req.params;

  const existing = await prisma.supplier.findUnique({ where: { id } });
  if (!existing || !existing.isActive) {
    return res.status(404).json({ error: 'Supplier not found' });
  }

  const updated = await prisma.supplier.update({
    where: { id },
    data: {
      name: req.body?.name ?? existing.name,
      contact: req.body?.contact ?? null,
      email: req.body?.email ?? null,
      address: req.body?.address ?? null,
    },
  });

  await auditService.log({
    userId: authedReq.user.id,
    userRole: authedReq.user.role as any,
    module: 'suppliers',
    action: 'UPDATE_SUPPLIER',
    entity: 'SUPPLIER',
    entityId: updated.id,
    oldValue: {
      name: existing.name,
      contact: existing.contact,
      email: existing.email,
      address: existing.address,
    },
    newValue: {
      name: updated.name,
      contact: updated.contact,
      email: updated.email,
      address: updated.address,
    },
  });

  res.json(updated);
}));

suppliersRouter.delete('/:id', authenticate, asyncHandler(async (req, res) => {
  const authedReq = req as AuthedRequest;
  const { id } = req.params;

  const existing = await prisma.supplier.findUnique({ where: { id } });
  if (!existing || !existing.isActive) {
    return res.status(404).json({ error: 'Supplier not found' });
  }

  await prisma.supplier.update({
    where: { id },
    data: { isActive: false },
  });

  await auditService.log({
    userId: authedReq.user.id,
    userRole: authedReq.user.role as any,
    module: 'suppliers',
    action: 'DELETE_SUPPLIER',
    entity: 'SUPPLIER',
    entityId: id,
    oldValue: {
      name: existing.name,
      contact: existing.contact,
      email: existing.email,
      address: existing.address,
      isActive: true,
    },
    newValue: { isActive: false },
  });

  res.status(204).send();
}));
