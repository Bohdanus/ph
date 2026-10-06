import { describe, expect, it } from 'vitest';

import {
  RULER_ANGLE_INCREMENT_DEGREES,
  RULER_ENDPOINT_HIT_RADIUS,
  constrainRulerAngle,
  formatRulerAngle,
  formatRulerDistance,
  measureRuler,
  rulerProtractorAngle,
  type RulerMeasurement,
} from '../ruler.ts';

const at = (x: number, y: number) => ({ x, y });

describe('measureRuler', () => {
  it('reports the starting location from the pointer-down point, not from either end of the drag', () => {
    const readout = measureRuler({ start: at(12, 34), end: at(112, 84) });

    expect(readout.x).toBe(12);
    expect(readout.y).toBe(34);
  });

  it('reports W and H as unsigned distances, so a drag up and left reads like its mirror', () => {
    const downRight = measureRuler({ start: at(10, 10), end: at(110, 60) });
    const upLeft = measureRuler({ start: at(10, 10), end: at(-90, -40) });

    expect([downRight.width, downRight.height]).toEqual([100, 50]);
    expect([upLeft.width, upLeft.height]).toEqual([100, 50]);
  });

  it('reads the angle clockwise from the x axis, because y grows downward on the overlay', () => {
    // Down and to the right is a positive angle on screen; the maths-space reading of the same line
    // would be negative, and that is the number a user would call wrong.
    expect(measureRuler({ start: at(0, 0), end: at(100, 100) }).angleDegrees).toBeCloseTo(45);
    expect(measureRuler({ start: at(0, 0), end: at(100, -100) }).angleDegrees).toBeCloseTo(-45);
    expect(measureRuler({ start: at(0, 0), end: at(0, 100) }).angleDegrees).toBeCloseTo(90);
    expect(measureRuler({ start: at(0, 0), end: at(-100, 0) }).angleDegrees).toBeCloseTo(180);
  });

  it('reports the total length traveled as the hypotenuse of the drag', () => {
    expect(measureRuler({ start: at(0, 0), end: at(30, 40) }).length).toBe(50);
  });

  it('reports no second leg until a protractor makes one', () => {
    expect(measureRuler({ start: at(0, 0), end: at(30, 40) }).secondLegLength).toBeNull();
    expect(measureRuler({ start: at(0, 0), end: at(30, 0), legEnd: at(30, 40) }).secondLegLength).toBe(40);
  });

  it('re-reads A as the angle BETWEEN the legs once a protractor exists', () => {
    const withProtractor = measureRuler({ start: at(0, 0), end: at(100, 0), legEnd: at(100, 100) });

    expect(withProtractor.angleDegrees).toBeCloseTo(90);
    // The measuring line itself is unchanged by the leg: only the letter A is re-used for the
    // protractor, so D1 still measures the first leg.
    expect(withProtractor.length).toBe(100);
  });

  it('measures a zero-length drag without producing NaN anywhere', () => {
    const readout = measureRuler({ start: at(7, 7), end: at(7, 7) });

    expect(readout.length).toBe(0);
    expect(readout.angleDegrees).toBe(0);
    expect(readout.secondLegLength).toBeNull();
  });
});

describe('rulerProtractorAngle', () => {
  it('is the unsigned angle a protractor reads, so a reversed pair is the same angle', () => {
    const forward: RulerMeasurement = { start: at(0, 0), end: at(10, 0), legEnd: at(20, 0) };
    const reversed: RulerMeasurement = { start: at(20, 0), end: at(10, 0), legEnd: at(0, 0) };

    expect(rulerProtractorAngle(forward)).toBeCloseTo(180);
    expect(rulerProtractorAngle(reversed)).toBeCloseTo(180);
  });

  it('reports a straight pair as 180 and a doubled-back pair as 0', () => {
    expect(rulerProtractorAngle({ start: at(0, 0), end: at(10, 0), legEnd: at(20, 0) })).toBeCloseTo(180);
    expect(rulerProtractorAngle({ start: at(0, 0), end: at(10, 0), legEnd: at(0, 0) })).toBeCloseTo(0);
  });

  it('refuses to divide by a collapsed leg, which would otherwise read NaN', () => {
    expect(rulerProtractorAngle({ start: at(0, 0), end: at(10, 0), legEnd: at(10, 0) })).toBeNull();
    expect(rulerProtractorAngle({ start: at(5, 5), end: at(5, 5), legEnd: at(9, 9) })).toBeNull();
  });

  it('is null with no second leg at all', () => {
    expect(rulerProtractorAngle({ start: at(0, 0), end: at(10, 10) })).toBeNull();
  });
});

describe('constrainRulerAngle', () => {
  it('snaps a free drag onto the nearest 45 degree multiple, keeping its length', () => {
    // A 44 degree drag is nearer 45 than 0, so the constrained point lands on the diagonal. The
    // length that is preserved is the DRAG's, which is not 100 — the test asserts the length rather
    // than a guessed coordinate so the two halves of the claim cannot drift apart.
    const dragged = at(100, Math.tan((44 * Math.PI) / 180) * 100);
    const snapped = constrainRulerAngle(at(0, 0), dragged);

    expect((Math.atan2(snapped.y, snapped.x) * 180) / Math.PI).toBeCloseTo(45);
    expect(Math.hypot(snapped.x, snapped.y)).toBeCloseTo(Math.hypot(dragged.x, dragged.y));
    expect(snapped.x).toBeCloseTo(snapped.y);
  });

  it('snaps to every multiple of the increment, in all four quadrants', () => {
    for (const degrees of [0, 45, 90, 135, 180, -45, -90, -135]) {
      const from = at(10, 20);
      const radians = (degrees * Math.PI) / 180;
      // Perturbed off the exact multiple, so this fails unless the snap is doing the work.
      const perturbed = at(10 + 50 * Math.cos(radians) + 0.4, 20 + 50 * Math.sin(radians) - 0.4);
      const snapped = constrainRulerAngle(from, perturbed);

      const steps =
        (Math.atan2(snapped.y - from.y, snapped.x - from.x) * 180) / Math.PI / RULER_ANGLE_INCREMENT_DEGREES;
      expect(Number.isInteger(Math.round(steps * 1e6) / 1e6)).toBe(true);
      expect(Math.hypot(snapped.x - from.x, snapped.y - from.y)).toBeCloseTo(
        Math.hypot(perturbed.x - from.x, perturbed.y - from.y)
      );
    }
  });

  it('rotates rather than replacing a component, so a drag up and left stays up and left', () => {
    const snapped = constrainRulerAngle(at(0, 0), at(-100, -99));

    expect(snapped.x).toBeLessThan(0);
    expect(snapped.y).toBeLessThan(0);
  });

  it('leaves a zero-length drag where it is, because it has no angle to snap', () => {
    expect(constrainRulerAngle(at(4, 4), at(4, 4))).toEqual({ x: 4, y: 4 });
  });
});

describe('the protractor endpoint tolerance', () => {
  it('is a positive number of document pixels, so the gesture is hittable at all', () => {
    expect(RULER_ENDPOINT_HIT_RADIUS).toBeGreaterThan(0);
    expect(Number.isInteger(RULER_ENDPOINT_HIT_RADIUS)).toBe(true);
  });
});

describe('the readout formatting', () => {
  it('trims the trailing zero an exact 45 degree constraint would otherwise print', () => {
    expect(formatRulerAngle(45)).toBe('45°');
    expect(formatRulerAngle(-45)).toBe('-45°');
  });

  it('keeps the one decimal an unconstrained angle needs', () => {
    expect(formatRulerAngle(30.5)).toBe('30.5°');
    expect(formatRulerAngle(30.25)).toBe('30.3°');
  });

  it('rounds a distance to whole pixels and labels the unit', () => {
    expect(formatRulerDistance(0)).toBe('0 px');
    expect(formatRulerDistance(150.5)).toBe('151 px');
  });
});
