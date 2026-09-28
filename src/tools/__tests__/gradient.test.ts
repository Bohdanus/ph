import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { defaultSettings } from '../settings.ts';
import { gradient } from '../gradient.ts';
import { makeMockImageData } from '../../__tests__/canvas-mock.ts';
import { createMockCanvasContext } from '../../__tests__/fixtures/canvas.ts';
import type { BitmapSource, Point } from '../../contexts/general-types.ts';
import type { GradientToolArgs } from '../gradient.ts';

type MockCtx = ReturnType<typeof createMockCanvasContext>;

/**
 * The shared mock context plus the two read-back methods production guards on, so the recorder
 * below can be a spread of one plus an override of the other two without an excess-property
 * error against the fixture's fixed return type.
 */
type PixelCtx = MockCtx & Pick<CanvasRenderingContext2D, 'getImageData' | 'putImageData'>;

/**
 * A pixel-capable `OffscreenCanvas` recorder.
 *
 * This is the whole reason the gradient is rasterized in the pixel buffer instead of through
 * `createLinearGradient`: `src/test/setup.ts:148-149` stubs both gradient factories to return a
 * bare `{ addColorStop: vi.fn() }` that never rasterizes anything, so a canvas-gradient
 * implementation would paint one uniform mock colour and every assertion below about where
 * colourA ends and colourB begins would be asserting nothing. A real `Uint8ClampedArray` behind
 * the processor's own `getImageData`/`putImageData` pair is what makes these exact numbers
 * readable at all, and the real API's copy semantics on both edges are preserved so a run that
 * bails early leaves the source raster on the canvas where it was.
 */
class PixelRecordingOffscreenCanvas {
  static instances: PixelRecordingOffscreenCanvas[] = [];

  width: number;
  height: number;
  readonly data: Uint8ClampedArray;
  readonly ctx: PixelCtx;

  constructor(width: number, height: number) {
    this.width = Math.max(1, Math.ceil(width));
    this.height = Math.max(1, Math.ceil(height));
    this.data = new Uint8ClampedArray(this.width * this.height * 4);
    this.ctx = {
      ...createMockCanvasContext({ canvas: this }),
      drawImage: vi.fn((source: unknown) => {
        const sourceData = (source as { data?: Uint8ClampedArray }).data;
        if (sourceData) this.data.set(sourceData.subarray(0, this.data.length));
      }),
      getImageData: vi.fn((_x: number, _y: number, w: number, h: number) => ({
        data: new Uint8ClampedArray(this.data),
        width: w,
        height: h,
        colorSpace: 'srgb' as const,
      })),
      putImageData: vi.fn((imageData: { data: Uint8ClampedArray }) => {
        this.data.set(imageData.data.subarray(0, this.data.length));
      }),
    };
    PixelRecordingOffscreenCanvas.instances.push(this);
  }

  getContext(): PixelCtx {
    return this.ctx;
  }

  at(x: number, y: number): [number, number, number, number] {
    const offset = (y * this.width + x) * 4;
    return [this.data[offset], this.data[offset + 1], this.data[offset + 2], this.data[offset + 3]];
  }
}

/** The source `bitmap` a raster processor is handed: a sized raster carrying its own pixels. */
const createRaster = (imageData: ImageData): BitmapSource =>
  ({
    width: imageData.width,
    height: imageData.height,
    data: new Uint8ClampedArray(imageData.data),
  }) as unknown as BitmapSource;

/**
 * `#102030` and `#304850`. Chosen because every interpolation between them at a dyadic
 * `t` lands on an integer channel: the midpoint is `(32, 52, 64)` exactly, so an expected value
 * in a test can be written down rather than approximated.
 */
const COLOUR_A: readonly [number, number, number, number] = [16, 32, 48, 255];
const COLOUR_B: readonly [number, number, number, number] = [48, 72, 80, 255];
const MIDPOINT: readonly [number, number, number, number] = [32, 52, 64, 255];

const TRANSPARENT: readonly [number, number, number, number] = [0, 0, 0, 0];
const OPAQUE_GREY: readonly [number, number, number, number] = [128, 128, 128, 255];

/**
 * `makeMockImageData`'s fill callback is handed `(index, x, y)` and no buffer, so a fixture
 * that varies per pixel is built here instead: allocate with it, then write the channels.
 */
const makeField = (width: number, height: number, colourAt: (x: number, y: number) => readonly number[]): ImageData => {
  const imageData = makeMockImageData(width, height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = colourAt(x, y);
      const offset = (y * width + x) * 4;
      imageData.data[offset] = r;
      imageData.data[offset + 1] = g;
      imageData.data[offset + 2] = b;
      imageData.data[offset + 3] = a;
    }
  }

  return imageData;
};

const flatField = (width: number, height: number, fill: readonly number[]): ImageData =>
  makeField(width, height, () => fill);

beforeEach(() => {
  PixelRecordingOffscreenCanvas.instances = [];
  vi.stubGlobal('OffscreenCanvas', PixelRecordingOffscreenCanvas as unknown as typeof OffscreenCanvas);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const gradientArgs = (overrides: Partial<GradientToolArgs> = {}): GradientToolArgs => ({
  ...defaultSettings.gradient,
  colorA: '#102030',
  colorB: '#304850',
  ...overrides,
});

/** Runs the processor and returns the single full-size canvas it must have produced. */
const runGradient = (source: ImageData, overrides: Partial<GradientToolArgs> = {}) => {
  const result = gradient({ size: { width: source.width, height: source.height }, bitmap: createRaster(source) })(
    gradientArgs(overrides)
  );

  expect(result).toHaveLength(1);
  const canvas = result[0] as unknown as PixelRecordingOffscreenCanvas;
  // Structural, not truthy: the processor must return the canvas it just allocated.
  expect(canvas).toBe(PixelRecordingOffscreenCanvas.instances.at(-1));
  expect(canvas.width).toBe(source.width);
  expect(canvas.height).toBe(source.height);

  return canvas;
};

describe('gradient rasterization', () => {
  it('puts exactly colourA at 0% of the axis and exactly colourB at 100%', () => {
    // `from` (0,1) to `to` (8,1): a horizontal axis, so the projection is `(x - 0) * 8 / 64`,
    // and `y` drops out of it entirely. That is the pin for the axis being the AXIS rather than
    // a point-to-point ramp — the pixels a row above the drag land on the same stops.
    const canvas = runGradient(flatField(9, 3, TRANSPARENT), {
      type: 'linear',
      from: { x: 0, y: 1 },
      to: { x: 8, y: 1 },
    });

    expect(canvas.at(0, 1)).toEqual(COLOUR_A);
    expect(canvas.at(8, 1)).toEqual(COLOUR_B);
    expect(canvas.at(0, 0)).toEqual(COLOUR_A);
    expect(canvas.at(8, 0)).toEqual(COLOUR_B);
    expect(canvas.at(0, 2)).toEqual(COLOUR_A);
  });

  it('puts the exact mean of the two stops at the midpoint of the axis', () => {
    const canvas = runGradient(flatField(9, 3, TRANSPARENT), {
      type: 'linear',
      from: { x: 0, y: 1 },
      to: { x: 8, y: 1 },
    });

    expect(canvas.at(4, 1)).toEqual(MIDPOINT);
    // The 1/8 and 7/8 samples are not pinned to the midpoint, so the assertion above cannot be
    // satisfied by a gradient that is constant.
    expect(canvas.at(1, 1)).not.toEqual(MIDPOINT);
    expect(canvas.at(7, 1)).not.toEqual(MIDPOINT);
  });

  it('replaces an opaque destination outright at full opacity', () => {
    const canvas = runGradient(flatField(9, 1, OPAQUE_GREY), {
      type: 'linear',
      from: { x: 0, y: 0 },
      to: { x: 8, y: 0 },
    });

    expect(canvas.at(0, 0)).toEqual(COLOUR_A);
    expect(canvas.at(8, 0)).toEqual(COLOUR_B);
    // Opaque grey is nowhere in the ramp, so a blend that left any of it behind would show here.
    expect(canvas.at(2, 0)).not.toEqual(OPAQUE_GREY);
  });

  it('clamps beyond both ends to the nearest stop rather than fading out', () => {
    // `from` (4,0) to `to` (8,0): the projection is negative for every column left of 4, and
    // Photoshop holds the end colour there instead of running the gradient off to nothing.
    const canvas = runGradient(flatField(9, 1, TRANSPARENT), {
      type: 'linear',
      from: { x: 4, y: 0 },
      to: { x: 8, y: 0 },
    });

    expect(canvas.at(0, 0)).toEqual(COLOUR_A);
    expect(canvas.at(3, 0)).toEqual(COLOUR_A);
    expect(canvas.at(4, 0)).toEqual(COLOUR_A);
    expect(canvas.at(6, 0)).toEqual(MIDPOINT);
    expect(canvas.at(8, 0)).toEqual(COLOUR_B);
  });

  it('interpolates a diagonal axis by projection, not by row', () => {
    // `from` (0,0) to `to` (4,4): `t = (x * 4 + y * 4) / 32 = (x + y) / 8`, so (2,2) is the
    // midpoint and (4,0) is the far end. A per-row or per-column ramp would put the midpoint
    // somewhere else entirely.
    const canvas = runGradient(flatField(5, 5, TRANSPARENT), {
      type: 'linear',
      from: { x: 0, y: 0 },
      to: { x: 4, y: 4 },
    });

    expect(canvas.at(0, 0)).toEqual(COLOUR_A);
    expect(canvas.at(4, 4)).toEqual(COLOUR_B);
    expect(canvas.at(2, 2)).toEqual(MIDPOINT);
  });

  it('puts exactly colourA at the centre and exactly colourB at the `to` radius, in every direction', () => {
    // `from` (5,5) to `to` (9,5): radius 4, so the ring of radius 4 is the second stop. The
    // four axis-aligned samples on that ring are the pin, and the centre plus the exact-radius
    // half-way sample (7,5) carry the rest.
    const canvas = runGradient(flatField(11, 11, TRANSPARENT), {
      type: 'radial',
      from: { x: 5, y: 5 },
      to: { x: 9, y: 5 },
    });

    expect(canvas.at(5, 5)).toEqual(COLOUR_A);
    expect(canvas.at(9, 5)).toEqual(COLOUR_B);
    expect(canvas.at(1, 5)).toEqual(COLOUR_B);
    expect(canvas.at(5, 1)).toEqual(COLOUR_B);
    expect(canvas.at(5, 9)).toEqual(COLOUR_B);
    expect(canvas.at(7, 5)).toEqual(MIDPOINT);
    expect(canvas.at(5, 3)).toEqual(MIDPOINT);
    expect(canvas.at(5, 7)).toEqual(MIDPOINT);
  });

  it('is a hard no-op for a zero-length drag, which is what the seeded defaults carry', () => {
    // `defaultSettings.gradient` seeds `from` and `to` at the document origin, and the options
    // bar sets real endpoints before the first commit. So the degenerate case is the DEFAULT,
    // and it has to be a defined no-op on the source raster rather than a division by zero
    // writing NaN into every channel of every pixel. `putImageData` not being reached at all is
    // the structural half of that claim: nothing is published, so nothing changes.
    const seeded = runGradient(flatField(4, 4, OPAQUE_GREY));
    expect(seeded.ctx.putImageData).not.toHaveBeenCalled();
    expect(seeded.at(0, 0)).toEqual(OPAQUE_GREY);
    expect(seeded.at(3, 3)).toEqual(OPAQUE_GREY);

    const explicit = runGradient(flatField(4, 4, OPAQUE_GREY), { from: { x: 2, y: 2 }, to: { x: 2, y: 2 } });
    expect(explicit.ctx.putImageData).not.toHaveBeenCalled();
    expect(explicit.at(2, 2)).toEqual(OPAQUE_GREY);
  });

  it('is a no-op for non-finite endpoints rather than publishing NaN', () => {
    for (const [from, to] of [
      [
        { x: Number.NaN, y: 0 },
        { x: 4, y: 0 },
      ],
      [
        { x: 0, y: 0 },
        { x: Number.POSITIVE_INFINITY, y: 0 },
      ],
    ] satisfies [Point, Point][]) {
      const canvas = runGradient(flatField(4, 4, OPAQUE_GREY), { from, to });

      expect(canvas.ctx.putImageData).not.toHaveBeenCalled();
      expect(canvas.at(0, 0)).toEqual(OPAQUE_GREY);
    }
  });

  it('paints nothing at zero alpha, and the source survives it', () => {
    const canvas = runGradient(flatField(9, 1, OPAQUE_GREY), {
      type: 'linear',
      from: { x: 0, y: 0 },
      to: { x: 8, y: 0 },
      alpha: 0,
    });

    // `blendPixel` returns before any write at `opacity <= 0`, so the ramp is computed and
    // discarded: the visible result is the unchanged source.
    expect(canvas.at(0, 0)).toEqual(OPAQUE_GREY);
    expect(canvas.at(8, 0)).toEqual(OPAQUE_GREY);
  });

  it('scales the resulting blend by alpha', () => {
    // 50% of `#102030` over opaque grey: effective alpha 0.5 over destination alpha 1, so
    // `outAlpha = 0.5 + 1 * 0.5 = 1` and each channel is `(src * 0.5 + 128 * 0.5) / 1`.
    const canvas = runGradient(flatField(9, 1, OPAQUE_GREY), {
      type: 'linear',
      from: { x: 0, y: 0 },
      to: { x: 8, y: 0 },
      alpha: 0.5,
    });

    // (16 * 0.5 + 128 * 0.5) = 72, (32 * 0.5 + 128 * 0.5) = 80, (48 * 0.5 + 128 * 0.5) = 88.
    expect(canvas.at(0, 0)).toEqual([72, 80, 88, 255]);
    // (48 * 0.5 + 128 * 0.5) = 88, (72 * 0.5 + 128 * 0.5) = 100, (80 * 0.5 + 128 * 0.5) = 104.
    expect(canvas.at(8, 0)).toEqual([88, 100, 104, 255]);
  });

  it('does not throw for endpoints that are entirely off the canvas', () => {
    // Every projection here is far past 1, so the whole layer holds colourB. The point is that
    // a drag that began outside the visible document — which is what happens when a gesture
    // starts on the letterboxed area around a fitted image — is a fill, not an exception.
    const canvas = runGradient(flatField(8, 8, TRANSPARENT), {
      type: 'linear',
      from: { x: -40, y: -40 },
      to: { x: -30, y: -30 },
    });

    expect(canvas.at(0, 0)).toEqual(COLOUR_B);
    expect(canvas.at(7, 7)).toEqual(COLOUR_B);
  });

  it('does not throw for a radial drag whose centre is off the canvas', () => {
    const canvas = runGradient(flatField(8, 8, TRANSPARENT), {
      type: 'radial',
      from: { x: -20, y: -20 },
      to: { x: -20, y: -10 },
    });

    // The furthest pixel from (-20,-20) is (7,7) at distance sqrt(27^2 + 27^2) = 38.2, past the
    // radius of 10, so even the nearest corner is already past the second stop.
    expect(canvas.at(7, 7)).toEqual(COLOUR_B);
  });

  it('leaves the layer untouched for a stop that is not a hex literal', () => {
    // `fromHex` throws on anything else, and a throw from inside a pointer handler is a drag
    // that appears to do nothing, so an unparseable stop has to be a defined no-op instead.
    const canvas = runGradient(flatField(4, 4, OPAQUE_GREY), {
      from: { x: 0, y: 0 },
      to: { x: 3, y: 0 },
      colorA: 'nope',
    });

    expect(canvas.ctx.putImageData).not.toHaveBeenCalled();
    expect(canvas.at(0, 0)).toEqual(OPAQUE_GREY);
  });
});
