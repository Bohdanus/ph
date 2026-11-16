import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { invert, invertPixels, type InvertToolArgs } from '../invert.ts';
import { createMockImageBitmap } from '../../__tests__/fixtures/canvas.ts';
import type { BitmapSource } from '../../contexts/general-types.ts';

const pixels = (...rgba: number[]) => new Uint8ClampedArray(rgba);

describe('invertPixels', () => {
  it("maps each colour channel onto Adobe's inverse — 255 to 0 and 5 to 250 — and leaves alpha alone", () => {
    const data = pixels(255, 5, 128, 200, 0, 250, 127, 0);

    invertPixels(data, null);

    expect([...data]).toEqual([0, 250, 127, 200, 255, 5, 128, 0]);
  });

  it('is its own inverse, so inverting twice restores every byte', () => {
    const original = pixels(12, 34, 56, 78, 255, 0, 200, 255);
    const data = original.slice();

    invertPixels(data, null);
    invertPixels(data, null);

    expect(data).toEqual(original);
  });

  it('inverts only covered pixels, and blends a partially covered one by its coverage', () => {
    const data = pixels(200, 100, 0, 255, 200, 100, 0, 255, 200, 100, 0, 255);
    const mask = new Uint8Array([255, 0, 128]);

    invertPixels(data, mask);

    expect([...data.subarray(0, 4)]).toEqual([55, 155, 255, 255]);
    expect([...data.subarray(4, 8)]).toEqual([200, 100, 0, 255]);
    // 128/255 of the way from each value to its inverse.
    expect([...data.subarray(8, 12)]).toEqual([127, 128, 128, 255]);
  });

  it('handles empty data array', () => {
    const data = pixels();
    expect(() => invertPixels(data, null)).not.toThrow();
    expect(data).toEqual(pixels());
  });

  it('handles single pixel', () => {
    const data = pixels(100, 150, 200, 255);
    invertPixels(data, null);
    expect([...data]).toEqual([155, 105, 55, 255]);
  });

  it('handles zero coverage correctly', () => {
    const data = pixels(200, 100, 0, 255);
    const mask = new Uint8Array([0]);
    invertPixels(data, mask);
    expect([...data]).toEqual([200, 100, 0, 255]);
  });

  it('handles full coverage (255)', () => {
    const data = pixels(200, 100, 0, 255);
    const mask = new Uint8Array([255]);
    invertPixels(data, mask);
    expect([...data]).toEqual([55, 155, 255, 255]);
  });

  it('handles alpha channel untouched at various coverages', () => {
    const data = pixels(100, 100, 100, 128);
    const mask = new Uint8Array([128]);
    invertPixels(data, mask);
    expect(data[3]).toBe(128);
  });

  it('inverts each channel independently', () => {
    const data = pixels(10, 20, 30, 255);
    invertPixels(data, null);
    expect([...data]).toEqual([245, 235, 225, 255]);
  });

  it('works with odd number of pixels', () => {
    const data = pixels(100, 100, 100, 255, 50, 50, 50, 255, 200, 200, 200, 255);
    const mask = new Uint8Array([255, 128, 0]);
    invertPixels(data, mask);
    expect([...data.subarray(0, 4)]).toEqual([155, 155, 155, 255]);
    // 50 + (255-100)*0.5 = 50 + 77.5 = 127.5 -> 128 (rounded)
    expect([...data.subarray(4, 8)]).toEqual([128, 128, 128, 255]);
    expect([...data.subarray(8, 12)]).toEqual([200, 200, 200, 255]);
  });
});

/**
 * A canvas whose read-back is a real buffer, since the global stub has no `getImageData`. Only the
 * first canvas — the processor's output — gets a context; the selection-mask canvas gets none and
 * falls back to the CPU rasterizer, as in `fill.test.ts`.
 */
class PixelOffscreenCanvas {
  static seed = new Uint8ClampedArray();
  static instances: PixelOffscreenCanvas[] = [];

  buffer: Uint8ClampedArray;
  readonly ctx = {
    drawImage: vi.fn(),
    getImageData: vi.fn(() => ({ data: this.buffer.slice(), width: this.width, height: this.height })),
    putImageData: vi.fn((imageData: { data: Uint8ClampedArray }) => this.buffer.set(imageData.data)),
  };

  readonly width: number;
  readonly height: number;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.buffer = PixelOffscreenCanvas.seed.slice();
    PixelOffscreenCanvas.instances.push(this);
  }

  getContext() {
    return PixelOffscreenCanvas.instances[0] === this ? this.ctx : null;
  }
}

describe('invert processor', () => {
  const size = { width: 2, height: 1 };
  const bitmap = createMockImageBitmap(size.width, size.height) as unknown as BitmapSource;

  beforeEach(() => {
    PixelOffscreenCanvas.seed = pixels(10, 20, 30, 255, 40, 50, 60, 255);
    PixelOffscreenCanvas.instances = [];
    vi.stubGlobal('OffscreenCanvas', PixelOffscreenCanvas as unknown as typeof OffscreenCanvas);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns a fresh layer-sized canvas holding the whole layer inverted', () => {
    const [result] = invert({ size, bitmap })({ toolName: 'invert' } satisfies InvertToolArgs);

    expect([...(result as unknown as PixelOffscreenCanvas).buffer]).toEqual([245, 235, 225, 255, 215, 205, 195, 255]);
  });

  it('clips the inversion to the stored selection, read from the args alone', () => {
    const args: InvertToolArgs = {
      toolName: 'invert',
      selection: {
        points: [
          [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
            { x: 1, y: 1 },
            { x: 0, y: 1 },
          ],
        ],
        featherRadius: 0,
        antiAlias: false,
      },
    };

    const [result] = invert({ size, bitmap })(args);

    expect([...(result as unknown as PixelOffscreenCanvas).buffer]).toEqual([245, 235, 225, 255, 40, 50, 60, 255]);
  });

  it('returns an empty canvas when there is no source bitmap to invert', () => {
    const [result] = invert({ size })({ toolName: 'invert' } satisfies InvertToolArgs);

    expect(result).toBe(PixelOffscreenCanvas.instances[0]);
    expect(PixelOffscreenCanvas.instances[0].ctx.getImageData).not.toHaveBeenCalled();
  });

  it('handles selection with featherRadius', () => {
    const args: InvertToolArgs = {
      toolName: 'invert',
      selection: {
        points: [
          [
            { x: 0, y: 0 },
            { x: 2, y: 0 },
            { x: 2, y: 1 },
            { x: 0, y: 1 },
          ],
        ],
        featherRadius: 1,
        antiAlias: true,
      },
    };

    const [result] = invert({ size: { width: 4, height: 2 }, bitmap })(args);
    // Just verify it doesn't throw and produces a canvas
    expect(result).toBeDefined();
    expect((result as unknown as PixelOffscreenCanvas).buffer).toBeDefined();
  });

  it('handles selection with antiAlias false', () => {
    const args: InvertToolArgs = {
      toolName: 'invert',
      selection: {
        points: [
          [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
            { x: 1, y: 1 },
            { x: 0, y: 1 },
          ],
        ],
        featherRadius: 0,
        antiAlias: false,
      },
    };

    const [result] = invert({ size, bitmap })(args);
    expect(result).toBeDefined();
  });

  it('handles rasterMask in selection', () => {
    const args: InvertToolArgs = {
      toolName: 'invert',
      selection: {
        points: [[]],
        rasterMask: {
          width: 2,
          height: 1,
          x: 0,
          y: 0,
          // Base64 encoded Uint8Array([255, 0]) = "APA="
          data: 'APA=',
        },
        featherRadius: 0,
        antiAlias: false,
      },
    };

    const [result] = invert({ size, bitmap })(args);
    expect(result).toBeDefined();
  });

  it('handles CreatorToolParams (no bitmap)', () => {
    const [result] = invert({ size })({ toolName: 'invert' } satisfies InvertToolArgs);
    expect(result).toBe(PixelOffscreenCanvas.instances[0]);
  });

  it('allocates canvas with correct dimensions', () => {
    const sizes = [
      { width: 10, height: 10 },
      { width: 100, height: 50 },
      { width: 1920, height: 1080 },
    ];
    for (const s of sizes) {
      PixelOffscreenCanvas.instances = [];
      const bmp = createMockImageBitmap(s.width, s.height) as unknown as BitmapSource;
      const [canvas] = invert({ size: s, bitmap: bmp })({ toolName: 'invert' } satisfies InvertToolArgs);
      expect((canvas as unknown as PixelOffscreenCanvas).width).toBe(s.width);
      expect((canvas as unknown as PixelOffscreenCanvas).height).toBe(s.height);
    }
  });

  it('draws source bitmap at (0, 0) with full size', () => {
    invert({ size, bitmap })({ toolName: 'invert' } satisfies InvertToolArgs);
    const canvas = PixelOffscreenCanvas.instances[0];
    const ctx = canvas.ctx;
    expect(ctx.drawImage).toHaveBeenCalledWith(bitmap, 0, 0, size.width, size.height);
  });

  it('reads full image data from canvas', () => {
    invert({ size, bitmap })({ toolName: 'invert' } satisfies InvertToolArgs);
    const ctx = PixelOffscreenCanvas.instances[0].ctx;
    expect(ctx.getImageData).toHaveBeenCalledWith(0, 0, size.width, size.height);
  });

  it('writes inverted data back to canvas', () => {
    invert({ size, bitmap })({ toolName: 'invert' } satisfies InvertToolArgs);
    const ctx = PixelOffscreenCanvas.instances[0].ctx;
    expect(ctx.putImageData).toHaveBeenCalled();
  });
});

describe('InvertToolArgs type', () => {
  it('requires toolName "invert"', () => {
    const args: InvertToolArgs = { toolName: 'invert' };
    expect(args.toolName).toBe('invert');
    // @ts-expect-error toolName must be 'invert'
    const invalid: InvertToolArgs = { toolName: 'other' };
  });

  it('accepts optional selection with points', () => {
    const args: InvertToolArgs = {
      toolName: 'invert',
      selection: {
        points: [
          [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
            { x: 0, y: 10 },
          ],
        ],
        featherRadius: 0,
        antiAlias: false,
      },
    };
    expect(args.selection).toBeDefined();
    expect(args.selection?.points).toHaveLength(1);
  });

  it('accepts optional selection with rasterMask', () => {
    const args: InvertToolArgs = {
      toolName: 'invert',
      selection: {
        points: [[]],
        // Base64 encoded 100-byte Uint8Array (10x10 mask)
        rasterMask: {
          width: 10,
          height: 10,
          x: 0,
          y: 0,
          data: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==',
        },
        featherRadius: 0,
        antiAlias: false,
      },
    };
    expect(args.selection?.rasterMask).toBeDefined();
  });

  it('selection has featherRadius and antiAlias', () => {
    const args: InvertToolArgs = {
      toolName: 'invert',
      selection: {
        points: [
          [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
            { x: 1, y: 1 },
            { x: 0, y: 1 },
          ],
        ],
        featherRadius: 5,
        antiAlias: true,
      },
    };
    expect(args.selection?.featherRadius).toBe(5);
    expect(args.selection?.antiAlias).toBe(true);
  });
});
