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
import { createMockImageBitmap } from '../../__tests__/fixtures/canvas.ts';
import type { BitmapSource } from '../../contexts/general-types.ts';
import type { MarqueeStyle } from '../ellipticalSelection.ts';

describe('rectangularSelection processor', () => {
  const size = { width: 2, height: 1 };
  const bitmap = createMockImageBitmap(size.width, size.height) as unknown as BitmapSource;

  it('returns the bitmap unchanged (rectangular selection is handled elsewhere)', () => {
    const [result] = rectangularSelection({ bitmap, size })();

    expect(result).toBe(bitmap);
  });
});

describe('applyMarqueeRatio', () => {
  it('applies fixed ratio constraint', () => {
    const rect = { width: 100, height: 50 };
    const result = applyMarqueeRatio(rect, 2);
    // width/height = 2, ratio = 2 => already correct
    expect(result.width).toBe(100);
    expect(result.height).toBe(50);
  });

  it('expands height to match ratio when width is dominant', () => {
    const rect = { width: 100, height: 30 };
    const result = applyMarqueeRatio(rect, 2);
    // width/height = 3.33 > 2 => height = width/2 = 50
    expect(result.width).toBe(100);
    expect(result.height).toBe(50);
  });

  it('expands width to match ratio when height is dominant', () => {
    const rect = { width: 30, height: 100 };
    const result = applyMarqueeRatio(rect, 2);
    // width/height = 0.3 < 2 => width = height*2 = 200
    expect(result.width).toBe(200);
    expect(result.height).toBe(100);
  });

  it('handles zero dimensions', () => {
    const rect1 = { width: 0, height: 50 };
    const result1 = applyMarqueeRatio(rect1, 2);
    expect(result1.width).toBe(100);
    expect(result1.height).toBe(50);

    const rect2 = { width: 50, height: 0 };
    const result2 = applyMarqueeRatio(rect2, 2);
    expect(result2.width).toBe(50);
    expect(result2.height).toBe(25);
  });

  it('returns unchanged when ratio is null', () => {
    const rect = { width: 100, height: 50 };
    const result = applyMarqueeRatio(rect, null);
    expect(result).toEqual(rect);
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
  });
});

describe('RectangularSelectionToolArgs type', () => {
  it('requires rect, style, fixedRatio, fixedWidth, fixedHeight, and toolName', () => {
    const args: RectangularSelectionToolArgs = {
      rect: { x1: 0, y1: 0, x2: 10, y2: 10 },
      style: 'normal',
      fixedRatio: 1,
      fixedWidth: 100,
      fixedHeight: 100,
      toolName: 'rectangular-selection',
    };
    expect(args.rect).toBeDefined();
    expect(args.style).toBe('normal');
    expect(args.fixedRatio).toBe(1);
    expect(args.fixedWidth).toBe(100);
    expect(args.fixedHeight).toBe(100);
    expect(args.toolName).toBe('rectangular-selection');
  });

  it('allows rect to be null or undefined', () => {
    const args1: RectangularSelectionToolArgs = { rect: null, toolName: 'rectangular-selection' };
    const args2: RectangularSelectionToolArgs = { toolName: 'rectangular-selection' };
    expect(args1.rect).toBeNull();
    expect(args2.rect).toBeUndefined();
  });

  it('allows style to be any MarqueeStyle', () => {
    const styles: MarqueeStyle[] = ['normal', 'fixed-ratio', 'fixed-size'];
    for (const style of styles) {
      const args: RectangularSelectionToolArgs = { style, toolName: 'rectangular-selection' };
      expect(args.style).toBe(style);
    }
  });
});
