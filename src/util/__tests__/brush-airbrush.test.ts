import { describe, expect, it } from 'vitest';
import { AIRBRUSH_MAX_DABS_PER_FRAME, createAirbrushEmitter } from '../brush-airbrush.ts';

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

  /**
   * The interval's own guard, which nothing in this file reached.
   *
   * `intervalMs: 0` would make `debtMs / interval` an Infinity, `Math.floor(Infinity)` an
   * Infinity, and the emitter would report 8 dabs on every frame forever with a `debt` of
   * NaN. The fallback is the only thing standing between a misconfigured option and that, and
   * 16.6ms at the spec 8.3ms interval is exactly 2 dabs — the same answer a correct emitter
   * gives, so the fallback is pinned by value rather than by not throwing.
   */
  it('falls back to the spec interval for a zero, negative or non-finite interval', () => {
    for (const intervalMs of [0, -8.3, Number.NaN, Number.POSITIVE_INFINITY]) {
      const emitter = createAirbrushEmitter({ intervalMs });

      expect(emitter.accumulate(16.6), String(intervalMs)).toBe(2);
      expect(emitter.debt(), String(intervalMs)).toBeCloseTo(0, 9);
    }
  });

  /**
   * The cap's guard, and the arm that makes a misconfigured cap SILENT rather than loud.
   *
   * A non-positive or non-finite `maxDabsPerFrame` becomes `cap = 0`, so `Math.min(whole, 0)`
   * is 0 and the emitter never fires — while still consuming the debt on line 27. That
   * combination is the hazard: an airbrush that silently stops painting AND loses the time it
   * accumulated, so nothing recovers when the option is corrected.
   */
  it('emits nothing at all for a zero, negative or non-finite cap', () => {
    for (const maxDabsPerFrame of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const emitter = createAirbrushEmitter({ intervalMs: 8, maxDabsPerFrame });

      expect(emitter.accumulate(80), String(maxDabsPerFrame)).toBe(0);
      // The debt is spent even though nothing was emitted: 80ms of debt is fully drained.
      expect(emitter.debt(), String(maxDabsPerFrame)).toBe(0);
      // And it stays silent rather than catching up on a later frame.
      expect(emitter.accumulate(80), String(maxDabsPerFrame)).toBe(0);
    }
  });

  /**
   * `Math.floor` on the cap, which is what keeps the return value an INTEGER dab count.
   *
   * 9 whole intervals are available at 74.7ms; with the cap floored to 8 the answer is 8, and
   * without the floor `Math.min(9, 8.7)` is 8.7 — a fractional number of dabs handed to a
   * loop that stamps whole tips. No other case in this file uses a non-integral cap.
   */
  it('floors a fractional cap so the dab count stays an integer', () => {
    const emitter = createAirbrushEmitter({ intervalMs: 8.3, maxDabsPerFrame: 8.7 });

    expect(emitter.accumulate(9 * 8.3)).toBe(8);
    expect(Number.isInteger(emitter.accumulate(9 * 8.3))).toBe(true);

    // And a fractional cap below 1 floors to 0, which is the same silent arm as a zero cap.
    expect(createAirbrushEmitter({ intervalMs: 8, maxDabsPerFrame: 0.5 }).accumulate(80)).toBe(0);
  });
});
