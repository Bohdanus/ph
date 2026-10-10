import { describe, expect, it } from 'vitest';

import { getIncrementalStrokeArgs } from '../useLayer.ts';
import type { DrawToolArgs } from '../../tools/draw.ts';

const baseArgs = (overrides: Partial<DrawToolArgs> = {}): DrawToolArgs => ({
  alpha: 1,
  color: '#000000',
  lineWidth: 4,
  penType: 'pen',
  toolName: 'draw',
  points: [
    { x: 2, y: 3 },
    { x: 8, y: 9 },
  ],
  ...overrides,
});

describe('getIncrementalStrokeArgs', () => {
  it('keeps the previous endpoint so a stroked segment remains connected', () => {
    const previous = baseArgs();
    const current = baseArgs({ points: [...previous.points!, { x: 14, y: 15 }] });

    expect(getIncrementalStrokeArgs(current, previous)?.points).toEqual([
      { x: 8, y: 9 },
      { x: 14, y: 15 },
    ]);
  });

  it.each([
    ['spray', { penType: 'spray' as const }],
    ['block', { blockStamp: true }],
  ])('falls back to a full replay for %s strokes', (_name, overrides) => {
    expect(getIncrementalStrokeArgs(baseArgs(overrides), baseArgs())).toBeNull();
  });

  it('falls back when the current path is not an extension of the previous path', () => {
    expect(
      getIncrementalStrokeArgs(
        baseArgs({
          points: [
            { x: 2, y: 3 },
            { x: 99, y: 100 },
            { x: 14, y: 15 },
          ],
        }),
        baseArgs()
      )
    ).toBeNull();
  });

  it('falls back when the stroke mode changes between previews', () => {
    expect(getIncrementalStrokeArgs(baseArgs({ penType: 'pen-dashed' }), baseArgs())).toBeNull();
  });
});
