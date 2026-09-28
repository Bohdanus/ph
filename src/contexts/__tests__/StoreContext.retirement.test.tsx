/**
 * Pins the two dispatcher call sites of `retireDepartedPresentationBitmaps`
 * (`StoreContext.tsx`), the only way a presentation cache leaves the live layer
 * record through a document transition.
 *
 * The invariant under test is bitmap identity, not layer identity: a cache is
 * retired only when the `previous` record named it and the `next` record does
 * not. The three claims of the function's own doc comment are each pinned here —
 * `deletedLayers` and layer identity are not consulted, ownership still decides,
 * and a cache that merely moved to another layer stays live — because a
 * retirement keyed on layer identity would close the bitmap of a layer that is
 * still painted on screen, which is exactly the case the `APPLY_HISTORY_REPLAY`
 * call site names in its comment.
 */
import { act, render } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { type StoreData, type StoreDispatch, StoreProvider, useStore } from '../StoreContext.tsx';
import { createMockImageBitmap, createMockOffscreenCanvas } from '../../__tests__/fixtures/canvas.ts';
import { createMockLayer } from '../../__tests__/fixtures/layer.ts';
import type { HistoryItem } from '../history-types.ts';
import type { Layer, LayersRecord } from '../layer-types.ts';
import type { BitmapSource } from '../general-types.ts';
import { MERGE_ACTION, OPEN_DOCUMENT_ACTION, REMOVE_ACTION, RENAME_LAYER_ACTION } from '../../util/constants.ts';
import type { ActionType } from '../../util/constants.ts';

const layerId = 'layer-1';
const secondLayerId = 'layer-2';
const thirdLayerId = 'layer-3';
const initialSize = { width: 400, height: 300 };
const defaultFrame = { x: 0, y: 0, width: 400, height: 300 };

/** `Action` and `StoreUpdates` are module-private, so the payload shapes are derived. */
type StoreAction = Parameters<StoreDispatch>[0];
type ReplayPayload = Extract<StoreAction, { type: 'APPLY_HISTORY_REPLAY' }>['payload'];
type CommitPayload = Extract<StoreAction, { type: 'COMMIT_DOCUMENT_EDIT' }>['payload'];
type StoreUpdates = ReplayPayload['updates'];

type PromotionRequest = Readonly<{ layerId: string; canvas: BitmapSource }>;

/**
 * Per-instance `close` observation.
 *
 * The shared `createMockImageBitmap` fixture mints a fresh `close: vi.fn()` on
 * every call, so the spy is reached through the bitmap itself rather than through
 * any shared module-level mock: a shared spy could not tell "this cache was
 * closed" from "some other cache was closed".
 */
const closeOf = (bitmap: unknown) => (bitmap as unknown as { close: ReturnType<typeof vi.fn> }).close;

/**
 * Materializes each requested canvas into the bitmap the map names.
 *
 * An unmapped canvas throws rather than yielding a throwaway bitmap: a silent
 * fallback would publish a cache no assertion can reach, so a mistyped request
 * would leave the test green while testing nothing.
 */
function stubPromotion(byCanvas: ReadonlyMap<BitmapSource, BitmapSource>): void {
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async (source: unknown) => {
      const bitmap = byCanvas.get(source as BitmapSource);
      if (!bitmap) throw new Error('unmapped canvas in promotion');
      return bitmap;
    })
  );
}

/**
 * Materializes any canvas into a DISTINCT cache per call, and reads back the one
 * most recently minted.
 *
 * A stub that always answered with the same object would hand a "fresh" cache the
 * identity of the retired one, so two promotions in one test could silently share
 * a bitmap — the exact confusion this file exists to rule out.
 */
function stubFreshPromotion(width = 100, height = 80): () => ImageBitmap {
  const minted: ImageBitmap[] = [];
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => {
      const bitmap = createMockImageBitmap(width, height);
      minted.push(bitmap);
      return bitmap;
    })
  );
  return () => {
    const bitmap = minted.at(-1);
    if (!bitmap) throw new Error('no presentation cache has been materialized');
    return bitmap;
  };
}

function canvas(width = 100, height = 80): BitmapSource {
  return createMockOffscreenCanvas(width, height);
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

/** Reads the layer the live record holds, so no transition is handed a stale copy. */
function layerAt(store: () => StoreData, id: string): Layer {
  const layer = store().layers[id];
  if (!layer) throw new Error(`layer ${id} is not in the live record`);
  return layer;
}

/**
 * Publishes each layer's canvas, which is the only route to a cache the
 * presentation scope actually owns — a bitmap written straight into `layers` is
 * borrowed, and `retire` deliberately declines to close a borrowed raster.
 */
async function publish(store: StoreData, requests: readonly PromotionRequest[]) {
  await act(async () => {
    store.promoteLayerPresentation(requests);
    await Promise.resolve();
  });
}

function replay(dispatch: StoreDispatch, updates: StoreUpdates, cursor = 0) {
  const payload: ReplayPayload = {
    updates,
    timeline: { entries: [baselineItem({})], cursor, branchRevision: 0 },
  };
  act(() => {
    dispatch({ type: 'APPLY_HISTORY_REPLAY', payload });
  });
}

function commit(dispatch: StoreDispatch, updates: StoreUpdates, actionName: ActionType = MERGE_ACTION) {
  const payload: CommitPayload = {
    updates,
    historyItem: { id: `commit-${actionName}`, actionName, layerId, args: {} },
  };
  act(() => {
    dispatch({ type: 'COMMIT_DOCUMENT_EDIT', payload });
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('retirement at the APPLY_HISTORY_REPLAY call site', () => {
  it('closes a cache a replayed removal dropped, and never closes the one a redo re-creates the layer with', async () => {
    const cacheA = createMockImageBitmap(100, 80);
    const stagedA = createMockOffscreenCanvas(100, 80);
    stubPromotion(new Map([[stagedA, cacheA]]));
    const { store, dispatch } = renderWithProbe();
    replaceDocument(dispatch(), { [layerId]: layerWithCanvas(layerId, stagedA) });
    await publish(store(), [{ layerId, canvas: stagedA }]);
    expect(store().layers[layerId].bitmap).toBe(cacheA);
    expect(closeOf(cacheA)).not.toHaveBeenCalled();

    // Navigating over the removal drops the layer and its cache from the record.
    replay(dispatch(), { layers: {}, deletedLayers: { [layerId]: layerAt(store, layerId) } });
    expect(store().layers[layerId]).toBeUndefined();
    expect(closeOf(cacheA)).toHaveBeenCalledTimes(1);

    // Navigating back re-creates the layer under the SAME id with no cache at
    // all — the case the call site names, and the one an identity-based
    // retirement would blank.
    const stagedRedo = createMockOffscreenCanvas(100, 80);
    replay(dispatch(), {
      layers: { [layerId]: layerWithCanvas(layerId, stagedRedo) },
      deletedLayers: {},
    });
    expect(store().layers[layerId]).toBeDefined();
    expect(store().layers[layerId].bitmap).toBeNull();
    expect(closeOf(cacheA)).toHaveBeenCalledTimes(1);

    // The redo's own cache is published, and the re-used id does not close it.
    const cacheRedo = createMockImageBitmap(100, 80);
    stubPromotion(new Map([[stagedRedo, cacheRedo]]));
    await publish(store(), [{ layerId, canvas: stagedRedo }]);
    expect(store().layers[layerId].bitmap).toBe(cacheRedo);
    expect(closeOf(cacheRedo)).not.toHaveBeenCalled();
    expect(closeOf(cacheA)).toHaveBeenCalledTimes(1);
  });

  it('leaves a layer that survives replay holding the SAME cache object open', async () => {
    const cache = createMockImageBitmap(100, 80);
    const staged = createMockOffscreenCanvas(100, 80);
    stubPromotion(new Map([[staged, cache]]));
    const { store, dispatch } = renderWithProbe();
    replaceDocument(dispatch(), { [layerId]: layerWithCanvas(layerId, staged) });
    await publish(store(), [{ layerId, canvas: staged }]);
    const before = layerAt(store, layerId);

    // The replay rebuilds the layer as a NEW object and changes durable state,
    // while carrying the already-painted cache over by reference.
    replay(dispatch(), { layers: { [layerId]: { ...before, name: 'Renamed by replay', order: 3 } } });

    const after = layerAt(store, layerId);
    expect(after).not.toBe(before);
    expect(after.name).toBe('Renamed by replay');
    expect(after.bitmap).toBe(cache);
    expect(closeOf(cache)).not.toHaveBeenCalled();
  });

  it('closes only the cache a same-id replay replaced, and leaves the live one open', async () => {
    const cacheA = createMockImageBitmap(100, 80);
    const cacheB = createMockImageBitmap(100, 80);
    const stagedA = createMockOffscreenCanvas(100, 80);
    const stagedB = createMockOffscreenCanvas(100, 80);
    stubPromotion(
      new Map([
        [stagedA, cacheA],
        [stagedB, cacheB],
      ])
    );
    const { store, dispatch } = renderWithProbe();
    replaceDocument(dispatch(), {
      [layerId]: layerWithCanvas(layerId, stagedA),
      [secondLayerId]: layerWithCanvas(secondLayerId, stagedB),
    });
    await publish(store(), [
      { layerId, canvas: stagedA },
      { layerId: secondLayerId, canvas: stagedB },
    ]);

    // The same id comes back pointing at a DIFFERENT scope-published cache,
    // because the layer that held it was merged away.
    replay(dispatch(), {
      layers: { [layerId]: { ...layerAt(store, layerId), bitmap: cacheB, tmpCanvas: null } },
      deletedLayers: { [secondLayerId]: layerAt(store, secondLayerId) },
    });

    expect(store().layers[secondLayerId]).toBeUndefined();
    expect(store().layers[layerId].bitmap).toBe(cacheB);
    expect(closeOf(cacheA)).toHaveBeenCalledTimes(1);
    expect(closeOf(cacheB)).not.toHaveBeenCalled();
  });

  it('leaves a cache open when it only moved to another layer', async () => {
    const cacheA = createMockImageBitmap(100, 80);
    const cacheB = createMockImageBitmap(100, 80);
    const stagedA = createMockOffscreenCanvas(100, 80);
    const stagedB = createMockOffscreenCanvas(100, 80);
    stubPromotion(
      new Map([
        [stagedA, cacheA],
        [stagedB, cacheB],
      ])
    );
    const { store, dispatch } = renderWithProbe();
    replaceDocument(dispatch(), {
      [layerId]: layerWithCanvas(layerId, stagedA),
      [secondLayerId]: layerWithCanvas(secondLayerId, stagedB),
    });
    await publish(store(), [
      { layerId, canvas: stagedA },
      { layerId: secondLayerId, canvas: stagedB },
    ]);

    // A pure move: both layers survive and each cache is now named by the other
    // layer, so neither one departed the record.
    replay(dispatch(), {
      layers: {
        [layerId]: { ...layerAt(store, layerId), bitmap: cacheB, tmpCanvas: null },
        [secondLayerId]: { ...layerAt(store, secondLayerId), bitmap: cacheA, tmpCanvas: null },
      },
    });

    expect(store().layers[layerId].bitmap).toBe(cacheB);
    expect(store().layers[secondLayerId].bitmap).toBe(cacheA);
    expect(closeOf(cacheA)).not.toHaveBeenCalled();
    expect(closeOf(cacheB)).not.toHaveBeenCalled();
  });

  it('does not consult deletedLayers, which keeps naming caches the live record still holds', async () => {
    const cacheA = createMockImageBitmap(100, 80);
    const cacheB = createMockImageBitmap(100, 80);
    const stagedA = createMockOffscreenCanvas(100, 80);
    const stagedB = createMockOffscreenCanvas(100, 80);
    stubPromotion(
      new Map([
        [stagedA, cacheA],
        [stagedB, cacheB],
      ])
    );
    const { store, dispatch } = renderWithProbe();
    replaceDocument(dispatch(), {
      [layerId]: layerWithCanvas(layerId, stagedA),
      [secondLayerId]: layerWithCanvas(secondLayerId, stagedB),
    });
    await publish(store(), [
      { layerId, canvas: stagedA },
      { layerId: secondLayerId, canvas: stagedB },
    ]);
    const removed = layerAt(store, secondLayerId);

    // The deleted record still names layer-2's cache while the live record
    // names it too, because a deleted record accumulates and survives undo.
    replay(dispatch(), {
      layers: {
        [layerId]: layerAt(store, layerId),
        [secondLayerId]: { ...removed, name: 'Restored by replay' },
      },
      deletedLayers: { [secondLayerId]: removed },
    });

    expect(store().layers[secondLayerId].bitmap).toBe(cacheB);
    expect(closeOf(cacheA)).not.toHaveBeenCalled();
    expect(closeOf(cacheB)).not.toHaveBeenCalled();
  });

  it('leaves a borrowed raster the scope never published open on the replay path', async () => {
    const borrowed = createMockImageBitmap(10, 10);
    const staged = createMockOffscreenCanvas(100, 80);
    const latestOwnedCache = stubFreshPromotion();
    const { store, dispatch } = renderWithProbe();
    replaceDocument(dispatch(), {
      [layerId]: layerWithCanvas(layerId, staged),
      [secondLayerId]: { ...layerWithCanvas(secondLayerId, null), bitmap: borrowed },
    });
    await publish(store(), [{ layerId, canvas: staged }]);
    const owned = latestOwnedCache();
    expect(layerAt(store, layerId).bitmap).toBe(owned);
    expect(layerAt(store, secondLayerId).bitmap).toBe(borrowed);

    // The borrowed layer is named by `previous` and gone from `next`, so `retire`
    // IS asked to close it — and declines, because the scope never published it.
    replay(dispatch(), {
      layers: { [layerId]: layerAt(store, layerId) },
      deletedLayers: { [secondLayerId]: layerAt(store, secondLayerId) },
    });

    expect(store().layers[secondLayerId]).toBeUndefined();
    expect(closeOf(borrowed)).not.toHaveBeenCalled();
    expect(closeOf(owned)).not.toHaveBeenCalled();
  });
});

describe('retirement at the COMMIT_DOCUMENT_EDIT call site', () => {
  it('closes the cache a commit swapped out of a layer and leaves the new one open', async () => {
    const cacheA = createMockImageBitmap(100, 80);
    const cacheB = createMockImageBitmap(100, 80);
    const stagedA = createMockOffscreenCanvas(100, 80);
    const stagedB = createMockOffscreenCanvas(100, 80);
    stubPromotion(
      new Map([
        [stagedA, cacheA],
        [stagedB, cacheB],
      ])
    );
    const { store, dispatch } = renderWithProbe();
    replaceDocument(dispatch(), {
      [layerId]: layerWithCanvas(layerId, stagedA),
      [secondLayerId]: layerWithCanvas(secondLayerId, stagedB),
    });
    await publish(store(), [
      { layerId, canvas: stagedA },
      { layerId: secondLayerId, canvas: stagedB },
    ]);

    // One commit swaps layer-1's cache for a different published cache and drops
    // the layer that had it.
    commit(
      dispatch(),
      {
        layers: { [layerId]: { ...layerAt(store, layerId), bitmap: cacheB, tmpCanvas: null } },
        deletedLayers: { [secondLayerId]: layerAt(store, secondLayerId) },
      },
      MERGE_ACTION
    );

    expect(store().layers[secondLayerId]).toBeUndefined();
    expect(store().layers[layerId].bitmap).toBe(cacheB);
    expect(closeOf(cacheA)).toHaveBeenCalledTimes(1);
    expect(closeOf(cacheB)).not.toHaveBeenCalled();
  });

  it('closes only the departed cache when a commit removes one layer of several', async () => {
    const cacheA = createMockImageBitmap(100, 80);
    const cacheB = createMockImageBitmap(100, 80);
    const stagedA = createMockOffscreenCanvas(100, 80);
    const stagedB = createMockOffscreenCanvas(100, 80);
    stubPromotion(
      new Map([
        [stagedA, cacheA],
        [stagedB, cacheB],
      ])
    );
    const { store, dispatch } = renderWithProbe();
    replaceDocument(dispatch(), {
      [layerId]: layerWithCanvas(layerId, stagedA),
      [secondLayerId]: layerWithCanvas(secondLayerId, stagedB),
    });
    await publish(store(), [
      { layerId, canvas: stagedA },
      { layerId: secondLayerId, canvas: stagedB },
    ]);

    commit(
      dispatch(),
      {
        layers: { [secondLayerId]: layerAt(store, secondLayerId) },
        deletedLayers: { [layerId]: layerAt(store, layerId) },
      },
      REMOVE_ACTION
    );

    expect(store().layers[layerId]).toBeUndefined();
    expect(closeOf(cacheA)).toHaveBeenCalledTimes(1);
    expect(closeOf(cacheB)).not.toHaveBeenCalled();
  });

  it('closes EVERY departed cache of one transition, not just the first', async () => {
    // The single-removal test above cannot tell "closed the one departure" from
    // "closed every departure", because one transition there had one candidate.
    // A multi-select delete or a multi-layer merge drops several at once, so the
    // loop's cardinality is pinned here: both departures are closed, and the
    // surviving layer's unpublished cache is not closed a third time.
    const cacheA = createMockImageBitmap(100, 80);
    const cacheB = createMockImageBitmap(60, 40);
    const stagedA = createMockOffscreenCanvas(100, 80);
    const stagedB = createMockOffscreenCanvas(60, 40);
    stubPromotion(
      new Map([
        [stagedA, cacheA],
        [stagedB, cacheB],
      ])
    );
    const { store, dispatch } = renderWithProbe();
    replaceDocument(dispatch(), {
      [layerId]: layerWithCanvas(layerId, stagedA),
      [secondLayerId]: layerWithCanvas(secondLayerId, stagedB),
      [thirdLayerId]: layerWithCanvas(thirdLayerId, canvas(30, 20)),
    });
    await publish(store(), [
      { layerId, canvas: stagedA },
      { layerId: secondLayerId, canvas: stagedB },
    ]);
    // Exactly two caches are scope-owned here: layer-3 is never promoted, so it
    // contributes no candidate and proves the loop does not over-close either.
    expect(layerAt(store, layerId).bitmap).toBe(cacheA);
    expect(layerAt(store, secondLayerId).bitmap).toBe(cacheB);
    expect(layerAt(store, thirdLayerId).bitmap).toBeNull();

    commit(
      dispatch(),
      {
        layers: { [thirdLayerId]: layerAt(store, thirdLayerId) },
        deletedLayers: { [layerId]: layerAt(store, layerId), [secondLayerId]: layerAt(store, secondLayerId) },
      },
      REMOVE_ACTION
    );

    expect(store().layers[layerId]).toBeUndefined();
    expect(store().layers[secondLayerId]).toBeUndefined();
    expect(closeOf(cacheA)).toHaveBeenCalledTimes(1);
    expect(closeOf(cacheB)).toHaveBeenCalledTimes(1);
  });

  it('closes nothing when a commit changes a layer without touching its cache', async () => {
    const cache = createMockImageBitmap(100, 80);
    const staged = createMockOffscreenCanvas(100, 80);
    stubPromotion(new Map([[staged, cache]]));
    const { store, dispatch } = renderWithProbe();
    replaceDocument(dispatch(), { [layerId]: layerWithCanvas(layerId, staged) });
    await publish(store(), [{ layerId, canvas: staged }]);
    const before = layerAt(store, layerId);

    commit(
      dispatch(),
      {
        layers: {
          [layerId]: { ...before, name: 'Renamed by commit', pos: { ...before.pos, x: 24 } },
          [secondLayerId]: layerWithCanvas(secondLayerId, null),
        },
      },
      RENAME_LAYER_ACTION
    );

    const after = layerAt(store, layerId);
    expect(after).not.toBe(before);
    expect(after.name).toBe('Renamed by commit');
    expect(after.bitmap).toBe(cache);
    expect(closeOf(cache)).not.toHaveBeenCalled();
  });

  it('leaves a cache open when a commit only moves it to another layer', async () => {
    const cacheA = createMockImageBitmap(100, 80);
    const cacheB = createMockImageBitmap(100, 80);
    const stagedA = createMockOffscreenCanvas(100, 80);
    const stagedB = createMockOffscreenCanvas(100, 80);
    stubPromotion(
      new Map([
        [stagedA, cacheA],
        [stagedB, cacheB],
      ])
    );
    const { store, dispatch } = renderWithProbe();
    replaceDocument(dispatch(), {
      [layerId]: layerWithCanvas(layerId, stagedA),
      [secondLayerId]: layerWithCanvas(secondLayerId, stagedB),
      [thirdLayerId]: layerWithCanvas(thirdLayerId, canvas(60, 40)),
    });
    await publish(store(), [
      { layerId, canvas: stagedA },
      { layerId: secondLayerId, canvas: stagedB },
    ]);

    // A three-way move: every published cache is still named by the record.
    commit(
      dispatch(),
      {
        layers: {
          [layerId]: { ...layerAt(store, layerId), bitmap: null, tmpCanvas: null },
          [secondLayerId]: { ...layerAt(store, secondLayerId), bitmap: cacheA, tmpCanvas: null },
          [thirdLayerId]: { ...layerAt(store, thirdLayerId), bitmap: cacheB, tmpCanvas: null },
        },
      },
      MERGE_ACTION
    );

    expect(store().layers[secondLayerId].bitmap).toBe(cacheA);
    expect(store().layers[thirdLayerId].bitmap).toBe(cacheB);
    expect(closeOf(cacheA)).not.toHaveBeenCalled();
    expect(closeOf(cacheB)).not.toHaveBeenCalled();
  });

  it('leaves a borrowed raster the scope never published open on the commit path', async () => {
    const borrowed = createMockImageBitmap(10, 10);
    const staged = createMockOffscreenCanvas(100, 80);
    const latestOwnedCache = stubFreshPromotion();
    const { store, dispatch } = renderWithProbe();
    replaceDocument(dispatch(), {
      [layerId]: layerWithCanvas(layerId, staged),
      [secondLayerId]: { ...layerWithCanvas(secondLayerId, null), bitmap: borrowed },
    });
    await publish(store(), [{ layerId, canvas: staged }]);
    const owned = latestOwnedCache();
    expect(layerAt(store, layerId).bitmap).toBe(owned);
    expect(layerAt(store, secondLayerId).bitmap).toBe(borrowed);

    commit(
      dispatch(),
      {
        layers: { [layerId]: layerAt(store, layerId) },
        deletedLayers: { [secondLayerId]: layerAt(store, secondLayerId) },
      },
      REMOVE_ACTION
    );

    expect(store().layers[secondLayerId]).toBeUndefined();
    expect(closeOf(borrowed)).not.toHaveBeenCalled();
    expect(closeOf(owned)).not.toHaveBeenCalled();
  });
});
