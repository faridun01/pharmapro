import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { authenticate, type AuthedRequest } from '../../common/auth';
import { asyncHandler } from '../../common/http';
import { ValidationError } from '../../common/errors';
import { prisma } from '../../infrastructure/prisma';
import {
  getDefaultUserPreferences,
  normalizeUserPreferences,
  readSystemSettings,
  writeSystemSettings,
} from './systemSettings.storage';

export const systemRouter = Router();

const canManageSystem = (role: string | undefined) => {
  const normalized = String(role || '').toUpperCase();
  return normalized === 'ADMIN' || normalized === 'OWNER';
};

const normalizeEmail = (value: unknown) => String(value || '').trim().toLowerCase();

systemRouter.get('/me/profile', authenticate, asyncHandler(async (req, res) => {
  const authedReq = req as AuthedRequest;
  const user = await prisma.user.findUnique({
    where: { id: authedReq.user.id },
    select: { id: true, name: true, email: true, role: true, username: true },
  });
  if (!user) {
    throw new ValidationError('User not found');
  }

  res.json(user);
}));

systemRouter.put('/me/profile', authenticate, asyncHandler(async (req, res) => {
  const authedReq = req as AuthedRequest;
  const nextName = String(req.body?.name || '').trim();
  const nextEmail = normalizeEmail(req.body?.email);

  if (!nextName) {
    throw new ValidationError('Name is required');
  }
  if (!nextEmail || !nextEmail.includes('@')) {
    throw new ValidationError('Valid email is required');
  }

  const duplicate = await prisma.user.findFirst({
    where: {
      email: nextEmail,
      NOT: { id: authedReq.user.id },
    },
    select: { id: true },
  });
  if (duplicate) {
    throw new ValidationError('Email is already used by another account');
  }

  const updated = await prisma.user.update({
    where: { id: authedReq.user.id },
    data: {
      name: nextName,
      email: nextEmail,
      username: String(req.body?.username || '').trim() || null,
    },
    select: { id: true, name: true, email: true, role: true, username: true },
  });

  res.json(updated);
}));

systemRouter.put('/me/password', authenticate, asyncHandler(async (req, res) => {
  const authedReq = req as AuthedRequest;
  const currentPassword = String(req.body?.currentPassword || '');
  const nextPassword = String(req.body?.newPassword || '');
  const confirmPassword = String(req.body?.confirmPassword || '');

  if (!currentPassword || !nextPassword || !confirmPassword) {
    throw new ValidationError('currentPassword, newPassword, and confirmPassword are required');
  }

  if (nextPassword.length < 8) {
    throw new ValidationError('New password must be at least 8 characters long');
  }

  if (nextPassword !== confirmPassword) {
    throw new ValidationError('Password confirmation does not match');
  }

  const user = await prisma.user.findUnique({ where: { id: authedReq.user.id } });
  if (!user) {
    throw new ValidationError('User not found');
  }

  const validCurrent = await bcrypt.compare(currentPassword, user.password);
  if (!validCurrent) {
    throw new ValidationError('Current password is incorrect');
  }

  const samePassword = await bcrypt.compare(nextPassword, user.password);
  if (samePassword) {
    throw new ValidationError('New password must differ from current password');
  }

  await prisma.user.update({
    where: { id: authedReq.user.id },
    data: {
      password: await bcrypt.hash(nextPassword, 12),
    },
  });

  res.json({ ok: true });
}));

systemRouter.get('/me/preferences', authenticate, asyncHandler(async (req, res) => {
  const authedReq = req as AuthedRequest;
  const state = await readSystemSettings();
  const current = state.userPreferences[authedReq.user.id] || getDefaultUserPreferences();
  res.json(current);
}));

systemRouter.put('/me/preferences', authenticate, asyncHandler(async (req, res) => {
  const authedReq = req as AuthedRequest;
  const state = await readSystemSettings();
  const current = state.userPreferences[authedReq.user.id] || getDefaultUserPreferences();
  const next = normalizeUserPreferences(req.body, current);
  state.userPreferences[authedReq.user.id] = next;
  await writeSystemSettings(state);
  res.json(next);
}));

systemRouter.get('/backup/export', authenticate, asyncHandler(async (req, res) => {
  const authedReq = req as AuthedRequest;
  if (!canManageSystem(authedReq.user.role)) {
    throw new ValidationError('Only ADMIN or OWNER can export backups');
  }

  const [
    products,
    invoices,
    suppliers,
    customers,
    returns,
    writeOffs,
    shifts,
    warehouses,
  ] = await Promise.all([
    prisma.product.findMany({ include: { batches: true } }),
    prisma.invoice.findMany({ include: { items: true } }),
    prisma.supplier.findMany(),
    prisma.customer.findMany(),
    prisma.return.findMany({ include: { items: true } }),
    prisma.writeOff.findMany({ include: { items: true } }),
    prisma.cashShift.findMany({ include: { cashMovements: true, invoices: true } }),
    prisma.warehouse.findMany({ include: { stocks: true } }),
  ]);

  const payload = {
    exportedAt: new Date().toISOString(),
    exportedBy: authedReq.user.email,
    data: {
      products,
      invoices,
      suppliers,
      customers,
      returns,
      writeOffs,
      shifts,
      warehouses,
    },
  };

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="pharmapro-backup-${new Date().toISOString().slice(0, 10)}.json"`);
  res.send(JSON.stringify(payload, null, 2));
}));
