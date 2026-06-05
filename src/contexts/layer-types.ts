import type { BitmapSource, Pos } from './general-types.ts';
import type { NewLayerData, ToolArgs } from './tool-types.ts';

export type LayerId = string;

// SOURCES
// @ts-expect-error not used
type LayerSourceKind = 'blank' | 'image' | 'tool';

export type BlankLayerSource = {
  kind: 'blank';
  color: string; // CSS color for blank layer
  opacity: number; // 0..1
} & NewLayerData;

export type ImageLayerSource = {
  kind: 'image';
  bitmap: BitmapSource;
  name?: string;
} & NewLayerData;

export type ToolLayerSource = {
  kind: 'tool';
  args: ToolArgs;
} & NewLayerData;

export type LayerSource = BlankLayerSource | ImageLayerSource | ToolLayerSource;

export type Layer = {
  id: string;
  name: string;

  isBedrock: boolean; // whether the layer is a bedrock layer (used to prevent deletion and other destructive actions)

  tmpCanvas: null | BitmapSource; // used for caching the rendered layer content, to optimize rendering
  bitmap: null | BitmapSource;

  visible: boolean;
  opacity: number; // 0..1
  locked: boolean;
  blendMode: GlobalCompositeOperation;
  order: number;

  pos: Pos;

  lastHistoryId?: string;
};

export type LayersRecord = Record<LayerId, Layer>;
