import { act, render } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type StoreData, type StoreDispatch, StoreProvider, useStore } from '../StoreContext.tsx';
import { convertLegacyHistorySafely, deriveSetDocumentFrameEntry } from '../history-adapter.ts';
import { getAssetRegistry } from '../asset-registry.ts';
import type { HistoryItem } from '../history-types.ts';
import type { Layer, LayersRecord } from '../layer-types.ts';
import type { DocumentFrame } from '../document-frame.ts';
import { OPEN_DOCUMENT_ACTION, SET_DOCUMENT_FRAME_ACTION } from '../../util/constants.ts';
import { createMockLayer } from '../../__tests__/fixtures/layer.ts';

/**
 * The whole-timeline conversion is what a rebuild runs, and
 * `convertLegacyHistorySafely` is the only conversion `src/` performs on the
 * append path — `decideDurableAppend` plans without converting, and
 * `buildDurableDocument` is the store's sole caller. Its call count is therefore
 * the exact answer to "did this append take the planned fast path, or was a
 * whole-timeline conversion run", which is the whole subject of this file. The
 * mock delegates to the real conversion, so the counter adds the observation and
 * nothing else.
 */
vi.mock('../history-adapter.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../history-adapter.ts')>();
  return { ...actual, convertLegacyHistorySafely: vi.fn(actual.convertLegacyHistorySafely) };
});

const layerId = 'layer-1';
const initialSize = { width: 400, height: 300 };
const defaultFrame: DocumentFrame = { x: 0, y: 0, width: 400, height: 300 };
const croppedFrame: DocumentFrame = { x: 20, y: 10, width: 200, height: 150 };

function layer(): Layer {
  return {
    ...createMockLayer({ id: layerId, pos: { x: 0, y: 0, width: 400, height: 300 } }),
    source: {
      kind: 'blank',
      color: '#ffffff',
      opacity: 1,
      isBedrock: false,
      pos: { x: 0, y: 0, width: 400, height: 300 },
    },
  };
}

function baselineItem(layers: LayersRecord): HistoryItem {
  return {
    id: 'baseline',
    actionName: OPEN_DOCUMENT_ACTION,
    layerId,
    documentSource: { layers, size: initialSize, frame: defaultFrame },
  };
}

function cropItem(previous: DocumentFrame, next: DocumentFrame, id: string): HistoryItem {
  return {
    id,
    actionName: SET_DOCUMENT_FRAME_ACTION,
    layerId: 'document',
    args: { previousFrame: previous, nextFrame: next },
  };
}

function renderWithProbe() {
  const probeRef: { current: { store: StoreData; dispatch: StoreDispatch } | null } = { current: null };
  const Probe = () => {
    const [store, dispatch] = useStore();
    useEffect(() => {
      probeRef.current = { store, dispatch };
    }, [store, dispatch]);
    return null;
  };
  const { unmount } = render(
    <StoreProvider>
      <Probe />
    </StoreProvider>
  );
  return {
    unmount,
    store: () => {
      if (!probeRef.current) throw new Error('Probe not rendered');
      return probeRef.current.store;
    },
    dispatch: () => {
      if (!probeRef.current) throw new Error('Probe not rendered');
      return probeRef.current.dispatch;
    },
  };
}

function openDocument() {
  const probe = renderWithProbe();
  act(() => {
    probe.dispatch()({
      type: 'REPLACE_DOCUMENT',
      payload: {
        documentId: 'doc-1',
        history: [baselineItem({ [layerId]: layer() })],
        historyIndex: 0,
        updates: { layers: { [layerId]: layer() }, totalSize: initialSize, documentFrame: defaultFrame },
      },
    });
  });
  // The baseline replacement converts, so the counter starts from the state the
  // assertions are about rather than from the fixture's own setup. Every spy in
  // this file goes on AFTER it for the same reason: the conversion reconciles the
  // reachability set it just built, so a throwing reconcile installed first would
  // fail the fixture rather than the commit under test.
  vi.mocked(convertLegacyHistorySafely).mockClear();
  return probe;
}

function commitCrop(dispatch: StoreDispatch, entry: HistoryItem, previous: DocumentFrame, next: DocumentFrame) {
  act(() => {
    dispatch({
      type: 'COMMIT_DOCUMENT_EDIT',
      payload: {
        updates: { documentFrame: next, totalSize: { width: next.width, height: next.height } },
        historyItem: entry,
        durableEntry: deriveSetDocumentFrameEntry(entry, previous),
      },
    });
  });
}

const conversions = () => vi.mocked(convertLegacyHistorySafely).mock.calls.length;

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  // Installed for every test here, including the ones that assert nothing was
  // reported, so a stray line is a failing assertion rather than output noise.
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  consoleError.mockRestore();
});

describe('COMMIT_DOCUMENT_EDIT contains a failure raised after the planned publication', () => {
  it('keeps the published append instead of dispatching it a second time', () => {
    const { store, dispatch } = openDocument();
    const failure = new Error('reconcile refused the published reachability set');
    const reconcile = vi.spyOn(getAssetRegistry(), 'reconcileDocumentAssets').mockImplementation(() => {
      throw failure;
    });
    try {
      commitCrop(dispatch(), cropItem(defaultFrame, croppedFrame, 'crop-1'), defaultFrame, croppedFrame);

      // The append survived exactly once, on the planned document: one entry, the
      // cursor advanced by one, and the store's own frame is the crop's.
      expect(store().durableStatus).toBe('current');
      expect(store().history.map((item) => item.id)).toEqual(['baseline', 'crop-1']);
      expect(store().historyIndex).toBe(1);
      expect(store().documentFrame).toEqual(croppedFrame);
      expect(store().totalSize).toEqual({ width: 200, height: 150 });
      expect(store().durableDocument?.history.map((entry) => entry.id)).toEqual(['crop-1']);
      expect(store().durableDocument?.cursor).toBe(0);

      // The discriminator. A second dispatch would have rebuilt the whole timeline
      // through `convertLegacyHistorySafely` first, because the rebuild is the
      // only other caller of it — so a nonzero count here IS the double dispatch,
      // even though the two dispatches leave the same final state.
      expect(conversions()).toBe(0);

      // Reported once, with the error VALUE rather than a re-wrapped string, so
      // the stack the user can send is what arrives.
      expect(consoleError).toHaveBeenCalledExactlyOnceWith(
        'Unable to finalize a published durable append; the append itself is committed',
        failure
      );
      expect((consoleError.mock.calls[0][1] as Error).stack).toBe(failure.stack);
    } finally {
      reconcile.mockRestore();
    }
  });

  it('leaves the next append on the fast path too', () => {
    const { store, dispatch } = openDocument();
    const reconcile = vi.spyOn(getAssetRegistry(), 'reconcileDocumentAssets').mockImplementation(() => {
      throw new Error('reconcile refused the published reachability set');
    });
    try {
      commitCrop(dispatch(), cropItem(defaultFrame, croppedFrame, 'crop-1'), defaultFrame, croppedFrame);
      consoleError.mockClear();

      // A second crop on top of the published one. Had the first left the dispatch
      // ref and the reducer disagreeing about the document, this would fail the
      // append gate against a stale base and drop to a conversion.
      commitCrop(dispatch(), cropItem(croppedFrame, defaultFrame, 'crop-2'), croppedFrame, defaultFrame);

      expect(conversions()).toBe(0);
      expect(store().durableStatus).toBe('current');
      expect(store().history.map((item) => item.id)).toEqual(['baseline', 'crop-1', 'crop-2']);
      expect(store().durableDocument?.history.map((entry) => entry.id)).toEqual(['crop-1', 'crop-2']);
      // Exactly one report, for the second append's own failure: contained and
      // reported, not swallowed and not doubled by a rebuild's second attempt.
      expect(consoleError).toHaveBeenCalledExactlyOnceWith(
        'Unable to finalize a published durable append; the append itself is committed',
        expect.any(Error)
      );
    } finally {
      reconcile.mockRestore();
    }
  });
});

describe('COMMIT_DOCUMENT_EDIT still falls back when nothing has been published', () => {
  it('rebuilds the whole timeline when the publication cannot be prepared', () => {
    const { store, dispatch } = openDocument();
    const failure = new Error('the asset registry refused to open a transaction');
    // Once, and only the first call: opening the transaction is the first statement
    // of the fallible block and runs before anything has moved, so this is the
    // fallback's real entry point. The whole-timeline conversion the fallback then
    // runs opens one of its own, and that one succeeds — otherwise this would
    // assert that a failed conversion publishes a current document.
    const begin = vi.spyOn(getAssetRegistry(), 'beginDocumentAssetTransaction').mockImplementationOnce(() => {
      throw failure;
    });
    try {
      // Opening the transaction is the first statement of the fallible block and
      // runs before anything has moved, so this is the fallback's real entry point.
      commitCrop(dispatch(), cropItem(defaultFrame, croppedFrame, 'crop-1'), defaultFrame, croppedFrame);

      // The append is not lost: the whole-timeline conversion published it
      // instead, which is the behaviour the narrowed catch must preserve.
      expect(conversions()).toBe(1);
      expect(store().durableStatus).toBe('current');
      expect(store().history.map((item) => item.id)).toEqual(['baseline', 'crop-1']);
      expect(store().historyIndex).toBe(1);
      expect(store().documentFrame).toEqual(croppedFrame);
      expect(store().durableDocument?.history.map((entry) => entry.id)).toEqual(['crop-1']);
      expect(store().durableDocument?.cursor).toBe(0);
      expect(consoleError).toHaveBeenCalledExactlyOnceWith(
        'Unable to plan a durable append publication; rebuilding the durable document',
        failure
      );
    } finally {
      begin.mockRestore();
    }
  });
});
