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
  catalog:   'bg-sky-50 text-sky-700 border-sky-200',
  inventory: 'bg-amber-50 text-amber-700 border-amber-200',
  sales:     'bg-emerald-50 text-emerald-700 border-emerald-200',
  returns:   'bg-orange-50 text-orange-700 border-orange-200',
  writeoff:  'bg-red-50 text-red-700 border-red-200',
  suppliers: 'bg-purple-50 text-purple-700 border-purple-200',
  shifts:    'bg-indigo-50 text-indigo-700 border-indigo-200',
  system:    'bg-slate-100 text-slate-600 border-slate-200',
  reports:   'bg-teal-50 text-teal-700 border-teal-200',
  users:     'bg-pink-50 text-pink-700 border-pink-200',
};

const ACTION_LABELS: Record<string, string> = {
  CREATE_PRODUCT:    '+ Создание товара',
  UPDATE_PRODUCT:    '✎ Изменение товара',
  DELETE_PRODUCT:    '✕ Удаление товара',
  RESTOCK:           '↑ Приход товара',
  ADJUST_QUANTITY:   '⇄ Корректировка',
  DELETE_BATCH:      '✕ Удаление партии',
  CREATE_INVOICE:    '+ Продажа',
  CLOSE_SHIFT:       '■ Закрытие смены',
  OPEN_SHIFT:        '▶ Открытие смены',
  APPROVE_RETURN:    '✓ Одобрение возврата',
  REJECT_RETURN:     '✕ Отклонение возврата',
  CREATE_RETURN:     '+ Создание возврата',
  CREATE_USER:       '+ Создание пользователя',
  UPDATE_USER:       '✎ Изменение пользователя',
  DEACTIVATE_USER:   '✕ Деактивация пользователя',
  CREATE_SUPPLIER:   '+ Создание поставщика',
  UPDATE_SUPPLIER:   '✎ Изменение поставщика',
  DELETE_SUPPLIER:   '✕ Удаление поставщика',
  SUPPLIER_PAYMENT:  '₽ Оплата поставщику',
  IMPORT_INVOICE:    '↑ Импорт накладной',
};

const formatAction = (action: string) => ACTION_LABELS[action] ?? action.replace(/_/g, ' ');
const formatDate = (iso: string) =>
  new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });

type ValueDiff = { key: string; old: any; new: any };

const getDiff = (oldVal: Record<string, any> | null, newVal: Record<string, any> | null): ValueDiff[] => {
  if (!oldVal && !newVal) return [];
  const keys = new Set([
    ...Object.keys(oldVal ?? {}),
    ...Object.keys(newVal ?? {}),
  ]);
  const diffs: ValueDiff[] = [];
  for (const key of keys) {
    const o = oldVal?.[key];
    const n = newVal?.[key];
    if (JSON.stringify(o) !== JSON.stringify(n)) {
      diffs.push({ key, old: o, new: n });
    }
  }
  return diffs;
};

const ValueBadge: React.FC<{ value: any }> = ({ value }) => {
  if (value === undefined || value === null) return <span className="text-[#5A5A40]/30 italic text-xs">—</span>;
  if (typeof value === 'boolean') return <span className={`text-xs font-bold ${value ? 'text-emerald-600' : 'text-red-500'}`}>{value ? 'Да' : 'Нет'}</span>;
  if (typeof value === 'object') return <code className="text-xs bg-[#f5f5f0] px-1.5 py-0.5 rounded text-[#5A5A40]">{JSON.stringify(value).slice(0, 60)}</code>;
  return <span className="text-xs text-[#5A5A40]">{String(value).slice(0, 80)}</span>;
};

type DetailModalProps = { entry: AuditEntry; onClose: () => void };

const DetailModal: React.FC<DetailModalProps> = ({ entry, onClose }) => {
  const diff = getDiff(entry.oldValue, entry.newValue);
  const hasOnlyNew = !entry.oldValue && entry.newValue;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg border border-[#5A5A40]/10 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#5A5A40]/8 bg-[#f5f5f0]/40">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-[#5A5A40]/50 mb-1">{formatDate(entry.createdAt)}</p>
            <h4 className="text-sm font-bold text-[#151619]">{formatAction(entry.action)}</h4>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-[#f5f5f0] text-[#5A5A40]/60 transition-colors text-lg leading-none">×</button>
        </div>
        <div className="px-6 py-4 space-y-3 max-h-[60vh] overflow-y-auto">
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <p className="text-[#5A5A40]/50 font-bold uppercase tracking-wider mb-1">Пользователь</p>
              <p className="font-semibold text-[#151619]">{entry.user.name}</p>
              <p className="text-[#5A5A40]/50">{entry.user.email}</p>
            </div>
            <div>
              <p className="text-[#5A5A40]/50 font-bold uppercase tracking-wider mb-1">Объект</p>
              <p className="font-semibold text-[#151619]">{entry.entity}</p>
              {entry.entityId && <p className="text-[#5A5A40]/40 font-mono text-[10px] truncate">{entry.entityId}</p>}
            </div>
          </div>

          {diff.length > 0 ? (
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-[#5A5A40]/50 mb-2">Изменения</p>
              <div className="rounded-xl border border-[#5A5A40]/10 overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-[#f5f5f0]/70">
                      <th className="text-left px-3 py-2 text-[#5A5A40]/50 font-bold w-1/3">Поле</th>
                      <th className="text-left px-3 py-2 text-[#5A5A40]/50 font-bold">Было</th>
                      <th className="text-left px-3 py-2 text-[#5A5A40]/50 font-bold">Стало</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#5A5A40]/5">
                    {diff.map(({ key, old: o, new: n }) => (
                      <tr key={key}>
                        <td className="px-3 py-2 font-mono text-[#5A5A40]/60">{key}</td>
                        <td className="px-3 py-2"><ValueBadge value={o} /></td>
                        <td className="px-3 py-2"><ValueBadge value={n} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : hasOnlyNew && entry.newValue ? (
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-[#5A5A40]/50 mb-2">Данные</p>
              <div className="rounded-xl border border-[#5A5A40]/10 overflow-hidden">
                <table className="w-full text-xs">
                  <tbody className="divide-y divide-[#5A5A40]/5">
                    {Object.entries(entry.newValue).map(([k, v]) => (
                      <tr key={k}>
                        <td className="px-3 py-2 font-mono text-[#5A5A40]/60 w-1/3">{k}</td>
                        <td className="px-3 py-2"><ValueBadge value={v} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <p className="text-xs text-[#5A5A40]/40 italic">Детали изменений не сохранены</p>
          )}
        </div>
      </div>
    </div>
  );
};

export const AuditLogPanel: React.FC = () => {
  const [entries, setEntries]       = useState<AuditEntry[]>([]);
  const [users, setUsers]           = useState<AuditUser[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ total: 0, page: 1, limit: 15, totalPages: 1 });
  const [loading, setLoading]       = useState(true);
  const [detail, setDetail]         = useState<AuditEntry | null>(null);

  // Filters
  const today = new Date().toISOString().split('T')[0];
  const [fModule,  setFModule]  = useState('');
  const [fUser,    setFUser]    = useState('');
  const [fAction,  setFAction]  = useState('');
  const [fFrom,    setFFrom]    = useState(today);
  const [fTo,      setFTo]      = useState(today);
  const [page,     setPage]     = useState(1);

  const load = useCallback(async (p = page) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('page', String(p));
      params.set('limit', '15');
      if (fModule) params.set('module', fModule);
      if (fUser)   params.set('userId', fUser);
      if (fAction) params.set('action', fAction);
      if (fFrom)   params.set('from', fFrom);
      if (fTo)     params.set('to', fTo);

      const res = await fetch(`/api/audit?${params.toString()}`, { headers: await buildApiHeaders(false) });
      const body = await res.json().catch(() => ({ items: [], pagination: { total: 0, page: 1, limit: 15, totalPages: 1 } }));
      setEntries(body.items ?? []);
      setPagination(body.pagination ?? { total: 0, page: 1, limit: 15, totalPages: 1 });
    } finally {
      setLoading(false);
    }
  }, [fModule, fUser, fAction, fFrom, fTo, page]);

  const handleExportExcel = () => {
    const data = entries.map(e => ({
      'Дата и время': formatDate(e.createdAt),
      'Модуль': MODULE_LABELS[e.module || ''] || e.module || '-',
      'Действие': formatAction(e.action),
      'Объект': e.entity,
      'ID Объекта': e.entityId || '-',
      'Сотрудник': e.user.name,
      'Роль': e.userRole || '-',
      'Email': e.user.email
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    
    // Auto-calculate column widths
    const colWidths = [
      { wch: 22 },
      { wch: 15 },
      { wch: 30 },
      { wch: 25 },
      { wch: 15 },
      { wch: 30 },
      { wch: 15 },
      { wch: 30 },
    ];
    ws['!cols'] = colWidths;

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Audit Log');
    XLSX.writeFile(wb, `Audit_Log_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  useEffect(() => {
    buildApiHeaders(false).then(headers => {
      fetch('/api/audit/users', { headers: headers as any })
        .then(r => r.json())
        .then(setUsers)
        .catch(() => setUsers([]));
    });
  }, []);

  useEffect(() => { void load(page); }, [load, page]);

  const handleSearch = () => { setPage(1); void load(1); };
  const handleReset  = () => { setFModule(''); setFUser(''); setFAction(''); setFFrom(''); setFTo(''); setPage(1); setTimeout(() => void load(1), 0); };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 text-[#5A5A40]">
          <div className="w-10 h-10 rounded-2xl bg-[#f5f5f0] flex items-center justify-center">
            <ClipboardList size={20} />
          </div>
          <div>
            <h3 className="text-lg font-normal">Журнал аудита</h3>
            <p className="text-xs text-[#5A5A40]/55">{pagination.total} записей</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleExportExcel}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-xl text-xs font-semibold hover:bg-emerald-100 transition-all shadow-sm"
            title="Экспорт в Excel"
          >
            <FileSpreadsheet size={16} /> Экспорт Excel
          </button>
          <button
            onClick={() => void load(page)}
            className="p-2 rounded-xl border border-[#5A5A40]/15 text-[#5A5A40]/60 hover:bg-[#f5f5f0] transition-colors"
            title="Обновить"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-[#f5f5f0]/50 rounded-2xl p-4 border border-[#5A5A40]/8 space-y-3">
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#5A5A40]/50">
          <Filter size={13} /> Фильтры
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          <select
            value={fModule}
            onChange={e => setFModule(e.target.value)}
            className="px-3 py-2 border border-[#5A5A40]/15 rounded-xl text-xs bg-white focus:outline-none focus:ring-2 focus:ring-[#5A5A40]/20"
          >
            <option value="">Все модули</option>
            {Object.entries(MODULE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>

          <select
            value={fUser}
            onChange={e => setFUser(e.target.value)}
            className="px-3 py-2 border border-[#5A5A40]/15 rounded-xl text-xs bg-white focus:outline-none focus:ring-2 focus:ring-[#5A5A40]/20"
          >
            <option value="">Все сотрудники</option>
            {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>

          <input
            value={fAction}
            onChange={e => setFAction(e.target.value)}
            placeholder="Действие (поиск)"
            className="px-3 py-2 border border-[#5A5A40]/15 rounded-xl text-xs bg-white focus:outline-none focus:ring-2 focus:ring-[#5A5A40]/20"
          />

          <input
            type="date"
            value={fFrom}
            onChange={e => setFFrom(e.target.value)}
            className="px-3 py-2 border border-[#5A5A40]/15 rounded-xl text-xs bg-white focus:outline-none focus:ring-2 focus:ring-[#5A5A40]/20"
          />
          <input
            type="date"
            value={fTo}
            onChange={e => setFTo(e.target.value)}
            className="px-3 py-2 border border-[#5A5A40]/15 rounded-xl text-xs bg-white focus:outline-none focus:ring-2 focus:ring-[#5A5A40]/20"
          />
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleSearch}
            className="flex items-center gap-2 px-4 py-2 bg-[#5A5A40] text-white rounded-xl text-xs font-bold hover:bg-[#4a4a30] transition-colors"
          >
            <Search size={13} /> Применить
          </button>
          <button
            onClick={handleReset}
            className="px-4 py-2 border border-[#5A5A40]/15 text-[#5A5A40] rounded-xl text-xs font-semibold hover:bg-[#f5f5f0] transition-colors"
          >
            Сбросить
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-[#5A5A40]/10 overflow-hidden shadow-sm">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-[#5A5A40]/50 text-sm gap-2">
            <RefreshCw size={16} className="animate-spin" /> Загрузка...
          </div>
        ) : entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-[#5A5A40]/40">
            <ClipboardList size={40} className="opacity-30" />
            <p className="text-sm">Записи не найдены</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#5A5A40]/8 bg-[#f5f5f0]/50 text-on-surface">
                <th className="text-left px-5 py-3 text-xs font-normal uppercase tracking-wider text-[#5A5A40]/50 w-40">
                  <div className="flex items-center gap-1"><Clock size={11} /> Время</div>
                </th>
                <th className="text-left px-4 py-3 text-xs font-normal uppercase tracking-wider text-[#5A5A40]/50 w-28">
                  <div className="flex items-center gap-1"><Layers size={11} /> Модуль</div>
                </th>
                <th className="text-left px-4 py-3 text-xs font-normal uppercase tracking-wider text-[#5A5A40]/50">Действие</th>
                <th className="text-left px-4 py-3 text-xs font-normal uppercase tracking-wider text-[#5A5A40]/50 w-40">
                  <div className="flex items-center gap-1"><User size={11} /> Сотрудник</div>
                </th>
                <th className="px-4 py-3 text-right text-xs font-normal uppercase tracking-wider text-[#5A5A40]/50 w-24">Детали</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#5A5A40]/5">
              {entries.map((entry) => {
                const modColor = MODULE_COLORS[entry.module ?? ''] ?? 'bg-slate-100 text-slate-600 border-slate-200';
                const hasDiff  = (entry.oldValue || entry.newValue);
                return (
                  <tr key={entry.id} className="hover:bg-[#f5f5f0]/40 transition-colors">
                    <td className="px-5 py-3 text-xs text-[#5A5A40]/60 whitespace-nowrap">
                      {formatDate(entry.createdAt)}
                    </td>
                    <td className="px-4 py-3">
                      {entry.module ? (
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-lg text-[10px] font-normal border ${modColor}`}>
                          {MODULE_LABELS[entry.module] ?? entry.module}
                        </span>
                      ) : (
                        <span className="text-[#5A5A40]/30 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-xs font-normal text-[#151619]">{formatAction(entry.action)}</p>
                      <p className="text-[10px] text-[#5A5A40]/45 mt-0.5 font-normal italic">{entry.entity}{entry.entityId ? ` · ${entry.entityId.slice(0, 8)}…` : ''}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-xs font-normal text-[#151619] truncate max-w-36">{entry.user.name}</p>
                      <p className="text-[10px] text-[#5A5A40]/45 truncate max-w-36 font-normal uppercase tracking-tighter">{entry.userRole ?? ''}</p>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {hasDiff && (
                        <button
                          onClick={() => setDetail(entry)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-[#5A5A40]/10 text-[#5A5A40]/60 hover:text-[#5A5A40] hover:bg-[#f5f5f0] transition-colors text-[11px] font-normal"
                        >
                          <Info size={12} /> Открыть
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {pagination.totalPages > 1 && (
        <div className="flex items-center justify-between bg-[#f5f5f0]/30 p-4 rounded-2xl border border-[#5A5A40]/5">
          <p className="text-xs text-[#5A5A40]/50 font-normal">
            Страница {pagination.page} из {pagination.totalPages} · Всего {pagination.total} записей
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={pagination.page <= 1}
              className="p-2 rounded-xl border border-[#5A5A40]/15 text-[#5A5A40]/60 hover:bg-white hover:shadow-sm disabled:opacity-30 transition-all active:scale-95"
            >
              <ChevronLeft size={16} />
            </button>
            <div className="flex items-center gap-1">
              {[...Array(pagination.totalPages)].map((_, i) => {
                const p = i + 1;
                // Show first, last, and current+neighbor pages
                if (p === 1 || p === pagination.totalPages || Math.abs(p - pagination.page) <= 1) {
                  return (
                    <button
                      key={p}
                      onClick={() => setPage(p)}
                      className={`w-8 h-8 rounded-lg text-xs font-normal transition-all ${
                        pagination.page === p
                          ? 'bg-[#5A5A40] text-white shadow-md'
                          : 'text-[#5A5A40]/60 hover:bg-white hover:shadow-sm'
                      }`}
                    >
                      {p}
                    </button>
                  );
                }
                if (p === 2 || p === pagination.totalPages - 1) {
                  return <span key={p} className="text-[#5A5A40]/30 text-[10px]">...</span>;
                }
                return null;
              })}
            </div>
            <button
              onClick={() => setPage(p => Math.min(pagination.totalPages, p + 1))}
              disabled={pagination.page >= pagination.totalPages}
              className="p-2 rounded-xl border border-[#5A5A40]/15 text-[#5A5A40]/60 hover:bg-white hover:shadow-sm disabled:opacity-30 transition-all active:scale-95"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}

      {/* Detail Modal */}
      {detail && <DetailModal entry={detail} onClose={() => setDetail(null)} />}
    </div>
  );
};
