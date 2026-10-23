import { act, render, renderHook } from '@testing-library/react';
import { useEffect } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { StoreProvider, useStore, type StoreData, type StoreDispatch } from '../StoreContext.tsx';
import type { Selection } from '../general-types.ts';
import { deriveSetDocumentFrameEntry, deriveSetLayerPropertiesEntry } from '../history-adapter.ts';
import type { DurableHistoryEntry } from '../history-model.ts';
import type { HistoryItem } from '../history-types.ts';
import type { Layer } from '../layer-types.ts';
import { absoluteViewZoom, minimumSliderZoomForDocumentSize, relativeViewZoomForMagnification } from '../view-state.ts';
import {
  OPEN_DOCUMENT_ACTION,
  RENAME_LAYER_ACTION,
  SET_DOCUMENT_FRAME_ACTION,
  TOOL_ACTION,
} from '../../util/constants.ts';
import { getAssetRegistry } from '../asset-registry.ts';

const layerId = 'layer-1';
const initialSize = { width: 400, height: 300 };
const defaultFrame = { x: 0, y: 0, width: 400, height: 300 };

function makeLayer(id = layerId): Layer {
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
    presentationBounds: null,
    source: { kind: 'blank', color: '#ffffff', opacity: 1, isBedrock: true, size: { width: 100, height: 80 } },
    operations: [],
  } satisfies Layer;
}

function baselineItem(id = 'baseline'): HistoryItem {
  return {
    id,
    actionName: OPEN_DOCUMENT_ACTION,
    layerId,
    documentSource: { layers: { [layerId]: makeLayer() }, size: initialSize, frame: defaultFrame },
  };
}

function toolItem(id: string, toolName: string, args: Record<string, unknown> = {}): HistoryItem {
  return { id, actionName: TOOL_ACTION, layerId, args: { toolName, ...args } };
}

function makeSelection(id: string, overrides: Partial<Selection> = {}): Selection {
  return {
    id,
    isActive: true,
    points: [
      [
        { x: 0, y: 0 },
        { x: 4, y: 0 },
        { x: 4, y: 4 },
      ],
    ],
    pos: { x: 0, y: 0, width: 4, height: 4 },
    geometry: 'polygon',
    sourceTool: 'freehand-lasso',
    lifecycle: 'committed',
    ...overrides,
  };
}

/**
 * Reads the store from a ref updated on every committed render, so each
 * assertion observes the state React actually published, not a dispatch-time
 * projection.
 */
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
  const { unmount } = render(
    <StoreProvider>
      <Probe />
    </StoreProvider>
  );
  return { getProbe, unmount, store: () => getProbe().store, dispatch: () => getProbe().dispatch };
}

describe('StoreContext scalar and tool actions', () => {
  it('SET_HAS_IMAGE, SET_HAS_UNSAVED_CHANGES and SET_FILE_NAME publish their payload verbatim', () => {
    const { store, dispatch } = renderWithProbe();

    act(() => {
      dispatch()({ type: 'SET_HAS_IMAGE', payload: true });
    });
    expect(store().hasImage).toBe(true);
    expect(store().hasUnsavedChanges).toBe(false);

    act(() => {
      dispatch()({ type: 'SET_HAS_UNSAVED_CHANGES', payload: true });
    });
    expect(store().hasUnsavedChanges).toBe(true);

    act(() => {
      dispatch()({ type: 'SET_FILE_NAME', payload: 'painting.psd' });
    });
    expect(store().fileName).toBe('painting.psd');
  });

  it('SET_FILE_NAME accepts an empty name so the field can be cleared', () => {
    const { store, dispatch } = renderWithProbe();

    act(() => {
      dispatch()({ type: 'SET_FILE_NAME', payload: 'first.png' });
    });
    act(() => {
      dispatch()({ type: 'SET_FILE_NAME', payload: '' });
    });

    expect(store().fileName).toBe('');
  });

  it('SET_SIZE ignores an identical size and marks a converted sidecar stale on a real change', () => {
    const { getProbe, store, dispatch } = renderWithProbe();

    act(() => {
      dispatch()({ type: 'SET_DURABLE_STATUS', payload: { status: 'current', diagnostics: [] } });
    });
    expect(getProbe().store.durableStatus).toBe('current');

    act(() => {
      dispatch()({ type: 'SET_SIZE', payload: { width: 400, height: 300 } });
    });
    expect(getProbe().store.durableStatus).toBe('stale');

    act(() => {
      dispatch()({ type: 'SET_DURABLE_STATUS', payload: { status: 'current', diagnostics: [] } });
    });
    const before = getProbe().store;
    act(() => {
      dispatch()({ type: 'SET_SIZE', payload: { width: 400, height: 300 } });
    });
    // A no-op size must not even allocate a new state object.
    expect(getProbe().store).toBe(before);
    expect(getProbe().store.durableStatus).toBe('current');

    act(() => {
      dispatch()({ type: 'SET_SIZE', payload: { width: 800, height: 600 } });
    });

    expect(store().totalSize).toEqual({ width: 800, height: 600 });
    expect(store().durableStatus).toBe('stale');
  });

  it('SET_TOOL_NAME publishes the tool name without flagging unsaved changes', () => {
    const { store, dispatch } = renderWithProbe();

    act(() => {
      dispatch()({ type: 'SET_TOOL_NAME', payload: 'draw' });
    });

    expect(store().toolName).toBe('draw');
    // Selecting a tool is not a document edit, and it writes no durable input.
    expect(store().hasUnsavedChanges).toBe(false);
    expect(store().durableStatus).toBe('unavailable');
  });

  it('SET_COLOR and SET_BACKGROUND_COLOR are independent', () => {
    const { store, dispatch } = renderWithProbe();

    act(() => {
      dispatch()({ type: 'SET_COLOR', payload: '#123456' });
    });
    expect(store().color).toBe('#123456');
    expect(store().backgroundColor).toBe('#ffffff');

    act(() => {
      dispatch()({ type: 'SET_BACKGROUND_COLOR', payload: '#abcdef' });
    });
    expect(store().color).toBe('#123456');
    expect(store().backgroundColor).toBe('#abcdef');
  });
});

describe('StoreContext layer action table', () => {
  it('SET_LAYERS replaces the record and marks a converted sidecar stale', () => {
    const { getProbe, store, dispatch } = renderWithProbe();

    act(() => {
      dispatch()({ type: 'SET_DURABLE_STATUS', payload: { status: 'current', diagnostics: [] } });
    });

    const layers = { [layerId]: makeLayer() };
    act(() => {
      dispatch()({ type: 'SET_LAYERS', payload: layers });
    });

    expect(store().layers).toBe(layers);
    expect(store().durableStatus).toBe('stale');
    // A pure runtime layer swap is not a document edit.
    expect(getProbe().store.hasUnsavedChanges).toBe(false);
  });

  it('ADD_LAYERS installs the record, focuses it and flags unsaved changes', () => {
    const { getProbe, store, dispatch } = renderWithProbe();

    act(() => {
      dispatch()({ type: 'SET_DURABLE_STATUS', payload: { status: 'current', diagnostics: [] } });
    });

    const layers = { [layerId]: makeLayer() };
    act(() => {
      dispatch()({ type: 'ADD_LAYER', payload: { layers, activeLayerId: layerId } });
    });

    expect(store().layers).toBe(layers);
    expect(store().activeLayerId).toBe(layerId);
    expect(store().hasUnsavedChanges).toBe(true);
    expect(store().durableStatus).toBe('stale');
    expect(getProbe().store.durableStatus).toBe('stale');
  });

  it('COMMIT_DOCUMENT_EDIT flags unsaved changes and publishes the append against a converted sidecar', () => {
    const { getProbe, store, dispatch } = renderWithProbe();

    act(() => {
      dispatch()({
        type: 'REPLACE_DOCUMENT',
        payload: { documentId: 'doc-update', history: [baselineItem()], updates: { totalSize: initialSize } },
      });
    });
    expect(store().durableStatus).toBe('current');
    expect(store().hasUnsavedChanges).toBe(false);
    expect(store().durableDocument!.history).toHaveLength(0);

    act(() => {
      dispatch()({ type: 'COMMIT_DOCUMENT_EDIT', payload: { historyItem: toolItem('blur-edit', 'blur') } });
    });

    expect(store().hasUnsavedChanges).toBe(true);
    expect(store().history).toHaveLength(2);
    // The three document writers are the only paths that leave `stale` behind:
    // a commit either publishes the planned append or reconverts the timeline,
    // and each of those writes the status the conversion produced. The durable
    // shadow therefore stays an exact projection across a document edit.
    expect(getProbe().store.durableStatus).toBe('current');
    expect(getProbe().store.durableDocument!.history).toHaveLength(1);
  });

  it('SET_ACTIVE_LAYER ignores the already focused layer and applies a change', () => {
    const { getProbe, store, dispatch } = renderWithProbe();

    act(() => {
      dispatch()({ type: 'SET_ACTIVE_LAYER', payload: layerId });
    });
    const before = getProbe().store;

    act(() => {
      dispatch()({ type: 'SET_ACTIVE_LAYER', payload: layerId });
    });
    expect(getProbe().store).toBe(before);

    act(() => {
      dispatch()({ type: 'SET_ACTIVE_LAYER', payload: null });
    });
    expect(store().activeLayerId).toBeNull();
  });

  it('SET_ACTIVE_LAYER moves the focus without invalidating a converted sidecar', () => {
    const { store, dispatch } = renderWithProbe();

    act(() => {
      dispatch()({ type: 'SET_DURABLE_STATUS', payload: { status: 'current', diagnostics: [] } });
    });
    act(() => {
      dispatch()({ type: 'SET_ACTIVE_LAYER', payload: layerId });
    });

    expect(store().activeLayerId).toBe(layerId);
    // The durable active layer is derived from the first history entry, never
    // from `state.activeLayerId`, so focus alone cannot make the shadow
    // unfaithful and must not consume the append gate's base.
    expect(store().durableStatus).toBe('current');
  });

  it('BATCH_UPDATES applies its metadata fields and marks a converted sidecar stale', () => {
    const { store, dispatch } = renderWithProbe();

    act(() => {
      dispatch()({ type: 'SET_DURABLE_STATUS', payload: { status: 'current', diagnostics: [] } });
    });
    act(() => {
      dispatch()({
        type: 'BATCH_UPDATES',
        payload: { fileName: 'batch.psd', hasImage: true, color: '#0f0f0f' },
      });
    });

    expect(store().fileName).toBe('batch.psd');
    expect(store().hasImage).toBe(true);
    expect(store().color).toBe('#0f0f0f');
    expect(store().durableStatus).toBe('stale');
  });

  it('keeps the sidecar partial instead of downgrading to stale after a conversion diagnostic', () => {
    const { store, dispatch } = renderWithProbe();

    act(() => {
      dispatch()({ type: 'COMMIT_DOCUMENT_EDIT', payload: { historyItem: toolItem('pen-edit', 'pen') } });
    });
    expect(store().durableStatus).toBe('partial');

    act(() => {
      dispatch()({ type: 'BATCH_UPDATES', payload: { fileName: 'still-broken.psd' } });
    });

    expect(store().durableStatus).toBe('partial');
  });
});

describe('StoreContext selection action table', () => {
  it('SET_SELECTIONS derives the active selection id from the payload', () => {
    const { store, dispatch } = renderWithProbe();

    const selections = [makeSelection('a', { isActive: false }), makeSelection('b', { isActive: true })];
    act(() => {
      dispatch()({ type: 'SET_SELECTIONS', payload: selections });
    });

    expect(store().selections).toBe(selections);
    expect(store().activeSelectionId).toBe('b');
    // A payload with no active selection clears the pointer.
    act(() => {
      dispatch()({ type: 'SET_SELECTIONS', payload: [makeSelection('c', { isActive: false })] });
    });
    expect(store().activeSelectionId).toBeNull();
  });

  it('ADD_SELECTION deactivates every previous selection and defaults the geometry to polygon', () => {
    const { getProbe, store, dispatch } = renderWithProbe();

    act(() => {
      dispatch()({ type: 'SET_DURABLE_STATUS', payload: { status: 'current', diagnostics: [] } });
    });
    act(() => {
      dispatch()({ type: 'ADD_SELECTION', payload: makeSelection('first') });
    });
    act(() => {
      dispatch()({ type: 'ADD_SELECTION', payload: makeSelection('second') });
    });

    const selections = store().selections;
    expect(selections.map((selection) => selection.id)).toEqual(['first', 'second']);
    expect(selections[0]!.isActive).toBe(false);
    expect(selections[1]!.isActive).toBe(true);
    expect(store().activeSelectionId).toBe('second');
    expect(store().selectionDraft).toEqual({ status: 'idle' });
    // A selection can only enter the durable document through a
    // `SELECTION_ACTION` history entry, so appending no history means the
    // converted sidecar stays a faithful projection.
    expect(store().durableStatus).toBe('current');
    expect(getProbe().store.durableStatus).toBe('current');
  });

  it('a committed selection without geometry defaults to polygon and is always marked committed', () => {
    const { store, dispatch } = renderWithProbe();

    act(() => {
      dispatch()({
        type: 'COMMIT_SELECTION',
        payload: { id: 'bare', points: [], isActive: false, pos: { x: 0, y: 0, width: 1, height: 1 } },
      });
    });

    expect(store().selections[0]).toMatchObject({ geometry: 'polygon', lifecycle: 'committed', isActive: true });
  });

  it('UPDATE_SELECTION rewrites the matching record in place and keeps the active pointer for an active update', () => {
    const { store, dispatch } = renderWithProbe();

    act(() => {
      dispatch()({ type: 'COMMIT_SELECTION', payload: makeSelection('first') });
    });
    act(() => {
      dispatch()({ type: 'COMMIT_SELECTION', payload: makeSelection('second') });
    });

    act(() => {
      dispatch()({
        type: 'UPDATE_SELECTION',
        payload: makeSelection('first', { isActive: true, pos: { x: 9, y: 9, width: 2, height: 2 } }),
      });
    });

    const first = store().selections[0]!;
    expect(first.pos).toEqual({ x: 9, y: 9, width: 2, height: 2 });
    expect(first.lifecycle).toBe('committed');
    expect(store().activeSelectionId).toBe('first');
    expect(store().selectionDraft).toEqual({ status: 'idle' });
    // Only the addressed record changes; the sibling is untouched.
    expect(store().selections[1]!.id).toBe('second');
  });

  it('MOVE_SELECTION keeps the existing active pointer when the moved selection is not active', () => {
    const { store, dispatch } = renderWithProbe();

    act(() => {
      dispatch()({ type: 'COMMIT_SELECTION', payload: makeSelection('first') });
    });
    act(() => {
      dispatch()({ type: 'COMMIT_SELECTION', payload: makeSelection('second') });
    });
    expect(store().activeSelectionId).toBe('second');

    act(() => {
      dispatch()({
        type: 'MOVE_SELECTION',
        payload: makeSelection('first', { isActive: false, pos: { x: 1, y: 2, width: 3, height: 4 } }),
      });
    });

    expect(store().selections[0]!.pos).toEqual({ x: 1, y: 2, width: 3, height: 4 });
    expect(store().activeSelectionId).toBe('second');
  });

  it('SET_ACTIVE_SELECTION re-flags exactly one record and leaves a converted sidecar current', () => {
    const { store, dispatch } = renderWithProbe();

    act(() => {
      dispatch()({ type: 'SET_DURABLE_STATUS', payload: { status: 'current', diagnostics: [] } });
    });
    act(() => {
      dispatch()({ type: 'SET_SELECTIONS', payload: [makeSelection('a', { isActive: true }), makeSelection('b')] });
    });
    act(() => {
      dispatch()({ type: 'SET_ACTIVE_SELECTION', payload: 'b' });
    });

    expect(store().selections.map((selection) => selection.isActive)).toEqual([false, true]);
    expect(store().activeSelectionId).toBe('b');
    expect(store().durableStatus).toBe('current');

    act(() => {
      dispatch()({ type: 'SET_ACTIVE_SELECTION', payload: null });
    });
    expect(store().selections.every((selection) => selection.isActive === false)).toBe(true);
    expect(store().activeSelectionId).toBeNull();
  });

  it('START_SELECTION_DRAFT and CANCEL_SELECTION_DRAFT round-trip through the draft status', () => {
    const { getProbe, store, dispatch } = renderWithProbe();

    act(() => {
      dispatch()({ type: 'START_SELECTION_DRAFT', payload: { sourceTool: 'rectangular-selection' } });
    });
    expect(store().selectionDraft).toEqual({ status: 'draft', sourceTool: 'rectangular-selection' });

    act(() => {
      dispatch()({ type: 'CANCEL_SELECTION_DRAFT' });
    });
    expect(store().selectionDraft).toEqual({ status: 'idle' });

    // Cancelling an already idle draft is a no-op that keeps state identity.
    const before = getProbe().store;
    act(() => {
      dispatch()({ type: 'CANCEL_SELECTION_DRAFT' });
    });
    expect(getProbe().store).toBe(before);
  });

  it('SET_SELECTION_CLIPBOARD stores and clears the clipboard without touching selections', () => {
    const { store, dispatch } = renderWithProbe();

    const clipboard = {
      bitmap: { width: 2, height: 2, close: vi.fn() } as unknown as ImageBitmap,
      copiedAt: 7,
      name: 'Selection copy',
      pos: { x: 0, y: 0, width: 2, height: 2 },
      sourceSelectionId: 'a',
    };
    act(() => {
      dispatch()({ type: 'SET_SELECTION_CLIPBOARD', payload: clipboard });
    });
    expect(store().selectionClipboard).toBe(clipboard);

    act(() => {
      dispatch()({ type: 'SET_SELECTION_CLIPBOARD', payload: null });
    });
    expect(store().selectionClipboard).toBeNull();
  });

  it('MARK_SELECTION_COPIED increments copiedAtVersion from 0 for a selection with no metadata', () => {
    const { store, dispatch } = renderWithProbe();

    act(() => {
      dispatch()({ type: 'COMMIT_SELECTION', payload: makeSelection('a') });
    });
    expect(store().selections[0]!.metadata).toBeUndefined();

    act(() => {
      dispatch()({ type: 'MARK_SELECTION_COPIED', payload: { id: 'a' } });
    });
    expect(store().selections[0]!.metadata).toEqual({ copiedAtVersion: 1 });

    act(() => {
      dispatch()({ type: 'MARK_SELECTION_COPIED', payload: { id: 'a' } });
    });
    expect(store().selections[0]!.metadata).toEqual({ copiedAtVersion: 2 });
  });

  it('MARK_SELECTION_COPIED preserves unrelated metadata and ignores unknown ids', () => {
    const { store, dispatch } = renderWithProbe();

    act(() => {
      dispatch()({
        type: 'COMMIT_SELECTION',
        payload: makeSelection('a', { metadata: { featherRadius: 4, copiedAtVersion: 3 } }),
      });
    });
    act(() => {
      dispatch()({ type: 'MARK_SELECTION_COPIED', payload: { id: 'missing' } });
    });
    expect(store().selections[0]!.metadata).toEqual({ featherRadius: 4, copiedAtVersion: 3 });

    act(() => {
      dispatch()({ type: 'MARK_SELECTION_COPIED', payload: { id: 'a' } });
    });
    expect(store().selections[0]!.metadata).toEqual({ featherRadius: 4, copiedAtVersion: 4 });
  });

  it('CLEAR_SELECTIONS versions the cleared marker monotonically', () => {
    const { store, dispatch } = renderWithProbe();

    expect(store().selectionCleared).toBeNull();

    act(() => {
      dispatch()({ type: 'COMMIT_SELECTION', payload: makeSelection('a') });
    });
    act(() => {
      dispatch()({ type: 'CLEAR_SELECTIONS' });
    });
    expect(store().selections).toEqual([]);
    expect(store().activeSelectionId).toBeNull();
    expect(store().selectionDraft).toEqual({ status: 'idle' });
    expect(store().selectionCleared).toEqual({ status: 'cleared', version: 1 });

    act(() => {
      dispatch()({ type: 'CLEAR_SELECTIONS' });
    });
    expect(store().selectionCleared).toEqual({ status: 'cleared', version: 2 });
  });

  it('committing a selection after a clear resets the cleared marker back to null', () => {
    const { store, dispatch } = renderWithProbe();

    act(() => {
      dispatch()({ type: 'CLEAR_SELECTIONS' });
    });
    expect(store().selectionCleared).toEqual({ status: 'cleared', version: 1 });

    act(() => {
      dispatch()({ type: 'COMMIT_SELECTION', payload: makeSelection('a') });
    });
    expect(store().selectionCleared).toBeNull();
  });

  it('a bare selection update defaults its geometry and keeps the existing active pointer', () => {
    const { store, dispatch } = renderWithProbe();

    act(() => {
      dispatch()({ type: 'COMMIT_SELECTION', payload: makeSelection('a') });
    });
    act(() => {
      dispatch()({
        type: 'UPDATE_SELECTION',
        payload: { id: 'a', points: [], isActive: false, pos: { x: 5, y: 5, width: 2, height: 2 } },
      });
    });

    expect(store().selections[0]).toMatchObject({ id: 'a', geometry: 'polygon', lifecycle: 'committed' });
    expect(store().activeSelectionId).toBe('a');
  });
});

describe('StoreContext durable staleness matrix', () => {
  /**
   * Every runtime-mutating action funnels through the same
   * `unavailable ? unavailable : stale` rule. Running them against a converted
   * sidecar proves the rule rather than just the unavailable default.
   */
  it.each([
    ['SET_SIZE', { width: 123, height: 45 }],
    ['SET_LAYERS', { [layerId]: makeLayer() }],
    ['ADD_LAYER', { layers: { [layerId]: makeLayer() }, activeLayerId: layerId }],
  ] as const)('downgrades a converted sidecar to stale for %s', (actionType, payload) => {
    const { store, dispatch } = renderWithProbe();

    act(() => {
      dispatch()({ type: 'SET_DURABLE_STATUS', payload: { status: 'current', diagnostics: [] } });
    });
    expect(store().durableStatus).toBe('current');

    act(() => {
      dispatch()({ type: actionType, payload } as never);
    });

    expect(store().durableStatus).toBe('stale');
  });

  /**
   * The counterweight to the matrix above. Every one of these writes only
   * selection state or layer focus, appends no history entry, and touches none
   * of the six inputs `buildDurableDocument` converts from. Marking any of them
   * `stale` would spend the append gate's base on a non-durable change and send
   * an ordinary crop append back to a whole-timeline reconversion.
   */
  it.each([
    ['SET_ACTIVE_LAYER', layerId],
    ['SET_SELECTIONS', [makeSelection('a')]],
    ['ADD_SELECTION', makeSelection('a')],
    ['COMMIT_SELECTION', makeSelection('a')],
    ['UPDATE_SELECTION', makeSelection('a')],
    ['MOVE_SELECTION', makeSelection('a')],
    ['SET_ACTIVE_SELECTION', 'a'],
    ['MARK_SELECTION_COPIED', { id: 'a' }],
    ['CLEAR_SELECTIONS', undefined],
  ] as const)('keeps a converted sidecar current through %s', (actionType, payload) => {
    const { store, dispatch } = renderWithProbe();

    act(() => {
      dispatch()({ type: 'SET_DURABLE_STATUS', payload: { status: 'current', diagnostics: [] } });
    });
    // A selection update needs an existing record, so seed one that every
    // branch above can address without an ordering dependency.
    act(() => {
      dispatch()({ type: 'COMMIT_SELECTION', payload: makeSelection('a') });
    });
    act(() => {
      dispatch()({ type: 'SET_DURABLE_STATUS', payload: { status: 'current', diagnostics: [] } });
    });
    expect(store().durableStatus).toBe('current');

    act(() => {
      dispatch()({ type: actionType, payload } as never);
    });

    expect(store().durableStatus).toBe('current');
  });

  it('a stale sidecar stays stale rather than degrading further', () => {
    const { store, dispatch } = renderWithProbe();

    act(() => {
      dispatch()({ type: 'SET_DURABLE_STATUS', payload: { status: 'stale', diagnostics: [] } });
    });
    // Re-pointed off CLEAR_SELECTIONS, which no longer writes the status at
    // all, so it could no longer exercise the degradation rule. SET_SIZE writes
    // `totalSize`, one of the six durable inputs, so it still does.
    act(() => {
      dispatch()({ type: 'SET_SIZE', payload: { width: 321, height: 123 } });
    });

    expect(store().durableStatus).toBe('stale');
  });
});

describe('StoreContext document frame derivation', () => {
  it.each([
    { mode: 'Fit On Screen', initialZoom: null, expectedZoom: 1 },
    { mode: 'manual zoom', initialZoom: 1.25, expectedZoom: 1.25 },
  ])(
    'preserves displayed pixel scale from $mode when a crop changes the document frame',
    ({ initialZoom, expectedZoom }) => {
      const { store, dispatch } = renderWithProbe();
      const viewport = document.createElement('div');
      viewport.getBoundingClientRect = () =>
        ({
          width: 800,
          height: 600,
          top: 0,
          left: 0,
          right: 800,
          bottom: 600,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        }) as DOMRect;
      (store().containerRef as { current: HTMLDivElement | null }).current = viewport;

      act(() => {
        dispatch()({
          type: 'REPLACE_DOCUMENT',
          payload: { documentId: 'doc-crop-zoom', history: [baselineItem()], updates: { totalSize: initialSize } },
        });
      });
      if (initialZoom !== null) act(() => store().setViewState({ zoom: initialZoom }));
      act(() => {
        dispatch()({
          type: 'COMMIT_DOCUMENT_EDIT',
          payload: {
            updates: { documentFrame: { x: 100, y: 75, width: 200, height: 150 } },
            historyItem: toolItem('crop-frame', SET_DOCUMENT_FRAME_ACTION, {
              previousFrame: defaultFrame,
              nextFrame: { x: 100, y: 75, width: 200, height: 150 },
            }),
          },
        });
      });

      expect(store().viewState.zoom).toBe(expectedZoom);
      expect(store().viewState.fitScaleCompensation).toBe(0.5);
      expect(store().viewState.fitToScreen).toBe(false);
      expect(2 * expectedZoom).toBe(4 * store().viewState.zoom * store().viewState.fitScaleCompensation);

      const cropTimeline = store().history;
      const branchRevision = store().branchRevision;
      act(() => {
        dispatch()({
          type: 'APPLY_HISTORY_REPLAY',
          payload: {
            updates: { documentFrame: defaultFrame, totalSize: initialSize },
            timeline: { entries: cropTimeline, cursor: cropTimeline.length - 2, branchRevision },
          },
        });
      });
      expect(store().viewState.zoom).toBe(expectedZoom);
      expect(store().viewState.fitScaleCompensation).toBe(1);
      expect(store().viewState.fitToScreen).toBe(false);

      act(() => {
        dispatch()({
          type: 'APPLY_HISTORY_REPLAY',
          payload: {
            updates: {
              documentFrame: { x: 100, y: 75, width: 200, height: 150 },
              totalSize: { width: 200, height: 150 },
            },
            timeline: { entries: cropTimeline, cursor: cropTimeline.length - 1, branchRevision },
          },
        });
      });
      expect(store().viewState.zoom).toBe(expectedZoom);
      expect(store().viewState.fitScaleCompensation).toBe(0.5);
      expect(store().viewState.fitToScreen).toBe(false);
    }
  );

  it('clamps a preserved manual zoom to the new one-pixel floor after a crop and keeps replay coherent', () => {
    const { store, dispatch } = renderWithProbe();
    const viewport = document.createElement('div');
    viewport.getBoundingClientRect = () =>
      ({
        width: 800,
        height: 600,
        top: 0,
        left: 0,
        right: 800,
        bottom: 600,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;
    (store().containerRef as { current: HTMLDivElement | null }).current = viewport;

    act(() => {
      dispatch()({
        type: 'REPLACE_DOCUMENT',
        payload: { documentId: 'doc-crop-zoom-floor', history: [baselineItem()], updates: { totalSize: initialSize } },
      });
    });
    const originalMinimum = minimumSliderZoomForDocumentSize(defaultFrame);
    act(() => store().setViewState({ zoom: relativeViewZoomForMagnification(originalMinimum, 2) }));
    expect(absoluteViewZoom(store().viewState, 2)).toBeCloseTo(originalMinimum);

    const historyLengthBeforeCrop = store().history.length;
    const croppedFrame = { x: 0, y: 0, width: 400, height: 200 };
    act(() => {
      dispatch()({
        type: 'COMMIT_DOCUMENT_EDIT',
        payload: {
          updates: { documentFrame: croppedFrame },
          historyItem: toolItem('crop-frame-zoom-floor', SET_DOCUMENT_FRAME_ACTION, {
            previousFrame: defaultFrame,
            nextFrame: croppedFrame,
          }),
        },
      });
    });

    const croppedMinimum = minimumSliderZoomForDocumentSize(croppedFrame);
    expect(absoluteViewZoom(store().viewState, 2)).toBeCloseTo(croppedMinimum);
    expect(store().viewState.fitToScreen).toBe(false);
    expect(store().viewState.minimumZoomOverride).toBeUndefined();
    expect(store().history).toHaveLength(historyLengthBeforeCrop + 1);

    const cropTimeline = store().history;
    const branchRevision = store().branchRevision;
    act(() => {
      dispatch()({
        type: 'APPLY_HISTORY_REPLAY',
        payload: {
          updates: { documentFrame: defaultFrame, totalSize: initialSize },
          timeline: { entries: cropTimeline, cursor: cropTimeline.length - 2, branchRevision },
        },
      });
    });
    expect(absoluteViewZoom(store().viewState, 2)).toBeCloseTo(croppedMinimum);
    expect(store().viewState.fitToScreen).toBe(false);

    act(() => {
      dispatch()({
        type: 'APPLY_HISTORY_REPLAY',
        payload: {
          updates: { documentFrame: croppedFrame, totalSize: { width: 400, height: 200 } },
          timeline: { entries: cropTimeline, cursor: cropTimeline.length - 1, branchRevision },
        },
      });
    });
    expect(absoluteViewZoom(store().viewState, 2)).toBeCloseTo(croppedMinimum);
    expect(store().viewState.fitToScreen).toBe(false);
    expect(store().history).toHaveLength(historyLengthBeforeCrop + 1);
  });

  it('preserves a subpixel Fit On Screen view when a narrow crop raises the slider floor', () => {
    const { store, dispatch } = renderWithProbe();
    const viewport = document.createElement('div');
    viewport.getBoundingClientRect = () =>
      ({
        width: 800,
        height: 600,
        top: 0,
        left: 0,
        right: 800,
        bottom: 600,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;
    (store().containerRef as { current: HTMLDivElement | null }).current = viewport;

    const openingFrame = { x: 0, y: 0, width: 200_000, height: 1_000 };
    const openingSize = { width: openingFrame.width, height: openingFrame.height };
    const openingBaseline = baselineItem('aspect-ratio-baseline');
    const croppedFrame = { x: 0, y: 0, width: 100_000, height: 1 };
    act(() => {
      dispatch()({
        type: 'REPLACE_DOCUMENT',
        payload: {
          documentId: 'doc-aspect-ratio-zoom-floor',
          history: [
            {
              ...openingBaseline,
              documentSource: {
                ...openingBaseline.documentSource!,
                size: openingSize,
                frame: openingFrame,
              },
            },
          ],
          updates: { totalSize: openingSize, documentFrame: openingFrame },
        },
      });
    });

    expect(store().viewState.fitToScreen).toBe(true);
    expect(absoluteViewZoom(store().viewState, 0.004)).toBeCloseTo(0.004);
    expect(minimumSliderZoomForDocumentSize(croppedFrame)).toBe(1);

    act(() => {
      dispatch()({
        type: 'COMMIT_DOCUMENT_EDIT',
        payload: {
          updates: { documentFrame: croppedFrame },
          historyItem: toolItem('crop-frame-aspect-ratio', SET_DOCUMENT_FRAME_ACTION, {
            previousFrame: openingFrame,
            nextFrame: croppedFrame,
          }),
        },
      });
    });

    expect(absoluteViewZoom(store().viewState, 0.008)).toBeCloseTo(0.004);
    expect(store().viewState.fitToScreen).toBe(false);
    expect(store().viewState.minimumZoomOverride).toBeCloseTo(0.004);

    const cropTimeline = store().history;
    const branchRevision = store().branchRevision;
    act(() => {
      dispatch()({
        type: 'APPLY_HISTORY_REPLAY',
        payload: {
          updates: { documentFrame: openingFrame, totalSize: openingSize },
          timeline: { entries: cropTimeline, cursor: cropTimeline.length - 2, branchRevision },
        },
      });
    });
    expect(absoluteViewZoom(store().viewState, 0.004)).toBeCloseTo(0.004);
    expect(store().viewState.minimumZoomOverride).toBeCloseTo(0.004);

    act(() => {
      dispatch()({
        type: 'APPLY_HISTORY_REPLAY',
        payload: {
          updates: {
            documentFrame: croppedFrame,
            totalSize: { width: croppedFrame.width, height: croppedFrame.height },
          },
          timeline: { entries: cropTimeline, cursor: cropTimeline.length - 1, branchRevision },
        },
      });
    });
    expect(absoluteViewZoom(store().viewState, 0.008)).toBeCloseTo(0.004);
    expect(store().viewState.minimumZoomOverride).toBeCloseTo(0.004);
    expect(store().history).toHaveLength(cropTimeline.length);
  });

  it('keeps a subpixel Fit anchor through an expanding crop and its undo/redo', () => {
    const { store, dispatch } = renderWithProbe();
    const viewport = document.createElement('div');
    viewport.getBoundingClientRect = () =>
      ({
        width: 800,
        height: 600,
        top: 0,
        left: 0,
        right: 800,
        bottom: 600,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;
    (store().containerRef as { current: HTMLDivElement | null }).current = viewport;

    const openingFrame = { x: 0, y: 0, width: 200_000, height: 100 };
    const openingSize = { width: openingFrame.width, height: openingFrame.height };
    const openingBaseline = baselineItem('expanding-fit-baseline');
    const expandedFrame = { x: 0, y: 0, width: 200_000, height: 1_000 };
    act(() => {
      dispatch()({
        type: 'REPLACE_DOCUMENT',
        payload: {
          documentId: 'doc-expanding-fit-zoom-floor',
          history: [
            {
              ...openingBaseline,
              documentSource: {
                ...openingBaseline.documentSource!,
                size: openingSize,
                frame: openingFrame,
              },
            },
          ],
          updates: { totalSize: openingSize, documentFrame: openingFrame },
        },
      });
    });

    expect(store().viewState.fitToScreen).toBe(true);
    expect(minimumSliderZoomForDocumentSize(openingFrame)).toBeCloseTo(0.01);
    expect(absoluteViewZoom(store().viewState, 0.004)).toBeCloseTo(0.004);

    act(() => {
      dispatch()({
        type: 'COMMIT_DOCUMENT_EDIT',
        payload: {
          updates: { documentFrame: expandedFrame },
          historyItem: toolItem('expand-frame-fit-zoom-floor', SET_DOCUMENT_FRAME_ACTION, {
            previousFrame: openingFrame,
            nextFrame: expandedFrame,
          }),
        },
      });
    });

    expect(minimumSliderZoomForDocumentSize(expandedFrame)).toBeCloseTo(0.001);
    expect(absoluteViewZoom(store().viewState, 0.004)).toBeCloseTo(0.004);
    expect(store().viewState.minimumZoomOverride).toBeCloseTo(0.004);

    const cropTimeline = store().history;
    const branchRevision = store().branchRevision;
    act(() => {
      dispatch()({
        type: 'APPLY_HISTORY_REPLAY',
        payload: {
          updates: { documentFrame: openingFrame, totalSize: openingSize },
          timeline: { entries: cropTimeline, cursor: cropTimeline.length - 2, branchRevision },
        },
      });
    });
    expect(absoluteViewZoom(store().viewState, 0.004)).toBeCloseTo(0.004);
    expect(store().viewState.minimumZoomOverride).toBeCloseTo(0.004);

    act(() => {
      dispatch()({
        type: 'APPLY_HISTORY_REPLAY',
        payload: {
          updates: {
            documentFrame: expandedFrame,
            totalSize: { width: expandedFrame.width, height: expandedFrame.height },
          },
          timeline: { entries: cropTimeline, cursor: cropTimeline.length - 1, branchRevision },
        },
      });
    });
    expect(absoluteViewZoom(store().viewState, 0.004)).toBeCloseTo(0.004);
    expect(store().viewState.minimumZoomOverride).toBeCloseTo(0.004);
    expect(store().history).toHaveLength(cropTimeline.length);
  });

  it('does not carry a one-pixel floor override from an ordinary Fit crop', () => {
    const { store, dispatch } = renderWithProbe();
    const viewport = document.createElement('div');
    viewport.getBoundingClientRect = () =>
      ({
        width: 800,
        height: 600,
        top: 0,
        left: 0,
        right: 800,
        bottom: 600,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;
    (store().containerRef as { current: HTMLDivElement | null }).current = viewport;

    const openingFrame = { x: 0, y: 0, width: 2_000, height: 1_000 };
    const openingSize = { width: openingFrame.width, height: openingFrame.height };
    const openingBaseline = baselineItem('ordinary-fit-baseline');
    const firstCrop = { x: 0, y: 0, width: 1_000, height: 500 };
    const narrowCrop = { x: 0, y: 0, width: 1_000, height: 1 };
    act(() => {
      dispatch()({
        type: 'REPLACE_DOCUMENT',
        payload: {
          documentId: 'doc-ordinary-fit-zoom-floor',
          history: [
            {
              ...openingBaseline,
              documentSource: {
                ...openingBaseline.documentSource!,
                size: openingSize,
                frame: openingFrame,
              },
            },
          ],
          updates: { totalSize: openingSize, documentFrame: openingFrame },
        },
      });
    });
    expect(store().viewState.fitToScreen).toBe(true);

    act(() => {
      dispatch()({
        type: 'COMMIT_DOCUMENT_EDIT',
        payload: {
          updates: { documentFrame: firstCrop },
          historyItem: toolItem('ordinary-fit-crop', SET_DOCUMENT_FRAME_ACTION, {
            previousFrame: openingFrame,
            nextFrame: firstCrop,
          }),
        },
      });
    });
    expect(store().viewState.minimumZoomOverride).toBeUndefined();
    expect(absoluteViewZoom(store().viewState, 0.8)).toBeGreaterThan(minimumSliderZoomForDocumentSize(firstCrop));

    act(() => {
      dispatch()({
        type: 'COMMIT_DOCUMENT_EDIT',
        payload: {
          updates: { documentFrame: narrowCrop },
          historyItem: toolItem('ordinary-fit-narrow-crop', SET_DOCUMENT_FRAME_ACTION, {
            previousFrame: firstCrop,
            nextFrame: narrowCrop,
          }),
        },
      });
    });
    expect(store().viewState.minimumZoomOverride).toBeUndefined();
    expect(absoluteViewZoom(store().viewState, 0.8)).toBeCloseTo(1);
  });

  it('does not treat a same-id document replacement as a crop', () => {
    const { store, dispatch } = renderWithProbe();
    const viewport = document.createElement('div');
    viewport.getBoundingClientRect = () =>
      ({
        width: 800,
        height: 600,
        top: 0,
        left: 0,
        right: 800,
        bottom: 600,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;
    (store().containerRef as { current: HTMLDivElement | null }).current = viewport;

    act(() => {
      dispatch()({
        type: 'REPLACE_DOCUMENT',
        payload: { documentId: 'same-document-id', history: [baselineItem()], updates: { totalSize: initialSize } },
      });
    });
    act(() => store().setViewState({ fitScaleCompensation: 0.5 }));
    act(() => {
      dispatch()({
        type: 'REPLACE_DOCUMENT',
        payload: {
          documentId: 'same-document-id',
          history: [baselineItem('replacement-baseline')],
          updates: { documentFrame: { x: 100, y: 75, width: 200, height: 150 } },
        },
      });
    });

    expect(store().viewState.zoom).toBe(1);
    expect(store().viewState.fitScaleCompensation).toBe(1);
  });

  it('COMMIT_DOCUMENT_EDIT derives totalSize from a committed document frame', () => {
    const { store, dispatch } = renderWithProbe();

    act(() => {
      dispatch()({
        type: 'COMMIT_DOCUMENT_EDIT',
        payload: {
          updates: { documentFrame: { x: 10, y: 20, width: 200.4, height: 150.1 } },
          historyItem: toolItem('blur-edit', 'blur', { radius: 2 }),
        },
      });
    });

    expect(store().documentFrame).toEqual({ x: 10, y: 20, width: 200.4, height: 150.1 });
    // The pixel size is clamped and ceiled rather than copied verbatim.
    expect(store().totalSize).toEqual({ width: 201, height: 151 });
  });

  it('clones the committed document frame so a later caller mutation cannot rewrite published state', () => {
    const { store, dispatch } = renderWithProbe();

    const frame = { x: 0, y: 0, width: 64, height: 32 };
    act(() => {
      dispatch()({
        type: 'COMMIT_DOCUMENT_EDIT',
        payload: { updates: { documentFrame: frame }, historyItem: toolItem('blur-edit', 'blur', { radius: 2 }) },
      });
    });

    expect(store().documentFrame).not.toBe(frame);
    frame.width = 999;
    expect(store().documentFrame).toEqual({ x: 0, y: 0, width: 64, height: 32 });
  });

  it('APPLY_HISTORY_REPLAY derives the frame and size from the replayed updates', () => {
    const { store, dispatch } = renderWithProbe();

    const baseline = baselineItem();
    act(() => {
      dispatch()({
        type: 'REPLACE_DOCUMENT',
        payload: { documentId: 'doc-replay', history: [baseline], updates: { totalSize: initialSize } },
      });
    });

    const replayFrame = { x: 5, y: 6, width: 120, height: 80 };
    act(() => {
      dispatch()({
        type: 'APPLY_HISTORY_REPLAY',
        payload: {
          updates: { documentFrame: replayFrame },
          timeline: { entries: [baseline], cursor: 0, branchRevision: 0 },
        },
      });
    });

    expect(store().documentFrame).toEqual(replayFrame);
    expect(store().documentFrame).not.toBe(replayFrame);
    expect(store().totalSize).toEqual({ width: 120, height: 80 });
    expect(store().historyIndex).toBe(0);
    expect(store().hasUnsavedChanges).toBe(true);
  });

  it('a commit without a document frame leaves the existing frame and size alone', () => {
    const { getProbe, store, dispatch } = renderWithProbe();

    act(() => {
      dispatch()({
        type: 'REPLACE_DOCUMENT',
        payload: { documentId: 'doc-frame', history: [baselineItem()], updates: { totalSize: initialSize } },
      });
    });
    const before = getProbe().store;

    act(() => {
      dispatch()({ type: 'COMMIT_DOCUMENT_EDIT', payload: { historyItem: toolItem('blur-edit', 'blur') } });
    });

    expect(store().documentFrame).toBe(before.documentFrame);
    expect(store().totalSize).toBe(before.totalSize);
  });

  it('REPLACE_DOCUMENT clamps a fractional frame to a whole-pixel size and resets the branch revision', () => {
    const { store, dispatch } = renderWithProbe();

    act(() => {
      dispatch()({
        type: 'REPLACE_DOCUMENT',
        payload: {
          documentId: 'doc-frac',
          history: [baselineItem()],
          updates: { documentFrame: { x: 0, y: 0, width: 33.2, height: 0.4 } },
        },
      });
    });

    expect(store().totalSize).toEqual({ width: 34, height: 1 });
    expect(store().branchRevision).toBe(0);
  });

  it('REPLACE_DOCUMENT falls back to the current frame when neither a frame nor a size is supplied', () => {
    const { store, dispatch } = renderWithProbe();

    act(() => {
      dispatch()({
        type: 'REPLACE_DOCUMENT',
        payload: { documentId: 'doc-keep-frame', history: [baselineItem()], updates: { totalSize: initialSize } },
      });
    });
    const keptFrame = store().documentFrame;

    act(() => {
      dispatch()({
        type: 'REPLACE_DOCUMENT',
        payload: { documentId: 'doc-keep-frame-2', history: [baselineItem('b2')], updates: {} },
      });
    });

    expect(store().documentFrame).toEqual(keptFrame);
    expect(store().totalSize).toEqual({ width: 400, height: 300 });
  });

  describe('REPLACE_DOCUMENT fast-path seven-field identity', () => {
    const freshHistory = [baselineItem('base-1'), baselineItem('base-2')];

    it('sets documentId to the payload documentId', () => {
      const { store, dispatch } = renderWithProbe();
      act(() => {
        dispatch()({
          type: 'REPLACE_DOCUMENT',
          payload: { documentId: 'doc-identity', history: freshHistory, updates: { totalSize: initialSize } },
        });
      });
      expect(store().documentId).toBe('doc-identity');
    });

    it('increments documentRevision by one from current state', () => {
      const { store, dispatch } = renderWithProbe();
      act(() => {
        dispatch()({
          type: 'REPLACE_DOCUMENT',
          payload: { documentId: 'doc-rev-1', history: freshHistory, updates: { totalSize: initialSize } },
        });
      });
      const firstRev = store().documentRevision;
      act(() => {
        dispatch()({
          type: 'REPLACE_DOCUMENT',
          payload: { documentId: 'doc-rev-2', history: freshHistory, updates: { totalSize: initialSize } },
        });
      });
      expect(store().documentRevision).toBe(firstRev + 1);
    });

    it('resets branchRevision to zero', () => {
      const { store, dispatch } = renderWithProbe();
      act(() => {
        dispatch()({
          type: 'REPLACE_DOCUMENT',
          payload: { documentId: 'doc-branch', history: freshHistory, updates: { totalSize: initialSize } },
        });
      });
      act(() => {
        dispatch()({ type: 'COMMIT_DOCUMENT_EDIT', payload: { historyItem: toolItem('edit-1', 'blur') } });
      });
      expect(store().branchRevision).toBeGreaterThan(0);
      act(() => {
        dispatch()({
          type: 'REPLACE_DOCUMENT',
          payload: { documentId: 'doc-branch-2', history: freshHistory, updates: { totalSize: initialSize } },
        });
      });
      expect(store().branchRevision).toBe(0);
    });

    it('replaces history with the payload history array', () => {
      const { store, dispatch } = renderWithProbe();
      act(() => {
        dispatch()({
          type: 'REPLACE_DOCUMENT',
          payload: { documentId: 'doc-hist-1', history: [baselineItem('h1')], updates: { totalSize: initialSize } },
        });
      });
      act(() => {
        dispatch()({ type: 'COMMIT_DOCUMENT_EDIT', payload: { historyItem: toolItem('edit-1', 'blur') } });
      });
      expect(store().history).toHaveLength(2);
      act(() => {
        dispatch()({
          type: 'REPLACE_DOCUMENT',
          payload: { documentId: 'doc-hist-2', history: freshHistory, updates: { totalSize: initialSize } },
        });
      });
      expect(store().history).toEqual(freshHistory);
    });

    it('sets historyIndex to the payload historyIndex or last index', () => {
      const { store, dispatch } = renderWithProbe();
      act(() => {
        dispatch()({
          type: 'REPLACE_DOCUMENT',
          payload: {
            documentId: 'doc-idx-explicit',
            history: freshHistory,
            historyIndex: 0,
            updates: { totalSize: initialSize },
          },
        });
      });
      expect(store().historyIndex).toBe(0);
      act(() => {
        dispatch()({
          type: 'REPLACE_DOCUMENT',
          payload: { documentId: 'doc-idx-implicit', history: freshHistory, updates: { totalSize: initialSize } },
        });
      });
      expect(store().historyIndex).toBe(freshHistory.length - 1);
    });

    it('sets documentFrame from updates.documentFrame or replacementFrame fallback', () => {
      const { store, dispatch } = renderWithProbe();
      const customFrame = { x: 10, y: 20, width: 100, height: 80 };
      act(() => {
        dispatch()({
          type: 'REPLACE_DOCUMENT',
          payload: {
            documentId: 'doc-frame-explicit',
            history: freshHistory,
            updates: { documentFrame: customFrame, totalSize: { width: 100, height: 80 } },
          },
        });
      });
      expect(store().documentFrame).toEqual(customFrame);
      act(() => {
        dispatch()({
          type: 'REPLACE_DOCUMENT',
          payload: { documentId: 'doc-frame-fallback', history: freshHistory, updates: { totalSize: initialSize } },
        });
      });
      expect(store().documentFrame).toEqual(defaultFrame);
    });

    it('sets totalSize from documentFrame size', () => {
      const { store, dispatch } = renderWithProbe();
      const customFrame = { x: 0, y: 0, width: 123, height: 456 };
      act(() => {
        dispatch()({
          type: 'REPLACE_DOCUMENT',
          payload: { documentId: 'doc-size', history: freshHistory, updates: { documentFrame: customFrame } },
        });
      });
      expect(store().totalSize).toEqual({ width: 123, height: 456 });
    });
  });

  describe('REPLACE_DOCUMENT disposal guard', () => {
    it('disposes the previous document id when documentId changes', () => {
      const dispose = vi.spyOn(getAssetRegistry(), 'disposeDocument');
      try {
        const { dispatch } = renderWithProbe();
        act(() => {
          dispatch()({
            type: 'REPLACE_DOCUMENT',
            payload: { documentId: 'doc-dispose-a', history: [baselineItem()], updates: { totalSize: initialSize } },
          });
        });
        dispose.mockClear();
        act(() => {
          dispatch()({
            type: 'REPLACE_DOCUMENT',
            payload: {
              documentId: 'doc-dispose-b',
              history: [baselineItem('b2')],
              updates: { totalSize: initialSize },
            },
          });
        });
        expect(dispose).toHaveBeenCalledWith('doc-dispose-a');
        expect(dispose).not.toHaveBeenCalledWith('doc-dispose-b');
      } finally {
        dispose.mockRestore();
      }
    });

    it('does not dispose when documentId stays the same', () => {
      const dispose = vi.spyOn(getAssetRegistry(), 'disposeDocument');
      try {
        const { dispatch } = renderWithProbe();
        act(() => {
          dispatch()({
            type: 'REPLACE_DOCUMENT',
            payload: { documentId: 'doc-same', history: [baselineItem()], updates: { totalSize: initialSize } },
          });
        });
        dispose.mockClear();
        act(() => {
          dispatch()({
            type: 'REPLACE_DOCUMENT',
            payload: { documentId: 'doc-same', history: [baselineItem('b2')], updates: { totalSize: initialSize } },
          });
        });
        expect(dispose).not.toHaveBeenCalled();
      } finally {
        dispose.mockRestore();
      }
    });

    it('uses currentState.documentId for disposal decision not the outgoing documentId', () => {
      const dispose = vi.spyOn(getAssetRegistry(), 'disposeDocument');
      try {
        const { store, dispatch } = renderWithProbe();
        act(() => {
          dispatch()({
            type: 'REPLACE_DOCUMENT',
            payload: { documentId: 'doc-first', history: [baselineItem()], updates: { totalSize: initialSize } },
          });
        });
        const firstId = store().documentId;
        dispose.mockClear();
        act(() => {
          dispatch()({
            type: 'REPLACE_DOCUMENT',
            payload: { documentId: 'doc-second', history: [baselineItem('b2')], updates: { totalSize: initialSize } },
          });
        });
        expect(dispose).toHaveBeenCalledWith(firstId);
        expect(dispose).not.toHaveBeenCalledWith('doc-second');
      } finally {
        dispose.mockRestore();
      }
    });
  });
});

describe('StoreContext COMMIT_DOCUMENT_EDIT projection parity', () => {
  const nextFrame = { x: 20, y: 10, width: 200, height: 150 };

  function renameItem(id: string, name: string): HistoryItem {
    return { id, actionName: RENAME_LAYER_ACTION, layerId, args: { name } };
  }

  function cropItem(id: string): HistoryItem {
    return {
      id,
      actionName: SET_DOCUMENT_FRAME_ACTION,
      layerId: 'document',
      args: { previousFrame: defaultFrame, nextFrame },
    };
  }

  /**
   * Everything a commit moves. The refs and callbacks in `StoreData` are
   * provider-owned and mean nothing per transition, so they are the only fields
   * left out of the comparison.
   */
  function comparable(store: StoreData) {
    return {
      documentId: store.documentId,
      documentRevision: store.documentRevision,
      branchRevision: store.branchRevision,
      history: store.history.map((item) => item.id),
      historyIndex: store.historyIndex,
      hasUnsavedChanges: store.hasUnsavedChanges,
      documentFrame: store.documentFrame,
      totalSize: store.totalSize,
      layers: Object.fromEntries(
        Object.entries(store.layers).map(([id, layer]) => [id, { name: layer.name, visible: layer.visible }])
      ),
      durableStatus: store.durableStatus,
      durableDocument: store.durableDocument,
      durableDiagnostics: store.durableDiagnostics,
    };
  }

  /**
   * The dispatcher builds the next state itself before queueing the transition,
   * so a second commit in the same React batch is decided against that build
   * rather than against the reducer's output. Batching is therefore the only way
   * to observe the projection, and comparing it against the flushed run is the
   * only way to prove the two agree.
   *
   * The first commit supplies a plan that disagrees with the legacy entry, so
   * the store reports a mismatch rather than publishing. That is what makes the
   * two store paths distinguishable: a publication carries the previous
   * diagnostics forward and a whole-timeline reconversion replaces them, so a
   * surviving diagnostic proves the second commit published.
   */
  function commitPair(batched: boolean) {
    const { store, dispatch } = renderWithProbe();
    act(() => {
      dispatch()({
        type: 'REPLACE_DOCUMENT',
        payload: {
          documentId: 'doc-parity',
          history: [baselineItem()],
          historyIndex: 0,
          updates: { layers: { [layerId]: makeLayer() }, totalSize: initialSize, documentFrame: defaultFrame },
        },
      });
    });

    const rename = renameItem('rename-1', 'Renamed');
    const wrongPlan = {
      ...(deriveSetLayerPropertiesEntry(rename) as DurableHistoryEntry),
      operation: { kind: 'set-layer-properties', layerId, patch: { name: 'Somewhere else' } },
    } as DurableHistoryEntry;
    const crop = cropItem('crop-1');
    const cropPlan = deriveSetDocumentFrameEntry(crop, defaultFrame);

    const renameCommit = () =>
      dispatch()({
        type: 'COMMIT_DOCUMENT_EDIT',
        payload: {
          updates: { layers: { [layerId]: { ...makeLayer(), name: 'Renamed' } } },
          historyItem: rename,
          durableEntry: wrongPlan,
        },
      });
    // This commit says nothing about layers, so it can only keep the record the
    // first one published if that record reached the state it is read from.
    const cropCommit = () =>
      dispatch()({
        type: 'COMMIT_DOCUMENT_EDIT',
        payload: {
          updates: { documentFrame: nextFrame, totalSize: { width: 200, height: 150 } },
          historyItem: crop,
          durableEntry: cropPlan,
        },
      });

    if (batched) {
      act(() => {
        renameCommit();
        cropCommit();
      });
    } else {
      act(renameCommit);
      act(cropCommit);
    }
    return comparable(store());
  }

  it('publishes the same state for two commits batched together as for two flushed apart', () => {
    expect(commitPair(true)).toEqual(commitPair(false));
  });

  it('carries the first commit forward into a second commit dispatched in the same batch', () => {
    const state = commitPair(true);

    expect(state.history).toEqual(['baseline', 'rename-1', 'crop-1']);
    expect(state.historyIndex).toBe(2);
    expect(state.branchRevision).toBe(2);
    expect(state.hasUnsavedChanges).toBe(true);
    // The second commit carried no layers of its own, so the renamed record can
    // only survive if the projection the dispatcher built for the first commit
    // published it and the second commit read it back.
    expect(state.layers).toEqual({ [layerId]: { name: 'Renamed', visible: true } });
    expect(state.documentFrame).toEqual(nextFrame);
    expect(state.totalSize).toEqual({ width: 200, height: 150 });
    // The second commit published onto the first one's document: the planted
    // mismatch diagnostic survived, and both entries are in the shadow.
    expect(state.durableStatus).toBe('current');
    expect(state.durableDiagnostics.map((diagnostic) => diagnostic.code)).toEqual(['durable-append-mismatch']);
    expect(state.durableDocument!.history.map((entry) => entry.id)).toEqual(['rename-1', 'crop-1']);
    expect(state.durableDocument!.cursor).toBe(1);
  });

  it('a commit flags unsaved changes even when its own updates try to clear the flag', () => {
    const { store, dispatch } = renderWithProbe();
    act(() => {
      dispatch()({
        type: 'REPLACE_DOCUMENT',
        payload: { documentId: 'doc-dirty', history: [baselineItem()], updates: { totalSize: initialSize } },
      });
    });
    expect(store().hasUnsavedChanges).toBe(false);

    act(() => {
      dispatch()({
        type: 'COMMIT_DOCUMENT_EDIT',
        payload: {
          updates: { hasUnsavedChanges: false, fileName: 'edited.psd' },
          historyItem: toolItem('blur-edit', 'blur', { radius: 2 }),
        },
      });
    });

    expect(store().fileName).toBe('edited.psd');
    // The flag is assigned after the updates spread, so the same payload that
    // writes other metadata cannot use a commit to clear the dirty state.
    expect(store().hasUnsavedChanges).toBe(true);
  });

  it('keeps the dirty flag set across a second commit batched behind the first', () => {
    const { store, dispatch } = renderWithProbe();
    act(() => {
      dispatch()({
        type: 'REPLACE_DOCUMENT',
        payload: { documentId: 'doc-dirty-batch', history: [baselineItem()], updates: { totalSize: initialSize } },
      });
    });

    act(() => {
      dispatch()({
        type: 'COMMIT_DOCUMENT_EDIT',
        payload: { historyItem: renameItem('rename-1', 'Renamed') },
      });
      dispatch()({
        type: 'COMMIT_DOCUMENT_EDIT',
        payload: {
          updates: { hasUnsavedChanges: false },
          historyItem: toolItem('blur-edit', 'blur', { radius: 2 }),
        },
      });
    });

    expect(store().history).toHaveLength(3);
    expect(store().hasUnsavedChanges).toBe(true);
  });
});

describe('StoreContext unknown actions', () => {
  it('ignores an unrecognised action without allocating new state', () => {
    const { getProbe, store, dispatch } = renderWithProbe();

    const before = getProbe().store;
    act(() => {
      dispatch()({ type: 'NOT_A_REAL_ACTION' } as never);
    });

    expect(getProbe().store).toBe(before);
    expect(store().fileName).toBe('');
  });
});

describe('StoreContext provider-owned transient surface', () => {
  it('publishes stable DOM and current-args refs across state updates', () => {
    const { getProbe, dispatch } = renderWithProbe();

    const first = getProbe().store;
    act(() => {
      dispatch()({ type: 'SET_COLOR', payload: '#010203' });
    });
    const second = getProbe().store;

    expect(second.canvasRef).toBe(first.canvasRef);
    expect(second.toolOverlayRef).toBe(first.toolOverlayRef);
    expect(second.rectOverlayRef).toBe(first.rectOverlayRef);
    expect(second.containerRef).toBe(first.containerRef);
    expect(second.currentArgs).toBe(first.currentArgs);
    expect(second.previewLayers).toBe(first.previewLayers);
  });

  it('shares one preview layer transaction across every consumer of the document', () => {
    // Two independent consumers mounted under the SAME provider stand in for the
    // toolbar and the exporter: a draft staged through one must be visible to the
    // other, because the transaction is document-scoped rather than hook-scoped.
    const consumerRefs: Array<{ store: StoreData; dispatch: StoreDispatch } | null> = [null, null];
    const Consumer = ({ slot }: { slot: 0 | 1 }) => {
      const [store, dispatch] = useStore();
      useEffect(() => {
        consumerRefs[slot] = { store, dispatch };
      }, [dispatch, slot, store]);
      return null;
    };

    render(
      <StoreProvider>
        <Consumer slot={0} />
        <Consumer slot={1} />
      </StoreProvider>
    );

    const [toolbar, exporter] = consumerRefs as [
      { store: StoreData; dispatch: StoreDispatch },
      { store: StoreData; dispatch: StoreDispatch },
    ];
    if (!toolbar || !exporter) throw new Error('both consumers must mount');

    act(() => {
      toolbar.dispatch({ type: 'BATCH_UPDATES', payload: { layers: { [layerId]: makeLayer() }, hasImage: true } });
    });

    act(() => {
      toolbar.store.previewLayers.current = { [layerId]: { layer: makeLayer('preview') } };
    });

    expect(exporter.store.previewLayers).toBe(toolbar.store.previewLayers);
    expect(Object.keys(exporter.store.previewLayers.current)).toEqual([layerId]);

    act(() => {
      exporter.store.clearPreviewLayers();
    });
    expect(toolbar.store.previewLayers.current).toEqual({});
  });

  it('clearPreviewLayers drops every draft for the document and keeps the same ref object', () => {
    const { getProbe, store, dispatch } = renderWithProbe();

    act(() => {
      dispatch()({ type: 'BATCH_UPDATES', payload: { layers: { [layerId]: makeLayer() }, hasImage: true } });
    });

    const previewRef = getProbe().store.previewLayers;
    act(() => {
      previewRef.current = { a: { layer: makeLayer('a') }, b: { layer: makeLayer('b') } };
    });
    expect(Object.keys(previewRef.current)).toEqual(['a', 'b']);

    act(() => {
      store().clearPreviewLayers();
    });

    expect(previewRef.current).toEqual({});
    expect(getProbe().store.previewLayers).toBe(previewRef);
  });
});

describe('StoreContext provider lifecycle', () => {
  it('useStore throws a named error outside a provider', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      expect(() => renderHook(() => useStore())).toThrow('useStore must be used within StoreProvider');
    } finally {
      consoleError.mockRestore();
    }
  });

  it('disposes the live document exactly once on provider teardown', () => {
    const dispose = vi.spyOn(getAssetRegistry(), 'disposeDocument');
    try {
      const { store, unmount } = renderWithProbe();
      dispose.mockClear();
      const liveId = store().documentId;
      expect(liveId).toBe('uninitialized');

      unmount();

      const disposals = dispose.mock.calls.filter(([documentId]) => documentId === liveId);
      expect(disposals).toHaveLength(1);
      expect(getAssetRegistry().getDocumentGeneration(liveId)).toBe(1);
    } finally {
      dispose.mockRestore();
    }
  });
});
