import type { AffineTransform } from './affine-transform.ts';
import {
  getAffineBounds,
  IDENTITY_AFFINE_TRANSFORM,
  isIdentityAffineTransform,
  multiplyAffineTransforms,
  transformCorners,
} from './affine-transform.ts';
import type { DocumentFrame } from './document-frame.ts';
import type { BitmapSource, Pos, Size } from './general-types.ts';
import type { Layer, LayerOperation } from './layer-types.ts';
import { FilterArgumentUnrenderableError } from '../util/canvas-filter.ts';
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
  // `typeof`, not `'lineWidth' in args`: a present key is not a numeric one, and multiplying
  // a JSON-round-tripped string yields NaN, which then becomes a stroke width.
  const lineWidth =
    typeof args.lineWidth === 'number' ? args.lineWidth * Math.sqrt(Math.abs(scaleX * scaleY)) : undefined;

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

/**
 * Scales retained text creator arguments from their recorded source rectangle to the layer's
 * current presentation rectangle. Text is not a vector tool at runtime, but durable materialization
 * re-runs its creator and must apply the same geometry contract as vector sources.
 */
export function scaleTextArgs<T extends Record<string, unknown>>(
  args: T,
  sourcePos: Pos | undefined,
  position: Pos
): T {
  if (!sourcePos || sourcePos.width <= 0 || sourcePos.height <= 0) return args;

  const scaleX = position.width / sourcePos.width;
  const scaleY = position.height / sourcePos.height;
  const fontScale = Math.sqrt(Math.abs(scaleX * scaleY));
  const scaled = { ...args } as T & {
    fontSize?: number;
    rect?: { x1: number; y1: number; x2: number; y2: number } | null;
  };

  if (typeof scaled.fontSize === 'number') scaled.fontSize *= fontScale;
  if (scaled.rect) {
    scaled.rect = {
      x1: scaled.rect.x1 * scaleX,
      y1: scaled.rect.y1 * scaleY,
      x2: scaled.rect.x2 * scaleX,
      y2: scaled.rect.y2 * scaleY,
    };
  }
  return scaled;
}

/**
 * Reads one numeric field of a filter operation the way a JSON round trip would, and refuses
 * a value that does not become one.
 *
 * `args` is a `PlainObject` on the durable side, so any adjustment can legitimately be
 * something other than a JS number at the type level — a JSON-round-tripped string, a boolean.
 * Such a raw value used to reach the CSS template verbatim, and a browser DISCARDS an invalid
 * `ctx.filter` assignment outright rather than applying its valid part: one bad field dropped
 * the whole stack and the layer drew COMPLETELY unfiltered — the silent no-op
 * `requireCanvasFilter` exists to prevent, reached without ever running its capability probe.
 * Coercion is what a round trip does; the refusal is what keeps a value that does not become
 * a number from becoming one, and it is per layer rather than per document so it costs the
 * layer that carries it and nothing else.
 */
function numericFilterArg(operation: PresentationFilterOperation, field: string): number {
  const raw = operation.args[field];
  if (raw === undefined || raw === null) return 0;
  const value = Number(raw);
  if (Number.isFinite(value)) return value;
  throw new FilterArgumentUnrenderableError(operation.toolName, field, raw);
}

function filterForOperation(operation: PresentationFilterOperation): string {
  switch (operation.toolName) {
    case 'blur':
      return `blur(${numericFilterArg(operation, 'radius')}px)`;
    case 'color':
      // The builders consume exactly these fields, so exactly these are coerced — and naming
      // them is what removes the `as never` the whole-args spread needed.
      return buildColorsFilter({
        grayscale: numericFilterArg(operation, 'grayscale'),
        sepia: numericFilterArg(operation, 'sepia'),
        saturation: numericFilterArg(operation, 'saturation'),
      });
    case 'levels':
      return buildLevelsFilter({
        brightness: numericFilterArg(operation, 'brightness'),
        contrast: numericFilterArg(operation, 'contrast'),
      });
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

/**
 * The post-affine extent with the two raster CAPS omitted and the degenerate case kept.
 *
 * The same arithmetic, and the same refusal, as `getAffineBounds` — a non-finite or
 * non-positive extent is a defect in the layer's own matrix and no target wants it. What it
 * does not do is check `MAX_AFFINE_COORDINATE` or `MAX_AFFINE_PIXELS`; `evaluatePresentationForDraw`
 * is its only caller and carries the argument for dropping them.
 */
function uncappedAffineBounds(affine: AffineTransform, sourceSize: Size): Pos {
  const corners = transformCorners(affine, sourceSize);
  const xs = corners.map(({ x }) => x);
  const ys = corners.map(({ y }) => y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  const width = Math.max(...xs) - x;
  const height = Math.max(...ys) - y;

  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
    throw new Error('Affine transform produced degenerate bounds');
  }
  return { x, y, width, height };
}

function assemblePresentation(
  input: PresentationEvaluationInput,
  mode: PresentationBoundsMode,
  affine: AffineTransform,
  localBounds: Pos
): PresentationEvaluation {
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
 * The validating evaluation, and the default for every caller whose answer is read.
 *
 * `getAffineBounds` throws on a degenerate, non-finite, over-coordinate or over-area
 * transform, which is the right answer for all three: `materialization.ts:213` and
 * `useLayer.ts:150` size an allocated surface from `localBounds`, and `rasterizeBounds`
 * (`affine-transform.ts:125`) refuses the same numbers a second time.
 */
export function evaluatePresentation(input: PresentationEvaluationInput): PresentationEvaluation {
  const affine = getPresentationAffine(input.operations);
  return assemblePresentation(input, input.mode ?? 'layer-bounds', affine, getAffineBounds(affine, input.sourceSize));
}

/**
 * The evaluation for a layer drawn straight into a document-sized surface, which is the one
 * path where the raster caps are protection for an allocation that never happens.
 *
 * `drawEvaluatedPresentation` with a `document` target reads only `filter`, `affine`,
 * `position`, `sourceSize` and the frame — `presentation-evaluator.ts:274-292` — and never
 * `localBounds` or `bounds`, so no value of them is observable there. Meanwhile the two
 * callers that DO size a surface from `localBounds` are exactly the ones that keep
 * validation, and the 64 Mpx cap is the correct answer for them.
 *
 * So, plainly, on the runtime path:
 *   KEPT    — the degenerate-extent refusal: a non-finite or non-positive post-affine extent
 *             still throws. A transform applied through the transform tool is additionally
 *             validated for singularity and for all three caps at the moment it is applied
 *             (`transformToolArgsToAffine`), against the size it is applied to; what this
 *             path declines to re-derive is a cap the caller cannot act on here.
 *   BYPASSED — `MAX_AFFINE_COORDINATE` on the origin and on the extent, and
 *             `MAX_AFFINE_PIXELS` on the area.
 *
 * Why bypassing them is safe: all three exist to bound a surface a caller would allocate
 * from the numbers. This path allocates none from them. Its only surfaces are the layer's
 * own bitmap, which already exists at `sourceSize` and was allocated when the document
 * opened, and the staging canvas, which `drawLayersToCanvas` sizes from the DOCUMENT frame.
 * The worst case it now permits is therefore an unbounded SOURCE, drawn with the same single
 * `drawImage` into the same document-sized canvas it always used: no per-layer buffer, and
 * no arithmetic this module performs grows a canvas. What it costs in exchange is the
 * accident this replaced — `useApp.ts:159` caps nothing on the open path, so a plain 9000x9000
 * (81 Mpx) JPEG made `getAffineBounds` throw for EVERY layer of the document and
 * `drawLayersToCanvas` published nothing at all. Photoshop's own limit is far above 64 Mpx,
 * so the cap was a bound on a buffer, not on a document.
 */
export function evaluatePresentationForDraw(
  input: PresentationEvaluationInput,
  target: PresentationDrawTarget
): PresentationEvaluation {
  // Typed as the union, not as its `document` half, so the rule is enforced where it can
  // be tested: a caller holding a `bounds` target is a caller that sizes a surface from the
  // answer, which is the caller the caps exist for.
  if (target.kind !== 'document') {
    throw new Error('Only a document draw target may be evaluated without the affine raster caps');
  }
  const affine = getPresentationAffine(input.operations);
  return assemblePresentation(
    input,
    input.mode ?? 'layer-bounds',
    affine,
    uncappedAffineBounds(affine, input.sourceSize)
  );
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
    ctx.imageSmoothingEnabled = false;
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

/**
 * # The processor input boundary
 *
 * A pixel processor is handed ONE buffer and its extents and never learns which layer it belongs
 * to, so everything that decides WHICH buffer and WHERE its pixel (0, 0) sits has to be settled
 * before the call. Three paths settle it and they must agree: the live pointer move, the legacy
 * replay of a committed stroke, and the durable materializer. The durable one already sequences it
 * exactly as stated here — `materialization.ts` — `renderRetainedSegment()` folds the retained
 * operations into the raster, advances `origin`/`size` to `evaluation.bounds`, and hands the
 * processor the result — so the two legacy paths are brought to the same rule rather than to a
 * third one.
 *
 * The rule: a layer's PRESENTED operations are baked into its raster exactly once, the raster is
 * published at `bounds`, and the baked operations are dropped from the list the renderer will
 * evaluate again. Keeping the list while publishing the baked raster is what let a transform or a
 * filter be applied twice to one stroke.
 */

/**
 * The retained operations that currently PRESENT `layer`, enabled ones only — the evaluator's
 * own input, so the three paths cannot disagree about what a layer looks like.
 *
 * `enabled` is read here and not downstream: a disabled entry contributes to nothing, which is
 * also what `drawLayerSource()` and `operationsRetainedAfterBake()` below take as their rule.
 */
export function retainedPresentationOperations(layer: Layer): PresentationOperation[] {
  return layer.operations
    .filter((operation) => operation.enabled)
    .map((operation) =>
      operation.kind === 'affine-transform'
        ? { kind: 'affine-transform', transform: operation.transform }
        : {
            kind: 'filter',
            toolName: operation.args.toolName,
            args: operation.args as unknown as Readonly<Record<string, unknown>>,
          }
    );
}

/**
 * The operation list a layer must publish alongside a raster the presented operations were baked
 * into: exactly the entries that contributed to nothing, because they were disabled.
 *
 * The complement of `retainedPresentationOperations`, stated once. Clearing the whole list would
 * silently DROP a disabled filter, and dropping it is not a cosmetic loss: `toggleDisabled()`
 * rebuilds the timeline by replaying it, so an entry that no longer exists can never be switched
 * back on, and the user's disabled adjustment would be unrecoverable rather than merely off.
 */
export function operationsRetainedAfterBake(layer: Layer): readonly LayerOperation[] {
  return layer.operations.filter((operation) => !operation.enabled);
}

/**
 * The extent the raster a processor addresses occupies in DOCUMENT space — `layer.pos` itself when
 * the layer presents nothing, and its evaluated extent when it does.
 *
 * This is what a tool area rebases a pointer coordinate through, and it is the same number the
 * staged surface sits at, so the stroke lands where the layer is drawn. Subtracting `layer.pos`
 * instead is wrong for every layer with a retained affine that moves its content, which is the
 * whole of the "wrong layer-local coordinates" half of the double-application defect: the pointer
 * said a place on the screen and the processor was handed a coordinate for a different place in
 * the buffer it writes.
 *
 * Total rather than refusing, unlike the validating evaluation it mirrors: this runs on every
 * pointer move, where a throw would escape into a React event handler. The two ways the extent can
 * be unusable are answered differently on purpose. A degenerate extent (non-finite or non-positive)
 * is refused by `stageProcessorInput()` too, so the processor never runs and no coordinate computed
 * here is ever used. An over-cap extent — a legitimately enormous transform — is computable here,
 * so the origin is reported truthfully; the staging path refuses it and again no write happens.
 */
/**
 * `uncappedAffineBounds` with its single refusal as a value instead of a throw, which is what
 * `processorPresentationBounds` needs: the origin it reports is read on every pointer move, and a
 * throw there would escape into a React event handler rather than refuse a stroke.
 */
function uncappedAffineExtentOrNull(affine: AffineTransform, sourceSize: Size): Pos | null {
  try {
    return uncappedAffineBounds(affine, sourceSize);
  } catch {
    return null;
  }
}

export function processorPresentationBounds(layer: Layer): Pos {
  const operations = retainedPresentationOperations(layer);
  if (operations.length === 0) return { ...layer.pos };

  const localBounds = uncappedAffineExtentOrNull(getPresentationAffine(operations), layer.pos);
  if (!localBounds) return { ...layer.pos };

  return {
    x: layer.pos.x + localBounds.x,
    y: layer.pos.y + localBounds.y,
    width: localBounds.width,
    height: localBounds.height,
  };
}

export type ProcessorStaging = Readonly<{
  /** The raster the processor addresses: the layer's own, or its presentation with the retained operations baked in. */
  bitmap: BitmapSource;
  /** Where that raster sits in DOCUMENT space. `layer.pos` when nothing was baked. */
  bounds: Pos;
  /** The operations baked into `bitmap`; empty means the input raster was handed straight through. */
  operations: readonly PresentationOperation[];
}>;

/**
 * Stages the raster a processor must address for `layer`: its own bitmap, or a private surface
 * carrying the retained operations already evaluated into it.
 *
 * The validating `evaluatePresentation`, not the draw variant, because this DOES allocate a
 * surface from the extent — which is what the affine raster caps exist to bound. A throw here is
 * the caller refusing to write pixels, and both callers already contain it rather than letting it
 * reach a pointer handler or a replay.
 *
 * `bounds` is a fresh object rather than the frozen `evaluation.bounds`: it becomes a layer's
 * `pos`, and nothing that follows treats a published position as immutable.
 */
export function stageProcessorInput(layer: Layer, bitmap: BitmapSource): ProcessorStaging {
  const operations = retainedPresentationOperations(layer);
  if (operations.length === 0) return { bitmap, bounds: { ...layer.pos }, operations };

  const evaluation = evaluatePresentation({
    position: layer.pos,
    sourceSize: { width: layer.pos.width, height: layer.pos.height },
    operations,
    mode: 'layer-bounds',
  });
  const width = Math.max(1, Math.ceil(evaluation.localBounds.width));
  const height = Math.max(1, Math.ceil(evaluation.localBounds.height));
  const surface =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(width, height)
      : (() => {
          if (typeof document === 'undefined') throw new Error('No canvas implementation is available');
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          return canvas;
        })();
  const context = surface.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!context) throw new Error('A 2D canvas context is required to stage a presented raster');

  context.save();
  try {
    drawEvaluatedPresentation(context, bitmap, evaluation, { kind: 'bounds' });
  } finally {
    context.restore();
  }

  return { bitmap: surface as BitmapSource, bounds: { ...evaluation.bounds }, operations };
}
