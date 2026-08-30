import { Component } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { Button } from './ui/button';

/**
 * Catches render-time errors so one bad component cannot blank the whole application.
 *
 * Why this matters more here than in a typical SPA: React 19 unmounts the entire tree on an
 * uncaught render error, and this app has no router — so there is no URL to reload back into. A
 * receptionist mid-check-in gets a white screen, reloads, and lands back on the home tab having
 * lost their place, with nothing on screen ever explaining what happened.
 *
 * Two boundaries are mounted (see main.jsx and SidebarLayout.jsx). The inner one wraps only the
 * console body, so a crash in a dashboard leaves the sidebar and top bar alive and the user can
 * navigate away without reloading. The outer one is the backstop for everything else.
 *
 * This is deliberately a class component: `componentDidCatch` / `getDerivedStateFromError` have
 * no hook equivalent, and React still provides no function-component API for error boundaries.
 */
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Kept as console.error rather than a toast: the tree is already unmounted, so this is for
    // whoever opens devtools, and it preserves the component stack that the message alone loses.
    console.error('Unhandled render error:', error, info?.componentStack);
  }

  handleRetry = () => {
    // Clearing the error re-mounts the subtree. That is enough whenever the cause was transient
    // (a half-loaded fetch, a race), and costs nothing when it is not — the boundary simply
    // catches again and the user still has the Reload option below.
    this.setState({ error: null });
    this.props.onRetry?.();
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="flex min-h-[60vh] w-full items-center justify-center p-6" role="alert">
        <div className="w-full max-w-md rounded-2xl border border-rose-200 bg-surface p-8 text-center shadow-raised">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-rose-50">
            <AlertTriangle className="h-6 w-6 text-rose-500" aria-hidden="true" />
          </div>

          <h2 className="mb-2 text-lg font-semibold text-[#192534]">This screen ran into a problem</h2>
          <p className="mb-6 text-sm text-slate-500">
            Nothing you entered has been sent. You can try this screen again, or reload the app if
            the problem repeats.
          </p>

          <div className="flex justify-center gap-3">
            <Button onClick={this.handleRetry} className="bg-brand-500 hover:bg-[#67803c]">
              <RotateCcw className="mr-2 h-4 w-4" aria-hidden="true" />
              Try again
            </Button>
            <Button variant="outline" onClick={() => window.location.reload()}>
              Reload app
            </Button>
          </div>

          {/* The message is shown in development only — in production it is noise to a
              receptionist, and can disclose internals. The console keeps the full detail. */}
          {import.meta.env.DEV && (
            <pre className="mt-6 max-h-40 overflow-auto rounded-lg bg-slate-50 p-3 text-left text-meta text-slate-600">
              {String(this.state.error?.message || this.state.error)}
            </pre>
          )}
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
