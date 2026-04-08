import { createServer as createViteServer } from 'vite';
import path from 'path';
import express from 'express';
import dotenv from 'dotenv';
import { createApp } from './src/server/app/createApp';
import { ensureAdminUser } from './src/server/common/auth';
import { ensureProductPackagingBackfill } from './src/server/services/packaging.service';

dotenv.config();

const isDev = process.env.NODE_ENV !== 'production';

// Conditional logger - only logs in development
const log = {
  info: (msg: string, data?: any) => {
    if (isDev) {
      console.log(`[INFO] ${msg}`, data || '');
    }
  },
  warn: (msg: string, data?: any) => {
    if (isDev) {
      console.warn(`[WARN] ${msg}`, data || '');
    }
  },
  error: (msg: string, err?: any) => {
    console.error(`[ERROR] ${msg}`, err || '');
  },
};

const app = createApp();
const PORT = Number(process.env.PORT || 3000);

if (isDev) {
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: 'spa',
  });
  app.use(vite.middlewares);
  log.info('Vite dev server attached');
} else {
  const distPath = path.join(process.cwd(), 'dist');
  app.use(express.static(distPath));
  app.get('*', (_req, res) => {
    if (_req.path.startsWith('/api/')) {
      return res.status(404).json({
        error: 'API route not found',
        code: 'API_NOT_FOUND',
      });
    }
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

app.listen(PORT, '0.0.0.0', async () => {
  console.log(`PharmaPro server running on http://localhost:${PORT}`);
  await ensureAdminUser();
  const packagingBackfill = await ensureProductPackagingBackfill();
  if (packagingBackfill.updated > 0) {
    log.info(`Backfilled unitsPerPack for ${packagingBackfill.updated} products`);
  }
});
