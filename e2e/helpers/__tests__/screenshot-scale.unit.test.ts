import { describe, it, expect } from 'vitest';
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
 * The translation `captureCanvasScreenshot` needs, in the app's own numbers: the page is
 * 1177px tall in a 720px window, `clickToolButton` scrolls it 440px, and the workspace
 * canvas goes from `y: 100` to `y: -340`. Raw, that clip reaches a capture 440px away from
 * the region the caller measured — a wrong answer, not an error.
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
});
