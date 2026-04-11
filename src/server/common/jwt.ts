import { randomBytes } from 'crypto';

let cachedDevSecret: string | null = null;

export const getJwtSecret = () => {
  if (process.env.JWT_SECRET && process.env.JWT_SECRET.trim()) {
    return process.env.JWT_SECRET.trim();
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET must be configured in production');
  }

  if (!cachedDevSecret) {
    cachedDevSecret = `dev-${randomBytes(32).toString('hex')}`;
  }

  return cachedDevSecret;
};

export const isDevAuthBypassEnabled = () => (
  process.env.NODE_ENV !== 'production' && process.env.ALLOW_DEV_AUTH_BYPASS === 'true'
);
