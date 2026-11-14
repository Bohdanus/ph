import { describe, expect, it } from 'vitest';
import { refitRectWidthToAspect } from '../rect-aspect.ts';
import type { RectXY } from '../../contexts/general-types.ts';

describe('refitRectWidthToAspect', () => {
  it('returns unchanged edges when aspectRatio is null', () => {
    const rect: RectXY = { x1: 10, y1: 10, x2: 50, y2: 30 };
    const result = refitRectWidthToAspect(rect, null);
    expect(result).toEqual({ x1: 10, x2: 50 });
  });

  it('returns unchanged edges when aspectRatio is 0', () => {
    const rect: RectXY = { x1: 10, y1: 10, x2: 50, y2: 30 };
    const result = refitRectWidthToAspect(rect, 0);
    expect(result).toEqual({ x1: 10, x2: 50 });
  });

  it('treats a negative aspect ratio as no constraint', () => {
    const rect: RectXY = { x1: 10, y1: 10, x2: 50, y2: 30 };
    const result = refitRectWidthToAspect(rect, -1);
    expect(result).toEqual({ x1: 10, x2: 50 });
  });

  it.each([Number.NaN, Infinity, -Infinity])('treats non-finite aspect ratio %s as no constraint', (aspectRatio) => {
    const rect: RectXY = { x1: 10, y1: 10, x2: 50, y2: 30 };
    expect(refitRectWidthToAspect(rect, aspectRatio)).toEqual({ x1: 10, x2: 50 });
  });

  it('adjusts width to match aspect ratio when x1 < x2', () => {
    const rect: RectXY = { x1: 10, y1: 10, x2: 50, y2: 30 };
    // height = 20, aspectRatio = 2 => wantedWidth = 40, currentWidth = 40, diff = 0
    const result = refitRectWidthToAspect(rect, 2);
    expect(result).toEqual({ x1: 10, x2: 50 });
  });

  it('expands width when wanted width is larger (x1 < x2)', () => {
    const rect: RectXY = { x1: 10, y1: 10, x2: 40, y2: 30 };
    // height = 20, aspectRatio = 2 => wantedWidth = 40, currentWidth = 30, diff = 5
    const result = refitRectWidthToAspect(rect, 2);
    expect(result).toEqual({ x1: 5, x2: 45 });
  });

  it('contracts width when wanted width is smaller (x1 < x2)', () => {
    const rect: RectXY = { x1: 10, y1: 10, x2: 60, y2: 30 };
    // height = 20, aspectRatio = 2 => wantedWidth = 40, currentWidth = 50, diff = -5
    const result = refitRectWidthToAspect(rect, 2);
    expect(result).toEqual({ x1: 15, x2: 55 });
  });

  it('adjusts width correctly when x1 > x2 (reversed)', () => {
    const rect: RectXY = { x1: 50, y1: 10, x2: 10, y2: 30 };
    // height = 20, aspectRatio = 2 => wantedWidth = 40, currentWidth = 40, diff = 0
    const result = refitRectWidthToAspect(rect, 2);
    expect(result).toEqual({ x1: 50, x2: 10 });
  });

  it('expands width when x1 > x2', () => {
    const rect: RectXY = { x1: 40, y1: 10, x2: 10, y2: 30 };
    // height = 20, aspectRatio = 2 => wantedWidth = 40, currentWidth = 30, diff = 5
    const result = refitRectWidthToAspect(rect, 2);
    expect(result).toEqual({ x1: 45, x2: 5 });
  });

  it('contracts width when x1 > x2', () => {
    const rect: RectXY = { x1: 60, y1: 10, x2: 10, y2: 30 };
    // height = 20, aspectRatio = 2 => wantedWidth = 40, currentWidth = 50, diff = -5
    const result = refitRectWidthToAspect(rect, 2);
    expect(result).toEqual({ x1: 55, x2: 15 });
  });

  it('handles negative coordinates', () => {
    const rect: RectXY = { x1: -30, y1: -10, x2: 10, y2: 10 };
    // height = 20, aspectRatio = 0.5 => wantedWidth = 10, currentWidth = 40, diff = -15
    const result = refitRectWidthToAspect(rect, 0.5);
    expect(result).toEqual({ x1: -15, x2: -5 });
  });

  it('handles zero height', () => {
    const rect: RectXY = { x1: 10, y1: 10, x2: 50, y2: 10 };
    // height = 0, aspectRatio = 2 => wantedWidth = 0
    const result = refitRectWidthToAspect(rect, 2);
    expect(result).toEqual({ x1: 30, x2: 30 });
  });

  it('handles aspect ratio 1 (square)', () => {
    const rect: RectXY = { x1: 10, y1: 10, x2: 50, y2: 40 };
    // height = 30, aspectRatio = 1 => wantedWidth = 30, currentWidth = 40, diff = -5
    const result = refitRectWidthToAspect(rect, 1);
    expect(result).toEqual({ x1: 15, x2: 45 });
  });

  it('handles fractional aspect ratios', () => {
    const rect: RectXY = { x1: 10, y1: 10, x2: 50, y2: 30 };
    // height = 20, aspectRatio = 0.25 => wantedWidth = 5, currentWidth = 40, diff = -17.5
    const result = refitRectWidthToAspect(rect, 0.25);
    expect(result).toEqual({ x1: 27.5, x2: 32.5 });
  });

  it('preserves center point of the rectangle', () => {
    const rect: RectXY = { x1: 10, y1: 10, x2: 50, y2: 30 };
    const centerX = (rect.x1 + rect.x2) / 2;
    const result = refitRectWidthToAspect(rect, 2);
    const newCenterX = (result.x1 + result.x2) / 2;
    expect(newCenterX).toBe(centerX);
  });

  it('handles very small aspect ratios', () => {
    const rect: RectXY = { x1: 0, y1: 0, x2: 100, y2: 100 };
    const result = refitRectWidthToAspect(rect, 0.01);
    // wantedWidth = 1, currentWidth = 100, diff = -49.5
    expect(result.x1).toBeCloseTo(49.5, 1);
    expect(result.x2).toBeCloseTo(50.5, 1);
  });

  it('handles very large aspect ratios', () => {
    const rect: RectXY = { x1: 0, y1: 0, x2: 100, y2: 100 };
    const result = refitRectWidthToAspect(rect, 100);
    // wantedWidth = 10000, currentWidth = 100, diff = 4950
    expect(result.x1).toBeCloseTo(-4950, 1);
    expect(result.x2).toBeCloseTo(5050, 1);
  });
});
