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
 *
 * `legAt` says WHICH end the leg hangs off. It is present exactly when the vertex is the `start`
 * end and ABSENT otherwise, because `'end'` is the overwhelmingly common case — a plain line, and a
 * leg pulled from its far end — and a field every measurement has to carry to say "the usual thing"
 * is a field that can be wrong. Adobe's gesture is "Alt-drag (Windows) or Option-drag (Mac OS) at an
 * angle from one end of the measuring line", so the leg can be pulled from either end and the vertex
 * is whichever one was grabbed.
 *
 * The obvious encoding — reversing `start` and `end` so the vertex is always `end` — is wrong, and
 * was the first version. `start` is not arbitrary: X and Y are "the starting location", so
 * reversing the pair makes the bar report the OTHER end's coordinates the instant the protractor
 * is pulled from the start, and W and H stay put while the meaning of two of the seven readouts
 * silently swaps under the pointer. Carrying the vertex as its own field keeps `start` meaning the
 * point the line was drawn from for the whole of its life.
 */
export type RulerMeasurement = {
  start: Point;
  end: Point;
  legEnd?: Point;
  legAt?: 'start' | 'end';
};

/** The end a protractor's leg hangs off. `'end'` unless the measurement names the start end. */
export const rulerLegVertex = (measurement: RulerMeasurement): Point =>
  measurement.legAt === 'start' ? measurement.start : measurement.end;

/**
 * `measurement` with its vertex recorded, and nothing else changed.
 *
 * The `'end'` case DELETES `legAt` rather than leaving the measurement alone, and that is the whole
 * reason this is a function. Returning the argument unchanged — which is what it did first, to keep a
 * far-end leg byte-identical to the shape that existed before `legAt` — makes the field write-once: a
 * line whose leg was pulled from its START end can never have it moved back, so a second Alt-drag from
 * the other end draws its leg from the wrong endpoint and reports an angle and a D2 measured at the
 * wrong vertex. The shape saving was worth nothing next to a vertex that cannot move.
 *
 * So the invariant is maintained by writing the field only when it says `'start'`, and the absence of
 * the key means `'end'` — which is what `rulerLegVertex` already reads.
 */
export const withRulerLegVertex = (measurement: RulerMeasurement, at: 'start' | 'end'): RulerMeasurement => {
  if (at === 'end') {
    if (measurement.legAt === undefined) return measurement;
    const { legAt: _dropped, ...rest } = measurement;
    return rest;
  }
  return { ...measurement, legAt: 'start' };
};

/**
 * `measurement` with `legAt` copied only when it is the start end.
 *
 * `legAt: measurement.legAt` in an object literal creates the key with value `undefined` when the
 * source has no `legAt` — which is the opposite of the invariant, and `'legAt' in moved` is then true
 * for a plain measuring line. `JSON.stringify` drops it and `toEqual` ignores it, so nothing notices
 * until something asserts on key presence. This copies the field through `withRulerLegVertex`, which
 * cannot create the key, rather than restating that rule at each of the three places a measurement is
 * rebuilt.
 */
export const carryRulerLeg = <T extends RulerMeasurement>(measurement: T): Omit<T, 'legAt'> & Pick<T, 'legAt'> =>
  measurement.legAt === undefined ? measurement : { ...measurement };

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
 *
 * The first vector radiates towards the end of the line that is NOT the vertex, which is why it is
 * named `otherEnd` rather than `start`: with the leg hanging off `end` — the common case — that is
 * `start`, and with it hanging off `start` it is `end`. Taking `start - vertex` unconditionally is
 * a zero vector in the second case, which returns `null` and renders as a blank angle for a
 * protractor the user can plainly see.
 */
export const rulerProtractorAngle = (leg: RulerMeasurement): number | null => {
  if (!leg.legEnd) return null;
  const vertex = rulerLegVertex(leg);
  const otherEnd = leg.legAt === 'start' ? leg.end : leg.start;
  const firstX = otherEnd.x - vertex.x;
  const firstY = otherEnd.y - vertex.y;
  const secondX = leg.legEnd.x - vertex.x;
  const secondY = leg.legEnd.y - vertex.y;
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
  const vertex = rulerLegVertex(measurement);
  const secondLegLength = measurement.legEnd
    ? Math.hypot(measurement.legEnd.x - vertex.x, measurement.legEnd.y - vertex.y)
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
 * How near the line's BODY a press must be to move it, in document pixels.
 *
 * Adobe states the gesture and not the tolerance: "To move the line, place the pointer on the line
 * away from either endpoint and drag the line." The `RULER_ENDPOINT_HIT_RADIUS` above is the same
 * kind of app decision, taken for the same reason — without a tolerance only a press exactly on the
 * line would move it, and the line is one pixel wide — so the two numbers are deliberately the same
 * size and the two gestures are one contiguous target: within 8 px of an end the press grabs that
 * end, and within 8 px of the line further along it grabs the whole line.
 *
 * Sharing the constant is also what makes the boundary between the two gestures predictable. They
 * meet at the midpoint of a short line, where every point is within the endpoint radius of both
 * ends, and the endpoint test is deliberately checked first so the nearer end wins rather than a
 * move that fights a resize.
 *
 * NOT divided by the contain fit, for the reason `RULER_ENDPOINT_HIT_RADIUS` is not: the tolerance
 * belongs to the image, so the same gesture is the same gesture at any zoom.
 */
export const RULER_LINE_GRAB_RADIUS = RULER_ENDPOINT_HIT_RADIUS;

/**
 * The distance from `point` to the segment `from`–`to`, zero on the segment itself.
 *
 * The perpendicular distance when the projection falls WITHIN the segment, and the distance to the
 * nearer end when it falls outside — which is what makes a press beyond an endpoint measure to that
 * endpoint rather than to the infinite line through it. A collapsed segment has no direction, so its
 * length is returned and the caller compares that against the endpoint radius it already uses.
 */
export const distanceToSegment = (point: Point, from: Point, to: Point): number => {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point.x - from.x, point.y - from.y);
  const along = ((point.x - from.x) * dx + (point.y - from.y) * dy) / lengthSquared;
  const clamped = along < 0 ? 0 : along > 1 ? 1 : along;
  return Math.hypot(point.x - (from.x + clamped * dx), point.y - (from.y + clamped * dy));
};

/** Whether `point` is near the line's body, and so a press there would MOVE it. */
export const isOnRulerLine = (line: RulerMeasurement, point: Point): boolean =>
  distanceToSegment(point, line.start, line.end) <= RULER_LINE_GRAB_RADIUS;

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
