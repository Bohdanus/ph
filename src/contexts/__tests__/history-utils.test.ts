import { describe, expect, it } from 'vitest';

import { clonePlainData, createHistoryItem } from '../history-utils.ts';
import { toLayerSnapshot, type AssetId, type DurableLayerSource } from '../history-model.ts';
import type { Layer, LayerSource } from '../layer-types.ts';
import { MERGE_ACTION, NEW_LAYER_ACTION, TOOL_ACTION } from '../../util/constants.ts';

const pos = { x: 3, y: 4, width: 40, height: 20 };
const frame = { x: 5, y: 6, width: 200, height: 160 };

function fakeBitmap(width: number, height: number) {
  return { width, height, close: () => undefined } as unknown as ImageBitmap;
}

function runtimeLayer(overrides: Partial<Layer> = {}): Layer {
  return {
    id: 'layer-1',
    name: 'Layer 1',
    isBedrock: false,
    visible: true,
    opacity: 1,
    locked: false,
    blendMode: 'source-over',
    order: 2,
    pos: { ...pos },
    bitmap: null,
    tmpCanvas: null,
    operations: [],
    ...overrides,
  };
}

describe('clonePlainData', () => {
  it('deep clones nested plain objects and arrays and drops the prototype', () => {
    const args = {
      toolName: 'shape',
      lineDash: [2, 4],
      start: { x: 1, y: 2 },
      nested: { list: [{ deep: true }] },
    };

    const clone = clonePlainData(args);
    args.lineDash[0] = 99;
    args.start.x = 99;
    args.nested.list[0].deep = false;

    expect(clone).toEqual({
      toolName: 'shape',
      lineDash: [2, 4],
      start: { x: 1, y: 2 },
      nested: { list: [{ deep: true }] },
    });
    expect(Object.getPrototypeOf(clone)).toBe(Object.prototype);
  });

  it('returns non-plain values by reference instead of faking a clone', () => {
    class FakeBitmap {
      width = 4;
      height = 4;
    }
    const bitmap = new FakeBitmap();

    expect(clonePlainData(bitmap)).toBe(bitmap);
    expect(clonePlainData(new Date(0))).toBeInstanceOf(Date);
    expect(clonePlainData(null)).toBeNull();
    expect(clonePlainData(7)).toBe(7);
    expect(clonePlainData('text')).toBe('text');
    expect(clonePlainData(undefined)).toBeUndefined();
  });
});

describe('createHistoryItem layer sources', () => {
  it('clones a blank layer source, keeping colour and opacity but dropping the runtime pos', () => {
    const source: LayerSource = { kind: 'blank', color: '#ff8800', opacity: 0.4, isBedrock: false, pos: { ...pos } };

    const item = createHistoryItem({ actionName: NEW_LAYER_ACTION, layerId: 'layer-1', layerSource: source }, 'blank');

    expect(item.layerSource).toStrictEqual({
      kind: 'blank',
      color: '#ff8800',
      opacity: 0.4,
      isBedrock: false,
      pos: { ...pos },
    });
    expect(item.layerSource).not.toBe(source);
    if (item.layerSource?.kind !== 'blank' || 'pos' in item.layerSource === false) {
      throw new Error('expected a positioned blank source');
    }
    expect(item.layerSource.pos).not.toBe(source.pos);
  });

  it('clones a bedrock image layer source by size and keeps the borrowed bitmap identity', () => {
    const bitmap = fakeBitmap(40, 20);
    const source: LayerSource = { kind: 'image', bitmap, name: 'Photo', isBedrock: true, size: { ...pos } };

    const item = createHistoryItem({ actionName: NEW_LAYER_ACTION, layerId: 'layer-1', layerSource: source }, 'image');

    expect(item.layerSource).toStrictEqual({ kind: 'image', bitmap, name: 'Photo', isBedrock: true, size: { ...pos } });
    if (item.layerSource?.kind !== 'image' || !('size' in item.layerSource)) {
      throw new Error('expected a bedrock image source');
    }
    expect(item.layerSource.bitmap).toBe(bitmap);
    expect(Object.isFrozen(item.layerSource)).toBe(true);
    expect(Object.isFrozen(item.layerSource.size)).toBe(true);
  });

  it('omits an absent image name and clones tool layer source arguments', () => {
    const source: LayerSource = {
      kind: 'tool',
      args: {
        toolName: 'shape',
        figure: 'polygon',
        alpha: 1,
        color: '#000000',
        backgroundColor: null,
        lineWidth: 1,
        toolMode: 'shape',
        start: { x: 0, y: 0 },
        end: { x: 4, y: 4 },
      },
      isBedrock: false,
      pos: { ...pos },
    };

    const item = createHistoryItem({ actionName: MERGE_ACTION, layerId: 'layer-1', layerSource: source }, 'tool');

    expect(item.layerSource).toStrictEqual(source);
    if (item.layerSource?.kind !== 'tool') throw new Error('expected a tool source');
    expect(item.layerSource.args).not.toBe(source.args);
    expect(Object.isFrozen(item.layerSource.args)).toBe(true);
  });

  it('routes arguments that describe a layer source through the layer-source cloner', () => {
    const args: LayerSource = { kind: 'blank', color: '#123456', opacity: 0.5, isBedrock: false, pos: { ...pos } };

    const item = createHistoryItem({ actionName: TOOL_ACTION, layerId: 'layer-1', args }, 'source-args');

    // The legacy shape stores the source in `args`; it must be normalized to a
    // layer source instead of being frozen as a bare argument object.
    expect(item.args).toStrictEqual({
      kind: 'blank',
      color: '#123456',
      opacity: 0.5,
      isBedrock: false,
      pos: { ...pos },
    });
    expect(item.args).not.toBe(args);
  });

  it('keeps an unknown layer source kind out of the source-argument rewrite', () => {
    const item = createHistoryItem(
      { actionName: TOOL_ACTION, layerId: 'layer-1', args: { kind: 'not-a-source', value: 1 } },
      'unknown-kind'
    );

    expect(item.args).toStrictEqual({ kind: 'not-a-source', value: 1 });
  });
});

describe('createHistoryItem document sources', () => {
  it('clones every layer, its position, its source and its operations', () => {
    const bitmap = fakeBitmap(40, 20);
    const layer = runtimeLayer({
      bitmap,
      source: { kind: 'image', bitmap, name: 'Photo', isBedrock: false, pos: { ...pos } },
      operations: [
        { id: 'op-affine', kind: 'affine-transform', transform: { a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 }, enabled: true },
        { id: 'op-filter', args: { toolName: 'blur', radius: 4 }, enabled: true },
      ],
    });

    const documentSource = {
      layers: { 'layer-1': layer },
      size: { width: 400, height: 300 },
      frame: { x: 1, y: 2, width: 400, height: 300 },
    };
    const item = createHistoryItem({ actionName: NEW_LAYER_ACTION, layerId: 'layer-1', documentSource }, 'document');

    const stored = item.documentSource;
    if (!stored) throw new Error('expected a document source');
    expect(stored.size).not.toBe(documentSource.size);
    expect(stored.frame).not.toBe(documentSource.frame);
    expect(stored.layers).not.toBe(documentSource.layers);
    expect(stored.frame).toEqual({ x: 1, y: 2, width: 400, height: 300 });
    const storedLayer = stored.layers['layer-1'];
    expect(storedLayer).not.toBe(layer);
    expect(storedLayer.pos).not.toBe(layer.pos);
    expect(storedLayer.bitmap).toBe(bitmap);
    const [affineOperation, filterOperation] = storedLayer.operations;
    const [inputAffine, inputFilter] = layer.operations;
    if (affineOperation.kind !== 'affine-transform' || inputAffine.kind !== 'affine-transform') {
      throw new Error('expected an affine operation');
    }
    if (filterOperation.kind === 'affine-transform' || inputFilter.kind === 'affine-transform') {
      throw new Error('expected a filter operation');
    }
    expect(affineOperation.transform).toEqual(inputAffine.transform);
    expect(affineOperation.transform).not.toBe(inputAffine.transform);
    expect(filterOperation.args).toEqual({ toolName: 'blur', radius: 4 });
    expect(filterOperation.args).not.toBe(inputFilter.args);
  });

  it('omits the frame when the legacy document source has none', () => {
    const item = createHistoryItem(
      {
        actionName: NEW_LAYER_ACTION,
        layerId: 'layer-1',
        documentSource: { layers: { 'layer-1': runtimeLayer() }, size: { width: 10, height: 10 } },
      },
      'frameless'
    );

    expect(item.documentSource).not.toHaveProperty('frame');
  });

  it('leaves args and sources out of the item when they were not provided', () => {
    const item = createHistoryItem({ actionName: NEW_LAYER_ACTION, layerId: 'layer-1' }, 'bare');

    expect(item).toStrictEqual({ id: 'bare', actionName: NEW_LAYER_ACTION, layerId: 'layer-1' });
  });

  it('freezes the item but not a layer temporary canvas, so a replay can keep drawing into it', () => {
    // `history-utils.ts:104-106` adds every `bitmap` and `tmpCanvas` to the
    // skip set, so `freezePlainData` returns early for them. Freezing a live
    // OffscreenCanvas-backed scratch surface would make the next raster tool
    // write fail, so the skip is load-bearing rather than cosmetic.
    const bitmap = fakeBitmap(40, 20);
    const tmpCanvas = { width: 40, height: 20 } as unknown as OffscreenCanvas;
    const documentSource = {
      layers: { 'layer-1': runtimeLayer({ bitmap, tmpCanvas }) },
      size: { width: 40, height: 20 },
    };

    const item = createHistoryItem({ actionName: NEW_LAYER_ACTION, layerId: 'layer-1', documentSource }, 'scratch');

    const stored = item.documentSource;
    if (!stored) throw new Error('expected a document source');
    const storedLayer = stored.layers['layer-1'];
    expect(storedLayer.bitmap).toBe(bitmap);
    expect(storedLayer.tmpCanvas).toBe(tmpCanvas);
    // The record itself is frozen ...
    expect(Object.isFrozen(item)).toBe(true);
    expect(Object.isFrozen(storedLayer.pos)).toBe(true);
    // ... while the mutable scratch surfaces are not.
    expect(Object.isFrozen(bitmap)).toBe(false);
    expect(Object.isFrozen(tmpCanvas)).toBe(false);
  });

  it('freezes plain data but leaves a non-plain object carried in args unfrozen and uncloned', () => {
    // `history-utils.ts:76` bails out of `freezePlainData` for anything that is
    // not a plain object, and `clonePlainData` returns such values by reference,
    // so a Date/Map in a tool payload survives the round trip by identity.
    const stamp = new Date(0);
    const tags = new Map([['kind', 'shape']]);

    const item = createHistoryItem(
      { actionName: TOOL_ACTION, layerId: 'layer-1', args: { toolName: 'shape', stamp, tags, lineWidth: 3 } },
      'non-plain-args'
    );

    const stored = item.args as { stamp: Date; tags: Map<string, string>; lineWidth: number };
    expect(stored.stamp).toBe(stamp);
    expect(stored.tags).toBe(tags);
    expect(stored.lineWidth).toBe(3);
    expect(Object.isFrozen(item)).toBe(true);
    expect(Object.isFrozen(stored.stamp)).toBe(false);
  });

  it('freezes an array argument and every object inside it', () => {
    const item = createHistoryItem(
      { actionName: TOOL_ACTION, layerId: 'layer-1', args: { lineDash: [2, 4], stops: [{ at: 0 }, { at: 1 }] } },
      'array-args'
    );

    const stored = item.args as { lineDash: number[]; stops: { at: number }[] };
    expect(Object.isFrozen(stored.lineDash)).toBe(true);
    expect(Object.isFrozen(stored.stops)).toBe(true);
    expect(Object.isFrozen(stored.stops[0])).toBe(true);
  });
});

/**
 * `history-utils.ts:57` (`if (!args) return args;` inside the module-private
 * `cloneArgs`) and `history-utils.ts:99` (`if (import.meta.env.DEV)`) are
 * unreachable branches, not missing tests:
 *
 *  - `cloneArgs` is not exported, and its only call site
 *    (`history-utils.ts:96`) is guarded by `...(input.args ? { args: cloneArgs(input.args) } : {})`,
 *    so `cloneArgs` can never observe a falsy argument. The guard is dead code.
 *  - `import.meta.env.DEV` is substituted by Vite at transform time, so the
 *    `import.meta.env.DEV === false` side has no production producer either;
 *    the DEV-only resource-skip bookkeeping at `:100-108` is always active under
 *    the test runner, which is what lets `createHistoryItem` be asserted frozen.
 *
 * Both are reported rather than papered over; neither can be closed from a test
 * without a production change.
 */

/**
 * The `toLayerSnapshot` geometry argument: a runtime layer plus the one field a
 * `Layer` does not carry and a snapshot must — the document frame its geometry was
 * taken against.
 */
function snapshotLayer(overrides: Partial<Layer> = {}): Layer & { frame: typeof frame } {
  return { ...runtimeLayer(overrides), frame: { ...frame } };
}

describe('toLayerSnapshot source cloning', () => {
  it('clones vector and text source arguments, size and source position', () => {
    const vector: DurableLayerSource = {
      kind: 'vector',
      toolName: 'ellipse',
      args: { color: '#ff0000', dash: [4, 2] },
      size: { width: 40, height: 20 },
      sourcePos: { ...pos },
      isBedrock: false,
    };
    const text: DurableLayerSource = {
      kind: 'text',
      toolName: 'text',
      args: { text: 'hello' },
      size: { width: 40, height: 20 },
      sourcePos: { ...pos },
    };

    const vectorSnapshot = toLayerSnapshot(snapshotLayer(), vector);
    const textSnapshot = toLayerSnapshot(snapshotLayer(), text);

    expect(vectorSnapshot.source).toStrictEqual(vector);
    if (vectorSnapshot.source.kind !== 'vector' || textSnapshot.source.kind !== 'text') {
      throw new Error('unexpected source kinds');
    }
    expect(vectorSnapshot.source.args).not.toBe(vector.args);
    expect(vectorSnapshot.source.sourcePos).not.toBe(vector.sourcePos);
    expect(textSnapshot.source.args).not.toBe(text.args);
    expect(textSnapshot.source.sourcePos).not.toBe(text.sourcePos);
    expect(Object.isFrozen(vectorSnapshot.source.args)).toBe(true);
  });

  it('clones a legacy-tool source without inventing a source position', () => {
    const legacy: DurableLayerSource = {
      kind: 'legacy-tool',
      toolName: 'shape',
      args: { figure: 'polygon' },
      size: { width: 40, height: 20 },
      isBedrock: true,
    };

    const snapshot = toLayerSnapshot(snapshotLayer(), legacy);

    expect(snapshot.source).toStrictEqual(legacy);
    expect(snapshot.source).not.toHaveProperty('sourcePos');
    if (snapshot.source.kind !== 'legacy-tool') throw new Error('unexpected source kind');
    expect(snapshot.source.args).not.toBe(legacy.args);
  });

  it('keeps a raster asset id by value and a blank source size by copy', () => {
    const raster = toLayerSnapshot(snapshotLayer(), {
      kind: 'raster',
      assetId: 'asset-1' as AssetId,
      width: 40,
      height: 20,
      name: 'Raster',
    });
    const blank = toLayerSnapshot(snapshotLayer(), {
      kind: 'blank',
      color: '#ffffff',
      opacity: 1,
      size: { width: 40, height: 20 },
    });

    if (raster.source.kind !== 'raster' || blank.source.kind !== 'blank') throw new Error('unexpected kinds');
    expect(raster.source.assetId).toBe('asset-1');
    expect(blank.source.size).not.toBe(pos);
  });

  it('copies and freezes the frame a snapshot was taken against', () => {
    const snapshot = toLayerSnapshot(snapshotLayer(), {
      kind: 'blank',
      color: '#ffffff',
      opacity: 1,
      size: { width: 40, height: 20 },
    });

    // By value first: a snapshot that restated what frame it was captured against
    // would make every later replay decision unfalsifiable, and the live frame is
    // a mutable store field the snapshot must not alias.
    expect(snapshot.frame).toStrictEqual(frame);
    expect(snapshot.frame).not.toBe(frame);
    expect(Object.isFrozen(snapshot.frame)).toBe(true);
  });
});
