import './src/server/env';
import path from 'path';
import express from 'express';
import { createApp } from './src/server/app/createApp';
import { ensureAdminUser } from './src/server/common/auth';
import { logStartupError } from './src/server/common/startup';
import { config } from './src/server/config';
import { logger } from './src/server/common/logger';
import { prisma } from './src/server/infrastructure/prisma';
import { pingDatabase } from './src/server/common/startup';

const app = createApp();
const isDev = config.NODE_ENV === 'development';

if (!isDev) {
  const distPath = path.join(process.cwd(), 'dist');
  app.use(express.static(distPath));
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api/')) {
      return res.status(404).json({
        error: 'API route not found',
        code: 'API_NOT_FOUND',
      });
    }
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

const server = app.listen(config.PORT, '0.0.0.0', async () => {
  logger.info(`PharmaPro ${isDev ? 'API server' : 'server'} running on http://localhost:${config.PORT}`);
  logger.info(`Environment: ${config.NODE_ENV}`);
  
  await pingDatabase();
  
  try {
    await ensureAdminUser();
  } catch (err) {
    logStartupError(err);
  }
});

const shutdown = async () => {
  logger.info('Shutting down server...');
  server.close(async () => {
    logger.info('Express server closed.');
    try {
      await prisma.$disconnect();
      logger.info('Prisma disconnected.');
      process.exit(0);
    } catch (err) {
      logger.error('Error during Prisma disconnect:', err);
      process.exit(1);
    }
  });
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
