import type { NextFunction, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { ForbiddenError, UnauthorizedError } from './errors';
import { prisma } from '../infrastructure/prisma';
import { getJwtSecret, isDevAuthBypassEnabled } from './jwt';

type JwtUser = {
  id: string;
  username: string;
  role: string;
};

export type AuthedRequest = Request & { user: JwtUser };

const DEV_ADMIN_USERNAME = 'admin';
const DEV_ADMIN_PASSWORD = 'dev-password';
const DEV_ADMIN_PASSWORD_HASH = '$2b$10$QWHZjMpDfrae3H8.xQL3R.eQmv7Lj9cUOxkD.2E1gC/lmhMkKewxm';
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

  const existing = await prisma.user.findUnique({
    where: { username: DEV_ADMIN_USERNAME },
    select: { id: true, username: true, password: true, isActive: true },
  });

  if (!existing) {
    await prisma.user.create({
      data: {
        username: DEV_ADMIN_USERNAME,
        password: DEV_ADMIN_PASSWORD_HASH,
        name: 'Admin',
        role: 'ADMIN',
      },
    });
    console.log(`[auth] Admin user created: admin / ${DEV_ADMIN_PASSWORD}`);
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
        where: { id: existing.id },
        data: updateData,
      });
      console.log('[auth] Admin credentials synchronized');
    }
  }
};

const ensureDevUser = async () => {
  const devUser = await prisma.user.findUnique({
    where: { username: DEV_ADMIN_USERNAME },
    select: { id: true, username: true, role: true, isActive: true },
  });
  if (!devUser || !devUser.isActive) {
    await ensureAdminUser();
    return prisma.user.findUnique({
      where: { username: DEV_ADMIN_USERNAME },
      select: { id: true, username: true, role: true },
    }) as Promise<{ id: string; username: string; role: string }>;
  }
  return devUser;
};

export const authenticate = async (req: Request, _res: Response, next: NextFunction) => {
  const [scheme, token] = req.headers.authorization?.split(/\s+/) ?? [];
  const bearerToken = scheme?.toLowerCase() === 'bearer' ? token : undefined;

  if (!bearerToken && isTrustedDesktopRequest(req)) {
    try {
      const devUser = await ensureDevUser();

      (req as AuthedRequest).user = {
        id: devUser.id,
        username: devUser.username,
        role: devUser.role,
      };
      return next();
    } catch {
      return next(new UnauthorizedError('Failed to resolve desktop user'));
    }
  }

  if (!bearerToken && process.env.NODE_ENV !== 'production' && isDevAuthBypassEnabled()) {
    try {
      const devUser = await ensureDevUser();

      (req as AuthedRequest).user = {
        id: devUser.id,
        username: devUser.username,
        role: devUser.role,
      };
      return next();
    } catch {
      return next(new UnauthorizedError('Failed to resolve dev user'));
    }
  }

  if (!bearerToken) {
    return next(new UnauthorizedError());
  }

  let decoded: JwtUser;
  try {
    decoded = jwt.verify(bearerToken, getJwtSecret()) as JwtUser;
  } catch {
    return next(new UnauthorizedError('Invalid token'));
  }

  const activeUser = await prisma.user.findUnique({
    where: { id: decoded.id },
    select: { id: true, username: true, role: true, isActive: true },
  });

  if (!activeUser?.isActive) {
    return next(new UnauthorizedError());
  }

  (req as AuthedRequest).user = {
    id: activeUser.id,
    username: activeUser.username,
    role: activeUser.role,
  };
  return next();
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
