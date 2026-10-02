import type { AffineTransform } from './affine-transform.ts';
import {
  getAffineBounds,
  IDENTITY_AFFINE_TRANSFORM,
  isIdentityAffineTransform,
  multiplyAffineTransforms,
} from './affine-transform.ts';
import type { DocumentFrame } from './document-frame.ts';
import type { BitmapSource, Pos, Size } from './general-types.ts';
import { buildColorsFilter, buildLevelsFilter } from '../tools/functions.ts';

export type PresentationFilterToolName = 'blur' | 'color' | 'levels';

export type PresentationFilterOperation = Readonly<{
  kind: 'filter';
  toolName: PresentationFilterToolName;
  args: Readonly<Record<string, unknown>>;
}>;

export type PresentationAffineOperation = Readonly<{
  kind: 'affine-transform';
  transform: AffineTransform;
}>;

export type PresentationOperation = PresentationFilterOperation | PresentationAffineOperation;

export type PresentationBoundsMode = 'layer-bounds' | 'frame-bounds';

export type PresentationEvaluationInput = Readonly<{
  position: Pos;
  sourceSize: Size;
  operations: readonly PresentationOperation[];
  frame?: DocumentFrame;
  mode?: PresentationBoundsMode;
}>;

export type PresentationEvaluation = Readonly<{
  mode: PresentationBoundsMode;
  position: Pos;
  sourceSize: Size;
  affine: AffineTransform;
  filter: string;
  /** The post-affine extent in layer-local coordinates. */
  localBounds: Pos;
  /** Layer-space bounds, or the requested document frame in frame-bounds mode. */
  bounds: Pos;
}>;

export type PresentationDrawTarget =
  Readonly<{ kind: 'document'; frame?: DocumentFrame }> | Readonly<{ kind: 'bounds' }>;

/**
 * Scales a vector creator's coordinates from its recorded source rectangle to
 * the layer's current presentation rectangle. The whole argument object is
 * retained so newly-added creator arguments cannot silently disappear.
 */
export function scaleVectorArgs<T extends Record<string, unknown>>(
  args: T,
  sourcePos: Pos | undefined,
  position: Pos
): T {
  if (!sourcePos || !args.start || !args.end) return args;

  const scaleX = position.width / sourcePos.width;
  const scaleY = position.height / sourcePos.height;
  const lineWidth = 'lineWidth' in args ? (args.lineWidth as number) * Math.sqrt(Math.abs(scaleX * scaleY)) : undefined;

  return {
    ...args,
    start: {
      x: (args.start as { x: number; y: number }).x * scaleX,
      y: (args.start as { x: number; y: number }).y * scaleY,
    },
    end: {
      x: (args.end as { x: number; y: number }).x * scaleX,
      y: (args.end as { x: number; y: number }).y * scaleY,
    },
    ...(lineWidth === undefined ? {} : { lineWidth }),
  } as T;
}

function filterForOperation(operation: PresentationFilterOperation): string {
  const args = operation.args;
  switch (operation.toolName) {
    case 'blur':
      return `blur(${args.radius ?? 0}px)`;
    case 'color':
      return buildColorsFilter({
        ...args,
        grayscale: args.grayscale ?? 0,
        sepia: args.sepia ?? 0,
        saturation: args.saturation ?? 0,
      } as never);
    case 'levels':
      return buildLevelsFilter({
        ...args,
        brightness: args.brightness ?? 0,
        contrast: args.contrast ?? 0,
      } as never);
  }
}

export function getPresentationFilter(operations: readonly PresentationOperation[]): string {
  const filters = operations
    .filter((operation): operation is PresentationFilterOperation => operation.kind === 'filter')
    .map(filterForOperation);
  return filters.length ? filters.join(' ') : 'none';
}

export function getPresentationAffine(operations: readonly PresentationOperation[]): AffineTransform {
  let transform = IDENTITY_AFFINE_TRANSFORM;
  for (const operation of operations) {
    if (operation.kind !== 'affine-transform') continue;
    transform = multiplyAffineTransforms(operation.transform, transform);
  }
  return transform;
}

export function evaluatePresentation(input: PresentationEvaluationInput): PresentationEvaluation {
  const mode = input.mode ?? 'layer-bounds';
  const affine = getPresentationAffine(input.operations);
  const localBounds = getAffineBounds(affine, input.sourceSize);
  if (mode === 'frame-bounds') {
    if (!input.frame) throw new Error('A document frame is required for frame-bounds presentation evaluation');
    return Object.freeze({
      mode,
      position: input.position,
      sourceSize: input.sourceSize,
      affine,
      filter: getPresentationFilter(input.operations),
      localBounds,
      bounds: { ...input.frame },
    });
  }

  return Object.freeze({
    mode,
    position: input.position,
    sourceSize: input.sourceSize,
    affine,
    filter: getPresentationFilter(input.operations),
    localBounds,
    bounds: {
      x: input.position.x + localBounds.x,
      y: input.position.y + localBounds.y,
      width: localBounds.width,
      height: localBounds.height,
    },
  });
}

/**
 * Draws an already-evaluated presentation without allocating a surface. The
 * caller chooses the target coordinate space; staging, publishing, and cache
 * ownership stay outside this module.
 */
export function drawEvaluatedPresentation(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  bitmap: BitmapSource,
  evaluation: PresentationEvaluation,
  target: PresentationDrawTarget
): void {
  const x = target.kind === 'bounds' ? -evaluation.localBounds.x : evaluation.position.x - (target.frame?.x ?? 0);
  const y = target.kind === 'bounds' ? -evaluation.localBounds.y : evaluation.position.y - (target.frame?.y ?? 0);

  ctx.filter = evaluation.filter;
  if (isIdentityAffineTransform(evaluation.affine)) {
    ctx.drawImage(bitmap as CanvasImageSource, x, y, evaluation.sourceSize.width, evaluation.sourceSize.height);
    return;
  }

  ctx.translate(x, y);
  ctx.transform(
    evaluation.affine.a,
    evaluation.affine.b,
    evaluation.affine.c,
    evaluation.affine.d,
    evaluation.affine.e,
    evaluation.affine.f
  );
  ctx.drawImage(bitmap as CanvasImageSource, 0, 0, evaluation.sourceSize.width, evaluation.sourceSize.height);
}
