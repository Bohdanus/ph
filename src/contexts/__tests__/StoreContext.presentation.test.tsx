import { act, render } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { type StoreData, type StoreDispatch, StoreProvider, useStore } from '../StoreContext.tsx';
import { createMockImageBitmap, createMockOffscreenCanvas } from '../../__tests__/fixtures/canvas.ts';
import { createMockLayer } from '../../__tests__/fixtures/layer.ts';
import type { HistoryItem } from '../history-types.ts';
import type { Layer, LayersRecord } from '../layer-types.ts';
import type { BitmapSource } from '../general-types.ts';
import { OPEN_DOCUMENT_ACTION, TOOL_ACTION } from '../../util/constants.ts';

const layerId = 'layer-1';
const initialSize = { width: 400, height: 300 };
const defaultFrame = { x: 0, y: 0, width: 400, height: 300 };

function canvas(width = 100, height = 80): BitmapSource {
  return createMockOffscreenCanvas(width, height) as unknown as BitmapSource;
}

function layerWithCanvas(id = layerId, staged: BitmapSource | null = canvas()): Layer {
  return { ...createMockLayer({ id, pos: { x: 0, y: 0, width: 100, height: 80 } }), tmpCanvas: staged };
}

function baselineItem(layers: LayersRecord, id = 'baseline'): HistoryItem {
  return {
    id,
    actionName: OPEN_DOCUMENT_ACTION,
    layerId,
    documentSource: { layers, size: initialSize, frame: defaultFrame },
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

function replaceDocument(dispatch: StoreDispatch, layers: LayersRecord, documentId = 'doc-1') {
  act(() => {
    dispatch({
      type: 'REPLACE_DOCUMENT',
      payload: {
        documentId,
        history: [baselineItem(layers)],
        historyIndex: 0,
        updates: { layers, totalSize: initialSize, documentFrame: defaultFrame },
      },
    });
  });
}

/** Runs a promotion request and lets the delivery settle. */
async function promote(store: StoreData, requests: Parameters<StoreData['promoteLayerPresentation']>[0]) {
  await act(async () => {
    store.promoteLayerPresentation(requests);
    await Promise.resolve();
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('PROMOTE_LAYER_PRESENTATIONS', () => {
  it('publishes the cache into the layer that still holds the requesting canvas', async () => {
    const bitmap = createMockImageBitmap(100, 80);
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => bitmap)
    );
    const staged = canvas();
    const { store, dispatch } = renderWithProbe();
    replaceDocument(dispatch(), { [layerId]: layerWithCanvas(layerId, staged) });
    const before = store();

    await promote(before, { layerId, canvas: staged });

    const after = store().layers[layerId];
    expect(after.bitmap).toBe(bitmap);
    expect(after.tmpCanvas).toBeNull();
    // A cache is not a document change: no history, no unsaved flag, no shadow churn.
    expect(store().history).toBe(before.history);
    expect(store().historyIndex).toBe(before.historyIndex);
    expect(store().hasUnsavedChanges).toBe(before.hasUnsavedChanges);
    expect(store().durableDocument).toBe(before.durableDocument);
    expect(store().durableStatus).toBe(before.durableStatus);
  });

  it('refuses and closes a promotion whose canvas was replaced while it materialized', async () => {
    const bitmap = createMockImageBitmap(100, 80);
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => bitmap)
    );
    const staged = canvas();
    const newer = canvas(120, 90);
    const { store, dispatch } = renderWithProbe();
    replaceDocument(dispatch(), { [layerId]: layerWithCanvas(layerId, staged) });

    // A newer preview wins the race before the bitmap arrives.
    act(() => {
      dispatch()({
        type: 'PUBLISH_RUNTIME_PRESENTATION',
        payload: { layers: { [layerId]: layerWithCanvas(layerId, newer) } },
      });
    });
    await promote(store(), { layerId, canvas: staged });

    expect(bitmap.close).toHaveBeenCalledTimes(1);
    expect(store().layers[layerId].bitmap).toBeNull();
    expect(store().layers[layerId].tmpCanvas).toBe(newer);
  });

  it('refuses and closes a promotion for a layer the document no longer has', async () => {
    const bitmap = createMockImageBitmap();
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => bitmap)
    );
    const staged = canvas();
    const { store, dispatch } = renderWithProbe();
    replaceDocument(dispatch(), { [layerId]: layerWithCanvas(layerId, staged) });

    await promote(store(), { layerId: 'layer-gone', canvas: staged });

    expect(bitmap.close).toHaveBeenCalledTimes(1);
  });

  it('publishes a whole batch in one transition', async () => {
    const first = createMockImageBitmap(100, 80);
    const second = createMockImageBitmap(60, 40);
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async (source: unknown) => (source === stagedA ? first : second))
    );
    const stagedA = canvas();
    const stagedB = canvas(60, 40);
    const { store, dispatch } = renderWithProbe();
    replaceDocument(dispatch(), {
      [layerId]: layerWithCanvas(layerId, stagedA),
      'layer-2': layerWithCanvas('layer-2', stagedB),
    });

    await promote(store(), [
      { layerId, canvas: stagedA },
      { layerId: 'layer-2', canvas: stagedB },
    ]);

    expect(store().layers[layerId].bitmap).toBe(first);
    expect(store().layers['layer-2'].bitmap).toBe(second);
    expect(first.close).not.toHaveBeenCalled();
  });

  it('retires the cache it replaces and leaves a borrowed raster alone', async () => {
    const owned = createMockImageBitmap(100, 80);
    const borrowed = createMockImageBitmap(10, 10);
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => owned)
    );
    const staged = canvas();
    const { store, dispatch } = renderWithProbe();
    const published = { ...layerWithCanvas(layerId, staged), bitmap: borrowed };
    replaceDocument(dispatch(), { [layerId]: published });

    await promote(store(), { layerId, canvas: staged });

    // The borrowed raster is not owned by the presentation boundary.
    expect(borrowed.close).not.toHaveBeenCalled();
    expect(store().layers[layerId].bitmap).toBe(owned);

    // A second promotion retires the cache this boundary published.
    const stagedAgain = canvas(100, 80);
    const replacement = createMockImageBitmap(100, 80);
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => replacement)
    );
    act(() => {
      dispatch()({
        type: 'PUBLISH_RUNTIME_PRESENTATION',
        payload: { layers: { [layerId]: { ...store().layers[layerId], tmpCanvas: stagedAgain } } },
      });
    });
    await promote(store(), { layerId, canvas: stagedAgain });

    expect(owned.close).toHaveBeenCalledTimes(1);
    expect(store().layers[layerId].bitmap).toBe(replacement);
  });

  it('releases the promoted caches of a document that is being replaced', async () => {
    const bitmap = createMockImageBitmap();
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => bitmap)
    );
    const staged = canvas();
    const { store, dispatch } = renderWithProbe();
    replaceDocument(dispatch(), { [layerId]: layerWithCanvas(layerId, staged) });
    await promote(store(), { layerId, canvas: staged });
    expect(store().layers[layerId].bitmap).toBe(bitmap);

    replaceDocument(dispatch(), { 'layer-new': layerWithCanvas('layer-new', canvas(50, 50)) }, 'doc-2');

    expect(bitmap.close).toHaveBeenCalledTimes(1);
    expect(store().layers[layerId]).toBeUndefined();
  });

  it('still promotes the bedrock layer of a freshly replaced document', async () => {
    // Regression: the promotion used to be registered on the outgoing document's
    // scope and lost to its disposal, leaving a new document's bedrock layer
    // with no cache at all.
    const bitmap = createMockImageBitmap(400, 300);
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => bitmap)
    );
    const staged = canvas(400, 300);
    const { store, dispatch } = renderWithProbe();

    replaceDocument(dispatch(), { [layerId]: layerWithCanvas(layerId, staged) }, 'doc-fresh');
    await promote(store(), { layerId, canvas: staged });

    expect(store().layers[layerId].bitmap).toBe(bitmap);
    expect(store().layers[layerId].tmpCanvas).toBeNull();
  });
});

describe('PUBLISH_RUNTIME_PRESENTATION', () => {
  it('publishes a record that only differs by a cache, without touching history or the shadow', () => {
    const { store, dispatch } = renderWithProbe();
    replaceDocument(dispatch(), { [layerId]: layerWithCanvas(layerId, null) });
    const before = store();
    const staged = canvas();
    const published = { ...before.layers[layerId], tmpCanvas: staged };

    act(() => {
      dispatch()({ type: 'PUBLISH_RUNTIME_PRESENTATION', payload: { layers: { [layerId]: published } } });
    });

    expect(store().layers[layerId]).toBe(published);
    expect(store().history).toBe(before.history);
    expect(store().historyIndex).toBe(before.historyIndex);
    expect(store().hasUnsavedChanges).toBe(before.hasUnsavedChanges);
    expect(store().durableDocument).toBe(before.durableDocument);
    expect(store().durableStatus).toBe(before.durableStatus);
  });

  /**
   * The refused publication is logged as an error only when the payload is not
   * reference-identical to the stored record, and that half of the guard is not
   * reachable today. `layersDifferOnlyByPresentation`
   * (`layer-presentation.ts:96-112`) returns `true` for a payload whose layer
   * records ARE the stored objects — its `previous === candidate` short-circuit
   * at `:106` — so an identity-identical payload is published, never refused,
   * and the quiet branch in `StoreContext.tsx` never runs.
   *
   * That is recorded rather than tested: a test for the quiet branch would have
   * to dispatch a payload the guard accepts, so it would pass before and after
   * the change and prove nothing. What is reachable, and pinned below, is the
   * refusal of a payload that moves durable layer state.
   */

  it('refuses a payload that also changes durable layer state, naming the offending ids', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { store, dispatch } = renderWithProbe();
    replaceDocument(dispatch(), {
      [layerId]: layerWithCanvas(layerId, null),
      'layer-2': layerWithCanvas('layer-2', null),
    });
    const before = store().layers[layerId];
    const secondName = store().layers['layer-2'].name;

    act(() => {
      dispatch()({
        type: 'PUBLISH_RUNTIME_PRESENTATION',
        payload: {
          layers: {
            [layerId]: { ...before, pos: { x: 99, y: 0, width: 100, height: 80 } },
            'layer-2': { ...store().layers['layer-2'], name: 'renamed' },
          },
        },
      });
    });

    expect(store().layers[layerId]).toBe(before);
    expect(store().layers['layer-2'].name).toBe(secondName);
    // A publication that moves durable layer state loses a user edit, so it is
    // reported rather than discarded: the message names the invariant and the
    // layers that broke it.
    expect(consoleError).toHaveBeenCalledTimes(1);
    const [message] = consoleError.mock.calls[0];
    expect(String(message)).toContain('PUBLISH_RUNTIME_PRESENTATION');
    expect(String(message)).toContain('layer-1, layer-2');
  });

  it('refuses a payload that rewrites a recorded tool edit', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { store, dispatch } = renderWithProbe();
    const base = layerWithCanvas(layerId, null);
    act(() => {
      dispatch()({
        type: 'REPLACE_DOCUMENT',
        payload: {
          documentId: 'doc-ops',
          history: [
            baselineItem({ [layerId]: base }, 'baseline'),
            { id: 'edit-1', actionName: TOOL_ACTION, layerId, args: { toolName: 'blur', radius: 4 } },
          ],
          historyIndex: 1,
          updates: { layers: { [layerId]: base }, totalSize: initialSize, documentFrame: defaultFrame },
        },
      });
    });
    const before = store().layers[layerId];

    act(() => {
      dispatch()({
        type: 'PUBLISH_RUNTIME_PRESENTATION',
        payload: {
          layers: {
            [layerId]: {
              ...before,
              operations: [{ id: 'op-1', args: { toolName: 'blur', radius: 9 }, enabled: true }],
            },
          },
        },
      });
    });

    expect(store().layers[layerId]).toBe(before);
    expect(store().layers[layerId].operations).toEqual([]);
  });
});
