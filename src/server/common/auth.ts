import type { NextFunction, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { ForbiddenError, UnauthorizedError } from './errors';
import { prisma } from '../infrastructure/prisma';
import { getJwtSecret, isDevAuthBypassEnabled } from './jwt';

type JwtUser = {
  id: string;
  email: string;
  role: string;
};

export type AuthedRequest = Request & { user: JwtUser };

const DEV_ADMIN_EMAIL = 'admin@pharmapro.com';
const DEV_ADMIN_USERNAME = 'admin';
const DEV_ADMIN_PASSWORD = 'admin123';
const DEV_ADMIN_PASSWORD_HASH = '$2b$10$wnlS.eRxOglKIuDgS8Nycu.g/VcgDSHkwTRNjvIx9ZSPoJZww9/ey';
const PRODUCTION_BOOTSTRAP_HINT = 'Run `npm run bootstrap:admin -- --email owner@example.com --password <strong-password> --name "Owner" --role OWNER` before first production login.';

const isTrustedDesktopRequest = (req: Request) => {
  const desktopSecret = process.env.ELECTRON_DESKTOP_AUTH_SECRET;
  const desktopHeader = req.headers['x-pharmapro-desktop-auth'];
  const headerValue = Array.isArray(desktopHeader) ? desktopHeader[0] : desktopHeader;
  const host = req.hostname || req.ip || '';

  if (!desktopSecret || !headerValue || headerValue !== desktopSecret) {
    return false;
  }

  return host === '127.0.0.1' || host === 'localhost' || host === '::1';
};

export const ensureAdminUser = async () => {
  if (process.env.NODE_ENV === 'production') {
    const privilegedUsers = await prisma.user.count({
      where: {
        isActive: true,
        role: { in: ['OWNER', 'ADMIN'] },
      },
    });

    if (privilegedUsers === 0) {
      console.warn('[auth] No active OWNER or ADMIN user exists in production.');
      console.warn(`[auth] ${PRODUCTION_BOOTSTRAP_HINT}`);
    }

    return;
  }

  const existing = await prisma.user.findFirst({
    where: { email: DEV_ADMIN_EMAIL },
    select: { id: true, username: true, password: true, isActive: true },
  });

  if (!existing) {
    await prisma.user.create({
      data: {
        email: DEV_ADMIN_EMAIL,
        username: DEV_ADMIN_USERNAME,
        password: DEV_ADMIN_PASSWORD_HASH,
        name: 'Admin',
        role: 'ADMIN',
      },
    });
    console.log('[auth] Admin user created: admin / admin123');
  } else {
    const updateData: { username?: string; password?: string; isActive?: boolean } = {};

    if (!existing.username) {
      updateData.username = DEV_ADMIN_USERNAME;
    }
    if (!existing.isActive) {
      updateData.isActive = true;
    }

    // In development, keep deterministic local credentials for quick login.
    if (process.env.NODE_ENV !== 'production' && existing.password !== DEV_ADMIN_PASSWORD_HASH) {
      updateData.password = DEV_ADMIN_PASSWORD_HASH;
      updateData.username = DEV_ADMIN_USERNAME;
    }

    if (Object.keys(updateData).length > 0) {
      await prisma.user.update({
        where: { email: DEV_ADMIN_EMAIL },
        data: updateData,
      });
      console.log('[auth] Admin credentials synchronized');
    }
  }
};

const ensureDevUser = async () => {
  const devUser = await prisma.user.findFirst({
    where: { email: DEV_ADMIN_EMAIL },
    select: { id: true, email: true, role: true },
  });
  if (!devUser) {
    await ensureAdminUser();
    return prisma.user.findFirst({
      where: { email: DEV_ADMIN_EMAIL },
      select: { id: true, email: true, role: true },
    }) as Promise<{ id: string; email: string; role: string }>;
  }
  return devUser;
};

export const authenticate = async (req: Request, _res: Response, next: NextFunction) => {
  const token = req.headers.authorization?.split(' ')[1];

  if (!token && isTrustedDesktopRequest(req)) {
    try {
      const devUser = await ensureDevUser();

      (req as AuthedRequest).user = {
        id: devUser.id,
        email: devUser.email,
        role: devUser.role,
      };
      return next();
    } catch {
      return next(new UnauthorizedError('Failed to resolve desktop user'));
    }
  }

  if (!token && process.env.NODE_ENV !== 'production' && isDevAuthBypassEnabled()) {
    try {
      const devUser = await ensureDevUser();

      (req as AuthedRequest).user = {
        id: devUser.id,
        email: devUser.email,
        role: devUser.role,
      };
      return next();
    } catch {
      return next(new UnauthorizedError('Failed to resolve dev user'));
    }
  }

  if (!token) {
    return next(new UnauthorizedError());
  }

  try {
    const decoded = jwt.verify(token, getJwtSecret()) as JwtUser;
    (req as AuthedRequest).user = decoded;
    return next();
  } catch {
    return next(new UnauthorizedError('Invalid token'));
  }
};

export const requireRole = (roles: string[]) => {
  return (req: Request, _res: Response, next: NextFunction) => {
    const user = (req as AuthedRequest).user;
    if (!user) {
      return next(new UnauthorizedError());
    }

    if (!roles.includes(user.role)) {
      return next(new ForbiddenError(`Required role: ${roles.join(' or ')}`));
    }

    next();
  };
};
