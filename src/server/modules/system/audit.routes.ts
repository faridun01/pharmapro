import { Router } from 'express';
import { authenticate, requireRole } from '../../common/auth';
import { asyncHandler } from '../../common/http';
import { prisma } from '../../infrastructure/prisma';
import { ValidationError } from '../../common/errors';

export const auditRouter = Router();

const VALID_MODULES = ['catalog', 'inventory', 'sales', 'returns', 'writeoff', 'suppliers', 'shifts', 'system', 'reports', 'users'] as const;

// GET /api/audit — paginated, filterable audit log (ADMIN/OWNER only)
auditRouter.get(
  '/',
  authenticate,
  requireRole(['ADMIN', 'OWNER']),
  asyncHandler(async (req, res) => {
    const page   = Math.max(1, Number(req.query.page) || 1);
    const limit  = Math.max(1, Math.min(100, Number(req.query.limit) || 50));
    const module = String(req.query.module || '').trim() || undefined;
    const userId = String(req.query.userId || '').trim() || undefined;
    const action = String(req.query.action || '').trim() || undefined;
    const from   = req.query.from ? new Date(String(req.query.from)) : undefined;
    const to     = req.query.to   ? new Date(String(req.query.to))   : undefined;

    if (module && !VALID_MODULES.includes(module as any)) {
      throw new ValidationError(`Unknown module filter: ${module}`);
    }

    const where: any = {
      ...(module ? { module } : {}),
      ...(userId ? { userId } : {}),
      ...(action ? { action: { contains: action, mode: 'insensitive' } } : {}),
      ...(from || to ? {
        createdAt: {
          ...(from ? { gte: from } : {}),
          ...(to   ? { lte: to }   : {}),
        },
      } : {}),
    };

    const [total, items] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id:        true,
          module:    true,
          action:    true,
          entity:    true,
          entityId:  true,
          userRole:  true,
          createdAt: true,
          // only show a truncated preview of old/new – never exposing passwords
          oldValue:  true,
          newValue:  true,
          user: { select: { id: true, name: true, email: true } },
        },
      }),
    ]);

    // Scrub any 'password' keys from JSON payloads before sending to client
    const scrub = (raw: string | null): any => {
      if (!raw) return null;
      try {
        const obj = JSON.parse(raw);
        if (obj && typeof obj === 'object') {
          delete obj.password;
          delete obj.hashedPassword;
        }
        return obj;
      } catch {
        return null; // truncated / non-JSON
      }
    };

    res.json({
      items: items.map((item) => ({
        ...item,
        oldValue: scrub(item.oldValue),
        newValue: scrub(item.newValue),
      })),
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    });
  }),
);

// GET /api/audit/users — list of users for the filter dropdown
auditRouter.get(
  '/users',
  authenticate,
  requireRole(['ADMIN', 'OWNER']),
  asyncHandler(async (_req, res) => {
    const users = await prisma.user.findMany({
      select: { id: true, name: true, email: true },
      orderBy: { name: 'asc' },
    });
    res.json(users);
  }),
);
