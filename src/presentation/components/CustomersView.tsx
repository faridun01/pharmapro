import React, { useEffect, useMemo, useState } from 'react';
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
  ExternalLink,
} from 'lucide-react';

type CustomersViewProps = {
  onOpenInvoiceHistory?: (invoiceId: string, invoiceNo?: string) => void;
};

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

type CustomerInvoiceHistoryItem = {
  id: string;
  invoiceNo: string;
  customer?: string | null;
  createdAt: string;
  totalAmount: number;
  paymentType: string;
  paymentStatus?: string | null;
  status: string;
  comment?: string | null;
  outstandingAmount: number;
  paidAmountTotal: number;
  returnedAmountTotal: number;
  itemCount: number;
  items: Array<{
    id: string;
    productName: string;
    batchNo?: string | null;
    quantity: number;
    unitPrice: number;
    totalPrice: number;
  }>;
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

export const CustomersView: React.FC<CustomersViewProps> = ({ onOpenInvoiceHistory }) => {
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
  const [detailsInvoice, setDetailsInvoice] = useState<CustomerInvoiceHistoryItem | null>(null);
  const [historyPage, setHistoryPage] = useState(1);
  const [invoiceHistory, setInvoiceHistory] = useState<{
    invoices: CustomerInvoiceHistoryItem[];
    totalCount: number;
    page: number;
    pageCount: number;
    pageSize: number;
  }>({
    invoices: [],
    totalCount: 0,
    page: 1,
    pageCount: 1,
    pageSize: 10,
  });
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');

  // Debounce search to 300ms to avoid filtering on every keystroke
  const debouncedSearchTerm = useDebounce(searchTerm, 300);

  const formatMoney = (value: number) => `${Number(value || 0).toFixed(2)} TJS`;
  const formatDateTime = (value?: string | null) => value ? new Date(value).toLocaleString('ru-RU') : '—';
  const formatDate = (value?: string | null) => value ? new Date(value).toLocaleDateString('ru-RU') : '—';
  const formatUnitQuantity = (value: number) => `${Math.max(0, Math.floor(Number(value) || 0))} ед.`;
  const isVipCustomer = (customer: typeof customers[number]) => Number(customer.summary?.totalPurchased || 0) >= VIP_PURCHASE_THRESHOLD || Number(customer.creditLimit || 0) >= VIP_CREDIT_LIMIT_THRESHOLD;
  const selectedCustomer = customers.find((customer) => customer.id === expandedCustomerId) || null;

  useEffect(() => {
    if (!selectedCustomer) {
      setHistoryPage(1);
      setInvoiceHistory({ invoices: [], totalCount: 0, page: 1, pageCount: 1, pageSize: 10 });
      setHistoryError('');
      setDetailsInvoice(null);
      return;
    }

    let cancelled = false;

    const loadHistory = async () => {
      setHistoryLoading(true);
      setHistoryError('');
      try {
        const response = await fetch(`/api/customers/${selectedCustomer.id}/history?page=${historyPage}&pageSize=10`, {
          headers: authHeaders(),
        });
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(body.error || 'Не удалось загрузить историю клиента');
        }

        const data = await response.json();
        if (cancelled) return;
        setInvoiceHistory({
          invoices: data.invoices || [],
          totalCount: Number(data.totalCount || 0),
          page: Number(data.page || historyPage),
          pageCount: Number(data.pageCount || 1),
          pageSize: Number(data.pageSize || 10),
        });
      } catch (e: any) {
        if (!cancelled) {
          setHistoryError(e?.message || 'Не удалось загрузить историю клиента');
        }
      } finally {
        if (!cancelled) {
          setHistoryLoading(false);
        }
      }
    };

    void loadHistory();

    return () => {
      cancelled = true;
    };
  }, [selectedCustomer?.id, historyPage]);

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

  const visibleHistoryPages = useMemo(() => {
    const totalPages = invoiceHistory.pageCount;
    if (totalPages <= 1) return [] as number[];

    const start = Math.max(1, historyPage - 2);
    const end = Math.min(totalPages, historyPage + 2);
    const pages = [] as number[];

    for (let page = start; page <= end; page += 1) {
      pages.push(page);
    }

    return pages;
  }, [historyPage, invoiceHistory.pageCount]);

  const loadAllCustomerInvoices = async (customerId: string) => {
    const pageSize = 100;
    let page = 1;
    let pageCount = 1;
    const allInvoices: CustomerInvoiceHistoryItem[] = [];

    while (page <= pageCount) {
      const response = await fetch(`/api/customers/${customerId}/history?page=${page}&pageSize=${pageSize}`, {
        headers: authHeaders(),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || 'Не удалось загрузить историю клиента для экспорта');
      }

      const data = await response.json();
      allInvoices.push(...(data.invoices || []));
      pageCount = Number(data.pageCount || 1);
      page += 1;
    }

    return allInvoices;
  };

  const exportCustomerHistoryXlsx = async (customer: typeof customers[number]) => {
    setExportingCustomerId(customer.id);
    setError('');
    try {
      const XLSX = await loadXlsx();
      const allInvoices = await loadAllCustomerInvoices(customer.id);
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
        ...(allInvoices.map((invoice) => [
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

      const invoiceItemsSheet = XLSX.utils.aoa_to_sheet([
        ['Накладная', 'Дата', 'Товар', 'Партия', 'Кол-во', 'Цена', 'Сумма'],
        ...allInvoices.flatMap((invoice) => invoice.items.map((item) => [
          invoice.invoiceNo,
          formatDateTime(invoice.createdAt),
          item.productName,
          item.batchNo || '',
          Number(item.quantity || 0),
          Number(item.unitPrice || 0),
          Number(item.totalPrice || 0),
        ])),
      ]);
      XLSX.utils.book_append_sheet(workbook, invoiceItemsSheet, 'Товары по накладным');

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
      const allInvoices = await loadAllCustomerInvoices(customer.id);
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
        body: allInvoices.map((invoice) => [
          invoice.invoiceNo,
          formatDateTime(invoice.createdAt),
          formatMoney(Number(invoice.totalAmount || 0)),
          formatMoney(Number(invoice.outstandingAmount || 0)),
        ]),
      });

      autoTableFn(doc, {
        startY: (doc as any).lastAutoTable.finalY + 8,
        head: [['Накладная', 'Товар', 'Кол-во', 'Цена', 'Сумма']],
        body: allInvoices.flatMap((invoice) => invoice.items.map((item) => [
          invoice.invoiceNo,
          item.productName,
          formatUnitQuantity(item.quantity),
          formatMoney(Number(item.unitPrice || 0)),
          formatMoney(Number(item.totalPrice || 0)),
        ])),
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
          <div
            key={customer.id}
            role="button"
            tabIndex={0}
            onClick={() => {
              setHistoryPage(1);
              setExpandedCustomerId(customer.id);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                setHistoryPage(1);
                setExpandedCustomerId(customer.id);
              }
            }}
            className="bg-white p-6 rounded-3xl shadow-sm border border-[#5A5A40]/5 hover:shadow-md transition-all group text-left cursor-pointer"
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
            <div className="mt-5 grid grid-cols-3 gap-2">
              <div className="rounded-2xl bg-[#f5f5f0] px-3 py-2">
                <p className="text-[10px] uppercase tracking-widest text-[#5A5A40]/45 font-bold">Покупки</p>
                <p className="mt-1 text-sm font-bold text-[#5A5A40]">{formatMoney(Number(customer.summary?.totalPurchased || 0))}</p>
              </div>
              <div className="rounded-2xl bg-[#f5f5f0] px-3 py-2">
                <p className="text-[10px] uppercase tracking-widest text-[#5A5A40]/45 font-bold">Оплаты</p>
                <p className="mt-1 text-sm font-bold text-emerald-700">{formatMoney(Number(customer.summary?.totalPaid || 0))}</p>
              </div>
              <div className="rounded-2xl bg-[#f5f5f0] px-3 py-2">
                <p className="text-[10px] uppercase tracking-widest text-[#5A5A40]/45 font-bold">Долг</p>
                <p className="mt-1 text-sm font-bold text-rose-700">{formatMoney(Number(customer.summary?.totalDebt || 0))}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {selectedCustomer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 backdrop-blur-sm p-4" onClick={() => setExpandedCustomerId(null)}>
          <div className="bg-[#f5f5f0] rounded-4xl shadow-2xl w-full max-w-6xl max-h-[92vh] overflow-hidden border border-[#5A5A40]/10" onClick={(event) => event.stopPropagation()}>
            <div className="px-6 py-5 bg-white border-b border-[#5A5A40]/10 flex items-start justify-between gap-4">
              <div className="flex items-start gap-4">
                <div className="w-16 h-16 rounded-3xl bg-[#5A5A40] text-white flex items-center justify-center shadow-lg">
                  <UserRound size={28} />
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-2xl font-bold text-[#5A5A40]">{selectedCustomer.name}</h3>
                    {isVipCustomer(selectedCustomer) && (
                      <span className="inline-flex items-center px-3 py-1 rounded-full bg-amber-50 text-amber-700 text-[10px] font-bold uppercase tracking-widest border border-amber-200">
                        VIP
                      </span>
                    )}
                    {selectedCustomer.paymentTermDays ? (
                      <span className="inline-flex items-center px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 text-[10px] font-bold uppercase tracking-widest border border-emerald-100">
                        Оплата через {selectedCustomer.paymentTermDays} дн.
                      </span>
                    ) : null}
                  </div>
                  <p className="text-sm text-[#5A5A40]/55 mt-1">Клиентская карточка: все покупки, оплаты, долги и накладные в одном месте.</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void exportCustomerHistoryXlsx(selectedCustomer)}
                  disabled={exportingCustomerId === selectedCustomer.id}
                  className="px-3 py-2 rounded-xl border border-[#5A5A40]/15 text-sm text-[#5A5A40] hover:bg-[#f5f5f0] transition-all disabled:opacity-50 flex items-center gap-2"
                >
                  <FileSpreadsheet size={15} /> Excel
                </button>
                <button
                  type="button"
                  onClick={() => void exportCustomerHistoryPdf(selectedCustomer)}
                  disabled={exportingCustomerId === selectedCustomer.id}
                  className="px-3 py-2 rounded-xl bg-[#5A5A40] text-white text-sm hover:bg-[#4A4A30] transition-all disabled:opacity-50 flex items-center gap-2"
                >
                  <FileDown size={15} /> PDF
                </button>
                <button onClick={() => setExpandedCustomerId(null)} className="p-2 rounded-xl text-[#5A5A40]/40 hover:text-[#5A5A40] hover:bg-[#f5f5f0] transition-colors">
                  <X size={20} />
                </button>
              </div>
            </div>

            <div className="p-6 overflow-y-auto max-h-[calc(92vh-96px)] space-y-6 custom-scrollbar">
              <div className="grid grid-cols-1 xl:grid-cols-[1.05fr_1.95fr] gap-6">
                <div className="space-y-4">
                  <div className="bg-white rounded-3xl border border-[#5A5A40]/10 p-5 space-y-4">
                    <div>
                      <p className="text-[10px] uppercase tracking-[0.2em] text-[#5A5A40]/40 font-bold">Профиль клиента</p>
                      <p className="text-lg font-bold text-[#5A5A40] mt-2">{selectedCustomer.code || 'Код будет присвоен автоматически'}</p>
                    </div>
                    <div className="space-y-3 text-sm text-[#5A5A40]/80">
                      <div className="flex items-start gap-3">
                        <Phone size={16} className="text-[#5A5A40]/35 mt-0.5" />
                        <span>{selectedCustomer.phone || 'Телефон не указан'}</span>
                      </div>
                      <div className="flex items-start gap-3">
                        <Mail size={16} className="text-[#5A5A40]/35 mt-0.5" />
                        <span className="break-all">{selectedCustomer.email || 'Email не указан'}</span>
                      </div>
                      <div className="flex items-start gap-3">
                        <MapPin size={16} className="text-[#5A5A40]/35 mt-0.5" />
                        <span>{selectedCustomer.address || 'Адрес не указан'}</span>
                      </div>
                      <div className="flex items-start gap-3">
                        <UserRound size={16} className="text-[#5A5A40]/35 mt-0.5" />
                        <span>{selectedCustomer.managerName || 'Менеджер не назначен'}</span>
                      </div>
                    </div>
                  </div>

                  <div className="bg-white rounded-3xl border border-[#5A5A40]/10 p-5">
                    <p className="text-[10px] uppercase tracking-[0.2em] text-[#5A5A40]/40 font-bold">Условия работы</p>
                    <div className="grid grid-cols-2 gap-3 mt-4">
                      <div className="rounded-2xl bg-[#f5f5f0] px-4 py-3">
                        <p className="text-[10px] uppercase tracking-widest text-[#5A5A40]/40 font-bold">Отсрочка</p>
                        <p className="font-bold text-[#5A5A40] mt-1">{selectedCustomer.paymentTermDays ? `${selectedCustomer.paymentTermDays} дн.` : '—'}</p>
                      </div>
                      <div className="rounded-2xl bg-[#f5f5f0] px-4 py-3">
                        <p className="text-[10px] uppercase tracking-widest text-[#5A5A40]/40 font-bold">Лимит</p>
                        <p className="font-bold text-[#5A5A40] mt-1">{formatMoney(Number(selectedCustomer.creditLimit || 0))}</p>
                      </div>
                      <div className="rounded-2xl bg-[#f5f5f0] px-4 py-3 col-span-2">
                        <p className="text-[10px] uppercase tracking-widest text-[#5A5A40]/40 font-bold">Скидка по умолчанию</p>
                        <p className="font-bold text-[#5A5A40] mt-1">{Number(selectedCustomer.defaultDiscount || 0).toFixed(2)}%</p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="grid grid-cols-2 xl:grid-cols-5 gap-3">
                    <div className="bg-white rounded-3xl border border-[#5A5A40]/10 p-4">
                      <p className="text-[10px] uppercase tracking-widest text-[#5A5A40]/40 font-bold">Покупки</p>
                      <p className="text-xl font-bold text-[#5A5A40] mt-2">{formatMoney(Number(selectedCustomer.summary?.totalPurchased || 0))}</p>
                    </div>
                    <div className="bg-white rounded-3xl border border-[#5A5A40]/10 p-4">
                      <p className="text-[10px] uppercase tracking-widest text-[#5A5A40]/40 font-bold">Оплаты</p>
                      <p className="text-xl font-bold text-emerald-700 mt-2">{formatMoney(Number(selectedCustomer.summary?.totalPaid || 0))}</p>
                    </div>
                    <div className="bg-white rounded-3xl border border-[#5A5A40]/10 p-4">
                      <p className="text-[10px] uppercase tracking-widest text-[#5A5A40]/40 font-bold">Долг</p>
                      <p className="text-xl font-bold text-rose-700 mt-2">{formatMoney(Number(selectedCustomer.summary?.totalDebt || 0))}</p>
                    </div>
                    <div className="bg-white rounded-3xl border border-[#5A5A40]/10 p-4">
                      <p className="text-[10px] uppercase tracking-widest text-[#5A5A40]/40 font-bold">Просрочено</p>
                      <p className="text-xl font-bold text-amber-700 mt-2">{formatMoney(Number(selectedCustomer.summary?.overdueDebt || 0))}</p>
                    </div>
                    <div className="bg-white rounded-3xl border border-[#5A5A40]/10 p-4">
                      <p className="text-[10px] uppercase tracking-widest text-[#5A5A40]/40 font-bold">Накладных</p>
                      <p className="text-xl font-bold text-[#5A5A40] mt-2">{Number(selectedCustomer.summary?.invoiceCount || 0)}</p>
                    </div>
                  </div>

                  <div className="bg-white rounded-3xl border border-[#5A5A40]/10 p-5 grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <p className="text-[10px] uppercase tracking-widest text-[#5A5A40]/40 font-bold">Последняя накладная</p>
                      <p className="mt-2 font-semibold text-[#5A5A40]">{formatDateTime(selectedCustomer.summary?.lastInvoiceAt)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-widest text-[#5A5A40]/40 font-bold">Последняя оплата</p>
                      <p className="mt-2 font-semibold text-[#5A5A40]">{formatDateTime(selectedCustomer.summary?.lastPaymentAt)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-widest text-[#5A5A40]/40 font-bold">Ближайший срок оплаты</p>
                      <p className="mt-2 font-semibold text-[#5A5A40]">{formatDate(selectedCustomer.summary?.nextDueDate)}</p>
                    </div>
                  </div>

                  <div className="bg-white rounded-3xl border border-[#5A5A40]/10 p-5 space-y-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-[10px] uppercase tracking-[0.2em] text-[#5A5A40]/40 font-bold">Накладные клиента</p>
                        <p className="text-sm text-[#5A5A40]/60 mt-1">Здесь хранится вся история продаж клиента с товарами по каждой накладной. Нажмите на накладную, чтобы открыть подробности продажи.</p>
                      </div>
                      <div className="text-right text-xs text-[#5A5A40]/55">
                        <p>Всего накладных: {invoiceHistory.totalCount}</p>
                        <p className="mt-1">Страница {invoiceHistory.page} из {invoiceHistory.pageCount}</p>
                      </div>
                    </div>

                    {historyError && (
                      <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{historyError}</div>
                    )}

                    <div className="space-y-3">
                      {historyLoading ? (
                        <div className="rounded-2xl bg-[#f5f5f0] border border-[#5A5A40]/10 px-4 py-4 text-[#5A5A40]/60">Загружаю историю накладных...</div>
                      ) : invoiceHistory.invoices.length ? invoiceHistory.invoices.map((invoice) => (
                        <button type="button" key={invoice.id} onClick={() => setDetailsInvoice(invoice)} className="w-full rounded-2xl border border-[#5A5A40]/10 bg-[#f5f5f0]/55 px-4 py-4 text-left hover:border-[#5A5A40]/25 hover:bg-[#efeee7] transition-all">
                          <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
                            <div>
                              <p className="text-base font-bold text-[#5A5A40]">{invoice.invoiceNo}</p>
                              <p className="text-xs text-[#5A5A40]/55 mt-1">{formatDateTime(invoice.createdAt)} • позиций: {invoice.itemCount}</p>
                            </div>
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-sm min-w-[320px]">
                              <div className="rounded-2xl bg-white px-3 py-2 border border-[#5A5A40]/10">
                                <p className="text-[10px] uppercase tracking-widest text-[#5A5A40]/35 font-bold">Сумма</p>
                                <p className="mt-1 font-bold text-[#5A5A40]">{formatMoney(invoice.totalAmount)}</p>
                              </div>
                              <div className="rounded-2xl bg-white px-3 py-2 border border-[#5A5A40]/10">
                                <p className="text-[10px] uppercase tracking-widest text-[#5A5A40]/35 font-bold">Оплата</p>
                                <p className="mt-1 font-bold text-[#5A5A40]">{invoice.paymentStatus || invoice.status}</p>
                              </div>
                              <div className="rounded-2xl bg-white px-3 py-2 border border-[#5A5A40]/10 col-span-2 md:col-span-1">
                                <p className="text-[10px] uppercase tracking-widest text-[#5A5A40]/35 font-bold">Остаток</p>
                                <p className="mt-1 font-bold text-rose-700">{formatMoney(invoice.outstandingAmount)}</p>
                              </div>
                            </div>
                          </div>
                          <div className="mt-4 space-y-2">
                            <p className="text-[10px] uppercase tracking-widest text-[#5A5A40]/45 font-bold">Купленные товары</p>
                            {invoice.items.length ? invoice.items.map((item) => (
                              <div key={item.id} className="rounded-2xl bg-white border border-[#5A5A40]/10 px-3 py-2 flex items-start justify-between gap-3">
                                <div>
                                  <p className="text-sm font-semibold text-[#5A5A40]">{item.productName}</p>
                                  <p className="text-[11px] text-[#5A5A40]/55 mt-1">{item.batchNo ? `Партия: ${item.batchNo}` : 'Без партии'}</p>
                                </div>
                                <div className="text-right text-sm">
                                  <p className="font-bold text-[#5A5A40]">{formatUnitQuantity(item.quantity)}</p>
                                  <p className="text-[11px] text-[#5A5A40]/55 mt-1">{formatMoney(item.totalPrice)}</p>
                                </div>
                              </div>
                            )) : (
                              <div className="rounded-2xl bg-white border border-[#5A5A40]/10 px-3 py-2 text-sm text-[#5A5A40]/60">Товары по накладной не найдены.</div>
                            )}
                          </div>
                        </button>
                      )) : (
                        <div className="rounded-2xl bg-[#f5f5f0] border border-[#5A5A40]/10 px-4 py-4 text-[#5A5A40]/60">У этого клиента пока нет накладных.</div>
                      )}
                    </div>

                    {invoiceHistory.pageCount > 1 && (
                      <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                        <button
                          type="button"
                          onClick={() => setHistoryPage((current) => Math.max(1, current - 1))}
                          disabled={historyPage <= 1 || historyLoading}
                          className="px-4 py-2 rounded-xl border border-[#5A5A40]/15 text-sm text-[#5A5A40] hover:bg-[#f5f5f0] disabled:opacity-50"
                        >
                          Назад
                        </button>
                        <div className="flex items-center gap-2 flex-wrap justify-center">
                          {visibleHistoryPages[0] && visibleHistoryPages[0] > 1 ? (
                            <>
                              <button
                                type="button"
                                onClick={() => setHistoryPage(1)}
                                className="w-9 h-9 rounded-xl border border-[#5A5A40]/15 text-sm text-[#5A5A40] hover:bg-[#f5f5f0]"
                              >
                                1
                              </button>
                              {visibleHistoryPages[0] > 2 ? <span className="text-[#5A5A40]/45">...</span> : null}
                            </>
                          ) : null}
                          {visibleHistoryPages.map((page) => (
                            <button
                              key={page}
                              type="button"
                              onClick={() => setHistoryPage(page)}
                              disabled={historyLoading}
                              className={`w-9 h-9 rounded-xl border text-sm transition-all ${page === historyPage ? 'bg-[#5A5A40] border-[#5A5A40] text-white' : 'border-[#5A5A40]/15 text-[#5A5A40] hover:bg-[#f5f5f0]'}`}
                            >
                              {page}
                            </button>
                          ))}
                          {visibleHistoryPages.length > 0 && visibleHistoryPages[visibleHistoryPages.length - 1] < invoiceHistory.pageCount ? (
                            <>
                              {visibleHistoryPages[visibleHistoryPages.length - 1] < invoiceHistory.pageCount - 1 ? <span className="text-[#5A5A40]/45">...</span> : null}
                              <button
                                type="button"
                                onClick={() => setHistoryPage(invoiceHistory.pageCount)}
                                className="w-9 h-9 rounded-xl border border-[#5A5A40]/15 text-sm text-[#5A5A40] hover:bg-[#f5f5f0]"
                              >
                                {invoiceHistory.pageCount}
                              </button>
                            </>
                          ) : null}
                        </div>
                        <button
                          type="button"
                          onClick={() => setHistoryPage((current) => Math.min(invoiceHistory.pageCount, current + 1))}
                          disabled={historyPage >= invoiceHistory.pageCount || historyLoading}
                          className="px-4 py-2 rounded-xl border border-[#5A5A40]/15 text-sm text-[#5A5A40] hover:bg-[#f5f5f0] disabled:opacity-50"
                        >
                          Вперед
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                    <div className="bg-white rounded-3xl border border-[#5A5A40]/10 p-5 space-y-3">
                      <p className="text-[10px] uppercase tracking-[0.2em] text-[#5A5A40]/40 font-bold">История оплат</p>
                      {selectedCustomer.history?.recentPayments?.length ? selectedCustomer.history.recentPayments.map((payment) => (
                        <div key={payment.id} className="rounded-2xl bg-[#f5f5f0]/55 border border-[#5A5A40]/10 px-4 py-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex items-start gap-2">
                              <Wallet size={16} className="text-emerald-600 mt-0.5" />
                              <div>
                                <p className="font-bold text-[#5A5A40]">{formatMoney(payment.amount)}</p>
                                <p className="text-xs text-[#5A5A40]/55 mt-1">{formatDateTime(payment.paymentDate)}</p>
                              </div>
                            </div>
                            <div className="text-right text-xs text-[#5A5A40]/60">
                              <p>{payment.method}</p>
                              <p className="mt-1">{payment.invoiceNo || 'Без накладной'}</p>
                            </div>
                          </div>
                          {payment.comment ? <p className="text-xs text-[#5A5A40]/55 mt-2">{payment.comment}</p> : null}
                        </div>
                      )) : (
                        <div className="rounded-2xl bg-[#f5f5f0] border border-[#5A5A40]/10 px-4 py-4 text-[#5A5A40]/60">Оплат по клиенту пока нет.</div>
                      )}
                    </div>

                    <div className="bg-white rounded-3xl border border-[#5A5A40]/10 p-5 space-y-3">
                      <p className="text-[10px] uppercase tracking-[0.2em] text-[#5A5A40]/40 font-bold">Задолженность</p>
                      {selectedCustomer.history?.openReceivables?.length ? selectedCustomer.history.openReceivables.map((receivable) => (
                        <div key={receivable.id} className="rounded-2xl bg-[#f5f5f0]/55 border border-[#5A5A40]/10 px-4 py-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex items-start gap-2">
                              <Calendar size={16} className="text-amber-600 mt-0.5" />
                              <div>
                                <p className="font-bold text-[#5A5A40]">{receivable.invoiceNo || 'Долг без накладной'}</p>
                                <p className="text-xs text-[#5A5A40]/55 mt-1">Создан: {formatDateTime(receivable.createdAt)}</p>
                              </div>
                            </div>
                            <div className="text-right">
                              <p className="font-bold text-rose-700">{formatMoney(receivable.remainingAmount)}</p>
                              <p className="text-xs text-[#5A5A40]/60 mt-1">Срок: {formatDate(receivable.dueDate)}</p>
                            </div>
                          </div>
                        </div>
                      )) : (
                        <div className="rounded-2xl bg-[#f5f5f0] border border-[#5A5A40]/10 px-4 py-4 text-[#5A5A40]/60">Открытых долгов нет.</div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {detailsInvoice && (
        <div className="fixed inset-0 z-60 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setDetailsInvoice(null)}>
          <div className="w-full max-w-3xl bg-white rounded-3xl shadow-2xl border border-[#5A5A40]/10 overflow-hidden" onClick={(event) => event.stopPropagation()}>
            <div className="px-6 py-4 bg-[#5A5A40] text-white flex items-center justify-between">
              <h3 className="text-base font-bold">Детали продажи</h3>
              <div className="flex items-center gap-2">
                {detailsInvoice && onOpenInvoiceHistory ? (
                  <button
                    type="button"
                    onClick={() => onOpenInvoiceHistory(detailsInvoice.id, detailsInvoice.invoiceNo)}
                    className="px-3 py-2 rounded-xl bg-white/10 text-white text-sm hover:bg-white/20 transition-all inline-flex items-center gap-2"
                  >
                    <ExternalLink size={15} /> История продаж
                  </button>
                ) : null}
                <button onClick={() => setDetailsInvoice(null)} className="p-1.5 rounded-lg hover:bg-white/10 transition-colors">
                  <X size={18} />
                </button>
              </div>
            </div>
            <div className="p-6 space-y-4 max-h-[75vh] overflow-auto">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                <div>Накладная: <span className="font-semibold">{detailsInvoice.invoiceNo || detailsInvoice.id}</span></div>
                <div>Клиент: <span className="font-semibold">{detailsInvoice.customer || selectedCustomer?.name || '-'}</span></div>
                <div>Дата: <span className="font-semibold">{formatDateTime(detailsInvoice.createdAt)}</span></div>
                <div>Оплата: <span className="font-semibold">{detailsInvoice.paymentType}</span></div>
                <div>Статус: <span className="font-semibold">{detailsInvoice.status}</span></div>
                <div>Статус оплаты: <span className="font-semibold">{detailsInvoice.paymentStatus || 'UNPAID'}</span></div>
              </div>

              <div className="rounded-2xl border border-[#5A5A40]/10 overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-[#f5f5f0]/60 text-[#5A5A40]/70 text-xs uppercase">
                    <tr>
                      <th className="px-3 py-2 text-left">№</th>
                      <th className="px-3 py-2 text-left">Товар</th>
                      <th className="px-3 py-2 text-left">Партия</th>
                      <th className="px-3 py-2 text-right">Кол-во</th>
                      <th className="px-3 py-2 text-right">Цена</th>
                      <th className="px-3 py-2 text-right">Сумма</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detailsInvoice.items.map((item, idx) => (
                      <tr key={item.id || idx} className="border-t border-[#5A5A40]/10">
                        <td className="px-3 py-2">{idx + 1}</td>
                        <td className="px-3 py-2">{item.productName || '-'}</td>
                        <td className="px-3 py-2">{item.batchNo || '—'}</td>
                        <td className="px-3 py-2 text-right">{formatUnitQuantity(item.quantity)}</td>
                        <td className="px-3 py-2 text-right">{Number(item.unitPrice || 0).toFixed(2)} TJS</td>
                        <td className="px-3 py-2 text-right">{Number(item.totalPrice || 0).toFixed(2)} TJS</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                <div className="rounded-2xl bg-[#f5f5f0]/60 px-4 py-3">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-[#5A5A40]/45 mb-1">Оплачено</p>
                  <p className="font-semibold text-[#5A5A40]">{formatMoney(detailsInvoice.paidAmountTotal)}</p>
                </div>
                <div className="rounded-2xl bg-[#f5f5f0]/60 px-4 py-3">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-[#5A5A40]/45 mb-1">Остаток</p>
                  <p className="font-semibold text-rose-700">{formatMoney(detailsInvoice.outstandingAmount)}</p>
                </div>
                <div className="rounded-2xl bg-[#f5f5f0]/60 px-4 py-3">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-[#5A5A40]/45 mb-1">Возврат</p>
                  <p className="font-semibold text-[#5A5A40]">{formatMoney(detailsInvoice.returnedAmountTotal)}</p>
                </div>
              </div>

              <div className="flex items-center justify-end text-lg font-bold text-[#5A5A40]">
                Итого: {Number(detailsInvoice.totalAmount || 0).toFixed(2)} TJS
              </div>
            </div>
          </div>
        </div>
      )}

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
