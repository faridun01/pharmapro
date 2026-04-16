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
  controls: NonNullable<NonNullable<(Window & {
    pharmaproDesktop?: {
      controls?: {
        minimize: () => void;
        toggleMaximize: () => void;
        close: () => void;
      };
    };
  })['pharmaproDesktop']>['controls']>;
}> = ({ controls }) => (
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
        onClick={() => controls.close()}
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
      
      {!user ? (
        <div className="h-screen flex flex-col bg-[#f5f5f0] overflow-hidden">
          {desktopControls ? <DesktopTitlebar controls={desktopControls} /> : null}
          <div className="flex-1 min-h-0">
            <LoginView embedded={Boolean(desktopControls)} onLogin={handleLogin} />
          </div>
        </div>
      ) : (
        <Suspense fallback={<AppLoader label="Загружаем панель" />}>
          <AuthenticatedApp onSignedOut={handleSignedOut} />
        </Suspense>
      )}
    </>
  );
};

export default App;
