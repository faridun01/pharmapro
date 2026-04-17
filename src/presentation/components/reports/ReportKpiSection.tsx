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
      description: 'Чистый доход от продаж после вычета всех возвратов. Гросс — общая сумма до вычета возвратов.',
    },
    {
      label: t('reports.grossProfit'),
      value: formatMoney(kpi.grossProfit, currencyCode),
      hint: `${t('reports.margin')}: ${kpi.grossMarginPct.toFixed(1)}%`,
      accent: 'text-emerald-600',
      description: 'Прибыль от продаж после вычета только себестоимости закупки товара (COGS).',
    },
    {
      label: 'Списания (Убытки)',
      value: formatMoney(kpi.writeOffAmount, currencyCode),
      hint: `Налогов списано: ${formatMoney(kpi.taxNet, currencyCode)}`,
      accent: 'text-orange-600',
      description: 'Стоимость товара, который был списан из-за истечения срока годности, порчи или потерь.',
    },
    {
      label: t('reports.inventoryValue'),
      value: formatMoney(data.inventory.retailValue, currencyCode),
      hint: `${t('reports.costBasis')}: ${formatMoney(data.inventory.costValue, currencyCode)}`,
      accent: 'text-blue-600',
      description: 'Общая стоимость товаров на складе в текущих розничных ценах. База — цена закупки.',
    },
    {
      label: 'Операционная прибыль',
      value: formatMoney(kpi.operatingProfit, currencyCode),
      hint: `Маржа: ${kpi.operatingMarginPct.toFixed(1)}%`,
      accent: kpi.operatingProfit >= 0 ? 'text-emerald-600' : 'text-red-600',
      description: 'Итоговая прибыль после вычета себестоимости, списаний и операционных расходов.',
    },
    {
      label: 'Денежный поток',
      value: formatMoney(data.cashflow.net, currencyCode),
      hint: `Входящий: ${formatMoney(data.cashflow.inflow, currencyCode)}`,
      accent: data.cashflow.net >= 0 ? 'text-emerald-600' : 'text-red-600',
      description: 'Разница между всеми реальными приходами и расходами денег (нал/безнал) за период.',
    },
    {
      label: 'Кредиторская задолженность',
      value: formatMoney(data.debts.payableTotal, currencyCode),
      hint: `Просрочено: ${formatMoney(data.debts.payableOverdue, currencyCode)}`,
      accent: 'text-violet-600',
      description: 'Ваш текущий долг перед поставщиками за полученный товар.',
    },
    {
      label: 'Дебиторская задолженность',
      value: formatMoney((data as any).debts.receivableTotal, currencyCode),
      hint: `Просрочено: ${formatMoney((data as any).debts.receivableOverdue, currencyCode)}`,
      accent: 'text-sky-600',
      description: 'Сумма неоплаченных долгов клиентов перед аптекой (отложенные платежи/в долг).',
    },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mb-8">
      {cards.map((card) => (
        <div 
          key={card.label} 
          className="bg-white p-4 rounded-xl shadow-sm border border-slate-100 cursor-help transition-all hover:bg-slate-50"
          title={card.description}
        >
          <p className="text-[10px] font-black text-slate-400 mb-1 uppercase tracking-widest">{card.label}</p>
          <h3 className={`text-xl font-black ${card.accent}`}>{card.value}</h3>
          <p className="text-[10px] text-slate-400 mt-2 font-medium">{card.hint}</p>
        </div>
      ))}
    </div>
  );
};
