import type { Selection, Size } from './general-types.ts';
import type { LayerId } from './layer-types.ts';

export type AssetId = string & { readonly __assetId: unique symbol };

export type PlainPrimitive = string | number | boolean | null;
export type PlainValue = PlainPrimitive | PlainObject | readonly PlainValue[];
export type PlainObject = { readonly [key: string]: PlainValue | undefined };

export type DurableLayerSource =
  | Readonly<{
      kind: 'blank';
      color: string;
      opacity: number;
      size: Size;
    }>
  | Readonly<{
      kind: 'raster';
      assetId: AssetId;
      width: number;
      height: number;
    }>
  | Readonly<{
      kind: 'legacy-tool';
      toolName: string;
      args: PlainObject;
      size: Size;
    }>;

export type LayerSnapshot = Readonly<{
  id: LayerId;
  name: string;
  isBedrock: boolean;
  visible: boolean;
  opacity: number;
  locked: boolean;
  blendMode: GlobalCompositeOperation;
  order: number;
  pos: Readonly<{ x: number; y: number; width: number; height: number }>;
  source: DurableLayerSource;
}>;

export type SelectionSnapshot = Readonly<{
  selections: readonly Selection[];
  activeSelectionId: string | null;
}>;

export type DocumentSnapshot = Readonly<{
  layers: readonly LayerSnapshot[];
  size: Size;
  selections: SelectionSnapshot;
  activeLayerId: LayerId | null;
}>;

export type LayerPropertyPatch = Readonly<
  Partial<Pick<LayerSnapshot, 'name' | 'visible' | 'opacity' | 'locked' | 'blendMode' | 'pos'>>
>;

export type HistoryOperation =
  | Readonly<{ kind: 'create-layer'; layer: LayerSnapshot }>
  | Readonly<{ kind: 'remove-layer'; layerId: LayerId }>
  | Readonly<{ kind: 'set-layer-properties'; layerId: LayerId; patch: LayerPropertyPatch }>
  | Readonly<{ kind: 'reorder-layers'; orderByLayerId: Readonly<Record<LayerId, number>> }>
  | Readonly<{
      kind: 'apply-raster-processor';
      layerId: LayerId;
      processorId: string;
      processorVersion: number;
      args: PlainObject;
    }>
  | Readonly<{ kind: 'rasterize-layer'; layerId: LayerId; result: LayerSnapshot }>
  | Readonly<{ kind: 'merge-document'; result: LayerSnapshot; removedLayerIds: readonly LayerId[] }>
  | Readonly<{ kind: 'replace-document'; document: DocumentSnapshot }>
  | Readonly<{ kind: 'set-selection'; before: SelectionSnapshot; after: SelectionSnapshot }>;

export type HistoryEntry = Readonly<{
  id: string;
  operation: HistoryOperation;
  disabled: boolean;
}>;

function clonePlainValue(value: PlainValue | undefined): PlainValue | undefined {
  if (Array.isArray(value)) return Object.freeze(value.map((item) => clonePlainValue(item) as PlainValue));
  if (!value || typeof value !== 'object') return value;
  return Object.freeze(
    Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clonePlainValue(item)])) as PlainObject
  );
}

function cloneLayerSource(source: DurableLayerSource): DurableLayerSource {
  switch (source.kind) {
    case 'blank':
      return Object.freeze({ ...source, size: Object.freeze({ ...source.size }) });
    case 'raster':
      return Object.freeze({ ...source });
    case 'legacy-tool':
      return Object.freeze({
        ...source,
        args: clonePlainValue(source.args) as PlainObject,
        size: Object.freeze({ ...source.size }),
      });
  }
}

export function toLayerSnapshot(layer: Omit<LayerSnapshot, 'source'>, source: DurableLayerSource): LayerSnapshot {
  return Object.freeze({
    ...layer,
    pos: Object.freeze({ ...layer.pos }),
    source: cloneLayerSource(source),
  });
}
