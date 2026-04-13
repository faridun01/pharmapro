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
  const sales = data.currentMonthSales;

  return (
    <div className="space-y-6">
      <div className="bg-emerald-50 border border-emerald-100 rounded-2xl px-4 py-3 text-sm text-emerald-800">
        {new Date(sales.from).toLocaleDateString('ru-RU')} - {new Date(sales.to).toLocaleDateString('ru-RU')}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm">
          <p className="text-xs uppercase font-semibold text-slate-400 mb-1">{t('reports.totalSales')}</p>
          <p className="text-xl font-bold text-slate-900">{sales.saleDetails.length}</p>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm">
          <p className="text-xs uppercase font-semibold text-slate-400 mb-1">{t('reports.revenue')}</p>
          <p className="text-xl font-bold text-slate-900">
            {formatMoney(sales.saleDetails.reduce((sum, s) => sum + s.totalAmount, 0), currencyCode)}
          </p>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm">
          <p className="text-xs uppercase font-semibold text-slate-400 mb-1">{t('reports.paid')}</p>
          <p className="text-xl font-bold text-emerald-600">
            {formatMoney(sales.saleDetails.reduce((sum, s) => sum + s.paidAmount, 0), currencyCode)}
          </p>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm">
          <p className="text-xs uppercase font-semibold text-slate-400 mb-1">{t('reports.outstanding')}</p>
          <p className="text-xl font-bold text-orange-600">
            {formatMoney(sales.saleDetails.reduce((sum, s) => sum + s.outstandingAmount, 0), currencyCode)}
          </p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50">
          <h3 className="font-semibold text-slate-800">{t('reports.saleDetails')}</h3>
        </div>
        <div className="divide-y divide-slate-100">
          {sales.saleDetails.map((sale) => (
            <div key={sale.invoiceId} className="p-4 hover:bg-slate-50 transition-colors">
              <div className="flex justify-between items-start mb-2">
                <div>
                  <span className="font-bold text-slate-900">{sale.invoiceNo}</span>
                  <span className="mx-2 text-slate-300">|</span>
                  <span className="text-sm text-slate-500">{sale.customer}</span>
                </div>
                <div className="text-xs font-medium text-slate-400">
                  {new Date(sale.createdAt).toLocaleString('ru-RU')}
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm mb-3">
                <div>
                  <p className="text-slate-400 text-xs">{t('reports.total')}</p>
                  <p className="font-medium">{formatMoney(sale.totalAmount, currencyCode)}</p>
                </div>
                <div>
                  <p className="text-slate-400 text-xs">{t('reports.paid')}</p>
                  <p className="font-medium text-emerald-600">{formatMoney(sale.paidAmount, currencyCode)}</p>
                </div>
                <div>
                  <p className="text-slate-400 text-xs">{t('reports.outstanding')}</p>
                  <p className={`font-medium ${sale.outstandingAmount > 0 ? 'text-orange-600' : 'text-slate-900'}`}>
                    {formatMoney(sale.outstandingAmount, currencyCode)}
                  </p>
                </div>
                <div>
                  <p className="text-slate-400 text-xs">{t('reports.paymentType')}</p>
                  <p className="font-medium text-slate-600">{sale.paymentType}</p>
                </div>
              </div>
              <div className="bg-slate-50 rounded-lg p-3">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-slate-400 text-left border-b border-slate-200">
                      <th className="pb-2 font-normal">{t('reports.product')}</th>
                      <th className="pb-2 font-normal text-right">{t('reports.quantity')}</th>
                      <th className="pb-2 font-normal text-right">{t('reports.price')}</th>
                      <th className="pb-2 font-normal text-right">{t('reports.total')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {sale.items.map((item, idx) => (
                      <tr key={`${sale.invoiceId}-${idx}`}>
                        <td className="py-2 text-slate-700">{item.productName}</td>
                        <td className="py-2 text-right">{item.quantity}</td>
                        <td className="py-2 text-right">{formatMoney(item.unitPrice, currencyCode)}</td>
                        <td className="py-2 text-right font-medium">{formatMoney(item.lineTotal, currencyCode)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
