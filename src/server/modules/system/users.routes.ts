import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { authenticate, requireRole, type AuthedRequest } from '../../common/auth';
import { asyncHandler } from '../../common/http';
import { db } from '../../infrastructure/prisma';
import { ValidationError, NotFoundError } from '../../common/errors';
import { auditService } from '../../services/audit.service';

export const usersRouter = Router();

const ALLOWED_ROLES = ['OWNER', 'ADMIN', 'CASHIER', 'PHARMACIST', 'WAREHOUSE_STAFF'] as const;
type AllowedRole = typeof ALLOWED_ROLES[number];

const normalizeEmail = (v: unknown) => String(v || '').trim().toLowerCase();

// GET /api/system/users — list all users (ADMIN/OWNER only)
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
        email: true,
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

// POST /api/system/users — create a new user (ADMIN/OWNER only)
usersRouter.post(
  '/',
  authenticate,
  requireRole(['ADMIN', 'OWNER']),
  asyncHandler(async (req, res) => {
    const authedReq = req as AuthedRequest;
    const { name, email, password, role, username, warehouseId } = req.body ?? {};

    const trimmedName = String(name || '').trim();
    const normalizedEmail = normalizeEmail(email);
    const trimmedPassword = String(password || '');
    const normalizedRole = String(role || '').toUpperCase() as AllowedRole;

    if (!trimmedName) throw new ValidationError('Имя обязательно');
    if (!normalizedEmail || !normalizedEmail.includes('@')) throw new ValidationError('Некорректный email');
    if (!trimmedPassword || trimmedPassword.length < 6) throw new ValidationError('Пароль должен быть не менее 6 символов');
    if (!ALLOWED_ROLES.includes(normalizedRole)) {
      throw new ValidationError(`Недопустимая роль. Доступные: ${ALLOWED_ROLES.join(', ')}`);
    }

    // OWNER can only be created by OWNER
    if (normalizedRole === 'OWNER' && authedReq.user.role !== 'OWNER') {
      throw new ValidationError('Только владелец может создавать другого владельца');
    }

    const existing = await db.user.findFirst({ where: { email: normalizedEmail }, select: { id: true } });
    if (existing) throw new ValidationError('Пользователь с таким email уже существует');

    const hashed = await bcrypt.hash(trimmedPassword, 12);

    const user = await db.user.create({
      data: {
        name: trimmedName,
        email: normalizedEmail,
        username: String(username || '').trim() || null,
        password: hashed,
        role: normalizedRole,
        isActive: true,
        warehouseId: warehouseId || null,
      },
      select: {
        id: true,
        name: true,
        email: true,
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
      newValue: { name: user.name, email: user.email, role: user.role },
    });

    res.status(201).json(user);
  }),
);

// PUT /api/system/users/:id — update user (ADMIN/OWNER only)
usersRouter.put(
  '/:id',
  authenticate,
  requireRole(['ADMIN', 'OWNER']),
  asyncHandler(async (req, res) => {
    const authedReq = req as AuthedRequest;
    const { id } = req.params;
    const { name, email, role, username, isActive, warehouseId, password } = req.body ?? {};

    const existing = await db.user.findUnique({ where: { id }, select: { id: true, role: true, email: true, name: true } });
    if (!existing) throw new NotFoundError('Пользователь не найден');

    // Prevent ADMIN from editing OWNER
    if (existing.role === 'OWNER' && authedReq.user.role !== 'OWNER') {
      throw new ValidationError('Только владелец может редактировать владельца');
    }
    // Prevent self-deactivation
    if (id === authedReq.user.id && isActive === false) {
      throw new ValidationError('Нельзя деактивировать собственный аккаунт');
    }

    const updateData: Record<string, any> = {};

    if (name !== undefined) {
      const trimmed = String(name || '').trim();
      if (!trimmed) throw new ValidationError('Имя не может быть пустым');
      updateData.name = trimmed;
    }

    if (email !== undefined) {
      const normalized = normalizeEmail(email);
      if (!normalized || !normalized.includes('@')) throw new ValidationError('Некорректный email');
      const dup = await db.user.findFirst({ where: { email: normalized, NOT: { id } }, select: { id: true } });
      if (dup) throw new ValidationError('Этот email уже используется другим пользователем');
      updateData.email = normalized;
    }

    if (username !== undefined) {
      updateData.username = String(username || '').trim() || null;
    }

    if (role !== undefined) {
      const normalizedRole = String(role || '').toUpperCase() as AllowedRole;
      if (!ALLOWED_ROLES.includes(normalizedRole)) {
        throw new ValidationError(`Недопустимая роль. Доступные: ${ALLOWED_ROLES.join(', ')}`);
      }
      if (normalizedRole === 'OWNER' && authedReq.user.role !== 'OWNER') {
        throw new ValidationError('Только владелец может назначить роль владельца');
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
      updateData.password = await bcrypt.hash(String(password), 12);
    }

    const updated = await db.user.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        name: true,
        email: true,
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
      oldValue: { name: existing.name, email: existing.email, role: existing.role },
      newValue: updateData,
    });

    res.json(updated);
  }),
);

// DELETE /api/system/users/:id — soft delete (isActive = false)
usersRouter.delete(
  '/:id',
  authenticate,
  requireRole(['ADMIN', 'OWNER']),
  asyncHandler(async (req, res) => {
    const authedReq = req as AuthedRequest;
    const { id } = req.params;

    if (id === authedReq.user.id) throw new ValidationError('Нельзя удалить собственный аккаунт');

    const existing = await db.user.findUnique({ where: { id }, select: { id: true, role: true, name: true } });
    if (!existing) throw new NotFoundError('Пользователь не найден');

    if (existing.role === 'OWNER' && authedReq.user.role !== 'OWNER') {
      throw new ValidationError('Только владелец может деактивировать владельца');
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
