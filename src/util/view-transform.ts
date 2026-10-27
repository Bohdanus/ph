import type { ContainDimensions } from './contain-fit.ts';
import type { Point, Pos, Size } from '../contexts/general-types.ts';

/**
 * The view transform, as arithmetic and nothing else.
 *
 * Extracted from every consumer for the same reason `contain-fit.ts` is: the number that
 * turns a screen point into a document point, and the number the pointer is divided by, are
 * the same number, and two copies of that arithmetic drift. This module owns the forward
 * direction (what CSS transform string to write) and the inverse direction (where a client
 * point lands in the document), and it knows nothing about React, the DOM, the store or
 * pointer events.
 *
 * ## The model
 *
 * `zoom` is a MULTIPLIER ON TOP OF the contain fit, not an absolute scale. So `zoom === 1`
 * is Fit on Screen, and Actual Pixels is `zoom === 1 / fitScale`. That is why the options-bar
 * readout must print `absoluteScalePercent()` rather than `zoom * 100`: at Fit on Screen a
 * small image legitimately reads `25%`, which is what Photoshop shows.
 *
 * ## Why the transform lives on the container and not on the bitmap
 *
 * The canvas element is sized to the CONTAINER and letterboxes the bitmap with CSS
 * `object-contain`, so the fitted bitmap's centre is the container's centre on both axes
 * (`containFit` centres it). `Main.scss` sets `transform-origin: center center` on
 * `.zoom-container`, which is already in the tree with no transform to anchor. So with
 * `transform: translate(dx, dy) scale(zoom)`:
 *
 * ```
 * left  = cx + dx - fitW * zoom / 2      cx = containerWidth / 2
 * width = fitW * zoom                     fitW = imageWidth * fitScale
 * ```
 *
 * The alternative — restructuring the DOM so the transformed element is sized to the fitted
 * bitmap — inverts more cleanly but moves the canvas box, which breaks the
 * `workspace-canvas` / `tool-overlay-canvas` selectors and re-records every visual
 * baseline. This way needs no DOM change at all.
 *
 * ## There is no clamp, and that is the contract
 *
 * `dx`/`dy` are the user's, with no bound on either. A drag moves the image as far as it is
 * dragged, at every zoom including Fit on Screen, and the image may be pulled onto the
 * pasteboard and out of the window. Adobe's Hand tool behaves this way; an earlier version of
 * this module held the bitmap's edges inside the container and it was this app's own addition,
 * recorded as a divergence in the Hand's `appNotes`.
 *
 * It was removed because the reasoning behind it conflated two different claims. Adobe scopes
 * the Hand to "zoomed in to more than 100% and part of the image is out of view" — that says
 * when panning is USEFUL, not that panning is REFUSED when it is not. The clamp turned a
 * statement about usefulness into a rule about permission, and the visible cost was that a drag
 * did nothing at the zoom a user meets first.
 *
 * The consequence to keep in mind: the document can be left out of sight, so `fitToScreen()` is
 * a RECOVERY path rather than a convenience. It is reachable three ways — `Ctrl+0`,
 * `Ctrl+1`, and double-clicking the Hand tool's own tile, which is Adobe's gesture for it.
 * `clampZoom` is unrelated and stays: a zoom range is a scale limit, not a position limit.
 */

/**
 * The user-controllable view of the document. `dx`/`dy` are CSS px in container space.
 *
 * `rotation` is DEGREES, clockwise, and is a property of the VIEW and not of the document:
 * Adobe's Rotate View "changes the angle at which you view the canvas, but it does not rotate
 * or transform the actual image", so nothing here may ever reach a layer, a history entry or an
 * export. It rides in this type rather than beside it for that reason — there is exactly one
 * place the view lives, and a rotation held anywhere else would be a rotation that can drift
 * out of step with the pan and zoom it has to compose with.
 */
export type DocumentView = {
  dx: number;
  dy: number;
  zoom: number;
  rotation: number;
};

/** The view that shows the whole document, centred and upright. The initial value, and `fitToScreen`'s target. */
export const FIT_VIEW: DocumentView = { dx: 0, dy: 0, zoom: 1, rotation: 0 };

/**
 * The Rotation Angle field's range, in degrees.
 *
 * UNVERIFIED against Adobe. The Rotate View research in `docs/TOOLS-INVENTORY.md` records the
 * field and Reset View from Adobe's own page but not the bounds it accepts, so this is a
 * judgement call: a bounded field that wraps, because an unbounded one lets a typed 3600 produce
 * an orientation indistinguishable from 0 and then makes the displayed number disagree with what
 * is on screen. Named so that correcting it against Adobe is a one-line change.
 */
export const MIN_ROTATION = -180;
export const MAX_ROTATION = 180;

/** The step `Shift` snaps a rotate drag to. Third-party sourced, not Adobe-confirmed. */
export const ROTATION_SNAP_DEGREES = 15;

/**
 * Rotate a point about the ORIGIN by `degrees`, clockwise.
 *
 * About the origin rather than about the container centre so the caller composes it with a
 * translation, which keeps the trigonometry in one place and testable without a DOM. Clockwise
 * because CSS `rotate()` is clockwise for a positive angle in a screen coordinate system, and a
 * sign flip between the drag arithmetic and the rendered transform is the kind of thing that
 * looks correct and rotates the wrong way.
 */
export function rotatePoint(point: Point, degrees: number): Point {
  if (!Number.isFinite(degrees) || degrees === 0) return point;

  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);

  return {
    x: point.x * cos - point.y * sin,
    y: point.x * sin + point.y * cos,
  };
}

/** Bring an angle into `(MIN_ROTATION, MAX_ROTATION]`, wrapping rather than clamping. */
export function normalizeRotation(degrees: number): number {
  if (!Number.isFinite(degrees)) return 0;
  // `+ 180` before the modulo so the result is symmetric about zero rather than about 180: a
  // plain `% 360` would report 350 as -10 AND 190 as 190, which is the same orientation twice.
  const wrapped = (((degrees + 180) % 360) + 360) % 360;
  const normalized = wrapped - 180;
  return normalized === -180 ? 180 : normalized;
}

/** Snap an angle to the nearest `step`, for a `Shift`-held drag. */
export function snapRotation(degrees: number, step = ROTATION_SNAP_DEGREES): number {
  if (!Number.isFinite(degrees) || !Number.isFinite(step) || step <= 0) return degrees;
  return Math.round(degrees / step) * step;
}

/**
 * How much the fitted document is allowed to be magnified beyond the fit, and how far it
 * may be shrunk below it.
 *
 * The upper bound is Photoshop's ceiling as a multiplier over the fit: CC 2018 shipped an
 * "increased maximum zoom level" and 3200% is the figure Adobe's own shortcut sheets and
 * help pages carry. The lower bound is BELOW fit on purpose — being able to pull back under
 * the document is how you see the pasteboard around a small image, and it costs one number.
 */
export const MIN_ZOOM = 0.125;
export const MAX_ZOOM = 32;

/**
 * The tolerance that decides which ladder rung a zoom "is".
 *
 * Larger than any rounding error in the ladder itself (the values are rounded to four
 * decimals), and small enough that it cannot swallow a real step.
 */
const ZOOM_EPSILON = 1e-4;

/**
 * The steps `Ctrl/Cmd +` and `Ctrl/Cmd -` walk, in zoom multipliers over the fit.
 *
 * UNVERIFIED. These are reproduced from knowledge of Adobe's zoom ladder, not from an
 * opened Adobe page, so per `docs/TOOLS-RESEARCH-BRIEF.md` — "a description without a
 * source is a rumour" — they carry no `sources` entry in the tool description and must be
 * confirmed against Adobe before they are treated as Adobe's values. They are named
 * constants rather than literals scattered through the shortcut registrations precisely so
 * that correcting them is a one-line change.
 */
export const ZOOM_LADDER: readonly number[] = [0.125, 0.1667, 0.25, 0.3333, 0.5, 0.6667, 1, 2, 3, 4, 6, 8, 16, 32];

/**
 * What the view needs to know about the container and the document in order to place a
 * client point or print a zoom percentage.
 *
 * `fitScale` and the two offsets come straight from `containFit()`, which is already the
 * single definition of "how big is the document on screen". `Main` publishes them through
 * the view store's `setFitMetrics`, from the `onResize` callback `usePointerPosition`
 * already calls — so there is no second place that measures the container.
 */
export type ViewFit = {
  /** CSS px per document px at `zoom === 1`, from `containFit()`. */
  fitScale: number;
  /** The fitted bitmap's left gap inside the container, from `containFit()`. */
  offsetX: number;
  /** The fitted bitmap's top gap inside the container, from `containFit()`. */
  offsetY: number;
  containerWidth: number;
  containerHeight: number;
  imageWidth: number;
  imageHeight: number;
};

/** A container measured but holding no document yet, or a detached one. Every operation is a no-op. */
export const EMPTY_FIT: ViewFit = {
  fitScale: 1,
  offsetX: 0,
  offsetY: 0,
  containerWidth: 0,
  containerHeight: 0,
  imageWidth: 0,
  imageHeight: 0,
};

/**
 * Promote a contain fit to the metrics the view needs.
 *
 * `ContainDimensions` already carries five of the seven fields; only the document's own size
 * has to come from the caller, because `containFit` derives everything else from it. Naming
 * the conversion here rather than at each call site is what keeps "the fit the pointer is
 * divided by" and "the fit the zoom percentage is reported against" the same measurement —
 * two literals spelled separately would drift the first time one of them was changed.
 */
export function toViewFit(dimensions: ContainDimensions, image: Size): ViewFit {
  return {
    fitScale: dimensions.scale,
    offsetX: dimensions.offsetX,
    offsetY: dimensions.offsetY,
    containerWidth: dimensions.outerWidth,
    containerHeight: dimensions.outerHeight,
    imageWidth: image.width,
    imageHeight: image.height,
  };
}

/**
 * Whether a view is the identity — Fit on Screen, centred.
 *
 * The identity is not merely "looks the same": `scale(1)` is visually a no-op but can still
 * promote the element to a composited layer and change how the canvas rasterises, which
 * would move every visual-regression baseline for no reason. So the identity writes NO
 * transform at all, and the default rendering is byte-for-byte what it was before this
 * feature existed. That is why this predicate exists rather than an inline comparison in
 * the writer.
 *
 * `rotation` is part of it, and that is load-bearing rather than tidiness: every visual
 * regression in the suite runs at `rotation === 0`, so if a zero rotation still emitted
 * `rotate(0deg)` the transform attribute would be non-empty on all thirteen baselines and they
 * would all move for a rotation of nothing.
 */
export function isIdentityView(view: DocumentView): boolean {
  return view.zoom === 1 && view.dx === 0 && view.dy === 0 && view.rotation === 0;
}

/**
 * The CSS transform for a view, or `''` for the identity.
 *
 * `translate` is written before `scale` because CSS applies the rightmost transform first,
 * so the translation is in the container's own (unscaled) coordinate space — which is the
 * space `dx`/`dy` are defined in, and the space the Hand tool's pointer delta arrives in.
 *
 * `rotate` goes LAST, so it is the first thing applied and the rotation happens about
 * `transform-origin` — the container's centre — before the zoom and the pan displace it. That
 * ordering is what makes a tilted view scale and pan about the same point it did upright, and it
 * is the same order the inverse in `screenToDocument()` walks backwards.
 */
export function composeTransform(view: DocumentView): string {
  if (isIdentityView(view)) return '';

  const rotate = view.rotation === 0 ? '' : ` rotate(${view.rotation}deg)`;
  return `translate(${view.dx}px, ${view.dy}px) scale(${view.zoom})${rotate}`;
}

/**
 * The view's zoom level as a percentage of ACTUAL PIXELS.
 *
 * This is what the options bar reads out, and it is deliberately not `zoom * 100`: `zoom` is
 * a multiplier over the fit, so a small image at Fit on Screen legitimately reads `25%`.
 */
export function absoluteScalePercent(fit: ViewFit, view: DocumentView): number {
  if (!(fit.fitScale > 0) || !Number.isFinite(view.zoom)) return 100;
  return fit.fitScale * view.zoom * 100;
}

/** A display-ready percentage, rounded to a whole number, for the options-bar readout. */
export function formatZoomPercent(fit: ViewFit, view: DocumentView): string {
  return `${Math.round(absoluteScalePercent(fit, view))}%`;
}

/**
 * Where a client point lands in the document, inverting `composeTransform`.
 *
 * `rect` is the container's `getBoundingClientRect()` and `clientX`/`clientY` are CSS px, so
 * the whole function is DPR-invariant for the same reason `containFit`'s `scale` is.
 *
 * The identity case reduces EXACTLY to the mapping this app used before the view transform
 * existed, `(client - offset - rect.origin) / fitScale`: at `zoom === 1` and `dx === dy === 0`
 * the `cx` terms cancel. That is the property `usePointerPosition`'s existing suite pins, and
 * it is why this could be a strict generalisation rather than a rewrite.
 */
export function screenToDocument(client: Point, rect: Pos, fit: ViewFit, view: DocumentView): Point {
  const { fitScale, offsetX, offsetY, containerWidth, containerHeight } = fit;
  const zoom = view.zoom > 0 && Number.isFinite(view.zoom) ? view.zoom : 1;

  const cx = containerWidth / 2;
  const cy = containerHeight / 2;

  // Inverse of `translate(dx,dy) scale(zoom) rotate(rotation)` about `(cx, cy)`, walked backwards
  // in the order CSS applies it: undo the pan, undo the zoom, undo the rotation.
  const centred = rotatePoint(
    { x: (client.x - rect.x - cx - view.dx) / zoom, y: (client.y - rect.y - cy - view.dy) / zoom },
    -view.rotation
  );

  const localX = cx + centred.x;
  const localY = cy + centred.y;

  const scale = fitScale > 0 && Number.isFinite(fitScale) ? fitScale : 1;

  return { x: (localX - offsetX) / scale, y: (localY - offsetY) / scale };
}

/**
 * The document point that must stay under `client` after `nextZoom` replaces `current`.
 *
 * A wheel zoom is anchored at the pointer: whatever pixel is under the cursor stays under
 * the cursor, which is the only behaviour that makes zooming feel like moving a window
 * rather than jumping the document. Solving that for `dx` is why this function exists rather
 * than a bare `zoom += 1` at the call site.
 *
 * UNCLAMPED, and deliberately so: there is no position bound to honour. When the pointer is
 * over the letterboard rather than the document there is no pixel there to hold, and the
 * solve shifts the image to keep that point of space where it was — which is what Adobe does
 * when the cursor is over pasteboard.
 */
export function zoomKeepingAnchor(
  current: DocumentView,
  nextZoom: number,
  client: Point,
  rect: Pos,
  fit: ViewFit
): DocumentView {
  const before = screenToDocument(client, rect, fit, current);

  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextZoom));

  // Put the same document point back under the same client point at the new zoom, solving the
  // forward transform for `d`. Rotation is held constant across a zoom step, so it appears as a
  // fixed rotation of the scaled offset rather than as something to solve for — which is why
  // this stays one expression and does not need an iteration.
  const cx = fit.containerWidth / 2;
  const cy = fit.containerHeight / 2;
  const scale = fit.fitScale > 0 ? fit.fitScale : 1;

  const localX = before.x * scale + fit.offsetX;
  const localY = before.y * scale + fit.offsetY;

  const rotated = rotatePoint({ x: (localX - cx) * zoom, y: (localY - cy) * zoom }, current.rotation);

  return {
    zoom,
    rotation: current.rotation,
    dx: client.x - rect.x - cx - rotated.x,
    dy: client.y - rect.y - cy - rotated.y,
  };
}

/**
 * The next zoom up or down the ladder, held at the ends.
 *
 * `direction` is `+1` for zoom in and `-1` for zoom out. A current zoom that sits between two
 * rungs steps to whichever one it is nearer to going that way, so the ladder is reachable
 * from any value rather than only from a rung — which matters because `Ctrl+1` puts the
 * multiplier at `1 / fitScale`, and that is rarely a whole number.
 */
export function nextZoomStep(current: number, direction: 1 | -1): number {
  const ladder = ZOOM_LADDER;
  const from = Number.isFinite(current) && current > 0 ? current : 1;

  if (direction === 1) {
    const above = ladder.find((step) => step > from + ZOOM_EPSILON);
    return above ?? Math.min(MAX_ZOOM, from);
  }

  const below = [...ladder].reverse().find((step) => step < from - ZOOM_EPSILON);
  return below ?? Math.max(MIN_ZOOM, from);
}

/** Clamp a zoom to the supported range, ignoring a non-finite input. */
export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom) || zoom <= 0) return 1;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/** The zoom multiplier that puts one document pixel on one screen pixel: Actual Pixels. */
export function actualPixelsZoom(fit: ViewFit): number {
  return fit.fitScale > 0 ? clampZoom(1 / fit.fitScale) : 1;
}
