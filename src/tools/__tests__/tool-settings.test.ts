import { beforeEach, describe, expect, it } from 'vitest';
import { cloneDeep } from 'lodash-es';

import { defaultSettings, lastSavedSettings, savedArgsPerFigure, savedDrawPerPen } from '../settings.ts';
import { toolProcessors } from '../toolProcessors.ts';
import { saveLastSettings } from '../../util/settings.ts';
import type { ToolArgs, ToolName } from '../../contexts/tool-types.ts';
import type { RectXYSorted } from '../../contexts/general-types.ts';
import type { FigureType } from '../shape.ts';
import type { PenType } from '../draw.ts';

const rect: RectXYSorted = { x1: 0, y1: 0, x2: 10, y2: 10 };

const toolNames = Object.keys(defaultSettings) as ToolName[];

/**
 * `defaultSettings` and `lastSavedSettings` are module-level singletons that
 * `saveLastSettings` mutates in place (and the exhaustiveness test below
 * `Reflect.deleteProperty`s keys from). The `defaultSettings` describe asserts
 * pristine seed state, so without a restore every one of its assertions passes or
 * fails purely on test execution order — verified: `--sequence.shuffle --sequence.seed=999`
 * failed `clones defaults into lastSavedSettings instead of aliasing them`.
 * Snapshot both at module load, then reset before every test so the file is
 * order-independent.
 */
const pristineDefaultSettings = cloneDeep(defaultSettings);
const pristineLastSavedSettings = cloneDeep(lastSavedSettings);

const restoreInPlace = (target: Record<string, unknown>, snapshot: Record<string, unknown>) => {
  for (const key of Object.keys(target)) {
    if (!(key in snapshot)) {
      Reflect.deleteProperty(target, key);
    }
  }
  for (const [key, value] of Object.entries(snapshot)) {
    target[key] = cloneDeep(value);
  }
};

beforeEach(() => {
  restoreInPlace(defaultSettings, pristineDefaultSettings);
  restoreInPlace(lastSavedSettings, pristineLastSavedSettings);
});

describe('defaultSettings', () => {
  it('declares an entry for every registered tool', () => {
    expect(toolNames.sort()).toEqual(Object.keys(toolProcessors).sort());
  });

  it('stamps each entry with its own key as toolName', () => {
    for (const toolName of toolNames) {
      expect(defaultSettings[toolName].toolName, toolName).toBe(toolName);
    }
  });

  it('does not share object references between entries', () => {
    const shared = toolNames.filter((toolName) =>
      (Object.keys(defaultSettings) as ToolName[]).some(
        (other) => other !== toolName && defaultSettings[other] === (defaultSettings[toolName] as object)
      )
    );

    expect(shared).toEqual([]);
  });

  it('seeds mutable collections empty so a fresh document has no stale geometry', () => {
    expect(defaultSettings.draw.points).toEqual([]);
    expect(defaultSettings['polygonal-lasso'].points).toEqual([]);
    expect(defaultSettings['freehand-lasso'].points).toEqual([]);
    expect(defaultSettings['feather-magnetic-lasso'].points).toEqual([]);
    expect(defaultSettings.crop.rect).toBeNull();
    expect(defaultSettings.crop.aspectRatio).toBeNull();
    expect(defaultSettings.text.rect).toBeNull();
    expect(defaultSettings.shape.backgroundColor).toBeNull();
  });

  it('neutralizes every adjustment tool', () => {
    expect(defaultSettings.blur.radius).toBe(0);
    expect(defaultSettings.color).toMatchObject({ grayscale: 0, sepia: 0, saturation: 0 });
    expect(defaultSettings.levels).toMatchObject({ brightness: 0, contrast: 0 });
    expect(defaultSettings.transform).toMatchObject({
      rotate: 0,
      mirrorH: false,
      mirrorV: false,
      skewX: 0,
      skewY: 0,
      trapezoid: 0,
      resizeX: 100,
      resizeY: 100,
    });
  });

  it('pins the transform defaults to an identity affine', () => {
    const { transform } = defaultSettings;

    expect(transform.rotate).toBe(0);
    expect(transform.mirrorH || transform.mirrorV).toBeFalsy();
    expect(transform.skewX + transform.skewY + transform.trapezoid).toBe(0);
    expect(transform.resizeX).toBe(transform.resizeY);
  });

  it('keeps toolName in sync with the shape figure for figure-tool defaults', () => {
    expect(defaultSettings.rectangle.figure).toBe('rectangle');
    expect(defaultSettings.ellipse.figure).toBe('oval');
    expect(defaultSettings.triangle.figure).toBe('triangle');
    expect(defaultSettings.polygon.figure).toBe('polygon');
    expect(defaultSettings.line.figure).toBe('line');
  });

  it('gives every figure variant the same color, background, and tool mode', () => {
    const figureVariants = ['rectangle', 'ellipse', 'triangle', 'polygon', 'line'] as const;

    for (const toolName of figureVariants) {
      expect(defaultSettings[toolName], toolName).toMatchObject({
        color: '#000000',
        backgroundColor: null,
        alpha: 1,
        lineWidth: 5,
        toolMode: 'shape',
      });
    }
  });

  it('keeps figure-specific presets that only some figures declare', () => {
    expect(defaultSettings.line.lineCap).toBe('butt');
    expect(defaultSettings.rectangle.cornerRadius).toBe(0);
    expect(defaultSettings.ellipse.cornerRadius).toBe(0);
    expect(defaultSettings.triangle).not.toHaveProperty('cornerRadius');
    expect(defaultSettings.polygon).not.toHaveProperty('cornerRadius');
  });

  it('starts the text tool with empty content and a readable default font', () => {
    expect(defaultSettings.text).toMatchObject({
      text: '',
      fontSize: 64,
      lineHeight: 1.1,
      fontFamily: 'Arial',
      align: 'left',
      bold: false,
      italic: false,
    });
  });

  it('seeds the position-neutral move default', () => {
    expect(defaultSettings.reposition.move).toEqual({ x: 0, y: 0 });
  });

  it('covers every pen type and figure type in the saved presets', () => {
    expect(Object.keys(savedDrawPerPen).sort()).toEqual(['pen', 'pen-dashed', 'spray']);
    expect(Object.keys(savedArgsPerFigure).sort()).toEqual(['line', 'oval', 'polygon', 'rectangle', 'triangle'].sort());

    for (const penType of Object.keys(savedDrawPerPen) as PenType[]) {
      expect(savedDrawPerPen[penType].lineWidth, penType).toBeGreaterThan(0);
      expect(savedDrawPerPen[penType].alpha, penType).toBeGreaterThan(0);
    }
  });

  it('gives the dashed pen a dash pattern and no other pen one', () => {
    expect(savedDrawPerPen['pen-dashed'].lineDash).toEqual([5, 30]);
    expect(savedDrawPerPen.pen.lineDash).toBeUndefined();
    expect(savedDrawPerPen.spray.lineDash).toBeUndefined();
  });

  it('gives every figure preset the shape tool mode', () => {
    for (const figure of Object.keys(savedArgsPerFigure) as FigureType[]) {
      expect(savedArgsPerFigure[figure].toolMode, figure).toBe('shape');
    }
  });

  it('clones defaults into lastSavedSettings instead of aliasing them', () => {
    expect(lastSavedSettings).toEqual(defaultSettings);
    expect(lastSavedSettings).not.toBe(defaultSettings);
    expect(lastSavedSettings.draw).not.toBe(defaultSettings.draw);
  });
});

/** Tools whose adjustments the toolbars actually expose and therefore must survive a switch. */
const tunableTools: ToolName[] = [
  'blur',
  'color',
  'levels',
  'transform',
  'crop',
  'draw',
  'shape',
  'text',
  'reposition',
  'polygonal-lasso',
  'freehand-lasso',
  'feather-magnetic-lasso',
  'magic-wand',
  'rectangle',
  'ellipse',
  'line',
  'triangle',
  'polygon',
];

describe('saveLastSettings tool-name coverage', () => {
  it('stores draw settings without the transient point list', () => {
    saveLastSettings({
      ...defaultSettings.draw,
      color: '#123456',
      lineWidth: 42,
      points: [{ x: 1, y: 2 }],
      toolName: 'draw',
    });

    expect(lastSavedSettings.draw).toMatchObject({ color: '#123456', lineWidth: 42, points: [] });
  });

  it('stores text settings without the one-shot content and rect', () => {
    saveLastSettings({ ...defaultSettings.text, color: '#abcdef', fontSize: 12, text: 'hi', rect });

    expect(lastSavedSettings.text).not.toHaveProperty('text');
    expect(lastSavedSettings.text).not.toHaveProperty('rect');
    expect(lastSavedSettings.text).toMatchObject({ color: '#abcdef', fontSize: 12 });
  });

  it('stores crop settings without the transient rect', () => {
    saveLastSettings({ ...defaultSettings.crop, aspectRatio: 1.5, rect });

    expect(lastSavedSettings.crop).not.toHaveProperty('rect');
    expect(lastSavedSettings.crop.aspectRatio).toBe(1.5);
  });

  it('drops the drag handles from shape and figure settings', () => {
    const drag = { start: { x: 1, y: 1 }, end: { x: 2, y: 2 } };

    saveLastSettings({ ...defaultSettings.shape, toolName: 'shape', ...drag });
    saveLastSettings({ ...defaultSettings.triangle, toolName: 'triangle', ...drag });

    expect(lastSavedSettings.shape).not.toHaveProperty('start');
    expect(lastSavedSettings.shape).not.toHaveProperty('end');
    expect(lastSavedSettings.triangle).not.toHaveProperty('start');
    expect(lastSavedSettings.triangle).not.toHaveProperty('end');
  });

  it('keeps the feathered lasso point list out of saved settings', () => {
    saveLastSettings({
      ...defaultSettings['feather-magnetic-lasso'],
      featherRadius: 33,
      points: [{ x: 3, y: 4 }],
    });

    expect(lastSavedSettings['feather-magnetic-lasso']).toMatchObject({ featherRadius: 33, points: [] });
  });

  it('collapses tools without a settings UI down to their tool name', () => {
    saveLastSettings({ toolName: 'rectangular-selection', rect });
    saveLastSettings({ ...defaultSettings.pen, toolName: 'pen' } as ToolArgs);

    expect(lastSavedSettings['rectangular-selection']).toEqual({ toolName: 'rectangular-selection' });
    expect(lastSavedSettings.pen).toEqual({ toolName: 'pen' });
  });

  it('stores figure-tool settings verbatim, without normalizing a legacy figure', () => {
    saveLastSettings({
      ...defaultSettings.ellipse,
      figure: 'circle',
      toolName: 'ellipse',
    } as unknown as ToolArgs);

    // Unlike `shape`/`triangle`/`polygon`, the figure-tool branch skips
    // `normalizeFigure`, so a legacy `circle` figure is stored verbatim here.
    expect((lastSavedSettings.ellipse as { figure: string }).figure).toBe('circle');
  });

  it('merges figure-tool updates over the previously saved settings', () => {
    saveLastSettings({ ...defaultSettings.line, color: '#00ff00', toolName: 'line' });
    saveLastSettings({ ...lastSavedSettings.line, lineWidth: 77 });

    expect(lastSavedSettings.line).toMatchObject({ color: '#00ff00', lineWidth: 77 });
  });

  it('proves the exhaustiveness gap: blur, color, and levels are the only unhandled tool names', () => {
    // `saveLastSettings` is an if/else chain over tool names with no `else` and no `never`
    // exhaustiveness check (src/util/settings.ts:17-68), so an unhandled name is dropped
    // silently and its sliders reset on the next tool switch. The unhandled set is derived
    // from `defaultSettings` rather than hand-listed: adding a tool without a branch fails
    // here with the exact set of unhandled names, and closing the gap fails here too.
    const unhandled = toolNames.filter((toolName) => {
      Reflect.deleteProperty(lastSavedSettings, toolName);
      saveLastSettings({ ...defaultSettings[toolName], toolName } as unknown as ToolArgs);
      return !(toolName in lastSavedSettings);
    });

    expect(unhandled).toEqual(['blur', 'color', 'levels']);
    // The unhandled names are all tunable, so the loss is user-visible, not internal state.
    expect(tunableTools).toEqual(expect.arrayContaining(unhandled));
  });

  it('rejects args without a tool name', () => {
    expect(() => saveLastSettings({} as ToolArgs)).toThrow('Tool name required');
  });
});
