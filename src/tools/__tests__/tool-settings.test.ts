import { beforeEach, describe, expect, it } from 'vitest';
import { cloneDeep } from 'lodash-es';

import { defaultSettings, lastSavedSettings, savedArgsPerFigure, savedDrawPerPen } from '../settings.ts';
import { findToolProcessor, PIXEL_FREE_TOOLS } from '../toolProcessors.ts';
import { saveLastSettings } from '../../util/settings.ts';
import { COLOR_REPLACEMENT_SMOOTHNESS_MAX, COLOR_REPLACEMENT_TOLERANCE_MAX } from '../colorReplacement.ts';
import { createMockImageBitmap } from '../../__tests__/fixtures/canvas.ts';
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
  it('declares an entry for every tool, and a processor or a pixel-free declaration for each', () => {
    // `defaultSettings` is `satisfies ToolArgsByName`, so the compile-time half of the coverage
    // contract is already enforced; this is the runtime half. The eyedropper has settings but no
    // processor, which is the one shape where the two key sets differ, so the two are checked
    // against each other rather than against a hand-written list.
    const processorNames = toolNames.filter((toolName) => findToolProcessor(toolName) !== undefined);
    const pixelFree = toolNames.filter((toolName) => findToolProcessor(toolName) === undefined);

    expect(pixelFree.sort()).toEqual([...PIXEL_FREE_TOOLS].sort());
    expect([...processorNames, ...pixelFree].sort()).toEqual([...toolNames].sort());
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

  it('keeps the point list out of every saved stroke-tool setting, and keeps the rest', () => {
    // The four new brush-shaped tools all persist through the arm in
    // `src/util/settings.ts` that empties `points`. A stroke is geometry, not a setting,
    // so reseeding it would hand the next drag the previous one. The settings that ride
    // alongside it have to survive, which is the part the `never` sentinel cannot see:
    // it only catches a missing arm, never a wrong one.
    const stroke = [
      { x: 1, y: 2 },
      { x: 9, y: 7 },
    ];

    saveLastSettings({ ...defaultSettings.smudge, strength: 80, points: stroke });
    saveLastSettings({ ...defaultSettings.dodge, exposure: 20, points: stroke });
    saveLastSettings({ ...defaultSettings.burn, exposure: 30, points: stroke });
    saveLastSettings({ ...defaultSettings['clone-stamp'], alpha: 0.5, points: stroke });

    expect(lastSavedSettings.smudge).toMatchObject({ strength: 80, points: [], toolName: 'smudge' });
    expect(lastSavedSettings.dodge).toMatchObject({ exposure: 20, points: [], toolName: 'dodge' });
    expect(lastSavedSettings.burn).toMatchObject({ exposure: 30, points: [], toolName: 'burn' });
    // A clone-stamp source point is a setting, not geometry, so it is persisted.
    expect(lastSavedSettings['clone-stamp']).toMatchObject({
      alpha: 0.5,
      points: [],
      source: null,
      toolName: 'clone-stamp',
    });
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

  it('persists every registered tool name, so the chain cannot drop one', () => {
    // `saveLastSettings` is an if/else chain over tool names. An unhandled name is dropped
    // silently, so the tool's sliders reset on the next switch — the shape of the bug this
    // contract exists to close. The chain ends in a `never` sentinel (src/util/settings.ts), which
    // fails `npm run tsc` on a missing arm; this is the runtime counterpart. Both derive the set
    // from `defaultSettings` rather than hand-listing it, so neither can drift.
    const unhandled = toolNames.filter((toolName) => {
      Reflect.deleteProperty(lastSavedSettings, toolName);
      saveLastSettings({ ...defaultSettings[toolName], toolName } as unknown as ToolArgs);
      return !(toolName in lastSavedSettings);
    });

    expect(unhandled).toEqual([]);
  });

  it('rejects args without a tool name', () => {
    expect(() => saveLastSettings({} as ToolArgs)).toThrow('Tool name required');
  });
});

const penPresets: readonly [PenType, Record<string, unknown>][] = [
  ['pen', { alpha: 0.9, lineWidth: 10 }],
  ['pen-dashed', { alpha: 0.9, lineWidth: 10, lineDash: [5, 30] }],
  ['spray', { alpha: 0.5, lineWidth: 100 }],
];

const figurePresets: readonly [FigureType, Record<string, unknown>][] = [
  ['line', { alpha: 1, lineWidth: 5, lineCap: 'butt', toolMode: 'shape' }],
  ['rectangle', { alpha: 1, lineWidth: 5, cornerRadius: 0, toolMode: 'shape' }],
  ['oval', { alpha: 1, lineWidth: 5, cornerRadius: 0, toolMode: 'shape' }],
  ['triangle', { alpha: 1, lineWidth: 5, toolMode: 'shape' }],
  ['polygon', { alpha: 1, lineWidth: 5, toolMode: 'shape' }],
];

/** Walks nested settings values (e.g. `reposition.move`) looking for non-finite numbers. */
const nonFiniteNumbers = (value: unknown, path: string): [string, number][] => {
  if (typeof value === 'number') return Number.isFinite(value) ? [] : [[path, value]];
  if (!value || typeof value !== 'object') return [];

  return Object.entries(value as Record<string, unknown>).flatMap(([key, nested]) =>
    nonFiniteNumbers(nested, `${path}.${key}`)
  );
};

describe('defaultSettings preset tables', () => {
  it.each(penPresets)('pins the %s pen preset exactly', (penType, preset) => {
    expect(savedDrawPerPen[penType]).toEqual(preset);
  });

  it.each(figurePresets)('pins the %s figure preset exactly', (figure, preset) => {
    expect(savedArgsPerFigure[figure]).toEqual(preset);
  });

  it('covers every pen and figure union member with exactly one preset', () => {
    expect(Object.keys(savedDrawPerPen).sort()).toEqual(penPresets.map(([penType]) => penType).sort());
    expect(Object.keys(savedArgsPerFigure).sort()).toEqual(figurePresets.map(([figure]) => figure).sort());
  });

  it('seeds the draw tool from the plain-pen preset', () => {
    expect(defaultSettings.draw).toMatchObject({ ...savedDrawPerPen.pen, penType: 'pen', toolName: 'draw' });
    expect(defaultSettings.draw.points).toEqual([]);
  });
});

describe('defaultSettings value sanity', () => {
  it('seeds every number with a finite value, so no filter or geometry can be poisoned at the source', () => {
    const bad: [string, number][] = [];

    for (const toolName of toolNames) {
      bad.push(...nonFiniteNumbers(defaultSettings[toolName], toolName));
    }

    expect(bad).toEqual([]);
  });

  it('keeps every declared alpha inside the 0..1 range a canvas globalAlpha accepts', () => {
    const alphas = toolNames
      .filter((toolName) => 'alpha' in defaultSettings[toolName])
      .map((toolName) => [toolName, (defaultSettings[toolName] as { alpha: number }).alpha] as const);

    expect(alphas.length).toBeGreaterThan(0);
    for (const [toolName, alpha] of alphas) {
      expect(alpha, toolName).toBeGreaterThanOrEqual(0);
      expect(alpha, toolName).toBeLessThanOrEqual(1);
    }
  });

  it('seeds every non-null colour as a six-digit hex string', () => {
    for (const toolName of toolNames) {
      const settings = defaultSettings[toolName] as { color?: unknown; backgroundColor?: unknown };
      for (const key of ['color', 'backgroundColor'] as const) {
        const value = settings[key];
        if (value === undefined || value === null) continue;
        expect(value, `${toolName}.${key}`).toMatch(/^#[0-9A-Fa-f]{6}$/);
      }
    }
  });

  it('leaves only the rect-bearing tools with a null rect', () => {
    const withNullRect = toolNames.filter((toolName) => {
      const settings = defaultSettings[toolName] as { rect?: unknown };
      return settings.rect === null;
    });

    expect(withNullRect.sort()).toEqual(['crop', 'text']);
  });

  it('reduces every unimplemented tool to a bare tool name, matching its null result', () => {
    for (const toolName of toolNames) {
      if (findToolProcessor(toolName)?.commit !== 'unimplemented') continue;

      expect(defaultSettings[toolName], toolName).toEqual({ toolName });
    }
  });
});

describe('defaultSettings assumptions baked into the registry', () => {
  it('seeds each paint tool with the penType its registry adapter forces', () => {
    // toolProcessors.ts forces `pen` for brush (:166) and pencil (:174). If a default disagreed,
    // the forced value would silently override the user's own setting instead of confirming it.
    // `color-replacement` is no longer a paint tool and has no `penType` at all: it used to be
    // pinned to `'spray'` here, and that pin is what a paint-over could never satisfy.
    expect(defaultSettings.brush.penType).toBe('pen');
    expect(defaultSettings.pencil.penType).toBe('pen');
    expect(defaultSettings['color-replacement']).not.toHaveProperty('penType');
  });

  it('seeds the Color Replacement controls with Adobe’s own defaults', () => {
    // The controls that used to exist only as prose on a TODO card
    // (`toolbarPlaceholderConfig.ts:4`). Tolerance 30 and Smoothness 10 are Adobe's, on 0-100 and
    // 0-50 scales respectively, and Limits opens on Contiguous.
    expect(defaultSettings['color-replacement']).toMatchObject({
      tolerance: 30,
      smoothness: 10,
      limits: 'contiguous',
      sampling: 'current-layer',
      sampleColor: null,
    });
    expect(defaultSettings['color-replacement'].tolerance).toBeLessThanOrEqual(COLOR_REPLACEMENT_TOLERANCE_MAX);
    expect(defaultSettings['color-replacement'].smoothness).toBeLessThanOrEqual(COLOR_REPLACEMENT_SMOOTHNESS_MAX);
  });

  it('seeds the pencil width with the same fallback the adapter applies when it is absent', () => {
    // toolProcessors.ts:175 does `Math.max(1, Number(lineWidth ?? 3))`; a default other
    // than 3 would make the fallback reachable only for hand-built args.
    expect(defaultSettings.pencil.lineWidth).toBe(3);
    expect(defaultSettings.brush.lineWidth).toBe(10);
    expect(defaultSettings['color-replacement'].lineWidth).toBe(18);
  });

  it('turns the transform defaults into a pure no-op through the registry', () => {
    const size = { width: 40, height: 24 };
    const result = findToolProcessor('transform')!.imageProcessor({ size, bitmap: createMockImageBitmap(40, 24) })(
      defaultSettings.transform as never
    );

    // No position patch at all: the identity affine leaves the bounding box untouched.
    expect(result).toHaveLength(1);
    expect(result[0].width).toBe(size.width);
    expect(result[0].height).toBe(size.height);
  });

  it('is the one default set the crop processor cannot consume as-is (src/tools/crop.ts:17)', () => {
    // Every other tool runs on its seeded defaults; crop destructures `rect!` and the
    // seeded rect is null, so the document-operation commit needs a real rect first.
    expect(defaultSettings.crop.rect).toBeNull();
    expect(() =>
      findToolProcessor('crop')!.imageProcessor({
        size: { width: 40, height: 24 },
        bitmap: createMockImageBitmap(40, 24),
      })(defaultSettings.crop as never)
    ).toThrow(TypeError);
  });

  it('feeds the remaining settings straight into the composed CSS filters', () => {
    // The adjustment defaults must be the identity of their own filter strings, otherwise
    // a freshly selected tool would visibly alter the layer before the user touches it.
    expect(defaultSettings.blur.radius).toBe(0);
    expect(defaultSettings.color).toMatchObject({ grayscale: 0, sepia: 0, saturation: 0 });
    expect(defaultSettings.levels).toMatchObject({ brightness: 0, contrast: 0 });
  });
});

describe('lastSavedSettings shape', () => {
  it('mirrors the default key set, with each entry stamped by its own key', () => {
    expect(Object.keys(lastSavedSettings).sort()).toEqual([...toolNames].sort());

    for (const toolName of toolNames) {
      expect(lastSavedSettings[toolName].toolName, toolName).toBe(toolName);
    }
  });

  it('does not share nested object references with the defaults it was cloned from', () => {
    expect(lastSavedSettings.reposition.move).not.toBe(defaultSettings.reposition.move);
    expect(lastSavedSettings.reposition.move).toEqual(defaultSettings.reposition.move);
  });
});
