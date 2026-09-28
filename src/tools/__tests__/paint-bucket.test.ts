import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { defaultSettings } from '../settings.ts';
import { paintBucket } from '../paintBucket.ts';
import { makeMockImageData } from '../../__tests__/canvas-mock.ts';
import { createMockCanvasContext } from '../../__tests__/fixtures/canvas.ts';
import { createMagicWandSelectionFromImageData } from '../../util/magicWand.ts';
import type { BitmapSource } from '../../contexts/general-types.ts';
import type { PaintBucketToolArgs } from '../paintBucket.ts';

type MockCtx = ReturnType<typeof createMockCanvasContext>;

/**
 * The shared mock context plus the two read-back methods production guards on, so the recorder
 * below can be a spread of one plus an override of the other two without an excess-property
 * error against the fixture's fixed return type.
 */
type PixelCtx = MockCtx & Pick<CanvasRenderingContext2D, 'getImageData' | 'putImageData'>;

/**
 * A pixel-capable `OffscreenCanvas` recorder.
 *
 * `createMockCanvasContext` in `src/__tests__/fixtures/canvas.ts` deliberately has NO
 * read-back, and `src/test/setup.ts:191` says why: production guards on
 * `typeof ctx.getImageData === 'function'`, so adding it to the shared mock would flip every
 * rasterization test onto the other branch. Asserting real pixels therefore needs a context
 * that genuinely keeps them, and this is that: a real `Uint8ClampedArray` behind the same
 * three methods the processor calls, with the real API's copy semantics on both edges —
 * `getImageData` hands back a COPY, so the processor's in-place `blendPixel` writes cannot
 * reach the canvas until it publishes with `putImageData`, and a run that throws or bails
 * early leaves the source raster on the canvas exactly where it was.
 */
class PixelRecordingOffscreenCanvas {
  static instances: PixelRecordingOffscreenCanvas[] = [];

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
      getImageData: vi.fn((_x: number, _y: number, w: number, h: number) => ({
        data: new Uint8ClampedArray(this.data),
        width: w,
        height: h,
        colorSpace: 'srgb' as const,
      })),
      putImageData: vi.fn((imageData: { data: Uint8ClampedArray }) => {
        this.data.set(imageData.data.subarray(0, this.data.length));
      }),
    };
    PixelRecordingOffscreenCanvas.instances.push(this);
  }

  getContext(): PixelCtx {
    return this.ctx;
  }

  /** The four channels at `(x, y)`, as a tuple so an expectation reads as a colour. */
  at(x: number, y: number): [number, number, number, number] {
    const offset = (y * this.width + x) * 4;
    return [this.data[offset], this.data[offset + 1], this.data[offset + 2], this.data[offset + 3]];
  }
}

/** The source `bitmap` a raster processor is handed: a sized raster carrying its own pixels. */
const createRaster = (imageData: ImageData): BitmapSource =>
  ({
    width: imageData.width,
    height: imageData.height,
    data: new Uint8ClampedArray(imageData.data),
  }) as unknown as BitmapSource;

const WHITE: readonly [number, number, number, number] = [255, 255, 255, 255];
const BLACK: readonly [number, number, number, number] = [0, 0, 0, 255];
const TRANSPARENT: readonly [number, number, number, number] = [0, 0, 0, 0];
const RED: readonly [number, number, number, number] = [255, 0, 0, 255];

/** Opaque black. `fromHex` has no alpha channel, so the fill colour's is always 255. */
const FILL: readonly [number, number, number, number] = [255, 0, 0, 255];

/** One pixel, four channels, written straight into the buffer so a fixture is readable. */
type Channels = readonly [number, number, number, number];

const writeChannels = (data: Uint8ClampedArray, offset: number, [r, g, b, a]: Channels) => {
  data[offset] = r;
  data[offset + 1] = g;
  data[offset + 2] = b;
  data[offset + 3] = a;
};

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

const flatField = (width: number, height: number, fill: Channels): ImageData => makeField(width, height, () => fill);

/**
 * A `size` x `size` opaque red square with a `holeSize` x `holeSize` black block cut out of
 * the middle. The red ring around it is 4-connected and encloses the hole completely, which
 * is the one region shape a traced polygon cannot express.
 */
const squareRing = (size: number, holeSize: number): ImageData => {
  const offset = Math.floor((size - holeSize) / 2);

  return makeField(size, size, (x, y) =>
    x >= offset && x < offset + holeSize && y >= offset && y < offset + holeSize ? BLACK : RED
  );
};

/**
 * The 3x3 fixture from `src/util/__tests__/flood-fill.test.ts`: a 2x2 red block plus one red
 * pixel at (2,2) that only touches it diagonally. The contiguous grow is 4-connected, so the
 * two are separate regions; the global sweep takes all five.
 */
const twoRegions = (): ImageData => {
  const red = new Set(['0,0', '1,0', '0,1', '1,1', '2,2']);

  return makeField(3, 3, (x, y) => (red.has(`${x},${y}`) ? RED : BLACK));
};

beforeEach(() => {
  PixelRecordingOffscreenCanvas.instances = [];
  vi.stubGlobal('OffscreenCanvas', PixelRecordingOffscreenCanvas as unknown as typeof OffscreenCanvas);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The seeded options-bar defaults, with a `seed` supplied for the case under test. */
const bucketArgs = (overrides: Partial<PaintBucketToolArgs> = {}): PaintBucketToolArgs => ({
  ...defaultSettings['paint-bucket'],
  ...overrides,
});

/** Runs the processor and returns the single full-size canvas it must have produced. */
const runBucket = (source: ImageData, overrides: Partial<PaintBucketToolArgs> = {}) => {
  const result = paintBucket({ size: { width: source.width, height: source.height }, bitmap: createRaster(source) })(
    bucketArgs(overrides)
  );

  expect(result).toHaveLength(1);
  const canvas = result[0] as unknown as PixelRecordingOffscreenCanvas;
  // Structural, not truthy: the processor must return the canvas it just allocated.
  expect(canvas).toBe(PixelRecordingOffscreenCanvas.instances.at(-1));
  expect(canvas.width).toBe(source.width);
  expect(canvas.height).toBe(source.height);

  return canvas;
};

describe('paint bucket flood fill', () => {
  it('recolours every pixel of a flat field to the fill colour', () => {
    const canvas = runBucket(flatField(4, 4, WHITE), { seed: { x: 1, y: 1 }, color: '#ff0000', tolerance: 0 });

    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        expect(canvas.at(x, y), `pixel ${x},${y}`).toEqual(FILL);
      }
    }

    expect(canvas.ctx.putImageData).toHaveBeenCalledTimes(1);
  });

  it('draws the source raster in before it fills, so the untouched region survives the commit', () => {
    // A 4x4 field with one black pixel at (1,0). The white around it is the region; the black
    // is not, and at `tolerance: 0` the black stays exactly where the source put it.
    const source = makeField(4, 4, (x, y) => (x === 1 && y === 0 ? BLACK : WHITE));

    const canvas = runBucket(source, { seed: { x: 0, y: 0 }, color: '#ff0000', tolerance: 0 });

    expect(canvas.ctx.drawImage).toHaveBeenCalledTimes(1);
    expect(canvas.at(1, 0)).toEqual(BLACK);
    expect(canvas.at(3, 3)).toEqual(FILL);
  });

  it('leaves a neighbour outside the tolerance untouched and takes it once the tolerance reaches it', () => {
    // Opaque white against opaque black is `sqrt(3 * 255^2) = 441.7` apart, and the tolerance
    // is a fraction of `sqrt(4 * 255^2) = 510`, so the two are the same pixel only somewhere
    // above 86.6%. Zero excludes it; the maximum includes it.
    const source = makeField(4, 4, (x, y) => (x === 1 && y === 0 ? BLACK : WHITE));

    const atZero = runBucket(source, { seed: { x: 0, y: 0 }, color: '#ff0000', tolerance: 0 });
    expect(atZero.at(1, 0)).toEqual(BLACK);

    const atMaximum = runBucket(source, { seed: { x: 0, y: 0 }, color: '#ff0000', tolerance: 100 });
    expect(atMaximum.at(1, 0)).toEqual(FILL);
  });

  it('fills a region with an enclosed hole instead of refusing it the way the Magic Wand does', () => {
    const source = squareRing(5, 3);
    const seed = { x: 0, y: 0 };

    // The same region through the polygon entry point: it returns `null` outright, because a
    // `Selection` is a single point path and committing the outer contour alone would cover the
    // nine hole pixels the mask reported as excluded (`src/util/magicWand.ts:214-218`). This is
    // the case `floodFill` was extracted to serve, so the pin has to name the contrast — an
    // assertion about the bucket alone would pass just as well for a region with no hole.
    expect(createMagicWandSelectionFromImageData(source, seed, { tolerance: 0, contiguous: true })).toBeNull();

    const canvas = runBucket(source, { seed, color: '#ff0000', tolerance: 0, contiguous: true });

    // 25 - 9 = 16 ring pixels recoloured, and every one of the nine hole pixels untouched.
    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < 5; x++) {
        const inHole = x >= 1 && x <= 3 && y >= 1 && y <= 3;
        expect(canvas.at(x, y), `pixel ${x},${y}`).toEqual(inHole ? BLACK : FILL);
      }
    }
  });

  it('fills only the connected region when contiguous, and every matching pixel when it is not', () => {
    const source = twoRegions();

    const contiguous = runBucket(source, { seed: { x: 0, y: 0 }, color: '#ff0000', tolerance: 0, contiguous: true });
    expect(contiguous.at(1, 1)).toEqual(FILL);
    // (2,2) is red but only DIAGONAL to the block, and the grow is 4-connected.
    expect(contiguous.at(2, 2)).toEqual(RED);

    const global = runBucket(source, { seed: { x: 0, y: 0 }, color: '#ff0000', tolerance: 0, contiguous: false });
    expect(global.at(1, 1)).toEqual(FILL);
    expect(global.at(2, 2)).toEqual(FILL);
  });

  it('is a no-op that does not throw for an out-of-image seed', () => {
    const source = flatField(4, 4, WHITE);

    for (const seed of [
      { x: 4, y: 0 },
      { x: 0, y: 4 },
      { x: -1, y: -1 },
      { x: 99, y: 99 },
    ]) {
      const canvas = runBucket(source, { seed, color: '#ff0000', tolerance: 0 });

      expect(canvas.at(0, 0), `seed ${seed.x},${seed.y}`).toEqual(WHITE);
      expect(canvas.ctx.putImageData, `seed ${seed.x},${seed.y}`).not.toHaveBeenCalled();
    }
  });

  it('is a no-op for a missing or non-finite seed, which is what the seeded defaults carry', () => {
    const source = flatField(2, 2, WHITE);

    for (const seed of [undefined, null, { x: Number.NaN, y: 0 }, { x: 0, y: Number.POSITIVE_INFINITY }]) {
      const canvas = runBucket(source, { seed, color: '#ff0000', tolerance: 0 });

      expect(canvas.at(0, 0)).toEqual(WHITE);
      expect(canvas.ctx.putImageData).not.toHaveBeenCalled();
    }
  });

  it('fills a fully transparent field opaquely from a seed on transparent black', () => {
    // A PNG cut-out leaves transparent black behind, and every one of those pixels is
    // identical, so a zero tolerance grows the whole field. The result has to be the fill
    // colour at full alpha rather than a blend into nothing: `blendPixel`'s destination weight
    // is `ad * (1 - effectiveAlpha)`, which is zero when the destination is transparent.
    const canvas = runBucket(flatField(4, 4, TRANSPARENT), { seed: { x: 2, y: 2 }, color: '#ff0000', tolerance: 0 });

    expect(canvas.at(0, 0)).toEqual(FILL);
    expect(canvas.at(3, 3)).toEqual(FILL);
  });

  it('scales the resulting blend by alpha', () => {
    // Black at 50% over opaque white: effective alpha 0.5 over destination alpha 1, so
    // `outAlpha = 0.5 + 1 * 0.5 = 1` and each colour channel is
    // `(0 * 0.5 + 255 * 0.5) / 1 = 127.5`, which the clamped buffer rounds to even: 128.
    const half = runBucket(flatField(2, 2, WHITE), { seed: { x: 0, y: 0 }, color: '#000000', alpha: 0.5 });
    expect(half.at(0, 0)).toEqual([128, 128, 128, 255]);

    // Fully opaque: the fill replaces the destination outright, with no blend at all.
    const opaque = runBucket(flatField(2, 2, WHITE), { seed: { x: 0, y: 0 }, color: '#000000', alpha: 1 });
    expect(opaque.at(0, 0)).toEqual(BLACK);
  });

  it('paints nothing at zero alpha', () => {
    const canvas = runBucket(flatField(2, 2, WHITE), { seed: { x: 0, y: 0 }, color: '#000000', alpha: 0 });

    expect(canvas.at(0, 0)).toEqual(WHITE);
    expect(canvas.at(1, 1)).toEqual(WHITE);
  });

  it('leaves the layer untouched for a fill colour that is not a hex literal', () => {
    // `fromHex` throws on anything else, and a throw from inside a pointer handler is a click
    // that appears to do nothing, so an unparseable colour has to be a defined no-op instead.
    for (const color of ['', 'rgb(255, 0, 0)', '#ff00', 'rebeccapurple']) {
      const canvas = runBucket(flatField(2, 2, WHITE), { seed: { x: 0, y: 0 }, color, tolerance: 0 });

      expect(canvas.at(0, 0), color).toEqual(WHITE);
    }
  });
});
