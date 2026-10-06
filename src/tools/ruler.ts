import type { Point } from '../contexts/general-types.ts';

/**
 * The Ruler tool's arithmetic.
 *
 * Everything here is a pure function over one gesture's two points, which is what makes the
 * tool's readouts testable without a canvas: `RulerToolArea` owns the pointer, this file owns
 * the numbers, and the options bar renders what this file returns.
 *
 * **The unit is the document pixel.** Adobe's rule is that "All measurements except the angle are
 * calculated in the unit of measure currently set in the Units & Rulers preference dialog box",
 * and the angle is the one readout exempt. This app has no Units & Rulers preference — the
 * measurement scale is a menu command over `Image ▸ Analysis`, which it does not implement — so
 * the only unit available is the document pixel and the angle is degrees. A pixel-length scale
 * would change five of the six numbers and none of the geometry, so it belongs on top of this file
 * rather than inside it.
 *
 * **The angle convention is screen-space.** `y` grows downward on the overlay canvas, so
 * `atan2(dy, dx)` reads 0° along +x and increases clockwise: a drag to the right and *down* is a
 * positive angle, which is how a protractor on the screen is read and therefore how Photoshop
 * reads it. The alternative — negating `dy` to work in a maths-style y-up space — reports the same
 * line as -45° and is the one number here that would look wrong to a user.
 */
export type RulerToolArgs = { toolName: 'ruler' };

/**
 * One measuring line, in overlay-canvas pixels.
 *
 * `legEnd` is the protractor's second leg and is absent until an Alt-drag makes one. It is
 * `undefined` rather than `null` because the discriminated shape is `legEnd?: Point`: "no second
 * leg" and "a second leg at the origin" must not be the same value, and a `null`-defaulted
 * optional field cannot say so.
 */
export type RulerMeasurement = {
  start: Point;
  end: Point;
  legEnd?: Point;
};

/**
 * The seven numbers Adobe's Ruler page names, in its order: "The starting location (X and Y) /
 * The horizontal (W) and vertical (H) distances traveled from the x and y axes / The angle
 * measured relative to the axis (A) / The total length traveled (D1) / The two lengths traveled
 * (D1 and D2), when you use a protractor".
 *
 * `secondLegLength` is `null` while there is no protractor, and that is what the options bar
 * renders as absent rather than as zero — a D2 of 0 would read as a second leg of no length.
 */
export type RulerReadout = {
  x: number;
  y: number;
  width: number;
  height: number;
  angleDegrees: number;
  length: number;
  secondLegLength: number | null;
};

const RADIANS_TO_DEGREES = 180 / Math.PI;

/** `Shift` constrains to 45° increments, per Adobe: "Hold down the Shift key to constrain the tool to 45° increments." */
export const RULER_ANGLE_INCREMENT_DEGREES = 45;

/**
 * Snaps a drag to the nearest 45° multiple, keeping its length.
 *
 * Adobe constrains the ANGLE, not the axis and not the sign of a component, so this rotates the
 * vector rather than replacing either component: a drag up and to the left stays up and to the
 * left, and only its slope changes. Snapping by component sign (`Math.abs(dx)`) would be a
 * different tool — that one is horizontal/vertical constraint, which Adobe does not describe for
 * this tool and which is therefore not implemented.
 *
 * A zero-length drag has no angle to snap, and `atan2(0, 0)` is 0, which would snap it to the +x
 * axis and report a length of 0 anyway; it is returned unchanged so the degenerate gesture does
 * not move.
 */
export const constrainRulerAngle = (from: Point, to: Point): Point => {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx === 0 && dy === 0) return { x: to.x, y: to.y };

  const length = Math.hypot(dx, dy);
  const steps = Math.round((Math.atan2(dy, dx) * RADIANS_TO_DEGREES) / RULER_ANGLE_INCREMENT_DEGREES);
  // Degrees back to radians is the same factor inverted: `RADIANS_TO_DEGREES` is 180/PI, so dividing
  // by it multiplies by PI/180.
  const snapped = (steps * RULER_ANGLE_INCREMENT_DEGREES) / RADIANS_TO_DEGREES;
  return { x: from.x + Math.cos(snapped) * length, y: from.y + Math.sin(snapped) * length };
};

/**
 * The angle between the two legs, in degrees, always 0..180.
 *
 * Both vectors RADIATE FROM THE VERTEX, which is what makes the result the angle a protractor reads
 * and not the angle between two directions of travel. The measuring line's own vector is
 * `end - start`, and a leg continuing straight on from it is parallel to that — the angle between
 * the two directions of travel is 0° for the one case a protractor is most often asked about, which
 * is exactly when the two legs form a straight line and the answer is 180°. So the first vector is
 * taken from the vertex back towards the start.
 *
 * `acos` of a dot product is the unsigned angle. Adobe calls these "the two lengths traveled (D1
 * and D2)" and reuses `A` for the angle between them, and a protractor's angle is unsigned.
 */
export const rulerProtractorAngle = (leg: RulerMeasurement): number | null => {
  if (!leg.legEnd) return null;
  const firstX = leg.start.x - leg.end.x;
  const firstY = leg.start.y - leg.end.y;
  const secondX = leg.legEnd.x - leg.end.x;
  const secondY = leg.legEnd.y - leg.end.y;
  const firstLength = Math.hypot(firstX, firstY);
  const secondLength = Math.hypot(secondX, secondY);
  // A collapsed leg has no direction, so there is no angle between it and anything. Dividing by a
  // zero length here would produce NaN, which renders as the string "NaN" in the options bar.
  if (firstLength === 0 || secondLength === 0) return null;
  const cosine = (firstX * secondX + firstY * secondY) / (firstLength * secondLength);
  // Floating point can push a dot product a hair outside [-1, 1] for near-parallel legs, and
  // `Math.acos` of that is NaN, so the ratio is clamped rather than trusted.
  return Math.acos(Math.min(1, Math.max(-1, cosine))) * RADIANS_TO_DEGREES;
};

/**
 * The seven readouts for one measuring line.
 *
 * `x`/`y` are the STARTING location and are therefore taken from `start`, not from either end of
 * the drag; `width`/`height` are "the horizontal (W) and vertical (H) distances traveled", so they
 * are magnitudes and never negative, which is what makes a drag up-and-left report the same W and
 * H as the drag down-and-right.
 */
export const measureRuler = (measurement: RulerMeasurement): RulerReadout => {
  const dx = measurement.end.x - measurement.start.x;
  const dy = measurement.end.y - measurement.start.y;
  const secondLegLength = measurement.legEnd
    ? Math.hypot(measurement.legEnd.x - measurement.end.x, measurement.legEnd.y - measurement.end.y)
    : null;
  const protractorAngle = rulerProtractorAngle(measurement);

  return {
    x: measurement.start.x,
    y: measurement.start.y,
    width: Math.abs(dx),
    height: Math.abs(dy),
    // With a protractor the angle is BETWEEN the legs, which is Adobe's own re-use of `A`; with
    // one leg it is the angle the line makes with the axis.
    angleDegrees: protractorAngle ?? Math.atan2(dy, dx) * RADIANS_TO_DEGREES,
    length: Math.hypot(dx, dy),
    secondLegLength,
  };
};

/**
 * How close the pointer must be to an end of the line for an Alt-drag to pull a protractor leg out
 * of it, in overlay-canvas pixels.
 *
 * Adobe states the gesture and not the tolerance: "Alt-drag (Windows) or Option-drag (Mac OS) at
 * an angle from one end of the measuring line". A tolerance is unavoidable — without one, every
 * Alt-drag anywhere on the canvas would be a protractor and there would be no way to start a fresh
 * measurement — so this is an app decision and it is stated as one rather than presented as
 * Adobe's.
 *
 * It is a fixed number of document pixels, not a constant screen size, so it is deliberately NOT
 * divided by the contain fit the way `CropToolArea` divides its chrome. The tolerance belongs to
 * the image: the same gesture 8 px from an end is a protractor at any zoom, and a target that grew
 * as the user zoomed out would stop being hittable at all.
 */
export const RULER_ENDPOINT_HIT_RADIUS = 8;

/**
 * Formats one readout for the options bar.
 *
 * Distances are whole pixels and the angle is one decimal place. A length rounded to `0` decimal
 * places is what Adobe's own page shows ("a 250 px line" reading "150.5" under a measurement
 * scale), and the angle needs a decimal because the 45° constraint puts it exactly on a multiple
 * while an unconstrained drag almost never lands there. Trailing zeros are trimmed so `45.0°`
 * does not read as a precision the drag did not have.
 */
export const formatRulerReadout = (value: number, fractionDigits: number): string => {
  const fixed = value.toFixed(fractionDigits);
  return fractionDigits === 0 || !fixed.includes('.') ? fixed : fixed.replace(/\.?0+$/, '');
};

export const formatRulerAngle = (degrees: number): string => `${formatRulerReadout(degrees, 1)}°`;

export const formatRulerDistance = (pixels: number): string => `${formatRulerReadout(pixels, 0)} px`;
