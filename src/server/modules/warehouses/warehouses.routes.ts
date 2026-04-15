import { Router } from 'express';
import { authenticate, requireRole } from '../../common/auth';
import { asyncHandler } from '../../common/http';
import { prisma } from '../../infrastructure/prisma';

export const warehousesRouter = Router();

// GET / — all authenticated users
warehousesRouter.get('/', authenticate, asyncHandler(async (_req, res) => {
  const warehouses = await prisma.warehouse.findMany({
    where: { isActive: true },
    orderBy: { isDefault: 'desc' },
  });
  res.json(warehouses);
}));
