import React, { useState } from 'react';
import { Download, FileSpreadsheet, RefreshCw, Calendar } from 'lucide-react';
import { buildApiHeaders } from '../../infrastructure/api';

type ExportTarget = {
  id: string;
  label: string;
  description: string;
  endpoint: string;
  roles: string[];       // which roles can see this button
  hasDateRange?: boolean;
};

const EXPORTS: ExportTarget[] = [
  {
    id: 'products',
    label: 'Каталог товаров',
    description: 'Все товары с остатками, ценами и датами годности',
    endpoint: '/api/export/products',
    roles: ['ADMIN', 'OWNER', 'PHARMACIST', 'WAREHOUSE_STAFF'],
  },
  {
    id: 'inventory',
    label: 'Остатки по партиям',
    description: 'Партии с датами производства, годности и статусом срока',
    endpoint: '/api/export/inventory',
    roles: ['ADMIN', 'OWNER', 'PHARMACIST', 'WAREHOUSE_STAFF'],
  },
  {
    id: 'sales',
    label: 'Продажи',
    description: 'Чеки (сводка) и позиции (детали) — два листа в одном файле',
    endpoint: '/api/export/sales',
    roles: ['ADMIN', 'OWNER'],
    hasDateRange: true,
  },
  {
    id: 'returns',
    label: 'Возвраты',
    description: 'Все возвраты с позициями и статусами одобрения',
    endpoint: '/api/export/returns',
    roles: ['ADMIN', 'OWNER'],
    hasDateRange: true,
  },
  {
    id: 'writeoffs',
    label: 'Списания',
    description: 'Списанные позиции с причинами и данными партий',
    endpoint: '/api/export/writeoffs',
    roles: ['ADMIN', 'OWNER'],
  },
];

type ExportCardProps = {
  target: ExportTarget;
};

const ExportCard: React.FC<ExportCardProps> = ({ target }) => {
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo]     = useState('');

  const handleDownload = async () => {
    setDownloading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (target.hasDateRange && from) params.set('from', from);
      if (target.hasDateRange && to)   params.set('to', to);
      const url = `${target.endpoint}${params.toString() ? `?${params}` : ''}`;

      const res = await fetch(url, { headers: await buildApiHeaders(false) });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Ошибка экспорта');
      }

      // Trigger browser download
      const blob = await res.blob();
      const disposition = res.headers.get('Content-Disposition') ?? '';
      const nameMatch = disposition.match(/filename="([^"]+)"/);
      const filename = nameMatch ? decodeURIComponent(nameMatch[1]) : `${target.id}.xlsx`;

      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(objectUrl);
    } catch (e: any) {
      setError(e?.message || 'Ошибка');
      setTimeout(() => setError(null), 4000);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-[#5A5A40]/10 p-5 flex flex-col gap-4 hover:shadow-md transition-shadow">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center text-emerald-600 shrink-0">
          <FileSpreadsheet size={20} />
        </div>
        <div className="min-w-0">
          <h4 className="text-sm font-bold text-[#151619]">{target.label}</h4>
          <p className="text-xs text-[#5A5A40]/55 mt-1 leading-relaxed">{target.description}</p>
        </div>
      </div>

      {target.hasDateRange && (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-[#5A5A40]/50 mb-1">
              <Calendar size={10} className="inline mr-1" />С даты
            </label>
            <input
              type="date"
              value={from}
              onChange={e => setFrom(e.target.value)}
              className="w-full px-3 py-2 border border-[#5A5A40]/15 rounded-xl text-xs bg-[#f5f5f0]/50 focus:outline-none focus:ring-2 focus:ring-[#5A5A40]/20"
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-[#5A5A40]/50 mb-1">
              <Calendar size={10} className="inline mr-1" />По дату
            </label>
            <input
              type="date"
              value={to}
              onChange={e => setTo(e.target.value)}
              className="w-full px-3 py-2 border border-[#5A5A40]/15 rounded-xl text-xs bg-[#f5f5f0]/50 focus:outline-none focus:ring-2 focus:ring-[#5A5A40]/20"
            />
          </div>
        </div>
      )}

      {error && (
        <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{error}</p>
      )}

      <button
        onClick={() => void handleDownload()}
        disabled={downloading}
        className="flex items-center justify-center gap-2 w-full py-2.5 bg-[#5A5A40] text-white rounded-xl text-sm font-bold hover:bg-[#4a4a30] disabled:opacity-50 transition-colors"
      >
        {downloading
          ? <><RefreshCw size={15} className="animate-spin" /> Подготовка...</>
          : <><Download size={15} /> Скачать .xlsx</>
        }
      </button>
    </div>
  );
};

type ExportPanelProps = {
  currentUserRole: string;
};

export const ExportPanel: React.FC<ExportPanelProps> = ({ currentUserRole }) => {
  const visibleExports = EXPORTS.filter((e) => e.roles.includes(currentUserRole));

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3 text-[#5A5A40]">
        <div className="w-10 h-10 rounded-2xl bg-[#f5f5f0] flex items-center justify-center">
          <Download size={20} />
        </div>
        <div>
          <h3 className="text-lg font-bold">Экспорт в Excel</h3>
          <p className="text-xs text-[#5A5A40]/55">Скачивание данных в формате .xlsx</p>
        </div>
      </div>

      {visibleExports.length === 0 ? (
        <div className="bg-[#f5f5f0]/50 rounded-2xl p-6 text-center text-sm text-[#5A5A40]/50">
          Экспорт недоступен для вашей роли
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {visibleExports.map((target) => (
            <ExportCard key={target.id} target={target} />
          ))}
        </div>
      )}
    </div>
  );
};
