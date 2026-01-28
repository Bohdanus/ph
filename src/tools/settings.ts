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

type DrawSettings = {
  alpha: number;
  color?: string;
  size: number;
};

export const savedDrawPerPen: Record<PenType, DrawSettings> = {
  pen: { alpha: 1, size: 10 },
  spray: { alpha: 0.5, size: 100 },
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
  text: defaultSettings.text,
};
