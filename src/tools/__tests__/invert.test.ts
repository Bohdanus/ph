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
});
