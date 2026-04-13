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
    <div className="fixed inset-0 z-100 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-3xl shadow-2xl border border-[#5A5A40]/10 overflow-hidden">
        <div className="px-6 py-4 bg-red-600 text-white flex items-center justify-between">
          <h3 className="text-base font-bold">Удаление накладной</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 transition-colors">
            <X size={18} />
          </button>
        </div>
        <div className="p-6 space-y-5">
          <p className="text-sm text-[#5A5A40]/80">
            Удалить накладную <span className="font-semibold">{invoice.invoiceNo || invoice.id}</span>? 
            Остатки и связанные долги/платежи будут откатаны.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <button onClick={onClose} className="py-2.5 rounded-xl border border-[#5A5A40]/15 text-sm font-semibold text-[#5A5A40] hover:bg-[#f5f5f0] transition-colors">
              Отмена
            </button>
            <button 
              onClick={handleSubmit} 
              disabled={busyId === invoice.id} 
              className="py-2.5 rounded-xl bg-red-600 text-white text-sm font-semibold hover:bg-red-700 disabled:opacity-50 transition-colors"
            >
              {busyId === invoice.id ? 'Удаляю...' : 'Удалить'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
