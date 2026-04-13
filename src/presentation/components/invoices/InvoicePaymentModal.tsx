import React, { useRef, useState, useEffect } from 'react';
import { X, AlertCircle } from 'lucide-react';
import { Invoice } from '../../../core/domain';
import { ApiInvoiceRepository } from '../../../infrastructure/api';
import { runRefreshTasks } from '../../../lib/utils';
import { usePharmacy } from '../../context';

interface InvoicePaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  invoice: any | null;
  currencyCode: string;
  busyId: string | null;
  setBusyId: (id: string | null) => void;
  getInvoiceOutstandingAmount: (invoice: any) => number;
}

export const InvoicePaymentModal: React.FC<InvoicePaymentModalProps> = ({
  isOpen,
  onClose,
  invoice,
  currencyCode,
  busyId,
  setBusyId,
  getInvoiceOutstandingAmount,
}) => {
  const { refreshInvoices, refreshProducts } = usePharmacy();
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<'CASH' | 'CARD' | 'BANK_TRANSFER'>('CASH');
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const paymentAmountInputRef = useRef<HTMLInputElement | null>(null);
  
  const invoiceRepository = new ApiInvoiceRepository();

  useEffect(() => {
    if (isOpen && invoice) {
      const outstanding = getInvoiceOutstandingAmount(invoice);
      setAmount(outstanding.toFixed(2));
      setMethod('CASH');
      setComment('');
      setError(null);
    }
  }, [isOpen, invoice, getInvoiceOutstandingAmount]);

  if (!isOpen) return null;

  const handleSubmit = async () => {
    if (!invoice) return;
    
    setError(null);
    setBusyId(invoice.id);
    
    try {
      await invoiceRepository.addPayment(invoice.id, {
        amount: Number(amount),
        method,
        comment: comment || `Payment for invoice ${invoice.invoiceNo || invoice.id}`,
      });
      
      await runRefreshTasks(refreshInvoices, refreshProducts);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to process payment');
    } finally {
      setBusyId(null);
    }
  };

  const fillPaymentAmount = () => {
    if (invoice) {
      setAmount(getInvoiceOutstandingAmount(invoice).toFixed(2));
    }
  };

  return (
    <div className="fixed inset-0 z-100 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-3xl shadow-2xl border border-[#5A5A40]/10 overflow-hidden">
        <div className="px-6 py-4 bg-[#5A5A40] text-white flex items-center justify-between">
          <h3 className="text-base font-bold">Внесение оплаты</h3>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-white/10 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div className="text-sm text-[#5A5A40]/70">
            Накладная: <span className="font-semibold text-[#5A5A40]">{invoice?.invoiceNo || invoice?.id}</span>
          </div>
          <div className="text-sm text-[#5A5A40]/70">
            Покупатель: <span className="font-semibold text-[#5A5A40]">{invoice?.customer || '-'}</span>
          </div>
          <div className="text-sm text-[#5A5A40]/70">
            Остаток долга: <span className="font-semibold text-rose-700">{getInvoiceOutstandingAmount(invoice).toFixed(2)} {currencyCode}</span>
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-widest text-[#5A5A40]/60 mb-1">Полное погашение долга</label>
            <div className="flex items-center gap-2">
              <input
                ref={paymentAmountInputRef}
                type="number"
                min={0}
                step="0.01"
                value={amount}
                readOnly
                className="w-full px-3 py-2 rounded-xl border border-[#5A5A40]/15 text-sm outline-none focus:ring-2 focus:ring-[#5A5A40]/20"
                placeholder="Сумма полного погашения"
              />
              <button
                type="button"
                onClick={fillPaymentAmount}
                className="shrink-0 px-3 py-2 rounded-xl border border-[#5A5A40]/15 text-xs font-semibold text-[#5A5A40] hover:bg-[#f5f5f0] transition-colors"
              >
                Обновить
              </button>
            </div>
            <p className="mt-2 text-xs text-[#5A5A40]/55">Для продаж в долг из истории продаж доступно только полное погашение остатка.</p>
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-widest text-[#5A5A40]/60 mb-1">Способ оплаты</label>
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value as any)}
              className="w-full px-3 py-2 rounded-xl border border-[#5A5A40]/15 text-sm outline-none focus:ring-2 focus:ring-[#5A5A40]/20"
            >
              <option value="CASH">Наличные (CASH)</option>
              <option value="CARD">Карта (CARD)</option>
              <option value="BANK_TRANSFER">Перевод (BANK_TRANSFER)</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-widest text-[#5A5A40]/60 mb-1">Комментарий (необязательно)</label>
            <input
              type="text"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-[#5A5A40]/15 text-sm outline-none focus:ring-2 focus:ring-[#5A5A40]/20"
              placeholder="Например: доплата по договору"
            />
          </div>

          {error && (
            <div className="p-3 bg-red-50 text-red-600 text-xs rounded-xl border border-red-100 flex items-center gap-2">
              <AlertCircle size={14} />
              {error}
            </div>
          )}

          <div className="pt-2 grid grid-cols-2 gap-3">
            <button
              onClick={onClose}
              className="py-2.5 rounded-xl border border-[#5A5A40]/15 text-sm font-semibold text-[#5A5A40] hover:bg-[#f5f5f0] transition-colors"
            >
              Отмена
            </button>
            <button
              onClick={handleSubmit}
              disabled={busyId === invoice?.id}
              className="py-2.5 rounded-xl bg-[#5A5A40] text-white text-sm font-semibold hover:bg-[#4A4A30] disabled:opacity-50 transition-colors"
            >
              {busyId === invoice?.id ? 'Сохраняю...' : 'Подтвердить оплату'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
