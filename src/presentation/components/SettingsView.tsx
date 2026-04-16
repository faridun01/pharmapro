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

export const SettingsView: React.FC = () => {
  const { t } = useTranslation();
  const { user, logout } = usePharmacy();

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

  const [message, setMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const isAdmin = user?.role === 'ADMIN' || user?.role === 'OWNER';

  const appearanceMode = preferences.appearance.theme;

  const setNotice = (text: string) => {
    setMessage(text);
    window.setTimeout(() => setMessage(null), 2500);
  };

  const setError = (text: string) => {
    setErrorMessage(text);
    window.setTimeout(() => setErrorMessage(null), 3500);
  };

  const checkIntegrity = async (silent = false) => {
    if (!silent) {
      setIntegrityLoading(true);
      setIntegrityError(null);
    }
    try {
      const response = await fetch('/api/dev/stock-integrity', {
        method: 'GET',
        headers: await buildApiHeaders(false),
      });

      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body.error || t('Failed to check stock integrity'));
      }

      setIntegrityReport(body);
      setAutoChecked(true);
    } catch (e: any) {
      setIntegrityError(e?.message || t('Failed to check stock integrity'));
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
      const response = await fetch('/api/dev/stock-integrity/fix', {
        method: 'POST',
        headers: await buildApiHeaders(),
        body: JSON.stringify({}),
      });

      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body.error || t('Failed to repair stock integrity'));
      }

      setIntegrityReport(body);
      setNotice(t('Integrity repaired'));
    } catch (e: any) {
      setIntegrityError(e?.message || t('Failed to repair stock integrity'));
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
          throw new Error(profileBody.error || t('Failed to load user profile'));
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
          document.documentElement.dataset.theme = normalized.appearance?.theme === 'dark' ? 'dark' : 'light';
        }

        if (companyRes) {
          const companyBody = await companyRes.json().catch(() => ({}));
          if (companyRes.ok) {
            setCompanyProfile((prev) => ({ ...prev, ...(companyBody || {}) }));
          }
        }
      } catch (e: any) {
        setError(e?.message || t('Failed to load settings'));
      } finally {
        setLoadingProfile(false);
      }
    };

    void loadSettings();
  }, [user?.id, isAdmin, t]);

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
        throw new Error(body.error || t('Failed to save profile'));
      }

      const storedUserRaw = window.localStorage.getItem('pharmapro_user');
      if (storedUserRaw) {
        const storedUser = JSON.parse(storedUserRaw);
        const nextUser = { ...storedUser, name: body.name, email: body.email };
        window.localStorage.setItem('pharmapro_user', JSON.stringify(nextUser));
      }

      setNotice(t('Profile saved'));
    } catch (e: any) {
      setError(e?.message || t('Failed to save profile'));
    } finally {
      setSavingProfile(false);
    }
  };

  const savePassword = async () => {
    setSavingPassword(true);
    try {
      const response = await fetch('/api/system/me/password', {
        method: 'PUT',
        headers: await buildApiHeaders(),
        body: JSON.stringify(passwordForm),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body.error || t('Failed to update password'));
      }

      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
      setNotice(t('Password updated'));
    } catch (e: any) {
      setError(e?.message || t('Failed to update password'));
    } finally {
      setSavingPassword(false);
    }
  };

  const applyLanguage = async (lang: 'ru') => {
    await i18n.changeLanguage(lang);
    window.localStorage.setItem('pharmapro_language', lang);
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
        throw new Error(body.error || t('Failed to save preferences'));
      }

      setPreferences(body as UserSettingsPreferences);
      document.documentElement.dataset.theme = body.appearance?.theme === 'dark' ? 'dark' : 'light';
      await applyLanguage('ru');
      
      // Trigger global metrics refresh to update notification badges
      window.dispatchEvent(new CustomEvent('refresh-app-metrics'));
      
      setNotice(t('Preferences saved'));
    } catch (e: any) {
      setError(e?.message || t('Failed to save preferences'));
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
        throw new Error(body.error || t('Failed to save'));
      }

      setCompanyProfile(body);
      setNotice(t('Company details saved'));
    } catch (e: any) {
      setError(e?.message || t('Failed to save'));
    } finally {
      setSavingCompany(false);
    }
  };

  const handleLogoUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Загрузите файл изображения для логотипа');
      return;
    }
    if (file.size > 1_500_000) {
      setError('Логотип должен быть меньше 1.5 MB');
      return;
    }

    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('Не удалось прочитать логотип'));
        reader.readAsDataURL(file);
      });
      setCompanyProfile((state) => ({ ...state, logoDataUrl: dataUrl }));
      setNotice('Логотип загружен. Сохраните реквизиты компании');
    } catch (e: any) {
      setError(e?.message || 'Не удалось загрузить логотип');
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
        throw new Error(body.error || t('Failed to export backup'));
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `pharmapro-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setNotice(t('Backup exported'));
    } catch (e: any) {
      setError(e?.message || t('Failed to export backup'));
    } finally {
      setBackupLoading(false);
    }
  };

  const timezoneOptions = useMemo(() => [
    'Asia/Dushanbe',
    'Asia/Almaty',
    'Europe/Moscow',
    'UTC',
  ], []);

  return (
    <div className="max-w-5xl mx-auto space-y-8 animate-in fade-in duration-500 pb-12">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold text-[#5A5A40] tracking-tight">{t('System Settings')}</h2>
          <p className="text-[#5A5A40]/60 mt-1 italic">{t('All user, security, localization, and system controls in one place')}</p>
        </div>
        <button
          onClick={logout}
          className="flex items-center gap-2 px-5 py-2.5 bg-red-50 text-red-600 rounded-xl font-bold hover:bg-red-100 transition-all border border-red-100"
        >
          <LogOut size={18} />
          {t('Sign Out')}
        </button>
      </div>

      <AnimatePresence>
        {(message || errorMessage) && (
          <motion.div
            initial={{ opacity: 0, y: -50, x: '-50%' }}
            animate={{ opacity: 1, y: 20, x: '-50%' }}
            exit={{ opacity: 0, y: -50, x: '-50%' }}
            className={`fixed top-0 left-1/2 z-[100] min-w-[300px] text-center rounded-2xl px-6 py-4 text-sm font-bold shadow-2xl border backdrop-blur-md ${
              errorMessage 
                ? 'bg-rose-50/90 border-rose-200 text-rose-700' 
                : 'bg-emerald-50/90 border-emerald-200 text-emerald-700'
            }`}
          >
            {errorMessage || message}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {[
          { title: 'Профиль', subtitle: 'Имя, email и вход', icon: User },
          { title: 'Уведомления', subtitle: `Остатки: ${preferences.notifications.lowStockThreshold} · Сроки: ${preferences.notifications.expiryThresholdDays} дн.`, icon: Bell },
          { title: 'Резерв и контроль', subtitle: isAdmin ? 'Проверка остатков и backup доступны' : 'Доступны личные настройки', icon: Database },
        ].map((item) => (
          <div key={item.title} className="bg-white rounded-2xl border border-[#5A5A40]/10 px-5 py-4 shadow-sm">
            <div className="w-10 h-10 rounded-2xl bg-[#f5f5f0] text-[#5A5A40] flex items-center justify-center mb-3">
              <item.icon size={18} />
            </div>
            <p className="text-sm font-bold text-[#5A5A40]">{item.title}</p>
            <p className="text-xs text-[#5A5A40]/55 mt-1">{item.subtitle}</p>
          </div>
        ))}
      </div>

      <div className="bg-white p-6 rounded-2xl border border-[#5A5A40]/10 grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div>
          <div className="flex items-center gap-2 mb-3 text-[#5A5A40]">
            <User size={18} />
            <h3 className="text-lg font-bold">{t('Personal Information')}</h3>
          </div>
          <p className="text-sm text-[#5A5A40]/55 mb-4">Проверьте имя и email, чтобы чеки, отчеты и действия в системе сохранялись с правильными данными пользователя.</p>
          <div className="space-y-3">
            <input className="w-full px-4 py-2.5 border border-[#5A5A40]/10 rounded-xl" placeholder={t('Full name')} value={profileForm.name} onChange={(e) => setProfileForm((s) => ({ ...s, name: e.target.value }))} />
            <input className="w-full px-4 py-2.5 border border-[#5A5A40]/10 rounded-xl" placeholder={t('Email Address')} value={profileForm.email} onChange={(e) => setProfileForm((s) => ({ ...s, email: e.target.value }))} />
            <input className="w-full px-4 py-2.5 border border-[#5A5A40]/10 rounded-xl" placeholder={t('Username (optional)')} value={profileForm.username} onChange={(e) => setProfileForm((s) => ({ ...s, username: e.target.value }))} />
            <button onClick={saveProfile} disabled={savingProfile || loadingProfile} className="px-4 py-2 rounded-xl bg-[#5A5A40] text-white text-sm font-semibold disabled:opacity-50 flex items-center gap-2">
              <Save size={14} /> {savingProfile ? t('Saving...') : t('Save profile')}
            </button>
          </div>
        </div>

        <div>
          <div className="flex items-center gap-2 mb-3 text-[#5A5A40]">
            <ShieldCheck size={18} />
            <h3 className="text-lg font-bold">{t('Password & Security')}</h3>
          </div>
          <p className="text-sm text-[#5A5A40]/55 mb-4">Меняйте пароль здесь. Новый пароль начнет действовать сразу после сохранения.</p>
          <div className="space-y-3">
            <input type="password" className="w-full px-4 py-2.5 border border-[#5A5A40]/10 rounded-xl" placeholder={t('Current password')} value={passwordForm.currentPassword} onChange={(e) => setPasswordForm((s) => ({ ...s, currentPassword: e.target.value }))} />
            <input type="password" className="w-full px-4 py-2.5 border border-[#5A5A40]/10 rounded-xl" placeholder={t('New password')} value={passwordForm.newPassword} onChange={(e) => setPasswordForm((s) => ({ ...s, newPassword: e.target.value }))} />
            <input type="password" className="w-full px-4 py-2.5 border border-[#5A5A40]/10 rounded-xl" placeholder={t('Confirm new password')} value={passwordForm.confirmPassword} onChange={(e) => setPasswordForm((s) => ({ ...s, confirmPassword: e.target.value }))} />
            <button onClick={savePassword} disabled={savingPassword} className="px-4 py-2 rounded-xl border border-[#5A5A40]/20 text-[#5A5A40] text-sm font-semibold disabled:opacity-50">
              {savingPassword ? t('Updating...') : t('Update password')}
            </button>
          </div>
        </div>
      </div>

      <div className="bg-white p-8 rounded-[32px] border border-[#5A5A40]/5 space-y-8 shadow-sm relative overflow-hidden">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 text-[#5A5A40]">
            <div className="w-10 h-10 rounded-2xl bg-[#f5f5f0] flex items-center justify-center">
              <Bell size={20} />
            </div>
            <div>
              <h3 className="text-xl font-bold tracking-tight">{t('Notifications')}</h3>
              <p className="text-xs text-[#5A5A40]/50 mt-0.5">Контролируйте, как и когда система оповещает вас о важных событиях</p>
            </div>
          </div>
          <button
            onClick={() => { void savePreferences(); }}
            disabled={savingPreferences}
            className="flex items-center gap-2 px-6 py-2.5 bg-[#5A5A40] text-white rounded-2xl font-bold text-sm hover:bg-[#4A4A30] transition-all shadow-md shadow-[#5A5A40]/10 disabled:opacity-50"
          >
            {savingPreferences ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
            {savingPreferences ? t('Saving...') : 'Сохранить уведомления'}
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-10 gap-y-8">
          {/* ... keeping the contents same as previous step but nested here ... */}
          <div className="space-y-4">
            <h4 className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#5A5A40]/40">Основные оповещения</h4>
            <div className="space-y-3">
              {[
                { key: 'lowStockAlerts', label: t('Low stock alerts'), desc: 'Предупреждать, когда товар заканчивается' },
                { key: 'expiryAlerts', label: t('Expiry alerts'), desc: 'Уведомлять о товарах с истекающим сроком' },
                { key: 'dailySummary', label: t('Daily summary'), desc: 'Короткий отчет о продажах в конце дня' },
                { key: 'soundEnabled', label: t('Sound notifications'), desc: 'Звуковое сопровождение при уведомлениях' },
              ].map((item) => (
                <label key={item.key} className="flex items-center justify-between group cursor-pointer">
                  <div className="flex flex-col">
                    <span className="text-sm font-bold text-[#5A5A40] group-hover:text-[#151619] transition-colors">{item.label}</span>
                    <span className="text-[11px] text-[#5A5A40]/50">{item.desc}</span>
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
                    <div className="w-10 h-5 bg-[#f5f5f0] rounded-full peer peer-checked:bg-[#5A5A40] transition-all duration-300"></div>
                    <div className="absolute left-1 top-1 w-3 h-3 bg-white rounded-full transition-all duration-300 peer-checked:left-6 shadow-sm"></div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <div className="space-y-6">
            <h4 className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#5A5A40]/40">Пороги уведомлений</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-xs font-bold text-[#5A5A40]/70 flex items-center gap-1.5 ml-1">
                  Минимум на складе
                </label>
                <div className="relative">
                  <input
                    type="number"
                    min={0}
                    className="w-full pl-4 pr-12 py-3 bg-[#fcfbf7] border border-[#5A5A40]/10 rounded-2xl text-sm font-semibold outline-none focus:ring-2 focus:ring-[#5A5A40]/10 transition-all placeholder:font-normal"
                    placeholder="5"
                    value={preferences.notifications.lowStockThreshold}
                    onChange={(e) => setPreferences((s) => ({ ...s, notifications: { ...s.notifications, lowStockThreshold: Number(e.target.value || 0) } }))}
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[10px] font-bold text-[#5A5A40]/30 uppercase">Шт</span>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold text-[#5A5A40]/70 flex items-center gap-1.5 ml-1">
                  Срок годности
                </label>
                <div className="relative">
                  <input
                    type="number"
                    min={0}
                    className="w-full pl-4 pr-12 py-3 bg-[#fcfbf7] border border-[#5A5A40]/10 rounded-2xl text-sm font-semibold outline-none focus:ring-2 focus:ring-[#5A5A40]/10 transition-all placeholder:font-normal"
                    placeholder="30"
                    value={preferences.notifications.expiryThresholdDays}
                    onChange={(e) => setPreferences((s) => ({ ...s, notifications: { ...s.notifications, expiryThresholdDays: Number(e.target.value || 0) } }))}
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[10px] font-bold text-[#5A5A40]/30 uppercase">Дн</span>
                </div>
              </div>
            </div>
            <div className="p-4 rounded-2xl bg-[#5A5A40]/[0.02] border border-[#5A5A40]/5">
              <p className="text-[11px] leading-relaxed text-[#5A5A40]/60 italic">
                * Система будет автоматически помечать товары как «Критический остаток», если их количество упадет ниже указанного порога, и предупреждать об истечении срока за выбранное количество дней.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-[#f5f5f0]/40 p-6 rounded-2xl border border-[#5A5A40]/10 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center text-[#5A5A40]">
            {appearanceMode === 'dark' ? <Moon size={18} /> : <Sun size={18} />}
          </div>
          <div>
            <p className="font-bold text-[#5A5A40]">{t('Appearance Mode')}</p>
            <p className="text-xs text-[#5A5A40]/55">{t('Choose light or dark interface theme')}</p>
          </div>
        </div>

        <div className="bg-white p-1 rounded-xl border border-[#5A5A40]/10 flex gap-1">
          <button onClick={() => setPreferences((s) => ({ ...s, appearance: { theme: 'light' } }))} className={`px-4 py-2 rounded-lg text-[10px] font-bold uppercase tracking-wider flex items-center gap-2 transition-all ${appearanceMode === 'light' ? 'bg-[#5A5A40] text-white' : 'text-[#5A5A40]/50 hover:bg-[#5A5A40]/5'}`}>
            <Sun size={12} /> {t('Light')}
          </button>
          <button onClick={() => setPreferences((s) => ({ ...s, appearance: { theme: 'dark' } }))} className={`px-4 py-2 rounded-lg text-[10px] font-bold uppercase tracking-wider flex items-center gap-2 transition-all ${appearanceMode === 'dark' ? 'bg-[#151619] text-white' : 'text-[#5A5A40]/50 hover:bg-[#5A5A40]/5'}`}>
            <Moon size={12} /> {t('Dark')}
          </button>
        </div>

        <button onClick={() => { void savePreferences(); }} disabled={savingPreferences} className="px-6 py-2.5 rounded-2xl bg-[#5A5A40] text-white text-sm font-bold disabled:opacity-50 flex items-center gap-2">
          {savingPreferences ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
          {savingPreferences ? t('Saving...') : 'Сохранить тему'}
        </button>
      </div>

      {isAdmin && (
        <div className="bg-white p-6 rounded-2xl border border-[#5A5A40]/10 flex items-center justify-between">
          <div className="flex items-center gap-3 text-[#5A5A40]">
            <ShieldCheck size={18} />
            <div>
              <p className="font-bold">Расширенное управление</p>
              <p className="text-sm text-[#5A5A40]/60">Пользователи, аудит, экспорт и системные инструменты переехали в новый раздел.</p>
            </div>
          </div>
          <p className="text-xs font-bold text-[#5A5A40]/40 uppercase tracking-widest">Используйте меню "Админ"</p>
        </div>
      )}
    </div>
  );
};
