import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usePharmacy } from '../context';
import { LogIn, ShieldCheck } from 'lucide-react';

export const LoginView: React.FC = () => {
  const { t } = useTranslation();
  const { login } = usePharmacy();
  const [loginField, setLoginField] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await login(loginField, password);
    } catch (err: any) {
      setError(err.message || t('Login failed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f5f5f0] p-4 font-serif">
      <div className="max-w-md w-full bg-white rounded-3xl shadow-xl overflow-hidden border border-[#5A5A40]/10">
        <div className="bg-[#5A5A40] p-8 text-white text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-white/20 mb-4">
            <ShieldCheck size={32} />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">PharmaPro</h1>
          <p className="text-white/70 mt-2 italic">{t('Professional Pharmacy Management')}</p>
        </div>
        
        <div className="p-8">
          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-[#5A5A40] mb-1 uppercase tracking-wider">{t('Login')}</label>
              <input
                type="text"
                required
                autoComplete="username"
                value={loginField}
                onChange={(e) => setLoginField(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-[#5A5A40]/20 focus:ring-2 focus:ring-[#5A5A40] focus:border-transparent outline-none transition-all"
                placeholder="admin"
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
              className="w-full bg-[#5A5A40] text-white py-3 rounded-xl font-medium hover:bg-[#4A4A30] transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {loading ? t('Authenticating...') : (
                <>
                  <LogIn size={20} />
                  {t('Sign In')}
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
