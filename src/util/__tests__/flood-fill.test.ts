import { describe, expect, it } from 'vitest';
import { floodFill, getMagicWandColorDistance, getToleranceDistance } from '../flood-fill.ts';

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

/** Counts the set bytes, so `pixelCount` is checked against the mask itself and not against a recount of the input. */
function countSelected(mask: Uint8Array): number {
  let count = 0;

  for (const value of mask) {
    if (value === 1) count += 1;
  }

  return count;
}

const BLACK: [number, number, number, number] = [0, 0, 0, 255];
const RED: [number, number, number, number] = [255, 0, 0, 255];

/**
 * A 3x3 image with a 2x2 red block in the top-left plus one red pixel at (2,2) that only
 * touches the block diagonally. The contiguous grow is 4-connected, so the two are separate
 * regions; the global sweep does not care about connectivity and takes all five.
 */
function createTwoRegions(): ImageData {
  const imageData = createImageData(3, 3, BLACK);

  for (const [x, y] of [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
    [2, 2],
  ]) {
    setPixel(imageData, x, y, RED);
  }

  return imageData;
}

/** A `size` x `size` red square with a `holeSize` x `holeSize` black block cut out of the middle. */
function createSquareRing(size: number, holeSize: number): ImageData {
  const imageData = createImageData(size, size, BLACK);
  const offset = Math.floor((size - holeSize) / 2);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const inHole = x >= offset && x < offset + holeSize && y >= offset && y < offset + holeSize;
      if (!inHole) setPixel(imageData, x, y, RED);
    }
  }

  return imageData;
}

describe('floodFill', () => {
  it('returns a mask with one row-major byte per image pixel', () => {
    const result = floodFill(createTwoRegions(), { x: 0, y: 0 }, { tolerance: 0, contiguous: true });

    expect(result!.mask).toHaveLength(9);
    expect(result!.mask).toBeInstanceOf(Uint8Array);
    expect([...result!.mask]).toEqual([1, 1, 0, 1, 1, 0, 0, 0, 0]);
    expect(result!.width).toBe(3);
    expect(result!.height).toBe(3);
  });

  it('counts only the set bytes, so `pixelCount` is the mask it hands back', () => {
    const result = floodFill(createTwoRegions(), { x: 0, y: 0 }, { tolerance: 0, contiguous: true });

    expect(result!.pixelCount).toBe(4);
    expect(countSelected(result!.mask)).toBe(result!.pixelCount);
  });

  it('grows 4-connected from the seed and leaves a diagonal-only pixel out', () => {
    const result = floodFill(createTwoRegions(), { x: 0, y: 0 }, { tolerance: 0, contiguous: true });

    expect(result!.pixelCount).toBe(4);
    expect(result!.mask[2 * 3 + 2]).toBe(0);
  });

  it('takes every matching pixel in the image when contiguous is false', () => {
    const result = floodFill(createTwoRegions(), { x: 0, y: 0 }, { tolerance: 0, contiguous: false });

    expect(result!.pixelCount).toBe(5);
    expect(countSelected(result!.mask)).toBe(5);
  });

  it('seeds the sample from the seed pixel, not from the first matching pixel', () => {
    // The seed is a lone red pixel among black, so a fill that sampled elsewhere would
    // return the black background instead of this one pixel.
    const result = floodFill(createTwoRegions(), { x: 2, y: 2 }, { tolerance: 0, contiguous: true });

    expect(result!.pixelCount).toBe(1);
    expect(result!.bounds).toEqual({ left: 2, top: 2, right: 2, bottom: 2 });
  });

  it('reports inclusive bounds, so a one-pixel region has right === left and bottom === top', () => {
    const result = floodFill(createTwoRegions(), { x: 0, y: 0 }, { tolerance: 0, contiguous: true });

    // The 2x2 block occupies columns 0-1 and rows 0-1. Inclusive bounds are what let a
    // consumer slice the source image with them without an off-by-one on the far edge.
    expect(result!.bounds).toEqual({ left: 0, top: 0, right: 1, bottom: 1 });
  });

  it('reports the tight bounding box spanning disjoint regions in a global fill', () => {
    const imageData = createImageData(4, 4, BLACK);
    setPixel(imageData, 1, 1, RED);
    setPixel(imageData, 3, 2, RED);

    const result = floodFill(imageData, { x: 1, y: 1 }, { tolerance: 0, contiguous: false });

    // The box has to span both pixels even though they are not connected, because a consumer
    // slicing the source image with these bounds gets the full extent of the selection.
    expect(result!.pixelCount).toBe(2);
    expect(result!.bounds).toEqual({ left: 1, top: 1, right: 3, bottom: 2 });
  });

  it('fills the whole image and touches all four edges when every pixel matches', () => {
    const result = floodFill(
      createImageData(3, 3, [10, 20, 30, 255]),
      { x: 1, y: 1 },
      { tolerance: 0, contiguous: true }
    );

    expect(result!.pixelCount).toBe(9);
    expect(result!.bounds).toEqual({ left: 0, top: 0, right: 2, bottom: 2 });
  });

  it('floors a fractional seed onto the pixel that contains it', () => {
    const imageData = createImageData(3, 3, BLACK);
    setPixel(imageData, 0, 1, RED);

    const result = floodFill(imageData, { x: 0.9, y: 1.9 }, { tolerance: 0, contiguous: true });

    expect(result!.pixelCount).toBe(1);
    expect(result!.bounds).toEqual({ left: 0, top: 1, right: 0, bottom: 1 });
  });

  it('returns null for a seed on any edge of the image', () => {
    const imageData = createImageData(4, 4, BLACK);

    for (const seed of [
      { x: -0.5, y: 0 },
      { x: 0, y: -1 },
      { x: 4, y: 0 },
      { x: 0, y: 4 },
    ]) {
      expect(floodFill(imageData, seed, { tolerance: 0, contiguous: true })).toBeNull();
    }
  });

  it.each([
    ['zero width', 0, 4],
    ['zero height', 4, 0],
  ])('returns null for %s', (_label, width, height) => {
    expect(
      floodFill(createImageData(width, height, BLACK), { x: 0, y: 0 }, { tolerance: 0, contiguous: true })
    ).toBeNull();
  });

  it('returns null rather than throwing when the tolerance cannot be compared', () => {
    // `getToleranceDistance` clamps to `Math.max(0, Math.min(100, NaN))`, which is NaN, so
    // every `distance <= tolerance` is false -- including the seed's distance to itself. The
    // seed can never match itself, so nothing is selected and the fill reports no region.
    expect(floodFill(createTwoRegions(), { x: 0, y: 0 }, { tolerance: Number.NaN, contiguous: true })).toBeNull();
  });

  it('returns null when the pixel buffer is too short to read a colour from', () => {
    // Every channel reads `undefined`, so every distance is NaN and nothing matches.
    const truncated = { colorSpace: 'srgb', data: new Uint8ClampedArray(0), height: 2, width: 2 } as ImageData;

    expect(floodFill(truncated, { x: 0, y: 0 }, { tolerance: 0, contiguous: true })).toBeNull();
  });

  it('keeps a region that has an enclosed hole, with the hole left at zero', () => {
    // This is the case the Magic Wand's public entry point has to refuse: a `Selection`
    // carries one point path, so it cannot express a ring. The mask has no such limitation,
    // and a Paint Bucket filling a ring must not repaint the hole.
    const result = floodFill(createSquareRing(5, 1), { x: 0, y: 0 }, { tolerance: 0, contiguous: true });

    expect(result).not.toBeNull();
    expect(result!.pixelCount).toBe(24);
    expect(result!.mask[2 * 5 + 2]).toBe(0);
    expect(result!.bounds).toEqual({ left: 0, top: 0, right: 4, bottom: 4 });
  });

  it('floods a single-pixel image, where every neighbour is out of bounds', () => {
    // `index % width` and `Math.floor(index / width)` are both 0 here, and all four
    // neighbour enqueues are guarded out, so the seed is the entire region.
    const result = floodFill(createImageData(1, 1, RED), { x: 0, y: 0 }, { tolerance: 0, contiguous: true });

    expect(result!.mask).toEqual(new Uint8Array([1]));
    expect(result!.pixelCount).toBe(1);
    expect(result!.bounds).toEqual({ left: 0, top: 0, right: 0, bottom: 0 });
  });
});

describe('floodFill tolerance', () => {
  // A 3x1 strip: the seed and its neighbour match exactly, and the third pixel is 220 units
  // away in red, which is 220 / 510 = 43.14% of the maximum colour distance. So a clamped
  // tolerance below 44% excludes it and 44% or more includes it, regardless of the raw value.
  const toleranceStrip = () => {
    const imageData = createImageData(3, 1, [220, 0, 0, 255]);
    setPixel(imageData, 2, 0, BLACK);
    return imageData;
  };

  it.each([
    ['a negative tolerance is clamped to zero', -50, 2],
    ['zero is an exact-match tolerance', 0, 2],
    ['a tolerance just below the distance threshold excludes the pixel', 43, 2],
    ['a tolerance just above the distance threshold includes the pixel', 44, 3],
    ['the maximum tolerance keeps every pixel in range', 100, 3],
    ['a tolerance above 100 is clamped to the maximum', 1e9, 3],
  ])('%s', (_label, tolerance, expectedCount) => {
    const result = floodFill(toleranceStrip(), { x: 0, y: 0 }, { tolerance, contiguous: true });

    expect(result?.pixelCount).toBe(expectedCount);
  });

  it('widens the reported bounds to everything the tolerance pulled in', () => {
    const result = floodFill(toleranceStrip(), { x: 0, y: 0 }, { tolerance: 44, contiguous: true });

    expect(result!.bounds).toEqual({ left: 0, top: 0, right: 2, bottom: 0 });
  });

  it('widens the grow past a colour boundary before connectivity ever gets a say', () => {
    // Seeded on the black background at (2,0). At tolerance 0 only the black neighbour
    // (2,1) is reachable, so the fill stops at 2 pixels. The red block is 255 units away in
    // red, which is exactly 50% of the maximum distance, so tolerance 50 pulls it in and
    // the two regions that were separate at tolerance 0 become one.
    const exact = floodFill(createTwoRegions(), { x: 2, y: 0 }, { tolerance: 0, contiguous: true });
    const tolerant = floodFill(createTwoRegions(), { x: 2, y: 0 }, { tolerance: 50, contiguous: true });

    expect(exact!.pixelCount).toBe(2);
    expect(tolerant!.pixelCount).toBe(9);
    expect(tolerant!.bounds).toEqual({ left: 0, top: 0, right: 2, bottom: 2 });
  });

  it('treats alpha as a channel, so a transparent seed does not match opaque neighbours', () => {
    // `getImageData` returns un-premultiplied RGBA, so alpha 0 and alpha 255 differ by a full
    // 255 in the distance, which at tolerance 0 is a hard cut.
    const imageData = createImageData(3, 3, BLACK);
    setPixel(imageData, 1, 1, [0, 0, 0, 0]);

    const result = floodFill(imageData, { x: 1, y: 1 }, { tolerance: 0, contiguous: true });

    expect(result!.pixelCount).toBe(1);
  });
});

describe('getToleranceDistance', () => {
  it('maps the 0-100 scale linearly onto the maximum colour distance', () => {
    // The maximum is `sqrt(255 * 255 * 4)` = 510, so a tolerance of 50 is 255.
    expect(getToleranceDistance(0)).toBe(0);
    expect(getToleranceDistance(50)).toBe(255);
    expect(getToleranceDistance(100)).toBe(510);
  });

  it.each([
    ['a negative tolerance clamps to the minimum', -50, 0],
    ['a tolerance above 100 clamps to the maximum', 150, 510],
    ['an absurd tolerance still clamps to the maximum', 1e9, 510],
  ])('%s', (_label, tolerance, expected) => {
    expect(getToleranceDistance(tolerance)).toBe(expected);
  });

  it('stays NaN for a NaN tolerance instead of silently selecting everything', () => {
    // `Math.min(100, NaN)` is NaN, and no comparison against NaN is true. That is what turns a
    // broken tolerance into a no-op region rather than a whole-image match.
    expect(getToleranceDistance(Number.NaN)).toBeNaN();
  });
});

describe('getMagicWandColorDistance', () => {
  it('is reachable from this module, so a consumer needs not reach into the wand', () => {
    expect(getMagicWandColorDistance({ r: 0, g: 0, b: 0, a: 0 }, { r: 3, g: 4, b: 0, a: 0 })).toBe(5);
  });

  it('reaches exactly the maximum channel distance for opaque black against opaque white', () => {
    expect(getMagicWandColorDistance({ r: 0, g: 0, b: 0, a: 0 }, { r: 255, g: 255, b: 255, a: 255 })).toBe(510);
  });
});
