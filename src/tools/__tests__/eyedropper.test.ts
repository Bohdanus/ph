import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { defaultSettings } from '../settings.ts';
import { eyedropper, sampleColorAt } from '../eyedropper.ts';
import { makeMockImageData } from '../../__tests__/canvas-mock.ts';
import { createMockCanvasContext } from '../../__tests__/fixtures/canvas.ts';
import { premultiplyRgba, readRgba, toHex, unpremultiplyRgba, writeRgba, type Rgba } from '../../util/pixels.ts';
import type { BitmapSource, Point } from '../../contexts/general-types.ts';
import type { ProcessorToolParams } from '../toolProcessors.ts';

type MockCtx = ReturnType<typeof createMockCanvasContext>;

/**
 * The shared mock context plus read-back, so the recorder below can be a spread of one plus
 * an override of the other method without an excess-property error against the fixture's
 * fixed return type.
 */
type PixelCtx = MockCtx & Pick<CanvasRenderingContext2D, 'getImageData'>;

/** One pixel, four channels, in the order a `Uint8ClampedArray` holds them. */
type Channels = readonly [number, number, number, number];

const writeChannels = (data: Uint8ClampedArray, offset: number, [r, g, b, a]: Channels) => {
  data[offset] = r;
  data[offset + 1] = g;
  data[offset + 2] = b;
  data[offset + 3] = a;
};

/**
 * A pixel-capable `OffscreenCanvas`: a real `Uint8ClampedArray` behind the same two methods
 * the sampler calls.
 *
 * `createMockCanvasContext` deliberately has no read-back and `src/test/setup.ts:182-190`
 * says why — production guards on `typeof ctx.getImageData === 'function'`, so adding it to
 * the shared mock would flip every rasterization test onto the other branch. The
 * `getImageData` here reproduces the real API's two edges that the assertions depend on:
 * it floors the requested origin, and it returns transparent black for the part of a
 * request that falls outside the canvas rather than throwing.
 */
class SamplingOffscreenCanvas {
  static instances: SamplingOffscreenCanvas[] = [];

  width: number;
  height: number;
  readonly data: Uint8ClampedArray;
  readonly ctx: PixelCtx;

  constructor(width: number, height: number) {
    this.width = Math.max(1, Math.ceil(width));
    this.height = Math.max(1, Math.ceil(height));
    this.data = new Uint8ClampedArray(this.width * this.height * 4);
    this.ctx = {
      ...createMockCanvasContext({ canvas: this }),
      drawImage: vi.fn((source: unknown) => {
        const sourceData = (source as { data?: Uint8ClampedArray }).data;
        if (sourceData) this.data.set(sourceData.subarray(0, this.data.length));
      }),
      getImageData: vi.fn((x: number, y: number, readWidth: number, readHeight: number) => {
        const data = new Uint8ClampedArray(Math.max(0, readWidth) * Math.max(0, readHeight) * 4);
        for (let row = 0; row < readHeight; row++) {
          for (let column = 0; column < readWidth; column++) {
            const sourceX = Math.floor(x) + column;
            const sourceY = Math.floor(y) + row;
            if (sourceX < 0 || sourceY < 0 || sourceX >= this.width || sourceY >= this.height) continue;
            writeChannels(data, (row * readWidth + column) * 4, this.at(sourceX, sourceY));
          }
        }
        return { data, width: readWidth, height: readHeight, colorSpace: 'srgb' as const };
      }),
    };
    SamplingOffscreenCanvas.instances.push(this);
  }

  getContext(): PixelCtx {
    return this.ctx;
  }

  /** The four channels at `(x, y)`, as a tuple so an expectation reads as a colour. */
  at(x: number, y: number): Channels {
    const offset = (y * this.width + x) * 4;
    return [this.data[offset], this.data[offset + 1], this.data[offset + 2], this.data[offset + 3]];
  }
}

/** The same recorder with a context that has no read-back at all, as the global stub has. */
class ReadbacklessOffscreenCanvas {
  width: number;
  height: number;
  readonly ctx: MockCtx;

  constructor(width: number, height: number) {
    this.width = Math.max(1, Math.ceil(width));
    this.height = Math.max(1, Math.ceil(height));
    this.ctx = createMockCanvasContext({ canvas: this });
  }

  getContext(): MockCtx {
    return this.ctx;
  }
}

/** The same recorder with a context whose read-back throws, as a transferred one does. */
class ThrowingOffscreenCanvas {
  width: number;
  height: number;
  readonly ctx: PixelCtx;

  constructor(width: number, height: number) {
    this.width = Math.max(1, Math.ceil(width));
    this.height = Math.max(1, Math.ceil(height));
    this.ctx = {
      ...createMockCanvasContext({ canvas: this }),
      getImageData: vi.fn(() => {
        throw new Error('the canvas has been transferred');
      }),
    };
  }

  getContext(): PixelCtx {
    return this.ctx;
  }
}

/**
 * The `bitmap` a processor is handed: a sized raster carrying its own pixels. The sampler
 * only ever hands it to `drawImage`, so a `data`-bearing stand-in is the whole contract.
 */
const createRaster = (imageData: ImageData): BitmapSource =>
  ({
    width: imageData.width,
    height: imageData.height,
    data: new Uint8ClampedArray(imageData.data),
  }) as unknown as BitmapSource;

/**
 * `makeMockImageData`'s fill callback is handed `(index, x, y)` and no buffer, so a fixture
 * that varies per pixel is built here instead: allocate with it, then write the channels.
 */
const makeField = (width: number, height: number, colourAt: (x: number, y: number) => Channels): ImageData => {
  const imageData = makeMockImageData(width, height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      writeChannels(imageData.data, (y * width + x) * 4, colourAt(x, y));
    }
  }

  return imageData;
};

/** Sample one point of one raster, which is the whole call shape the tool area uses. */
const sample = (imageData: ImageData, point: Point): Rgba | null => {
  const params: ProcessorToolParams = {
    bitmap: createRaster(imageData),
    size: { width: imageData.width, height: imageData.height },
  };

  return sampleColorAt(params)(point);
};

const RED: Channels = [255, 0, 0, 255];
const TRANSPARENT: Channels = [0, 0, 0, 0];
/** Half-opaque, and NOT a premultiplication of itself: 128 * (200/255) rounds to 100. */
const TRANSLUCENT: Channels = [200, 100, 50, 128];

beforeEach(() => {
  SamplingOffscreenCanvas.instances = [];
  vi.stubGlobal('OffscreenCanvas', SamplingOffscreenCanvas as unknown as typeof OffscreenCanvas);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('sampleColorAt', () => {
  it('returns the exact straight-alpha channels of an opaque pixel, and toHex renders them as the store colour', () => {
    const field = makeField(3, 3, () => RED);

    const rgba = sample(field, { x: 1, y: 2 });
    expect(rgba).toEqual({ r: 255, g: 0, b: 0, a: 255 });
    // The form `SET_COLOR` carries: 6-digit lowercase, the shape
    // `e2e/helpers/color-helpers.ts`'s `hexToRgb` parses and `<input type="color">` stores.
    expect(toHex(rgba!)).toBe('#ff0000');
  });

  it('returns null for the four points one past each edge of the raster, and for the far corner', () => {
    const field = makeField(3, 3, () => RED);

    expect(sample(field, { x: -1, y: 1 })).toBeNull();
    expect(sample(field, { x: 1, y: -1 })).toBeNull();
    expect(sample(field, { x: 3, y: 1 })).toBeNull();
    expect(sample(field, { x: 1, y: 3 })).toBeNull();
    expect(sample(field, { x: 3, y: 3 })).toBeNull();
  });

  it('keeps the last pixel of each axis in range, because containment is half-open', () => {
    // The pair with the previous test: `x = 2` is the last column of a 3-wide raster and
    // `x = 3` is one past it, so the half-open rule is what separates them.
    const field = makeField(3, 3, () => RED);

    expect(sample(field, { x: 2, y: 2 })).toEqual({ r: 255, g: 0, b: 0, a: 255 });
    expect(sample(field, { x: 2, y: 3 })).toBeNull();
  });

  it('returns null for a fully transparent pixel rather than the black its channels read as', () => {
    const field = makeField(2, 2, () => TRANSPARENT);

    expect(sample(field, { x: 0, y: 0 })).toBeNull();
    // The value it declines to report. `getImageData` un-premultiplies on read, and
    // un-premultiplying alpha 0 divides by zero, so a transparent pixel's RGB is 0,0,0
    // whatever colour it was authored in — `#000000` here would set the foreground to
    // black on a click over empty canvas. Photoshop shows a crossed-out swatch instead.
    expect(toHex({ r: 0, g: 0, b: 0, a: 0 })).toBe('#000000');
  });

  it('returns a translucent pixel unchanged, where a premultiply round trip through 8 bits would report 199 of 200', () => {
    const field = makeField(1, 1, () => TRANSLUCENT);

    expect(sample(field, { x: 0, y: 0 })).toEqual({ r: 200, g: 100, b: 50, a: 128 });
    expect(toHex(sample(field, { x: 0, y: 0 })!)).toBe('#c86432');

    // The round trip the sampler does NOT take, spelled out. `premultiplyRgba` leaves
    // channels unrounded, so the loss is the 8-bit buffer in the middle: 200 * 128/255 is
    // 100.39, which a `Uint8ClampedArray` stores as 100, and 100 * 255/128 is 199.2.
    // Green and blue survive (50.2 -> 50 and 25.1 -> 25 round back to 50), so only the
    // red channel moves — and it moves the colour the user would get.
    const quantised = new Uint8ClampedArray(4);
    writeRgba(quantised, 0, 0, 1, premultiplyRgba({ r: 200, g: 100, b: 50, a: 128 }));
    const roundTripped = unpremultiplyRgba(readRgba(quantised, 0, 0, 1));

    expect(toHex(roundTripped)).toBe('#c76432');
    expect(toHex(roundTripped)).not.toBe(toHex({ r: 200, g: 100, b: 50, a: 128 }));
  });

  it('returns null for a negative coordinate, including one that is only fractionally negative', () => {
    const field = makeField(2, 2, () => RED);

    expect(sample(field, { x: -1, y: 0 })).toBeNull();
    expect(sample(field, { x: 0, y: -1 })).toBeNull();
    // `-0.25` floors to `-1`, so it leaves through the same containment test. A rule that
    // tested the RAW coordinate would also reject this one, and would be wrong about
    // `-0.0` only in a way no pointer can produce.
    expect(sample(field, { x: -0.25, y: 0.75 })).toBeNull();
    expect(sample(field, { x: 0.75, y: -0.25 })).toBeNull();
  });

  it('samples a 1x1 raster at its only point, and reports nothing one pixel past it in either axis', () => {
    const field = makeField(1, 1, () => RED);

    expect(sample(field, { x: 0, y: 0 })).toEqual({ r: 255, g: 0, b: 0, a: 255 });
    expect(sample(field, { x: 1, y: 0 })).toBeNull();
    expect(sample(field, { x: 0, y: 1 })).toBeNull();
    // There is no second pixel to fall back to, so a fractional point is the same pixel.
    expect(sample(field, { x: 0.999, y: 0.999 })).toEqual({ r: 255, g: 0, b: 0, a: 255 });
  });

  it('floors a fractional point to the pixel that contains it, rather than reporting no colour', () => {
    // Every pixel is distinguishable, so floor, round and clamp each give their own answer
    // and the expectation below names the rule rather than the arithmetic.
    const field = makeField(3, 3, (x, y) => [x * 10, y * 10, 0, 255]);

    // (1.7, 2.9) is inside pixel (1, 2). Clamping to the far edge would report (2, 2) and
    // rounding would report (2, 3) instead.
    expect(sample(field, { x: 1.7, y: 2.9 })).toEqual({ r: 10, g: 20, b: 0, a: 255 });
    // A point on the last fraction of the last pixel is still that last pixel.
    expect(sample(field, { x: 2.999, y: 2.999 })).toEqual({ r: 20, g: 20, b: 0, a: 255 });

    // The failure this rule exists to prevent, reproduced on the buffer directly:
    // `readRgba`'s byte-offset guard reports a fractional address as transparent, which is
    // right for a buffer walk and wrong for a pointer. Sampling through it would return
    // black roughly half the time.
    expect(readRgba(field.data, 1.7, 2.9, 3)).toEqual({ r: 0, g: 0, b: 0, a: 0 });
  });

  it('draws the source raster once per sampler, so a second point costs no redraw', () => {
    const field = makeField(3, 3, () => RED);
    const params: ProcessorToolParams = {
      bitmap: createRaster(field),
      size: { width: 3, height: 3 },
    };
    const sampleFrom = sampleColorAt(params);

    expect(sampleFrom({ x: 0, y: 0 })).not.toBeNull();
    expect(sampleFrom({ x: 1, y: 1 })).not.toBeNull();
    expect(sampleFrom({ x: 2, y: 2 })).not.toBeNull();

    // One scratch canvas, one draw: this is the shape a drag-to-sample follow-up needs and
    // the reason `sampleColorAt` is a factory rather than a plain function.
    expect(SamplingOffscreenCanvas.instances).toHaveLength(1);
    expect(SamplingOffscreenCanvas.instances[0].ctx.drawImage).toHaveBeenCalledTimes(1);
  });

  it('reads one pixel at a time rather than the whole raster, so a click does not allocate the document', () => {
    sample(
      makeField(200, 200, () => RED),
      { x: 100, y: 100 }
    );

    const read = SamplingOffscreenCanvas.instances[0].ctx.getImageData;
    expect(read).toHaveBeenCalledWith(100, 100, 1, 1);
  });

  it('returns null when the context has no read-back, rather than throwing', () => {
    vi.stubGlobal('OffscreenCanvas', ReadbacklessOffscreenCanvas as unknown as typeof OffscreenCanvas);

    // The branch `src/test/setup.ts:182-190` documents: the globally installed mock context
    // has no `getImageData`, and `null` is the only answer a caller can act on.
    expect(
      sample(
        makeField(2, 2, () => RED),
        { x: 0, y: 0 }
      )
    ).toBeNull();
  });

  it('returns null when read-back throws, because this runs inside a pointer handler', () => {
    vi.stubGlobal('OffscreenCanvas', ThrowingOffscreenCanvas as unknown as typeof OffscreenCanvas);

    expect(
      sample(
        makeField(2, 2, () => RED),
        { x: 0, y: 0 }
      )
    ).toBeNull();
  });

  it('returns null for a raster with no extent, without reaching for a context', () => {
    const params: ProcessorToolParams = {
      bitmap: createRaster(makeField(0, 0, () => RED)),
      size: { width: 0, height: 0 },
    };

    expect(sampleColorAt(params)({ x: 0, y: 0 })).toBeNull();
    expect(SamplingOffscreenCanvas.instances).toHaveLength(0);
  });
});

describe('the eyedropper module contract', () => {
  it('keeps the args bare, which is why the options bar has nowhere to keep a setting', () => {
    expect(defaultSettings.eyedropper).toEqual({ toolName: 'eyedropper' });
  });

  it('leaves the processor-shaped export a no-op, because the registry wires its own stub', () => {
    // `toolProcessors.eyedropper` is `unimplemented`, so nothing calls this. It stays the
    // tool's processor-shaped face and is asserted here so that the two are not confused:
    // the behaviour is `sampleColorAt`, above, and it returns a colour rather than a raster.
    const bitmap = createRaster(makeField(2, 2, () => RED));

    expect(eyedropper({ bitmap, size: { width: 2, height: 2 } })()).toEqual([bitmap]);
  });
});
