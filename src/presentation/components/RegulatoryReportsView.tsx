import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FileCheck2, ReceiptText, Landmark, ShieldCheck } from 'lucide-react';
import { buildApiHeaders } from '../../infrastructure/api';

type FinanceReport = {
  range: { from: string; to: string };
  kpi: {
    netRevenue: number;
    grossProfit: number;
    operatingProfit: number;
    taxSales: number;
    taxPurchases: number;
    taxNet: number;
    writeOffAmount: number;
  };
  debts: {
    receivableTotal: number;
    receivableOverdue: number;
    payableTotal: number;
    payableOverdue: number;
    arAging: Record<string, number>;
    apAging: Record<string, number>;
  };
  inventory: {
    costValue: number;
    retailValue: number;
    unrealizedMargin: number;
  };
  balanceLike: {
    cashLike: number;
    totalAssetsLike: number;
    totalLiabilitiesLike: number;
    equityLike: number;
  };
  purchases: { total: number; unpaidCount: number };
};

const formatMoney = (value: number) => new Intl.NumberFormat('ru-RU', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
}).format(Number(value || 0)) + ' TJS';

export const RegulatoryReportsView: React.FC = () => {
  const { t } = useTranslation();
  const [report, setReport] = useState<FinanceReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const response = await fetch('/api/reports/finance?preset=year', {
          headers: await buildApiHeaders(false),
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || 'Не удалось загрузить регуляторные отчеты');
        setReport(body);
      } catch (e: any) {
        setError(e.message || 'Не удалось загрузить регуляторные отчеты');
      }
    };

    void load();
  }, []);

  return (
    <div className="space-y-8 animate-in fade-in duration-500 pb-12">
      <div>
        <h2 className="text-3xl font-bold text-[#5A5A40] tracking-tight">{t('Regulatory Reports')}</h2>
        <p className="text-[#5A5A40]/60 mt-1 italic">{t('Structured forms for statutory, tax, and accounting control')}</p>
        {report?.range && (
          <p className="text-xs text-[#5A5A40]/50 mt-2">
            {t('Annual basis')}: {new Date(report.range.from).toLocaleDateString('ru-RU')} - {new Date(report.range.to).toLocaleDateString('ru-RU')}
          </p>
        )}
      </div>

      {error && <div className="bg-red-50 border border-red-100 rounded-2xl px-4 py-3 text-sm text-red-700">{error}</div>}

      {report && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
            {[
              { label: t('Tax Declaration Base'), value: formatMoney(report.kpi.taxNet), icon: ReceiptText },
              { label: t('Statutory Revenue'), value: formatMoney(report.kpi.netRevenue), icon: FileCheck2 },
              { label: t('Balance Equity-like'), value: formatMoney(report.balanceLike.equityLike), icon: Landmark },
              { label: t('Compliance Risk'), value: formatMoney(report.debts.receivableOverdue + report.debts.payableOverdue + report.kpi.writeOffAmount), icon: ShieldCheck },
            ].map((item) => (
              <div key={item.label} className="bg-white p-6 rounded-2xl border border-[#5A5A40]/10">
                <div className="w-10 h-10 rounded-xl bg-[#f5f5f0] text-[#5A5A40] flex items-center justify-center mb-3">
                  <item.icon size={18} />
                </div>
                <p className="text-xs uppercase tracking-wider text-[#5A5A40]/50">{item.label}</p>
                <p className="text-2xl font-bold text-[#5A5A40] mt-1">{item.value}</p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            <div className="bg-white p-6 rounded-2xl border border-[#5A5A40]/10">
              <h3 className="text-lg font-bold text-[#5A5A40] mb-4">{t('Profit Statement')}</h3>
              <div className="space-y-2 text-sm">
                {[
                  ['Выручка', report.kpi.netRevenue],
                  ['Валовая прибыль', report.kpi.grossProfit],
                  ['Операционная прибыль', report.kpi.operatingProfit],
                  ['Налоговое сальдо', report.kpi.taxNet],
                  ['Списания', report.kpi.writeOffAmount],
                ].map(([label, value]) => (
                  <div key={String(label)} className="flex items-center justify-between">
                    <span className="text-[#5A5A40]/70">{label}</span>
                    <span className="font-semibold text-[#5A5A40]">{formatMoney(Number(value))}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-white p-6 rounded-2xl border border-[#5A5A40]/10">
              <h3 className="text-lg font-bold text-[#5A5A40] mb-4">{t('Balance Sheet Snapshot')}</h3>
              <div className="space-y-2 text-sm">
                {[
                  ['Денежные средства', report.balanceLike.cashLike],
                  ['Запасы', report.inventory.costValue],
                  ['Дебиторская задолженность', report.debts.receivableTotal],
                  ['Итого активы', report.balanceLike.totalAssetsLike],
                  ['Кредиторская задолженность', report.debts.payableTotal],
                  ['Собственный капитал', report.balanceLike.equityLike],
                ].map(([label, value]) => (
                  <div key={String(label)} className="flex items-center justify-between">
                    <span className="text-[#5A5A40]/70">{label}</span>
                    <span className="font-semibold text-[#5A5A40]">{formatMoney(Number(value))}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            <div className="bg-white p-6 rounded-2xl border border-[#5A5A40]/10">
              <h3 className="text-lg font-bold text-[#5A5A40] mb-4">{t('Tax Ledger')}</h3>
              <div className="space-y-2 text-sm">
                {[
                  ['Налог с продаж', report.kpi.taxSales],
                  ['Налог с закупок', report.kpi.taxPurchases],
                  ['Налоговое сальдо', report.kpi.taxNet],
                  ['Закупки', report.purchases.total],
                  ['Неоплаченные документы закупки', report.purchases.unpaidCount],
                ].map(([label, value]) => (
                  <div key={String(label)} className="flex items-center justify-between">
                    <span className="text-[#5A5A40]/70">{label}</span>
                    <span className="font-semibold text-[#5A5A40]">{typeof value === 'number' && label !== 'Неоплаченные документы закупки' ? formatMoney(Number(value)) : value}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-white p-6 rounded-2xl border border-[#5A5A40]/10">
              <h3 className="text-lg font-bold text-[#5A5A40] mb-4">{t('Aging Registers')}</h3>
              <div className="space-y-4 text-sm">
                <div>
                  <p className="font-semibold text-[#5A5A40] mb-2">Дебиторская задолженность</p>
                  {Object.entries(report.debts.arAging).map(([bucket, value]) => (
                    <div key={bucket} className="flex items-center justify-between text-[#5A5A40]/70">
                      <span>{bucket}</span>
                      <span>{formatMoney(Number(value))}</span>
                    </div>
                  ))}
                </div>
                <div>
                  <p className="font-semibold text-[#5A5A40] mb-2">Кредиторская задолженность</p>
                  {Object.entries(report.debts.apAging).map(([bucket, value]) => (
                    <div key={bucket} className="flex items-center justify-between text-[#5A5A40]/70">
                      <span>{bucket}</span>
                      <span>{formatMoney(Number(value))}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
