import React from 'react';
import { 
  LogOut, 
  Menu, 
  X, 
  Pill,
  ChevronRight
} from 'lucide-react';
import { User } from '../../core/domain';

export type SidebarView = 'dashboard' | 'notifications' | 'pos' | 'inventory' | 'batches' | 'purchases' | 'invoices' | 'debts' | 'suppliers' | 'reports' | 'settings' | 'returns' | 'writeoffs' | 'shifts' | 'admin' | 'operations';

interface MenuItem {
  id: SidebarView;
  label: string;
  icon: React.ElementType;
}

interface MenuGroup {
  group: string;
  items: MenuItem[];
}

interface SidebarProps {
  user: User;
  currentView: SidebarView;
  onViewChange: (view: SidebarView) => void;
  onLogout: () => void;
  isSidebarOpen: boolean;
  setIsSidebarOpen: (isOpen: boolean) => void;
  menuItems: MenuGroup[];
  notificationsCount: number;
}

export const Sidebar: React.FC<SidebarProps> = ({
  user,
  currentView,
  onViewChange,
  onLogout,
  isSidebarOpen,
  setIsSidebarOpen,
  menuItems,
  notificationsCount
}) => {
  return (
    <aside
      className="flex flex-col relative z-30 transition-all duration-300 ease-in-out pharma-sidebar bg-[#152220] border-r border-[#1F3330] shadow-2xl"
      style={{ width: isSidebarOpen ? 260 : 80 }}
    >
      {/* Logo Section */}
      <div className="px-6 py-8 flex items-center gap-4">
        <div className="w-11 h-11 bg-gradient-to-br from-[#0F766E] to-[#14B8A6] rounded-2xl flex items-center justify-center text-white shadow-lg shadow-[#0F766E]/25 rotate-2 hover:rotate-0 transition-all cursor-pointer shrink-0">
          <Pill size={24} />
        </div>
        {isSidebarOpen && (
          <div className="flex flex-col pharma-fade-in">
            <h1 className="font-extrabold text-xl tracking-tight leading-none text-white font-['Outfit']">PharmaPro</h1>
            <span className="text-[10px] text-[#14B8A6] font-bold uppercase tracking-[0.2em] mt-1">Pharmacy Management</span>
          </div>
        )}
      </div>

      {/* Navigation Section */}
      <div className="flex-1 px-3 py-2 overflow-y-auto custom-scrollbar flex flex-col">
        {menuItems.map((group) => (
          <div key={group.group} className="mb-5 last:mb-0">
            {isSidebarOpen && (
              <h3 className="px-4 mb-2.5 text-[10px] font-bold text-slate-400/60 uppercase tracking-[0.22em] pharma-fade-in">
                {group.group}
              </h3>
            )}
            <div className="flex flex-col gap-1">
              {group.items.map((item) => {
                const isActive = currentView === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => onViewChange(item.id)}
                    className={`group relative flex items-center gap-3.5 px-4 py-3 rounded-xl transition-all duration-200 ${
                      isActive 
                        ? 'bg-gradient-to-r from-[#0F766E] to-[#0D9488] text-white shadow-md shadow-[#0F766E]/30 font-semibold' 
                        : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/60'
                    }`}
                    title={!isSidebarOpen ? item.label : undefined}
                  >
                    <item.icon size={20} className={`${isActive ? 'text-white' : 'text-slate-400 group-hover:text-slate-200 group-hover:scale-110 transition-transform'}`} />
                    {isSidebarOpen && (
                      <span className="text-xs tracking-tight flex-1 flex items-center justify-between font-medium">
                        <span>{item.label}</span>
                        {item.id === 'notifications' && notificationsCount > 0 && (
                          <span className="inline-flex min-w-5 h-5 px-1.5 items-center justify-center rounded-full bg-rose-500 text-white text-[10px] font-bold shadow-sm">
                            {notificationsCount}
                          </span>
                        )}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            {isSidebarOpen && <div className="mx-4 mt-4 border-b border-slate-800/60" />}
          </div>
        ))}
      </div>

      {/* User & Footer Section */}
      <div className="mt-auto p-4 border-t border-slate-800/80 bg-slate-900/50">
        {isSidebarOpen && (
          <div className="flex items-center gap-3 p-3 mb-3 rounded-xl bg-slate-800/40 border border-slate-700/40 pharma-fade-in">
            <div className="w-9 h-9 bg-gradient-to-br from-[#0F766E] to-[#0D9488] rounded-lg flex items-center justify-center text-white font-bold text-sm shadow-sm">
              {user.name.charAt(0)}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold truncate leading-none mb-1 text-slate-100">{user.name}</p>
              <p className="text-[10px] text-teal-400 font-bold uppercase tracking-wider truncate">{user.role}</p>
            </div>
          </div>
        )}

        <button
          onClick={onLogout}
          className="w-full flex items-center justify-center sm:justify-start gap-3 px-3.5 py-3 text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 rounded-xl transition-all group text-xs font-semibold"
        >
          <LogOut size={18} className="shrink-0 group-hover:-translate-x-0.5 transition-transform" />
          {isSidebarOpen && <span className="uppercase tracking-[0.15em]">Выход</span>}
        </button>
      </div>

      {/* Toggle Button */}
      <button
        onClick={() => setIsSidebarOpen(!isSidebarOpen)}
        className="absolute -right-3.5 top-20 w-7 h-7 bg-[#0F766E] rounded-full flex items-center justify-center text-white shadow-xl hover:scale-110 transition-transform z-40 border-2 border-[#f8fafc] app-no-drag"
      >
        {isSidebarOpen ? <X size={12} /> : <Menu size={12} />}
      </button>
    </aside>
  );
};
