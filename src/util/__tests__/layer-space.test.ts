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
});
