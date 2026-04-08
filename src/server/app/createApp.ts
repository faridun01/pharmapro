import express from 'express';
import compression from 'compression';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { authRouter } from '../modules/auth/auth.routes';
import { productsRouter } from '../modules/catalog/products.routes';
import { invoicesRouter } from '../modules/sales/invoices.routes';
import { salesRouter } from '../modules/sales/sales.routes';
import { suppliersRouter } from '../modules/suppliers/suppliers.routes';
import { customersRouter } from '../modules/customers/customers.routes';
import { ocrRouter } from '../modules/ocr/ocr.routes';
import { inventoryRouter } from '../modules/inventory/inventory.routes';
import { returnsRouter } from '../modules/returns/returns.routes';
import { writeoffRouter } from '../modules/writeoff/writeoff.routes';
import { shiftsRouter } from '../modules/shifts/shifts.routes';
import { warehousesRouter } from '../modules/warehouses/warehouses.routes';
import { reportsRouter } from '../modules/reports/reports.routes';
import { systemRouter } from '../modules/system/system.routes';
import { devRouter } from '../modules/dev/dev.routes';
import { errorMiddleware } from '../common/http';

export const createApp = () => {
  const app = express();
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many authentication attempts, please retry later' },
  });

  app.disable('x-powered-by');
  app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  }));
  app.use(compression());
  app.use(express.json({ limit: '12mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'pharmapro-api' });
  });

  app.use('/api/auth', authLimiter, authRouter);
  app.use('/api/products', productsRouter);
  app.use('/api/invoices', invoicesRouter);
  app.use('/api/sales', salesRouter);
  app.use('/api/inventory', inventoryRouter);
  app.use('/api/suppliers', suppliersRouter);
  app.use('/api/customers', customersRouter);
  app.use('/api/invoices/ocr', ocrRouter);
  app.use('/api/ocr/invoices', ocrRouter);
  app.use('/api/returns', returnsRouter);
  app.use('/api/writeoffs', writeoffRouter);
  app.use('/api/shifts', shiftsRouter);
  app.use('/api/warehouses', warehousesRouter);
  app.use('/api/reports', reportsRouter);
  app.use('/api/system', systemRouter);
  if (process.env.NODE_ENV !== 'production') {
    app.use('/api/dev', devRouter);
  }

  app.use(errorMiddleware);
  return app;
};
