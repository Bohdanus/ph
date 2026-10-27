import { describe, expect, it } from 'vitest';

import {
  MAX_ZOOM,
  MIN_ZOOM,
  MIN_ROTATION,
  MAX_ROTATION,
  ZOOM_LADDER,
  absoluteScalePercent,
  actualPixelsZoom,
  clampZoom,
  composeTransform,
  formatZoomPercent,
  isIdentityView,
  nextZoomStep,
  normalizeRotation,
  snapRotation,
  rotatePoint,
  screenToDocument,
  toViewFit,
  zoomKeepingAnchor,
  FIT_VIEW,
  type DocumentView,
  type ViewFit,
} from '../view-transform.ts';
import type { ContainDimensions } from '../contain-fit.ts';

/**
 * A container 1000x500 holding a 1000x2000 document.
 *
 * The tall aspect is deliberate: `containFit` gives `scale = min(1, 0.25) = 0.25`, so the fitted
 * bitmap is 250x500 — full height, letterboxed 375px either side horizontally. That makes the two
 * axes behave DIFFERENTLY at fit, which is the case the pan clamp's two branches exist for, and
 * it makes the fit scale a non-round number so the Actual Pixels multiplier (`1 / 0.25 = 4`) lands
 * on a ladder rung instead of hiding a rounding error.
 */
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

describe('the rotation guard, written before the rotation existed', () => {
  it('reduces to the pre-view-transform mapping at rotation 0', () => {
    // THE GUARD. Written before the change it guards, because the one thing a rotation term in
    // `screenToDocument` can do silently is fail to vanish at zero — and nothing else in the app
    // would notice, since every coordinate conversion feeds a gesture that would still land
    // somewhere plausible. It is the same property V1 was for the transform itself.
    const legacy = (clientX: number, offsetX: number, scale: number, rectX: number) =>
      (clientX - offsetX - rectX) / scale;

    for (const clientX of [0, 250, 375, 500, 624, 1000, 1400]) {
      const { x } = screenToDocument({ x: clientX, y: 100 }, ORIGIN, FIT, { ...FIT_VIEW, rotation: 0 });
      expect(x).toBe(legacy(clientX, FIT.offsetX, FIT.fitScale, ORIGIN.x));

      const { y } = screenToDocument({ x: 100, y: clientX }, ORIGIN, FIT, { ...FIT_VIEW, rotation: 0 });
      expect(y).toBe(legacy(clientX, FIT.offsetY, FIT.fitScale, ORIGIN.y));
    }
  });
});

describe('the identity is the fit view', () => {
  it('writes no transform at all rather than scale(1)', () => {
    // The whole visual-regression argument. `scale(1)` is visually a no-op but can promote the
    // element to a composited layer and change how the canvas rasterises, which would move every
    // baseline for no visible reason.
    expect(isIdentityView(FIT_VIEW)).toBe(true);
    expect(composeTransform(FIT_VIEW)).toBe('');
  });

  it('writes translate before scale, so the offset is in the container space', () => {
    expect(composeTransform({ dx: 10, dy: -20, zoom: 3, rotation: 0 })).toBe('translate(10px, -20px) scale(3)');
  });
});

describe('screenToDocument', () => {
  it('reduces exactly to the mapping the app used before the view transform existed', () => {
    // The property that let `usePointerPosition`'s existing suite pass unmodified. The pre-view
    // expression was `(clientX - offsetX - rect.x) / scale`; at zoom 1 with no offset the `cx`
    // terms must cancel to it, for every point and both axes.
    const legacy = (clientX: number, offsetX: number, scale: number, rectX: number) =>
      (clientX - offsetX - rectX) / scale;

    for (const clientX of [0, 1, 250, 375, 500, 624, 999, 1000, 1400]) {
      const { x } = screenToDocument({ x: clientX, y: 100 }, ORIGIN, FIT, FIT_VIEW);
      expect(x).toBe(legacy(clientX, FIT.offsetX, FIT.fitScale, ORIGIN.x));

      const { y } = screenToDocument({ x: 100, y: clientX }, ORIGIN, FIT, FIT_VIEW);
      expect(y).toBe(legacy(clientX, FIT.offsetY, FIT.fitScale, ORIGIN.y));
    }
  });

  it('lands the fitted bitmap edges on the document edges', () => {
    // The bitmap occupies [375, 625] horizontally and [0, 500] vertically at fit.
    expect(screenToDocument({ x: 375, y: 0 }, ORIGIN, FIT, FIT_VIEW)).toEqual({ x: 0, y: 0 });
    expect(screenToDocument({ x: 625, y: 500 }, ORIGIN, FIT, FIT_VIEW)).toEqual({ x: 1000, y: 2000 });
  });

  it('moves the document point under the cursor with the image', () => {
    // A pan moves the IMAGE by the offset, so the content under a given client point slides by
    // the offset too. Panning by `d` therefore means the point seen at `X` is the point seen at
    // `X + d` before the pan — not that the point under the cursor stays put.
    for (const d of [60, -60, 250]) {
      const before = screenToDocument({ x: 500, y: 250 }, ORIGIN, FIT, FIT_VIEW);
      const after = screenToDocument({ x: 500 + d, y: 250 + d }, ORIGIN, FIT, { dx: d, dy: d, zoom: 1, rotation: 0 });

      expect(after.x).toBeCloseTo(before.x, 8);
      expect(after.y).toBeCloseTo(before.y, 8);
    }
  });

  it('leaves the container centre on the same point at any zoom', () => {
    // `transform-origin: center center` means the container centre is the fixed point of the
    // scale, and the clamp is symmetric about it.
    const centre = { x: 500, y: 250 };

    for (const zoom of [1, 2, 4, 8]) {
      const view = { dx: 0, dy: 0, zoom, rotation: 0 };
      expect(screenToDocument(centre, ORIGIN, FIT, view)).toEqual(screenToDocument(centre, ORIGIN, FIT, FIT_VIEW));
    }
  });

  it('survives a degenerate fit without producing NaN', () => {
    const empty: ViewFit = {
      fitScale: 0,
      offsetX: 0,
      offsetY: 0,
      containerWidth: 0,
      containerHeight: 0,
      imageWidth: 0,
      imageHeight: 0,
    };

    for (const value of [screenToDocument({ x: 10, y: 10 }, ORIGIN, empty, { dx: 0, dy: 0, zoom: 1, rotation: 0 })]) {
      expect(Number.isFinite(value.x)).toBe(true);
      expect(Number.isFinite(value.y)).toBe(true);
    }
  });
});

describe('the zoom percentage is against actual pixels, not against the fit', () => {
  it('reports the fit scale at Fit on Screen rather than 100%', () => {
    // The options bar prints this. A 1000x2000 document fitted into 1000x500 is at 25%, which is
    // what Photoshop shows — printing the raw multiplier would read `100%` and be wrong.
    expect(absoluteScalePercent(FIT, FIT_VIEW)).toBe(25);
    expect(formatZoomPercent(FIT, FIT_VIEW)).toBe('25%');
  });

  it('reports 100% at Actual Pixels', () => {
    expect(absoluteScalePercent(FIT, { dx: 0, dy: 0, zoom: 4, rotation: 0 })).toBe(100);
  });

  it('rounds for display but not for the arithmetic', () => {
    expect(formatZoomPercent(FIT, { dx: 0, dy: 0, zoom: 1.0102, rotation: 0 })).toBe('25%');
    expect(absoluteScalePercent(FIT, { dx: 0, dy: 0, zoom: 1.0102, rotation: 0 })).toBeCloseTo(25.255, 10);
  });
});

describe('actualPixelsZoom', () => {
  it('is one document pixel per screen pixel, which is the inverse of the fit', () => {
    expect(actualPixelsZoom(FIT)).toBe(4);
    expect(absoluteScalePercent(FIT, { dx: 0, dy: 0, zoom: actualPixelsZoom(FIT), rotation: 0 })).toBe(100);
  });

  it('falls back to the identity for a fit it cannot invert', () => {
    expect(actualPixelsZoom({ ...FIT, fitScale: 0 })).toBe(1);
  });
});

describe('clampZoom', () => {
  it('holds the zoom at both ends of the range', () => {
    expect(clampZoom(9999)).toBe(MAX_ZOOM);
    expect(clampZoom(0.0001)).toBe(MIN_ZOOM);
  });

  it('rejects a non-finite or non-positive zoom rather than propagating it', () => {
    expect(clampZoom(Number.NaN)).toBe(1);
    expect(clampZoom(-3)).toBe(1);
  });
});

describe('nextZoomStep', () => {
  it('walks up and down the ladder', () => {
    expect(nextZoomStep(1, 1)).toBe(2);
    expect(nextZoomStep(2, 1)).toBe(3);
    expect(nextZoomStep(2, -1)).toBe(1);
    expect(nextZoomStep(1, -1)).toBe(0.6667);
  });

  it('reaches a rung from between two, choosing the nearer one in that direction', () => {
    // `Ctrl+1` lands on `1 / fitScale`, which is rarely a rung, so the ladder has to be
    // enterable from an arbitrary value rather than only by stepping along it.
    expect(nextZoomStep(4.4, 1)).toBe(6);
    expect(nextZoomStep(4.4, -1)).toBe(4);
  });

  it('holds at the ends rather than running off the ladder', () => {
    expect(nextZoomStep(MAX_ZOOM, 1)).toBe(MAX_ZOOM);
    expect(nextZoomStep(MIN_ZOOM, -1)).toBe(MIN_ZOOM);
  });

  it('steps off a rung in either direction, except at the ends of the range', () => {
    // The epsilon has to swallow the rounding error in the ladder's own values, or every press of
    // `+` from 0.6667 would take two steps. The two ends are excluded because they are held: at
    // `MIN_ZOOM` there is nothing below to reach, so the "return the input unchanged" branch is
    // the correct answer and not a defect.
    for (const rung of ZOOM_LADDER) {
      if (rung < MIN_ZOOM || rung > MAX_ZOOM) continue;

      // Both ends are held: at `MIN_ZOOM` there is nothing below and at `MAX_ZOOM` nothing above,
      // so "return the input unchanged" is the correct answer there and not a defect.
      if (rung < MAX_ZOOM) expect(nextZoomStep(rung, 1)).toBeGreaterThan(rung);
      if (rung > MIN_ZOOM) expect(nextZoomStep(rung, -1)).toBeLessThan(rung);
    }
  });
});

describe('zoomKeepingAnchor', () => {
  // Over the BITMAP, which is the region an anchor can actually be honoured in: at fit the
  // document fills y 0..500 and x 375..625, so x 500 and y 200 are both inside it.
  const client = { x: 500, y: 200 };

  it('holds the document point under the pointer', () => {
    // The whole reason a wheel zoom reads as moving a window rather than jumping the document.
    for (const next of [2, 4, 8]) {
      const before = screenToDocument(client, ORIGIN, FIT, FIT_VIEW);
      const after = zoomKeepingAnchor(FIT_VIEW, next, client, ORIGIN, FIT);

      const landed = screenToDocument(client, ORIGIN, FIT, after);
      expect(landed.x).toBeCloseTo(before.x, 8);
      expect(landed.y).toBeCloseTo(before.y, 8);
    }
  });

  it('leaves the offset free, because there is no position bound to honour', () => {
    // The view has no clamp, so nothing constrains where the solve may put the document — not the
    // window, and not the zoom level. The zoom range is still bounded by `clampZoom`, which is a
    // scale limit rather than a position one.
    const zoomed = zoomKeepingAnchor(FIT_VIEW, 8, client, ORIGIN, FIT);
    expect(zoomed.zoom).toBe(8);
    expect(Number.isFinite(zoomed.dx)).toBe(true);
    expect(Number.isFinite(zoomed.dy)).toBe(true);
  });

  it('honours an anchor over the letterbox by shifting the image, not by refusing it', () => {
    // x 700 is past the bitmap's right edge at 625, so there is no document pixel under the
    // pointer to hold there — the fit resolves it to a point past the right edge. Zooming in
    // cannot bring a non-existent pixel under the cursor, and with no clamp the solve keeps
    // that point of SPACE where it was, which is what Adobe does when the cursor is over
    // pasteboard. The old expectation here was `dx === 0`, which was the clamp talking.
    const inGutter = { x: 700, y: 200 };

    const before = screenToDocument(inGutter, ORIGIN, FIT, FIT_VIEW);
    expect(before.x).toBeGreaterThan(FIT.imageWidth);

    const after = zoomKeepingAnchor(FIT_VIEW, 2, inGutter, ORIGIN, FIT);

    // The gutter point still reads as the same place in space, which is the whole claim.
    const landed = screenToDocument(inGutter, ORIGIN, FIT, after);
    expect(landed.x).toBeCloseTo(before.x, 8);
    expect(landed.y).toBeCloseTo(before.y, 8);
    expect(after.dx).not.toBe(0);
  });
});

describe('toViewFit', () => {
  it('promotes a contain fit without re-deriving any of it', () => {
    const dimensions: ContainDimensions = {
      innerWidth: 250,
      innerHeight: 500,
      outerWidth: 1000,
      outerHeight: 500,
      offsetX: 375,
      offsetY: 0,
      scale: 0.25,
    };

    expect(toViewFit(dimensions, { width: 1000, height: 2000 })).toEqual(FIT);
  });
});

describe('rotatePoint', () => {
  it('turns east to south at 90°, which is the sense CSS rotate() turns', () => {
    // The sign convention is load-bearing and only shows up on an asymmetric drag: a clockwise
    // `rotate()` in screen coordinates takes the +x axis to +y, and a flip here would render a
    // canvas that turns the wrong way while every unit test still passed.
    const turned = rotatePoint({ x: 10, y: 0 }, 90);
    expect(turned.x).toBeCloseTo(0, 10);
    expect(turned.y).toBeCloseTo(10, 10);
  });

  it('is a no-op at zero, and returns the point itself', () => {
    const point = { x: 3, y: -7 };
    expect(rotatePoint(point, 0)).toBe(point);
  });

  it('returns the point itself for a non-finite angle rather than NaN coordinates', () => {
    const point = { x: 3, y: -7 };
    expect(rotatePoint(point, Number.NaN)).toBe(point);
  });

  it('is its own inverse at the same angle', () => {
    const point = { x: 12, y: -5 };
    const there = rotatePoint(point, 37);
    const back = rotatePoint(there, -37);
    expect(back.x).toBeCloseTo(point.x, 10);
    expect(back.y).toBeCloseTo(point.y, 10);
  });

  it('leaves the origin where it is at any angle', () => {
    const turned = rotatePoint({ x: 0, y: 0 }, 143);
    expect(turned.x).toBeCloseTo(0, 10);
    expect(turned.y).toBeCloseTo(0, 10);
  });
});

describe('normalizeRotation', () => {
  it('wraps rather than clamps, because an angle is cyclic', () => {
    expect(normalizeRotation(370)).toBe(10);
    expect(normalizeRotation(-10)).toBe(-10);
    expect(normalizeRotation(190)).toBe(-170);
    expect(normalizeRotation(720 + 45)).toBe(45);
  });

  it('reports the same orientation the same way at both ends of the circle', () => {
    // A plain `% 360` would report 350 as -10 AND 190 as 190 — the same orientation twice, and a
    // readout that disagrees with itself depending on which way the user arrived.
    expect(normalizeRotation(350)).toBe(-10);
    expect(normalizeRotation(-10)).toBe(-10);
  });

  it('holds the range at (-180, 180], so exactly one of the two ends is reachable', () => {
    // Half-open on purpose: -180 and 180 are the same orientation, and the range has to pick one
    // of them or a displayed angle has two spellings for one picture.
    expect(normalizeRotation(MAX_ROTATION)).toBe(MAX_ROTATION);
    expect(normalizeRotation(MIN_ROTATION)).toBe(MAX_ROTATION);
    expect(normalizeRotation(-180.0001)).toBeCloseTo(179.9999, 6);
  });

  it('falls back to zero for a non-finite angle', () => {
    expect(normalizeRotation(Number.NaN)).toBe(0);
  });
});

describe('snapRotation', () => {
  it('lands on the nearest 15°', () => {
    expect(snapRotation(7)).toBe(0);
    expect(snapRotation(8)).toBe(15);
    expect(snapRotation(23)).toBe(30);
    expect(snapRotation(-8)).toBe(-15);
  });

  it('leaves an angle alone when the step is not usable', () => {
    expect(snapRotation(23, 0)).toBe(23);
    expect(snapRotation(Number.NaN)).toBeNaN();
  });
});

describe('a rotated view', () => {
  const rotated: DocumentView = { dx: 0, dy: 0, zoom: 1, rotation: 30 };

  it('writes no transform when the rotation is zero', () => {
    // The baseline guard. Every visual regression in the suite runs at rotation 0, so a
    // `rotate(0deg)` here would put a non-empty transform on all thirteen of them.
    expect(isIdentityView(FIT_VIEW)).toBe(true);
    expect(isIdentityView({ ...FIT_VIEW, rotation: 0 })).toBe(true);
    expect(composeTransform({ ...FIT_VIEW, rotation: 0 })).toBe('');
    // And it is not the identity the moment the angle is anything else.
    expect(isIdentityView(rotated)).toBe(false);
  });

  it('appends the rotation after the scale, so it turns about the origin', () => {
    // Order is the contract: CSS applies rightmost first, so `rotate` last means the rotation
    // happens FIRST, about `transform-origin`, before the zoom and the pan displace it.
    expect(composeTransform(rotated)).toBe('translate(0px, 0px) scale(1) rotate(30deg)');
  });

  it('leaves the document centre on the document centre at any angle', () => {
    // `transform-origin: center center` makes the container centre the fixed point of the
    // rotation, which is what makes Reset View a real "upright".
    const centre = { x: 500, y: 250 };
    expect(screenToDocument(centre, ORIGIN, FIT, rotated)).toEqual(screenToDocument(centre, ORIGIN, FIT, FIT_VIEW));
  });

  it('round-trips a document point through the rotation', () => {
    // Forward, then inverse. The forward direction is written out here rather than read from the
    // DOM, so the pair is a real statement about the two halves agreeing — and the client point
    // is built with `rotatePoint`, because feeding the INVERSE's own output back into it is what
    // would make a sign error cancel out and the test pass anyway.
    const fit = FIT;
    const O = { x: fit.containerWidth / 2, y: fit.containerHeight / 2 };
    const scale = fit.fitScale * rotated.zoom;

    for (const point of [
      { x: 0, y: 0 },
      { x: 400, y: 900 },
      { x: 1000, y: 2000 },
    ]) {
      const local = { x: point.x * scale + fit.offsetX, y: point.y * scale + fit.offsetY };
      const turned = rotatePoint(
        { x: (local.x - O.x) * rotated.zoom, y: (local.y - O.y) * rotated.zoom },
        rotated.rotation
      );
      const client = { x: O.x + turned.x + rotated.dx, y: O.y + turned.y + rotated.dy };

      const back = screenToDocument(client, ORIGIN, fit, rotated);
      expect(back.x).toBeCloseTo(point.x, 6);
      expect(back.y).toBeCloseTo(point.y, 6);
    }
  });

  it('turns clockwise, so the screen point east of centre comes to show the document north of it', () => {
    // The direction check, and the one the round-trip cannot make: that test is symmetric in the
    // sign, so a flip here would still pass it. The document's own centre, in document pixels, is
    // where the client centre maps at Fit — so "east then north" is stated against that.
    const centreOfDocument = screenToDocument({ x: 500, y: 250 }, ORIGIN, FIT, FIT_VIEW);
    const eastOfCentre = { x: 600, y: 250 };

    const upright = screenToDocument(eastOfCentre, ORIGIN, FIT, FIT_VIEW);
    expect(upright.x).toBeGreaterThan(centreOfDocument.x);

    const turned = screenToDocument(eastOfCentre, ORIGIN, FIT, { ...FIT_VIEW, rotation: 90 });
    expect(turned.y).toBeLessThan(centreOfDocument.y);
  });

  it('keeps the anchor under the pointer while the view is already tilted', () => {
    // The reason `zoomKeepingAnchor` had to learn about rotation: a wheel zoom on a tilted view
    // that solved as though it were upright would walk the anchor away on every step.
    const client = { x: 640, y: 180 };

    for (const zoom of [2, 4, 8]) {
      const before = screenToDocument(client, ORIGIN, FIT, rotated);
      const after = zoomKeepingAnchor(rotated, zoom, client, ORIGIN, FIT);

      expect(after.rotation).toBe(30);

      const landed = screenToDocument(client, ORIGIN, FIT, after);
      expect(landed.x).toBeCloseTo(before.x, 6);
      expect(landed.y).toBeCloseTo(before.y, 6);
    }
  });
});
