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

const App: React.FC = () => {
  const [user, setUser] = React.useState<User | null>(() => getStoredAuthUser());
  const desktopControls = window.pharmaproDesktop?.controls;

  const handleLogin = async (login: string, password: string) => {
    const authSession = await loginWithPassword(login, password);
    setUser(authSession.user);
  };

  const handleSignedOut = () => {
    clearStoredAuthSession();
    setUser(null);
  };

  if (!user) {
    return (
      <div className="h-screen flex flex-col bg-[#f5f5f0] overflow-hidden">
        {desktopControls ? <DesktopTitlebar controls={desktopControls} /> : null}
        <div className="flex-1 min-h-0">
          <LoginView embedded={Boolean(desktopControls)} onLogin={handleLogin} />
        </div>
      </div>
    );
  }

  return (
    <Suspense fallback={<AppLoader label="Загружаем панель" />}>
      <AuthenticatedApp onSignedOut={handleSignedOut} />
    </Suspense>
  );
};

export default App;
