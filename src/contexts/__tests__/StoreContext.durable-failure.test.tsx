import { act, render } from '@testing-library/react';
import { useEffect } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { DurableConversionAttempt } from '../history-adapter.ts';
import { createDurableDocument } from '../history-adapter.ts';
import { StoreProvider, useStore, type StoreData, type StoreDispatch } from '../StoreContext.tsx';
import type { HistoryItem } from '../history-types.ts';
import type { Layer } from '../layer-types.ts';
import { OPEN_DOCUMENT_ACTION, TOOL_ACTION } from '../../util/constants.ts';

const { convertLegacyHistorySafelyMock } = vi.hoisted(() => ({
  convertLegacyHistorySafelyMock: vi.fn(),
}));

// Keep every real export and only force the conversion itself to fail, so the
// store's fail-closed boundary is exercised without stubbing the whole adapter.
vi.mock('../history-adapter.ts', async (importActual) => {
  const actual = await importActual<typeof import('../history-adapter.ts')>();
  return { ...actual, convertLegacyHistorySafely: convertLegacyHistorySafelyMock };
});

const layerId = 'layer-1';
const initialSize = { width: 400, height: 300 };
const defaultFrame = { x: 0, y: 0, width: 400, height: 300 };

function createBlankLayer(id = layerId): Layer {
  const pos = { x: 0, y: 0, width: 100, height: 80 };
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
    source: { kind: 'blank', color: '#ffffff', opacity: 1, isBedrock: false, pos },
    operations: [],
  };
}

function baselineItem(id = 'baseline'): HistoryItem {
  return {
    id,
    actionName: OPEN_DOCUMENT_ACTION,
    layerId,
    documentSource: {
      layers: { [layerId]: createBlankLayer() },
      size: initialSize,
      frame: defaultFrame,
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

function renderWithProbe() {
  const { Probe, getProbe } = createStoreProbe();
  render(
    <StoreProvider>
      <Probe />
    </StoreProvider>
  );
  return { getProbe, dispatch: () => getProbe().dispatch, store: () => getProbe().store };
}

function currentAttempt(documentId = 'mock-durable-doc'): DurableConversionAttempt {
  const document = createDurableDocument({
    documentId,
    documentRevision: 0,
    branchRevision: 0,
    durableRevision: 1,
    cursor: -1,
    baseline: {
      frame: defaultFrame,
      layers: [],
      selections: { selections: [], activeSelectionId: null },
      activeLayerId: null,
    },
    history: [],
  });
  return { status: 'current', document, diagnostics: [], legacyCursorToDurableCursor: [-1] };
}

function conversionOptions() {
  return expect.objectContaining({
    documentId: expect.any(String),
    documentRevision: expect.any(Number),
    branchRevision: expect.any(Number),
    durableRevision: expect.any(Number),
  });
}

describe('StoreContext buildDurableDocument fail-closed boundary', () => {
  it('stores an unavailable conversion-failed diagnostic when the conversion throws on a commit', () => {
    convertLegacyHistorySafelyMock.mockImplementation(() => {
      throw new Error('durable conversion exploded');
    });
    const { getProbe, dispatch } = renderWithProbe();
    const blur = toolItem('blur-edit', 'blur', { radius: 4 });

    let threw = false;
    act(() => {
      try {
        dispatch()({
          type: 'COMMIT_DOCUMENT_EDIT',
          payload: { updates: { fileName: 'edited.psd' }, historyItem: blur },
        });
      } catch {
        threw = true;
      }
    });

    expect(threw).toBe(false);
    const store = getProbe().store;
    expect(store.durableStatus).toBe('unavailable');
    expect(store.durableDocument).toBeNull();
    expect(store.durableDiagnostics).toEqual([
      { severity: 'error', code: 'conversion-failed', message: 'durable conversion exploded' },
    ]);
    // The legacy runtime state stays authoritative after a durable failure.
    expect(store.history).toEqual([blur]);
    expect(store.historyIndex).toBe(0);
    expect(store.fileName).toBe('edited.psd');
    expect(store.hasUnsavedChanges).toBe(true);
    expect(convertLegacyHistorySafelyMock).toHaveBeenCalledTimes(1);
    expect(convertLegacyHistorySafelyMock).toHaveBeenCalledWith([blur], conversionOptions());
  });

  it('fails closed on a document replacement without losing the replacement state', () => {
    convertLegacyHistorySafelyMock.mockImplementation(() => {
      throw new Error('replacement conversion exploded');
    });
    const { getProbe, dispatch } = renderWithProbe();
    const history = [baselineItem(), toolItem('blur-edit', 'blur', { radius: 4 })];

    act(() => {
      dispatch()({
        type: 'REPLACE_DOCUMENT',
        payload: {
          documentId: 'doc-failure',
          history,
          historyIndex: 1,
          updates: { fileName: 'failed.psd', totalSize: initialSize },
        },
      });
    });

    const store = getProbe().store;
    expect(store.durableStatus).toBe('unavailable');
    expect(store.durableDocument).toBeNull();
    expect(store.durableDiagnostics).toEqual([
      { severity: 'error', code: 'conversion-failed', message: 'replacement conversion exploded' },
    ]);
    expect(store.documentId).toBe('doc-failure');
    expect(store.history).toBe(history);
    expect(store.historyIndex).toBe(1);
    expect(store.fileName).toBe('failed.psd');
  });

  it('fails closed on a history replay and keeps the replayed timeline', () => {
    convertLegacyHistorySafelyMock.mockImplementation(() => {
      throw new Error('replay conversion exploded');
    });
    const { getProbe, dispatch } = renderWithProbe();
    const baseline = baselineItem();
    const blur = toolItem('blur-edit', 'blur', { radius: 4 });

    act(() => {
      dispatch()({
        type: 'APPLY_HISTORY_REPLAY',
        payload: {
          updates: { fileName: 'replayed.psd' },
          timeline: { entries: [baseline, blur], cursor: 1, branchRevision: 3 },
        },
      });
    });

    const store = getProbe().store;
    expect(store.durableStatus).toBe('unavailable');
    expect(store.durableDocument).toBeNull();
    expect(store.durableDiagnostics).toEqual([
      { severity: 'error', code: 'conversion-failed', message: 'replay conversion exploded' },
    ]);
    expect(store.history).toEqual([baseline, blur]);
    expect(store.historyIndex).toBe(1);
    expect(store.branchRevision).toBe(3);
  });

  it('stringifies a non-Error conversion failure into the diagnostic message', () => {
    convertLegacyHistorySafelyMock.mockImplementation(() => {
      // Non-Error throws reach the boundary from conversion internals.
      return (() => {
        throw { toString: () => 'conversion returned a broken promise' };
      })();
    });
    const { getProbe, dispatch } = renderWithProbe();

    act(() => {
      dispatch()({ type: 'COMMIT_DOCUMENT_EDIT', payload: { historyItem: toolItem('blur-edit', 'blur') } });
    });

    const store = getProbe().store;
    expect(store.durableStatus).toBe('unavailable');
    expect(store.durableDocument).toBeNull();
    expect(store.durableDiagnostics).toEqual([
      { severity: 'error', code: 'conversion-failed', message: 'conversion returned a broken promise' },
    ]);
  });

  it('recovers a current durable sidecar once the conversion stops throwing', () => {
    convertLegacyHistorySafelyMock.mockImplementationOnce(() => {
      throw new Error('transient conversion failure');
    });
    const { getProbe, dispatch } = renderWithProbe();

    act(() => {
      dispatch()({ type: 'COMMIT_DOCUMENT_EDIT', payload: { historyItem: toolItem('blur-edit', 'blur') } });
    });
    expect(getProbe().store.durableStatus).toBe('unavailable');

    convertLegacyHistorySafelyMock.mockImplementation(() => currentAttempt('recovered-doc'));
    act(() => {
      dispatch()({ type: 'COMMIT_DOCUMENT_EDIT', payload: { historyItem: toolItem('color-edit', 'color') } });
    });

    const store = getProbe().store;
    expect(store.durableStatus).toBe('current');
    expect(store.durableDocument?.documentId).toBe('recovered-doc');
    expect(store.durableDiagnostics).toEqual([]);
    expect(convertLegacyHistorySafelyMock).toHaveBeenCalledTimes(2);
  });

  it('passes the pending document identity and revision to the conversion, and refuses to fabricate a cursor for one it cannot map', () => {
    convertLegacyHistorySafelyMock.mockImplementation(() => currentAttempt('doc-options'));
    const { getProbe, dispatch } = renderWithProbe();
    const history = [baselineItem(), toolItem('blur-edit', 'blur', { radius: 4 })];

    act(() => {
      dispatch()({
        type: 'REPLACE_DOCUMENT',
        payload: { documentId: 'doc-options', history, historyIndex: 1, updates: { totalSize: initialSize } },
      });
    });

    expect(convertLegacyHistorySafelyMock).toHaveBeenCalledWith(history, {
      documentId: 'doc-options',
      documentRevision: 1,
      branchRevision: 0,
      durableRevision: 1,
      initialSize: { width: 400, height: 300 },
      initialFrame: defaultFrame,
    });
    const store = getProbe().store;
    expect(store.durableStatus).toBe('current');

    // The cursor half of what this test used to claim. `currentAttempt` returns a
    // one-entry `legacyCursorToDurableCursor` and the replacement names
    // `historyIndex: 1`, so the lookup is past the end of the map. Reading that as
    // anything other than "no durable position" is the defect this pins: a fallback
    // to `history.length - 1` would place the shadow at the TIM TIP, and a silent
    // `undefined` would publish an unusable cursor. Both leave every other
    // assertion in this test green, which is why the name had to be split from it.
    expect(store.durableDocument!.cursor).toBe(-1);
    // The mapped value is the only one that could have been a position at all, so
    // the document really is at the baseline rather than merely unconvertible.
    expect(store.durableDocument!.history).toEqual([]);
  });
});
