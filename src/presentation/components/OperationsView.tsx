import React, { useState } from 'react';
import { 
  History, 
  RotateCcw, 
  Trash2, 
  Wallet,
  ArrowLeftRight
} from 'lucide-react';
import { DebtsView } from './DebtsView';
import { ReturnView } from './ReturnView';
import { WriteOffView } from './WriteOffView';

type OperationTab = 'debts' | 'returns' | 'writeoffs';

export const OperationsView: React.FC = () => {
  const [activeTab, setActiveTab] = useState<OperationTab>('debts');

  const tabs = [
    { id: 'debts' as const, label: 'Долги клиентов', icon: Wallet, color: 'text-amber-600', bg: 'bg-amber-50' },
    { id: 'returns' as const, label: 'Возвраты', icon: RotateCcw, color: 'text-emerald-600', bg: 'bg-emerald-50' },
    { id: 'writeoffs' as const, label: 'Списания', icon: Trash2, color: 'text-rose-600', bg: 'bg-rose-50' },
  ];

  return (
    <div className="space-y-8 animate-in fade-in duration-700">
      {/* Tab Switcher */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 px-1">
        <div className="flex items-center gap-5">
           <div className="w-14 h-14 rounded-[1.5rem] bg-white border border-[#5A5A40]/5 flex items-center justify-center text-[#5A5A40]/60 shadow-sm">
             <ArrowLeftRight size={26} />
           </div>
           <div>
             <h2 className="text-3xl font-normal text-[#151619] tracking-tight">Операции и учет</h2>
             <p className="text-[#5A5A40]/50 mt-1 text-[10px] uppercase tracking-[0.2em] italic">Управление возвратами, списаниями и задолженностями</p>
           </div>
        </div>

        <div className="flex bg-white/50 backdrop-blur-md p-1.5 rounded-[2rem] border border-white shadow-sm">
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-3 px-6 py-3 rounded-[1.5rem] transition-all duration-300 ${
                  isActive 
                    ? 'bg-[#5A5A40] text-white shadow-lg shadow-[#5A5A40]/20 scale-105' 
                    : 'text-[#5A5A40]/40 hover:text-[#5A5A40] hover:bg-white/50'
                }`}
              >
                <Icon size={18} className={isActive ? 'text-white' : tab.color} />
                <span className="text-xs font-bold uppercase tracking-widest">{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* View Container */}
      <div className="relative">
        <div key={activeTab} className="animate-in fade-in slide-in-from-bottom-4 duration-500">
          {activeTab === 'debts' && <DebtsView hideHeader />}
          {activeTab === 'returns' && <ReturnView hideHeader />}
          {activeTab === 'writeoffs' && <WriteOffView hideHeader />}
        </div>
      </div>
    </div>
  );
};

export default OperationsView;
