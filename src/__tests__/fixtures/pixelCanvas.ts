import { vi } from 'vitest';

/**
 * A PIXEL-CAPABLE `OffscreenCanvas` for tests that have to see a colour.
 *
 * The repo's own mocks deliberately cannot help here. `src/test/setup.ts:182-190` installs a
 * globally registered context with NO `getImageData`/`putImageData`, because production code
 * branches on `typeof ctx.getImageData === 'function'` to detect a reduced environment, and
 * `src/__tests__/fixtures/canvas.ts:43` seeds `fillStyle: ''`. Both are right — and both are why
 * the invisible-fill and 13%-haze defects survived: a test that only asserts
 * `expect(ctx.stroke).toHaveBeenCalled()` cannot see a colour, and cannot see a tolerance that
 * admits the wrong pixels.
 *
 * This double keeps a real `Uint8ClampedArray` and implements the four read/write calls a
 * pixel-reading tool actually makes, so a test can assert on numbers. `drawImage` accepts any
 * source carrying `.pixels` (see `PixelBitmap`), which is how a synthetic layer is handed to a
 * processor.
 */
export type PixelBitmap = { width: number; height: number; pixels: Uint8ClampedArray };

export class PixelContext {
  pixels: Uint8ClampedArray;
  width: number;
  height: number;

  imageSmoothingEnabled = true;
  imageSmoothingQuality: ImageSmoothingQuality = 'high';

  // `erasableSyntaxOnly` forbids parameter properties, so the fields are declared and assigned
  // rather than folded into the signature — and the assignment must be in the BODY, not a field
  // initialiser. A field initialiser that reads `this.width` runs before the constructor has
  // assigned it, and `Math.ceil(undefined)` is NaN, which `Math.max(1, NaN)` turns into a NaN
  // canvas size and `new Uint8ClampedArray(NaN * NaN * 4)` into a zero-length buffer. Every
  // read-back would then return zeros and every assertion would pass against nothing.
  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.pixels = new Uint8ClampedArray(width * height * 4);
  }

  drawImage(source: unknown) {
    const sourcePixels = (source as PixelBitmap).pixels;
    if (!sourcePixels) return;
    this.pixels.set(sourcePixels.subarray(0, this.pixels.length));
  }

  getImageData(x: number, y: number, width: number, height: number): ImageData {
    const out = new Uint8ClampedArray(width * height * 4);
    for (let row = 0; row < height; row++) {
      for (let column = 0; column < width; column++) {
        const from = ((y + row) * this.width + (x + column)) * 4;
        const to = (row * width + column) * 4;
        if (from < 0 || from + 3 >= this.pixels.length) continue;
        out[to] = this.pixels[from];
        out[to + 1] = this.pixels[from + 1];
        out[to + 2] = this.pixels[from + 2];
        out[to + 3] = this.pixels[from + 3];
      }
    }
    return { data: out, width, height, colorSpace: 'srgb' } as unknown as ImageData;
  }

  putImageData(imageData: ImageData) {
    this.pixels.set(imageData.data.subarray(0, this.pixels.length));
  }
}

export class PixelCanvas {
  width: number;
  height: number;
  readonly ctx: PixelContext;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.ctx = new PixelContext(width, height);
  }

  getContext() {
    return this.ctx;
  }
}

/** Every `PixelCanvas` constructed since the last reset, in allocation order. */
export const pixelCanvases: PixelCanvas[] = [];

export class PixelOffscreenCanvas {
  width: number;
  height: number;
  readonly ctx: PixelContext;

  constructor(width: number, height: number) {
    this.width = Math.max(1, Math.ceil(width));
    this.height = Math.max(1, Math.ceil(height));
    this.ctx = new PixelContext(this.width, this.height);
    pixelCanvases.push(this as unknown as PixelCanvas);
  }

  getContext() {
    return this.ctx;
  }
}

/** Installs `PixelOffscreenCanvas` as the global, and clears the instance log. */
export const stubPixelOffscreenCanvas = () => {
  pixelCanvases.length = 0;
  vi.stubGlobal('OffscreenCanvas', PixelOffscreenCanvas as unknown as typeof OffscreenCanvas);
};

/** An opaque `ImageData` from `[x, y, r, g, b]` rows; unlisted pixels are opaque magenta. */
export const imageDataFrom = (
  width: number,
  height: number,
  rows: readonly (readonly [number, number, number, number, number])[]
) => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; index++) {
    data[index * 4] = 255;
    data[index * 4 + 1] = 0;
    data[index * 4 + 2] = 255;
    data[index * 4 + 3] = 255;
  }
  for (const [x, y, r, g, b] of rows) {
    const index = (y * width + x) * 4;
    data[index] = r;
    data[index + 1] = g;
    data[index + 2] = b;
    data[index + 3] = 255;
  }
  return { data, width, height, colorSpace: 'srgb' } as unknown as ImageData;
};

/**
 * A solid field of one colour, `size`×`size`, with `over` painted LAST so a caller can carve
 * differently-coloured pixels out of it. The order matters: an `over` row written first is
 * overwritten by the field, and every assertion about an untouched pixel then passes against a
 * colour that was never there.
 */
export const fieldOf = (
  size: number,
  colour: readonly [number, number, number],
  over: readonly (readonly [number, number, number, number, number])[] = []
) => {
  const rows: (readonly [number, number, number, number, number])[] = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) rows.push([x, y, colour[0], colour[1], colour[2]]);
  }
  rows.push(...over);
  return imageDataFrom(size, size, rows);
};

export const pixelAt = (imageData: ImageData, x: number, y: number) => {
  const index = (y * imageData.width + x) * 4;

  return [imageData.data[index], imageData.data[index + 1], imageData.data[index + 2]] as const;
};

export const luminanceOf = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** A `BitmapSource`-shaped carrier for a synthetic layer, for `drawImage` to copy. */
export const bitmapFrom = (imageData: ImageData) =>
  ({
    width: imageData.width,
    height: imageData.height,
    pixels: imageData.data,
  }) as unknown as ImageBitmap;
