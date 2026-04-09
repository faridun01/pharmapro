import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Calendar, FileDown, FileSpreadsheet, AlertCircle, Eye } from 'lucide-react';
import { buildApiHeaders } from '../../infrastructure/api';
import { loadPdfDependencies, loadXlsx } from '../../lib/lazyLoaders';
import { defaultCompanyReportProfile, type CompanyReportProfile } from '../../lib/reportPreferences';
import { useCurrencyCode } from '../../lib/useCurrencyCode';

type ReportRangePreset = 'month' | 'q1' | 'q2' | 'q3' | 'q4' | 'year' | 'all';
type ReportViewMode = 'summary' | 'detailed';

type AgingBuckets = {
  current: number;
  bucket1_30: number;
  bucket31_60: number;
  bucket61_90: number;
  bucket90Plus: number;
  undated: number;
  total: number;
};

type FinanceReport = {
  range: { preset: ReportRangePreset; from: string; to: string };
  kpi: {
    revenueGross: number;
    customerReturnsAmount: number;
    netRevenue: number;
    cogs: number;
    grossProfit: number;
    grossMarginPct: number;
    operatingProfit: number;
    operatingMarginPct: number;
    expenseTotal: number;
    writeOffAmount: number;
    taxSales: number;
    taxPurchases: number;
    taxNet: number;
  };
  invoices: {
    totalCount: number;
    paidCount: number;
    pendingCount: number;
    returnedCount: number;
    cancelledCount: number;
    avgTicket: number;
  };
  cashflow: {
    inflow: number;
    outflow: number;
    net: number;
    byMethod: Record<string, number>;
  };
  debts: {
    receivableTotal: number;
    receivableOverdue: number;
    payableTotal: number;
    payableOverdue: number;
    netWorkingCapitalExposure: number;
    arAging: AgingBuckets;
    apAging: AgingBuckets;
  };
  purchases: { total: number; count: number; unpaidCount: number };
  inventory: {
    costValue: number;
    retailValue: number;
    unrealizedMargin: number;
    details: Array<{
      productId: string;
      name: string;
      sku: string;
      totalStock: number;
      soldUnits: number;
      returnedUnits: number;
      writeOffUnits: number;
      costValue: number;
      retailValue: number;
    }>;
  };
  balanceLike: {
    cashLike: number;
    inventoryCostValue: number;
    receivableTotal: number;
    payableTotal: number;
    totalAssetsLike: number;
    totalLiabilitiesLike: number;
    equityLike: number;
  };
  expenseByCategory: Record<string, number>;
  trend: Array<{ month: string; revenue: number; expenses: number; purchases: number }>;
  currentMonthSales: {
    from: string;
    to: string;
    saleDetails: Array<{
      invoiceId: string;
      invoiceNo: string;
      createdAt: string;
      customer: string;
      paymentType: string;
      totalAmount: number;
      itemCount: number;
      soldUnits: number;
      items: Array<{
        productId: string;
        productName: string;
        sku: string;
        quantity: number;
        unitPrice: number;
        lineTotal: number;
      }>;
    }>;
    productTotals: Array<{
      productId: string;
      name: string;
      sku: string;
      soldUnits: number;
      salesCount: number;
      revenue: number;
    }>;
  };
};

const toNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const presetLabels: Record<ReportRangePreset, string> = {
  month: 'Текущий месяц',
  q1: '1 квартал',
  q2: '2 квартал',
  q3: '3 квартал',
  q4: '4 квартал',
  year: 'Год',
  all: 'Все время',
};

const normalizeAging = (value: any): AgingBuckets => ({
  current: toNumber(value?.current),
  bucket1_30: toNumber(value?.bucket1_30),
  bucket31_60: toNumber(value?.bucket31_60),
  bucket61_90: toNumber(value?.bucket61_90),
  bucket90Plus: toNumber(value?.bucket90Plus),
  undated: toNumber(value?.undated),
  total: toNumber(value?.total),
});

const normalizeReport = (raw: any, preset: ReportRangePreset): FinanceReport => ({
  range: {
    preset: (raw?.range?.preset || preset) as ReportRangePreset,
    from: String(raw?.range?.from || new Date().toISOString()),
    to: String(raw?.range?.to || new Date().toISOString()),
  },
  kpi: {
    revenueGross: toNumber(raw?.kpi?.revenueGross),
    customerReturnsAmount: toNumber(raw?.kpi?.customerReturnsAmount),
    netRevenue: toNumber(raw?.kpi?.netRevenue),
    cogs: toNumber(raw?.kpi?.cogs),
    grossProfit: toNumber(raw?.kpi?.grossProfit),
    grossMarginPct: toNumber(raw?.kpi?.grossMarginPct),
    operatingProfit: toNumber(raw?.kpi?.operatingProfit),
    operatingMarginPct: toNumber(raw?.kpi?.operatingMarginPct),
    expenseTotal: toNumber(raw?.kpi?.expenseTotal),
    writeOffAmount: toNumber(raw?.kpi?.writeOffAmount),
    taxSales: toNumber(raw?.kpi?.taxSales),
    taxPurchases: toNumber(raw?.kpi?.taxPurchases),
    taxNet: toNumber(raw?.kpi?.taxNet),
  },
  invoices: {
    totalCount: toNumber(raw?.invoices?.totalCount),
    paidCount: toNumber(raw?.invoices?.paidCount),
    pendingCount: toNumber(raw?.invoices?.pendingCount),
    returnedCount: toNumber(raw?.invoices?.returnedCount),
    cancelledCount: toNumber(raw?.invoices?.cancelledCount),
    avgTicket: toNumber(raw?.invoices?.avgTicket),
  },
  cashflow: {
    inflow: toNumber(raw?.cashflow?.inflow),
    outflow: toNumber(raw?.cashflow?.outflow),
    net: toNumber(raw?.cashflow?.net),
    byMethod: typeof raw?.cashflow?.byMethod === 'object' && raw?.cashflow?.byMethod ? raw.cashflow.byMethod : {},
  },
  debts: {
    receivableTotal: toNumber(raw?.debts?.receivableTotal),
    receivableOverdue: toNumber(raw?.debts?.receivableOverdue),
    payableTotal: toNumber(raw?.debts?.payableTotal),
    payableOverdue: toNumber(raw?.debts?.payableOverdue),
    netWorkingCapitalExposure: toNumber(raw?.debts?.netWorkingCapitalExposure),
    arAging: normalizeAging(raw?.debts?.arAging),
    apAging: normalizeAging(raw?.debts?.apAging),
  },
  purchases: {
    total: toNumber(raw?.purchases?.total),
    count: toNumber(raw?.purchases?.count),
    unpaidCount: toNumber(raw?.purchases?.unpaidCount),
  },
  inventory: {
    costValue: toNumber(raw?.inventory?.costValue),
    retailValue: toNumber(raw?.inventory?.retailValue),
    unrealizedMargin: toNumber(raw?.inventory?.unrealizedMargin),
    details: Array.isArray(raw?.inventory?.details)
      ? raw.inventory.details.map((row: any) => ({
          productId: String(row?.productId || ''),
          name: String(row?.name || '-'),
          sku: String(row?.sku || '-'),
          totalStock: toNumber(row?.totalStock),
          soldUnits: toNumber(row?.soldUnits),
          returnedUnits: toNumber(row?.returnedUnits),
          writeOffUnits: toNumber(row?.writeOffUnits),
          costValue: toNumber(row?.costValue),
          retailValue: toNumber(row?.retailValue),
        }))
      : [],
  },
  balanceLike: {
    cashLike: toNumber(raw?.balanceLike?.cashLike),
    inventoryCostValue: toNumber(raw?.balanceLike?.inventoryCostValue),
    receivableTotal: toNumber(raw?.balanceLike?.receivableTotal),
    payableTotal: toNumber(raw?.balanceLike?.payableTotal),
    totalAssetsLike: toNumber(raw?.balanceLike?.totalAssetsLike),
    totalLiabilitiesLike: toNumber(raw?.balanceLike?.totalLiabilitiesLike),
    equityLike: toNumber(raw?.balanceLike?.equityLike),
  },
  expenseByCategory: typeof raw?.expenseByCategory === 'object' && raw?.expenseByCategory ? raw.expenseByCategory : {},
  trend: Array.isArray(raw?.trend)
    ? raw.trend.map((row: any) => ({
        month: String(row?.month || ''),
        revenue: toNumber(row?.revenue),
        expenses: toNumber(row?.expenses),
        purchases: toNumber(row?.purchases),
      }))
    : [],
  currentMonthSales: {
    from: String(raw?.currentMonthSales?.from || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()),
    to: String(raw?.currentMonthSales?.to || new Date().toISOString()),
    saleDetails: Array.isArray(raw?.currentMonthSales?.saleDetails)
      ? raw.currentMonthSales.saleDetails.map((row: any) => ({
          invoiceId: String(row?.invoiceId || ''),
          invoiceNo: String(row?.invoiceNo || ''),
          createdAt: String(row?.createdAt || ''),
          customer: String(row?.customer || 'Розничный покупатель'),
          paymentType: String(row?.paymentType || ''),
          totalAmount: toNumber(row?.totalAmount),
          itemCount: toNumber(row?.itemCount),
          soldUnits: toNumber(row?.soldUnits),
          items: Array.isArray(row?.items)
            ? row.items.map((item: any) => ({
                productId: String(item?.productId || ''),
                productName: String(item?.productName || '-'),
                sku: String(item?.sku || '-'),
                quantity: toNumber(item?.quantity),
                unitPrice: toNumber(item?.unitPrice),
                lineTotal: toNumber(item?.lineTotal),
              }))
            : [],
        }))
      : [],
    productTotals: Array.isArray(raw?.currentMonthSales?.productTotals)
      ? raw.currentMonthSales.productTotals.map((row: any) => ({
          productId: String(row?.productId || ''),
          name: String(row?.name || '-'),
          sku: String(row?.sku || '-'),
          soldUnits: toNumber(row?.soldUnits),
          salesCount: toNumber(row?.salesCount),
          revenue: toNumber(row?.revenue),
        }))
      : [],
  },
});

export const ReportsView: React.FC = () => {
  const { t } = useTranslation();
  const currencyCode = useCurrencyCode();
  const [preset, setPreset] = useState<ReportRangePreset>('month');
  const [viewMode, setViewMode] = useState<ReportViewMode>('summary');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [inventoryPage, setInventoryPage] = useState(1);
  const [inventoryPageSize, setInventoryPageSize] = useState<10 | 25 | 50>(10);
  const [inventorySearch, setInventorySearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<FinanceReport | null>(null);
  const [companyProfile, setCompanyProfile] = useState<CompanyReportProfile>(defaultCompanyReportProfile);

  const detailedReportWindow = useMemo(() => ({
    preset: 'month' as ReportRangePreset,
    fromDate: '',
    toDate: '',
  }), []);

  const loadReport = useCallback(async (
    nextPreset = preset,
    nextFrom = fromDate,
    nextTo = toDate,
    nextViewMode = viewMode,
  ) => {
    try {
      setLoading(true);
      setError(null);

      const effectivePreset = nextViewMode === 'detailed' ? detailedReportWindow.preset : nextPreset;
      const effectiveFrom = nextViewMode === 'detailed' ? detailedReportWindow.fromDate : nextFrom;
      const effectiveTo = nextViewMode === 'detailed' ? detailedReportWindow.toDate : nextTo;

      const params = new URLSearchParams();
      params.set('preset', effectivePreset);
      if (effectiveFrom) params.set('from', effectiveFrom);
      if (effectiveTo) params.set('to', effectiveTo);

      const response = await fetch(`/api/reports/finance?${params.toString()}`, {
        headers: await buildApiHeaders(false),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || t('Failed to load finance report'));
      setInventoryPage(1);
      setInventorySearch('');
      setReport(normalizeReport(body, effectivePreset));
    } catch (e: any) {
      setError(e?.message || t('Failed to load finance report'));
    } finally {
      setLoading(false);
    }
  }, [preset, fromDate, toDate, viewMode, detailedReportWindow, t]);

  useEffect(() => {
    void loadReport();
  }, [loadReport]);

  useEffect(() => {
    if (viewMode !== 'detailed') return;
    if (preset === detailedReportWindow.preset && !fromDate && !toDate) return;

    setPreset(detailedReportWindow.preset);
    setFromDate('');
    setToDate('');
    void loadReport(detailedReportWindow.preset, '', '', 'detailed');
  }, [viewMode, preset, fromDate, toDate, detailedReportWindow, loadReport]);

  useEffect(() => {
    let cancelled = false;

    const loadCompanyProfile = async () => {
      try {
        const response = await fetch('/api/reports/profile', {
          headers: await buildApiHeaders(false),
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok || cancelled) return;
        setCompanyProfile((prev) => ({ ...prev, ...(body || {}) }));
      } catch {
        // Keep preview/export working with fallback profile.
      }
    };

    void loadCompanyProfile();

    return () => {
      cancelled = true;
    };
  }, []);

  const formatMoney = (value: number) =>
    `${new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(toNumber(value))} ${currencyCode}`;
  const formatMoneyValue = (value: number) =>
    new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(toNumber(value));
  const moneyLabel = useCallback((label: string) => `${label} (${currencyCode})`, [currencyCode]);

  const reportTotals = useMemo(() => {
    if (!report) return null;
    return {
      totalStock: report.inventory.details.reduce((sum, row) => sum + toNumber(row.totalStock), 0),
      totalSold: report.inventory.details.reduce((sum, row) => sum + toNumber(row.soldUnits), 0),
      totalReturned: report.inventory.details.reduce((sum, row) => sum + toNumber(row.returnedUnits), 0),
      totalWriteOff: report.inventory.details.reduce((sum, row) => sum + toNumber(row.writeOffUnits), 0),
      totalCostValue: report.inventory.details.reduce((sum, row) => sum + toNumber(row.costValue), 0),
      totalRetailValue: report.inventory.details.reduce((sum, row) => sum + toNumber(row.retailValue), 0),
    };
  }, [report]);

  const formatPackQuantity = (quantity: number) => {
    const wholeQuantity = Math.max(0, Math.floor(toNumber(quantity)));
    return `${wholeQuantity} ед.`;
  };

  const kpiCards = useMemo(() => {
    if (!report) return [];
    return [
      { label: 'Выручка нетто', value: formatMoney(report.kpi.netRevenue) },
      { label: 'Валовая прибыль', value: formatMoney(report.kpi.grossProfit) },
      { label: 'Валовая маржа', value: `${toNumber(report.kpi.grossMarginPct).toFixed(1)} %` },
      { label: 'Возвраты', value: formatMoney(report.kpi.customerReturnsAmount) },
      { label: 'Дебиторка', value: formatMoney(report.debts.receivableTotal) },
      { label: 'Кредиторка', value: formatMoney(report.debts.payableTotal) },
    ];
  }, [report]);

  const exportXlsx = async () => {
    if (!report) return;
    setExporting(true);
    setError(null);
    try {
      const XLSX = await loadXlsx();
      const wb = XLSX.utils.book_new();

      const summarySheet = XLSX.utils.aoa_to_sheet([
        ['Показатель', 'Значение'],
        ['Выручка нетто', report.kpi.netRevenue],
        ['Валовая прибыль', report.kpi.grossProfit],
        ['Валовая маржа %', toNumber(report.kpi.grossMarginPct)],
        ['Возвраты', report.kpi.customerReturnsAmount],
        ['Сумма задолженности', report.debts.receivableTotal],
        ['Кредиторская задолженность', report.debts.payableTotal],
        ['Итоговая стоимость товаров', reportTotals?.totalRetailValue ?? 0],
      ]);
      XLSX.utils.book_append_sheet(wb, summarySheet, 'Сводка');

      const trendSheet = XLSX.utils.aoa_to_sheet([
        ['Месяц', 'Выручка', 'Расходы', 'Закупки'],
        ...report.trend.map((row) => [row.month, row.revenue, row.expenses, row.purchases]),
      ]);
      XLSX.utils.book_append_sheet(wb, trendSheet, 'Тренды');

      const detailRows = [
        ['№', 'Товар', 'SKU', 'Остаток', 'Продано', 'Возврат', 'Списание', 'Себестоимость', 'Розничная стоимость'],
        ...(report.inventory.details || []).map((row, index) => ([
          index + 1,
          row.name,
          row.sku,
          formatPackQuantity(row.totalStock),
          formatPackQuantity(row.soldUnits),
          formatPackQuantity(row.returnedUnits),
          formatPackQuantity(row.writeOffUnits),
          row.costValue,
          row.retailValue,
        ])),
        ['ИТОГО', '', '', reportTotals?.totalStock ?? 0, reportTotals?.totalSold ?? 0, reportTotals?.totalReturned ?? 0, reportTotals?.totalWriteOff ?? 0, reportTotals?.totalCostValue ?? 0, reportTotals?.totalRetailValue ?? 0],
      ];
      const detailSheet = XLSX.utils.aoa_to_sheet(detailRows);
      XLSX.utils.book_append_sheet(wb, detailSheet, 'Товары');

      XLSX.writeFile(wb, `отчет-${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch (e: any) {
      setError(e?.message || 'Не удалось выгрузить XLSX');
    } finally {
      setExporting(false);
    }
  };

  const buildPreviewHtml = (forPrint = false) => {
    if (!report) return '';

    const isDetailed = viewMode === 'detailed';
    const modeLabel = isDetailed ? 'Детализированный отчет' : 'Общий отчет';
    const companyLines = [companyProfile.legalName, companyProfile.address].filter(Boolean).join(' · ');
    const contactLines = [companyProfile.phone, companyProfile.email].filter(Boolean).join(' · ');
    const reportPeriod = isDetailed
      ? `${report.currentMonthSales.from.slice(0, 10)} — ${report.currentMonthSales.to.slice(0, 10)}`
      : `${report.range.from.slice(0,10)} — ${report.range.to.slice(0,10)}`;
    const preparedDate = new Date().toLocaleDateString('ru-RU');
    const approvalRole = companyProfile.approvalRole || 'Директор';
    const approvalTitle = companyProfile.approvalTitle || 'УТВЕРЖДАЮ';
    const stampLabel = companyProfile.stampLabel || 'М.П.';
    const logoMarkup = companyProfile.logoDataUrl ? `
      <div class="brand-lockup">
        <div class="brand-mark image"><img src="${companyProfile.logoDataUrl}" alt="Логотип компании" /></div>
        <div>
          <div class="brand-title">${companyProfile.pharmacyName || 'Аптека PharmaPro'}</div>
          <div class="brand-subtitle">Официальная финансовая отчетность</div>
        </div>
      </div>` : `
      <div class="brand-lockup">
        <div class="brand-mark" aria-hidden="true">
          <svg viewBox="0 0 64 64" focusable="false">
            <rect x="6" y="6" width="52" height="52" rx="14" fill="#0f766e"></rect>
            <path d="M32 17c7.4 0 13.5 6.1 13.5 13.5S39.4 44 32 44s-13.5-6.1-13.5-13.5S24.6 17 32 17Zm0 6.2c-4 0-7.3 3.3-7.3 7.3s3.3 7.3 7.3 7.3 7.3-3.3 7.3-7.3-3.3-7.3-7.3-7.3Zm-2.7-9.2h5.4v10.1h-5.4V14Zm0 26h5.4v10.1h-5.4V40ZM14 29.3h10.1v5.4H14v-5.4Zm26 0H50v5.4H40v-5.4Z" fill="#ecfeff"></path>
          </svg>
        </div>
        <div>
          <div class="brand-title">${companyProfile.pharmacyName || 'Аптека PharmaPro'}</div>
          <div class="brand-subtitle">Официальная финансовая отчетность</div>
        </div>
      </div>`;

    const detailedSalesRevenue = report.currentMonthSales.saleDetails.reduce((sum, sale) => sum + toNumber(sale.totalAmount), 0);
    const detailedSalesUnits = report.currentMonthSales.saleDetails.reduce((sum, sale) => sum + toNumber(sale.soldUnits), 0);
    const detailedSalesItems = report.currentMonthSales.saleDetails.reduce((sum, sale) => sum + toNumber(sale.itemCount), 0);

    const currentMonthProductRows = report.currentMonthSales.productTotals.map((row, i) =>
      `<tr>
        <td class="num">${i + 1}</td>
        <td>${row.name}<div class="muted" style="margin:2px 0 0">${row.sku}</div></td>
        <td class="r">${row.soldUnits}</td>
        <td class="r">${row.salesCount}</td>
        <td class="r">${formatMoney(row.revenue)}</td>
      </tr>`
    ).join('');

    const currentMonthSaleCards = report.currentMonthSales.saleDetails.map((sale, saleIndex) => `
      <section class="sale-card">
        <div class="sale-card-head">
          <div>
            <div style="font-weight:700;color:#111827">${saleIndex + 1}. ${sale.invoiceNo}</div>
            <div class="muted" style="margin-top:4px">${new Date(sale.createdAt).toLocaleString('ru-RU')} · ${sale.customer} · ${sale.paymentType}</div>
          </div>
          <div class="sale-card-badges">
            <span class="badge">Позиций: ${sale.itemCount}</span>
            <span class="badge">Единиц: ${sale.soldUnits}</span>
            <span class="badge success">Сумма: ${formatMoney(sale.totalAmount)}</span>
          </div>
        </div>
        <table>
          <thead>
            <tr>
              <th class="num">№</th>
              <th>Товар</th>
              <th>SKU</th>
              <th class="r">Кол-во</th>
              <th class="r">Цена</th>
              <th class="r">Сумма</th>
            </tr>
          </thead>
          <tbody>
            ${sale.items.map((item, index) => `
              <tr>
                <td class="num">${index + 1}</td>
                <td>${item.productName}</td>
                <td>${item.sku}</td>
                <td class="r">${item.quantity}</td>
                <td class="r">${formatMoney(item.unitPrice)}</td>
                <td class="r">${formatMoney(item.lineTotal)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </section>
    `).join('');

    const toolbar = forPrint ? '' : `
      <div class="toolbar">
        <div style="font-weight:700;font-size:15px">Предпросмотр — ${modeLabel}</div>
        <div style="display:flex;gap:8px">
          <button class="btn" onclick="window.print()">🖨 Печать</button>
          <button class="btn sec" onclick="window.close()">Закрыть</button>
        </div>
      </div>`;

    return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="UTF-8"/>
  <title>${modeLabel} ${reportPeriod}</title>
  <style>
    :root{color-scheme:light}
    *{box-sizing:border-box}
    body{font-family:'Segoe UI',Tahoma,Arial,sans-serif;margin:0;padding:${forPrint?'0':'24px'};background:${forPrint?'#fff':'#f3f4f6'};color:#1f2937;font-size:13px}
    .toolbar{display:flex;justify-content:space-between;align-items:center;margin:0 auto 14px;max-width:860px;background:#fff;padding:12px 16px;border-radius:10px;box-shadow:0 2px 8px rgba(0,0,0,.08)}
    .btn{border:0;background:#374151;color:#fff;padding:9px 16px;border-radius:7px;cursor:pointer;font-weight:600;font-size:13px}
    .btn.sec{background:#9ca3af}
    .sheet{background:#fff;width:794px;margin:0 auto;padding:32px 36px;box-shadow:${forPrint?'none':'0 8px 22px rgba(0,0,0,.08)'};border-radius:${forPrint?'0':'10px'}}
    .report-shell{border:1px solid #d1d5db;border-radius:12px;padding:18px 18px 24px;background:linear-gradient(180deg,#ffffff 0%,#fcfcfd 100%)}
    .document-meta{display:grid;grid-template-columns:1.3fr .9fr;gap:18px;align-items:start;margin-bottom:18px}
    .official-box{border:1px solid #cbd5e1;border-radius:10px;padding:14px;background:#f8fafc}
    .official-box h3{margin:0 0 10px;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#475569}
    .meta-table{display:grid;grid-template-columns:160px 1fr;gap:6px 10px;font-size:12px}
    .meta-label{color:#64748b}
    .meta-value{font-weight:600;color:#0f172a}
    .brand-lockup{display:flex;align-items:center;gap:14px}
    .brand-mark{width:64px;height:64px;flex:0 0 64px}
    .brand-mark svg{width:100%;height:100%;display:block}
    .brand-mark.image{border:1px solid #d1d5db;border-radius:16px;background:#fff;padding:6px;display:flex;align-items:center;justify-content:center;overflow:hidden}
    .brand-mark.image img{width:100%;height:100%;object-fit:contain;display:block}
    .brand-title{font-size:22px;font-weight:800;color:#0f172a;letter-spacing:.01em}
    .brand-subtitle{font-size:12px;color:#475569;margin-top:3px;text-transform:uppercase;letter-spacing:.08em}
    .doc-title{margin:18px 0 8px;text-align:center}
    .doc-title h1{font-size:22px;letter-spacing:.02em;text-transform:uppercase}
    .doc-kind{font-size:12px;color:#475569;letter-spacing:.12em;text-transform:uppercase;font-weight:700}
    .seal-line{height:3px;border-radius:999px;background:linear-gradient(90deg,#0f766e 0%,#1d4ed8 100%);margin:14px 0 16px}
    h1{margin:0 0 4px;font-size:20px;color:#111827}
    h2{font-size:14px;font-weight:700;color:#374151;border-bottom:2px solid #e5e7eb;padding-bottom:6px;margin:24px 0 10px}
    .muted{color:#6b7280;font-size:12px}
    .kpi-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:16px 0}
    .kpi{border:1px solid #e5e7eb;border-radius:8px;padding:10px 12px}
    .kpi .lbl{color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:.04em}
    .kpi .val{font-size:16px;font-weight:700;margin-top:4px;color:#111827}
    .two-col{display:grid;grid-template-columns:1fr 1fr;gap:16px}
    .sale-card{border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;margin-bottom:14px}
    .sale-card-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;padding:12px 14px;background:#f9fafb}
    .sale-card-badges{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}
    .badge{display:inline-flex;align-items:center;padding:6px 10px;border-radius:999px;background:#fff;color:#374151;font-size:11px;font-weight:700;border:1px solid #e5e7eb}
    .badge.success{color:#166534;background:#f0fdf4;border-color:#bbf7d0}
    table{width:100%;border-collapse:collapse;font-size:12px}
    th,td{padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:left}
    th{background:#f9fafb;color:#6b7280;text-transform:uppercase;font-size:10px;letter-spacing:.04em}
    tr.total td{font-weight:700;background:#f0fdf4;color:#166534}
    td.r{text-align:right}
    td.num{color:#9ca3af;font-size:11px;width:28px;text-align:center}
    .signatures{display:grid;grid-template-columns:repeat(3,1fr);gap:20px;margin-top:28px}
    .signature-card{padding-top:16px}
    .signature-role{font-size:11px;color:#64748b;margin-bottom:20px;text-transform:uppercase;letter-spacing:.06em}
    .signature-line{border-top:1.5px solid #334155;padding-top:8px;font-size:12px;color:#0f172a;font-weight:600}
    .approval-box{min-height:100%;display:flex;flex-direction:column;justify-content:space-between}
    .approval-title{font-size:12px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#0f172a}
    .approval-role{font-size:12px;color:#475569;margin-top:14px}
    .approval-name{margin-top:18px;padding-top:8px;border-top:1.5px solid #334155;font-size:13px;font-weight:700;color:#0f172a}
    .approval-date{margin-top:10px;font-size:12px;color:#64748b}
    .stamp-box{margin-top:16px;margin-left:auto;width:82px;height:82px;border:2px dashed #94a3b8;border-radius:999px;display:flex;align-items:center;justify-content:center;color:#475569;font-size:12px;font-weight:700;letter-spacing:.08em}
    .footer{margin-top:24px;font-size:11px;color:#9ca3af;display:flex;justify-content:space-between;gap:12px;align-items:center}
    @page{size:A4 portrait;margin:12mm}
    @media (max-width: 900px){
      .document-meta{grid-template-columns:1fr}
      .signatures{grid-template-columns:1fr}
      .sale-card-head{flex-direction:column}
      .sale-card-badges{justify-content:flex-start}
    }
    @media print{
      body{background:#fff;padding:0}
      .toolbar{display:none}
      .sheet{width:auto;padding:0;box-shadow:none;border-radius:0}
      .report-shell{border:none;border-radius:0;padding:0;background:#fff}
      h2{break-after:avoid}
      tr{break-inside:avoid}
    }
    @media print{
      .footer::after{content:"Страница " counter(page) " из " counter(pages)}
    }
  </style>
</head>
<body>
${toolbar}
<main class="sheet">
  <div class="report-shell">
    <div class="document-meta">
      <div class="official-box">
        ${logoMarkup}
        <div class="seal-line"></div>
        <div class="meta-table">
          <div class="meta-label">Юридическое лицо</div><div class="meta-value">${companyProfile.legalName || companyProfile.pharmacyName || '-'}</div>
          <div class="meta-label">Адрес</div><div class="meta-value">${companyProfile.address || '-'}</div>
          <div class="meta-label">ИНН</div><div class="meta-value">${companyProfile.taxId || '-'}</div>
          <div class="meta-label">Контакты</div><div class="meta-value">${contactLines || '—'}</div>
        </div>
      </div>
      <div class="official-box">
        <div class="approval-box">
          <div>
            <div class="approval-title">${approvalTitle}</div>
            <div class="approval-role">${approvalRole}</div>
            <div class="approval-name">${companyProfile.directorName || '____________________'}</div>
            <div class="approval-date">Дата: ${preparedDate}</div>
          </div>
          <div class="stamp-box">${stampLabel}</div>
        </div>
      </div>
    </div>

    <div class="official-box" style="margin-bottom:18px">
      <h3>Реквизиты документа</h3>
      <div class="meta-table">
        <div class="meta-label">Форма</div><div class="meta-value">Внутренний финансовый отчет</div>
        <div class="meta-label">Режим</div><div class="meta-value">${modeLabel}</div>
        <div class="meta-label">Период</div><div class="meta-value">${reportPeriod}</div>
        <div class="meta-label">Дата составления</div><div class="meta-value">${preparedDate}</div>
        <div class="meta-label">Подготовил</div><div class="meta-value">${companyProfile.reportPreparedBy || '-'}</div>
      </div>
    </div>

    <div class="doc-title">
      <div class="doc-kind">Официальный печатный экземпляр</div>
      <h1>Финансовый отчет</h1>
      <div class="muted">Режим: ${modeLabel} · Период: ${reportPeriod} · Сформирован: ${new Date().toLocaleString('ru-RU')}</div>
      ${companyLines ? `<div class="muted" style="margin-top:4px">${companyLines}</div>` : ''}
    </div>

  ${isDetailed ? `
  <h2>1. Детализация продаж за текущий месяц</h2>
  <div class="kpi-grid">
    <div class="kpi"><div class="lbl">Период</div><div class="val">${reportPeriod}</div></div>
    <div class="kpi"><div class="lbl">Продаж</div><div class="val">${report.currentMonthSales.saleDetails.length}</div></div>
    <div class="kpi"><div class="lbl">Позиций</div><div class="val">${detailedSalesItems}</div></div>
    <div class="kpi"><div class="lbl">Единиц</div><div class="val">${detailedSalesUnits}</div></div>
    <div class="kpi"><div class="lbl">Товаров</div><div class="val">${report.currentMonthSales.productTotals.length}</div></div>
    <div class="kpi"><div class="lbl">Выручка</div><div class="val">${formatMoney(detailedSalesRevenue)}</div></div>
  </div>

  ${currentMonthProductRows ? `
  <h2>2. Продажи товаров за текущий месяц</h2>
  <table>
    <thead><tr><th class="num">№</th><th>Товар</th><th class="r">Продано</th><th class="r">Продаж</th><th class="r">Выручка</th></tr></thead>
    <tbody>${currentMonthProductRows}</tbody>
  </table>` : ''}

  ${currentMonthSaleCards ? `
  <h2>3. Каждая продажа за текущий месяц</h2>
  ${currentMonthSaleCards}` : `
  <div class="official-box" style="margin-top:18px">За текущий месяц продаж пока нет.</div>`}
  ` : `
  <!-- 4. Закупки -->
  <h2>4. Закупки</h2>
  <table>
    <thead><tr><th class="num">№</th><th>Показатель</th><th class="r">Значение</th></tr></thead>
    <tbody>
      <tr><td class="num">1</td><td>Сумма</td><td class="r">${formatMoney(report.purchases.total)}</td></tr>
      <tr><td class="num">2</td><td>Количество</td><td class="r">${report.purchases.count}</td></tr>
      <tr><td class="num">3</td><td>Неоплачено</td><td class="r">${report.purchases.unpaidCount}</td></tr>
    </tbody>
  </table>

  <!-- 5. Товарный запас -->
  <h2>5. Товарный запас</h2>
  <table>
    <thead><tr><th class="num">№</th><th>Показатель</th><th class="r">Значение</th></tr></thead>
    <tbody>
      <tr><td class="num">1</td><td>Стоимость по себестоимости</td><td class="r">${formatMoney(report.inventory.costValue)}</td></tr>
      <tr><td class="num">2</td><td>Стоимость в розничных ценах</td><td class="r">${formatMoney(report.inventory.retailValue)}</td></tr>
      <tr><td class="num">3</td><td>Нереализованная маржа</td><td class="r">${formatMoney(report.inventory.unrealizedMargin)}</td></tr>
    </tbody>
  </table>
  `}

    <div class="signatures">
      <div class="signature-card">
        <div class="signature-role">Директор</div>
        <div class="signature-line">${companyProfile.directorName || '____________________'}</div>
      </div>
      <div class="signature-card">
        <div class="signature-role">Главный бухгалтер</div>
        <div class="signature-line">${companyProfile.chiefAccountantName || '____________________'}</div>
      </div>
      <div class="signature-card">
        <div class="signature-role">Составил отчет</div>
        <div class="signature-line">${companyProfile.reportPreparedBy || '____________________'}</div>
      </div>
    </div>

    <div class="footer">
      <span>${companyProfile.pharmacyName || 'Аптека PharmaPro'} · официальный печатный шаблон</span>
      <span>${new Date().toLocaleDateString('ru-RU')}</span>
    </div>
  </div>
</main>
</body>
</html>`;
  };

  const openPrintPreview = () => {
    if (!report) return;
    const html = buildPreviewHtml(false);
    const win = window.open('', '_blank', 'width=1060,height=900');
    if (!win) {
      setError('Разрешите открытие всплывающих окон для предпросмотра печати');
      return;
    }
    win.document.open();
    win.document.write(html);
    win.document.close();
  };

  const downloadPdf = async () => {
    if (!report) return;

    setExporting(true);
    setError(null);

    try {
      const [{ jspdf }, html2canvasModule] = await Promise.all([
        loadPdfDependencies(),
        import('html2canvas'),
      ]);
      const jsPDF = jspdf;
      const html2canvas = html2canvasModule.default;

      const iframe = document.createElement('iframe');
      iframe.style.position = 'fixed';
      iframe.style.left = '-10000px';
      iframe.style.top = '0';
      iframe.style.width = '900px';
      iframe.style.height = '1200px';
      iframe.setAttribute('aria-hidden', 'true');
      document.body.appendChild(iframe);

      const html = buildPreviewHtml(true);
      const frameDoc = iframe.contentDocument;
      if (!frameDoc) {
        throw new Error('Не удалось подготовить PDF');
      }

      frameDoc.open();
      frameDoc.write(html);
      frameDoc.close();

      await new Promise((resolve) => window.setTimeout(resolve, 300));

      const target = frameDoc.querySelector('.sheet') as HTMLElement | null;
      if (!target) {
        throw new Error('Не удалось подготовить содержимое отчета');
      }

      const canvas = await html2canvas(target, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff',
      });

      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const imageWidth = pageWidth;
      const imageHeight = (canvas.height * imageWidth) / canvas.width;
      let heightLeft = imageHeight;
      let position = 0;
      const imgData = canvas.toDataURL('image/png');

      doc.addImage(imgData, 'PNG', 0, position, imageWidth, imageHeight);
      heightLeft -= pageHeight;

      while (heightLeft > 0) {
        position = heightLeft - imageHeight;
        doc.addPage();
        doc.addImage(imgData, 'PNG', 0, position, imageWidth, imageHeight);
        heightLeft -= pageHeight;
      }

      doc.save(`отчет-${report.range.from.slice(0,10)}-${report.range.to.slice(0,10)}.pdf`);
      document.body.removeChild(iframe);
    } catch (e: any) {
      setError(e?.message || 'Не удалось выгрузить PDF');
    } finally {
      setExporting(false);
    }
  };

  const renderMetricSection = (title: string, rows: Array<{ label: string; value: string | number }>) => (
    <div className="bg-white rounded-2xl border border-[#5A5A40]/10 p-5 overflow-x-auto">
      <h4 className="text-base font-bold text-[#5A5A40] mb-3">{title}</h4>
      <table className="w-full text-sm min-w-120">
        <thead className="text-[#5A5A40]/60 uppercase tracking-wider text-xs bg-[#f5f5f0]/60">
          <tr>
            <th className="text-left px-3 py-2 w-12">№</th>
            <th className="text-left px-3 py-2">Показатель</th>
            <th className="text-right px-3 py-2">Значение</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${title}-${row.label}`} className="border-t border-[#5A5A40]/10">
              <td className="px-3 py-2 text-[#5A5A40]/45">{index + 1}</td>
              <td className="px-3 py-2 text-[#5A5A40]">{row.label}</td>
              <td className="px-3 py-2 text-right font-semibold text-[#5A5A40]">{row.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  const renderTwoColumnSection = (
    leftTitle: string,
    leftRows: Array<{ label: string; value: string | number }>,
    rightTitle: string,
    rightRows: Array<{ label: string; value: string | number }>,
  ) => (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
      {renderMetricSection(leftTitle, leftRows)}
      {renderMetricSection(rightTitle, rightRows)}
    </div>
  );

  const renderInventoryDetailSection = () => {
    const filteredRows = (report?.inventory.details ?? []).filter((row) => {
      const query = inventorySearch.trim().toLowerCase();
      if (!query) return true;
      return row.name.toLowerCase().includes(query) || row.sku.toLowerCase().includes(query);
    });
    const totalItems = filteredRows.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / inventoryPageSize));
    const safePage = Math.min(inventoryPage, totalPages);
    const pageRows = filteredRows.slice((safePage - 1) * inventoryPageSize, safePage * inventoryPageSize);
    const pageNumbers = Array.from({ length: totalPages }, (_, index) => index + 1).slice(
      Math.max(0, safePage - 3),
      Math.max(0, safePage - 3) + 5,
    );

    return (
    <div className="bg-white rounded-2xl border border-[#5A5A40]/10 p-5 overflow-x-auto">
      <div className="mb-3 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <h4 className="text-base font-bold text-[#5A5A40]">8. Остатки и движение товара</h4>
        <div className="flex flex-col gap-2 md:flex-row md:items-center">
          <input
            type="text"
            value={inventorySearch}
            onChange={(e) => {
              setInventorySearch(e.target.value);
              setInventoryPage(1);
            }}
            placeholder="Поиск по товару или SKU"
            className="rounded-lg border border-[#5A5A40]/15 px-3 py-1.5 text-xs text-[#5A5A40] outline-none min-w-56"
          />
          <label className="flex items-center gap-2 text-xs text-[#5A5A40]/70">
            <span>Строк на странице</span>
            <select
              value={inventoryPageSize}
              onChange={(e) => {
                setInventoryPageSize(Number(e.target.value) as 10 | 25 | 50);
                setInventoryPage(1);
              }}
              className="rounded-lg border border-[#5A5A40]/15 px-2 py-1 text-xs text-[#5A5A40] outline-none"
            >
              {[10, 25, 50].map((size) => (
                <option key={size} value={size}>{size}</option>
              ))}
            </select>
          </label>
        </div>
      </div>
      <table className="w-full text-sm min-w-200">
        <thead className="text-[#5A5A40]/60 uppercase tracking-wider text-xs bg-[#f5f5f0]/60">
          <tr>
            <th className="text-left px-3 py-2">Товар</th>
            <th className="text-left px-3 py-2">SKU</th>
            <th className="text-left px-3 py-2">Остаток</th>
            <th className="text-left px-3 py-2">Продано</th>
            <th className="text-left px-3 py-2">Возврат</th>
            <th className="text-left px-3 py-2">Списание</th>
            <th className="text-left px-3 py-2">Себестоимость</th>
            <th className="text-left px-3 py-2">Розничная стоимость</th>
          </tr>
        </thead>
        <tbody>
          {pageRows.map((row) => (
            <tr key={row.productId} className="border-t border-[#5A5A40]/10">
              <td className="px-3 py-2 font-medium text-[#5A5A40]">{row.name}</td>
              <td className="px-3 py-2 text-[#5A5A40]/65">{row.sku}</td>
              <td className="px-3 py-2">{formatPackQuantity(row.totalStock)}</td>
              <td className="px-3 py-2">{formatPackQuantity(row.soldUnits)}</td>
              <td className="px-3 py-2">{formatPackQuantity(row.returnedUnits)}</td>
              <td className="px-3 py-2">{formatPackQuantity(row.writeOffUnits)}</td>
              <td className="px-3 py-2">{formatMoney(row.costValue)}</td>
              <td className="px-3 py-2">{formatMoney(row.retailValue)}</td>
            </tr>
          ))}
          {reportTotals && (
            <tr className="border-t-2 border-[#5A5A40]/20 bg-[#f5f5f0]/60 font-bold text-[#5A5A40]">
              <td className="px-3 py-2">Итог</td>
              <td className="px-3 py-2" colSpan={2}>Суммарно по товарам</td>
              <td className="px-3 py-2">{reportTotals.totalStock}</td>
              <td className="px-3 py-2">{reportTotals.totalSold}</td>
              <td className="px-3 py-2">{reportTotals.totalReturned}</td>
              <td className="px-3 py-2">{reportTotals.totalWriteOff}</td>
              <td className="px-3 py-2">{formatMoney(reportTotals.totalCostValue)}</td>
              <td className="px-3 py-2">{formatMoney(reportTotals.totalRetailValue)}</td>
            </tr>
          )}
        </tbody>
      </table>

      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between gap-4">
          <p className="text-xs text-[#5A5A40]/60">Страница {safePage} из {totalPages} • Найдено: {totalItems}</p>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            <button
              onClick={() => setInventoryPage(1)}
              disabled={safePage === 1}
              className="px-3 py-1.5 rounded-lg border border-[#5A5A40]/20 text-xs text-[#5A5A40] disabled:opacity-40"
            >
              Первая
            </button>
            <button
              onClick={() => setInventoryPage((current) => Math.max(1, current - 1))}
              disabled={safePage === 1}
              className="px-3 py-1.5 rounded-lg border border-[#5A5A40]/20 text-xs text-[#5A5A40] disabled:opacity-40"
            >
              Назад
            </button>
            {pageNumbers.map((pageNumber) => (
              <button
                key={pageNumber}
                onClick={() => setInventoryPage(pageNumber)}
                className={`px-3 py-1.5 rounded-lg border text-xs ${pageNumber === safePage ? 'bg-[#5A5A40] text-white border-[#5A5A40]' : 'border-[#5A5A40]/20 text-[#5A5A40]'}`}
              >
                {pageNumber}
              </button>
            ))}
            <button
              onClick={() => setInventoryPage((current) => Math.min(totalPages, current + 1))}
              disabled={safePage === totalPages}
              className="px-3 py-1.5 rounded-lg border border-[#5A5A40]/20 text-xs text-[#5A5A40] disabled:opacity-40"
            >
              Вперед
            </button>
            <button
              onClick={() => setInventoryPage(totalPages)}
              disabled={safePage === totalPages}
              className="px-3 py-1.5 rounded-lg border border-[#5A5A40]/20 text-xs text-[#5A5A40] disabled:opacity-40"
            >
              Последняя
            </button>
          </div>
        </div>
      )}
    </div>
    );
  };

  const renderCurrentMonthProductSalesSection = () => (
    <div className="bg-white rounded-2xl border border-[#5A5A40]/10 p-5 overflow-x-auto">
      <div className="mb-3">
        <h4 className="text-base font-bold text-[#5A5A40]">9. Продажи товаров за текущий месяц</h4>
        <p className="text-xs text-[#5A5A40]/60 mt-1">Сколько единиц каждого товара продано с начала текущего месяца.</p>
      </div>
      <table className="w-full text-sm min-w-160">
        <thead className="text-[#5A5A40]/60 uppercase tracking-wider text-xs bg-[#f5f5f0]/60">
          <tr>
            <th className="text-left px-3 py-2">Товар</th>
            <th className="text-left px-3 py-2">SKU</th>
            <th className="text-left px-3 py-2">Продано</th>
            <th className="text-left px-3 py-2">Продаж</th>
            <th className="text-left px-3 py-2">Выручка</th>
          </tr>
        </thead>
        <tbody>
          {report?.currentMonthSales.productTotals.map((row) => (
            <tr key={row.productId} className="border-t border-[#5A5A40]/10">
              <td className="px-3 py-2 font-medium text-[#5A5A40]">{row.name}</td>
              <td className="px-3 py-2 text-[#5A5A40]/65">{row.sku}</td>
              <td className="px-3 py-2">{row.soldUnits}</td>
              <td className="px-3 py-2">{row.salesCount}</td>
              <td className="px-3 py-2">{formatMoney(row.revenue)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  const renderCurrentMonthSalesDetailSection = () => (
    <div className="bg-white rounded-2xl border border-[#5A5A40]/10 p-5 overflow-x-auto">
      <div className="mb-3">
        <h4 className="text-base font-bold text-[#5A5A40]">10. Каждая продажа за текущий месяц</h4>
        <p className="text-xs text-[#5A5A40]/60 mt-1">Полный список продаж с товарами и количеством по каждой накладной.</p>
      </div>
      <div className="space-y-3">
        {report?.currentMonthSales.saleDetails.map((sale) => (
          <div key={sale.invoiceId} className="rounded-2xl border border-[#5A5A40]/10 overflow-hidden">
            <div className="bg-[#f5f5f0]/60 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-bold text-[#5A5A40]">{sale.invoiceNo}</p>
                <p className="text-xs text-[#5A5A40]/60 mt-1">{new Date(sale.createdAt).toLocaleString('ru-RU')} · {sale.customer} · {sale.paymentType}</p>
              </div>
              <div className="flex flex-wrap gap-2 text-xs font-semibold">
                <span className="rounded-full bg-white px-3 py-1.5 text-[#5A5A40]">Позиций: {sale.itemCount}</span>
                <span className="rounded-full bg-white px-3 py-1.5 text-[#5A5A40]">Единиц: {sale.soldUnits}</span>
                <span className="rounded-full bg-white px-3 py-1.5 text-emerald-700">Сумма: {formatMoney(sale.totalAmount)}</span>
              </div>
            </div>
            <table className="w-full text-sm min-w-160">
              <thead className="text-[#5A5A40]/60 uppercase tracking-wider text-xs bg-white">
                <tr>
                  <th className="text-left px-4 py-2">Товар</th>
                  <th className="text-left px-4 py-2">SKU</th>
                  <th className="text-left px-4 py-2">Кол-во</th>
                  <th className="text-left px-4 py-2">{moneyLabel('Цена')}</th>
                  <th className="text-left px-4 py-2">{moneyLabel('Сумма')}</th>
                </tr>
              </thead>
              <tbody>
                {sale.items.map((item, index) => (
                  <tr key={`${sale.invoiceId}-${item.productId}-${index}`} className="border-t border-[#5A5A40]/10">
                    <td className="px-4 py-2 font-medium text-[#5A5A40]">{item.productName}</td>
                    <td className="px-4 py-2 text-[#5A5A40]/65">{item.sku}</td>
                    <td className="px-4 py-2">{item.quantity}</td>
                    <td className="px-4 py-2">{formatMoneyValue(item.unitPrice)}</td>
                    <td className="px-4 py-2">{formatMoneyValue(item.lineTotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </div>
  );

  const renderDetailedSalesOnlySummary = () => {
    const totalSales = report?.currentMonthSales.saleDetails.length ?? 0;
    const totalItems = report?.currentMonthSales.saleDetails.reduce((sum, sale) => sum + toNumber(sale.itemCount), 0) ?? 0;
    const totalUnits = report?.currentMonthSales.saleDetails.reduce((sum, sale) => sum + toNumber(sale.soldUnits), 0) ?? 0;
    const totalRevenue = report?.currentMonthSales.saleDetails.reduce((sum, sale) => sum + toNumber(sale.totalAmount), 0) ?? 0;
    const periodFrom = report?.currentMonthSales.from ? new Date(report.currentMonthSales.from).toLocaleDateString('ru-RU') : '—';
    const periodTo = report?.currentMonthSales.to ? new Date(report.currentMonthSales.to).toLocaleDateString('ru-RU') : '—';

    return (
      <>
        <div className="bg-emerald-50 border border-emerald-100 rounded-2xl px-4 py-3 text-sm text-emerald-800">
          Детализированный отчет показывает только продажи текущего месяца. Период всегда считается с 1 числа месяца по сегодняшний день: {periodFrom} - {periodTo}.
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {[
            { label: 'Период', value: `${periodFrom} - ${periodTo}` },
            { label: 'Продаж', value: String(totalSales) },
            { label: 'Позиций и единиц', value: `${totalItems} поз. · ${totalUnits} ед.` },
            { label: 'Выручка', value: formatMoney(totalRevenue) },
          ].map((item) => (
            <div key={item.label} className="bg-white p-4 rounded-2xl border border-[#5A5A40]/10">
              <p className="text-xs uppercase tracking-wider text-[#5A5A40]/50">{item.label}</p>
              <p className="text-2xl font-bold text-[#5A5A40] mt-1">{item.value}</p>
            </div>
          ))}
        </div>
      </>
    );
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold text-[#5A5A40] tracking-tight">Финансовые отчеты</h2>
          <p className="text-[#5A5A40]/60 mt-1">Экспорт, детализация товаров и итоговые суммы по отчетам</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="mr-2 flex items-center rounded-2xl border border-[#5A5A40]/15 bg-white p-1">
            <button
              onClick={() => setViewMode('summary')}
              className={`px-3 py-2 rounded-xl text-xs font-semibold transition-colors ${viewMode === 'summary' ? 'bg-[#5A5A40] text-white' : 'text-[#5A5A40]/70'}`}
            >
              Общий отчет
            </button>
            <button
              onClick={() => {
                setViewMode('detailed');
                setPreset('month');
                setFromDate('');
                setToDate('');
                void loadReport('month', '', '', 'detailed');
              }}
              className={`px-3 py-2 rounded-xl text-xs font-semibold transition-colors ${viewMode === 'detailed' ? 'bg-[#5A5A40] text-white' : 'text-[#5A5A40]/70'}`}
            >
              Детализированный отчет
            </button>
          </div>
          {viewMode === 'summary' && (['month', 'q1', 'q2', 'q3', 'q4', 'year', 'all'] as ReportRangePreset[]).map((p) => (
            <button
              key={p}
              onClick={() => {
                setPreset(p);
                setFromDate('');
                setToDate('');
                void loadReport(p, '', '');
              }}
              className={`px-3 py-2 rounded-xl text-xs font-semibold border ${preset === p ? 'bg-[#5A5A40] text-white border-[#5A5A40]' : 'bg-white text-[#5A5A40] border-[#5A5A40]/20'}`}
            >
              {presetLabels[p]}
            </button>
          ))}
          {viewMode === 'detailed' && (
            <div className="px-3 py-2 rounded-xl text-xs font-semibold border bg-emerald-50 text-emerald-800 border-emerald-100">
              Период: с 1 числа текущего месяца по сегодня
            </div>
          )}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-[#5A5A40]/10 p-3 flex flex-wrap items-center gap-2">
        <Calendar size={14} className="text-[#5A5A40]/50" />
        <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} disabled={viewMode === 'detailed'} className="text-xs px-2 py-1 rounded-lg border border-[#5A5A40]/10 disabled:bg-[#f5f5f0] disabled:text-[#5A5A40]/45" />
        <span className="text-[#5A5A40]/50">-</span>
        <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} disabled={viewMode === 'detailed'} className="text-xs px-2 py-1 rounded-lg border border-[#5A5A40]/10 disabled:bg-[#f5f5f0] disabled:text-[#5A5A40]/45" />
        <button onClick={() => void loadReport(preset, fromDate, toDate)} disabled={viewMode === 'detailed'} className="px-3 py-1.5 rounded-lg bg-[#f5f5f0] text-[#5A5A40] text-xs font-semibold disabled:opacity-50">Применить</button>
        {viewMode === 'detailed' && <span className="text-xs text-[#5A5A40]/55">В детальном режиме период фиксирован: текущий месяц с 1 числа.</span>}

        <div className="ml-auto flex items-center gap-2">
          <button onClick={openPrintPreview} disabled={!report} className="px-3 py-1.5 rounded-lg border border-[#5A5A40]/20 text-xs flex items-center gap-1 disabled:opacity-50"><Eye size={13} /> Превью</button>
          <button onClick={() => void exportXlsx()} disabled={!report || exporting} className="px-3 py-1.5 rounded-lg border border-[#5A5A40]/20 text-xs flex items-center gap-1 disabled:opacity-50"><FileSpreadsheet size={13} /> XLSX</button>
          <button onClick={() => void downloadPdf()} disabled={!report || exporting} className="px-3 py-1.5 rounded-lg bg-[#5A5A40] text-white text-xs flex items-center gap-1 disabled:opacity-50"><FileDown size={13} /> PDF</button>
        </div>
      </div>

      {loading && <div className="text-sm text-[#5A5A40]/60">Загрузка финансового отчета...</div>}

      {error && (
        <div className="bg-red-50 border border-red-100 rounded-2xl px-4 py-3 text-sm text-red-700 flex items-center gap-2">
          <AlertCircle size={14} /> {error}
        </div>
      )}

      {report && (
        <>
          {viewMode === 'detailed' ? (
            <>
              {renderDetailedSalesOnlySummary()}
              {report.currentMonthSales.productTotals.length > 0 && renderCurrentMonthProductSalesSection()}
              {report.currentMonthSales.saleDetails.length > 0 ? renderCurrentMonthSalesDetailSection() : (
                <div className="bg-white rounded-2xl border border-[#5A5A40]/10 p-5 text-sm text-[#5A5A40]/60">
                  За текущий месяц продаж пока нет.
                </div>
              )}
            </>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {kpiCards.map((kpi) => (
                  <div key={kpi.label} className="bg-white p-4 rounded-2xl border border-[#5A5A40]/10">
                    <p className="text-xs uppercase tracking-wider text-[#5A5A40]/50">{kpi.label}</p>
                    <p className="text-2xl font-bold text-[#5A5A40] mt-1">{kpi.value}</p>
                  </div>
                ))}
              </div>

              {renderMetricSection('1. Ключевые показатели', [
                { label: 'Выручка брутто', value: formatMoney(report.kpi.revenueGross) },
                { label: 'Возвраты', value: formatMoney(report.kpi.customerReturnsAmount) },
                { label: 'Выручка нетто', value: formatMoney(report.kpi.netRevenue) },
                { label: 'Себестоимость', value: formatMoney(report.kpi.cogs) },
                { label: 'Валовая прибыль', value: formatMoney(report.kpi.grossProfit) },
                { label: 'Валовая маржа', value: `${toNumber(report.kpi.grossMarginPct).toFixed(1)} %` },
              ])}

              {renderTwoColumnSection(
                '2. Счета-фактуры',
                [
                  { label: 'Всего', value: report.invoices.totalCount },
                  { label: 'Оплачено', value: report.invoices.paidCount },
                  { label: 'Ожидает', value: report.invoices.pendingCount },
                  { label: 'Возвращено', value: report.invoices.returnedCount },
                  { label: 'Отменено', value: report.invoices.cancelledCount },
                  { label: 'Средний чек', value: formatMoney(report.invoices.avgTicket) },
                ],
                '3. Закупки и склад',
                [
                  { label: 'Сумма закупок', value: formatMoney(report.purchases.total) },
                  { label: 'Количество закупок', value: report.purchases.count },
                  { label: 'Неоплаченные закупки', value: report.purchases.unpaidCount },
                  { label: 'Склад по себестоимости', value: formatMoney(report.inventory.costValue) },
                  { label: 'Склад в рознице', value: formatMoney(report.inventory.retailValue) },
                  { label: 'Нереализованная маржа', value: formatMoney(report.inventory.unrealizedMargin) },
                ],
              )}

              {renderTwoColumnSection(
                '4. Денежный поток',
                [
                  { label: 'Поступления', value: formatMoney(report.cashflow.inflow) },
                  { label: 'Выбытия', value: formatMoney(report.cashflow.outflow) },
                  { label: 'Чистый поток', value: formatMoney(report.cashflow.net) },
                  ...Object.entries(report.cashflow.byMethod).map(([method, amount]) => ({
                    label: `Метод: ${method}`,
                    value: formatMoney(Number(amount)),
                  })),
                ],
                '5. Долги',
                [
                  { label: 'Дебиторка всего', value: formatMoney(report.debts.receivableTotal) },
                  { label: 'Просроченная дебиторка', value: formatMoney(report.debts.receivableOverdue) },
                  { label: 'Кредиторка всего', value: formatMoney(report.debts.payableTotal) },
                  { label: 'Просроченная кредиторка', value: formatMoney(report.debts.payableOverdue) },
                  { label: 'Нагрузка на оборотный капитал', value: formatMoney(report.debts.netWorkingCapitalExposure) },
                ],
              )}
            </>
          )}
        </>
      )}
    </div>
  );
};
