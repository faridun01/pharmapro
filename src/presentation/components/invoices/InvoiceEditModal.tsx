import React, { useState, useEffect } from 'react';
import { X, AlertCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { EditableInvoiceItem } from './types';
import { ApiInvoiceRepository } from '../../../infrastructure/api';
import { runRefreshTasks } from '../../../lib/utils';
import { usePharmacy } from '../../context';
import { formatProductDisplayName } from '../../../lib/productDisplay';

interface InvoiceEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  invoice: any | null;
  currencyCode: string;
  busyId: string | null;
  setBusyId: (id: string | null) => void;
}

export const InvoiceEditModal: React.FC<InvoiceEditModalProps> = ({
  isOpen,
  onClose,
  invoice,
  currencyCode,
  busyId,
  setBusyId,
}) => {
  const { t } = useTranslation();
  const { refreshInvoices, refreshProducts, products } = usePharmacy();
  const [items, setItems] = useState<EditableInvoiceItem[]>([]);
  const [taxAmount, setTaxAmount] = useState(0);
  const [discount, setDiscount] = useState(0);
  const [totalAmount, setTotalAmount] = useState('0');
  const [error, setError] = useState<string | null>(null);

  const invoiceRepository = new ApiInvoiceRepository();

  useEffect(() => {
    if (isOpen && invoice) {
      setItems((invoice.items || []).map((item: any) => ({
        id: item.id,
        productId: item.productId,
        productName: item.productName || '-',
        quantity: Math.max(1, Math.floor(Number(item.quantity || 0))),
        unitPrice: Number(item.unitPrice || 0),
      })));
      setTaxAmount(Number(invoice.taxAmount || 0));
      setDiscount(Number(invoice.discount || 0));
      setTotalAmount(Number(invoice.totalAmount || 0).toFixed(2));
      setError(null);
    }
  }, [isOpen, invoice]);

  const computeTotal = (currentItems: EditableInvoiceItem[], currentTax: number, currentDiscount: number) => {
    const subtotal = currentItems.reduce((sum, item) => sum + Number(item.quantity || 0) * Number(item.unitPrice || 0), 0);
    return Math.max(0, subtotal + Number(currentTax || 0) - Number(currentDiscount || 0));
  };

  const updateItem = (itemId: string, patch: Partial<EditableInvoiceItem>) => {
    const nextItems = items.map((item) => item.id === itemId ? { ...item, ...patch } : item);
    setItems(nextItems);
    setTotalAmount(computeTotal(nextItems, taxAmount, discount).toFixed(2));
    setError(null);
  };

  const handleSubmit = async () => {
    if (!invoice) return;

    setBusyId(invoice.id);
    setError(null);

    try {
      await invoiceRepository.update(invoice.id, {
        totalAmount: Number(totalAmount),
        items: items as any, // backend endpoint expected format
      });

      await runRefreshTasks(refreshInvoices, refreshProducts);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to update invoice');
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

  const moneyLabel = (label: string) => `${label} (${currencyCode})`;

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-100 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-3xl shadow-2xl border border-[#5A5A40]/10 overflow-hidden">
        <div className="px-6 py-4 bg-[#5A5A40] text-white flex items-center justify-between">
          <h3 className="text-base font-bold">Редактировать накладную</h3>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-white/10 transition-colors"
          >
            <X size={18} />
          </button>
        </div>
        <div className="p-6 space-y-4">
          <div className="rounded-2xl border border-[#5A5A40]/10 overflow-hidden">
            <div className="px-4 py-3 bg-[#f5f5f0]/60 text-xs font-bold uppercase tracking-widest text-[#5A5A40]/50">
              Позиции накладной
            </div>
            <div className="overflow-auto divide-y divide-[#5A5A40]/10" style={{ maxHeight: 320 }}>
              {items.map((item) => (
                <div key={item.id} className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-[#5A5A40]">{getProductDisplayLabel(item.productId, item.productName)}</p>
                      <p className="text-[11px] text-[#5A5A40]/55 mt-1">Продажа в единицах</p>
                    </div>
                    <p className="text-sm font-bold text-[#5A5A40]">{(item.quantity * item.unitPrice).toFixed(2)} {currencyCode}</p>
                  </div>

                  <div className="grid gap-3 grid-cols-1">
                    <label>
                      <span className="block text-[10px] font-bold uppercase tracking-widest text-[#5A5A40]/50 mb-1">Единицы</span>
                      <input
                        type="number"
                        min={1}
                        step={1}
                        value={item.quantity}
                        onChange={(e) => updateItem(item.id, { quantity: Math.max(1, Math.floor(Number(e.target.value) || 0)) })}
                        className="w-full px-3 py-2 rounded-xl border border-[#5A5A40]/15 text-sm outline-none focus:ring-2 focus:ring-[#5A5A40]/20"
                      />
                    </label>
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-widest text-[#5A5A40]/50 mb-1">Цена за единицу</label>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={item.unitPrice}
                      onChange={(e) => updateItem(item.id, { unitPrice: Math.max(0, Number(e.target.value) || 0) })}
                      className="w-full px-3 py-2 rounded-xl border border-[#5A5A40]/15 text-sm outline-none focus:ring-2 focus:ring-[#5A5A40]/20"
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div>
            <div className={`grid gap-3 text-sm ${taxAmount > 0 ? 'grid-cols-3' : 'grid-cols-2'}`}>
              <div className="rounded-2xl bg-[#f5f5f0]/60 px-4 py-3">
                <p className="text-[10px] font-bold uppercase tracking-widest text-[#5A5A40]/45 mb-1">{moneyLabel('Подытог')}</p>
                <p className="font-semibold text-[#5A5A40]">{items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0).toFixed(2)} {currencyCode}</p>
              </div>
              {taxAmount > 0 && (
                <div className="rounded-2xl bg-[#f5f5f0]/60 px-4 py-3">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-[#5A5A40]/45 mb-1">{moneyLabel('Налог')}</p>
                  <p className="font-semibold text-[#5A5A40]">{Number(taxAmount).toFixed(2)} {currencyCode}</p>
                </div>
              )}
              <div className="rounded-2xl bg-[#f5f5f0]/60 px-4 py-3">
                <p className="text-[10px] font-bold uppercase tracking-widest text-[#5A5A40]/45 mb-1">{moneyLabel('Итого')}</p>
                <p className="font-semibold text-[#5A5A40]">{Number(totalAmount).toFixed(2)} {currencyCode}</p>
              </div>
            </div>
          </div>
          {error && (
            <div className="p-3 bg-red-50 text-red-600 text-xs rounded-xl border border-red-100 flex items-center gap-2">
              <AlertCircle size={14} />
              {error}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3 pt-2">
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
              {busyId === invoice?.id ? 'Сохраняю...' : 'Сохранить'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
