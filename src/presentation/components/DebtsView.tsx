import React, { useEffect, useState, useMemo } from 'react';
import { 
  Search, 
  Calendar, 
  ArrowUpRight, 
  User, 
  CheckCircle2, 
  AlertCircle, 
  Clock,
  ChevronRight,
  Filter,
  ArrowRight,
  X
} from 'lucide-react';
import { usePharmacy } from '../context';
import { buildApiHeaders } from '../../infrastructure/api';

export const DebtsView: React.FC = () => {
  const [debts, setDebts] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filter, setFilter] = useState<'ALL' | 'UNPAID' | 'PARTIAL'>('ALL');
  const [paymentModal, setPaymentModal] = useState<any | null>(null);
  const [paying, setPaying] = useState(false);
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState<'CASH' | 'CARD'>('CASH');

  const fetchDebts = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/reports/debts', {
        headers: await buildApiHeaders(),
      });
      const data = await response.json();
      setDebts(data.items || []);
      setSummary(data.summary || null);
    } catch (err) {
      console.error('Failed to fetch debts', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchDebts();
  }, []);

  const handlePayDebt = async () => {
    if (!paymentModal || !payAmount || paying) return;
    setPaying(true);
    try {
      // paymentModal now has an id from the Invoice object
      const response = await fetch(`/api/sales/pay-debt/${paymentModal.id}`, {
        method: 'POST',
        headers: await buildApiHeaders(),
        body: JSON.stringify({
          amount: Number(payAmount),
          paymentMethod: payMethod
        })
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || errorData.message || 'Payment failed');
      }
      setPaymentModal(null);
      setPayAmount('');
      void fetchDebts();
    } catch (err: any) {
      console.error(err);
      alert(`Ошибка при оплате долга: ${err.message}`);
    } finally {
      setPaying(false);
    }
  };

  // Group debts by customer
  const groupedDebts = useMemo(() => {
    const groups: Record<string, { 
      customer: string; 
      totalDebt: number; 
      paidAmount: number; 
      remaining: number; 
      invoices: any[]; 
      lastActivity: Date 
    }> = {};

    debts.forEach(debt => {
      const name = debt.customer || 'Аноним';
      if (!groups[name]) {
        groups[name] = { 
          customer: name, 
          totalDebt: 0, 
          paidAmount: 0, 
          remaining: 0, 
          invoices: [], 
          lastActivity: new Date(debt.createdAt) 
        };
      }
      const paid = Number(debt.debt?.paidAmount || 0);
      const total = Number(debt.debt?.originalAmount || debt.totalAmount);
      
      groups[name].totalDebt += total;
      groups[name].paidAmount += paid;
      groups[name].remaining += (total - paid);
      groups[name].invoices.push(debt);
      
      const dDate = new Date(debt.createdAt);
      if (dDate > groups[name].lastActivity) groups[name].lastActivity = dDate;
    });

    return Object.values(groups).filter(g => {
      const matchesSearch = g.customer.toLowerCase().includes(searchTerm.toLowerCase());
      if (filter === 'UNPAID') return matchesSearch && g.paidAmount === 0;
      if (filter === 'PARTIAL') return matchesSearch && g.paidAmount > 0;
      return matchesSearch;
    }).sort((a, b) => b.lastActivity.getTime() - a.lastActivity.getTime());
  }, [debts, searchTerm, filter]);

  const [expandedCustomer, setExpandedCustomer] = useState<string | null>(null);

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Header Summary Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white p-6 rounded-[32px] border border-[#5A5A40]/5 shadow-sm group hover:shadow-md transition-all">
          <div className="flex items-center justify-between mb-4">
            <div className="w-10 h-10 bg-amber-50 text-amber-600 rounded-2xl flex items-center justify-center">
              <AlertCircle size={20} />
            </div>
          </div>
          <h3 className="text-[#5A5A40]/50 text-[10px] font-black uppercase tracking-widest mb-1">Общий долг</h3>
          <p className="text-2xl font-black text-[#5A5A40] tabular-nums">{summary?.totalDebt?.toFixed(2) || '0.00'} TJS</p>
        </div>

        <div className="bg-white p-6 rounded-[32px] border border-[#5A5A40]/5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div className="w-10 h-10 bg-red-50 text-red-600 rounded-2xl flex items-center justify-center">
              <Clock size={20} />
            </div>
          </div>
          <h3 className="text-[#5A5A40]/50 text-[10px] font-black uppercase tracking-widest mb-1">Неоплачено</h3>
          <p className="text-2xl font-black text-[#5A5A40] tabular-nums">{summary?.unpaidCount || 0}</p>
        </div>

        <div className="bg-white p-6 rounded-[32px] border border-[#5A5A40]/5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div className="w-10 h-10 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center">
              <Filter size={20} />
            </div>
          </div>
          <h3 className="text-[#5A5A40]/50 text-[10px] font-black uppercase tracking-widest mb-1">Частично</h3>
          <p className="text-2xl font-black text-[#5A5A40] tabular-nums">{summary?.partialCount || 0}</p>
        </div>

        <div className="bg-white p-6 rounded-[32px] border border-[#5A5A40]/5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div className="w-10 h-10 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center">
              <User size={20} />
            </div>
          </div>
          <h3 className="text-[#5A5A40]/50 text-[10px] font-black uppercase tracking-widest mb-1">Всего клиентов</h3>
          <p className="text-2xl font-black text-[#5A5A40] tabular-nums">{groupedDebts.length}</p>
        </div>
      </div>

      {/* Constraints & Filters */}
      <div className="bg-white rounded-[32px] border border-[#5A5A40]/5 shadow-sm p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4 flex-1 min-w-[300px]">
          <div className="relative flex-1">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-[#5A5A40]/30" size={18} />
            <input 
              type="text" 
              placeholder="Поиск по имени клиента..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-12 pr-4 py-3 bg-[#f5f5f0]/50 border-none rounded-2xl text-sm focus:ring-2 focus:ring-[#5A5A40]/10 outline-none transition-all"
            />
          </div>
          <div className="flex bg-[#f5f5f0]/50 p-1 rounded-2xl">
            {(['ALL', 'UNPAID', 'PARTIAL'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${filter === f ? 'bg-white text-[#5A5A40] shadow-sm' : 'text-[#5A5A40]/40 hover:text-[#5A5A40]'}`}
              >
                {f === 'ALL' ? 'Все' : f === 'UNPAID' ? 'Без оплат' : 'С оплатой'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Main List - Grouped by Customer */}
      <div className="grid grid-cols-1 gap-4">
        {loading ? (
          <div className="py-20 flex flex-col items-center justify-center gap-4 bg-white rounded-[40px] border border-[#5A5A40]/5 shadow-sm">
            <div className="w-10 h-10 border-4 border-[#5A5A40]/10 border-t-[#5A5A40] rounded-full animate-spin"></div>
            <p className="text-xs font-bold text-[#5A5A40]/40 uppercase tracking-widest">Загрузка...</p>
          </div>
        ) : groupedDebts.length > 0 ? (
          groupedDebts.map((group) => (
            <div key={group.customer} className="bg-white rounded-[32px] border border-[#5A5A40]/5 shadow-sm overflow-hidden flex flex-col hover:shadow-md transition-all group">
              <div 
                className="p-6 md:p-8 flex flex-col md:flex-row md:items-center justify-between gap-6 cursor-pointer"
                onClick={() => setExpandedCustomer(expandedCustomer === group.customer ? null : group.customer)}
              >
                <div className="flex items-center gap-6">
                  <div className="w-16 h-16 bg-[#5A5A40]/5 text-[#5A5A40] rounded-[24px] flex items-center justify-center text-xl font-black">
                    {group.customer.charAt(0)}
                  </div>
                  <div>
                    <h4 className="text-xl font-black text-[#5A5A40]">{group.customer}</h4>
                    <p className="text-[10px] text-[#5A5A40]/40 font-black uppercase tracking-[0.1em] mt-1">
                      {group.invoices.length} {group.invoices.length === 1 ? 'чек' : 'чеков'} • Посл. активность: {group.lastActivity.toLocaleDateString()}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-8 md:gap-12">
                  <div className="space-y-1">
                    <p className="text-[10px] text-[#5A5A40]/40 font-black uppercase tracking-widest">Общий баланс</p>
                    <p className="text-lg font-black text-[#5A5A40] tabular-nums">{group.totalDebt.toFixed(2)} TJS</p>
                  </div>
                  <div className="space-y-1 text-right">
                    <p className="text-[10px] text-[#5A5A40]/40 font-black uppercase tracking-widest">Остаток</p>
                    <p className="text-2xl font-black text-red-500 tabular-nums">{group.remaining.toFixed(2)} TJS</p>
                  </div>
                  <div className="flex items-center justify-center w-10 h-10 rounded-full bg-[#f5f5f0] text-[#5A5A40]/30 group-hover:text-[#5A5A40] transition-colors">
                    {expandedCustomer === group.customer ? <X size={20} /> : <ChevronRight size={20} />}
                  </div>
                </div>
              </div>

              {expandedCustomer === group.customer && (
                <div className="bg-[#f5f5f0]/30 border-t border-[#5A5A40]/5 px-8 py-6 space-y-3 animate-in slide-in-from-top-2 duration-300">
                  <h5 className="text-[10px] font-black uppercase tracking-widest text-[#5A5A40]/30 mb-4">Список накладных (долгов)</h5>
                  {group.invoices.sort((a,b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).map((invoice) => (
                    <div key={invoice.id} className="bg-white p-5 rounded-2xl border border-[#5A5A40]/5 flex items-center justify-between gap-4">
                      <div className="flex flex-col">
                        <span className="text-[10px] font-black text-[#5A5A40]/60 uppercase tracking-widest">Чек: {invoice.invoiceNo}</span>
                        <span className="text-[10px] text-[#5A5A40]/40">{new Date(invoice.createdAt).toLocaleDateString()}</span>
                      </div>
                      <div className="flex items-center gap-8">
                        <div className="space-y-0.5">
                          <p className="text-[9px] text-[#5A5A40]/40 font-black uppercase tracking-widest leading-none">Сумма</p>
                          <p className="text-sm font-black text-[#5A5A40] tabular-nums">{Number(invoice.debt?.originalAmount || invoice.totalAmount).toFixed(2)}</p>
                        </div>
                        <div className="space-y-0.5">
                          <p className="text-[9px] text-[#5A5A40]/40 font-black uppercase tracking-widest leading-none">Оплачено</p>
                          <p className="text-sm font-black text-emerald-600 tabular-nums">{Number(invoice.debt?.paidAmount || 0).toFixed(2)}</p>
                        </div>
                        <div className="space-y-0.5">
                          <p className="text-[9px] text-[#5A5A40]/40 font-black uppercase tracking-widest leading-none">Остаток</p>
                          <p className="text-lg font-black text-red-500 tabular-nums">{Number(invoice.debt?.remainingAmount || invoice.totalAmount).toFixed(2)}</p>
                        </div>
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            setPaymentModal(invoice);
                            setPayAmount(Number(invoice.debt?.remainingAmount || invoice.totalAmount).toFixed(2));
                          }}
                          className="bg-[#5A5A40] text-white px-5 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-[#4A4A30] transition-all"
                        >
                          Оплатить
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))
        ) : (
          <div className="py-32 bg-white rounded-[40px] flex flex-col items-center justify-center text-center px-6 border border-[#5A5A40]/5">
            <div className="w-20 h-20 bg-[#f5f5f0] rounded-[32px] flex items-center justify-center text-[#5A5A40]/20 mb-6">
              <CheckCircle2 size={40} />
            </div>
            <h3 className="text-xl font-bold text-[#5A5A40] mb-2">Активных долгов не найдено</h3>
            <p className="text-sm text-[#5A5A40]/40 mb-8 max-w-xs mx-auto">Все текущие продажи оплачены или фильтр скрывает записи.</p>
          </div>
        )}
      </div>

      {/* Payment Modal */}
      {paymentModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center px-4 bg-[#151619]/60 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="bg-white rounded-[40px] shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-300 border border-[#5A5A40]/5">
            <div className="p-8 border-b border-[#5A5A40]/5 flex items-center justify-between">
              <div>
                <h3 className="text-xl font-black text-[#5A5A40] tracking-tight">Погашение долга</h3>
                <p className="text-[10px] text-[#5A5A40]/40 uppercase tracking-widest mt-1 font-black">Чек: {paymentModal.invoiceNo}</p>
              </div>
              <button onClick={() => setPaymentModal(null)} className="p-2 hover:bg-[#f5f5f0] rounded-full text-[#5A5A40]/20 hover:text-[#5A5A40] transition-colors"><X size={24} /></button>
            </div>
            
            <div className="p-8 space-y-6">
              <div className="bg-[#f5f5f0]/50 p-6 rounded-3xl border border-[#5A5A40]/5 flex justify-between items-center tabular-nums">
                <span className="text-xs font-bold text-[#5A5A40]/60 uppercase tracking-widest">Остаток:</span>
                <span className="text-xl font-black text-[#5A5A40]">{(Number(paymentModal.totalAmount) - Number(paymentModal.paidAmount || 0)).toFixed(2)} TJS</span>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-black text-[#5A5A40]/40 uppercase tracking-widest px-1">Сумма оплаты</label>
                <input 
                  type="number" 
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                  className="w-full px-6 py-4 bg-[#f5f5f0]/50 border-none rounded-3xl text-xl font-black text-[#5A5A40] focus:ring-4 focus:ring-[#5A5A40]/5 transition-all outline-none tabular-nums"
                  placeholder="0.00"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <button 
                  onClick={() => setPayMethod('CASH')}
                  className={`py-4 rounded-3xl text-xs font-black uppercase tracking-widest transition-all ${payMethod === 'CASH' ? 'bg-[#5A5A40] text-white shadow-xl rotate-1' : 'bg-[#f5f5f0] text-[#5A5A40]/30 hover:text-[#5A5A40]'}`}
                >
                  Наличные
                </button>
                <button 
                  onClick={() => setPayMethod('CARD')}
                  className={`py-4 rounded-3xl text-xs font-black uppercase tracking-widest transition-all ${payMethod === 'CARD' ? 'bg-[#5A5A40] text-white shadow-xl -rotate-1' : 'bg-[#f5f5f0] text-[#5A5A40]/30 hover:text-[#5A5A40]'}`}
                >
                  Карта
                </button>
              </div>
            </div>

            <div className="p-8 bg-[#f5f5f0]/30 border-t border-[#5A5A40]/5">
              <button 
                onClick={handlePayDebt}
                disabled={paying || !payAmount || Number(payAmount) <= 0}
                className="w-full bg-[#5A5A40] text-white py-5 rounded-[24px] font-black text-xs uppercase tracking-[0.2em] shadow-2xl shadow-[#5A5A40]/20 hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50 disabled:grayscale"
              >
                {paying ? 'Обработка...' : 'Подтвердить оплату'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
