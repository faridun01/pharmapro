import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, Plus, Truck, Phone, Mail, MapPin, Edit3, Trash2, Package, DollarSign, X, CalendarClock, AlertTriangle } from 'lucide-react';
import { buildApiHeaders } from '../../infrastructure/api';
import { useDebounce } from '../../lib/useDebounce';
import { SupplierPaymentModal } from './suppliers/SupplierPaymentModal';

type SupplierRecord = {
  id: string;
  name: string;
  contact?: string | null;
  email?: string | null;
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
  email: string;
  address: string;
};

const INITIAL_FORM: SupplierForm = {
  name: '',
  contact: '',
  email: '',
  address: '',
};

const formatMoney = (value: number) => `${Number(value || 0).toFixed(2)} TJS`;

export const SuppliersPage: React.FC = () => {
  const { t } = useTranslation();
  const [suppliers, setSuppliers] = useState<SupplierRecord[]>([]);
  const [supplierStats, setSupplierStats] = useState<Record<string, SupplierOverview>>({});
  const [openSupplierId, setOpenSupplierId] = useState<string | null>(null);
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

  const request = async (url: string, init?: RequestInit) => {
    const response = await fetch(url, {
      ...init,
      headers: {
        ...(await buildApiHeaders()),
        ...(init?.headers || {}),
      },
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(payload?.error || payload?.message || 'Request failed');
    }
    return payload;
  };

  const loadSuppliers = async () => {
    setInitialLoadPending(true);
    try {
      const data = await request('/api/suppliers/full');
      if (Array.isArray(data)) {
        setSuppliers(data.map(s => ({ id: s.id, name: s.name, contact: s.contact, email: s.email, address: s.address })));
        const statsMap: Record<string, any> = {};
        for (const s of data) {
          if (s.summary) {
            statsMap[s.id] = { summary: s.summary };
          }
        }
        setSupplierStats(statsMap);
      }
      setError('');
    } catch (err: any) {
      setError(err.message || 'Failed to fetch suppliers');
    } finally {
      setInitialLoadPending(false);
    }
  };

  const loadSupplierDetails = async (supplierId: string, force = false) => {
    if (!force && supplierStats[supplierId]?.invoices) return supplierStats[supplierId];
    setDetailLoading(supplierId);
    try {
      const overview = await request(`/api/suppliers/${supplierId}/summary`);
      setSupplierStats((prev) => ({ ...prev, [supplierId]: overview }));
      return overview as SupplierOverview;
    } finally {
      setDetailLoading((current) => (current === supplierId ? null : current));
    }
  };

  useEffect(() => {
    void loadSuppliers();
  }, []);

  const filteredSuppliers = useMemo(() => suppliers.filter((supplier) => {
    const query = debouncedSearchTerm.trim().toLocaleLowerCase('ru-RU');
    if (!query) return true;
    return [supplier.name, supplier.contact, supplier.email, supplier.address]
      .some((value) => String(value || '').toLocaleLowerCase('ru-RU').includes(query));
  }), [suppliers, debouncedSearchTerm]);

  const selectedSupplier = openSupplierId ? suppliers.find((supplier) => supplier.id === openSupplierId) || null : null;
  const selectedStats = openSupplierId ? supplierStats[openSupplierId] : null;

  const openAdd = () => {
    setForm(INITIAL_FORM);
    setEditingSupplierId(null);
    setError('');
    setIsAddOpen(true);
  };

  const openEdit = (supplier: SupplierRecord) => {
    setForm({
      name: supplier.name || '',
      contact: supplier.contact || '',
      email: supplier.email || '',
      address: supplier.address || '',
    });
    setEditingSupplierId(supplier.id);
    setError('');
    setIsAddOpen(true);
  };

  const saveSupplier = async () => {
    if (!form.name.trim()) {
      setError(t('Supplier name is required'));
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      await request(editingSupplierId ? `/api/suppliers/${editingSupplierId}` : '/api/suppliers', {
        method: editingSupplierId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          contact: form.contact.trim() || null,
          email: form.email.trim() || null,
          address: form.address.trim() || null,
        }),
      });

      await loadSuppliers();
      if (editingSupplierId) {
        await loadSupplierDetails(editingSupplierId, true);
      }
      setIsAddOpen(false);
      setEditingSupplierId(null);
    } catch (err: any) {
      setError(err.message || t('Failed to save supplier'));
    } finally {
      setSubmitting(false);
    }
  };

  const deleteSupplier = async (supplierId: string) => {
    setSubmitting(true);
    setError('');
    try {
      const headers = await buildApiHeaders();
      const response = await fetch(`/api/suppliers/${supplierId}`, {
        method: 'DELETE',
        headers,
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || payload?.message || t('Failed to delete supplier'));
      }

      setSupplierStats((prev) => {
        const next = { ...prev };
        delete next[supplierId];
        return next;
      });
      if (openSupplierId === supplierId) {
        setOpenSupplierId(null);
      }
      await loadSuppliers();
    } catch (err: any) {
      setError(err.message || t('Failed to delete supplier'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleOpenDetails = async (supplierId: string) => {
    setOpenSupplierId(supplierId);
    try {
      await loadSupplierDetails(supplierId);
    } catch (err: any) {
      setError(err.message || 'Failed to load supplier details');
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="rounded-[30px] border border-white/70 bg-white/80 p-6 shadow-sm backdrop-blur-md">
          <p className="text-[10px] font-bold text-[#5A5A40]/40 uppercase tracking-widest mb-2">Всего поставщиков</p>
          <p className="text-3xl font-black text-[#5A5A40]">{suppliers.length}</p>
        </div>
        <div className="rounded-[30px] border border-white/70 bg-white/80 p-6 shadow-sm backdrop-blur-md">
          <p className="text-[10px] font-bold text-[#5A5A40]/40 uppercase tracking-widest mb-2">Общий оборот</p>
          <p className="text-3xl font-black text-[#5A5A40]">
            {formatMoney(Object.values(supplierStats).reduce((sum, s) => sum + (s.summary?.totalAmount || 0), 0))}
          </p>
        </div>
        <div className="rounded-[30px] border border-white/70 bg-white/80 p-6 shadow-sm backdrop-blur-md">
          <p className="text-[10px] font-bold text-red-400/60 uppercase tracking-widest mb-2">Общий долг</p>
          <p className="text-3xl font-black text-red-600">
            {formatMoney(Object.values(supplierStats).reduce((sum, s) => sum + (s.summary?.totalDebt || 0), 0))}
          </p>
        </div>
        <div className="rounded-[30px] border border-white/70 bg-white/80 p-6 shadow-sm backdrop-blur-md">
          <p className="text-[10px] font-bold text-amber-400/60 uppercase tracking-widest mb-2">Просрочено</p>
          <p className="text-3xl font-black text-amber-600">
            {formatMoney(Object.values(supplierStats).reduce((sum, s) => sum + (s.summary?.overdueDebt || 0), 0))}
          </p>
        </div>
      </div>

      <div className="rounded-[30px] border border-white/70 bg-white/80 p-4 shadow-[0_18px_45px_rgba(90,90,64,0.08)] backdrop-blur-md md:p-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center rounded-full bg-[#f1eee3] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-[#5A5A40]/55">
              Найдено: {filteredSuppliers.length}
            </span>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative group">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-[#5A5A40]/30" size={18} />
              <input
                type="text"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder={t('Search suppliers...')}
                className="w-full min-w-0 pl-12 pr-4 py-3 bg-white border border-[#5A5A40]/10 rounded-2xl text-sm outline-none focus:ring-2 focus:ring-[#5A5A40]/20 shadow-sm sm:w-72"
              />
            </div>
            <button onClick={openAdd} className="bg-[#5A5A40] text-white px-6 py-3 rounded-2xl font-medium shadow-lg hover:bg-[#4A4A30] transition-all flex items-center gap-2">
              <Plus size={20} />
              Бизнес-партнер
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {initialLoadPending && suppliers.length === 0 && Array.from({ length: 6 }).map((_, index) => (
          <div key={`supplier-skeleton-${index}`} className="bg-white p-6 rounded-3xl shadow-sm border border-[#5A5A40]/5 animate-pulse">
            <div className="h-14 w-14 rounded-2xl bg-[#f5f5f0]" />
            <div className="mt-6 h-6 w-2/3 rounded-full bg-[#f5f5f0]" />
            <div className="mt-5 space-y-3">
              <div className="h-4 rounded-full bg-[#f5f5f0]" />
              <div className="h-4 rounded-full bg-[#f5f5f0]" />
              <div className="h-4 rounded-full bg-[#f5f5f0]" />
            </div>
          </div>
        ))}

        {!initialLoadPending && filteredSuppliers.length === 0 && (
          <div className="md:col-span-2 xl:col-span-3 rounded-3xl border border-[#5A5A40]/10 bg-white px-6 py-12 text-center text-[#5A5A40]/50">
            Поставщики не найдены.
          </div>
        )}

        {filteredSuppliers.map((supplier) => {
          const stats = supplierStats[supplier.id];
          const summary = stats?.summary;
          const nearestBatch = stats?.batchList?.[0];

          return (
            <div
              key={supplier.id}
              className="bg-white p-6 rounded-3xl shadow-sm border border-[#5A5A40]/5 hover:-translate-y-1 hover:shadow-xl transition-all group cursor-pointer"
              onClick={() => void handleOpenDetails(supplier.id)}
            >
              <div className="flex justify-between items-start mb-6">
                <div className="w-14 h-14 bg-[#f5f5f0] rounded-2xl flex items-center justify-center text-[#5A5A40] group-hover:bg-[#5A5A40] group-hover:text-white transition-colors">
                  <Truck size={28} />
                </div>
                <div className="flex flex-col items-end gap-2">
                  <div className="flex items-center gap-1">
                    <button
                      onClick={(event) => {
                        event.stopPropagation();
                        openEdit(supplier);
                      }}
                      disabled={submitting}
                      className="p-2 text-[#5A5A40]/30 hover:text-[#5A5A40] hover:bg-[#f5f5f0] rounded-xl transition-all disabled:opacity-50"
                      title={t('Edit Supplier')}
                    >
                      <Edit3 size={18} />
                    </button>
                    <button
                      onClick={(event) => {
                        event.stopPropagation();
                        setDeleteTarget({ id: supplier.id, name: supplier.name });
                      }}
                      disabled={submitting}
                      className="p-2 text-[#5A5A40]/30 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all disabled:opacity-50"
                      title={t('Delete Supplier')}
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                  {summary?.lastInvoiceDate && (
                    <span className="text-[9px] uppercase font-bold text-[#5A5A40]/30 tracking-widest">
                      Last: {new Date(summary.lastInvoiceDate).toLocaleDateString()}
                    </span>
                  )}
                </div>
              </div>

              <h3 className="text-lg font-bold text-[#5A5A40] mb-2">{supplier.name}</h3>
              <p className="text-xs text-[#5A5A40]/40 mb-4 truncate">{supplier.address || t('No address provided')}</p>

              <div className="space-y-2 mb-6">
                <div className="flex items-center gap-3 text-sm text-[#5A5A40]/60">
                  <Phone size={14} className="text-[#5A5A40]/20" />
                  <span className="text-xs">{supplier.contact || '—'}</span>
                </div>
                <div className="flex items-center gap-3 text-sm text-[#5A5A40]/60">
                  <Mail size={14} className="text-[#5A5A40]/20" />
                  <span className="text-xs truncate">{supplier.email || '—'}</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 pt-6 border-t border-[#5A5A40]/5">
                <div className="bg-[#f5f5f0]/50 p-4 rounded-2xl">
                  <p className="text-[9px] font-bold text-[#5A5A40]/30 uppercase tracking-widest mb-2">Активно</p>
                  <div className="flex items-center gap-2">
                    <div className="flex flex-col">
                       <span className="text-sm font-black text-[#5A5A40]">{summary?.invoiceCount || 0}</span>
                       <span className="text-[8px] text-[#5A5A40]/40 uppercase font-black">Закупок</span>
                    </div>
                  </div>
                </div>
                <div className="bg-[#5A5A40]/5 p-4 rounded-2xl">
                  <p className="text-[9px] font-bold text-[#5A5A40]/30 uppercase tracking-widest mb-2">Баланс</p>
                  <div className="flex flex-col">
                     <span className={`text-sm font-black ${(summary?.totalDebt || 0) > 0 ? 'text-red-500' : 'text-emerald-600'}`}>
                       {summary ? formatMoney(summary.totalDebt) : '0.00 TJS'}
                     </span>
                     <span className="text-[8px] text-[#5A5A40]/40 uppercase font-black">Долг</span>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {openSupplierId && selectedSupplier && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-5xl max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-[#5A5A40]/10 flex items-center justify-between">
              <div>
                <h3 className="text-xl font-bold text-[#5A5A40]">{selectedSupplier.name}</h3>
                <p className="text-sm text-[#5A5A40]/55 mt-1">История закупок, задолженности и партий поставщика</p>
              </div>
              <button onClick={() => setOpenSupplierId(null)} className="p-2 rounded-xl hover:bg-[#f5f5f0]">
                <X size={18} />
              </button>
            </div>

            <div className="p-6 space-y-6">
              {detailLoading === openSupplierId && !selectedStats ? (
                <div className="rounded-2xl border border-[#5A5A40]/10 bg-[#f8f7f2] px-4 py-8 text-center text-[#5A5A40]/50">
                  Загружаю данные поставщика…
                </div>
              ) : selectedStats ? (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div className="rounded-2xl border border-[#5A5A40]/10 bg-[#f8f7f2] p-4">
                      <p className="text-xs uppercase tracking-widest text-[#5A5A40]/45 font-bold">Закупок</p>
                      <p className="mt-2 text-2xl font-bold text-[#5A5A40]">{selectedStats.summary.invoiceCount}</p>
                    </div>
                    <div className="rounded-2xl border border-[#5A5A40]/10 bg-[#f8f7f2] p-4">
                      <p className="text-xs uppercase tracking-widest text-[#5A5A40]/45 font-bold">Общая сумма</p>
                      <p className="mt-2 text-2xl font-bold text-[#5A5A40]">{formatMoney(selectedStats.summary.totalAmount)}</p>
                    </div>
                    <div className="rounded-2xl border border-[#5A5A40]/10 bg-[#fff5f5] p-4">
                      <p className="text-xs uppercase tracking-widest text-[#5A5A40]/45 font-bold">Текущий долг</p>
                      <p className="mt-2 text-2xl font-bold text-red-700">{formatMoney(selectedStats.summary.totalDebt)}</p>
                    </div>
                    <div className="rounded-2xl border border-[#5A5A40]/10 bg-[#fffaf0] p-4">
                      <p className="text-xs uppercase tracking-widest text-[#5A5A40]/45 font-bold">Просроченный долг</p>
                      <p className="mt-2 text-2xl font-bold text-amber-700">{formatMoney(selectedStats.summary.overdueDebt)}</p>
                    </div>
                  </div>

                  <div>
                    <h4 className="text-sm font-bold mb-3">Приходы и оплаты</h4>
                    <div className="overflow-x-auto rounded-2xl border border-[#5A5A40]/10">
                      <table className="min-w-full text-sm">
                        <thead className="bg-[#f8f7f2] text-[#5A5A40]/60">
                          <tr>
                            <th className="px-4 py-3 text-left">Номер</th>
                            <th className="px-4 py-3 text-left">Дата</th>
                            <th className="px-4 py-3 text-right">Товаров</th>
                            <th className="px-4 py-3 text-right">Сумма</th>
                            <th className="px-4 py-3 text-right">Оплачено</th>
                            <th className="px-4 py-3 text-right">Долг</th>
                            <th className="px-4 py-3 text-center">Статус</th>
                            <th className="px-4 py-3 text-center">Действие</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedStats.invoices.map((invoice) => (
                            <tr key={invoice.id} className="border-t border-[#5A5A40]/10">
                              <td className="px-4 py-3 font-medium text-[#5A5A40]">{invoice.invoiceNumber}</td>
                              <td className="px-4 py-3 text-[#5A5A40]/70">{invoice.invoiceDate ? new Date(invoice.invoiceDate).toLocaleDateString() : '—'}</td>
                              <td className="px-4 py-3 text-right text-[#5A5A40]/70">{invoice.itemCount}</td>
                              <td className="px-4 py-3 text-right">{formatMoney(invoice.totalAmount)}</td>
                              <td className="px-4 py-3 text-right text-emerald-700">{formatMoney(invoice.paidAmount)}</td>
                              <td className="px-4 py-3 text-right font-semibold text-red-700">{formatMoney(invoice.debtAmount)}</td>
                              <td className="px-4 py-3 text-center">
                                <span className="inline-flex rounded-full bg-[#f5f5f0] px-3 py-1 text-xs font-semibold text-[#5A5A40]">
                                  {invoice.paymentStatus}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-center">
                                {invoice.debtAmount > 0 ? (
                                  <button
                                    className="inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-emerald-100 text-emerald-700 text-xs font-semibold hover:bg-emerald-200"
                                    onClick={() => setPaymentModal({ invoice, supplierId: openSupplierId })}
                                    disabled={busyId === invoice.id}
                                  >
                                    <DollarSign size={14} /> Оплатить
                                  </button>
                                ) : (
                                  <span className="text-xs text-[#5A5A40]/35">Закрыто</span>
                                )}
                              </td>
                            </tr>
                          ))}
                          {selectedStats.invoices.length === 0 && (
                            <tr>
                              <td colSpan={8} className="px-4 py-8 text-center text-[#5A5A40]/45">По поставщику еще нет приходов</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div>
                    <h4 className="text-sm font-bold mb-3">Активные партии</h4>
                    <div className="overflow-x-auto rounded-2xl border border-[#5A5A40]/10">
                      <table className="min-w-full text-sm">
                        <thead className="bg-[#f8f7f2] text-[#5A5A40]/60">
                          <tr>
                            <th className="px-4 py-3 text-left">Партия</th>
                            <th className="px-4 py-3 text-left">Товар</th>
                            <th className="px-4 py-3 text-right">Кол-во</th>
                            <th className="px-4 py-3 text-right">Себест.</th>
                            <th className="px-4 py-3 text-right">Срок годн.</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedStats.batchList.map((batch) => {
                            const daysLeft = Math.ceil((new Date(batch.expiryDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
                            return (
                              <tr key={batch.id} className="border-t border-[#5A5A40]/10">
                                <td className="px-4 py-3 font-medium text-[#5A5A40]">{batch.batchNumber}</td>
                                <td className="px-4 py-3">
                                  <div className="text-[#5A5A40]">{batch.productName}</div>
                                  <div className="text-xs text-[#5A5A40]/45">{batch.productSku}</div>
                                </td>
                                <td className="px-4 py-3 text-right">{batch.quantity}</td>
                                <td className="px-4 py-3 text-right">{formatMoney(batch.costBasis)}</td>
                                <td className="px-4 py-3 text-right">
                                  <div className="inline-flex items-center gap-2">
                                    {daysLeft <= 30 && <AlertTriangle size={14} className="text-amber-600" />}
                                    <span className={daysLeft <= 30 ? 'text-amber-700 font-semibold' : 'text-[#5A5A40]/70'}>
                                      {new Date(batch.expiryDate).toLocaleDateString()}
                                    </span>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                          {selectedStats.batchList.length === 0 && (
                            <tr>
                              <td colSpan={5} className="px-4 py-8 text-center text-[#5A5A40]/45">Нет активных партий этого поставщика</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div>
                    <h4 className="text-sm font-bold mb-3">Последние оплаты</h4>
                    <div className="overflow-x-auto rounded-2xl border border-[#5A5A40]/10">
                      <table className="min-w-full text-sm">
                        <thead className="bg-[#f8f7f2] text-[#5A5A40]/60">
                          <tr>
                            <th className="px-4 py-3 text-left">Дата</th>
                            <th className="px-4 py-3 text-left">Метод</th>
                            <th className="px-4 py-3 text-right">Сумма</th>
                            <th className="px-4 py-3 text-left">Комментарий</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedStats.payments.map((payment) => (
                            <tr key={payment.id} className="border-t border-[#5A5A40]/10">
                              <td className="px-4 py-3">
                                <div className="inline-flex items-center gap-2 text-[#5A5A40]/70">
                                  <CalendarClock size={14} />
                                  {payment.paymentDate ? new Date(payment.paymentDate).toLocaleString() : '—'}
                                </div>
                              </td>
                              <td className="px-4 py-3">{payment.method}</td>
                              <td className="px-4 py-3 text-right font-semibold text-emerald-700">{formatMoney(payment.amount)}</td>
                              <td className="px-4 py-3 text-[#5A5A40]/70">{payment.comment || '—'}</td>
                            </tr>
                          ))}
                          {selectedStats.payments.length === 0 && (
                            <tr>
                              <td colSpan={4} className="px-4 py-8 text-center text-[#5A5A40]/45">Оплат по поставщику пока нет</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              ) : null}
            </div>
          </div>
        </div>
      )}

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
            const supplierId = paymentModal.supplierId;
            setPaymentModal(null);
            void loadSupplierDetails(supplierId, true);
          }}
        />
      )}

      {isAddOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg">
            <div className="p-6 border-b border-[#5A5A40]/10">
              <h3 className="text-xl font-bold text-[#5A5A40]">{editingSupplierId ? t('Edit Supplier') : t('Add Supplier')}</h3>
            </div>
            <div className="p-6 space-y-4">
              <input className="w-full px-4 py-3 border border-[#5A5A40]/10 rounded-xl" placeholder={t('Name')} value={form.name} onChange={(event) => setForm((state) => ({ ...state, name: event.target.value }))} />
              <input className="w-full px-4 py-3 border border-[#5A5A40]/10 rounded-xl" placeholder={t('Contact')} value={form.contact} onChange={(event) => setForm((state) => ({ ...state, contact: event.target.value }))} />
              <input className="w-full px-4 py-3 border border-[#5A5A40]/10 rounded-xl" placeholder="Email" value={form.email} onChange={(event) => setForm((state) => ({ ...state, email: event.target.value }))} />
              <input className="w-full px-4 py-3 border border-[#5A5A40]/10 rounded-xl" placeholder={t('Address')} value={form.address} onChange={(event) => setForm((state) => ({ ...state, address: event.target.value }))} />
              {error && <p className="text-red-500 text-sm">{error}</p>}
            </div>
            <div className="p-6 border-t border-[#5A5A40]/10 flex justify-end gap-3">
              <button onClick={() => { setIsAddOpen(false); setEditingSupplierId(null); }} className="px-5 py-2.5 border border-[#5A5A40]/20 rounded-xl">{t('Cancel')}</button>
              <button onClick={saveSupplier} disabled={submitting} className="px-5 py-2.5 bg-[#5A5A40] text-white rounded-xl disabled:opacity-50">
                {submitting ? t('Saving...') : (editingSupplierId ? t('Update Supplier') : t('Save Supplier'))}
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden border border-[#5A5A40]/10">
            <div className="p-5 bg-red-600 text-white flex items-center justify-between">
              <h3 className="text-lg font-bold">{t('Delete Supplier')}</h3>
              <button onClick={() => setDeleteTarget(null)} className="p-1.5 rounded-lg hover:bg-white/10 transition-colors">
                <X size={18} />
              </button>
            </div>
            <div className="p-6 space-y-5">
              <p className="text-sm text-[#5A5A40]/80">
                {t('Delete supplier')}: <span className="font-semibold">{deleteTarget.name}</span>?
              </p>
              <div className="flex justify-end gap-3">
                <button onClick={() => setDeleteTarget(null)} className="px-5 py-2.5 border border-[#5A5A40]/20 rounded-xl">
                  {t('Cancel')}
                </button>
                <button
                  onClick={async () => {
                    const target = deleteTarget;
                    if (!target) return;
                    await deleteSupplier(target.id);
                    setDeleteTarget(null);
                  }}
                  disabled={submitting}
                  className="px-5 py-2.5 bg-red-600 text-white rounded-xl disabled:opacity-50"
                >
                  {submitting ? t('Deleting...') : t('Delete Supplier')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SuppliersPage;
