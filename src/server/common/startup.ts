import { execFileSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import pkg from 'pg';
const { Client } = pkg;
import { prisma } from '../infrastructure/prisma';
import { logger } from './logger';

const currentDir =
  typeof __dirname !== 'undefined'
    ? __dirname
    : path.dirname(process.argv[1] || process.cwd());

const findExistingPath = (candidates: Array<string | undefined | null>) =>
  candidates.find((candidate) => Boolean(candidate) && fs.existsSync(candidate)) ?? null;

const resolveRuntimeRoot = () => {
  const explicitRoot = process.env.PHARMAPRO_RUNTIME_ROOT;
  if (explicitRoot && fs.existsSync(explicitRoot)) {
    return explicitRoot;
  }

  const candidates = [
    process.cwd(),
    path.resolve(currentDir, '..'),
    path.resolve(currentDir, '../..'),
    path.resolve(currentDir, '../../..'),
    path.resolve(process.cwd(), '..'),
  ];

  const rootWithPrisma = candidates.find((candidate) =>
    fs.existsSync(path.join(candidate, 'prisma', 'schema.prisma'))
  );

  return rootWithPrisma ?? candidates[0];
};

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
  const runtimeRoot = resolveRuntimeRoot();
  const schemaPath = findExistingPath([
    process.env.PHARMAPRO_PRISMA_SCHEMA,
    path.join(runtimeRoot, 'prisma', 'schema.prisma'),
    path.join(currentDir, '..', 'prisma', 'schema.prisma'),
    path.join(currentDir, '../..', 'prisma', 'schema.prisma'),
    path.join(currentDir, '../../..', 'prisma', 'schema.prisma'),
    path.join(process.cwd(), 'prisma', 'schema.prisma'),
    path.join(process.cwd(), '..', 'prisma', 'schema.prisma'),
  ]);

  const prismaCliEntry = findExistingPath([
    path.join(runtimeRoot, 'node_modules', 'prisma', 'build', 'index.js'),
    path.join(currentDir, '..', 'node_modules', 'prisma', 'build', 'index.js'),
    path.join(currentDir, '../..', 'node_modules', 'prisma', 'build', 'index.js'),
    path.join(currentDir, '../../..', 'node_modules', 'prisma', 'build', 'index.js'),
    path.join(process.cwd(), 'node_modules', 'prisma', 'build', 'index.js'),
    path.join(process.cwd(), '..', 'node_modules', 'prisma', 'build', 'index.js'),
  ]);

  if (!schemaPath) {
    logger.warn('Schema file not found, skipping migrations.', { path: schemaPath });
    return;
  }

  if (!prismaCliEntry) {
    logger.warn('Prisma CLI entry not found, skipping migrations.', { runtimeRoot });
    return;
  }

  logger.info('Checking database migrations...', {
    env: process.env.NODE_ENV,
    schema: schemaPath,
    prismaCliEntry,
    runtimeRoot,
  });

  try {
    // We use migrate deploy to apply pending migrations without data loss or reset.
    const output = execFileSync(process.execPath, [prismaCliEntry, 'migrate', 'deploy', `--schema=${schemaPath}`], {
      cwd: runtimeRoot,
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
