import { describe, expect, it } from 'vitest';

import { getIncrementalEraserArgs } from '../useLayer.ts';
import type { EraserToolArgs } from '../../tools/eraser.ts';

const eraserArgs = (overrides: Partial<EraserToolArgs> = {}): EraserToolArgs => ({
  alpha: 1,
  color: '#000000',
  hardness: 100,
  lineWidth: 4,
  mode: 'brush',
  points: [
    { x: 2, y: 3 },
    { x: 8, y: 9 },
  ],
  spacing: 25,
  toolName: 'eraser',
  ...overrides,
});

describe('getIncrementalEraserArgs selection snapshots', () => {
  it('treats a legacy flat contour and an equivalent nested contour as the same selection', () => {
    const contour = [
      { x: 1, y: 1 },
      { x: 5, y: 1 },
      { x: 5, y: 5 },
      { x: 1, y: 5 },
    ];
    const previous = eraserArgs({
      selection: { points: contour, featherRadius: 0, antiAlias: true },
    });
    const current = eraserArgs({
      points: [...previous.points, { x: 14, y: 15 }],
      selection: { points: [contour], featherRadius: 0, antiAlias: true },
    });

    expect(getIncrementalEraserArgs(current, previous)?.points).toEqual([
      { x: 8, y: 9 },
      { x: 14, y: 15 },
    ]);
  });

  it('falls back to full processing when any nested contour changes', () => {
    const contours = [
      [
        { x: 0, y: 0 },
        { x: 8, y: 0 },
        { x: 8, y: 8 },
        { x: 0, y: 8 },
      ],
      [
        { x: 2, y: 2 },
        { x: 6, y: 2 },
        { x: 6, y: 6 },
        { x: 2, y: 6 },
      ],
    ];
    const previous = eraserArgs({
      selection: { points: contours, featherRadius: 0, antiAlias: true },
    });
    const currentContours = contours.map((contour) => contour.map((point) => ({ ...point })));
    currentContours[1][1] = { x: 7, y: 2 };
    const current = eraserArgs({
      points: [...previous.points, { x: 14, y: 15 }],
      selection: { points: currentContours, featherRadius: 0, antiAlias: true },
    });

    expect(getIncrementalEraserArgs(current, previous)).toBeNull();
  });
});
