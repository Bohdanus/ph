import type { BitmapSource, Pos } from './general-types.ts';
import type { NewLayerData, ToolArgs } from './tool-types.ts';
import type { AffineTransform } from './affine-transform.ts';

export type LayerId = string;

export const LAYER_BLEND_MODES = [
  { value: 'source-over', label: 'Normal', psd: 'normal' },
  { value: 'darken', label: 'Darken', psd: 'darken' },
  { value: 'multiply', label: 'Multiply', psd: 'multiply' },
  { value: 'color-burn', label: 'Color Burn', psd: 'color burn' },
  { value: 'lighten', label: 'Lighten', psd: 'lighten' },
  { value: 'screen', label: 'Screen', psd: 'screen' },
  { value: 'color-dodge', label: 'Color Dodge', psd: 'color dodge' },
  { value: 'overlay', label: 'Overlay', psd: 'overlay' },
  { value: 'soft-light', label: 'Soft Light', psd: 'soft light' },
  { value: 'hard-light', label: 'Hard Light', psd: 'hard light' },
  { value: 'difference', label: 'Difference', psd: 'difference' },
  { value: 'exclusion', label: 'Exclusion', psd: 'exclusion' },
  { value: 'hue', label: 'Hue', psd: 'hue' },
  { value: 'saturation', label: 'Saturation', psd: 'saturation' },
  { value: 'color', label: 'Color', psd: 'color' },
  { value: 'luminosity', label: 'Luminosity', psd: 'luminosity' },
] as const satisfies readonly { value: GlobalCompositeOperation; label: string; psd: string }[];

export type LayerBlendMode = (typeof LAYER_BLEND_MODES)[number]['value'];

export function isLayerBlendMode(value: unknown): value is LayerBlendMode {
  return LAYER_BLEND_MODES.some((mode) => mode.value === value);
}

// SOURCES

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

export type LayerOperationArgs = Extract<ToolArgs, { toolName: 'blur' | 'color' | 'levels' }>;

// Operations are the canonical editable form; rendered bitmaps are disposable materializations.
export type FilterLayerOperation = Readonly<{
  id: string;
  args: LayerOperationArgs;
  enabled: boolean;
  // Optional for compatibility with documents written before operations were discriminated.
  kind?: 'filter';
}>;

export type AffineLayerOperation = Readonly<{
  id: string;
  kind: 'affine-transform';
  transform: AffineTransform;
  enabled: boolean;
}>;

export type LayerOperation = FilterLayerOperation | AffineLayerOperation;

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
  presentationBounds: null | Pos;

  source?: LayerSource;
  operations: readonly LayerOperation[];

  lastHistoryId?: string;
};

export type LayersRecord = Record<LayerId, Layer>;
