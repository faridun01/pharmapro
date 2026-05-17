import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FinanceReport } from './types';
import { formatMoney } from './utils';

interface Props {
  data: FinanceReport;
  currencyCode: string;
}

export const ReportInventorySection: React.FC<Props> = ({ data, currencyCode }) => {
  const { t } = useTranslation();
  const inventory = data?.inventory || { details: [], costValue: 0, retailValue: 0, unrealizedMargin: 0 };
  const totalSoldUnits = (inventory.details || []).reduce((sum, row) => sum + row.soldUnits, 0);
  const totalReturnedUnits = (inventory.details || []).reduce((sum, row) => sum + row.returnedUnits, 0);
  const totalWriteOffUnits = (inventory.details || []).reduce((sum, row) => sum + row.writeOffUnits, 0);

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 15;
  const totalItems = inventory.details?.length || 0;
  const totalPages = Math.ceil(totalItems / pageSize);
  const pagedItems = (inventory.details || []).slice((currentPage - 1) * pageSize, currentPage * pageSize);

  return (
    <div className="space-y-4 mb-8">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-[#5A5A40]/10 p-5">
          <p className="text-xs uppercase tracking-wider text-slate-500 font-semibold">Товаров в отчете</p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{inventory.details?.length || 0}</p>
        </div>
        <div className="bg-white rounded-xl border border-[#5A5A40]/10 p-5">
          <p className="text-xs uppercase tracking-wider text-slate-500 font-semibold">Продано / возвращено</p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{totalSoldUnits} / {totalReturnedUnits}</p>
        </div>
        <div className="bg-white rounded-xl border border-[#5A5A40]/10 p-5">
          <p className="text-xs uppercase tracking-wider text-slate-500 font-semibold">Списано / нереализованная маржа</p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{totalWriteOffUnits} / {formatMoney(inventory.unrealizedMargin, currencyCode)}</p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-[#5A5A40]/10 overflow-hidden">
        <div className="px-6 py-4 border-b border-[#5A5A40]/10 flex justify-between items-center bg-stone-50">
          <h3 className="font-semibold text-slate-800">{t('reports.inventoryPerformance')}</h3>
          <span className="text-xs font-medium px-2 py-1 rounded bg-blue-50 text-blue-700">
              {inventory.details?.length || 0} {t('reports.activeItems')}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-stone-50">
                <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">{t('reports.product')}</th>
                <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider text-right">{t('reports.stock')}</th>
                <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider text-right">{t('reports.sold')}</th>
                <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider text-right">Возвраты</th>
                <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider text-right">Списания</th>
                <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider text-right">{t('reports.costValue')}</th>
                <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider text-right">{t('reports.retailValue')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {pagedItems.map((row) => (
                <tr key={row.productId} className="border-b border-[#5A5A40]/5">
                  <td className="px-6 py-4">
                    <div className="text-sm font-medium text-slate-900">{row.name}</div>
                    <div className="text-xs text-slate-400">{row.sku}</div>
                  </td>
                  <td className="px-6 py-4 text-right text-sm text-slate-600">{row.totalStock}</td>
                  <td className="px-6 py-4 text-right text-sm text-slate-600">{row.soldUnits}</td>
                  <td className="px-6 py-4 text-right text-sm text-slate-600">{row.returnedUnits}</td>
                  <td className="px-6 py-4 text-right text-sm text-slate-600">{row.writeOffUnits}</td>
                  <td className="px-6 py-4 text-right text-sm text-slate-600">{formatMoney(row.costValue, currencyCode)}</td>
                  <td className="px-6 py-4 text-right text-sm font-semibold text-slate-900">{formatMoney(row.retailValue, currencyCode)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination Controls */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-6 py-4 bg-stone-50 border-t border-[#5A5A40]/10">
          <div className="text-[10px] uppercase tracking-widest text-[#5A5A40]/40 font-bold">
            Страница {currentPage} из {totalPages} ({totalItems} позиций)
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
              disabled={currentPage === 1}
              className="px-4 py-2 text-[10px] uppercase tracking-widest font-bold bg-white border border-[#5A5A40]/10 rounded-lg disabled:opacity-30"
            >
              Назад
            </button>
            <button
              onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
              disabled={currentPage === totalPages}
              className="px-4 py-2 text-[10px] uppercase tracking-widest font-bold bg-[#5A5A40] text-white rounded-lg disabled:opacity-30"
            >
              Вперед
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
