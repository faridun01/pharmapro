import React, { useState, useEffect } from 'react';
import { X, AlertCircle } from 'lucide-react';
import { ReturnInvoiceItem } from './types';
import { ApiInvoiceRepository } from '../../../infrastructure/api';
import { runRefreshTasks } from '../../../lib/utils';
import { usePharmacy } from '../../context';
import { formatProductDisplayName } from '../../../lib/productDisplay';
import { formatPackQuantity } from './utils';

interface InvoiceReturnModalProps {
  isOpen: boolean;
  onClose: () => void;
  invoice: any | null;
  busyId: string | null;
  setBusyId: (id: string | null) => void;
}

export const InvoiceReturnModal: React.FC<InvoiceReturnModalProps> = ({
  isOpen,
  onClose,
  invoice,
  busyId,
  setBusyId,
}) => {
  const { refreshInvoices, refreshProducts, products } = usePharmacy();
  const [items, setItems] = useState<ReturnInvoiceItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  const invoiceRepository = new ApiInvoiceRepository();

  useEffect(() => {
    if (isOpen && invoice) {
      const returnedByItemKey = new Map<string, number>();
      for (const ret of invoice.returns || []) {
        if (ret.status === 'COMPLETED') {
          for (const item of ret.items || []) {
            const key = `${item.productId}:${item.batchId || ''}`;
            returnedByItemKey.set(key, Number(returnedByItemKey.get(key) || 0) + Number(item.quantity || 0));
          }
        }
      }

      setItems((invoice.items || []).map((item: any) => {
        const remainingQuantity = Math.max(0, Number(item.quantity || 0) - Number(returnedByItemKey.get(`${item.productId}:${item.batchId || ''}`) || 0));
        return {
          id: item.id,
          productId: item.productId,
          productName: item.productName || '-',
          batchNo: item.batchNo || '—',
          soldQuantity: remainingQuantity,
          quantity: remainingQuantity,
        };
      }));
      setError(null);
    }
  }, [isOpen, invoice]);

  const updateItemQuantity = (itemId: string, unitsValue: string) => {
    setItems((prev) => prev.map((item) => {
      if (item.id !== itemId) return item;
      return {
        ...item,
        quantity: Math.max(0, Math.min(item.soldQuantity, Math.floor(Number(unitsValue) || 0))),
      };
    }));
    setError(null);
  };

  const handleSubmit = async () => {
    if (!invoice) return;

    const itemsToReturn = items.filter(i => i.quantity > 0).map(i => ({
      id: i.id,
      quantity: i.quantity
    }));

    if (itemsToReturn.length === 0) {
      setError('Укажите количество товаров для возврата');
      return;
    }

    setBusyId(invoice.id);
    setError(null);

    try {
      await invoiceRepository.processReturn(invoice.id, itemsToReturn);
      await runRefreshTasks(refreshInvoices, refreshProducts);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to process return');
    } finally {
      setBusyId(null);
    }
  };

  const getProductDisplayLabel = (productId?: string, fallbackName?: string) => {
    const baseName = String(fallbackName || '-').trim() || '-';
    if (!productId) return baseName;
    const product = products.find((entry) => entry.id === productId);
    return formatProductDisplayName({
      name: baseName,
      countryOfOrigin: product?.countryOfOrigin,
    }, { includeCountry: true });
  };

  if (!isOpen || !invoice) return null;

  return (
    <div className="fixed inset-0 z-100 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-2xl bg-white rounded-3xl shadow-2xl border border-[#5A5A40]/10 overflow-hidden">
        <div className="px-6 py-4 bg-amber-600 text-white flex items-center justify-between">
          <h3 className="text-base font-bold">Возврат по накладной</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 transition-colors">
            <X size={18} />
          </button>
        </div>
        <div className="p-6 space-y-5">
          <p className="text-sm text-[#5A5A40]/80">Укажите, сколько вернуть по накладной <span className="font-semibold">{invoice.invoiceNo || invoice.id}</span>.</p>
          <div className="space-y-3 max-h-96 overflow-auto">
            {items.map((item) => (
              <div key={item.id} className="rounded-2xl border border-[#5A5A40]/10 p-4 space-y-3 bg-[#f5f5f0]/35">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-[#5A5A40]">{getProductDisplayLabel(item.productId, item.productName)}</p>
                    <p className="text-[11px] text-[#5A5A40]/55 mt-1">Партия: {item.batchNo} • Продано: {formatPackQuantity(item.soldQuantity)}</p>
                  </div>
                  <p className="text-[11px] font-semibold text-[#5A5A40]/60">Макс: {formatPackQuantity(item.soldQuantity)}</p>
                </div>
                <div className="grid gap-3 grid-cols-1">
                  <label>
                    <span className="block text-[10px] font-bold uppercase tracking-widest text-[#5A5A40]/50 mb-1">Единицы</span>
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={item.quantity}
                      onChange={(e) => updateItemQuantity(item.id, e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-[#5A5A40]/15 text-sm outline-none focus:ring-2 focus:ring-[#5A5A40]/20"
                    />
                  </label>
                </div>
              </div>
            ))}
          </div>
          {error && (
            <div className="p-3 bg-red-50 text-red-600 text-xs rounded-xl border border-red-100 flex items-center gap-2">
              <AlertCircle size={14} />
              {error}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <button onClick={onClose} className="py-2.5 rounded-xl border border-[#5A5A40]/15 text-sm font-semibold text-[#5A5A40] hover:bg-[#f5f5f0] transition-colors">Отмена</button>
            <button onClick={handleSubmit} disabled={busyId === invoice.id} className="py-2.5 rounded-xl bg-amber-600 text-white text-sm font-semibold hover:bg-amber-700 disabled:opacity-50 transition-colors">
              {busyId === invoice.id ? 'Выполняю...' : 'Подтвердить'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
