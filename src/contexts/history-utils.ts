import { v4 as uuidv4 } from 'uuid';

import type { HistoryItem, NewHistoryItem } from './history-types.ts';
import type { Layer, LayerSource, LayersRecord } from './layer-types.ts';
import type { DocumentFrame } from './document-frame.ts';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function clonePlainData<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => clonePlainData(item)) as T;
  }
  if (!isPlainObject(value)) return value;

  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clonePlainData(item)])) as T;
}

function cloneLayerSource(source: LayerSource): LayerSource {
  const layerData = source.isBedrock
    ? { isBedrock: true as const, size: { ...source.size } }
    : { isBedrock: false as const, pos: { ...source.pos } };

  switch (source.kind) {
    case 'blank':
      return { kind: 'blank', color: source.color, opacity: source.opacity, ...layerData };
    case 'image':
      return { kind: 'image', bitmap: source.bitmap, name: source.name, ...layerData };
    case 'tool':
      return { kind: 'tool', args: clonePlainData(source.args), ...layerData };
  }
}

function cloneLayer(layer: Layer): Layer {
  return {
    ...layer,
    pos: { ...layer.pos },
    ...(layer.source ? { source: cloneLayerSource(layer.source) } : {}),
    operations: layer.operations.map((operation) =>
      operation.kind === 'affine-transform'
        ? { ...operation, transform: { ...operation.transform } }
        : { ...operation, args: clonePlainData(operation.args) }
    ),
    bitmap: layer.bitmap,
    tmpCanvas: layer.tmpCanvas,
  };
}

function cloneLayers(layers: LayersRecord): LayersRecord {
  return Object.fromEntries(Object.values(layers).map((layer) => [layer.id, cloneLayer(layer)]));
}

function cloneArgs(args: NewHistoryItem['args']): NewHistoryItem['args'] {
  if (!args) return args;
  const candidate = args as Record<string, unknown>;
  if (
    isPlainObject(candidate) &&
    typeof candidate.kind === 'string' &&
    ['blank', 'image', 'tool'].includes(candidate.kind)
  ) {
    return cloneLayerSource(args as LayerSource);
  }
  return clonePlainData(args);
}

function freezePlainData(value: unknown, skipped: ReadonlySet<object>): void {
  if (!value || typeof value !== 'object' || skipped.has(value)) return;
  if (Array.isArray(value)) {
    for (const item of value) freezePlainData(item, skipped);
    Object.freeze(value);
    return;
  }
  if (!isPlainObject(value)) return;
  for (const item of Object.values(value)) freezePlainData(item, skipped);
  Object.freeze(value);
}

export function createHistoryItem(input: NewHistoryItem, id = uuidv4()): HistoryItem {
  const layerSource = input.layerSource ? cloneLayerSource(input.layerSource) : undefined;
  const documentSource = input.documentSource
    ? {
        layers: cloneLayers(input.documentSource.layers),
        size: { ...input.documentSource.size },
        ...(input.documentSource.frame ? { frame: { ...input.documentSource.frame } satisfies DocumentFrame } : {}),
      }
    : undefined;
  const item: HistoryItem = {
    id,
    actionName: input.actionName,
    layerId: input.layerId,
    ...(layerSource ? { layerSource } : {}),
    ...(documentSource ? { documentSource } : {}),
    ...(input.args ? { args: cloneArgs(input.args) } : {}),
  };

  if (import.meta.env.DEV) {
    const resources = new Set<object>();
    if (layerSource?.kind === 'image') resources.add(layerSource.bitmap);
    if (documentSource) {
      for (const layer of Object.values(documentSource.layers)) {
        if (layer.bitmap) resources.add(layer.bitmap);
        if (layer.tmpCanvas) resources.add(layer.tmpCanvas);
      }
    }
    freezePlainData(item, resources);
  }

  return item;
}
