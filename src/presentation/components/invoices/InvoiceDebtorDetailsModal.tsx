import React from 'react';
import { X, FileText, DollarSign } from 'lucide-react';
import { DebtorGroup } from './types';
import { getPaymentStatusLabel, getInvoiceOutstandingAmount } from './utils';

interface InvoiceDebtorDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  debtor: DebtorGroup | null;
  currencyCode: string;
  onViewInvoice: (invoice: any) => void;
  onPayInvoice: (invoice: any) => void;
}

export const InvoiceDebtorDetailsModal: React.FC<InvoiceDebtorDetailsModalProps> = ({
  isOpen,
  onClose,
  debtor,
  currencyCode,
  onViewInvoice,
  onPayInvoice,
}) => {
  if (!isOpen || !debtor) return null;

  return (
    <div className="fixed inset-0 z-100 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-5xl bg-white rounded-3xl shadow-2xl border border-[#5A5A40]/10 overflow-hidden">
        <div className="px-6 py-4 bg-[#5A5A40] text-white flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold">Сверка: детали и суммы</h3>
            <p className="text-xs text-white/70 mt-1">{debtor.customer}</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-white/10 transition-colors"
          >
            <X size={18} />
          </button>
        </div>
        <div className="p-6 space-y-4 max-h-[75vh] overflow-auto">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-sm">
            <div className="rounded-2xl bg-[#f5f5f0]/60 px-4 py-3">
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#5A5A40]/45 mb-1">Накладных</p>
              <p className="font-semibold text-[#5A5A40]">{debtor.invoiceCount}</p>
            </div>
            <div className="rounded-2xl bg-[#f5f5f0]/60 px-4 py-3">
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#5A5A40]/45 mb-1">Сумма</p>
              <p className="font-semibold text-[#5A5A40]">{debtor.totalAmount.toFixed(2)} {currencyCode}</p>
            </div>
            <div className="rounded-2xl bg-[#f5f5f0]/60 px-4 py-3">
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#5A5A40]/45 mb-1">Оплачено</p>
              <p className="font-semibold text-emerald-700">{debtor.totalPaid.toFixed(2)} {currencyCode}</p>
            </div>
            <div className="rounded-2xl bg-[#f5f5f0]/60 px-4 py-3">
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#5A5A40]/45 mb-1">Остаток</p>
              <p className="font-semibold text-rose-700">{debtor.totalOutstanding.toFixed(2)} {currencyCode}</p>
            </div>
          </div>

          <div className="rounded-2xl border border-[#5A5A40]/10 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-[#f5f5f0]/60 text-[#5A5A40]/70 text-xs uppercase">
                <tr>
                  <th className="px-3 py-2 text-left">Накладная</th>
                  <th className="px-3 py-2 text-left">Дата</th>
                  <th className="px-3 py-2 text-left">Статус</th>
                  <th className="px-3 py-2 text-right">Сумма</th>
                  <th className="px-3 py-2 text-right">Оплачено</th>
                  <th className="px-3 py-2 text-right">Остаток</th>
                  <th className="px-3 py-2 text-right">Действия</th>
                </tr>
              </thead>
              <tbody>
                {[...debtor.invoices]
                  .filter((invoice: any) => invoice.status !== 'CANCELLED' && invoice.status !== 'RETURNED')
                  .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
                  .map((invoice: any) => {
                    const paidAmount = Number(invoice.paidAmountTotal ?? 0);
                    const outstandingAmount = Number(invoice.outstandingAmount ?? getInvoiceOutstandingAmount(invoice));
                    const paymentState = String(invoice.paymentStatus || 'UNPAID');
                    const paymentBadge = getPaymentStatusLabel(paymentState, outstandingAmount, paidAmount);
                    return (
                      <tr key={invoice.id} className="border-t border-[#5A5A40]/10">
                        <td className="px-3 py-2 font-semibold text-[#5A5A40]">{invoice.invoiceNo || invoice.id}</td>
                        <td className="px-3 py-2">{new Date(invoice.createdAt).toLocaleString('ru-RU')}</td>
                        <td className="px-3 py-2">{paymentBadge.label}</td>
                        <td className="px-3 py-2 text-right">{Number(invoice.totalAmount || 0).toFixed(2)}</td>
                        <td className="px-3 py-2 text-right text-emerald-700">{paidAmount.toFixed(2)}</td>
                        <td className="px-3 py-2 text-right text-rose-700">{outstandingAmount.toFixed(2)}</td>
                        <td className="px-3 py-2 text-right">
                          <div className="inline-flex items-center gap-2">
                            <button
                              onClick={() => onViewInvoice(invoice)}
                              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[#5A5A40]/35 hover:bg-[#f5f5f0] hover:text-[#5A5A40] transition-all"
                              title="Открыть накладную"
                            >
                              <FileText size={14} />
                            </button>
                            {outstandingAmount > 0 && ['UNPAID', 'PARTIALLY_PAID', 'OVERDUE'].includes(paymentState) && (
                              <button
                                onClick={() => onPayInvoice(invoice)}
                                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[#5A5A40]/35 hover:bg-emerald-50 hover:text-emerald-700 transition-all"
                                title="Погасить долг"
                              >
                                <DollarSign size={14} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};
