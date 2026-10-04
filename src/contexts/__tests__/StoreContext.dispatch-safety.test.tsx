import { act, render } from '@testing-library/react';
import { useEffect } from 'react';
import { describe, expect, it, vi } from 'vitest';

import {
  INTERCEPTED_STORE_ACTION_TYPES,
  type StoreData,
  type StoreDispatch,
  StoreProvider,
  useStore,
} from '../StoreContext.tsx';
import { deriveSetDocumentFrameEntry, type MigrationDiagnostic } from '../history-adapter.ts';
import { getAssetRegistry } from '../asset-registry.ts';
import type { DurableHistoryEntry } from '../history-model.ts';
import type { HistoryItem } from '../history-types.ts';
import type { Layer, LayersRecord } from '../layer-types.ts';
import type { DocumentFrame } from '../document-frame.ts';
import { OPEN_DOCUMENT_ACTION, SET_DOCUMENT_FRAME_ACTION } from '../../util/constants.ts';
import { createMockImageBitmap } from '../../__tests__/fixtures/canvas.ts';
import { createMockLayer } from '../../__tests__/fixtures/layer.ts';

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

function cropItem(id = 'crop-1'): HistoryItem {
  return {
    id,
    actionName: SET_DOCUMENT_FRAME_ACTION,
    layerId: 'document',
    args: { previousFrame: defaultFrame, nextFrame: croppedFrame },
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

/**
 * A document with an exact durable shadow, so the next planned append is
 * published rather than reconverted — the only state in which the fast path and
 * its fallback are distinguishable.
 */
function openDocument() {
  const probe = renderWithProbe();
  act(() => {
    probe.dispatch()({
      type: 'REPLACE_DOCUMENT',
      payload: {
        documentId: 'doc-dispatch-safety',
        history: [baselineItem({ [layerId]: layer() })],
        historyIndex: 0,
        updates: { layers: { [layerId]: layer() }, totalSize: initialSize, documentFrame: defaultFrame },
      },
    });
  });
  return probe;
}

function commitCrop(
  dispatch: StoreDispatch,
  entry: HistoryItem,
  planned: DurableHistoryEntry | null | undefined,
  diagnostics?: readonly MigrationDiagnostic[]
) {
  act(() => {
    dispatch({
      type: 'COMMIT_DOCUMENT_EDIT',
      payload: {
        updates: { documentFrame: croppedFrame, totalSize: { width: 200, height: 150 } },
        historyItem: entry,
        ...(planned === undefined ? {} : { durableEntry: planned }),
        ...(diagnostics === undefined ? {} : { durableDiagnostics: diagnostics }),
      },
    });
  });
}

function planFor(entry: HistoryItem): DurableHistoryEntry | null {
  return deriveSetDocumentFrameEntry(entry, defaultFrame);
}

function recordState(store: StoreData) {
  return {
    history: store.history.map(({ id }) => id),
    historyIndex: store.historyIndex,
    branchRevision: store.branchRevision,
    durableHistory: (store.durableDocument?.history ?? []).map(({ id }) => id),
    durableStatus: store.durableStatus,
    documentFrame: store.documentFrame,
    totalSize: store.totalSize,
  };
}

describe('the intercepted action kinds', () => {
  it('names exactly the kinds dispatchAction handles itself, once each', () => {
    // The list is what the chain in `dispatchAction` is checked against by the
    // compiler; this pins the names, so a rename is a failing test rather than a
    // kind that silently stops being intercepted.
    expect([...INTERCEPTED_STORE_ACTION_TYPES]).toEqual([
      'PROMOTE_LAYER_PRESENTATIONS',
      'ADOPT_LAYER_BITMAPS',
      'PUBLISH_RUNTIME_PRESENTATION',
      'REORDER_LAYERS',
      'COMMIT_DOCUMENT_EDIT',
      'APPLY_HISTORY_REPLAY',
      'REPLACE_DOCUMENT',
    ]);
    expect(new Set(INTERCEPTED_STORE_ACTION_TYPES).size).toBe(INTERCEPTED_STORE_ACTION_TYPES.length);
  });

  it('runs every other kind through the reducer exactly once', () => {
    const { store, dispatch } = renderWithProbe();

    act(() => {
      dispatch()({ type: 'SET_COLOR', payload: '#123456' });
    });
    const afterColor = recordState(store());
    expect(store().color).toBe('#123456');

    act(() => {
      dispatch()({ type: 'SET_TOOL_NAME', payload: 'draw' });
    });
    expect(store().toolName).toBe('draw');
    // A kind with no transition of its own, so it also proves the default does
    // not invent one: the switch has an arm for it that returns the state.
    act(() => {
      dispatch()({ type: 'SET_ORIGINAL_IMAGE', payload: true });
    });
    expect(recordState(store())).toEqual(afterColor);
    expect(store().toolName).toBe('draw');
  });

  it('refuses a runtime presentation that moves logical state instead of applying it', () => {
    // The reducer's arm applies whatever layers it is given; only the dispatcher
    // checks the invariant. So this refusal is the evidence that
    // `PUBLISH_RUNTIME_PRESENTATION` reaches its branch rather than the default.
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const { store } = openDocument();
      const stored = store().layers;
      const divergent: LayersRecord = { ...stored, 'layer-2': layer() };

      act(() => {
        store().publishRuntimePresentation(divergent);
      });

      expect(store().layers).toBe(stored);
      expect('layer-2' in store().layers).toBe(false);
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(String(errorSpy.mock.calls[0]?.[0])).toContain('Refused a runtime presentation publication');
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('registers adopted bitmaps as ownership without a transition', () => {
    const { store } = renderWithProbe();
    const before = recordState(store());
    const adopted = createMockImageBitmap();

    act(() => {
      store().adoptLayerBitmaps([adopted]);
    });

    expect(recordState(store())).toEqual(before);
    // Owned by the presentation scope, so the document still holds it open.
    expect((adopted as unknown as { close: ReturnType<typeof vi.fn> }).close).not.toHaveBeenCalled();
  });
});

describe('a planned durable append that fails after publication', () => {
  it('appends the entry once and reports the failure instead of dispatching twice', () => {
    // The publication already reached React when the transaction commits, so the
    // rebuild fallback would append the SAME entry again: two history rows, a
    // `branchRevision` of two, and one undo that appears to do nothing.
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const registry = getAssetRegistry();
    const { store, dispatch } = openDocument();
    const begin = vi.spyOn(registry, 'beginDocumentAssetTransaction').mockImplementation(() => ({
      commit: () => {
        throw new Error('the asset transaction could not commit');
      },
      rollback: () => undefined,
    }));
    try {
      const crop = cropItem();
      let thrown: unknown;
      act(() => {
        try {
          commitCrop(dispatch(), crop, planFor(crop));
        } catch (error) {
          thrown = error;
        }
      });

      expect(String(thrown)).toContain('the asset transaction could not commit');
      const after = store();
      expect(after.history.map(({ id }) => id)).toEqual(['baseline', 'crop-1']);
      expect(after.historyIndex).toBe(1);
      // One append, one revision: the rebuild fallback did not run.
      expect(after.branchRevision).toBe(1);
      expect(after.durableStatus).toBe('current');
      expect(after.durableDocument?.history.map(({ id }) => id)).toEqual(['crop-1']);
      expect(after.documentFrame).toEqual(croppedFrame);
      // The failure is reported once, by the caller: a post-publication throw is
      // not answered with a second publication.
      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      begin.mockRestore();
      errorSpy.mockRestore();
    }
  });

  it('reconciles and retires nothing twice when the publication succeeds', () => {
    // The control for the case above: with nothing throwing after the
    // publication, the transaction still commits and the document still
    // reconciles, so moving those statements out of the `try` changed no
    // bookkeeping.
    const registry = getAssetRegistry();
    const { store, dispatch } = openDocument();
    const events: string[] = [];
    const begin = vi.spyOn(registry, 'beginDocumentAssetTransaction').mockImplementation(() => ({
      commit: () => events.push('commit'),
      rollback: () => events.push('rollback'),
    }));
    const reconcile = vi.spyOn(registry, 'reconcileDocumentAssets').mockImplementation(() => {
      events.push('reconcile');
    });
    try {
      const crop = cropItem();
      commitCrop(dispatch(), crop, planFor(crop));

      expect(events).toEqual(['commit', 'reconcile']);
      expect(store().history).toHaveLength(2);
      expect(store().branchRevision).toBe(1);
    } finally {
      begin.mockRestore();
      reconcile.mockRestore();
    }
  });
});

describe('a planned durable append that fails before publication', () => {
  it('still rebuilds by conversion, appending the entry exactly once', () => {
    // The fallback the narrowed `catch` must keep: nothing has been published
    // yet, so rolling back and reconverting the whole timeline is the correct
    // answer, and the append must not be lost or doubled either.
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const registry = getAssetRegistry();
    const { store, dispatch } = openDocument();
    const rollback = vi.fn();
    const begin = vi
      .spyOn(registry, 'beginDocumentAssetTransaction')
      .mockImplementationOnce(() => {
        throw new Error('the asset registry refused the transaction');
      })
      .mockImplementation(() => ({ commit: () => undefined, rollback }));
    try {
      const crop = cropItem();
      commitCrop(dispatch(), crop, planFor(crop));

      expect(begin).toHaveBeenCalled();
      const after = store();
      expect(after.history.map(({ id }) => id)).toEqual(['baseline', 'crop-1']);
      expect(after.historyIndex).toBe(1);
      expect(after.branchRevision).toBe(1);
      // The reconversion is the fallback's own answer, and it is still exact.
      expect(after.durableStatus).toBe('current');
      expect(after.durableDocument?.history.map(({ id }) => id)).toEqual(['crop-1']);
      expect(after.documentFrame).toEqual(croppedFrame);
      expect(
        errorSpy.mock.calls.filter((call) => String(call[0]).includes('Unable to publish a planned durable append'))
      ).toHaveLength(1);
    } finally {
      begin.mockRestore();
      errorSpy.mockRestore();
    }
  });
});

describe('the durable boundary diagnostics that suppress the fast path', () => {
  it('publishes nothing planned when the boundary reports an error', () => {
    // An error diagnostic sets `publishPlanned` false, so the fast path is never
    // entered and the rebuild answer is the only one. This pins the `catch`'s
    // remaining trigger as distinct from a post-publication failure.
    const { store, dispatch } = openDocument();

    const crop = cropItem();
    commitCrop(dispatch(), crop, planFor(crop), [
      { severity: 'error', code: 'conversion-failed', message: 'the boundary refused' },
    ]);

    expect(store().history.map(({ id }) => id)).toEqual(['baseline', 'crop-1']);
    expect(store().historyIndex).toBe(1);
    expect(store().branchRevision).toBe(1);
    expect(store().durableStatus).toBe('unavailable');
    expect(store().durableDocument).toBeNull();
    expect(store().durableDiagnostics).toEqual([
      { severity: 'error', code: 'conversion-failed', message: 'the boundary refused' },
    ]);
  });
});
