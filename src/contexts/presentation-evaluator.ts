import type { AffineTransform } from './affine-transform.ts';
import {
  getAffineBounds,
  IDENTITY_AFFINE_TRANSFORM,
  isIdentityAffineTransform,
  MAX_AFFINE_COORDINATE,
  MAX_AFFINE_PIXELS,
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

/**
 * How far past its own edge a retained blur's spread is carried into every extent derived from a
 * presentation — the support of the kernel the browser actually runs, in sigmas of its radius.
 *
 * `ctx.filter = 'blur(Npx)'` is a Gaussian of standard deviation N, so it is nonzero everywhere
 * and the extent that has to survive is the support, not a convenient multiple. MEASURED on the
 * canvas this app draws on (headless Chromium, a 40x40 white square at a 2x CTM, `blur(20px)`):
 * the drawn extent runs to x=151..328 where the square's geometric span is 200..280, so the spread
 * is 2.4 sigma of the radius in OUTPUT pixels. Had the kernel been scaled by the CTM its sigma
 * would have been 40 and the spread ~94, which is what makes that number the evidence for the
 * post-affine rule below rather than a coincidence of the fixture. At three sigma the residual is
 * ~0.1% of the source edge — 0.3 of 255, which rounds to nothing — so an allocation sized at this
 * margin has no visible seam at its edge, while one sized at the radius itself would cut the halo
 * at ~16% alpha and draw a straight line through it.
 *
 * NOT the stroke's own margin: `FocusToolArea` widens a stroke frame by ONE radius past the tip
 * (`kernelReach`), because there the kernel running off the frame erodes the layer's own alpha.
 * That is a different question — the brush's reach — asked by the caller that owns the stroke, and
 * it must not be folded in here or every retained blur would triple the frame a stroke allocates.
 */
export const FILTER_EXTENT_SIGMAS = 3;

/**
 * One entry per retained filter tool, stating BOTH what it contributes to `ctx.filter` and what it
 * adds to the extent of what it filters.
 *
 * The two answers belong in one record because they are one fact: a tool's footprint is the
 * footprint of the CSS this module assigns. A filter that widened the layer had to be able to say
 * so, and a `Record<PresentationFilterToolName, …>` makes that a compile error rather than a
 * reviewer's memory — adding a tool to the union without stating its extent does not compile.
 *
 * `margin` is per edge, in the space the filter runs in, which is the OUTPUT space: a browser
 * applies `ctx.filter` to the drawing operation after the current transform, so a 2x-scaled layer
 * blurs by the same number of device pixels, not twice as many. That is what makes the margin a
 * post-affine addition to the extent rather than a pre-affine one.
 */
type FilterToolRule = Readonly<{
  css: (operation: PresentationFilterOperation) => string;
  margin: (operation: PresentationFilterOperation) => number;
}>;

const FILTER_TOOL_RULES: Readonly<Record<PresentationFilterToolName, FilterToolRule>> = {
  blur: {
    css: (operation) => `blur(${numericFilterArg(operation, 'radius')}px)`,
    // A negative radius is the identity in CSS and in `blur()` itself (`STROKE_KERNEL_FLOOR`
    // exists because the two forms disagree at zero), so it must not shrink an extent either.
    margin: (operation) => FILTER_EXTENT_SIGMAS * Math.max(0, numericFilterArg(operation, 'radius')),
  },
  color: {
    // The builders consume exactly these fields, so exactly these are coerced — and naming
    // them is what removes the `as never` the whole-args spread needed.
    css: (operation) =>
      buildColorsFilter({
        grayscale: numericFilterArg(operation, 'grayscale'),
        sepia: numericFilterArg(operation, 'sepia'),
        saturation: numericFilterArg(operation, 'saturation'),
      }),
    margin: () => 0,
  },
  levels: {
    css: (operation) =>
      buildLevelsFilter({
        brightness: numericFilterArg(operation, 'brightness'),
        contrast: numericFilterArg(operation, 'contrast'),
      }),
    // `brightness()` and `contrast()` are pointwise: they recolour the pixels they are given and
    // move none of them, so a colour or levels adjustment contributes no margin at all.
    margin: () => 0,
  },
};

/**
 * The rule for `operation`'s tool, or `undefined` when it names a tool with no canvas filter
 * equivalent.
 *
 * The lookup is total over a wider domain than the table: `layer.operations` carries whatever tool
 * name the history recorded, so an operation can name a tool that has no filter at all. Such an
 * operation contributes NOTHING — no CSS, and no margin — which is the point of asking one place
 * for both. The old `switch` reached the same answer by falling off its last case and letting
 * `Array#join` render `undefined` as the empty string an engine ignores; this keeps that total
 * lookup while the table itself stays exhaustive for every tool that DOES have a filter, so adding
 * one is a compile error rather than a filter that silently disappears.
 */
function filterToolRule(operation: PresentationFilterOperation): FilterToolRule | undefined {
  const rules: Readonly<Partial<Record<PresentationFilterToolName, FilterToolRule>>> = FILTER_TOOL_RULES;
  return rules[operation.toolName];
}

function filterForOperation(operation: PresentationFilterOperation): string | undefined {
  return filterToolRule(operation)?.css(operation);
}

/**
 * The largest per-edge margin the retained filters add to the footprint they filter, in output
 * pixels; zero for a presentation whose filters all leave their pixels where they are.
 *
 * Over the whole stack rather than per filter, because `ctx.filter` applies the functions in the
 * order they are written and each one sees the output of the one before it. Independent Gaussian
 * blurs compose by variance, so their support is the root-sum-square of the per-filter supports,
 * not the maximum radius and not the sum of radii.
 *
 * Reads the same coerced values `getPresentationFilter` writes, and so refuses exactly what it
 * refuses: an argument that will not become a number throws here too, rather than this module
 * reporting an extent for a `ctx.filter` the browser is about to discard.
 */
export function getPresentationFilterMargin(operations: readonly PresentationOperation[]): number {
  let margin = 0;
  for (const operation of operations) {
    if (operation.kind !== 'filter') continue;
    const filterMargin = filterToolRule(operation)?.margin(operation) ?? 0;
    margin = Math.hypot(margin, filterMargin);
  }
  return margin;
}

/** An extent grown by `margin` on every edge; the input itself when there is nothing to add. */
function dilateExtent(extent: Pos, margin: number): Pos {
  if (!(margin > 0)) return extent;
  return {
    x: extent.x - margin,
    y: extent.y - margin,
    width: extent.width + margin * 2,
    height: extent.height + margin * 2,
  };
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

/**
 * The two raster caps, re-asked of an extent the affine pass has already accepted.
 *
 * `getAffineBounds` checks the post-affine extent, and a filter margin is added to it AFTER that,
 * so a layer whose transform was legal can still ask for a surface nobody should allocate: an
 * 8100x8100 source is 65.6 Mpx and passes the 64 MiB cap, and a radius-20 blur takes it to
 * 8220x8220 — 67.6 Mpx — which is not. Refusing here rather than letting the caller allocate is
 * what keeps the caps the bound on a buffer instead of a bound on a matrix.
 *
 * Named for the filter that pushed the extent over, because the affine was in bounds and saying
 * otherwise would send the reader to the matrix. The phrase `raster bounds` is kept so the refusal
 * reads as one family with `getAffineBounds`'s, which is what a caller greps for.
 */
function assertFilterExtentWithinRasterCaps(extent: Pos): void {
  if (
    Math.abs(extent.x) > MAX_AFFINE_COORDINATE ||
    Math.abs(extent.y) > MAX_AFFINE_COORDINATE ||
    extent.width > MAX_AFFINE_COORDINATE ||
    extent.height > MAX_AFFINE_COORDINATE ||
    extent.width * extent.height > MAX_AFFINE_PIXELS
  ) {
    throw new Error('Filter extent exceeds raster bounds');
  }
}

/**
 * The extent a caller that allocates from the answer must be given: the post-affine extent plus
 * the retained filters' spread, validated as ONE number.
 *
 * Validating the two halves separately is the hole this closes. `getAffineBounds` has already
 * refused a degenerate extent above, and the dilation only ever grows a finite non-negative one,
 * so the caps are the whole of what is left to check — and they have to be checked on the dilated
 * extent, which is the one a surface is allocated from.
 */
function cappedPresentationExtent(
  operations: readonly PresentationOperation[],
  affine: AffineTransform,
  sourceSize: Size
): Pos {
  const extent = dilateExtent(getAffineBounds(affine, sourceSize), getPresentationFilterMargin(operations));
  assertFilterExtentWithinRasterCaps(extent);
  return extent;
}

/**
 * `cappedPresentationExtent` without the caps, for the one caller that allocates nothing: see
 * `evaluatePresentationForDraw`. The degenerate refusal is kept, and the margin is not a cap
 * question — it is arithmetic on an extent nobody is about to turn into a buffer here.
 */
function uncappedPresentationExtent(
  operations: readonly PresentationOperation[],
  affine: AffineTransform,
  sourceSize: Size
): Pos {
  return dilateExtent(uncappedAffineBounds(affine, sourceSize), getPresentationFilterMargin(operations));
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
 * `cappedPresentationExtent` throws on a degenerate, non-finite, over-coordinate or over-area
 * transform, and on a filter margin that pushes an otherwise legal extent past the same caps,
 * which is the right answer for all four: `materialization.ts` and `stageProcessorInput` size an
 * allocated surface from `localBounds`, and `rasterizeBounds` refuses the same numbers a second
 * time.
 */
export function evaluatePresentation(input: PresentationEvaluationInput): PresentationEvaluation {
  const affine = getPresentationAffine(input.operations);
  return assemblePresentation(
    input,
    input.mode ?? 'layer-bounds',
    affine,
    cappedPresentationExtent(input.operations, affine, input.sourceSize)
  );
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
 *             `MAX_AFFINE_PIXELS` on the area. The filter margin is NOT part of what is bypassed:
 *             it is not a cap question at all, only arithmetic, and the extent it produces is
 *             unreachable from here — see below — so computing it changes nothing observable.
 *
 * Why bypassing them is safe: all three exist to bound a surface a caller would allocate
 * from the numbers. This path allocates none from them. Its only surfaces are the layer's
 * own bitmap, which already exists at `sourceSize` and was allocated when the document
 * opened, and the staging canvas, which `drawLayersToCanvas` sizes from the DOCUMENT frame.
 * The worst case it now permits is therefore an unbounded SOURCE, drawn with the same single
 * `drawImage` into the same document-sized canvas it always used: no per-layer buffer, and
 * no arithmetic this module performs grows a canvas. What it costs in exchange is the
 * accident this replaced — `setImageFromUpload()` caps nothing on the open path, so a plain 9000x9000
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
    uncappedPresentationExtent(input.operations, affine, input.sourceSize)
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
 * `uncappedPresentationExtent` with every refusal as a value instead of a throw, which is what
 * `layerPresentationBounds` needs: the origin it reports is read on every pointer move, and a
 * throw there would escape into a React event handler rather than refuse a stroke.
 */
function presentationExtentOrNull(
  operations: readonly PresentationOperation[],
  affine: AffineTransform,
  sourceSize: Size
): Pos | null {
  try {
    return uncappedPresentationExtent(operations, affine, sourceSize);
  } catch {
    return null;
  }
}

/**
 * The extent a layer's presentation occupies in DOCUMENT space: `position` itself when the layer
 * presents nothing, and its evaluated extent — the affine extent grown by the retained filters'
 * spread — when it does.
 *
 * One rule because there was one question with three answers. These three callers each size
 * something from it, and each of them clipped the filter's spread while the canvas the user was
 * looking at drew all of it:
 *
 *  - `stageProcessorInput` allocates the processor's raster at it, and
 *    `processorPresentationBounds` is how a tool area learns where that raster sits, so a stroke
 *    is rebased through the origin of the buffer it is really writing.
 *  - `MoveToolArea` draws the layer's transform handles on it and scales the layer by the ratio of
 *    the dragged box to it, so the handles and the arithmetic cannot describe different layers.
 *  - `savePsd` allocates the PSD layer's canvas at it, which is where the export lost the halo:
 *    the layer's rectangle was the affine extent, and `drawLayerSource` blurred into a canvas that
 *    stopped at its edge.
 *
 * The margin is the SAME number the evaluator adds, rather than one derived here from `radius`
 * again: a per-edge extent that two modules computed separately is the defect this removed, and a
 * blur is the only retained filter that has one.
 *
 * Total rather than refusing, unlike the validating evaluation it mirrors. This runs on every
 * pointer move of every stroke tool and on every render of the transform handles, where a throw
 * would escape into a React event handler. The ways the extent can be unusable are answered
 * differently on purpose. A degenerate extent (non-finite or non-positive) is refused by
 * `stageProcessorInput()` too, so the processor never runs and no coordinate computed here is ever
 * used; a filter argument that will not coerce throws `FilterArgumentUnrenderableError` out of the
 * evaluator, which `drawLayersToCanvas` catches per layer and answers by not drawing that layer at
 * all — so reporting the unfiltered extent describes exactly what is presented. An over-cap extent —
 * a legitimately enormous transform — is computable here, so the origin is reported truthfully; the
 * staging path refuses it and again no write happens.
 */
export function layerPresentationBounds(layer: Layer, position: Pos = layer.pos): Pos {
  // `layer.operations &&` is not defensive noise: the function this replaces read the same way
  // (`getLayerAffineTransform` walks `layer.operations ?? []`), and a layer record assembled
  // without its operation list is a shape this module has always answered for. Refusing it here
  // would move a throw from the render path into every pointer handler that draws transform
  // handles, for a layer that presents nothing at all.
  const operations = layer.operations ? retainedPresentationOperations(layer) : [];
  if (operations.length === 0) return { ...position };

  const localBounds = presentationExtentOrNull(operations, getPresentationAffine(operations), {
    width: position.width,
    height: position.height,
  });
  if (!localBounds) return { ...position };

  return {
    x: position.x + localBounds.x,
    y: position.y + localBounds.y,
    width: localBounds.width,
    height: localBounds.height,
  };
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
 * A name for `layerPresentationBounds` at the processor input boundary, not a second rule: the two
 * were separate functions answering the same question with the same arithmetic, which is how a
 * staged surface and the origin every tool area rebases through came to disagree about where a
 * layer's pixels were.
 */
export function processorPresentationBounds(layer: Layer): Pos {
  return layerPresentationBounds(layer);
}

export type ProcessorStaging = Readonly<{
  /** The raster the processor addresses: the layer's own, or its presentation with the retained operations baked in. */
  bitmap: BitmapSource;
  /** Where that raster sits in DOCUMENT space. `layer.pos` when nothing was baked. */
  bounds: Pos;
  /** The operations baked into `bitmap`; empty means the input raster was handed straight through. */
  operations: readonly PresentationOperation[];
}>;

const sameBounds = (a: Pos, b: Pos): boolean =>
  a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

/**
 * Whether a frame is small enough to allocate a surface from.
 *
 * This is the caps question `getAffineBounds` asks, asked here for the one caller that sizes a
 * canvas from a caller-supplied extent on the no-retained-operations path — the path that never
 * calls `evaluatePresentation` and therefore inherits none of its refusals. A stroke frame is
 * sized by the stroke's own extent, which is bounded by nothing in particular: one drag across a
 * large document names a frame far larger than the layer it started on, and sharpen then
 * allocates a `Float32Array` of sixteen bytes per pixel on top of it, once per pointer move.
 */
const frameIsAllocatable = (bounds: Pos): boolean => {
  const width = Math.ceil(bounds.width);
  const height = Math.ceil(bounds.height);
  return (
    Number.isFinite(width) &&
    Number.isFinite(height) &&
    width >= 1 &&
    height >= 1 &&
    Math.abs(bounds.x) <= MAX_AFFINE_COORDINATE &&
    Math.abs(bounds.y) <= MAX_AFFINE_COORDINATE &&
    width <= MAX_AFFINE_COORDINATE &&
    height <= MAX_AFFINE_COORDINATE &&
    width * height <= MAX_AFFINE_PIXELS
  );
};

const createProcessorSurface = (bounds: Pos): OffscreenCanvas | HTMLCanvasElement => {
  const width = Math.max(1, Math.ceil(bounds.width));
  const height = Math.max(1, Math.ceil(bounds.height));
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  if (typeof document === 'undefined') throw new Error('No canvas implementation is available');
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
};

const drawIntoProcessorSurface = (
  target: OffscreenCanvas | HTMLCanvasElement,
  source: BitmapSource,
  sourceBounds: Pos,
  targetBounds: Pos
): void => {
  const context = target.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!context) throw new Error('A 2D canvas context is required to stage a processor raster');
  context.drawImage(source, sourceBounds.x - targetBounds.x, sourceBounds.y - targetBounds.y);
};

/**
 * Stages the raster a processor must address for `layer`: its own bitmap, or a private surface
 * carrying the retained operations already evaluated into it.
 *
 * The validating `evaluatePresentation`, not the draw variant, because this DOES allocate a
 * surface from the extent — which is what the affine raster caps exist to bound. A throw here is
 * the caller refusing to write pixels, and both callers already contain it rather than letting it
 * reach a pointer handler or a replay.
 *
 * `requestedBounds` is the persisted document-space processing frame for a paint stroke. When it
 * is present, the presented raster is padded with transparent pixels into that frame before the
 * processor runs. It is deliberately a raster-frame concern, not a document-frame mutation:
 * the active layer may widen, while the document and neighbouring layers do not.
 *
 * `bounds` is a fresh object rather than the frozen `evaluation.bounds`: it becomes a layer's
 * `pos`, and nothing that follows treats a published position as immutable. Runtime replay and
 * durable materialization must pass the same requested frame or their pixels will diverge.
 */
export function stageProcessorInput(layer: Layer, bitmap: BitmapSource, requestedBounds?: Pos): ProcessorStaging {
  const operations = retainedPresentationOperations(layer);
  if (operations.length === 0) {
    const sourceBounds = { ...layer.pos };
    if (!requestedBounds || sameBounds(requestedBounds, sourceBounds))
      return { bitmap, bounds: sourceBounds, operations };
    // Refuse the WRITE rather than throwing. Every caller already treats a staging failure as
    // "this tool did nothing here" — `tempUpdateLayer` catches and returns false, replay catches
    // and records a diagnostic — so declining the oversized frame is the same answer a cap
    // produces anywhere else, and it keeps one enormous drag from allocating per pointer move.
    if (!frameIsAllocatable(requestedBounds)) return { bitmap, bounds: sourceBounds, operations };
    const surface = createProcessorSurface(requestedBounds);
    drawIntoProcessorSurface(surface, bitmap, sourceBounds, requestedBounds);
    return { bitmap: surface as BitmapSource, bounds: requestedBounds, operations };
  }

  const evaluation = evaluatePresentation({
    position: layer.pos,
    sourceSize: { width: layer.pos.width, height: layer.pos.height },
    operations,
    mode: 'layer-bounds',
  });
  const presentedBounds = { ...evaluation.bounds };
  const bounds = requestedBounds ?? presentedBounds;
  const surface = createProcessorSurface(presentedBounds);
  const context = surface.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!context) throw new Error('A 2D canvas context is required to stage a presented raster');

  context.save();
  try {
    drawEvaluatedPresentation(context, bitmap, evaluation, { kind: 'bounds' });
  } finally {
    context.restore();
  }

  if (sameBounds(bounds, presentedBounds)) return { bitmap: surface as BitmapSource, bounds, operations };
  if (!frameIsAllocatable(bounds)) {
    return { bitmap: surface as BitmapSource, bounds: presentedBounds, operations };
  }

  const widened = createProcessorSurface(bounds);
  drawIntoProcessorSurface(widened, surface as BitmapSource, presentedBounds, bounds);
  return { bitmap: widened as BitmapSource, bounds, operations };
}
