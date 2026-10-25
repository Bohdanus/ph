import { describe, expect, it } from 'vitest';
import { createPixelBuffer, readRgba, type Rgba } from '../pixels.ts';
import type { Point, Size } from '../../contexts/general-types.ts';
import {
  BRUSH_HARDNESS_DEFAULT,
  BRUSH_HARDNESS_MAX,
  BRUSH_HARDNESS_MIN,
  BRUSH_OPACITY_DEFAULT,
  BRUSH_SIZE_DEFAULT,
  BRUSH_SIZE_MAX,
  BRUSH_SIZE_MIN,
  BRUSH_SPACING_DEFAULT,
  BRUSH_SPACING_MAX,
  BRUSH_SPACING_MIN,
  appendBrushDabCenters,
  brushDabCenters,
  clampBrushTipSettings,
  createBrushDabCenterSampler,
  stampBrushDab,
  stampBrushStroke,
  tipAlphaAt,
  type BrushTipSettings,
} from '../brush-engine.ts';

const OPAQUE_WHITE: Rgba = { r: 255, g: 255, b: 255, a: 255 };
const OPAQUE_RED: Rgba = { r: 255, g: 0, b: 0, a: 255 };
const TRANSPARENT_BLACK: Rgba = { r: 0, g: 0, b: 0, a: 0 };

/** A `width x height` buffer filled with one flat colour, the shape `getImageData` returns. */
const filledBuffer = (width: number, height: number, fill: Rgba): Uint8ClampedArray => {
  const data = createPixelBuffer({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      data[offset] = fill.r;
      data[offset + 1] = fill.g;
      data[offset + 2] = fill.b;
      data[offset + 3] = fill.a;
    }
  }
  return data;
};

const at = (data: Uint8ClampedArray, width: number, x: number, y: number): Rgba => readRgba(data, x, y, width);

/** How many pixels of the buffer satisfy `match`, for "exactly N pixels were touched" claims. */
const countMatching = (data: Uint8ClampedArray, size: Size, match: (pixel: Rgba) => boolean): number => {
  let count = 0;
  for (let y = 0; y < size.height; y++) {
    for (let x = 0; x < size.width; x++) if (match(at(data, size.width, x, y))) count++;
  }
  return count;
};

const settings = (overrides: Partial<BrushTipSettings> = {}): BrushTipSettings =>
  clampBrushTipSettings({ size: 12, hardness: 100, opacity: 1, spacing: 25, ...overrides });

/** `count` evenly spaced samples from `(0, 0)` to `(length, 0)`, as a pointer would emit. */
const samples = (count: number, length: number): Point[] =>
  Array.from({ length: count }, (_, index) => ({ x: (length / (count - 1)) * index, y: 0 }));

describe('clampBrushTipSettings', () => {
  it('fills every omitted control with the Photoshop default', () => {
    expect(clampBrushTipSettings({})).toEqual({
      size: BRUSH_SIZE_DEFAULT,
      hardness: BRUSH_HARDNESS_DEFAULT,
      opacity: 1,
      spacing: BRUSH_SPACING_DEFAULT,
    });
  });

  it('clamps each slider to both ends of its Photoshop range', () => {
    expect(clampBrushTipSettings({ size: 0 })).toMatchObject({ size: BRUSH_SIZE_MIN });
    expect(clampBrushTipSettings({ size: -40 })).toMatchObject({ size: BRUSH_SIZE_MIN });
    expect(clampBrushTipSettings({ size: 5000 })).toMatchObject({ size: BRUSH_SIZE_MAX });
    expect(clampBrushTipSettings({ hardness: -1 })).toMatchObject({ hardness: BRUSH_HARDNESS_MIN });
    expect(clampBrushTipSettings({ hardness: 140 })).toMatchObject({ hardness: BRUSH_HARDNESS_MAX });
    expect(clampBrushTipSettings({ opacity: -0.25 })).toMatchObject({ opacity: 0 });
    expect(clampBrushTipSettings({ opacity: 3 })).toMatchObject({ opacity: 1 });
    expect(clampBrushTipSettings({ spacing: 0 })).toMatchObject({ spacing: BRUSH_SPACING_MIN });
    expect(clampBrushTipSettings({ spacing: 250 })).toMatchObject({ spacing: BRUSH_SPACING_MAX });
  });

  it('leaves an in-range control untouched, so a bar does not quantise what the user typed', () => {
    expect(clampBrushTipSettings({ size: 37, hardness: 62, opacity: 0.35, spacing: 8 })).toEqual({
      size: 37,
      hardness: 62,
      opacity: 0.35,
      spacing: 8,
    });
  });

  it('falls back to the default for a non-finite control, which would otherwise stamp nothing', () => {
    for (const nonFinite of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(
        clampBrushTipSettings({ size: nonFinite, hardness: nonFinite, opacity: nonFinite, spacing: nonFinite })
      ).toEqual({
        size: BRUSH_SIZE_DEFAULT,
        hardness: BRUSH_HARDNESS_DEFAULT,
        opacity: 1,
        spacing: BRUSH_SPACING_DEFAULT,
      });
    }
  });

  it('falls back to the default for a nullish control rather than coercing it to zero', () => {
    // `Number.isFinite(null)` is false rather than true, so a control cleared back to
    // nothing lands on the Photoshop default instead of a 1px / 0% brush.
    expect(clampBrushTipSettings({ size: null as unknown as number })).toMatchObject({
      size: BRUSH_SIZE_DEFAULT,
    });
    expect(clampBrushTipSettings({ opacity: undefined })).toMatchObject({ opacity: 1 });
  });

  it('is idempotent, because every tool clamps on the way in and again on the way to a pixel', () => {
    const once = clampBrushTipSettings({ size: 900, hardness: -3, opacity: 4, spacing: 0 });
    expect(clampBrushTipSettings(once)).toEqual(once);
  });

  it('returns a fresh object and does not mutate the settings it was given', () => {
    const input = { size: 900, spacing: 0 };
    const clamped = clampBrushTipSettings(input);

    expect(clamped).not.toBe(input);
    expect(input).toEqual({ size: 900, spacing: 0 });
  });

  it('clamps a non-finite control per-field to the Photoshop default, not to a range end', () => {
    for (const nonFinite of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(clampBrushTipSettings({ size: nonFinite })).toMatchObject({ size: BRUSH_SIZE_DEFAULT });
      expect(clampBrushTipSettings({ hardness: nonFinite })).toMatchObject({ hardness: BRUSH_HARDNESS_DEFAULT });
      expect(clampBrushTipSettings({ opacity: nonFinite })).toMatchObject({ opacity: BRUSH_OPACITY_DEFAULT });
      expect(clampBrushTipSettings({ spacing: nonFinite })).toMatchObject({ spacing: BRUSH_SPACING_DEFAULT });
    }
  });

  it('clamps a negative control into its range lower bound', () => {
    expect(clampBrushTipSettings({ size: -1 })).toMatchObject({ size: BRUSH_SIZE_MIN });
    expect(clampBrushTipSettings({ hardness: -0.01 })).toMatchObject({ hardness: BRUSH_HARDNESS_MIN });
    expect(clampBrushTipSettings({ opacity: -1 })).toMatchObject({ opacity: 0 });
    expect(clampBrushTipSettings({ spacing: -10 })).toMatchObject({ spacing: BRUSH_SPACING_MIN });
  });

  it('clamps every slider to both ends of its Photoshop range in one pass', () => {
    const clamped = clampBrushTipSettings({
      size: -BRUSH_SIZE_MAX,
      hardness: BRUSH_HARDNESS_MAX + 999,
      opacity: Number.POSITIVE_INFINITY,
      spacing: -BRUSH_SPACING_MAX,
    });
    expect(clamped).toEqual({
      size: BRUSH_SIZE_MIN,
      hardness: BRUSH_HARDNESS_MAX,
      opacity: 1,
      spacing: BRUSH_SPACING_MIN,
    });
  });
});

describe('tipAlphaAt', () => {
  it('is fully opaque at the centre and across the hard core', () => {
    expect(tipAlphaAt(0, 6, 0)).toBe(1);
    expect(tipAlphaAt(0, 6, 100)).toBe(1);
    // Hardness 50 puts the core boundary at half the radius.
    expect(tipAlphaAt(5, 10, 50)).toBe(1);
    expect(tipAlphaAt(4.999, 10, 50)).toBe(1);
  });

  it('is a flat 1 out to the whole radius at hardness 100, then steps to 0', () => {
    for (let distance = 0; distance < 6; distance += 0.5) expect(tipAlphaAt(distance, 6, 100)).toBe(1);
    expect(tipAlphaAt(6, 6, 100)).toBe(0);
    expect(tipAlphaAt(6.5, 6, 100)).toBe(0);
  });

  it('eases cosine-squared through the falloff, with no core at hardness 0', () => {
    // radius 6, core 0, so t is simply d/6 and the samples are the curve itself.
    expect(tipAlphaAt(1, 6, 0)).toBeCloseTo(0.5 * (1 + Math.cos(Math.PI / 6)), 12);
    expect(tipAlphaAt(2, 6, 0)).toBeCloseTo(0.75, 12);
    expect(tipAlphaAt(3, 6, 0)).toBeCloseTo(0.5, 12);
    expect(tipAlphaAt(4, 6, 0)).toBeCloseTo(0.25, 12);
    expect(tipAlphaAt(5, 6, 0)).toBeCloseTo(0.5 * (1 + Math.cos((5 * Math.PI) / 6)), 12);
    expect(tipAlphaAt(2, 6, 0)).toBe(0.75);
  });

  it('joins the hard core with matching slope, so the core boundary leaves no ring', () => {
    // A linear ramp would still be 1 at the boundary but would step away from it. The
    // cosine-squared derivative is 0 there, so the value just past the core is still
    // almost exactly 1 and the profile never falls faster than it arrives.
    expect(tipAlphaAt(5, 10, 50)).toBe(1);
    expect(tipAlphaAt(5.001, 10, 50)).toBeCloseTo(1, 5);
    expect(tipAlphaAt(5.01, 10, 50)).toBeCloseTo(1, 4);

    let previous = tipAlphaAt(5, 10, 50);
    for (let distance = 5.05; distance <= 10; distance += 0.05) {
      const current = tipAlphaAt(distance, 10, 50);
      expect(current).toBeLessThanOrEqual(previous);
      previous = current;
    }
  });

  it('reaches zero with zero slope at the outer radius, so the rim is not a 1px step', () => {
    expect(tipAlphaAt(9.99, 10, 50)).toBeLessThan(0.0001);
    expect(tipAlphaAt(9.5, 10, 50)).toBeCloseTo(0.5 * (1 + Math.cos((4.5 * Math.PI) / 5)), 12);
  });

  it('is 0 at and beyond the outer radius, for every hardness', () => {
    for (const hardness of [0, 25, 50, 100]) {
      expect(tipAlphaAt(6, 6, hardness)).toBe(0);
      expect(tipAlphaAt(6.001, 6, hardness)).toBe(0);
      expect(tipAlphaAt(600, 6, hardness)).toBe(0);
    }
  });

  it('is 0 for a tip with no radius, rather than dividing by a zero falloff band', () => {
    expect(tipAlphaAt(0, 0, 100)).toBe(0);
    expect(tipAlphaAt(0, -5, 0)).toBe(0);
  });

  it('clamps an out-of-range or non-finite hardness instead of reading it raw', () => {
    expect(tipAlphaAt(3, 6, 250)).toBe(tipAlphaAt(3, 6, 100));
    expect(tipAlphaAt(3, 6, -40)).toBe(tipAlphaAt(3, 6, 0));
    expect(tipAlphaAt(3, 6, Number.NaN)).toBe(tipAlphaAt(3, 6, BRUSH_HARDNESS_DEFAULT));
  });

  it('returns 0 for a zero-radius tip at every offset, so a degenerate tip stamps nothing', () => {
    for (const hardness of [BRUSH_HARDNESS_MIN, 0, 50, 100, BRUSH_HARDNESS_MAX]) {
      expect(tipAlphaAt(0, 0, hardness)).toBe(0);
      expect(tipAlphaAt(1, 0, hardness)).toBe(0);
      expect(tipAlphaAt(0, -6, hardness)).toBe(0);
    }
  });

  it('treats the hardness boundaries 0 and 100 exactly as clamping does, so a preview cannot disagree with a stamp', () => {
    expect(tipAlphaAt(2, 6, BRUSH_HARDNESS_MIN)).toBe(
      tipAlphaAt(2, 6, clampBrushTipSettings({ hardness: 0 }).hardness)
    );
    expect(tipAlphaAt(2, 6, BRUSH_HARDNESS_MAX)).toBe(
      tipAlphaAt(2, 6, clampBrushTipSettings({ hardness: 100 }).hardness)
    );
    // Hardness 0 has no core: the whole radius is falloff, but the centre is still full.
    expect(tipAlphaAt(0, 6, BRUSH_HARDNESS_MIN)).toBe(1);
    // Hardness 100 is flat 1 across the whole radius, then 0 on the half-open rim.
    expect(tipAlphaAt(5.999, 6, BRUSH_HARDNESS_MAX)).toBe(1);
    expect(tipAlphaAt(6, 6, BRUSH_HARDNESS_MAX)).toBe(0);
  });

  it('is non-decreasing in hardness for a fixed in-range distance, so a soft-to-hard sweep never dips coverage', () => {
    const radius = 6;
    for (const distance of [0, 0.5, 1, 2, 3, 4, 5, 5.999]) {
      let previous = -Infinity;
      for (let hardness = 0; hardness <= BRUSH_HARDNESS_MAX; hardness += 0.5) {
        const current = tipAlphaAt(distance, radius, hardness);
        // Allow a hair of float noise where the cosine plateau meets the flat core, but
        // never let the weight step backwards as the brush hardens.
        expect(current).toBeGreaterThanOrEqual(previous - 1e-9);
        previous = current;
      }
    }
  });

  it('clamps an out-of-range hardness that is also non-finite, never reading it raw', () => {
    // A non-finite hardness is `unset` and falls back to the Photoshop default (100),
    // matching `clampSlider`'s fallback arm — distinct from a finite negative value, which
    // clamps into range at 0.
    expect(tipAlphaAt(3, 6, Number.POSITIVE_INFINITY)).toBe(tipAlphaAt(3, 6, BRUSH_HARDNESS_DEFAULT));
    expect(tipAlphaAt(3, 6, Number.NEGATIVE_INFINITY)).toBe(tipAlphaAt(3, 6, BRUSH_HARDNESS_DEFAULT));
    expect(tipAlphaAt(3, 6, Number.NaN)).toBe(tipAlphaAt(3, 6, BRUSH_HARDNESS_DEFAULT));
  });
});

describe('brushDabCenters', () => {
  it('yields nothing for an empty polyline', () => {
    expect(brushDabCenters([], 20, 25)).toEqual([]);
  });

  it('yields exactly one dab for a single point, which is a click', () => {
    expect(brushDabCenters([{ x: 3, y: 4 }], 20, 25)).toEqual([{ x: 3, y: 4 }]);
  });

  it('emits one dab per spacing of arc length along a straight line', () => {
    // 100px of travel at 25% of a 20px tip is a 5px step, so 21 dabs inclusive.
    const centers = brushDabCenters(samples(2, 100), 20, 25);

    expect(centers).toHaveLength(21);
    expect(centers[0]).toEqual({ x: 0, y: 0 });
    expect(centers[20]).toEqual({ x: 100, y: 0 });
    for (let index = 1; index < centers.length; index++) {
      expect(centers[index].x - centers[index - 1].x).toBeCloseTo(5, 9);
      expect(centers[index].y).toBe(0);
    }
  });

  it('can omit the moving endpoint while preserving fixed-spacing dab positions', () => {
    expect(
      brushDabCenters(
        [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
        ],
        16,
        25,
        false
      )
    ).toEqual([{ x: 0, y: 0 }]);
    expect(
      brushDabCenters(
        [
          { x: 0, y: 0 },
          { x: 5, y: 0 },
        ],
        16,
        25,
        false
      )
    ).toEqual([
      { x: 0, y: 0 },
      { x: 4, y: 0 },
    ]);
    expect(
      brushDabCenters(
        [
          { x: 0, y: 0 },
          { x: 5, y: 0 },
        ],
        16,
        25
      )
    ).toEqual([
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 5, y: 0 },
    ]);
  });

  it('counts by arc length, not by the number of samples the pointer emitted', () => {
    // The defect this rules out is density that depends on how fast the user moved: a
    // per-segment step puts a dab on every sample, so the same path stamps differently
    // depending on the pointer rate. Both of these are the same 100px path.
    const coarse = brushDabCenters(samples(2, 100), 20, 25);
    const dense = brushDabCenters(samples(11, 100), 20, 25);

    expect(dense).toEqual(coarse);
    expect(brushDabCenters(samples(101, 100), 20, 25)).toEqual(coarse);
  });

  it('scales the dab count with the length of the path, not with its shape', () => {
    expect(brushDabCenters(samples(2, 200), 20, 25)).toHaveLength(41);
    expect(brushDabCenters(samples(2, 50), 20, 25)).toHaveLength(11);
  });

  it('emits one dab per diameter of travel at spacing 100', () => {
    const centers = brushDabCenters(samples(2, 100), 20, 100);

    expect(centers).toHaveLength(6);
    expect(centers.map((center) => center.x)).toEqual([0, 20, 40, 60, 80, 100]);
  });

  it('carries the partial step across a corner instead of restarting it', () => {
    // 10px of travel per segment at a 10px step, so the corner cannot add or drop a dab.
    expect(
      brushDabCenters(
        [
          { x: 0, y: 0 },
          { x: 30, y: 0 },
          { x: 30, y: 17 },
        ],
        10,
        100
      )
    ).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 0 },
      { x: 30, y: 0 },
      { x: 30, y: 10 },
      { x: 30, y: 17 },
    ]);
  });

  it('always includes the last point, even when it is off the step grid', () => {
    const centers = brushDabCenters(
      [
        { x: 0, y: 0 },
        { x: 37, y: 11 },
      ],
      10,
      100
    );

    expect(centers[0]).toEqual({ x: 0, y: 0 });
    expect(centers[centers.length - 1]).toEqual({ x: 37, y: 11 });
  });

  it('does not emit a second dab for a last point the step grid already reached', () => {
    // The step lands exactly on the endpoint, and the stroke must not end twice over.
    expect(
      brushDabCenters(
        [
          { x: 0, y: 0 },
          { x: 20, y: 0 },
        ],
        20,
        100
      )
    ).toHaveLength(2);
  });

  it('skips a run of duplicate points, which carries no arc length', () => {
    expect(
      brushDabCenters(
        [
          { x: 5, y: 5 },
          { x: 5, y: 5 },
          { x: 5, y: 5 },
        ],
        20,
        25
      )
    ).toEqual([{ x: 5, y: 5 }]);
    expect(
      brushDabCenters(
        [
          { x: 0, y: 0 },
          { x: 0, y: 0 },
          { x: 40, y: 0 },
          { x: 40, y: 0 },
        ],
        10,
        25
      )
    ).toEqual(
      brushDabCenters(
        [
          { x: 0, y: 0 },
          { x: 40, y: 0 },
        ],
        10,
        25
      )
    );
  });

  it('clamps the spacing percent, so a zero step cannot loop on the first segment', () => {
    // 1% of a 20px tip is a 0.2px step, so 100px is 501 dabs rather than an infinite one.
    expect(brushDabCenters(samples(2, 100), 20, 0)).toHaveLength(501);
    expect(brushDabCenters(samples(2, 100), 20, 400)).toEqual(brushDabCenters(samples(2, 100), 20, 100));
  });

  it('falls back to the default tip size for a non-finite one', () => {
    // 13px at spacing 100 is a 13px step, so 100px of travel is 9 dabs inclusive.
    expect(brushDabCenters(samples(2, 100), Number.NaN, 100)).toHaveLength(9);
    expect(brushDabCenters(samples(2, 100), 0, 100)).toHaveLength(9);
    expect(brushDabCenters(samples(2, 100), Number.POSITIVE_INFINITY, 100)).toHaveLength(9);
  });

  it('returns fresh points rather than aliasing the polyline it walked', () => {
    const input: Point[] = [{ x: 1, y: 2 }];
    const centers = brushDabCenters(input, 20, 25);

    expect(centers[0]).not.toBe(input[0]);
    expect(centers[0]).toEqual(input[0]);
  });

  it('falls back to the default tip size for a negative size as well as a non-finite one', () => {
    expect(brushDabCenters(samples(2, 100), -1, 100)).toEqual(
      brushDabCenters(samples(2, 100), BRUSH_SIZE_DEFAULT, 100)
    );
    expect(brushDabCenters(samples(2, 100), -1, 100)).toHaveLength(9);
  });

  it('clamps a non-finite or out-of-range spacing percent into the stroked band', () => {
    // A non-finite `step` would turn the `while` walk into a never-terminating one;
    // NaN/Infinity must fall back to the default, not to a range end.
    expect(brushDabCenters(samples(2, 100), 20, Number.NaN)).toEqual(
      brushDabCenters(samples(2, 100), 20, BRUSH_SPACING_DEFAULT)
    );
    expect(brushDabCenters(samples(2, 100), 20, Number.POSITIVE_INFINITY)).toEqual(
      brushDabCenters(samples(2, 100), 20, BRUSH_SPACING_DEFAULT)
    );
    expect(brushDabCenters(samples(2, 100), 20, Number.NEGATIVE_INFINITY)).toEqual(
      brushDabCenters(samples(2, 100), 20, BRUSH_SPACING_DEFAULT)
    );
    expect(brushDabCenters(samples(2, 100), 20, -50)).toEqual(brushDabCenters(samples(2, 100), 20, BRUSH_SPACING_MIN));
  });

  it('keeps emitting the first and last sample for a degenerate-size stroke, so a click still lands a dab', () => {
    expect(brushDabCenters([{ x: 5, y: 5 }], 0, 25)).toEqual([{ x: 5, y: 5 }]);
    expect(brushDabCenters([{ x: 5, y: 5 }], Number.NaN, Number.NaN)).toEqual([{ x: 5, y: 5 }]);
  });
});

describe('appendBrushDabCenters', () => {
  it('matches one-shot sampling when a path arrives one pointer point at a time', () => {
    const paths: Point[][] = [
      [
        { x: 0, y: 0 },
        { x: 37, y: 0 },
        { x: 100, y: 0 },
      ],
      [
        { x: 0, y: 0 },
        { x: 30, y: 0 },
        { x: 30, y: 17 },
      ],
      [
        { x: 5, y: 5 },
        { x: 5, y: 5 },
        { x: 7, y: 11 },
        { x: 13, y: 18 },
      ],
      [
        { x: 0.25, y: 3.5 },
        { x: 3.75, y: 2.25 },
        { x: 9.5, y: 8.125 },
      ],
    ];

    for (const points of paths) {
      const sampler = createBrushDabCenterSampler(16, 25);
      const incremental = points.flatMap((point, index) =>
        appendBrushDabCenters(sampler, [point], index === points.length - 1)
      );

      expect(incremental).toEqual(brushDabCenters(points, 16, 25));
    }
  });

  it('emits no historical centres again when later pointer points arrive', () => {
    const sampler = createBrushDabCenterSampler(16, 25);
    const first = appendBrushDabCenters(sampler, [{ x: 0, y: 0 }]);
    const second = appendBrushDabCenters(sampler, [{ x: 5, y: 0 }]);
    const third = appendBrushDabCenters(sampler, [{ x: 9, y: 0 }], true);

    expect(first).toEqual([{ x: 0, y: 0 }]);
    expect(second).toEqual([{ x: 4, y: 0 }]);
    expect(third).toEqual([
      { x: 8, y: 0 },
      { x: 9, y: 0 },
    ]);
  });

  it('ignores non-finite segment lengths rather than entering an unbounded spacing loop', () => {
    const sampler = createBrushDabCenterSampler(1, 1);

    expect(appendBrushDabCenters(sampler, [{ x: 0, y: 0 }])).toEqual([{ x: 0, y: 0 }]);
    expect(appendBrushDabCenters(sampler, [{ x: Number.MAX_VALUE, y: Number.MAX_VALUE }])).toEqual([]);
  });
});

describe('stampBrushDab', () => {
  it('covers the pixels within the tip radius and no further', () => {
    const size = { width: 5, height: 5 };
    const data = filledBuffer(5, 5, { r: 0, g: 0, b: 0, a: 255 });

    // Radius 1.5 around (2, 2) is the 3x3 block around it — the diagonals sit at
    // sqrt(2) — and the ring at distance 2 is outside the tip and must stay black.
    stampBrushDab(data, size, { x: 2, y: 2 }, settings({ size: 3, hardness: 100 }), OPAQUE_RED);

    expect(countMatching(data, size, (pixel) => pixel.r === 255)).toBe(9);
    expect(at(data, 5, 2, 2)).toEqual(OPAQUE_RED);
    expect(at(data, 5, 1, 1)).toEqual(OPAQUE_RED);
    expect(at(data, 5, 2, 0)).toEqual({ r: 0, g: 0, b: 0, a: 255 });
    expect(at(data, 5, 0, 0)).toEqual({ r: 0, g: 0, b: 0, a: 255 });
  });

  it('clips at each of the four buffer edges without writing past them', () => {
    const size = { width: 4, height: 4 };
    const untouched = { r: 0, g: 0, b: 0, a: 255 };
    const corners: Point[] = [
      { x: 0, y: 0 },
      { x: 3, y: 0 },
      { x: 0, y: 3 },
      { x: 3, y: 3 },
    ];

    for (const corner of corners) {
      const data = filledBuffer(4, 4, untouched);
      stampBrushDab(data, size, corner, settings({ size: 3, hardness: 100 }), OPAQUE_RED);

      // A radius-1.5 tip at a corner covers the 2x2 block against that corner and
      // nothing else, so exactly 4 pixels are painted in each of the four cases. A write
      // that wrapped onto the far edge would make this 5 or more.
      expect(countMatching(data, size, (pixel) => pixel.r === 255)).toBe(4);
      expect(at(data, 4, corner.x, corner.y)).toEqual(OPAQUE_RED);
      expect(at(data, 4, 3 - corner.x, 3 - corner.y)).toEqual(untouched);
    }
  });

  it('stamps every pixel of a buffer smaller than the tip', () => {
    const size = { width: 2, height: 2 };

    const data = filledBuffer(2, 2, { r: 0, g: 0, b: 0, a: 255 });
    expect(() =>
      stampBrushDab(data, size, { x: 0.5, y: 0.5 }, settings({ size: 20, hardness: 100 }), OPAQUE_RED)
    ).not.toThrow();
    expect(countMatching(data, size, (pixel) => pixel.r === 255)).toBe(4);
  });

  it('narrows a declared size that is larger than the buffer it is handed', () => {
    // Addressing an 8x8 image with a 2x2 buffer would put row y in the wrong place rather
    // than out of range, so the declared size has to be narrowed to the real capacity.
    const data = filledBuffer(2, 2, { r: 0, g: 0, b: 0, a: 255 });

    expect(() =>
      stampBrushDab(data, { width: 8, height: 8 }, { x: 0.5, y: 0.5 }, settings({ size: 20 }), OPAQUE_RED)
    ).not.toThrow();
    expect(countMatching(data, { width: 2, height: 2 }, (pixel) => pixel.r === 255)).toBe(4);
  });

  it('is a no-op for a centre outside the buffer', () => {
    const data = filledBuffer(4, 4, { r: 0, g: 0, b: 0, a: 255 });
    const before = new Uint8ClampedArray(data);

    expect(() =>
      stampBrushDab(data, { width: 4, height: 4 }, { x: 100, y: 100 }, settings(), OPAQUE_RED)
    ).not.toThrow();
    stampBrushDab(data, { width: 4, height: 4 }, { x: -10, y: -10 }, settings(), OPAQUE_RED);
    stampBrushDab(data, { width: 4, height: 4 }, { x: Number.NaN, y: 0 }, settings(), OPAQUE_RED);

    expect(Array.from(data)).toEqual(Array.from(before));
  });

  it('stamps the part of a tip that reaches in from outside one edge', () => {
    const data = filledBuffer(4, 4, { r: 0, g: 0, b: 0, a: 255 });

    // Radius 1.5 around (-1, 1) reaches x = 0 only, so the left column is painted for
    // y = 0..2 and the rest of the buffer is left alone.
    stampBrushDab(data, { width: 4, height: 4 }, { x: -1, y: 1 }, settings({ size: 3 }), OPAQUE_RED);

    expect(at(data, 4, 0, 0)).toEqual(OPAQUE_RED);
    expect(at(data, 4, 0, 1)).toEqual(OPAQUE_RED);
    expect(at(data, 4, 0, 2)).toEqual(OPAQUE_RED);
    expect(at(data, 4, 0, 3)).toEqual({ r: 0, g: 0, b: 0, a: 255 });
    expect(at(data, 4, 1, 1)).toEqual({ r: 0, g: 0, b: 0, a: 255 });
  });

  it('composites over the existing pixel rather than replacing it', () => {
    const data = filledBuffer(4, 4, { r: 8, g: 16, b: 32, a: 255 });

    // Hand-computed source-over in straight alpha, from `blendPixel` in
    // `src/util/pixels.ts`, with an effective coverage of 1 * opacity 0.25:
    //   ao = 0.25 + 1 * 0.75                = 1        -> a = 255
    //   r  = (255 * 0.25 + 8 * 1 * 0.75)    = 69.75    -> 70
    //   g  = (0 * 0.25 + 16 * 1 * 0.75)     = 12       -> 12
    //   b  = (0 * 0.25 + 32 * 1 * 0.75)     = 24       -> 24
    stampBrushDab(data, { width: 4, height: 4 }, { x: 1, y: 1 }, settings({ size: 2, opacity: 0.25 }), OPAQUE_RED);

    expect(at(data, 4, 1, 1)).toEqual({ r: 70, g: 12, b: 24, a: 255 });
    // The neighbours are outside a radius-1 tip centred on (1, 1), so they must survive.
    expect(at(data, 4, 2, 1)).toEqual({ r: 8, g: 16, b: 32, a: 255 });
    expect(at(data, 4, 0, 1)).toEqual({ r: 8, g: 16, b: 32, a: 255 });
  });

  it('scales the composite by the tip falloff, not by the colour', () => {
    const data = filledBuffer(13, 13, TRANSPARENT_BLACK);

    // A single dab of radius 6 at (6, 6) on an empty buffer: the coverage rides in as
    // the blend's alpha, so the colour stays 255 and only `a` carries the falloff.
    stampBrushDab(data, { width: 13, height: 13 }, { x: 6, y: 6 }, settings({ size: 12, hardness: 0 }), OPAQUE_WHITE);

    expect(at(data, 13, 6, 6)).toEqual({ r: 255, g: 255, b: 255, a: 255 });
    expect(at(data, 13, 6, 5)).toEqual({ r: 255, g: 255, b: 255, a: 238 });
    expect(at(data, 13, 6, 4)).toEqual({ r: 255, g: 255, b: 255, a: 191 });
    expect(at(data, 13, 6, 3)).toEqual({ r: 255, g: 255, b: 255, a: 128 });
    expect(at(data, 13, 6, 0)).toEqual(TRANSPARENT_BLACK);
    expect(at(data, 13, 0, 0)).toEqual(TRANSPARENT_BLACK);
  });

  it('stamps nothing at opacity 0, or for a fully transparent colour', () => {
    const data = filledBuffer(4, 4, { r: 8, g: 16, b: 32, a: 255 });
    const before = Array.from(data);

    stampBrushDab(data, { width: 4, height: 4 }, { x: 1, y: 1 }, settings({ opacity: 0 }), OPAQUE_RED);
    stampBrushDab(data, { width: 4, height: 4 }, { x: 1, y: 1 }, settings(), TRANSPARENT_BLACK);

    expect(Array.from(data)).toEqual(before);
  });

  it('does not mutate the settings it is handed', () => {
    const input = { size: 900, hardness: 400, opacity: 2, spacing: 0 } as BrushTipSettings;
    const data = filledBuffer(4, 4, TRANSPARENT_BLACK);

    stampBrushDab(data, { width: 4, height: 4 }, { x: 1, y: 1 }, input, OPAQUE_RED);

    expect(input).toEqual({ size: 900, hardness: 400, opacity: 2, spacing: 0 });
  });

  it('clamps a non-finite or negative tip setting before stamping, matching the clamped default', () => {
    const size = { width: 13, height: 13 };
    const defaults = filledBuffer(13, 13, TRANSPARENT_BLACK);
    const bad = filledBuffer(13, 13, TRANSPARENT_BLACK);
    const badSettings: BrushTipSettings = {
      size: Number.NaN,
      hardness: Number.POSITIVE_INFINITY,
      opacity: Number.NEGATIVE_INFINITY,
      spacing: Number.NaN,
    };

    stampBrushDab(defaults, size, { x: 6, y: 6 }, clampBrushTipSettings({}), OPAQUE_WHITE);
    stampBrushDab(bad, size, { x: 6, y: 6 }, badSettings, OPAQUE_WHITE);

    expect(Array.from(defaults)).toEqual(Array.from(bad));
  });

  it('stamps a single pixel for a zero-size tip, whose radius floors to 0.5px', () => {
    const data = filledBuffer(5, 5, TRANSPARENT_BLACK);

    stampBrushDab(data, { width: 5, height: 5 }, { x: 2, y: 2 }, settings({ size: 0 }), OPAQUE_RED);

    expect(countMatching(data, { width: 5, height: 5 }, (pixel) => pixel.a > 0)).toBe(1);
    expect(at(data, 5, 2, 2)).toEqual(OPAQUE_RED);
    expect(at(data, 5, 1, 2)).toEqual(TRANSPARENT_BLACK);
  });

  it('paints a full-radius disc at hardness 100 and a cosine gradient at hardness 0', () => {
    const size = { width: 5, height: 5 };
    const hard = filledBuffer(5, 5, TRANSPARENT_BLACK);
    const soft = filledBuffer(5, 5, TRANSPARENT_BLACK);

    // Radius 2 around (2, 2): nine pixels sit at distance < 2, the rim at distance 2 is
    // outside the half-open tip for both hardness values.
    stampBrushDab(hard, size, { x: 2, y: 2 }, settings({ size: 4, hardness: 100 }), OPAQUE_WHITE);
    stampBrushDab(soft, size, { x: 2, y: 2 }, settings({ size: 4, hardness: 0 }), OPAQUE_WHITE);

    expect(countMatching(hard, size, (pixel) => pixel.a === 255)).toBe(9);
    expect(at(hard, 5, 2, 2)).toEqual({ r: 255, g: 255, b: 255, a: 255 });
    expect(at(hard, 5, 0, 2)).toEqual(TRANSPARENT_BLACK);

    expect(at(soft, 5, 2, 2).a).toBe(255);
    expect(at(soft, 5, 2, 1).a).toBeLessThan(255);
    expect(at(soft, 5, 2, 1).a).toBeGreaterThan(0);
    expect(at(soft, 5, 0, 2)).toEqual(TRANSPARENT_BLACK);
  });

  it('stamps nothing for a negative opacity, which clamps to fully transparent', () => {
    const data = filledBuffer(3, 3, TRANSPARENT_BLACK);
    const before = Array.from(data);

    stampBrushDab(data, { width: 3, height: 3 }, { x: 1, y: 1 }, settings({ opacity: -1 }), OPAQUE_RED);

    expect(Array.from(data)).toEqual(before);
  });
});

describe('stampBrushStroke', () => {
  it('lays down exactly one dab for a single-point stroke, which a path stroke would drop', () => {
    const data = filledBuffer(5, 5, TRANSPARENT_BLACK);
    const dabSettings = settings({ size: 4, opacity: 0.25 });

    stampBrushStroke(data, { width: 5, height: 5 }, [{ x: 2, y: 2 }], dabSettings, OPAQUE_WHITE);

    // Radius 2 around (2, 2) is the 3x3 block around it, and each pixel takes a single
    // 0.25 coverage over transparent black, so every one of them is 255 at a = 63.75.
    const painted = countMatching(data, { width: 5, height: 5 }, (pixel) => pixel.a > 0);
    expect(painted).toBe(9);
    expect(at(data, 5, 2, 2)).toEqual({ r: 255, g: 255, b: 255, a: 64 });
    expect(at(data, 5, 1, 1)).toEqual({ r: 255, g: 255, b: 255, a: 64 });
    expect(at(data, 5, 0, 0)).toEqual(TRANSPARENT_BLACK);
  });

  it('leaves the buffer alone for an empty polyline', () => {
    const data = filledBuffer(4, 4, { r: 8, g: 16, b: 32, a: 255 });
    const before = Array.from(data);

    stampBrushStroke(data, { width: 4, height: 4 }, [], settings(), OPAQUE_RED);

    expect(Array.from(data)).toEqual(before);
  });

  it('builds up more opacity at a tighter spacing, which is what Spacing is for', () => {
    // An 8px tip at 25% opacity is one 0.25 coverage per dab over a transparent buffer.
    // At 75% spacing the dabs are 6px apart, so (7, 2) is 3px from two of them and takes
    // 2 dabs; at 25% they are 2px apart, so it is 1px from two and 3px from two more, and
    // takes 4. Each 0.25 coverage is Porter-Duff `source-over` onto the previous result, so
    // the alphas are 0.25, 0.438, 0.579, 0.685 of 255: 64, 112, 148, 175.
    //
    // Spacing 100% is deliberately not the loose end of this comparison: its dabs are a
    // full diameter apart, so their shared boundary pixel sits at exactly `radius` and
    // neither covers it. A 100%-spaced stroke double-stamps nowhere, which is the point.
    const loose = filledBuffer(25, 9, TRANSPARENT_BLACK);
    const tight = filledBuffer(25, 9, TRANSPARENT_BLACK);
    const stroke: Point[] = [
      { x: 4, y: 2 },
      { x: 20, y: 2 },
    ];

    stampBrushStroke(
      loose,
      { width: 25, height: 9 },
      stroke,
      settings({ size: 8, spacing: 75, opacity: 0.25 }),
      OPAQUE_WHITE
    );
    stampBrushStroke(
      tight,
      { width: 25, height: 9 },
      stroke,
      settings({ size: 8, spacing: 25, opacity: 0.25 }),
      OPAQUE_WHITE
    );

    expect(at(loose, 25, 7, 2).a).toBe(112);
    expect(at(tight, 25, 7, 2).a).toBe(175);
    expect(at(tight, 25, 7, 2).a).toBeGreaterThan(at(loose, 25, 7, 2).a);
  });

  it('stamps a hard edge as a step and a soft edge as a gradient, for the same stroke', () => {
    const hard = filledBuffer(13, 13, TRANSPARENT_BLACK);
    const soft = filledBuffer(13, 13, TRANSPARENT_BLACK);
    const click: Point[] = [{ x: 6, y: 6 }];

    stampBrushStroke(hard, { width: 13, height: 13 }, click, settings({ size: 12, hardness: 100 }), OPAQUE_WHITE);
    stampBrushStroke(soft, { width: 13, height: 13 }, click, settings({ size: 12, hardness: 0 }), OPAQUE_WHITE);

    // Hardness 100 paints a full-radius disc, so the column out from the centre is one
    // flat plateau and then nothing — the step a Photoshop hard round brush has. The
    // pixel at distance 6 is outside it, which is the step.
    for (const y of [6, 5, 4, 3, 2, 1]) expect(at(hard, 13, 6, y)).toEqual({ r: 255, g: 255, b: 255, a: 255 });
    expect(at(hard, 13, 6, 0)).toEqual(TRANSPARENT_BLACK);

    // The same stroke at hardness 0 has no core, so that same column is the curve.
    expect(at(soft, 13, 6, 6)).toEqual({ r: 255, g: 255, b: 255, a: 255 });
    expect(at(soft, 13, 6, 5).a).toBe(238);
    expect(at(soft, 13, 6, 4).a).toBe(191);
    expect(at(soft, 13, 6, 3).a).toBe(128);
    expect(at(soft, 13, 6, 2).a).toBe(64);
    expect(at(soft, 13, 6, 1).a).toBe(17);
    expect(at(soft, 13, 6, 0)).toEqual(TRANSPARENT_BLACK);

    // The diagonal is the clearest read: a hard tip paints it solid, a soft one grazes it.
    expect(at(hard, 13, 3, 3)).toEqual({ r: 255, g: 255, b: 255, a: 255 });
    expect(at(soft, 13, 3, 3).a).toBe(50);
    expect(at(soft, 13, 3, 3).a).toBeLessThan(at(soft, 13, 4, 4).a);
  });

  it('produces the same buffer as stamping its own centres one at a time', () => {
    const stroke = [
      { x: 4, y: 7 },
      { x: 22, y: 9 },
      { x: 31, y: 2 },
    ];
    const tip = settings({ size: 6, hardness: 40, opacity: 0.6, spacing: 30 });

    const whole = filledBuffer(40, 24, TRANSPARENT_BLACK);
    stampBrushStroke(whole, { width: 40, height: 24 }, stroke, tip, OPAQUE_RED);

    const dabByDab = filledBuffer(40, 24, TRANSPARENT_BLACK);
    for (const center of brushDabCenters(stroke, tip.size, tip.spacing)) {
      stampBrushDab(dabByDab, { width: 40, height: 24 }, center, tip, OPAQUE_RED);
    }

    expect(brushDabCenters(stroke, tip.size, tip.spacing).length).toBeGreaterThan(5);
    expect(Array.from(whole)).toEqual(Array.from(dabByDab));
  });

  it('does not mutate the settings or the polyline it is handed', () => {
    const points: Point[] = [
      { x: 1, y: 1 },
      { x: 9, y: 9 },
    ];
    const input = { size: 900, hardness: -10, opacity: 3, spacing: 250 } as BrushTipSettings;

    stampBrushStroke(filledBuffer(12, 12, TRANSPARENT_BLACK), { width: 12, height: 12 }, points, input, OPAQUE_RED);

    expect(input).toEqual({ size: 900, hardness: -10, opacity: 3, spacing: 250 });
    expect(points).toEqual([
      { x: 1, y: 1 },
      { x: 9, y: 9 },
    ]);
  });

  it('clamps a non-finite or negative tip setting before stamping, matching the clamped default', () => {
    const size = { width: 13, height: 13 };
    const click = [{ x: 6, y: 6 }];
    const badSettings: BrushTipSettings = {
      size: Number.NaN,
      hardness: Number.POSITIVE_INFINITY,
      opacity: Number.NEGATIVE_INFINITY,
      spacing: Number.NaN,
    };

    const normal = filledBuffer(13, 13, TRANSPARENT_BLACK);
    const bad = filledBuffer(13, 13, TRANSPARENT_BLACK);
    stampBrushStroke(normal, size, click, clampBrushTipSettings({}), OPAQUE_WHITE);
    stampBrushStroke(bad, size, click, badSettings, OPAQUE_WHITE);

    expect(Array.from(normal)).toEqual(Array.from(bad));
  });

  it('stamps a single pixel for a zero-size tip, whose radius floors to 0.5px', () => {
    const data = filledBuffer(5, 5, TRANSPARENT_BLACK);

    stampBrushStroke(data, { width: 5, height: 5 }, [{ x: 2, y: 2 }], settings({ size: 0 }), OPAQUE_RED);

    expect(countMatching(data, { width: 5, height: 5 }, (pixel) => pixel.a > 0)).toBe(1);
    expect(at(data, 5, 2, 2)).toEqual(OPAQUE_RED);
  });

  it('leaves the buffer untouched for a stroke whose opacity clamps to 0', () => {
    const data = filledBuffer(4, 4, { r: 8, g: 16, b: 32, a: 255 });
    const before = Array.from(data);

    stampBrushStroke(data, { width: 4, height: 4 }, samples(2, 30), settings({ opacity: -1 }), OPAQUE_RED);

    expect(Array.from(data)).toEqual(before);
  });
});

describe('fail-closed tripwires (known gaps this hardens)', () => {
  // Each block below asserts the behaviour we WANT from a missing input guard. It is
  // wrapped in `it.fails` so it stays green while the gap is open; the moment the guard
  // lands and the assertion starts passing, `it.fails` flips and the tripwire reports an
  // unexpected pass, which is the signal to delete it. They are grouped so they are found
  // and retired together rather than left to accumulate as silent green.
  it.fails('returns 0 for a non-finite distance instead of reading NaN/Infinity into the coverage', () => {
    // -Infinity currently slips past `distance < radius` and falls inside the core, reading
    // as 1 coverage; NaN and +Infinity are already 0. Once distance is guarded, all three
    // must be 0 and this tripwire turns red.
    expect(tipAlphaAt(Number.NaN, 6, 50)).toBe(0);
    expect(tipAlphaAt(Number.POSITIVE_INFINITY, 6, 50)).toBe(0);
    expect(tipAlphaAt(Number.NEGATIVE_INFINITY, 6, 50)).toBe(0);
  });

  it.fails('returns 0 for a non-finite radius instead of covering the whole plane', () => {
    // An infinite radius currently makes every distance `<= core`, so a +Infinity radius
    // stamps full coverage everywhere. NaN and -Infinity are already 0; guarding radius
    // to `> 0` will make +Infinity 0 too and flip this to an unexpected pass.
    expect(tipAlphaAt(3, Number.NaN, 50)).toBe(0);
    expect(tipAlphaAt(3, Number.POSITIVE_INFINITY, 50)).toBe(0);
    expect(tipAlphaAt(3, Number.NEGATIVE_INFINITY, 50)).toBe(0);
  });
});
