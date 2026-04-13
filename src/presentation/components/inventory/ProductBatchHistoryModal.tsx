import React from 'react';
import { Product } from '../../../core/domain';
import { getBatchHistoryStatusLabel } from './utils';
import { X } from 'lucide-react';

interface ProductBatchHistoryModalProps {
  product: Product | null;
  onClose: () => void;
  onRestock: (product: Product) => void;
  currencyCode: string;
}

export const ProductBatchHistoryModal: React.FC<ProductBatchHistoryModalProps> = ({
  product,
  onClose,
  onRestock,
  currencyCode
}) => {
  if (!product) return null;

  const batches = [...(product.batches || [])].sort(
    (left, right) => new Date(left.expiryDate).getTime() - new Date(right.expiryDate).getTime()
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
        <div className="p-6 border-b border-[#5A5A40]/10 flex items-center justify-between gap-4">
          <div>
            <h3 className="text-xl font-bold text-[#5A5A40]">История партий</h3>
            <p className="text-sm text-[#5A5A40]/60 mt-1">{product.name} • {product.sku}</p>
            {product.countryOfOrigin && (
              <p className="text-xs text-[#5A5A40]/50 mt-1">Страна производства: {product.countryOfOrigin}</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => onRestock(product)}
              className="px-4 py-2 rounded-xl bg-[#5A5A40] text-white text-sm font-semibold hover:bg-[#4A4A30] transition-colors"
            >
              Приход
            </button>
            <button onClick={onClose} className="p-2 text-[#5A5A40]/50 hover:text-[#5A5A40]">
              <X size={20} />
            </button>
          </div>
        </div>
        <div className="p-6 overflow-y-auto space-y-4">
          {batches.length === 0 && (
            <div className="rounded-2xl border border-[#5A5A40]/10 bg-[#fcfbf7] px-5 py-10 text-center text-sm text-[#5A5A40]/50">
              По этому товару партий пока нет.
            </div>
          )}
          <div className="rounded-2xl bg-[#f5f5f0] px-4 py-3 text-sm text-[#5A5A40]">
            Здесь оставлены только данные, по которым легко найти нужную партию: номер, остаток, срок и цена прихода.
          </div>
          {batches.map((batch) => (
            <div key={batch.id} className="rounded-3xl border border-[#5A5A40]/10 bg-[#fcfbf7] p-5 shadow-sm">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p className="text-sm font-bold text-[#5A5A40]">Партия {batch.batchNumber}</p>
                  <p className="text-[11px] text-[#5A5A40]/55 mt-1">Остаток {Math.max(0, Number(batch.quantity || 0))} ед.</p>
                </div>
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest border bg-[#f5f5f0] text-[#5A5A40] border-[#5A5A40]/10">
                  {getBatchHistoryStatusLabel(batch.status, batch.expiryDate)}
                </div>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-4">
                <div className="rounded-2xl border border-[#5A5A40]/10 bg-white px-4 py-3">
                  <p className="text-[10px] uppercase tracking-widest text-[#5A5A40]/45 font-bold">Срок годности</p>
                  <p className="font-semibold text-[#5A5A40] mt-1">{new Date(batch.expiryDate).toLocaleDateString('ru-RU')}</p>
                </div>
                <div className="rounded-2xl border border-[#5A5A40]/10 bg-white px-4 py-3">
                  <p className="text-[10px] uppercase tracking-widest text-[#5A5A40]/45 font-bold">Остаток</p>
                  <p className="font-semibold text-[#5A5A40] mt-1">{Math.max(0, Number(batch.quantity || 0))} ед.</p>
                </div>
                <div className="rounded-2xl border border-[#5A5A40]/10 bg-white px-4 py-3">
                  <p className="text-[10px] uppercase tracking-widest text-[#5A5A40]/45 font-bold">Цена прихода</p>
                  <p className="font-semibold text-[#5A5A40] mt-1">{Number(batch.costBasis || 0).toFixed(2)} {currencyCode}</p>
                </div>
                <div className="rounded-2xl border border-[#5A5A40]/10 bg-white px-4 py-3">
                  <p className="text-[10px] uppercase tracking-widest text-[#5A5A40]/45 font-bold">Цена продажи</p>
                  <p className="font-semibold text-[#5A5A40] mt-1">{Number(product.sellingPrice ?? 0).toFixed(2)} {currencyCode}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
