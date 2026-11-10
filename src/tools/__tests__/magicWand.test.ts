import { describe, expect, it } from 'vitest';

import { magicWand, type MagicWandToolArgs, type MagicWandToolSettings } from '../magicWand.ts';
import { createMockImageBitmap } from '../../__tests__/fixtures/canvas.ts';
import type { BitmapSource } from '../../contexts/general-types.ts';

describe('magicWand processor', () => {
  const size = { width: 2, height: 1 };
  const bitmap = createMockImageBitmap(size.width, size.height) as unknown as BitmapSource;

  it('returns the bitmap unchanged (magic wand selection is handled elsewhere)', () => {
    const [result] = magicWand({ bitmap, size })();
    expect(result).toBe(bitmap);
  });
});

describe('MagicWandToolArgs type', () => {
  it('requires tolerance, smoothing, contiguous, and toolName', () => {
    const args: MagicWandToolArgs = { tolerance: 32, smoothing: 0, contiguous: true, toolName: 'magic-wand' };
    expect(args.tolerance).toBe(32);
    expect(args.smoothing).toBe(0);
    expect(args.contiguous).toBe(true);
    expect(args.toolName).toBe('magic-wand');
  });
});

describe('MagicWandToolSettings type', () => {
  it('is the same as MagicWandToolArgs', () => {
    const settings: MagicWandToolSettings = {
      tolerance: 32,
      smoothing: 0,
      contiguous: true,
      toolName: 'magic-wand',
    };
    expect(settings.tolerance).toBe(32);
    expect(settings.smoothing).toBe(0);
    expect(settings.contiguous).toBe(true);
  });
});
