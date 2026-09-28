import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { eraser, type EraserToolArgs } from '../eraser.ts';
import { defaultSettings } from '../settings.ts';
import { toolProcessors } from '../toolProcessors.ts';
import { brushDabCenters, tipAlphaAt, type BrushTipSettings } from '../../util/brush-engine.ts';
import { clampBrushTipSettings } from '../../util/brush-engine.ts';
import { forEachPixelInSize, pixelIndex, writeRgba, type Rgba } from '../../util/pixels.ts';
import { createMockImageBitmap } from '../../__tests__/fixtures/canvas.ts';
import { makeMockImageData } from '../../__tests__/canvas-mock.ts';
import { createPixelCanvasContext } from '../../test/setup.ts';
import type { Point, Size } from '../../contexts/general-types.ts';

const OPAQUE_RED: Rgba = { r: 255, g: 0, b: 0, a: 255 };
const TRANSPARENT: Rgba = { r: 0, g: 0, b: 0, a: 0 };

/**
 * `OffscreenCanvas` is constructed with `new` in production, so the global stub has to
 * be a real class — a `vi.fn()` implementation is not constructible.
 *
 * It is pixel-capable on purpose. `src/test/setup.ts:184-190` documents that the
 * globally installed context deliberately has NO `getImageData`/`putImageData`,
 * because production code guards on their absence to detect a reduced canvas
 * environment, and adding read-back there would silently flip every rasterization
 * test onto the other branch. The Eraser resolves that guard, so its read-back arm
 * needs a context that HAS it: `createPixelCanvasContext` is the sanctioned opt-in
 * (`createMockCanvasContext` alone is not enough).
 */
class RecordingOffscreenCanvas {
  static instances: RecordingOffscreenCanvas[] = [];
  /** `false` selects the reduced context, which has no read-back at all. */
  static readBack = true;
  /** Flipped per test by the `it.each` over `stroke outside the canvas` cases. */
  static seed: (data: Uint8ClampedArray, size: Size) => void = fillOpaqueRed;

  width: number;
  height: number;
  readonly ctx: CanvasRenderingContext2D;
  /** The raster the fake `getImageData` hands back, mutated in place by the erase. */
  readonly image: ImageData;
  readonly data: Uint8ClampedArray;
  putImageDataCalls = 0;

  constructor(width: number, height: number) {
    this.width = Math.max(1, Math.ceil(width));
    this.height = Math.max(1, Math.ceil(height));
    this.image = makeMockImageData(this.width, this.height);
    this.data = this.image.data;

    const extent: Size = { width: this.width, height: this.height };
    RecordingOffscreenCanvas.seed(this.data, extent);

    this.ctx = createPixelCanvasContext(this);
    RecordingOffscreenCanvas.instances.push(this);

    if (RecordingOffscreenCanvas.readBack) {
      vi.mocked(this.ctx.getImageData).mockReturnValue(this.image);
      vi.mocked(this.ctx.putImageData).mockImplementation(() => {
        this.putImageDataCalls += 1;
      });
      return;
    }

    // The reduced environment: a context with neither read-back method, so the
    // processor has to take its `destination-out` composite arm instead. Built by
    // DELETING the two methods rather than by reaching for a different mock, so the
    // two arms differ in exactly the one capability under test.
    delete (this.ctx as unknown as Record<string, unknown>).getImageData;
    delete (this.ctx as unknown as Record<string, unknown>).putImageData;
  }

  getContext(): CanvasRenderingContext2D {
    return this.ctx;
  }
}

/** An opaque red raster: erasing it is visible as a drop in alpha, nothing else. */
function fillOpaqueRed(data: Uint8ClampedArray, size: Size): void {
  forEachPixelInSize(size, (x, y) => writeRgba(data, x, y, size.width, OPAQUE_RED));
}

const alphaAt = (data: Uint8ClampedArray, size: Size, x: number, y: number): number =>
  data[pixelIndex(x, y, size.width) + 3];

const pixelAt = (data: Uint8ClampedArray, size: Size, x: number, y: number): Rgba => ({
  r: data[pixelIndex(x, y, size.width)],
  g: data[pixelIndex(x, y, size.width) + 1],
  b: data[pixelIndex(x, y, size.width) + 2],
  a: data[pixelIndex(x, y, size.width) + 3],
});

/** Every alpha in the raster, row-major — for whole-buffer shape claims. */
const allAlphas = (data: Uint8ClampedArray, size: Size): number[] =>
  Array.from({ length: size.width * size.height }, (_, index) => data[index * 4 + 3]);

const countErased = (data: Uint8ClampedArray, size: Size): number =>
  allAlphas(data, size).filter((alpha) => alpha === 0).length;

type EraserRun = {
  canvas: RecordingOffscreenCanvas;
  data: Uint8ClampedArray;
  size: Size;
  bitmap: ImageBitmap;
};

/**
 * Run the registered Eraser and hand back the canvas it allocated.
 *
 * The recorder's canvas is compared by IDENTITY against the last instance it built,
 * not for truthiness: a processor that returned the source bitmap, or a
 * differently-sized canvas, is also truthy, and the eraser specifically has to be
 * checked for the one it just drew into.
 */
const runEraser = (size: Size, overrides: Partial<EraserToolArgs> = {}): EraserRun => {
  const bitmap = createMockImageBitmap(size.width, size.height);
  const result = eraser({ size, bitmap })({
    ...defaultSettings.eraser,
    ...overrides,
    toolName: 'eraser',
  });

  expect(result).toHaveLength(1);

  const canvas = RecordingOffscreenCanvas.instances.at(-1)!;
  expect(result[0]).toBe(canvas as unknown as OffscreenCanvas);
  expect(canvas).toBe(RecordingOffscreenCanvas.instances.at(-1));

  return { canvas, data: canvas.data, size: { width: canvas.width, height: canvas.height }, bitmap };
};

/** `clampBrushTipSettings` applied to the four args the eraser forwards, for expectations. */
const tipOf = (overrides: Partial<EraserToolArgs> = {}): BrushTipSettings =>
  clampBrushTipSettings({
    size: overrides.size ?? defaultSettings.eraser.size,
    hardness: overrides.hardness ?? defaultSettings.eraser.hardness,
    opacity: overrides.alpha ?? defaultSettings.eraser.alpha,
    spacing: overrides.spacing ?? defaultSettings.eraser.spacing,
  });

const click = (x: number, y: number): Point[] => [{ x, y }];

beforeEach(() => {
  RecordingOffscreenCanvas.instances = [];
  RecordingOffscreenCanvas.readBack = true;
  RecordingOffscreenCanvas.seed = fillOpaqueRed;
  vi.stubGlobal('OffscreenCanvas', RecordingOffscreenCanvas as unknown as typeof OffscreenCanvas);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('eraser processor identity and shape', () => {
  it('is the same function reference the registry registered', () => {
    // `tool-processors.test.ts:493` already pins this for the whole roster; this is
    // the eraser asserting it about itself, because a wrapper here would be a copy
    // that carries the same commit kind and so is invisible to every other pin.
    expect(toolProcessors.eraser.imageProcessor).toBe(eraser);
  });

  it('returns a freshly allocated full-document-size canvas, never the source bitmap', () => {
    const size: Size = { width: 21, height: 13 };
    const { canvas, bitmap } = runEraser(size, { points: click(10, 6) });

    expect(canvas.width).toBe(21);
    expect(canvas.height).toBe(13);
    expect(RecordingOffscreenCanvas.instances).toHaveLength(1);
    expect(canvas.ctx.drawImage).toHaveBeenCalledWith(bitmap, 0, 0);
  });

  it('does not mutate the args it is handed', () => {
    const points: Point[] = [
      { x: 2, y: 2 },
      { x: 8, y: 2 },
    ];
    const args: EraserToolArgs = { ...defaultSettings.eraser, points };

    runEraser({ width: 13, height: 13 }, args);

    expect(args.points).toEqual(points);
  });
});

describe('eraser removes pixels to transparency', () => {
  const size: Size = { width: 13, height: 13 };

  it('turns an opaque pixel under the tip fully transparent', () => {
    const { data } = runEraser(size, {
      size: 12,
      hardness: 100,
      alpha: 1,
      points: click(6, 6),
    });

    // The centre is at full coverage, so `255 * (1 - 1)` is 0 — and at alpha 0 there
    // is no colour left to recover, so the pixel is transparent BLACK rather than an
    // opaque red pinned at zero alpha.
    expect(pixelAt(data, size, 6, 6)).toEqual(TRANSPARENT);
    expect(alphaAt(data, size, 6, 6)).toBe(0);
  });

  it('leaves the neighbourhood outside a hard tip at full alpha', () => {
    const { data } = runEraser(size, { size: 12, hardness: 100, alpha: 1, points: click(6, 6) });

    // Hardness 100 is a flat plateau out to the radius, so the disc is exactly the
    // integer lattice points within 6px of (6, 6): 109 of them. 109 is derived, not
    // guessed - dx = 0 contributes 11 rows, |dx| = 1..3 contribute 11 each, |dx| = 4
    // contributes 9 and |dx| = 5 contributes 7.
    expect(countErased(data, size)).toBe(109);

    // Just inside the rim and just outside it, one pixel apart, is the whole
    // distinction between the tip reaching and not reaching.
    expect(alphaAt(data, size, 2, 2)).toBe(0);
    expect(alphaAt(data, size, 1, 1)).toBe(255);
    // The rim itself is OUTSIDE the tip, at every hardness: the tip is a half-open
    // disc, so a pixel at exactly `radius` is not covered.
    expect(alphaAt(data, size, 0, 6)).toBe(255);
    expect(alphaAt(data, size, 6, 0)).toBe(255);
    expect(alphaAt(data, size, 6, 5)).toBe(0);
  });

  it('leaves a hard tip as a step, with no intermediate alpha anywhere', () => {
    const { data } = runEraser(size, { size: 12, hardness: 100, alpha: 1, points: click(6, 6) });

    // The whole raster, not a sample of it. A hard eraser has exactly two states —
    // erased or untouched — so a single intermediate value is the fringe this tool
    // exists to avoid, and a count of two distinct alphas is the pin that catches it.
    const distinct = [...new Set(allAlphas(data, size))].sort((a, b) => a - b);
    expect(distinct).toEqual([0, 255]);

    // The row out from the centre is one flat plateau and then nothing.
    const row = Array.from({ length: 13 }, (_, x) => alphaAt(data, size, x, 6));
    expect(row).toEqual([255, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 255]);
  });

  it('gives a soft tip a monotonic gradient of residual alpha across the rim', () => {
    const { data } = runEraser(size, { size: 12, hardness: 0, alpha: 1, points: click(6, 6) });

    // Hardness 0 has no hard core, so the whole radius is falloff and this column is
    // the curve. These are the exact values the paint engine produces for the SAME
    // dab (see `src/util/__tests__/brush-engine.test.ts:556-566`): the eraser is the
    // same tip with the inverse coverage, so the residuals are the complements.
    const column = [0, 1, 2, 3, 4, 5, 6].map((distance) => alphaAt(data, size, 6, 6 - distance));
    expect(column).toEqual([0, 17, 64, 128, 191, 238, 255]);

    // Strictly increasing away from the centre: a hard fringe or a ring at the core
    // boundary would break the monotonicity even where the exact values happened to
    // land close.
    for (let index = 1; index < column.length; index++) {
      expect(column[index], `distance ${index}`).toBeGreaterThan(column[index - 1]);
    }

    // The residual keeps the ORIGINAL colour. `destination-out` in straight alpha
    // scales alpha alone — the premultiplied colour loses the factor on the way out
    // and unpremultiplying cancels it — so a dark halo here would mean the RGB was
    // scaled as well.
    expect(pixelAt(data, size, 6, 3)).toEqual({ r: 255, g: 0, b: 0, a: 128 });
    expect(pixelAt(data, size, 6, 5)).toEqual({ r: 255, g: 0, b: 0, a: 17 });
    expect(pixelAt(data, size, 6, 1)).toEqual({ r: 255, g: 0, b: 0, a: 238 });
  });
});

describe('eraser stroke geometry', () => {
  it('erases exactly one dab for a single-point stroke', () => {
    const size: Size = { width: 13, height: 13 };
    const { data } = runEraser(size, { size: 8, hardness: 100, alpha: 1, spacing: 25, points: click(6, 6) });

    // A radius-4 disc centred on (6, 6) is the 45 lattice points within 4px of it. A
    // `ctx.stroke()` over a zero-length path would have drawn NOTHING here, which is
    // the entire reason the stroke is a stamped tip rather than a path.
    expect(brushDabCenters(click(6, 6), 8, 25)).toHaveLength(1);
    expect(countErased(data, size)).toBe(45);
    expect(alphaAt(data, size, 6, 6)).toBe(0);
    expect(alphaAt(data, size, 6, 3)).toBe(0);
    expect(alphaAt(data, size, 6, 2)).toBe(255);
  });

  it('erases dabs ALONG the segment, not only at the two endpoints', () => {
    const size: Size = { width: 21, height: 21 };
    const endpoints: Point[] = [
      { x: 2, y: 10 },
      { x: 18, y: 10 },
    ];

    // 16px of travel at 25% of an 8px tip is a 2px step, so the dabs land on every
    // even x from 2 to 18 — interior centres the two endpoints cannot explain.
    const centers = brushDabCenters(endpoints, 8, 25);
    expect(centers.map((center) => center.x)).toEqual([2, 4, 6, 8, 10, 12, 14, 16, 18]);
    expect(centers).toHaveLength(9);

    const { data } = runEraser(size, { size: 8, hardness: 100, alpha: 1, spacing: 25, points: endpoints });

    // Every x within 2 of an even centre, and |dy| <= 3 satisfies dx^2 + dy^2 < 16 for
    // all of them, so rows 7..13 are erased edge to edge with no gap: 21 * 7.
    expect(countErased(data, size)).toBe(147);
    for (let x = 0; x < 21; x++) {
      expect(alphaAt(data, size, x, 10), `x ${x} on the centre line`).toBe(0);
    }
    // |dy| = 4 puts the pixel at 16px of squared distance or more, so the rows either
    // side of the band are untouched even mid-span.
    expect(alphaAt(data, size, 10, 6)).toBe(255);
    expect(alphaAt(data, size, 10, 14)).toBe(255);

    // The discriminator: (10, 7) is 3px from the INTERIOR dab at (10, 10) but 8.5px
    // from both endpoints, so an eraser that only stamped the two endpoints would
    // leave it opaque.
    expect(Math.hypot(10 - 2, 7 - 10)).toBeGreaterThan(4);
    expect(Math.hypot(10 - 18, 7 - 10)).toBeGreaterThan(4);
    expect(alphaAt(data, size, 10, 7)).toBe(0);
  });

  it('builds less coverage at a looser spacing, because dabs multiply rather than clamp', () => {
    const size: Size = { width: 25, height: 9 };
    const stroke: Point[] = [
      { x: 4, y: 4 },
      { x: 20, y: 4 },
    ];

    const loose = runEraser(size, { size: 8, hardness: 100, alpha: 0.5, spacing: 75, points: stroke });
    const tight = runEraser(size, { size: 8, hardness: 100, alpha: 0.5, spacing: 25, points: stroke });

    // One 0.5 coverage per dab, compounding as `a * (1 - 0.5)`, so a pixel that took
    // n dabs lands at 255 * 0.5^n. At 75% spacing the dabs are 6px apart and (7, 4)
    // takes 2; at 25% they are 2px apart and it takes 4 — 64 against 16.
    expect(alphaAt(tight.data, tight.size, 7, 4)).toBe(16);
    expect(alphaAt(loose.data, loose.size, 7, 4)).toBe(64);
    expect(alphaAt(loose.data, loose.size, 7, 4)).toBeGreaterThan(alphaAt(tight.data, tight.size, 7, 4));
  });
});

describe('eraser no-op arms', () => {
  const size: Size = { width: 13, height: 13 };

  it('leaves the raster untouched for an absent or empty point list', () => {
    const absent = runEraser(size, { size: 12, hardness: 100, alpha: 1 });
    const empty = runEraser(size, { size: 12, hardness: 100, alpha: 1, points: [] });

    expect(countErased(absent.data, absent.size)).toBe(0);
    expect(countErased(empty.data, empty.size)).toBe(0);
    // Stronger than "the pixels are unchanged": the buffer was never even read, so
    // there is no code path on which a later edit could have written through it.
    expect(absent.canvas.putImageDataCalls).toBe(0);
    expect(empty.canvas.putImageDataCalls).toBe(0);
    expect(pixelAt(absent.data, absent.size, 6, 6)).toEqual(OPAQUE_RED);
  });

  it('is a no-op that does not throw for a stroke entirely off the canvas', () => {
    for (const points of [
      click(100, 100),
      click(-50, -50),
      click(100, 6),
      click(6, 100),
      [
        { x: 0, y: 0 },
        { x: 200, y: 200 },
      ],
    ]) {
      expect(() => runEraser(size, { size: 12, hardness: 100, alpha: 1, points })).not.toThrow();
    }

    // Re-run one of them and read the raster, rather than only proving no throw.
    const { data } = runEraser(size, { size: 12, hardness: 100, alpha: 1, points: click(100, 100) });
    expect(countErased(data, size)).toBe(0);
    for (let index = 0; index < data.length; index += 4) {
      expect(data[index + 3]).toBe(255);
    }
  });

  it('erases nothing at Opacity 0, and leaves the source on the canvas', () => {
    const { data, canvas } = runEraser(size, { size: 12, hardness: 100, alpha: 0, points: click(6, 6) });

    expect(countErased(data, size)).toBe(0);
    expect(pixelAt(data, size, 6, 6)).toEqual(OPAQUE_RED);
    // Still a fresh full-size canvas with the source drawn in, which is what the
    // layer's `tmpCanvas` contract needs even for a no-op stroke.
    expect(canvas.width).toBe(13);
    expect(canvas.ctx.drawImage).toHaveBeenCalled();
  });
});

describe('eraser Opacity scales the erase', () => {
  const size: Size = { width: 13, height: 13 };

  it('rescales every covered pixel by Opacity rather than only the core', () => {
    // 255 * (1 - opacity) for an opaque pixel at full tip coverage.
    const expected: readonly [number, number][] = [
      [0, 255],
      [0.25, 191],
      [0.5, 128],
      [0.75, 64],
      [1, 0],
    ];

    for (const [opacity, alpha] of expected) {
      const { data } = runEraser(size, { size: 8, hardness: 100, alpha: opacity, points: click(6, 6) });

      expect(alphaAt(data, size, 6, 6), `opacity ${opacity}`).toBe(alpha);
    }
  });

  it('keeps the colour under a partial erase and clears it only at zero alpha', () => {
    const partial = runEraser(size, { size: 8, hardness: 100, alpha: 0.5, points: click(6, 6) });
    const full = runEraser(size, { size: 8, hardness: 100, alpha: 1, points: click(6, 6) });

    expect(pixelAt(partial.data, partial.size, 6, 6)).toEqual({ r: 255, g: 0, b: 0, a: 128 });
    expect(pixelAt(full.data, full.size, 6, 6)).toEqual(TRANSPARENT);
  });
});

describe('eraser clamps its tip settings through the shared engine', () => {
  const size: Size = { width: 13, height: 13 };

  it('clamps a negative size and hardness to a 1px fully soft tip instead of throwing', () => {
    const { data } = runEraser(size, { size: -40, hardness: -10, alpha: 1, points: click(6, 6) });

    // `clampBrushTipSettings` sends `size` to BRUSH_SIZE_MIN (1) and `hardness` to 0,
    // so the radius is 0.5 and the half-open disc reaches the centre pixel only.
    expect(tipOf({ size: -40, hardness: -10 })).toMatchObject({ size: 1, hardness: 0 });
    expect(countErased(data, size)).toBe(1);
    expect(pixelAt(data, size, 6, 6)).toEqual(TRANSPARENT);
    expect(alphaAt(data, size, 6, 5)).toBe(255);
  });

  it('renders a NaN size or hardness exactly as the Photoshop default would', () => {
    // The engine's non-finite rule is the DEFAULT, not a range end: a NaN radius makes
    // every bounding-box bound NaN, which is a loop that silently stamps nothing and
    // looks like a broken tool rather than a thrown one.
    const fromNaN = runEraser(size, {
      size: Number.NaN,
      hardness: Number.NaN,
      alpha: Number.NaN,
      spacing: Number.NaN,
      points: click(6, 6),
    });
    const fromDefaults = runEraser(size, {
      size: 13,
      hardness: 100,
      alpha: 1,
      spacing: 25,
      points: click(6, 6),
    });

    expect(tipOf({ size: Number.NaN, hardness: Number.NaN, alpha: Number.NaN, spacing: Number.NaN })).toEqual({
      size: 13,
      hardness: 100,
      opacity: 1,
      spacing: 25,
    });
    expect(Array.from(fromNaN.data)).toEqual(Array.from(fromDefaults.data));
    // The 13px default tip is a 6.5px radius, so the disc is the 137 lattice points
    // within 6.5px of (6, 6) — distinct from the 109 a 12px tip covers, which is what
    // makes the byte-equality above a real comparison rather than two empty rasters.
    expect(countErased(fromNaN.data, size)).toBe(137);
  });

  it.each([
    ['an infinite size', { size: Number.POSITIVE_INFINITY }],
    ['an over-maximum size', { size: 900 }],
    ['an over-maximum hardness', { hardness: 400 }],
  ])('survives %s rather than throwing', (_label, overrides) => {
    expect(() => runEraser(size, { alpha: 1, points: click(6, 6), ...overrides })).not.toThrow();
  });

  it('clamps a 900px tip to the 500px maximum, which swallows a 13px raster whole', () => {
    const { data } = runEraser(size, { size: 900, hardness: 100, alpha: 1, points: click(6, 6) });

    expect(tipOf({ size: 900 }).size).toBe(500);
    expect(countErased(data, size)).toBe(13 * 13);
  });

  it('treats an out-of-range hardness as the hardness it clamps to', () => {
    const soft = runEraser(size, { size: 12, hardness: -40, alpha: 1, points: click(6, 6) });
    const zero = runEraser(size, { size: 12, hardness: 0, alpha: 1, points: click(6, 6) });
    const hard = runEraser(size, { size: 12, hardness: 400, alpha: 1, points: click(6, 6) });
    const hundred = runEraser(size, { size: 12, hardness: 100, alpha: 1, points: click(6, 6) });

    expect(Array.from(soft.data)).toEqual(Array.from(zero.data));
    expect(Array.from(hard.data)).toEqual(Array.from(hundred.data));
    // Same column, opposite ends of it: at 5px from the centre a hard tip has already
    // reached full erasure while a soft one still leaves a gradient, and the pixel
    // exactly ON the rim is outside the tip at both hardnesses.
    expect(alphaAt(soft.data, soft.size, 6, 1)).toBe(238);
    expect(alphaAt(hard.data, hard.size, 6, 1)).toBe(0);
    expect(alphaAt(soft.data, soft.size, 6, 0)).toBe(255);
    expect(alphaAt(hard.data, hard.size, 6, 0)).toBe(255);
  });
});

/**
 * The reduced 2D context: no `getImageData`, no `putImageData`, so the coverage cannot
 * be computed against real pixels. This is the environment `src/test/setup.ts:184-190`
 * installs globally, and the arm the eraser has to take there without throwing.
 */
describe('eraser on a context with no read-back', () => {
  const size: Size = { width: 13, height: 13 };

  beforeEach(() => {
    RecordingOffscreenCanvas.readBack = false;
  });

  it('composites the source and erases with destination-out, one gradient per dab', () => {
    const points: Point[] = [
      { x: 3, y: 6 },
      { x: 9, y: 6 },
    ];
    const overrides = { size: 8, hardness: 0, alpha: 1, spacing: 25, points };
    const { canvas, bitmap } = runEraser(size, overrides);

    expect(canvas.ctx.drawImage).toHaveBeenCalledWith(bitmap, 0, 0);
    expect(canvas.ctx.save).toHaveBeenCalled();
    expect(canvas.ctx.restore).toHaveBeenCalled();
    expect(canvas.ctx.globalCompositeOperation).toBe('destination-out');
    // 6px of travel at a 2px step is 4 centres (2 + 3 interior), and the composite
    // mints one gradient per dab — the same dab list the buffer arm stamps.
    expect(brushDabCenters(points, 8, 25)).toHaveLength(4);
    expect(canvas.ctx.createRadialGradient).toHaveBeenCalledTimes(4);
    expect(canvas.ctx.fill).toHaveBeenCalledTimes(4);
  });

  it('samples the gradient stops off tipAlphaAt rather than picking two of them', () => {
    // A two-stop gradient is a linear ramp, and a linear ramp kinks at the hard core.
    // That kink is the ring the cosine-squared curve exists to remove, so the stop
    // count and the middle value are the pins, not just the endpoints.
    const { canvas } = runEraser(size, { size: 12, hardness: 0, alpha: 1, points: click(6, 6) });
    const gradient = vi.mocked(canvas.ctx.createRadialGradient).mock.results[0].value;
    const stops = vi.mocked(gradient.addColorStop).mock.calls as unknown as [number, string][];

    const radius = 12 / 2;
    expect(vi.mocked(canvas.ctx.createRadialGradient).mock.calls[0].slice(2)).toEqual([0, 6, 6, radius]);
    expect(stops.length).toBeGreaterThan(2);

    for (const [offset, colour] of stops) {
      const alpha = Number(/,\s*([\d.e-]+)\)$/.exec(colour)?.[1]);
      expect(alpha, `stop ${offset}`).toBeCloseTo(tipAlphaAt(offset * radius, radius, 0), 10);
    }
    expect(stops.at(0)?.[1]).toBe('rgba(0, 0, 0, 1)');
    expect(stops.at(-1)?.[1]).toBe('rgba(0, 0, 0, 0)');
  });

  it('skips a dab whose tip misses the raster entirely', () => {
    const { canvas } = runEraser(size, {
      size: 12,
      hardness: 100,
      alpha: 1,
      points: click(100, 100),
    });

    expect(canvas.ctx.createRadialGradient).not.toHaveBeenCalled();
    expect(canvas.ctx.fill).not.toHaveBeenCalled();
    // The source is still there: a no-op stroke must not blank the layer.
    expect(canvas.ctx.drawImage).toHaveBeenCalled();
  });
});
