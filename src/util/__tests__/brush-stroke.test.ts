import { describe, expect, it } from 'vitest';
import { createStrokeBuffer } from '../brush-stroke.ts';
import { buildBlendLut, isBlendLut, normalBlend, resolveBlend } from '../brush-types.ts';
import type { Blend, Rgb, Rect } from '../brush-types.ts';

const WHITE: Rgb = { r: 255, g: 255, b: 255 };
const RED: Rgb = { r: 255, g: 0, b: 0 };
const RECT: Rect = { x: 0, y: 0, width: 8, height: 8 };

const flatBackdrop = (value: number, alpha = 255): Uint8ClampedArray => {
  const out = new Uint8ClampedArray(8 * 8 * 4);
  for (let i = 0; i < 8 * 8; i++) {
    out[i * 4] = value;
    out[i * 4 + 1] = value;
    out[i * 4 + 2] = value;
    out[i * 4 + 3] = alpha;
  }
  return out;
};

const stamp = (times: number, x: number, y: number, coverage: number, flow: number) => {
  const buffer = createStrokeBuffer(RECT, WHITE);
  for (let i = 0; i < times; i++) buffer.stampDab(x, y, coverage, flow);
  return buffer;
};

describe('closed form', () => {
  it.each([
    { c: 1, f: 1, n: 100, alpha: 1 },
    { c: 0.5, f: 1, n: 7, alpha: 0.9921875 },
    { c: 0.8, f: 0.5, n: 13, alpha: 0.9986939 },
    { c: 0.25, f: 0.3, n: 40, alpha: 0.9557749 },
    { c: 1, f: 0.5, n: 10, alpha: 0.9990234 },
  ])('accumulates $n dabs at coverage $c flow $f to 1-(1-fc)^N', ({ c, f, n, alpha }) => {
    const buffer = stamp(n, 3, 3, c, f);
    const result = buffer.flush(null, 1);
    expect(result).not.toBeNull();
    expect(result!.alpha[0]).toBeCloseTo(alpha, 5);
    expect(result!.alpha[0]).toBeCloseTo(1 - Math.pow(1 - f * c, n), 6);
    expect(result!.data[3]).toBe(Math.round((1 - Math.pow(1 - f * c, n)) * 255));
    expect(result!.data[0]).toBe(255);
    expect(result!.data[1]).toBe(255);
    expect(result!.data[2]).toBe(255);
  });

  it('holds per pixel for a coverage pattern, not just one scalar', () => {
    const buffer = createStrokeBuffer(RECT, WHITE);
    const flow = 0.6;
    const coverage = (dx: number) => Math.max(0, 1 - Math.abs(dx) / 3);
    const foot: Rect = { x: 0, y: 2, width: 7, height: 3 };
    for (let i = 0; i < 4; i++) buffer.stampDab(3, 3, coverage, flow, undefined, { footprint: foot });
    const result = buffer.flush(null, 1)!;
    expect(result.rect).toEqual({ x: 0, y: 2, width: 7, height: 3 });
    for (let y = 0; y < 3; y++) {
      for (let x = 0; x < 7; x++) {
        const c = coverage(x - 3);
        const index = x + y * result.rect.width;
        expect(result.alpha[index]).toBeCloseTo(1 - Math.pow(1 - flow * c, 4), 6);
      }
    }
  });
});

describe('opacity ceiling', () => {
  it('caps 100 overlapping full dabs at O instead of building toward 1', () => {
    const capped = stamp(100, 3, 3, 1, 1).flush(null, 0.5)!;
    expect(capped.alpha[0]).toBe(0.5);
    expect(capped.data[3]).toBe(128);
    expect(capped.alpha[0]).toBeLessThan(1);
    expect(capped.data[0]).toBe(255);

    const full = stamp(100, 3, 3, 1, 1).flush(null, 1)!;
    expect(full.alpha[0]).toBe(1);
    expect(full.data[3]).toBe(255);

    const quarter = stamp(100, 3, 3, 1, 1).flush(null, 0.25)!;
    expect(quarter.alpha[0]).toBe(0.25);
    expect(quarter.data[3]).toBe(64);
  });

  it('is unaffected by the dab count for a saturated stroke', () => {
    for (const n of [1, 2, 10, 100, 1000]) {
      expect(stamp(n, 3, 3, 1, 1).flush(null, 0.5)!.alpha[0]).toBe(0.5);
    }
  });
});

describe('flow vs opacity', () => {
  it('separates the two stages once more than one dab lands', () => {
    const flowStage = stamp(2, 3, 3, 1, 0.5).flush(null, 1)!;
    const opacityStage = stamp(2, 3, 3, 1, 1).flush(null, 0.5)!;
    expect(flowStage.alpha[0]).toBeCloseTo(0.75, 6);
    expect(opacityStage.alpha[0]).toBe(0.5);
    expect(flowStage.alpha[0]).not.toBeCloseTo(opacityStage.alpha[0], 3);
  });

  it('collapses to the same identity p = fl + op - fl*op for a single dab', () => {
    expect(stamp(1, 3, 3, 1, 0.5).flush(null, 1)!.alpha[0]).toBe(0.5);
    expect(stamp(1, 3, 3, 1, 1).flush(null, 0.5)!.alpha[0]).toBe(0.5);
    expect(stamp(1, 3, 3, 1, 0.25).flush(null, 0.5)!.alpha[0]).toBe(0.125);
    expect(stamp(1, 3, 3, 1, 0.25).flush(null, 0.5)!.alpha[0]).toBeCloseTo(0.5 * 0.25, 6);
  });

  it('treats coverage as the per-dab alpha, not as a global multiplier', () => {
    expect(stamp(1, 3, 3, 0.4, 1).flush(null, 1)!.alpha[0]).toBeCloseTo(0.4, 6);
    expect(stamp(1, 3, 3, 1, 0.4).flush(null, 1)!.alpha[0]).toBeCloseTo(0.4, 6);
    expect(stamp(1, 3, 3, 0.5, 0.5).flush(null, 1)!.alpha[0]).toBeCloseTo(0.25, 6);
  });
});

describe('flush over a backdrop', () => {
  it('composites once at opacity: O*(1-(1-fc)^N) over opaque black', () => {
    const buffer = stamp(5, 3, 3, 1, 0.4);
    const want = 0.5 * (1 - Math.pow(1 - 0.4, 5));
    const result = buffer.flush(flatBackdrop(0), 0.5)!;
    expect(result.alpha[0]).toBe(1);
    expect(result.data[3]).toBe(255);
    expect(result.data[0]).toBe(Math.round(want * 255));
    expect(result.data[0]).toBe(118);
    expect(result.data[1]).toBe(118);
    expect(result.data[2]).toBe(118);
  });

  it('passes the backdrop through where the stroke adds nothing', () => {
    const buffer = stamp(5, 3, 3, 1, 0.4);
    expect(buffer.flush(flatBackdrop(255), 0.5)!.data[0]).toBe(255);
    expect(buffer.flush(flatBackdrop(0), 0)!.data[0]).toBe(0);
    expect(buffer.flush(flatBackdrop(128), 0)!.data[0]).toBe(128);
    expect(buffer.flush(flatBackdrop(128), 0.5)!.data[0]).toBe(187);
    expect(buffer.flush(flatBackdrop(0), 1)!.data[0]).toBe(235);
    expect(stamp(1, 3, 3, 1, 1).flush(flatBackdrop(0), 1)!.data[0]).toBe(255);
    expect(buffer.flush(flatBackdrop(0), 1)!.data[0]).not.toBe(255);
  });

  it('treats a null backdrop as transparent, not as black', () => {
    const transparent = stamp(5, 3, 3, 1, 0.4).flush(null, 0.5)!;
    const black = stamp(5, 3, 3, 1, 0.4).flush(flatBackdrop(0, 0), 0.5)!;
    const opaqueBlack = stamp(5, 3, 3, 1, 0.4).flush(flatBackdrop(0), 0.5)!;
    expect(transparent.alpha[0]).toBeCloseTo(0.5 * (1 - Math.pow(0.6, 5)), 6);
    expect(black.alpha[0]).toBe(transparent.alpha[0]);
    expect(black.data[0]).toBe(transparent.data[0]);
    expect(black.data[3]).toBe(transparent.data[3]);
    expect(opaqueBlack.alpha[0]).toBe(1);
    expect(opaqueBlack.data[0]).toBe(118);
  });

  it('is not destructive, so the caller can flush repeatedly', () => {
    const buffer = stamp(5, 3, 3, 1, 0.4);
    const first = buffer.flush(flatBackdrop(0), 0.5)!;
    const second = buffer.flush(flatBackdrop(0), 0.5)!;
    expect(Array.from(second.data)).toEqual(Array.from(first.data));
    expect(Array.from(second.alpha)).toEqual(Array.from(first.alpha));
    expect(second.rect).toEqual(first.rect);
  });
});

describe('injected blend', () => {
  it('feeds the dab stage and changes the accumulated stroke colour', () => {
    const plain = stamp(2, 3, 3, 1, 0.5).flush(null, 1)!;
    const zero = createStrokeBuffer(RECT, WHITE);
    zero.stampDab(3, 3, 1, 0.5);
    zero.stampDab(3, 3, 1, 0.5, () => 0);
    const zeroed = zero.flush(null, 1)!;
    expect(plain.alpha[0]).toBeCloseTo(0.75, 6);
    expect(zeroed.alpha[0]).toBeCloseTo(0.75, 6);
    expect(plain.data[0]).toBe(255);
    expect(zeroed.data[0]).toBe(170);
    expect(zeroed.data[0]).not.toBe(plain.data[0]);
  });

  it('feeds the flush stage and changes the composited result', () => {
    const normal = stamp(1, 3, 3, 1, 0.5).flush(flatBackdrop(200), 1)!;
    const invert = createStrokeBuffer(RECT, WHITE);
    invert.stampDab(3, 3, 1, 0.5);
    const inverted = invert.flush(flatBackdrop(200), 1, (_bd, source) => 1 - source)!;
    expect(normal.data[0]).toBe(227);
    expect(inverted.data[0]).toBe(100);
    expect(inverted.data[0]).not.toBe(normal.data[0]);
    expect(normal.alpha[0]).toBe(1);
    expect(inverted.alpha[0]).toBe(1);
  });

  it('defaults to normal, i.e. the source colour', () => {
    const implicit = createStrokeBuffer(RECT, WHITE);
    implicit.stampDab(3, 3, 1, 1);
    const explicit = createStrokeBuffer(RECT, WHITE);
    explicit.stampDab(3, 3, 1, 1, normalBlend);
    expect(Array.from(implicit.flush(null, 1)!.data)).toEqual(Array.from(explicit.flush(null, 1)!.data));
    expect(resolveBlend()).toBe(normalBlend);
    expect(resolveBlend(normalBlend)).toBe(normalBlend);
  });

  it('accepts a precomputed blend table and agrees with the function it came from', () => {
    const fn = (_bd: number, source: number) => 1 - source;
    const table: Blend = buildBlendLut(fn);
    expect(isBlendLut(table)).toBe(true);
    expect(table).toMatchObject({ size: 256 });
    const resolved = resolveBlend(table);
    for (let b = 0; b < 32; b++) {
      for (let s = 0; s < 32; s++) {
        expect(Math.abs(resolved(b / 31, s / 31) - fn(b / 31, s / 31))).toBeLessThan(1 / 255);
      }
    }
    const viaFn = createStrokeBuffer(RECT, WHITE);
    viaFn.stampDab(3, 3, 1, 0.5);
    viaFn.stampDab(3, 3, 1, 0.5, fn);
    const viaTable = createStrokeBuffer(RECT, WHITE);
    viaTable.stampDab(3, 3, 1, 0.5);
    viaTable.stampDab(3, 3, 1, 0.5, table);
    expect(Math.abs(viaTable.flush(null, 1)!.data[0] - viaFn.flush(null, 1)!.data[0])).toBeLessThanOrEqual(1);
    const differs = createStrokeBuffer(RECT, WHITE);
    differs.stampDab(3, 3, 1, 0.5);
    differs.stampDab(3, 3, 1, 0.5, table);
    expect(differs.flush(null, 1)!.data[0]).toBe(170);
    expect(differs.flush(null, 1)!.data[0]).not.toBe(255);
    const plain = createStrokeBuffer(RECT, WHITE);
    plain.stampDab(3, 3, 1, 0.5);
    plain.stampDab(3, 3, 1, 0.5);
    expect(plain.flush(null, 1)!.data[0]).toBe(255);
  });

  it('clamps a blend table that would leave the unit range', () => {
    const wild = buildBlendLut((_bd, source) => 1.5 * source - 0.25);
    expect(Math.max(...wild.data)).toBeLessThanOrEqual(1);
    expect(Math.min(...wild.data)).toBeGreaterThanOrEqual(0);
    expect(wild.data[255 * 256 + 255]).toBe(1);
    expect(wild.data[0]).toBe(0);
    const buffer = createStrokeBuffer(RECT, WHITE);
    buffer.stampDab(3, 3, 1, 0.5);
    buffer.stampDab(3, 3, 1, 0.5, wild);
    expect(buffer.flush(null, 1)!.data[0]).toBeLessThanOrEqual(255);
  });
});

describe('dirty rect', () => {
  it('is null until a dab lands and tracks the exact min and max', () => {
    const buffer = createStrokeBuffer({ x: 0, y: 0, width: 16, height: 16 }, WHITE);
    expect(buffer.dirtyRect()).toBeNull();
    expect(buffer.flush(null, 1)).toBeNull();

    buffer.stampDab(4, 5, 0.5, 1);
    expect(buffer.dirtyRect()).toEqual({ x: 4, y: 5, width: 1, height: 1 });

    buffer.stampDab(10, 12, 0.5, 1, undefined, { footprint: { x: 9, y: 11, width: 4, height: 3 } });
    expect(buffer.dirtyRect()).toEqual({ x: 4, y: 5, width: 9, height: 9 });

    buffer.stampDab(2, 14, 0.5, 1);
    expect(buffer.dirtyRect()).toEqual({ x: 2, y: 5, width: 11, height: 10 });

    buffer.stampDab(20, 2, 0.5, 1, undefined, { footprint: { x: 19, y: 1, width: 2, height: 2 } });
    expect(buffer.dirtyRect()).toEqual({ x: 2, y: 5, width: 11, height: 10 });

    buffer.stampDab(14, 1, 0.5, 1, undefined, { footprint: { x: 14, y: 1, width: 2, height: 2 } });
    expect(buffer.dirtyRect()).toEqual({ x: 2, y: 1, width: 14, height: 14 });
  });

  it('does not grow for a dab that deposits nothing', () => {
    const buffer = createStrokeBuffer({ x: 0, y: 0, width: 16, height: 16 }, WHITE);
    buffer.stampDab(4, 5, 0.5, 1);
    const before = buffer.dirtyRect();
    buffer.stampDab(1, 1, 0, 1, undefined, { footprint: { x: 0, y: 0, width: 2, height: 2 } });
    buffer.stampDab(1, 1, 1, 0, undefined, { footprint: { x: 0, y: 0, width: 2, height: 2 } });
    buffer.stampDab(1, 1, NaN, 1, undefined, { footprint: { x: 0, y: 0, width: 2, height: 2 } });
    buffer.stampDab(1, 1, 1, NaN);
    expect(buffer.dirtyRect()).toEqual(before);
  });

  it('clips a dab that falls outside the buffer', () => {
    const buffer = createStrokeBuffer({ x: 0, y: 0, width: 10, height: 10 }, WHITE);
    buffer.stampDab(8, 8, 1, 1, undefined, { footprint: { x: 5, y: 5, width: 8, height: 8 } });
    expect(buffer.dirtyRect()).toEqual({ x: 5, y: 5, width: 5, height: 5 });
    const result = buffer.flush(null, 1)!;
    expect(result.rect).toEqual({ x: 5, y: 5, width: 5, height: 5 });
    expect(result.data.length).toBe(5 * 5 * 4);
    for (let i = 0; i < 5 * 5; i++) expect(result.data[i * 4 + 3]).toBe(255);

    const missed = createStrokeBuffer({ x: 0, y: 0, width: 10, height: 10 }, WHITE);
    missed.stampDab(99, 99, 1, 1, undefined, { footprint: { x: 98, y: 98, width: 2, height: 2 } });
    missed.stampDab(-5, -5, 1, 1, undefined, { footprint: { x: -6, y: -6, width: 3, height: 3 } });
    expect(missed.dirtyRect()).toBeNull();
  });

  it('reports layer coordinates for an offset buffer', () => {
    const buffer = createStrokeBuffer({ x: 10, y: 20, width: 4, height: 4 }, WHITE);
    expect(buffer.width).toBe(4);
    expect(buffer.height).toBe(4);
    expect(buffer.data.length).toBe(4 * 4 * 4);
    buffer.stampDab(12, 21, 1, 1);
    expect(buffer.dirtyRect()).toEqual({ x: 12, y: 21, width: 1, height: 1 });
    expect(buffer.flush(null, 1)!.rect).toEqual({ x: 12, y: 21, width: 1, height: 1 });
    buffer.stampDab(11, 20, 0.5, 1);
    expect(buffer.dirtyRect()).toEqual({ x: 11, y: 20, width: 2, height: 2 });
  });

  it('survives an empty buffer without allocating anything', () => {
    const buffer = createStrokeBuffer({ x: 0, y: 0, width: 0, height: 0 }, WHITE);
    expect(buffer.data.length).toBe(0);
    buffer.stampDab(0, 0, 1, 1);
    expect(buffer.dirtyRect()).toBeNull();
    expect(buffer.flush(null, 1)).toBeNull();
  });
});

describe('default brush colour', () => {
  it('is opaque black when the caller supplies none', () => {
    const buffer = createStrokeBuffer(RECT);
    buffer.stampDab(3, 3, 1, 1);
    const result = buffer.flush(null, 1)!;
    expect(result.data[0]).toBe(0);
    expect(result.data[1]).toBe(0);
    expect(result.data[2]).toBe(0);
    expect(result.data[3]).toBe(255);
    const explicit = createStrokeBuffer(RECT, { r: 0, g: 0, b: 0 });
    explicit.stampDab(3, 3, 1, 1);
    expect(Array.from(explicit.flush(null, 1)!.data)).toEqual(Array.from(result.data));
  });
});

describe('sampler coverage of zero', () => {
  const foot: Rect = { x: 0, y: 1, width: 5, height: 3 };
  const even = (dx: number) => (dx % 2 === 0 ? 0 : 1);
  const never = () => 0;

  it('deposits nothing at all when the sampler returns zero everywhere', () => {
    const buffer = createStrokeBuffer(RECT, WHITE);
    buffer.stampDab(2, 2, never, 0.5, undefined, { footprint: foot });
    expect(Array.from(buffer.data).every(Number.isFinite)).toBe(true);
    expect(Array.from(buffer.data).every((v) => v === 0)).toBe(true);
    expect(buffer.dirtyRect()).toBeNull();
    expect(buffer.flush(null, 1)).toBeNull();
  });

  it('clamps sampler coverage that leaves [0,1]', () => {
    const buffer = createStrokeBuffer(RECT, WHITE);
    buffer.stampDab(3, 3, () => 1.5, 0.5);
    const over = buffer.flush(null, 1)!;
    expect(over.alpha[0]).toBe(0.5);
    expect(over.data[3]).toBe(128);

    const negative = createStrokeBuffer(RECT, WHITE);
    negative.stampDab(3, 3, () => -0.5, 1);
    expect(negative.dirtyRect()).toBeNull();
    expect(negative.flush(null, 1)).toBeNull();
    expect(Array.from(negative.data).every((v) => v === 0)).toBe(true);
  });

  it('dirties the footprint and leaves uncovered pixels at zero', () => {
    const buffer = createStrokeBuffer(RECT, WHITE);
    buffer.stampDab(2, 2, even, 0.5, undefined, { footprint: foot });
    expect(buffer.dirtyRect()).toEqual({ x: 0, y: 1, width: 5, height: 3 });
    expect(Array.from(buffer.data).every(Number.isFinite)).toBe(true);
    const result = buffer.flush(null, 1)!;
    expect(result.rect).toEqual({ x: 0, y: 1, width: 5, height: 3 });
    for (let y = 0; y < 3; y++) {
      for (let x = 0; x < 5; x++) {
        const i = x + y * 5;
        expect(result.alpha[i]).toBeCloseTo(even(x - 2) * 0.5, 6);
        expect(result.data[i * 4 + 3]).toBe(even(x - 2) === 1 ? 128 : 0);
        expect(result.data[i * 4]).toBe(even(x - 2) === 1 ? 255 : 0);
      }
    }
  });
});

describe('reset', () => {
  it('clears the pixels and the dirty rect', () => {
    const buffer = createStrokeBuffer(RECT, WHITE);
    buffer.stampDab(3, 3, 1, 1, undefined, { footprint: { x: 1, y: 1, width: 5, height: 5 } });
    expect(buffer.dirtyRect()).not.toBeNull();
    buffer.reset();
    expect(buffer.dirtyRect()).toBeNull();
    expect(buffer.flush(null, 1)).toBeNull();
    expect(Array.from(buffer.data).every((v) => v === 0)).toBe(true);
    const reused = createStrokeBuffer(RECT, WHITE);
    reused.stampDab(3, 3, 1, 1);
    expect(reused.flush(null, 1)!.alpha[0]).toBe(1);
  });
});

describe('degenerate inputs', () => {
  it('produces no NaN or Infinity at zero coverage, zero flow or zero opacity', () => {
    const nothing = createStrokeBuffer(RECT, WHITE);
    nothing.stampDab(3, 3, 0, 1);
    nothing.stampDab(3, 3, 1, 0);
    expect(nothing.dirtyRect()).toBeNull();
    expect(Array.from(nothing.data).every(Number.isFinite)).toBe(true);

    const faded = createStrokeBuffer(RECT, WHITE);
    faded.stampDab(3, 3, 1, 1);
    const overTransparent = faded.flush(null, 0)!;
    expect(overTransparent.alpha[0]).toBe(0);
    expect(Array.from(overTransparent.data)).toEqual([0, 0, 0, 0]);
    expect(Array.from(overTransparent.alpha).every(Number.isFinite)).toBe(true);

    const overBlack = faded.flush(flatBackdrop(0), 0)!;
    expect(overBlack.data[0]).toBe(0);
    expect(overBlack.data[3]).toBe(255);
    expect(overBlack.alpha[0]).toBe(1);

    expect(Array.from(faded.data).every(Number.isFinite)).toBe(true);
  });

  it('sanitises a bad brush colour instead of poisoning the buffer', () => {
    const buffer = createStrokeBuffer(RECT, { r: NaN, g: -5, b: 999 });
    buffer.stampDab(3, 3, 1, 1);
    const result = buffer.flush(null, 1)!;
    expect(result.data[0]).toBe(0);
    expect(result.data[1]).toBe(0);
    expect(result.data[2]).toBe(255);
    expect(Array.from(buffer.data).every(Number.isFinite)).toBe(true);
  });

  it('clamps opacity, flow and coverage into range', () => {
    expect(stamp(1, 3, 3, 1, 1).flush(null, 2)!.alpha[0]).toBe(1);
    expect(stamp(1, 3, 3, 1, 1).flush(null, -1)!.alpha[0]).toBe(0);
    expect(stamp(1, 3, 3, 1, 5).flush(null, 1)!.alpha[0]).toBe(1);
    expect(stamp(1, 3, 3, 2, 1).flush(null, 1)!.alpha[0]).toBe(1);
  });

  it('takes the brush colour from the dab and keeps channels apart', () => {
    const buffer = createStrokeBuffer(RECT, RED);
    for (let i = 0; i < 3; i++) buffer.stampDab(3, 3, 1, 0.5);
    const result = buffer.flush(null, 1)!;
    expect(result.data[0]).toBe(255);
    expect(result.data[1]).toBe(0);
    expect(result.data[2]).toBe(0);
    expect(result.alpha[0]).toBeCloseTo(1 - Math.pow(0.5, 3), 6);
  });
});

describe('coverage sampler', () => {
  it('walks the dab footprint and leaves the rest of the buffer alone', () => {
    const buffer = createStrokeBuffer(RECT, WHITE);
    buffer.stampDab(4, 4, (dx, dy) => (dx * dx + dy * dy <= 4 ? 1 : 0), 0.5, undefined, {
      footprint: { x: 1, y: 1, width: 7, height: 7 },
    });
    const result = buffer.flush(null, 1)!;
    expect(result.rect).toEqual({ x: 1, y: 1, width: 7, height: 7 });
    const expected = [
      [0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 128, 0, 0, 0],
      [0, 0, 128, 128, 128, 0, 0],
      [0, 128, 128, 128, 128, 128, 0],
      [0, 0, 128, 128, 128, 0, 0],
      [0, 0, 0, 128, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0],
    ];
    for (let y = 0; y < 7; y++) {
      for (let x = 0; x < 7; x++) {
        const i = y * 7 + x;
        expect(result.data[i * 4 + 3]).toBe(expected[y][x]);
        expect(result.data[i * 4]).toBe(expected[y][x] === 0 ? 0 : 255);
      }
    }
  });
});
