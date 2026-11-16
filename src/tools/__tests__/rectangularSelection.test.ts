import { describe, expect, it } from 'vitest';

import {
  rectangularSelection,
  applyMarqueeRatio,
  MARQUEE_RATIO_MIN,
  MARQUEE_RATIO_MAX,
  MARQUEE_RATIO_STEP,
  MARQUEE_SIZE_MIN,
  MARQUEE_SIZE_MAX,
  MARQUEE_SIZE_STEP,
  MARQUEE_STYLES,
  isMarqueeStyle,
  type RectangularSelectionToolArgs,
} from '../rectangularSelection.ts';
import type { MarqueeStyle } from '../ellipticalSelection.ts';
import {
  resolveEllipseRect,
  ellipseVertexCount,
  ellipsePointsInRect,
  ellipsePointsFromDrag,
  ELLIPSE_MAX_SAGITTA_PX,
  ELLIPSE_MIN_VERTICES,
  ELLIPSE_MAX_VERTICES,
  ELLIPTICAL_SELECTION_SOURCE_TOOL,
  type EllipticalMarqueeDrag,
  type EllipticalSelectionToolArgs,
} from '../ellipticalSelection.ts';
import { createMockImageBitmap } from '../../__tests__/fixtures/canvas.ts';
import type { BitmapSource, RectXYSorted } from '../../contexts/general-types.ts';

describe('rectangularSelection processor', () => {
  const size = { width: 2, height: 1 };
  const bitmap = createMockImageBitmap(size.width, size.height) as unknown as BitmapSource;

  it('returns the bitmap unchanged (rectangular selection is handled elsewhere)', () => {
    const [result] = rectangularSelection({ bitmap, size })();

    expect(result).toBe(bitmap);
  });

  it('is a two-stage curried processor', () => {
    const inner = rectangularSelection({ bitmap, size });
    expect(rectangularSelection.length).toBe(1);
    expect(inner.length).toBe(0);
  });

  it('returns ToolResult (BitmapSource array)', () => {
    const result = rectangularSelection({ bitmap, size })();
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(1);
  });
});

describe('applyMarqueeRatio', () => {
  it('applies fixed ratio constraint when already matching', () => {
    const rect = { width: 100, height: 50 };
    const result = applyMarqueeRatio(rect, 2);
    expect(result.width).toBe(100);
    expect(result.height).toBe(50);
  });

  it('expands height to match ratio when width is dominant', () => {
    const rect = { width: 100, height: 30 };
    const result = applyMarqueeRatio(rect, 2);
    expect(result.width).toBe(100);
    expect(result.height).toBe(50);
  });

  it('expands width to match ratio when height is dominant', () => {
    const rect = { width: 30, height: 100 };
    const result = applyMarqueeRatio(rect, 2);
    expect(result.width).toBe(200);
    expect(result.height).toBe(100);
  });

  it('handles zero width', () => {
    const rect = { width: 0, height: 50 };
    const result = applyMarqueeRatio(rect, 2);
    expect(result.width).toBe(100);
    expect(result.height).toBe(50);
  });

  it('handles zero height', () => {
    const rect = { width: 50, height: 0 };
    const result = applyMarqueeRatio(rect, 2);
    expect(result.width).toBe(50);
    expect(result.height).toBe(25);
  });

  it('handles both zero', () => {
    const rect = { width: 0, height: 0 };
    const result = applyMarqueeRatio(rect, 2);
    expect(result.width).toBe(0);
    expect(result.height).toBe(0);
  });

  it('returns unchanged when ratio is null', () => {
    const rect = { width: 100, height: 50 };
    const result = applyMarqueeRatio(rect, null);
    expect(result).toEqual(rect);
  });

  it('handles ratio < 1 (portrait)', () => {
    const rect = { width: 50, height: 100 };
    const result = applyMarqueeRatio(rect, 0.5);
    expect(result.width).toBe(50);
    expect(result.height).toBe(100);
  });

  it('handles ratio > 1 (landscape)', () => {
    const rect = { width: 100, height: 50 };
    const result = applyMarqueeRatio(rect, 2);
    expect(result.width).toBe(100);
    expect(result.height).toBe(50);
  });

  it('handles fractional ratios', () => {
    const rect = { width: 100, height: 100 };
    const result = applyMarqueeRatio(rect, 1.5);
    expect(result.width).toBe(150);
    expect(result.height).toBe(100);
  });

  it('handles large ratios', () => {
    const rect = { width: 10, height: 10 };
    const result = applyMarqueeRatio(rect, 20);
    expect(result.width).toBe(200);
    expect(result.height).toBe(10);
  });

  it('handles small ratios', () => {
    const rect = { width: 10, height: 10 };
    const result = applyMarqueeRatio(rect, 0.05);
    expect(result.width).toBe(10);
    expect(result.height).toBe(200);
  });
});

describe('resolveEllipseRect', () => {
  it('returns fixed-size rect centered on start', () => {
    const drag: EllipticalMarqueeDrag = {
      start: { x: 100, y: 100 },
      end: { x: 200, y: 200 },
      style: 'fixed-size',
      fixedRatio: 1,
      fixedWidth: 50,
      fixedHeight: 30,
    };
    const rect = resolveEllipseRect(drag);
    expect(rect).not.toBeNull();
    expect(rect!.x1).toBe(75);
    expect(rect!.y1).toBe(85);
    expect(rect!.x2).toBe(125);
    expect(rect!.y2).toBe(115);
  });

  it('returns null for zero fixedWidth', () => {
    const drag: EllipticalMarqueeDrag = {
      start: { x: 100, y: 100 },
      end: { x: 200, y: 200 },
      style: 'fixed-size',
      fixedRatio: 1,
      fixedWidth: 0,
      fixedHeight: 30,
    };
    expect(resolveEllipseRect(drag)).toBeNull();
  });

  it('returns null for zero fixedHeight', () => {
    const drag: EllipticalMarqueeDrag = {
      start: { x: 100, y: 100 },
      end: { x: 200, y: 200 },
      style: 'fixed-size',
      fixedRatio: 1,
      fixedWidth: 50,
      fixedHeight: 0,
    };
    expect(resolveEllipseRect(drag)).toBeNull();
  });

  it('returns null for non-finite fixedWidth', () => {
    const drag: EllipticalMarqueeDrag = {
      start: { x: 100, y: 100 },
      end: { x: 200, y: 200 },
      style: 'fixed-size',
      fixedRatio: 1,
      fixedWidth: Number.NaN,
      fixedHeight: 30,
    };
    expect(resolveEllipseRect(drag)).toBeNull();
  });

  it('returns rect for normal style with drag', () => {
    const drag: EllipticalMarqueeDrag = {
      start: { x: 10, y: 10 },
      end: { x: 50, y: 50 },
      style: 'normal',
      fixedRatio: 1,
      fixedWidth: 100,
      fixedHeight: 100,
    };
    const rect = resolveEllipseRect(drag);
    expect(rect).not.toBeNull();
    expect(rect!.x1).toBe(10);
    expect(rect!.y1).toBe(10);
    expect(rect!.x2).toBe(50);
    expect(rect!.y2).toBe(50);
  });

  it('applies ratio constraint for fixed-ratio style', () => {
    const drag: EllipticalMarqueeDrag = {
      start: { x: 10, y: 10 },
      end: { x: 50, y: 30 },
      style: 'fixed-ratio',
      fixedRatio: 2,
      fixedWidth: 100,
      fixedHeight: 100,
    };
    const rect = resolveEllipseRect(drag);
    expect(rect).not.toBeNull();
    expect(rect!.x2 - rect!.x1).toBe(40);
    expect(rect!.y2 - rect!.y1).toBe(20);
  });

  it('applies ratio constraint when drag does not match ratio', () => {
    const drag: EllipticalMarqueeDrag = {
      start: { x: 10, y: 10 },
      end: { x: 50, y: 30 },
      style: 'fixed-ratio',
      fixedRatio: 1,
      fixedWidth: 100,
      fixedHeight: 100,
    };
    const rect = resolveEllipseRect(drag);
    expect(rect).not.toBeNull();
    expect(rect!.x2 - rect!.x1).toBe(40);
    expect(rect!.y2 - rect!.y1).toBe(40);
  });

  it('returns null for zero-width drag', () => {
    const drag: EllipticalMarqueeDrag = {
      start: { x: 10, y: 10 },
      end: { x: 10, y: 50 },
      style: 'normal',
      fixedRatio: 1,
      fixedWidth: 100,
      fixedHeight: 100,
    };
    expect(resolveEllipseRect(drag)).toBeNull();
  });

  it('returns null for zero-height drag', () => {
    const drag: EllipticalMarqueeDrag = {
      start: { x: 10, y: 10 },
      end: { x: 50, y: 10 },
      style: 'normal',
      fixedRatio: 1,
      fixedWidth: 100,
      fixedHeight: 100,
    };
    expect(resolveEllipseRect(drag)).toBeNull();
  });

  it('handles fromCentre option', () => {
    const drag: EllipticalMarqueeDrag = {
      start: { x: 100, y: 100 },
      end: { x: 150, y: 150 },
      style: 'normal',
      fixedRatio: 1,
      fixedWidth: 100,
      fixedHeight: 100,
      fromCentre: true,
    };
    const rect = resolveEllipseRect(drag);
    expect(rect).not.toBeNull();
    expect(rect!.x1).toBe(75);
    expect(rect!.y1).toBe(75);
    expect(rect!.x2).toBe(125);
    expect(rect!.y2).toBe(125);
  });

  it('returns null for zero drag extent (constrained width becomes 0)', () => {
    const drag: EllipticalMarqueeDrag = {
      start: { x: 100, y: 100 },
      end: { x: 100, y: 150 },
      style: 'normal',
      fixedRatio: 1,
      fixedWidth: 100,
      fixedHeight: 100,
      fromCentre: false,
    };
    // When draggedX = 0, constrained.width = 0 after applyMarqueeRatio, so returns null
    expect(resolveEllipseRect(drag)).toBeNull();
  });

  it('handles constrainToCircle', () => {
    const drag: EllipticalMarqueeDrag = {
      start: { x: 10, y: 10 },
      end: { x: 50, y: 30 },
      style: 'fixed-ratio',
      fixedRatio: 2,
      fixedWidth: 100,
      fixedHeight: 100,
      constrainToCircle: true,
    };
    const rect = resolveEllipseRect(drag);
    expect(rect).not.toBeNull();
    expect(rect!.x2 - rect!.x1).toBe(40);
    expect(rect!.y2 - rect!.y1).toBe(40);
  });

  it('returns null for zero fixed-size dimensions', () => {
    const drag: EllipticalMarqueeDrag = {
      start: { x: 100, y: 100 },
      end: { x: 200, y: 200 },
      style: 'fixed-size',
      fixedRatio: 1,
      fixedWidth: 0,
      fixedHeight: 0,
    };
    expect(resolveEllipseRect(drag)).toBeNull();
  });
});

describe('ellipseVertexCount', () => {
  it('returns ELLIPSE_MIN_VERTICES for zero radius', () => {
    expect(ellipseVertexCount(0, 0)).toBe(ELLIPSE_MIN_VERTICES);
  });

  it('returns ELLIPSE_MIN_VERTICES for negative radius', () => {
    expect(ellipseVertexCount(-10, -10)).toBe(ELLIPSE_MIN_VERTICES);
  });

  it('returns ELLIPSE_MIN_VERTICES for small radius', () => {
    expect(ellipseVertexCount(1, 1)).toBe(ELLIPSE_MIN_VERTICES);
  });

  it('increases with radius', () => {
    const v1 = ellipseVertexCount(100, 100);
    const v2 = ellipseVertexCount(200, 200);
    expect(v2).toBeGreaterThanOrEqual(v1);
  });

  it('is capped at ELLIPSE_MAX_VERTICES', () => {
    const v = ellipseVertexCount(10000, 10000);
    expect(v).toBeLessThanOrEqual(ELLIPSE_MAX_VERTICES);
  });

  it('uses max of radiusX and radiusY', () => {
    const v1 = ellipseVertexCount(100, 50);
    const v2 = ellipseVertexCount(50, 100);
    expect(v1).toBe(v2);
  });

  it('returns at least ELLIPSE_MIN_VERTICES', () => {
    for (let r = 1; r < 1000; r *= 2) {
      expect(ellipseVertexCount(r, r)).toBeGreaterThanOrEqual(ELLIPSE_MIN_VERTICES);
    }
  });

  it('returns 32 for radius 50', () => {
    // radius = 50 -> sagittaRatio = 0.25/50 = 0.005
    // acos(1 - 0.005) = acos(0.995) ≈ 0.0999
    // PI / 0.0999 ≈ 31.4 -> ceil = 32
    expect(ellipseVertexCount(50, 50)).toBe(32);
  });
});

describe('ellipsePointsInRect', () => {
  it('returns correct number of points for radius 50', () => {
    const rect: RectXYSorted = { x1: 0, y1: 0, x2: 100, y2: 100 };
    const points = ellipsePointsInRect(rect);
    expect(points.length).toBe(32); // ellipseVertexCount(50, 50) = 32
  });

  it('points form an ellipse', () => {
    const rect: RectXYSorted = { x1: 0, y1: 0, x2: 100, y2: 100 };
    const points = ellipsePointsInRect(rect);
    const centerX = 50;
    const centerY = 50;
    const radiusX = 50;
    const radiusY = 50;

    for (const p of points) {
      const dx = (p.x - centerX) / radiusX;
      const dy = (p.y - centerY) / radiusY;
      const dist = dx * dx + dy * dy;
      expect(dist).toBeCloseTo(1, 5);
    }
  });

  it('handles non-square rect', () => {
    const rect: RectXYSorted = { x1: 0, y1: 0, x2: 200, y2: 100 };
    const points = ellipsePointsInRect(rect);
    expect(points.length).toBeGreaterThanOrEqual(ELLIPSE_MIN_VERTICES);
    const centerX = 100;
    const centerY = 50;
    const radiusX = 100;
    const radiusY = 50;

    for (const p of points) {
      const dx = (p.x - centerX) / radiusX;
      const dy = (p.y - centerY) / radiusY;
      const dist = dx * dx + dy * dy;
      expect(dist).toBeCloseTo(1, 5);
    }
  });

  it('handles negative coordinates', () => {
    const rect: RectXYSorted = { x1: -50, y1: -50, x2: 50, y2: 50 };
    const points = ellipsePointsInRect(rect);
    expect(points.length).toBe(32);
  });
});

describe('ellipsePointsFromDrag', () => {
  it('returns points for valid drag', () => {
    const drag: EllipticalMarqueeDrag = {
      start: { x: 10, y: 10 },
      end: { x: 50, y: 50 },
      style: 'normal',
      fixedRatio: 1,
      fixedWidth: 100,
      fixedHeight: 100,
    };
    const points = ellipsePointsFromDrag(drag);
    expect(points).not.toBeNull();
    expect(points!.length).toBeGreaterThanOrEqual(ELLIPSE_MIN_VERTICES);
  });

  it('returns null for zero-area drag', () => {
    const drag: EllipticalMarqueeDrag = {
      start: { x: 10, y: 10 },
      end: { x: 10, y: 10 },
      style: 'normal',
      fixedRatio: 1,
      fixedWidth: 100,
      fixedHeight: 100,
    };
    expect(ellipsePointsFromDrag(drag)).toBeNull();
  });

  it('returns points for fixed-size style', () => {
    const drag: EllipticalMarqueeDrag = {
      start: { x: 100, y: 100 },
      end: { x: 200, y: 200 },
      style: 'fixed-size',
      fixedRatio: 1,
      fixedWidth: 50,
      fixedHeight: 30,
    };
    const points = ellipsePointsFromDrag(drag);
    expect(points).not.toBeNull();
    expect(points!.length).toBeGreaterThanOrEqual(ELLIPSE_MIN_VERTICES);
  });

  it('returns null for invalid fixed-size', () => {
    const drag: EllipticalMarqueeDrag = {
      start: { x: 100, y: 100 },
      end: { x: 200, y: 200 },
      style: 'fixed-size',
      fixedRatio: 1,
      fixedWidth: 0,
      fixedHeight: 30,
    };
    expect(ellipsePointsFromDrag(drag)).toBeNull();
  });
});

describe('Marquee constants', () => {
  it('exports expected ratio constants', () => {
    expect(MARQUEE_RATIO_MIN).toBe(0.05);
    expect(MARQUEE_RATIO_MAX).toBe(20);
    expect(MARQUEE_RATIO_STEP).toBe(0.05);
  });

  it('exports expected size constants', () => {
    expect(MARQUEE_SIZE_MIN).toBe(1);
    expect(MARQUEE_SIZE_MAX).toBe(2000);
    expect(MARQUEE_SIZE_STEP).toBe(1);
  });

  it('exports marquee styles', () => {
    expect(MARQUEE_STYLES.map((s) => s.value)).toContain('normal');
    expect(MARQUEE_STYLES.map((s) => s.value)).toContain('fixed-ratio');
    expect(MARQUEE_STYLES.map((s) => s.value)).toContain('fixed-size');
    expect(MARQUEE_STYLES).toHaveLength(3);
  });

  it('exports ellipse constants', () => {
    expect(ELLIPSE_MAX_SAGITTA_PX).toBe(0.25);
    expect(ELLIPSE_MIN_VERTICES).toBe(16);
    expect(ELLIPSE_MAX_VERTICES).toBe(720);
  });

  it('exports ELLIPTICAL_SELECTION_SOURCE_TOOL', () => {
    expect(ELLIPTICAL_SELECTION_SOURCE_TOOL).toBe('magic-wand');
  });
});

describe('isMarqueeStyle', () => {
  it('returns true for valid styles', () => {
    expect(isMarqueeStyle('normal')).toBe(true);
    expect(isMarqueeStyle('fixed-ratio')).toBe(true);
    expect(isMarqueeStyle('fixed-size')).toBe(true);
  });

  it('returns false for invalid styles', () => {
    expect(isMarqueeStyle('invalid')).toBe(false);
    expect(isMarqueeStyle('')).toBe(false);
    expect(isMarqueeStyle('circle')).toBe(false);
    expect(isMarqueeStyle('square')).toBe(false);
  });

  it('type guard narrows type', () => {
    const value: string = 'normal';
    if (isMarqueeStyle(value)) {
      expect(['normal', 'fixed-ratio', 'fixed-size']).toContain(value);
    }
  });
});

describe('RectangularSelectionToolArgs type', () => {
  it('requires toolName', () => {
    const args: RectangularSelectionToolArgs = { toolName: 'rectangular-selection' };
    expect(args.toolName).toBe('rectangular-selection');
  });

  it('allows optional rect', () => {
    const args1: RectangularSelectionToolArgs = {
      rect: { x1: 0, y1: 0, x2: 10, y2: 10 },
      toolName: 'rectangular-selection',
    };
    const args2: RectangularSelectionToolArgs = { rect: null, toolName: 'rectangular-selection' };
    const args3: RectangularSelectionToolArgs = { toolName: 'rectangular-selection' };
    expect(args1.rect).toEqual({ x1: 0, y1: 0, x2: 10, y2: 10 });
    expect(args2.rect).toBeNull();
    expect(args3.rect).toBeUndefined();
  });

  it('allows optional style', () => {
    const styles: MarqueeStyle[] = ['normal', 'fixed-ratio', 'fixed-size'];
    for (const style of styles) {
      const args: RectangularSelectionToolArgs = { style, toolName: 'rectangular-selection' };
      expect(args.style).toBe(style);
    }
  });

  it('allows optional fixedRatio', () => {
    const args: RectangularSelectionToolArgs = { fixedRatio: 1.5, toolName: 'rectangular-selection' };
    expect(args.fixedRatio).toBe(1.5);
  });

  it('allows optional fixedWidth', () => {
    const args: RectangularSelectionToolArgs = { fixedWidth: 100, toolName: 'rectangular-selection' };
    expect(args.fixedWidth).toBe(100);
  });

  it('allows optional fixedHeight', () => {
    const args: RectangularSelectionToolArgs = { fixedHeight: 200, toolName: 'rectangular-selection' };
    expect(args.fixedHeight).toBe(200);
  });

  it('toolName must be "rectangular-selection"', () => {
    const args: RectangularSelectionToolArgs = { toolName: 'rectangular-selection' };
    expect(args.toolName).toBe('rectangular-selection');
    // @ts-expect-error toolName must be 'rectangular-selection'
    const invalid: RectangularSelectionToolArgs = { toolName: 'other' };
  });
});

describe('EllipticalSelectionToolArgs type', () => {
  it('requires all fields', () => {
    const args: EllipticalSelectionToolArgs = {
      style: 'normal',
      fixedRatio: 1,
      fixedWidth: 100,
      fixedHeight: 100,
      toolName: 'elliptical-selection',
    };
    expect(args.style).toBe('normal');
    expect(args.fixedRatio).toBe(1);
    expect(args.fixedWidth).toBe(100);
    expect(args.fixedHeight).toBe(100);
    expect(args.toolName).toBe('elliptical-selection');
  });

  it('toolName must be "elliptical-selection"', () => {
    const args: EllipticalSelectionToolArgs = {
      style: 'normal',
      fixedRatio: 1,
      fixedWidth: 100,
      fixedHeight: 100,
      toolName: 'elliptical-selection',
    };
    expect(args.toolName).toBe('elliptical-selection');
    // @ts-expect-error toolName must be 'elliptical-selection'
    const invalid: EllipticalSelectionToolArgs = { ...args, toolName: 'other' };
  });
});

describe('EllipticalMarqueeDrag type', () => {
  it('requires all fields', () => {
    const drag: EllipticalMarqueeDrag = {
      start: { x: 0, y: 0 },
      end: { x: 10, y: 10 },
      style: 'normal',
      fixedRatio: 1,
      fixedWidth: 100,
      fixedHeight: 100,
    };
    expect(drag.start).toEqual({ x: 0, y: 0 });
    expect(drag.end).toEqual({ x: 10, y: 10 });
    expect(drag.style).toBe('normal');
  });

  it('allows optional constrainToCircle', () => {
    const drag: EllipticalMarqueeDrag = {
      start: { x: 0, y: 0 },
      end: { x: 10, y: 10 },
      style: 'normal',
      fixedRatio: 1,
      fixedWidth: 100,
      fixedHeight: 100,
      constrainToCircle: true,
    };
    expect(drag.constrainToCircle).toBe(true);
  });

  it('allows optional fromCentre', () => {
    const drag: EllipticalMarqueeDrag = {
      start: { x: 0, y: 0 },
      end: { x: 10, y: 10 },
      style: 'normal',
      fixedRatio: 1,
      fixedWidth: 100,
      fixedHeight: 100,
      fromCentre: true,
    };
    expect(drag.fromCentre).toBe(true);
  });
});
