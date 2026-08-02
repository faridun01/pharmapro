import React, { useEffect, useState } from 'react';
import {
  ArrowLeftRight,
  Plus,
  CheckCircle2,
  XCircle,
  Clock,
  Building2,
  Package,
  AlertCircle,
  RefreshCw,
  Search,
} from 'lucide-react';
import { apiGet, apiPost } from '../../infrastructure/api';
import { AppModal } from './AppModal';

type Warehouse = {
  id: string;
  code: string;
  name: string;
};

type TransferItem = {
  id: string;
  productId: string;
  quantity: number;
  product?: { id: string; name: string; sku: string };
  batch?: { id: string; batchNumber: string };
};

type StockTransfer = {
  id: string;
  transferNo: string;
  fromWarehouseId: string;
  toWarehouseId: string;
  status: 'DRAFT' | 'IN_TRANSIT' | 'RECEIVED' | 'CANCELLED';
  reason?: string;
  createdAt: string;
  receivedAt?: string;
  fromWarehouse: Warehouse;
  toWarehouse: Warehouse;
  createdBy?: { id: string; name: string };
  receivedBy?: { id: string; name: string };
  items: TransferItem[];
};

type ProductOption = {
  id: string;
  name: string;
  sku: string;
  totalStock: number;
  batches?: Array<{ id: string; batchNumber: string; quantity: number }>;
};

export const StockTransfersView: React.FC = () => {
  const [transfers, setTransfers] = useState<StockTransfer[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [search, setSearch] = useState('');

  // New transfer form state
  const [fromWarehouseId, setFromWarehouseId] = useState('');
  const [toWarehouseId, setToWarehouseId] = useState('');
  const [reason, setReason] = useState('');
  const [items, setItems] = useState<Array<{ productId: string; batchId: string; quantity: number }>>([
    { productId: '', batchId: '', quantity: 1 },
  ]);

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);
      const [transfersRes, warehousesRes, productsRes] = await Promise.all([
        apiGet<{ items: StockTransfer[] }>('/api/transfers'),
        apiGet<Warehouse[]>('/api/warehouses'),
        apiGet<{ items: ProductOption[] }>('/api/products?limit=100'),
      ]);

      setTransfers(transfersRes.items || []);
      setWarehouses(warehousesRes || []);
      setProducts(productsRes.items || []);

      if (warehousesRes && warehousesRes.length >= 2) {
        setFromWarehouseId(warehousesRes[0].id);
        setToWarehouseId(warehousesRes[1].id);
      }
    } catch (err: any) {
      setError(err?.message || 'Ошибка при загрузке данных перемещений');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleAddItemRow = () => {
    setItems((prev) => [...prev, { productId: '', batchId: '', quantity: 1 }]);
  };

  const handleRemoveItemRow = (index: number) => {
    setItems((prev) => prev.filter((_, i) => i !== index));
  };

  const handleItemChange = (index: number, field: string, value: any) => {
    setItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, [field]: value } : item)),
    );
  };

  const handleCreateTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fromWarehouseId || !toWarehouseId) {
      setError('Выберите исходный склад и склад назначения');
      return;
    }
    if (fromWarehouseId === toWarehouseId) {
      setError('Исходный склад и склад назначения должны различаться');
      return;
    }

    const validItems = items.filter((i) => i.productId && i.quantity > 0);
    if (validItems.length === 0) {
      setError('Добавьте хотя бы один товар для перемещения');
      return;
    }

    try {
      setSubmitting(true);
      setError(null);
      await apiPost('/api/transfers', {
        fromWarehouseId,
        toWarehouseId,
        reason,
        items: validItems,
      });

      setIsModalOpen(false);
      setItems([{ productId: '', batchId: '', quantity: 1 }]);
      setReason('');
      await loadData();
    } catch (err: any) {
      setError(err?.message || 'Ошибка при создании перемещения');
    } finally {
      setSubmitting(false);
    }
  };

  const handleReceiveTransfer = async (id: string) => {
    try {
      setLoading(true);
      await apiPost(`/api/transfers/${id}/receive`, {});
      await loadData();
    } catch (err: any) {
      setError(err?.message || 'Ошибка при приеме перемещения');
      setLoading(false);
    }
  };

  const handleCancelTransfer = async (id: string) => {
    if (!window.confirm('Вы действительно хотите отменить это перемещение?')) return;
    try {
      setLoading(true);
      await apiPost(`/api/transfers/${id}/cancel`, {});
      await loadData();
    } catch (err: any) {
      setError(err?.message || 'Ошибка при отмене перемещения');
      setLoading(false);
    }
  };

  const filteredTransfers = transfers.filter((t) => {
    const q = search.toLowerCase();
    return (
      t.transferNo.toLowerCase().includes(q) ||
      t.fromWarehouse?.name.toLowerCase().includes(q) ||
      t.toWarehouse?.name.toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-6">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-[#151619] tracking-tight">Межскладские перемещения</h2>
          <p className="text-xs text-[#5A5A40]/70 mt-1">Управление передачей запасов между аптеками и складами</p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={loadData}
            className="p-2.5 rounded-xl border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 transition-colors"
            title="Обновить"
          >
            <RefreshCw size={18} />
          </button>
          <button
            onClick={() => setIsModalOpen(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-[#5A5A40] text-white rounded-xl text-sm font-semibold hover:bg-[#4a4a34] shadow-md transition-all"
          >
            <Plus size={18} />
            <span>Создать перемещение</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm flex items-center gap-3">
          <AlertCircle size={20} className="shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Search & Filter */}
      <div className="relative max-w-md">
        <Search size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Поиск по № перемещения или складу..."
          className="w-full pl-10 pr-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#5A5A40]/30"
        />
      </div>

      {/* Table */}
      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-gray-400 text-sm">Загрузка перемещений...</div>
        ) : filteredTransfers.length === 0 ? (
          <div className="p-12 text-center text-gray-400 text-sm">Перемещения не найдены</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 border-b border-gray-200 text-gray-500 font-medium text-xs uppercase tracking-wider">
                <tr>
                  <th className="px-6 py-3.5">№ Перемещения</th>
                  <th className="px-6 py-3.5">Откуда</th>
                  <th className="px-6 py-3.5">Куда</th>
                  <th className="px-6 py-3.5">Позиций</th>
                  <th className="px-6 py-3.5">Статус</th>
                  <th className="px-6 py-3.5">Дата</th>
                  <th className="px-6 py-3.5 text-right">Действия</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredTransfers.map((t) => (
                  <tr key={t.id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="px-6 py-4 font-semibold text-[#151619]">{t.transferNo}</td>
                    <td className="px-6 py-4 text-gray-600">{t.fromWarehouse?.name || '—'}</td>
                    <td className="px-6 py-4 text-gray-600">{t.toWarehouse?.name || '—'}</td>
                    <td className="px-6 py-4 text-gray-600">{t.items?.length || 0} шт.</td>
                    <td className="px-6 py-4">
                      {t.status === 'RECEIVED' && (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                          <CheckCircle2 size={14} /> Получено
                        </span>
                      )}
                      {t.status === 'IN_TRANSIT' && (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                          <Clock size={14} /> В пути
                        </span>
                      )}
                      {t.status === 'CANCELLED' && (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-200">
                          <XCircle size={14} /> Отменено
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-gray-500 text-xs">
                      {new Date(t.createdAt).toLocaleDateString('ru-RU')}
                    </td>
                    <td className="px-6 py-4 text-right space-x-2">
                      {t.status === 'IN_TRANSIT' && (
                        <>
                          <button
                            onClick={() => handleReceiveTransfer(t.id)}
                            className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-semibold hover:bg-emerald-700 transition-colors"
                          >
                            Принять
                          </button>
                          <button
                            onClick={() => handleCancelTransfer(t.id)}
                            className="px-3 py-1.5 bg-gray-100 text-gray-600 rounded-lg text-xs font-semibold hover:bg-gray-200 transition-colors"
                          >
                            Отменить
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create Modal */}
      <AppModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="Новое межскладское перемещение"
      >
        <form onSubmit={handleCreateTransfer} className="space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5">
                Откуда (Исходный склад)
              </label>
              <select
                value={fromWarehouseId}
                onChange={(e) => setFromWarehouseId(e.target.value)}
                className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#5A5A40]"
                required
              >
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name} ({w.code})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5">
                Куда (Склад назначения)
              </label>
              <select
                value={toWarehouseId}
                onChange={(e) => setToWarehouseId(e.target.value)}
                className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#5A5A40]"
                required
              >
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name} ({w.code})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5">
              Причина / Комментарий
            </label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Например: Пополнение остатков филиала..."
              className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#5A5A40]"
            />
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-gray-700 uppercase tracking-wider">Товары</label>
              <button
                type="button"
                onClick={handleAddItemRow}
                className="text-xs text-[#5A5A40] font-semibold hover:underline flex items-center gap-1"
              >
                <Plus size={14} /> Добавить товар
              </button>
            </div>

            {items.map((item, idx) => (
              <div key={idx} className="flex items-center gap-3 p-3 bg-gray-50 border border-gray-200 rounded-xl">
                <select
                  value={item.productId}
                  onChange={(e) => handleItemChange(idx, 'productId', e.target.value)}
                  className="flex-1 p-2 bg-white border border-gray-200 rounded-lg text-sm"
                  required
                >
                  <option value="">Выберите товар...</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} (Остаток: {p.totalStock})
                    </option>
                  ))}
                </select>

                <input
                  type="number"
                  min="1"
                  value={item.quantity}
                  onChange={(e) => handleItemChange(idx, 'quantity', Number(e.target.value))}
                  className="w-24 p-2 bg-white border border-gray-200 rounded-lg text-sm text-center"
                  placeholder="Кол-во"
                  required
                />

                {items.length > 1 && (
                  <button
                    type="button"
                    onClick={() => handleRemoveItemRow(idx)}
                    className="p-1 text-red-500 hover:text-red-700"
                  >
                    <XCircle size={18} />
                  </button>
                )}
              </div>
            ))}
          </div>

          <div className="pt-4 flex items-center justify-end gap-3 border-t border-gray-100">
            <button
              type="button"
              onClick={() => setIsModalOpen(false)}
              className="px-4 py-2.5 rounded-xl border border-gray-200 text-gray-600 text-sm font-semibold hover:bg-gray-50"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2.5 rounded-xl bg-[#5A5A40] text-white text-sm font-semibold hover:bg-[#4a4a34] disabled:opacity-50"
            >
              {submitting ? 'Сохранение...' : 'Отправить перемещение'}
            </button>
          </div>
        </form>
      </AppModal>
    </div>
  );
};
