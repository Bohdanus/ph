import { describe, expect, it } from 'vitest';
import { AIRBRUSH_INTERVAL_MS, AIRBRUSH_MAX_DABS_PER_FRAME, createAirbrushEmitter } from '../brush-airbrush.ts';

describe('createAirbrushEmitter', () => {
  it('emits floor(debt / D) dabs and carries the float remainder', () => {
    const emitter = createAirbrushEmitter({ intervalMs: 8, maxDabsPerFrame: 8 });

    expect(emitter.accumulate(8)).toBe(1);
    expect(emitter.debt()).toBe(0);

    expect(emitter.accumulate(4)).toBe(0);
    expect(emitter.debt()).toBe(4);

    expect(emitter.accumulate(4)).toBe(1);
    expect(emitter.debt()).toBe(0);
  });

  it('emits 120 dabs for 1000ms at the spec interval of 8.3ms, and at most the cap of 8 by default', () => {
    const uncapped = createAirbrushEmitter({ maxDabsPerFrame: 500 });
    expect(uncapped.accumulate(1000)).toBe(120);
    expect(uncapped.debt()).toBeCloseTo(1000 - 120 * 8.3, 9);

    const capped = createAirbrushEmitter();
    expect(capped.accumulate(1000)).toBe(AIRBRUSH_MAX_DABS_PER_FRAME);
    expect(capped.accumulate(1000)).toBe(AIRBRUSH_MAX_DABS_PER_FRAME);
  });

  it('caps a backgrounded-tab return at 8 dabs instead of flooding 1204', () => {
    const emitter = createAirbrushEmitter({ intervalMs: 8.3 });

    expect(emitter.accumulate(10_000)).toBe(8);
    expect(emitter.debt()).toBeCloseTo(6.8, 6);
    expect(emitter.debt()).toBeLessThan(8.3);

    let drained = 0;
    for (let frame = 0; frame < 600; frame++) drained += emitter.accumulate(0);
    expect(drained).toBe(0);
    expect(emitter.debt()).toBeCloseTo(6.8, 6);
  });

  it('emits zero dabs for zero, negative and non-finite dt', () => {
    const emitter = createAirbrushEmitter({ intervalMs: 8 });

    for (let frame = 0; frame < 600; frame++) expect(emitter.accumulate(0)).toBe(0);
    expect(emitter.accumulate(-16)).toBe(0);
    expect(emitter.accumulate(Number.NaN)).toBe(0);
    expect(emitter.debt()).toBe(0);
  });

  it('reproduces the spec build-up law 1-(1-f*c)^(t/D) after t at flow f and coverage c', () => {
    const intervalMs = 8;
    const flow = 0.3;
    const coverage = 0.5;
    const elapsed = 48;
    const emitter = createAirbrushEmitter({ intervalMs });

    let dabs = 0;
    for (let frame = 0; frame < elapsed; frame++) dabs += emitter.accumulate(1);

    expect(dabs).toBe(6);
    expect(1 - Math.pow(1 - flow * coverage, elapsed / intervalMs)).toBeCloseTo(0.622850484375, 12);
    expect(1 - Math.pow(1 - flow * coverage, dabs)).toBeCloseTo(0.622850484375, 12);
  });

  it('is framerate independent: the same 48ms emits 6 dabs at every step size', () => {
    const runEmitter = (stepMs: number) => {
      const emitter = createAirbrushEmitter({ intervalMs: 8 });
      let dabs = 0;
      for (let elapsed = 0; elapsed < 48; elapsed += stepMs) dabs += emitter.accumulate(stepMs);
      return { dabs, debt: emitter.debt() };
    };

    expect(runEmitter(1).dabs).toBe(6);
    expect(runEmitter(2).dabs).toBe(6);
    expect(runEmitter(4).dabs).toBe(6);
    expect(runEmitter(8).dabs).toBe(6);
    expect(runEmitter(48).dabs).toBe(6);
    expect(runEmitter(1).debt).toBe(0);
  });

  it('drops the accumulated debt on reset', () => {
    const emitter = createAirbrushEmitter({ intervalMs: 8 });

    expect(emitter.accumulate(4)).toBe(0);
    expect(emitter.debt()).toBe(4);

    emitter.reset();

    expect(emitter.debt()).toBe(0);
    expect(emitter.accumulate(4)).toBe(0);
    expect(emitter.accumulate(4)).toBe(1);
  });

  describe('edge cases', () => {
    it('falls back to the default interval for non-finite intervalMs', () => {
      for (const intervalMs of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
        const emitter = createAirbrushEmitter({ intervalMs });
        expect(emitter.accumulate(AIRBRUSH_INTERVAL_MS)).toBe(1);
        expect(emitter.debt()).toBeCloseTo(0, 9);
      }
    });

    it('falls back to the default interval for non-positive intervalMs', () => {
      for (const intervalMs of [0, -0, -8.3]) {
        const emitter = createAirbrushEmitter({ intervalMs });
        expect(emitter.accumulate(AIRBRUSH_INTERVAL_MS)).toBe(1);
        expect(emitter.debt()).toBeCloseTo(0, 9);
      }
    });

    it('silently zeroes the cap for non-finite maxDabsPerFrame', () => {
      for (const maxDabsPerFrame of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
        const emitter = createAirbrushEmitter({ maxDabsPerFrame });
        expect(emitter.accumulate(1000)).toBe(0);
      }
    });

    it('silently zeroes the cap for non-positive or sub-unit maxDabsPerFrame', () => {
      for (const maxDabsPerFrame of [0, -0, -1, 0.5, 0.9]) {
        const emitter = createAirbrushEmitter({ intervalMs: 8, maxDabsPerFrame });
        expect(emitter.accumulate(8)).toBe(0);
      }
    });

    it('honours a cap of exactly 1', () => {
      const emitter = createAirbrushEmitter({ intervalMs: 8, maxDabsPerFrame: 1 });
      expect(emitter.accumulate(48)).toBe(1);
      expect(emitter.debt()).toBe(0);
    });

    it('floors fractional maxDabsPerFrame to an integer cap', () => {
      expect(createAirbrushEmitter({ intervalMs: 8, maxDabsPerFrame: 2.9 }).accumulate(48)).toBe(2);
      expect(createAirbrushEmitter({ intervalMs: 8, maxDabsPerFrame: 3.1 }).accumulate(48)).toBe(3);
    });

    it('emits zero dabs and leaves debt at zero for non-finite dt', () => {
      const emitter = createAirbrushEmitter({ intervalMs: 8 });
      for (const dt of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
        expect(emitter.accumulate(dt)).toBe(0);
        expect(emitter.debt()).toBe(0);
      }
    });

    it('recovers to a clean state after non-finite dt', () => {
      const emitter = createAirbrushEmitter({ intervalMs: 8 });
      expect(emitter.accumulate(Number.NaN)).toBe(0);
      expect(emitter.accumulate(Number.POSITIVE_INFINITY)).toBe(0);
      expect(emitter.accumulate(8)).toBe(1);
      expect(emitter.debt()).toBe(0);
    });

    it('holds debt below the interval and emits once it crosses', () => {
      const emitter = createAirbrushEmitter({ intervalMs: 8 });
      expect(emitter.accumulate(7)).toBe(0);
      expect(emitter.debt()).toBe(7);
      expect(emitter.accumulate(1)).toBe(1);
      expect(emitter.debt()).toBe(0);
    });

    it('uses the spec default interval and cap when options omit both', () => {
      const emitter = createAirbrushEmitter();
      expect(emitter.accumulate(AIRBRUSH_INTERVAL_MS)).toBe(1);
      expect(emitter.debt()).toBeCloseTo(0, 9);
    });

    describe('tripwires', () => {
      it.fails('treats Infinity maxDabsPerFrame as unlimited rather than zero', () => {
        const emitter = createAirbrushEmitter({ maxDabsPerFrame: Number.POSITIVE_INFINITY });
        expect(emitter.accumulate(1000)).toBe(120);
      });

      it.fails('preserves debt when maxDabsPerFrame collapses the cap to zero', () => {
        const emitter = createAirbrushEmitter({ intervalMs: 8, maxDabsPerFrame: 0 });
        expect(emitter.accumulate(8)).toBe(0);
        expect(emitter.debt()).toBe(8);
      });
    });
  });
});
