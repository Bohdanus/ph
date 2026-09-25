import { describe, expect, it, vi } from 'vitest';

import { transform, type TransformToolArgs } from '../transform.ts';
import type { ProcessorToolParams } from '../toolProcessors.ts';

class MockOffscreenCanvas {
  width: number;
  height: number;

  constructor(width: number, height: number) {
    this.width = Math.max(1, Math.ceil(width));
    this.height = Math.max(1, Math.ceil(height));
  }

  getContext() {
    return mockContext(this);
  }
}

const canvasContext: Record<string, unknown> = {};

function mockContext(canvas: MockOffscreenCanvas): CanvasRenderingContext2D {
  return {
    canvas: canvas as unknown as HTMLCanvasElement,
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    bezierCurveTo: vi.fn(),
    quadraticCurveTo: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    arc: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    setLineDash: vi.fn(),
    drawImage: vi.fn(),
    clip: vi.fn(),
    translate: vi.fn(),
    transform: vi.fn(),
    setTransform: vi.fn(),
    scale: vi.fn(),
    rotate: vi.fn(),
    createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 1,
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    imageSmoothingEnabled: true,
    imageSmoothingQuality: 'low',
  } as unknown as CanvasRenderingContext2D;
}

const drawImageSpy = vi.fn();
const translateSpy = vi.fn();
const rotateSpy = vi.fn();
const scaleSpy = vi.fn();
const transformSpy = vi.fn();
const setTransformSpy = vi.fn();

function setupCanvasMock() {
  drawImageSpy.mockClear();
  translateSpy.mockClear();
  rotateSpy.mockClear();
  scaleSpy.mockClear();
  transformSpy.mockClear();
  setTransformSpy.mockClear();
}

vi.stubGlobal('OffscreenCanvas', MockOffscreenCanvas);

Object.defineProperty(canvasContext, 'canvas', {
  get() {
    return mockContext(this as unknown as MockOffscreenCanvas);
  },
});

function makeBitmap(width: number, height: number): ImageBitmap {
  return { width, height } as unknown as ImageBitmap;
}

function makeParams(bitmap: ImageBitmap, size: { width: number; height: number }): ProcessorToolParams {
  return { bitmap, size } as ProcessorToolParams;
}

const baseArgs: TransformToolArgs = {
  rotate: 0,
  mirrorH: false,
  mirrorV: false,
  skewX: 0,
  skewY: 0,
  trapezoid: 0,
  resizeX: 100,
  resizeY: 100,
  toolName: 'transform',
};

function withArgs(overrides: Partial<TransformToolArgs> = {}): TransformToolArgs {
  return { ...baseArgs, ...overrides };
}

describe('transform tool', () => {
  beforeEach(() => {
    setupCanvasMock();
  });

  describe('input validation', () => {
    it('throws when width is less than 1', () => {
      const params = makeParams(makeBitmap(0, 0), { width: 0, height: 10 });
      expect(() => transform(params)(withArgs())).toThrow('Invalid raster transform dimensions or values');
    });

    it('throws when height is less than 1', () => {
      const params = makeParams(makeBitmap(0, 0), { width: 10, height: 0 });
      expect(() => transform(params)(withArgs())).toThrow('Invalid raster transform dimensions or values');
    });

    it('throws when a numeric value is NaN', () => {
      const params = makeParams(makeBitmap(10, 10), { width: 10, height: 10 });
      expect(() => transform(params)(withArgs({ rotate: NaN }))).toThrow(
        'Invalid raster transform dimensions or values'
      );
    });

    it('throws when a numeric value is Infinity', () => {
      const params = makeParams(makeBitmap(10, 10), { width: 10, height: 10 });
      expect(() => transform(params)(withArgs({ resizeX: Infinity }))).toThrow(
        'Invalid raster transform dimensions or values'
      );
    });

    it('throws when a boolean field is a non-boolean', () => {
      const params = makeParams(makeBitmap(10, 10), { width: 10, height: 10 });
      expect(() => transform(params)(withArgs({ mirrorH: 'yes' as unknown as boolean }))).toThrow(
        'Invalid raster transform dimensions or values'
      );
    });
  });

  describe('trapezoid exclusivity', () => {
    it('throws when trapezoid is combined with rotation', () => {
      const params = makeParams(makeBitmap(100, 100), { width: 100, height: 100 });
      expect(() => transform(params)(withArgs({ trapezoid: 25, rotate: 10 }))).toThrow(
        'Trapezoid cannot be combined with retained affine transforms'
      );
    });

    it('throws when trapezoid is combined with mirrorH', () => {
      const params = makeParams(makeBitmap(100, 100), { width: 100, height: 100 });
      expect(() => transform(params)(withArgs({ trapezoid: 25, mirrorH: true }))).toThrow(
        'Trapezoid cannot be combined with retained affine transforms'
      );
    });

    it('throws when trapezoid is combined with mirrorV', () => {
      const params = makeParams(makeBitmap(100, 100), { width: 100, height: 100 });
      expect(() => transform(params)(withArgs({ trapezoid: 25, mirrorV: true }))).toThrow(
        'Trapezoid cannot be combined with retained affine transforms'
      );
    });

    it('throws when trapezoid is combined with skewX', () => {
      const params = makeParams(makeBitmap(100, 100), { width: 100, height: 100 });
      expect(() => transform(params)(withArgs({ trapezoid: 25, skewX: 5 }))).toThrow(
        'Trapezoid cannot be combined with retained affine transforms'
      );
    });

    it('throws when trapezoid is combined with skewY', () => {
      const params = makeParams(makeBitmap(100, 100), { width: 100, height: 100 });
      expect(() => transform(params)(withArgs({ trapezoid: 25, skewY: 5 }))).toThrow(
        'Trapezoid cannot be combined with retained affine transforms'
      );
    });

    it('throws when trapezoid is combined with resizeX != 100', () => {
      const params = makeParams(makeBitmap(100, 100), { width: 100, height: 100 });
      expect(() => transform(params)(withArgs({ trapezoid: 25, resizeX: 150 }))).toThrow(
        'Trapezoid cannot be combined with retained affine transforms'
      );
    });

    it('throws when trapezoid is combined with resizeY != 100', () => {
      const params = makeParams(makeBitmap(100, 100), { width: 100, height: 100 });
      expect(() => transform(params)(withArgs({ trapezoid: 25, resizeY: 80 }))).toThrow(
        'Trapezoid cannot be combined with retained affine transforms'
      );
    });

    it('allows trapezoid alone with no other transforms', () => {
      const params = makeParams(makeBitmap(100, 100), { width: 100, height: 100 });
      const [canvas] = transform(params)(withArgs({ trapezoid: 25 }));
      expect(canvas).toBeInstanceOf(MockOffscreenCanvas);
      expect(canvas.width).toBeGreaterThan(0);
    });
  });

  describe('raster bounds', () => {
    it('throws when the resulting canvas exceeds 1,000,000 pixels in width', () => {
      const params = makeParams(makeBitmap(1, 1), { width: 1, height: 1 });
      expect(() => transform(params)(withArgs({ resizeX: 150000000, resizeY: 100 }))).toThrow(
        'Raster transform exceeds supported bounds'
      );
    });

    it('throws when the resulting canvas exceeds 1,000,000 pixels in height', () => {
      const params = makeParams(makeBitmap(1, 1), { width: 1, height: 1 });
      expect(() => transform(params)(withArgs({ resizeX: 100, resizeY: 150000000 }))).toThrow(
        'Raster transform exceeds supported bounds'
      );
    });

    it('throws when the resulting pixel count exceeds 64M', () => {
      // 8000 × 8000 at 200% scale → 16000 × 16000 = 256M pixels, exceeds 64M.
      const params = makeParams(makeBitmap(8000, 8000), { width: 8000, height: 8000 });
      expect(() => transform(params)(withArgs({ resizeX: 200, resizeY: 200 }))).toThrow(
        'Raster transform exceeds supported bounds'
      );
    });

    it('throws when a zero scale collapses the width below 1', () => {
      const params = makeParams(makeBitmap(1, 1), { width: 1, height: 1 });
      expect(() => transform(params)(withArgs({ resizeX: 0, resizeY: 100 }))).toThrow(
        'Raster transform exceeds supported bounds'
      );
    });
  });

  describe('normal affine path (no trapezoid)', () => {
    it('returns just the canvas when rotation is 0 and resize is 100%', () => {
      const bitmap = makeBitmap(100, 100);
      const params = makeParams(bitmap, { width: 100, height: 100 });
      const result = transform(params)(withArgs());

      expect(result).toHaveLength(1);
      const [canvas] = result;
      expect(canvas).toBeInstanceOf(MockOffscreenCanvas);
      expect(canvas.width).toBe(100);
      expect(canvas.height).toBe(100);
    });

    it('applies a rotation and returns a position-patch when the bounding box changes', () => {
      const bitmap = makeBitmap(100, 100);
      const params = makeParams(bitmap, { width: 100, height: 100 });
      const result = transform(params)(withArgs({ rotate: 45 }));

      expect(result).toHaveLength(2);
      const [canvas, patch] = result;
      expect(canvas).toBeInstanceOf(MockOffscreenCanvas);
      expect(patch).toEqual({ width: expect.any(Number), height: expect.any(Number) });
      // A 45° rotation of a 100×100 square should produce a larger canvas.
      expect(patch!.width).toBeGreaterThan(100);
      expect(patch!.height).toBeGreaterThan(100);
    });

    it('applies horizontal mirror via negative scaleX and keeps dimensions unchanged', () => {
      const bitmap = makeBitmap(100, 50);
      const params = makeParams(bitmap, { width: 100, height: 50 });
      const result = transform(params)(withArgs({ mirrorH: true }));

      // Mirror doesn't change the bounding box, so no position patch is returned.
      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(MockOffscreenCanvas);
    });

    it('applies vertical mirror via negative scaleY', () => {
      const bitmap = makeBitmap(100, 50);
      const params = makeParams(bitmap, { width: 100, height: 50 });
      const result = transform(params)(withArgs({ mirrorV: true }));

      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(MockOffscreenCanvas);
    });

    it('applies skewX and skewY', () => {
      const bitmap = makeBitmap(100, 100);
      const params = makeParams(bitmap, { width: 100, height: 100 });
      const [canvas, patch] = transform(params)(withArgs({ skewX: 10, skewY: 5 }));

      expect(canvas).toBeInstanceOf(MockOffscreenCanvas);
      expect(patch).toBeDefined();
    });

    it('applies resize scaling (resizeX 150, resizeY 85) and returns a position patch', () => {
      const bitmap = makeBitmap(100, 100);
      const params = makeParams(bitmap, { width: 100, height: 100 });
      const [canvas, patch] = transform(params)(withArgs({ resizeX: 150, resizeY: 85 }));

      expect(canvas).toBeInstanceOf(MockOffscreenCanvas);
      expect(patch).toEqual({ width: 150, height: 85 });
    });

    it('combines rotation, skew, and scale into a single canvas', () => {
      const bitmap = makeBitmap(60, 40);
      const params = makeParams(bitmap, { width: 60, height: 40 });
      const [canvas, patch] = transform(params)(
        withArgs({ rotate: 30, skewX: 5, skewY: 3, mirrorH: true, resizeX: 120, resizeY: 90 })
      );

      expect(canvas).toBeInstanceOf(MockOffscreenCanvas);
      expect(patch).toBeDefined();
      expect(patch!.width).toBeGreaterThan(0);
      expect(patch!.height).toBeGreaterThan(0);
    });
  });

  describe('trapezoid path', () => {
    it('draws thin strips for a positive trapezoid factor', () => {
      const bitmap = makeBitmap(100, 50);
      const params = makeParams(bitmap, { width: 100, height: 50 });
      const result = transform(params)(withArgs({ trapezoid: 50 }));

      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(MockOffscreenCanvas);
      // The top edge is full width so the bounding box width is unchanged.
      expect(result[0].width).toBe(100);
      expect(result[0].height).toBe(50);
    });

    it('draws thin strips for a negative trapezoid factor', () => {
      const bitmap = makeBitmap(100, 50);
      const params = makeParams(bitmap, { width: 100, height: 50 });
      const result = transform(params)(withArgs({ trapezoid: -30 }));

      const [canvas] = result;
      expect(canvas).toBeInstanceOf(MockOffscreenCanvas);
      expect(canvas.width).toBe(100);
      expect(canvas.height).toBe(50);
    });

    it('does not return a position patch when trapezoid keeps the same dimensions', () => {
      const bitmap = makeBitmap(100, 50);
      const params = makeParams(bitmap, { width: 100, height: 50 });
      const result = transform(params)(withArgs({ trapezoid: 0 }));

      // trapezoid === 0 with no other transforms: size unchanged → returns [canvas]
      expect(result).toHaveLength(1);
    });
  });
});
