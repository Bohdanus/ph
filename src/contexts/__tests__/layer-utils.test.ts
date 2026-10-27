import { describe, expect, it } from 'vitest';
import {
  getSortedLayersArray,
  layersArrayToRecord,
  minLayerOrder,
  maxLayerOrder,
  getLayerIdByPoint,
  reorderLayers,
} from '../layer-utils.ts';
import type { Layer, LayersRecord } from '../layer-types.ts';

function makeLayer(overrides: Partial<Layer> & { id: string; order: number }): Layer {
  return {
    name: overrides.id,
    isBedrock: false,
    tmpCanvas: null,
    bitmap: null,
    visible: true,
    opacity: 1,
    locked: false,
    blendMode: 'source-over',
    pos: { x: 0, y: 0, width: 100, height: 100 },
    presentationBounds: null,
    operations: [],
    ...overrides,
  };
}

describe('getSortedLayersArray', () => {
  it('returns layers sorted by order ascending', () => {
    const layers: LayersRecord = {
      a: makeLayer({ id: 'a', order: 3 }),
      b: makeLayer({ id: 'b', order: 1 }),
      c: makeLayer({ id: 'c', order: 2 }),
    };
    const result = getSortedLayersArray(layers);
    expect(result.map((l) => l.id)).toEqual(['b', 'c', 'a']);
  });

  it('returns an empty array for an empty record', () => {
    expect(getSortedLayersArray({})).toEqual([]);
  });

  it('handles a single layer', () => {
    const layers: LayersRecord = { a: makeLayer({ id: 'a', order: 5 }) };
    expect(getSortedLayersArray(layers).map((l) => l.id)).toEqual(['a']);
  });
});

describe('layersArrayToRecord', () => {
  it('converts an array into a record keyed by layer id', () => {
    const arr = [makeLayer({ id: 'x', order: 1 }), makeLayer({ id: 'y', order: 2 })];
    const record = layersArrayToRecord(arr);
    expect(Object.keys(record)).toEqual(['x', 'y']);
    expect(record.x.id).toBe('x');
    expect(record.y.id).toBe('y');
  });

  it('returns an empty record for an empty array', () => {
    expect(Object.keys(layersArrayToRecord([]))).toEqual([]);
  });
});

describe('minLayerOrder', () => {
  it('returns the smallest order value', () => {
    const layers: LayersRecord = {
      a: makeLayer({ id: 'a', order: 3 }),
      b: makeLayer({ id: 'b', order: 1 }),
      c: makeLayer({ id: 'c', order: 2 }),
    };
    expect(minLayerOrder(layers)).toBe(1);
  });

  it('returns 0 for an empty record', () => {
    expect(minLayerOrder({})).toBe(0);
  });

  it('returns the order for a single layer', () => {
    const layers: LayersRecord = { a: makeLayer({ id: 'a', order: 7 }) };
    expect(minLayerOrder(layers)).toBe(7);
  });
});

describe('maxLayerOrder', () => {
  it('returns the largest order value', () => {
    const layers: LayersRecord = {
      a: makeLayer({ id: 'a', order: 3 }),
      b: makeLayer({ id: 'b', order: 5 }),
      c: makeLayer({ id: 'c', order: 2 }),
    };
    expect(maxLayerOrder(layers)).toBe(5);
  });

  it('returns 0 for an empty record', () => {
    expect(maxLayerOrder({})).toBe(0);
  });
});

describe('getLayerIdByPoint', () => {
  it('returns the id of the topmost visible layer containing the point', () => {
    const layers: LayersRecord = {
      a: makeLayer({ id: 'a', order: 1, pos: { x: 0, y: 0, width: 50, height: 50 } }),
      b: makeLayer({ id: 'b', order: 2, pos: { x: 0, y: 0, width: 100, height: 100 } }),
    };
    expect(getLayerIdByPoint(layers, { x: 10, y: 10 })).toBe('b');
  });

  it('skips invisible layers', () => {
    const layers: LayersRecord = {
      a: makeLayer({ id: 'a', order: 2, visible: false, pos: { x: 0, y: 0, width: 100, height: 100 } }),
      b: makeLayer({ id: 'b', order: 1, pos: { x: 0, y: 0, width: 50, height: 50 } }),
    };
    expect(getLayerIdByPoint(layers, { x: 10, y: 10 })).toBe('b');
  });

  it('returns null when the point is outside all layers', () => {
    const layers: LayersRecord = {
      a: makeLayer({ id: 'a', order: 1, pos: { x: 0, y: 0, width: 10, height: 10 } }),
    };
    expect(getLayerIdByPoint(layers, { x: 50, y: 50 })).toBeNull();
  });

  it('returns null for an empty layers record', () => {
    expect(getLayerIdByPoint({}, { x: 0, y: 0 })).toBeNull();
  });

  it('includes boundary edges in the hit test', () => {
    const layers: LayersRecord = {
      a: makeLayer({ id: 'a', order: 1, pos: { x: 0, y: 0, width: 10, height: 10 } }),
    };
    expect(getLayerIdByPoint(layers, { x: 10, y: 10 })).toBe('a');
    expect(getLayerIdByPoint(layers, { x: 0, y: 0 })).toBe('a');
  });
});

describe('reorderLayers', () => {
  it('moves a layer to the bottom when afterWhichLayerId is not provided', () => {
    const layers: LayersRecord = {
      a: makeLayer({ id: 'a', order: 1 }),
      b: makeLayer({ id: 'b', order: 2 }),
      c: makeLayer({ id: 'c', order: 3 }),
    };
    reorderLayers({ layers, layerToMoveId: 'c' });
    expect(layers.c.order).toBe(0);
  });

  it('moves a layer after the specified layer, shifting layers above it', () => {
    const layers: LayersRecord = {
      a: makeLayer({ id: 'a', order: 1 }),
      b: makeLayer({ id: 'b', order: 2 }),
      c: makeLayer({ id: 'c', order: 3 }),
      d: makeLayer({ id: 'd', order: 4 }),
    };
    reorderLayers({ layers, layerToMoveId: 'a', afterWhichLayerId: 'b' });
    expect(layers.a.order).toBe(3);
    expect(layers.b.order).toBe(2);
    expect(layers.c.order).toBe(5);
    expect(layers.d.order).toBe(6);
  });

  it('moves a layer after the last layer without shifting when no layers are above', () => {
    const layers: LayersRecord = {
      a: makeLayer({ id: 'a', order: 1 }),
      b: makeLayer({ id: 'b', order: 2 }),
    };
    reorderLayers({ layers, layerToMoveId: 'a', afterWhichLayerId: 'b' });
    expect(layers.a.order).toBe(3);
    expect(layers.b.order).toBe(2);
  });

  it('leaves the sorted sequence unchanged for a self-anchored move, moving only the order value', () => {
    // `history-append.ts:204-213` refuses a self-anchored reorder on the claim that
    // `reorderLayers` anchors on the mover's own order, shifts everything above it,
    // and re-assigns the layer — so the resulting SEQUENCE is unchanged and only the
    // sparse order values move. It calls that "executed, not assumed". The converter
    // half is pinned in `history-append.reorder.test.ts`; this is the `reorderLayers`
    // half, which nothing was pinning.
    const layers: LayersRecord = {
      a: makeLayer({ id: 'a', order: 0 }),
      b: makeLayer({ id: 'b', order: 1 }),
      c: makeLayer({ id: 'c', order: 2 }),
    };

    reorderLayers({ layers, layerToMoveId: 'c', afterWhichLayerId: 'c' });

    // `c` is the anchor, so `targetOrder` is `c`'s own order (2). The shift loop
    // only moves layers strictly above it and there are none, so the only write is
    // the mover's own: `layer.order = targetOrder + 1` (`layer-utils.ts:288`).
    expect(layers.c.order).toBe(3);
    expect(layers.a.order).toBe(0);
    expect(layers.b.order).toBe(1);
    // The document still reads bottom-first as a, b, c — which is the half of the
    // claim the converter half disagrees with.
    expect(getSortedLayersArray(layers).map((layer) => layer.id)).toEqual(['a', 'b', 'c']);
  });

  it('does nothing when the layer to move does not exist', () => {
    const layers: LayersRecord = {
      a: makeLayer({ id: 'a', order: 1 }),
    };
    const original = { ...layers.a };
    reorderLayers({ layers, layerToMoveId: 'nonexistent' });
    expect(layers.a).toEqual(original);
  });

  it('does nothing when the target layer does not exist', () => {
    const layers: LayersRecord = {
      a: makeLayer({ id: 'a', order: 1 }),
    };
    const original = { ...layers.a };
    reorderLayers({ layers, layerToMoveId: 'a', afterWhichLayerId: 'nonexistent' });
    expect(layers.a).toEqual(original);
  });
});
