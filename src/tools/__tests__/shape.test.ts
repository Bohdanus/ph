import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_POLYGON_SIDES,
  DEFAULT_STAR_RATIO,
  drawShape,
  isFigureType,
  MAX_POLYGON_SIDES,
  MIN_POLYGON_SIDES,
  MIN_STAR_RATIO,
  MAX_STAR_RATIO,
  polygonSides,
  starRatio,
  normalizeFigure,
  normalizeShapeGeometry,
  setShapeCtx,
  shape,
  shapeGeometryBounds,
  type ShapeToolArgs,
} from '../shape.ts';
import type { Ctx2D, Point } from '../../contexts/general-types.ts';
import type { CreatorToolParams } from '../toolProcessors.ts';
import { defaultSettings } from '../settings.ts';

/**
 * The six tool names the shape family registers under, as an INDEPENDENT literal.
 *
 * Sourced from `defaultSettings` in the assertions below rather than imported from the module
 * under test, so a list that lost a name fails here instead of quietly shrinking the sweep. The
 * tool name and the figure are different vocabularies — `ellipse` is the tool and `oval` is its
 * figure — so neither can be derived from `FigureType`.
 */
const SHAPE_FAMILY_TOOL_NAMES = ['shape', 'rectangle', 'ellipse', 'triangle', 'polygon', 'line'] as const;

/**
 * Every seeded default that carries a `figure`, which is the shape family and nothing else:
 * a tool with a figure of its own is one of these six.
 */
const seededShapeToolNames = Object.entries(defaultSettings)
  .filter(([, args]) => 'figure' in args)
  .map(([name]) => name)
  .sort();

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
    for (const figure of ['line', 'rectangle', 'oval', 'triangle', 'polygon', 'star'] as const) {
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

  it.each(['triangle', 'polygon', 'star'] as const)('keeps %s geometry consistent with the other figures', (figure) => {
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

describe('the shape family', () => {
  it('is exactly the set of tools the seeded defaults give a figure', () => {
    // The cross-check that makes the sweeps below mean something: `toolsMap` registers one image
    // processor for all six names, so the family is also what one options bar and one commit path
    // serve. A tool added here and to the defaults without the other list would be missed.
    expect(seededShapeToolNames).toEqual([...SHAPE_FAMILY_TOOL_NAMES].sort());
    expect(seededShapeToolNames).toHaveLength(6);
  });

  it('separates tool names from figures, which are a different list', () => {
    // `oval` is the figure and `ellipse` the tool; neither list contains the other's odd member,
    // which is the trap a guard derived from `FigureType` would fall into.
    expect(seededShapeToolNames).not.toContain('oval');
    expect(isFigureType('ellipse')).toBe(false);
    expect(isFigureType('oval')).toBe(true);
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
    ['star', 10],
  ] as const)('closes a %s path with %i vertices', (figure, sides) => {
    const ctx = createCtx();
    drawShape(ctx, { ...baseArgs, figure, start: { x: 0, y: 0 }, end: { x: 20, y: 20 } });
    expect(ctx.moveTo).toHaveBeenCalledTimes(1);
    expect(ctx.lineTo).toHaveBeenCalledTimes(sides - 1);
    expect(ctx.closePath).toHaveBeenCalled();
  });

  /*
   * The side count is the one shape argument the renderer used to hardcode, so
   * these two describes are the whole reason the field can be trusted: the
   * normalizer bounds what reaches the loop, and the loop's vertex count is what
   * proves the argument arrived.
   */

  describe("the Polygon's Sides", () => {
    it('draws as many vertices as the field asks for', () => {
      // 8 sides means 7 lineTo calls plus the moveTo, because the loop starts at
      // -PI/2 and the closing vertex is the one already on the path.
      for (const sides of [3, 5, 6, 8, 12]) {
        const ctx = createCtx();
        drawShape(ctx, {
          ...baseArgs,
          figure: 'polygon',
          sides,
          start: { x: 0, y: 0 },
          end: { x: 20, y: 20 },
        });
        expect(ctx.moveTo).toHaveBeenCalledTimes(1);
        expect(ctx.lineTo).toHaveBeenCalledTimes(sides - 1);
      }
    });

    it('leaves the triangle at three whatever the field says', () => {
      // The field is offered on the polygon figure only, but the value is
      // persisted per figure in one shared table, so a sides that survives a
      // figure switch must not be able to bend the triangle.
      const ctx = createCtx();
      drawShape(ctx, {
        ...baseArgs,
        figure: 'triangle',
        sides: 9,
        start: { x: 0, y: 0 },
        end: { x: 20, y: 20 },
      });
      expect(ctx.lineTo).toHaveBeenCalledTimes(2);
    });

    it('falls back to the seeded count when the field is absent or unusable', () => {
      // Absent is the pre-field document and a store written before Sides existed.
      expect(polygonSides(undefined)).toBe(DEFAULT_POLYGON_SIDES);
      // Unusable is every way a persisted or hand-edited value can be nonsense,
      // and the loop divides by this result, so each would be a wrong polygon or
      // a NaN path rather than a default.
      expect(polygonSides(Number.NaN)).toBe(DEFAULT_POLYGON_SIDES);
      expect(polygonSides(Number.POSITIVE_INFINITY)).toBe(DEFAULT_POLYGON_SIDES);
      expect(polygonSides(0)).toBe(MIN_POLYGON_SIDES);
      expect(polygonSides(-4)).toBe(MIN_POLYGON_SIDES);
      expect(polygonSides(2)).toBe(MIN_POLYGON_SIDES);
      expect(polygonSides(10_000)).toBe(MAX_POLYGON_SIDES);
      // And a fractional count rounds, because the loop indexes an angle with it.
      expect(polygonSides(5.4)).toBe(5);
      expect(polygonSides(5.6)).toBe(6);
    });

    it('draws the fallback rather than throwing when the field is absent', () => {
      // The normalizer is not the only thing standing between a bad value and the
      // loop: a field the renderer ignored entirely would satisfy the normalizer's
      // tests and still draw a pentagon for every input.
      const ctx = createCtx();
      drawShape(ctx, { ...baseArgs, figure: 'polygon', start: { x: 0, y: 0 }, end: { x: 20, y: 20 } });
      expect(ctx.lineTo).toHaveBeenCalledTimes(DEFAULT_POLYGON_SIDES - 1);
    });
  });

  describe("the Star's points and ratio", () => {
    it('alternates outer and inner vertices for the requested point count', () => {
      const { ctx, calls } = createRecordingCtx();
      drawShape(ctx, {
        ...baseArgs,
        figure: 'star',
        sides: 5,
        starRatio: 50,
        start: { x: 0, y: 0 },
        end: { x: 100, y: 100 },
      });

      const vertices = pathCalls(calls).filter(({ method }) => method === 'moveTo' || method === 'lineTo');
      expect(vertices).toHaveLength(10);
      expect(vertices[0]).toEqual({ method: 'moveTo', args: [50, 0] });
      expect(vertices[1].args[0]).toBeCloseTo(50 + Math.cos(-Math.PI / 2 + Math.PI / 5) * 25, 8);
      expect(vertices[1].args[1]).toBeCloseTo(50 + Math.sin(-Math.PI / 2 + Math.PI / 5) * 25, 8);
    });

    it('reaches the renderer, so changing Star Ratio changes inner vertices', () => {
      const innerRadius = (ratio: number) => {
        const { ctx, calls } = createRecordingCtx();
        drawShape(ctx, {
          ...baseArgs,
          figure: 'star',
          sides: 5,
          starRatio: ratio,
          start: { x: 0, y: 0 },
          end: { x: 100, y: 100 },
        });
        const [x, y] = pathCalls(calls)[1].args;
        return Math.hypot(x - 50, y - 50);
      };

      expect(innerRadius(25)).toBeCloseTo(12.5, 8);
      expect(innerRadius(75)).toBeCloseTo(37.5, 8);
    });

    it('normalizes missing, fractional and out-of-range ratios', () => {
      expect(starRatio(undefined)).toBe(DEFAULT_STAR_RATIO);
      expect(starRatio(Number.NaN)).toBe(DEFAULT_STAR_RATIO);
      expect(starRatio(0)).toBe(MIN_STAR_RATIO);
      expect(starRatio(100)).toBe(MAX_STAR_RATIO);
      expect(starRatio(49.6)).toBe(50);
    });
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

  /**
   * `setShapeCtx` writes `fillStyle` only when `backgroundColor` is set, so it is a second half of
   * the fill condition rather than a detail of it. Without that half a `hasFill` figure with no
   * background colour reaches `ctx.fill()` with whatever `fillStyle` the context already carried:
   * the canvas default on a fresh surface, and the previous tool's colour on the shared tool
   * overlay, which `drawShape` paints many times per one `setShapeCtx` (see the bracket note on
   * `shape`). The fill has to be suppressed, not merely left unset.
   */
  describe('the background colour is half of the fill condition', () => {
    const firableFigures = ['rectangle', 'oval', 'triangle', 'polygon'] as const;

    it.each(firableFigures)('does not fill a %s marked filled that has no background colour', (figure) => {
      // `backgroundColor` is typed `string | null`, so `null` is the colourless state the type
      // admits; an absent property is the same falsy branch, which is why the guard coerces.
      const ctx = createCtx();
      drawShape(ctx, {
        ...baseArgs,
        figure,
        hasFill: true,
        backgroundColor: null,
        start: { x: 0, y: 0 },
        end: { x: 10, y: 10 },
      });

      expect(ctx.fill, figure).not.toHaveBeenCalled();
      expect(ctx.fillRect, figure).not.toHaveBeenCalled();
    });

    it('does not fill a corner-rounded rectangle marked filled that has no background colour', () => {
      // The `it.each` above reaches the rectangle only through the axis-aligned fast path, where
      // `cornerRadius` is absent and `radius` is 0, so it never enters the rounded branch. That
      // branch gates its fill separately (`shape.ts`: `if (hasFill) ctx.fill();` after
      // `roundedRectPath`), so the `hasFill` guard there is a second, independently removable line
      // that nothing else in this file exercises: every other cornerRadius case draws an unfilled
      // rectangle, and an unfilled one cannot tell a suppressed fill from a fill it never wanted.
      const ctx = createCtx();
      drawShape(ctx, {
        ...baseArgs,
        figure: 'rectangle',
        cornerRadius: 8,
        hasFill: true,
        backgroundColor: null,
        start: { x: 0, y: 0 },
        end: { x: 10, y: 10 },
      });

      expect(ctx.fill).not.toHaveBeenCalled();
      expect(ctx.fillRect).not.toHaveBeenCalled();
      // The outline is still drawn, and only through the path primitive: `strokeRect` here would be
      // the fast path, which a positive radius must never take.
      expect(ctx.stroke).toHaveBeenCalledTimes(1);
      expect(ctx.strokeRect).not.toHaveBeenCalled();
    });

    it.each(firableFigures)('still fills a %s marked filled that has a background colour', (figure) => {
      // A radius-0 rectangle fills through `fillRect` and the rest through `fill`, so the method
      // is named per figure rather than asserted as a set -- a rectangle passing on `fill` alone
      // would mean the assertion was vacuous for it.
      const ctx = createCtx();
      drawShape(ctx, {
        ...baseArgs,
        figure,
        hasFill: true,
        backgroundColor: '#ff0000',
        start: { x: 0, y: 0 },
        end: { x: 10, y: 10 },
      });

      const fillMethod = figure === 'rectangle' ? 'fillRect' : 'fill';
      expect(ctx[fillMethod], figure).toHaveBeenCalled();
    });

    it('suppresses only the fill, leaving the outline drawn', () => {
      // Each figure strokes through a different call, and a radius-0 rectangle is not one of them:
      // it takes the axis-aligned fast path at `shape.ts` and strokes with `strokeRect`, so an
      // assertion on `ctx.stroke` here would pass for the wrong reason on three figures and fail
      // on the fourth. A guard that removed the whole figure would be caught by this, not by the
      // two above. Asserting the named primitive alone is one-sided, though: a mutation that made
      // a figure outline BOTH primitives, or stroke twice, would still pass, so each case pins the
      // count on its own primitive and the absence of the other.
      const cases = [
        { figure: 'rectangle', cornerRadius: 0, strokeMethod: 'strokeRect' },
        { figure: 'rectangle', cornerRadius: 4, strokeMethod: 'stroke' },
        { figure: 'oval', cornerRadius: 0, strokeMethod: 'stroke' },
        { figure: 'triangle', cornerRadius: 0, strokeMethod: 'stroke' },
        { figure: 'polygon', cornerRadius: 0, strokeMethod: 'stroke' },
      ] as const;

      for (const { figure, cornerRadius, strokeMethod } of cases) {
        const ctx = createCtx();
        drawShape(ctx, {
          ...baseArgs,
          figure,
          cornerRadius,
          hasFill: true,
          backgroundColor: null,
          start: { x: 0, y: 0 },
          end: { x: 10, y: 10 },
        });

        // The one primitive this case does not outline. Naming the unused half of the pair rather
        // than leaving it to the reader is what makes the absence an assertion instead of an
        // inference from which method happened to be listed.
        const otherStrokeMethod = strokeMethod === 'strokeRect' ? 'stroke' : 'strokeRect';
        const label = `${figure} r=${cornerRadius}`;

        expect(ctx[strokeMethod], label).toHaveBeenCalledTimes(1);
        expect(ctx[otherStrokeMethod], label).not.toHaveBeenCalled();
      }
    });
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

  it('does not write fillStyle for a filled figure that has no background colour', () => {
    // The writer side of the same invariant `drawShape` reads: without a colour there is no fill
    // colour to write, so the context keeps whatever it carried. Pinned here because the symptom
    // of breaking it is invisible from `drawShape` -- a fix that made `setShapeCtx` always assign
    // would turn the stale-fill into a wrong-fill and leave every fill assertion here green.
    const ctx = createCtx();
    ctx.fillStyle = '#00ff00';
    setShapeCtx(ctx, { ...baseArgs, hasFill: true, backgroundColor: null });

    expect(ctx.fillStyle).toBe('#00ff00');
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
   * neutralising the paint, so the alpha and the colours a stroke was committed at can only be read
   * here — after the call the context holds the caller's value whether or not anything was written,
   * so a post-hoc read of `strokeStyle` is always `''` and would pass for any colour at all.
   */
  const observedAtPaint: { globalAlpha: number; strokeStyle: string; fillStyle: string } = {
    globalAlpha: 1,
    strokeStyle: '',
    fillStyle: '',
  };
  const recordPaint = () => {
    observedAtPaint.globalAlpha = state.globalAlpha;
    observedAtPaint.strokeStyle = state.strokeStyle;
    observedAtPaint.fillStyle = state.fillStyle;
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

  /**
   * The committed layer is what the options bar's mirrored colours are FOR, so this is the end of
   * the chain the mirror effect starts: whatever the panel publishes as `color`/`backgroundColor`
   * has to reach the paint, for all six tool names and not only for the one the panel was opened
   * under. Swept rather than asserted once, because a case naming only `shape` passes while the
   * other five commit black.
   *
   * Each colour is read at the paint op, never after the call: `shape()` brackets the writer, so a
   * post-call `strokeStyle` is `''` for every input and the assertion would pass for a processor
   * that ignored its arguments entirely.
   */
  describe('paints with the colours carried in the arguments of all six tools', () => {
    const STROKE = '#ff8800';
    const FILL = '#0044ff';

    it.each(SHAPE_FAMILY_TOOL_NAMES)('strokes %s in its own colour rather than the seeded black', (toolName) => {
      const { ctx, observedAtPaint } = createBracketedCtx();
      stubOffscreenCanvas(ctx);
      const args = {
        ...baseArgs,
        toolName,
        color: STROKE,
        backgroundColor: FILL,
        hasFill: true,
        start: { x: 4, y: 6 },
        end: { x: 30, y: 28 },
      } as ShapeToolArgs;

      shape(creatorParams)(args);

      expect(observedAtPaint.strokeStyle).toBe(STROKE);
      // The colour every one of the six defaults is seeded with, so a processor that fell back to
      // it — or to a constant of its own — cannot pass by painting something merely non-default.
      expect(observedAtPaint.strokeStyle).not.toBe('#000000');
      // The fill half, read at the same paint op. `line` never fills, but `setShapeCtx` writes the
      // fill style before the figure branch, so the colour a filled sibling would use is here.
      expect(observedAtPaint.fillStyle).toBe(FILL);
    });

    it.each(SHAPE_FAMILY_TOOL_NAMES)('does not fill %s whose arguments carry no background colour', (toolName) => {
      // The colourless half of the pair above, on every tool: a fill with nothing to fill with is
      // the stale fill the `save`/`restore` bracket exists around, and it must stay suppressed.
      const { ctx } = createBracketedCtx();
      stubOffscreenCanvas(ctx);
      const args = {
        ...baseArgs,
        toolName,
        color: STROKE,
        backgroundColor: null,
        hasFill: true,
        start: { x: 4, y: 6 },
        end: { x: 30, y: 28 },
      } as ShapeToolArgs;

      shape(creatorParams)(args);

      expect(ctx.fill).not.toHaveBeenCalled();
      expect(ctx.fillRect).not.toHaveBeenCalled();
    });
  });
});
