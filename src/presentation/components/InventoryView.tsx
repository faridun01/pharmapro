import React, { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usePharmacy } from '../context';
import { useDebounce } from '../../lib/useDebounce';
import { Search, Plus, Package, X, AlertTriangle } from 'lucide-react';
import { Product } from '../../core/domain';
import { buildApiHeaders } from '../../infrastructure/api';
import { lazyNamedImport } from '../../lib/lazyLoadComponents';
import { useCurrencyCode } from '../../lib/useCurrencyCode';

// Decomposed components
import { ProductTableRow } from './inventory/ProductTableRow';
import { ProductAddModal } from './inventory/ProductAddModal';
import { ProductPriceModal } from './inventory/ProductPriceModal';
import { ProductBarcodeModal } from './inventory/ProductBarcodeModal';
import { ProductDeleteModal } from './inventory/ProductDeleteModal';
import { ProductBatchHistoryModal } from './inventory/ProductBatchHistoryModal';
import { ProductRestockModal } from './inventory/ProductRestockModal';
import { 
  NewProductForm, 
  PriceEditModalState, 
  BarcodeEditModalState, 
  RestockModalState 
} from './inventory/types';

const ImportInvoiceModal = lazyNamedImport(() => import('./ImportInvoiceModal'), 'ImportInvoiceModal');

export const InventoryView: React.FC<{ initialSection?: 'catalog' | 'batches' }> = ({ initialSection = 'catalog' }) => {
  const { t } = useTranslation();
  const currencyCode = useCurrencyCode();
  const { 
    products, 
    isLoading, 
    createProduct, 
    updateProduct, 
    deleteProduct, 
    refreshProducts, 
    restockInventory 
  } = usePharmacy();

  const [searchTerm, setSearchTerm] = useState('');
  const [filter, setFilter] = useState<'all' | 'low' | 'prescription'>('all');
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [priceEditModal, setPriceEditModal] = useState<PriceEditModalState | null>(null);
  const [barcodeEditModal, setBarcodeEditModal] = useState<BarcodeEditModalState | null>(null);
  const [batchHistoryProduct, setBatchHistoryProduct] = useState<Product | null>(null);
  
  const [restockModal, setRestockModal] = useState<RestockModalState>({
    open: false,
    productId: '',
    batchNumber: '',
    quantity: '1',
    unit: 'шт.',
    costBasis: '0',
    expiryDate: '',
    error: null,
  });

  const [catalogPage, setCatalogPage] = useState(1);
  const catalogPageSize = 10;
  const debouncedSearchTerm = useDebounce(searchTerm, 300);

  useEffect(() => {
    if (products.length === 0) {
      void refreshProducts();
    }
  }, [products.length, refreshProducts]);

  const filteredProducts = useMemo(() => products.filter((p) => {
    const searchValue = debouncedSearchTerm.toLowerCase();
    const matchesSearch = p.name.toLowerCase().includes(searchValue)
      || p.sku.toLowerCase().includes(searchValue)
      || String(p.manufacturer || '').toLowerCase().includes(searchValue)
      || String(p.countryOfOrigin || '').toLowerCase().includes(searchValue);
    const matchesFilter =
      filter === 'all' ||
      (filter === 'low' && p.totalStock < (p.minStock || 10)) ||
      (filter === 'prescription' && p.prescription);
    return matchesSearch && matchesFilter;
  }), [products, debouncedSearchTerm, filter]);

  const totalCatalogPages = Math.max(1, Math.ceil(filteredProducts.length / catalogPageSize));
  const safeCatalogPage = Math.min(catalogPage, totalCatalogPages);
  const paginatedProducts = useMemo(() => {
    const startIndex = (safeCatalogPage - 1) * catalogPageSize;
    return filteredProducts.slice(startIndex, startIndex + catalogPageSize);
  }, [filteredProducts, safeCatalogPage]);

  const saveProduct = async (form: NewProductForm) => {
    setSubmitting(true);
    try {
      await createProduct({
        name: form.name,
        sku: form.sku,
        barcode: form.barcode,
        category: form.category,
        manufacturer: form.manufacturer,
        countryOfOrigin: form.countryOfOrigin,
        minStock: Number(form.minStock),
        costPrice: Number(form.costPrice),
        sellingPrice: Number(form.sellingPrice),
        prescription: form.prescription,
        markingRequired: form.markingRequired,
        batchData: {
          batchNumber: form.batchNumber,
          expiryDate: form.expiryDate,
          initialQuantity: Number(form.initialUnits),
        }
      } as any);
      setIsAddOpen(false);
      await refreshProducts();
    } catch (err: any) {
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  };

  const savePrices = async (productId: string, costPrice: number, sellingPrice: number) => {
    setSubmitting(true);
    try {
      await updateProduct({ id: productId, costPrice, sellingPrice } as any);
      setPriceEditModal(null);
      await refreshProducts();
    } catch (err) {
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  };

  const saveBarcode = async (productId: string, barcode: string) => {
    setSubmitting(true);
    try {
      await updateProduct({ id: productId, barcode } as any);
      setBarcodeEditModal(null);
      await refreshProducts();
    } catch (err) {
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  };

  const removeProduct = async () => {
    if (!deleteTarget) return;
    setSubmitting(true);
    try {
      await deleteProduct(deleteTarget.id);
      setDeleteTarget(null);
      await refreshProducts();
    } catch (err) {
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  };

  const submitRestock = async (state: RestockModalState) => {
    setSubmitting(true);
    try {
      await restockInventory({
        productId: state.productId,
        batchNumber: state.batchNumber,
        quantity: Number(state.quantity),
        unit: state.unit,
        costBasis: Number(state.costBasis),
        expiryDate: new Date(state.expiryDate),
        manufacturedDate: new Date(),
      });
      setRestockModal((prev) => ({ ...prev, open: false, error: null }));
      await refreshProducts();
    } catch (err: any) {
      setRestockModal(prev => ({ ...prev, error: err.message }));
    } finally {
      setSubmitting(false);
    }
  };

  const openRestockModal = (product: Product) => {
    setRestockModal({
      open: true,
      productId: product.id,
      batchNumber: `#RESTOCK-${new Date().toISOString().slice(0, 10)}`,
      quantity: '1',
      unit: 'шт.',
      costBasis: String(product.costPrice || 0),
      expiryDate: '',
      error: null,
    });
  };

  return (
    <div className="flex-1 space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-[#5A5A40]">Складской учёт</h2>
          <p className="text-sm text-[#5A5A40]/60 mt-1">Управление каталогом лекарств, остатками и партиями</p>
        </div>
        <div className="flex gap-3">
          <button onClick={() => setIsImportOpen(true)} className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-white px-5 py-2 text-sm font-bold text-[#5A5A40] shadow-sm border border-[#5A5A40]/10 hover:bg-[#f5f5f0] transition-all">
            Импорт накладной
          </button>
          <button onClick={() => setIsAddOpen(true)} className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-[#5A5A40] px-5 py-2 text-sm font-bold text-white shadow-lg shadow-[#5A5A40]/20 hover:bg-[#4A4A30] transition-all">
            <Plus size={18} /> {t('Add Product')}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[
          { id: 'all', label: t('All products'), count: products.length, color: 'bg-[#5A5A40]' },
          { id: 'low', label: t('Low stock'), count: products.filter(p => p.totalStock < (p.minStock || 10)).length, color: 'bg-amber-600' },
          { id: 'prescription', label: t('Require Prescription'), count: products.filter(p => p.prescription).length, color: 'bg-rose-600' }
        ].map((stat) => (
          <button
            key={stat.id}
            onClick={() => setFilter(stat.id as any)}
            className={`p-6 rounded-3xl border transition-all text-left ${filter === stat.id ? 'bg-white border-[#5A5A40]/20 shadow-md ring-2 ring-[#5A5A40]/5' : 'bg-white/50 border-transparent hover:bg-white'}`}
          >
            <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#5A5A40]/40 mb-2">{stat.label}</p>
            <div className="flex items-end justify-between">
              <p className="text-3xl font-black text-[#5A5A40]">{stat.count}</p>
              <div className={`w-2 h-2 rounded-full ${stat.color}`}></div>
            </div>
          </button>
        ))}
      </div>

      <div className="bg-white/50 backdrop-blur-md rounded-3xl border border-[#5A5A40]/5 shadow-sm overflow-hidden">
        <div className="p-6 border-b border-[#5A5A40]/5 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="relative group w-full md:max-w-xs">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-[#5A5A40]/30 transition-colors group-focus-within:text-[#5A5A40]" size={18} />
            <input
              type="text" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Поиск по названию, SKU или штрихкоду..."
              className="w-full pl-12 pr-4 py-3 bg-white border border-[#5A5A40]/10 rounded-2xl text-sm outline-none focus:ring-2 focus:ring-[#5A5A40]/10 transition-all font-medium"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-[#f5f5f0]/95 text-[9px] uppercase tracking-[0.2em] text-[#5A5A40]/45 font-bold">
                <th className="px-4 py-3.5">№</th>
                <th className="px-6 py-3.5">{t('Product')}</th>
                <th className="px-6 py-3.5">{t('Stock status')}</th>
                <th className="px-6 py-3.5">{t('Price')}</th>
                <th className="px-6 py-3.5">{t('Category')}</th>
                <th className="px-6 py-3.5 text-right">Действия</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#5A5A40]/5">
              {paginatedProducts.map((p, idx) => (
                <ProductTableRow
                  key={p.id}
                  index={(safeCatalogPage - 1) * catalogPageSize + idx + 1}
                  product={p}
                  stockLabel={`${p.totalStock} шт.`}
                  submitting={submitting}
                  onOpenBatchHistory={setBatchHistoryProduct}
                  onEditPrices={(prod) => setPriceEditModal({ product: prod, costPrice: String(prod.costPrice), sellingPrice: String(prod.sellingPrice) })}
                  onAddBarcode={(prod) => setBarcodeEditModal({ product: prod, barcode: '' })}
                  onDelete={(id, name) => setDeleteTarget({ id, name })}
                />
              ))}
              {filteredProducts.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-8 py-16 text-center text-[#5A5A40]/40">
                    <Package size={48} className="mx-auto mb-4 opacity-20" />
                    <p className="font-medium">{isLoading ? t('Loading...') : t('No products yet')}</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {totalCatalogPages > 1 && (
          <div className="p-4 border-t border-[#5A5A40]/5 flex items-center justify-between bg-[#fcfbf7]/50">
            <span className="text-xs text-[#5A5A40]/50 font-medium">Показано {paginatedProducts.length} из {filteredProducts.length}</span>
            <div className="flex gap-2">
              <button disabled={safeCatalogPage === 1} onClick={() => setCatalogPage(p => p - 1)} className="px-4 py-2 rounded-xl border border-[#5A5A40]/10 bg-white text-sm font-bold text-[#5A5A40] shadow-sm hover:bg-[#f5f5f0] disabled:opacity-40 transition-all">Назад</button>
              <button disabled={safeCatalogPage === totalCatalogPages} onClick={() => setCatalogPage(p => p + 1)} className="px-4 py-2 rounded-xl border border-[#5A5A40]/10 bg-white text-sm font-bold text-[#5A5A40] shadow-sm hover:bg-[#f5f5f0] disabled:opacity-40 transition-all">Вперед</button>
            </div>
          </div>
        )}
      </div>

      <ProductAddModal isOpen={isAddOpen} onClose={() => setIsAddOpen(false)} onSubmit={saveProduct} submitting={submitting} />
      <ProductPriceModal state={priceEditModal} onClose={() => setPriceEditModal(null)} onSubmit={savePrices} submitting={submitting} currencyCode={currencyCode} />
      <ProductBarcodeModal state={barcodeEditModal} onClose={() => setBarcodeEditModal(null)} onSubmit={saveBarcode} submitting={submitting} />
      <ProductDeleteModal isOpen={!!deleteTarget} onClose={() => setDeleteTarget(null)} onSubmit={removeProduct} productName={deleteTarget?.name || ''} submitting={submitting} />
      <ProductBatchHistoryModal product={batchHistoryProduct} onClose={() => setBatchHistoryProduct(null)} onRestock={openRestockModal} currencyCode={currencyCode} />
      <ProductRestockModal state={restockModal} onClose={() => setRestockModal(p => ({ ...p, open: false }))} onSubmit={submitRestock} products={products} submitting={submitting} currencyCode={currencyCode} />

      <Suspense fallback={null}>
        <ImportInvoiceModal isOpen={isImportOpen} onClose={() => setIsImportOpen(false)} />
      </Suspense>
    </div>
  );
};
