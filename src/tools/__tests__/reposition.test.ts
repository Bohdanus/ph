import { describe, expect, it } from 'vitest';

import { reposition, type RepositionToolArgs } from '../reposition.ts';
import { createMockImageBitmap } from '../../__tests__/fixtures/canvas.ts';
import type { BitmapSource } from '../../contexts/general-types.ts';

describe('reposition processor', () => {
  const size = { width: 2, height: 1 };
  const bitmap = createMockImageBitmap(size.width, size.height) as unknown as BitmapSource;

  it('returns bitmap and move vector when move is provided', () => {
    const move = { x: 10, y: 20 };
    const result = reposition({ bitmap, size })({ move, toolName: 'reposition' } satisfies RepositionToolArgs);

    expect(result).toBeDefined();
    if (result) {
      expect(result).toHaveLength(2);
      expect(result[0]).toBe(bitmap);
      expect(result[1]).toEqual(move);
    }
  });

  it('returns the bitmap and resize geometry without rasterizing it', () => {
    const resize = { x: 100, y: 100, width: 100, height: 100 };
    const result = reposition({ bitmap, size })({ resize, toolName: 'reposition' } satisfies RepositionToolArgs);

    expect(result).toEqual([bitmap, resize]);
    expect(result?.[0]).toBe(bitmap);
  });

  it('returns the bitmap when the selected reposition tool has no pending geometry patch', () => {
    const result = reposition({ bitmap, size })({ toolName: 'reposition' } satisfies RepositionToolArgs);

    expect(result).toEqual([bitmap]);
  });
});

describe('RepositionToolArgs type', () => {
  it('accepts move, resize, and the idle tool state but rejects both patches together', () => {
    const move = { move: { x: 10, y: 20 }, toolName: 'reposition' } satisfies RepositionToolArgs;
    const resize = {
      resize: { x: 100, y: 100, width: 100, height: 100 },
      toolName: 'reposition',
    } satisfies RepositionToolArgs;
    const idle = { toolName: 'reposition' } satisfies RepositionToolArgs;

    // @ts-expect-error move and resize are mutually exclusive
    const args: RepositionToolArgs = {
      move: { x: 10, y: 20 },
      resize: { x: 100, y: 100, width: 100, height: 100 },
      toolName: 'reposition',
    };
    void args;
    expect(move.move).toEqual({ x: 10, y: 20 });
    expect(resize.resize).toEqual({ x: 100, y: 100, width: 100, height: 100 });
    expect(idle.toolName).toBe('reposition');
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
});
