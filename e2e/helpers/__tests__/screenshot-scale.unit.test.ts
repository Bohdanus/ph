import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import {
  cssPointToImage,
  imageBoundsToCss,
  imagePointToCss,
  viewportRectToPageRect,
  type CssBox,
  type ImageSize,
} from '../screenshot-scale';

/** Workspace canvas box as reported by Playwright in the e2e specs. */
const BOX: CssBox = { x: 100, y: 50, width: 400, height: 300 };

const SCALE_SOURCE = readFileSync(new URL('../screenshot-scale.ts', import.meta.url), 'utf8');

/**
 * The `/** ... *\/` block immediately preceding `marker`, as source text.
 *
 * The inclusive-index convention on `imageBoundsToCss` is prose, so the pin for it has to
 * read prose. Going through the source keeps the test from having to re-declare the rule
 * somewhere a future edit can forget to update.
 */
function blockCommentBefore(marker: string): string {
  const markerAt = SCALE_SOURCE.indexOf(marker);
  if (markerAt === -1) throw new Error(`marker not found in screenshot-scale.ts: ${marker}`);
  const head = SCALE_SOURCE.slice(0, markerAt);
  const start = head.lastIndexOf('/*');
  if (start === -1) throw new Error(`no block comment precedes: ${marker}`);
  const block = head.slice(start);
  const end = block.indexOf('*/');
  if (end === -1) throw new Error(`unterminated block comment before: ${marker}`);
  return block.slice(0, end + 2);
}

describe('imagePointToCss', () => {
  const CASES: {
    name: string;
    image: ImageSize;
    box: CssBox;
    point: { x: number; y: number };
    expected: { x: number; y: number };
  }[] = [
    {
      name: 'image the size of the box is a pure translation',
      image: { width: 400, height: 300 },
      box: BOX,
      point: { x: 0, y: 0 },
      expected: { x: 100, y: 50 },
    },
    {
      name: 'image the size of the box preserves offsets',
      image: { width: 400, height: 300 },
      box: BOX,
      point: { x: 250, y: 100 },
      expected: { x: 350, y: 150 },
    },
    {
      name: '2x image halves every offset',
      image: { width: 800, height: 600 },
      box: BOX,
      point: { x: 500, y: 300 },
      expected: { x: 350, y: 200 },
    },
    {
      name: '3x image on y only halves nothing on the unscaled x axis',
      image: { width: 1200, height: 900 },
      box: BOX,
      point: { x: 1200, y: 900 },
      expected: { x: 500, y: 350 },
    },
    {
      name: 'a non-zero box origin is added after scaling',
      image: { width: 800, height: 600 },
      box: { x: 37, y: 11, width: 400, height: 300 },
      point: { x: 0, y: 0 },
      expected: { x: 37, y: 11 },
    },
    {
      name: 'the box origin is added to a scaled offset too',
      image: { width: 800, height: 600 },
      box: { x: 37, y: 11, width: 400, height: 300 },
      point: { x: 400, y: 300 },
      expected: { x: 237, y: 161 },
    },
    {
      name: 'x and y scale independently',
      image: { width: 100, height: 25 },
      box: BOX,
      point: { x: 10, y: 10 },
      expected: { x: 140, y: 170 },
    },
    {
      name: 'a point beyond the image extrapolates',
      image: { width: 400, height: 300 },
      box: BOX,
      point: { x: 800, y: 600 },
      expected: { x: 900, y: 650 },
    },
    {
      // An image taller than the box scales the y axis but leaves x at 1: the binding axis
      // is width, so a point at the image's right edge lands on the box's right edge.
      name: 'an image taller than the box scales only the y axis',
      image: { width: 400, height: 600 },
      box: BOX,
      point: { x: 400, y: 600 },
      expected: { x: 500, y: 350 },
    },
  ];

  it.each(CASES)('maps image pixels onto the page for $name', ({ image, box, point, expected }) => {
    expect(imagePointToCss(image, box, point)).toEqual(expected);
  });

  it('does not mutate the inputs', () => {
    const image: ImageSize = { width: 800, height: 600 };
    const box: CssBox = { ...BOX };
    const point = { x: 100, y: 100 };
    imagePointToCss(image, box, point);
    expect(image).toEqual({ width: 800, height: 600 });
    expect(box).toEqual(BOX);
    expect(point).toEqual({ x: 100, y: 100 });
  });

  it('yields NaN for a zero-sized image instead of throwing', () => {
    const result = imagePointToCss({ width: 0, height: 0 }, BOX, { x: 0, y: 0 });
    expect(result.x).toBeNaN();
    expect(result.y).toBeNaN();
  });

  it('yields Infinity for a zero-sized image at a non-zero point', () => {
    const result = imagePointToCss({ width: 0, height: 0 }, BOX, { x: 5, y: 5 });
    expect(result.x).toBe(Infinity);
    expect(result.y).toBe(Infinity);
  });

  it('collapses every point onto the box origin when the box has no area', () => {
    const collapsed: CssBox = { x: 37, y: 11, width: 0, height: 0 };
    expect(imagePointToCss({ width: 100, height: 50 }, collapsed, { x: 90, y: 40 })).toEqual({ x: 37, y: 11 });
  });

  it('maps a negative image point to a page point before the box origin', () => {
    // 1:1 with BOX, so x = 100 + (-100) = 0, y = 50 + (-50) = 0.
    expect(imagePointToCss({ width: 400, height: 300 }, BOX, { x: -100, y: -50 })).toEqual({ x: 0, y: 0 });
  });

  it('maps a non-integer scale corner to a fractional page coordinate', () => {
    // image 300x200 in a 100x100 box (origin): scaleX 1/3, scaleY 1/2.
    const result = imagePointToCss(
      { width: 300, height: 200 },
      { x: 0, y: 0, width: 100, height: 100 },
      {
        x: 299,
        y: 199,
      }
    );
    expect(result.x).toBeCloseTo(299 / 3, 9);
    expect(result.y).toBeCloseTo(99.5, 9);
  });
});

describe('imageBoundsToCss', () => {
  it.each([
    {
      name: '1:1 image-to-box scaling',
      image: { width: 400, height: 300 },
      bounds: { left: 10, top: 20, right: 30, bottom: 40 },
      expected: { left: 110, top: 70, right: 130, bottom: 90 },
    },
    {
      name: 'half-size image (DPR 2)',
      image: { width: 800, height: 600 },
      bounds: { left: 20, top: 40, right: 60, bottom: 80 },
      expected: { left: 110, top: 70, right: 130, bottom: 90 },
    },
    {
      name: 'image exactly covering the box',
      image: { width: 400, height: 300 },
      bounds: { left: 0, top: 0, right: 10, bottom: 10 },
      expected: { left: 100, top: 50, right: 110, bottom: 60 },
    },
    {
      name: 'the full 2x image extent',
      image: { width: 800, height: 600 },
      bounds: { left: 0, top: 0, right: 799, bottom: 599 },
      expected: { left: 100, top: 50, right: 499.5, bottom: 349.5 },
    },
    {
      name: 'an aspect-mismatched image scales only the mismatched axis',
      image: { width: 800, height: 300 },
      bounds: { left: 0, top: 0, right: 799, bottom: 299 },
      expected: { left: 100, top: 50, right: 499.5, bottom: 349 },
    },
  ])('maps bounds onto the box for $name', ({ image, bounds, expected }) => {
    expect(imageBoundsToCss(image, BOX, bounds)).toEqual(expected);
  });

  it('agrees with imagePointToCss on both corners', () => {
    const image: ImageSize = { width: 800, height: 600 };
    const bounds = { left: 12, top: 34, right: 456, bottom: 210 };
    expect(imageBoundsToCss(image, BOX, bounds)).toEqual({
      left: imagePointToCss(image, BOX, { x: bounds.left, y: bounds.top }).x,
      top: imagePointToCss(image, BOX, { x: bounds.left, y: bounds.top }).y,
      right: imagePointToCss(image, BOX, { x: bounds.right, y: bounds.bottom }).x,
      bottom: imagePointToCss(image, BOX, { x: bounds.right, y: bounds.bottom }).y,
    });
  });

  it('reports the covered width one image pixel short, because inclusive indices land on pixel centres', () => {
    // FINDING, pinned: `left`/`right` are INCLUSIVE image pixel indices and both corners
    // go through the point rule, so `right` is the CENTRE of the last covered pixel and
    // the span measures centre-to-centre. Nothing is broken today — both consumers want a
    // point or a tolerant comparison — but a caller doing drag-delta or area math would be
    // short by exactly one image pixel, and before this test nothing in the module said so.
    const image: ImageSize = { width: 400, height: 300 }; // 1:1 with BOX
    const bounds = { left: 10, top: 20, right: 14, bottom: 24 };

    // Image pixels 10..14 inclusive: five of them, so five CSS pixels at 1:1.
    expect(bounds.right - bounds.left + 1).toBe(5);

    const css = imageBoundsToCss(image, BOX, bounds);
    expect(css).toEqual({ left: 110, top: 70, right: 114, bottom: 74 });
    // The reported span, which is the number area math would use.
    expect(css.right - css.left).toBe(4);
    expect(css.bottom - css.top).toBe(4);
  });

  it('carries the same one-pixel shortfall onto a 2x capture, where it is half a CSS pixel', () => {
    // A 2x capture does not repair it. The span is still one image pixel short; scaled,
    // that is half a CSS pixel, which is asserted in CSS units because that is the number
    // a caller would do the arithmetic on.
    const image: ImageSize = { width: 800, height: 600 };
    const bounds = { left: 20, top: 40, right: 28, bottom: 48 }; // nine image pixels

    const css = imageBoundsToCss(image, BOX, bounds);
    // Nine image pixels at 2x cover 4.5 CSS pixels; the span reports 4.
    expect(css).toEqual({ left: 110, top: 70, right: 114, bottom: 74 });
    expect(css.right - css.left).toBe(4);
    // The amount a caller has to add back: one image pixel, in CSS units.
    expect(css.right - css.left + BOX.width / image.width).toBe(4.5);
  });

  /**
   * P3 — zero-sized image yields `NaN` edges. `imageBoundsToCss` delegates to
   * `imagePointToCss`, which divides by the image dimensions, so a zero-sized image
   * yields NaN on every edge rather than throwing — exactly like the point rule's
   * zero-width/zero-height cases. A zero-area BOX does NOT yield NaN here: `imagePointToCss`
   * multiplies by the box extent (it does not divide by it), so a zero-area box
   * collapses every edge to the origin. The inverse `cssPointToImage`, which DOES divide
   * by the box extent, is the one whose zero-area-box NaN case is pinned separately
   * below. These zero-image cases pin the division-by-zero failure mode so a fix
   * that guards one axis cannot pass unnoticed.
   */
  it('yields NaN edges for a zero-sized image instead of throwing', () => {
    const result = imageBoundsToCss({ width: 0, height: 0 }, BOX, { left: 0, top: 0, right: 0, bottom: 0 });
    expect(result.left).toBeNaN();
    expect(result.top).toBeNaN();
    expect(result.right).toBeNaN();
    expect(result.bottom).toBeNaN();
  });

  it('yields NaN on the x-axis for a zero-width image', () => {
    const result = imageBoundsToCss({ width: 0, height: 50 }, BOX, { left: 0, top: 0, right: 0, bottom: 50 });
    expect(result.left).toBeNaN();
    expect(result.right).toBeNaN();
    // The y-axis is unaffected: image height 50 maps bottom 50 via 50 + (50*300)/50 = 350.
    expect(result.top).toBe(50);
    expect(result.bottom).toBe(350);
  });

  it('yields NaN on the y-axis for a zero-height image', () => {
    const result = imageBoundsToCss({ width: 50, height: 0 }, BOX, { left: 0, top: 0, right: 50, bottom: 0 });
    // The x-axis is unaffected: image width 50 maps right 50 via 100 + (50*400)/50 = 500.
    expect(result.left).toBe(100);
    expect(result.right).toBe(500);
    expect(result.top).toBeNaN();
    expect(result.bottom).toBeNaN();
  });

  it('yields NaN for zero bounds and Infinity for non-zero on a zero-area image', () => {
    const result = imageBoundsToCss({ width: 0, height: 0 }, BOX, { left: 0, top: 0, right: 10, bottom: 10 });
    // `imagePointToCss` divides by the image extent, so zero bounds give 0/0 = NaN and
    // non-zero bounds give 10/0 = Infinity. Both are signals that the capture was
    // malformed, just different ones — NaN for the origin corner, Infinity for the far.
    expect(result.left).toBeNaN();
    expect(result.top).toBeNaN();
    expect(result.right).toBe(Infinity);
    expect(result.bottom).toBe(Infinity);
  });

  it('collapses every edge to the box origin for a zero-area box, rather than throwing', () => {
    // A zero-area BOX is NOT a division-by-zero hazard for `imageBoundsToCss` — the box
    // extent multiplies, it does not divide, so every edge maps to the origin and the
    // caller gets a degenerate-but-definite rect rather than NaN. This pins that it stays
    // that way if the rule is ever refactored to divide by the box extent.
    const collapsed: CssBox = { x: 37, y: 11, width: 0, height: 0 };
    const result = imageBoundsToCss({ width: 100, height: 50 }, collapsed, { left: 0, top: 0, right: 10, bottom: 10 });
    expect(result.left).toBe(37);
    expect(result.top).toBe(11);
    expect(result.right).toBe(37);
    expect(result.bottom).toBe(11);
  });

  /**
   * The two arithmetic tests above pin the convention; these pin that it is WRITTEN DOWN.
   *
   * `imageBoundsToCss` had no JSDoc at all and the module docstring did not mention it, so
   * the inclusive-index/pixel-centre rule survived only as the expected values in this
   * file. A caller reading only the module would have had to guess, and a "fix" to the
   * arithmetic would have looked like an obvious correction rather than a change of
   * contract. Asserting the wording keeps the documentation from being deleted as an
   * apparent duplicate of the arithmetic.
   */
  describe('the convention is documented on the function', () => {
    const JSDOC = blockCommentBefore('export function imageBoundsToCss');

    it('says the bounds are inclusive image pixel indices', () => {
      expect(JSDOC).toMatch(/inclusive/i);
    });

    it('says right and bottom land on the centre of the last covered pixel', () => {
      expect(JSDOC).toMatch(/cent(re|er)/i);
      expect(JSDOC).toMatch(/last covered pixel/i);
    });

    it('states the arithmetic consequence, so "inclusive" is not read as "right is exclusive"', () => {
      expect(JSDOC).toMatch(/under-reports|short by/i);
    });
  });

  describe('the convention is documented in the module docstring', () => {
    const MODULE_DOC = blockCommentBefore('export interface Point');

    it('mentions imageBoundsToCss and the inclusive-index convention', () => {
      expect(MODULE_DOC).toMatch(/imageBoundsToCss/);
      expect(MODULE_DOC).toMatch(/inclusive/i);
    });

    it('mentions the pixel-centre mapping that causes the off-by-one', () => {
      expect(MODULE_DOC).toMatch(/cent(re|er)/i);
    });
  });
});

describe('cssPointToImage', () => {
  const CASES: {
    name: string;
    image: ImageSize;
    box: CssBox;
    point: { x: number; y: number };
    expected: { x: number; y: number };
  }[] = [
    {
      name: 'image the size of the box is a pure translation back',
      image: { width: 400, height: 300 },
      box: BOX,
      point: { x: 100, y: 50 },
      expected: { x: 0, y: 0 },
    },
    {
      name: 'image the size of the box preserves offsets',
      image: { width: 400, height: 300 },
      box: BOX,
      point: { x: 350, y: 150 },
      expected: { x: 250, y: 100 },
    },
    {
      name: '2x image doubles every offset',
      image: { width: 800, height: 600 },
      box: BOX,
      point: { x: 350, y: 200 },
      expected: { x: 500, y: 300 },
    },
    {
      name: 'a non-zero box origin is subtracted before scaling',
      image: { width: 800, height: 600 },
      box: { x: 37, y: 11, width: 400, height: 300 },
      point: { x: 237, y: 161 },
      expected: { x: 400, y: 300 },
    },
    {
      name: 'x and y scale independently',
      image: { width: 100, height: 25 },
      box: BOX,
      point: { x: 140, y: 170 },
      expected: { x: 10, y: 10 },
    },
    {
      name: 'a point left of the box is negative',
      image: { width: 400, height: 300 },
      box: BOX,
      point: { x: 0, y: 0 },
      expected: { x: -100, y: -50 },
    },
  ];

  it.each(CASES)('maps a page point back into the image for $name', ({ image, box, point, expected }) => {
    expect(cssPointToImage(image, box, point)).toEqual(expected);
  });

  it('does not mutate the inputs', () => {
    const image: ImageSize = { width: 800, height: 600 };
    const box: CssBox = { ...BOX };
    const point = { x: 300, y: 200 };
    cssPointToImage(image, box, point);
    expect(image).toEqual({ width: 800, height: 600 });
    expect(box).toEqual(BOX);
    expect(point).toEqual({ x: 300, y: 200 });
  });

  /**
   * P3 — zero-sized image yields `NaN` edges. `cssPointToImage` divides by the box extent,
   * so a zero-area box is the NaN source (pinned above). But the forward direction
   * `imagePointToCss` divides by the IMAGE size, so a zero-sized image yields NaN there
   * too — and unlike the box case, the image is the value a caller hands to a pixel
   * sampler, so the NaN reaches `page.mouse.click` as an opaque failure. These cases pin
   * both axes independently: zero width, zero height, and both, so a fix that guards one
   * axis forgets the other cannot pass unnoticed.
   */
  it('yields NaN for a zero-width image instead of throwing', () => {
    const result = imagePointToCss({ width: 0, height: 50 }, BOX, { x: 0, y: 0 });
    expect(result.x).toBeNaN();
  });

  it('yields NaN for a zero-height image instead of throwing', () => {
    const result = imagePointToCss({ width: 100, height: 0 }, BOX, { x: 0, y: 0 });
    expect(result.y).toBeNaN();
  });

  it('yields Infinity on both axes for a zero-sized image at a non-zero point', () => {
    const result = imagePointToCss({ width: 0, height: 0 }, BOX, { x: 50, y: 25 });
    expect(result.x).toBe(Infinity);
    expect(result.y).toBe(Infinity);
  });

  it('yields NaN for a zero-area box instead of throwing', () => {
    const result = cssPointToImage({ width: 100, height: 50 }, { x: 37, y: 11, width: 0, height: 0 }, { x: 37, y: 11 });
    expect(result.x).toBeNaN();
    expect(result.y).toBeNaN();
  });

  it('yields Infinity for a zero-area box away from its origin', () => {
    const result = cssPointToImage({ width: 100, height: 50 }, { x: 37, y: 11, width: 0, height: 0 }, { x: 40, y: 12 });
    expect(result.x).toBe(Infinity);
    expect(result.y).toBe(Infinity);
  });
});

describe('imagePointToCss and cssPointToImage are inverses', () => {
  const IMAGES: { name: string; image: ImageSize }[] = [
    { name: 'image the size of the box', image: { width: 400, height: 300 } },
    { name: 'a 2x image', image: { width: 800, height: 600 } },
    { name: 'a half-size image', image: { width: 200, height: 150 } },
    { name: 'an odd-sized image', image: { width: 333, height: 217 } },
    { name: 'an aspect-mismatched image', image: { width: 640, height: 480 } },
  ];
  const BOXES: { name: string; box: CssBox }[] = [
    { name: 'the e2e canvas box', box: BOX },
    { name: 'a box at the origin', box: { x: 0, y: 0, width: 400, height: 300 } },
    { name: 'a narrow, offset box', box: { x: 211, y: 143, width: 317, height: 97 } },
  ];
  const POINTS = [
    { x: 0, y: 0 },
    { x: 1, y: 1 },
    { x: 7, y: 13 },
    { x: 100, y: 100 },
    { x: 399, y: 299 },
    { x: 800, y: 600 },
  ];

  const ROUND_TRIPS: { name: string; image: ImageSize; box: CssBox; point: { x: number; y: number } }[] = [];
  for (const { name: imageName, image } of IMAGES) {
    for (const { name: boxName, box } of BOXES) {
      for (const point of POINTS) {
        ROUND_TRIPS.push({ name: `${imageName} in ${boxName} at (${point.x}, ${point.y})`, image, box, point });
      }
    }
  }

  it.each(ROUND_TRIPS)('image -> css -> image returns to $name', ({ image, box, point }) => {
    const roundTrip = cssPointToImage(image, box, imagePointToCss(image, box, point));
    expect(roundTrip.x).toBeCloseTo(point.x, 9);
    expect(roundTrip.y).toBeCloseTo(point.y, 9);
  });

  it.each(ROUND_TRIPS)('css -> image -> css returns to $name', ({ image, box, point }) => {
    const cssPoint = { x: box.x + point.x, y: box.y + point.y };
    const roundTrip = imagePointToCss(image, box, cssPointToImage(image, box, cssPoint));
    expect(roundTrip.x).toBeCloseTo(cssPoint.x, 9);
    expect(roundTrip.y).toBeCloseTo(cssPoint.y, 9);
  });

  it('round-trips every point exactly when the scales are exact', () => {
    for (const point of POINTS) {
      const image: ImageSize = { width: 800, height: 600 };
      const roundTrip = cssPointToImage(image, BOX, imagePointToCss(image, BOX, point));
      expect(roundTrip).toEqual(point);
    }
  });

  it('maps the full image extent onto the full box in both directions', () => {
    const image: ImageSize = { width: 800, height: 600 };
    const topLeft = cssPointToImage(image, BOX, { x: BOX.x, y: BOX.y });
    const bottomRight = cssPointToImage(image, BOX, { x: BOX.x + BOX.width, y: BOX.y + BOX.height });
    expect(topLeft).toEqual({ x: 0, y: 0 });
    expect(bottomRight).toEqual({ x: 800, y: 600 });
  });
});

/**
 * The translation `viewportRectToPageRect` performs, in the suite's own numbers: the test
 * passes a literal scroll of {x: 0, y: 440} (a fixture value tied to the legacy-rail
 * guard, not app geometry — the app no longer scrolls per `e2e/OPEN_PROBLEMS.md`), so a
 * rect measured at viewport `y: -340` maps to document `y: 100`. Raw, a viewport-relative
 * clip reaches a capture 440px away from the region the caller measured — a wrong answer,
 * not an error.
 */
describe('viewportRectToPageRect', () => {
  const RECT: CssBox = { x: 56, y: -340, width: 320, height: 120 };

  it('returns the rect unchanged when the window is not scrolled', () => {
    expect(viewportRectToPageRect(RECT, { x: 0, y: 0 })).toEqual(RECT);
  });

  it('adds a vertical scroll to the origin and leaves the extent alone', () => {
    expect(viewportRectToPageRect(RECT, { x: 0, y: 440 })).toEqual({ x: 56, y: 100, width: 320, height: 120 });
  });

  it('adds both offsets for a window scrolled on both axes', () => {
    expect(viewportRectToPageRect(RECT, { x: 30, y: 440 })).toEqual({ x: 86, y: 100, width: 320, height: 120 });
  });

  it('translates a negative origin into a positive one when the window has scrolled back', () => {
    // The measured `clickToolButton` pair: same document position, opposite window.
    expect(viewportRectToPageRect({ ...RECT, y: 100 }, { x: 0, y: 440 })).toEqual({
      x: 56,
      y: 540,
      width: 320,
      height: 120,
    });
  });

  it('adds a fractional scroll exactly rather than rounding it to a device pixel', () => {
    // 0.5px of scroll is real: it comes from a zoomed or fractional-DPR window, and a
    // clip rounded here is a clip that no longer lines up with the pixels it addresses.
    expect(viewportRectToPageRect(RECT, { x: 0, y: 440.5 })).toEqual({ x: 56, y: 100.5, width: 320, height: 120 });
    expect(viewportRectToPageRect(RECT, { x: 12.25, y: 0.5 })).toEqual({
      x: 68.25,
      y: -339.5,
      width: 320,
      height: 120,
    });
  });

  it('translates a zero-size rect, which is a position and not an area', () => {
    expect(viewportRectToPageRect({ x: 56, y: -340, width: 0, height: 0 }, { x: 0, y: 440 })).toEqual({
      x: 56,
      y: 100,
      width: 0,
      height: 0,
    });
  });

  it('keeps a zero scroll a value rather than treating it as absent', () => {
    // A `||` here would substitute the box for a zero and capture the whole canvas.
    expect(viewportRectToPageRect(RECT, { x: 0, y: 0 }).x).toBe(RECT.x);
  });

  it('does not mutate the rect it was given', () => {
    const rect: CssBox = { ...RECT };
    viewportRectToPageRect(rect, { x: 30, y: 440 });
    expect(rect).toEqual(RECT);
  });

  it('is a pure function of its two arguments', () => {
    const scroll = { x: 30, y: 440 };
    expect(viewportRectToPageRect(RECT, scroll)).toEqual(viewportRectToPageRect(RECT, scroll));
  });

  it('adds a large vertical scroll to the origin, leaving the extent untouched', () => {
    // A far-down scroll is still just an origin translation; the width/height must not move.
    expect(viewportRectToPageRect(RECT, { x: 0, y: 10000 })).toEqual({
      x: 56,
      y: 9660,
      width: 320,
      height: 120,
    });
  });

  it('adds a large horizontal scroll, extent untouched', () => {
    expect(viewportRectToPageRect(RECT, { x: 7500, y: 0 })).toEqual({
      x: 7556,
      y: -340,
      width: 320,
      height: 120,
    });
  });

  it('survives a large scroll on both axes simultaneously', () => {
    expect(viewportRectToPageRect(RECT, { x: 8000, y: 12000 })).toEqual({
      x: 8056,
      y: 11660,
      width: 320,
      height: 120,
    });
  });

  it('adds a fractional large scroll without rounding to a device pixel', () => {
    // 0.5/0.25px of scroll is real at a fractional-DPR or zoomed window.
    expect(viewportRectToPageRect(RECT, { x: 5000.5, y: 9999.25 })).toEqual({
      x: 5056.5,
      y: 9659.25,
      width: 320,
      height: 120,
    });
  });

  it('shifts the origin leftward and upward under a negative scroll', () => {
    expect(viewportRectToPageRect(RECT, { x: -30, y: -440 })).toEqual({
      x: 26,
      y: -780,
      width: 320,
      height: 120,
    });
  });
});

describe('the coordinate shapes have exactly one declaration', () => {
  /**
   * `BoundingBox`, `CssBox`, `CssBounds` and `ClipOptions` were each declared more than
   * once across `canvas-helpers.ts`, `cdp-helpers.ts` and this file, and the copies were
   * byte-identical, so structural typing made them interchangeable and the compiler
   * reported no drift when they stopped being identical. `canvas-helpers.ts` still
   * re-exports `CssBox` as `BoundingBox` because that is the name the specs import -- a
   * re-export is not a second declaration, which is what these assertions check.
   */
  const HELPER_DIR = fileURLToPath(new URL('../', import.meta.url));
  const OWNER = 'screenshot-scale.ts';

  /**
   * Every module in `e2e/helpers/`, read from the directory rather than from a literal
   * list. A hand-written list is a list that rots: it is correct the day it is written
   * and silently stops covering each module added afterwards, which is exactly the
   * "a field added to one copy did not reach the others" drift this guard exists to
   * prevent -- the new copy is in a file the list does not mention.
   */
  const HELPER_SOURCES = readdirSync(HELPER_DIR)
    .filter((entry) => entry.endsWith('.ts'))
    .sort();

  /**
   * Declared type names, from BOTH declaration forms. `interface` alone is not enough:
   * a copy written as `type CaptureRect = { x, y, width, height }` is the same drift
   * under a different keyword and a different name, and it matches an interface-only
   * pattern not at all.
   */
  function declarationsIn(file: string): string[] {
    const source = readFileSync(join(HELPER_DIR, file), 'utf8');
    return [
      ...[...source.matchAll(/^\s*(?:export\s+)?(?:declare\s+)?interface\s+(\w+)/gm)].map((match) => match[1]),
      ...[...source.matchAll(/^\s*(?:export\s+)?type\s+(\w+)\s*=/gm)].map((match) => match[1]),
    ];
  }

  function ownersOf(name: string): string[] {
    return HELPER_SOURCES.filter((file) => declarationsIn(file).includes(name));
  }

  /**
   * A declaration's field list, normalised for comparison, or `null` when the
   * declaration is not an object shape (a union, a function, a type over another type).
   *
   * Comparison is on the FIELD SET, which is the property that makes a second copy
   * interchangeable: two declarations with the same fields are the same type to the
   * compiler, so a field added to one and not the other is exactly the silent drift.
   * Normalisation strips the `?` optional marker and whitespace, so `ClipOptions`'s
   * `x?: number` and a copy's `x: number` compare equal — that is deliberate, because
   * optionality is not what makes two types interchangeable in the direction that
   * hurts (a required field where the original had an optional one is the strict
   * direction and fails at compile time; the reverse is caught here).
   */
  function shapeOf(file: string, name: string): string[] | null {
    const source = readFileSync(join(HELPER_DIR, file), 'utf8');
    // Both declaration forms, and both body layouts: a declaration written across lines
    // (closed by `}` at the start of a line) and one written on a single line. Only
    // handling the first is how a real copy slips past: `type CaptureRect = { x: number;
    // y: number; width: number; height: number }` is exactly the line a hurried author
    // writes, and a multi-line-only parser reads it as "not a shape" and reports nothing.
    const multiLine = new RegExp(
      String.raw`^[ \t]*(?:export\s+)?(?:declare\s+)?(?:interface\s+${name}\s*\{|type\s+${name}\s*=\s*\{)` +
        String.raw`([\s\S]*?)^\}`,
      'm'
    );
    const singleLine = new RegExp(
      String.raw`(?:export\s+)?(?:declare\s+)?(?:interface\s+${name}\s*\{|type\s+${name}\s*=\s*\{)([^}]*)\}`
    );
    const body = multiLine.exec(source)?.[1] ?? singleLine.exec(source)?.[1];
    if (body === undefined) return null;
    // A field is a name and a colon, at the start of the body, after a `;`, or after a
    // newline — the three positions a field can sit at in either layout.
    const fields = [...body.matchAll(/(?:^|[;\n{])\s*(\w+)\??\s*:/g)].map((match) => match[1]);
    // A body with no field syntax at all is a union or a function, not a shape.
    return fields.length > 0 ? [...new Set(fields)].sort() : null;
  }

  /** Every object-shaped type declaration in a module, by name. */
  function shapeNamesIn(file: string): string[] {
    return declarationsIn(file).filter((name) => shapeOf(file, name) !== null);
  }

  function sameShape(a: string[], b: string[]): boolean {
    return a.length === b.length && a.every((field, index) => field === b[index]);
  }

  it.each(['CssBox', 'CssBounds', 'ClipOptions'])('declares %s only here', (name) => {
    expect(ownersOf(name)).toEqual([OWNER]);
  });

  it('leaves no helper module with a private BoundingBox of its own', () => {
    // The name specs import stays a re-export of `CssBox`; a declaration anywhere else
    // is the drift this replaces, whatever the file calls it.
    const local = HELPER_SOURCES.filter((file) => file !== OWNER && declarationsIn(file).includes('BoundingBox'));
    expect(local).toEqual([]);
  });

  it('scans every helper module, not a list of the three that existed when it was written', () => {
    // The guard above is only as good as its input. A guard that reads a hardcoded
    // three-file list passes while the copy it exists to catch sits in a fourth file,
    // and the failure mode is silent: the suite is green and the drift is back. This
    // fails when the directory and the scanned set disagree, and it names what is
    // missing, because "the guard is stale" is otherwise indistinguishable from "there
    // is nothing to find".
    const onDisk = readdirSync(HELPER_DIR)
      .filter((entry) => entry.endsWith('.ts') && !entry.endsWith('.spec.ts'))
      .sort();
    expect(HELPER_SOURCES.filter((file) => !file.endsWith('.spec.ts'))).toEqual(onDisk);
    expect(HELPER_SOURCES).toContain('toolbar-helpers.ts');
  });

  it('leaves no module declaring a SECOND copy of a coordinate shape under a different name', () => {
    // Name matching alone is not the invariant, and this is the case that proves it: a
    // copy written as `type CaptureRect = { x; y; width; height }` in `toolbar-helpers.ts`
    // is byte-for-byte the drift this guard exists for — structural typing makes it
    // interchangeable with `CssBox`, so a field added to one copy silently does not
    // reach the other — and it matches neither `CssBox` nor `BoundingBox` by name. A
    // guard that only greps for the four known names passes while the problem is
    // completely present.
    //
    // So this compares SHAPES. Every object-shaped type declaration in the directory is
    // normalised to its sorted field list, and any field set equal to one of the owned
    // shapes must be declared exactly once, in the owner. The four names are still
    // checked separately above; this is the half that a rename defeats.
    const ownedShapes = ['CssBox', 'CssBounds', 'ClipOptions']
      .map((name) => shapeOf(OWNER, name))
      .filter((shape): shape is string[] => shape !== null);

    const duplicates = HELPER_SOURCES.filter((file) => file !== OWNER).flatMap((file) =>
      shapeNamesIn(file)
        .filter((name) => {
          const shape = shapeOf(file, name);
          return shape !== null && ownedShapes.some((owned) => sameShape(owned, shape));
        })
        .map((name) => `${file}: ${name}`)
    );

    expect(duplicates, 'a coordinate shape is declared outside screenshot-scale.ts').toEqual([]);
  });

  it('wires canvas-helpers to the shared declaration instead of shadowing it', () => {
    // A re-export is invisible to a declaration count, so the alias is what proves the
    // specs' `import type { BoundingBox } from './helpers/canvas-helpers'` resolves to
    // this file's `CssBox` rather than to a local shape that merely looks like it.
    const source = readFileSync(new URL('../canvas-helpers.ts', import.meta.url), 'utf8');
    expect(source).toMatch(/type\s+CssBox\s+as\s+BoundingBox/);
    expect(source).toMatch(/export type \{[^}]*\bBoundingBox\b/);
  });
});

describe('zero-area bounds and negative-coordinate round trips', () => {
  it('collapses a zero-width bound (left === right) to a single CSS x', () => {
    // 1:1 with BOX, so the inclusive index maps straight through and the two edges coincide.
    expect(imageBoundsToCss({ width: 400, height: 300 }, BOX, { left: 10, top: 20, right: 10, bottom: 40 })).toEqual({
      left: 110,
      top: 70,
      right: 110,
      bottom: 90,
    });
  });

  it('collapses a zero-height bound (top === bottom) to a single CSS y', () => {
    expect(imageBoundsToCss({ width: 400, height: 300 }, BOX, { left: 10, top: 20, right: 30, bottom: 20 })).toEqual({
      left: 110,
      top: 70,
      right: 130,
      bottom: 70,
    });
  });

  it('agrees with imagePointToCss on negative bounds at the origin box', () => {
    // A bound extending before the image origin still maps each corner through the point rule.
    const bounds = { left: -10, top: -20, right: -5, bottom: -5 };
    expect(imageBoundsToCss({ width: 400, height: 300 }, BOX, bounds)).toEqual({
      left: imagePointToCss({ width: 400, height: 300 }, BOX, { x: bounds.left, y: bounds.top }).x,
      top: imagePointToCss({ width: 400, height: 300 }, BOX, { x: bounds.left, y: bounds.top }).y,
      right: imagePointToCss({ width: 400, height: 300 }, BOX, { x: bounds.right, y: bounds.bottom }).x,
      bottom: imagePointToCss({ width: 400, height: 300 }, BOX, { x: bounds.right, y: bounds.bottom }).y,
    });
  });

  it('agrees with imagePointToCss on negative bounds at a non-origin box', () => {
    const box: CssBox = { x: 37, y: 11, width: 400, height: 300 };
    const bounds = { left: -100, top: -50, right: -50, bottom: -25 };
    expect(imageBoundsToCss({ width: 400, height: 300 }, box, bounds)).toEqual({
      left: imagePointToCss({ width: 400, height: 300 }, box, { x: bounds.left, y: bounds.top }).x,
      top: imagePointToCss({ width: 400, height: 300 }, box, { x: bounds.left, y: bounds.top }).y,
      right: imagePointToCss({ width: 400, height: 300 }, box, { x: bounds.right, y: bounds.bottom }).x,
      bottom: imagePointToCss({ width: 400, height: 300 }, box, { x: bounds.right, y: bounds.bottom }).y,
    });
  });

  it('round-trips a negative image point image -> css -> image', () => {
    // 1:1 with BOX: (-100,-50) maps to the box origin (0,0) and back.
    const image: ImageSize = { width: 400, height: 300 };
    expect(cssPointToImage(image, BOX, imagePointToCss(image, BOX, { x: -100, y: -50 }))).toEqual({
      x: -100,
      y: -50,
    });
  });

  it('round-trips a page point before the box css -> image -> css', () => {
    // (0,0) is before the box origin; it should survive the inverse mapping untouched.
    const image: ImageSize = { width: 400, height: 300 };
    expect(imagePointToCss(image, BOX, cssPointToImage(image, BOX, { x: 0, y: 0 }))).toEqual({ x: 0, y: 0 });
  });

  it('round-trips a page point further left of the box css -> image -> css', () => {
    // (-50, 0): still negative image space, still round-trips exactly at scale 1.
    const image: ImageSize = { width: 400, height: 300 };
    expect(imagePointToCss(image, BOX, cssPointToImage(image, BOX, { x: -50, y: 0 }))).toEqual({ x: -50, y: 0 });
  });
});
