import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { StoreProvider, useStore, type StoreDispatch } from '../StoreContext.tsx';
import { useLayers } from '../useLayer.ts';
import type { LayersRecord } from '../layer-types.ts';
import type { HistoryItem } from '../history-types.ts';
import { documentFrameFromSize } from '../document-frame.ts';
import { createMockLayer } from '../../__tests__/fixtures/layer.ts';
import { OPEN_DOCUMENT_ACTION, RENAME_LAYER_ACTION, REORDER_ACTION } from '../../util/constants.ts';

const documentSize = { width: 400, height: 300 };

function makeLayers(): LayersRecord {
  return Object.fromEntries(
    ['bottom', 'middle', 'top'].map((id, order) => [
      id,
      createMockLayer({
        id,
        name: id,
        order,
        source: { kind: 'blank', color: '#ffffff', opacity: 1, pos: { x: 0, y: 0, width: 100, height: 100 } },
      }),
    ])
  ) as LayersRecord;
}

function useHarness() {
  const [store, dispatch] = useStore();
  return { store, dispatch, layers: useLayers() };
}

function setup(layers = makeLayers()) {
  const { result } = renderHook(useHarness, { wrapper: StoreProvider });
  act(() => {
    result.current.store.canvasRef.current = document.createElement('canvas');
    result.current.store.toolOverlayRef.current = document.createElement('canvas');
    result.current.store.previewLayers.current = {};
    result.current.dispatch({
      type: 'BATCH_UPDATES',
      payload: {
        layers,
        activeLayerId: Object.keys(layers)[0] ?? null,
        totalSize: documentSize,
        documentFrame: documentFrameFromSize(documentSize),
        hasImage: true,
      },
    });
  });
  return result;
}

function reorder(dispatch: StoreDispatch, layerToMoveId: string, afterWhichLayerId?: string | null) {
  act(() => {
    dispatch({ type: 'REORDER_LAYERS', payload: { layerToMoveId, afterWhichLayerId } });
  });
}

function orders(layers: LayersRecord) {
  return Object.fromEntries(Object.entries(layers).map(([id, layer]) => [id, layer.order]));
}

describe('StoreContext REORDER_LAYERS', () => {
  it('moves a layer to the bottom from the current store layers', () => {
    const result = setup();

    reorder(result.current.dispatch, 'top');

    expect(orders(result.current.store.layers)).toEqual({ bottom: 0, middle: 1, top: -1 });
    expect(result.current.store.hasUnsavedChanges).toBe(true);
  });

  it('moves a layer after the requested anchor using the current store layers', () => {
    const result = setup();

    reorder(result.current.dispatch, 'bottom', 'middle');

    expect(orders(result.current.store.layers)).toEqual({ bottom: 2, middle: 1, top: 4 });
  });

  it('shares one id between the appended legacy and converted reorder entries', () => {
    const result = setup();
    const baselineLayers = result.current.store.layers;
    const baselineFrame = documentFrameFromSize(documentSize);
    const baseline: HistoryItem = {
      id: 'baseline',
      actionName: OPEN_DOCUMENT_ACTION,
      layerId: 'bottom',
      documentSource: { layers: baselineLayers, size: documentSize, frame: baselineFrame },
    };

    act(() => {
      result.current.dispatch({
        type: 'REPLACE_DOCUMENT',
        payload: {
          documentId: 'reorder-id-sharing',
          history: [baseline],
          historyIndex: 0,
          updates: { layers: baselineLayers, totalSize: documentSize, documentFrame: baselineFrame, hasImage: true },
        },
      });
    });
    reorder(result.current.dispatch, 'bottom', 'top');

    const legacyEntry = result.current.store.history.at(-1)!;
    expect(legacyEntry).toMatchObject({
      actionName: REORDER_ACTION,
      args: { layerToMoveId: 'bottom', afterWhichLayerId: 'top' },
    });
    expect(result.current.store.durableDocument?.history.at(-1)?.id).toBe(legacyEntry.id);
  });

  it('keeps same-batch reorders equivalent to separately flushed dispatches', () => {
    const batched = setup();
    const flushed = setup();

    act(() => {
      batched.current.dispatch({
        type: 'REORDER_LAYERS',
        payload: { layerToMoveId: 'top', afterWhichLayerId: 'bottom' },
      });
      batched.current.dispatch({
        type: 'REORDER_LAYERS',
        payload: { layerToMoveId: 'bottom', afterWhichLayerId: 'middle' },
      });
    });
    reorder(flushed.current.dispatch, 'top', 'bottom');
    reorder(flushed.current.dispatch, 'bottom', 'middle');

    expect(orders(batched.current.store.layers)).toEqual(orders(flushed.current.store.layers));
    expect(batched.current.store.history.map(({ actionName, args }) => ({ actionName, args }))).toEqual(
      flushed.current.store.history.map(({ actionName, args }) => ({ actionName, args }))
    );
  });

  it.each([
    { layerToMoveId: 'bottom', afterWhichLayerId: 'missing-anchor' },
    { layerToMoveId: 'missing-mover', afterWhichLayerId: 'middle' },
  ])('keeps layers unchanged when the $layerToMoveId or anchor is missing', (intent) => {
    const result = setup();
    const before = result.current.store.layers;
    const beforeOrders = orders(before);

    reorder(result.current.dispatch, intent.layerToMoveId, intent.afterWhichLayerId);

    expect(result.current.store.layers).toBe(before);
    expect(orders(result.current.store.layers)).toEqual(beforeOrders);
    expect(result.current.store.history.at(-1)).toMatchObject({
      actionName: REORDER_ACTION,
      layerId: intent.layerToMoveId,
      args: intent,
    });
  });

  it('does not let a stale hook closure revert a rename that landed before reorder dispatch', () => {
    const result = setup();
    const staleMove = result.current.layers.moveLayerAfter;
    const renamedLayers = {
      ...result.current.store.layers,
      bottom: { ...result.current.store.layers.bottom, name: 'Renamed' },
    } as LayersRecord;
    const rename: HistoryItem = {
      id: 'rename-before-reorder',
      actionName: RENAME_LAYER_ACTION,
      layerId: 'bottom',
      args: { name: 'Renamed' },
    };

    act(() => {
      result.current.dispatch({
        type: 'COMMIT_DOCUMENT_EDIT',
        payload: { updates: { layers: renamedLayers }, historyItem: rename },
      });
    });
    act(() => {
      staleMove('bottom', 'top');
    });

    expect(result.current.store.layers.bottom.name).toBe('Renamed');
    expect(result.current.store.layers.bottom.order).toBe(3);
    expect(result.current.store.history.map((item) => item.actionName)).toEqual([RENAME_LAYER_ACTION, REORDER_ACTION]);
    expect(result.current.store.history.at(-1)?.args).toEqual({
      layerToMoveId: 'bottom',
      afterWhichLayerId: 'top',
    });
  });
});
