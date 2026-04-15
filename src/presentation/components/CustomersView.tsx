import React, { useCallback, useEffect, useState } from 'react';
import {
  Users, UserPlus, Search, RefreshCw, ChevronLeft, ChevronRight,
  X, Save, Pencil, UserX, UserCheck, Phone, Mail, MapPin,
  ShoppingBag, ArrowLeftRight, AlertCircle, CreditCard, Wallet,
} from 'lucide-react';
import { buildApiHeaders } from '../../infrastructure/api';

// ─── Types ────────────────────────────────────────────────────────────────────

type CustomerSummary = {
  id: string; code: string | null; name: string; legalName: string | null;
  phone: string | null; email: string | null; address: string | null;
  creditLimit: number; defaultDiscount: number; isActive: boolean;
  totalDebt: number; invoiceCount: number; returnCount: number; createdAt: string;
};

type Payment = { id: string; amount: number; method: string; paymentDate: string; direction: string; comment: string | null };
type Invoice = { id: string; invoiceNo: string; date: string; totalAmount: number; paymentStatus: string; paymentType: string };
type Receivable = { id: string; originalAmount: number; remainingAmount: number; status: string; dueDate: string | null; createdAt: string };
type ReturnSummary = { id: string; returnNo: string; totalAmount: number; status: string; createdAt: string; type: string };

type CustomerDetail = CustomerSummary & {
  invoices: Invoice[]; receivables: Receivable[];
  returns: ReturnSummary[]; payments: Payment[];
};

type FormState = {
  name: string; legalName: string; phone: string; email: string;
  address: string; taxId: string; creditLimit: string; defaultDiscount: string;
};
const emptyForm = (): FormState => ({
  name: '', legalName: '', phone: '', email: '', address: '', taxId: '', creditLimit: '0', defaultDiscount: '0',
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

const money = (n: number) => n.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const fmtDatetime = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleString('ru-RU', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

const STATUS_MAP: Record<string, { label: string; cls: string }> = {
  PAID:         { label: 'Оплачено',    cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  UNPAID:       { label: 'Не оплачено', cls: 'bg-red-50 text-red-600 border-red-200' },
  PARTIALLY_PAID:{ label: 'Частично',  cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  COMPLETED:    { label: 'Завершён',    cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  DRAFT:        { label: 'Черновик',    cls: 'bg-slate-100 text-slate-600 border-slate-200' },
  REJECTED:     { label: 'Отклонён',   cls: 'bg-red-50 text-red-600 border-red-200' },
  OPEN:         { label: 'Открыт',     cls: 'bg-sky-50 text-sky-700 border-sky-200' },
  PARTIAL:      { label: 'Частично',   cls: 'bg-amber-50 text-amber-700 border-amber-200' },
};
const Badge: React.FC<{ status: string }> = ({ status }) => {
  const s = STATUS_MAP[status] ?? { label: status, cls: 'bg-slate-100 text-slate-600 border-slate-200' };
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-lg text-[10px] font-bold border ${s.cls}`}>{s.label}</span>;
};

// ─── Customer Form Modal ──────────────────────────────────────────────────────

type FormModalProps = {
  mode: 'create' | 'edit';
  initial?: Partial<FormState & { id: string }>;
  onClose: () => void;
  onSaved: () => void;
};

const FormModal: React.FC<FormModalProps> = ({ mode, initial, onClose, onSaved }) => {
  const [form, setForm] = useState<FormState>({ ...emptyForm(), ...initial });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!form.name.trim()) { setError('Имя обязательно'); return; }
    setSaving(true); setError(null);
    try {
      const url  = mode === 'create' ? '/api/customers' : `/api/customers/${(initial as any).id}`;
      const meth = mode === 'create' ? 'POST' : 'PUT';
      const res  = await fetch(url, {
        method: meth,
        headers: await buildApiHeaders(),
        body: JSON.stringify({
          name: form.name, legalName: form.legalName || null, phone: form.phone || null,
          email: form.email || null, address: form.address || null, taxId: form.taxId || null,
          creditLimit: Number(form.creditLimit) || 0,
          defaultDiscount: Number(form.defaultDiscount) || 0,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Ошибка сохранения');
      onSaved();
    } catch (e: any) { setError(e?.message || 'Ошибка'); } finally { setSaving(false); }
  };

  const field = (key: keyof FormState, label: string, type = 'text', placeholder = '') => (
    <div>
      <label className="block text-[10px] font-bold uppercase tracking-wider text-[#5A5A40]/50 mb-1.5">{label}</label>
      <input type={type} placeholder={placeholder}
        value={form[key]}
        onChange={e => setForm(s => ({ ...s, [key]: e.target.value }))}
        className="w-full px-3 py-2.5 border border-[#5A5A40]/15 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#5A5A40]/20"
      />
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg border border-[#5A5A40]/10 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#5A5A40]/8">
          <h4 className="text-base font-bold text-[#151619]">
            {mode === 'create' ? 'Новый покупатель' : 'Редактировать покупателя'}
          </h4>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-[#f5f5f0] text-[#5A5A40]/60 transition-colors"><X size={18} /></button>
        </div>
        <div className="px-6 py-5 space-y-3 max-h-[70vh] overflow-y-auto">
          {field('name',    'Имя / ФИО *',     'text', 'Иван Иванов')}
          {field('legalName','Юр. название',   'text', 'ООО «Ромашка»')}
          <div className="grid grid-cols-2 gap-3">
            {field('phone', 'Телефон', 'tel', '+992 ...')}
            {field('email', 'Email',   'email','ivan@mail.ru')}
          </div>
          {field('address', 'Адрес', 'text', 'г. Душанбе, ул. ...')}
          <div className="grid grid-cols-3 gap-3">
            {field('taxId',          'ИНН',         'text', '123456789')}
            {field('creditLimit',    'Лимит долга', 'number', '0')}
            {field('defaultDiscount','Скидка %',    'number', '0')}
          </div>
          {error && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{error}</p>}
        </div>
        <div className="px-6 pb-6 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2.5 rounded-xl border border-[#5A5A40]/15 text-[#5A5A40] text-sm font-semibold hover:bg-[#f5f5f0] transition-colors">Отмена</button>
          <button onClick={() => void handleSave()} disabled={saving}
            className="flex items-center gap-2 px-5 py-2.5 bg-[#5A5A40] text-white rounded-xl text-sm font-bold hover:bg-[#4a4a30] disabled:opacity-50 transition-colors">
            <Save size={15} />{saving ? 'Сохранение...' : mode === 'create' ? 'Создать' : 'Сохранить'}
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── Customer Detail Drawer ───────────────────────────────────────────────────

const DetailDrawer: React.FC<{ customerId: string; onClose: () => void; onEdit: () => void }> = ({ customerId, onClose, onEdit }) => {
  const [detail, setDetail] = useState<CustomerDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'invoices' | 'receivables' | 'returns' | 'payments'>('invoices');

  useEffect(() => {
    setLoading(true);
    fetch(`/api/customers/${customerId}`, { headers: buildApiHeaders(false) as any })
      .then(r => r.json()).then(setDetail).catch(() => null).finally(() => setLoading(false));
  }, [customerId]);

  if (loading || !detail) return (
    <div className="fixed inset-0 z-40 bg-black/20 flex items-center justify-end">
      <div className="bg-white w-full max-w-xl h-full flex items-center justify-center text-[#5A5A40]/50">
        <RefreshCw size={24} className="animate-spin" />
      </div>
    </div>
  );

  const totalDebt = detail.receivables.reduce((s, r) => s + Number(r.remainingAmount || 0), 0);
  const totalSpent = detail.invoices.reduce((s, i) => s + Number(i.totalAmount || 0), 0);

  const tabs: { key: typeof tab; label: string; icon: React.ReactNode; count: number }[] = [
    { key: 'invoices',    label: 'Покупки',    icon: <ShoppingBag size={13} />,    count: detail.invoices.length    },
    { key: 'receivables', label: 'Долги',      icon: <AlertCircle size={13} />,    count: detail.receivables.length },
    { key: 'returns',     label: 'Возвраты',   icon: <ArrowLeftRight size={13} />, count: detail.returns.length     },
    { key: 'payments',    label: 'Платежи',    icon: <CreditCard size={13} />,     count: detail.payments.length    },
  ];

  return (
    <div className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm flex items-start justify-end" onClick={onClose}>
      <div className="bg-white w-full max-w-xl h-full flex flex-col shadow-2xl border-l border-[#5A5A40]/10 overflow-hidden"
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="px-6 py-5 border-b border-[#5A5A40]/8 flex items-start justify-between gap-4 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-12 h-12 rounded-2xl bg-[#5A5A40]/8 flex items-center justify-center text-[#5A5A40] font-bold text-lg shrink-0">
              {detail.name.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <h3 className="text-base font-bold text-[#151619] truncate">{detail.name}</h3>
              {detail.legalName && <p className="text-xs text-[#5A5A40]/55 truncate">{detail.legalName}</p>}
              <div className="flex flex-wrap gap-2 mt-1">
                {detail.phone && <span className="flex items-center gap-1 text-[10px] text-[#5A5A40]/60"><Phone size={9} />{detail.phone}</span>}
                {detail.email && <span className="flex items-center gap-1 text-[10px] text-[#5A5A40]/60"><Mail size={9} />{detail.email}</span>}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={onEdit} className="p-2 rounded-xl border border-[#5A5A40]/15 text-[#5A5A40]/60 hover:bg-[#f5f5f0] transition-colors"><Pencil size={15} /></button>
            <button onClick={onClose} className="p-2 rounded-xl border border-[#5A5A40]/15 text-[#5A5A40]/60 hover:bg-[#f5f5f0] transition-colors"><X size={15} /></button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3 px-6 py-4 border-b border-[#5A5A40]/8 shrink-0">
          <div className="bg-[#f5f5f0]/60 rounded-xl p-3 text-center">
            <p className="text-[10px] font-bold uppercase tracking-wider text-[#5A5A40]/50">Покупок</p>
            <p className="text-lg font-bold text-[#151619] mt-1">{detail.invoiceCount}</p>
          </div>
          <div className="bg-[#f5f5f0]/60 rounded-xl p-3 text-center">
            <p className="text-[10px] font-bold uppercase tracking-wider text-[#5A5A40]/50">Сумма покупок</p>
            <p className="text-sm font-bold text-emerald-700 mt-1">{money(totalSpent)}</p>
          </div>
          <div className={`rounded-xl p-3 text-center ${totalDebt > 0 ? 'bg-red-50' : 'bg-[#f5f5f0]/60'}`}>
            <p className="text-[10px] font-bold uppercase tracking-wider text-[#5A5A40]/50">Долг</p>
            <p className={`text-sm font-bold mt-1 ${totalDebt > 0 ? 'text-red-600' : 'text-[#151619]'}`}>
              {totalDebt > 0 ? money(totalDebt) : '—'}
            </p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-6 pt-4 shrink-0">
          {tabs.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-colors ${tab === t.key ? 'bg-[#5A5A40] text-white' : 'text-[#5A5A40]/60 hover:bg-[#f5f5f0]'}`}>
              {t.icon}{t.label}
              <span className={`ml-0.5 text-[10px] px-1.5 py-0.5 rounded-full ${tab === t.key ? 'bg-white/20' : 'bg-[#5A5A40]/10'}`}>{t.count}</span>
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-2">
          {tab === 'invoices' && (
            detail.invoices.length === 0
              ? <p className="text-sm text-[#5A5A40]/40 text-center py-8">Нет покупок</p>
              : detail.invoices.map(inv => (
                <div key={inv.id} className="flex items-center justify-between p-3 bg-[#f5f5f0]/50 rounded-xl border border-[#5A5A40]/8">
                  <div>
                    <p className="text-xs font-bold text-[#151619]">{inv.invoiceNo}</p>
                    <p className="text-[10px] text-[#5A5A40]/55 mt-0.5">{fmtDatetime(inv.date)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-bold text-[#5A5A40]">{money(Number(inv.totalAmount))} TJS</p>
                    <Badge status={inv.paymentStatus} />
                  </div>
                </div>
              ))
          )}
          {tab === 'receivables' && (
            detail.receivables.length === 0
              ? <p className="text-sm text-[#5A5A40]/40 text-center py-8">Нет задолженностей</p>
              : detail.receivables.map(r => (
                <div key={r.id} className="flex items-center justify-between p-3 bg-[#f5f5f0]/50 rounded-xl border border-[#5A5A40]/8">
                  <div>
                    <p className="text-xs font-bold text-[#151619]">Долг: {money(Number(r.remainingAmount))} TJS</p>
                    <p className="text-[10px] text-[#5A5A40]/55 mt-0.5">Изначально: {money(Number(r.originalAmount))} TJS</p>
                    {r.dueDate && <p className="text-[10px] text-amber-600 mt-0.5">Срок: {fmtDate(r.dueDate)}</p>}
                  </div>
                  <Badge status={r.status} />
                </div>
              ))
          )}
          {tab === 'returns' && (
            detail.returns.length === 0
              ? <p className="text-sm text-[#5A5A40]/40 text-center py-8">Нет возвратов</p>
              : detail.returns.map(r => (
                <div key={r.id} className="flex items-center justify-between p-3 bg-[#f5f5f0]/50 rounded-xl border border-[#5A5A40]/8">
                  <div>
                    <p className="text-xs font-bold text-[#151619]">{r.returnNo}</p>
                    <p className="text-[10px] text-[#5A5A40]/55 mt-0.5">{fmtDatetime(r.createdAt)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-bold text-[#5A5A40]">{money(Number(r.totalAmount))} TJS</p>
                    <Badge status={r.status} />
                  </div>
                </div>
              ))
          )}
          {tab === 'payments' && (
            detail.payments.length === 0
              ? <p className="text-sm text-[#5A5A40]/40 text-center py-8">Нет платежей</p>
              : detail.payments.map(p => (
                <div key={p.id} className="flex items-center justify-between p-3 bg-[#f5f5f0]/50 rounded-xl border border-[#5A5A40]/8">
                  <div className="flex items-center gap-2">
                    <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${p.direction === 'IN' ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'}`}>
                      {p.method === 'CASH' ? <Wallet size={13} /> : <CreditCard size={13} />}
                    </div>
                    <div>
                      <p className="text-xs font-bold text-[#151619]">{p.direction === 'IN' ? 'Оплата' : 'Возврат'} · {p.method}</p>
                      <p className="text-[10px] text-[#5A5A40]/55">{fmtDatetime(p.paymentDate)}</p>
                    </div>
                  </div>
                  <p className={`text-xs font-bold ${p.direction === 'IN' ? 'text-emerald-600' : 'text-red-600'}`}>
                    {p.direction === 'IN' ? '+' : '−'}{money(Number(p.amount))} TJS
                  </p>
                </div>
              ))
          )}
        </div>
      </div>
    </div>
  );
};

// ─── Main View ────────────────────────────────────────────────────────────────

export const CustomersView: React.FC = () => {
  const [customers, setCustomers]     = useState<CustomerSummary[]>([]);
  const [pagination, setPagination]   = useState({ total: 0, page: 1, limit: 50, totalPages: 1 });
  const [search, setSearch]           = useState('');
  const [loading, setLoading]         = useState(true);
  const [page, setPage]               = useState(1);
  const [notice, setNotice]           = useState<string | null>(null);
  const [error, setError]             = useState<string | null>(null);
  const [showCreate, setShowCreate]   = useState(false);
  const [editing, setEditing]         = useState<CustomerSummary | null>(null);
  const [detailId, setDetailId]       = useState<string | null>(null);
  const [detailKey, setDetailKey]     = useState(0);

  const showMsg = (msg: string, isError = false) => {
    if (isError) { setError(msg); setTimeout(() => setError(null), 4000); }
    else         { setNotice(msg); setTimeout(() => setNotice(null), 3000); }
  };

  const load = useCallback(async (p = page, q = search) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(p), limit: '50' });
      if (q) params.set('search', q);
      const res = await fetch(`/api/customers?${params}`, { headers: await buildApiHeaders(false) });
      const body = await res.json().catch(() => ({ items: [], pagination: { total: 0, page: 1, limit: 50, totalPages: 1 } }));
      setCustomers(body.items ?? []);
      setPagination(body.pagination ?? { total: 0, page: 1, limit: 50, totalPages: 1 });
    } finally { setLoading(false); }
  }, [page, search]);

  useEffect(() => { void load(page, search); }, [page]); // eslint-disable-line

  const handleSearch = () => { setPage(1); void load(1, search); };

  const handleDeactivate = async (c: CustomerSummary) => {
    try {
      const url = c.isActive ? `/api/customers/${c.id}` : `/api/customers/${c.id}`;
      const method = c.isActive ? 'DELETE' : 'PUT';
      const body = c.isActive ? undefined : JSON.stringify({ isActive: true });
      const res = await fetch(url, { method, headers: await buildApiHeaders(), body });
      const b = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(b.error || 'Ошибка');
      showMsg(c.isActive ? `${c.name} деактивирован` : `${c.name} активирован`);
      void load(page, search);
    } catch (e: any) { showMsg(e?.message || 'Ошибка', true); }
  };

  const activeCount = customers.filter(c => c.isActive).length;
  const debtors     = customers.filter(c => c.totalDebt > 0).length;

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-[#151619]">Покупатели</h2>
          <p className="text-sm text-[#5A5A40]/55 mt-1">
            {pagination.total} клиентов · {activeCount} активных · {debtors > 0 ? <span className="text-red-500">{debtors} должников</span> : 'долгов нет'}
          </p>
        </div>
        <button onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2.5 bg-[#5A5A40] text-white rounded-xl text-sm font-bold hover:bg-[#4a4a30] transition-colors shadow-sm">
          <UserPlus size={16} /> Добавить покупателя
        </button>
      </div>

      {/* Notice */}
      {(notice || error) && (
        <div className={`rounded-xl px-4 py-3 text-sm border ${error ? 'bg-red-50 border-red-200 text-red-700' : 'bg-emerald-50 border-emerald-200 text-emerald-700'}`}>
          {error || notice}
        </div>
      )}

      {/* Search */}
      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-[#5A5A40]/30" size={17} />
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSearch()}
            placeholder="Имя, телефон, email, ИНН..."
            className="w-full pl-12 pr-4 py-3 bg-white border border-[#5A5A40]/10 rounded-2xl focus:outline-none focus:ring-2 focus:ring-[#5A5A40]/20 text-sm"
          />
        </div>
        <button onClick={handleSearch}
          className="px-5 py-3 bg-[#5A5A40] text-white rounded-2xl text-sm font-bold hover:bg-[#4a4a30] transition-colors">
          Найти
        </button>
        <button onClick={() => void load(page)}
          className="p-3 rounded-2xl border border-[#5A5A40]/15 text-[#5A5A40]/60 hover:bg-[#f5f5f0] transition-colors">
          <RefreshCw size={17} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-[#5A5A40]/10 overflow-hidden shadow-sm">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-[#5A5A40]/50 gap-2 text-sm">
            <RefreshCw size={16} className="animate-spin" /> Загрузка...
          </div>
        ) : customers.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-[#5A5A40]/40">
            <Users size={40} className="opacity-30" />
            <p className="text-sm">Покупатели не найдены</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#5A5A40]/8 bg-[#f5f5f0]/50">
                <th className="text-left px-5 py-3 text-xs font-bold uppercase tracking-wider text-[#5A5A40]/50">Покупатель</th>
                <th className="text-left px-4 py-3 text-xs font-bold uppercase tracking-wider text-[#5A5A40]/50">Контакты</th>
                <th className="text-right px-4 py-3 text-xs font-bold uppercase tracking-wider text-[#5A5A40]/50">Покупок</th>
                <th className="text-right px-4 py-3 text-xs font-bold uppercase tracking-wider text-[#5A5A40]/50">Долг</th>
                <th className="text-left px-4 py-3 text-xs font-bold uppercase tracking-wider text-[#5A5A40]/50">Статус</th>
                <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wider text-[#5A5A40]/50">Действия</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#5A5A40]/5">
              {customers.map(c => (
                <tr key={c.id} className={`hover:bg-[#f5f5f0]/40 transition-colors cursor-pointer ${!c.isActive ? 'opacity-50' : ''}`}
                  onClick={() => { setDetailId(c.id); setDetailKey(k => k + 1); }}>
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-xl bg-[#5A5A40]/8 flex items-center justify-center text-[#5A5A40] font-bold shrink-0">
                        {c.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold text-[#151619] truncate">{c.name}</p>
                        {c.legalName && <p className="text-[10px] text-[#5A5A40]/50 truncate">{c.legalName}</p>}
                        {c.defaultDiscount > 0 && (
                          <span className="inline-block text-[10px] bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded-md font-bold mt-0.5">Скидка {c.defaultDiscount}%</span>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-4">
                    {c.phone && <div className="flex items-center gap-1 text-xs text-[#5A5A40]/70"><Phone size={11} />{c.phone}</div>}
                    {c.email && <div className="flex items-center gap-1 text-[10px] text-[#5A5A40]/50 mt-0.5"><Mail size={10} />{c.email}</div>}
                    {c.address && <div className="flex items-center gap-1 text-[10px] text-[#5A5A40]/40 mt-0.5 truncate max-w-40"><MapPin size={10} />{c.address}</div>}
                  </td>
                  <td className="px-4 py-4 text-right">
                    <p className="text-xs font-bold text-[#5A5A40]">{c.invoiceCount}</p>
                    {c.returnCount > 0 && <p className="text-[10px] text-[#5A5A40]/50">{c.returnCount} возвр.</p>}
                  </td>
                  <td className="px-4 py-4 text-right">
                    {c.totalDebt > 0
                      ? <p className="text-xs font-bold text-red-600">{money(c.totalDebt)} TJS</p>
                      : <span className="text-[#5A5A40]/30 text-xs">—</span>}
                  </td>
                  <td className="px-4 py-4">
                    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold border ${c.isActive ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-red-50 text-red-600 border-red-200'}`}>
                      {c.isActive ? <UserCheck size={10} /> : <UserX size={10} />}
                      {c.isActive ? 'Активен' : 'Деактивирован'}
                    </span>
                  </td>
                  <td className="px-4 py-4" onClick={e => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-1.5">
                      <button onClick={() => setEditing(c)}
                        className="p-1.5 rounded-lg hover:bg-[#f5f5f0] text-[#5A5A40]/60 hover:text-[#5A5A40] transition-colors border border-transparent hover:border-[#5A5A40]/10"
                        title="Редактировать">
                        <Pencil size={14} />
                      </button>
                      <button onClick={() => void handleDeactivate(c)}
                        className={`p-1.5 rounded-lg transition-colors border border-transparent ${c.isActive ? 'hover:bg-red-50 text-[#5A5A40]/50 hover:text-red-600 hover:border-red-100' : 'hover:bg-emerald-50 text-[#5A5A40]/50 hover:text-emerald-600 hover:border-emerald-100'}`}
                        title={c.isActive ? 'Деактивировать' : 'Активировать'}>
                        {c.isActive ? <UserX size={14} /> : <UserCheck size={14} />}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {pagination.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-[#5A5A40]/50">Стр. {pagination.page} из {pagination.totalPages} · {pagination.total} покупателей</p>
          <div className="flex items-center gap-2">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
              className="p-2 rounded-xl border border-[#5A5A40]/15 text-[#5A5A40]/60 hover:bg-[#f5f5f0] disabled:opacity-30 transition-colors">
              <ChevronLeft size={16} />
            </button>
            <span className="text-xs font-semibold text-[#5A5A40]">{page}</span>
            <button onClick={() => setPage(p => Math.min(pagination.totalPages, p + 1))} disabled={page >= pagination.totalPages}
              className="p-2 rounded-xl border border-[#5A5A40]/15 text-[#5A5A40]/60 hover:bg-[#f5f5f0] disabled:opacity-30 transition-colors">
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}

      {/* Modals */}
      {showCreate && (
        <FormModal mode="create" onClose={() => setShowCreate(false)}
          onSaved={() => { setShowCreate(false); showMsg('Покупатель создан'); void load(1, search); }} />
      )}
      {editing && (
        <FormModal mode="edit" initial={{ ...editing, creditLimit: String(editing.creditLimit), defaultDiscount: String(editing.defaultDiscount) }}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); showMsg('Данные обновлены'); void load(page, search); }} />
      )}
      {detailId && (
        <DetailDrawer key={detailKey} customerId={detailId}
          onClose={() => setDetailId(null)}
          onEdit={() => { const c = customers.find(x => x.id === detailId); if (c) setEditing(c); setDetailId(null); }} />
      )}
    </div>
  );
};
