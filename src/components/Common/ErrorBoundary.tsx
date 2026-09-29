import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useStore } from '../../contexts/StoreContext.tsx';
import type { MigrationDiagnostic } from '../../contexts/history-adapter.ts';

type ErrorBoundaryProps = {
  /**
   * Names the guarded region. A crash report that says only "something threw"
   * cannot be acted on, so the label travels into both the console entry and the
   * fallback the user is left looking at.
   */
  label: string;
  children: ReactNode;
};

type ErrorBoundaryState = {
  error: Error | null;
};

const initialState: ErrorBoundaryState = { error: null };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function diagnosticText(diagnostic: MigrationDiagnostic): string {
  const origin = diagnostic.historyId ? ` (history ${diagnostic.historyId})` : '';
  const action = diagnostic.actionName ? ` ${diagnostic.actionName}` : '';
  return `${diagnostic.severity}: ${diagnostic.code}${action}${origin} — ${diagnostic.message}`;
}

/**
 * What the region leaves behind once it has thrown: the message, and the durable
 * diagnostics the store was already holding.
 *
 * Every diagnostic is listed. A conversion that failed closed is otherwise
 * silent (see the `DurableDocumentStatus` contract in `StoreContext.tsx`), so a
 * crash screen is the one place where the reason a document was degraded is
 * still on the record — truncating the list would hide exactly the entry that
 * explains the crash.
 */
function ErrorBoundaryFallback({ label, error }: { label: string; error: Error }) {
  // A throw inside the fallback is unrecoverable: there is no boundary above this one, so React
  // tears the whole tree down and the menu and footer go with the region that failed. `StoreData`
  // types `durableDiagnostics` as required, so the real provider always supplies it — but a store
  // slice built by hand can omit it, and `DevStatusStrip` already reads the same field the
  // defensive way. Reading `.length` off `undefined` here would cost the entire app a crash
  // screen.
  const [{ durableStatus, durableDiagnostics }] = useStore();
  const diagnostics: readonly MigrationDiagnostic[] = durableDiagnostics ?? [];

  return (
    <div
      role="alert"
      data-testid="error-boundary-fallback"
      className="flex flex-col gap-2 p-4 text-sm text-red-700 dark:text-red-300"
    >
      <h2 className="text-base font-semibold">{label} stopped working</h2>
      <p data-testid="error-boundary-message">{error.message}</p>
      <p data-testid="error-boundary-durable-status">Durable document: {durableStatus}</p>
      {diagnostics.length > 0 && (
        <ul className="flex list-disc flex-col gap-1 pl-5" data-testid="error-boundary-diagnostics">
          {diagnostics.map((diagnostic, index) => (
            <li
              key={`${diagnostic.code}-${diagnostic.historyId ?? index}`}
              data-testid={`error-boundary-diagnostic-${diagnostic.code}`}
            >
              {diagnosticText(diagnostic)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Contains a throw from the subtree it guards so the rest of the editor keeps
 * running. This is the repo's first boundary; `Menu` and `Footer` deliberately
 * stay outside every one of them, because a crash that hides the menu and the
 * status strip leaves nothing to navigate with.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = initialState;

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { error: error instanceof Error ? error : new Error(errorMessage(error)) };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`Error boundary caught a throw from ${this.props.label}`, error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return <ErrorBoundaryFallback label={this.props.label} error={this.state.error} />;
    }
    // No wrapper element: the guard must be invisible to the surrounding layout.
    return this.props.children;
  }
}
