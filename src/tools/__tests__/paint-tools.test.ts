import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { defaultSettings, savedArgsPerFigure } from '../settings.ts';
import { toolProcessors } from '../toolProcessors.ts';
import { toolsMap } from '../toolsMap.ts';
import { drawShape } from '../shape.ts';
import { createLayerSource } from '../../contexts/layer-utils.ts';
import { toolbarMap } from '../../../toolbar-mapping.ts';
import type { ToolbarTool } from '../../../toolbar-mapping.ts';
import type { PaintToolArgs, PaintToolName } from '../draw.ts';
import type { FigureType } from '../shape.ts';
import type { Ctx2D, Point } from '../../contexts/general-types.ts';
import { createMockCanvasContext, createMockImageBitmap } from '../../__tests__/fixtures/canvas.ts';

const paintToolNames: readonly PaintToolName[] = ['brush', 'pencil', 'color-replacement'];

/** Every member of the narrowed `FigureType` union, in toolbar order. */
const figureTypes: readonly FigureType[] = ['rectangle', 'oval', 'line', 'triangle', 'polygon'];

const mappingFigures: readonly FigureType[] = (toolbarMap.flat() as readonly (readonly ToolbarTool[])[])
  .flat()
  .flatMap((tool) => (tool.figure ? [tool.figure] : []));

const paintToolArgs = (toolName: PaintToolName): PaintToolArgs => ({ ...defaultSettings[toolName], toolName });

const paintToolArgsWithPoints = (toolName: PaintToolName, points: Point[]): PaintToolArgs => ({
  ...defaultSettings[toolName],
  toolName,
  points,
});

const documentSize = { width: 20, height: 20 };

const stroke: Point[] = [
  { x: 3, y: 4 },
  { x: 11, y: 6 },
  { x: 15, y: 17 },
];

type MockCtx = ReturnType<typeof createMockCanvasContext>;

/**
 * The global `OffscreenCanvas` stub in `src/test/setup.ts` keeps its own context, but it
 * exposes no handle on the instances it creates, so `expect(canvas).toBeTruthy()` is the
 * only assertion available against a paint tool's output. This recorder keeps the
 * per-canvas context (so `stroke`/`createRadialGradient` calls are observable) and the
 * instance list (so a test can prove *which* canvas a processor returned).
 */
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

beforeEach(() => {
  RecordingOffscreenCanvas.instances = [];
  vi.stubGlobal('OffscreenCanvas', RecordingOffscreenCanvas as unknown as typeof OffscreenCanvas);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Runs a registry processor and returns the single canvas it must have produced. */
const runProcessor = (toolName: keyof typeof toolProcessors, args: unknown) => {
  const result = toolProcessors[toolName].imageProcessor({ size: documentSize })(args as never);

  expect(result).toHaveLength(1);
  return result[0] as unknown as RecordingOffscreenCanvas;
};

describe('paint tools', () => {
  it('exposes real draw-like behavior for brush, pencil, and color replacement tools', () => {
    for (const toolName of paintToolNames) {
      const args = paintToolArgs(toolName);

      expect(args).toMatchObject({
        toolName,
        color: expect.any(String),
        alpha: expect.any(Number),
        lineWidth: expect.any(Number),
      });

      const canvas = runProcessor(toolName, args);

      // Structural, not truthy: the processor must return the document-sized canvas it
      // just allocated, not some other truthy value.
      expect(canvas).toBe(RecordingOffscreenCanvas.instances.at(-1));
      expect(canvas.width).toBe(documentSize.width);
      expect(canvas.height).toBe(documentSize.height);
    }
  });

  it('uses the geometry tool pipeline for rectangle, ellipse, line, triangle, and polygon variants', () => {
    const variantToolNames = ['rectangle', 'ellipse', 'line', 'triangle', 'polygon'] as const;

    for (const toolName of variantToolNames) {
      const args = defaultSettings[toolName];

      expect(args).toMatchObject({
        toolName,
        color: expect.any(String),
        figure: expect.any(String),
      });

      const canvas = runProcessor(toolName, args);

      expect(canvas).toBe(RecordingOffscreenCanvas.instances.at(-1));
      expect(canvas.width).toBe(documentSize.width);
      expect(canvas.height).toBe(documentSize.height);
    }
  });

  it('preserves computed draw-like bounds instead of snapping the finished layer to 0,0', () => {
    const pos = { x: 42, y: 18, width: 66, height: 32 };
    for (const toolName of paintToolNames) {
      const layer = createLayerSource({
        layers: {},
        source: {
          kind: 'tool',
          args: paintToolArgsWithPoints(toolName, [
            { x: 60, y: 20 },
            { x: 90, y: 40 },
            { x: 100, y: 45 },
          ]),
          pos,
        },
      });

      expect(layer.pos).toEqual(pos);
    }
  });

  it('preserves non-origin bounds for every shape figure', () => {
    const pos = { x: 42, y: 18, width: 66, height: 32 };
    const figures = ['rectangle', 'oval', 'line', 'triangle', 'polygon'] as const;

    for (const figure of figures) {
      const layer = createLayerSource({
        layers: {},
        source: {
          kind: 'tool',
          args: {
            ...defaultSettings.shape,
            figure,
            start: { x: 10, y: 8 },
            end: { x: 50, y: 24 },
          },
          pos,
        },
      });

      expect(layer.pos).toEqual(pos);
    }
  });

  it('keeps the figure list used for shape coverage aligned with the narrowed union', () => {
    expect([...figureTypes].sort()).toEqual([...Object.keys(savedArgsPerFigure)].sort());
    expect([...mappingFigures].sort()).toEqual([...figureTypes].sort());
  });

  it('preserves non-origin bounds for every member of the narrowed figure union', () => {
    const pos = { x: 7, y: 11, width: 24, height: 13 };

    for (const figure of figureTypes) {
      const args = {
        ...defaultSettings.shape,
        figure,
        start: { x: 12, y: 9 },
        end: { x: 28, y: 20 },
      };
      const layer = createLayerSource({
        layers: {},
        source: { kind: 'tool', args, pos },
      });

      expect(layer.pos).toEqual(pos);
      expect(layer.pos.x).toBeGreaterThan(0);
      expect(layer.pos.y).toBeGreaterThan(0);
      expect(layer.pos.width).toBeGreaterThan(0);
      expect(layer.pos.height).toBeGreaterThan(0);
    }
  });

  it('renders every member of the narrowed figure union through the shape pipeline', () => {
    for (const figure of figureTypes) {
      const canvas = runProcessor('shape', {
        ...defaultSettings.shape,
        figure,
        start: { x: 2, y: 3 },
        end: { x: 16, y: 12 },
      });

      expect(canvas).toBe(RecordingOffscreenCanvas.instances.at(-1));
      expect(canvas.width).toBe(20);
      expect(canvas.height).toBe(20);
    }
  });
});

describe('paint tool rasterization', () => {
  it.each(paintToolNames)('strokes %s with the pen renderer, whatever penType the args carry', (toolName) => {
    const canvas = runProcessor(toolName, { ...paintToolArgs(toolName), penType: 'spray', points: stroke });

    // brush/pencil force `pen`; color-replacement forces `spray`. Only the latter paints
    // a radial gradient per point instead of stroking a smoothed path.
    if (toolName === 'color-replacement') {
      expect(canvas.ctx.stroke).not.toHaveBeenCalled();
      expect(canvas.ctx.createRadialGradient).toHaveBeenCalledTimes(stroke.length);
      return;
    }

    expect(canvas.ctx.lineCap).toBe('round');
    expect(canvas.ctx.beginPath).toHaveBeenCalledTimes(1);
    expect(canvas.ctx.moveTo).toHaveBeenCalledWith(stroke[0].x, stroke[0].y);
    expect(canvas.ctx.stroke).toHaveBeenCalledTimes(1);
  });

  it('applies the default alpha and line width of each paint tool to its context', () => {
    for (const toolName of paintToolNames) {
      const canvas = runProcessor(toolName, paintToolArgsWithPoints(toolName, stroke));
      const defaults = defaultSettings[toolName];

      if (toolName === 'color-replacement') {
        // `setupDrawCtx` bails out early for the forced spray pen, so the pen-only
        // assignments never happen. Assert the absence of the seeded values rather than
        // the mock's starting numbers, which would pass for any input.
        expect(canvas.ctx.lineWidth, toolName).not.toBe(defaults.lineWidth);
        expect(canvas.ctx.globalAlpha, toolName).not.toBe(defaults.alpha);
        expect(canvas.ctx.strokeStyle, toolName).not.toBe(defaults.color);
        // The spray path still spends lineWidth as the radial-gradient radius.
        const gradientCall = (canvas.ctx.createRadialGradient.mock.calls as unknown as number[][])[0];
        expect(gradientCall[5], toolName).toBe(defaults.lineWidth);
        continue;
      }

      expect(canvas.ctx.lineWidth, toolName).toBe(defaults.lineWidth);
      expect(canvas.ctx.globalAlpha, toolName).toBe(defaults.alpha);
      expect(canvas.ctx.strokeStyle, toolName).toBe(defaults.color);
    }
  });

  it.each(paintToolNames)('allocates exactly one canvas for %s and never reads a source bitmap', (toolName) => {
    const bitmap = createMockImageBitmap(20, 20);
    const result = toolProcessors[toolName].imageProcessor({ size: documentSize, bitmap } as never)(
      paintToolArgsWithPoints(toolName, stroke) as never
    );

    expect(result).toHaveLength(1);
    expect(RecordingOffscreenCanvas.instances).toHaveLength(1);
    expect(result[0]).not.toBe(bitmap);
    expect(RecordingOffscreenCanvas.instances[0].ctx.drawImage).not.toHaveBeenCalled();
  });

  it.each(paintToolNames)('returns a full-size canvas and draws nothing for %s without points', (toolName) => {
    const canvas = runProcessor(toolName, paintToolArgsWithPoints(toolName, []));

    expect(canvas.width).toBe(documentSize.width);
    expect(canvas.height).toBe(documentSize.height);
    expect(canvas.ctx.stroke).not.toHaveBeenCalled();
    expect(canvas.ctx.beginPath).not.toHaveBeenCalled();
    expect(canvas.ctx.createRadialGradient).not.toHaveBeenCalled();
  });

  it('draws the figure each geometry variant is registered for, not a generic shape', () => {
    const geometry = { start: { x: 2, y: 3 }, end: { x: 16, y: 12 } };

    const rectangle = runProcessor('rectangle', { ...defaultSettings.rectangle, ...geometry });
    expect(rectangle.ctx.strokeRect).toHaveBeenCalledWith(2, 3, 14, 9);
    expect(rectangle.ctx.ellipse).not.toHaveBeenCalled();

    const ellipse = runProcessor('ellipse', { ...defaultSettings.ellipse, ...geometry });
    expect(ellipse.ctx.ellipse).toHaveBeenCalledWith(9, 7.5, 7, 4.5, 0, 0, Math.PI * 2);
    expect(ellipse.ctx.strokeRect).not.toHaveBeenCalled();

    const line = runProcessor('line', { ...defaultSettings.line, ...geometry });
    expect(line.ctx.moveTo).toHaveBeenCalledWith(2, 3);
    expect(line.ctx.lineTo).toHaveBeenCalledWith(16, 12);
    expect(line.ctx.stroke).toHaveBeenCalledTimes(1);
    expect(line.ctx.strokeRect).not.toHaveBeenCalled();

    const triangle = runProcessor('triangle', { ...defaultSettings.triangle, ...geometry });
    expect(triangle.ctx.moveTo).toHaveBeenCalledTimes(1);
    expect(triangle.ctx.lineTo).toHaveBeenCalledTimes(2);

    const polygon = runProcessor('polygon', { ...defaultSettings.polygon, ...geometry });
    expect(polygon.ctx.moveTo).toHaveBeenCalledTimes(1);
    expect(polygon.ctx.lineTo).toHaveBeenCalledTimes(4);
  });

  it('gives every geometry variant the same stroke presentation settings', () => {
    const geometry = { start: { x: 2, y: 3 }, end: { x: 16, y: 12 } };
    const variantToolNames = ['rectangle', 'ellipse', 'line', 'triangle', 'polygon'] as const;

    for (const toolName of variantToolNames) {
      const canvas = runProcessor(toolName, { ...defaultSettings[toolName], ...geometry });
      const preset = savedArgsPerFigure[defaultSettings[toolName].figure];

      expect(canvas.ctx.strokeStyle, toolName).toBe(defaultSettings[toolName].color);
      expect(canvas.ctx.lineWidth, toolName).toBe(preset.lineWidth);
      expect(canvas.ctx.lineCap, toolName).toBe(preset.lineCap ?? 'butt');
      expect(canvas.ctx.globalAlpha, toolName).toBe(preset.alpha);
      expect(canvas.ctx.setLineDash, toolName).toHaveBeenCalledWith([]);
    }
  });

  it('routes every geometry variant through the shared shape processor', () => {
    for (const toolName of ['rectangle', 'ellipse', 'triangle', 'polygon', 'line'] as const) {
      expect(toolsMap[toolName].imageProcessor, toolName).toBe(toolsMap.shape.imageProcessor);
    }
  });
});

describe('shape figure dispatch fall-through', () => {
  const geometry = { start: { x: 2, y: 3 }, end: { x: 16, y: 12 } };

  it('normalizes an unknown figure onto a rectangle before it reaches drawShape', () => {
    // `shape()` runs every figure through `normalizeFigure`, so the if-chain in
    // `drawShape` can never see a value outside the union from production code.
    const canvas = runProcessor('shape', {
      ...defaultSettings.shape,
      figure: 'hexagon',
      ...geometry,
    } as unknown as { figure: FigureType });

    expect(canvas.ctx.strokeRect).toHaveBeenCalledWith(2, 3, 14, 9);
  });

  it('draws nothing rather than throwing for a figure outside the union', () => {
    const ctx = createMockCanvasContext();

    drawShape(ctx as unknown as Ctx2D, {
      ...defaultSettings.shape,
      figure: 'hexagon' as FigureType,
      ...geometry,
    });

    for (const call of [
      ctx.beginPath,
      ctx.moveTo,
      ctx.lineTo,
      ctx.ellipse,
      ctx.arc,
      ctx.fill,
      ctx.stroke,
      ctx.fillRect,
      ctx.strokeRect,
    ]) {
      expect(call).not.toHaveBeenCalled();
    }
  });
});
