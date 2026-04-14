import { execSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import pkg from 'pg';
const { Client } = pkg;
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

export const ensureDatabaseExists = async (databaseUrl: string) => {
  try {
    const url = new URL(databaseUrl);
    const databaseName = url.pathname.substring(1); // remove leading slash
    
    if (!databaseName) return;

    // Connect to the default 'postgres' database to check/create our target DB
    url.pathname = '/postgres';
    const maintenanceUrl = url.toString();

    const client = new Client({ connectionString: maintenanceUrl });
    
    logger.info(`Checking if database '${databaseName}' exists...`);
    
    await client.connect();
    
    try {
      const res = await client.query(
        'SELECT 1 FROM pg_database WHERE datname = $1',
        [databaseName]
      );

      if (res.rowCount === 0) {
        logger.info(`Database '${databaseName}' does not exist. Creating...`);
        // CREATE DATABASE cannot be run in a transaction, so we use a separate query
        await client.query(`CREATE DATABASE "${databaseName}"`);
        logger.info(`Database '${databaseName}' created successfully.`);
      } else {
        logger.info(`Database '${databaseName}' already exists.`);
      }
    } finally {
      await client.end();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Failed to ensure database exists.', { error: message });
    // We don't throw here, as Prisma might still work if the URL was 
    // pointing to a DB that exists but my check failed for other reasons.
  }
};

export const runDatabaseMigrations = async () => {
  const isProduction = process.env.NODE_ENV === 'production';
  // In development, we use project root. In production (Electron), we use the app package root.
  const projectRoot = isProduction 
    ? path.resolve(process.cwd(), '..') // In Electron, backend usually runs from unpacked/dist-server
    : process.cwd();

  const prismaCli = path.resolve(
    projectRoot,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'prisma.cmd' : 'prisma'
  );

  const schemaPath = path.resolve(projectRoot, 'prisma', 'schema.prisma');

  if (!fs.existsSync(schemaPath)) {
    logger.warn('Schema file not found, skipping migrations.', { path: schemaPath });
    return;
  }

  logger.info('Checking database migrations...', {
    env: process.env.NODE_ENV,
    schema: schemaPath,
  });

  try {
    // We use migrate deploy to apply pending migrations without data loss or reset.
    const output = execSync(`"${prismaCli}" migrate deploy --schema="${schemaPath}"`, {
      env: {
        ...process.env,
        // Ensure Prisma doesn't try to open interactive prompts
        PRISMA_CLI_QUERY_ENGINE_TYPE: 'library',
      },
      encoding: 'utf8',
    });
    
    logger.info('Database migrations applied successfully.', { output: output.trim() });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Database migration failed.', { error: message });
    // This is critical: if migrations fail, we should throw to block startup
    throw new Error(`Database migration failed: ${message}`);
  }
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