import React from 'react';
import { useTranslation } from 'react-i18next';
import { FinanceReport } from './types';
import { formatMoney } from './utils';

interface Props {
  data: FinanceReport;
  currencyCode: string;
}

export const ReportDetailedView: React.FC<Props> = ({ data, currencyCode }) => {
  const { t } = useTranslation();
  const sales = data?.currentMonthSales || { productTotals: [], saleDetails: [], from: new Date().toISOString(), to: new Date().toISOString() };
  const topProducts = (sales?.productTotals || []).slice(0, 10);

  return (
    <div className="space-y-6">
      <div className="bg-emerald-50 border border-emerald-100 rounded-2xl px-4 py-3 text-sm text-emerald-800">
        {new Date(sales.from).toLocaleDateString('ru-RU')} - {new Date(sales.to).toLocaleDateString('ru-RU')}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm">
          <p className="text-xs uppercase font-semibold text-slate-400 mb-1">{t('reports.totalSales')}</p>
          <p className="text-xl font-bold text-slate-900">{sales.saleDetails?.length || 0}</p>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm">
          <p className="text-xs uppercase font-semibold text-slate-400 mb-1">{t('reports.revenue')}</p>
          <p className="text-xl font-bold text-slate-900">
            {formatMoney((sales.saleDetails || []).reduce((sum, s) => sum + s.totalAmount, 0), currencyCode)}
          </p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50">
          <h3 className="font-semibold text-slate-800">Топ товаров за период</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50/50 text-slate-500">
              <tr>
                <th className="px-6 py-3 text-left font-semibold uppercase tracking-wider text-xs">{t('reports.product')}</th>
                <th className="px-6 py-3 text-right font-semibold uppercase tracking-wider text-xs">Продано</th>
                <th className="px-6 py-3 text-right font-semibold uppercase tracking-wider text-xs">Продаж</th>
                <th className="px-6 py-3 text-right font-semibold uppercase tracking-wider text-xs">{t('reports.revenue')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {topProducts.map((product) => (
                <tr key={product.productId}>
                  <td className="px-6 py-4">
                    <div className="font-medium text-slate-900">{product.name}</div>
                    <div className="text-xs text-slate-400">{product.sku}</div>
                  </td>
                  <td className="px-6 py-4 text-right text-slate-700">{product.soldUnits}</td>
                  <td className="px-6 py-4 text-right text-slate-700">{product.salesCount}</td>
                  <td className="px-6 py-4 text-right font-semibold text-slate-900">{formatMoney(product.revenue, currencyCode)}</td>
                </tr>
              ))}
              {topProducts.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-6 py-8 text-center text-slate-400">Нет продаж за выбранный период</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
};
