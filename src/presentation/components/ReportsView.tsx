import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Calendar, FileDown, FileSpreadsheet, AlertCircle, Eye, Printer, Filter } from 'lucide-react';
import { buildApiHeaders } from '../../infrastructure/api';
import { useCurrencyCode } from '../../lib/useCurrencyCode';

// Modular Components
import { FinanceReport, ReportRangePreset, ReportViewMode, presetLabels } from './reports/types';
import { normalizeReport } from './reports/utils';
import { ReportKpiSection } from './reports/ReportKpiSection';
import { ReportInventorySection } from './reports/ReportInventorySection';
import { ReportDetailedView } from './reports/ReportDetailedView';
import { exportReportToXlsx } from './reports/ExportUtils';

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
        throw new Error(errData.message || t('errors.fetchFailed'));
      }

      const raw = await resp.json();
      setReport(normalizeReport(raw, targetPreset));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [t, viewMode]);

  useEffect(() => {
    void loadReport(preset, fromDate, toDate);
  }, [loadReport, preset, fromDate, toDate]);

  const handleExportXlsx = async () => {
    if (!report) return;
    setExporting(true);
    try {
      await exportReportToXlsx(report, viewMode);
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
    <div className="max-w-[1600px] mx-auto p-4 md:p-6 space-y-6 animate-in fade-in duration-500">
      {/* Header & Controls */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-4 md:p-6">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">{t('reports.title')}</h1>
            <p className="text-slate-500 text-sm mt-1">{t('reports.subtitle')}</p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="bg-slate-50 p-1 rounded-xl border border-slate-200 flex">
              <button
                onClick={() => setViewMode('summary')}
                className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${viewMode === 'summary' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-500 hover:text-slate-700'}`}
              >
                {t('reports.viewSummary')}
              </button>
              <button
                onClick={() => setViewMode('detailed')}
                className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${viewMode === 'detailed' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-500 hover:text-slate-700'}`}
              >
                {t('reports.viewDetailed')}
              </button>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handlePrint}
                disabled={!report}
                className="p-2.5 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition-colors"
                title={t('common.print')}
              >
                <Printer size={18} />
              </button>
              <button
                onClick={handleExportXlsx}
                disabled={!report || exporting}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-200 text-slate-700 font-semibold hover:bg-slate-50 disabled:opacity-50 transition-colors"
              >
                <FileSpreadsheet size={18} className="text-emerald-500" />
                <span className="text-sm">XLSX</span>
              </button>
            </div>
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-slate-100 flex flex-wrap items-center gap-4">
          <div className="flex flex-wrap gap-2">
            {(['month', 'q1', 'q2', 'q3', 'q4', 'year', 'all'] as ReportRangePreset[]).map((p) => (
              <button
                key={p}
                onClick={() => {
                  setPreset(p);
                  setFromDate('');
                  setToDate('');
                }}
                className={`px-4 py-2 rounded-xl text-xs font-bold transition-all border ${preset === p ? 'bg-blue-600 border-blue-600 text-white shadow-md shadow-blue-100' : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'}`}
              >
                {presetLabels[p]}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-3 bg-slate-50 px-4 py-2 rounded-xl border border-slate-100 ml-auto">
            <Filter size={14} className="text-slate-400" />
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="bg-transparent border-none text-xs font-medium focus:ring-0 p-0 text-slate-600"
              />
              <span className="text-slate-300">—</span>
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="bg-transparent border-none text-xs font-medium focus:ring-0 p-0 text-slate-600"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Error State */}
      {error && (
        <div className="bg-red-50 border border-red-100 rounded-2xl p-4 flex items-center gap-3 text-red-700 animate-in slide-in-from-top-2">
          <AlertCircle size={20} />
          <p className="text-sm font-medium">{error}</p>
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 bg-white/50 rounded-3xl border border-dashed border-slate-200">
           <div className="w-10 h-10 border-4 border-blue-600/20 border-t-blue-600 rounded-full animate-spin mb-4" />
           <p className="text-slate-500 font-medium">{t('reports.loading')}</p>
        </div>
      ) : report ? (
        <div className="space-y-8 print:space-y-4">
          {viewMode === 'summary' ? (
            <>
              <ReportKpiSection data={report} currencyCode={currencyCode} />
              <ReportInventorySection data={report} currencyCode={currencyCode} />
            </>
          ) : (
            <ReportDetailedView data={report} currencyCode={currencyCode} />
          )}
        </div>
      ) : (
        <div className="text-center py-20 text-slate-400">
          <p>{t('reports.noData')}</p>
        </div>
      )}
    </div>
  );
};

// remove default export
