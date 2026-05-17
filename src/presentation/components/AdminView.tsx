import React from 'react';
import { useTranslation } from 'react-i18next';
import { usePharmacy } from '../context';
import { UsersAdminPanel } from './UsersAdminPanel';
import { AuditLogPanel } from './AuditLogPanel';
import { ExportPanel } from './ExportPanel';
import { 
  ShieldCheck, 
  FileSpreadsheet, 
  History, 
  Users, 
  Database,
  ShieldAlert,
  RefreshCw,
  Wrench,
  CheckCircle2
} from 'lucide-react';
import { buildApiHeaders } from '../../infrastructure/api';

export const AdminView: React.FC = () => {
  const { t } = useTranslation();
  const { user } = usePharmacy();
  const [activeTab, setActiveTab] = React.useState<'users' | 'audit' | 'export' | 'system'>('users');
  
  const [integrityLoading, setIntegrityLoading] = React.useState(false);
  const [integrityReport, setIntegrityReport] = React.useState<any | null>(null);
  const [integrityError, setIntegrityError] = React.useState<string | null>(null);
  const [backupLoading, setBackupLoading] = React.useState(false);

  const isAdmin = user?.role === 'ADMIN' || user?.role === 'OWNER';

  const checkIntegrity = async () => {
    setIntegrityLoading(true);
    setIntegrityError(null);
    try {
      const response = await fetch('/api/dev/stock-integrity', { headers: await buildApiHeaders(false) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Failed to check integrity');
      setIntegrityReport(body);
    } catch (e: any) {
      setIntegrityError(e.message);
    } finally {
      setIntegrityLoading(false);
    }
  };

  const fixIntegrity = async () => {
    setIntegrityLoading(true);
    setIntegrityError(null);
    try {
      const response = await fetch('/api/dev/stock-integrity/fix', { method: 'POST', headers: await buildApiHeaders() });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Failed to fix integrity');
      setIntegrityReport(body);
    } catch (e: any) {
      setIntegrityError(e.message);
    } finally {
      setIntegrityLoading(false);
    }
  };

  const exportBackup = async () => {
    setBackupLoading(true);
    try {
      const response = await fetch('/api/system/backup/export', { headers: await buildApiHeaders(false) });
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `pharmapro-backup-${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      alert(e.message);
    } finally {
      setBackupLoading(false);
    }
  };

  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-[#5A5A40]/50">
        <ShieldAlert size={48} className="mb-4" />
        <p className="font-bold uppercase tracking-widest text-sm">Доступ ограничен</p>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in duration-500 max-w-6xl mx-auto pb-20">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold text-[#5A5A40] tracking-tight">Администрирование</h2>
          <p className="text-[#5A5A40]/60 mt-1 italic">Управление пользователями, аудит и экспорт данных</p>
        </div>
      </div>

      <div className="flex gap-2 p-1.5 bg-white border border-[#5A5A40]/10 rounded-2xl w-fit">
        <button 
          onClick={() => setActiveTab('users')}
          className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-bold transition-all ${activeTab === 'users' ? 'bg-[#5A5A40] text-white shadow-lg' : 'text-[#5A5A40]/50 hover:bg-[#f5f5f0]'}`}
        >
          <Users size={18} /> Пользователи
        </button>
        <button 
          onClick={() => setActiveTab('audit')}
          className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-bold transition-all ${activeTab === 'audit' ? 'bg-[#5A5A40] text-white shadow-lg' : 'text-[#5A5A40]/50 hover:bg-[#f5f5f0]'}`}
        >
          <History size={18} /> Журнал аудита
        </button>
        <button 
          onClick={() => setActiveTab('export')}
          className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-bold transition-all ${activeTab === 'export' ? 'bg-[#5A5A40] text-white shadow-lg' : 'text-[#5A5A40]/50 hover:bg-[#f5f5f0]'}`}
        >
          <FileSpreadsheet size={18} /> Экспорт в Excel
        </button>
        <button 
          onClick={() => setActiveTab('system')}
          className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-bold transition-all ${activeTab === 'system' ? 'bg-[#5A5A40] text-white shadow-lg' : 'text-[#5A5A40]/50 hover:bg-[#f5f5f0]'}`}
        >
          <Database size={18} /> Система
        </button>
      </div>

      <div className="bg-white p-8 rounded-3xl shadow-sm border border-[#5A5A40]/5 min-h-[500px]">
        {activeTab === 'users' && <UsersAdminPanel currentUserRole={user.role} />}
        {activeTab === 'audit' && <AuditLogPanel />}
        {activeTab === 'export' && <ExportPanel currentUserRole={user.role} />}
        {activeTab === 'system' && (
          <div className="space-y-8">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
               <div className="p-6 rounded-2xl border border-[#5A5A40]/10 bg-[#f5f5f0]/30">
                  <h3 className="font-bold text-[#5A5A40] mb-2 flex items-center gap-2">
                    <ShieldCheck size={18} /> Резервное копирование
                  </h3>
                  <p className="text-sm text-[#5A5A40]/60 mb-6">Создайте полную копию базы данных в формате JSON для безопасного хранения или переноса.</p>
                  <button 
                    onClick={exportBackup} 
                    disabled={backupLoading}
                    className="w-full px-6 py-3 bg-[#5A5A40] text-white rounded-xl font-bold hover:bg-[#454530] transition-colors disabled:opacity-50"
                  >
                    {backupLoading ? 'Экспорт...' : 'Скачать Backup'}
                  </button>
               </div>

               <div className="p-6 rounded-2xl border border-[#5A5A40]/10 bg-[#f5f5f0]/30">
                  <h3 className="font-bold text-[#5A5A40] mb-2 flex items-center gap-2">
                    <ShieldAlert size={18} /> Целостность данных
                  </h3>
                  <p className="text-sm text-[#5A5A40]/60 mb-6">Проверка и автоматическое исправление расхождений в остатках товаров и партий.</p>
                  <div className="flex gap-3">
                    <button 
                      onClick={checkIntegrity} 
                      disabled={integrityLoading}
                      className="flex-1 px-4 py-2.5 bg-white border border-[#5A5A40]/20 text-[#5A5A40] rounded-xl font-bold hover:bg-white/80 transition-colors disabled:opacity-50"
                    >
                      Проверить
                    </button>
                    <button 
                      onClick={fixIntegrity} 
                      disabled={integrityLoading}
                      className="flex-1 px-4 py-2.5 bg-[#5A5A40]/5 text-[#5A5A40] rounded-xl font-bold hover:bg-[#5A5A40]/10 transition-colors disabled:opacity-50"
                    >
                      Исправить
                    </button>
                  </div>
               </div>
            </div>

            {integrityReport && (
              <div className={`p-6 rounded-2xl border ${integrityReport.ok ? 'bg-emerald-50 border-emerald-100 text-emerald-700' : 'bg-amber-50 border-amber-100 text-amber-700'}`}>
                <div className="flex items-center gap-3 mb-2 font-bold">
                  <CheckCircle2 size={20} />
                  {integrityReport.ok ? 'Ошибок не обнаружено' : `Найдено проблем: ${integrityReport.issuesCount}`}
                </div>
                <p className="text-xs opacity-80">
                  Проверено товаров: {integrityReport.checkedProducts} | Записей склада: {integrityReport.checkedWarehouseStockRows}
                </p>
              </div>
            )}

            {integrityError && (
              <div className="p-6 rounded-2xl border bg-red-50 border-red-100 text-red-700 font-bold">
                {integrityError}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
