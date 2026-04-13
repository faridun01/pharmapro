import { prisma } from '../infrastructure/prisma';
import { logger } from './logger';

const maskDatabaseUrl = (value?: string) => {
  if (!value) return '(not set)';

  try {
    const url = new URL(value);
    if (url.password) {
      url.password = '***';
    }
    return url.toString();
  } catch {
    return '(invalid DATABASE_URL format)';
  }
};

export const DATABASE_UNAVAILABLE_MESSAGE = 'Database is not available. Check PostgreSQL connection settings.';

export const isDatabaseStartupError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error || '');

  return (
    message.includes('Authentication failed against database server') ||
    message.includes("Can't reach database server") ||
    message.includes('Environment variable not found: DATABASE_URL') ||
    message.includes('Error validating datasource')
  );
};

export const pingDatabase = async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    logger.info('Database connection verified.');
    return true;
  } catch (error) {
    if (isDatabaseStartupError(error)) {
      logger.error('Database connection failed during ping.', { 
        url: maskDatabaseUrl(process.env.DATABASE_URL) 
      });
    } else {
      logger.error('Unexpected database error during ping.', error);
    }
    return false;
  }
};

export const logStartupError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error || 'Unknown startup error');

  if (isDatabaseStartupError(error)) {
    logger.error('Database bootstrap skipped:', message);
    return;
  }

  logger.error('Startup task failed:', message);
};