import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cloneDeep } from 'lodash-es';
import { saveLastSettings } from '../settings.ts';
import { defaultSettings, lastSavedSettings, savedDrawPerPen, savedArgsPerFigure } from '../../tools/settings.ts';
import type { ToolArgs } from '../../contexts/tool-types.ts';

describe('saveLastSettings', () => {
  let original: typeof defaultSettings;

  beforeEach(() => {
    original = cloneDeep(defaultSettings);
    Object.assign(lastSavedSettings, cloneDeep(defaultSettings));
  });

  afterEach(() => {
    Object.assign(lastSavedSettings, original);
  });

  it('throws when toolName is missing', () => {
    expect(() => saveLastSettings({} as ToolArgs)).toThrow('Tool name required');
  });

  it('stores draw settings without points', () => {
    saveLastSettings({
      alpha: 0.8,
      color: '#ff0000',
      penType: 'pen',
      lineWidth: 5,
      points: [{ x: 1, y: 2 }, { x: 3, y: 4 }],
      toolName: 'draw',
    });
    expect(lastSavedSettings.draw).toMatchObject({ alpha: 0.8, color: '#ff0000', penType: 'pen', lineWidth: 5, toolName: 'draw' });
    expect((lastSavedSettings.draw as any).points).toEqual([]);
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
    const text = lastSavedSettings.text as any;
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
      figure: 'circle',
      lineWidth: 3,
      start: { x: 0, y: 0 },
      end: { x: 10, y: 10 },
      toolName: 'shape',
    });
    const shape = lastSavedSettings.shape as any;
    expect(shape.start).toBeUndefined();
    expect(shape.end).toBeUndefined();
    expect(shape.figure).toBe('circle');
    expect(shape.backgroundColor).toBe('#ffffff');
    expect(shape.alpha).toBe(0.5);
  });

  it('stores crop settings without rect', () => {
    saveLastSettings({
      rect: { x1: 0, y1: 0, x2: 100, y2: 100 },
      aspectRatio: 1.5,
      toolName: 'crop',
    });
    const crop = lastSavedSettings.crop as any;
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
    saveLastSettings({ points: [{ x: 0, y: 0 }], color: '#ff0000', lineWidth: 2, alpha: 1, fill: false, toolName: 'freehand-lasso' });
    expect(lastSavedSettings['freehand-lasso']).toMatchObject({ color: '#ff0000', lineWidth: 2, toolName: 'freehand-lasso' });

    saveLastSettings({ points: [{ x: 0, y: 0 }], color: '#0000ff', lineWidth: 4, alpha: 0.5, fill: true, toolName: 'polygonal-lasso' });
    expect(lastSavedSettings['polygonal-lasso']).toMatchObject({ color: '#0000ff', fill: true });
  });

  it('stores feather-magnetic-lasso settings without points', () => {
    saveLastSettings({
      points: [{ x: 1, y: 2 }, { x: 3, y: 4 }],
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
    const result = lastSavedSettings['feather-magnetic-lasso'] as any;
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
    const args: any = {
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
    for (const figure of ['line', 'circle', 'rectangle', 'square', 'oval'] as const) {
      expect(savedArgsPerFigure[figure]).toMatchObject({ alpha: 1, lineWidth: 5 });
    }
  });

  it('defaultSettings has the expected structure for each tool', () => {
    expect(defaultSettings.draw).toMatchObject({ alpha: 0.9, color: '#000000', penType: 'pen', lineWidth: 10, toolName: 'draw', points: [] });
    expect(defaultSettings.text).toMatchObject({ fontSize: 64, lineHeight: 1.1, fontFamily: 'Arial', color: '#000000', text: '', align: 'left', toolName: 'text' });
    expect(defaultSettings.shape).toMatchObject({ figure: 'rectangle', color: '#000000', backgroundColor: null, toolName: 'shape' });
    expect(defaultSettings.crop).toMatchObject({ aspectRatio: null, rect: null, toolName: 'crop' });
    expect(defaultSettings['magic-wand']).toMatchObject({ tolerance: 28, smoothing: 1.5, toolName: 'magic-wand' });
    expect(defaultSettings['rectangular-selection']).toEqual({ toolName: 'rectangular-selection' });
    expect(defaultSettings['feather-magnetic-lasso']).toMatchObject({ featherRadius: 12, magneticWidth: 18, toolName: 'feather-magnetic-lasso' });
  });
});
