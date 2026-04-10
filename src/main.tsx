import { StrictMode, lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { retryLazyImport } from './lib/lazyLoadComponents';
import { BootSplash } from './presentation/components/BootSplash';

const AppRoot = lazy(() => retryLazyImport(() => import('./AppRoot')));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense
      fallback={<BootSplash title="PharmaPro" subtitle="Запускаем приложение и загружаем интерфейс" />}
    >
      <AppRoot />
    </Suspense>
  </StrictMode>,
);
