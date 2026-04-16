import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { usePharmacy } from '../context';
import { buildApiHeaders } from '../../infrastructure/api';
import { formatProductDisplayName } from '../../lib/productDisplay';
import { useCurrencyCode } from '../../lib/useCurrencyCode';
import { runRefreshTasks } from '../../lib/utils';
import { 
  Plus, CheckCircle2, XCircle, Clock, RefreshCw, ChevronDown, ChevronUp, Package, Printer,
  Store, Truck, ClipboardList, Filter, CalendarDays
} from 'lucide-react';
import { AppModal } from './AppModal';
import { DateRangeFilter, ReportRangePreset } from './common/DateRangeFilter';
import { getPresetDates } from './common/dateUtils';

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
  type: 'RETAIL' | 'SUPPLIER';
  status: 'DRAFT' | 'APPROVED' | 'REJECTED' | 'COMPLETED';
  totalAmount?: number | null;
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
  DRAFT: 'bg-amber-50 text-amber-600 border-amber-100',
  APPROVED: 'bg-blue-50 text-blue-600 border-blue-100',
  COMPLETED: 'bg-emerald-50 text-emerald-600 border-emerald-100',
  REJECTED: 'bg-red-50 text-red-600 border-red-100',
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
  const { products, suppliers, refreshProducts, refreshSuppliers } = usePharmacy();
  const currencyCode = useCurrencyCode();
  const getProductDisplayLabel = useCallback((productId?: string, fallbackName?: string) => {
    const baseName = String(fallbackName || '').trim() || '-';
    if (!productId) return baseName;
    const product = products.find((entry) => entry.id === productId);
    return formatProductDisplayName({
      name: baseName,
      countryOfOrigin: product?.countryOfOrigin,
    }, { includeCountry: true });
  }, [products]);
  const [type, setType] = useState<'RETAIL' | 'SUPPLIER'>('RETAIL');
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
      setType('RETAIL');
      setSupplierId('');
      setRefundMethod('CASH');
      setReason('');
      setNote('');
      setFormItems([{ productId: '', productName: '', batchId: '', batchNo: '', quantity: 1, unitPrice: 0 }]);
      setError('');
    }
  }, [open]);

  useEffect(() => {
    if (!open || suppliers.length > 0) return;
    void refreshSuppliers();
  }, [open, refreshSuppliers, suppliers.length]);

  useEffect(() => {
    if (!open || products.length > 0) return;
    void refreshProducts();
  }, [open, products.length, refreshProducts]);

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
          refundMethod: type === 'RETAIL' ? refundMethod : undefined,
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
            className="flex-1 py-3 rounded-2xl border border-[#5A5A40]/20 text-[#5A5A40] text-sm font-normal hover:bg-[#f5f5f0] transition-all"
          >
            {t('Cancel')}
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="flex-1 py-3 rounded-2xl bg-[#5A5A40] text-white text-sm font-normal hover:bg-[#4A4A30] transition-all disabled:opacity-50"
          >
            {submitting ? t('Saving...') : t('Create Return')}
          </button>
        </div>
      }
    >
      <div className="space-y-5">
          <div className="flex gap-3">
            {(['RETAIL', 'SUPPLIER'] as const).map((t_) => (
              <button
                key={t_}
                onClick={() => setType(t_)}
                className={`flex-1 py-3 rounded-2xl text-sm font-normal border transition-all ${
                  type === t_ ? 'bg-[#5A5A40] text-white border-[#5A5A40]' : 'bg-white text-[#5A5A40]/60 border-[#5A5A40]/20 hover:bg-[#f5f5f0]'
                }`}
              >
                {t_ === 'RETAIL' ? 'Розничный возврат' : 'Возврат поставщику'}
              </button>
            ))}
          </div>

          {type === 'RETAIL' && (
            <div className="grid grid-cols-1 gap-4">
              <div>
                <label className="text-[10px] font-normal text-[#5A5A40]/60 uppercase tracking-widest mb-1 block">{t('Refund Method')}</label>
                <select
                  className="w-full px-4 py-2.5 border border-[#5A5A40]/10 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#5A5A40]/20 bg-white font-normal"
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
              <label className="text-[10px] font-normal text-[#5A5A40]/60 uppercase tracking-widest mb-1 block">Поставщик</label>
              <select
                className="w-full px-4 py-2.5 border border-[#5A5A40]/10 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#5A5A40]/20 bg-white font-normal"
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
            <label className="text-[10px] font-normal text-[#5A5A40]/60 uppercase tracking-widest mb-1 block">{t('Reason')}</label>
            <input
              className="w-full px-4 py-2.5 border border-[#5A5A40]/10 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#5A5A40]/20 font-normal"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t('Describe the return reason')}
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-3">
              <label className="text-[10px] font-normal text-[#5A5A40]/60 uppercase tracking-widest">{t('Items')}</label>
              <button onClick={addItem} className="text-xs text-[#5A5A40] font-normal flex items-center gap-1 hover:underline">
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
                        className="w-full px-3 py-2 border border-[#5A5A40]/10 rounded-lg text-sm bg-white outline-none font-normal"
                        value={item.productId}
                        onChange={(e) => updateItem(idx, 'productId', e.target.value)}
                      >
                        <option value="">{t('Select product')}</option>
                        {products.map((p) => (
                          <option key={p.id} value={p.id}>{getProductDisplayLabel(p.id, p.name)}</option>
                        ))}
                      </select>
                    </div>
                    <div className="col-span-3">
                      <select
                        className="w-full px-3 py-2 border border-[#5A5A40]/10 rounded-lg text-sm bg-white outline-none font-normal"
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
                        className="w-full px-3 py-2 border border-[#5A5A40]/10 rounded-lg text-sm bg-white outline-none font-normal"
                        value={item.quantity}
                        onChange={(e) => updateItemPackaging(idx, '0', e.target.value)}
                        placeholder={t('Qty')}
                      />
                      <p className="text-[10px] text-[#5A5A40]/55 leading-tight font-normal">Кол-во в ед.</p>
                    </div>
                    <div className="col-span-2">
                      <input
                        type="number"
                        min={0}
                        className="w-full px-3 py-2 border border-[#5A5A40]/10 rounded-lg text-sm bg-white outline-none font-normal"
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
              <p className="text-[10px] uppercase tracking-widest text-[#5A5A40]/45 font-normal">Тип операции</p>
              <p className="font-normal mt-1">{type === 'RETAIL' ? 'Розничный возврат' : 'Возврат поставщику'}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-widest text-[#5A5A40]/45 font-normal">Позиции</p>
              <p className="font-normal mt-1">{formItems.length}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-widest text-[#5A5A40]/45 font-normal">Автоитог</p>
              <p className="font-normal mt-1">{formTotal.toFixed(2)} {currencyCode}</p>
            </div>
          </div>

          <div>
            <label className="text-[10px] font-normal text-[#5A5A40]/60 uppercase tracking-widest mb-1 block">{t('Note')}</label>
            <textarea
              className="w-full px-4 py-2.5 border border-[#5A5A40]/10 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#5A5A40]/20 resize-none font-normal"
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t('Optional additional notes')}
            />
          </div>

          {error && <p className="text-red-500 text-sm font-normal">{error}</p>}
        </div>
    </AppModal>
  );
}

export const ReturnView: React.FC = () => {
  const { t } = useTranslation();
  const currencyCode = useCurrencyCode();
  const { products, refreshProducts } = usePharmacy();
  const [returns, setReturns] = useState<Return[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [actionPending, setActionPending] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<'ALL' | 'RETAIL' | 'SUPPLIER'>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'DRAFT' | 'COMPLETED' | 'REJECTED'>('ALL');
  const [preset, setPreset] = useState<ReportRangePreset>('month');
  
  const initialDates = getPresetDates('month');
  const [fromDate, setFromDate] = useState(initialDates.from);
  const [toDate, setToDate] = useState(initialDates.to);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const q = new URLSearchParams();
      if (fromDate) q.set('from', fromDate);
      if (toDate) q.set('to', toDate);
      const res = await fetch(`/api/returns?${q.toString()}`, { headers: await buildApiHeaders() });
      if (res.ok) setReturns(await res.json());
    } finally {
      setLoading(false);
    }
  }, [fromDate, toDate]);

  useEffect(() => {
    if (preset === 'custom') return;
    const { from, to } = getPresetDates(preset);
    setFromDate(from);
    setToDate(to);
  }, [preset]);

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
  const getProductDisplayLabel = useCallback((productId?: string, fallbackName?: string) => {
    const baseName = String(fallbackName || '-').trim() || '-';
    if (!productId) return baseName;
    const product = products.find((entry) => entry.id === productId);
    return formatProductDisplayName({
      name: baseName,
      countryOfOrigin: product?.countryOfOrigin,
    }, { includeCountry: true });
  }, [products]);

  const printReturn = (ret: Return) => {
    const html = `<!doctype html>
<html lang="ru">
<head>
  <meta charset="UTF-8" />
  <title>${ret.type === 'SUPPLIER' ? 'Возврат поставщику' : 'Розничный возврат'} ${ret.returnNo}</title>
  <style>
    body { font-family: Segoe UI, sans-serif; margin: 0; background: #6b7280; display: flex; justify-content: center; padding: 40px 20px; color: #1f2937; }
    .sheet { width: 100%; max-width: 800px; background: #fff; padding: 40px; border-radius: 8px; box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1); }
    h1 { margin: 0 0 6px; font-size: 24px; color: #111827; }
    .muted { color: #6b7280; font-size: 14px; margin-bottom: 24px; }
    table { width: 100%; border-collapse: collapse; margin-top: 24px; }
    th, td { border-bottom: 1px solid #e5e7eb; padding: 12px 10px; text-align: left; font-size: 14px; }
    th { color: #6b7280; text-transform: uppercase; font-size: 11px; letter-spacing: .08em; font-weight: 600; }
    .right { text-align: right; }
    .total { margin-top: 30px; text-align: right; font-weight: 700; font-size: 20px; color: #111827; }
    @media print { 
      .print-btn { display: none; } 
      body { background: none; padding: 0; display: block; }
      .sheet { box-shadow: none; border-radius: 0; max-width: none; padding: 0; } 
    }
    .print-btn {
      position: fixed;
      top: 20px;
      right: 20px;
      padding: 10px 24px;
      background: #5A5A40;
      color: white;
      border: none;
      border-radius: 12px;
      cursor: pointer;
      font-family: sans-serif;
      font-weight: 700;
      box-shadow: 0 4px 6px rgba(0,0,0,0.1);
      z-index: 100;
    }
  </style>
</head>
<body>
  <button class="print-btn" onclick="window.print()">ПЕЧАТАТЬ</button>
  <div class="sheet">
    <h1>${ret.type === 'SUPPLIER' ? 'Возврат поставщику' : 'Розничный возврат'} ${ret.returnNo}</h1>
    <div class="muted">Номер: ${ret.returnNo} · Дата: ${new Date(ret.createdAt).toLocaleString('ru-RU')} · ${ret.supplier?.name || 'Розничная операция'}</div>
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
            <td>${getProductDisplayLabel(item.productId, item.product?.name ?? '-')}</td>
            <td>${item.batch?.batchNumber ?? '—'}</td>
            <td class="right">${formatPackQuantity(item.quantity)}</td>
            <td class="right">${Number(item.unitPrice || 0).toFixed(2)}</td>
            <td class="right">${getReturnItemTotal(item).toFixed(2)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    <div class="total">${moneyLabel('Итого')}: ${getReturnTotal(ret).toFixed(2)} ${currencyCode}</div>
  </div>
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
            <span className="inline-flex items-center rounded-full bg-[#f1eee3] px-3 py-1 text-[10px] font-normal uppercase tracking-[0.2em] text-[#5A5A40]/55">
              Корректировка остатков
            </span>
            <span className="inline-flex items-center rounded-full bg-white px-3 py-1 text-[10px] font-normal uppercase tracking-[0.2em] text-[#5A5A40]/45 border border-[#5A5A40]/10">
              Покупатели и поставщики
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-3">
          <button onClick={load} className="p-3 bg-white rounded-2xl border border-[#5A5A40]/10 text-[#5A5A40]/60 hover:text-[#5A5A40] transition-all shadow-sm">
            <RefreshCw size={18} />
          </button>
          <button
            onClick={() => setIsModalOpen(true)}
            className="bg-[#5A5A40] text-white px-6 py-3 rounded-2xl font-normal shadow-lg hover:bg-[#4A4A30] transition-all flex items-center gap-2"
          >
            <Plus size={20} /> {t('New Return')}
          </button>
        </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl border border-[#5A5A40]/10 px-5 py-4 shadow-sm hover:-translate-y-0.5 transition-all group">
          <p className="text-[10px] uppercase tracking-widest text-[#5A5A40]/45 font-normal">Общая сумма</p>
          <p className="text-2xl font-normal text-[#5A5A40] mt-1 group-hover:tracking-tight transition-all">{overallAmount.toFixed(2)} {currencyCode}</p>
        </div>
        <div className="bg-white rounded-2xl border border-[#5A5A40]/10 px-5 py-4 shadow-sm hover:-translate-y-0.5 transition-all group">
          <p className="text-[10px] uppercase tracking-widest text-[#5A5A40]/45 font-normal">Итого возвратов</p>
          <p className="text-2xl font-normal text-[#5A5A40] mt-1 group-hover:tracking-tight transition-all">{filteredReturns.length}</p>
        </div>
        <div className="bg-white rounded-2xl border border-[#5A5A40]/10 px-5 py-4 shadow-sm hover:-translate-y-0.5 transition-all group">
          <p className="text-[10px] uppercase tracking-widest text-[#5A5A40]/45 font-normal">Итого единиц</p>
          <p className="text-2xl font-normal text-[#5A5A40] mt-1 group-hover:tracking-tight transition-all">{overallQuantity}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-3 space-y-6">
          <DateRangeFilter
            preset={preset}
            setPreset={setPreset}
            fromDate={fromDate}
            setFromDate={(d) => { setFromDate(d); setPreset('custom'); }}
            toDate={toDate}
            setToDate={(d) => { setToDate(d); setPreset('custom'); }}
            onRefresh={load}
          />

          <div className="space-y-4">
            <div className="flex items-center gap-2 px-2">
              <Filter size={14} className="text-[#5A5A40]/40" />
              <span className="text-[10px] uppercase tracking-[0.2em] text-[#5A5A40]/40 font-normal">Параметры фильтрации</span>
            </div>
            
            <div className="bg-white rounded-[26px] border border-[#5A5A40]/10 p-4 shadow-sm space-y-6">
              {/* Type Filter */}
              <div className="space-y-3">
                <p className="text-[10px] uppercase tracking-widest text-[#5A5A40]/45 font-normal px-1">Тип возврата</p>
                <div className="flex flex-col gap-1.5">
                  {[
                    { value: 'ALL', label: 'Все операции', icon: <ClipboardList size={14} /> },
                    { value: 'RETAIL', label: 'Розничный', icon: <Store size={14} /> },
                    { value: 'SUPPLIER', label: 'Поставщику', icon: <Truck size={14} /> },
                  ].map((option) => (
                    <button
                      key={option.value}
                      onClick={() => setTypeFilter(option.value as typeof typeFilter)}
                      className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs transition-all border ${
                        typeFilter === option.value
                          ? 'bg-[#5A5A40] text-white border-transparent shadow-md'
                          : 'bg-[#f5f5f0]/50 text-[#5A5A40]/60 border-transparent hover:bg-white hover:border-[#5A5A40]/10'
                      }`}
                    >
                      <span className={typeFilter === option.value ? 'text-white' : 'text-[#5A5A40]/40'}>
                        {option.icon}
                      </span>
                      <span className="font-normal">{option.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Status Filter */}
              <div className="space-y-3">
                <p className="text-[10px] uppercase tracking-widest text-[#5A5A40]/45 font-normal px-1">Статус документа</p>
                <div className="flex flex-col gap-1.5">
                  {[
                    { value: 'ALL', label: 'Любой статус', icon: <RefreshCw size={14} /> },
                    { value: 'DRAFT', label: 'Черновик', icon: <Clock size={14} /> },
                    { value: 'COMPLETED', label: 'Завершен', icon: <CheckCircle2 size={14} /> },
                    { value: 'REJECTED', label: 'Отклонен', icon: <XCircle size={14} /> },
                  ].map((option) => (
                    <button
                      key={option.value}
                      onClick={() => setStatusFilter(option.value as typeof statusFilter)}
                      className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs transition-all border ${
                        statusFilter === option.value
                          ? 'bg-[#5A5A40] text-white border-transparent shadow-md'
                          : 'bg-[#f5f5f0]/50 text-[#5A5A40]/60 border-transparent hover:bg-white hover:border-[#5A5A40]/10'
                      }`}
                    >
                      <span className={statusFilter === option.value ? 'text-white' : 'text-[#5A5A40]/40'}>
                        {option.icon}
                      </span>
                      <span className="font-normal">{option.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="lg:col-span-9">
          {loading ? (
             <div className="flex flex-col items-center justify-center py-24 bg-white rounded-3xl border border-[#5A5A40]/5 shadow-sm">
                <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-[#5A5A40]/30 mb-4" />
                <p className="text-xs text-[#5A5A40]/40 font-normal">Загружаем список возвратов...</p>
             </div>
          ) : filteredReturns.length === 0 ? (
            <div className="text-center py-24 bg-white rounded-[32px] border border-[#5A5A40]/5 shadow-sm text-[#5A5A40]/40">
              <Package size={40} className="mx-auto mb-4 opacity-10" />
              <p className="text-sm font-normal">Нет данных за выбранный период</p>
            </div>
          ) : (
            <div className="space-y-3">
          {filteredReturns.map((ret) => {
            const returnTotal = getReturnTotal(ret);
            const returnQuantity = ret.items.reduce((sum, item) => sum + Number(item.quantity || 0), 0);

            return (
            <div key={ret.id} className="bg-white/60 hover:bg-white rounded-3xl shadow-sm hover:shadow-xl hover:shadow-[#5A5A40]/5 border border-[#5A5A40]/5 overflow-hidden transition-all">
              <div
                className="flex items-center justify-between px-6 py-4 cursor-pointer"
                onClick={() => setExpandedId(expandedId === ret.id ? null : ret.id)}
              >
                <div className="flex items-center gap-5">
                  <div className="w-11 h-11 rounded-2xl bg-[#f5f5f0] flex items-center justify-center text-[#5A5A40]/40">
                    {ret.type === 'RETAIL' ? <Store size={20} /> : <Truck size={20} />}
                  </div>
                  <div>
                    <p className="font-normal text-[#151619] tracking-tight">{ret.returnNo}</p>
                      <p className="text-[11px] text-[#5A5A40]/45 mt-0.5">
                      {ret.type === 'RETAIL' ? 'Розничная операция' : 'Возврат поставщику'}
                      {ret.supplier?.name && ` · ${ret.supplier.name}`}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-6">
                  <div className="text-right">
                    <p className="text-[9px] uppercase tracking-widest text-[#5A5A40]/30 font-normal">Сумма</p>
                    <p className="text-sm font-normal text-[#5A5A40] mt-0.5">{returnTotal.toFixed(2)} {currencyCode}</p>
                  </div>
                  <div className="text-right min-w-[70px]">
                    <p className="text-[9px] uppercase tracking-widest text-[#5A5A40]/30 font-normal">Позиций</p>
                    <p className="text-sm font-normal text-[#5A5A40] mt-0.5">{ret.items.length}</p>
                  </div>
                  <div className="text-right min-w-[80px]">
                    <p className="text-[9px] uppercase tracking-widest text-[#5A5A40]/30 font-normal">Дата</p>
                    <p className="text-xs text-[#5A5A40]/40 mt-0.5 font-normal">{new Date(ret.createdAt).toLocaleDateString()}</p>
                  </div>
                  
                  <span className={`flex items-center gap-1.5 px-3 py-1.5 rounded-2xl text-[11px] font-normal border transition-all ${STATUS_STYLES[ret.status] ?? ''}`}>
                    {statusIcon(ret.status)} {t(ret.status)}
                  </span>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        printReturn(ret);
                      }}
                      className="p-2.5 rounded-xl border border-[#5A5A40]/5 text-[#5A5A40]/40 hover:text-[#5A5A40] hover:bg-white hover:border-[#5A5A40]/20 transition-all shadow-sm group/btn"
                      title="Печать возврата"
                    >
                      <Printer size={16} className="group-hover/btn:scale-110 transition-transform" />
                    </button>
                    
                    {ret.status === 'DRAFT' && (
                      <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => approve(ret.id)}
                          disabled={!!actionPending}
                          className="h-10 px-4 bg-emerald-500 text-white text-xs font-normal rounded-xl hover:bg-emerald-600 transition-all disabled:opacity-50 shadow-sm"
                        >
                          Одобрить
                        </button>
                        <button
                          onClick={() => reject(ret.id)}
                          disabled={!!actionPending}
                          className="h-10 px-4 bg-red-400 text-white text-xs font-normal rounded-xl hover:bg-red-500 transition-all disabled:opacity-50 shadow-sm"
                        >
                          Отказ
                        </button>
                      </div>
                    )}
                    
                    <div className={`p-2 transition-transform duration-300 ${expandedId === ret.id ? 'rotate-180 text-[#5A5A40]' : 'text-[#5A5A40]/30'}`}>
                      <ChevronDown size={18} />
                    </div>
                  </div>
                </div>
              </div>

              {expandedId === ret.id && (
                <div className="px-6 pb-6 border-t border-[#5A5A40]/5 bg-[#f5f5f0]/20 animate-in slide-in-from-top-2 duration-300">
                  {ret.reason && (
                    <div className="flex items-start gap-2 py-4 px-1">
                      <ClipboardList size={14} className="text-[#5A5A40]/30 mt-0.5" />
                      <p className="text-xs text-[#5A5A40]/60 italic font-normal leading-relaxed overflow-hidden">
                        Причина: {ret.reason}
                      </p>
                    </div>
                  )}
                  <div className="rounded-2xl border border-[#5A5A40]/10 overflow-hidden bg-white shadow-inner">
                    <table className="w-full text-xs">
                    <thead>
                      <tr className="text-[10px] text-[#5A5A40]/40 uppercase tracking-widest bg-[#f5f5f0]/50 border-b border-[#5A5A40]/5">
                        <th className="text-left px-4 py-3 font-normal">Товар / Описание</th>
                        <th className="text-left px-4 py-3 font-normal">Партия</th>
                        <th className="text-right px-4 py-3 font-normal">Количество</th>
                        <th className="text-right px-4 py-3 font-normal">Цена ед.</th>
                        <th className="text-right px-4 py-3 font-normal">Сумма</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#5A5A40]/5">
                      {ret.items.map((item) => (
                        <tr key={item.id} className="hover:bg-[#f5f5f0]/20 transition-colors">
                          <td className="px-4 py-3 font-normal text-[#151619]">{getProductDisplayLabel(item.productId, item.product?.name ?? t('Unknown'))}</td>
                          <td className="px-4 py-3 text-[#5A5A40]/60 font-normal">{item.batch?.batchNumber ?? '—'}</td>
                          <td className="px-4 py-3 text-right text-[#5A5A40]/70 font-normal">{formatPackQuantity(item.quantity)}</td>
                          <td className="px-4 py-3 text-right text-[#5A5A40]/70 font-normal">{item.unitPrice ? item.unitPrice.toFixed(2) : '—'}</td>
                          <td className="px-4 py-3 text-right font-normal text-[#151619]">{getReturnItemTotal(item).toFixed(2)}</td>
                        </tr>
                      ))}
                      <tr className="bg-[#f5f5f0]/35 transition-colors">
                        <td colSpan={2} className="px-4 py-3.5 text-[10px] uppercase font-normal tracking-widest text-[#5A5A40]/55">Итого по документу</td>
                        <td className="px-4 py-3.5 text-right font-normal text-[#5A5A40]">
                          <span className="text-[10px] text-[#5A5A40]/40 mr-1.5 uppercase font-normal italic tracking-tighter">Всего ед:</span>
                          {returnQuantity}
                        </td>
                        <td className="px-4 py-3.5 text-right text-[#5A5A40]/50">—</td>
                        <td className="px-4 py-3.5 text-right font-normal text-[#151619] text-sm">
                          {returnTotal.toFixed(2)} <span className="text-[10px] text-[#5A5A40]/50 ml-1 font-normal tracking-wide uppercase">{currencyCode}</span>
                        </td>
                      </tr>
                    </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )})}
            </div>
          )}
        </div>
      </div>

      <CreateReturnModal open={isModalOpen} onClose={() => setIsModalOpen(false)} onCreated={load} />
    </div>
  );
};
