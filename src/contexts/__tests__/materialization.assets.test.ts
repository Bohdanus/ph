import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { makeMockCtx } from '../../__tests__/canvas-mock.ts';
import { AssetRegistry } from '../asset-registry.ts';
import type { BitmapSource } from '../general-types.ts';
import type { DurableReplayLayer, DurableReplayResult } from '../durable-replay.ts';
import type { DocumentFrame } from '../document-frame.ts';
import type { AssetId, DurableLayerSnapshot, DurableLayerSource, DurableOperation } from '../history-model.ts';
import { createMaterializationKey, materializeDocument, materializeLayer } from '../materialization.ts';
import type { MaterializationRequest } from '../materialization.ts';
import { toolProcessors } from '../../tools/toolProcessors.ts';

const defaultFrame: DocumentFrame = { x: 0, y: 0, width: 400, height: 300 };

/** Every context handed out by the recording OffscreenCanvas, in creation order. */
let recordedContexts: Array<CanvasRenderingContext2D> = [];
/** Every ImageBitmap produced by the recording createImageBitmap, in creation order. */
let recordedBitmaps: Array<ImageBitmap & { close: ReturnType<typeof vi.fn> }> = [];

class RecordingOffscreenCanvas {
  width: number;
  height: number;
  private context: CanvasRenderingContext2D | null = null;

  private readonly contextAvailable: boolean;

  constructor(width: number, height: number, contextAvailable = true) {
    this.width = width;
    this.height = height;
    this.contextAvailable = contextAvailable;
  }

  getContext(): OffscreenCanvasRenderingContext2D | null {
    if (!this.contextAvailable) return null;
    if (!this.context) {
      this.context = makeMockCtx({ canvas: this as unknown as HTMLCanvasElement });
      recordedContexts.push(this.context);
    }
    return this.context as unknown as OffscreenCanvasRenderingContext2D;
  }

  resize(width: number, height: number) {
    this.width = width;
    this.height = height;
  }

  transferToImageBitmap() {
    return this.makeBitmap();
  }

  convertToBlob() {
    return Promise.resolve(new Blob([]));
  }

  makeBitmap() {
    const bitmap = { width: this.width, height: this.height, close: vi.fn() };
    recordedBitmaps.push(bitmap);
    return bitmap as unknown as ImageBitmap;
  }
}

function closeSpy(bitmap: BitmapSource) {
  return (bitmap as unknown as { close: ReturnType<typeof vi.fn> }).close;
}

function makeOwnedBitmap(width = 10, height = 10) {
  const close = vi.fn();
  return { bitmap: { width, height, close } as unknown as ImageBitmap, close };
}

function makeSnapshot(
  id: string,
  source: DurableLayerSource,
  pos: { x: number; y: number; width: number; height: number }
) {
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
  }) as DurableLayerSnapshot;
}

function makeLayer(
  id: string,
  source: DurableLayerSource,
  pos: { x: number; y: number; width: number; height: number },
  operations: DurableOperation[] = []
): DurableReplayLayer {
  return Object.freeze({ snapshot: makeSnapshot(id, source, pos), operations: Object.freeze([...operations]) });
}

function blankSource(width: number, height: number): DurableLayerSource {
  return Object.freeze({ kind: 'blank' as const, color: '#ffffff', opacity: 1, size: { width, height } });
}

function rasterSource(assetId: AssetId, width: number, height: number): DurableLayerSource {
  return Object.freeze({ kind: 'raster' as const, assetId, width, height });
}

function makeRequest(registry: AssetRegistry, overrides: Partial<MaterializationRequest> = {}): MaterializationRequest {
  return {
    documentId: 'test-doc',
    baselineAssetGeneration: 0,
    operationSetRevision: 0,
    assetRegistry: registry,
    ...overrides,
  };
}

function makeReplay(layers: Record<string, DurableReplayLayer>): DurableReplayResult {
  return Object.freeze({
    documentId: 'test-doc',
    documentRevision: 1,
    branchRevision: 0,
    durableRevision: 0,
    cursor: 0,
    frame: { ...defaultFrame },
    layers: Object.freeze({ ...layers }),
    selections: Object.freeze({ selections: Object.freeze([]), activeSelectionId: null }),
    activeLayerId: Object.keys(layers)[0] ?? null,
  });
}

beforeEach(() => {
  recordedContexts = [];
  recordedBitmaps = [];
  vi.stubGlobal('OffscreenCanvas', RecordingOffscreenCanvas);
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async (source: { width: number; height: number }) => {
      const bitmap = { width: source.width, height: source.height, close: vi.fn() };
      recordedBitmaps.push(bitmap);
      return bitmap as unknown as ImageBitmap;
    })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('materialization cache key stability', () => {
  it('produces the same key regardless of object key insertion order', () => {
    const registry = new AssetRegistry();
    const argsA = Object.freeze({ radius: 4, toolName: 'blur' });
    const argsB = Object.freeze({ toolName: 'blur', radius: 4 });
    const layerA = makeLayer('layer-1', blankSource(10, 10), { x: 0, y: 0, width: 10, height: 10 }, [
      {
        kind: 'apply-filter',
        layerId: 'layer-1',
        filter: Object.freeze({ toolName: 'blur', version: 1, args: argsA }),
      },
    ]);
    const layerB = makeLayer('layer-1', blankSource(10, 10), { x: 0, y: 0, width: 10, height: 10 }, [
      {
        kind: 'apply-filter',
        layerId: 'layer-1',
        filter: Object.freeze({ toolName: 'blur', version: 1, args: argsB }),
      },
    ]);

    expect(createMaterializationKey(layerA, makeRequest(registry))).toBe(
      createMaterializationKey(layerB, makeRequest(registry))
    );
  });

  it.each([
    { label: 'the document id', request: { documentId: 'other-doc' } },
    { label: 'the baseline asset generation', request: { baselineAssetGeneration: 3 } },
    { label: 'the operation set revision', request: { operationSetRevision: 9 } },
  ])('changes the key when $label changes', ({ request }) => {
    const registry = new AssetRegistry();
    const layer = makeLayer('layer-1', blankSource(10, 10), { x: 0, y: 0, width: 10, height: 10 });

    expect(createMaterializationKey(layer, makeRequest(registry, request))).not.toBe(
      createMaterializationKey(layer, makeRequest(registry))
    );
  });

  it('changes the key when the layer position changes', () => {
    const registry = new AssetRegistry();
    const a = makeLayer('layer-1', blankSource(10, 10), { x: 0, y: 0, width: 10, height: 10 });
    const b = makeLayer('layer-1', blankSource(10, 10), { x: 5, y: 0, width: 10, height: 10 });

    expect(createMaterializationKey(a, makeRequest(registry))).not.toBe(
      createMaterializationKey(b, makeRequest(registry))
    );
  });

  it('changes the key when the document frame changes and omits the frame entirely without one', () => {
    const registry = new AssetRegistry();
    const layer = makeLayer('layer-1', blankSource(10, 10), { x: 0, y: 0, width: 10, height: 10 });
    const frameA: DocumentFrame = { x: 0, y: 0, width: 400, height: 300 };
    const frameB: DocumentFrame = { x: 10, y: 0, width: 400, height: 300 };

    const withA = createMaterializationKey(layer, makeRequest(registry, { frame: frameA }));
    const withB = createMaterializationKey(layer, makeRequest(registry, { frame: frameB }));
    const without = createMaterializationKey(layer, makeRequest(registry));

    expect(withA).not.toBe(withB);
    expect(withA).not.toBe(without);
    expect(without).not.toContain('"frame"');
  });

  it('folds the raster source generation into the key and falls back to -1 for an unknown asset', () => {
    const registry = new AssetRegistry();
    const first = makeOwnedBitmap(10, 10);
    const second = makeOwnedBitmap(10, 10);
    const firstId = registry.registerBaseline('test-doc', first.bitmap, { ownership: 'adopt' });
    const secondId = registry.registerBaseline('test-doc', second.bitmap, { ownership: 'adopt' });
    const firstLayer = makeLayer('layer-1', rasterSource(firstId, 10, 10), { x: 0, y: 0, width: 10, height: 10 });
    const secondLayer = makeLayer('layer-1', rasterSource(secondId, 10, 10), { x: 0, y: 0, width: 10, height: 10 });
    const unknownLayer = makeLayer('layer-1', rasterSource('missing' as AssetId, 10, 10), {
      x: 0,
      y: 0,
      width: 10,
      height: 10,
    });

    // Two baselines registered in the same document carry different
    // generations, so their materialization keys can never collide even though
    // the layer geometry is identical.
    const firstKey = createMaterializationKey(firstLayer, makeRequest(registry));
    const secondKey = createMaterializationKey(secondLayer, makeRequest(registry));
    const unknownKey = createMaterializationKey(unknownLayer, makeRequest(registry));

    expect(firstKey).not.toBe(secondKey);
    expect(unknownKey).not.toBe(firstKey);
    expect(unknownKey).toContain('"sourceGeneration":-1');
    registry.shutdown();
  });
});

describe('materialization canvas factory fallbacks', () => {
  it('falls back to a DOM canvas when OffscreenCanvas is unavailable', async () => {
    vi.stubGlobal('OffscreenCanvas', undefined);
    const registry = new AssetRegistry();
    const layer = makeLayer('layer-1', blankSource(12, 8), { x: 0, y: 0, width: 12, height: 8 });

    const result = await materializeLayer(layer, makeRequest(registry));

    expect(result.bitmap).toBeDefined();
    expect(result.bounds).toEqual({ x: 0, y: 0, width: 12, height: 8 });
    result.lease.release();
    registry.shutdown();
  });

  it('rounds fractional and zero sizes up to at least one pixel', async () => {
    const registry = new AssetRegistry();
    const layer = makeLayer('layer-1', blankSource(0, 0), { x: 0, y: 0, width: 10.2, height: 0.4 });

    const result = await materializeLayer(layer, makeRequest(registry));

    // The final retained segment renders the current logical presentation size.
    const lastCanvasWidth = recordedContexts.at(-1)?.canvas.width;
    expect(lastCanvasWidth).toBeGreaterThanOrEqual(1);
    result.lease.release();
    registry.shutdown();
  });

  it('rejects with a controlled error when no 2D context is available', async () => {
    // A canvas implementation that refuses to hand out a 2D context.
    class ContextlessCanvas extends RecordingOffscreenCanvas {
      constructor(width: number, height: number) {
        super(width, height, false);
      }
    }
    vi.stubGlobal('OffscreenCanvas', ContextlessCanvas);
    const registry = new AssetRegistry();
    const layer = makeLayer('layer-1', blankSource(10, 10), { x: 0, y: 0, width: 10, height: 10 });

    await expect(materializeLayer(layer, makeRequest(registry))).rejects.toThrow(
      'A 2D canvas context is required for materialization'
    );
    registry.shutdown();
  });

  it('returns the raw canvas when createImageBitmap is unavailable', async () => {
    vi.stubGlobal('createImageBitmap', undefined);
    const registry = new AssetRegistry();
    const layer = makeLayer('layer-1', blankSource(10, 10), { x: 0, y: 0, width: 10, height: 10 });

    const result = await materializeLayer(layer, makeRequest(registry));

    expect(result.bitmap).toBeInstanceOf(RecordingOffscreenCanvas);
    result.lease.release();
    registry.shutdown();
  });
});

describe('materialization retained filter rendering', () => {
  const filterOperation = (toolName: 'blur' | 'color' | 'levels', args: Record<string, number>) =>
    ({
      kind: 'apply-filter',
      layerId: 'layer-1',
      filter: Object.freeze({ toolName, version: 1, args: Object.freeze(args) }),
    }) as DurableOperation;

  it.each([
    { toolName: 'blur' as const, args: { radius: 4 } as Record<string, number>, expected: /^blur\(4px\)$/ },
    {
      toolName: 'color' as const,
      args: { grayscale: 10, sepia: 0, saturation: 0 } as Record<string, number>,
      expected: /^grayscale\(10%\)/,
    },
    {
      toolName: 'levels' as const,
      args: { brightness: 0, contrast: 0 } as Record<string, number>,
      expected: /^brightness\(100%\) contrast\(100%\)$/,
    },
  ])('renders a $toolName filter through the canvas filter string', async ({ toolName, args, expected }) => {
    const registry = new AssetRegistry();
    const layer = makeLayer('layer-1', blankSource(10, 10), { x: 0, y: 0, width: 10, height: 10 }, [
      filterOperation(toolName, args),
    ]);

    const result = await materializeLayer(layer, makeRequest(registry));

    const filters = recordedContexts.map((ctx) => ctx.filter).filter(Boolean);
    expect(filters.some((filter) => expected.test(filter))).toBe(true);
    result.lease.release();
    registry.shutdown();
  });

  it('applies the default filter argument values when a filter omits its parameters', async () => {
    const registry = new AssetRegistry();
    const layer = makeLayer('layer-1', blankSource(10, 10), { x: 0, y: 0, width: 10, height: 10 }, [
      filterOperation('blur', {}),
      filterOperation('color', {}),
      filterOperation('levels', {}),
    ]);

    const result = await materializeLayer(layer, makeRequest(registry));

    const filters = recordedContexts.map((ctx) => ctx.filter);
    expect(filters.some((filter) => filter.startsWith('blur(0px)'))).toBe(true);
    expect(filters.some((filter) => filter.includes('grayscale(0%) sepia(0%) saturate(100%)'))).toBe(true);
    expect(filters.some((filter) => filter.includes('brightness(100%) contrast(100%)'))).toBe(true);
    result.lease.release();
    registry.shutdown();
  });

  it('rejects a filter whose replay version no longer matches the registered processor', async () => {
    const registry = new AssetRegistry();
    const layer = makeLayer('layer-1', blankSource(10, 10), { x: 0, y: 0, width: 10, height: 10 }, [
      {
        kind: 'apply-filter',
        layerId: 'layer-1',
        filter: Object.freeze({ toolName: 'blur', version: 99, args: Object.freeze({ radius: 2 }) }),
      },
    ]);

    await expect(materializeLayer(layer, makeRequest(registry))).rejects.toThrow('Unsupported filter blur v99');
    registry.shutdown();
  });

  it('rejects a filter whose tool has no registered processor', async () => {
    const registry = new AssetRegistry();
    const layer = makeLayer('layer-1', blankSource(10, 10), { x: 0, y: 0, width: 10, height: 10 }, [
      {
        kind: 'apply-filter',
        layerId: 'layer-1',
        filter: Object.freeze({ toolName: 'levels', version: 1, args: Object.freeze({}) }),
      } satisfies DurableOperation,
    ]);

    const original = toolProcessors.levels;
    Reflect.deleteProperty(toolProcessors, 'levels');
    try {
      await expect(materializeLayer(layer, makeRequest(registry))).rejects.toThrow('Unsupported filter levels v1');
    } finally {
      Object.assign(toolProcessors, { levels: original });
    }
    registry.shutdown();
  });
});

describe('materialization source kinds', () => {
  it('rejects a legacy-tool source because it has no deterministic raster', async () => {
    const registry = new AssetRegistry();
    const layer = makeLayer(
      'layer-1',
      Object.freeze({
        kind: 'legacy-tool' as const,
        toolName: 'pen',
        args: Object.freeze({}),
        size: { width: 10, height: 10 },
      }),
      { x: 0, y: 0, width: 10, height: 10 }
    );

    await expect(materializeLayer(layer, makeRequest(registry))).rejects.toThrow(
      'Legacy source pen requires an explicit adapter'
    );
    registry.shutdown();
  });

  it('renders a vector source through its deterministic creator', async () => {
    const registry = new AssetRegistry();
    const layer = makeLayer(
      'layer-1',
      Object.freeze({
        kind: 'vector' as const,
        toolName: 'shape',
        args: Object.freeze({ toolName: 'shape', figure: 'rectangle', start: { x: 0, y: 0 }, end: { x: 4, y: 4 } }),
        size: { width: 10, height: 10 },
        sourcePos: Object.freeze({ x: 0, y: 0, width: 10, height: 10 }),
      }),
      { x: 0, y: 0, width: 10, height: 10 }
    );

    const result = await materializeLayer(layer, makeRequest(registry));

    expect(result.bitmap).toBeDefined();
    result.lease.release();
    registry.shutdown();
  });

  it('renders a text source through the text creator using its intrinsic size', async () => {
    const registry = new AssetRegistry();
    const layer = makeLayer(
      'layer-1',
      Object.freeze({
        kind: 'text' as const,
        args: Object.freeze({ toolName: 'text', text: 'hi' }),
        size: { width: 32, height: 16 },
        sourcePos: Object.freeze({ x: 0, y: 0, width: 32, height: 16 }),
      }),
      { x: 0, y: 0, width: 32, height: 16 }
    );

    const result = await materializeLayer(layer, makeRequest(registry));

    expect(result.bitmap).toBeDefined();
    result.lease.release();
    registry.shutdown();
  });

  it('rejects a vector source whose tool is not a deterministic creator', async () => {
    const registry = new AssetRegistry();
    const layer = makeLayer(
      'layer-1',
      Object.freeze({
        kind: 'vector' as const,
        toolName: 'freeform-pen',
        args: Object.freeze({ toolName: 'freeform-pen' }),
        size: { width: 10, height: 10 },
        sourcePos: Object.freeze({ x: 0, y: 0, width: 10, height: 10 }),
      }),
      { x: 0, y: 0, width: 10, height: 10 }
    );

    await expect(materializeLayer(layer, makeRequest(registry))).rejects.toThrow(
      'Source tool freeform-pen is not a deterministic creator'
    );
    registry.shutdown();
  });

  it('rejects when a deterministic creator produces no raster', async () => {
    const registry = new AssetRegistry();
    vi.spyOn(toolProcessors.shape, 'imageProcessor').mockImplementation(() => () => [null as never]);
    const layer = makeLayer(
      'layer-1',
      Object.freeze({
        kind: 'vector' as const,
        toolName: 'shape',
        args: Object.freeze({ toolName: 'shape' }),
        size: { width: 10, height: 10 },
        sourcePos: Object.freeze({ x: 0, y: 0, width: 10, height: 10 }),
      }),
      { x: 0, y: 0, width: 10, height: 10 }
    );

    await expect(materializeLayer(layer, makeRequest(registry))).rejects.toThrow(
      'Source tool shape produced no raster'
    );
    registry.shutdown();
  });
});

describe('materialization vector argument scaling', () => {
  // Presentation size is 200x100, the recorded intrinsic source size is 100x50,
  // so both scale factors are exactly 2.
  function vectorLayer(
    sourcePos: { x: number; y: number; width: number; height: number },
    args: Record<string, unknown>
  ) {
    return makeLayer(
      'layer-1',
      Object.freeze({
        kind: 'vector' as const,
        toolName: 'shape',
        args: Object.freeze({ toolName: 'shape', ...args }),
        size: { width: 10, height: 10 },
        sourcePos: Object.freeze(sourcePos),
      }),
      { x: 0, y: 0, width: 200, height: 100 }
    );
  }

  async function captureShapeArgs(layer: DurableReplayLayer, registry: AssetRegistry) {
    const seen: Array<Record<string, unknown>> = [];
    vi.spyOn(toolProcessors.shape, 'imageProcessor').mockImplementation(() => (args) => {
      seen.push(args as unknown as Record<string, unknown>);
      return [new RecordingOffscreenCanvas(200, 100) as unknown as BitmapSource];
    });
    await materializeLayer(layer, makeRequest(registry));
    return seen;
  }

  it('scales start, end and line width to the current presentation size', async () => {
    const registry = new AssetRegistry();
    const layer = vectorLayer(
      { x: 0, y: 0, width: 100, height: 50 },
      { start: { x: 10, y: 5 }, end: { x: 40, y: 20 }, lineWidth: 4 }
    );

    const [args] = await captureShapeArgs(layer, registry);

    expect(args.start).toEqual({ x: 20, y: 10 });
    expect(args.end).toEqual({ x: 80, y: 40 });
    expect(args.lineWidth).toBeCloseTo(8);
    registry.shutdown();
  });

  it('omits lineWidth entirely when the vector args never declared one', async () => {
    const registry = new AssetRegistry();
    const layer = vectorLayer(
      { x: 0, y: 0, width: 100, height: 50 },
      { start: { x: 10, y: 5 }, end: { x: 20, y: 10 } }
    );

    const [args] = await captureShapeArgs(layer, registry);

    expect(args.lineWidth).toBeUndefined();
    expect(args).not.toHaveProperty('lineWidth');
    registry.shutdown();
  });

  it('passes the args through unchanged when the source has no positive intrinsic size', async () => {
    const registry = new AssetRegistry();
    const args = { start: { x: 10, y: 5 }, end: { x: 40, y: 20 }, lineWidth: 4 };
    const layer = vectorLayer({ x: 0, y: 0, width: 0, height: 50 }, args);

    const [seen] = await captureShapeArgs(layer, registry);

    expect(seen.start).toEqual(args.start);
    expect(seen.end).toEqual(args.end);
    expect(seen.lineWidth).toBe(4);
    registry.shutdown();
  });

  it.each([
    { label: 'no start point', args: { end: { x: 40, y: 20 }, lineWidth: 4 } },
    { label: 'no end point', args: { start: { x: 10, y: 5 }, lineWidth: 4 } },
    { label: 'neither endpoint', args: { lineWidth: 4 } },
  ])('passes the args through unchanged with $label', async ({ args }) => {
    const registry = new AssetRegistry();
    const layer = vectorLayer({ x: 0, y: 0, width: 100, height: 50 }, args);

    const [seen] = await captureShapeArgs(layer, registry);

    expect(seen.start).toEqual(args.start);
    expect(seen.end).toEqual(args.end);
    expect(seen.lineWidth).toBe(4);
    registry.shutdown();
  });
});

describe('materialization operation loop guards', () => {
  it.each([
    {
      label: 'an unknown processor id',
      operation: { kind: 'apply-raster-processor', processorId: 'nope', version: 1 },
      message: 'Unknown raster processor nope v1',
    },
    {
      label: 'a mismatched processor version',
      operation: { kind: 'apply-raster-processor', processorId: 'blur', version: 42 },
      message: 'Unsupported raster processor blur v42',
    },
  ])('rejects $label', async ({ operation, message }) => {
    const registry = new AssetRegistry();
    const layer = makeLayer('layer-1', blankSource(10, 10), { x: 0, y: 0, width: 10, height: 10 }, [
      { layerId: 'layer-1', args: Object.freeze({ toolName: 'blur', radius: 2 }), ...operation } as DurableOperation,
    ]);

    await expect(materializeLayer(layer, makeRequest(registry))).rejects.toThrow(message);
    registry.shutdown();
  });

  it('rejects when a raster processor produces no raster', async () => {
    const registry = new AssetRegistry();
    vi.spyOn(toolProcessors.blur, 'imageProcessor').mockImplementation(() => () => [null as never]);
    const layer = makeLayer('layer-1', blankSource(10, 10), { x: 0, y: 0, width: 10, height: 10 }, [
      {
        kind: 'apply-raster-processor',
        layerId: 'layer-1',
        processorId: 'blur',
        version: 1,
        args: Object.freeze({ toolName: 'blur', radius: 2 }),
      },
    ]);

    await expect(materializeLayer(layer, makeRequest(registry))).rejects.toThrow(
      'Raster processor blur produced no raster'
    );
    registry.shutdown();
  });

  it('skips operation kinds that are neither retained nor raster processors', async () => {
    const registry = new AssetRegistry();
    const layer = makeLayer('layer-1', blankSource(10, 10), { x: 0, y: 0, width: 10, height: 10 }, [
      { kind: 'remove-layer', layerId: 'layer-1' } as DurableOperation,
    ]);

    const result = await materializeLayer(layer, makeRequest(registry));

    expect(result.bounds).toEqual({ x: 0, y: 0, width: 10, height: 10 });
    result.lease.release();
    registry.shutdown();
  });

  it('aborts between operations when the signal fires mid-loop', async () => {
    const registry = new AssetRegistry();
    const controller = new AbortController();
    const processor = {
      kind: 'apply-raster-processor',
      layerId: 'layer-1',
      processorId: 'blur',
      version: 1,
      args: Object.freeze({ toolName: 'blur', radius: 2 }),
    } as const;
    vi.spyOn(toolProcessors.blur, 'imageProcessor').mockImplementation(() => () => {
      controller.abort();
      return [new RecordingOffscreenCanvas(10, 10) as unknown as BitmapSource];
    });
    const layer = makeLayer('layer-1', blankSource(10, 10), { x: 0, y: 0, width: 10, height: 10 }, [
      processor,
      processor,
    ]);

    await expect(materializeLayer(layer, makeRequest(registry, { signal: controller.signal }))).rejects.toMatchObject({
      name: 'AbortError',
    });
    registry.shutdown();
  });
});

describe('materialization ownership of borrowed rasters', () => {
  it('never closes a borrowed registry bitmap even when a processor returns its input unchanged', async () => {
    const registry = new AssetRegistry();
    const { bitmap, close } = makeOwnedBitmap(20, 20);
    const assetId = registry.registerBaseline('test-doc', bitmap, { ownership: 'borrow' });
    const layer = makeLayer('layer-1', rasterSource(assetId, 20, 20), { x: 0, y: 0, width: 20, height: 20 }, [
      {
        kind: 'apply-raster-processor',
        layerId: 'layer-1',
        processorId: 'reposition',
        version: 1,
        args: Object.freeze({ toolName: 'reposition', move: { x: 5, y: 6 } }),
      },
    ]);

    const result = await materializeLayer(layer, makeRequest(registry));

    expect(result.bounds).toEqual({ x: 5, y: 6, width: 20, height: 20 });
    // The borrowed bitmap belongs to the legacy runtime layer.
    expect(close).not.toHaveBeenCalled();
    result.lease.release();
    registry.shutdown();
    // A borrowed registration is never adopted, so shutdown still does not close it.
    expect(close).not.toHaveBeenCalled();
  });

  it('releases the borrowed source as soon as the producer finishes so the adopted baseline is freed with its scope', async () => {
    const registry = new AssetRegistry();
    const { bitmap, close } = makeOwnedBitmap(20, 20);
    const assetId = registry.registerBaseline('test-doc', bitmap, { ownership: 'adopt' });
    const layer = makeLayer('layer-1', rasterSource(assetId, 20, 20), { x: 0, y: 0, width: 20, height: 20 });

    const result = await materializeLayer(layer, makeRequest(registry));
    // Materialization borrows the baseline only for the duration of the
    // producer, so the runtime layer keeps sole ownership afterwards.
    expect(close).not.toHaveBeenCalled();

    registry.disposeDocument('test-doc');
    expect(close).toHaveBeenCalledTimes(1);

    // Document scope disposal is idempotent: shutdown must not close twice.
    registry.shutdown();
    expect(close).toHaveBeenCalledTimes(1);
    result.lease.release();
  });
});

describe('materialization document frame presentation', () => {
  it('frames the presentation into the requested document frame bounds', async () => {
    const registry = new AssetRegistry();
    const frame: DocumentFrame = { x: 40, y: 25, width: 200, height: 120 };
    const layer = makeLayer('layer-1', blankSource(30, 20), { x: 60, y: 45, width: 30, height: 20 });

    const result = await materializeLayer(layer, makeRequest(registry, { frame }));

    expect(result.bounds).toEqual({ x: 40, y: 25, width: 200, height: 120 });
    const framed = recordedContexts.at(-1);
    expect(framed?.drawImage).toHaveBeenCalledWith(expect.anything(), 20, 20, 30, 20);
    result.lease.release();
    registry.shutdown();
  });

  it('closes the intermediate presentation bitmap once it has been framed', async () => {
    const registry = new AssetRegistry();
    const frame: DocumentFrame = { x: 0, y: 0, width: 50, height: 50 };
    const layer = makeLayer('layer-1', blankSource(30, 20), { x: 0, y: 0, width: 30, height: 20 });

    const result = await materializeLayer(layer, makeRequest(registry, { frame }));

    // One bitmap for the presentation surface, one for the frame surface. The
    // presentation is closed immediately; the framed bitmap is cache owned.
    expect(recordedBitmaps).toHaveLength(2);
    expect(recordedBitmaps[0].close).toHaveBeenCalledTimes(1);
    expect(recordedBitmaps[1].close).not.toHaveBeenCalled();
    expect(result.bitmap).toBe(recordedBitmaps[1]);

    result.lease.release();
    registry.shutdown();
    expect(recordedBitmaps[1].close).toHaveBeenCalledTimes(1);
  });

  it('leaves the presentation bounds unframed when the request carries no frame', async () => {
    const registry = new AssetRegistry();
    const layer = makeLayer('layer-1', blankSource(30, 20), { x: 7, y: 9, width: 30, height: 20 }, [
      {
        kind: 'apply-affine-transform',
        layerId: 'layer-1',
        transform: Object.freeze({ a: 2, b: 0, c: 0, d: 2, e: 5, f: 5 }),
      },
    ]);

    const result = await materializeLayer(layer, makeRequest(registry));

    expect(result.bounds).toEqual({ x: 12, y: 14, width: 60, height: 40 });
    result.lease.release();
    registry.shutdown();
  });
});

describe('staging before publication', () => {
  it('does not publish a partially materialized document when a later layer fails', async () => {
    const registry = new AssetRegistry();
    const good = makeLayer('layer-good', blankSource(20, 20), { x: 0, y: 0, width: 20, height: 20 });
    const bad = makeLayer('layer-bad', rasterSource('missing' as AssetId, 20, 20), {
      x: 0,
      y: 0,
      width: 20,
      height: 20,
    });
    const replay = makeReplay({ 'layer-good': good, 'layer-bad': bad });

    await expect(materializeDocument(replay, makeRequest(registry))).rejects.toThrow(/Unknown or disposed asset/);

    // Nothing is left leased, so a retry of the good layer re-runs its producer
    // instead of being served a cache entry from the failed attempt.
    const producerRuns = vi.fn();
    const originalMaterialize = registry.materialize.bind(registry);
    vi.spyOn(registry, 'materialize').mockImplementation(async (input) => {
      producerRuns();
      return originalMaterialize(input);
    });
    const retry = await materializeLayer(good, makeRequest(registry));

    expect(producerRuns).toHaveBeenCalled();
    expect(retry.layerId).toBe('layer-good');
    retry.lease.release();
    registry.shutdown();
  });

  it('leaves an empty materialized layer set for a document with no layers', async () => {
    const registry = new AssetRegistry();

    const result = await materializeDocument(makeReplay({}), makeRequest(registry));

    expect(result.layers).toEqual({});
    expect(Object.isFrozen(result.layers)).toBe(true);
    result.release();
    registry.shutdown();
  });
});

describe('document asset scope disposal', () => {
  it('disposes every batched layer materialization after a committed document replacement', async () => {
    const registry = new AssetRegistry();
    const replay = makeReplay({
      'layer-a': makeLayer('layer-a', blankSource(20, 20), { x: 0, y: 0, width: 20, height: 20 }),
      'layer-b': makeLayer('layer-b', blankSource(20, 20), { x: 0, y: 0, width: 20, height: 20 }),
      'layer-c': makeLayer('layer-c', blankSource(20, 20), { x: 0, y: 0, width: 20, height: 20 }),
    });

    const first = await materializeDocument(replay, makeRequest(registry));
    const batched = Object.values(first.layers);
    expect(batched).toHaveLength(3);
    for (const layer of batched) expect(closeSpy(layer.bitmap)).toBeDefined();

    // A committed replacement disposes the document scope while the published
    // layers still hold their leases, so the bitmaps stay alive.
    registry.disposeDocument('test-doc');
    for (const layer of batched) {
      expect(closeSpy(layer.bitmap)).not.toHaveBeenCalled();
    }

    // Only once the published document releases them are they actually closed.
    first.release();
    for (const layer of batched) {
      expect(closeSpy(layer.bitmap)).toHaveBeenCalledTimes(1);
    }
    registry.shutdown();
  });

  it('retains leases across an ordinary edit while a later document scope disposal wins', async () => {
    const registry = new AssetRegistry();
    const layer = makeLayer('layer-a', blankSource(20, 20), { x: 0, y: 0, width: 20, height: 20 });
    const first = await materializeLayer(layer, makeRequest(registry));
    const firstBitmap = { close: closeSpy(first.bitmap) };

    // Ordinary edit: a second materialization of the same layer reuses the cache.
    const second = await materializeLayer(layer, makeRequest(registry));
    expect(second.bitmap).toBe(first.bitmap);
    firstBitmap.close.mockClear();

    // Document replacement: the scope is disposed but the live lease protects the bitmap.
    registry.disposeDocument('test-doc');
    expect(firstBitmap.close).not.toHaveBeenCalled();

    // The first publication releases; the second still pins the entry.
    first.lease.release();
    expect(firstBitmap.close).not.toHaveBeenCalled();

    second.lease.release();
    expect(firstBitmap.close).toHaveBeenCalledTimes(1);
    registry.shutdown();
  });

  it('rejects a new materialization for a cached key whose document scope was disposed', async () => {
    const registry = new AssetRegistry();
    const layer = makeLayer('layer-a', blankSource(20, 20), { x: 0, y: 0, width: 20, height: 20 });
    const first = await materializeLayer(layer, makeRequest(registry));
    const firstBitmap = { close: closeSpy(first.bitmap) };

    // The published lease keeps the cache entry alive, so the scope disposal
    // can only invalidate it — it cannot drop it.
    registry.disposeDocument('test-doc');
    expect(firstBitmap.close).not.toHaveBeenCalled();

    await expect(materializeLayer(layer, makeRequest(registry))).rejects.toMatchObject({ name: 'AbortError' });
    expect(firstBitmap.close).not.toHaveBeenCalled();

    first.lease.release();
    expect(firstBitmap.close).toHaveBeenCalledTimes(1);
    registry.shutdown();
  });
});
