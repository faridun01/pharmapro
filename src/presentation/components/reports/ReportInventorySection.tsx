import React from 'react';
import { useTranslation } from 'react-i18next';
import { FinanceReport } from './types';
import { formatMoney } from './utils';

interface Props {
  data: FinanceReport;
  currencyCode: string;
}

export const ReportInventorySection: React.FC<Props> = ({ data, currencyCode }) => {
  const { t } = useTranslation();
  const inventory = data.inventory;

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden mb-8">
      <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
        <h3 className="font-semibold text-slate-800">{t('reports.inventoryPerformance')}</h3>
        <span className="text-xs font-medium px-2 py-1 rounded bg-blue-50 text-blue-700">
            {inventory.details.length} {t('reports.activeItems')}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-50/50">
              <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">{t('reports.product')}</th>
              <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider text-right">{t('reports.stock')}</th>
              <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider text-right">{t('reports.sold')}</th>
              <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider text-right">{t('reports.costValue')}</th>
              <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider text-right">{t('reports.retailValue')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {inventory.details.map((row) => (
              <tr key={row.productId} className="hover:bg-slate-50 transition-colors">
                <td className="px-6 py-4">
                  <div className="text-sm font-medium text-slate-900">{row.name}</div>
                  <div className="text-xs text-slate-400">{row.sku}</div>
                </td>
                <td className="px-6 py-4 text-right text-sm text-slate-600">{row.totalStock}</td>
                <td className="px-6 py-4 text-right text-sm text-slate-600">{row.soldUnits}</td>
                <td className="px-6 py-4 text-right text-sm text-slate-600">{formatMoney(row.costValue, currencyCode)}</td>
                <td className="px-6 py-4 text-right text-sm font-semibold text-slate-900">{formatMoney(row.retailValue, currencyCode)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
