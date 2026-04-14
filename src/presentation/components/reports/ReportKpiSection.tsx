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
  const cards = [
    {
      label: t('reports.revenue'),
      value: formatMoney(kpi.netRevenue, currencyCode),
      hint: `${t('reports.gross')}: ${formatMoney(kpi.revenueGross, currencyCode)}`,
      accent: 'text-slate-900',
    },
    {
      label: t('reports.grossProfit'),
      value: formatMoney(kpi.grossProfit, currencyCode),
      hint: `${t('reports.margin')}: ${kpi.grossMarginPct.toFixed(1)}%`,
      accent: 'text-emerald-600',
    },
    {
      label: t('reports.receivables'),
      value: formatMoney(data.debts.receivableTotal, currencyCode),
      hint: `${t('reports.overdue')}: ${formatMoney(data.debts.receivableOverdue, currencyCode)}`,
      accent: 'text-orange-600',
    },
    {
      label: t('reports.inventoryValue'),
      value: formatMoney(data.inventory.retailValue, currencyCode),
      hint: `${t('reports.costBasis')}: ${formatMoney(data.inventory.costValue, currencyCode)}`,
      accent: 'text-blue-600',
    },
    {
      label: 'Операционная прибыль',
      value: formatMoney(kpi.operatingProfit, currencyCode),
      hint: `Маржа: ${kpi.operatingMarginPct.toFixed(1)}%`,
      accent: kpi.operatingProfit >= 0 ? 'text-emerald-600' : 'text-red-600',
    },
    {
      label: 'Средний чек',
      value: formatMoney(data.invoices.avgTicket, currencyCode),
      hint: `Продаж: ${data.invoices.totalCount}`,
      accent: 'text-slate-900',
    },
    {
      label: 'Денежный поток',
      value: formatMoney(data.cashflow.net, currencyCode),
      hint: `Входящий: ${formatMoney(data.cashflow.inflow, currencyCode)}`,
      accent: data.cashflow.net >= 0 ? 'text-emerald-600' : 'text-red-600',
    },
    {
      label: 'Кредиторская задолженность',
      value: formatMoney(data.debts.payableTotal, currencyCode),
      hint: `Просрочено: ${formatMoney(data.debts.payableOverdue, currencyCode)}`,
      accent: 'text-violet-600',
    },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mb-8">
      {cards.map((card) => (
        <div key={card.label} className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
          <p className="text-sm font-medium text-slate-500 mb-1">{card.label}</p>
          <h3 className={`text-2xl font-bold ${card.accent}`}>{card.value}</h3>
          <p className="text-xs text-slate-400 mt-2">{card.hint}</p>
        </div>
      ))}
    </div>
  );
};
