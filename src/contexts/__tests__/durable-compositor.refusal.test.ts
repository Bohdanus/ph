import { afterEach, describe, expect, it, vi } from 'vitest';

import { AssetRegistry } from '../asset-registry.ts';
import { composeDurableDocument } from '../durable-compositor.ts';
import { documentFrameSize, type DocumentFrame } from '../document-frame.ts';
import type { DurableReplayLayer, DurableReplayResult } from '../durable-replay.ts';
import type { DurableLayerSnapshot, DurableLayerSource, DurableOperation } from '../history-model.ts';
import { materializeDocument, type MaterializationRequest } from '../materialization.ts';
import { overrideCanvasFilterSupport } from '../../util/canvas-filter.ts';

const frame: DocumentFrame = { x: 0, y: 0, width: 120, height: 80 };

type RecordingContext = CanvasRenderingContext2D & {
  alphaValues: number[];
  compositeValues: GlobalCompositeOperation[];
};

const recordingContexts: RecordingContext[] = [];

class RecordingCanvas {
  readonly width: number;
  readonly height: number;
  private readonly context: RecordingContext;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    const alphaValues: number[] = [];
    const compositeValues: GlobalCompositeOperation[] = [];
    const state = {
      alpha: 1,
      composite: 'source-over' as GlobalCompositeOperation,
    };
    const context = {
      alphaValues,
      compositeValues,
      save: vi.fn(),
      restore: vi.fn(),
      drawImage: vi.fn(),
      fillRect: vi.fn(),
      clearRect: vi.fn(),
      translate: vi.fn(),
      transform: vi.fn(),
      filter: 'none',
    } as unknown as RecordingContext;
    Object.defineProperties(context, {
      globalAlpha: {
        get: () => state.alpha,
        set: (value: number) => {
          state.alpha = value;
          alphaValues.push(value);
        },
      },
      globalCompositeOperation: {
        get: () => state.composite,
        set: (value: GlobalCompositeOperation) => {
          state.composite = value;
          compositeValues.push(value);
        },
      },
    });
    this.context = context;
    recordingContexts.push(context);
  }

  getContext(): RecordingContext {
    return this.context;
  }
}

function source(width = 20, height = 20): DurableLayerSource {
  return Object.freeze({
    kind: 'blank' as const,
    color: '#ffffff',
    opacity: 1,
    size: { width, height },
    isBedrock: false,
  });
}

function layer(
  id: string,
  order: number,
  options: Readonly<{
    visible?: boolean;
    opacity?: number;
    blendMode?: GlobalCompositeOperation;
    operations?: readonly DurableOperation[];
    pos?: { x: number; y: number; width: number; height: number };
  }> = {}
): DurableReplayLayer {
  const pos = options.pos ?? { x: 0, y: 0, width: 20, height: 20 };
  const snapshot: DurableLayerSnapshot = Object.freeze({
    id,
    name: id,
    isBedrock: false,
    visible: options.visible ?? true,
    opacity: options.opacity ?? 1,
    locked: false,
    blendMode: options.blendMode ?? 'source-over',
    order,
    pos,
    source: source(pos.width, pos.height),
  });
  return Object.freeze({ snapshot, operations: Object.freeze(options.operations ?? []) });
}

function refusedFilter(layerId: string): DurableOperation {
  return Object.freeze({
    kind: 'apply-filter',
    layerId,
    filter: Object.freeze({ toolName: 'blur', version: 1, args: Object.freeze({ radius: 3 }) }),
  });
}

function replay(layers: Record<string, DurableReplayLayer>): DurableReplayResult {
  return Object.freeze({
    documentId: 'test-document',
    documentRevision: 1,
    branchRevision: 0,
    durableRevision: 1,
    cursor: 0,
    frame,
    totalSize: documentFrameSize(frame),
    layers: Object.freeze(layers),
    selections: Object.freeze({ selections: Object.freeze([]), activeSelectionId: null }),
    activeLayerId: Object.keys(layers)[0] ?? null,
  });
}

function request(registry: AssetRegistry): MaterializationRequest {
  return {
    documentId: 'test-document',
    baselineAssetGeneration: 0,
    operationSetRevision: 0,
    assetRegistry: registry,
  };
}

afterEach(() => {
  overrideCanvasFilterSupport(null);
  vi.unstubAllGlobals();
  recordingContexts.length = 0;
});

describe('durable document refusal and composition', () => {
  it('omits only a refused layer, logs its id and error, and releases successful leases', async () => {
    overrideCanvasFilterSupport(false);
    const registry = new AssetRegistry();
    const releaseSpies: ReturnType<typeof vi.fn>[] = [];
    const originalMaterialize = registry.materialize.bind(registry);
    vi.spyOn(registry, 'materialize').mockImplementation(async (input) => {
      const lease = await originalMaterialize(input);
      const release = vi.fn(lease.release);
      releaseSpies.push(release);
      return { ...lease, release };
    });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const layers = {
      'layer-good-a': layer('layer-good-a', 0),
      'layer-bad': layer('layer-bad', 1, { operations: [refusedFilter('layer-bad')] }),
      'layer-good-c': layer('layer-good-c', 2),
    };

    const result = await materializeDocument(replay(layers), request(registry));

    expect(Object.keys(result.layers)).toEqual(['layer-good-a', 'layer-good-c']);
    expect(consoleError).toHaveBeenCalledWith(
      'Unable to materialize durable layer layer-bad; skipping layer',
      expect.objectContaining({ message: expect.stringContaining('CanvasRenderingContext2D.filter') })
    );
    result.release();
    result.release();
    expect(releaseSpies).toHaveLength(2);
    for (const release of releaseSpies) expect(release).toHaveBeenCalledTimes(1);
    registry.shutdown();
  });

  it('composes successful layers in order while skipping refused and hidden layers', async () => {
    overrideCanvasFilterSupport(false);
    vi.stubGlobal('OffscreenCanvas', RecordingCanvas);
    vi.stubGlobal('createImageBitmap', undefined);
    const registry = new AssetRegistry();
    const result = await composeDurableDocument(
      replay({
        'layer-hidden': layer('layer-hidden', 0, { visible: false }),
        'layer-screen': layer('layer-screen', 1, {
          opacity: 0.75,
          blendMode: 'screen',
          pos: { x: 10, y: 12, width: 30, height: 18 },
        }),
        'layer-multiply': layer('layer-multiply', 2, { opacity: 0.5, blendMode: 'multiply' }),
        'layer-bad': layer('layer-bad', 3, { operations: [refusedFilter('layer-bad')] }),
      }),
      request(registry)
    );

    const output = recordingContexts.at(-1);
    expect(output).toBeDefined();
    expect(output?.drawImage).toHaveBeenCalledTimes(2);
    expect(output?.alphaValues).toEqual([0.75, 0.5]);
    expect(output?.compositeValues).toEqual(['screen', 'multiply']);
    expect(result.layers).toHaveProperty('layer-hidden');
    expect(result.layers).not.toHaveProperty('layer-bad');
    result.release();
    registry.shutdown();
  });
});
