import { beforeAll, describe, expect, it } from 'vitest';

import { defaultSettings, savedArgsPerFigure } from '../settings.ts';
import { toolsMap } from '../toolsMap.ts';
import { createLayerSource } from '../../contexts/layer-utils.ts';
import { toolbarMap } from '../../../toolbar-mapping.ts';
import type { ToolbarTool } from '../../../toolbar-mapping.ts';
import type { PaintToolArgs, PaintToolName } from '../draw.ts';
import type { FigureType } from '../shape.ts';
import type { Point } from '../../contexts/general-types.ts';

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

describe('paint tools', () => {
  beforeAll(() => {
    // createImageBitmap is already mocked in setup.ts
  });

  it('exposes real draw-like behavior for brush, pencil, and color replacement tools', () => {
    for (const toolName of paintToolNames) {
      const args = paintToolArgs(toolName);

      expect(args).toMatchObject({
        toolName,
        color: expect.any(String),
        alpha: expect.any(Number),
        lineWidth: expect.any(Number),
      });

      const [canvas] = toolsMap[toolName].imageProcessor({ size: { width: 20, height: 20 } })(args);
      expect(canvas).toBeTruthy();
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

      const [canvas] = toolsMap[toolName].imageProcessor({ size: { width: 20, height: 20 } })(args);
      expect(canvas).toBeTruthy();
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
      const [canvas] = toolsMap.shape.imageProcessor({ size: { width: 20, height: 20 } })({
        ...defaultSettings.shape,
        figure,
        start: { x: 2, y: 3 },
        end: { x: 16, y: 12 },
      });

      expect(canvas).toBeTruthy();
      expect(canvas.width).toBe(20);
      expect(canvas.height).toBe(20);
    }
  });
});
