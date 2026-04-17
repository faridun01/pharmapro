import { Prisma } from '@prisma/client';

/**
 * Normalizes SKU string: trims whitespace.
 */
export const normalizeSku = (value: unknown): string => 
  (typeof value === 'string' ? value.trim() : '');

/**
 * Normalizes text that can be null: trims, removes 'null'/'undefined' strings.
 */
export const normalizeNullableText = (value: unknown): string | null | undefined => {
  if (value === undefined) return undefined;
  if (value === null) return null;

  const normalized = String(value).trim();
  if (!normalized || normalized.toLowerCase() === 'null' || normalized.toLowerCase() === 'undefined') {
    return null;
  }

  return normalized;
};

/**
 * Generates a unique SKU based on product name.
 */
export const buildGeneratedSku = (name: string): string => {
  const base = String(name || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 16);

  return `${base || 'ITEM'}-${Date.now().toString().slice(-6)}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
};

/**
 * Checks if a Prisma error is a unique constraint violation on the 'sku' field.
 */
export const isSkuConflictError = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  error.code === 'P2002' &&
  Array.isArray((error.meta as any)?.target) &&
  (error.meta as any).target.includes('sku');

/**
 * Checks if a Prisma error is a unique constraint violation on the 'barcode' field.
 */
export const isBarcodeConflictError = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  error.code === 'P2002' &&
  Array.isArray((error.meta as any)?.target) &&
  (error.meta as any).target.includes('barcode');

/**
 * Maps string status to ProductStatus enum.
 */
export const mapProductStatus = (status: string | undefined): 'ACTIVE' | 'LOW_STOCK' | 'OUT_OF_STOCK' | undefined => {
  if (!status) return undefined;
  const normalized = status.toUpperCase().replace(/\s+/g, '_');
  if (normalized === 'ACTIVE') return 'ACTIVE';
  if (normalized === 'LOW_STOCK' || normalized === 'LOW') return 'LOW_STOCK';
  if (normalized === 'OUT_OF_STOCK') return 'OUT_OF_STOCK';
  return undefined;
};

/**
 * Maps string status to BatchStatus enum.
 */
export const mapBatchStatus = (status: string | undefined): 'CRITICAL' | 'STABLE' | 'NEAR_EXPIRY' | 'EXPIRED' => {
  const normalized = (status || 'STABLE').toUpperCase().replace(/\s+/g, '_');
  if (normalized === 'CRITICAL' || normalized === 'STABLE' || normalized === 'NEAR_EXPIRY' || normalized === 'EXPIRED') {
    return normalized as any;
  }
  return 'STABLE';
};

/**
 * Safely parses JSON string for audit logs.
 */
export const parseAuditJson = (value: string | null): any => {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};
/**
 * Rounds a number to a fixed number of decimal places (default is 2).
 * Safely handles strings and null/undefined by converting to number.
 */
export const round = (value: unknown, precision: number = 2): number => {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return 0;
  const factor = Math.pow(10, precision);
  return Math.round(n * factor) / factor;
};
