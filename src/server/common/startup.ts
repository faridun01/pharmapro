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

export const logStartupError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error || 'Unknown startup error');

  if (isDatabaseStartupError(error)) {
    console.error('[startup] Database bootstrap skipped:', message);
    console.error('[startup] PharmaPro requires PostgreSQL for local development.');
    console.error(`[startup] DATABASE_URL: ${maskDatabaseUrl(process.env.DATABASE_URL)}`);
    console.error('[startup] Verify that PostgreSQL is running, the target database exists, and the username/password in .env are correct.');
    console.error('[startup] Example: DATABASE_URL="postgresql://postgres:postgres@localhost:5432/pharmapro?schema=public"');
    return;
  }

  console.error('[startup] ensureAdminUser failed:', message);
};