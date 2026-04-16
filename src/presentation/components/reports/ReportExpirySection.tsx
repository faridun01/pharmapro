import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, Calendar, Package, RefreshCw, Search } from 'lucide-react';
import { buildApiHeaders } from '../../../infrastructure/api';
import { ExpiryItem } from './types';

export const ReportExpirySection: React.FC = () => {
  const { t } = useTranslation();
  const [items, setItems] = useState<ExpiryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'expired' | 'critical' | 'warning'>('all');
  const [searchTerm, setSearchTerm] = useState('');

  const loadExpiryData = async (status: string) => {
    setLoading(true);
    try {
      const headers = await buildApiHeaders();
      const resp = await fetch(`/api/reports/expiry?status=${status}`, { headers });
      if (!resp.ok) throw new Error('Failed to load data');
      const data = await resp.json();
      setItems(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadExpiryData(filter);
  }, [filter]);

  const filtered = items.filter(item => 
    item.productName.toLowerCase().includes(searchTerm.toLowerCase()) ||
    item.sku.toLowerCase().includes(searchTerm.toLowerCase()) ||
    item.batchNumber.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="flex gap-2 p-1 bg-[#f5f5f0]/50 rounded-[1.5rem] border border-[#5A5A40]/5">
          {[
            { id: 'all', label: 'Все' },
            { id: 'expired', label: 'Просрочено' },
            { id: 'critical', label: 'Критично (30д)' },
            { id: 'warning', label: 'Внимание (90д)' },
          ].map(f => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id as any)}
              className={`px-5 py-2 rounded-[1.2rem] text-[10px] font-bold uppercase tracking-widest transition-all ${filter === f.id ? 'bg-[#5A5A40] text-white shadow-md' : 'text-[#5A5A40]/40 hover:text-[#5A5A40] hover:bg-white'}`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="relative group w-full md:max-w-md">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-[#5A5A40]/20" size={18} />
          <input
            type="text"
            placeholder="Поиск по названию или партии..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-12 pr-4 py-3 bg-[#f8f7f2] border-none rounded-2xl text-sm outline-none focus:bg-white focus:ring-4 focus:ring-[#5A5A40]/5 transition-all"
          />
        </div>
      </div>

      <div className="bg-white rounded-[2.5rem] border border-[#5A5A40]/10 overflow-hidden shadow-sm">
        {loading ? (
          <div className="py-20 flex flex-col items-center justify-center">
            <RefreshCw size={40} className="animate-spin text-[#5A5A40]/10" />
            <p className="text-[10px] uppercase tracking-widest text-[#5A5A40]/30 mt-4">Синхронизация данных...</p>
          </div>
        ) : (
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-[#fcfbf7]/80 text-[10px] uppercase tracking-widest text-[#5A5A40]/40 border-b border-[#5A5A40]/5">
                <th className="px-8 py-5 font-normal">Товар</th>
                <th className="px-6 py-5 font-normal">Партия</th>
                <th className="px-6 py-5 font-normal">Остаток</th>
                <th className="px-6 py-5 font-normal">Срок годности</th>
                <th className="px-6 py-5 font-normal">Статус</th>
                <th className="px-8 py-5 text-right font-normal">Осталось</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#5A5A40]/5">
              {filtered.map(item => (
                <tr key={item.id} className="hover:bg-[#fcfbf7]/50 transition-colors group">
                  <td className="px-8 py-5">
                    <div className="flex items-center gap-4">
                      <div className={`w-10 h-10 rounded-2xl flex items-center justify-center shadow-inner ${
                        item.severity === 'expired' ? 'bg-rose-50 text-rose-500' :
                        item.severity === 'critical' ? 'bg-amber-50 text-amber-500' :
                        'bg-[#f5f5f0] text-[#5A5A40]/30'
                      }`}>
                        <Package size={20} />
                      </div>
                      <div>
                        <p className="text-sm font-normal text-[#151619] tracking-tight">{item.productName}</p>
                        <p className="text-[10px] text-[#5A5A40]/40 uppercase tracking-widest">{item.sku}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-5">
                    <span className="text-xs font-normal text-[#5A5A40]/60 bg-[#f5f5f0] px-3 py-1 rounded-lg border border-[#5A5A40]/5 tracking-tight">{item.batchNumber}</span>
                  </td>
                  <td className="px-6 py-5">
                    <p className="text-sm font-normal text-[#151619]">{item.quantity} шт.</p>
                  </td>
                  <td className="px-6 py-5">
                    <div className="flex items-center gap-2 text-[#5A5A40]/70">
                      <Calendar size={14} className="opacity-30" />
                      <span className="text-sm">{new Date(item.expiryDate).toLocaleDateString()}</span>
                    </div>
                  </td>
                  <td className="px-6 py-5">
                    <span className={`px-3 py-1 rounded-full text-[9px] uppercase tracking-[0.15em] font-normal border ${
                      item.severity === 'expired' ? 'bg-rose-50 text-rose-600 border-rose-100' :
                      item.severity === 'critical' ? 'bg-amber-50 text-amber-600 border-amber-100' :
                      item.severity === 'warning' ? 'bg-blue-50 text-blue-600 border-blue-100' :
                      'bg-emerald-50 text-emerald-600 border-emerald-100'
                    }`}>
                      {item.severity === 'expired' ? 'Истек' :
                       item.severity === 'critical' ? 'Критично' :
                       item.severity === 'warning' ? 'Внимание' : 'В норме'}
                    </span>
                  </td>
                  <td className="px-8 py-5 text-right font-normal tabular-nums">
                    {item.daysLeft !== null ? (
                      <span className={`text-sm ${item.daysLeft < 0 ? 'text-rose-500 font-bold' : item.daysLeft <= 30 ? 'text-amber-600 font-bold' : 'text-[#5A5A40]/60'}`}>
                        {item.daysLeft < 0 ? `Просрочка ${Math.abs(item.daysLeft)} дн.` : `${item.daysLeft} дн.`}
                      </span>
                    ) : '—'}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-24 text-center">
                    <AlertCircle size={40} className="mx-auto text-[#5A5A40]/10 mb-4" />
                    <p className="text-[10px] uppercase tracking-widest text-[#5A5A40]/30 italic">Товары с такими критериями не найдены</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};
