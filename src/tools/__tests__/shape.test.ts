import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  drawShape,
  isFigureType,
  normalizeFigure,
  normalizeShapeGeometry,
  setShapeCtx,
  shape,
  shapeGeometryBounds,
  type ShapeToolArgs,
} from '../shape.ts';
import type { Ctx2D, Point } from '../../contexts/general-types.ts';
import type { CreatorToolParams } from '../toolProcessors.ts';

const baseArgs: ShapeToolArgs = {
  toolName: 'shape',
  figure: 'rectangle',
  alpha: 1,
  color: '#000000',
  backgroundColor: null,
  lineWidth: 2,
};

const createCtx = () =>
  ({
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    quadraticCurveTo: vi.fn(),
    closePath: vi.fn(),
    ellipse: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    clearRect: vi.fn(),
    setLineDash: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
  }) as unknown as Ctx2D & Record<string, ReturnType<typeof vi.fn>>;

type PathMethod =
  'beginPath' | 'moveTo' | 'lineTo' | 'quadraticCurveTo' | 'closePath' | 'fill' | 'stroke' | 'fillRect' | 'strokeRect';
type PathCall = { method: PathMethod; args: number[] };

/**
 * Records the ordered canvas calls so a whole path can be compared as one
 * sequence. Asserting call-by-call with `toHaveBeenCalledWith` cannot tell a
 * mirrored path from the one it should equal, because the same arguments recur.
 */
const createRecordingCtx = () => {
  const calls: PathCall[] = [];
  const record = (method: PathMethod) => vi.fn((...args: number[]) => void calls.push({ method, args }));
  const ctx = {
    beginPath: record('beginPath'),
    moveTo: record('moveTo'),
    lineTo: record('lineTo'),
    quadraticCurveTo: record('quadraticCurveTo'),
    closePath: record('closePath'),
    ellipse: vi.fn(),
    fill: record('fill'),
    stroke: record('stroke'),
    fillRect: record('fillRect'),
    strokeRect: record('strokeRect'),
    clearRect: vi.fn(),
    setLineDash: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
  };
  return { ctx: ctx as unknown as Ctx2D, calls };
};

/** The geometry of a path, without the beginPath/closePath/fill/stroke wrapper. */
const pathCalls = (calls: PathCall[]) =>
  calls.filter(({ method }) => method === 'moveTo' || method === 'lineTo' || method === 'quadraticCurveTo');

const noModifiers = { shiftKey: false, altKey: false };

describe('normalizeFigure', () => {
  it('passes through every supported figure unchanged', () => {
    for (const figure of ['line', 'rectangle', 'oval', 'triangle', 'polygon'] as const) {
      expect(normalizeFigure(figure)).toBe(figure);
      expect(isFigureType(figure)).toBe(true);
    }
  });

  it('maps the legacy circle figure onto oval', () => {
    expect(normalizeFigure('circle')).toBe('oval');
    expect(isFigureType('circle')).toBe(false);
  });

  it('maps the legacy square figure onto rectangle', () => {
    expect(normalizeFigure('square')).toBe('rectangle');
    expect(isFigureType('square')).toBe(false);
  });

  it('falls back to rectangle for unknown or missing figures', () => {
    expect(normalizeFigure(undefined)).toBe('rectangle');
    expect(normalizeFigure(null)).toBe('rectangle');
    expect(normalizeFigure('blob')).toBe('rectangle');
    expect(normalizeFigure(42)).toBe('rectangle');
  });
});

describe('normalizeShapeGeometry', () => {
  it('leaves an unconstrained drag untouched', () => {
    const result = normalizeShapeGeometry({ x: 10, y: 20 }, { x: 90, y: 45 }, 'rectangle', noModifiers);
    expect(result).toEqual({ start: { x: 10, y: 20 }, end: { x: 90, y: 45 } });
  });

  it('does not mutate the anchor it is given', () => {
    const anchor = { x: 10, y: 20 };
    normalizeShapeGeometry(anchor, { x: 90, y: 45 }, 'oval', { shiftKey: true, altKey: true });
    expect(anchor).toEqual({ x: 10, y: 20 });
  });

  describe.each(['rectangle', 'oval'] as const)('%s with shift', (figure) => {
    it('uses the larger absolute drag dimension', () => {
      // |90-10| = 80, |45-20| = 25 → side 80
      const result = normalizeShapeGeometry({ x: 10, y: 20 }, { x: 90, y: 45 }, figure, {
        shiftKey: true,
        altKey: false,
      });
      expect(result).toEqual({ start: { x: 10, y: 20 }, end: { x: 90, y: 100 } });
    });

    it('uses the larger absolute drag dimension on the vertical axis', () => {
      // |60-10| = 50, |100-20| = 80 → side 80
      const result = normalizeShapeGeometry({ x: 10, y: 20 }, { x: 60, y: 100 }, figure, {
        shiftKey: true,
        altKey: false,
      });
      expect(result).toEqual({ start: { x: 10, y: 20 }, end: { x: 90, y: 100 } });
    });

    it.each([
      ['south-east', { x: 190, y: 140 }, { x: 90, y: 90 }],
      ['south-west', { x: 10, y: 140 }, { x: -90, y: 90 }],
      ['north-east', { x: 190, y: -40 }, { x: 90, y: -90 }],
      ['north-west', { x: 10, y: -40 }, { x: -90, y: -90 }],
    ])('leaves an already-square %s drag unchanged and keeps its quadrant', (_name, pointer, delta) => {
      const result = normalizeShapeGeometry({ x: 100, y: 50 }, pointer, figure, { shiftKey: true, altKey: false });
      expect(result.start).toEqual({ x: 100, y: 50 });
      expect(result.end).toEqual(pointer);
      expect({ x: result.end.x - result.start.x, y: result.end.y - result.start.y }).toEqual(delta);
    });

    it.each([
      ['south-east', { x: 190, y: 120 }, { x: 190, y: 140 }],
      ['south-west', { x: -70, y: 120 }, { x: -70, y: 220 }],
      ['north-east', { x: 190, y: -80 }, { x: 230, y: -80 }],
      ['north-west', { x: -70, y: -80 }, { x: -70, y: -120 }],
    ])('expands the shorter axis to the longer one in the %s quadrant', (_name, pointer, expectedEnd) => {
      const result = normalizeShapeGeometry({ x: 100, y: 50 }, pointer, figure, { shiftKey: true, altKey: false });
      expect(result.start).toEqual({ x: 100, y: 50 });
      expect(result.end).toEqual(expectedEnd);
      expect(Math.abs(result.end.x - result.start.x)).toBe(Math.abs(result.end.y - result.start.y));
    });

    it('draws from the center with alt, keeping the anchor as the midpoint', () => {
      const result = normalizeShapeGeometry({ x: 100, y: 100 }, { x: 150, y: 130 }, figure, {
        shiftKey: false,
        altKey: true,
      });
      expect(result).toEqual({ start: { x: 50, y: 70 }, end: { x: 150, y: 130 } });
      expect((result.start.x + result.end.x) / 2).toBe(100);
      expect((result.start.y + result.end.y) / 2).toBe(100);
    });

    it('constrains to a centered square or circle with shift and alt', () => {
      const result = normalizeShapeGeometry({ x: 100, y: 100 }, { x: 150, y: 130 }, figure, {
        shiftKey: true,
        altKey: true,
      });
      // half = max(50, 30) = 50, so the anchor stays the exact center.
      expect(result).toEqual({ start: { x: 50, y: 50 }, end: { x: 150, y: 150 } });
      expect((result.start.x + result.end.x) / 2).toBe(100);
      expect((result.start.y + result.end.y) / 2).toBe(100);
      expect(Math.abs(result.end.x - result.start.x)).toBe(Math.abs(result.end.y - result.start.y));
    });

    it.each([
      ['south-east', { x: 150, y: 130 }],
      ['south-west', { x: 50, y: 130 }],
      ['north-east', { x: 150, y: 70 }],
      ['north-west', { x: 50, y: 70 }],
    ])('keeps the anchor centered in the %s quadrant with shift and alt', (_name, pointer) => {
      const result = normalizeShapeGeometry({ x: 100, y: 100 }, pointer, figure, { shiftKey: true, altKey: true });
      expect((result.start.x + result.end.x) / 2).toBe(100);
      expect((result.start.y + result.end.y) / 2).toBe(100);
      expect(Math.abs(result.end.x - result.start.x)).toBe(Math.abs(result.end.y - result.start.y));
      expect(Math.sign(result.end.x - result.start.x)).toBe(Math.sign(pointer.x - 100) || 1);
      expect(Math.sign(result.end.y - result.start.y)).toBe(Math.sign(pointer.y - 100) || 1);
    });

    it('treats a zero-length axis as a positive direction', () => {
      const result = normalizeShapeGeometry({ x: 10, y: 10 }, { x: 40, y: 10 }, figure, {
        shiftKey: true,
        altKey: false,
      });
      expect(result).toEqual({ start: { x: 10, y: 10 }, end: { x: 40, y: 40 } });
    });
  });

  describe('line', () => {
    it('returns the raw drag without shift', () => {
      const result = normalizeShapeGeometry({ x: 10, y: 20 }, { x: 90, y: 45 }, 'line', {
        shiftKey: false,
        altKey: false,
      });
      expect(result).toEqual({ start: { x: 10, y: 20 }, end: { x: 90, y: 45 } });
    });

    it('mirrors through the anchor without shift when alt is held', () => {
      const result = normalizeShapeGeometry({ x: 10, y: 20 }, { x: 90, y: 45 }, 'line', {
        shiftKey: false,
        altKey: true,
      });
      expect(result).toEqual({ start: { x: -70, y: -5 }, end: { x: 90, y: 45 } });
    });

    it('snaps the angle to a 45 degree multiple while preserving the length', () => {
      const result = normalizeShapeGeometry({ x: 10, y: 20 }, { x: 90, y: 45 }, 'line', {
        shiftKey: true,
        altKey: false,
      });

      // length = hypot(80, 25); angle = atan2(25, 80) rounds to 0
      const length = Math.hypot(80, 25);
      expect(result.start).toEqual({ x: 10, y: 20 });
      expect(result.end.x).toBeCloseTo(10 + length, 5);
      expect(result.end.y).toBeCloseTo(20, 5);
      expect(result.end).not.toEqual({ x: 90, y: 45 });
    });

    it('snaps a steep drag up to 45 degrees', () => {
      const result = normalizeShapeGeometry({ x: 0, y: 0 }, { x: 30, y: 40 }, 'line', {
        shiftKey: true,
        altKey: false,
      });

      const length = Math.hypot(30, 40);
      const snapped = length / Math.SQRT2;
      expect(result.end.x).toBeCloseTo(snapped, 5);
      expect(result.end.y).toBeCloseTo(snapped, 5);
    });

    it('snaps a vertical drag onto the vertical axis', () => {
      const result = normalizeShapeGeometry({ x: 0, y: 0 }, { x: 3, y: 40 }, 'line', {
        shiftKey: true,
        altKey: false,
      });

      const length = Math.hypot(3, 40);
      expect(result.end.x).toBeCloseTo(0, 5);
      expect(result.end.y).toBeCloseTo(length, 5);
    });

    it('mirrors through the anchor before snapping when shift and alt are held', () => {
      const result = normalizeShapeGeometry({ x: 10, y: 20 }, { x: 90, y: 45 }, 'line', {
        shiftKey: true,
        altKey: true,
      });

      // The mirror yields dx = -80, dy = -25, which quantizes to -pi.
      const length = Math.hypot(80, 25);
      expect(result.start).toEqual({ x: 10, y: 20 });
      expect(result.end.x).toBeCloseTo(10 - length, 5);
      expect(result.end.y).toBeCloseTo(20, 5);
    });

    it('keeps a zero-length snap degenerate instead of calling atan2(0, 0)', () => {
      const result = normalizeShapeGeometry({ x: 12, y: 34 }, { x: 12, y: 34 }, 'line', {
        shiftKey: true,
        altKey: false,
      });
      expect(result).toEqual({ start: { x: 12, y: 34 }, end: { x: 12, y: 34 } });
    });
  });

  it.each(['triangle', 'polygon'] as const)('keeps %s geometry consistent with the other figures', (figure) => {
    expect(normalizeShapeGeometry({ x: 0, y: 0 }, { x: 30, y: 10 }, figure, noModifiers)).toEqual({
      start: { x: 0, y: 0 },
      end: { x: 30, y: 10 },
    });
    expect(normalizeShapeGeometry({ x: 0, y: 0 }, { x: 30, y: 10 }, figure, { shiftKey: true, altKey: false })).toEqual(
      { start: { x: 0, y: 0 }, end: { x: 30, y: 30 } }
    );
  });
});

describe('shapeGeometryBounds', () => {
  it('pads the geometry by half the stroke plus one pixel on each side', () => {
    const bounds = shapeGeometryBounds({ start: { x: 10, y: 20 }, end: { x: 50, y: 60 } }, 2);
    expect(bounds).toEqual({ x: 8, y: 18, width: 44, height: 44 });
  });

  it('handles a negative drag direction', () => {
    const bounds = shapeGeometryBounds({ start: { x: 50, y: 60 }, end: { x: 10, y: 20 } }, 2);
    expect(bounds).toEqual({ x: 8, y: 18, width: 44, height: 44 });
  });

  it('is symmetric for a Shift-constrained square', () => {
    const geometry = normalizeShapeGeometry({ x: 10, y: 20 }, { x: 50, y: 80 }, 'rectangle', {
      shiftKey: true,
      altKey: false,
    });
    const bounds = shapeGeometryBounds(geometry, 2);
    expect(bounds.width).toBe(bounds.height);
    expect(bounds).toEqual({ x: 8, y: 18, width: 64, height: 64 });
  });

  it('accounts for the full stroke width', () => {
    const bounds = shapeGeometryBounds({ start: { x: 0, y: 0 }, end: { x: 10, y: 10 } }, 10);
    expect(bounds).toEqual({ x: -6, y: -6, width: 22, height: 22 });
  });

  it('rounds a fractional drag outward to an integral box', () => {
    // Zoomed drags produce fractional coordinates, and the layer bitmap this box sizes is
    // allocated with `new OffscreenCanvas(width, height)`, whose constructor truncates. A
    // fractional box therefore declared an extent its own raster disagreed with by up to a
    // pixel, clipping the right or bottom edge — half the stroke the padding exists for
    // included. The box is rounded outward instead, which at an EVEN stroke width is also the
    // identity, and every exact value pinned elsewhere in this file sits at an even width, so they
    // are unaffected.
    const bounds = shapeGeometryBounds({ start: { x: 10.4, y: 20.6 }, end: { x: 50.2, y: 80.9 } }, 2);

    // pad = 2 / 2 + 1 = 2, so the near edge is (8.4, 18.6) floored and the far edge is
    // (52.2, 82.9) ceiled, and the extent is the difference of the two ceiled/floored edges.
    expect(bounds).toEqual({ x: 8, y: 18, width: 45, height: 65 });
    expect(Number.isInteger(bounds.x)).toBe(true);
    expect(Number.isInteger(bounds.y)).toBe(true);
    expect(Number.isInteger(bounds.width)).toBe(true);
    expect(Number.isInteger(bounds.height)).toBe(true);
  });

  it('rounds outward for every fractional drag, never inward', () => {
    // A sweep, because the guarantee that matters is the direction of the rounding: inward
    // rounding would clip a stroke the geometry genuinely covers, and that only shows up on
    // the axis whose fraction happens to round the wrong way.
    for (const lineWidth of [1, 2, 3, 3.5, 7, 7.5]) {
      for (const start of [
        { x: 10.4, y: 20.6 },
        { x: -3.7, y: -1.2 },
        { x: 0.5, y: 0.5 },
        { x: 99.9, y: 12.05 },
      ]) {
        for (const end of [
          { x: 50.2, y: 80.9 },
          { x: -8.25, y: 44.6 },
          { x: 0.5, y: 0.5 },
        ]) {
          const pad = lineWidth / 2 + 1;
          const bounds = shapeGeometryBounds({ start, end }, lineWidth);
          const label = `lw=${lineWidth} ${start.x},${start.y} -> ${end.x},${end.y}`;

          expect(bounds.x, label).toBeLessThanOrEqual(Math.min(start.x, end.x) - pad);
          expect(bounds.y, label).toBeLessThanOrEqual(Math.min(start.y, end.y) - pad);
          expect(bounds.x + bounds.width, label).toBeGreaterThanOrEqual(Math.max(start.x, end.x) + pad);
          expect(bounds.y + bounds.height, label).toBeGreaterThanOrEqual(Math.max(start.y, end.y) + pad);
          expect(Number.isInteger(bounds.x), label).toBe(true);
          expect(Number.isInteger(bounds.y), label).toBe(true);
          expect(Number.isInteger(bounds.width), label).toBe(true);
          expect(Number.isInteger(bounds.height), label).toBe(true);
          // And it is a valid `OffscreenCanvas` size, which is the whole point: the
          // constructor truncates, so a fractional box and a fractional bitmap cannot agree.
          expect(Math.ceil(bounds.width), label).toBe(bounds.width);
          expect(Math.ceil(bounds.height), label).toBe(bounds.height);
        }
      }
    }
  });

  it('is the identity on integer geometry with an integral pad, so integral extents are not grown', () => {
    // An EVEN line width pads by a whole number, which is the case every other test in this file
    // sits in and the one that has to stay untouched: a `Math.ceil` alone would add a pixel to
    // every shape at an even stroke width.
    for (const lineWidth of [2, 4, 10]) {
      const bounds = shapeGeometryBounds({ start: { x: 10, y: 20 }, end: { x: 50, y: 60 } }, lineWidth);
      const halfLineWidth = lineWidth / 2;

      expect(bounds).toEqual({
        x: 10 - halfLineWidth - 1,
        y: 20 - halfLineWidth - 1,
        width: 40 + lineWidth + 2,
        height: 40 + lineWidth + 2,
      });
    }
  });

  it('grows the box wherever the padding is not integral, which is every odd stroke width', () => {
    // The reachable case the identity above does not cover, and the reason the doc comment no
    // longer claims identity for integer geometry in general: the Size slider is `min="0.5"
    // step="0.5"` and every figure preset seeds `5`, so `pad = lineWidth / 2 + 1` is a half-integer
    // and the rounded box is wider than the exact padded box. Width 1 rounds to the same 44-wide
    // box as width 2, and width 0.5 — the slider's minimum — pads to 42.5 and rounds to 44 too.
    // It only ever grows, which is why the containment above still holds at these widths.
    const geometry = { start: { x: 10, y: 20 }, end: { x: 50, y: 60 } };

    expect(shapeGeometryBounds(geometry, 1)).toEqual({ x: 8, y: 18, width: 44, height: 44 });
    expect(shapeGeometryBounds(geometry, 0.5)).toEqual({ x: 8, y: 18, width: 44, height: 44 });
    // And the two that ARE the identity, so the growth above is the only difference.
    expect(shapeGeometryBounds(geometry, 2)).toEqual({ x: 8, y: 18, width: 44, height: 44 });
    expect(shapeGeometryBounds(geometry, 4)).toEqual({ x: 7, y: 17, width: 46, height: 46 });
  });

  it.each([
    ['positive', { start: { x: 10.4, y: 20.6 }, end: { x: 50.2, y: 80.9 } }],
    ['negative', { start: { x: 50.2, y: 80.9 }, end: { x: 10.4, y: 20.6 } }],
  ])('contains the geometry for a %s fractional drag', (_name, geometry) => {
    const bounds = shapeGeometryBounds(geometry, 3);
    const pad = 3 / 2;

    for (const point of [geometry.start, geometry.end]) {
      expect(point.x - pad).toBeGreaterThanOrEqual(bounds.x);
      expect(point.y - pad).toBeGreaterThanOrEqual(bounds.y);
      expect(point.x + pad).toBeLessThanOrEqual(bounds.x + bounds.width);
      expect(point.y + pad).toBeLessThanOrEqual(bounds.y + bounds.height);
    }
  });
});

describe('drawShape', () => {
  it('draws nothing without start or end', () => {
    const ctx = createCtx();
    drawShape(ctx, { ...baseArgs, figure: 'rectangle' });
    drawShape(ctx, { ...baseArgs, figure: 'rectangle', start: { x: 0, y: 0 } });
    expect(ctx.strokeRect).not.toHaveBeenCalled();
    expect(ctx.beginPath).not.toHaveBeenCalled();
  });

  it('strokes a plain rectangle with the given geometry', () => {
    const ctx = createCtx();
    drawShape(ctx, { ...baseArgs, figure: 'rectangle', start: { x: 10, y: 20 }, end: { x: 60, y: 45 } });
    expect(ctx.strokeRect).toHaveBeenCalledWith(10, 20, 50, 25);
  });

  it('does not square-clamp a rectangle: geometry comes from the normalizer', () => {
    const ctx = createCtx();
    drawShape(ctx, { ...baseArgs, figure: 'rectangle', start: { x: 10, y: 20 }, end: { x: 60, y: 45 } });
    expect(ctx.strokeRect).toHaveBeenCalledWith(10, 20, 50, 25);
  });

  it('uses the rounded path for a rectangle with a corner radius', () => {
    const ctx = createCtx();
    drawShape(ctx, {
      ...baseArgs,
      figure: 'rectangle',
      cornerRadius: 8,
      start: { x: 10, y: 20 },
      end: { x: 60, y: 50 },
    });
    expect(ctx.quadraticCurveTo).toHaveBeenCalledTimes(4);
    expect(ctx.strokeRect).not.toHaveBeenCalled();
  });

  // 50x25 from (10,20) to (60,45). r = min(50/2, 25/2, 10) = 10, so the
  // corners start and end 10px in from each box corner.
  const roundedBox50x25: PathCall[] = [
    { method: 'moveTo', args: [20, 20] },
    { method: 'lineTo', args: [50, 20] },
    { method: 'quadraticCurveTo', args: [60, 20, 60, 30] },
    { method: 'lineTo', args: [60, 35] },
    { method: 'quadraticCurveTo', args: [60, 45, 50, 45] },
    { method: 'lineTo', args: [20, 45] },
    { method: 'quadraticCurveTo', args: [10, 45, 10, 35] },
    { method: 'lineTo', args: [10, 30] },
    { method: 'quadraticCurveTo', args: [10, 20, 20, 20] },
  ];

  const drawRoundedRect = (start: Point, end: Point, cornerRadius: number) => {
    const { ctx, calls } = createRecordingCtx();
    drawShape(ctx, { ...baseArgs, figure: 'rectangle', cornerRadius, start, end });
    return calls;
  };

  it('draws a rounded rectangle dragged up-and-left as the mirrored positive box', () => {
    // normalizeShapeGeometry keeps the drag quadrant, so an ordinary
    // up-and-left drag arrives here with end < start on both axes.
    const positive = drawRoundedRect({ x: 10, y: 20 }, { x: 60, y: 45 }, 10);
    const mirrored = drawRoundedRect({ x: 60, y: 45 }, { x: 10, y: 20 }, 10);

    expect(pathCalls(mirrored)).toEqual(pathCalls(positive));
    expect(pathCalls(mirrored)).toEqual(roundedBox50x25);
  });

  it('mirrors a plain rectangle stroked up-and-left into the positive box', () => {
    const ctx = createCtx();
    drawShape(ctx, { ...baseArgs, figure: 'rectangle', start: { x: 60, y: 45 }, end: { x: 10, y: 20 } });
    expect(ctx.strokeRect).toHaveBeenCalledWith(10, 20, 50, 25);
  });

  it('clamps the corner radius to the extent the layer allocation can hold', () => {
    // 250px is the radius slider's maximum, five times the 25px height of the
    // box, so the clamp is what keeps the path inside the allocation.
    const geometry = { start: { x: 60, y: 45 }, end: { x: 10, y: 20 } };
    const calls = drawRoundedRect(geometry.start, geometry.end, 250);
    const bounds = shapeGeometryBounds(geometry, baseArgs.lineWidth);

    // w = 50, h = 25 → min(25, 12.5) = 12.5, and the 29px tall box has 14.5px
    // of half-height to give.
    const expectedRadius = Math.min(
      Math.abs(geometry.end.x - geometry.start.x) / 2,
      Math.abs(geometry.end.y - geometry.start.y) / 2
    );
    expect(expectedRadius).toBe(12.5);
    expect(expectedRadius).toBeLessThanOrEqual(bounds.height / 2);
    expect(bounds).toEqual({ x: 8, y: 18, width: 54, height: 29 });

    expect(calls).toContainEqual({ method: 'moveTo', args: [10 + expectedRadius, 20] });
    expect(calls).toContainEqual({ method: 'quadraticCurveTo', args: [60, 45, 60 - expectedRadius, 45] });

    // Every coordinate the path touches is inside the box the bounds allocated,
    // so a commit cannot clip the shape it just drew.
    for (const { args } of pathCalls(calls)) {
      for (let index = 0; index < args.length; index += 2) {
        expect(args[index]).toBeGreaterThanOrEqual(bounds.x);
        expect(args[index + 1]).toBeGreaterThanOrEqual(bounds.y);
        expect(args[index]).toBeLessThanOrEqual(bounds.x + bounds.width);
        expect(args[index + 1]).toBeLessThanOrEqual(bounds.y + bounds.height);
      }
    }
  });

  it('collapses a zero-extent drag to the drag point', () => {
    // r clamps to 0 against a zero extent, so the path degenerates to a point
    // at the drag rather than inverting.
    const calls = drawRoundedRect({ x: 30, y: 40 }, { x: 30, y: 40 }, 10);
    expect(pathCalls(calls)).toEqual([
      { method: 'moveTo', args: [30, 40] },
      { method: 'lineTo', args: [30, 40] },
      { method: 'quadraticCurveTo', args: [30, 40, 30, 40] },
      { method: 'lineTo', args: [30, 40] },
      { method: 'quadraticCurveTo', args: [30, 40, 30, 40] },
      { method: 'lineTo', args: [30, 40] },
      { method: 'quadraticCurveTo', args: [30, 40, 30, 40] },
      { method: 'lineTo', args: [30, 40] },
      { method: 'quadraticCurveTo', args: [30, 40, 30, 40] },
    ]);
  });

  it('keeps a zero-height drag flat and box-ordered in either direction', () => {
    // A zero extent is its own absolute value, so Math.abs cannot rescue a
    // negative one on its own: the origin has to be normalised too.
    expect(pathCalls(drawRoundedRect({ x: 10, y: 20 }, { x: 60, y: 20 }, 10))).toEqual(
      pathCalls(drawRoundedRect({ x: 60, y: 20 }, { x: 10, y: 20 }, 10))
    );
    expect(pathCalls(drawRoundedRect({ x: 60, y: 20 }, { x: 10, y: 20 }, 10))).toEqual([
      { method: 'moveTo', args: [10, 20] },
      { method: 'lineTo', args: [60, 20] },
      { method: 'quadraticCurveTo', args: [60, 20, 60, 20] },
      { method: 'lineTo', args: [60, 20] },
      { method: 'quadraticCurveTo', args: [60, 20, 60, 20] },
      { method: 'lineTo', args: [10, 20] },
      { method: 'quadraticCurveTo', args: [10, 20, 10, 20] },
      { method: 'lineTo', args: [10, 20] },
      { method: 'quadraticCurveTo', args: [10, 20, 10, 20] },
    ]);
  });

  it('pins the positive-extent rounded path so the normalisation cannot drift it', () => {
    expect(pathCalls(drawRoundedRect({ x: 10, y: 20 }, { x: 60, y: 45 }, 10))).toEqual(roundedBox50x25);
  });

  it('draws an oval with independent radii', () => {
    const ctx = createCtx();
    drawShape(ctx, { ...baseArgs, figure: 'oval', start: { x: 10, y: 20 }, end: { x: 60, y: 50 } });
    expect(ctx.ellipse).toHaveBeenCalledWith(35, 35, 25, 15, 0, 0, Math.PI * 2);
  });

  it('draws a circle as a normalized square-box oval', () => {
    const geometry = normalizeShapeGeometry({ x: 10, y: 20 }, { x: 50, y: 80 }, 'oval', {
      shiftKey: true,
      altKey: false,
    });
    const ctx = createCtx();
    drawShape(ctx, { ...baseArgs, figure: 'oval', ...geometry });
    expect(ctx.ellipse).toHaveBeenCalledWith(40, 50, 30, 30, 0, 0, Math.PI * 2);
  });

  it('strokes a line between the two points', () => {
    const ctx = createCtx();
    drawShape(ctx, { ...baseArgs, figure: 'line', start: { x: 0, y: 0 }, end: { x: 30, y: 10 } });
    expect(ctx.moveTo).toHaveBeenCalledWith(0, 0);
    expect(ctx.lineTo).toHaveBeenCalledWith(30, 10);
  });

  it.each([
    ['triangle', 3],
    ['polygon', 5],
  ] as const)('closes a %s path with %i vertices', (figure, sides) => {
    const ctx = createCtx();
    drawShape(ctx, { ...baseArgs, figure, start: { x: 0, y: 0 }, end: { x: 20, y: 20 } });
    expect(ctx.moveTo).toHaveBeenCalledTimes(1);
    expect(ctx.lineTo).toHaveBeenCalledTimes(sides - 1);
    expect(ctx.closePath).toHaveBeenCalled();
  });

  it('fills only when hasFill is set and toolMode is not path', () => {
    const filled = createCtx();
    drawShape(filled, {
      ...baseArgs,
      figure: 'rectangle',
      hasFill: true,
      backgroundColor: '#ff0000',
      start: { x: 0, y: 0 },
      end: { x: 10, y: 10 },
    });
    expect(filled.fillRect).toHaveBeenCalled();

    const pathMode = createCtx();
    drawShape(pathMode, {
      ...baseArgs,
      figure: 'rectangle',
      hasFill: true,
      backgroundColor: '#ff0000',
      toolMode: 'path',
      start: { x: 0, y: 0 },
      end: { x: 10, y: 10 },
    });
    expect(pathMode.fillRect).not.toHaveBeenCalled();

    const unfilled = createCtx();
    drawShape(unfilled, { ...baseArgs, figure: 'rectangle', start: { x: 0, y: 0 }, end: { x: 10, y: 10 } });
    expect(unfilled.fillRect).not.toHaveBeenCalled();
  });
});

describe('setShapeCtx', () => {
  it('applies stroke, fill, width, cap and dash to the context', () => {
    const ctx = createCtx();
    setShapeCtx(ctx, {
      ...baseArgs,
      alpha: 0.5,
      color: '#112233',
      backgroundColor: '#445566',
      hasFill: true,
      lineWidth: 7,
      lineDash: [2, 4],
      lineCap: 'round',
    });

    expect(ctx.strokeStyle).toBe('#112233');
    expect(ctx.fillStyle).toBe('#445566');
    expect(ctx.lineWidth).toBe(7);
    expect(ctx.lineCap).toBe('round');
    expect(ctx.globalAlpha).toBe(0.5);
    expect(ctx.setLineDash).toHaveBeenCalledWith([2, 4]);
  });

  it('leaves the dash empty and defaults the cap to butt', () => {
    const ctx = createCtx();
    setShapeCtx(ctx, { ...baseArgs, lineDash: null });
    expect(ctx.setLineDash).toHaveBeenCalledWith([]);
    expect(ctx.lineCap).toBe('butt');
  });
});

/**
 * A context that models the parts of the real 2D state machine that matter for a leak: the
 * properties `setShapeCtx` writes, and a `save()`/`restore()` stack that actually puts them back.
 * A `vi.fn()` context cannot show a state escape, so the leak this guards against is invisible to
 * every other test in this file.
 */
function createBracketedCtx() {
  type State = {
    globalAlpha: number;
    strokeStyle: string;
    fillStyle: string;
    lineWidth: number;
    lineCap: CanvasLineCap;
    dash: number[];
  };

  const state: State = {
    globalAlpha: 1,
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 1,
    lineCap: 'butt',
    dash: [],
  };
  const stack: State[] = [];
  /**
   * The writer state in effect at the moment a paint op ran. A bracket bounds the state without
   * neutralising the paint, so the alpha a stroke was committed at can only be read here — after
   * the call the context holds the caller's value whether or not anything was written.
   */
  const observedAtPaint: { globalAlpha: number } = { globalAlpha: 1 };
  const recordPaint = () => {
    observedAtPaint.globalAlpha = state.globalAlpha;
  };

  const ctx = {
    canvas: document.createElement('canvas'),
    get globalAlpha() {
      return state.globalAlpha;
    },
    set globalAlpha(value: number) {
      state.globalAlpha = value;
    },
    get strokeStyle() {
      return state.strokeStyle;
    },
    set strokeStyle(value: string) {
      state.strokeStyle = value;
    },
    get fillStyle() {
      return state.fillStyle;
    },
    set fillStyle(value: string) {
      state.fillStyle = value;
    },
    get lineWidth() {
      return state.lineWidth;
    },
    set lineWidth(value: number) {
      state.lineWidth = value;
    },
    get lineCap() {
      return state.lineCap;
    },
    set lineCap(value: CanvasLineCap) {
      state.lineCap = value;
    },
    setLineDash: vi.fn((dash: number[]) => {
      state.dash = dash;
    }),
    save: vi.fn(() => {
      stack.push({ ...state, dash: [...state.dash] });
    }),
    restore: vi.fn(() => {
      Object.assign(state, stack.pop() ?? {});
    }),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    quadraticCurveTo: vi.fn(),
    closePath: vi.fn(),
    ellipse: vi.fn(),
    fill: vi.fn(recordPaint),
    stroke: vi.fn(recordPaint),
    fillRect: vi.fn(recordPaint),
    strokeRect: vi.fn(recordPaint),
    clearRect: vi.fn(),
  } as unknown as Ctx2D & { globalAlpha: number; save: ReturnType<typeof vi.fn>; restore: ReturnType<typeof vi.fn> };

  return { ctx, state, observedAtPaint };
}

describe('shape processor', () => {
  const creatorParams = { size: { width: 40, height: 40 } } as CreatorToolParams;

  /**
   * The canvas `shape()` allocates, handing back the supplied context. The globally installed mock
   * context has `save`/`restore` as inert `vi.fn()`s, so routing the real processor through it
   * cannot observe a state escape at all — which is why this exists rather than reaching for the
   * global, the same way `EraserToolArea.test.tsx` stubs the same constructor for its eraser.
   */
  const stubOffscreenCanvas = (ctx: unknown) => {
    class StubbedOffscreenCanvas {
      width: number;
      height: number;

      constructor(width: number, height: number) {
        this.width = width;
        this.height = height;
      }

      getContext() {
        return ctx;
      }
    }
    vi.stubGlobal('OffscreenCanvas', StubbedOffscreenCanvas as unknown as typeof OffscreenCanvas);
  };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('brackets the context, so the writer state cannot outlive the paint', () => {
    const getContext = vi.spyOn(OffscreenCanvas.prototype, 'getContext');
    const args = { ...baseArgs, alpha: 0.4, start: { x: 4, y: 6 }, end: { x: 30, y: 28 } } as ShapeToolArgs;

    shape(creatorParams)(args);

    const ctx = getContext.mock.results[0].value as unknown as {
      save: ReturnType<typeof vi.fn>;
      restore: ReturnType<typeof vi.fn>;
    };
    expect(ctx.save).toHaveBeenCalledTimes(1);
    expect(ctx.restore).toHaveBeenCalledTimes(1);
    getContext.mockRestore();
  });

  it('leaves the committed context at full opacity whatever alpha the tool asks for', () => {
    // The dangerous "fix" for the shared-overlay leak is to write `ctx.globalAlpha = 1` at the
    // top of the writer, which flattens every committed stroke. The bracket is the fix, and this
    // is the property that distinguishes the two: the paint happens AT the tool's alpha, and only
    // the state that survives the call is neutral.
    //
    // It runs the real `shape()` rather than hand-rolling a `save`/`try`/`finally` around
    // `setShapeCtx` + `drawShape`, because with its own bracket in the test the second half asserts
    // nothing about the tool: the hand-rolled bracket passed this test with `shape()`'s own
    // bracket deleted, and also at the commit before the bracket existed.
    const { ctx, state, observedAtPaint } = createBracketedCtx();
    stubOffscreenCanvas(ctx);
    const args = { ...baseArgs, alpha: 0.4, start: { x: 4, y: 6 }, end: { x: 30, y: 28 } } as ShapeToolArgs;

    shape(creatorParams)(args);

    // The one contribution this test makes over the `setShapeCtx` unit test above: the alpha is
    // read where the paint happened, because a `globalAlpha = 1` at the top of the writer would
    // still leave the context at 1 after the call and pass a post-hoc assertion.
    expect(observedAtPaint.globalAlpha).toBe(0.4);
    // And the state that survives the call is the context `shape()` found, not the tool's.
    expect(state.globalAlpha).toBe(1);
    expect(state.strokeStyle).toBe('');
    expect(state.lineWidth).toBe(1);
    expect(state.dash).toEqual([]);
  });
});
