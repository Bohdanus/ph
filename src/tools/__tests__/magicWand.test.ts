import { describe, expect, it } from 'vitest';

import { magicWand, type MagicWandToolArgs, type MagicWandToolSettings } from '../magicWand.ts';
import { createMockImageBitmap } from '../../__tests__/fixtures/canvas.ts';
import type { BitmapSource } from '../../contexts/general-types.ts';
import type { ProcessorToolParams } from '../toolProcessors.ts';

const makeBitmap = (width: number, height: number) => createMockImageBitmap(width, height) as unknown as BitmapSource;

const size = { width: 2, height: 1 };
const bitmap = makeBitmap(size.width, size.height);

describe('magicWand processor', () => {
  it('returns the bitmap unchanged (magic wand selection is handled elsewhere)', () => {
    const [result] = magicWand({ bitmap, size })();
    expect(result).toBe(bitmap);
  });

  it('ignores args completely (selection logic is external)', () => {
    const [result] = magicWand({ bitmap, size })();
    expect(result).toBe(bitmap);
  });

  it('is a two-stage curried processor', () => {
    const inner = magicWand({ bitmap, size });
    expect(magicWand.length).toBe(1);
    expect(inner.length).toBe(0);
  });

  it('works with different sizes', () => {
    const sizes = [
      { width: 1, height: 1 },
      { width: 100, height: 100 },
      { width: 1920, height: 1080 },
    ];
    for (const s of sizes) {
      const bmp = makeBitmap(s.width, s.height);
      const [result] = magicWand({ size: s, bitmap: bmp })();
      expect(result).toBe(bmp);
    }
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

  it('accepts tolerance as number', () => {
    const args: MagicWandToolArgs = { tolerance: 0, smoothing: 0, contiguous: true, toolName: 'magic-wand' };
    expect(args.tolerance).toBe(0);
    const args2: MagicWandToolArgs = { tolerance: 255, smoothing: 0, contiguous: true, toolName: 'magic-wand' };
    expect(args2.tolerance).toBe(255);
  });

  it('accepts smoothing as number', () => {
    const args: MagicWandToolArgs = { tolerance: 32, smoothing: 0, contiguous: true, toolName: 'magic-wand' };
    expect(args.smoothing).toBe(0);
    const args2: MagicWandToolArgs = { tolerance: 32, smoothing: 100, contiguous: true, toolName: 'magic-wand' };
    expect(args2.smoothing).toBe(100);
  });

  it('accepts contiguous as boolean', () => {
    const argsTrue: MagicWandToolArgs = { tolerance: 32, smoothing: 0, contiguous: true, toolName: 'magic-wand' };
    expect(argsTrue.contiguous).toBe(true);
    const argsFalse: MagicWandToolArgs = { tolerance: 32, smoothing: 0, contiguous: false, toolName: 'magic-wand' };
    expect(argsFalse.contiguous).toBe(false);
  });

  it('requires toolName to be "magic-wand"', () => {
    const args: MagicWandToolArgs = { tolerance: 32, smoothing: 0, contiguous: true, toolName: 'magic-wand' };
    expect(args.toolName).toBe('magic-wand');
    // @ts-expect-error toolName must be 'magic-wand'
    const invalid: MagicWandToolArgs = { tolerance: 32, smoothing: 0, contiguous: true, toolName: 'other' };
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
    expect(settings.toolName).toBe('magic-wand');
  });

  it('shares exact same structure as args', () => {
    const args: MagicWandToolArgs = { tolerance: 32, smoothing: 5, contiguous: false, toolName: 'magic-wand' };
    const settings: MagicWandToolSettings = args;
    expect(settings).toEqual(args);
  });
});

describe('magicWand integration', () => {
  it('matches processor signature from toolProcessors', () => {
    const params: ProcessorToolParams = { bitmap, size };
    const processor = magicWand(params);
    expect(typeof processor).toBe('function');
    const result = processor();
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(1);
  });

  it('returns ToolResult (BitmapSource array)', () => {
    const [result] = magicWand({ bitmap, size })();
    expect(result).toBe(bitmap);
  });
});
