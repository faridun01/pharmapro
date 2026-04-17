import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usePharmacy } from '../context';
import { buildApiHeaders } from '../../infrastructure/api';
import { defaultCompanyReportProfile, type CompanyReportProfile } from '../../lib/reportPreferences';
import { UsersAdminPanel } from './UsersAdminPanel';
import { AuditLogPanel } from './AuditLogPanel';
import { ExportPanel } from './ExportPanel';
import { AnimatePresence, motion } from 'motion/react';
import i18n from '../../lib/i18n';
import { AppModal } from './AppModal';
import {
  defaultUserSettingsPreferences,
  type UserSettingsPreferences,
} from '../../lib/systemPreferences';
import {
  LogOut,
  ShieldAlert,
  Wrench,
  CheckCircle2,
  RefreshCw,
  Save,
  ShieldCheck,
  User,
  Bell,
  Database,
  Moon,
  Sun,
  Building2,
  ImageUp,
  Trash2,
  Settings,
  CircleCheck,
  HardDrive,
  Users as UsersIcon,
  Globe,
  Lock,
  Info,
} from 'lucide-react';

type UserProfileForm = {
  name: string;
  email: string;
  username: string;
};

type PasswordForm = {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
};

type ActiveTab = 'profile' | 'notifications' | 'company' | 'system' | 'users';

export const SettingsView: React.FC = () => {
  const { t } = useTranslation();
  const { user, logout } = usePharmacy();

  const [activeTab, setActiveTab] = useState<ActiveTab>('profile');

  const [integrityLoading, setIntegrityLoading] = useState(false);
  const [integrityReport, setIntegrityReport] = useState<any | null>(null);
  const [integrityError, setIntegrityError] = useState<string | null>(null);
  const [autoChecked, setAutoChecked] = useState(false);

  const [companyProfile, setCompanyProfile] = useState<CompanyReportProfile>(defaultCompanyReportProfile);

  const [profileForm, setProfileForm] = useState<UserProfileForm>({
    name: '',
    email: '',
    username: '',
  });
  const [passwordForm, setPasswordForm] = useState<PasswordForm>({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });

  const [preferences, setPreferences] = useState<UserSettingsPreferences>(defaultUserSettingsPreferences);

  const [loadingProfile, setLoadingProfile] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [savingPreferences, setSavingPreferences] = useState(false);
  const [savingCompany, setSavingCompany] = useState(false);
  const [backupLoading, setBackupLoading] = useState(false);
  const [systemStatus, setSystemStatus] = useState<any>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [isDbModalOpen, setIsDbModalOpen] = useState(false);
  const [activeUsersCount, setActiveUsersCount] = useState<number | null>(null);
  const [dbConfig, setDbConfig] = useState({
    user: 'postgres',
    password: '',
    host: 'localhost',
    port: '5432',
    dbname: 'pharmapro'
  });

  const [message, setMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const isAdmin = user?.role === 'ADMIN' || user?.role === 'OWNER';

  const setNotice = (text: string) => {
    setMessage(text);
    window.setTimeout(() => setMessage(null), 2500);
  };

  const setError = (text: string) => {
    setErrorMessage(text);
    window.setTimeout(() => setErrorMessage(null), 3500);
  };

  const checkStatus = async () => {
    if (!(window as any).pharmaproDesktop?.checkSystemStatus) return;
    setStatusLoading(true);
    try {
       const status = await (window as any).pharmaproDesktop.checkSystemStatus();
       setSystemStatus(status);
    } catch (e) {
       console.error(e);
    } finally {
       setStatusLoading(false);
    }
  };

  const saveDbConfig = async () => {
    const url = `postgresql://${dbConfig.user}:${dbConfig.password}@${dbConfig.host}:${dbConfig.port}/${dbConfig.dbname}`;
    try {
      if (!(window as any).pharmaproDesktop?.saveDatabaseConfig) return;
      await (window as any).pharmaproDesktop.saveDatabaseConfig(url);
      setNotice('Настройки сохранены. Приложение будет перезапущено...');
      setTimeout(() => {
        window.location.reload();
      }, 2000);
    } catch (e: any) {
      setError(e.message || 'Ошибка сохранения');
    }
  };

  useEffect(() => {
    if (activeTab === 'system') {
       checkStatus();
    }
  }, [activeTab]);

  const checkIntegrity = async (silent = false) => {
    if (!silent) {
      setIntegrityLoading(true);
      setIntegrityError(null);
    }
    try {
      const response = await fetch('/api/system/stock-integrity', {
        method: 'GET',
        headers: await buildApiHeaders(false),
      });

      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body.error || 'Failed to check stock integrity');
      }

      setIntegrityReport(body);
      setAutoChecked(true);
    } catch (e: any) {
      setIntegrityError(e?.message || 'Failed to check stock integrity');
      setAutoChecked(true);
    } finally {
      if (!silent) {
        setIntegrityLoading(false);
      }
    }
  };

  const fixIntegrity = async () => {
    setIntegrityLoading(true);
    setIntegrityError(null);
    try {
      const response = await fetch('/api/system/stock-integrity/fix', {
        method: 'POST',
        headers: await buildApiHeaders(),
        body: JSON.stringify({}),
      });

      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body.error || 'Failed to repair stock integrity');
      }

      setIntegrityReport(body);
      setNotice('Integrity repaired');
    } catch (e: any) {
      setIntegrityError(e?.message || 'Failed to repair stock integrity');
    } finally {
      setIntegrityLoading(false);
    }
  };

  useEffect(() => {
    if (!isAdmin || autoChecked) return;
    void checkIntegrity(true);
  }, [isAdmin, autoChecked]);

  useEffect(() => {
    if (!user?.id) return;

    const loadSettings = async () => {
      setLoadingProfile(true);
      try {
        const [profileRes, preferencesRes, companyRes] = await Promise.all([
          fetch('/api/system/me/profile', { headers: await buildApiHeaders(false) }),
          fetch('/api/system/me/preferences', { headers: await buildApiHeaders(false) }),
          isAdmin ? fetch('/api/reports/profile', { headers: await buildApiHeaders(false) }) : Promise.resolve(null),
        ]);

        const profileBody = await profileRes.json().catch(() => ({}));
        if (!profileRes.ok) {
          throw new Error(profileBody.error || 'Failed to load user profile');
        }

        setProfileForm({
          name: String(profileBody.name || ''),
          email: String(profileBody.email || ''),
          username: String(profileBody.username || ''),
        });

        const prefBody = preferencesRes ? await preferencesRes.json().catch(() => null) : null;
        if (preferencesRes?.ok && prefBody) {
          const normalized = {
            ...prefBody,
            localization: {
              ...(prefBody.localization || {}),
              timezone: prefBody.localization?.timezone === 'Asia/Tashkent' ? 'Asia/Dushanbe' : prefBody.localization?.timezone,
            },
            currency: {
              ...(prefBody.currency || {}),
              code: prefBody.currency?.code === 'UZS' ? 'TJS' : prefBody.currency?.code,
              symbol: prefBody.currency?.symbol === "so'm" ? 'сомонӣ' : prefBody.currency?.symbol,
            },
          } as UserSettingsPreferences;
          setPreferences(normalized);
          
          // Apply theme immediately
          const theme = normalized.appearance?.theme === 'dark' ? 'dark' : 'light';
          document.documentElement.dataset.theme = theme;
          if (theme === 'dark') document.documentElement.classList.add('dark');
          else document.documentElement.classList.remove('dark');
        }

        if (companyRes) {
          const companyBody = await companyRes.json().catch(() => ({}));
          if (companyRes.ok) {
            setCompanyProfile((prev) => ({ ...prev, ...(companyBody || {}) }));
          }
        }
        if (isAdmin) {
          try {
            const usersRes = await fetch('/api/system/users', { headers: await buildApiHeaders(false) });
            if (usersRes.ok) {
              const users = await usersRes.json();
              setActiveUsersCount(Array.isArray(users) ? users.filter((u: any) => u.isActive).length : null);
            }
          } catch (e) {
            console.error('Failed to fetch user count for header', e);
          }
        }
      } catch (e: any) {
        setError(e?.message || 'Failed to load settings');
      } finally {
        setLoadingProfile(false);
      }
    };

    void loadSettings();
  }, [user?.id, isAdmin]);

  const saveProfile = async () => {
    setSavingProfile(true);
    try {
      const response = await fetch('/api/system/me/profile', {
        method: 'PUT',
        headers: await buildApiHeaders(),
        body: JSON.stringify(profileForm),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body.error || 'Failed to save profile');
      }

      setNotice('Profile saved');
    } catch (e: any) {
      setError(e?.message || 'Failed to save profile');
    } finally {
      setSavingProfile(false);
    }
  };

  const savePassword = async () => {
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    setSavingPassword(true);
    try {
      const response = await fetch('/api/system/me/password', {
        method: 'PUT',
        headers: await buildApiHeaders(),
        body: JSON.stringify(passwordForm),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body.error || 'Failed to update password');
      }

      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
      setNotice('Password updated');
    } catch (e: any) {
      setError(e?.message || 'Failed to update password');
    } finally {
      setSavingPassword(false);
    }
  };

  const savePreferences = async (nextPreferences?: UserSettingsPreferences) => {
    const payload = nextPreferences || preferences;
    setSavingPreferences(true);
    try {
      const response = await fetch('/api/system/me/preferences', {
        method: 'PUT',
        headers: await buildApiHeaders(),
        body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body.error || 'Failed to save preferences');
      }

      setPreferences(body as UserSettingsPreferences);
      
      const theme = body.appearance?.theme === 'dark' ? 'dark' : 'light';
      document.documentElement.dataset.theme = theme;
      if (theme === 'dark') document.documentElement.classList.add('dark');
      else document.documentElement.classList.remove('dark');

      setNotice('Preferences saved');
    } catch (e: any) {
      setError(e?.message || 'Failed to save preferences');
    } finally {
      setSavingPreferences(false);
    }
  };

  const saveCompanyProfile = async () => {
    setSavingCompany(true);
    try {
      const response = await fetch('/api/reports/profile', {
        method: 'PUT',
        headers: await buildApiHeaders(),
        body: JSON.stringify(companyProfile),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body.error || 'Failed to save');
      }

      setCompanyProfile(body);
      setNotice('Company details saved');
    } catch (e: any) {
      setError(e?.message || 'Failed to save');
    } finally {
      setSavingCompany(false);
    }
  };

  const exportBackup = async () => {
    setBackupLoading(true);
    try {
      const response = await fetch('/api/system/backup/export', {
        headers: await buildApiHeaders(false),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to export backup');
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `pharmapro-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setNotice('Backup exported');
    } catch (e: any) {
      setError(e?.message || 'Failed to export backup');
    } finally {
      setBackupLoading(false);
    }
  };

  return (
    <>
      <div className="max-w-[1600px] mx-auto space-y-8 animate-in fade-in duration-700 pb-20">

      {/* Header Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Система', val: 'Online', sub: 'Защищенное соединение', color: 'text-emerald-600', icon: CircleCheck },
          { label: 'База данных', val: 'Prisma DB', sub: 'Интеграция активна', color: 'text-[#5A5A40]', icon: Database },
          { label: 'Пользователи', val: activeUsersCount !== null ? `${activeUsersCount} активных` : 'Загрузка...', sub: 'Доступ согласно ролям', color: 'text-[#5A5A40]', icon: UsersIcon },
          { label: 'Хранилище', val: '84% свободно', sub: 'Место на диске', color: 'text-amber-600', icon: HardDrive },
        ].map((card, idx) => (
          <div key={idx} className="bg-white/40 border border-[#5A5A40]/5 rounded-[2rem] p-6 shadow-sm hover:shadow-xl transition-all group">
            <div className="flex justify-between items-start mb-4">
              <p className="text-[10px] font-normal text-[#5A5A40]/40 uppercase tracking-[0.2em]">{card.label}</p>
              <card.icon size={16} className={`${card.color} opacity-40`} />
            </div>
            <p className={`text-2xl font-normal ${card.color} tracking-tight`}>{card.val}</p>
            <p className="text-[10px] font-normal text-[#5A5A40]/30 mt-2 italic">{card.sub}</p>
          </div>
        ))}
      </div>

      {/* Title & Tab Bar */}
      <div className="bg-white/80 backdrop-blur-md rounded-[2.5rem] border border-white/70 p-4 shadow-sm flex flex-col xl:flex-row xl:items-center justify-between gap-6">
        <div className="flex items-center gap-4 px-2">
          <div className="w-12 h-12 rounded-[1.2rem] bg-[#5A5A40] text-white flex items-center justify-center shadow-lg shadow-[#5A5A40]/20">
            <Settings size={24} />
          </div>
          <div>
            <h4 className="text-lg font-normal text-[#151619] leading-tight">Центр настроек</h4>
            <p className="text-[10px] text-[#5A5A40]/50 uppercase tracking-widest mt-0.5 font-normal">Персонализация и системные инструменты</p>
          </div>
        </div>

        <nav className="flex flex-wrap items-center gap-1.5 p-1.5 bg-[#f5f5f0]/50 rounded-[1.8rem] border border-[#5A5A40]/5">
          {[
            { id: 'profile', label: 'Профиль', icon: User },
            { id: 'notifications', label: 'Уведомления', icon: Bell },
            { id: 'company', label: 'Компания', icon: Building2 },
            { id: 'system', label: 'Система', icon: Database },
            { id: 'users', label: 'Команда', icon: UsersIcon },
          ].map((tab) => {
            const isTabActive = activeTab === tab.id;
            const isTabDisabled = (tab.id === 'system' || tab.id === 'users' || tab.id === 'company') && !isAdmin;
            
            if (isTabDisabled) return null;

            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as ActiveTab)}
                className={`flex items-center gap-2 px-5 py-2.5 rounded-[1.2rem] text-[11px] uppercase tracking-widest transition-all ${
                  isTabActive 
                    ? 'bg-[#5A5A40] text-white shadow-lg shadow-[#5A5A40]/20' 
                    : 'text-[#5A5A40]/40 hover:text-[#5A5A40] hover:bg-white'
                }`}
              >
                <tab.icon size={14} />
                <span className="font-normal">{tab.label}</span>
              </button>
            );
          })}
          
          <div className="h-6 w-px bg-[#5A5A40]/10 mx-2 hidden sm:block" />
          
          <button
            onClick={logout}
            className="flex items-center gap-2 px-5 py-2.5 rounded-[1.2rem] text-[11px] uppercase tracking-widest bg-rose-50 text-rose-500 hover:bg-rose-500 hover:text-white transition-all font-normal"
          >
            <LogOut size={14} />
            <span>Выйти</span>
          </button>
        </nav>
      </div>

      {/* Content Area */}
      <div className="bg-white/40 border border-[#5A5A40]/5 rounded-[3rem] p-10 shadow-sm relative overflow-hidden backdrop-blur-sm">
        
        {loadingProfile ? (
          <div className="flex flex-col items-center justify-center py-20">
            <RefreshCw size={40} className="animate-spin text-[#5A5A40]/20" />
            <p className="text-[10px] uppercase tracking-[0.3em] text-[#5A5A40]/40 mt-6 animate-pulse">Загрузка ваших параметров...</p>
          </div>
        ) : (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
            
            {/* Tab: Profile */}
            {activeTab === 'profile' && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-16">
                <div className="space-y-8">
                  <header>
                    <h3 className="text-xl font-normal text-[#151619] tracking-tight mb-2">Личная информация</h3>
                    <p className="text-xs text-[#5A5A40]/50 italic">Проверьте имя и email, чтобы чеки, отчеты и действия в системе сохранялись с правильными данными.</p>
                  </header>
                  <div className="space-y-4">
                    <div className="space-y-1.5 focus-within:translate-x-1 transition-transform">
                      <label className="text-[9px] uppercase tracking-widest text-[#5A5A40]/40 font-normal px-1">Полное имя</label>
                      <input 
                        className="w-full px-5 py-3.5 bg-[#f8f7f2] border border-transparent rounded-[1.2rem] text-sm font-normal outline-none focus:bg-white focus:border-[#5A5A40]/20 transition-all font-normal" 
                        value={profileForm.name} 
                        onChange={(e) => setProfileForm((s) => ({ ...s, name: e.target.value }))} 
                      />
                    </div>
                    <div className="space-y-1.5 focus-within:translate-x-1 transition-transform">
                      <label className="text-[9px] uppercase tracking-widest text-[#5A5A40]/40 font-normal px-1">Электронная почта</label>
                      <input 
                        className="w-full px-5 py-3.5 bg-[#f8f7f2] border border-transparent rounded-[1.2rem] text-sm font-normal outline-none focus:bg-white focus:border-[#5A5A40]/20 transition-all font-normal" 
                        value={profileForm.email} 
                        onChange={(e) => setProfileForm((s) => ({ ...s, email: e.target.value }))} 
                      />
                    </div>
                    <div className="space-y-1.5 focus-within:translate-x-1 transition-transform">
                      <label className="text-[9px] uppercase tracking-widest text-[#5A5A40]/40 font-normal px-1">Логин</label>
                      <input 
                        className="w-full px-5 py-3.5 bg-[#f8f7f2] border border-transparent rounded-[1.2rem] text-sm font-normal outline-none focus:bg-white focus:border-[#5A5A40]/20 transition-all font-normal disabled:opacity-50" 
                        disabled 
                        value={profileForm.username} 
                      />
                    </div>
                    <button 
                      onClick={saveProfile} 
                      disabled={savingProfile} 
                      className="pt-2 px-8 py-3.5 bg-[#5A5A40] text-white rounded-[1.2rem] text-[11px] uppercase tracking-widest font-normal hover:bg-[#4A4A30] active:scale-95 transition-all shadow-lg shadow-[#5A5A40]/20 flex items-center gap-2"
                    >
                      {savingProfile ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
                      {savingProfile ? 'Сохранение...' : 'Обновить профиль'}
                    </button>
                  </div>
                </div>

                <div className="space-y-8">
                  <header>
                    <h3 className="text-xl font-normal text-[#151619] tracking-tight mb-2">Безопасность</h3>
                    <p className="text-xs text-[#5A5A40]/50 italic">Меняйте пароль здесь. Новый пароль начнет действовать сразу после сохранения.</p>
                  </header>
                  <div className="space-y-4">
                    <div className="space-y-1.5 focus-within:translate-x-1 transition-transform">
                      <label className="text-[9px] uppercase tracking-widest text-[#5A5A40]/40 font-normal px-1">Текущий пароль</label>
                      <input 
                        type="password" 
                        className="w-full px-5 py-3.5 bg-[#f8f7f2] border border-transparent rounded-[1.2rem] text-sm font-normal outline-none focus:bg-white focus:border-[#5A5A40]/20 transition-all font-normal" 
                        value={passwordForm.currentPassword} 
                        onChange={(e) => setPasswordForm((s) => ({ ...s, currentPassword: e.target.value }))} 
                      />
                    </div>
                    <div className="space-y-1.5 focus-within:translate-x-1 transition-transform">
                      <label className="text-[9px] uppercase tracking-widest text-[#5A5A40]/40 font-normal px-1">Новый пароль</label>
                      <input 
                        type="password" 
                        className="w-full px-5 py-3.5 bg-[#f8f7f2] border border-transparent rounded-[1.2rem] text-sm font-normal outline-none focus:bg-white focus:border-[#5A5A40]/20 transition-all font-normal" 
                        value={passwordForm.newPassword} 
                        onChange={(e) => setPasswordForm((s) => ({ ...s, newPassword: e.target.value }))} 
                      />
                    </div>
                    <div className="space-y-1.5 focus-within:translate-x-1 transition-transform">
                      <label className="text-[9px] uppercase tracking-widest text-[#5A5A40]/40 font-normal px-1">Повторите пароль</label>
                      <input 
                        type="password" 
                        className="w-full px-5 py-3.5 bg-[#f8f7f2] border border-transparent rounded-[1.2rem] text-sm font-normal outline-none focus:bg-white focus:border-[#5A5A40]/20 transition-all font-normal" 
                        value={passwordForm.confirmPassword} 
                        onChange={(e) => setPasswordForm((s) => ({ ...s, confirmPassword: e.target.value }))} 
                      />
                    </div>
                    <button 
                      onClick={savePassword} 
                      disabled={savingPassword} 
                      className="pt-2 px-8 py-3.5 bg-[#5A5A40] text-white rounded-[1.2rem] text-[11px] uppercase tracking-widest font-normal hover:bg-[#4A4A30] active:scale-95 transition-all shadow-lg shadow-[#5A5A40]/20 flex items-center gap-2"
                    >
                      {savingPassword ? <RefreshCw size={14} className="animate-spin" /> : <Lock size={14} />}
                      {savingPassword ? 'Обновление...' : 'Сменить пароль'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Tab: Notifications */}
            {activeTab === 'notifications' && (
              <div className="space-y-12">
                <header className="flex justify-between items-start">
                  <div>
                    <h3 className="text-2xl font-normal text-[#151619] tracking-tight mb-2">Уведомления и пороги</h3>
                    <p className="text-xs text-[#5A5A40]/50 italic">Контролируйте, как и когда система оповещает вас о важных событиях</p>
                  </div>
                  <button 
                    onClick={() => void savePreferences()} 
                    disabled={savingPreferences} 
                    className="px-8 py-3.5 bg-[#5A5A40] text-white rounded-[1.2rem] text-[11px] uppercase tracking-widest font-normal hover:bg-[#4A4A30] transition-all shadow-lg shadow-[#5A5A40]/20 flex items-center gap-2"
                  >
                    {savingPreferences ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
                    Сохранить параметры
                  </button>
                </header>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-16">
                  <div className="space-y-8">
                    <h4 className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#5A5A40]/30 ml-2">Основные триггеры</h4>
                    <div className="space-y-5">
                      {[
                        { key: 'lowStockAlerts', label: 'Пороги остатков', desc: 'Предупреждать, когда товар заканчивается' },
                        { key: 'expiryAlerts', label: 'Сроки годности', desc: 'Уведомлять о товарах с истекающим сроком' },
                        { key: 'dailySummary', label: 'Дневные итоги', desc: 'Короткий отчет о продажах в конце рабочего дня' },
                        { key: 'soundEnabled', label: 'Звуковые эффекты', desc: 'Звуковое сопровождение при возникновении ошибок' },
                      ].map((item) => (
                        <label key={item.key} className="flex items-center justify-between group cursor-pointer bg-white/50 p-4 rounded-[1.5rem] border border-transparent hover:border-[#5A5A40]/10 hover:bg-white transition-all">
                          <div className="flex flex-col">
                            <span className="text-sm font-normal text-[#151619] tracking-tight">{item.label}</span>
                            <span className="text-[10px] text-[#5A5A40]/40 italic">{item.desc}</span>
                          </div>
                          <div className="relative">
                            <input
                              type="checkbox"
                              className="sr-only peer"
                              checked={Boolean((preferences.notifications as any)[item.key])}
                              onChange={(e) => setPreferences((s) => ({
                                ...s,
                                notifications: {
                                  ...s.notifications,
                                  [item.key]: e.target.checked,
                                },
                              }))}
                            />
                            <div className="w-12 h-6 bg-[#f5f5f0] rounded-full peer peer-checked:bg-emerald-500 transition-all duration-300"></div>
                            <div className="absolute left-1 top-1 w-4 h-4 bg-white rounded-full transition-all duration-300 peer-checked:left-7 shadow-md"></div>
                          </div>
                        </label>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-8">
                    <h4 className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#5A5A40]/30 ml-2">Критические значения</h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                      <div className="space-y-2">
                        <label className="text-[10px] uppercase tracking-widest text-[#5A5A40]/60 font-normal px-2">Минимум (шт)</label>
                        <div className="relative">
                          <input
                            type="number"
                            min={0}
                            className="w-full pl-6 pr-12 py-4 bg-[#f8f7f2] border border-transparent rounded-[1.5rem] text-sm font-normal outline-none focus:bg-white focus:border-[#5A5A40]/20 transition-all"
                            value={preferences.notifications.lowStockThreshold}
                            onChange={(e) => setPreferences((s) => ({ ...s, notifications: { ...s.notifications, lowStockThreshold: Number(e.target.value || 0) } }))}
                          />
                        </div>
                      </div>

                      <div className="space-y-2">
                        <label className="text-[10px] uppercase tracking-widest text-[#5A5A40]/60 font-normal px-2">Срок годности (дней)</label>
                        <div className="relative">
                          <input
                            type="number"
                            min={0}
                            className="w-full pl-6 pr-12 py-4 bg-[#f8f7f2] border border-transparent rounded-[1.5rem] text-sm font-normal outline-none focus:bg-white focus:border-[#5A5A40]/20 transition-all"
                            value={preferences.notifications.expiryThresholdDays}
                            onChange={(e) => setPreferences((s) => ({ ...s, notifications: { ...s.notifications, expiryThresholdDays: Number(e.target.value || 0) } }))}
                          />
                        </div>
                      </div>
                    </div>
                    <div className="p-6 rounded-[2rem] bg-[#5A5A40]/[0.03] border border-[#5A5A40]/5">
                      <div className="flex gap-4">
                        <Info size={20} className="text-[#5A5A40]/20 shrink-0" />
                        <p className="text-[11px] leading-relaxed text-[#5A5A40]/60 italic">
                          * Система будет автоматически помечать товары как «Критический остаток», если их количество упадет ниже указанного порога, и предупреждать об истечении срока за выбранное количество дней во всех разделах.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Tab: Company */}
            {activeTab === 'company' && isAdmin && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-16">
                <div className="space-y-8">
                  <header>
                    <h3 className="text-2xl font-normal text-[#151619] tracking-tight mb-2 flex items-center gap-3">
                      <Building2 size={24} className="text-[#5A5A40]/40" />
                      Реквизиты компании
                    </h3>
                    <p className="text-xs text-[#5A5A40]/50 italic">Эти данные будут отображаться на чеках, счетах-фактурах и в заголовках отчетов.</p>
                  </header>
                  <div className="space-y-4">
                    <div className="space-y-1.5">
                      <label className="text-[9px] uppercase tracking-widest text-[#5A5A40]/40 font-normal px-1">Название аптеки</label>
                      <input 
                        className="w-full px-5 py-3.5 bg-[#f8f7f2] border border-transparent rounded-[1.2rem] text-sm font-normal outline-none focus:bg-white focus:border-[#5A5A40]/20 transition-all" 
                        value={companyProfile.pharmacyName} 
                        onChange={(e) => setCompanyProfile((s) => ({ ...s, pharmacyName: e.target.value }))} 
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[9px] uppercase tracking-widest text-[#5A5A40]/40 font-normal px-1">ИНН предприятия</label>
                      <input 
                        className="w-full px-5 py-3.5 bg-[#f8f7f2] border border-transparent rounded-[1.2rem] text-sm font-normal outline-none focus:bg-white focus:border-[#5A5A40]/20 transition-all font-normal" 
                        value={companyProfile.taxId || ''} 
                        onChange={(e) => setCompanyProfile((s) => ({ ...s, taxId: e.target.value }))} 
                        placeholder="Напр. 010020304"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[9px] uppercase tracking-widest text-[#5A5A40]/40 font-normal px-1">Адрес</label>
                      <input 
                        className="w-full px-5 py-3.5 bg-[#f8f7f2] border border-transparent rounded-[1.2rem] text-sm font-normal outline-none focus:bg-white focus:border-[#5A5A40]/20 transition-all font-normal" 
                        value={companyProfile.address || ''} 
                        onChange={(e) => setCompanyProfile((s) => ({ ...s, address: e.target.value }))} 
                      />
                    </div>
                    <button 
                      onClick={saveCompanyProfile} 
                      disabled={savingCompany} 
                      className="pt-2 px-8 py-3.5 bg-[#5A5A40] text-white rounded-[1.2rem] text-[11px] uppercase tracking-widest font-normal hover:bg-[#4A4A30] active:scale-95 transition-all shadow-lg shadow-[#5A5A40]/20 flex items-center gap-2"
                    >
                      {savingCompany ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
                      Сохранить реквизиты
                    </button>
                  </div>
                </div>

                <div className="space-y-8">
                  <header>
                    <h3 className="text-2xl font-normal text-[#151619] tracking-tight mb-2">Брендинг</h3>
                    <p className="text-xs text-[#5A5A40]/50 italic">Загрузите логотип вашей аптеки для профессионального вида отчетности.</p>
                  </header>
                  <div className="p-10 rounded-[2.5rem] border-2 border-dashed border-[#5A5A40]/10 bg-[#f8f7f2]/50 flex flex-col items-center justify-center text-center space-y-6">
                    {companyProfile.logoDataUrl ? (
                      <div className="relative group">
                        <img src={companyProfile.logoDataUrl} alt="Logo" className="h-32 w-auto object-contain rounded-xl shadow-lg" />
                        <button 
                          onClick={() => setCompanyProfile((s) => ({ ...s, logoDataUrl: '' }))}
                          className="absolute -top-3 -right-3 w-8 h-8 bg-rose-500 text-white rounded-full flex items-center justify-center shadow-lg opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    ) : (
                      <div className="w-20 h-20 rounded-[2rem] bg-white text-[#5A5A40]/10 flex items-center justify-center">
                        <ImageUp size={40} />
                      </div>
                    )}
                    <div>
                      <label className="px-6 py-2.5 bg-white border border-[#5A5A40]/10 rounded-xl text-[10px] uppercase tracking-widest font-bold text-[#5A5A40] cursor-pointer hover:bg-[#5A5A40] hover:text-white transition-all">
                        {companyProfile.logoDataUrl ? 'Сменить лого' : 'Загрузить логотип'}
                        <input type="file" className="hidden" accept="image/*" onChange={(e) => {
                           const file = e.target.files?.[0];
                           if (!file) return;
                           const reader = new FileReader();
                           reader.onload = (ev) => setCompanyProfile(s => ({ ...s, logoDataUrl: String(ev.target?.result || '') }));
                           reader.readAsDataURL(file);
                        }} />
                      </label>
                      <p className="text-[9px] text-[#5A5A40]/30 mt-4 uppercase">Макс. размер 1.5MB (PNG, JPG)</p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Tab: System */}
            {activeTab === 'system' && isAdmin && (
              <div className="space-y-12">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-16">
                  <div className="space-y-8">
                    <header>
                      <h3 className="text-2xl font-normal text-[#151619] tracking-tight mb-2 flex items-center gap-3">
                        <ShieldCheck size={24} className="text-emerald-500/40" />
                        Целостность данных
                      </h3>
                      <p className="text-xs text-[#5A5A40]/50 italic">Проверка соответствия складских остатков и истории транзакций.</p>
                    </header>
                    
                    <div className={`p-8 rounded-[2rem] border transition-all ${
                      integrityError ? 'bg-rose-50 border-rose-100' : 
                      integrityReport?.healthy ? 'bg-emerald-50/50 border-emerald-100/50' :
                      'bg-[#f8f7f2] border-[#5A5A40]/5'
                    }`}>
                      {integrityLoading ? (
                        <div className="flex items-center gap-4">
                          <RefreshCw size={24} className="animate-spin text-[#5A5A40]/30" />
                          <p className="text-xs font-normal text-[#5A5A40]/50">Выполняется глубокий анализ базы данных...</p>
                        </div>
                      ) : integrityReport ? (
                        <div className="space-y-6">
                          <div className="flex items-center gap-3">
                            <div className={`w-10 h-10 rounded-2xl flex items-center justify-center ${integrityReport.healthy ? 'bg-emerald-500 text-white' : 'bg-red-500 text-white'}`}>
                              {integrityReport.healthy ? <CheckCircle2 size={24} /> : <ShieldAlert size={24} />}
                            </div>
                            <div className="flex-1">
                              <p className="text-sm font-bold text-[#151619]">
                                {integrityReport.healthy ? 'Ошибок не обнаружено' : `Обнаружено расхождений: ${integrityReport.issuesCount || 0}`}
                              </p>
                              <div className="flex gap-3 mt-1">
                                <p className="text-[9px] text-[#5A5A40]/50 uppercase tracking-widest font-bold">
                                  Товаров: {integrityReport.checkedProducts || 0}
                                </p>
                                <p className="text-[9px] text-[#5A5A40]/50 uppercase tracking-widest font-bold">
                                  Записей склада: {integrityReport.checkedWarehouseStockRows || 0}
                                </p>
                              </div>
                            </div>
                          </div>
                          {!integrityReport.healthy && (
                            <div className="space-y-2 mt-4 max-h-[160px] overflow-y-auto pr-2 custom-scrollbar border-t border-[#5A5A40]/5 pt-4">
                              {(integrityReport.issues || []).slice(0, 5).map((issue: any, idx: number) => (
                                <div key={idx} className="p-3 bg-white/50 border border-red-200/50 rounded-xl text-[10px] text-red-700">
                                  <span className="font-black bg-red-100 px-1.5 py-0.5 rounded mr-2 uppercase text-[8px]">{issue.type}</span>
                                  <span className="font-bold">{issue.productName}</span>: {issue.message}
                                </div>
                              ))}
                              {(integrityReport.issues?.length || 0) > 5 && (
                                <p className="text-[9px] text-red-400 text-center italic">... и еще {(integrityReport.issues?.length || 0) - 5} проблем</p>
                              )}
                            </div>
                          )}
                          {!integrityReport.healthy && (
                            <button 
                              onClick={fixIntegrity} 
                              disabled={integrityLoading}
                              className="w-full py-4 bg-red-500 text-white rounded-2xl text-[11px] uppercase tracking-widest font-bold hover:bg-red-600 transition-all shadow-xl shadow-red-200 mt-4 flex items-center justify-center gap-2"
                            >
                              {integrityLoading && <RefreshCw size={14} className="animate-spin" />}
                              Исправить расхождения автоматически
                            </button>
                          )}
                          {integrityReport.repaired && (
                            <div className="p-3 bg-emerald-500/10 rounded-xl border border-emerald-500/20 flex items-center gap-2 mt-4">
                               <CheckCircle2 size={14} className="text-emerald-600" />
                               <p className="text-[10px] text-emerald-700 font-bold uppercase tracking-widest">База исправлена</p>
                            </div>
                          )}
                        </div>
                      ) : (
                        <button onClick={() => void checkIntegrity()} className="w-full py-4 bg-[#5A5A40] text-white rounded-2xl text-[11px] uppercase tracking-widest font-normal hover:bg-[#4A4A30] transition-all">
                          Запустить проверку
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="space-y-8">
                    <header>
                      <h3 className="text-2xl font-normal text-[#151619] tracking-tight mb-2 flex items-center gap-3">
                        <Database size={24} className="text-amber-500/40" />
                        Резервное копирование
                      </h3>
                      <p className="text-xs text-[#5A5A40]/50 italic">Экспорт всей базы данных в JSON файл для хранения вне системы.</p>
                    </header>
                    
                    <div className="p-10 rounded-[2rem] bg-[#f8f7f2] border border-[#5A5A40]/5 flex flex-col items-center text-center space-y-6">
                      <div className="w-16 h-16 rounded-[1.5rem] bg-white flex items-center justify-center text-[#5A5A40]/20 shadow-inner">
                        <Database size={32} />
                      </div>
                      <p className="text-xs text-[#5A5A40]/40 max-w-xs leading-relaxed italic">Рекомендуется выполнять резервное копирование каждую неделю или перед важными обновлениями системы.</p>
                      <button 
                        onClick={exportBackup} 
                        disabled={backupLoading}
                        className="px-10 py-4 border border-[#5A5A40]/20 rounded-2xl text-[11px] uppercase tracking-widest font-normal text-[#5A5A40] hover:bg-[#5A5A40] hover:text-white transition-all shadow-sm"
                      >
                        {backupLoading ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
                        <span className="ml-2">Экспортировать JSON</span>
                      </button>
                    </div>

                    {/* New Diagnostics Card */}
                    <div className="p-8 rounded-[2rem] bg-stone-900 text-white shadow-2xl space-y-6">
                       <div className="flex items-center justify-between">
                         <div>
                            <p className="text-[10px] text-white/30 uppercase tracking-[0.2em] mb-1">Диагностика</p>
                            <h4 className="text-lg font-normal tracking-tight">Состояние системы</h4>
                         </div>
                         <div className="flex gap-2">
                           <button onClick={() => setIsDbModalOpen(true)} className="px-3 py-1.5 bg-white/5 border border-white/10 rounded-xl text-[10px] text-white/60 hover:bg-white/10 transition-all font-bold uppercase tracking-widest">
                             Настроить БД
                           </button>
                           <button onClick={checkStatus} disabled={statusLoading} className="p-2 bg-white/10 rounded-xl hover:bg-white/20 transition-all">
                             <RefreshCw size={16} className={statusLoading ? 'animate-spin' : ''} />
                           </button>
                         </div>
                       </div>

                       <div className="space-y-3">
                          <div className="flex items-center justify-between p-3 bg-white/5 rounded-2xl border border-white/10">
                             <div className="flex items-center gap-3">
                                <ShieldCheck size={18} className={systemStatus?.pgDumpFound ? 'text-emerald-400' : 'text-red-400'} />
                                <span className="text-xs font-normal">Инструмент бэкапа (pg_dump)</span>
                             </div>
                             <span className={`text-[9px] uppercase font-black px-2 py-0.5 rounded-md ${systemStatus?.pgDumpFound ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>
                               {systemStatus?.pgDumpFound ? 'Найден' : 'Не найден'}
                             </span>
                          </div>

                          <div className="flex items-center justify-between p-3 bg-white/5 rounded-2xl border border-white/10">
                             <div className="flex items-center gap-3">
                                <HardDrive size={18} className={systemStatus?.diskDReady ? 'text-emerald-400' : 'text-red-400'} />
                                <span className="text-xs font-normal">Диск D (Хранилище)</span>
                             </div>
                             <span className={`text-[9px] uppercase font-black px-2 py-0.5 rounded-md ${systemStatus?.diskDReady ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>
                               {systemStatus?.diskDReady ? 'Готов' : 'Отсутствует'}
                             </span>
                          </div>

                          <div className="flex items-center justify-between p-3 bg-white/5 rounded-2xl border border-white/10">
                             <div className="flex items-center gap-3">
                                <CircleCheck size={18} className={systemStatus?.backupDirExists ? 'text-emerald-400' : 'text-amber-400'} />
                                <span className="text-xs font-normal">Папка бэкапов</span>
                             </div>
                             <span className={`text-[9px] uppercase font-black px-2 py-0.5 rounded-md ${systemStatus?.backupDirExists ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'}`}>
                               {systemStatus?.backupDirExists ? 'OK' : 'Будет создана'}
                             </span>
                          </div>
                       </div>

                       {systemStatus?.pgDumpPath && (
                         <div className="p-3 bg-white/5 rounded-xl text-[10px] text-white/30 font-mono break-all">
                           Path: {systemStatus.pgDumpPath}
                         </div>
                       )}
                    </div>
                  </div>
                </div>

                <div className="space-y-8">
                  <header>
                    <h3 className="text-lg font-normal text-[#151619] tracking-tight mb-2">Логи аудита</h3>
                    <p className="text-xs text-[#5A5A40]/50">История всех важных действий пользователей в системе.</p>
                  </header>
                  <div className="bg-white/50 rounded-[2.5rem] border border-[#5A5A40]/10 overflow-hidden">
                    <AuditLogPanel />
                  </div>
                </div>
              </div>
            )}

            {/* Tab: Users */}
            {activeTab === 'users' && isAdmin && (
              <div className="space-y-8">
                <header>
                  <h3 className="text-2xl font-normal text-[#151619] tracking-tight mb-2 flex items-center gap-3">
                    <UsersIcon size={24} className="text-blue-500/40" />
                    Управление командой
                  </h3>
                  <p className="text-xs text-[#5A5A40]/50 italic">Добавляйте, редактируйте и отключайте учетные записи сотрудников вашей аптеки.</p>
                </header>
                <div className="bg-white/50 rounded-[2.5rem] border border-[#5A5A40]/10 overflow-hidden shadow-sm">
                  <UsersAdminPanel currentUserRole={user?.role} />
                </div>
              </div>
            )}

          </div>
        )}
      </div>

      <AppModal
        open={isDbModalOpen}
        onClose={() => setIsDbModalOpen(false)}
        title="Настройка подключения к БД"
        subtitle="Задайте параметры для доступа к PostgreSQL вручную"
        size="md"
        tone="warning"
        footer={
          <div className="flex gap-3">
            <button onClick={() => setIsDbModalOpen(false)} className="flex-1 py-3 rounded-2xl border border-[#5A5A40]/10 text-sm font-semibold">Отмена</button>
            <button onClick={saveDbConfig} className="flex-1 py-3 rounded-2xl bg-[#5A5A40] text-white text-sm font-semibold hover:bg-[#4A4A30] transition-all">Сохранить и перезапустить</button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-[10px] text-[#5A5A40]/50 uppercase tracking-widest font-bold px-1">Пользователь</label>
              <input value={dbConfig.user} onChange={e => setDbConfig(s => ({...s, user: e.target.value}))} className="w-full px-4 py-2 bg-[#f8f7f2] border-transparent rounded-xl text-sm outline-none focus:bg-white focus:border-[#5A5A40]/20" />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] text-[#5A5A40]/50 uppercase tracking-widest font-bold px-1">Пароль</label>
              <input type="password" value={dbConfig.password} onChange={e => setDbConfig(s => ({...s, password: e.target.value}))} className="w-full px-4 py-2 bg-[#f8f7f2] border-transparent rounded-xl text-sm outline-none focus:bg-white focus:border-[#5A5A40]/20" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-[10px] text-[#5A5A40]/50 uppercase tracking-widest font-bold px-1">Хост</label>
              <input value={dbConfig.host} onChange={e => setDbConfig(s => ({...s, host: e.target.value}))} className="w-full px-4 py-2 bg-[#f8f7f2] border-transparent rounded-xl text-sm outline-none focus:bg-white focus:border-[#5A5A40]/20" />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] text-[#5A5A40]/50 uppercase tracking-widest font-bold px-1">Порт</label>
              <input value={dbConfig.port} onChange={e => setDbConfig(s => ({...s, port: e.target.value}))} className="w-full px-4 py-2 bg-[#f8f7f2] border-transparent rounded-xl text-sm outline-none focus:bg-white focus:border-[#5A5A40]/20" />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] text-[#5A5A40]/50 uppercase tracking-widest font-bold px-1">Имя Базы Данных</label>
            <input value={dbConfig.dbname} onChange={e => setDbConfig(s => ({...s, dbname: e.target.value}))} className="w-full px-4 py-2 bg-[#f8f7f2] border-transparent rounded-xl text-sm outline-none focus:bg-white focus:border-[#5A5A40]/20" />
          </div>
          <div className="p-4 bg-amber-50 border border-amber-100 rounded-2xl">
            <p className="text-[11px] text-amber-700 italic">По умолчанию: postgres / localhost / 5432 / pharmapro</p>
          </div>
        </div>
      </AppModal>

      {/* Global Interface Mode */}
      <div className="bg-[#f5f5f0]/40 p-8 rounded-[2.5rem] border border-[#5A5A40]/5 flex flex-col md:flex-row md:items-center justify-between gap-8">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 bg-white rounded-2xl flex items-center justify-center text-[#5A5A40] shadow-sm">
            {preferences.appearance.theme === 'dark' ? <Moon size={24} /> : <Sun size={24} />}
          </div>
          <div>
            <p className="font-normal text-[#151619] text-lg leading-tight uppercase tracking-tight">Внешний вид</p>
            <p className="text-xs text-[#5A5A40]/50 font-normal italic">Смена цветовой схемы интерфейса системы</p>
          </div>
        </div>

        <div className="flex items-center gap-6">
          <div className="bg-white p-1.5 rounded-[1.2rem] border border-[#5A5A40]/10 flex gap-1">
            <button 
              onClick={() => {
                const next = { ...preferences, appearance: { theme: 'light' as const } };
                setPreferences(next);
                void savePreferences(next);
              }} 
              className={`px-6 py-2.5 rounded-xl text-[10px] font-normal uppercase tracking-[0.2em] flex items-center gap-2 transition-all ${preferences.appearance.theme === 'light' ? 'bg-[#5A5A40] text-white shadow-lg shadow-[#5A5A40]/20' : 'text-[#5A5A40]/40 hover:bg-[#5A5A40]/5'}`}
            >
              <Sun size={12} /> Светлая
            </button>
            <button 
              onClick={() => {
                const next = { ...preferences, appearance: { theme: 'dark' as const } };
                setPreferences(next);
                void savePreferences(next);
              }} 
              className={`px-6 py-2.5 rounded-xl text-[10px] font-normal uppercase tracking-[0.2em] flex items-center gap-2 transition-all ${preferences.appearance.theme === 'dark' ? 'bg-[#151619] text-white shadow-lg shadow-[#151619]/20' : 'text-[#5A5A40]/40 hover:bg-[#5A5A40]/5'}`}
            >
              <Moon size={12} /> Темная
            </button>
          </div>
          
          <div className="h-10 w-px bg-[#5A5A40]/10 mx-2 hidden sm:block" />
          
          <div className="flex items-center gap-3">
             <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center text-[#5A5A40]/40">
                <Globe size={18} />
             </div>
             <p className="text-xs font-normal text-[#5A5A40] uppercase tracking-widest">Язык: <span className="font-bold underline decoration-[#5A5A40]/20 underline-offset-4">Русский</span></p>
          </div>
        </div>
      </div>
    </div>

    <AnimatePresence>
        {(message || errorMessage) && (
          <motion.div
            initial={{ opacity: 0, y: -50, x: '-50%' }}
            animate={{ opacity: 1, y: 30, x: '-50%' }}
            exit={{ opacity: 0, y: -50, x: '-50%' }}
            className={`fixed top-[60px] left-1/2 z-[9999] min-w-[340px] text-center rounded-[1.5rem] px-8 py-4 text-xs font-bold shadow-2xl border backdrop-blur-xl ${
              errorMessage 
                ? 'bg-rose-50/90 border-rose-200 text-rose-700' 
                : 'bg-emerald-50/90 border-emerald-200 text-emerald-700'
            }`}
          >
            <div className="flex items-center justify-center gap-3">
              {errorMessage ? <ShieldAlert size={18} /> : <CheckCircle2 size={18} />}
              {errorMessage || message}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};
