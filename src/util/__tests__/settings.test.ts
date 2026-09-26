import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cloneDeep } from 'lodash-es';
import { saveLastSettings } from '../settings.ts';
import { defaultSettings, lastSavedSettings, savedDrawPerPen, savedArgsPerFigure } from '../../tools/settings.ts';
import { isFigureType, normalizeFigure, type FigureType } from '../../tools/shape.ts';
import type { ToolArgs } from '../../contexts/tool-types.ts';

/**
 * Hard-coded copy of the narrowed `FigureType` union. The imported type cannot be
 * enumerated at runtime, so the expectations must be written out literally.
 */
const figureTypes = ['line', 'rectangle', 'oval', 'triangle', 'polygon'] as const satisfies readonly FigureType[];

const legacyFigures = ['circle', 'square'] as const;

/**
 * `lastSavedSettings` is mutable module state shared by every test in this file, so
 * it is rebuilt from `defaultSettings` before and after each test. Keys that a test
 * added are removed as well, so no test can leak into the next one.
 */
const resetLastSavedSettings = () => {
  for (const key of Object.keys(lastSavedSettings)) {
    if (!Object.hasOwn(defaultSettings, key)) delete (lastSavedSettings as Record<string, unknown>)[key];
  }
  Object.assign(lastSavedSettings, cloneDeep(defaultSettings));
};

/** Mirrors the read-side coercion in `useCurrentTool`'s `cloneSavedToolArgs`. */
const loadPersistedArgs = <T extends { figure?: unknown }>(args: T): T => {
  const loaded = cloneDeep(args);
  if (isFigureType(loaded.figure)) return loaded;
  return { ...loaded, figure: normalizeFigure(loaded.figure) };
};

describe('saveLastSettings', () => {
  beforeEach(() => {
    resetLastSavedSettings();
  });

  afterEach(() => {
    resetLastSavedSettings();
  });

  it('throws when toolName is missing', () => {
    const invalidArgs = {} as Record<string, unknown>;
    expect(() => saveLastSettings(invalidArgs as ToolArgs)).toThrow('Tool name required');
  });

  it('stores draw settings without points', () => {
    saveLastSettings({
      alpha: 0.8,
      color: '#ff0000',
      penType: 'pen',
      lineWidth: 5,
      points: [
        { x: 1, y: 2 },
        { x: 3, y: 4 },
      ],
      toolName: 'draw',
    });
    expect(lastSavedSettings.draw).toMatchObject({
      alpha: 0.8,
      color: '#ff0000',
      penType: 'pen',
      lineWidth: 5,
      toolName: 'draw',
    });
    expect(lastSavedSettings.draw.points).toEqual([]);
  });

  it('stores text settings without text and rect', () => {
    saveLastSettings({
      text: 'hello',
      rect: { x1: 0, y1: 0, x2: 100, y2: 50 },
      fontSize: 32,
      lineHeight: 1.2,
      fontFamily: 'Arial',
      color: '#0000ff',
      align: 'center',
      bold: true,
      italic: false,
      toolName: 'text',
    });
    const text = lastSavedSettings.text;
    expect(text.text).toBeUndefined();
    expect(text.rect).toBeUndefined();
    expect(text.fontSize).toBe(32);
    expect(text.color).toBe('#0000ff');
    expect(text.bold).toBe(true);
    expect(text.align).toBe('center');
  });

  it('stores shape settings without start and end', () => {
    saveLastSettings({
      alpha: 0.5,
      color: '#00ff00',
      backgroundColor: '#ffffff',
      figure: 'oval',
      lineWidth: 3,
      start: { x: 0, y: 0 },
      end: { x: 10, y: 10 },
      toolName: 'shape',
    });
    const shape = lastSavedSettings.shape;
    expect(shape.start).toBeUndefined();
    expect(shape.end).toBeUndefined();
    expect(shape.figure).toBe('oval');
    expect(shape.backgroundColor).toBe('#ffffff');
    expect(shape.alpha).toBe(0.5);
  });

  it('normalizes legacy circle and square figures without discarding the saved style', () => {
    saveLastSettings({
      alpha: 0.25,
      color: '#123456',
      backgroundColor: null,
      figure: 'circle' as unknown as typeof defaultSettings.shape.figure,
      lineWidth: 9,
      cornerRadius: 4,
      start: { x: 0, y: 0 },
      end: { x: 10, y: 10 },
      toolName: 'shape',
    });
    expect(lastSavedSettings.shape.figure).toBe('oval');
    expect(lastSavedSettings.shape.lineWidth).toBe(9);
    expect(lastSavedSettings.shape.cornerRadius).toBe(4);

    saveLastSettings({
      alpha: 1,
      color: '#654321',
      backgroundColor: null,
      figure: 'square' as unknown as typeof defaultSettings.shape.figure,
      lineWidth: 7,
      cornerRadius: 2,
      start: { x: 0, y: 0 },
      end: { x: 10, y: 10 },
      toolName: 'shape',
    });
    expect(lastSavedSettings.shape.figure).toBe('rectangle');
    expect(lastSavedSettings.shape.lineWidth).toBe(7);
    expect(lastSavedSettings.shape.cornerRadius).toBe(2);
  });

  it('falls back to rectangle for an unknown figure', () => {
    saveLastSettings({
      alpha: 1,
      color: '#000000',
      backgroundColor: null,
      figure: 'blob' as unknown as typeof defaultSettings.shape.figure,
      lineWidth: 2,
      start: { x: 0, y: 0 },
      end: { x: 10, y: 10 },
      toolName: 'shape',
    });
    expect(lastSavedSettings.shape.figure).toBe('rectangle');
  });

  it('stores crop settings without rect', () => {
    saveLastSettings({
      rect: { x1: 0, y1: 0, x2: 100, y2: 100 },
      aspectRatio: 1.5,
      toolName: 'crop',
    });
    const crop = lastSavedSettings.crop;
    expect(crop.rect).toBeUndefined();
    expect(crop.aspectRatio).toBe(1.5);
  });

  it('stores transform settings verbatim', () => {
    const args = {
      rotate: 90,
      mirrorH: true,
      mirrorV: false,
      skewX: 10,
      skewY: 5,
      trapezoid: 0,
      resizeX: 110,
      resizeY: 95,
      toolName: 'transform' as const,
    };
    saveLastSettings(args);
    expect(lastSavedSettings.transform).toMatchObject(args);
  });

  it('stores reposition settings verbatim', () => {
    const args = { move: { x: 5, y: 10 }, toolName: 'reposition' as const };
    saveLastSettings(args);
    expect(lastSavedSettings.reposition).toMatchObject(args);
  });

  it('stores freehand-lasso and polygonal-lasso settings verbatim', () => {
    saveLastSettings({
      points: [{ x: 0, y: 0 }],
      color: '#ff0000',
      lineWidth: 2,
      alpha: 1,
      fill: false,
      toolName: 'freehand-lasso',
    });
    expect(lastSavedSettings['freehand-lasso']).toMatchObject({
      color: '#ff0000',
      lineWidth: 2,
      toolName: 'freehand-lasso',
    });

    saveLastSettings({
      points: [{ x: 0, y: 0 }],
      color: '#0000ff',
      lineWidth: 4,
      alpha: 0.5,
      fill: true,
      toolName: 'polygonal-lasso',
    });
    expect(lastSavedSettings['polygonal-lasso']).toMatchObject({ color: '#0000ff', fill: true });
  });

  it('stores feather-magnetic-lasso settings without points', () => {
    saveLastSettings({
      points: [
        { x: 1, y: 2 },
        { x: 3, y: 4 },
      ],
      featherRadius: 10,
      magneticWidth: 20,
      edgeContrast: 30,
      frequency: 40,
      snapStrength: 0.5,
      smoothing: 1,
      antiAlias: true,
      previewFeather: true,
      toolName: 'feather-magnetic-lasso',
    });
    const result = lastSavedSettings['feather-magnetic-lasso'];
    expect(result.points).toEqual([]);
    expect(result.featherRadius).toBe(10);
    expect(result.snapStrength).toBe(0.5);
  });

  it('stores magic-wand settings verbatim', () => {
    const args = { tolerance: 30, smoothing: 1.5, toolName: 'magic-wand' as const };
    saveLastSettings(args);
    expect(lastSavedSettings['magic-wand']).toMatchObject(args);
  });

  it('stores rectangular-selection with only toolName', () => {
    saveLastSettings({ rect: { x1: 0, y1: 0, x2: 10, y2: 10 }, toolName: 'rectangular-selection' });
    expect(lastSavedSettings['rectangular-selection']).toEqual({ toolName: 'rectangular-selection' });
  });

  it('does not mutate the original args when storing', () => {
    const args: ToolArgs = {
      alpha: 0.8,
      color: '#ff0000',
      penType: 'pen',
      lineWidth: 5,
      points: [{ x: 1, y: 2 }],
      toolName: 'draw',
    };
    saveLastSettings(args);
    expect(args.points).toEqual([{ x: 1, y: 2 }]);
  });
});

describe('saveLastSettings figure migration', () => {
  const shapeArgsWithFigure = (figure: unknown, overrides: Record<string, unknown> = {}): ToolArgs =>
    ({
      alpha: 0.5,
      color: '#00ff00',
      backgroundColor: '#ffffff',
      figure,
      lineWidth: 4,
      cornerRadius: 3,
      start: { x: 3, y: 4 },
      end: { x: 40, y: 24 },
      toolName: 'shape',
      ...overrides,
    }) as unknown as ToolArgs;

  const geometryToolArgsWithFigure = (toolName: 'triangle' | 'polygon', figure: unknown): ToolArgs =>
    ({
      ...defaultSettings[toolName],
      figure,
      start: { x: 3, y: 4 },
      end: { x: 40, y: 24 },
    }) as unknown as ToolArgs;

  beforeEach(() => {
    resetLastSavedSettings();
  });

  afterEach(() => {
    resetLastSavedSettings();
  });

  it.each([
    ['circle', 'oval'],
    ['square', 'rectangle'],
  ])('persists the legacy %s figure as %s instead of dropping the saved style', (legacy, migrated) => {
    saveLastSettings(shapeArgsWithFigure(legacy));

    const shape = lastSavedSettings.shape;
    expect(shape.figure).toBe(migrated);
    expect(shape.lineWidth).toBe(4);
    expect(shape.cornerRadius).toBe(3);
    expect(shape.alpha).toBe(0.5);
    expect(shape.color).toBe('#00ff00');
    expect(shape.backgroundColor).toBe('#ffffff');
  });

  it.each(figureTypes)('persists the valid %s figure unchanged', (figure) => {
    saveLastSettings(shapeArgsWithFigure(figure));

    expect(lastSavedSettings.shape.figure).toBe(figure);
  });

  it.each([
    ['unknown name', 'blob'],
    ['empty string', ''],
    ['ellipse alias', 'ellipse'],
    ['number', 42],
    ['null', null],
    ['undefined', undefined],
    ['object', { figure: 'oval' }],
    ['array', ['oval']],
  ])('falls back to rectangle instead of throwing for a %s figure', (_label, figure) => {
    expect(() => saveLastSettings(shapeArgsWithFigure(figure))).not.toThrow();

    expect(lastSavedSettings.shape.figure).toBe('rectangle');
  });

  it('omits the drag geometry from the persisted shape args', () => {
    saveLastSettings(shapeArgsWithFigure('circle'));

    const shape = lastSavedSettings.shape as Record<string, unknown>;
    expect(Object.hasOwn(shape, 'start')).toBe(false);
    expect(Object.hasOwn(shape, 'end')).toBe(false);
    expect(Object.keys(shape).sort()).toEqual(
      ['alpha', 'backgroundColor', 'color', 'cornerRadius', 'figure', 'lineWidth', 'toolName'].sort()
    );
  });

  it.each([
    ['triangle' as const, 'circle' as const],
    ['polygon' as const, 'square' as const],
  ])('normalizes the figure persisted for the %s tool', (toolName, legacy) => {
    saveLastSettings(geometryToolArgsWithFigure(toolName, legacy));

    const saved = lastSavedSettings[toolName] as unknown as Record<string, unknown>;
    expect(saved.figure).toBe(normalizeFigure(legacy));
    expect(isFigureType(saved.figure)).toBe(true);
    expect(Object.hasOwn(saved, 'start')).toBe(false);
    expect(Object.hasOwn(saved, 'end')).toBe(false);
  });

  it('normalizes a legacy figure for the triangle and polygon tools without touching valid ones', () => {
    saveLastSettings(geometryToolArgsWithFigure('triangle', 'triangle'));
    expect((lastSavedSettings.triangle as { figure: unknown }).figure).toBe('triangle');

    saveLastSettings(geometryToolArgsWithFigure('polygon', 'polygon'));
    expect((lastSavedSettings.polygon as { figure: unknown }).figure).toBe('polygon');
  });

  it('does not mutate the caller args while migrating the figure', () => {
    const args = shapeArgsWithFigure('circle');
    const before = cloneDeep(args);

    saveLastSettings(args);

    expect(args).toEqual(before);
    expect((args as unknown as { figure: unknown }).figure).toBe('circle');
    expect((args as unknown as { start: unknown }).start).toEqual({ x: 3, y: 4 });
    expect(lastSavedSettings.shape.figure).toBe('oval');
    expect(lastSavedSettings.shape).not.toBe(args);
  });

  it('leaves the draw tool persistence untouched by the figure migration', () => {
    const args = {
      alpha: 0.8,
      color: '#ff0000',
      penType: 'pen',
      lineWidth: 5,
      points: [{ x: 1, y: 2 }],
      toolName: 'draw',
    } as const;

    saveLastSettings(args as unknown as ToolArgs);

    expect(lastSavedSettings.draw).toEqual({ ...args, points: [] });
    expect(lastSavedSettings.draw).not.toBe(args);
    expect(args.points).toEqual([{ x: 1, y: 2 }]);
  });

  it('leaves the text tool persistence untouched by the figure migration', () => {
    saveLastSettings({
      text: 'hello',
      rect: { x1: 0, y1: 0, x2: 100, y2: 50 },
      fontSize: 32,
      lineHeight: 1.2,
      fontFamily: 'Arial',
      color: '#0000ff',
      align: 'center',
      bold: true,
      italic: false,
      toolName: 'text',
    });

    expect(lastSavedSettings.text).toEqual({
      fontSize: 32,
      lineHeight: 1.2,
      fontFamily: 'Arial',
      color: '#0000ff',
      align: 'center',
      bold: true,
      italic: false,
      toolName: 'text',
    });
  });

  it('leaves the crop tool persistence untouched by the figure migration', () => {
    saveLastSettings({
      rect: { x1: 0, y1: 0, x2: 100, y2: 100 },
      aspectRatio: 1.5,
      toolName: 'crop',
    });

    expect(lastSavedSettings.crop).toEqual({ aspectRatio: 1.5, toolName: 'crop' });
  });

  it('never persists a figure the read path would have to repair', () => {
    const inputs: unknown[] = [...legacyFigures, 'blob', '', null, undefined, 42, {}, []];

    for (const figure of inputs) {
      saveLastSettings(shapeArgsWithFigure(figure));

      const persisted = lastSavedSettings.shape;
      expect(isFigureType(persisted.figure)).toBe(true);
      expect(figureTypes).toContain(persisted.figure);
      expect(normalizeFigure(cloneDeep(persisted).figure)).toBe(persisted.figure);
    }
  });

  it('round trips a legacy figure through the save and load paths as a valid figure', () => {
    saveLastSettings(shapeArgsWithFigure('circle'));
    const persisted = lastSavedSettings.shape;
    expect(persisted.figure).toBe('oval');

    const readBack = loadPersistedArgs(persisted);
    expect(isFigureType(readBack.figure)).toBe(true);
    expect(readBack.figure).toBe('oval');
    expect(legacyFigures).not.toContain(readBack.figure);
    expect(readBack).toEqual(persisted);
  });

  it('round trips a legacy square figure through the save and load paths as a valid figure', () => {
    saveLastSettings(shapeArgsWithFigure('square'));
    const readBack = loadPersistedArgs(lastSavedSettings.shape);

    expect(readBack.figure).toBe('rectangle');
    expect(legacyFigures).not.toContain(readBack.figure);
  });
});

describe('defaultSettings and lastSavedSettings', () => {
  it('lastSavedSettings is a deep clone of defaultSettings', () => {
    expect(lastSavedSettings).toEqual(defaultSettings);
    expect(lastSavedSettings).not.toBe(defaultSettings);
    expect(lastSavedSettings.draw).not.toBe(defaultSettings.draw);
  });

  it('savedDrawPerPen has entries for all pen types', () => {
    expect(savedDrawPerPen.pen).toMatchObject({ alpha: 0.9, lineWidth: 10 });
    expect(savedDrawPerPen['pen-dashed']).toMatchObject({ alpha: 0.9, lineWidth: 10, lineDash: [5, 30] });
    expect(savedDrawPerPen.spray).toMatchObject({ alpha: 0.5, lineWidth: 100 });
  });

  it('savedArgsPerFigure has entries for all figure types', () => {
    for (const figure of ['line', 'rectangle', 'oval', 'triangle', 'polygon'] as const) {
      expect(savedArgsPerFigure[figure]).toMatchObject({ alpha: 1, lineWidth: 5 });
    }
  });

  it('savedArgsPerFigure has no legacy circle or square entries', () => {
    expect(Object.keys(savedArgsPerFigure).sort()).toEqual(['line', 'oval', 'polygon', 'rectangle', 'triangle']);
  });

  it('savedArgsPerFigure keys match the narrowed figure union exactly', () => {
    const expectedKeys = [...figureTypes].sort();
    const actualKeys = Object.keys(savedArgsPerFigure).sort();

    expect(actualKeys).toEqual(expectedKeys);
    for (const figure of figureTypes) {
      expect(Object.hasOwn(savedArgsPerFigure, figure)).toBe(true);
      expect(savedArgsPerFigure[figure]).toBeTypeOf('object');
    }
    for (const legacy of legacyFigures) {
      expect(Object.hasOwn(savedArgsPerFigure, legacy)).toBe(false);
    }
  });

  it('savedArgsPerFigure exposes a usable style for every figure in the union', () => {
    for (const figure of figureTypes) {
      const settings = savedArgsPerFigure[figure];
      expect(settings.alpha).toBe(1);
      expect(settings.lineWidth).toBe(5);
      expect(settings.toolMode).toBe('shape');
    }
    expect(Object.hasOwn(savedArgsPerFigure.line, 'lineCap')).toBe(true);
    expect(Object.hasOwn(savedArgsPerFigure.line, 'cornerRadius')).toBe(false);
    for (const figure of ['rectangle', 'oval'] as const) {
      expect(Object.hasOwn(savedArgsPerFigure[figure], 'cornerRadius')).toBe(true);
    }
  });

  it('keeps defaultSettings figure tools aligned with the figure union', () => {
    for (const figure of figureTypes) {
      const toolName = (figure === 'oval' ? 'ellipse' : figure) as
        'rectangle' | 'ellipse' | 'line' | 'triangle' | 'polygon';

      expect(defaultSettings[toolName].figure).toBe(figure);
      expect(defaultSettings[toolName]).toMatchObject(savedArgsPerFigure[figure]);
    }
  });

  it('defaultSettings has the expected structure for each tool', () => {
    expect(defaultSettings.draw).toMatchObject({
      alpha: 0.9,
      color: '#000000',
      penType: 'pen',
      lineWidth: 10,
      toolName: 'draw',
      points: [],
    });
    expect(defaultSettings.text).toMatchObject({
      fontSize: 64,
      lineHeight: 1.1,
      fontFamily: 'Arial',
      color: '#000000',
      text: '',
      align: 'left',
      toolName: 'text',
    });
    expect(defaultSettings.shape).toMatchObject({
      figure: 'rectangle',
      color: '#000000',
      backgroundColor: null,
      toolName: 'shape',
    });
    expect(defaultSettings.crop).toMatchObject({ aspectRatio: null, rect: null, toolName: 'crop' });
    expect(defaultSettings['magic-wand']).toMatchObject({ tolerance: 28, smoothing: 1.5, toolName: 'magic-wand' });
    expect(defaultSettings['rectangular-selection']).toEqual({ toolName: 'rectangular-selection' });
    expect(defaultSettings['feather-magnetic-lasso']).toMatchObject({
      featherRadius: 12,
      magneticWidth: 18,
      toolName: 'feather-magnetic-lasso',
    });
  });
});
