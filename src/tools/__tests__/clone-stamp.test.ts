import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cloneStamp, CLONE_STAMP_SPACING_PERCENT, type CloneStampToolArgs } from '../cloneStamp.ts';
import { toolProcessors } from '../toolProcessors.ts';
import {
  BRUSH_HARDNESS_DEFAULT,
  BRUSH_HARDNESS_MAX,
  BRUSH_HARDNESS_MIN,
  BRUSH_SIZE_DEFAULT,
  BRUSH_SIZE_MAX,
  BRUSH_SIZE_MIN,
} from '../../util/brush-engine.ts';
import { createPixelCanvasContext } from '../../test/setup.ts';
import { makeMockImageData } from '../../__tests__/canvas-mock.ts';
import type { Point } from '../../contexts/general-types.ts';
import type { Rgba } from '../../util/pixels.ts';

const createSelectionAlphaMaskMock = vi.hoisted(() => vi.fn());

vi.mock('../../util/selection.ts', () => ({
  createSelectionAlphaMask: createSelectionAlphaMaskMock,
}));

/**
 * THE FIXTURE: a 9x5 document whose top-left 4x2 block is the clone SOURCE and whose
 * remainder is one flat colour the stroke runs over.
 *
 * The eight source texels are eight DISTINCT colours, which is what makes the offset
 * assertion in every test below load-bearing. A single-colour source would satisfy the
 * correct offset, a one-pixel-wrong offset in either axis, and a transposed offset all at
 * once; a wrong offset here lands on a different number, so `expect(...).toBe(...)` is a
 * statement about the arithmetic and not about "some red appeared".
 */
const SOURCE_BLOCK: readonly (readonly (readonly [number, number, number])[])[] = [
  [
    [200, 30, 30],
    [30, 200, 30],
    [30, 30, 200],
    [200, 200, 30],
  ],
  [
    [30, 200, 200],
    [200, 30, 200],
    [200, 200, 200],
    [40, 90, 140],
  ],
];

/**
 * The destination, and every texel outside the source block. A triple no source colour
 * uses, so "this texel was never written" and "this texel was written with the source
 * colour that happens to equal it" are distinguishable.
 */
const DESTINATION: readonly [number, number, number] = [12, 34, 56];

/** The fixture's colour at `(x, y)`, in the RGB triple the assertions read. */
const sourceAt = (x: number, y: number): readonly [number, number, number] => {
  const row = SOURCE_BLOCK[y];
  const cell = row?.[x];

  return cell ?? DESTINATION;
};

const DOCUMENT = { width: 9, height: 5 };

/** The fixture as a full RGBA buffer, every texel opaque. */
const makeFixture = (): Uint8ClampedArray => {
  // Through the house `makeMockImageData`, so the fixture has the exact shape and field set
  // `getImageData` hands a processor back. The `fillFn` cannot write into the buffer it is
  // handed a byte offset for, so the channels are written after construction.
  const image = makeMockImageData(DOCUMENT.width, DOCUMENT.height);
  for (let y = 0; y < DOCUMENT.height; y++) {
    for (let x = 0; x < DOCUMENT.width; x++) {
      const [r, g, b] = sourceAt(x, y);
      const offset = (y * DOCUMENT.width + x) * 4;
      image.data[offset] = r;
      image.data[offset + 1] = g;
      image.data[offset + 2] = b;
      image.data[offset + 3] = 255;
    }
  }

  return image.data;
};

const FIXTURE = makeFixture();

type PixelCtx = ReturnType<typeof createPixelCanvasContext>;

/**
 * An `OffscreenCanvas` stub with REAL PIXELS.
 *
 * `src/test/setup.ts` installs a global `OffscreenCanvas` whose context is
 * `createMockCanvasContext`, and that context deliberately has no `getImageData` /
 * `putImageData` (`setup.ts:175-180` documents that adding them would silently flip every
 * rasterization test onto the other branch). A clone stamp is a read-modify-write over
 * pixels, so a mock without read-back can only ever assert "it did not throw" — every
 * arithmetic claim in this file needs real numbers. So this class builds its context with
 * `createPixelCanvasContext` and then replaces the two read-back methods:
 *
 * - `getImageData` returns a FRESH buffer holding the fixture, which is what a real canvas
 *   does and what lets a test tell a read of the source apart from a read of the output.
 * - `putImageData` writes the image into `pixels`, the canvas's own backing store.
 * - `drawImage` also copies the fixture into `pixels`, because in production the bitmap the
 *   processor is handed IS the layer's raster: the processor draws it in and then reads it
 *   back, so a test that let `drawImage` be a no-op would be testing a canvas that starts
 *   transparent.
 *
 * `instances` is the structural assertion handle the house tests use: `toBe(instances.at(-1))`
 * proves WHICH canvas came back, where `toBeTruthy()` would pass for any object.
 */
class RecordingOffscreenCanvas {
  static instances: RecordingOffscreenCanvas[] = [];

  width: number;
  height: number;
  /** The canvas's own backing store — what a caller would see. */
  readonly pixels: Uint8ClampedArray;
  /** The layer raster `drawImage` paints and `getImageData` reads back. */
  readonly seed: Uint8ClampedArray;
  readonly ctx: PixelCtx;

  constructor(width: number, height: number) {
    this.width = Math.max(1, Math.ceil(width));
    this.height = Math.max(1, Math.ceil(height));
    this.pixels = new Uint8ClampedArray(this.width * this.height * 4);
    this.seed = new Uint8ClampedArray(FIXTURE.subarray(0, this.width * this.height * 4));
    this.ctx = createPixelCanvasContext({ width: this.width, height: this.height });

    const target = this.ctx as unknown as Record<string, unknown>;
    target.drawImage = vi.fn(() => {
      this.pixels.set(this.seed);
    });
    // A FRESH buffer per call, exactly as a real canvas returns one, so `getImageData`'s
    // result is never the object the processor is about to write into.
    target.getImageData = vi.fn((_x: number, _y: number, readWidth: number, readHeight: number) => {
      const image = makeMockImageData(readWidth, readHeight);
      image.data.set(this.seed.subarray(0, image.data.length));

      return image;
    });
    target.putImageData = vi.fn((image: ImageData) => {
      this.pixels.set(image.data.subarray(0, this.pixels.length));
    });

    RecordingOffscreenCanvas.instances.push(this);
  }

  getContext(): PixelCtx {
    return this.ctx;
  }
}

beforeEach(() => {
  RecordingOffscreenCanvas.instances = [];
  createSelectionAlphaMaskMock.mockReset();
  vi.stubGlobal('OffscreenCanvas', RecordingOffscreenCanvas as unknown as typeof OffscreenCanvas);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** A stand-in for the layer's `ImageBitmap`, which `drawImage` treats as opaque. */
const sourceBitmap = { width: DOCUMENT.width, height: DOCUMENT.height, close: vi.fn() } as unknown as ImageBitmap;

const args = (overrides: Partial<CloneStampToolArgs> = {}): CloneStampToolArgs => ({
  size: 3,
  hardness: 100,
  alpha: 1,
  source: { x: 1, y: 1 },
  aligned: true,
  points: [{ x: 6, y: 3 }],
  toolName: 'clone-stamp',
  ...overrides,
});

/** Runs the processor and returns the single canvas it must have produced. */
const run = (overrides: Partial<CloneStampToolArgs> = {}): RecordingOffscreenCanvas => {
  const result = cloneStamp({ size: DOCUMENT, bitmap: sourceBitmap })(args(overrides));

  expect(result).toHaveLength(1);
  const canvas = result[0] as unknown as RecordingOffscreenCanvas;
  // Structural, not truthy: the processor must return the document-sized canvas it just
  // allocated, not some other object that happens to exist.
  expect(canvas).toBe(RecordingOffscreenCanvas.instances.at(-1));

  return canvas;
};

/** The RGBA quad at `(x, y)` of a canvas's backing store. */
const at = (canvas: RecordingOffscreenCanvas, x: number, y: number): Rgba => {
  const offset = (y * canvas.width + x) * 4;

  return {
    r: canvas.pixels[offset],
    g: canvas.pixels[offset + 1],
    b: canvas.pixels[offset + 2],
    a: canvas.pixels[offset + 3],
  };
};

const DEST: Rgba = { r: 12, g: 34, b: 56, a: 255 };
/**
 * The fixture texel at `(x, y)` as an opaque quad, so a source value can be written inline.
 *
 * The CLAMP is the processor's: `clampPointToSize` runs on every read, so an expectation
 * about a read that hangs off an edge names the nearest real texel. Expectations that pass
 * in-range coordinates are unaffected.
 */
const src = (x: number, y: number): Rgba => {
  const [r, g, b] = sourceAt(
    Math.min(Math.max(0, x), DOCUMENT.width - 1),
    Math.min(Math.max(0, y), DOCUMENT.height - 1)
  );

  return { r, g, b, a: 255 };
};

/** Every `(x, y)` whose quad differs from the fixture, in row-major order. */
const changedTexels = (canvas: RecordingOffscreenCanvas): string[] => {
  const changed: string[] = [];
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const offset = (y * canvas.width + x) * 4;
      for (let channel = 0; channel < 4; channel++) {
        if (canvas.pixels[offset + channel] !== FIXTURE[offset + channel]) {
          changed.push(`${x},${y}`);
          break;
        }
      }
    }
  }

  return changed;
};

const pixelsOf = (canvas: RecordingOffscreenCanvas): number[] => Array.from(canvas.pixels);

describe('clone stamp processor', () => {
  it('is the exact module-level processor the registry imports, not a wrapper closure', () => {
    // `src/tools/__tests__/tool-processors.test.ts` pins the same identity from the other
    // side. A `params => (args) => ...` inline wrapper would satisfy every behavioural test
    // in this file and break the registry contract, so it is pinned here too.
    expect(toolProcessors['clone-stamp'].imageProcessor).toBe(cloneStamp);
  });

  it('stamps a full document-sized canvas and draws the source raster into it', () => {
    const canvas = run();

    expect(canvas.width).toBe(DOCUMENT.width);
    expect(canvas.height).toBe(DOCUMENT.height);
    expect(canvas.ctx.drawImage).toHaveBeenCalledWith(sourceBitmap, 0, 0);
  });

  it('spacings its dabs at the tip engine default, which the args have no field for', () => {
    // `CloneStampToolArgs` carries no `spacing`, so the percentage is a constant of the
    // tool. Asserted here because a change to it would move every dab in the file.
    expect(CLONE_STAMP_SPACING_PERCENT).toBe(25);
  });

  describe('the no-source and no-stroke states', () => {
    it('is an exact no-op for a null source, and does NOT fill anything', () => {
      const canvas = run({ source: null });

      // The read-back is never even attempted, so the returned canvas is the source raster
      // untouched. A processor that treated a missing source as "copy the whole layer"
      // would put a full second copy here instead.
      expect(canvas.ctx.getImageData).not.toHaveBeenCalled();
      expect(canvas.ctx.putImageData).not.toHaveBeenCalled();
      expect(pixelsOf(canvas)).toEqual(Array.from(FIXTURE));
    });

    it('is an exact no-op for an empty point list', () => {
      const canvas = run({ points: [] });

      expect(canvas.ctx.putImageData).not.toHaveBeenCalled();
      expect(pixelsOf(canvas)).toEqual(Array.from(FIXTURE));
    });

    it('is a no-op that does not throw for a stroke entirely outside the canvas', () => {
      // Every dab's bounding box clips to an empty span, so nothing is written — but the
      // read-back and the write-back still happen, because the stroke as a whole was a
      // legal gesture. A processor that threw here would take the whole stroke down for a
      // dab that had nowhere to land.
      expect(() =>
        run({
          size: 8,
          points: [
            { x: 40, y: 40 },
            { x: 44, y: 44 },
          ],
        })
      ).not.toThrow();

      const canvas = RecordingOffscreenCanvas.instances.at(-1)!;
      expect(pixelsOf(canvas)).toEqual(Array.from(FIXTURE));
    });
  });

  describe('a hard tip copies the source texels exactly', () => {
    // size 3 -> radius 1.5, so the tip is exactly the 3x3 block around an integer centre
    // (the diagonals sit at sqrt(2) = 1.414 < 1.5). hardness 100 makes the whole radius
    // the hard core, so every covered texel takes the source at weight 1 and an opaque
    // source over an opaque destination at coverage 1 is the source, unchanged.
    //
    // source (1, 1), stroke [(6, 3)], aligned -> offset = source - points[0] = (-5, -2).
    it('reproduces the source at source-minus-stroke-start', () => {
      const canvas = run();

      // Row y = 2 reads source row 0, row y = 3 reads source row 1, and the y axis is
      // pinned by the fact that row 4 reads source row 2 — which is past the source block
      // and therefore the destination colour, so the destination is left alone.
      expect(at(canvas, 5, 2)).toEqual(src(0, 0));
      expect(at(canvas, 6, 2)).toEqual(src(1, 0));
      expect(at(canvas, 7, 2)).toEqual(src(2, 0));

      expect(at(canvas, 5, 3)).toEqual(src(0, 1));
      expect(at(canvas, 6, 3)).toEqual(src(1, 1));
      expect(at(canvas, 7, 3)).toEqual(src(2, 1));

      expect(at(canvas, 5, 4)).toEqual(DEST);
      expect(at(canvas, 6, 4)).toEqual(DEST);
      expect(at(canvas, 7, 4)).toEqual(DEST);

      // Nothing outside the 3x3 block: (4, 3) and (8, 3) sit at distance 2, past the
      // 1.5 radius, and (6, 3) - one up is (6, 2), which IS inside. So the rim here is
      // the two horizontal neighbours and the texel above the top row.
      expect(at(canvas, 4, 3)).toEqual(DEST);
      expect(at(canvas, 8, 3)).toEqual(DEST);
      expect(at(canvas, 6, 1)).toEqual(DEST);
    });

    it('writes a single-point stroke as exactly one dab', () => {
      // Nine texels are covered and six of them CHANGE: the bottom row of the block reads
      // the destination colour and writes the destination colour back. Asserting the
      // changed set rather than "something moved" is what pins both the dab count and the
      // y offset — a dab that missed a row would leave 3 or 12 changed texels.
      const canvas = run();

      expect(changedTexels(canvas)).toEqual(['5,2', '6,2', '7,2', '5,3', '6,3', '7,3']);
    });
  });

  describe('a soft tip blends across its rim', () => {
    // size 4 -> radius 2, hardness 0 -> no core at all, so w(d) = 0.5 * (1 + cos(pi * d/2)):
    //   d = 0        -> 1
    //   d = 1        -> 0.5 * (1 + cos(pi/2))  = 0.5
    //   d = sqrt(2)  -> 0.5 * (1 + cos(pi*sqrt(2)/2)) = 0.1971500664605933
    //   d = 2        -> 0, the half-open rim the shared engine documents
    //
    // Same source (1, 1) and same single point (6, 3), so the offset is the same (-5, -2)
    // and every texel below reads the same source texel the hard-tip test read. The
    // destination under the whole tip is (12, 34, 56), and both operands are opaque, so
    // `blendPixel` collapses to a straight per-channel lerp: out = src * w + dst * (1 - w).
    it('weights each texel by the tip falloff rather than replacing it', () => {
      const canvas = run({ size: 4, hardness: 0 });

      // d = 0: full coverage, so the source texel lands exactly.
      expect(at(canvas, 6, 3)).toEqual(src(1, 1));

      // d = 1 at w = 0.5, source (0, 1) = (30, 200, 200):
      //   r = 30*0.5 + 12*0.5 = 21     g = 200*0.5 + 34*0.5 = 117
      //   b = 200*0.5 + 56*0.5 = 128
      expect(at(canvas, 5, 3)).toEqual({ r: 21, g: 117, b: 128, a: 255 });

      // d = 1 at w = 0.5, source (2, 1) = (200, 200, 200):
      //   r = 200*0.5 + 12*0.5 = 106   g = 200*0.5 + 34*0.5 = 117
      //   b = 200*0.5 + 56*0.5 = 128
      expect(at(canvas, 7, 3)).toEqual({ r: 106, g: 117, b: 128, a: 255 });

      // d = 1 at w = 0.5, source (1, 0) = (30, 200, 30):
      //   r = 21   g = 117   b = 30*0.5 + 56*0.5 = 43
      expect(at(canvas, 6, 2)).toEqual({ r: 21, g: 117, b: 43, a: 255 });

      // d = sqrt(2) at w = 0.1971500664605933, source (0, 0) = (200, 30, 30):
      //   r = 200*0.19715 + 12*0.80285 = 39.43 + 9.63  = 49.06 -> 49
      //   g =  30*0.19715 + 34*0.80285 =  5.91 + 27.30 = 33.21 -> 33
      //   b =  30*0.19715 + 56*0.80285 =  5.91 + 44.96 = 50.87 -> 51
      expect(at(canvas, 5, 2)).toEqual({ r: 49, g: 33, b: 51, a: 255 });

      // d = sqrt(2), source (2, 0) = (30, 30, 200):
      //   r =  5.91 +  9.63 = 15.54 -> 16
      //   g =  5.91 + 27.30 = 33.21 -> 33
      //   b = 200*0.19715 + 56*0.80285 = 39.43 + 44.96 = 84.39 -> 84
      expect(at(canvas, 7, 2)).toEqual({ r: 16, g: 33, b: 84, a: 255 });
    });

    it('leaves the half-open rim at distance exactly the radius untouched', () => {
      // `tipAlphaAt` returns 0 at `distance >= radius` at every hardness, so a texel one
      // step further out than the last is NOT a partially-faded copy. This is the shared
      // engine's documented decision, read through the engine rather than re-derived.
      const canvas = run({ size: 4, hardness: 0 });

      // (4, 3) and (6, 1) are both at distance exactly 2 from the centre (6, 3).
      expect(at(canvas, 4, 3)).toEqual(DEST);
      expect(at(canvas, 6, 1)).toEqual(DEST);
      // (8, 3) is also at distance 2, and (5, 2) is one diagonal further in and IS blended.
      expect(at(canvas, 8, 3)).toEqual(DEST);
      expect(at(canvas, 5, 2)).not.toEqual(DEST);
    });
  });

  describe('aligned and free strokes read different places on the source', () => {
    // The stroke [(6, 3), (8, 3)] with a 3px tip at 25% spacing is a 0.75px step, so
    // `brushDabCenters` emits (6, 3), (6.75, 3), (7.5, 3) and (8, 3). The LAST of those
    // covers every texel asserted below at weight 1, so what each mode leaves at (7, 2),
    // (8, 2), (7, 3) and (8, 3) is decided entirely by which anchor the offset uses:
    //
    //   aligned: source - points[0]    = (1, 1) - (6, 3) = (-5, -2)   -> reads x 1..3 of row 0/1
    //   free:    source - points[n-1]  = (1, 1) - (8, 3) = (-7, -2)   -> reads x 0..2 of row 0/1
    //
    // The eight source colours are all distinct, so the two modes cannot agree anywhere in
    // that window by accident. This is the whole point of the mode, so it is pinned
    // pairwise AND against the exact source texel each mode names.
    const stroke: Point[] = [
      { x: 6, y: 3 },
      { x: 8, y: 3 },
    ];

    it('reads from the stroke start when aligned', () => {
      const canvas = run({ points: stroke, aligned: true });

      expect(at(canvas, 7, 2)).toEqual(src(2, 0));
      expect(at(canvas, 8, 2)).toEqual(src(3, 0));
      expect(at(canvas, 7, 3)).toEqual(src(2, 1));
      expect(at(canvas, 8, 3)).toEqual(src(3, 1));
    });

    it('reads from the stroke end when not aligned', () => {
      const canvas = run({ points: stroke, aligned: false });

      expect(at(canvas, 7, 2)).toEqual(src(0, 0));
      expect(at(canvas, 8, 2)).toEqual(src(1, 0));
      expect(at(canvas, 7, 3)).toEqual(src(0, 1));
      expect(at(canvas, 8, 3)).toEqual(src(1, 1));
    });

    it('puts every one of those texels somewhere different between the two modes', () => {
      const aligned = run({ points: stroke, aligned: true });
      const free = run({ points: stroke, aligned: false });

      for (const [x, y] of [
        [7, 2],
        [8, 2],
        [7, 3],
        [8, 3],
      ] as const) {
        expect(at(free, x, y), `(${x}, ${y})`).not.toEqual(at(aligned, x, y));
        // Neither mode is the identity: the destination colour is not what either leaves.
        expect(at(free, x, y), `(${x}, ${y})`).not.toEqual(DEST);
        expect(at(aligned, x, y), `(${x}, ${y})`).not.toEqual(DEST);
      }

      expect(pixelsOf(free)).not.toEqual(pixelsOf(aligned));
    });
  });

  describe('alpha', () => {
    // size 3, hardness 100: the whole 3x3 block takes the source at weight 1, so `alpha` is
    // the only thing left in the blend. Both operands are opaque, so coverage `a` gives
    // out = src * a + dst * (1 - a) per channel, with the destination (12, 34, 56).
    it('scales the copy strength, and the number is the straight lerp', () => {
      const canvas = run({ alpha: 0.5 });

      // source (1, 1) = (200, 30, 200) at coverage 0.5:
      //   r = 200*0.5 + 12*0.5 = 106   g = 30*0.5 + 34*0.5 = 32
      //   b = 200*0.5 + 56*0.5 = 128
      expect(at(canvas, 6, 3)).toEqual({ r: 106, g: 32, b: 128, a: 255 });

      // source (0, 0) = (200, 30, 30) at coverage 0.5:
      //   r = 106   g = 32   b = 30*0.5 + 56*0.5 = 43
      expect(at(canvas, 5, 2)).toEqual({ r: 106, g: 32, b: 43, a: 255 });

      // A weaker copy is a weaker copy, and 0.5 is strictly between nothing and the source.
      expect(at(canvas, 6, 3).r).toBeLessThan(src(1, 1).r);
      expect(at(canvas, 6, 3).r).toBeGreaterThan(DEST.r);
    });

    it('is an exact no-op at zero', () => {
      const canvas = run({ alpha: 0 });

      // The stroke is refused outright rather than blended at coverage 0, so there is not
      // even a read-back. A blend at coverage 0 would leave the same pixels by accident and
      // a clamp that mapped 0 to the default 1 would be invisible here.
      expect(canvas.ctx.putImageData).not.toHaveBeenCalled();
      expect(pixelsOf(canvas)).toEqual(Array.from(FIXTURE));
    });
  });

  describe('edge handling', () => {
    // source (0, 0) with a stroke at (6, 3) gives the offset (-6, -3), so the whole 3x3
    // block reads off the top-left corner and every read is clamped to the nearest real
    // texel. Clipping rather than throwing is the same choice `src/tools/smudge.ts:149`
    // makes for the same reason.
    it('clamps a read that hangs off the top-left corner instead of throwing', () => {
      expect(() => run({ source: { x: 0, y: 0 } })).not.toThrow();

      const canvas = RecordingOffscreenCanvas.instances.at(-1)!;
      // Row y = 2 reads y = -1 -> clamped to row 0; row y = 3 reads row 0; row y = 4 reads
      // row 1. The x axis behaves the same way: x = 5 reads x = -1 -> clamped to x = 0.
      expect(at(canvas, 5, 2)).toEqual(src(0, 0));
      expect(at(canvas, 6, 2)).toEqual(src(0, 0));
      expect(at(canvas, 7, 2)).toEqual(src(1, 0));

      expect(at(canvas, 5, 3)).toEqual(src(0, 0));
      expect(at(canvas, 6, 3)).toEqual(src(0, 0));
      expect(at(canvas, 7, 3)).toEqual(src(1, 0));

      expect(at(canvas, 5, 4)).toEqual(src(0, 1));
      expect(at(canvas, 6, 4)).toEqual(src(0, 1));
      expect(at(canvas, 7, 4)).toEqual(src(1, 1));
    });

    it('leaves the far side of a huge tip clamped rather than wrapping onto another row', () => {
      // A 500px tip on a 9x5 document covers all 45 texels, so every read is off the edge
      // on both axes at once. Addressing the buffer with a declared size larger than the
      // buffer would put row `y` in the wrong place rather than out of range, which is the
      // wrong-answer failure `writableSize` exists to prevent in the shared engine.
      //
      // With the offset (-5, -2), the read column is `clamp(x - 5, 0, 8)` — so columns 0
      // through 5 all read column 0 — and the read row is `clamp(y - 2, 0, 4)`, so rows 0,
      // 1 and 2 all read source row 0, row 3 reads source row 1, and row 4 reads source
      // row 2, which is past the 2-row source block and therefore the destination.
      // Counted from that table: (0, 0) already holds column 0's colour and row 4 already
      // holds the destination, so those 10 texels are unchanged and the other 35 change.
      const canvas = run({ size: 500 });

      expect(changedTexels(canvas)).toHaveLength(35);
      expect(at(canvas, 0, 0)).toEqual(src(0, 0));
      expect(at(canvas, 5, 0)).toEqual(src(0, 0));
      expect(at(canvas, 6, 0)).toEqual(src(1, 0));
      expect(at(canvas, 8, 0)).toEqual(src(3, 0));
      expect(at(canvas, 0, 3)).toEqual(src(0, 1));
      expect(at(canvas, 8, 3)).toEqual(src(3, 1));
      expect(at(canvas, 0, 4)).toEqual(DEST);
      expect(at(canvas, 8, 4)).toEqual(DEST);
    });
  });

  describe('clamping an out-of-range or non-finite control', () => {
    // `clampBrushTipSettings` is the single place the ranges live, so "clamped, not
    // thrown" is asserted as PIXEL EQUALITY against the clamped value rather than as the
    // absence of an exception: a processor that quietly ignored `size` would also not throw.
    const equivalentTo = (override: Partial<CloneStampToolArgs>, reference: Partial<CloneStampToolArgs>) => {
      expect(pixelsOf(run(override))).toEqual(pixelsOf(run(reference)));
    };

    it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
      'falls back to the Photoshop default size for the non-finite size %p',
      (size) => {
        equivalentTo({ size }, { size: BRUSH_SIZE_DEFAULT });
      }
    );

    it('clamps an over-range size to the maximum and an under-range one to the minimum', () => {
      equivalentTo({ size: 5000 }, { size: BRUSH_SIZE_MAX });
      equivalentTo({ size: 0 }, { size: BRUSH_SIZE_MIN });
      equivalentTo({ size: -40 }, { size: BRUSH_SIZE_MIN });
    });

    it.each([Number.NaN, 250, -40])('clamps the out-of-range hardness %p into 0-100', (hardness) => {
      const clamped = Number.isFinite(hardness)
        ? Math.min(BRUSH_HARDNESS_MAX, Math.max(BRUSH_HARDNESS_MIN, hardness))
        : BRUSH_HARDNESS_DEFAULT;

      equivalentTo({ hardness }, { hardness: clamped });
    });

    it.each([Number.NaN, 3, -0.25])('clamps the out-of-range alpha %p into 0-1', (alpha) => {
      const clamped = Number.isFinite(alpha) ? Math.min(1, Math.max(0, alpha)) : 1;

      equivalentTo({ alpha }, { alpha: clamped });
    });

    it('does not throw for any of them together', () => {
      expect(() => run({ size: Number.NaN, hardness: Number.NaN, alpha: Number.NaN })).not.toThrow();
      expect(() => run({ size: -1, hardness: 400, alpha: 9 })).not.toThrow();
    });
  });

  describe('the source buffer is read, never the output', () => {
    // THE FIXTURE FOR THE DEFECT. A clone dab writes a disc and reads the same disc
    // translated by a CONSTANT offset, so the read set of the second dab of a stroke
    // overlaps the write set of the first — by construction, not by accident. Reading the
    // output instead of the source therefore compounds: each dab copies what the previous
    // dab just wrote, and a drag degenerates into one colour smeared along its own tail.
    //
    // A size-8 tip at 25% spacing is a 2px step, so [(6, 3), (8, 3)] is exactly two dabs,
    // (6, 3) then (8, 3), both at radius 4. The offset is (-5, -2).
    //
    //   (8, 3) is written by BOTH dabs, so the second one decides it.
    //   The correct read is the source at (8, 3) + (-5, -2) = (3, 1) = (40, 90, 140).
    //   A self-referential read would instead read the OUTPUT at (3, 1) — which the FIRST
    //   dab already overwrote with the source at (3, 1) + (-5, -2) = (-2, -1), clamped to
    //   (0, 0) = (200, 30, 30). That is a visibly different number, so this one assertion
    //   separates the two implementations.
    const smear: Partial<CloneStampToolArgs> = {
      size: 8,
      hardness: 100,
      alpha: 1,
      aligned: true,
      source: { x: 1, y: 1 },
      points: [
        { x: 6, y: 3 },
        { x: 8, y: 3 },
      ],
    };

    it('leaves the correct source texel at a point whose read the first dab had already written', () => {
      const canvas = run(smear);

      expect(at(canvas, 8, 3)).toEqual(src(3, 1));
      // The smeared value, spelled out so the failure names the defect rather than a diff.
      expect(at(canvas, 8, 3)).not.toEqual(src(0, 0));
      expect(at(canvas, 8, 3)).not.toEqual(DEST);
    });

    it('reads the source for every texel the last dab covers, at any point along the stroke', () => {
      const canvas = run(smear);

      // The last dab is at (8, 3) with radius 4, so it covers x 4..8 and y 0..4, and every
      // one of those texels must hold the source at (x - 5, y - 2). (3, 1) is the one that
      // makes the difference; the rest are pinned so a partial fix cannot pass.
      for (let y = 0; y <= 4; y++) {
        for (let x = 4; x <= 8; x++) {
          expect(at(canvas, x, y), `(${x}, ${y})`).toEqual(src(x - 5, y - 2));
        }
      }
    });

    it('reads a fresh buffer per call rather than a canvas that remembers', () => {
      // Two consecutive runs of the same stroke must agree byte for byte. A read-back that
      // returned the canvas's own live pixels would make the second run start from the
      // first run's output and drift.
      expect(pixelsOf(run(smear))).toEqual(pixelsOf(run(smear)));
    });
  });
});

describe('active selection clipping', () => {
  it('keeps the no-selection processor path unchanged', () => {
    const canvas = run();

    expect(createSelectionAlphaMaskMock).not.toHaveBeenCalled();
    expect(at(canvas, 6, 3)).toEqual(src(1, 1));
  });

  it('writes only where the committed selection mask allows the dab', () => {
    const mask = new Uint8Array(DOCUMENT.width * DOCUMENT.height);
    mask[3 * DOCUMENT.width + 6] = 255;
    createSelectionAlphaMaskMock.mockReturnValue(mask);

    const canvas = run({
      selection: {
        points: [{ x: 0, y: 0 }],
        featherRadius: 0,
        antiAlias: true,
      },
    });

    expect(at(canvas, 6, 3)).toEqual(src(1, 1));
    expect(at(canvas, 5, 3)).toEqual(DEST);
    expect(createSelectionAlphaMaskMock).toHaveBeenCalledWith(
      {
        points: [{ x: 0, y: 0 }],
        featherRadius: 0,
        antiAlias: true,
      },
      DOCUMENT,
      {
        points: [{ x: 0, y: 0 }],
        featherRadius: 0,
        antiAlias: true,
      }
    );
  });

  it('multiplies feathered selection coverage with the clone tip weight', () => {
    const mask = new Uint8Array(DOCUMENT.width * DOCUMENT.height);
    mask[3 * DOCUMENT.width + 6] = 128;
    createSelectionAlphaMaskMock.mockReturnValue(mask);

    const canvas = run({
      selection: {
        points: [{ x: 0, y: 0 }],
        featherRadius: 4,
        antiAlias: true,
      },
    });

    expect(at(canvas, 6, 3)).toEqual({ r: 106, g: 32, b: 128, a: 255 });
    expect(at(canvas, 5, 3)).toEqual(DEST);
  });

  it('replays the same selection snapshot after JSON serialization', () => {
    const selection = {
      points: [],
      rasterMask: { width: 2, height: 2, data: 'AQ==', x: 0, y: 0 },
      featherRadius: 3,
      antiAlias: false,
    };
    const replayed = JSON.parse(JSON.stringify(selection)) as typeof selection;
    const mask = new Uint8Array(DOCUMENT.width * DOCUMENT.height);
    mask[3 * DOCUMENT.width + 6] = 255;
    createSelectionAlphaMaskMock.mockReturnValue(mask);

    const canvas = run({ selection: replayed });

    expect(at(canvas, 6, 3)).toEqual(src(1, 1));
    expect(createSelectionAlphaMaskMock).toHaveBeenCalledWith(replayed, DOCUMENT, replayed);
  });
});
