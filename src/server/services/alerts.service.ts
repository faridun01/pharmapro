import { prisma } from '../infrastructure/prisma';
import { computeBatchStatus } from '../common/batchStatus';

export class AlertsService {
  async getLowStockAlerts() {
    return await prisma.product.findMany({
      where: {
        isActive: true,
        totalStock: { lte: prisma.product.fields.minStock },
      },
      select: {
        id: true,
        name: true,
        sku: true,
        totalStock: true,
        minStock: true,
      },
      orderBy: { totalStock: 'asc' },
      take: 50,
    });
  }

  async getExpiringAlerts(daysThreshold = 90) {
    const thresholdDate = new Date();
    thresholdDate.setDate(thresholdDate.getDate() + daysThreshold);

    const batches = await prisma.batch.findMany({
      where: {
        quantity: { gt: 0 },
        expiryDate: { lte: thresholdDate },
      },
      include: {
        product: {
          select: { name: true }
        }
      },
      orderBy: { expiryDate: 'asc' },
      take: 50,
    });

    return batches.map(b => ({
      batchId: b.id,
      productName: b.product.name,
      batchNumber: b.batchNumber,
      expiryDate: b.expiryDate,
      quantity: b.quantity,
      daysLeft: Math.ceil((b.expiryDate.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)),
      status: computeBatchStatus(b.expiryDate)
    }));
  }

  async getDashboardAlerts() {
    const [lowStock, expiring] = await Promise.all([
      this.getLowStockAlerts(),
      this.getExpiringAlerts(),
    ]);

    return {
      lowStockCount: lowStock.length,
      expiringCount: expiring.length,
      alerts: [
        ...lowStock.map(p => ({
          type: 'LOW_STOCK',
          message: `Product ${p.name} is low on stock (${p.totalStock} left, min: ${p.minStock})`,
          entityId: p.id,
          severity: p.totalStock === 0 ? 'CRITICAL' : 'WARNING'
        })),
        ...expiring.map(b => ({
          type: 'EXPIRING',
          message: `Batch ${b.batchNumber} of ${b.productName} expires in ${b.daysLeft} days`,
          entityId: b.batchId,
          severity: b.daysLeft <= 30 ? 'CRITICAL' : 'WARNING'
        }))
      ]
    };
  }
}

export const alertsService = new AlertsService();
