/**
 * Domain Entities - The heart of the business logic.
 * These are framework-independent.
 */

export type BatchStatus = 'CRITICAL' | 'STABLE' | 'NEAR_EXPIRY' | 'EXPIRED';
export type MovementType = 'RESTOCK' | 'DISPATCH' | 'ADJUSTMENT' | 'RETURN' | 'WRITE_OFF';
export type UserRole = 'ADMIN' | 'CASHIER' | 'WAREHOUSE' | 'OWNER';

export interface BatchMovement {
  id: string;
  type: MovementType;
  quantity: number;
  date: Date;
  description: string;
  userId?: string;
}

export interface Batch {
  id: string;
  batchNumber: string;
  quantity: number;
  unit: string;
  costBasis: number;
  retailPrice?: number | null;
  supplierId?: string;
  supplierName?: string;
  manufacturedDate: Date;
  expiryDate: Date;
  receivedAt: Date;
  status: BatchStatus;
  movements: BatchMovement[];
}

export interface Product {
  id: string;
  name: string;
  sku: string;
  barcode?: string;
  category: string;
  manufacturer: string;
  countryOfOrigin?: string;
  totalStock: number;
  minStock: number;
  costPrice: number;
  sellingPrice: number;
  status: 'ACTIVE' | 'LOW_STOCK' | 'OUT_OF_STOCK';
  image: string;
  prescription: boolean;
  markingRequired: boolean;
  analogs?: string[]; // IDs of analog products
  batches: Batch[];
}

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
}

export interface Supplier {
  id: string;
  name: string;
  contact?: string;
  email?: string;
  address?: string;
}


export interface InvoiceItem {
  id: string;
  productId: string;
  batchId: string;
  productName: string;
  batchNo: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
}

export interface Invoice {
  id: string;
  invoiceNo: string;
  totalAmount: number;
  taxAmount: number;
  discount: number;
  paymentType: 'CASH' | 'CARD';
  status: 'PAID' | 'PENDING' | 'CANCELLED' | 'RETURNED' | 'PARTIALLY_RETURNED';
  paymentStatus?: 'PAID' | 'PARTIALLY_PAID' | 'UNPAID' | 'CANCELLED';
  comment?: string;
  userId: string;
  paidAmountTotal?: number;
  items: InvoiceItem[];
  createdAt: Date;
}

export interface PaginationParams {
  page?: number;
  limit?: number;
  search?: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export interface IProductRepository {
  getAll(params?: PaginationParams): Promise<Product[] | PaginatedResponse<Product>>;
  getById(id: string): Promise<Product | null>;
  getBySku(sku: string): Promise<Product | null>;
  save(product: Product): Promise<Product>;
  update(product: Product): Promise<void>;
  delete(id: string): Promise<void>;
}

export interface IInvoiceRepository {
  getAll(params?: PaginationParams): Promise<Invoice[] | PaginatedResponse<Invoice>>;
  getById(id: string): Promise<Invoice | null>;
  save(invoice: Invoice): Promise<void>;
  update(id: string, payload: Partial<Invoice>): Promise<Invoice>;
  updateStatus(id: string, status: string): Promise<void>;
  addPayment(id: string, payload: { amount: number; method: string; comment?: string }): Promise<Invoice>;
  processReturn(id: string, items: Array<{ id: string; quantity: number }>): Promise<void>;
  delete(id: string): Promise<void>;
}

export interface ISupplierRepository {
  getAll(): Promise<Supplier[]>;
  save(supplier: Supplier): Promise<void>;
}

export interface ILogger {
  info(message: string, data?: any): void;
  error(message: string, error?: any): void;
  warn(message: string, data?: any): void;
}
