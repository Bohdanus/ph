/**
 * Pixel-packing edge cases for `src/contexts/raster-utils.ts`. The sibling
 * `raster-utils.test.ts` is Gold and already covers every branch; what it does not exercise is
 * the *input* domain of `RgbaImageData`, whose declared type allows a plain `Uint8Array` as
 * well as a `Uint8ClampedArray`, nor a buffer whose length does not match `width * height * 4`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getCanvasImageData, imageDataToImage } from '../raster-utils.ts';

let putImageDataCalls: { width: number; height: number; data: Uint8ClampedArray }[];
let dataUrls: string[];
let images: HTMLImageElement[];

beforeEach(() => {
  putImageDataCalls = [];
  dataUrls = [];
  images = [];
  vi.mocked(HTMLCanvasElement.prototype.getContext).mockImplementation(function (this: HTMLCanvasElement) {
    return {
      canvas: this,
      createImageData: (width: number, height: number) => ({
        width,
        height,
        data: new Uint8ClampedArray(width * height * 4),
      }),
      getImageData: () => ({ width: this.width, height: this.height, data: new Uint8ClampedArray(0) }),
      putImageData(image: ImageData) {
        putImageDataCalls.push({
          width: image.width,
          height: image.height,
          data: new Uint8ClampedArray(image.data),
        });
      },
    } as unknown as CanvasRenderingContext2D;
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(function (type?: string) {
    const url = `data:${type ?? ''};base64,raster`;
    dataUrls.push(url);
    return url;
  });
  vi.spyOn(globalThis, 'Image').mockImplementation(function (this: HTMLImageElement) {
    this.onload = null;
    this.onerror = null;
    this.src = '';
    images.push(this);
    setTimeout(() => this.onload?.(new Event('load')), 0);
    return this;
  } as unknown as typeof Image);
});

// `src/test/setup.ts` re-installs its own `getContext` stub in a `beforeEach`, so restoring here
// is enough; re-stubbing the prototype afterwards would be operating on the unspied method.
afterEach(() => {
  vi.restoreAllMocks();
});

describe('imageDataToImage input domain', () => {
  it('accepts a plain Uint8Array buffer, not only a clamped one', async () => {
    // `RgbaImageData.data` is declared as `Uint8Array | Uint8ClampedArray`, and the BMP/AVIF
    // decoders hand over the un-clamped form.
    const data = new Uint8Array([1, 2, 3, 255, 4, 5, 6, 128]);

    const image = await imageDataToImage({ data, width: 2, height: 1 }, 'Failed to decode BMP image');

    expect(putImageDataCalls).toEqual([
      { width: 2, height: 1, data: new Uint8ClampedArray([1, 2, 3, 255, 4, 5, 6, 128]) },
    ]);
    expect(dataUrls).toEqual(['data:image/png;base64,raster']);
    expect(image).toBe(images[0]);
  });

  it('clamps out-of-range channel values through the canvas ImageData', async () => {
    const data = new Uint8ClampedArray([300, -20, 128, 255]);

    await imageDataToImage({ data, width: 1, height: 1 }, 'x');

    // The decoders can produce values outside 0..255; the canvas clamps rather than wrapping.
    expect([...putImageDataCalls[0].data]).toEqual([255, 0, 128, 255]);
  });

  it('throws synchronously when the buffer is longer than the declared image', () => {
    // `imageDataToImage` is a plain function, not a Promise constructor, so the RangeError from
    // `ImageData.data.set` escapes synchronously. Every production caller returns it from an
    // `async` function, so the throw still surfaces as a rejection there; this test pins the
    // difference so a future refactor to a lazy path is a deliberate change.
    const data = new Uint8ClampedArray(24);

    expect(() => imageDataToImage({ data, width: 1, height: 1 }, 'x')).toThrow(RangeError);
    expect(putImageDataCalls).toEqual([]);
  });

  it('accepts a buffer shorter than the declared image and leaves the remainder transparent', async () => {
    const data = new Uint8ClampedArray([9, 9, 9]);

    await imageDataToImage({ data, width: 1, height: 1 }, 'x');

    expect([...putImageDataCalls[0].data]).toEqual([9, 9, 9, 0]);
  });
});

describe('getCanvasImageData argument forwarding', () => {
  it.each([
    ['a 1x1 canvas', 1, 1],
    ['a zero-width canvas', 0, 5],
    ['a large canvas', 640, 480],
  ])('reads %s from the origin', (_label, width, height) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const getImageData = vi.fn(() => ({ width, height, data: new Uint8ClampedArray(0) }));
    vi.spyOn(canvas, 'getContext').mockReturnValue({ getImageData } as unknown as CanvasRenderingContext2D);

    const imageData = getCanvasImageData(canvas);

    expect(getImageData).toHaveBeenCalledExactlyOnceWith(0, 0, width, height);
    expect(imageData).toEqual({ width, height, data: new Uint8ClampedArray(0) });
  });
});
