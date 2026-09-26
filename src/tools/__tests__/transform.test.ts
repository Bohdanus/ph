import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  IDENTITY_AFFINE_TRANSFORM,
  getAffineBounds,
  multiplyAffineTransforms,
  transformToolArgsToAffine,
  type AffineTransform,
} from '../../contexts/affine-transform.ts';
import { getTransformDrawMatrix, getTrapezoidQuad, transform, type TransformToolArgs } from '../transform.ts';
import type { ProcessorToolParams } from '../toolProcessors.ts';

type RecordedCtmCall =
  | { op: 'translate'; values: readonly [number, number] }
  | { op: 'rotate'; values: readonly [number] }
  | { op: 'scale'; values: readonly [number, number] }
  | { op: 'transform'; values: readonly [number, number, number, number, number, number] }
  | { op: 'setTransform'; values: readonly [number, number, number, number, number, number] };

type MockContext = {
  ctmCalls: RecordedCtmCall[];
  smoothing: { enabled: boolean; quality: string };
  drawImage: ReturnType<typeof vi.fn>;
  getImageData: ReturnType<typeof vi.fn>;
  createImageData: ReturnType<typeof vi.fn>;
  putImageData: ReturnType<typeof vi.fn>;
  translate: (x: number, y: number) => void;
  rotate: (angle: number) => void;
  scale: (x: number, y: number) => void;
  transform: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
  setTransform: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
  imageSmoothingEnabled: boolean;
  imageSmoothingQuality: string;
};

type MockCanvas = {
  width: number;
  height: number;
  contexts: MockContext[];
  getContext: () => MockContext;
};

type Rgba = [number, number, number, number];

let createdCanvases: MockCanvas[] = [];
let sourcePixelAt: (x: number, y: number) => Rgba = () => [255, 255, 255, 255];

function makeImageData(width: number, height: number, fill: (data: Uint8ClampedArray, offset: number) => void) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let offset = 0; offset < data.length; offset += 4) fill(data, offset);
  return { data, width, height, colorSpace: 'srgb' } as ImageData;
}

function createMockContext(): MockContext {
  const ctmCalls: RecordedCtmCall[] = [];
  const smoothing = { enabled: false, quality: 'low' };
  const context: MockContext = {
    ctmCalls,
    smoothing,
    drawImage: vi.fn(),
    getImageData: vi.fn((_x: number, _y: number, width: number, height: number) =>
      makeImageData(width, height, (data, offset) => {
        const pixel = offset / 4;
        const rgba = sourcePixelAt(pixel % width, Math.floor(pixel / width));
        for (let channel = 0; channel < 4; channel++) data[offset + channel] = rgba[channel];
      })
    ),
    createImageData: vi.fn((width: number, height: number) => makeImageData(width, height, () => undefined)),
    putImageData: vi.fn((imageData: ImageData) => ({ ...imageData, data: new Uint8ClampedArray(imageData.data) })),
    translate: (x, y) => {
      ctmCalls.push({ op: 'translate', values: [x, y] });
    },
    rotate: (angle) => {
      ctmCalls.push({ op: 'rotate', values: [angle] });
    },
    scale: (x, y) => {
      ctmCalls.push({ op: 'scale', values: [x, y] });
    },
    transform: (a, b, c, d, e, f) => {
      ctmCalls.push({ op: 'transform', values: [a, b, c, d, e, f] });
    },
    setTransform: (a, b, c, d, e, f) => {
      ctmCalls.push({ op: 'setTransform', values: [a, b, c, d, e, f] });
    },
    imageSmoothingEnabled: false,
    imageSmoothingQuality: 'low',
  };

  Object.defineProperty(context, 'imageSmoothingEnabled', {
    get: () => smoothing.enabled,
    set: (value: boolean) => {
      smoothing.enabled = value;
    },
  });
  Object.defineProperty(context, 'imageSmoothingQuality', {
    get: () => smoothing.quality,
    set: (value: string) => {
      smoothing.quality = value;
    },
  });

  return context;
}

class MockOffscreenCanvas implements MockCanvas {
  width: number;
  height: number;
  contexts: MockContext[] = [];

  constructor(width: number, height: number) {
    this.width = Math.max(1, Math.ceil(width));
    this.height = Math.max(1, Math.ceil(height));
    createdCanvases.push(this);
  }

  getContext() {
    const context = createMockContext();
    this.contexts.push(context);
    return context;
  }
}

beforeEach(() => {
  createdCanvases = [];
  sourcePixelAt = () => [255, 255, 255, 255];
  vi.stubGlobal('OffscreenCanvas', MockOffscreenCanvas);
});

afterEach(() => {
  vi.unstubAllGlobals();
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

function destinationContextOf(result: readonly unknown[]): MockContext {
  return (result[0] as unknown as MockCanvas).contexts[0];
}

function sourceContextsOf(result: readonly unknown[]): MockContext[] {
  const destination = result[0] as unknown as MockCanvas;
  return createdCanvases.filter((canvas) => canvas !== destination).flatMap((canvas) => canvas.contexts);
}

function composeRecordedCtm(calls: readonly RecordedCtmCall[]): AffineTransform {
  return calls.reduce<AffineTransform>((matrix, call) => {
    switch (call.op) {
      case 'translate':
        return multiplyAffineTransforms(matrix, {
          a: 1,
          b: 0,
          c: 0,
          d: 1,
          e: call.values[0],
          f: call.values[1],
        });
      case 'rotate': {
        const cos = Math.cos(call.values[0]);
        const sin = Math.sin(call.values[0]);
        return multiplyAffineTransforms(matrix, { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 });
      }
      case 'scale':
        return multiplyAffineTransforms(matrix, { a: call.values[0], b: 0, c: 0, d: call.values[1], e: 0, f: 0 });
      case 'transform':
        return multiplyAffineTransforms(matrix, {
          a: call.values[0],
          b: call.values[1],
          c: call.values[2],
          d: call.values[3],
          e: call.values[4],
          f: call.values[5],
        });
      case 'setTransform':
        return {
          a: call.values[0],
          b: call.values[1],
          c: call.values[2],
          d: call.values[3],
          e: call.values[4],
          f: call.values[5],
        };
    }
  }, IDENTITY_AFFINE_TRANSFORM);
}

function expectAffineCloseTo(actual: AffineTransform, expected: AffineTransform, precision = 9): void {
  expect(actual.a).toBeCloseTo(expected.a, precision);
  expect(actual.b).toBeCloseTo(expected.b, precision);
  expect(actual.c).toBeCloseTo(expected.c, precision);
  expect(actual.d).toBeCloseTo(expected.d, precision);
  expect(actual.e).toBeCloseTo(expected.e, precision);
  expect(actual.f).toBeCloseTo(expected.f, precision);
}

function pixelAt(image: ImageData, x: number, y: number): number[] {
  const offset = (y * image.width + x) * 4;
  return [image.data[offset], image.data[offset + 1], image.data[offset + 2], image.data[offset + 3]];
}

function assembledRaster(context: MockContext, width: number, height: number): ImageData {
  const assembled = makeImageData(width, height, () => undefined);
  context.putImageData.mock.calls.forEach((call, index) => {
    const x = call[1] as number;
    const y = call[2] as number;
    const row = context.putImageData.mock.results[index].value as ImageData;
    const length = Math.min(row.width, width - x) * 4;
    assembled.data.set(row.data.subarray(0, length), y * width * 4);
  });
  return assembled;
}

describe('transform tool', () => {
  describe('input validation', () => {
    it('throws when width is less than 1', () => {
      const params = makeParams(makeBitmap(0, 0), { width: 0, height: 10 });
      expect(() => transform(params)(withArgs())).toThrow('Invalid raster transform dimensions or values');
    });

    it('throws when height is less than 1', () => {
      const params = makeParams(makeBitmap(10, 0), { width: 10, height: 0 });
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
      expect(canvas).toBeInstanceOf(globalThis.OffscreenCanvas);
      expect(canvas.width).toBeGreaterThan(0);
    });
  });

  describe('raster bounds', () => {
    it('rejects a scale whose matrix component exceeds the coordinate limit', () => {
      const params = makeParams(makeBitmap(1, 1), { width: 1, height: 1 });
      expect(() => transform(params)(withArgs({ resizeX: 150000000, resizeY: 100 }))).toThrow(
        'Affine transform contains invalid or extreme values'
      );
    });

    it('rejects a scale whose matrix component exceeds the coordinate limit vertically', () => {
      const params = makeParams(makeBitmap(1, 1), { width: 1, height: 1 });
      expect(() => transform(params)(withArgs({ resizeX: 100, resizeY: 150000000 }))).toThrow(
        'Affine transform contains invalid or extreme values'
      );
    });

    it('throws when the resulting pixel count exceeds 64M', () => {
      const params = makeParams(makeBitmap(8000, 8000), { width: 8000, height: 8000 });
      expect(() => transform(params)(withArgs({ resizeX: 200, resizeY: 200 }))).toThrow(
        'Affine transform exceeds raster bounds'
      );
    });

    it('throws when the scale is zero', () => {
      const params = makeParams(makeBitmap(1, 1), { width: 1, height: 1 });
      expect(() => transform(params)(withArgs({ resizeX: 0, resizeY: 100 }))).toThrow('Transform scale cannot be zero');
    });

    it('throws when a rounded dimension collapses below one pixel', () => {
      const size = { width: 100, height: 100 };
      const args = withArgs({ resizeX: 0.2, resizeY: 100 });
      const retained = transformToolArgsToAffine(args, size);
      const bounds = getAffineBounds(retained!, size);

      expect(bounds.width).toBeGreaterThan(0);
      expect(() => transform(makeParams(makeBitmap(size.width, size.height), size))(args)).toThrow(
        'Raster transform exceeds supported bounds'
      );
    });

    it('rounds getAffineBounds identically for every non-degenerate raster size', () => {
      const cases: { size: { width: number; height: number }; overrides: Partial<TransformToolArgs> }[] = [
        { size: { width: 100, height: 50 }, overrides: { rotate: 45 } },
        { size: { width: 100, height: 50 }, overrides: { rotate: 90 } },
        { size: { width: 100, height: 50 }, overrides: { skewX: 10, skewY: 5 } },
        { size: { width: 100, height: 50 }, overrides: { resizeX: 150, resizeY: 85 } },
        { size: { width: 100, height: 50 }, overrides: { mirrorH: true } },
        { size: { width: 60, height: 40 }, overrides: { rotate: 30, skewX: 5, skewY: 3, resizeX: 120, resizeY: 90 } },
        { size: { width: 33, height: 17 }, overrides: { rotate: 17.5, resizeX: 143 } },
      ];

      for (const { size, overrides } of cases) {
        const args = withArgs(overrides);
        const bounds = getAffineBounds(transformToolArgsToAffine(args, size)!, size);
        const [canvas] = transform(makeParams(makeBitmap(size.width, size.height), size))(args);

        expect([canvas.width, canvas.height]).toEqual([Math.round(bounds.width), Math.round(bounds.height)]);
      }
    });
  });

  describe('normal affine path (no trapezoid)', () => {
    it('returns just the canvas when rotation is 0 and resize is 100%', () => {
      const bitmap = makeBitmap(100, 100);
      const params = makeParams(bitmap, { width: 100, height: 100 });
      const result = transform(params)(withArgs());

      expect(result).toHaveLength(1);
      const [canvas] = result;
      expect(canvas).toBeInstanceOf(globalThis.OffscreenCanvas);
      expect(canvas.width).toBe(100);
      expect(canvas.height).toBe(100);
    });

    it('applies a rotation and returns a position-patch when the bounding box changes', () => {
      const bitmap = makeBitmap(100, 100);
      const params = makeParams(bitmap, { width: 100, height: 100 });
      const result = transform(params)(withArgs({ rotate: 45 }));

      expect(result).toHaveLength(2);
      const [canvas, patch] = result;
      expect(canvas).toBeInstanceOf(globalThis.OffscreenCanvas);
      expect(patch).toEqual({ width: expect.any(Number), height: expect.any(Number) });
      expect(patch!.width).toBeGreaterThan(100);
      expect(patch!.height).toBeGreaterThan(100);
    });

    it('applies horizontal mirror via negative scaleX and keeps dimensions unchanged', () => {
      const bitmap = makeBitmap(100, 50);
      const params = makeParams(bitmap, { width: 100, height: 50 });
      const result = transform(params)(withArgs({ mirrorH: true }));

      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(globalThis.OffscreenCanvas);
    });

    it('applies vertical mirror via negative scaleY', () => {
      const bitmap = makeBitmap(100, 50);
      const params = makeParams(bitmap, { width: 100, height: 50 });
      const result = transform(params)(withArgs({ mirrorV: true }));

      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(globalThis.OffscreenCanvas);
    });

    it('applies skewX and skewY', () => {
      const bitmap = makeBitmap(100, 100);
      const params = makeParams(bitmap, { width: 100, height: 100 });
      const [canvas, patch] = transform(params)(withArgs({ skewX: 10, skewY: 5 }));

      expect(canvas).toBeInstanceOf(globalThis.OffscreenCanvas);
      expect(patch).toBeDefined();
    });

    it('applies resize scaling (resizeX 150, resizeY 85) and returns a position patch', () => {
      const bitmap = makeBitmap(100, 100);
      const params = makeParams(bitmap, { width: 100, height: 100 });
      const [canvas, patch] = transform(params)(withArgs({ resizeX: 150, resizeY: 85 }));

      expect(canvas).toBeInstanceOf(globalThis.OffscreenCanvas);
      expect(patch).toEqual({ width: 150, height: 85 });
    });

    it('combines rotation, skew, and scale into a single canvas', () => {
      const bitmap = makeBitmap(60, 40);
      const params = makeParams(bitmap, { width: 60, height: 40 });
      const [canvas, patch] = transform(params)(
        withArgs({ rotate: 30, skewX: 5, skewY: 3, mirrorH: true, resizeX: 120, resizeY: 90 })
      );

      expect(canvas).toBeInstanceOf(globalThis.OffscreenCanvas);
      expect(patch).toBeDefined();
      expect(patch!.width).toBeGreaterThan(0);
      expect(patch!.height).toBeGreaterThan(0);
    });
  });

  describe('draw matrix parity with the retained affine path', () => {
    it('pins the retained-path raster contract reached only by a direct imageProcessor call, not the live route', () => {
      const size = { width: 48, height: 36 };
      const args = withArgs({ rotate: 90, resizeX: 100, resizeY: 100 });
      const retained = transformToolArgsToAffine(args, size)!;
      const bounds = getAffineBounds(retained, size);
      const params = makeParams(makeBitmap(size.width, size.height), size);

      const result = transform(params)(args);
      const context = destinationContextOf(result);

      expect(context.ctmCalls.map((call) => call.op)).toEqual(['setTransform']);
      expectAffineCloseTo(
        composeRecordedCtm(context.ctmCalls),
        multiplyAffineTransforms({ a: 1, b: 0, c: 0, d: 1, e: -bounds.x, f: -bounds.y }, retained)
      );
      expect([result[0].width, result[0].height]).toEqual([size.height, size.width]);
    });

    it('composes the same draw matrix as transformToolArgsToAffine for skew, rotation, and scale', () => {
      const size = { width: 60, height: 40 };
      const args = withArgs({ rotate: 30, skewX: 5, skewY: 3, mirrorH: true, resizeX: 120, resizeY: 90 });
      const retained = transformToolArgsToAffine(args, size)!;
      const params = makeParams(makeBitmap(size.width, size.height), size);

      const context = destinationContextOf(transform(params)(args));

      expectAffineCloseTo(
        composeRecordedCtm(context.ctmCalls),
        getTransformDrawMatrix(retained, getAffineBounds(retained, size))
      );
    });

    it('installs the retained matrix itself through setTransform instead of chained transform calls', () => {
      const size = { width: 40, height: 25 };
      const args = withArgs({ rotate: 12, skewX: 20, skewY: -8, resizeX: 175, resizeY: 60 });
      const retained = transformToolArgsToAffine(args, size)!;
      const params = makeParams(makeBitmap(size.width, size.height), size);

      const context = destinationContextOf(transform(params)(args));

      expect(context.ctmCalls.map((call) => call.op)).toEqual(['setTransform']);
      const [call] = context.ctmCalls;
      expect(call.values).toHaveLength(6);
      const [, b, c, , e, f] = call.values;
      expect(b).toBeCloseTo(retained.b, 12);
      expect(c).toBeCloseTo(retained.c, 12);
      expect(e).toBeCloseTo(retained.e - getAffineBounds(retained, size).x, 12);
      expect(f).toBeCloseTo(retained.f - getAffineBounds(retained, size).y, 12);
    });

    it('matches the layer-renderer composition for a 90 degree rotation', () => {
      const size = { width: 30, height: 12 };
      const args = withArgs({ rotate: 90 });
      const retained = transformToolArgsToAffine(args, size)!;
      const bounds = getAffineBounds(retained, size);
      const params = makeParams(makeBitmap(size.width, size.height), size);

      const result = transform(params)(args);
      const context = destinationContextOf(result);

      const rendererComposition = multiplyAffineTransforms(
        { a: 1, b: 0, c: 0, d: 1, e: -bounds.x, f: -bounds.y },
        retained
      );
      expectAffineCloseTo(composeRecordedCtm(context.ctmCalls), rendererComposition);
      expect(retained.a).toBeCloseTo(0, 12);
      expect(retained.b).toBeCloseTo(1, 12);
      expect(retained.c).toBeCloseTo(-1, 12);
      expect(retained.d).toBeCloseTo(0, 12);
      expect(result[0].width).toBe(size.height);
      expect(result[0].height).toBe(size.width);
      expect(result[1]).toEqual({ width: size.height, height: size.width });
    });

    it('draws the source bitmap directly at the retained size without an intermediate copy canvas', () => {
      const size = { width: 24, height: 16 };
      const bitmap = makeBitmap(size.width, size.height);
      const params = makeParams(bitmap, size);

      const result = transform(params)(withArgs({ rotate: 20 }));

      expect(sourceContextsOf(result)).toHaveLength(0);
      expect(destinationContextOf(result).drawImage).toHaveBeenCalledWith(bitmap, 0, 0, size.width, size.height);
      expect(destinationContextOf(result).smoothing).toEqual({ enabled: true, quality: 'high' });
    });
  });

  describe('trapezoid geometry', () => {
    it('derives one quad from a continuous function of y, matching the bounding box exactly', () => {
      const size = { width: 100, height: 50 };

      const quad = getTrapezoidQuad(size, 50);

      expect(quad).toEqual([
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 75, y: 50 },
        { x: 25, y: 50 },
      ]);
      const xs = quad.map((point) => point.x);
      const ys = quad.map((point) => point.y);
      expect(Math.round(Math.max(...xs) - Math.min(...xs))).toBe(size.width);
      expect(Math.round(Math.max(...ys) - Math.min(...ys))).toBe(size.height);
    });

    it('narrowes the bottom edge for a positive factor and the top edge for a negative one', () => {
      const size = { width: 100, height: 50 };

      expect(getTrapezoidQuad(size, 30)[2].x).toBeCloseTo(85, 12);
      expect(getTrapezoidQuad(size, 30)[3].x).toBeCloseTo(15, 12);
      expect(getTrapezoidQuad(size, -30)[0].x).toBeCloseTo(15, 12);
      expect(getTrapezoidQuad(size, -30)[1].x).toBeCloseTo(85, 12);
      expect(getTrapezoidQuad(size, 0)).toEqual([
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 50 },
        { x: 0, y: 50 },
      ]);
    });

    it('rejects a taper that collapses the quad to a degenerate triangle', () => {
      const size = { width: 100, height: 50 };
      const params = makeParams(makeBitmap(size.width, size.height), size);

      expect(() => transform(params)(withArgs({ trapezoid: 100 }))).toThrow(
        'Trapezoid taper must stay within 100 percent'
      );
      expect(() => transform(params)(withArgs({ trapezoid: -100 }))).toThrow(
        'Trapezoid taper must stay within 100 percent'
      );
    });

    it('rejects a collimation factor whose projective horizon folds through the source rect', () => {
      const size = { width: 100, height: 50 };
      const params = makeParams(makeBitmap(size.width, size.height), size);

      expect(() => transform(params)(withArgs({ trapezoid: 150 }))).toThrow(
        'Trapezoid taper must stay within 100 percent'
      );
      expect(() => transform(params)(withArgs({ trapezoid: -150 }))).toThrow(
        'Trapezoid taper must stay within 100 percent'
      );
    });

    it('warps the mid source row to the projective row position, not the linear one', () => {
      sourcePixelAt = (_x, y) => (y === 50 ? [0, 0, 0, 0] : [10, 20, 30, 255]);
      const size = { width: 100, height: 100 };
      const params = makeParams(makeBitmap(size.width, size.height), size);

      const result = transform(params)(withArgs({ trapezoid: 50 }));
      const written = assembledRaster(destinationContextOf(result), size.width, size.height);
      const alphas = Array.from({ length: size.height }, (_unused, y) => pixelAt(written, 50, y)[3]);

      expect(alphas[50]).toBe(255);
      expect(Math.min(...alphas)).toBeLessThan(255);
      expect(alphas.indexOf(Math.min(...alphas))).toBeGreaterThan(60);
      expect(alphas.indexOf(Math.min(...alphas))).toBeLessThan(75);
    });
  });

  describe('trapezoid path', () => {
    it('resamples once through the inverse homography instead of one drawImage per source row', () => {
      const size = { width: 40, height: 20 };
      const params = makeParams(makeBitmap(size.width, size.height), size);

      const result = transform(params)(withArgs({ trapezoid: 40 }));

      const [sourceContext] = sourceContextsOf(result);
      const destinationContext = destinationContextOf(result);
      expect(sourceContext.getImageData).toHaveBeenCalledTimes(1);
      expect(sourceContext.getImageData).toHaveBeenCalledWith(0, 0, size.width, size.height);
      expect(sourceContext.drawImage).toHaveBeenCalledTimes(1);
      expect(destinationContext.createImageData).toHaveBeenCalledWith(size.width, 1);
      expect(destinationContext.createImageData).toHaveBeenCalledTimes(1);
      expect(destinationContext.putImageData).toHaveBeenCalledTimes(size.height);
      expect(sourceContext.smoothing).toEqual({ enabled: true, quality: 'high' });
    });

    it('keeps the same canvas size as the source for a positive trapezoid factor', () => {
      const bitmap = makeBitmap(100, 50);
      const params = makeParams(bitmap, { width: 100, height: 50 });
      const result = transform(params)(withArgs({ trapezoid: 50 }));

      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(globalThis.OffscreenCanvas);
      expect(result[0].width).toBe(100);
      expect(result[0].height).toBe(50);
    });

    it('keeps the same canvas size as the source for a negative trapezoid factor', () => {
      const bitmap = makeBitmap(100, 50);
      const params = makeParams(bitmap, { width: 100, height: 50 });
      const result = transform(params)(withArgs({ trapezoid: -30 }));

      expect(result[0]).toBeInstanceOf(globalThis.OffscreenCanvas);
      expect(result[0].width).toBe(100);
      expect(result[0].height).toBe(50);
    });

    it('fills the quad, antialiases its slanted edges, and leaves the corners outside it transparent', () => {
      sourcePixelAt = () => [10, 20, 30, 255];
      const size = { width: 40, height: 20 };
      const params = makeParams(makeBitmap(size.width, size.height), size);

      const result = transform(params)(withArgs({ trapezoid: 50 }));
      const written = assembledRaster(destinationContextOf(result), size.width, size.height);

      expect(pixelAt(written, 20, 0)).toEqual([10, 20, 30, 255]);
      expect(pixelAt(written, 20, 19)).toEqual([10, 20, 30, 255]);
      expect(pixelAt(written, 0, 0)[3]).toBeGreaterThan(0);
      expect(pixelAt(written, 0, 0)[3]).toBeLessThan(255);
      expect(pixelAt(written, 0, 19)).toEqual([0, 0, 0, 0]);
      expect(pixelAt(written, 39, 19)).toEqual([0, 0, 0, 0]);
    });

    it('does not return a position patch when trapezoid keeps the same dimensions', () => {
      const bitmap = makeBitmap(100, 50);
      const params = makeParams(bitmap, { width: 100, height: 50 });
      const result = transform(params)(withArgs({ trapezoid: 0 }));

      expect(result).toHaveLength(1);
    });
  });
});
