import React, { useState, useEffect } from 'react';
import { X, AlertCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Product } from '../../../core/domain';

interface ProductEditModalProps {
  isOpen: boolean;
  product: Product | null;
  onClose: () => void;
  onSubmit: (id: string, updates: Partial<Product>) => Promise<void>;
  submitting: boolean;
}

export const ProductEditModal: React.FC<ProductEditModalProps> = ({
  isOpen,
  product,
  onClose,
  onSubmit,
  submitting,
}) => {
  const { t } = useTranslation();
  const [form, setForm] = useState<Partial<Product>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && product) {
      setForm({
        name: product.name,
        sku: product.sku,
        barcode: product.barcode,
        category: product.category,
        manufacturer: product.manufacturer,
        countryOfOrigin: product.countryOfOrigin,
        minStock: product.minStock,
        prescription: product.prescription,
        markingRequired: product.markingRequired,
      });
      setError(null);
    }
  }, [isOpen, product]);

  if (!isOpen || !product) return null;

  const handleSubmit = async () => {
    if (!form.name?.trim()) {
      setError('Название обязательно');
      return;
    }
    await onSubmit(product.id, form);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-[2.5rem] shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col font-normal">
        <div className="p-8 border-b border-[#5A5A40]/10 flex items-center justify-between">
          <div>
            <h3 className="text-xl font-normal text-[#151619] tracking-tight">Редактировать товар</h3>
            <p className="text-[10px] text-[#5A5A40]/40 uppercase tracking-widest mt-1">ID: {product.id}</p>
          </div>
          <button onClick={onClose} className="p-2 text-[#5A5A40]/50 hover:text-[#5A5A40] transition-colors">
            <X size={20} />
          </button>
        </div>
        
        <div className="p-8 overflow-y-auto space-y-8 custom-scrollbar">
          <div className="space-y-4">
            <p className="text-[10px] font-bold text-[#5A5A40] uppercase tracking-widest opacity-40">Основная информация</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-1.5 md:col-span-2">
                <label className="text-[10px] font-bold text-[#5A5A40] uppercase tracking-widest">{t('Name')} *</label>
                <input 
                  type="text"
                  className="w-full px-5 py-3.5 bg-[#fcfbf7] border border-[#5A5A40]/10 rounded-2xl text-sm outline-none focus:ring-4 focus:ring-[#5A5A40]/5 focus:bg-white transition-all" 
                  value={form.name || ''}
                  onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))}
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-[#5A5A40] uppercase tracking-widest">SKU</label>
                <input 
                  type="text"
                  className="w-full px-5 py-3.5 bg-[#fcfbf7] border border-[#5A5A40]/10 rounded-2xl text-sm outline-none focus:ring-4 focus:ring-[#5A5A40]/5 focus:bg-white transition-all" 
                  value={form.sku || ''}
                  onChange={(e) => setForm((s) => ({ ...s, sku: e.target.value }))}
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-[#5A5A40] uppercase tracking-widest">{t('Barcode')}</label>
                <input 
                  type="text"
                  className="w-full px-5 py-3.5 bg-[#fcfbf7] border border-[#5A5A40]/10 rounded-2xl text-sm outline-none focus:ring-4 focus:ring-[#5A5A40]/5 focus:bg-white transition-all" 
                  value={form.barcode || ''}
                  onChange={(e) => setForm((s) => ({ ...s, barcode: e.target.value }))}
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-[#5A5A40] uppercase tracking-widest">{t('Category')}</label>
                <input 
                  type="text"
                  className="w-full px-5 py-3.5 bg-[#fcfbf7] border border-[#5A5A40]/10 rounded-2xl text-sm outline-none focus:ring-4 focus:ring-[#5A5A40]/5 focus:bg-white transition-all" 
                  value={form.category || ''}
                  onChange={(e) => setForm((s) => ({ ...s, category: e.target.value }))}
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-[#5A5A40] uppercase tracking-widest">{t('Manufacturer')}</label>
                <input 
                  type="text"
                  className="w-full px-5 py-3.5 bg-[#fcfbf7] border border-[#5A5A40]/10 rounded-2xl text-sm outline-none focus:ring-4 focus:ring-[#5A5A40]/5 focus:bg-white transition-all" 
                  value={form.manufacturer || ''}
                  onChange={(e) => setForm((s) => ({ ...s, manufacturer: e.target.value }))}
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-[#5A5A40] uppercase tracking-widest">Страна</label>
                <input 
                  type="text"
                  className="w-full px-5 py-3.5 bg-[#fcfbf7] border border-[#5A5A40]/10 rounded-2xl text-sm outline-none focus:ring-4 focus:ring-[#5A5A40]/5 focus:bg-white transition-all" 
                  value={form.countryOfOrigin || ''}
                  onChange={(e) => setForm((s) => ({ ...s, countryOfOrigin: e.target.value }))}
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-[#5A5A40] uppercase tracking-widest">{t('Min stock')}</label>
                <input 
                  type="number"
                  className="w-full px-5 py-3.5 bg-[#fcfbf7] border border-[#5A5A40]/10 rounded-2xl text-sm outline-none focus:ring-4 focus:ring-[#5A5A40]/5 focus:bg-white transition-all" 
                  value={form.minStock || 0}
                  onChange={(e) => setForm((s) => ({ ...s, minStock: Number(e.target.value) || 0 }))}
                />
              </div>
            </div>
          </div>

          <div className="pt-6 border-t border-[#5A5A40]/5">
            <div className="flex flex-wrap gap-8">
              <label className="flex items-center gap-3 cursor-pointer group">
                <div className={`w-5 h-5 rounded-md border transition-all flex items-center justify-center ${form.prescription ? 'bg-[#5A5A40] border-[#5A5A40]' : 'bg-white border-[#5A5A40]/20'}`}>
                  {form.prescription && <div className="w-1.5 h-1.5 bg-white rounded-full" />}
                </div>
                <input 
                  type="checkbox" 
                  className="hidden"
                  checked={form.prescription || false}
                  onChange={(e) => setForm((s) => ({ ...s, prescription: e.target.checked }))}
                />
                <span className="text-[11px] font-bold text-[#5A5A40] uppercase tracking-widest opacity-60 group-hover:opacity-100 transition-opacity">{t('Prescription')}</span>
              </label>

              <label className="flex items-center gap-3 cursor-pointer group">
                <div className={`w-5 h-5 rounded-md border transition-all flex items-center justify-center ${form.markingRequired ? 'bg-[#5A5A40] border-[#5A5A40]' : 'bg-white border-[#5A5A40]/20'}`}>
                   {form.markingRequired && <div className="w-1.5 h-1.5 bg-white rounded-full" />}
                </div>
                <input 
                  type="checkbox" 
                  className="hidden"
                  checked={form.markingRequired || false}
                  onChange={(e) => setForm((s) => ({ ...s, markingRequired: e.target.checked }))}
                />
                <span className="text-[11px] font-bold text-[#5A5A40] uppercase tracking-widest opacity-60 group-hover:opacity-100 transition-opacity">{t('Marking required')}</span>
              </label>
            </div>
          </div>

          {error && (
            <div className="p-4 bg-rose-50 border border-rose-100 rounded-2xl flex items-center gap-3 animate-in slide-in-from-top-2 duration-300">
              <AlertCircle size={18} className="text-rose-600" />
              <p className="text-rose-600 text-xs font-bold uppercase tracking-widest">{error}</p>
            </div>
          )}
        </div>

        <div className="p-8 border-t border-[#5A5A40]/10 flex justify-end gap-3 bg-[#fcfbf7]/40 rounded-b-[2.5rem]">
          <button onClick={onClose} className="px-8 py-3.5 text-[10px] font-bold uppercase tracking-widest text-[#5A5A40]/40 hover:text-[#5A5A40] transition-colors">{t('Cancel')}</button>
          <button 
            onClick={handleSubmit} 
            disabled={submitting} 
            className="px-10 py-3.5 bg-[#5A5A40] text-white rounded-2xl text-[10px] font-bold uppercase tracking-widest shadow-xl shadow-[#5A5A40]/10 hover:translate-y-[-2px] active:translate-y-[0px] transition-all disabled:opacity-50 disabled:translate-y-0"
          >
            {submitting ? 'Сохранение...' : 'Обновить данные'}
          </button>
        </div>
      </div>
    </div>
  );
};
