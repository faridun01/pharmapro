import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { usePharmacy } from '../context';
import { buildApiHeaders } from '../../infrastructure/api';
import { formatProductDisplayName } from '../../lib/productDisplay';
import { useCurrencyCode } from '../../lib/useCurrencyCode';
import { runRefreshTasks } from '../../lib/utils';
import { 
  Plus, CheckCircle2, XCircle, Clock, RefreshCw, ChevronDown, Package, Printer,
  Store, Truck, ClipboardList, Filter, CalendarDays, Search, Wallet
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

const formatPackQuantity = (quantity: number) => `${Math.max(0, Math.floor(Number(quantity || 0)))} ед.`;

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: any }> = {
  DRAFT: { label: 'Черновик', color: 'text-amber-500 bg-amber-50 border-amber-100', icon: Clock },
  APPROVED: { label: 'Одобрен', color: 'text-blue-500 bg-blue-50 border-blue-100', icon: CheckCircle2 },
  COMPLETED: { label: 'Завершен', color: 'text-emerald-500 bg-emerald-50 border-emerald-100', icon: CheckCircle2 },
  REJECTED: { label: 'Отклонен', color: 'text-rose-500 bg-rose-50 border-rose-100', icon: XCircle },
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
    if (!open) return;
    if (suppliers.length === 0) void refreshSuppliers();
    if (products.length === 0) void refreshProducts();
  }, [open, refreshProducts, refreshSuppliers, suppliers.length, products.length]);

  const updateItem = (idx: number, field: keyof ReturnFormItem, value: any) => {
    setFormItems((prev) => {
      const next = [...prev];
      if (field === 'productId') {
        const prod = products.find((p) => p.id === value);
        next[idx] = { ...next[idx], productId: String(value), productName: prod?.name ?? '', batchId: '', batchNo: '', unitPrice: type === 'SUPPLIER' ? Number(prod?.costPrice || 0) : Number(prod?.sellingPrice || 0) };
      } else if (field === 'batchId') {
        const prod = products.find((p) => p.id === next[idx].productId);
        const batch = prod?.batches?.find((b) => b.id === value);
        next[idx] = { ...next[idx], batchId: String(value), batchNo: batch?.batchNumber ?? '' };
      } else { (next[idx] as any)[field] = value; }
      return next;
    });
  };

  const handleSubmit = async () => {
    if (formItems.some((it) => !it.productId) || (type === 'SUPPLIER' && !supplierId)) return setError('Заполните все обязательные поля');
    setSubmitting(true);
    try {
      const res = await fetch('/api/returns', {
        method: 'POST',
        headers: await buildApiHeaders(),
        body: JSON.stringify({
          type, refundMethod: type === 'RETAIL' ? refundMethod : undefined, reason, note,
          items: formItems.map((it) => ({ productId: it.productId, batchId: it.batchId || undefined, quantity: it.quantity, unitPrice: it.unitPrice || undefined })),
        }),
      });
      if (!res.ok) throw new Error('Ошибка создания возврата');
      onCreated(); onClose();
    } catch (e: any) { setError(e.message); } 
    finally { setSubmitting(false); }
  };

  return (
    <AppModal open={open} title="Новый возврат" tone="neutral" size="xl" onClose={onClose}
      footer={
        <div className="flex gap-3 w-full">
          <button onClick={onClose} className="flex-1 py-3 rounded-2xl border border-[#5A5A40]/10 text-[#5A5A40]/40 text-[10px] uppercase tracking-widest hover:bg-[#f5f5f0] transition-all">Отмена</button>
          <button onClick={handleSubmit} disabled={submitting} className="flex-1 py-3 rounded-2xl bg-[#5A5A40] text-white text-[10px] uppercase tracking-widest hover:bg-[#4A4A30] transition-all disabled:opacity-30 shadow-xl shadow-[#5A5A40]/10">Создать возврат</button>
        </div>
      }
    >
      <div className="space-y-6 font-normal">
          <div className="flex gap-2 p-1 bg-[#f5f5f0] rounded-2xl">
            {(['RETAIL', 'SUPPLIER'] as const).map((t_) => (
              <button key={t_} onClick={() => setType(t_)} className={`flex-1 py-2.5 rounded-xl text-[10px] uppercase tracking-widest transition-all ${type === t_ ? 'bg-[#5A5A40] text-white shadow-sm' : 'text-[#5A5A40]/40 hover:text-[#5A5A40]'}`}>
                {t_ === 'RETAIL' ? 'Покупатель' : 'Поставщик'}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {type === 'RETAIL' ? (
              <div>
                <label className="text-[9px] text-[#5A5A40]/40 uppercase tracking-widest mb-1.5 ml-1 block">Способ возврата</label>
                <select className="w-full px-4 py-3 bg-[#f8f7f2] border-none rounded-xl text-xs text-[#151619] outline-none transition-all focus:bg-white focus:ring-4 focus:ring-[#5A5A40]/5" value={refundMethod} onChange={(e) => setRefundMethod(e.target.value)}>
                  <option value="CASH">Наличные</option>
                  <option value="CARD">На карту</option>
                  <option value="STORE_BALANCE">На баланс</option>
                </select>
              </div>
            ) : (
              <div>
                <label className="text-[9px] text-[#5A5A40]/40 uppercase tracking-widest mb-1.5 ml-1 block">Выбор поставщика</label>
                <select className="w-full px-4 py-3 bg-[#f8f7f2] border-none rounded-xl text-xs text-[#151619] outline-none transition-all focus:bg-white focus:ring-4 focus:ring-[#5A5A40]/5" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                  <option value="">Выберите...</option>
                  {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            )}
            <div>
              <label className="text-[9px] text-[#5A5A40]/40 uppercase tracking-widest mb-1.5 ml-1 block">Причина (кратко)</label>
              <input className="w-full px-4 py-3 bg-[#f8f7f2] border-none rounded-xl text-xs text-[#151619] outline-none transition-all focus:bg-white focus:ring-4 focus:ring-[#5A5A40]/5" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Брак, ошибка..." />
            </div>
          </div>

          <div className="space-y-3">
             <div className="flex items-center justify-between px-1">
               <span className="text-[9px] text-[#5A5A40]/40 uppercase tracking-[0.2em]">Состав возврата</span>
               <button onClick={() => setFormItems([...formItems, { productId: '', productName: '', batchId: '', batchNo: '', quantity: 1, unitPrice: 0 }])} className="text-[9px] uppercase tracking-widest text-emerald-600 flex items-center gap-1 hover:opacity-70">
                 <Plus size={12} /> Добавить строку
               </button>
             </div>
             <div className="space-y-2">
               {formItems.map((item, idx) => (
                 <div key={idx} className="flex gap-2 items-center bg-[#fcfbf7] p-2 rounded-2xl border border-[#5A5A40]/5 group">
                   <select className="flex-1 min-w-0 px-3 py-2 bg-white border-none rounded-xl text-xs outline-none" value={item.productId} onChange={(e) => updateItem(idx, 'productId', e.target.value)}>
                     <option value="">Выбрать препарат</option>
                     {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                   </select>
                   <input type="number" className="w-20 px-3 py-2 bg-white border-none rounded-xl text-xs outline-none tabular-nums" value={item.quantity} onChange={(e) => updateItem(idx, 'quantity', Number(e.target.value))} placeholder="Кол-во" />
                   <input type="number" className="w-24 px-3 py-2 bg-white border-none rounded-xl text-xs outline-none tabular-nums" value={item.unitPrice} onChange={(e) => updateItem(idx, 'unitPrice', Number(e.target.value))} placeholder="Цена" />
                   <button onClick={() => setFormItems(formItems.filter((_, i) => i !== idx))} className="p-2 text-[#5A5A40]/10 hover:text-rose-500 transition-colors"><XCircle size={16}/></button>
                 </div>
               ))}
             </div>
          </div>
          {error && <p className="text-rose-500 text-[10px] uppercase tracking-widest text-center">{error}</p>}
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
      const q = new URLSearchParams({ from: fromDate, to: toDate });
      const res = await fetch(`/api/returns?${q.toString()}`, { headers: await buildApiHeaders() });
      if (res.ok) setReturns(await res.json());
    } finally { setLoading(false); }
  }, [fromDate, toDate]);

  useEffect(() => {
    if (preset === 'custom') return;
    const { from, to } = getPresetDates(preset);
    setFromDate(from); setToDate(to);
  }, [preset]);

  useEffect(() => { load(); }, [load]);

  const approve = async (id: string) => {
    setActionPending(id);
    try {
      const res = await fetch(`/api/returns/${id}/approve`, { method: 'PUT', headers: await buildApiHeaders() });
      if (res.ok) await runRefreshTasks(load, refreshProducts);
    } finally { setActionPending(null); }
  };

  const reject = async (id: string) => {
    setActionPending(id);
    try {
      const res = await fetch(`/api/returns/${id}/reject`, { method: 'PUT', headers: await buildApiHeaders() });
      if (res.ok) load();
    } finally { setActionPending(null); }
  };

  const filteredReturns = useMemo(() => returns.filter(ret => (typeFilter === 'ALL' || ret.type === typeFilter) && (statusFilter === 'ALL' || ret.status === statusFilter)), [returns, typeFilter, statusFilter]);
  const stats = useMemo(() => ({
    total: filteredReturns.reduce((s, r) => s + getReturnTotal(r), 0),
    count: filteredReturns.length,
    units: filteredReturns.reduce((s, r) => s + r.items.reduce((is, it) => is + Number(it.quantity || 0), 0), 0)
  }), [filteredReturns]);

  return (
    <div className="max-w-[1600px] mx-auto space-y-8 pb-12 animate-in fade-in duration-700 font-normal">
      
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 px-1">
        <div className="flex items-center gap-5">
           <div className="w-14 h-14 rounded-[1.5rem] bg-[#fcfbf7] border border-[#5A5A40]/5 flex items-center justify-center text-[#5A5A40]/60 shadow-sm">
             <RefreshCw size={26} />
           </div>
           <div>
             <h2 className="text-3xl font-normal text-[#151619] tracking-tight">Возвраты товаров</h2>
             <p className="text-[#5A5A40]/50 mt-1 text-[10px] uppercase tracking-[0.2em] italic">Корректировка складских остатков и финансов</p>
           </div>
        </div>
        <div className="flex gap-3">
          <button onClick={load} className="w-12 h-12 rounded-2xl bg-white border border-[#5A5A40]/10 flex items-center justify-center text-[#5A5A40]/40 hover:text-[#5A5A40] transition-colors shadow-sm">
            <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
          </button>
          <button onClick={() => setIsModalOpen(true)} className="px-6 py-3.5 rounded-2xl bg-[#5A5A40] text-white text-[10px] uppercase tracking-widest shadow-xl shadow-[#5A5A40]/10 hover:bg-[#4A4A30] transition-all flex items-center gap-2">
            <Plus size={18} /> Создать возврат
          </button>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {[
          { label: 'Общая сумма', value: stats.total, sub: currencyCode, icon: Wallet, bg: 'bg-emerald-50', color: 'text-emerald-500' },
          { label: 'Количество актов', value: stats.count, sub: 'док.', icon: ClipboardList, bg: 'bg-indigo-50', color: 'text-indigo-500' },
          { label: 'Всего единиц', value: stats.units, sub: 'шт.', icon: Package, bg: 'bg-amber-50', color: 'text-amber-500' }
        ].map((s, i) => (
          <div key={i} className="bg-white/60 p-7 rounded-[2.5rem] border border-white shadow-sm flex items-center gap-6">
            <div className={`w-14 h-14 rounded-2xl ${s.bg} ${s.color} flex items-center justify-center shadow-inner`}><s.icon size={24}/></div>
            <div>
              <p className="text-[10px] uppercase tracking-widest text-[#5A5A40]/40 mb-1">{s.label}</p>
              <p className="text-2xl font-normal text-[#151619] tabular-nums tracking-tight">{typeof s.value === 'number' ? s.value.toLocaleString() : s.value} <span className="text-xs opacity-30">{s.sub}</span></p>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
        {/* Left Filters */}
        <div className="space-y-6">
          <DateRangeFilter preset={preset} setPreset={setPreset} fromDate={fromDate} setFromDate={setFromDate} toDate={toDate} setToDate={setToDate} onRefresh={load} />
          
          <div className="bg-white rounded-[2.5rem] p-8 border border-white shadow-sm space-y-8">
            <div className="space-y-4">
               <p className="text-[10px] uppercase tracking-[0.2em] text-[#5A5A40]/30 px-1">Тип операции</p>
               <div className="flex flex-col gap-2">
                {[
                  { id: 'ALL', label: 'Все возвраты', icon: <LayoutGrid size={14}/> },
                  { id: 'RETAIL', label: 'Обычный (чеки)', icon: <Store size={14}/> },
                  { id: 'SUPPLIER', label: 'Поставщикам', icon: <Truck size={14}/> }
                ].map(opt => (
                  <button key={opt.id} onClick={() => setTypeFilter(opt.id as any)} className={`flex items-center gap-3 px-4 py-3 rounded-xl text-xs transition-all ${typeFilter === opt.id ? 'bg-[#5A5A40] text-white shadow-lg' : 'bg-[#fcfbf7] text-[#5A5A40]/40 hover:bg-[#f5f5f0]'}`}>
                    {opt.icon} <span className="font-normal">{opt.label}</span>
                  </button>
                ))}
               </div>
            </div>

            <div className="space-y-4">
               <p className="text-[10px] uppercase tracking-[0.2em] text-[#5A5A40]/30 px-1">Статус документа</p>
               <div className="flex flex-col gap-2">
                {[
                  { id: 'ALL', label: 'Любой статус' },
                  { id: 'DRAFT', label: 'Черновики' },
                  { id: 'COMPLETED', label: 'Завершенные' },
                  { id: 'REJECTED', label: 'Отклоненные' }
                ].map(opt => (
                  <button key={opt.id} onClick={() => setStatusFilter(opt.id as any)} className={`px-4 py-3 rounded-xl text-xs text-left transition-all ${statusFilter === opt.id ? 'bg-[#5A5A40] text-white shadow-lg' : 'bg-[#fcfbf7] text-[#5A5A40]/40 hover:bg-[#f5f5f0]'}`}>
                   <span className="font-normal">{opt.label}</span>
                  </button>
                ))}
               </div>
            </div>
          </div>
        </div>

        {/* Right List */}
        <div className="lg:col-span-3 space-y-4">
          {loading ? (
            <div className="h-64 flex flex-col items-center justify-center bg-white/40 rounded-[3rem] border border-dashed border-[#5A5A40]/10 animate-pulse">
               <p className="text-[10px] uppercase tracking-widest text-[#5A5A40]/20">Синхронизация данных...</p>
            </div>
          ) : filteredReturns.map(ret => {
            const config = STATUS_CONFIG[ret.status] || STATUS_CONFIG.DRAFT;
            const StatusIcon = config.icon;
            return (
              <div key={ret.id} className="bg-white hover:shadow-2xl hover:shadow-[#5A5A40]/5 rounded-[2.5rem] border border-white transition-all overflow-hidden group">
                <div className="px-8 py-6 flex items-center justify-between cursor-pointer" onClick={() => setExpandedId(expandedId === ret.id ? null : ret.id)}>
                   <div className="flex items-center gap-6">
                      <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${ret.type === 'RETAIL' ? 'bg-[#fcfbf7] text-[#5A5A40]/40' : 'bg-indigo-50 text-indigo-500'}`}>
                         {ret.type === 'RETAIL' ? <Store size={22}/> : <Truck size={22}/>}
                      </div>
                      <div>
                         <h4 className="text-[15px] font-normal text-[#151619] tracking-tight">{ret.returnNo}</h4>
                         <p className="text-[10px] text-[#5A5A40]/40 mt-1 italic">{ret.supplier?.name || 'Розничный возврат • Склад'}</p>
                      </div>
                   </div>
                   
                   <div className="flex items-center gap-10">
                      <div className="text-right">
                         <p className="text-[10px] text-[#5A5A40]/30 uppercase tracking-widest mb-1">Итого</p>
                         <p className="text-sm font-normal text-[#151619]">{getReturnTotal(ret).toFixed(2)} <span className="opacity-30">TJS</span></p>
                      </div>
                      <div className={`px-3 py-1.5 rounded-xl border text-[9px] uppercase tracking-widest flex items-center gap-2 ${config.color}`}>
                         <StatusIcon size={12}/> {config.label}
                      </div>
                      <div className="flex items-center gap-2">
                        <button onClick={(e) => { e.stopPropagation(); /* PRINT logic handled inside ret.items scope usually or need to call from here */ }} className="p-2 text-[#5A5A40]/20 hover:text-[#5A5A40] hover:bg-[#f5f5f0] rounded-xl transition-all"><Printer size={18}/></button>
                        <ChevronDown size={18} className={`text-[#5A5A40]/20 transition-transform duration-300 ${expandedId === ret.id ? 'rotate-180' : ''}`} />
                      </div>
                   </div>
                </div>

                {expandedId === ret.id && (
                  <div className="px-10 pb-10 pt-4 bg-[#fcfbf7]/40 animate-in slide-in-from-top-4 duration-500">
                    <div className="flex items-center gap-3 mb-6">
                       <div className="w-1 h-4 bg-[#5A5A40]/20 rounded-full" />
                       <p className="text-[10px] uppercase tracking-[0.2em] text-[#5A5A40]/40">Детализация позиций</p>
                    </div>
                    <div className="space-y-3">
                       {ret.items.map(it => (
                         <div key={it.id} className="flex items-center justify-between p-4 bg-white rounded-2xl border border-[#5A5A40]/5 shadow-sm">
                            <div className="flex items-center gap-4">
                               <div className="w-8 h-8 rounded-xl bg-[#fcfbf7] flex items-center justify-center text-[#5A5A40]/20 text-[10px]">{it.productId.slice(-2)}</div>
                               <div>
                                  <p className="text-sm font-normal text-[#151619]">{it.product?.name || 'Неизвестный товар'}</p>
                                  <p className="text-[9px] text-[#5A5A40]/40 uppercase mt-0.5 tracking-widest">Партия: {it.batch?.batchNumber || 'N/A'}</p>
                               </div>
                            </div>
                            <div className="text-right flex items-center gap-8">
                               <div>
                                  <p className="text-[9px] text-[#5A5A40]/30 uppercase mb-1">Кол-во</p>
                                  <p className="text-sm font-normal text-[#151619]">{it.quantity} <span className="opacity-30">ед.</span></p>
                               </div>
                               <div>
                                  <p className="text-[9px] text-[#5A5A40]/30 uppercase mb-1">Сумма</p>
                                  <p className="text-sm font-normal text-[#151619]">{getReturnItemTotal(it).toFixed(2)}</p>
                               </div>
                            </div>
                         </div>
                       ))}
                    </div>
                    {ret.status === 'DRAFT' && (
                      <div className="flex justify-end gap-3 mt-8">
                         <button onClick={() => reject(ret.id)} className="px-8 py-2.5 rounded-xl border border-rose-100 text-[10px] uppercase tracking-widest text-rose-500 hover:bg-rose-50 transition-all">Отклонить</button>
                         <button onClick={() => approve(ret.id)} className="px-10 py-2.5 rounded-xl bg-emerald-600 text-white text-[10px] uppercase tracking-widest shadow-xl shadow-emerald-700/10 hover:bg-emerald-700 transition-all">Утвердить и вернуть на склад</button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <CreateReturnModal open={isModalOpen} onClose={() => setIsModalOpen(false)} onCreated={load} />
    </div>
  );
};

const LayoutGrid = ({size}: {size:number}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>
);

export default ReturnView;
