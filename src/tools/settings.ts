import { cloneDeep } from 'lodash-es';

import type { DrawToolSettings, DrawToolArgs, PaintToolArgs, PenType } from './draw.ts';
import type { TextToolArgs, TextToolSettings } from './text.ts';
import type { CropToolArgs } from './crop.ts';
import type { TransformToolArgs } from './transform.ts';
import type { ColorsToolArgs } from './colors.ts';
import type { LevelsToolArgs } from './levels.ts';
import type { BlurToolArgs } from './blur.ts';
import type { FigureType, ShapeToolSettings, ShapeToolArgs } from './shape.ts';
import type { ToolArgsByName } from '../contexts/tool-types.ts';
import type { RepositionToolArgs } from './reposition.ts';
import type { LassoToolArgs, PolygonSelectionToolSettings } from './polygonSelection.ts';
import type { RectangularSelectionToolArgs } from './rectangularSelection.ts';
import type { FeatherMagneticLassoToolArgs, FeatherMagneticLassoToolSettings } from './featherMagneticLasso.ts';
import type { MagicWandToolArgs, MagicWandToolSettings } from './magicWand.ts';

type PenSettings = Omit<DrawToolArgs, 'color' | 'points' | 'penType' | 'toolName'>;
type FigureSettings = Omit<ShapeToolArgs, 'color' | 'backgroundColor' | 'start' | 'end' | 'figure' | 'toolName'>;

export const savedDrawPerPen: Record<PenType, PenSettings> = {
  pen: { alpha: 0.9, lineWidth: 10 },
  'pen-dashed': { alpha: 0.9, lineWidth: 10, lineDash: [5, 30] },
  spray: { alpha: 0.5, lineWidth: 100 },
};

export const savedArgsPerFigure: Record<FigureType, FigureSettings> = {
  line: { alpha: 1, lineWidth: 5, lineCap: 'butt', toolMode: 'shape' },
  circle: { alpha: 1, lineWidth: 5, cornerRadius: 0, toolMode: 'shape' },
  rectangle: { alpha: 1, lineWidth: 5, cornerRadius: 0, toolMode: 'shape' },
  square: { alpha: 1, lineWidth: 5, cornerRadius: 0, toolMode: 'shape' },
  oval: { alpha: 1, lineWidth: 5, cornerRadius: 0, toolMode: 'shape' },
};

export const defaultSettings = {
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
  'feather-magnetic-lasso': {
    featherRadius: 12,
    magneticWidth: 18,
    edgeContrast: 30,
    frequency: 40,
    snapStrength: 0.85,
    smoothing: 1.5,
    antiAlias: true,
    previewFeather: true,
    points: [],
    toolName: 'feather-magnetic-lasso',
  } satisfies FeatherMagneticLassoToolArgs,
  'magic-wand': {
    tolerance: 28,
    smoothing: 1.5,
    toolName: 'magic-wand',
  } satisfies MagicWandToolArgs,
  'rectangular-selection': { toolName: 'rectangular-selection' } satisfies RectangularSelectionToolArgs,
  brush: {
    alpha: 0.9,
    color: '#000000',
    penType: 'pen',
    lineWidth: 10,
    points: [],
    toolName: 'brush',
  } satisfies PaintToolArgs,
  pencil: {
    alpha: 0.9,
    color: '#000000',
    penType: 'pen',
    lineWidth: 3,
    points: [],
    toolName: 'pencil',
  } satisfies PaintToolArgs,
  'color-replacement': {
    alpha: 0.55,
    color: '#000000',
    penType: 'spray',
    lineWidth: 18,
    points: [],
    toolName: 'color-replacement',
  } satisfies PaintToolArgs,
  pen: { toolName: 'pen' },
  'freeform-pen': { toolName: 'freeform-pen' },
  'curvature-pen': { toolName: 'curvature-pen' },
  'add-anchor-point': { toolName: 'add-anchor-point' },
  'delete-anchor-point': { toolName: 'delete-anchor-point' },
  'convert-point': { toolName: 'convert-point' },
  rectangle: {
    ...savedArgsPerFigure['rectangle'],
    figure: 'rectangle',
    color: '#000000',
    backgroundColor: null,
    toolName: 'rectangle',
  } satisfies ToolArgsByName['rectangle'],
  ellipse: {
    ...savedArgsPerFigure['oval'],
    figure: 'oval',
    color: '#000000',
    backgroundColor: null,
    toolName: 'ellipse',
  } satisfies ToolArgsByName['ellipse'],
  triangle: { toolName: 'triangle' },
  polygon: { toolName: 'polygon' },
  line: {
    ...savedArgsPerFigure['line'],
    figure: 'line',
    color: '#000000',
    backgroundColor: null,
    toolName: 'line',
  } satisfies ToolArgsByName['line'],
  'custom-shape': { toolName: 'custom-shape' },
} satisfies ToolArgsByName;

export type DefaultSettings = typeof defaultSettings;

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
  | RectangularSelectionToolArgs
  | MagicWandToolSettings
  | FeatherMagneticLassoToolSettings
  | PolygonSelectionToolSettings;

export const lastSavedSettings: ToolArgsByName = cloneDeep(defaultSettings);
