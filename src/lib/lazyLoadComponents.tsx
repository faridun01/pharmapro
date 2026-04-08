/**
 * Lazy load React components
 * Useful for modals and feature-heavy components that aren't needed immediately
 */

import React, { lazy, Suspense } from 'react';

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
  import('../presentation/components/ImportInvoiceModal').then(m => ({
    default: m.ImportInvoiceModal,
  }))
);

export const LazyReportsView = lazy(() =>
  import('../presentation/components/ReportsView').then(m => ({
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
