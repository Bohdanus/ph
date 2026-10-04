import { describe, expect, it } from 'vitest';
import {
  CANVAS_REDRAW_CLIP,
  type BoundingBox,
  DEFAULT_DOCUMENT_SIZE,
  containFit,
  documentToCanvasOffset,
} from '../canvas-helpers';
import {
  SAMPLE_RADIUS,
  documentClipInBox,
  documentSampleRegion,
  sampleCentreInImage,
  sampleWindowCss,
} from '../document-sampling';

/** Workspace canvas box as the suite's specs measure it at 1280x720. */
const BOX: BoundingBox = { x: 56, y: 100, width: 974, height: 583 };

/** Two more boxes, on opposite contain-fit branches, so no single scale is the proof. */
const WIDE_BOX: BoundingBox = { x: 0, y: 0, width: 1200, height: 400 };
const TALL_BOX: BoundingBox = { x: 0, y: 0, width: 400, height: 1200 };

/** `page.screenshot({ clip })` of `windowCss` CSS px, coming back `scale` times as large. */
function decoded(windowCss: number, scale: number) {
  return { width: Math.round(windowCss * scale), height: Math.round(windowCss * scale) };
}

/** The inclusive image rows and columns a `radius` window at the centre of `image` covers. */
function windowExtent(image: { width: number; height: number }, windowCss: number, radius: number) {
  const centre = sampleCentreInImage(image, { width: windowCss, height: windowCss });
  return {
    left: Math.round(centre.x) - radius,
    right: Math.round(centre.x) + radius,
    top: Math.round(centre.y) - radius,
    bottom: Math.round(centre.y) + radius,
  };
}

describe('sampleWindowCss', () => {
  it('holds a (2r + 1) window inside the capture at 1x, which is the tight case', () => {
    // At 1x the decoded image IS the CSS size. A capture narrower than the window would
    // not fail: `getColorAtPoint` skips out-of-image pixels silently and returns a mean
    // over whatever survived, so a short capture reads as a smaller sample rather than as
    // a misconfigured one.
    const windowCss = sampleWindowCss(3);
    const image = decoded(windowCss, 1);
    const extent = windowExtent(image, windowCss, 3);

    expect(windowCss).toBe(8);
    expect(image.width).toBe(8);
    expect(extent.left).toBeGreaterThanOrEqual(0);
    expect(extent.top).toBeGreaterThanOrEqual(0);
    expect(extent.right).toBeLessThanOrEqual(image.width - 1);
    expect(extent.bottom).toBeLessThanOrEqual(image.height - 1);
    // Exactly the 7x7 average, not a clipped one.
    expect(extent.right - extent.left + 1).toBe(7);
    expect(extent.bottom - extent.top + 1).toBe(7);
  });

  it('holds the same 7x7 window when the capture comes back at 2x and at 3x', () => {
    const windowCss = sampleWindowCss(3);
    for (const scale of [2, 3]) {
      const image = decoded(windowCss, scale);
      const extent = windowExtent(image, windowCss, 3);
      expect(extent.left, `at ${scale}x`).toBeGreaterThanOrEqual(0);
      expect(extent.right, `at ${scale}x`).toBeLessThanOrEqual(image.width - 1);
      expect(extent.right - extent.left + 1, `at ${scale}x`).toBe(7);
      expect(extent.bottom - extent.top + 1, `at ${scale}x`).toBe(7);
    }
  });

  it('grows with the radius, because a wider window needs a wider capture', () => {
    expect(sampleWindowCss(0)).toBe(2);
    expect(sampleWindowCss(1)).toBe(4);
    expect(sampleWindowCss(3)).toBe(8);
    expect(sampleWindowCss(5)).toBe(12);
  });
});

/**
 * THE CLASS OF DEFECT. A CSS-pixel centre handed straight to `getColorAtPoint` addresses
 * IMAGE pixels, and at 1x the two are the same number, so the mistake is invisible on the
 * host a test was written on. Every case below is the same capture read both ways.
 */
describe('sampleCentreInImage', () => {
  it('is the identity at 1x, on both axes — which is why the mistake hides', () => {
    const windowCss = sampleWindowCss(SAMPLE_RADIUS);
    const centre = sampleCentreInImage(decoded(windowCss, 1), { width: windowCss, height: windowCss });
    expect(centre.x).toBeCloseTo(windowCss / 2, 9);
    expect(centre.y).toBeCloseTo(windowCss / 2, 9);
    // The identity case, stated as the vacuity it is: the unconverted address is the same
    // pixel here, so nothing on a 1x host can tell the two apart.
    expect(Math.round(centre.x)).toBe(windowCss / 2);
    expect(Math.round(centre.y)).toBe(windowCss / 2);
  });

  it('is exactly double the CSS centre at 2x, on BOTH axes', () => {
    const windowCss = sampleWindowCss(SAMPLE_RADIUS);
    const image = decoded(windowCss, 2);
    const centre = sampleCentreInImage(image, { width: windowCss, height: windowCss });

    // Per axis, each against the capture's OWN axis: a single scalar collapsed across both
    // passes at 1x and at a square 2x capture and fails on the captures short on one axis.
    expect(centre.x / (windowCss / 2)).toBeCloseTo(image.width / windowCss, 9);
    expect(centre.y / (windowCss / 2)).toBeCloseTo(image.height / windowCss, 9);
    expect(centre.x).toBeCloseTo(8, 9);
    expect(centre.y).toBeCloseTo(8, 9);

    // And the unconverted answer is a DIFFERENT pixel, which is the whole point: skipping
    // the conversion addresses (8, 8) of a 16x16 image and reads a window sitting 8 device
    // pixels up and to the left of the point the caller named.
    const unconverted = windowCss / 2;
    expect(Math.round(centre.x)).not.toBe(unconverted);
    expect(Math.round(centre.y)).not.toBe(unconverted);
  });

  it('keeps the two axes independent when the capture is short on one of them', () => {
    // A clip whose CSS size is not a whole number of device pixels comes back short on the
    // row axis alone — the same asymmetry `captureScale` in canvas-helpers.ts exists for.
    // 8 CSS px requested, 15 device rows back.
    const image = { width: 16, height: 15 };
    const cssSize = { width: 8, height: 7.5 };
    const centre = sampleCentreInImage(image, cssSize);

    // `cssPointToImage` is `image.width * (point.x - box.x) / box.width`, per axis.
    expect(centre.x).toBeCloseTo((16 * 4) / 8, 9);
    expect(centre.y).toBeCloseTo((15 * 3.75) / 7.5, 9);
    // A single scalar cannot produce both: the x axis is asked in CSS px and the y axis in
    // a different CSS size, and the two answers differ.
    expect(centre.x).not.toBeCloseTo(centre.y, 6);
  });

  it('scales each axis by its own ratio at 3x, where the unconverted address is furthest away', () => {
    const windowCss = sampleWindowCss(SAMPLE_RADIUS);
    const image = decoded(windowCss, 3);
    const centre = sampleCentreInImage(image, { width: windowCss, height: windowCss });
    expect(centre.x).toBeCloseTo(12, 9);
    expect(centre.y).toBeCloseTo(12, 9);
    expect(Math.round(centre.x)).not.toBe(windowCss / 2);
    expect(Math.round(centre.y)).not.toBe(windowCss / 2);
  });

  it('returns a float, because the pixel address the caller rounds is the honest one', () => {
    // 8 CSS px at a capture scale of 1.25 is 10 image px, an exact integer: the case where
    // truncation and rounding agree, so it is NOT the case that tells them apart. 47 device
    // px across 8 CSS px is 5.875, where they differ by a whole pixel.
    expect(sampleCentreInImage({ width: 10, height: 10 }, { width: 8, height: 8 }).x).toBeCloseTo(5, 9);
    const fractional = sampleCentreInImage({ width: 47, height: 47 }, { width: 8, height: 8 });
    expect(Number.isInteger(fractional.x)).toBe(false);
    expect(Math.round(fractional.x)).toBe(24);
    expect(Math.floor(fractional.x)).toBe(23);
  });

  it('stays total for a degenerate capture instead of throwing', () => {
    // A closed or not-yet-laid-out tab produces a zero-sized image and the cssPointToImage
    // JSDoc already promises NaN rather than a throw for a zero-area box. Both have to
    // reach `getColorAtPoint`, which answers `null` for an out-of-range address and
    // `null` for a non-integer one — the "no pixel at this point" answer, not a crash.
    const noImage = sampleCentreInImage({ width: 0, height: 0 }, { width: 8, height: 8 });
    expect(noImage.x).toBe(0);
    expect(noImage.y).toBe(0);

    const noCssSize = sampleCentreInImage({ width: 8, height: 8 }, { width: 0, height: 0 });
    expect(Number.isNaN(noCssSize.x)).toBe(true);
    expect(Number.isNaN(noCssSize.y)).toBe(true);
  });
});

describe('documentSampleRegion', () => {
  it('centres the clip on the document point mapped through the contain fit', () => {
    for (const box of [BOX, WIDE_BOX, TALL_BOX]) {
      for (const [documentX, documentY] of [
        [0, 0],
        [400, 300],
        [DEFAULT_DOCUMENT_SIZE.width, DEFAULT_DOCUMENT_SIZE.height],
        [123.203285, 78.234086],
      ]) {
        const region = documentSampleRegion(box, documentX, documentY);
        const offset = documentToCanvasOffset(box, documentX, documentY);
        const half = region.size.width / 2;

        expect(region.clip.width, 'the capture is the window it was asked for').toBe(sampleWindowCss(SAMPLE_RADIUS));
        expect(region.clip.height).toBe(region.clip.width);
        expect(region.clip.x + half, 'the clip is centred on the mapped document point').toBeCloseTo(
          box.x + offset.x,
          9
        );
        expect(region.clip.y + half).toBeCloseTo(box.y + offset.y, 9);
      }
    }
  });

  it('keeps an interior point entirely inside the canvas box', () => {
    // Interior only, and the exclusion is load-bearing: a window CENTRED on the document's
    // own corner necessarily overhangs it by `half` on the two outer sides, because the
    // point being sampled is the corner. That is why a sample at (0,0) is a sample of the
    // letterbox as well as of the document, and why no assertion in this suite takes one.
    for (const box of [BOX, WIDE_BOX, TALL_BOX]) {
      for (const point of [
        { x: 40, y: 40 },
        { x: 400, y: 300 },
        { x: DEFAULT_DOCUMENT_SIZE.width - 40, y: DEFAULT_DOCUMENT_SIZE.height - 40 },
      ]) {
        const region = documentSampleRegion(box, point.x, point.y);
        expect(region.clip.x, `left of the box at ${JSON.stringify(point)}`).toBeGreaterThanOrEqual(box.x);
        expect(region.clip.y, `top of the box at ${JSON.stringify(point)}`).toBeGreaterThanOrEqual(box.y);
        expect(region.clip.x + region.clip.width, `right of the box at ${JSON.stringify(point)}`).toBeLessThanOrEqual(
          box.x + box.width
        );
        expect(region.clip.y + region.clip.height, `bottom of the box at ${JSON.stringify(point)}`).toBeLessThanOrEqual(
          box.y + box.height
        );
      }
    }
  });

  it('overhangs a document CORNER by at most the window half-extent, and no further', () => {
    for (const box of [BOX, WIDE_BOX, TALL_BOX]) {
      const half = sampleWindowCss(SAMPLE_RADIUS) / 2;
      const topLeft = documentSampleRegion(box, 0, 0);
      expect(box.x - topLeft.clip.x).toBeLessThanOrEqual(half + 1e-9);
      expect(box.y - topLeft.clip.y).toBeLessThanOrEqual(half + 1e-9);

      const bottomRight = documentSampleRegion(box, DEFAULT_DOCUMENT_SIZE.width, DEFAULT_DOCUMENT_SIZE.height);
      expect(bottomRight.clip.x + bottomRight.clip.width - (box.x + box.width)).toBeLessThanOrEqual(half + 1e-9);
      expect(bottomRight.clip.y + bottomRight.clip.height - (box.y + box.height)).toBeLessThanOrEqual(half + 1e-9);
    }
  });

  it('honours an explicit window size and an explicit document size', () => {
    // 400x300 in a 974x583 box: `scale = min(974/400, 583/300) = 1.9433`, so the document
    // is fitted to the HEIGHT and the slack is horizontal — 98.33 a side. Document (100,100)
    // is therefore 292.67 CSS px right of the box's left edge, not flush with it.
    const region = documentSampleRegion(BOX, 100, 100, { windowCss: 40, documentSize: { width: 400, height: 300 } });
    const fit = containFit(BOX, { width: 400, height: 300 });
    expect(region.size).toEqual({ width: 40, height: 40 });
    expect(region.clip.width).toBe(40);
    expect(region.clip.x + 20).toBeCloseTo(BOX.x + fit.offsetX + 100 * fit.scale, 9);
    expect(region.clip.y + 20).toBeCloseTo(BOX.y + fit.offsetY + 100 * fit.scale, 9);
    // And the derived numbers, so a change to the fit cannot move them silently.
    expect(fit.scale).toBeCloseTo(583 / 300, 9);
    expect(fit.offsetX).toBeCloseTo((974 - 400 * (583 / 300)) / 2, 9);
  });
});

/**
 * Why a spec polls THIS rect and not `CANVAS_REDRAW_CLIP`.
 *
 * `CANVAS_REDRAW_CLIP` is a fixed 300x100 box-relative rect, not a derived one, so whether
 * it stays inside the document is a property of the current layout rather than of the
 * helper. At the suite's box it does not: it starts at box x 100 while the document's own
 * left edge is at `offsetX = 98.33`. That is the fact a spec has to be able to see, and
 * seeing it is what justifies a spec building its own clip from the fit.
 */
describe('documentClipInBox', () => {
  it('is a subset of the canvas box at every contain-fit branch, including the offsetX = 100 case', () => {
    for (const box of [BOX, WIDE_BOX, TALL_BOX, { x: 0, y: 0, width: 974, height: 580.5 }]) {
      const clip = documentClipInBox(box);
      expect(clip.x, `left letterbox at ${box.height}px tall`).toBeGreaterThanOrEqual(box.x);
      expect(clip.y, `top letterbox at ${box.width}px wide`).toBeGreaterThanOrEqual(box.y);
      expect(clip.x + clip.width).toBeLessThanOrEqual(box.x + box.width);
      expect(clip.y + clip.height).toBeLessThanOrEqual(box.y + box.height);
    }
  });

  it('is the derived clip at the box height where offsetX reaches 100 exactly', () => {
    // 580.5 is the height at which the horizontal slack is 100, which is where a clip
    // starting at box x 100 sits exactly on the document's edge and one pixel shorter puts
    // 1px of letterbox inside it. The derived clip cannot be affected by that at all.
    const box: BoundingBox = { x: 0, y: 0, width: 974, height: 580.5 };
    expect(containFit(box).offsetX).toBeCloseTo(100, 6);
    const clip = documentClipInBox(box);
    expect(clip.x).toBeCloseTo(100, 6);
    expect(clip.width).toBeCloseTo(800 * (580.5 / 600), 9);
  });

  it('is a different region from the fixed redraw clip, which starts outside the document', () => {
    // The pin for the letterbox hazard, stated as arithmetic rather than as a claim about
    // a theme: at the suite's box the fixed clip's left edge is 1.67 CSS px to the RIGHT of
    // the document's own left edge, so the two regions are not the same and the fixed one is
    // not contained in the document.
    const { offsetX } = containFit(BOX);
    expect(offsetX).toBeCloseTo(98.333333, 4);
    expect(CANVAS_REDRAW_CLIP.x).toBeGreaterThan(offsetX);

    const derived = documentClipInBox(BOX);
    expect(derived.x).toBeCloseTo(BOX.x + offsetX, 9);
    expect(derived.x).toBeLessThan(BOX.x + CANVAS_REDRAW_CLIP.x);
    // The derived clip is the LARGER of the two in area, so restricting a wait to it is
    // not what makes the wait harder — excluding the letterbox is.
    expect(derived.width * derived.height).toBeGreaterThan(CANVAS_REDRAW_CLIP.width * CANVAS_REDRAW_CLIP.height);
  });

  it('follows a document size the app actually has rather than assuming the seed', () => {
    const cropped = documentClipInBox(BOX, { width: 400, height: 300 });
    expect(cropped.width).toBeCloseTo(400 * (583 / 300), 9);
    expect(cropped.height).toBeCloseTo(583, 9);
  });
});
