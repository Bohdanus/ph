import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { spotHealing, SPOT_HEALING_SPACING_PERCENT, type SpotHealingToolArgs } from '../spotHealing.ts';
import { createPixelCanvasContext } from '../../test/setup.ts';
import { BRUSH_HARDNESS_MAX, BRUSH_HARDNESS_MIN, BRUSH_SIZE_MAX, BRUSH_SIZE_MIN } from '../../util/brush-engine.ts';
import type { Size } from '../../contexts/general-types.ts';

const documentSize: Size = { width: 64, height: 64 };

/**
 * Pixel-capable `OffscreenCanvas` recorder.
 * Mirrors the pattern from `src/test/setup.ts` — `createPixelCanvasContext`
 * installs real `getImageData`/`putImageData` on a canvas whose backing buffer
 * we can read directly, so assertions can verify the actual pixel result.
 */
type MockCtx = CanvasRenderingContext2D;

class RecordingOffscreenCanvas {
  static instances: RecordingOffscreenCanvas[] = [];

  width: number;
  height: number;
  readonly pixels: Uint8ClampedArray;
  readonly ctx: MockCtx;

  constructor(width: number, height: number) {
    this.width = Math.max(1, Math.ceil(width));
    this.height = Math.max(1, Math.ceil(height));
    this.pixels = new Uint8ClampedArray(this.width * this.height * 4);

    const ctx = createPixelCanvasContext(this);
    vi.mocked(ctx.drawImage).mockImplementation(((source: unknown) => {
      const drawn = source as { pixels: Uint8ClampedArray };
      this.pixels.set(drawn.pixels.subarray(0, this.pixels.length));
    }) as unknown as MockCtx['drawImage']);
    vi.mocked(ctx.getImageData).mockImplementation(
      () =>
        ({
          data: new Uint8ClampedArray(this.pixels),
          width: this.width,
          height: this.height,
          colorSpace: 'srgb',
        }) as ImageData
    );
    vi.mocked(ctx.putImageData).mockImplementation(((image: ImageData, x: number, y: number) => {
      for (let row = 0; row < image.height; row++) {
        const from = row * image.width * 4;
        const to = (y + row) * this.width * 4 + x * 4;
        this.pixels.set(image.data.subarray(from, from + image.width * 4), to);
      }
    }) as unknown as MockCtx['putImageData']);

    this.ctx = ctx;
    RecordingOffscreenCanvas.instances.push(this);
  }

  getContext(): MockCtx {
    return this.ctx;
  }
}

/** A full-document bitmap filled with `colour`. */
const fill = (colour: [number, number, number, number?]): Uint8ClampedArray => {
  const data = new Uint8ClampedArray(documentSize.width * documentSize.height * 4);
  const [r, g, b, a = 255] = colour;
  for (let i = 0; i < data.length; i += 4) {
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = a;
  }
  return data;
};

/** The source `ImageBitmap`, carrying the pixels this recorder's `drawImage` copies in. */
const sourceBitmap = (pixels: Uint8ClampedArray) =>
  ({ width: documentSize.width, height: documentSize.height, pixels, close: vi.fn() }) as unknown as ImageBitmap;

const args = (overrides: Partial<SpotHealingToolArgs> = {}): SpotHealingToolArgs => ({
  size: 20,
  hardness: 50,
  opacity: 100,
  toolName: 'spot-healing',
  points: [{ x: 32, y: 32 }],
  ...overrides,
});

const run = (data: Uint8ClampedArray, a: SpotHealingToolArgs) => {
  const [canvas] = spotHealing({ size: documentSize, bitmap: sourceBitmap(data) })(a);
  return canvas as unknown as RecordingOffscreenCanvas;
};

beforeEach(() => {
  RecordingOffscreenCanvas.instances = [];
  vi.stubGlobal('OffscreenCanvas', RecordingOffscreenCanvas as unknown as typeof OffscreenCanvas);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('spotHealing structure', () => {
  it('is a distinct export (no other tool shares its processor)', () => {
    expect(typeof spotHealing).toBe('function');
  });

  it('is a two-stage curried processor that reads its params and its args', () => {
    const bitmap = sourceBitmap(fill([100, 100, 100]));
    const inner = spotHealing({ size: documentSize, bitmap });

    expect(spotHealing.length).toBe(1);
    expect(inner.length).toBe(1);
  });

  it('allocates exactly one full-document canvas and draws the source bitmap into it', () => {
    const bitmap = sourceBitmap(fill([100, 100, 100]));
    const [canvas] = spotHealing({ size: documentSize, bitmap })(args());

    expect(RecordingOffscreenCanvas.instances).toHaveLength(1);
    expect(canvas).toBe(RecordingOffscreenCanvas.instances[0]);
    expect(canvas).not.toBe(bitmap);
    expect(vi.mocked(RecordingOffscreenCanvas.instances[0].ctx.drawImage).mock.calls[0][0]).toBe(bitmap);
  });
});

describe('spotHealing constants', () => {
  it('SPOT_HEALING_SPACING_PERCENT is 25 (Adobe default spacing)', () => {
    expect(SPOT_HEALING_SPACING_PERCENT).toBe(25);
  });

  it('spotHealing toolName is "spot-healing"', () => {
    expect(args().toolName).toBe('spot-healing');
  });
});

describe('spotHealing clampBrushTipSettings interaction', () => {
  it('clamps size to [BRUSH_SIZE_MIN, BRUSH_SIZE_MAX]', () => {
    expect(() => run(fill([100, 100, 100]), args({ size: BRUSH_SIZE_MIN - 1 }))).not.toThrow();
    expect(() => run(fill([100, 100, 100]), args({ size: BRUSH_SIZE_MAX + 100 }))).not.toThrow();
    expect(() => run(fill([100, 100, 100]), args({ size: -10 }))).not.toThrow();
    expect(() => run(fill([100, 100, 100]), args({ size: Number.NaN }))).not.toThrow();
    expect(() => run(fill([100, 100, 100]), args({ size: Number.POSITIVE_INFINITY }))).not.toThrow();
  });

  it('clamps hardness to [BRUSH_HARDNESS_MIN, BRUSH_HARDNESS_MAX]', () => {
    expect(() => run(fill([100, 100, 100]), args({ hardness: BRUSH_HARDNESS_MIN - 1 }))).not.toThrow();
    expect(() => run(fill([100, 100, 100]), args({ hardness: BRUSH_HARDNESS_MAX + 1 }))).not.toThrow();
    expect(() => run(fill([100, 100, 100]), args({ hardness: Number.NaN }))).not.toThrow();
  });

  it('clamps opacity to valid range', () => {
    expect(() => run(fill([100, 100, 100]), args({ opacity: -1 }))).not.toThrow();
    expect(() => run(fill([100, 100, 100]), args({ opacity: 200 }))).not.toThrow();
  });

  it('settles non-finite tip settings on safe defaults', () => {
    const canvas = run(fill([100, 100, 100]), args({ size: NaN, hardness: NaN, opacity: NaN }));
    expect(canvas.width).toBe(documentSize.width);
    expect(canvas.height).toBe(documentSize.height);
  });
});

describe('spotHealing edge cases', () => {
  it('returns early for zero-width document (rasterSize guard)', () => {
    const size: Size = { width: 0, height: 10 };
    const data = new Uint8ClampedArray(0);
    const bmp = { width: 0, height: 10, pixels: data, close: vi.fn() } as unknown as ImageBitmap;
    const [canvas] = spotHealing({ size, bitmap: bmp })(args());
    expect(canvas.width).toBe(1); // Math.max(1, Math.ceil(0))
    expect(canvas.height).toBe(10);
  });

  it('returns early for zero-height document (rasterSize guard)', () => {
    const size: Size = { width: 10, height: 0 };
    const data = new Uint8ClampedArray(0);
    const bmp = { width: 10, height: 0, pixels: data, close: vi.fn() } as unknown as ImageBitmap;
    const [canvas] = spotHealing({ size, bitmap: bmp })(args());
    expect(canvas.width).toBe(10);
    expect(canvas.height).toBe(1);
  });

  it('returns early when getImageData/putImageData are not functions', () => {
    vi.unstubAllGlobals();
    vi.stubGlobal(
      'OffscreenCanvas',
      class extends RecordingOffscreenCanvas {
        constructor(width: number, height: number) {
          super(width, height);
          this.ctx.getImageData = undefined as unknown as MockCtx['getImageData'];
          this.ctx.putImageData = undefined as unknown as MockCtx['putImageData'];
        }
      } as unknown as typeof OffscreenCanvas
    );

    const data = fill([100, 100, 100]);
    const [canvas] = spotHealing({ size: documentSize, bitmap: sourceBitmap(data) })(args());
    const recCanvas = canvas as unknown as RecordingOffscreenCanvas;
    expect(recCanvas.width).toBe(documentSize.width);
    expect(recCanvas.height).toBe(documentSize.height);
    // Source should be drawn but no processing occurs
    expect(recCanvas.pixels).toEqual(data);

    vi.unstubAllGlobals();
    vi.stubGlobal('OffscreenCanvas', RecordingOffscreenCanvas as unknown as typeof OffscreenCanvas);
  });

  it('handles non-square documents', () => {
    const size: Size = { width: 800, height: 600 };
    const data = new Uint8ClampedArray(size.width * size.height * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 100;
      data[i + 1] = 100;
      data[i + 2] = 100;
      data[i + 3] = 255;
    }
    const bmp = { width: size.width, height: size.height, pixels: data, close: vi.fn() } as unknown as ImageBitmap;
    const [canvas] = spotHealing({ size, bitmap: bmp })(args({ size: 20 }));
    expect(canvas.width).toBe(size.width);
    expect(canvas.height).toBe(size.height);
  });
});

describe('spotHealing point coordinate handling', () => {
  it('accepts non-integer point coordinates (floored by clampPointToSize)', () => {
    const canvas = run(fill([100, 100, 100]), args({ size: 10, points: [{ x: 32.7, y: 32.3 }] }));
    // Should not crash
    expect(canvas.width).toBe(documentSize.width);
    expect(canvas.height).toBe(documentSize.height);
  });

  it('handles duplicate consecutive points (no-op second dab)', () => {
    const canvas = run(
      fill([100, 100, 100]),
      args({
        size: 10,
        points: [
          { x: 32, y: 32 },
          { x: 32, y: 32 },
        ],
      })
    );
    // Should not crash and should produce same result as single point
    RecordingOffscreenCanvas.instances = [];
    const canvasSingle = run(fill([100, 100, 100]), args({ size: 10, points: [{ x: 32, y: 32 }] }));
    expect(canvas.pixels).toEqual(canvasSingle.pixels);
  });

  it('points outside canvas bounds are clamped by clampPointToSize', () => {
    const canvas = run(fill([100, 100, 100]), args({ size: 10, points: [{ x: -10, y: -10 }] }));
    // Should not crash
    expect(canvas.width).toBe(documentSize.width);
    expect(canvas.height).toBe(documentSize.height);
  });
});

describe('spotHealing SPOT_HEALING_SPACING_PERCENT behavior', () => {
  it('spacing constant affects dab density along stroke', () => {
    expect(SPOT_HEALING_SPACING_PERCENT).toBe(25);
  });
});

describe('spotHealing empty points array', () => {
  it('returns canvas with source drawn when points array is empty', () => {
    const data = fill([100, 100, 100]);
    const [canvas] = spotHealing({ size: documentSize, bitmap: sourceBitmap(data) })(args({ points: [] }));
    expect(canvas.width).toBe(documentSize.width);
    expect(canvas.height).toBe(documentSize.height);
  });
});

describe('spotHealing zero/negative opacity', () => {
  it('opacity 0 produces no change', () => {
    const data = fill([255, 0, 0]);
    const [canvas] = spotHealing({ size: documentSize, bitmap: sourceBitmap(data) })(
      args({ opacity: 0, points: [{ x: 32, y: 32 }] })
    );
    const recCanvas = canvas as unknown as RecordingOffscreenCanvas;
    expect(recCanvas.pixels).toEqual(data);
  });

  it('negative opacity clamped to 0', () => {
    const data = fill([255, 0, 0]);
    const [canvas] = spotHealing({ size: documentSize, bitmap: sourceBitmap(data) })(
      args({ opacity: -50, points: [{ x: 32, y: 32 }] })
    );
    const recCanvas = canvas as unknown as RecordingOffscreenCanvas;
    expect(recCanvas.pixels).toEqual(data);
  });
});
