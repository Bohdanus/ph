import type { BitmapSource, Pos, Size } from '../contexts/general-types.ts';
import type { ToolArgs, ToolName } from '../contexts/tool-types.ts';
import { blur } from './blur.ts';
import { colors } from './colors.ts';
import { colorReplacement } from './colorReplacement.ts';
import { crop } from './crop.ts';
import { draw, type DrawToolArgs } from './draw.ts';
import { eraser } from './eraser.ts';
import { featherMagneticLasso } from './featherMagneticLasso.ts';
import { levels } from './levels.ts';
import { magicEraser, paintBucket } from './fill.ts';
import { magicWand } from './magicWand.ts';
import { rectangularSelection } from './rectangularSelection.ts';
import { reposition } from './reposition.ts';
import { selection } from './selection.ts';
import { shape } from './shape.ts';
import { text } from './text.ts';
import { transform } from './transform.ts';

export type ProcessorToolParams = {
  size: Size;
  bitmap: BitmapSource;
};

export type CreatorToolParams = {
  size: Size;
};

export type ToolResult = [BitmapSource, Partial<Pos>?];

export type ToolReplayKind =
  | 'source'
  | 'layer-operation'
  | 'affine-operation'
  | 'geometry'
  | 'raster-processor'
  | 'document-operation'
  | 'selection'
  | 'unimplemented';

export type ToolCommitKind =
  | 'source'
  | 'layer-operation'
  | 'affine-operation'
  | 'geometry'
  | 'raster'
  | 'document-operation'
  | 'selection'
  | 'unimplemented';

export type ToolProcessorDefinition = {
  creator?: boolean;
  flattenRequired?: boolean;
  commit: ToolCommitKind;
  replay: Readonly<{
    kind: ToolReplayKind;
    deterministic: boolean;
    version: number;
    requiresRaster: boolean;
  }>;
  imageProcessor: (param: ProcessorToolParams | CreatorToolParams) => (args: ToolArgs) => ToolResult;
};

/**
 * Tools that rasterize nothing, commit no pixels and record no history state.
 *
 * The eyedropper belongs here and not under `commit: 'unimplemented'`: it is a working tool, not a
 * dead button. Adobe's rule is that a history state comes from a change to pixels, and sampling
 * changes only the app's foreground colour, so it has no `commit` kind, no `replay()` descriptor,
 * no `HistoryItem` and no durable operation. `unimplemented` cannot express that — it means "this
 * tool does not work yet", and it is read as exactly that by `src/components/Main/Main.tsx`'s tool
 * dispatch. Naming the set is also what lets a consumer of `toolProcessors` distinguish "this tool
 * has no processor" from "this tool name does not exist".
 */
export const PIXEL_FREE_TOOLS = ['eyedropper'] as const satisfies readonly ToolName[];

/** The tools that do have a processor, which is the registry's key set. */
export type PixelToolName = Exclude<ToolName, (typeof PIXEL_FREE_TOOLS)[number]>;

/**
 * The one place a `ToolName` is looked up by name, because the registry is keyed by
 * `PixelToolName` and a name from outside the registry is a real possibility: a history item or a
 * layer source can name any tool, and a pixel-free tool resolves to nothing. Every caller that
 * indexes `toolProcessors` with a dynamic name goes through here rather than casting at the
 * call site, so the one cast in the codebase for this is visible.
 */
export const findToolProcessor = (toolName: ToolName): ToolProcessorDefinition | undefined =>
  (toolProcessors as Partial<Record<ToolName, ToolProcessorDefinition>>)[toolName];

const buildDrawArgs = (args: ToolArgs, penType: 'pen' | 'spray', lineWidth?: number): DrawToolArgs =>
  ({
    ...(args as Partial<DrawToolArgs>),
    toolName: 'draw',
    penType,
    ...(lineWidth !== undefined ? { lineWidth } : {}),
  }) as DrawToolArgs;

const replay = (kind: ToolReplayKind, requiresRaster: boolean, deterministic = true) =>
  Object.freeze({ kind, deterministic, version: 1, requiresRaster });

/** The width `defaultSettings.pencil` seeds the pencil with (src/tools/settings.ts:126). */
const DEFAULT_PENCIL_LINE_WIDTH = 3;

const unimplemented = () => () => [null as never] as ToolResult;

export const toolProcessors: Record<PixelToolName, ToolProcessorDefinition> = {
  reposition: {
    commit: 'geometry',
    replay: replay('geometry', false),
    // @ts-expect-error Each processor narrows ToolArgs to its own registered name.
    imageProcessor: reposition,
  },
  blur: {
    commit: 'layer-operation',
    replay: replay('layer-operation', false),
    // @ts-expect-error Each processor narrows ToolArgs to its own registered name.
    imageProcessor: blur,
  },
  color: {
    commit: 'layer-operation',
    replay: replay('layer-operation', false),
    // @ts-expect-error Each processor narrows ToolArgs to its own registered name.
    imageProcessor: colors,
  },
  levels: {
    commit: 'layer-operation',
    replay: replay('layer-operation', false),
    // @ts-expect-error Each processor narrows ToolArgs to its own registered name.
    imageProcessor: levels,
  },
  transform: {
    // Non-trapezoid transforms are retained as affine operations. The
    // trapezoid value is explicitly handled as a raster boundary by the
    // layer preview/commit and replay paths.
    commit: 'affine-operation',
    replay: replay('affine-operation', false),
    // @ts-expect-error Each processor narrows ToolArgs to its own registered name.
    imageProcessor: transform,
  },
  crop: {
    commit: 'document-operation',
    replay: replay('document-operation', false),
    // @ts-expect-error Each processor narrows ToolArgs to its own registered name.
    imageProcessor: crop,
  },
  draw: {
    commit: 'source',
    creator: true,
    replay: replay('source', false),
    // @ts-expect-error Each processor narrows ToolArgs to its own registered name.
    imageProcessor: draw,
  },
  shape: { creator: true, commit: 'source', replay: replay('source', false), imageProcessor: shape },
  text: {
    commit: 'source',
    creator: true,
    replay: replay('source', false),
    // @ts-expect-error Each processor narrows ToolArgs to its own registered name.
    imageProcessor: text,
  },
  'polygonal-lasso': {
    commit: 'selection',
    creator: true,
    replay: replay('selection', false),
    // @ts-expect-error Each processor narrows ToolArgs to its own registered name.
    imageProcessor: selection,
  },
  'freehand-lasso': {
    commit: 'selection',
    creator: true,
    replay: replay('selection', false),
    // @ts-expect-error Each processor narrows ToolArgs to its own registered name.
    imageProcessor: selection,
  },
  'feather-magnetic-lasso': {
    commit: 'selection',
    replay: replay('selection', true),
    // @ts-expect-error Each processor narrows ToolArgs to its own registered name.
    imageProcessor: featherMagneticLasso,
  },
  'magic-wand': {
    commit: 'selection',
    replay: replay('selection', true),
    // @ts-expect-error Each processor narrows ToolArgs to its own registered name.
    imageProcessor: magicWand,
  },
  'rectangular-selection': {
    commit: 'selection',
    creator: true,
    replay: replay('selection', false),
    // @ts-expect-error Each processor narrows ToolArgs to its own registered name.
    imageProcessor: rectangularSelection,
  },
  brush: {
    commit: 'raster',
    replay: replay('raster-processor', true),
    imageProcessor: (params) => (args) => {
      const [canvas] = draw({ size: params.size } as CreatorToolParams)(buildDrawArgs(args, 'pen'));
      return [canvas];
    },
  },
  pencil: {
    commit: 'raster',
    replay: replay('raster-processor', true),
    imageProcessor: (params) => (args) => {
      // `??` guards only `undefined` and `null`, so a non-numeric string reaches
      // `Number` as NaN — and `Math.max(1, NaN)` is NaN, which the canvas ignores
      // in favour of a width it picks itself. Only a finite width may reach the clamp.
      const width = Number((args as Partial<DrawToolArgs>).lineWidth ?? DEFAULT_PENCIL_LINE_WIDTH);
      const lineWidth = Number.isFinite(width) ? Math.max(1, width) : DEFAULT_PENCIL_LINE_WIDTH;
      const [canvas] = draw({ size: params.size } as CreatorToolParams)(buildDrawArgs(args, 'pen', lineWidth));
      return [canvas];
    },
  },
  'color-replacement': {
    commit: 'raster',
    replay: replay('raster-processor', true),
    // No `@ts-expect-error` here, unlike the entries above it: `colorReplacement` narrows its
    // params to the registry's own union and its args to the registry's own `ToolArgs`, so the
    // signature already matches without a cast. That is what a real processor looks like.
    imageProcessor: colorReplacement,
  },
  eraser: {
    commit: 'raster',
    replay: replay('raster-processor', true),
    imageProcessor: (params) => (args) => eraser(params)(args),
  },
  'magic-eraser': {
    commit: 'raster',
    replay: replay('raster-processor', true),
    imageProcessor: (params) => (args) => magicEraser(params)(args),
  },
  'paint-bucket': {
    commit: 'raster',
    replay: replay('raster-processor', true),
    imageProcessor: (params) => (args) => paintBucket(params)(args),
  },
  pen: { commit: 'unimplemented', replay: replay('unimplemented', false, false), imageProcessor: unimplemented },
  'freeform-pen': {
    commit: 'unimplemented',
    replay: replay('unimplemented', false, false),
    imageProcessor: unimplemented,
  },
  'curvature-pen': {
    commit: 'unimplemented',
    replay: replay('unimplemented', false, false),
    imageProcessor: unimplemented,
  },
  'add-anchor-point': {
    commit: 'unimplemented',
    replay: replay('unimplemented', false, false),
    imageProcessor: unimplemented,
  },
  'delete-anchor-point': {
    commit: 'unimplemented',
    replay: replay('unimplemented', false, false),
    imageProcessor: unimplemented,
  },
  'convert-point': {
    commit: 'unimplemented',
    replay: replay('unimplemented', false, false),
    imageProcessor: unimplemented,
  },
  rectangle: { creator: true, commit: 'source', replay: replay('source', false), imageProcessor: shape },
  ellipse: { creator: true, commit: 'source', replay: replay('source', false), imageProcessor: shape },
  triangle: { creator: true, commit: 'source', replay: replay('source', false), imageProcessor: shape },
  polygon: { creator: true, commit: 'source', replay: replay('source', false), imageProcessor: shape },
  line: { creator: true, commit: 'source', replay: replay('source', false), imageProcessor: shape },
  'custom-shape': {
    commit: 'unimplemented',
    replay: replay('unimplemented', false, false),
    imageProcessor: unimplemented,
  },
};
