import { act, render } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import * as durableCompositor from '../durable-compositor.ts';
import type { DurableComposite } from '../durable-compositor.ts';
import {
  durablePresentationIsRendererIdentical,
  type DurableNavigationPresentationOutcome,
  type StoreData,
  type StoreDispatch,
  StoreProvider,
  useStore,
} from '../StoreContext.tsx';
import { createMockImageBitmap, createMockOffscreenCanvas } from '../../__tests__/fixtures/canvas.ts';
import { createMockLayer } from '../../__tests__/fixtures/layer.ts';
import type { HistoryItem } from '../history-types.ts';
import type { ImageLayerSource, Layer, LayersRecord } from '../layer-types.ts';
import type { MaterializedLayer } from '../materialization.ts';
import type { BitmapSource } from '../general-types.ts';
import { OPEN_DOCUMENT_ACTION, REMOVE_ACTION, SET_LAYER_OPACITY_ACTION, TOOL_ACTION } from '../../util/constants.ts';

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

/** Navigates history: the second way a layer can leave the live record. */
function replayTo(dispatch: StoreDispatch, layers: LayersRecord, deletedLayers: LayersRecord, cursor = 0) {
  act(() => {
    dispatch({
      type: 'APPLY_HISTORY_REPLAY',
      payload: {
        updates: { layers, deletedLayers, activeLayerId: null },
        timeline: { entries: [baselineItem(layers, 'baseline')], cursor, branchRevision: 0 },
      },
    });
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('durable render presentation guard', () => {
  it('accepts a cache only when the renderer would not reapply logical presentation', () => {
    const existing = createMockLayer({ id: layerId, pos: { x: 10, y: 20, width: 100, height: 50 } });
    const replayLayer = { operations: [] as readonly [], snapshot: { source: { kind: 'raster' as const } } };

    expect(durablePresentationIsRendererIdentical(replayLayer as never, existing, existing.pos)).toBe(true);
    expect(
      durablePresentationIsRendererIdentical(replayLayer as never, existing, { ...existing.pos, width: 101 })
    ).toBe(false);
    expect(
      durablePresentationIsRendererIdentical(
        { ...replayLayer, operations: [{ kind: 'apply-filter' }] } as never,
        existing,
        existing.pos
      )
    ).toBe(false);
    expect(
      durablePresentationIsRendererIdentical(
        { ...replayLayer, snapshot: { source: { kind: 'vector' as const } } } as never,
        existing,
        existing.pos
      )
    ).toBe(true);
  });
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
      store().publishRuntimePresentation({ [layerId]: layerWithCanvas(layerId, newer) });
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
      store().publishRuntimePresentation({ [layerId]: { ...store().layers[layerId], tmpCanvas: stagedAgain } });
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

  it('retires a published cache when its layer is removed, and leaves a borrowed raster alone', async () => {
    // Layer removal nulls both presentation fields on the record it files under
    // `deletedLayers`, so the presentation scope's set is the only remaining owner
    // of the bitmap it published. A promote → delete cycle otherwise strands one
    // full-raster ImageBitmap per layer for the lifetime of the provider, because
    // a later promotion builds `superseded` from the *current* layer and can never
    // reach a deleted one.
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
    expect(store().layers[layerId].bitmap).toBe(owned);

    const removed = store().layers[layerId];
    act(() => {
      dispatch()({
        type: 'COMMIT_DOCUMENT_EDIT',
        payload: {
          updates: {
            layers: {},
            deletedLayers: { [layerId]: { ...removed, bitmap: null, tmpCanvas: null } },
            activeLayerId: null,
          },
          historyItem: { id: 'remove-1', actionName: REMOVE_ACTION, layerId, args: {} },
        },
      });
    });

    expect(store().layers[layerId]).toBeUndefined();
    expect(owned.close).toHaveBeenCalledTimes(1);
    // A borrowed raster from an import or a replay is not owned by this boundary.
    expect(borrowed.close).not.toHaveBeenCalled();
  });

  it('does not close a restored layer cache when a later removal re-files it', async () => {
    // `deletedLayers` accumulates across removals AND survives undo: `useHistory`
    // forwards it verbatim while replay re-creates the removed layer. So it keeps
    // naming a layer that is live again, with a freshly promoted cache. Retiring by
    // name would close exactly that bitmap, and a closed ImageBitmap makes
    // `ctx.drawImage` throw, which stops the layer rendering. Retirement is
    // therefore driven off the live set, not off `deletedLayers`.
    const firstA = createMockImageBitmap(100, 80);
    const restoredA = createMockImageBitmap(100, 80);
    const firstB = createMockImageBitmap(60, 40);
    const queue = [firstA, firstB, restoredA];
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => queue.shift())
    );
    const canvasA = canvas();
    const canvasB = canvas(60, 40);
    const { store, dispatch } = renderWithProbe();
    replaceDocument(dispatch(), {
      [layerId]: layerWithCanvas(layerId, canvasA),
      'layer-2': layerWithCanvas('layer-2', canvasB),
    });
    await promote(store(), [
      { layerId, canvas: canvasA },
      { layerId: 'layer-2', canvas: canvasB },
    ]);
    expect(store().layers[layerId].bitmap).toBe(firstA);

    const removedA = store().layers[layerId];
    const removal = { [layerId]: { ...removedA, bitmap: null, tmpCanvas: null } };
    act(() => {
      dispatch()({
        type: 'COMMIT_DOCUMENT_EDIT',
        payload: {
          updates: {
            layers: { 'layer-2': store().layers['layer-2'] },
            deletedLayers: removal,
            activeLayerId: null,
          },
          historyItem: { id: 'remove-a', actionName: REMOVE_ACTION, layerId, args: {} },
        },
      });
    });
    expect(firstA.close).toHaveBeenCalledTimes(1);

    // Undo re-creates layer-1, and the accumulated `deletedLayers` still names it.
    const revived = { ...removedA, bitmap: null, tmpCanvas: canvas() };
    replayTo(dispatch(), { [layerId]: revived, 'layer-2': store().layers['layer-2'] }, removal);
    expect(store().layers[layerId]).toBeDefined();

    await promote(store(), { layerId, canvas: revived.tmpCanvas });
    expect(store().layers[layerId].bitmap).toBe(restoredA);

    // Removing a DIFFERENT layer re-files layer-1 in `deletedLayers` again.
    const removedB = store().layers['layer-2'];
    act(() => {
      dispatch()({
        type: 'COMMIT_DOCUMENT_EDIT',
        payload: {
          updates: {
            layers: { [layerId]: store().layers[layerId] },
            deletedLayers: { ...removal, 'layer-2': { ...removedB, bitmap: null, tmpCanvas: null } },
            activeLayerId: layerId,
          },
          historyItem: { id: 'remove-b', actionName: REMOVE_ACTION, layerId: 'layer-2', args: {} },
        },
      });
    });

    // The departed layer's cache is KEPT, because the history entry the undo
    // landed still aliases it: `collectLivePresentationBitmaps` walks
    // `entry.documentSource.layers`, and `history-replay` reads that record back,
    // so closing it would be a use-after-close on the replay authority rather
    // than a leak. Liveness, not the name in `deletedLayers`, decides.
    expect(store().layers['layer-2']).toBeUndefined();
    expect(firstB.close).not.toHaveBeenCalled();
    // ...and the live, restored layer keeps a usable cache. This is the half a
    // name-driven retirement gets wrong: `deletedLayers` still names layer-1, so
    // retiring by name would close the cache of a layer that is live again.
    expect(restoredA.close).not.toHaveBeenCalled();
    expect(store().layers[layerId].bitmap).toBe(restoredA);
  });

  it('closes a layer cache that a redo drops from the record', async () => {
    // A replay is the other way a layer leaves the live record. Without the same
    // retirement on `APPLY_HISTORY_REPLAY`, a redo past a removal strands the
    // bitmap exactly the way a delete does.
    const owned = createMockImageBitmap(100, 80);
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => owned)
    );
    const staged = canvas();
    const { store, dispatch } = renderWithProbe();
    replaceDocument(dispatch(), { [layerId]: layerWithCanvas(layerId, staged) });
    await promote(store(), { layerId, canvas: staged });
    expect(store().layers[layerId].bitmap).toBe(owned);

    // A redo whose cursor predates the layer's creation drops it from the record.
    replayTo(dispatch(), {}, {}, -1);

    expect(store().layers[layerId]).toBeUndefined();
    expect(owned.close).toHaveBeenCalledTimes(1);
  });
});

describe('durable navigation presentation freshness', () => {
  it('declines a composition after the same document ID is replaced with a new frame', async () => {
    const sourceBitmap = createMockImageBitmap(100, 80);
    const staged = canvas(100, 80);
    const pos = { x: 0, y: 0, width: 100, height: 80 };
    const source: ImageLayerSource = { kind: 'image', bitmap: sourceBitmap, isBedrock: false, pos };
    const existingLayer: Layer = {
      ...createMockLayer({ id: layerId, pos }),
      bitmap: sourceBitmap,
      tmpCanvas: staged,
      source,
    };
    const materializedBitmap = createMockImageBitmap(100, 80);
    const releaseMaterialized = vi.fn();
    const materialized: MaterializedLayer = {
      layerId,
      bitmap: materializedBitmap,
      bounds: pos,
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      lease: {
        key: 'stale-frame-composition',
        bitmap: materializedBitmap,
        byteSize: 100 * 80 * 4,
        metadata: pos,
        release: releaseMaterialized,
      },
    };
    const layers = { [layerId]: materialized };
    const releaseDetached = vi.fn(() => releaseMaterialized());
    // The real compositor's `release()` falls through to `releaseLayers()` and
    // thus `materialized.release()` when `takeLayers()` was never called. Mirror
    // that here so the stale path is verified to release the materialized bundle
    // through the composite, not through the detached handle.
    const releaseComposite = vi.fn(() => releaseMaterialized());
    const composite: DurableComposite = {
      bitmap: materializedBitmap,
      frame: defaultFrame,
      layers,
      takeLayers: () => ({ layers, release: releaseDetached }),
      release: releaseComposite,
    };
    let finishComposition!: () => void;
    const composition = new Promise<void>((resolve) => {
      finishComposition = resolve;
    });
    const compose = vi.spyOn(durableCompositor, 'composeDurableDocument').mockImplementation(async () => {
      await composition;
      return composite;
    });

    const { store, dispatch } = renderWithProbe();
    replaceDocument(dispatch(), { [layerId]: existingLayer });
    replayTo(dispatch(), { [layerId]: existingLayer }, {});
    const publication = store().publishDurableNavigationPresentation();
    expect(compose).toHaveBeenCalledTimes(1);

    const changedFrame = { x: 12, y: 8, width: 200, height: 150 };
    const replacementHistory: HistoryItem[] = [
      {
        id: 'baseline',
        actionName: OPEN_DOCUMENT_ACTION,
        layerId,
        documentSource: {
          layers: { [layerId]: existingLayer },
          size: { width: 200, height: 150 },
          frame: changedFrame,
        },
      },
    ];
    act(() => {
      dispatch()({
        type: 'REPLACE_DOCUMENT',
        payload: {
          documentId: 'doc-1',
          history: replacementHistory,
          historyIndex: 0,
          updates: {
            layers: { [layerId]: existingLayer },
            documentFrame: changedFrame,
            totalSize: { width: 200, height: 150 },
          },
        },
      });
    });
    expect(store().durableStatus).toBe('current');

    await act(async () => {
      finishComposition();
      await composition;
      await publication;
      await Promise.resolve();
    });

    expect(store().documentFrame).toEqual(changedFrame);
    expect(store().durableStatus).toBe('current');
    expect(store().layers[layerId].tmpCanvas).toBe(staged);
    // Freshness is checked before `takeLayers()`, so a stale candidate releases
    // the composite/materialized bundle through `composite.release()` — the
    // detached handle is never produced and never released.
    expect(releaseDetached).not.toHaveBeenCalled();
    expect(releaseMaterialized).toHaveBeenCalledOnce();
    expect(releaseComposite).toHaveBeenCalledOnce();
    expect(store().durablePresentation).toEqual({
      status: 'unpublished',
      cursor: null,
      reason: null,
    });
  });

  it('rejects a delayed navigation publication when SET_SIZE invalidates the shadow mid-composition', async () => {
    const sourceBitmap = createMockImageBitmap(100, 80);
    const staged = canvas(100, 80);
    const pos = { x: 0, y: 0, width: 100, height: 80 };
    const source: ImageLayerSource = { kind: 'image', bitmap: sourceBitmap, isBedrock: false, pos };
    const existingLayer: Layer = {
      ...createMockLayer({ id: layerId, pos }),
      bitmap: sourceBitmap,
      tmpCanvas: staged,
      source,
    };
    const materializedBitmap = createMockImageBitmap(100, 80);
    const releaseMaterialized = vi.fn();
    const materialized: MaterializedLayer = {
      layerId,
      bitmap: materializedBitmap,
      bounds: pos,
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      lease: {
        key: 'stale-set-size',
        bitmap: materializedBitmap,
        byteSize: 100 * 80 * 4,
        metadata: pos,
        release: releaseMaterialized,
      },
    };
    const layers = { [layerId]: materialized };
    const releaseDetached = vi.fn(() => releaseMaterialized());
    const releaseComposite = vi.fn(() => releaseMaterialized());
    const composite: DurableComposite = {
      bitmap: materializedBitmap,
      frame: defaultFrame,
      layers,
      takeLayers: () => ({ layers, release: releaseDetached }),
      release: releaseComposite,
    };
    let finishComposition!: () => void;
    const composition = new Promise<void>((resolve) => {
      finishComposition = resolve;
    });
    const compose = vi.spyOn(durableCompositor, 'composeDurableDocument').mockImplementation(async () => {
      await composition;
      return composite;
    });

    const { store, dispatch } = renderWithProbe();
    replaceDocument(dispatch(), { [layerId]: existingLayer });
    replayTo(dispatch(), { [layerId]: existingLayer }, {});
    const publication = store().publishDurableNavigationPresentation();
    expect(compose).toHaveBeenCalledTimes(1);

    // SET_SIZE moves a durable input (totalSize) and downgrades the shadow to
    // `stale` while the composition is still pending.
    act(() => {
      dispatch()({ type: 'SET_SIZE', payload: { width: 500, height: 400 } });
    });
    expect(store().durableStatus).toBe('stale');
    expect(store().totalSize).toEqual({ width: 500, height: 400 });

    // Resolve the pending composition. It was on track to publish a `durable`
    // record, but assertFresh() detects the staleness and throws before any
    // cache publication. The catch then publishes a `legacy-fallback` record —
    // BOTH the `durable` record (blocked by assertFresh) and the
    // `legacy-fallback` record (rejected by the SET_DURABLE_PRESENTATION
    // freshness gate) fail to land.
    await act(async () => {
      finishComposition();
      await composition;
      await publication;
      await Promise.resolve();
    });

    expect(store().durableStatus).toBe('stale');
    expect(store().totalSize).toEqual({ width: 500, height: 400 });
    expect(store().durablePresentation).toEqual({
      status: 'unpublished',
      cursor: null,
      reason: null,
    });
    expect(releaseDetached).not.toHaveBeenCalled();
    expect(releaseMaterialized).toHaveBeenCalledOnce();
    expect(releaseComposite).toHaveBeenCalledOnce();
    // No partial cache publication: the layer keeps its original canvas and
    // bitmap.
    expect(store().layers[layerId].tmpCanvas).toBe(staged);
    expect(store().layers[layerId].bitmap).toBe(sourceBitmap);
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
      store().publishRuntimePresentation({ [layerId]: published });
    });

    expect(store().layers[layerId]).toBe(published);
    expect(store().history).toBe(before.history);
    expect(store().historyIndex).toBe(before.historyIndex);
    expect(store().hasUnsavedChanges).toBe(before.hasUnsavedChanges);
    expect(store().durableDocument).toBe(before.durableDocument);
    expect(store().durableStatus).toBe(before.durableStatus);
  });

  it('publishes a baked durable presentation without changing logical layer fields', () => {
    const { store, dispatch } = renderWithProbe();
    replaceDocument(dispatch(), { [layerId]: layerWithCanvas(layerId, null) });
    const before = store();
    const bitmap = createMockImageBitmap();
    const published = {
      ...before.layers[layerId],
      bitmap: null,
      tmpCanvas: bitmap,
      presentationBounds: before.layers[layerId].pos,
    };

    act(() => {
      store().publishRuntimePresentation({ [layerId]: published });
    });

    expect(store().layers[layerId]).toBe(published);
    expect(store().layers[layerId].source).toBe(before.layers[layerId].source);
    expect(store().layers[layerId].operations).toBe(before.layers[layerId].operations);
    expect(store().history).toBe(before.history);
    expect(bitmap.close).not.toHaveBeenCalled();
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
      store().publishRuntimePresentation({
        [layerId]: { ...before, pos: { x: 99, y: 0, width: 100, height: 80 } },
        'layer-2': { ...store().layers['layer-2'], name: 'renamed' },
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
      store().publishRuntimePresentation({
        [layerId]: {
          ...before,
          operations: [{ id: 'op-1', args: { toolName: 'blur', radius: 9 }, enabled: true }],
        },
      });
    });

    expect(store().layers[layerId]).toBe(before);
    expect(store().layers[layerId].operations).toEqual([]);
  });
});

describe('renderSelector contract', () => {
  function rasterLayer(id = layerId, pos = { x: 0, y: 0, width: 100, height: 80 }): Layer {
    const bitmap = createMockImageBitmap(pos.width, pos.height);
    const source: ImageLayerSource = { kind: 'image', bitmap, isBedrock: false, pos };
    return { ...createMockLayer({ id, pos }), bitmap, source };
  }

  function legacyToolLayer(id = layerId, pos = { x: 0, y: 0, width: 100, height: 80 }): Layer {
    return {
      ...createMockLayer({ id, pos }),
      source: { kind: 'tool', args: { toolName: 'pen' } as never, pos, isBedrock: false },
    };
  }

  function makeComposite(id = layerId, pos = { x: 0, y: 0, width: 100, height: 80 }): DurableComposite {
    const materializedBitmap = createMockImageBitmap(pos.width, pos.height);
    const releaseMaterialized = vi.fn();
    const materialized: MaterializedLayer = {
      layerId: id,
      bitmap: materializedBitmap,
      bounds: pos,
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      lease: {
        key: 'render-selector-test',
        bitmap: materializedBitmap,
        byteSize: pos.width * pos.height * 4,
        metadata: pos,
        release: releaseMaterialized,
      },
    };
    const layers = { [id]: materialized };
    const releaseDetached = vi.fn(() => releaseMaterialized());
    const releaseComposite = vi.fn(() => releaseMaterialized());
    return {
      bitmap: materializedBitmap,
      frame: defaultFrame,
      layers,
      takeLayers: () => ({ layers, release: releaseDetached }),
      release: releaseComposite,
    };
  }

  it('enters pending on APPLY_HISTORY_REPLAY, preserving the prior canvas authority', () => {
    const { store, dispatch } = renderWithProbe();
    const layer = rasterLayer();
    replaceDocument(dispatch(), { [layerId]: layer });
    expect(store().renderSelector.source).toBe('legacy');

    replayTo(dispatch(), { [layerId]: layer }, {});

    const pending = store().renderSelector;
    expect(pending.source).toBe('pending');
    expect(pending.documentId).toBe(store().documentId);
    expect(pending.documentRevision).toBe(store().documentRevision);
    expect(pending.branchRevision).toBe(store().branchRevision);
    expect(pending.historyCursor).toBe(store().historyIndex);
    expect(pending.frame).toEqual(store().documentFrame);
    expect(store().durableRenderProjection).toBeNull();
    expect(store().durablePresentation.status).toBe('unpublished');
  });

  it('selects legacy on an explicit legacy fallback, clearing projection', async () => {
    const layer = rasterLayer();
    vi.spyOn(durableCompositor, 'composeDurableDocument').mockRejectedValue(
      new durableCompositor.DurableCompositionRefusal('renderer-incompatible', 'renderer refused')
    );

    const { store, dispatch } = renderWithProbe();
    replaceDocument(dispatch(), { [layerId]: layer });
    replayTo(dispatch(), { [layerId]: layer }, {});
    expect(store().renderSelector.source).toBe('pending');

    let outcome: DurableNavigationPresentationOutcome | undefined;
    await act(async () => {
      outcome = await store().publishDurableNavigationPresentation();
      await Promise.resolve();
    });

    expect(outcome).toMatchObject({ status: 'legacy-fallback', reason: 'renderer-incompatible' });
    expect(store().renderSelector.source).toBe('legacy');
    expect(store().renderSelector.frame).toEqual(store().documentFrame);
    expect(store().durableRenderProjection).toBeNull();
    expect(store().durablePresentation.status).toBe('legacy-fallback');
  });

  it('selects durable when the durable cursor differs from the legacy cursor', async () => {
    const layer = rasterLayer();
    vi.spyOn(durableCompositor, 'composeDurableDocument').mockResolvedValue(makeComposite());

    const { store, dispatch } = renderWithProbe();
    replaceDocument(dispatch(), { [layerId]: layer });
    replayTo(dispatch(), { [layerId]: layer }, {});

    let outcome: DurableNavigationPresentationOutcome | undefined;
    await act(async () => {
      outcome = await store().publishDurableNavigationPresentation();
      await Promise.resolve();
    });

    expect(outcome).toMatchObject({ status: 'durable', cursor: -1 });
    expect(store().renderSelector.source).toBe('durable');
    expect(store().renderSelector.historyCursor).toBe(store().historyIndex);
    expect(store().durablePresentation).toMatchObject({ status: 'durable', cursor: -1 });
    expect(store().durableRenderProjection?.historyCursor).toBe(-1);
  });

  it('keeps legacy authority for a document containing an unsupported source', async () => {
    const compose = vi.spyOn(durableCompositor, 'composeDurableDocument');
    const layer = legacyToolLayer();
    const { store, dispatch } = renderWithProbe();
    replaceDocument(dispatch(), { [layerId]: layer });
    replayTo(dispatch(), { [layerId]: layer }, {});

    let outcome: DurableNavigationPresentationOutcome | undefined;
    await act(async () => {
      outcome = await store().publishDurableNavigationPresentation();
      await Promise.resolve();
    });

    expect(compose).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({ status: 'legacy-fallback', reason: 'unsupported-source', cursor: -1 });
    expect(store().renderSelector.source).toBe('legacy');
    expect(store().durablePresentation).toEqual({
      status: 'legacy-fallback',
      cursor: -1,
      reason: 'unsupported-source',
    });
    expect(store().durableRenderProjection).toBeNull();
  });

  it('clears durable navigation authority when a logical append is committed', async () => {
    const layer = rasterLayer();
    vi.spyOn(durableCompositor, 'composeDurableDocument').mockResolvedValue(makeComposite());

    const { store, dispatch } = renderWithProbe();
    replaceDocument(dispatch(), { [layerId]: layer });
    replayTo(dispatch(), { [layerId]: layer }, {});

    await act(async () => {
      await store().publishDurableNavigationPresentation();
      await Promise.resolve();
    });
    expect(store().renderSelector.source).toBe('durable');
    expect(store().durableRenderProjection).not.toBeNull();

    const updatedLayer = { ...layer, opacity: 0.5 };
    act(() => {
      dispatch()({
        type: 'COMMIT_DOCUMENT_EDIT',
        payload: {
          updates: { layers: { [layerId]: updatedLayer } },
          historyItem: {
            id: 'opacity-edit',
            actionName: SET_LAYER_OPACITY_ACTION,
            layerId,
            args: { opacity: 0.5 },
          },
        },
      });
    });

    expect(store().historyIndex).toBe(1);
    expect(store().renderSelector.source).toBe('legacy');
    expect(store().durableRenderProjection).toBeNull();
    expect(store().durablePresentation).toEqual({ status: 'unpublished', cursor: null, reason: null });
  });

  it('cannot change the selector when a publication is stale', async () => {
    const layer = rasterLayer();
    const composite = makeComposite();
    let resolveComposition!: () => void;
    const composition = new Promise<void>((resolve) => {
      resolveComposition = resolve;
    });
    vi.spyOn(durableCompositor, 'composeDurableDocument').mockImplementation(async () => {
      await composition;
      return composite;
    });

    const { store, dispatch } = renderWithProbe();
    replaceDocument(dispatch(), { [layerId]: layer });
    replayTo(dispatch(), { [layerId]: layer }, {});
    expect(store().renderSelector.source).toBe('pending');

    const publication = store().publishDurableNavigationPresentation();
    expect(store().renderSelector.source).toBe('pending');

    act(() => {
      dispatch()({ type: 'SET_SIZE', payload: { width: 500, height: 400 } });
    });
    const selectorAfterSize = store().renderSelector;
    expect(selectorAfterSize.source).toBe('legacy');

    let outcome: DurableNavigationPresentationOutcome | undefined;
    await act(async () => {
      resolveComposition();
      outcome = await publication;
      await Promise.resolve();
    });

    expect(outcome?.status).toBe('stale');
    expect(store().renderSelector).toBe(selectorAfterSize);
    expect(store().renderSelector.source).toBe('legacy');
    expect(store().durablePresentation.status).toBe('unpublished');
    expect(store().durableRenderProjection).toBeNull();
    expect(store().durableStatus).toBe('stale');
  });

  it('retains a published projection lease until its document exits', async () => {
    const pos = { x: 0, y: 0, width: 100, height: 80 };
    const sourceBitmap = createMockImageBitmap(pos.width, pos.height);
    const layer: Layer = {
      ...createMockLayer({ id: layerId, pos }),
      bitmap: sourceBitmap,
      source: { kind: 'image', bitmap: sourceBitmap, isBedrock: false, pos },
    };
    const materializedBitmap = createMockImageBitmap(pos.width, pos.height);
    const releaseMaterialized = vi.fn();
    const materialized: MaterializedLayer = {
      layerId,
      bitmap: materializedBitmap,
      bounds: pos,
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      lease: {
        key: 'published-projection-retirement',
        bitmap: materializedBitmap,
        byteSize: pos.width * pos.height * 4,
        metadata: pos,
        release: releaseMaterialized,
      },
    };
    const layers = { [layerId]: materialized };
    const releaseDetached = vi.fn(() => releaseMaterialized());
    const composite: DurableComposite = {
      bitmap: materializedBitmap,
      frame: defaultFrame,
      layers,
      takeLayers: () => ({ layers, release: releaseDetached }),
      release: vi.fn(),
    };
    vi.spyOn(durableCompositor, 'composeDurableDocument').mockResolvedValue(composite);

    const { store, dispatch } = renderWithProbe();
    replaceDocument(dispatch(), { [layerId]: layer });
    replayTo(dispatch(), { [layerId]: layer }, {});

    let outcome: DurableNavigationPresentationOutcome | undefined;
    await act(async () => {
      outcome = await store().publishDurableNavigationPresentation();
      await Promise.resolve();
    });

    expect(outcome?.status).toBe('durable');
    expect(store().durableRenderProjection?.layers[layerId].tmpCanvas).toBe(materializedBitmap);
    expect(releaseMaterialized).not.toHaveBeenCalled();

    replaceDocument(dispatch(), { [layerId]: layer }, 'doc-2');
    await act(async () => {
      await Promise.resolve();
    });

    expect(store().documentId).toBe('doc-2');
    expect(store().durableRenderProjection).toBeNull();
    expect(releaseMaterialized).toHaveBeenCalledOnce();
  });
});
