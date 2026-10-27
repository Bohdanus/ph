import { describe, expect, it } from 'vitest';

import { DurableCompositionRefusal, requireVisibleLayerCoverage } from '../durable-compositor.ts';
import type { DurableReplayLayer, DurableReplayResult } from '../durable-replay.ts';
import type { DurableLayerSnapshot, DurableLayerSource } from '../history-model.ts';
import type { MaterializedLayer } from '../materialization.ts';

const frame = { x: 0, y: 0, width: 120, height: 80 };

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
  return Object.freeze({ snapshot, operations: Object.freeze([]) });
}

function replay(layers: Record<string, DurableReplayLayer>): DurableReplayResult {
  return Object.freeze({
    documentId: 'test-document',
    documentRevision: 1,
    branchRevision: 0,
    durableRevision: 1,
    cursor: 0,
    frame,
    totalSize: { width: frame.width, height: frame.height },
    layers: Object.freeze(layers),
    selections: Object.freeze({ selections: Object.freeze([]), activeSelectionId: null }),
    activeLayerId: Object.keys(layers)[0] ?? null,
  });
}

function materializedLayer(
  layerId: string,
  options: Readonly<{
    visible?: boolean;
    opacity?: number;
    blendMode?: GlobalCompositeOperation;
    bounds?: { x: number; y: number; width: number; height: number };
  }> = {}
): MaterializedLayer {
  return Object.freeze({
    layerId,
    bitmap: null as unknown as import('../general-types.ts').BitmapSource,
    bounds: options.bounds ?? { x: 0, y: 0, width: 20, height: 20 },
    visible: options.visible ?? true,
    opacity: options.opacity ?? 1,
    blendMode: options.blendMode ?? 'source-over',
    lease: Object.freeze({ release: () => {} }) as import('../asset-registry.ts').MaterializationLease<
      import('../general-types.ts').Pos
    >,
  });
}

describe('requireVisibleLayerCoverage contract', () => {
  it('passes when all visible layers are materialized and no hidden layers are materialized', () => {
    const replayResult = replay({
      'layer-1': layer('layer-1', 0, { visible: true }),
      'layer-2': layer('layer-2', 1, { visible: true }),
      'layer-3': layer('layer-3', 2, { visible: false }),
    });

    const materialized = {
      'layer-1': materializedLayer('layer-1'),
      'layer-2': materializedLayer('layer-2'),
    };

    expect(() => requireVisibleLayerCoverage(replayResult, materialized)).not.toThrow();
  });

  it('throws DurableCompositionRefusal with code materialization-refused and missing IDs when a visible layer is missing', () => {
    const replayResult = replay({
      'layer-1': layer('layer-1', 0, { visible: true }),
      'layer-2': layer('layer-2', 1, { visible: true }),
      'layer-3': layer('layer-3', 2, { visible: false }),
    });

    const materialized = {
      'layer-1': materializedLayer('layer-1'),
      // layer-2 is missing
    };

    let error: unknown;
    try {
      requireVisibleLayerCoverage(replayResult, materialized);
    } catch (thrown) {
      error = thrown;
    }

    expect(error).toBeInstanceOf(DurableCompositionRefusal);
    const refusal = error as DurableCompositionRefusal;
    expect(refusal.code).toBe('materialization-refused');
    expect(refusal.missingLayerIds).toEqual(['layer-2']);
    expect(refusal.unexpectedLayerIds).toEqual([]);
  });

  it('throws DurableCompositionRefusal with code layer-coverage and unexpected IDs when a hidden layer is materialized', () => {
    const replayResult = replay({
      'layer-1': layer('layer-1', 0, { visible: true }),
      'layer-2': layer('layer-2', 1, { visible: false }),
    });

    const materialized = {
      'layer-1': materializedLayer('layer-1'),
      'layer-2': materializedLayer('layer-2'), // hidden layer unexpectedly materialized
    };

    let error: unknown;
    try {
      requireVisibleLayerCoverage(replayResult, materialized);
    } catch (thrown) {
      error = thrown;
    }

    expect(error).toBeInstanceOf(DurableCompositionRefusal);
    const refusal = error as DurableCompositionRefusal;
    expect(refusal.code).toBe('layer-coverage');
    expect(refusal.missingLayerIds).toEqual([]);
    expect(refusal.unexpectedLayerIds).toEqual(['layer-2']);
  });

  it('throws DurableCompositionRefusal with code materialization-refused and both missing and unexpected IDs when both conditions occur', () => {
    const replayResult = replay({
      'layer-1': layer('layer-1', 0, { visible: true }),
      'layer-2': layer('layer-2', 1, { visible: true }),
      'layer-3': layer('layer-3', 2, { visible: false }),
    });

    const materialized = {
      'layer-1': materializedLayer('layer-1'),
      'layer-3': materializedLayer('layer-3'), // hidden layer unexpectedly materialized
      // layer-2 is missing
    };

    let error: unknown;
    try {
      requireVisibleLayerCoverage(replayResult, materialized);
    } catch (thrown) {
      error = thrown;
    }

    expect(error).toBeInstanceOf(DurableCompositionRefusal);
    const refusal = error as DurableCompositionRefusal;
    expect(refusal.code).toBe('materialization-refused'); // missing takes precedence
    expect(refusal.missingLayerIds).toEqual(['layer-2']);
    expect(refusal.unexpectedLayerIds).toEqual(['layer-3']);
  });

  it('does not mutate the input replay or materialized records when throwing', () => {
    const replayResult = replay({
      'layer-1': layer('layer-1', 0, { visible: true }),
      'layer-2': layer('layer-2', 1, { visible: false }),
    });

    const materialized = {
      'layer-1': materializedLayer('layer-1'),
      'layer-2': materializedLayer('layer-2'),
    };

    const replaySnapshot = JSON.stringify(replayResult);
    const materializedSnapshot = JSON.stringify(Object.keys(materialized));

    try {
      requireVisibleLayerCoverage(replayResult, materialized);
    } catch {
      // Expected to throw
    }

    expect(JSON.stringify(replayResult)).toBe(replaySnapshot);
    expect(JSON.stringify(Object.keys(materialized))).toBe(materializedSnapshot);
  });

  it('does not mutate the input replay or materialized records when passing', () => {
    const replayResult = replay({
      'layer-1': layer('layer-1', 0, { visible: true }),
      'layer-2': layer('layer-2', 1, { visible: false }),
    });

    const materialized = {
      'layer-1': materializedLayer('layer-1'),
    };

    const replaySnapshot = JSON.stringify(replayResult);
    const materializedSnapshot = JSON.stringify(Object.keys(materialized));

    requireVisibleLayerCoverage(replayResult, materialized);

    expect(JSON.stringify(replayResult)).toBe(replaySnapshot);
    expect(JSON.stringify(Object.keys(materialized))).toBe(materializedSnapshot);
  });
});
