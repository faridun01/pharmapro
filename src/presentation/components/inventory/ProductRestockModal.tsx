import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { Product } from '../../../core/domain';
import { RestockModalState } from './types';
import { usePharmacy } from '../../context';

interface ProductRestockModalProps {
  state: RestockModalState;
  onClose: () => void;
  onSubmit: (state: RestockModalState) => Promise<void>;
  products: Product[];
  submitting: boolean;
  currencyCode: string;
}

export const ProductRestockModal: React.FC<ProductRestockModalProps> = ({
  state: initialState,
  onClose,
  onSubmit,
  products,
  submitting,
  currencyCode,
}) => {
  const [state, setState] = useState<RestockModalState>(initialState);

  useEffect(() => {
    setState(initialState);
  }, [initialState]);

  if (!state.open) return null;

  const { suppliers } = usePharmacy();
  const selectedProduct = products.find((p) => p.id === state.productId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-xl max-h-[90vh] flex flex-col overflow-hidden">
        <div className="p-6 border-b border-[#5A5A40]/10 flex items-center justify-between">
          <div>
            <h3 className="text-xl font-bold text-[#5A5A40]">Добавление партии</h3>
            <p className="text-sm text-[#5A5A40]/60 mt-1">Приход сохраняется прямо под товаром и попадает в историю партии.</p>
          </div>
          <button onClick={onClose} className="p-2 text-[#5A5A40]/50 hover:text-[#5A5A40]">
            <X size={20} />
          </button>
        </div>
        <div className="p-6 overflow-y-auto space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label>
              <span className="block text-xs font-semibold uppercase tracking-widest text-[#5A5A40]/50 mb-1">Товар</span>
              <select
                value={state.productId}
                onChange={(e) => setState((prev) => ({ ...prev, productId: e.target.value }))}
                className="w-full px-3 py-2.5 border border-[#5A5A40]/15 rounded-xl text-sm"
              >
                <option value="">Выберите товар</option>
                {products.map((product) => (
                  <option key={product.id} value={product.id}>{product.name}</option>
                ))}
              </select>
            </label>
            <label>
              <span className="block text-xs font-semibold uppercase tracking-widest text-[#5A5A40]/50 mb-1">Поставщик *</span>
              <select
                value={state.supplierId}
                onChange={(e) => setState((prev) => ({ ...prev, supplierId: e.target.value }))}
                className="w-full px-3 py-2.5 border border-[#5A5A40]/15 rounded-xl text-sm"
                required
              >
                <option value="">Выберите поставщика</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </label>
            <label>
              <span className="block text-xs font-semibold uppercase tracking-widest text-[#5A5A40]/50 mb-1">Номер партии</span>
              <input
                type="text"
                value={state.batchNumber}
                onChange={(e) => setState((prev) => ({ ...prev, batchNumber: e.target.value }))}
                className="w-full px-3 py-2.5 border border-[#5A5A40]/15 rounded-xl text-sm"
              />
            </label>
            <label>
              <span className="block text-xs font-semibold uppercase tracking-widest text-[#5A5A40]/50 mb-1">Количество</span>
              <input
                type="number"
                min={1}
                step={1}
                value={state.quantity}
                onChange={(e) => setState((prev) => ({ ...prev, quantity: e.target.value }))}
                className="w-full px-3 py-2.5 border border-[#5A5A40]/15 rounded-xl text-sm"
              />
            </label>
            <label>
              <span className="block text-xs font-semibold uppercase tracking-widest text-[#5A5A40]/50 mb-1">Единица</span>
              <input
                type="text"
                value={state.unit}
                onChange={(e) => setState((prev) => ({ ...prev, unit: e.target.value }))}
                className="w-full px-3 py-2.5 border border-[#5A5A40]/15 rounded-xl text-sm"
              />
            </label>
            <label>
              <span className="block text-xs font-semibold uppercase tracking-widest text-[#5A5A40]/50 mb-1">Цена прихода</span>
              <input
                type="number"
                min={0}
                step="0.01"
                value={state.costBasis}
                onChange={(e) => setState((prev) => ({ ...prev, costBasis: e.target.value }))}
                className="w-full px-3 py-2.5 border border-[#5A5A40]/15 rounded-xl text-sm"
              />
            </label>
            <label className="md:col-span-2">
              <span className="block text-xs font-semibold uppercase tracking-widest text-[#5A5A40]/50 mb-1">Срок годности</span>
              <input
                type="date"
                value={state.expiryDate}
                onChange={(e) => setState((prev) => ({ ...prev, expiryDate: e.target.value }))}
                className="w-full px-3 py-2.5 border border-[#5A5A40]/15 rounded-xl text-sm"
              />
            </label>
          </div>


          {state.error && (
            <div className="p-3 bg-red-50 text-red-600 text-xs rounded-xl border border-red-100">
              {state.error}
            </div>
          )}

          {selectedProduct && (
            <div className="rounded-2xl bg-[#f5f5f0] px-4 py-3 text-sm text-[#5A5A40]">
              Продажная цена будет взята из карточки товара: <span className="font-bold">{Number(selectedProduct.sellingPrice || 0).toFixed(2)} {currencyCode}</span>
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
              onClick={() => onSubmit(state)}
              disabled={submitting}
              className="py-2.5 rounded-xl bg-[#5A5A40] text-white text-sm font-semibold hover:bg-[#4A4A30] disabled:opacity-50 transition-colors"
            >
              {submitting ? 'Сохраняю...' : 'Сохранить приход'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
