import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Calendar, FileDown, FileSpreadsheet, AlertCircle, Eye, Printer, Filter } from 'lucide-react';
import { buildApiHeaders } from '../../infrastructure/api';
import { useCurrencyCode } from '../../lib/useCurrencyCode';

// Modular Components
import { FinanceReport, ReportRangePreset, ReportViewMode, presetLabels } from './reports/types';
import { normalizeReport, formatMoney } from './reports/utils';
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
        let errText = '';
        let errJson = undefined;
        try {
          errText = await resp.text();
          errJson = JSON.parse(errText);
        } catch {}
        setError(
          `Ошибка загрузки отчета: status=${resp.status} ${resp.statusText}\n` +
          (errJson?.message ? `message: ${errJson.message}\n` : '') +
          (errText ? `response: ${errText}` : t('errors.fetchFailed'))
        );
        return;
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
    if (!report) return;

    const displayFrom = new Date(report.range.from).toLocaleDateString();
    const displayTo = new Date(report.range.to).toLocaleDateString();
    const kpi = report.kpi;
    const printHtml = `
      <html>
        <head>
          <title>ФИНАНСОВЫЙ ОТЧЕТ — ${presetLabels[report.range.preset]}</title>
          <style>
            @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap');
            
            body { 
              font-family: 'Inter', -apple-system, sans-serif; 
              padding: 0; 
              margin: 0; 
              background: #f8fafc; 
              color: #0f172a; 
              line-height: 1.5;
            }
            
            .preview-container {
              display: flex;
              flex-direction: column;
              align-items: center;
              padding: 40px 20px;
            }

            .sheet { 
              width: 210mm;
              min-height: 297mm;
              background: #fff; 
              padding: 25mm; 
              box-shadow: 0 25px 50px -12px rgba(0,0,0,0.1);
              box-sizing: border-box;
              position: relative;
            }

            .header { 
              border-bottom: 2px solid #f1f5f9; 
              padding-bottom: 30px; 
              margin-bottom: 40px; 
              display: flex;
              justify-content: space-between;
              align-items: flex-end;
            }
            
            .brand {
              display: flex;
              align-items: center;
              gap: 12px;
            }
            
            .brand-line {
              width: 4px;
              height: 40px;
              background: #2563eb;
              border-radius: 2px;
            }

            .title-group h1 { 
              font-size: 28px; 
              font-weight: 800; 
              text-transform: uppercase; 
              letter-spacing: -0.02em; 
              margin: 0; 
              color: #1e293b;
            }
            
            .period-badge {
              display: inline-block;
              padding: 4px 12px;
              background: #eff6ff;
              color: #2563eb;
              border-radius: 6px;
              font-size: 11px;
              font-weight: 700;
              margin-top: 8px;
              text-transform: uppercase;
              letter-spacing: 0.05em;
            }

            .timestamp { 
              text-align: right;
              color: #64748b; 
              font-size: 12px; 
              font-weight: 500;
            }

            .kpi-grid { 
              display: grid; 
              grid-template-columns: repeat(2, 1fr); 
              gap: 24px; 
              margin-bottom: 50px; 
            }
            
            .kpi-card { 
              padding: 24px; 
              background: #fdfdfd;
              border: 1px solid #f1f5f9; 
              border-radius: 16px; 
            }
            
            .kpi-label { 
              font-size: 10px; 
              font-weight: 700; 
              color: #64748b; 
              text-transform: uppercase; 
              letter-spacing: 0.1em; 
              margin-bottom: 12px; 
            }
            
            .kpi-value { 
              font-size: 24px; 
              font-weight: 700; 
              color: #0f172a;
              margin-bottom: 6px; 
            }
            
            .kpi-hint { 
              font-size: 11px; 
              color: #94a3b8; 
            }

            .section-title { 
              font-size: 12px; 
              font-weight: 700; 
              text-transform: uppercase; 
              letter-spacing: 0.1em; 
              margin: 40px 0 20px; 
              color: #2563eb; 
              display: flex;
              align-items: center;
              gap: 10px;
            }
            
            .section-title::after {
              content: '';
              flex: 1;
              height: 1px;
              background: #e2e8f0;
            }

            table { 
              width: 100%; 
              border-collapse: collapse; 
            }
            
            thead th { 
              text-align: left; 
              padding: 12px 16px; 
              font-size: 10px; 
              font-weight: 700; 
              color: #64748b; 
              text-transform: uppercase; 
              background: #f8fafc;
              border-bottom: 1px solid #e2e8f0;
            }
            
            tbody td { 
              padding: 16px; 
              font-size: 13px; 
              border-bottom: 1px solid #f1f5f9; 
              color: #334155;
            }
            
            .right { text-align: right; }
            .font-mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }

            .print-btn {
              position: fixed; top: 20px; right: 20px; padding: 12px 32px;
              background: #2563eb; color: white; border: none; border-radius: 12px;
              cursor: pointer; font-weight: 700; font-size: 14px;
              box-shadow: 0 20px 25px -5px rgba(37,99,235,0.2); 
              z-index: 1000;
              transition: all 0.2s;
              display: flex;
              align-items: center;
              gap: 8px;
            }
            .print-btn:hover { background: #1d4ed8; transform: translateY(-1px); }
            
            @media print { 
              body { background: white; }
              .preview-container { padding: 0; }
              .sheet { box-shadow: none; border-radius: 0; width: 100%; padding: 0; }
              .print-btn { display: none; }
            }
          </style>
        </head>
        <body>
          <div class="preview-container">
            <button class="print-btn" onclick="window.print()">
              Печатать отчет
            </button>
            <div class="sheet">
              <div class="header">
                <div class="brand">
                  <div class="brand-line"></div>
                  <div class="title-group">
                    <h1>ФИНАНСОВЫЙ ОТЧЕТ</h1>
                    <div class="period-badge">${presetLabels[report.range.preset]}</div>
                  </div>
                </div>
                <div class="timestamp">
                  Период: <b>${displayFrom} — ${displayTo}</b><br/>
                  Сформирован: ${new Date().toLocaleString('ru-RU')}
                </div>
              </div>

              <div class="kpi-grid">
                <div class="kpi-card">
                  <div class="kpi-label">Чистая выручка</div>
                  <div class="kpi-value">${formatMoney(kpi.netRevenue, currencyCode)}</div>
                  <div class="kpi-hint">Валовая: ${formatMoney(kpi.revenueGross, currencyCode)}</div>
                </div>
                <div class="kpi-card">
                  <div class="kpi-label">Валовая прибыль</div>
                  <div class="kpi-value">${formatMoney(kpi.grossProfit, currencyCode)}</div>
                  <div class="kpi-hint">Рентабельность: ${kpi.grossMarginPct.toFixed(1)}%</div>
                </div>
                <div class="kpi-card">
                  <div class="kpi-label">Операционная прибыль</div>
                  <div class="kpi-value" style="color: #059669;">${formatMoney(kpi.operatingProfit, currencyCode)}</div>
                  <div class="kpi-hint">После вычета расходов и списаний</div>
                </div>
                <div class="kpi-card">
                  <div class="kpi-label">Денежный поток (Net)</div>
                  <div class="kpi-value">${formatMoney(report.cashflow.net, currencyCode)}</div>
                  <div class="kpi-hint">Входящий: ${formatMoney(report.cashflow.inflow, currencyCode)}</div>
                </div>
              </div>

              <div class="section-title">Активы и Обязательства</div>
              <table>
                <thead>
                  <tr>
                    <th>Финансовый показатель</th>
                    <th class="right">Сумма (${currencyCode})</th>
                  </tr>
                </thead>
                <tbody>
                  <tr><td>Товарные запасы (Рыночная стоимость)</td><td class="right font-mono">${formatMoney(report.inventory.retailValue, currencyCode)}</td></tr>
                  <tr><td>Товарные запасы (Себестоимость)</td><td class="right font-mono">${formatMoney(report.inventory.costValue, currencyCode)}</td></tr>
                  <tr><td>Дебиторская задолженность (Нам должны)</td><td class="right font-mono">${formatMoney(report.debts.receivableTotal, currencyCode)}</td></tr>
                  <tr><td>Кредиторская задолженность (Мы должны)</td><td class="right font-mono" style="color: #dc2626;">${formatMoney(report.debts.payableTotal, currencyCode)}</td></tr>
                </tbody>
              </table>

              <div class="section-title">Расходы и Списания</div>
              <table>
                 <thead>
                  <tr>
                    <th>Статья расходов</th>
                    <th class="right">Сумма (${currencyCode})</th>
                  </tr>
                </thead>
                <tbody>
                  <tr><td>Общие операционные расходы</td><td class="right font-mono">${formatMoney(kpi.expenseTotal, currencyCode)}</td></tr>
                  <tr><td>Списания и убытки по товарам</td><td class="right font-mono">${formatMoney(kpi.writeOffAmount, currencyCode)}</td></tr>
                  <tr><td>Налоги и сборы (Чистый остаток)</td><td class="right font-mono">${formatMoney(kpi.taxNet, currencyCode)}</td></tr>
                </tbody>
              </table>

              <div style="margin-top: 60px; border-top: 1px solid #f1f5f9; padding-top: 20px; font-size: 10px; color: #94a3b8; text-align: center;">
                PharmaPro POS — Автоматизированная система финансового контроля
              </div>
            </div>
          </div>
        </body>
      </html>
    `;

    const win = window.open('', '_blank');
    if (win) {
      win.document.write(printHtml);
      win.document.close();
    }
  };

  return (
    <div className="max-w-400 mx-auto p-4 md:p-6 space-y-6 animate-in fade-in duration-500">
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
        <div className="bg-red-50 border border-red-100 rounded-2xl p-4 flex items-start gap-3 text-red-700 animate-in slide-in-from-top-2">
          <AlertCircle size={20} />
          <pre className="text-xs font-mono whitespace-pre-wrap">{error}</pre>
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
