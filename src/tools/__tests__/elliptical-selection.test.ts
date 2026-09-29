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
  resolveEllipseRect,
  type EllipticalMarqueeDrag,
} from '../ellipticalSelection.ts';
import { isPointInPolygon } from '../../util/selection.ts';
import type { Point } from '../../contexts/general-types.ts';

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

const marquee = (overrides: Partial<EllipticalMarqueeDrag>): EllipticalMarqueeDrag => ({
  start: { x: 0, y: 0 },
  end: { x: 0, y: 0 },
  style: 'normal',
  fixedRatio: 1,
  fixedWidth: 100,
  fixedHeight: 100,
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

describe('resolveEllipseRect', () => {
  it('sorts a drag that runs up and to the left', () => {
    expect(resolveEllipseRect(drag({ x: 30, y: 50 }, { x: 10, y: 20 }))).toEqual({
      x1: 10,
      y1: 20,
      x2: 30,
      y2: 50,
    });
  });

  it('reads a zero-size drag as a defined no-op rather than a degenerate box', () => {
    // A click, and a drag that came back to where it started, are the same gesture as far
    // as the geometry is concerned: no extent on either axis.
    expect(resolveEllipseRect(drag({ x: 12, y: 9 }, { x: 12, y: 9 }))).toBeNull();
    expect(resolveEllipseRect(drag({ x: 12, y: 9 }, { x: 12, y: 9 }, { style: 'fixed-ratio' }))).toBeNull();
  });

  it('reads a drag with no extent on one axis as a no-op when nothing constrains it', () => {
    expect(resolveEllipseRect(drag({ x: 0, y: 0 }, { x: 40, y: 0 }))).toBeNull();
    expect(resolveEllipseRect(drag({ x: 0, y: 0 }, { x: 0, y: 40 }))).toBeNull();
  });

  it('constrains the long axis of a fixed-ratio drag to the locked ratio', () => {
    const ratio = { style: 'fixed-ratio' } as const;

    // 100 wide against 10 tall is wider than 2:1, so the height grows to match the width.
    expect(resolveEllipseRect(drag({ x: 0, y: 0 }, { x: 100, y: 10 }, { ...ratio, fixedRatio: 2 }))).toEqual({
      x1: 0,
      y1: 0,
      x2: 100,
      y2: 50,
    });
    // 10 wide against 100 tall is narrower than 2:1, so the width grows instead.
    expect(resolveEllipseRect(drag({ x: 0, y: 0 }, { x: 10, y: 100 }, { ...ratio, fixedRatio: 2 }))).toEqual({
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
      resolveEllipseRect(drag({ x: 50, y: 0 }, { x: 50, y: 40 }, { style: 'fixed-ratio', fixedRatio: 1 }))
    ).toEqual({ x1: 30, y1: 0, x2: 70, y2: 40 });
  });

  it('falls back to an unconstrained drag when the persisted ratio is unusable', () => {
    // `localStorage` is not a type checker: a ratio of 0, NaN or a negative survives a
    // hand-edited settings blob, and each of them must degrade to "no constraint" rather
    // than divide by it.
    for (const fixedRatio of [0, -2, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(resolveEllipseRect(drag({ x: 0, y: 0 }, { x: 100, y: 10 }, { style: 'fixed-ratio', fixedRatio }))).toEqual(
        { x1: 0, y1: 0, x2: 100, y2: 10 }
      );
    }
  });

  it('centres a fixed-size ellipse on the press point and ignores the drag entirely', () => {
    expect(
      resolveEllipseRect(
        drag({ x: 50, y: 60 }, { x: 0, y: 0 }, { style: 'fixed-size', fixedWidth: 100, fixedHeight: 60 })
      )
    ).toEqual({ x1: 0, y1: 30, x2: 100, y2: 90 });
  });

  it('makes a click a complete gesture in fixed-size, which is the style that needs no drag', () => {
    expect(
      resolveEllipseRect(
        drag({ x: 50, y: 60 }, { x: 50, y: 60 }, { style: 'fixed-size', fixedWidth: 100, fixedHeight: 60 })
      )
    ).toEqual({ x1: 0, y1: 30, x2: 100, y2: 90 });
  });

  it('refuses a fixed-size drag whose persisted extents cannot enclose an ellipse', () => {
    for (const fixedWidth of [0, -10, Number.NaN]) {
      expect(resolveEllipseRect(drag({ x: 5, y: 5 }, { x: 5, y: 5 }, { style: 'fixed-size', fixedWidth }))).toBeNull();
    }
    expect(
      resolveEllipseRect(drag({ x: 5, y: 5 }, { x: 5, y: 5 }, { style: 'fixed-size', fixedHeight: 0 }))
    ).toBeNull();
  });

  it('holds a shift drag to a square whatever the style says', () => {
    expect(resolveEllipseRect(drag({ x: 0, y: 0 }, { x: 80, y: 30 }, { constrainToCircle: true }))).toEqual({
      x1: 0,
      y1: 0,
      x2: 80,
      y2: 80,
    });
    // Shift is the more specific constraint: it wins over a locked 2:1 ratio, which is
    // what pressing it does in Photoshop.
    expect(
      resolveEllipseRect(
        drag({ x: 0, y: 0 }, { x: 100, y: 10 }, { style: 'fixed-ratio', fixedRatio: 2, constrainToCircle: true })
      )
    ).toEqual({ x1: 0, y1: 0, x2: 100, y2: 100 });
  });

  it('leaves a fixed-size drag on its fixed extents even with the modifiers held', () => {
    // Fixed Size already locks the size, so a circle constraint has nothing left to say
    // and the press point still supplies the centre.
    expect(
      resolveEllipseRect(
        drag(
          { x: 20, y: 20 },
          { x: 0, y: 0 },
          {
            style: 'fixed-size',
            fixedWidth: 100,
            fixedHeight: 60,
            constrainToCircle: true,
            fromCentre: true,
          }
        )
      )
    ).toEqual({ x1: -30, y1: -10, x2: 70, y2: 50 });
  });

  it('grows an alt drag from the press point out to the pointer', () => {
    // The pointer is 20px right of the press point, so under alt the press point is the
    // CENTRE and the right edge is 20px out: the box is twice the pointer's offset.
    expect(resolveEllipseRect(drag({ x: 50, y: 50 }, { x: 70, y: 60 }, { fromCentre: true }))).toEqual({
      x1: 40,
      y1: 45,
      x2: 60,
      y2: 55,
    });
    // Ratio 1 fills the axis the pointer never moved, so alt gives a 20px circle centred on
    // the press point rather than a 40px one.
    expect(
      resolveEllipseRect(
        drag({ x: 50, y: 50 }, { x: 70, y: 50 }, { style: 'fixed-ratio', fixedRatio: 1, fromCentre: true })
      )
    ).toEqual({ x1: 40, y1: 40, x2: 60, y2: 60 });
  });

  it('reads an alt drag with no extent on one axis as a no-op, like every other zero-size drag', () => {
    // Nothing in `EllipticalSelectionToolArgs` constrains it, so the honest result is that
    // the drag enclosed nothing rather than an ellipse of some invented thickness.
    expect(resolveEllipseRect(drag({ x: 50, y: 50 }, { x: 70, y: 50 }, { fromCentre: true }))).toBeNull();
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
});
