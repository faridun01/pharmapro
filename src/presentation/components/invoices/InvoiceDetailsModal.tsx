import React from 'react';
import { X, FileText, TrendingUp, TrendingDown, DollarSign, Calculator } from 'lucide-react';
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
    if (!productId) return baseName;
    const product = products.find((entry) => entry.id === productId);
    return formatProductDisplayName({
      name: baseName,
      countryOfOrigin: product?.countryOfOrigin,
    }, { includeCountry: true });
  };

  const moneyLabel = (label: string) => `${label} (${currencyCode})`;

  const items = buildInvoiceDisplayItems(invoice.items || []);
  
  // Calculate Totals
  const totalCost = items.reduce((sum, item) => {
    const costBasis = (item as any).batch?.costBasis || 0;
    return sum + (costBasis * Number(item.quantity || 0));
  }, 0);
  
  const totalSelling = Number(invoice.totalAmount || 0);
  const totalProfit = totalSelling - totalCost;

  return (
    <div className="fixed inset-0 z-110 flex items-center justify-center p-4 animate-in fade-in duration-300">
      <div className="absolute inset-0 bg-stone-900/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-4xl bg-white rounded-[2.5rem] shadow-2xl border border-white overflow-hidden">
        
        {/* Modern Header */}
        <div className="px-8 py-6 border-b border-[#5A5A40]/5 flex items-center justify-between bg-[#fcfbf7]/50">
           <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-[#5A5A40] text-white flex items-center justify-center shadow-lg shadow-[#5A5A40]/10">
                 <Calculator size={22} />
              </div>
              <div>
                 <h3 className="text-xl font-normal text-[#151619] tracking-tight">Финансовый отчет по сделке</h3>
                 <p className="text-[10px] text-[#5A5A40]/40 uppercase tracking-[0.2em] mt-0.5">Детальная калькуляция прибыльности</p>
              </div>
           </div>
           <button onClick={onClose} className="w-10 h-10 rounded-full bg-white border border-[#5A5A40]/5 flex items-center justify-center text-[#5A5A40]/40 hover:text-rose-500 transition-all shadow-sm"><X size={18} /></button>
        </div>

        <div className="p-8 space-y-8 max-h-[75vh] overflow-y-auto custom-scrollbar font-normal">
          
          {/* Quick Stats Overlay (Payment Info) */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 p-5 bg-[#fcfbf7] rounded-3xl border border-[#5A5A40]/5">
             <div>
                <p className="text-[9px] text-[#5A5A40]/30 uppercase tracking-widest mb-1">Оплата</p>
                <p className="text-xs text-[#151619]">{invoice.paymentType}</p>
             </div>
             <div>
                <p className="text-[9px] text-[#5A5A40]/30 uppercase tracking-widest mb-1">Статус</p>
                <p className="text-xs text-[#151619]">{invoice.status}</p>
             </div>
             <div>
                <p className="text-[9px] text-[#5A5A40]/30 uppercase tracking-widest mb-1">Баланс</p>
                <p className="text-xs text-[#151619] uppercase tracking-tighter">{invoice.paymentStatus || 'PAID'}</p>
             </div>
             <div>
                <p className="text-[9px] text-[#5A5A40]/30 uppercase tracking-widest mb-1">Номер</p>
                <p className="text-xs text-[#151619] font-mono">{invoice.invoiceNo || invoice.id.slice(0,8)}</p>
             </div>
          </div>

          <div className="space-y-4">
             <div className="flex items-center gap-2 px-1">
                <span className="text-[10px] text-[#5A5A40]/30 uppercase tracking-[0.2em]">Состав и себестоимость</span>
             </div>
             <div className="rounded-[2rem] border border-[#5A5A40]/5 overflow-hidden shadow-sm bg-white">
                <table className="w-full text-left">
                  <thead>
                    <tr className="bg-[#fcfbf7] border-b border-[#5A5A40]/5 text-[9px] text-[#5A5A40]/40 uppercase tracking-widest">
                      <th className="px-6 py-4 font-normal">№</th>
                      <th className="px-4 py-4 font-normal min-w-[200px]">Товар</th>
                      <th className="px-4 py-4 font-normal text-right">Кол-во</th>
                      <th className="px-4 py-4 font-normal text-right">Цена прод.</th>
                      <th className="px-6 py-4 font-normal text-right">Прибыль</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#5A5A40]/5">
                    {items.map((item, idx) => {
                      const costPrice = (item as any).batch?.costBasis || 0;
                      const profit = (Number(item.unitPrice || 0) - costPrice) * Number(item.quantity || 0);
                      return (
                        <tr key={item.id || idx} className="hover:bg-[#fcfbf7]/50 transition-colors text-xs">
                          <td className="px-6 py-4 text-[#5A5A40]/30">{idx + 1}</td>
                          <td className="px-4 py-4 text-[#151619]">{getProductDisplayLabel(item.productId, item.productName)}</td>
                          <td className="px-4 py-4 text-right text-[#5A5A40]/60 tabular-nums">{formatPackQuantity(Number(item.quantity || 0))}</td>
                          <td className="px-4 py-4 text-right text-[#151619] tabular-nums font-normal">{Number(item.unitPrice || 0).toFixed(2)}</td>
                          <td className={`px-6 py-4 text-right tabular-nums ${profit >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                             {profit.toFixed(2)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  {/* Internal Table Totals Row */}
                  <tfoot className="bg-[#fcfbf7]/30">
                     <tr className="border-t border-[#5A5A40]/10 text-[10px] uppercase tracking-widest">
                        <td colSpan={2} className="px-6 py-5 text-[#5A5A40]/40">Итого по позициям</td>
                        <td className="px-4 py-5 text-right font-normal text-[#151619]">{items.reduce((s, it) => s + Number(it.quantity || 0), 0)}</td>
                        <td className="px-4 py-5 text-right font-normal text-[#151619]">—</td>
                        <td className={`px-6 py-5 text-right font-normal ${totalProfit >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{totalProfit.toFixed(2)}</td>
                     </tr>
                  </tfoot>
                </table>
             </div>
          </div>

          {/* Final Financial Summary Section */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-4 border-t border-[#5A5A40]/5">
             <div className="p-6 bg-[#fcfbf7] rounded-[2rem] border border-[#5A5A40]/5">
                <p className="text-[10px] text-[#5A5A40]/30 uppercase tracking-[0.2em] mb-2 font-normal">Себестоимость</p>
                <p className="text-xl font-normal text-[#5A5A40]/60 tabular-nums italic">{totalCost.toFixed(2)} <span className="text-xs opacity-30">{currencyCode}</span></p>
             </div>
             <div className="p-6 bg-white rounded-[2rem] border border-[#5A5A40]/10 shadow-sm">
                <p className="text-[10px] text-[#5A5A40]/30 uppercase tracking-[0.2em] mb-2 font-normal">Цена продажи</p>
                <p className="text-xl font-normal text-[#151619] tabular-nums">{totalSelling.toFixed(2)} <span className="text-xs opacity-30">{currencyCode}</span></p>
             </div>
             <div className={`p-6 rounded-[2rem] border border-white shadow-xl shadow-[#5A5A40]/5 transition-all ${totalProfit >= 0 ? 'bg-emerald-50/50' : 'bg-rose-50/50'}`}>
                <div className="flex items-center justify-between mb-2">
                   <p className={`text-[10px] uppercase tracking-[0.2em] font-normal ${totalProfit >= 0 ? 'text-emerald-600/60' : 'text-rose-600/60'}`}>Чистая прибыль</p>
                   {totalProfit >= 0 ? <TrendingUp size={16} className="text-emerald-500" /> : <TrendingDown size={16} className="text-rose-500" />}
                </div>
                <p className={`text-xl font-normal tabular-nums ${totalProfit >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                   {totalProfit.toFixed(2)} <span className="text-xs opacity-30">{currencyCode}</span>
                </p>
             </div>
          </div>
        </div>
      </div>
    </div>
  );
};
