import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  /** Optional name for debugging which boundary caught the error */
  name?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Error boundary that catches React rendering errors and shows a
 * clean recovery UI instead of a white screen of death.
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error(
      `[ErrorBoundary${this.props.name ? `:${this.props.name}` : ''}]`,
      error,
      info.componentStack,
    );
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  override render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div className="flex items-center justify-center h-full min-h-[200px] p-8">
          <div className="text-center max-w-md">
            <div className="w-12 h-12 rounded-xl bg-argo-amber/10 border border-argo-amber/20 flex items-center justify-center mx-auto mb-4">
              <AlertTriangle className="h-6 w-6 text-argo-amber" />
            </div>
            <h3 className="text-base font-medium text-argo-text mb-2">
              Something went wrong
            </h3>
            <p className="text-sm text-argo-textSecondary mb-4">
              {this.state.error?.message
                ? this.state.error.message.slice(0, 200)
                : 'An unexpected error occurred. Try refreshing this section.'}
            </p>
            <button
              type="button"
              onClick={this.handleRetry}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-argo-surface border border-argo-border text-sm text-argo-text hover:border-argo-accent/40 transition-colors"
            >
              <RefreshCw className="h-3.5 w-3.5" /> Try again
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
