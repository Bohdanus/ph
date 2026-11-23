import { v4 as uuidv4 } from 'uuid';

import type { Layer, LayerId, LayerOperation, LayerOperationArgs, LayerSource, LayersRecord } from './layer-types.ts';
import { type CreatorToolParams, findToolProcessor } from '../tools/toolProcessors.ts';
import { isPaintBlendMode } from '../tools/brush.ts';
import type { Point, Pos } from './general-types.ts';
import { ellipsify } from '../util/string.ts';
import type { AffineTransform } from './affine-transform.ts';
import { isPointInLayer } from './affine-transform.ts';
import type { ToolArgs } from './tool-types.ts';

/**
 * Converts a Record of layers into a sorted array ordered by layer order (ascending).
 * @param layersRecord - Record mapping layer IDs to Layer objects
 * @returns Array of layers sorted by order
 */
export function getSortedLayersArray(layersRecord: Record<LayerId, Layer>): Layer[] {
  return Object.values(layersRecord).sort((a, b) => a.order - b.order);
}

export function insertLayerRecordAfter(layers: LayersRecord, layer: Layer, afterLayerId?: LayerId): LayersRecord {
  const entries = Object.entries(layers).filter(([id]) => id !== layer.id);
  if (afterLayerId === undefined) return Object.fromEntries([...entries, [layer.id, layer]]);

  const anchorIndex = entries.findIndex(([id]) => id === afterLayerId);
  if (anchorIndex < 0) throw new Error(`Cannot insert a layer after missing layer "${afterLayerId}"`);
  entries.splice(anchorIndex + 1, 0, [layer.id, layer]);
  return Object.fromEntries(entries);
}

export function setLayerMapEntryAfter<T>(
  layers: Map<LayerId, T>,
  layerId: LayerId,
  layer: T,
  afterLayerId?: LayerId
): void {
  const entries = [...layers.entries()].filter(([id]) => id !== layerId);
  if (afterLayerId === undefined) {
    layers.set(layerId, layer);
    return;
  }

  const anchorIndex = entries.findIndex(([id]) => id === afterLayerId);
  if (anchorIndex < 0) throw new Error(`Cannot insert a layer after missing layer "${afterLayerId}"`);
  entries.splice(anchorIndex + 1, 0, [layerId, layer]);
  layers.clear();
  for (const [id, value] of entries) layers.set(id, value);
}

/**
 * Converts an array of layers into a Record indexed by layer ID.
 * @param layersArray - Array of Layer objects
 * @returns Record mapping layer IDs to Layer objects
 */
export function layersArrayToRecord(layersArray: Layer[]): Record<LayerId, Layer> {
  return layersArray.reduce<Record<LayerId, Layer>>((acc, layer) => {
    acc[layer.id] = layer;
    return acc;
  }, Object.create(null));
}

export const minLayerOrder = (layers: LayersRecord) => {
  const values = Object.values(layers);
  if (values.length === 0) return 0;
  return values.reduce((min, layer) => Math.min(min, layer.order), Infinity);
};

export const maxLayerOrder = (layers: LayerOrderRecord) => {
  const values = Object.values(layers);
  if (values.length === 0) return 0;
  return values.reduce((max, layer) => Math.max(max, layer.order), -Infinity);
};

// export function _createImageLayer({ bitmap, size }: { bitmap:  }) {
//   const canvas = document.createElement('canvas');
//   canvas.width = size.width;
//   canvas.height = size.height;
//
//   const ctx = canvas.getContext('2d')!;
//   ctx.drawImage(bitmap, 0, 0);
//
//   return canvas;
// }

// export function _createBlankLayer({ color, opacity, size }: BlankImageParams) {
//   const canvas = document.createElement('canvas');
//   canvas.width = size.width;
//   canvas.height = size.height;
//
//   const ctx = canvas.getContext('2d')!;
//   ctx.fillStyle = color;
//   ctx.globalAlpha = opacity;
//   ctx.fillRect(0, 0, size.width, size.height);
//
//   return canvas;
// }

// export async function _createToolLayer({ toolName, args, rect }: FullArgs) {
//   const canvas = document.createElement('canvas');
//   canvas.width = rect.width;
//   canvas.height = rect.height;
//
//   const ctx = canvas.getContext('2d')!;
//   await toolsMap[toolName].imageProcessor({ canvas, ctx } as CreatorToolParams)(args);
//
//   return canvas;
// }
//
// export async function restoreLayerFromHistory(layer: Layer, historyLength?: number): Promise<Partial<Layer>> {
//   let canvas: HTMLCanvasElement;
//   if (layer.source.kind === 'image') {
//     canvas = _createImageLayer(layer.source);
//   } else if (layer.source.kind === 'blank') {
//     canvas = _createBlankLayer(layer.source);
//   } else if (layer.source.kind === 'tool') {
//     canvas = await _createToolLayer(layer.source);
//   } else {
//     throw new Error(`Unsupported layer source kind: ${(layer.source as any).kind}`);
//   }
//
//   historyLength ??= layer.history.length;
//   const ctx = canvas.getContext('2d')!;
//
//   let newSize = { width: canvas.width, height: canvas.height };
//
//   for (let i = 0; i < historyLength; i++) {
//     const historyItem = layer.history[i];
//     const { toolName, args } = historyItem;
//     await toolsMap[toolName].imageProcessor({ canvas, ctx })(args, (width: number, height: number) => {
//       newSize = { width, height };
//     });
//   }
//
//   return { bitmap: canvas, historyLength, size: newSize };
// }

export function createLayerOperation(args: LayerOperationArgs, id = uuidv4()): LayerOperation {
  // Keep the legacy filter shape readable; the optional `kind: 'filter'`
  // remains accepted when loading newer serialized documents.
  return Object.freeze({ id, args: Object.freeze({ ...args }), enabled: true });
}

export function createAffineLayerOperation(transform: AffineTransform, id = uuidv4()) {
  return Object.freeze({
    id,
    kind: 'affine-transform' as const,
    transform: Object.freeze({ ...transform }),
    enabled: true as const,
  });
}

/**
 * The part of a layer set that naming and placement read. Durable snapshots carry
 * the same fields, so both conversion and replay share this derivation.
 */
export type LayerOrderRecord = Record<LayerId, { order: number; name?: string }>;

type LayerSourceParams = {
  layerId?: LayerId;
  layers: LayerOrderRecord;
  source: LayerSource;
  insertAfterLayerId?: LayerId;
};

/**
 * The blend mode a stroke's layer composites with, read off the tool args.
 *
 * The layer is created before the stroke is rasterized, so the options bar's `Mode`
 * has to be resolved here rather than while drawing. Replay re-enters this function
 * with the same history entry's args during `resetHistoryTo()`, which is
 * what keeps undo, redo and the durable shadow in agreement: the mode rides in
 * `layerSource.args`, so it is already carried by both
 * through `history-adapter`'s recursive plain-value conversion.
 *
 * Gated on the paint tool names on purpose. `kind: 'tool'` covers every creator
 * tool, and no other one of them exposes a `Mode` control, so an unrecognised value
 * must not be able to reach the renderer as an operation the canvas silently
 * ignores — nor should a stray `blendMode` key on a text or shape args object
 * decide how that layer composites. A mode this build does not recognise, from a
 * document written by one that offered it, falls back to Normal.
 */
export function toolLayerBlendMode(args: ToolArgs): Layer['blendMode'] {
  const paintArgs = args as { toolName?: unknown; blendMode?: unknown };
  if (paintArgs.toolName !== 'brush' && paintArgs.toolName !== 'pencil' && paintArgs.toolName !== 'color-replacement') {
    return 'source-over';
  }

  return isPaintBlendMode(paintArgs.blendMode) ? paintArgs.blendMode : 'source-over';
}

function getNameFromSource(source: LayerSource) {
  switch (source.kind) {
    case 'image':
      return ellipsify(source.name) || 'Image';
    case 'blank':
      return 'Blank';
    case 'tool':
      return source.args.toolName;
  }
}

/**
 * Derives a created layer's unique name and stack position. An empty layer set
 * yields `1`, making the first layer `'<name> 1'` rather than `'<name>'` at order `0`.
 *
 * It is exported, and separate from {@link createLayerSource}, because the durable
 * converter must derive the same pair from a set of durable snapshots and has no
 * runtime layer to build. Reaching the rule through the factory would drag its
 * rasterisation with it — an `OffscreenCanvas` per blank source, a creator tool's
 * `imageProcessor` per tool source — and a conversion that wants two fields would
 * start failing on args no conversion ever needed.
 */
function orderImmediatelyAfter(layers: LayerOrderRecord, afterLayerId: LayerId): number {
  const ordered = Object.entries(layers).sort(([, left], [, right]) => left.order - right.order);
  const targetIndex = ordered.findIndex(([id]) => id === afterLayerId);
  if (targetIndex < 0) throw new Error(`Cannot insert a layer after missing layer "${afterLayerId}"`);

  const target = ordered[targetIndex]![1];
  if (!Number.isFinite(target.order)) {
    throw new RangeError(`Cannot insert a layer after "${afterLayerId}" because its order is not finite`);
  }

  const next = ordered[targetIndex + 1]?.[1];
  if (!next) {
    const order = target.order + 1;
    return Number.isFinite(order) && order > target.order ? order : target.order;
  }
  if (!Number.isFinite(next.order) || next.order < target.order) {
    throw new RangeError(`Cannot insert a layer after "${afterLayerId}" because adjacent layer order is invalid`);
  }
  if (next.order === target.order) return target.order;

  const midpoint = target.order / 2 + next.order / 2;
  if (Number.isFinite(midpoint) && midpoint > target.order && midpoint < next.order) return midpoint;

  // Equal orders are ordered by the record/map position, which the insertion helpers preserve.
  return target.order;
}

export function deriveLayerNameAndOrder(layers: LayerOrderRecord, source: LayerSource, insertAfterLayerId?: LayerId) {
  const maxOrder = maxLayerOrder(layers);
  const order = insertAfterLayerId !== undefined ? orderImmediatelyAfter(layers, insertAfterLayerId) : maxOrder + 1;
  const existingNames = new Set(Object.values(layers).flatMap((layer) => (layer.name ? [layer.name] : [])));
  const baseName = getNameFromSource(source);
  let nameOrder = Math.max(1, Math.ceil(maxOrder + 1));
  let name = `${baseName} ${nameOrder}`;
  while (existingNames.has(name)) {
    nameOrder += 1;
    name = `${baseName} ${nameOrder}`;
  }
  return { name, order };
}

export function createLayerSource({
  layerId: idFromHistory,
  layers,
  source,
  insertAfterLayerId,
}: LayerSourceParams): Layer {
  const { kind, isBedrock } = source;
  const id = idFromHistory ?? uuidv4(); // when layer is re-created from history it should get the saved id
  const { name, order } = deriveLayerNameAndOrder(layers, source, insertAfterLayerId);

  let pos: Pos;
  if (isBedrock) {
    pos = { x: 0, y: 0, ...source.size };
  } else {
    pos = { ...source.pos };
  }
  if (pos.width === 0 || pos.height === 0) {
    throw new Error('Layer width and height must be greater than 0');
  }

  const layer: Layer = {
    id,
    name,

    blendMode: 'source-over',
    locked: false,
    opacity: 1,
    fillOpacity: 1,
    order,
    pos,
    source,
    operations: [],
    presentationBounds: null,
    visible: true,
    isBedrock: isBedrock ?? false,

    bitmap: null,
    tmpCanvas: null,
  };

  const { width, height } = pos;

  if (kind === 'image') {
    layer.bitmap = source.bitmap;
  } else if (kind === 'blank') {
    const canvas = new OffscreenCanvas(width, height);
    // Initialize even a transparent source so the browser can materialize its presentation bitmap.
    const ctx = canvas.getContext('2d');

    if (source.opacity > 0) {
      if (!ctx) throw new Error('Unable to initialize blank layer canvas');
      ctx.fillStyle = source.color;
      if (source.opacity !== 1) {
        ctx.globalAlpha = source.opacity;
      }
      // The bitmap is layer-local even when the layer itself has a document-space origin.
      ctx.fillRect(0, 0, width, height);
    }

    layer.tmpCanvas = canvas;
  } else if (kind === 'tool') {
    // and this is a creator tool
    const processor = findToolProcessor(source.args.toolName);
    // Unreachable: only a creator tool produces a `tool` source, and a tool with no processor
    // (`PIXEL_FREE_TOOLS`) is never a creator. Named rather than left as a `TypeError` on
    // `undefined.imageProcessor`, so the violation says what it is.
    if (!processor) throw new Error(`Tool ${source.args.toolName} has no processor to create a layer from`);
    const [canvas, patch] = processor.imageProcessor({ size: pos } as CreatorToolParams)(source.args);
    if (patch) {
      layer.pos = { ...layer.pos, ...patch };
    }

    layer.blendMode = toolLayerBlendMode(source.args);
    layer.tmpCanvas = canvas;
  }

  return layer;
}

export function getLayerIdByPoint(layers: LayersRecord, { x, y }: Point): LayerId | null {
  const sortedLayers = getSortedLayersArray(layers).reverse(); // check top layers first

  for (const layer of sortedLayers) {
    if (!layer.visible) continue;

    try {
      if (isPointInLayer(layer, { x, y })) return layer.id;
    } catch {
      // Invalid historical geometry must not make pointer hit testing fail.
    }
  }

  return null;
}

/** Apply the historical layer-order arithmetic used by replayHistory. */
export function reorderLayerOrderValues({
  orderByLayerId,
  layerToMoveId,
  afterWhichLayerId,
}: {
  orderByLayerId: Record<LayerId, number>;
  layerToMoveId: LayerId;
  afterWhichLayerId?: LayerId | null;
}): Record<LayerId, number> | null {
  if (!Object.hasOwn(orderByLayerId, layerToMoveId)) return null;
  if (afterWhichLayerId && !Object.hasOwn(orderByLayerId, afterWhichLayerId)) return null;

  const next = { ...orderByLayerId };
  if (!afterWhichLayerId) {
    const minOrder = Object.values(next).reduce((minimum, order) => Math.min(minimum, order), Infinity);
    next[layerToMoveId] = minOrder - 1;
    return next;
  }

  const targetOrder = next[afterWhichLayerId]!;
  for (const id in next) {
    if (next[id]! > targetOrder) next[id] += 2;
  }
  next[layerToMoveId] = targetOrder + 1;
  return next;
}

export function reorderLayers({
  layers,
  layerToMoveId,
  afterWhichLayerId,
}: {
  layers: LayersRecord;
  layerToMoveId: LayerId;
  afterWhichLayerId?: LayerId | null;
}) {
  if (!layers[layerToMoveId]) {
    console.error('Layer not found');
    return;
  }

  if (afterWhichLayerId && !layers[afterWhichLayerId]) {
    console.error('Target layer not found');
    return;
  }

  const orderByLayerId = reorderLayerOrderValues({
    orderByLayerId: Object.fromEntries(Object.values(layers).map((layer) => [layer.id, layer.order])),
    layerToMoveId,
    afterWhichLayerId,
  });
  if (!orderByLayerId) return;
  for (const [id, order] of Object.entries(orderByLayerId)) layers[id]!.order = order;
}
