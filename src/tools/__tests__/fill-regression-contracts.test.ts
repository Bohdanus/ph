import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createSelectionAlphaMask } from '../../util/selection.ts';
import { magicEraser, paintBucket, type FillToolArgs } from '../fill.ts';
import { createPixelCanvasContext } from '../../test/setup.ts';

vi.mock('../../util/selection.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../util/selection.ts')>();
  return { ...actual, createSelectionAlphaMask: vi.fn() };
});

const SIZE = { width: 4, height: 4 };
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
      const bitmap = source as { pixels?: Uint8ClampedArray };
      if (bitmap?.pixels) this.pixels.set(bitmap.pixels.subarray(0, this.pixels.length));
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

const redL = (transparent = false): Uint8ClampedArray => {
  const pixels = new Uint8ClampedArray(SIZE.width * SIZE.height * 4);
  for (const [x, y] of [
    [0, 0],
    [1, 0],
    [0, 1],
    [3, 3],
  ]) {
    const offset = (y * SIZE.width + x) * 4;
    pixels[offset] = 255;
    pixels[offset + 3] = transparent ? 0 : 255;
  }
  return pixels;
};

const bitmap = (pixels: Uint8ClampedArray) =>
  ({ width: SIZE.width, height: SIZE.height, pixels, close: vi.fn() }) as unknown as ImageBitmap;

const topRowSelection: NonNullable<FillToolArgs['selection']> = {
  points: [
    { x: 0, y: 0 },
    { x: 2, y: 0 },
    { x: 2, y: 1 },
    { x: 0, y: 1 },
  ],
  featherRadius: 0,
  antiAlias: false,
};

const args = (overrides: Partial<FillToolArgs> = {}): FillToolArgs => ({
  toolName: 'paint-bucket',
  color: '#0000FF',
  tolerance: 0,
  contiguous: true,
  alpha: 1,
  pos: { x: 0, y: 0 },
  ...overrides,
});

const run = (processor: typeof paintBucket | typeof magicEraser, pixels: Uint8ClampedArray, input: FillToolArgs) => {
  const [canvas] = processor({ size: SIZE, bitmap: bitmap(pixels) })(input);
  return canvas as unknown as RecordingOffscreenCanvas;
};

const rgbaAt = (pixels: Uint8ClampedArray, x: number, y: number): number[] => {
  const offset = (y * SIZE.width + x) * 4;
  return Array.from(pixels.subarray(offset, offset + 4));
};

beforeEach(() => {
  RecordingOffscreenCanvas.instances = [];
  vi.mocked(createSelectionAlphaMask).mockReset();
  vi.stubGlobal('OffscreenCanvas', RecordingOffscreenCanvas as unknown as typeof OffscreenCanvas);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('fill regression contracts', () => {
  it('paint bucket clips the flood region to the committed polygon selection', () => {
    const mask = new Uint8Array(SIZE.width * SIZE.height);
    mask[0] = 255;
    mask[1] = 255;
    vi.mocked(createSelectionAlphaMask).mockReturnValue(mask);
    const canvas = run(paintBucket, redL(), args({ selection: topRowSelection }));

    expect(createSelectionAlphaMask).toHaveBeenCalledWith(topRowSelection, SIZE, topRowSelection);
    expect(rgbaAt(canvas.pixels, 0, 0)).toEqual([0, 0, 255, 255]);
    expect(rgbaAt(canvas.pixels, 1, 0)).toEqual([0, 0, 255, 255]);
    expect(rgbaAt(canvas.pixels, 0, 1)).toEqual([255, 0, 0, 255]);
  });

  it('magic eraser clips alpha changes to the committed polygon selection', () => {
    const mask = new Uint8Array(SIZE.width * SIZE.height);
    mask[0] = 255;
    mask[1] = 255;
    vi.mocked(createSelectionAlphaMask).mockReturnValue(mask);
    const canvas = run(magicEraser, redL(), args({ toolName: 'magic-eraser', selection: topRowSelection }));

    expect(createSelectionAlphaMask).toHaveBeenCalledWith(topRowSelection, SIZE, topRowSelection);
    expect(rgbaAt(canvas.pixels, 0, 0)).toEqual([255, 0, 0, 0]);
    expect(rgbaAt(canvas.pixels, 1, 0)).toEqual([255, 0, 0, 0]);
    expect(rgbaAt(canvas.pixels, 0, 1)).toEqual([255, 0, 0, 255]);
  });

  it('multiplies feathered selection coverage into bucket opacity', () => {
    const mask = new Uint8Array(SIZE.width * SIZE.height);
    mask[0] = 215;
    mask[4] = 40;
    vi.mocked(createSelectionAlphaMask).mockReturnValue(mask);
    const selection = { ...topRowSelection, featherRadius: 2, antiAlias: true };
    const canvas = run(paintBucket, redL(), args({ selection }));

    expect(createSelectionAlphaMask).toHaveBeenCalledWith(selection, SIZE, selection);
    expect(rgbaAt(canvas.pixels, 0, 0)).toEqual([40, 0, 215, 255]);
    expect(rgbaAt(canvas.pixels, 0, 1)).toEqual([215, 0, 40, 255]);
  });

  it('composes eraser opacity and selection coverage against existing pixel alpha', () => {
    const mask = new Uint8Array(SIZE.width * SIZE.height);
    mask[0] = 128;
    mask[1] = 255;
    vi.mocked(createSelectionAlphaMask).mockReturnValue(mask);
    const sourcePixels = redL();
    sourcePixels[7] = 128;
    const canvas = run(
      magicEraser,
      sourcePixels,
      args({ toolName: 'magic-eraser', alpha: 0.5, selection: topRowSelection })
    );

    expect(rgbaAt(canvas.pixels, 0, 0)).toEqual([255, 0, 0, 191]);
    expect(rgbaAt(canvas.pixels, 1, 0)).toEqual([255, 0, 0, 64]);
    expect(rgbaAt(canvas.pixels, 0, 1)).toEqual([255, 0, 0, 255]);
  });

  it('keeps the requested fill color over a transparent source at partial opacity', () => {
    const canvas = run(paintBucket, redL(true), args({ alpha: 0.5 }));

    expect(rgbaAt(canvas.pixels, 0, 0)).toEqual([0, 0, 255, 128]);
  });
});
