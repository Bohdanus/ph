import { describe, expect, it, vi } from 'vitest';

import { DurableCompositionRefusal } from '../durable-compositor.ts';
import { documentFrameSize } from '../document-frame.ts';
import type { DocumentFrame } from '../document-frame.ts';
import { projectDurableRender } from '../durable-render-projection.ts';
import type { DurableReplayLayer, DurableReplayResult } from '../durable-replay.ts';
import type { DurableLayerSnapshot, DurableOperation } from '../history-model.ts';
import type { MaterializedLayer } from '../materialization.ts';
import type { BitmapSource, Pos } from '../general-types.ts';

const frame: DocumentFrame = { x: 2, y: 3, width: 120, height: 80 };

function snapshot(
  id: string,
  visible: boolean,
  order: number,
  pos: Pos = { x: 0, y: 0, width: 20, height: 10 }
): DurableLayerSnapshot {
  return Object.freeze({
    id,
    name: `name-${id}`,
    isBedrock: false,
    visible,
    opacity: 0.8,
    locked: false,
    blendMode: 'screen' as const,
    order,
    pos,
    source: Object.freeze({
      kind: 'blank' as const,
      color: '#fff',
      opacity: 1,
      size: { width: 20, height: 10 },
    }),
  });
}

function replayLayer(
  id: string,
  visible: boolean,
  order: number,
  operations: readonly DurableOperation[] = []
): DurableReplayLayer {
  return Object.freeze({
    snapshot: snapshot(id, visible, order),
    operations: Object.freeze([...operations]),
  });
}

function makeReplay(layers: Record<string, DurableReplayLayer>, cursor = 5): DurableReplayResult {
  return Object.freeze({
    documentId: 'test-doc',
    documentRevision: 42,
    branchRevision: 7,
    durableRevision: 99,
    cursor,
    frame,
    totalSize: documentFrameSize(frame),
    layers: Object.freeze(layers),
    selections: Object.freeze({ selections: Object.freeze([]), activeSelectionId: null }),
    activeLayerId: Object.keys(layers)[0] ?? null,
  });
}

function materializedFor(
  id: string,
  bounds: Pos,
  materialBitmap: BitmapSource = {} as BitmapSource
): MaterializedLayer {
  return Object.freeze({
    layerId: id,
    bitmap: materialBitmap,
    bounds,
    visible: true,
    opacity: 0.5,
    blendMode: 'multiply' as const,
    lease: Object.freeze({
      key: id,
      bitmap: materialBitmap,
      byteSize: 4,
      metadata: bounds,
      release: vi.fn(),
    }),
  });
}

describe('projectDurableRender', () => {
  it('produces a runtime layer for every replay snapshot, sourced from durable metadata', () => {
    // Materialized layers carry different bitmap/bounds/opacity/blendMode, but the
    // runtime layer must still take every non-pixel field from the durable snapshot.
    const replay = makeReplay({
      'layer-a': replayLayer('layer-a', true, 0),
      'layer-b': replayLayer('layer-b', false, 1),
      'layer-c': replayLayer('layer-c', true, 2),
    });
    const bitmapA = {} as BitmapSource;
    const bitmapC = {} as BitmapSource;
    const materialized = {
      'layer-a': materializedFor('layer-a', { x: 999, y: 999, width: 1, height: 1 }, bitmapA),
      'layer-c': materializedFor('layer-c', { x: 888, y: 0, width: 2, height: 2 }, bitmapC),
    };

    const result = projectDurableRender(replay, { status: 'durable', materializedLayers: materialized });

    expect(Object.keys(result.layers)).toEqual(['layer-a', 'layer-b', 'layer-c']);

    const layerA = result.layers['layer-a'];
    expect(layerA).toMatchObject({
      id: 'layer-a',
      name: 'name-layer-a',
      isBedrock: false,
      visible: true,
      opacity: 0.8,
      locked: false,
      blendMode: 'screen',
      order: 0,
      pos: { x: 0, y: 0, width: 20, height: 10 },
    });
    expect(layerA.bitmap).toBe(bitmapA);
    expect(layerA.presentationBounds).toEqual({ x: 999, y: 999, width: 1, height: 1 });

    const layerB = result.layers['layer-b'];
    expect(layerB).toMatchObject({ visible: false, opacity: 0.8, blendMode: 'screen' });
    expect(layerB.tmpCanvas).toBeNull();
    expect(layerB.presentationBounds).toBeNull();

    // Materialized values (opacity 0.5, blendMode 'multiply') must NOT leak in.
    expect(layerA.opacity).toBe(0.8);
    expect(layerA.blendMode).toBe('screen');
    expect(result.layers['layer-c'].opacity).toBe(0.8);
    expect(result.layers['layer-c'].blendMode).toBe('screen');
    expect(result.layers['layer-c'].bitmap).toBe(bitmapC);
  });

  it('borrows bitmap and presentationBounds from materialized layers for visible layers', () => {
    const replay = makeReplay({ 'visible-layer': replayLayer('visible-layer', true, 0) });
    const matBitmap = { width: 40 } as unknown as BitmapSource;
    const materialized = {
      'visible-layer': materializedFor('visible-layer', { x: 10, y: 12, width: 30, height: 18 }, matBitmap),
    };

    const result = projectDurableRender(replay, { status: 'durable', materializedLayers: materialized });

    expect(result.layers['visible-layer'].bitmap).toBe(matBitmap);
    expect(result.layers['visible-layer'].presentationBounds).toEqual({ x: 10, y: 12, width: 30, height: 18 });
  });

  it('leaves hidden layers without a tmpCanvas or presentation cache', () => {
    const replay = makeReplay({ 'hidden-layer': replayLayer('hidden-layer', false, 0) });

    const result = projectDurableRender(replay, { status: 'durable', materializedLayers: {} });

    expect(result.layers['hidden-layer'].tmpCanvas).toBeNull();
    expect(result.layers['hidden-layer'].presentationBounds).toBeNull();
  });

  it('always projects empty operations regardless of replay layer operations', () => {
    const filterOp: DurableOperation = Object.freeze({
      kind: 'apply-filter',
      layerId: 'layer-a',
      filter: Object.freeze({ toolName: 'blur', version: 1, args: Object.freeze({ radius: 3 }) }),
    });
    const affineOp: DurableOperation = Object.freeze({
      kind: 'apply-affine-transform',
      layerId: 'layer-a',
      transform: Object.freeze({ a: 1, b: 0, c: 0, d: 1, e: 5, f: 5 }),
    });
    const replay = makeReplay({
      'layer-a': replayLayer('layer-a', true, 0, [filterOp, affineOp]),
    });
    const materialized = {
      'layer-a': materializedFor('layer-a', { x: 0, y: 0, width: 20, height: 10 }),
    };

    const result = projectDurableRender(replay, { status: 'durable', materializedLayers: materialized });

    expect(result.layers['layer-a'].operations).toEqual([]);
  });

  it('copies status, identity, revisions, frame and cursor from replay and input', () => {
    const replay = makeReplay({ 'layer-a': replayLayer('layer-a', true, 0) }, 13);

    const result = projectDurableRender(replay, { status: 'legacy' });

    expect(result.status).toBe('legacy');
    expect(result.documentId).toBe('test-doc');
    expect(result.documentRevision).toBe(42);
    expect(result.branchRevision).toBe(7);
    expect(result.durableRevision).toBe(99);
    expect(result.historyCursor).toBe(13);
    expect(result.frame).toEqual(frame);
    expect(result.frame).not.toBe(frame);
  });

  it.each(['pending', 'legacy'] as const)('rejects materialized layers for non-durable status %s', (status) => {
    const replay = makeReplay({ 'layer-a': replayLayer('layer-a', true, 0) });
    const materialized = {
      'layer-a': materializedFor('layer-a', { x: 0, y: 0, width: 10, height: 10 }),
    };

    expect(() => projectDurableRender(replay, { status, materializedLayers: materialized })).toThrow(
      'Only a durable render projection may carry materialized layers'
    );
  });

  it('refuses when a visible layer has no materialized entry', () => {
    const replay = makeReplay({
      'layer-a': replayLayer('layer-a', true, 0),
      'layer-b': replayLayer('layer-b', true, 1),
    });
    const materialized = {
      'layer-a': materializedFor('layer-a', { x: 0, y: 0, width: 10, height: 10 }),
    };

    expect(() => projectDurableRender(replay, { status: 'durable', materializedLayers: materialized })).toThrow(
      DurableCompositionRefusal
    );
  });

  it('refuses when materialized layers include an unexpected hidden layer', () => {
    const replay = makeReplay({
      hidden: replayLayer('hidden', false, 0),
      visible: replayLayer('visible', true, 1),
    });
    const materialized = {
      hidden: materializedFor('hidden', { x: 0, y: 0, width: 10, height: 10 }),
      visible: materializedFor('visible', { x: 0, y: 0, width: 10, height: 10 }),
    };

    expect(() => projectDurableRender(replay, { status: 'durable', materializedLayers: materialized })).toThrow(
      DurableCompositionRefusal
    );
  });
});
