'use client';

import React, { Component, ErrorInfo, ReactNode } from 'react';
import { logger } from '@/lib/services/logging/logger';
import { monitoring } from '@/lib/services/monitoring/monitor';
import { AppError, ErrorCode, ErrorSeverity } from '@/lib/errors/types';

interface Props {
  children: ReactNode;
  fallback?: ReactNode | ((error: Error, reset: () => void) => ReactNode);
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  isolate?: boolean; // Isolate this boundary from parent boundaries
  showDetails?: boolean; // Show error details in development
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorId: string;
}

/**
 * Error Boundary Component
 * Catches JavaScript errors in child components and displays fallback UI
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    
    this.state = {
      hasError: false,
      error: null,
      errorId: '',
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    // Update state so the next render will show the fallback UI
    const errorId = `error-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    return {
      hasError: true,
      error,
      errorId,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // Log the error to our logging service
    logger.error('React Error Boundary caught an error', error, {
      errorId: this.state.errorId,
      componentStack: errorInfo.componentStack,
      props: this.props,
    });

    // Record in monitoring
    monitoring.recordError(error, {
      source: 'react-error-boundary',
      errorId: this.state.errorId,
      componentStack: errorInfo.componentStack,
    });

    // Call custom error handler if provided
    if (this.props.onError) {
      this.props.onError(error, errorInfo);
    }

    // In production, could also send to error reporting service
    if (process.env.NODE_ENV === 'production') {
      this.reportErrorToService(error, errorInfo);
    }
  }

  private reportErrorToService(error: Error, errorInfo: ErrorInfo) {
    // This would send to Sentry, Rollbar, etc.
    // For now, just log that we would report it
    console.log('Would report error to external service:', {
      error: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
      errorId: this.state.errorId,
    });
  }

  private resetErrorBoundary = () => {
    this.setState({
      hasError: false,
      error: null,
      errorId: '',
    });
  };

  render() {
    if (this.state.hasError && this.state.error) {
      // If isolate is true, throw the error to let parent boundaries handle it
      if (this.props.isolate) {
        throw this.state.error;
      }

      // Use custom fallback if provided
      if (this.props.fallback) {
        if (typeof this.props.fallback === 'function') {
          return this.props.fallback(this.state.error, this.resetErrorBoundary);
        }
        return this.props.fallback;
      }

      // Default fallback UI
      return (
        <div className="min-h-[400px] flex items-center justify-center p-8">
          <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-6 text-center">
            <div className="mb-4">
              <svg
                className="mx-auto h-12 w-12 text-red-500"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
            </div>
            
            <h2 className="text-xl font-semibold text-gray-900 mb-2">
              Oeps! Er is iets misgegaan
            </h2>
            
            <p className="text-gray-600 mb-6">
              We hebben een onverwachte fout aangetroffen. Onze excuses voor het ongemak.
            </p>

            {/* Show error details in development */}
            {this.props.showDetails && process.env.NODE_ENV === 'development' && (
              <details className="mb-6 text-left">
                <summary className="cursor-pointer text-sm text-gray-500 hover:text-gray-700">
                  Technische details
                </summary>
                <div className="mt-2 p-3 bg-gray-100 rounded text-xs">
                  <p className="font-mono text-red-600 mb-2">
                    {this.state.error.name}: {this.state.error.message}
                  </p>
                  <pre className="whitespace-pre-wrap text-gray-700 overflow-auto max-h-48">
                    {this.state.error.stack}
                  </pre>
                  <p className="text-gray-500 mt-2">
                    Error ID: {this.state.errorId}
                  </p>
                </div>
              </details>
            )}

            <button
              onClick={this.resetErrorBoundary}
              className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-primary hover:bg-primary-dark focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary"
            >
              Probeer opnieuw
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

/**
 * Async Error Boundary Component
 * Specialized boundary for handling async errors and suspended components
 */
interface AsyncErrorBoundaryProps extends Props {
  suspenseFallback?: ReactNode;
  loadingDelay?: number;
}

interface AsyncErrorBoundaryState extends State {
  isLoading: boolean;
}

export class AsyncErrorBoundary extends Component<AsyncErrorBoundaryProps, AsyncErrorBoundaryState> {
  private loadingTimeout?: NodeJS.Timeout;

  constructor(props: AsyncErrorBoundaryProps) {
    super(props);
    
    this.state = {
      hasError: false,
      error: null,
      errorId: '',
      isLoading: false,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<AsyncErrorBoundaryState> {
    // Check if this is a promise rejection or async error
    if (error.name === 'ChunkLoadError' || error.message.includes('Loading chunk')) {
      return {
        hasError: true,
        error: new AppError(
          'Failed to load application resources. Please refresh the page.',
          ErrorCode.SERVICE_UNAVAILABLE,
          503,
          ErrorSeverity.HIGH
        ),
        errorId: `async-error-${Date.now()}`,
      };
    }

    return ErrorBoundary.getDerivedStateFromError(error);
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // Clear loading timeout if error occurred
    if (this.loadingTimeout) {
      clearTimeout(this.loadingTimeout);
    }

    // Log async-specific errors with additional context
    logger.error('Async Error Boundary caught an error', error, {
      errorId: this.state.errorId,
      componentStack: errorInfo.componentStack,
      isAsyncError: true,
      errorType: error.name,
    });

    monitoring.recordError(error, {
      source: 'async-error-boundary',
      errorId: this.state.errorId,
      componentStack: errorInfo.componentStack,
    });
  }

  componentWillUnmount() {
    if (this.loadingTimeout) {
      clearTimeout(this.loadingTimeout);
    }
  }

  render() {
    if (this.state.hasError && this.state.error) {
      // For chunk load errors, provide specific UI
      if (this.state.error.message.includes('chunk') || 
          this.state.error.message.includes('resources')) {
        return (
          <div className="min-h-[400px] flex items-center justify-center p-8">
            <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-6 text-center">
              <div className="mb-4">
                <svg
                  className="mx-auto h-12 w-12 text-yellow-500"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                  />
                </svg>
              </div>
              
              <h2 className="text-xl font-semibold text-gray-900 mb-2">
                Update Beschikbaar
              </h2>
              
              <p className="text-gray-600 mb-6">
                Er is een nieuwe versie van de applicatie beschikbaar. 
                Ververs de pagina om de laatste versie te laden.
              </p>

              <button
                onClick={() => window.location.reload()}
                className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-primary hover:bg-primary-dark focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary"
              >
                Pagina Verversen
              </button>
            </div>
          </div>
        );
      }

      // Otherwise, use parent's error handling
      return <ErrorBoundary {...this.props} />;
    }

    return (
      <React.Suspense fallback={this.props.suspenseFallback || <DefaultSuspenseFallback />}>
        {this.props.children}
      </React.Suspense>
    );
  }
}

/**
 * Default Suspense Fallback Component
 */
function DefaultSuspenseFallback() {
  return (
    <div className="flex items-center justify-center p-8">
      <div className="flex flex-col items-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mb-4"></div>
        <p className="text-gray-600">Laden...</p>
      </div>
    </div>
  );
}

/**
 * Route Error Boundary
 * Specialized boundary for route-level errors
 */
export function RouteErrorBoundary({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary
      fallback={(error, reset) => (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
          <div className="max-w-md w-full space-y-8">
            <div className="text-center">
              <h2 className="mt-6 text-3xl font-extrabold text-gray-900">
                Pagina Fout
              </h2>
              <p className="mt-2 text-sm text-gray-600">
                Er is een probleem opgetreden bij het laden van deze pagina.
              </p>
            </div>
            
            <div className="mt-8 space-y-6">
              <button
                onClick={reset}
                className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-primary hover:bg-primary-dark focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary"
              >
                Probeer opnieuw
              </button>
              
              <button
                onClick={() => window.location.href = '/'}
                className="group relative w-full flex justify-center py-2 px-4 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary"
              >
                Ga naar homepagina
              </button>
            </div>
          </div>
        </div>
      )}
      onError={(error, errorInfo) => {
        // Log route-level errors with additional context
        logger.error('Route Error Boundary caught an error', error, {
          route: window.location.pathname,
          errorInfo,
        });
      }}
    >
      {children}
    </ErrorBoundary>
  );
}