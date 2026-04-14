import React from 'react';
import { useTranslation } from 'react-i18next';
import { 
  FileText, 
  ChevronRight, 
  Printer, 
  DollarSign, 
  Pencil, 
  RotateCcw, 
  Trash2, 
  Calendar, 
  Clock 
} from 'lucide-react';
import { getPaymentStatusLabel } from './utils';

interface InvoiceTableRowProps {
  invoice: any;
  index: number;
  currencyCode: string;
  busyId: string | null;
  onDetails: (invoice: any) => void;
  onPrint: (invoice: any) => void;
  onPayment: (invoice: any) => void;
  onEdit: (invoice: any) => void;
  onReturn: (invoice: any) => void;
  onDelete: (invoice: any) => void;
  isDebtorsView?: boolean;
}

export const InvoiceTableRow: React.FC<InvoiceTableRowProps> = React.memo(({
  invoice,
  index,
  currencyCode,
  busyId,
  onDetails,
  onPrint,
  onPayment,
  onEdit,
  onReturn,
  onDelete,
  isDebtorsView = false,
}) => {
  const { t } = useTranslation();

  const totalAmount = Number(invoice.totalAmount || 0);
  const returnedAmount = Number(invoice.returnedAmountTotal || 0);
  const netAmount = totalAmount - returnedAmount;
  const taxAmount = Number(invoice.taxAmount || 0);
  const paidAmount = Number(invoice.paidAmountTotal ?? 0);
  const outstandingAmount = Number(invoice.outstandingAmount ?? Math.max(0, netAmount - paidAmount));
  const paymentState = String(invoice.paymentStatus || 'UNPAID');
  const shouldShowDebt = ['UNPAID', 'PARTIALLY_PAID', 'OVERDUE'].includes(paymentState) && outstandingAmount > 0;
  
  const paymentBadge = getPaymentStatusLabel(paymentState, outstandingAmount, paidAmount);
  
  const paymentMethodBadge = invoice.paymentType === 'CASH'
    ? { label: 'Наличные', className: 'bg-blue-50 text-blue-700 border-blue-200' }
    : invoice.paymentType === 'CARD'
      ? { label: 'Карта', className: 'bg-violet-50 text-violet-700 border-violet-200' }
      : { label: 'В долг', className: 'bg-stone-50 text-stone-700 border-stone-200' };

  const isReturnLocked = invoice.status === 'RETURNED';
  const isEditLocked = invoice.status === 'RETURNED' || invoice.status === 'PARTIALLY_RETURNED';

  const formatInvoiceQuantitySummary = (items: any[] = []) => {
    const totalUnits = items.reduce((sum, item) => sum + Math.max(0, Math.floor(Number(item?.quantity || 0))), 0);
    return `${totalUnits} ед.`;
  };

  return (
    <tr className="hover:bg-[#f5f5f0]/30 transition-colors group align-top">
      <td className="px-4 py-3.5 text-center">
        <span className="inline-flex min-w-7 h-7 items-center justify-center rounded-lg bg-[#f5f5f0] text-[#5A5A40] text-[12px] font-bold">
          {index}
        </span>
      </td>
      <td className="px-6 py-3.5">
        <div className="flex flex-col gap-0.5">
          {isDebtorsView && (
            <span className="text-xs text-[#5A5A40]/60 font-semibold leading-none mb-0.5">{invoice.customer || '—'}</span>
          )}
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 bg-[#f5f5f0] rounded-lg flex items-center justify-center text-[#5A5A40] group-hover:bg-[#5A5A40] group-hover:text-white transition-colors">
              <FileText size={14} />
            </div>
            <span className="font-mono font-bold text-[#5A5A40] text-[13px] leading-none">{invoice.invoiceNo || invoice.id}</span>
          </div>
        </div>
      </td>
      <td className="px-6 py-3.5">
        <div className="space-y-1 text-[12px] text-[#5A5A40]/60 leading-none">
          <div className="flex items-center gap-1.5">
            <Calendar size={12} />
            <span>{new Date(invoice.createdAt).toLocaleDateString()}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Clock size={12} />
            <span>{new Date(invoice.createdAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</span>
          </div>
        </div>
      </td>
      <td className="px-6 py-3.5">
        <div className="inline-flex flex-col gap-1.5">
          {!isDebtorsView && (
            <span className={`inline-flex items-center justify-center gap-1 px-2.5 py-0.5 rounded-full text-[9px] font-semibold border ${paymentMethodBadge.className}`}>
              {paymentMethodBadge.label}
            </span>
          )}
          <span className={`inline-flex items-center justify-center gap-1 px-2.5 py-0.5 rounded-full text-[9px] font-bold border ${paymentBadge.className}`}>
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-current opacity-70"></span>
            {paymentBadge.label}
          </span>
        </div>
        {!isDebtorsView && shouldShowDebt && (
          <p className="text-[9px] font-semibold text-rose-700 leading-none mt-1.5 bg-rose-50 border border-rose-100 rounded-full px-2 py-1 inline-flex items-center">
            Остаток: {outstandingAmount.toFixed(2)} {currencyCode}
          </p>
        )}
      </td>
      <td className="px-4 py-3.5 text-right">
        <p className="text-[12px] font-semibold text-[#5A5A40] leading-none">{formatInvoiceQuantitySummary(invoice.items || [])}</p>
        <p className="text-[9px] text-[#5A5A40]/40 mt-1">{invoice.items?.length || 0} поз.</p>
      </td>
      <td className="px-4 py-3.5 text-right">
        <p className="text-[13px] font-bold text-[#5A5A40] leading-none">{netAmount.toFixed(2)}</p>
        {returnedAmount > 0 && (
          <p className="text-[9px] text-red-600 mt-1">Возврат {returnedAmount.toFixed(2)}</p>
        )}
        {taxAmount > 0 && <p className="text-[9px] text-[#5A5A40]/45 mt-1">Налог {taxAmount.toFixed(2)}</p>}
      </td>
      <td className="px-4 py-3.5 text-right">
        <p className="text-[13px] font-semibold text-emerald-700 leading-none">{paidAmount.toFixed(2)}</p>
      </td>
      <td className="px-4 py-3.5 text-right">
        <p className={`text-[13px] font-semibold leading-none ${outstandingAmount > 0 ? 'text-rose-700' : 'text-[#5A5A40]/60'}`}>{outstandingAmount.toFixed(2)}</p>
      </td>
      <td className="px-6 py-3.5 text-right">
        <div className="ml-auto grid grid-cols-3 gap-1.5 w-fit justify-items-center">
          <button
            onClick={() => onDetails(invoice)}
            className="flex h-8 w-8 items-center justify-center text-[#5A5A40]/30 hover:text-[#5A5A40] hover:bg-[#f5f5f0] rounded-md transition-all"
            title="Открыть: детали и суммы"
          >
            <ChevronRight size={14} />
          </button>
          <button
            onClick={() => onPrint(invoice)}
            className="flex h-8 w-8 items-center justify-center text-[#5A5A40]/30 hover:text-[#5A5A40] hover:bg-[#f5f5f0] rounded-md transition-all"
            title={t('Print invoice')}
          >
            <Printer size={14} />
          </button>
          {['UNPAID', 'PARTIALLY_PAID', 'OVERDUE'].includes(paymentState) && (
            <button
              onClick={() => onPayment(invoice)}
              disabled={busyId === invoice.id || isReturnLocked}
              className="flex h-8 w-8 items-center justify-center text-[#5A5A40]/30 hover:text-emerald-700 hover:bg-emerald-50 rounded-md transition-all disabled:opacity-40"
              title={t('Add payment')}
            >
              <DollarSign size={14} />
            </button>
          )}
          <button
            onClick={() => onEdit(invoice)}
            disabled={busyId === invoice.id || isEditLocked}
            className="flex h-8 w-8 items-center justify-center text-[#5A5A40]/30 hover:text-[#5A5A40] hover:bg-[#f5f5f0] rounded-md transition-all disabled:opacity-40"
            title={t('Edit invoice')}
          >
            <Pencil size={14} />
          </button>
          <button
            onClick={() => onReturn(invoice)}
            disabled={busyId === invoice.id || isReturnLocked}
            className="flex h-8 w-8 items-center justify-center text-[#5A5A40]/30 hover:text-amber-700 hover:bg-amber-50 rounded-md transition-all disabled:opacity-40"
            title={t('Create return')}
          >
            <RotateCcw size={14} />
          </button>
          <button
            onClick={() => onDelete(invoice)}
            disabled={busyId === invoice.id || isEditLocked}
            className="flex h-8 w-8 items-center justify-center text-[#5A5A40]/30 hover:text-red-700 hover:bg-red-50 rounded-md transition-all disabled:opacity-40"
            title={t('Delete invoice')}
          >
            <Trash2 size={14} />
          </button>
        </div>
      </td>
    </tr>
  );
});
