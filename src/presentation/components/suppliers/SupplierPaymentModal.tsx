import React, { useState, useEffect, useRef } from 'react';
import { X, CreditCard, Banknote, Landmark, Wallet, Save, RefreshCw } from 'lucide-react';

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
    <div className="fixed inset-0 z-[110] bg-[#151619]/40 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-300">
      <div className="w-full max-w-lg bg-[#f8f7f2] rounded-[3rem] shadow-2xl border border-white/20 overflow-hidden relative">
        <div className="p-8 border-b border-[#5A5A40]/5 flex items-center justify-between bg-white/40">
          <div>
            <h3 className="text-xl font-normal text-[#151619] tracking-tight">Оплата поставщику</h3>
            <p className="text-[10px] uppercase tracking-widest text-[#5A5A40]/50 mt-1 font-normal italic">Регистрация расхода по накладной</p>
          </div>
          <button
            onClick={onClose}
            className="w-10 h-10 rounded-full border border-[#5A5A40]/10 flex items-center justify-center text-[#5A5A40]/30 hover:bg-white hover:text-[#5A5A40] transition-all"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-8 space-y-8">
          {/* Info Section */}
          <div className="grid grid-cols-2 gap-4">
             <div className="p-4 bg-white rounded-2xl border border-[#5A5A40]/5 shadow-sm">
                <p className="text-[9px] uppercase tracking-widest text-[#5A5A40]/40 mb-1">Номер прихода</p>
                <p className="text-sm font-normal text-[#151619]">{invoice?.invoiceNumber || '—'}</p>
             </div>
             <div className="p-4 bg-white rounded-2xl border border-[#5A5A40]/5 shadow-sm">
                <p className="text-[9px] uppercase tracking-widest text-[#5A5A40]/40 mb-1">Остаток долга</p>
                <p className="text-sm font-normal text-rose-500">{getInvoiceOutstandingAmount(invoice).toLocaleString('ru-RU')} {currencyCode}</p>
             </div>
          </div>

          <div className="space-y-6">
            <div className="space-y-2">
              <label className="text-[10px] uppercase tracking-widest text-[#5A5A40]/60 font-normal px-2">Сумма оплаты</label>
              <div className="relative group">
                <div className="absolute left-5 top-1/2 -translate-y-1/2 text-[#5A5A40]/20"><Wallet size={16}/></div>
                <input
                  ref={paymentAmountInputRef}
                  type="number"
                  min={0}
                  step="0.01"
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                  className="w-full pl-12 pr-24 py-4 bg-white border border-[#5A5A40]/5 rounded-[1.5rem] text-sm font-normal outline-none focus:ring-4 focus:ring-[#5A5A40]/5 transition-all"
                  placeholder="0.00"
                />
                <button
                  type="button"
                  onClick={fillPaymentAmount}
                  className="absolute right-3 top-1/2 -translate-y-1/2 px-4 py-2 rounded-xl bg-[#5A5A40]/5 text-[10px] uppercase tracking-widest font-bold text-[#5A5A40] hover:bg-[#5A5A40] hover:text-white transition-all"
                >
                  Вся сумма
                </button>
              </div>
            </div>

            <div className="space-y-4">
              <label className="text-[10px] uppercase tracking-widest text-[#5A5A40]/60 font-normal px-2">Способ оплаты</label>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { id: 'CASH', label: 'Наличные', icon: Banknote },
                  { id: 'BANK_TRANSFER', label: 'Перевод', icon: Landmark },
                  { id: 'CARD', label: 'Карта', icon: CreditCard },
                ].map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setMethod(item.id as any)}
                    className={`flex flex-col items-center justify-center gap-3 p-4 rounded-2xl border transition-all ${method === item.id ? 'bg-[#5A5A40] border-[#5A5A40] text-white shadow-lg shadow-[#5A5A40]/20' : 'bg-white border-[#5A5A40]/5 text-[#5A5A40]/40 hover:bg-[#f5f5f0]'}`}
                  >
                    <item.icon size={22} className={method === item.id ? 'text-white' : 'text-[#5A5A40]/20'} />
                    <span className="text-[10px] uppercase tracking-widest font-normal">{item.label}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] uppercase tracking-widest text-[#5A5A40]/60 font-normal px-2">Комментарий</label>
              <input
                type="text"
                value={comment}
                onChange={e => setComment(e.target.value)}
                className="w-full px-5 py-4 bg-white border border-[#5A5A40]/5 rounded-[1.5rem] text-sm font-normal outline-none focus:ring-4 focus:ring-[#5A5A40]/5 transition-all font-normal placeholder:text-[#5A5A40]/20"
                placeholder="Прим: Частичное погашение за..."
              />
            </div>
          </div>

          {error && (
            <div className="p-4 bg-rose-50 border border-rose-100 rounded-2xl text-[10px] uppercase tracking-widest text-rose-500 font-bold animate-shake">
              {error}
            </div>
          )}

          <div className="pt-4 flex gap-4">
            <button
              onClick={onClose}
              className="flex-1 py-4 border border-[#5A5A40]/10 rounded-2xl text-[10px] uppercase tracking-widest font-normal text-[#5A5A40]/40 hover:bg-[#f5f5f0] transition-all"
            >
              Отмена
            </button>
            <button
              onClick={handleSubmit}
              disabled={busyId === invoice?.id}
              className="flex-[2] py-4 bg-[#5A5A40] text-white rounded-2xl text-[10px] uppercase tracking-widest font-normal hover:bg-[#4A4A30] active:scale-95 transition-all disabled:opacity-50 shadow-xl shadow-[#5A5A40]/10 flex items-center justify-center gap-2"
            >
              {busyId === invoice?.id ? <RefreshCw size={14} className="animate-spin" /> : <Save size={16} />}
              <span>{busyId === invoice?.id ? 'Обработка...' : 'Подтвердить платеж'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
