import type { BitmapSource, Pos, Size } from '../contexts/general-types.ts';
import type { ToolArgs, ToolName } from '../contexts/tool-types.ts';
import { blur } from './blur.ts';
import { cloneStamp } from './cloneStamp.ts';
import { redEye } from './redEye.ts';
import { spotHealing } from './spotHealing.ts';
import { healingBrush } from './healingBrush.ts';
import { patch } from './patch.ts';
import { colors } from './colors.ts';
import { colorReplacement } from './colorReplacement.ts';
import { crop } from './crop.ts';
import { burn, dodge } from './dodgeBurn.ts';
import { draw, type DrawToolArgs } from './draw.ts';
import { ellipticalSelection } from './ellipticalSelection.ts';
import { eraser } from './eraser.ts';
import { featherMagneticLasso } from './featherMagneticLasso.ts';
import { gradient } from './gradient.ts';
import { levels } from './levels.ts';
import { magicEraser, paintBucket } from './fill.ts';
import { magicWand } from './magicWand.ts';
import { quickSelection } from './quickSelection.ts';
import { rectangularSelection } from './rectangularSelection.ts';
import { reposition } from './reposition.ts';
import { selection } from './selection.ts';
import { shape } from './shape.ts';
import { sharpen } from './sharpen.ts';
import { smudge } from './smudge.ts';
import { sponge } from './sponge.ts';
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
  /**
   * Whether the processor reads the existing layer bitmap before producing its
   * raster result. Omitted means true; draw-backed paint processors are the
   * explicit exceptions because they create a fresh canvas from their stroke.
   */
  compositesOntoInput?: boolean;
  /**
   * The tool's pixels or its retained presentation depend on `CanvasRenderingContext2D.filter`,
   * which is not Baseline: caniuse records Safari 3.1 - 17.6 as unsupported (WebKit bug 198416,
   * since resolved) and MDN states the feature is not Baseline. Set this on every such tool so the
   * refusal in `src/util/canvas-filter.ts` has one place to read the answer from.
   */
  requiresCanvasFilter?: boolean;
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
 *
 * The Ruler is the second member, and it earns the set by the same rule rather than by affinity
 * with the Eyedropper. Adobe describes the measuring line as a **nonprinting** line and gives its
 * removal as dragging it out of the image or clicking Clear — not as undoing an edit — so a
 * measurement changes no pixel and there is nothing for a history state to restore. `HANDOFF.md`
 * §74 groups it as the measurement band "because these are `PIXEL_FREE_TOOLS` like the Eyedropper,
 * committing no pixels and needing no durable operation", and that decision is the app-side answer
 * to a question Adobe never states outright.
 *
 * The Color Sampler is the third, on Adobe's own one-line description: "Color Sampler tool |
 * Displays color values for up to four areas." It displays rather than edits, so the pixels under a
 * sampler are unchanged by its existence and a sample is not a document fact. It reads a pixel the
 * way the Eyedropper does and writes it to a module store rather than to the foreground swatch, and
 * neither difference gives it a `commit` kind.
 * <https://helpx.adobe.com/photoshop/desktop/apply-painting-techniques/fill-objects-selections-layers/painting-tools-overview.html>
 */
export const PIXEL_FREE_TOOLS = [
  'eyedropper',
  'ruler',
  'color-sampler',
  'hand',
  'zoom',
  'rotate-view',
] as const satisfies readonly ToolName[];

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
    requiresCanvasFilter: true,
    commit: 'layer-operation',
    replay: replay('layer-operation', false),
    // @ts-expect-error Each processor narrows ToolArgs to its own registered name.
    imageProcessor: blur,
  },
  color: {
    requiresCanvasFilter: true,
    commit: 'layer-operation',
    replay: replay('layer-operation', false),
    // @ts-expect-error Each processor narrows ToolArgs to its own registered name.
    imageProcessor: colors,
  },
  levels: {
    requiresCanvasFilter: true,
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
    replay: replay('selection', true),
    // @ts-expect-error Each processor narrows ToolArgs to its own registered name.
    imageProcessor: selection,
  },
  'freehand-lasso': {
    commit: 'selection',
    replay: replay('selection', true),
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
    replay: replay('selection', true),
    // @ts-expect-error Each processor narrows ToolArgs to its own registered name.
    imageProcessor: rectangularSelection,
  },
  // The Photoshop focus family below, plus the tonal tools, are all `commit: 'raster'`
  // and therefore all get durable shadow support with no durable code of their own:
  // `history-adapter.ts:416-424` converts ANY `commit: 'raster'` tool into an
  // `apply-raster-processor` operation keyed on `args.toolName`, with no allowlist to
  // extend. A new raster tool is replayable in the shadow document the day it is
  // registered here.
  'elliptical-selection': {
    commit: 'selection',
    replay: replay('selection', true),
    // @ts-expect-error Each processor narrows ToolArgs to its own registered name.
    imageProcessor: ellipticalSelection,
  },
  // The 1-pixel marquees are the Rectangular Marquee's processor verbatim: it is a
  // pass-through that returns the document bitmap untouched, because a selection is
  // geometry in the store and no pixels at all (`rectangularSelection.ts:9`-`:13`).
  // Two separate `replay(...)` calls rather than one shared result, because
  // `tool-processors.test.ts:1036` requires a distinct frozen descriptor per tool.
  'single-row-marquee': {
    commit: 'selection',
    replay: replay('selection', true),
    // @ts-expect-error Each processor narrows ToolArgs to its own registered name.
    imageProcessor: rectangularSelection,
  },
  'single-column-marquee': {
    commit: 'selection',
    replay: replay('selection', true),
    // @ts-expect-error Each processor narrows ToolArgs to its own registered name.
    imageProcessor: rectangularSelection,
  },
  'quick-selection': {
    commit: 'selection',
    replay: replay('selection', true),
    // @ts-expect-error Each processor narrows ToolArgs to its own registered name.
    imageProcessor: quickSelection,
  },
  gradient: {
    commit: 'raster',
    replay: replay('raster-processor', true),
    // @ts-expect-error Each processor narrows ToolArgs to its own registered name.
    imageProcessor: gradient,
  },
  sharpen: {
    commit: 'raster',
    replay: replay('raster-processor', true),
    // @ts-expect-error Each processor narrows ToolArgs to its own registered name.
    imageProcessor: sharpen,
  },
  smudge: {
    commit: 'raster',
    replay: replay('raster-processor', true),
    // @ts-expect-error Each processor narrows ToolArgs to its own registered name.
    imageProcessor: smudge,
  },
  dodge: {
    commit: 'raster',
    replay: replay('raster-processor', true),
    // @ts-expect-error Each processor narrows ToolArgs to its own registered name.
    imageProcessor: dodge,
  },
  burn: {
    commit: 'raster',
    replay: replay('raster-processor', true),
    // @ts-expect-error Each processor narrows ToolArgs to its own registered name.
    imageProcessor: burn,
  },
  // The Sponge rides the same generic durable arm as the Dodge and the Burn:
  // `src/contexts/history-adapter.ts` maps any `commit: 'raster'` processor to an
  // `apply-raster-processor` operation with `processorId: args.toolName` and no allowlist,
  // so registering the tool here is the whole of what undoability costs. Its own function
  // reference is required, not optional — the identity test in
  // `src/tools/__tests__/tool-processors.test.ts` allows a shared processor only where two
  // names are one operation (`selection`, `shape`).
  sponge: {
    commit: 'raster',
    replay: replay('raster-processor', true),
    // @ts-expect-error Each processor narrows ToolArgs to its own registered name.
    imageProcessor: sponge,
  },
  'clone-stamp': {
    commit: 'raster',
    replay: replay('raster-processor', true),
    // @ts-expect-error Each processor narrows ToolArgs to its own registered name.
    imageProcessor: cloneStamp,
  },
  'red-eye': {
    commit: 'raster',
    replay: replay('raster-processor', true),
    // @ts-expect-error Each processor narrows ToolArgs to its own registered name.
    imageProcessor: redEye,
  },
  'spot-healing': {
    commit: 'raster',
    replay: replay('raster-processor', true),
    // @ts-expect-error Each processor narrows ToolArgs to its own registered name.
    imageProcessor: spotHealing,
  },
  'healing-brush': {
    commit: 'raster',
    replay: replay('raster-processor', true),
    // @ts-expect-error Each processor narrows ToolArgs to its own registered name.
    imageProcessor: healingBrush,
  },
  patch: {
    commit: 'raster',
    replay: replay('raster-processor', true),
    // @ts-expect-error Each processor narrows ToolArgs to its own registered name.
    imageProcessor: patch,
  },
  brush: {
    commit: 'raster',
    creator: true,
    replay: replay('raster-processor', true),
    imageProcessor: (params) => (args) => {
      const [canvas] = draw(params)(buildDrawArgs(args, 'pen'));
      return [canvas];
    },
  },
  pencil: {
    commit: 'raster',
    creator: true,
    replay: replay('raster-processor', true),
    imageProcessor: (params) => (args) => {
      // `??` guards only `undefined` and `null`, so a non-numeric string reaches
      // `Number` as NaN — and `Math.max(1, NaN)` is NaN, which the canvas ignores
      // in favour of a width it picks itself. Only a finite width may reach the clamp.
      const width = Number((args as Partial<DrawToolArgs>).lineWidth ?? DEFAULT_PENCIL_LINE_WIDTH);
      const lineWidth = Number.isFinite(width) ? Math.max(1, width) : DEFAULT_PENCIL_LINE_WIDTH;
      const [canvas] = draw(params)(buildDrawArgs(args, 'pen', lineWidth));
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
