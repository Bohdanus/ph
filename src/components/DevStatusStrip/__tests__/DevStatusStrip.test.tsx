import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DevStatusStrip from '../DevStatusStrip.tsx';
import type {
  DurableDocumentStatus,
  DurablePresentationRecord,
  DurablePresentationStatus,
} from '../../../contexts/StoreContext.tsx';
import type { MigrationDiagnostic } from '../../../contexts/history-adapter.ts';
import type { DurableDocument } from '../../../contexts/history-model.ts';

const publishedDocument: DurableDocument = {
  documentId: 'document-1',
  documentRevision: 3,
  branchRevision: 4,
  durableRevision: 5,
  baseline: {
    frame: { x: 0, y: 0, width: 100, height: 100 },
    layers: [
      {
        id: 'visible-layer',
        name: 'Visible layer',
        isBedrock: false,
        visible: true,
        opacity: 1,
        locked: false,
        blendMode: 'source-over',
        order: 0,
        pos: { x: 0, y: 0, width: 100, height: 100 },
        source: {
          kind: 'blank',
          color: '#ffffff',
          opacity: 1,
          size: { width: 100, height: 100 },
          isBedrock: false,
        },
      },
      {
        id: 'hidden-layer',
        name: 'Hidden layer',
        isBedrock: false,
        visible: false,
        opacity: 1,
        locked: false,
        blendMode: 'source-over',
        order: 1,
        pos: { x: 0, y: 0, width: 100, height: 100 },
        source: {
          kind: 'blank',
          color: '#000000',
          opacity: 1,
          size: { width: 100, height: 100 },
          isBedrock: false,
        },
      },
    ],
    selections: { selections: [], activeSelectionId: null },
    activeLayerId: 'visible-layer',
  },
  history: [],
  cursor: -1,
};

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
      durableDocument: null as DurableDocument | null,
      documentId: 'document-1',
      documentRevision: 0,
      branchRevision: 0,
      historyIndex: 0,
      durablePresentation: {
        status: 'durable' as DurablePresentationStatus,
        cursor: null,
        reason: null,
      } as DurablePresentationRecord,
    }) as {
      durableStatus: DurableDocumentStatus;
      durableDiagnostics: readonly MigrationDiagnostic[];
      durableDocument: DurableDocument | null;
      documentId: string;
      documentRevision: number;
      branchRevision: number;
      historyIndex: number;
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
  storeState.durableDocument = null;
  storeState.documentId = 'document-1';
  storeState.documentRevision = 0;
  storeState.branchRevision = 0;
  storeState.historyIndex = 0;
  storeState.durablePresentation = {
    status: 'durable',
    cursor: null,
    reason: null,
  };
});

describe('DevStatusStrip', () => {
  it('exposes a healthy durable publication through the browser seam', () => {
    storeState.durableDocument = publishedDocument;
    storeState.documentRevision = publishedDocument.documentRevision;
    storeState.branchRevision = publishedDocument.branchRevision;
    storeState.historyIndex = 0;
    storeState.durablePresentation = { status: 'durable', cursor: -1, reason: null };

    const { container } = render(<DevStatusStrip />);

    expect(container).not.toBeEmptyDOMElement();
    const strip = screen.getByTestId('dev-status-strip');
    expect(strip).toHaveAttribute('data-presentation-status', 'durable');
    expect(strip).toHaveAttribute('data-durable-cursor', '-1');
    expect(strip).toHaveAttribute('data-durable-publication', 'document-1@rev3.branch4.history0.durable5');
    expect(strip).toHaveAttribute('data-durable-layer-ids', 'visible-layer');
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

  it('exposes the durable presentation status and cursor', () => {
    storeState.durableStatus = 'stale';
    storeState.durablePresentation = {
      status: 'durable',
      cursor: 5,
      reason: null,
    };

    render(<DevStatusStrip />);

    const strip = screen.getByTestId('dev-status-strip');
    expect(strip).toHaveAttribute('data-presentation-status', 'durable');
    expect(strip).toHaveAttribute('data-durable-cursor', '5');
    expect(strip).toHaveAttribute('data-durable-fallback-reason', '');
    const presentation = screen.getByTestId('dev-status-strip-presentation');
    expect(presentation).toHaveTextContent('Durable presentation');
  });

  it('exposes a legacy-fallback presentation with its reason and cursor', () => {
    storeState.durableStatus = 'unavailable';
    storeState.durablePresentation = {
      status: 'legacy-fallback',
      cursor: 3,
      reason: 'unsupported-source',
    };

    render(<DevStatusStrip />);

    const strip = screen.getByTestId('dev-status-strip');
    expect(strip).toHaveAttribute('data-presentation-status', 'legacy-fallback');
    expect(strip).toHaveAttribute('data-durable-cursor', '3');
    expect(strip).toHaveAttribute('data-durable-fallback-reason', 'unsupported-source');
    const presentation = screen.getByTestId('dev-status-strip-presentation');
    expect(presentation).toHaveTextContent('Legacy presentation');
  });

  it('exposes an unpublished presentation without cursor or fallback reason', () => {
    storeState.durableStatus = 'stale';
    storeState.durablePresentation = {
      status: 'unpublished',
      cursor: null,
      reason: null,
    };

    render(<DevStatusStrip />);

    const strip = screen.getByTestId('dev-status-strip');
    expect(strip).toHaveAttribute('data-presentation-status', 'unpublished');
    expect(strip).toHaveAttribute('data-durable-cursor', '');
    expect(strip).toHaveAttribute('data-durable-fallback-reason', '');
    const presentation = screen.getByTestId('dev-status-strip-presentation');
    expect(presentation).toHaveTextContent('Legacy presentation');
    expect(presentation.textContent).not.toContain('@');
    expect(presentation.textContent).not.toContain('(');
  });
});
