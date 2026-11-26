import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { healingBrush, HEALING_BRUSH_SPACING_PERCENT, type HealingBrushToolArgs } from '../healingBrush.ts';
import { createPixelCanvasContext } from '../../test/setup.ts';
import { BRUSH_HARDNESS_MAX, BRUSH_HARDNESS_MIN, BRUSH_SIZE_MAX, BRUSH_SIZE_MIN } from '../../util/brush-engine.ts';
import type { Size } from '../../contexts/general-types.ts';

const size: Size = { width: 9, height: 9 };

/**
 * Pixel-capable `OffscreenCanvas` recorder.
 * Mirrors the pattern from `src/test/setup.ts` — `createPixelCanvasContext`
 * installs real `getImageData`/`putImageData` on a canvas whose backing buffer
 * we can read directly, so assertions can verify the actual pixel result.
 */
type MockCtx = CanvasRenderingContext2D;

class RecordingOffscreenCanvas {
  static instances: RecordingOffscreenCanvas[] = [];

  width: number;
  height: number;
  readonly pixels: Uint8ClampedArray;
  readonly ctx: MockCtx;

  constructor(width: number, height: number) {
    this.width = Math.max(1, Math.ceil(width));
    this.height = Math.max(1, Math.ceil(height));
    this.pixels = new Uint8ClampedArray(this.width * this.height * 4);

    const ctx = createPixelCanvasContext(this);
    // `drawImage` is the only entry point a raster processor has into its output canvas, so
    // the source reaches the pixels here exactly the way it reaches them in a browser.
    vi.mocked(ctx.drawImage).mockImplementation(((source: unknown) => {
      const drawn = source as { pixels: Uint8ClampedArray };
      this.pixels.set(drawn.pixels.subarray(0, this.pixels.length));
    }) as unknown as MockCtx['drawImage']);
    // A COPY, because a real `getImageData` copies: the filter reads this buffer while it
    // writes its own, and an aliasing stub would have the two fight over the same bytes.
    vi.mocked(ctx.getImageData).mockImplementation(
      () =>
        ({
          data: new Uint8ClampedArray(this.pixels),
          width: this.width,
          height: this.height,
          colorSpace: 'srgb',
        }) as ImageData
    );
    vi.mocked(ctx.putImageData).mockImplementation(((image: ImageData, x: number, y: number) => {
      for (let row = 0; row < image.height; row++) {
        const from = row * image.width * 4;
        const to = (y + row) * this.width * 4 + x * 4;
        this.pixels.set(image.data.subarray(from, from + image.width * 4), to);
      }
    }) as unknown as MockCtx['putImageData']);

    this.ctx = ctx;
    RecordingOffscreenCanvas.instances.push(this);
  }

  getContext(): MockCtx {
    return this.ctx;
  }
}

const args = (overrides: Partial<HealingBrushToolArgs> = {}): HealingBrushToolArgs => ({
  size: 3,
  hardness: 100,
  opacity: 1,
  aligned: true,
  source: { x: 4, y: 4 },
  toolName: 'healing-brush',
  points: [{ x: 4, y: 4 }],
  ...overrides,
});

const sourceBitmap = (pixels: Uint8ClampedArray) =>
  ({ width: size.width, height: size.height, pixels, close: vi.fn() }) as unknown as ImageBitmap & {
    pixels: Uint8ClampedArray;
  };

const run = (data: Uint8ClampedArray, a: HealingBrushToolArgs) => {
  const [canvas] = healingBrush({ size, bitmap: sourceBitmap(data) })(a);
  return canvas as unknown as RecordingOffscreenCanvas;
};

const at = (buffer: Uint8ClampedArray, x: number, y: number): [number, number, number, number] => {
  const index = (y * size.width + x) * 4;
  return [buffer[index], buffer[index + 1], buffer[index + 2], buffer[index + 3]];
};

const FIXTURE = new Uint8ClampedArray(size.width * size.height * 4);
for (let i = 0; i < FIXTURE.length; i += 4) {
  FIXTURE[i] = 50;
  FIXTURE[i + 1] = 100;
  FIXTURE[i + 2] = 150;
  FIXTURE[i + 3] = 255;
}

const gradientFixture = (): Uint8ClampedArray => {
  const data = new Uint8ClampedArray(size.width * size.height * 4);
  for (let y = 0; y < size.height; y++) {
    for (let x = 0; x < size.width; x++) {
      const offset = (y * size.width + x) * 4;
      data[offset] = x * 20;
      data[offset + 1] = 100;
      data[offset + 2] = y === 1 && x === 1 ? 160 : 100;
      data[offset + 3] = 255;
    }
  }
  return data;
};

const gradientPixel = (x: number, y: number): [number, number, number, number] => [
  x * 20,
  100,
  y === 1 && x === 1 ? 160 : 100,
  255,
];

beforeEach(() => {
  RecordingOffscreenCanvas.instances = [];
  vi.stubGlobal('OffscreenCanvas', RecordingOffscreenCanvas as unknown as typeof OffscreenCanvas);
});

afterEach(() => {
  vi.unstubAllGlobals();
  RecordingOffscreenCanvas.instances = [];
});

describe('healingBrush structure', () => {
  it('is the registered module-level processor for Healing Brush', async () => {
    const { toolProcessors } = await import('../toolProcessors.ts');
    expect(toolProcessors['healing-brush'].imageProcessor).toBe(healingBrush);
  });

  it('is a two-stage curried processor that reads its params and its args', () => {
    const bitmap = sourceBitmap(FIXTURE);
    const inner = healingBrush({ size, bitmap });

    expect(healingBrush.length).toBe(1);
    expect(inner.length).toBe(1);
  });

  it('allocates exactly one full-document canvas and draws the source bitmap into it', () => {
    const bitmap = sourceBitmap(FIXTURE);
    const [canvas] = healingBrush({ size, bitmap })(args());

    expect(RecordingOffscreenCanvas.instances).toHaveLength(1);
    expect(canvas).toBe(RecordingOffscreenCanvas.instances[0]);
    expect(canvas).not.toBe(bitmap);
    expect(vi.mocked(RecordingOffscreenCanvas.instances[0].ctx.drawImage).mock.calls[0][0]).toBe(bitmap);
  });
});

describe('healingBrush constants', () => {
  it('HEALING_BRUSH_SPACING_PERCENT is 25 (Adobe default spacing)', () => {
    expect(HEALING_BRUSH_SPACING_PERCENT).toBe(25);
  });

  it('healingBrush toolName is "healing-brush"', () => {
    expect(args().toolName).toBe('healing-brush');
  });
});

describe('healingBrush luminance correction', () => {
  it('corrects destination luminance toward source luminance at full opacity', () => {
    // Dest is mid-grey (128,128,128), source is bright blue (0,0,255) with luma ~29
    // At full opacity, destination should shift toward source luma
    const data = new Uint8ClampedArray(size.width * size.height * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 128;
      data[i + 1] = 128;
      data[i + 2] = 128;
      data[i + 3] = 255;
    }
    // Make source pixel at (4,4) blue
    const srcIdx = (4 * size.width + 4) * 4;
    data[srcIdx] = 0;
    data[srcIdx + 1] = 0;
    data[srcIdx + 2] = 255;
    data[srcIdx + 3] = 255;

    const canvas = run(data, args({ size: 3, opacity: 1, source: { x: 4, y: 4 }, points: [{ x: 4, y: 4 }] }));
    const [r, g, b] = at(canvas.pixels, 4, 4);
    // Luminance of source blue ~ 29, dest grey 128
    // Correction should pull toward 29
    expect(r).toBeLessThan(128);
    expect(g).toBeLessThan(128);
    expect(b).toBeGreaterThan(128); // Blue channel should increase
  });

  it('at zero opacity, destination is unchanged', () => {
    const data = new Uint8ClampedArray(size.width * size.height * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 100;
      data[i + 1] = 150;
      data[i + 2] = 200;
      data[i + 3] = 255;
    }

    const canvas = run(data, args({ opacity: 0 }));
    expect(canvas.pixels).toEqual(data);
  });
});

describe('healingBrush exact pixel coverage', () => {
  it('applies the exact luminance correction from an offset source pixel', () => {
    const canvas = run(
      gradientFixture(),
      args({
        size: 3,
        hardness: 100,
        opacity: 1,
        source: { x: 1, y: 1 },
        points: [{ x: 4, y: 4 }],
        aligned: true,
      })
    );

    // The offset is (-3,-3), so every point in this 3x3 block is inside radius 1.5;
    // the next axial pixels are distance 2 and remain untouched. Eight inner pixels
    // receive a 17.94 luminance correction; the center's (1,1) source pixel is blue,
    // so its correction is 11.1 and it rounds to [31, 111, 171].
    const healedPixels: Array<[number, number, [number, number, number, number]]> = [
      [3, 3, [18, 118, 118, 255]],
      [4, 3, [38, 118, 118, 255]],
      [5, 3, [58, 118, 118, 255]],
      [3, 4, [18, 118, 118, 255]],
      [4, 4, [31, 111, 171, 255]],
      [5, 4, [58, 118, 118, 255]],
      [3, 5, [18, 118, 118, 255]],
      [4, 5, [38, 118, 118, 255]],
      [5, 5, [58, 118, 118, 255]],
    ];
    for (const [x, y, expected] of healedPixels) {
      expect(at(canvas.pixels, x, y)).toEqual(expected);
    }
    for (const [x, y] of [
      [2, 4],
      [6, 4],
      [4, 2],
      [4, 6],
    ]) {
      expect(at(canvas.pixels, x, y)).toEqual(gradientPixel(x, y));
    }
  });

  it('uses cosine falloff for a soft tip and leaves the half-open rim untouched', () => {
    const canvas = run(
      gradientFixture(),
      args({
        size: 4,
        hardness: 0,
        opacity: 1,
        source: { x: 1, y: 1 },
        points: [{ x: 4, y: 4 }],
        aligned: true,
      })
    );

    expect(at(canvas.pixels, 3, 4)).toEqual([39, 109, 109, 255]);
    expect(at(canvas.pixels, 3, 3)).toEqual([52, 104, 104, 255]);
    expect(at(canvas.pixels, 2, 4)).toEqual(gradientPixel(2, 4));
  });

  it('scales the corrected color by partial opacity', () => {
    const canvas = run(
      gradientFixture(),
      args({
        size: 3,
        hardness: 100,
        opacity: 0.5,
        source: { x: 1, y: 1 },
        points: [{ x: 4, y: 4 }],
        aligned: true,
      })
    );

    expect(at(canvas.pixels, 4, 4)).toEqual([56, 106, 136, 255]);
  });

  it('keeps the historical last-dab offset for unaligned records without a samplingOffset', () => {
    const points = [
      { x: 4, y: 4 },
      { x: 6, y: 4 },
    ];
    const aligned = run(
      gradientFixture(),
      args({ size: 3, hardness: 100, opacity: 1, source: { x: 1, y: 1 }, points, aligned: true })
    );
    const free = run(
      gradientFixture(),
      args({ size: 3, hardness: 100, opacity: 1, source: { x: 1, y: 1 }, points, aligned: false })
    );

    expect(at(aligned.pixels, 6, 4)).toEqual([78, 118, 118, 255]);
    expect(at(free.pixels, 6, 4)).toEqual([43, 123, 183, 255]);
  });

  it('uses a persisted per-stroke offset in either alignment mode', () => {
    const points = [
      { x: 4, y: 4 },
      { x: 6, y: 4 },
    ];
    const samplingOffset = { x: -3, y: -3 };
    const aligned = run(
      gradientFixture(),
      args({
        size: 3,
        hardness: 100,
        opacity: 1,
        source: { x: 1, y: 1 },
        points,
        aligned: true,
        samplingOffset,
      })
    );
    const unaligned = run(
      gradientFixture(),
      args({
        size: 3,
        hardness: 100,
        opacity: 1,
        source: { x: 1, y: 1 },
        points,
        aligned: false,
        samplingOffset,
      })
    );

    expect(unaligned.pixels).toEqual(aligned.pixels);
    expect(at(unaligned.pixels, 6, 4)).toEqual([78, 118, 118, 255]);
  });

  it('treats a persisted zero offset as distinct from a missing legacy offset', () => {
    const data = gradientFixture();
    const current = run(
      data,
      args({
        source: { x: 1, y: 1 },
        points: [{ x: 4, y: 4 }],
        aligned: false,
        samplingOffset: { x: 0, y: 0 },
      })
    );
    const legacy = run(data, args({ source: { x: 1, y: 1 }, points: [{ x: 4, y: 4 }], aligned: false }));

    expect(current.pixels).toEqual(data);
    expect(legacy.pixels).not.toEqual(data);
  });

  it('reads the original source pixels across overlapping dabs', () => {
    const canvas = run(
      gradientFixture(),
      args({
        size: 8,
        hardness: 100,
        opacity: 1,
        source: { x: 1, y: 1 },
        aligned: true,
        points: [
          { x: 4, y: 4 },
          { x: 6, y: 4 },
        ],
      })
    );

    // The first dab changes (3,1), which the second dab uses as its source for (6,4).
    // Reading the live output there would compound the correction at the final center.
    expect(at(canvas.pixels, 3, 1)).toEqual([18, 118, 118, 255]);
    expect(at(canvas.pixels, 6, 4)).toEqual([78, 118, 118, 255]);
  });

  it('clamps source reads at both document edges', () => {
    const topLeft = run(
      gradientFixture(),
      args({
        size: 3,
        hardness: 100,
        opacity: 1,
        source: { x: 0, y: 0 },
        points: [{ x: 4, y: 4 }],
        aligned: true,
      })
    );
    const bottomRight = run(
      gradientFixture(),
      args({
        size: 3,
        hardness: 100,
        opacity: 1,
        source: { x: 8, y: 8 },
        points: [{ x: 4, y: 4 }],
        aligned: true,
      })
    );

    expect(at(topLeft.pixels, 3, 3)).toEqual([18, 118, 118, 255]);
    expect(at(bottomRight.pixels, 5, 5)).toEqual([142, 82, 82, 255]);
  });
});

describe('healingBrush source isolation (no self-read)', () => {
  it('reads from sourceData, not output buffer (anti-compounding invariant)', () => {
    // This is the critical test: healingBrush must read from the original source
    // and write to output, not read from its own output. If it read from output,
    // a long stroke would compound and shift color progressively.
    const data = new Uint8ClampedArray(size.width * size.height * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 100;
      data[i + 1] = 100;
      data[i + 2] = 100;
      data[i + 3] = 255;
    }
    // Source at (2,2) is red
    const srcIdx = (2 * size.width + 2) * 4;
    data[srcIdx] = 255;
    data[srcIdx + 1] = 0;
    data[srcIdx + 2] = 0;
    data[srcIdx + 3] = 255;

    // Single dab at center
    const canvas = run(data, args({ size: 3, source: { x: 2, y: 2 }, points: [{ x: 2, y: 2 }] }));
    const [r, g, b] = at(canvas.pixels, 2, 2);
    // Center should become red (source color from sourceData)
    expect(r).toBe(255);
    expect(g).toBe(0);
    expect(b).toBe(0);
  });
});

describe('healingBrush edge cases', () => {
  it('returns early for zero-width document (rasterSize guard)', () => {
    const zeroSize: Size = { width: 0, height: 9 };
    const data = new Uint8ClampedArray(0);
    const bmp = { width: 0, height: 9, pixels: data, close: vi.fn() } as unknown as ImageBitmap;
    const [canvas] = healingBrush({ size: zeroSize, bitmap: bmp })(args());
    expect(canvas.width).toBe(1);
    expect(canvas.height).toBe(9);
  });

  it('returns early for zero-height document (rasterSize guard)', () => {
    const zeroSize: Size = { width: 9, height: 0 };
    const data = new Uint8ClampedArray(0);
    const bmp = { width: 9, height: 0, pixels: data, close: vi.fn() } as unknown as ImageBitmap;
    const [canvas] = healingBrush({ size: zeroSize, bitmap: bmp })(args());
    expect(canvas.width).toBe(9);
    expect(canvas.height).toBe(1);
  });

  it('returns early when getImageData/putImageData are not functions', () => {
    vi.unstubAllGlobals();
    vi.stubGlobal(
      'OffscreenCanvas',
      class extends RecordingOffscreenCanvas {
        constructor(width: number, height: number) {
          super(width, height);
          this.ctx.getImageData = undefined as unknown as MockCtx['getImageData'];
          this.ctx.putImageData = undefined as unknown as MockCtx['putImageData'];
        }
      } as unknown as typeof OffscreenCanvas
    );

    const data = new Uint8ClampedArray(size.width * size.height * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 100;
      data[i + 1] = 100;
      data[i + 2] = 100;
      data[i + 3] = 255;
    }
    const [canvas] = healingBrush({ size, bitmap: sourceBitmap(data) })(args());
    const recCanvas = canvas as unknown as RecordingOffscreenCanvas;
    expect(recCanvas.width).toBe(size.width);
    expect(recCanvas.height).toBe(size.height);
    expect(recCanvas.pixels).toEqual(data);

    vi.unstubAllGlobals();
    vi.stubGlobal('OffscreenCanvas', RecordingOffscreenCanvas as unknown as typeof OffscreenCanvas);
  });

  it('handles non-square documents', () => {
    const nsSize: Size = { width: 800, height: 600 };
    const data = new Uint8ClampedArray(nsSize.width * nsSize.height * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 100;
      data[i + 1] = 100;
      data[i + 2] = 100;
      data[i + 3] = 255;
    }
    const bmp = { width: nsSize.width, height: nsSize.height, pixels: data, close: vi.fn() } as unknown as ImageBitmap;
    const [canvas] = healingBrush({ size: nsSize, bitmap: bmp })(args({ size: 10 }));
    expect(canvas.width).toBe(nsSize.width);
    expect(canvas.height).toBe(nsSize.height);
  });
});

describe('healingBrush clampBrushTipSettings interaction', () => {
  it('clamps size to [BRUSH_SIZE_MIN, BRUSH_SIZE_MAX]', () => {
    expect(() => run(FIXTURE, args({ size: BRUSH_SIZE_MIN - 1 }))).not.toThrow();
    expect(() => run(FIXTURE, args({ size: BRUSH_SIZE_MAX + 100 }))).not.toThrow();
    expect(() => run(FIXTURE, args({ size: -10 }))).not.toThrow();
    expect(() => run(FIXTURE, args({ size: Number.NaN }))).not.toThrow();
    expect(() => run(FIXTURE, args({ size: Number.POSITIVE_INFINITY }))).not.toThrow();
  });

  it('clamps hardness to [BRUSH_HARDNESS_MIN, BRUSH_HARDNESS_MAX]', () => {
    expect(() => run(FIXTURE, args({ hardness: BRUSH_HARDNESS_MIN - 1 }))).not.toThrow();
    expect(() => run(FIXTURE, args({ hardness: BRUSH_HARDNESS_MAX + 1 }))).not.toThrow();
    expect(() => run(FIXTURE, args({ hardness: Number.NaN }))).not.toThrow();
  });

  it('clamps opacity to valid range', () => {
    expect(() => run(FIXTURE, args({ opacity: -0.5 }))).not.toThrow();
    expect(() => run(FIXTURE, args({ opacity: 2 }))).not.toThrow();
  });

  it('settles non-finite tip settings on safe defaults', () => {
    const canvas = run(FIXTURE, args({ size: NaN, hardness: NaN, opacity: NaN }));
    expect(canvas.width).toBe(size.width);
    expect(canvas.height).toBe(size.height);
  });
});

describe('healingBrush point coordinate handling', () => {
  it('accepts non-integer point coordinates (floored by clampPointToSize)', () => {
    const canvas = run(FIXTURE, args({ size: 3, points: [{ x: 4.7, y: 4.3 }] }));
    expect(canvas.width).toBe(size.width);
    expect(canvas.height).toBe(size.height);
  });

  it('handles duplicate consecutive points (no-op second dab)', () => {
    const canvas = run(
      FIXTURE,
      args({
        size: 3,
        points: [
          { x: 4, y: 4 },
          { x: 4, y: 4 },
        ],
      })
    );
    RecordingOffscreenCanvas.instances = [];
    const canvasSingle = run(FIXTURE, args({ size: 3, points: [{ x: 4, y: 4 }] }));
    expect(canvas.pixels).toEqual(canvasSingle.pixels);
  });

  it('leaves every pixel unchanged when the whole stroke is outside the canvas', () => {
    const canvas = run(
      FIXTURE,
      args({
        size: 8,
        points: [
          { x: 40, y: 40 },
          { x: 44, y: 44 },
        ],
      })
    );

    expect(canvas.pixels).toEqual(FIXTURE);
  });
});

describe('healingBrush empty points array', () => {
  it('returns canvas with source drawn when points array is empty', () => {
    const data = new Uint8ClampedArray(size.width * size.height * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 100;
      data[i + 1] = 100;
      data[i + 2] = 100;
      data[i + 3] = 255;
    }
    const [canvas] = healingBrush({ size, bitmap: sourceBitmap(data) })(args({ points: [] }));
    expect(canvas.width).toBe(size.width);
    expect(canvas.height).toBe(size.height);
    const recCanvas = canvas as unknown as RecordingOffscreenCanvas;
    expect(recCanvas.pixels).toEqual(data);
  });
});

describe('healingBrush zero/negative opacity', () => {
  it('opacity 0 produces no change', () => {
    const data = new Uint8ClampedArray(size.width * size.height * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 100;
      data[i + 1] = 100;
      data[i + 2] = 100;
      data[i + 3] = 255;
    }
    const result = healingBrush({ size, bitmap: sourceBitmap(data) })(args({ opacity: 0 }));
    const recCanvas = result[0] as unknown as RecordingOffscreenCanvas;
    expect(recCanvas.pixels).toEqual(data);
  });

  it('negative opacity clamped to 0', () => {
    const data = new Uint8ClampedArray(size.width * size.height * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 100;
      data[i + 1] = 100;
      data[i + 2] = 100;
      data[i + 3] = 255;
    }
    const result = healingBrush({ size, bitmap: sourceBitmap(data) })(args({ opacity: -0.5 }));
    const recCanvas = result[0] as unknown as RecordingOffscreenCanvas;
    expect(recCanvas.pixels).toEqual(data);
  });
});

describe('healingBrush HEALING_BRUSH_SPACING_PERCENT behavior', () => {
  it('spacing constant affects dab density along stroke', () => {
    expect(HEALING_BRUSH_SPACING_PERCENT).toBe(25);
  });
});

describe('healingBrush missing source returns early', () => {
  it('returns canvas with source drawn when source is null', () => {
    const data = new Uint8ClampedArray(size.width * size.height * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 100;
      data[i + 1] = 100;
      data[i + 2] = 100;
      data[i + 3] = 255;
    }
    const [canvas] = healingBrush({ size, bitmap: sourceBitmap(data) })(args({ source: null }));
    expect(canvas.width).toBe(size.width);
    expect(canvas.height).toBe(size.height);
    const recCanvas = canvas as unknown as RecordingOffscreenCanvas;
    expect(recCanvas.pixels).toEqual(data);
  });
});
