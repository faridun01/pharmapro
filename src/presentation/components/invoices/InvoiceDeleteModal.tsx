import React from 'react';
import { X } from 'lucide-react';
import { ApiInvoiceRepository } from '../../../infrastructure/api';
import { runRefreshTasks } from '../../../lib/utils';
import { usePharmacy } from '../../context';

interface InvoiceDeleteModalProps {
  isOpen: boolean;
  onClose: () => void;
  invoice: any | null;
  busyId: string | null;
  setBusyId: (id: string | null) => void;
}

export const InvoiceDeleteModal: React.FC<InvoiceDeleteModalProps> = ({
  isOpen,
  onClose,
  invoice,
  busyId,
  setBusyId,
}) => {
  const { refreshInvoices, refreshProducts } = usePharmacy();
  const invoiceRepository = new ApiInvoiceRepository();

  if (!isOpen || !invoice) return null;

  const handleSubmit = async () => {
    setBusyId(invoice.id);
    try {
      await invoiceRepository.delete(invoice.id);
      await runRefreshTasks(refreshInvoices, refreshProducts);
      onClose();
    } catch (err: any) {
      console.error('Failed to delete invoice', err);
      // Usually, error would be handled by a global toast or parent state,
      // but keeping it simple for now as per current UI.
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[110] bg-black/60 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-300">
      <div className="w-full max-w-sm bg-white rounded-[32px] shadow-[0_32px_80px_rgba(0,0,0,0.15)] border border-[#5A5A40]/5 overflow-hidden animate-in zoom-in-95 duration-300">
        <div className="p-8 text-center">
          <div className="mx-auto w-16 h-16 bg-red-50 text-red-500 rounded-2xl flex items-center justify-center mb-6">
            <X size={32} />
          </div>
          <h3 className="text-xl font-bold text-[#5A5A40] mb-2">Удаление документа</h3>
          <p className="text-sm text-[#5A5A40]/60 leading-relaxed mb-8">
            Вы уверены, что хотите удалить накладную <span className="font-bold text-[#5A5A40] underline decoration-red-200">{invoice.invoiceNo || invoice.id}</span>? Это действие приведет к корректировке остатков на складе.
          </p>
          <div className="flex flex-col gap-3">
            <button 
              onClick={handleSubmit} 
              disabled={busyId === invoice.id} 
              className="w-full py-4 rounded-2xl bg-red-600 text-white font-bold hover:bg-red-700 active:scale-[0.98] transition-all disabled:opacity-50 shadow-lg shadow-red-200"
            >
              {busyId === invoice.id ? 'Выполняется...' : 'Да, удалить'}
            </button>
            <button onClick={onClose} className="w-full py-4 rounded-2xl bg-[#f5f5f0] text-[#5A5A40] font-bold hover:bg-[#eaeaE0] transition-colors">
              Отмена
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
