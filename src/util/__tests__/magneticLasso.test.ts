import { describe, expect, it, vi, type Mock } from 'vitest';
import { makeMockCanvas } from '@/__tests__/canvas-mock.ts';
import {
  clampPointToEdgeMap,
  createEdgeMapFromCanvas,
  createEdgeMapFromImageData,
  createMagneticSegment,
  findMagneticPath,
  findStrongestGradientPoint,
  pathLength,
  sampleLinePath,
  simplifyPath,
} from '../magneticLasso.ts';

function createVerticalEdgeImageData(width: number, height: number, edgeX: number): ImageData {
  const imageData = {
    colorSpace: 'srgb',
    data: new Uint8ClampedArray(width * height * 4),
    height,
    width,
  } as ImageData;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4;
      const value = x < edgeX ? 0 : 255;
      imageData.data[index] = value;
      imageData.data[index + 1] = value;
      imageData.data[index + 2] = value;
      imageData.data[index + 3] = 255;
    }
  }

  return imageData;
}

function createUniformImageData(width: number, height: number, value: number): ImageData {
  const imageData = {
    colorSpace: 'srgb',
    data: new Uint8ClampedArray(width * height * 4),
    height,
    width,
  } as ImageData;

  for (let i = 0; i < width * height; i++) {
    const index = i * 4;
    imageData.data[index] = value;
    imageData.data[index + 1] = value;
    imageData.data[index + 2] = value;
    imageData.data[index + 3] = 255;
  }

  return imageData;
}

/** A 30x10 image with a 40-grey step on the left and a full white step on the right. */
function createTwoStepImageData(): ImageData {
  const imageData = createUniformImageData(30, 10, 0);

  for (let y = 0; y < 10; y++) {
    for (let x = 0; x < 5; x++) {
      const index = (y * 30 + x) * 4;
      imageData.data[index] = 40;
      imageData.data[index + 1] = 40;
      imageData.data[index + 2] = 40;
    }
    for (let x = 20; x < 30; x++) {
      const index = (y * 30 + x) * 4;
      imageData.data[index] = 255;
      imageData.data[index + 1] = 255;
      imageData.data[index + 2] = 255;
    }
  }

  return imageData;
}

describe('magnetic lasso utilities', () => {
  it('builds a gradient map from merged canvas pixels and snaps near the strongest edge', () => {
    const edgeMap = createEdgeMapFromImageData(createVerticalEdgeImageData(24, 16, 10));
    const snap = findStrongestGradientPoint(edgeMap, { x: 12, y: 8 }, 5, 10, 1);

    expect(edgeMap.maxGradient).toBeGreaterThan(0);
    expect(snap.usedMagnetic).toBe(true);
    expect(Math.abs(snap.point.x - 9)).toBeLessThanOrEqual(1);
  });

  it('creates a magnetic segment that follows high-gradient pixels when possible', () => {
    const edgeMap = createEdgeMapFromImageData(createVerticalEdgeImageData(24, 24, 10));
    const segment = createMagneticSegment({
      cursor: { x: 12, y: 20 },
      edgeMap,
      from: { x: 10, y: 3 },
      options: {
        edgeContrast: 5,
        searchRadius: 5,
        snapStrength: 1,
      },
    });

    expect(segment.snap.usedMagnetic).toBe(true);
    expect(segment.path.length).toBeGreaterThan(2);
    expect(segment.path.some((point) => Math.abs(point.x - 9) <= 1)).toBe(true);
  });

  it('falls back to a sampled straight line when magnetic snapping is disabled', () => {
    const edgeMap = createEdgeMapFromImageData(createVerticalEdgeImageData(24, 24, 10));
    const segment = createMagneticSegment({
      cursor: { x: 16, y: 3 },
      edgeMap,
      from: { x: 2, y: 3 },
      magneticEnabled: false,
      options: {
        edgeContrast: 5,
        searchRadius: 5,
        snapStrength: 1,
      },
    });

    expect(segment.snap.usedMagnetic).toBe(false);
    expect(segment.path[0]).toEqual({ x: 2, y: 3 });
    expect(segment.path[segment.path.length - 1]).toEqual({ x: 16, y: 3 });
  });

  it('simplifies dense paths while preserving endpoints', () => {
    const simplified = simplifyPath(
      [
        { x: 0, y: 0 },
        { x: 1, y: 0.1 },
        { x: 2, y: -0.1 },
        { x: 3, y: 0 },
      ],
      0.5
    );

    expect(simplified).toEqual([
      { x: 0, y: 0 },
      { x: 3, y: 0 },
    ]);
  });
});

describe('createEdgeMapFromImageData', () => {
  it.each([
    ['a single pixel', 1, 1],
    ['a single row', 3, 1],
    ['a single column', 1, 3],
  ])('reports no gradient for %s, which has no interior to differentiate', (_label, width, height) => {
    // The Sobel pass only runs over the strict interior, so any image thinner or
    // shorter than three pixels has an all-zero gradient field.
    const edgeMap = createEdgeMapFromImageData(createUniformImageData(width, height, 128));

    expect(edgeMap.width).toBe(width);
    expect(edgeMap.height).toBe(height);
    expect(edgeMap.maxGradient).toBe(0);
    expect(Array.from(edgeMap.gradientMagnitude).every((value) => value === 0)).toBe(true);
  });

  it('allocates one luma, magnitude and direction sample per pixel', () => {
    const edgeMap = createEdgeMapFromImageData(createVerticalEdgeImageData(12, 9, 5));

    expect(edgeMap.luma).toHaveLength(12 * 9);
    expect(edgeMap.gradientMagnitude).toHaveLength(12 * 9);
    expect(edgeMap.gradientDirection).toHaveLength(12 * 9);
  });

  it('leaves the outermost ring of the gradient field at zero', () => {
    const edgeMap = createEdgeMapFromImageData(createVerticalEdgeImageData(12, 9, 5));
    const { width, height } = edgeMap;
    const isZero = (x: number, y: number) => edgeMap.gradientMagnitude[y * width + x] === 0;

    expect(isZero(0, 0)).toBe(true);
    expect(isZero(width - 1, 0)).toBe(true);
    expect(isZero(0, height - 1)).toBe(true);
    expect(isZero(width - 1, height - 1)).toBe(true);
  });

  it('composites a fully transparent pixel toward white rather than toward black', () => {
    // `luma = rgbLuma * alpha + 255 * (1 - alpha)`, so a transparent black pixel has the
    // same luma as an opaque white one and cannot be told apart from the background.
    const transparent = createEdgeMapFromImageData({
      colorSpace: 'srgb',
      data: new Uint8ClampedArray(16),
      height: 2,
      width: 2,
    } as ImageData);

    expect(transparent.luma[0]).toBe(255);
  });

  it('scales a fully opaque pixel by its own luminance', () => {
    const edgeMap = createEdgeMapFromImageData(createUniformImageData(3, 3, 128));

    expect(edgeMap.luma[0]).toBeCloseTo(128, 6);
  });
});

describe('createEdgeMapFromCanvas', () => {
  it('reads the whole canvas and produces a gradient map', () => {
    const canvas = makeMockCanvas(8, 6, {
      getImageData: vi.fn(() => createVerticalEdgeImageData(8, 6, 4)),
    });

    const edgeMap = createEdgeMapFromCanvas(canvas);

    expect(edgeMap?.width).toBe(8);
    expect(edgeMap?.height).toBe(6);
    expect(edgeMap!.maxGradient).toBeGreaterThan(0);
    const context = canvas.getContext('2d') as unknown as { getImageData: Mock };
    expect(context.getImageData).toHaveBeenCalledWith(0, 0, 8, 6);
  });

  it('returns null for a null canvas', () => {
    expect(createEdgeMapFromCanvas(null)).toBeNull();
  });

  it.each([
    ['zero width', 0, 6],
    ['zero height', 8, 0],
  ])('returns null for a canvas with %s', (_label, width, height) => {
    expect(createEdgeMapFromCanvas(makeMockCanvas(width, height))).toBeNull();
  });

  it('returns null when the canvas has no 2D context', () => {
    const canvas = { width: 4, height: 4, getContext: () => null } as unknown as HTMLCanvasElement;

    expect(createEdgeMapFromCanvas(canvas)).toBeNull();
  });

  it('returns null instead of throwing when the read-back is rejected', () => {
    const canvas = makeMockCanvas(4, 4, {
      getImageData: () => {
        throw new Error('tainted canvas');
      },
    });

    expect(createEdgeMapFromCanvas(canvas)).toBeNull();
  });
});

describe('clampPointToEdgeMap', () => {
  const edgeMap = createEdgeMapFromImageData(createVerticalEdgeImageData(24, 16, 10));

  it('leaves an in-range point untouched', () => {
    expect(clampPointToEdgeMap(edgeMap, { x: 3, y: 4 })).toEqual({ x: 3, y: 4 });
  });

  it('clamps to the last addressable pixel rather than the image size', () => {
    expect(clampPointToEdgeMap(edgeMap, { x: 999, y: 999 })).toEqual({ x: 23, y: 15 });
  });

  it('clamps negative coordinates to the origin', () => {
    expect(clampPointToEdgeMap(edgeMap, { x: -5, y: -1 })).toEqual({ x: 0, y: 0 });
  });

  it('does not round fractional coordinates', () => {
    expect(clampPointToEdgeMap(edgeMap, { x: 3.7, y: 4.2 })).toEqual({ x: 3.7, y: 4.2 });
  });
});

describe('findStrongestGradientPoint', () => {
  const edgeMap = createEdgeMapFromImageData(createVerticalEdgeImageData(24, 16, 10));
  const flatMap = createEdgeMapFromImageData(createUniformImageData(10, 10, 128));

  it.each([
    ['a zero search radius', 0, 10, 1],
    ['a negative search radius', -4, 10, 1],
    ['a zero snap strength', 5, 10, 0],
    ['a negative snap strength', 5, 10, -3],
  ])('does not snap for %s', (_label, radius, edgeContrast, snapStrength) => {
    const snap = findStrongestGradientPoint(edgeMap, { x: 12, y: 8 }, radius, edgeContrast, snapStrength);

    expect(snap).toEqual({ point: { x: 12, y: 8 }, confidence: 0, gradient: 0, usedMagnetic: false });
  });

  it('returns the clamped but unrounded cursor when snapping is disabled', () => {
    const snap = findStrongestGradientPoint(edgeMap, { x: 99, y: -3 }, 0, 10, 1);

    expect(snap.point).toEqual({ x: 23, y: 0 });
  });

  it('does not snap when the edge map has no gradient at all', () => {
    const snap = findStrongestGradientPoint(flatMap, { x: 5, y: 5 }, 3, 10, 1);

    expect(snap).toEqual({ point: { x: 5, y: 5 }, confidence: 0, gradient: 0, usedMagnetic: false });
  });

  it('lands exactly on the strongest gradient at full snap strength', () => {
    const snap = findStrongestGradientPoint(edgeMap, { x: 12, y: 8 }, 5, 10, 9);

    // A snap strength above 1 is clamped, so 9 behaves exactly like 1.
    expect(snap.point).toEqual({ x: 10, y: 8 });
    expect(snap.usedMagnetic).toBe(true);
    expect(snap.confidence).toBe(1);
    expect(snap.gradient).toBe(edgeMap.maxGradient);
  });

  it('interpolates towards the strongest gradient at a fractional snap strength', () => {
    const snap = findStrongestGradientPoint(edgeMap, { x: 12.4, y: 8.6 }, 5, 10, 0.5);

    // Half way from the clamped cursor (12.4, 8.6) to the winning pixel (10, 9).
    expect(snap.point.x).toBeCloseTo(11.2, 10);
    expect(snap.point.y).toBeCloseTo(8.8, 10);
    expect(snap.usedMagnetic).toBe(true);
  });

  it('refuses to snap when the best gradient in the radius is below the contrast threshold', () => {
    const twoSteps = createEdgeMapFromImageData(createTwoStepImageData());
    // The nearby 40-grey step measures 160 while the map maximum is 1020, so a
    // contrast of 100 (threshold 0.3 * 1020 = 306) rejects it.
    const snap = findStrongestGradientPoint(twoSteps, { x: 4, y: 5 }, 3, 100, 1);

    expect(snap).toEqual({ point: { x: 4, y: 5 }, confidence: 0, gradient: 160, usedMagnetic: false });
  });

  it.each([0, 5, 50])('snaps to the same weak edge at an edge contrast of %i', (edgeContrast) => {
    const twoSteps = createEdgeMapFromImageData(createTwoStepImageData());
    const snap = findStrongestGradientPoint(twoSteps, { x: 4, y: 5 }, 3, edgeContrast, 1);

    expect(snap.usedMagnetic).toBe(true);
    expect(snap.gradient).toBe(160);
    expect(snap.confidence).toBe(1);
  });

  it('snaps onto the strong edge of the same map at full contrast', () => {
    const twoSteps = createEdgeMapFromImageData(createTwoStepImageData());
    const snap = findStrongestGradientPoint(twoSteps, { x: 21, y: 5 }, 3, 100, 1);

    expect(snap).toEqual({ point: { x: 20, y: 5 }, confidence: 1, gradient: 1020, usedMagnetic: true });
  });

  it('searches only inside the edge map even when the radius would leave it', () => {
    const snap = findStrongestGradientPoint(edgeMap, { x: 23, y: 15 }, 50, 10, 1);

    expect(snap.point.x).toBeLessThanOrEqual(23);
    expect(snap.point.y).toBeLessThanOrEqual(15);
  });

  it.fails(
    'PROD src/util/magneticLasso.ts:215 reports a magnetic snap with zero gradient and zero confidence over a featureless neighbourhood at edgeContrast 0',
    () => {
      // The cursor sits in the flat half of the image, so every gradient in the search
      // radius is 0 and the contrast threshold is 0 too. `bestGradient < contrastThreshold`
      // compares 0 < 0, lets the snap through, and the result is
      // `{ point: { x: 20, y: 17 }, confidence: 0, gradient: 0, usedMagnetic: true }`:
      // an internally inconsistent "I snapped" that moved the cursor to an arbitrary
      // neighbouring pixel.
      expect(findStrongestGradientPoint(edgeMap, { x: 20, y: 20 }, 3, 0, 1).usedMagnetic).toBe(false);
    }
  );
});

describe('sampleLinePath', () => {
  it('samples the straight segment between the endpoints, inclusive', () => {
    expect(sampleLinePath({ x: 0, y: 0 }, { x: 3, y: 0 })).toEqual([
      { x: 0, y: 0 },
      { x: 1.5, y: 0 },
      { x: 3, y: 0 },
    ]);
  });

  it('emits two coincident points for a zero-length segment instead of one', () => {
    expect(sampleLinePath({ x: 3, y: 3 }, { x: 3, y: 3 })).toEqual([
      { x: 3, y: 3 },
      { x: 3, y: 3 },
    ]);
  });

  it('honours a custom maximum step', () => {
    expect(sampleLinePath({ x: 0, y: 0 }, { x: 25, y: 0 }, 10)).toHaveLength(4);
  });

  it('always emits at least two points, however coarse the step', () => {
    expect(sampleLinePath({ x: 0, y: 0 }, { x: 1, y: 1 }, 1000)).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ]);
  });
});

describe('pathLength', () => {
  it('is zero for a path with fewer than two points', () => {
    expect(pathLength([])).toBe(0);
    expect(pathLength([{ x: 4, y: 9 }])).toBe(0);
  });

  it('sums the euclidean length of every segment', () => {
    expect(
      pathLength([
        { x: 0, y: 0 },
        { x: 3, y: 4 },
        { x: 3, y: 14 },
      ])
    ).toBe(15);
  });

  it('is zero for a closed two-point path', () => {
    expect(
      pathLength([
        { x: 2, y: 2 },
        { x: 2, y: 2 },
      ])
    ).toBe(0);
  });
});

describe('findMagneticPath', () => {
  const options = { searchRadius: 5, edgeContrast: 10, snapStrength: 1 };

  it('falls back to a sampled straight line when the edge map has no gradient', () => {
    const flat = createEdgeMapFromImageData(createUniformImageData(12, 12, 7));
    const path = findMagneticPath(flat, { x: 1, y: 1 }, { x: 10, y: 10 }, options);

    expect(path).toHaveLength(8);
    expect(path[0]).toEqual({ x: 1, y: 1 });
    expect(path.at(-1)).toEqual({ x: 10, y: 10 });
  });

  it('falls back to a sampled straight line when the search window exceeds the area budget', () => {
    const edgeMap = createEdgeMapFromImageData(createVerticalEdgeImageData(40, 40, 20));
    const path = findMagneticPath(edgeMap, { x: 2, y: 2 }, { x: 38, y: 38 }, { ...options, maxArea: 4 });

    // The straight line is sampled every two pixels over a ~50.9 unit diagonal.
    expect(path).toHaveLength(27);
    expect(path[0]).toEqual({ x: 2, y: 2 });
  });

  it('routes along the gradient when the search window fits inside the area budget', () => {
    const edgeMap = createEdgeMapFromImageData(createVerticalEdgeImageData(40, 40, 20));
    const path = findMagneticPath(edgeMap, { x: 2, y: 2 }, { x: 38, y: 38 }, { ...options, maxArea: 100_000 });

    expect(path.length).toBeGreaterThan(2);
    expect(path[0]).toEqual({ x: 2, y: 2 });
    expect(path.at(-1)).toEqual({ x: 38, y: 38 });
  });

  it('clamps both endpoints into the edge map before searching', () => {
    const edgeMap = createEdgeMapFromImageData(createVerticalEdgeImageData(40, 40, 20));
    const path = findMagneticPath(edgeMap, { x: -50, y: -50 }, { x: 500, y: 500 }, { ...options, maxArea: 100_000 });

    expect(path[0]).toEqual({ x: 0, y: 0 });
    expect(path.at(-1)).toEqual({ x: 39, y: 39 });
  });

  it('searches successfully from the image corner', () => {
    const edgeMap = createEdgeMapFromImageData(createVerticalEdgeImageData(40, 40, 20));
    const path = findMagneticPath(edgeMap, { x: 0, y: 0 }, { x: 39, y: 39 }, { ...options, maxArea: 100_000 });

    expect(path.length).toBeGreaterThan(2);
    expect(path.at(-1)).toEqual({ x: 39, y: 39 });
  });

  it('returns a single point for a zero-length segment', () => {
    const edgeMap = createEdgeMapFromImageData(createVerticalEdgeImageData(12, 12, 6));
    const path = findMagneticPath(edgeMap, { x: 2, y: 2 }, { x: 2, y: 2 }, options);

    expect(path).toEqual([{ x: 2, y: 2 }]);
  });

  it('raises the search radius to its floor of four pixels', () => {
    const edgeMap = createEdgeMapFromImageData(createVerticalEdgeImageData(40, 40, 20));
    // A radius of 0 is clamped up to 4, so the search window is at least 9x9 and a
    // point four pixels away from the edge is still inside it.
    const path = findMagneticPath(edgeMap, { x: 2, y: 2 }, { x: 10, y: 2 }, { ...options, searchRadius: 0 });

    expect(path.length).toBeGreaterThan(2);
  });
});

describe('createMagneticSegment', () => {
  const edgeMap = createEdgeMapFromImageData(createVerticalEdgeImageData(24, 24, 10));
  const options = { searchRadius: 5, edgeContrast: 10, snapStrength: 1 };

  it('samples a straight line and reports an unused snap when there is no edge map', () => {
    const segment = createMagneticSegment({ cursor: { x: 16, y: 3 }, edgeMap: null, from: { x: 2, y: 3 }, options });

    expect(segment.snap).toEqual({ point: { x: 16, y: 3 }, confidence: 0, gradient: 0, usedMagnetic: false });
    expect(segment.snappedPoint).toEqual({ x: 16, y: 3 });
    expect(segment.path[0]).toEqual({ x: 2, y: 3 });
    expect(segment.path.at(-1)).toEqual({ x: 16, y: 3 });
    expect(segment.path).toEqual(sampleLinePath({ x: 2, y: 3 }, { x: 16, y: 3 }));
  });

  it('uses the raw cursor rather than the clamp when there is no edge map', () => {
    const segment = createMagneticSegment({ cursor: { x: 99, y: -4 }, edgeMap: null, from: { x: 0, y: 0 }, options });

    expect(segment.snappedPoint).toEqual({ x: 99, y: -4 });
  });

  it('ends the path at the snapped point rather than at the raw cursor', () => {
    const segment = createMagneticSegment({ cursor: { x: 12, y: 8 }, edgeMap, from: { x: 12, y: 2 }, options });

    expect(segment.snap.usedMagnetic).toBe(true);
    expect(segment.snappedPoint).toEqual(segment.snap.point);
    expect(segment.path.at(-1)).toEqual(segment.snap.point);
  });

  it('returns the same result with magneticEnabled false as with no edge map', () => {
    const disabled = createMagneticSegment({
      cursor: { x: 16, y: 3 },
      edgeMap,
      from: { x: 2, y: 3 },
      magneticEnabled: false,
      options,
    });
    const noMap = createMagneticSegment({ cursor: { x: 16, y: 3 }, edgeMap: null, from: { x: 2, y: 3 }, options });

    expect(disabled).toEqual(noMap);
  });

  it('samples a straight line to the cursor when the snap is rejected by the contrast threshold', () => {
    const twoSteps = createEdgeMapFromImageData(createTwoStepImageData());
    const segment = createMagneticSegment({
      cursor: { x: 4, y: 5 },
      edgeMap: twoSteps,
      from: { x: 0, y: 5 },
      options: { searchRadius: 3, edgeContrast: 100, snapStrength: 1 },
    });

    expect(segment.snap.usedMagnetic).toBe(false);
    expect(segment.path).toEqual(sampleLinePath({ x: 0, y: 5 }, { x: 4, y: 5 }));
  });
});

describe('simplifyPath', () => {
  it.each([
    ['no points', []],
    ['a single point', [{ x: 4, y: 4 }]],
  ])('returns %s unchanged', (_label, points) => {
    expect(simplifyPath(points, 1)).toEqual(points);
  });

  it.each([
    [
      'exactly two points',
      [
        { x: 0, y: 0 },
        { x: 9, y: 9 },
      ],
    ],
    [
      'two points with a large tolerance',
      [
        { x: 0, y: 0 },
        { x: 9, y: 9 },
      ],
    ],
  ])('short-circuits for %s', (_label, points) => {
    expect(simplifyPath(points, 100)).toEqual(points);
  });

  it.each([
    ['a zero tolerance', 0],
    ['a negative tolerance', -2],
  ])('returns every point at %s', (_label, tolerance) => {
    const points = [
      { x: 0, y: 0 },
      { x: 1, y: 5 },
      { x: 9, y: 9 },
    ];

    expect(simplifyPath(points, tolerance)).toEqual(points);
  });

  it('collapses sequential points that round to the same pixel', () => {
    // Both intermediate points round to (0, 0), so they are treated as one vertex
    // before the tolerance pass ever runs.
    expect(
      simplifyPath(
        [
          { x: 0, y: 0 },
          { x: 0.2, y: 0.3 },
          { x: 0.4, y: 0.1 },
          { x: 10, y: 0 },
        ],
        0.5
      )
    ).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ]);
  });

  it('keeps a closed path closed and drops the collinear interior point', () => {
    // The first and last points coincide, so the initial segment is degenerate and
    // every interior distance is measured from that single shared vertex.
    const simplified = simplifyPath(
      [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 10, y: 0 },
        { x: 0, y: 0 },
      ],
      2
    );

    expect(simplified).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 0, y: 0 },
    ]);
  });

  it('keeps both endpoints of an open path no matter how coarse the tolerance is', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 4, y: 40 },
      { x: 8, y: 0 },
      { x: 12, y: 40 },
    ];

    for (const tolerance of [1, 10, 1000]) {
      const simplified = simplifyPath(points, tolerance);

      expect(simplified[0]).toEqual({ x: 0, y: 0 });
      expect(simplified.at(-1)).toEqual({ x: 12, y: 40 });
    }
  });

  it('never returns an interior point that lies on the retained chord', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 1, y: 0.2 },
      { x: 2, y: 0 },
      { x: 3, y: 0.2 },
      { x: 4, y: 0 },
    ];

    expect(simplifyPath(points, 0.5)).toEqual([
      { x: 0, y: 0 },
      { x: 4, y: 0 },
    ]);
  });
});
