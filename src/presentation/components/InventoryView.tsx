import React, { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usePharmacy } from '../context';
import { useDebounce } from '../../lib/useDebounce';
import { Search, Plus, Package, AlertTriangle, ArrowUpDown, ArrowUp, ArrowDown, Filter, LayoutGrid } from 'lucide-react';
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
import { ProductEditModal } from './inventory/ProductEditModal';
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
  const [productEditTarget, setProductEditTarget] = useState<Product | null>(null);

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
  const catalogPageSize = 15;
  const debouncedSearchTerm = useDebounce(searchTerm, 250);

  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' }>({
    key: 'name',
    direction: 'asc'
  });

  const toggleSort = (key: string) => {
    setSortConfig(current => ({
      key,
      direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc'
    }));
  };

  const filteredProducts = useMemo(() => {
    let result = products.filter((p) => {
      const searchValue = debouncedSearchTerm.toLowerCase();
      const matchesSearch = p.name.toLowerCase().includes(searchValue)
        || p.sku.toLowerCase().includes(searchValue)
        || String(p.barcode || '').toLowerCase().includes(searchValue);
      const matchesFilter =
        filter === 'all' ||
        (filter === 'low' && p.totalStock < (p.minStock || 10)) ||
        (filter === 'prescription' && p.prescription);
      return matchesSearch && matchesFilter;
    });

    result.sort((a, b) => {
      let valA: any = a[sortConfig.key as keyof Product];
      let valB: any = b[sortConfig.key as keyof Product];
      if (valA === undefined || valA === null) valA = '';
      if (valB === undefined || valB === null) valB = '';

      if (typeof valA === 'string') {
        const cmp = valA.localeCompare(valB as string);
        return sortConfig.direction === 'asc' ? cmp : -cmp;
      }
      const cmp = (valA as number) - (valB as number);
      return sortConfig.direction === 'asc' ? cmp : -cmp;
    });

    return result;
  }, [products, debouncedSearchTerm, filter, sortConfig]);

  const totalCatalogPages = Math.max(1, Math.ceil(filteredProducts.length / catalogPageSize));
  const safeCatalogPage = Math.min(catalogPage, totalCatalogPages);
  const paginatedProducts = useMemo(() => {
    const startIndex = (safeCatalogPage - 1) * catalogPageSize;
    return filteredProducts.slice(startIndex, startIndex + catalogPageSize);
  }, [filteredProducts, safeCatalogPage]);

  useEffect(() => {
    if (products.length === 0) void refreshProducts();
  }, [products.length, refreshProducts]);

  const SortIcon = ({ column }: { column: string }) => {
    if (sortConfig.key !== column) return <ArrowUpDown size={12} className="opacity-20" />;
    return sortConfig.direction === 'asc' ? <ArrowUp size={12} className="text-[#5A5A40]" /> : <ArrowDown size={12} className="text-[#5A5A40]" />;
  };

  const saveProduct = async (form: NewProductForm) => {
    setSubmitting(true);
    try {
      await createProduct(form as any);
      setIsAddOpen(false);
      await refreshProducts();
    } catch { /* err handled by context */ } finally { setSubmitting(false); }
  };

  const openRestockModal = (product: Product) => {
    setRestockModal({
      open: true,
      productId: product.id,
      batchNumber: `#R-${new Date().getTime().toString().slice(-6)}`,
      quantity: '1',
      unit: 'шт.',
      costBasis: String(product.costPrice || 0),
      expiryDate: '',
      supplierId: '',
      error: null,
    });
  };

  return (
    <div className="max-w-[1600px] mx-auto space-y-8 pb-12 animate-in fade-in duration-700 font-normal">

      {/* Header section */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 px-1">
        <div>
          <h2 className="text-3xl font-normal text-[#151619] tracking-tight">Инвентаризация</h2>
          <p className="text-[#5A5A40]/50 mt-1 text-sm uppercase tracking-widest italic">{t('Детальный аудит запасов и контроль каталога')}</p>
        </div>
        <div className="flex gap-3">
          <button onClick={() => setIsImportOpen(true)} className="px-5 py-3 rounded-2xl bg-white border border-[#5A5A40]/10 text-[10px] uppercase tracking-widest text-[#5A5A40]/60 hover:bg-[#f5f5f0] transition-all">
            Импорт накладной
          </button>
          <button onClick={() => setIsAddOpen(true)} className="px-6 py-3 rounded-2xl bg-[#5A5A40] text-white text-[10px] uppercase tracking-widest shadow-xl shadow-[#5A5A40]/10 hover:bg-[#4A4A30] transition-all flex items-center gap-2">
            <Plus size={16} /> Добавить товар
          </button>
        </div>
      </div>

      {/* Modern Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {[
          { id: 'all', label: 'Все позиции', count: products.length, icon: Package, color: 'text-indigo-500', bg: 'bg-indigo-50' },
          { id: 'low', label: 'Критический остаток', count: products.filter(p => p.totalStock < (p.minStock || 10)).length, icon: AlertTriangle, color: 'text-amber-500', bg: 'bg-amber-50' },
          { id: 'prescription', label: 'Рецептурные', count: products.filter(p => p.prescription).length, icon: Filter, color: 'text-rose-500', bg: 'bg-rose-50' }
        ].map((stat) => (
          <button
            key={stat.id}
            onClick={() => setFilter(stat.id as any)}
            className={`group p-8 rounded-[2.5rem] border transition-all text-left relative overflow-hidden ${filter === stat.id ? 'bg-white border-white shadow-2xl shadow-[#5A5A40]/10' : 'bg-white/40 border-transparent hover:bg-white/60 shadow-sm'}`}
          >
            <div className={`absolute top-0 right-0 w-24 h-24 ${stat.bg} rounded-full -mr-12 -mt-12 opacity-40 group-hover:scale-110 transition-transform`} />
            <div className="relative z-10 flex items-center gap-6">
              <div className={`w-14 h-14 rounded-2xl ${stat.bg} flex items-center justify-center ${stat.color} shadow-inner`}>
                <stat.icon size={24} />
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-widest text-[#5A5A40]/40 mb-1">{stat.label}</p>
                <p className="text-2xl font-normal text-[#151619] tracking-tight">{stat.count}</p>
              </div>
            </div>
          </button>
        ))}
      </div>

      {/* Main Table Container */}
      <div className="bg-white rounded-[3rem] shadow-sm border border-white overflow-hidden relative">
        <div className="p-8 border-b border-[#5A5A40]/5 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="relative group w-full md:max-w-md">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-[#5A5A40]/20 group-focus-within:text-[#5A5A40]/60 transition-colors" size={18} />
            <input
              type="text" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Поиск в каталоге..."
              className="w-full pl-12 pr-4 py-3.5 bg-[#f8f7f2] border-none rounded-2xl text-sm outline-none focus:bg-white focus:ring-4 focus:ring-[#5A5A40]/5 transition-all font-normal placeholder:text-[#5A5A40]/30"
            />
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[10px] uppercase tracking-widest text-[#5A5A40]/30 px-2">Вид:</span>
            <button className="p-2.5 rounded-xl bg-[#5A5A40]/5 text-[#5A5A40]"><LayoutGrid size={16} /></button>
          </div>
        </div>

        <div className="overflow-x-auto custom-scrollbar">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-[#fcfbf7]/80 text-[10px] uppercase tracking-widest text-[#5A5A40]/40 border-b border-[#5A5A40]/5">
                <th className="px-8 py-5 font-normal">№</th>
                <th className="px-6 py-5 cursor-pointer hover:bg-[#5A5A40]/5 transition-colors font-normal" onClick={() => toggleSort('name')}>
                  <div className="flex items-center gap-2"> {t('Product')} <SortIcon column="name" /> </div>
                </th>
                <th className="px-6 py-5 cursor-pointer hover:bg-[#5A5A40]/5 transition-colors font-normal" onClick={() => toggleSort('totalStock')}>
                  <div className="flex items-center gap-2"> Статус <SortIcon column="totalStock" /> </div>
                </th>
                <th className="px-6 py-5 cursor-pointer hover:bg-[#5A5A40]/5 transition-colors font-normal" onClick={() => toggleSort('sellingPrice')}>
                  <div className="flex items-center gap-2"> Цена <SortIcon column="sellingPrice" /> </div>
                </th>
                <th className="px-6 py-5 cursor-pointer hover:bg-[#5A5A40]/5 transition-colors font-normal" onClick={() => toggleSort('category')}>
                  <div className="flex items-center gap-2"> Категория <SortIcon column="category" /> </div>
                </th>
                <th className="px-8 py-5 text-right font-normal">Меню</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#5A5A40]/5">
              {paginatedProducts.map((p, idx) => (
                <ProductTableRow
                  key={p.id}
                  index={(safeCatalogPage - 1) * catalogPageSize + idx + 1}
                  product={p}
                  stockLabel={`${p.totalStock}`}
                  submitting={submitting}
                  onOpenBatchHistory={setBatchHistoryProduct}
                  onEdit={setProductEditTarget}
                  onEditPrices={(prod) => setPriceEditModal({ product: prod, costPrice: String(prod.costPrice), sellingPrice: String(prod.sellingPrice) })}
                  onRestock={openRestockModal}
                  onAddBarcode={(prod) => setBarcodeEditModal({ product: prod, barcode: '' })}
                  onDelete={(id, name) => setDeleteTarget({ id, name })}
                />
              ))}
              {filteredProducts.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-8 py-24 text-center">
                    <div className="w-20 h-20 bg-[#5A5A40]/5 rounded-[2rem] mx-auto flex items-center justify-center text-[#5A5A40]/20 mb-4 animate-pulse">
                      <Package size={40} />
                    </div>
                    <p className="text-xs text-[#5A5A40]/40 font-normal uppercase tracking-widest">{isLoading ? 'Синхронизация...' : 'Список пуст'}</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {totalCatalogPages > 1 && (
          <div className="p-8 bg-[#fcfbf7]/40 border-t border-[#5A5A40]/5 flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-widest text-[#5A5A40]/40">Страница {safeCatalogPage} из {totalCatalogPages}</span>
            <div className="flex gap-2">
              <button disabled={safeCatalogPage === 1} onClick={() => setCatalogPage(p => p - 1)} className="px-6 py-3 rounded-2xl border border-[#5A5A40]/5 bg-white text-[10px] uppercase tracking-widest text-[#5A5A40] shadow-sm hover:bg-[#f5f5f0] disabled:opacity-30 transition-all">Назад</button>
              <button disabled={safeCatalogPage === totalCatalogPages} onClick={() => setCatalogPage(p => p + 1)} className="px-6 py-3 rounded-2xl border border-[#5A5A40]/5 bg-white text-[10px] uppercase tracking-widest text-[#5A5A40] shadow-sm hover:bg-[#f5f5f0] disabled:opacity-30 transition-all">Далее</button>
            </div>
          </div>
        )}
      </div>

      {/* Modals are kept the same but will align with their internal Zen styling */}
      <ProductAddModal isOpen={isAddOpen} onClose={() => setIsAddOpen(false)} onSubmit={saveProduct} submitting={submitting} existingProducts={products} />
      <ProductEditModal isOpen={!!productEditTarget} product={productEditTarget} onClose={() => setProductEditTarget(null)} onSubmit={async (id, updates) => { try { await updateProduct({ id, ...updates } as any); setProductEditTarget(null); await refreshProducts(); } catch { } }} submitting={submitting} />
      <ProductPriceModal state={priceEditModal} onClose={() => setPriceEditModal(null)} onSubmit={async (id, cp, sp) => { try { await updateProduct({ id, costPrice: cp, sellingPrice: sp } as any); setPriceEditModal(null); await refreshProducts(); } catch { } }} submitting={submitting} currencyCode={currencyCode} />
      <ProductBarcodeModal state={barcodeEditModal} onClose={() => setBarcodeEditModal(null)} onSubmit={async (id, b) => { try { await updateProduct({ id, barcode: b } as any); setBarcodeEditModal(null); await refreshProducts(); } catch { } }} submitting={submitting} />
      <ProductDeleteModal isOpen={!!deleteTarget} onClose={() => setDeleteTarget(null)} onSubmit={async () => { try { if (deleteTarget) await deleteProduct(deleteTarget.id); setDeleteTarget(null); await refreshProducts(); } catch { } }} productName={deleteTarget?.name || ''} submitting={submitting} />
      <ProductBatchHistoryModal product={batchHistoryProduct} onClose={() => setBatchHistoryProduct(null)} onRestock={openRestockModal} currencyCode={currencyCode} />
      <ProductRestockModal state={restockModal} onClose={() => setRestockModal(p => ({ ...p, open: false }))} onSubmit={async (st) => { try { await restockInventory({ productId: st.productId, batchNumber: st.batchNumber, quantity: Number(st.quantity), unit: st.unit, costBasis: Number(st.costBasis), expiryDate: new Date(st.expiryDate), manufacturedDate: new Date() }); setRestockModal(p => ({ ...p, open: false })); await refreshProducts(); } catch (err: any) { setRestockModal(p => ({ ...p, error: err.message })); } }} products={products} submitting={submitting} currencyCode={currencyCode} />

      <Suspense fallback={null}>
        <ImportInvoiceModal isOpen={isImportOpen} onClose={() => setIsImportOpen(false)} />
      </Suspense>
    </div>
  );
};

export default InventoryView;
