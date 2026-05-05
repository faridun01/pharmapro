import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { 
  Search, Plus, Truck, Phone, Mail, MapPin, Edit3, Trash2, 
  Package, X, CalendarClock, ChevronRight, LayoutGrid, Info, CreditCard,
  AlertTriangle, RefreshCw
} from 'lucide-react';
import { buildApiHeaders } from '../../infrastructure/api';
import { useDebounce } from '../../lib/useDebounce';
import { SupplierPaymentModal } from './suppliers/SupplierPaymentModal';

type SupplierRecord = {
  id: string;
  name: string;
  contact?: string | null;
  address?: string | null;
};

type SupplierInvoiceSummary = {
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  totalAmount: number;
  paidAmount: number;
  debtAmount: number;
  itemCount: number;
  status: string;
  paymentStatus: string;
  items?: Array<{
    productName: string;
    sku: string;
    quantity: number;
    unitCost: number;
    lineTotal: number;
  }>;
};

type SupplierBatchSummary = {
  id: string;
  batchNumber: string;
  productName: string;
  productSku: string;
  quantity: number;
  expiryDate: string;
  costBasis: number;
};

type SupplierOverview = {
  invoices: SupplierInvoiceSummary[];
  batchList: SupplierBatchSummary[];
  payments: Array<{
    id: string;
    amount: number;
    method: string;
    paymentDate: string;
    comment?: string | null;
    purchaseInvoiceId?: string | null;
  }>;
  summary: {
    invoiceCount: number;
    batchCount: number;
    totalAmount: number;
    totalDebt: number;
    overdueDebt: number;
    totalPaid: number;
    lastInvoiceDate?: string | null;
    nearestExpiry?: string | null;
  };
};

type SupplierForm = {
  name: string;
  contact: string;
  address: string;
};

const INITIAL_FORM: SupplierForm = {
  name: '',
  contact: '',
  address: '',
};

const formatMoney = (value: number) => `${Number(value || 0).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} TJS`;

export const SuppliersPage: React.FC = () => {
  const { t } = useTranslation();
  const [suppliers, setSuppliers] = useState<SupplierRecord[]>([]);
  const [supplierStats, setSupplierStats] = useState<Record<string, SupplierOverview>>({});
  const [openSupplierId, setOpenSupplierId] = useState<string | null>(null);
  const [expandedInvoiceId, setExpandedInvoiceId] = useState<string | null>(null);
  const [paymentModal, setPaymentModal] = useState<{ invoice: SupplierInvoiceSummary; supplierId: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [initialLoadPending, setInitialLoadPending] = useState(true);
  const [detailLoading, setDetailLoading] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [form, setForm] = useState<SupplierForm>(INITIAL_FORM);
  const [editingSupplierId, setEditingSupplierId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);

  const debouncedSearchTerm = useDebounce(searchTerm, 250);

  const request = useCallback(async (url: string, init?: RequestInit) => {
    const response = await fetch(url, {
      ...init,
      headers: {
        ...(await buildApiHeaders()),
        ...(init?.headers || {}),
      },
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(payload?.error || payload?.message || 'Ошибка запроса');
    }
    return payload;
  }, []);

  const loadSuppliers = useCallback(async () => {
    setInitialLoadPending(true);
    try {
      const data = await request('/api/suppliers/full');
      if (Array.isArray(data)) {
        setSuppliers(data.map(s => ({ id: s.id, name: s.name, contact: s.contact, address: s.address })));
        const statsMap: Record<string, any> = {};
        for (const s of data) {
          if (s.summary) statsMap[s.id] = { summary: s.summary };
        }
        setSupplierStats(statsMap);
      }
    } catch (err: any) {
      setError(err.message || 'Ошибка загрузки партнеров');
    } finally {
      setInitialLoadPending(false);
    }
  }, [request]);

  const loadSupplierDetails = useCallback(async (supplierId: string, force = false) => {
    if (!force && supplierStats[supplierId]?.invoices) return;
    setDetailLoading(supplierId);
    try {
      const overview = await request(`/api/suppliers/${supplierId}/summary`);
      setSupplierStats((prev) => ({ ...prev, [supplierId]: overview }));
    } catch (err: any) {
      console.error('Failed to load supplier details:', err);
    } finally {
      setDetailLoading(null);
    }
  }, [request, supplierStats]);

  useEffect(() => { loadSuppliers(); }, [loadSuppliers]);

  // Automatic data fetch when modal opens
  useEffect(() => {
    if (openSupplierId) {
      void loadSupplierDetails(openSupplierId);
    }
  }, [openSupplierId, loadSupplierDetails]);

  const filteredSuppliers = useMemo(() => suppliers.filter((supplier) => {
    const query = debouncedSearchTerm.trim().toLocaleLowerCase('ru-RU');
    if (!query) return true;
    return [supplier.name, supplier.contact, supplier.address]
      .some((value) => String(value || '').toLocaleLowerCase('ru-RU').includes(query));
  }), [suppliers, debouncedSearchTerm]);

  const selectedSupplier = openSupplierId ? suppliers.find((s) => s.id === openSupplierId) || null : null;
  const selectedStats = openSupplierId ? supplierStats[openSupplierId] : null;

  const totalTurnover = Object.values(supplierStats).reduce((sum, s) => sum + (s.summary?.totalAmount || 0), 0);
  const totalDebt = Object.values(supplierStats).reduce((sum, s) => sum + (s.summary?.totalDebt || 0), 0);
  const totalOverdue = Object.values(supplierStats).reduce((sum, s) => sum + (s.summary?.overdueDebt || 0), 0);

  const saveSupplier = async () => {
    if (!form.name.trim()) return setError(t('Supplier name is required'));
    setSubmitting(true);
    try {
      await request(editingSupplierId ? `/api/suppliers/${editingSupplierId}` : '/api/suppliers', {
        method: editingSupplierId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          contact: form.contact.trim() || null,
          address: form.address.trim() || null,
        }),
      });
      await loadSuppliers();
      setIsAddOpen(false);
    } catch (err: any) {
      setError(err.message || t('Failed to save supplier'));
    } finally {
      setSubmitting(false);
    }
  };

  const deleteSupplier = async (supplierId: string) => {
    setSubmitting(true);
    try {
      await request(`/api/suppliers/${supplierId}`, { method: 'DELETE' });
      setSupplierStats((p) => { const n = {...p}; delete n[supplierId]; return n; });
      if (openSupplierId === supplierId) setOpenSupplierId(null);
      await loadSuppliers();
    } catch (err: any) {
      setError(err.message || t('Failed to delete supplier'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-[1600px] mx-auto space-y-8 animate-in fade-in duration-700 pb-20">
      {/* Header Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Всего партнеров', val: suppliers.length, sub: 'Активных компаний', color: 'text-[#5A5A40]' },
          { label: 'Общий оборот', val: formatMoney(totalTurnover), sub: 'За весь период', color: 'text-[#5A5A40]' },
          { label: 'Текущий долг', val: formatMoney(totalDebt), sub: 'Сумма к оплате', color: 'text-red-500' },
          { label: 'Просрочено', val: formatMoney(totalOverdue), sub: 'Критические задолж.', color: 'text-amber-600' },
        ].map((card, idx) => (
          <div key={idx} className="bg-white/40 border border-[#5A5A40]/5 rounded-[2rem] p-6 shadow-sm hover:shadow-xl hover:shadow-[#5A5A40]/5 transition-all group">
            <p className="text-[10px] font-normal text-[#5A5A40]/40 uppercase tracking-[0.2em] mb-1">{card.label}</p>
            <p className={`text-2xl font-normal ${card.color} tracking-tight group-hover:tracking-tighter transition-all`}>{card.val}</p>
            <p className="text-[10px] font-normal text-[#5A5A40]/30 mt-2 italic">{card.sub}</p>
          </div>
        ))}
      </div>

      <div className="bg-white/80 backdrop-blur-md rounded-[2.5rem] border border-white/70 p-4 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3 px-2">
          <div className="w-10 h-10 rounded-2xl bg-[#5A5A40]/5 flex items-center justify-center text-[#5A5A40]/40">
            <Truck size={20} />
          </div>
          <div>
            <h4 className="text-sm font-normal text-[#151619]">База поставщиков</h4>
            <p className="text-[10px] text-[#5A5A40]/50 uppercase tracking-widest">Управление закупками и долгами</p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <div className="relative group">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-[#5A5A40]/30 group-focus-within:text-[#5A5A40] transition-colors" size={16} />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Поиск по названию или контактам..."
              className="w-full sm:w-72 pl-11 pr-4 py-3 bg-white/50 border border-[#5A5A40]/10 rounded-2xl text-sm outline-none focus:ring-4 focus:ring-[#5A5A40]/10 focus:bg-white transition-all font-normal placeholder:text-[#5A5A40]/30"
            />
          </div>
          <button onClick={() => { setForm(INITIAL_FORM); setEditingSupplierId(null); setIsAddOpen(true); }} className="bg-[#5A5A40] text-white px-6 py-3 rounded-2xl font-normal shadow-lg shadow-[#5A5A40]/10 hover:bg-[#4A4A30] active:scale-95 transition-all flex items-center justify-center gap-2">
            <Plus size={18} />
            <span>Новый партнер</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-red-50 text-red-600 rounded-2xl text-xs flex items-center gap-3">
          <Info size={14} /> {error}
        </div>
      )}

      {/* Grid of Supplier Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {initialLoadPending ? (
          Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-64 bg-white/40 border border-[#5A5A40]/5 rounded-[2rem] animate-pulse" />
          ))
        ) : filteredSuppliers.length === 0 ? (
          <div className="col-span-full py-24 text-center">
            <div className="w-20 h-20 bg-[#5A5A40]/5 rounded-[2rem] mx-auto flex items-center justify-center text-[#5A5A40]/20 mb-4">
              <Truck size={40} />
            </div>
            <p className="text-sm text-[#5A5A40]/40 font-normal italic">Список пуст</p>
          </div>
        ) : (
          filteredSuppliers.map((s) => {
            const stats = supplierStats[s.id]?.summary;
            const hasDebt = (stats?.totalDebt || 0) > 0;
            return (
              <div
                key={s.id}
                onClick={() => setOpenSupplierId(s.id)}
                className="group bg-white/40 hover:bg-white border border-[#5A5A40]/5 rounded-[2rem] p-6 transition-all hover:shadow-2xl hover:shadow-[#5A5A40]/5 cursor-pointer flex flex-col h-full"
              >
                <div className="flex justify-between items-start mb-6">
                  <div className="w-14 h-14 rounded-3xl bg-[#f5f5f0] flex items-center justify-center text-[#5A5A40]/30 group-hover:bg-[#5A5A40] group-hover:text-white transition-all shadow-inner">
                    <Truck size={28} />
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={(e) => { e.stopPropagation(); setForm({ name: s.name, contact: s.contact || '', address: s.address || '' }); setEditingSupplierId(s.id); setIsAddOpen(true); }}
                      className="p-2.5 text-[#5A5A40]/30 hover:text-[#5A5A40] hover:bg-[#f5f5f0] rounded-xl transition-all"
                    >
                      <Edit3 size={16} />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); setDeleteTarget({ id: s.id, name: s.name }); }}
                      className="p-2.5 text-[#5A5A40]/30 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>

                <div className="flex-1">
                  <h3 className="text-lg font-normal text-[#151619] tracking-tight group-hover:text-[#5A5A40] transition-colors">{s.name}</h3>
                  <div className="flex items-center gap-1.5 mt-1.5">
                    <MapPin size={12} className="text-[#5A5A40]/30" />
                    <p className="text-[10px] text-[#5A5A40]/50 font-normal truncate uppercase tracking-widest">
                      {s.address || 'Адрес не указан'}
                    </p>
                  </div>

                  <div className="mt-6 space-y-2.5">
                    <div className="flex items-center gap-3 p-2.5 bg-white/50 rounded-2xl border border-[#5A5A40]/5 group-hover:border-[#5A5A40]/10 transition-all font-normal">
                      <Phone size={14} className="text-[#5A5A40]/20" />
                      <span className="text-xs text-[#5A5A40]/70">{s.contact || '—'}</span>
                    </div>
                  </div>
                </div>

                <div className="mt-8 pt-6 border-t border-[#5A5A40]/5 grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <p className="text-[9px] uppercase tracking-widest text-[#5A5A40]/30 font-normal">Приходов</p>
                    <p className="text-sm font-normal text-[#151619]">{stats?.invoiceCount || 0}</p>
                  </div>
                  <div className="text-right space-y-1">
                    <p className="text-[9px] uppercase tracking-widest text-[#5A5A40]/30 font-normal">Долг</p>
                    <p className={`text-sm font-normal ${hasDebt ? 'text-red-500' : 'text-emerald-600'}`}>
                      {formatMoney(stats?.totalDebt || 0)}
                    </p>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Details Modal */}
      {openSupplierId && selectedSupplier && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[#151619]/60 backdrop-blur-xl p-4 animate-in fade-in zoom-in duration-300">
          <div className="bg-[#f8f7f2] rounded-[3rem] shadow-2xl w-full max-w-6xl h-[90vh] flex flex-col overflow-hidden border border-white/20 relative">
            
            {/* Modal Header */}
            <div className="p-8 pb-4 flex items-center justify-between z-20">
              <div className="flex items-center gap-5">
                <div className="w-16 h-16 rounded-[2rem] bg-[#5A5A40] text-white flex items-center justify-center shadow-lg shadow-[#5A5A40]/20 transition-transform active:scale-95 cursor-pointer" onClick={() => void loadSupplierDetails(openSupplierId, true)}>
                  {detailLoading ? <RefreshCw size={28} className="animate-spin" /> : <Truck size={32} />}
                </div>
                <div>
                  <h3 className="text-2xl font-normal text-[#151619] tracking-tight">{selectedSupplier.name}</h3>
                  <p className="text-[10px] uppercase tracking-widest text-[#5A5A40]/50 mt-1 font-normal">Карточка делового партнера</p>
                </div>
              </div>
              <button onClick={() => setOpenSupplierId(null)} className="w-12 h-12 rounded-full border border-[#5A5A40]/10 flex items-center justify-center text-[#5A5A40]/40 hover:bg-white hover:text-[#5A5A40] transition-all">
                <X size={20} />
              </button>
            </div>

            {/* Scrollable Content */}
            <div className="flex-1 overflow-y-auto p-8 pt-4 space-y-10 relative z-10 custom-scrollbar">
              
              {/* Internal Loader overlay */}
              {detailLoading && !selectedStats?.invoices && (
                <div className="absolute inset-0 bg-[#f8f7f2]/50 backdrop-blur-[2px] z-[30] flex flex-col items-center justify-center">
                  <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-[#5A5A40]/30 mb-4" />
                  <p className="text-[10px] uppercase tracking-[0.3em] text-[#5A5A40]/40 font-normal">Синхронизация данных...</p>
                </div>
              )}

              {/* Stats Row */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {[
                  { label: 'Приходов', val: selectedStats?.summary?.invoiceCount || 0, icon: <Package size={16}/>, color: 'text-[#5A5A40]' },
                  { label: 'Оборот', val: formatMoney(selectedStats?.summary?.totalAmount || 0), icon: <LayoutGrid size={16}/>, color: 'text-[#5A5A40]' },
                  { label: 'Долг', val: formatMoney(selectedStats?.summary?.totalDebt || 0), icon: <CreditCard size={16}/>, color: 'text-red-500' },
                  { label: 'На проверке', val: formatMoney(selectedStats?.summary?.overdueDebt || 0), icon: <AlertTriangle size={16}/>, color: 'text-amber-600' },
                ].map((s, i) => (
                  <div key={i} className="bg-white border border-[#5A5A40]/5 rounded-[2rem] p-5 shadow-sm">
                    <div className="flex items-center gap-2 mb-3 opacity-30">
                      {s.icon} <span className="text-[9px] uppercase tracking-widest font-normal">{s.label}</span>
                    </div>
                    <p className={`text-xl font-normal ${s.color} tracking-tight`}>{s.val}</p>
                  </div>
                ))}
              </div>

              {/* Invoices Section */}
              <div className="space-y-4">
                <div className="flex items-center justify-between px-2">
                  <h4 className="text-sm font-normal text-[#151619] tracking-tight">История накладных</h4>
                  <span className="text-[9px] uppercase tracking-widest text-[#5A5A40]/30 font-normal italic">Всего записей: {(selectedStats?.invoices || []).length}</span>
                </div>
                <div className="bg-white rounded-[2rem] border border-[#5A5A40]/10 overflow-hidden shadow-sm">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-[#f5f5f0]/50 text-[10px] uppercase tracking-widest text-[#5A5A40]/40 border-b border-[#5A5A40]/5">
                        <th className="px-6 py-4 text-left font-normal">Номер</th>
                        <th className="px-6 py-4 text-left font-normal">Дата</th>
                        <th className="px-6 py-4 text-right font-normal">Сумма</th>
                        <th className="px-6 py-4 text-right font-normal text-emerald-600">Оплачено</th>
                        <th className="px-6 py-4 text-right font-normal text-red-400">Остаток</th>
                        <th className="px-6 py-4 text-center font-normal">Статус</th>
                        <th className="px-6 py-4 text-right font-normal">Действие</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#5A5A40]/5">
                      {(selectedStats?.invoices || []).map((inv) => {
                        const isExp = expandedInvoiceId === inv.id;
                        return (
                          <React.Fragment key={inv.id}>
                            <tr className={`group hover:bg-[#f5f5f0]/30 transition-all cursor-pointer ${isExp ? 'bg-[#f5f5f0]/50' : ''}`} onClick={() => setExpandedInvoiceId(isExp ? null : inv.id)}>
                              <td className="px-6 py-5 font-normal text-[#151619]">
                                <div className="flex items-center gap-3">
                                  <ChevronRight size={16} className={`transition-transform duration-300 ${isExp ? 'rotate-90 text-[#5A5A40]' : 'text-[#5A5A40]/20'}`} />
                                  <span>{inv.invoiceNumber}</span>
                                </div>
                              </td>
                              <td className="px-6 py-5 text-[#5A5A40]/60 font-normal">{new Date(inv.invoiceDate).toLocaleDateString()}</td>
                              <td className="px-6 py-5 text-right font-normal">{formatMoney(inv.totalAmount)}</td>
                              <td className="px-6 py-5 text-right text-emerald-600 font-normal">{formatMoney(inv.paidAmount)}</td>
                              <td className="px-6 py-5 text-right text-red-500 font-normal">{formatMoney(inv.debtAmount)}</td>
                              <td className="px-6 py-5 text-center">
                                <span className={`px-2.5 py-1 rounded-full text-[9px] uppercase tracking-widest font-normal border ${inv.paymentStatus === 'PAID' ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 'bg-red-50 text-red-600 border-red-100'}`}>
                                  {inv.paymentStatus === 'PAID' ? 'Закрыта' : 'Долг'}
                                </span>
                              </td>
                              <td className="px-6 py-5 text-right">
                                {inv.debtAmount > 0 && (
                                  <button onClick={(e) => { e.stopPropagation(); setPaymentModal({ invoice: inv, supplierId: openSupplierId }); }} className="bg-[#5A5A40] text-white text-[9px] uppercase tracking-widest px-4 py-2 rounded-xl scale-95 hover:scale-100 hover:bg-[#4A4A30] transition-all font-normal">К оплате</button>
                                )}
                              </td>
                            </tr>
                            {isExp && (
                              <tr className="bg-[#f5f5f0]/20 animate-in slide-in-from-top-2 duration-300">
                                <td colSpan={7} className="px-12 py-6">
                                  <div className="bg-white rounded-2xl border border-[#5A5A40]/5 overflow-hidden shadow-inner p-4">
                                    <table className="w-full text-[11px] font-normal">
                                      <thead>
                                        <tr className="text-[#5A5A40]/40 uppercase tracking-widest border-b border-[#5A5A40]/5">
                                          <th className="pb-3 text-left font-normal italic">Товар</th>
                                          <th className="pb-3 text-right font-normal italic">Кол-во</th>
                                          <th className="pb-3 text-right font-normal italic">Цена</th>
                                          <th className="pb-3 text-right font-normal italic">Итого</th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y divide-[#5A5A40]/5">
                                        {(inv.items || []).map((item, i) => (
                                          <tr key={i}>
                                            <td className="py-2.5 text-[#151619]">{item.productName}</td>
                                            <td className="py-2.5 text-right">{item.quantity}</td>
                                            <td className="py-2.5 text-right text-[#5A5A40]/50">{formatMoney(item.unitCost)}</td>
                                            <td className="py-2.5 text-right text-[#151619]">{formatMoney(item.lineTotal)}</td>
                                          </tr>
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
                      {(!selectedStats?.invoices || selectedStats.invoices.length === 0) && (
                        <tr><td colSpan={7} className="py-12 text-center text-[#5A5A40]/30 font-normal italic uppercase tracking-tighter">Накладные не найдены</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Payments Section */}
              <div className="space-y-4 pb-12">
                <div className="flex items-center justify-between px-2">
                  <h4 className="text-sm font-normal text-[#151619] tracking-tight">История платежей</h4>
                  <span className="text-[9px] uppercase tracking-widest text-[#5A5A40]/30 font-normal italic">Транзакций: {(selectedStats?.payments || []).length}</span>
                </div>
                <div className="bg-white rounded-[2rem] border border-[#5A5A40]/10 overflow-hidden shadow-sm">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-[#f5f5f0]/50 text-[10px] uppercase tracking-widest text-[#5A5A40]/40 border-b border-[#5A5A40]/5">
                        <th className="px-6 py-4 text-left font-normal">Дата</th>
                        <th className="px-6 py-4 text-left font-normal">Тип</th>
                        <th className="px-6 py-4 text-right font-normal">Сумма</th>
                        <th className="px-6 py-4 text-left font-normal">Комментарий</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#5A5A40]/5">
                      {(selectedStats?.payments || []).map((p) => (
                        <tr key={p.id} className="hover:bg-[#f5f5f0]/20 transition-all font-normal">
                          <td className="px-6 py-4 text-[#5A5A40]/70 flex items-center gap-2"><CalendarClock size={14} className="opacity-30" /> {new Date(p.paymentDate).toLocaleString()}</td>
                          <td className="px-6 py-4 text-[#5A5A40]/80 lowercase tracking-tight italic">{p.method}</td>
                          <td className="px-6 py-4 text-right text-emerald-600 font-normal tracking-tight">{formatMoney(p.amount)}</td>
                          <td className="px-6 py-4 text-[#5A5A40]/40 text-xs truncate max-w-xs">{p.comment || '—'}</td>
                        </tr>
                      ))}
                      {(!selectedStats?.payments || selectedStats.payments.length === 0) && (
                        <tr><td colSpan={4} className="py-12 text-center text-[#5A5A40]/30 font-normal italic uppercase tracking-tighter">Платежи отсутствуют</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add/Edit Modal */}
      {isAddOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-[#151619]/60 backdrop-blur-xl p-4 animate-in fade-in zoom-in duration-300">
          <div className="bg-white rounded-[3rem] shadow-2xl w-full max-w-lg overflow-hidden border border-[#5A5A40]/10">
            <div className="p-8 border-b border-[#5A5A40]/5 flex items-center justify-between">
              <div>
                <h3 className="text-xl font-normal text-[#151619] tracking-tight">{editingSupplierId ? 'Данные партнера' : 'Новый партнер'}</h3>
                <p className="text-[10px] uppercase tracking-widest text-[#5A5A40]/50 mt-1 font-normal">Заполнение профиля поставщика</p>
              </div>
              <button onClick={() => setIsAddOpen(false)} className="w-10 h-10 rounded-full border border-[#5A5A40]/10 flex items-center justify-center text-[#5A5A40]/40 hover:bg-[#f5f5f0] transition-all">
                <X size={18} />
              </button>
            </div>
            <div className="p-8 space-y-5">
              {[
                { label: 'Название компании', val: form.name, key: 'name' },
                { label: 'Контактный телефон', val: form.contact, key: 'contact' },
                { label: 'Юридический адрес', val: form.address, key: 'address' },
              ].map((f) => (
                <div key={f.key} className="space-y-1.5 focus-within:translate-x-1 transition-transform">
                  <label className="text-[9px] uppercase tracking-widest text-[#5A5A40]/40 font-normal px-1">{f.label}</label>
                  <input
                    className="w-full px-4 py-3.5 bg-[#f8f7f2] border border-transparent rounded-2xl text-sm font-normal outline-none focus:bg-white focus:border-[#5A5A40]/20 transition-all"
                    value={f.val}
                    onChange={(e) => setForm({...form, [f.key as keyof SupplierForm]: e.target.value})}
                  />
                </div>
              ))}
              {error && <p className="text-[10px] text-red-500 font-normal px-1">{error}</p>}
            </div>
            <div className="p-8 pt-0 flex gap-3">
              <button onClick={() => setIsAddOpen(false)} className="flex-1 py-4 border border-[#5A5A40]/10 rounded-2xl text-sm font-normal text-[#5A5A40]/40 hover:bg-[#f5f5f0] transition-all">Отмена</button>
              <button onClick={saveSupplier} disabled={submitting} className="flex-[2] py-4 bg-[#5A5A40] text-white rounded-2xl text-sm font-normal hover:bg-[#4A4A30] active:scale-95 transition-all disabled:opacity-50 shadow-lg shadow-[#5A5A40]/20">{submitting ? '...' : 'Сохранить изменения'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-[#151619]/40 backdrop-blur-md p-4 animate-in fade-in duration-300">
          <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-sm overflow-hidden border border-red-50">
            <div className="p-8 text-center space-y-4">
              <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center text-red-500 mx-auto mb-2 animate-bounce"><Trash2 size={30} /></div>
              <h3 className="text-xl font-normal text-[#151619] tracking-tight">Удалить партнера?</h3>
              <p className="text-xs text-[#5A5A40]/60 font-normal leading-relaxed">Вы уверены, что хотите удалить <span className="text-[#151619] font-normal underline decoration-red-200 underline-offset-4">{deleteTarget.name}</span>?</p>
              <div className="flex gap-3 pt-4 font-normal">
                <button onClick={() => setDeleteTarget(null)} className="flex-1 py-3 text-sm text-[#5A5A40]/50 hover:bg-[#f5f5f0] rounded-2xl transition-all">Отмена</button>
                <button onClick={async () => { await deleteSupplier(deleteTarget.id); setDeleteTarget(null); }} className="flex-1 py-3 bg-red-500 text-white text-sm rounded-2xl hover:bg-red-600 transition-all shadow-lg shadow-red-200">Удалить</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Shared Modals */}
      {paymentModal && (
        <SupplierPaymentModal
          isOpen={!!paymentModal}
          onClose={() => setPaymentModal(null)}
          invoice={paymentModal.invoice}
          currencyCode="TJS"
          busyId={busyId}
          setBusyId={setBusyId}
          getInvoiceOutstandingAmount={(invoice) => Number(invoice?.debtAmount || 0)}
          onPaymentSuccess={() => {
            const sid = paymentModal.supplierId;
            setPaymentModal(null);
            void loadSupplierDetails(sid, true);
          }}
        />
      )}
    </div>
  );
};

const CheckCircle2 = ({ size }: { size: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
);

export default SuppliersPage;
