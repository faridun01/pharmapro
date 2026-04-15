import React from 'react';
import { 
  LogOut, 
  Menu, 
  X, 
  Pill,
  ChevronRight
} from 'lucide-react';
import { User } from '../../core/domain';

export type SidebarView = 'dashboard' | 'notifications' | 'pos' | 'inventory' | 'batches' | 'purchases' | 'invoices' | 'debts' | 'suppliers' | 'reports' | 'settings' | 'returns' | 'writeoffs' | 'shifts' | 'admin';

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
      className="flex flex-col relative z-30 transition-all duration-300 ease-in-out pharma-sidebar bg-[#151619] shadow-2xl"
      style={{ width: isSidebarOpen ? 260 : 80 }}
    >
      {/* Logo Section */}
      <div className="px-6 py-10 flex items-center gap-4">
        <div className="w-12 h-12 bg-[#5A5A40] rounded-2xl flex items-center justify-center text-white shadow-xl rotate-3 hover:rotate-0 transition-transform cursor-pointer shrink-0">
          <Pill size={28} />
        </div>
        {isSidebarOpen && (
          <div className="flex flex-col pharma-fade-in">
            <h1 className="font-black text-xl tracking-tight leading-none text-white">PharmaPro</h1>
            <span className="text-[10px] text-[#5A5A40] font-black uppercase tracking-[0.2em] mt-1.5">ITFORCE System</span>
          </div>
        )}
      </div>

      {/* Navigation Section */}
      <div className="flex-1 px-3 py-4 overflow-y-auto custom-scrollbar flex flex-col">
        {menuItems.map((group) => (
          <div key={group.group} className="mb-6 last:mb-0">
            {isSidebarOpen && (
              <h3 className="px-4 mb-3 text-[10px] font-black text-white/20 uppercase tracking-[0.25em] pharma-fade-in">
                {group.group}
              </h3>
            )}
            <div className="flex flex-col gap-1.5">
              {group.items.map((item) => {
                const isActive = currentView === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => onViewChange(item.id)}
                    className={`group relative flex items-center gap-4 px-4 py-3.5 rounded-2xl transition-all duration-200 ${
                      isActive 
                        ? 'bg-[#5A5A40] text-white shadow-lg shadow-[#5A5A40]/20' 
                        : 'text-white/40 hover:text-white hover:bg-white/5'
                    }`}
                    title={!isSidebarOpen ? item.label : undefined}
                  >
                    <item.icon size={22} className={`${isActive ? 'text-white' : 'group-hover:scale-110 transition-transform'}`} />
                    {isSidebarOpen && (
                      <span className="font-bold text-sm tracking-tight flex-1 flex items-center gap-2">
                        {item.label}
                        {item.id === 'notifications' && notificationsCount > 0 && (
                          <span className="inline-flex min-w-5 h-5 px-1.5 items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-black shadow-lg">
                            {notificationsCount}
                          </span>
                        )}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            {isSidebarOpen && <div className="mx-4 mt-6 border-b border-white/5" />}
          </div>
        ))}
      </div>

      {/* User & Footer Section */}
      <div className="mt-auto p-4 border-t border-white/5 bg-black/10">
        {isSidebarOpen && (
          <div className="flex items-center gap-3 p-3 mb-4 rounded-2xl bg-white/5 border border-white/5 pharma-fade-in">
            <div className="w-10 h-10 bg-[#5A5A40] rounded-xl flex items-center justify-center text-white font-black shadow-lg shadow-[#5A5A40]/10">
              {user.name.charAt(0)}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold truncate leading-none mb-1 text-white">{user.name}</p>
              <p className="text-[10px] text-white/30 font-black uppercase tracking-widest truncate">{user.role}</p>
            </div>
          </div>
        )}

        <button
          onClick={onLogout}
          className="w-full flex items-center justify-center sm:justify-start gap-4 px-4 py-4 text-red-400 hover:text-red-300 hover:bg-red-500/5 rounded-2xl transition-all group"
        >
          <LogOut size={22} className="shrink-0 group-hover:-translate-x-1 transition-transform" />
          {isSidebarOpen && <span className="font-bold text-xs uppercase tracking-[0.2em]">Выход</span>}
        </button>
      </div>

      {/* Toggle Button */}
      <button
        onClick={() => setIsSidebarOpen(!isSidebarOpen)}
        className="absolute -right-4 top-24 w-8 h-8 bg-[#5A5A40] rounded-full flex items-center justify-center text-white shadow-2xl hover:scale-110 transition-transform z-40 border-4 border-[#f5f5f0] app-no-drag"
      >
        {isSidebarOpen ? <X size={14} /> : <Menu size={14} />}
      </button>
    </aside>
  );
};
