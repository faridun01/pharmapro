import React from 'react';
import { RefreshCw, Calendar, Clock, Infinity, CalendarSearch, Milestone } from 'lucide-react';

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

const PRESET_ICONS: Record<string, React.ReactNode> = {
  today: <Clock size={14} />,
  month: <Calendar size={14} />,
  lastMonth: <Milestone size={14} />,
  all: <Infinity size={14} />,
  custom: <CalendarSearch size={14} />,
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
    <div className="bg-white rounded-[26px] border border-[#5A5A40]/10 p-4 shadow-sm space-y-4">
      <div className="flex items-center justify-between px-1">
         <p className="text-[10px] uppercase tracking-widest text-[#5A5A40]/45 font-normal">Период отчета</p>
         {onRefresh && (
           <button onClick={onRefresh} className="p-1.5 hover:bg-[#5A5A40]/5 rounded-xl transition-all text-[#5A5A40]/40 hover:text-[#5A5A40]">
              <RefreshCw size={14} />
           </button>
         )}
      </div>

      <div className="flex flex-col gap-1.5">
        {(['today', 'month', 'lastMonth', 'all', 'custom'] as const).map((p) => (
          <button
            key={p}
            onClick={() => setPreset(p)}
            className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs transition-all border ${
              preset === p
                ? 'bg-[#5A5A40] text-white border-transparent shadow-md'
                : 'bg-[#f5f5f0]/50 text-[#5A5A40]/60 border-transparent hover:bg-white hover:border-[#5A5A40]/10'
            }`}
          >
            <span className={preset === p ? 'text-white' : 'text-[#5A5A40]/40'}>
              {PRESET_ICONS[p] || <Calendar size={14} />}
            </span>
            <span className="font-normal">{presetLabels[p]}</span>
          </button>
        ))}
      </div>

      {preset === 'custom' && (
        <div className="pt-2 space-y-3 animate-in slide-in-from-top-2 duration-300">
          <div className="w-full h-px bg-[#5A5A40]/5" />
          <div className="grid grid-cols-1 gap-3">
            <div className="space-y-1.5">
              <label className="text-[9px] font-normal text-[#5A5A40]/40 uppercase tracking-widest px-1">С даты</label>
              <input
                type="date"
                value={fromDate ? fromDate.split('T')[0] : ''}
                onChange={(e) => {
                   const d = e.target.value;
                   if (d) {
                     const date = new Date(d);
                     setFromDate(new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0).toISOString());
                   } else {
                     setFromDate('');
                   }
                }}
                className="w-full px-4 py-2.5 bg-[#f5f5f0]/50 border border-transparent rounded-xl text-xs font-normal text-[#5A5A40] outline-none focus:bg-white focus:border-[#5A5A40]/20 transition-all cursor-pointer"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[9px] font-normal text-[#5A5A40]/40 uppercase tracking-widest px-1">По дату</label>
              <input
                type="date"
                value={toDate ? toDate.split('T')[0] : ''}
                onChange={(e) => {
                   const d = e.target.value;
                   if (d) {
                     const date = new Date(d);
                     setToDate(new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999).toISOString());
                   } else {
                     setToDate('');
                   }
                }}
                className="w-full px-4 py-2.5 bg-[#f5f5f0]/50 border border-transparent rounded-xl text-xs font-normal text-[#5A5A40] outline-none focus:bg-white focus:border-[#5A5A40]/20 transition-all cursor-pointer"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
