import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getSortedLayersArray,
  layersArrayToRecord,
  minLayerOrder,
  maxLayerOrder,
  getLayerIdByPoint,
  reorderLayers,
  saveLayerCanvas,
} from '../layer-utils.ts';
import type { Layer, LayersRecord } from '../layer-types.ts';
import type { BitmapSource } from '../general-types.ts';

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

describe('saveLayerCanvas', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function makeBitmap(overrides: Partial<ImageBitmap> = {}): ImageBitmap {
    return { width: 20, height: 10, close: vi.fn(), ...overrides } as unknown as ImageBitmap;
  }

  it('returns undefined and never materializes a layer without a staged canvas', () => {
    const createImageBitmapStub = vi.fn();
    vi.stubGlobal('createImageBitmap', createImageBitmapStub);
    const layer = makeLayer({ id: 'a', order: 1, tmpCanvas: null });

    expect(saveLayerCanvas(layer)).toBeUndefined();
    expect(createImageBitmapStub).not.toHaveBeenCalled();
    expect(layer.bitmap).toBeNull();
  });

  it('adopts the resolved bitmap and clears the staged canvas on success', async () => {
    const canvas = new OffscreenCanvas(20, 10) as unknown as BitmapSource;
    const bitmap = makeBitmap();
    const createImageBitmapStub = vi.fn(async () => bitmap);
    vi.stubGlobal('createImageBitmap', createImageBitmapStub);
    const layer = makeLayer({ id: 'a', order: 1, tmpCanvas: canvas });

    await expect(saveLayerCanvas(layer)).resolves.toBe(bitmap);
    expect(createImageBitmapStub).toHaveBeenCalledWith(canvas);
    expect(layer.bitmap).toBe(bitmap);
    expect(layer.tmpCanvas).toBeNull();
  });

  it('closes the stale bitmap and keeps the newer preview when the staged canvas was replaced', async () => {
    const staged = new OffscreenCanvas(20, 10) as unknown as BitmapSource;
    const newer = new OffscreenCanvas(30, 15) as unknown as BitmapSource;
    const previousBitmap = makeBitmap({ width: 4, height: 4 });
    let resolveBitmap: (bitmap: ImageBitmap) => void = () => undefined;
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(
        () =>
          new Promise<ImageBitmap>((resolve) => {
            resolveBitmap = resolve;
          })
      )
    );
    const layer = makeLayer({ id: 'a', order: 1, tmpCanvas: staged, bitmap: previousBitmap });

    const pending = saveLayerCanvas(layer);
    layer.tmpCanvas = newer;
    const materialized = makeBitmap();
    resolveBitmap(materialized);

    await expect(pending).resolves.toBeUndefined();
    expect(materialized.close).toHaveBeenCalledTimes(1);
    expect(layer.bitmap).toBe(previousBitmap);
    expect(layer.tmpCanvas).toBe(newer);
  });

  it('resolves undefined and keeps the staged canvas when materialization rejects', async () => {
    const canvas = new OffscreenCanvas(20, 10) as unknown as BitmapSource;
    const failure = new Error('bitmap materialization failed');
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => {
        throw failure;
      })
    );
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const layer = makeLayer({ id: 'a', order: 1, tmpCanvas: canvas, bitmap: null });

    await expect(saveLayerCanvas(layer)).resolves.toBeUndefined();
    expect(consoleError).toHaveBeenCalledWith('Unable to materialize layer presentation cache', failure);
    expect(layer.bitmap).toBeNull();
    expect(layer.tmpCanvas).toBe(canvas);
  });

  it('swallows a failure raised while adopting the bitmap and keeps the staged canvas', async () => {
    const canvas = new OffscreenCanvas(20, 10) as unknown as BitmapSource;
    const bitmap = makeBitmap();
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => bitmap)
    );
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const layer = makeLayer({ id: 'a', order: 1, tmpCanvas: canvas });
    const failure = new Error('adoption failed');
    Object.defineProperty(layer, 'bitmap', {
      configurable: true,
      get: () => null,
      set: () => {
        throw failure;
      },
    });

    await expect(saveLayerCanvas(layer)).resolves.toBeUndefined();
    expect(consoleError).toHaveBeenCalledWith('Unable to materialize layer presentation cache', failure);
    expect(layer.tmpCanvas).toBe(canvas);
  });
});
