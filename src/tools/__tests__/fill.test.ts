import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  FILL_TOLERANCE_DEFAULT,
  FILL_TOLERANCE_MAX,
  magicEraser,
  paintBucket,
  type FillToolArgs,
  type FillToolName,
} from '../fill.ts';
import { toolProcessors } from '../toolProcessors.ts';
import { defaultSettings } from '../settings.ts';
import { createPixelCanvasContext } from '../../test/setup.ts';

const SIZE = { width: 4, height: 4 };

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

/** L-shaped red region at (0,0),(1,0),(0,1) plus isolated pixel at (3,3) on transparent black. */
const RED_PIXELS: ReadonlyArray<[number, number, number, number, number]> = [
  [0, 0, 255, 0, 0],
  [1, 0, 255, 0, 0],
  [0, 1, 255, 0, 0],
  [3, 3, 255, 0, 0],
];

/** Factory returning a 4x4 bitmap with the red pixels above; toggle alpha for transparency tests. */
const sourcePixels = (sourceIsTransparent = false): Uint8ClampedArray => {
  const data = new Uint8ClampedArray(SIZE.width * SIZE.height * 4);
  for (const [x, y, r, g, b] of RED_PIXELS) {
    const i = (y * SIZE.width + x) * 4;
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = sourceIsTransparent ? 0 : 255;
  }
  return data;
};

/** The source `ImageBitmap`, carrying the pixels this recorder's `drawImage` copies in. */
const sourceBitmap = (pixels: Uint8ClampedArray) =>
  ({ width: SIZE.width, height: SIZE.height, pixels, close: vi.fn() }) as unknown as ImageBitmap;

const fillArgs = (overrides: Partial<FillToolArgs> = {}): FillToolArgs => ({
  toolName: 'paint-bucket',
  color: '#00ff00',
  tolerance: FILL_TOLERANCE_DEFAULT,
  contiguous: true,
  alpha: 1,
  pos: { x: 0, y: 0 },
  ...overrides,
});

const run = (processor: typeof paintBucket | typeof magicEraser, data: Uint8ClampedArray, a: FillToolArgs) => {
  const [canvas] = processor({ size: SIZE, bitmap: sourceBitmap(data) })(a);
  return canvas as unknown as RecordingOffscreenCanvas;
};

const runThroughRegistry = (data: Uint8ClampedArray, a: FillToolArgs) => {
  const [canvas] = toolProcessors[a.toolName].imageProcessor({ size: SIZE, bitmap: sourceBitmap(data) })(a);
  return canvas as unknown as RecordingOffscreenCanvas;
};

const writtenPixels = (canvas: RecordingOffscreenCanvas): Uint8ClampedArray => canvas.pixels;

const alphaAt = (data: Uint8ClampedArray, x: number, y: number): number => data[(y * SIZE.width + x) * 4 + 3];

const rgbAt = (data: Uint8ClampedArray, x: number, y: number): [number, number, number] => {
  const i = (y * SIZE.width + x) * 4;
  return [data[i], data[i + 1], data[i + 2]];
};

beforeEach(() => {
  RecordingOffscreenCanvas.instances = [];
  vi.stubGlobal('OffscreenCanvas', RecordingOffscreenCanvas as unknown as typeof OffscreenCanvas);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fill constants', () => {
  it('FILL_TOLERANCE_DEFAULT is 32', () => {
    expect(FILL_TOLERANCE_DEFAULT).toBe(32);
  });

  it('FILL_TOLERANCE_MAX is 255', () => {
    expect(FILL_TOLERANCE_MAX).toBe(255);
  });
});

describe('paintBucket processor', () => {
  it('is a distinct export from magicEraser', () => {
    expect(paintBucket).not.toBe(magicEraser);
    expect(typeof paintBucket).toBe('function');
  });

  it('is a two-stage curried processor', () => {
    const bitmap = sourceBitmap(sourcePixels());
    const inner = paintBucket({ size: SIZE, bitmap });
    expect(paintBucket.length).toBe(1);
    expect(inner.length).toBe(1);
  });

  it('allocates a canvas and draws the source (fillLayer creates its own canvas)', () => {
    const bitmap = sourceBitmap(sourcePixels());
    const [canvas] = paintBucket({ size: SIZE, bitmap })(fillArgs({ pos: { x: 0, y: 0 } }));

    // fillLayer creates its own OffscreenCanvas, so we expect 1 canvas from the processor
    // (the processor calls fillLayer which creates a new canvas)
    expect(RecordingOffscreenCanvas.instances.length).toBeGreaterThanOrEqual(1);
    expect(canvas).not.toBe(bitmap);
  });

  it('fills the red L-shape with green at default tolerance', () => {
    const canvas = run(paintBucket, sourcePixels(), fillArgs({ color: '#00ff00', pos: { x: 0, y: 0 } }));
    const pixels = writtenPixels(canvas);

    // L-shape pixels should become green (seeded at 0,0 which is red)
    expect(rgbAt(pixels, 0, 0)).toEqual([0, 255, 0]);
    expect(rgbAt(pixels, 1, 0)).toEqual([0, 255, 0]);
    expect(rgbAt(pixels, 0, 1)).toEqual([0, 255, 0]);

    // Isolated red at (3,3) should remain red (not contiguous)
    expect(rgbAt(pixels, 3, 3)).toEqual([255, 0, 0]);
  });

  it('contiguous:false fills all matching pixels globally', () => {
    const canvas = run(
      paintBucket,
      sourcePixels(),
      fillArgs({ color: '#00ff00', contiguous: false, pos: { x: 0, y: 0 } })
    );
    const pixels = writtenPixels(canvas);

    // All red pixels should become green
    expect(rgbAt(pixels, 0, 0)).toEqual([0, 255, 0]);
    expect(rgbAt(pixels, 1, 0)).toEqual([0, 255, 0]);
    expect(rgbAt(pixels, 0, 1)).toEqual([0, 255, 0]);
    expect(rgbAt(pixels, 3, 3)).toEqual([0, 255, 0]);
  });

  it('tolerance 0 only fills exact color matches', () => {
    const canvas = run(paintBucket, sourcePixels(), fillArgs({ color: '#00ff00', tolerance: 0, pos: { x: 0, y: 0 } }));
    const pixels = writtenPixels(canvas);

    // All three red pixels in L-shape are exactly (255,0,0)
    expect(rgbAt(pixels, 0, 0)).toEqual([0, 255, 0]);
    expect(rgbAt(pixels, 1, 0)).toEqual([0, 255, 0]);
    expect(rgbAt(pixels, 0, 1)).toEqual([0, 255, 0]);
    expect(rgbAt(pixels, 3, 3)).toEqual([255, 0, 0]);
  });

  it('tolerance 255 fills everything in contiguous region', () => {
    const gradient = new Uint8ClampedArray(SIZE.width * SIZE.height * 4);
    for (let y = 0; y < SIZE.height; y++) {
      for (let x = 0; x < SIZE.width; x++) {
        const i = (y * SIZE.width + x) * 4;
        gradient[i] = x * 64;
        gradient[i + 1] = 0;
        gradient[i + 2] = 0;
        gradient[i + 3] = 255;
      }
    }
    const canvas = run(
      paintBucket,
      gradient,
      fillArgs({ color: '#00ff00', tolerance: FILL_TOLERANCE_MAX, contiguous: true, pos: { x: 0, y: 0 } })
    );
    const pixels = writtenPixels(canvas);
    // Click at (0,0) which is 0, should fill everything since max tolerance
    expect(rgbAt(pixels, 0, 0)).toEqual([0, 255, 0]);
    expect(rgbAt(pixels, 3, 0)).toEqual([0, 255, 0]);
  });

  it('alpha=1 fills opaque pixels', () => {
    const canvas = run(paintBucket, sourcePixels(), fillArgs({ color: '#00ff00', alpha: 1, pos: { x: 0, y: 0 } }));
    const pixels = writtenPixels(canvas);

    // L-shape should become green with full opacity
    expect(alphaAt(pixels, 0, 0)).toBe(255);
    expect(rgbAt(pixels, 0, 0)).toEqual([0, 255, 0]);
  });

  it('alpha parameter controls blend weight', () => {
    const canvas = run(paintBucket, sourcePixels(), fillArgs({ color: '#00ff00', alpha: 0.5, pos: { x: 0, y: 0 } }));
    const pixels = writtenPixels(canvas);

    // With alpha=0.5, the fill color is blended at 50% weight
    // The result should be a mix of red (255,0,0) and green (0,255,0)
    const [r, g] = rgbAt(pixels, 0, 0);
    expect(r).toBeGreaterThan(0);
    expect(r).toBeLessThan(255);
    expect(g).toBeGreaterThan(0);
    expect(g).toBeLessThan(255);
    // Alpha should remain 255 (opaque) since we're blending opaque colors
    expect(alphaAt(pixels, 0, 0)).toBe(255);
  });

  it('returns early for zero-width document', () => {
    const size = { width: 0, height: 4 };
    const data = new Uint8ClampedArray(0);
    const bmp = { width: 0, height: 4, pixels: data, close: vi.fn() } as unknown as ImageBitmap;
    const [canvas] = paintBucket({ size, bitmap: bmp })(fillArgs({ pos: { x: 0, y: 0 } }));
    expect(canvas.width).toBe(1);
    expect(canvas.height).toBe(4);
  });

  it('returns early for zero-height document', () => {
    const size = { width: 4, height: 0 };
    const data = new Uint8ClampedArray(0);
    const bmp = { width: 4, height: 0, pixels: data, close: vi.fn() } as unknown as ImageBitmap;
    const [canvas] = paintBucket({ size, bitmap: bmp })(fillArgs({ pos: { x: 0, y: 0 } }));
    expect(canvas.width).toBe(4);
    expect(canvas.height).toBe(1);
  });
});

describe('magicEraser processor', () => {
  it('is a distinct export from paintBucket', () => {
    expect(magicEraser).not.toBe(paintBucket);
    expect(typeof magicEraser).toBe('function');
  });

  it('is a two-stage curried processor', () => {
    const bitmap = sourceBitmap(sourcePixels());
    const inner = magicEraser({ size: SIZE, bitmap });
    expect(magicEraser.length).toBe(1);
    expect(inner.length).toBe(1);
  });

  it('erases the contiguous region matching clicked color to transparent', () => {
    const canvas = run(magicEraser, sourcePixels(), fillArgs({ toolName: 'magic-eraser', pos: { x: 0, y: 0 } }));
    const pixels = writtenPixels(canvas);

    // L-shape should become transparent
    expect(alphaAt(pixels, 0, 0)).toBe(0);
    expect(alphaAt(pixels, 1, 0)).toBe(0);
    expect(alphaAt(pixels, 0, 1)).toBe(0);

    // Isolated red at (3,3) should remain opaque
    expect(alphaAt(pixels, 3, 3)).toBe(255);
    expect(rgbAt(pixels, 3, 3)).toEqual([255, 0, 0]);
  });

  it('contiguous:false erases all matching pixels globally', () => {
    const canvas = run(
      magicEraser,
      sourcePixels(),
      fillArgs({ toolName: 'magic-eraser', contiguous: false, pos: { x: 0, y: 0 } })
    );
    const pixels = writtenPixels(canvas);

    // All red pixels should become transparent
    expect(alphaAt(pixels, 0, 0)).toBe(0);
    expect(alphaAt(pixels, 1, 0)).toBe(0);
    expect(alphaAt(pixels, 0, 1)).toBe(0);
    expect(alphaAt(pixels, 3, 3)).toBe(0);
  });

  it('tolerance 0 only erases exact color matches', () => {
    const canvas = run(
      magicEraser,
      sourcePixels(),
      fillArgs({ toolName: 'magic-eraser', tolerance: 0, pos: { x: 0, y: 0 } })
    );
    const pixels = writtenPixels(canvas);

    // All three red pixels in L-shape are exactly (255,0,0)
    expect(alphaAt(pixels, 0, 0)).toBe(0);
    expect(alphaAt(pixels, 1, 0)).toBe(0);
    expect(alphaAt(pixels, 0, 1)).toBe(0);
    expect(alphaAt(pixels, 3, 3)).toBe(255);
  });

  it('tolerance 255 erases everything in contiguous region', () => {
    const gradient = new Uint8ClampedArray(SIZE.width * SIZE.height * 4);
    for (let y = 0; y < SIZE.height; y++) {
      for (let x = 0; x < SIZE.width; x++) {
        const i = (y * SIZE.width + x) * 4;
        gradient[i] = x * 64;
        gradient[i + 1] = 0;
        gradient[i + 2] = 0;
        gradient[i + 3] = 255;
      }
    }
    const canvas = run(
      magicEraser,
      gradient,
      fillArgs({ toolName: 'magic-eraser', tolerance: FILL_TOLERANCE_MAX, contiguous: true, pos: { x: 0, y: 0 } })
    );
    const pixels = writtenPixels(canvas);
    // Click at (0,0) which is 0, should erase everything since max tolerance
    expect(alphaAt(pixels, 0, 0)).toBe(0);
    expect(alphaAt(pixels, 3, 0)).toBe(0);
  });

  it('color field is ignored (magic eraser does not use fill color)', () => {
    const canvas = run(
      magicEraser,
      sourcePixels(),
      fillArgs({ toolName: 'magic-eraser', color: '#ff0000', pos: { x: 0, y: 0 } })
    );
    const pixels = writtenPixels(canvas);

    // Should still erase to transparent, not fill with red
    expect(alphaAt(pixels, 0, 0)).toBe(0);
    expect(rgbAt(pixels, 0, 0)).toEqual([255, 0, 0]); // Original color preserved in RGB, alpha=0
  });

  it('returns early for zero-width document', () => {
    const size = { width: 0, height: 4 };
    const data = new Uint8ClampedArray(0);
    const bmp = { width: 0, height: 4, pixels: data, close: vi.fn() } as unknown as ImageBitmap;
    const [canvas] = magicEraser({ size, bitmap: bmp })(fillArgs({ toolName: 'magic-eraser', pos: { x: 0, y: 0 } }));
    expect(canvas.width).toBe(1);
    expect(canvas.height).toBe(4);
  });

  it('returns early for zero-height document', () => {
    const size = { width: 4, height: 0 };
    const data = new Uint8ClampedArray(0);
    const bmp = { width: 4, height: 0, pixels: data, close: vi.fn() } as unknown as ImageBitmap;
    const [canvas] = magicEraser({ size, bitmap: bmp })(fillArgs({ toolName: 'magic-eraser', pos: { x: 0, y: 0 } }));
    expect(canvas.width).toBe(4);
    expect(canvas.height).toBe(1);
  });
});

describe('toolProcessors registry delegation', () => {
  it('paintBucket via registry produces same result as direct call', () => {
    const direct = run(paintBucket, sourcePixels(), fillArgs({ color: '#00ff00', pos: { x: 0, y: 0 } }));
    const registry = runThroughRegistry(sourcePixels(), fillArgs({ color: '#00ff00', pos: { x: 0, y: 0 } }));
    expect(direct.pixels).toEqual(registry.pixels);
  });

  it('magicEraser via registry produces same result as direct call', () => {
    const direct = run(magicEraser, sourcePixels(), fillArgs({ toolName: 'magic-eraser', pos: { x: 0, y: 0 } }));
    const registry = runThroughRegistry(sourcePixels(), fillArgs({ toolName: 'magic-eraser', pos: { x: 0, y: 0 } }));
    expect(direct.pixels).toEqual(registry.pixels);
  });

  it('registry entries have correct commit kind "raster"', () => {
    expect(toolProcessors['paint-bucket'].commit).toBe('raster');
    expect(toolProcessors['magic-eraser'].commit).toBe('raster');
  });

  it('registry entries have replay kind "raster-processor"', () => {
    expect(toolProcessors['paint-bucket'].replay.kind).toBe('raster-processor');
    expect(toolProcessors['magic-eraser'].replay.kind).toBe('raster-processor');
  });

  it('registry entries have replay version 1', () => {
    expect(toolProcessors['paint-bucket'].replay.version).toBe(1);
    expect(toolProcessors['magic-eraser'].replay.version).toBe(1);
  });

  it('registry entries are deterministic and require raster', () => {
    for (const name of ['paint-bucket', 'magic-eraser'] as FillToolName[]) {
      expect(toolProcessors[name].replay.deterministic).toBe(true);
      expect(toolProcessors[name].replay.requiresRaster).toBe(true);
    }
  });

  it('registry entries have no creator flag', () => {
    expect(toolProcessors['paint-bucket'].creator).toBeUndefined();
    expect(toolProcessors['magic-eraser'].creator).toBeUndefined();
  });

  it('registry entries have imageProcessor function', () => {
    expect(typeof toolProcessors['paint-bucket'].imageProcessor).toBe('function');
    expect(typeof toolProcessors['magic-eraser'].imageProcessor).toBe('function');
  });
});

describe('defaultSettings integration', () => {
  it('paint-bucket default settings match seeded defaults', () => {
    const defaults = defaultSettings['paint-bucket'] as FillToolArgs;
    expect(defaults.toolName).toBe('paint-bucket');
    expect(defaults.tolerance).toBe(FILL_TOLERANCE_DEFAULT);
    expect(defaults.contiguous).toBe(true);
    expect(defaults.alpha).toBe(1);
    expect(defaults.color).toMatch(/^#[0-9a-fA-F]{6}$/);
  });

  it('magic-eraser default settings match seeded defaults', () => {
    const defaults = defaultSettings['magic-eraser'] as FillToolArgs;
    expect(defaults.toolName).toBe('magic-eraser');
    expect(defaults.tolerance).toBe(FILL_TOLERANCE_DEFAULT);
    expect(defaults.contiguous).toBe(true);
    expect(defaults.alpha).toBe(1);
  });
});

describe('large canvas performance (bounds)', () => {
  it('flood fill bounds are clamped to canvas size on 4000x4000', () => {
    // This test verifies the fill algorithm doesn't overflow on large canvases
    // floodFill.ts mentions this concern in its documentation
    const size = { width: 4000, height: 4000 };
    const data = new Uint8ClampedArray(size.width * size.height * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 100;
      data[i + 1] = 100;
      data[i + 2] = 100;
      data[i + 3] = 255;
    }
    const bmp = { width: size.width, height: size.height, pixels: data, close: vi.fn() } as unknown as ImageBitmap;
    const [canvas] = paintBucket({ size, bitmap: bmp })(
      fillArgs({ color: '#00ff00', tolerance: 0, pos: { x: 0, y: 0 } })
    );
    expect(canvas.width).toBe(size.width);
    expect(canvas.height).toBe(size.height);
    // Click at corner should not overflow
    const recCanvas = canvas as unknown as RecordingOffscreenCanvas;
    expect(rgbAt(recCanvas.pixels, 0, 0)).toEqual([0, 255, 0]);
  });
});
