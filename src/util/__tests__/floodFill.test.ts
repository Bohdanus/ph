/**
 * Pins the fill-grade contract of `src/util/floodFill.ts`: a 0-255 tolerance, a 3-D RGB
 * distance, a 4-connected flood, holes kept in the mask, and `null` in place of an empty mask.
 *
 * The cases that carry the weight are the ones where this module must differ from
 * `src/util/magicWand.ts`, which is a sibling module and not a template for this one. The wand
 * folds the alpha delta into its distance (`:58-65`) and clamps tolerance to 0-100 (`:67-69`);
 * the fill uses `getToleranceDistance` over `MAX_COLOR_DISTANCE = sqrt(255 * 255 * 3)` and a
 * squared comparison, so the alpha cases here are the ones that fail if the sibling is copied.
 * The wand also refuses any region with an enclosed hole (`:348`), so the ring cases are the
 * ones that fail if this module is a wrapper around it. Both sibling behaviours are asserted in
 * `src/util/__tests__/magicWand.test.ts` and are correct there, so the contrast is stated here
 * rather than repaired there.
 *
 * Every tolerance threshold below is a number rather than a description, because the whole point
 * of the rescaled metric is that a caller can predict which pixels a given tolerance reaches:
 * a 0-255 tolerance maps onto a maximum RGB distance of `255 * sqrt(3)`, so a pixel at distance
 * `d` is selected at tolerance `d / sqrt(3)`.
 */
import { describe, expect, it } from 'vitest';
import { createFloodFillMask, type FloodFillOptions } from '../floodFill.ts';
import { createMagicWandSelectionFromImageData } from '../magicWand.ts';

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

function getPixelIndex(x: number, y: number, width: number): number {
  return y * width + x;
}

function countSelectedBytes(mask: Uint8Array): number {
  let count = 0;

  for (let i = 0; i < mask.length; i++) {
    if (mask[i] === 1) count += 1;
  }

  return count;
}

/** A 3x3 image with a 2x2 block in the top-left plus one pixel that only touches it at a corner. */
function createCornerTouchingRegions(): ImageData {
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
}

/**
 * A 5x1 strip seeded at (0,0) with opaque black and four lit neighbours at RGB distances 50, 173,
 * 255 and `255 * sqrt(3)`, which a 0-255 tolerance reaches at 29, 100, 148 and 255. The last one is
 * the largest distance a 3-channel metric can produce, so it pins the end of the scale: only
 * tolerance 255 reaches it, and a tolerance of 9999 must behave identically to 255.
 */
function createToleranceStrip(): ImageData {
  const imageData = createImageData(5, 1, [0, 0, 0, 255]);
  setPixel(imageData, 1, 0, [50, 0, 0, 255]);
  setPixel(imageData, 2, 0, [173, 0, 0, 255]);
  setPixel(imageData, 3, 0, [0, 0, 255, 255]);
  setPixel(imageData, 4, 0, [255, 255, 255, 255]);

  return imageData;
}

/** A 6x6 blue image with a 2x2 red block, so the fill is 4 pixels in a 36-pixel buffer. */
function createRedBlockOnBlue(): ImageData {
  const imageData = createImageData(6, 6, [0, 0, 255, 255]);

  for (const [x, y] of [
    [2, 2],
    [3, 2],
    [2, 3],
    [3, 3],
  ]) {
    setPixel(imageData, x, y, [255, 0, 0, 255]);
  }

  return imageData;
}

/** A square ring: every lit pixel of `size` x `size` except the `holeSize` x `holeSize` centre. */
function createSquareRing(size: number, holeSize: number): ImageData {
  const imageData = createImageData(size, size, [0, 0, 0, 255]);
  const offset = Math.floor((size - holeSize) / 2);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const inHole = x >= offset && x < offset + holeSize && y >= offset && y < offset + holeSize;
      if (!inHole) setPixel(imageData, x, y, [255, 0, 0, 255]);
    }
  }

  return imageData;
}

describe('flood fill mask', () => {
  it('selects the exact-colour region around the seed and reports a tight bounding box', () => {
    const result = createFloodFillMask(createRedBlockOnBlue(), { x: 2, y: 2 }, { tolerance: 0 });

    expect(result?.selectedPixelCount).toBe(4);
    expect(result?.sampleColor).toEqual({ r: 255, g: 0, b: 0, a: 255 });
    expect(result?.bounds).toEqual({ left: 2, top: 2, right: 3, bottom: 3 });
    expect(result?.mask).toHaveLength(36);
  });

  it('samples the colour at the seed even when the seed is the only match', () => {
    const result = createFloodFillMask(createCornerTouchingRegions(), { x: 2, y: 2 }, { tolerance: 0 });

    expect(result?.selectedPixelCount).toBe(1);
    expect(result?.sampleColor).toEqual({ r: 255, g: 0, b: 0, a: 255 });
    expect(result?.bounds).toEqual({ left: 2, top: 2, right: 2, bottom: 2 });
  });

  it('floors the seed to whole pixels', () => {
    const result = createFloodFillMask(createImageData(3, 3, [10, 20, 30, 255]), { x: 1.9, y: 2.9 });

    expect(result?.selectedPixelCount).toBe(9);
    expect(result?.bounds).toEqual({ left: 0, top: 0, right: 2, bottom: 2 });
  });

  it('selects a one-pixel image as a single selected pixel in a one-pixel bounding box', () => {
    const result = createFloodFillMask(createImageData(1, 1, [7, 8, 9, 255]), { x: 0, y: 0 });

    expect(result?.selectedPixelCount).toBe(1);
    expect([...result!.mask]).toEqual([1]);
    expect(result?.bounds).toEqual({ left: 0, top: 0, right: 0, bottom: 0 });
  });

  it('selects every pixel of a fully matching image, all four edges included', () => {
    const result = createFloodFillMask(createImageData(4, 3, [10, 20, 30, 255]), { x: 2, y: 1 });

    expect(result?.selectedPixelCount).toBe(12);
    expect(countSelectedBytes(result!.mask)).toBe(12);
    expect(result?.bounds).toEqual({ left: 0, top: 0, right: 3, bottom: 2 });
  });
});

describe('tolerance', () => {
  it.each([
    ['an omitted tolerance falls back to the default of 32', undefined, 2],
    ['a negative tolerance is clamped to zero', -50, 1],
    ['zero selects only the exact match', 0, 1],
    ['28 is one unit below the threshold for the 50-distance neighbour', 28, 1],
    ['29 is the first tolerance that reaches the 50-distance neighbour', 29, 2],
    ['99 is one unit below the threshold for the 173-distance neighbour', 99, 2],
    ['100 is the first tolerance that reaches the 173-distance neighbour', 100, 3],
    ['147 is one unit below the threshold for the 255-distance neighbour', 147, 3],
    ['148 is the first tolerance that reaches the 255-distance neighbour', 148, 4],
    ['254 cannot reach the maximum distance of the 3-channel metric', 254, 4],
    ['255 is the maximum of the scale and reaches every RGB distance', 255, 5],
    ['a tolerance above 255 is clamped to the maximum', 9999, 5],
    ['a NaN tolerance falls back to the default rather than matching nothing', Number.NaN, 2],
    ['an infinite tolerance falls back to the default rather than clamping to 255', Number.POSITIVE_INFINITY, 2],
  ])('%s', (_label, tolerance, expectedCount) => {
    const result = createFloodFillMask(createToleranceStrip(), { x: 0, y: 0 }, { tolerance });

    expect(result?.selectedPixelCount).toBe(expectedCount);
  });

  it('includes the neighbours inside the tolerance and excludes the ones past it, mask byte by mask byte', () => {
    const narrow = createFloodFillMask(createToleranceStrip(), { x: 0, y: 0 }, { tolerance: 29 })!;
    const wide = createFloodFillMask(createToleranceStrip(), { x: 0, y: 0 }, { tolerance: 100 })!;

    expect([...narrow.mask]).toEqual([1, 1, 0, 0, 0]);
    expect(narrow.bounds).toEqual({ left: 0, top: 0, right: 1, bottom: 0 });
    expect([...wide.mask]).toEqual([1, 1, 1, 0, 0]);
    expect(wide.bounds).toEqual({ left: 0, top: 0, right: 2, bottom: 0 });
  });
});

describe('alpha does not participate', () => {
  it('selects a fully transparent neighbour of an opaque seed, since only RGB is compared', () => {
    const imageData = createImageData(3, 3, [0, 0, 0, 255]);
    setPixel(imageData, 1, 1, [0, 0, 0, 0]);
    setPixel(imageData, 2, 1, [0, 0, 0, 128]);

    const result = createFloodFillMask(imageData, { x: 0, y: 0 }, { tolerance: 0 });

    expect(result?.selectedPixelCount).toBe(9);
    expect(result?.sampleColor).toEqual({ r: 0, g: 0, b: 0, a: 255 });
    expect(result?.mask[getPixelIndex(1, 1, 3)]).toBe(1);
    expect(result?.mask[getPixelIndex(2, 1, 3)]).toBe(1);
  });

  it('selects opaque neighbours of a fully transparent seed at the same zero tolerance', () => {
    const imageData = createImageData(3, 3, [0, 0, 0, 255]);
    setPixel(imageData, 1, 1, [0, 0, 0, 0]);

    const result = createFloodFillMask(imageData, { x: 1, y: 1 }, { tolerance: 0 });

    expect(result?.selectedPixelCount).toBe(9);
    expect(result?.sampleColor).toEqual({ r: 0, g: 0, b: 0, a: 0 });
  });

  it('isolates a transparent seed from an opaque neighbour where the magic wand does not', () => {
    // The same image under the 4-D metric: `getMagicWandColorDistance` adds the 255-unit alpha
    // gap, so the opaque neighbours fall outside a zero tolerance and the wand selects one pixel.
    const imageData = createImageData(3, 3, [0, 0, 0, 255]);
    setPixel(imageData, 1, 1, [0, 0, 0, 0]);

    expect(createMagicWandSelectionFromImageData(imageData, { x: 1, y: 1 }, { tolerance: 0 })?.selectedPixelCount).toBe(
      1
    );
  });
});

describe('neighbour connectivity', () => {
  it('stops at a corner, so two regions that touch only diagonally are not both selected', () => {
    const result = createFloodFillMask(createCornerTouchingRegions(), { x: 0, y: 0 }, { tolerance: 0 })!;

    // 4-connected, matching Adobe's Contiguous fill and `createContiguousMask` in the wand. An
    // 8-connected flood would report 5 here, and a fill that leaked across a corner would paint
    // into a region the user did not click into.
    expect(result.selectedPixelCount).toBe(4);
    expect(result.mask[getPixelIndex(2, 2, 3)]).toBe(0);
    expect(result.bounds).toEqual({ left: 0, top: 0, right: 1, bottom: 1 });
  });

  it('treats an explicit contiguous: true the same as the default', () => {
    const explicit = createFloodFillMask(
      createCornerTouchingRegions(),
      { x: 0, y: 0 },
      {
        tolerance: 0,
        contiguous: true,
      }
    );
    const implicit = createFloodFillMask(createCornerTouchingRegions(), { x: 0, y: 0 }, { tolerance: 0 });

    expect(explicit).toEqual(implicit);
  });

  it('selects both regions when contiguous is false', () => {
    const result = createFloodFillMask(
      createCornerTouchingRegions(),
      { x: 0, y: 0 },
      {
        tolerance: 0,
        contiguous: false,
      }
    )!;

    expect(result.selectedPixelCount).toBe(5);
    expect(result.mask[getPixelIndex(2, 2, 3)]).toBe(1);
    expect(result.bounds).toEqual({ left: 0, top: 0, right: 2, bottom: 2 });
  });
});

describe('counts and bounds', () => {
  it.each([
    ['a 2x2 block on a 6x6 background', createRedBlockOnBlue(), { x: 2, y: 2 }, { tolerance: 0 }, 4],
    [
      'a 4-connected region with a diagonal neighbour left out',
      createCornerTouchingRegions(),
      { x: 0, y: 0 },
      { tolerance: 0 },
      4,
    ],
    [
      'the same image scanned globally',
      createCornerTouchingRegions(),
      { x: 0, y: 0 },
      { tolerance: 0, contiguous: false },
      5,
    ],
    ['a tolerance strip at 100', createToleranceStrip(), { x: 0, y: 0 }, { tolerance: 100 }, 3],
    ['a 5x5 ring with a one-pixel hole', createSquareRing(5, 1), { x: 0, y: 0 }, { tolerance: 0 }, 24],
    [
      'a fully matching 3x3 image at the default tolerance',
      createImageData(3, 3, [10, 20, 30, 255]),
      { x: 1, y: 1 },
      {},
      9,
    ],
  ])('reports a count equal to the set mask bytes for %s', (_label, imageData, seed, options, expectedCount) => {
    const result = createFloodFillMask(imageData, seed, options)!;

    expect(result.selectedPixelCount).toBe(expectedCount);
    expect(countSelectedBytes(result.mask)).toBe(result.selectedPixelCount);
    expect(result.mask).toHaveLength(imageData.width * imageData.height);
  });

  it('bounds are tight, so unselected pixels inside the bounding box do not widen them', () => {
    const imageData = createImageData(5, 5, [0, 0, 0, 255]);

    for (const [x, y] of [
      [2, 1],
      [1, 2],
      [2, 2],
      [3, 2],
      [2, 3],
    ]) {
      setPixel(imageData, x, y, [9, 9, 9, 255]);
    }

    const result = createFloodFillMask(imageData, { x: 2, y: 2 }, { tolerance: 0 })!;

    // The four corners of the 3x3 bounding box are unselected, so `right` and `bottom` are the
    // last selected pixel indices rather than the box the flood happened to visit.
    expect(result.selectedPixelCount).toBe(5);
    expect(result.bounds).toEqual({ left: 1, top: 1, right: 3, bottom: 3 });
    expect(result.mask[getPixelIndex(1, 1, 5)]).toBe(0);
  });

  it('returns null rather than a result with null bounds when nothing was selected', () => {
    // Nothing selected is the only route to `bounds: null`, so the contract is that no result is
    // returned at all: a caller must never receive a mask it cannot tell apart from an empty one.
    const truncated = { colorSpace: 'srgb', data: new Uint8ClampedArray(0), height: 2, width: 2 } as ImageData;

    expect(createFloodFillMask(truncated, { x: 0, y: 0 })).toBeNull();
    expect(createFloodFillMask(createImageData(4, 4, [0, 0, 0, 255]), { x: 4, y: 4 })).toBeNull();
  });
});

describe('interior holes', () => {
  it.each([
    ['a single-pixel hole in a 3x3 ring', 3, 1, 8],
    ['a single-pixel hole in a 5x5 ring', 5, 1, 24],
    ['a 2x2 hole in a 5x5 ring', 5, 2, 21],
  ])('keeps %s in the mask without selecting its centre', (_label, size, holeSize, expectedCount) => {
    const imageData = createSquareRing(size, holeSize);
    const offset = Math.floor((size - holeSize) / 2);
    const result = createFloodFillMask(imageData, { x: 0, y: 0 }, { tolerance: 0 })!;

    expect(result.selectedPixelCount).toBe(expectedCount);
    expect(result.mask[getPixelIndex(offset, offset, size)]).toBe(0);
    expect(result.bounds).toEqual({ left: 0, top: 0, right: size - 1, bottom: size - 1 });
  });

  it('fills a ring the magic wand refuses, since the wand nulls any hole at magicWand.ts:348', () => {
    const imageData = createSquareRing(5, 1);

    expect(createMagicWandSelectionFromImageData(imageData, { x: 0, y: 0 }, { tolerance: 0 })).toBeNull();
    expect(createFloodFillMask(imageData, { x: 0, y: 0 }, { tolerance: 0 })?.selectedPixelCount).toBe(24);
  });
});

describe('degenerate input', () => {
  it.each([
    ['a negative x', { x: -1, y: 0 }],
    ['a negative y', { x: 0, y: -1 }],
    ['an x past the last column', { x: 4, y: 0 }],
    ['a y past the last row', { x: 0, y: 4 }],
  ])('returns null for a seed with %s', (_label, seed) => {
    expect(createFloodFillMask(createImageData(4, 4, [0, 0, 0, 255]), seed)).toBeNull();
  });

  it.each([
    ['zero width', 0, 4],
    ['zero height', 4, 0],
  ])('returns null for %s', (_label, width, height) => {
    expect(createFloodFillMask(createImageData(width, height, [0, 0, 0, 255]), { x: 0, y: 0 })).toBeNull();
  });
});

describe('large images', () => {
  const LARGE = 2000;

  /**
   * Milliseconds for one fill, with the image built BEFORE the clock starts, so the number is
   * the algorithm and not the `Uint8ClampedArray` allocation. The count is asserted on every
   * call: a fill that returned early would be fast and must not be able to satisfy a cost
   * assertion.
   */
  const timeFill = (size: number, options: FloodFillOptions): number => {
    const imageData = createImageData(size, size, [12, 34, 56, 255]);

    const startedAt = performance.now();
    const result = createFloodFillMask(imageData, { x: size / 2, y: size / 2 }, { tolerance: 0, ...options });
    const elapsed = performance.now() - startedAt;

    expect(result?.selectedPixelCount).toBe(size * size);

    return elapsed;
  };

  const SCALE_CASES: Array<[string, FloodFillOptions]> = [
    ['the 4-connected flood', {}],
    ['the global scan', { contiguous: false }],
  ];

  it.each(SCALE_CASES)('scales with pixel count, not with pixel count squared, for %s', (_label, options) => {
    // A wall-clock bound cannot see the regression it claims to guard. A quadratic fill and a
    // linear one differ by an order of magnitude only when two SIZES are compared on the same
    // run, where the machine's own speed cancels out; against a fixed 20s ceiling both pass on a
    // fast runner and both fail on a loaded one. So the comparison is between two sizes.
    //
    // 2000x2000 is 4x the pixels of 1000x1000: linear costs ~4x, quadratic costs ~16x. The
    // bound is 8x, which splits that space 4:1 in favour of linear.
    //
    // The ramp starts at 1000 rather than 500 because of what the small step actually measures.
    // On the machine this was written on (fastest of 5, image built outside the clock) 500x500
    // cost 1.1-2.7ms and 1000x1000 cost 4.2-12.5ms: with a 500x500 small step the measured time
    // is the same order as any floor worth setting, and a quadratic 1000x1000 lands only ~1.1x
    // over the bound — a tripwire with no teeth. At 1000x1000 the small step clears the floor,
    // and the passing and the failing side each keep about 2x. Re-measure before changing these
    // two constants; do not trust the figures above on a different machine.
    const SMALL = 1000;
    const BIG = 2000;
    // The floor only exists so a fast machine cannot fail the comparison by dividing by a small
    // run that measured at or near zero.
    const FLOOR_MS = 4;
    const LIMIT = 8;
    const SAMPLES = 5;

    // Warm-up, excluded from the samples: the first call pays for the JIT and for the queue
    // allocation, and a cold small run would make the ratio look worse than the algorithm is.
    timeFill(256, options);
    timeFill(256, options);

    // Interleaved, so a CPU spike from a neighbouring test run lands on both sizes instead of
    // inflating one of them, and each size is reduced by its FASTEST sample rather than its mean.
    const small: number[] = [];
    const large: number[] = [];
    for (let i = 0; i < SAMPLES; i++) {
      small.push(timeFill(SMALL, options));
      large.push(timeFill(BIG, options));
    }

    const smallMs = Math.min(...small);
    const largeMs = Math.min(...large);

    expect(largeMs).toBeLessThan(Math.max(smallMs, FLOOR_MS) * LIMIT);
  });

  it('fills all four million pixels of a 2000x2000 image contiguously', () => {
    // No wall-clock assertion: the cost guard above is the scaling comparison, and duplicating it
    // here as a second clock would only add a machine-dependent failure. What is left is what a
    // clock could never check anyway — that the flood reaches every pixel of a 4M-pixel buffer,
    // that the mask agrees with the count, and that the bounds cover the whole image.
    const imageData = createImageData(LARGE, LARGE, [12, 34, 56, 255]);

    const result = createFloodFillMask(imageData, { x: 1000, y: 1000 }, { tolerance: 0 })!;

    expect(result.selectedPixelCount).toBe(LARGE * LARGE);
    expect(countSelectedBytes(result.mask)).toBe(LARGE * LARGE);
    expect(result.bounds).toEqual({ left: 0, top: 0, right: LARGE - 1, bottom: LARGE - 1 });
  }, 30_000);

  it('scans every pixel of the same image when contiguous is false', () => {
    const imageData = createImageData(LARGE, LARGE, [12, 34, 56, 255]);

    const result = createFloodFillMask(imageData, { x: 0, y: 0 }, { tolerance: 0, contiguous: false })!;

    // Seeded in a corner: the global scan ignores the seed's position, so this also pins that
    // the bounds are the whole image rather than the region a flood from (0,0) would reach.
    expect(result.selectedPixelCount).toBe(LARGE * LARGE);
    expect(countSelectedBytes(result.mask)).toBe(LARGE * LARGE);
    expect(result.bounds).toEqual({ left: 0, top: 0, right: LARGE - 1, bottom: LARGE - 1 });
  }, 30_000);
});
