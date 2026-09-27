import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { defaultSettings } from '../settings.ts';
import { toolProcessors } from '../toolProcessors.ts';
import { toolsMap } from '../toolsMap.ts';
import { createMockCanvasContext, createMockImageBitmap } from '../../__tests__/fixtures/canvas.ts';
import type { LassoToolArgs, PolygonSelectionToolSettings } from '../polygonSelection.ts';
import type { Point } from '../../contexts/general-types.ts';
import type { ToolArgs } from '../../contexts/tool-types.ts';

type MockCtx = ReturnType<typeof createMockCanvasContext>;

class RecordingOffscreenCanvas {
  static instances: RecordingOffscreenCanvas[] = [];

  width: number;
  height: number;
  readonly ctx: MockCtx;

  constructor(width: number, height: number) {
    this.width = Math.max(1, Math.ceil(width));
    this.height = Math.max(1, Math.ceil(height));
    this.ctx = createMockCanvasContext({ canvas: this });
    RecordingOffscreenCanvas.instances.push(this);
  }

  getContext(): MockCtx {
    return this.ctx;
  }
}

const lassoToolNames = ['polygonal-lasso', 'freehand-lasso'] as const;

const lassoSettingsKeys: readonly (keyof PolygonSelectionToolSettings)[] = [
  'toolName',
  'color',
  'lineWidth',
  'alpha',
  'fill',
];

const triangle: Point[] = [
  { x: 2, y: 3 },
  { x: 12, y: 3 },
  { x: 12, y: 13 },
];

const bitmap = createMockImageBitmap(40, 24);

const runLasso = (toolName: (typeof lassoToolNames)[number], args: Partial<LassoToolArgs> = {}) => {
  const result = toolProcessors[toolName].imageProcessor({ size: { width: 40, height: 24 }, bitmap })({
    ...defaultSettings[toolName],
    ...args,
  } as never);

  return { result, canvas: RecordingOffscreenCanvas.instances.at(-1)! };
};

beforeEach(() => {
  RecordingOffscreenCanvas.instances = [];
  vi.stubGlobal('OffscreenCanvas', RecordingOffscreenCanvas as unknown as typeof OffscreenCanvas);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * `src/tools/polygonSelection.ts` publishes the lasso arg contract for both the
 * polygonal and the freehand lasso and nothing else, so these tests pin the type
 * contract where it is actually observable: the seeded defaults, the derived settings
 * shape, and the geometry the shared `selection` processor produces from the args.
 */
describe('polygonSelection type contract', () => {
  it.each(lassoToolNames)('declares %s settings as exactly the non-points lasso fields', (toolName) => {
    const keys = Object.keys(defaultSettings[toolName]);

    // `PolygonSelectionToolSettings` is `Omit<LassoToolArgs, 'points'>`; the seeded
    // default is the full arg object, so the settings projection is what drops `points`.
    expect(keys.sort()).toEqual([...lassoSettingsKeys, 'points'].sort());
    expect(keys.filter((key) => key !== 'points').sort()).toEqual([...lassoSettingsKeys].sort());
  });

  it('gives both lasso tools identical settings apart from their own tool name', () => {
    const withoutToolName = (toolName: (typeof lassoToolNames)[number]) => {
      const settings: Record<string, unknown> = { ...defaultSettings[toolName] };
      Reflect.deleteProperty(settings, 'toolName');
      return settings;
    };

    expect(withoutToolName('freehand-lasso')).toEqual(withoutToolName('polygonal-lasso'));
  });

  it.each(lassoToolNames)('stamps %s with its own member of the LassoToolArgs tool-name union', (toolName) => {
    const args = defaultSettings[toolName] as LassoToolArgs;

    expect(args.toolName).toBe(toolName);
    expect(lassoToolNames).toContain(args.toolName);
  });

  it('keeps every seeded lasso value inside the range the toolbars expose', () => {
    for (const toolName of lassoToolNames) {
      const { alpha, lineWidth, fill, points, color } = defaultSettings[toolName];

      expect(alpha, toolName).toBeGreaterThanOrEqual(0);
      expect(alpha, toolName).toBeLessThanOrEqual(1);
      expect(lineWidth, toolName).toBeGreaterThan(0);
      expect(fill, toolName).toBe(false);
      expect(points, toolName).toEqual([]);
      expect(color, toolName).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  it('marks points optional on the args type but still requires them at runtime (src/tools/polygonSelection.ts:4)', () => {
    // `LassoToolArgs.points` is declared optional, yet `selection` forwards it straight
    // into `copyPolygonToCanvas`, which dereferences `points.length`. Omitting it is
    // therefore a type-legal call that throws instead of behaving like an empty lasso.
    expect(defaultSettings['polygonal-lasso']).toHaveProperty('points');

    expect(() =>
      toolProcessors['polygonal-lasso'].imageProcessor({ size: { width: 4, height: 4 }, bitmap })({
        toolName: 'polygonal-lasso',
        color: '#FF0000',
        lineWidth: 3,
        alpha: 1,
        fill: false,
      } as unknown as ToolArgs)
    ).toThrow(TypeError);
  });
});

describe('lasso selection output contract', () => {
  it.each(lassoToolNames)('sizes the %s output to the polygon bounds, not the document', (toolName) => {
    const { result, canvas } = runLasso(toolName, { points: triangle });

    // Triangle spans x 2..12 and y 3..13, so the copied selection is 10x10 even though
    // the document is 40x24. `selection` never reads `size`.
    expect(result[0]).toBe(canvas as unknown as OffscreenCanvas);
    expect(canvas.width).toBe(10);
    expect(canvas.height).toBe(10);
  });

  it.each(lassoToolNames)('shifts the %s source by the negative polygon origin before copying', (toolName) => {
    const { canvas } = runLasso(toolName, { points: triangle });

    expect(canvas.ctx.drawImage).toHaveBeenCalledWith(bitmap, -2, -3);
    expect(canvas.ctx.clip).toHaveBeenCalledTimes(1);
    expect(canvas.ctx.beginPath).toHaveBeenCalledTimes(1);
    expect(canvas.ctx.moveTo).toHaveBeenCalledWith(0, 0);
    expect(canvas.ctx.closePath).toHaveBeenCalledTimes(1);
  });

  it.each(lassoToolNames)('balances save and restore around the %s copy', (toolName) => {
    const { canvas } = runLasso(toolName, { points: triangle });

    expect(canvas.ctx.save).toHaveBeenCalledTimes(1);
    expect(canvas.ctx.restore).toHaveBeenCalledTimes(1);
  });

  it.each(lassoToolNames)('collapses the %s copy to a 1x1 canvas for fewer than three points', (toolName) => {
    const twoPoints: Point[] = [
      { x: 1, y: 1 },
      { x: 2, y: 2 },
    ];
    const { result, canvas } = runLasso(toolName, { points: twoPoints });

    expect(result[0]).toBe(canvas as unknown as OffscreenCanvas);
    expect(canvas.width).toBe(1);
    expect(canvas.height).toBe(1);
    expect(canvas.ctx.beginPath).not.toHaveBeenCalled();
    expect(canvas.ctx.drawImage).not.toHaveBeenCalled();
  });

  it.each(lassoToolNames)('never aliases the source bitmap for a %s copy', (toolName) => {
    const { result, canvas } = runLasso(toolName, { points: triangle });

    expect(result[0]).not.toBe(bitmap);
    expect(result[0]).toBe(canvas as unknown as OffscreenCanvas);
  });

  it.each(lassoToolNames)('ignores the declared tool name, so both lasso tools rasterize identically', (toolName) => {
    runLasso(toolName, { points: triangle });
    const lassoCanvas = RecordingOffscreenCanvas.instances.at(-1)!;
    const lassoCalls = lassoCanvas.ctx.drawImage.mock.calls;

    const other = toolName === 'polygonal-lasso' ? 'freehand-lasso' : 'polygonal-lasso';
    runLasso(other, { points: triangle });
    const otherCanvas = RecordingOffscreenCanvas.instances.at(-1)!;

    expect(otherCanvas.ctx.drawImage.mock.calls).toEqual(lassoCalls);
    expect(otherCanvas.width).toBe(lassoCanvas.width);
    expect(otherCanvas.height).toBe(lassoCanvas.height);
  });

  it('registers both lasso names on the same processor and the same selection commit kind', () => {
    expect(toolProcessors['freehand-lasso'].imageProcessor).toBe(toolProcessors['polygonal-lasso'].imageProcessor);
    expect(toolsMap['freehand-lasso'].imageProcessor).toBe(toolsMap['polygonal-lasso'].imageProcessor);
    expect(toolProcessors['freehand-lasso'].commit).toBe('selection');
    expect(toolProcessors['polygonal-lasso'].commit).toBe('selection');
    expect(toolProcessors['polygonal-lasso'].creator).toBe(true);
    expect(toolProcessors['freehand-lasso'].creator).toBe(true);
  });
});
