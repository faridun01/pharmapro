import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usePharmacy } from '../context';
import { useDebounce } from '../../lib/useDebounce';
import { buildApiHeaders } from '../../infrastructure/api';
import { 
  Search, 
  History, 
  Calendar,
  X,
  Trash2,
  Layers,
  Plus,
  ArrowDownUp,
  ChevronDown,
  ChevronUp,
  Package
} from 'lucide-react';
import { Batch, BatchStatus } from '../../core/domain';

type BatchSortMode = 'name' | 'quantity_desc' | 'quantity_asc';

type BatchWithProductName = Batch & { productName: string; productId: string; minStock?: number };
type BatchGroup = {
  key: string;
  productName: string;
  productId: string;
  minStock: number;
  batches: BatchWithProductName[];
  totalQuantity: number;
  soonestExpiry: Date | null;
  worstStatus: BatchStatus;
  suppliers: string[];
  averageCostBasis: number;
  averageRetailPrice: number;
};

type BatchRowProps = {
  batch: BatchWithProductName;
  isLowStock: boolean;
  busyBatchId: string | null;
  getStatusColor: (status: BatchStatus) => string;
  formatPackQuantity: (quantity: number) => string;
  onHistory: (batch: BatchWithProductName) => void;
  onRestock: (batch: BatchWithProductName) => void;
  onDelete: (batch: BatchWithProductName) => void;
  t: (key: string) => string;
};

const BatchRow = React.memo(function BatchRow({ batch, isLowStock, busyBatchId, getStatusColor, formatPackQuantity, onHistory, onRestock, onDelete, t }: BatchRowProps) {
  return (
    <tr className={`transition-colors group ${isLowStock ? 'bg-amber-50/60 hover:bg-amber-50' : 'hover:bg-[#f5f5f0]/30'}`}>
      <td className="px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-[#f5f5f0] rounded-lg flex items-center justify-center text-[#5A5A40] group-hover:bg-[#5A5A40] group-hover:text-white transition-colors">
            <History size={16} />
          </div>
          <span className="font-mono font-bold text-[#5A5A40] text-sm">{batch.batchNumber}</span>
        </div>
      </td>
      <td className="px-6 py-4">
        <p className="text-sm font-medium text-[#5A5A40]">{batch.supplierName || '—'}</p>
      </td>
      <td className="px-6 py-4">
        <p className={`text-sm font-bold ${isLowStock ? 'text-amber-700' : 'text-[#5A5A40]'}`}>{formatPackQuantity(batch.quantity)}</p>
        <p className="text-[10px] text-[#5A5A40]/40 mt-0.5">
          {`${t('Unit')}: ${batch.unit}`}
        </p>
        {isLowStock && (
          <p className="text-[10px] text-amber-700 font-bold mt-1">Низкий остаток</p>
        )}
      </td>
      <td className="px-6 py-4">
        <div className="flex items-center gap-2 text-sm text-[#5A5A40]/60">
          <Calendar size={14} />
          {new Date(batch.expiryDate).toLocaleDateString()}
        </div>
      </td>
      <td className="px-6 py-4">
        <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest border ${getStatusColor(batch.status)}`}>
          {t(batch.status.replace('_', ' '))}
        </span>
      </td>
      <td className="px-6 py-4 text-right">
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={() => onHistory(batch)}
            className="p-2 text-[#5A5A40]/30 hover:text-[#5A5A40] hover:bg-[#f5f5f0] rounded-xl transition-all"
            title="История партии"
          >
            <History size={18} />
          </button>
          <button
            onClick={() => onRestock(batch)}
            disabled={busyBatchId === batch.id}
            className="p-2 text-[#5A5A40]/30 hover:text-emerald-600 hover:bg-emerald-50 rounded-xl transition-all disabled:opacity-40"
            title="Пополнить"
          >
            <Layers size={18} />
          </button>
          <button
            onClick={() => onDelete(batch)}
            disabled={busyBatchId === batch.id}
            className="p-2 text-[#5A5A40]/30 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all disabled:opacity-40"
            title="Удалить партию"
          >
            <Trash2 size={18} />
          </button>
        </div>
      </td>
    </tr>
  );
});

export const BatchesView: React.FC<{
  embedded?: boolean;
  onOpenImportInvoice?: () => void;
  onOpenAddProduct?: () => void;
  showActionBlock?: boolean;
  openCreateBatchSignal?: number;
}> = ({ embedded = false, onOpenImportInvoice, onOpenAddProduct, showActionBlock = true, openCreateBatchSignal = 0 }) => {
  const { t } = useTranslation();
  const { products, refreshProducts, restockInventory } = usePharmacy();
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<BatchStatus | 'ALL'>('ALL');
  const [sortMode, setSortMode] = useState<BatchSortMode>('name');
  const [historyBatch, setHistoryBatch] = useState<BatchWithProductName | null>(null);
  const [restockModal, setRestockModal] = useState({
    open: false,
    productId: '',
    batchNumber: '',
    quantity: '0',
    unit: 'шт.',
    costBasis: '0',
    retailPrice: '0',
    expiryDate: '',
    error: null as string | null,
  });
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyBatchId, setBusyBatchId] = useState<string | null>(null);
  const [expandedGroupKeys, setExpandedGroupKeys] = useState<string[]>([]);

  // Debounce search to 300ms to avoid filtering on every keystroke
  const debouncedSearchTerm = useDebounce(searchTerm, 300);

  const allBatches = useMemo(() => products.flatMap((p) => p.batches.map((b) => ({ ...b, productName: p.name, productId: p.id, minStock: Number(p.minStock || 0) }))), [products]);

  const normalizeName = (value: string) => value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru-RU');

  const formatPackQuantity = (quantity: number) => {
    const wholeQuantity = Math.max(0, Math.floor(Number(quantity || 0)));
    return `${wholeQuantity} ед.`;
  };

  const formatMoney = (value: number) => `${Number(value || 0).toFixed(2)} TJS`;

  const filteredBatches = useMemo(() => allBatches.filter((b) => {
    const matchesSearch = b.productName.toLowerCase().includes(debouncedSearchTerm.toLowerCase()) || 
                         b.batchNumber.toLowerCase().includes(debouncedSearchTerm.toLowerCase());
    const matchesStatus = statusFilter === 'ALL' || b.status === statusFilter;
    return matchesSearch && matchesStatus;
  }), [allBatches, debouncedSearchTerm, statusFilter]);

  const statusCounts = useMemo(() => ({
    ALL: allBatches.length,
    STABLE: allBatches.filter((b) => b.status === 'STABLE').length,
    NEAR_EXPIRY: allBatches.filter((b) => b.status === 'NEAR_EXPIRY').length,
    CRITICAL: allBatches.filter((b) => b.status === 'CRITICAL').length,
    EXPIRED: allBatches.filter((b) => b.status === 'EXPIRED').length,
  }), [allBatches]);

  const statusOptions: Array<{ id: BatchStatus | 'ALL'; label: string }> = [
    { id: 'ALL', label: 'Все партии' },
    { id: 'STABLE', label: 'Стабильные' },
    { id: 'NEAR_EXPIRY', label: 'Скоро истекают' },
    { id: 'CRITICAL', label: 'Критические' },
    { id: 'EXPIRED', label: 'Просроченные' },
  ];

  const openHistoryModal = useCallback((batch: BatchWithProductName) => setHistoryBatch(batch), []);

  const getStatusColor = (status: BatchStatus) => {
    switch (status) {
      case 'STABLE': return 'bg-emerald-50 text-emerald-600 border-emerald-100';
      case 'NEAR_EXPIRY': return 'bg-amber-50 text-amber-600 border-amber-100';
      case 'CRITICAL': return 'bg-red-50 text-red-600 border-red-100';
      case 'EXPIRED': return 'bg-red-100 text-red-800 border-red-200';
      default: return 'bg-stone-50 text-stone-600 border-stone-100';
    }
  };

  const getGroupStatusMeta = (group: BatchGroup) => {
    if (group.totalQuantity <= 0) {
      return {
        label: 'НЕТ ОСТАТКА',
        className: 'bg-red-50 text-red-700 border-red-200',
      };
    }

    if (group.minStock > 0 && group.totalQuantity <= group.minStock) {
      return {
        label: 'НИЗКИЙ ОСТАТОК',
        className: 'bg-amber-50 text-amber-700 border-amber-200',
      };
    }

    return {
      label: t(group.worstStatus.replace('_', ' ')),
      className: getStatusColor(group.worstStatus),
    };
  };

  const getWorstStatus = (batches: BatchWithProductName[]): BatchStatus => {
    if (batches.some((batch) => batch.status === 'EXPIRED')) return 'EXPIRED';
    if (batches.some((batch) => batch.status === 'CRITICAL')) return 'CRITICAL';
    if (batches.some((batch) => batch.status === 'NEAR_EXPIRY')) return 'NEAR_EXPIRY';
    return 'STABLE';
  };

  const groupedBatches = useMemo<BatchGroup[]>(() => {
    const groups = new Map<string, BatchWithProductName[]>();

    for (const batch of filteredBatches) {
      const key = normalizeName(batch.productName);
      const group = groups.get(key) || [];
      group.push(batch);
      groups.set(key, group);
    }

    return [...groups.entries()].map(([key, batches]) => {
      const orderedBatches = [...batches].sort((left, right) => new Date(left.expiryDate).getTime() - new Date(right.expiryDate).getTime());
      const firstBatch = orderedBatches[0];
      const suppliers = [...new Set(orderedBatches.map((batch) => batch.supplierName).filter(Boolean) as string[])];
      const totalQuantity = orderedBatches.reduce((sum, batch) => sum + Number(batch.quantity || 0), 0);
      const totalCostValue = orderedBatches.reduce((sum, batch) => sum + Number(batch.quantity || 0) * Number(batch.costBasis || 0), 0);
      const totalRetailValue = orderedBatches.reduce((sum, batch) => sum + Number(batch.quantity || 0) * Number(batch.retailPrice || 0), 0);
      return {
        key,
        productName: firstBatch?.productName || '',
        productId: firstBatch?.productId || '',
        minStock: Number(firstBatch?.minStock || 0),
        batches: orderedBatches,
        totalQuantity,
        soonestExpiry: firstBatch ? new Date(firstBatch.expiryDate) : null,
        worstStatus: getWorstStatus(orderedBatches),
        suppliers,
        averageCostBasis: totalQuantity > 0 ? totalCostValue / totalQuantity : 0,
        averageRetailPrice: totalQuantity > 0 ? totalRetailValue / totalQuantity : 0,
      };
    }).sort((left, right) => {
      if (sortMode === 'quantity_desc') return right.totalQuantity - left.totalQuantity;
      if (sortMode === 'quantity_asc') return left.totalQuantity - right.totalQuantity;
      return left.productName.localeCompare(right.productName, 'ru-RU');
    });
  }, [filteredBatches, sortMode]);

  const toggleGroup = useCallback((key: string) => {
    setExpandedGroupKeys((prev) => prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key]);
  }, []);

  const handleDeleteBatch = async (batch: BatchWithProductName) => {
    const confirmed = window.confirm(`Удалить партию ${batch.batchNumber}?`);
    if (!confirmed) return;

    setActionError(null);
    setBusyBatchId(batch.id);
    try {
      const response = await fetch(`/api/inventory/batches/${batch.id}`, {
        method: 'DELETE',
        headers: await buildApiHeaders(),
      });

      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body.error || 'Не удалось удалить партию');
      }

      await refreshProducts();
    } catch (error: any) {
      setActionError(error.message || 'Не удалось удалить партию');
    } finally {
      setBusyBatchId(null);
    }
  };

  const openRestockModalForBatch = (batch: BatchWithProductName) => {
    setRestockModal({
      open: true,
      productId: batch.productId,
      batchNumber: `B-${Date.now()}`,
      quantity: '1',
      unit: batch.unit || 'шт.',
      costBasis: String(batch.costBasis ?? 0),
      retailPrice: String(batch.retailPrice ?? 0),
      expiryDate: batch.expiryDate ? new Date(batch.expiryDate).toISOString().slice(0, 10) : '',
      error: null,
    });
    setActionError(null);
  };

  const openCreateBatchModal = () => {
    setRestockModal({
      open: true,
      productId: '',
      batchNumber: `B-${Date.now()}`,
      quantity: '1',
      unit: 'шт.',
      costBasis: '0',
      retailPrice: '0',
      expiryDate: '',
      error: null,
    });
    setActionError(null);
  };

  useEffect(() => {
    if (openCreateBatchSignal > 0) {
      openCreateBatchModal();
    }
  }, [openCreateBatchSignal]);

  const submitRestock = async () => {
    const quantity = Number(restockModal.quantity);
    const costBasis = Number(restockModal.costBasis);
    const retailPrice = Number(restockModal.retailPrice);

    if (!restockModal.productId) {
      setRestockModal((prev) => ({ ...prev, error: 'Выберите товар' }));
      return;
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setRestockModal((prev) => ({ ...prev, error: 'Количество должно быть больше 0' }));
      return;
    }
    if (!Number.isFinite(costBasis) || costBasis < 0) {
      setRestockModal((prev) => ({ ...prev, error: 'Себестоимость должна быть неотрицательной' }));
      return;
    }
    if (!Number.isFinite(retailPrice) || retailPrice < 0) {
      setRestockModal((prev) => ({ ...prev, error: 'Цена продажи должна быть неотрицательной' }));
      return;
    }
    if (!restockModal.expiryDate) {
      setRestockModal((prev) => ({ ...prev, error: 'Укажите срок годности' }));
      return;
    }

    setBusyBatchId('restock');
    setRestockModal((prev) => ({ ...prev, error: null }));
    try {
      await restockInventory({
        productId: restockModal.productId,
        batchNumber: restockModal.batchNumber || `B-${Date.now()}`,
        quantity: Math.floor(quantity),
        unit: restockModal.unit || 'шт.',
        costBasis,
        retailPrice,
        manufacturedDate: new Date(),
        expiryDate: new Date(restockModal.expiryDate),
      });
      await refreshProducts();
      setRestockModal((prev) => ({ ...prev, open: false, error: null }));
    } catch (error: any) {
      setRestockModal((prev) => ({ ...prev, error: error.message || 'Не удалось выполнить пополнение' }));
    } finally {
      setBusyBatchId(null);
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div>
        {embedded ? null : (
          <>
            <h2 className="text-3xl font-bold text-[#5A5A40] tracking-tight">{t('Batch Tracking')}</h2>
            <p className="text-[#5A5A40]/60 mt-1 italic">{t('Monitor expiry dates and batch movements')}</p>
          </>
        )}
      </div>

      {showActionBlock && (
      <div className="rounded-[28px] border border-[#5A5A40]/10 bg-white px-4 py-4 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-center">
          {onOpenImportInvoice && (
            <button
              onClick={onOpenImportInvoice}
              className="px-5 py-3 bg-[#5A5A40] text-white rounded-2xl text-sm font-semibold shadow-sm hover:bg-[#4A4A30] transition-all flex items-center gap-2 justify-center"
            >
              <Package size={16} /> Импорт прихода
            </button>
          )}
          {onOpenAddProduct && (
            <button
              onClick={onOpenAddProduct}
              className="px-5 py-3 bg-[#5A5A40] text-white rounded-2xl text-sm font-semibold shadow-sm hover:bg-[#4A4A30] transition-all flex items-center gap-2 justify-center"
            >
              <Plus size={16} /> Добавить товар
            </button>
          )}
          <button
            onClick={openCreateBatchModal}
            className="px-5 py-3 bg-[#5A5A40] text-white rounded-2xl text-sm font-semibold shadow-sm hover:bg-[#4A4A30] transition-all flex items-center gap-2 justify-center"
          >
            <Layers size={16} /> Добавить партию
          </button>
        </div>
      </div>
      )}

      <div className="space-y-4 bg-white rounded-2xl border border-[#5A5A40]/10 px-4 py-4 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-[#5A5A40]/45">Сортировка и фильтр</p>
            <p className="text-xs text-[#5A5A40]/60 mt-1">Сначала выберите порядок, затем отфильтруйте партии по статусу.</p>
          </div>
          <div className="flex items-center gap-2">
            <ArrowDownUp size={16} className="text-[#5A5A40]/40" />
            <select
              value={sortMode}
              onChange={(e) => setSortMode(e.target.value as BatchSortMode)}
              className="px-3 py-2 rounded-xl border border-[#5A5A40]/15 text-sm text-[#5A5A40] bg-white outline-none"
            >
              <option value="name">По названию</option>
              <option value="quantity_desc">Сначала больше количество</option>
              <option value="quantity_asc">Сначала меньше количество</option>
            </select>
          </div>
        </div>

        <div className="flex items-center gap-4 overflow-x-auto pb-1 custom-scrollbar">
          {statusOptions.map((option) => (
            <button
              key={option.id}
              onClick={() => setStatusFilter(option.id)}
              className={`px-6 py-2.5 rounded-xl text-sm font-medium whitespace-nowrap transition-all border ${
                statusFilter === option.id
                  ? 'bg-[#5A5A40] text-white border-[#5A5A40] shadow-md'
                  : 'bg-white text-[#5A5A40]/60 border-[#5A5A40]/10 hover:bg-[#f5f5f0]'
              }`}
            >
              {option.label}
              <span className={`ml-2 px-1.5 py-0.5 rounded-lg text-[10px] font-bold ${statusFilter === option.id ? 'bg-white/20 text-white' : 'bg-[#f5f5f0] text-[#5A5A40]/40'}`}>
                {statusCounts[option.id]}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-start gap-3">
        <div className="relative group">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-[#5A5A40]/30 group-focus-within:text-[#5A5A40] transition-colors" size={18} />
          <input 
            type="text" 
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Поиск по товару или партии"
            className="w-64 pl-12 pr-4 py-3 bg-white border border-[#5A5A40]/10 rounded-2xl text-sm outline-none focus:ring-2 focus:ring-[#5A5A40]/20 transition-all shadow-sm"
          />
        </div>
      </div>

      <div className="bg-white rounded-3xl shadow-sm border border-[#5A5A40]/5 overflow-hidden">
        {actionError && (
          <div className="mx-6 mt-6 p-3 bg-red-50 text-red-600 text-xs rounded-xl border border-red-100">
            {actionError}
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-[#f5f5f0]/50 text-[10px] uppercase tracking-widest text-[#5A5A40]/50 font-bold">
                <th className="px-8 py-5">{t('Product')}</th>
                <th className="px-8 py-5">Партий</th>
                <th className="px-8 py-5">{t('Quantity')}</th>
                <th className="px-8 py-5">Цены</th>
                <th className="px-8 py-5">Ближайший срок</th>
                <th className="px-8 py-5">{t('Status')}</th>
                <th className="px-8 py-5 text-right">Развернуть</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#5A5A40]/5">
              {groupedBatches.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-8 py-12 text-center text-sm text-[#5A5A40]/45">
                    Ничего не найдено по текущему фильтру
                  </td>
                </tr>
              )}
              {groupedBatches.map((group) => {
                const isExpanded = expandedGroupKeys.includes(group.key);
                const isLowStock = group.minStock > 0 && group.totalQuantity <= group.minStock;
                const groupStatus = getGroupStatusMeta(group);

                return (
                  <React.Fragment key={group.key}>
                    <tr className={`transition-colors ${isLowStock ? 'bg-amber-50/70 hover:bg-amber-50' : 'hover:bg-[#f5f5f0]/30'}`}>
                      <td className="px-8 py-5">
                        <div className="flex items-center gap-3">
                          <div className={`w-10 h-10 rounded-2xl flex items-center justify-center ${isLowStock ? 'bg-amber-100 text-amber-700' : 'bg-[#f5f5f0] text-[#5A5A40]'}`}>
                            <Package size={18} />
                          </div>
                          <div>
                            <p className={`text-sm font-bold ${isLowStock ? 'text-amber-800' : 'text-[#5A5A40]'}`}>{group.productName}</p>
                            <p className="text-[11px] text-[#5A5A40]/45 mt-0.5">
                              {group.suppliers.length > 0 ? `${t('Supplier')}: ${group.suppliers.join(', ')}` : 'Без поставщика'}
                            </p>
                            {isLowStock && (
                              <p className="text-[10px] font-bold text-amber-700 mt-1">Низкий остаток: минимум {group.minStock} шт.</p>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-8 py-5 text-sm font-semibold text-[#5A5A40]">{group.batches.length}</td>
                      <td className="px-8 py-5 text-sm font-semibold text-[#5A5A40]">
                        <span className={`inline-flex items-center rounded-full px-3 py-1 ${isLowStock ? 'bg-amber-100 text-amber-800' : 'bg-[#f5f5f0] text-[#5A5A40]'}`}>
                          {formatPackQuantity(group.totalQuantity)}
                        </span>
                      </td>
                      <td className="px-8 py-5">
                        <div className="text-sm text-[#5A5A40] font-semibold">Себест.: {formatMoney(group.averageCostBasis)}</div>
                        <div className="text-[11px] text-[#5A5A40]/55 mt-0.5">Розн.: {formatMoney(group.averageRetailPrice)}</div>
                      </td>
                      <td className="px-8 py-5 text-sm text-[#5A5A40]/65">
                        {group.soonestExpiry ? group.soonestExpiry.toLocaleDateString() : '—'}
                      </td>
                      <td className="px-8 py-5">
                        <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest border ${groupStatus.className}`}>
                          {groupStatus.label}
                        </span>
                      </td>
                      <td className="px-8 py-5 text-right">
                        <button
                          onClick={() => toggleGroup(group.key)}
                          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-[#5A5A40]/10 text-sm font-medium text-[#5A5A40] hover:bg-[#f5f5f0] transition-all"
                        >
                          {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                          {isExpanded ? 'Скрыть партии' : 'Показать партии'}
                        </button>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr>
                        <td colSpan={7} className="px-6 pb-6">
                          <div className="mx-2 rounded-2xl border border-[#5A5A40]/10 overflow-hidden bg-[#faf9f6]">
                            <table className="w-full text-left border-collapse">
                              <thead>
                                <tr className="text-[10px] uppercase tracking-widest text-[#5A5A40]/45 bg-white/80 font-bold">
                                  <th className="px-6 py-4">{t('Batch Info')}</th>
                                  <th className="px-6 py-4">{t('Supplier')}</th>
                                  <th className="px-6 py-4">{t('Quantity')}</th>
                                  <th className="px-6 py-4">{t('Expiry Date')}</th>
                                  <th className="px-6 py-4">{t('Status')}</th>
                                  <th className="px-6 py-4 text-right">{t('Actions')}</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-[#5A5A40]/5 bg-white">
                                {group.batches.map((batch) => (
                                  <BatchRow
                                    key={batch.id}
                                    batch={batch}
                                    isLowStock={Number(group.minStock || 0) > 0 && Number(batch.quantity || 0) <= Number(group.minStock || 0)}
                                    busyBatchId={busyBatchId}
                                    getStatusColor={getStatusColor}
                                    formatPackQuantity={formatPackQuantity}
                                    onHistory={openHistoryModal}
                                    onRestock={openRestockModalForBatch}
                                    onDelete={handleDeleteBatch}
                                    t={t}
                                  />
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {historyBatch && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm">
          <div className="w-full max-w-2xl bg-white rounded-3xl shadow-xl border border-[#5A5A40]/10 overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#5A5A40]/10">
              <div>
                <h3 className="text-lg font-bold text-[#5A5A40]">История партии {historyBatch.batchNumber}</h3>
                <p className="text-xs text-[#5A5A40]/50 mt-1">{historyBatch.productName}</p>
              </div>
              <button
                onClick={() => setHistoryBatch(null)}
                className="p-2 rounded-xl text-[#5A5A40]/40 hover:text-[#5A5A40] hover:bg-[#f5f5f0] transition-all"
              >
                <X size={18} />
              </button>
            </div>

            <div className="max-h-[60vh] overflow-y-auto px-6 py-4 space-y-2">
              {historyBatch.movements.length === 0 && (
                <p className="text-sm text-[#5A5A40]/50">Движений по партии пока нет</p>
              )}
              {historyBatch.movements.map((movement) => (
                <div key={movement.id} className="flex items-center justify-between rounded-xl border border-[#5A5A40]/10 px-4 py-3">
                  <div>
                    <p className="text-sm font-semibold text-[#5A5A40]">{movement.type}</p>
                    <p className="text-[11px] text-[#5A5A40]/50 mt-0.5">
                      {new Date(movement.date).toLocaleDateString('ru-RU')} {new Date(movement.date).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                  <span className="text-sm font-bold text-[#5A5A40]">{movement.quantity} {historyBatch.unit}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {restockModal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm">
          <div className="w-full max-w-xl bg-white rounded-3xl shadow-xl border border-[#5A5A40]/10 overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#5A5A40]/10">
              <div>
                <h3 className="text-lg font-bold text-[#5A5A40]">{restockModal.productId ? 'Пополнение партии' : 'Добавление новой партии'}</h3>
                <p className="text-xs text-[#5A5A40]/50 mt-1">Укажите товар, количество, срок годности и цены. Партия сразу попадет в учет остатков.</p>
              </div>
              <button
                onClick={() => setRestockModal((prev) => ({ ...prev, open: false, error: null }))}
                className="p-2 rounded-xl text-[#5A5A40]/40 hover:text-[#5A5A40] hover:bg-[#f5f5f0] transition-all"
              >
                <X size={18} />
              </button>
            </div>

            <div className="px-6 py-5 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <label>
                  <span className="block text-xs font-semibold uppercase tracking-widest text-[#5A5A40]/50 mb-1">Товар</span>
                  <select
                    value={restockModal.productId}
                    onChange={(e) => setRestockModal((prev) => ({ ...prev, productId: e.target.value }))}
                    className="w-full px-3 py-2.5 border border-[#5A5A40]/15 rounded-xl text-sm"
                  >
                    <option value="">Выберите товар</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
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
                  <span className="block text-xs font-semibold uppercase tracking-widest text-[#5A5A40]/50 mb-1">Себестоимость</span>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={restockModal.costBasis}
                    onChange={(e) => setRestockModal((prev) => ({ ...prev, costBasis: e.target.value }))}
                    className="w-full px-3 py-2.5 border border-[#5A5A40]/15 rounded-xl text-sm"
                  />
                </label>
                <label>
                  <span className="block text-xs font-semibold uppercase tracking-widest text-[#5A5A40]/50 mb-1">Цена продажи</span>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={restockModal.retailPrice}
                    onChange={(e) => setRestockModal((prev) => ({ ...prev, retailPrice: e.target.value }))}
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

              <div className="rounded-2xl bg-[#f5f5f0] px-4 py-3 grid grid-cols-1 md:grid-cols-3 gap-3 text-sm text-[#5A5A40]">
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-[#5A5A40]/45 font-bold">По себестоимости</p>
                  <p className="font-bold mt-1">{formatMoney(Number(restockModal.quantity || 0) * Number(restockModal.costBasis || 0))}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-[#5A5A40]/45 font-bold">По рознице</p>
                  <p className="font-bold mt-1">{formatMoney(Number(restockModal.quantity || 0) * Number(restockModal.retailPrice || 0))}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-[#5A5A40]/45 font-bold">Тип действия</p>
                  <p className="font-bold mt-1">{restockModal.productId ? 'Пополнение' : 'Новая партия'}</p>
                </div>
              </div>

              {restockModal.error && (
                <div className="p-3 bg-red-50 text-red-600 text-xs rounded-xl border border-red-100">
                  {restockModal.error}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  onClick={() => setRestockModal((prev) => ({ ...prev, open: false, error: null }))}
                  className="px-4 py-2 rounded-xl border border-[#5A5A40]/15 text-sm text-[#5A5A40] hover:bg-[#f5f5f0] transition-all"
                >
                  Отмена
                </button>
                <button
                  onClick={submitRestock}
                  disabled={busyBatchId === 'restock'}
                  className="px-4 py-2 rounded-xl bg-[#5A5A40] text-white text-sm hover:bg-[#4A4A30] transition-all disabled:opacity-40"
                >
                  {busyBatchId === 'restock' ? 'Сохраняю...' : 'Пополнить'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
