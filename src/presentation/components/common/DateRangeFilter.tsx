import React from 'react';

export type ReportRangePreset = 'today' | 'yesterday' | 'week' | 'month' | 'lastMonth' | 'year' | 'all' | 'custom';

export const presetLabels: Record<ReportRangePreset, string> = {
  today: 'Сегодня',
  yesterday: 'Вчера',
  week: 'Неделя',
  month: 'Текущий месяц',
  lastMonth: 'Прошлый месяц',
  year: 'Весь год',
  all: 'Весь период',
  custom: 'Свой период',
};

interface DateRangeFilterProps {
  preset: ReportRangePreset;
  setPreset: (preset: ReportRangePreset) => void;
  fromDate: string;
  setFromDate: (date: string) => void;
  toDate: string;
  setToDate: (date: string) => void;
  onRefresh?: () => void;
}

export const DateRangeFilter: React.FC<DateRangeFilterProps> = ({
  preset,
  setPreset,
  fromDate,
  setFromDate,
  toDate,
  setToDate,
  onRefresh
}) => {
  return (
    <div className="bg-white rounded-[26px] border border-[#5A5A40]/10 px-4 py-4 shadow-sm min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-3">
         <p className="text-[10px] uppercase tracking-widest text-[#5A5A40]/45 font-bold">Период</p>
         {onRefresh && (
           <button onClick={onRefresh} className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors text-[#5A5A40]/40">
              {/* Refresh icon placeholder or use directly in parent */}
           </button>
         )}
      </div>
      <div className="flex flex-col gap-4">
        <div className="flex gap-2 flex-wrap">
          {(['today', 'month', 'lastMonth', 'all', 'custom'] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPreset(p)}
              className={`px-4 py-2 rounded-xl text-xs font-semibold border transition-all ${
                preset === p
                  ? 'bg-[#5A5A40] text-white border-[#5A5A40]'
                  : 'bg-[#f5f5f0] text-[#5A5A40]/60 border-[#5A5A40]/10 hover:bg-[#ecebe5]'
              }`}
            >
              {presetLabels[p]}
            </button>
          ))}
        </div>

        {preset === 'custom' && (
          <div className="flex flex-wrap gap-2 animate-in slide-in-from-top-1 duration-200">
            <div className="flex-1 min-w-[140px]">
              <label className="text-[10px] font-bold text-[#5A5A40]/40 uppercase mb-1 block">С даты</label>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-[#5A5A40]/10 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#5A5A40]/15"
              />
            </div>
            <div className="flex-1 min-w-[140px]">
              <label className="text-[10px] font-bold text-[#5A5A40]/40 uppercase mb-1 block">По дату</label>
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-[#5A5A40]/10 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#5A5A40]/15"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
