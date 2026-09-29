import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  fieldOf,
  imageDataFrom,
  luminanceOf,
  pixelAt as pixelAtLocal,
  stubPixelOffscreenCanvas,
  type PixelCanvas,
  bitmapFrom,
} from '../../__tests__/fixtures/pixelCanvas.ts';

import {
  applyColorReplacementPlan,
  colorReplacement,
  createColorReplacementPlan,
  createStrokeCoverage,
  replaceColorPreservingLuminance,
  samplePixelAt,
  COLOR_REPLACEMENT_TOLERANCE_TO_FILL_TOLERANCE_SCALE,
  COLOR_REPLACEMENT_TOLERANCE_MAX,
  type ColorReplacementToolArgs,
} from '../colorReplacement.ts';
import { defaultSettings } from '../settings.ts';
import { findToolProcessor } from '../toolProcessors.ts';
import { legacyHistoryToDurable } from '../../contexts/history-adapter.ts';
import { replayDurableDocument } from '../../contexts/durable-replay.ts';
import { OPEN_DOCUMENT_ACTION, TOOL_ACTION } from '../../util/constants.ts';
import type { Layer } from '../../contexts/layer-types.ts';
import type { ToolArgs } from '../../contexts/tool-types.ts';

beforeEach(() => {
  stubPixelOffscreenCanvas();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const BASE_ARGS: ColorReplacementToolArgs = {
  ...defaultSettings['color-replacement'],
  color: '#ff0000',
  sampleColor: { r: 20, g: 20, b: 200, a: 255 },
  points: [{ x: 5.5, y: 5.5 }],
};

/** A 12×12 layer: a blue field, with a green and a magenta pixel that must never change. */
const twoToneImage = () =>
  fieldOf(
    12,
    [200, 200, 10],
    [
      [10, 1, 12, 240, 30],
      [0, 0, 255, 0, 255],
    ]
  );

const runPlan = (imageData: ImageData, overrides: Partial<ColorReplacementToolArgs> = {}) => {
  const args = { ...BASE_ARGS, ...overrides } as ColorReplacementToolArgs;
  const plan = createColorReplacementPlan(imageData, args);
  if (!plan) return null;
  applyColorReplacementPlan(imageData, plan, args);
  return { imageData, plan, args };
};

describe('replaceColorPreservingLuminance', () => {
  it('keeps the source luminance EXACTLY when the replacement can express it', () => {
    // Mid-grey asked to become a mid-luminance blue: nothing clips, so the offset is exact and the
    // result's luminance is the source's to floating point. This is the single assertion a
    // paint-over cannot pass — a brush returns the replacement's own (0, 120, 200) for every one
    // of the grey's many shades.
    const [r, g, b] = replaceColorPreservingLuminance(128, 128, 128, 40, 120, 200);

    expect([r, g, b]).toEqual([59.232, 139.232, 219.232]);
    expect(luminanceOf(r, g, b)).toBeCloseTo(luminanceOf(128, 128, 128), 1);
  });

  it('preserves relative shading across a lit run instead of flattening it to one solid', () => {
    // Three greys must come back as three DIFFERENT colours, however the replacement is applied.
    // The defect this guards is a substitution that returns one solid colour for a whole region.
    const results = [40, 100, 160].map((value) => replaceColorPreservingLuminance(value, value, value, 220, 20, 60));

    expect(new Set(results.map(([r, g, b]) => `${r},${g},${b}`)).size).toBe(3);
    // Monotone in the source's luminance across the whole range, including both clip ends.
    const luminances = [0, 40, 100, 160, 255].map((value) =>
      luminanceOf(...replaceColorPreservingLuminance(value, value, value, 255, 0, 0))
    );
    for (let index = 1; index < luminances.length; index++) {
      expect(luminances[index], `step ${index}`).toBeGreaterThan(luminances[index - 1]);
    }
  });

  it('returns a light red for a white source, not white and not a flat pure red', () => {
    // Pure white has no in-gamut pure red, so something has to give. Giving the HUE is the right
    // answer: a light red is what Photoshop paints, and white — which is what restoring luminance
    // at any cost produces — is a substitution that did nothing.
    const [r, g, b] = replaceColorPreservingLuminance(255, 255, 255, 255, 0, 0);

    expect(r).toBe(255);
    expect(r - g).toBeGreaterThan(30);
    expect(r - b).toBeGreaterThan(30);
  });

  it('remaps a black replacement to the source luminance, since black has no chroma to give', () => {
    const [r, g, b] = replaceColorPreservingLuminance(200, 100, 50, 0, 0, 0);

    expect(r).toBe(g);
    expect(g).toBe(b);
    expect(luminanceOf(r, g, b)).toBeCloseTo(luminanceOf(200, 100, 50), 0);
  });

  it('is identity when the replacement already equals the source', () => {
    const [r, g, b] = replaceColorPreservingLuminance(12, 240, 30, 12, 240, 30);

    expect([r, g, b]).toEqual([12, 240, 30]);
  });
});

describe('createColorReplacementPlan — the colour test', () => {
  it('replaces the sampled colour and leaves every other colour in the layer untouched', () => {
    // Blue field, blue sample, red replacement, one point on the blue. The green pixel, the
    // magenta pixel and every untouched corner must come out byte-identical.
    const before = twoToneImage();
    const bluePixel = pixelAtLocal(before, 5, 5);
    const greenPixel = pixelAtLocal(before, 10, 1);
    const magentaPixel = pixelAtLocal(before, 0, 0);

    const result = runPlan(before, {
      sampleColor: { r: bluePixel[0], g: bluePixel[1], b: bluePixel[2], a: 255 },
    });

    expect(result).not.toBeNull();
    const after = pixelAtLocal(result!.imageData, 5, 5);
    expect(after[0]).toBeGreaterThan(after[1] + 30);
    expect(after[0]).toBeGreaterThan(after[2] + 30);
    expect(pixelAtLocal(result!.imageData, 10, 1)).toEqual(greenPixel);
    expect(pixelAtLocal(result!.imageData, 0, 0)).toEqual(magentaPixel);
  });

  it('admits a pixel just inside the tolerance and rejects one just outside it', () => {
    // Sample blue; one neighbour 20 away per channel and one 55/90/80 away. At Tolerance 20 the
    // threshold is 88 in euclidean RGB, so only the near one is inside it. A test that counted ctx
    // calls could not tell these apart; these are the actual pixel values.
    const near = [200, 180, 30];
    const far = [255, 110, 110];
    const imageData = imageDataFrom(6, 6, [
      [2, 2, 200, 200, 30],
      [4, 2, near[0], near[1], near[2]],
      [4, 4, far[0], far[1], far[2]],
    ]);

    const result = runPlan(imageData, {
      tolerance: 20,
      lineWidth: 8,
      sampleColor: { r: 200, g: 200, b: 30, a: 255 },
    });

    expect(result).not.toBeNull();
    const nearAfter = pixelAtLocal(result!.imageData, 4, 2);
    const farAfter = pixelAtLocal(result!.imageData, 4, 4);
    expect(nearAfter[0]).toBeGreaterThan(nearAfter[2] + 20);
    expect(farAfter).toEqual(far);
  });

  it('raises the admitted distance with Tolerance, so the same drag covers more at 100 than at 0', () => {
    const build = (tolerance: number) => {
      const imageData = imageDataFrom(6, 6, [
        [3, 3, 200, 200, 30],
        [5, 3, 230, 200, 30],
      ]);
      runPlan(imageData, { tolerance, lineWidth: 8, sampleColor: { r: 200, g: 200, b: 30, a: 255 } });
      return pixelAtLocal(imageData, 5, 3)[0];
    };

    // Euclidean distance from the sample is sqrt(30^2) = 30. At tolerance 0 only an exact match
    // counts, so the neighbour is untouched; at 100 everything matches, so it is replaced.
    expect(build(0)).toBe(230);
    expect(build(100)).toBeGreaterThan(200);
  });

  it('makes Tolerance 0 an exact-match-only test and Tolerance 100 match every pixel', () => {
    const sample = { r: 200, g: 200, b: 30, a: 255 };
    const build = (tolerance: number) => {
      const imageData = imageDataFrom(6, 6, [
        [3, 3, 200, 200, 30],
        [5, 5, 255, 0, 255],
      ]);
      runPlan(imageData, {
        tolerance,
        lineWidth: 8,
        limits: 'discontinuous',
        sampleColor: sample,
      });
      return pixelAtLocal(imageData, 5, 5);
    };

    // The magenta pixel is 306 from the sample. At Tolerance 0 the threshold is 0, so it is not a
    // match and comes back byte-identical. At 100 the threshold is the whole colour space and it
    // IS substituted — which does not mean it becomes the sample, it means it takes the
    // replacement AT ITS OWN LUMINANCE, so a test asserting the two were confused would pass on
    // the wrong arithmetic.
    expect(build(0)).toEqual([255, 0, 255]);
    expect(build(COLOR_REPLACEMENT_TOLERANCE_MAX)).toEqual([255, 18, 18]);
  });

  it('returns null when no sample has been taken, so the asking state can never commit', () => {
    const imageData = twoToneImage();

    expect(createColorReplacementPlan(imageData, { ...BASE_ARGS, sampleColor: null })).toBeNull();
    expect(createColorReplacementPlan(imageData, { ...BASE_ARGS, sampleColor: undefined })).toBeNull();
  });

  it('returns null when the drag never reached a matching pixel', () => {
    // The sample is itself a matching pixel, and the brush covers whatever it is dragged over, so
    // the drag has to be put genuinely out of reach of the sampled grey for this to be null.
    const imageData = imageDataFrom(8, 8, [[0, 0, 250, 250, 250]]);

    expect(
      createColorReplacementPlan(imageData, {
        ...BASE_ARGS,
        sampleColor: { r: 250, g: 250, b: 250, a: 255 },
        points: [{ x: 7.5, y: 7.5 }],
        lineWidth: 2,
        tolerance: 1,
      })
    ).toBeNull();
  });

  it('reports how many pixels it will change, so a no-op drag is distinguishable from a real one', () => {
    const imageData = imageDataFrom(8, 8, [[4, 4, 200, 200, 30]]);

    const inside = createColorReplacementPlan(imageData, {
      ...BASE_ARGS,
      sampleColor: { r: 200, g: 200, b: 30, a: 255 },
      points: [{ x: 4.5, y: 4.5 }],
      lineWidth: 3,
    });
    const outside = createColorReplacementPlan(imageData, {
      ...BASE_ARGS,
      sampleColor: { r: 200, g: 200, b: 30, a: 255 },
      points: [{ x: 7.5, y: 7.5 }],
      lineWidth: 3,
    });

    expect(inside?.changedPixelCount).toBeGreaterThan(0);
    expect(outside).toBeNull();
  });
});

describe('createColorReplacementPlan — Limits', () => {
  /**
   * A 20×20 field of the sampled colour with one black corner, so a one-pixel drag is a genuine
   * test of extent: the whole field is one connected region, and only the brush's own disc is
   * under the drag.
   */
  const fieldWithACorner = () => fieldOf(20, [200, 200, 30], [[19, 19, 0, 0, 0]]);

  const base = {
    color: '#ff0000',
    sampleColor: { r: 200, g: 200, b: 30, a: 255 },
    lineWidth: 4,
    tolerance: 5,
    smoothness: 0,
    points: [{ x: 10.5, y: 10.5 }],
  };

  it('replaces the WHOLE connected region on Contiguous, from a one-pixel drag', () => {
    const result = runPlan(fieldWithACorner(), { ...base, limits: 'contiguous' });

    expect(result).not.toBeNull();
    // Every pixel but the black corner, which is a different colour and so a different region. The
    // far pixel is 14px from the drag and 4px outside its brush: changed anyway, because it is
    // the same connected region. A brush cannot produce this by construction.
    expect(result!.plan.changedPixelCount).toBe(20 * 20 - 1);
    const farPixel = pixelAtLocal(result!.imageData, 0, 0);
    expect(farPixel[0]).toBeGreaterThan(farPixel[1] + 30);
  });

  it('replaces ONLY what the brush covered on Discontinuous, from the same drag', () => {
    const result = runPlan(fieldWithACorner(), { ...base, limits: 'discontinuous' });

    expect(result).not.toBeNull();
    // The brush's disc, and nothing else: a fraction of the field, against 399 for Contiguous.
    expect(result!.plan.changedPixelCount).toBeLessThan(80);
    expect(result!.plan.changedPixelCount).toBeGreaterThan(0);
    // A pixel far outside the brush keeps its original colour, and the near ones do not: the two
    // limits are a choice about EXTENT, which is exactly what Photoshop's popup means.
    expect(pixelAtLocal(result!.imageData, 0, 0)).toEqual([200, 200, 30]);
    const near = pixelAtLocal(result!.imageData, 10, 10);
    expect(near[0]).toBeGreaterThan(near[1] + 30);
  });

  it('stops the Contiguous region at a different colour, so it cannot leak across it', () => {
    // A black wall down column 10 splits the field in two; a drag left of it must not cross.
    const imageData = fieldOf(
      20,
      [200, 200, 30],
      Array.from({ length: 20 }, (_, y) => [10, y, 0, 0, 0])
    );

    const result = runPlan(imageData, { ...base, limits: 'contiguous', points: [{ x: 5.5, y: 5.5 }] });

    expect(result).not.toBeNull();
    expect(pixelAtLocal(result!.imageData, 0, 0)[0]).toBeGreaterThan(200);
    expect(pixelAtLocal(result!.imageData, 15, 5)).toEqual([200, 200, 30]);
  });

  it('uses one tolerance metric for both limits, so neither mode can reject a pixel the other admits', () => {
    // The conversion constant is what makes Discontinuous's inline predicate and Contiguous's
    // delegated `createFloodFillMask` flood the same set. A drift here would make Limits a choice
    // about which pixels EXIST rather than about how far the replacement reaches. It is a SCALE
    // from this tool's 0-100 onto the flood fill's 0-255, and both are read against the same
    // `sqrt(3 * 255^2)` maximum, so 100 on one side is 255 on the other.
    expect(COLOR_REPLACEMENT_TOLERANCE_TO_FILL_TOLERANCE_SCALE).toBeCloseTo(2.55, 6);

    // A field of a colour nothing like the sample: a low tolerance rejects everything in both
    // modes, which is the invariant.
    const count = (limits: 'contiguous' | 'discontinuous', tolerance: number) => {
      const imageData = fieldOf(20, [255, 0, 255]);
      return runPlan(imageData, { ...base, limits, tolerance })?.plan.changedPixelCount ?? 0;
    };

    expect(count('contiguous', 0)).toBe(0);
    expect(count('discontinuous', 0)).toBe(0);
    // And at a tolerance that admits the whole field, both modes see the same pixels, so the
    // only difference left between them is how far the substitution reaches.
    expect(count('contiguous', 100)).toBe(400);
    expect(count('discontinuous', 100)).toBeLessThan(400);
  });
});

describe('createColorReplacementPlan — Smoothness and Size', () => {
  it('widens the substituted band as Size grows, at a fixed tolerance and smoothness', () => {
    const count = (lineWidth: number) =>
      runPlan(fieldOf(20, [200, 200, 30]), {
        ...BASE_ARGS,
        lineWidth,
        limits: 'discontinuous',
        smoothness: 0,
        sampleColor: { r: 200, g: 200, b: 30, a: 255 },
      })?.plan.changedPixelCount;

    expect(count(4)).toBeGreaterThan(0);
    expect(count(12)!).toBeGreaterThan(count(4)!);
  });

  it('softens the band’s edge as Smoothness grows, and never widens it', () => {
    // A brush far larger than the widest blur window, which is the only regime in which "feather
    // the edge" is separable from "flatten the whole thing": 50px of radius against a 25px window
    // leaves a plateau in the middle. Three claims, all readable off the plan: the deep interior
    // stays FULLY replaced (Smoothness is an edge control, not an Opacity), the band just inside the
    // boundary gains (the hard edge becomes a gradient), and the first pixel outside it stays at
    // exactly zero (the blur must not reach past the area, which is what the eligibility gate is
    // for). Without the gate the last one fails and the tool substitutes a colour it was never
    // asked to replace.
    const profile = (smoothness: number) => {
      const plan = createColorReplacementPlan(fieldOf(120, [200, 200, 30]), {
        ...BASE_ARGS,
        lineWidth: 50,
        limits: 'discontinuous',
        smoothness,
        points: [{ x: 60.5, y: 60.5 }],
        sampleColor: { r: 200, g: 200, b: 30, a: 255 },
      });
      const strengths = [...(plan?.strength ?? [])];

      return {
        interior: strengths[60 * 120 + 60],
        // Replaced at all, versus replaced PARTIALLY. The gap between the two is the edge: more of
        // the second is a feathered edge, and a different value for the first is the blur having
        // reached outside the area, which it must never do.
        replaced: strengths.filter((value) => value > 0).length,
        partial: strengths.filter((value) => value > 0 && value < 1).length,
      };
    };

    const sharp = profile(0);
    const feathered = profile(50);

    // The deep interior is fully replaced at both: Smoothness is an edge control, not an Opacity.
    expect(sharp.interior).toBe(1);
    expect(feathered.interior).toBe(1);
    // More of the band is partial, so the hard edge became a gradient.
    expect(feathered.partial).toBeGreaterThan(sharp.partial);
    // And nothing outside the area was substituted.
    expect(feathered.replaced).toBe(sharp.replaced);
  });

  it('never carries the substitution onto a pixel of another colour, however much Smoothness', () => {
    // The gate the blur needs. Without it a 10px match bleeds onto the 12th, which is a colour
    // the user never sampled and never asked to replace.
    const imageData = fieldOf(20, [200, 200, 30], [[16, 10, 0, 255, 0]]);

    runPlan(imageData, {
      ...BASE_ARGS,
      lineWidth: 8,
      limits: 'discontinuous',
      smoothness: 50,
      points: [{ x: 10.5, y: 10.5 }],
      sampleColor: { r: 200, g: 200, b: 30, a: 255 },
    });

    expect(pixelAtLocal(imageData, 16, 10)).toEqual([0, 255, 0]);
  });

  it('keeps a solid core at full strength in the middle of the brush', () => {
    const imageData = fieldOf(20, [200, 200, 30]);

    runPlan(imageData, {
      ...BASE_ARGS,
      lineWidth: 8,
      limits: 'discontinuous',
      smoothness: 0,
      points: [{ x: 10.5, y: 10.5 }],
      sampleColor: { r: 200, g: 200, b: 30, a: 255 },
    });

    // Strength 1 under pure red at Opacity 1. The source's luminance is 187.7 and pure red's is
    // 54.2, so the offset is +133.5 and red clips at 255 while g and b land on 133.5: a light red.
    // The numbers are the arithmetic, not a guess — a brush would have written (255, 0, 0).
    expect(pixelAtLocal(imageData, 10, 10)).toEqual([255, 134, 134]);
  });
});

describe('createStrokeCoverage', () => {
  it('is 1 inside the core, 0 outside the radius, and strictly between in the rim', () => {
    const coverage = createStrokeCoverage(21, 21, [{ x: 10.5, y: 10.5 }], 8);

    // radius 8, core 4: the pixel at 15 is 5 out, which is the rim.
    expect(coverage[10 * 21 + 10]).toBe(1);
    expect(coverage[10 * 21 + 19]).toBe(0);
    const rim = coverage[10 * 21 + 15];
    expect(rim).toBeGreaterThan(0);
    expect(rim).toBeLessThan(1);
  });

  it('unions overlapping stamps with max, so a repeated stamp cannot compound the coverage', () => {
    const doubled = createStrokeCoverage(
      21,
      21,
      [
        { x: 10.5, y: 10.5 },
        { x: 10.5, y: 10.5 },
      ],
      8
    );
    const once = createStrokeCoverage(21, 21, [{ x: 10.5, y: 10.5 }], 8);

    expect(doubled[10 * 21 + 10]).toBe(once[10 * 21 + 10]);
  });

  it('sweeps along a segment, not just through its endpoints', () => {
    const coverage = createStrokeCoverage(
      21,
      21,
      [
        { x: 2.5, y: 10.5 },
        { x: 18.5, y: 10.5 },
      ],
      4
    );

    expect(coverage[10 * 21 + 10]).toBe(1);
  });
});

describe('Opacity', () => {
  it('leaves the source fully intact at 0 and fully substituted at 1', () => {
    const build = (alpha: number) => {
      const imageData = fieldOf(8, [128, 128, 128]);
      runPlan(imageData, {
        ...BASE_ARGS,
        alpha,
        lineWidth: 6,
        smoothness: 0,
        sampleColor: { r: 128, g: 128, b: 128, a: 255 },
      });
      return pixelAtLocal(imageData, 4, 4);
    };

    expect(build(0)).toEqual([128, 128, 128]);
    // At Opacity 1 the substitution is complete, and for this source it is (255, 74, 74): the
    // grey's luminance 128 less pure red's 54.2 is an offset of +73.8, red clips, g and b do not.
    expect(build(1)).toEqual([255, 74, 74]);
  });

  it('interpolates, and the half-way pixel keeps its own luminance', () => {
    const imageData = fieldOf(8, [128, 128, 128]);

    runPlan(imageData, {
      ...BASE_ARGS,
      alpha: 0.5,
      lineWidth: 6,
      smoothness: 0,
      sampleColor: { r: 128, g: 128, b: 128, a: 255 },
    });

    const [r, g, b] = pixelAtLocal(imageData, 4, 4);
    expect(r).toBeGreaterThan(128);
    // A partially replaced pixel is a half-tint of the same shading, not a half-transparent wash
    // of a solid: its luminance must not collapse towards the replacement's.
    expect(luminanceOf(r, g, b)).toBeGreaterThan(luminanceOf(255, 0, 0) + 10);
  });
});

describe('samplePixelAt', () => {
  it('reads the pixel under the click and refuses one outside the image', () => {
    const imageData = imageDataFrom(4, 4, [[1, 2, 10, 20, 30]]);

    expect(samplePixelAt(imageData, { x: 1, y: 2 })).toEqual({ r: 10, g: 20, b: 30, a: 255 });
    expect(samplePixelAt(imageData, { x: 9, y: 2 })).toBeNull();
    expect(samplePixelAt(imageData, { x: 1, y: -1 })).toBeNull();
  });
});

describe('the registered processor', () => {
  const run = (imageData: ImageData, overrides: Partial<ColorReplacementToolArgs> = {}) => {
    const args = { ...BASE_ARGS, ...overrides } as ColorReplacementToolArgs;
    const result = findToolProcessor('color-replacement')!.imageProcessor({
      size: { width: imageData.width, height: imageData.height },
      bitmap: bitmapFrom(imageData),
    })(args);
    // The RETURNED canvas, not `CANVASES.at(-1)`: the processor allocates its output canvas first
    // and the read-back scratch second, so the last one allocated is the scratch copy of the
    // source — which would make every pixel assertion below pass against the UNCHANGED image.
    return { canvas: result[0] as unknown as PixelCanvas, args, result };
  };

  it('replaces the sampled colour in the pixels it returns to the store', () => {
    const before = twoToneImage();
    const { canvas } = run(before, {
      sampleColor: { r: 200, g: 200, b: 10, a: 255 },
      limits: 'discontinuous',
      lineWidth: 6,
    });

    const [r, g, b] = pixelAtLocal(canvas.ctx.getImageData(0, 0, 12, 12), 5, 5);
    expect(r).toBeGreaterThan(g + 30);
    expect(r).toBeGreaterThan(b + 30);
  });

  it('keeps the raster commit and the raster-processor replay, which is what the durable path routes on', () => {
    const processor = findToolProcessor('color-replacement')!;

    expect(processor.commit).toBe('raster');
    expect(processor.replay).toMatchObject({ kind: 'raster-processor', requiresRaster: true, deterministic: true });
  });

  it('round-trips every arg through plain data, so history-adapter drops nothing', () => {
    // `history-adapter.ts:111` throws `Non-plain value` on anything that is not null, a string, a
    // finite number, a boolean, a plain object or a plain array. A class instance or a function
    // smuggled into these args would fail the whole durable conversion for the tool.
    const args = { ...BASE_ARGS, points: [{ x: 1.25, y: 2.5 }] };
    const describeValue = (value: unknown): string => {
      if (value === null || typeof value !== 'object') return typeof value;
      if (Array.isArray(value)) return `[${value.map(describeValue).join(',')}]`;
      return `{${Object.entries(value as Record<string, unknown>)
        .map(([key, item]) => `${key}:${describeValue(item)}`)
        .join(',')}}`;
    };

    expect(describeValue(args)).toBe(
      '{alpha:number,lineWidth:number,color:string,tolerance:number,limits:string,sampling:string,smoothness:number,sampleColor:{r:number,g:number,b:number,a:number},points:[{x:number,y:number}],toolName:string}'
    );
    for (const value of Object.values(args)) {
      if (typeof value === 'number') expect(Number.isFinite(value), String(value)).toBe(true);
    }
  });

  it('returns the source unchanged, not a blank layer, when the environment cannot read pixels back', () => {
    // The app suite's own context has no `getImageData` (`src/test/setup.ts:182-190`), and
    // production guards on exactly that. The tool must then change nothing, not blank the layer.
    const imageData = twoToneImage();
    const blankContext = { drawImage: vi.fn(), getImageData: undefined, putImageData: vi.fn() };
    class BlindCanvas {
      width: number;
      height: number;

      constructor(width: number, height: number) {
        this.width = width;
        this.height = height;
      }

      getContext() {
        return blankContext;
      }
    }
    vi.stubGlobal('OffscreenCanvas', BlindCanvas as unknown as typeof OffscreenCanvas);

    const result = findToolProcessor('color-replacement')!.imageProcessor({
      size: { width: 12, height: 12 },
      bitmap: { width: 12, height: 12, pixels: imageData.data } as unknown as ImageBitmap,
    })({ ...BASE_ARGS } as never);

    expect(result).toHaveLength(1);
    expect(blankContext.putImageData).not.toHaveBeenCalled();
    expect(blankContext.drawImage).toHaveBeenCalledTimes(1);
  });

  it('runs on its own seeded defaults without throwing, as the dispatch table requires', () => {
    // The seeded `sampleColor` is null, so the seeded defaults are "not sampled yet" — a legal
    // no-op. What the dispatch table is really pinning is that the processor does not throw.
    const imageData = twoToneImage();
    expect(() => run(imageData, { sampleColor: null, points: [] })).not.toThrow();
  });

  it('exposes the plan arithmetic without a canvas, which is what the tool area consults', () => {
    const imageData = twoToneImage();
    const plan = createColorReplacementPlan(imageData, {
      ...BASE_ARGS,
      limits: 'discontinuous',
      sampleColor: { r: 200, g: 200, b: 10, a: 255 },
    });

    expect(plan?.changedPixelCount).toBeGreaterThan(0);
    expect(plan?.strength.some((value) => value > 0)).toBe(true);
  });

  it('is reachable through the module export the registry uses, by identity', () => {
    expect(findToolProcessor('color-replacement')!.imageProcessor).toBe(colorReplacement);
  });
});

describe('the durable/replay boundary', () => {
  const layerId = 'layer-1';
  const initialSize = { width: 40, height: 30 };
  const layerPos = { x: 0, y: 0, width: 40, height: 30 };

  const baselineLayer = (): Layer => ({
    id: layerId,
    name: 'Layer',
    isBedrock: false,
    tmpCanvas: null,
    bitmap: null,
    visible: true,
    opacity: 1,
    locked: false,
    blendMode: 'source-over',
    order: 0,
    pos: { ...layerPos },
    source: { kind: 'blank', color: '#ffffff', opacity: 1, isBedrock: false, pos: { ...layerPos } },
    operations: [],
  });

  const convert = (args: ColorReplacementToolArgs) =>
    legacyHistoryToDurable([
      {
        id: 'baseline',
        actionName: OPEN_DOCUMENT_ACTION,
        layerId,
        documentSource: { layers: { [layerId]: baselineLayer() }, size: initialSize, frame: layerPos },
      },
      { id: 'replace', actionName: TOOL_ACTION, layerId, args: args as unknown as ToolArgs },
    ]);

  it('converts to apply-raster-processor with EVERY argument intact, and drops nothing', () => {
    // The whole boundary question in one assertion. `history-adapter.ts:416-423` is the only branch
    // this tool reaches: `processor.commit === 'raster'` becomes `apply-raster-processor` with
    // `processorId: 'color-replacement'` and `args: plainObject(args)`, verbatim. There is no
    // allow-list of fields, so a new field is carried by construction and a renamed one is a
    // silent data loss — which is why the exact arg set is pinned here rather than reasoned about.
    const { document, diagnostics } = convert({
      ...BASE_ARGS,
      tolerance: 42,
      limits: 'discontinuous',
      sampling: 'all-layers',
      smoothness: 17,
    } as ColorReplacementToolArgs);

    expect(diagnostics).toEqual([]);
    expect(document.history.at(-1)?.operation).toStrictEqual({
      kind: 'apply-raster-processor',
      layerId,
      processorId: 'color-replacement',
      version: 1,
      args: {
        alpha: 1,
        lineWidth: 18,
        color: '#ff0000',
        tolerance: 42,
        limits: 'discontinuous',
        sampling: 'all-layers',
        smoothness: 17,
        sampleColor: { r: 20, g: 20, b: 200, a: 255 },
        points: [{ x: 5.5, y: 5.5 }],
        toolName: 'color-replacement',
      },
    });
  });

  it('retains the operation on the layer, so undo reaches it', () => {
    const { document } = convert(BASE_ARGS);
    const replayed = replayDurableDocument(document);

    expect(replayed.layers[layerId]?.operations).toMatchObject([
      { kind: 'apply-raster-processor', processorId: 'color-replacement' },
    ]);
  });

  it('raises no diagnostic for an args set the tool never used to have', () => {
    // `history-adapter.ts:354` throws `UnsupportedHistoryFeatureError` for a tool name with no
    // processor, and `:111` throws for a non-plain value. Both are silent no-ops if they regress
    // into a catch, so the diagnostics list is the assertion, not the throw.
    const { diagnostics } = convert({ ...BASE_ARGS, sampleColor: null, points: [] });

    expect(diagnostics).toEqual([]);
  });
});
