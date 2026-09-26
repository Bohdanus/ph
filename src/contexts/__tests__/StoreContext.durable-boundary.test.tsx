import { act, render } from '@testing-library/react';
import { useEffect } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { type StoreData, type StoreDispatch, StoreProvider, useStore } from '../StoreContext.tsx';
import type { HistoryItem } from '../history-types.ts';
import type { Layer } from '../layer-types.ts';
import { OPEN_DOCUMENT_ACTION, SET_DOCUMENT_FRAME_ACTION, TOOL_ACTION, type ActionType } from '../../util/constants.ts';
import type { DurableDocument, DurableOperation } from '../history-model.ts';

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
  render(
    <StoreProvider>
      <Probe />
    </StoreProvider>
  );
  return { getProbe, dispatch: () => getProbe().dispatch, store: () => getProbe().store };
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
    expect(after.durableDiagnostics[0]).toMatch(/error/);
    expect(after.durableDiagnostics[0]).toMatch(/pen/);
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
    expect(getProbe().store.durableDiagnostics[0]).toMatch(/error/);

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
    expect(store.durableDiagnostics[0]).toMatch(/Non-plain/);
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

  it('UPDATE_LAYERS does not recompute durable content (runtime-only transient)', () => {
    const { getProbe, dispatch } = renderWithProbe();

    act(() => {
      dispatch()({
        type: 'REPLACE_DOCUMENT',
        payload: {
          documentId: 'doc-mut',
          history: [baseline, blur],
          historyIndex: 1,
          updates: { totalSize: initialSize },
        },
      });
    });

    const priorDocument = getProbe().store.durableDocument;
    const priorDiagnostics = getProbe().store.durableDiagnostics;

    act(() => {
      dispatch()({
        type: 'UPDATE_LAYERS',
        payload: {},
      });
    });

    const after = getProbe().store;
    expect(after.durableDocument).toBe(priorDocument);
    expect(after.durableDiagnostics).toBe(priorDiagnostics);
  });

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
