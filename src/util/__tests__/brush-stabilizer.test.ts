import { describe, expect, it } from 'vitest';
import {
  SMOOTHING_WINDOW_MAX,
  SMOOTHING_WINDOW_MIN,
  TAU_MAX_MS,
  TAU_MIN_MS,
  coalescedPoints,
  createExponentialSmoother,
  createStabilizer,
  smoothingPercentToWindowSize,
} from '../brush-stabilizer.ts';
import type { Point } from '../../contexts/general-types.ts';

describe('smoothingPercentToWindowSize', () => {
  it('maps the 0-100 slider onto the spec window range 5-20', () => {
    expect(smoothingPercentToWindowSize(0)).toBe(5);
    expect(smoothingPercentToWindowSize(50)).toBe(13);
    expect(smoothingPercentToWindowSize(100)).toBe(20);
    expect(smoothingPercentToWindowSize(0)).toBe(SMOOTHING_WINDOW_MIN);
    expect(smoothingPercentToWindowSize(100)).toBe(SMOOTHING_WINDOW_MAX);
  });

  it('clamps out-of-range and non-finite percentages to the window range', () => {
    expect(smoothingPercentToWindowSize(-40)).toBe(5);
    expect(smoothingPercentToWindowSize(1000)).toBe(20);
    expect(smoothingPercentToWindowSize(Number.NaN)).toBe(5);
    for (let pct = -10; pct <= 110; pct++) {
      const size = smoothingPercentToWindowSize(pct);
      expect(size).toBeGreaterThanOrEqual(SMOOTHING_WINDOW_MIN);
      expect(size).toBeLessThanOrEqual(SMOOTHING_WINDOW_MAX);
      expect(Number.isInteger(size)).toBe(true);
    }
  });
});

describe('createStabilizer', () => {
  it('fills the window with the first sample, so the first dab is that sample and not a ramp toward the origin', () => {
    const stabilizer = createStabilizer({ smoothingPercent: 50, intervalMs: 8.3 });
    expect(stabilizer.windowSize()).toBe(13);

    stabilizer.push({ x: 40, y: 30 }, 0);

    expect(stabilizer.tick(0)).toEqual([{ x: 40, y: 30 }]);
  });

  it('flushes the remaining leash in one step on release, emitting the last sample', () => {
    const stabilizer = createStabilizer({ smoothingPercent: 50, intervalMs: 1000 });

    stabilizer.push({ x: 0, y: 0 }, 0);
    stabilizer.push({ x: 10, y: 0 }, 10);
    stabilizer.push({ x: 20, y: 0 }, 20);

    expect(stabilizer.flush()).toEqual([{ x: 20, y: 0 }]);
    expect(stabilizer.flush()).toEqual([]);
    expect(stabilizer.tick(1000)).toEqual([]);
  });

  it('is a pass-through at 0% smoothing: a far-away history cannot drag the dab off the newest sample', () => {
    expect(smoothingPercentToWindowSize(0)).toBe(5);

    const stabilizer = createStabilizer({ smoothingPercent: 0, intervalMs: 8.3 });
    expect(stabilizer.windowSize()).toBe(1);

    stabilizer.push({ x: 0, y: 0 }, 0);
    expect(stabilizer.tick(0)).toEqual([{ x: 0, y: 0 }]);

    stabilizer.push({ x: 1000, y: 0 }, 16);
    expect(stabilizer.tick(16)).toEqual([{ x: 1000, y: 0 }]);
  });

  it('emits the mean of the buffered samples, not the newest one', () => {
    const stabilizer = createStabilizer({ smoothingPercent: 100, intervalMs: 1000 });
    expect(stabilizer.windowSize()).toBe(20);

    stabilizer.push({ x: 0, y: 0 }, 0);
    stabilizer.push({ x: 10, y: 0 }, 1);
    stabilizer.push({ x: 20, y: 0 }, 2);

    expect(stabilizer.tick(500)).toEqual([{ x: 10, y: 0 }]);
  });

  it('resamples at the interval: 101 samples across 100ms emit 10 dabs, not 101', () => {
    const stabilizer = createStabilizer({ smoothingPercent: 50, intervalMs: 10 });
    const emitted: Point[] = [];

    for (let i = 0; i <= 100; i++) {
      stabilizer.push({ x: i, y: 0 }, i);
      if (i > 0 && i % 10 === 0) emitted.push(...stabilizer.tick(i));
    }

    expect(emitted).toHaveLength(10);
    expect(emitted[0]).toEqual({ x: 5, y: 0 });
    expect(emitted[9]).toEqual({ x: 94, y: 0 });
  });

  it('emits at the interval, not once per frame: a 50ms interval ticked every 10ms emits 3 dabs over 100ms', () => {
    const stabilizer = createStabilizer({ smoothingPercent: 50, intervalMs: 50 });
    const emitted: Point[] = [];

    for (let i = 0; i <= 100; i++) {
      stabilizer.push({ x: i, y: 0 }, i);
      if (i > 0 && i % 10 === 0) emitted.push(...stabilizer.tick(i));
    }

    expect(emitted).toHaveLength(3);
  });

  it('emits at most one dab per tick, so a long gap does not dump the whole window at once', () => {
    const stabilizer = createStabilizer({ smoothingPercent: 50, intervalMs: 10 });

    stabilizer.push({ x: 0, y: 0 }, 0);
    for (let i = 1; i < 100; i++) stabilizer.push({ x: i, y: 0 }, i);

    expect(stabilizer.tick(100)).toHaveLength(1);
  });

  it('returns no dab before the first sample and none after reset', () => {
    const stabilizer = createStabilizer({ smoothingPercent: 50, intervalMs: 10 });

    expect(stabilizer.tick(1000)).toEqual([]);

    stabilizer.push({ x: 5, y: 5 }, 0);
    expect(stabilizer.tick(1000)).toHaveLength(1);

    stabilizer.reset();
    expect(stabilizer.tick(1000)).toEqual([]);
  });

  it('scales the leash by zoom only in adjust-for-zoom mode', () => {
    expect(createStabilizer({ smoothingPercent: 100, zoom: 2 }).windowSize()).toBe(20);
    expect(createStabilizer({ smoothingPercent: 100, mode: 'adjust-for-zoom', zoom: 2 }).windowSize()).toBe(10);
    expect(createStabilizer({ smoothingPercent: 100, mode: 'adjust-for-zoom', zoom: 4 }).windowSize()).toBe(5);
    expect(createStabilizer({ smoothingPercent: 100, mode: 'adjust-for-zoom', zoom: 100 }).windowSize()).toBe(1);
  });

  /**
   * The two option guards this module applies, neither of which any case above reaches.
   *
   * `intervalMs: 0` makes `elapsed % interval` a NaN, so `lastEmit` becomes NaN and `tick`
   * emits on EVERY call rather than once per interval — a stroke that lays down a dab per
   * frame regardless of timing. `zoom: 0` (or NaN) makes `Math.round(size / 0)` an Infinity
   * and `Math.round(size / NaN)` a NaN, and `Math.min(20, Math.max(1, NaN))` is NaN, which
   * `windowSize()` would then report and `buffer.length > size` would never satisfy, so the
   * buffer would grow without bound for the whole gesture. Both fall back to a finite value.
   */
  it('falls back to the spec interval for a zero, negative or non-finite interval', () => {
    for (const intervalMs of [0, -8.3, Number.NaN, Number.POSITIVE_INFINITY]) {
      const stabilizer = createStabilizer({ smoothingPercent: 50, intervalMs });

      stabilizer.push({ x: 4, y: 4 }, 0);
      expect(stabilizer.tick(8.3), String(intervalMs)).toEqual([{ x: 4, y: 4 }]);
      // Once per interval, not once per call. This is the discriminator: with interval 0,
      // `lastEmit` becomes NaN and `NaN < 0` is false, so the second tick emits too.
      expect(stabilizer.tick(9), String(intervalMs)).toEqual([]);
    }
  });

  it('treats a zero, negative or non-finite zoom as 1 in adjust-for-zoom mode', () => {
    for (const zoom of [0, -2, Number.NaN, Number.POSITIVE_INFINITY]) {
      // The unzoomed window for 50% is 13, which is what factor 1 produces.
      expect(createStabilizer({ smoothingPercent: 50, mode: 'adjust-for-zoom', zoom }).windowSize(), String(zoom)).toBe(
        13
      );
    }
    // And the window is a usable integer, not NaN, which is what `push` compares against.
    const stabilizer = createStabilizer({ smoothingPercent: 50, mode: 'adjust-for-zoom', zoom: Number.NaN });
    expect(Number.isInteger(stabilizer.windowSize())).toBe(true);
  });

  /**
   * A NaN percentage takes the OTHER branch of the two guards, and the difference is not a
   * rounding detail: `percent <= 0` is false for NaN, so `effectiveWindowSize` falls through
   * to `smoothingPercentToWindowSize(NaN)`, which returns the MINIMUM window of 5. A
   * pass-through check written as `percent === 0` would give 1 instead — no smoothing at all,
   * for a corrupt setting.
   */
  it('gives a NaN percentage the minimum window rather than the zero-smoothing pass-through', () => {
    expect(createStabilizer({ smoothingPercent: Number.NaN }).windowSize()).toBe(SMOOTHING_WINDOW_MIN);
    expect(createStabilizer({ smoothingPercent: 0 }).windowSize()).toBe(1);
    expect(createStabilizer({ smoothingPercent: -1 }).windowSize()).toBe(1);
  });

  it('flushes nothing before the first push, rather than averaging an empty buffer', () => {
    // `mean()` over an empty buffer is 0 / 0, so the `lastSample` guard is the only thing
    // between a release-before-draw and a stroke that starts at NaN, NaN.
    // `mean()` over an empty buffer is 0 / 0, so the two emptiness guards -- `!last` in
    // `flush` and `buffer.length === 0` in `tick` -- are the only things between a
    // release-before-draw and a stroke that starts at NaN, NaN. `tick` carries the
    // second guard, and it is the reachable one during a stroke, so it is pinned
    // here: without it `tick` would emit `mean()` of nothing and hand the brush
    // engine a NaN point no `flush` assertion could see.
    expect(createStabilizer({ smoothingPercent: 50 }).flush()).toEqual([]);
    expect(createStabilizer({ smoothingPercent: 50 }).tick(0)).toEqual([]);
    expect(createStabilizer({ smoothingPercent: 50 }).tick(1e9)).toEqual([]);

    const stabilizer = createStabilizer({ smoothingPercent: 50 });
    stabilizer.push({ x: 1, y: 2 }, 0);
    expect(stabilizer.flush()).toEqual([{ x: 1, y: 2 }]);
    // And a second flush after a real one is empty again, because flush resets.
    expect(stabilizer.flush()).toEqual([]);
  });
});

describe('createExponentialSmoother', () => {
  const flatTau = { smoothingPercent: 50, tauMinMs: 100, tauMaxMs: 100 };

  it('places tau at tauMax at 0% and tauMin at 100%', () => {
    expect(createExponentialSmoother({ smoothingPercent: 0, tauMinMs: 4, tauMaxMs: 150 }).tau()).toBe(150);
    expect(createExponentialSmoother({ smoothingPercent: 100, tauMinMs: 4, tauMaxMs: 150 }).tau()).toBe(4);
    expect(createExponentialSmoother({ smoothingPercent: 50, tauMinMs: 4, tauMaxMs: 150 }).tau()).toBe(77);
  });

  it('steps to the analytic one-pole value 100*(1-exp(-dt/tau))', () => {
    const smoother = createExponentialSmoother(flatTau);

    smoother.step({ x: 0, y: 0 }, 0);

    expect(smoother.step({ x: 100, y: 0 }, 1000).x).toBeCloseTo(99.99546000702375, 10);
  });

  it('is framerate independent: one step of 1000ms equals 60 steps of 16.67ms', () => {
    const single = createExponentialSmoother(flatTau);
    single.step({ x: 0, y: 0 }, 0);
    const oneCall = single.step({ x: 100, y: 0 }, 1000);

    const many = createExponentialSmoother(flatTau);
    many.step({ x: 0, y: 0 }, 0);
    let partitioned = many.step({ x: 100, y: 0 }, 1000 / 60);
    for (let i = 1; i < 60; i++) partitioned = many.step({ x: 100, y: 0 }, 1000 / 60);

    expect(partitioned.x).toBeCloseTo(oneCall.x, 10);
    expect(partitioned.x).toBeCloseTo(99.99546000702375, 9);
  });

  it('holds position through a zero or negative dt and seeds from the first target', () => {
    const smoother = createExponentialSmoother(flatTau);

    expect(smoother.current()).toBeNull();
    expect(smoother.step({ x: 3, y: 4 }, 0)).toEqual({ x: 3, y: 4 });
    expect(smoother.current()).toEqual({ x: 3, y: 4 });
    expect(smoother.step({ x: 100, y: 0 }, 0)).toEqual({ x: 3, y: 4 });
    expect(smoother.step({ x: 100, y: 0 }, -5)).toEqual({ x: 3, y: 4 });

    smoother.reset();
    expect(smoother.current()).toBeNull();
  });

  /**
   * `tauMinMs` and `tauMaxMs` guards, which decide the value at the two ends of the slider.
   *
   * A `tauMinMs` of 0 would put tau at exactly 0 at 100% smoothing, and `1 - Math.exp(-dt / 0)`
   * is NaN, so every subsequent position would be NaN — the smoother would freeze on a corrupt
   * value rather than move. The default of 4 is what keeps it finite, and it is only visible
   * at the ends of the percent range, which is why no existing case reaches it.
   */
  it('falls back to the spec tau bounds for a zero, negative or non-finite bound', () => {
    expect(createExponentialSmoother({ smoothingPercent: 100, tauMinMs: 0 }).tau()).toBe(TAU_MIN_MS);
    expect(createExponentialSmoother({ smoothingPercent: 100, tauMinMs: -5 }).tau()).toBe(TAU_MIN_MS);
    expect(createExponentialSmoother({ smoothingPercent: 100, tauMinMs: Number.NaN }).tau()).toBe(TAU_MIN_MS);
    expect(createExponentialSmoother({ smoothingPercent: 0, tauMaxMs: 0 }).tau()).toBe(TAU_MAX_MS);
    expect(createExponentialSmoother({ smoothingPercent: 0, tauMaxMs: Number.POSITIVE_INFINITY }).tau()).toBe(
      TAU_MAX_MS
    );

    // And the step stays finite through the whole path, which is the consequence that matters.
    const smoother = createExponentialSmoother({ smoothingPercent: 100, tauMinMs: 0 });
    smoother.step({ x: 0, y: 0 }, 0);
    expect(smoother.step({ x: 100, y: 100 }, 16).x).toBeGreaterThan(0);
    expect(Number.isFinite(smoother.step({ x: 100, y: 100 }, 16).x)).toBe(true);
  });

  it('clamps the percentage before it is used as a fraction', () => {
    // `smoothingPercent / 100` is clamped to [0, 1], so an out-of-range slider saturates at an
    // end rather than extrapolating tau past its bound. NaN takes the `!isFinite` arm of
    // clamp01, which is 0 — full smoothing, not none.
    expect(createExponentialSmoother({ smoothingPercent: 250, tauMinMs: 4, tauMaxMs: 150 }).tau()).toBe(4);
    expect(createExponentialSmoother({ smoothingPercent: -250, tauMinMs: 4, tauMaxMs: 150 }).tau()).toBe(150);
    expect(createExponentialSmoother({ smoothingPercent: Number.NaN, tauMinMs: 4, tauMaxMs: 150 }).tau()).toBe(150);
    // An INFINITE percent takes clamp01's `!isFinite` arm too, so it saturates at the same
    // end as NaN rather than at 100% — the opposite of what `Math.min(1, Infinity)` would do.
    expect(
      createExponentialSmoother({ smoothingPercent: Number.POSITIVE_INFINITY, tauMinMs: 4, tauMaxMs: 150 }).tau()
    ).toBe(150);
  });

  it('holds position through a NaN dt instead of poisoning the accumulator', () => {
    // `!(dt > 0)` catches NaN; a `dt === 0` check would not, and `Math.exp(-NaN / tau)` is
    // NaN, so `s` and every later position would be NaN for the rest of the stroke.
    const smoother = createExponentialSmoother(flatTau);

    smoother.step({ x: 3, y: 4 }, 0);
    expect(smoother.step({ x: 100, y: 0 }, Number.NaN)).toEqual({ x: 3, y: 4 });
    expect(smoother.current()).toEqual({ x: 3, y: 4 });
    // And the accumulator is still usable afterwards.
    expect(smoother.step({ x: 100, y: 0 }, 1000).x).toBeGreaterThan(3);
  });
});

describe('coalescedPoints', () => {
  it('expands a pointer event into its coalesced points and drops the outer event', () => {
    const event = {
      clientX: 30,
      clientY: 40,
      getCoalescedEvents: () => [
        { clientX: 10, clientY: 11 },
        { clientX: 20, clientY: 22 },
        { clientX: 30, clientY: 40 },
      ],
    };

    expect(coalescedPoints(event)).toEqual([
      { x: 10, y: 11 },
      { x: 20, y: 22 },
      { x: 30, y: 40 },
    ]);
  });

  it('falls back to the single event when getCoalescedEvents is absent', () => {
    expect(coalescedPoints({ clientX: 7, clientY: 9 })).toEqual([{ x: 7, y: 9 }]);
    expect(coalescedPoints({ clientX: 7, clientY: 9, getCoalescedEvents: undefined })).toEqual([{ x: 7, y: 9 }]);
  });

  it('falls back to the single event when the coalesced list is empty', () => {
    expect(coalescedPoints({ clientX: 1, clientY: 2, getCoalescedEvents: () => [] })).toEqual([{ x: 1, y: 2 }]);
  });

  it('falls back to the single event when getCoalescedEvents returns null', () => {
    // The `merged &&` half of the guard, which the empty-list case above cannot reach: an
    // empty list is falsy-safe to iterate, but `null.length` throws, so the guard is what
    // keeps a browser that returns null from taking the whole pointer handler down.
    expect(coalescedPoints({ clientX: 1, clientY: 2, getCoalescedEvents: () => null as never })).toEqual([
      { x: 1, y: 2 },
    ]);
  });

  it('reads a coalesced list with array-like access, not array methods', () => {
    // `getCoalescedEvents()` returns an ArrayLike, not an Array: a rewrite that used
    // `.map` or spread it would throw or lose points on a real browser's return value.
    const arrayLike = { 0: { clientX: 5, clientY: 6 }, 1: { clientX: 7, clientY: 8 }, length: 2 };

    expect(coalescedPoints({ clientX: 0, clientY: 0, getCoalescedEvents: () => arrayLike })).toEqual([
      { x: 5, y: 6 },
      { x: 7, y: 8 },
    ]);
  });
});
