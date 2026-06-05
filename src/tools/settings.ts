import { cloneDeep } from 'lodash-es';

import type { DrawToolSettings, DrawToolArgs, PenType } from './draw.ts';
import type { TextToolArgs, TextToolSettings } from './text.ts';
import type { CropToolArgs } from './crop.ts';
import type { TransformToolArgs } from './transform.ts';
import type { ColorsToolArgs } from './colors.ts';
import type { LevelsToolArgs } from './levels.ts';
import type { BlurToolArgs } from './blur.ts';
import type { FigureType, ShapeToolSettings, ShapeToolArgs } from './shape.ts';
import type { ToolName, ToolSettings } from '../contexts/tool-types.ts';
import type { RepositionToolArgs } from './reposition.ts';
import type { LassoToolArgs, PolygonSelectionToolSettings } from './polygonSelection.ts';

type PenSettings = Omit<DrawToolArgs, 'color' | 'points' | 'penType' | 'toolName'>;
type FigureSettings = Omit<ShapeToolArgs, 'color' | 'backgroundColor' | 'start' | 'end' | 'figure' | 'toolName'>;

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

export const defaultSettings: Record<ToolName, ToolSettings> = {
  blur: { radius: 0, toolName: 'blur' } satisfies BlurToolArgs,
  color: { grayscale: 0, sepia: 0, saturation: 0, toolName: 'color' } satisfies ColorsToolArgs,
  levels: { brightness: 0, contrast: 0, toolName: 'levels' } satisfies LevelsToolArgs,
  transform: {
    rotate: 0,
    mirrorH: false,
    mirrorV: false,
    skewX: 0,
    skewY: 0,
    trapezoid: 0,
    resizeX: 100,
    resizeY: 100,

    toolName: 'transform',
  } satisfies TransformToolArgs,
  crop: { aspectRatio: null, rect: null, toolName: 'crop' } satisfies CropToolArgs,
  draw: {
    ...savedDrawPerPen['pen'],
    color: '#000000',
    points: [],
    penType: 'pen',
    toolName: 'draw',
  } satisfies DrawToolArgs,
  shape: {
    ...savedArgsPerFigure['rectangle'],
    figure: 'rectangle',
    color: '#000000',
    backgroundColor: null,
    toolName: 'shape',
  } satisfies ShapeToolArgs,
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

    toolName: 'text',
  } satisfies TextToolArgs,
  reposition: { move: { x: 0, y: 0 }, toolName: 'reposition' } satisfies RepositionToolArgs,
  'polygonal-lasso': {
    alpha: 1,
    lineWidth: 3,
    color: '#FF0000',
    fill: false,
    points: [],
    toolName: 'polygonal-lasso',
  } satisfies LassoToolArgs,
  'freehand-lasso': {
    alpha: 1,
    lineWidth: 3,
    color: '#FF0000',
    fill: false,
    points: [],
    toolName: 'freehand-lasso',
  } satisfies LassoToolArgs,
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
  | RepositionToolArgs
  | PolygonSelectionToolSettings;

export const lastSavedSettings = cloneDeep(defaultSettings);
