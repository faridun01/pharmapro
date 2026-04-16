import React, { useEffect, useState, useCallback } from 'react';
import { usePharmacy } from '../context';
import { Plus, Trash2, RefreshCw, AlertTriangle, Package, Pencil, CheckCircle2, XCircle } from 'lucide-react';
import { runRefreshTasks } from '../../lib/utils';
import { AppModal } from './AppModal';
import { useCurrencyCode } from '../../lib/useCurrencyCode';
import { DateRangeFilter, ReportRangePreset } from './common/DateRangeFilter';
import { getPresetDates } from './common/dateUtils';

const REASONS = ['EXPIRED', 'DAMAGED', 'LOST', 'INTERNAL_USE', 'MISMATCH', 'BROKEN_PACKAGING', 'OTHER'] as const;
type Reason = (typeof REASONS)[number];

const REASON_LABELS: Record<Reason, string> = {
  EXPIRED: 'Просрочено',
  DAMAGED: 'Повреждено',
  LOST: 'Утеряно',
  INTERNAL_USE: 'Внутреннее использование',
  MISMATCH: 'Расхождение',
  BROKEN_PACKAGING: 'Нарушенная упаковка',
  OTHER: 'Другое',
};

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
  totalAmount?: number;
  createdAt: string;
  items: WriteOffItem[];
  createdBy?: { name: string };
  warehouse?: { name: string };
}

type FeedbackState = {
  tone: 'success' | 'error';
  message: string;
};

type FormItem = {
  productId: string;
  batchId: string;
  quantity: number;
};

const formatPackQuantity = (quantity: number) => {
  return `${Math.max(0, Math.floor(Number(quantity || 0)))} ед.`;
};

const formatBatchExpiry = (value?: string) => {
  if (!value) return 'Без срока';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Без срока';
  return date.toLocaleDateString('ru-RU');
};

const getBatchVisualState = (batch?: { expiryDate?: string; status?: string } | null) => {
  if (!batch) {
    return {
      label: 'Без статуса',
      chipClassName: 'bg-stone-100 text-stone-700 border-stone-200',
      cardClassName: 'border-[#5A5A40]/10 bg-white',
    };
  }

  const expiryDate = new Date(batch.expiryDate || '');
  const daysLeft = Number.isNaN(expiryDate.getTime())
    ? null
    : Math.ceil((expiryDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));

  if (daysLeft !== null && daysLeft <= 0) {
    return {
      label: 'Просрочена',
      chipClassName: 'bg-red-100 text-red-700 border-red-200',
      cardClassName: 'border-red-200 bg-red-50/70',
    };
  }

  if (daysLeft !== null && daysLeft <= 30) {
    return {
      label: `Скоро срок (${daysLeft} дн.)`,
      chipClassName: 'bg-amber-100 text-amber-800 border-amber-200',
      cardClassName: 'border-amber-200 bg-amber-50/70',
    };
  }

  return {
    label: 'Нормальная',
    chipClassName: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    cardClassName: 'border-emerald-200 bg-emerald-50/70',
  };
};

const getSortedWriteOffBatches = (product?: { batches?: Array<any> } | null) => {
  return [...(product?.batches || [])]
    .filter((batch) => Number(batch.quantity || 0) > 0)
    .sort((left, right) => {
      const leftExpiry = new Date(left.expiryDate).getTime();
      const rightExpiry = new Date(right.expiryDate).getTime();
      if (leftExpiry !== rightExpiry) {
        return leftExpiry - rightExpiry;
      }
      return Number(left.quantity || 0) - Number(right.quantity || 0);
    });
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
  initialWriteOff,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void | Promise<void>;
  initialWriteOff?: WriteOff | null;
}) {
  const currencyCode = useCurrencyCode();
  const { products, refreshProducts } = usePharmacy();
  const isEditing = Boolean(initialWriteOff);
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
      return;
    }

    if (initialWriteOff) {
      setReason(initialWriteOff.reason);
      setNote(initialWriteOff.note || '');
      setFormItems(
        initialWriteOff.items.length > 0
          ? initialWriteOff.items.map((item) => ({
              productId: item.productId,
              batchId: item.batchId || '',
              quantity: Math.max(1, Math.floor(Number(item.quantity || 0))),
            }))
          : [{ productId: '', batchId: '', quantity: 1 }],
      );
      setError('');
      return;
    }

    setReason('EXPIRED');
    setNote('');
    setFormItems([{ productId: '', batchId: '', quantity: 1 }]);
    setError('');
  }, [initialWriteOff, open]);

  useEffect(() => {
    if (!open || products.length > 0) {
      return;
    }

    void refreshProducts();
  }, [open, products.length, refreshProducts]);

  const updateItem = (idx: number, field: keyof FormItem, value: string | number) => {
    setFormItems((prev) => {
      const next = [...prev];
      if (field === 'productId') {
        const selectedProduct = products.find((product) => product.id === String(value));
        const firstBatch = getSortedWriteOffBatches(selectedProduct)[0];
        next[idx] = { ...next[idx], productId: String(value), batchId: firstBatch?.id || '' };
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
    if (formItems.some((it) => !it.productId || !it.batchId || it.quantity <= 0)) {
      setError('Для каждой позиции выберите товар, партию и укажите корректное количество.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const res = await fetch(initialWriteOff ? `/api/writeoffs/${initialWriteOff.id}` : '/api/writeoffs', {
        method: initialWriteOff ? 'PATCH' : 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          reason,
          note,
          items: formItems.map((it) => ({
            productId: it.productId,
            batchId: it.batchId,
            quantity: it.quantity,
          })),
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || (initialWriteOff ? 'Не удалось обновить списание' : 'Не удалось создать списание'));
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
      title={isEditing ? 'Редактирование списания' : 'Новое списание'}
      subtitle={isEditing ? 'Остатки будут пересчитаны по новым партиям и количеству' : 'Товары будут сразу списаны с выбранных партий'}
      tone="danger"
      size="xl"
      onClose={onClose}
      footer={
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-3 rounded-2xl border border-[#5A5A40]/20 text-[#5A5A40] text-sm font-semibold hover:bg-[#f5f5f0] transition-all"
          >
            Отмена
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="flex-1 py-3 rounded-2xl bg-red-600 text-white text-sm font-semibold hover:bg-red-700 transition-all disabled:opacity-50"
          >
            {submitting ? 'Сохранение...' : isEditing ? 'Сохранить изменения' : 'Подтвердить списание'}
          </button>
        </div>
      }
    >
      <div className="space-y-5">
          <div className="rounded-[28px] border border-red-100 bg-linear-to-br from-red-50 via-white to-amber-50 px-5 py-4 shadow-sm">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-red-500/80">{isEditing ? 'Коррекция документа' : 'Контроль потерь'}</p>
                <p className="mt-1 text-sm font-semibold text-[#2F2F20]">
                  {isEditing ? 'Исправьте причину, партию или количество и сохраните документ заново.' : 'Укажите причину и выберите точные партии, с которых нужно списать товар.'}
                </p>
              </div>
              <div className="min-w-45 rounded-2xl border border-white/80 bg-white/90 px-4 py-3 text-sm shadow-sm">
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#5A5A40]/45">Режим</p>
                <p className="mt-1 font-semibold text-[#151619]">{isEditing ? 'Редактирование' : 'Создание'}</p>
                <p className="mt-2 text-[10px] font-bold uppercase tracking-[0.2em] text-[#5A5A40]/45">Валюта</p>
                <p className="mt-1 font-semibold text-[#151619]">{currencyCode}</p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="text-xs font-semibold text-[#5A5A40]/60 uppercase tracking-widest mb-1 block">Причина</label>
              <select
                className="w-full px-4 py-3 border border-[#5A5A40]/10 rounded-2xl text-sm bg-white outline-none focus:ring-2 focus:ring-[#5A5A40]/20 shadow-sm"
                value={reason}
                onChange={(e) => setReason(e.target.value as Reason)}
              >
                {REASONS.map((r) => (
                  <option key={r} value={r}>{REASON_LABELS[r]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-[#5A5A40]/60 uppercase tracking-widest mb-1 block">Примечание</label>
              <input
                className="w-full px-4 py-3 border border-[#5A5A40]/10 rounded-2xl text-sm outline-none focus:ring-2 focus:ring-[#5A5A40]/20 shadow-sm"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Необязательная заметка"
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-3">
              <label className="text-xs font-semibold text-[#5A5A40]/60 uppercase tracking-widest">Позиции для списания</label>
              <button onClick={addItem} className="text-xs text-[#5A5A40] font-semibold flex items-center gap-1 hover:underline">
                <Plus size={14} /> Добавить позицию
              </button>
            </div>
            <div className="space-y-3">
              {formItems.map((item, idx) => {
                const selProd = products.find((p) => p.id === item.productId);
                const sortedBatches = getSortedWriteOffBatches(selProd);
                const selectedBatch = sortedBatches.find((batch) => batch.id === item.batchId) || null;
                const selectedBatchVisualState = getBatchVisualState(selectedBatch);
                return (
                  <div key={idx} className="rounded-[26px] border border-[#5A5A40]/6 bg-[#f7f6f1] p-4 shadow-[0_10px_30px_rgba(90,90,64,0.06)]">
                    <div className="grid grid-cols-1 gap-3 xl:grid-cols-12 xl:items-start">
                    <div className="xl:col-span-5">
                      <select
                        className="w-full px-3 py-3 border border-[#5A5A40]/10 rounded-2xl text-sm bg-white outline-none shadow-sm"
                        value={item.productId}
                        onChange={(e) => updateItem(idx, 'productId', e.target.value)}
                      >
                        <option value="">Выберите товар</option>
                        {products.map((p) => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                    </div>
                    <div className="xl:col-span-4">
                      <select
                        className="w-full px-3 py-3 border border-[#5A5A40]/10 rounded-2xl text-sm bg-white outline-none shadow-sm"
                        value={item.batchId}
                        onChange={(e) => updateItem(idx, 'batchId', e.target.value)}
                        disabled={!selProd}
                      >
                        <option value="">Выберите партию</option>
                        {sortedBatches.map((b) => (
                          <option key={b.id} value={b.id}>{`${b.batchNumber} • ${formatBatchExpiry(b.expiryDate)} • ${Number(b.costBasis || 0).toFixed(2)} TJS • ${formatPackQuantity(b.quantity)}`}</option>
                        ))}
                      </select>
                    </div>
                    <div className="xl:col-span-2 space-y-1">
                      <input
                        type="number"
                        min={1}
                        className="w-full px-3 py-3 border border-[#5A5A40]/10 rounded-2xl text-sm bg-white outline-none shadow-sm"
                        value={item.quantity}
                        onChange={(e) => updateItemPackaging(idx, '0', e.target.value)}
                        placeholder="Кол-во"
                      />
                      <p className="text-[10px] text-[#5A5A40]/80 font-semibold leading-tight">Количество в единицах</p>
                    </div>
                    <div className="xl:col-span-1 flex justify-center xl:justify-end">
                      {formItems.length > 1 && (
                        <button onClick={() => removeItem(idx)} className="mt-1 rounded-xl p-2 text-red-400 hover:bg-red-50 hover:text-red-600 transition-colors" title="Удалить позицию">
                          <Trash2 size={16} />
                        </button>
                      )}
                    </div>
                    </div>
                    {sortedBatches.length > 0 && (
                      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                        {sortedBatches.slice(0, 6).map((batch) => {
                          const visualState = getBatchVisualState(batch);
                          const isSelected = item.batchId === batch.id;
                          return (
                            <button
                              key={batch.id}
                              type="button"
                              onClick={() => updateItem(idx, 'batchId', batch.id)}
                              className={`rounded-[22px] border px-4 py-3 text-left transition-all shadow-sm ${isSelected ? 'ring-2 ring-[#5A5A40]/15 scale-[1.01]' : 'hover:-translate-y-0.5'} ${visualState.cardClassName}`}
                            >
                              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                                <p className="max-w-45 wrap-break-word text-sm font-bold leading-snug text-[#403f2b]">{batch.batchNumber}</p>
                                <span className={`inline-flex w-fit rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.18em] ${visualState.chipClassName}`}>
                                  {visualState.label}
                                </span>
                              </div>
                              <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-[11px] text-[#5A5A40]/70">
                                <div>
                                  <p className="text-[#5A5A40]/40">Срок</p>
                                  <p className="font-semibold text-[#5A5A40]">{formatBatchExpiry(batch.expiryDate)}</p>
                                </div>
                                <div>
                                  <p className="text-[#5A5A40]/40">Цена</p>
                                  <p className="font-semibold text-[#5A5A40]">{Number(batch.costBasis || 0).toFixed(2)} {currencyCode}</p>
                                </div>
                                <div>
                                  <p className="text-[#5A5A40]/40">Остаток</p>
                                  <p className="font-semibold text-[#5A5A40]">{formatPackQuantity(batch.quantity)}</p>
                                </div>
                                {isSelected && (
                                  <div className="col-span-2 rounded-xl bg-white/70 px-3 py-2 text-[10px] font-semibold text-[#2F2F20]">
                                    Выбрана для списания
                                  </div>
                                )}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}
                    {selectedBatch && (
                      <div className={`mt-4 rounded-[22px] border px-4 py-3 text-xs text-[#5A5A40] grid grid-cols-2 gap-3 lg:grid-cols-5 ${selectedBatchVisualState.cardClassName}`}>
                        <div>
                          <span className="text-[#5A5A40]/45 uppercase tracking-widest text-[10px] font-bold">Партия</span>
                          <p className="font-semibold mt-1">{selectedBatch.batchNumber}</p>
                        </div>
                        <div>
                          <span className="text-[#5A5A40]/45 uppercase tracking-widest text-[10px] font-bold">Статус</span>
                          <p className="font-semibold mt-1">{selectedBatchVisualState.label}</p>
                        </div>
                        <div>
                          <span className="text-[#5A5A40]/45 uppercase tracking-widest text-[10px] font-bold">Срок</span>
                          <p className="font-semibold mt-1">{formatBatchExpiry(selectedBatch.expiryDate)}</p>
                        </div>
                        <div>
                          <span className="text-[#5A5A40]/45 uppercase tracking-widest text-[10px] font-bold">Цена прихода</span>
                          <p className="font-semibold mt-1">{Number(selectedBatch.costBasis || 0).toFixed(2)} {currencyCode}</p>
                        </div>
                        <div>
                          <span className="text-[#5A5A40]/45 uppercase tracking-widest text-[10px] font-bold">Остаток</span>
                          <p className="font-semibold mt-1">{formatPackQuantity(selectedBatch.quantity)}</p>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-start gap-3">
            <AlertTriangle size={16} className="text-amber-500 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-700">
              {isEditing
                ? 'После сохранения старое списание будет отменено, а новые данные применятся заново.'
                : 'Списание сразу уменьшит остатки выбранных партий. Проверьте количество перед подтверждением.'}
            </p>
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
  const { refreshProducts } = usePharmacy();
  const currencyCode = useCurrencyCode();
  const [writeOffs, setWriteOffs] = useState<WriteOff[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingWriteOff, setEditingWriteOff] = useState<WriteOff | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<WriteOff | null>(null);
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [preset, setPreset] = useState<ReportRangePreset>('month');
  
  const initialDates = getPresetDates('month');
  const [fromDate, setFromDate] = useState(initialDates.from);
  const [toDate, setToDate] = useState(initialDates.to);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const q = new URLSearchParams();
      if (fromDate) q.set('from', fromDate);
      if (toDate) q.set('to', toDate);
      const res = await fetch(`/api/writeoffs?${q.toString()}`, { headers: authHeaders() });
      if (res.ok) setWriteOffs(await res.json());
    } finally {
      setLoading(false);
    }
  }, [fromDate, toDate]);

  useEffect(() => {
    if (preset === 'custom') return;
    const { from, to } = getPresetDates(preset);
    setFromDate(from);
    setToDate(to);
  }, [preset]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!feedback) {
      return;
    }

    const timeoutId = window.setTimeout(() => setFeedback(null), 4000);
    return () => window.clearTimeout(timeoutId);
  }, [feedback]);

  const openCreateModal = () => {
    setEditingWriteOff(null);
    setIsModalOpen(true);
  };

  const openEditModal = (writeOff: WriteOff) => {
    setEditingWriteOff(writeOff);
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingWriteOff(null);
  };

  const requestDelete = (writeOff: WriteOff) => {
    setDeleteTarget(writeOff);
  };

  const closeDeleteModal = () => {
    if (deletingId) {
      return;
    }

    setDeleteTarget(null);
  };

  const handleDelete = async () => {
    if (!deleteTarget) {
      return;
    }

    setDeletingId(deleteTarget.id);
    try {
      const res = await fetch(`/api/writeoffs/${deleteTarget.id}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || 'Failed to delete write-off');
      }

      if (expandedId === deleteTarget.id) {
        setExpandedId(null);
      }
      setDeleteTarget(null);
      setFeedback({ tone: 'success', message: `Списание ${deleteTarget.writeOffNo} удалено. Остатки восстановлены.` });
      await runRefreshTasks(refreshProducts, load);
    } catch (error: any) {
      setFeedback({ tone: 'error', message: error.message || 'Не удалось удалить списание' });
    } finally {
      setDeletingId(null);
    }
  };

  const handleCreated = async () => {
    await load();
    setFeedback({
      tone: 'success',
      message: editingWriteOff
        ? `Списание ${editingWriteOff.writeOffNo} обновлено.`
        : 'Новое списание сохранено.',
    });
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="rounded-[30px] border border-white/70 bg-white/80 p-4 shadow-[0_18px_45px_rgba(90,90,64,0.08)] backdrop-blur-md md:p-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center rounded-full bg-[#f9ebe7] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-red-600/80">
              Контроль потерь
            </span>
            <span className="inline-flex items-center rounded-full bg-white px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-[#5A5A40]/45 border border-[#5A5A40]/10">
              Просрочка, брак и расхождения
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-3">
          <button onClick={load} className="p-3 bg-white rounded-2xl border border-[#5A5A40]/10 text-[#5A5A40]/60 hover:text-[#5A5A40] transition-all shadow-sm">
            <RefreshCw size={18} />
          </button>
          <button
            onClick={openCreateModal}
            className="bg-red-600 text-white px-6 py-3 rounded-2xl font-medium shadow-lg hover:bg-red-700 transition-all flex items-center gap-2"
          >
            <Plus size={20} /> Новое списание
          </button>
        </div>
        </div>
      </div>

      {feedback && (
        <div className={`rounded-3xl border px-4 py-3 shadow-sm ${feedback.tone === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-700'}`}>
          <div className="flex items-start gap-3">
            {feedback.tone === 'success' ? <CheckCircle2 size={18} className="mt-0.5 shrink-0" /> : <XCircle size={18} className="mt-0.5 shrink-0" />}
            <p className="text-sm font-medium">{feedback.message}</p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-3">
          <DateRangeFilter
            preset={preset}
            setPreset={setPreset}
            fromDate={fromDate}
            setFromDate={(d) => { setFromDate(d); setPreset('custom'); }}
            toDate={toDate}
            setToDate={(d) => { setToDate(d); setPreset('custom'); }}
            onRefresh={load}
          />
        </div>

        <div className="lg:col-span-9">
          {loading ? (
             <div className="flex flex-col items-center justify-center py-20 bg-white rounded-3xl border border-[#5A5A40]/5 shadow-sm">
                <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-[#5A5A40] mb-4" />
                <p className="text-sm text-[#5A5A40]/40 font-medium">Загружаем списания...</p>
             </div>
          ) : writeOffs.length === 0 ? (
            <div className="text-center py-20 bg-white rounded-3xl border border-[#5A5A40]/5 shadow-sm text-[#5A5A40]/40">
              <Package size={48} className="mx-auto mb-4 opacity-30" />
              <p className="text-lg font-medium">Списаний пока нет</p>
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
                      {wo.warehouse?.name} · {wo.createdBy?.name} · {wo.items.length} поз.
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-sm font-bold text-[#151619]">{Number(wo.totalAmount || 0).toFixed(2)} {currencyCode}</span>
                  <span className="text-xs text-[#5A5A40]/40">{new Date(wo.createdAt).toLocaleDateString()}</span>
                  <span className={`px-3 py-1 rounded-full text-xs font-bold ${REASON_STYLES[wo.reason] ?? 'bg-gray-100 text-gray-600'}`}>
                    {REASON_LABELS[wo.reason] || 'Другое'}
                  </span>
                </div>
              </div>

              {expandedId === wo.id && (
                <div className="px-6 pb-4 border-t border-[#5A5A40]/5">
                  <div className="flex flex-col gap-3 py-3 md:flex-row md:items-start md:justify-between">
                    <div>
                      {wo.note && <p className="text-sm text-[#5A5A40]/60">Примечание: {wo.note}</p>}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          openEditModal(wo);
                        }}
                        className="inline-flex items-center gap-2 rounded-xl border border-[#5A5A40]/10 bg-white px-3 py-2 text-sm font-semibold text-[#5A5A40] hover:bg-[#f5f5f0] transition-all"
                      >
                        <Pencil size={15} /> Редактировать
                      </button>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          requestDelete(wo);
                        }}
                        disabled={deletingId === wo.id}
                        className="inline-flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-600 hover:bg-red-100 transition-all disabled:opacity-50"
                      >
                        <Trash2 size={15} /> {deletingId === wo.id ? 'Удаление...' : 'Удалить'}
                      </button>
                    </div>
                  </div>
                  <table className="w-full mt-2 text-sm">
                    <thead>
                      <tr className="text-xs text-[#5A5A40]/40 uppercase tracking-widest">
                        <th className="text-left py-2">Товар</th>
                        <th className="text-left py-2">Кол-во в партии</th>
                        <th className="text-right py-2">Списано</th>
                      </tr>
                    </thead>
                    <tbody>
                      {wo.items.map((item) => (
                        <tr key={item.id} className="border-t border-[#5A5A40]/5">
                          <td className="py-2 font-medium">{item.product?.name ?? 'Неизвестно'}</td>
                          <td className="py-2 text-[#5A5A40]/60">{'quantity' in (item.batch ?? {}) && typeof (item.batch as any).quantity === 'number' ? formatPackQuantity((item.batch as any).quantity) : '—'}</td>
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
        </div>
      </div>

      <CreateWriteOffModal open={isModalOpen} onClose={closeModal} onCreated={handleCreated} initialWriteOff={editingWriteOff} />

      <AppModal
        open={Boolean(deleteTarget)}
        title="Удаление списания"
        subtitle={deleteTarget ? `Списание ${deleteTarget.writeOffNo} будет удалено, а остатки восстановлены обратно.` : undefined}
        tone="danger"
        size="sm"
        onClose={closeDeleteModal}
        footer={
          <div className="flex gap-3">
            <button
              onClick={closeDeleteModal}
              disabled={Boolean(deletingId)}
              className="flex-1 py-3 rounded-2xl border border-[#5A5A40]/20 text-[#5A5A40] text-sm font-semibold hover:bg-[#f5f5f0] transition-all disabled:opacity-50"
            >
              Отмена
            </button>
            <button
              onClick={() => void handleDelete()}
              disabled={Boolean(deletingId)}
              className="flex-1 py-3 rounded-2xl bg-red-600 text-white text-sm font-semibold hover:bg-red-700 transition-all disabled:opacity-50"
            >
              {deletingId ? 'Удаление...' : 'Удалить'}
            </button>
          </div>
        }
      >
        <div className="space-y-3 text-sm text-[#5A5A40]">
          <p>После удаления все товары из этого списания вернутся на склад в те же партии.</p>
          <div className="rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-red-700">
            <p className="font-semibold">Проверьте запись перед удалением</p>
            <p className="mt-1 text-xs">Если нужно только исправить количество или партию, лучше выбрать редактирование.</p>
          </div>
        </div>
      </AppModal>
    </div>
  );
};
