import { describe, expect, it } from 'vitest';
import {
  SMOOTHING_WINDOW_MAX,
  SMOOTHING_WINDOW_MIN,
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
});
