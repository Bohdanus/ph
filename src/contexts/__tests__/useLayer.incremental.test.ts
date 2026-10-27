import { describe, expect, it } from 'vitest';

import { getIncrementalEraserArgs, getIncrementalStrokeArgs } from '../useLayer.ts';
import type { DrawToolArgs } from '../../tools/draw.ts';
import type { EraserToolArgs } from '../../tools/eraser.ts';

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

  it.each([['spray', { penType: 'spray' as const }]])(
    'falls back to a full replay for %s strokes',
    (_name, overrides) => {
      expect(getIncrementalStrokeArgs(baseArgs(overrides), baseArgs())).toBeNull();
    }
  );

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

  describe('block-stamp strokes', () => {
    const blockArgs = (overrides: Partial<DrawToolArgs> = {}): DrawToolArgs =>
      baseArgs({ blockStamp: true, ...overrides });

    it('returns only newly added points without the shared endpoint', () => {
      const previous = blockArgs();
      const current = blockArgs({ points: [...previous.points!, { x: 14, y: 15 }] });

      const result = getIncrementalStrokeArgs(current, previous);
      expect(result).not.toBeNull();
      expect(result!.points).toEqual([{ x: 14, y: 15 }]);
      expect(result!.blockStamp).toBe(true);
    });

    it('returns multiple new points when several were added', () => {
      const previous = blockArgs();
      const current = blockArgs({
        points: [...previous.points!, { x: 14, y: 15 }, { x: 20, y: 21 }],
      });

      const result = getIncrementalStrokeArgs(current, previous);
      expect(result).not.toBeNull();
      expect(result!.points).toEqual([
        { x: 14, y: 15 },
        { x: 20, y: 21 },
      ]);
    });

    it('preserves all non-point settings from the current args', () => {
      const previous = blockArgs();
      const current = blockArgs({
        alpha: 0.5,
        color: '#ff0000',
        lineWidth: 10,
        points: [...previous.points!, { x: 20, y: 30 }, { x: 40, y: 50 }],
      });

      const result = getIncrementalStrokeArgs(current, previous);
      expect(result).not.toBeNull();
      expect(result!.alpha).toBe(0.5);
      expect(result!.color).toBe('#ff0000');
      expect(result!.lineWidth).toBe(10);
      expect(result!.penType).toBe('pen');
      expect(result!.blockStamp).toBe(true);
      expect(result!.points).toEqual([
        { x: 20, y: 30 },
        { x: 40, y: 50 },
      ]);
    });

    it('returns a new object that does not share the points array reference with current', () => {
      const previous = blockArgs();
      const currentPoints = [...previous.points!, { x: 14, y: 15 }];
      const current = blockArgs({ points: currentPoints });

      const result = getIncrementalStrokeArgs(current, previous);
      expect(result).not.toBeNull();
      expect(result!.points).not.toBe(currentPoints);
      expect(result).not.toBe(current);
    });

    it('falls back when switching from a non-block to a block stroke', () => {
      expect(getIncrementalStrokeArgs(blockArgs(), baseArgs())).toBeNull();
    });

    it('falls back when switching from a block to a non-block stroke', () => {
      expect(getIncrementalStrokeArgs(baseArgs(), blockArgs())).toBeNull();
    });

    it('falls back when the previous path is not a prefix of the current path', () => {
      const previous = blockArgs();
      const current = blockArgs({
        points: [
          { x: 2, y: 3 },
          { x: 99, y: 100 },
          { x: 14, y: 15 },
        ],
      });
      expect(getIncrementalStrokeArgs(current, previous)).toBeNull();
    });

    it('falls back when there are no new points beyond the previous preview', () => {
      const previous = blockArgs();
      expect(getIncrementalStrokeArgs(blockArgs({ points: previous.points }), previous)).toBeNull();
    });

    it('falls back when penType changes between block-stamp previews', () => {
      const previous = blockArgs();
      expect(getIncrementalStrokeArgs(blockArgs({ penType: 'pen-dashed' }), previous)).toBeNull();
    });
  });
});

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
