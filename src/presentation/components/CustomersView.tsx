import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usePharmacy } from '../context';
import { useDebounce } from '../../lib/useDebounce';
import { loadPdfDependencies, loadXlsx } from '../../lib/lazyLoaders';
import {
  Search,
  Plus,
  UserRound,
  Phone,
  MapPin,
  Edit3,
  Trash2,
  X,
  Mail,
  Calendar,
  Wallet,
  Filter,
  ArrowDownUp,
  FileDown,
  FileSpreadsheet,
} from 'lucide-react';

type CustomerFilterMode = 'ALL' | 'WITH_DEBT' | 'OVERDUE' | 'TOP_BUYERS' | 'VIP' | 'NEW_NO_HISTORY';
type CustomerSortMode = 'NAME' | 'PURCHASE_DESC' | 'DEBT_DESC' | 'PAYMENT_DESC';

const VIP_PURCHASE_THRESHOLD = 20000;
const VIP_CREDIT_LIMIT_THRESHOLD = 5000;

type CustomerForm = {
  name: string;
  code: string;
  phone: string;
  address: string;
  paymentTermDays: string;
};

const INITIAL_FORM: CustomerForm = {
  name: '',
  code: '',
  phone: '',
  address: '',
  paymentTermDays: '',
};

const generateCustomerCodePreview = (customers: Array<{ code?: string }>) => {
  const maxNumber = customers.reduce((currentMax, customer) => {
    const nextNumber = Number(String(customer.code || '').match(/(\d+)$/)?.[1] || 0);
    return Math.max(currentMax, nextNumber);
  }, 0);

  return `CUST-${String(maxNumber + 1).padStart(4, '0')}`;
};

function authHeaders() {
  const token = localStorage.getItem('pharmapro_token') || sessionStorage.getItem('pharmapro_token');
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export const CustomersView: React.FC = () => {
  const { t } = useTranslation();
  const { customers, refreshCustomers } = usePharmacy();

  const [searchTerm, setSearchTerm] = useState('');
  const [expandedCustomerId, setExpandedCustomerId] = useState<string | null>(null);
  const [filterMode, setFilterMode] = useState<CustomerFilterMode>('ALL');
  const [sortMode, setSortMode] = useState<CustomerSortMode>('NAME');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [form, setForm] = useState<CustomerForm>(INITIAL_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [exportingCustomerId, setExportingCustomerId] = useState<string | null>(null);
  const [error, setError] = useState('');

  // Debounce search to 300ms to avoid filtering on every keystroke
  const debouncedSearchTerm = useDebounce(searchTerm, 300);

  const formatMoney = (value: number) => `${Number(value || 0).toFixed(2)} TJS`;
  const formatDateTime = (value?: string | null) => value ? new Date(value).toLocaleString('ru-RU') : '—';
  const formatDate = (value?: string | null) => value ? new Date(value).toLocaleDateString('ru-RU') : '—';
  const isVipCustomer = (customer: typeof customers[number]) => Number(customer.summary?.totalPurchased || 0) >= VIP_PURCHASE_THRESHOLD || Number(customer.creditLimit || 0) >= VIP_CREDIT_LIMIT_THRESHOLD;

  const filteredCustomers = useMemo(() => {
    const term = debouncedSearchTerm.trim().toLowerCase();
    return customers
      .filter((c) => {
        const matchesTerm = !term || c.name.toLowerCase().includes(term)
          || (c.code || '').toLowerCase().includes(term)
          || (c.phone || '').toLowerCase().includes(term)
          || (c.email || '').toLowerCase().includes(term)
          || (c.managerName || '').toLowerCase().includes(term)
          || (c.address || '').toLowerCase().includes(term);

        if (!matchesTerm) return false;

        const totalDebt = Number(c.summary?.totalDebt || 0);
        const overdueDebt = Number(c.summary?.overdueDebt || 0);
        const totalPurchased = Number(c.summary?.totalPurchased || 0);
        const invoiceCount = Number(c.summary?.invoiceCount || 0);
        const isVip = isVipCustomer(c);

        if (filterMode === 'WITH_DEBT') return totalDebt > 0;
        if (filterMode === 'OVERDUE') return overdueDebt > 0;
        if (filterMode === 'TOP_BUYERS') return totalPurchased > 0;
        if (filterMode === 'VIP') return isVip;
        if (filterMode === 'NEW_NO_HISTORY') return invoiceCount === 0;
        return true;
      })
      .sort((left, right) => {
        if (sortMode === 'PURCHASE_DESC') return Number(right.summary?.totalPurchased || 0) - Number(left.summary?.totalPurchased || 0);
        if (sortMode === 'DEBT_DESC') return Number(right.summary?.totalDebt || 0) - Number(left.summary?.totalDebt || 0);
        if (sortMode === 'PAYMENT_DESC') return Number(right.summary?.totalPaid || 0) - Number(left.summary?.totalPaid || 0);
        return left.name.localeCompare(right.name, 'ru-RU');
      });
  }, [customers, debouncedSearchTerm, filterMode, sortMode]);

  const totals = useMemo(() => ({
    purchased: filteredCustomers.reduce((sum, customer) => sum + Number(customer.summary?.totalPurchased || 0), 0),
    paid: filteredCustomers.reduce((sum, customer) => sum + Number(customer.summary?.totalPaid || 0), 0),
    debt: filteredCustomers.reduce((sum, customer) => sum + Number(customer.summary?.totalDebt || 0), 0),
    overdue: filteredCustomers.reduce((sum, customer) => sum + Number(customer.summary?.overdueDebt || 0), 0),
  }), [filteredCustomers]);

  const exportCustomerHistoryXlsx = async (customer: typeof customers[number]) => {
    setExportingCustomerId(customer.id);
    setError('');
    try {
      const XLSX = await loadXlsx();
      const workbook = XLSX.utils.book_new();

      const summarySheet = XLSX.utils.aoa_to_sheet([
        ['Показатель', 'Значение'],
        ['Клиент', customer.name],
        ['Код', customer.code || ''],
        ['Покупки', Number(customer.summary?.totalPurchased || 0)],
        ['Оплаты', Number(customer.summary?.totalPaid || 0)],
        ['Долг', Number(customer.summary?.totalDebt || 0)],
        ['Просрочено', Number(customer.summary?.overdueDebt || 0)],
        ['Накладных', Number(customer.summary?.invoiceCount || 0)],
      ]);
      XLSX.utils.book_append_sheet(workbook, summarySheet, 'Сводка');

      const invoicesSheet = XLSX.utils.aoa_to_sheet([
        ['Накладная', 'Дата', 'Сумма', 'Статус оплаты', 'Статус', 'Остаток', 'Позиции'],
        ...((customer.history?.recentInvoices || []).map((invoice) => [
          invoice.invoiceNo,
          formatDateTime(invoice.createdAt),
          Number(invoice.totalAmount || 0),
          invoice.paymentStatus || '',
          invoice.status,
          Number(invoice.outstandingAmount || 0),
          Number(invoice.itemCount || 0),
        ])),
      ]);
      XLSX.utils.book_append_sheet(workbook, invoicesSheet, 'Покупки');

      const paymentsSheet = XLSX.utils.aoa_to_sheet([
        ['Дата', 'Сумма', 'Метод', 'Накладная', 'Комментарий'],
        ...((customer.history?.recentPayments || []).map((payment) => [
          formatDateTime(payment.paymentDate),
          Number(payment.amount || 0),
          payment.method,
          payment.invoiceNo || '',
          payment.comment || '',
        ])),
      ]);
      XLSX.utils.book_append_sheet(workbook, paymentsSheet, 'Оплаты');

      const debtSheet = XLSX.utils.aoa_to_sheet([
        ['Накладная', 'Остаток', 'Срок', 'Статус', 'Создан'],
        ...((customer.history?.openReceivables || []).map((receivable) => [
          receivable.invoiceNo || '',
          Number(receivable.remainingAmount || 0),
          formatDate(receivable.dueDate),
          receivable.status,
          formatDateTime(receivable.createdAt),
        ])),
      ]);
      XLSX.utils.book_append_sheet(workbook, debtSheet, 'Долги');

      XLSX.writeFile(workbook, `customer-history-${(customer.code || customer.name).replace(/\s+/g, '-').toLowerCase()}.xlsx`);
    } catch (e: any) {
      setError(e?.message || 'Не удалось выгрузить Excel');
    } finally {
      setExportingCustomerId(null);
    }
  };

  const exportCustomerHistoryPdf = async (customer: typeof customers[number]) => {
    setExportingCustomerId(customer.id);
    setError('');
    try {
      const [{ jspdf, autoTable }] = await Promise.all([
        loadPdfDependencies(),
      ]);
      const jsPDF = jspdf;
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const autoTableFn = (autoTable as any).default || autoTable;

      doc.setFontSize(18);
      doc.text(`История клиента: ${customer.name}`, 14, 18);
      doc.setFontSize(10);
      doc.text(`Код: ${customer.code || '-'} | Покупки: ${formatMoney(Number(customer.summary?.totalPurchased || 0))} | Долг: ${formatMoney(Number(customer.summary?.totalDebt || 0))}`, 14, 26);

      autoTableFn(doc, {
        startY: 32,
        head: [['Сводка', 'Значение']],
        body: [
          ['Оплаты', formatMoney(Number(customer.summary?.totalPaid || 0))],
          ['Просрочено', formatMoney(Number(customer.summary?.overdueDebt || 0))],
          ['Накладных', String(Number(customer.summary?.invoiceCount || 0))],
          ['Последняя накладная', formatDateTime(customer.summary?.lastInvoiceAt)],
          ['Последняя оплата', formatDateTime(customer.summary?.lastPaymentAt)],
        ],
      });

      autoTableFn(doc, {
        startY: (doc as any).lastAutoTable.finalY + 8,
        head: [['Накладная', 'Дата', 'Сумма', 'Остаток']],
        body: (customer.history?.recentInvoices || []).map((invoice) => [
          invoice.invoiceNo,
          formatDateTime(invoice.createdAt),
          formatMoney(Number(invoice.totalAmount || 0)),
          formatMoney(Number(invoice.outstandingAmount || 0)),
        ]),
      });

      autoTableFn(doc, {
        startY: (doc as any).lastAutoTable.finalY + 8,
        head: [['Дата оплаты', 'Сумма', 'Метод', 'Накладная']],
        body: (customer.history?.recentPayments || []).map((payment) => [
          formatDateTime(payment.paymentDate),
          formatMoney(Number(payment.amount || 0)),
          payment.method,
          payment.invoiceNo || '-',
        ]),
      });

      doc.save(`customer-history-${(customer.code || customer.name).replace(/\s+/g, '-').toLowerCase()}.pdf`);
    } catch (e: any) {
      setError(e?.message || 'Не удалось выгрузить PDF');
    } finally {
      setExportingCustomerId(null);
    }
  };

  const openCreate = () => {
    setEditingId(null);
    setForm({
      ...INITIAL_FORM,
      code: generateCustomerCodePreview(customers),
    });
    setError('');
    setIsModalOpen(true);
  };

  const openEdit = (customer: typeof customers[number]) => {
    setEditingId(customer.id);
    setForm({
      name: customer.name || '',
      code: customer.code || '',
      phone: customer.phone || '',
      address: customer.address || '',
      paymentTermDays: customer.paymentTermDays == null ? '' : String(customer.paymentTermDays),
    });
    setError('');
    setIsModalOpen(true);
  };

  const saveCustomer = async () => {
    if (!form.name.trim()) {
      setError('Введите имя клиента');
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      const payload = {
        name: form.name.trim(),
        code: editingId ? (form.code.trim() || null) : null,
        phone: form.phone.trim() || null,
        address: form.address.trim() || null,
        creditLimit: 0,
        defaultDiscount: 0,
        paymentTermDays: form.paymentTermDays.trim() ? Number(form.paymentTermDays) : null,
      };

      const response = await fetch(editingId ? `/api/customers/${editingId}` : '/api/customers', {
        method: editingId ? 'PUT' : 'POST',
        headers: authHeaders(),
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || 'Не удалось сохранить клиента');
      }

      await refreshCustomers(true);
      setIsModalOpen(false);
      setEditingId(null);
    } catch (e: any) {
      setError(e?.message || 'Не удалось сохранить клиента');
    } finally {
      setSubmitting(false);
    }
  };

  const deleteCustomer = async (id: string) => {
    setSubmitting(true);
    setError('');
    try {
      const response = await fetch(`/api/customers/${id}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || 'Не удалось удалить клиента');
      }
      await refreshCustomers(true);
      setDeleteTarget(null);
    } catch (e: any) {
      setError(e?.message || 'Не удалось удалить клиента');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div>
          <h2 className="text-3xl font-bold text-[#5A5A40] tracking-tight">Клиенты</h2>
          <p className="text-[#5A5A40]/60 mt-1 italic">Справочник клиентов с кодом, контактами и отсрочкой платежа</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative group">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-[#5A5A40]/30" size={18} />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Поиск клиентов..."
              className="w-64 pl-12 pr-4 py-3 bg-white border border-[#5A5A40]/10 rounded-2xl text-sm outline-none focus:ring-2 focus:ring-[#5A5A40]/20 shadow-sm"
            />
          </div>
          <button onClick={openCreate} className="bg-[#5A5A40] text-white px-6 py-3 rounded-2xl font-medium shadow-lg hover:bg-[#4A4A30] transition-all flex items-center gap-2">
            <Plus size={20} />
            Добавить клиента
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-white rounded-2xl border border-[#5A5A40]/10 px-5 py-4 shadow-sm">
          <p className="text-[10px] uppercase tracking-widest text-[#5A5A40]/45 font-bold">Общая сумма покупок</p>
          <p className="text-2xl font-bold text-[#5A5A40] mt-2">{formatMoney(totals.purchased)}</p>
        </div>
        <div className="bg-white rounded-2xl border border-[#5A5A40]/10 px-5 py-4 shadow-sm">
          <p className="text-[10px] uppercase tracking-widest text-[#5A5A40]/45 font-bold">Общая сумма оплат</p>
          <p className="text-2xl font-bold text-emerald-700 mt-2">{formatMoney(totals.paid)}</p>
        </div>
        <div className="bg-white rounded-2xl border border-[#5A5A40]/10 px-5 py-4 shadow-sm">
          <p className="text-[10px] uppercase tracking-widest text-[#5A5A40]/45 font-bold">Общий долг</p>
          <p className="text-2xl font-bold text-rose-700 mt-2">{formatMoney(totals.debt)}</p>
        </div>
        <div className="bg-white rounded-2xl border border-[#5A5A40]/10 px-5 py-4 shadow-sm">
          <p className="text-[10px] uppercase tracking-widest text-[#5A5A40]/45 font-bold">Просрочено</p>
          <p className="text-2xl font-bold text-amber-700 mt-2">{formatMoney(totals.overdue)}</p>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-[#5A5A40]/10 px-4 py-4 shadow-sm flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 mr-2 text-[#5A5A40]/60">
            <Filter size={16} />
            <span className="text-xs font-bold uppercase tracking-widest">Фильтры</span>
          </div>
          {[
            { key: 'ALL', label: 'Все' },
            { key: 'WITH_DEBT', label: 'С долгом' },
            { key: 'OVERDUE', label: 'Просроченные' },
            { key: 'TOP_BUYERS', label: 'Покупающие' },
            { key: 'VIP', label: 'VIP / крупные' },
            { key: 'NEW_NO_HISTORY', label: 'Без истории' },
          ].map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setFilterMode(item.key as CustomerFilterMode)}
              className={`px-4 py-2 rounded-xl text-sm font-medium border transition-all ${filterMode === item.key ? 'bg-[#5A5A40] text-white border-[#5A5A40]' : 'bg-[#f5f5f0] text-[#5A5A40] border-[#5A5A40]/10 hover:bg-[#ecebe5]'}`}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-[#5A5A40]/60">
            <ArrowDownUp size={16} />
            <span className="text-xs font-bold uppercase tracking-widest">Сортировка</span>
          </div>
          <select
            value={sortMode}
            onChange={(e) => setSortMode(e.target.value as CustomerSortMode)}
            className="px-3 py-2 rounded-xl border border-[#5A5A40]/15 text-sm text-[#5A5A40] bg-white outline-none"
          >
            <option value="NAME">По имени</option>
            <option value="PURCHASE_DESC">По сумме покупок</option>
            <option value="DEBT_DESC">По долгу</option>
            <option value="PAYMENT_DESC">По оплатам</option>
          </select>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 text-red-700 px-4 py-3 text-sm">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {filteredCustomers.map((customer) => (
          <button
            key={customer.id}
            type="button"
            onClick={() => setExpandedCustomerId((current) => current === customer.id ? null : customer.id)}
            className="bg-white p-6 rounded-3xl shadow-sm border border-[#5A5A40]/5 hover:shadow-md transition-all group text-left"
          >
            <div className="flex justify-between items-start mb-5">
              <div className="w-12 h-12 bg-[#f5f5f0] rounded-2xl flex items-center justify-center text-[#5A5A40] group-hover:bg-[#5A5A40] group-hover:text-white transition-colors">
                <UserRound size={24} />
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={(event) => {
                    event.stopPropagation();
                    openEdit(customer);
                  }}
                  disabled={submitting}
                  className="p-2 text-[#5A5A40]/30 hover:text-[#5A5A40] hover:bg-[#f5f5f0] rounded-xl transition-all disabled:opacity-50"
                  title="Редактировать"
                >
                  <Edit3 size={17} />
                </button>
                <button
                  onClick={(event) => {
                    event.stopPropagation();
                    setDeleteTarget({ id: customer.id, name: customer.name });
                  }}
                  disabled={submitting}
                  className="p-2 text-[#5A5A40]/30 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all disabled:opacity-50"
                  title="Удалить"
                >
                  <Trash2 size={17} />
                </button>
              </div>
            </div>

            <h3 className="text-lg font-bold text-[#5A5A40] leading-tight">{customer.name}</h3>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <p className="text-xs text-[#5A5A40]/45">{customer.code || 'Код не задан'}</p>
              {isVipCustomer(customer) && (
                <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 text-[10px] font-bold uppercase tracking-widest border border-amber-200">
                  VIP
                </span>
              )}
              {customer.paymentTermDays ? (
                <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 text-[10px] font-bold uppercase tracking-widest border border-emerald-100">
                  Оплата через {customer.paymentTermDays} дн.
                </span>
              ) : null}
            </div>

            <div className="space-y-2.5 mt-5 text-sm">
              <div className="flex items-center gap-2 text-[#5A5A40]/70">
                <Phone size={15} className="text-[#5A5A40]/35 opacity-0" />
                <span>Отсрочка: {customer.paymentTermDays ? `${customer.paymentTermDays} дн.` : '—'}</span>
              </div>
              <div className="flex items-center gap-2 text-[#5A5A40]/70">
                <Phone size={15} className="text-[#5A5A40]/35" />
                <span>{customer.phone || '—'}</span>
              </div>
              <div className="flex items-center gap-2 text-[#5A5A40]/70">
                <MapPin size={15} className="text-[#5A5A40]/35" />
                <span className="truncate">{customer.address || '—'}</span>
              </div>
            </div>

            {expandedCustomerId === customer.id && (
              <div className="mt-5 rounded-2xl border border-[#5A5A40]/10 bg-[#f5f5f0]/60 p-4 space-y-3 text-sm text-[#5A5A40]">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-[10px] uppercase tracking-widest text-[#5A5A40]/40 font-bold">Экспорт истории клиента</p>
                    <p className="text-xs text-[#5A5A40]/60 mt-1">Выгрузите покупки, оплаты и открытые долги по выбранному клиенту.</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        void exportCustomerHistoryXlsx(customer);
                      }}
                      disabled={exportingCustomerId === customer.id}
                      className="px-3 py-2 rounded-xl border border-[#5A5A40]/15 text-sm text-[#5A5A40] hover:bg-white transition-all disabled:opacity-50 flex items-center gap-2"
                    >
                      <FileSpreadsheet size={15} /> Excel
                    </button>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        void exportCustomerHistoryPdf(customer);
                      }}
                      disabled={exportingCustomerId === customer.id}
                      className="px-3 py-2 rounded-xl bg-[#5A5A40] text-white text-sm hover:bg-[#4A4A30] transition-all disabled:opacity-50 flex items-center gap-2"
                    >
                      <FileDown size={15} /> PDF
                    </button>
                  </div>
                </div>

                {customer.summary && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
                    <div className="rounded-2xl bg-white px-3 py-3 border border-[#5A5A40]/10">
                      <p className="text-[10px] uppercase tracking-widest text-[#5A5A40]/40 font-bold">Купил</p>
                      <p className="font-bold mt-1">{Number(customer.summary.totalPurchased || 0).toFixed(2)} TJS</p>
                    </div>
                    <div className="rounded-2xl bg-white px-3 py-3 border border-[#5A5A40]/10">
                      <p className="text-[10px] uppercase tracking-widest text-[#5A5A40]/40 font-bold">Оплачено</p>
                      <p className="font-bold mt-1">{Number(customer.summary.totalPaid || 0).toFixed(2)} TJS</p>
                    </div>
                    <div className="rounded-2xl bg-white px-3 py-3 border border-[#5A5A40]/10">
                      <p className="text-[10px] uppercase tracking-widest text-[#5A5A40]/40 font-bold">Должен</p>
                      <p className="font-bold mt-1 text-rose-700">{Number(customer.summary.totalDebt || 0).toFixed(2)} TJS</p>
                    </div>
                    <div className="rounded-2xl bg-white px-3 py-3 border border-[#5A5A40]/10">
                      <p className="text-[10px] uppercase tracking-widest text-[#5A5A40]/40 font-bold">Просрочено</p>
                      <p className="font-bold mt-1 text-amber-700">{Number(customer.summary.overdueDebt || 0).toFixed(2)} TJS</p>
                    </div>
                    <div className="rounded-2xl bg-white px-3 py-3 border border-[#5A5A40]/10">
                      <p className="text-[10px] uppercase tracking-widest text-[#5A5A40]/40 font-bold">Накладных</p>
                      <p className="font-bold mt-1">{Number(customer.summary.invoiceCount || 0)}</p>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <p className="text-[10px] uppercase tracking-widest text-[#5A5A40]/40 font-bold">Код клиента</p>
                    <p className="font-semibold mt-1">{customer.code || 'Будет присвоен автоматически'}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-widest text-[#5A5A40]/40 font-bold">Статус</p>
                    <p className="font-semibold mt-1">{customer.isActive ? 'Активный' : 'Неактивный'}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-widest text-[#5A5A40]/40 font-bold">Email</p>
                    <p className="font-semibold mt-1 break-all">{customer.email || '—'}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-widest text-[#5A5A40]/40 font-bold">Менеджер</p>
                    <p className="font-semibold mt-1">{customer.managerName || '—'}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-widest text-[#5A5A40]/40 font-bold">Кредитный лимит</p>
                    <p className="font-semibold mt-1">{Number(customer.creditLimit || 0).toFixed(2)} TJS</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-widest text-[#5A5A40]/40 font-bold">Скидка по умолчанию</p>
                    <p className="font-semibold mt-1">{Number(customer.defaultDiscount || 0).toFixed(2)}%</p>
                  </div>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-[#5A5A40]/40 font-bold">Что делает отсрочка</p>
                  <p className="mt-1 text-[#5A5A40]/75">Срок оплаты хранится как значение по умолчанию для новых долгов клиента. Уже созданные долги остаются со своей исторической датой оплаты.</p>
                </div>
                {customer.summary && (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <p className="text-[10px] uppercase tracking-widest text-[#5A5A40]/40 font-bold">Последняя накладная</p>
                      <p className="mt-1 font-semibold">{customer.summary.lastInvoiceAt ? new Date(customer.summary.lastInvoiceAt).toLocaleString('ru-RU') : '—'}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-widest text-[#5A5A40]/40 font-bold">Последняя оплата</p>
                      <p className="mt-1 font-semibold">{customer.summary.lastPaymentAt ? new Date(customer.summary.lastPaymentAt).toLocaleString('ru-RU') : '—'}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-widest text-[#5A5A40]/40 font-bold">Ближайший срок оплаты</p>
                      <p className="mt-1 font-semibold">{customer.summary.nextDueDate ? new Date(customer.summary.nextDueDate).toLocaleDateString('ru-RU') : '—'}</p>
                    </div>
                  </div>
                )}

                {customer.history && (
                  <div className="space-y-4 pt-2">
                    <div>
                      <p className="text-[10px] uppercase tracking-widest text-[#5A5A40]/40 font-bold mb-2">История покупок</p>
                      <div className="space-y-2">
                        {customer.history.recentInvoices.length === 0 ? (
                          <div className="rounded-2xl bg-white border border-[#5A5A40]/10 px-4 py-3 text-[#5A5A40]/55">Пока нет накладных по этому клиенту.</div>
                        ) : customer.history.recentInvoices.map((invoice) => (
                          <div key={invoice.id} className="rounded-2xl bg-white border border-[#5A5A40]/10 px-4 py-3">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div>
                                <p className="font-semibold text-[#5A5A40]">{invoice.invoiceNo}</p>
                                <p className="text-xs text-[#5A5A40]/55 mt-1">{formatDateTime(invoice.createdAt)} · позиций: {invoice.itemCount}</p>
                              </div>
                              <div className="text-right">
                                <p className="font-bold text-[#5A5A40]">{formatMoney(invoice.totalAmount)}</p>
                                <p className="text-xs text-[#5A5A40]/55 mt-1">Статус: {invoice.paymentStatus || invoice.status}</p>
                              </div>
                            </div>
                            <div className="mt-2 flex flex-wrap gap-2 text-xs">
                              <span className="inline-flex rounded-full bg-[#f5f5f0] px-3 py-1 text-[#5A5A40]">Остаток: {formatMoney(invoice.outstandingAmount)}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                      <div>
                        <p className="text-[10px] uppercase tracking-widest text-[#5A5A40]/40 font-bold mb-2">История оплат</p>
                        <div className="space-y-2">
                          {customer.history.recentPayments.length === 0 ? (
                            <div className="rounded-2xl bg-white border border-[#5A5A40]/10 px-4 py-3 text-[#5A5A40]/55">Оплат пока нет.</div>
                          ) : customer.history.recentPayments.map((payment) => (
                            <div key={payment.id} className="rounded-2xl bg-white border border-[#5A5A40]/10 px-4 py-3">
                              <div className="flex items-start justify-between gap-3">
                                <div className="flex items-start gap-2">
                                  <Wallet size={15} className="text-emerald-600 mt-0.5" />
                                  <div>
                                    <p className="font-semibold text-[#5A5A40]">{formatMoney(payment.amount)}</p>
                                    <p className="text-xs text-[#5A5A40]/55 mt-1">{formatDateTime(payment.paymentDate)}</p>
                                  </div>
                                </div>
                                <div className="text-right text-xs text-[#5A5A40]/60">
                                  <p>{payment.method}</p>
                                  <p className="mt-1">{payment.invoiceNo || 'Без накладной'}</p>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div>
                        <p className="text-[10px] uppercase tracking-widest text-[#5A5A40]/40 font-bold mb-2">Открытые долги</p>
                        <div className="space-y-2">
                          {customer.history.openReceivables.length === 0 ? (
                            <div className="rounded-2xl bg-white border border-[#5A5A40]/10 px-4 py-3 text-[#5A5A40]/55">Открытых долгов нет.</div>
                          ) : customer.history.openReceivables.map((receivable) => (
                            <div key={receivable.id} className="rounded-2xl bg-white border border-[#5A5A40]/10 px-4 py-3">
                              <div className="flex items-start justify-between gap-3">
                                <div className="flex items-start gap-2">
                                  <Calendar size={15} className="text-amber-600 mt-0.5" />
                                  <div>
                                    <p className="font-semibold text-[#5A5A40]">{receivable.invoiceNo || 'Долг без накладной'}</p>
                                    <p className="text-xs text-[#5A5A40]/55 mt-1">Создан: {formatDateTime(receivable.createdAt)}</p>
                                  </div>
                                </div>
                                <div className="text-right">
                                  <p className="font-bold text-rose-700">{formatMoney(receivable.remainingAmount)}</p>
                                  <p className="text-xs text-[#5A5A40]/60 mt-1">Срок: {formatDate(receivable.dueDate)}</p>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </button>
        ))}
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden border border-[#5A5A40]/10">
            <div className="px-6 py-4 bg-[#5A5A40] text-white flex items-center justify-between">
              <h3 className="text-base font-bold">{editingId ? 'Редактирование клиента' : 'Новый клиент'}</h3>
              <button onClick={() => setIsModalOpen(false)} className="p-1.5 rounded-lg hover:bg-white/10 transition-colors">
                <X size={18} />
              </button>
            </div>

            <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-3.5">
              <input className="md:col-span-2 px-4 py-2.5 border border-[#5A5A40]/10 rounded-xl" placeholder="Название клиента" value={form.name} onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))} />
              <div className="space-y-2">
                <input className="w-full px-4 py-2.5 border border-[#5A5A40]/10 rounded-xl bg-[#f5f5f0] text-[#5A5A40]/60" placeholder="Код клиента" value={form.code} onChange={(e) => setForm((s) => ({ ...s, code: e.target.value }))} readOnly={!editingId} />
                {!editingId && (
                  <p className="text-xs text-[#5A5A40]/45">Код будет выдан автоматически при сохранении. Следующий номер: {form.code}</p>
                )}
              </div>
              <input className="px-4 py-2.5 border border-[#5A5A40]/10 rounded-xl" placeholder="Телефон" value={form.phone} onChange={(e) => setForm((s) => ({ ...s, phone: e.target.value }))} />
              <input className="md:col-span-2 px-4 py-2.5 border border-[#5A5A40]/10 rounded-xl" placeholder="Адрес" value={form.address} onChange={(e) => setForm((s) => ({ ...s, address: e.target.value }))} />
              <div className="md:col-span-2">
                <input type="number" min={0} step={1} className="w-full px-4 py-2.5 border border-[#5A5A40]/10 rounded-xl" placeholder="Отсрочка платежа, дней" value={form.paymentTermDays} onChange={(e) => setForm((s) => ({ ...s, paymentTermDays: e.target.value }))} />
                <p className="text-xs text-[#5A5A40]/45 mt-2">Это срок оплаты по умолчанию для новых продаж в долг. Исторические долги после изменения клиента не пересчитываются.</p>
              </div>
            </div>

            <div className="p-6 border-t border-[#5A5A40]/10 flex justify-end gap-3">
              <button onClick={() => setIsModalOpen(false)} className="px-5 py-2.5 border border-[#5A5A40]/20 rounded-xl">{t('Cancel')}</button>
              <button onClick={saveCustomer} disabled={submitting} className="px-5 py-2.5 bg-[#5A5A40] text-white rounded-xl disabled:opacity-50">
                {submitting ? 'Сохранение...' : (editingId ? 'Сохранить изменения' : 'Создать клиента')}
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden border border-[#5A5A40]/10">
            <div className="p-5 bg-red-600 text-white flex items-center justify-between">
              <h3 className="text-lg font-bold">Удаление клиента</h3>
              <button onClick={() => setDeleteTarget(null)} className="p-1.5 rounded-lg hover:bg-white/10 transition-colors">
                <X size={18} />
              </button>
            </div>
            <div className="p-6 space-y-5">
              <p className="text-sm text-[#5A5A40]/80">
                Удалить клиента: <span className="font-semibold">{deleteTarget.name}</span>?
              </p>
              <div className="flex justify-end gap-3">
                <button onClick={() => setDeleteTarget(null)} className="px-5 py-2.5 border border-[#5A5A40]/20 rounded-xl">
                  {t('Cancel')}
                </button>
                <button onClick={() => { void deleteCustomer(deleteTarget.id); }} disabled={submitting} className="px-5 py-2.5 bg-red-600 text-white rounded-xl disabled:opacity-50">
                  {submitting ? 'Удаление...' : 'Удалить'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
