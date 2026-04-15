import React, { useEffect, useState, useMemo } from 'react';
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
  Calendar,
  RefreshCw,
  TrendingUp,
  Package
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
  const [confirmModal, setConfirmModal] = useState<{ isOpen: boolean; id: string | null }>({ isOpen: false, id: null });

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
    setConfirmModal({ isOpen: false, id: null });
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
        alert(`Ошибка приёмки: ${JSON.stringify(body.error || body)}`);
      }
    } catch (err) {
      console.error('Approval failed:', err);
    } finally {
      setBusyId(null);
    }
  };

  const filteredInvoices = useMemo(() => {
    return invoices.filter(inv => 
      inv.invoiceNumber?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      inv.supplier?.name?.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [invoices, searchTerm]);

  const stats = useMemo(() => {
    const drafts = invoices.filter(i => i.status === 'DRAFT');
    const posted = invoices.filter(i => i.status === 'POSTED');
    const totalDraftSum = drafts.reduce((sum, i) => sum + Number(i.totalAmount), 0);
    const totalPostedSum = posted.reduce((sum, i) => sum + Number(i.totalAmount), 0);
    
    return {
      draftCount: drafts.length,
      postedCount: posted.length,
      draftSum: totalDraftSum,
      postedSum: totalPostedSum
    };
  }, [invoices]);

  return (
    <div className="flex-1 space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-[#5A5A40]">Приёмка товара</h2>
          <p className="text-sm text-[#5A5A40]/60 mt-1">Подтверждение поступлений и управление входящими накладными</p>
        </div>
        <div className="flex items-center gap-3">
          <button 
            onClick={fetchInvoices}
            disabled={isLoading}
            className="p-3 bg-white border border-[#5A5A40]/10 rounded-2xl text-[#5A5A40]/60 hover:text-[#5A5A40] transition-all hover:bg-[#f5f5f0] disabled:opacity-50"
          >
            <RefreshCw size={20} className={isLoading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Stats Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-[2rem] p-5 border border-[#5A5A40]/5 shadow-sm">
          <div className="flex items-center gap-3 mb-3 text-amber-600">
            <Clock size={16} />
            <span className="text-[10px] font-bold uppercase tracking-widest">Ожидают приёмки</span>
          </div>
          <p className="text-2xl font-black text-[#5A5A40]">{stats.draftCount}</p>
          <p className="text-xs text-[#5A5A40]/50 mt-1">на сумму {stats.draftSum.toFixed(2)} TJS</p>
        </div>
        <div className="bg-white rounded-[2rem] p-5 border border-[#5A5A40]/5 shadow-sm">
          <div className="flex items-center gap-3 mb-3 text-emerald-600">
            <CheckCircle2 size={16} />
            <span className="text-[10px] font-bold uppercase tracking-widest">Принято всего</span>
          </div>
          <p className="text-2xl font-black text-[#5A5A40]">{stats.postedCount}</p>
          <p className="text-xs text-[#5A5A40]/50 mt-1">на сумму {stats.postedSum.toFixed(2)} TJS</p>
        </div>
        <div className="bg-[#151619] rounded-[2rem] p-5 shadow-xl lg:col-span-2 text-white overflow-hidden relative group">
           <div className="absolute -right-12 -top-12 w-48 h-48 bg-white/5 rounded-full blur-3xl group-hover:scale-125 transition-transform" />
           <div className="relative z-10 flex h-full items-center justify-between">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-white/40 mb-2">Общий оборот закупок</p>
                <p className="text-3xl font-black italic tracking-tight">{(stats.draftSum + stats.postedSum).toLocaleString()} <span className="text-lg not-italic font-bold opacity-30 ml-1">TJS</span></p>
              </div>
              <div className="w-14 h-14 rounded-2xl bg-white/10 flex items-center justify-center backdrop-blur-md">
                <TrendingUp size={24} className="text-emerald-400" />
              </div>
           </div>
        </div>
      </div>

      <div className="flex flex-col gap-6 bg-white/30 backdrop-blur-xl rounded-[2.5rem] p-8 border border-white shadow-[0_20px_50px_rgba(90,90,64,0.05)]">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="relative group w-full max-w-md">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-[#5A5A40]/30 transition-colors group-focus-within:text-[#5A5A40]" size={18} />
            <input 
              type="text" 
              value={searchTerm} 
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Поиск по номеру накладной или поставщику..." 
              className="w-full pl-12 pr-4 py-3 bg-white/80 border border-[#5A5A40]/10 rounded-[1.25rem] text-sm outline-none focus:ring-4 focus:ring-[#5A5A40]/5 transition-all shadow-sm"
            />
          </div>
        </div>

        <div className="bg-white rounded-3xl border border-[#5A5A40]/5 overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[#f5f5f0]/95 text-[9px] uppercase tracking-[0.2em] text-[#5A5A40]/45 font-black border-b border-[#5A5A40]/5">
                  <th className="px-6 py-5">Документ</th>
                  <th className="px-6 py-5">Контрагент</th>
                  <th className="px-6 py-5">Дата</th>
                  <th className="px-6 py-5">Сумма</th>
                  <th className="px-6 py-5">Статус</th>
                  <th className="px-6 py-5">Создал</th>
                  <th className="px-6 py-5 text-right"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#5A5A40]/5">
                {isLoading ? (
                  <tr>
                    <td colSpan={7} className="p-20 text-center">
                      <div className="flex flex-col items-center gap-4">
                        <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-[#5A5A40]" />
                        <p className="text-xs font-bold uppercase tracking-widest text-[#5A5A40]/30">Загрузка накладных...</p>
                      </div>
                    </td>
                  </tr>
                ) : filteredInvoices.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-20 text-center">
                       <div className="flex flex-col items-center gap-4 opacity-20">
                          <Package size={64} />
                          <p className="text-sm font-bold uppercase tracking-widest">Накладные не найдены</p>
                       </div>
                    </td>
                  </tr>
                ) : (
                  filteredInvoices.map((inv) => (
                    <tr 
                      key={inv.id} 
                      className="hover:bg-[#f5f5f0]/40 transition-all group cursor-pointer"
                      onClick={() => setSelectedInvoice(inv)}
                    >
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className={`p-2.5 rounded-xl transition-all ${inv.status === 'POSTED' ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600 group-hover:scale-110'}`}>
                            <FileText size={20} />
                          </div>
                          <div>
                            <span className="block font-black text-[#5A5A40] text-sm leading-tight">{inv.invoiceNumber || 'ЧЕРНОВИК'}</span>
                            <span className="text-[10px] text-[#5A5A40]/40 font-bold uppercase tracking-wider">{inv.items?.length || 0} поз.</span>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <Truck size={14} className="text-[#5A5A40]/30" />
                          <span className="text-sm font-bold text-[#5A5A40]">{inv.supplier?.name}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-xs font-semibold text-[#5A5A40]/60">{new Date(inv.invoiceDate).toLocaleDateString()}</span>
                      </td>
                      <td className="px-6 py-4">
                        <span className="font-black text-[#5A5A40] text-base">{Number(inv.totalAmount).toLocaleString()}</span>
                        <span className="text-[10px] font-bold text-[#5A5A40]/30 ml-1 italic">TJS</span>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-wider border shadow-sm ${
                          inv.status === 'POSTED' 
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-100/50' 
                            : 'bg-amber-50 text-amber-700 border-amber-100/50'
                        }`}>
                          {inv.status === 'POSTED' ? <><CheckCircle2 size={10} /> Принято</> : <><Clock size={10} /> В обработке</>}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-col">
                          <span className="text-xs font-bold text-[#5A5A40]/60">{inv.createdBy?.name || '—'}</span>
                          <span className="text-[9px] text-[#5A5A40]/30 font-bold">{new Date(inv.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-right">
                         <div className="flex justify-end">
                            <div className="w-8 h-8 rounded-full border border-[#5A5A40]/10 flex items-center justify-center group-hover:bg-[#5A5A40] group-hover:text-white transition-all">
                              <ChevronRight size={16} />
                            </div>
                         </div>
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
          <div className="absolute inset-0 bg-[#151619]/80 backdrop-blur-md animate-in fade-in duration-300" onClick={() => setSelectedInvoice(null)} />
          <div className="relative w-full max-w-5xl bg-[#f5f5f0] rounded-[3rem] shadow-2xl border border-white/50 flex flex-col max-h-[90vh] overflow-hidden animate-in zoom-in-95 duration-300">
            {/* Modal Header */}
            <div className="p-10 bg-white border-b border-[#5A5A40]/5 flex items-center justify-between">
              <div className="flex items-center gap-6">
                 <div className={`w-16 h-16 rounded-3xl flex items-center justify-center shadow-lg ${
                    selectedInvoice.status === 'POSTED' ? 'bg-emerald-500 text-white' : 'bg-amber-500 text-white'
                 }`}>
                    <FileText size={32} />
                 </div>
                 <div>
                    <h3 className="text-2xl font-black text-[#5A5A40]">Накладная №{selectedInvoice.invoiceNumber}</h3>
                    <div className="flex items-center gap-3 mt-1">
                       <span className="text-xs font-bold text-[#5A5A40]/40 uppercase tracking-widest">{selectedInvoice.supplier?.name}</span>
                       <div className="w-1 h-1 rounded-full bg-[#5A5A40]/10" />
                       <span className="text-xs font-bold text-[#5A5A40]/40 uppercase tracking-widest">{new Date(selectedInvoice.invoiceDate).toLocaleDateString()}</span>
                    </div>
                 </div>
              </div>
              <div className={`px-5 py-2 rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] border-2 ${
                selectedInvoice.status === 'POSTED' 
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-100' 
                  : 'bg-amber-50 text-amber-700 border-amber-100'
              }`}>
                {selectedInvoice.status === 'POSTED' ? 'Проведено' : 'Ожидает решения'}
              </div>
            </div>

            {/* Modal Content */}
            <div className="p-10 overflow-y-auto custom-scrollbar flex-1 space-y-8">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="p-6 bg-white rounded-[2rem] border border-[#5A5A40]/5 shadow-sm">
                  <p className="text-[10px] font-black text-[#5A5A40]/30 uppercase tracking-[0.2em] mb-2">Сумма Итого</p>
                  <p className="text-2xl font-black text-[#5A5A40]">{Number(selectedInvoice.totalAmount).toLocaleString()}</p>
                </div>
                <div className="p-6 bg-white rounded-[2rem] border border-[#5A5A40]/5 shadow-sm">
                  <p className="text-[10px] font-black text-[#5A5A40]/30 uppercase tracking-[0.2em] mb-2">Налог / Скидка</p>
                  <p className="text-xs font-bold text-[#5A5A40]">{Number(selectedInvoice.taxAmount).toFixed(2)} / {Number(selectedInvoice.discountAmount).toFixed(2)}</p>
                </div>
                <div className="p-6 bg-white rounded-[2rem] border border-[#5A5A40]/5 shadow-sm">
                  <p className="text-[10px] font-black text-[#5A5A40]/30 uppercase tracking-[0.2em] mb-2">Точек приёмки</p>
                  <p className="text-xs font-bold text-[#5A5A40]">{selectedInvoice.warehouse?.name || 'Основной склад'}</p>
                </div>
                <div className="p-6 bg-white rounded-[2rem] border border-[#5A5A40]/5 shadow-sm">
                  <p className="text-[10px] font-black text-[#5A5A40]/30 uppercase tracking-[0.2em] mb-2">Дата создания</p>
                  <p className="text-xs font-bold text-[#5A5A40]">{new Date(selectedInvoice.createdAt).toLocaleString()}</p>
                </div>
              </div>

              <div className="bg-white rounded-[2.5rem] border border-[#5A5A40]/10 overflow-hidden shadow-xl shadow-[#5A5A40]/5">
                <div className="px-8 py-5 bg-[#f5f5f0]/50 border-b border-[#5A5A40]/5 flex items-center justify-between">
                   <h4 className="text-[11px] font-black text-[#5A5A40] uppercase tracking-[0.25em]">Спецификация товаров</h4>
                   <span className="px-3 py-1 bg-[#5A5A40]/5 rounded-lg text-[10px] font-bold text-[#5A5A40]/40">{selectedInvoice.items?.length || 0} наименований</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-white text-[#5A5A40]/30 text-[9px] font-black uppercase tracking-widest border-b border-[#5A5A40]/5">
                        <th className="px-8 py-4">Товар / Препарат</th>
                        <th className="px-6 py-4">Серия</th>
                        <th className="px-6 py-4">Годен до</th>
                        <th className="px-6 py-4 text-right">Кол-во</th>
                        <th className="px-6 py-4 text-right">В продаже</th>
                        <th className="px-6 py-4 text-right">Цена зак.</th>
                        <th className="px-8 py-4 text-right">Итого</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#5A5A40]/5">
                      {selectedInvoice.items?.map((item: any) => (
                        <tr key={item.id} className="hover:bg-[#f5f5f0]/30 transition-colors">
                          <td className="px-8 py-4">
                            <div className="flex flex-col">
                              <span className="font-black text-[#5A5A40] text-sm">{item.product?.name}</span>
                              <span className="text-[9px] text-[#5A5A40]/30 font-bold uppercase tracking-wider">{item.product?.category || 'Аптека'}</span>
                            </div>
                          </td>
                          <td className="px-6 py-4"><span className="px-2 py-1 bg-amber-50 text-amber-700 rounded-lg font-mono text-[10px] font-bold">{item.batchNumber}</span></td>
                          <td className="px-6 py-4 font-bold text-[#5A5A40]/60">{new Date(item.expiryDate).toLocaleDateString()}</td>
                          <td className="px-6 py-4 text-right font-black text-[#5A5A40]">{item.quantity}</td>
                          <td className="px-6 py-4 text-right">
                            {selectedInvoice.status === 'POSTED' ? (
                              <span className={(item.product?.batches?.find((b: any) => b.batchNumber === item.batchNumber)?.quantity || 0) > 0 ? "font-bold text-emerald-600" : "font-bold text-red-300"}>
                                {item.product?.batches?.find((b: any) => b.batchNumber === item.batchNumber)?.quantity || 0}
                              </span>
                            ) : (
                              <span className="text-[#5A5A40]/30">—</span>
                            )}
                          </td>
                          <td className="px-6 py-4 text-right font-bold text-[#5A5A40]/50">{Number(item.purchasePrice).toFixed(2)}</td>
                          <td className="px-8 py-4 text-right">
                             <span className="font-black text-[#5A5A40]">{Number(item.lineTotal).toFixed(2)}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-10 bg-white border-t border-[#5A5A40]/5 flex items-center justify-between">
              <button 
                onClick={() => setSelectedInvoice(null)}
                className="px-8 py-4 rounded-[1.25rem] text-xs font-black uppercase tracking-widest text-[#5A5A40]/40 hover:text-[#5A5A40] transition-colors"
              >
                Вернуться назад
              </button>
              <div className="flex items-center gap-4">
                 <button 
                  className="px-6 py-4 rounded-[1.25rem] bg-[#f5f5f0] text-[#5A5A40] text-xs font-black uppercase tracking-widest flex items-center gap-3 hover:bg-[#5A5A40] hover:text-white transition-all shadow-sm"
                >
                  <Printer size={18} /> Печать накладной
                </button>
                {selectedInvoice.status === 'DRAFT' && (
                  <button 
                    onClick={() => setConfirmModal({ isOpen: true, id: selectedInvoice.id })}
                    disabled={!!busyId}
                    className="px-10 py-4 rounded-[1.25rem] bg-[#5A5A40] text-white text-xs font-black uppercase tracking-[0.2em] shadow-2xl shadow-[#5A5A40]/30 hover:scale-105 active:scale-95 transition-all disabled:opacity-50 flex items-center gap-3"
                  >
                    {busyId === selectedInvoice.id ? (
                      <><RefreshCw size={18} className="animate-spin" /> Обработка...</>
                    ) : (
                      <><CheckCircle2 size={18} /> Провести документ</>
                    )}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Beautiful Confirmation Modal */}
      {confirmModal.isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-[#000]/60 backdrop-blur-md animate-in fade-in duration-500" onClick={() => setConfirmModal({ isOpen: false, id: null })} />
          <div className="relative w-full max-w-md bg-white rounded-[3rem] shadow-[0_32px_64px_-12px_rgba(0,0,0,0.3)] border border-white/40 p-10 animate-in zoom-in-95 slide-in-from-bottom-10 duration-500 overflow-hidden">
            {/* Visual background element */}
            <div className="absolute -right-20 -top-20 w-48 h-48 bg-amber-100/50 rounded-full blur-[80px]" />
            <div className="absolute -left-20 -bottom-20 w-48 h-48 bg-[#5A5A40]/5 rounded-full blur-[80px]" />

            <div className="relative flex flex-col items-center text-center">
              <div className="relative mb-8">
                 <div className="absolute inset-0 bg-amber-100 rounded-full animate-ping opacity-20 scale-150" />
                 <div className="relative w-24 h-24 rounded-full bg-amber-50 flex items-center justify-center text-amber-500 shadow-[inset_0_2px_4px_rgba(0,0,0,0.05)]">
                    <AlertCircle size={48} />
                 </div>
              </div>
              
              <h3 className="text-2xl font-black text-[#5A5A40] mb-3 tracking-tight">Подтверждение приёмки</h3>
              <p className="text-sm text-[#5A5A40]/60 mb-10 px-2 leading-relaxed">
                Вы собираетесь провести приёмку товара по данной накладной. Это действие <span className="font-black text-[#5A5A40]">обновит остатки</span> на складе и <span className="font-black text-[#5A5A40]">создаст новые партии</span>. Продолжить?
              </p>
              
              <div className="grid grid-cols-2 gap-4 w-full">
                <button 
                  onClick={() => setConfirmModal({ isOpen: false, id: null })}
                  className="py-5 bg-[#f5f5f0] text-[#5A5A40] rounded-[1.5rem] text-xs font-black uppercase tracking-widest hover:bg-[#eaeaec] transition-all active:scale-95 shadow-sm"
                >
                  Отмена
                </button>
                <button 
                  onClick={() => confirmModal.id && approveInvoice(confirmModal.id)}
                  className="py-5 bg-[#151619] text-white rounded-[1.5rem] text-xs font-black uppercase tracking-widest shadow-xl shadow-[#151619]/20 hover:bg-[#000] transition-all hover:scale-[1.02] active:scale-95"
                >
                  Да, провести
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PurchasesView;
