import { v4 as uuidv4 } from 'uuid';

import type { Layer, LayerId, LayerOperation, LayerOperationArgs, LayerSource, LayersRecord } from './layer-types.ts';
import { type CreatorToolParams, toolProcessors } from '../tools/toolProcessors.ts';
import type { Point, Pos } from './general-types.ts';
import { ellipsify } from '../util/string.ts';

/**
 * Converts a Record of layers into a sorted array ordered by layer order (ascending).
 * @param layersRecord - Record mapping layer IDs to Layer objects
 * @returns Array of layers sorted by order
 */
export function getSortedLayersArray(layersRecord: Record<LayerId, Layer>): Layer[] {
  return Object.values(layersRecord).sort((a, b) => a.order - b.order);
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

export const maxLayerOrder = (layers: LayersRecord) => {
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

export function saveLayerCanvas(layer: Layer) {
  const canvas = layer.tmpCanvas;
  if (!canvas) return;

  return createImageBitmap(canvas).then((bitmap) => {
    // A newer preview or deletion may have replaced this canvas while saving.
    if (layer.tmpCanvas !== canvas) {
      bitmap.close();
      return;
    }
    layer.bitmap = bitmap;
    layer.tmpCanvas = null;
    return bitmap;
  });
}

export function createLayerOperation(args: LayerOperationArgs, id = uuidv4()): LayerOperation {
  return Object.freeze({ id, args: Object.freeze({ ...args }), enabled: true });
}

type LayerSourceParams = {
  layerId?: LayerId;
  layers: LayersRecord;
  source: LayerSource;
  deferSave?: boolean;
};

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

export function createLayerSource({
  layerId: idFromHistory,
  layers,
  source,
  deferSave = false,
}: LayerSourceParams): Layer {
  const { kind, isBedrock } = source;
  const id = idFromHistory ?? uuidv4(); // when layer is re-created from history it should get the saved id
  const maxOrder = maxLayerOrder(layers) + 1;

  let pos: Pos;
  if (isBedrock) {
    pos = { x: 0, y: 0, ...source.size };
  } else {
    pos = { ...source.pos };
  }
  if (pos.width === 0 || pos.height === 0) {
    throw new Error('Layer width and height must be greater than 0');
  }

  const name = `${getNameFromSource(source)} ${maxOrder}`;

  const layer: Layer = {
    id,
    name,

    blendMode: 'source-over',
    locked: false,
    opacity: 1,
    order: maxOrder,
    pos,
    source,
    operations: [],
    visible: true,
    isBedrock: isBedrock ?? false,

    bitmap: null,
    tmpCanvas: null,
  };

  const { x, y, width, height } = pos;

  if (kind === 'image') {
    layer.bitmap = source.bitmap;
  } else if (kind === 'blank') {
    const canvas = new OffscreenCanvas(width, height);

    if (source.opacity > 0) {
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = source.color;
      if (source.opacity !== 1) {
        ctx.globalAlpha = source.opacity;
      }
      ctx.fillRect(x, y, width, height);
    }

    layer.tmpCanvas = canvas;
    if (!deferSave) saveLayerCanvas(layer);
  } else if (kind === 'tool') {
    // and this is a creator tool
    const [canvas, patch] = toolProcessors[source.args.toolName].imageProcessor({ size: pos } as CreatorToolParams)(
      source.args
    );
    if (patch) {
      layer.pos = { ...layer.pos, ...patch };
    }

    layer.tmpCanvas = canvas;
    if (!deferSave) saveLayerCanvas(layer);
  }

  return layer;
}

export function getLayerIdByPoint(layers: LayersRecord, { x, y }: Point): LayerId | null {
  const sortedLayers = getSortedLayersArray(layers).reverse(); // check top layers first

  for (const layer of sortedLayers) {
    if (!layer.visible) continue;

    const { pos } = layer;
    if (x >= pos.x && x <= pos.x + pos.width && y >= pos.y && y <= pos.y + pos.height) {
      return layer.id;
    }
  }

  return null;
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
  const layer = layers[layerToMoveId];
  if (!layer) {
    console.error('Layer not found');
    return;
  }

  if (!afterWhichLayerId) {
    // Move to the bottom (beginning)
    const minOrder = minLayerOrder(layers);
    layer.order = minOrder - 1;
  } else {
    // Place after the specified layer
    const moveAfterLayer = layers[afterWhichLayerId];
    if (!moveAfterLayer) {
      console.error('Target layer not found');
      return;
    }

    const targetOrder = moveAfterLayer.order;

    for (const id in layers) {
      if (layers[id].order > targetOrder) {
        layers[id].order += 2; // shift up layers starting from targetOrder
      }
    }

    layer.order = targetOrder + 1;
  }
}
