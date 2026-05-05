import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../../infrastructure/prisma';
import { asyncHandler } from '../../common/http';
import { ValidationError } from '../../common/errors';
import { getJwtSecret } from '../../common/jwt';
import { authenticate, requireRole, type AuthedRequest } from '../../common/auth';
import { validatePassword } from '../../common/passwordPolicy';
import { DATABASE_UNAVAILABLE_MESSAGE, isDatabaseStartupError } from '../../common/startup';

export const authRouter = Router();

const ALLOWED_ROLES = ['OWNER', 'ADMIN', 'CASHIER', 'PHARMACIST', 'WAREHOUSE_STAFF'] as const;

const normalizeUsername = (value: unknown) => String(value || '').trim().toLowerCase();

authRouter.get('/initial-status', asyncHandler(async (_req, res) => {
  const count = await prisma.user.count();
  res.json({ needsSetup: count === 0 });
}));

authRouter.post('/setup-admin', asyncHandler(async (req, res) => {
  const { password, name, login } = req.body ?? {};
  if (!login || !password || !name) {
    throw new ValidationError('name, login, and password are required');
  }

  validatePassword(String(password));

  const normalizedLogin = normalizeUsername(login);
  const trimmedName = String(name).trim();
  if (!normalizedLogin || !trimmedName) {
    throw new ValidationError('name and login are required');
  }

  const user = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('pharmapro.setup-admin'))`;

    const count = await tx.user.count();
    if (count > 0) {
      throw new ValidationError('System is already initialized');
    }


    const hashedPassword = await bcrypt.hash(String(password), 12);

    return tx.user.create({
      data: {

        username: normalizedLogin,
        password: hashedPassword,
        name: trimmedName,
        role: 'OWNER',
        isActive: true,
      },
    });
  });

  res.status(201).json({ success: true, username: user.username });
}));

authRouter.post('/register', authenticate, requireRole(['ADMIN', 'OWNER']), asyncHandler(async (req, res) => {
  const authedReq = req as AuthedRequest;
  const { password, name, role, username } = req.body ?? {};
  const normalizedRole = String(role || 'CASHIER').toUpperCase();
  const normalizedUsername = normalizeUsername(username);

  if (!normalizedUsername || !password || !name) {
    throw new ValidationError('username, password, and name are required');
  }
  validatePassword(String(password));
  if (!ALLOWED_ROLES.includes(normalizedRole as (typeof ALLOWED_ROLES)[number])) {
    throw new ValidationError('Invalid role');
  }
  if (normalizedRole === 'OWNER' && authedReq.user.role !== 'OWNER') {
    throw new ValidationError('Only OWNER can create another OWNER');
  }


  const existingUsername = await prisma.user.findUnique({
    where: { username: normalizedUsername },
    select: { id: true },
  });
  if (existingUsername) {
    throw new ValidationError('User with this username already exists');
  }

  const hashedPassword = await bcrypt.hash(String(password), 12);
  const user = await prisma.user.create({
    data: {
      username: normalizedUsername,
      password: hashedPassword,
      name: String(name).trim(),
      role: normalizedRole as (typeof ALLOWED_ROLES)[number],
      isActive: true,
    },
  });

  res.status(201).json({ id: user.id, username: user.username, name: user.name, role: user.role });
}));

authRouter.post('/login', asyncHandler(async (req, res) => {
  const loginField = String(req.body?.login || req.body?.username || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  if (!loginField || !password) {
    throw new ValidationError('login and password are required');
  }

  let candidates;
  try {
    candidates = await prisma.user.findMany({
      where: {
        username: loginField,
        isActive: true,
      },
      orderBy: { createdAt: 'asc' },
    });
  } catch (error) {
    if (isDatabaseStartupError(error)) {
      return res.status(503).json({ error: DATABASE_UNAVAILABLE_MESSAGE, code: 'DATABASE_UNAVAILABLE' });
    }
    throw error;
  }

  let user = null as (typeof candidates)[number] | null;
  for (const candidate of candidates) {
    if (await bcrypt.compare(password, candidate.password)) {
      user = candidate;
      break;
    }
  }

  if (!user) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

  const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, getJwtSecret(), { expiresIn: '1d' });
  res.json({ token, user: { id: user.id, username: user.username, name: user.name, role: user.role } });
}));
