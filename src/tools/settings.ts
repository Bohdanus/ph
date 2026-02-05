// the idea is to hold here the last used settings
// localStorage
// use default initially

import { type ToolArgs, type ToolName } from '../contexts/ImageContext.tsx';
import type { DrawToolType, PenType } from './draw.ts';
import type { TextToolArgs } from './text.ts';
import type { CropToolType } from './crop.ts';
import type { TransformToolType } from './transform.ts';
import type { ColorsToolType } from './colors.ts';
import type { LevelsToolType } from './levels.ts';
import type { BlurToolType } from './blur.ts';
import type { FigureType, ShapeToolType } from './shape.ts';

// type DrawSettings = { // todo use Omit
//   alpha: number;
//   color?: string;
//   lineWidth: number;
//   lineDash?: null | number[];
// };

type DrawSettings = Omit<DrawToolType, 'color' | 'points' | 'penType'>;
type ShapeSettings = Omit<ShapeToolType, 'lineColor' | 'fillColor' | 'start' | 'end' | 'figure'>;

export const savedDrawPerPen: Record<PenType, DrawSettings> = {
  pen: { alpha: 0.9, lineWidth: 10 },
  'pen-dashed': { alpha: 0.9, lineWidth: 10, lineDash: [5, 30] },
  spray: { alpha: 0.5, lineWidth: 100 },
};

export const savedArgsPerFigure: Record<FigureType, ShapeSettings> = {
  line: { alpha: 1, lineWidth: 5 },
  circle: { alpha: 1, lineWidth: 5 },
  rectangle: { alpha: 1, lineWidth: 5 },
  square: { alpha: 1, lineWidth: 5 },
  oval: { alpha: 1, lineWidth: 5 },
};

export const defaultSettings: Record<ToolName, ToolArgs> = {
  blur: { radius: 0 } as BlurToolType,
  colors: { grayscale: 0, sepia: 0, saturation: 0 } as ColorsToolType,
  levels: { brightness: 0, contrast: 0 } as LevelsToolType,
  transform: {
    rotate: 0,
    mirrorH: false,
    mirrorV: false,
    skewX: 0,
    skewY: 0,
    trapezoid: 0,
    resizeX: 100,
    resizeY: 100,
  } as TransformToolType,
  crop: { x1: 0, y1: 0, x2: 0, y2: 0 } as CropToolType,
  draw: { ...savedDrawPerPen['pen'], color: '#000000', points: [], penType: 'pen' } as DrawToolType,
  shape: {
    ...savedArgsPerFigure['rectangle'],
    figure: 'rectangle',
    lineColor: '#000000',
    fillColor: null,
  } as ShapeToolType,
  text: {
    text: '',
    fontSize: 64,
    lineHeight: 1.1,
    fontFamily: 'Arial',
    color: '#000000',
    rect: null,
    align: 'left',
    bold: false,
    italic: false,
  } as TextToolArgs,
};

export const savedLastSettings: Record<ToolName, ToolArgs> = {
  draw: defaultSettings.draw,
  shape: defaultSettings.shape,
  text: defaultSettings.text,
};
