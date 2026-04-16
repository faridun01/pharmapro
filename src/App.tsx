import React, { Suspense, lazy } from 'react';
import { Minus, Square, X } from 'lucide-react';
import { User } from './core/domain';
import { LoginView } from './presentation/components/LoginView';
import { clearStoredAuthSession, getStoredAuthUser, loginWithPassword } from './lib/authSession';

window.pharmaproDesktop?.markRuntime?.('app-module-evaluated', {
  ts: Date.now(),
});

const AuthenticatedApp = lazy(() => import('./presentation/components/AuthenticatedApp'));

const DesktopTitlebar: React.FC<{
  controls: any;
  onClose: () => void;
}> = ({ controls, onClose }) => (
  <div className="desktop-titlebar shrink-0 flex items-center justify-between pl-3">
    <div className="app-drag min-w-0 flex-1 self-stretch" />

    <div className="desktop-titlebar__controls app-no-drag flex items-center self-stretch">
      <button
        type="button"
        onClick={() => controls.minimize()}
        className="desktop-titlebar__button"
        aria-label="Minimize window"
      >
        <Minus size={14} strokeWidth={2.2} />
      </button>
      <button
        type="button"
        onClick={() => controls.toggleMaximize()}
        className="desktop-titlebar__button"
        aria-label="Toggle maximize window"
      >
        <Square size={12} strokeWidth={2.1} />
      </button>
      <button
        type="button"
        onClick={onClose}
        className="desktop-titlebar__button desktop-titlebar__button--close"
        aria-label="Close window"
      >
        <X size={14} strokeWidth={2.2} />
      </button>
    </div>
  </div>
);

const AppLoader: React.FC<{
  label?: string;
  compact?: boolean;
}> = ({ label = 'Загрузка...', compact = false }) => (
  <div className={`${compact ? 'min-h-60' : 'h-full min-h-0'} flex items-center justify-center bg-[#f5f5f0]`}>
    <div className="flex flex-col items-center gap-3 text-center px-6">
      <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-[#5A5A40]" />
      <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#5A5A40]/55">{label}</p>
    </div>
  </div>
);

import { BootSplash } from './presentation/components/BootSplash';

const App: React.FC = () => {
  const [user, setUser] = React.useState<User | null>(() => getStoredAuthUser());
  const [showSplash, setShowSplash] = React.useState(true);
  const [status, setStatus] = React.useState('Запуск системы...');
  const [error, setError] = React.useState<string | null>(null);
  const [backingUp, setBackingUp] = React.useState(false);
  const desktopControls = window.pharmaproDesktop?.controls;
  const appStartupStartedAt = window.pharmaproDesktop?.startupStartedAt || Date.now();

  const checkHealth = React.useCallback(async () => {
    try {
      const response = await fetch('/api/health');
      const data = await response.json();
      
      if (response.ok && data.ok) {
        setStatus('База данных готова');
        return true;
      } else {
        setStatus('Инициализация базы данных...');
        if (data.database === 'disconnected') {
          // If we explicitly get a "disconnected" status, we show a descriptive error
          setError('PostgreSQL disconnected');
        }
        return false;
      }
    } catch (err) {
      setStatus('Подключение к серверу...');
      return false;
    }
  }, []);

  React.useEffect(() => {
    let polling = true;
    let attempts = 0;
    const MAX_ATTEMPTS = 30; // 30 seconds total

    const poll = async () => {
      if (!polling) return;
      
      const isHealthy = await checkHealth();
      
      if (isHealthy) {
        // Strict splash duration for premium feel: 4 seconds total from launch
        const now = Date.now();
        const elapsed = now - appStartupStartedAt;
        const remainingTime = Math.max(0, 4000 - elapsed);
        
        setTimeout(async () => {
          setShowSplash(false);
          polling = false;
          
          // Auto-login to admin page for seamless demo experience
          if (!user) {
            try {
              setStatus('Авторизация...');
              await handleLogin('admin@pharmapro.com', 'dev-password');
            } catch (err) {
              console.warn('Auto-login failed, showing login screen');
            }
          }
        }, remainingTime);
      } else {
        attempts++;
        if (attempts >= MAX_ATTEMPTS) {
          setError('Превышено время ожидания сервера. Проверьте статус PostgreSQL.');
          polling = false;
        } else {
          setTimeout(poll, 1000);
        }
      }
    };

    poll();
    return () => { polling = false; };
  }, [checkHealth, user, appStartupStartedAt]);

  const handleLogin = async (login: string, password: string) => {
    const authSession = await loginWithPassword(login, password);
    setUser(authSession.user);
  };

  const handleSignedOut = () => {
    clearStoredAuthSession();
    setUser(null);
  };

  const handleSaveConfig = async (url: string) => {
    setStatus('Применение настроек...');
    try {
      const result = await window.pharmaproDesktop?.saveDatabaseConfig(url);
      if (result?.success) {
        setStatus('Перезапуск сервера...');
        // The polling in useEffect will automatically pick up the new server
      } else {
        setError(result?.error || 'Не удалось сохранить настройки');
      }
    } catch (err) {
      setError('Ошибка IPC: Не удалось сохранить настройки');
    }
  };

  const handleSafeClose = async () => {
    if (!window.pharmaproDesktop) {
       window.close();
       return;
    }

    const today = new Date().toISOString().split('T')[0];
    const lastBackup = localStorage.getItem('pharmapro_last_backup_date');

    if (lastBackup !== today) {
       setBackingUp(true);
       try {
          const res = await (window.pharmaproDesktop as any).performBackup();
          if (res.success) {
             localStorage.setItem('pharmapro_last_backup_date', today);
          } else {
             console.error('Backup failed:', res.error);
             if (!confirm('Не удалось создать резервную копию. Продолжить закрытие?')) {
                setBackingUp(false);
                return;
             }
          }
       } catch (err) {
          console.error('Backup exception:', err);
       }
       setBackingUp(false);
    }

    window.pharmaproDesktop.controls.close();
  };

  return (
    <>
      <BootSplash 
        isVisible={showSplash} 
        statusMessage={status}
        errorMessage={error || undefined}
        onRetry={() => {
          setError(null);
          setStatus('Повторная попытка...');
          window.location.reload();
        }}
        onSaveConfig={handleSaveConfig}
      />

      {backingUp && (
        <div className="fixed inset-0 z-[1000] bg-[#151619] flex flex-col items-center justify-center text-white px-8 text-center animate-in fade-in duration-500">
          <div className="w-16 h-16 border-4 border-white/10 border-t-white rounded-full animate-spin mb-8" />
          <h2 className="text-2xl font-normal tracking-tight mb-4">Создание резервной копии</h2>
          <p className="text-sm text-white/50 max-w-sm lowercase tracking-wider leading-relaxed italic">
            Пожалуйста, не выключайте компьютер. Мы сохраняем базу данных на диск D для вашей безопасности.
          </p>
        </div>
      )}
      
      {!user ? (
        <div className="h-screen flex flex-col bg-[#f5f5f0] overflow-hidden">
          {desktopControls ? <DesktopTitlebar controls={desktopControls} onClose={handleSafeClose} /> : null}
          <div className="flex-1 min-h-0">
            <LoginView embedded={Boolean(desktopControls)} onLogin={handleLogin} />
          </div>
        </div>
      ) : (
        <Suspense fallback={<AppLoader label="Загружаем панель" />}>
          <AuthenticatedApp onSignedOut={handleSignedOut} onClose={handleSafeClose} />
        </Suspense>
      )}
    </>
  );
};

export default App;
