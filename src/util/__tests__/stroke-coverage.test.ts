import { describe, expect, it } from 'vitest';

import { buildStrokeCoverage } from '../stroke-coverage.ts';
import {
  BRUSH_HARDNESS_MAX,
  BRUSH_HARDNESS_MIN,
  brushDabCenters,
  tipAlphaAt,
  type BrushTipSettings,
} from '../brush-engine.ts';
import type { Point, Size } from '../../contexts/general-types.ts';

/**
 * `spacing` is pinned to the engine's own default because the dab COUNT is derived from it
 * and every "how many dabs did this produce" statement in this file depends on it. The
 * clamp in `brushDabCenters` would substitute it anyway for a non-finite value, so naming
 * it here costs nothing and makes the arithmetic below legible: step = size * 25 / 100.
 */
const SPACING = 25;

const tip = (size: number, hardness: number): BrushTipSettings => ({
  size,
  hardness,
  opacity: 1,
  spacing: SPACING,
});

const point = (x: number, y: number): Point => ({ x, y });

/**
 * `buildStrokeCoverage` stores into a `Float32Array`, so a value read back is the
 * round-to-nearest float32 of what was written. `Math.fround` is that same rounding, which
 * is what lets every weight here be asserted with `toBe` instead of a tolerance — and a
 * tolerance is what would let a union quietly become a sum and still pass.
 */
const stored = (value: number): number => Math.fround(value);

const cover = (size: Size, points: Point[], settings: BrushTipSettings): Float32Array => {
  const coverage = buildStrokeCoverage(size, points, settings);
  if (coverage === null) throw new Error('buildStrokeCoverage returned null; this test expected a field');
  return coverage;
};

describe('buildStrokeCoverage', () => {
  it('returns null for an empty point list', () => {
    // A click is one point and a stroke is two or more; zero points is no stroke at all,
    // and a zero-filled field would be indistinguishable from a stroke that painted nothing.
    expect(buildStrokeCoverage({ width: 16, height: 16 }, [], tip(8, 100))).toBeNull();
  });

  it('returns null for a zero-width or zero-height size', () => {
    const points = [point(0, 0)];
    expect(buildStrokeCoverage({ width: 0, height: 16 }, points, tip(8, 100))).toBeNull();
    expect(buildStrokeCoverage({ width: 16, height: 0 }, points, tip(8, 100))).toBeNull();
    expect(buildStrokeCoverage({ width: 0, height: 0 }, points, tip(8, 100))).toBeNull();
  });

  it('returns null for a stroke that lands nowhere on the canvas', () => {
    // The dab's bounding box clips to an empty span, so no pixel is ever visited and the
    // `touched` flag never rises. This is the arm that keeps a pointer released off-canvas
    // from committing an all-zero raster. A 1px tip (radius 0.5) is what makes "one pixel
    // off the left edge" a genuine miss: its box spans x in [-1.5, -0.5] and clips to
    // [0, -1], which is empty.
    for (const outside of [point(-40, -40), point(-1, 4), point(4, -1), point(7, 8), point(400, 400)]) {
      expect(
        buildStrokeCoverage({ width: 8, height: 8 }, [outside], tip(1, 100)),
        `${outside.x},${outside.y}`
      ).toBeNull();
    }
  });

  /**
   * The union pin, with every number derivable by hand.
   *
   * Two dabs, one at `(8, 8)` and one at `(12, 8)`, on a 16x16 canvas with a 16px tip at
   * hardness 0 (radius 8, no core). The polyline is exactly 4px long and the step is
   * `16 * 25 / 100 = 4`, so `brushDabCenters` emits exactly those two centres and nothing
   * in between.
   *
   * Pixel `(10, 8)` is 2px from BOTH centres, so both dabs hand it the same weight:
   *
   * ```
   *   tipAlphaAt(2, 8, 0) = 0.5 * (1 + cos(pi * 2 / 8)) = 0.8535533905932737
   * ```
   *
   * Unioning stores `0.8535534`; summing would store `1.7071068`, which is the weight of
   * a pixel the brush touched twice and which no single dab could ever produce.
   */
  it('unions two overlapping dabs on one pixel instead of summing them', () => {
    const size: Size = { width: 16, height: 16 };
    const coverage = cover(size, [point(8, 8), point(12, 8)], tip(16, 0));

    const perDab = stored(tipAlphaAt(2, 8, 0));
    const summed = stored(tipAlphaAt(2, 8, 0) * 2);

    expect(coverage[8 * 16 + 10]).toBe(perDab);
    expect(coverage[8 * 16 + 10]).not.toBe(summed);
    // Explicitly: the union is the LARGER of two equal weights, and a sum would exceed it.
    expect(coverage[8 * 16 + 10]).toBeLessThan(summed);

    // And the union is the MAX, not the LAST: at (8, 8) the first dab contributes
    // `tipAlphaAt(0, 8, 0) = 1` and the second contributes `tipAlphaAt(4, 8, 0) = 0.8535534`,
    // and the field keeps the FIRST because it is the larger. A last-dab-wins field would
    // report 0.8535534 here while still reporting the right number at (10, 8).
    expect(coverage[8 * 16 + 8]).toBe(1);
    expect(coverage[8 * 16 + 8]).not.toBe(stored(tipAlphaAt(4, 8, 0)));
    // The mirror pixel, where the later dab is the larger one.
    expect(coverage[8 * 16 + 12]).toBe(1);
  });

  it('gives a pixel shared by two dabs the same field a single one of them would', () => {
    // The same union stated as an invariance rather than as a number: repeating a dab does
    // not change the field, which is what makes a commit idempotent under the registry's
    // replay. A sum breaks this on every pixel the repeated dab touches.
    //
    // The polyline walks 8 -> 12 -> 12 -> 8 on a 4px step, so `brushDabCenters` emits
    // (8, 8), (12, 8), (8, 8): the third dab lands exactly on the first, at the same
    // coordinates, and contributes nothing the first had not already saturated.
    const size: Size = { width: 16, height: 16 };
    const once = cover(size, [point(8, 8), point(12, 8)], tip(16, 0));
    const resampled = cover(size, [point(8, 8), point(12, 8), point(12, 8), point(8, 8)], tip(16, 0));

    expect(Array.from(resampled)).toEqual(Array.from(once));
    expect(resampled[8 * 16 + 10]).toBe(stored(tipAlphaAt(2, 8, 0)));
  });

  it("leaves a pixel outside every dab's bounding box at exactly 0", () => {
    // (15, 15) is sqrt(7^2 + 7^2) = 9.8995 from the only dab at (8, 8) against a radius of
    // 8, and `tipAlphaAt` returns 0 for `distance >= radius` at EVERY hardness, so the field
    // entry is a real zero rather than an untouched zero. (0, 0) is 11.3137 away, likewise.
    const size: Size = { width: 16, height: 16 };
    const coverage = cover(size, [point(8, 8)], tip(16, 0));

    expect(coverage[15 * 16 + 15]).toBe(0);
    expect(coverage[0 * 16 + 0]).toBe(0);
    // (15, 0) is sqrt(7^2 + 8^2) = 10.630 away, so this is outside the dab's square bounding
    // box on BOTH axes rather than outside the disc inside it.
    expect(coverage[0 * 16 + 15]).toBe(0);
  });

  it('is a Float32Array of width * height entries, indexed y * width + x', () => {
    // A non-square canvas is what makes the indexing observable: a 1px-radius-less 2px tip
    // at (1, 2) covers exactly one pixel, and on a 6x4 size the row-major index of (1, 2) is
    // `2 * 6 + 1 = 13` while a transposed `x * height + y` would read 6.
    const size: Size = { width: 6, height: 4 };
    const coverage = cover(size, [point(1, 2)], tip(2, 100));

    expect(coverage).toBeInstanceOf(Float32Array);
    expect(coverage.length).toBe(size.width * size.height);
    expect(coverage[2 * 6 + 1]).toBe(1);
    expect(coverage[6]).toBe(0);
    expect(coverage[1 * 6 + 1]).toBe(0);
  });

  it('covers the whole buffer extent of a size whose product is the field length', () => {
    const size: Size = { width: 5, height: 3 };
    const coverage = cover(size, [point(2, 1)], tip(4, 100));

    expect(coverage.length).toBe(15);
    // (2, 1) is inside the hard core of a 4px tip (radius 2, core 2 at hardness 100), and
    // (4, 2) is at distance sqrt(4 + 1) = 2.236 from it, past the half-open rim.
    expect(coverage[1 * 5 + 2]).toBe(1);
    expect(coverage[2 * 5 + 4]).toBe(0);
  });

  it('is deterministic, so the same path and tip produce the same field twice', () => {
    // `requiresRaster: true` replay re-renders the commit from its args, so a field that
    // depended on iteration order or on a shared accumulator would drift between the live
    // commit and the replayed one.
    const size: Size = { width: 32, height: 32 };
    const points = [point(4, 4), point(20, 6), point(28, 24)];
    const settings = tip(12, 40);

    expect(Array.from(cover(size, points, settings))).toEqual(Array.from(cover(size, points, settings)));
  });

  /**
   * The hardness direction, read off `tipAlphaAt`'s own code rather than off its prose.
   *
   * ```
   *   if (!(radius > 0) || !(distance < radius)) return 0;   // the half-open rim
   *   const core = radius * (hardness / 100);
   *   if (distance <= core) return 1;                       // the flat core
   * ```
   *
   * At `hardness = 100` the core is the whole radius, so the rim guard has already rejected
   * every `distance >= radius` and the core test then accepts everything left: the flat
   * region is everything STRICTLY INSIDE the tip, and every entry it writes is exactly 1.
   *
   * At `hardness = 0` the core is 0, and `distance <= 0` is true only for the centre itself,
   * so exactly ONE pixel can be exactly 1. Note this is not "no pixel": the centre still is
   * 1, because a dab's own centre has no falloff to cross.
   */
  it('paints a flat core at hardness 100 and only the centre at hardness 0', () => {
    const size: Size = { width: 24, height: 24 };
    const centre = point(12, 12);
    const settings = tip(16, BRUSH_HARDNESS_MAX);
    const soft = tip(16, BRUSH_HARDNESS_MIN);

    const hard = cover(size, [centre], settings);
    const softField = cover(size, [centre], soft);

    const countOf = (coverage: Float32Array): number =>
      coverage.reduce((total, value) => total + (value === 1 ? 1 : 0), 0);

    // 193 = the lattice points with dx^2 + dy^2 < 64 for dx, dy in -12..12.
    expect(countOf(hard)).toBe(193);
    expect(countOf(softField)).toBe(1);

    // And the two fields are genuinely different, so neither count is vacuous.
    expect(Array.from(hard)).not.toEqual(Array.from(softField));
    // A hard tip's rim pixel sits at exactly the radius, which the half-open guard excludes:
    // (4, 12) is 8 from (12, 12) and is therefore 0 under hardness 100, not 1.
    expect(hard[12 * 24 + 4]).toBe(0);
    expect(hard[12 * 24 + 5]).toBe(1);
  });

  it('returns null for a ZERO-radius tip, because no dab can carry weight', () => {
    // Two things have to hold at once here, and only the second is obvious. `brushDabCenters`
    // is given size 0, substitutes BRUSH_SIZE_DEFAULT for the STEP and so emits several
    // centres; `radius` is then computed from the RAW `settings.size`, not from that
    // fallback. `tipAlphaAt` returns 0 for a non-positive radius at any distance, so no pixel
    // is ever written and `touched` never rises.
    //
    // The mutants: radius taken from the clamped diameter (a 13px field would appear where
    // there should be none), and the `if (!(weight > 0)) return;` guard deleted (every pixel
    // would set `touched`, and the null would become an all-zero Float32Array — a field
    // indistinguishable from a stroke that painted nothing, which is the exact reason the
    // null exists).
    const size: Size = { width: 16, height: 16 };
    const zeroTip = tip(0, 100);

    expect(brushDabCenters([point(4, 4), point(12, 8)], zeroTip.size, zeroTip.spacing).length).toBeGreaterThan(1);
    expect(buildStrokeCoverage(size, [point(4, 4), point(12, 8)], zeroTip)).toBeNull();
    expect(buildStrokeCoverage(size, [point(8, 8)], zeroTip)).toBeNull();
  });

  it('returns null for a NEGATIVE tip size, which is the same arm from the other side', () => {
    // `brushDabCenters` also refuses a negative diameter (`size > 0` is required), so the
    // centres exist, but the radius is negative and every weight is 0.
    expect(buildStrokeCoverage({ width: 16, height: 16 }, [point(4, 4), point(12, 8)], tip(-8, 100))).toBeNull();
  });

  it('walks the interior of a segment, so a stroke is not just its two endpoints', () => {
    // Step 4px on a 4px segment, tip radius 0.5 at hardness 100: row 2 from x = 2 to x = 6 is
    // covered and nothing past either end, which is the `ctx.stroke()` over a zero-length
    // path this whole module exists to replace.
    const size: Size = { width: 16, height: 16 };
    const coverage = cover(size, [point(2, 2), point(6, 2)], tip(1, 100));

    const covered: string[] = [];
    for (let y = 0; y < size.height; y++) {
      for (let x = 0; x < size.width; x++) if (coverage[y * size.width + x] > 0) covered.push(`${x},${y}`);
    }
    expect(covered).toEqual(['2,2', '3,2', '4,2', '5,2', '6,2']);
  });
});
