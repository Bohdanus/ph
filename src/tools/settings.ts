import { cloneDeep } from 'lodash-es';

import { PAINT_SMOOTHING_DEFAULT } from './brush.ts';
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
import type { EyedropperToolArgs } from './eyedropper.ts';
import type { EllipticalSelectionToolArgs } from './ellipticalSelection.ts';
import type { QuickSelectionToolArgs } from './quickSelection.ts';
import type { EraserToolArgs } from './eraser.ts';
import type { PaintBucketToolArgs } from './paintBucket.ts';
import type { GradientToolArgs } from './gradient.ts';
import type { SharpenToolArgs } from './sharpen.ts';
import type { SmudgeToolArgs, SmudgeToolSettings } from './smudge.ts';
import type { DodgeBurnToolArgs, DodgeBurnToolSettings } from './dodgeBurn.ts';
import type { CloneStampToolArgs, CloneStampToolSettings } from './cloneStamp.ts';

type PenSettings = Omit<DrawToolArgs, 'color' | 'points' | 'penType' | 'toolName'>;
type FigureSettings = Omit<ShapeToolArgs, 'color' | 'backgroundColor' | 'start' | 'end' | 'figure' | 'toolName'>;

export const savedDrawPerPen: Record<PenType, PenSettings> = {
  pen: { alpha: 0.9, lineWidth: 10 },
  'pen-dashed': { alpha: 0.9, lineWidth: 10, lineDash: [5, 30] },
  spray: { alpha: 0.5, lineWidth: 100 },
};

export const savedArgsPerFigure: Record<FigureType, FigureSettings> = {
  line: { alpha: 1, lineWidth: 5, lineCap: 'butt', toolMode: 'shape' },
  rectangle: { alpha: 1, lineWidth: 5, cornerRadius: 0, toolMode: 'shape' },
  oval: { alpha: 1, lineWidth: 5, cornerRadius: 0, toolMode: 'shape' },
  triangle: { alpha: 1, lineWidth: 5, toolMode: 'shape' },
  polygon: { alpha: 1, lineWidth: 5, toolMode: 'shape' },
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
  'elliptical-selection': {
    style: 'normal',
    fixedRatio: 1,
    fixedWidth: 100,
    fixedHeight: 100,
    toolName: 'elliptical-selection',
  } satisfies EllipticalSelectionToolArgs,
  'quick-selection': {
    size: 40,
    tolerance: 30,
    mode: 'add',
    alpha: 1,
    toolName: 'quick-selection',
  } satisfies QuickSelectionToolArgs,
  // Bare, because the eyedropper is `commit: 'unimplemented'` and every such tool has to
  // reduce to exactly `{ toolName }` (src/tools/__tests__/tool-settings.test.ts:362).
  eyedropper: { toolName: 'eyedropper' } satisfies EyedropperToolArgs,
  eraser: {
    size: 40,
    hardness: 100,
    alpha: 1,
    spacing: 25,
    // Stroke geometry, not a setting — the same shape `draw` and every other brush in
    // this family carries, and emptied again by `saveLastSettings` on every persist.
    points: [],
    toolName: 'eraser',
  } satisfies EraserToolArgs,
  'paint-bucket': {
    color: '#000000',
    tolerance: 32,
    contiguous: true,
    alpha: 1,
    // A bucket is a click: no click yet, so no seed. The processor treats it as a no-op
    // rather than a fill, which is what makes dispatching on the bare defaults well defined.
    seed: null,
    toolName: 'paint-bucket',
  } satisfies PaintBucketToolArgs,
  gradient: {
    type: 'linear',
    // A zero-length drag is a gradient with no extent, which is the honest seed: the
    // options bar sets the endpoints before the first commit.
    from: { x: 0, y: 0 },
    to: { x: 0, y: 0 },
    colorA: '#000000',
    colorB: '#FFFFFF',
    alpha: 1,
    toolName: 'gradient',
  } satisfies GradientToolArgs,
  sharpen: { amount: 50, radius: 1, toolName: 'sharpen' } satisfies SharpenToolArgs,
  smudge: { size: 40, hardness: 100, strength: 50, points: [], toolName: 'smudge' } satisfies SmudgeToolArgs,
  dodge: {
    exposure: 50,
    range: 'midtones',
    size: 40,
    hardness: 100,
    points: [],
    toolName: 'dodge',
  } satisfies DodgeBurnToolArgs,
  burn: {
    exposure: 50,
    range: 'midtones',
    size: 40,
    hardness: 100,
    points: [],
    toolName: 'burn',
  } satisfies DodgeBurnToolArgs,
  'clone-stamp': {
    size: 40,
    hardness: 100,
    alpha: 1,
    source: null,
    aligned: true,
    points: [],
    toolName: 'clone-stamp',
  } satisfies CloneStampToolArgs,
  brush: {
    alpha: 0.9,
    color: '#000000',
    penType: 'pen',
    lineWidth: 10,
    points: [],
    smoothing: PAINT_SMOOTHING_DEFAULT,
    blendMode: 'source-over',
    toolName: 'brush',
  } satisfies PaintToolArgs,
  pencil: {
    alpha: 0.9,
    color: '#000000',
    penType: 'pen',
    lineWidth: 3,
    points: [],
    smoothing: PAINT_SMOOTHING_DEFAULT,
    blendMode: 'source-over',
    toolName: 'pencil',
  } satisfies PaintToolArgs,
  'color-replacement': {
    alpha: 0.55,
    color: '#000000',
    penType: 'spray',
    lineWidth: 18,
    points: [],
    smoothing: PAINT_SMOOTHING_DEFAULT,
    blendMode: 'source-over',
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
  triangle: {
    ...savedArgsPerFigure['triangle'],
    figure: 'triangle',
    color: '#000000',
    backgroundColor: null,
    toolName: 'triangle',
  } satisfies ToolArgsByName['triangle'],
  polygon: {
    ...savedArgsPerFigure['polygon'],
    figure: 'polygon',
    color: '#000000',
    backgroundColor: null,
    toolName: 'polygon',
  } satisfies ToolArgsByName['polygon'],
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
  | PolygonSelectionToolSettings
  // A `*ToolSettings` member is the args type minus `points`, because a stroke is
  // geometry rather than a setting and `saveLastSettings` empties it. The plain args
  // types below have no `points` at all, so they are their own settings type. The eraser
  // is a brush like `smudge`/`dodge`/`burn`/`clone-stamp` — `EraserToolArgs.points` is
  // required, not optional — so it is spelled as an `Omit` here rather than as a named
  // `EraserToolSettings` the eraser does not have.
  | EyedropperToolArgs
  | EllipticalSelectionToolArgs
  | QuickSelectionToolArgs
  | Omit<EraserToolArgs, 'points'>
  | PaintBucketToolArgs
  | GradientToolArgs
  | SharpenToolArgs
  | SmudgeToolSettings
  | DodgeBurnToolSettings
  | CloneStampToolSettings;

export const lastSavedSettings: ToolArgsByName = cloneDeep(defaultSettings);
