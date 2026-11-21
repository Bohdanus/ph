import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createPixelCanvasContext } from '../../test/setup.ts';
import type { Size } from '../../contexts/general-types.ts';
import { patch, type PatchToolArgs } from '../patch.ts';

const size: Size = { width: 9, height: 9 };

/**
 * Pixel-capable `OffscreenCanvas` recorder.
 * Mirrors the pattern from `src/test/setup.ts` — `createPixelCanvasContext`
 * installs real `getImageData`/`putImageData` on a canvas whose backing buffer
 * we can read directly, so assertions can verify the actual pixel result.
 */
type MockCtx = CanvasRenderingContext2D;

class RecordingCanvas {
  static instances: RecordingCanvas[] = [];

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
    RecordingCanvas.instances.push(this);
  }

  getContext(): MockCtx {
    return this.ctx;
  }
}

const args = (overrides: Partial<PatchToolArgs> = {}): PatchToolArgs => ({
  sourceRect: { x: 0, y: 0, width: 3, height: 3 },
  donorPoint: { x: 4, y: 4 },
  diffusion: 0,
  toolName: 'patch',
  ...overrides,
});

const sourceBitmap = (pixels: Uint8ClampedArray) =>
  ({ width: size.width, height: size.height, pixels, close: vi.fn() }) as unknown as ImageBitmap;

const run = (data: Uint8ClampedArray, a: PatchToolArgs) => {
  const [canvas] = patch({ size, bitmap: sourceBitmap(data) })(a);
  return canvas as unknown as RecordingCanvas;
};

const at = (buffer: Uint8ClampedArray, x: number, y: number): [number, number, number, number] => {
  const index = (y * size.width + x) * 4;
  return [buffer[index], buffer[index + 1], buffer[index + 2], buffer[index + 3]];
};

beforeEach(() => {
  RecordingCanvas.instances = [];
  vi.stubGlobal('OffscreenCanvas', RecordingCanvas as unknown as typeof OffscreenCanvas);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('patch structure', () => {
  it('is a distinct export (no other tool shares its processor)', () => {
    expect(typeof patch).toBe('function');
  });

  it('is a two-stage curried processor that reads its params and its args', () => {
    const bitmap = sourceBitmap(new Uint8ClampedArray(size.width * size.height * 4));
    const inner = patch({ size, bitmap });

    expect(patch.length).toBe(1);
    expect(inner.length).toBe(1);
  });

  it('allocates exactly one full-document canvas and draws the source bitmap into it', () => {
    const bitmap = sourceBitmap(new Uint8ClampedArray(size.width * size.height * 4));
    const [canvas] = patch({ size, bitmap })(args());

    expect(RecordingCanvas.instances).toHaveLength(1);
    expect(canvas).toBe(RecordingCanvas.instances[0]);
    expect(canvas).not.toBe(bitmap);
    expect(vi.mocked(RecordingCanvas.instances[0].ctx.drawImage).mock.calls[0][0]).toBe(bitmap);
  });
});

describe('patch processor behavior', () => {
  it('copies pixels from donorPoint to sourceRect', () => {
    const data = new Uint8ClampedArray(size.width * size.height * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 100;
      data[i + 1] = 100;
      data[i + 2] = 100;
      data[i + 3] = 255;
    }
    // Make donorPoint (4,4) red
    const donorIdx = (4 * size.width + 4) * 4;
    data[donorIdx] = 255;
    data[donorIdx + 1] = 0;
    data[donorIdx + 2] = 0;
    data[donorIdx + 3] = 255;

    const canvas = run(
      data,
      args({
        sourceRect: { x: 0, y: 0, width: 3, height: 3 },
        donorPoint: { x: 4, y: 4 },
        diffusion: 0,
      })
    );

    // Source rect should now have red pixels copied from donor
    const [r, g, b] = at(canvas.pixels, 0, 0);
    expect(r).toBeGreaterThan(100);
    expect(g).toBeLessThan(100);
    expect(b).toBeLessThan(100);
  });

  it('uses source alpha from donor point', () => {
    const data = new Uint8ClampedArray(size.width * size.height * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 100;
      data[i + 1] = 100;
      data[i + 2] = 100;
      data[i + 3] = 200;
    }
    const donorIdx = (4 * size.width + 4) * 4;
    data[donorIdx] = 255;
    data[donorIdx + 1] = 0;
    data[donorIdx + 2] = 0;
    data[donorIdx + 3] = 255;

    const canvas = run(
      data,
      args({
        sourceRect: { x: 0, y: 0, width: 3, height: 3 },
        donorPoint: { x: 4, y: 4 },
        diffusion: 0,
      })
    );

    const [, , , a] = at(canvas.pixels, 0, 0);
    expect(a).toBe(255); // Uses source alpha from donor point
  });

  it('handles multiple sourceRect regions', () => {
    const data = new Uint8ClampedArray(size.width * size.height * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 100;
      data[i + 1] = 100;
      data[i + 2] = 100;
      data[i + 3] = 255;
    }
    const donorIdx = (4 * size.width + 4) * 4;
    data[donorIdx] = 255;
    data[donorIdx + 1] = 0;
    data[donorIdx + 2] = 0;
    data[donorIdx + 3] = 255;

    // First patch
    const canvas1 = run(
      data,
      args({
        sourceRect: { x: 0, y: 0, width: 3, height: 3 },
        donorPoint: { x: 4, y: 4 },
        diffusion: 0,
      })
    );

    // Second patch at different location
    RecordingCanvas.instances = [];
    const canvas2 = run(
      data,
      args({
        sourceRect: { x: 5, y: 5, width: 2, height: 2 },
        donorPoint: { x: 4, y: 4 },
        diffusion: 0,
      })
    );

    // Both should have red pixels copied
    const [r1] = at(canvas1.pixels, 0, 0);
    const [r2] = at(canvas2.pixels, 5, 5);
    expect(r1).toBeGreaterThan(100);
    expect(r2).toBeGreaterThan(100);
  });

  it('source isolation: reads from sourceData not output (anti-compounding)', () => {
    // Critical test: patch must read from original source, not its own output
    const data = new Uint8ClampedArray(size.width * size.height * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 100;
      data[i + 1] = 100;
      data[i + 2] = 100;
      data[i + 3] = 255;
    }
    const donorIdx = (4 * size.width + 4) * 4;
    data[donorIdx] = 255;
    data[donorIdx + 1] = 0;
    data[donorIdx + 2] = 0;
    data[donorIdx + 3] = 255;

    const canvas = run(
      data,
      args({
        sourceRect: { x: 4, y: 4, width: 1, height: 1 },
        donorPoint: { x: 4, y: 4 },
        diffusion: 0,
      })
    );

    // Should read source red from sourceData, not compound
    const [r, g, b] = at(canvas.pixels, 4, 4);
    expect(r).toBe(255);
    expect(g).toBe(0);
    expect(b).toBe(0);
  });
});

describe('patch edge cases', () => {
  it('returns early for zero-width document (rasterSize guard)', () => {
    const zeroSize: Size = { width: 0, height: 9 };
    const data = new Uint8ClampedArray(0);
    const bmp = { width: 0, height: 9, pixels: data, close: vi.fn() } as unknown as ImageBitmap;
    const [canvas] = patch({ size: zeroSize, bitmap: bmp })(args());
    expect(canvas.width).toBe(1);
    expect(canvas.height).toBe(9);
  });

  it('returns early for zero-height document (rasterSize guard)', () => {
    const zeroSize: Size = { width: 9, height: 0 };
    const data = new Uint8ClampedArray(0);
    const bmp = { width: 9, height: 0, pixels: data, close: vi.fn() } as unknown as ImageBitmap;
    const [canvas] = patch({ size: zeroSize, bitmap: bmp })(args());
    expect(canvas.width).toBe(9);
    expect(canvas.height).toBe(1);
  });

  it('returns early when getImageData/putImageData are not functions', () => {
    vi.unstubAllGlobals();
    vi.stubGlobal(
      'OffscreenCanvas',
      class extends RecordingCanvas {
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
    const [canvas] = patch({ size, bitmap: sourceBitmap(data) })(args());
    const recCanvas = canvas as unknown as RecordingCanvas;
    expect(recCanvas.width).toBe(size.width);
    expect(recCanvas.height).toBe(size.height);
    expect(recCanvas.pixels).toEqual(data);

    vi.unstubAllGlobals();
    vi.stubGlobal('OffscreenCanvas', RecordingCanvas as unknown as typeof OffscreenCanvas);
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
    const [canvas] = patch({ size: nsSize, bitmap: bmp })(args({ sourceRect: { x: 0, y: 0, width: 10, height: 10 } }));
    expect(canvas.width).toBe(nsSize.width);
    expect(canvas.height).toBe(nsSize.height);
  });
});

describe('patch toolProcessors registry delegation', () => {
  it('registry entry has commit kind "raster"', async () => {
    const { toolProcessors } = await import('../toolProcessors.ts');
    expect(toolProcessors.patch.commit).toBe('raster');
  });

  it('registry entry has replay kind "raster-processor"', async () => {
    const { toolProcessors } = await import('../toolProcessors.ts');
    expect(toolProcessors.patch.replay.kind).toBe('raster-processor');
  });

  it('registry entry has replay version 1', async () => {
    const { toolProcessors } = await import('../toolProcessors.ts');
    expect(toolProcessors.patch.replay.version).toBe(1);
  });

  it('registry entry is deterministic and requires raster', async () => {
    const { toolProcessors } = await import('../toolProcessors.ts');
    expect(toolProcessors.patch.replay.deterministic).toBe(true);
    expect(toolProcessors.patch.replay.requiresRaster).toBe(true);
  });

  it('registry entry has no creator flag', async () => {
    const { toolProcessors } = await import('../toolProcessors.ts');
    expect(toolProcessors.patch.creator).toBeUndefined();
  });
});

describe('patch empty sourceRect', () => {
  it('returns canvas with source drawn when sourceRect has zero width', () => {
    const data = new Uint8ClampedArray(size.width * size.height * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 100;
      data[i + 1] = 100;
      data[i + 2] = 100;
      data[i + 3] = 255;
    }
    const [canvas] = patch({ size, bitmap: sourceBitmap(data) })(
      args({ sourceRect: { x: 0, y: 0, width: 0, height: 3 } })
    );
    expect(canvas.width).toBe(size.width);
    expect(canvas.height).toBe(size.height);
    const recCanvas = canvas as unknown as RecordingCanvas;
    expect(recCanvas.pixels).toEqual(data);
  });

  it('returns canvas with source drawn when sourceRect has zero height', () => {
    const data = new Uint8ClampedArray(size.width * size.height * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 100;
      data[i + 1] = 100;
      data[i + 2] = 100;
      data[i + 3] = 255;
    }
    const [canvas] = patch({ size, bitmap: sourceBitmap(data) })(
      args({ sourceRect: { x: 0, y: 0, width: 3, height: 0 } })
    );
    expect(canvas.width).toBe(size.width);
    expect(canvas.height).toBe(size.height);
    const recCanvas = canvas as unknown as RecordingCanvas;
    expect(recCanvas.pixels).toEqual(data);
  });
});

describe('patch non-finite coordinates', () => {
  it('clamps NaN/Infinity coordinates', () => {
    const canvas = run(
      new Uint8ClampedArray(size.width * size.height * 4),
      args({
        sourceRect: { x: NaN, y: NaN, width: 1, height: 1 },
        donorPoint: { x: NaN, y: NaN },
      })
    );
    expect(canvas.width).toBe(size.width);
    expect(canvas.height).toBe(size.height);
  });
});
