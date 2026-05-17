import React from 'react';
import { X, AlertCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface ProductDeleteModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: () => Promise<void>;
  productName: string;
  submitting: boolean;
}

export const ProductDeleteModal: React.FC<ProductDeleteModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  productName,
  submitting,
}) => {
  const { t } = useTranslation();

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden border border-[#5A5A40]/10">
        <div className="p-5 bg-red-600 text-white flex items-center justify-between">
          <h3 className="text-lg font-bold">{t('Delete product')}</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 transition-colors">
            <X size={18} />
          </button>
        </div>
        <div className="p-6 space-y-5">
          <div className="flex gap-4">
            <div className="w-12 h-12 rounded-2xl bg-red-50 flex items-center justify-center text-red-600 flex-shrink-0">
                <AlertCircle size={24} />
            </div>
            <div>
                 <p className="text-sm text-[#5A5A40]/80">
                    {t('Delete product')}: <span className="font-semibold">{productName}</span>?
                </p>
                <p className="text-xs text-[#5A5A40]/50 mt-1">Это действие нельзя отменить. Все остатки по этому товару будут удалены.</p>
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button
                onClick={onClose}
                className="px-5 py-2.5 border border-[#5A5A40]/15 rounded-xl text-sm font-semibold text-[#5A5A40] hover:bg-[#f5f5f0] transition-colors"
            >
              {t('Cancel')}
            </button>
            <button
              onClick={onSubmit}
              disabled={submitting}
              className="px-5 py-2.5 bg-red-600 text-white rounded-xl text-sm font-semibold hover:bg-red-700 disabled:opacity-50 transition-colors shadow-lg shadow-red-200"
            >
              {submitting ? t('Deleting...') : t('Delete product')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
