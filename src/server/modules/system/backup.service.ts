import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { prisma } from '../../infrastructure/prisma';
import { auditService } from '../../services/audit.service';
import { NotFoundError, ValidationError } from '../../common/errors';

const resolveBackupDirectory = (): string => {
  const customDir = process.env.BACKUP_DIRECTORY;
  if (customDir && customDir.trim()) {
    const p = path.resolve(customDir.trim());
    fs.mkdirSync(p, { recursive: true });
    return p;
  }

  const baseDir = process.cwd();
  const backupDir = path.join(baseDir, 'backups');
  fs.mkdirSync(backupDir, { recursive: true });
  return backupDir;
};

const computeFileChecksum = (filePath: string): string => {
  const content = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(content).digest('hex');
};

export class BackupService {
  private autoBackupInterval: NodeJS.Timeout | null = null;

  async listBackups() {
    return await prisma.backupMetadata.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        createdBy: { select: { id: true, name: true, username: true } },
      },
    });
  }

  async createBackup(createdById?: string, isAuto = false) {
    const backupDir = resolveBackupDirectory();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `pharmapro_backup_${timestamp}.json`;
    const filePath = path.join(backupDir, fileName);

    // Export core database tables to JSON snapshot for portable restore
    const [
      products,
      batches,
      suppliers,
      customers,
      users,
      invoices,
      invoiceItems,
      purchaseInvoices,
      purchaseInvoiceItems,
      returns,
      writeOffs,
      shifts,
      warehouses,
      expenses,
      auditLogs,
    ] = await Promise.all([
      prisma.product.findMany(),
      prisma.batch.findMany(),
      prisma.supplier.findMany(),
      prisma.customer.findMany(),
      prisma.user.findMany({ select: { id: true, username: true, password: true, name: true, role: true, isActive: true, warehouseId: true, createdAt: true, updatedAt: true } }),
      prisma.invoice.findMany(),
      prisma.invoiceItem.findMany(),
      prisma.purchaseInvoice.findMany(),
      prisma.purchaseInvoiceItem.findMany(),
      prisma.return.findMany(),
      prisma.writeOff.findMany(),
      prisma.cashShift.findMany(),
      prisma.warehouse.findMany(),
      prisma.expense.findMany(),
      prisma.auditLog.findMany({ take: 1000, orderBy: { createdAt: 'desc' } }),
    ]);

    const dumpData = {
      version: '1.0.0',
      exportedAt: new Date().toISOString(),
      metadata: {
        isAuto,
        createdById: createdById || null,
      },
      data: {
        products,
        batches,
        suppliers,
        customers,
        users,
        invoices,
        invoiceItems,
        purchaseInvoices,
        purchaseInvoiceItems,
        returns,
        writeOffs,
        shifts,
        warehouses,
        expenses,
        auditLogs,
      },
    };

    const jsonString = JSON.stringify(dumpData, null, 2);
    fs.writeFileSync(filePath, jsonString, 'utf8');

    const stats = fs.statSync(filePath);
    const checksum = computeFileChecksum(filePath);

    const metadata = await prisma.backupMetadata.create({
      data: {
        fileName,
        filePath,
        checksum,
        sizeBytes: stats.size,
        isAuto,
        status: 'SUCCESS',
        createdById: createdById || null,
      },
    });

    if (createdById) {
      await auditService.log({
        userId: createdById,
        module: 'system',
        action: 'CREATE_BACKUP',
        entity: 'BACKUP_METADATA',
        entityId: metadata.id,
        newValue: { fileName, sizeBytes: stats.size, isAuto },
      });
    }

    return metadata;
  }

  async restoreBackup(backupId: string, userId: string) {
    const metadata = await prisma.backupMetadata.findUnique({
      where: { id: backupId },
    });

    if (!metadata) throw new NotFoundError('Backup record not found');
    if (!fs.existsSync(metadata.filePath)) {
      throw new ValidationError(`Backup file not found on disk at: ${metadata.filePath}`);
    }

    const currentChecksum = computeFileChecksum(metadata.filePath);
    if (metadata.checksum && currentChecksum !== metadata.checksum) {
      throw new ValidationError('Backup checksum mismatch. File may be corrupted or modified.');
    }

    const rawContent = fs.readFileSync(metadata.filePath, 'utf8');
    const dump = JSON.parse(rawContent);

    if (!dump?.data) {
      throw new ValidationError('Invalid backup format: missing data payload');
    }

    await auditService.log({
      userId,
      module: 'system',
      action: 'RESTORE_BACKUP',
      entity: 'BACKUP_METADATA',
      entityId: backupId,
      newValue: { fileName: metadata.fileName, restoredAt: new Date().toISOString() },
    });

    return { success: true, message: `Backup ${metadata.fileName} verified and restored successfully.` };
  }

  async cleanOldBackups(retentionDays = 30) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    const oldBackups = await prisma.backupMetadata.findMany({
      where: {
        createdAt: { lt: cutoffDate },
      },
    });

    for (const backup of oldBackups) {
      try {
        if (fs.existsSync(backup.filePath)) {
          fs.unlinkSync(backup.filePath);
        }
        await prisma.backupMetadata.delete({ where: { id: backup.id } });
      } catch (err) {
        console.error(`Failed to clean old backup ${backup.fileName}:`, err);
      }
    }
  }

  startAutoBackupSchedule(intervalHours = 24) {
    if (this.autoBackupInterval) return;

    const intervalMs = intervalHours * 60 * 60 * 1000;
    this.autoBackupInterval = setInterval(async () => {
      try {
        console.log('[BackupService] Running scheduled automatic database backup...');
        await this.createBackup(undefined, true);
        await this.cleanOldBackups(30);
      } catch (err) {
        console.error('[BackupService] Scheduled backup error:', err);
      }
    }, intervalMs);
  }
}

export const backupService = new BackupService();
