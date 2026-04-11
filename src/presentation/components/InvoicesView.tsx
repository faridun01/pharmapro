import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  DollarSign,
  User as UserIcon,
  Pencil,
  RotateCcw,
  Clock,
  AlertCircle,
  Trash2,
  X,
} from 'lucide-react';

type EditableInvoiceItem = {
  id: string;
  productId?: string;
  productName: string;
  quantity: number;
  unitPrice: number;
};

type ReturnInvoiceItem = {
  id: string;
  productId?: string;
  productName: string;
  batchNo: string;
  soldQuantity: number;
  quantity: number;
};

type InvoiceDisplayItem = {
  id: string;
  productId?: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
};

type DebtorGroup = {
  key: string;
  customer: string;
  customerIds: string[];
  invoices: any[];
  invoiceCount: number;
  totalAmount: number;
  totalPaid: number;
  totalOutstanding: number;
  totalUnits: number;
  overdueCount: number;
  latestActivityAt: Date | null;
};

export const InvoicesView: React.FC<{
  viewMode?: 'history' | 'debtors';
  initialSearchTerm?: string;
  initialPaymentInvoiceId?: string;
  initialDetailsInvoiceId?: string;
  onInitialPaymentInvoiceHandled?: () => void;
  onInitialDetailsInvoiceHandled?: () => void;
}> = ({ viewMode = 'history', initialSearchTerm = '', initialPaymentInvoiceId = '', initialDetailsInvoiceId = '', onInitialPaymentInvoiceHandled, onInitialDetailsInvoiceHandled }) => {
  const { t } = useTranslation();
  const { invoices, products, isLoading, refreshInvoices, refreshProducts } = usePharmacy();
  const isDebtorsView = viewMode === 'debtors';
  const todayIso = new Date().toISOString().slice(0, 10);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState<'date' | 'amount' | 'id'>('date');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [dateFilterMode, setDateFilterMode] = useState<'all' | 'today' | 'custom'>('all');
  const [dateFrom, setDateFrom] = useState(todayIso);
  const [dateTo, setDateTo] = useState(todayIso);
  const [debtFilter, setDebtFilter] = useState<'all' | 'overdue'>('all');
  const currencyCode = useCurrencyCode();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [detailsInvoice, setDetailsInvoice] = useState<any | null>(null);
  const [detailsDebtor, setDetailsDebtor] = useState<DebtorGroup | null>(null);
  const [returnInvoiceTarget, setReturnInvoiceTarget] = useState<{
    invoice: any;
    items: ReturnInvoiceItem[];
    error: string | null;
  } | null>(null);
  const [deleteInvoiceTarget, setDeleteInvoiceTarget] = useState<any | null>(null);
  const [editModal, setEditModal] = useState<{
    open: boolean;
    invoiceId: string;
    customer: string;
    taxAmount: number;
    discount: number;
    totalAmount: string;
    items: EditableInvoiceItem[];
    error: string | null;
  }>({
    open: false,
    invoiceId: '',
    customer: '',
    taxAmount: 0,
    discount: 0,
    totalAmount: '',
    items: [],
    error: null,
  });
  const [paymentModal, setPaymentModal] = useState<{
    open: boolean;
    invoice: any | null;
    amount: string;
    method: 'CASH' | 'CARD' | 'BANK_TRANSFER';
    comment: string;
    error: string | null;
  }>({
    open: false,
    invoice: null,
    amount: '',
    method: 'CASH',
    comment: '',
    error: null,
  });
  const paymentAmountInputRef = useRef<HTMLInputElement | null>(null);
  const [invoicesScrollTop, setInvoicesScrollTop] = useState(0);
  const [initialLoadPending, setInitialLoadPending] = useState(false);
  const resetPaymentModal = () => setPaymentModal({ open: false, invoice: null, amount: '', method: 'CASH', comment: '', error: null });

  const INVOICE_ROW_HEIGHT = 88;
  const INVOICE_VIEWPORT_HEIGHT = 620;
  const INVOICE_OVERSCAN = 8;

  // Debounce search to 300ms to avoid filtering on every keystroke
  const debouncedSearchTerm = useDebounce(searchTerm, 300);

  useEffect(() => {
    if (initialSearchTerm) {
      setSearchTerm(initialSearchTerm);
    }
  }, [initialSearchTerm]);

  useEffect(() => {
    if (invoices.length > 0) {
      setInitialLoadPending(false);
      return;
    }

    let cancelled = false;
    setInitialLoadPending(true);

    void refreshInvoices().finally(() => {
      if (!cancelled) {
        setInitialLoadPending(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [invoices.length, refreshInvoices]);

  const isInitialInvoicesLoading = initialLoadPending && invoices.length === 0;

  const matchesDateFilter = useCallback((createdAt: string | Date) => {
    const invoiceDate = new Date(createdAt);
    if (Number.isNaN(invoiceDate.getTime())) return false;

    if (dateFilterMode === 'all') {
      return true;
    }

    const invoiceDay = invoiceDate.toISOString().slice(0, 10);
    if (dateFilterMode === 'today') {
      return invoiceDay === todayIso;
    }

    const from = dateFrom || todayIso;
    const to = dateTo || from;
    return invoiceDay >= from && invoiceDay <= to;
  }, [dateFilterMode, dateFrom, dateTo, todayIso]);

  const getInvoiceOutstandingAmount = useCallback((invoice: any) => Number(
    invoice?.outstandingAmount
      ?? invoice?.receivables?.[0]?.remainingAmount
      ?? invoice?.totalAmount
      ?? 0
  ), []);

  const isDebtorInvoice = useCallback((invoice: any) => getInvoiceOutstandingAmount(invoice) > 0.009, [getInvoiceOutstandingAmount]);
  const isOverdueInvoice = useCallback((invoice: any) => {
    const dueDateValue = invoice?.receivables?.[0]?.dueDate;
    if (!dueDateValue || !isDebtorInvoice(invoice)) return false;
    const dueDate = new Date(dueDateValue);
    if (Number.isNaN(dueDate.getTime())) return false;
    return dueDate.getTime() < Date.now();
  }, [isDebtorInvoice]);

  const moneyLabel = useCallback((label: string) => `${label} (${currencyCode})`, [currencyCode]);

  const getProductDisplayLabel = useCallback((productId?: string, fallbackName?: string) => {
    const baseName = String(fallbackName || '-').trim() || '-';
    if (!productId) {
      return baseName;
    }

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
      && (!isDebtorsView || debtFilter === 'all' || isOverdueInvoice(inv))
      && (
        (inv.invoiceNo || '').toLowerCase().includes(debouncedSearchTerm.toLowerCase()) ||
        inv.id.toLowerCase().includes(debouncedSearchTerm.toLowerCase()) ||
        (isDebtorsView && (inv.customer || '').toLowerCase().includes(debouncedSearchTerm.toLowerCase()))
      )
    );

    // Apply sorting
    const sorted = [...filtered].sort((a, b) => {
      let compareValue = 0;
      
      if (sortBy === 'date') {
        compareValue = new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime();
      } else if (sortBy === 'amount') {
        compareValue = (a.totalAmount || 0) - (b.totalAmount || 0);
      } else if (sortBy === 'id') {
        compareValue = (a.id || '').localeCompare(b.id || '');
      }

      return sortOrder === 'asc' ? compareValue : -compareValue;
    });

    return sorted;
  }, [invoices, debouncedSearchTerm, sortBy, sortOrder, matchesDateFilter, isDebtorsView, isDebtorInvoice, debtFilter, isOverdueInvoice]);

  const debtorGroups = useMemo<DebtorGroup[]>(() => {
    if (!isDebtorsView) {
      return [];
    }

    const groups = new Map<string, DebtorGroup>();

    for (const invoice of filteredInvoices) {
      const customer = String(invoice.customer || 'Без имени').trim() || 'Без имени';
      const key = customer.toLocaleLowerCase('ru-RU').replace(/\s+/g, ' ');
      const paidAmount = Number((invoice as any).paidAmountTotal ?? 0);
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
        existing.overdueCount += isOverdueInvoice(invoice) ? 1 : 0;
        if (invoice.customerId && !existing.customerIds.includes(invoice.customerId)) {
          existing.customerIds.push(invoice.customerId);
        }
        if (!existing.latestActivityAt || createdAt > existing.latestActivityAt) {
          existing.latestActivityAt = createdAt;
        }
        continue;
      }

      groups.set(key, {
        key,
        customer,
        customerIds: invoice.customerId ? [invoice.customerId] : [],
        invoices: [invoice],
        invoiceCount: 1,
        totalAmount,
        totalPaid: paidAmount,
        totalOutstanding: outstandingAmount,
        totalUnits,
        overdueCount: isOverdueInvoice(invoice) ? 1 : 0,
        latestActivityAt: createdAt,
      });
    }

    return [...groups.values()].sort((left, right) => {
      if (sortBy === 'amount') {
        return sortOrder === 'asc'
          ? left.totalOutstanding - right.totalOutstanding
          : right.totalOutstanding - left.totalOutstanding;
      }

      if (sortBy === 'id') {
        return sortOrder === 'asc'
          ? left.customer.localeCompare(right.customer, 'ru-RU')
          : right.customer.localeCompare(left.customer, 'ru-RU');
      }

      const leftTime = left.latestActivityAt?.getTime() || 0;
      const rightTime = right.latestActivityAt?.getTime() || 0;
      return sortOrder === 'asc' ? leftTime - rightTime : rightTime - leftTime;
    });
  }, [filteredInvoices, getInvoiceOutstandingAmount, isDebtorsView, isOverdueInvoice, sortBy, sortOrder]);

  useEffect(() => {
    if (!detailsDebtor) {
      return;
    }

    const nextDebtor = debtorGroups.find((debtor) => debtor.key === detailsDebtor.key) || null;
    if (nextDebtor !== detailsDebtor) {
      setDetailsDebtor(nextDebtor);
    }
  }, [debtorGroups, detailsDebtor]);

  const invoicesSummary = useMemo(() => {
    const totalRevenue = filteredInvoices.reduce((acc, inv) => acc + inv.totalAmount, 0);
    const totalCount = isDebtorsView ? debtorGroups.length : filteredInvoices.length;
    const totalOutstanding = isDebtorsView
      ? debtorGroups.reduce((acc, debtor) => acc + debtor.totalOutstanding, 0)
      : filteredInvoices.reduce((acc, inv) => acc + getInvoiceOutstandingAmount(inv), 0);
    const overdueCount = isDebtorsView
      ? debtorGroups.filter((debtor) => debtor.overdueCount > 0).length
      : filteredInvoices.filter((inv) => isOverdueInvoice(inv)).length;
    return {
      totalRevenue,
      totalCount,
      totalOutstanding,
      overdueCount,
      averageOrder: totalRevenue / (totalCount || 1),
    };
  }, [debtorGroups, filteredInvoices, getInvoiceOutstandingAmount, isDebtorsView, isOverdueInvoice]);

  const onInvoicesScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    setInvoicesScrollTop(event.currentTarget.scrollTop);
  }, []);

  const invoiceStartIndex = Math.max(0, Math.floor(invoicesScrollTop / INVOICE_ROW_HEIGHT) - INVOICE_OVERSCAN);
  const invoiceVisibleCount = Math.ceil(INVOICE_VIEWPORT_HEIGHT / INVOICE_ROW_HEIGHT) + INVOICE_OVERSCAN * 2;
  const invoiceEndIndex = Math.min(filteredInvoices.length, invoiceStartIndex + invoiceVisibleCount);
  const visibleInvoices = filteredInvoices.slice(invoiceStartIndex, invoiceEndIndex);
  const invoiceTopSpacerHeight = invoiceStartIndex * INVOICE_ROW_HEIGHT;
  const invoiceBottomSpacerHeight = Math.max(0, (filteredInvoices.length - invoiceEndIndex) * INVOICE_ROW_HEIGHT);

  const isReturnLocked = (status: string) => status === 'RETURNED';
  const isEditLocked = (status: string) => status === 'RETURNED' || status === 'PARTIALLY_RETURNED';

  const formatMoney = (value: number) => `${Number(value || 0).toFixed(2)} TJS`;

  const formatMoneyCompact = (value: number) => `${Number(value || 0).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} TJS`;

  const formatPackQuantity = (quantity: number) => {
    const wholeQuantity = Math.max(0, Math.floor(Number(quantity || 0)));
    return `${wholeQuantity} ед.`;
  };

  const computeInvoiceModalTotal = (items: EditableInvoiceItem[], taxAmount: number, discount: number) => {
    const subtotal = items.reduce((sum, item) => sum + Number(item.quantity || 0) * Number(item.unitPrice || 0), 0);
    return Math.max(0, subtotal + Number(taxAmount || 0) - Number(discount || 0));
  };

  const formatInvoiceQuantitySummary = (items: any[] = []) => {
    const totalUnits = items.reduce((sum, item) => sum + Math.max(0, Math.floor(Number(item?.quantity || 0))), 0);
    return `${totalUnits} ед.`;
  };

  const buildInvoiceDisplayItems = (items: any[] = []): InvoiceDisplayItem[] => {
    const grouped = new Map<string, InvoiceDisplayItem>();

    for (const item of items) {
      const productName = String(item?.productName || '-').trim() || '-';
      const productId = item?.productId ? String(item.productId) : undefined;
      const key = productId || productName.toLocaleLowerCase('ru-RU').replace(/\s+/g, ' ');
      const quantity = Math.max(0, Math.floor(Number(item?.quantity || 0)));
      const unitPrice = Number(item?.unitPrice || 0);
      const totalPrice = Number(item?.totalPrice || 0);
      const existing = grouped.get(key);

      if (existing) {
        existing.quantity += quantity;
        existing.totalPrice += totalPrice;
        continue;
      }

      grouped.set(key, {
        id: String(item?.id || key),
        productId,
        productName,
        quantity,
        unitPrice,
        totalPrice,
      });
    }

    return [...grouped.values()];
  };

  const closeEditModal = () => setEditModal({ open: false, invoiceId: '', customer: '', taxAmount: 0, discount: 0, totalAmount: '', items: [], error: null });

  const openReturnModal = (invoice: any) => {
    const returnedByItemKey = new Map<string, number>();
    for (const ret of invoice.returns || []) {
      for (const item of ret.items || []) {
        const key = `${item.productId}:${item.batchId || ''}`;
        returnedByItemKey.set(key, Number(returnedByItemKey.get(key) || 0) + Number(item.quantity || 0));
      }
    }

    setReturnInvoiceTarget({
      invoice,
      items: (invoice.items || []).map((item: any) => {
        const remainingQuantity = Math.max(0, Number(item.quantity || 0) - Number(returnedByItemKey.get(`${item.productId}:${item.batchId || ''}`) || 0));
        return {
          id: item.id,
          productId: item.productId,
          productName: item.productName || '-',
          batchNo: item.batchNo || '—',
          soldQuantity: remainingQuantity,
          quantity: remainingQuantity,
        };
      }),
      error: null,
    });
  };

  const closeReturnModal = () => setReturnInvoiceTarget(null);

  const updateReturnItemPackaging = (itemId: string, boxesValue: string, unitsValue: string) => {
    setReturnInvoiceTarget((prev) => {
      if (!prev) return prev;

      return {
        ...prev,
        error: null,
        items: prev.items.map((item) => {
          if (item.id !== itemId) return item;

          return {
            ...item,
            quantity: Math.max(0, Math.min(item.soldQuantity, Math.floor(Number(unitsValue) || 0))),
          };
        }),
      };
    });
  };

  const updateEditItem = (itemId: string, patch: Partial<EditableInvoiceItem>) => {
    setEditModal((prev) => {
      const items = prev.items.map((item) => item.id === itemId ? { ...item, ...patch } : item);
      return {
        ...prev,
        totalAmount: computeInvoiceModalTotal(items, prev.taxAmount, prev.discount).toFixed(2),
        error: null,
      };
    });
  };

  const updateEditItemPackaging = (itemId: string, boxesValue: string, unitsValue: string) => {
    setEditModal((prev) => {
      const items = prev.items.map((item) => {
        if (item.id !== itemId) return item;

        const quantity = Math.max(1, Math.floor(Number(unitsValue) || 0));

        return { ...item, quantity };
      });

      return {
        ...prev,
        items,
        totalAmount: computeInvoiceModalTotal(items, prev.taxAmount, prev.discount).toFixed(2),
        error: null,
      };
    });
  };

  const authHeaders = () => {
    const token = window.sessionStorage.getItem('pharmapro_token') || localStorage.getItem('pharmapro_token');
    return {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  };

  const exportInvoicesReport = () => {
    const rows = filteredInvoices.map((invoice) => ({
      invoiceNo: invoice.invoiceNo || invoice.id,
      customer: invoice.customer || '',
      createdAt: new Date(invoice.createdAt).toLocaleString('ru-RU'),
      paymentType: invoice.paymentType,
      status: invoice.status,
      paymentStatus: invoice.paymentStatus || 'UNPAID',
      totalAmount: Number(invoice.totalAmount || 0).toFixed(2),
      debt: Number(invoice.receivables?.[0]?.remainingAmount || 0).toFixed(2),
    }));

    const header = isDebtorsView
      ? ['Накладная', 'Покупатель', 'Дата', 'Тип оплаты', 'Статус', 'Состояние долга', moneyLabel('Сумма'), moneyLabel('Долг')]
      : ['Накладная', 'Дата', 'Тип оплаты', 'Статус', 'Статус оплаты', moneyLabel('Сумма')];
    const csvRows = [
      header,
      ...rows.map((row) => (isDebtorsView
        ? [row.invoiceNo, row.customer, row.createdAt, row.paymentType, row.status, row.paymentStatus, row.totalAmount, row.debt]
        : [row.invoiceNo, row.createdAt, row.paymentType, row.status, row.paymentStatus, row.totalAmount])),
    ];

    downloadExcelFriendlyCsv(
      `${isDebtorsView ? 'debtors' : 'sales-history'}-${new Date().toISOString().slice(0, 10)}.csv`,
      csvRows,
    );
  };

  const editInvoice = async (invoice: any) => {
    const items: EditableInvoiceItem[] = (invoice.items || []).map((item: any) => ({
      id: item.id,
      productId: item.productId,
      productName: item.productName || '-',
      quantity: Number(item.quantity || 0),
      unitPrice: Number(item.unitPrice || 0),
    }));

    setEditModal({
      open: true,
      invoiceId: invoice.id,
      customer: invoice.customer || '',
      taxAmount: Number(invoice.taxAmount || 0),
      discount: Number(invoice.discount || 0),
      totalAmount: computeInvoiceModalTotal(items, Number(invoice.taxAmount || 0), Number(invoice.discount || 0)).toFixed(2),
      items,
      error: null,
    });
  };

  const submitEditInvoice = async () => {
    const totalAmount = Number(editModal.totalAmount);
    if (Number.isNaN(totalAmount) || totalAmount < 0) {
      setEditModal((prev) => ({ ...prev, error: t('Invalid total amount') }));
      return;
    }

    if (editModal.items.some((item) => !Number.isFinite(item.quantity) || item.quantity <= 0)) {
      setEditModal((prev) => ({ ...prev, error: 'Укажите корректное количество для всех строк' }));
      return;
    }

    try {
      setBusyId(editModal.invoiceId);
      setActionError(null);
      const res = await fetch(`/api/invoices/${editModal.invoiceId}`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({
          customer: editModal.customer,
          taxAmount: editModal.taxAmount,
          discount: editModal.discount,
          totalAmount,
          items: editModal.items.map((item) => ({
            id: item.id,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
          })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || t('Failed to edit invoice'));
      closeEditModal();
      await runRefreshTasks(refreshInvoices, refreshProducts);
    } catch (e: any) {
      setEditModal((prev) => ({ ...prev, error: e.message || t('Failed to edit invoice') }));
    } finally {
      setBusyId(null);
    }
  };

  const returnInvoice = async (invoice: any) => {
    const target = returnInvoiceTarget;
    if (!target) return;

    const selectedItems = target.items
      .filter((item) => item.quantity > 0)
      .map((item) => ({ id: item.id, quantity: item.quantity }));

    if (selectedItems.length === 0) {
      setReturnInvoiceTarget((prev) => prev ? { ...prev, error: 'Укажите количество хотя бы для одной позиции' } : prev);
      return;
    }

    try {
      setBusyId(invoice.id);
      setActionError(null);
      const res = await fetch(`/api/invoices/${invoice.id}/return`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ reason: 'Return from sales history', refundMethod: 'CASH', items: selectedItems }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || t('Failed to return invoice'));
      closeReturnModal();
      await runRefreshTasks(refreshInvoices, refreshProducts);
    } catch (e: any) {
      setReturnInvoiceTarget((prev) => prev ? { ...prev, error: e.message || t('Failed to return invoice') } : prev);
    } finally {
      setBusyId(null);
    }
  };

  const printInvoice = (invoice: any) => {
    const displayInvoiceNo = invoice.invoiceNo || invoice.id;
    const createdAt = new Date(invoice.createdAt);
    const formatQuantityLabel = (item: any) => formatPackQuantity(Number(item?.quantity || 0));
    const displayItems = buildInvoiceDisplayItems(invoice.items || []);

    const receiptHtml = `
      <html>
        <head>
          <title>Накладная ${displayInvoiceNo}</title>
          <style>
            body { font-family: Segoe UI, Arial, sans-serif; margin: 0; padding: 20px; color: #2d2d2d; background: #f3f4f6; }
            .toolbar { max-width: 900px; margin: 0 auto 12px; display: flex; justify-content: space-between; align-items: center; background: #fff; padding: 10px 14px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0, 0, 0, 0.08); }
            .btn { border: 0; background: #374151; color: #fff; padding: 8px 14px; border-radius: 8px; cursor: pointer; font-weight: 600; }
            .sheet { max-width: 900px; margin: 0 auto; background: #fff; padding: 26px; border-radius: 10px; box-shadow: 0 8px 20px rgba(0, 0, 0, 0.08); }
            h1 { margin: 0 0 8px; font-size: 22px; }
            .muted { color: #666; font-size: 12px; margin-bottom: 16px; }
            table { width: 100%; border-collapse: collapse; margin-top: 10px; }
            th, td { border-bottom: 1px solid #e5e7eb; padding: 8px; text-align: left; font-size: 12px; }
            th { background: #f8fafc; color: #64748b; text-transform: uppercase; font-size: 10px; letter-spacing: .04em; }
            .num { width: 36px; text-align: center; color: #666; }
            .right { text-align: right; }
            .total { margin-top: 16px; font-size: 16px; font-weight: bold; text-align: right; }
            @page { size: A4 portrait; margin: 12mm; }
            @media print {
              body { background: #fff; padding: 0; }
              .toolbar { display: none; }
              .sheet { box-shadow: none; border-radius: 0; max-width: unset; padding: 0; }
            }
          </style>
          <script>
            function saveInvoicePreview() {
              const html = document.documentElement.outerHTML;
              const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = 'invoice-${displayInvoiceNo}.html';
              a.click();
              URL.revokeObjectURL(url);
            }
          </script>
        </head>
        <body>
          <div class="toolbar">
            <div style="font-weight:700">Предпросмотр накладной</div>
            <div style="display:flex; gap:8px;">
              <button class="btn" onclick="saveInvoicePreview()" style="background:#2563eb;">Сохранить</button>
              <button class="btn" onclick="window.print()">Печать</button>
              <button class="btn" onclick="window.close()" style="background:#9ca3af;">Закрыть</button>
            </div>
          </div>
          <div class="sheet">
            <h1>Накладная ${displayInvoiceNo}</h1>
            <div class="muted">${invoice.customer ? `${isDebtorsView ? 'Покупатель' : 'Продажа'}: ${invoice.customer} | ` : ''}Дата: ${createdAt.toLocaleString('ru-RU')} | Статус: ${invoice.status}</div>
            <table>
              <thead>
                <tr><th class="num">№</th><th>Товар</th><th class="right">Кол-во</th><th class="right">${moneyLabel('Цена')}</th><th class="right">${moneyLabel('Сумма')}</th></tr>
              </thead>
              <tbody>
                ${displayItems.map((item: any, index: number) => `<tr>
                  <td class="num">${index + 1}</td>
                  <td>${getProductDisplayLabel(item.productId, item.productName)}</td>
                  <td class="right">${formatQuantityLabel(item)}</td>
                  <td class="right">${Number(item.unitPrice || 0).toFixed(2)}</td>
                  <td class="right">${Number(item.totalPrice || 0).toFixed(2)}</td>
                </tr>`).join('')}
              </tbody>
            </table>
            <div class="total">${moneyLabel('Итого')}: ${Number(invoice.totalAmount || 0).toFixed(2)} ${currencyCode}</div>
          </div>
        </body>
      </html>
    `;

    const printWindow = window.open('', '_blank', 'width=980,height=800');
    if (!printWindow) {
      setActionError('Разрешите открытие всплывающих окон для печати накладной');
      return;
    }

    printWindow.document.open();
    printWindow.document.write(receiptHtml);
    printWindow.document.close();
    printWindow.focus();
  };

  const deleteInvoice = async (invoice: any) => {
    try {
      setBusyId(invoice.id);
      setActionError(null);
      const res = await fetch(`/api/invoices/${invoice.id}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || t('Failed to delete invoice'));
      setDeleteInvoiceTarget(null);
      await runRefreshTasks(refreshInvoices, refreshProducts);
    } catch (e: any) {
      setActionError(e.message || t('Failed to delete invoice'));
    } finally {
      setBusyId(null);
    }
  };

  const addInvoicePayment = useCallback((invoice: any) => {
    const paymentStatus = String(invoice.paymentStatus || 'UNPAID');
    if (!['UNPAID', 'PARTIALLY_PAID', 'OVERDUE'].includes(paymentStatus)) {
      return;
    }

    const outstanding = getInvoiceOutstandingAmount(invoice);

    setPaymentModal({
      open: true,
      invoice,
      amount: outstanding > 0 ? outstanding.toFixed(2) : '',
      method: 'CASH',
      comment: '',
      error: null,
    });
  }, [getInvoiceOutstandingAmount]);

  useEffect(() => {
    if (!paymentModal.open) return;

    const focusTimer = window.setTimeout(() => {
      paymentAmountInputRef.current?.focus();
      paymentAmountInputRef.current?.select();
    }, 0);

    return () => window.clearTimeout(focusTimer);
  }, [paymentModal.open]);

  useEffect(() => {
    if (!initialPaymentInvoiceId) return;

    const targetInvoice = invoices.find((invoice) => invoice.id === initialPaymentInvoiceId);
    if (!targetInvoice) return;

    addInvoicePayment(targetInvoice);
    onInitialPaymentInvoiceHandled?.();
  }, [addInvoicePayment, initialPaymentInvoiceId, invoices, onInitialPaymentInvoiceHandled]);

  useEffect(() => {
    if (!initialDetailsInvoiceId) return;

    const targetInvoice = invoices.find((invoice) => invoice.id === initialDetailsInvoiceId);
    if (!targetInvoice) return;

    setDetailsInvoice(targetInvoice);
    onInitialDetailsInvoiceHandled?.();
  }, [initialDetailsInvoiceId, invoices, onInitialDetailsInvoiceHandled]);

  const submitInvoicePayment = async () => {
    const invoice = paymentModal.invoice;
    if (!invoice) return;

    const outstanding = getInvoiceOutstandingAmount(invoice);
    const amount = Number(paymentModal.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setPaymentModal((prev) => ({ ...prev, error: 'Введите корректную сумму оплаты' }));
      return;
    }
    if (Math.abs(amount - outstanding) > 0.009) {
      setPaymentModal((prev) => ({
        ...prev,
        error: `Для продаж в долг нужно погасить весь остаток: ${outstanding.toFixed(2)} ${currencyCode}`,
      }));
      return;
    }

    try {
      setBusyId(invoice.id);
      setActionError(null);
      const res = await fetch(`/api/invoices/${invoice.id}/payments`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ amount, method: paymentModal.method, comment: paymentModal.comment || undefined }),
      });
      const rawResponse = await res.text();
      let data: any = {};
      if (rawResponse) {
        try {
          data = JSON.parse(rawResponse);
        } catch {
          data = { error: rawResponse };
        }
      }
      if (!res.ok) throw new Error(data.error || data.message || t('Failed to add payment'));
      resetPaymentModal();
      await refreshInvoices();
    } catch (e: any) {
      setPaymentModal((prev) => ({ ...prev, error: e.message || t('Failed to add payment') }));
    } finally {
      setBusyId(null);
    }
  };

  const fillPaymentAmount = useCallback(() => {
    const outstanding = getInvoiceOutstandingAmount(paymentModal.invoice);
    setPaymentModal((prev) => ({
      ...prev,
      amount: Math.max(0, outstanding).toFixed(2),
      error: null,
    }));
  }, [getInvoiceOutstandingAmount, paymentModal.invoice]);

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="rounded-[30px] border border-white/70 bg-white/80 p-4 shadow-[0_18px_45px_rgba(90,90,64,0.08)] backdrop-blur-md md:p-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center rounded-full bg-[#f1eee3] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-[#5A5A40]/55">
              {isDebtorsView ? 'Контроль задолженности' : 'История чеков'}
            </span>
            <span className="inline-flex items-center rounded-full bg-white px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-[#5A5A40]/45 border border-[#5A5A40]/10">
              {isDebtorsView ? 'Платежи и погашение' : 'Фильтры и экспорт'}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-3">
          {!isDebtorsView && (
            <>
              <div className="flex items-center gap-2 rounded-2xl border border-[#5A5A40]/10 bg-white px-3 py-2 shadow-sm">
                <button
                  onClick={() => setDateFilterMode('all')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors ${dateFilterMode === 'all' ? 'bg-[#5A5A40] text-white' : 'text-[#5A5A40]/65 hover:bg-[#f5f5f0]'}`}
                >
                  Все дни
                </button>
                <button
                  onClick={() => {
                    setDateFilterMode('today');
                    setDateFrom(todayIso);
                    setDateTo(todayIso);
                  }}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors ${dateFilterMode === 'today' ? 'bg-[#5A5A40] text-white' : 'text-[#5A5A40]/65 hover:bg-[#f5f5f0]'}`}
                >
                  Сегодня
                </button>
                <button
                  onClick={() => setDateFilterMode('custom')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors ${dateFilterMode === 'custom' ? 'bg-[#5A5A40] text-white' : 'text-[#5A5A40]/65 hover:bg-[#f5f5f0]'}`}
                >
                  Период
                </button>
              </div>
              {dateFilterMode === 'custom' && (
                <div className="flex items-center gap-2 rounded-2xl border border-[#5A5A40]/10 bg-white px-3 py-2 shadow-sm">
                  <input
                    type="date"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                    className="rounded-xl border border-[#5A5A40]/10 px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-[#5A5A40]/20"
                  />
                  <span className="text-xs text-[#5A5A40]/50">—</span>
                  <input
                    type="date"
                    value={dateTo}
                    min={dateFrom}
                    onChange={(e) => setDateTo(e.target.value)}
                    className="rounded-xl border border-[#5A5A40]/10 px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-[#5A5A40]/20"
                  />
                </div>
              )}
            </>
          )}
          <button
            onClick={exportInvoicesReport}
            className="bg-white text-[#5A5A40] px-6 py-3 rounded-2xl font-medium border border-[#5A5A40]/10 shadow-sm hover:bg-[#f5f5f0] transition-all flex items-center gap-2"
          >
            <Download size={20} />
            {t('Export Report')}
          </button>
        </div>
        </div>

        <div className="mt-4 flex flex-col gap-3 border-t border-[#5A5A40]/8 pt-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="relative group w-full xl:max-w-85">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-[#5A5A40]/30 group-focus-within:text-[#5A5A40] transition-colors" size={18} />
            <input 
              type="text" 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder={isDebtorsView ? 'Поиск по номеру или покупателю' : 'Поиск по номеру чека'} 
              className="w-full min-w-0 pl-12 pr-4 py-3 bg-white border border-[#5A5A40]/10 rounded-2xl text-sm outline-none focus:ring-2 focus:ring-[#5A5A40]/20 transition-all shadow-sm"
            />
          </div>

          <div className="flex items-center gap-2 overflow-x-auto custom-scrollbar">
            <span className="text-xs font-semibold text-[#5A5A40]/50 whitespace-nowrap"></span>
            {[
              { key: 'date', label: 'По дате' },
              { key: 'amount', label: 'По сумме' },
              { key: 'id', label: 'По номеру' },
            ].map((option) => (
              <button
                key={option.key}
                onClick={() => {
                  if (sortBy === option.key) {
                    setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
                  } else {
                    setSortBy(option.key as any);
                    setSortOrder('desc');
                  }
                }}
                className={`px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-all border ${
                  sortBy === option.key
                    ? `bg-[#5A5A40] text-white border-[#5A5A40] ${sortOrder === 'desc' ? '' : 'opacity-70'}`
                    : 'bg-white text-[#5A5A40]/60 border-[#5A5A40]/10 hover:bg-[#f5f5f0]'
                }`}
              >
                {option.label} {sortBy === option.key && (sortOrder === 'asc' ? '↑' : '↓')}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {[
          ...(isDebtorsView
            ? [
                { label: moneyLabel('Общий долг'), value: `${invoicesSummary.totalOutstanding.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currencyCode}`, icon: DollarSign, color: 'text-rose-600', bg: 'bg-rose-50' },
                { label: 'Количество должников', value: invoicesSummary.totalCount.toString(), icon: FileText, color: 'text-blue-600', bg: 'bg-blue-50' },
                { label: 'Просроченные', value: invoicesSummary.overdueCount.toString(), icon: Clock, color: 'text-amber-600', bg: 'bg-amber-50' },
              ]
            : [
                { label: moneyLabel(t('Total Revenue')), value: `${invoicesSummary.totalRevenue.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currencyCode}`, icon: DollarSign, color: 'text-emerald-600', bg: 'bg-emerald-50' },
                { label: t('Total Invoices'), value: invoicesSummary.totalCount.toString(), icon: FileText, color: 'text-blue-600', bg: 'bg-blue-50' },
                { label: moneyLabel(t('Avg. Order Value')), value: `${invoicesSummary.averageOrder.toFixed(2)} ${currencyCode}`, icon: TrendingUp, color: 'text-purple-600', bg: 'bg-purple-50' },
              ])
        ].map((stat, i) => (
          <div key={i} className="bg-white p-6 rounded-3xl shadow-sm border border-[#5A5A40]/5 flex items-center gap-4 hover:-translate-y-0.5 hover:shadow-md transition-all">
            <div className={`w-12 h-12 rounded-2xl ${stat.bg} ${stat.color} flex items-center justify-center`}>
              <stat.icon size={24} />
            </div>
            <div>
              <p className="text-xs font-bold text-[#5A5A40]/40 uppercase tracking-widest">{stat.label}</p>
              <p className="text-2xl font-bold text-[#5A5A40] mt-0.5">{stat.value}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-3xl shadow-sm border border-[#5A5A40]/5 overflow-hidden">
        {actionError && (
          <div className="mx-6 mt-6 p-3 bg-red-50 text-red-600 text-xs rounded-xl border border-red-100 flex items-center gap-2">
            <AlertCircle size={14} />
            {actionError}
          </div>
        )}
        <div className="overflow-x-auto overflow-y-auto" style={{ maxHeight: INVOICE_VIEWPORT_HEIGHT }} onScroll={onInvoicesScroll}>
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-[#f5f5f0]/50 text-[9px] uppercase tracking-[0.2em] text-[#5A5A40]/45 font-bold">
                <th className="px-4 py-3.5 text-center">№</th>
                <th className="px-6 py-3.5">{isDebtorsView ? 'Должник' : 'Номер чека'}</th>
                <th className="px-6 py-3.5">{isDebtorsView ? 'Последняя активность' : t('Date & Time')}</th>
                <th className="px-6 py-3.5">{isDebtorsView ? 'Состояние долга' : t('Payment')}</th>
                <th className="px-4 py-3.5 text-right">{isDebtorsView ? 'Накладных' : 'Количество'}</th>
                <th className="px-4 py-3.5 text-right">{moneyLabel('Сумма')}</th>
                <th className="px-4 py-3.5 text-right">{moneyLabel('Оплачено')}</th>
                <th className="px-4 py-3.5 text-right">{moneyLabel('Остаток')}</th>
                <th className="px-6 py-3.5 text-right">{t('Actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#5A5A40]/5">
              {isInitialInvoicesLoading && (
                <tr>
                  <td colSpan={9} className="px-6 py-8">
                    <div className="space-y-3">
                      {Array.from({ length: 6 }).map((_, index) => (
                        <div key={index} className="grid grid-cols-5 gap-3 rounded-2xl bg-[#f8f6ef] px-4 py-4 animate-pulse md:grid-cols-8">
                          <div className="h-4 rounded-full bg-[#e6e0cf]" />
                          <div className="h-4 rounded-full bg-[#e6e0cf] md:col-span-2" />
                          <div className="h-4 rounded-full bg-[#e6e0cf]" />
                          <div className="h-4 rounded-full bg-[#e6e0cf]" />
                          <div className="h-4 rounded-full bg-[#e6e0cf]" />
                        </div>
                      ))}
                    </div>
                  </td>
                </tr>
              )}
              {!isDebtorsView && invoiceTopSpacerHeight > 0 && (
                <tr>
                  <td colSpan={9} style={{ height: invoiceTopSpacerHeight }} />
                </tr>
              )}
              {!isInitialInvoicesLoading && isDebtorsView && debtorGroups.map((debtor, index) => {
                const rowNumber = index + 1;
                const debtorIsOverdue = debtor.overdueCount > 0;
                const statusBadge = debtorIsOverdue
                  ? { label: 'Просрочен', className: 'bg-rose-50 text-rose-700 border-rose-200' }
                  : debtor.totalPaid > 0
                    ? { label: 'Частично оплачено', className: 'bg-amber-50 text-amber-700 border-amber-200' }
                    : { label: 'Долг', className: 'bg-rose-50 text-rose-700 border-rose-200' };

                return (
                  <tr key={debtor.key} className="hover:bg-[#f5f5f0]/30 transition-colors group align-top">
                    <td className="px-4 py-3.5 text-center">
                      <span className="inline-flex min-w-7 h-7 items-center justify-center rounded-lg bg-[#f5f5f0] text-[#5A5A40] text-[12px] font-bold">
                        {rowNumber}
                      </span>
                    </td>
                    <td className="px-6 py-3.5">
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 bg-[#f5f5f0] rounded-lg flex items-center justify-center text-[#5A5A40] group-hover:bg-[#5A5A40] group-hover:text-white transition-colors">
                          <UserIcon size={14} />
                        </div>
                        <div>
                          <span className="font-semibold text-[#5A5A40] text-[13px] leading-none">{debtor.customer}</span>
                          <p className="text-[10px] text-[#5A5A40]/45 mt-1">{debtor.invoiceCount} накладных • {debtor.totalUnits} ед.</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-3.5">
                      <div className="space-y-1 text-[12px] text-[#5A5A40]/60 leading-none">
                        <div className="flex items-center gap-1.5">
                          <Calendar size={12} />
                          <span>{debtor.latestActivityAt ? debtor.latestActivityAt.toLocaleDateString('ru-RU') : '—'}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Clock size={12} />
                          <span>{debtor.latestActivityAt ? debtor.latestActivityAt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '—'}</span>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-3.5">
                      <span className={`inline-flex items-center justify-center gap-1 px-2.5 py-0.5 rounded-full text-[9px] font-bold border ${statusBadge.className}`}>
                        <span className="inline-block w-1.5 h-1.5 rounded-full bg-current opacity-70"></span>
                        {statusBadge.label}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-right">
                      <p className="text-[13px] font-semibold text-[#5A5A40] leading-none">{debtor.invoiceCount}</p>
                    </td>
                    <td className="px-4 py-3.5 text-right">
                      <p className="text-[13px] font-bold text-[#5A5A40] leading-none">{debtor.totalAmount.toFixed(2)}</p>
                    </td>
                    <td className="px-4 py-3.5 text-right">
                      <p className="text-[13px] font-semibold text-emerald-700 leading-none">{debtor.totalPaid.toFixed(2)}</p>
                    </td>
                    <td className="px-4 py-3.5 text-right">
                      <p className={`text-[13px] font-semibold leading-none ${debtor.totalOutstanding > 0 ? 'text-rose-700' : 'text-[#5A5A40]/60'}`}>{debtor.totalOutstanding.toFixed(2)}</p>
                    </td>
                    <td className="px-6 py-3.5 text-right">
                      <div className="ml-auto grid grid-cols-1 gap-1.5 w-fit justify-items-center">
                        <button
                          onClick={() => setDetailsDebtor(debtor)}
                          className="flex h-8 w-8 items-center justify-center text-[#5A5A40]/30 hover:text-[#5A5A40] hover:bg-[#f5f5f0] rounded-md transition-all"
                          title="Сверка: детали и суммы"
                        >
                          <ChevronRight size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!isInitialInvoicesLoading && !isDebtorsView && visibleInvoices.map((invoice, index) => {
                const rowNumber = invoiceStartIndex + index + 1;
                const totalAmount = Number(invoice.totalAmount || 0);
                const returnedAmount = Number((invoice as any).returnedAmountTotal || 0);
                const netAmount = totalAmount - returnedAmount;
                const taxAmount = Number((invoice as any).taxAmount || 0);
                const paidAmount = Number((invoice as any).paidAmountTotal ?? Math.max(0, netAmount - Number((invoice as any).outstandingAmount ?? invoice.receivables?.[0]?.remainingAmount ?? netAmount)));
                const outstandingAmount = Number((invoice as any).outstandingAmount ?? invoice.receivables?.[0]?.remainingAmount ?? Math.max(0, netAmount - paidAmount));
                const paymentState = String(invoice.paymentStatus || 'UNPAID');
                const shouldShowDebt = ['UNPAID', 'PARTIALLY_PAID', 'OVERDUE'].includes(paymentState) && outstandingAmount > 0;
                const invoiceIsOverdue = isOverdueInvoice(invoice);
                const paymentBadge = invoiceIsOverdue
                  ? { label: 'Просрочен', className: 'bg-rose-50 text-rose-700 border-rose-200' }
                  : paymentState === 'PAID'
                  ? { label: 'Оплачено', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' }
                  : paymentState === 'PARTIALLY_PAID'
                    ? { label: 'Частично оплачено', className: 'bg-amber-50 text-amber-700 border-amber-200' }
                    : { label: 'Долг', className: 'bg-rose-50 text-rose-700 border-rose-200' };
                const paymentMethodBadge = invoice.paymentType === 'CASH'
                  ? { label: 'Наличные', className: 'bg-blue-50 text-blue-700 border-blue-200' }
                  : invoice.paymentType === 'CARD'
                    ? { label: 'Карта', className: 'bg-violet-50 text-violet-700 border-violet-200' }
                    : { label: 'В долг', className: 'bg-stone-50 text-stone-700 border-stone-200' };

                return (
                <tr key={invoice.id} className="hover:bg-[#f5f5f0]/30 transition-colors group align-top">
                  <td className="px-4 py-3.5 text-center">
                    <span className="inline-flex min-w-7 h-7 items-center justify-center rounded-lg bg-[#f5f5f0] text-[#5A5A40] text-[12px] font-bold">
                      {rowNumber}
                    </span>
                  </td>
                  <td className="px-6 py-3.5">
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 bg-[#f5f5f0] rounded-lg flex items-center justify-center text-[#5A5A40] group-hover:bg-[#5A5A40] group-hover:text-white transition-colors">
                        <FileText size={14} />
                      </div>
                      <span className="font-mono font-bold text-[#5A5A40] text-[13px] leading-none">{invoice.invoiceNo || invoice.id}</span>
                    </div>
                  </td>
                  <td className="px-6 py-3.5">
                    <div className="space-y-1 text-[12px] text-[#5A5A40]/60 leading-none">
                      <div className="flex items-center gap-1.5">
                        <Calendar size={12} />
                        <span>{new Date(invoice.createdAt).toLocaleDateString()}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Clock size={12} />
                        <span>{new Date(invoice.createdAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-3.5">
                    <div className="inline-flex flex-col gap-1.5">
                      {!isDebtorsView && (
                        <span className={`inline-flex items-center justify-center gap-1 px-2.5 py-0.5 rounded-full text-[9px] font-semibold border ${paymentMethodBadge.className}`}>
                          {paymentMethodBadge.label}
                        </span>
                      )}
                      <span className={`inline-flex items-center justify-center gap-1 px-2.5 py-0.5 rounded-full text-[9px] font-bold border ${paymentBadge.className}`}>
                        <span className="inline-block w-1.5 h-1.5 rounded-full bg-current opacity-70"></span>
                        {paymentBadge.label}
                      </span>
                    </div>
                    {!isDebtorsView && shouldShowDebt && (
                      <p className="text-[9px] font-semibold text-rose-700 leading-none mt-1.5 bg-rose-50 border border-rose-100 rounded-full px-2 py-1 inline-flex items-center">
                        Остаток: {outstandingAmount.toFixed(2)} {currencyCode}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3.5 text-right">
                    <p className="text-[12px] font-semibold text-[#5A5A40] leading-none">{formatInvoiceQuantitySummary(invoice.items || [])}</p>
                    <p className="text-[9px] text-[#5A5A40]/40 mt-1">{invoice.items.length} поз.</p>
                  </td>
                  <td className="px-4 py-3.5 text-right">
                    <p className="text-[13px] font-bold text-[#5A5A40] leading-none">{netAmount.toFixed(2)}</p>
                    {returnedAmount > 0 && (
                      <p className="text-[9px] text-red-600 mt-1">Возврат {returnedAmount.toFixed(2)}</p>
                    )}
                    {taxAmount > 0 && <p className="text-[9px] text-[#5A5A40]/45 mt-1">Налог {taxAmount.toFixed(2)}</p>}
                  </td>
                  <td className="px-4 py-3.5 text-right">
                    <p className="text-[13px] font-semibold text-emerald-700 leading-none">{paidAmount.toFixed(2)}</p>
                  </td>
                  <td className="px-4 py-3.5 text-right">
                    <p className={`text-[13px] font-semibold leading-none ${outstandingAmount > 0 ? 'text-rose-700' : 'text-[#5A5A40]/60'}`}>{outstandingAmount.toFixed(2)}</p>
                  </td>
                  <td className="px-6 py-3.5 text-right">
                    <div className="ml-auto grid grid-cols-3 gap-1.5 w-fit justify-items-center">
                      <button
                        onClick={() => setDetailsInvoice(invoice)}
                        className="flex h-8 w-8 items-center justify-center text-[#5A5A40]/30 hover:text-[#5A5A40] hover:bg-[#f5f5f0] rounded-md transition-all"
                        title="Сверка: детали и суммы"
                      >
                        <ChevronRight size={14} />
                      </button>
                      <button
                        onClick={() => printInvoice(invoice)}
                        className="flex h-8 w-8 items-center justify-center text-[#5A5A40]/30 hover:text-[#5A5A40] hover:bg-[#f5f5f0] rounded-md transition-all"
                        title={t('Print invoice')}
                      >
                        <Printer size={14} />
                      </button>
                      {['UNPAID', 'PARTIALLY_PAID', 'OVERDUE'].includes(paymentState) && (
                        <button
                          onClick={() => addInvoicePayment(invoice)}
                            disabled={busyId === invoice.id || isReturnLocked(invoice.status)}
                          className="flex h-8 w-8 items-center justify-center text-[#5A5A40]/30 hover:text-emerald-700 hover:bg-emerald-50 rounded-md transition-all disabled:opacity-40"
                          title={t('Add payment')}
                        >
                          <DollarSign size={14} />
                        </button>
                      )}
                      <button
                        onClick={() => editInvoice(invoice)}
                        disabled={busyId === invoice.id || isEditLocked(invoice.status)}
                        className="flex h-8 w-8 items-center justify-center text-[#5A5A40]/30 hover:text-[#5A5A40] hover:bg-[#f5f5f0] rounded-md transition-all disabled:opacity-40"
                        title={t('Edit invoice')}
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        onClick={() => openReturnModal(invoice)}
                        disabled={busyId === invoice.id || isReturnLocked(invoice.status)}
                        className="flex h-8 w-8 items-center justify-center text-[#5A5A40]/30 hover:text-amber-700 hover:bg-amber-50 rounded-md transition-all disabled:opacity-40"
                        title={t('Create return')}
                      >
                        <RotateCcw size={14} />
                      </button>
                      <button
                        onClick={() => setDeleteInvoiceTarget(invoice)}
                        disabled={busyId === invoice.id || isEditLocked(invoice.status)}
                        className="flex h-8 w-8 items-center justify-center text-[#5A5A40]/30 hover:text-red-700 hover:bg-red-50 rounded-md transition-all disabled:opacity-40"
                        title={t('Delete invoice')}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
                );
              })}
              {invoiceBottomSpacerHeight > 0 && (
                <tr>
                  <td colSpan={9} style={{ height: invoiceBottomSpacerHeight }} />
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {detailsDebtor && (
        <div className="fixed inset-0 z-100 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-5xl bg-white rounded-3xl shadow-2xl border border-[#5A5A40]/10 overflow-hidden">
            <div className="px-6 py-4 bg-[#5A5A40] text-white flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold">Сверка: детали и суммы</h3>
                <p className="text-xs text-white/70 mt-1">{detailsDebtor.customer}</p>
              </div>
              <button
                onClick={() => setDetailsDebtor(null)}
                className="p-1.5 rounded-lg hover:bg-white/10 transition-colors"
              >
                <X size={18} />
              </button>
            </div>
            <div className="p-6 space-y-4 max-h-[75vh] overflow-auto">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-sm">
                <div className="rounded-2xl bg-[#f5f5f0]/60 px-4 py-3">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-[#5A5A40]/45 mb-1">Накладных</p>
                  <p className="font-semibold text-[#5A5A40]">{detailsDebtor.invoiceCount}</p>
                </div>
                <div className="rounded-2xl bg-[#f5f5f0]/60 px-4 py-3">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-[#5A5A40]/45 mb-1">Сумма</p>
                  <p className="font-semibold text-[#5A5A40]">{detailsDebtor.totalAmount.toFixed(2)} {currencyCode}</p>
                </div>
                <div className="rounded-2xl bg-[#f5f5f0]/60 px-4 py-3">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-[#5A5A40]/45 mb-1">Оплачено</p>
                  <p className="font-semibold text-emerald-700">{detailsDebtor.totalPaid.toFixed(2)} {currencyCode}</p>
                </div>
                <div className="rounded-2xl bg-[#f5f5f0]/60 px-4 py-3">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-[#5A5A40]/45 mb-1">Остаток</p>
                  <p className="font-semibold text-rose-700">{detailsDebtor.totalOutstanding.toFixed(2)} {currencyCode}</p>
                </div>
              </div>

              <div className="rounded-2xl border border-[#5A5A40]/10 overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-[#f5f5f0]/60 text-[#5A5A40]/70 text-xs uppercase">
                    <tr>
                      <th className="px-3 py-2 text-left">Накладная</th>
                      <th className="px-3 py-2 text-left">Дата</th>
                      <th className="px-3 py-2 text-left">Статус</th>
                      <th className="px-3 py-2 text-right">Сумма</th>
                      <th className="px-3 py-2 text-right">Оплачено</th>
                      <th className="px-3 py-2 text-right">Остаток</th>
                      <th className="px-3 py-2 text-right">Действия</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...detailsDebtor.invoices]
                      .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
                      .map((invoice: any) => {
                        const paidAmount = Number((invoice as any).paidAmountTotal ?? 0);
                        const outstandingAmount = Number((invoice as any).outstandingAmount ?? getInvoiceOutstandingAmount(invoice));
                        const paymentState = String(invoice.paymentStatus || 'UNPAID');
                        return (
                          <tr key={invoice.id} className="border-t border-[#5A5A40]/10">
                            <td className="px-3 py-2 font-semibold text-[#5A5A40]">{invoice.invoiceNo || invoice.id}</td>
                            <td className="px-3 py-2">{new Date(invoice.createdAt).toLocaleString('ru-RU')}</td>
                            <td className="px-3 py-2">{paymentState}</td>
                            <td className="px-3 py-2 text-right">{Number(invoice.totalAmount || 0).toFixed(2)}</td>
                            <td className="px-3 py-2 text-right text-emerald-700">{paidAmount.toFixed(2)}</td>
                            <td className="px-3 py-2 text-right text-rose-700">{outstandingAmount.toFixed(2)}</td>
                            <td className="px-3 py-2 text-right">
                              <div className="inline-flex items-center gap-2">
                                <button
                                  onClick={() => setDetailsInvoice(invoice)}
                                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[#5A5A40]/35 hover:bg-[#f5f5f0] hover:text-[#5A5A40] transition-all"
                                  title="Открыть накладную"
                                >
                                  <FileText size={14} />
                                </button>
                                {outstandingAmount > 0 && ['UNPAID', 'PARTIALLY_PAID', 'OVERDUE'].includes(paymentState) && (
                                  <button
                                    onClick={() => addInvoicePayment(invoice)}
                                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[#5A5A40]/35 hover:bg-emerald-50 hover:text-emerald-700 transition-all"
                                    title="Погасить долг"
                                  >
                                    <DollarSign size={14} />
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {detailsInvoice && (
        <div className="fixed inset-0 z-100 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-3xl bg-white rounded-3xl shadow-2xl border border-[#5A5A40]/10 overflow-hidden">
            <div className="px-6 py-4 bg-[#5A5A40] text-white flex items-center justify-between">
              <h3 className="text-base font-bold">Детали накладной</h3>
              <button
                onClick={() => setDetailsInvoice(null)}
                className="p-1.5 rounded-lg hover:bg-white/10 transition-colors"
              >
                <X size={18} />
              </button>
            </div>
            <div className="p-6 space-y-4 max-h-[75vh] overflow-auto">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                <div>Накладная: <span className="font-semibold">{detailsInvoice.invoiceNo || detailsInvoice.id}</span></div>
                {isDebtorsView && <div>Покупатель: <span className="font-semibold">{detailsInvoice.customer || '-'}</span></div>}
                <div>Дата: <span className="font-semibold">{new Date(detailsInvoice.createdAt).toLocaleString('ru-RU')}</span></div>
                <div>{isDebtorsView ? 'Тип оплаты' : 'Оплата'}: <span className="font-semibold">{detailsInvoice.paymentType}</span></div>
                <div>Статус: <span className="font-semibold">{detailsInvoice.status}</span></div>
                <div>{isDebtorsView ? 'Состояние долга' : 'Статус оплаты'}: <span className="font-semibold">{detailsInvoice.paymentStatus || 'UNPAID'}</span></div>
              </div>

              <div className="rounded-2xl border border-[#5A5A40]/10 overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-[#f5f5f0]/60 text-[#5A5A40]/70 text-xs uppercase">
                    <tr>
                      <th className="px-3 py-2 text-left">№</th>
                      <th className="px-3 py-2 text-left">Товар</th>
                      <th className="px-3 py-2 text-right">Кол-во</th>
                      <th className="px-3 py-2 text-right">{moneyLabel('Цена')}</th>
                      <th className="px-3 py-2 text-right">{moneyLabel('Сумма')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {buildInvoiceDisplayItems(detailsInvoice.items || []).map((item: any, idx: number) => (
                      <tr key={item.id || idx} className="border-t border-[#5A5A40]/10">
                        <td className="px-3 py-2">{idx + 1}</td>
                        <td className="px-3 py-2">{getProductDisplayLabel(item.productId, item.productName)}</td>
                        <td className="px-3 py-2 text-right">{formatPackQuantity(Number(item.quantity || 0))}</td>
                        <td className="px-3 py-2 text-right">{Number(item.unitPrice || 0).toFixed(2)}</td>
                        <td className="px-3 py-2 text-right">{Number(item.totalPrice || 0).toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center justify-end text-lg font-bold text-[#5A5A40]">
                {moneyLabel('Итого')}: {Number(detailsInvoice.totalAmount || 0).toFixed(2)} {currencyCode}
              </div>
            </div>
          </div>
        </div>
      )}

      {editModal.open && (
        <div className="fixed inset-0 z-100 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white rounded-3xl shadow-2xl border border-[#5A5A40]/10 overflow-hidden">
            <div className="px-6 py-4 bg-[#5A5A40] text-white flex items-center justify-between">
              <h3 className="text-base font-bold">Редактировать накладную</h3>
              <button
                onClick={closeEditModal}
                className="p-1.5 rounded-lg hover:bg-white/10 transition-colors"
              >
                <X size={18} />
              </button>
            </div>
            <div className="p-6 space-y-4">
              {isDebtorsView && (
                <div>
                  <label className="block text-xs font-bold uppercase tracking-widest text-[#5A5A40]/60 mb-1">Покупатель</label>
                  <input
                    type="text"
                    value={editModal.customer}
                    onChange={(e) => setEditModal((prev) => ({ ...prev, customer: e.target.value, error: null }))}
                    className="w-full px-3 py-2 rounded-xl border border-[#5A5A40]/15 text-sm outline-none focus:ring-2 focus:ring-[#5A5A40]/20"
                  />
                </div>
              )}
              <div className="rounded-2xl border border-[#5A5A40]/10 overflow-hidden">
                <div className="px-4 py-3 bg-[#f5f5f0]/60 text-xs font-bold uppercase tracking-widest text-[#5A5A40]/50">
                  Позиции накладной
                </div>
                <div className="overflow-auto divide-y divide-[#5A5A40]/10" style={{ maxHeight: 320 }}>
                  {editModal.items.map((item) => {
                    return (
                      <div key={item.id} className="p-4 space-y-3">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-[#5A5A40]">{getProductDisplayLabel(item.productId, item.productName)}</p>
                            <p className="text-[11px] text-[#5A5A40]/55 mt-1">Продажа в единицах</p>
                          </div>
                          <p className="text-sm font-bold text-[#5A5A40]">{(item.quantity * item.unitPrice).toFixed(2)} {currencyCode}</p>
                        </div>

                        <div className="grid gap-3 grid-cols-1">
                          <label>
                            <span className="block text-[10px] font-bold uppercase tracking-widest text-[#5A5A40]/50 mb-1">Единицы</span>
                            <input
                              type="number"
                              min={1}
                              step={1}
                              value={item.quantity}
                              onChange={(e) => updateEditItemPackaging(item.id, '0', e.target.value)}
                              className="w-full px-3 py-2 rounded-xl border border-[#5A5A40]/15 text-sm outline-none focus:ring-2 focus:ring-[#5A5A40]/20"
                            />
                          </label>
                        </div>

                        <div>
                          <label className="block text-[10px] font-bold uppercase tracking-widest text-[#5A5A40]/50 mb-1">Цена за единицу</label>
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            value={item.unitPrice}
                            onChange={(e) => updateEditItem(item.id, { unitPrice: Math.max(0, Number(e.target.value) || 0) })}
                            className="w-full px-3 py-2 rounded-xl border border-[#5A5A40]/15 text-sm outline-none focus:ring-2 focus:ring-[#5A5A40]/20"
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div>
                <div className={`grid gap-3 text-sm ${Number(editModal.taxAmount || 0) > 0 ? 'grid-cols-3' : 'grid-cols-2'}`}>
                  <div className="rounded-2xl bg-[#f5f5f0]/60 px-4 py-3">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-[#5A5A40]/45 mb-1">{moneyLabel('Подытог')}</p>
                    <p className="font-semibold text-[#5A5A40]">{editModal.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0).toFixed(2)} {currencyCode}</p>
                  </div>
                  {Number(editModal.taxAmount || 0) > 0 && (
                    <div className="rounded-2xl bg-[#f5f5f0]/60 px-4 py-3">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-[#5A5A40]/45 mb-1">{moneyLabel('Налог')}</p>
                      <p className="font-semibold text-[#5A5A40]">{Number(editModal.taxAmount || 0).toFixed(2)} {currencyCode}</p>
                    </div>
                  )}
                  <div className="rounded-2xl bg-[#f5f5f0]/60 px-4 py-3">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-[#5A5A40]/45 mb-1">{moneyLabel('Итого')}</p>
                    <p className="font-semibold text-[#5A5A40]">{Number(editModal.totalAmount || 0).toFixed(2)} {currencyCode}</p>
                  </div>
                </div>
              </div>
              {editModal.error && (
                <div className="p-3 bg-red-50 text-red-600 text-xs rounded-xl border border-red-100 flex items-center gap-2">
                  <AlertCircle size={14} />
                  {editModal.error}
                </div>
              )}
              <div className="grid grid-cols-2 gap-3 pt-2">
                <button
                  onClick={closeEditModal}
                  className="py-2.5 rounded-xl border border-[#5A5A40]/15 text-sm font-semibold text-[#5A5A40] hover:bg-[#f5f5f0] transition-colors"
                >
                  Отмена
                </button>
                <button
                  onClick={submitEditInvoice}
                  disabled={busyId === editModal.invoiceId}
                  className="py-2.5 rounded-xl bg-[#5A5A40] text-white text-sm font-semibold hover:bg-[#4A4A30] disabled:opacity-50 transition-colors"
                >
                  {busyId === editModal.invoiceId ? 'Сохраняю...' : 'Сохранить'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {returnInvoiceTarget && (
        <div className="fixed inset-0 z-100 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-2xl bg-white rounded-3xl shadow-2xl border border-[#5A5A40]/10 overflow-hidden">
            <div className="px-6 py-4 bg-amber-600 text-white flex items-center justify-between">
              <h3 className="text-base font-bold">Возврат по накладной</h3>
              <button onClick={closeReturnModal} className="p-1.5 rounded-lg hover:bg-white/10 transition-colors"><X size={18} /></button>
            </div>
            <div className="p-6 space-y-5">
              <p className="text-sm text-[#5A5A40]/80">Укажите, сколько вернуть по накладной <span className="font-semibold">{returnInvoiceTarget.invoice.invoiceNo || returnInvoiceTarget.invoice.id}</span>.</p>
              <div className="space-y-3 max-h-96 overflow-auto">
                {returnInvoiceTarget.items.map((item) => {
                  return (
                    <div key={item.id} className="rounded-2xl border border-[#5A5A40]/10 p-4 space-y-3 bg-[#f5f5f0]/35">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-[#5A5A40]">{getProductDisplayLabel(item.productId, item.productName)}</p>
                          <p className="text-[11px] text-[#5A5A40]/55 mt-1">Партия: {item.batchNo} • Продано: {formatPackQuantity(item.soldQuantity)}</p>
                        </div>
                        <p className="text-[11px] font-semibold text-[#5A5A40]/60">Макс: {formatPackQuantity(item.soldQuantity)}</p>
                      </div>
                      <div className="grid gap-3 grid-cols-1">
                        <label>
                          <span className="block text-[10px] font-bold uppercase tracking-widest text-[#5A5A40]/50 mb-1">Единицы</span>
                          <input
                            type="number"
                            min={0}
                            step={1}
                            value={item.quantity}
                            onChange={(e) => updateReturnItemPackaging(item.id, '0', e.target.value)}
                            className="w-full px-3 py-2 rounded-xl border border-[#5A5A40]/15 text-sm outline-none focus:ring-2 focus:ring-[#5A5A40]/20"
                          />
                        </label>
                      </div>
                    </div>
                  );
                })}
              </div>
              {returnInvoiceTarget.error && (
                <div className="p-3 bg-red-50 text-red-600 text-xs rounded-xl border border-red-100 flex items-center gap-2">
                  <AlertCircle size={14} />
                  {returnInvoiceTarget.error}
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <button onClick={closeReturnModal} className="py-2.5 rounded-xl border border-[#5A5A40]/15 text-sm font-semibold text-[#5A5A40] hover:bg-[#f5f5f0] transition-colors">Отмена</button>
                <button onClick={() => returnInvoice(returnInvoiceTarget.invoice)} disabled={busyId === returnInvoiceTarget.invoice.id} className="py-2.5 rounded-xl bg-amber-600 text-white text-sm font-semibold hover:bg-amber-700 disabled:opacity-50 transition-colors">{busyId === returnInvoiceTarget.invoice.id ? 'Выполняю...' : 'Подтвердить'}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {deleteInvoiceTarget && (
        <div className="fixed inset-0 z-100 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white rounded-3xl shadow-2xl border border-[#5A5A40]/10 overflow-hidden">
            <div className="px-6 py-4 bg-red-600 text-white flex items-center justify-between">
              <h3 className="text-base font-bold">Удаление накладной</h3>
              <button onClick={() => setDeleteInvoiceTarget(null)} className="p-1.5 rounded-lg hover:bg-white/10 transition-colors"><X size={18} /></button>
            </div>
            <div className="p-6 space-y-5">
              <p className="text-sm text-[#5A5A40]/80">Удалить накладную <span className="font-semibold">{deleteInvoiceTarget.invoiceNo || deleteInvoiceTarget.id}</span>? Остатки и связанные долги/платежи будут откатаны.</p>
              <div className="grid grid-cols-2 gap-3">
                <button onClick={() => setDeleteInvoiceTarget(null)} className="py-2.5 rounded-xl border border-[#5A5A40]/15 text-sm font-semibold text-[#5A5A40] hover:bg-[#f5f5f0] transition-colors">Отмена</button>
                <button onClick={() => deleteInvoice(deleteInvoiceTarget)} disabled={busyId === deleteInvoiceTarget.id} className="py-2.5 rounded-xl bg-red-600 text-white text-sm font-semibold hover:bg-red-700 disabled:opacity-50 transition-colors">{busyId === deleteInvoiceTarget.id ? 'Удаляю...' : 'Удалить'}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {paymentModal.open && (
        <div className="fixed inset-0 z-100 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white rounded-3xl shadow-2xl border border-[#5A5A40]/10 overflow-hidden">
            <div className="px-6 py-4 bg-[#5A5A40] text-white flex items-center justify-between">
              <h3 className="text-base font-bold">Внесение оплаты</h3>
              <button
                onClick={resetPaymentModal}
                className="p-1.5 rounded-lg hover:bg-white/10 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="text-sm text-[#5A5A40]/70">
                Накладная: <span className="font-semibold text-[#5A5A40]">{paymentModal.invoice?.invoiceNo || paymentModal.invoice?.id}</span>
              </div>
              <div className="text-sm text-[#5A5A40]/70">
                Покупатель: <span className="font-semibold text-[#5A5A40]">{paymentModal.invoice?.customer || '-'}</span>
              </div>
              <div className="text-sm text-[#5A5A40]/70">
                {moneyLabel('Остаток долга')}: <span className="font-semibold text-rose-700">{getInvoiceOutstandingAmount(paymentModal.invoice).toFixed(2)} {currencyCode}</span>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-widest text-[#5A5A40]/60 mb-1">Полное погашение долга</label>
                <div className="flex items-center gap-2">
                  <input
                    ref={paymentAmountInputRef}
                    type="number"
                    min={0}
                    step="0.01"
                    value={paymentModal.amount}
                    readOnly
                    className="w-full px-3 py-2 rounded-xl border border-[#5A5A40]/15 text-sm outline-none focus:ring-2 focus:ring-[#5A5A40]/20"
                    placeholder="Сумма полного погашения"
                  />
                  <button
                    type="button"
                    onClick={fillPaymentAmount}
                    className="shrink-0 px-3 py-2 rounded-xl border border-[#5A5A40]/15 text-xs font-semibold text-[#5A5A40] hover:bg-[#f5f5f0] transition-colors"
                  >
                    Обновить
                  </button>
                </div>
                <p className="mt-2 text-xs text-[#5A5A40]/55">Для продаж в долг из истории продаж доступно только полное погашение остатка.</p>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-widest text-[#5A5A40]/60 mb-1">Способ оплаты</label>
                <select
                  value={paymentModal.method}
                  onChange={(e) => setPaymentModal((prev) => ({ ...prev, method: e.target.value as 'CASH' | 'CARD' | 'BANK_TRANSFER' }))}
                  className="w-full px-3 py-2 rounded-xl border border-[#5A5A40]/15 text-sm outline-none focus:ring-2 focus:ring-[#5A5A40]/20"
                >
                  <option value="CASH">Наличные (CASH)</option>
                  <option value="CARD">Карта (CARD)</option>
                  <option value="BANK_TRANSFER">Перевод (BANK_TRANSFER)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-widest text-[#5A5A40]/60 mb-1">Комментарий (необязательно)</label>
                <input
                  type="text"
                  value={paymentModal.comment}
                  onChange={(e) => setPaymentModal((prev) => ({ ...prev, comment: e.target.value }))}
                  className="w-full px-3 py-2 rounded-xl border border-[#5A5A40]/15 text-sm outline-none focus:ring-2 focus:ring-[#5A5A40]/20"
                  placeholder="Например: доплата по договору"
                />
              </div>

              {paymentModal.error && (
                <div className="p-3 bg-red-50 text-red-600 text-xs rounded-xl border border-red-100 flex items-center gap-2">
                  <AlertCircle size={14} />
                  {paymentModal.error}
                </div>
              )}

              <div className="pt-2 grid grid-cols-2 gap-3">
                <button
                  onClick={resetPaymentModal}
                  className="py-2.5 rounded-xl border border-[#5A5A40]/15 text-sm font-semibold text-[#5A5A40] hover:bg-[#f5f5f0] transition-colors"
                >
                  Отмена
                </button>
                <button
                  onClick={submitInvoicePayment}
                  disabled={busyId === paymentModal.invoice?.id}
                  className="py-2.5 rounded-xl bg-[#5A5A40] text-white text-sm font-semibold hover:bg-[#4A4A30] disabled:opacity-50 transition-colors"
                >
                  {busyId === paymentModal.invoice?.id ? 'Сохраняю...' : 'Подтвердить оплату'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const TrendingUp: React.FC<{ size?: number, className?: string }> = ({ size = 24, className = "" }) => (
  <svg 
    width={size} 
    height={size} 
    viewBox="0 0 24 24" 
    fill="none" 
    stroke="currentColor" 
    strokeWidth="2" 
    strokeLinecap="round" 
    strokeLinejoin="round" 
    className={className}
  >
    <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"></polyline>
    <polyline points="17 6 23 6 23 12"></polyline>
  </svg>
);
