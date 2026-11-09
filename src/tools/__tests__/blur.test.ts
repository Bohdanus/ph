import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { blur, type BlurToolArgs } from '../blur.ts';
import { createMockImageBitmap } from '../../__tests__/fixtures/canvas.ts';
import type { BitmapSource } from '../../contexts/general-types.ts';

const pixels = (...rgba: number[]) => new Uint8ClampedArray(rgba);

/**
 * A canvas whose read-back is a real buffer. Only the first canvas — the processor's output —
 * gets a context; the selection-mask canvas gets none and falls back to the CPU rasterizer.
 */
class PixelOffscreenCanvas {
  static seed = new Uint8ClampedArray();
  static instances: PixelOffscreenCanvas[] = [];

  buffer: Uint8ClampedArray;
  readonly ctx = {
    drawImage: vi.fn(),
    filter: '',
    getImageData: vi.fn(function (this: PixelOffscreenCanvas) {
      return { data: this.buffer.slice(), width: this.width, height: this.height };
    }),
    putImageData: vi.fn(function (this: PixelOffscreenCanvas, imageData: { data: Uint8ClampedArray }) {
      this.buffer.set(imageData.data);
    }),
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

describe('blur processor', () => {
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

  it('returns a fresh layer-sized canvas with blur filter applied', () => {
    const [result] = blur({ size, bitmap })({ radius: 5, toolName: 'blur' } satisfies BlurToolArgs);

    const canvas = result as unknown as PixelOffscreenCanvas;
    expect(canvas.ctx.filter).toBe('blur(5px)');
    expect(canvas.ctx.drawImage).toHaveBeenCalledWith(bitmap, 0, 0);
  });

  it('applies the correct radius to the filter', () => {
    const [result] = blur({ size, bitmap })({ radius: 10, toolName: 'blur' } satisfies BlurToolArgs);

    const canvas = result as unknown as PixelOffscreenCanvas;
    expect(canvas.ctx.filter).toBe('blur(10px)');
  });

  it('calls drawImage even when there is no source bitmap (passes undefined)', () => {
    const [result] = blur({ size, bitmap: undefined as unknown as BitmapSource })({
      radius: 5,
      toolName: 'blur',
    } satisfies BlurToolArgs);

    expect(result).toBe(PixelOffscreenCanvas.instances[0]);
    expect(PixelOffscreenCanvas.instances[0].ctx.drawImage).toHaveBeenCalledWith(undefined, 0, 0);
  });
});

describe('BlurToolArgs type', () => {
  it('requires radius and toolName', () => {
    const args: BlurToolArgs = { radius: 5, toolName: 'blur' };
    expect(args.radius).toBe(5);
    expect(args.toolName).toBe('blur');
  });
});
