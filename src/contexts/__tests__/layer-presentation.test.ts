import { afterEach, describe, expect, it, vi } from 'vitest';

import { createMockImageBitmap, createMockOffscreenCanvas } from '../../__tests__/fixtures/canvas.ts';
import { createImageHistoryItem } from '../../__tests__/fixtures/history.ts';
import { createMockLayer, createMockLayers } from '../../__tests__/fixtures/layer.ts';
import type { ImageLayerSource, Layer, LayerId, LayersRecord } from '../layer-types.ts';
import type { BitmapSource } from '../general-types.ts';
import type { HistoryItem } from '../history-types.ts';
import {
  closePresentationBitmap,
  DocumentPresentationScope,
  isSamePresentationCanvas,
  layersDifferOnlyByPresentation,
  materializePresentationBitmap,
  type LayerPresentationRequest,
} from '../layer-presentation.ts';

function staged(): BitmapSource {
  return createMockOffscreenCanvas(20, 10) as unknown as BitmapSource;
}

/**
 * Stands in for the store's liveness answer, which is not exported. It is the
 * fixture that makes a test's SCENARIO real; the assertions are about how the
 * scope reacts to that answer, so a change to the store's collector is not what
 * these tests claim to cover.
 *
 * The real collector is not left untested for that reason: it is driven through
 * the dispatcher in `StoreContext.retirement.test.tsx`, which pins each alias it
 * reads. This copy is a scope-reaction fixture, not a second implementation of
 * the rule, and a change to either side belongs in both files.
 */
function collectLive(next: LayersRecord, history: readonly HistoryItem[]): Set<BitmapSource> {
  const live = new Set<BitmapSource>();
  const addSource = (value: unknown) => {
    const candidate = value as { kind?: unknown; bitmap?: BitmapSource } | null;
    if (candidate?.kind === 'image' && candidate.bitmap) live.add(candidate.bitmap);
  };
  const addLayer = (layer: Layer) => {
    if (layer.bitmap) live.add(layer.bitmap);
    if (layer.tmpCanvas) live.add(layer.tmpCanvas);
    addSource(layer.source);
  };
  for (const layer of Object.values(next)) addLayer(layer);
  for (const entry of history) {
    addSource(entry.layerSource);
    addSource(entry.args);
    const snapshot: LayersRecord = entry.documentSource?.layers ?? {};
    for (const layer of Object.values(snapshot)) addLayer(layer);
  }
  return live;
}

/**
 * Global and mock teardown belongs HERE, not at the end of a test body: a
 * failing assertion in a body never reaches the copies it would have run, and
 * the stubbed `createImageBitmap` then survives into every later test in the
 * file. `vi.restoreAllMocks()` is safe in an `afterEach` precisely because
 * `src/test/setup.ts` re-installs the `getContext` spy from its own `beforeEach`
 * before the next test body runs.
 */
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('isSamePresentationCanvas', () => {
  it('matches only the exact canvas the layer still holds', () => {
    const canvas = staged();
    const layer = createMockLayer({ tmpCanvas: canvas });

    expect(isSamePresentationCanvas(layer, canvas)).toBe(true);
    expect(isSamePresentationCanvas(layer, staged())).toBe(false);
    expect(isSamePresentationCanvas(createMockLayer({ tmpCanvas: null }), canvas)).toBe(false);
    expect(isSamePresentationCanvas(undefined, canvas)).toBe(false);
    expect(isSamePresentationCanvas(layer, null)).toBe(false);
  });
});

describe('layersDifferOnlyByPresentation', () => {
  it('accepts a record that only swaps a promoted cache', () => {
    const canvas = staged();
    const bitmap = createMockImageBitmap();
    const current = { a: createMockLayer({ id: 'a', tmpCanvas: canvas }) };

    const next = { a: { ...current.a, bitmap, tmpCanvas: null } };

    expect(layersDifferOnlyByPresentation(current, next)).toBe(true);
  });

  it('accepts a durable baked presentation without changing logical layer state', () => {
    const bitmap = createMockImageBitmap();
    const current = {
      a: createMockLayer({ id: 'a', operations: [{ id: 'op', args: { toolName: 'blur', radius: 2 }, enabled: true }] }),
    };
    const next = {
      a: {
        ...current.a,
        durablePresentation: { bitmap, bounds: { x: 2, y: 3, width: 20, height: 10 } },
      },
    };

    expect(layersDifferOnlyByPresentation(current, next)).toBe(true);
  });

  it('accepts an untouched layer that was republished by reference', () => {
    const current = createMockLayers(3);

    expect(layersDifferOnlyByPresentation(current, { ...current })).toBe(true);
  });

  it.each([
    ['pos', { pos: { x: 5, y: 5, width: 100, height: 100 } }],
    ['name', { name: 'Renamed' }],
    ['visible', { visible: false }],
    ['opacity', { opacity: 0.5 }],
    ['locked', { locked: true }],
    ['order', { order: 9 }],
    ['blendMode', { blendMode: 'multiply' as const }],
    ['operations', { operations: [{ id: 'op-1', args: { toolName: 'blur', radius: 2 } }] }],
  ])('refuses a publication that also changes %s', (_field, patch) => {
    const current = { a: createMockLayer({ id: 'a', tmpCanvas: staged() }) };
    const next = { a: { ...current.a, ...patch, bitmap: createMockImageBitmap() } as Layer };

    expect(layersDifferOnlyByPresentation(current, next)).toBe(false);
  });

  it('refuses a publication that adds or removes a layer', () => {
    const current = createMockLayers(2);

    expect(layersDifferOnlyByPresentation(current, { ...current, extra: createMockLayer({ id: 'extra' }) })).toBe(
      false
    );

    const missing: LayersRecord = { ...current };
    delete missing[Object.keys(current)[0]];
    expect(layersDifferOnlyByPresentation(current, missing)).toBe(false);
  });

  it('refuses a publication that swaps a raster source for a different bitmap', () => {
    const source: ImageLayerSource = {
      kind: 'image',
      bitmap: createMockImageBitmap(10, 10),
      name: 'imported',
      pos: { x: 0, y: 0, width: 10, height: 10 },
      isBedrock: false,
    };
    const current = { a: createMockLayer({ id: 'a', source }) };

    expect(layersDifferOnlyByPresentation(current, { a: { ...current.a, bitmap: createMockImageBitmap() } })).toBe(
      true
    );

    const swapped: LayersRecord = {
      a: { ...current.a, source: { ...source, bitmap: createMockImageBitmap(10, 10) } },
    };
    expect(layersDifferOnlyByPresentation(current, swapped)).toBe(false);
  });

  it('fails closed on an unexpected value shape instead of treating it as presentation', () => {
    const current = { a: createMockLayer({ id: 'a' }) };
    // Two distinct keyless objects compare equal to a naive key-count comparator.
    // A durable field holding one must be reported as a difference.
    const next = {
      a: {
        ...current.a,
        operations: [{ id: 'op-1', args: new Uint8Array([1, 2]) }] as unknown as Layer['operations'],
      },
    };

    expect(layersDifferOnlyByPresentation(current, next)).toBe(false);
  });
});

describe('closePresentationBitmap', () => {
  it('closes a bitmap it owns and ignores anything else', () => {
    const bitmap = createMockImageBitmap();
    closePresentationBitmap(bitmap);
    expect(bitmap.close).toHaveBeenCalledTimes(1);

    const canvas = staged();
    expect(() => closePresentationBitmap(canvas)).not.toThrow();
  });
});

describe('materializePresentationBitmap', () => {
  it('materializes the staged canvas and closes nothing', async () => {
    // The store owns the result, so this boundary only hands the bitmap over:
    // the superseded-canvas refusal and the close both live at the store
    // boundary (`PROMOTE_LAYER_PRESENTATIONS`), which is the only place that can
    // tell whether the requesting canvas is still the layer's canvas. A success
    // path that closed what it just produced hands the store a closed raster and
    // the layer draws blank — the caller has no way to detect it.
    const canvas = staged();
    const bitmap = createMockImageBitmap();
    const createImageBitmapStub = vi.fn(async () => bitmap);
    vi.stubGlobal('createImageBitmap', createImageBitmapStub);

    await expect(materializePresentationBitmap(canvas)).resolves.toBe(bitmap);
    // The staged canvas is the source: materializing anything else would publish
    // a raster of the wrong content under the layer's id.
    expect(createImageBitmapStub).toHaveBeenCalledWith(canvas);
    expect(bitmap.close).not.toHaveBeenCalled();
  });

  it('contains a materialization failure and resolves undefined', async () => {
    const failure = new Error('materialization failed');
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => {
        throw failure;
      })
    );
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(materializePresentationBitmap(staged())).resolves.toBeUndefined();
    expect(consoleError).toHaveBeenCalledWith('Unable to materialize layer presentation cache', failure);
  });

  it('rejects when the platform has no createImageBitmap', async () => {
    const original = globalThis.createImageBitmap;
    // @ts-expect-error deliberately removing the global for the negative path
    delete globalThis.createImageBitmap;
    try {
      await expect(materializePresentationBitmap(staged())).rejects.toThrow(/createImageBitmap/);
    } finally {
      globalThis.createImageBitmap = original;
    }
  });
});

describe('DocumentPresentationScope ownership', () => {
  // `deliver`/`deliverBatch` hand a materialized value to the store, which then
  // owns it. A delivery is settled by yielding one microtask: the scope's handler
  // is registered before the test's continuation, so it always runs first.
  const settle = () => Promise.resolve();

  it('hands a live publication to the store, which then owns it', async () => {
    const scope = new DocumentPresentationScope();
    const bitmap = createMockImageBitmap();
    const publish = vi.fn((published: BitmapSource) => scope.trackPublished('doc-1', published));

    scope.deliver(Promise.resolve(bitmap), publish);
    await settle();

    expect(publish).toHaveBeenCalledWith(bitmap);
    expect(bitmap.close).not.toHaveBeenCalled();

    scope.dispose();
    expect(bitmap.close).toHaveBeenCalledTimes(1);
  });

  it('closes a bitmap that arrives after the provider is torn down', async () => {
    const scope = new DocumentPresentationScope();
    const bitmap = createMockImageBitmap();
    const publish = vi.fn();
    scope.dispose();

    scope.deliver(Promise.resolve(bitmap), publish);
    await settle();

    expect(publish).not.toHaveBeenCalled();
    expect(bitmap.close).toHaveBeenCalledTimes(1);
  });

  it('retires a cache only when this boundary created it AND nothing names it', () => {
    // The single-retirement form was deleted rather than kept as a second route. It
    // had no production caller once `retireUnreferenced` existed, and it is exactly
    // the API that caused the use-after-close: it closed by name with no liveness
    // question, so a raster an adopted raster's history entry still named was
    // closed on the promotion path. Two ways to retire, one of them unsafe, is a
    // defect waiting for the next caller.
    const scope = new DocumentPresentationScope();
    const owned = createMockImageBitmap();
    const alsoNamed = createMockImageBitmap(20, 20);
    scope.trackPublished('doc-1', owned);
    scope.trackPublished('doc-1', alsoNamed);
    // Never published: a raster borrowed from an import, a replay, or an
    // in-flight materialization is not a candidate at all, so ownership still
    // decides before liveness is even consulted.
    const borrowed = createMockImageBitmap(10, 10);
    const stranger = createMockImageBitmap(30, 30);

    scope.retireUnreferenced('doc-1', () => new Set([alsoNamed, stranger, borrowed]));
    expect(stranger.close).not.toHaveBeenCalled();
    expect(borrowed.close).not.toHaveBeenCalled();
    // `alsoNamed` is published AND named, so liveness has to veto it — that is the
    // case the deleted method got wrong.
    expect(alsoNamed.close).not.toHaveBeenCalled();
    expect(owned.close).toHaveBeenCalledTimes(1);
    // A second call must not close the same raster twice.
    scope.retireUnreferenced('doc-1', () => new Set());
    expect(owned.close).toHaveBeenCalledTimes(1);

    scope.dispose();
  });

  it('releases a transferred materialization lease when its presentation leaves the store', () => {
    const scope = new DocumentPresentationScope();
    const bitmap = createMockImageBitmap();
    const release = vi.fn();
    scope.trackPublishedLease('doc-1', bitmap, release);

    scope.retireUnreferenced('doc-1', () => new Set());
    expect(release).toHaveBeenCalledTimes(1);
    expect(bitmap.close).not.toHaveBeenCalled();

    scope.dispose();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('keeps an adopted raster alive while a history entry still names it, then closes it once', () => {
    // An ADOPTED raster — an import, a merge, a document import — is named by
    // three aliases, and after the layer is replaced the only one left is the
    // `layerSource` reference a history entry RETAINS rather than copies:
    // `history-replay` reads that exact bitmap back on undo. Closing it is the
    // use-after-close that made the next undo draw from a closed bitmap.
    //
    // The veto is what this test carries, because it is the half that fails in the
    // dangerous direction: closing a raster a history entry still names breaks
    // undo. The second retirement is a control rather than a second claim — it
    // shows the raster is closed exactly once once nothing names it, but it does
    // NOT show the first call kept it as a candidate, because
    // `retireUnreferenced` returns before its delete loop whenever the departed
    // list is empty, so the first call could not have dropped it in any case.
    //
    // Whether the STORE names the raster is deliberately not claimed here: the
    // liveness answer is this file's fixture. The real
    // `collectLivePresentationBitmaps` is driven through the dispatcher in
    // `StoreContext.retirement.test.tsx`, which is what keeps this mirror honest.
    const scope = new DocumentPresentationScope();
    const adopted = createMockImageBitmap();
    scope.trackPublished('doc-1', adopted);

    // The layer now names a different, freshly promoted raster.
    const next = { 'layer-1': createMockLayer({ id: 'layer-1', bitmap: createMockImageBitmap(64, 32) }) };
    const history = [createImageHistoryItem(adopted)];
    expect(collectLive(next, history).has(adopted)).toBe(true);
    expect(next['layer-1'].bitmap).not.toBe(adopted);

    scope.retireUnreferenced('doc-1', () => collectLive(next, history));
    expect(adopted.close).not.toHaveBeenCalled();

    // The merge's entry is truncated away by the next append, so the last name is
    // gone and the raster is now a full-document `ImageBitmap` nobody can reach.
    scope.retireUnreferenced('doc-1', () => collectLive(next, []));
    expect(adopted.close).toHaveBeenCalledTimes(1);

    scope.dispose();
  });

  it('never asks for the liveness set when it owns nothing for the document', () => {
    // The liveness question is the store's, and answering it is O(history) over an
    // array that grows for the life of a session. It is passed as a thunk precisely
    // so the ownership check above can refuse it: a document this scope has
    // published nothing for has nothing to retire, whatever the answer says.
    const scope = new DocumentPresentationScope();
    const walk = vi.fn<() => ReadonlySet<BitmapSource>>(() => new Set());
    const ownedElsewhere = createMockImageBitmap();
    scope.trackPublished('doc-2', ownedElsewhere);

    scope.retireUnreferenced('doc-1', walk);

    expect(walk).not.toHaveBeenCalled();
    expect(ownedElsewhere.close).not.toHaveBeenCalled();

    // The control, so the assertion above cannot pass for the wrong reason: a
    // document it DOES own asks exactly once, and the empty answer is honoured.
    scope.retireUnreferenced('doc-2', walk);

    expect(walk).toHaveBeenCalledTimes(1);
    expect(ownedElsewhere.close).toHaveBeenCalledTimes(1);

    scope.dispose();
  });

  it('stops asking for the liveness set once a document has retired its last cache', () => {
    // The SECOND way a document ends up owning nothing: the first is that this
    // scope never published for it. Here the set is emptied by a completed
    // retirement, and it is the trigger that RECURS — it is true again after
    // every retirement cycle, on a document that was actively publishing one
    // commit earlier. Answering is an O(history) walk over an array that grows
    // for the life of a session, paid on every commit, undo and layer mutation.
    const scope = new DocumentPresentationScope();
    const retired = createMockImageBitmap();
    scope.trackPublished('doc-1', retired);
    const walk = vi.fn<() => ReadonlySet<BitmapSource>>(() => new Set());

    scope.retireUnreferenced('doc-1', walk);
    expect(walk).toHaveBeenCalledTimes(1);
    expect(retired.close).toHaveBeenCalledTimes(1);

    scope.retireUnreferenced('doc-1', walk);
    expect(walk).toHaveBeenCalledTimes(1);

    scope.dispose();
  });

  it('retires the departing document without reaching the one that replaced it', () => {
    // Candidacy is keyed by document. A replacement commits in the same turn as a
    // promotion, which is why the scope is provider-scoped rather than
    // per-document, so a retirement addressed to the old document must not close
    // what the new one already owns: the freshly opened document's layer would
    // render blank on arrival. The second half is the mirror image — the arriving
    // raster must stay REGISTERED against its own document, or the retirement
    // that spared it would have leaked it instead.
    const scope = new DocumentPresentationScope();
    const departing = createMockImageBitmap();
    const arriving = createMockImageBitmap(64, 32);
    scope.trackPublished('doc-old', departing);
    scope.trackPublished('doc-new', arriving);

    // Nothing is live: the document was replaced, so its layers and history are
    // gone and every raster it published is unreachable.
    scope.retireUnreferenced('doc-old', () => new Set());
    expect(departing.close).toHaveBeenCalledTimes(1);
    expect(arriving.close).not.toHaveBeenCalled();

    scope.retireUnreferenced('doc-new', () => new Set());
    expect(arriving.close).toHaveBeenCalledTimes(1);

    scope.dispose();
  });

  it('releases every published cache of a departing document and keeps the live one', () => {
    const scope = new DocumentPresentationScope();
    const leaving = createMockImageBitmap();
    const staying = createMockImageBitmap();
    scope.trackPublished('doc-old', leaving);
    scope.trackPublished('doc-new', staying);

    scope.releaseDocument('doc-old');
    expect(leaving.close).toHaveBeenCalledTimes(1);
    expect(staying.close).not.toHaveBeenCalled();

    scope.releaseDocument('doc-old');
    expect(leaving.close).toHaveBeenCalledTimes(1);

    scope.dispose();
    expect(staying.close).toHaveBeenCalledTimes(1);
  });

  it('disposes each published bitmap exactly once', () => {
    const scope = new DocumentPresentationScope();
    const bitmap = createMockImageBitmap();
    scope.trackPublished('doc-1', bitmap);

    scope.dispose();
    scope.dispose();

    expect(bitmap.close).toHaveBeenCalledTimes(1);
  });

  it('closes a bitmap that is tracked after teardown', () => {
    const scope = new DocumentPresentationScope();
    const bitmap = createMockImageBitmap();
    scope.dispose();

    scope.trackPublished('doc-1', bitmap);

    expect(bitmap.close).toHaveBeenCalledTimes(1);
  });

  it('publishes a whole batch in one handoff while the provider is live', async () => {
    const scope = new DocumentPresentationScope();
    const bitmaps = [createMockImageBitmap(), createMockImageBitmap(20, 20)];
    const publish = vi.fn((published: readonly (BitmapSource | undefined)[]) => {
      for (const bitmap of published) {
        if (bitmap) scope.trackPublished('doc-1', bitmap);
      }
    });

    scope.deliverBatch(Promise.resolve(bitmaps), publish);
    await settle();

    expect(publish).toHaveBeenCalledWith(bitmaps);
    expect(bitmaps[0].close).not.toHaveBeenCalled();

    scope.dispose();
    expect(bitmaps[0].close).toHaveBeenCalledTimes(1);
    expect(bitmaps[1].close).toHaveBeenCalledTimes(1);
  });

  it('closes every materialized bitmap of a batch that arrives after teardown', async () => {
    const scope = new DocumentPresentationScope();
    const first = createMockImageBitmap();
    const second = createMockImageBitmap(20, 20);
    const publish = vi.fn();
    scope.dispose();

    scope.deliverBatch(Promise.resolve([first, undefined, second]), publish);
    await settle();

    expect(publish).not.toHaveBeenCalled();
    expect(first.close).toHaveBeenCalledTimes(1);
    expect(second.close).toHaveBeenCalledTimes(1);
  });
});

describe('LayerPresentationRequest identity', () => {
  // This test's value is COMPILE-TIME, not runtime: the annotation below is a compile-time tripwire
  // and the two `expect`s are tautologies — vitest does not typecheck, so it reports PASS whether or
  // not the annotation holds. The only evidence it works is `npm run tsc` (`tsc -b`) failing on this
  // file when `LayerPresentationRequest` grows a required field. Do not read a green vitest run as
  // evidence for it. (Adding such a field also breaks `useLayer.ts`, which constructs the type, so
  // `tsc -b` names both — read the path in the error, not just the count of them.)
  it('keeps the layer id and canvas it was created with', () => {
    const layerId: LayerId = 'layer-1';
    const canvas = staged();
    // Annotated so the compiler, not the runtime, holds this literal to the type's shape: a third
    // required field on `LayerPresentationRequest` has to break the build here.
    const request: LayerPresentationRequest = { layerId, canvas };

    expect(request.layerId).toBe(layerId);
    expect(request.canvas).toBe(canvas);
  });
});
