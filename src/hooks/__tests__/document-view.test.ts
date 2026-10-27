import { afterEach, describe, expect, it, vi } from 'vitest';

import { absoluteScalePercent, FIT_VIEW, type DocumentView, type ViewFit } from '../../util/view-transform.ts';
import {
  fitToScreen,
  getFit,
  getSnapshot,
  getView,
  panBy,
  resetViewForTest,
  setActualPixels,
  setRotation,
  setSnappedRotation,
  setFitMetrics,
  setZoom,
  stepZoom,
  stepZoomAt,
  subscribeView,
  zoomAt,
} from '../document-view.ts';

/** The same container and document as `view-transform.test.ts`: 1000x500 holding 1000x2000. */
const FIT: ViewFit = {
  fitScale: 0.25,
  offsetX: 375,
  offsetY: 0,
  containerWidth: 1000,
  containerHeight: 500,
  imageWidth: 1000,
  imageHeight: 2000,
};

const ORIGIN = { x: 0, y: 0, width: 1000, height: 500 };

/**
 * A fit whose bitmap is larger than the container on BOTH axes, so the pan has freedom to move
 * in both directions: 2000x1000 of bitmap against 1000x500 of container at `fitScale: 1` gives
 * x ±500 and y ±250.
 *
 * `ZOOMED_IN` is deliberately not this file's `FIT` with a bigger zoom — at zoom 1 on a
 * 1000x2000 document the bitmap is 250x500, so it is letterboxed horizontally and `dx` is pinned
 * to zero on that axis. A fixture with that shape cannot demonstrate a two-axis pan at all.
 */
const ZOOMED_IN: ViewFit = {
  fitScale: 1,
  offsetX: 0,
  offsetY: 0,
  containerWidth: 1000,
  containerHeight: 500,
  imageWidth: 2000,
  imageHeight: 1000,
};

const fitWith = (fit: ViewFit) => {
  setFitMetrics(fit);
  fitToScreen();
};

afterEach(() => {
  resetViewForTest();
});

describe('the store starts at the fit', () => {
  it('reports Fit on Screen before anything has measured the container', () => {
    expect(getView()).toEqual(FIT_VIEW);
    expect(getFit().containerWidth).toBe(0);
  });
});

describe('panBy', () => {
  it('moves the offset and leaves the zoom alone', () => {
    fitWith(ZOOMED_IN);

    panBy(40, -25);

    expect(getView()).toEqual({ dx: 40, dy: -25, zoom: 1, rotation: 0 });
  });

  it('is never clamped, so a drag moves the image as far as it is dragged', () => {
    // Adobe's Hand does not hold the image inside the window either, and the earlier clamp was
    // this app's own addition — recorded as a divergence in the Hand's own `appNotes`. The
    // consequence is that the document CAN be left out of sight, which is why `fitToScreen` is a
    // recovery path rather than a convenience.
    fitWith(ZOOMED_IN);

    panBy(99999, 99999);

    expect(getView()).toEqual({ dx: 99999, dy: 99999, zoom: 1, rotation: 0 });
  });

  it('moves the image at Fit on Screen too, which is the case the clamp used to make dead', () => {
    // FIT's bitmap is letterboxed on both axes, so the two-branch clamp pinned every offset to
    // zero here — a drag at the zoom a user meets first did nothing at all.
    fitWith(FIT);

    panBy(40, -25);

    expect(getView()).toEqual({ dx: 40, dy: -25, zoom: 1, rotation: 0 });
  });

  it('ignores a non-finite delta rather than poisoning the view with NaN', () => {
    fitWith(ZOOMED_IN);

    panBy(Number.NaN, 10);

    expect(getView()).toEqual({ dx: 0, dy: 0, zoom: 1, rotation: 0 });
    expect(Number.isFinite(getView().dy)).toBe(true);
  });
});

describe('the snapshot identity is what stops a pan re-rendering anything', () => {
  it('keeps the SAME object across a pan', () => {
    fitWith(ZOOMED_IN);

    const before = getSnapshot();

    panBy(10, 10);
    panBy(10, 10);

    // `useSyncExternalStore` re-renders a subscriber when it is handed a different object. A
    // snapshot that changed identity on every drag would turn each pan frame into a React render,
    // which is the whole "smooth and responsive" requirement failing.
    expect(getSnapshot()).toBe(before);
  });

  it('hands out a NEW object when the zoom level changes', () => {
    fitWith(ZOOMED_IN);

    const before = getSnapshot();
    setZoom(2);

    expect(getSnapshot()).not.toBe(before);
    expect(getSnapshot().zoom).toBe(2);
  });

  it('rebuilds the percentage from the fit, and does so on a fit change alone', () => {
    fitWith(FIT);
    expect(getSnapshot().absolutePercent).toBe(25);

    // A resize can change the fit while leaving the view where it was. The percentage has to
    // follow the fit, and `commit` sees no view movement in that case — so `setFitMetrics`
    // rebuilds the snapshot unconditionally rather than going through `commit`.
    const view: DocumentView = getView();
    setFitMetrics({ ...FIT, fitScale: 0.5, offsetX: 250 });

    expect(getView().dx).toBe(view.dx);
    expect(getSnapshot().absolutePercent).toBe(50);
  });

  it('reports the level against actual pixels rather than against the fit', () => {
    fitWith(FIT);

    expect(absoluteScalePercent(getFit(), getView())).toBe(25);

    setActualPixels();

    expect(absoluteScalePercent(getFit(), getView())).toBe(100);
    expect(getView().zoom).toBe(4);
  });
});

describe('notifying', () => {
  it('notifies on a pan, because the transform subscriber must re-apply', () => {
    fitWith(ZOOMED_IN);

    const listener = vi.fn();
    const unsubscribe = subscribeView(listener);

    panBy(5, 5);
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    panBy(5, 5);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('stays silent for a write that changes nothing', () => {
    fitWith(ZOOMED_IN);
    fitToScreen();

    const listener = vi.fn();
    const unsubscribe = subscribeView(listener);

    // A zero delta is not a pan. This used to lean on the clamp to make a real pan silent at
    // Fit, which is the case that has just become the interesting one.
    panBy(0, 0);

    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });
});

describe('setFitMetrics', () => {
  it('ignores a republish of the same measurement', () => {
    fitWith(ZOOMED_IN);

    const listener = vi.fn();
    const unsubscribe = subscribeView(listener);

    setFitMetrics({ ...ZOOMED_IN });

    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('leaves the view untouched, because a resize changes how big the document is drawn and not where it is', () => {
    fitWith(ZOOMED_IN);
    panBy(120, 200);
    setZoom(4);

    const before = getView();
    setFitMetrics({ ...ZOOMED_IN, containerHeight: 700, fitScale: 0.5 });

    // Used to be re-clamped here, so shrinking the window could quietly move a panned document.
    expect(getView()).toEqual(before);
  });

  it('still rebuilds the percentage, which is the one thing a fit does change', () => {
    fitWith(ZOOMED_IN);
    const before = getSnapshot().absolutePercent;

    setFitMetrics({ ...ZOOMED_IN, fitScale: 0.5 });

    expect(getSnapshot().absolutePercent).toBe(before * 0.5);
  });
});

describe('the zoom commands', () => {
  it('fitToScreen returns the whole view to the identity', () => {
    fitWith(ZOOMED_IN);
    setZoom(8);
    panBy(0, 200);

    fitToScreen();

    expect(getView()).toEqual(FIT_VIEW);
  });

  it('fitToScreen and setActualPixels are idempotent', () => {
    fitWith(FIT);

    fitToScreen();
    const afterFit = getSnapshot();
    fitToScreen();
    expect(getSnapshot()).toBe(afterFit);

    setActualPixels();
    const afterPixels = getSnapshot();
    setActualPixels();
    expect(getSnapshot()).toBe(afterPixels);
  });

  it('steps up and down the ladder from the centre', () => {
    fitWith(FIT);

    stepZoom(1);
    expect(getView().zoom).toBe(2);

    stepZoom(-1);
    expect(getView().zoom).toBe(1);
  });

  it('zoomAt applies the zoom at a pointer and leaves the offset inside the clamp', () => {
    fitWith(ZOOMED_IN);

    zoomAt({ x: 900, y: 100 }, ORIGIN, 8);

    const view = getView();
    expect(view.zoom).toBe(8);
    // Clamped rather than left at whatever the anchor solved for — at zoom 8 the bitmap is
    // 16000x8000, so the limits are ±7500 and ±3750, and an anchor near the top edge solves for
    // an offset well outside that.
    expect(Math.abs(view.dx)).toBeLessThanOrEqual(7500);
    expect(Math.abs(view.dy)).toBeLessThanOrEqual(3750);
  });

  it('stepZoomAt walks the ladder at a pointer rather than at the centre', () => {
    fitWith(ZOOMED_IN);

    stepZoomAt({ x: 900, y: 100 }, ORIGIN, 1);
    const fromCorner = getView();

    fitWith(ZOOMED_IN);
    stepZoomAt({ x: 500, y: 250 }, ORIGIN, 1);
    const fromMiddle = getView();

    expect(fromCorner.zoom).toBe(fromMiddle.zoom);
    // Different anchors on the same zoom step produce different offsets, which is the point of
    // anchoring at the pointer at all.
    expect(fromCorner).not.toEqual(fromMiddle);
  });
});

describe('resetViewForTest', () => {
  it('drops the view and the fit, so a leak cannot reach the next case', () => {
    fitWith(ZOOMED_IN);
    setZoom(4);

    resetViewForTest();

    expect(getView()).toEqual(FIT_VIEW);
    expect(getFit().containerWidth).toBe(0);
  });
});

describe('the rotation', () => {
  it('starts upright, and Reset View returns to upright', () => {
    fitWith(FIT);

    expect(getView().rotation).toBe(0);

    setRotation(42);
    expect(getView().rotation).toBe(42);

    fitToScreen();
    expect(getView().rotation).toBe(0);
  });

  it('leaves the pan and the zoom alone, which is what makes Reset View a rotation and not a fit', () => {
    fitWith(ZOOMED_IN);
    panBy(120, -60);
    setZoom(4);
    setRotation(30);

    const before = getView();
    setRotation(0);

    // Adobe says Reset View returns to "normal orientation", which is the angle. A control that
    // also re-fitted and re-centred would be a second command wearing this one's name.
    expect(getView()).toEqual({ ...before, rotation: 0 });
  });

  it('wraps rather than clamps, so an angle never reports two spellings for one orientation', () => {
    fitWith(FIT);

    setRotation(370);
    expect(getView().rotation).toBe(10);

    setRotation(190);
    expect(getView().rotation).toBe(-170);

    setRotation(720 + 45);
    expect(getView().rotation).toBe(45);
  });

  it('snaps to 15° only when asked, so a typed angle is taken as typed', () => {
    fitWith(FIT);

    // 23 is nearer 30 (7 away) than 15 (8 away), so this also pins which side `Math.round`
    // breaks the tie on — a snap that picked the other rung would still be "a 15° snap".
    setSnappedRotation(23, true);
    expect(getView().rotation).toBe(30);

    setSnappedRotation(22, true);
    expect(getView().rotation).toBe(15);

    setSnappedRotation(23, false);
    expect(getView().rotation).toBe(23);
  });

  it('is republished in the snapshot, because the angle field renders from it', () => {
    fitWith(FIT);
    const before = getSnapshot();

    setRotation(30);

    // Without `rotation` in the snapshot the transform would tilt while the displayed number
    // stayed at zero.
    expect(getSnapshot()).not.toBe(before);
    expect(getSnapshot().rotation).toBe(30);
  });

  it('keeps the snapshot identity across a pan, so tilting does not make panning slow', () => {
    fitWith(ZOOMED_IN);
    setRotation(30);
    const before = getSnapshot();

    panBy(40, 40);

    expect(getSnapshot()).toBe(before);
  });

  it('survives a pan and an Actual Pixels switch, which both rebuild the view', () => {
    // Both of those name the three fields they write, and naming them is how a rotation would be
    // quietly levelled by a drag on a tilted canvas.
    fitWith(ZOOMED_IN);
    setRotation(30);

    panBy(10, 10);
    expect(getView().rotation).toBe(30);

    setActualPixels();
    expect(getView().rotation).toBe(30);
  });

  it('falls back to upright for a non-finite angle', () => {
    fitWith(ZOOMED_IN);
    setRotation(30);

    setRotation(Number.NaN);

    expect(getView().rotation).toBe(0);
  });
});
