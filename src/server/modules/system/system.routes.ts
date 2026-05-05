import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { authenticate, type AuthedRequest } from '../../common/auth';
import { asyncHandler } from '../../common/http';
import { ValidationError } from '../../common/errors';
import { db } from '../../infrastructure/prisma';
import {
  getDefaultUserPreferences,
  normalizeUserPreferences,
  readSystemSettings,
  writeSystemSettings,
} from './systemSettings.storage';
import { buildStockIntegrityReport, applyStockIntegrityFix } from '../../services/stockIntegrity.service';

export const systemRouter = Router();

const canManageSystem = (role: string | undefined) => {
  const normalized = String(role || '').toUpperCase();
  return normalized === 'ADMIN' || normalized === 'OWNER';
};



systemRouter.get('/ping', (_req, res) => {
  res.json({ ok: true, message: 'System service is healthy', timestamp: new Date().toISOString() });
});



systemRouter.get('/me/profile', authenticate, asyncHandler(async (req, res) => {
  const authedReq = req as AuthedRequest;
  const user = await db.user.findUnique({
    where: { id: authedReq.user.id },
    select: { id: true, name: true, role: true, username: true },
  });
  if (!user) {
    throw new ValidationError('User not found');
  }

  res.json(user);
}));

systemRouter.put('/me/profile', authenticate, asyncHandler(async (req, res) => {
  const authedReq = req as AuthedRequest;
  const nextName = String(req.body?.name || '').trim();


  if (!nextName) {
    throw new ValidationError('Name is required');
  }



  const updated = await db.user.update({
    where: { id: authedReq.user.id },
    data: {
      name: nextName,
      username: String(req.body?.username || '').trim() || undefined,
    },
    select: { id: true, name: true, role: true, username: true },
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

  const user = await db.user.findUnique({ where: { id: authedReq.user.id } });
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

  await db.user.update({
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
    returns,
    writeOffs,
    shifts,
    warehouses,
  ] = await Promise.all([
    db.product.findMany({ include: { batches: true } }),
    db.invoice.findMany({ include: { items: true } }),
    db.supplier.findMany(),
    db.return.findMany({ include: { items: true } }),
    db.writeOff.findMany({ include: { items: true } }),
    db.cashShift.findMany({ include: { cashMovements: true, invoices: true } }),
    db.warehouse.findMany({ include: { stocks: true } }),
  ]);

  const payload = {
    exportedAt: new Date().toISOString(),
    exportedBy: authedReq.user.username,
    data: {
      products,
      invoices,
      suppliers,
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

systemRouter.get('/stock-integrity', authenticate, asyncHandler(async (req, res) => {
  const authedReq = req as AuthedRequest;
  if (!canManageSystem(authedReq.user.role)) {
    throw new ValidationError('Only ADMIN or OWNER can run stock integrity checks');
  }

  try {
    const report = await buildStockIntegrityReport();
    res.json({ 
      ok: report.issuesCount === 0, 
      healthy: report.issuesCount === 0, 
      ...report 
    });
  } catch (err: any) {
    console.error('[STOCK_INTEGRITY_SERVICE_ERROR]:', err);
    throw err;
  }
}));

systemRouter.post('/stock-integrity/fix', authenticate, asyncHandler(async (req, res) => {
  const authedReq = req as AuthedRequest;
  if (!canManageSystem(authedReq.user.role)) {
    throw new ValidationError('Only ADMIN or OWNER can fix stock integrity');
  }

  try {
    await applyStockIntegrityFix();
    const report = await buildStockIntegrityReport();
    res.json({ 
      ok: report.issuesCount === 0, 
      healthy: report.issuesCount === 0, 
      repaired: true, 
      ...report 
    });
  } catch (err: any) {
    console.error('[STOCK_INTEGRITY_FIX_ERROR]:', err);
    throw err;
  }
}));
