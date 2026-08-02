import { describe, it, expect, vi, beforeEach } from 'vitest';
import { transfersService } from '../transfers.service';
import { db } from '../../../infrastructure/prisma';
import { ValidationError, NotFoundError } from '../../../common/errors';

vi.mock('../../../infrastructure/prisma', () => ({
  db: {
    warehouse: {
      findUnique: vi.fn(),
    },
    product: {
      findUnique: vi.fn(),
    },
    batch: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
    stockTransfer: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
      findMany: vi.fn(),
    },
    batchMovement: {
      create: vi.fn(),
    },
    warehouseStock: {
      upsert: vi.fn(),
    },
    $transaction: vi.fn((cb) => cb(db)),
  },
}));

vi.mock('../../../services/audit.service', () => ({
  auditService: {
    log: vi.fn(),
  },
}));

describe('TransfersService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws ValidationError if source and target warehouses are identical', async () => {
    await expect(
      transfersService.createTransfer({
        fromWarehouseId: 'wh-1',
        toWarehouseId: 'wh-1',
        items: [{ productId: 'prod-1', quantity: 5 }],
        userId: 'user-1',
      }),
    ).rejects.toThrow(ValidationError);
  });

  it('throws NotFoundError if source warehouse does not exist', async () => {
    (db.warehouse.findUnique as any).mockImplementation((args: any) => {
      if (args.where.id === 'wh-1') return Promise.resolve(null);
      return Promise.resolve({ id: 'wh-2', name: 'Target WH' });
    });

    await expect(
      transfersService.createTransfer({
        fromWarehouseId: 'wh-1',
        toWarehouseId: 'wh-2',
        items: [{ productId: 'prod-1', quantity: 5 }],
        userId: 'user-1',
      }),
    ).rejects.toThrow(NotFoundError);
  });

  it('creates stock transfer in_transit state successfully', async () => {
    (db.warehouse.findUnique as any).mockImplementation((args: any) => {
      if (args.where.id === 'wh-1') return Promise.resolve({ id: 'wh-1', name: 'Source WH' });
      if (args.where.id === 'wh-2') return Promise.resolve({ id: 'wh-2', name: 'Target WH' });
      return Promise.resolve(null);
    });

    (db.product.findUnique as any).mockResolvedValue({ id: 'prod-1', name: 'Aspirin', totalStock: 100 });
    (db.stockTransfer.create as any).mockResolvedValue({
      id: 'trf-1',
      transferNo: 'TRF-20260802-1234',
      fromWarehouseId: 'wh-1',
      toWarehouseId: 'wh-2',
      status: 'IN_TRANSIT',
      items: [{ id: 'item-1', productId: 'prod-1', quantity: 5 }],
    });

    const result = await transfersService.createTransfer({
      fromWarehouseId: 'wh-1',
      toWarehouseId: 'wh-2',
      items: [{ productId: 'prod-1', quantity: 5 }],
      userId: 'user-1',
    });

    expect(result.id).toBe('trf-1');
    expect(result.status).toBe('IN_TRANSIT');
  });
});
