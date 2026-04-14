import React, { useState, useEffect, useRef } from 'react';
import { X } from 'lucide-react';

interface SupplierPaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  invoice: any | null;
  currencyCode: string;
  busyId: string | null;
  setBusyId: (id: string | null) => void;
  getInvoiceOutstandingAmount: (invoice: any) => number;
  onPaymentSuccess: () => void;
}

export const SupplierPaymentModal: React.FC<SupplierPaymentModalProps> = ({
  isOpen,
  onClose,
  invoice,
  currencyCode,
  busyId,
  setBusyId,
  getInvoiceOutstandingAmount,
  onPaymentSuccess,
}) => {
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<'CASH' | 'BANK_TRANSFER' | 'CARD'>('CASH');
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const paymentAmountInputRef = useRef<HTMLInputElement | null>(null);

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
      const res = await fetch(`/api/suppliers/invoices/${invoice.id}/payments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(localStorage.getItem('pharmapro_token') ? { Authorization: `Bearer ${localStorage.getItem('pharmapro_token')}` } : {}),
        },
        body: JSON.stringify({
          amount: Number(amount),
          method,
          comment: comment || `Оплата по приходу ${invoice.invoiceNumber || invoice.id}`,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || 'Ошибка оплаты');
      }
      onPaymentSuccess();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Ошибка оплаты');
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
    <div className="fixed inset-0 z-110 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-3xl shadow-2xl border border-[#5A5A40]/10 overflow-hidden">
        <div className="px-6 py-4 bg-[#5A5A40] text-white flex items-center justify-between">
          <h3 className="text-base font-bold">Оплата поставщику</h3>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-white/10 transition-colors"
          >
            <X size={18} />
          </button>
        </div>
        <div className="p-6 space-y-4">
          <div className="text-sm text-[#5A5A40]/70">
            Приход: <span className="font-semibold text-[#5A5A40]">{invoice?.invoiceNumber || invoice?.id}</span>
          </div>
          <div className="text-sm text-[#5A5A40]/70">
            Остаток долга: <span className="font-semibold text-rose-700">{getInvoiceOutstandingAmount(invoice).toFixed(2)} {currencyCode}</span>
          </div>
          <div>
            <label className="block text-xs font-bold uppercase tracking-widest text-[#5A5A40]/60 mb-1">Сумма оплаты</label>
            <div className="flex items-center gap-2">
              <input
                ref={paymentAmountInputRef}
                type="number"
                min={0}
                step="0.01"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-[#5A5A40]/15 text-sm outline-none focus:ring-2 focus:ring-[#5A5A40]/20"
                placeholder="Сумма оплаты"
              />
              <button
                type="button"
                onClick={fillPaymentAmount}
                className="shrink-0 px-3 py-2 rounded-xl border border-[#5A5A40]/15 text-xs font-semibold text-[#5A5A40] hover:bg-[#f5f5f0] transition-colors"
              >
                Все
              </button>
            </div>
          </div>
          <div>
            <label className="block text-xs font-bold uppercase tracking-widest text-[#5A5A40]/60 mb-1">Метод оплаты</label>
            <select
              className="w-full px-3 py-2 rounded-xl border border-[#5A5A40]/15 text-sm outline-none focus:ring-2 focus:ring-[#5A5A40]/20"
              value={method}
              onChange={e => setMethod(e.target.value as any)}
            >
              <option value="CASH">Наличные</option>
              <option value="BANK_TRANSFER">Банк</option>
              <option value="CARD">Карта</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-bold uppercase tracking-widest text-[#5A5A40]/60 mb-1">Комментарий</label>
            <input
              type="text"
              value={comment}
              onChange={e => setComment(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-[#5A5A40]/15 text-sm outline-none focus:ring-2 focus:ring-[#5A5A40]/20"
              placeholder="Комментарий к оплате"
            />
          </div>
          {error && <div className="text-red-600 text-sm font-semibold">{error}</div>}
          <button
            onClick={handleSubmit}
            disabled={busyId === invoice?.id}
            className="w-full py-3 rounded-2xl bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 transition-all disabled:opacity-50 mt-2"
          >
            {busyId === invoice?.id ? 'Обработка...' : 'Подтвердить оплату'}
          </button>
        </div>
      </div>
    </div>
  );
};
