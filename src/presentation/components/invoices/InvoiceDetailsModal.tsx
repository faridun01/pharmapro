import React from 'react';
import { X, FileText } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { buildInvoiceDisplayItems, formatPackQuantity } from './utils';
import { formatProductDisplayName } from '../../../lib/productDisplay';
import { usePharmacy } from '../../context';

interface InvoiceDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  invoice: any | null;
  currencyCode: string;
}

export const InvoiceDetailsModal: React.FC<InvoiceDetailsModalProps> = ({
  isOpen,
  onClose,
  invoice,
  currencyCode,
}) => {
  const { t } = useTranslation();
  const { products } = usePharmacy();

  if (!isOpen || !invoice) return null;

  const getProductDisplayLabel = (productId?: string, fallbackName?: string) => {
    const baseName = String(fallbackName || '-').trim() || '-';
    if (!productId) {
      return baseName;
    }

    const product = products.find((entry) => entry.id === productId);
    return formatProductDisplayName({
      name: baseName,
      countryOfOrigin: product?.countryOfOrigin,
    }, { includeCountry: true });
  };

  const moneyLabel = (label: string) => `${label} (${currencyCode})`;

  return (
    <div className="fixed inset-0 z-110 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-3xl bg-white rounded-3xl shadow-2xl border border-[#5A5A40]/10 overflow-hidden">
        <div className="px-6 py-4 bg-[#5A5A40] text-white flex items-center justify-between">
          <h3 className="text-base font-bold">Детали накладной</h3>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-white/10 transition-colors"
          >
            <X size={18} />
          </button>
        </div>
        <div className="p-6 space-y-4 max-h-[75vh] overflow-auto">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
            <div>Накладная: <span className="font-semibold">{invoice.invoiceNo || invoice.id}</span></div>
            <div>Дата: <span className="font-semibold">{new Date(invoice.createdAt).toLocaleString('ru-RU')}</span></div>
            <div>Оплата: <span className="font-semibold">{invoice.paymentType}</span></div>
            <div>Статус: <span className="font-semibold">{invoice.status}</span></div>
            <div>Статус оплаты: <span className="font-semibold">{invoice.paymentStatus || 'PAID'}</span></div>
          </div>

          <div className="rounded-2xl border border-[#5A5A40]/10 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-[#f5f5f0]/60 text-[#5A5A40]/70 text-xs uppercase">
                <tr>
                  <th className="px-3 py-2 text-left">№</th>
                  <th className="px-3 py-2 text-left">Товар</th>
                  <th className="px-3 py-2 text-right">Кол-во</th>
                  <th className="px-3 py-2 text-right">{moneyLabel('Цена')}</th>
                  <th className="px-3 py-2 text-right">{moneyLabel('Сумма')}</th>
                </tr>
              </thead>
              <tbody>
                {buildInvoiceDisplayItems(invoice.items || []).map((item, idx) => (
                  <tr key={item.id || idx} className="border-t border-[#5A5A40]/10">
                    <td className="px-3 py-2">{idx + 1}</td>
                    <td className="px-3 py-2">{getProductDisplayLabel(item.productId, item.productName)}</td>
                    <td className="px-3 py-2 text-right">{formatPackQuantity(Number(item.quantity || 0))}</td>
                    <td className="px-3 py-2 text-right">{Number(item.unitPrice || 0).toFixed(2)}</td>
                    <td className="px-3 py-2 text-right">{Number(item.totalPrice || 0).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-end text-lg font-bold text-[#5A5A40]">
            {moneyLabel('Итого')}: {Number(invoice.totalAmount || 0).toFixed(2)} {currencyCode}
          </div>
        </div>
      </div>
    </div>
  );
};
