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

  it('returns only bitmap when no move is provided', () => {
    const result = reposition({ bitmap, size })({ toolName: 'reposition' } satisfies RepositionToolArgs);

    // The function returns undefined when no move is provided
    expect(result).toBeUndefined();
  });

  it('handles resize args (though not used in processor)', () => {
    const resize = { x: 100, y: 100, width: 100, height: 100 };
    const result = reposition({ bitmap, size })({ resize, toolName: 'reposition' } satisfies RepositionToolArgs);

    expect(result).toBeUndefined();
  });
});

describe('RepositionToolArgs type', () => {
  it('requires toolName and optional move and resize', () => {
    const args: RepositionToolArgs = {
      move: { x: 10, y: 20 },
      resize: { x: 100, y: 100, width: 100, height: 100 },
      toolName: 'reposition',
    };
    expect(args.move).toEqual({ x: 10, y: 20 });
    expect(args.resize).toEqual({ x: 100, y: 100, width: 100, height: 100 });
    expect(args.toolName).toBe('reposition');
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
