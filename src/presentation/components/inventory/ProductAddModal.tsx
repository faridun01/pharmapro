import React, { useState, useEffect } from 'react';
import { X, AlertCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { NewProductForm } from './types';
import { generateBatchNumber, generateSku } from './utils';

interface ProductAddModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (form: NewProductForm) => Promise<void>;
  submitting: boolean;
}

const DEFAULT_FORM: NewProductForm = {
  name: '',
  sku: '',
  barcode: '',
  category: '',
  manufacturer: '',
  countryOfOrigin: '',
  minStock: 10,
  costPrice: 0,
  sellingPrice: 0,
  prescription: false,
  markingRequired: false,
  batchNumber: '',
  expiryDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
  initialUnits: 0,
};

export const ProductAddModal: React.FC<ProductAddModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  submitting,
}) => {
  const { t } = useTranslation();
  const [form, setForm] = useState<NewProductForm>(DEFAULT_FORM);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setForm(DEFAULT_FORM);
      setError(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSkuChange = (newSku: string) => {
    const newForm = { ...form, sku: newSku };
    if (!form.batchNumber || form.batchNumber.startsWith('#')) {
      newForm.batchNumber = generateBatchNumber(newSku);
    }
    setForm(newForm);
  };

  const nameChange = (name: string) => {
    const newForm = { ...form, name };
    if (!form.sku || form.sku.startsWith('ITEM-')) {
        const nextSku = generateSku(name);
        newForm.sku = nextSku;
        newForm.batchNumber = generateBatchNumber(nextSku);
    }
    setForm(newForm);
  };

  const handleSubmit = async () => {
    if (!form.name.trim()) {
      setError('Название обязательно');
      return;
    }
    if (!form.expiryDate) {
      setError('Срок годности обязателен');
      return;
    }
    await onSubmit(form);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="p-6 border-b border-[#5A5A40]/10 flex items-center justify-between">
          <h3 className="text-xl font-bold text-[#5A5A40]">{t('Manual Add Product')}</h3>
          <button onClick={onClose} className="p-2 text-[#5A5A40]/50 hover:text-[#5A5A40]">
            <X size={20} />
          </button>
        </div>
        <div className="p-6 overflow-y-auto space-y-6">
          <div className="space-y-3">
            <p className="text-sm font-semibold text-[#5A5A40] uppercase tracking-wider">{t('Product Information')} *</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-[#5A5A40] uppercase tracking-wider">{t('Name')} *</label>
                <input 
                  type="text"
                  className="w-full px-4 py-3 border border-[#5A5A40]/10 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#5A5A40]/20" 
                  value={form.name}
                  onChange={(e) => nameChange(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-[#5A5A40] uppercase tracking-wider">SKU</label>
                <input 
                  type="text"
                  className="w-full px-4 py-3 border border-[#5A5A40]/10 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#5A5A40]/20" 
                  value={form.sku}
                  onChange={(e) => handleSkuChange(e.target.value)}
                  placeholder="Можно оставить пустым"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-[#5A5A40] uppercase tracking-wider">{t('Barcode')}</label>
                <input 
                  type="text"
                  className="w-full px-4 py-3 border border-[#5A5A40]/10 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#5A5A40]/20" 
                  value={form.barcode}
                  onChange={(e) => setForm((s) => ({ ...s, barcode: e.target.value }))}
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-[#5A5A40] uppercase tracking-wider">{t('Category')}</label>
                <input 
                  type="text"
                  className="w-full px-4 py-3 border border-[#5A5A40]/10 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#5A5A40]/20" 
                  value={form.category}
                  onChange={(e) => setForm((s) => ({ ...s, category: e.target.value }))}
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-[#5A5A40] uppercase tracking-wider">{t('Manufacturer')}</label>
                <input 
                  type="text"
                  className="w-full px-4 py-3 border border-[#5A5A40]/10 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#5A5A40]/20" 
                  value={form.manufacturer}
                  onChange={(e) => setForm((s) => ({ ...s, manufacturer: e.target.value }))}
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-[#5A5A40] uppercase tracking-wider">Страна производства</label>
                <input 
                  type="text"
                  className="w-full px-4 py-3 border border-[#5A5A40]/10 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#5A5A40]/20" 
                  value={form.countryOfOrigin}
                  onChange={(e) => setForm((s) => ({ ...s, countryOfOrigin: e.target.value }))}
                  placeholder="Необязательно"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-[#5A5A40] uppercase tracking-wider">{t('Min stock')}</label>
                <input 
                  type="number"
                  className="w-full px-4 py-3 border border-[#5A5A40]/10 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#5A5A40]/20" 
                  value={form.minStock}
                  onChange={(e) => setForm((s) => ({ ...s, minStock: Number(e.target.value) || 0 }))}
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-[#5A5A40] uppercase tracking-wider">{t('Cost price')} *</label>
                <input 
                  type="number"
                  step="0.01"
                  className="w-full px-4 py-3 border border-[#5A5A40]/10 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#5A5A40]/20" 
                  value={form.costPrice}
                  onChange={(e) => setForm((s) => ({ ...s, costPrice: Number(e.target.value) || 0 }))}
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-[#5A5A40] uppercase tracking-wider">{t('Selling price')} *</label>
                <input 
                  type="number"
                  step="0.01"
                  className="w-full px-4 py-3 border border-[#5A5A40]/10 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#5A5A40]/20" 
                  value={form.sellingPrice}
                  onChange={(e) => setForm((s) => ({ ...s, sellingPrice: Number(e.target.value) || 0 }))}
                />
              </div>
            </div>
          </div>

          <div className="border-t border-[#5A5A40]/10 pt-6 space-y-3">
            <p className="text-sm font-semibold text-[#5A5A40] uppercase tracking-wider">{t('Initial Batch')} *</p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-[#5A5A40] uppercase tracking-wider">{t('Batch number')} (авто)</label>
                <div className="w-full px-4 py-3 border border-blue-200 rounded-xl text-sm bg-blue-50 font-semibold text-blue-600">
                  {form.batchNumber || '...'}
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-red-600 uppercase tracking-wider">{t('Expiry Date')} *</label>
                <input 
                  type="date"
                  className="w-full px-4 py-3 border border-red-200 rounded-xl text-sm outline-none font-semibold focus:ring-2 focus:ring-red-200/50" 
                  value={form.expiryDate}
                  onChange={(e) => setForm((s) => ({ ...s, expiryDate: e.target.value }))}
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-[#5A5A40] uppercase tracking-wider">Начальный остаток, ед.</label>
                <input
                  type="number"
                  className="w-full px-4 py-3 border border-[#5A5A40]/10 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#5A5A40]/20"
                  value={form.initialUnits}
                  onChange={(e) => setForm((s) => ({ ...s, initialUnits: Number(e.target.value) || 0 }))}
                />
              </div>
            </div>
          </div>

          <div className="border-t border-[#5A5A40]/10 pt-4 space-y-3">
            <p className="text-xs font-semibold text-[#5A5A40] uppercase tracking-wider">{t('Additional')}</p>
            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-3 text-sm text-[#5A5A40] cursor-pointer hover:bg-[#f5f5f0]/50 p-2 rounded-lg transition">
                <input 
                  type="checkbox" 
                  className="w-4 h-4 cursor-pointer"
                  checked={form.prescription}
                  onChange={(e) => setForm((s) => ({ ...s, prescription: e.target.checked }))}
                />
                {t('Prescription')}
              </label>
              <label className="flex items-center gap-3 text-sm text-[#5A5A40] cursor-pointer hover:bg-[#f5f5f0]/50 p-2 rounded-lg transition">
                <input 
                  type="checkbox" 
                  className="w-4 h-4 cursor-pointer"
                  checked={form.markingRequired}
                  onChange={(e) => setForm((s) => ({ ...s, markingRequired: e.target.checked }))}
                />
                {t('Marking required')}
              </label>
            </div>
          </div>

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2">
              <AlertCircle size={16} className="text-red-600" />
              <p className="text-red-600 text-sm font-semibold">{error}</p>
            </div>
          )}
        </div>
        <div className="p-6 border-t border-[#5A5A40]/10 flex justify-end gap-3">
          <button onClick={onClose} className="px-5 py-2.5 border border-[#5A5A40]/20 rounded-xl">{t('Cancel')}</button>
          <button onClick={handleSubmit} disabled={submitting} className="px-5 py-2.5 bg-[#5A5A40] text-white rounded-xl disabled:opacity-50">
            {submitting ? t('Saving...') : t('Save Product')}
          </button>
        </div>
      </div>
    </div>
  );
};
