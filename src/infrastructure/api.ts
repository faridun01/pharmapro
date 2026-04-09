import { 
  Product, 
  IProductRepository, 
  Invoice, 
  IInvoiceRepository, 
  Supplier, 
  ISupplierRepository,
} from '../core/domain';

type DesktopBridge = {
  authHeaders?: () => Promise<Record<string, string>> | Record<string, string>;
};

const getDesktopBridge = (): DesktopBridge | undefined => {
  if (typeof window === 'undefined') return undefined;
  return (window as Window & { pharmaproDesktop?: DesktopBridge }).pharmaproDesktop;
};

export const buildApiHeaders = async (contentType = true) => {
  const token = window.sessionStorage.getItem('pharmapro_token') || localStorage.getItem('pharmapro_token');
  const desktopHeaders = await getDesktopBridge()?.authHeaders?.();

  return {
    ...(contentType ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(desktopHeaders || {}),
  };
};

/**
 * Base API class to handle common logic like auth headers.
 */
class BaseApi {
  protected async getHeaders() {
    return buildApiHeaders();
  }

  private async parseJsonSafe(response: Response): Promise<any> {
    const contentType = response.headers.get('content-type') || '';
    const raw = await response.text();

    if (!raw) return {};

    if (contentType.includes('application/json')) {
      return JSON.parse(raw);
    }

    // Some environments can return HTML (e.g. SPA fallback page) for API paths.
    if (raw.trimStart().startsWith('<!doctype') || raw.trimStart().startsWith('<html')) {
      throw new Error('API returned HTML instead of JSON. Backend may be unavailable.');
    }

    try {
      return JSON.parse(raw);
    } catch {
      throw new Error('API returned invalid JSON response.');
    }
  }

  protected async handleResponse(response: Response) {
    const parsed = await this.parseJsonSafe(response);

    if (!response.ok) {
      throw new Error(parsed.error || 'API request failed');
    }

    return parsed;
  }
}

export class ApiProductRepository extends BaseApi implements IProductRepository {
  private readonly baseUrl = '/api/products';

  async getAll(): Promise<Product[]> {
    const response = await fetch(this.baseUrl);
    const data = await this.handleResponse(response);
    return data.map((p: any) => this.mapToEntity(p));
  }

  async getById(id: string): Promise<Product | null> {
    const response = await fetch(`${this.baseUrl}/${id}`);
    if (response.status === 404) return null;
    const data = await this.handleResponse(response);
    return this.mapToEntity(data);
  }

  async getBySku(sku: string): Promise<Product | null> {
    const products = await this.getAll();
    return products.find(p => p.sku === sku) || null;
  }

  async save(product: Product): Promise<Product> {
    const response = await fetch(this.baseUrl, {
      method: 'POST',
      headers: await this.getHeaders(),
      body: JSON.stringify(product)
    });
    const data = await this.handleResponse(response);
    return this.mapToEntity(data);
  }

  async update(product: Product): Promise<void> {
    const response = await fetch(`${this.baseUrl}/${product.id}`, {
      method: 'PUT',
      headers: await this.getHeaders(),
      body: JSON.stringify(product)
    });
    await this.handleResponse(response);
  }

  async delete(id: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/${id}`, {
      method: 'DELETE',
      headers: await this.getHeaders()
    });
    await this.handleResponse(response);
  }

  private mapToEntity(data: any): Product {
    return {
      ...data,
      batches: (data.batches || []).map((b: any) => ({
        ...b,
        supplierName: b.supplierName || b.supplier?.name,
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

export class ApiInvoiceRepository extends BaseApi implements IInvoiceRepository {
  private readonly baseUrl = '/api/invoices';

  async getAll(): Promise<Invoice[]> {
    const response = await fetch(this.baseUrl, { headers: await this.getHeaders() });
    const data = await this.handleResponse(response);
    return data.map((inv: any) => ({
      ...inv,
      createdAt: new Date(inv.createdAt)
    }));
  }

  async getById(id: string): Promise<Invoice | null> {
    const response = await fetch(`${this.baseUrl}/${id}`, { headers: await this.getHeaders() });
    if (response.status === 404) return null;
    const data = await this.handleResponse(response);
    return { ...data, createdAt: new Date(data.createdAt) };
  }

  async save(invoice: Invoice): Promise<void> {
    const response = await fetch(this.baseUrl, {
      method: 'POST',
      headers: await this.getHeaders(),
      body: JSON.stringify(invoice)
    });
    await this.handleResponse(response);
  }

  async updateStatus(id: string, status: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/${id}/status`, {
      method: 'PATCH',
      headers: await this.getHeaders(),
      body: JSON.stringify({ status })
    });
    await this.handleResponse(response);
  }
}

export class ApiSupplierRepository extends BaseApi implements ISupplierRepository {
  private readonly baseUrl = '/api/suppliers';

  async getAll(): Promise<Supplier[]> {
    const response = await fetch(this.baseUrl, { headers: await this.getHeaders() });
    return this.handleResponse(response);
  }

  async save(supplier: Supplier): Promise<void> {
    const response = await fetch(this.baseUrl, {
      method: 'POST',
      headers: await this.getHeaders(),
      body: JSON.stringify(supplier)
    });
    await this.handleResponse(response);
  }
}
