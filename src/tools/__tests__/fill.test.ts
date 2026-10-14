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
import { createMockImageBitmap } from '../../__tests__/fixtures/canvas.ts';
import { createPixelCanvasContext } from '../../test/setup.ts';
import type { ToolArgs } from '../../contexts/tool-types.ts';

type MockCtx = ReturnType<typeof createPixelCanvasContext> & {
  drawImage: ReturnType<typeof vi.fn>;
  getImageData: ReturnType<typeof vi.fn>;
  putImageData: ReturnType<typeof vi.fn>;
};

const SIZE = { width: 4, height: 4 };

/**
 * A readable pixel buffer: an L-shaped opaque red region in the top-left corner plus one isolated
 * red pixel at (3,3). The isolated pixel is the only thing that separates a 4-connected flood from
 * an all-matching scan, and it is not adjacent to the L, so a contiguous fill cannot reach it.
 */
const RED_PIXELS: readonly [number, number][] = [
  [0, 0],
  [1, 0],
  [0, 1],
  [3, 3],
];

/**
 * Set by a test that needs a fully transparent destination. Under transparency the stored RGB is
 * meaningless, which is the whole point: it is what separates a straight-alpha composite from a
 * lerp of two straight RGBs.
 */
let sourceIsTransparent = false;

const sourcePixels = (): Uint8ClampedArray => {
  const data = new Uint8ClampedArray(SIZE.width * SIZE.height * 4);
  for (const [x, y] of RED_PIXELS) {
    const index = (y * SIZE.width + x) * 4;
    data[index] = 255;
    data[index + 3] = sourceIsTransparent ? 0 : 255;
  }
  return data;
};

class RecordingOffscreenCanvas {
  static instances: RecordingOffscreenCanvas[] = [];
  /** Every `putImageData` payload, in call order, so the mutated pixels are inspectable. */
  static written: ImageData[] = [];

  width: number;
  height: number;
  readonly ctx: MockCtx;
  private readonly pixels: Uint8ClampedArray;

  constructor(width: number, height: number) {
    this.width = Math.max(1, Math.ceil(width));
    this.height = Math.max(1, Math.ceil(height));
    this.pixels = sourcePixels();
    const base = createPixelCanvasContext(this) as unknown as Record<string, unknown>;
    this.ctx = {
      ...base,
      getImageData: vi.fn((_x: number, _y: number, w: number, h: number) => ({
        data: this.pixels,
        width: w,
        height: h,
        colorSpace: 'srgb',
      })),
      putImageData: vi.fn((imageData: ImageData) => {
        this.pixels.set(imageData.data);
        RecordingOffscreenCanvas.written.push(imageData);
      }),
    } as unknown as MockCtx;
    RecordingOffscreenCanvas.instances.push(this);
  }

  getContext(): MockCtx {
    return this.ctx;
  }
}

const fillArgs = (toolName: FillToolName, overrides: Partial<FillToolArgs> = {}): ToolArgs =>
  ({
    ...defaultSettings[toolName],
    toolName,
    pos: { x: 0, y: 0 },
    ...overrides,
  }) as unknown as ToolArgs;

const run = (toolName: FillToolName, overrides: Partial<FillToolArgs> = {}, withBitmap = true): [unknown, MockCtx] => {
  const params = withBitmap ? { size: SIZE, bitmap: createMockImageBitmap(SIZE.width, SIZE.height) } : { size: SIZE };
  const processor = toolName === 'paint-bucket' ? paintBucket : magicEraser;
  const [canvas] = processor(params as never)(fillArgs(toolName, overrides));
  // The RETURNED canvas's own context, not `instances.at(-1)`: the pixel read allocates a second
  // OffscreenCanvas after this one, and asserting on that one would pass even if the output
  // canvas were blanked.
  return [canvas, (canvas as unknown as RecordingOffscreenCanvas).ctx];
};

const writtenPixels = (): Uint8ClampedArray => RecordingOffscreenCanvas.written.at(-1)!.data;
const alphaAt = (x: number, y: number) => writtenPixels()[(y * SIZE.width + x) * 4 + 3];
const rgbAt = (x: number, y: number, channel: number) => writtenPixels()[(y * SIZE.width + x) * 4 + channel];

/**
 * The same run, but through `toolProcessors[name]` rather than through a function this file
 * picked by its own `toolName` argument.
 *
 * The registry wires all three raster fills through an inline adapter closure rather than
 * naming the module export, so no test could see a copy-paste slip between them: identity
 * comparison is vacuous across three distinct closures, and the dispatch table runs them all
 * on default settings, where an alpha-only erase and a black fill over transparent produce
 * byte-identical output. Going through the registry is the only way to pin the delegation.
 */
const runThroughRegistry = (toolName: FillToolName, overrides: Partial<FillToolArgs> = {}): void => {
  const params = { size: SIZE, bitmap: createMockImageBitmap(SIZE.width, SIZE.height) };

  toolProcessors[toolName].imageProcessor(params)(fillArgs(toolName, overrides));
};

beforeEach(() => {
  RecordingOffscreenCanvas.instances = [];
  RecordingOffscreenCanvas.written = [];
  vi.stubGlobal('OffscreenCanvas', RecordingOffscreenCanvas as unknown as typeof OffscreenCanvas);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fill tolerance scale', () => {
  it('is Adobe 0-255 and not the Magic Wand 0-100', () => {
    expect(FILL_TOLERANCE_MAX).toBe(255);
  });

  it('seeds both fill tools with the exported default, which is what makes its doc comment true', () => {
    // `FILL_TOLERANCE_DEFAULT` is documented as "Adobe's seeded default for both the bucket
    // and the magic eraser", but nothing referenced it: `settings.ts` writes the literal 32
    // twice, independently. Re-seeding either tool from a different number would leave the
    // exported constant describing a default the app no longer ships, and nothing would fail
    // except this assertion. The equality is the doc comment; the value alone is not.
    expect(FILL_TOLERANCE_DEFAULT).toBe(32);
    expect(defaultSettings['magic-eraser'].tolerance).toBe(FILL_TOLERANCE_DEFAULT);
    expect(defaultSettings['paint-bucket'].tolerance).toBe(FILL_TOLERANCE_DEFAULT);
  });
});

/**
 * The click travels in the args and the geometry does not, and the asymmetry is the contract.
 *
 * `pos` is in `FillToolArgs` because a durable `apply-raster-processor` op replays from the stored
 * args alone. A `size` was there too, and nothing read it: both processors take the geometry from
 * the curried `ProcessorToolParams` — `fillLayer` destructures `params.size` — and the durable call
 * site passes `{ bitmap, size }` beside the args. So the seeded `1x1` was the only value that ever
 * existed in it, which is what made it a trap in both directions: a reader trusting it filled
 * `1x1`, and a writer forgetting it produced a layer-sized fill with nothing to say so.
 *
 * `satisfies FillToolArgs` in `settings.ts` already fails a re-added key, so this is not the check
 * that catches the regression — it is the statement of which half of the geometry is an argument and
 * which half is a parameter, in the one place a reader of the args contract will look.
 */
describe('fill args geometry', () => {
  it('seeds both fill tools with the click and with no size, which the processors never read', () => {
    for (const toolName of ['magic-eraser', 'paint-bucket'] as const) {
      const args = defaultSettings[toolName];

      expect(Object.hasOwn(args, 'pos')).toBe(true);
      expect(Object.hasOwn(args, 'size')).toBe(false);
    }
  });
});

describe('paint bucket', () => {
  it('paints the matched region and leaves the rest of the layer alone', () => {
    run('paint-bucket', { color: '#0000FF', tolerance: 0, alpha: 1 });

    // (0,0), (1,0) and (0,1) form the 4-connected region the seed reaches, so red becomes blue.
    expect(rgbAt(0, 0, 0)).toBe(0);
    expect(rgbAt(0, 0, 2)).toBe(255);
    expect(rgbAt(1, 0, 2)).toBe(255);
    // The isolated red pixel at (3,3) is the same colour but is not connected, so it is untouched.
    expect(rgbAt(3, 3, 0)).toBe(255);
    expect(rgbAt(3, 3, 2)).toBe(0);
    // A fully transparent pixel outside every region stays transparent.
    expect(alphaAt(3, 0)).toBe(0);
  });

  it('raises the alpha of transparent pixels it paints, so a fill is visible at all', () => {
    run('paint-bucket', { color: '#0000FF', tolerance: 255, alpha: 1 });

    expect(alphaAt(3, 3)).toBe(255);
    expect(rgbAt(3, 3, 2)).toBe(255);
  });

  it('composites the fill at the requested opacity over an opaque pixel', () => {
    run('paint-bucket', { color: '#0000FF', tolerance: 0, alpha: 0.5 });

    // 50% blue over opaque red: blue half, red half.
    expect(rgbAt(0, 0, 2)).toBe(128);
    expect(rgbAt(0, 0, 0)).toBe(128);
  });

  it('keeps the fill colour intact under a partially transparent pixel', () => {
    sourceIsTransparent = true;
    try {
      run('paint-bucket', { color: '#0000FF', tolerance: 0, alpha: 0.5 });
    } finally {
      sourceIsTransparent = false;
    }

    // The destination's stored RGB under full transparency is 0, so a lerp of the two straight
    // RGBs writes (0, 0, 128) — the fill mixed with nothing, i.e. half-black instead of half-blue.
    // Straight-alpha source-over gives the fill colour at half coverage. This case is the reason
    // `blendPixel` is used: the opaque-destination case above cannot tell the two apart, which is
    // why this test exists separately rather than folded into it.
    expect(rgbAt(0, 0, 2)).toBe(255);
    expect(rgbAt(0, 0, 0)).toBe(0);
    expect(alphaAt(0, 0)).toBe(128);
  });

  it('reaches an identical but unconnected pixel only when Contiguous is off', () => {
    run('paint-bucket', { color: '#0000FF', tolerance: 0, contiguous: false });

    expect(rgbAt(3, 3, 0)).toBe(0);
    expect(rgbAt(3, 3, 2)).toBe(255);
    expect(rgbAt(0, 0, 2)).toBe(255);
  });

  it('keeps the layer unchanged when the click is outside the layer', () => {
    const [, ctx] = run('paint-bucket', { color: '#0000FF', tolerance: 0, pos: { x: 99, y: 99 } });

    // No region means no fill, so the commit must hand the source straight back rather than a
    // blank canvas — a blank canvas would erase the whole layer.
    expect(RecordingOffscreenCanvas.written).toEqual([]);
    expect(ctx.drawImage).toHaveBeenCalledTimes(1);
    expect(ctx.putImageData).not.toHaveBeenCalled();
  });

  it('returns a blank canvas of the layer size on the creator path, which has no pixels to fill', () => {
    const [canvas] = run('paint-bucket', {}, false);

    expect(canvas).toBe(RecordingOffscreenCanvas.instances.at(-1));
    expect((canvas as unknown as RecordingOffscreenCanvas).width).toBe(SIZE.width);
    expect(RecordingOffscreenCanvas.written).toEqual([]);
  });
});

describe('magic eraser', () => {
  it('makes the matched region fully transparent at the seeded opacity', () => {
    run('magic-eraser', { tolerance: 0, alpha: 1 });

    expect(alphaAt(0, 0)).toBe(0);
    expect(alphaAt(1, 0)).toBe(0);
    expect(alphaAt(0, 1)).toBe(0);
  });

  it('only partially erases below full opacity, matching the Eraser stroke model', () => {
    run('magic-eraser', { tolerance: 0, alpha: 0.25 });

    expect(alphaAt(0, 0)).toBe(191);
  });

  it('leaves the region colour alone, so erasing discards alpha rather than darkening pixels', () => {
    run('magic-eraser', { tolerance: 0, alpha: 1 });

    expect(rgbAt(0, 0, 0)).toBe(255);
    expect(rgbAt(0, 0, 1)).toBe(0);
  });

  it('keeps the layer unchanged when the seed is outside the layer', () => {
    const [, ctx] = run('magic-eraser', { pos: { x: 99, y: 99 } });

    expect(RecordingOffscreenCanvas.written).toEqual([]);
    expect(ctx.drawImage).toHaveBeenCalledTimes(1);
    expect(ctx.putImageData).not.toHaveBeenCalled();
  });
});

describe('fill processors are distinct', () => {
  it('does not route the bucket and the magic eraser through one shared function', () => {
    // `tool-processors.test.ts` pins the registry entries separately; this pins the functions.
    expect(paintBucket).not.toBe(magicEraser);
    expect(paintBucket({ size: SIZE })).not.toBe(magicEraser({ size: SIZE }));
  });
});

/**
 * The registry's own delegation, observed through it.
 *
 * Each entry is an inline `(params) => (args) => fn(params)(args)` adapter, so the three
 * raster fills are three distinct closures and every identity-based test in the suite passes
 * for all of them. The default-settings dispatch row cannot tell them apart either: the
 * bucket's default colour is black, so it writes black over transparent exactly like the
 * alpha-only magic eraser. These two cases are the discriminating pair — a bucket write
 * carries the fill colour and a full alpha, and an erase carries neither.
 */
describe('fill registry delegation', () => {
  it('routes paint-bucket to the colour write, through the registry', () => {
    runThroughRegistry('paint-bucket', { color: '#0000FF', tolerance: 0, alpha: 1 });

    // Both halves of a bucket write are asserted, because either alone is satisfiable by
    // the wrong processor: the blue channel is the fill colour arriving, and the alpha is
    // the coverage a fill has to raise or a fill over transparent would tint nothing.
    expect(rgbAt(0, 0, 2)).toBe(255);
    expect(alphaAt(0, 0)).toBe(255);
  });

  it('routes magic-eraser to the alpha-only write, through the registry', () => {
    runThroughRegistry('magic-eraser', { tolerance: 0, alpha: 1 });

    // Full alpha, so the region is gone rather than faded, and the colour is untouched: an
    // erase discards alpha, it does not paint. A bucket routed here would fail both.
    expect(alphaAt(0, 0)).toBe(0);
    expect(rgbAt(0, 0, 0)).toBe(255);
    expect(rgbAt(0, 0, 2)).toBe(0);
  });
});

/**
 * The selection snapshot carried by the committed args, clipped to the fill region.
 *
 * The processor allocates three OffscreenCanvases in order: the output canvas, the source
 * readback canvas, and the selection-mask canvas inside `createSelectionAlphaMask`. The mock
 * global in `beforeEach` gives every one a real context whose drawing calls are no-ops, so
 * the mask canvas would rasterize from its initial source pixels instead of the polygon.
 * The spy below returns `null` for the third allocation onward, forcing `rasterizePolygonMask`
 * through its CPU `isPointInPolygon` fallback — the same trick the eraser brush test uses.
 */
describe('fill with selection snapshot', () => {
  const withCpuSelectionMask = (): (() => void) => {
    const originalGetContext = RecordingOffscreenCanvas.prototype.getContext;
    const spy = vi.spyOn(RecordingOffscreenCanvas.prototype, 'getContext').mockImplementation(function (
      this: RecordingOffscreenCanvas
    ) {
      if (RecordingOffscreenCanvas.instances.length > 2) return null as unknown as MockCtx;
      return originalGetContext.call(this);
    });
    return () => spy.mockRestore();
  };

  /**
   * A 2×1 strip covering only the top row (y = 0) of the 4×4 grid. The flood fill from
   * (0,0) at tolerance 0 reaches (0,0), (1,0) and (0,1) — the L's three connected pixels.
   * With this selection, (0,0) and (1,0) are inside and (0,1) is clipped.
   */
  const topRowSelection = (
    overrides: Partial<NonNullable<FillToolArgs['selection']>> = {}
  ): NonNullable<FillToolArgs['selection']> => ({
    points: [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 1 },
      { x: 0, y: 1 },
    ],
    featherRadius: 0,
    antiAlias: false,
    ...overrides,
  });

  describe('paint bucket', () => {
    it('clips pixels outside the selection snapshot to the untouched source', () => {
      const restore = withCpuSelectionMask();
      try {
        run('paint-bucket', {
          color: '#0000FF',
          tolerance: 0,
          alpha: 1,
          selection: topRowSelection(),
        });

        // (0,0) and (1,0) are inside the selection → filled blue.
        expect(rgbAt(0, 0, 2)).toBe(255);
        expect(rgbAt(0, 0, 0)).toBe(0);
        expect(rgbAt(1, 0, 2)).toBe(255);
        expect(rgbAt(1, 0, 0)).toBe(0);
        // (0,1) is in the flood-fill region but outside the selection → untouched, stays red.
        expect(rgbAt(0, 1, 2)).toBe(0);
        expect(rgbAt(0, 1, 0)).toBe(255);
      } finally {
        restore();
      }
    });

    it('preserves fractional selection edge alpha so opacity composes with coverage', () => {
      const restore = withCpuSelectionMask();
      try {
        run('paint-bucket', {
          color: '#0000FF',
          tolerance: 0,
          alpha: 1,
          selection: topRowSelection({ featherRadius: 2, antiAlias: true }),
        });

        // Feathered over 2px: the covered row sits one step inside the edge, so the chamfer
        // distance gives it ~84% coverage (215/255). The clipped row is one step outside,
        // getting ~16% coverage (40/255). Coverage × alpha × fill composites accordingly.
        //
        // 215/255 ≈ 0.8431 → blendPixel writes R = 255 × (1 − 0.8431) ≈ 40, B = 255 × 0.8431 ≈ 215.
        // 40/255 ≈ 0.1569 → R = 255 × (1 − 0.1569) ≈ 215, B = 255 × 0.1569 ≈ 40.
        expect(rgbAt(0, 0, 2)).toBeCloseTo(215, 0);
        expect(rgbAt(0, 0, 0)).toBeCloseTo(40, 0);
        expect(rgbAt(0, 1, 2)).toBeCloseTo(40, 0);
        expect(rgbAt(0, 1, 0)).toBeCloseTo(215, 0);
      } finally {
        restore();
      }
    });
  });

  describe('magic eraser', () => {
    it('clips pixels outside the selection snapshot to the untouched source', () => {
      const restore = withCpuSelectionMask();
      try {
        run('magic-eraser', {
          tolerance: 0,
          alpha: 1,
          selection: topRowSelection(),
        });

        // (0,0) and (1,0) are inside → fully erased. (0,1) is clipped → stays opaque.
        expect(alphaAt(0, 0)).toBe(0);
        expect(alphaAt(1, 0)).toBe(0);
        expect(alphaAt(0, 1)).toBe(255);
      } finally {
        restore();
      }
    });

    it('preserves fractional selection edge alpha so opacity composes with coverage', () => {
      const restore = withCpuSelectionMask();
      try {
        run('magic-eraser', {
          tolerance: 0,
          alpha: 1,
          selection: topRowSelection({ featherRadius: 2, antiAlias: true }),
        });

        // ~84% erased → alpha ≈ 255 × (1 − 0.8431) ≈ 40.
        // ~16% erased → alpha ≈ 255 × (1 − 0.1569) ≈ 215.
        expect(alphaAt(0, 0)).toBeCloseTo(40, 0);
        expect(alphaAt(0, 1)).toBeCloseTo(215, 0);
      } finally {
        restore();
      }
    });
  });

  describe('no-selection compatibility', () => {
    it('is byte-for-byte identical whether the selection field is absent or undefined', () => {
      // The `coverage = 1` fast path must produce the exact same bytes as the pre-selection code.
      run('paint-bucket', { color: '#0000FF', tolerance: 0, alpha: 1 });
      const withoutSelection = writtenPixels().slice();

      RecordingOffscreenCanvas.written = [];
      run('paint-bucket', { color: '#0000FF', tolerance: 0, alpha: 1, selection: undefined });
      const withUndefinedSelection = writtenPixels().slice();

      expect(withUndefinedSelection).toEqual(withoutSelection);
    });

    it('leaves the magic eraser unchanged when no selection snapshot is present', () => {
      run('magic-eraser', { tolerance: 0, alpha: 1 });
      const withoutSelection = writtenPixels().slice();

      RecordingOffscreenCanvas.written = [];
      run('magic-eraser', { tolerance: 0, alpha: 1, selection: undefined });
      const withUndefinedSelection = writtenPixels().slice();

      expect(withUndefinedSelection).toEqual(withoutSelection);
    });
  });

  describe('replay args', () => {
    it('survives a JSON round-trip and clips identically on replay', () => {
      const restore = withCpuSelectionMask();
      try {
        const args = fillArgs('paint-bucket', {
          color: '#0000FF',
          tolerance: 0,
          alpha: 1,
          selection: topRowSelection(),
        }) as unknown as FillToolArgs;

        // Simulate the durable history path: args are frozen and JSON-serialised.
        const replayed = JSON.parse(JSON.stringify(args)) as unknown as FillToolArgs;
        expect(replayed.selection).toBeDefined();
        expect(replayed.selection!.points).toEqual(args.selection!.points);
        expect(replayed.selection!.featherRadius).toBe(args.selection!.featherRadius);
        expect(replayed.selection!.antiAlias).toBe(args.selection!.antiAlias);

        const params = { size: SIZE, bitmap: createMockImageBitmap(SIZE.width, SIZE.height) };
        RecordingOffscreenCanvas.instances = [];
        RecordingOffscreenCanvas.written = [];
        paintBucket(params as never)(replayed as unknown as ToolArgs);

        // The replayed selection clips (0,1) the same way the live commit did.
        expect(rgbAt(0, 0, 2)).toBe(255); // inside → blue
        expect(rgbAt(0, 1, 2)).toBe(0); // clipped → stays red
        expect(rgbAt(0, 1, 0)).toBe(255);
      } finally {
        restore();
      }
    });
  });
});
