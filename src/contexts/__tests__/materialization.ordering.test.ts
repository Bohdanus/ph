import { afterEach, describe, expect, it, vi } from 'vitest';

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

  it('rejects cleanly when a raster processor produces no output', async () => {
    const registry = new AssetRegistry();
    const operations: DurableOperation[] = [
      Object.freeze({
        kind: 'apply-raster-processor' as const,
        layerId: 'layer-1',
        processorId: 'blur',
        version: 1,
        args: Object.freeze({ toolName: 'blur', radius: 3 }),
      }),
    ];

    const layer = makeBlankLayer('layer-1', 100, 80, operations);
    const result = await materializeLayer(layer, makeRequest(registry));
    expect(result.bitmap).toBeDefined();
    result.lease.release();
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
    const validAssetId = registry.registerBaseline('document-a', bitmap, { ownership: 'adopt' });

    const releaseSpy = vi.fn();
    const originalMaterialize = registry.materialize.bind(registry);
    vi.spyOn(registry, 'materialize').mockImplementation(async (input) => {
      const lease = await originalMaterialize(input);
      const originalRelease = lease.release;
      const spyRelease = () => {
        releaseSpy();
        originalRelease();
      };
      return { ...lease, release: spyRelease };
    });

    const replay = makeReplay({
      'layer-ok': makeBlankLayer('layer-ok', 50, 50),
      'layer-bad': makeRasterLayer('layer-bad', 'unknown-asset', 50, 50),
    });

    await expect(materializeDocument(replay, makeRequest(registry))).rejects.toThrow(/Unknown or disposed asset/);

    // The first layer was materialized before the second failed;
    // its lease must have been released during cleanup.
    expect(releaseSpy).toHaveBeenCalled();

    void validAssetId;
    void close;
    registry.shutdown();
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
  // A tripwire, kept releasable. The production defect is out of scope here, so the
  // test stays `it.fails`; what this change fixes is that the pin could never be
  // released, because the test could only ever have passed by accident:
  //
  // 1. The cleanup used to be a `.mockRestore()` on `HTMLCanvasElement.prototype.getContext`
  //    captured BEFORE `vi.spyOn` replaced it. That captured value is not plain jsdom —
  //    the setup file's own spy is already on the prototype — so the call does not
  //    throw, and it silently restores plain jsdom over the global canvas stub for
  //    everything after it. (Measured, not assumed: `_isMockFunction` is `true` on the
  //    capture, the call returns normally, and afterwards the prototype's `getContext`
  //    has neither `mockRestore` nor `_isMockFunction` and answers `null` for `('2d')`.)
  //    Cleanup is now the file-level `afterEach` above.
  // 2. A positive control now runs first, so a run in which the instrumentation is
  //    still dead fails legibly on the instrumentation instead of on an ambiguous
  //    transform count of zero. Fixing that is `createCanvas` reaching the DOM branch,
  //    at which point the only thing left to do is delete `it.fails`.
  it.fails('applies interleaved affine and filter operations in original order, not grouped by type', async () => {
    // BUG: materializeLayer groups all apply-affine-transform operations into a
    // single ctx.transform call and all apply-filter operations into a single
    // ctx.filter assignment, rather than applying them in their original
    // interleaved order. An [affine, filter, affine] sequence should produce
    // two separate transform calls with the filter applied between them.
    const registry = new AssetRegistry();
    const { bitmap } = createOwnedBitmap(100, 80);
    const assetId = registry.registerBaseline('document-a', bitmap, { ownership: 'adopt' });

    // One record per context handed out, so the positive control below can count
    // contexts and the ordering assertions can read the recorded calls.
    const recordedContexts: Array<{
      transforms: unknown[][];
      drawImageCalls: Array<{ filter: string }>;
    }> = [];

    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
      const record: { transforms: unknown[][]; drawImageCalls: Array<{ filter: string }> } = {
        transforms: [],
        drawImageCalls: [],
      };
      recordedContexts.push(record);
      return {
        canvas: this,
        save: vi.fn(),
        restore: vi.fn(),
        translate: vi.fn(),
        transform: (...args: unknown[]) => {
          record.transforms.push(args);
        },
        setLineDash: vi.fn(),
        drawImage: vi.fn(() => {
          record.drawImageCalls.push({ filter: '' });
        }),
        clip: vi.fn(),
        createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
        get filter() {
          return '';
        },
        set filter(value: string) {
          record.drawImageCalls.push({ filter: value });
        },
        strokeStyle: '',
        fillStyle: '',
        lineWidth: 1,
        globalAlpha: 1,
        globalCompositeOperation: 'source-over',
        fillRect: vi.fn(),
        stroke: vi.fn(),
        beginPath: vi.fn(),
        closePath: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        bezierCurveTo: vi.fn(),
        quadraticCurveTo: vi.fn(),
        arc: vi.fn(),
        strokeRect: vi.fn(),
      } as unknown as CanvasRenderingContext2D;
    });

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

    try {
      await materializeLayer(layer, makeRequest(registry));

      // POSITIVE CONTROL, first on purpose. `createCanvas`
      // (`src/contexts/materialization.ts:52-63`) returns the global `OffscreenCanvas`
      // at line 55 and never reaches the `document.createElement('canvas')` branch at
      // line 57, so the spy above fires zero times today. Asserting the count is
      // non-zero BEFORE the ordering counts turns a bare "expected 2, got 0" into a
      // statement about which half of the test is broken.
      expect(
        recordedContexts.length,
        'the instrumented HTMLCanvasElement.getContext was never called, so every count ' +
          'below is measuring nothing: createCanvas (src/contexts/materialization.ts:55) ' +
          'returns the global OffscreenCanvas before the DOM branch is reached'
      ).toBeGreaterThan(0);

      // If applied in original order, there would be 2 separate transform calls
      // (one per affine) with a filter set between them.
      // Current code: 1 combined transform call + 1 combined filter assignment.
      expect(recordedContexts.flatMap((context) => context.transforms)).toHaveLength(2);
      expect(
        recordedContexts.flatMap((context) => context.drawImageCalls).filter((call) => call.filter !== '')
      ).toHaveLength(2);
    } finally {
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
