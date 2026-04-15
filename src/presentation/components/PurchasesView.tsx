import React, { useEffect, useState } from 'react';
import { 
  CheckCircle2, 
  Clock, 
  FileText, 
  Search, 
  Printer, 
  ChevronRight,
  AlertCircle,
  Truck,
  Box,
  Calendar
} from 'lucide-react';
import { usePharmacy } from '../context';
import { buildApiHeaders } from '../../infrastructure/api';

export const PurchasesView: React.FC = () => {
  const { suppliers } = usePharmacy();
  const [invoices, setInvoices] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [selectedInvoice, setSelectedInvoice] = useState<any | null>(null);

  const fetchInvoices = async () => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/inventory/purchase-invoices', {
        headers: await buildApiHeaders()
      });
      if (response.ok) {
        const data = await response.json();
        setInvoices(data);
      }
    } catch (err) {
      console.error('Failed to fetch purchase invoices:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchInvoices();
  }, []);

  const approveInvoice = async (id: string) => {
    setBusyId(id);
    try {
      const response = await fetch(`/api/inventory/purchase-invoices/${id}/approve`, {
        method: 'POST',
        headers: await buildApiHeaders()
      });
      if (response.ok) {
        await fetchInvoices();
        setSelectedInvoice(null);
      } else {
        const body = await response.json();
        alert(`Ошибка приёмки: ${body.error || 'Unknown error'}`);
      }
    } catch (err) {
      console.error('Approval failed:', err);
    } finally {
      setBusyId(null);
    }
  };

  const filteredInvoices = invoices.filter(inv => 
    inv.invoiceNumber?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    inv.supplier?.name?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="flex-1 space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-[#5A5A40]">Приёмка товара</h2>
          <p className="text-sm text-[#5A5A40]/60 mt-1">Управление накладными от поставщиков и подтверждение поступлений</p>
        </div>
      </div>

      <div className="flex flex-col gap-4 bg-white/50 backdrop-blur-md rounded-3xl p-6 border border-[#5A5A40]/5 shadow-sm">
        <div className="relative group w-full max-w-md">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-[#5A5A40]/30" size={18} />
          <input 
            type="text" 
            value={searchTerm} 
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Поиск по номеру накладной или поставщику..." 
            className="w-full pl-12 pr-4 py-2.5 bg-white border border-[#5A5A40]/10 rounded-2xl text-sm outline-none focus:ring-2 focus:ring-[#5A5A40]/20 transition-all shadow-sm"
          />
        </div>

        <div className="bg-white rounded-3xl border border-[#5A5A40]/5 overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[#f5f5f0]/95 text-[9px] uppercase tracking-[0.2em] text-[#5A5A40]/45 font-bold">
                  <th className="px-6 py-4">Накладная</th>
                  <th className="px-6 py-4">Поставщик</th>
                  <th className="px-6 py-4">Дата</th>
                  <th className="px-6 py-4">Сумма</th>
                  <th className="px-6 py-4">Статус</th>
                  <th className="px-6 py-4">Автор</th>
                  <th className="px-6 py-4 text-right">Действие</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#5A5A40]/5">
                {isLoading ? (
                  <tr><td colSpan={7} className="p-12 text-center text-[#5A5A40]/40 text-sm">Загрузка данных...</td></tr>
                ) : filteredInvoices.length === 0 ? (
                  <tr><td colSpan={7} className="p-12 text-center text-[#5A5A40]/40 text-sm">Накладные не найдены</td></tr>
                ) : (
                  filteredInvoices.map((inv) => (
                    <tr 
                      key={inv.id} 
                      className="hover:bg-[#f5f5f0]/40 transition-colors group cursor-pointer"
                      onClick={() => setSelectedInvoice(inv)}
                    >
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className={`p-2 rounded-xl ${inv.status === 'POSTED' ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}>
                            <FileText size={18} />
                          </div>
                          <span className="font-bold text-[#5A5A40]">{inv.invoiceNumber || 'ЧЕРНОВИК'}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-sm font-semibold text-[#5A5A40]">{inv.supplier?.name}</span>
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-xs text-[#5A5A40]/60">{new Date(inv.invoiceDate).toLocaleDateString()}</span>
                      </td>
                      <td className="px-6 py-4">
                        <span className="font-bold text-[#5A5A40] underline decoration-[#5A5A40]/10 decoration-2 underline-offset-4">{Number(inv.totalAmount).toFixed(2)}</span>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider border ${
                          inv.status === 'POSTED' 
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-100' 
                            : 'bg-amber-50 text-amber-700 border-amber-100'
                        }`}>
                          {inv.status === 'POSTED' ? <><CheckCircle2 size={10} /> Принято</> : <><Clock size={10} /> Ожидает приёмки</>}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-xs text-[#5A5A40]/50">
                        {inv.createdBy?.name || '—'}
                      </td>
                      <td className="px-6 py-4 text-right">
                         <ChevronRight size={18} className="text-[#5A5A40]/20 group-hover:text-[#5A5A40] transition-colors ml-auto" />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Details Modal */}
      {selectedInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-[#151619]/60 backdrop-blur-sm" onClick={() => setSelectedInvoice(null)} />
          <div className="relative w-full max-w-4xl bg-white rounded-[2.5rem] shadow-2xl border border-[#5A5A40]/10 flex flex-col max-h-[85vh] overflow-hidden">
            <div className="p-8 border-b border-[#5A5A40]/5 flex items-center justify-between">
              <div>
                <h3 className="text-xl font-bold text-[#5A5A40]">Накладная №{selectedInvoice.invoiceNumber}</h3>
                <p className="text-xs text-[#5A5A40]/40 font-bold uppercase tracking-widest mt-1">
                  От {new Date(selectedInvoice.invoiceDate).toLocaleDateString()} | Поставщик: {selectedInvoice.supplier?.name}
                </p>
              </div>
              <div className={`px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest border ${
                selectedInvoice.status === 'POSTED' 
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-100' 
                  : 'bg-amber-50 text-amber-700 border-amber-100'
              }`}>
                {selectedInvoice.status === 'POSTED' ? 'Принято' : 'Ожидает приёмки'}
              </div>
            </div>

            <div className="p-8 overflow-y-auto custom-scrollbar flex-1">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                <div className="p-4 bg-[#f5f5f0]/50 rounded-2xl border border-[#5A5A40]/5">
                  <p className="text-[10px] font-bold text-[#5A5A40]/40 uppercase tracking-widest mb-1">Общая сумма</p>
                  <p className="text-xl font-black text-[#5A5A40]">{Number(selectedInvoice.totalAmount).toFixed(2)}</p>
                </div>
                <div className="p-4 bg-[#f5f5f0]/50 rounded-2xl border border-[#5A5A40]/5">
                  <p className="text-[10px] font-bold text-[#5A5A40]/40 uppercase tracking-widest mb-1">Склад</p>
                  <p className="text-xs font-bold text-[#5A5A40]">{selectedInvoice.warehouse?.name || 'Основной'}</p>
                </div>
                <div className="p-4 bg-[#f5f5f0]/50 rounded-2xl border border-[#5A5A40]/5">
                  <p className="text-[10px] font-bold text-[#5A5A40]/40 uppercase tracking-widest mb-1">Позиций</p>
                  <p className="text-xs font-bold text-[#5A5A40]">{selectedInvoice.items?.length || 0} товаров</p>
                </div>
                <div className="p-4 bg-[#f5f5f0]/50 rounded-2xl border border-[#5A5A40]/5">
                  <p className="text-[10px] font-bold text-[#5A5A40]/40 uppercase tracking-widest mb-1">Создано</p>
                  <p className="text-xs font-bold text-[#5A5A40]">{new Date(selectedInvoice.createdAt).toLocaleDateString()}</p>
                </div>
              </div>

              <div className="space-y-4">
                <h4 className="text-xs font-black text-[#5A5A40] uppercase tracking-wider">Состав накладной</h4>
                <div className="bg-white rounded-2xl border border-[#5A5A40]/10 overflow-hidden">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-[#f5f5f0]/50 text-[#5A5A40]/50 font-bold uppercase tracking-widest">
                        <th className="px-4 py-3">Товар</th>
                        <th className="px-4 py-3">Серия / Партия</th>
                        <th className="px-4 py-3">Годен до</th>
                        <th className="px-4 py-3 text-right">Кол-во</th>
                        <th className="px-4 py-3 text-right">Цена зак.</th>
                        <th className="px-4 py-3 text-right">Итого</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#5A5A40]/5">
                      {selectedInvoice.items?.map((item: any) => (
                        <tr key={item.id} className="hover:bg-[#f5f5f0]/20">
                          <td className="px-4 py-3 font-bold text-[#5A5A40]">{item.product?.name}</td>
                          <td className="px-4 py-3 text-[#5A5A40]/60 font-mono uppercase">{item.batchNumber}</td>
                          <td className="px-4 py-3 text-[#5A5A40]/60">{new Date(item.expiryDate).toLocaleDateString()}</td>
                          <td className="px-4 py-3 text-right font-bold">{item.quantity}</td>
                          <td className="px-4 py-3 text-right">{Number(item.purchasePrice).toFixed(2)}</td>
                          <td className="px-4 py-3 text-right font-bold text-[#5A5A40]">{Number(item.lineTotal).toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="p-8 bg-[#f5f5f0]/30 border-t border-[#5A5A40]/5 flex items-center justify-between">
              <button 
                onClick={() => setSelectedInvoice(null)}
                className="px-6 py-3 rounded-2xl text-xs font-bold text-[#5A5A40]/60 hover:text-[#5A5A40] transition-colors"
              >
                Закрыть окно
              </button>
              <div className="flex items-center gap-3">
                 <button 
                  className="px-6 py-3 rounded-2xl bg-white border border-[#5A5A40]/10 text-xs font-bold text-[#5A5A40] flex items-center gap-2 hover:bg-[#f5f5f0] transition-colors"
                >
                  <Printer size={16} /> Печать Акта
                </button>
                {selectedInvoice.status === 'DRAFT' && (
                  <button 
                    onClick={() => approveInvoice(selectedInvoice.id)}
                    disabled={!!busyId}
                    className="px-8 py-3 rounded-2xl bg-[#5A5A40] text-white text-xs font-black uppercase tracking-widest shadow-xl shadow-[#5A5A40]/20 hover:scale-105 transition-transform disabled:opacity-50"
                  >
                    {busyId === selectedInvoice.id ? 'Приёмка...' : 'Подтвердить приёмку'}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PurchasesView;
