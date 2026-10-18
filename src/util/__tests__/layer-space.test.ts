import { describe, expect, it } from 'vitest';

import type { Point, Pos } from '../../contexts/general-types.ts';
import { documentPointToLayerLocal, documentPointsToLayerLocal } from '../layer-space.ts';

/** A layer at the document origin — the one case where the two spaces already agree. */
const ORIGIN: Pos = { x: 0, y: 0, width: 100, height: 80 };

/** The layer from the reported defect: a stroke on it landed 40px right and 25px down. */
const OFFSET: Pos = { x: 40, y: 25, width: 100, height: 80 };

/** A layer at a NEGATIVE origin, which a move or a crop off the top-left can produce. */
const NEGATIVE: Pos = { x: -12, y: -7, width: 60, height: 60 };

describe('documentPointToLayerLocal', () => {
  it('is the identity at the origin', () => {
    expect(documentPointToLayerLocal({ x: 0, y: 0 }, ORIGIN)).toEqual({ x: 0, y: 0 });
    expect(documentPointToLayerLocal({ x: 37, y: 62 }, ORIGIN)).toEqual({ x: 37, y: 62 });
  });

  it('rebases a non-origin layer by exactly its origin offset', () => {
    // The document point on the layer's own top-left corner is layer-local (0, 0), and
    // nothing else: every document x/y moves by precisely -40 / -25, never by a scaled
    // or rounded amount.
    expect(documentPointToLayerLocal({ x: 40, y: 25 }, OFFSET)).toEqual({ x: 0, y: 0 });
    expect(documentPointToLayerLocal({ x: 0, y: 0 }, OFFSET)).toEqual({ x: -40, y: -25 });
    expect(documentPointToLayerLocal({ x: 100, y: 60 }, OFFSET)).toEqual({ x: 60, y: 35 });
  });

  it('adds back a negative origin rather than clamping it', () => {
    expect(documentPointToLayerLocal({ x: 0, y: 0 }, NEGATIVE)).toEqual({ x: 12, y: 7 });
    expect(documentPointToLayerLocal({ x: -12, y: -7 }, NEGATIVE)).toEqual({ x: 0, y: 0 });
  });

  it('carries fractional coordinates through untouched', () => {
    expect(documentPointToLayerLocal({ x: 10.5, y: 20.25 }, { x: 4, y: 2, width: 8, height: 8 })).toEqual({
      x: 6.5,
      y: 18.25,
    });
    // Fractional on the origin too: the layer's own position is not integral, and a
    // stroke on it is still a stroke on it.
    expect(documentPointToLayerLocal({ x: 10.5, y: 20.25 }, { x: 0.5, y: 0.25, width: 8, height: 8 })).toEqual({
      x: 10,
      y: 20,
    });
  });

  it('keeps a negative document coordinate negative rather than folding it', () => {
    expect(documentPointToLayerLocal({ x: -30, y: -12 }, ORIGIN)).toEqual({ x: -30, y: -12 });
  });

  it('treats a null or undefined layer position as the origin, and does not throw', () => {
    const point = { x: 5, y: 9 };
    expect(() => documentPointToLayerLocal(point, undefined)).not.toThrow();
    expect(() => documentPointToLayerLocal(point, null)).not.toThrow();
    expect(documentPointToLayerLocal(point, undefined)).toEqual({ x: 5, y: 9 });
    expect(documentPointToLayerLocal(point, null)).toEqual({ x: 5, y: 9 });
  });

  it('returns a new point, never the one it was handed', () => {
    const point = { x: 40, y: 25 };
    expect(documentPointToLayerLocal(point, ORIGIN)).not.toBe(point);
    // Identity at the origin is a coincidence of VALUES; the object is still a copy, which
    // is what stops a caller mutating a hook's live accumulator in place.
    expect(documentPointToLayerLocal(point, ORIGIN)).toEqual(point);
  });

  it('propagates non-finite point coordinates through the rebase without throwing', () => {
    // The module is a pure subtraction with no input sanitiser, so a NaN/Infinity sample — a
    // corrupt gesture, not a real coordinate — passes straight through. This pins the CURRENT
    // contract; the tripwire at the foot of the file argues the boundary ought to refuse it.
    expect(documentPointToLayerLocal({ x: Number.NaN, y: 5 }, OFFSET)).toEqual({ x: Number.NaN, y: -20 });
    expect(documentPointToLayerLocal({ x: Infinity, y: -Infinity }, OFFSET)).toEqual({
      x: Infinity,
      y: -Infinity,
    });
    // Only the axis a non-finite value touches goes non-finite: a NaN origin corrupts just the
    // coordinate it is subtracted from.
    expect(documentPointToLayerLocal({ x: 40, y: 25 }, { x: Number.NaN, y: 0, width: 1, height: 1 })).toEqual({
      x: Number.NaN,
      y: 25,
    });
  });

  it('does not coerce a non-finite layerPos to the origin, per the deliberate non-guard', () => {
    // A NaN origin is a corrupt store, deliberately distinct from an absent (null/undefined)
    // one: absent rebases as (0, 0) and yields the document point back, but NaN must NOT
    // silently become 0 — that is the wrong-raster failure this module exists to make impossible.
    expect(
      documentPointToLayerLocal({ x: 40, y: 25 }, { x: Number.NaN, y: Number.NaN, width: 100, height: 80 })
    ).toEqual({ x: Number.NaN, y: Number.NaN });
    // The corrupted result is not the document point folded to the origin.
    expect(
      documentPointToLayerLocal({ x: 40, y: 25 }, { x: Number.NaN, y: Number.NaN, width: 100, height: 80 })
    ).not.toEqual({ x: 40, y: 25 });
  });

  it('rebases a layerPos carrying Infinity without throwing', () => {
    // Infinity is no real origin, but the module does not guard it either: the subtraction still
    // runs and the result reflects IEEE-754 arithmetic, never the origin. Infinity on an axis
    // inverts the sign of the offset it is subtracted from.
    expect(documentPointToLayerLocal({ x: 40, y: 25 }, { x: Infinity, y: -Infinity, width: 1, height: 1 })).toEqual({
      x: -Infinity,
      y: Infinity,
    });
    expect(documentPointToLayerLocal({ x: 40, y: 25 }, { x: -Infinity, y: -Infinity, width: 1, height: 1 })).toEqual({
      x: Infinity,
      y: Infinity,
    });
  });

  it('rebases a zero-size layer exactly, whose dimensions are irrelevant to the origin', () => {
    // A 0x0 layer still presents a buffer staged at its origin, and the rebase only reads
    // `x`/`y`; width/height never enter the arithmetic. The layer's own corner still maps to
    // (0, 0), and a document point on it still rebases by the origin.
    const zero: Pos = { x: 7, y: 3, width: 0, height: 0 };
    expect(documentPointToLayerLocal({ x: 7, y: 3 }, zero)).toEqual({ x: 0, y: 0 });
    expect(documentPointToLayerLocal({ x: 0, y: 0 }, zero)).toEqual({ x: -7, y: -3 });
    expect(documentPointToLayerLocal({ x: 12.5, y: 16.5 }, zero)).toEqual({ x: 5.5, y: 13.5 });
  });

  it('rebases large offsets exactly within double precision', () => {
    // A layer pushed far from the document origin still rebases by plain subtraction: the
    // layer's own corner is (0, 0) in its local frame, and a point a billion pixels to its
    // right is a billion pixels in — exact at this magnitude (well under MAX_SAFE_INTEGER).
    const far: Pos = { x: 1_000_000_000, y: -1_000_000_000, width: 100, height: 80 };
    expect(documentPointToLayerLocal({ x: 1_000_000_000, y: -1_000_000_000 }, far)).toEqual({ x: 0, y: 0 });
    expect(documentPointToLayerLocal({ x: 2_000_000_000, y: 0 }, far)).toEqual({ x: 1_000_000_000, y: 1_000_000_000 });
  });

  it('returns a new point for a non-finite result, never the input', () => {
    // The no-mutation contract holds even when the arithmetic is non-finite: the result is still
    // a fresh object, so a caller can never alias a hook accumulator.
    const point = { x: Number.NaN, y: 0 };
    const result = documentPointToLayerLocal(point, OFFSET);
    expect(result).not.toBe(point);
    expect(result).toEqual({ x: Number.NaN, y: -25 });
  });
});

describe('documentPointsToLayerLocal', () => {
  it('returns an empty array for an empty input', () => {
    const points: Point[] = [];
    const result = documentPointsToLayerLocal(points, OFFSET);
    expect(result).toEqual([]);
    expect(result).not.toBe(points);
  });

  it('rebases a single point', () => {
    expect(documentPointsToLayerLocal([{ x: 40, y: 25 }], OFFSET)).toEqual([{ x: 0, y: 0 }]);
  });

  it('rebases a whole gesture by the origin offset', () => {
    const stroke = [
      { x: 40, y: 25 },
      { x: 60.5, y: 45 },
      { x: 90, y: 30.25 },
    ];

    expect(documentPointsToLayerLocal(stroke, OFFSET)).toEqual([
      { x: 0, y: 0 },
      { x: 20.5, y: 20 },
      { x: 50, y: 5.25 },
    ]);
    // The input is untouched: every value is what it was before the call.
    expect(stroke).toEqual([
      { x: 40, y: 25 },
      { x: 60.5, y: 45 },
      { x: 90, y: 30.25 },
    ]);
  });

  it('preserves order and length', () => {
    const stroke: Point[] = Array.from({ length: 12 }, (_unused, index) => ({ x: index * 7, y: index * 3 }));
    const result = documentPointsToLayerLocal(stroke, OFFSET);

    expect(result).toHaveLength(stroke.length);
    expect(result.map((point) => point.x + OFFSET.x)).toEqual(stroke.map((point) => point.x));
    expect(result.map((point) => point.y + OFFSET.y)).toEqual(stroke.map((point) => point.y));
  });

  it('returns a new array with new points, sharing no identity with the input', () => {
    const stroke = [
      { x: 40, y: 25 },
      { x: 60, y: 45 },
    ];
    const result = documentPointsToLayerLocal(stroke, OFFSET);

    expect(result).not.toBe(stroke);
    result.forEach((point, index) => {
      expect(point).not.toBe(stroke[index]);
    });
  });

  it('does not alias the input when the rebased result is mutated', () => {
    // The hazard this pins: `onMove` is handed `usePaintStroke`'s LIVE array, the same
    // object every later move appends to, and history retains whatever it is given. An
    // in-place rebase would move the hook's own accumulator, and the stroke would creep
    // diagonally by the layer origin on every frame.
    const stroke = [
      { x: 40, y: 25 },
      { x: 60, y: 45 },
    ];
    const snapshot = stroke.map((point) => ({ ...point }));

    const result = documentPointsToLayerLocal(stroke, OFFSET);
    result[0].x = -999;
    result[0].y = -999;
    result.push({ x: 0, y: 0 });

    expect(stroke).toEqual(snapshot);
    expect(stroke).toHaveLength(2);
  });

  it('treats a null or undefined layer position as the origin, and does not throw', () => {
    const stroke = [
      { x: 1, y: 2 },
      { x: 3, y: 4 },
    ];

    expect(() => documentPointsToLayerLocal(stroke, undefined)).not.toThrow();
    expect(() => documentPointsToLayerLocal(stroke, null)).not.toThrow();
    expect(documentPointsToLayerLocal(stroke, undefined)).toEqual(stroke);
    expect(documentPointsToLayerLocal(stroke, null)).toEqual(stroke);
  });

  it('reverses cleanly under the translation, which is the round trip there is', () => {
    // There is deliberately no exported inverse in the codebase: `documentToCanvasPoint`
    // in `src/contexts/document-frame.ts` is the canvas<->document pair, and
    // `worldPointToLayerLocal` in `src/contexts/affine-transform.ts:252` also folds in the
    // layer's affine operation, which a processor never sees. The arithmetic is undone
    // here by hand, the same way `src/contexts/__tests__/affine-transform.matrix.test.ts`
    // undoes it, rather than inventing an API this change does not need.
    const stroke = [
      { x: 0, y: 0 },
      { x: 40, y: 25 },
      { x: 137.5, y: -4.25 },
    ];

    for (const layerPos of [ORIGIN, OFFSET, NEGATIVE]) {
      const back = documentPointsToLayerLocal(stroke, layerPos).map((point) => ({
        x: point.x + layerPos.x,
        y: point.y + layerPos.y,
      }));

      expect(back).toEqual(stroke);
    }
  });

  it('propagates a single non-finite point in a gesture while rebasing the rest', () => {
    // A corrupt sample does not take out the whole gesture: the rebase maps each point
    // independently, so the NaN leaks only into its own coordinate and every other point is
    // rebased by the origin exactly as before.
    const stroke = [
      { x: 40, y: 25 },
      { x: Number.NaN, y: 50 },
      { x: 90, y: 30 },
    ];
    const snapshot = stroke.map((point) => ({ ...point }));

    expect(documentPointsToLayerLocal(stroke, OFFSET)).toEqual([
      { x: 0, y: 0 },
      { x: Number.NaN, y: 25 },
      { x: 50, y: 5 },
    ]);
    // The input gesture is left exactly as it was found.
    expect(stroke).toEqual(snapshot);
  });

  it('propagates a non-finite layerPos across every element of a gesture', () => {
    // A corrupt origin corrupts the whole gesture the same way it corrupts a single point:
    // every coordinate it is subtracted from goes non-finite, and the result is still a fresh
    // array with fresh elements.
    const stroke = [
      { x: 40, y: 25 },
      { x: 60, y: 45 },
    ];
    const result = documentPointsToLayerLocal(stroke, { x: Number.NaN, y: Number.NaN, width: 100, height: 80 });

    expect(result).toEqual([
      { x: Number.NaN, y: Number.NaN },
      { x: Number.NaN, y: Number.NaN },
    ]);
    expect(result).not.toBe(stroke);
    expect(result[0]).not.toBe(stroke[0]);
  });

  it('rebases a gesture against a zero-size layer exactly as against any origin', () => {
    const zero: Pos = { x: 7, y: 3, width: 0, height: 0 };
    const stroke = [
      { x: 7, y: 3 },
      { x: 12.5, y: 16.5 },
    ];

    expect(documentPointsToLayerLocal(stroke, zero)).toEqual([
      { x: 0, y: 0 },
      { x: 5.5, y: 13.5 },
    ]);
  });

  it('round-trips a large-offset gesture back to the original points', () => {
    // The only operation this module does is a translation, so adding the layer origin back to
    // each rebased point restores the document-space gesture exactly, even at a billion-pixel
    // offset.
    const far: Pos = { x: 1_000_000_000, y: -1_000_000_000, width: 100, height: 80 };
    const stroke = [
      { x: 0, y: 0 },
      { x: 1_000_000_000, y: -1_000_000_000 },
      { x: 1_500_000_000, y: 2_000_000_000 },
    ];

    const back = documentPointsToLayerLocal(stroke, far).map((point) => ({
      x: point.x + far.x,
      y: point.y + far.y,
    }));

    expect(back).toEqual(stroke);
  });
});

describe('known gaps (it.fails tripwires)', () => {
  // Tripwires pin behaviour the module *ought* to have but does not yet: a passing tripwire
  // here is red until the gap is closed, then flips green and reports itself. The rest of the
  // codebase sanitises non-finite numerics at the tool-callback boundary (tolerance in
  // magicWand, alpha/radius in paint tools, etc.), but the layer rebase that `usePaintStroke`
  // hands a processor does not. A non-finite sample is a corrupt gesture, not a coordinate,
  // and propagating NaN through it silently nullifies the segment downstream (every
  // `distance <= NaN` is false) with no signal — the exact class of silent stroke failure
  // this module exists to make impossible, just from the other input. Note this targets the
  // POINT, never the layerPos: a non-finite origin is the deliberate non-guard above.

  it.fails('rebases a non-finite point onto a finite coordinate instead of emitting NaN', () => {
    const result = documentPointToLayerLocal({ x: Number.NaN, y: 0 }, OFFSET);

    expect(Number.isFinite(result.x)).toBe(true);
    expect(Number.isFinite(result.y)).toBe(true);
  });

  it.fails('does not leak a non-finite sample into a rebased gesture', () => {
    const result = documentPointsToLayerLocal(
      [
        { x: Number.NaN, y: 0 },
        { x: 60, y: 45 },
      ],
      OFFSET
    );

    expect(result.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))).toBe(true);
  });
});
