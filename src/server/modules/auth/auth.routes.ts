import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../../infrastructure/prisma';
import { asyncHandler } from '../../common/http';
import { ValidationError } from '../../common/errors';
import { getJwtSecret } from '../../common/jwt';
import { DATABASE_UNAVAILABLE_MESSAGE, isDatabaseStartupError } from '../../common/startup';

export const authRouter = Router();

// GET /initial-status — Checks if the system needs first-time setup
authRouter.get('/initial-status', asyncHandler(async (req, res) => {
  const count = await prisma.user.count();
  res.json({ needsSetup: count === 0 });
}));

// POST /setup-admin — Creates the first OWNER user (only allowed if count is 0)
authRouter.post('/setup-admin', asyncHandler(async (req, res) => {
  const count = await prisma.user.count();
  if (count > 0) {
    throw new ValidationError('System is already initialized');
  }

  const { password, name, login } = req.body ?? {};
  if (!login || !password || !name) {
    throw new ValidationError('Имя, логин и пароль обязательны');
  }
  validatePassword(String(password));

  // Generate internal email to satisfy DB schema if login is not an email
  const email = login.includes('@') ? login.toLowerCase() : `${login.toLowerCase()}@pharmapro.local`;
  const username = login.toLowerCase();

  const hashedPassword = await bcrypt.hash(String(password), 12);
  const user = await prisma.user.create({
    data: { 
      email, 
      username,
      password: hashedPassword, 
      name: String(name).trim(), 
      role: 'OWNER', 
      isActive: true 
    },
  });

  res.status(201).json({ success: true, email: user.email });
}));

const normalizeEmail = (value: unknown) => String(value || '').trim().toLowerCase();

const validatePassword = (password: string) => {
  if (password.length < 8) {
    throw new ValidationError('Password must be at least 8 characters long');
  }
};

authRouter.post('/register', asyncHandler(async (req, res) => {
  const { password, name, role } = req.body ?? {};
  const email = normalizeEmail(req.body?.email);
  if (!email || !password || !name) {
    throw new ValidationError('email, password, and name are required');
  }
  validatePassword(String(password));

  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) {
    throw new ValidationError('User with this email already exists');
  }

  const hashedPassword = await bcrypt.hash(String(password), 12);
  const user = await prisma.user.create({
    data: { email, password: hashedPassword, name: String(name).trim(), role: role || 'CASHIER' },
  });

  res.status(201).json({ id: user.id, email: user.email, name: user.name, role: user.role });
}));

authRouter.post('/login', asyncHandler(async (req, res) => {
  const loginField = String(req.body?.login || req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  if (!loginField || !password) {
    throw new ValidationError('login and password are required');
  }

  let candidates;
  try {
    // Match by username (case-insensitive) or email.
    // We fetch candidates and verify password against each to avoid false negatives
    // when duplicate usernames exist in legacy/dev datasets.
    candidates = await prisma.user.findMany({
      where: {
        OR: [
          { email: loginField },
          { username: { equals: loginField, mode: 'insensitive' } },
        ],
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

  const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, getJwtSecret(), { expiresIn: '1d' });
  res.json({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role } });
}));
