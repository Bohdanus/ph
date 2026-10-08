import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DevStatusStrip from '../DevStatusStrip.tsx';
import type {
  DurableDocumentStatus,
  DurablePresentationRecord,
  DurablePresentationStatus,
} from '../../../contexts/StoreContext.tsx';
import type { MigrationDiagnostic } from '../../../contexts/history-adapter.ts';

/**
 * `import.meta.env.DEV` is substituted by Vite at transform time, so this file
 * can only ever exercise the DEV branch — the component's own guard has no
 * producer for the `false` side under the test runner. A test asserting that the
 * strip is absent in production would therefore pass vacuously, and is not
 * written; the limitation is recorded here instead, the way
 * `src/contexts/__tests__/history-utils.test.ts` records the same substitution
 * for `history-utils.ts:99`.
 *
 * The same substitution is why the production half of the split is verified by
 * reading the built bundle and not by a test: what a production build drops is
 * the whole store reader, and a jsdom run has no production build to look at.
 * What IS observable here is the other half — that the DEV branch still mounts
 * the store reader — and every assertion below depends on it, since each one
 * reads its expected text out of the store slice the reader returned.
 */

const storeState = vi.hoisted(
  () =>
    ({
      durableStatus: 'current' as DurableDocumentStatus,
      durableDiagnostics: [] as readonly MigrationDiagnostic[],
      durablePresentation: {
        status: 'durable' as DurablePresentationStatus,
        cursor: null,
        layerIds: [] as readonly string[],
        reason: null,
      } as DurablePresentationRecord,
    }) as {
      durableStatus: DurableDocumentStatus;
      durableDiagnostics: readonly MigrationDiagnostic[];
      durablePresentation: DurablePresentationRecord;
    }
);

vi.mock('../../../contexts/StoreContext.tsx', () => ({ useStore: () => [storeState, vi.fn()] }));

function diagnostic(code: MigrationDiagnostic['code'], severity: MigrationDiagnostic['severity'] = 'error') {
  return { severity, code, message: `${code} happened` };
}

beforeEach(() => {
  storeState.durableStatus = 'current';
  storeState.durableDiagnostics = [];
  storeState.durablePresentation = {
    status: 'durable',
    cursor: null,
    layerIds: [],
    reason: null,
  };
});

describe('DevStatusStrip', () => {
  it('renders nothing while the shadow is current and no diagnostic is held', () => {
    const { container } = render(<DevStatusStrip />);

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId('dev-status-strip')).toBeNull();
  });

  it.each(['stale', 'unavailable'] as const)('reports a %s shadow even with no diagnostic', (status) => {
    storeState.durableStatus = status;

    render(<DevStatusStrip />);

    expect(screen.getByTestId('dev-status-strip')).toHaveAttribute('data-status', status);
    expect(screen.getByTestId('dev-status-strip-status')).toHaveTextContent(`Durable: ${status}`);
    // A non-current status with an empty list is still something to say.
    expect(screen.queryByTestId('dev-status-strip-diagnostics')).toBeNull();
  });

  it('reports a warning diagnostic under a current shadow rather than gating on status alone', () => {
    storeState.durableStatus = 'current';
    storeState.durableDiagnostics = [diagnostic('unsupported-history-feature', 'warning')];

    render(<DevStatusStrip />);

    expect(screen.getByTestId('dev-status-strip')).toHaveAttribute('data-status', 'current');
    expect(screen.getByTestId('dev-status-strip-diagnostics')).toHaveTextContent('unsupported-history-feature');
  });

  it('lists every diagnostic code the store holds when there are few enough', () => {
    storeState.durableStatus = 'unavailable';
    storeState.durableDiagnostics = [
      diagnostic('unsupported-history-feature'),
      diagnostic('invalid-history-entry'),
      diagnostic('durable-append-mismatch'),
    ];

    render(<DevStatusStrip />);

    const list = screen.getByTestId('dev-status-strip-diagnostics');
    expect(list).toHaveTextContent('unsupported-history-feature');
    expect(list).toHaveTextContent('invalid-history-entry');
    expect(list).toHaveTextContent('durable-append-mismatch');
    expect(list.textContent).not.toContain('more');
  });

  it('caps the list at three entries and counts the rest', () => {
    storeState.durableStatus = 'unavailable';
    storeState.durableDiagnostics = [
      diagnostic('invalid-history-entry'),
      diagnostic('conversion-failed'),
      diagnostic('unsupported-history-feature'),
      diagnostic('document-replacement'),
      diagnostic('durable-append-mismatch'),
    ];

    render(<DevStatusStrip />);

    const list = screen.getByTestId('dev-status-strip-diagnostics');
    // One pathological conversion can emit a diagnostic per history entry; the
    // footer is a one-line strip and must not grow with the timeline.
    expect(list).toHaveTextContent('invalid-history-entry, conversion-failed, unsupported-history-feature');
    expect(list).toHaveTextContent('+2 more');
    expect(list.textContent).not.toContain('durable-append-mismatch');
  });

  it('exposes the durable presentation status, cursor, and layer IDs', () => {
    storeState.durableStatus = 'stale';
    storeState.durablePresentation = {
      status: 'durable',
      cursor: 5,
      layerIds: ['layer-a', 'layer-b'],
      reason: null,
    };

    render(<DevStatusStrip />);

    const strip = screen.getByTestId('dev-status-strip');
    expect(strip).toHaveAttribute('data-presentation-status', 'durable');
    expect(strip).toHaveAttribute('data-durable-cursor', '5');
    expect(strip).toHaveAttribute('data-durable-layer-ids', 'layer-a,layer-b');
    expect(strip).toHaveAttribute('data-durable-fallback-reason', '');
    const presentation = screen.getByTestId('dev-status-strip-presentation');
    expect(presentation).toHaveTextContent('Durable presentation @ 5 [layer-a, layer-b]');
  });

  it('exposes a legacy-fallback presentation with its reason, cursor, and layer IDs', () => {
    storeState.durableStatus = 'unavailable';
    storeState.durablePresentation = {
      status: 'legacy-fallback',
      cursor: 3,
      layerIds: ['foreground'],
      reason: 'unsupported-source',
    };

    render(<DevStatusStrip />);

    const strip = screen.getByTestId('dev-status-strip');
    expect(strip).toHaveAttribute('data-presentation-status', 'legacy-fallback');
    expect(strip).toHaveAttribute('data-durable-cursor', '3');
    expect(strip).toHaveAttribute('data-durable-layer-ids', 'foreground');
    expect(strip).toHaveAttribute('data-durable-fallback-reason', 'unsupported-source');
    const presentation = screen.getByTestId('dev-status-strip-presentation');
    expect(presentation).toHaveTextContent('Legacy presentation @ 3 [foreground] (unsupported-source)');
  });

  it('exposes an unpublished presentation without cursor, layer IDs, or fallback reason', () => {
    storeState.durableStatus = 'stale';
    storeState.durablePresentation = {
      status: 'unpublished',
      cursor: null,
      layerIds: [],
      reason: null,
    };

    render(<DevStatusStrip />);

    const strip = screen.getByTestId('dev-status-strip');
    expect(strip).toHaveAttribute('data-presentation-status', 'unpublished');
    expect(strip).toHaveAttribute('data-durable-cursor', '');
    expect(strip).toHaveAttribute('data-durable-layer-ids', '');
    expect(strip).toHaveAttribute('data-durable-fallback-reason', '');
    const presentation = screen.getByTestId('dev-status-strip-presentation');
    expect(presentation).toHaveTextContent('Legacy presentation');
    expect(presentation.textContent).not.toContain('@');
    expect(presentation.textContent).not.toContain('(');
  });
});
