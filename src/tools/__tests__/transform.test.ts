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
  pixels: ImageData;
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

function createMockContext(canvas: MockCanvas): MockContext {
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
    putImageData: vi.fn((imageData: ImageData, x: number, y: number) => {
      const length = Math.min(imageData.width, canvas.width - x) * 4;
      canvas.pixels.data.set(imageData.data.subarray(0, length), (y * canvas.width + x) * 4);
    }),
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
  pixels: ImageData;
  contexts: MockContext[] = [];

  constructor(width: number, height: number) {
    this.width = Math.max(1, Math.ceil(width));
    this.height = Math.max(1, Math.ceil(height));
    this.pixels = makeImageData(this.width, this.height, () => undefined);
    createdCanvases.push(this);
  }

  getContext() {
    if (!this.contexts[0]) this.contexts.push(createMockContext(this));
    return this.contexts[0];
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

function assembledRaster(result: readonly unknown[]): ImageData {
  return (result[0] as unknown as MockCanvas).pixels;
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
      expect(canvas.width).toBe(100);
      expect(canvas.height).toBe(100);
    });

    it('warps a one pixel layer without collapsing it', () => {
      const params = makeParams(makeBitmap(1, 1), { width: 1, height: 1 });
      const [canvas] = transform(params)(withArgs({ trapezoid: 50 }));

      expect([canvas.width, canvas.height]).toEqual([1, 1]);
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

      expect(() => transform(makeParams(makeBitmap(size.width, size.height), size))(args)).toThrow(
        'Raster transform exceeds supported bounds'
      );
    });

    it('rejects a sub-pixel layer instead of rounding it up to one pixel', () => {
      const params = makeParams(makeBitmap(1, 1), { width: 0.4, height: 0.4 });

      expect(() => transform(params)(withArgs())).toThrow('Invalid raster transform dimensions or values');
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
      // The mirror is the negative `a`, and the `e` that recentres it: a 100-wide layer
      // mirrored about its own centre maps x=0 to 100 and x=100 to 0. Asserting only the
      // return shape proved nothing about the mirror — a production change that dropped it,
      // or applied `+1`, returned the same canvas and the same length.
      expect(destinationContextOf(result).ctmCalls).toEqual([{ op: 'setTransform', values: [-1, 0, 0, 1, 100, 0] }]);
      expect([result[0].width, result[0].height]).toEqual([100, 50]);
    });

    it('applies vertical mirror via negative scaleY', () => {
      const bitmap = makeBitmap(100, 50);
      const params = makeParams(bitmap, { width: 100, height: 50 });
      const result = transform(params)(withArgs({ mirrorV: true }));

      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(globalThis.OffscreenCanvas);
      // `d` is the negation here and `f` is the recentring: a 50-tall layer mirrored about its
      // centre maps y=0 to 50 and y=50 to 0. `c` and `b` stay 0, so a mirror must not leak a
      // rotation in.
      expect(destinationContextOf(result).ctmCalls).toEqual([{ op: 'setTransform', values: [1, 0, 0, -1, 0, 50] }]);
      expect([result[0].width, result[0].height]).toEqual([100, 50]);
    });

    it('mirroring is not the same as negating the wrong axis', () => {
      const params = makeParams(makeBitmap(100, 50), { width: 100, height: 50 });

      const horizontal = destinationContextOf(transform(params)(withArgs({ mirrorH: true }))).ctmCalls[0].values;
      const vertical = destinationContextOf(transform(params)(withArgs({ mirrorV: true }))).ctmCalls[0].values;
      const both = destinationContextOf(transform(params)(withArgs({ mirrorH: true, mirrorV: true }))).ctmCalls[0]
        .values;

      // Guards against the two mirrors being transposed — `mirrorH` writing `-1` into `d` and
      // `mirrorV` into `a` is a real inversion, and both would keep every dimension assertion
      // above green because a transposed mirror still reports a 100x50 raster.
      expect(horizontal).toEqual([-1, 0, 0, 1, 100, 0]);
      expect(vertical).toEqual([1, 0, 0, -1, 0, 50]);
      expect(both).toEqual([-1, 0, 0, -1, 100, 50]);
    });

    it('applies skewX and skewY', () => {
      const bitmap = makeBitmap(100, 100);
      const params = makeParams(bitmap, { width: 100, height: 100 });
      const [canvas, patch] = transform(params)(withArgs({ skewX: 10, skewY: 5 }));

      expect(canvas).toBeInstanceOf(globalThis.OffscreenCanvas);
      // Closed form, not a re-run of the unit under test. With no rotate/resize the
      // linear part is the bare skew and the raster is the bounding box of the four
      // sheared corners, so the patch is 100 + 100*tan(10deg) wide and
      // 100 + 100*tan(5deg) tall. `toBeDefined()` on the patch passed for `{0, 0}`.
      expect(patch).toEqual({ width: 118, height: 109 });
      expect([canvas.width, canvas.height]).toEqual([118, 109]);

      const [a, b, c, d, e, f] = destinationContextOf([canvas, patch]).ctmCalls[0].values;
      // The linear part is the skew itself, in the order `transformToolArgsToAffine`
      // composes it: `b` takes skewY and `c` takes skewX. Swapping them keeps a sheared
      // raster of the same size and would pass every dimension assertion above.
      expect(a).toBeCloseTo(1, 12);
      expect(b).toBeCloseTo(Math.tan(Math.PI / 36), 12);
      expect(c).toBeCloseTo(Math.tan(Math.PI / 18), 12);
      expect(d).toBeCloseTo(1, 12);

      // The translation is EXACTLY zero, and that is the assertion's whole point: the
      // skew pivots on the untransformed centre, so the affine carries
      // `e = -50*tan(10deg)` and `f = -50*tan(5deg)`, while the bounds offset subtracts
      // `bounds.x`/`bounds.y` — and the leftmost sheared corner sits at exactly
      // `-50*tan(10deg)`, so the two are the SAME number and cancel. This used to
      // assert the uncancelled `-50*tan(10deg)` here, which is the pivot, not the draw
      // matrix, so it pinned a value the renderer has never emitted.
      expect(e).toBe(0);
      expect(f).toBe(0);

      // The cancellation is only meaningful if the pivot it cancels is really there,
      // so the pivot is asserted separately on the affine the renderer is handed. A
      // `getTransformDrawMatrix` that dropped the offset would leave `e` at
      // -50*tan(10deg) and fail the `toBe(0)` above; one that dropped the pivot would
      // leave the affine at zero and fail here.
      const pivot = transformToolArgsToAffine(withArgs({ skewX: 10, skewY: 5 }), { width: 100, height: 100 })!;
      expect(pivot.e).toBeCloseTo(-50 * Math.tan(Math.PI / 18), 12);
      expect(pivot.f).toBeCloseTo(-50 * Math.tan(Math.PI / 36), 12);
      expect(getAffineBounds(pivot, { width: 100, height: 100 })).toMatchObject({
        x: -50 * Math.tan(Math.PI / 18),
        y: -50 * Math.tan(Math.PI / 36),
      });
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
      const result = transform(params)(
        withArgs({ rotate: 30, skewX: 5, skewY: 3, mirrorH: true, resizeX: 120, resizeY: 90 })
      );
      const [canvas, patch] = result;

      expect(canvas).toBeInstanceOf(globalThis.OffscreenCanvas);
      // The name claims "into a single canvas" and nothing checked the length; `toBeGreaterThan(0)`
      // on the patch passed for `{width: 1, height: 1}`. Both now pin the closed-form raster of the
      // same argument set the neighbouring test already pins the matrix of, so the two cannot
      // disagree about what this transform produces.
      expect(result).toHaveLength(2);
      expect(patch).toEqual({ width: 81, height: 70 });
      expect([canvas.width, canvas.height]).toEqual([81, 70]);
    });
  });

  describe('draw matrix parity with the retained affine path', () => {
    it('pins the retained-path raster contract reached only by a direct imageProcessor call, not the live route, because useLayer routes every trapezoid === 0 transform to the retained affine path', () => {
      const size = { width: 48, height: 36 };
      const args = withArgs({ rotate: 90 });
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

    it('installs the skew, rotate, mirror and scale matrix at the exact analytic bounds', () => {
      const size = { width: 60, height: 40 };
      const args = withArgs({ rotate: 30, skewX: 5, skewY: 3, mirrorH: true, resizeX: 120, resizeY: 90 });
      const params = makeParams(makeBitmap(size.width, size.height), size);

      const context = destinationContextOf(transform(params)(args));

      expect(context.ctmCalls).toHaveLength(1);
      expect(context.ctmCalls[0].op).toBe('setTransform');
      expect(context.ctmCalls[0].values.map((value) => Number(value.toFixed(6)))).toEqual([
        -1.091724, -0.654464, -0.381809, 0.755839, 80.775794, 39.267826,
      ]);
    });

    it('registers a rotate-only transform on the exact bounds, not on a rounded raster centre', () => {
      const size = { width: 100, height: 100 };
      const args = withArgs({ rotate: 45 });
      const params = makeParams(makeBitmap(size.width, size.height), size);

      const context = destinationContextOf(transform(params)(args));
      const [, , , , e, f] = context.ctmCalls[0].values;

      expect(e).toBeCloseTo(70.710678, 6);
      expect(f).toBeCloseTo(0, 9);
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

    it('produces the raster the layer renderer would place for a 90 degree rotation', () => {
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
      const written = assembledRaster(result);
      const alphas = Array.from({ length: size.height }, (_unused, y) => pixelAt(written, 50, y)[3]);
      const faintest = alphas.indexOf(Math.min(...alphas));

      expect(alphas[50]).toBe(255);
      expect(Math.min(...alphas)).toBeLessThan(255);
      expect(Math.abs(faintest - 66.666667)).toBeLessThanOrEqual(1);
      expect(faintest).not.toBe(50);
    });

    it.each([85, -85])('produces a complete raster at the slider limit of %i', (trapezoid) => {
      sourcePixelAt = () => [10, 20, 30, 255];
      const size = { width: 64, height: 64 };
      const params = makeParams(makeBitmap(size.width, size.height), size);

      const written = assembledRaster(transform(params)(withArgs({ trapezoid })));

      for (let y = 0; y < size.height; y++) {
        expect(pixelAt(written, 32, y)[3], `row ${y} collapsed`).toBe(255);
      }
    });

    it('reports a taper inside the bound whose horizon still makes the quad singular', () => {
      const size = { width: 100, height: 50 };
      const params = makeParams(makeBitmap(size.width, size.height), size);

      expect(() => transform(params)(withArgs({ trapezoid: 99.999999 }))).toThrow(
        'Trapezoid geometry is not invertible'
      );
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

      const written = assembledRaster(transform(params)(withArgs({ trapezoid: 50 })));

      expect(pixelAt(written, 20, 0)).toEqual([10, 20, 30, 255]);
      expect(pixelAt(written, 20, 19)).toEqual([10, 20, 30, 255]);
      expect(pixelAt(written, 0, 0)[3]).toBeGreaterThan(0);
      expect(pixelAt(written, 0, 0)[3]).toBeLessThan(255);
      expect(pixelAt(written, 0, 19)).toEqual([0, 0, 0, 0]);
      expect(pixelAt(written, 39, 19)).toEqual([0, 0, 0, 0]);
    });

    it('reads the source at the layer size on both paths, whatever the bitmap reports', () => {
      const bitmap = makeBitmap(100, 100);
      const size = { width: 50, height: 50 };
      const params = makeParams(bitmap, size);

      const affine = transform(params)(withArgs({ rotate: 20 }));
      const trapezoid = transform(params)(withArgs({ trapezoid: 50 }));
      const affineContext = sourceContextsOf(affine)[0] ?? destinationContextOf(affine);
      const trapezoidContext = sourceContextsOf(trapezoid)[0];

      expect(affineContext.drawImage).toHaveBeenCalledWith(bitmap, 0, 0, size.width, size.height);
      expect(trapezoidContext.drawImage).toHaveBeenCalledWith(bitmap, 0, 0, size.width, size.height);
    });

    it('does not return a position patch when trapezoid keeps the same dimensions', () => {
      const bitmap = makeBitmap(100, 50);
      const params = makeParams(bitmap, { width: 100, height: 50 });
      const result = transform(params)(withArgs({ trapezoid: 0 }));

      expect(result).toHaveLength(1);
    });
  });
});
