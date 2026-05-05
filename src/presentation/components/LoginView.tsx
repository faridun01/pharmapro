import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LogIn, ShieldCheck } from 'lucide-react';
import { markRuntimeOnce } from '../../lib/runtimeMarks';

export const LoginView: React.FC<{
  embedded?: boolean;
  onLogin: (login: string, password: string) => Promise<void>;
}> = ({ embedded = false, onLogin }) => {
  const { t } = useTranslation();
  const [loginField, setLoginField] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsSetup, setNeedsSetup] = useState(false);

  React.useEffect(() => {
    markRuntimeOnce('login-view-mounted');
    const checkSetup = async () => {
       try {
          const res = await fetch('/api/auth/initial-status');
          const data = await res.json();
          if (data.needsSetup) setNeedsSetup(true);
       } catch (e) {}
    };
    checkSetup();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      if (needsSetup) {
         const res = await fetch('/api/auth/setup-admin', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ login: loginField, password, name })
         });
         if (!res.ok) {
            const data = await res.json();
            throw new Error(data.error || 'Setup failed');
         }
         // After setup, proceed to login with same creds
         await onLogin(loginField, password);
      } else {
         await onLogin(loginField, password);
      }
    } catch (err: any) {
      setError(err.message || t('Operation failed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={`${embedded ? 'h-full min-h-0' : 'min-h-screen'} flex items-center justify-center bg-[#f5f5f0] p-4 font-serif`}>
      <div className="max-w-md w-full bg-white rounded-3xl shadow-xl overflow-hidden border border-[#5A5A40]/10">
        <div className="bg-[#5A5A40] p-8 text-white text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-white/20 mb-4 animate-pulse">
            <ShieldCheck size={32} />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">3C: Pharma</h1>
          <p className="text-white/70 mt-2 italic">
            {needsSetup ? 'Первичная настройка системы' : t('Professional Pharmacy Management')}
          </p>
        </div>
        
        <div className="p-8">
          {needsSetup && (
            <div className="mb-6 p-4 bg-amber-50 rounded-2xl border border-amber-100 flex gap-3 text-amber-700">
               <div className="shrink-0 pt-0.5"><ShieldCheck size={18}/></div>
               <p className="text-[11px] leading-relaxed uppercase tracking-widest font-bold">
                 Похоже, это первый запуск. Пожалуйста, создайте учетную запись владельца для управления аптекой.
               </p>
            </div>
          )}
          
          <form onSubmit={handleSubmit} className="space-y-6">
            {needsSetup && (
              <div className="animate-in slide-in-from-top duration-300">
                <label className="block text-sm font-medium text-[#5A5A40] mb-1 uppercase tracking-wider">ФИО Администратора</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-[#5A5A40]/20 focus:ring-2 focus:ring-[#5A5A40] focus:border-transparent outline-none transition-all"
                  placeholder="Иванов Иван Иванович"
                />
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-[#5A5A40] mb-1 uppercase tracking-wider">
                {needsSetup ? 'Логин Администратора' : t('Login')}
              </label>
              <input
                type="text"
                required
                autoComplete="username"
                value={loginField}
                onChange={(e) => setLoginField(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-[#5A5A40]/20 focus:ring-2 focus:ring-[#5A5A40] focus:border-transparent outline-none transition-all"
                placeholder={needsSetup ? "Напр. admin" : "admin"}
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-[#5A5A40] mb-1 uppercase tracking-wider">{t('Password')}</label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-[#5A5A40]/20 focus:ring-2 focus:ring-[#5A5A40] focus:border-transparent outline-none transition-all"
                placeholder="••••••••"
              />
            </div>

            {error && (
              <div className="p-3 bg-red-50 text-red-600 text-sm rounded-lg border border-red-100">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-[#5A5A40] text-white py-4 rounded-2xl font-bold uppercase tracking-widest hover:bg-[#4A4A30] transition-all flex items-center justify-center gap-2 disabled:opacity-50 shadow-lg shadow-[#5A5A40]/20 active:scale-95"
            >
              {loading ? (needsSetup ? 'Создание...' : t('Authenticating...')) : (
                <>
                  <LogIn size={20} />
                  {needsSetup ? 'Создать и войти' : t('Sign In')}
                </>
              )}
            </button>
          </form>
          
          <div className="mt-8 pt-6 border-top border-[#5A5A40]/10 text-center">
            <p className="text-xs text-[#5A5A40]/50 uppercase tracking-widest">
              {t('Secure Access Only')}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
