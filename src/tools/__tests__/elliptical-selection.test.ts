import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { defaultSettings } from '../settings.ts';
import { toolProcessors } from '../toolProcessors.ts';
import { createMockCanvasContext, createMockImageBitmap } from '../../__tests__/fixtures/canvas.ts';
import {
  ELLIPSE_MAX_SAGITTA_PX,
  ELLIPSE_MAX_VERTICES,
  ELLIPSE_MIN_VERTICES,
  ellipsePointsFromDrag,
  ellipsePointsInRect,
  ellipseVertexCount,
  isMarqueeStyle,
  resolveUnclampedEllipseRect,
  type EllipticalMarqueeDrag,
} from '../ellipticalSelection.ts';
import { isPointInPolygon } from '../../util/selection.ts';
import type { Point, Size } from '../../contexts/general-types.ts';

type MockCtx = ReturnType<typeof createMockCanvasContext>;

class RecordingOffscreenCanvas {
  static instances: RecordingOffscreenCanvas[] = [];

  width: number;
  height: number;
  readonly ctx: MockCtx;

  constructor(width: number, height: number) {
    this.width = Math.max(1, Math.ceil(width));
    this.height = Math.max(1, Math.ceil(height));
    this.ctx = createMockCanvasContext({ canvas: this });
    RecordingOffscreenCanvas.instances.push(this);
  }

  getContext(): MockCtx {
    return this.ctx;
  }
}

const bitmap = createMockImageBitmap(40, 24);

/** The same 200x120 the tool area's store mock carries, so both levels clamp against one bound. */
const DOCUMENT: Size = { width: 200, height: 120 };
/**
 * A document no case can reach the edge of, and the DEFAULT every case below resolves against.
 *
 * It is the default so that a case about the drag's own arithmetic does not have to say anything
 * about the document: the clip is the identity on any ring inside 4000x4000, and every
 * pre-existing expectation in this file is about such a ring. The cases that ARE about the bound
 * pass `imageSize: DOCUMENT` explicitly.
 */
const ROOMY: Size = { width: 4000, height: 4000 };

const marquee = (overrides: Partial<EllipticalMarqueeDrag>): EllipticalMarqueeDrag => ({
  start: { x: 0, y: 0 },
  end: { x: 0, y: 0 },
  style: 'normal',
  fixedRatio: 1,
  fixedWidth: 100,
  fixedHeight: 100,
  imageSize: ROOMY,
  ...overrides,
});

const drag = (start: Point, end: Point, overrides: Partial<EllipticalMarqueeDrag> = {}) =>
  marquee({ start, end, ...overrides });

/** The distance from `center` to a point, spelled out so the circle assertions read as geometry. */
const radiusOf = (center: Point, point: Point): number => Math.hypot(point.x - center.x, point.y - center.y);

/**
 * `max(|v[i] - v[i+1]|)` over the loop INCLUDING the wrap from the last vertex to the
 * first. The wrap is what proves the point path is a closed loop: an ellipse whose angles
 * run `i / n * 2 * PI` has one identical segment there, and an implementation that
 * dropped the last vertex, or appended the first point again, would show it here.
 */
function segmentLengths(points: Point[]): number[] {
  return points.map((point, index) => {
    const next = points[(index + 1) % points.length];

    return Math.hypot(next.x - point.x, next.y - point.y);
  });
}

beforeEach(() => {
  RecordingOffscreenCanvas.instances = [];
  vi.stubGlobal('OffscreenCanvas', RecordingOffscreenCanvas as unknown as typeof OffscreenCanvas);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * `src/tools/ellipticalSelection.ts` publishes the marquee arg contract and the geometry
 * the tool area commits from. The processor is a pass-through like every other selection
 * tool's, so the contract worth pinning is the seeded defaults plus the drag → box →
 * polygon pipeline, which is where the behaviour actually lives.
 */
describe('ellipticalSelection type contract', () => {
  it('declares settings as exactly the arg fields, stamped with its own tool name', () => {
    const settings = defaultSettings['elliptical-selection'];

    expect(Object.keys(settings).sort()).toEqual(['fixedHeight', 'fixedRatio', 'fixedWidth', 'style', 'toolName']);
    expect(settings.toolName).toBe('elliptical-selection');
  });

  it('registers as a selection creator whose processor hands the source bitmap straight back', () => {
    const result = toolProcessors['elliptical-selection'].imageProcessor({ size: { width: 40, height: 24 }, bitmap })(
      defaultSettings['elliptical-selection'] as never
    );

    expect(toolProcessors['elliptical-selection'].commit).toBe('selection');
    expect(toolProcessors['elliptical-selection'].creator).toBe(true);
    expect(result[0]).toBe(bitmap);
    // A creator has no pixels to produce, so a canvas here would be a rasterizer that
    // does not exist. Asserted on the recorded instances rather than on the return value,
    // because `[bitmap]` is what both a pass-through and a wrongly rasterized tool can
    // be made to look like.
    expect(RecordingOffscreenCanvas.instances).toEqual([]);
  });

  it('keeps the seeded style inside the union the options bar can render', () => {
    expect(isMarqueeStyle(defaultSettings['elliptical-selection'].style)).toBe(true);
    expect(isMarqueeStyle('fixed-ratio')).toBe(true);
    expect(isMarqueeStyle('fixed-size')).toBe(true);
    expect(isMarqueeStyle('rectangle')).toBe(false);
  });

  it('hands a creator-param call no source bitmap, and yields the undefined that throws', () => {
    // `sourceBitmap` in src/contexts/materialization.ts calls every `creator: true` processor as
    // `imageProcessor({ size })(args)`, with no `bitmap` at all. The processor reads that member
    // straight out of the params and returns it, so on the creator path it yields `undefined`.
    //
    // `undefined` is a LATENT THROW, not a handled case: `materialization.ts:172` rejects it with
    // `Source tool … produced no raster`. So this is pinned so the `creator: true` registry
    // entry and the `ProcessorToolParams` the processor declares stay VISIBLE as a mismatch —
    // the assertion records the current behaviour and does not claim it is correct.
    expect(toolProcessors['elliptical-selection'].creator).toBe(true);

    const result = toolProcessors['elliptical-selection'].imageProcessor({ size: { width: 40, height: 24 } })(
      defaultSettings['elliptical-selection'] as never
    );

    expect(result).toEqual([undefined]);
    // The pass-through must not quietly acquire a canvas: a creator that rasterized here
    // would be a rasterizer `commit: 'selection'` has nowhere to commit.
    expect(RecordingOffscreenCanvas.instances).toEqual([]);
  });
});

describe('resolveUnclampedEllipseRect', () => {
  it('sorts a drag that runs up and to the left', () => {
    expect(resolveUnclampedEllipseRect(drag({ x: 30, y: 50 }, { x: 10, y: 20 }))).toEqual({
      x1: 10,
      y1: 20,
      x2: 30,
      y2: 50,
    });
  });

  it('reads a zero-size drag as a defined no-op rather than a degenerate box', () => {
    // A click, and a drag that came back to where it started, are the same gesture as far
    // as the geometry is concerned: no extent on either axis.
    expect(resolveUnclampedEllipseRect(drag({ x: 12, y: 9 }, { x: 12, y: 9 }))).toBeNull();
    expect(resolveUnclampedEllipseRect(drag({ x: 12, y: 9 }, { x: 12, y: 9 }, { style: 'fixed-ratio' }))).toBeNull();
  });

  it('reads a drag with no extent on one axis as a no-op when nothing constrains it', () => {
    expect(resolveUnclampedEllipseRect(drag({ x: 0, y: 0 }, { x: 40, y: 0 }))).toBeNull();
    expect(resolveUnclampedEllipseRect(drag({ x: 0, y: 0 }, { x: 0, y: 40 }))).toBeNull();
  });

  it('constrains the long axis of a fixed-ratio drag to the locked ratio', () => {
    const ratio = { style: 'fixed-ratio' } as const;

    // 100 wide against 10 tall is wider than 2:1, so the height grows to match the width.
    expect(resolveUnclampedEllipseRect(drag({ x: 0, y: 0 }, { x: 100, y: 10 }, { ...ratio, fixedRatio: 2 }))).toEqual({
      x1: 0,
      y1: 0,
      x2: 100,
      y2: 50,
    });
    // 10 wide against 100 tall is narrower than 2:1, so the width grows instead.
    expect(resolveUnclampedEllipseRect(drag({ x: 0, y: 0 }, { x: 10, y: 100 }, { ...ratio, fixedRatio: 2 }))).toEqual({
      x1: 0,
      y1: 0,
      x2: 200,
      y2: 100,
    });
  });

  it('centres a fixed-ratio drag on the axis it never moved along', () => {
    // A straight-down drag of a 1:1 ratio is a circle hanging below the press point, not
    // a circle pushed to one side of it.
    expect(
      resolveUnclampedEllipseRect(drag({ x: 50, y: 0 }, { x: 50, y: 40 }, { style: 'fixed-ratio', fixedRatio: 1 }))
    ).toEqual({ x1: 30, y1: 0, x2: 70, y2: 40 });
  });

  it('falls back to an unconstrained drag when the persisted ratio is unusable', () => {
    // `localStorage` is not a type checker: a ratio of 0, NaN or a negative survives a
    // hand-edited settings blob, and each of them must degrade to "no constraint" rather
    // than divide by it.
    for (const fixedRatio of [0, -2, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        resolveUnclampedEllipseRect(drag({ x: 0, y: 0 }, { x: 100, y: 10 }, { style: 'fixed-ratio', fixedRatio }))
      ).toEqual({ x1: 0, y1: 0, x2: 100, y2: 10 });
    }
  });

  it('centres a fixed-size ellipse on the press point and ignores the drag entirely', () => {
    expect(
      resolveUnclampedEllipseRect(
        drag({ x: 50, y: 60 }, { x: 0, y: 0 }, { style: 'fixed-size', fixedWidth: 100, fixedHeight: 60 })
      )
    ).toEqual({ x1: 0, y1: 30, x2: 100, y2: 90 });
  });

  it('makes a click a complete gesture in fixed-size, which is the style that needs no drag', () => {
    expect(
      resolveUnclampedEllipseRect(
        drag({ x: 50, y: 60 }, { x: 50, y: 60 }, { style: 'fixed-size', fixedWidth: 100, fixedHeight: 60 })
      )
    ).toEqual({ x1: 0, y1: 30, x2: 100, y2: 90 });
  });

  it('refuses a fixed-size drag whose persisted extents cannot enclose an ellipse', () => {
    for (const fixedWidth of [0, -10, Number.NaN]) {
      expect(
        resolveUnclampedEllipseRect(drag({ x: 5, y: 5 }, { x: 5, y: 5 }, { style: 'fixed-size', fixedWidth }))
      ).toBeNull();
    }
    expect(
      resolveUnclampedEllipseRect(drag({ x: 5, y: 5 }, { x: 5, y: 5 }, { style: 'fixed-size', fixedHeight: 0 }))
    ).toBeNull();
  });

  it('holds a shift drag to a square whatever the style says', () => {
    expect(resolveUnclampedEllipseRect(drag({ x: 0, y: 0 }, { x: 80, y: 30 }, { constrainToCircle: true }))).toEqual({
      x1: 0,
      y1: 0,
      x2: 80,
      y2: 80,
    });
    // Shift is the more specific constraint: it wins over a locked 2:1 ratio, which is
    // what pressing it does in Photoshop.
    expect(
      resolveUnclampedEllipseRect(
        drag({ x: 0, y: 0 }, { x: 100, y: 10 }, { style: 'fixed-ratio', fixedRatio: 2, constrainToCircle: true })
      )
    ).toEqual({ x1: 0, y1: 0, x2: 100, y2: 100 });
  });

  it('leaves a fixed-size drag on its fixed extents even with the modifiers held', () => {
    // Fixed Size already locks the size, so a circle constraint has nothing left to say
    // and the press point still supplies the centre. The press point is at (60, 60) rather than
    // near the origin so the 100x60 box lands inside `DOCUMENT` whole: this case is about the
    // extents surviving the modifiers, and a box the document bound crops would be evidence
    // about the bound instead. The overflow case for this style is below.
    expect(
      resolveUnclampedEllipseRect(
        drag(
          { x: 60, y: 60 },
          { x: 0, y: 0 },
          {
            style: 'fixed-size',
            fixedWidth: 100,
            fixedHeight: 60,
            constrainToCircle: true,
            fromCentre: true,
            imageSize: DOCUMENT,
          }
        )
      )
    ).toEqual({ x1: 10, y1: 30, x2: 110, y2: 90 });
  });

  it('resolves an overflowing drag to its unclamped box, because the bound is a clip', () => {
    // A drag past the right and bottom edges keeps every pixel of its own extent here. The
    // document is not consulted at all in this half of the pipeline, so the box a drag that
    // overflows resolves to is the box the pointer described. `ellipsePointsFromDrag` is where
    // the document bounds the result, and it does so by cutting the ring rather than by
    // shrinking this box — the two rules produce different ellipses and only the clip is
    // Photoshop's.
    expect(resolveUnclampedEllipseRect(drag({ x: 150, y: 100 }, { x: 260, y: 140 }, { imageSize: DOCUMENT }))).toEqual({
      x1: 150,
      y1: 100,
      x2: 260,
      y2: 140,
    });
  });

  it('resolves a drag from negative coordinates to the unclamped box, for the same reason', () => {
    expect(resolveUnclampedEllipseRect(drag({ x: -30, y: -20 }, { x: 60, y: 40 }, { imageSize: DOCUMENT }))).toEqual({
      x1: -30,
      y1: -20,
      x2: 60,
      y2: 40,
    });
  });

  it('resolves an overflowing fixed-size drag to its fixed extents, whatever the document holds', () => {
    const click = { x: 20, y: 20 };
    const fixed = { style: 'fixed-size', fixedWidth: 100, fixedHeight: 60 } as const;

    // A 60x40 document and a 100x60 press point: the box hangs 30px off the left, 10px off the
    // top, 10px off the right and 10px off the bottom. Fixed Size is a click, so this is the
    // whole gesture — and the box is the fixed one, which is what makes the clip below the only
    // thing standing between a fixed-size marquee and the pixels the document does not hold.
    expect(resolveUnclampedEllipseRect(drag(click, click, { ...fixed, imageSize: { width: 60, height: 40 } }))).toEqual(
      { x1: -30, y1: -10, x2: 70, y2: 50 }
    );
    // The control: the same fixed box at a press point a large document holds is the same four
    // numbers, so the assertion above is about the document and not about the style.
    expect(
      resolveUnclampedEllipseRect(drag({ x: 60, y: 60 }, { x: 60, y: 60 }, { ...fixed, imageSize: DOCUMENT }))
    ).toEqual({ x1: 10, y1: 30, x2: 110, y2: 90 });
  });

  it('squares a shift drag before the document bounds it, so the circle is 260 across', () => {
    // 260x40 under Shift squares to 260x260 at the origin. The ORDER is what this case pins and
    // only this half of the pipeline can state it: bounding the 260x40 drag first would square a
    // 200x40 instead, and the ring would be a different shape entirely rather than the same
    // circle with its top cut off. The control is not an order control — it is the same
    // "the bound is conditional" control as above, since a 260x260 box fits inside 4000x4000.
    expect(
      resolveUnclampedEllipseRect(
        drag({ x: 0, y: 0 }, { x: 260, y: 40 }, { constrainToCircle: true, imageSize: DOCUMENT })
      )
    ).toEqual({ x1: 0, y1: 0, x2: 260, y2: 260 });
    expect(
      resolveUnclampedEllipseRect(
        drag({ x: 0, y: 0 }, { x: 260, y: 40 }, { constrainToCircle: true, imageSize: ROOMY })
      )
    ).toEqual({ x1: 0, y1: 0, x2: 260, y2: 260 });
  });

  it('reads a drag that lands wholly outside the document as no ellipse at all', () => {
    // (300, 200) to (340, 240) in a 200x120 document: every edge is past the far corner, so the
    // box is a real one — it is the CLIP in `ellipsePointsFromDrag` that leaves nothing, because
    // none of the ring is on the canvas. Asserting it here would be asserting the clip from the
    // half of the pipeline that does not clip.
    expect(resolveUnclampedEllipseRect(drag({ x: 300, y: 200 }, { x: 340, y: 240 }, { imageSize: DOCUMENT }))).toEqual({
      x1: 300,
      y1: 200,
      x2: 340,
      y2: 240,
    });
    expect(resolveUnclampedEllipseRect(drag({ x: 300, y: 200 }, { x: 340, y: 240 }, { imageSize: ROOMY }))).toEqual({
      x1: 300,
      y1: 200,
      x2: 340,
      y2: 240,
    });
  });

  it('grows an alt drag from the press point out to the pointer', () => {
    // The pointer is 20px right of the press point, so under alt the press point is the
    // CENTRE and the right edge is 20px out: the box is twice the pointer's offset.
    expect(resolveUnclampedEllipseRect(drag({ x: 50, y: 50 }, { x: 70, y: 60 }, { fromCentre: true }))).toEqual({
      x1: 40,
      y1: 45,
      x2: 60,
      y2: 55,
    });
    // Ratio 1 fills the axis the pointer never moved, so alt gives a 20px circle centred on
    // the press point rather than a 40px one.
    expect(
      resolveUnclampedEllipseRect(
        drag({ x: 50, y: 50 }, { x: 70, y: 50 }, { style: 'fixed-ratio', fixedRatio: 1, fromCentre: true })
      )
    ).toEqual({ x1: 40, y1: 40, x2: 60, y2: 60 });
  });

  it('reads an alt drag with no extent on one axis as a no-op, like every other zero-size drag', () => {
    // Nothing in `EllipticalSelectionToolArgs` constrains it, so the honest result is that
    // the drag enclosed nothing rather than an ellipse of some invented thickness.
    expect(resolveUnclampedEllipseRect(drag({ x: 50, y: 50 }, { x: 70, y: 50 }, { fromCentre: true }))).toBeNull();
  });
});

describe('ellipseVertexCount', () => {
  it.each([
    [5, ELLIPSE_MIN_VERTICES],
    [10, ELLIPSE_MIN_VERTICES],
    [50, 32],
    [100, 45],
    [1000, 141],
  ])('spends %i px of radius on %i vertices', (radius, expected) => {
    // A circle-inscribed-in-a-square drag at 200px therefore tessellates to 45 vertices,
    // and a 2000px one to 141. The count rises with the radius because the sagitta of a
    // chord is proportional to it, not because a bigger ellipse is proportionally cruder.
    expect(ellipseVertexCount(radius, radius)).toBe(expected);
  });

  it('clamps at the coarsest ring and at the ceiling', () => {
    expect(ellipseVertexCount(0, 0)).toBe(ELLIPSE_MIN_VERTICES);
    expect(ellipseVertexCount(0.1, 0.1)).toBe(ELLIPSE_MIN_VERTICES);
    // 5.7k px of radius is what the ceiling corresponds to, so this is not reachable by a
    // real document; it is here so a corrupted persisted size cannot allocate unboundedly.
    expect(ellipseVertexCount(1e6, 1e6)).toBe(ELLIPSE_MAX_VERTICES);
  });

  it('never spends fewer vertices on a bigger radius', () => {
    let previous = 0;
    for (const radius of [4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048]) {
      const count = ellipseVertexCount(radius, radius);
      expect(count).toBeGreaterThanOrEqual(previous);
      previous = count;
    }
  });

  it('spends on the major axis so the minor axis is held to the same error', () => {
    expect(ellipseVertexCount(100, 3)).toBe(ellipseVertexCount(100, 100));
  });

  it('keeps every chord inside the sagitta bound, and no more than it', () => {
    for (const radius of [20, 100, 500, 1000, 4000]) {
      const count = ellipseVertexCount(radius, radius);
      const sagitta = radius * (1 - Math.cos(Math.PI / count));

      expect(sagitta, `radius ${radius}`).toBeLessThanOrEqual(ELLIPSE_MAX_SAGITTA_PX);
      // The bound is tight: one vertex fewer must breach it, or the count is spending
      // vertices no error budget asked for. The clamped ends are exempt because their
      // count is set by the clamp, not by the sagitta.
      if (count > ELLIPSE_MIN_VERTICES && count < ELLIPSE_MAX_VERTICES) {
        expect(radius * (1 - Math.cos(Math.PI / (count - 1))), `radius ${radius}`).toBeGreaterThan(
          ELLIPSE_MAX_SAGITTA_PX
        );
      }
    }
  });
});

describe('ellipsePointsInRect', () => {
  it('emits the vertex count its radii call for, starting at the rightmost point', () => {
    const points = ellipsePointsInRect({ x1: 0, y1: 0, x2: 200, y2: 200 });

    expect(points).toHaveLength(45);
    expect(points[0].x).toBeCloseTo(200, 9);
    expect(points[0].y).toBeCloseTo(100, 9);
  });

  it('puts every vertex on the true ellipse', () => {
    const points = ellipsePointsInRect({ x1: 0, y1: 0, x2: 300, y2: 200 });

    for (const point of points) {
      const normalized = ((point.x - 150) / 150) ** 2 + ((point.y - 100) / 100) ** 2;
      expect(normalized).toBeCloseTo(1, 9);
    }
  });

  it('closes the loop by the wrap and never repeats the first vertex', () => {
    // A `Selection.points` array is an open polyline the renderer and the hit test both
    // wrap from the last vertex to the first, so a repeated closing point would add a
    // zero-length segment and a duplicated handle at the top of the ellipse.
    const points = ellipsePointsInRect({ x1: 0, y1: 0, x2: 200, y2: 200 });

    expect(points[0]).not.toEqual(points[points.length - 1]);
    expect(points).toHaveLength(new Set(points.map(({ x, y }) => `${x},${y}`)).size);

    const lengths = segmentLengths(points);
    // The wrap is one ordinary step: an implementation that dropped the last vertex
    // would show a final segment of twice the length here.
    for (const length of lengths) {
      expect(length).toBeCloseTo(lengths[0], 9);
    }
  });

  it('produces an exact circle from a square drag, to float precision', () => {
    const center = { x: 100, y: 100 };
    const points = ellipsePointsInRect({ x1: 0, y1: 0, x2: 200, y2: 200 });

    for (const point of points) {
      expect(radiusOf(center, point)).toBeCloseTo(100, 9);
    }
  });
});

describe('ellipsePointsFromDrag', () => {
  it('inscribes the ellipse in the dragged box rather than circumscribing it', () => {
    const points = ellipsePointsFromDrag(drag({ x: 0, y: 0 }, { x: 200, y: 200 }));

    expect(points).not.toBeNull();
    // The corners of the box are outside the ellipse and the centre is inside it, which
    // is the whole difference between an inscribed and a circumscribed fit.
    expect(isPointInPolygon({ x: 0, y: 0 }, points!)).toBe(false);
    expect(isPointInPolygon({ x: 200, y: 200 }, points!)).toBe(false);
    expect(isPointInPolygon({ x: 100, y: 100 }, points!)).toBe(true);
    // A point halfway up the radius is still inside, and one just past it is not.
    expect(isPointInPolygon({ x: 100, y: 100 - 99 }, points!)).toBe(true);
    expect(isPointInPolygon({ x: 100, y: 100 - 101 }, points!)).toBe(false);
  });

  it('commits the same points for a shift drag as the square box it resolved to', () => {
    const shifted = ellipsePointsFromDrag(drag({ x: 0, y: 0 }, { x: 200, y: 40 }, { constrainToCircle: true }));
    const square = ellipsePointsFromDrag(drag({ x: 0, y: 0 }, { x: 200, y: 200 }));

    expect(shifted).toEqual(square);
  });

  it('reports a click as no selection at all', () => {
    expect(ellipsePointsFromDrag(drag({ x: 10, y: 10 }, { x: 10, y: 10 }))).toBeNull();
    expect(ellipsePointsFromDrag(drag({ x: 10, y: 10 }, { x: 40, y: 10 }))).toBeNull();
  });

  it('scales the vertex count with the drag rather than pinning it', () => {
    const small = ellipsePointsFromDrag(drag({ x: 0, y: 0 }, { x: 100, y: 100 }))!;
    const big = ellipsePointsFromDrag(drag({ x: 0, y: 0 }, { x: 2000, y: 2000 }))!;

    expect(small).toHaveLength(ellipseVertexCount(50, 50));
    expect(big).toHaveLength(ellipseVertexCount(1000, 1000));
    expect(big.length).toBeGreaterThan(small.length);
  });

  it('commits a polygon whose every vertex is inside the document the drag was bounded by', () => {
    const points = ellipsePointsFromDrag(drag({ x: 150, y: 100 }, { x: 260, y: 140 }, { imageSize: DOCUMENT }))!;

    expect(points).not.toBeNull();
    // Every extreme is now ON its edge rather than short of it by the declared sagitta, because
    // the edge is where the clip put it — a crossing point is placed on the boundary exactly, so
    // no tolerance is wanted anywhere in this loop.
    expect(Math.max(...points.map((point) => point.x))).toBe(200);
    expect(Math.max(...points.map((point) => point.y))).toBe(120);
    for (const point of points) {
      expect(point.x).toBeLessThanOrEqual(200);
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.y).toBeLessThanOrEqual(120);
      expect(point.y).toBeGreaterThanOrEqual(0);
    }
  });

  it('places a clipped vertex ON the document edge rather than within a rounding error of it', () => {
    // A drag from inside the canvas well past the far corner, on a ring large enough that its two
    // crossings of the bottom edge land far from that edge's endpoints. Measured, not assumed:
    // this exact drag reads `120.00000000000003` at its crossings when the boundary is computed
    // back out of a ratio of rounded values, and exactly `120` when it is assigned.
    const points = ellipsePointsFromDrag(drag({ x: 9, y: 9 }, { x: 241, y: 194 }, { imageSize: DOCUMENT }))!;

    expect(points).not.toBeNull();
    // Two crossings of the bottom edge, plus the document corner itself — the corner is inside
    // this ellipse, so the clipped shape has a straight run along the bottom edge with the corner
    // in the middle of it. Only the crossings are at stake here.
    expect(points.filter((point) => point.y === 120).length).toBeGreaterThanOrEqual(2);
    expect(points.some((point) => point.x === 200 && point.y === 120)).toBe(true);
    // Every one of them is a document edge exactly, so no vertex sits a rounding error outside
    // one. This is the assertion the other cases cannot make: `toBeLessThanOrEqual` and a plain
    // `toBe` both pass on `120.00000000000003`, and for most drags the interpolated value happens
    // to round back to the boundary, so the rule needs a case chosen to miss.
    for (const point of points) {
      expect(point.x <= 200 && point.x >= 0 && point.y <= 120 && point.y >= 0).toBe(true);
    }
  });

  it('clips the ring at the document edge instead of inscribing a smaller ellipse', () => {
    // A 200x200 drag on a 200x120 document is a circle of radius 100 about (100, 100), so only
    // its bottom cap is on the canvas.
    const points = ellipsePointsFromDrag(drag({ x: 0, y: 0 }, { x: 200, y: 200 }, { imageSize: DOCUMENT }))!;

    expect(points).not.toBeNull();
    // The circle's own leftmost point is (0, 100) — level with the centre the user dragged about
    // — so a committed vertex within a pixel of the left edge still has to sit near that height.
    // Trimming the 200x200 box to 200x120 and inscribing the ring again would move the centre to
    // (100, 60), which puts every vertex within a pixel of the left edge near y = 60 and makes
    // this false. That single assertion is the difference between clipping and cropping.
    expect(points.some((point) => point.x < 1 && point.y > 90)).toBe(true);
    // The chord the clip leaves along the bottom is the canvas edge itself, and the ring still
    // spans the full width the drag described at the height the drag described.
    expect(Math.max(...points.map((point) => point.y))).toBe(120);
    expect(Math.max(...points.map((point) => point.x))).toBeGreaterThan(199);
    // The control: the same drag on a document no edge can reach keeps the ring whole, so the
    // assertion above is the clip and not the tessellation.
    const unclipped = ellipsePointsFromDrag(drag({ x: 0, y: 0 }, { x: 200, y: 200 }, { imageSize: ROOMY }))!;
    expect(Math.max(...unclipped.map((point) => point.y))).toBeGreaterThan(199);
  });

  it('clips a fixed-size ellipse that overflows the document, with no pointer involvement at all', () => {
    const click = { x: 20, y: 20 };
    const fixed = { style: 'fixed-size', fixedWidth: 100, fixedHeight: 60 } as const;

    // A 60x40 document and a 100x60 press point: the ring is a 100x60 ellipse about (20, 20) and
    // hangs off every edge, so its commit is the ring cut at the document — a shape with four
    // straight chords, which is what a fixed-size marquee at the corner of a small document
    // selects. The centre is still (20, 20), which is inside: a clip never moves the centre.
    const points = ellipsePointsFromDrag(drag(click, click, { ...fixed, imageSize: { width: 60, height: 40 } }))!;

    expect(points).not.toBeNull();
    for (const point of points) {
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.x).toBeLessThanOrEqual(60);
      expect(point.y).toBeGreaterThanOrEqual(0);
      expect(point.y).toBeLessThanOrEqual(40);
    }
    // The ring's own top vertex is (20, -10), so the clip has to cut the top and the shape has to
    // come back with an edge lying on y = 0 rather than an arc bowing above it.
    expect(points.some((point) => point.y === 0)).toBe(true);
    expect(Math.max(...points.map((point) => point.y))).toBe(40);
    // The control: the same fixed click on a document that holds it commits the whole ring, so
    // the assertions above are the clip and not the fixed style.
    const unclipped = ellipsePointsFromDrag(
      drag({ x: 60, y: 60 }, { x: 60, y: 60 }, { ...fixed, imageSize: DOCUMENT })
    )!;
    expect(Math.max(...unclipped.map((point) => point.y))).toBe(90);
  });

  it('cuts a shift drag down to its on-canvas cap, which is the same circle the drag resolved', () => {
    // 260x40 under Shift squares to 260x260 about (130, 130) at the origin, so a 200x120 document
    // holds its bottom cap and nothing else. The order is observable here in a way the box cannot
    // show: bounding the 260x40 drag first would square a 200x40 and commit a wide ellipse, while
    // squaring first and clipping leaves a circular cap whose widest chord is at the circle's own
    // centre height.
    const points = ellipsePointsFromDrag(
      drag({ x: 0, y: 0 }, { x: 260, y: 40 }, { constrainToCircle: true, imageSize: DOCUMENT })
    )!;

    expect(points).not.toBeNull();
    for (const point of points) {
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.x).toBeLessThanOrEqual(200);
      expect(point.y).toBeGreaterThanOrEqual(-ELLIPSE_MAX_SAGITTA_PX);
      expect(point.y).toBeLessThanOrEqual(120);
    }
    // A 260-wide circle cap on a 200-wide document touches both the right edge and the bottom,
    // and where those two clip edges meet the DOCUMENT CORNER is a vertex of the committed shape.
    // That corner is the clearest statement of the rule in the file: the ring is cut, and cutting
    // to a rectangle leaves the rectangle's own corner in the result.
    expect(points.some((point) => point.x === 200 && point.y === 120)).toBe(true);
    // The circle is TANGENT to the top edge at (130, 0), and the exact tangent point need not be
    // one of the ring's vertices, so the cap stops a fraction of a pixel short of the edge rather
    // than touching it. The shortfall is bounded by the same declared sagitta as every other
    // chord, which is why the assertion is the bound and not zero.
    expect(Math.min(...points.map((point) => point.y))).toBeLessThanOrEqual(ELLIPSE_MAX_SAGITTA_PX);
  });

  it('reads a drag that lands wholly outside the document as no selection at all', () => {
    // (300, 200) to (340, 240) in a 200x120 document: the box is a real one and the ring is a
    // real one, but no part of the ring is on the canvas, so the clip leaves nothing.
    //
    // This case does NOT tell the clip apart from the crop it replaced: `trimRect2` collapsed
    // the same box to a point at the far corner and its positive-extent guard answered `null` too.
    // It pins the shared contract that a drag which encloses nothing on the canvas commits
    // nothing, and the cases above are the ones that separate the two rules.
    expect(ellipsePointsFromDrag(drag({ x: 300, y: 200 }, { x: 340, y: 240 }, { imageSize: DOCUMENT }))).toBeNull();
    // The control: the same drag on a document no edge can reach is a whole ellipse.
    expect(ellipsePointsFromDrag(drag({ x: 300, y: 200 }, { x: 340, y: 240 }, { imageSize: ROOMY }))).not.toBeNull();
  });

  it('refuses a drag whose box is not finite, rather than committing a ring of NaN', () => {
    // `getLocalCoords` divides by the contain scale, which is zero while a container is collapsed,
    // so a pointer still arriving through the pointer capture can carry a non-finite coordinate
    // into the drag. `ellipseVertexCount` answers its 720-vertex cap for an infinite radius and
    // the ring then emits `NaN` on the half of itself the sign makes negative, so nothing
    // downstream would stop it: `normalizeSelectionPoints` only counts vertices.
    expect(ellipsePointsFromDrag(drag({ x: 0, y: 0 }, { x: Number.POSITIVE_INFINITY, y: 40 }))).toBeNull();
    expect(ellipsePointsFromDrag(drag({ x: 0, y: 0 }, { x: 40, y: Number.NEGATIVE_INFINITY }))).toBeNull();
    expect(ellipsePointsFromDrag(drag({ x: Number.NaN, y: 0 }, { x: 40, y: 40 }))).toBeNull();
    // The control: the same drags with finite edges commit, so the three above are the guard and
    // not the drag's own arithmetic refusing them. Each is the same box with one edge finite.
    expect(ellipsePointsFromDrag(drag({ x: 0, y: 0 }, { x: 40, y: 40 }))).not.toBeNull();
  });
});
