import React, { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { usePharmacy } from '../context';
import { Plus, Trash2, RefreshCw, AlertTriangle, Package } from 'lucide-react';
import { runRefreshTasks } from '../../lib/utils';
import { AppModal } from './AppModal';

const REASONS = ['EXPIRED', 'DAMAGED', 'LOST', 'INTERNAL_USE', 'MISMATCH', 'BROKEN_PACKAGING', 'OTHER'] as const;
type Reason = (typeof REASONS)[number];

interface WriteOffItem {
  id: string;
  productId: string;
  batchId?: string;
  quantity: number;
  product?: { name: string; sku: string };
  batch?: { batchNumber: string };
}

interface WriteOff {
  id: string;
  writeOffNo: string;
  reason: Reason;
  note?: string;
  createdAt: string;
  items: WriteOffItem[];
  createdBy?: { name: string };
  warehouse?: { name: string };
}

type FormItem = {
  productId: string;
  batchId: string;
  quantity: number;
};

const formatPackQuantity = (quantity: number) => {
  return `${Math.max(0, Math.floor(Number(quantity || 0)))} ед.`;
};

function authHeaders() {
  const token = localStorage.getItem('pharmapro_token');
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

function CreateWriteOffModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const { products, refreshProducts } = usePharmacy();
  const [reason, setReason] = useState<Reason>('EXPIRED');
  const [note, setNote] = useState('');
  const [formItems, setFormItems] = useState<FormItem[]>([{ productId: '', batchId: '', quantity: 1 }]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) {
      setReason('EXPIRED');
      setNote('');
      setFormItems([{ productId: '', batchId: '', quantity: 1 }]);
      setError('');
    }
  }, [open]);

  const updateItem = (idx: number, field: keyof FormItem, value: string | number) => {
    setFormItems((prev) => {
      const next = [...prev];
      if (field === 'productId') {
        next[idx] = { ...next[idx], productId: String(value), batchId: '' };
      } else {
        (next[idx] as any)[field] = value;
      }
      return next;
    });
  };

  const addItem = () => setFormItems((prev) => [...prev, { productId: '', batchId: '', quantity: 1 }]);
  const removeItem = (idx: number) => setFormItems((prev) => prev.filter((_, i) => i !== idx));

  const updateItemPackaging = (idx: number, boxesValue: string, unitsValue: string) => {
    setFormItems((prev) => {
      const next = [...prev];
      next[idx] = {
        ...next[idx],
        quantity: Math.max(1, Math.floor(Number(unitsValue) || 0)),
      };
      return next;
    });
  };

  const handleSubmit = async () => {
    if (formItems.some((it) => !it.productId || it.quantity <= 0)) {
      setError(t('All items need a product and valid quantity'));
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const res = await fetch('/api/writeoffs', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          reason,
          note,
          items: formItems.map((it) => ({
            productId: it.productId,
            batchId: it.batchId || undefined,
            quantity: it.quantity,
          })),
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || 'Failed to create write-off');
      }
      await runRefreshTasks(refreshProducts, onCreated);
      onClose();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <AppModal
      open={open}
      title={t('New Write-Off')}
      subtitle={t('This will immediately deduct stock from selected batches')}
      tone="danger"
      size="lg"
      onClose={onClose}
      footer={
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-3 rounded-2xl border border-[#5A5A40]/20 text-[#5A5A40] text-sm font-semibold hover:bg-[#f5f5f0] transition-all"
          >
            {t('Cancel')}
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="flex-1 py-3 rounded-2xl bg-red-600 text-white text-sm font-semibold hover:bg-red-700 transition-all disabled:opacity-50"
          >
            {submitting ? t('Processing...') : t('Confirm Write-Off')}
          </button>
        </div>
      }
    >
      <div className="space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-semibold text-[#5A5A40]/60 uppercase tracking-widest mb-1 block">{t('Reason')}</label>
              <select
                className="w-full px-4 py-2.5 border border-[#5A5A40]/10 rounded-xl text-sm bg-white outline-none focus:ring-2 focus:ring-[#5A5A40]/20"
                value={reason}
                onChange={(e) => setReason(e.target.value as Reason)}
              >
                {REASONS.map((r) => (
                  <option key={r} value={r}>{t(r.replace(/_/g, ' '))}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-[#5A5A40]/60 uppercase tracking-widest mb-1 block">{t('Note')}</label>
              <input
                className="w-full px-4 py-2.5 border border-[#5A5A40]/10 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#5A5A40]/20"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={t('Optional note')}
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-3">
              <label className="text-xs font-semibold text-[#5A5A40]/60 uppercase tracking-widest">{t('Items to Write Off')}</label>
              <button onClick={addItem} className="text-xs text-[#5A5A40] font-semibold flex items-center gap-1 hover:underline">
                <Plus size={14} /> {t('Add Item')}
              </button>
            </div>
            <div className="space-y-3">
              {formItems.map((item, idx) => {
                const selProd = products.find((p) => p.id === item.productId);
                return (
                  <div key={idx} className="grid grid-cols-12 gap-2 items-center bg-[#f5f5f0] rounded-xl p-3">
                    <div className="col-span-5">
                      <select
                        className="w-full px-3 py-2 border border-[#5A5A40]/10 rounded-lg text-sm bg-white outline-none"
                        value={item.productId}
                        onChange={(e) => updateItem(idx, 'productId', e.target.value)}
                      >
                        <option value="">{t('Select product')}</option>
                        {products.map((p) => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                    </div>
                    <div className="col-span-4">
                      <select
                        className="w-full px-3 py-2 border border-[#5A5A40]/10 rounded-lg text-sm bg-white outline-none"
                        value={item.batchId}
                        onChange={(e) => updateItem(idx, 'batchId', e.target.value)}
                        disabled={!selProd}
                      >
                        <option value="">{t('Batch (opt.)')}</option>
                        {selProd?.batches?.map((b) => (
                          <option key={b.id} value={b.id}>{b.batchNumber} ({formatPackQuantity(b.quantity)})</option>
                        ))}
                      </select>
                    </div>
                    <div className="col-span-2 space-y-1">
                      <input
                        type="number"
                        min={1}
                        className="w-full px-3 py-2 border border-[#5A5A40]/10 rounded-lg text-sm bg-white outline-none"
                        value={item.quantity}
                        onChange={(e) => updateItemPackaging(idx, '0', e.target.value)}
                        placeholder={t('Qty')}
                      />
                      <p className="text-[10px] text-[#5A5A40]/55 leading-tight">Количество в единицах</p>
                    </div>
                    <div className="col-span-1 flex justify-center">
                      {formItems.length > 1 && (
                        <button onClick={() => removeItem(idx)} className="text-red-400 hover:text-red-600 transition-colors">
                          <Trash2 size={16} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-start gap-3">
            <AlertTriangle size={16} className="text-amber-500 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-700">{t('Write-offs are irreversible. Stock will be permanently deducted from the selected batches.')}</p>
          </div>

          {error && <p className="text-red-500 text-sm font-medium">{error}</p>}
        </div>
    </AppModal>
  );
}

const REASON_STYLES: Record<string, string> = {
  EXPIRED: 'bg-orange-100 text-orange-700',
  DAMAGED: 'bg-red-100 text-red-700',
  LOST: 'bg-purple-100 text-purple-700',
  INTERNAL_USE: 'bg-blue-100 text-blue-700',
  MISMATCH: 'bg-yellow-100 text-yellow-700',
  BROKEN_PACKAGING: 'bg-pink-100 text-pink-700',
  OTHER: 'bg-gray-100 text-gray-700',
};

export const WriteOffView: React.FC = () => {
  const { t } = useTranslation();
  const [writeOffs, setWriteOffs] = useState<WriteOff[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/writeoffs', { headers: authHeaders() });
      if (res.ok) setWriteOffs(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex items-end justify-between">
        <div>
          <h2 className="text-3xl font-bold text-[#5A5A40] tracking-tight">{t('Write-Offs')}</h2>
          <p className="text-[#5A5A40]/60 mt-1 italic">{t('Record stock write-offs for expired, damaged or lost items')}</p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={load} className="p-3 bg-white rounded-2xl border border-[#5A5A40]/10 text-[#5A5A40]/60 hover:text-[#5A5A40] transition-all shadow-sm">
            <RefreshCw size={18} />
          </button>
          <button
            onClick={() => setIsModalOpen(true)}
            className="bg-red-600 text-white px-6 py-3 rounded-2xl font-medium shadow-lg hover:bg-red-700 transition-all flex items-center gap-2"
          >
            <Plus size={20} /> {t('New Write-Off')}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-[#5A5A40]" /></div>
      ) : writeOffs.length === 0 ? (
        <div className="text-center py-20 text-[#5A5A40]/40">
          <Package size={48} className="mx-auto mb-4 opacity-30" />
          <p className="text-lg font-medium">{t('No write-offs recorded')}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {writeOffs.map((wo) => (
            <div key={wo.id} className="bg-white rounded-2xl shadow-sm border border-[#5A5A40]/5 overflow-hidden">
              <div
                className="flex items-center justify-between px-6 py-4 cursor-pointer hover:bg-[#f5f5f0]/50 transition-colors"
                onClick={() => setExpandedId(expandedId === wo.id ? null : wo.id)}
              >
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-2xl bg-red-50 flex items-center justify-center">
                    <AlertTriangle size={18} className="text-red-400" />
                  </div>
                  <div>
                    <p className="font-semibold text-[#151619]">{wo.writeOffNo}</p>
                    <p className="text-xs text-[#5A5A40]/50 mt-0.5">
                      {wo.warehouse?.name} · {wo.createdBy?.name} · {wo.items.length} {t('item(s)')}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-xs text-[#5A5A40]/40">{new Date(wo.createdAt).toLocaleDateString()}</span>
                  <span className={`px-3 py-1 rounded-full text-xs font-bold ${REASON_STYLES[wo.reason] ?? 'bg-gray-100 text-gray-600'}`}>
                    {t(wo.reason.replace(/_/g, ' '))}
                  </span>
                </div>
              </div>

              {expandedId === wo.id && (
                <div className="px-6 pb-4 border-t border-[#5A5A40]/5">
                  {wo.note && <p className="text-sm text-[#5A5A40]/60 py-3">{t('Note')}: {wo.note}</p>}
                  <table className="w-full mt-2 text-sm">
                    <thead>
                      <tr className="text-xs text-[#5A5A40]/40 uppercase tracking-widest">
                        <th className="text-left py-2">{t('Product')}</th>
                        <th className="text-left py-2">{t('Batch')}</th>
                        <th className="text-right py-2">{t('Qty Written Off')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {wo.items.map((item) => (
                        <tr key={item.id} className="border-t border-[#5A5A40]/5">
                          <td className="py-2 font-medium">{item.product?.name ?? t('Unknown')}</td>
                          <td className="py-2 text-[#5A5A40]/60">{item.batch?.batchNumber ?? '—'}</td>
                          <td className="py-2 text-right text-red-600 font-semibold">−{formatPackQuantity(item.quantity)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <CreateWriteOffModal open={isModalOpen} onClose={() => setIsModalOpen(false)} onCreated={load} />
    </div>
  );
};
