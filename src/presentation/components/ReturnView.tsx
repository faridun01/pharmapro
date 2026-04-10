import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { usePharmacy } from '../context';
import { buildApiHeaders } from '../../infrastructure/api';
import { useCurrencyCode } from '../../lib/useCurrencyCode';
import { runRefreshTasks } from '../../lib/utils';
import { Plus, CheckCircle2, XCircle, Clock, RefreshCw, ChevronDown, ChevronUp, Package, Printer } from 'lucide-react';
import { AppModal } from './AppModal';

interface ReturnItem {
  id: string;
  productId: string;
  batchId?: string;
  quantity: number;
  unitPrice?: number;
  reason?: string;
  product?: { name: string; sku: string };
  batch?: { batchNumber: string };
}

interface Return {
  id: string;
  returnNo: string;
  type: 'CUSTOMER' | 'SUPPLIER';
  status: 'DRAFT' | 'APPROVED' | 'REJECTED' | 'COMPLETED';
  totalAmount?: number | null;
  customerName?: string;
  refundMethod?: string;
  reason?: string;
  note?: string;
  createdAt: string;
  items: ReturnItem[];
  createdBy?: { name: string };
  approvedBy?: { name: string };
  invoice?: { invoiceNo: string };
  supplier?: { name: string };
}

type ReturnFormItem = {
  productId: string;
  productName: string;
  batchId: string;
  batchNo: string;
  quantity: number;
  unitPrice: number;
};

const formatPackQuantity = (quantity: number) => {
  return `${Math.max(0, Math.floor(Number(quantity || 0)))} ед.`;
};

const STATUS_STYLES: Record<string, string> = {
  DRAFT: 'bg-amber-100 text-amber-700',
  APPROVED: 'bg-blue-100 text-blue-700',
  COMPLETED: 'bg-emerald-100 text-emerald-700',
  REJECTED: 'bg-red-100 text-red-700',
};

const getReturnItemTotal = (item: ReturnItem) => Number(item.quantity || 0) * Number(item.unitPrice || 0);

const getReturnTotal = (ret: Return) => {
  const itemsTotal = ret.items.reduce((sum, item) => sum + getReturnItemTotal(item), 0);
  return Math.max(Number(ret.totalAmount || 0), itemsTotal);
};

function CreateReturnModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { t } = useTranslation();
  const { products, suppliers } = usePharmacy();
  const currencyCode = useCurrencyCode();
  const [type, setType] = useState<'CUSTOMER' | 'SUPPLIER'>('CUSTOMER');
  const [customerName, setCustomerName] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [refundMethod, setRefundMethod] = useState('CASH');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [formItems, setFormItems] = useState<ReturnFormItem[]>([
    { productId: '', productName: '', batchId: '', batchNo: '', quantity: 1, unitPrice: 0 },
  ]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) {
      setType('CUSTOMER');
      setCustomerName('');
      setSupplierId('');
      setRefundMethod('CASH');
      setReason('');
      setNote('');
      setFormItems([{ productId: '', productName: '', batchId: '', batchNo: '', quantity: 1, unitPrice: 0 }]);
      setError('');
    }
  }, [open]);

  const updateItem = (idx: number, field: keyof ReturnFormItem, value: string | number) => {
    setFormItems((prev) => {
      const next = [...prev];
      if (field === 'productId') {
        const prod = products.find((p) => p.id === value);
        next[idx] = {
          ...next[idx],
          productId: String(value),
          productName: prod?.name ?? '',
          batchId: '',
          batchNo: '',
          unitPrice: type === 'SUPPLIER' ? Number(prod?.costPrice || 0) : Number(prod?.sellingPrice || 0),
        };
      } else if (field === 'batchId') {
        const prod = products.find((p) => p.id === next[idx].productId);
        const batch = prod?.batches?.find((b) => b.id === value);
        next[idx] = { ...next[idx], batchId: String(value), batchNo: batch?.batchNumber ?? '' };
      } else {
        (next[idx] as any)[field] = value;
      }
      return next;
    });
  };

  const addItem = () =>
    setFormItems((prev) => [...prev, { productId: '', productName: '', batchId: '', batchNo: '', quantity: 1, unitPrice: 0 }]);

  const removeItem = (idx: number) => setFormItems((prev) => prev.filter((_, i) => i !== idx));

  const formTotal = useMemo(() => formItems.reduce((sum, item) => sum + Number(item.quantity || 0) * Number(item.unitPrice || 0), 0), [formItems]);

  const updateItemPackaging = (idx: number, boxesValue: string, unitsValue: string) => {
    setFormItems((prev) => {
      const next = [...prev];
      next[idx] = {
        ...next[idx],
        quantity: Math.max(1, Math.floor(Number(unitsValue) || 0)),
      };
      return next;
    });
  };

  const handleSubmit = async () => {
    if (formItems.some((it) => !it.productId || it.quantity <= 0)) {
      setError(t('All items need a product and valid quantity'));
      return;
    }
    if (type === 'SUPPLIER' && !supplierId) {
      setError('Выберите поставщика для возврата');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const res = await fetch('/api/returns', {
        method: 'POST',
        headers: await buildApiHeaders(),
        body: JSON.stringify({
          type,
          customerName: type === 'CUSTOMER' ? customerName : undefined,
          supplierId: type === 'SUPPLIER' ? supplierId : undefined,
          refundMethod: type === 'CUSTOMER' ? refundMethod : undefined,
          reason,
          note,
          items: formItems.map((it) => ({
            productId: it.productId,
            batchId: it.batchId || undefined,
            quantity: it.quantity,
            unitPrice: it.unitPrice || undefined,
          })),
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || 'Failed to create return');
      }
      onCreated();
      onClose();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <AppModal
      open={open}
      title={t('New Return')}
      tone="neutral"
      size="xl"
      onClose={onClose}
      footer={
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-3 rounded-2xl border border-[#5A5A40]/20 text-[#5A5A40] text-sm font-semibold hover:bg-[#f5f5f0] transition-all"
          >
            {t('Cancel')}
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="flex-1 py-3 rounded-2xl bg-[#5A5A40] text-white text-sm font-semibold hover:bg-[#4A4A30] transition-all disabled:opacity-50"
          >
            {submitting ? t('Saving...') : t('Create Return')}
          </button>
        </div>
      }
    >
      <div className="space-y-5">
          {/* Type */}
          <div className="flex gap-3">
            {(['CUSTOMER', 'SUPPLIER'] as const).map((t_) => (
              <button
                key={t_}
                onClick={() => setType(t_)}
                className={`flex-1 py-3 rounded-2xl text-sm font-semibold border transition-all ${
                  type === t_ ? 'bg-[#5A5A40] text-white border-[#5A5A40]' : 'bg-white text-[#5A5A40]/60 border-[#5A5A40]/20 hover:bg-[#f5f5f0]'
                }`}
              >
                {t_ === 'CUSTOMER' ? t('Customer Return') : t('Supplier Return')}
              </button>
            ))}
          </div>

          {type === 'CUSTOMER' && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-semibold text-[#5A5A40]/60 uppercase tracking-widest mb-1 block">{t('Customer Name')}</label>
                <input
                  className="w-full px-4 py-2.5 border border-[#5A5A40]/10 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#5A5A40]/20"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder={t('Optional')}
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-[#5A5A40]/60 uppercase tracking-widest mb-1 block">{t('Refund Method')}</label>
                <select
                  className="w-full px-4 py-2.5 border border-[#5A5A40]/10 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#5A5A40]/20 bg-white"
                  value={refundMethod}
                  onChange={(e) => setRefundMethod(e.target.value)}
                >
                  <option value="CASH">{t('Cash')}</option>
                  <option value="CARD">{t('Card')}</option>
                  <option value="STORE_BALANCE">{t('Store Balance')}</option>
                </select>
              </div>
            </div>
          )}

          {type === 'SUPPLIER' && (
            <div>
              <label className="text-xs font-semibold text-[#5A5A40]/60 uppercase tracking-widest mb-1 block">Поставщик</label>
              <select
                className="w-full px-4 py-2.5 border border-[#5A5A40]/10 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#5A5A40]/20 bg-white"
                value={supplierId}
                onChange={(e) => setSupplierId(e.target.value)}
              >
                <option value="">Выберите поставщика</option>
                {suppliers.map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>{supplier.name}</option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="text-xs font-semibold text-[#5A5A40]/60 uppercase tracking-widest mb-1 block">{t('Reason')}</label>
            <input
              className="w-full px-4 py-2.5 border border-[#5A5A40]/10 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#5A5A40]/20"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t('Describe the return reason')}
            />
          </div>

          {/* Items */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <label className="text-xs font-semibold text-[#5A5A40]/60 uppercase tracking-widest">{t('Items')}</label>
              <button onClick={addItem} className="text-xs text-[#5A5A40] font-semibold flex items-center gap-1 hover:underline">
                <Plus size={14} /> {t('Add Item')}
              </button>
            </div>
            <div className="space-y-3">
              {formItems.map((item, idx) => {
                const selProd = products.find((p) => p.id === item.productId);
                return (
                  <div key={idx} className="grid grid-cols-12 gap-2 items-center bg-[#f5f5f0] rounded-xl p-3">
                    <div className="col-span-4">
                      <select
                        className="w-full px-3 py-2 border border-[#5A5A40]/10 rounded-lg text-sm bg-white outline-none"
                        value={item.productId}
                        onChange={(e) => updateItem(idx, 'productId', e.target.value)}
                      >
                        <option value="">{t('Select product')}</option>
                        {products.map((p) => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                    </div>
                    <div className="col-span-3">
                      <select
                        className="w-full px-3 py-2 border border-[#5A5A40]/10 rounded-lg text-sm bg-white outline-none"
                        value={item.batchId}
                        onChange={(e) => updateItem(idx, 'batchId', e.target.value)}
                        disabled={!selProd}
                      >
                        <option value="">{t('Batch (opt.)')}</option>
                        {selProd?.batches?.map((b) => (
                          <option key={b.id} value={b.id}>{b.batchNumber} ({formatPackQuantity(b.quantity)})</option>
                        ))}
                      </select>
                    </div>
                    <div className="col-span-2 space-y-1">
                      <input
                        type="number"
                        min={1}
                        className="w-full px-3 py-2 border border-[#5A5A40]/10 rounded-lg text-sm bg-white outline-none"
                        value={item.quantity}
                        onChange={(e) => updateItemPackaging(idx, '0', e.target.value)}
                        placeholder={t('Qty')}
                      />
                      <p className="text-[10px] text-[#5A5A40]/55 leading-tight">Количество в единицах</p>
                    </div>
                    <div className="col-span-2">
                      <input
                        type="number"
                        min={0}
                        className="w-full px-3 py-2 border border-[#5A5A40]/10 rounded-lg text-sm bg-white outline-none"
                        value={item.unitPrice || ''}
                        onChange={(e) => updateItem(idx, 'unitPrice', Number(e.target.value))}
                        placeholder={t('Price')}
                      />
                    </div>
                    <div className="col-span-1 flex justify-center">
                      {formItems.length > 1 && (
                        <button onClick={() => removeItem(idx)} className="text-red-400 hover:text-red-600 transition-colors">
                          <XCircle size={18} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="rounded-2xl bg-[#f5f5f0] px-4 py-3 grid grid-cols-1 md:grid-cols-3 gap-3 text-sm text-[#5A5A40]">
            <div>
              <p className="text-[10px] uppercase tracking-widest text-[#5A5A40]/45 font-bold">Тип операции</p>
              <p className="font-bold mt-1">{type === 'CUSTOMER' ? 'Возврат покупателя' : 'Возврат поставщику'}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-widest text-[#5A5A40]/45 font-bold">Позиции</p>
              <p className="font-bold mt-1">{formItems.length}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-widest text-[#5A5A40]/45 font-bold">Автоитог</p>
              <p className="font-bold mt-1">{formTotal.toFixed(2)} {currencyCode}</p>
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-[#5A5A40]/60 uppercase tracking-widest mb-1 block">{t('Note')}</label>
            <textarea
              className="w-full px-4 py-2.5 border border-[#5A5A40]/10 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#5A5A40]/20 resize-none"
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t('Optional additional notes')}
            />
          </div>

          {error && <p className="text-red-500 text-sm font-medium">{error}</p>}
        </div>
    </AppModal>
  );
}

export const ReturnView: React.FC = () => {
  const { t } = useTranslation();
  const currencyCode = useCurrencyCode();
  const { refreshProducts } = usePharmacy();
  const [returns, setReturns] = useState<Return[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [actionPending, setActionPending] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<'ALL' | 'CUSTOMER' | 'SUPPLIER'>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'DRAFT' | 'COMPLETED' | 'REJECTED'>('ALL');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/returns', { headers: await buildApiHeaders() });
      if (res.ok) setReturns(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const approve = async (id: string) => {
    setActionPending(id);
    try {
      const res = await fetch(`/api/returns/${id}/approve`, { method: 'PUT', headers: await buildApiHeaders() });
      if (res.ok) {
        await runRefreshTasks(load, refreshProducts);
      }
    } finally {
      setActionPending(null);
    }
  };

  const reject = async (id: string) => {
    setActionPending(id);
    try {
      const res = await fetch(`/api/returns/${id}/reject`, { method: 'PUT', headers: await buildApiHeaders() });
      if (res.ok) load();
    } finally {
      setActionPending(null);
    }
  };

  const filteredReturns = useMemo(() => {
    return returns.filter((ret) => {
      const matchesType = typeFilter === 'ALL' || ret.type === typeFilter;
      const matchesStatus = statusFilter === 'ALL' || ret.status === statusFilter;
      return matchesType && matchesStatus;
    });
  }, [returns, typeFilter, statusFilter]);

  const overallAmount = useMemo(() => filteredReturns.reduce((sum, ret) => sum + getReturnTotal(ret), 0), [filteredReturns]);
  const overallQuantity = useMemo(() => filteredReturns.reduce((sum, ret) => sum + ret.items.reduce((itemsSum, item) => itemsSum + Number(item.quantity || 0), 0), 0), [filteredReturns]);
  const moneyLabel = useCallback((label: string) => `${label} (${currencyCode})`, [currencyCode]);

  const printReturn = (ret: Return) => {
    const html = `<!doctype html>
<html lang="ru">
<head>
  <meta charset="UTF-8" />
  <title>${ret.type === 'SUPPLIER' ? 'Возврат поставщику' : 'Возврат покупателя'} ${ret.returnNo}</title>
  <style>
    body { font-family: Segoe UI, Arial, sans-serif; margin: 24px; color: #1f2937; }
    h1 { margin: 0 0 6px; font-size: 22px; }
    .muted { color: #6b7280; font-size: 12px; margin-bottom: 16px; }
    table { width: 100%; border-collapse: collapse; margin-top: 16px; }
    th, td { border-bottom: 1px solid #e5e7eb; padding: 8px 10px; text-align: left; font-size: 12px; }
    th { color: #6b7280; text-transform: uppercase; font-size: 10px; letter-spacing: .08em; }
    .right { text-align: right; }
    .total { margin-top: 16px; text-align: right; font-weight: 700; font-size: 18px; }
  </style>
</head>
<body>
  <h1>${ret.type === 'SUPPLIER' ? 'Возврат поставщику' : 'Возврат покупателя'}</h1>
  <div class="muted">Номер: ${ret.returnNo} · Дата: ${new Date(ret.createdAt).toLocaleString('ru-RU')} · ${ret.supplier?.name || ret.customerName || '-'}</div>
  <table>
    <thead>
      <tr>
        <th>Товар</th>
        <th>Партия</th>
        <th class="right">Кол-во</th>
        <th class="right">${moneyLabel('Цена')}</th>
        <th class="right">${moneyLabel('Сумма')}</th>
      </tr>
    </thead>
    <tbody>
      ${ret.items.map((item) => `
        <tr>
          <td>${item.product?.name ?? '-'}</td>
          <td>${item.batch?.batchNumber ?? '—'}</td>
          <td class="right">${formatPackQuantity(item.quantity)}</td>
          <td class="right">${Number(item.unitPrice || 0).toFixed(2)}</td>
          <td class="right">${getReturnItemTotal(item).toFixed(2)}</td>
        </tr>
      `).join('')}
    </tbody>
  </table>
  <div class="total">${moneyLabel('Итого')}: ${getReturnTotal(ret).toFixed(2)} ${currencyCode}</div>
</body>
</html>`;

    const printWindow = window.open('', '_blank', 'width=980,height=760');
    if (!printWindow) return;
    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.focus();
  };

  const statusIcon = (status: string) => {
    if (status === 'COMPLETED') return <CheckCircle2 size={14} />;
    if (status === 'REJECTED') return <XCircle size={14} />;
    return <Clock size={14} />;
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="rounded-[30px] border border-white/70 bg-white/80 p-4 shadow-[0_18px_45px_rgba(90,90,64,0.08)] backdrop-blur-md md:p-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center rounded-full bg-[#f1eee3] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-[#5A5A40]/55">
              Корректировка остатков
            </span>
            <span className="inline-flex items-center rounded-full bg-white px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-[#5A5A40]/45 border border-[#5A5A40]/10">
              Покупатели и поставщики
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-3">
          <button onClick={load} className="p-3 bg-white rounded-2xl border border-[#5A5A40]/10 text-[#5A5A40]/60 hover:text-[#5A5A40] transition-all shadow-sm">
            <RefreshCw size={18} />
          </button>
          <button
            onClick={() => setIsModalOpen(true)}
            className="bg-[#5A5A40] text-white px-6 py-3 rounded-2xl font-medium shadow-lg hover:bg-[#4A4A30] transition-all flex items-center gap-2"
          >
            <Plus size={20} /> {t('New Return')}
          </button>
        </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl border border-[#5A5A40]/10 px-5 py-4 shadow-sm hover:-translate-y-0.5 hover:shadow-md transition-all">
          <p className="text-xs uppercase tracking-widest text-[#5A5A40]/45 font-bold">Общая сумма</p>
          <p className="text-2xl font-bold text-[#5A5A40] mt-2">{overallAmount.toFixed(2)} {currencyCode}</p>
        </div>
        <div className="bg-white rounded-2xl border border-[#5A5A40]/10 px-5 py-4 shadow-sm hover:-translate-y-0.5 hover:shadow-md transition-all">
          <p className="text-xs uppercase tracking-widest text-[#5A5A40]/45 font-bold">Итого возвратов</p>
          <p className="text-2xl font-bold text-[#5A5A40] mt-2">{filteredReturns.length}</p>
        </div>
        <div className="bg-white rounded-2xl border border-[#5A5A40]/10 px-5 py-4 shadow-sm hover:-translate-y-0.5 hover:shadow-md transition-all">
          <p className="text-xs uppercase tracking-widest text-[#5A5A40]/45 font-bold">Итого единиц</p>
          <p className="text-2xl font-bold text-[#5A5A40] mt-2">{overallQuantity}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
        <div className="bg-white rounded-[26px] border border-[#5A5A40]/10 px-4 py-4 shadow-sm min-w-0">
          <p className="text-[10px] uppercase tracking-widest text-[#5A5A40]/45 font-bold mb-2">Тип возврата</p>
          <div className="flex gap-2 flex-wrap">
            {[
              { value: 'ALL', label: 'Все' },
              { value: 'CUSTOMER', label: 'От покупателя' },
              { value: 'SUPPLIER', label: 'Поставщику' },
            ].map((option) => (
              <button
                key={option.value}
                onClick={() => setTypeFilter(option.value as typeof typeFilter)}
                className={`px-4 py-2 rounded-xl text-sm font-medium border transition-all ${
                  typeFilter === option.value
                    ? 'bg-[#5A5A40] text-white border-[#5A5A40]'
                    : 'bg-[#f5f5f0] text-[#5A5A40] border-[#5A5A40]/10 hover:bg-[#ecebe5]'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <div className="bg-white rounded-[26px] border border-[#5A5A40]/10 px-4 py-4 shadow-sm min-w-0">
          <p className="text-[10px] uppercase tracking-widest text-[#5A5A40]/45 font-bold mb-2">Статус</p>
          <div className="flex gap-2 flex-wrap">
            {[
              { value: 'ALL', label: 'Все' },
              { value: 'DRAFT', label: 'Черновик' },
              { value: 'COMPLETED', label: 'Завершен' },
              { value: 'REJECTED', label: 'Отклонен' },
            ].map((option) => (
              <button
                key={option.value}
                onClick={() => setStatusFilter(option.value as typeof statusFilter)}
                className={`px-4 py-2 rounded-xl text-sm font-medium border transition-all ${
                  statusFilter === option.value
                    ? 'bg-[#5A5A40] text-white border-[#5A5A40]'
                    : 'bg-[#f5f5f0] text-[#5A5A40] border-[#5A5A40]/10 hover:bg-[#ecebe5]'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-[#5A5A40]" /></div>
      ) : filteredReturns.length === 0 ? (
        <div className="text-center py-20 text-[#5A5A40]/40">
          <Package size={48} className="mx-auto mb-4 opacity-30" />
          <p className="text-lg font-medium">Нет возвратов по выбранным фильтрам</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredReturns.map((ret) => {
            const returnTotal = getReturnTotal(ret);
            const returnQuantity = ret.items.reduce((sum, item) => sum + Number(item.quantity || 0), 0);

            return (
            <div key={ret.id} className="bg-white rounded-2xl shadow-sm border border-[#5A5A40]/5 overflow-hidden">
              <div
                className="flex items-center justify-between px-6 py-4 cursor-pointer hover:bg-[#f5f5f0]/50 transition-colors"
                onClick={() => setExpandedId(expandedId === ret.id ? null : ret.id)}
              >
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-2xl bg-[#f5f5f0] flex items-center justify-center">
                    <Package size={18} className="text-[#5A5A40]/50" />
                  </div>
                  <div>
                    <p className="font-semibold text-[#151619]">{ret.returnNo}</p>
                      <p className="text-xs text-[#5A5A40]/50 mt-0.5">
                      {ret.type === 'CUSTOMER' ? 'Возврат покупателя' : t('Supplier Return')}
                      {ret.customerName && ` · ${ret.customerName}`}
                      {ret.supplier?.name && ` · ${ret.supplier.name}`}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <p className="text-[10px] uppercase tracking-widest text-[#5A5A40]/40 font-bold">Сумма</p>
                    <p className="text-sm font-bold text-[#5A5A40]">{returnTotal.toFixed(2)} {currencyCode}</p>
                  </div>
                  <div className="text-right min-w-16">
                    <p className="text-[10px] uppercase tracking-widest text-[#5A5A40]/40 font-bold">Итого</p>
                    <p className="text-sm font-bold text-[#5A5A40]">{returnQuantity}</p>
                  </div>
                  <span className="text-xs text-[#5A5A40]/40">{new Date(ret.createdAt).toLocaleDateString()}</span>
                  <span className={`flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold ${STATUS_STYLES[ret.status] ?? ''}`}>
                    {statusIcon(ret.status)} {t(ret.status)}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      printReturn(ret);
                    }}
                    className="p-2 rounded-xl border border-[#5A5A40]/10 text-[#5A5A40]/60 hover:text-[#5A5A40] hover:bg-[#f5f5f0] transition-all"
                    title="Печать возврата"
                  >
                    <Printer size={16} />
                  </button>
                  {ret.status === 'DRAFT' && (
                    <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => approve(ret.id)}
                        disabled={!!actionPending}
                        className="px-4 py-1.5 bg-emerald-500 text-white text-xs font-semibold rounded-xl hover:bg-emerald-600 transition-all disabled:opacity-50"
                      >
                        {t('Approve')}
                      </button>
                      <button
                        onClick={() => reject(ret.id)}
                        disabled={!!actionPending}
                        className="px-4 py-1.5 bg-red-500 text-white text-xs font-semibold rounded-xl hover:bg-red-600 transition-all disabled:opacity-50"
                      >
                        {t('Reject')}
                      </button>
                    </div>
                  )}
                  {expandedId === ret.id ? <ChevronUp size={16} className="text-[#5A5A40]/40" /> : <ChevronDown size={16} className="text-[#5A5A40]/40" />}
                </div>
              </div>

              {expandedId === ret.id && (
                <div className="px-6 pb-4 border-t border-[#5A5A40]/5">
                  {ret.reason && <p className="text-sm text-[#5A5A40]/60 py-3">{t('Reason')}: {ret.reason}</p>}
                  <table className="w-full mt-2 text-sm">
                    <thead>
                      <tr className="text-xs text-[#5A5A40]/40 uppercase tracking-widest">
                        <th className="text-left py-2">{t('Product')}</th>
                        <th className="text-left py-2">{t('Batch')}</th>
                        <th className="text-right py-2">{t('Qty')}</th>
                        <th className="text-right py-2">{moneyLabel(t('Unit Price'))}</th>
                        <th className="text-right py-2">{moneyLabel('Сумма')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ret.items.map((item) => (
                        <tr key={item.id} className="border-t border-[#5A5A40]/5">
                          <td className="py-2 font-medium">{item.product?.name ?? t('Unknown')}</td>
                          <td className="py-2 text-[#5A5A40]/60">{item.batch?.batchNumber ?? '—'}</td>
                          <td className="py-2 text-right">{formatPackQuantity(item.quantity)}</td>
                          <td className="py-2 text-right">{item.unitPrice ? item.unitPrice.toFixed(2) : '—'}</td>
                          <td className="py-2 text-right font-semibold text-[#5A5A40]">{getReturnItemTotal(item).toFixed(2)}</td>
                        </tr>
                      ))}
                      <tr className="border-t border-[#5A5A40]/10 bg-[#f5f5f0]/35">
                        <td colSpan={2} className="py-3 text-xs uppercase tracking-widest font-bold text-[#5A5A40]/55">Итого</td>
                        <td className="py-3 text-right font-bold text-[#5A5A40]">{returnQuantity}</td>
                        <td className="py-3 text-right text-[#5A5A40]/50">—</td>
                        <td className="py-3 text-right font-bold text-[#5A5A40]">{returnTotal.toFixed(2)} {currencyCode}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )})}
        </div>
      )}

      <CreateReturnModal open={isModalOpen} onClose={() => setIsModalOpen(false)} onCreated={load} />
    </div>
  );
};
