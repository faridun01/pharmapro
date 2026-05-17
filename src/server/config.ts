import { z } from 'zod';
import './env'; // Ensure env vars are loaded

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3921),
  DATABASE_URL: z.string().url().optional(),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters').or(z.string().optional().refine(val => process.env.NODE_ENV !== 'production', {
    message: 'JWT_SECRET is required in production',
  })),
  ELECTRON_DESKTOP_AUTH_SECRET: z.string().optional(),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

const getRawConfig = () => {
  const DEFAULT_DB_URL = 'postgresql://postgres:postgres@localhost:5432/pharmapro';
  
  return {
    NODE_ENV: process.env.NODE_ENV,
    PORT: process.env.PORT,
    DATABASE_URL: process.env.DATABASE_URL || DEFAULT_DB_URL,
    JWT_SECRET: process.env.JWT_SECRET,
    ELECTRON_DESKTOP_AUTH_SECRET: process.env.ELECTRON_DESKTOP_AUTH_SECRET,
    LOG_LEVEL: process.env.LOG_LEVEL,
  };
};

const _parseConfig = () => {
  const raw = getRawConfig();
  const parsed = configSchema.safeParse(raw);
  
  if (!parsed.success) {
    console.error('❌ Invalid environment configuration:');
    parsed.error.issues.forEach((issue) => {
      console.error(`   - ${issue.path.join('.')}: ${issue.message}`);
    });
    // In production, we must fail-fast
    if (process.env.NODE_ENV === 'production') {
      process.exit(1);
    }
    return raw as any as z.infer<typeof configSchema>;
  }
  
  return parsed.data;
};

export const config = _parseConfig();
export type Config = z.infer<typeof configSchema>;
