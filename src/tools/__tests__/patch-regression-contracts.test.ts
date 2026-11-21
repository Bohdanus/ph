import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createPixelCanvasContext } from '../../test/setup.ts';
import type { Size } from '../../contexts/general-types.ts';
import { patch, type PatchToolArgs } from '../patch.ts';

const SIZE: Size = { width: 9, height: 9 };
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
      const bitmap = source as { pixels: Uint8ClampedArray };
      this.pixels.set(bitmap.pixels.subarray(0, this.pixels.length));
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

const pixelsFilled = (red: number, green: number, blue: number): Uint8ClampedArray => {
  const pixels = new Uint8ClampedArray(SIZE.width * SIZE.height * 4);
  for (let offset = 0; offset < pixels.length; offset += 4) {
    pixels[offset] = red;
    pixels[offset + 1] = green;
    pixels[offset + 2] = blue;
    pixels[offset + 3] = 255;
  }
  return pixels;
};

const bitmap = (pixels: Uint8ClampedArray) =>
  ({ width: SIZE.width, height: SIZE.height, pixels, close: vi.fn() }) as unknown as ImageBitmap;

const args = (overrides: Partial<PatchToolArgs> = {}): PatchToolArgs => ({
  sourceRect: { x: 0, y: 0, width: 1, height: 1 },
  donorPoint: { x: 4, y: 4 },
  diffusion: 0,
  toolName: 'patch',
  ...overrides,
});

const run = (pixels: Uint8ClampedArray, input: PatchToolArgs): RecordingOffscreenCanvas => {
  const [canvas] = patch({ size: SIZE, bitmap: bitmap(pixels) })(input);
  return canvas as unknown as RecordingOffscreenCanvas;
};

const rgbaAt = (pixels: Uint8ClampedArray, x: number, y: number): number[] => {
  const offset = (y * SIZE.width + x) * 4;
  return Array.from(pixels.subarray(offset, offset + 4));
};

beforeEach(() => {
  RecordingOffscreenCanvas.instances = [];
  vi.stubGlobal('OffscreenCanvas', RecordingOffscreenCanvas as unknown as typeof OffscreenCanvas);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('patch regression contracts', () => {
  it('matches donor luminance to the target with exact output channels', () => {
    const pixels = pixelsFilled(100, 100, 100);
    const donorOffset = (4 * SIZE.width + 4) * 4;
    pixels[donorOffset] = 255;
    pixels[donorOffset + 1] = 0;
    pixels[donorOffset + 2] = 0;

    const canvas = run(pixels, args());

    // Gray 100 has luma 100; red 255 has luma 76.245. Applying the 23.755
    // correction to the donor yields [255, 24, 24] after byte clamping.
    expect(rgbaAt(canvas.pixels, 0, 0)).toEqual([255, 24, 24, 255]);
  });

  it('keeps diffusion step 6 distinct from step 7 at the patch interior', () => {
    const pixels = pixelsFilled(0, 0, 0);
    const donorOffset = (4 * SIZE.width + 5) * 4;
    pixels[donorOffset] = 255;

    const diffusionSix = run(
      pixels,
      args({ sourceRect: { x: 0, y: 0, width: 9, height: 9 }, donorPoint: { x: 1, y: 0 }, diffusion: 6 })
    );
    const diffusionSeven = run(
      pixels,
      args({ sourceRect: { x: 0, y: 0, width: 9, height: 9 }, donorPoint: { x: 1, y: 0 }, diffusion: 7 })
    );

    // At the center, step 6 retains 1/7 coverage; step 7 has zero interior weight.
    expect(rgbaAt(diffusionSix.pixels, 4, 4)).toEqual([26, 0, 0, 255]);
    expect(rgbaAt(diffusionSeven.pixels, 4, 4)).toEqual([0, 0, 0, 255]);
  });

  it('composites donor alpha with the target alpha at partial diffusion', () => {
    const pixels = pixelsFilled(0, 0, 0);
    const targetOffset = (1 * SIZE.width + 1) * 4;
    pixels[targetOffset + 3] = 128;
    const donorOffset = (5 * SIZE.width + 5) * 4;
    pixels[donorOffset] = 255;
    pixels[donorOffset + 3] = 64;

    const canvas = run(
      pixels,
      args({ sourceRect: { x: 0, y: 0, width: 3, height: 3 }, donorPoint: { x: 4, y: 4 }, diffusion: 6 })
    );

    // The center weight is 11/14; source-over of alpha 64/255 at that weight over 128/255 rounds to 153.
    expect(rgbaAt(canvas.pixels, 1, 1)[3]).toBe(153);
  });
});
