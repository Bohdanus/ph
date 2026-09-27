import { describe, expect, it, vi } from 'vitest';
import {
  drawShape,
  isFigureType,
  normalizeFigure,
  normalizeShapeGeometry,
  setShapeCtx,
  shapeGeometryBounds,
  type ShapeToolArgs,
} from '../shape.ts';
import type { Ctx2D } from '../../contexts/general-types.ts';

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

  it('keeps a fractional drag inside a fractional box', () => {
    // Zoomed drags produce fractional coordinates. The box is the raw padded
    // extent, so it stays fractional too, and the layer canvas it is paired
    // with is allocated with new OffscreenCanvas(width, height), which truncates.
    const bounds = shapeGeometryBounds({ start: { x: 10.4, y: 20.6 }, end: { x: 50.2, y: 80.9 } }, 2);

    // x = 10.4 - 1 - 1, y = 20.6 - 1 - 1, width = 39.8 + 2 + 2, height = 60.3 + 2 + 2
    expect(bounds.x).toBeCloseTo(8.4, 10);
    expect(bounds.y).toBeCloseTo(18.6, 10);
    expect(bounds.width).toBeCloseTo(43.8, 10);
    expect(bounds.height).toBeCloseTo(64.3, 10);
    expect(Number.isInteger(bounds.x)).toBe(false);
    expect(Number.isInteger(bounds.y)).toBe(false);
    expect(Number.isInteger(bounds.width)).toBe(false);
    expect(Number.isInteger(bounds.height)).toBe(false);
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
