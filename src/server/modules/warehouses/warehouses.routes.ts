import { Router } from 'express';
import { authenticate } from '../../common/auth';
import { asyncHandler } from '../../common/http';
import { prisma } from '../../infrastructure/prisma';

export const warehousesRouter = Router();

warehousesRouter.get('/', authenticate, asyncHandler(async (_req, res) => {
  const warehouses = await prisma.warehouse.findMany({
    where: { isActive: true },
    orderBy: { isDefault: 'desc' },
  });
  res.json(warehouses);
}));
