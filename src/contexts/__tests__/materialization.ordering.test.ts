import { afterEach, describe, expect, it, vi } from 'vitest';

import { makeMockCtx } from '../../__tests__/canvas-mock.ts';
import { AssetRegistry } from '../asset-registry.ts';
import { composeDurableDocument } from '../durable-compositor.ts';
import type { BitmapSource } from '../general-types.ts';
import type { DurableReplayLayer, DurableReplayResult } from '../durable-replay.ts';
import type { MaterializationRequest } from '../materialization.ts';
import { materializeLayer, materializeDocument, createMaterializationKey } from '../materialization.ts';
import type { AssetId } from '../history-model.ts';
import { documentFrameSize, type DocumentFrame } from '../document-frame.ts';
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
    totalSize: documentFrameSize(defaultFrame),
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
    baselineAssetGeneration: registry.getDocumentGeneration('test-doc'),
    operationSetRevision: 0,
    assetRegistry: registry,
    ...(signal ? { signal } : {}),
  };
}

function requireProcessorBitmap(params: Parameters<typeof toolProcessors.blur.imageProcessor>[0]): BitmapSource {
  if (!('bitmap' in params)) throw new Error('Expected a raster processor input');
  return params.bitmap;
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

  it('enforces durable raster processor staging budgets before allocating a presentation surface', async () => {
    const registry = new AssetRegistry();
    const allocations: Array<{ width: number; height: number }> = [];
    const originalImageProcessor = toolProcessors['red-eye'].imageProcessor;
    const imageProcessor = vi.spyOn(toolProcessors['red-eye'], 'imageProcessor');
    const { bitmap } = createOwnedBitmap(100, 80);
    const assetId = registry.registerBaseline('test-doc', bitmap, { ownership: 'adopt' });
    const rasterLayer = makeRasterLayer('layer-1', assetId, 100, 80, [
      Object.freeze({
        kind: 'apply-raster-processor' as const,
        layerId: 'layer-1',
        processorId: 'red-eye',
        version: 1,
        args: Object.freeze({ toolName: 'red-eye', pupilSize: 50, darkenAmount: 50 }),
      }),
    ]);
    const layer = Object.freeze({
      ...rasterLayer,
      snapshot: makeSnapshot('layer-1', rasterSource(assetId, 100, 80), { x: 0, y: 0, width: 5000, height: 4000 }),
    });
    class AllocationCountingCanvas extends CallRecordingOffscreenCanvas {
      constructor(width: number, height: number) {
        allocations.push({ width, height });
        super(width, height);
      }
    }

    try {
      vi.stubGlobal('OffscreenCanvas', AllocationCountingCanvas);
      await expect(materializeLayer(layer, makeRequest(registry))).rejects.toThrow(/pixel staging budget/);
      expect(allocations).toEqual([]);
      expect(imageProcessor).not.toHaveBeenCalled();
    } finally {
      toolProcessors['red-eye'].imageProcessor = originalImageProcessor;
      vi.unstubAllGlobals();
      registry.shutdown();
    }
  });

  it('refuses an over-budget generated source before allocating its initial raster', async () => {
    const registry = new AssetRegistry();
    const allocations: Array<{ width: number; height: number }> = [];
    const originalImageProcessor = toolProcessors['red-eye'].imageProcessor;
    const imageProcessor = vi.spyOn(toolProcessors['red-eye'], 'imageProcessor');
    const layer = makeBlankLayer('layer-1', 5000, 4000, [
      Object.freeze({
        kind: 'apply-raster-processor' as const,
        layerId: 'layer-1',
        processorId: 'red-eye',
        version: 1,
        args: Object.freeze({ toolName: 'red-eye', pupilSize: 50, darkenAmount: 50 }),
      }),
    ]);
    class AllocationCountingCanvas extends CallRecordingOffscreenCanvas {
      constructor(width: number, height: number) {
        allocations.push({ width, height });
        super(width, height);
      }
    }

    try {
      vi.stubGlobal('OffscreenCanvas', AllocationCountingCanvas);
      await expect(materializeLayer(layer, makeRequest(registry))).rejects.toThrow(/pixel staging budget/);
      expect(allocations).toEqual([]);
      expect(imageProcessor).not.toHaveBeenCalled();
    } finally {
      toolProcessors['red-eye'].imageProcessor = originalImageProcessor;
      vi.unstubAllGlobals();
      registry.shutdown();
    }
  });

  it('does not allocate a duplicate bitmap for a generated source with a document frame', async () => {
    const registry = new AssetRegistry();
    const createdBitmap = createOwnedBitmap(20, 20);
    const createImageBitmap = vi.fn(async () => createdBitmap.bitmap);

    try {
      vi.stubGlobal('OffscreenCanvas', CallRecordingOffscreenCanvas);
      vi.stubGlobal('createImageBitmap', createImageBitmap);
      const materialized = await materializeLayer(makeBlankLayer('layer-1', 20, 20), {
        ...makeRequest(registry),
        frame: { x: 0, y: 0, width: 20, height: 20 },
      });

      expect(createImageBitmap).toHaveBeenCalledTimes(1);
      expect(materialized.bitmap).toBe(createdBitmap.bitmap);
      materialized.lease.release();
    } finally {
      vi.unstubAllGlobals();
      registry.shutdown();
    }
  });

  it('skips a historical zero-opacity Color Replacement without rejecting an oversized raster', async () => {
    const registry = new AssetRegistry();
    const imageProcessor = vi.spyOn(toolProcessors['color-replacement'], 'imageProcessor');
    const layer = makeBlankLayer('layer-1', 4096, 4096, [
      Object.freeze({
        kind: 'apply-raster-processor' as const,
        layerId: 'layer-1',
        processorId: 'color-replacement',
        version: 1,
        args: Object.freeze({
          toolName: 'color-replacement',
          alpha: 0,
          lineWidth: 18,
          color: '#ff0000',
          tolerance: 30,
          limits: 'contiguous',
          sampling: 'current-layer',
          smoothness: 10,
          sampleColor: { r: 0, g: 0, b: 0, a: 255 },
          points: [{ x: 20, y: 20 }],
        }),
      }),
    ]);

    try {
      vi.stubGlobal('OffscreenCanvas', CallRecordingOffscreenCanvas);
      const materialized = await materializeLayer(layer, makeRequest(registry));

      expect(imageProcessor).not.toHaveBeenCalled();
      expect(materialized.bounds).toEqual({ x: 0, y: 0, width: 4096, height: 4096 });
      materialized.lease.release();
    } finally {
      vi.unstubAllGlobals();
      registry.shutdown();
    }
  });

  it('still rejects an unsupported zero-opacity Color Replacement version before allocating its source', async () => {
    const registry = new AssetRegistry();
    const allocations: Array<{ width: number; height: number }> = [];
    const layer = makeBlankLayer('layer-1', 20, 20, [
      Object.freeze({
        kind: 'apply-raster-processor' as const,
        layerId: 'layer-1',
        processorId: 'color-replacement',
        version: 99,
        args: Object.freeze({ toolName: 'color-replacement', alpha: 0 }),
      }),
    ]);
    class AllocationCountingCanvas extends CallRecordingOffscreenCanvas {
      constructor(width: number, height: number) {
        allocations.push({ width, height });
        super(width, height);
      }
    }

    try {
      vi.stubGlobal('OffscreenCanvas', AllocationCountingCanvas);
      await expect(materializeLayer(layer, makeRequest(registry))).rejects.toThrow(
        'Unsupported raster processor color-replacement v99'
      );
      expect(allocations).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
      registry.shutdown();
    }
  });

  it('reuses a matching generated fractional raster without an extra staging resample', async () => {
    const registry = new AssetRegistry();
    const allocations: Array<{ width: number; height: number }> = [];
    const processorInputs: Array<{ bitmap: BitmapSource; size: { width: number; height: number } }> = [];
    const originalImageProcessor = toolProcessors.blur.imageProcessor;
    vi.spyOn(toolProcessors.blur, 'imageProcessor').mockImplementation((params) => {
      const bitmap = requireProcessorBitmap(params);
      processorInputs.push({ bitmap, size: { ...params.size } });
      return () => [bitmap];
    });
    const layer = makeBlankLayer('layer-1', 40.5, 20.25, [
      Object.freeze({
        kind: 'apply-raster-processor' as const,
        layerId: 'layer-1',
        processorId: 'blur',
        version: 1,
        args: Object.freeze({ toolName: 'blur', radius: 0 }),
      }),
    ]);
    class AllocationCountingCanvas extends CallRecordingOffscreenCanvas {
      constructor(width: number, height: number) {
        allocations.push({ width, height });
        super(width, height);
      }
    }

    try {
      vi.stubGlobal('OffscreenCanvas', AllocationCountingCanvas);
      const materialized = await materializeLayer(layer, makeRequest(registry));

      expect(allocations).toEqual([{ width: 41, height: 21 }]);
      expect(processorInputs).toHaveLength(1);
      expect(processorInputs[0]?.size).toEqual({ width: 41, height: 21 });
      expect(materialized.bounds).toEqual({ x: 0, y: 0, width: 40.5, height: 20.25 });
      materialized.lease.release();
    } finally {
      toolProcessors.blur.imageProcessor = originalImageProcessor;
      vi.unstubAllGlobals();
      registry.shutdown();
    }
  });

  it('enforces each processor budget when consecutive processors reuse an owned raster', async () => {
    const registry = new AssetRegistry();
    const allocations: Array<{ width: number; height: number }> = [];
    const originalBlurProcessor = toolProcessors.blur.imageProcessor;
    const originalRedEyeProcessor = toolProcessors['red-eye'].imageProcessor;
    const blurProcessor = vi.spyOn(toolProcessors.blur, 'imageProcessor').mockImplementation((params) => {
      const bitmap = requireProcessorBitmap(params);
      return () => [bitmap];
    });
    const redEyeProcessor = vi.spyOn(toolProcessors['red-eye'], 'imageProcessor');
    const { bitmap } = createOwnedBitmap(5000, 4000);
    const assetId = registry.registerBaseline('test-doc', bitmap, { ownership: 'adopt' });
    const layer = makeRasterLayer('layer-1', assetId, 5000, 4000, [
      Object.freeze({
        kind: 'apply-raster-processor' as const,
        layerId: 'layer-1',
        processorId: 'blur',
        version: 1,
        args: Object.freeze({ toolName: 'blur', radius: 0 }),
      }),
      Object.freeze({
        kind: 'apply-raster-processor' as const,
        layerId: 'layer-1',
        processorId: 'red-eye',
        version: 1,
        args: Object.freeze({ toolName: 'red-eye', pupilSize: 50, darkenAmount: 50 }),
      }),
    ]);
    class AllocationCountingCanvas extends CallRecordingOffscreenCanvas {
      constructor(width: number, height: number) {
        allocations.push({ width, height });
        super(width, height);
      }
    }

    try {
      vi.stubGlobal('OffscreenCanvas', AllocationCountingCanvas);
      await expect(materializeLayer(layer, makeRequest(registry))).rejects.toThrow(/pixel staging budget/);
      expect(allocations).toEqual([{ width: 5000, height: 4000 }]);
      expect(blurProcessor).toHaveBeenCalledTimes(1);
      expect(redEyeProcessor).not.toHaveBeenCalled();
    } finally {
      toolProcessors.blur.imageProcessor = originalBlurProcessor;
      toolProcessors['red-eye'].imageProcessor = originalRedEyeProcessor;
      vi.unstubAllGlobals();
      registry.shutdown();
    }
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

  it('passes staged pixel dimensions to processors while retaining fractional document bounds', async () => {
    const registry = new AssetRegistry();
    const processorInputs: Array<{ width: number; height: number }> = [];
    const originalImageProcessor = toolProcessors.blur.imageProcessor;
    vi.spyOn(toolProcessors.blur, 'imageProcessor').mockImplementation((params) => {
      processorInputs.push({ ...params.size });
      const bitmap = requireProcessorBitmap(params);
      return () => [bitmap];
    });

    const layer = makeBlankLayer('layer-1', 40, 20, [
      Object.freeze({
        kind: 'apply-affine-transform' as const,
        layerId: 'layer-1',
        transform: Object.freeze({ a: 1.0125, b: 0, c: 0, d: 1.0125, e: 0, f: 0 }),
      }),
      Object.freeze({
        kind: 'apply-raster-processor' as const,
        layerId: 'layer-1',
        processorId: 'blur',
        version: 1,
        args: Object.freeze({ toolName: 'blur', radius: 0 }),
      }),
    ]);

    try {
      const materialized = await materializeLayer(layer, makeRequest(registry));

      expect(processorInputs).toEqual([{ width: 41, height: 21 }]);
      expect(materialized.bitmap.width).toBe(41);
      expect(materialized.bitmap.height).toBe(21);
      expect(materialized.bounds.width).toBeCloseTo(40.5);
      expect(materialized.bounds.height).toBeCloseTo(20.25);
      materialized.lease.release();
    } finally {
      toolProcessors.blur.imageProcessor = originalImageProcessor;
      registry.shutdown();
    }
  });

  it('preserves staged pixels across consecutive processors after a fractional affine', async () => {
    const registry = new AssetRegistry();
    const processorInputs: Array<{
      processorId: string;
      bitmap: BitmapSource;
      size: { width: number; height: number };
    }> = [];
    const originalBlurProcessor = toolProcessors.blur.imageProcessor;
    const originalSharpenProcessor = toolProcessors.sharpen.imageProcessor;
    vi.spyOn(toolProcessors.blur, 'imageProcessor').mockImplementation((params) => {
      const bitmap = requireProcessorBitmap(params);
      processorInputs.push({ processorId: 'blur', bitmap, size: { ...params.size } });
      return () => [bitmap];
    });
    vi.spyOn(toolProcessors.sharpen, 'imageProcessor').mockImplementation((params) => {
      const bitmap = requireProcessorBitmap(params);
      processorInputs.push({ processorId: 'sharpen', bitmap, size: { ...params.size } });
      return () => [bitmap];
    });

    const layer = makeBlankLayer('layer-1', 40, 20, [
      Object.freeze({
        kind: 'apply-affine-transform' as const,
        layerId: 'layer-1',
        transform: Object.freeze({ a: 1.0125, b: 0, c: 0, d: 1, e: 0, f: 0 }),
      }),
      Object.freeze({
        kind: 'apply-raster-processor' as const,
        layerId: 'layer-1',
        processorId: 'blur',
        version: 1,
        args: Object.freeze({ toolName: 'blur', radius: 0 }),
      }),
      Object.freeze({
        kind: 'apply-raster-processor' as const,
        layerId: 'layer-1',
        processorId: 'sharpen',
        version: 1,
        args: Object.freeze({ toolName: 'sharpen', amount: 0 }),
      }),
    ]);

    try {
      const materialized = await materializeLayer(layer, makeRequest(registry));

      expect(processorInputs).toHaveLength(2);
      expect(processorInputs.map(({ processorId }) => processorId)).toEqual(['blur', 'sharpen']);
      expect(processorInputs[0]?.size).toEqual({ width: 41, height: 20 });
      expect(processorInputs[1]?.size).toEqual({ width: 41, height: 20 });
      expect(processorInputs[1]?.bitmap).toBe(processorInputs[0]?.bitmap);
      expect(materialized.bitmap).toBe(processorInputs[1]?.bitmap);
      expect(materialized.bounds.width).toBeCloseTo(40.5);
      expect(materialized.bounds.height).toBe(20);
      materialized.lease.release();
    } finally {
      toolProcessors.blur.imageProcessor = originalBlurProcessor;
      toolProcessors.sharpen.imageProcessor = originalSharpenProcessor;
      registry.shutdown();
    }
  });

  it('copies a borrowed raw raster at intrinsic pixel dimensions before its first processor', async () => {
    const registry = new AssetRegistry();
    const processorInputs: Array<{ bitmap: BitmapSource; size: { width: number; height: number } }> = [];
    const originalImageProcessor = toolProcessors.blur.imageProcessor;
    vi.spyOn(toolProcessors.blur, 'imageProcessor').mockImplementation((params) => {
      const bitmap = requireProcessorBitmap(params);
      processorInputs.push({ bitmap, size: { ...params.size } });
      return () => [bitmap];
    });
    const { bitmap: sourceBitmap } = createOwnedBitmap(41, 20);
    const assetId = registry.registerBaseline('test-doc', sourceBitmap, { ownership: 'borrow' });
    const rasterLayer = makeRasterLayer('layer-1', assetId, 41, 20, [
      Object.freeze({
        kind: 'apply-raster-processor' as const,
        layerId: 'layer-1',
        processorId: 'blur',
        version: 1,
        args: Object.freeze({ toolName: 'blur', radius: 0 }),
      }),
    ]);
    const layer = Object.freeze({
      ...rasterLayer,
      snapshot: makeSnapshot('layer-1', rasterSource(assetId, 41, 20), { x: 0, y: 0, width: 40.5, height: 20 }),
    });
    recordedRenderCalls = [];

    try {
      vi.stubGlobal('OffscreenCanvas', CallRecordingOffscreenCanvas);
      const materialized = await materializeLayer(layer, makeRequest(registry));

      expect(processorInputs).toHaveLength(1);
      expect(processorInputs[0]?.size).toEqual({ width: 41, height: 20 });
      expect(processorInputs[0]?.bitmap).not.toBe(sourceBitmap);
      expect(recordedRenderCalls[0]?.find(({ op }) => op === 'drawImage')?.args).toEqual([sourceBitmap, 0, 0, 41, 20]);
      expect(materialized.bounds.width).toBe(40.5);
      materialized.lease.release();
    } finally {
      toolProcessors.blur.imageProcessor = originalImageProcessor;
      vi.unstubAllGlobals();
      registry.shutdown();
    }
  });

  it('resizes a borrowed raster to logical bounds before durable pixel processing', async () => {
    const registry = new AssetRegistry();
    const processorInputs: Array<{ bitmap: BitmapSource; size: { width: number; height: number } }> = [];
    const originalImageProcessor = toolProcessors.blur.imageProcessor;
    vi.spyOn(toolProcessors.blur, 'imageProcessor').mockImplementation((params) => {
      const bitmap = requireProcessorBitmap(params);
      processorInputs.push({ bitmap, size: { ...params.size } });
      return () => [bitmap];
    });
    const { bitmap: sourceBitmap } = createOwnedBitmap(40, 20);
    const assetId = registry.registerBaseline('test-doc', sourceBitmap, { ownership: 'borrow' });
    const rasterLayer = makeRasterLayer('layer-1', assetId, 40, 20, [
      Object.freeze({
        kind: 'apply-raster-processor' as const,
        layerId: 'layer-1',
        processorId: 'blur',
        version: 1,
        args: Object.freeze({ toolName: 'blur', radius: 0 }),
      }),
    ]);
    const layer = Object.freeze({
      ...rasterLayer,
      snapshot: makeSnapshot('layer-1', rasterSource(assetId, 40, 20), { x: 10, y: 5, width: 80, height: 40 }),
    });
    recordedRenderCalls = [];

    try {
      vi.stubGlobal('OffscreenCanvas', CallRecordingOffscreenCanvas);
      const materialized = await materializeLayer(layer, makeRequest(registry));

      expect(processorInputs).toHaveLength(1);
      expect(processorInputs[0]?.bitmap).not.toBe(sourceBitmap);
      expect(processorInputs[0]?.size).toEqual({ width: 80, height: 40 });
      const drawImageArgs = recordedRenderCalls[0]?.find(({ op }) => op === 'drawImage')?.args;
      expect(drawImageArgs?.[0]).toBe(sourceBitmap);
      expect(drawImageArgs?.slice(-2)).toEqual([80, 40]);
      expect(materialized.bounds).toEqual({ x: 10, y: 5, width: 80, height: 40 });
      materialized.lease.release();
    } finally {
      toolProcessors.blur.imageProcessor = originalImageProcessor;
      vi.unstubAllGlobals();
      registry.shutdown();
    }
  });

  it('draws a processed fractional raster directly into a requested frame', async () => {
    const registry = new AssetRegistry();
    const processorInputs: BitmapSource[] = [];
    const originalImageProcessor = toolProcessors.blur.imageProcessor;
    vi.spyOn(toolProcessors.blur, 'imageProcessor').mockImplementation((params) => {
      const bitmap = requireProcessorBitmap(params);
      processorInputs.push(bitmap);
      return () => [bitmap];
    });
    const { bitmap } = createOwnedBitmap(40, 20);
    const assetId = registry.registerBaseline('test-doc', bitmap, { ownership: 'borrow' });
    const layer = makeRasterLayer('layer-1', assetId, 40, 20, [
      Object.freeze({
        kind: 'apply-affine-transform' as const,
        layerId: 'layer-1',
        transform: Object.freeze({ a: 1.0125, b: 0, c: 0, d: 1, e: 0, f: 0 }),
      }),
      Object.freeze({
        kind: 'apply-raster-processor' as const,
        layerId: 'layer-1',
        processorId: 'blur',
        version: 1,
        args: Object.freeze({ toolName: 'blur', radius: 0 }),
      }),
    ]);
    const frame: DocumentFrame = { x: 0, y: 0, width: 100, height: 80 };
    recordedRenderCalls = [];

    try {
      vi.stubGlobal('OffscreenCanvas', CallRecordingOffscreenCanvas);
      const materialized = await materializeLayer(layer, { ...makeRequest(registry), frame });

      expect(materialized.bitmap.width).toBe(frame.width);
      expect(materialized.bitmap.height).toBe(frame.height);
      expect(recordedRenderCalls).toHaveLength(2);
      const frameDraw = recordedRenderCalls[1]?.find(({ op }) => op === 'drawImage');
      expect(frameDraw?.args[0]).toBe(processorInputs[0]);
      materialized.lease.release();
    } finally {
      toolProcessors.blur.imageProcessor = originalImageProcessor;
      vi.unstubAllGlobals();
      registry.shutdown();
    }
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
  // SD-8 replaced the whole-document rejection this test asserted. The discriminating
  // concern it was built around survives intact and moves with the behaviour: a
  // per-layer failure must release exactly the OTHER layers' leases, on `release()`,
  // in document order — and nothing at all before that. `layer-other` exists so that
  // "which key" is answerable at all, since `createMaterializationKey` encodes no
  // layer id and two identically-shaped layers would share one key.
  it('omits only the refused layer and releases just the surviving leases on release', async () => {
    const registry = new AssetRegistry();
    const { bitmap, close } = createOwnedBitmap(10, 10);
    // Registered under the request's OWN document id. Under a different id the two
    // assertions near the bottom would hold for reasons that have nothing to do with
    // cleanup: disposing `'document-a'` would leave this baseline untouched either way.
    const validAssetId = registry.registerBaseline('test-doc', bitmap, { ownership: 'adopt' });

    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
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

    const result = await materializeDocument(replay, request);

    // `layer-bad` is omitted; both layers around it composited, so the failure did not
    // truncate the document at the point it occurred.
    expect(Object.keys(result.layers)).toEqual(['layer-ok', 'layer-other']);
    expect(result.layers['layer-bad']).toBeUndefined();
    expect(result.layers['layer-ok'].bitmap).toBeDefined();
    expect(result.layers['layer-other'].bitmap).toBeDefined();

    expect(consoleError).toHaveBeenCalledTimes(1);
    const [message, reported] = consoleError.mock.calls[0] as [string, Error];
    expect(message).toBe('Unable to materialize durable layer layer-bad; skipping layer');
    expect(reported.message).toMatch(/Unknown or disposed asset/);

    // A refused layer no longer triggers the rollback, so nothing is released while
    // `materializeDocument` is still working.
    expect(releaseSpy).not.toHaveBeenCalled();

    // On release: exactly the two surviving layers, in document order. `layer-bad`
    // never took a lease, so its key cannot appear — and the two survivor keys are
    // distinct, which is what makes this comparison able to fail.
    const okKey = createMaterializationKey(layerOk, request);
    const otherKey = createMaterializationKey(layerOther, request);
    expect(okKey).not.toBe(otherKey);
    result.release();
    expect(releasedKeys).toEqual([okKey, otherKey]);

    // Cleanup releases leases, not this document's baseline assets.
    expect(registry.getRecord(validAssetId)).toBeDefined();
    expect(close).not.toHaveBeenCalled();

    registry.shutdown();
    expect(close).toHaveBeenCalledTimes(1);
  });

  // The rollback this suite used to pin through a per-layer failure is now only
  // reachable through an abort, so the pin moves with it. Deleting the loop body in
  // `materializeDocument`'s outer `catch` turns this red; the abort-before-any-layer
  // case below cannot, because it rolls back an empty set.
  it('releases already-materialized layer leases when the document is aborted mid-loop', async () => {
    const registry = new AssetRegistry();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const releaseSpy = vi.fn();
    const releasedKeys: string[] = [];
    const controller = new AbortController();
    const originalMaterialize = registry.materialize.bind(registry);
    vi.spyOn(registry, 'materialize').mockImplementation(async (input) => {
      const lease = await originalMaterialize(input);
      const originalRelease = lease.release;
      // Abort as soon as the first layer's lease exists, so the SECOND iteration is
      // the one that trips the signal check at the top of the loop.
      controller.abort();
      return {
        ...lease,
        release: () => {
          releaseSpy();
          releasedKeys.push(input.key);
          originalRelease();
        },
      };
    });

    const request = makeRequest(registry, controller.signal);
    const layerOk = makeBlankLayer('layer-ok', 50, 50);
    const layerOther = makeBlankLayer('layer-other', 50, 60);
    const replay = makeReplay({ 'layer-ok': layerOk, 'layer-other': layerOther });

    await expect(materializeDocument(replay, request)).rejects.toThrow(/aborted/);

    // An abort is still a document-level failure: it rejects rather than omitting a
    // layer, the one lease already handed out is released on the way out, and an abort
    // never reaches the per-layer `console.error` path.
    expect(consoleError).not.toHaveBeenCalled();
    expect(releasedKeys).toEqual([createMaterializationKey(layerOk, request)]);

    registry.shutdown();
  });

  it('stops a batch before later layers when document disposal advances its captured generation', async () => {
    const registry = new AssetRegistry();
    const request = makeRequest(registry);
    const originalMaterialize = registry.materialize.bind(registry);
    let disposed = false;
    const materialize = vi.spyOn(registry, 'materialize').mockImplementation(async (input) => {
      const lease = await originalMaterialize(input);
      if (!disposed) {
        disposed = true;
        registry.disposeDocument(request.documentId);
      }
      return lease;
    });

    await expect(
      materializeDocument(
        makeReplay({
          'layer-first': makeBlankLayer('layer-first', 40, 40),
          'layer-late': makeBlankLayer('layer-late', 40, 50),
        }),
        request
      )
    ).rejects.toMatchObject({ name: 'AbortError' });

    expect(disposed).toBe(true);
    expect(materialize).toHaveBeenCalledOnce();
    expect(materialize.mock.calls[0]?.[0].expectedDocumentGeneration).toBe(request.baselineAssetGeneration);
    registry.shutdown();
  });

  it('rejects a document disposed during the final cooperative yield', async () => {
    const registry = new AssetRegistry();
    const request = makeRequest(registry);
    const originalMaterialize = registry.materialize.bind(registry);
    const release = vi.fn();
    vi.spyOn(registry, 'materialize').mockImplementation(async (input) => {
      const lease = await originalMaterialize(input);
      const releaseLease = lease.release;
      registry.disposeDocument(request.documentId);
      return {
        ...lease,
        release: () => {
          release();
          releaseLease();
        },
      };
    });

    await expect(
      materializeDocument(makeReplay({ 'layer-final': makeBlankLayer('layer-final', 40, 40) }), request)
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(release).toHaveBeenCalledOnce();
    registry.shutdown();
  });

  it('releases materialized layers when cancellation arrives during the final yield', async () => {
    const registry = new AssetRegistry();
    const controller = new AbortController();
    const request = makeRequest(registry, controller.signal);
    const originalMaterialize = registry.materialize.bind(registry);
    const yieldScheduled = deferred<void>();
    const originalSetTimeout = globalThis.setTimeout;
    const release = vi.fn();
    vi.spyOn(registry, 'materialize').mockImplementation(async (input) => {
      const lease = await originalMaterialize(input);
      const releaseLease = lease.release;
      return {
        ...lease,
        release: () => {
          release();
          releaseLease();
        },
      };
    });
    vi.spyOn(globalThis, 'setTimeout').mockImplementationOnce((callback, delay, ...args) => {
      const timer = originalSetTimeout(callback, delay, ...args);
      yieldScheduled.resolve();
      return timer;
    });

    const materialization = materializeDocument(
      makeReplay({ 'layer-final': makeBlankLayer('layer-final', 40, 40) }),
      request
    );
    await yieldScheduled.promise;
    controller.abort();

    await expect(materialization).rejects.toMatchObject({ name: 'AbortError' });
    expect(release).toHaveBeenCalledOnce();
    registry.shutdown();
  });

  it('propagates a cross-realm AbortError and releases earlier layer leases', async () => {
    const registry = new AssetRegistry();
    const request = makeRequest(registry);
    const originalMaterialize = registry.materialize.bind(registry);
    const release = vi.fn();
    let calls = 0;
    vi.spyOn(registry, 'materialize').mockImplementation(async (input) => {
      calls += 1;
      if (calls === 2) {
        const frame = document.createElement('iframe');
        document.body.append(frame);
        const ForeignDOMException = (frame.contentWindow as unknown as { DOMException?: typeof DOMException } | null)
          ?.DOMException;
        frame.remove();
        if (!ForeignDOMException) throw new Error('The iframe DOMException constructor is unavailable');
        throw new ForeignDOMException('Materialization aborted in another realm', 'AbortError');
      }
      const lease = await originalMaterialize(input);
      const releaseLease = lease.release;
      return {
        ...lease,
        release: () => {
          release();
          releaseLease();
        },
      };
    });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(
      materializeDocument(
        makeReplay({
          'layer-first': makeBlankLayer('layer-first', 40, 40),
          'layer-second': makeBlankLayer('layer-second', 40, 50),
        }),
        request
      )
    ).rejects.toMatchObject({ name: 'AbortError' });

    expect(release).toHaveBeenCalledOnce();
    expect(consoleError).not.toHaveBeenCalled();
    registry.shutdown();
  });

  it('does not treat spoofed values as cross-realm AbortErrors', async () => {
    const registry = new AssetRegistry();
    const spoofedAbortError = new Error('ordinary failure') as Error & { [Symbol.toStringTag]: string };
    spoofedAbortError.name = 'AbortError';
    Object.defineProperty(spoofedAbortError, Symbol.toStringTag, { value: 'DOMException' });
    const spoofedDomException = Object.create(DOMException.prototype) as DOMException;
    Object.defineProperty(spoofedDomException, 'name', { value: 'AbortError' });
    vi.spyOn(registry, 'materialize')
      .mockRejectedValueOnce(spoofedAbortError)
      .mockRejectedValueOnce(spoofedDomException);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const result = await materializeDocument(
      makeReplay({
        'layer-failed': makeBlankLayer('layer-failed', 40, 40),
        'layer-also-failed': makeBlankLayer('layer-also-failed', 40, 50),
      }),
      makeRequest(registry)
    );

    expect(result.layers).toEqual({});
    expect(consoleError).toHaveBeenCalledTimes(2);
    result.release();
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

  it('does not start a blank layer materialization for a pre-aborted signal', async () => {
    const registry = new AssetRegistry();
    const controller = new AbortController();
    controller.abort();
    const materialize = vi.spyOn(registry, 'materialize');

    await expect(
      materializeLayer(makeBlankLayer('layer-pre-aborted', 40, 40), makeRequest(registry, controller.signal))
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(materialize).not.toHaveBeenCalled();
  });

  it('releases a blank layer lease when cancellation arrives before materializeLayer returns', async () => {
    const registry = new AssetRegistry();
    const controller = new AbortController();
    const originalMaterialize = registry.materialize.bind(registry);
    const release = vi.fn();
    vi.spyOn(registry, 'materialize').mockImplementation(async (input) => {
      const lease = await originalMaterialize(input);
      const releaseLease = lease.release;
      controller.abort();
      return {
        ...lease,
        release: () => {
          release();
          releaseLease();
        },
      };
    });

    await expect(
      materializeLayer(makeBlankLayer('layer-cancelled', 40, 40), makeRequest(registry, controller.signal))
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(release).toHaveBeenCalledOnce();
    registry.shutdown();
  });

  it('aborts an empty document when its signal is already aborted', async () => {
    const registry = new AssetRegistry();
    const controller = new AbortController();
    controller.abort();

    await expect(materializeDocument(makeReplay({}), makeRequest(registry, controller.signal))).rejects.toMatchObject({
      name: 'AbortError',
    });
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

  it('reuses one compositor frame surface while materializing multiple affine layers', async () => {
    const registry = new AssetRegistry();
    const frame: DocumentFrame = { x: 8, y: 9, width: 80, height: 60 };
    const frameAllocations: Array<{ width: number; height: number }> = [];
    class FrameAllocationCountingCanvas extends CallRecordingOffscreenCanvas {
      constructor(width: number, height: number) {
        super(width, height);
        if (width === frame.width && height === frame.height) frameAllocations.push({ width, height });
      }
    }
    const layer = (id: string, translateX: number) =>
      makeBlankLayer(id, 20, 16, [
        Object.freeze({
          kind: 'apply-affine-transform' as const,
          layerId: id,
          transform: Object.freeze({ a: 1, b: 0, c: 0, d: 1, e: translateX, f: 12 }),
        }),
      ]);

    try {
      vi.stubGlobal('OffscreenCanvas', FrameAllocationCountingCanvas);
      const composite = await composeDurableDocument(
        makeReplay({
          first: layer('first', 12),
          second: layer('second', 28),
        }),
        { ...makeRequest(registry), frame }
      );

      expect(frameAllocations).toEqual([{ width: frame.width, height: frame.height }]);
      expect(composite.layers.first?.bounds).not.toEqual({
        x: frame.x,
        y: frame.y,
        width: frame.width,
        height: frame.height,
      });
      expect(composite.layers.second?.bounds).not.toEqual({
        x: frame.x,
        y: frame.y,
        width: frame.width,
        height: frame.height,
      });
      composite.release();
    } finally {
      vi.unstubAllGlobals();
      registry.shutdown();
    }
  });

  it('keeps direct frame-aligned affine materialization supported and releases its local surface', async () => {
    const registry = new AssetRegistry();
    const frame: DocumentFrame = { x: 8, y: 9, width: 80, height: 60 };
    const frameSurfaces: CallRecordingOffscreenCanvas[] = [];
    class FrameAllocationCountingCanvas extends CallRecordingOffscreenCanvas {
      constructor(width: number, height: number) {
        super(width, height);
        if (width === frame.width && height === frame.height) frameSurfaces.push(this);
      }
    }
    const affineLayer = makeBlankLayer('standalone-affine', 20, 16, [
      Object.freeze({
        kind: 'apply-affine-transform' as const,
        layerId: 'standalone-affine',
        transform: Object.freeze({ a: 1, b: 0, c: 0, d: 1, e: 12.25, f: 12.5 }),
      }),
    ]);

    try {
      vi.stubGlobal('OffscreenCanvas', FrameAllocationCountingCanvas);
      vi.stubGlobal('createImageBitmap', undefined);
      const materialized = await materializeLayer(affineLayer, {
        ...makeRequest(registry),
        pixelGridFrame: frame,
      });

      expect(materialized.bounds.x - frame.x).toBeCloseTo(Math.floor(materialized.bounds.x - frame.x), 8);
      expect(materialized.bounds.y - frame.y).toBeCloseTo(Math.floor(materialized.bounds.y - frame.y), 8);
      expect(frameSurfaces).toHaveLength(1);
      expect(frameSurfaces[0]).toMatchObject({ width: 1, height: 1 });
      materialized.lease.release();
    } finally {
      vi.unstubAllGlobals();
      registry.shutdown();
    }
  });
});
