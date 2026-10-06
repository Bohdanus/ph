import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  smudge,
  SMUDGE_SPACING_PERCENT,
  SMUDGE_STRENGTH_MAX,
  SMUDGE_STRENGTH_MIN,
  type SmudgeToolArgs,
} from '../smudge.ts';
import { sharpen } from '../sharpen.ts';
import { createPixelCanvasContext } from '../../test/setup.ts';
import {
  BRUSH_HARDNESS_DEFAULT,
  BRUSH_HARDNESS_MAX,
  BRUSH_HARDNESS_MIN,
  BRUSH_SIZE_DEFAULT,
  BRUSH_SIZE_MAX,
  BRUSH_SIZE_MIN,
} from '../../util/brush-engine.ts';
import type { Point, Size } from '../../contexts/general-types.ts';
import type { Rgba } from '../../util/pixels.ts';

const documentSize: Size = { width: 8, height: 8 };

/**
 * The global `OffscreenCanvas` stub in `src/test/setup.ts` exposes no handle on the
 * instances it makes and its `getImageData` always answers with a ZERO buffer, so
 * `expect(canvas).toBeTruthy()` is the only assertion available against a real drag and
 * every assertion about WHERE the smudge put its pixels would be asserting nothing.
 *
 * This recorder is the pixel-capable replacement: still constructed with `new`, so
 * `vi.stubGlobal` can install it, but it keeps the instance list (so a test can prove which
 * canvas the processor returned) and the canvas's OWN pixels (so a test can read the result
 * the way a browser would, including "the source draw is still there" for the no-op paths).
 *
 * `createPixelCanvasContext` is the documented opt-in from `src/test/setup.ts:182-209`; its
 * two read-back methods are then replaced because the stock ones always answer with a zeroed
 * buffer, which is right for a test that needs *some* pixels and wrong for one that needs the
 * fixture. Everything else about the context is the stock mock.
 */
class RecordingOffscreenCanvas {
  static instances: RecordingOffscreenCanvas[] = [];

  width: number;
  height: number;
  /** The canvas's own pixels, so a test can read back what a browser would display. */
  readonly pixels: Uint8ClampedArray;
  readonly ctx: CanvasRenderingContext2D;

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
    }) as unknown as CanvasRenderingContext2D['drawImage']);
    // A COPY, because a real `getImageData` copies: the smudge reads the source while it
    // writes the output, and an aliasing stub would have the two fight over the same bytes —
    // which would also hide the exact bug this tool has to avoid.
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

const FLAT: Rgba = { r: 40, g: 40, b: 40, a: 255 };
const RED: Rgba = { r: 255, g: 0, b: 0, a: 255 };
const BLUE: Rgba = { r: 0, g: 0, b: 255, a: 255 };

/**
 * Red for `x < 6`, blue from `x = 6` on: a hard vertical boundary with three pixels of blue
 * to its right, so a drag can carry red into blue without falling off the canvas.
 */
const twoToneField = (() => {
  const data = new Uint8ClampedArray(documentSize.width * documentSize.height * 4);
  for (let y = 0; y < documentSize.height; y++) {
    for (let x = 0; x < documentSize.width; x++) {
      const rgba = x < 6 ? RED : BLUE;
      const offset = (y * documentSize.width + x) * 4;
      data[offset] = rgba.r;
      data[offset + 1] = rgba.g;
      data[offset + 2] = rgba.b;
      data[offset + 3] = rgba.a;
    }
  }
  return data;
})();

const flatField = (() => {
  const data = new Uint8ClampedArray(documentSize.width * documentSize.height * 4);
  for (let offset = 0; offset < data.length; offset += 4) {
    data[offset] = FLAT.r;
    data[offset + 1] = FLAT.g;
    data[offset + 2] = FLAT.b;
    data[offset + 3] = FLAT.a;
  }
  return data;
})();

/** The source `ImageBitmap`, carrying the pixels this recorder's `drawImage` copies in. */
const sourceBitmap = (pixels: Uint8ClampedArray, size: Size) =>
  ({ width: size.width, height: size.height, pixels, close: vi.fn() }) as unknown as ImageBitmap;

/** A 4px hard tip at 50% strength: radius 2, a full-weight core, and a 1px dab step. */
const rightward: Point[] = [
  { x: 2, y: 4 },
  { x: 5, y: 4 },
];
const leftward: Point[] = [...rightward].reverse().map((point) => ({ ...point }));

const smudgeWith = (pixels: Uint8ClampedArray, args: Partial<SmudgeToolArgs>, size = documentSize) => {
  const bitmap = sourceBitmap(pixels, size);
  const [canvas] = smudge({ size, bitmap })({
    size: 4,
    hardness: 100,
    strength: 50,
    points: rightward,
    toolName: 'smudge',
    ...args,
  });

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

/** Every pixel the stroke actually changed, as `x,y` sorted by row then column. */
const changedPixels = (canvas: RecordingOffscreenCanvas, source: Uint8ClampedArray): string[] => {
  const changed: string[] = [];
  for (let y = 0; y < documentSize.height; y++) {
    for (let x = 0; x < documentSize.width; x++) {
      const offset = (y * documentSize.width + x) * 4;
      for (let channel = 0; channel < 4; channel++) {
        if (canvas.pixels[offset + channel] !== source[offset + channel]) {
          changed.push(`${x},${y}`);
          break;
        }
      }
    }
  }
  return changed;
};

beforeEach(() => {
  RecordingOffscreenCanvas.instances = [];
  vi.stubGlobal('OffscreenCanvas', RecordingOffscreenCanvas as unknown as typeof OffscreenCanvas);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('smudge structure', () => {
  it('is a distinct export from sharpen, because two tool names sharing a processor is only legitimate for the lasso pair and the shape family', () => {
    expect(smudge).not.toBe(sharpen);
    expect(typeof smudge).toBe('function');
  });

  it('is a two-stage curried processor that reads its params and its args', () => {
    const inner = smudge({ size: documentSize, bitmap: sourceBitmap(flatField, documentSize) });

    expect(smudge.length).toBe(1);
    expect(inner.length).toBe(1);
  });

  it('allocates exactly one full-document canvas and draws the source bitmap into it', () => {
    const bitmap = sourceBitmap(flatField, documentSize);
    const [canvas] = smudge({ size: documentSize, bitmap })({
      size: 4,
      hardness: 100,
      strength: 50,
      points: [],
      toolName: 'smudge',
    });

    expect(RecordingOffscreenCanvas.instances).toHaveLength(1);
    expect(canvas).toBe(RecordingOffscreenCanvas.instances[0]);
    expect(canvas).not.toBe(bitmap);
    expect(vi.mocked(RecordingOffscreenCanvas.instances[0].ctx.drawImage).mock.calls[0][0]).toBe(bitmap);
  });
});

describe('smudge drag', () => {
  /**
   * The identity pin. A smudge of one colour by that colour changes nothing, so a flat
   * field is a fixed point at every setting. A wrong SIGN in the blend — `output - carried`
   * instead of `blendPixel(output, carried, strength)`, or a coverage past 1 applied to the
   * result rather than to the source's alpha — turns this into visible damage rather than
   * silence, which is what makes it the right first assertion about the arithmetic.
   */
  it('leaves a flat field bit-identical, at full strength and at every tip size', () => {
    for (const strength of [25, 50, 100]) {
      for (const size of [2, 4, 7]) {
        const canvas = smudgeWith(flatField, { size, strength, hardness: 100 });

        expect(Array.from(canvas.pixels), `size ${size} strength ${strength}`).toEqual(Array.from(flatField));
      }
    }
  });

  it('does not read the buffer it writes, so the source raster is never itself smudged', () => {
    const before = new Uint8ClampedArray(twoToneField);
    smudgeWith(twoToneField, {});

    expect(Array.from(twoToneField)).toEqual(Array.from(before));
  });

  /**
   * The directional pin, with every number derived from the tip rather than observed.
   *
   * `size: 4` is radius 2 and `hardness: 100` makes the whole radius the hard core, so
   * `tipAlphaAt` is 1 for every pixel closer than 2 to the centre and 0 at exactly 2 — the
   * engine's half-open rim. `spacing` is the tool's own 25% of the diameter, so a 4px tip
   * steps 1px and `[(2,4), (5,4)]` becomes dab centres 2, 3, 4 and 5 with each dab dragged
   * one texel right. `strength: 50` is the 0.5 coverage the tip engine calls `opacity`.
   *
   * Only the last dab, at `(5, 4)`, can reach the boundary. Its covered pixels inside the
   * blue are `(6, 3)`, `(6, 4)` and `(6, 5)` — the pixels at distance 2, `1`, and `1` — and
   * each of them reads the texel one step behind it, which is still red. `blendPixel` over
   * blue with `opacity: 0.5` and a source alpha of 255 gives
   * `Co = (255 * 0.5 + 0 * 0.5) / 1 = 127.5`, which the byte buffer rounds to 128, so the
   * result is a 50/50 magenta at full alpha.
   */
  it('drags the source colour into the blue in the direction of travel, on exactly the pixels it reaches', () => {
    const canvas = smudgeWith(twoToneField, { points: rightward });

    expect(changedPixels(canvas, twoToneField)).toEqual(['6,3', '6,4', '6,5']);
    for (const [x, y] of [
      [6, 3],
      [6, 4],
      [6, 5],
    ]) {
      expect(at(canvas.pixels, documentSize, x, y), `(${x}, ${y})`).toEqual({ r: 128, g: 0, b: 128, a: 255 });
    }
  });

  it('mirrors the drag when the stroke travels the other way, rather than always pulling one direction', () => {
    // A displacement computed with the pair's ends swapped would pull the blue LEFT into the
    // red on this stroke while still passing the rightward test above, so both are pinned.
    const canvas = smudgeWith(twoToneField, { points: leftward });

    expect(changedPixels(canvas, twoToneField)).toEqual(['5,3', '5,4', '5,5']);
    for (const [x, y] of [
      [5, 3],
      [5, 4],
      [5, 5],
    ]) {
      expect(at(canvas.pixels, documentSize, x, y), `(${x}, ${y})`).toEqual({ r: 128, g: 0, b: 128, a: 255 });
    }
  });

  it('leaves the red side of the boundary alone, so the drag does not run backwards as well', () => {
    // The counterpart to the sign pin: `(5, 3..5)` is the LAST red column, and a filter that
    // dragged both ways would have touched it as well as the first blue one.
    const canvas = smudgeWith(twoToneField, { points: rightward });

    for (let y = 0; y < documentSize.height; y++) {
      for (let x = 0; x < 6; x++) {
        expect(at(canvas.pixels, documentSize, x, y), `(${x}, ${y})`).toEqual(RED);
      }
    }
  });

  it('is an exact no-op at strength 0, leaving the drawn source untouched', () => {
    const canvas = smudgeWith(twoToneField, { points: rightward, strength: SMUDGE_STRENGTH_MIN });

    expect(Array.from(canvas.pixels)).toEqual(Array.from(twoToneField));
    // Nothing is read or written at all, so there is no path by which a zero coverage could
    // still shift a byte.
    expect(vi.mocked(canvas.ctx.getImageData)).not.toHaveBeenCalled();
    expect(vi.mocked(canvas.ctx.putImageData)).not.toHaveBeenCalled();
  });

  it('lays down exactly one dab for a single-point stroke, and that dab is the identity', () => {
    // A click is a dab with both ends on the same centre, so every covered texel is read from
    // itself. That is not a special case bolted on: a smudge tool that had something to say
    // about a click would be sampling a different brush than the one the drag uses. The
    // observable half of the contract is therefore that the raster path RAN — which is what
    // separates a one-dab click from a zero-dab one — and the pixel half is that nothing moved.
    const canvas = smudgeWith(twoToneField, { points: [{ x: 4, y: 4 }] });

    expect(Array.from(canvas.pixels)).toEqual(Array.from(twoToneField));
    expect(vi.mocked(canvas.ctx.getImageData)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(canvas.ctx.putImageData)).toHaveBeenCalledTimes(1);
  });

  it('skips the raster entirely for an empty stroke, which is what makes the click above a dab', () => {
    const canvas = smudgeWith(twoToneField, { points: [] });

    expect(Array.from(canvas.pixels)).toEqual(Array.from(twoToneField));
    expect(vi.mocked(canvas.ctx.getImageData)).not.toHaveBeenCalled();
    expect(vi.mocked(canvas.ctx.putImageData)).not.toHaveBeenCalled();
  });

  it('is a no-op that does not throw for a stroke entirely outside the canvas', () => {
    // A stroke routinely leaves the canvas, and a tool that threw there would take the whole
    // stroke down for a dab that had nowhere to land.
    const offCanvas: Point[] = [
      { x: 100, y: 4 },
      { x: 110, y: 4 },
    ];

    let canvas: RecordingOffscreenCanvas | undefined;
    expect(() => {
      canvas = smudgeWith(twoToneField, { points: offCanvas });
    }).not.toThrow();
    expect(Array.from(canvas!.pixels)).toEqual(Array.from(twoToneField));
  });
});

describe('smudge argument clamping', () => {
  /**
   * Every comparison is against the EXPLICITLY clamped settings rather than a literal, so
   * the assertion says "the tool clamped this" instead of pinning a number the tip engine
   * could change.
   */
  const clampedRuns: readonly [string, Partial<SmudgeToolArgs>, Partial<SmudgeToolArgs>][] = [
    ['a non-finite size', { size: Number.NaN }, { size: BRUSH_SIZE_DEFAULT }],
    ['an infinite size', { size: Number.POSITIVE_INFINITY }, { size: BRUSH_SIZE_DEFAULT }],
    ['an over-range size', { size: 5000 }, { size: BRUSH_SIZE_MAX }],
    ['a below-range size', { size: -40 }, { size: BRUSH_SIZE_MIN }],
    ['a non-finite hardness', { hardness: Number.NaN }, { hardness: BRUSH_HARDNESS_DEFAULT }],
    ['an over-range hardness', { hardness: 999 }, { hardness: BRUSH_HARDNESS_MAX }],
    ['a below-range hardness', { hardness: -12 }, { hardness: BRUSH_HARDNESS_MIN }],
    ['a non-finite strength', { strength: Number.NaN }, { strength: SMUDGE_STRENGTH_MIN }],
    ['an over-range strength', { strength: 500 }, { strength: SMUDGE_STRENGTH_MAX }],
    ['a below-range strength', { strength: -5 }, { strength: SMUDGE_STRENGTH_MIN }],
  ];

  it.each(clampedRuns)('clamps %s rather than throwing', (_label, out, clamped) => {
    // `Math.max` propagates `NaN`, and a `NaN` coverage makes every `tipAlphaAt * opacity`
    // weight `NaN`, which `blendPixel` cannot see as a no-op. The tip engine's own contract
    // is that a non-finite control falls back to the Photoshop default rather than to a range
    // end for exactly this reason.
    expect(() => smudgeWith(twoToneField, { ...clamped })).not.toThrow();
    expect(Array.from(smudgeWith(twoToneField, out).pixels)).toEqual(
      Array.from(smudgeWith(twoToneField, clamped).pixels)
    );
  });

  it('keeps the clamped comparisons from passing against two untouched buffers', () => {
    // Every `clamped` run above either is the strength-0 identity or matches the baseline
    // stroke. This is the one that has to differ from a no-op, so the equality above is a
    // claim about the clamp rather than about an empty buffer.
    const baseline = smudgeWith(twoToneField, {});

    expect(changedPixels(baseline, twoToneField)).toEqual(['6,3', '6,4', '6,5']);
  });

  it('maps a percentage strength onto the tip engine 0-1 coverage, so 100% is a full carry', () => {
    // At `strength: 100` the coverage is 1, so `blendPixel` replaces the destination outright
    // with the carried colour: 255 red, not the 128 a 50% carry produces.
    const canvas = smudgeWith(twoToneField, { points: rightward, strength: SMUDGE_STRENGTH_MAX });

    expect(at(canvas.pixels, documentSize, 6, 4)).toEqual(RED);
  });
});

describe('smudge tip contract', () => {
  it('stamps at a spacing of its own, because the args have no spacing field for it to read', () => {
    // `SmudgeToolArgs` carries no `spacing`, and Photoshop's Smudge bar exposes none, so the
    // dab step is a constant of the tool rather than a setting. It is the shared engine's
    // default so a smudge tip lays down dabs at the density the rest of the paint family
    // does, and it is asserted here because nothing else in the file mentions it.
    expect(SMUDGE_SPACING_PERCENT).toBe(25);
  });
});
