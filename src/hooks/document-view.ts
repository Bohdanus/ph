import {
  EMPTY_FIT,
  FIT_VIEW,
  actualPixelsZoom,
  clampZoom,
  nextZoomStep,
  normalizeRotation,
  snapRotation,
  zoomKeepingAnchor,
  type DocumentView,
  type ViewFit,
} from '../util/view-transform.ts';
import type { Point, Pos } from '../contexts/general-types.ts';

/**
 * The document view, as a module-level external store.
 *
 * WHY NOT THE DOCUMENT STORE. `hasUnsavedChanges` is a reducer-managed field of `StoreData`,
 * set `true` by `projectPublishedTimeline`, `SET_LAYERS` and `BATCH_UPDATES`. Panning must
 * never dirty the document — it is not an edit, it is a change of vantage point, and Adobe's
 * own rule groups a zoom with "a panel move or a tool switch". And a pan arrives at pointer
 * move rate, so routing it through `StoreProvider` would re-render the whole layer tree once
 * per frame.
 *
 * WHY MODULE-LEVEL AND NOT REACT STATE. `document-gesture.ts` and `dragCursorLock.ts` are
 * both module-level for the same reason, and that file states it: *"claiming a gesture must
 * not re-render anything."* Here the requirement is stronger, because the hot path
 * (`screenToDocument`, called by `getLocalCoords` on every pointermove of every tool) must
 * read the view SYNCHRONOUSLY. A ref inside a component would force every coordinate
 * conversion to take a prop or a context read to reach it.
 *
 * WHY THERE ARE TWO READ FUNCTIONS. `getView()` is the hot path and returns the live object
 * for synchronous arithmetic; `getSnapshot()` is for `useSyncExternalStore`, and returns a
 * cached object whose IDENTITY changes only when the zoom level or the fit does. That is not
 * an optimisation detail — it is what stops the options-bar readout from re-rendering on
 * every pan frame. A snapshot that changed identity whenever `dx` moved would turn every
 * frame of a drag into a React render, which is exactly the "smooth and responsive"
 * requirement failing.
 */

let view: DocumentView = { ...FIT_VIEW };
let fit: ViewFit = { ...EMPTY_FIT };

/**
 * What a subscriber can actually SEE of the view.
 *
 * Deliberately excludes `dx`/`dy`. A pan changes the offset sixty times a second and changes
 * nothing a rendered control displays, so including it here would re-render the options-bar
 * readout on every frame of a drag. Anything that needs the offset reads `getView()`.
 */
export type ViewSnapshot = {
  /** The zoom multiplier over the contain fit. `1` is Fit on Screen. */
  zoom: number;
  /** CSS px per document px at `zoom === 1`, from `containFit()`. */
  fitScale: number;
  /** `fitScale * zoom * 100` — the level against actual pixels, which is what a user reads. */
  absolutePercent: number;
  /**
   * The view's rotation in degrees.
   *
   * Present because the Rotate View options bar's angle FIELD renders from it: without it the
   * transform would tilt while the displayed number stayed at zero. Excluding `dx`/`dy` is still
   * the point of this type — a pan changes neither of these three, so panning re-renders nothing.
   */
  rotation: number;
};

/**
 * The cached `useSyncExternalStore` snapshot. Rebuilt only when something a subscriber can
 * SEE changes — the zoom level or the fit — and never when `dx`/`dy` move, so a pan produces
 * no subscriber re-renders at all.
 */
let snapshot: ViewSnapshot = buildSnapshot();

const listeners = new Set<() => void>();

function buildSnapshot(): ViewSnapshot {
  const scale = fit.fitScale > 0 ? fit.fitScale : 1;
  return {
    zoom: view.zoom,
    fitScale: scale,
    absolutePercent: scale * view.zoom * 100,
    rotation: view.rotation,
  };
}

function notify() {
  for (const listener of listeners) listener();
}

/**
 * Publish a new view and notify if anything observable moved.
 *
 * NO CLAMPING, deliberately — see the header of `view-transform.ts` for why, and for the fact
 * that `fitToScreen()` is therefore a recovery path rather than a convenience. The one bound
 * worth keeping is in `panBy`, which refuses a non-finite delta: that is a refusal to write
 * `NaN` into a CSS transform, not a limit on where the document may sit.
 *
 * Subscribers are notified whenever the VIEW moved, including when only `dx`/`dy` moved and
 * the snapshot object is unchanged. That is deliberate and it is what makes
 * `useSyncExternalStore` do the right thing twice over: `useViewTransform` must re-apply the
 * CSS transform on a pan, and the options-bar readout must NOT re-render on one.
 * `useSyncExternalStore` re-reads the snapshot on every notification and re-renders only if
 * the object identity changed — so one notification channel serves both, and the two
 * behaviours come from the two consumers rather than from two stores.
 */
function commit(next: DocumentView): void {
  // `rotation` is in this test and not only in the snapshot comparison below. It was missing from
  // both at first, and the consequence is the whole failure mode this store is shaped to avoid:
  // the view assignment happens before this early return, so the canvas TILTED while nothing
  // notified — the Rotation Angle field kept showing 0 and no subscriber re-rendered. The
  // snapshot comparison cannot catch it, because a write that returns early never reaches it.
  const moved =
    next.dx !== view.dx || next.dy !== view.dy || next.zoom !== view.zoom || next.rotation !== view.rotation;
  view = next;
  if (!moved) return;

  const nextSnapshot = buildSnapshot();
  // Identity is the whole mechanism, so the comparison is on the numbers rather than on the
  // object: a subscriber re-renders when it is handed a different object. `rotation` is in the
  // comparison for the same reason `zoom` is — the Rotate View field displays it.
  if (
    nextSnapshot.zoom !== snapshot.zoom ||
    nextSnapshot.absolutePercent !== snapshot.absolutePercent ||
    nextSnapshot.rotation !== snapshot.rotation
  ) {
    snapshot = nextSnapshot;
  }
  notify();
}

/** The live view, for synchronous arithmetic on the pointer path. Do not retain it. */
export function getView(): DocumentView {
  return view;
}

/** The current fit metrics, for synchronous arithmetic on the pointer path. */
export function getFit(): ViewFit {
  return fit;
}

/** The `useSyncExternalStore` snapshot. Stable identity while only `dx`/`dy` change. */
export function getSnapshot() {
  return snapshot;
}

/** Subscribe to zoom-level changes. Returns an unsubscribe function. */
export function subscribeView(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Publish the container and document measurements the view depends on.
 *
 * Called from `Main` on every resize, from the `onResize` callback `usePointerPosition`
 * already invokes — so nothing here re-measures the DOM. It touches the VIEW not at all: a
 * resize changes how big the document is drawn, not where the user has put it, so the offset
 * and the zoom carry across untouched and the document stays exactly where it was left.
 *
 * That is a change of behaviour, not a simplification of an unchanged one. The fit used to be
 * re-clamped here, which meant shrinking the window could quietly move a panned document and
 * then, at a smaller size, refuse to move it further — the same conflation of "useful" with
 * "permitted" that the pan clamp itself carried.
 *
 * It rebuilds the snapshot UNCONDITIONALLY, which is why it does not go through `commit`: a
 * window resize can change `fitScale` while leaving `dx`/`dy`/`zoom` exactly where they were,
 * and `commit` would see no movement and return early, leaving the zoom percentage stale. A
 * fit change is rare and genuinely changes what a subscriber can see, so it always notifies.
 */
export function setFitMetrics(next: ViewFit): void {
  const unchanged =
    next.fitScale === fit.fitScale &&
    next.offsetX === fit.offsetX &&
    next.offsetY === fit.offsetY &&
    next.containerWidth === fit.containerWidth &&
    next.containerHeight === fit.containerHeight &&
    next.imageWidth === fit.imageWidth &&
    next.imageHeight === fit.imageHeight;
  if (unchanged) return;

  fit = { ...next };
  snapshot = buildSnapshot();
  notify();
}

/**
 * Move the view by a pointer delta, in CSS px.
 *
 * `dx`/`dy` arrive undivided — a pan wants the raw screen delta, not the document-space one
 * `getLocalCoords` computes, because dividing by the scale would make the document track the
 * pointer at a different rate than it moves.
 */
export function panBy(dx: number, dy: number): void {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
  // Spread rather than rebuild: a pan must carry `rotation` across. Naming the three fields it
  // was written with would compile until `rotation` was added and then quietly level the view
  // the first time someone dragged with the canvas tilted.
  commit({ ...view, dx: view.dx + dx, dy: view.dy + dy });
}

/** Fit on Screen: the whole document, centred, at the fit scale. */
export function fitToScreen(): void {
  commit({ ...FIT_VIEW });
}

/**
 * Actual Pixels: one document pixel on one screen pixel.
 *
 * Adobe's `Ctrl+1`. Note that this is `1 / fitScale`, not `zoom = 1` — `zoom = 1` IS Fit on
 * Screen, which is why the multiplier is stored over the fit rather than as an absolute scale.
 */
export function setActualPixels(): void {
  commit({ ...view, zoom: actualPixelsZoom(fit) });
}

/** Set the zoom multiplier outright, keeping the view centred on its current point. */
export function setZoom(zoom: number): void {
  const size = { width: fit.containerWidth, height: fit.containerHeight };
  const center: Point = { x: size.width / 2, y: size.height / 2 };
  const rect: Pos = { x: 0, y: 0, width: size.width, height: size.height };
  commit(zoomKeepingAnchor(view, zoom, center, rect, fit));
}

/**
 * Set the view's rotation in degrees, normalized into `(MIN_ROTATION, MAX_ROTATION]`.
 *
 * Pan and zoom are untouched: Adobe's Reset View is documented as returning to "normal
 * orientation", which is the angle and nothing else. A rotation also must not disturb the pan —
 * it composes with it through the same transform, so both are independent fields of one view
 * rather than two steps in a sequence.
 *
 * The only normalization is wrapping, not clamping, because an angle is cyclic: 360° and 0° are
 * the same orientation and reporting them differently is how a readout ends up disagreeing with
 * the screen.
 */
export function setRotation(degrees: number): void {
  commit({ ...view, rotation: normalizeRotation(degrees) });
}

/** Set the rotation and, when `snap` is set, to the nearest `step` of it. For a `Shift`-held drag. */
export function setSnappedRotation(degrees: number, snap: boolean): void {
  commit({ ...view, rotation: normalizeRotation(snap ? snapRotation(degrees) : degrees) });
}

/** Step the zoom up (`1`) or down (`-1`) the ladder, holding the centre. */
export function stepZoom(direction: 1 | -1): void {
  setZoom(nextZoomStep(view.zoom, direction));
}

/** Zoom to `nextZoom` while keeping the document point under `client` under the pointer. */
export function zoomAt(client: Point, rect: Pos, nextZoom: number): void {
  commit(zoomKeepingAnchor(view, clampZoom(nextZoom), client, rect, fit));
}

/** Step the zoom at a pointer position, for a wheel gesture. */
export function stepZoomAt(client: Point, rect: Pos, direction: 1 | -1): void {
  zoomAt(client, rect, nextZoomStep(view.zoom, direction));
}

/**
 * Drop every trace of the previous document's view.
 *
 * Called when the document identity changes. `fitScale` belongs to the old document's
 * dimensions, so carrying `zoom` across would open the new document at an arbitrary
 * magnification of the old one's fit.
 */
export function resetView(): void {
  fit = { ...EMPTY_FIT };
  view = { ...FIT_VIEW };
  snapshot = buildSnapshot();
  notify();
}

/**
 * Test seam: restore the identity view and the empty fit.
 *
 * Not a production affordance. The store is module-level, so its state outlives every mount
 * and a test that leaves a zoom behind would fail the next case for a reason that has nothing
 * to do with the case. `document-gesture.ts` solves the identical problem with
 * `resetDocumentGestures()`, which its provider calls on mount and on cleanup.
 */
export function resetViewForTest(): void {
  resetView();
}
