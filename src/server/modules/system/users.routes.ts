import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { authenticate, requireRole, type AuthedRequest } from '../../common/auth';
import { asyncHandler } from '../../common/http';
import { db } from '../../infrastructure/prisma';
import { ValidationError, NotFoundError } from '../../common/errors';
import { auditService } from '../../services/audit.service';
import { validatePassword } from '../../common/passwordPolicy';

export const usersRouter = Router();

const ALLOWED_ROLES = ['OWNER', 'ADMIN', 'CASHIER', 'PHARMACIST', 'WAREHOUSE_STAFF'] as const;
type AllowedRole = typeof ALLOWED_ROLES[number];

const normalizeUsername = (v: unknown) => String(v || '').trim().toLowerCase();

usersRouter.get(
  '/',
  authenticate,
  requireRole(['ADMIN', 'OWNER']),
  asyncHandler(async (_req, res) => {
    const users = await db.user.findMany({
      orderBy: [{ isActive: 'desc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        name: true,
        username: true,
        role: true,
        isActive: true,
        warehouseId: true,
        warehouse: { select: { id: true, name: true } },
        createdAt: true,
        updatedAt: true,
      },
    });
    res.json(users);
  }),
);

usersRouter.post(
  '/',
  authenticate,
  requireRole(['ADMIN', 'OWNER']),
  asyncHandler(async (req, res) => {
    const authedReq = req as AuthedRequest;
    const { name, password, role, username, warehouseId } = req.body ?? {};

    const trimmedName = String(name || '').trim();
    const trimmedPassword = String(password || '');
    const normalizedUsername = normalizeUsername(username);
    const normalizedRole = String(role || '').toUpperCase() as AllowedRole;

    if (!trimmedName) throw new ValidationError('Name is required');
    if (!normalizedUsername) throw new ValidationError('Username is required');
    validatePassword(trimmedPassword);
    if (!ALLOWED_ROLES.includes(normalizedRole)) {
      throw new ValidationError(`Invalid role. Available: ${ALLOWED_ROLES.join(', ')}`);
    }
    if (normalizedRole === 'OWNER' && authedReq.user.role !== 'OWNER') {
      throw new ValidationError('Only OWNER can create another OWNER');
    }


    if (normalizedUsername) {
      const existingUsername = await db.user.findUnique({
        where: { username: normalizedUsername },
        select: { id: true },
      });
      if (existingUsername) throw new ValidationError('User with this username already exists');
    }

    const hashed = await bcrypt.hash(trimmedPassword, 12);

    const user = await db.user.create({
      data: {
        name: trimmedName,
        username: normalizedUsername,
        password: hashed,
        role: normalizedRole,
        isActive: true,
        warehouseId: warehouseId || null,
      },
      select: {
        id: true,
        name: true,
        username: true,
        role: true,
        isActive: true,
        warehouseId: true,
        warehouse: { select: { id: true, name: true } },
        createdAt: true,
        updatedAt: true,
      },
    });

    await auditService.log({
      userId: authedReq.user.id,
      userRole: authedReq.user.role as any,
      module: 'system',
      action: 'CREATE_USER',
      entity: 'USER',
      entityId: user.id,
      newValue: { name: user.name, username: user.username, role: user.role },
    });

    res.status(201).json(user);
  }),
);

usersRouter.put(
  '/:id',
  authenticate,
  requireRole(['ADMIN', 'OWNER']),
  asyncHandler(async (req, res) => {
    const authedReq = req as AuthedRequest;
    const { id } = req.params;
    const { name, role, username, isActive, warehouseId, password } = req.body ?? {};

    const existing = await db.user.findUnique({ where: { id }, select: { id: true, role: true, username: true, name: true } });
    if (!existing) throw new NotFoundError('User not found');
    if (existing.role === 'OWNER' && authedReq.user.role !== 'OWNER') {
      throw new ValidationError('Only OWNER can edit an OWNER');
    }
    if (id === authedReq.user.id && isActive === false) {
      throw new ValidationError('You cannot deactivate your own account');
    }

    const updateData: Record<string, any> = {};

    if (name !== undefined) {
      const trimmed = String(name || '').trim();
      if (!trimmed) throw new ValidationError('Name cannot be empty');
      updateData.name = trimmed;
    }



    if (username !== undefined) {
      const normalized = normalizeUsername(username);
      if (normalized) {
        const dup = await db.user.findFirst({
          where: {
            username: { equals: normalized, mode: 'insensitive' },
            NOT: { id },
          },
          select: { id: true },
        });
        if (dup) throw new ValidationError('This username is already used by another user');
      }
      updateData.username = normalized || null;
    }

    if (role !== undefined) {
      const normalizedRole = String(role || '').toUpperCase() as AllowedRole;
      if (!ALLOWED_ROLES.includes(normalizedRole)) {
        throw new ValidationError(`Invalid role. Available: ${ALLOWED_ROLES.join(', ')}`);
      }
      if (normalizedRole === 'OWNER' && authedReq.user.role !== 'OWNER') {
        throw new ValidationError('Only OWNER can assign the OWNER role');
      }
      updateData.role = normalizedRole;
    }

    if (isActive !== undefined) {
      updateData.isActive = Boolean(isActive);
    }

    if (warehouseId !== undefined) {
      updateData.warehouseId = warehouseId || null;
    }

    if (password) {
      validatePassword(String(password));
      updateData.password = await bcrypt.hash(String(password), 12);
    }

    const updated = await db.user.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        name: true,
        username: true,
        role: true,
        isActive: true,
        warehouseId: true,
        warehouse: { select: { id: true, name: true } },
        createdAt: true,
        updatedAt: true,
      },
    });

    await auditService.log({
      userId: authedReq.user.id,
      userRole: authedReq.user.role as any,
      module: 'system',
      action: 'UPDATE_USER',
      entity: 'USER',
      entityId: id,
      oldValue: { name: existing.name, username: existing.username, role: existing.role },
      newValue: updateData,
    });

    res.json(updated);
  }),
);

usersRouter.delete(
  '/:id',
  authenticate,
  requireRole(['ADMIN', 'OWNER']),
  asyncHandler(async (req, res) => {
    const authedReq = req as AuthedRequest;
    const { id } = req.params;

    if (id === authedReq.user.id) throw new ValidationError('You cannot delete your own account');

    const existing = await db.user.findUnique({ where: { id }, select: { id: true, role: true, name: true } });
    if (!existing) throw new NotFoundError('User not found');
    if (existing.role === 'OWNER' && authedReq.user.role !== 'OWNER') {
      throw new ValidationError('Only OWNER can deactivate an OWNER');
    }

    await db.user.update({ where: { id }, data: { isActive: false } });

    await auditService.log({
      userId: authedReq.user.id,
      userRole: authedReq.user.role as any,
      module: 'system',
      action: 'DEACTIVATE_USER',
      entity: 'USER',
      entityId: id,
      newValue: { isActive: false, name: existing.name },
    });

    res.json({ ok: true });
  }),
);
