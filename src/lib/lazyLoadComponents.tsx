/**
 * Lazy load React components
 * Useful for modals and feature-heavy components that aren't needed immediately
 */

import React, { lazy, Suspense } from 'react';

const RETRYABLE_LAZY_IMPORT_ERROR = /Failed to fetch dynamically imported module|Importing a module script failed|ChunkLoadError/i;

const wait = (timeoutMs: number) => new Promise<void>((resolve) => {
  window.setTimeout(resolve, timeoutMs);
});

const isRetryableLazyImportError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error || '');
  return RETRYABLE_LAZY_IMPORT_ERROR.test(message);
};

export async function retryLazyImport<TModule>(
  importer: () => Promise<TModule>,
  options: { retries?: number; delayMs?: number } = {},
) {
  const retries = options.retries ?? 2;
  const delayMs = options.delayMs ?? 300;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await importer();
    } catch (error) {
      lastError = error;
      if (attempt === retries || !isRetryableLazyImportError(error)) {
        throw error;
      }
      await wait(delayMs * (attempt + 1));
    }
  }

  throw lastError;
}

export function lazyNamedImport<
  TModule extends Record<string, unknown>,
  TKey extends keyof TModule,
>(
  importer: () => Promise<TModule>,
  exportName: TKey,
) {
  return lazy(async () => {
    const module = await retryLazyImport(importer);
    const exportedComponent = module[exportName];

    if (!exportedComponent) {
      throw new Error(`Lazy import is missing export "${String(exportName)}".`);
    }

    return {
      default: exportedComponent as React.ComponentType<any>,
    };
  });
}

/**
 * Create a lazy-loaded component with a loading fallback
 * Prevents large component bundles from loading until needed
 */
export const withLazyLoad = <P extends object>(
  Component: React.LazyExoticComponent<React.FC<P>>,
  LoadingFallback: React.FC = () => (
    <div className="flex items-center justify-center p-8">
      <div className="text-sm text-gray-500">Loading...</div>
    </div>
  )
) => {
  return (props: P) => (
    <Suspense fallback={<LoadingFallback />}>
      <Component {...props} />
    </Suspense>
  );
};

/**
 * Lazy load heavy components only when needed
 * This reduces initial bundle size significantly
 */
export const LazyImportInvoiceModal = lazy(() =>
  retryLazyImport(() => import('../presentation/components/ImportInvoiceModal')).then(m => ({
    default: m.ImportInvoiceModal,
  }))
);

export const LazyReportsView = lazy(() =>
  retryLazyImport(() => import('../presentation/components/ReportsView')).then(m => ({
    default: m.ReportsView,
  }))
);

/**
 * Higher-order component to guard against errors during lazy loading
 */
export const withErrorBoundary = <P extends object>(
  Component: React.ComponentType<P>,
  errorMessage: string = 'Failed to load component'
) => {
  return class ErrorBoundary extends React.Component<P, { hasError: boolean }> {
    constructor(props: P) {
      super(props);
      this.state = { hasError: false };
    }

    static getDerivedStateFromError() {
      return { hasError: true };
    }

    componentDidCatch(error: Error) {
      console.error(`${errorMessage}:`, error);
    }

    render() {
      if (this.state.hasError) {
        return (
          <div className="p-4 text-red-600 bg-red-50 rounded">
            {errorMessage}. Please refresh the page.
          </div>
        );
      }

      return <Component {...this.props} />;
    }
  };
};
