import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from '../ErrorBoundary.tsx';
import type { DurableDocumentStatus } from '../../../contexts/StoreContext.tsx';
import type { MigrationDiagnostic } from '../../../contexts/history-adapter.ts';
import { LAYER_TRANSPARENCY_ACTION, type ActionType } from '../../../util/constants.ts';

// `Partial`, not the full `StoreData`: the test below deletes `durableDiagnostics` to stand in for
// a hand-built store slice, and the property is what makes that assignment a legal expression.
const storeState = vi.hoisted(
  () =>
    ({
      durableStatus: 'unavailable' as DurableDocumentStatus,
      durableDiagnostics: [] as readonly MigrationDiagnostic[],
    }) as Partial<{ durableStatus: DurableDocumentStatus; durableDiagnostics: readonly MigrationDiagnostic[] }>
);

vi.mock('../../../contexts/StoreContext.tsx', () => ({ useStore: () => [storeState, vi.fn()] }));

// React 19 only accepts a component whose return type is `ReactNode`, and a bare
// `throw` body infers `void`. The `never` annotation states what the function
// actually does — it never returns — without changing that the throw happens.
function Thrower({ error }: { error: unknown }): never {
  throw error;
}

function reportFor(consoleError: ReturnType<typeof vi.spyOn>, label: string) {
  return consoleError.mock.calls.find(([first]: unknown[]) => first === `Error boundary caught a throw from ${label}`);
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  storeState.durableStatus = 'unavailable';
  storeState.durableDiagnostics = [];
  // React logs every error a boundary catches, before `componentDidCatch` runs.
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('ErrorBoundary happy path', () => {
  it('renders its children with no wrapper element of its own', () => {
    const { container } = render(
      <ErrorBoundary label="Canvas">
        <span data-testid="child">canvas</span>
      </ErrorBoundary>
    );

    expect(screen.getByTestId('child')).toHaveTextContent('canvas');
    // The boundary sits inside a CSS grid: an inserted wrapper element would
    // become a grid item and move the region it guards.
    expect(container.firstElementChild).toBe(screen.getByTestId('child'));
  });

  it('renders nothing extra while no error has been caught', () => {
    render(
      <ErrorBoundary label="Canvas">
        <span data-testid="child">canvas</span>
      </ErrorBoundary>
    );

    expect(screen.queryByTestId('error-boundary-fallback')).toBeNull();
  });
});

describe('ErrorBoundary catches a throw', () => {
  it('replaces the failed subtree with the fallback and keeps the rest of the tree', () => {
    const failure = new Error('tool processor exploded');
    render(
      <div>
        <span data-testid="sibling">still here</span>
        <ErrorBoundary label="Canvas">
          <Thrower error={failure} />
        </ErrorBoundary>
      </div>
    );

    expect(screen.getByTestId('error-boundary-fallback')).toBeInTheDocument();
    expect(screen.getByTestId('error-boundary-message')).toHaveTextContent('tool processor exploded');
    expect(screen.getByRole('alert')).toHaveTextContent('Canvas stopped working');
    expect(screen.getByTestId('sibling')).toBeInTheDocument();
  });

  it('keeps fallback layout styles on the failed grid region', () => {
    render(
      <ErrorBoundary label="Canvas" fallbackClassName="relative overflow-y-auto" fallbackStyle={{ gridArea: 'main' }}>
        <Thrower error={new Error('canvas context failed')} />
      </ErrorBoundary>
    );

    const fallback = screen.getByTestId('error-boundary-fallback');
    expect(fallback).toHaveClass('relative', 'overflow-y-auto');
    expect(fallback).toHaveStyle({ gridArea: 'main' });
  });

  it('reports the error and the React component stack under the boundary label', () => {
    const failure = new Error('canvas context failed');
    const consoleError = vi.mocked(console.error);

    render(
      <ErrorBoundary label="Canvas">
        <Thrower error={failure} />
      </ErrorBoundary>
    );

    const report = reportFor(consoleError, 'Canvas');
    expect(report).toBeDefined();
    expect(report?.[1]).toBe(failure);
    expect(String(report?.[2])).toContain('Thrower');
  });

  it('names the sidebar when that is the region that failed', () => {
    render(
      <ErrorBoundary label="Right sidebar">
        <Thrower error={new Error('levels preview blew up')} />
      </ErrorBoundary>
    );

    expect(reportFor(vi.mocked(console.error), 'Right sidebar')).toBeDefined();
    expect(screen.getByRole('alert')).toHaveTextContent('Right sidebar stopped working');
  });

  it('stringifies a thrown value that is not an Error', () => {
    render(
      <ErrorBoundary label="Canvas">
        <Thrower error={'unsupported source kind'} />
      </ErrorBoundary>
    );

    expect(screen.getByTestId('error-boundary-message')).toHaveTextContent('unsupported source kind');
  });
});

describe('ErrorBoundary fallback surfaces durable diagnostics', () => {
  it('reports the durable status the store is holding', () => {
    storeState.durableStatus = 'stale';

    render(
      <ErrorBoundary label="Canvas">
        <Thrower error={new Error('boom')} />
      </ErrorBoundary>
    );

    expect(screen.getByTestId('error-boundary-durable-status')).toHaveTextContent('Durable document: stale');
  });

  it('lists every diagnostic code the store holds, not a subset', () => {
    // The whole union, in one store state. A fail-closed conversion is silent
    // everywhere else, so a crash screen that dropped a code would hide the
    // reason the document was degraded.
    const codes = [
      'unsupported-history-feature',
      'document-replacement',
      'invalid-history-entry',
      'conversion-failed',
      'durable-append-mismatch',
    ] as const satisfies readonly MigrationDiagnostic['code'][];
    storeState.durableStatus = 'unavailable';
    storeState.durableDiagnostics = codes.map((code, index) => ({
      severity: index % 2 === 0 ? ('error' as const) : ('warning' as const),
      code,
      historyId: `h-${index}`,
      // `LAYER_TRANSPARENCY_ACTION` is deliberately one of the actions the
      // durable conversion does NOT translate: it is the only `ActionType` the
      // branch chain in `history-adapter.ts` has no `else if` for, so it falls
      // through to the `Unsupported legacy action` throw. Naming it here keeps
      // the fixture honest about the case it is standing in for.
      // This is intentionally outside the legal ActionType union: it models
      // a legacy diagnostic from a history shape the app no longer writes.
      actionName: LAYER_TRANSPARENCY_ACTION as unknown as ActionType,
      message: `${code} happened`,
    }));

    render(
      <ErrorBoundary label="Canvas">
        <Thrower error={new Error('boom')} />
      </ErrorBoundary>
    );

    for (const code of codes) {
      expect(screen.getByTestId(`error-boundary-diagnostic-${code}`)).toHaveTextContent(code);
    }
    expect(screen.getByTestId('error-boundary-diagnostics').children).toHaveLength(codes.length);
    expect(screen.getByTestId('error-boundary-diagnostic-conversion-failed')).toHaveTextContent(
      `warning: conversion-failed ${LAYER_TRANSPARENCY_ACTION} (history h-3) — conversion-failed happened`
    );
  });

  it('shows the error and the status when the store slice holds no diagnostic list', () => {
    // `StoreData` types `durableDiagnostics` as required, so the real provider always supplies it
    // and no other test here can reach this path — every one of them mocks `useStore` wholesale
    // with a complete slice. A slice built by hand can still omit it, and the fallback is the one
    // place a throw is unrecoverable: no boundary is above it, so reading `.length` off `undefined`
    // takes the whole tree down and leaves the user with a blank page instead of a crash screen.
    delete storeState.durableDiagnostics;

    render(
      <ErrorBoundary label="Canvas">
        <Thrower error={new Error('levels preview blew up')} />
      </ErrorBoundary>
    );

    expect(screen.getByTestId('error-boundary-message')).toHaveTextContent('levels preview blew up');
    expect(screen.getByTestId('error-boundary-durable-status')).toHaveTextContent('Durable document: unavailable');
    expect(screen.queryByTestId('error-boundary-diagnostics')).toBeNull();
  });

  it('omits the diagnostic list entirely when the store holds none', () => {
    storeState.durableStatus = 'current';
    storeState.durableDiagnostics = [];

    render(
      <ErrorBoundary label="Canvas">
        <Thrower error={new Error('boom')} />
      </ErrorBoundary>
    );

    expect(screen.getByTestId('error-boundary-durable-status')).toHaveTextContent('Durable document: current');
    expect(screen.queryByTestId('error-boundary-diagnostics')).toBeNull();
  });
});
