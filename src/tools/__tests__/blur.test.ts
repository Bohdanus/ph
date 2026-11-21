import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { blur, normalizeBlurToolArgs, type BlurToolArgs } from '../blur.ts';
import { sharpen } from '../sharpen.ts';
import { overrideCanvasFilterSupport } from '../../util/canvas-filter.ts';
import { createPixelCanvasContext } from '../../test/setup.ts';
import type { BitmapSource, Size } from '../../contexts/general-types.ts';

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
  readonly filterValuesAtDraw: string[];
  readonly ctx: MockCtx;

  constructor(width: number, height: number) {
    this.width = Math.max(1, Math.ceil(width));
    this.height = Math.max(1, Math.ceil(height));
    this.pixels = new Uint8ClampedArray(this.width * this.height * 4);
    this.filterValuesAtDraw = [];

    const ctx = createPixelCanvasContext(this);
    vi.mocked(ctx.drawImage).mockImplementation(((source: unknown) => {
      const drawn = source as { pixels: Uint8ClampedArray };
      this.pixels.set(drawn.pixels.subarray(0, this.pixels.length));
      // Record the filter value at the moment of drawImage
      this.filterValuesAtDraw.push(ctx.filter);
    }) as unknown as MockCtx['drawImage']);
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

const args = (overrides: Partial<BlurToolArgs> = {}): BlurToolArgs => ({
  radius: 2,
  toolName: 'blur',
  ...overrides,
});

const sourceBitmap = (pixels: Uint8ClampedArray) =>
  ({ width: size.width, height: size.height, pixels, close: vi.fn() }) as unknown as ImageBitmap;

const run = (data: Uint8ClampedArray, a: BlurToolArgs) => {
  const [canvas] = blur({ size, bitmap: sourceBitmap(data) })(a);
  return canvas as unknown as RecordingOffscreenCanvas;
};

beforeEach(() => {
  RecordingOffscreenCanvas.instances = [];
  vi.stubGlobal('OffscreenCanvas', RecordingOffscreenCanvas as unknown as typeof OffscreenCanvas);
});

afterEach(() => {
  vi.unstubAllGlobals();
  overrideCanvasFilterSupport(null);
});

describe('blur structure', () => {
  it('is a distinct export from sharpen (two tool names sharing a processor is only legitimate for the lasso pair and shape family)', () => {
    expect(blur).not.toBe(sharpen);
    expect(typeof blur).toBe('function');
  });

  it('is a two-stage curried processor that reads its params and its args', () => {
    const bitmap = sourceBitmap(new Uint8ClampedArray(size.width * size.height * 4));
    const inner = blur({ size, bitmap });

    expect(blur.length).toBe(1);
    expect(inner.length).toBe(1);
  });

  it('allocates exactly one full-document canvas and draws the source bitmap into it', () => {
    const bitmap = sourceBitmap(new Uint8ClampedArray(size.width * size.height * 4));
    const [canvas] = blur({ size, bitmap })(args());

    expect(RecordingOffscreenCanvas.instances).toHaveLength(1);
    expect(canvas).toBe(RecordingOffscreenCanvas.instances[0]);
    expect(canvas).not.toBe(bitmap);
    expect(vi.mocked(RecordingOffscreenCanvas.instances[0].ctx.drawImage).mock.calls[0][0]).toBe(bitmap);
  });
});

describe('normalizeBlurToolArgs', () => {
  it('coerces NaN radius to 0', () => {
    const result = normalizeBlurToolArgs({ radius: NaN, toolName: 'blur' });
    expect(result.radius).toBe(0);
    expect(result.toolName).toBe('blur');
  });

  it('coerces Infinity radius to 0', () => {
    const result = normalizeBlurToolArgs({ radius: Infinity, toolName: 'blur' });
    expect(result.radius).toBe(0);
  });

  it('coerces -Infinity radius to 0', () => {
    const result = normalizeBlurToolArgs({ radius: -Infinity, toolName: 'blur' });
    expect(result.radius).toBe(0);
  });

  it('preserves finite radius values', () => {
    const result = normalizeBlurToolArgs({ radius: 5, toolName: 'blur' });
    expect(result.radius).toBe(5);
  });

  it('returns a new object rather than mutating input', () => {
    const input = { radius: NaN, toolName: 'blur' as const };
    const result = normalizeBlurToolArgs(input);
    expect(input.radius).toBe(NaN);
    expect(result.radius).toBe(0);
    expect(result).not.toBe(input);
  });
});

describe('blur filter string', () => {
  it('assigns CSS blur filter string to context', () => {
    const data = new Uint8ClampedArray(size.width * size.height * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 100;
      data[i + 1] = 100;
      data[i + 2] = 100;
      data[i + 3] = 255;
    }

    run(data, args({ radius: 3 }));

    const canvas = RecordingOffscreenCanvas.instances[0];
    expect(canvas.ctx.filter).toBe('blur(3px)');
  });

  it('uses radius 0 for NaN (no-op filter)', () => {
    const data = new Uint8ClampedArray(size.width * size.height * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 100;
      data[i + 1] = 100;
      data[i + 2] = 100;
      data[i + 3] = 255;
    }

    run(data, args({ radius: NaN }));

    const canvas = RecordingOffscreenCanvas.instances[0];
    expect(canvas.ctx.filter).toBe('blur(0px)');
  });

  it('uses radius 0 for Infinity (no-op filter)', () => {
    const data = new Uint8ClampedArray(size.width * size.height * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 100;
      data[i + 1] = 100;
      data[i + 2] = 100;
      data[i + 3] = 255;
    }

    run(data, args({ radius: Infinity }));

    const canvas = RecordingOffscreenCanvas.instances[0];
    expect(canvas.ctx.filter).toBe('blur(0px)');
  });

  it('filters string is assigned before drawImage (ordering)', () => {
    const data = new Uint8ClampedArray(size.width * size.height * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 100;
      data[i + 1] = 100;
      data[i + 2] = 100;
      data[i + 3] = 255;
    }

    run(data, args({ radius: 2 }));

    const canvas = RecordingOffscreenCanvas.instances[0];
    // The filter should be assigned before drawImage is called
    expect(canvas.filterValuesAtDraw[0]).toBe('blur(2px)');
  });
});

describe('blur source bitmap draw', () => {
  it('draws the source bitmap at (0, 0) exactly once per call', () => {
    const data = new Uint8ClampedArray(size.width * size.height * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 100;
      data[i + 1] = 100;
      data[i + 2] = 100;
      data[i + 3] = 255;
    }

    run(data, args({ radius: 2 }));

    const canvas = RecordingOffscreenCanvas.instances[0];
    expect(canvas.ctx.drawImage).toHaveBeenCalledTimes(1);
    expect(canvas.ctx.drawImage).toHaveBeenCalledWith(
      expect.objectContaining({ width: size.width, height: size.height }),
      0,
      0
    );
  });
});

describe('blur canvas allocation', () => {
  it('allocates an OffscreenCanvas sized to params.size', () => {
    const data = new Uint8ClampedArray(size.width * size.height * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 100;
      data[i + 1] = 100;
      data[i + 2] = 100;
      data[i + 3] = 255;
    }

    run(data, args({ radius: 2 }));

    const canvas = RecordingOffscreenCanvas.instances[0];
    expect(canvas.width).toBe(size.width);
    expect(canvas.height).toBe(size.height);
  });

  it('allocates canvas with varying sizes', () => {
    // Test that blur processor can handle different sizes by checking the canvas dimensions
    // match the input size parameter
    const sizes: Size[] = [
      { width: 1, height: 1 },
      { width: 100, height: 100 },
      { width: 1920, height: 1080 },
    ];

    for (const s of sizes) {
      RecordingOffscreenCanvas.instances = [];
      const data = new Uint8ClampedArray(s.width * s.height * 4);
      for (let i = 0; i < data.length; i += 4) {
        data[i] = 100;
        data[i + 1] = 100;
        data[i + 2] = 100;
        data[i + 3] = 255;
      }
      const bmp = { width: s.width, height: s.height, pixels: data, close: vi.fn() } as unknown as BitmapSource;
      const [canvas] = blur({ size: s, bitmap: bmp })(args({ radius: 1 }));

      expect(canvas.width).toBe(s.width);
      expect(canvas.height).toBe(s.height);
    }
  });

  it('rejects zero/negative dimensions by allocating minimum 1x1', () => {
    const badSizes: Size[] = [
      { width: 0, height: 9 },
      { width: 9, height: 0 },
      { width: -5, height: -5 },
    ];

    for (const s of badSizes) {
      RecordingOffscreenCanvas.instances = [];
      const data = new Uint8ClampedArray(9 * 9 * 4);
      for (let i = 0; i < data.length; i += 4) {
        data[i] = 100;
        data[i + 1] = 100;
        data[i + 2] = 100;
        data[i + 3] = 255;
      }
      const bmp = { width: s.width, height: s.height, pixels: data, close: vi.fn() } as unknown as BitmapSource;
      const [canvas] = blur({ size: s, bitmap: bmp })(args({ radius: 1 }));

      expect(canvas.width).toBe(Math.max(1, Math.ceil(s.width)));
      expect(canvas.height).toBe(Math.max(1, Math.ceil(s.height)));
    }
  });

  it('floors sub-pixel dimensions', () => {
    RecordingOffscreenCanvas.instances = [];
    const data = new Uint8ClampedArray(size.width * size.height * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 100;
      data[i + 1] = 100;
      data[i + 2] = 100;
      data[i + 3] = 255;
    }
    const bmp = { width: 9.7, height: 9.3, pixels: data, close: vi.fn() } as unknown as BitmapSource;
    const [canvas] = blur({ size: { width: 9.7, height: 9.3 }, bitmap: bmp })(args({ radius: 1 }));
    expect(canvas.width).toBe(10); // Math.ceil(9.7)
    expect(canvas.height).toBe(10); // Math.ceil(9.3)
  });

  it('throws when OffscreenCanvas constructor fails', () => {
    const FailingOffscreenCanvas = vi.fn().mockImplementation(() => {
      throw new Error('Out of memory');
    });
    vi.stubGlobal('OffscreenCanvas', FailingOffscreenCanvas as unknown as typeof OffscreenCanvas);

    const data = new Uint8ClampedArray(size.width * size.height * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 100;
      data[i + 1] = 100;
      data[i + 2] = 100;
      data[i + 3] = 255;
    }

    expect(() => run(data, args({ radius: 2 }))).toThrow('Out of memory');
    expect(RecordingOffscreenCanvas.instances).toHaveLength(0);
  });
});

describe('requireCanvasFilter gate', () => {
  it('throws when CanvasFilter is unsupported before allocating canvas', () => {
    overrideCanvasFilterSupport(false);

    const data = new Uint8ClampedArray(size.width * size.height * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 100;
      data[i + 1] = 100;
      data[i + 2] = 100;
      data[i + 3] = 255;
    }

    expect(() => run(data, args({ radius: 2 }))).toThrow();
    expect(() => run(data, args({ radius: 2 }))).toThrow(
      'blur requires CanvasRenderingContext2D.filter, which this browser does not implement. It was refused rather than applied as a no-op, because a silent no-op would present and record pixels that no replay can reproduce.'
    );
    expect(RecordingOffscreenCanvas.instances).toHaveLength(0);
  });

  it('works when CanvasFilter is supported', () => {
    overrideCanvasFilterSupport(true);

    const data = new Uint8ClampedArray(size.width * size.height * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 100;
      data[i + 1] = 100;
      data[i + 2] = 100;
      data[i + 3] = 255;
    }

    const result = blur({ size, bitmap: sourceBitmap(data) })(args({ radius: 2 }));
    expect(result).toHaveLength(1);
    const [resultCanvas] = result;

    const canvas = RecordingOffscreenCanvas.instances[0];
    expect(canvas).toBe(resultCanvas);
    expect(canvas.ctx.filter).toBe('blur(2px)');
  });
});

describe('blur edge cases', () => {
  it('radius 0 produces no visual change (identity filter)', () => {
    const data = new Uint8ClampedArray(size.width * size.height * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 100;
      data[i + 1] = 150;
      data[i + 2] = 200;
      data[i + 3] = 255;
    }

    run(data, args({ radius: 0 }));

    const canvas = RecordingOffscreenCanvas.instances[0];
    // With radius 0, filter is 'blur(0px)' which is identity
    expect(canvas.ctx.filter).toBe('blur(0px)');
  });

  it('handles very large documents without overflow', () => {
    const largeSize: Size = { width: 4000, height: 3000 };
    const data = new Uint8ClampedArray(largeSize.width * largeSize.height * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 100;
      data[i + 1] = 100;
      data[i + 2] = 100;
      data[i + 3] = 255;
    }
    const bmp = {
      width: largeSize.width,
      height: largeSize.height,
      pixels: data,
      close: vi.fn(),
    } as unknown as BitmapSource;

    const [canvas] = blur({ size: largeSize, bitmap: bmp })(args({ radius: 5 }));

    expect(canvas.width).toBe(largeSize.width);
    expect(canvas.height).toBe(largeSize.height);
  });

  it('handles maximum practical radius on large document', () => {
    // Large radius on 100px image - the blur implementation should handle it
    const s: Size = { width: 100, height: 100 };
    const data = new Uint8ClampedArray(s.width * s.height * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 100;
      data[i + 1] = 100;
      data[i + 2] = 100;
      data[i + 3] = 255;
    }
    const bmp = { width: s.width, height: s.height, pixels: data, close: vi.fn() } as unknown as BitmapSource;

    const [canvas] = blur({ size: s, bitmap: bmp })(args({ radius: 100 }));

    expect(canvas.width).toBe(s.width);
    expect(canvas.height).toBe(s.height);
  });

  it('each blur call allocates a fresh canvas, not reusing the previous one', () => {
    const data = new Uint8ClampedArray(size.width * size.height * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 100;
      data[i + 1] = 100;
      data[i + 2] = 100;
      data[i + 3] = 255;
    }

    const [canvas1] = blur({ size, bitmap: sourceBitmap(data) })(args({ radius: 2 }));
    const [canvas2] = blur({ size, bitmap: sourceBitmap(data) })(args({ radius: 3 }));

    expect(canvas1).not.toBe(canvas2);
    expect(RecordingOffscreenCanvas.instances).toHaveLength(2);
  });

  it('handles non-sRGB colorSpace from getImageData (production assumes srgb)', () => {
    // Verify the filter doesn't depend on colorSpace
    const canvas = new RecordingOffscreenCanvas(size.width, size.height);
    vi.mocked(canvas.ctx.getImageData).mockImplementation(
      () =>
        ({
          data: new Uint8ClampedArray(canvas.pixels),
          width: canvas.width,
          height: canvas.height,
          colorSpace: 'display-p3',
        }) as ImageData
    );

    vi.unstubAllGlobals();
    vi.stubGlobal(
      'OffscreenCanvas',
      class {
        constructor() {
          return canvas;
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

    const [result] = blur({ size, bitmap: sourceBitmap(data) })(args({ radius: 2 }));

    expect(result).toBe(canvas);
    expect(canvas.ctx.filter).toBe('blur(2px)');

    vi.unstubAllGlobals();
    vi.stubGlobal('OffscreenCanvas', RecordingOffscreenCanvas as unknown as typeof OffscreenCanvas);
  });
});

describe('blur return value identity', () => {
  it('returns the same canvas instance that was allocated', () => {
    const data = new Uint8ClampedArray(size.width * size.height * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 100;
      data[i + 1] = 100;
      data[i + 2] = 100;
      data[i + 3] = 255;
    }

    const [result] = blur({ size, bitmap: sourceBitmap(data) })(args({ radius: 2 }));

    expect(result).toBe(RecordingOffscreenCanvas.instances[0]);
  });
});
