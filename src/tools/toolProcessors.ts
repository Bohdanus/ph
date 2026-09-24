import type { BitmapSource, Pos, Size } from '../contexts/general-types.ts';
import type { ToolArgs, ToolName } from '../contexts/tool-types.ts';
import { blur } from './blur.ts';
import { colors } from './colors.ts';
import { crop } from './crop.ts';
import { draw, type DrawToolArgs } from './draw.ts';
import { featherMagneticLasso } from './featherMagneticLasso.ts';
import { levels } from './levels.ts';
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

const buildDrawArgs = (args: ToolArgs, penType: 'pen' | 'spray', lineWidth?: number): DrawToolArgs =>
  ({
    ...(args as Partial<DrawToolArgs>),
    toolName: 'draw',
    penType,
    ...(lineWidth !== undefined ? { lineWidth } : {}),
  }) as DrawToolArgs;

const replay = (kind: ToolReplayKind, requiresRaster: boolean, deterministic = true) =>
  Object.freeze({ kind, deterministic, version: 1, requiresRaster });

const unimplemented = () => () => [null as never] as ToolResult;

export const toolProcessors: Record<ToolName, ToolProcessorDefinition> = {
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
      const [canvas] = draw({ size: params.size } as CreatorToolParams)(
        buildDrawArgs(args, 'pen', Math.max(1, Number((args as Partial<DrawToolArgs>).lineWidth ?? 3)))
      );
      return [canvas];
    },
  },
  'color-replacement': {
    commit: 'raster',
    replay: replay('raster-processor', true),
    imageProcessor: (params) => (args) => {
      const [canvas] = draw({ size: params.size } as CreatorToolParams)(buildDrawArgs(args, 'spray'));
      return [canvas];
    },
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
  rectangle: { commit: 'source', replay: replay('source', false), imageProcessor: shape },
  ellipse: { commit: 'source', replay: replay('source', false), imageProcessor: shape },
  triangle: { creator: true, commit: 'source', replay: replay('source', false), imageProcessor: shape },
  polygon: { creator: true, commit: 'source', replay: replay('source', false), imageProcessor: shape },
  line: { commit: 'source', replay: replay('source', false), imageProcessor: shape },
  'custom-shape': {
    commit: 'unimplemented',
    replay: replay('unimplemented', false, false),
    imageProcessor: unimplemented,
  },
};
