import React, { useCallback, useEffect, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  ClipboardList,
  RefreshCw,
  Filter,
  ChevronLeft,
  ChevronRight,
  User,
  Layers,
  Clock,
  Info,
  Search,
  FileSpreadsheet,
  X,
  History
} from 'lucide-react';
import { buildApiHeaders } from '../../infrastructure/api';

type AuditUser = { id: string; name: string; email: string };

type AuditEntry = {
  id: string;
  module: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  userRole: string | null;
  createdAt: string;
  oldValue: Record<string, any> | null;
  newValue: Record<string, any> | null;
  user: AuditUser;
};

type Pagination = { total: number; page: number; limit: number; totalPages: number };

const MODULE_LABELS: Record<string, string> = {
  catalog:   'Каталог',
  inventory: 'Склад',
  sales:     'Продажи',
  returns:   'Возвраты',
  writeoff:  'Списания',
  suppliers: 'Поставщики',
  shifts:    'Смены',
  system:    'Система',
  reports:   'Отчёты',
  users:     'Пользователи',
};

const MODULE_COLORS: Record<string, string> = {
  catalog:   'bg-sky-50 text-sky-600 border-sky-100',
  inventory: 'bg-amber-50 text-amber-600 border-amber-100',
  sales:     'bg-emerald-50 text-emerald-600 border-emerald-100',
  returns:   'bg-orange-50 text-orange-600 border-orange-100',
  writeoff:  'bg-rose-50 text-rose-600 border-rose-100',
  suppliers: 'bg-purple-50 text-purple-600 border-purple-100',
  shifts:    'bg-indigo-50 text-indigo-600 border-indigo-100',
  system:    'bg-slate-50 text-slate-500 border-slate-100',
};

const ACTION_LABELS: Record<string, string> = {
  CREATE_PRODUCT:    'Создание товара',
  UPDATE_PRODUCT:    'Изменение товара',
  DELETE_PRODUCT:    'Удаление товара',
  RESTOCK:           'Пополнение склада',
  ADJUST_QUANTITY:   'Корректировка',
  DELETE_BATCH:      'Удаление партии',
  CREATE_INVOICE:    'Оформление продажи',
  CLOSE_SHIFT:       'Закрытие смены',
  OPEN_SHIFT:        'Открытие смены',
  APPROVE_RETURN:    'Одобрение возврата',
  REJECT_RETURN:     'Отклонение возврата',
  CREATE_RETURN:     'Создание возврата',
  CREATE_USER:       'Создание юзера',
  UPDATE_USER:       'Изменение юзера',
  DEACTIVATE_USER:   'Деактивация юзера',
  CREATE_SUPPLIER:   'Добавление поставщика',
  UPDATE_SUPPLIER:   'Изменение поставщика',
  SUPPLIER_PAYMENT:  'Оплата поставщику',
  IMPORT_INVOICE:    'Импорт накладной',
};

const formatAction = (action: string) => ACTION_LABELS[action] ?? action.replace(/_/g, ' ').toLowerCase();

const formatDate = (iso: string) =>
  new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });

const ValueBadge: React.FC<{ value: any }> = ({ value }) => {
  if (value === undefined || value === null) return <span className="text-[#5A5A40]/20 italic text-[10px]">null</span>;
  if (typeof value === 'boolean') return <span className={`text-[10px] uppercase ${value ? 'text-emerald-500' : 'text-rose-500'}`}>{value ? 'Да' : 'Нет'}</span>;
  if (typeof value === 'object') return <pre className="text-[10px] bg-[#f8f7f2] p-1.5 rounded-lg border border-[#5A5A40]/5 overflow-hidden whitespace-pre-wrap">{JSON.stringify(value, null, 2)}</pre>;
  return <span className="text-[11px] text-[#151619] font-normal">{String(value)}</span>;
};

const DetailModal: React.FC<{ entry: AuditEntry; onClose: () => void }> = ({ entry, onClose }) => {
  const getDiff = (oldVal: any, newVal: any) => {
    const keys = new Set([...Object.keys(oldVal || {}), ...Object.keys(newVal || {})]);
    return Array.from(keys).map(key => ({
      key,
      old: oldVal?.[key],
      new: newVal?.[key]
    })).filter(d => JSON.stringify(d.old) !== JSON.stringify(d.new));
  };

  const diff = getDiff(entry.oldValue, entry.newValue);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 animate-in fade-in duration-300">
      <div className="absolute inset-0 bg-stone-900/40 backdrop-blur-md" onClick={onClose} />
      <div className="relative bg-white rounded-[2.5rem] shadow-2xl w-full max-w-2xl overflow-hidden border border-white">
        <div className="p-8 border-b border-[#5A5A40]/5 flex items-center justify-between bg-[#fcfbf7]/50">
          <div>
             <p className="text-[10px] text-[#5A5A40]/30 uppercase tracking-[0.2em] mb-1">{formatDate(entry.createdAt)}</p>
             <h4 className="text-xl font-normal text-[#151619] tracking-tight">{formatAction(entry.action)}</h4>
          </div>
          <button onClick={onClose} className="w-10 h-10 rounded-full bg-white border border-[#5A5A40]/5 flex items-center justify-center text-[#5A5A40]/40 hover:text-rose-600 transition-all shadow-sm"><X size={18} /></button>
        </div>
        <div className="p-8 space-y-8 max-h-[70vh] overflow-y-auto custom-scrollbar">
          <div className="grid grid-cols-2 gap-10">
            <div>
              <p className="text-[10px] text-[#5A5A40]/30 uppercase tracking-widest mb-3">Инициатор</p>
              <div className="flex items-center gap-3">
                 <div className="w-10 h-10 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center"><User size={20}/></div>
                 <div className="min-w-0">
                    <p className="text-sm font-normal text-[#151619] truncate">{entry.user.name}</p>
                    <p className="text-[10px] text-[#5A5A40]/40 lowercase">{entry.user.email}</p>
                 </div>
              </div>
            </div>
            <div>
              <p className="text-[10px] text-[#5A5A40]/30 uppercase tracking-widest mb-3">Сущность</p>
              <div className="flex items-center gap-3">
                 <div className="w-10 h-10 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center"><Package size={20}/></div>
                 <div className="min-w-0">
                    <p className="text-sm font-normal text-[#151619]">{entry.entity}</p>
                    <p className="text-[9px] text-[#5A5A40]/30 font-mono truncate">{entry.entityId || 'N/A'}</p>
                 </div>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <p className="text-[10px] text-[#5A5A40]/30 uppercase tracking-widest">Протокол изменений</p>
            {diff.length > 0 ? (
              <div className="rounded-3xl border border-[#5A5A40]/5 overflow-hidden">
                <table className="w-full text-left">
                  <thead>
                    <tr className="bg-[#fcfbf7] border-b border-[#5A5A40]/5 text-[9px] text-[#5A5A40]/30 uppercase tracking-[0.15em]">
                      <th className="px-5 py-3 font-normal">Параметр</th>
                      <th className="px-5 py-3 font-normal">Было</th>
                      <th className="px-5 py-3 font-normal">Стало</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#5A5A40]/5">
                    {diff.map(d => (
                      <tr key={d.key} className="text-xs">
                        <td className="px-5 py-4 font-mono text-[#5A5A40]/60">{d.key}</td>
                        <td className="px-5 py-4"><ValueBadge value={d.old}/></td>
                        <td className="px-5 py-4"><ValueBadge value={d.new}/></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="bg-[#fcfbf7] p-10 rounded-[2rem] border border-dashed border-[#5A5A40]/10 text-center text-[10px] uppercase tracking-widest text-[#5A5A40]/30">Детали изменений отсутствуют</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export const AuditLogPanel: React.FC = () => {
  const today = new Date().toISOString().split('T')[0];
  const [entries, setEntries]       = useState<AuditEntry[]>([]);
  const [users, setUsers]           = useState<AuditUser[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ total: 0, page: 1, limit: 15, totalPages: 1 });
  const [loading, setLoading]       = useState(true);
  const [detail, setDetail]         = useState<AuditEntry | null>(null);

  const [fModule,  setFModule]  = useState('');
  const [fUser,    setFUser]    = useState('');
  const [fAction,  setFAction]  = useState('');
  const [fFrom,    setFFrom]    = useState(today);
  const [fTo,      setFTo]      = useState(today);
  const [page,     setPage]     = useState(1);

  const load = useCallback(async (p = page) => {
    setLoading(true);
    try {
      const q = new URLSearchParams({ page: String(p), limit: '15', from: fFrom, to: fTo });
      if (fModule) q.set('module', fModule);
      if (fUser)   q.set('userId', fUser);
      if (fAction) q.set('action', fAction);

      const res = await fetch(`/api/audit?${q.toString()}`, { headers: await buildApiHeaders(false) });
      const body = await res.json();
      setEntries(body.items ?? []);
      setPagination(body.pagination ?? { total: 0, page: 1, limit: 15, totalPages: 1 });
    } finally { setLoading(false); }
  }, [fModule, fUser, fAction, fFrom, fTo, page]);

  useEffect(() => {
    buildApiHeaders(false).then(h => fetch('/api/audit/users', { headers: h as any }).then(r => r.json()).then(setUsers).catch(() => {}));
  }, []);

  useEffect(() => { load(page); }, [load, page]);

  const handleReset = () => { setFModule(''); setFUser(''); setFAction(''); setFFrom(today); setFTo(today); setPage(1); };

  const handleExport = () => {
    const rows = entries.map(e => ({
      'Время': formatDate(e.createdAt),
      'Модуль': MODULE_LABELS[e.module ?? ''] ?? e.module ?? '-',
      'Спецификация': formatAction(e.action),
      'Объект': e.entity,
      'ID': e.entityId,
      'Сотрудник': e.user.name,
      'Эл. почта': e.user.email
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.sheet_add_aoa(ws, [['ЖУРНАЛ АУДИТА • ' + new Date().toLocaleDateString()]], { origin: 'A1' });
    ws['!cols'] = [{ wch: 22 }, { wch: 15 }, { wch: 30 }, { wch: 20 }, { wch: 15 }, { wch: 25 }, { wch: 25 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Audit');
    XLSX.writeFile(wb, `Audit_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  return (
    <div className="max-w-[1600px] mx-auto space-y-8 animate-in fade-in duration-700 font-normal">
      
      {/* Header section */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 px-1">
        <div className="flex items-center gap-5">
           <div className="w-14 h-14 rounded-[1.5rem] bg-[#fcfbf7] border border-[#5A5A40]/5 flex items-center justify-center text-[#5A5A40]/60 shadow-sm">
             <ClipboardList size={26} />
           </div>
           <div>
             <h2 className="text-3xl font-normal text-[#151619] tracking-tight">Журнал безопасности</h2>
             <p className="text-[#5A5A40]/50 mt-1 text-[10px] uppercase tracking-[0.2em] italic">{pagination.total} записей в архиве</p>
           </div>
        </div>
        <div className="flex gap-3">
          <button onClick={handleExport} className="px-5 py-3.5 rounded-2xl bg-emerald-50 text-emerald-600 border border-emerald-100 text-[10px] uppercase tracking-widest hover:bg-emerald-100 transition-all flex items-center gap-2">
            <FileSpreadsheet size={16} /> Excel Отчет
          </button>
          <button onClick={() => load(page)} className="w-12 h-12 rounded-2xl bg-white border border-[#5A5A40]/10 flex items-center justify-center text-[#5A5A40]/40 hover:text-[#5A5A40] transition-transform active:rotate-180">
            <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Modern Filter Panel */}
      <div className="bg-white rounded-[2.5rem] p-8 shadow-sm border border-white space-y-6">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-[#5A5A40]/30 px-1">
          <Filter size={12} /> Фильтры логов
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          <select value={fModule} onChange={e => setFModule(e.target.value)} className="px-4 py-3 bg-[#f8f7f2] border-none rounded-xl text-xs text-[#5A5A40] outline-none focus:ring-2 focus:ring-[#5A5A40]/5">
            <option value="">Все системы</option>
            {Object.entries(MODULE_LABELS).map(([k,v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select value={fUser} onChange={e => setFUser(e.target.value)} className="px-4 py-3 bg-[#f8f7f2] border-none rounded-xl text-xs text-[#5A5A40] outline-none focus:ring-2 focus:ring-[#5A5A40]/5">
            <option value="">Все сотрудники</option>
            {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <input value={fAction} onChange={e => setFAction(e.target.value)} placeholder="Действие..." className="px-4 py-3 bg-[#f8f7f2] border-none rounded-xl text-xs text-[#5A5A40] outline-none transition-all focus:bg-white focus:ring-4 focus:ring-[#5A5A40]/5" />
          <input type="date" value={fFrom} onChange={e => setFFrom(e.target.value)} className="px-4 py-3 bg-[#f8f7f2] border-none rounded-xl text-xs text-[#5A5A40]/60 outline-none" />
          <input type="date" value={fTo} onChange={e => setFTo(e.target.value)} className="px-4 py-3 bg-[#f8f7f2] border-none rounded-xl text-xs text-[#5A5A40]/60 outline-none" />
        </div>
        <div className="flex justify-end gap-3 pt-2">
           <button onClick={handleReset} className="px-6 py-2.5 rounded-xl border border-[#5A5A40]/5 text-[10px] uppercase tracking-widest text-[#5A5A40]/40 hover:bg-[#f5f5f0] transition-all">Сбросить</button>
           <button onClick={() => { setPage(1); load(1); }} className="px-8 py-2.5 rounded-xl bg-[#5A5A40] text-white text-[10px] uppercase tracking-widest shadow-lg shadow-[#5A5A40]/10 hover:bg-[#4A4A30] transition-all">Применить</button>
        </div>
      </div>

      {/* High-Density Log Table */}
      <div className="bg-white rounded-[3rem] shadow-sm border border-white overflow-hidden">
        <div className="overflow-x-auto custom-scrollbar">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-[#fcfbf7]/60 text-[10px] uppercase tracking-[0.2em] text-[#5A5A40]/40 border-b border-[#5A5A40]/5">
                <th className="px-8 py-5 font-normal"><div className="flex items-center gap-2"><Clock size={12}/> Время</div></th>
                <th className="px-4 py-5 font-normal">Система</th>
                <th className="px-6 py-5 font-normal">Операция</th>
                <th className="px-6 py-5 font-normal">Сотрудник</th>
                <th className="px-8 py-5 text-right font-normal text-rose-500/40 opacity-0">.</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#5A5A40]/5">
              {entries.map((entry) => {
                const modStyles = MODULE_COLORS[entry.module ?? ''] ?? 'bg-stone-50 text-stone-500 border-stone-100';
                return (
                  <tr key={entry.id} className="hover:bg-[#fcfbf7] transition-all group">
                    <td className="px-8 py-4 whitespace-nowrap">
                       <p className="text-[11px] text-[#151619] font-normal">{formatDate(entry.createdAt).split(',')[0]}</p>
                       <p className="text-[10px] text-[#5A5A40]/40 italic">{formatDate(entry.createdAt).split(',')[1]}</p>
                    </td>
                    <td className="px-4 py-4">
                       <span className={`inline-flex items-center px-1.5 py-0.5 rounded-md text-[8px] uppercase tracking-widest border leading-none ${modStyles}`}>
                          {MODULE_LABELS[entry.module ?? ''] ?? entry.module ?? 'System'}
                       </span>
                    </td>
                    <td className="px-6 py-4">
                       <p className="text-[13px] font-normal text-[#151619] tracking-tight">{formatAction(entry.action)}</p>
                       <p className="text-[9px] text-[#5A5A40]/40 mt-1 uppercase tracking-tighter italic">{entry.entity}{entry.entityId ? ` ID: ${entry.entityId.slice(-6)}` : ''}</p>
                    </td>
                    <td className="px-6 py-4">
                       <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-xl bg-[#5A5A40]/5 text-[#5A5A40]/40 flex items-center justify-center transition-colors group-hover:bg-[#5A5A40] group-hover:text-white"><User size={14}/></div>
                          <div className="min-w-0">
                             <p className="text-[12px] text-[#151619] font-normal truncate">{entry.user.name}</p>
                             <p className="text-[9px] text-[#5A5A40]/30 lowercase">{entry.userRole}</p>
                          </div>
                       </div>
                    </td>
                    <td className="px-8 py-4 text-right">
                       {(entry.oldValue || entry.newValue) && (
                         <button onClick={() => setDetail(entry)} className="p-2 text-[#5A5A40]/20 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl transition-all"><History size={16}/></button>
                       )}
                    </td>
                  </tr>
                );
              })}
              {!loading && entries.length === 0 && (
                <tr>
                   <td colSpan={5} className="py-24 text-center">
                      <div className="w-20 h-20 bg-[#5A5A40]/5 text-[#5A5A40]/20 rounded-[2rem] flex items-center justify-center mx-auto mb-4"><History size={32}/></div>
                      <p className="text-[10px] uppercase tracking-[0.2em] text-[#5A5A40]/30">Журнал за сегодня пуст</p>
                   </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Improved Pagination Control */}
        {pagination.totalPages > 1 && (
          <div className="p-8 bg-[#fcfbf7]/40 border-t border-[#5A5A40]/5 flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-widest text-[#5A5A40]/30">Архив: {pagination.total} логов</span>
            <div className="flex items-center gap-2">
               <button disabled={pagination.page <= 1} onClick={() => setPage(p => p - 1)} className="w-10 h-10 rounded-xl border border-[#5A5A40]/5 bg-white flex items-center justify-center text-[#5A5A40]/40 transition-all hover:bg-[#f5f5f0] disabled:opacity-20"><ChevronLeft size={16}/></button>
               <div className="flex items-center gap-1.5">
                  {[...Array(pagination.totalPages)].map((_, i) => {
                    const p = i + 1;
                    if (p === 1 || p === pagination.totalPages || Math.abs(p - pagination.page) <= 1) {
                      return <button key={p} onClick={() => setPage(p)} className={`w-9 h-9 rounded-xl text-[10px] tracking-widest transition-all ${pagination.page === p ? 'bg-[#5A5A40] text-white shadow-lg' : 'bg-white text-[#5A5A40]/40 border border-[#5A5A40]/5 hover:bg-[#f5f5f0]'}`}>{p}</button>;
                    }
                    if (p === 2 || p === pagination.totalPages - 1) return <span key={p} className="text-[#5A5A40]/20">.</span>;
                    return null;
                  })}
               </div>
               <button disabled={pagination.page >= pagination.totalPages} onClick={() => setPage(p => p + 1)} className="w-10 h-10 rounded-xl border border-[#5A5A40]/5 bg-white flex items-center justify-center text-[#5A5A40]/40 transition-all hover:bg-[#f5f5f0] disabled:opacity-20"><ChevronRight size={16}/></button>
            </div>
          </div>
        )}
      </div>

      {detail && <DetailModal entry={detail} onClose={() => setDetail(null)} />}
    </div>
  );
};

export default AuditLogPanel;
