import { act, render } from '@testing-library/react';
import { useEffect } from 'react';
import { describe, expect, it, vi } from 'vitest';

import {
  type DurableDocumentStatus,
  type StoreData,
  type StoreDispatch,
  StoreProvider,
  useStore,
} from '../StoreContext.tsx';
import type { HistoryItem } from '../history-types.ts';
import type { Layer } from '../layer-types.ts';
import { OPEN_DOCUMENT_ACTION, SET_DOCUMENT_FRAME_ACTION, TOOL_ACTION, type ActionType } from '../../util/constants.ts';
import type { DurableDocument, DurableOperation } from '../history-model.ts';
import { getAssetRegistry } from '../asset-registry.ts';

const layerId = 'layer-1';
const initialSize = { width: 400, height: 300 };
const defaultFrame = { x: 0, y: 0, width: 400, height: 300 };

function createBlankLayer(id = layerId, pos = { x: 0, y: 0, width: 100, height: 80 }): Layer {
  return {
    id,
    name: 'Layer',
    isBedrock: false,
    tmpCanvas: null,
    bitmap: null,
    visible: true,
    opacity: 1,
    locked: false,
    blendMode: 'source-over',
    order: 0,
    pos,
    source: {
      kind: 'blank',
      color: '#ffffff',
      opacity: 1,
      isBedrock: false,
      pos,
    },
    operations: [],
  };
}

function baselineItem(id = 'baseline', frame = defaultFrame): HistoryItem {
  return {
    id,
    actionName: OPEN_DOCUMENT_ACTION,
    layerId,
    documentSource: {
      layers: { [layerId]: createBlankLayer() },
      size: initialSize,
      frame,
    },
  };
}

function toolItem(id: string, toolName: string, args: Record<string, unknown> = {}): HistoryItem {
  return { id, actionName: TOOL_ACTION, layerId, args: { toolName, ...args } };
}

function createStoreProbe() {
  const probeRef: { current: { store: StoreData; dispatch: StoreDispatch } | null } = { current: null };
  const Probe = () => {
    const [store, dispatch] = useStore();
    useEffect(() => {
      probeRef.current = { store, dispatch };
    }, [store, dispatch]);
    return null;
  };
  return {
    Probe,
    getProbe: () => {
      if (!probeRef.current) throw new Error('Probe not rendered');
      return probeRef.current;
    },
    store: () => probeRef.current?.store as StoreData,
    dispatch: () => probeRef.current?.dispatch as StoreDispatch,
  };
}

function withSilencedConsole<T>(fn: () => T): T {
  const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    return fn();
  } finally {
    spy.mockRestore();
  }
}

function renderWithProbe() {
  const { Probe, getProbe } = createStoreProbe();
  const { unmount } = render(
    <StoreProvider>
      <Probe />
    </StoreProvider>
  );
  return { getProbe, unmount, dispatch: () => getProbe().dispatch, store: () => getProbe().store };
}

describe('StoreContext durable conversion boundary', () => {
  it('dispatching an unsupported tool does not throw and marks the durable state unavailable', () => {
    const { getProbe, dispatch } = renderWithProbe();

    const baseline = baselineItem();
    const blur = toolItem('blur-edit', 'blur', { radius: 4 });

    act(() => {
      dispatch()({
        type: 'REPLACE_DOCUMENT',
        payload: {
          documentId: 'doc-1',
          history: [baseline, blur],
          updates: { fileName: 'test.psd' },
        },
      });
    });

    expect(getProbe().store.durableDocument).not.toBeNull();
    expect(getProbe().store.durableDiagnostics).toHaveLength(0);

    const unsupported = toolItem('pen-edit', 'pen');

    let threw = false;
    act(() => {
      try {
        withSilencedConsole(() => {
          dispatch()({
            type: 'COMMIT_DOCUMENT_EDIT',
            payload: {
              updates: { fileName: 'edited.psd' },
              historyItem: unsupported,
            },
          });
        });
      } catch {
        threw = true;
      }
    });

    expect(threw).toBe(false);
    const after = getProbe().store;
    // The failed conversion explicitly marks the durable state unavailable
    // rather than silently presenting a partially converted document as current.
    expect(after.durableDocument).toBeNull();
    expect(after.durableStatus).toBe('unavailable');
    expect(after.durableDiagnostics).toHaveLength(1);
    expect(after.durableDiagnostics[0]).toMatchObject({
      historyId: 'pen-edit',
      actionName: TOOL_ACTION,
      severity: 'error',
      code: 'unsupported-history-feature',
    });
    expect(after.durableDiagnostics[0]?.message).toMatch(/pen/);
  });

  it('recovers durable conversion via a subsequent valid document replacement', () => {
    const { getProbe, dispatch } = renderWithProbe();

    const penEdit = toolItem('pen-edit', 'pen');

    act(() => {
      withSilencedConsole(() => {
        dispatch()({
          type: 'COMMIT_DOCUMENT_EDIT',
          payload: {
            historyItem: penEdit,
          },
        });
      });
    });

    expect(getProbe().store.durableDocument).toBeNull();
    expect(getProbe().store.durableDiagnostics[0]).toMatchObject({ severity: 'error' });
    expect(getProbe().store.durableDiagnostics[0]?.code).toBe('unsupported-history-feature');

    const cleanBaseline = baselineItem('clean-baseline');
    const blur = toolItem('blur-edit', 'blur', { radius: 4 });

    act(() => {
      dispatch()({
        type: 'REPLACE_DOCUMENT',
        payload: {
          documentId: 'doc-2',
          history: [cleanBaseline, blur],
          updates: { fileName: 'recovered.psd' },
        },
      });
    });

    const after = getProbe().store;
    expect(after.durableDocument).not.toBeNull();
    expect(after.durableDiagnostics).toHaveLength(0);
    // The new document is a fresh conversion, distinct from the null result.
    expect(after.durableDocument).not.toBeNull();
  });

  it('records a diagnostic and skips an entry with malformed non-plain arguments instead of throwing', () => {
    const { getProbe, dispatch } = renderWithProbe();

    const baseline = baselineItem();

    class FakeClass {
      value = 'not-plain';
    }

    const malformed = {
      id: 'malformed-edit',
      actionName: TOOL_ACTION as ActionType,
      layerId,
      args: { toolName: 'blur', radius: new FakeClass() as unknown as number },
    };

    let threw = false;
    act(() => {
      try {
        dispatch()({
          type: 'REPLACE_DOCUMENT',
          payload: {
            documentId: 'doc-malformed',
            history: [baseline, malformed],
            historyIndex: 1,
            updates: {},
          },
        });
      } catch {
        threw = true;
      }
    });

    expect(threw).toBe(false);
    const store = getProbe().store;
    // The malformed entry produces a diagnostic and is skipped, which marks
    // the durable state unavailable rather than presenting a partial document.
    expect(store.durableDocument).toBeNull();
    expect(store.durableStatus).toBe('unavailable');
    expect(store.durableDiagnostics).toHaveLength(1);
    expect(store.durableDiagnostics[0]).toMatchObject({
      historyId: 'malformed-edit',
      actionName: TOOL_ACTION,
      severity: 'error',
      code: 'invalid-history-entry',
    });
    expect(store.durableDiagnostics[0]?.message).toMatch(/Non-plain/);
  });
});

describe('StoreContext legacy-to-durable cursor mapping', () => {
  it('does not advance the durable cursor to the tip when the legacy cursor points at a skipped no-op entry', () => {
    const { getProbe, dispatch } = renderWithProbe();

    const baseline = baselineItem();
    const blur = toolItem('blur-edit', 'blur', { radius: 4 });
    const noop = toolItem('noop-edit', 'reposition');
    const color = toolItem('color-edit', 'color', { grayscale: 0.5 });

    act(() => {
      dispatch()({
        type: 'REPLACE_DOCUMENT',
        payload: {
          documentId: 'doc-cursor',
          history: [baseline, blur, noop, color],
          historyIndex: 2,
          updates: {},
        },
      });
    });

    const document = getProbe().store.durableDocument as DurableDocument;
    expect(document).not.toBeNull();

    // Legacy cursor is at index 2 (the no-op). The no-op is skipped during
    // conversion, so the durable history is [blur, color]. The cursor must
    // not fall back to the tip (color); it must represent the state at or
    // before the no-op, i.e. after the blur (durable index 0).
    expect(document.history).toHaveLength(2);
    const historyIds = document.history.map((entry) => entry.id);
    expect(historyIds).toEqual(['blur-edit', 'color-edit']);

    expect(historyIds).not.toContain('noop-edit');
    expect(document.cursor).toBe(0);
  });

  it('maps the cursor correctly when pointing at a disabled (retained) entry', () => {
    const { getProbe, dispatch } = renderWithProbe();

    const baseline = baselineItem();
    const blur = toolItem('blur-edit', 'blur', { radius: 4 });
    const disabledColor = { ...toolItem('color-edit', 'color', { grayscale: 0.5 }), disabled: true };
    const enabledColor = toolItem('color2-edit', 'color', { grayscale: 0.8 });

    act(() => {
      dispatch()({
        type: 'REPLACE_DOCUMENT',
        payload: {
          documentId: 'doc-disabled',
          history: [baseline, blur, disabledColor, enabledColor],
          historyIndex: 2,
          updates: {},
        },
      });
    });

    const document = getProbe().store.durableDocument as DurableDocument;
    expect(document).not.toBeNull();

    // Disabled entries ARE retained in durable history (just marked disabled).
    expect(document.history).toHaveLength(3);
    expect(document.history[1]?.enabled).toBe(false);
    // Cursor maps to the disabled entry's index, not the tip.
    expect(document.cursor).toBe(1);
  });

  it('never falls back to the durable history tip when the legacy cursor precedes a valid edit', () => {
    const { getProbe, dispatch } = renderWithProbe();

    const baseline = baselineItem();
    const first = toolItem('first-edit', 'blur', { radius: 2 });
    const second = toolItem('second-edit', 'color', { grayscale: 0.3 });

    act(() => {
      dispatch()({
        type: 'REPLACE_DOCUMENT',
        payload: {
          documentId: 'doc-before',
          history: [baseline, first, second],
          historyIndex: 1,
          updates: {},
        },
      });
    });

    const document = getProbe().store.durableDocument as DurableDocument;
    expect(document).not.toBeNull();
    expect(document.history).toHaveLength(2);
    // Cursor at legacy index 1 maps to durable index 0 (the first operation),
    // not the tip (index 1).
    expect(document.cursor).toBe(0);
  });
});

describe('StoreContext frame update ordering', () => {
  it('sees the new frame during conversion when a commit includes a crop update', () => {
    const { getProbe, dispatch } = renderWithProbe();

    const baseline = baselineItem('b1', defaultFrame);

    act(() => {
      dispatch()({
        type: 'REPLACE_DOCUMENT',
        payload: {
          documentId: 'doc-frame-base',
          history: [baseline],
          historyIndex: 0,
          updates: { totalSize: initialSize },
        },
      });
    });

    expect(getProbe().store.documentFrame).toEqual(defaultFrame);

    const cropFrame = { x: 10, y: 20, width: 200, height: 150 };
    const crop = {
      id: 'crop-edit',
      actionName: SET_DOCUMENT_FRAME_ACTION as ActionType,
      layerId: 'document',
      args: { previousFrame: defaultFrame, nextFrame: cropFrame },
    };

    act(() => {
      withSilencedConsole(() => {
        dispatch()({
          type: 'COMMIT_DOCUMENT_EDIT',
          payload: {
            updates: { documentFrame: cropFrame },
            historyItem: crop,
          },
        });
      });
    });

    const store = getProbe().store;
    // The store-level frame reflects the committed crop.
    expect(store.documentFrame).toEqual(cropFrame);
    // The durable document carries the crop operation with the new frame.
    const document = store.durableDocument as DurableDocument;
    expect(document).not.toBeNull();
    const cropOp = document.history.find(
      (
        entry
      ): entry is (typeof document.history)[number] & {
        operation: Extract<DurableOperation, { kind: 'set-document-frame' }>;
      } => entry.operation.kind === 'set-document-frame'
    );
    expect(cropOp).toBeDefined();
    expect(cropOp!.operation).toMatchObject({ kind: 'set-document-frame' });
    expect(cropOp!.operation.next).toEqual(cropFrame);
  });

  it('resets the frame when replacing a document via totalSize', () => {
    const { getProbe, dispatch } = renderWithProbe();

    const croppedFrame = { x: 10, y: 20, width: 200, height: 150 };
    const croppedBaseline = baselineItem('b-cropped', croppedFrame);

    act(() => {
      dispatch()({
        type: 'REPLACE_DOCUMENT',
        payload: {
          documentId: 'doc-cropped',
          history: [croppedBaseline],
          historyIndex: 0,
          updates: { totalSize: { width: 200, height: 150 } },
        },
      });
    });

    expect(getProbe().store.documentFrame).toEqual({ x: 0, y: 0, width: 200, height: 150 });

    const cleanBaseline = baselineItem('b-clean', defaultFrame);

    act(() => {
      dispatch()({
        type: 'REPLACE_DOCUMENT',
        payload: {
          documentId: 'doc-new',
          history: [cleanBaseline],
          historyIndex: 0,
          updates: { totalSize: initialSize },
        },
      });
    });

    const after = getProbe().store;
    expect(after.documentFrame).toEqual(defaultFrame);
    expect(after.durableDocument?.baseline.frame).toEqual(defaultFrame);
    expect(after.durableDocument?.documentId).toBe('doc-new');
  });

  it.fails('retains the previous frame when replacing a document without specifying totalSize or documentFrame', () => {
    // BUG: REPLACE_DOCUMENT falls back to currentState.documentFrame when
    // updates does not include documentFrame or totalSize. A document
    // replacement should reset the frame to the new document's baseline
    // rather than retaining the previous document's crop.
    const { getProbe, dispatch } = renderWithProbe();

    const croppedFrame = { x: 10, y: 20, width: 200, height: 150 };
    const croppedBaseline = baselineItem('b-cropped', croppedFrame);

    act(() => {
      dispatch()({
        type: 'REPLACE_DOCUMENT',
        payload: {
          documentId: 'doc-cropped',
          history: [croppedBaseline],
          historyIndex: 0,
          updates: { totalSize: { width: 200, height: 150 } },
        },
      });
    });

    expect(getProbe().store.documentFrame).toEqual({ x: 0, y: 0, width: 200, height: 150 });

    const cleanBaseline = baselineItem('b-clean', defaultFrame);

    act(() => {
      dispatch()({
        type: 'REPLACE_DOCUMENT',
        payload: {
          documentId: 'doc-new',
          history: [cleanBaseline],
          historyIndex: 0,
          updates: {},
        },
      });
    });

    const after = getProbe().store;
    // The frame should be reset to the new baseline (default), not retained.
    expect(after.documentFrame).toEqual(defaultFrame);
    expect(after.documentFrame).not.toEqual({ x: 0, y: 0, width: 200, height: 150 });
  });
});

describe('StoreContext store mutation coverage', () => {
  const baseline = baselineItem();
  const blur = toolItem('blur-edit', 'blur', { radius: 4 });

  it('BATCH_UPDATES does not recompute durable content (runtime-only transient)', () => {
    const { getProbe, dispatch } = renderWithProbe();

    act(() => {
      dispatch()({
        type: 'REPLACE_DOCUMENT',
        payload: {
          documentId: 'doc-batch',
          history: [baseline, blur],
          historyIndex: 1,
          updates: { totalSize: initialSize },
        },
      });
    });

    const priorDocument = getProbe().store.durableDocument;

    act(() => {
      dispatch()({
        type: 'BATCH_UPDATES',
        payload: { toolName: 'draw' },
      });
    });

    expect(getProbe().store.durableDocument).toBe(priorDocument);
  });

  it('SET_ACTIVE_LAYER does not recompute durable content', () => {
    const { getProbe, dispatch } = renderWithProbe();

    act(() => {
      dispatch()({
        type: 'REPLACE_DOCUMENT',
        payload: {
          documentId: 'doc-active',
          history: [baseline, blur],
          historyIndex: 1,
          updates: { totalSize: initialSize },
        },
      });
    });

    const priorDocument = getProbe().store.durableDocument;

    act(() => {
      dispatch()({
        type: 'SET_ACTIVE_LAYER',
        payload: null,
      });
    });

    expect(getProbe().store.durableDocument).toBe(priorDocument);
  });

  it('SET_TOOL_NAME does not recompute durable content', () => {
    const { getProbe, dispatch } = renderWithProbe();

    act(() => {
      dispatch()({
        type: 'REPLACE_DOCUMENT',
        payload: {
          documentId: 'doc-tool',
          history: [baseline, blur],
          historyIndex: 1,
          updates: { totalSize: initialSize },
        },
      });
    });

    const priorDocument = getProbe().store.durableDocument;

    act(() => {
      dispatch()({
        type: 'SET_TOOL_NAME',
        payload: 'draw',
      });
    });

    expect(getProbe().store.durableDocument).toBe(priorDocument);
  });
});

describe('StoreContext removed durable replay publication surface', () => {
  it('no longer exposes replayCoordinator, presentationMaterialization or getReplayRevisionToken', () => {
    const { store } = renderWithProbe();

    const value = store() as unknown as Record<string, unknown>;
    expect('replayCoordinator' in value).toBe(false);
    expect('presentationMaterialization' in value).toBe(false);
    expect('getReplayRevisionToken' in value).toBe(false);
    // The refs that survive the cutover stay available.
    expect('currentArgs' in value).toBe(true);
    expect('previewLayers' in value).toBe(true);
  });

  it('keeps the removal after document replacement and replay dispatches', () => {
    const { store, dispatch } = renderWithProbe();

    act(() => {
      dispatch()({
        type: 'REPLACE_DOCUMENT',
        payload: { documentId: 'doc-surface', history: [baselineItem()], updates: { totalSize: initialSize } },
      });
    });
    act(() => {
      dispatch()({ type: 'SET_TOOL_NAME', payload: 'draw' });
    });

    const value = store() as unknown as Record<string, unknown>;
    expect(Object.keys(value)).not.toContain('replayCoordinator');
    expect(Object.keys(value)).not.toContain('presentationMaterialization');
    expect(Object.keys(value)).not.toContain('getReplayRevisionToken');
  });
});

describe('StoreContext DurableDocumentStatus contract', () => {
  // A `Record` keyed by the union, not `satisfies DurableDocumentStatus[]`. The array form is a
  // ONE-WAY check: it rejects a member that is not in the union, but adding a fourth member to the
  // union leaves this suite silently non-exhaustive and green. Keying by the union makes that a
  // COMPILE error, which is the property the deleted exhaustiveness test only promised — and unlike
  // a `toEqual` on this object, it cannot be satisfied by editing the expectation to match.
  const ALL_STATUSES: Record<DurableDocumentStatus, true> = { current: true, stale: true, unavailable: true };
  const statuses = Object.keys(ALL_STATUSES) as DurableDocumentStatus[];

  it.each(statuses)('stores structured diagnostics for the %s status', (status) => {
    const { getProbe, dispatch } = renderWithProbe();

    act(() => {
      dispatch()({
        type: 'SET_DURABLE_STATUS',
        payload: {
          status,
          diagnostics: [{ severity: 'error', code: 'conversion-failed', message: `boom-${status}` }],
        },
      });
    });

    const store = getProbe().store;
    expect(store.durableStatus).toBe(status);
    expect(store.durableDiagnostics).toEqual([
      { severity: 'error', code: 'conversion-failed', message: `boom-${status}` },
    ]);
    const diagnostic = store.durableDiagnostics[0];
    expect(typeof diagnostic).toBe('object');
    expect(diagnostic?.severity).toBe('error');
    expect(diagnostic?.code).toBe('conversion-failed');
    expect(diagnostic?.message).toBe(`boom-${status}`);
  });

  it('marks a converted durable sidecar stale instead of unavailable for runtime-only edits', () => {
    const { getProbe, dispatch } = renderWithProbe();

    act(() => {
      dispatch()({
        type: 'REPLACE_DOCUMENT',
        payload: {
          documentId: 'doc-stale',
          history: [baselineItem(), toolItem('blur-edit', 'blur', { radius: 4 })],
          updates: { totalSize: initialSize },
        },
      });
    });
    expect(getProbe().store.durableStatus).toBe('current');

    // A runtime-only transient leaves the durable document in place but marks
    // the sidecar stale because runtime state moved past the conversion.
    const durableDocument = getProbe().store.durableDocument;
    act(() => {
      dispatch()({ type: 'BATCH_UPDATES', payload: { toolName: 'draw' } });
    });

    const store = getProbe().store;
    expect(store.durableStatus).toBe('stale');
    expect(store.durableDocument).toBe(durableDocument);
  });

  it('keeps unavailable rather than downgrading to stale when a selection commits after a failure', () => {
    const { getProbe, dispatch } = renderWithProbe();

    act(() => {
      dispatch()({
        type: 'COMMIT_DOCUMENT_EDIT',
        payload: { historyItem: toolItem('pen-edit', 'pen') },
      });
    });
    expect(getProbe().store.durableStatus).toBe('unavailable');

    act(() => {
      dispatch()({
        type: 'COMMIT_SELECTION',
        payload: {
          id: 'selection-1',
          geometry: 'rectangle',
          sourceTool: 'rectangular-selection',
          lifecycle: 'committed',
          isActive: true,
          pos: { x: 0, y: 0, width: 10, height: 10 },
          points: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
            { x: 0, y: 10 },
          ],
        },
      });
    });

    expect(getProbe().store.durableStatus).toBe('unavailable');
  });
});

function trackDisposals() {
  const dispose = vi.spyOn(getAssetRegistry(), 'disposeDocument');
  return {
    dispose,
    disposedIds: () => dispose.mock.calls.map(([documentId]) => documentId),
    disposalsFor: (documentId: string) => dispose.mock.calls.filter(([disposed]) => disposed === documentId).length,
    restore: () => dispose.mockRestore(),
  };
}

describe('StoreContext document replacement asset disposal', () => {
  it('disposes the previous document id when a replacement switches documents', () => {
    const { disposedIds, restore } = trackDisposals();
    try {
      const { getProbe, dispatch } = renderWithProbe();

      act(() => {
        dispatch()({
          type: 'REPLACE_DOCUMENT',
          payload: { documentId: 'doc-a', history: [baselineItem()], updates: { totalSize: initialSize } },
        });
      });

      expect(getProbe().store.documentId).toBe('doc-a');
      expect(disposedIds()).toContain('uninitialized');
      // The live document is never disposed while it is the current one.
      expect(disposedIds()).not.toContain('doc-a');
    } finally {
      restore();
    }
  });

  it('disposes each replaced document id and never the id that replaced it', () => {
    const { dispose, disposedIds, restore } = trackDisposals();
    try {
      const { getProbe, dispatch } = renderWithProbe();

      act(() => {
        dispatch()({
          type: 'REPLACE_DOCUMENT',
          payload: { documentId: 'doc-a', history: [baselineItem()], updates: { totalSize: initialSize } },
        });
      });
      dispose.mockClear();

      act(() => {
        dispatch()({
          type: 'REPLACE_DOCUMENT',
          payload: {
            documentId: 'doc-b',
            history: [baselineItem('baseline-b')],
            updates: { totalSize: initialSize },
          },
        });
      });

      expect(getProbe().store.documentId).toBe('doc-b');
      expect(disposedIds()).toContain('doc-a');
      expect(disposedIds()).not.toContain('doc-b');
    } finally {
      restore();
    }
  });

  it('releases a replaced document baseline once even when disposal is requested twice', () => {
    const registry = getAssetRegistry();
    const { dispose, disposalsFor, restore } = trackDisposals();
    try {
      const { getProbe, dispatch } = renderWithProbe();

      act(() => {
        dispatch()({
          type: 'REPLACE_DOCUMENT',
          payload: { documentId: 'doc-first', history: [baselineItem()], updates: { totalSize: initialSize } },
        });
      });
      dispose.mockClear();
      expect(registry.getDocumentGeneration('doc-first')).toBe(0);

      act(() => {
        dispatch()({
          type: 'REPLACE_DOCUMENT',
          payload: {
            documentId: 'doc-second',
            history: [baselineItem('baseline-second')],
            updates: { totalSize: initialSize },
          },
        });
      });

      expect(getProbe().store.documentId).toBe('doc-second');
      // The dispatch path releases the previous baseline and the document-keyed
      // unmount effect releases the id it closed over when the id changed, so one
      // replacement requests the release twice.
      expect(disposalsFor('doc-first')).toBe(2);
      // The registry tombstones the id, so the repeated release is a no-op.
      expect(registry.getDocumentGeneration('doc-first')).toBe(1);
    } finally {
      restore();
    }
  });

  it('disposes nothing when a replacement keeps the same document id', () => {
    const { dispose, disposedIds, restore } = trackDisposals();
    try {
      const { getProbe, dispatch } = renderWithProbe();

      act(() => {
        dispatch()({
          type: 'REPLACE_DOCUMENT',
          payload: { documentId: 'doc-same', history: [baselineItem()], updates: { totalSize: initialSize } },
        });
      });
      const afterFirst = disposedIds();
      dispose.mockClear();

      act(() => {
        dispatch()({
          type: 'REPLACE_DOCUMENT',
          payload: {
            documentId: 'doc-same',
            history: [baselineItem('baseline-again')],
            updates: { totalSize: initialSize },
          },
        });
      });

      expect(getProbe().store.documentId).toBe('doc-same');
      expect(afterFirst).toContain('uninitialized');
      expect(afterFirst).not.toContain('doc-same');
      expect(dispose).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it('does not dispose anything for a commit that keeps the current document id', () => {
    const { dispose, restore } = trackDisposals();
    try {
      const { getProbe, dispatch } = renderWithProbe();

      act(() => {
        dispatch()({
          type: 'REPLACE_DOCUMENT',
          payload: { documentId: 'doc-commit', history: [baselineItem()], updates: { totalSize: initialSize } },
        });
      });
      dispose.mockClear();

      act(() => {
        dispatch()({
          type: 'COMMIT_DOCUMENT_EDIT',
          payload: { historyItem: toolItem('blur-edit', 'blur', { radius: 4 }) },
        });
      });

      expect(getProbe().store.documentId).toBe('doc-commit');
      expect(dispose).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });
});

describe('StoreContext unmount disposal', () => {
  it('disposes the current document id on unmount exactly once', () => {
    const registry = getAssetRegistry();
    const { disposalsFor, restore } = trackDisposals();
    try {
      const { unmount, dispatch } = renderWithProbe();

      act(() => {
        dispatch()({
          type: 'REPLACE_DOCUMENT',
          payload: { documentId: 'doc-unmount', history: [baselineItem()], updates: { totalSize: initialSize } },
        });
      });
      // The live document keeps its baseline until the provider goes away.
      expect(disposalsFor('doc-unmount')).toBe(0);
      expect(registry.getDocumentGeneration('doc-unmount')).toBe(0);

      unmount();

      expect(disposalsFor('doc-unmount')).toBe(1);
      expect(registry.getDocumentGeneration('doc-unmount')).toBe(1);
    } finally {
      restore();
    }
  });

  it('does not dispose anything extra on re-render and disposes the latest id on unmount', () => {
    const { dispose, disposalsFor, restore } = trackDisposals();
    try {
      const { unmount, store, dispatch } = renderWithProbe();

      act(() => {
        dispatch()({
          type: 'REPLACE_DOCUMENT',
          payload: { documentId: 'doc-latest', history: [baselineItem()], updates: { totalSize: initialSize } },
        });
      });
      expect(store().documentId).toBe('doc-latest');
      const callsAfterReplace = dispose.mock.calls.length;

      // Unrelated re-renders keep the current id and must not dispose anything.
      act(() => {
        dispatch()({ type: 'SET_COLOR', payload: '#00ff00' });
      });
      act(() => {
        dispatch()({ type: 'SET_TOOL_NAME', payload: 'draw' });
      });
      expect(dispose.mock.calls.length).toBe(callsAfterReplace);

      unmount();

      expect(disposalsFor('doc-latest')).toBe(1);
    } finally {
      restore();
    }
  });
});

describe('StoreContext history and unsaved-change semantics', () => {
  it('REPLACE_DOCUMENT bumps the document revision, resets the branch revision and honours an explicit index', () => {
    const { getProbe, dispatch } = renderWithProbe();
    const first = baselineItem('baseline-1');
    const blur = toolItem('blur-edit', 'blur', { radius: 4 });
    const color = toolItem('color-edit', 'color', { grayscale: 0.5 });

    act(() => {
      dispatch()({
        type: 'REPLACE_DOCUMENT',
        payload: {
          documentId: 'doc-history-1',
          history: [first, blur, color],
          historyIndex: 1,
          updates: { totalSize: initialSize },
        },
      });
    });

    const afterFirst = getProbe().store;
    expect(afterFirst.documentId).toBe('doc-history-1');
    expect(afterFirst.documentRevision).toBe(1);
    expect(afterFirst.branchRevision).toBe(0);
    expect(afterFirst.history).toEqual([first, blur, color]);
    expect(afterFirst.historyIndex).toBe(1);

    act(() => {
      dispatch()({
        type: 'REPLACE_DOCUMENT',
        payload: {
          documentId: 'doc-history-2',
          history: [first, blur, color],
          updates: { totalSize: initialSize },
        },
      });
    });

    const afterSecond = getProbe().store;
    expect(afterSecond.documentRevision).toBe(2);
    expect(afterSecond.branchRevision).toBe(0);
    // Without an explicit index the cursor lands on the last entry.
    expect(afterSecond.historyIndex).toBe(2);
  });

  it('REPLACE_DOCUMENT keeps the supplied history array and does not force the unsaved flag', () => {
    const { getProbe, dispatch } = renderWithProbe();
    const history = [baselineItem('baseline-kept'), toolItem('blur-edit', 'blur', { radius: 4 })];

    act(() => {
      dispatch()({
        type: 'REPLACE_DOCUMENT',
        payload: { documentId: 'doc-kept', history, updates: { totalSize: initialSize } },
      });
    });

    expect(getProbe().store.history).toBe(history);
    expect(getProbe().store.hasUnsavedChanges).toBe(false);

    act(() => {
      dispatch()({ type: 'SET_HAS_UNSAVED_CHANGES', payload: true });
    });
    act(() => {
      dispatch()({
        type: 'REPLACE_DOCUMENT',
        payload: {
          documentId: 'doc-kept',
          history: [baselineItem('baseline-again')],
          updates: { totalSize: initialSize, hasUnsavedChanges: false },
        },
      });
    });

    const store = getProbe().store;
    expect(store.hasUnsavedChanges).toBe(false);
    expect(store.history).toHaveLength(1);
    expect(store.historyIndex).toBe(0);
  });

  it('COMMIT_DOCUMENT_EDIT appends the entry, advances the branch revision and flags unsaved changes', () => {
    const { getProbe, dispatch } = renderWithProbe();
    const baseline = baselineItem('baseline-commit');

    act(() => {
      dispatch()({
        type: 'REPLACE_DOCUMENT',
        payload: { documentId: 'doc-commit', history: [baseline], updates: { totalSize: initialSize } },
      });
    });
    expect(getProbe().store.hasUnsavedChanges).toBe(false);

    const blur = toolItem('blur-edit', 'blur', { radius: 4 });
    act(() => {
      dispatch()({
        type: 'COMMIT_DOCUMENT_EDIT',
        payload: { updates: { fileName: 'edited.psd' }, historyItem: blur },
      });
    });

    const afterEdit = getProbe().store;
    expect(afterEdit.history).toEqual([baseline, blur]);
    expect(afterEdit.historyIndex).toBe(1);
    expect(afterEdit.branchRevision).toBe(1);
    expect(afterEdit.hasUnsavedChanges).toBe(true);
    expect(afterEdit.fileName).toBe('edited.psd');
    expect(afterEdit.documentId).toBe('doc-commit');
    expect(afterEdit.documentRevision).toBe(1);
  });

  it('COMMIT_DOCUMENT_EDIT truncates a rewound branch when appending after a replay', () => {
    const { getProbe, dispatch } = renderWithProbe();
    const baseline = baselineItem('baseline-branch');
    const blur = toolItem('blur-edit', 'blur', { radius: 4 });
    const color = toolItem('color-edit', 'color', { grayscale: 0.5 });

    act(() => {
      dispatch()({
        type: 'REPLACE_DOCUMENT',
        payload: {
          documentId: 'doc-branch',
          history: [baseline, blur, color],
          historyIndex: 2,
          updates: { totalSize: initialSize },
        },
      });
    });
    expect(getProbe().store.branchRevision).toBe(0);

    act(() => {
      dispatch()({
        type: 'APPLY_HISTORY_REPLAY',
        payload: {
          updates: {},
          timeline: { entries: [baseline, blur, color], cursor: 1, branchRevision: 4 },
        },
      });
    });

    const rewound = getProbe().store;
    expect(rewound.historyIndex).toBe(1);
    expect(rewound.branchRevision).toBe(4);

    const levels = toolItem('levels-edit', 'levels', { gamma: 1.2 });
    act(() => {
      dispatch()({ type: 'COMMIT_DOCUMENT_EDIT', payload: { historyItem: levels } });
    });

    const afterBranch = getProbe().store;
    expect(afterBranch.history).toEqual([baseline, blur, levels]);
    expect(afterBranch.historyIndex).toBe(2);
    expect(afterBranch.branchRevision).toBe(5);
    expect(afterBranch.hasUnsavedChanges).toBe(true);
  });
});
