import React, { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Clock,
  CheckCircle2,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  DollarSign,
  ArrowUpCircle,
  ArrowDownCircle,
  BarChart3,
  RotateCcw,
} from 'lucide-react';
import { AppModal } from './AppModal';
import { loadLatestClosedShiftNotice, saveLatestClosedShiftNotice } from '../../lib/shiftCloseNotice';

interface CashMovement {
  id: string;
  type: 'CASH_IN' | 'CASH_OUT';
  amount: number;
  reason: string;
  createdAt: string;
}

interface Shift {
  id: string;
  shiftNo: string;
  status: 'OPEN' | 'CLOSED';
  openAt: string;
  closeAt?: string;
  openingCash: number;
  closingCash?: number;
  expectedCash?: number;
  discrepancy?: number;
  closeNote?: string;
  cashier?: { name: string };
  warehouse?: { name: string };
  _count?: { invoices: number; cashMovements: number };
  cashMovements?: CashMovement[];
}

interface ShiftReport {
  shift: Shift & { cashier: string; warehouse: string };
  summary: {
    totalInvoices: number;
    totalSales: number;
    returnedAmount: number;
    netSales: number;
    salesCogs: number;
    returnedCogs: number;
    netCogs: number;
    grossProfit: number;
    cashSales: number;
    cardSales: number;
    cashIn: number;
    cashOut: number;
    netCash: number;
    finalAmount: number;
  };
  invoices: any[];
  cashMovements: CashMovement[];
}

type CloseShiftResult = {
  shiftId: string;
  shiftNo?: string;
  grossProfit: number;
  finalAmount: number;
  netSales: number;
};

function authHeaders() {
  const token = localStorage.getItem('pharmapro_token');
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export function OpenShiftModal({ open, onClose, onOpened }: { open: boolean; onClose: () => void; onOpened: () => void }) {
  const { t } = useTranslation();
  const [openingCash, setOpeningCash] = useState('0');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { if (!open) { setOpeningCash('0'); setError(''); } }, [open]);

  const handleSubmit = async () => {
    setSubmitting(true); setError('');
    try {
      const res = await fetch('/api/shifts/open', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ openingCash: Number(openingCash) }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.message || t('Operation failed')); }
      onOpened(); onClose();
    } catch (e: any) { setError(e.message); }
    finally { setSubmitting(false); }
  };

  if (!open) return null;
  return (
    <AppModal
      open={open}
      title={t('Open Shift')}
      tone="success"
      size="sm"
      onClose={onClose}
      footer={
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 py-3 rounded-2xl border border-[#5A5A40]/20 text-[#5A5A40] text-sm font-semibold hover:bg-[#f5f5f0]">{t('Cancel')}</button>
          <button onClick={handleSubmit} disabled={submitting} className="flex-1 py-3 rounded-2xl bg-emerald-500 text-white text-sm font-semibold hover:bg-emerald-600 disabled:opacity-50">
            {submitting ? t('Opening...') : t('Open Shift')}
          </button>
        </div>
      }
    >
      <div>
        <label className="text-xs font-semibold text-[#5A5A40]/60 uppercase tracking-widest mb-2 block">{t('Opening Cash Balance')}</label>
        <input
          type="number" min={0} step={0.01}
          className="w-full px-4 py-3 border border-[#5A5A40]/10 rounded-xl text-lg font-bold outline-none focus:ring-2 focus:ring-[#5A5A40]/20 mb-6"
          value={openingCash}
          onChange={(e) => setOpeningCash(e.target.value)}
        />
        {error && <p className="text-red-500 text-sm mb-4">{error}</p>}
      </div>
    </AppModal>
  );
}

export function CloseShiftModal({ shiftId, open, onClose, onClosed }: { shiftId: string; open: boolean; onClose: () => void; onClosed: (result?: CloseShiftResult) => void }) {
  const { t } = useTranslation();
  const [closingCash, setClosingCash] = useState('');
  const [closeNote, setCloseNote] = useState('');
  const [expectedCash, setExpectedCash] = useState<number | null>(null);
  const [grossProfit, setGrossProfit] = useState<number | null>(null);
  const [netSales, setNetSales] = useState<number | null>(null);
  const [loadingExpected, setLoadingExpected] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) {
      setClosingCash('');
      setCloseNote('');
      setExpectedCash(null);
      setGrossProfit(null);
      setNetSales(null);
      setConfirmClose(false);
      setError('');
      return;
    }

    const loadExpectedCash = async () => {
      setLoadingExpected(true);
      setError('');
      try {
        const res = await fetch(`/api/shifts/${shiftId}/report`, { headers: authHeaders() });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data?.message || data?.error || t('Operation failed'));
        }
        const finalAmount = Number(data?.summary?.finalAmount ?? 0);
        const grossProfitValue = Number(data?.summary?.grossProfit ?? 0);
        const netSalesValue = Number(data?.summary?.netSales ?? 0);
        setExpectedCash(finalAmount);
        setGrossProfit(grossProfitValue);
        setNetSales(netSalesValue);
        setClosingCash(finalAmount.toFixed(2));
      } catch (e: any) {
        setError(e?.message || t('Operation failed'));
      } finally {
        setLoadingExpected(false);
      }
    };

    void loadExpectedCash();
  }, [open, shiftId, t]);

  const handleSubmit = async () => {
    const amount = Number(closingCash);
    if (!Number.isFinite(amount) || amount < 0) {
      setError(t('Enter valid amount'));
      return;
    }

    const confirmed = window.confirm(`Закрыть смену с суммой ${amount.toFixed(2)}?`);
    if (!confirmed) return;

    setSubmitting(true);
    setError('');
    try {
      const res = await fetch(`/api/shifts/${shiftId}/close`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ closingCash: amount, closeNote }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.message || d.error || t('Operation failed'));
      }
      const data = await res.json().catch(() => ({}));
      onClosed({
        shiftId,
        shiftNo: data?.shiftNo,
        grossProfit: Number(data?.summary?.grossProfit ?? grossProfit ?? 0),
        finalAmount: Number(data?.summary?.finalAmount ?? expectedCash ?? 0),
        netSales: Number(data?.summary?.netSales ?? netSales ?? 0),
      });
      onClose();
    } catch (e: any) {
      setError(e?.message || t('Operation failed'));
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;
  return (
    <AppModal
      open={open}
      title={t('Close Shift')}
      tone="neutral"
      size="sm"
      onClose={onClose}
      footer={
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 py-3 rounded-2xl border border-[#5A5A40]/20 text-[#5A5A40] text-sm font-semibold hover:bg-[#f5f5f0]">{t('Cancel')}</button>
          <button onClick={handleSubmit} disabled={submitting || loadingExpected || !confirmClose} className="flex-1 py-3 rounded-2xl bg-[#5A5A40] text-white text-sm font-semibold hover:bg-[#4A4A30] disabled:opacity-50">
            {submitting ? t('Closing...') : t('Close Shift')}
          </button>
        </div>
      }
    >
      <div>
        <label className="text-xs font-semibold text-[#5A5A40]/60 uppercase tracking-widest mb-2 block">{t('Actual Cash in Register')}</label>
        <input
          type="number" min={0} step={0.01}
          className="w-full px-4 py-3 border border-[#5A5A40]/10 rounded-xl text-lg font-bold outline-none focus:ring-2 focus:ring-[#5A5A40]/20 mb-2"
          value={closingCash}
          onChange={(e) => setClosingCash(e.target.value)}
          placeholder="0.00"
          disabled={loadingExpected}
        />
        <p className="text-xs text-[#5A5A40]/60 mb-4">
          {loadingExpected
            ? 'Считаем сумму за сегодня...'
            : `Касса к закрытию: ${Number(expectedCash ?? 0).toFixed(2)} TJS`}
        </p>
        {grossProfit !== null && (
          <div className="rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3 mb-4">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="text-emerald-700 font-semibold">Прибыль за сегодня</span>
              <span className="text-emerald-800 font-bold">{grossProfit.toFixed(2)} TJS</span>
            </div>
            <p className="text-xs text-emerald-700/80 mt-1">Чистые продажи за смену: {Number(netSales ?? 0).toFixed(2)} TJS</p>
          </div>
        )}
        <label className="text-xs font-semibold text-[#5A5A40]/60 uppercase tracking-widest mb-2 block">{t('Note')}</label>
        <input
          className="w-full px-4 py-2.5 border border-[#5A5A40]/10 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#5A5A40]/20 mb-3"
          value={closeNote}
          onChange={(e) => setCloseNote(e.target.value)}
          placeholder={t('Optional note')}
        />
        <label className="flex items-start gap-2 text-sm text-[#5A5A40]/80 mb-3">
          <input
            type="checkbox"
            checked={confirmClose}
            onChange={(e) => setConfirmClose(e.target.checked)}
            className="mt-0.5"
          />
          Подтверждаю закрытие смены с указанной суммой
        </label>
        {error && <p className="text-red-500 text-sm mb-1">{error}</p>}
      </div>
    </AppModal>
  );
}

function CashMovementModal({ shiftId, open, onClose, onAdded }: { shiftId: string; open: boolean; onClose: () => void; onAdded: () => void }) {
  const { t } = useTranslation();
  const [movType, setMovType] = useState<'CASH_IN' | 'CASH_OUT'>('CASH_IN');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { if (!open) { setAmount(''); setReason(''); setError(''); } }, [open]);

  const handleSubmit = async () => {
    setSubmitting(true); setError('');
    try {
      const res = await fetch(`/api/shifts/${shiftId}/movements`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ type: movType, amount: Number(amount), reason }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.message || t('Operation failed')); }
      onAdded(); onClose();
    } catch (e: any) { setError(e.message); }
    finally { setSubmitting(false); }
  };

  if (!open) return null;
  return (
    <AppModal
      open={open}
      title={t('Cash Movement')}
      tone="info"
      size="sm"
      onClose={onClose}
      footer={
        <button onClick={handleSubmit} disabled={submitting || !amount || !reason} className="w-full py-3 rounded-2xl bg-[#5A5A40] text-white text-sm font-semibold hover:bg-[#4A4A30] disabled:opacity-50">
          {submitting ? t('Saving...') : t('Add Movement')}
        </button>
      }
    >
      <div>
        <div className="flex gap-2 mb-5">
          {(['CASH_IN', 'CASH_OUT'] as const).map((tp) => (
            <button key={tp} onClick={() => setMovType(tp)}
              className={`flex-1 py-2.5 rounded-xl text-sm font-semibold border transition-all ${movType === tp ? (tp === 'CASH_IN' ? 'bg-emerald-500 text-white border-emerald-500' : 'bg-red-500 text-white border-red-500') : 'border-[#5A5A40]/20 text-[#5A5A40]/60'}`}>
              {tp === 'CASH_IN' ? t('Cash In') : t('Cash Out')}
            </button>
          ))}
        </div>
        <label className="text-xs font-semibold text-[#5A5A40]/60 uppercase tracking-widest mb-2 block">{t('Amount')}</label>
        <input type="number" min={0} step={0.01} className="w-full px-4 py-3 border border-[#5A5A40]/10 rounded-xl text-lg font-bold outline-none focus:ring-2 focus:ring-[#5A5A40]/20 mb-4" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
        <label className="text-xs font-semibold text-[#5A5A40]/60 uppercase tracking-widest mb-2 block">{t('Reason')}</label>
        <input className="w-full px-4 py-2.5 border border-[#5A5A40]/10 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#5A5A40]/20 mb-6" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('Describe this movement')} />
        {error && <p className="text-red-500 text-sm mb-4">{error}</p>}
      </div>
    </AppModal>
  );
}

function ShiftReportPanel({ shiftId, onClose }: { shiftId: string; onClose: () => void }) {
  const { t } = useTranslation();
  const [report, setReport] = useState<ShiftReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadReport = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(`/api/shifts/${shiftId}/report`, { headers: authHeaders() });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(body?.message || body?.error || 'Не удалось загрузить X-отчет');
        }
        if (!cancelled) {
          setReport(body);
        }
      } catch (loadError: any) {
        if (!cancelled) {
          setError(loadError?.message || 'Не удалось загрузить X-отчет');
          setReport(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void loadReport();
    return () => {
      cancelled = true;
    };
  }, [shiftId]);

  if (loading) return <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-[#5A5A40]" /></div>;
  if (error) return <div className="rounded-2xl border border-red-100 bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  if (!report) return null;

  const { shift, summary } = report;
  const disc = shift.discrepancy ?? 0;

  return (
    <AppModal
      open={!!report}
      title={shift.status === 'OPEN' ? 'X-Report' : 'Z-Report'}
      subtitle={`${shift.shiftNo} · ${shift.cashier} · ${shift.warehouse}`}
      tone="neutral"
      size="lg"
      onClose={onClose}
    >
      <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: t('Total Sales'), value: summary.totalSales.toFixed(2), icon: TrendingUp, color: 'text-emerald-500' },
              { label: 'Возвраты', value: summary.returnedAmount.toFixed(2), icon: RotateCcw, color: 'text-orange-500' },
              { label: 'Чистые продажи', value: summary.netSales.toFixed(2), icon: TrendingUp, color: 'text-emerald-600' },
              { label: t('Cash Sales'), value: summary.cashSales.toFixed(2), icon: DollarSign, color: 'text-blue-500' },
              { label: t('Card Sales'), value: summary.cardSales.toFixed(2), icon: BarChart3, color: 'text-purple-500' },
              { label: t('Total Invoices'), value: String(summary.totalInvoices), icon: BarChart3, color: 'text-[#5A5A40]' },
              { label: t('Cash In'), value: summary.cashIn.toFixed(2), icon: ArrowUpCircle, color: 'text-emerald-500' },
              { label: t('Cash Out'), value: summary.cashOut.toFixed(2), icon: ArrowDownCircle, color: 'text-red-500' },
            ].map(({ label, value, icon: Icon, color }) => (
              <div key={label} className="bg-[#f5f5f0] rounded-2xl p-4">
                <div className={`${color} mb-1`}><Icon size={16} /></div>
                <p className="text-2xl font-bold text-[#151619]">{value}</p>
                <p className="text-xs text-[#5A5A40]/50 mt-0.5">{label}</p>
              </div>
            ))}
          </div>

          <div className="bg-[#151619] rounded-2xl p-4 text-white">
            <div className="flex justify-between mb-2">
              <span className="text-white/60 text-sm">{t('Opening Cash')}</span>
              <span className="font-bold">{shift.openingCash.toFixed(2)}</span>
            </div>
            <div className="flex justify-between mb-2">
              <span className="text-white/60 text-sm">{t('Expected Cash')}</span>
              <span className="font-bold">{(shift.expectedCash ?? summary.netCash).toFixed(2)}</span>
            </div>
            <div className="flex justify-between mb-2">
              <span className="text-white/60 text-sm">Расходы</span>
              <span className="font-bold text-red-400">{summary.cashOut.toFixed(2)}</span>
            </div>
            <div className="flex justify-between border-t border-white/20 pt-2 mt-2 mb-2 font-bold text-lg">
              <span className="text-white">{t('Final Amount')}</span>
              <span className="text-emerald-400">{summary.finalAmount.toFixed(2)}</span>
            </div>
            {shift.closingCash !== undefined && shift.closingCash !== null && (
              <>
                <div className="flex justify-between mb-2">
                  <span className="text-white/60 text-sm">{t('Actual Cash')}</span>
                  <span className="font-bold">{shift.closingCash.toFixed(2)}</span>
                </div>
                <div className="flex justify-between border-t border-white/10 pt-2 mt-2">
                  <span className="text-white/60 text-sm">{t('Discrepancy')}</span>
                  <span className={`font-bold ${disc < 0 ? 'text-red-400' : disc > 0 ? 'text-emerald-400' : 'text-white'}`}>
                    {disc > 0 ? '+' : ''}{disc.toFixed(2)}
                  </span>
                </div>
              </>
            )}
          </div>

          {report.cashMovements.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-[#5A5A40]/60 uppercase tracking-widest mb-3">{t('Cash Movements')}</h4>
              <div className="space-y-2">
                {report.cashMovements.map((m) => (
                  <div key={m.id} className="flex items-center justify-between bg-[#f5f5f0] rounded-xl px-4 py-2.5">
                    <div className="flex items-center gap-3">
                      {m.type === 'CASH_IN'
                        ? <ArrowUpCircle size={16} className="text-emerald-500" />
                        : <ArrowDownCircle size={16} className="text-red-500" />}
                      <span className="text-sm text-[#5A5A40]">{m.reason}</span>
                    </div>
                    <span className={`font-bold text-sm ${m.type === 'CASH_IN' ? 'text-emerald-600' : 'text-red-600'}`}>
                      {m.type === 'CASH_IN' ? '+' : '−'}{m.amount.toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
    </AppModal>
  );
}

export const ShiftView: React.FC<{ initialReportShiftId?: string; onInitialReportHandled?: () => void }> = ({
  initialReportShiftId,
  onInitialReportHandled,
}) => {
  const { t } = useTranslation();
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [activeShift, setActiveShift] = useState<Shift | null>(null);
  const [lastClosedShift, setLastClosedShift] = useState<CloseShiftResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [isOpenModal, setIsOpenModal] = useState(false);
  const [isCloseModal, setIsCloseModal] = useState(false);
  const [isCashMovModal, setIsCashMovModal] = useState(false);
  const [reportShiftId, setReportShiftId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [shiftsRes, activeRes] = await Promise.all([
        fetch('/api/shifts', { headers: authHeaders() }),
        fetch('/api/shifts/active', { headers: authHeaders() }),
      ]);
      if (shiftsRes.ok) setShifts(await shiftsRes.json());
      if (activeRes.ok) setActiveShift(await activeRes.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const lastNotice = loadLatestClosedShiftNotice();
    if (lastNotice) {
      setLastClosedShift(lastNotice);
    }
  }, []);

  useEffect(() => {
    if (!initialReportShiftId) return;
    setReportShiftId(initialReportShiftId);
    onInitialReportHandled?.();
  }, [initialReportShiftId, onInitialReportHandled]);

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex items-end justify-between">
        <div>
          <h2 className="text-3xl font-bold text-[#5A5A40] tracking-tight">{t('Cash Shifts')}</h2>
          <p className="text-[#5A5A40]/60 mt-1 italic">{t('Manage cashier shifts, X/Z reports and cash movements')}</p>
        </div>
        <button onClick={load} className="p-3 bg-white rounded-2xl border border-[#5A5A40]/10 text-[#5A5A40]/60 hover:text-[#5A5A40] transition-all shadow-sm">
          <RefreshCw size={18} />
        </button>
      </div>

      {/* Active shift banner */}
      {!loading && (
        <div className={`rounded-3xl p-6 ${activeShift ? 'bg-emerald-50 border border-emerald-200' : 'bg-[#f5f5f0] border border-[#5A5A40]/10'}`}>
          {activeShift ? (
            <div className="flex items-center justify-between flex-wrap gap-4">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-2xl bg-emerald-500 flex items-center justify-center shadow-lg">
                  <Clock size={22} className="text-white" />
                </div>
                <div>
                  <p className="font-bold text-emerald-800 text-lg">{t('Shift Open')} — {activeShift.shiftNo}</p>
                  <p className="text-sm text-emerald-600">
                    {t('Opened')} {new Date(activeShift.openAt).toLocaleTimeString()} · {t('Opening cash')}: {activeShift.openingCash.toFixed(2)} TJS
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setIsCashMovModal(true)}
                  className="px-4 py-2.5 bg-white border border-emerald-300 text-emerald-700 rounded-xl text-sm font-semibold hover:bg-emerald-50 transition-all flex items-center gap-2"
                >
                  <DollarSign size={16} /> {t('Cash Movement')}
                </button>
                <button
                  onClick={() => setReportShiftId(activeShift.id)}
                  className="px-4 py-2.5 bg-white border border-emerald-300 text-emerald-700 rounded-xl text-sm font-semibold hover:bg-emerald-50 transition-all flex items-center gap-2"
                >
                  <BarChart3 size={16} /> {t('X-Report')}
                </button>
                <button
                  onClick={() => setIsCloseModal(true)}
                  className="px-4 py-2.5 bg-[#5A5A40] text-white rounded-xl text-sm font-semibold hover:bg-[#4A4A30] transition-all"
                >
                  {t('Close Shift')}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-2xl bg-[#5A5A40]/10 flex items-center justify-center">
                  <Clock size={22} className="text-[#5A5A40]/40" />
                </div>
                <div>
                  <p className="font-semibold text-[#5A5A40]">{t('No active shift')}</p>
                  <p className="text-sm text-[#5A5A40]/50">{t('Open a shift to start recording sales')}</p>
                </div>
              </div>
              <button
                onClick={() => setIsOpenModal(true)}
                className="px-6 py-3 bg-emerald-500 text-white rounded-2xl text-sm font-semibold hover:bg-emerald-600 transition-all shadow-lg flex items-center gap-2"
              >
                <CheckCircle2 size={18} /> {t('Open Shift')}
              </button>
            </div>
          )}
        </div>
      )}

      {lastClosedShift && (
        <div className="rounded-3xl border border-emerald-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-emerald-600">Смена закрыта</p>
              <h3 className="text-xl font-bold text-[#5A5A40] mt-1">{lastClosedShift.shiftNo || 'Последняя смена'} завершена</h3>
              <p className="text-sm text-[#5A5A40]/60 mt-1">Прибыль за сегодня показана сразу после закрытия смены.</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 min-w-65">
              <div className="rounded-2xl bg-emerald-50 px-4 py-3">
                <p className="text-xs uppercase tracking-widest text-emerald-600">Прибыль</p>
                <p className="text-xl font-bold text-emerald-800 mt-1">{lastClosedShift.grossProfit.toFixed(2)} TJS</p>
              </div>
              <div className="rounded-2xl bg-[#f5f5f0] px-4 py-3">
                <p className="text-xs uppercase tracking-widest text-[#5A5A40]/60">Продажи нетто</p>
                <p className="text-xl font-bold text-[#5A5A40] mt-1">{lastClosedShift.netSales.toFixed(2)} TJS</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Shift history */}
      {loading ? (
        <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-[#5A5A40]" /></div>
      ) : (
        <div>
          <h3 className="text-xs font-semibold text-[#5A5A40]/40 uppercase tracking-widest mb-4">{t('Shift History')}</h3>
          <div className="space-y-3">
            {shifts.map((shift) => (
              <div key={shift.id} className="bg-white rounded-2xl shadow-sm border border-[#5A5A40]/5 px-6 py-4 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${shift.status === 'OPEN' ? 'bg-emerald-100' : 'bg-[#f5f5f0]'}`}>
                    {shift.status === 'OPEN'
                      ? <Clock size={16} className="text-emerald-600" />
                      : <CheckCircle2 size={16} className="text-[#5A5A40]/40" />}
                  </div>
                  <div>
                    <p className="font-semibold text-[#151619] text-sm">{shift.shiftNo}</p>
                    <p className="text-xs text-[#5A5A40]/50 mt-0.5">
                      {shift.cashier?.name} · {new Date(shift.openAt).toLocaleDateString()} {new Date(shift.openAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      {shift.closeAt && ` → ${new Date(shift.closeAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right hidden sm:block">
                    <p className="text-xs text-[#5A5A40]/40">{t('Opening')}</p>
                      <p className="font-bold text-sm text-[#5A5A40]">{shift.openingCash.toFixed(2)} TJS</p>
                  </div>
                  {shift.closingCash !== undefined && shift.closingCash !== null && (
                    <div className="text-right hidden sm:block">
                      <p className="text-xs text-[#5A5A40]/40">{t('Closing')}</p>
                      <p className="font-bold text-sm text-[#5A5A40]">{shift.closingCash.toFixed(2)} TJS</p>
                    </div>
                  )}
                  {shift.discrepancy !== undefined && shift.discrepancy !== null && shift.discrepancy !== 0 && (
                    <div className="text-right min-w-27">
                      <p className="text-[10px] text-[#5A5A40]/40 uppercase tracking-widest">{t('Discrepancy')}</p>
                      <span className={`inline-flex mt-1 text-xs font-bold px-2 py-1 rounded-lg ${shift.discrepancy < 0 ? 'bg-red-100 text-red-600' : 'bg-emerald-100 text-emerald-600'}`}>
                        {shift.discrepancy > 0 ? '+' : ''}{shift.discrepancy.toFixed(2)}
                      </span>
                    </div>
                  )}
                  <button
                    onClick={() => setReportShiftId(shift.id)}
                    className="p-2 rounded-xl border border-[#5A5A40]/10 hover:bg-[#f5f5f0] transition-all text-[#5A5A40]/60"
                  >
                    <BarChart3 size={16} />
                  </button>
                </div>
              </div>
            ))}
            {shifts.length === 0 && (
              <p className="text-center text-[#5A5A40]/40 py-8">{t('No shifts recorded yet')}</p>
            )}
          </div>
        </div>
      )}

      {/* Modals */}
      <OpenShiftModal open={isOpenModal} onClose={() => setIsOpenModal(false)} onOpened={load} />
      {activeShift && (
        <>
          <CloseShiftModal
            shiftId={activeShift.id}
            open={isCloseModal}
            onClose={() => setIsCloseModal(false)}
            onClosed={(result) => {
              if (result) {
                saveLatestClosedShiftNotice(result);
                setLastClosedShift(result);
              }
              void load();
            }}
          />
          <CashMovementModal shiftId={activeShift.id} open={isCashMovModal} onClose={() => setIsCashMovModal(false)} onAdded={load} />
        </>
      )}
      {reportShiftId && <ShiftReportPanel shiftId={reportShiftId} onClose={() => setReportShiftId(null)} />}
    </div>
  );
};
