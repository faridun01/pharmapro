import { Product, IProductRepository, ILogger } from '../core/domain';

/**
 * LocalStorage Implementation of IProductRepository.
 * Handles the "messy" details of serialization and storage.
 */
export class LocalStorageProductRepository implements IProductRepository {
  private readonly STORAGE_KEY = 'pharmapro_products';

  async getAll(): Promise<Product[]> {
    const data = localStorage.getItem(this.STORAGE_KEY);
    if (!data) return [];
    
    const rawProducts = JSON.parse(data);
    return rawProducts.map((p: any) => this.mapToEntity(p));
  }

  async getById(id: string): Promise<Product | null> {
    const products = await this.getAll();
    return products.find(p => p.id === id) || null;
  }

  async getBySku(sku: string): Promise<Product | null> {
    const products = await this.getAll();
    return products.find(p => p.sku === sku) || null;
  }

  async save(product: Product): Promise<Product> {
    const products = await this.getAll();
    products.push(product);
    this.persist(products);
    return product;
  }

  async update(product: Product): Promise<void> {
    const products = await this.getAll();
    const index = products.findIndex(p => p.id === product.id);
    if (index > -1) {
      products[index] = product;
      this.persist(products);
    }
  }

  async delete(id: string): Promise<void> {
    const products = await this.getAll();
    const filtered = products.filter(p => p.id !== id);
    this.persist(filtered);
  }

  private persist(products: Product[]): void {
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(products));
  }

  /**
   * Maps raw JSON data back to Domain Entities with proper Date objects.
   */
  private mapToEntity(data: any): Product {
    return {
      ...data,
      batches: (data.batches || []).map((b: any) => ({
        ...b,
        manufacturedDate: new Date(b.manufacturedDate),
        expiryDate: new Date(b.expiryDate),
        movements: (b.movements || []).map((m: any) => ({
          ...m,
          date: new Date(m.date)
        }))
      }))
    };
  }
}

/**
 * Simple Console Implementation of ILogger.
 * Respects __DEV__ flag to suppress logs in production.
 */
export class ConsoleLogger implements ILogger {
  private isDev = typeof __DEV__ !== 'undefined' ? __DEV__ : process.env.NODE_ENV !== 'production';

  info(message: string, data?: any): void {
    if (this.isDev) {
      console.log(`[INFO] ${new Date().toISOString()}: ${message}`, data || '');
    }
  }

  error(message: string, error?: any): void {
    // Always log errors, even in production
    console.error(`[ERROR] ${new Date().toISOString()}: ${message}`, error || '');
  }

  warn(message: string, data?: any): void {
    if (this.isDev) {
      console.warn(`[WARN] ${new Date().toISOString()}: ${message}`, data || '');
    }
  }
}
