import React from 'react';
import { useTranslation } from 'react-i18next';
import { Product } from '../../../core/domain';
import { AlertTriangle, Layers, Barcode, BadgeDollarSign, Trash2 } from 'lucide-react';

interface ProductTableRowProps {
  index: number;
  product: Product;
  stockLabel: string;
  submitting: boolean;
  onOpenBatchHistory: (product: Product) => void;
  onEditPrices: (product: Product) => void;
  onAddBarcode: (product: Product) => void;
  onDelete: (id: string, name: string) => void;
}

export const ProductTableRow: React.FC<ProductTableRowProps> = React.memo(({
  index,
  product,
  stockLabel,
  submitting,
  onOpenBatchHistory,
  onEditPrices,
  onAddBarcode,
  onDelete,
}) => {
  const { t } = useTranslation();
  const isLowStock = product.totalStock < (product.minStock || 10);
  const batches = Array.isArray(product.batches) ? product.batches : [];
  const orderedBatches = [...batches].sort((left, right) => new Date(left.expiryDate).getTime() - new Date(right.expiryDate).getTime());
  const primaryBatch = orderedBatches[0];
  const riskyBatchCount = batches.filter((batch) => batch.status !== 'STABLE').length;

  return (
    <tr className="hover:bg-[#f5f5f0]/30 transition-colors group">
      <td className="px-4 py-3.5 text-xs font-bold text-[#5A5A40]/70">{index}</td>
      <td className="px-6 py-3.5">
        <div>
          <p className="text-sm font-bold leading-tight text-[#5A5A40]">{product.name}</p>
          <p className="mt-0.5 text-[10px] text-[#5A5A40]/40 uppercase tracking-widest">{product.sku}</p>
          {(product.manufacturer || product.countryOfOrigin) && (
            <p className="mt-1 text-[10px] text-[#5A5A40]/45">
              {[product.manufacturer, product.countryOfOrigin].filter(Boolean).join(' • ')}
            </p>
          )}
          <p className="mt-1 text-[10px] text-[#5A5A40]/45">
            {batches.length > 0
              ? `Партий: ${batches.length}${primaryBatch ? ` • Ближайший срок: ${new Date(primaryBatch.expiryDate).toLocaleDateString('ru-RU')}` : ''}`
              : 'Партий пока нет'}
          </p>
          {riskyBatchCount > 0 && (
            <span className="inline-flex mt-1.5 items-center rounded-full bg-rose-50 px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-rose-700 border border-rose-100">
              Требует внимания: {riskyBatchCount}
            </span>
          )}
          {!product.barcode && (
            <span className="inline-flex mt-1.5 items-center rounded-full bg-amber-50 px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-amber-700 border border-amber-100">
              Без штрихкода
            </span>
          )}
        </div>
      </td>
      <td className="px-6 py-3.5">
        <div className="flex items-center gap-2.5">
          <div className="flex-1 min-w-25">
            <div className="h-1.5 bg-[#f5f5f0] rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${isLowStock ? 'bg-amber-500' : 'bg-emerald-500'}`}
                style={{ width: `${Math.min(100, (product.totalStock / (product.minStock || 10) * 50))}%` }}
              />
            </div>
            <p className={`text-[9px] font-bold mt-1 uppercase tracking-wider ${isLowStock ? 'text-amber-600' : 'text-emerald-600'}`}>
              {stockLabel}
            </p>
          </div>
          {isLowStock && <AlertTriangle size={14} className="text-amber-500 animate-pulse" />}
        </div>
      </td>
      <td className="px-6 py-3.5">
        <p className="text-sm font-bold text-[#5A5A40]">{product.sellingPrice.toFixed(2)} TJS</p>
        <p className="text-[9px] text-[#5A5A40]/40 mt-0.5">{t('Cost')}: {product.costPrice.toFixed(2)} TJS</p>
      </td>
      <td className="px-6 py-3.5">
        {product.prescription ? (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-50 text-red-600 text-[9px] font-bold uppercase tracking-widest border border-red-100">
            {t('Required')}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-600 text-[9px] font-bold uppercase tracking-widest border border-emerald-100">
            {t('OTC')}
          </span>
        )}
      </td>
      <td className="px-6 py-3.5 text-right">
        <div className="ml-auto grid w-fit grid-cols-2 gap-2">
          <button
            onClick={() => onOpenBatchHistory(product)}
            disabled={submitting}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-[#eef2e6] text-[#5A5A40] transition-all hover:bg-[#e2e8d6] disabled:opacity-50"
            title="История партий"
          >
            <Layers size={14} />
          </button>
          {!product.barcode && (
            <button
              onClick={() => onAddBarcode(product)}
              disabled={submitting}
              className="order-4 inline-flex h-9 w-9 items-center justify-center rounded-lg bg-amber-50 text-amber-700 transition-all hover:bg-amber-100 disabled:opacity-50"
              title="Добавить штрихкод"
            >
              <Barcode size={14} />
            </button>
          )}
          <button
            onClick={() => onEditPrices(product)}
            disabled={submitting}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-[#f5f5f0] text-[#5A5A40] transition-all hover:bg-[#ebeade] disabled:opacity-50"
            title="Изменить цены"
          >
            <BadgeDollarSign size={14} />
          </button>
          <button
            onClick={() => onDelete(product.id, product.name)}
            disabled={submitting}
            className="order-3 inline-flex h-9 w-9 items-center justify-center rounded-lg text-[#5A5A40]/30 transition-all hover:bg-red-50 hover:text-red-500 disabled:opacity-50"
            title={t('Delete Product')}
          >
            <Trash2 size={16} />
          </button>
        </div>
      </td>
    </tr>
  );
});
