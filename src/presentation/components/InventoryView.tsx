import React, { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usePharmacy } from '../context';
import { useDebounce } from '../../lib/useDebounce';
import { Search, Plus, Trash2, AlertTriangle, Package, X, PencilLine, Layers, Calendar, Barcode, BadgeDollarSign } from 'lucide-react';
import { Product } from '../../core/domain';
import { buildApiHeaders } from '../../infrastructure/api';
import { lazyNamedImport } from '../../lib/lazyLoadComponents';

const ImportInvoiceModal = lazyNamedImport(() => import('./ImportInvoiceModal'), 'ImportInvoiceModal');

type NewProductForm = {
  name: string;
  sku: string;
  barcode: string;
  category: string;
  manufacturer: string;
  countryOfOrigin: string;
  minStock: number;
  costPrice: number;
  sellingPrice: number;
  prescription: boolean;
  markingRequired: boolean;
  batchNumber: string;
  expiryDate: string;
  initialUnits: number;
};

const DEFAULT_FORM: NewProductForm = {
  name: '',
  sku: '',
  barcode: '',
  category: '',
  manufacturer: '',
  countryOfOrigin: '',
  minStock: 10,
  costPrice: 0,
  sellingPrice: 0,
  prescription: false,
  markingRequired: false,
  batchNumber: '',
  expiryDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
  initialUnits: 0,
};

type InventoryRowProps = {
  index: number;
  product: Product;
  stockLabel: string;
  submitting: boolean;
  onOpenBatchHistory: (product: Product) => void;
  onEditPrices: (product: Product) => void;
  onAddBarcode: (product: Product) => void;
  onDelete: (id: string, name: string) => void;
  t: (key: string) => string;
};

const InventoryRow = React.memo(function InventoryRow({ index, product, stockLabel, submitting, onOpenBatchHistory, onEditPrices, onAddBarcode, onDelete, t }: InventoryRowProps) {
  const isLowStock = product.totalStock < (product.minStock || 10);
  const batches = Array.isArray(product.batches) ? product.batches : [];
  const orderedBatches = [...batches].sort((left, right) => new Date(left.expiryDate).getTime() - new Date(right.expiryDate).getTime());
  const primaryBatch = orderedBatches[0];
  const riskyBatchCount = batches.filter((batch) => batch.status !== 'STABLE').length;
  return (
    <tr className="hover:bg-[#f5f5f0]/30 transition-colors group">
      <td className="px-4 py-3.5 text-xs font-bold text-[#5A5A40]/70">{index}</td>
      <td className="px-6 py-3.5">
        <div>
          <p className="text-sm font-bold leading-tight text-[#5A5A40]">{product.name}</p>
          <p className="mt-0.5 text-[10px] text-[#5A5A40]/40 uppercase tracking-widest">{product.sku}</p>
          {(product.manufacturer || product.countryOfOrigin) && (
            <p className="mt-1 text-[10px] text-[#5A5A40]/45">
              {[product.manufacturer, product.countryOfOrigin].filter(Boolean).join(' • ')}
            </p>
          )}
          <p className="mt-1 text-[10px] text-[#5A5A40]/45">
            {batches.length > 0
              ? `Партий: ${batches.length}${primaryBatch ? ` • Ближайший срок: ${new Date(primaryBatch.expiryDate).toLocaleDateString('ru-RU')}` : ''}`
              : 'Партий пока нет'}
          </p>
          {riskyBatchCount > 0 && (
            <span className="inline-flex mt-1.5 items-center rounded-full bg-rose-50 px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-rose-700 border border-rose-100">
              Требует внимания: {riskyBatchCount}
            </span>
          )}
          {!product.barcode && (
            <span className="inline-flex mt-1.5 items-center rounded-full bg-amber-50 px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-amber-700 border border-amber-100">
              Без штрихкода
            </span>
          )}
        </div>
      </td>
      <td className="px-6 py-3.5">
        <div className="flex items-center gap-2.5">
          <div className="flex-1 min-w-25">
            <div className="h-1.5 bg-[#f5f5f0] rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${isLowStock ? 'bg-amber-500' : 'bg-emerald-500'}`}
                style={{ width: `${Math.min(100, (product.totalStock / (product.minStock || 10) * 50))}%` }}
              />
            </div>
            <p className={`text-[9px] font-bold mt-1 uppercase tracking-wider ${isLowStock ? 'text-amber-600' : 'text-emerald-600'}`}>
              {stockLabel}
            </p>
          </div>
          {isLowStock && <AlertTriangle size={14} className="text-amber-500 animate-pulse" />}
        </div>
      </td>
      <td className="px-6 py-3.5">
        <p className="text-sm font-bold text-[#5A5A40]">{product.sellingPrice.toFixed(2)} TJS</p>
        <p className="text-[9px] text-[#5A5A40]/40 mt-0.5">{t('Cost')}: {product.costPrice.toFixed(2)} TJS</p>
      </td>
      <td className="px-6 py-3.5">
        {product.prescription ? (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-50 text-red-600 text-[9px] font-bold uppercase tracking-widest border border-red-100">
            {t('Required')}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-600 text-[9px] font-bold uppercase tracking-widest border border-emerald-100">
            {t('OTC')}
          </span>
        )}
      </td>
      <td className="px-6 py-3.5 text-right">
        <div className="ml-auto grid w-fit grid-cols-2 gap-2">
          <button
            onClick={() => onOpenBatchHistory(product)}
            disabled={submitting}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-[#eef2e6] text-[#5A5A40] transition-all hover:bg-[#e2e8d6] disabled:opacity-50"
            title="История партий"
            aria-label="История партий"
          >
            <Layers size={14} />
          </button>
          {!product.barcode && (
            <button
              onClick={() => onAddBarcode(product)}
              disabled={submitting}
              className="order-4 inline-flex h-9 w-9 items-center justify-center rounded-lg bg-amber-50 text-amber-700 transition-all hover:bg-amber-100 disabled:opacity-50"
              title="Добавить штрихкод"
              aria-label="Добавить штрихкод"
            >
              <Barcode size={14} />
            </button>
          )}
          <button
            onClick={() => onEditPrices(product)}
            disabled={submitting}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-[#f5f5f0] text-[#5A5A40] transition-all hover:bg-[#ebeade] disabled:opacity-50"
            title="Изменить цены"
            aria-label="Изменить цены"
          >
            <BadgeDollarSign size={14} />
          </button>
          <button
            onClick={() => onDelete(product.id, product.name)}
            disabled={submitting}
            className="order-3 inline-flex h-9 w-9 items-center justify-center rounded-lg text-[#5A5A40]/30 transition-all hover:bg-red-50 hover:text-red-500 disabled:opacity-50"
            title={t('Delete Product')}
            aria-label={t('Delete Product')}
          >
            <Trash2 size={16} />
          </button>
        </div>
      </td>
    </tr>
  );
});

type PriceEditModalState = {
  product: Product;
  costPrice: string;
  sellingPrice: string;
};

type PriceHistoryEntry = {
  id: string;
  createdAt: string;
  actorName: string;
  costPrice: { old: number | null; new: number | null };
  sellingPrice: { old: number | null; new: number | null };
};

type BarcodeEditModalState = {
  product: Product;
  barcode: string;
};

type RestockModalState = {
  open: boolean;
  productId: string;
  batchNumber: string;
  quantity: string;
  unit: string;
  costBasis: string;
  expiryDate: string;
  error: string | null;
};

export const InventoryView: React.FC<{ initialSection?: 'catalog' | 'batches' }> = ({ initialSection = 'catalog' }) => {
  const { t } = useTranslation();
  const { products, isLoading, createProduct, updateProduct, deleteProduct, refreshProducts, refreshSuppliers, refreshInvoices, restockInventory } = usePharmacy();
  const [searchTerm, setSearchTerm] = useState('');
  const [filter, setFilter] = useState<'all' | 'low' | 'prescription'>('all');
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [feedbackModal, setFeedbackModal] = useState<{ open: boolean; title: string; message: string; tone: 'success' | 'error' }>({
    open: false,
    title: '',
    message: '',
    tone: 'success',
  });
  const [form, setForm] = useState<NewProductForm>(DEFAULT_FORM);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [priceEditModal, setPriceEditModal] = useState<PriceEditModalState | null>(null);
  const [priceHistory, setPriceHistory] = useState<PriceHistoryEntry[]>([]);
  const [priceHistoryLoading, setPriceHistoryLoading] = useState(false);
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
  const barcodeInputRef = useRef<HTMLInputElement | null>(null);
  const [catalogPage, setCatalogPage] = useState(1);
  const catalogPageSize = 10;

  useEffect(() => {
    if (products.length > 0) {
      return;
    }

    void refreshProducts();
  }, [products.length, refreshProducts]);

  const debouncedSearchTerm = useDebounce(searchTerm, 300);

  const generateBatchNumber = (sku: string): string => {
    if (!sku.trim()) return '';
    const date = new Date();
    const dateStr = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
    const skuPrefix = sku.split('-')[0]?.substring(0, 3)?.toUpperCase() || 'BAT';
    const randomId = Math.random().toString(36).substring(2, 5).toUpperCase();
    return `#${skuPrefix}-${dateStr}-${randomId}`;
  };

  const generateSku = (name: string): string => {
    const base = name
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 16);
    const timePart = Date.now().toString().slice(-6);
    const randomPart = Math.random().toString(36).slice(2, 5).toUpperCase();
    return `${base || 'ITEM'}-${timePart}-${randomPart}`;
  };

  const handleSkuChange = (newSku: string) => {
    const newForm = { ...form, sku: newSku };
    if (!form.batchNumber || form.batchNumber.startsWith('#')) {
      newForm.batchNumber = generateBatchNumber(newSku);
    }
    setForm(newForm);
  };

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
  }, [filteredProducts, safeCatalogPage, catalogPageSize]);

  const productCounts = useMemo(() => ({
    all: products.length,
    low: products.filter((p) => p.totalStock < (p.minStock || 10)).length,
    prescription: products.filter((p) => p.prescription).length,
  }), [products]);

  useEffect(() => {
    setCatalogPage(1);
  }, [debouncedSearchTerm, filter]);

  useEffect(() => {
    if (catalogPage > totalCatalogPages) {
      setCatalogPage(totalCatalogPages);
    }
  }, [catalogPage, totalCatalogPages]);

  const openDeleteTarget = useCallback((id: string, name: string) => {
    setDeleteTarget({ id, name });
  }, []);

  const openBatchHistory = useCallback((product: Product) => {
    setBatchHistoryProduct(product);
    setFormError('');
  }, []);

  const openPriceEditor = useCallback((product: Product) => {
    setPriceEditModal({
      product,
      costPrice: String(Number(product.costPrice || 0)),
      sellingPrice: String(Number(product.sellingPrice || 0)),
    });
    setPriceHistory([]);
    setPriceHistoryLoading(true);
    setFormError('');
    void (async () => {
      try {
        const response = await fetch(`/api/products/${product.id}/price-history`, {
          headers: await buildApiHeaders(),
        });
        const payload = await response.json().catch(() => []);
        if (!response.ok) {
          throw new Error(payload.error || 'Не удалось загрузить историю цен');
        }
        setPriceHistory(Array.isArray(payload) ? payload : []);
      } catch (e: any) {
        setFormError(e?.message || 'Не удалось загрузить историю цен');
      } finally {
        setPriceHistoryLoading(false);
      }
    })();
  }, []);

  const openBarcodeEditor = useCallback((product: Product) => {
    setBarcodeEditModal({
      product,
      barcode: product.barcode || '',
    });
    setFormError('');
  }, []);

  useEffect(() => {
    if (!barcodeEditModal) return;

    const timeoutId = window.setTimeout(() => {
      barcodeInputRef.current?.focus();
      barcodeInputRef.current?.select();
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [barcodeEditModal]);

  const formatStock = (totalStock: number) => {
    const qty = Math.max(0, Number(totalStock || 0));
    return `${qty} ед.`;
  };

  const getBatchHistoryStatusLabel = (status: string, expiryDate: string | Date) => {
    const expiry = new Date(expiryDate);
    const now = Date.now();
    if (!Number.isNaN(expiry.getTime())) {
      const daysLeft = Math.ceil((expiry.getTime() - now) / (1000 * 60 * 60 * 24));
      if (daysLeft <= 0) return 'Просрочена';
      if (daysLeft <= 30) return `Скоро истекает (${daysLeft} дн.)`;
    }

    if (status === 'CRITICAL') return 'Критичная';
    if (status === 'NEAR_EXPIRY') return 'Скоро истекает';
    if (status === 'EXPIRED') return 'Просрочена';
    return 'Нормально';
  };

  const openAdd = () => {
    setForm(DEFAULT_FORM);
    setFormError('');
    setIsAddOpen(true);
  };

  const openRestockModal = useCallback((product?: Product) => {
    const resolvedSku = product?.sku || '';
    setRestockModal({
      open: true,
      productId: product?.id || '',
      batchNumber: generateBatchNumber(resolvedSku) || `B-${Date.now()}`,
      quantity: '1',
      unit: 'шт.',
      costBasis: String(Number(product?.costPrice || 0)),
      expiryDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      error: null,
    });
    setFormError('');
  }, []);

  useEffect(() => {
    if (initialSection === 'batches') {
      openRestockModal();
    }
  }, [initialSection, openRestockModal]);

  const submitRestock = async () => {
    const quantity = Number(restockModal.quantity);
    const costBasis = Number(restockModal.costBasis);

    if (!restockModal.productId) {
      setRestockModal((prev) => ({ ...prev, error: 'Выберите товар' }));
      return;
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setRestockModal((prev) => ({ ...prev, error: 'Количество должно быть больше 0' }));
      return;
    }
    if (!Number.isFinite(costBasis) || costBasis < 0) {
      setRestockModal((prev) => ({ ...prev, error: 'Цена прихода должна быть неотрицательной' }));
      return;
    }
    if (!restockModal.expiryDate) {
      setRestockModal((prev) => ({ ...prev, error: 'Укажите срок годности' }));
      return;
    }

    setSubmitting(true);
    setRestockModal((prev) => ({ ...prev, error: null }));
    try {
      await restockInventory({
        productId: restockModal.productId,
        batchNumber: restockModal.batchNumber || `B-${Date.now()}`,
        quantity: Math.floor(quantity),
        unit: restockModal.unit || 'шт.',
        costBasis,
        manufacturedDate: new Date(),
        expiryDate: new Date(restockModal.expiryDate),
      });
      await refreshProducts();
      setRestockModal((prev) => ({ ...prev, open: false, error: null }));
    } catch (e: any) {
      setRestockModal((prev) => ({ ...prev, error: e?.message || 'Не удалось добавить приход' }));
    } finally {
      setSubmitting(false);
    }
  };

  const saveProduct = async () => {
    // Validate required fields
    if (!form.name.trim()) {
      setFormError(t('Name is required'));
      return;
    }
    
    if (!form.expiryDate) {
      setFormError(t('Expiry date is required'));
      return;
    }
    
    if (Number(form.costPrice) <= 0) {
      setFormError(t('Cost price must be greater than 0'));
      return;
    }
    
    if (Number(form.sellingPrice) <= 0) {
      setFormError(t('Selling price must be greater than 0'));
      return;
    }

    const initialTotalUnits = Math.max(0, Math.floor(Number(form.initialUnits) || 0));
    const resolvedSku = form.sku.trim() || generateSku(form.name);
    setSubmitting(true);
    setFormError('');
    try {
      await createProduct({
        id: '',
        name: form.name.trim(),
        sku: resolvedSku,
        barcode: form.barcode.trim() || undefined,
        category: form.category.trim() || 'Uncategorized',
        manufacturer: form.manufacturer.trim() || 'Unknown',
        countryOfOrigin: form.countryOfOrigin.trim() || undefined,
        costPrice: Number(form.costPrice),
        sellingPrice: Number(form.sellingPrice),
        image: '',
        prescription: form.prescription,
        markingRequired: form.markingRequired,
        minStock: Number(form.minStock) || 10,
        batchData: {
          batchNumber: form.batchNumber.trim() || generateBatchNumber(resolvedSku),
          expiryDate: form.expiryDate,
          initialQuantity: initialTotalUnits,
        }
      } as any);
      setIsAddOpen(false);
    } catch (e: any) {
      setFormError(e?.message || t('Failed to save product'));
    } finally {
      setSubmitting(false);
    }
  };

  const removeProduct = async (productId: string, productName: string) => {
    setSubmitting(true);
    try {
      await deleteProduct(productId);
      setFeedbackModal({
        open: true,
        title: t('Delete product'),
        message: `${productName} ${t('deleted successfully')}`,
        tone: 'success',
      });
    } catch (e: any) {
      setFeedbackModal({
        open: true,
        title: t('Error'),
        message: e?.message || t('Failed to delete product'),
        tone: 'error',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const savePrices = async () => {
    if (!priceEditModal) return;

    const costPrice = Number(priceEditModal.costPrice);
    const sellingPrice = Number(priceEditModal.sellingPrice);

    if (!Number.isFinite(costPrice) || costPrice < 0) {
      setFormError('Себестоимость должна быть 0 или больше');
      return;
    }

    if (!Number.isFinite(sellingPrice) || sellingPrice <= 0) {
      setFormError('Цена продажи должна быть больше 0');
      return;
    }

    setSubmitting(true);
    setFormError('');
    try {
      await updateProduct({
        ...priceEditModal.product,
        costPrice,
        sellingPrice,
      });
      setFeedbackModal({
        open: true,
        title: 'Цены обновлены',
        message: `Для товара ${priceEditModal.product.name} сохранены новые цены.`,
        tone: 'success',
      });
      setPriceEditModal(null);
    } catch (e: any) {
      setFormError(e?.message || 'Не удалось обновить цены товара');
    } finally {
      setSubmitting(false);
    }
  };

  const saveBarcode = async () => {
    if (!barcodeEditModal) return;

    const barcode = barcodeEditModal.barcode.trim().replace(/\s+/g, '');
    if (!barcode) {
      setFormError('Укажите штрихкод');
      return;
    }

    setSubmitting(true);
    setFormError('');
    try {
      await updateProduct({
        ...barcodeEditModal.product,
        barcode,
      });
      setFeedbackModal({
        open: true,
        title: 'Штрихкод добавлен',
        message: `Для товара ${barcodeEditModal.product.name} сохранен штрихкод ${barcode}.`,
        tone: 'success',
      });
      setBarcodeEditModal(null);
    } catch (e: any) {
      setFormError(e?.message || 'Не удалось сохранить штрихкод');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-3 animate-in fade-in duration-500">
      <div className="shrink-0 rounded-[30px] border border-white/70 bg-white/80 p-4 shadow-[0_18px_45px_rgba(90,90,64,0.08)] backdrop-blur-md">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            <div className="inline-flex items-center gap-2 rounded-2xl border border-[#5A5A40]/10 bg-[#f8f6ef] px-4 py-2.5 shadow-sm">
              <Package size={16} className="text-[#5A5A40]" />
              <span className="text-sm font-semibold text-[#5A5A40]">Товары и партии</span>
            </div>
            <span className="inline-flex items-center rounded-full bg-[#f1eee3] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-[#5A5A40]/55">
              Живые остатки и цены
            </span>
          </div>

          <div className="flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
            <button
              onClick={() => setIsImportOpen(true)}
              className="px-5 py-3 bg-[#5A5A40] text-white rounded-2xl text-sm font-semibold shadow-sm hover:bg-[#4A4A30] transition-all flex items-center gap-2 justify-center"
            >
              <Package size={16} /> Импорт прихода
            </button>
            <button
              onClick={openAdd}
              className="px-5 py-3 bg-[#5A5A40] text-white rounded-2xl text-sm font-semibold shadow-sm hover:bg-[#4A4A30] transition-all flex items-center gap-2 justify-center"
            >
              <Plus size={16} /> Добавить товар
            </button>
            <button
              onClick={() => openRestockModal()}
              className="px-5 py-3 bg-[#5A5A40] text-white rounded-2xl text-sm font-semibold shadow-sm hover:bg-[#4A4A30] transition-all flex items-center gap-2 justify-center"
            >
              <Layers size={16} /> Добавить партию
            </button>
          </div>
        </div>

        <div className="mt-3 rounded-[26px] border border-[#5A5A40]/10 bg-[#fcfbf7] p-3.5 shadow-sm">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="relative group w-full xl:w-[320px]">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-[#5A5A40]/30" size={18} />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder={t('Search products...')}
                className="w-full rounded-2xl border border-[#5A5A40]/10 bg-white pl-12 pr-4 py-3 text-sm outline-none shadow-sm transition-all focus:ring-2 focus:ring-[#5A5A40]/20"
              />
            </div>

            <div className="flex items-center gap-3 overflow-x-auto pb-1 custom-scrollbar">
              {[
                { id: 'all', label: t('All Products'), count: productCounts.all },
                { id: 'low', label: t('Low Stock'), count: productCounts.low },
                { id: 'prescription', label: t('Prescription Only'), count: productCounts.prescription },
              ].map((item) => (
                <button
                  key={item.id}
                  onClick={() => setFilter(item.id as 'all' | 'low' | 'prescription')}
                  className={`px-5 py-2.5 rounded-xl text-sm font-medium whitespace-nowrap transition-all border ${
                    filter === item.id
                      ? 'bg-[#5A5A40] text-white border-[#5A5A40] shadow-md'
                      : 'bg-white text-[#5A5A40]/60 border-[#5A5A40]/10 hover:bg-[#f5f5f0]'
                  }`}
                >
                  {item.label}
                  <span className={`ml-2 px-1.5 py-0.5 rounded-lg text-[10px] font-bold ${filter === item.id ? 'bg-white/20 text-white' : 'bg-[#f5f5f0] text-[#5A5A40]/40'}`}>
                    {item.count}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div>
        <div className="bg-white rounded-3xl shadow-sm border border-[#5A5A40]/5 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-[#f5f5f0]/50 text-[10px] uppercase tracking-widest text-[#5A5A40]/50 font-bold">
                    <th className="px-4 py-4">№</th>
                    <th className="px-6 py-4">{t('Product Info')}</th>
                    <th className="px-6 py-4">{t('Stock Status')}</th>
                    <th className="px-6 py-4">{t('Price')}</th>
                    <th className="px-6 py-4">{t('Prescription')}</th>
                    <th className="px-6 py-4 text-right">{t('Actions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#5A5A40]/5">
                  {paginatedProducts.map((product, index) => {
                    return (
                      <InventoryRow
                        key={product.id}
                        index={(safeCatalogPage - 1) * catalogPageSize + index + 1}
                        product={product}
                        stockLabel={formatStock(product.totalStock)}
                        submitting={submitting}
                        onOpenBatchHistory={openBatchHistory}
                        onEditPrices={openPriceEditor}
                        onAddBarcode={openBarcodeEditor}
                        onDelete={openDeleteTarget}
                        t={t}
                      />
                    );
                  })}
                  {filteredProducts.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-8 py-16 text-center text-[#5A5A40]/40">
                        <Package size={36} className="mx-auto mb-3 opacity-40" />
                        {isLoading ? t('Loading...') : t('No products yet')}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {filteredProducts.length > 10 && (
              <div className="flex min-h-[72px] flex-col gap-3 border-t border-[#5A5A40]/5 bg-[#fcfbf7] px-5 py-4 md:flex-row md:items-center md:justify-between">
                <div className="flex items-center gap-3 text-sm text-[#5A5A40]/70">
                  <span>
                    Показано {(safeCatalogPage - 1) * catalogPageSize + 1}-{Math.min(safeCatalogPage * catalogPageSize, filteredProducts.length)} из {filteredProducts.length}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setCatalogPage((page) => Math.max(1, page - 1))}
                    disabled={safeCatalogPage === 1}
                    className="rounded-xl border border-[#5A5A40]/10 bg-white px-3 py-2 text-sm text-[#5A5A40] transition-all hover:bg-[#f5f5f0] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Назад
                  </button>
                  <span className="px-3 py-2 text-sm font-semibold text-[#5A5A40]">
                    {safeCatalogPage} / {totalCatalogPages}
                  </span>
                  <button
                    type="button"
                    onClick={() => setCatalogPage((page) => Math.min(totalCatalogPages, page + 1))}
                    disabled={safeCatalogPage === totalCatalogPages}
                    className="rounded-xl border border-[#5A5A40]/10 bg-white px-3 py-2 text-sm text-[#5A5A40] transition-all hover:bg-[#f5f5f0] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Вперед
                  </button>
                </div>
              </div>
            )}
        </div>
      </div>

      {batchHistoryProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
            <div className="p-6 border-b border-[#5A5A40]/10 flex items-center justify-between gap-4">
              <div>
                <h3 className="text-xl font-bold text-[#5A5A40]">История партий</h3>
                <p className="text-sm text-[#5A5A40]/60 mt-1">{batchHistoryProduct.name} • {batchHistoryProduct.sku}</p>
                {batchHistoryProduct.countryOfOrigin && (
                  <p className="text-xs text-[#5A5A40]/50 mt-1">Страна производства: {batchHistoryProduct.countryOfOrigin}</p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => openRestockModal(batchHistoryProduct)}
                  className="px-4 py-2 rounded-xl bg-[#5A5A40] text-white text-sm font-semibold hover:bg-[#4A4A30] transition-colors"
                >
                  Приход
                </button>
                <button onClick={() => setBatchHistoryProduct(null)} className="text-[#5A5A40]/50 hover:text-[#5A5A40]">✕</button>
              </div>
            </div>
            <div className="p-6 overflow-y-auto space-y-4">
              {(batchHistoryProduct.batches || []).length === 0 && (
                <div className="rounded-2xl border border-[#5A5A40]/10 bg-[#fcfbf7] px-5 py-10 text-center text-sm text-[#5A5A40]/50">
                  По этому товару партий пока нет.
                </div>
              )}
              <div className="rounded-2xl bg-[#f5f5f0] px-4 py-3 text-sm text-[#5A5A40]">
                Здесь оставлены только данные, по которым легко найти нужную партию: номер, остаток, срок и цена прихода.
              </div>
              {[...(batchHistoryProduct.batches || [])]
                .sort((left, right) => new Date(left.expiryDate).getTime() - new Date(right.expiryDate).getTime())
                .map((batch) => (
                  <div key={batch.id} className="rounded-3xl border border-[#5A5A40]/10 bg-[#fcfbf7] p-5 shadow-sm">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div>
                        <p className="text-sm font-bold text-[#5A5A40]">Партия {batch.batchNumber}</p>
                        <p className="text-[11px] text-[#5A5A40]/55 mt-1">Остаток {Math.max(0, Number(batch.quantity || 0))} ед.</p>
                      </div>
                      <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest border bg-[#f5f5f0] text-[#5A5A40] border-[#5A5A40]/10">
                        {getBatchHistoryStatusLabel(batch.status, batch.expiryDate)}
                      </div>
                    </div>

                    <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-4">
                      <div className="rounded-2xl border border-[#5A5A40]/10 bg-white px-4 py-3">
                        <p className="text-[10px] uppercase tracking-widest text-[#5A5A40]/45 font-bold">Срок годности</p>
                        <p className="font-semibold text-[#5A5A40] mt-1">{new Date(batch.expiryDate).toLocaleDateString('ru-RU')}</p>
                      </div>
                      <div className="rounded-2xl border border-[#5A5A40]/10 bg-white px-4 py-3">
                        <p className="text-[10px] uppercase tracking-widest text-[#5A5A40]/45 font-bold">Остаток</p>
                        <p className="font-semibold text-[#5A5A40] mt-1">{Math.max(0, Number(batch.quantity || 0))} ед.</p>
                      </div>
                      <div className="rounded-2xl border border-[#5A5A40]/10 bg-white px-4 py-3">
                        <p className="text-[10px] uppercase tracking-widest text-[#5A5A40]/45 font-bold">Цена прихода</p>
                        <p className="font-semibold text-[#5A5A40] mt-1">{Number(batch.costBasis || 0).toFixed(2)} TJS</p>
                      </div>
                      <div className="rounded-2xl border border-[#5A5A40]/10 bg-white px-4 py-3">
                        <p className="text-[10px] uppercase tracking-widest text-[#5A5A40]/45 font-bold">Цена продажи</p>
                        <p className="font-semibold text-[#5A5A40] mt-1">{Number(batchHistoryProduct.sellingPrice ?? 0).toFixed(2)} TJS</p>
                      </div>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        </div>
      )}

      {restockModal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-xl max-h-[90vh] flex flex-col overflow-hidden">
            <div className="p-6 border-b border-[#5A5A40]/10 flex items-center justify-between">
              <div>
                <h3 className="text-xl font-bold text-[#5A5A40]">Добавление партии</h3>
                <p className="text-sm text-[#5A5A40]/60 mt-1">Приход сохраняется прямо под товаром и попадает в историю партии.</p>
              </div>
              <button onClick={() => setRestockModal((prev) => ({ ...prev, open: false, error: null }))} className="text-[#5A5A40]/50 hover:text-[#5A5A40]">✕</button>
            </div>
            <div className="p-6 overflow-y-auto space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <label>
                  <span className="block text-xs font-semibold uppercase tracking-widest text-[#5A5A40]/50 mb-1">Товар</span>
                  <select
                    value={restockModal.productId}
                    onChange={(e) => setRestockModal((prev) => ({ ...prev, productId: e.target.value }))}
                    className="w-full px-3 py-2.5 border border-[#5A5A40]/15 rounded-xl text-sm"
                  >
                    <option value="">Выберите товар</option>
                    {products.map((product) => (
                      <option key={product.id} value={product.id}>{product.name}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span className="block text-xs font-semibold uppercase tracking-widest text-[#5A5A40]/50 mb-1">Номер партии</span>
                  <input
                    type="text"
                    value={restockModal.batchNumber}
                    onChange={(e) => setRestockModal((prev) => ({ ...prev, batchNumber: e.target.value }))}
                    className="w-full px-3 py-2.5 border border-[#5A5A40]/15 rounded-xl text-sm"
                  />
                </label>
                <label>
                  <span className="block text-xs font-semibold uppercase tracking-widest text-[#5A5A40]/50 mb-1">Количество</span>
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={restockModal.quantity}
                    onChange={(e) => setRestockModal((prev) => ({ ...prev, quantity: e.target.value }))}
                    className="w-full px-3 py-2.5 border border-[#5A5A40]/15 rounded-xl text-sm"
                  />
                </label>
                <label>
                  <span className="block text-xs font-semibold uppercase tracking-widest text-[#5A5A40]/50 mb-1">Единица</span>
                  <input
                    type="text"
                    value={restockModal.unit}
                    onChange={(e) => setRestockModal((prev) => ({ ...prev, unit: e.target.value }))}
                    className="w-full px-3 py-2.5 border border-[#5A5A40]/15 rounded-xl text-sm"
                  />
                </label>
                <label>
                  <span className="block text-xs font-semibold uppercase tracking-widest text-[#5A5A40]/50 mb-1">Цена прихода</span>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={restockModal.costBasis}
                    onChange={(e) => setRestockModal((prev) => ({ ...prev, costBasis: e.target.value }))}
                    className="w-full px-3 py-2.5 border border-[#5A5A40]/15 rounded-xl text-sm"
                  />
                </label>
                <label className="md:col-span-2">
                  <span className="block text-xs font-semibold uppercase tracking-widest text-[#5A5A40]/50 mb-1">Срок годности</span>
                  <input
                    type="date"
                    value={restockModal.expiryDate}
                    onChange={(e) => setRestockModal((prev) => ({ ...prev, expiryDate: e.target.value }))}
                    className="w-full px-3 py-2.5 border border-[#5A5A40]/15 rounded-xl text-sm"
                  />
                </label>
              </div>

              {restockModal.error && (
                <div className="p-3 bg-red-50 text-red-600 text-xs rounded-xl border border-red-100">
                  {restockModal.error}
                </div>
              )}

              {restockModal.productId && (() => {
                const selectedProduct = products.find((product) => product.id === restockModal.productId);
                if (!selectedProduct) return null;
                return (
                  <div className="rounded-2xl bg-[#f5f5f0] px-4 py-3 text-sm text-[#5A5A40]">
                    Продажная цена будет взята из карточки товара: <span className="font-bold">{Number(selectedProduct.sellingPrice || 0).toFixed(2)} TJS</span>
                  </div>
                );
              })()}

              <div className="grid grid-cols-2 gap-3 pt-2">
                <button
                  onClick={() => setRestockModal((prev) => ({ ...prev, open: false, error: null }))}
                  className="py-2.5 rounded-xl border border-[#5A5A40]/15 text-sm font-semibold text-[#5A5A40] hover:bg-[#f5f5f0] transition-colors"
                >
                  Отмена
                </button>
                <button
                  onClick={submitRestock}
                  disabled={submitting}
                  className="py-2.5 rounded-xl bg-[#5A5A40] text-white text-sm font-semibold hover:bg-[#4A4A30] disabled:opacity-50 transition-colors"
                >
                  {submitting ? 'Сохраняю...' : 'Сохранить приход'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {isAddOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
            <div className="p-6 border-b border-[#5A5A40]/10 flex items-center justify-between">
              <h3 className="text-xl font-bold text-[#5A5A40]">{t('Manual Add Product')}</h3>
              <button onClick={() => setIsAddOpen(false)} className="text-[#5A5A40]/50 hover:text-[#5A5A40]">✕</button>
            </div>
            <div className="p-6 overflow-y-auto space-y-6">
              {/* Product Information Section */}
              <div className="space-y-3">
                <p className="text-sm font-semibold text-[#5A5A40] uppercase tracking-wider">{t('Product Information')} *</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Name */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-[#5A5A40] uppercase tracking-wider">{t('Name')} *</label>
                    <input 
                      type="text"
                      className="w-full px-4 py-3 border border-[#5A5A40]/10 rounded-xl text-sm focus:ring-2 focus:ring-[#5A5A40]/20 outline-none" 
                      value={form.name}
                      onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))}
                    />
                  </div>

                  {/* SKU */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-[#5A5A40] uppercase tracking-wider">SKU</label>
                    <input 
                      type="text"
                      className="w-full px-4 py-3 border border-[#5A5A40]/10 rounded-xl text-sm focus:ring-2 focus:ring-[#5A5A40]/20 outline-none" 
                      value={form.sku}
                      onChange={(e) => handleSkuChange(e.target.value)}
                      placeholder="Можно оставить пустым"
                    />
                    <p className="text-[11px] text-[#5A5A40]/55">Если поле пустое, система сгенерирует SKU автоматически.</p>
                  </div>

                  {/* Barcode */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-[#5A5A40] uppercase tracking-wider">{t('Barcode')}</label>
                    <input 
                      type="text"
                      className="w-full px-4 py-3 border border-[#5A5A40]/10 rounded-xl text-sm focus:ring-2 focus:ring-[#5A5A40]/20 outline-none" 
                      value={form.barcode}
                      onChange={(e) => setForm((s) => ({ ...s, barcode: e.target.value }))}
                    />
                  </div>

                  {/* Category */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-[#5A5A40] uppercase tracking-wider">{t('Category')}</label>
                    <input 
                      type="text"
                      className="w-full px-4 py-3 border border-[#5A5A40]/10 rounded-xl text-sm focus:ring-2 focus:ring-[#5A5A40]/20 outline-none" 
                      value={form.category}
                      onChange={(e) => setForm((s) => ({ ...s, category: e.target.value }))}
                    />
                  </div>

                  {/* Manufacturer */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-[#5A5A40] uppercase tracking-wider">{t('Manufacturer')}</label>
                    <input 
                      type="text"
                      className="w-full px-4 py-3 border border-[#5A5A40]/10 rounded-xl text-sm focus:ring-2 focus:ring-[#5A5A40]/20 outline-none" 
                      value={form.manufacturer}
                      onChange={(e) => setForm((s) => ({ ...s, manufacturer: e.target.value }))}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-[#5A5A40] uppercase tracking-wider">Страна производства</label>
                    <input 
                      type="text"
                      className="w-full px-4 py-3 border border-[#5A5A40]/10 rounded-xl text-sm focus:ring-2 focus:ring-[#5A5A40]/20 outline-none" 
                      value={form.countryOfOrigin}
                      onChange={(e) => setForm((s) => ({ ...s, countryOfOrigin: e.target.value }))}
                      placeholder="Необязательно"
                    />
                    <p className="text-[11px] text-[#5A5A40]/55">Заполняйте только для тех товаров, где страна важна для различения одинакового названия.</p>
                  </div>

                  {/* Min Stock */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-[#5A5A40] uppercase tracking-wider">{t('Min stock')}</label>
                    <input 
                      type="number"
                      className="w-full px-4 py-3 border border-[#5A5A40]/10 rounded-xl text-sm focus:ring-2 focus:ring-[#5A5A40]/20 outline-none" 
                      value={form.minStock}
                      onChange={(e) => setForm((s) => ({ ...s, minStock: Number(e.target.value) || 0 }))}
                    />
                  </div>

                  <div className="space-y-1.5 rounded-xl border border-[#5A5A40]/10 bg-[#f5f5f0]/50 px-4 py-3">
                    <p className="text-xs font-semibold text-[#5A5A40] uppercase tracking-wider">Внутренняя фасовка</p>
                    <p className="text-sm font-semibold text-[#5A5A40] mt-1">Рассчитывается автоматически</p>
                    <p className="text-[11px] text-[#5A5A40]/55 mt-1">Система сохранит служебную фасовку автоматически по SKU и названию. В продаже и остатках используется поштучный режим.</p>
                  </div>

                  {/* Cost Price */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-[#5A5A40] uppercase tracking-wider">{t('Cost price')} *</label>
                    <input 
                      type="number"
                      step="0.01"
                      className="w-full px-4 py-3 border border-[#5A5A40]/10 rounded-xl text-sm focus:ring-2 focus:ring-[#5A5A40]/20 outline-none" 
                      value={form.costPrice}
                      onChange={(e) => setForm((s) => ({ ...s, costPrice: Number(e.target.value) || 0 }))}
                    />
                  </div>

                  {/* Selling Price */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-[#5A5A40] uppercase tracking-wider">{t('Selling price')} *</label>
                    <input 
                      type="number"
                      step="0.01"
                      className="w-full px-4 py-3 border border-[#5A5A40]/10 rounded-xl text-sm focus:ring-2 focus:ring-[#5A5A40]/20 outline-none" 
                      value={form.sellingPrice}
                      onChange={(e) => setForm((s) => ({ ...s, sellingPrice: Number(e.target.value) || 0 }))}
                    />
                  </div>
                </div>
              </div>

              {/* Initial Batch Section */}
              <div className="border-t border-[#5A5A40]/10 pt-6 space-y-3">
                <p className="text-sm font-semibold text-[#5A5A40] uppercase tracking-wider">{t('Initial Batch')} * {t('(Required for pharmacy)')}</p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {/* Batch Number - AUTO */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-[#5A5A40] uppercase tracking-wider">{t('Batch number')} (авто)</label>
                    <div className="w-full px-4 py-3 border border-blue-200 rounded-xl text-sm bg-blue-50 font-semibold text-blue-600 flex items-center">
                      {form.batchNumber || '...'}
                    </div>
                    <p className="text-xs text-blue-500">Генерируется автоматически из SKU</p>
                  </div>

                  {/* Expiry Date */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-red-600 uppercase tracking-wider">{t('Expiry Date')} *</label>
                    <input 
                      type="date"
                      className="w-full px-4 py-3 border border-red-200 rounded-xl text-sm focus:ring-2 focus:ring-red-200/50 outline-none font-semibold" 
                      value={form.expiryDate}
                      onChange={(e) => setForm((s) => ({ ...s, expiryDate: e.target.value }))}
                      required
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-[#5A5A40] uppercase tracking-wider">Начальный остаток, ед.</label>
                    <input
                      type="number"
                      className="w-full px-4 py-3 border border-[#5A5A40]/10 rounded-xl text-sm focus:ring-2 focus:ring-[#5A5A40]/20 outline-none"
                      value={form.initialUnits}
                      onChange={(e) => setForm((s) => ({ ...s, initialUnits: Number(e.target.value) || 0 }))}
                    />
                  </div>
                </div>
                <p className="text-xs text-[#5A5A40]/60 font-medium">
                  Начальный остаток: {(Number(form.initialUnits) || 0)} ед.
                </p>
                <p className="text-xs text-red-500 font-medium">{t('Expiry date is mandatory for pharmacy products')}</p>
              </div>

              {/* Flags Section */}
              <div className="border-t border-[#5A5A40]/10 pt-4 space-y-3">
                <p className="text-xs font-semibold text-[#5A5A40] uppercase tracking-wider">{t('Additional')}</p>
                <label className="flex items-center gap-3 text-sm text-[#5A5A40] cursor-pointer hover:bg-[#f5f5f0]/50 p-2 rounded-lg transition">
                  <input 
                    type="checkbox" 
                    className="w-4 h-4 cursor-pointer"
                    checked={form.prescription}
                    onChange={(e) => setForm((s) => ({ ...s, prescription: e.target.checked }))}
                  />
                  {t('Prescription')}
                </label>
                <label className="flex items-center gap-3 text-sm text-[#5A5A40] cursor-pointer hover:bg-[#f5f5f0]/50 p-2 rounded-lg transition">
                  <input 
                    type="checkbox" 
                    className="w-4 h-4 cursor-pointer"
                    checked={form.markingRequired}
                    onChange={(e) => setForm((s) => ({ ...s, markingRequired: e.target.checked }))}
                  />
                  {t('Marking required')}
                </label>
              </div>

              {/* Error Message */}
              {formError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                  <p className="text-red-600 text-sm font-semibold">{formError}</p>
                </div>
              )}
            </div>
            <div className="p-6 border-t border-[#5A5A40]/10 flex justify-end gap-3">
              <button onClick={() => setIsAddOpen(false)} className="px-5 py-2.5 border border-[#5A5A40]/20 rounded-xl">{t('Cancel')}</button>
              <button onClick={saveProduct} disabled={submitting} className="px-5 py-2.5 bg-[#5A5A40] text-white rounded-xl disabled:opacity-50">
                {submitting ? t('Saving...') : t('Save Product')}
              </button>
            </div>
          </div>
        </div>
      )}

      {priceEditModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-xl overflow-hidden border border-[#5A5A40]/10">
            <div className="p-6 border-b border-[#5A5A40]/10 flex items-center justify-between">
              <div>
                <h3 className="text-xl font-bold text-[#5A5A40]">Изменение цен товара</h3>
                <p className="text-sm text-[#5A5A40]/60 mt-1">{priceEditModal.product.name} · {priceEditModal.product.sku}</p>
              </div>
              <button
                onClick={() => {
                  setPriceEditModal(null);
                  setFormError('');
                }}
                className="text-[#5A5A40]/50 hover:text-[#5A5A40]"
              >
                <X size={20} />
              </button>
            </div>

            <div className="p-6 space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-[#5A5A40] uppercase tracking-wider">Себестоимость, TJS</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={priceEditModal.costPrice}
                    onChange={(e) => setPriceEditModal((prev) => prev ? { ...prev, costPrice: e.target.value } : prev)}
                    className="w-full px-4 py-3 border border-[#5A5A40]/10 rounded-xl text-sm focus:ring-2 focus:ring-[#5A5A40]/20 outline-none"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-[#5A5A40] uppercase tracking-wider">Цена продажи, TJS</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={priceEditModal.sellingPrice}
                    onChange={(e) => setPriceEditModal((prev) => prev ? { ...prev, sellingPrice: e.target.value } : prev)}
                    className="w-full px-4 py-3 border border-[#5A5A40]/10 rounded-xl text-sm focus:ring-2 focus:ring-[#5A5A40]/20 outline-none"
                  />
                </div>
              </div>

              <div className="rounded-2xl border border-[#5A5A40]/10 bg-[#f5f5f0]/60 p-4 grid grid-cols-1 md:grid-cols-3 gap-3 text-sm text-[#5A5A40]">
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-[#5A5A40]/45 font-bold">Текущая цена</p>
                  <p className="font-bold mt-1">{Number(priceEditModal.product.sellingPrice || 0).toFixed(2)} TJS</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-[#5A5A40]/45 font-bold">Новая наценка</p>
                  <p className="font-bold mt-1">
                    {(Number(priceEditModal.sellingPrice || 0) - Number(priceEditModal.costPrice || 0)).toFixed(2)} TJS
                  </p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-[#5A5A40]/45 font-bold">Маржа</p>
                  <p className="font-bold mt-1">
                    {Number(priceEditModal.sellingPrice || 0) > 0
                      ? `${(((Number(priceEditModal.sellingPrice || 0) - Number(priceEditModal.costPrice || 0)) / Number(priceEditModal.sellingPrice || 0)) * 100).toFixed(1)}%`
                      : '0%'}
                  </p>
                </div>
              </div>

              <div className="rounded-2xl border border-[#5A5A40]/10 p-4 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-bold text-[#5A5A40]">История изменения цен</p>
                  {priceHistoryLoading && <p className="text-xs text-[#5A5A40]/50">Загрузка...</p>}
                </div>
                {!priceHistoryLoading && priceHistory.length === 0 && (
                  <p className="text-sm text-[#5A5A40]/60">Изменений цен пока нет.</p>
                )}
                {!priceHistoryLoading && priceHistory.length > 0 && (
                  <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                    {priceHistory.map((entry) => (
                      <div key={entry.id} className="rounded-xl bg-[#f5f5f0]/60 p-3 text-sm text-[#5A5A40]">
                        <div className="flex items-center justify-between gap-3">
                          <p className="font-semibold">{entry.actorName}</p>
                          <p className="text-xs text-[#5A5A40]/50">{new Date(entry.createdAt).toLocaleString('ru-RU')}</p>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-2 text-xs">
                          <p>Себестоимость: {entry.costPrice.old != null ? `${entry.costPrice.old.toFixed(2)} TJS` : '—'} → {entry.costPrice.new != null ? `${entry.costPrice.new.toFixed(2)} TJS` : '—'}</p>
                          <p>Цена продажи: {entry.sellingPrice.old != null ? `${entry.sellingPrice.old.toFixed(2)} TJS` : '—'} → {entry.sellingPrice.new != null ? `${entry.sellingPrice.new.toFixed(2)} TJS` : '—'}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {formError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                  <p className="text-red-600 text-sm font-semibold">{formError}</p>
                </div>
              )}
            </div>

            <div className="p-6 border-t border-[#5A5A40]/10 flex justify-end gap-3">
              <button
                onClick={() => {
                  setPriceEditModal(null);
                  setFormError('');
                }}
                className="px-5 py-2.5 border border-[#5A5A40]/20 rounded-xl"
              >
                {t('Cancel')}
              </button>
              <button
                onClick={savePrices}
                disabled={submitting}
                className="px-5 py-2.5 bg-[#5A5A40] text-white rounded-xl disabled:opacity-50"
              >
                {submitting ? 'Сохранение...' : 'Сохранить цены'}
              </button>
            </div>
          </div>
        </div>
      )}

      {barcodeEditModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden border border-[#5A5A40]/10">
            <div className="p-6 border-b border-[#5A5A40]/10 flex items-center justify-between">
              <div>
                <h3 className="text-xl font-bold text-[#5A5A40]">Добавить штрихкод</h3>
                <p className="text-sm text-[#5A5A40]/60 mt-1">{barcodeEditModal.product.name}</p>
              </div>
              <button
                onClick={() => {
                  setBarcodeEditModal(null);
                  setFormError('');
                }}
                className="text-[#5A5A40]/50 hover:text-[#5A5A40]"
              >
                <X size={20} />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-[#5A5A40] uppercase tracking-wider">Штрихкод</label>
                <input
                  ref={barcodeInputRef}
                  type="text"
                  value={barcodeEditModal.barcode}
                  onChange={(e) => setBarcodeEditModal((prev) => prev ? { ...prev, barcode: e.target.value.replace(/\s+/g, '') } : prev)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void saveBarcode();
                    }
                  }}
                  className="w-full px-4 py-3 border border-[#5A5A40]/10 rounded-xl text-sm focus:ring-2 focus:ring-[#5A5A40]/20 outline-none"
                  placeholder="Сканируйте или введите штрихкод"
                  autoFocus
                />
                <p className="text-xs text-[#5A5A40]/55">Можно сразу считать код сканером. После сканирования нажмите Enter или дождитесь автоматической отправки сканера.</p>
              </div>

              {formError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                  <p className="text-red-600 text-sm font-semibold">{formError}</p>
                </div>
              )}
            </div>

            <div className="p-6 border-t border-[#5A5A40]/10 flex justify-end gap-3">
              <button onClick={() => setBarcodeEditModal(null)} className="px-5 py-2.5 border border-[#5A5A40]/20 rounded-xl">Отмена</button>
              <button onClick={saveBarcode} disabled={submitting} className="px-5 py-2.5 bg-[#5A5A40] text-white rounded-xl disabled:opacity-50">
                {submitting ? 'Сохранение...' : 'Сохранить штрихкод'}
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden border border-[#5A5A40]/10">
            <div className="p-5 bg-red-600 text-white flex items-center justify-between">
              <h3 className="text-lg font-bold">{t('Delete product')}</h3>
              <button onClick={() => setDeleteTarget(null)} className="p-1.5 rounded-lg hover:bg-white/10 transition-colors">
                <X size={18} />
              </button>
            </div>
            <div className="p-6 space-y-5">
              <p className="text-sm text-[#5A5A40]/80">
                {t('Delete product')}: <span className="font-semibold">{deleteTarget.name}</span>?
              </p>
              <div className="flex justify-end gap-3">
                <button onClick={() => setDeleteTarget(null)} className="px-5 py-2.5 border border-[#5A5A40]/20 rounded-xl">
                  {t('Cancel')}
                </button>
                <button
                  onClick={async () => {
                    const target = deleteTarget;
                    if (!target) return;
                    await removeProduct(target.id, target.name);
                    setDeleteTarget(null);
                  }}
                  disabled={submitting}
                  className="px-5 py-2.5 bg-red-600 text-white rounded-xl disabled:opacity-50"
                >
                  {submitting ? t('Deleting...') : t('Delete product')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {feedbackModal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden border border-[#5A5A40]/10">
            <div className={`p-5 text-white flex items-center justify-between ${feedbackModal.tone === 'success' ? 'bg-emerald-600' : 'bg-red-600'}`}>
              <h3 className="text-lg font-bold">{feedbackModal.title}</h3>
              <button onClick={() => setFeedbackModal({ open: false, title: '', message: '', tone: 'success' })} className="p-1.5 rounded-lg hover:bg-white/10 transition-colors">
                <X size={18} />
              </button>
            </div>
            <div className="p-6 space-y-5">
              <p className="text-sm text-[#5A5A40]/80">{feedbackModal.message}</p>
              <div className="flex justify-end">
                <button onClick={() => setFeedbackModal({ open: false, title: '', message: '', tone: 'success' })} className="px-5 py-2.5 bg-[#5A5A40] text-white rounded-xl">
                  {t('OK')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <Suspense fallback={null}>
        <ImportInvoiceModal isOpen={isImportOpen} onClose={() => setIsImportOpen(false)} />
      </Suspense>
    </div>
  );
};
