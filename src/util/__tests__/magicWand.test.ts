import { describe, expect, it, vi, type Mock } from 'vitest';
import { makeMockCanvas } from '@/__tests__/canvas-mock.ts';
import {
  createMagicWandSelectionFromCanvas,
  createMagicWandSelectionFromImageData,
  getMagicWandColorDistance,
} from '../magicWand.ts';

function createImageData(width: number, height: number, fill: [number, number, number, number]): ImageData {
  const imageData = {
    colorSpace: 'srgb',
    data: new Uint8ClampedArray(width * height * 4),
    height,
    width,
  } as ImageData;

  for (let i = 0; i < width * height; i++) {
    imageData.data[i * 4] = fill[0];
    imageData.data[i * 4 + 1] = fill[1];
    imageData.data[i * 4 + 2] = fill[2];
    imageData.data[i * 4 + 3] = fill[3];
  }

  return imageData;
}

function setPixel(imageData: ImageData, x: number, y: number, color: [number, number, number, number]) {
  const index = (y * imageData.width + x) * 4;
  imageData.data[index] = color[0];
  imageData.data[index + 1] = color[1];
  imageData.data[index + 2] = color[2];
  imageData.data[index + 3] = color[3];
}

function getPointBounds(points: Array<{ x: number; y: number }>) {
  return {
    minX: Math.min(...points.map((point) => point.x)),
    minY: Math.min(...points.map((point) => point.y)),
    maxX: Math.max(...points.map((point) => point.x)),
    maxY: Math.max(...points.map((point) => point.y)),
  };
}

/** A 5x5 image whose only lit pixels form a 13-pixel diamond, so its traced outline is a staircase. */
function createDiamondImageData(): ImageData {
  const imageData = createImageData(5, 5, [0, 0, 0, 255]);

  for (let y = 0; y < 5; y++) {
    for (let x = 0; x < 5; x++) {
      if (Math.abs(x - 2) + Math.abs(y - 2) <= 2) setPixel(imageData, x, y, [255, 255, 255, 255]);
    }
  }

  return imageData;
}

describe('magic wand utilities', () => {
  it('selects a contiguous same-color region and returns its outer boundary', () => {
    const imageData = createImageData(6, 6, [0, 0, 255, 255]);
    setPixel(imageData, 2, 2, [255, 0, 0, 255]);
    setPixel(imageData, 3, 2, [255, 0, 0, 255]);
    setPixel(imageData, 2, 3, [255, 0, 0, 255]);
    setPixel(imageData, 3, 3, [255, 0, 0, 255]);

    const result = createMagicWandSelectionFromImageData(imageData, { x: 2, y: 2 }, { smoothing: 1, tolerance: 0 });

    expect(result?.selectedPixelCount).toBe(4);
    expect(result?.sampleColor).toEqual({ r: 255, g: 0, b: 0, a: 255 });
    expect(result?.bounds).toEqual({ x: 2, y: 2, width: 2, height: 2 });
    expect(getPointBounds(result!.points)).toEqual({ minX: 2, minY: 2, maxX: 4, maxY: 4 });
  });

  it('uses tolerance to include connected near-color pixels', () => {
    const imageData = createImageData(3, 1, [220, 0, 0, 255]);
    setPixel(imageData, 0, 0, [100, 100, 100, 255]);
    setPixel(imageData, 1, 0, [106, 106, 106, 255]);

    const exact = createMagicWandSelectionFromImageData(imageData, { x: 0, y: 0 }, { tolerance: 0 });
    const tolerant = createMagicWandSelectionFromImageData(imageData, { x: 0, y: 0 }, { tolerance: 3 });

    expect(exact?.selectedPixelCount).toBe(1);
    expect(tolerant?.selectedPixelCount).toBe(2);
  });

  it('returns null when the seed is outside the image', () => {
    const imageData = createImageData(4, 4, [0, 0, 0, 255]);

    expect(createMagicWandSelectionFromImageData(imageData, { x: -1, y: 0 })).toBeNull();
    expect(createMagicWandSelectionFromImageData(imageData, { x: 4, y: 0 })).toBeNull();
  });
});

describe('getMagicWandColorDistance', () => {
  it('is zero for identical colors, including fully transparent ones', () => {
    expect(getMagicWandColorDistance({ r: 12, g: 34, b: 56, a: 78 }, { r: 12, g: 34, b: 56, a: 78 })).toBe(0);
    expect(getMagicWandColorDistance({ r: 0, g: 0, b: 0, a: 0 }, { r: 0, g: 0, b: 0, a: 0 })).toBe(0);
  });

  it('is the euclidean distance across all four channels', () => {
    expect(getMagicWandColorDistance({ r: 0, g: 0, b: 0, a: 0 }, { r: 3, g: 4, b: 0, a: 0 })).toBe(5);
    expect(getMagicWandColorDistance({ r: 0, g: 0, b: 0, a: 0 }, { r: 0, g: 0, b: 0, a: 3 })).toBe(3);
  });

  it('reaches exactly the maximum channel distance for opaque black versus opaque white', () => {
    // `MAX_COLOR_DISTANCE` in `src/util/magicWand.ts:4` is `sqrt(255 * 255 * 4)`, so a
    // tolerance of 100 is by construction the largest distance that can ever match.
    expect(getMagicWandColorDistance({ r: 0, g: 0, b: 0, a: 0 }, { r: 255, g: 255, b: 255, a: 255 })).toBe(510);
  });

  it('is symmetric', () => {
    const a = { r: 10, g: 200, b: 30, a: 40 };
    const b = { r: 90, g: 20, b: 130, a: 240 };

    expect(getMagicWandColorDistance(a, b)).toBe(getMagicWandColorDistance(b, a));
  });
});

describe('tolerance', () => {
  // A 3x1 strip: the seed and its neighbour are exact matches, the third pixel is
  // 220 units away in the red channel, which is 220 / 510 = 43.14% of the maximum
  // colour distance. So a clamped tolerance below 44% excludes it and 44% or more
  // includes it, independently of how the raw value is written.
  const toleranceStrip = () => {
    const imageData = createImageData(3, 1, [220, 0, 0, 255]);
    setPixel(imageData, 2, 0, [0, 0, 0, 255]);
    return imageData;
  };

  it.each([
    ['an omitted tolerance behaves like zero', undefined, 2],
    ['a negative tolerance is clamped to zero', -50, 2],
    ['zero is an exact-match tolerance', 0, 2],
    ['a tolerance just below the distance threshold excludes the pixel', 43, 2],
    ['a tolerance just above the distance threshold includes the pixel', 44, 3],
    ['the maximum tolerance keeps every pixel in range', 100, 3],
    ['a tolerance above 100 is clamped to the maximum', 150, 3],
    ['an absurd tolerance is still clamped to the maximum', 1e9, 3],
  ])('%s', (_label, tolerance, expectedCount) => {
    const result = createMagicWandSelectionFromImageData(toleranceStrip(), { x: 0, y: 0 }, { tolerance });

    expect(result?.selectedPixelCount).toBe(expectedCount);
  });

  it('reports the bounds of everything the tolerance pulled in', () => {
    expect(createMagicWandSelectionFromImageData(toleranceStrip(), { x: 0, y: 0 }, { tolerance: 44 })?.bounds).toEqual({
      x: 0,
      y: 0,
      width: 3,
      height: 1,
    });
  });

  it('selects nothing when the tolerance cannot be compared, rather than throwing', () => {
    // `getToleranceDistance` clamps to `Math.max(0, Math.min(100, NaN))`, which is NaN, and
    // every `distance <= NaN` comparison is false. The result is a silent null.
    expect(
      createMagicWandSelectionFromImageData(toleranceStrip(), { x: 0, y: 0 }, { tolerance: Number.NaN })
    ).toBeNull();
  });
});

describe('neighbour connectivity', () => {
  /**
   * A 3x3 image with a 2x2 block in the top-left plus one pixel that only touches
   * that block diagonally at (2,2). The flood fill is 4-connected, so the two regions
   * are separate as far as the contiguous mode is concerned.
   */
  const twoRegions = () => {
    const imageData = createImageData(3, 3, [0, 0, 0, 255]);

    for (const [x, y] of [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
      [2, 2],
    ]) {
      setPixel(imageData, x, y, [255, 0, 0, 255]);
    }

    return imageData;
  };

  it('floods only 4-connected neighbours by default', () => {
    const result = createMagicWandSelectionFromImageData(twoRegions(), { x: 0, y: 0 }, { tolerance: 0 });

    expect(result?.selectedPixelCount).toBe(4);
    expect(result?.bounds).toEqual({ x: 0, y: 0, width: 2, height: 2 });
  });

  it('treats an explicit contiguous: true the same as the default', () => {
    expect(
      createMagicWandSelectionFromImageData(twoRegions(), { x: 0, y: 0 }, { tolerance: 0, contiguous: true })
    ).toEqual(createMagicWandSelectionFromImageData(twoRegions(), { x: 0, y: 0 }, { tolerance: 0 }));
  });

  it('selects every matching pixel when contiguous is false', () => {
    const result = createMagicWandSelectionFromImageData(
      twoRegions(),
      { x: 0, y: 0 },
      { tolerance: 0, contiguous: false }
    );

    expect(result?.selectedPixelCount).toBe(5);
    expect(result?.bounds).toEqual({ x: 0, y: 0, width: 3, height: 3 });
  });

  it('returns the largest traced loop as the outline even when other regions matched', () => {
    // The diagonal neighbour produces a second boundary fragment, but only the 2x2
    // block's loop is large enough to win `selectLargestBoundaryLoop`, so the
    // returned polygon is the block outline and not the whole 3x3 bounding box.
    const result = createMagicWandSelectionFromImageData(
      twoRegions(),
      { x: 0, y: 0 },
      { tolerance: 0, contiguous: false }
    );

    expect(result!.points).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 1 },
      { x: 2, y: 2 },
      { x: 1, y: 2 },
      { x: 0, y: 2 },
      { x: 0, y: 1 },
    ]);
  });

  it('samples the color at the seed even when the seed is the only match', () => {
    const result = createMagicWandSelectionFromImageData(twoRegions(), { x: 2, y: 2 }, { tolerance: 0 });

    expect(result?.selectedPixelCount).toBe(1);
    expect(result?.sampleColor).toEqual({ r: 255, g: 0, b: 0, a: 255 });
  });
});

describe('region shapes', () => {
  it('traces a one-pixel selection as the four corners of that pixel', () => {
    const imageData = createImageData(3, 3, [0, 0, 0, 255]);
    setPixel(imageData, 1, 1, [255, 0, 0, 255]);

    const result = createMagicWandSelectionFromImageData(imageData, { x: 1, y: 1 }, { tolerance: 0 });

    expect(result?.points).toEqual([
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 2, y: 2 },
      { x: 1, y: 2 },
    ]);
    expect(result?.bounds).toEqual({ x: 1, y: 1, width: 1, height: 1 });
  });

  it('selects a fully transparent seed as an isolated region among opaque black pixels', () => {
    const imageData = createImageData(3, 3, [0, 0, 0, 255]);
    setPixel(imageData, 1, 1, [0, 0, 0, 0]);

    const result = createMagicWandSelectionFromImageData(imageData, { x: 1, y: 1 }, { tolerance: 0 });

    // Alpha participates in the distance, so the alpha-only 255 gap puts every
    // neighbouring opaque black pixel out of a zero tolerance.
    expect(result?.selectedPixelCount).toBe(1);
    expect(result?.sampleColor).toEqual({ r: 0, g: 0, b: 0, a: 0 });
  });

  it('selects the whole image when every pixel matches, including all four image edges', () => {
    const result = createMagicWandSelectionFromImageData(createImageData(3, 3, [10, 20, 30, 255]), { x: 1, y: 1 });

    expect(result?.selectedPixelCount).toBe(9);
    expect(result?.bounds).toEqual({ x: 0, y: 0, width: 3, height: 3 });
    expect(result!.points).toHaveLength(12);
    expect(getPointBounds(result!.points)).toEqual({ minX: 0, minY: 0, maxX: 3, maxY: 3 });
  });

  it('walks the outline of an L shape whose bounding box contains unselected pixels', () => {
    const imageData = createImageData(3, 3, [0, 0, 0, 255]);

    for (const [x, y] of [
      [0, 0],
      [1, 0],
      [2, 0],
      [0, 1],
      [0, 2],
    ]) {
      setPixel(imageData, x, y, [9, 9, 9, 255]);
    }

    const result = createMagicWandSelectionFromImageData(imageData, { x: 0, y: 0 }, { tolerance: 0 });

    expect(result?.selectedPixelCount).toBe(5);
    // The concave corner at (1,1) is inside the bounding box but not selected, so the
    // outline has to step in to exclude it rather than tracing the bounding box.
    expect(result!.points).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
      { x: 3, y: 1 },
      { x: 2, y: 1 },
      { x: 1, y: 1 },
      { x: 1, y: 2 },
      { x: 1, y: 3 },
      { x: 0, y: 3 },
      { x: 0, y: 2 },
      { x: 0, y: 1 },
    ]);
  });

  it('traces a two-pixel-wide strip as a closed outline around both pixels', () => {
    const imageData = createImageData(4, 4, [0, 0, 0, 255]);
    setPixel(imageData, 1, 1, [255, 0, 0, 255]);
    setPixel(imageData, 2, 1, [255, 0, 0, 255]);

    const result = createMagicWandSelectionFromImageData(imageData, { x: 1, y: 1 }, { tolerance: 0 });

    expect(result?.selectedPixelCount).toBe(2);
    expect(result?.bounds).toEqual({ x: 1, y: 1, width: 2, height: 1 });
    expect(result!.points).toHaveLength(6);
    expect(getPointBounds(result!.points)).toEqual({ minX: 1, minY: 1, maxX: 3, maxY: 2 });
  });

  it('floors the seed to whole pixels', () => {
    const result = createMagicWandSelectionFromImageData(createImageData(3, 3, [10, 20, 30, 255]), { x: 0.9, y: 1.9 });

    expect(result?.bounds).toEqual({ x: 0, y: 0, width: 3, height: 3 });
    expect(result?.selectedPixelCount).toBe(9);
  });
});

describe('interior holes', () => {
  /**
   * A square ring: every lit pixel of `size` x `size` except the `holeSize` x `holeSize`
   * block in the middle, so a contiguous fill from any lit pixel encloses unselected pixels.
   */
  const squareRing = (size: number, holeSize: number) => {
    const imageData = createImageData(size, size, [0, 0, 0, 255]);
    const offset = Math.floor((size - holeSize) / 2);

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const inHole = x >= offset && x < offset + holeSize && y >= offset && y < offset + holeSize;
        if (!inHole) setPixel(imageData, x, y, [255, 0, 0, 255]);
      }
    }

    return imageData;
  };

  it.each([
    // The mask holds `size * size - holeSize * holeSize` pixels, but the outer contour alone
    // encloses all `size * size` of them, so committing it would cover the hole with pixels this
    // fill reported as unselected and make `selectedPixelCount` under-report the polygon.
    ['a single-pixel hole in a 5x5 ring', 5, 1],
    ['a single-pixel hole in a 3x3 ring', 3, 1],
    ['a 2x2 hole in a 5x5 ring', 5, 2],
  ])('returns null rather than a hole-covering outline for %s', (_label, size, holeSize) => {
    const result = createMagicWandSelectionFromImageData(
      squareRing(size, holeSize),
      { x: 0, y: 0 },
      {
        tolerance: 0,
      }
    );

    expect(result).toBeNull();
  });

  it('refuses a hole even when smoothing is on, since smoothing never widens the path', () => {
    expect(
      createMagicWandSelectionFromImageData(squareRing(5, 1), { x: 0, y: 0 }, { tolerance: 0, smoothing: 1 })
    ).toBeNull();
  });

  it('still returns a selection when disjoint same-winding regions matched, not a hole', () => {
    // A 2-pixel block and a 3-pixel L that share a corner are two independent outer contours, so
    // their loops have the same winding sign. They are siblings to pick between, not a hole, and
    // the larger one must still win. This is the other side of the discriminator the hole case
    // relies on: reading the sign the other way round would null this and commit the annulus.
    const imageData = createImageData(4, 4, [0, 0, 0, 255]);

    for (const [x, y] of [
      [0, 0],
      [1, 0],
      [2, 2],
      [3, 2],
      [3, 3],
    ]) {
      setPixel(imageData, x, y, [255, 0, 0, 255]);
    }

    const result = createMagicWandSelectionFromImageData(
      imageData,
      { x: 0, y: 0 },
      {
        tolerance: 0,
        contiguous: false,
      }
    );

    expect(result).not.toBeNull();
    expect(result?.selectedPixelCount).toBe(5);
    expect(getPointBounds(result!.points)).toEqual({ minX: 2, minY: 2, maxX: 4, maxY: 4 });
  });

  it('keeps a shape whose bounding box is full but whose missing pixels touch the outline', () => {
    // The concave L has unselected pixels inside its bounding box, but they are not enclosed, so
    // there is no second loop and the outline still steps in around the notch.
    const imageData = createImageData(3, 3, [0, 0, 0, 255]);

    for (const [x, y] of [
      [0, 0],
      [1, 0],
      [2, 0],
      [0, 1],
      [0, 2],
    ]) {
      setPixel(imageData, x, y, [9, 9, 9, 255]);
    }

    const result = createMagicWandSelectionFromImageData(imageData, { x: 0, y: 0 }, { tolerance: 0 });

    expect(result?.selectedPixelCount).toBe(5);
    expect(result!.points).toHaveLength(12);
  });
});

describe('degenerate image data', () => {
  it.each([
    ['zero width', 0, 4],
    ['zero height', 4, 0],
  ])('returns null for %s', (_label, width, height) => {
    expect(
      createMagicWandSelectionFromImageData(createImageData(width, height, [0, 0, 0, 255]), { x: 0, y: 0 })
    ).toBeNull();
  });

  it('returns null when the pixel buffer is too short to read a color from', () => {
    // The buffer yields `undefined` channels, so every distance is NaN, every pixel
    // comparison fails, `selectedPixelCount` stays at 0 and the bounds collapse to
    // the empty `Pos` that `finalizeBounds` produces for non-finite extents.
    const truncated = { colorSpace: 'srgb', data: new Uint8ClampedArray(0), height: 2, width: 2 } as ImageData;

    expect(createMagicWandSelectionFromImageData(truncated, { x: 0, y: 0 })).toBeNull();
  });

  it.each([
    ['a negative x', { x: -0.5, y: 0 }],
    ['a negative y', { x: 0, y: -1 }],
    ['an x past the last column', { x: 4, y: 0 }],
    ['a y past the last row', { x: 0, y: 4 }],
  ])('returns null for a seed with %s', (_label, seed) => {
    expect(createMagicWandSelectionFromImageData(createImageData(4, 4, [0, 0, 0, 255]), seed)).toBeNull();
  });
});

describe('boundary smoothing', () => {
  it('keeps the raw staircase outline when smoothing is omitted', () => {
    const result = createMagicWandSelectionFromImageData(createDiamondImageData(), { x: 2, y: 2 }, { tolerance: 0 });

    expect(result?.points).toHaveLength(20);
    expect(result?.selectedPixelCount).toBe(13);
  });

  it.each([
    [0, 20],
    [0.5, 12],
    [1, 4],
    [2, 4],
  ])('collapses the staircase to %i points at a smoothing tolerance of %i', (smoothing, expectedPoints) => {
    const result = createMagicWandSelectionFromImageData(
      createDiamondImageData(),
      { x: 2, y: 2 },
      { tolerance: 0, smoothing }
    );

    expect(result?.points).toHaveLength(expectedPoints);
  });

  it('reduces the diamond to its four extreme vertices at a smoothing tolerance of 1', () => {
    const result = createMagicWandSelectionFromImageData(
      createDiamondImageData(),
      { x: 2, y: 2 },
      { tolerance: 0, smoothing: 1 }
    );

    expect(result!.points).toEqual([
      { x: 2, y: 0 },
      { x: 5, y: 2 },
      { x: 3, y: 5 },
      { x: 0, y: 3 },
    ]);
  });

  it('never changes the pixel count, the sampled color or the bounds while smoothing', () => {
    const unsmoothed = createMagicWandSelectionFromImageData(
      createDiamondImageData(),
      { x: 2, y: 2 },
      { tolerance: 0 }
    )!;
    const smoothed = createMagicWandSelectionFromImageData(
      createDiamondImageData(),
      { x: 2, y: 2 },
      {
        tolerance: 0,
        smoothing: 1,
      }
    )!;

    expect(smoothed.selectedPixelCount).toBe(unsmoothed.selectedPixelCount);
    expect(smoothed.sampleColor).toEqual(unsmoothed.sampleColor);
    expect(smoothed.bounds).toEqual(unsmoothed.bounds);
  });

  it('falls back to the unsimplified outline when smoothing would collapse it below a triangle', () => {
    // `simplifyClosedPath` reduces a closed path to its two extreme points at this
    // tolerance, which is fewer than the three points a polygon needs, so it hands
    // back the raw outline instead of returning an unusable path.
    const raw = createMagicWandSelectionFromImageData(createDiamondImageData(), { x: 2, y: 2 }, { tolerance: 0 })!;
    const overSmoothed = createMagicWandSelectionFromImageData(
      createDiamondImageData(),
      { x: 2, y: 2 },
      {
        tolerance: 0,
        smoothing: 5,
      }
    )!;

    expect(overSmoothed.points).toEqual(raw.points);
  });

  it.each([-1, 0])('leaves the outline untouched at a smoothing tolerance of %i', (smoothing) => {
    const result = createMagicWandSelectionFromImageData(
      createDiamondImageData(),
      { x: 2, y: 2 },
      {
        tolerance: 0,
        smoothing,
      }
    );

    expect(result?.points).toHaveLength(20);
  });
});

describe('createMagicWandSelectionFromCanvas', () => {
  const solidCanvas = (width: number, height: number, color: [number, number, number, number]) =>
    makeMockCanvas(width, height, { getImageData: vi.fn(() => createImageData(width, height, color)) });

  it('reads the whole canvas and returns the same result as the image-data entry point', () => {
    const canvas = solidCanvas(3, 3, [5, 6, 7, 255]);

    const fromCanvas = createMagicWandSelectionFromCanvas(canvas, { x: 1, y: 1 });
    const fromData = createMagicWandSelectionFromImageData(createImageData(3, 3, [5, 6, 7, 255]), { x: 1, y: 1 });

    expect(fromCanvas).toEqual(fromData);
    expect(fromCanvas?.selectedPixelCount).toBe(9);
  });

  it('requests a frequently-read 2D context so the read-back stays on the CPU', () => {
    const canvas = solidCanvas(2, 2, [0, 0, 0, 255]);

    createMagicWandSelectionFromCanvas(canvas, { x: 0, y: 0 });

    expect(canvas.getContext).toHaveBeenCalledWith('2d', { willReadFrequently: true });
  });

  it('reads back the full canvas extent', () => {
    const canvas = solidCanvas(2, 3, [0, 0, 0, 255]);

    createMagicWandSelectionFromCanvas(canvas, { x: 0, y: 0 });

    const context = canvas.getContext('2d') as unknown as { getImageData: Mock };
    expect(context.getImageData).toHaveBeenCalledWith(0, 0, 2, 3);
  });

  it('returns null for a null canvas', () => {
    expect(createMagicWandSelectionFromCanvas(null, { x: 0, y: 0 })).toBeNull();
  });

  it.each([
    ['zero width', 0, 4],
    ['zero height', 4, 0],
  ])('returns null for a canvas with %s', (_label, width, height) => {
    expect(createMagicWandSelectionFromCanvas(makeMockCanvas(width, height), { x: 0, y: 0 })).toBeNull();
  });

  it('returns null when the canvas has no 2D context', () => {
    const canvas = { width: 4, height: 4, getContext: () => null } as unknown as HTMLCanvasElement;

    expect(createMagicWandSelectionFromCanvas(canvas, { x: 0, y: 0 })).toBeNull();
  });

  it('returns null instead of throwing when the read-back is rejected', () => {
    const canvas = makeMockCanvas(4, 4, {
      getImageData: () => {
        throw new Error('tainted canvas');
      },
    });

    expect(createMagicWandSelectionFromCanvas(canvas, { x: 0, y: 0 })).toBeNull();
  });

  it('propagates the image-data guards for an out-of-bounds seed on a real canvas', () => {
    expect(createMagicWandSelectionFromCanvas(solidCanvas(3, 3, [0, 0, 0, 255]), { x: 3, y: 0 })).toBeNull();
  });
});
