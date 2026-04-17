import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { Product, User, Invoice, Supplier } from '../core/domain';
import { TransactionDTO } from '../application/services';
import { ApiProductRepository, ApiInvoiceRepository, ApiSupplierRepository, buildApiHeaders } from '../infrastructure/api';
import { ConsoleLogger } from '../infrastructure/persistence';
import { runRefreshTasks } from '../lib/utils';

/**
 * Cache strategy for reference data (rarely changed)
 */
interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

/**
 * Dependency Injection Container / Context
 * Strategy: Separate operational data (products) from slower-changing reference data (suppliers)
 * - products: fully cached, auto-refresh on user action
 * - invoices: lazy-loaded on demand (not cached in context)
 * - suppliers: cached with 30min TTL
 */
interface PharmacyContextType {
  products: Product[];
  invoices: Invoice[]; // Only recent invoices; use API pagination for historical
  suppliers: Supplier[];
  user: User | null;
  isLoading: boolean;
  error: string | null;
  login: (login: string, password: string) => Promise<void>;
  logout: () => void;
  refreshProducts: () => Promise<void>;
  refreshInvoices: () => Promise<void>;
  refreshSuppliers: (force?: boolean) => Promise<void>;
  processTransaction: (transaction: TransactionDTO) => Promise<Invoice>;
  restockInventory: (payload: {
    productId: string;
    batchNumber: string;
    quantity: number;
    unit: string;
    costBasis: number;
    supplierId?: string;
    manufacturedDate: Date;
    expiryDate: Date;
  }) => Promise<void>;
  importPurchaseInvoice: (payload: {
    supplierId: string;
    invoiceNumber: string;
    invoiceDate: string;
    discountAmount?: number;
    status?: 'DRAFT' | 'POSTED';
    items: Array<{
      productId: string;
      batchNumber: string;
      quantity: number;
      unit: string;
      costBasis: number;
      manufacturedDate: Date;
      expiryDate: Date;
    }>;
  }) => Promise<void>;
  createProduct: (payload: Omit<Product, 'batches' | 'totalStock' | 'status'> & { minStock?: number }) => Promise<Product>;
  updateProduct: (payload: Product) => Promise<Product>;
  deleteProduct: (productId: string) => Promise<void>;
}

const PharmacyContext = createContext<PharmacyContextType | undefined>(undefined);

const bootstrapLoads = new Map<string, Promise<void>>();

const getBootstrapLoadKey = (user: User | null) => {
  const token = window.sessionStorage.getItem('pharmapro_token') || localStorage.getItem('pharmapro_token') || 'guest';
  return user ? `auth:${user.id}:${token}` : `guest:${token}`;
};

export const PharmacyProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [products, setProducts] = useState<Product[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]); // Only recent, not all-time
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [user, setUser] = useState<User | null>(() => {
    const saved = window.sessionStorage.getItem('pharmapro_user');
    if (!saved) return null;
    try {
      return JSON.parse(saved);
    } catch {
      return null;
    }
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Cache for reference data (suppliers)
  // TTL: 30 minutes for suppliers
  const cacheRef = React.useRef<{
    suppliers: CacheEntry<Supplier[]> | null;
  }>({
    suppliers: null,
  });

  const CACHE_TTL = 30 * 60 * 1000; // 30 minutes in milliseconds

  // Initialize Infrastructure (Singletons)
  const productRepository = new ApiProductRepository();
  const invoiceRepository = new ApiInvoiceRepository();
  const supplierRepository = new ApiSupplierRepository();
  const logger = new ConsoleLogger();

  const login = async (login: string, password: string) => {
    setError(null);
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login, password })
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error || (response.status === 401 ? 'Invalid credentials' : 'Login failed'));
      }
      const data = payload;
      window.sessionStorage.setItem('pharmapro_token', data.token);
      window.sessionStorage.setItem('pharmapro_user', JSON.stringify(data.user));
      localStorage.setItem('pharmapro_token', data.token);
      setUser(data.user);
    } catch (err: any) {
      setError(err.message);
      throw err;
    }
  };

  const logout = () => {
    window.sessionStorage.removeItem('pharmapro_token');
    window.sessionStorage.removeItem('pharmapro_user');
    localStorage.removeItem('pharmapro_token');
    setUser(null);
  };

  const refreshProducts = async () => {
    try {
      const result = await productRepository.getAll();
      const data = Array.isArray(result) ? result : (result?.items || []);
      setProducts(data);
    } catch (err: any) {
      logger.error('Failed to fetch products', err);
    }
  };

  const refreshInvoices = async () => {
    try {
      const result = await invoiceRepository.getAll();
      const data = Array.isArray(result) ? result : (result?.items || []);
      setInvoices(data);
    } catch (err: any) {
      logger.error('Failed to fetch invoices', err);
    }
  };

  const refreshSuppliers = async (force: boolean = false) => {
    try {
      const now = Date.now();
      const cached = cacheRef.current.suppliers;

      // Return cached data if valid and not forced
      if (!force && cached && (now - cached.timestamp) < CACHE_TTL) {
        setSuppliers(cached.data);
        return;
      }

      // Fetch fresh data
      const data = await supplierRepository.getAll();
      const safeData = Array.isArray(data) ? data : ((data as any)?.items || []);
      cacheRef.current.suppliers = { data: safeData, timestamp: now };
      setSuppliers(safeData);
    } catch (err: any) {
      logger.error('Failed to fetch suppliers', err);
    }
  };

  const processTransaction = async (transaction: TransactionDTO) => {
    try {
      const response = await fetch('/api/sales/complete', {
        method: 'POST',
        headers: await buildApiHeaders(),
        body: JSON.stringify(transaction),
      });

      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body.error || 'Transaction failed');
      }

      const invoice: Invoice = {
        ...body,
        createdAt: new Date(body.createdAt),
      };

      await runRefreshTasks(refreshProducts, refreshInvoices);
      return invoice;
    } catch (error) {
      logger.error('Transaction failed', error);
      throw error;
    }
  };

  const restockInventory = async (payload: {
    productId: string;
    batchNumber: string;
    quantity: number;
    unit: string;
    costBasis: number;
    supplierId?: string;
    manufacturedDate: Date;
    expiryDate: Date;
  }) => {
    const response = await fetch('/api/inventory/restock', {
      method: 'POST',
      headers: await buildApiHeaders(),
      body: JSON.stringify(payload),
    });

    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(body.error || 'Failed to restock inventory');
    }
  };

  const importPurchaseInvoice = async (payload: {
    supplierId: string;
    invoiceNumber: string;
    invoiceDate: string;
    discountAmount?: number;
    status?: 'DRAFT' | 'POSTED';
    items: Array<{
      productId: string;
      batchNumber: string;
      quantity: number;
      unit: string;
      costBasis: number;
      manufacturedDate: Date;
      expiryDate: Date;
    }>;
  }) => {
    const response = await fetch('/api/inventory/purchase-invoices', {
      method: 'POST',
      headers: await buildApiHeaders(),
      body: JSON.stringify(payload),
    });

    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(body.error || 'Failed to import purchase invoice');
    }
  };

  const createProduct = async (payload: Omit<Product, 'batches' | 'totalStock' | 'status'> & { minStock?: number; batchData?: any }) => {
    const batchData = (payload as any).batchData;
    
    const productToCreate: any = {
      name: payload.name,
      sku: payload.sku,
      barcode: payload.barcode || undefined,
      category: payload.category || 'Uncategorized',
      manufacturer: payload.manufacturer || 'Unknown',
      countryOfOrigin: payload.countryOfOrigin || undefined,
      minStock: payload.minStock ?? 10,
      costPrice: payload.costPrice,
      sellingPrice: payload.sellingPrice,
      status: 'ACTIVE',
      image: payload.image || '',
      prescription: payload.prescription,
      markingRequired: payload.markingRequired,
      analogs: payload.analogs,
    };

    // If batch data provided, create with initial batch
    if (batchData && batchData.expiryDate) {
      productToCreate.batches = [
        {
          batchNumber: batchData.batchNumber || `#B-${Date.now()}`,
          quantity: batchData.initialQuantity || 0,
          initialQty: batchData.initialQuantity || 0,
          currentQty: batchData.initialQuantity || 0,
          availableQty: batchData.initialQuantity || 0,
          reservedQty: 0,
          unit: 'шт.',
          costBasis: payload.costPrice,
          manufacturedDate: new Date().toISOString(),
          expiryDate: batchData.expiryDate,
          status: 'STABLE',
          movements: [],
        }
      ];
    }

    const created = await productRepository.save(productToCreate);
    await refreshProducts();
    return created;
  };

  const updateProduct = async (payload: Product) => {
    await productRepository.update(payload);
    await refreshProducts();
    const updated = await productRepository.getById(payload.id);
    if (!updated) {
      throw new Error('Updated product could not be reloaded');
    }
    return updated;
  };

  const deleteProduct = async (productId: string) => {
    await productRepository.delete(productId);
    await refreshProducts();
  };

  useEffect(() => {
    const loadKey = getBootstrapLoadKey(user);
    let isActive = true;

    const init = async () => {
      if (!user) {
        setIsLoading(false);
        return;
      }

      // Proactive Theme Loading for Premium Feel
      const applyTheme = (theme: string) => {
        document.documentElement.dataset.theme = theme;
        if (theme === 'dark') {
          document.documentElement.classList.add('dark');
        } else {
          document.documentElement.classList.remove('dark');
        }
      };

      // Load initial theme from server-side preferences
      void fetch('/api/system/me/preferences', { headers: await buildApiHeaders(false) })
        .then(res => res.json())
        .then(prefs => {
           if (prefs?.appearance?.theme) {
             applyTheme(prefs.appearance.theme);
           }
        })
        .catch(() => { /* use default if failed */ });

      setIsLoading(false);

      let bootstrapPromise = bootstrapLoads.get(loadKey);
      if (!bootstrapPromise) {
        bootstrapPromise = runRefreshTasks(
          refreshProducts,
          refreshInvoices,
          refreshSuppliers,
        ).catch((error) => {
          bootstrapLoads.delete(loadKey);
          throw error;
        });
        bootstrapLoads.set(loadKey, bootstrapPromise);
      }

      void bootstrapPromise.finally(() => {
        if (isActive) {
          setIsLoading(false);
        }
      });
    };

    void init();

    return () => {
      isActive = false;
    };
  }, [user]);

  return (
    <PharmacyContext.Provider value={{ 
      products, 
      invoices,
      suppliers,
      user,
      isLoading, 
      error,
      login,
      logout,
      refreshProducts,
      refreshInvoices,
      refreshSuppliers,
      processTransaction,
      restockInventory,
      importPurchaseInvoice,
      createProduct,
      updateProduct,
      deleteProduct
    }}>
      {children}
    </PharmacyContext.Provider>
  );
};

export const usePharmacy = () => {
  const context = useContext(PharmacyContext);
  if (!context) {
    throw new Error('usePharmacy must be used within a PharmacyProvider');
  }
  return context;
};
