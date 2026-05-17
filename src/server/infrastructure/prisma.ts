import { PrismaClient, Prisma } from './generated-client';
export { Prisma };

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

// Global bypass for stale types during production builds
export const db = prisma as any;

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
