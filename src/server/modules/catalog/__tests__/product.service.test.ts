import { describe, it, expect, vi, beforeEach } from 'vitest';
import { productService } from '../product.service';
import { prisma } from '../../../infrastructure/prisma';
import { ValidationError } from '../../../common/errors';

// Mock prisma
vi.mock('../../../infrastructure/prisma', () => ({
  prisma: {
    product: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
      findMany: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
  },
}));

describe('ProductService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createProduct', () => {
    it('should throw ValidationError if name is missing', async () => {
      await expect(
        productService.createProduct({}, 'user-1', 'ADMIN')
      ).rejects.toThrow(ValidationError);
    });

    it('should throw ValidationError if price is negative', async () => {
      await expect(
        productService.createProduct({ name: 'Test', sellingPrice: -10 }, 'user-1', 'ADMIN')
      ).rejects.toThrow(ValidationError);
    });

    it('should return existing product if name and country match', async () => {
      const existingProduct = { id: 'prod-1', name: 'Test', countryOfOrigin: 'Germany' };
      // Note: findExistingProductByName is not mocked here but it uses prisma internally 
      // or we can mock the whole module for better isolation if needed.
      // For now let's mock the prisma call it likely makes.
      (prisma.product.findFirst as any).mockResolvedValue(existingProduct);

      const result = await productService.createProduct({ name: 'Test', countryOfOrigin: 'Germany' }, 'user-1', 'ADMIN');
      expect(result).toEqual(existingProduct);
    });
  });
});
