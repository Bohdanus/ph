/**
 * Fallback coverage for `src/contexts/affine-transform.ts`:
 * `getLayerPresentationCorners` and `getTransformFromHistoryArgs`. Both are pure
 * geometry helpers that every layer command depends on, and both have fallback
 * branches that silently widen a result instead of throwing, so the fallbacks are
 * pinned here rather than left to whatever the runtime layer happens to look like.
 *
 * The layer-level EXTENT is not covered here, because it is not this module's: it is
 * `layerPresentationBounds()` in `src/contexts/presentation-evaluator.ts`, and one test below reads
 * it only to pin the one case in which the corners and the extent are the same box.
 */
import { describe, expect, it } from 'vitest';

import { getLayerPresentationCorners, getTransformFromHistoryArgs } from '../affine-transform.ts';
import { layerPresentationBounds } from '../presentation-evaluator.ts';
import type { Layer } from '../layer-types.ts';

const pos = { x: 100, y: 50, width: 200, height: 100 };

function makeLayer(operations: Layer['operations'] = []): Layer {
  return {
    id: 'layer-1',
    name: 'Layer 1',
    isBedrock: false,
    visible: true,
    opacity: 1,
    locked: false,
    blendMode: 'source-over',
    order: 0,
    pos: { ...pos },
    bitmap: null,
    tmpCanvas: null,
    operations,
  };
}

describe('getLayerPresentationCorners', () => {
  it('returns the untransformed corners of the layer position by default', () => {
    const corners = getLayerPresentationCorners(makeLayer());

    // Clockwise from the top-left, in the layer's own coordinate space.
    expect(corners).toEqual([
      { x: 100, y: 50 },
      { x: 300, y: 50 },
      { x: 300, y: 150 },
      { x: 100, y: 150 },
    ]);
  });

  it('offsets the corners by an explicitly supplied position instead of layer.pos', () => {
    const corners = getLayerPresentationCorners(makeLayer(), { x: 0, y: 0, width: 200, height: 100 });

    expect(corners).toEqual([
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 100 },
      { x: 0, y: 100 },
    ]);
  });

  it('applies the retained affine operations before offsetting by the position', () => {
    const layer = makeLayer([
      {
        id: 'op-scale',
        kind: 'affine-transform',
        transform: { a: 2, b: 0, c: 0, d: 2, e: 10, f: 5 },
        enabled: true,
      },
    ]);

    // Local box is 200x100, doubled to 400x200, then translated by (10, 5)
    // inside the layer and offset by layer.pos on the way out.
    expect(getLayerPresentationCorners(layer)).toEqual([
      { x: 110, y: 55 },
      { x: 510, y: 55 },
      { x: 510, y: 255 },
      { x: 110, y: 255 },
    ]);
  });

  it('ignores a disabled affine operation, so the corners stay untransformed', () => {
    const layer = makeLayer([
      {
        id: 'op-disabled',
        kind: 'affine-transform',
        transform: { a: 2, b: 0, c: 0, d: 2, e: 10, f: 5 },
        enabled: false,
      },
    ]);

    expect(getLayerPresentationCorners(layer)).toEqual(getLayerPresentationCorners(makeLayer()));
  });

  it('agrees with the presentation extent on the axis-aligned case, where the filters add nothing', () => {
    // The corners are matrix-only and the extent carries the retained filters' spread, so they are
    // the same box only when no filter contributes a margin — which is what this layer is. The
    // fixture is the point: the agreement asserted here is the one that can be had, and a layer
    // with a filter is covered where the margin is the subject.
    const layer = makeLayer();

    const xs = getLayerPresentationCorners(layer).map((point) => point.x);
    const ys = getLayerPresentationCorners(layer).map((point) => point.y);
    const bounds = layerPresentationBounds(layer);

    expect(bounds).toEqual({
      x: Math.min(...xs),
      y: Math.min(...ys),
      width: Math.max(...xs) - Math.min(...xs),
      height: Math.max(...ys) - Math.min(...ys),
    });
  });
});

describe('getTransformFromHistoryArgs', () => {
  const size = { width: 400, height: 300 };

  it('returns undefined for a non-object argument instead of throwing', () => {
    for (const args of [null, undefined, 7, 'transform', true]) {
      expect(getTransformFromHistoryArgs(args, size)).toBeUndefined();
    }
  });

  it('returns undefined for an object that is neither a retained transform nor tool args', () => {
    expect(getTransformFromHistoryArgs({ toolName: 'blur', radius: 4 }, size)).toBeUndefined();
    expect(getTransformFromHistoryArgs({}, size)).toBeUndefined();
  });

  it('throws for a retained transform that fails validation rather than returning undefined', () => {
    // `getTransformFromHistoryArgs` is documented to return
    // `AffineTransform | null | undefined`, but a non-finite or structurally
    // incomplete retained matrix raises out of `validateAffineTransform`
    // instead of degrading. Every caller of this helper therefore has to be
    // inside a try/catch; `history-replay.ts` is, via its per-entry guard.
    expect(() =>
      getTransformFromHistoryArgs(
        { toolName: 'transform', transform: { a: Number.NaN, b: 0, c: 0, d: 1, e: 0, f: 0 } },
        size
      )
    ).toThrow(/invalid or extreme values/);
    expect(() =>
      getTransformFromHistoryArgs({ toolName: 'transform', transform: { a: 1, b: 0, c: 0, d: 1 } }, size)
    ).toThrow(/invalid or extreme values/);
  });

  it('throws for non-finite live transform tool args instead of returning a NaN matrix', () => {
    expect(() =>
      getTransformFromHistoryArgs(
        {
          toolName: 'transform',
          toolMode: 'transform',
          start: { x: 0, y: 0 },
          end: { x: 400, y: 300 },
          trapezoid: 0,
          ratio: 1,
          resizeX: Number.NaN,
        },
        size
      )
    ).toThrow(/must be finite/);
  });

  it('returns the retained transform verbatim when it is valid', () => {
    const transform = { a: 2, b: 0, c: 0, d: 2, e: 12, f: 34 };

    expect(getTransformFromHistoryArgs({ toolName: 'transform', transform }, size)).toEqual(transform);
  });

  it('converts live transform tool args into a matrix', () => {
    const result = getTransformFromHistoryArgs(
      {
        toolName: 'transform',
        toolMode: 'transform',
        start: { x: 0, y: 0 },
        end: { x: 400, y: 300 },
        trapezoid: 0,
        ratio: 1,
      },
      size
    );

    // `not.toBeNull()` and `toBeDefined()` are the same claim; the finiteness sweep below is
    // the assertion that can actually fail (a NaN from a degenerate drag).
    expect(result).not.toBeNull();
    for (const value of Object.values(result as Record<string, number>)) {
      expect(Number.isFinite(value)).toBe(true);
    }
  });

  it('returns the identity matrix for a zero-extent drag', () => {
    const result = getTransformFromHistoryArgs(
      {
        toolName: 'transform',
        toolMode: 'transform',
        start: { x: 10, y: 10 },
        end: { x: 10, y: 10 },
        trapezoid: 0,
        ratio: 1,
      },
      size
    );

    expect(result).toEqual({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
  });

  it('returns null for a trapezoid-only transform, the one case that has no affine form', () => {
    // The single reachable `null`: a recorded trapezoid cannot be expressed as
    // an affine matrix, so the helper hands the entry to the raster path.
    const result = getTransformFromHistoryArgs(
      {
        toolName: 'transform',
        toolMode: 'transform',
        start: { x: 0, y: 0 },
        end: { x: 400, y: 300 },
        trapezoid: 0.25,
        ratio: 1,
      },
      size
    );

    expect(result).toBeNull();
  });
});
