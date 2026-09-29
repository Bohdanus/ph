import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { eraser, ERASER_HARDNESS_DEFAULT, type EraserToolArgs } from '../eraser.ts';
import { createPixelCanvasContext } from '../../test/setup.ts';
import { BRUSH_HARDNESS_MAX, tipAlphaAt } from '../../util/brush-engine.ts';
import { defaultSettings } from '../settings.ts';
import type { ToolArgs } from '../../contexts/tool-types.ts';
import type { Point } from '../../contexts/general-types.ts';

/**
 * The Brush eraser is a question about PIXELS, not about state.
 *
 * Every assertion in this file reads the committed raster's alpha channel and asks what the
 * boundary between erased and untouched looks like. A mode flag, a `disabled` attribute or a
 * `hardness` field in the args all pass while the stroke comes out a one-pixel stair-step, which
 * is the defect: Photoshop's Brush eraser "erases pixels with adjustable softness and opacity
 * settings", so the softness has to be in the buffer the processor returns.
 *
 * The recorder is the pixel-capable `OffscreenCanvas` from `smudge.test.ts`. The global stub in
 * `src/test/setup.ts` has no handle on its instances and a `getImageData` that always answers
 * with a zeroed buffer, so against it every assertion here would be asserting nothing.
 */
class RecordingOffscreenCanvas {
  static instances: RecordingOffscreenCanvas[] = [];

  width: number;
  height: number;
  readonly pixels: Uint8ClampedArray;
  readonly ctx: CanvasRenderingContext2D;

  constructor(width: number, height: number) {
    this.width = Math.max(1, Math.ceil(width));
    this.height = Math.max(1, Math.ceil(height));
    this.pixels = new Uint8ClampedArray(this.width * this.height * 4);

    const ctx = createPixelCanvasContext(this);
    vi.mocked(ctx.drawImage).mockImplementation(((source: unknown) => {
      const drawn = source as { pixels: Uint8ClampedArray };
      this.pixels.set(drawn.pixels.subarray(0, this.pixels.length));
    }) as unknown as CanvasRenderingContext2D['drawImage']);
    // A COPY, because a real `getImageData` copies.
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
    }) as unknown as CanvasRenderingContext2D['putImageData']);

    this.ctx = ctx;
    RecordingOffscreenCanvas.instances.push(this);
  }

  getContext(): CanvasRenderingContext2D {
    return this.ctx;
  }
}

/** An opaque red source raster, the way a raster commit hands the processor the layer. */
const opaqueSource = (width: number, height: number): OffscreenCanvas => {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = 255;
    pixels[i + 1] = 0;
    pixels[i + 2] = 0;
    pixels[i + 3] = 255;
  }
  // Typed as an `OffscreenCanvas` because that is the union arm the recorder's `drawImage`
  // implementation reads its `pixels` from; the object carries exactly the one field it uses.
  return { pixels } as unknown as OffscreenCanvas;
};

const SIZE = { width: 41, height: 41 };
const CENTRE = 20;

const eraserArgs = (overrides: Partial<EraserToolArgs> = {}): ToolArgs =>
  ({
    ...defaultSettings.eraser,
    toolName: 'eraser',
    points: [{ x: CENTRE, y: CENTRE }],
    ...overrides,
  }) as unknown as ToolArgs;

/** Run one stroke and return the ALPHA channel of the committed raster. */
const erasedAlpha = (args: ToolArgs): Uint8ClampedArray => {
  RecordingOffscreenCanvas.instances = [];
  eraser({ size: SIZE, bitmap: opaqueSource(SIZE.width, SIZE.height) })(args);
  const pixels = RecordingOffscreenCanvas.instances.at(-1)!.pixels;
  const alpha = new Uint8ClampedArray(SIZE.width * SIZE.height);
  for (let i = 0, a = 3; a < pixels.length; i++, a += 4) alpha[i] = pixels[a];
  return alpha;
};

const alphaAt = (alpha: Uint8ClampedArray, x: number, y: number) => alpha[y * SIZE.width + x];

/** The alpha across the horizontal diameter of the stroke, centre outwards. */
const diameter = (alpha: Uint8ClampedArray) =>
  Array.from({ length: SIZE.width - CENTRE }, (_, i) => alphaAt(alpha, CENTRE + i, CENTRE));

/** Strictly between fully erased and fully untouched — the soft edge, by definition. */
const partial = (values: number[]) => values.filter((value) => value > 0 && value < 255);

beforeEach(() => {
  RecordingOffscreenCanvas.instances = [];
  vi.stubGlobal('OffscreenCanvas', RecordingOffscreenCanvas as unknown as typeof OffscreenCanvas);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the Brush eraser tip', () => {
  it('leaves a soft edge, with intermediate alpha between the erased core and the untouched rim', () => {
    const alpha = erasedAlpha(eraserArgs({ mode: 'brush', lineWidth: 21, hardness: 50, alpha: 1 }));
    const ramp = diameter(alpha);

    // The core is erased and the far rim is untouched...
    expect(alphaAt(alpha, CENTRE, CENTRE)).toBe(0);
    expect(alphaAt(alpha, SIZE.width - 1, CENTRE)).toBe(255);

    // ...and something between them is neither, which is the whole claim. A hard edge has no
    // such pixel: `ctx.stroke()` writes 0 and 255 and nothing in between, at any opacity.
    expect(partial(ramp).length).toBeGreaterThan(2);
  });

  it('ramps monotonically outward, so the softness is falloff and not noise', () => {
    const ramp = diameter(erasedAlpha(eraserArgs({ mode: 'brush', lineWidth: 21, hardness: 50, alpha: 1 })));

    // The endpoints first: without them a stroke that erased nothing at all is "monotone", which
    // is the failure this whole file exists to catch rather than a pass.
    expect(ramp[0]).toBe(0);
    expect(ramp[ramp.length - 1]).toBe(255);
    for (let i = 1; i < ramp.length; i++) {
      expect(ramp[i]).toBeGreaterThanOrEqual(ramp[i - 1]);
    }
  });

  it('reads as hard at Hardness 100, which is what makes the control a control', () => {
    const ramp = diameter(
      erasedAlpha(eraserArgs({ mode: 'brush', lineWidth: 21, hardness: BRUSH_HARDNESS_MAX, alpha: 1 }))
    );

    // Still not a `ctx.stroke()`: a stamped disc is a disc, so the row through its centre is
    // erased out to the tip radius either way. What Hardness 100 removes is the ramp.
    expect(partial(ramp).length).toBeLessThanOrEqual(1);
    expect(alphaAt(erasedAlpha(eraserArgs({ mode: 'brush', lineWidth: 21, hardness: 100 })), CENTRE + 4, CENTRE)).toBe(
      0
    );
  });

  it('agrees with the shared falloff, so the tip is the engine tip and not a second curve', () => {
    const tip = 21;
    const alpha = erasedAlpha(eraserArgs({ mode: 'brush', lineWidth: tip, hardness: 50, alpha: 1 }));

    for (let offset = 0; offset <= Math.floor(tip / 2); offset++) {
      const expected = 255 * (1 - tipAlphaAt(offset, tip / 2, 50));
      expect(alphaAt(alpha, CENTRE + offset, CENTRE)).toBeCloseTo(expected, 0);
    }
  });

  it('erases a click, which a zero-length `ctx.stroke()` cannot do', () => {
    // One point, no travel. The tip engine emits a dab for it; the legacy path draws nothing.
    const alpha = erasedAlpha(eraserArgs({ mode: 'brush', lineWidth: 21, points: [{ x: CENTRE, y: CENTRE }] }));

    expect(alphaAt(alpha, CENTRE, CENTRE)).toBe(0);
  });

  it('softens a whole stroke, not just its first dab', () => {
    const points: Point[] = [
      { x: 4, y: CENTRE },
      { x: 20, y: CENTRE },
      { x: 36, y: CENTRE },
    ];
    const alpha = erasedAlpha(eraserArgs({ mode: 'brush', lineWidth: 21, hardness: 50, points }));

    // Across the path the dabs overlap until the core saturates, which is what a stroke is. The
    // edge has to be soft on the OTHER axis, and it has to be soft at the midpoint — a position
    // `brushDabCenters` never emitted, since spacing 25% of a 21px tip is 5.25px and 20 is not a
    // multiple of it away from either end. Sampled across the falloff band, not the core: a hard
    // core is what both modes have, and reading it would prove nothing.
    const acrossMidStroke = Array.from({ length: 6 }, (_, i) => alphaAt(alpha, 20, 9 + i));
    expect(partial(acrossMidStroke).length).toBeGreaterThan(1);
    expect(alphaAt(alpha, 20, CENTRE)).toBe(0);
    expect(alphaAt(alpha, 20, 0)).toBe(255);
  });

  it('scales the erase with Opacity, and leaves the layer alone at 0', () => {
    const full = erasedAlpha(eraserArgs({ mode: 'brush', lineWidth: 21, hardness: 50, alpha: 1 }));
    const half = erasedAlpha(eraserArgs({ mode: 'brush', lineWidth: 21, hardness: 50, alpha: 0.5 }));
    const none = erasedAlpha(eraserArgs({ mode: 'brush', lineWidth: 21, hardness: 50, alpha: 0 }));

    expect(alphaAt(half, CENTRE + 8, CENTRE)).toBeGreaterThan(alphaAt(full, CENTRE + 8, CENTRE));
    expect(alphaAt(none, CENTRE, CENTRE)).toBe(255);
  });
});

describe('the modes the eraser already had', () => {
  /**
   * The contrast with Pencil cannot be a PIXEL assertion here, and the reason is worth writing
   * down: the harness's `stroke()` is a `vi.fn()` that paints nothing, so a legacy stroke leaves
   * the source raster untouched and a "no partial alpha" assertion passes for the wrong reason.
   * What IS observable is the route — the legacy path issues one `ctx.stroke()` and never reads
   * or writes a pixel buffer, and the Brush tip does the exact opposite. The soft edge itself is
   * pinned on pixels above, against the engine's own falloff.
   */
  it('leaves Pencil on the single-path stroke, which cannot carry a falloff', () => {
    const alpha = erasedAlpha(eraserArgs({ mode: 'pencil', lineWidth: 21, alpha: 1 }));
    const ctx = RecordingOffscreenCanvas.instances.at(-1)!.ctx;

    expect(ctx.stroke).toHaveBeenCalledTimes(1);
    expect(ctx.getImageData).not.toHaveBeenCalled();
    expect(partial(diameter(alpha))).toEqual([]);
  });

  it('leaves Block on its hard square stamps, unaffected by the soft tip', () => {
    const alpha = erasedAlpha(eraserArgs({ mode: 'block', lineWidth: 21, alpha: 1 }));
    const ctx = RecordingOffscreenCanvas.instances.at(-1)!.ctx;

    expect(ctx.fillRect).toHaveBeenCalled();
    expect(ctx.stroke).not.toHaveBeenCalled();
    expect(ctx.getImageData).not.toHaveBeenCalled();
    expect(alphaAt(alpha, 0, 0)).toBe(255);
  });

  it('routes only Brush mode through the tip, so the legacy modes are untouched', () => {
    erasedAlpha(eraserArgs({ mode: 'brush', lineWidth: 21, hardness: 50 }));
    expect(RecordingOffscreenCanvas.instances.at(-1)!.ctx.getImageData).toHaveBeenCalled();
  });
});

describe('the seeded eraser defaults', () => {
  it('open in Brush mode, because a hard first stroke is the defect this closes', () => {
    expect(defaultSettings.eraser.mode).toBe('brush');
  });

  it('seed a soft tip, so the very first stroke already has an adjustable edge', () => {
    const seeded = defaultSettings.eraser;
    const alpha = erasedAlpha({ ...seeded, toolName: 'eraser', points: [{ x: CENTRE, y: CENTRE }] } as ToolArgs);

    expect(seeded.hardness).toBe(ERASER_HARDNESS_DEFAULT);
    expect(ERASER_HARDNESS_DEFAULT).toBeLessThan(100);
    expect(partial(diameter(alpha)).length).toBeGreaterThan(2);
  });
});
