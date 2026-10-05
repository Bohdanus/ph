import { act, render } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  durablePresentationIsRendererIdentical,
  type StoreData,
  type StoreDispatch,
  StoreProvider,
  useStore,
} from '../StoreContext.tsx';
import { createMockImageBitmap, createMockOffscreenCanvas } from '../../__tests__/fixtures/canvas.ts';
import { createMockLayer } from '../../__tests__/fixtures/layer.ts';
import { composeDurableDocument as realComposeDurableDocument } from '../durable-compositor.ts';
import type { HistoryItem } from '../history-types.ts';
import type { Layer, LayersRecord } from '../layer-types.ts';
import type { BitmapSource } from '../general-types.ts';
import { OPEN_DOCUMENT_ACTION, REMOVE_ACTION, TOOL_ACTION } from '../../util/constants.ts';

// The real compositor, wrapped rather than replaced: the wrapper counts the calls
// so a refusal can be observed as a call that never happened. A refusal asserted
// only through the store's visible state would be satisfied by a publication that
// ran and then failed inside its own `catch`, which is the opposite claim.
vi.mock('../durable-compositor.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../durable-compositor.ts')>();
  return { ...actual, composeDurableDocument: vi.fn(actual.composeDurableDocument) };
});
const composeDurableDocument = vi.mocked(realComposeDurableDocument);

const layerId = 'layer-1';
const initialSize = { width: 400, height: 300 };
const defaultFrame = { x: 0, y: 0, width: 400, height: 300 };

function canvas(width = 100, height = 80): BitmapSource {
  return createMockOffscreenCanvas(width, height) as unknown as BitmapSource;
}

/**
 * The source is load-bearing, not decoration. `createMockLayer` leaves it
 * `undefined`, and a layer with no durable source makes the conversion report
 * `unsupported-history-feature` — so a document opened from these layers has
 * `durableStatus: 'unavailable'` and `durableDocument: null`. Every assertion
 * below that a publication "moves no durable state" then compares `null` with
 * `null` and passes whether or not the promotion touched the shadow. A blank
 * source is the cheapest fixture that actually converts, so the shadow is
 * present and its identity is a real observation.
 */
function layerWithCanvas(id = layerId, staged: BitmapSource | null = canvas()): Layer {
  const pos = { x: 0, y: 0, width: 100, height: 80 };
  return {
    ...createMockLayer({ id, pos }),
    source: { kind: 'blank', color: '#ffffff', opacity: 1, isBedrock: false, pos },
    tmpCanvas: staged,
  };
}

/** Fails loudly if the fixture ever stops producing a convertible document. */
function expectConvertedShadow(store: StoreData): NonNullable<StoreData['durableDocument']> {
  expect(store.durableStatus).toBe('current');
  expect(store.durableDiagnostics).toEqual([]);
  if (!store.durableDocument) throw new Error('the fixture document produced no durable shadow');
  return store.durableDocument;
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
    ).toBe(false);
  });
});

describe('durable navigation presentation requires a shadow that describes every entry', () => {
  /**
   * The pen action has no durable equivalent, so a conversion carrying one omits
   * that entry and names it. Everything else about the timeline converts, so the
   * published document's replay layer for this one carries no operations — which
   * is exactly the state `durablePresentationIsRendererIdentical` ACCEPTS. Absent
   * the gate, navigation would compose that document, decide the materialization
   * is renderer-identical, and write the un-edited pixels over the `tmpCanvas` the
   * renderer draws from.
   */
  function timelineWith(entry: HistoryItem) {
    return {
      entries: [baselineItem({ [layerId]: layerWithCanvas(layerId, null) }), entry],
      cursor: 1,
      branchRevision: 0,
    };
  }

  const unconvertibleEntry: HistoryItem = {
    id: 'pen-edit',
    actionName: TOOL_ACTION,
    layerId,
    args: { toolName: 'pen' },
  };

  /** Navigates and lets the asynchronous publication settle, either way. */
  async function navigate(
    dispatch: StoreDispatch,
    timeline: { entries: HistoryItem[]; cursor: number; branchRevision: number }
  ) {
    await act(async () => {
      dispatch({
        type: 'APPLY_HISTORY_REPLAY',
        payload: { updates: {}, timeline },
      });
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  it('composes the durable replay for a timeline every entry of which converted', async () => {
    composeDurableDocument.mockClear();
    const { store, dispatch } = renderWithProbe();
    replaceDocument(dispatch(), { [layerId]: layerWithCanvas(layerId, null) });

    await navigate(
      dispatch(),
      timelineWith({ id: 'blur-edit', actionName: TOOL_ACTION, layerId, args: { toolName: 'blur', radius: 4 } })
    );

    // The control, and the half that makes the refusal below mean something: a
    // complete shadow DOES reach the compositor.
    expect(store().durableDiagnostics).toEqual([]);
    expect(composeDurableDocument).toHaveBeenCalled();
  });

  it('never composes the durable replay for a shadow that is missing an edit', async () => {
    composeDurableDocument.mockClear();
    const { store, dispatch } = renderWithProbe();
    replaceDocument(dispatch(), { [layerId]: layerWithCanvas(layerId, null) });

    await navigate(dispatch(), timelineWith(unconvertibleEntry));

    // The document is published and usable — that is the diagnostic partition — but
    // it is missing an edit the legacy timeline has, and the presentation is the
    // one consumer whose correctness depends on there being none.
    expect(store().durableStatus).toBe('current');
    expect(store().durableDocument).not.toBeNull();
    expect(store().durableDiagnostics[0]).toMatchObject({
      historyId: 'pen-edit',
      severity: 'error',
      code: 'unsupported-history-feature',
    });
    expect(composeDurableDocument).not.toHaveBeenCalled();
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
    // The shadow read here is a live one — `expectConvertedShadow` fails the test if
    // the fixture ever stops converting, so these two identity comparisons cannot
    // degenerate into `null === null` and pass for the wrong reason.
    expectConvertedShadow(before);
    expect(store().history).toBe(before.history);
    expect(store().historyIndex).toBe(before.historyIndex);
    expect(store().hasUnsavedChanges).toBe(before.hasUnsavedChanges);
    expect(store().durableDocument).toBe(expectConvertedShadow(before));
    expect(store().durableStatus).toBe(before.durableStatus);
    // The layer's LOGICAL state survives the promotion untouched: only the two
    // presentation slots move. Without this, the identity assertions above would
    // also be satisfied by a transition that dropped the layer record entirely.
    const beforeLayer = before.layers[layerId];
    expect(store().layers[layerId]).not.toBe(beforeLayer);
    expect(after).toEqual({ ...beforeLayer, bitmap, tmpCanvas: null });
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
    // The shadow compared here is the live one. `before.durableDocument` alone would
    // be `null` on an unconvertible fixture document, and `null === null` would hold
    // for a publication that rebuilt the shadow.
    expect(store().durableDocument).toBe(expectConvertedShadow(before));
    expect(store().durableStatus).toBe(before.durableStatus);
    // The payload is installed whole: a publication that re-wrapped the record
    // would break the identity assertion above while leaving every other one green.
    expect(store().layers[layerId]).toEqual({ ...before.layers[layerId], tmpCanvas: staged });
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

  /**
   * The other refusal shape, and the one that loses the most: the guard above
   * compares fields only for ids BOTH records name, so it also has to refuse on
   * membership. Dropping `layer-2` from the payload moves no field at all, so the
   * field comparison alone would accept it and publish a record the document no
   * longer has a cache-bearing layer for.
   */
  it('refuses a payload that drops a layer from the record', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { store, dispatch } = renderWithProbe();
    replaceDocument(dispatch(), {
      [layerId]: layerWithCanvas(layerId, null),
      'layer-2': layerWithCanvas('layer-2', null),
    });
    const before = store().layers;
    const second = before['layer-2'];

    act(() => {
      store().publishRuntimePresentation({ [layerId]: { ...before[layerId], tmpCanvas: canvas() } });
    });

    // The whole record is untouched — including the sibling the payload named
    // nothing about, which is what a partial refusal would lose.
    expect(store().layers).toBe(before);
    expect(store().layers['layer-2']).toBe(second);
    // `divergentLayerIds` unions both id sets, so the dropped id is named.
    expect(consoleError).toHaveBeenCalledTimes(1);
    const [message] = consoleError.mock.calls[0];
    expect(String(message)).toContain('layer-2');
  });

  it('refuses a payload that adds a layer the record does not have', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { store, dispatch } = renderWithProbe();
    replaceDocument(dispatch(), { [layerId]: layerWithCanvas(layerId, null) });
    const before = store().layers;

    act(() => {
      store().publishRuntimePresentation({
        [layerId]: { ...before[layerId], tmpCanvas: canvas() },
        'layer-ghost': layerWithCanvas('layer-ghost', null),
      });
    });

    expect(store().layers).toBe(before);
    expect(store().layers['layer-ghost']).toBeUndefined();
    const [message] = consoleError.mock.calls[0];
    expect(String(message)).toContain('layer-ghost');
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
