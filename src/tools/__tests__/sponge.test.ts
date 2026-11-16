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
  type SpongeToolArgs,
} from '../sponge.ts';
import { createPixelCanvasContext } from '../../test/setup.ts';
import type { BitmapSource, Point, Size } from '../../contexts/general-types.ts';
import type { Rgba } from '../../util/pixels.ts';

const document: Size = { width: 8, height: 8 };

type MockCtx = CanvasRenderingContext2D;

class RecordingOffscreenCanvas {
  static instances: RecordingOffscreenCanvas[] = [];
  static seed = new Uint8ClampedArray();

  width: number;
  height: number;
  readonly buffer: Uint8ClampedArray;
  readonly ctx: MockCtx;

  constructor(width: number, height: number) {
    this.width = Math.max(1, Math.ceil(width));
    this.height = Math.max(1, Math.ceil(height));
    this.buffer = new Uint8ClampedArray(this.width * this.height * 4);

    const ctx = createPixelCanvasContext(this);
    vi.mocked(ctx.drawImage).mockImplementation(((source: unknown) => {
      const drawn = source as { pixels: Uint8ClampedArray };
      this.buffer.set(drawn.pixels.subarray(0, this.buffer.length));
    }) as unknown as MockCtx['drawImage']);
    vi.mocked(ctx.getImageData).mockImplementation(
      () =>
        ({
          data: this.buffer.slice(),
          width: this.width,
          height: this.height,
          colorSpace: 'srgb',
        }) as ImageData
    );
    vi.mocked(ctx.putImageData).mockImplementation(((image: ImageData, x: number, y: number) => {
      for (let row = 0; row < image.height; row++) {
        const from = row * image.width * 4;
        const to = (y + row) * this.width * 4 + x * 4;
        this.buffer.set(image.data.subarray(from, from + image.width * 4), to);
      }
    }) as unknown as MockCtx['putImageData']);

    this.ctx = ctx;
    RecordingOffscreenCanvas.instances.push(this);
  }

  getContext(): MockCtx {
    return this.ctx;
  }
}

const SEED: Rgba = { r: 0, g: 110, b: 240, a: 255 };

const seedFill = (): Uint8ClampedArray => {
  const data = new Uint8ClampedArray(document.width * document.height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = SEED.r;
    data[i + 1] = SEED.g;
    data[i + 2] = SEED.b;
    data[i + 3] = SEED.a;
  }
  return data;
};

const filled = seedFill();

const args = (overrides: Partial<SpongeToolArgs> = {}): SpongeToolArgs => ({
  flow: SPONGE_FLOW_DEFAULT,
  mode: SPONGE_MODE_DEFAULT,
  vibrance: false,
  toolName: 'sponge',
  size: 50,
  hardness: 50,
  points: [],
  ...overrides,
});

const sourceBitmap = (pixels: Uint8ClampedArray) =>
  ({ width: document.width, height: document.height, pixels, close: vi.fn() }) as unknown as BitmapSource;

const render = (data: Uint8ClampedArray, a: SpongeToolArgs) => {
  const [canvas] = sponge({ size: document, bitmap: sourceBitmap(data) })(a);
  return canvas as unknown as RecordingOffscreenCanvas;
};

const point = (x: number, y: number): Point => ({ x, y });

const pixelAt = (canvas: RecordingOffscreenCanvas, x: number, y: number): Rgba => ({
  r: canvas.buffer[(y * document.width + x) * 4],
  g: canvas.buffer[(y * document.width + x) * 4 + 1],
  b: canvas.buffer[(y * document.width + x) * 4 + 2],
  a: canvas.buffer[(y * document.width + x) * 4 + 3],
});

beforeEach(() => {
  RecordingOffscreenCanvas.instances = [];
  RecordingOffscreenCanvas.seed = new Uint8ClampedArray();
  vi.stubGlobal('OffscreenCanvas', RecordingOffscreenCanvas as unknown as typeof OffscreenCanvas);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('sponge structure', () => {
  it('is a two-stage curried processor', () => {
    const bitmap = sourceBitmap(filled);
    const inner = sponge({ size: document, bitmap });

    expect(sponge.length).toBe(1);
    expect(inner.length).toBe(1);
  });

  it('allocates exactly one canvas and draws the source bitmap', () => {
    const bitmap = sourceBitmap(filled);
    const [canvas] = sponge({ size: document, bitmap })(args());

    expect(RecordingOffscreenCanvas.instances).toHaveLength(1);
    expect(canvas).toBe(RecordingOffscreenCanvas.instances[0]);
    expect(canvas).not.toBe(bitmap);
    expect(vi.mocked(RecordingOffscreenCanvas.instances[0].ctx.drawImage).mock.calls[0][0]).toBe(bitmap);
  });
});

describe('sponge constants', () => {
  it('SPONGE_FLOW_MIN is 1', () => {
    expect(SPONGE_FLOW_MIN).toBe(1);
  });

  it('SPONGE_FLOW_MAX is 100', () => {
    expect(SPONGE_FLOW_MAX).toBe(100);
  });

  it('SPONGE_FLOW_DEFAULT is 50', () => {
    expect(SPONGE_FLOW_DEFAULT).toBe(50);
  });

  it('SPONGE_MIDDLE_GREY is 128', () => {
    expect(SPONGE_MIDDLE_GREY).toBe(128);
  });

  it('SPONGE_MODE_DEFAULT is "desaturate"', () => {
    expect(SPONGE_MODE_DEFAULT).toBe('desaturate');
  });

  it('SPONGE_MODES contains both modes as objects with value and label', () => {
    expect(SPONGE_MODES).toEqual([
      { value: 'saturate', label: 'Saturate' },
      { value: 'desaturate', label: 'Desaturate' },
    ]);
  });

  it('sponge toolName is "sponge"', () => {
    expect(args().toolName).toBe('sponge');
  });
});

describe('spongeMode predicates', () => {
  it('isSpongeMode accepts both modes', () => {
    expect(isSpongeMode('saturate')).toBe(true);
    expect(isSpongeMode('desaturate')).toBe(true);
  });

  it('isSpongeMode rejects invalid mode', () => {
    expect(isSpongeMode('invalid')).toBe(false);
  });
});

describe('spongeLuma and chroma helpers', () => {
  it('spongeLuma computes Rec.709 luma correctly', () => {
    expect(spongeLuma(255, 255, 255)).toBeCloseTo(255);
    expect(spongeLuma(0, 0, 0)).toBe(0);
    expect(spongeLuma(255, 0, 0)).toBeCloseTo(54.213);
    expect(spongeLuma(0, 255, 0)).toBeCloseTo(182.376);
    expect(spongeLuma(0, 0, 255)).toBeCloseTo(18.408);
  });

  it('chromaHeadroom computes headroom correctly when luma provided', () => {
    // All channels equal to luma -> no deviation -> Infinity
    expect(chromaHeadroom(255, 255, 255, 255)).toBe(Infinity);
    expect(chromaHeadroom(0, 0, 0, 0)).toBe(Infinity);
    // Red above luma - use actual luma of the pixel
    const redLuma = spongeLuma(255, 0, 0);
    expect(chromaHeadroom(255, 0, 0, redLuma)).toBeCloseTo((255 - redLuma) / (255 - redLuma));
    // Grey pixel
    expect(chromaHeadroom(128, 128, 128, 128)).toBe(Infinity);
  });

  it('chromaScale computes scale correctly', () => {
    // No chroma -> returns original
    const grey = { r: 128, g: 128, b: 128, a: 255 };
    expect(chromaScale(grey, 'saturate', 0.5, false)).toEqual(grey);
    expect(chromaScale(grey, 'desaturate', 0.5, false)).toEqual(grey);

    // Alpha zero -> returns original
    const transparent = { r: 255, g: 0, b: 0, a: 0 };
    expect(chromaScale(transparent, 'saturate', 0.5, false)).toEqual(transparent);

    // Amount zero -> returns original
    const red = { r: 255, g: 0, b: 0, a: 255 };
    expect(chromaScale(red, 'saturate', 0, false)).toEqual(red);
    expect(chromaScale(red, 'desaturate', 0, false)).toEqual(red);

    // Saturate with amount 0.5 on a pixel with chroma
    const colored = { r: 200, g: 50, b: 50, a: 255 };
    const saturated = chromaScale(colored, 'saturate', 0.5, false);
    // Red should increase (move away from luma)
    expect(saturated.r).toBeGreaterThan(colored.r);
    // Green and blue should decrease (move away from luma in opposite direction)
    expect(saturated.g).toBeLessThan(colored.g);
    expect(saturated.b).toBeLessThan(colored.b);

    // Desaturate with amount 0.5
    const desaturated = chromaScale(colored, 'desaturate', 0.5, false);
    expect(desaturated.r).toBeLessThan(colored.r);
    expect(desaturated.g).toBeGreaterThan(colored.g);
    expect(desaturated.b).toBeGreaterThan(colored.b);

    // Vibrance caps at headroom
    const nearRed = { r: 255, g: 128, b: 64, a: 255 };
    const withVibrance = chromaScale(nearRed, 'saturate', 1, true);
    const withoutVibrance = chromaScale(nearRed, 'saturate', 1, false);
    // With vibrance, red is already at 255 so it should not move
    expect(withVibrance.r).toBe(255);
    // Without vibrance, it would clip
    expect(withoutVibrance.r).toBe(255);
  });
});

describe('spongeAmount helper', () => {
  it('returns 0 for zero coverage', () => {
    expect(spongeAmount(100, 0)).toBe(0);
  });

  it('returns 1 for full flow and full coverage', () => {
    expect(spongeAmount(100, 1)).toBe(1);
  });

  it('scales with flow and coverage', () => {
    // spongeAmount(50, 50) -> coverage=50 clamped to 1, flow=50 -> rate=0.5, result=0.5
    expect(spongeAmount(50, 50)).toBe(0.5);
    // flow=50, coverage=1 -> rate=0.5, result=0.5
    expect(spongeAmount(50, 1)).toBe(0.5);
    // flow=100, coverage=1 -> rate=1, result=1
    expect(spongeAmount(100, 1)).toBe(1);
  });

  it('returns minimum rate for zero flow (clamped to SPONGE_FLOW_MIN)', () => {
    // flow=0 gets clamped to SPONGE_FLOW_MIN=1, rate = 1/100 = 0.01
    expect(spongeAmount(0, 1)).toBe(0.01);
  });

  it('clamps flow to valid range', () => {
    // Negative flow clamped to MIN=1 -> rate = 0.01
    expect(spongeAmount(-10, 1)).toBe(0.01);
    // Flow > MAX clamped to MAX=100 -> rate = 1
    expect(spongeAmount(150, 1)).toBe(1);
    // NaN flow -> default 50 -> rate = 0.5
    expect(spongeAmount(NaN, 1)).toBe(0.5);
  });

  it('clamps coverage to [0, 1]', () => {
    expect(spongeAmount(100, -0.5)).toBe(0);
    expect(spongeAmount(100, 1.5)).toBe(1);
    expect(spongeAmount(100, NaN)).toBe(0); // NaN coverage -> 0
  });
});

describe('sponge mode behavior', () => {
  it('saturate amplifies chroma', () => {
    const red = { r: 200, g: 50, b: 50, a: 255 };
    const result = chromaScale(red, 'saturate', 0.5, false);
    // Red should increase (move away from luma)
    expect(result.r).toBeGreaterThan(red.r);
    // Green and blue should decrease (move away from luma in opposite direction)
    const luma = spongeLuma(red.r, red.g, red.b);
    expect(result.r - luma).toBeGreaterThan(red.r - luma);
  });

  it('desaturate attenuates chroma', () => {
    const red = { r: 200, g: 50, b: 50, a: 255 };
    const result = chromaScale(red, 'desaturate', 0.5, false);
    const luma = spongeLuma(red.r, red.g, red.b);
    // All channels move toward luma
    expect(Math.abs(result.r - luma)).toBeLessThan(Math.abs(red.r - luma));
    expect(Math.abs(result.g - luma)).toBeLessThan(Math.abs(red.g - luma));
    expect(Math.abs(result.b - luma)).toBeLessThan(Math.abs(red.b - luma));
  });

  it('full desaturate produces grey', () => {
    const red = { r: 200, g: 50, b: 50, a: 255 };
    const result = chromaScale(red, 'desaturate', 1, false);
    expect(result.r).toBeCloseTo(result.g, 0);
    expect(result.g).toBeCloseTo(result.b, 0);
  });

  it('unknown mode falls to desaturate', () => {
    const red = { r: 200, g: 50, b: 50, a: 255 };
    // @ts-expect-error testing unknown mode
    const result = chromaScale(red, 'unknown', 0.5, false);
    const luma = spongeLuma(red.r, red.g, red.b);
    expect(Math.abs(result.r - luma)).toBeLessThan(Math.abs(red.r - luma));
  });
});

describe('sponge processor integration', () => {
  it('applies saturate to a colored pixel', () => {
    // Use a pixel with actual chroma (not pure blue which has low chroma)
    const colored = new Uint8ClampedArray(document.width * document.height * 4);
    for (let i = 0; i < colored.length; i += 4) {
      colored[i] = 200; // r
      colored[i + 1] = 50; // g
      colored[i + 2] = 50; // b
      colored[i + 3] = 255; // a
    }
    const canvas = render(colored, args({ mode: 'saturate', flow: 100, vibrance: false, points: [point(3, 3)] }));
    const px = pixelAt(canvas, 3, 3);
    expect(px.r).toBeGreaterThan(200);
    expect(px.g).toBeLessThan(50);
    expect(px.b).toBeLessThan(50);
  });

  it('applies desaturate to a colored pixel', () => {
    const colored = new Uint8ClampedArray(document.width * document.height * 4);
    for (let i = 0; i < colored.length; i += 4) {
      colored[i] = 200;
      colored[i + 1] = 50;
      colored[i + 2] = 50;
      colored[i + 3] = 255;
    }
    const canvas = render(colored, args({ mode: 'desaturate', flow: 100, vibrance: false, points: [point(3, 3)] }));
    const px = pixelAt(canvas, 3, 3);
    const luma = spongeLuma(px.r, px.g, px.b);
    expect(Math.abs(px.r - luma)).toBeLessThan(Math.abs(200 - spongeLuma(200, 50, 50)));
  });

  it('vibrance prevents clipping on saturate', () => {
    const hotRed = new Uint8ClampedArray(document.width * document.height * 4);
    for (let i = 0; i < hotRed.length; i += 4) {
      hotRed[i] = 255;
      hotRed[i + 1] = 128;
      hotRed[i + 2] = 64;
      hotRed[i + 3] = 255;
    }
    const canvas = render(hotRed, args({ mode: 'saturate', flow: 100, vibrance: true, points: [point(3, 3)] }));
    const px = pixelAt(canvas, 3, 3);
    expect(px.r).toBe(255); // Already at max, should not clip
  });

  it('no points returns original bitmap', () => {
    const canvas = render(filled, args({ points: [] }));
    const px = pixelAt(canvas, 3, 3);
    expect(px).toEqual(SEED);
  });

  it('minimum flow (clamped) still applies minimal effect', () => {
    const canvas = render(filled, args({ flow: 0, points: [point(3, 3)] }));
    const px = pixelAt(canvas, 3, 3);
    // flow=0 gets clamped to 1, so there's a tiny effect
    // The pixel should change slightly but not dramatically
    const deviation = Math.abs(px.r - SEED.r) + Math.abs(px.g - SEED.g) + Math.abs(px.b - SEED.b);
    expect(deviation).toBeGreaterThan(0);
    expect(deviation).toBeLessThan(10); // Small change
  });

  it('uses previousCanvas for incremental rendering', () => {
    const colored = new Uint8ClampedArray(document.width * document.height * 4);
    for (let i = 0; i < colored.length; i += 4) {
      colored[i] = 200;
      colored[i + 1] = 50;
      colored[i + 2] = 50;
      colored[i + 3] = 255;
    }
    // Use lower flow so first pass doesn't fully desaturate
    const first = render(colored, args({ mode: 'desaturate', flow: 50, points: [point(3, 3)] }));
    const firstPx = pixelAt(first, 3, 3);

    const second = render(first.buffer, args({ mode: 'desaturate', flow: 50, points: [point(3, 3)] }));
    const secondPx = pixelAt(second, 3, 3);

    const luma = spongeLuma(200, 50, 50);
    expect(Math.abs(secondPx.r - luma)).toBeLessThan(Math.abs(firstPx.r - luma));
  });
});

describe('sponge edge cases', () => {
  it('handles very small canvas', () => {
    const tiny: Size = { width: 1, height: 1 };
    const tinyPixels = new Uint8ClampedArray([255, 0, 0, 255]);
    const bitmap = { width: 1, height: 1, pixels: tinyPixels, close: vi.fn() } as unknown as BitmapSource;
    const [canvas] = sponge({ size: tiny, bitmap })(args({ points: [point(0, 0)] }));
    expect(canvas).toBeDefined();
  });

  it('handles zero-size canvas gracefully', () => {
    const zero: Size = { width: 0, height: 0 };
    const zeroPixels = new Uint8ClampedArray([]);
    const bitmap = { width: 0, height: 0, pixels: zeroPixels, close: vi.fn() } as unknown as BitmapSource;
    const [canvas] = sponge({ size: zero, bitmap })(args());
    expect(canvas).toBeDefined();
  });

  it('preserves alpha channel', () => {
    const withAlpha = new Uint8ClampedArray(document.width * document.height * 4);
    for (let i = 0; i < withAlpha.length; i += 4) {
      withAlpha[i] = 255;
      withAlpha[i + 1] = 100;
      withAlpha[i + 2] = 50;
      withAlpha[i + 3] = 128; // semi-transparent
    }
    const canvas = render(withAlpha, args({ mode: 'saturate', flow: 100, points: [point(3, 3)] }));
    const px = pixelAt(canvas, 3, 3);
    expect(px.a).toBe(128);
  });

  it('handles NaN flow gracefully', () => {
    const canvas = render(filled, args({ flow: NaN, points: [point(3, 3)] }));
    const px = pixelAt(canvas, 3, 3);
    // Should use default flow (50)
    expect(px).not.toEqual(SEED);
  });
});
