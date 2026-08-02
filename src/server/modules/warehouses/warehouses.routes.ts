import { Router } from 'express';
import { authenticate, requireRole, type AuthedRequest } from '../../common/auth';
import { asyncHandler } from '../../common/http';
import { prisma } from '../../infrastructure/prisma';
import { ValidationError, NotFoundError } from '../../common/errors';
import { auditService } from '../../services/audit.service';

export const warehousesRouter = Router();

// GET / — all authenticated users (returns list of active warehouses)
warehousesRouter.get('/', authenticate, asyncHandler(async (req, res) => {
  const includeInactive = req.query.includeInactive === 'true';
  const where = includeInactive ? {} : { isActive: true };

  const warehouses = await prisma.warehouse.findMany({
    where,
    orderBy: [
      { isDefault: 'desc' },
      { name: 'asc' },
    ],
  });
  res.json(warehouses);
}));

// GET /:id — get warehouse by ID
warehousesRouter.get('/:id', authenticate, asyncHandler(async (req, res) => {
  const warehouse = await prisma.warehouse.findUnique({
    where: { id: req.params.id },
  });
  if (!warehouse) throw new NotFoundError('Warehouse not found');
  res.json(warehouse);
}));

// POST / — ADMIN, OWNER only (create warehouse)
warehousesRouter.post('/', authenticate, requireRole(['ADMIN', 'OWNER']), asyncHandler(async (req, res) => {
  const authedReq = req as AuthedRequest;
  const { code, name, type, address, description, isDefault } = req.body ?? {};

  const trimmedCode = String(code || '').trim().toUpperCase();
  const trimmedName = String(name || '').trim();

  if (!trimmedCode || !trimmedName) {
    throw new ValidationError('Warehouse code and name are required');
  }

  const existing = await prisma.warehouse.findFirst({
    where: {
      OR: [
        { code: trimmedCode },
        { name: trimmedName },
      ],
    },
  });
  if (existing) {
    throw new ValidationError('Warehouse with this code or name already exists');
  }

  const warehouse = await prisma.$transaction(async (tx) => {
    if (isDefault) {
      await tx.warehouse.updateMany({
        where: { isDefault: true },
        data: { isDefault: false },
      });
    }

    const created = await tx.warehouse.create({
      data: {
        code: trimmedCode,
        name: trimmedName,
        type: type ? String(type).trim() : 'RETAIL',
        address: address ? String(address).trim() : null,
        description: description ? String(description).trim() : null,
        isDefault: Boolean(isDefault),
        isActive: true,
      },
    });

    await auditService.log({
      userId: authedReq.user.id,
      module: 'warehouses',
      action: 'CREATE_WAREHOUSE',
      entity: 'WAREHOUSE',
      entityId: created.id,
      newValue: { code: created.code, name: created.name, isDefault: created.isDefault },
    }, tx);

    return created;
  });

  res.status(201).json(warehouse);
}));

// PUT /:id — ADMIN, OWNER only (update warehouse)
warehousesRouter.put('/:id', authenticate, requireRole(['ADMIN', 'OWNER']), asyncHandler(async (req, res) => {
  const authedReq = req as AuthedRequest;
  const { code, name, type, address, description, isDefault, isActive } = req.body ?? {};

  const existing = await prisma.warehouse.findUnique({
    where: { id: req.params.id },
  });
  if (!existing) throw new NotFoundError('Warehouse not found');

  const updateData: any = {};
  if (code) updateData.code = String(code).trim().toUpperCase();
  if (name) updateData.name = String(name).trim();
  if (type !== undefined) updateData.type = String(type).trim();
  if (address !== undefined) updateData.address = address ? String(address).trim() : null;
  if (description !== undefined) updateData.description = description ? String(description).trim() : null;
  if (isActive !== undefined) updateData.isActive = Boolean(isActive);

  const updated = await prisma.$transaction(async (tx) => {
    if (isDefault) {
      await tx.warehouse.updateMany({
        where: { isDefault: true, id: { not: req.params.id } },
        data: { isDefault: false },
      });
      updateData.isDefault = true;
    }

    const resWarehouse = await tx.warehouse.update({
      where: { id: req.params.id },
      data: updateData,
    });

    await auditService.log({
      userId: authedReq.user.id,
      module: 'warehouses',
      action: 'UPDATE_WAREHOUSE',
      entity: 'WAREHOUSE',
      entityId: resWarehouse.id,
      oldValue: { name: existing.name, code: existing.code, isDefault: existing.isDefault },
      newValue: { name: resWarehouse.name, code: resWarehouse.code, isDefault: resWarehouse.isDefault },
    }, tx);

    return resWarehouse;
  });

  res.json(updated);
}));

// DELETE /:id — ADMIN, OWNER only (soft delete warehouse)
warehousesRouter.delete('/:id', authenticate, requireRole(['ADMIN', 'OWNER']), asyncHandler(async (req, res) => {
  const authedReq = req as AuthedRequest;
  const existing = await prisma.warehouse.findUnique({
    where: { id: req.params.id },
  });

  if (!existing) throw new NotFoundError('Warehouse not found');
  if (existing.isDefault) {
    throw new ValidationError('Cannot deactivate default warehouse. Assign another default warehouse first.');
  }

  const deactivated = await prisma.warehouse.update({
    where: { id: req.params.id },
    data: { isActive: false },
  });

  await auditService.log({
    userId: authedReq.user.id,
    module: 'warehouses',
    action: 'DEACTIVATE_WAREHOUSE',
    entity: 'WAREHOUSE',
    entityId: req.params.id,
    oldValue: { isActive: true },
    newValue: { isActive: false },
  });

  res.json(deactivated);
}));
