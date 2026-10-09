import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cloneDeep, omit } from 'lodash-es';
import { saveLastSettings } from '../settings.ts';
import { defaultSettings, lastSavedSettings, savedDrawPerPen, savedArgsPerFigure } from '../../tools/settings.ts';
import { isFigureType, normalizeFigure, type FigureType } from '../../tools/shape.ts';
import { AUTO_LEADING, resolveTextStyle, type TextToolArgs } from '../../tools/text.ts';
import type { ToolArgs, ToolArgsFor, ToolName } from '../../contexts/tool-types.ts';
import type { PaintToolArgs } from '../../tools/draw.ts';

/**
 * Adobe's character attributes that arrived after the first version of the text tool. They are
 * OPTIONAL on `TextToolArgs`, so a settings record persisted before they existed still satisfies
 * the type — that is the whole reason this file asserts about a record that LACKS them.
 */
const characterAttributes = ['allCaps', 'smallCaps', 'strikethrough', 'tracking', 'underline'] as const;

/** The resolved values {@link resolveTextStyle} owes a record that carries none of the above. */
const resolvedAttributeDefaults = {
  allCaps: false,
  smallCaps: false,
  strikethrough: false,
  tracking: 0,
  underline: false,
  lineHeight: AUTO_LEADING,
};

/**
 * The text record exactly as `saveLastSettings` persisted it before those five fields existed:
 * the seeded defaults with the later fields omitted, which is the shape a settings object
 * restored from an older build's storage actually has.
 */
const legacyTextArgs = (): TextToolArgs => omit(cloneDeep(defaultSettings.text), ...characterAttributes);

/**
 * Hard-coded copy of the narrowed `FigureType` union. The imported type cannot be
 * enumerated at runtime, so the expectations must be written out literally.
 */
const figureTypes = [
  'line',
  'rectangle',
  'oval',
  'triangle',
  'polygon',
  'star',
] as const satisfies readonly FigureType[];

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

/**
 * Mirrors the read a tool switch performs: `CurrentToolProvider` hands the incoming tool its
 * args by deep-cloning `lastSavedSettings[toolName]` (src/contexts/useCurrentTool.tsx:33-51).
 * Nothing else carries a tool's settings across a switch — `tempUpdateLayer` only writes a
 * transient bitmap preview (src/contexts/useLayer.ts:459) — so this is the only path the
 * settings have to survive.
 */
const switchToTool = <TName extends ToolName>(toolName: TName): ToolArgsFor<TName> => {
  const args = cloneDeep(lastSavedSettings[toolName]) as ToolArgsFor<TName> & { figure?: unknown };
  if (!('figure' in args)) return args as ToolArgsFor<TName>;
  return loadPersistedArgs(args) as ToolArgsFor<TName>;
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

  /**
   * The text arm persists the record verbatim, which is what makes the five character attributes
   * OPTIONAL on `TextToolArgs`: a record written before they existed must stay a valid record.
   * So this pins BOTH directions at once — the attributes are kept when the bar writes them, and
   * the save path does not back-fill the ones it was never given. Back-filling would silently
   * retire the migration in `resolveTextStyle`, and nothing else in the tree would notice.
   */
  it('persists the text character attributes verbatim, and invents none of them', () => {
    saveLastSettings({
      text: 'hello',
      rect: { x1: 0, y1: 0, x2: 100, y2: 50 },
      fontSize: 32,
      lineHeight: 1.8,
      fontFamily: 'Arial',
      color: '#0000ff',
      align: 'center',
      bold: true,
      italic: false,
      allCaps: true,
      smallCaps: true,
      strikethrough: true,
      tracking: -40,
      underline: true,
      toolName: 'text',
    });

    expect(lastSavedSettings.text).toEqual({
      fontSize: 32,
      lineHeight: 1.8,
      fontFamily: 'Arial',
      color: '#0000ff',
      align: 'center',
      bold: true,
      italic: false,
      allCaps: true,
      smallCaps: true,
      strikethrough: true,
      tracking: -40,
      underline: true,
      toolName: 'text',
    });

    saveLastSettings(legacyTextArgs());
    const persisted = lastSavedSettings.text as unknown as Record<string, unknown>;
    for (const attribute of characterAttributes) {
      expect(Object.hasOwn(persisted, attribute)).toBe(false);
    }
    expect(Object.keys(persisted).sort()).toEqual(
      ['align', 'bold', 'color', 'fontFamily', 'fontSize', 'italic', 'lineHeight', 'toolName'].sort()
    );
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

  it('stores crop settings without the pre-ratio rect', () => {
    // `aspectRatio` IS persisted while `rect` is not, so a restored session arrives with a ratio and
    // no rect. A persisted `preRatioRect` would fill that gap from a DIFFERENT document: choosing
    // `Free` would then restore a framing the user never drew on this one. Both are presentation
    // state, and presentation state is exactly what this arm drops.
    saveLastSettings({
      rect: { x1: 0, y1: 0, x2: 100, y2: 100 },
      preRatioRect: { x1: 5, y1: 6, x2: 200, y2: 150 },
      aspectRatio: 1.5,
      toolName: 'crop',
    });

    expect(lastSavedSettings.crop.preRatioRect).toBeUndefined();
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
    const args = { contiguous: true, tolerance: 30, smoothing: 1.5, toolName: 'magic-wand' as const };
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

  it('stores blur settings verbatim', () => {
    const args = { radius: 25, toolName: 'blur' as const };
    saveLastSettings(args);
    expect(lastSavedSettings.blur).toEqual(args);
  });

  it('stores color settings verbatim', () => {
    const args = { grayscale: 30, sepia: 60, saturation: 90, toolName: 'color' as const };
    saveLastSettings(args);
    expect(lastSavedSettings.color).toEqual(args);
  });

  it('stores levels settings verbatim', () => {
    const args = { brightness: -40, contrast: 55, toolName: 'levels' as const };
    saveLastSettings(args);
    expect(lastSavedSettings.levels).toEqual(args);
  });

  it('does not alias the caller args when storing a filter tool', () => {
    const args = { radius: 12, toolName: 'blur' as const };
    saveLastSettings(args);
    expect(lastSavedSettings.blur).not.toBe(args);
  });
});

describe('saveLastSettings across a tool switch', () => {
  beforeEach(() => {
    resetLastSavedSettings();
  });

  afterEach(() => {
    resetLastSavedSettings();
  });

  it('keeps the blur radius when another tool is edited between the two switches', () => {
    saveLastSettings({ radius: 25, toolName: 'blur' });

    // The second save is what loses the value in production: editing the other tool replaces
    // the provider's in-memory args, so the switch back has to read `lastSavedSettings`.
    switchToTool('levels');
    saveLastSettings({ brightness: 40, contrast: -20, toolName: 'levels' });

    expect(switchToTool('blur')).toEqual({ radius: 25, toolName: 'blur' });
    expect(switchToTool('levels')).toEqual({ brightness: 40, contrast: -20, toolName: 'levels' });
  });

  it('keeps every color adjustment when another tool is edited between the two switches', () => {
    saveLastSettings({ grayscale: 30, sepia: 60, saturation: 90, toolName: 'color' });

    switchToTool('blur');
    saveLastSettings({ radius: 8, toolName: 'blur' });

    expect(switchToTool('color')).toEqual({ grayscale: 30, sepia: 60, saturation: 90, toolName: 'color' });
  });

  it('keeps both levels adjustments when another tool is edited between the two switches', () => {
    saveLastSettings({ brightness: -40, contrast: 55, toolName: 'levels' });

    switchToTool('color');
    saveLastSettings({ grayscale: 15, sepia: 0, saturation: 0, toolName: 'color' });

    expect(switchToTool('levels')).toEqual({ brightness: -40, contrast: 55, toolName: 'levels' });
  });

  it('persists a partial update on top of the previously saved filter settings', () => {
    saveLastSettings({ grayscale: 30, sepia: 60, saturation: 90, toolName: 'color' });
    switchToTool('levels');

    saveLastSettings({ grayscale: 75, sepia: 60, saturation: 90, toolName: 'color' });

    expect(switchToTool('color')).toEqual({ grayscale: 75, sepia: 60, saturation: 90, toolName: 'color' });
  });

  it('starts a filter tool from its neutral default when it has never been edited', () => {
    expect(switchToTool('blur')).toEqual({ radius: 0, toolName: 'blur' });
    expect(switchToTool('color')).toEqual({ grayscale: 0, sepia: 0, saturation: 0, toolName: 'color' });
    expect(switchToTool('levels')).toEqual({ brightness: 0, contrast: 0, toolName: 'levels' });
  });
});

/**
 * The Photoshop paint bar publishes every control through `setToolArgs`, which lands
 * in `saveLastSettings` on the same tick (`src/contexts/useCurrentTool.tsx:62`). The
 * paint tools used to share the arm that persists a bare `{ toolName }` with the pen
 * and shape families, so a brush Size change was written and then thrown away before
 * the next tool switch, and the bar re-seeded with every control at `undefined`.
 *
 * These assertions are deliberately about the VALUES and not merely about the key
 * being present: `src/tools/__tests__/tool-settings.test.ts:255-268` already pins
 * that every tool name survives `saveLastSettings`, and it passed happily while the
 * four paint settings were being discarded.
 */
describe('saveLastSettings for the Photoshop paint tools', () => {
  beforeEach(() => {
    resetLastSavedSettings();
  });

  afterEach(() => {
    resetLastSavedSettings();
  });

  const paintArgs = (toolName: 'brush' | 'pencil', overrides: Partial<PaintToolArgs> = {}): ToolArgs =>
    ({ ...defaultSettings[toolName], ...overrides }) as unknown as ToolArgs;

  it.each(['brush', 'pencil'] as const)('persists the %s options the bar writes', (toolName) => {
    saveLastSettings(
      paintArgs(toolName, {
        lineWidth: 77,
        alpha: 0.42,
        smoothing: 63,
        blendMode: 'multiply',
        color: '#ff8800',
      })
    );

    expect(lastSavedSettings[toolName]).toMatchObject({
      lineWidth: 77,
      alpha: 0.42,
      smoothing: 63,
      blendMode: 'multiply',
      color: '#ff8800',
      toolName,
    });
  });

  it.each(['brush', 'pencil'] as const)(
    'keeps the %s Size, Opacity, Smoothing and Mode across a tool switch',
    (toolName) => {
      saveLastSettings(paintArgs(toolName, { lineWidth: 77, alpha: 0.42, smoothing: 63, blendMode: 'difference' }));

      // Editing another tool is what loses the value in production: it replaces the
      // provider's in-memory args, so the switch back has to read `lastSavedSettings`.
      switchToTool('blur');
      saveLastSettings({ radius: 8, toolName: 'blur' });

      expect(switchToTool(toolName)).toMatchObject({
        lineWidth: 77,
        alpha: 0.42,
        smoothing: 63,
        blendMode: 'difference',
        toolName,
      });
    }
  );

  it('empties the stroke geometry, because a stroke is not a setting', () => {
    saveLastSettings(
      paintArgs('brush', {
        points: [
          { x: 1, y: 2 },
          { x: 9, y: 7 },
        ],
      })
    );

    // The same treatment `draw` and `feather-magnetic-lasso` get: the polyline of the
    // stroke that was just committed must not be reseeded into the next one.
    expect(lastSavedSettings.brush.points).toEqual([]);
  });

  it('does not alias the caller args', () => {
    const args = paintArgs('brush', { lineWidth: 33 });
    saveLastSettings(args);

    expect(lastSavedSettings.brush).not.toBe(args);
    expect(lastSavedSettings.brush).toEqual(args);
  });

  it('keeps the color-replacement tool settings too, which the same arm used to discard', () => {
    saveLastSettings({
      ...defaultSettings['color-replacement'],
      lineWidth: 24,
    } as unknown as ToolArgs);

    expect(lastSavedSettings['color-replacement']).toMatchObject({ lineWidth: 24, toolName: 'color-replacement' });
  });

  it('starts each paint tool from its own seeded defaults', () => {
    // Two tools that share a shape but not a scale: the brush and the pencil are the
    // only tools whose options bar would be wrong on a fresh switch if the persisted
    // record were shared rather than per-tool.
    expect(switchToTool('brush')).toEqual({ ...defaultSettings.brush, points: [] });
    expect(switchToTool('pencil')).toEqual({ ...defaultSettings.pencil, points: [] });
    expect(switchToTool('brush').lineWidth).not.toBe(switchToTool('pencil').lineWidth);
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
      // Deliberately NOT the seeded `AUTO_LEADING`, and not one of the five character attributes
      // either: an exact `toEqual` can only prove VERBATIM persistence while the value it pins is
      // a value the save path could not have produced on its own. Once `lineHeight` equalled the
      // default this assertion would have passed against a save path that substituted the default.
      lineHeight: 1.8,
      fontFamily: 'Arial',
      color: '#0000ff',
      align: 'center',
      bold: true,
      italic: false,
      toolName: 'text',
    });

    expect(lastSavedSettings.text).toEqual({
      fontSize: 32,
      lineHeight: 1.8,
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

/**
 * The five character attributes are OPTIONAL on `TextToolArgs` for one reason: `saveLastSettings`
 * persists the text record VERBATIM, so a record written before a field existed comes back with that
 * field absent, and it has to keep working. `resolveTextStyle` is the one place an absent optional
 * becomes a value, and these assertions are what keep it that one place — the alternative is a `?? 0`
 * at each of the eight call sites, and the one that was missed produced a `NaN` line coordinate
 * rather than a visible default.
 *
 * They live here rather than beside `resolveTextStyle` in `src/tools/text.ts` because restoring an
 * old payload is this file's subject: the record under test is the one `lastSavedSettings` hands back
 * after a save and a switch.
 */
describe('a text settings record persisted before the character attributes existed', () => {
  beforeEach(() => {
    resetLastSavedSettings();
  });

  afterEach(() => {
    resetLastSavedSettings();
  });

  it('resolves every absent attribute to a value rather than undefined', () => {
    const style = resolveTextStyle(legacyTextArgs());

    expect(style).toMatchObject(resolvedAttributeDefaults);
    for (const attribute of characterAttributes) {
      expect(style[attribute]).not.toBeUndefined();
    }
  });

  it('does not mutate the record it resolves', () => {
    const args = legacyTextArgs();
    const before = cloneDeep(args);

    const style = resolveTextStyle(args);

    expect(args).toEqual(before);
    for (const attribute of characterAttributes) {
      expect(Object.hasOwn(args, attribute)).toBe(false);
    }
    expect(style).not.toBe(args);
    expect(style.lineHeight).toBe(AUTO_LEADING);
  });

  it('is still attribute-less after a save and a tool switch, and resolves there', () => {
    saveLastSettings(legacyTextArgs());
    const restored = switchToTool('text');

    // The point of the whole arrangement: `saveLastSettings` must not back-fill what it was never
    // given, or the migration below would be dead code on the one path that produces old records.
    for (const attribute of characterAttributes) {
      expect(Object.hasOwn(restored, attribute)).toBe(false);
    }
    expect(resolveTextStyle(restored)).toMatchObject(resolvedAttributeDefaults);
  });

  it('prefers the persisted value over the default when the record does carry one', () => {
    // Without this, a resolver that ignored its input and always returned the defaults would pass
    // every assertion above — the migration would be indistinguishable from a discard.
    const style = resolveTextStyle({
      ...legacyTextArgs(),
      allCaps: true,
      smallCaps: true,
      strikethrough: true,
      tracking: -40,
      underline: true,
    });

    expect(style).toMatchObject({
      ...resolvedAttributeDefaults,
      allCaps: true,
      smallCaps: true,
      strikethrough: true,
      tracking: -40,
      underline: true,
    });
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
    expect(savedDrawPerPen.spray).toMatchObject({ alpha: 0.5, flow: 50, lineWidth: 100 });
  });

  it('savedArgsPerFigure has entries for all figure types', () => {
    for (const figure of ['line', 'rectangle', 'oval', 'triangle', 'polygon', 'star'] as const) {
      expect(savedArgsPerFigure[figure]).toMatchObject({ alpha: 1, lineWidth: 5 });
    }
  });

  it('savedArgsPerFigure has no legacy circle or square entries', () => {
    expect(Object.keys(savedArgsPerFigure).sort()).toEqual([
      'line',
      'oval',
      'polygon',
      'rectangle',
      'star',
      'triangle',
    ]);
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
      if (figure === 'star') {
        expect(defaultSettings.shape).toMatchObject({
          sides: savedArgsPerFigure.star.sides,
          starRatio: savedArgsPerFigure.star.starRatio,
        });
        continue;
      }

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
      // Adobe's default leading is Auto, and auto-leading is 120% of the type size:
      // `JustificationProperties.autoLeadingAmount` defaults to `120`
      // (https://developer.adobe.com/photoshop/uxp/2022/ps_reference/objects/options/justificationproperties/).
      // `lineHeight` is a ratio here rather than an absolute distance, so `AUTO_LEADING` carries
      // the 120% and the semantics stay divergent. The 1.1 this replaced was neither.
      lineHeight: AUTO_LEADING,
      fontFamily: 'Arial',
      color: '#000000',
      text: '',
      align: 'left',
      // The five character attributes are OPTIONAL in the type so that a record persisted before
      // they existed still compiles, but the SEED has to carry them: the options bar reads them,
      // and a bar that showed nothing on a fresh switch would be indistinguishable from a bar
      // failing to read them.
      allCaps: false,
      smallCaps: false,
      strikethrough: false,
      tracking: 0,
      underline: false,
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
    expect(defaultSettings['rectangular-selection']).toEqual({
      style: 'normal',
      fixedRatio: 1,
      fixedWidth: 100,
      fixedHeight: 100,
      toolName: 'rectangular-selection',
    });
    expect(defaultSettings['feather-magnetic-lasso']).toMatchObject({
      featherRadius: 12,
      magneticWidth: 18,
      toolName: 'feather-magnetic-lasso',
    });
  });

  /**
   * `toMatchObject` above is deliberately partial — it cannot notice a field that was dropped from
   * the seed or one that arrived uninvited. This is the exhaustive companion for the text record
   * alone, written out literally for the same reason `figureTypes` is: it pins the seed's whole key
   * set, so a fifth character attribute cannot be added to `defaultSettings.text` and go unpinned.
   */
  it('seeds the text record with exactly these keys', () => {
    expect(Object.keys(defaultSettings.text).sort()).toEqual(
      [
        'align',
        'allCaps',
        'bold',
        'color',
        'fontFamily',
        'fontSize',
        'italic',
        'kind',
        'lineHeight',
        'rect',
        'smallCaps',
        'strikethrough',
        'text',
        'toolName',
        'tracking',
        'underline',
      ].sort()
    );
  });
});
