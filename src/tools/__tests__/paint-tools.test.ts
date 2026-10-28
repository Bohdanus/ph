import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { defaultSettings, savedArgsPerFigure, savedDrawPerPen } from '../settings.ts';
import { toolProcessors } from '../toolProcessors.ts';
import { toolsMap } from '../toolsMap.ts';
import { drawShape } from '../shape.ts';
import { createLayerSource } from '../../contexts/layer-utils.ts';
import { drawLine, drawPen, drawSpray } from '../../util/draw.ts';
import { hexToRgb } from '../../util/rect.ts';
import { toolbarMap } from '../../../toolbar-mapping.ts';
import type { ToolbarTool } from '../../../toolbar-mapping.ts';
import { setupDrawCtx, type DrawToolArgs, type PaintToolArgs, type PaintToolName } from '../draw.ts';
import type { FigureType } from '../shape.ts';
import type { Ctx2D, Point } from '../../contexts/general-types.ts';
import { createMockCanvasContext, createMockImageBitmap } from '../../__tests__/fixtures/canvas.ts';

/**
 * The two tools that stamp the foreground colour. `color-replacement` is NOT in this family and
 * is deliberately absent: it substitutes a colour, which is a different operation with a different
 * args type (`src/tools/colorReplacement.ts`) and a different test file.
 */
const paintToolNames: readonly PaintToolName[] = ['brush', 'pencil'];

/** Every member of the narrowed `FigureType` union, in toolbar order. */
const figureTypes: readonly FigureType[] = ['rectangle', 'oval', 'line', 'triangle', 'polygon', 'star'];

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
  it('exposes real draw-like behavior for brush and pencil', () => {
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
    const figures = ['rectangle', 'oval', 'line', 'triangle', 'polygon', 'star'] as const;

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

    // Both force `pen`, so a `spray` the args carry is overridden rather than honoured.
    expect(canvas.ctx.stroke).toHaveBeenCalledTimes(1);
    expect(canvas.ctx.lineCap).toBe('round');
    expect(canvas.ctx.beginPath).toHaveBeenCalledTimes(1);
    expect(canvas.ctx.moveTo).toHaveBeenCalledWith(stroke[0].x, stroke[0].y);
  });

  it('applies the default alpha and line width of each paint tool to its context', () => {
    for (const toolName of paintToolNames) {
      const canvas = runProcessor(toolName, paintToolArgsWithPoints(toolName, stroke));
      const defaults = defaultSettings[toolName];

      expect(canvas.ctx.lineWidth, toolName).toBe(defaults.lineWidth);
      expect(canvas.ctx.globalAlpha, toolName).toBe(defaults.alpha);
      expect(canvas.ctx.strokeStyle, toolName).toBe(defaults.color);
    }
  });

  it.each(paintToolNames)('allocates exactly one canvas for %s and composites its source bitmap', (toolName) => {
    const bitmap = createMockImageBitmap(20, 20);
    const result = toolProcessors[toolName].imageProcessor({ size: documentSize, bitmap } as never)(
      paintToolArgsWithPoints(toolName, stroke) as never
    );

    expect(result).toHaveLength(1);
    expect(RecordingOffscreenCanvas.instances).toHaveLength(1);
    expect(result[0]).not.toBe(bitmap);
    expect(RecordingOffscreenCanvas.instances[0].ctx.imageSmoothingEnabled).toBe(false);
    expect(RecordingOffscreenCanvas.instances[0].ctx.drawImage).toHaveBeenCalledWith(
      bitmap,
      0,
      0,
      documentSize.width,
      documentSize.height
    );
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

/**
 * The spray pen's dab contract, pinned on `drawSpray` itself rather than through a tool
 * registry entry.
 *
 * Two reasons it is driven directly instead of through `toolProcessors`. First, the dab's
 * shape is `drawSpray`'s business and no registry entry owns it. Second, the tool that
 * currently forces the spray pen is `color-replacement`, which stops being a spray tool;
 * a pin reached through the registry would delete itself the moment that stops being true.
 *
 * Each of the three numbers below was wrong before, in a way that compounded: the peak was
 * `alpha / 4` (0.125 at the spray preset's own Opacity 0.5), the ramp started at the centre
 * and fell to nothing across the whole radius, and that radius was the whole `lineWidth` —
 * a diameter everywhere else. So one dab was a nearly invisible full-width blur, and the
 * ground it covered was twice the size the user asked for.
 */
describe('spray pen dab', () => {
  const dabAt = (overrides: Partial<DrawToolArgs> = {}) => {
    const ctx = createMockCanvasContext();

    drawSpray({
      args: {
        toolName: 'draw',
        penType: 'spray',
        color: '#ff0000',
        alpha: 0.8,
        lineWidth: 10,
        points: [{ x: 5, y: 5 }],
        ...overrides,
      },
      ctx: ctx as unknown as Ctx2D,
    });

    // The mock builds a fresh gradient object per call, so the stops are only reachable
    // through the recorded result, not through the return value.
    const gradient = vi.mocked(ctx.createRadialGradient).mock.results[0]?.value as
      { addColorStop: ReturnType<typeof vi.fn> } | undefined;

    expect(gradient, 'the dab must have created a gradient').toBeDefined();

    return { ctx, gradient: gradient! };
  };

  const stopsOf = (gradient: { addColorStop: ReturnType<typeof vi.fn> }) =>
    gradient.addColorStop.mock.calls as [number, string][];

  const rgb = hexToRgb('#ff0000');

  it('peaks at 0.4 of the Opacity setting, not a quarter of it', () => {
    const { gradient } = dabAt({ alpha: 0.8 });

    // 0.8 x 0.4 = 0.32, rounded to four places because the raw product carries
    // binary-float noise (0.32000000000000006) into the colour string.
    expect(stopsOf(gradient)[0]).toEqual([0, `rgba(${rgb}, 0.32)`]);

    // The campaign's concrete failure: the preset's own Opacity 0.5 under the old `/4`
    // peaked at 0.125, which measured rgb(223,223,223) for a single tap on white.
    const preset = dabAt({ ...savedDrawPerPen.spray });
    expect(stopsOf(preset.gradient)[0]).toEqual([0, `rgba(${rgb}, 0.2)`]);
  });

  it('holds the peak over the inner quarter of the radius instead of ramping from the centre', () => {
    const { gradient } = dabAt({ alpha: 0.8 });

    // Exactly three stops, in this order. A dab with a body has a plateau and a rim; the
    // pre-fix two-stop ramp (0 then 1) spent the entire dab as falloff, which is a blur
    // and is what made repeated passes accumulate haze instead of building a stroke.
    expect(stopsOf(gradient)).toEqual([
      [0, `rgba(${rgb}, 0.32)`],
      [0.25, `rgba(${rgb}, 0.32)`],
      [1, `rgba(${rgb}, 0)`],
    ]);
  });

  it('spends half the lineWidth as the gradient radius, because Size is a diameter', () => {
    const { ctx } = dabAt({ lineWidth: 10 });

    // The pre-fix radius was the whole `lineWidth`, painting a 200px blot at Size 100 and
    // overflowing the `lineWidth` padding `pointsBoundingPos` reserves for the layer crop.
    expect(ctx.createRadialGradient).toHaveBeenCalledWith(5, 5, 0, 5, 5, 5);
    // The arc has to use the same radius, or the gradient is clipped by a larger disc and
    // the outermost three quarters of every dab is cut off rather than falling off.
    expect(ctx.arc).toHaveBeenCalledWith(5, 5, 5, 0, Math.PI * 2);
  });

  it('still draws one dab per sample, and nothing at all without samples', () => {
    const two = dabAt({
      points: [
        { x: 1, y: 1 },
        { x: 2, y: 2 },
      ],
    });
    expect(two.ctx.createRadialGradient).toHaveBeenCalledTimes(2);
    expect(two.ctx.fill).toHaveBeenCalledTimes(2);

    // Driven through a bare context rather than `dabAt`, which asserts a gradient exists
    // and so cannot express the case where none should.
    const empty = createMockCanvasContext();
    drawSpray({
      args: { toolName: 'draw', penType: 'spray', color: '#ff0000', alpha: 0.8, lineWidth: 10, points: [] },
      ctx: empty as unknown as Ctx2D,
    });

    expect(empty.createRadialGradient).not.toHaveBeenCalled();
    expect(empty.fill).not.toHaveBeenCalled();
    expect(empty.beginPath).not.toHaveBeenCalled();
  });
});

/**
 * A paint stroke's Photoshop `Smoothing` control is a filter over the sampled path,
 * applied once at the `drawLine` seam (src/util/draw.ts:95-97) so the live overlay,
 * the committed stroke and every replay of it all smooth identically.
 *
 * What makes it easy to regress: `drawPen` issues exactly ONE `beginPath`, ONE
 * `moveTo` and ONE `stroke()` for a whole stroke (src/util/draw.ts:106-114), and the
 * committed export baselines in `e2e/` were recorded against that single-path call
 * pattern. Smoothing therefore had to stay a point-space filter instead of becoming a
 * loop of stamped tips, so the invariants pinned below are the ones that break first:
 * the call counts, the pinned endpoints, and the bezier control points.
 */
describe('paint tool stroke smoothing', () => {
  /** The options-bar values worth pinning: off, mid-scale, and the maximum. */
  const smoothingLevels = [0, 50, 100] as const;

  /**
   * Five deliberately non-collinear samples, so the filter has more than one interior
   * point to move and its 0% and 100% renders cannot coincide. No interior coordinate
   * already sits on its neighbours' midpoint, and neither endpoint does either, so an
   * endpoint that stopped being pinned would visibly move.
   */
  const curvedStroke: Point[] = [
    { x: 1, y: 2 },
    { x: 5, y: 9 },
    { x: 11, y: 3 },
    { x: 15, y: 12 },
    { x: 18, y: 4 },
  ];

  /**
   * Collinear and evenly spaced, so every interior sample is already its neighbours'
   * midpoint and the filter has to be a fixed point here.
   */
  const collinearStroke: Point[] = [
    { x: 1, y: 1 },
    { x: 2, y: 2 },
    { x: 3, y: 3 },
    { x: 4, y: 4 },
    { x: 5, y: 5 },
  ];

  /**
   * Both paint tools force the pen renderer, so this suite has a single family. It was
   * `paintToolNames.filter((name) => name !== 'color-replacement')` while the Color Replacement
   * was still a member of `PaintToolName` and forced the spray pen instead; the narrowing in
   * `src/tools/brush.ts` made the filter the identity, and a filter that filters nothing is a
   * lie about what this suite covers.
   */
  const penToolNames = paintToolNames;

  const smoothingArgs = (toolName: PaintToolName, points: Point[], smoothing: number): PaintToolArgs => ({
    ...paintToolArgsWithPoints(toolName, points),
    smoothing,
  });

  const numericCalls = (spy: { mock: { calls: unknown } }): number[][] => spy.mock.calls as number[][];

  /**
   * Both renderers issue six-coordinate calls: `bezierCurveTo(cp1x, cp1y, cp2x,
   * cp2y, x, y)` and `createRadialGradient(x0, y0, r0, x1, y1, r1)`
   * (src/util/draw.ts:39,127). Pinning the arity keeps a signature change from turning
   * the coordinate assertions below into `undefined` comparisons that pass anything.
   */
  const sixArgCalls = (spy: { mock: { calls: unknown } }): number[][] =>
    numericCalls(spy).map((call) => {
      expect(call).toHaveLength(6);
      return call;
    });

  /**
   * The two `bezierCurveTo` triples `bezierSmoothedLine` issues for a 5-point path -
   * `points[j], points[j+1], points[j+2]` for j = 0 and j = 2, with nothing left over
   * for its trailing `lineTo` branch (src/util/draw.ts:30-46) - flattened to one number
   * per axis so two runs can be compared axis by axis.
   */
  const bezierTrace = (path: Point[]): number[] =>
    [0, 2].flatMap((j) => [path[j].x, path[j].y, path[j + 1].x, path[j + 1].y, path[j + 2].x, path[j + 2].y]);

  /** `smoothStrokePoints` at 100: every interior sample on its neighbours' midpoint (src/tools/brush.ts:105-118). */
  const midpointedPath = (path: Point[]): Point[] =>
    path.map((point, i) =>
      i === 0 || i === path.length - 1
        ? point
        : { x: (path[i - 1].x + path[i + 1].x) / 2, y: (path[i - 1].y + path[i + 1].y) / 2 }
    );

  /** The filter's proportional pull, restated from src/tools/brush.ts:111-115 so the expectation is derived rather than literal. */
  const pulledPath = (path: Point[], level: number): Point[] => {
    const target = midpointedPath(path);
    const pull = level / 100;

    return path.map((point, i) => ({
      x: point.x + pull * (target[i].x - point.x),
      y: point.y + pull * (target[i].y - point.y),
    }));
  };

  const expectBezierPath = (ctx: MockCtx, path: Point[]) => {
    const calls = sixArgCalls(ctx.bezierCurveTo);
    expect(calls).toHaveLength(2);
    const expected = bezierTrace(path);

    calls.flat().forEach((value, axis) => expect(value, `axis ${axis}`).toBeCloseTo(expected[axis]));
  };

  /** A comparable record of everything a stroke drew, so two runs compare call-for-call instead of field-by-field. */
  const drawTrace = (ctx: MockCtx) => ({
    beginPath: ctx.beginPath.mock.calls,
    moveTo: ctx.moveTo.mock.calls,
    lineTo: ctx.lineTo.mock.calls,
    bezierCurveTo: ctx.bezierCurveTo.mock.calls,
    arc: ctx.arc.mock.calls,
    stroke: ctx.stroke.mock.calls,
    fill: ctx.fill.mock.calls,
    createRadialGradient: ctx.createRadialGradient.mock.calls,
  });

  it.each(paintToolNames)('issues one path and one stroke for %s at every smoothing value', (toolName) => {
    for (const smoothing of smoothingLevels) {
      const canvas = runProcessor(toolName, smoothingArgs(toolName, curvedStroke, smoothing));
      const label = `${toolName} at ${smoothing}%`;

      // Smoothing filters the path in point space, so it cannot change how many
      // paths a stroke opens or how many samples the renderer walks. A stamp loop
      // would raise both counts and break the committed export baselines.
      expect(canvas.ctx.beginPath, label).toHaveBeenCalledTimes(1);
      expect(canvas.ctx.moveTo, label).toHaveBeenCalledTimes(1);
      expect(canvas.ctx.stroke, label).toHaveBeenCalledTimes(1);
      expect(canvas.ctx.createRadialGradient, label).not.toHaveBeenCalled();
    }
  });

  it.each(paintToolNames)('starts the %s stroke on the first raw sample at every smoothing value', (toolName) => {
    for (const smoothing of smoothingLevels) {
      const canvas = runProcessor(toolName, smoothingArgs(toolName, curvedStroke, smoothing));
      const label = `${toolName} at ${smoothing}%`;

      // `smoothStrokePoints` copies the first sample through untouched
      // (src/tools/brush.ts:105), so the path still begins under the pointer. In
      // `curvedStroke` that head sits far off its neighbours' midpoint, so a filter
      // that smoothed it would move the stroke's start rather than blur it.
      expect(canvas.ctx.moveTo, label).toHaveBeenCalledTimes(1);
      expect(canvas.ctx.moveTo, label).toHaveBeenCalledWith(curvedStroke[0].x, curvedStroke[0].y);
    }
  });

  it('feeds the raw neighbouring samples to the pen bezier control points at zero smoothing', () => {
    for (const toolName of penToolNames) {
      const canvas = runProcessor(toolName, smoothingArgs(toolName, curvedStroke, 0));

      // `bezierSmoothedLine` passes p1 = points[j], p2 = points[j+1] and p3 = points[j+2]
      // as the two control points and the endpoint (src/util/draw.ts:36-39), so at 0%
      // the whole path must still be the untouched samples. Compared exactly rather
      // than approximately: 0% is the identity pass-through that keeps every stroke
      // recorded before smoothing, and the export baselines with it, unchanged.
      expect(sixArgCalls(canvas.ctx.bezierCurveTo)).toEqual([
        [
          curvedStroke[0].x,
          curvedStroke[0].y,
          curvedStroke[1].x,
          curvedStroke[1].y,
          curvedStroke[2].x,
          curvedStroke[2].y,
        ],
        [
          curvedStroke[2].x,
          curvedStroke[2].y,
          curvedStroke[3].x,
          curvedStroke[3].y,
          curvedStroke[4].x,
          curvedStroke[4].y,
        ],
      ]);
    }
  });

  it('pulls the pen bezier control points toward the neighbour midpoints in proportion to smoothing', () => {
    const halfway = bezierTrace(pulledPath(curvedStroke, 50));

    for (const toolName of penToolNames) {
      const atZero = sixArgCalls(
        runProcessor(toolName, smoothingArgs(toolName, curvedStroke, 0)).ctx.bezierCurveTo
      ).flat();
      const atHalf = sixArgCalls(
        runProcessor(toolName, smoothingArgs(toolName, curvedStroke, 50)).ctx.bezierCurveTo
      ).flat();
      const atFull = sixArgCalls(
        runProcessor(toolName, smoothingArgs(toolName, curvedStroke, 100)).ctx.bezierCurveTo
      ).flat();

      // Axes 0-1 and 10-11 are the two pinned endpoints; the eight interior axes are
      // the only ones the filter is allowed to move, and at 50% each must land on the
      // proportional pull - strictly between 0% and 100%, never on either extreme.
      for (const axis of [2, 3, 4, 5, 6, 7, 8, 9]) {
        expect(atHalf[axis], `${toolName} axis ${axis}`).toBeCloseTo(halfway[axis]);
        expect(atHalf[axis], `${toolName} axis ${axis}`).not.toBeCloseTo(atZero[axis]);
        expect(atHalf[axis], `${toolName} axis ${axis}`).not.toBeCloseTo(atFull[axis]);
      }

      for (const axis of [0, 1, 10, 11]) {
        expect(atHalf[axis], `${toolName} pinned axis ${axis}`).toBe(atZero[axis]);
        expect(atFull[axis], `${toolName} pinned axis ${axis}`).toBe(atZero[axis]);
      }
    }
  });

  it('snaps the interior pen bezier control points onto the neighbour midpoints at full smoothing', () => {
    const target = midpointedPath(curvedStroke);

    for (const toolName of penToolNames) {
      const atFull = runProcessor(toolName, smoothingArgs(toolName, curvedStroke, 100));
      const atZero = runProcessor(toolName, smoothingArgs(toolName, curvedStroke, 0));

      expectBezierPath(atFull.ctx, target);
      // A non-collinear stroke must look different at 100% than at 0%, or the control
      // point assertions above would be passing against an identity filter.
      expect(sixArgCalls(atFull.ctx.bezierCurveTo)).not.toEqual(sixArgCalls(atZero.ctx.bezierCurveTo));
    }
  });

  it('leaves an evenly spaced collinear stroke geometrically identical at full smoothing', () => {
    for (const toolName of penToolNames) {
      const atFull = runProcessor(toolName, smoothingArgs(toolName, collinearStroke, 100));
      const atZero = runProcessor(toolName, smoothingArgs(toolName, collinearStroke, 0));

      // Every interior sample already sits on its neighbours' midpoint, so the filter
      // is a fixed point here. The explicit numbers keep the comparison from being two
      // empty records, and pin the collinear fixture as the test calls it.
      expect(sixArgCalls(atFull.ctx.bezierCurveTo).flat()).toEqual(bezierTrace(collinearStroke));
      expect(sixArgCalls(atFull.ctx.bezierCurveTo)).toEqual(sixArgCalls(atZero.ctx.bezierCurveTo));
    }
  });

  it('applies the smoothing the options bar seeded, at the level it seeded', () => {
    for (const toolName of paintToolNames) {
      // The seeded options-bar state, read from `defaultSettings` rather than a
      // literal, so a change to `PAINT_SMOOTHING_DEFAULT` moves the expectation with
      // it and a stroke the user never touched is the one under test.
      const seeded = runProcessor(toolName, paintToolArgsWithPoints(toolName, curvedStroke));
      const atZero = runProcessor(toolName, smoothingArgs(toolName, curvedStroke, 0));
      const expected = pulledPath(curvedStroke, defaultSettings[toolName].smoothing);

      expectBezierPath(seeded.ctx, expected);

      // The seeded level is not 0, so the default render must differ from an
      // explicitly unsmoothed one.
      expect(defaultSettings[toolName].smoothing).toBeGreaterThan(0);
      expect(drawTrace(seeded.ctx)).not.toEqual(drawTrace(atZero.ctx));
    }
  });

  /**
   * `gives the color replacement spray renderer the smoothed path, not the raw samples` used to
   * sit here. Its subject does not exist: the Color Replacement has left `PaintToolName`, so it
   * reaches neither `drawSpray` nor the paint bar's path filter, and `smoothStrokePoints` is not
   * called anywhere in `src/tools/colorReplacement.ts`. Its own `smoothness` is a different
   * control — the softening of the brush's coverage rim — and the ground it stood on (a drag
   * sweeps a segment rather than its endpoints, and the rim softens) is pinned in
   * `src/tools/__tests__/color-replacement.test.ts` under `createStrokeCoverage` and
   * `createColorReplacementPlan — Smoothness and Size`.
   */

  it('renders the legacy draw tool identically whether smoothing is absent or zero', () => {
    const absent = { ...defaultSettings.draw, points: curvedStroke };
    const zero = { ...absent, smoothing: 0 };
    const full = { ...absent, smoothing: 100 };

    // `draw` predates the paint bar and its per-pen presets carry no `smoothing`
    // (src/tools/settings.ts:53-59), so an absent value has to mean no smoothing. That
    // is the contract the committed export baselines were recorded under.
    expect('smoothing' in absent).toBe(false);

    const absentTrace = drawTrace(runProcessor('draw', absent).ctx);
    const zeroTrace = drawTrace(runProcessor('draw', zero).ctx);
    const fullTrace = drawTrace(runProcessor('draw', full).ctx);

    // A stroke-shaped comparison, so the equality below is not two empty records.
    expect(absentTrace.bezierCurveTo).toHaveLength(2);
    expect(absentTrace.stroke).toHaveLength(1);
    expect(zeroTrace).toEqual(absentTrace);
    // ...and the legacy path is genuinely smoothed when asked, so the equality above
    // is the absent-means-zero contract and not a filter that never runs.
    expect(fullTrace).not.toEqual(absentTrace);
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

describe('paint tool input hardening', () => {
  describe('lineWidth', () => {
    /**
     * Only the pencil processor (`toolProcessors.ts:366-367`) narrows `lineWidth`: a non-finite
     * value falls back to the constant `DEFAULT_PENCIL_LINE_WIDTH` (3), and zero or negative is
     * clamped to the canvas minimum of 1. The brush processor and every tool that reaches
     * `setupDrawCtx` write `lineWidth` through verbatim, so a NaN there becomes `ctx.lineWidth = NaN`
     * — the canvas would silently ignore it, but no guard in this code path stops it.
     */
    it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
      'pencil falls back to width 3 for non-finite lineWidth %p',
      (lineWidth) => {
        const canvas = runProcessor('pencil', { ...paintToolArgsWithPoints('pencil', stroke), lineWidth });
        expect(canvas.ctx.lineWidth).toBe(3);
      }
    );

    it.each([0, -1, -100])('pencil clamps zero or negative lineWidth %p to 1', (lineWidth) => {
      const canvas = runProcessor('pencil', { ...paintToolArgsWithPoints('pencil', stroke), lineWidth });
      expect(canvas.ctx.lineWidth).toBe(1);
    });

    it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 0, -100])(
      'brush passes lineWidth %p straight to the context without clamping',
      (lineWidth) => {
        const canvas = runProcessor('brush', { ...paintToolArgsWithPoints('brush', stroke), lineWidth });
        expect(canvas.ctx.lineWidth).toBe(lineWidth);
      }
    );

    it('setupDrawCtx writes lineWidth verbatim — NaN included', () => {
      const ctx = createMockCanvasContext();
      for (const lineWidth of [Number.NaN, Number.POSITIVE_INFINITY, 0, -10]) {
        setupDrawCtx(ctx as unknown as Ctx2D, {
          toolName: 'draw',
          penType: 'pen',
          color: '#000000',
          alpha: 1,
          lineWidth,
        });
        expect(ctx.lineWidth).toBe(lineWidth);
      }
    });

    it.fails('clamps non-finite lineWidth before it reaches the brush context', () => {
      const canvas = runProcessor('brush', { ...paintToolArgsWithPoints('brush', stroke), lineWidth: Number.NaN });
      expect(Number.isFinite(canvas.ctx.lineWidth)).toBe(true);
    });
  });

  describe('alpha', () => {
    /**
     * `setupDrawCtx` (`src/tools/draw.ts:97`) assigns `ctx.globalAlpha = alpha` with no
     * sanitization, so NaN, ±Infinity and out-of-range values all land on the context unchanged.
     * The pencil processor clamps `lineWidth` but leaves `alpha` alone, and the spray pen
     * carries `alpha` straight into the gradient's color stops via `drawSpray`
     * (`src/util/draw.ts:218`).
     */
    it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -0.5, 1.5])(
      'pen tools pass alpha %p straight to globalAlpha without clamping',
      (alpha) => {
        for (const toolName of paintToolNames) {
          const canvas = runProcessor(toolName, { ...paintToolArgsWithPoints(toolName, stroke), alpha });
          expect(canvas.ctx.globalAlpha, `${toolName} alpha ${alpha}`).toBe(alpha);
        }
      }
    );

    it('drawSpray propagates non-finite alpha into the gradient color stops', () => {
      const ctx = createMockCanvasContext();
      drawSpray({
        args: {
          toolName: 'draw',
          penType: 'spray',
          color: '#ff0000',
          alpha: Number.NaN,
          lineWidth: 10,
          points: [{ x: 5, y: 5 }],
        },
        ctx: ctx as unknown as Ctx2D,
      });

      const gradient = vi.mocked(ctx.createRadialGradient).mock.results[0]?.value as
        { addColorStop: ReturnType<typeof vi.fn> } | undefined;
      expect(gradient).toBeDefined();

      const stops = gradient!.addColorStop.mock.calls as [number, string][];
      expect(stops[0]).toEqual([0, `rgba(255, 0, 0, NaN)`]);
      expect(stops[1]).toEqual([0.25, `rgba(255, 0, 0, NaN)`]);
      expect(stops[2]).toEqual([1, `rgba(255, 0, 0, 0)`]);
    });

    it.fails('clamps non-finite alpha into [0, 1] before it reaches globalAlpha', () => {
      for (const toolName of paintToolNames) {
        const canvas = runProcessor(toolName, {
          ...paintToolArgsWithPoints(toolName, stroke),
          alpha: Number.NaN,
        });
        expect(Number.isFinite(canvas.ctx.globalAlpha), toolName).toBe(true);
      }
    });

    it.fails('sanitizes non-finite alpha out of the spray gradient color stops', () => {
      const ctx = createMockCanvasContext();
      drawSpray({
        args: {
          toolName: 'draw',
          penType: 'spray',
          color: '#ff0000',
          alpha: Number.NaN,
          lineWidth: 10,
          points: [{ x: 5, y: 5 }],
        },
        ctx: ctx as unknown as Ctx2D,
      });

      const gradient = vi.mocked(ctx.createRadialGradient).mock.results[0]?.value as
        { addColorStop: ReturnType<typeof vi.fn> } | undefined;
      expect(gradient).toBeDefined();
      const stops = gradient!.addColorStop.mock.calls as [number, string][];
      for (const call of stops) {
        expect(call[1]).not.toMatch('NaN');
      }
    });
  });

  describe('empty points', () => {
    /**
     * `drawLine` dispatches to `drawPen` or `drawSpray` after smoothing, and both early-return
     * on `points.length === 0` (`src/util/draw.ts:116-117` for the guard, `:165` and `:213` for
     * the no-op returns). No canvas method may fire — not even `beginPath`, which would leave
     * an empty path pending on a shared context.
     */
    it('drawLine is a no-op for pen when points are empty', () => {
      const ctx = createMockCanvasContext();
      drawLine({
        args: {
          toolName: 'draw',
          penType: 'pen',
          color: '#000000',
          alpha: 1,
          lineWidth: 10,
          points: [],
        },
        ctx: ctx as unknown as Ctx2D,
      });
      expect(ctx.beginPath).not.toHaveBeenCalled();
      expect(ctx.moveTo).not.toHaveBeenCalled();
      expect(ctx.lineTo).not.toHaveBeenCalled();
      expect(ctx.bezierCurveTo).not.toHaveBeenCalled();
      expect(ctx.stroke).not.toHaveBeenCalled();
    });

    it('drawLine is a no-op for pen-dashed when points are empty', () => {
      const ctx = createMockCanvasContext();
      drawLine({
        args: {
          toolName: 'draw',
          penType: 'pen-dashed',
          color: '#000000',
          alpha: 1,
          lineWidth: 10,
          lineDash: [5, 5],
          points: [],
        },
        ctx: ctx as unknown as Ctx2D,
      });
      expect(ctx.beginPath).not.toHaveBeenCalled();
      expect(ctx.moveTo).not.toHaveBeenCalled();
      expect(ctx.stroke).not.toHaveBeenCalled();
    });

    it('drawLine is a no-op for spray when points are empty', () => {
      const ctx = createMockCanvasContext();
      drawLine({
        args: {
          toolName: 'draw',
          penType: 'spray',
          color: '#ff0000',
          alpha: 0.8,
          lineWidth: 10,
          points: [],
        },
        ctx: ctx as unknown as Ctx2D,
      });
      expect(ctx.createRadialGradient).not.toHaveBeenCalled();
      expect(ctx.arc).not.toHaveBeenCalled();
      expect(ctx.beginPath).not.toHaveBeenCalled();
      expect(ctx.fill).not.toHaveBeenCalled();
    });
  });

  describe('single-point strokes', () => {
    /**
     * A single sample is a click, not a drag. `drawPen` still opens a path, moves to the point,
     * and strokes — the `beginPath`/`moveTo`/`stroke` count stays at one each
     * (`src/util/draw.ts:163-176`), which is the same invariant the committed export baselines
     * depend on. The interior `lineTo` from `bezierSmoothedLine` is degenerate (same point), but
     * it still fires so the path is closed and the line cap is painted.
     */
    it('drawPen opens one path, moves to the point, and strokes once', () => {
      const ctx = createMockCanvasContext();
      drawPen({
        args: {
          toolName: 'draw',
          penType: 'pen',
          color: '#000000',
          alpha: 1,
          lineWidth: 10,
          points: [{ x: 5, y: 5 }],
        },
        ctx: ctx as unknown as Ctx2D,
      });
      expect(ctx.beginPath).toHaveBeenCalledTimes(1);
      expect(ctx.moveTo).toHaveBeenCalledTimes(1);
      expect(ctx.moveTo).toHaveBeenCalledWith(5, 5);
      expect(ctx.lineTo).toHaveBeenCalledTimes(1);
      expect(ctx.lineTo).toHaveBeenCalledWith(5, 5);
      expect(ctx.bezierCurveTo).not.toHaveBeenCalled();
      expect(ctx.stroke).toHaveBeenCalledTimes(1);
    });

    it('drawLine reaches drawPen for a single point at every smoothing value', () => {
      const point = { x: 3, y: 7 };
      for (const smoothing of [0, 50, 100]) {
        const ctx = createMockCanvasContext();
        drawLine({
          args: {
            toolName: 'draw',
            penType: 'pen',
            color: '#000000',
            alpha: 1,
            lineWidth: 10,
            points: [point],
            smoothing,
          },
          ctx: ctx as unknown as Ctx2D,
        });
        // Smoothing is a no-op on fewer than 3 points (src/tools/brush.ts:128), so the
        // single-point path is identical at 0%, 50% and 100%.
        expect(ctx.beginPath, `smoothing ${smoothing}`).toHaveBeenCalledTimes(1);
        expect(ctx.moveTo, `smoothing ${smoothing}`).toHaveBeenCalledWith(3, 7);
        expect(ctx.lineTo, `smoothing ${smoothing}`).toHaveBeenCalledTimes(1);
        expect(ctx.stroke, `smoothing ${smoothing}`).toHaveBeenCalledTimes(1);
      }
    });

    it('drawSpray deposits exactly one dab for a single sample', () => {
      const ctx = createMockCanvasContext();
      drawSpray({
        args: {
          toolName: 'draw',
          penType: 'spray',
          color: '#ff0000',
          alpha: 0.8,
          lineWidth: 10,
          points: [{ x: 5, y: 5 }],
        },
        ctx: ctx as unknown as Ctx2D,
      });
      expect(ctx.createRadialGradient).toHaveBeenCalledTimes(1);
      expect(ctx.createRadialGradient).toHaveBeenCalledWith(5, 5, 0, 5, 5, 5);
      expect(ctx.arc).toHaveBeenCalledTimes(1);
      expect(ctx.arc).toHaveBeenCalledWith(5, 5, 5, 0, Math.PI * 2);
      expect(ctx.fill).toHaveBeenCalledTimes(1);
    });

    it('drawSpray still emits one dab for a single sample even with non-finite lineWidth', () => {
      const ctx = createMockCanvasContext();
      drawSpray({
        args: {
          toolName: 'draw',
          penType: 'spray',
          color: '#ff0000',
          alpha: 0.8,
          lineWidth: Number.NaN,
          points: [{ x: 5, y: 5 }],
        },
        ctx: ctx as unknown as Ctx2D,
      });
      // radius = NaN * 0.5 = NaN; the mock records it verbatim rather than coercing.
      expect(ctx.createRadialGradient).toHaveBeenCalledTimes(1);
      expect(ctx.arc).toHaveBeenCalledTimes(1);
      expect(ctx.fill).toHaveBeenCalledTimes(1);
      const arcArgs = vi.mocked(ctx.arc).mock.calls[0] as [number, number, number, number, number];
      expect(arcArgs[2]).toBe(Number.NaN);
    });
  });
});
