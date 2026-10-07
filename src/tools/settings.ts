import { cloneDeep } from 'lodash-es';

import type { DrawToolSettings, DrawToolArgs, PaintToolArgs, PenType } from './draw.ts';
import type { TextToolArgs, TextToolSettings } from './text.ts';
import { AUTO_LEADING } from './text.ts';
import type { CropToolArgs } from './crop.ts';
import type { TransformToolArgs } from './transform.ts';
import type { ColorsToolArgs } from './colors.ts';
import type { LevelsToolArgs } from './levels.ts';
import type { BlurToolArgs } from './blur.ts';
import { DEFAULT_POLYGON_SIDES, DEFAULT_STAR_RATIO } from './shape.ts';
import type { FigureType, ShapeToolSettings, ShapeToolArgs } from './shape.ts';
import type { ToolArgsByName } from '../contexts/tool-types.ts';
import type { RepositionToolArgs } from './reposition.ts';
import type { LassoToolArgs, PolygonSelectionToolSettings } from './polygonSelection.ts';
import type { RectangularSelectionToolArgs } from './rectangularSelection.ts';
import type { SingleColumnMarqueeToolArgs, SingleRowMarqueeToolArgs } from './singleRowColumnMarquee.ts';
import type { FeatherMagneticLassoToolArgs, FeatherMagneticLassoToolSettings } from './featherMagneticLasso.ts';
import type { MagicWandToolArgs, MagicWandToolSettings } from './magicWand.ts';
import { ERASER_HARDNESS_DEFAULT, ERASER_SPACING_PERCENT, type EraserToolArgs } from './eraser.ts';
import type { FillToolArgs } from './fill.ts';
import {
  COLOR_REPLACEMENT_SMOOTHNESS_DEFAULT,
  COLOR_REPLACEMENT_TOLERANCE_DEFAULT,
  type ColorReplacementToolArgs,
} from './colorReplacement.ts';
import type { EyedropperToolArgs } from './eyedropper.ts';
import type { ColorSamplerToolArgs } from './colorSampler.ts';
import type { RulerToolArgs } from './ruler.ts';
import type { EllipticalSelectionToolArgs } from './ellipticalSelection.ts';
import type { QuickSelectionToolArgs } from './quickSelection.ts';
import type { GradientToolArgs } from './gradient.ts';
import type { SharpenToolArgs } from './sharpen.ts';
import { PAINT_SMOOTHING_DEFAULT } from './brush.ts';
import type { SmudgeToolArgs, SmudgeToolSettings } from './smudge.ts';
import type { DodgeBurnToolArgs, DodgeBurnToolSettings } from './dodgeBurn.ts';
import { SPONGE_FLOW_DEFAULT, SPONGE_MODE_DEFAULT, type SpongeToolArgs, type SpongeToolSettings } from './sponge.ts';
import type { CloneStampToolArgs, CloneStampToolSettings } from './cloneStamp.ts';
import {
  RED_EYE_DEFAULT_DARKEN_AMOUNT,
  RED_EYE_DEFAULT_PUPIL_SIZE,
  type RedEyeToolArgs,
  type RedEyeToolSettings,
} from './redEye.ts';

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
  polygon: {
    alpha: 1,
    lineWidth: 5,
    // Adobe's Polygon tool seeds Sides at 5. Seeding it here rather than defaulting at the
    // call site means the options bar has something to show on first open, for the same reason
    // the eraser seeds `mode` and its tip width a few hundred lines down: a settings object
    // that arrives without the key is an object the bar has nothing to show.
    sides: DEFAULT_POLYGON_SIDES,
    toolMode: 'shape',
  },
  star: {
    alpha: 1,
    lineWidth: 5,
    // Adobe publishes the Star Ratio control but not its initial value. 50% is an app decision
    // matching the conventional five-point polygon star used by this shape family.
    sides: DEFAULT_POLYGON_SIDES,
    starRatio: DEFAULT_STAR_RATIO,
    toolMode: 'shape',
  },
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
    // Keep the shared shape args safe when the generic shape tool is switched directly to Star.
    sides: DEFAULT_POLYGON_SIDES,
    starRatio: DEFAULT_STAR_RATIO,
    figure: 'rectangle',
    color: '#000000',
    backgroundColor: null,
    toolName: 'shape',
  } satisfies ShapeToolArgs,
  text: {
    text: '',
    fontSize: 64,
    lineHeight: AUTO_LEADING,
    fontFamily: 'Arial',
    color: '#000000',
    rect: null,
    align: 'left',
    bold: false,
    italic: false,
    allCaps: false,
    smallCaps: false,
    strikethrough: false,
    tracking: 0,
    underline: false,
    kind: 'point',

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
    contiguous: true,
    toolName: 'magic-wand',
  } satisfies MagicWandToolArgs,
  'rectangular-selection': { toolName: 'rectangular-selection' } satisfies RectangularSelectionToolArgs,
  // No settings at all, which is a statement about Photoshop and not a shortcut: the
  // options bar for both of these carries no Style, no Width/Height and no Anti-alias,
  // because Adobe scopes all three to the Rectangular and Elliptical Marquees by name.
  'single-row-marquee': { toolName: 'single-row-marquee' } satisfies SingleRowMarqueeToolArgs,
  'single-column-marquee': {
    toolName: 'single-column-marquee',
  } satisfies SingleColumnMarqueeToolArgs,
  brush: {
    alpha: 0.9,
    color: '#000000',
    penType: 'pen',
    lineWidth: 10,
    points: [],
    // Smoothing and Mode are the Photoshop options-bar settings the paint panel owns. `Mode`
    // defaults to Normal, so it composites exactly as the `draw`-backed brush did before the
    // panel existed. `smoothing` does NOT: it defaults to 10, Photoshop's own default, so a
    // brush stroke is now smoothed by 10% where it used to be unsmoothed. That is the
    // intended behaviour, not an identity — `smoothStrokePoints` returns the same array
    // instance at 0, which is what keeps the legacy `draw` tool's recorded baselines exact,
    // and `draw` has no `smoothing` key at all so it reads `?? 0` and is untouched.
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
    // Smoothing and Mode are the Photoshop options-bar settings the paint panel owns. `Mode`
    // defaults to Normal, so it composites exactly as the `draw`-backed brush did before the
    // panel existed. `smoothing` does NOT: it defaults to 10, Photoshop's own default, so a
    // brush stroke is now smoothed by 10% where it used to be unsmoothed. That is the
    // intended behaviour, not an identity — `smoothStrokePoints` returns the same array
    // instance at 0, which is what keeps the legacy `draw` tool's recorded baselines exact,
    // and `draw` has no `smoothing` key at all so it reads `?? 0` and is untouched.
    smoothing: PAINT_SMOOTHING_DEFAULT,
    blendMode: 'source-over',
    toolName: 'pencil',
  } satisfies PaintToolArgs,
  'color-replacement': {
    alpha: 1,
    lineWidth: 18,
    color: '#000000',
    tolerance: COLOR_REPLACEMENT_TOLERANCE_DEFAULT,
    limits: 'contiguous',
    sampling: 'current-layer',
    smoothness: COLOR_REPLACEMENT_SMOOTHNESS_DEFAULT,
    sampleColor: null,
    points: [],
    // No `smoothing` and no `blendMode` here, and their absence is the narrowing rather than an
    // omission. The paint panel owns both, and this tool has left that panel: its `smoothness`
    // above is a different control (the softening of the brush's coverage rim), it never
    // rasterizes through `drawPen`, and it substitutes pixels inside the ACTIVE layer rather than
    // compositing a new one, so there is nothing for a per-stroke blend mode to composite. Both
    // keys arrived here by merge from the paint tranche, which still listed this tool as a paint.
    toolName: 'color-replacement',
  } satisfies ColorReplacementToolArgs,
  eraser: {
    // `brush`, not `pencil`: Photoshop's eraser opens on a soft tip, and this one used to open on
    // a hard edge because `brush` was rendered `disabled` in the options bar. The two tip fields
    // below are what that mode reads, so they are seeded here rather than defaulted at the call
    // site — a settings object that arrives without them is a settings object the bar cannot show.
    mode: 'brush',
    lineWidth: 40,
    alpha: 1,
    hardness: ERASER_HARDNESS_DEFAULT,
    spacing: ERASER_SPACING_PERCENT,
    color: '#000000',
    points: [],
    toolName: 'eraser',
  } satisfies EraserToolArgs,
  'magic-eraser': {
    tolerance: 32,
    contiguous: true,
    alpha: 1,
    color: '#000000',
    pos: { x: 0, y: 0 },
    toolName: 'magic-eraser',
  } satisfies FillToolArgs,
  'paint-bucket': {
    tolerance: 32,
    contiguous: true,
    alpha: 1,
    color: '#000000',
    pos: { x: 0, y: 0 },
    toolName: 'paint-bucket',
  } satisfies FillToolArgs,
  eyedropper: {
    sampleSize: 1,
    sampleAllLayers: false,
    toolName: 'eyedropper',
  } satisfies EyedropperToolArgs,
  // The Color Sampler's only setting is the Sample Size it shares with the Eyedropper, seeded to
  // Point Sample because that is the footprint Adobe's own worked examples use and the one that
  // reports a pixel rather than a neighbourhood. The samplers are NOT seeded here: they are placed by
  // gesture and dropped when the document frame size changes, which is view state rather than
  // document state (see `PIXEL_FREE_TOOLS` in toolProcessors.ts).
  'color-sampler': {
    sampleSize: 1,
    toolName: 'color-sampler',
  } satisfies ColorSamplerToolArgs,
  // The Ruler has no settings to seed: every number it reports belongs to the gesture that produced
  // it rather than to a choice the user made, so the args object is the tool's name and nothing
  // else. The measuring line itself is deliberately not here — it is view state, not document state
  // (see `PIXEL_FREE_TOOLS` in toolProcessors.ts).
  ruler: { toolName: 'ruler' } satisfies RulerToolArgs,
  hand: { toolName: 'hand' },
  zoom: { toolName: 'zoom' },
  'rotate-view': { toolName: 'rotate-view' },
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
  // Flow seeds at the midpoint and Vibrance at ON. Both are choices Adobe declines to
  // document — its Mode and Flow pages are imperative throughout — so the reasoning and the
  // search that failed to corroborate them live at `SPONGE_MODE_DEFAULT` in
  // `src/tools/sponge.ts`, and the gap is recorded in `HANDOFF.md` rather than in
  // `docs/OVERRIDES.md`, which no agent may write.
  sponge: {
    mode: SPONGE_MODE_DEFAULT,
    flow: SPONGE_FLOW_DEFAULT,
    vibrance: true,
    size: 40,
    hardness: 100,
    points: [],
    toolName: 'sponge',
  } satisfies SpongeToolArgs,
  'clone-stamp': {
    size: 40,
    hardness: 100,
    alpha: 1,
    source: null,
    aligned: true,
    points: [],
    toolName: 'clone-stamp',
  } satisfies CloneStampToolArgs,
  'red-eye': {
    pupilSize: RED_EYE_DEFAULT_PUPIL_SIZE,
    darkenAmount: RED_EYE_DEFAULT_DARKEN_AMOUNT,
    point: null,
    toolName: 'red-eye',
  } satisfies RedEyeToolArgs,
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
  | EllipticalSelectionToolArgs
  | QuickSelectionToolArgs
  | GradientToolArgs
  | SharpenToolArgs
  // The three stroke tools below persist as a settings type, not as their args type: their
  // `points` array is stroke geometry rather than a setting, and it is emptied again by
  // `saveLastSettings` on every persist.
  | SmudgeToolSettings
  | DodgeBurnToolSettings
  | SpongeToolSettings
  | CloneStampToolSettings
  | RedEyeToolSettings;

export const lastSavedSettings: ToolArgsByName = cloneDeep(defaultSettings);
