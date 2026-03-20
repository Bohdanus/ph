import { cloneDeep } from 'lodash-es';

import type { DrawToolSettings, DrawToolArgs, PenType } from './draw.ts';
import type { TextToolArgs, TextToolSettings } from './text.ts';
import type { CropToolArgs } from './crop.ts';
import type { TransformToolArgs } from './transform.ts';
import type { ColorsToolArgs } from './colors.ts';
import type { LevelsToolArgs } from './levels.ts';
import type { BlurToolArgs } from './blur.ts';
import type { FigureType, ShapeToolSettings, ShapeToolArgs } from './shape.ts';
import type { ToolName } from '../contexts/tool-types.ts';
import type { RepositionToolArgs } from './reposition.ts';

type PenSettings = Omit<DrawToolArgs, 'color' | 'points' | 'penType'>;
type FigureSettings = Omit<ShapeToolArgs, 'lineColor' | 'fillColor' | 'start' | 'end' | 'figure'>;

export const savedDrawPerPen: Record<PenType, PenSettings> = {
  pen: { alpha: 0.9, lineWidth: 10 },
  'pen-dashed': { alpha: 0.9, lineWidth: 10, lineDash: [5, 30] },
  spray: { alpha: 0.5, lineWidth: 100 },
};

export const savedArgsPerFigure: Record<FigureType, FigureSettings> = {
  line: { alpha: 1, lineWidth: 5 },
  circle: { alpha: 1, lineWidth: 5 },
  rectangle: { alpha: 1, lineWidth: 5 },
  square: { alpha: 1, lineWidth: 5 },
  oval: { alpha: 1, lineWidth: 5 },
};

export const defaultSettings: Record<ToolName, SavedSettings> = {
  blur: { radius: 0 } satisfies BlurToolArgs,
  color: { grayscale: 0, sepia: 0, saturation: 0 } satisfies ColorsToolArgs,
  levels: { brightness: 0, contrast: 0 } satisfies LevelsToolArgs,
  transform: {
    rotate: 0,
    mirrorH: false,
    mirrorV: false,
    skewX: 0,
    skewY: 0,
    trapezoid: 0,
    resizeX: 100,
    resizeY: 100,
  } satisfies TransformToolArgs,
  crop: { aspectRatio: null, rect: null } satisfies CropToolArgs,
  // @ts-expect-error s
  draw: { ...savedDrawPerPen['pen'], color: '#000000', points: [], penType: 'pen' } satisfies DrawToolArgs,
  shape: {
    ...savedArgsPerFigure['rectangle'],
    figure: 'rectangle',
    lineColor: '#000000',
    fillColor: null,
  } satisfies ShapeToolArgs,
  text: {
    // @ts-expect-error s
    text: '',
    fontSize: 64,
    lineHeight: 1.1,
    fontFamily: 'Arial',
    color: '#000000',
    rect: null,
    align: 'left',
    bold: false,
    italic: false,
  } satisfies TextToolArgs,
  reposition: { move: { x: 0, y: 0 } } satisfies RepositionToolArgs,
};

export type SavedSettings =
  | DrawToolSettings
  | ShapeToolSettings
  | TextToolSettings
  | BlurToolArgs
  | ColorsToolArgs
  | LevelsToolArgs
  | TransformToolArgs
  | CropToolArgs
  | RepositionToolArgs;

export const lastSavedSettings = cloneDeep(defaultSettings);
