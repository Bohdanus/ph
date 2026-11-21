import { describe, expect, it } from 'vitest';

import { reposition, type RepositionToolArgs } from '../reposition.ts';
import { createMockImageBitmap } from '../../__tests__/fixtures/canvas.ts';
import type { BitmapSource, Point, Pos } from '../../contexts/general-types.ts';

const size = { width: 2, height: 1 };
const bitmap = createMockImageBitmap(size.width, size.height) as unknown as BitmapSource;

describe('reposition processor', () => {
  it('returns bitmap and move vector when move is provided', () => {
    const move: Point = { x: 10, y: 20 };
    const result = reposition({ bitmap, size })({ move, toolName: 'reposition' } satisfies RepositionToolArgs);

    expect(result).toBeDefined();
    expect(result).toHaveLength(2);
    expect(result[0]).toBe(bitmap);
    expect(result[1]).toEqual(move);
  });

  it('returns bitmap and resize geometry when resize is provided', () => {
    const resize: Pos = { x: 100, y: 100, width: 100, height: 100 };
    const result = reposition({ bitmap, size })({ resize, toolName: 'reposition' } satisfies RepositionToolArgs);

    expect(result).toEqual([bitmap, resize]);
    expect(result?.[0]).toBe(bitmap);
    expect(result?.[1]).toEqual(resize);
  });

  it('returns only the bitmap when no geometry patch is provided', () => {
    const result = reposition({ bitmap, size })({ toolName: 'reposition' } satisfies RepositionToolArgs);

    expect(result).toEqual([bitmap]);
    expect(result).toHaveLength(1);
  });

  it('is a two-stage curried processor', () => {
    const inner = reposition({ bitmap, size });
    expect(reposition.length).toBe(1);
    expect(inner.length).toBe(1);
  });

  it('returns ToolResult (BitmapSource array)', () => {
    const result = reposition({ bitmap, size })({ toolName: 'reposition' } satisfies RepositionToolArgs);
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(1);
  });

  it('returns ToolResult with position patch when move provided', () => {
    const move: Point = { x: 5, y: -3 };
    const result = reposition({ bitmap, size })({ move, toolName: 'reposition' } satisfies RepositionToolArgs);
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(2);
    expect(result[0]).toBe(bitmap);
    expect(result[1]).toEqual(move);
  });

  it('returns ToolResult with position patch when resize provided', () => {
    const resize: Pos = { x: 0, y: 0, width: 50, height: 50 };
    const result = reposition({ bitmap, size })({ resize, toolName: 'reposition' } satisfies RepositionToolArgs);
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(2);
    expect(result[0]).toBe(bitmap);
    expect(result[1]).toEqual(resize);
  });

  it('handles negative move coordinates', () => {
    const move: Point = { x: -50, y: -30 };
    const result = reposition({ bitmap, size })({ move, toolName: 'reposition' } satisfies RepositionToolArgs);
    expect(result[1]).toEqual(move);
  });

  it('handles zero move coordinates', () => {
    const move: Point = { x: 0, y: 0 };
    const result = reposition({ bitmap, size })({ move, toolName: 'reposition' } satisfies RepositionToolArgs);
    expect(result[1]).toEqual(move);
  });

  it('handles zero-sized resize', () => {
    const resize: Pos = { x: 10, y: 10, width: 0, height: 0 };
    const result = reposition({ bitmap, size })({ resize, toolName: 'reposition' } satisfies RepositionToolArgs);
    expect(result[1]).toEqual(resize);
  });

  it('handles different bitmap sizes', () => {
    const sizes = [
      { width: 1, height: 1 },
      { width: 100, height: 100 },
      { width: 1920, height: 1080 },
    ];
    for (const s of sizes) {
      const bmp = createMockImageBitmap(s.width, s.height) as unknown as BitmapSource;
      const result = reposition({ size: s, bitmap: bmp })({ toolName: 'reposition' } satisfies RepositionToolArgs);
      expect(result).toEqual([bmp]);
    }
  });

  it('handles move with decimal coordinates', () => {
    const move: Point = { x: 10.5, y: 20.7 };
    const result = reposition({ bitmap, size })({ move, toolName: 'reposition' } satisfies RepositionToolArgs);
    expect(result[1]).toEqual(move);
  });

  it('handles resize with decimal coordinates', () => {
    const resize: Pos = { x: 10.3, y: 20.6, width: 100.9, height: 200.1 };
    const result = reposition({ bitmap, size })({ resize, toolName: 'reposition' } satisfies RepositionToolArgs);
    expect(result[1]).toEqual(resize);
  });

  it('positionPatch prefers resize over move (type-level exclusion enforced)', () => {
    // TypeScript enforces mutual exclusion, but at runtime if both were somehow present,
    // the ternary `resize ?? move` would prefer resize
    const resize: Pos = { x: 0, y: 0, width: 10, height: 10 };
    const result = reposition({ bitmap, size })({ resize, toolName: 'reposition' } satisfies RepositionToolArgs);
    expect(result[1]).toBe(resize);
  });
});

describe('RepositionToolArgs type', () => {
  it('accepts move, resize, and the idle tool state', () => {
    const move: RepositionToolArgs = { move: { x: 10, y: 20 }, toolName: 'reposition' };
    const resize: RepositionToolArgs = {
      resize: { x: 100, y: 100, width: 100, height: 100 },
      toolName: 'reposition',
    };
    const idle: RepositionToolArgs = { toolName: 'reposition' };

    expect(move.move).toEqual({ x: 10, y: 20 });
    expect(resize.resize).toEqual({ x: 100, y: 100, width: 100, height: 100 });
    expect(idle.toolName).toBe('reposition');
  });

  it('rejects both move and resize together (compile-time)', () => {
    // @ts-expect-error move and resize are mutually exclusive
    const args: RepositionToolArgs = {
      move: { x: 10, y: 20 },
      resize: { x: 100, y: 100, width: 100, height: 100 },
      toolName: 'reposition',
    };
    void args;
  });

  it('allows only move', () => {
    const args: RepositionToolArgs = {
      move: { x: 5, y: 5 },
      toolName: 'reposition',
    };
    expect(args.move).toEqual({ x: 5, y: 5 });
    expect(args.resize).toBeUndefined();
  });

  it('allows only resize', () => {
    const args: RepositionToolArgs = {
      resize: { x: 200, y: 200, width: 200, height: 200 },
      toolName: 'reposition',
    };
    expect(args.resize).toEqual({ x: 200, y: 200, width: 200, height: 200 });
    expect(args.move).toBeUndefined();
  });

  it('requires toolName to be "reposition"', () => {
    const args: RepositionToolArgs = { toolName: 'reposition' };
    expect(args.toolName).toBe('reposition');
    // @ts-expect-error toolName must be 'reposition'
    const invalid: RepositionToolArgs = { toolName: 'other' };
  });

  it('move uses Point type (x, y)', () => {
    const args: RepositionToolArgs = { move: { x: 1, y: 2 }, toolName: 'reposition' };
    expect(args.move).toHaveProperty('x');
    expect(args.move).toHaveProperty('y');
  });

  it('resize uses Pos type (x, y, width, height)', () => {
    const args: RepositionToolArgs = { resize: { x: 1, y: 2, width: 3, height: 4 }, toolName: 'reposition' };
    expect(args.resize).toHaveProperty('x');
    expect(args.resize).toHaveProperty('y');
    expect(args.resize).toHaveProperty('width');
    expect(args.resize).toHaveProperty('height');
  });
});

describe('reposition integration', () => {
  it('processor signature matches ToolResult return type', () => {
    const result = reposition({ bitmap, size })({ toolName: 'reposition' } satisfies RepositionToolArgs);
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result.length).toBeLessThanOrEqual(2);
  });

  it('first element is always the source bitmap', () => {
    const move: Point = { x: 1, y: 2 };
    const result = reposition({ bitmap, size })({ move, toolName: 'reposition' } satisfies RepositionToolArgs);
    expect(result[0]).toBe(bitmap);
  });

  it('second element is the position patch when provided', () => {
    const move: Point = { x: 1, y: 2 };
    const result = reposition({ bitmap, size })({ move, toolName: 'reposition' } satisfies RepositionToolArgs);
    expect(result[1]).toEqual(move);
  });

  it('handles multiple calls independently', () => {
    const result1 = reposition({ bitmap, size })({ toolName: 'reposition' } satisfies RepositionToolArgs);
    const result2 = reposition({ bitmap, size })({
      move: { x: 1, y: 1 },
      toolName: 'reposition',
    } satisfies RepositionToolArgs);
    const result3 = reposition({ bitmap, size })({
      resize: { x: 0, y: 0, width: 10, height: 10 },
      toolName: 'reposition',
    } satisfies RepositionToolArgs);

    expect(result1).toHaveLength(1);
    expect(result2).toHaveLength(2);
    expect(result3).toHaveLength(2);
  });
});
