import React, { useState } from 'react';
import { Download, FileSpreadsheet, RefreshCw } from 'lucide-react';
import { buildApiHeaders } from '../../infrastructure/api';

type ExportTarget = {
  id: string;
  label: string;
  description: string;
  endpoint: string;
  roles: string[];
  hasDateRange?: boolean;
};

const EXPORTS: ExportTarget[] = [
  {
    id: 'products',
    label: 'Каталог товаров',
    description: 'Полный перечень товаров с остатками, ценами и характеристиками',
    endpoint: '/api/export/products',
    roles: ['ADMIN', 'OWNER', 'PHARMACIST', 'WAREHOUSE_STAFF'],
  },
  {
    id: 'inventory',
    label: 'Остатки по партиям',
    description: 'Детальные остатки с учетом сроков годности и номеров партий',
    endpoint: '/api/export/inventory',
    roles: ['ADMIN', 'OWNER', 'PHARMACIST', 'WAREHOUSE_STAFF'],
  },
  {
    id: 'sales',
    label: 'Журнал продаж',
    description: 'Сводные данные по чекам и детализация проданных позиций',
    endpoint: '/api/export/sales',
    roles: ['ADMIN', 'OWNER'],
    hasDateRange: true,
  },
  {
    id: 'returns',
    label: 'Журнал возвратов',
    description: 'Все возвраты от покупателей и поставщиков с причинами',
    endpoint: '/api/export/returns',
    roles: ['ADMIN', 'OWNER'],
    hasDateRange: true,
  },
  {
    id: 'writeoffs',
    label: 'Журнал списаний',
    description: 'История списаний товара с указанием ответственных и причин',
    endpoint: '/api/export/writeoffs',
    roles: ['ADMIN', 'OWNER'],
  },
];

type ExportRowProps = {
  target: ExportTarget;
};

const ExportRow: React.FC<ExportRowProps> = ({ target }) => {
  const today = new Date().toISOString().split('T')[0];
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [from, setFrom] = useState(today);
  const [to, setTo]     = useState(today);

  const handleDownload = async () => {
    setDownloading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (target.hasDateRange && from) params.set('from', from);
      if (target.hasDateRange && to)   params.set('to', to);
      const url = `${target.endpoint}${params.toString() ? `?${params}` : ''}`;
      
      const res = await fetch(url, { headers: await buildApiHeaders(false) });
      if (!res.ok) throw new Error('Ошибка генерации');
      
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = `${target.label.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(objectUrl);
    } catch (e: any) {
      setError('Ошибка');
      setTimeout(() => setError(null), 3000);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="group bg-white/40 hover:bg-white rounded-[2rem] border border-[#5A5A40]/5 p-4 flex flex-col lg:flex-row lg:items-center gap-6 transition-all hover:shadow-xl hover:shadow-[#5A5A40]/5">
      <div className="flex items-center gap-4 flex-1">
        <div className="w-12 h-12 rounded-2xl bg-[#f5f5f0] flex items-center justify-center text-[#5A5A40]/30 group-hover:bg-[#5A5A40] group-hover:text-white transition-all">
          <FileSpreadsheet size={22} />
        </div>
        <div className="min-w-0">
          <h4 className="text-sm font-normal text-[#151619] tracking-tight">{target.label}</h4>
          <p className="text-[11px] text-[#5A5A40]/50 mt-0.5 line-clamp-1">{target.description}</p>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4">
        {target.hasDateRange && (
          <div className="flex items-center bg-[#f5f5f0]/50 rounded-2xl border border-[#5A5A40]/5 p-1">
            <div className="flex items-center gap-2 px-3">
              <span className="text-[9px] uppercase font-normal text-[#5A5A40]/40">C</span>
              <input
                type="date"
                value={from}
                onChange={e => setFrom(e.target.value)}
                className="bg-transparent border-none text-xs text-[#5A5A40] outline-none w-28 cursor-pointer"
              />
            </div>
            <div className="w-px h-4 bg-[#5A5A40]/10" />
            <div className="flex items-center gap-2 px-3">
              <span className="text-[9px] uppercase font-normal text-[#5A5A40]/40">ПО</span>
              <input
                type="date"
                value={to}
                onChange={e => setTo(e.target.value)}
                className="bg-transparent border-none text-xs text-[#5A5A40] outline-none w-28 cursor-pointer"
              />
            </div>
          </div>
        )}

        <button
          onClick={() => void handleDownload()}
          disabled={downloading}
          className="h-11 px-6 bg-[#151619]/5 hover:bg-[#5A5A40] text-[#5A5A40] hover:text-white rounded-2xl border border-[#5A5A40]/10 hover:border-transparent text-xs font-normal transition-all flex items-center justify-center gap-2 min-w-[150px]"
        >
          {downloading ? (
            <RefreshCw size={14} className="animate-spin" />
          ) : (
            <>
              <Download size={14} />
              <span>Скачать .xlsx</span>
            </>
          )}
        </button>
      </div>
      {error && <span className="absolute -top-2 right-4 bg-red-500 text-white text-[9px] px-2 py-0.5 rounded-full">{error}</span>}
    </div>
  );
};

type ExportPanelProps = {
  currentUserRole: string;
};

export const ExportPanel: React.FC<ExportPanelProps> = ({ currentUserRole }) => {
  const visibleExports = EXPORTS.filter((e) => e.roles.includes(currentUserRole));
  const catalog = visibleExports.filter(e => ['products', 'inventory'].includes(e.id));
  const journals = visibleExports.filter(e => !['products', 'inventory'].includes(e.id));

  return (
    <div className="max-w-5xl space-y-12 pb-20">
      <div className="space-y-1">
        <h3 className="text-2xl font-normal text-[#151619] tracking-tight">Центр экспорта</h3>
        <p className="text-sm text-[#5A5A40]/50 font-normal">Выберите нужный формат и период для выгрузки аналитических данных</p>
      </div>

      <div className="space-y-12">
        {catalog.length > 0 && (
          <div className="space-y-5">
            <h5 className="text-[10px] uppercase tracking-[0.3em] text-[#5A5A40]/30 font-normal px-2">Реестры и Склад</h5>
            <div className="grid gap-3">
              {catalog.map(t => <ExportRow key={t.id} target={t} />)}
            </div>
          </div>
        )}

        {journals.length > 0 && (
          <div className="space-y-5">
            <h5 className="text-[10px] uppercase tracking-[0.3em] text-[#5A5A40]/30 font-normal px-2">Операционные журналы</h5>
            <div className="grid gap-3">
              {journals.map(t => <ExportRow key={t.id} target={t} />)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
