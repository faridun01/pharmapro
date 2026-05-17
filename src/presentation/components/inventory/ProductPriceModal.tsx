import React, { useState, useEffect } from 'react';
import { X, Clock, AlertCircle } from 'lucide-react';
import { Product } from '../../../core/domain';
import { PriceEditModalState, PriceHistoryEntry } from './types';
import { buildApiHeaders } from '../../../infrastructure/api';

interface ProductPriceModalProps {
  state: PriceEditModalState | null;
  onClose: () => void;
  onSubmit: (productId: string, costPrice: number, sellingPrice: number) => Promise<void>;
  submitting: boolean;
  currencyCode: string;
}

export const ProductPriceModal: React.FC<ProductPriceModalProps> = ({
  state: initialState,
  onClose,
  onSubmit,
  submitting,
  currencyCode,
}) => {
  const [costPrice, setCostPrice] = useState('0');
  const [sellingPrice, setSellingPrice] = useState('0');
  const [priceHistory, setPriceHistory] = useState<PriceHistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initialState) {
      setCostPrice(initialState.costPrice);
      setSellingPrice(initialState.sellingPrice);
      setError(null);
      fetchPriceHistory(initialState.product.id);
    }
  }, [initialState]);

  const fetchPriceHistory = async (productId: string) => {
    setHistoryLoading(true);
    try {
      const res = await fetch(`/api/products/${productId}/price-history`, {
        headers: await buildApiHeaders()
      });
      if (res.ok) {
        const data = await res.json();
        setPriceHistory(data);
      }
    } catch (err) {
      console.error('Failed to fetch price history', err);
    } finally {
      setHistoryLoading(false);
    }
  };

  if (!initialState) return null;

  const handleSubmit = async () => {
    const cp = Number(costPrice);
    const sp = Number(sellingPrice);
    if (isNaN(cp) || isNaN(sp) || sp < 0 || cp < 0) {
      setError('Укажите корректные цены');
      return;
    }
    await onSubmit(initialState.product.id, cp, sp);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-xl max-h-[90vh] flex flex-col overflow-hidden">
        <div className="p-6 border-b border-[#5A5A40]/10 flex items-center justify-between">
          <div>
            <h3 className="text-xl font-bold text-[#5A5A40]">Изменение цен</h3>
            <p className="text-sm text-[#5A5A40]/60 mt-1">{initialState.product.name}</p>
          </div>
          <button onClick={onClose} className="p-2 text-[#5A5A40]/50 hover:text-[#5A5A40]">
            <X size={20} />
          </button>
        </div>
        <div className="p-6 overflow-y-auto space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <label>
              <span className="block text-xs font-semibold uppercase tracking-widest text-[#5A5A40]/50 mb-1">Цена прихода</span>
              <input
                type="number"
                step="0.01"
                min={0}
                value={costPrice}
                onChange={(e) => setCostPrice(e.target.value)}
                className="w-full px-3 py-2.5 border border-[#5A5A40]/15 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#5A5A40]/20"
              />
            </label>
            <label>
              <span className="block text-xs font-semibold uppercase tracking-widest text-[#5A5A40]/50 mb-1">Цена продажи</span>
              <input
                type="number"
                step="0.01"
                min={0}
                value={sellingPrice}
                onChange={(e) => setSellingPrice(e.target.value)}
                className="w-full px-3 py-2.5 border border-[#5A5A40]/15 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#5A5A40]/20"
              />
            </label>
          </div>

          {error && (
            <div className="p-3 bg-red-50 text-red-600 text-xs rounded-xl border border-red-100 flex items-center gap-2">
              <AlertCircle size={14} />
              {error}
            </div>
          )}

          <div className="space-y-3">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-[#5A5A40]/50">
              <Clock size={14} />
              История изменений
            </div>
            {historyLoading ? (
              <p className="text-xs text-[#5A5A40]/40">Загрузка истории...</p>
            ) : priceHistory.length === 0 ? (
              <p className="text-xs text-[#5A5A40]/40 italic">История изменений пуста</p>
            ) : (
              <div className="space-y-2 max-h-48 overflow-y-auto pr-2">
                {priceHistory.map((entry) => (
                  <div key={entry.id} className="p-3 rounded-2xl bg-[#f5f5f0]/50 border border-[#5A5A40]/5 text-[11px]">
                    <div className="flex justify-between items-start mb-1 text-[#5A5A40]/70">
                      <span>{new Date(entry.createdAt).toLocaleString('ru-RU')}</span>
                      <span className="font-semibold">{entry.actorName}</span>
                    </div>
                    <div className="flex gap-4">
                      {entry.costPrice.new !== entry.costPrice.old && (
                        <div>
                          Приход: <span className="line-through opacity-40">{entry.costPrice.old?.toFixed(2)}</span> → <span className="font-bold">{entry.costPrice.new?.toFixed(2)}</span>
                        </div>
                      )}
                      {entry.sellingPrice.new !== entry.sellingPrice.old && (
                        <div>
                          Продажа: <span className="line-through opacity-40">{entry.sellingPrice.old?.toFixed(2)}</span> → <span className="font-bold">{entry.sellingPrice.new?.toFixed(2)}</span>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 pt-2">
            <button
              onClick={onClose}
              className="py-2.5 rounded-xl border border-[#5A5A40]/15 text-sm font-semibold text-[#5A5A40] hover:bg-[#f5f5f0] transition-colors"
            >
              Отмена
            </button>
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="py-2.5 rounded-xl bg-[#5A5A40] text-white text-sm font-semibold hover:bg-[#4A4A30] disabled:opacity-50 transition-colors"
            >
              {submitting ? 'Сохраняю...' : 'Применить изменения'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
