import { afterEach, describe, expect, it, vi } from 'vitest';

import { makeMockCtx } from '../../__tests__/canvas-mock.ts';
import { AssetRegistry } from '../asset-registry.ts';
import type { BitmapSource } from '../general-types.ts';
import type { DurableReplayLayer, DurableReplayResult } from '../durable-replay.ts';
import type { MaterializationRequest } from '../materialization.ts';
import { materializeLayer, materializeDocument, createMaterializationKey } from '../materialization.ts';
import type { AssetId } from '../history-model.ts';
import type { DocumentFrame } from '../document-frame.ts';
import type { DurableOperation, DurableLayerSnapshot, DurableLayerSource } from '../history-model.ts';
import { toolProcessors } from '../../tools/toolProcessors.ts';

const defaultFrame: DocumentFrame = { x: 0, y: 0, width: 400, height: 300 };

function createOwnedBitmap(width = 10, height = 10) {
  const close = vi.fn();
  const bitmap = { width, height, close } as unknown as ImageBitmap;
  return { bitmap, close };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function blankSource(size: { width: number; height: number }): DurableLayerSource {
  return Object.freeze({
    kind: 'blank' as const,
    color: '#ffffff',
    opacity: 1,
    size,
    isBedrock: false,
  });
}

function rasterSource(assetId: AssetId, width: number, height: number): DurableLayerSource {
  return Object.freeze({
    kind: 'raster' as const,
    assetId,
    width,
    height,
    isBedrock: false,
  });
}

function makeSnapshot(
  id: string,
  source: DurableLayerSource,
  pos: { x: number; y: number; width: number; height: number }
): DurableLayerSnapshot {
  return Object.freeze({
    id,
    name: 'Layer',
    isBedrock: false,
    visible: true,
    opacity: 1,
    locked: false,
    blendMode: 'source-over' as GlobalCompositeOperation,
    order: 0,
    pos,
    source,
  });
}

function makeBlankLayer(
  id: string,
  width: number,
  height: number,
  operations: DurableOperation[] = []
): DurableReplayLayer {
  return Object.freeze({
    snapshot: makeSnapshot(id, blankSource({ width, height }), { x: 0, y: 0, width, height }),
    operations: Object.freeze([...operations]),
  });
}

function makeRasterLayer(
  id: string,
  assetId: string,
  width: number,
  height: number,
  operations: DurableOperation[] = []
): DurableReplayLayer {
  return Object.freeze({
    snapshot: makeSnapshot(id, rasterSource(assetId as AssetId, width, height), { x: 0, y: 0, width, height }),
    operations: Object.freeze([...operations]),
  });
}

function makeReplay(layers: Record<string, DurableReplayLayer>): DurableReplayResult {
  return Object.freeze({
    documentId: 'test-doc',
    documentRevision: 1,
    branchRevision: 0,
    durableRevision: Object.keys(layers).length,
    cursor: -1,
    frame: { ...defaultFrame },
    layers: Object.freeze({ ...layers }),
    selections: Object.freeze({
      selections: Object.freeze([]),
      activeSelectionId: null,
    }),
    activeLayerId: Object.keys(layers)[0] ?? null,
  });
}

function makeRequest(registry: AssetRegistry, signal?: AbortSignal): MaterializationRequest {
  return {
    documentId: 'test-doc',
    baselineAssetGeneration: 0,
    operationSetRevision: 0,
    assetRegistry: registry,
    ...(signal ? { signal } : {}),
  };
}

/** The calls `renderRetainedSegment` makes on its context, in the order it made them. */
type RenderCall = { op: 'save' | 'restore' | 'filter' | 'translate' | 'transform' | 'drawImage'; args: unknown[] };

/** One entry per context handed out by {@link CallRecordingOffscreenCanvas}, in creation order. */
let recordedRenderCalls: RenderCall[][] = [];

/**
 * Records what the renderer does to a context, which is the only place the
 * render's call ORDER is observable at all.
 *
 * `createCanvas` (`src/contexts/materialization.ts:52-63`) builds every surface
 * through the global `OffscreenCanvas` at line 55 and only reaches
 * `document.createElement('canvas')` at line 57, so a spy on
 * `HTMLCanvasElement.prototype.getContext` never sees one — that is why the
 * previous version of the ordering test recorded nothing at all. This stands in
 * for the global, exactly as `materialization.assets.test.ts` does, and is built
 * on the same shared `makeMockCtx`.
 *
 * `filter` is redefined as an accessor because `ctx.filter = …` is a property
 * write, not a method call: no call spy can see it. The other five are wrapped
 * rather than replaced so the log records the calls in order while the original
 * `vi.fn()` bodies (and their `mock.calls`) still run underneath.
 *
 * Scoped to the one test that installs it rather than to the file: the other
 * tests in this file run against the setup file's substrate, and a file-level
 * stub would change what they observe.
 */
class CallRecordingOffscreenCanvas {
  width: number;
  height: number;
  private context: CanvasRenderingContext2D | null = null;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }

  getContext(): OffscreenCanvasRenderingContext2D | null {
    if (!this.context) {
      const calls: RenderCall[] = [];
      const context = makeMockCtx({ canvas: this as unknown as HTMLCanvasElement });

      let filterValue = '';
      Object.defineProperty(context, 'filter', {
        get: () => filterValue,
        set: (value: string) => {
          calls.push({ op: 'filter', args: [value] });
          filterValue = value;
        },
        configurable: true,
      });

      for (const op of ['save', 'restore', 'translate', 'transform', 'drawImage'] as const) {
        const original = context[op] as unknown as (...args: unknown[]) => unknown;
        (context as unknown as Record<string, unknown>)[op] = (...args: unknown[]) => {
          calls.push({ op, args });
          return original(...args);
        };
      }

      recordedRenderCalls.push(calls);
      this.context = context;
    }
    return this.context as unknown as OffscreenCanvasRenderingContext2D;
  }

  resize(width: number, height: number) {
    this.width = width;
    this.height = height;
  }

  transferToImageBitmap() {
    return { width: this.width, height: this.height, close: vi.fn() };
  }

  convertToBlob() {
    return Promise.resolve(new Blob([]));
  }
}

/**
 * Every `vi.spyOn` in this file is undone here, once, at file scope — the same
 * shape `materialization.assets.test.ts` already uses. The setup file installs
 * its own `HTMLCanvasElement.prototype.getContext` spy at module load and again
 * in every `beforeEach` (`src/test/setup.ts:353-363`), and neither
 * `vitest.config.ts` nor the setup's `afterEach` restores mocks, so without this
 * the file leaks its own instrumentation forward.
 */
afterEach(() => {
  vi.restoreAllMocks();
});

describe('materializeLayer safety (P0.3)', () => {
  it('rejects cleanly for a raster source with an unknown asset id', async () => {
    const registry = new AssetRegistry();
    const layer = makeRasterLayer('layer-1', 'unknown-asset', 100, 80);

    await expect(materializeLayer(layer, makeRequest(registry))).rejects.toThrow(/Unknown or disposed asset/);
  });

  it('rejects cleanly for a raster source whose asset was disposed before materialization', async () => {
    const registry = new AssetRegistry();
    const { bitmap, close } = createOwnedBitmap(10, 10);
    const assetId = registry.registerBaseline('document-a', bitmap, { ownership: 'adopt' });

    registry.disposeDocument('document-a');
    expect(close).toHaveBeenCalledTimes(1);

    const layer = makeRasterLayer('layer-1', assetId, 10, 10);
    await expect(materializeLayer(layer, makeRequest(registry))).rejects.toThrow(/Unknown or disposed asset/);
  });

  it('rejects cleanly when the input signal is already aborted', async () => {
    const registry = new AssetRegistry();
    const { bitmap } = createOwnedBitmap(10, 10);
    const assetId = registry.registerBaseline('document-a', bitmap, { ownership: 'adopt' });
    const controller = new AbortController();
    controller.abort();

    const layer = makeRasterLayer('layer-1', assetId, 10, 10);
    await expect(materializeLayer(layer, makeRequest(registry, controller.signal))).rejects.toThrow(/aborted/);
  });

  it('rejects cleanly when an unknown raster processor is applied to a layer', async () => {
    const registry = new AssetRegistry();
    const layer = makeBlankLayer('layer-1', 100, 80, [
      Object.freeze({
        kind: 'apply-raster-processor' as const,
        layerId: 'layer-1',
        processorId: 'nonexistent-processor',
        version: 1,
        args: Object.freeze({ toolName: 'blur', radius: 4 }),
      }),
    ]);

    await expect(materializeLayer(layer, makeRequest(registry))).rejects.toThrow(/Unknown raster processor/);
  });

  it('rejects cleanly for a raster source with invalid (zero) dimensions', async () => {
    const registry = new AssetRegistry();
    const { bitmap } = createOwnedBitmap(10, 10);
    const assetId = registry.registerBaseline('document-a', bitmap, { ownership: 'adopt' });

    // A source descriptor with zero dimensions produces degenerate bounds
    // during rendering — the failure must be controlled, not a crash.
    const layer = makeRasterLayer('layer-1', assetId, 0, 0);
    await expect(materializeLayer(layer, makeRequest(registry))).rejects.toThrow(/degenerate bounds/);
  });

  it('rejects cleanly when a raster processor throws during execution', async () => {
    const registry = new AssetRegistry();
    const { bitmap } = createOwnedBitmap(100, 80);
    const assetId = registry.registerBaseline('document-a', bitmap, { ownership: 'adopt' });

    const originalImageProcessor = toolProcessors.blur.imageProcessor;
    vi.spyOn(toolProcessors.blur, 'imageProcessor').mockImplementation(() => () => {
      throw new Error('processor execution failed');
    });

    const layer = makeRasterLayer('layer-1', assetId, 100, 80, [
      Object.freeze({
        kind: 'apply-raster-processor' as const,
        layerId: 'layer-1',
        processorId: 'blur',
        version: 1,
        args: Object.freeze({ toolName: 'blur', radius: 3 }),
      }),
    ]);

    try {
      await expect(materializeLayer(layer, makeRequest(registry))).rejects.toThrow('processor execution failed');
    } finally {
      toolProcessors.blur.imageProcessor = originalImageProcessor;
    }
    registry.shutdown();
  });

  it('does not close an unrelated baseline bitmap when a layer materialization fails', async () => {
    const registry = new AssetRegistry();
    const goodBitmap = createOwnedBitmap(10, 10);
    const badBitmap = createOwnedBitmap(10, 10);

    registry.registerBaseline('document-a', goodBitmap.bitmap, { ownership: 'adopt' });
    const badAssetId = registry.registerBaseline('document-a', badBitmap.bitmap, { ownership: 'adopt' });

    const originalImageProcessor = toolProcessors.blur.imageProcessor;
    vi.spyOn(toolProcessors.blur, 'imageProcessor').mockImplementation(() => () => {
      throw new Error('processor execution failed');
    });

    const layer = makeRasterLayer('layer-1', badAssetId, 100, 80, [
      Object.freeze({
        kind: 'apply-raster-processor' as const,
        layerId: 'layer-1',
        processorId: 'blur',
        version: 1,
        args: Object.freeze({ toolName: 'blur', radius: 3 }),
      }),
    ]);

    try {
      await expect(materializeLayer(layer, makeRequest(registry))).rejects.toThrow('processor execution failed');
    } finally {
      toolProcessors.blur.imageProcessor = originalImageProcessor;
    }

    // The failed materialization must not close the unrelated baseline bitmap.
    expect(goodBitmap.close).not.toHaveBeenCalled();
    expect(badBitmap.close).not.toHaveBeenCalled();

    registry.shutdown();
    expect(goodBitmap.close).toHaveBeenCalledTimes(1);
    expect(badBitmap.close).toHaveBeenCalledTimes(1);
  });

  // A raster processor that produces no output is a rejection, and it is covered where the
  // processor is actually stubbed: `materialization.assets.test.ts:672-689`. That test pins
  // only the throw at `materialization.ts:283`, on a blank source with a *stubbed* processor.
  // It does not pin the other half of the body that was deleted here: a real, unmocked
  // processor resolving over a blank source. `applies a real raster processor to a blank
  // source and resolves` below carries exactly that half — nothing else moved with the
  // deletion, and nothing else is claimed for it.

  it('applies a real raster processor to a blank source and resolves', async () => {
    const registry = new AssetRegistry();
    const processorInputs: Array<{ size: { width: number; height: number } }> = [];
    const originalImageProcessor = toolProcessors.blur.imageProcessor;
    // Pass-through, so the real `blur` still runs. The recording exists only because the
    // hand-off from a synthesised blank canvas into the processor is otherwise invisible.
    vi.spyOn(toolProcessors.blur, 'imageProcessor').mockImplementation((params) => {
      processorInputs.push({ size: { ...params.size } });
      return originalImageProcessor(params);
    });

    const layer = makeBlankLayer('layer-1', 100, 80, [
      Object.freeze({
        kind: 'apply-raster-processor' as const,
        layerId: 'layer-1',
        processorId: 'blur',
        version: 1,
        args: Object.freeze({ toolName: 'blur', radius: 3 }),
      }),
    ]);

    try {
      const materialized = await materializeLayer(layer, makeRequest(registry));

      // The blank layer's own geometry is what reaches the processor, so the raster path is
      // exercised from a synthesised source rather than from a registry asset.
      expect(processorInputs).toEqual([{ size: { width: 100, height: 80 } }]);
      expect(materialized.layerId).toBe('layer-1');
      expect(materialized.bitmap).toBeDefined();
      expect(materialized.bounds).toEqual({ x: 0, y: 0, width: 100, height: 80 });

      materialized.lease.release();
    } finally {
      toolProcessors.blur.imageProcessor = originalImageProcessor;
    }

    registry.shutdown();
  });

  it('materializes a blank layer with no operations successfully', async () => {
    const registry = new AssetRegistry();
    const layer = makeBlankLayer('layer-1', 100, 80);

    const result = await materializeLayer(layer, makeRequest(registry));
    expect(result.layerId).toBe('layer-1');
    expect(result.bitmap).toBeDefined();
    expect(result.lease).toBeDefined();
    result.lease.release();
  });
});

describe('materializeDocument safety (P0.3)', () => {
  it('releases already-materialized layer leases when a later layer fails', async () => {
    const registry = new AssetRegistry();
    const { bitmap, close } = createOwnedBitmap(10, 10);
    // Registered under the request's OWN document id. Under a different id the two
    // assertions near the bottom would hold for reasons that have nothing to do with
    // cleanup: disposing `'document-a'` would leave this baseline untouched either way.
    const validAssetId = registry.registerBaseline('test-doc', bitmap, { ownership: 'adopt' });

    const releaseSpy = vi.fn();
    const releasedKeys: string[] = [];
    const originalMaterialize = registry.materialize.bind(registry);
    vi.spyOn(registry, 'materialize').mockImplementation(async (input) => {
      const lease = await originalMaterialize(input);
      const originalRelease = lease.release;
      const spyRelease = () => {
        releaseSpy();
        releasedKeys.push(input.key);
        originalRelease();
      };
      return { ...lease, release: spyRelease };
    });

    const request = makeRequest(registry);
    const layerOk = makeBlankLayer('layer-ok', 50, 50);
    // A third layer in the same document whose extent differs, so `createMaterializationKey`
    // gives it a genuinely different key string. `createMaterializationKey` encodes no layer
    // id, so two identically-shaped layers would share a key and the comparison below would
    // be a tautology; this one exists to make the comparison discriminating.
    const layerOther = makeBlankLayer('layer-other', 50, 60);
    const replay = makeReplay({
      'layer-ok': layerOk,
      'layer-bad': makeRasterLayer('layer-bad', 'unknown-asset', 50, 50),
      'layer-other': layerOther,
    });

    await expect(materializeDocument(replay, request)).rejects.toThrow(/Unknown or disposed asset/);

    // `layer-bad` never got a lease, so cleanup must release exactly one — and the one it
    // releases is `layer-ok`'s, not `layer-other`'s or `layer-bad`'s.
    expect(releaseSpy).toHaveBeenCalledTimes(1);
    expect(releasedKeys).toEqual([createMaterializationKey(layerOk, request)]);

    // Cleanup releases leases, not this document's baseline assets.
    expect(registry.getRecord(validAssetId)).toBeDefined();
    expect(close).not.toHaveBeenCalled();

    registry.shutdown();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('aborts early when the signal is aborted before processing layers', async () => {
    const registry = new AssetRegistry();
    const controller = new AbortController();
    controller.abort();

    const replay = makeReplay({
      'layer-1': makeBlankLayer('layer-1', 100, 100),
    });

    await expect(materializeDocument(replay, makeRequest(registry, controller.signal))).rejects.toThrow(/aborted/);
  });

  it('returns a release handle that releases all layer leases', async () => {
    const registry = new AssetRegistry();
    const releaseLeases = vi.fn();
    const originalMaterialize = registry.materialize.bind(registry);
    vi.spyOn(registry, 'materialize').mockImplementation(async (input) => {
      const lease = await originalMaterialize(input);
      const originalRelease = lease.release;
      return {
        ...lease,
        release: () => {
          releaseLeases();
          originalRelease();
        },
      };
    });

    const replay = makeReplay({
      'layer-1': makeBlankLayer('layer-1', 100, 100),
      'layer-2': makeBlankLayer('layer-2', 100, 100),
    });

    const result = await materializeDocument(replay, makeRequest(registry));
    const initialCalls = releaseLeases.mock.calls.length;

    result.release();
    expect(releaseLeases.mock.calls.length).toBe(initialCalls + 2);

    result.release();
    // Double-release is a no-op.
    expect(releaseLeases.mock.calls.length).toBe(initialCalls + 2);

    registry.shutdown();
  });
});

describe('registry generation guard (P0.3)', () => {
  it('rejects cleanly when the source asset is disposed while materialization is pending', async () => {
    const registry = new AssetRegistry();
    const { bitmap, close } = createOwnedBitmap(10, 10);
    registry.registerBaseline('document-a', bitmap, { ownership: 'adopt' });

    const deferredProducer = deferred<BitmapSource>();
    const pending = registry.materialize({
      key: 'pending-mat',
      documentId: 'document-a',
      producer: () => deferredProducer.promise,
      byteSize: 4,
    });

    // Dispose the document while materialization is still pending.
    registry.disposeDocument('document-a');
    expect(close).toHaveBeenCalledTimes(1);

    // Resuming the producer detects the generation mismatch and rejects.
    const replacement = createOwnedBitmap().bitmap;
    deferredProducer.resolve(replacement);
    await expect(pending).rejects.toThrow(/invalidated/);

    // The replacement bitmap produced by the producer is cleaned up by the
    // generation guard.
    expect(replacement.close).toHaveBeenCalled();

    void pending.catch(() => undefined);
  });
});

describe('materialization cache key determinism (P0.6)', () => {
  it('produces a stable key for the same layer configuration', () => {
    const registry = new AssetRegistry();
    const layerA = makeBlankLayer('layer-1', 100, 80);
    const layerB = makeBlankLayer('layer-1', 100, 80);
    const request = makeRequest(registry);

    const keyA = createMaterializationKey(layerA, request);
    const keyB = createMaterializationKey(layerB, request);

    expect(keyA).toBe(keyB);
  });

  it('produces a different key when operations differ', () => {
    const registry = new AssetRegistry();
    const layerA = makeBlankLayer('layer-1', 100, 80);
    const layerB = makeBlankLayer('layer-1', 100, 80, [
      Object.freeze({
        kind: 'apply-filter' as const,
        layerId: 'layer-1',
        filter: Object.freeze({ toolName: 'blur' as const, version: 1, args: Object.freeze({ radius: 5 }) }),
      }),
    ]);
    const request = makeRequest(registry);

    expect(createMaterializationKey(layerA, request)).not.toBe(createMaterializationKey(layerB, request));
  });
});

describe('materialization operation ordering (P1.10)', () => {
  // This test was `it.fails('applies interleaved affine and filter operations in
  // original order, not grouped by type')` and it pinned nothing, twice over.
  //
  // The two ordering counts were unreachable code. The positive control on the
  // recorded-context count threw first, because the test spied on
  // `HTMLCanvasElement.prototype.getContext` while `createCanvas`
  // (`src/contexts/materialization.ts:55`) returns the global `OffscreenCanvas`
  // and never reaches the DOM branch at line 57 — so the spy fired zero times and
  // the control was the first thing to fail. A reviewer measured the rest: with
  // `it.fails` flipped to `it` the control fails with "the instrumented
  // HTMLCanvasElement.getContext was never called", and reordering
  // `ctx.filter`, `ctx.translate` and `ctx.transform` in `renderRetainedSegment`
  // leaves the whole file green.
  //
  // Its cleanup was worse than dead — it never ran. `.mockRestore()` on
  // `originalGetContext` sat AFTER `expect(transformSpy).toHaveBeenCalledTimes(2)`,
  // which always threw, so the file's own `getContext` spy was never undone and
  // leaked to every later test in the file. (Measured on `main`'s copy of this
  // file: after it completes, `HTMLCanvasElement.prototype.getContext` is still
  // a mock, `_isMockFunction === true`.) Cleanup is now the file-level
  // `afterEach` above, which runs whatever the test body does.
  //
  // Separately, the cleanup it replaced was still wrong on its own terms:
  // `originalGetContext` is captured BEFORE `vi.spyOn` replaces the method, so it
  // is the setup file's own spy, not plain jsdom — calling `mockRestore` on it
  // silently restores plain jsdom over the global canvas stub for everything
  // after it. That is a real latent hazard, but it is not what leaked here.
  //
  // The old name is gone because the old claim is false, not because the test
  // stopped being able to run. See the comment on the test below for why there
  // is no interleave order to pin.
  it('composes retained operations into one transform and one filter, and orders the render calls the result depends on', async () => {
    // An [affine, filter, affine] sequence has no observable interleave order
    // here, and that is a property of canvas rather than of this renderer.
    // `ctx.filter` is drawing STATE that applies when a draw executes, and a
    // retained segment draws its source exactly once
    // (`materialization.ts:250`), so there is nothing for a filter to be set
    // "between". Separating the affines would mean drawing the source once per
    // operation — a different render, not a re-ordering of this one. Composing
    // the affines into one `ctx.transform` and joining the filters into one
    // `ctx.filter` is the product rule the renderer states in place
    // (`materialization.ts:245-247`), and it is what `materialization.assets.test.ts:812`
    // already pins for the matrix.
    //
    // So the interleave defect this test used to claim does not exist, and an
    // `it.fails` for it was a tripwire against a fix nobody should make. What is
    // real, and what this pins instead, is the order of the RENDER CALLS: of the
    // four state writes a retained segment makes, only two of their relative
    // orders change pixels, and the test says which.
    const registry = new AssetRegistry();
    const { bitmap } = createOwnedBitmap(100, 80);
    const assetId = registry.registerBaseline('document-a', bitmap, { ownership: 'adopt' });

    const operations: DurableOperation[] = [
      Object.freeze({
        kind: 'apply-affine-transform' as const,
        layerId: 'layer-1',
        transform: Object.freeze({ a: 1, b: 0, c: 0, d: 1, e: 10, f: 20 }),
      }),
      Object.freeze({
        kind: 'apply-filter' as const,
        layerId: 'layer-1',
        filter: Object.freeze({
          toolName: 'blur' as const,
          version: 1,
          args: Object.freeze({ radius: 3 }),
        }),
      }),
      Object.freeze({
        kind: 'apply-affine-transform' as const,
        layerId: 'layer-1',
        transform: Object.freeze({ a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 }),
      }),
    ];

    const layer = makeRasterLayer('layer-1', assetId, 100, 80, operations);
    recordedRenderCalls = [];

    try {
      vi.stubGlobal('OffscreenCanvas', CallRecordingOffscreenCanvas);
      const result = await materializeLayer(layer, makeRequest(registry));

      // The request carries no frame, so the retained segment's surface is the
      // only canvas the materialization creates. If this ever reads 0, the
      // recorder is dead and every count below is measuring nothing.
      expect(recordedRenderCalls).toHaveLength(1);
      const calls = recordedRenderCalls[0]!;
      const callsOf = (op: RenderCall['op']) => calls.filter((call) => call.op === op);

      // The two affines compose into ONE transform: newest-premultiplied, so
      // scale(2,2) lands left of translate(10,20). An oldest-first product would
      // read [2, 0, 0, 2, 10, 20]. Splitting them into two calls fails here.
      expect(callsOf('transform')).toEqual([{ op: 'transform', args: [2, 0, 0, 2, 20, 40] }]);

      // ...and the one filter becomes ONE assignment carrying the joined string.
      // A second filter operation would extend this string rather than add a call.
      expect(callsOf('filter')).toEqual([{ op: 'filter', args: ['blur(3px)'] }]);

      // The composed bounds, as the renderer offsets the source back into them.
      expect(callsOf('translate')).toEqual([{ op: 'translate', args: [-20, -40] }]);
      expect(callsOf('drawImage')).toEqual([{ op: 'drawImage', args: [expect.anything(), 0, 0, 100, 80] }]);

      // ORDER, and only the two orders that change pixels. `transform` post-
      // multiplies the CTM, so translating first composes T·A and translating
      // after composes A·T — a different placement of the same source.
      const order = calls.map((call) => call.op);
      expect(order.indexOf('translate')).toBeLessThan(order.indexOf('transform'));

      // `filter` is read when the draw executes, so setting it afterwards
      // renders an unfiltered source.
      expect(order.indexOf('filter')).toBeLessThan(order.indexOf('drawImage'));

      // NOT pinned: swapping `filter` against `translate` or `transform`. Both
      // are state writes that read nothing from each other, and both are still
      // in effect at the `drawImage`, so no order between them is observable
      // and this test deliberately says nothing about it. Moving `filter` past
      // `drawImage` — the case above — is a real defect and does fail.
      result.lease.release();
    } finally {
      vi.unstubAllGlobals();
      registry.shutdown();
    }
  });

  it('applies apply-raster-processor operations in array order before the final draw', async () => {
    const registry = new AssetRegistry();
    const { bitmap, close } = createOwnedBitmap(100, 80);
    const assetId = registry.registerBaseline('document-a', bitmap, { ownership: 'adopt' });

    const operations: DurableOperation[] = [
      Object.freeze({
        kind: 'apply-raster-processor' as const,
        layerId: 'layer-1',
        processorId: 'blur',
        version: 1,
        args: Object.freeze({ toolName: 'blur', radius: 2 }),
      }),
    ];

    const layer = makeRasterLayer('layer-1', assetId, 100, 80, operations);
    const materialized = await materializeLayer(layer, makeRequest(registry));
    expect(materialized.bitmap).toBeDefined();
    materialized.lease.release();

    void close;
    registry.shutdown();
  });
});
