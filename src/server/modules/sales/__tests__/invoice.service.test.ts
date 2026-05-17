import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invoiceService } from '../invoice.service';
import { prisma } from '../../../infrastructure/prisma';
import { ValidationError } from '../../../common/errors';

// Mock prisma
vi.mock('../../../infrastructure/prisma', () => ({
  prisma: {
    invoice: {
      findUnique: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      aggregate: vi.fn(),
    },
    payment: {
      create: vi.fn(),
      aggregate: vi.fn(),
    },
    receivable: {
      update: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
    $transaction: vi.fn((cb) => cb(prisma)),
  },
}));

describe('InvoiceService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('addPayment', () => {
    it('should throw ValidationError if amount is non-positive', async () => {
      await expect(
        invoiceService.addPayment('inv-1', { amount: 0 }, 'user-1', 'ADMIN')
      ).rejects.toThrow(ValidationError);
    });

    it('should throw ValidationError if invoice is already paid', async () => {
      (prisma.invoice.findUnique as any).mockResolvedValue({
        id: 'inv-1',
        totalAmount: 100,
        status: 'PAID'
      });
      (prisma.payment.aggregate as any).mockResolvedValue({ _sum: { amount: 100 } });

      await expect(
        invoiceService.addPayment('inv-1', { amount: 10 }, 'user-1', 'ADMIN')
      ).rejects.toThrow('already fully paid');
    });
  });
});
