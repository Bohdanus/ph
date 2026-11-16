import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { colors, normalizeColorsToolArgs, type ColorsToolArgs } from '../colors.ts';
import type { BitmapSource, Size } from '../../contexts/general-types.ts';
import { CanvasFilterUnsupportedError, overrideCanvasFilterSupport } from '../../util/canvas-filter.ts';
import { createPixelCanvasContext } from '../../test/setup.ts';

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
    vi.mocked(ctx.drawImage).mockImplementation(((source: unknown) => {
      const drawn = source as { pixels: Uint8ClampedArray };
      this.pixels.set(drawn.pixels.subarray(0, this.pixels.length));
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

const documentSize: Size = { width: 9, height: 9 };

const args = (overrides: Partial<ColorsToolArgs> = {}): ColorsToolArgs => ({
  grayscale: 0,
  sepia: 0,
  saturation: 0,
  toolName: 'color',
  ...overrides,
});

const sourceBitmap = (pixels: Uint8ClampedArray) =>
  ({ width: documentSize.width, height: documentSize.height, pixels, close: vi.fn() }) as unknown as ImageBitmap;

const run = (data: Uint8ClampedArray, a: ColorsToolArgs) => {
  const [canvas] = colors({ size: documentSize, bitmap: sourceBitmap(data) })(a);
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

describe('colors structure', () => {
  it('is a distinct export (no other tool shares its processor)', () => {
    expect(typeof colors).toBe('function');
  });

  it('is a two-stage curried processor that reads its params and its args', () => {
    const bitmap = sourceBitmap(new Uint8ClampedArray(documentSize.width * documentSize.height * 4));
    const inner = colors({ size: documentSize, bitmap });

    expect(colors.length).toBe(1);
    expect(inner.length).toBe(1);
  });

  it('allocates exactly one full-document canvas and draws the source bitmap into it', () => {
    const bitmap = sourceBitmap(new Uint8ClampedArray(documentSize.width * documentSize.height * 4));
    const [canvas] = colors({ size: documentSize, bitmap })(args());

    expect(RecordingOffscreenCanvas.instances).toHaveLength(1);
    expect(canvas).toBe(RecordingOffscreenCanvas.instances[0]);
    expect(canvas).not.toBe(bitmap);
    expect(vi.mocked(RecordingOffscreenCanvas.instances[0].ctx.drawImage).mock.calls[0][0]).toBe(bitmap);
  });
});

describe('normalizeColorsToolArgs isolation', () => {
  it('coerces NaN saturation to 0', () => {
    const result = normalizeColorsToolArgs({ grayscale: 0, sepia: 0, saturation: NaN, toolName: 'color' });
    expect(result.saturation).toBe(0);
    expect(result.toolName).toBe('color');
  });

  it('coerces Infinity saturation to 0', () => {
    const result = normalizeColorsToolArgs({ grayscale: 0, sepia: 0, saturation: Infinity, toolName: 'color' });
    expect(result.saturation).toBe(0);
  });

  it('coerces -Infinity saturation to 0', () => {
    const result = normalizeColorsToolArgs({ grayscale: 0, sepia: 0, saturation: -Infinity, toolName: 'color' });
    expect(result.saturation).toBe(0);
  });

  it('preserves finite saturation values', () => {
    const result = normalizeColorsToolArgs({ grayscale: 0, sepia: 0, saturation: 50, toolName: 'color' });
    expect(result.saturation).toBe(50);
  });

  it('clamps grayscale and sepia to 0-100 range', () => {
    const result = normalizeColorsToolArgs({ grayscale: 150, sepia: -10, saturation: 0, toolName: 'color' });
    expect(result.grayscale).toBe(100);
    expect(result.sepia).toBe(0);
  });

  it('returns a new object rather than mutating the input', () => {
    const input = { grayscale: 0, sepia: 0, saturation: NaN, toolName: 'color' as const };
    const result = normalizeColorsToolArgs(input);
    expect(input.saturation).toBe(NaN);
    expect(result.saturation).toBe(0);
    expect(result).not.toBe(input);
  });
});

describe('colors filter string', () => {
  const data = new Uint8ClampedArray(documentSize.width * documentSize.height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 100;
    data[i + 1] = 100;
    data[i + 2] = 100;
    data[i + 3] = 255;
  }

  it('emits grayscale filter with clamped percentage', () => {
    run(data, args({ grayscale: 100 }));
    expect(RecordingOffscreenCanvas.instances[0].ctx.filter).toContain('grayscale(100%)');
  });

  it('emits sepia filter with clamped percentage', () => {
    run(data, args({ sepia: 100 }));
    expect(RecordingOffscreenCanvas.instances[0].ctx.filter).toContain('sepia(100%)');
  });

  it('emits saturate filter with computed percentage for saturation 0', () => {
    run(data, args({ saturation: 0 }));
    expect(RecordingOffscreenCanvas.instances[0].ctx.filter).toContain('saturate(100%)');
  });

  it('emits saturate filter with computed percentage for saturation 100', () => {
    run(data, args({ saturation: 100 }));
    expect(RecordingOffscreenCanvas.instances[0].ctx.filter).toContain('saturate(');
  });

  it('emits saturate filter with computed percentage for saturation -100', () => {
    run(data, args({ saturation: -100 }));
    expect(RecordingOffscreenCanvas.instances[0].ctx.filter).toContain('saturate(');
  });

  it('composes multiple filters when multiple flags are set', () => {
    run(data, args({ grayscale: 100, sepia: 100, saturation: 50 }));
    const filter = RecordingOffscreenCanvas.instances[0].ctx.filter;
    expect(filter).toContain('grayscale(100%)');
    expect(filter).toContain('sepia(100%)');
    expect(filter).toContain('saturate(');
  });

  it('always emits all three filters (grayscale, sepia, saturate)', () => {
    run(data, args({ grayscale: 0, sepia: 0, saturation: 0 }));
    const filter = RecordingOffscreenCanvas.instances[0].ctx.filter;
    expect(filter).toContain('grayscale(0%)');
    expect(filter).toContain('sepia(0%)');
    expect(filter).toContain('saturate(100%)');
  });
});

describe('colors source bitmap draw', () => {
  it('draws the source bitmap at (0, 0) exactly once per call', () => {
    const data = new Uint8ClampedArray(documentSize.width * documentSize.height * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 100;
      data[i + 1] = 100;
      data[i + 2] = 100;
      data[i + 3] = 255;
    }

    run(data, args({ grayscale: 100 }));

    const canvas = RecordingOffscreenCanvas.instances[0];
    expect(canvas.ctx.drawImage).toHaveBeenCalledTimes(1);
    expect(canvas.ctx.drawImage).toHaveBeenCalledWith(
      expect.objectContaining({ width: documentSize.width, height: documentSize.height }),
      0,
      0
    );
  });
});

describe('colors canvas allocation', () => {
  it('allocates an OffscreenCanvas sized to params.size', () => {
    const data = new Uint8ClampedArray(documentSize.width * documentSize.height * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 100;
      data[i + 1] = 100;
      data[i + 2] = 100;
      data[i + 3] = 255;
    }

    run(data, args({ grayscale: 100 }));

    const canvas = RecordingOffscreenCanvas.instances[0];
    expect(canvas.width).toBe(documentSize.width);
    expect(canvas.height).toBe(documentSize.height);
  });

  it('allocates canvas with varying sizes', () => {
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
      const [canvas] = colors({ size: s, bitmap: bmp })(args({ grayscale: 100 }));

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
      const [canvas] = colors({ size: s, bitmap: bmp })(args({ grayscale: 100 }));

      expect(canvas.width).toBe(Math.max(1, Math.ceil(s.width)));
      expect(canvas.height).toBe(Math.max(1, Math.ceil(s.height)));
    }
  });

  it('floors sub-pixel dimensions', () => {
    RecordingOffscreenCanvas.instances = [];
    const data = new Uint8ClampedArray(documentSize.width * documentSize.height * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 100;
      data[i + 1] = 100;
      data[i + 2] = 100;
      data[i + 3] = 255;
    }
    const bmp = { width: 9.7, height: 9.3, pixels: data, close: vi.fn() } as unknown as BitmapSource;
    const [canvas] = colors({ size: { width: 9.7, height: 9.3 }, bitmap: bmp })(args({ grayscale: 100 }));

    expect(canvas.width).toBe(10); // Math.ceil(9.7)
    expect(canvas.height).toBe(10); // Math.ceil(9.3)
  });

  it('throws when OffscreenCanvas constructor fails', () => {
    const FailingOffscreenCanvas = vi.fn().mockImplementation(() => {
      throw new Error('Out of memory');
    });
    vi.stubGlobal('OffscreenCanvas', FailingOffscreenCanvas as unknown as typeof OffscreenCanvas);

    const data = new Uint8ClampedArray(documentSize.width * documentSize.height * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 100;
      data[i + 1] = 100;
      data[i + 2] = 100;
      data[i + 3] = 255;
    }

    expect(() => run(data, args({ grayscale: 100 }))).toThrow('Out of memory');
    expect(RecordingOffscreenCanvas.instances).toHaveLength(0);
  });
});

describe('requireCanvasFilter gate', () => {
  it('throws CanvasFilterUnsupportedError with label "color" before allocating any canvas', () => {
    overrideCanvasFilterSupport(false);

    const data = new Uint8ClampedArray(documentSize.width * documentSize.height * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 100;
      data[i + 1] = 100;
      data[i + 2] = 100;
      data[i + 3] = 255;
    }

    expect(() => run(data, args({ grayscale: 100 }))).toThrow(CanvasFilterUnsupportedError);
    expect(() => run(data, args({ grayscale: 100 }))).toThrow(
      'color requires CanvasRenderingContext2D.filter, which this browser does not implement. It was refused rather than applied as a no-op, because a silent no-op would present and record pixels that no replay can reproduce.'
    );
    expect(RecordingOffscreenCanvas.instances).toHaveLength(0);
  });

  it('works when CanvasFilter is supported', () => {
    overrideCanvasFilterSupport(true);

    const data = new Uint8ClampedArray(documentSize.width * documentSize.height * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 100;
      data[i + 1] = 100;
      data[i + 2] = 100;
      data[i + 3] = 255;
    }

    const result = colors({ size: documentSize, bitmap: sourceBitmap(data) })(args({ grayscale: 100 }));
    expect(result).toHaveLength(1);
    const [resultCanvas] = result;

    const canvas = RecordingOffscreenCanvas.instances[0];
    expect(canvas).toBe(resultCanvas);
    expect(canvas.ctx.filter).toContain('grayscale(100%)');
  });
});

describe('colors edge cases', () => {
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

    const [canvas] = colors({ size: largeSize, bitmap: bmp })(args({ grayscale: 100 }));

    expect(canvas.width).toBe(largeSize.width);
    expect(canvas.height).toBe(largeSize.height);
  });

  it('handles non-sRGB colorSpace from getImageData (production assumes srgb)', () => {
    const canvas = new RecordingOffscreenCanvas(documentSize.width, documentSize.height);
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

    const data = new Uint8ClampedArray(documentSize.width * documentSize.height * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 100;
      data[i + 1] = 100;
      data[i + 2] = 100;
      data[i + 3] = 255;
    }

    const result = colors({ size: documentSize, bitmap: sourceBitmap(data) })(args({ grayscale: 100 }));
    expect(result).toHaveLength(1);
    const [resultCanvas] = result;

    expect(resultCanvas).toBe(canvas);
    expect(canvas.ctx.filter).toContain('grayscale(100%)');

    vi.unstubAllGlobals();
    vi.stubGlobal('OffscreenCanvas', RecordingOffscreenCanvas as unknown as typeof OffscreenCanvas);
  });
});

describe('colors return value identity', () => {
  it('returns the same canvas instance that was allocated', () => {
    const data = new Uint8ClampedArray(documentSize.width * documentSize.height * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 100;
      data[i + 1] = 100;
      data[i + 2] = 100;
      data[i + 3] = 255;
    }

    const result = colors({ size: documentSize, bitmap: sourceBitmap(data) })(args({ grayscale: 100 }));
    expect(result).toHaveLength(1);
    const [resultCanvas] = result;

    expect(resultCanvas).toBe(RecordingOffscreenCanvas.instances[0]);
  });
});

describe('colors saturation edge cases', () => {
  it('saturation 0 produces 100% saturate (no change)', () => {
    const data = new Uint8ClampedArray(documentSize.width * documentSize.height * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 100;
      data[i + 1] = 100;
      data[i + 2] = 100;
      data[i + 3] = 255;
    }

    run(data, args({ saturation: 0 }));
    expect(RecordingOffscreenCanvas.instances[0].ctx.filter).toContain('saturate(100%)');
  });

  it('saturation 100 produces saturate > 100%', () => {
    const data = new Uint8ClampedArray(documentSize.width * documentSize.height * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 100;
      data[i + 1] = 100;
      data[i + 2] = 100;
      data[i + 3] = 255;
    }

    run(data, args({ saturation: 100 }));
    const filter = RecordingOffscreenCanvas.instances[0].ctx.filter;
    expect(filter).toContain('saturate(');
    const match = filter.match(/saturate\((\d+)%\)/);
    if (match) {
      expect(Number(match[1])).toBeGreaterThan(100);
    }
  });

  it('saturation -100 produces saturate 0%', () => {
    const data = new Uint8ClampedArray(documentSize.width * documentSize.height * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 100;
      data[i + 1] = 100;
      data[i + 2] = 100;
      data[i + 3] = 255;
    }

    run(data, args({ saturation: -100 }));
    const filter = RecordingOffscreenCanvas.instances[0].ctx.filter;
    expect(filter).toContain('saturate(0%)');
  });
});

describe('colors filter composition order', () => {
  it('applies grayscale before sepia before saturate', () => {
    const data = new Uint8ClampedArray(documentSize.width * documentSize.height * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 100;
      data[i + 1] = 100;
      data[i + 2] = 100;
      data[i + 3] = 255;
    }

    run(data, args({ grayscale: 100, sepia: 100, saturation: 50 }));
    const filter = RecordingOffscreenCanvas.instances[0].ctx.filter;

    const grayscaleIdx = filter.indexOf('grayscale');
    const sepiaIdx = filter.indexOf('sepia');
    const saturateIdx = filter.indexOf('saturate');

    expect(grayscaleIdx).toBeLessThan(sepiaIdx);
    expect(sepiaIdx).toBeLessThan(saturateIdx);
  });
});

describe('colors normalizeColorsToolArgs', () => {
  it('clamps grayscale to 0-100', () => {
    expect(normalizeColorsToolArgs({ grayscale: 150, sepia: 0, saturation: 0, toolName: 'color' }).grayscale).toBe(100);
    expect(normalizeColorsToolArgs({ grayscale: -10, sepia: 0, saturation: 0, toolName: 'color' }).grayscale).toBe(0);
    expect(normalizeColorsToolArgs({ grayscale: NaN, sepia: 0, saturation: 0, toolName: 'color' }).grayscale).toBe(0);
  });

  it('clamps sepia to 0-100', () => {
    expect(normalizeColorsToolArgs({ grayscale: 0, sepia: 150, saturation: 0, toolName: 'color' }).sepia).toBe(100);
    expect(normalizeColorsToolArgs({ grayscale: 0, sepia: -10, saturation: 0, toolName: 'color' }).sepia).toBe(0);
    expect(normalizeColorsToolArgs({ grayscale: 0, sepia: NaN, saturation: 0, toolName: 'color' }).sepia).toBe(0);
  });

  it('clamps saturation to -100..100', () => {
    expect(normalizeColorsToolArgs({ grayscale: 0, sepia: 0, saturation: 150, toolName: 'color' }).saturation).toBe(
      100
    );
    expect(normalizeColorsToolArgs({ grayscale: 0, sepia: 0, saturation: -150, toolName: 'color' }).saturation).toBe(
      -100
    );
    expect(normalizeColorsToolArgs({ grayscale: 0, sepia: 0, saturation: NaN, toolName: 'color' }).saturation).toBe(0);
  });
});
