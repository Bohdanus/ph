import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { burn, dodge, tonalAmount, tonalWeight, type DodgeBurnToolArgs, type TonalRange } from '../dodgeBurn.ts';
import { createMockImageBitmap } from '../../__tests__/fixtures/canvas.ts';
import { createPixelCanvasContext } from '../../test/setup.ts';
import type { BitmapSource, Point, Size } from '../../contexts/general-types.ts';
import type { Rgba } from '../../util/pixels.ts';

type PixelContext = ReturnType<typeof createPixelCanvasContext> & {
  getImageData: ReturnType<typeof vi.fn>;
  putImageData: ReturnType<typeof vi.fn>;
  drawImage: ReturnType<typeof vi.fn>;
};

/**
 * The processors allocate one canvas, draw the source bitmap into it, and read it back,
 * so the global `OffscreenCanvas` stub in `src/test/setup.ts` is not enough: its context
 * has no `getImageData` at all (`src/test/setup.ts:185` says so on purpose), so a real
 * tool would take its own no-read-back arm and paint nothing.
 *
 * This recorder therefore keeps a REAL `Uint8ClampedArray` behind
 * `getImageData`/`putImageData`, and `drawImage` copies a sibling recorder's buffer — the
 * one behaviour the mock omits that these tools actually depend on, and the reason a
 * second stroke can be run over the first stroke's output.
 */
class RecordingOffscreenCanvas {
  static instances: RecordingOffscreenCanvas[] = [];

  /**
   * Applied to each new instance the moment it is constructed, i.e. before the
   * processor that allocated it runs a single line. It stands in for the pixels
   * `drawImage` transfers from the source, so seeding here rather than afterwards is
   * what makes the test read the same bytes the tool read.
   */
  static seed: ((canvas: RecordingOffscreenCanvas) => void) | null = null;

  width: number;
  height: number;
  readonly buffer: Uint8ClampedArray;
  readonly ctx: PixelContext;

  constructor(width: number, height: number) {
    this.width = Math.max(1, Math.ceil(width));
    this.height = Math.max(1, Math.ceil(height));
    this.buffer = new Uint8ClampedArray(this.width * this.height * 4);
    this.ctx = {
      ...createPixelCanvasContext({ width: this.width, height: this.height }),
      getImageData: vi.fn(() => ({
        data: this.buffer,
        width: this.width,
        height: this.height,
        colorSpace: 'srgb',
      })),
      putImageData: vi.fn((imageData: { data: Uint8ClampedArray }) => {
        this.buffer.set(imageData.data);
      }),
      drawImage: vi.fn((source: unknown) => {
        const from = source as RecordingOffscreenCanvas;
        if (from instanceof RecordingOffscreenCanvas && from.buffer.length === this.buffer.length) {
          this.buffer.set(from.buffer);
        }
      }),
    } as unknown as PixelContext;

    RecordingOffscreenCanvas.seed?.(this);
    RecordingOffscreenCanvas.instances.push(this);
  }

  getContext(): PixelContext {
    return this.ctx;
  }
}

type Seed = (canvas: RecordingOffscreenCanvas) => void;

beforeEach(() => {
  RecordingOffscreenCanvas.instances = [];
  RecordingOffscreenCanvas.seed = null;
  vi.stubGlobal('OffscreenCanvas', RecordingOffscreenCanvas as unknown as typeof OffscreenCanvas);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const document: Size = { width: 8, height: 8 };

/** A 1px tip, hard-edged: the only geometry whose footprint is derivable by hand. */
const args = (overrides: Partial<DodgeBurnToolArgs> = {}): DodgeBurnToolArgs => ({
  exposure: 100,
  range: 'midtones',
  size: 1,
  hardness: 100,
  points: [],
  toolName: 'dodge',
  ...overrides,
});

const seedPixel = (canvas: RecordingOffscreenCanvas, x: number, y: number, rgba: Rgba): void => {
  const offset = (y * canvas.width + x) * 4;
  canvas.buffer[offset] = rgba.r;
  canvas.buffer[offset + 1] = rgba.g;
  canvas.buffer[offset + 2] = rgba.b;
  canvas.buffer[offset + 3] = rgba.a;
};

const seedFill = (canvas: RecordingOffscreenCanvas, rgba: Rgba): void => {
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) seedPixel(canvas, x, y, rgba);
  }
};

const seedLuma =
  (luma: number): Seed =>
  (canvas) =>
    seedFill(canvas, { r: luma, g: luma, b: luma, a: 255 });

const channelAt = (canvas: RecordingOffscreenCanvas, x: number, y: number): number =>
  canvas.buffer[(y * canvas.width + x) * 4];

const pixelAt = (canvas: RecordingOffscreenCanvas, x: number, y: number): number[] =>
  Array.from(canvas.buffer.slice((y * canvas.width + x) * 4, (y * canvas.width + x) * 4 + 4));

const snapshot = (canvas: RecordingOffscreenCanvas): Uint8ClampedArray => Uint8ClampedArray.from(canvas.buffer);

/** `"x,y"` for every pixel whose bytes differ from `before`, in raster order. */
const changedPixels = (canvas: RecordingOffscreenCanvas, before: Uint8ClampedArray): string[] => {
  const changed: string[] = [];
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const offset = (y * canvas.width + x) * 4;
      const differs = [0, 1, 2, 3].some((channel) => canvas.buffer[offset + channel] !== before[offset + channel]);
      if (differs) changed.push(`${x},${y}`);
    }
  }
  return changed;
};

/**
 * Run a processor and return the canvas it produced, structurally: the returned value
 * must be the full-`size` canvas it just allocated, not merely something truthy.
 *
 * `source` defaults to a mock bitmap, whose `drawImage` transfers nothing, so `seed`
 * alone determines the source pixels. Passing a previous canvas as `source` is how a
 * second stroke is run over the first stroke's output.
 */
const render = (
  processor: typeof dodge,
  size: Size,
  toolArgs: DodgeBurnToolArgs,
  seed: Seed = seedLuma(128),
  source?: BitmapSource
): RecordingOffscreenCanvas => {
  RecordingOffscreenCanvas.seed = seed;
  try {
    const [result] = processor({ size, bitmap: source ?? createMockImageBitmap(size.width, size.height) })(toolArgs);
    const canvas = RecordingOffscreenCanvas.instances.at(-1)!;

    expect(result).toBe(canvas as unknown as OffscreenCanvas);
    expect(canvas.width).toBe(size.width);
    expect(canvas.height).toBe(size.height);
    return canvas;
  } finally {
    RecordingOffscreenCanvas.seed = null;
  }
};

/**
 * The seed as it sits in a buffer, for the "nothing changed" comparison.
 *
 * A stroke with no points emits no dab, so the processor returns the drawn source
 * untouched — which is exactly the baseline every "X is bit-identical" assertion needs
 * and does not need a second hand-written copy of the seed for.
 */
const untouched = (size: Size, seed: Seed): Uint8ClampedArray =>
  snapshot(render(dodge, size, args({ points: [] }), seed));

const point = (x: number, y: number): Point => ({ x, y });

/**
 * A previous render's canvas stands in for the layer's bitmap on a second stroke, which
 * is exactly what the registry passes: the layer's own canvas back in, transformed.
 */
const asSource = (canvas: RecordingOffscreenCanvas): BitmapSource => canvas as unknown as BitmapSource;

/** The luma ramp every band assertion reads: 0, 64, 128, 192, 255 across row 4. */
const seedRamp: Seed = (canvas) => {
  seedFill(canvas, { r: 0, g: 0, b: 0, a: 255 });
  [0, 64, 128, 192, 255].forEach((luma, x) => seedPixel(canvas, x, 4, { r: luma, g: luma, b: luma, a: 255 }));
};

/** A 256-wide ramp, `luma(x) = x`, covered by one tip centred on the canvas. */
const rampSize: Size = { width: 256, height: 256 };

const seedFullRamp: Seed = (canvas) => {
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) seedPixel(canvas, x, y, { r: x, g: x, b: x, a: 255 });
  }
};

/**
 * The shared engine's 500px ceiling. Centred on a 256px ramp its radius is 250, and the
 * farthest pixel is a corner at `sqrt(128^2 + 128^2) = 181`, so the whole ramp is
 * covered at full coverage and every luma 0-255 is read.
 */
const FULL_RAMP_TIP = { size: 500, hardness: 100 };

describe('tonalWeight', () => {
  /**
   * The band curves, hand-derived from the formula in `src/tools/dodgeBurn.ts`:
   *
   * ```
   *   shadows     ((128 - l) / 128)^2   for l <= 128, else 0
   *   midtones    (l / 128)^2           for l <= 128
   *               ((255 - l) / 127)^2   for l >  128
   *   highlights  0                     for l <= 128
   *               ((l - 128) / 127)^2   for l >  128
   * ```
   */
  const cases: readonly [TonalRange, number, number][] = [
    // 0: shadows is 1, the other two 0 — the bottom of the range.
    ['shadows', 0, 1],
    ['midtones', 0, 0],
    ['highlights', 0, 0],
    // 64: `(64 / 128)^2 = 0.5^2 = 0.25`, exact in binary. Shadows and midtones share it
    // because the lower half is one curve rising to the split and the other falling to it.
    ['shadows', 64, 0.25],
    ['midtones', 64, 0.25],
    ['highlights', 64, 0],
    // 128: the split. Only midtones is non-zero, and it is exactly 1.
    ['shadows', 128, 0],
    ['midtones', 128, 1],
    ['highlights', 128, 0],
    // 192: the upper half is 127 wide, not 128, so neither value is a round number.
    ['shadows', 192, 0],
    ['midtones', 192, 3969 / 16129], // ((255 - 192) / 127)^2 = (63 / 127)^2
    ['highlights', 192, 4096 / 16129], // ((192 - 128) / 127)^2 = (64 / 127)^2
    // 255: highlights is 1, the other two 0 — the top of the range.
    ['shadows', 255, 0],
    ['midtones', 255, 0],
    ['highlights', 255, 1],
  ];

  it.each(cases)('puts %s at %i luma on a weight of %s', (range, luma, expected) => {
    if (Number.isInteger(expected)) {
      expect(tonalWeight(luma, range)).toBe(expected);
      return;
    }
    // The two upper-half luma are irrational in decimal; the fraction is the exact value.
    expect(tonalWeight(luma, range)).toBeCloseTo(expected, 12);
  });

  it('hits 1 at the luma each band is named for, and 0 for the other two', () => {
    expect(tonalWeight(0, 'shadows')).toBe(1);
    expect(tonalWeight(0, 'midtones')).toBe(0);
    expect(tonalWeight(0, 'highlights')).toBe(0);
    expect(tonalWeight(128, 'midtones')).toBe(1);
    expect(tonalWeight(128, 'shadows')).toBe(0);
    expect(tonalWeight(128, 'highlights')).toBe(0);
    expect(tonalWeight(255, 'highlights')).toBe(1);
    expect(tonalWeight(255, 'shadows')).toBe(0);
    expect(tonalWeight(255, 'midtones')).toBe(0);
  });

  it('stays inside [0, 1] for every luma, so no band can overshoot', () => {
    for (const range of ['shadows', 'midtones', 'highlights'] as const) {
      for (let luma = 0; luma <= 255; luma++) {
        const weight = tonalWeight(luma, range);
        expect(weight, `${range} at ${luma}`).toBeGreaterThanOrEqual(0);
        expect(weight, `${range} at ${luma}`).toBeLessThanOrEqual(1);
      }
    }
  });

  it('clamps an out-of-range luma to the ends of the scale rather than extrapolating', () => {
    expect(tonalWeight(-40, 'shadows')).toBe(1);
    expect(tonalWeight(-40, 'midtones')).toBe(0);
    expect(tonalWeight(999, 'highlights')).toBe(1);
    expect(tonalWeight(999, 'midtones')).toBe(0);
  });

  it('reads a non-finite luma as no weight at all', () => {
    for (const luma of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      for (const range of ['shadows', 'midtones', 'highlights'] as const) {
        expect(tonalWeight(luma, range), `${range} at ${luma}`).toBe(0);
      }
    }
  });
});

describe('tonalAmount', () => {
  it('reaches 1 at the peak of the band at full exposure, which is what makes the exact endpoints', () => {
    expect(tonalAmount(128, 'midtones', 100, 1)).toBe(1);
  });

  it('is an exact no-op at exposure 0, whatever the band and coverage are', () => {
    // `band ** 0` is 1 in JavaScript, so the power alone would make Exposure 0 the
    // STRONGEST setting the tool has. The `level` factor is what pins it to zero.
    for (const range of ['shadows', 'midtones', 'highlights'] as const) {
      for (const luma of [0, 64, 128, 192, 255]) {
        for (const coverage of [0, 0.5, 1]) {
          expect(tonalAmount(luma, range, 0, coverage), `${range} ${luma} ${coverage}`).toBe(0);
        }
      }
    }
  });

  it('scales linearly with the exposure at the peak of the band', () => {
    // level = exposure / 100, and the peak's weight is 1 at every level because 1 ** n is 1.
    expect(tonalAmount(128, 'midtones', 50, 1)).toBe(0.5);
    expect(tonalAmount(128, 'midtones', 25, 1)).toBe(0.25);
  });

  it('narrows the band by raising it to the exposure exponent', () => {
    // 0.25 a quarter of the way down the shadows band, raised to 1 * 4.
    expect(tonalWeight(64, 'shadows')).toBe(0.25);
    expect(tonalAmount(64, 'shadows', 100, 1)).toBeCloseTo(0.25 ** 4, 12);
    expect(tonalAmount(64, 'shadows', 100, 1)).toBeCloseTo(0.00390625, 12);
  });

  it('is zero wherever the band is zero, whatever the exposure', () => {
    expect(tonalAmount(255, 'midtones', 100, 1)).toBe(0);
    expect(tonalAmount(128, 'shadows', 100, 1)).toBe(0);
    expect(tonalAmount(0, 'highlights', 100, 1)).toBe(0);
  });

  it('is zero wherever the brush coverage is zero', () => {
    expect(tonalAmount(128, 'midtones', 100, 0)).toBe(0);
    expect(tonalAmount(128, 'midtones', 100, -1)).toBe(0);
    expect(tonalAmount(128, 'midtones', 100, Number.NaN)).toBe(0);
  });

  it('clamps an out-of-range exposure and substitutes the default for a non-finite one', () => {
    // Over the top clamps to the same value as the slider's own maximum.
    expect(tonalAmount(128, 'midtones', 500, 1)).toBe(tonalAmount(128, 'midtones', 100, 1));
    expect(tonalAmount(128, 'midtones', -20, 1)).toBe(0);
    expect(tonalAmount(128, 'midtones', Number.NaN, 1)).toBe(tonalAmount(128, 'midtones', 50, 1));
  });

  /**
   * The bound that makes the two channel rules safe to write unclamped: `amount <= 1`
   * is what stops `c + (255 - c) * amount` overshooting white and `c - c * amount`
   * undershooting black. This is the arithmetic pin for "never past white / black" —
   * the 8-bit buffer would clamp a violation into looking correct.
   */
  it('never leaves [0, 1] for any band, exposure or coverage', () => {
    for (const range of ['shadows', 'midtones', 'highlights'] as const) {
      for (const exposure of [0, 25, 50, 75, 100, 500, Number.NaN]) {
        for (const coverage of [0, 0.5, 1]) {
          for (let luma = 0; luma <= 255; luma++) {
            const amount = tonalAmount(luma, range, exposure, coverage);
            const label = `${range} ${exposure} ${coverage} ${luma}`;
            expect(amount, label).toBeGreaterThanOrEqual(0);
            expect(amount, label).toBeLessThanOrEqual(1);
          }
        }
      }
    }
  });
});

describe('dodge', () => {
  it('moves a mid-grey all the way to white at the peak of the band, and not one step past', () => {
    const canvas = render(dodge, document, args({ points: [point(4, 4)] }));

    // 128 + (255 - 128) * 1 = 255 exactly, so the endpoint is reached rather than clipped
    // to from above, and alpha is untouched.
    expect(pixelAt(canvas, 4, 4)).toEqual([255, 255, 255, 255]);
  });

  it('dodges towards white without ever darkening a pixel', () => {
    const canvas = render(dodge, rampSize, args({ ...FULL_RAMP_TIP, points: [point(128, 128)] }), seedFullRamp);
    const before = untouched(rampSize, seedFullRamp);

    // The direction of the shift is arithmetic, not something the buffer enforces, so
    // this is the real pin: a dodge that reduced a channel would still be a legal 8-bit
    // write and would still pass a "never past white" assertion on its own.
    for (let index = 0; index < before.length; index += 4) {
      expect(canvas.buffer[index], `red at byte ${index}`).toBeGreaterThanOrEqual(before[index]);
      expect(canvas.buffer[index], `red at byte ${index}`).toBeLessThanOrEqual(255);
    }
    expect(channelAt(canvas, 128, 0)).toBe(255);
  });

  it('leaves every pixel outside the selected band bit-identical', () => {
    // "Outside" is only exactly true where the curve is exactly 0: luma 128 for shadows,
    // luma 0 for midtones, luma 0 for highlights. Those are the pixels this pins, and
    // luma 64 pins the same 0.25 band weight from both sides of the split.
    const shadows = render(dodge, document, args({ range: 'shadows', size: 16, points: [point(4, 4)] }), seedRamp);
    expect(channelAt(shadows, 0, 4)).toBe(255); // luma 0, the peak of the shadows band
    expect(channelAt(shadows, 1, 4)).toBe(65); // luma 64: 64 + 191 * 0.25^4 = 64.746
    expect(channelAt(shadows, 2, 4)).toBe(128); // luma 128, the split: band 0
    expect(channelAt(shadows, 4, 4)).toBe(255); // luma 255, the top: band 0

    const midtones = render(dodge, document, args({ range: 'midtones', size: 16, points: [point(4, 4)] }), seedRamp);
    expect(channelAt(midtones, 0, 4)).toBe(0); // luma 0: band 0
    expect(channelAt(midtones, 1, 4)).toBe(65); // the same 0.25 band weight as shadows
    expect(channelAt(midtones, 2, 4)).toBe(255); // luma 128, the peak
    expect(channelAt(midtones, 4, 4)).toBe(255); // luma 255: band 0

    const highlights = render(
      dodge,
      document,
      args({ range: 'highlights', size: 16, points: [point(4, 4)] }),
      seedRamp
    );
    expect(channelAt(highlights, 0, 4)).toBe(0);
    expect(channelAt(highlights, 1, 4)).toBe(64);
    expect(channelAt(highlights, 2, 4)).toBe(128);
    expect(channelAt(highlights, 4, 4)).toBe(255); // luma 255, the peak
  });

  it('is an exact no-op at exposure 0, byte for byte across the whole buffer', () => {
    const canvas = render(dodge, document, args({ exposure: 0, size: 16, points: [point(4, 4)] }), seedRamp);

    expect(changedPixels(canvas, untouched(document, seedRamp))).toEqual([]);
  });

  it('paints one dab and only one for a single-point stroke', () => {
    const canvas = render(dodge, document, args({ points: [point(4, 4)] }));

    // A 1px tip at hardness 100 covers the pixel it is centred on and nothing else:
    // `tipAlphaAt` is 0 at `distance >= radius`, and the neighbours are a full 1px away
    // against a 0.5px radius. This is the case a `ctx.stroke()` over a zero-length path
    // would draw nothing for.
    expect(changedPixels(canvas, untouched(document, seedLuma(128)))).toEqual(['4,4']);
  });

  it('addresses a sub-pixel dab centre to the pixel it sits inside, not to its neighbour', () => {
    const canvas = render(dodge, document, args({ points: [point(0.4, 4)] }));

    // 0.4 < the 0.5 radius, so pixel (0, 4) is inside the tip; pixel (1, 4) is 0.6 away.
    expect(changedPixels(canvas, untouched(document, seedLuma(128)))).toEqual(['0,4']);
  });

  it('stamps dabs along the segment between two points, not only at the endpoints', () => {
    const canvas = render(dodge, document, args({ points: [point(2, 2), point(6, 2)] }));

    // Spacing 25% of a 1px diameter walks the 4px segment at 0.25px steps, and the tip is
    // half-open, so row 2 from x = 2 to x = 6 is covered and nothing past either end.
    expect(changedPixels(canvas, untouched(document, seedLuma(128)))).toEqual(['2,2', '3,2', '4,2', '5,2', '6,2']);
    // The interior pixel is the one a two-endpoint implementation would miss.
    expect(channelAt(canvas, 4, 2)).toBe(255);
  });

  it('unions overlapping dabs instead of summing them, so the amount does not depend on the sample count', () => {
    const once = render(dodge, document, args({ points: [point(4, 4)] }));
    const sampled = render(dodge, document, args({ points: [point(4, 4), point(4.1, 4), point(4.2, 4)] }));

    // The same footprint sampled three times: the union is unchanged, so the interior
    // stays at one commit's worth rather than compounding with the pointer's own rate.
    expect(channelAt(sampled, 4, 4)).toBe(255);
    expect(channelAt(sampled, 4, 4)).toBe(channelAt(once, 4, 4));
  });

  it('paints nothing, and does not throw, for a stroke entirely outside the canvas', () => {
    const before = untouched(document, seedRamp);

    for (const outside of [point(-40, -40), point(-1, 4), point(4, -1), point(9, 9), point(400, 400)]) {
      const canvas = render(dodge, document, args({ points: [outside] }), seedRamp);
      expect(changedPixels(canvas, before), `${outside.x},${outside.y}`).toEqual([]);
    }
  });

  it('paints nothing for an empty point list, and still returns a full-size canvas', () => {
    const canvas = render(dodge, document, args({ points: [] }), seedRamp);

    expect(changedPixels(canvas, untouched(document, seedRamp))).toEqual([]);
    expect(canvas.width).toBe(document.width);
    expect(canvas.height).toBe(document.height);
  });

  it('clamps a non-finite or out-of-range size, hardness and exposure rather than throwing', () => {
    // size NaN falls back to the engine's 13px default and hardness Infinity clamps to
    // 100, so the 8px canvas is covered; exposure 500 clamps to the slider's 100.
    const clamped = render(dodge, document, {
      ...args({ points: [point(4, 4)] }),
      size: Number.NaN,
      hardness: Number.POSITIVE_INFINITY,
      exposure: 500,
    });
    expect(channelAt(clamped, 4, 4)).toBe(255);
    expect(channelAt(clamped, 0, 0)).toBe(255); // the fallback 13px tip reaches the corner

    // And the other direction: a negative size and hardness clamp to their floors and a
    // negative exposure to 0, which is an exact no-op rather than an inverted stroke.
    const floored = render(dodge, document, {
      ...args({ points: [point(4, 4)] }),
      size: -10,
      hardness: -5,
      exposure: -20,
    });
    expect(changedPixels(floored, untouched(document, seedLuma(128)))).toEqual([]);
  });

  it('draws the source it was handed and writes one full-size canvas back', () => {
    const bitmap = createMockImageBitmap(document.width, document.height);
    const [result] = dodge({ size: document, bitmap })(args({ points: [point(4, 4)] }));
    const canvas = RecordingOffscreenCanvas.instances.at(-1)!;

    expect(result).toBe(canvas as unknown as OffscreenCanvas);
    expect(RecordingOffscreenCanvas.instances).toHaveLength(1);
    expect(canvas.ctx.drawImage).toHaveBeenCalledWith(bitmap, 0, 0);
    expect(canvas.ctx.getImageData).toHaveBeenCalledWith(0, 0, document.width, document.height);
    expect(canvas.ctx.putImageData).toHaveBeenCalledTimes(1);
  });
});

describe('burn', () => {
  it('moves a mid-grey all the way to black at the peak of the band, and not one step past', () => {
    const canvas = render(burn, document, args({ toolName: 'burn', points: [point(4, 4)] }));

    // 128 - 128 * 1 = 0. The floor of the rule, reached exactly rather than clipped to
    // from below, and alpha is untouched.
    expect(pixelAt(canvas, 4, 4)).toEqual([0, 0, 0, 255]);
  });

  it('burns towards black without ever lightening a pixel', () => {
    const canvas = render(
      burn,
      rampSize,
      args({ ...FULL_RAMP_TIP, toolName: 'burn', points: [point(128, 128)] }),
      seedFullRamp
    );
    const before = untouched(rampSize, seedFullRamp);

    for (let index = 0; index < before.length; index += 4) {
      expect(canvas.buffer[index], `red at byte ${index}`).toBeLessThanOrEqual(before[index]);
      expect(canvas.buffer[index], `red at byte ${index}`).toBeGreaterThanOrEqual(0);
    }
    expect(channelAt(canvas, 128, 0)).toBe(0);
  });

  it('leaves every pixel outside the selected band bit-identical', () => {
    const shadows = render(
      burn,
      document,
      args({ range: 'shadows', size: 16, toolName: 'burn', points: [point(4, 4)] }),
      seedRamp
    );
    expect(channelAt(shadows, 2, 4)).toBe(128); // luma 128, the split: band 0
    expect(channelAt(shadows, 4, 4)).toBe(255); // luma 255: band 0

    const midtones = render(
      burn,
      document,
      args({ range: 'midtones', size: 16, toolName: 'burn', points: [point(4, 4)] }),
      seedRamp
    );
    expect(channelAt(midtones, 0, 4)).toBe(0); // luma 0: band 0
    expect(channelAt(midtones, 2, 4)).toBe(0); // luma 128, the peak: 128 - 128 = 0
    expect(channelAt(midtones, 4, 4)).toBe(255); // luma 255: band 0

    const highlights = render(
      burn,
      document,
      args({ range: 'highlights', size: 16, toolName: 'burn', points: [point(4, 4)] }),
      seedRamp
    );
    expect(channelAt(highlights, 2, 4)).toBe(128); // luma 128: band 0
    expect(channelAt(highlights, 4, 4)).toBe(0); // luma 255, the peak: 255 - 255 = 0
  });

  it('is an exact no-op at exposure 0, byte for byte across the whole buffer', () => {
    const canvas = render(
      burn,
      document,
      args({ exposure: 0, size: 16, toolName: 'burn', points: [point(4, 4)] }),
      seedRamp
    );

    expect(changedPixels(canvas, untouched(document, seedRamp))).toEqual([]);
  });
});

describe('dodge and burn are the two ends of one axis, not inverses', () => {
  it('drives both directions from one weight: the same amount reaches both endpoints', () => {
    const amount = tonalAmount(128, 'midtones', 100, 1);
    expect(amount).toBe(1);

    // dodge is `c + (255 - c) * amount` and burn is `c - c * amount`: the two differ only
    // in which endpoint they measure from, so one shared amount produces both of these
    // from the same starting channel, and both are exact integers with no rounding.
    const dodged = render(dodge, document, args({ points: [point(4, 4)] }));
    const burned = render(burn, document, args({ toolName: 'burn', points: [point(4, 4)] }));

    expect(channelAt(dodged, 4, 4)).toBe(128 + (255 - 128) * amount);
    expect(channelAt(burned, 4, 4)).toBe(128 - 128 * amount);
    expect(channelAt(dodged, 4, 4)).toBe(255);
    expect(channelAt(burned, 4, 4)).toBe(0);
  });

  /**
   * With `q` the amount, dodge maps `c` to `255 - (255 - c)(1 - q)` and burn maps `c` to
   * `c(1 - q)`, so `burn(dodge(c)) = [c + (255 - c)q](1 - q)`, which is `c` only at
   * `q = 0` and `q = 1`. They are the two ends of one axis, not an inverse pair.
   *
   * These two cases sit at `q = 1` so every step is an exact integer and no 8-bit
   * rounding can be mistaken for an identity, and the SECOND stroke picks the one band
   * that still contains the first stroke's endpoint — `midtones` stops at luma 255, so
   * a burn in `midtones` over a fully dodged pixel does nothing at all, which is the
   * other half of why the pair is not invertible.
   */
  it('does not return a pixel to its original value when the other tool is run over it', () => {
    const dodged = render(dodge, document, args({ points: [point(4, 4)] }));
    expect(channelAt(dodged, 4, 4)).toBe(255);
    // `highlights` still contains luma 255, so the band is 1: 255 - 255 * 1 = 0, and 0
    // is not the 128 the stroke started from.
    const burnedOverDodge = render(
      burn,
      document,
      args({ range: 'highlights', toolName: 'burn', points: [point(4, 4)] }),
      seedLuma(0),
      asSource(dodged)
    );
    expect(channelAt(burnedOverDodge, 4, 4)).toBe(0);
    expect(channelAt(burnedOverDodge, 4, 4)).not.toBe(128);

    // The mirror case, and the one that shows the band gate: `midtones` does NOT contain
    // luma 0, so a midtones dodge over a fully burned pixel leaves it at 0.
    const burned = render(burn, document, args({ toolName: 'burn', points: [point(4, 4)] }));
    expect(channelAt(burned, 4, 4)).toBe(0);
    const stillBlack = render(dodge, document, args({ points: [point(4, 4)] }), seedLuma(0), asSource(burned));
    expect(channelAt(stillBlack, 4, 4)).toBe(0);

    // `shadows` does contain luma 0, so the band is 1: 0 + 255 * 1 = 255, and 255 is not
    // the 128 the stroke started from.
    const dodgedOverBurn = render(
      dodge,
      document,
      args({ range: 'shadows', points: [point(4, 4)] }),
      seedLuma(0),
      asSource(burned)
    );
    expect(channelAt(dodgedOverBurn, 4, 4)).toBe(255);
    expect(channelAt(dodgedOverBurn, 4, 4)).not.toBe(128);
  });

  it('exports two distinct function references, which the processor identity pin requires', () => {
    // `src/tools/__tests__/tool-processors.test.ts` allows a shared processor only for
    // the lasso pair and the shape/figure family, so these cannot be one function with a
    // flag, and neither can be a property of a shared object literal.
    expect(dodge).not.toBe(burn);
    expect(typeof dodge).toBe('function');
    expect(typeof burn).toBe('function');
  });
});
