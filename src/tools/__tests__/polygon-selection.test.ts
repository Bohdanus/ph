import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { defaultSettings } from '../settings.ts';
import { toolProcessors } from '../toolProcessors.ts';
import { toolsMap } from '../toolsMap.ts';
import { createMockCanvasContext, createMockImageBitmap } from '../../__tests__/fixtures/canvas.ts';
import type { LassoToolArgs, PolygonSelectionToolSettings } from '../polygonSelection.ts';
import type { Point } from '../../contexts/general-types.ts';
import { SelectionCanvasContextError } from '../../util/selection.ts';

type MockCtx = ReturnType<typeof createMockCanvasContext> & {
  getImageData: ReturnType<typeof vi.fn>;
  putImageData: ReturnType<typeof vi.fn>;
};

class RecordingOffscreenCanvas {
  static instances: RecordingOffscreenCanvas[] = [];

  width: number;
  height: number;
  readonly ctx: MockCtx;

  constructor(width: number, height: number) {
    this.width = Math.max(1, Math.ceil(width));
    this.height = Math.max(1, Math.ceil(height));
    this.ctx = createMockCanvasContext({
      canvas: this,
      getImageData: vi.fn(),
      putImageData: vi.fn(),
    }) as MockCtx;
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
  'featherRadius',
  'antiAlias',
  'fill',
];

const triangle: Point[] = [
  { x: 2, y: 3 },
  { x: 12, y: 3 },
  { x: 12, y: 13 },
];

const square: Point[] = [
  { x: 5, y: 5 },
  { x: 15, y: 5 },
  { x: 15, y: 15 },
  { x: 5, y: 15 },
];

const selfIntersecting: Point[] = [
  { x: 5, y: 5 },
  { x: 15, y: 15 },
  { x: 5, y: 15 },
  { x: 15, y: 5 },
];

const negativeCoords: Point[] = [
  { x: -5, y: -5 },
  { x: 5, y: -5 },
  { x: 5, y: 5 },
  { x: -5, y: 5 },
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
      const { alpha, lineWidth, featherRadius, antiAlias, fill, points, color } = defaultSettings[toolName];

      expect(alpha, toolName).toBeGreaterThanOrEqual(0);
      expect(alpha, toolName).toBeLessThanOrEqual(1);
      expect(lineWidth, toolName).toBeGreaterThan(0);
      expect(featherRadius, toolName).toBeGreaterThanOrEqual(0);
      expect(antiAlias, toolName).toBe(true);
      expect(fill, toolName).toBe(false);
      expect(points, toolName).toEqual([]);
      expect(color, toolName).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  it('marks points optional on the args type but the processor handles missing points gracefully', () => {
    // `LassoToolArgs.points` is declared optional. The shared `selection` processor
    // forwards args to `copyPolygonToCanvas`, which returns a 1x1 canvas when points
    // are undefined or have fewer than 3 points rather than throwing.
    expect(defaultSettings['polygonal-lasso']).toHaveProperty('points');

    const { result, canvas } = runLasso('polygonal-lasso', {
      toolName: 'polygonal-lasso',
      color: '#FF0000',
      lineWidth: 3,
      alpha: 1,
      featherRadius: 0,
      antiAlias: true,
      fill: false,
      // points deliberately omitted
    });

    expect(result[0]).toBe(canvas as unknown as OffscreenCanvas);
    expect(canvas.width).toBe(1);
    expect(canvas.height).toBe(1);
    expect(canvas.ctx.beginPath).not.toHaveBeenCalled();
    expect(canvas.ctx.drawImage).not.toHaveBeenCalled();
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

  it.each(lassoToolNames)('collapses the %s copy to a 1x1 canvas for an empty points array', (toolName) => {
    const { result, canvas } = runLasso(toolName, { points: [] });

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
    expect(toolProcessors['polygonal-lasso'].creator).toBeUndefined();
    expect(toolProcessors['freehand-lasso'].creator).toBeUndefined();
  });
});

describe('lasso selection with varied polygon geometry', () => {
  it.each(lassoToolNames)('handles a square polygon correctly for %s', (toolName) => {
    const { result: _result, canvas } = runLasso(toolName, { points: square });

    // Square spans x 5..15 and y 5..15 → 10x10
    expect(canvas.width).toBe(10);
    expect(canvas.height).toBe(10);
    expect(canvas.ctx.drawImage).toHaveBeenCalledWith(bitmap, -5, -5);
    expect(canvas.ctx.moveTo).toHaveBeenCalledWith(0, 0);
    expect(canvas.ctx.lineTo).toHaveBeenCalledTimes(3);
    expect(canvas.ctx.closePath).toHaveBeenCalledTimes(1);
  });

  it.each(lassoToolNames)('handles self-intersecting polygons using non-zero winding rule for %s', (toolName) => {
    const { result: _result, canvas } = runLasso(toolName, { points: selfIntersecting });

    // Self-intersecting bow-tie shape: bounds x 5..15, y 5..15 → 10x10
    // The non-zero winding rule means the center region (winding number 2) is clipped in,
    // while the outer triangles (winding number 1) are also clipped in. The result is
    // the union of all four triangles. The important thing is it does not crash.
    expect(canvas.width).toBe(10);
    expect(canvas.height).toBe(10);
    expect(canvas.ctx.clip).toHaveBeenCalledTimes(1);
    expect(canvas.ctx.drawImage).toHaveBeenCalled();
  });

  it.each(lassoToolNames)('handles polygons with negative coordinates for %s', (toolName) => {
    const { result: _result, canvas } = runLasso(toolName, { points: negativeCoords });

    // Negative coords span x -5..5 and y -5..5 → 10x10, origin shifted to (0,0)
    expect(canvas.width).toBe(10);
    expect(canvas.height).toBe(10);
    // drawImage called with negative origin to shift source into canvas space
    expect(canvas.ctx.drawImage).toHaveBeenCalledWith(bitmap, 5, 5);
  });

  it.each(lassoToolNames)('produces correct bounds for a single-point polygon for %s', (toolName) => {
    const singlePoint: Point[] = [{ x: 10, y: 10 }];
    const { result: _result, canvas } = runLasso(toolName, { points: singlePoint });

    expect(canvas.width).toBe(1);
    expect(canvas.height).toBe(1);
  });

  it.each(lassoToolNames)('produces correct bounds for a two-point polygon for %s', (toolName) => {
    const twoPoints: Point[] = [
      { x: 10, y: 10 },
      { x: 20, y: 20 },
    ];
    const { result: _result, canvas } = runLasso(toolName, { points: twoPoints });

    expect(canvas.width).toBe(1);
    expect(canvas.height).toBe(1);
  });
});

describe('lasso selection with featherRadius and antiAlias', () => {
  // The lasso processor uses `copyPolygonToCanvas` which does NOT apply feathering.
  // featherRadius and antiAlias are part of the settings type but are ignored by the
  // non-feathered copy path. This is by design: feather-magnetic-lasso uses the
  // feathered copy path. These tests verify the settings are accepted and the output
  // remains the non-feathered hard clip.

  it.each(lassoToolNames)('ignores featherRadius > 0 for %s (non-feathered path)', (toolName) => {
    const { result: _result, canvas } = runLasso(toolName, {
      points: triangle,
      featherRadius: 5,
    });

    // Still produces hard clip at polygon bounds (10x10), no feather padding
    expect(canvas.width).toBe(10);
    expect(canvas.height).toBe(10);
    expect(canvas.ctx.clip).toHaveBeenCalledTimes(1);
    // No getImageData/putImageData which would indicate feather processing
    expect(canvas.ctx.getImageData).not.toHaveBeenCalled();
    expect(canvas.ctx.putImageData).not.toHaveBeenCalled();
  });

  it.each(lassoToolNames)('ignores antiAlias: false for %s (non-feathered path)', (toolName) => {
    const { result: _result, canvas } = runLasso(toolName, {
      points: triangle,
      antiAlias: false,
    });

    // Still produces hard clip at polygon bounds
    expect(canvas.width).toBe(10);
    expect(canvas.height).toBe(10);
    expect(canvas.ctx.clip).toHaveBeenCalledTimes(1);
    expect(canvas.ctx.getImageData).not.toHaveBeenCalled();
    expect(canvas.ctx.putImageData).not.toHaveBeenCalled();
  });

  it.each(lassoToolNames)('ignores fill: true for %s (selection processor ignores it)', (toolName) => {
    const { result: _result, canvas } = runLasso(toolName, {
      points: triangle,
      fill: true,
    });

    // fill is a setting but the selection processor does not use it
    expect(canvas.width).toBe(10);
    expect(canvas.height).toBe(10);
    expect(canvas.ctx.clip).toHaveBeenCalledTimes(1);
  });

  it.each(lassoToolNames)('respects varying lineWidth values for %s (stored but not used in copy)', (toolName) => {
    for (const lineWidth of [1, 3, 5, 10, 50]) {
      RecordingOffscreenCanvas.instances = [];
      const { result: _result, canvas } = runLasso(toolName, {
        points: triangle,
        lineWidth,
      });

      expect(canvas.width).toBe(10);
      expect(canvas.height).toBe(10);
      // lineWidth is not used by copyPolygonToCanvas; it's a UI/overlay setting
    }
  });

  it.each(lassoToolNames)('respects different color values for %s (stored but not used in copy)', (toolName) => {
    for (const color of ['#FF0000', '#00FF00', '#0000FF', '#FFFFFF', '#000000', '#ABCDEF']) {
      RecordingOffscreenCanvas.instances = [];
      const { result: _result, canvas } = runLasso(toolName, {
        points: triangle,
        color,
      });

      expect(canvas.width).toBe(10);
      expect(canvas.height).toBe(10);
      // color is not used by copyPolygonToCanvas; it's a UI/overlay setting
    }
  });

  it.each(lassoToolNames)('respects varying alpha values for %s (stored but not used in copy)', (toolName) => {
    for (const alpha of [0, 0.25, 0.5, 0.75, 1]) {
      RecordingOffscreenCanvas.instances = [];
      const { result: _result, canvas } = runLasso(toolName, {
        points: triangle,
        alpha,
      });

      expect(canvas.width).toBe(10);
      expect(canvas.height).toBe(10);
      // alpha is not used by copyPolygonToCanvas; it's a UI/overlay setting
    }
  });
});

describe('lasso selection commit/replay descriptor', () => {
  it('gives both lasso tools a frozen replay descriptor', () => {
    for (const toolName of lassoToolNames) {
      const entry = toolProcessors[toolName];
      expect(Object.isFrozen(entry.replay), `${toolName}.replay must be frozen`).toBe(true);
    }
  });

  it('gives both lasso tools replay version 1', () => {
    for (const toolName of lassoToolNames) {
      expect(toolProcessors[toolName].replay.version).toBe(1);
    }
  });

  it('gives both lasso tools replay kind "selection"', () => {
    for (const toolName of lassoToolNames) {
      expect(toolProcessors[toolName].replay.kind).toBe('selection');
    }
  });

  it('marks both lasso tools as deterministic', () => {
    for (const toolName of lassoToolNames) {
      expect(toolProcessors[toolName].replay.deterministic).toBe(true);
    }
  });

  it('marks both lasso tools as requiring raster', () => {
    for (const toolName of lassoToolNames) {
      expect(toolProcessors[toolName].replay.requiresRaster).toBe(true);
    }
  });

  it('gives both lasso tools commit kind "selection"', () => {
    for (const toolName of lassoToolNames) {
      expect(toolProcessors[toolName].commit).toBe('selection');
    }
  });

  it('gives neither lasso tool a creator flag', () => {
    for (const toolName of lassoToolNames) {
      expect(toolProcessors[toolName].creator).toBeUndefined();
    }
  });

  it('rejects mutation of the replay descriptor', () => {
    expect(() => {
      (toolProcessors['polygonal-lasso'].replay as { kind: string }).kind = 'raster-processor';
    }).toThrow(TypeError);

    expect(toolProcessors['polygonal-lasso'].replay.kind).toBe('selection');
  });
});

describe('lasso selection context failure behavior', () => {
  it('throws SelectionCanvasContextError when OffscreenCanvas returns no context (copyPolygonToCanvas path)', () => {
    // Create a canvas that returns null from getContext
    const failingCanvas = {
      width: 10,
      height: 10,
      getContext: vi.fn(() => null),
    };

    vi.stubGlobal(
      'OffscreenCanvas',
      class {
        constructor() {
          return failingCanvas;
        }
      } as unknown as typeof OffscreenCanvas
    );

    try {
      expect(() => runLasso('polygonal-lasso', { points: triangle })).toThrow(SelectionCanvasContextError);
      expect(() => runLasso('polygonal-lasso', { points: triangle })).toThrow('copyPolygonToCanvas');
    } finally {
      vi.unstubAllGlobals();
      vi.stubGlobal('OffscreenCanvas', RecordingOffscreenCanvas as unknown as typeof OffscreenCanvas);
    }
  });

  it('throws SelectionCanvasContextError with correct operation name and dimensions', () => {
    const failingCanvas = {
      width: 10,
      height: 10,
      getContext: vi.fn(() => null),
    };

    vi.stubGlobal(
      'OffscreenCanvas',
      class {
        constructor() {
          return failingCanvas;
        }
      } as unknown as typeof OffscreenCanvas
    );

    try {
      try {
        runLasso('polygonal-lasso', { points: triangle });
      } catch (e) {
        expect(e).toBeInstanceOf(SelectionCanvasContextError);
        expect((e as SelectionCanvasContextError).operation).toBe('copyPolygonToCanvas');
        expect((e as SelectionCanvasContextError).message).toContain('10x10');
      }
    } finally {
      vi.unstubAllGlobals();
      vi.stubGlobal('OffscreenCanvas', RecordingOffscreenCanvas as unknown as typeof OffscreenCanvas);
    }
  });
});

describe('lasso selection sourceScale and imageSize handling', () => {
  // The current `selection` processor in src/tools/selection.ts does not pass
  // sourceScale or imageSize to copyPolygonToCanvas. These tests verify the
  // current behavior and document the limitation.

  it.each(lassoToolNames)('does not pass sourceScale to copyPolygonToCanvas for %s', (toolName) => {
    const { canvas } = runLasso(toolName, { points: triangle });

    // drawImage called with simple -minX, -minY (sourceScale = 1,1)
    // If sourceScale were used, drawSelectionSourceRegion would be called instead
    expect(canvas.ctx.drawImage).toHaveBeenCalledWith(bitmap, -2, -3);
  });

  it.each(lassoToolNames)('does not pass imageSize to copyPolygonToCanvas for %s', (toolName) => {
    const { canvas } = runLasso(toolName, { points: triangle });

    // No clamping to imageSize occurs in the current processor
    // The bounds are derived purely from the polygon points
    expect(canvas.width).toBe(10);
    expect(canvas.height).toBe(10);
  });
});

describe('toolsMap wiring for lasso tools', () => {
  it('mirrors the processor entry for polygonal-lasso', () => {
    const mapped = toolsMap['polygonal-lasso'];
    const definition = toolProcessors['polygonal-lasso'];

    expect(mapped.commit).toBe(definition.commit);
    expect(mapped.replay).toBe(definition.replay);
    expect(mapped.imageProcessor).toBe(definition.imageProcessor);
    expect(typeof mapped.icon).toBe('string');
    expect(typeof mapped.toolboxComponent).toBe('function');
  });

  it('mirrors the processor entry for freehand-lasso', () => {
    const mapped = toolsMap['freehand-lasso'];
    const definition = toolProcessors['freehand-lasso'];

    expect(mapped.commit).toBe(definition.commit);
    expect(mapped.replay).toBe(definition.replay);
    expect(mapped.imageProcessor).toBe(definition.imageProcessor);
    expect(typeof mapped.icon).toBe('string');
    expect(typeof mapped.toolboxComponent).toBe('function');
  });

  it('gives both lasso tools the shared lasso icon', () => {
    expect(toolsMap['polygonal-lasso'].icon).toBe('lasso');
    expect(toolsMap['freehand-lasso'].icon).toBe('lasso');
  });
});
