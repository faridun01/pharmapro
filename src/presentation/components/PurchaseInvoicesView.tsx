import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Calendar, Edit3, FileText, Package, Plus, RefreshCw, Search, Trash2, Truck, X } from 'lucide-react';
import { usePharmacy } from '../context';
import { buildApiHeaders } from '../../infrastructure/api';

type PurchaseInvoiceListItem = {
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  status: string;
  totalAmount: number;
  discountAmount: number;
  taxAmount: number;
  paymentStatus: string;
  comment?: string | null;
  supplier: { id: string; name: string };
  itemCount: number;
  items: Array<{
    id: string;
    quantity: number;
    purchasePrice: number;
    lineTotal: number;
    product: { id: string; name: string; sku: string };
    batches: Array<{ id: string; quantity: number; initialQty: number; currentQty: number; status: string; expiryDate: string }>;
  }>;
};

type PurchaseInvoiceDetail = Omit<PurchaseInvoiceListItem, 'items'> & {
  warehouse?: { id: string; name: string };
  createdBy?: { id: string; name: string; email: string };
  paidAmountTotal: number;
  outstandingAmount: number;
  items: Array<{
    id: string;
    productId: string;
    batchNumber?: string | null;
    manufacturedDate?: string | null;
    expiryDate?: string | null;
    quantity: number;
    purchasePrice: number;
    wholesalePrice?: number | null;
    retailPrice?: number | null;
    lineTotal: number;
    product: { id: string; name: string; sku: string; sellingPrice: number; totalStock: number };
    batches: Array<{
      id: string;
      batchNumber: string;
      quantity: number;
      initialQty: number;
      currentQty: number;
      reservedQty: number;
      availableQty: number;
      unit: string;
      costBasis: number;
      wholesalePrice?: number | null;
      manufacturedDate: string;
      expiryDate: string;
      status: string;
      supplier?: { id: string; name: string } | null;
      movements: Array<{ id: string; type: string; quantity: number; date: string; description?: string | null }>;
    }>;
  }>;
};

type PurchaseLineForm = {
  id?: string;
  productId: string;
  batchNumber: string;
  quantity: string;
  unit: string;
  costBasis: string;
  wholesalePrice: string;
  manufacturedDate: string;
  expiryDate: string;
};

type InvoiceForm = {
  supplierId: string;
  invoiceNumber: string;
  invoiceDate: string;
  discountAmount: string;
  taxAmount: string;
  comment: string;
  items: PurchaseLineForm[];
};

const emptyLine = (): PurchaseLineForm => ({
  productId: '',
  batchNumber: `B-${Date.now()}`,
  quantity: '1',
  unit: 'шт.',
  costBasis: '0',
  wholesalePrice: '',
  manufacturedDate: new Date().toISOString().slice(0, 10),
  expiryDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
});

const toDateInput = (value?: string | null) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
};

const formatMoney = (value: number) => `${Number(value || 0).toFixed(2)} TJS`;

const usedQuantityForLine = (line: PurchaseInvoiceDetail['items'][number]) => {
  const batch = line.batches[0];
  if (!batch) return 0;
  return Math.max(0, Number(batch.initialQty || line.quantity || 0) - Number(batch.currentQty || 0));
};

export const PurchaseInvoicesView: React.FC = () => {
  const { suppliers, products, refreshSuppliers, refreshProducts } = usePharmacy();
  const [invoices, setInvoices] = useState<PurchaseInvoiceListItem[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [supplierFilter, setSupplierFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<PurchaseInvoiceDetail | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busyAction, setBusyAction] = useState('');
  const [form, setForm] = useState<InvoiceForm>({
    supplierId: '',
    invoiceNumber: '',
    invoiceDate: new Date().toISOString().slice(0, 10),
    discountAmount: '0',
    taxAmount: '0',
    comment: '',
    items: [],
  });

  useEffect(() => {
    void refreshSuppliers();
    void refreshProducts();
  }, [refreshProducts, refreshSuppliers]);

  const loadInvoices = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ pageSize: '100' });
      if (searchTerm.trim()) params.set('search', searchTerm.trim());
      if (supplierFilter) params.set('supplierId', supplierFilter);

      const response = await fetch(`/api/inventory/purchase-invoices?${params.toString()}`, {
        headers: await buildApiHeaders(),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Не удалось загрузить приходные накладные');
      setInvoices(Array.isArray(payload.items) ? payload.items : []);
    } catch (e: any) {
      setError(e?.message || 'Не удалось загрузить приходные накладные');
    } finally {
      setLoading(false);
    }
  }, [searchTerm, supplierFilter]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void loadInvoices();
    }, 200);
    return () => window.clearTimeout(timeout);
  }, [loadInvoices]);

  const openDetails = async (id: string, editAfterLoad = false) => {
    setDetailsLoading(true);
    setError('');
    try {
      const response = await fetch(`/api/inventory/purchase-invoices/${id}`, {
        headers: await buildApiHeaders(),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Не удалось открыть приходную накладную');
      setSelected(payload);
      if (editAfterLoad) {
        openEditForm(payload);
      }
    } catch (e: any) {
      setError(e?.message || 'Не удалось открыть приходную накладную');
    } finally {
      setDetailsLoading(false);
    }
  };

  const openEditForm = (invoice: PurchaseInvoiceDetail) => {
    setForm({
      supplierId: invoice.supplier?.id || '',
      invoiceNumber: invoice.invoiceNumber || '',
      invoiceDate: toDateInput(invoice.invoiceDate) || new Date().toISOString().slice(0, 10),
      discountAmount: String(Number(invoice.discountAmount || 0)),
      taxAmount: String(Number(invoice.taxAmount || 0)),
      comment: invoice.comment || '',
      items: invoice.items.map((item) => {
        const batch = item.batches[0];
        return {
          id: item.id,
          productId: item.productId,
          batchNumber: item.batchNumber || batch?.batchNumber || '',
          quantity: String(item.quantity || batch?.initialQty || 1),
          unit: batch?.unit || 'шт.',
          costBasis: String(Number(item.purchasePrice || batch?.costBasis || 0)),
          wholesalePrice: item.wholesalePrice == null ? '' : String(Number(item.wholesalePrice || 0)),
          manufacturedDate: toDateInput(item.manufacturedDate || batch?.manufacturedDate) || new Date().toISOString().slice(0, 10),
          expiryDate: toDateInput(item.expiryDate || batch?.expiryDate) || '',
        };
      }),
    });
    setEditOpen(true);
    setError('');
  };

  const totals = useMemo(() => {
    const gross = form.items.reduce((sum, item) => sum + Number(item.quantity || 0) * Number(item.costBasis || 0), 0);
    const discount = Number(form.discountAmount || 0);
    const tax = Number(form.taxAmount || 0);
    return {
      gross,
      total: Math.max(0, gross - discount + tax),
    };
  }, [form]);

  const updateLine = (index: number, patch: Partial<PurchaseLineForm>) => {
    setForm((prev) => ({
      ...prev,
      items: prev.items.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    }));
  };

  const saveInvoice = async () => {
    if (!selected) return;
    if (!form.supplierId) {
      setError('Выберите поставщика');
      return;
    }
    if (!form.invoiceNumber.trim()) {
      setError('Укажите номер накладной');
      return;
    }
    if (!form.items.length) {
      setError('Добавьте хотя бы одну строку прихода');
      return;
    }
    if (form.items.some((item) => !item.productId || !item.expiryDate || Number(item.quantity) <= 0)) {
      setError('Проверьте товар, количество и срок годности в строках');
      return;
    }

    setSaving(true);
    setError('');
    try {
      const response = await fetch(`/api/inventory/purchase-invoices/${selected.id}`, {
        method: 'PUT',
        headers: await buildApiHeaders(),
        body: JSON.stringify({
          supplierId: form.supplierId,
          invoiceNumber: form.invoiceNumber.trim(),
          invoiceDate: form.invoiceDate,
          discountAmount: Number(form.discountAmount || 0),
          taxAmount: Number(form.taxAmount || 0),
          comment: form.comment.trim() || null,
          items: form.items.map((item) => ({
            id: item.id,
            productId: item.productId,
            batchNumber: item.batchNumber.trim() || `B-${Date.now()}`,
            quantity: Math.floor(Number(item.quantity || 0)),
            unit: item.unit || 'шт.',
            costBasis: Number(item.costBasis || 0),
            wholesalePrice: item.wholesalePrice === '' ? null : Number(item.wholesalePrice || 0),
            manufacturedDate: item.manufacturedDate,
            expiryDate: item.expiryDate,
          })),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Не удалось сохранить приходную накладную');
      setSelected(payload);
      setEditOpen(false);
      await Promise.all([loadInvoices(), refreshProducts()]);
    } catch (e: any) {
      setError(e?.message || 'Не удалось сохранить приходную накладную');
    } finally {
      setSaving(false);
    }
  };

  const removeInvoiceItem = async (itemId: string) => {
    if (!selected) return;
    if (!window.confirm('Удалить товар из приходной накладной? Остаток по этой партии будет откатан.')) return;

    setBusyAction(`item:${itemId}`);
    setError('');
    try {
      const response = await fetch(`/api/inventory/purchase-invoices/${selected.id}/items/${itemId}`, {
        method: 'DELETE',
        headers: await buildApiHeaders(),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Не удалось удалить товар из накладной');
      setSelected(payload);
      await Promise.all([loadInvoices(), refreshProducts()]);
    } catch (e: any) {
      setError(e?.message || 'Не удалось удалить товар из накладной');
    } finally {
      setBusyAction('');
    }
  };

  const cancelInvoice = async () => {
    if (!selected) return;
    const reason = window.prompt('Причина отмены приходной накладной', 'Ошибка в приходе') || '';
    if (!window.confirm('Отменить приходную накладную? Все неиспользованные партии из этой накладной будут списаны с остатка.')) return;

    setBusyAction('cancel');
    setError('');
    try {
      const response = await fetch(`/api/inventory/purchase-invoices/${selected.id}/cancel`, {
        method: 'POST',
        headers: await buildApiHeaders(),
        body: JSON.stringify({ reason }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Не удалось отменить приходную накладную');
      setSelected(payload);
      setEditOpen(false);
      await Promise.all([loadInvoices(), refreshProducts()]);
    } catch (e: any) {
      setError(e?.message || 'Не удалось отменить приходную накладную');
    } finally {
      setBusyAction('');
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="rounded-[24px] border border-[#5A5A40]/10 bg-white px-5 py-4 shadow-sm">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <h3 className="text-lg font-bold text-[#5A5A40]">Приходные накладные</h3>
            <p className="text-sm text-[#5A5A40]/55 mt-1">Связь поставщика, строк прихода, партий и текущего остатка.</p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative">
              <Search size={17} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#5A5A40]/35" />
              <input
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Номер, поставщик, комментарий"
                className="w-full sm:w-72 pl-10 pr-3 py-2.5 rounded-xl border border-[#5A5A40]/10 text-sm outline-none focus:ring-2 focus:ring-[#5A5A40]/20"
              />
            </div>
            <select
              value={supplierFilter}
              onChange={(e) => setSupplierFilter(e.target.value)}
              className="px-3 py-2.5 rounded-xl border border-[#5A5A40]/10 text-sm text-[#5A5A40] bg-white outline-none"
            >
              <option value="">Все поставщики</option>
              {suppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>{supplier.name}</option>
              ))}
            </select>
            <button
              onClick={() => void loadInvoices()}
              disabled={loading}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[#5A5A40] text-white text-sm font-semibold disabled:opacity-50"
            >
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
              Обновить
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-semibold text-red-600">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.25fr)_minmax(360px,0.75fr)] gap-6">
        <div className="bg-white rounded-3xl border border-[#5A5A40]/5 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-[#f5f5f0]/70 text-[10px] uppercase tracking-widest text-[#5A5A40]/50">
                <tr>
                  <th className="px-5 py-4">Накладная</th>
                  <th className="px-5 py-4">Поставщик</th>
                  <th className="px-5 py-4">Строки</th>
                  <th className="px-5 py-4">Сумма</th>
                  <th className="px-5 py-4">Статус</th>
                  <th className="px-5 py-4 text-right">Действие</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#5A5A40]/5">
                {invoices.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-5 py-12 text-center text-sm text-[#5A5A40]/45">
                      {loading ? 'Загрузка...' : 'Приходные накладные не найдены'}
                    </td>
                  </tr>
                )}
                {invoices.map((invoice) => (
                  <tr key={invoice.id} className="hover:bg-[#f5f5f0]/35 transition-colors">
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-2xl bg-[#f5f5f0] text-[#5A5A40] flex items-center justify-center">
                          <FileText size={17} />
                        </div>
                        <div>
                          <p className="font-bold text-sm text-[#5A5A40]">{invoice.invoiceNumber}</p>
                          <p className="text-[11px] text-[#5A5A40]/45">{new Date(invoice.invoiceDate).toLocaleDateString('ru-RU')}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-4 text-sm text-[#5A5A40]">{invoice.supplier?.name || '—'}</td>
                    <td className="px-5 py-4 text-sm text-[#5A5A40]">{invoice.itemCount}</td>
                    <td className="px-5 py-4 text-sm font-bold text-[#5A5A40]">{formatMoney(invoice.totalAmount)}</td>
                    <td className="px-5 py-4">
                      <span className="inline-flex rounded-full border border-[#5A5A40]/10 bg-[#f5f5f0] px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-[#5A5A40]/65">
                        {invoice.paymentStatus}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => void openDetails(invoice.id)}
                          className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-[#f5f5f0] text-[#5A5A40] hover:bg-[#ebeade]"
                          title="Детали"
                        >
                          <Package size={15} />
                        </button>
                        <button
                          onClick={() => void openDetails(invoice.id, true)}
                          className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-[#eef2e6] text-[#5A5A40] hover:bg-[#e2e8d6]"
                          title="Редактировать"
                        >
                          <Edit3 size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-white rounded-3xl border border-[#5A5A40]/5 shadow-sm overflow-hidden min-h-[520px]">
          {!selected && (
            <div className="h-full min-h-[520px] flex items-center justify-center p-8 text-center text-[#5A5A40]/50">
              <div>
                <Truck size={34} className="mx-auto mb-3 text-[#5A5A40]/30" />
                <p className="text-sm font-semibold">Выберите накладную, чтобы увидеть поставщика, партии и движения.</p>
              </div>
            </div>
          )}

          {selected && (
            <div>
              <div className="p-5 border-b border-[#5A5A40]/10 flex items-start justify-between gap-4">
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-[#5A5A40]/45 font-bold">Детали прихода</p>
                  <h3 className="text-lg font-bold text-[#5A5A40] mt-1">{selected.invoiceNumber}</h3>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs text-[#5A5A40]/60">
                    <span className="inline-flex items-center gap-1"><Truck size={13} />{selected.supplier?.name}</span>
                    <span className="inline-flex items-center gap-1"><Calendar size={13} />{new Date(selected.invoiceDate).toLocaleDateString('ru-RU')}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => openEditForm(selected)}
                    disabled={detailsLoading || selected.status === 'CANCELLED'}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#5A5A40] text-white text-sm font-semibold disabled:opacity-50"
                  >
                    <Edit3 size={15} />
                    Изменить
                  </button>
                  <button
                    onClick={cancelInvoice}
                    disabled={busyAction === 'cancel' || selected.status === 'CANCELLED'}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-red-600 text-white text-sm font-semibold disabled:opacity-50"
                  >
                    <X size={15} />
                    Отменить
                  </button>
                </div>
              </div>

              <div className="p-5 space-y-4">
                <div className="grid grid-cols-3 gap-3">
                  <div className="rounded-2xl bg-[#f5f5f0] p-3">
                    <p className="text-[10px] uppercase tracking-widest text-[#5A5A40]/45 font-bold">Сумма</p>
                    <p className="text-sm font-bold text-[#5A5A40] mt-1">{formatMoney(selected.totalAmount)}</p>
                  </div>
                  <div className="rounded-2xl bg-[#f5f5f0] p-3">
                    <p className="text-[10px] uppercase tracking-widest text-[#5A5A40]/45 font-bold">Оплачено</p>
                    <p className="text-sm font-bold text-[#5A5A40] mt-1">{formatMoney(selected.paidAmountTotal || 0)}</p>
                  </div>
                  <div className="rounded-2xl bg-[#f5f5f0] p-3">
                    <p className="text-[10px] uppercase tracking-widest text-[#5A5A40]/45 font-bold">Долг</p>
                    <p className="text-sm font-bold text-[#5A5A40] mt-1">{formatMoney(selected.outstandingAmount || 0)}</p>
                  </div>
                </div>

                <div className="space-y-3 max-h-[560px] overflow-y-auto pr-1">
                  {selected.items.map((item) => {
                    const batch = item.batches[0];
                    const usedQty = usedQuantityForLine(item);
                    return (
                      <div key={item.id} className="rounded-2xl border border-[#5A5A40]/10 p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-bold text-[#5A5A40]">{item.product.name}</p>
                            <p className="text-[11px] text-[#5A5A40]/45 mt-0.5">{item.product.sku} · партия {item.batchNumber || batch?.batchNumber || '—'}</p>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="rounded-full bg-[#f5f5f0] px-3 py-1 text-[10px] font-bold text-[#5A5A40]/65">{batch?.status || '—'}</span>
                            <button
                              onClick={() => void removeInvoiceItem(item.id)}
                              disabled={busyAction === `item:${item.id}` || selected.status === 'CANCELLED' || selected.items.length <= 1}
                              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-red-500 hover:bg-red-50 disabled:opacity-35"
                              title="Удалить товар из накладной"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                        <div className="mt-3 grid grid-cols-2 gap-3 text-xs text-[#5A5A40]/70">
                          <p>Приход: <span className="font-bold text-[#5A5A40]">{item.quantity}</span></p>
                          <p>Остаток партии: <span className="font-bold text-[#5A5A40]">{batch?.currentQty ?? '—'}</span></p>
                          <p>Использовано: <span className="font-bold text-[#5A5A40]">{usedQty}</span></p>
                          <p>Цена прихода: <span className="font-bold text-[#5A5A40]">{formatMoney(item.purchasePrice)}</span></p>
                          <p>Срок: <span className="font-bold text-[#5A5A40]">{item.expiryDate ? new Date(item.expiryDate).toLocaleDateString('ru-RU') : '—'}</span></p>
                          <p>Сумма строки: <span className="font-bold text-[#5A5A40]">{formatMoney(item.lineTotal)}</span></p>
                        </div>
                        {batch?.movements?.length > 0 && (
                          <div className="mt-3 border-t border-[#5A5A40]/10 pt-3">
                            <p className="text-[10px] uppercase tracking-widest text-[#5A5A40]/40 font-bold mb-2">Последние движения</p>
                            <div className="space-y-1.5">
                              {batch.movements.slice(0, 4).map((movement) => (
                                <p key={movement.id} className="text-[11px] text-[#5A5A40]/60">
                                  {new Date(movement.date).toLocaleDateString('ru-RU')} · {movement.type} · {movement.quantity} · {movement.description || ''}
                                </p>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {editOpen && selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="w-full max-w-6xl max-h-[92vh] overflow-hidden rounded-3xl bg-white shadow-2xl border border-[#5A5A40]/10 flex flex-col">
            <div className="p-5 border-b border-[#5A5A40]/10 flex items-center justify-between">
              <div>
                <h3 className="text-xl font-bold text-[#5A5A40]">Редактирование прихода</h3>
                <p className="text-sm text-[#5A5A40]/55 mt-1">Количество нельзя уменьшить ниже уже проданного или зарезервированного остатка.</p>
              </div>
              <button onClick={() => setEditOpen(false)} className="p-2 rounded-xl hover:bg-[#f5f5f0] text-[#5A5A40]/55">
                <X size={20} />
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <label>
                  <span className="block text-xs font-bold uppercase tracking-widest text-[#5A5A40]/45 mb-1">Поставщик</span>
                  <select value={form.supplierId} onChange={(e) => setForm((prev) => ({ ...prev, supplierId: e.target.value }))} className="w-full px-3 py-2.5 rounded-xl border border-[#5A5A40]/10 text-sm">
                    <option value="">Выберите поставщика</option>
                    {suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
                  </select>
                </label>
                <label>
                  <span className="block text-xs font-bold uppercase tracking-widest text-[#5A5A40]/45 mb-1">Номер</span>
                  <input value={form.invoiceNumber} onChange={(e) => setForm((prev) => ({ ...prev, invoiceNumber: e.target.value }))} className="w-full px-3 py-2.5 rounded-xl border border-[#5A5A40]/10 text-sm" />
                </label>
                <label>
                  <span className="block text-xs font-bold uppercase tracking-widest text-[#5A5A40]/45 mb-1">Дата</span>
                  <input type="date" value={form.invoiceDate} onChange={(e) => setForm((prev) => ({ ...prev, invoiceDate: e.target.value }))} className="w-full px-3 py-2.5 rounded-xl border border-[#5A5A40]/10 text-sm" />
                </label>
                <label>
                  <span className="block text-xs font-bold uppercase tracking-widest text-[#5A5A40]/45 mb-1">Комментарий</span>
                  <input value={form.comment} onChange={(e) => setForm((prev) => ({ ...prev, comment: e.target.value }))} className="w-full px-3 py-2.5 rounded-xl border border-[#5A5A40]/10 text-sm" />
                </label>
              </div>

              <div className="rounded-2xl border border-[#5A5A40]/10 overflow-hidden">
                <div className="px-4 py-3 bg-[#f5f5f0]/70 flex items-center justify-between">
                  <p className="text-xs font-bold uppercase tracking-widest text-[#5A5A40]/55">Строки прихода</p>
                  <button
                    onClick={() => setForm((prev) => ({ ...prev, items: [...prev.items, emptyLine()] }))}
                    className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[#5A5A40] text-white text-xs font-bold"
                  >
                    <Plus size={14} />
                    Строка
                  </button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead className="text-[10px] uppercase tracking-widest text-[#5A5A40]/45">
                      <tr>
                        <th className="px-3 py-3 min-w-56">Товар</th>
                        <th className="px-3 py-3">Партия</th>
                        <th className="px-3 py-3">Кол-во</th>
                        <th className="px-3 py-3">Цена</th>
                        <th className="px-3 py-3">Опт.</th>
                        <th className="px-3 py-3">Произв.</th>
                        <th className="px-3 py-3">Срок</th>
                        <th className="px-3 py-3 text-right">Удалить</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#5A5A40]/5">
                      {form.items.map((item, index) => (
                        <tr key={`${item.id || 'new'}-${index}`}>
                          <td className="px-3 py-3">
                            <select value={item.productId} disabled={Boolean(item.id)} onChange={(e) => updateLine(index, { productId: e.target.value })} className="w-full px-2 py-2 rounded-lg border border-[#5A5A40]/10 text-xs disabled:bg-[#f5f5f0]">
                              <option value="">Выберите товар</option>
                              {products.map((product) => <option key={product.id} value={product.id}>{product.name} · {product.sku}</option>)}
                            </select>
                          </td>
                          <td className="px-3 py-3"><input value={item.batchNumber} onChange={(e) => updateLine(index, { batchNumber: e.target.value })} className="w-32 px-2 py-2 rounded-lg border border-[#5A5A40]/10 text-xs" /></td>
                          <td className="px-3 py-3"><input type="number" min={1} value={item.quantity} onChange={(e) => updateLine(index, { quantity: e.target.value })} className="w-24 px-2 py-2 rounded-lg border border-[#5A5A40]/10 text-xs" /></td>
                          <td className="px-3 py-3"><input type="number" min={0} step="0.01" value={item.costBasis} onChange={(e) => updateLine(index, { costBasis: e.target.value })} className="w-28 px-2 py-2 rounded-lg border border-[#5A5A40]/10 text-xs" /></td>
                          <td className="px-3 py-3"><input type="number" min={0} step="0.01" value={item.wholesalePrice} onChange={(e) => updateLine(index, { wholesalePrice: e.target.value })} className="w-28 px-2 py-2 rounded-lg border border-[#5A5A40]/10 text-xs" /></td>
                          <td className="px-3 py-3"><input type="date" value={item.manufacturedDate} onChange={(e) => updateLine(index, { manufacturedDate: e.target.value })} className="w-36 px-2 py-2 rounded-lg border border-[#5A5A40]/10 text-xs" /></td>
                          <td className="px-3 py-3"><input type="date" value={item.expiryDate} onChange={(e) => updateLine(index, { expiryDate: e.target.value })} className="w-36 px-2 py-2 rounded-lg border border-[#5A5A40]/10 text-xs" /></td>
                          <td className="px-3 py-3 text-right">
                            <button onClick={() => setForm((prev) => ({ ...prev, items: prev.items.filter((_, i) => i !== index) }))} className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-red-500 hover:bg-red-50">
                              <Trash2 size={14} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <label>
                  <span className="block text-xs font-bold uppercase tracking-widest text-[#5A5A40]/45 mb-1">Скидка</span>
                  <input type="number" min={0} step="0.01" value={form.discountAmount} onChange={(e) => setForm((prev) => ({ ...prev, discountAmount: e.target.value }))} className="w-full px-3 py-2.5 rounded-xl border border-[#5A5A40]/10 text-sm" />
                </label>
                <label>
                  <span className="block text-xs font-bold uppercase tracking-widest text-[#5A5A40]/45 mb-1">Налог</span>
                  <input type="number" min={0} step="0.01" value={form.taxAmount} onChange={(e) => setForm((prev) => ({ ...prev, taxAmount: e.target.value }))} className="w-full px-3 py-2.5 rounded-xl border border-[#5A5A40]/10 text-sm" />
                </label>
                <div className="rounded-2xl bg-[#f5f5f0] p-3">
                  <p className="text-[10px] uppercase tracking-widest text-[#5A5A40]/45 font-bold">Сумма строк</p>
                  <p className="text-sm font-bold text-[#5A5A40] mt-1">{formatMoney(totals.gross)}</p>
                </div>
                <div className="rounded-2xl bg-[#5A5A40] p-3 text-white">
                  <p className="text-[10px] uppercase tracking-widest text-white/55 font-bold">Итого</p>
                  <p className="text-sm font-bold mt-1">{formatMoney(totals.total)}</p>
                </div>
              </div>
            </div>

            <div className="p-5 border-t border-[#5A5A40]/10 flex justify-end gap-3">
              <button onClick={() => setEditOpen(false)} className="px-5 py-2.5 rounded-xl border border-[#5A5A40]/15 text-[#5A5A40]">Отмена</button>
              <button onClick={saveInvoice} disabled={saving} className="px-5 py-2.5 rounded-xl bg-[#5A5A40] text-white disabled:opacity-50">
                {saving ? 'Сохраняю...' : 'Сохранить приход'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
