import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { colors, normalizeColorsToolArgs, type ColorsToolArgs } from '../colors.ts';
import { createMockImageBitmap } from '../../__tests__/fixtures/canvas.ts';
import type { BitmapSource } from '../../contexts/general-types.ts';

const pixels = (...rgba: number[]) => new Uint8ClampedArray(rgba);

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

const baseArgs: ColorsToolArgs = {
  grayscale: NaN,
  sepia: Infinity,
  saturation: -Infinity,
  toolName: 'color',
};

describe('normalizeColorsToolArgs', () => {
  it('returns neutral values for non-finite inputs', () => {
    const result = normalizeColorsToolArgs(baseArgs);
    expect(result.grayscale).toBe(0);
    expect(result.sepia).toBe(0);
    expect(result.saturation).toBe(0);
  });

  it('clamps grayscale to [0, 100]', () => {
    expect(normalizeColorsToolArgs({ ...baseArgs, grayscale: -10 }).grayscale).toBe(0);
    expect(normalizeColorsToolArgs({ ...baseArgs, grayscale: 50 }).grayscale).toBe(50);
    expect(normalizeColorsToolArgs({ ...baseArgs, grayscale: 150 }).grayscale).toBe(100);
  });

  it('clamps sepia to [0, 100]', () => {
    expect(normalizeColorsToolArgs({ ...baseArgs, sepia: -10 }).sepia).toBe(0);
    expect(normalizeColorsToolArgs({ ...baseArgs, sepia: 50 }).sepia).toBe(50);
    expect(normalizeColorsToolArgs({ ...baseArgs, sepia: 150 }).sepia).toBe(100);
  });

  it('does not clamp saturation (allows any finite value)', () => {
    expect(normalizeColorsToolArgs({ ...baseArgs, saturation: -100 }).saturation).toBe(-100);
    expect(normalizeColorsToolArgs({ ...baseArgs, saturation: 0 }).saturation).toBe(0);
    expect(normalizeColorsToolArgs({ ...baseArgs, saturation: 200 }).saturation).toBe(200);
  });

  it('preserves toolName', () => {
    const result = normalizeColorsToolArgs({ ...baseArgs, toolName: 'color' });
    expect(result.toolName).toBe('color');
  });
});

describe('colors processor', () => {
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

  it('returns a fresh layer-sized canvas with color filter applied', () => {
    const [result] = colors({ size, bitmap })({
      grayscale: 50,
      sepia: 0,
      saturation: 100,
      toolName: 'color',
    } satisfies ColorsToolArgs);

    const canvas = result as unknown as PixelOffscreenCanvas;
    expect(canvas.ctx.filter).toContain('grayscale(');
    expect(canvas.ctx.drawImage).toHaveBeenCalledWith(bitmap, 0, 0);
  });

  it('applies grayscale filter', () => {
    const [result] = colors({ size, bitmap })({
      grayscale: 100,
      sepia: 0,
      saturation: 100,
      toolName: 'color',
    } satisfies ColorsToolArgs);

    const canvas = result as unknown as PixelOffscreenCanvas;
    expect(canvas.ctx.filter).toContain('grayscale(100%)');
  });

  it('applies sepia filter', () => {
    const [result] = colors({ size, bitmap })({
      grayscale: 0,
      sepia: 100,
      saturation: 100,
      toolName: 'color',
    } satisfies ColorsToolArgs);

    const canvas = result as unknown as PixelOffscreenCanvas;
    expect(canvas.ctx.filter).toContain('sepia(100%)');
  });

  it('applies saturate filter', () => {
    const [result] = colors({ size, bitmap })({
      grayscale: 0,
      sepia: 0,
      saturation: 200,
      toolName: 'color',
    } satisfies ColorsToolArgs);

    const canvas = result as unknown as PixelOffscreenCanvas;
    expect(canvas.ctx.filter).toContain('saturate(');
  });
});

describe('ColorsToolArgs type', () => {
  it('requires grayscale, sepia, saturation, and toolName', () => {
    const typeArgs: ColorsToolArgs = { grayscale: 0, sepia: 0, saturation: 100, toolName: 'color' };
    expect(typeArgs.grayscale).toBe(0);
    expect(typeArgs.sepia).toBe(0);
    expect(typeArgs.saturation).toBe(100);
    expect(typeArgs.toolName).toBe('color');
  });
});
