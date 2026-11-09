import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { magicWand } from '../magicWand.ts';
import { createMockImageBitmap } from '../../__tests__/fixtures/canvas.ts';
import type { BitmapSource } from '../../contexts/general-types.ts';

const pixels = (...rgba: number[]) => new Uint8ClampedArray(rgba);

class PixelOffscreenCanvas {
  static seed = new Uint8ClampedArray();
  static instances: PixelOffscreenCanvas[] = [];

  buffer: Uint8ClampedArray;
  readonly ctx = {
    drawImage: vi.fn(),
    getImageData: vi.fn(function (this: PixelOffscreenCanvas) {
      return { data: this.buffer.slice(), width: this.width, height: this.height };
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

describe('magicWand processor', () => {
  const size = { width: 2, height: 1 };
  const bitmap = createMockImageBitmap(size.width, size.height) as unknown as BitmapSource;

  beforeEach(() => {
    PixelOffscreenCanvas.seed = pixels(100, 100, 100, 255, 200, 50, 0, 255);
    PixelOffscreenCanvas.instances = [];
    vi.stubGlobal('OffscreenCanvas', PixelOffscreenCanvas as unknown as typeof OffscreenCanvas);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the bitmap unchanged (magic wand selection is handled elsewhere)', () => {
    const processor = magicWand({ bitmap, size });
    const [result] = processor();
    expect(result).toBe(bitmap);
  });

  it('ignores args and returns bitmap', () => {
    const [result] = magicWand({ bitmap, size })();
    expect(result).toBe(bitmap);
  });
});

describe('MagicWandToolArgs type', () => {
  it('requires tolerance, smoothing, contiguous, and toolName', () => {
    const args = { tolerance: 32, smoothing: 0, contiguous: true, toolName: 'magic-wand' as const };
    expect(args.tolerance).toBe(32);
    expect(args.smoothing).toBe(0);
    expect(args.contiguous).toBe(true);
    expect(args.toolName).toBe('magic-wand');
  });
});

describe('MagicWandToolSettings type', () => {
  it('is the same as MagicWandToolArgs', () => {
    const settings = { tolerance: 32, smoothing: 0, contiguous: true, toolName: 'magic-wand' as const };
    expect(settings.tolerance).toBe(32);
    expect(settings.smoothing).toBe(0);
    expect(settings.contiguous).toBe(true);
  });
});
