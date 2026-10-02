import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  SPONGE_FLOW_DEFAULT,
  SPONGE_FLOW_MAX,
  SPONGE_FLOW_MIN,
  SPONGE_MIDDLE_GREY,
  SPONGE_MODE_DEFAULT,
  SPONGE_MODES,
  chromaHeadroom,
  chromaScale,
  isSpongeMode,
  sponge,
  spongeAmount,
  spongeLuma,
  type SpongeMode,
  type SpongeToolArgs,
} from '../sponge.ts';
import { burn, dodge } from '../dodgeBurn.ts';
import { computeLuma } from '../../util/magneticLasso.ts';
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
 * The processors allocate one canvas, draw the source bitmap into it, and read it back, so
 * the global `OffscreenCanvas` stub in `src/test/setup.ts` is not enough: its context has no
 * `getImageData` at all (`src/test/setup.ts:185` says so on purpose), so the real tool
 * would take its own no-read-back arm and paint nothing.
 *
 * This recorder therefore keeps a REAL `Uint8ClampedArray` behind
 * `getImageData`/`putImageData`, and `drawImage` copies a sibling recorder's buffer — the one
 * behaviour the global mock omits that the tool actually depends on.
 */
class RecordingOffscreenCanvas {
  static instances: RecordingOffscreenCanvas[] = [];

  /**
   * Applied to each new instance the moment it is constructed, i.e. before the processor
   * that allocated it runs a single line. It stands in for the pixels `drawImage` transfers
   * from the source, so seeding here rather than afterwards is what makes the test read the
   * same bytes the tool read.
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

/**
 * The tolerance every hand-derived float below is asserted against.
 *
 * `spongeLuma` sums three products of 8-bit integers with decimal coefficients, and every
 * coefficient is inexact in binary, so the pivot carries a few ULP of representation error:
 * `spongeLuma(200, 100, 50)` is `117.64999999999999`, not `117.65`. `1e-12` is two orders
 * of magnitude above the ~1e-13 that leaves at magnitude 255, and six orders below one 8-bit
 * quantum (0.5), so it can only fail on a change to the arithmetic and never on rounding.
 */
const TOLERANCE = 12;

/** Both modes, in the order `SPONGE_MODES` lists them. */
const MODES: readonly SpongeMode[] = ['saturate', 'desaturate'];

const document: Size = { width: 8, height: 8 };

/** A 1px tip, hard-edged: the only geometry whose footprint is derivable by hand. */
const args = (overrides: Partial<SpongeToolArgs> = {}): SpongeToolArgs => ({
  mode: 'desaturate',
  flow: SPONGE_FLOW_DEFAULT,
  vibrance: false,
  size: 1,
  hardness: 100,
  points: [],
  toolName: 'sponge',
  ...overrides,
});

/**
 * `110 * 0.7152 + 240 * 0.0722 = 78.672 + 17.328 = 96` exactly in IEEE-754 — a deliberate
 * choice of seed. A luma that is not a whole number would make every "the covered pixel
 * collapsed to grey" assertion an `approximately 96`, which is a far weaker pin than an
 * `exactly 96`, and the alpha is not 255 so the alpha-preservation assertions have something
 * to bite on.
 */
const SEED: Rgba = { r: 0, g: 110, b: 240, a: 255 };

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

/**
 * The seed as a buffer, computed WITHOUT the processor. Every "byte-exact no-op" assertion
 * below is compared against this rather than against a second render of the same no-op, which
 * would pass even if both runs painted identically wrong.
 */
const filled = (size: Size, rgba: Rgba): Uint8ClampedArray => {
  const buffer = new Uint8ClampedArray(size.width * size.height * 4);
  for (let offset = 0; offset < buffer.length; offset += 4) {
    buffer[offset] = rgba.r;
    buffer[offset + 1] = rgba.g;
    buffer[offset + 2] = rgba.b;
    buffer[offset + 3] = rgba.a;
  }
  return buffer;
};

const seedColoured: Seed = (canvas) => seedFill(canvas, SEED);

const pixelAt = (canvas: RecordingOffscreenCanvas, x: number, y: number): number[] =>
  Array.from(canvas.buffer.slice((y * canvas.width + x) * 4, (y * canvas.width + x) * 4 + 4));

/**
 * `pixelAt` at an explicit row stride.
 *
 * The recorder's buffer is sized from the CANVAS, so when the processor asks for an
 * 8x8 read-back out of a 9x8 canvas the buffer is still 9 wide while the tool addresses it
 * as 8 wide. That is the real `getImageData` contract (it returns a new 8x8 `ImageData`, not
 * a view of the canvas) and the recorder's only approximation of it, so a stride-sensitive
 * assertion has to name the stride it is using.
 */
const pixelAtWidth = (canvas: RecordingOffscreenCanvas, x: number, y: number, width: number): number[] =>
  Array.from(canvas.buffer.slice((y * width + x) * 4, (y * width + x) * 4 + 4));

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
 * Run the processor and return the canvas it produced, structurally: the returned value must
 * be the full-`size` canvas it just allocated, not merely something truthy.
 *
 * `source` defaults to a mock bitmap, whose `drawImage` transfers nothing, so `seed` alone
 * determines the source pixels. Passing a previous canvas as `source` is how a second stroke
 * is run over the first stroke's output.
 */
const render = (
  size: Size,
  toolArgs: SpongeToolArgs,
  seed: Seed = seedColoured,
  source?: BitmapSource
): RecordingOffscreenCanvas => {
  RecordingOffscreenCanvas.seed = seed;
  try {
    const [result] = sponge({ size, bitmap: source ?? createMockImageBitmap(size.width, size.height) })(toolArgs);
    const canvas = RecordingOffscreenCanvas.instances.at(-1)!;

    expect(result).toBe(canvas as unknown as OffscreenCanvas);
    expect(canvas.width).toBe(size.width);
    expect(canvas.height).toBe(size.height);
    return canvas;
  } finally {
    RecordingOffscreenCanvas.seed = null;
  }
};

const point = (x: number, y: number): Point => ({ x, y });

/** The largest distance of any channel of `rgba` from its own luma. */
const maxDeviation = (rgba: Rgba, luma: number): number =>
  Math.max(Math.abs(rgba.r - luma), Math.abs(rgba.g - luma), Math.abs(rgba.b - luma));

describe('spongeLuma', () => {
  it('is Rec.709 on the stored channels, and takes no alpha argument at all', () => {
    // The arity is the structural form of the same claim: there is nowhere for alpha to enter.
    expect(spongeLuma.length).toBe(3);

    // 255 * 0.2126 = 54.213 and 1 * (0.2126 + 0.7152 + 0.0722) = 1 exactly.
    expect(spongeLuma(255, 0, 0)).toBe(54.213);
    expect(spongeLuma(1, 1, 1)).toBe(1);
    expect(spongeLuma(0, 110, 240)).toBe(96);
    expect(spongeLuma(0, 0, 0)).toBe(0);
    // Green is weighted most heavily, which is the whole difference between Rec.709 luma and
    // a flat average and is observable in one pair.
    expect(spongeLuma(0, 255, 0)).toBeCloseTo(182.376, TOLERANCE);
    expect(spongeLuma(255, 0, 0)).toBeGreaterThan(spongeLuma(0, 0, 255));
  });

  it('reads a fully transparent pixel as the luma of its RGB, where computeLuma reads white', () => {
    // `chromaScale` skips `a === 0` pixels outright, but the pivot it WOULD have used is
    // this number, and it is the number the tool's comment says is deliberately not
    // `computeLuma`. `computeLuma(255, 0, 0, 0)` is exactly 255: zero alpha composites to
    // white, which as a chroma pivot would pull every cut-out edge toward white.
    expect(spongeLuma(255, 0, 0)).toBe(54.213);
    expect(computeLuma(255, 0, 0, 0)).toBe(255);
    expect(spongeLuma(255, 0, 0)).not.toBe(computeLuma(255, 0, 0, 0));
  });

  it('differs from computeLuma on a partly transparent pixel by exactly the alpha weight', () => {
    // 200 * 0.2126 + 100 * 0.7152 + 50 * 0.0722 = 42.52 + 71.52 + 3.61 = 117.65.
    // computeLuma(r, g, b, a) = luma * (a / 255) + 255 * (1 - a / 255), so at a = 128:
    // 117.65 * (128/255) + 255 * (127/255) = 59.0556862745098 + 127 = 186.0556862745098.
    expect(spongeLuma(200, 100, 50)).toBeCloseTo(117.65, TOLERANCE);
    expect(computeLuma(200, 100, 50, 128)).toBeCloseTo(186.0556862745098, TOLERANCE);
    expect(spongeLuma(200, 100, 50)).not.toBe(computeLuma(200, 100, 50, 128));
    // The gap closes as alpha closes on 255, so at full opacity the two agree exactly.
    expect(spongeLuma(200, 100, 50)).toBe(computeLuma(200, 100, 50, 255));
  });
});

describe('chromaHeadroom', () => {
  it('is Infinity for a pixel with no deviation to amplify', () => {
    // Every arm of the solve skips `deviation === 0`, so a grey pixel has no bound at all
    // rather than a bound of zero from a 0/0 division.
    expect(chromaHeadroom(128, 128, 128, 128)).toBe(Number.POSITIVE_INFINITY);
    expect(chromaHeadroom(0, 0, 0, 0)).toBe(Number.POSITIVE_INFINITY);
    expect(chromaHeadroom(255, 255, 255, 255)).toBe(Number.POSITIVE_INFINITY);
  });

  it('is never below 1 for any 8-bit pixel, because k = 1 is always in range', () => {
    // `c > L` gives (255 - L) / (c - L) and `c <= 255` is exactly the condition that keeps
    // the quotient at 1 or above; `c < L` gives L / (L - c) and `c >= 0` is that condition.
    // Both arms hold for every one of the 16.7M triples, so a stride of 5 over 0..255
    // (140,608 pixels) is a sample of the whole space rather than of a corner of it.
    for (let r = 0; r <= 255; r += 5) {
      for (let g = 0; g <= 255; g += 5) {
        for (let b = 0; b <= 255; b += 5) {
          const headroom = chromaHeadroom(r, g, b, spongeLuma(r, g, b));
          expect(headroom, `${r},${g},${b}`).toBeGreaterThanOrEqual(1);
        }
      }
    }
  });

  /**
   * The solve, on one hand-worked case, in both directions.
   *
   * Pixel (200, 100, 50) about luma 117.65:
   *
   * ```
   *   r: dev = +82.35   (255 - 117.65) / 82.35 = 137.35 / 82.35 = 1.6678809957498482
   *   g: dev = -17.65   117.65 / 17.65                  = 6.6654390934844193
   *   b: dev = -67.65   117.65 / 67.65                  = 1.7390982993340738
   * ```
   *
   * The red arm is the tightest of the three and is therefore the answer.
   */
  it('is the tightest of the per-channel bounds, with both arms derived by hand', () => {
    expect(chromaHeadroom(200, 100, 50, 117.65)).toBe(137.35 / 82.35);
    expect(chromaHeadroom(200, 100, 50, 117.65)).toBe(1.6678809957498482);

    // The DOWNWARD arm can be the tightest too, and the same pixel proves it with a
    // different pivot. At 155 every channel is BELOW the luma, so only the `L / -deviation`
    // arm applies:
    //
    //   r: dev = +45   (255 - 155) / 45  = 2.2222222222222223
    //   g: dev = -55   155 / 55          = 2.8181818181818183
    //   b: dev = -105  155 / 105         = 1.4761904761904763   <- the tightest
    expect(chromaHeadroom(200, 100, 50, 155)).toBe(155 / 105);
    expect(chromaHeadroom(200, 100, 50, 155)).toBe(1.4761904761904763);
    expect(chromaHeadroom(200, 100, 50, 155)).toBeLessThan((255 - 155) / (200 - 155));
  });
});

describe('spongeAmount', () => {
  it('has a floor of SPONGE_FLOW_MIN / SPONGE_FLOW_MAX, so the smallest amount Flow can express is 0.01', () => {
    // Below the slider's 1% floor, `clampFlow` returns MIN, so the rate is 1/100 and NOT 0.
    // This is the number the "flow cannot produce an amount" no-op would need, and it is
    // positive: nothing about a legal or an illegal flow reaches a zero amount.
    expect(spongeAmount(0, 1)).toBe(0.01);
    expect(spongeAmount(-1000, 1)).toBe(0.01);
    expect(spongeAmount(SPONGE_FLOW_MIN, 1)).toBe(0.01);
  });

  it('never returns zero, whatever flow it is handed', () => {
    // The sweep a claim of "some flow cannot produce an amount" has to survive: the finite
    // ones all floor at 1% and the non-finite ones fall back to the default.
    for (const flow of [-1e9, -1, 0, 1, 50, 100, 1e9, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(spongeAmount(flow, 1), `${flow}`).toBeGreaterThan(0);
    }
    expect(spongeAmount(1e9, 1)).toBe(1);
  });

  it('falls back to SPONGE_FLOW_DEFAULT for a non-finite flow, exactly as for a finite one', () => {
    expect(spongeAmount(Number.NaN, 1)).toBe(SPONGE_FLOW_DEFAULT / SPONGE_FLOW_MAX);
    expect(spongeAmount(Number.NaN, 1)).toBe(spongeAmount(SPONGE_FLOW_DEFAULT, 1));
    expect(spongeAmount(Number.POSITIVE_INFINITY, 1)).toBe(0.5);
    expect(spongeAmount(Number.NEGATIVE_INFINITY, 1)).toBe(0.5);
  });

  it('clamps an out-of-range flow to the ends of the slider rather than extrapolating', () => {
    expect(spongeAmount(500, 1)).toBe(spongeAmount(SPONGE_FLOW_MAX, 1));
    expect(spongeAmount(500, 1)).toBe(1);
  });

  it('is zero wherever the tip coverage is zero, including a non-finite one', () => {
    expect(spongeAmount(100, 0)).toBe(0);
    expect(spongeAmount(100, -1)).toBe(0);
    expect(spongeAmount(100, Number.NaN)).toBe(0);
    expect(spongeAmount(100, Number.POSITIVE_INFINITY)).toBe(0);
    expect(spongeAmount(100, Number.NEGATIVE_INFINITY)).toBe(0);
  });

  it('scales linearly with the flow at full coverage', () => {
    // rate = flow / SPONGE_FLOW_MAX and coverage 1 leaves it untouched, so 25% of 100 is
    // exactly 0.25 in binary and no tolerance is needed.
    expect(spongeAmount(25, 1)).toBe(0.25);
    expect(spongeAmount(50, 1)).toBe(0.5);
    expect(spongeAmount(75, 1)).toBe(0.75);
  });

  it('multiplies by the coverage rather than composing with it', () => {
    expect(spongeAmount(50, 0.5)).toBe(0.25);
    expect(spongeAmount(100, 0.25)).toBe(0.25);
    // The default coverage is a full dab, which is what makes the slider's own scale read.
    expect(spongeAmount(50)).toBe(0.5);
    expect(spongeAmount(50)).toBe(spongeAmount(50, 1));
  });

  /**
   * The bound that lets `chromaScale`'s Desaturate branch reach `k = 0` (full grey) and no
   * further: an `amount > 1` would make `1 - amount` negative and drive channels PAST the
   * pivot rather than onto it.
   */
  it('never leaves [0, 1] for any flow or coverage', () => {
    for (const flow of [-1e9, -1, 0, 1, 25, 50, 75, 100, 1e9, Number.NaN, Number.POSITIVE_INFINITY]) {
      for (const coverage of [-1, 0, 0.25, 0.5, 1, 2, 1e9, Number.NaN, Number.POSITIVE_INFINITY]) {
        const amount = spongeAmount(flow, coverage);
        expect(amount, `${flow} ${coverage}`).toBeGreaterThanOrEqual(0);
        expect(amount, `${flow} ${coverage}`).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('chromaScale', () => {
  /**
   * The identity arm, asserted as IDENTITY rather than as equality. The module's own comment
   * gives the reason: `L + fl(c - L)` is not guaranteed to round back to `c`, so an
   * implementation that computed through the arithmetic would produce a near-miss object on
   * some pixel somewhere, and `toEqual` would hide it behind a tolerance.
   */
  it('returns the input object itself at amount 0, in both modes and with Vibrance either way', () => {
    const pixel: Rgba = { r: 200, g: 100, b: 50, a: 128 };
    for (const mode of MODES) {
      for (const vibrance of [true, false]) {
        expect(chromaScale(pixel, mode, 0, vibrance), `${mode} ${vibrance}`).toBe(pixel);
      }
    }
  });

  it('treats a negative or non-finite amount as zero, returning rather than round-tripping', () => {
    // The guard is `!(amount > 0)`, not `amount === 0`, so a NaN from a divided-through
    // coverage cannot turn into a NaN pixel.
    const pixel: Rgba = { r: 200, g: 100, b: 50, a: 255 };
    for (const amount of [-1, -1e9, Number.NaN, Number.NEGATIVE_INFINITY]) {
      expect(chromaScale(pixel, 'saturate', amount, false), `${amount}`).toBe(pixel);
      expect(chromaScale(pixel, 'desaturate', amount, false), `${amount}`).toBe(pixel);
    }
  });

  /**
   * The `Math.min(amount, 1)` clamp, which had no test at all while its JSDoc argued for it at
   * length.
   *
   * `spongeAmount` already caps at 1, so this guard is unreachable from the slider — which is
   * exactly why it needs a test: an unreachable guard argued for in prose is a claim, and this
   * one was that the guard exists so an over-large amount cannot put Desaturate's scale BELOW
   * zero. A negative factor mirrors the pixel across its own luma instead of draining it, which
   * is wrong by a wide margin. `+Infinity` is the one non-finite value the `!(amount > 0)`
   * early return does NOT catch, since `Infinity > 0` is true.
   */
  it('clamps an amount above 1 instead of letting Desaturate invert the pixel', () => {
    const pixel: Rgba = { r: 200, g: 100, b: 50, a: 255 };
    const atOne = chromaScale(pixel, 'desaturate', 1, false);

    for (const amount of [1.5, 2, 1e9, Number.POSITIVE_INFINITY]) {
      expect(chromaScale(pixel, 'desaturate', amount, false), `desaturate ${amount}`).toEqual(atOne);
      // And the Saturate direction must saturate, not overflow into a NaN pixel.
      const saturated = chromaScale(pixel, 'saturate', amount, false);
      for (const channel of [saturated.r, saturated.g, saturated.b]) {
        expect(Number.isNaN(channel), `saturate ${amount} produced NaN`).toBe(false);
        expect(channel).toBeGreaterThanOrEqual(0);
        expect(channel).toBeLessThanOrEqual(255);
      }
    }

    // The failure this prevents, derived by hand so the expectation is not the implementation's
    // own expression restated: Rec.709 luma of (200, 100, 50) is 0.2126*200 + 0.7152*100 +
    // 0.0722*50 = 117.65, and a Desaturate at amount 1 must land all three channels on it.
    // Without the clamp, amount 2 would give `k = -1` and the pixel MIRRORED about that pivot:
    // red would come back as 2*117.65 - 200 = 35.3, not 117.65.
    const collapsed = chromaScale(pixel, 'desaturate', 2, false);
    for (const channel of [collapsed.r, collapsed.g, collapsed.b]) {
      expect(channel).toBeCloseTo(117.65, 9);
    }
    // The mirrored answer the guard prevents, stated so the two cannot be confused.
    expect(2 * 117.65 - 200).toBeCloseTo(35.3, 9);
    expect(collapsed.r).not.toBeCloseTo(35.3, 6);

    // And what actually lands in the buffer: `clampChannel` does not round, so the returned
    // channels are floats and `writeRgba` is where they become 8-bit. Seed a layer of this very
    // pixel, drive it through the processor at the clamped amount, and read the STORED byte —
    // which is 118, the round of 117.65, and NOT the 35 the mirror would have produced.
    const solidPixel: Seed = (canvas) => seedFill(canvas, pixel);
    const stroke = render(document, args({ flow: 100, mode: 'desaturate', points: [point(4, 4)] }), solidPixel);
    expect(pixelAt(stroke, 4, 4)).toEqual([118, 118, 118, 255]);
  });

  it('leaves a fully transparent pixel untouched in both modes at every amount and both Vibrance settings', () => {
    // Identity again, and it can be identity here: the `rgba.a === 0` guard returns before
    // the arithmetic, so the object's channels are not even read.
    const pixel: Rgba = { r: 255, g: 0, b: 255, a: 0 };
    for (const mode of MODES) {
      for (const vibrance of [true, false]) {
        for (const amount of [0.001, 0.25, 0.5, 1]) {
          expect(chromaScale(pixel, mode, amount, vibrance), `${mode} ${amount} ${vibrance}`).toBe(pixel);
        }
      }
    }
  });

  /**
   * The no-chroma case. Pure black and mid grey round-trip exactly, so the value assertions
   * are `toEqual`; pure white does NOT, because `spongeLuma(255, 255, 255)` is
   * `254.99999999999997` rather than `255` and the deviation is therefore `2.84e-14` instead
   * of `0`. The tolerance here is what that residual costs, and it is 12 decimal places for
   * the same reason every other float in this file is.
   */
  it('leaves a pixel with no chroma at its own value in BOTH modes, at the maximum amount', () => {
    const black: Rgba = { r: 0, g: 0, b: 0, a: 255 };
    const grey: Rgba = { r: 128, g: 128, b: 128, a: 255 };
    const white: Rgba = { r: 255, g: 255, b: 255, a: 255 };

    for (const mode of MODES) {
      for (const vibrance of [true, false]) {
        expect(chromaScale(black, mode, 1, vibrance), `${mode} black`).toEqual(black);
        expect(chromaScale(grey, mode, 1, vibrance), `${mode} grey`).toEqual(grey);
      }
    }

    for (const mode of MODES) {
      const out = chromaScale(white, mode, 1, false);
      expect(out.r, `${mode} white`).toBeCloseTo(255, TOLERANCE);
      expect(out.g, `${mode} white`).toBeCloseTo(255, TOLERANCE);
      expect(out.b, `${mode} white`).toBeCloseTo(255, TOLERANCE);
      expect(out.a, `${mode} white`).toBe(255);
    }

    // And the direction of the guarantee: a grey pixel moves by strictly less than one 8-bit
    // quantum, so no amount can make it visibly different.
    for (const mode of MODES) {
      const out = chromaScale({ r: 200, g: 200, b: 200, a: 255 }, mode, 1, true);
      expect(Math.abs(out.r - 200), `${mode}`).toBeLessThan(0.5);
      expect(Math.abs(out.g - 200), `${mode}`).toBeLessThan(0.5);
      expect(Math.abs(out.b - 200), `${mode}`).toBeLessThan(0.5);
    }
  });

  /**
   * A grey pixel returns by IDENTITY, at every level and in both modes.
   *
   * This was originally written the other way round — asserting that every no-op grey pixel is
   * re-allocated — because at the time there was no fast path and "untouched" was only a
   * value-level claim. A review found that claim rests on floating point: `0.2126 + 0.7152 +
   * 0.0722` is not exactly `1.0` in binary, so `spongeLuma(255, 255, 255)` is
   * `254.99999999999997` and pure white came back as `254.99999999999997` at full Desaturate.
   * `writeRgba` rounded it back on the way into the buffer so no pixel was ever visibly wrong,
   * but the module's own comment claimed white was an exact no-op and the function did not make
   * that true. An `r === g && g === b` early return makes it true, and this pins it.
   *
   * The `toBe` form is the point: `toEqual` would pass for the re-allocating version too, since
   * the re-allocated value happens to match.
   */
  it('returns a grey pixel by identity rather than re-deriving it', () => {
    for (const level of [0, 1, 17, 128, 200, 254, 255]) {
      const grey: Rgba = { r: level, g: level, b: level, a: 255 };
      expect(chromaScale(grey, 'saturate', 1, false), `saturate grey ${level}`).toBe(grey);
      expect(chromaScale(grey, 'desaturate', 1, false), `desaturate grey ${level}`).toBe(grey);
    }

    // And with Vibrance on, which must not turn the guard off: the cap is only reachable for a
    // pixel with chroma, so a grey pixel has nothing to cap in either mode.
    const white: Rgba = { r: 255, g: 255, b: 255, a: 255 };
    expect(chromaScale(white, 'saturate', 1, true)).toBe(white);
    expect(chromaScale(white, 'desaturate', 1, true)).toBe(white);

    // A PARTLY transparent grey pixel is still grey, so the chroma guard and not the alpha
    // guard is what returns it — `a === 0` would not fire here.
    const faintGrey: Rgba = { r: 128, g: 128, b: 128, a: 3 };
    expect(chromaScale(faintGrey, 'saturate', 1, false)).toBe(faintGrey);
  });

  it('preserves alpha exactly on every path that does change the colour', () => {
    // A partly transparent pixel whose channels move. The alpha argument is deliberately an
    // odd number so a "recompute alpha from the blend" mutation cannot land on it.
    const pixel: Rgba = { r: 250, g: 10, b: 10, a: 17 };

    const saturated = chromaScale(pixel, 'saturate', 0.5, false);
    expect(saturated.a).toBe(17);
    expect(saturated.r).toBe(255);
    expect(saturated.g).toBe(0);
    expect(saturated).not.toEqual(pixel);

    const desaturated = chromaScale(pixel, 'desaturate', 1, true);
    expect(desaturated.a).toBe(17);
    expect(desaturated.r).toBeCloseTo(61.024, TOLERANCE);
    expect(desaturated.g).toBeCloseTo(61.024, TOLERANCE);

    // And across the whole space of reachable arguments, alpha is a pass-through.
    for (const alpha of [0, 1, 17, 128, 254, 255]) {
      for (const mode of MODES) {
        for (const amount of [0.05, 0.5, 1]) {
          for (const vibrance of [true, false]) {
            const out = chromaScale({ r: 250, g: 10, b: 10, a: alpha }, mode, amount, vibrance);
            expect(out.a, `${mode} ${amount} ${vibrance} a=${alpha}`).toBe(alpha);
          }
        }
      }
    }
  });

  it('collapses a coloured pixel onto its own luma at amount 1, all three channels equal', () => {
    // `k = 0` at amount 1 in Desaturate, so every channel is `clampChannel(luma)`. The
    // expected lumae are hand-summed: 42.52 + 71.52 + 3.61, 78.672 + 17.328, and so on.
    const cases: readonly [Rgba, number][] = [
      [{ r: 250, g: 10, b: 10, a: 255 }, 61.024], // 53.15 + 7.152 + 0.722
      [{ r: 200, g: 100, b: 50, a: 128 }, 117.65], // 42.52 + 71.52 + 3.61
      [{ r: 0, g: 110, b: 240, a: 255 }, 96], // 78.672 + 17.328
      [{ r: 255, g: 0, b: 255, a: 200 }, 72.624], // 54.213 + 18.411
    ];

    for (const [pixel, luma] of cases) {
      for (const vibrance of [true, false]) {
        const out = chromaScale(pixel, 'desaturate', 1, vibrance);
        expect(out.r, `r ${JSON.stringify(pixel)}`).toBeCloseTo(luma, TOLERANCE);
        expect(out.g, `g ${JSON.stringify(pixel)}`).toBeCloseTo(luma, TOLERANCE);
        expect(out.b, `b ${JSON.stringify(pixel)}`).toBeCloseTo(luma, TOLERANCE);
        expect(out.a, `a ${JSON.stringify(pixel)}`).toBe(pixel.a);
      }
    }
  });

  it('is monotone under Desaturate: half the amount lies between the pixel and full grey', () => {
    // 61.024 + (250 - 61.024) * 0.5 = 155.512 and 61.024 - 51.024 * 0.5 = 35.512, so both
    // channels are strictly between their own endpoints. A scale of `1 + amount` under
    // Desaturate would push green the wrong way and fail the strict `<= 35.512` on green.
    const pixel: Rgba = { r: 250, g: 10, b: 10, a: 255 };
    const half = chromaScale(pixel, 'desaturate', 0.5, false);
    const full = chromaScale(pixel, 'desaturate', 1, false);

    expect(half.r).toBeCloseTo(155.512, TOLERANCE);
    expect(half.g).toBeCloseTo(35.512, TOLERANCE);
    expect(half.b).toBeCloseTo(35.512, TOLERANCE);

    for (const channel of ['r', 'g', 'b'] as const) {
      const low = Math.min(pixel[channel], full[channel]);
      const high = Math.max(pixel[channel], full[channel]);
      expect(half[channel], channel).toBeGreaterThan(low);
      expect(half[channel], channel).toBeLessThan(high);
    }

    // And the three intermediate amounts lie between the two ends, in order.
    const ladder = [0.25, 0.5, 0.75, 1].map((amount) => chromaScale(pixel, 'desaturate', amount, false));
    for (let index = 1; index < ladder.length; index++) {
      expect(ladder[index].r, `r at step ${index}`).toBeLessThan(ladder[index - 1].r);
      expect(ladder[index].g, `g at step ${index}`).toBeGreaterThan(ladder[index - 1].g);
    }
  });

  it('pushes every channel further from the luma under Saturate, and further still as the amount grows', () => {
    // Luma 117.65. Deviations are +82.35, -17.65, -67.65, so the signs are what makes this
    // a direction test rather than a magnitude test: an inverted scale would bring every
    // channel back toward the pivot and fail the sign assertions.
    const pixel: Rgba = { r: 200, g: 100, b: 50, a: 255 };
    const luma = 117.65;

    expect(maxDeviation(pixel, luma)).toBeCloseTo(82.35, TOLERANCE);

    const quarter = chromaScale(pixel, 'saturate', 0.25, false);
    const half = chromaScale(pixel, 'saturate', 0.5, false);
    expect(quarter.r).toBeCloseTo(220.5875, TOLERANCE);
    expect(quarter.g).toBeCloseTo(95.5875, TOLERANCE);
    expect(quarter.b).toBeCloseTo(33.0875, TOLERANCE);
    expect(half.r).toBeCloseTo(241.175, TOLERANCE);
    expect(half.g).toBeCloseTo(91.175, TOLERANCE);
    expect(half.b).toBeCloseTo(16.175, TOLERANCE);

    for (const out of [quarter, half]) {
      expect(out.r, 'r above the luma').toBeGreaterThan(pixel.r);
      expect(out.g, 'g below the luma').toBeLessThan(pixel.g);
      expect(out.b, 'b below the luma').toBeLessThan(pixel.b);
      expect(maxDeviation(out, luma), 'deviation grew').toBeGreaterThan(maxDeviation(pixel, luma));
    }
    expect(maxDeviation(half, luma)).toBeGreaterThan(maxDeviation(quarter, luma));
    expect(maxDeviation(quarter, luma)).toBeCloseTo(102.9375, TOLERANCE);
    expect(maxDeviation(half, luma)).toBeCloseTo(123.525, TOLERANCE);

    // 0.75 is deliberately not in this test: 117.65 + 82.35 * 1.75 = 261.76 clips at 255,
    // and a clipped channel measures less deviation than the arithmetic produced.
  });

  it('is a pure function of its four arguments, and does not mutate its input', () => {
    const pixel: Rgba = { r: 250, g: 10, b: 10, a: 200 };
    const snapshot: Rgba = { ...pixel };

    for (const mode of MODES) {
      for (const amount of [0.25, 0.5, 1]) {
        for (const vibrance of [true, false]) {
          const first = chromaScale(pixel, mode, amount, vibrance);
          const second = chromaScale(pixel, mode, amount, vibrance);
          expect(first, `${mode} ${amount} ${vibrance}`).toEqual(second);
        }
      }
    }
    expect(pixel).toEqual(snapshot);

    // The mutate-and-return-the-same-object variant of a "pure function" is the one a
    // `toEqual` on the RESULT alone would miss, so the input is the thing asserted on.
    const out = chromaScale(pixel, 'saturate', 0.5, false);
    expect(out).not.toBe(pixel);
    expect(out).not.toEqual(pixel);
  });

  /**
   * **THE VIBRANCE TEST.** This is the whole reason the checkbox exists.
   *
   * Pixel (250, 10, 10), mode Saturate, amount 0.5, so `k = 1.5`:
   *
   * ```
   *   luma = 250 * 0.2126 + 10 * 0.7152 + 10 * 0.0722 = 53.15 + 7.152 + 0.722 = 61.024
   * ```
   *
   * **Vibrance OFF** — headroom is `Infinity`, so `k = 1.5` is applied and then clamped by
   * `clampChannel`:
   *
   * ```
   *   r = 61.024 + 188.976 * 1.5 = 344.488      -> 255   (clipped against white)
   *   g = 61.024 -  51.024 * 1.5 = -15.512     -> 0     (clipped against black)
   *   b = 61.024 -  51.024 * 1.5 = -15.512     -> 0     (clipped against black)
   * ```
   *
   * Green goes from 10 to EXACTLY 0 and red from 250 to EXACTLY 255: two channels against
   * a rail, from a pixel that started with neither.
   *
   * **Vibrance ON** — `chromaHeadroom(250, 10, 10, 61.024)` is the tightest of
   *
   * ```
   *   r: (255 - 61.024) / 188.976 = 1.0264583862501058
   *   g: 61.024 / 51.024          = 1.195924...
   *   b: 61.024 / 51.024          = 1.195924...
   * ```
   *
   * so `k` is capped at 1.0264583862501058 and
   *
   * ```
   *   r = 61.024 + 188.976 * 1.0264583862501058 = 255   (exactly, and IN range)
   *   g = 61.024 -  51.024 * 1.0264583862501058 = 8.649987299974605
   * ```
   *
   * Every channel is inside `[0, 255]` and green is strictly inside it, which is the
   * difference between "minimize clipping" and "clip": the un-vibranced stroke turned a 10
   * into a 0 and this one turns it into an 8.65.
   */
  it('brings a clipping Saturate back in range, where the same stroke without it clips', () => {
    const pixel: Rgba = { r: 250, g: 10, b: 10, a: 255 };

    const clipped = chromaScale(pixel, 'saturate', 0.5, false);
    expect(clipped.r).toBe(255);
    expect(clipped.g).toBe(0);
    expect(clipped.b).toBe(0);
    // Both rails reached from a pixel that sat on neither.
    expect(clipped.r).not.toBe(pixel.r);
    expect(clipped.g).not.toBe(pixel.g);
    expect(clipped.b).not.toBe(pixel.b);

    const preserved = chromaScale(pixel, 'saturate', 0.5, true);
    for (const channel of ['r', 'g', 'b'] as const) {
      expect(preserved[channel], channel).toBeGreaterThanOrEqual(0);
      expect(preserved[channel], channel).toBeLessThanOrEqual(255);
    }
    // The cap did work, rather than the range assertion passing because the result was
    // already in range: green is strictly inside, and strictly different from the clipped one.
    expect(preserved.g).toBeGreaterThan(0);
    expect(preserved.g).not.toBe(clipped.g);
    expect(preserved.b).toBeGreaterThan(0);
    expect(preserved.r).toBeCloseTo(255, TOLERANCE);
    expect(preserved.g).toBeCloseTo(8.649987299974605, TOLERANCE);
    expect(preserved.b).toBeCloseTo(8.649987299974605, TOLERANCE);
    expect(preserved.a).toBe(255);

    // And the cap is the headroom, not a hardcoded ceiling: a pixel whose headroom is exactly
    // 1 is left completely alone, which is the `applied === 1` arm.
    const pinned: Rgba = { r: 0, g: 110, b: 240, a: 255 };
    expect(chromaHeadroom(pinned.r, pinned.g, pinned.b, spongeLuma(pinned.r, pinned.g, pinned.b))).toBe(1);
    expect(chromaScale(pinned, 'saturate', 0.5, true)).toBe(pinned);
    expect(chromaScale(pinned, 'saturate', 0.5, false)).not.toBe(pinned);
    expect(chromaScale(pinned, 'saturate', 0.5, false)).toEqual({ r: 0, g: 117, b: 255, a: 255 });
  });

  /**
   * Vibrance is inert under Desaturate, by construction rather than by omission: every
   * channel moves toward `luma`, so the result is the convex combination
   * `(1 - amount) * c + amount * luma` of two values already inside `[0, 255]` and cannot
   * leave the gamut. That means the headroom could be computed and capped without changing a
   * single answer, which is what makes the equality below an identity rather than a
   * coincidence for these pixels.
   */
  it('leaves Desaturate bit-identical whether Vibrance is on or off', () => {
    const pixels: readonly Rgba[] = [
      { r: 250, g: 10, b: 10, a: 255 },
      { r: 200, g: 100, b: 50, a: 128 },
      { r: 0, g: 110, b: 240, a: 255 },
      { r: 255, g: 255, b: 255, a: 255 },
      { r: 0, g: 0, b: 0, a: 17 },
      { r: 3, g: 251, b: 17, a: 1 },
    ];

    for (const pixel of pixels) {
      for (const amount of [0.01, 0.25, 0.5, 0.75, 1]) {
        const withVibrance = chromaScale(pixel, 'desaturate', amount, true);
        const without = chromaScale(pixel, 'desaturate', amount, false);
        expect(withVibrance, `${JSON.stringify(pixel)} @ ${amount}`).toEqual(without);
        expect(withVibrance.a).toBe(pixel.a);
      }
    }
  });
});

describe('isSpongeMode', () => {
  it('accepts exactly the two values on the dropdown', () => {
    expect(isSpongeMode('saturate')).toBe(true);
    expect(isSpongeMode('desaturate')).toBe(true);
    expect(isSpongeMode(SPONGE_MODE_DEFAULT)).toBe(true);
    expect(SPONGE_MODE_DEFAULT).toBe('desaturate');
    expect(SPONGE_MODES.map((entry) => entry.value)).toEqual(['saturate', 'desaturate']);
    expect(SPONGE_MODES.map((entry) => entry.label)).toEqual(['Saturate', 'Desaturate']);
  });

  it('rejects near misses that a substring or a `startsWith` test would have accepted', () => {
    const nearMisses = [
      'Saturate',
      'DESATURATE',
      'saturate ',
      ' desaturate',
      'desaturate2',
      'saturate2',
      '',
      'de-saturate',
    ];
    for (const value of nearMisses) {
      expect(isSpongeMode(value), JSON.stringify(value)).toBe(false);
    }
  });
});

describe('sponge', () => {
  it('returns a fresh full-size canvas and never the source bitmap', () => {
    // This is why the tool is `commit: 'raster'` and `requiresRaster: true`: the processor
    // allocates its own extent and writes the result back through `putImageData`, so the
    // registry has to be handed a raster rather than a descriptor over the layer's own.
    const bitmap = createMockImageBitmap(document.width, document.height);
    const [result] = sponge({ size: document, bitmap })(args({ points: [point(4, 4)] }));
    const canvas = RecordingOffscreenCanvas.instances.at(-1)!;

    expect(result).toBe(canvas as unknown as OffscreenCanvas);
    expect(result).not.toBe(bitmap);
    expect(RecordingOffscreenCanvas.instances).toHaveLength(1);
    expect(canvas.ctx.drawImage).toHaveBeenCalledWith(bitmap, 0, 0);
    expect(canvas.ctx.getImageData).toHaveBeenCalledWith(0, 0, document.width, document.height);
    expect(canvas.ctx.putImageData).toHaveBeenCalledTimes(1);
  });

  it('is a byte-exact no-op returning the drawn source for an empty point list', () => {
    // Compared against the seed computed WITHOUT the processor, so a run that painted the
    // whole canvas one uniform value would still fail.
    const canvas = render(document, args({ points: [] }));

    expect(Array.from(canvas.buffer)).toEqual(Array.from(filled(document, SEED)));
    expect(changedPixels(canvas, filled(document, SEED))).toEqual([]);
  });

  it('is a byte-exact no-op for a stroke that lands nowhere on the canvas', () => {
    for (const outside of [point(-40, -40), point(-1, 4), point(9, 9), point(400, 400)]) {
      const canvas = render(document, args({ points: [outside] }), seedColoured);
      expect(changedPixels(canvas, filled(document, SEED)), `${outside.x},${outside.y}`).toEqual([]);
    }
  });

  it('is a byte-exact no-op when the point list is not an array at all', () => {
    // `Array.isArray(args.points) ? args.points : []` is the arm a persisted history entry
    // with a malformed stroke reaches, and it has to be a no-op rather than a throw.
    const canvas = render(document, args({ points: undefined as unknown as Point[] }));

    expect(Array.from(canvas.buffer)).toEqual(Array.from(filled(document, SEED)));
  });

  it('covers exactly one pixel for a 1px hard tip, and scales its chroma about its own luma', () => {
    const canvas = render(document, args({ flow: 100, points: [point(4, 4)] }));

    // `tipAlphaAt` is 0 at `distance >= radius`, and the neighbours are a full 1px away
    // against a 0.5px radius, so one dab on one pixel is the whole footprint.
    expect(changedPixels(canvas, filled(document, SEED))).toEqual(['4,4']);
    // `k = 1 - amount = 0` at Flow 100, so the pixel collapses onto `spongeLuma(0, 110, 240)`
    // which is exactly 96.
    expect(pixelAt(canvas, 4, 4)).toEqual([96, 96, 96, 255]);
  });

  it('stops half way at Flow 50, on the exact half-step value', () => {
    const canvas = render(document, args({ flow: 50, points: [point(4, 4)] }));

    // 96 + (0 - 96) * 0.5 = 48, 96 + (110 - 96) * 0.5 = 103, 96 + (240 - 96) * 0.5 = 168.
    expect(pixelAt(canvas, 4, 4)).toEqual([48, 103, 168, 255]);
  });

  it('saturates to the gamut edge without Vibrance and leaves the pixel identical with it', () => {
    // The processor's half of the Vibrance contract, on the same seed whose headroom is
    // exactly 1: `k = 1.5` clips green to 117 and blue to 255, and the cap makes the whole
    // call an identity, so no byte of the buffer is written at all.
    const clipped = render(document, args({ mode: 'saturate', flow: 50, points: [point(4, 4)] }));
    expect(pixelAt(clipped, 4, 4)).toEqual([0, 117, 255, 255]);

    const preserved = render(document, args({ mode: 'saturate', flow: 50, vibrance: true, points: [point(4, 4)] }));
    expect(changedPixels(preserved, filled(document, SEED))).toEqual([]);
  });

  it('preserves alpha on the covered pixel', () => {
    const translucent: Rgba = { r: 250, g: 10, b: 10, a: 17 };
    const canvas = render(document, args({ flow: 100, points: [point(4, 4)] }), (target) =>
      seedFill(target, translucent)
    );

    expect(pixelAt(canvas, 4, 4)[3]).toBe(17);
    expect(pixelAt(canvas, 0, 0)[3]).toBe(17);
  });

  it('scales the rim of a soft tip by the tip falloff rather than by its strongest dab', () => {
    // An 8px tip at hardness 0 has no core, so pixel (4, 4) — the dab's own centre — is at
    // `tipAlphaAt(0, 4, 0) = 1` while pixel (6, 4), two pixels away, is at
    // `0.5 * (1 + cos(pi * 2 / 4)) = 0.5`. At Flow 100 the rate is 1, so the amount IS the
    // coverage and the two pixels get visibly different amounts:
    //
    // ```
    //   (4, 4): amount 1    -> k = 0    -> 96, 96, 96
    //   (6, 4): amount 0.5  -> k = 0.5  -> 48, 103, 168
    // ```
    //
    // An implementation that read the coverage as 1 — or never read it at all — would give
    // both pixels the centre's answer, which is the brush's edge becoming the brush's middle.
    const canvas = render(document, args({ size: 8, hardness: 0, flow: 100, points: [point(4, 4)] }));

    expect(pixelAt(canvas, 4, 4)).toEqual([96, 96, 96, 255]);
    expect(pixelAt(canvas, 6, 4)).toEqual([48, 103, 168, 255]);
    expect(pixelAt(canvas, 2, 4)).toEqual([48, 103, 168, 255]);
    expect(pixelAt(canvas, 8, 4)).toEqual([0, 110, 240, 255]); // exactly on the rim: no weight
  });

  /**
   * A DELETED test, kept as a comment because the reason it could not work is worth recording.
   *
   * This used to read `points: [point(4,4)]` against `points: [point(4,4), point(4.1,4), point(4.2,4)]`
   * and assert the two rasters agreed, on the theory that a coverage field which SUMMED the
   * three dabs would push the amount past 1. It cannot fail that way: `spongeAmount` clamps
   * `coverage` to 1, so `spongeAmount(50, 3)` and `spongeAmount(50, 1)` are both `0.5` and a
   * summing field produces byte-identical pixels. The assertion was unfalsifiable through the
   * processor for any implementation at all.
   *
   * The real union pin lives where the field itself is observable:
   * `src/util/__tests__/stroke-coverage.test.ts` asserts that two heavily-overlapping dabs
   * yield the LARGER weight rather than the sum, at the field level. That test is mutated in
   * both union variants (max-of-dabs and first-dab-wins) and goes red for each.
   */
  it('clamps an over-full coverage to 1 rather than over-driving the amount', () => {
    // The behaviour that made the deleted test unfalsifiable, asserted directly: three co-located
    // dabs must produce exactly what one dab produces, because coverage is clamped at the top.
    const once = render(document, args({ flow: 50, points: [point(4, 4)] }));
    const sampled = render(document, args({ flow: 50, points: [point(4, 4), point(4.1, 4), point(4.2, 4)] }));

    expect(spongeAmount(50, 3)).toBe(spongeAmount(50, 1));
    expect(spongeAmount(50, 3)).toBe(0.5);
    expect(pixelAt(sampled, 4, 4)).toEqual(pixelAt(once, 4, 4));
    expect(pixelAt(sampled, 4, 4)).toEqual([48, 103, 168, 255]);
  });

  it('still paints at a flow below the slider floor, at the 1% rate', () => {
    // `spongeAmount` cannot return 0 for any flow, so the smallest amount a stroke can carry
    // is `SPONGE_FLOW_MIN / SPONGE_FLOW_MAX = 0.01` and there is no "flow cannot produce an
    // amount" no-op to find here. Saturate on luma 96 with `k = 1.01`:
    //
    //   r = 96 -  96 * 1.01 = -0.96   -> 0
    //   g = 96 +  14 * 1.01 = 110.14  -> 110
    //   b = 96 + 144 * 1.01 = 241.44  -> 241
    const canvas = render(document, args({ mode: 'saturate', flow: 0, points: [point(4, 4)] }));

    expect(pixelAt(canvas, 4, 4)).toEqual([0, 110, 241, 255]);
    expect(changedPixels(canvas, filled(document, SEED))).toEqual(['4,4']);
  });

  it('falls back to SPONGE_FLOW_DEFAULT for a non-finite flow, which paints rather than no-ops', () => {
    const defaulted = render(document, args({ flow: Number.NaN, points: [point(4, 4)] }));
    const seeded = render(document, args({ flow: SPONGE_FLOW_DEFAULT, points: [point(4, 4)] }));

    expect(pixelAt(defaulted, 4, 4)).toEqual(pixelAt(seeded, 4, 4));
    expect(pixelAt(defaulted, 4, 4)).toEqual([48, 103, 168, 255]);
  });

  it('clamps a non-finite or out-of-range size, hardness and flow rather than throwing', () => {
    // size NaN falls back to the engine's 13px default and hardness Infinity clamps to 100,
    // so the 8px canvas is covered; flow 500 clamps to the slider's 100.
    const clamped = render(document, {
      ...args({ points: [point(4, 4)] }),
      size: Number.NaN,
      hardness: Number.POSITIVE_INFINITY,
      flow: 500,
    });
    expect(pixelAt(clamped, 4, 4)).toEqual([96, 96, 96, 255]);
    expect(pixelAt(clamped, 0, 0)).toEqual([96, 96, 96, 255]); // the fallback 13px tip reaches the corner

    // And the other direction: a negative size and hardness clamp to their floors, so the
    // tip is 1px again rather than an inverted one.
    const floored = render(document, {
      ...args({ points: [point(4, 4)] }),
      size: -10,
      hardness: -5,
    });
    expect(changedPixels(floored, filled(document, SEED))).toEqual(['4,4']);
  });

  it('floors a fractional extent instead of addressing a fractional pixel index', () => {
    // Not run through `render`, because that helper asserts `canvas.width === size.width`
    // and a canvas rounds 8.5 up to 9. `pixelExtent` floors the extent back to 8, so the
    // coverage lookup is `y * 8 + x` — an integer. Without that floor the lookup would be
    // `coverage[4 * 8.5 + 4]`, a non-integer subscript, which is `undefined` on a
    // `Float32Array`; `!(undefined > 0)` then skips every pixel and the stroke paints
    // NOTHING rather than painting slightly wrong.
    const size: Size = { width: 8.5, height: 8.5 };
    RecordingOffscreenCanvas.seed = seedColoured;
    try {
      const [result] = sponge({ size, bitmap: createMockImageBitmap(9, 9) })(
        args({ flow: 100, points: [point(4, 4)] })
      );
      const canvas = RecordingOffscreenCanvas.instances.at(-1)!;

      expect(result).toBe(canvas as unknown as OffscreenCanvas);
      expect(canvas.width).toBe(9);
      expect(canvas.height).toBe(9);
      // The height floor is only observable through the read-back rectangle: the height
      // never appears in the coverage index, so a fractional height would otherwise reach
      // `getImageData` and produce an `ImageData` whose declared height is not its data's.
      expect(canvas.ctx.getImageData).toHaveBeenCalledWith(0, 0, 8, 8);
      // Read at the tool's own 8px stride: this is the pixel the floor is there to make
      // addressable at all.
      expect(pixelAtWidth(canvas, 4, 4, 8)).toEqual([96, 96, 96, 255]);
      expect(pixelAtWidth(canvas, 4, 5, 8)).toEqual([0, 110, 240, 255]);
    } finally {
      RecordingOffscreenCanvas.seed = null;
    }
  });

  it('exports its own function reference, which the processor identity pin requires', () => {
    // `src/tools/__tests__/tool-processors.test.ts` allows a shared processor only for the
    // lasso pair and the shape/figure family, so the Sponge cannot be one function with a
    // mode flag, nor a property of a shared object literal. Importing the Dodge is what
    // makes this an identity assertion rather than a tautology.
    expect(typeof sponge).toBe('function');
    expect(sponge).not.toBe(dodge);
    expect(sponge).not.toBe(burn);
  });
});

describe('the exported constants', () => {
  it('spells the Flow range as the 1-100 the module records, and the seeded default as 50', () => {
    // A recorded choice rather than an Adobe fact, per the module's own comment: Adobe's
    // Sponge page states no default. Pinning it means changing the recorded choice is a
    // deliberate, visible edit.
    expect(SPONGE_FLOW_MIN).toBe(1);
    expect(SPONGE_FLOW_MAX).toBe(100);
    expect(SPONGE_FLOW_DEFAULT).toBe(50);
    expect(SPONGE_FLOW_MIN).toBeLessThan(SPONGE_FLOW_DEFAULT);
    expect(SPONGE_FLOW_DEFAULT).toBeLessThan(SPONGE_FLOW_MAX);
  });

  it("keeps SPONGE_MIDDLE_GREY at Adobe's middle grey, the pivot the Grayscale rule names", () => {
    expect(SPONGE_MIDDLE_GREY).toBe(128);
  });
});
