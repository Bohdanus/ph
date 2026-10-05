import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { sharpen, SHARPEN_AMOUNT_MAX, SHARPEN_RADIUS_MAX, type SharpenToolArgs } from '../sharpen.ts';
import { smudge } from '../smudge.ts';
import { createPixelCanvasContext } from '../../test/setup.ts';
import type { Size } from '../../contexts/general-types.ts';
import type { Rgba } from '../../util/pixels.ts';

const documentSize: Size = { width: 9, height: 9 };

/**
 * The global `OffscreenCanvas` stub in `src/test/setup.ts` exposes no handle on the
 * instances it makes and its `getImageData` always answers with a ZERO buffer, so
 * `expect(canvas).toBeTruthy()` is the only assertion available against a real filter and
 * every assertion about WHERE the filter put its result would be asserting nothing.
 *
 * This recorder is the pixel-capable replacement: it is still constructed with `new`, so
 * `vi.stubGlobal` can install it, but it keeps the instance list (so a test can prove which
 * canvas the processor returned) and the canvas's OWN pixels (so a test can read the result
 * the way a browser would, including "the source draw is still there" for the no-op paths).
 *
 * `createPixelCanvasContext` is the documented opt-in from `src/test/setup.ts:182-209`; the
 * two read-back methods are then replaced because the stock ones always answer with a zeroed
 * buffer, which is right for a test that needs *some* pixels and wrong for one that needs
 * the fixture. Everything else about the context is the stock mock.
 */
type MockCtx = CanvasRenderingContext2D;

class RecordingOffscreenCanvas {
  static instances: RecordingOffscreenCanvas[] = [];

  width: number;
  height: number;
  /** The canvas's own pixels, so a test can read back what a browser would display. */
  readonly pixels: Uint8ClampedArray;
  readonly ctx: MockCtx;

  constructor(width: number, height: number) {
    this.width = Math.max(1, Math.ceil(width));
    this.height = Math.max(1, Math.ceil(height));
    this.pixels = new Uint8ClampedArray(this.width * this.height * 4);

    const ctx = createPixelCanvasContext(this);
    // `drawImage` is the only entry point a raster processor has into its output canvas, so
    // the source reaches the pixels here exactly the way it reaches them in a browser.
    vi.mocked(ctx.drawImage).mockImplementation(((source: unknown) => {
      const drawn = source as { pixels: Uint8ClampedArray };
      this.pixels.set(drawn.pixels.subarray(0, this.pixels.length));
    }) as unknown as MockCtx['drawImage']);
    // A COPY, because a real `getImageData` copies: the filter reads this buffer while it
    // writes its own, and an aliasing stub would have the two fight over the same bytes.
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

const OPAQUE: Rgba = { r: 40, g: 40, b: 40, a: 255 };
const BRIGHT: Rgba = { r: 240, g: 240, b: 240, a: 255 };
const TRANSPARENT: Rgba = { r: 0, g: 0, b: 0, a: 0 };
const OPAQUE_RED: Rgba = { r: 255, g: 0, b: 0, a: 255 };
/** Opaque mid grey, the field the premultiply proof is derived against. */
const GREY: Rgba = { r: 100, g: 100, b: 100, a: 255 };

/** A `Size`-sized `Uint8ClampedArray` in the row-major RGBA order `getImageData` uses. */
const fixture = (size: Size, fill: (x: number, y: number) => Rgba): Uint8ClampedArray => {
  const data = new Uint8ClampedArray(size.width * size.height * 4);
  for (let y = 0; y < size.height; y++) {
    for (let x = 0; x < size.width; x++) {
      const rgba = fill(x, y);
      const offset = (y * size.width + x) * 4;
      data[offset] = rgba.r;
      data[offset + 1] = rgba.g;
      data[offset + 2] = rgba.b;
      data[offset + 3] = rgba.a;
    }
  }
  return data;
};

/** The flat `documentSize` field, and the field with a single bright dot at the centre. */
const flatField = fixture(documentSize, () => OPAQUE);
const dottedField = fixture(documentSize, (x, y) => (x === 4 && y === 4 ? BRIGHT : OPAQUE));

/** The source `ImageBitmap`, carrying the pixels this recorder's `drawImage` copies in. */
const sourceBitmap = (pixels: Uint8ClampedArray, size: Size) =>
  ({ width: size.width, height: size.height, pixels, close: vi.fn() }) as unknown as ImageBitmap;

const sharpenWith = (pixels: Uint8ClampedArray, args: Partial<SharpenToolArgs>, size = documentSize) => {
  const bitmap = sourceBitmap(pixels, size);
  const [canvas] = sharpen({ size, bitmap })({ amount: 50, radius: 2, toolName: 'sharpen', ...args });

  // Structural, not truthy: the processor must return the document-sized canvas it just
  // allocated, not the source bitmap and not some other truthy value.
  expect(canvas).toBe(RecordingOffscreenCanvas.instances.at(-1));
  expect((canvas as unknown as RecordingOffscreenCanvas).width).toBe(size.width);
  expect((canvas as unknown as RecordingOffscreenCanvas).height).toBe(size.height);

  return canvas as unknown as RecordingOffscreenCanvas;
};

const at = (data: Uint8ClampedArray, size: Size, x: number, y: number): Rgba => {
  const offset = (y * size.width + x) * 4;
  return { r: data[offset], g: data[offset + 1], b: data[offset + 2], a: data[offset + 3] };
};

beforeEach(() => {
  RecordingOffscreenCanvas.instances = [];
  vi.stubGlobal('OffscreenCanvas', RecordingOffscreenCanvas as unknown as typeof OffscreenCanvas);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('sharpen structure', () => {
  it('is a distinct export from smudge, because two tool names sharing a processor is only legitimate for the lasso pair and the shape family', () => {
    expect(sharpen).not.toBe(smudge);
    expect(typeof sharpen).toBe('function');
  });

  it('is a two-stage curried processor that reads its params and its args', () => {
    const bitmap = sourceBitmap(flatField, documentSize);
    const inner = sharpen({ size: documentSize, bitmap });

    expect(sharpen.length).toBe(1);
    expect(inner.length).toBe(1);
  });

  it('allocates exactly one full-document canvas and draws the source bitmap into it', () => {
    const bitmap = sourceBitmap(flatField, documentSize);
    const [canvas] = sharpen({ size: documentSize, bitmap })({ amount: 50, radius: 2, toolName: 'sharpen' });

    expect(RecordingOffscreenCanvas.instances).toHaveLength(1);
    expect(canvas).toBe(RecordingOffscreenCanvas.instances[0]);
    expect(canvas).not.toBe(bitmap);
    expect(vi.mocked(RecordingOffscreenCanvas.instances[0].ctx.drawImage).mock.calls[0][0]).toBe(bitmap);
  });
});

describe('sharpen unsharp mask', () => {
  it('leaves a perfectly flat field bit-identical, so the filter cannot ring or drift on a constant', () => {
    // The invariant the unsharp mask is built around: `source - blurred` is exactly zero on
    // a constant, so `source + amount * 0` is the source. Any nonzero amount and radius
    // satisfy it, which is why this asserts the arithmetic rather than one slider setting.
    for (const amount of [10, 50, 100, 500]) {
      for (const radius of [1, 2, 7]) {
        const canvas = sharpenWith(flatField, { amount, radius });

        expect(Array.from(canvas.pixels), `amount ${amount} radius ${radius}`).toEqual(Array.from(flatField));
      }
    }
  });

  it('does not read the source buffer it convolves, so a flat field is a real fixed point rather than a copy', () => {
    const before = new Uint8ClampedArray(flatField);
    sharpenWith(flatField, { amount: 100, radius: 3 });

    expect(Array.from(flatField)).toEqual(Array.from(before));
  });

  /**
   * THE HALO IS THE DEFECT THIS TOOL EXISTS TO AVOID, so both halves of the unsharp
   * overshoot are pinned here with hand-derived numbers.
   *
   * Fixture: 40 everywhere, 240 at the centre of a 9x9 field. `radius: 2` is a 5x5 kernel,
   * 25 taps. Any pixel whose 5x5 window contains the dot — that is, every pixel within
   * Chebyshev distance 2 of it — has a blurred value of `(24 * 40 + 240) / 25 = 48`. Any
   * pixel further away has a window of 25 field pixels, so its blurred value is 40 and it
   * does not move at all. `amount: 50` is a multiplier of 0.5, and the difference term at the
   * dot is `0.5 * (240 - 48) = 96`, at a ring pixel `0.5 * (40 - 48) = -4`.
   */
  it('darkens the field around a bright dot and brightens the dot itself, which is the overshoot signature', () => {
    const canvas = sharpenWith(dottedField, { amount: 50, radius: 2 });

    // The dot: 240 + 96 = 336, clipped to the top of the range. Clipping HERE rather than
    // letting a negative overshoot through is the same clamp the ring's numbers come from.
    expect(at(canvas.pixels, documentSize, 4, 4)).toEqual({ r: 255, g: 255, b: 255, a: 255 });

    // The ring: every pixel the dot's 5x5 window reaches lands on 36, darker than the 40 it
    // started at. A blit-like filter that added a blurred copy instead of subtracting one
    // would leave these at 40, and a filter that did not clamp would push them below 0 and
    // show as a black band.
    let darkened = 0;
    for (let y = 0; y < documentSize.height; y++) {
      for (let x = 0; x < documentSize.width; x++) {
        if (x === 4 && y === 4) continue;
        const withinWindow = Math.abs(x - 4) <= 2 && Math.abs(y - 4) <= 2;
        expect(at(canvas.pixels, documentSize, x, y), `(${x}, ${y})`).toEqual(
          withinWindow ? { r: 36, g: 36, b: 36, a: 255 } : OPAQUE
        );
        if (withinWindow) darkened++;
      }
    }

    // 5x5 window minus the dot itself. Counting it keeps the assertion above from passing
    // because the window covered nothing.
    expect(darkened).toBe(24);
  });

  it('is an exact no-op at amount 0, leaving the drawn source untouched', () => {
    const canvas = sharpenWith(dottedField, { amount: 0, radius: 2 });

    expect(Array.from(canvas.pixels)).toEqual(Array.from(dottedField));
    // The whole convolution is skipped rather than computed to a fixed point, so there is
    // no read-back and no write-back at all.
    expect(vi.mocked(canvas.ctx.getImageData)).not.toHaveBeenCalled();
    expect(vi.mocked(canvas.ctx.putImageData)).not.toHaveBeenCalled();
  });

  it('is an exact no-op at radius 0, leaving the drawn source untouched', () => {
    const canvas = sharpenWith(dottedField, { amount: 100, radius: 0 });

    expect(Array.from(canvas.pixels)).toEqual(Array.from(dottedField));
    expect(vi.mocked(canvas.ctx.getImageData)).not.toHaveBeenCalled();
    expect(vi.mocked(canvas.ctx.putImageData)).not.toHaveBeenCalled();
  });

  it('rounds a fractional radius into a whole-texel kernel, and a radius below half a texel to the identity', () => {
    // `radius: 0.4` is the same kernel as `radius: 0`: a box is `2 * radius + 1` WHOLE
    // texels wide, and rounding is what stops Photoshop's fractional steps from silently
    // becoming a box narrower than the slider reads.
    expect(Array.from(sharpenWith(dottedField, { radius: 0.4 }).pixels)).toEqual(Array.from(dottedField));
    // `radius: 1.4` rounds to the same 3-tap kernel as `radius: 1`, so the two must agree.
    expect(Array.from(sharpenWith(dottedField, { amount: 100, radius: 1.4 }).pixels)).toEqual(
      Array.from(sharpenWith(dottedField, { amount: 100, radius: 1 }).pixels)
    );
  });
});

describe('sharpen alpha handling', () => {
  it('keeps a hard alpha edge sharp instead of ringing it into a band', () => {
    // Left of `x = 3` is transparent black, right of it is opaque red, with a 5x5 kernel
    // so the boundary pixels really do straddle the edge.
    //
    // At `x = 3` the window is 15 opaque and 10 transparent texels, so the blurred alpha and
    // the blurred premultiplied red are both `15 * 255 / 25 = 153`. The unsharp adds
    // `0.5 * (255 - 153) = 51` to each, both clip at their ceiling, and dividing the clipped
    // 255 back out by the clipped 255 returns the original pure red.
    //
    // At `x = 2` the window is 10 opaque and 15 transparent, so the blurred alpha and red are
    // both 102, and the unsharp produces `0.5 * (0 - 102) = -51` for each. Alpha clamps to 0
    // and the PREMULTIPLIED red clamps to 0 with it — a premultiplied channel below zero has
    // no colour to describe, so a negative one is not a dark pixel but a broken one. There is
    // no bright band on the transparent side and no dark band on the opaque side, which is
    // the whole point of doing the blur in premultiplied space.
    const size: Size = { width: 7, height: 7 };
    const stepEdge = fixture(size, (x) => (x < 3 ? TRANSPARENT : OPAQUE_RED));

    const canvas = sharpenWith(stepEdge, { amount: 50, radius: 2 }, size);

    for (let y = 0; y < size.height; y++) {
      for (let x = 0; x < size.width; x++) {
        const pixel = at(canvas.pixels, size, x, y);
        const label = `(${x}, ${y})`;
        if (x < 3) {
          expect(pixel, label).toEqual(TRANSPARENT);
        } else {
          expect(pixel, label).toEqual(OPAQUE_RED);
        }
      }
    }
  });

  /**
   * THE PREMULTIPLY, PROVEN RATHER THAN ASSERTED.
   *
   * Three pixels in a row with a one-texel kernel, so the centre's window is all three:
   * opaque grey 100, a FULLY TRANSPARENT pixel that still carries 200 of stored colour, and
   * opaque grey 100 again.
   *
   * Premultiplied, the middle texel contributes `200 * 0 / 255 = 0` to the blur, so the mean
   * is `(100 + 0 + 100) / 3 = 66.67`; the unsharp at 100% adds `(100 - 66.67)` to 100 and
   * lands on 133.33, which quantises to 133. Blending the STRAIGHT channels instead would
   * pull the hidden 200 into the mean, giving `(100 + 200 + 100) / 3 = 133.33` and an output
   * of 67 — the transparent texel's colour would have leaked a visible ring into opaque
   * pixels on both sides of a hole, which is a halo in every sense the word covers.
   */
  it("keeps a transparent texel's hidden colour out of the blur, which is what premultiplying buys", () => {
    const size: Size = { width: 3, height: 1 };
    const hidden = fixture(size, (x) => (x === 1 ? { r: 200, g: 200, b: 200, a: 0 } : GREY));

    const canvas = sharpenWith(hidden, { amount: 100, radius: 1 }, size);

    expect(at(canvas.pixels, size, 0, 0)).toEqual({ r: 133, g: 133, b: 133, a: 255 });
    expect(at(canvas.pixels, size, 2, 0)).toEqual({ r: 133, g: 133, b: 133, a: 255 });
    // The hole itself: both its alpha and its premultiplied colour overshoot negative and
    // clamp to 0, so it is still a hole rather than a 255-alpha pixel.
    expect(at(canvas.pixels, size, 1, 0)).toEqual(TRANSPARENT);
  });
});

describe('sharpen argument clamping', () => {
  const clampedRuns: readonly [string, number, number][] = [
    ['NaN amount', Number.NaN, 2],
    ['infinite amount', Number.POSITIVE_INFINITY, 2],
    ['negative amount', -40, 2],
    ['NaN radius', 50, Number.NaN],
    ['infinite radius', 50, Number.POSITIVE_INFINITY],
    ['negative radius', 50, -12],
    ['an over-range radius', 50, 5000],
  ];

  it.each(clampedRuns)('clamps %s instead of throwing', (_label, amount, radius) => {
    // `Math.max` propagates `NaN`, and a `NaN` here would make the tap count `NaN` and every
    // divisor with it: a loop that silently emits transparent black rather than an error. The
    // near end is 0 for both sliders and 0 is the identity filter, so the safe failure is a
    // layer nobody touched.
    expect(() => sharpenWith(dottedField, { amount, radius })).not.toThrow();
  });

  it('settles a non-finite slider on the identity rather than on a hang', () => {
    for (const [label, amount, radius] of clampedRuns) {
      if (label.includes('over-range') || label.includes('negative amount') || label.includes('negative radius')) {
        continue;
      }
      const canvas = sharpenWith(dottedField, { amount, radius });
      expect(Array.from(canvas.pixels), label).toEqual(Array.from(dottedField));
    }
  });

  it('clamps an over-range radius to the same kernel the ceiling produces', () => {
    expect(Array.from(sharpenWith(dottedField, { amount: 100, radius: 5000 }).pixels)).toEqual(
      Array.from(sharpenWith(dottedField, { amount: 100, radius: SHARPEN_RADIUS_MAX }).pixels)
    );
  });

  it('clamps an over-range amount to the same kernel the ceiling produces', () => {
    expect(Array.from(sharpenWith(dottedField, { amount: 1e9, radius: 2 }).pixels)).toEqual(
      Array.from(sharpenWith(dottedField, { amount: SHARPEN_AMOUNT_MAX, radius: 2 }).pixels)
    );
  });
  describe('the stroked form', () => {
    it('runs a one-texel kernel for a stroked radius of 0, where the whole-layer form is the identity', () => {
      // The two forms deliberately disagree at radius 0, and the disagreement is a documented
      // decision rather than an accident: the whole-layer form treats 0 as the identity because
      // that is what the slider's left end means, while a stroke has a live brush under the
      // pointer and a zero-span box would make the tool look broken. Asserted differentially
      // because `Math.max(1, 0)` and `radius: 1` are literally the same kernel — no invented
      // pixel numbers.
      const strokedZero = sharpenWith(dottedField, { amount: 100, radius: 0, points: [{ x: 4, y: 4 }] });
      const strokedOne = sharpenWith(dottedField, { amount: 100, radius: 1, points: [{ x: 4, y: 4 }] });

      expect(Array.from(strokedZero.pixels)).toEqual(Array.from(strokedOne.pixels));
      // And it is not a no-op, which is the whole point of the floor.
      expect(Array.from(strokedZero.pixels)).not.toEqual(Array.from(dottedField));
    });

    it('leaves the whole-layer radius of 0 an exact identity', () => {
      // The contrast row for the case above, from the file's existing seed: no `points`, so the
      // stroke floor never applies.
      expect(Array.from(sharpenWith(dottedField, { amount: 100, radius: 0 }).pixels)).toEqual(Array.from(dottedField));
    });

    it('composites the result through a brush mask rather than returning the sharpened canvas', () => {
      // Two surfaces: the sharpened frame, then the masked composite. `clip()` is a plain spy in
      // this repository's canvas double, so the strongest available unit claim is that a clip
      // region was established and the filtered surface drawn through it. That the clip ACTUALLY
      // confines the effect is not observable here at all, and is asserted in e2e instead — which
      // is why this assertion is about structure and the e2e one is about pixels.
      const stroked = sharpenWith(dottedField, { amount: 100, radius: 2, points: [{ x: 4, y: 4 }] });
      const maskCanvas = RecordingOffscreenCanvas.instances.at(-1)!;

      expect(RecordingOffscreenCanvas.instances).toHaveLength(2);
      expect(maskCanvas.ctx.clip).toHaveBeenCalledTimes(1);
      // The source is drawn first, then the filtered surface THROUGH the clip. A `drawImage`
      // before `clip()` would render an unmasked sharpen that still satisfies every count here.
      expect(maskCanvas.ctx.drawImage).toHaveBeenCalledTimes(2);

      expect(stroked).toBe(maskCanvas);
    });

    it('allocates one surface and clips nothing for the whole-layer form', () => {
      sharpenWith(dottedField, { amount: 100, radius: 2 });

      expect(RecordingOffscreenCanvas.instances).toHaveLength(1);
      expect(RecordingOffscreenCanvas.instances[0]!.ctx.clip).not.toHaveBeenCalled();
    });
  });
});
