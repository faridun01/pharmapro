import React from 'react';
import { useTranslation } from 'react-i18next';
import { FinanceReport } from './types';
import { formatMoney } from './utils';

interface Props {
  data: FinanceReport;
  currencyCode: string;
}

export const ReportKpiSection: React.FC<Props> = ({ data, currencyCode }) => {
  const { t } = useTranslation();
  const kpi = data.kpi;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
      <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
        <p className="text-sm font-medium text-slate-500 mb-1">{t('reports.revenue')}</p>
        <h3 className="text-2xl font-bold text-slate-900">{formatMoney(kpi.netRevenue, currencyCode)}</h3>
        <p className="text-xs text-slate-400 mt-2">
          {t('reports.gross')}: {formatMoney(kpi.revenueGross, currencyCode)}
        </p>
      </div>

      <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
        <p className="text-sm font-medium text-slate-500 mb-1">{t('reports.grossProfit')}</p>
        <h3 className="text-2xl font-bold text-green-600">{formatMoney(kpi.grossProfit, currencyCode)}</h3>
        <div className="flex items-center gap-2 mt-2">
            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-green-50 text-green-700">
              {kpi.grossMarginPct.toFixed(1)}%
            </span>
            <span className="text-xs text-slate-400">{t('reports.margin')}</span>
        </div>
      </div>

      <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
        <p className="text-sm font-medium text-slate-500 mb-1">{t('reports.receivables')}</p>
        <h3 className="text-2xl font-bold text-orange-600">{formatMoney(data.debts.receivableTotal, currencyCode)}</h3>
        <p className="text-xs text-slate-400 mt-2">
          {t('reports.overdue')}: {formatMoney(data.debts.receivableOverdue, currencyCode)}
        </p>
      </div>

      <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
        <p className="text-sm font-medium text-slate-500 mb-1">{t('reports.inventoryValue')}</p>
        <h3 className="text-2xl font-bold text-blue-600">{formatMoney(data.inventory.retailValue, currencyCode)}</h3>
        <p className="text-xs text-slate-400 mt-2">
          {t('reports.costBasis')}: {formatMoney(data.inventory.costValue, currencyCode)}
        </p>
      </div>
    </div>
  );
};
