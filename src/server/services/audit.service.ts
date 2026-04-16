import { prisma, Prisma } from '../infrastructure/prisma';
import { UserRole } from '../infrastructure/generated-client';

type AuditInput = {
  userId: string;
  userRole?: UserRole | null;
  module?: string;
  action: string;
  entity: string;
  entityId?: string;
  oldValue?: unknown;
  newValue?: unknown;
  reason?: string;
  details?: unknown;
};

export class AuditService {
  async log(input: AuditInput, db: Prisma.TransactionClient | typeof prisma = prisma) {
    await db.auditLog.create({
      data: {
        userId: input.userId,
        userRole: input.userRole ?? null,
        module: input.module,
        action: input.action,
        entity: input.entity,
        entityId: input.entityId,
        oldValue: input.oldValue ? JSON.stringify(input.oldValue) : null,
        newValue: input.newValue ? JSON.stringify(input.newValue) : null,
        reason: input.reason,
        details: input.details ? JSON.stringify(input.details) : null,
      },
    });
  }
}

export const auditService = new AuditService();
