import React, { useState, useEffect, useRef } from 'react';
import { X, Barcode, AlertCircle } from 'lucide-react';
import { BarcodeEditModalState } from './types';

interface ProductBarcodeModalProps {
  state: BarcodeEditModalState | null;
  onClose: () => void;
  onSubmit: (productId: string, barcode: string) => Promise<void>;
  submitting: boolean;
}

export const ProductBarcodeModal: React.FC<ProductBarcodeModalProps> = ({
  state: initialState,
  onClose,
  onSubmit,
  submitting
}) => {
  const [barcode, setBarcode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (initialState) {
      setBarcode(initialState.barcode || '');
      setError(null);
      // Autofocus input after a short delay to ensure modal is rendered
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [initialState]);

  if (!initialState) return null;

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!barcode.trim()) {
      setError('Штрихкод не может быть пустым');
      return;
    }
    await onSubmit(initialState.product.id, barcode.trim());
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="p-6 border-b border-[#5A5A40]/10 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-amber-50 flex items-center justify-center text-amber-600">
              <Barcode size={20} />
            </div>
            <div>
              <h3 className="text-lg font-bold text-[#5A5A40]">Штрихкод товара</h3>
              <p className="text-xs text-[#5A5A40]/50 mt-0.5">{initialState.product.name}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 text-[#5A5A40]/50 hover:text-[#5A5A40]">
            <X size={20} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-[#5A5A40]/50 uppercase tracking-widest">Введите или отсканируйте</label>
            <input
              ref={inputRef}
              type="text"
              value={barcode}
              onChange={(e) => setBarcode(e.target.value)}
              placeholder="EAN-13, QR или др."
              className="w-full px-4 py-3 border border-[#5A5A40]/15 rounded-2xl text-sm focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 outline-none transition-all font-mono"
            />
          </div>

          {error && (
            <div className="p-3 bg-red-50 text-red-600 text-xs rounded-xl border border-red-100 flex items-center gap-2">
              <AlertCircle size={14} />
              {error}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="py-3 rounded-2xl border border-[#5A5A40]/15 text-sm font-semibold text-[#5A5A40] hover:bg-[#f5f5f0] transition-colors"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={submitting || !barcode.trim()}
              className="py-3 rounded-2xl bg-[#5A5A40] text-white text-sm font-semibold hover:bg-[#4A4A30] disabled:opacity-50 transition-colors"
            >
              {submitting ? 'Сохранение...' : 'Сохранить'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
