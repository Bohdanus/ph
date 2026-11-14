import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { blur, type BlurToolArgs } from '../blur.ts';
import { createMockImageBitmap } from '../../__tests__/fixtures/canvas.ts';
import type { BitmapSource } from '../../contexts/general-types.ts';

/** Minimal fake canvas for observing the filter and source draw call. */
class PixelOffscreenCanvas {
  static instances: PixelOffscreenCanvas[] = [];

  readonly ctx = {
    drawImage: vi.fn(),
    filter: '',
  };

  readonly width: number;
  readonly height: number;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
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
    PixelOffscreenCanvas.instances = [];
    vi.stubGlobal('OffscreenCanvas', PixelOffscreenCanvas as unknown as typeof OffscreenCanvas);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns a fresh layer-sized canvas with blur filter applied', () => {
    const [result] = blur({ size, bitmap })({ radius: 5, toolName: 'blur' } satisfies BlurToolArgs);

    const canvas = result as unknown as PixelOffscreenCanvas;
    expect(canvas).not.toBe(bitmap);
    expect(canvas.width).toBe(size.width);
    expect(canvas.height).toBe(size.height);
    expect(canvas.ctx.filter).toBe('blur(5px)');
    expect(canvas.ctx.drawImage).toHaveBeenCalledWith(bitmap, 0, 0);
  });

  it('applies the correct radius to the filter', () => {
    const [result] = blur({ size, bitmap })({ radius: 10, toolName: 'blur' } satisfies BlurToolArgs);

    const canvas = result as unknown as PixelOffscreenCanvas;
    expect(canvas.ctx.filter).toBe('blur(10px)');
  });

  it('throws when the source bitmap is missing', () => {
    expect(() =>
      blur({ size, bitmap: undefined as unknown as BitmapSource })({
        radius: 5,
        toolName: 'blur',
      })
    ).toThrow('Blur tool requires a source bitmap');
  });
});
describe('BlurToolArgs type', () => {
  it('requires radius and toolName', () => {
    const args: BlurToolArgs = { radius: 5, toolName: 'blur' };
    expect(args.radius).toBe(5);
    expect(args.toolName).toBe('blur');
  });
});
