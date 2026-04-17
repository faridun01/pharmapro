import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Calendar, FileDown, FileSpreadsheet, AlertCircle, Eye, Printer, Filter, ChartBar, TrendingUp, Inbox, RefreshCw } from 'lucide-react';
import { buildApiHeaders } from '../../infrastructure/api';
import { useCurrencyCode } from '../../lib/useCurrencyCode';

// Modular Components
import { FinanceReport, ReportRangePreset, ReportViewMode, presetLabels } from './reports/types';
import { normalizeReport } from './reports/utils';
import { ReportKpiSection } from './reports/ReportKpiSection';
import { ReportInventorySection } from './reports/ReportInventorySection';
import { ReportDetailedView } from './reports/ReportDetailedView';
import { ReportExpirySection } from './reports/ReportExpirySection';
import { exportReportToXlsx } from './reports/ExportUtils';

const formatMoney = (amount: number, currency = 'TJS') => {
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: currency,
    minimumFractionDigits: 0,
  }).format(amount);
};

export const ReportsView: React.FC = () => {
  const { t } = useTranslation();
  const currencyCode = useCurrencyCode();

  // State
  const [report, setReport] = useState<FinanceReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [viewMode, setViewMode] = useState<ReportViewMode>('summary');
  const [preset, setPreset] = useState<ReportRangePreset>('month');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const loadReport = useCallback(async (
    targetPreset: ReportRangePreset,
    from: string,
    to: string,
    mode: ReportViewMode = viewMode
  ) => {
    if (mode === 'expiry') return; // Expiry handled in its own section
    setLoading(true);
    setError(null);
    try {
      const q = new URLSearchParams();
      q.set('preset', targetPreset);
      if (from) q.set('from', from);
      if (to) q.set('to', to);
      q.set('mode', mode);

      const headers = await buildApiHeaders();
      const resp = await fetch(`/api/reports/finance?${q.toString()}`, {
        headers,
      });

      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}));
        throw new Error(errData.message || 'Failed to fetch report data');
      }

      const raw = await resp.json();
      setReport(normalizeReport(raw, targetPreset));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [viewMode]);

  useEffect(() => {
    void loadReport(preset, fromDate, toDate);
  }, [loadReport, preset, fromDate, toDate]);

  const handleExportXlsx = async () => {
    if (!report && viewMode !== 'expiry') return;
    setExporting(true);
    try {
      if (viewMode === 'expiry') {
        // Specialized export for expiry could be handled here or inside component
        // For now let's use the generic logic or just bypass if not implemented
        alert('Excel export for Expiry Report coming soon!');
      } else {
        await exportReportToXlsx(report!, viewMode);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setExporting(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="max-w-[1600px] mx-auto space-y-8 animate-in fade-in duration-700 pb-20 outline-none ring-0">

      {/* Header Info Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Чистая выручка', val: report ? formatMoney(report.kpi.netRevenue, currencyCode) : '...', sub: 'За выбранный период', color: 'text-[#5A5A40]', icon: TrendingUp },
          { label: 'Валовая прибыль', val: report ? formatMoney(report.kpi.grossProfit, currencyCode) : '...', sub: 'До вычета расходов', color: 'text-emerald-600', icon: ChartBar },
          { label: 'Продаж совершено', val: report ? report.invoices.totalCount : '...', sub: 'Всего транзакций', color: 'text-[#5A5A40]', icon: Inbox },
          { label: 'Рентабельность', val: report && report.kpi.netRevenue ? `${((report.kpi.grossProfit / report.kpi.netRevenue) * 100).toFixed(1)}%` : '...', sub: 'Маржинальность', color: 'text-indigo-600', icon: FileDown },
        ].map((card, idx) => (
          <div key={idx} className="bg-white/40 border border-[#5A5A40]/5 rounded-[2rem] p-6 shadow-sm hover:shadow-xl transition-all group">
            <div className="flex justify-between items-start mb-4">
              <p className="text-[10px] font-normal text-[#5A5A40]/40 uppercase tracking-[0.2em]">{card.label}</p>
              <card.icon size={16} className={`${card.color} opacity-30`} />
            </div>
            <p className={`text-2xl font-normal ${card.color} tracking-tight`}>{card.val}</p>
            <p className="text-[10px] font-normal text-[#5A5A40]/30 mt-2 italic">{card.sub}</p>
          </div>
        ))}
      </div>

      {/* Control Bar */}
      <div className="bg-white/80 backdrop-blur-md rounded-[2.5rem] border border-white/70 p-4 shadow-sm flex flex-col xl:flex-row xl:items-center justify-between gap-6">
        <div className="flex items-center gap-4 px-2">
          <div className="w-12 h-12 rounded-[1.2rem] bg-[#5A5A40] text-white flex items-center justify-center shadow-lg shadow-[#5A5A40]/20">
            <ChartBar size={24} />
          </div>
          <div>
            <h4 className="text-lg font-normal text-[#151619] leading-tight">Аналитика и отчеты</h4>
            <p className="text-[10px] text-[#5A5A40]/50 uppercase tracking-widest mt-0.5 font-normal italic">Финансовый мониторинг предприятия</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* View Toggle */}
          <div className="bg-[#f5f5f0]/50 p-1.5 rounded-[1.5rem] border border-[#5A5A40]/5 flex gap-1">
            <button
              onClick={() => setViewMode('summary')}
              className={`px-5 py-2.5 rounded-[1.2rem] text-[11px] uppercase tracking-widest transition-all font-normal ${viewMode === 'summary' ? 'bg-[#5A5A40] shadow-md text-white' : 'text-[#5A5A40]/40 hover:text-[#5A5A40]'}`}
            >
              Сводка
            </button>
            <button
              onClick={() => setViewMode('detailed')}
              className={`px-5 py-2.5 rounded-[1.2rem] text-[11px] uppercase tracking-widest transition-all font-normal ${viewMode === 'detailed' ? 'bg-[#5A5A40] shadow-md text-white' : 'text-[#5A5A40]/40 hover:text-[#5A5A40]'}`}
            >
              Детально
            </button>
            <button
              onClick={() => setViewMode('expiry')}
              className={`px-5 py-2.5 rounded-[1.2rem] text-[11px] uppercase tracking-widest transition-all font-normal ${viewMode === 'expiry' ? 'bg-[#5A5A40] shadow-md text-white' : 'text-[#5A5A40]/40 hover:text-[#5A5A40]'}`}
            >
              Сроки годности
            </button>
          </div>

          <div className="h-8 w-px bg-[#5A5A40]/10 mx-2" />

          {/* Export Actions */}
          <div className="flex items-center gap-2">
            <button
              onClick={handlePrint}
              disabled={!report && viewMode !== 'expiry'}
              className="w-11 h-11 flex items-center justify-center rounded-2xl border border-[#5A5A40]/10 text-[#5A5A40]/40 hover:bg-white hover:text-[#5A5A40] transition-all disabled:opacity-30"
              title="Печать"
            >
              <Printer size={18} />
            </button>
            <button
              onClick={handleExportXlsx}
              disabled={(!report && viewMode !== 'expiry') || exporting}
              className="flex items-center gap-2 px-6 py-3 rounded-2xl bg-[#5A5A40] text-white text-[11px] uppercase tracking-widest font-normal shadow-lg shadow-[#5A5A40]/10 hover:bg-[#4A4A30] active:scale-95 transition-all disabled:opacity-30"
            >
              {exporting ? <RefreshCw size={14} className="animate-spin" /> : <FileSpreadsheet size={16} />}
              <span>Экспорт XLSX</span>
            </button>
          </div>
        </div>
      </div>

      {/* Date Presets and Filters */}
      <div className="bg-white/40 p-4 rounded-[2rem] border border-[#5A5A40]/5 flex flex-wrap items-center justify-between gap-6">
        <div className="flex flex-wrap gap-1.5 p-1 bg-[#f5f5f0]/30 rounded-[1.5rem]">
          {(['month', 'q1', 'q2', 'q3', 'q4', 'year', 'all'] as ReportRangePreset[]).map((p) => (
            <button
              key={p}
              onClick={() => { setPreset(p); setFromDate(''); setToDate(''); }}
              className={`px-5 py-2 rounded-[1.2rem] text-[10px] font-bold uppercase transition-all tracking-wider ${preset === p ? 'bg-white text-[#5A5A40] shadow-sm border border-[#5A5A40]/5' : 'text-[#5A5A40]/40 hover:text-[#5A5A40]'}`}
            >
              {presetLabels[p]}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3 bg-white/60 px-6 py-2.5 rounded-[1.5rem] border border-[#5A5A40]/5 ml-auto">
          <Filter size={14} className="text-[#5A5A40]/30" />
          <div className="flex items-center gap-4">
            <input
              type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)}
              className="bg-transparent border-none text-[11px] font-bold uppercase tracking-widest focus:ring-0 p-0 text-[#5A5A40] outline-none"
            />
            <span className="text-[#5A5A40]/20">—</span>
            <input
              type="date" value={toDate} onChange={(e) => setToDate(e.target.value)}
              className="bg-transparent border-none text-[11px] font-bold uppercase tracking-widest focus:ring-0 p-0 text-[#5A5A40] outline-none"
            />
          </div>
        </div>
      </div>

      {/* Error State */}
      {error && (
        <div className="bg-rose-50 border border-rose-100 rounded-[2rem] p-5 flex items-center gap-3 text-rose-700 animate-in slide-in-from-top-2 shadow-sm">
          <AlertCircle size={20} />
          <p className="text-xs font-bold uppercase tracking-widest">{error}</p>
        </div>
      )}

      {/* Main Content */}
      <div className="relative">
        {loading && viewMode !== 'expiry' ? (
          <div className="flex flex-col items-center justify-center py-32 bg-white/30 rounded-[3rem] border border-dashed border-[#5A5A40]/10">
            <div className="w-12 h-12 border-[3px] border-[#5A5A40]/10 border-t-[#5A5A40] rounded-full animate-spin mb-6" />
            <p className="text-[#5A5A40]/40 text-[10px] uppercase tracking-[0.3em] font-normal animate-pulse">Генерация аналитики...</p>
          </div>
        ) : viewMode === 'expiry' ? (
          <ReportExpirySection />
        ) : report ? (
          <div className="space-y-12 animate-in fade-in slide-in-from-bottom-6 duration-700 print:space-y-4">
            {viewMode === 'summary' ? (
              <div className="space-y-12">
                <ReportKpiSection data={report} currencyCode={currencyCode} />
                <div className="bg-white rounded-[3rem] p-10 border border-[#5A5A40]/5 shadow-sm">
                  <ReportInventorySection data={report} currencyCode={currencyCode} />
                </div>
              </div>
            ) : (
              <div className="bg-white rounded-[3rem] p-10 border border-[#5A5A40]/5 shadow-sm">
                <ReportDetailedView data={report} currencyCode={currencyCode} />
              </div>
            )}
          </div>
        ) : (
          <div className="text-center py-32 bg-white/20 rounded-[3rem] border border-dashed border-[#5A5A40]/10">
            <ChartBar size={48} className="mx-auto text-[#5A5A40]/10 mb-6" />
            <p className="text-[10px] uppercase tracking-widest text-[#5A5A40]/30 italic">Данные для отчета не найдены</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default ReportsView;
