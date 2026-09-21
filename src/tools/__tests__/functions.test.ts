import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { exp1_1, writeImageToCanvas } from '../functions.ts';

describe('exp1_1', () => {
  it('calculates exp(k * val/100) with default k=2', () => {
    expect(exp1_1(0)).toBe(Math.exp(0));
    expect(exp1_1(100)).toBeCloseTo(Math.exp(2), 5);
  });

  it('returns 1 when val is 0', () => {
    expect(exp1_1(0)).toBe(1);
  });

  it('supports a custom k parameter', () => {
    expect(exp1_1(100, 3)).toBeCloseTo(Math.exp(3), 5);
    expect(exp1_1(50, 1)).toBeCloseTo(Math.exp(0.5), 5);
  });

  it('returns values greater than 1 for positive inputs', () => {
    expect(exp1_1(10)).toBeGreaterThan(1);
    expect(exp1_1(100)).toBeGreaterThan(exp1_1(10));
  });
});

describe('writeImageToCanvas', () => {
  let mockCtx: CanvasRenderingContext2D;

  beforeEach(() => {
    const ctxObj = { canvas: null as HTMLCanvasElement | null, drawImage: vi.fn() };
    mockCtx = ctxObj as unknown as CanvasRenderingContext2D;
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
      ctxObj.canvas = this;
      return mockCtx;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sets canvas dimensions and draws the image', () => {
    const canvas = document.createElement('canvas');
    const image = { width: 200, height: 150 } as unknown as HTMLImageElement;
    const result = writeImageToCanvas(image, canvas);

    expect(canvas.width).toBe(200);
    expect(canvas.height).toBe(150);
    expect(mockCtx.drawImage).toHaveBeenCalledWith(image, 0, 0);
    expect(result).toBe(mockCtx);
  });

  it('invokes the resize callback with image dimensions', () => {
    const canvas = document.createElement('canvas');
    const callback = vi.fn();
    const image = { width: 300, height: 200 } as unknown as HTMLImageElement;

    writeImageToCanvas(image, canvas, callback);

    expect(callback).toHaveBeenCalledWith(300, 200);
  });

  it('does not throw when callback is omitted', () => {
    const canvas = document.createElement('canvas');
    const image = { width: 10, height: 10 } as unknown as HTMLImageElement;
    expect(() => writeImageToCanvas(image, canvas)).not.toThrow();
  });
});
