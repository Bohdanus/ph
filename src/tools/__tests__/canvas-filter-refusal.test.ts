import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { blur } from '../blur.ts';
import { colors } from '../colors.ts';
import { levels } from '../levels.ts';
import type { ProcessorToolParams } from '../toolProcessors.ts';
import { CanvasFilterUnsupportedError, overrideCanvasFilterSupport } from '../../util/canvas-filter.ts';
import { createPixelCanvasContext } from '../../test/setup.ts';
import type { BitmapSource } from '../../contexts/general-types.ts';

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

    this.ctx = ctx;
    RecordingOffscreenCanvas.instances.push(this);
  }

  getContext(): MockCtx {
    return this.ctx;
  }
}

type FilterToolCase = {
  toolName: 'blur' | 'color' | 'levels';
  run: (bitmap: BitmapSource, size: { width: number; height: number }, args: Record<string, unknown>) => unknown[];
};

const FILTER_TOOLS: readonly FilterToolCase[] = [
  {
    toolName: 'blur',
    run: (bitmap, size, args) => blur({ size, bitmap })(args as { radius: number; toolName: 'blur' }),
  },
  {
    toolName: 'color',
    run: (bitmap, size, args) =>
      colors({ size, bitmap })(args as { grayscale: number; sepia: number; saturation: number; toolName: 'color' }),
  },
  {
    toolName: 'levels',
    run: (bitmap, size, args) =>
      levels({ size, bitmap })(args as { brightness: number; contrast: number; toolName: 'levels' }),
  },
] as const;

const size = { width: 8, height: 8 };

const makeData = (): Uint8ClampedArray => {
  const data = new Uint8ClampedArray(size.width * size.height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 100;
    data[i + 1] = 100;
    data[i + 2] = 100;
    data[i + 3] = 255;
  }
  return data;
};

const sourceBitmap = (pixels: Uint8ClampedArray) =>
  ({ width: size.width, height: size.height, pixels, close: vi.fn() }) as unknown as ImageBitmap;

const params: ProcessorToolParams = { size, bitmap: sourceBitmap(makeData()) };

beforeEach(() => {
  RecordingOffscreenCanvas.instances = [];
  vi.stubGlobal('OffscreenCanvas', RecordingOffscreenCanvas as unknown as typeof OffscreenCanvas);
});

afterEach(() => {
  vi.unstubAllGlobals();
  overrideCanvasFilterSupport(null);
});

describe('requireCanvasFilter cross-tool refusal', () => {
  it('throws CanvasFilterUnsupportedError for all filter tools when unsupported', () => {
    overrideCanvasFilterSupport(false);

    for (const tool of FILTER_TOOLS) {
      expect(() => tool.run(params.bitmap, size, {})).toThrow(CanvasFilterUnsupportedError);
      expect(() => tool.run(params.bitmap, size, {})).toThrow(
        `${tool.toolName} requires CanvasRenderingContext2D.filter, which this browser does not implement. It was refused rather than applied as a no-op, because a silent no-op would present and record pixels that no replay can reproduce.`
      );
    }
    expect(RecordingOffscreenCanvas.instances).toHaveLength(0);
  });

  it('works for all filter tools when supported', () => {
    overrideCanvasFilterSupport(true);

    for (const tool of FILTER_TOOLS) {
      const args = tool.toolName === 'levels' ? { brightness: 0, contrast: 0 } : {};
      const result = tool.run(params.bitmap, size, args);
      expect(result).toHaveLength(1);
    }
    expect(RecordingOffscreenCanvas.instances.length).toBe(FILTER_TOOLS.length);
  });

  it('throws before any canvas allocation', () => {
    overrideCanvasFilterSupport(false);

    for (const tool of FILTER_TOOLS) {
      try {
        tool.run(params.bitmap, size, {});
      } catch {
        // expected
      }
    }
    expect(RecordingOffscreenCanvas.instances).toHaveLength(0);
  });
});

describe('requireCanvasFilter error message specificity', () => {
  it('blur error message contains "blur"', () => {
    overrideCanvasFilterSupport(false);
    expect(() => FILTER_TOOLS[0].run(params.bitmap, size, { radius: 2 })).toThrow(
      'blur requires CanvasRenderingContext2D.filter'
    );
  });

  it('colors error message contains "color"', () => {
    overrideCanvasFilterSupport(false);
    expect(() => FILTER_TOOLS[1].run(params.bitmap, size, { grayscale: 100 })).toThrow(
      'color requires CanvasRenderingContext2D.filter'
    );
  });

  it('levels error message contains "levels"', () => {
    overrideCanvasFilterSupport(false);
    expect(() => FILTER_TOOLS[2].run(params.bitmap, size, { brightness: 10, contrast: 20 })).toThrow(
      'levels requires CanvasRenderingContext2D.filter'
    );
  });
});

describe('overrideCanvasFilterSupport auto-detection', () => {
  it('works when set to true', () => {
    overrideCanvasFilterSupport(true);
    const result = FILTER_TOOLS[0].run(params.bitmap, size, { radius: 2 });
    expect(result).toHaveLength(1);
    const canvas = RecordingOffscreenCanvas.instances[0];
    expect(canvas.ctx.filter).toBe('blur(2px)');
  });

  it('refuses when set to false', () => {
    overrideCanvasFilterSupport(false);
    expect(() => FILTER_TOOLS[0].run(params.bitmap, size, { radius: 2 })).toThrow(CanvasFilterUnsupportedError);
  });

  it('resets to auto-detection when set to null', () => {
    overrideCanvasFilterSupport(false);
    overrideCanvasFilterSupport(null);
    const result = FILTER_TOOLS[0].run(params.bitmap, size, { radius: 2 });
    expect(result).toHaveLength(1);
  });
});

describe('cross-tool consistency', () => {
  it('all filter tools reject before canvas allocation', () => {
    overrideCanvasFilterSupport(false);
    const before = RecordingOffscreenCanvas.instances.length;

    for (const tool of FILTER_TOOLS) {
      try {
        tool.run(params.bitmap, size, {});
      } catch {
        // expected
      }
    }
    expect(RecordingOffscreenCanvas.instances.length).toBe(before);
  });

  it('all filter tools allocate canvas when supported', () => {
    overrideCanvasFilterSupport(true);
    const before = RecordingOffscreenCanvas.instances.length;

    for (const tool of FILTER_TOOLS) {
      const args = tool.toolName === 'levels' ? { brightness: 0, contrast: 0 } : {};
      tool.run(params.bitmap, size, args);
    }
    expect(RecordingOffscreenCanvas.instances.length).toBe(before + FILTER_TOOLS.length);
  });

  it('all filter tools produce correct filter strings', () => {
    overrideCanvasFilterSupport(true);
    RecordingOffscreenCanvas.instances = [];

    FILTER_TOOLS[0].run(params.bitmap, size, { radius: 3 });
    expect(RecordingOffscreenCanvas.instances[0].ctx.filter).toBe('blur(3px)');

    RecordingOffscreenCanvas.instances = [];
    FILTER_TOOLS[1].run(params.bitmap, size, { grayscale: 100 });
    expect(RecordingOffscreenCanvas.instances[0].ctx.filter).toContain('grayscale(100%)');

    RecordingOffscreenCanvas.instances = [];
    FILTER_TOOLS[2].run(params.bitmap, size, { brightness: 10, contrast: 20 });
    expect(RecordingOffscreenCanvas.instances[0].ctx.filter).toContain('brightness(106.67%)');
    expect(RecordingOffscreenCanvas.instances[0].ctx.filter).toContain('contrast(120%)');
  });
});

describe('FilterArgumentUnrenderableError (non-numeric filter arguments)', () => {
  it('blur rejects NaN radius via normalizeBlurToolArgs', () => {
    overrideCanvasFilterSupport(true);
    RecordingOffscreenCanvas.instances = [];
    FILTER_TOOLS[0].run(params.bitmap, size, { radius: NaN });
    const canvas = RecordingOffscreenCanvas.instances[0];
    expect(canvas.ctx.filter).toBe('blur(0px)');
  });

  it('colors rejects NaN grayscale/sepia/saturation via normalizeColorsToolArgs', () => {
    overrideCanvasFilterSupport(true);
    RecordingOffscreenCanvas.instances = [];
    FILTER_TOOLS[1].run(params.bitmap, size, { grayscale: NaN, sepia: Infinity, saturation: -Infinity });
    const canvas = RecordingOffscreenCanvas.instances[0];
    expect(canvas.ctx.filter).toBe('grayscale(0%) sepia(0%) saturate(100%)');
  });

  it('levels rejects NaN brightness/contrast via normalizeLevelsToolArgs', () => {
    overrideCanvasFilterSupport(true);
    RecordingOffscreenCanvas.instances = [];
    FILTER_TOOLS[2].run(params.bitmap, size, { brightness: NaN, contrast: Infinity });
    const canvas = RecordingOffscreenCanvas.instances[0];
    expect(canvas.ctx.filter).toBe('brightness(100%) contrast(100%)');
  });
});
