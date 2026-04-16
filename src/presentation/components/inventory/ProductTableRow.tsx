import React from 'react';
import { useTranslation } from 'react-i18next';
import { Product } from '../../../core/domain';
import { AlertTriangle, Layers, Barcode, BadgeDollarSign, Trash2, Plus, Info } from 'lucide-react';

interface ProductTableRowProps {
  index: number;
  product: Product;
  stockLabel: string;
  submitting: boolean;
  onOpenBatchHistory: (product: Product) => void;
  onEditPrices: (product: Product) => void;
  onRestock: (product: Product) => void;
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
  onRestock,
  onAddBarcode,
  onDelete,
}) => {
  const { t } = useTranslation();
  const isLowStock = product.totalStock < (product.minStock || 10);
  const batches = Array.isArray(product.batches) ? product.batches : [];
  const orderedBatches = [...batches].sort((l, r) => new Date(l.expiryDate).getTime() - new Date(r.expiryDate).getTime());
  const primaryBatch = orderedBatches[0];
  const riskyBatchCount = batches.filter((b) => b.status !== 'STABLE').length;

  return (
    <tr className="hover:bg-[#fcfbf7] transition-all group font-normal">
      <td className="px-8 py-4 text-[10px] text-[#5A5A40]/20 font-normal">{index < 10 ? `0${index}` : index}</td>
      <td className="px-6 py-4 min-w-[280px]">
        <div>
          <h4 className="text-[14px] font-normal text-[#151619] tracking-tight leading-tight mb-1">{product.name}</h4>
          <div className="flex items-center gap-3">
            <span className="text-[9px] text-[#5A5A40]/30 uppercase tracking-widest">{product.sku}</span>
            {product.countryOfOrigin && (
              <span className="text-[9px] text-sky-600/40 italic font-normal">{product.countryOfOrigin}</span>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5 mt-2">
             {riskyBatchCount > 0 && (
               <span className="inline-flex px-1.5 py-0.5 rounded-md bg-rose-50 text-rose-600 text-[8px] uppercase tracking-tighter border border-rose-100/50">Риски: {riskyBatchCount}</span>
             )}
             {!product.barcode && (
               <span className="inline-flex px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-600 text-[8px] uppercase tracking-tighter border border-amber-100/50">Нет штрихкода</span>
             )}
             {primaryBatch && (
               <span className="inline-flex px-1.5 py-0.5 rounded-md bg-[#f5f5f0] text-[#5A5A40]/40 text-[8px] uppercase tracking-tighter">Срок: {new Date(primaryBatch.expiryDate).toLocaleDateString('ru-RU')}</span>
             )}
          </div>
        </div>
      </td>
      <td className="px-6 py-4">
        <div className="max-w-[120px]">
          <div className="flex items-center justify-between mb-1.5">
            <span className={`text-[10px] uppercase tracking-widest ${isLowStock ? 'text-rose-600' : 'text-emerald-600'}`}>
              {stockLabel} <span className="opacity-40 lowercase">ед.</span>
            </span>
            {isLowStock && <AlertTriangle size={10} className="text-rose-500 animate-pulse" />}
          </div>
          <div className="h-1 bg-[#f5f5f0] rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-700 ${isLowStock ? 'bg-rose-500' : 'bg-emerald-500'}`}
              style={{ width: `${Math.min(100, (product.totalStock / (product.minStock || 10) * 50))}%` }}
            />
          </div>
        </div>
      </td>
      <td className="px-6 py-4">
        <p className="text-[14px] text-[#151619] font-normal tabular-nums">{product.sellingPrice.toFixed(2)}</p>
        <p className="text-[9px] text-[#5A5A40]/30 uppercase tracking-tighter mt-0.5">Себест: {product.costPrice.toFixed(0)}</p>
      </td>
      <td className="px-6 py-4">
        <div className="flex flex-col gap-1">
          <span className="text-[10px] text-[#5A5A40]/50 lowercase">{product.category || 'Без категории'}</span>
          {product.prescription ? (
            <span className="w-fit px-1.5 py-0.5 bg-rose-50 text-rose-600 text-[8px] uppercase tracking-widest rounded-md">Рецепт</span>
          ) : (
             <span className="w-fit px-1.5 py-0.5 bg-emerald-50 text-emerald-600 text-[8px] uppercase tracking-widest rounded-md">Без рецепта</span>
          )}
        </div>
      </td>
      <td className="px-8 py-4 text-right">
        <div className="flex items-center justify-end gap-1 px-1">
          <button
            onClick={() => onRestock(product)}
            disabled={submitting}
            className="p-2 text-[#5A5A40]/20 hover:text-emerald-600 hover:bg-emerald-50 rounded-xl transition-all"
            title="Приход"
          >
            <Plus size={16} />
          </button>
          <button
            onClick={() => onOpenBatchHistory(product)}
            disabled={submitting}
            className="p-2 text-[#5A5A40]/20 hover:text-sky-600 hover:bg-sky-50 rounded-xl transition-all"
            title="Партии"
          >
            <Layers size={16} />
          </button>
          <button
            onClick={() => onEditPrices(product)}
            disabled={submitting}
            className="p-2 text-[#5A5A40]/20 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl transition-all"
            title="Цены"
          >
            <BadgeDollarSign size={16} />
          </button>
          {!product.barcode && (
            <button
              onClick={() => onAddBarcode(product)}
              disabled={submitting}
              className="p-2 text-[#5A5A40]/20 hover:text-amber-600 hover:bg-amber-50 rounded-xl transition-all"
              title="Штрихкод"
            >
              <Barcode size={16} />
            </button>
          )}
          <button
            onClick={() => onDelete(product.id, product.name)}
            disabled={submitting}
            className="p-2 text-[#5A5A40]/10 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-all"
            title="Удалить"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </td>
    </tr>
  );
});

ProductTableRow.displayName = 'ProductTableRow';
