import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usePharmacy } from '../context';
import { useDebounce } from '../../lib/useDebounce';
import { downloadExcelFriendlyCsv } from '../../lib/excelCsv';
import { formatProductDisplayName } from '../../lib/productDisplay';
import { runRefreshTasks } from '../../lib/utils';
import { useCurrencyCode } from '../../lib/useCurrencyCode';
import { 
  Search, 
  FileText, 
  Download, 
  Printer, 
  ChevronRight,
  Calendar,
  AlertCircle,
  X,
} from 'lucide-react';

// Decomposed components
import { InvoicePaymentModal } from './invoices/InvoicePaymentModal';
import { InvoiceDetailsModal } from './invoices/InvoiceDetailsModal';
import { InvoiceEditModal } from './invoices/InvoiceEditModal';
import { InvoiceReturnModal } from './invoices/InvoiceReturnModal';
import { InvoiceDeleteModal } from './invoices/InvoiceDeleteModal';
import { InvoiceDebtorDetailsModal } from './invoices/InvoiceDebtorDetailsModal';
import { InvoiceTableRow } from './invoices/InvoiceTableRow';
import { 
  getInvoiceOutstandingAmount, 
  getPaymentStatusLabel, 
  formatPackQuantity,
  buildInvoiceDisplayItems 
} from './invoices/utils';
import { 
  DateFilterMode, 
  DebtorGroup, 
  EditableInvoiceItem, 
  ReturnInvoiceItem 
} from './invoices/types';

const formatDateInputValue = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const startOfMonthValue = (date: Date) => formatDateInputValue(new Date(date.getFullYear(), date.getMonth(), 1));
const startOfYearValue = (date: Date) => formatDateInputValue(new Date(date.getFullYear(), 0, 1));
const toLocalDayKey = (value: string | Date) => formatDateInputValue(new Date(value));

export const InvoicesView: React.FC<{
  viewMode?: 'history' | 'debtors';
  initialSearchTerm?: string;
  initialPaymentInvoiceId?: string;
  initialDetailsInvoiceId?: string;
  onInitialPaymentInvoiceHandled?: () => void;
  onInitialDetailsInvoiceHandled?: () => void;
}> = ({ 
  viewMode = 'history', 
  initialSearchTerm = '', 
  initialPaymentInvoiceId = '', 
  initialDetailsInvoiceId = '', 
  onInitialPaymentInvoiceHandled, 
  onInitialDetailsInvoiceHandled 
}) => {
  const { t } = useTranslation();
  const { invoices, products, isLoading, refreshInvoices, refreshProducts } = usePharmacy();
  const isDebtorsView = viewMode === 'debtors';
  const currentDate = new Date();
  const todayIso = formatDateInputValue(currentDate);
  const monthStartIso = startOfMonthValue(currentDate);
  const yearStartIso = startOfYearValue(currentDate);
  
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState<'date' | 'amount' | 'id'>('date');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [dateFilterMode, setDateFilterMode] = useState<DateFilterMode>(isDebtorsView ? 'all' : 'today');
  const [dateFrom, setDateFrom] = useState(todayIso);
  const [dateTo, setDateTo] = useState(todayIso);
  const currencyCode = useCurrencyCode();
  
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  
  // Modals state
  const [detailsInvoice, setDetailsInvoice] = useState<any | null>(null);
  const [detailsDebtor, setDetailsDebtor] = useState<DebtorGroup | null>(null);
  const [paymentModalInvoice, setPaymentModalInvoice] = useState<any | null>(null);
  const [editModalInvoice, setEditModalInvoice] = useState<any | null>(null);
  const [returnModalInvoice, setReturnModalInvoice] = useState<any | null>(null);
  const [deleteModalInvoice, setDeleteModalInvoice] = useState<any | null>(null);

  const [initialLoadPending, setInitialLoadPending] = useState(false);
  const itemsPerPage = 10;
  const [currentPage, setCurrentPage] = useState(1);

  const debouncedSearchTerm = useDebounce(searchTerm, 300);

  useEffect(() => {
    if (initialSearchTerm) setSearchTerm(initialSearchTerm);
  }, [initialSearchTerm]);

  useEffect(() => {
    if (invoices.length > 0) {
      setInitialLoadPending(false);
      return;
    }
    setInitialLoadPending(true);
    refreshInvoices().finally(() => setInitialLoadPending(false));
  }, [invoices.length, refreshInvoices]);

  const isInitialInvoicesLoading = initialLoadPending && invoices.length === 0;

  const matchesDateFilter = useCallback((createdAt: string | Date) => {
    const invoiceDate = new Date(createdAt);
    if (Number.isNaN(invoiceDate.getTime())) return false;
    if (dateFilterMode === 'all') return true;
    const invoiceDay = toLocalDayKey(createdAt);
    if (dateFilterMode === 'today') return invoiceDay === todayIso;
    if (dateFilterMode === 'week') {
      // Calculate start of week (Monday)
      const now = new Date();
      const day = now.getDay();
      const diff = now.getDate() - day + (day === 0 ? -6 : 1);
      const weekStart = new Date(now.setDate(diff));
      const weekStartIso = formatDateInputValue(weekStart);
      return invoiceDay >= weekStartIso && invoiceDay <= todayIso;
    }
    if (dateFilterMode === 'month') return invoiceDay >= monthStartIso && invoiceDay <= todayIso;
    if (dateFilterMode === 'year') return invoiceDay >= yearStartIso && invoiceDay <= todayIso;
    const from = dateFrom || todayIso;
    const to = dateTo || from;
    return invoiceDay >= from && invoiceDay <= to;
  }, [dateFilterMode, dateFrom, dateTo, monthStartIso, todayIso, yearStartIso]);

  const isDebtorInvoice = useCallback((invoice: any) => getInvoiceOutstandingAmount(invoice) > 0.009, []);

  const getProductDisplayLabel = useCallback((productId?: string, fallbackName?: string) => {
    const baseName = String(fallbackName || '-').trim() || '-';
    if (!productId) return baseName;
    const product = products.find((entry) => entry.id === productId);
    return formatProductDisplayName({
      name: baseName,
      countryOfOrigin: product?.countryOfOrigin,
    }, { includeCountry: true });
  }, [products]);

  const filteredInvoices = useMemo(() => {
    const filtered = invoices.filter((inv) => 
      matchesDateFilter(inv.createdAt)
      && (isDebtorsView ? isDebtorInvoice(inv) : (!isDebtorInvoice(inv) && String(inv.paymentStatus || '').toUpperCase() === 'PAID'))
      && (
        (inv.invoiceNo || '').toLowerCase().includes(debouncedSearchTerm.toLowerCase()) ||
        inv.id.toLowerCase().includes(debouncedSearchTerm.toLowerCase()) ||
        (isDebtorsView && (inv.customer || '').toLowerCase().includes(debouncedSearchTerm.toLowerCase()))
      )
    );

    return [...filtered].sort((a, b) => {
      let compareValue = 0;
      if (sortBy === 'date') compareValue = new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime();
      else if (sortBy === 'amount') compareValue = (a.totalAmount || 0) - (b.totalAmount || 0);
      else if (sortBy === 'id') compareValue = (a.id || '').localeCompare(b.id || '');
      return sortOrder === 'asc' ? compareValue : -compareValue;
    });
  }, [invoices, debouncedSearchTerm, sortBy, sortOrder, matchesDateFilter, isDebtorsView, isDebtorInvoice]);

  const debtorGroups = useMemo<DebtorGroup[]>(() => {
    if (!isDebtorsView) return [];
    const groups = new Map<string, DebtorGroup>();
    for (const invoice of filteredInvoices) {
      const customer = String(invoice.customer || 'Без имени').trim() || 'Без имени';
      const key = customer.toLocaleLowerCase('ru-RU').replace(/\s+/g, ' ');
      const paidAmount = Number(invoice.paidAmountTotal ?? 0);
      const outstandingAmount = getInvoiceOutstandingAmount(invoice);
      const totalAmount = Number(invoice.totalAmount || 0);
      const totalUnits = (invoice.items || []).reduce((sum: number, item: any) => sum + Math.max(0, Math.floor(Number(item?.quantity || 0))), 0);
      const createdAt = new Date(invoice.createdAt);

      const existing = groups.get(key);
      if (existing) {
        existing.invoices.push(invoice);
        existing.invoiceCount += 1;
        existing.totalAmount += totalAmount;
        existing.totalPaid += paidAmount;
        existing.totalOutstanding += outstandingAmount;
        existing.totalUnits += totalUnits;
        if (invoice.customerId && !existing.customerIds.includes(invoice.customerId)) existing.customerIds.push(invoice.customerId);
        if (!existing.latestActivityAt || createdAt > existing.latestActivityAt) existing.latestActivityAt = createdAt;
      } else {
        groups.set(key, {
          key, customer, customerIds: invoice.customerId ? [invoice.customerId] : [],
          invoices: [invoice], invoiceCount: 1, totalAmount, totalPaid: paidAmount,
          totalOutstanding: outstandingAmount, totalUnits, latestActivityAt: createdAt,
        });
      }
    }
    return [...groups.values()].sort((left, right) => {
      if (sortBy === 'amount') return sortOrder === 'asc' ? left.totalOutstanding - right.totalOutstanding : right.totalOutstanding - left.totalOutstanding;
      if (sortBy === 'id') return sortOrder === 'asc' ? left.customer.localeCompare(right.customer, 'ru-RU') : right.customer.localeCompare(left.customer, 'ru-RU');
      const leftTime = left.latestActivityAt?.getTime() || 0;
      const rightTime = right.latestActivityAt?.getTime() || 0;
      return sortOrder === 'asc' ? leftTime - rightTime : rightTime - leftTime;
    });
  }, [filteredInvoices, isDebtorsView, sortBy, sortOrder]);

  const totalItems = isDebtorsView ? debtorGroups.length : filteredInvoices.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / itemsPerPage));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const pageStartIndex = (safeCurrentPage - 1) * itemsPerPage;
  const visibleRowsCount = isDebtorsView ? debtorGroups.slice(pageStartIndex, pageStartIndex + itemsPerPage).length : filteredInvoices.slice(pageStartIndex, pageStartIndex + itemsPerPage).length;
  const fillerRowsCount = !isInitialInvoicesLoading && totalItems <= itemsPerPage ? Math.max(0, itemsPerPage - visibleRowsCount) : 0;

  const moneyLabel = (label: string) => `${label} (${currencyCode})`;

  const printInvoice = (invoice: any) => {
    const displayInvoiceNo = invoice.invoiceNo || invoice.id;
    const createdAt = new Date(invoice.createdAt);
    const displayItems = buildInvoiceDisplayItems(invoice.items || []);

    const receiptHtml = `
      <html>
        <head>
          <title>Накладная ${displayInvoiceNo}</title>
          <style>
            body { font-family: Segoe UI, sans-serif; padding: 20px; background: #f3f4f6; }
            .sheet { max-width: 800px; margin: 0 auto; background: #fff; padding: 20px; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
            table { width: 100%; border-collapse: collapse; margin-top: 10px; }
            th, td { border-bottom: 1px solid #eee; padding: 8px; text-align: left; font-size: 13px; }
            .right { text-align: right; }
            .total { margin-top: 20px; font-weight: bold; text-align: right; font-size: 16px; }
            @media print { .toolbar { display: none; } .sheet { box-shadow: none; border-radius: 0; padding: 0; } }
          </style>
        </head>
        <body>
          <div class="sheet">
            <h1>Накладная ${displayInvoiceNo}</h1>
            <p>Дата: ${createdAt.toLocaleString('ru-RU')} | Статус: ${invoice.status}</p>
            <table>
              <thead><tr><th>№</th><th>Товар</th><th class="right">Кол-во</th><th class="right">Цена</th><th class="right">Сумма</th></tr></thead>
              <tbody>
                ${displayItems.map((item, idx) => `<tr>
                  <td>${idx + 1}</td>
                  <td>${getProductDisplayLabel(item.productId, item.productName)}</td>
                  <td class="right">${formatPackQuantity(item.quantity)}</td>
                  <td class="right">${item.unitPrice.toFixed(2)}</td>
                  <td class="right">${item.totalPrice.toFixed(2)}</td>
                </tr>`).join('')}
              </tbody>
            </table>
            <div class="total">Итого: ${invoice.totalAmount.toFixed(2)} ${currencyCode}</div>
          </div>
        </body>
      </html>
    `;

    const win = window.open('', '_blank');
    if (win) {
      win.document.write(receiptHtml);
      win.document.close();
      win.print();
    }
  };

  const exportCsv = () => {
    const header = isDebtorsView 
      ? ['Накладная', 'Покупатель', 'Дата', 'Тип оплаты', 'Статус', 'Долг']
      : ['Накладная', 'Дата', 'Тип оплаты', 'Статус', 'Сумма'];
    
    const rows = filteredInvoices.map(inv => isDebtorsView 
      ? [inv.invoiceNo || inv.id, inv.customer || '', new Date(inv.createdAt).toLocaleString(), inv.paymentType, inv.status, getInvoiceOutstandingAmount(inv).toFixed(2)]
      : [inv.invoiceNo || inv.id, new Date(inv.createdAt).toLocaleString(), inv.paymentType, inv.status, inv.totalAmount.toFixed(2)]
    );

    downloadExcelFriendlyCsv(`${isDebtorsView ? 'debtors' : 'invoices'}.csv`, [header, ...rows]);
  };

  return (
    <div className="flex-1 space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-[#5A5A40]">{isDebtorsView ? 'Сверка с должниками' : 'История продаж'}</h2>
          <p className="text-sm text-[#5A5A40]/60 mt-1">{isDebtorsView ? 'Управление дебиторской задолженностью' : 'Полный список оформленных чеков и накладных'}</p>
        </div>
        <button onClick={exportCsv} className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-white px-5 py-2 text-sm font-bold text-[#5A5A40] shadow-sm border border-[#5A5A40]/10 hover:bg-[#f5f5f0] transition-all">
          <Download size={18} /> Экспорт CSV
        </button>
      </div>

      <div className="flex flex-col gap-4 bg-white/50 backdrop-blur-md rounded-3xl p-6 border border-[#5A5A40]/5 shadow-sm">
        {/* Quick date filter presets for sales history */}
        {!isDebtorsView && (
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <button
              className={`px-3 py-2 rounded-xl text-sm font-medium border transition-all ${dateFilterMode === 'today' ? 'bg-[#5A5A40] text-white' : 'bg-white text-[#5A5A40]/60 border-[#5A5A40]/10'}`}
              onClick={() => {
                setDateFilterMode('today');
                setDateFrom(todayIso);
                setDateTo(todayIso);
              }}
            >Сегодня</button>
            <button
              className={`px-3 py-2 rounded-xl text-sm font-medium border transition-all ${dateFilterMode === 'week' ? 'bg-[#5A5A40] text-white' : 'bg-white text-[#5A5A40]/60 border-[#5A5A40]/10'}`}
              onClick={() => {
                // Calculate start of week (Monday)
                const now = new Date();
                const day = now.getDay();
                const diff = now.getDate() - day + (day === 0 ? -6 : 1); // adjust when day is Sunday
                const weekStart = new Date(now.setDate(diff));
                const weekStartIso = formatDateInputValue(weekStart);
                setDateFilterMode('week');
                setDateFrom(weekStartIso);
                setDateTo(todayIso);
              }}
            >Неделя</button>
            <button
              className={`px-3 py-2 rounded-xl text-sm font-medium border transition-all ${dateFilterMode === 'month' ? 'bg-[#5A5A40] text-white' : 'bg-white text-[#5A5A40]/60 border-[#5A5A40]/10'}`}
              onClick={() => {
                setDateFilterMode('month');
                setDateFrom(monthStartIso);
                setDateTo(todayIso);
              }}
            >Месяц</button>
            <button
              className={`px-3 py-2 rounded-xl text-sm font-medium border transition-all ${dateFilterMode === 'custom' ? 'bg-[#5A5A40] text-white' : 'bg-white text-[#5A5A40]/60 border-[#5A5A40]/10'}`}
              onClick={() => setDateFilterMode('custom')}
            >Период...</button>
            {dateFilterMode === 'custom' && (
              <span className="flex items-center gap-1 ml-2">
                <input
                  type="date"
                  value={dateFrom}
                  onChange={e => setDateFrom(e.target.value)}
                  className="px-2 py-1 rounded border text-sm"
                  style={{ minWidth: 120 }}
                />
                <span className="mx-1">—</span>
                <input
                  type="date"
                  value={dateTo}
                  onChange={e => setDateTo(e.target.value)}
                  className="px-2 py-1 rounded border text-sm"
                  style={{ minWidth: 120 }}
                />
              </span>
            )}
          </div>
        )}
        <div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
          <div className="relative group w-full xl:max-w-85">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-[#5A5A40]/30" size={18} />
            <input 
              type="text" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Поиск..." className="w-full pl-12 pr-4 py-2.5 bg-white border border-[#5A5A40]/10 rounded-2xl text-sm outline-none focus:ring-2 focus:ring-[#5A5A40]/20 transition-all shadow-sm"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {['date', 'amount', 'id'].map((key) => (
              <button
                key={key}
                onClick={() => {
                  if (sortBy === key) setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
                  else { setSortBy(key as any); setSortOrder('desc'); }
                }}
                className={`px-3 py-2 rounded-xl text-sm font-medium border transition-all ${sortBy === key ? 'bg-[#5A5A40] text-white' : 'bg-white text-[#5A5A40]/60 border-[#5A5A40]/10'}`}
              >
                {t(`Sort by ${key}`)} {sortBy === key && (sortOrder === 'asc' ? '↑' : '↓')}
              </button>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-3xl border border-[#5A5A40]/5 overflow-hidden">
          {actionError && <div className="m-4 p-3 bg-red-50 text-red-600 text-xs rounded-xl flex items-center gap-2"><AlertCircle size={14} />{actionError}</div>}
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[#f5f5f0]/95 text-[9px] uppercase tracking-[0.2em] text-[#5A5A40]/45 font-bold">
                  <th className="px-4 py-3.5 text-center">№</th>
                  <th className="px-6 py-3.5">{isDebtorsView ? 'Клиент' : 'Накладная'}</th>
                  <th className="px-6 py-3.5">Дата</th>
                  <th className="px-6 py-3.5">Статус</th>
                  <th className="px-4 py-3.5 text-right">Кол-во</th>
                  <th className="px-4 py-3.5 text-right">Сумма</th>
                  <th className="px-4 py-3.5 text-right">Оплачено</th>
                  <th className="px-4 py-3.5 text-right">Остаток</th>
                  <th className="px-6 py-3.5 text-right">Действия</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#5A5A40]/5">
                {isInitialInvoicesLoading ? (
                  <tr><td colSpan={9} className="p-8 text-center text-sm text-[#5A5A40]/40">Загрузка...</td></tr>
                ) : (
                  isDebtorsView
                    ? debtorGroups
                        .slice(pageStartIndex, pageStartIndex + itemsPerPage)
                        .map((group, groupIdx) => (
                          <tr key={group.key} className="hover:bg-[#f5f5f0]/30 transition-colors group align-top cursor-pointer" onClick={() => setDetailsDebtor(group)}>
                            <td className="px-4 py-3.5 text-center">
                              <span className="inline-flex min-w-7 h-7 items-center justify-center rounded-lg bg-[#f5f5f0] text-[#5A5A40] text-[12px] font-bold">{pageStartIndex + groupIdx + 1}</span>
                            </td>
                            <td className="px-6 py-3.5">
                              <span className="font-bold text-[#5A5A40]">{group.customer}</span>
                            </td>
                            <td className="px-6 py-3.5">
                              <span className="text-[12px] text-[#5A5A40]/60">{group.latestActivityAt ? new Date(group.latestActivityAt).toLocaleDateString() : ''}</span>
                            </td>
                            <td className="px-6 py-3.5">
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[9px] font-bold border bg-rose-50 text-rose-700 border-rose-200">
                                ● Долг
                              </span>
                            </td>
                            <td className="px-4 py-3.5 text-right">
                              <span className="text-[12px] font-semibold text-[#5A5A40]">{group.totalUnits} ед.</span>
                              <span className="text-[9px] text-[#5A5A40]/40 ml-2">{group.invoiceCount} накл.</span>
                            </td>
                            <td className="px-4 py-3.5 text-right">
                              <span className="text-[13px] font-bold text-[#5A5A40]">{group.totalAmount.toFixed(2)}</span>
                            </td>
                            <td className="px-4 py-3.5 text-right">
                              <span className="text-[13px] font-semibold text-emerald-700">{group.totalPaid.toFixed(2)}</span>
                            </td>
                            <td className="px-4 py-3.5 text-right">
                              <span className="text-[13px] font-semibold text-rose-700">{group.totalOutstanding.toFixed(2)}</span>
                            </td>
                            <td className="px-6 py-3.5 text-right">
                              <span className="text-xs text-[#5A5A40]/30">Открыть детали</span>
                            </td>
                          </tr>
                        ))
                    : filteredInvoices
                        .slice(pageStartIndex, pageStartIndex + itemsPerPage)
                        .map((item, idx) => (
                          <InvoiceTableRow
                            key={item.id}
                            invoice={item}
                            index={pageStartIndex + idx + 1}
                            currencyCode={currencyCode}
                            busyId={busyId}
                            isDebtorsView={isDebtorsView}
                            onDetails={setDetailsInvoice}
                            onPrint={printInvoice}
                            onPayment={setPaymentModalInvoice}
                            onEdit={setEditModalInvoice}
                            onReturn={setReturnModalInvoice}
                            onDelete={setDeleteModalInvoice}
                          />
                        ))
                )}
                {fillerRowsCount > 0 && Array.from({ length: fillerRowsCount }).map((_, i) => <tr key={`f-${i}`} className="h-16" />)}
              </tbody>
            </table>
          </div>
          
          {totalPages > 1 && (
            <div className="p-4 border-t border-[#5A5A40]/5 flex items-center justify-between">
              <span className="text-xs text-[#5A5A40]/50">Страница {safeCurrentPage} из {totalPages}</span>
              <div className="flex gap-2">
                <button disabled={safeCurrentPage === 1} onClick={() => setCurrentPage(p => p - 1)} className="px-3 py-1.5 rounded-lg border text-sm disabled:opacity-30">Назад</button>
                <button disabled={safeCurrentPage === totalPages} onClick={() => setCurrentPage(p => p + 1)} className="px-3 py-1.5 rounded-lg border text-sm disabled:opacity-30">Вперед</button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Modals */}
      <InvoicePaymentModal 
        isOpen={!!paymentModalInvoice} 
        onClose={() => {
          setPaymentModalInvoice(null);
          refreshInvoices();
        }}
        invoice={paymentModalInvoice} currencyCode={currencyCode} 
        busyId={busyId} setBusyId={setBusyId} getInvoiceOutstandingAmount={getInvoiceOutstandingAmount}
      />
      <InvoiceDetailsModal 
        isOpen={!!detailsInvoice} onClose={() => setDetailsInvoice(null)} 
        invoice={detailsInvoice} currencyCode={currencyCode} isDebtorsView={isDebtorsView} 
      />
      <InvoiceEditModal 
        isOpen={!!editModalInvoice} onClose={() => setEditModalInvoice(null)} 
        invoice={editModalInvoice} currencyCode={currencyCode} 
        busyId={busyId} setBusyId={setBusyId} isDebtorsView={isDebtorsView}
      />
      <InvoiceReturnModal 
        isOpen={!!returnModalInvoice} onClose={() => setReturnModalInvoice(null)} 
        invoice={returnModalInvoice} busyId={busyId} setBusyId={setBusyId}
      />
      <InvoiceDeleteModal 
        isOpen={!!deleteModalInvoice} onClose={() => setDeleteModalInvoice(null)} 
        invoice={deleteModalInvoice} busyId={busyId} setBusyId={setBusyId}
      />
      <InvoiceDebtorDetailsModal 
        isOpen={!!detailsDebtor} onClose={() => setDetailsDebtor(null)} 
        debtor={detailsDebtor} currencyCode={currencyCode} 
        onViewInvoice={setDetailsInvoice} onPayInvoice={setPaymentModalInvoice}
      />
    </div>
  );
};
