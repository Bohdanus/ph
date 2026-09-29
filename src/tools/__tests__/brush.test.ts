import { describe, expect, it } from 'vitest';

import {
  clampPaintSize,
  CUSTOM_PRESET_LABEL,
  isPaintBlendMode,
  matchPaintPreset,
  PAINT_BLEND_MODES,
  PAINT_PRESETS,
  PAINT_SIZE_MAX,
  PAINT_SIZE_MIN,
  PAINT_SMOOTHING_DEFAULT,
  smoothStrokePoints,
} from '../brush.ts';
import { defaultSettings } from '../settings.ts';
import type { PaintPreset, PaintSettings } from '../brush.ts';
import type { Point } from '../../contexts/general-types.ts';

/**
 * `src/tools/brush.ts` is the contract behind the Photoshop options bar the paint tools
 * (brush, pencil, colour replacement) render, and it is pure: no React, no canvas, no
 * I/O. Everything a stroke actually renders is decided by the numbers in that module,
 * so these tests pin the values themselves rather than the pixels they produce, and they
 * pin the *identity* results as well as the values — that is the part a later refactor
 * silently breaks.
 *
 * Three things are load-bearing enough to be worth a tripwire each:
 *
 * - `smoothStrokePoints` returns the *same array instance* at no smoothing
 *   (src/tools/brush.ts:103). `drawLine` compares by identity to decide whether to reuse
 *   the caller's args or allocate a copy (src/util/draw.ts:96-97), so returning an equal
 *   but fresh array would change what every unpinned stroke renders from. Asserted with
 *   `toBe`, never `toEqual`.
 * - `smoothStrokePoints` pins the first and last samples (src/tools/brush.ts:105,116).
 *   The stroke is one `ctx.stroke()` over the whole polyline
 *   (src/util/draw.ts:110-113); moving an endpoint would put the visible start and end
 *   of every smoothed stroke somewhere the pointer never was.
 * - `isPaintBlendMode` is a closed set (src/tools/brush.ts:51-52). `toolLayerBlendMode`
 *   reads a mode back off stored history and falls back to Normal for anything outside
 *   it (src/contexts/layer-utils.ts:155-158), so a mode this renderer cannot composite
 *   has to be rejected there rather than reaching the canvas, which ignores unknown
 *   `globalCompositeOperation` values silently.
 *
 * The blend-mode list itself is pinned exhaustively below, from the source of truth rather
 * than from memory, because the browser copy is not always run: the e2e suite also copies
 * all sixteen entries and asserts the rendered `<option>` list equals its own
 * (e2e/paint-options.spec.ts). What is pinned here beyond that copy is the set of properties
 * it cannot see: distinctness, the leading Normal, and rejection of everything else.
 */

/** The four values the bar carries a preset snapshot of, plus the `Custom` bar's identity. */
type BarSettings = { lineWidth: number; alpha: number } & PaintSettings;

/**
 * Five samples with a hard corner at index 2, so one interior sample has a midpoint far
 * enough away to measure: (10,40) and (50,0) average to (30,20), so index 2 travels
 * `smoothing/100 * 10` in x and `smoothing/100 * 20` in y. Every coordinate is a small
 * dyadic rational, so the exactness assertions at 100 are float-exact rather than
 * approximate.
 */
const cornerPath: Point[] = [
  { x: 0, y: 0 },
  { x: 10, y: 40 },
  { x: 20, y: 0 },
  { x: 50, y: 0 },
  { x: 60, y: 0 },
];

/** The longest path used for the full-pull test: three interior samples, two of them non-trivial. */
const zigzagPath: Point[] = [
  { x: 0, y: 0 },
  { x: 10, y: 30 },
  { x: 40, y: -5 },
  { x: 45, y: 25 },
  { x: 80, y: 80 },
];

/** Distance the sample at `index` was pulled from where it was sampled. */
const displacement = (points: readonly Point[], smoothed: readonly Point[], index: number): number =>
  Math.hypot(smoothed[index].x - points[index].x, smoothed[index].y - points[index].y);

const brushPresets: readonly PaintPreset[] = PAINT_PRESETS.brush;
const pencilPresets: readonly PaintPreset[] = PAINT_PRESETS.pencil;

/** The four values of the brush's opening preset, reused as the base for every mismatch case. */
const hardRound: BarSettings = { lineWidth: 10, alpha: 1, smoothing: 0, blendMode: 'source-over' };

/** Every value the bar can be in when nothing has been edited, i.e. what a preset match is. */
const anyBarSettings: BarSettings = { lineWidth: 24, alpha: 0.5, smoothing: 30, blendMode: 'multiply' };

describe('smoothStrokePoints', () => {
  it('leaves the sampled path untouched at 0%', () => {
    // Identity, not equality: `drawLine` branches on `points === sampled`
    // (src/util/draw.ts:96-97) to avoid allocating a new args object, so returning an
    // equal-but-fresh array would silently add an allocation to every legacy `draw`
    // stroke and to every stroke whose bar has never been touched.
    expect(smoothStrokePoints(zigzagPath, 0)).toBe(zigzagPath);
  });

  it('leaves the sampled path untouched at a negative smoothing, which clamps to no pull', () => {
    // `clampPercent` (src/tools/brush.ts:68) floors at 0, so a negative bar value - a
    // corrupted or hand-edited settings blob - degrades to the un-smoothed stroke
    // rather than reversing the pull.
    expect(smoothStrokePoints(zigzagPath, -20)).toBe(zigzagPath);
  });

  it.each([
    ['a negative fraction', -0.5],
    ['NaN', Number.NaN],
    ['positive Infinity', Number.POSITIVE_INFINITY],
    ['negative Infinity', Number.NEGATIVE_INFINITY],
  ])('leaves the sampled path untouched at %s', (_name, smoothing) => {
    // `clampPercent` guards on `Number.isFinite` *before* it clamps
    // (src/tools/brush.ts:68), so every non-finite input takes the `: 0` branch and is
    // an identity - Infinity included. A stroke can therefore never be handed a NaN
    // coordinate by a NaN control value, and the pixels are the pre-smoothing ones.
    expect(smoothStrokePoints(zigzagPath, smoothing)).toBe(zigzagPath);
  });

  it.each([0, 1, 2])('leaves a %i-sample path untouched at a full pull, there being no interior sample', (length) => {
    // A single sample is a dot and two are a segment; neither has a point with both
    // neighbours, so the filter has nothing to do. Length 0 is the `drawLine` case
    // before the first pointer event (src/util/draw.ts:95).
    const short: Point[] = Array.from({ length }, (_, i) => ({ x: i, y: i * 2 }));
    expect(smoothStrokePoints(short, 100)).toBe(short);
  });

  it('snaps every interior sample exactly onto the midpoint of its neighbours at 100%', () => {
    const smoothed = smoothStrokePoints(zigzagPath, 100);

    expect(smoothed).not.toBe(zigzagPath);
    expect(smoothed).toHaveLength(zigzagPath.length);
    for (let i = 1; i < zigzagPath.length - 1; i++) {
      const previous = zigzagPath[i - 1];
      const next = zigzagPath[i + 1];
      expect(smoothed[i].x, `sample ${i} x must be the midpoint of its neighbours`).toBe((previous.x + next.x) / 2);
      expect(smoothed[i].y, `sample ${i} y must be the midpoint of its neighbours`).toBe((previous.y + next.y) / 2);
    }
  });

  it('pins the first and last samples to where they were sampled at 100%', () => {
    // The endpoints are the two places a smoothed stroke must not move: they are what
    // `ctx.moveTo` starts from and what the tail of the polyline ends at
    // (src/util/draw.ts:110-113), so shifting them would put the visible start and end
    // of the stroke off the pointer path.
    const smoothed = smoothStrokePoints(zigzagPath, 100);

    expect(smoothed[0].x).toBe(zigzagPath[0].x);
    expect(smoothed[0].y).toBe(zigzagPath[0].y);

    const last = zigzagPath.length - 1;
    expect(smoothed[last].x).toBe(zigzagPath[last].x);
    expect(smoothed[last].y).toBe(zigzagPath[last].y);
  });

  it('leaves a collinear evenly-spaced path unchanged even at 100%', () => {
    // A straight drag is the common case and every interior sample of it is already its
    // neighbours' midpoint, so a fully smoothed straight line must come out identical
    // rather than being dragged around by floating-point noise.
    const straight: Point[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 0 },
    ];
    const smoothed = smoothStrokePoints(straight, 100);

    expect(smoothed).toEqual(straight);
    expect(smoothed).not.toBe(straight);
  });

  it('leaves a four-sample collinear path unchanged at any interior sample', () => {
    const straight: Point[] = [
      { x: 0, y: 0 },
      { x: 10, y: 20 },
      { x: 20, y: 40 },
      { x: 30, y: 60 },
    ];
    expect(smoothStrokePoints(straight, 100)).toEqual(straight);
  });

  it('pulls a sample monotonically further from its sampled position as smoothing rises', () => {
    const readings = [0, 25, 50, 75, 100].map((smoothing) => {
      const smoothed = smoothStrokePoints(cornerPath, smoothing);
      return displacement(cornerPath, smoothed, 2);
    });

    for (const [i, smoothing] of [25, 50, 75, 100].entries()) {
      // The corner's midpoint is (30,20) and the sample sits at (20,0), so the travel is
      // `pull * hypot(10, 20)`: linear in the slider, which is what makes the bar's
      // percentage mean something.
      expect(readings[i + 1], `displacement at ${smoothing}%`).toBeCloseTo((smoothing / 100) * Math.hypot(10, 20), 10);
    }
    for (let i = 1; i < readings.length; i++) {
      expect(readings[i], 'each step up in smoothing must move the sample further').toBeGreaterThan(readings[i - 1]);
    }
  });

  it('sits between the unsmoothed and fully snapped positions at an intermediate value', () => {
    const half = smoothStrokePoints(cornerPath, 50);

    expect(displacement(cornerPath, half, 2)).toBeGreaterThan(0);
    expect(displacement(cornerPath, half, 2)).toBeLessThan(
      displacement(cornerPath, smoothStrokePoints(cornerPath, 100), 2)
    );
    expect(half[2]).toEqual({ x: 25, y: 10 });
  });

  it('never mutates the sampled path it was given', () => {
    // The caller's points are the history entry's own samples
    // (`params.args.points`, src/util/draw.ts:95-96), so a write here would corrupt the
    // stroke that undo has to put back.
    const before = structuredClone(cornerPath);

    const smoothed = smoothStrokePoints(cornerPath, 50);

    expect(cornerPath).toEqual(before);
    expect(smoothed).not.toBe(cornerPath);
  });

  it('clamps a smoothing above 100 to a full pull', () => {
    expect(smoothStrokePoints(cornerPath, 150)).toEqual(smoothStrokePoints(cornerPath, 100));
    expect(smoothStrokePoints(cornerPath, 1000)).toEqual(smoothStrokePoints(cornerPath, 100));
  });

  it('clamps a smoothing below 0 to no pull at all', () => {
    expect(smoothStrokePoints(cornerPath, -0.5)).toBe(cornerPath);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -20, 0, 25, 100, 150])(
    'produces only finite coordinates at smoothing %s',
    (smoothing) => {
      for (const point of smoothStrokePoints(zigzagPath, smoothing)) {
        expect(Number.isFinite(point.x)).toBe(true);
        expect(Number.isFinite(point.y)).toBe(true);
      }
    }
  );
});

describe('isPaintBlendMode', () => {
  it.each(PAINT_BLEND_MODES.map((mode) => mode.value))('accepts the supported mode %s', (value) => {
    expect(isPaintBlendMode(value)).toBe(true);
  });

  const rejected: readonly [string, unknown][] = [
    ['Dissolve, a Photoshop mode the canvas has no equivalent for', 'Dissolve'],
    ['the source-atop separator token', 'source-atop'],
    ['an erasing mode', 'destination-out'],
    ['the empty string', ''],
    ['undefined', undefined],
    ['null', null],
    ['a number', 42],
    ['a plain object', {}],
    ['an object carrying a valid value field', { value: 'multiply' }],
    ['a Photoshop label rather than a canvas value', 'Multiply'],
    ['a valid value with trailing whitespace', 'multiply '],
  ];

  it.each(rejected)('rejects %s', (_name, value) => {
    // Rejection is what makes `toolLayerBlendMode` fall back to Normal
    // (src/contexts/layer-utils.ts:155-158). The canvas ignores an unknown
    // `globalCompositeOperation` without erroring, so a value that got through would
    // commit a layer the user believes is blended and that renders as plain source-over.
    expect(isPaintBlendMode(value)).toBe(false);
  });

  it('does not accept a value that merely contains a supported mode', () => {
    expect(isPaintBlendMode('multiply-overlay')).toBe(false);
  });
});

describe('PAINT_BLEND_MODES', () => {
  it('declares exactly the sixteen canvas modes, in the order the Mode dropdown lists them', () => {
    // The exhaustive copy of this list used to live only in a Playwright spec, which the
    // jsdom suite never runs, so every property assertion below survives a substitution: a
    // value the canvas silently ignores still has a distinct string and still pairs with a
    // distinct label, and one entry swapped for another is still sixteen distinct entries.
    // `layer-utils.ts` reads one of these values back off stored history, so the values are
    // data, not presentation, and they are pinned here rather than in a browser.
    expect(PAINT_BLEND_MODES).toEqual([
      { label: 'Normal', value: 'source-over' },
      { label: 'Darken', value: 'darken' },
      { label: 'Multiply', value: 'multiply' },
      { label: 'Color Burn', value: 'color-burn' },
      { label: 'Lighten', value: 'lighten' },
      { label: 'Screen', value: 'screen' },
      { label: 'Color Dodge', value: 'color-dodge' },
      { label: 'Overlay', value: 'overlay' },
      { label: 'Soft Light', value: 'soft-light' },
      { label: 'Hard Light', value: 'hard-light' },
      { label: 'Difference', value: 'difference' },
      { label: 'Exclusion', value: 'exclusion' },
      { label: 'Hue', value: 'hue' },
      { label: 'Saturation', value: 'saturation' },
      { label: 'Color', value: 'color' },
      { label: 'Luminosity', value: 'luminosity' },
    ]);
  });

  it('declares every value as a distinct non-empty string', () => {
    const values = PAINT_BLEND_MODES.map((mode) => mode.value);

    expect(new Set(values).size).toBe(values.length);
    for (const value of values) {
      expect(typeof value).toBe('string');
      expect(value.length).toBeGreaterThan(0);
    }
  });

  it('declares every label as distinct and non-empty', () => {
    const labels = PAINT_BLEND_MODES.map((mode) => mode.label);

    expect(new Set(labels).size).toBe(labels.length);
    for (const label of labels) {
      expect(typeof label).toBe('string');
      expect(label.length).toBeGreaterThan(0);
    }
  });

  it('opens with Normal, the mode a layer composites under by default', () => {
    // Also the fallback `toolLayerBlendMode` returns for an unrecognised mode, and what
    // `defaultSettings.brush` seeds (src/tools/settings.ts:122), so it has to be first
    // and has to be `source-over`.
    expect(PAINT_BLEND_MODES[0]).toEqual({ label: 'Normal', value: 'source-over' });
  });

  it.each(['Multiply', 'Screen', 'Overlay', 'Difference', 'Hue', 'Saturation', 'Color', 'Luminosity'])(
    'offers the Photoshop mode %s',
    (label) => {
      // The eight names a user looks for by heart. The e2e suite drives every entry in
      // the list through the Mode select (e2e/paint-options.spec.ts:308-310) and checks
      // Multiply's pixels (e2e/paint-options.spec.ts:265); this pins that dropping one
      // of the recognisable names fails here rather than waiting for a browser.
      expect(PAINT_BLEND_MODES.some((mode) => mode.label === label)).toBe(true);
    }
  );

  it('pairs every label with a value the guard accepts', () => {
    for (const mode of PAINT_BLEND_MODES) {
      expect(isPaintBlendMode(mode.value), `label "${mode.label}"`).toBe(true);
    }
  });
});

describe('PAINT_PRESETS', () => {
  const tools = ['brush', 'pencil'] as const;
  const presetsFor = (tool: (typeof tools)[number]): readonly PaintPreset[] => PAINT_PRESETS[tool];

  it.each(tools)('gives %s a non-empty preset list with no duplicate labels', (tool) => {
    const presets = presetsFor(tool);
    const labels = presets.map((preset) => preset.label);

    expect(presets.length).toBeGreaterThan(0);
    // The picker renders labels as `<option key={preset.label} value={preset.label}>`
    // (src/components/ToolbarsRight/Paint/Paint.tsx:146-150), so a duplicate label
    // would make React drop one option and the user unable to pick it back.
    expect(new Set(labels).size).toBe(labels.length);
  });

  it.each(tools)('keeps every %s preset inside the ranges the bar can express', (tool) => {
    for (const preset of presetsFor(tool)) {
      const at = `${tool} preset "${preset.label}"`;
      expect(preset.lineWidth, at).toBeGreaterThanOrEqual(PAINT_SIZE_MIN);
      expect(preset.lineWidth, at).toBeLessThanOrEqual(PAINT_SIZE_MAX);
      expect(preset.alpha, at).toBeGreaterThan(0);
      expect(preset.alpha, at).toBeLessThanOrEqual(1);
      expect(preset.smoothing, at).toBeGreaterThanOrEqual(0);
      expect(preset.smoothing, at).toBeLessThanOrEqual(100);
      expect(isPaintBlendMode(preset.blendMode), at).toBe(true);
    }
  });

  it('opens the brush on a preset that carries the seeded brush size and mode', () => {
    // `defaultSettings.brush` seeds lineWidth 10 and Normal
    // (src/tools/settings.ts:115-124), and `Hard Round` is that same 10px tip in that
    // same mode. Its alpha is the fully opaque 1, deliberately not the seeded 0.9 - a
    // named tip is a solid mark, where the seeded bar is a light default stroke - so the
    // seeded bar is not the same state as the opening preset.
    expect(PAINT_PRESETS.brush[0].lineWidth).toBe(defaultSettings.brush.lineWidth);
    expect(PAINT_PRESETS.brush[0].blendMode).toBe(defaultSettings.brush.blendMode);
    expect(PAINT_PRESETS.brush[0].alpha).not.toBe(defaultSettings.brush.alpha);
    expect(PAINT_PRESETS.pencil[0].lineWidth).toBe(defaultSettings.pencil.lineWidth);
  });

  it('pins the opening brush preset exactly', () => {
    expect(PAINT_PRESETS.brush[0]).toEqual({
      label: 'Hard Round',
      lineWidth: 10,
      alpha: 1,
      smoothing: 0,
      blendMode: 'source-over',
    });
  });

  it('seeds both paint tools with the Photoshop smoothing default', () => {
    // The bar's Smoothing readout is 10% on first load for the brush and the pencil
    // (src/tools/settings.ts:121,131), which the e2e suite reads as an accessible name
    // (e2e/paint-options.spec.ts:28-31,180-182).
    expect(defaultSettings.brush.smoothing).toBe(PAINT_SMOOTHING_DEFAULT);
    expect(defaultSettings.pencil.smoothing).toBe(PAINT_SMOOTHING_DEFAULT);
  });

  it('opens each tool on its own preset, so a pencil user never sees a brush tip name', () => {
    // The two lists are rendered from the same component and the same `PAINT_PRESETS`
    // index, so sharing an opening label would show `Hard Round` on the pencil bar.
    expect(brushPresets[0].label).toBe('Hard Round');
    expect(pencilPresets[0].label).toBe('Hard Pencil');
    expect(brushPresets.map((preset) => preset.label)).not.toContain(pencilPresets[0].label);
  });
});

describe('matchPaintPreset', () => {
  const everyPreset: readonly [string, readonly PaintPreset[], BarSettings][] = [
    ...PAINT_PRESETS.brush.map((preset): [string, readonly PaintPreset[], BarSettings] => [
      preset.label,
      brushPresets,
      { lineWidth: preset.lineWidth, alpha: preset.alpha, smoothing: preset.smoothing, blendMode: preset.blendMode },
    ]),
    ...PAINT_PRESETS.pencil.map((preset): [string, readonly PaintPreset[], BarSettings] => [
      preset.label,
      pencilPresets,
      { lineWidth: preset.lineWidth, alpha: preset.alpha, smoothing: preset.smoothing, blendMode: preset.blendMode },
    ]),
  ];

  it.each(everyPreset)('names %s when all four settings match it', (label, presets, settings) => {
    expect(matchPaintPreset(presets, settings)).toBe(label);
  });

  const mismatches: readonly [string, BarSettings][] = [
    ['only lineWidth differs', { ...hardRound, lineWidth: 11 }],
    ['only alpha differs', { ...hardRound, alpha: 0.9 }],
    ['only smoothing differs', { ...hardRound, smoothing: 10 }],
    ['only blendMode differs', { ...hardRound, blendMode: 'multiply' }],
    ['all four differ', { lineWidth: 11, alpha: 0.9, smoothing: 10, blendMode: 'multiply' }],
  ];

  it.each(mismatches)('returns the empty string when %s', (_name, settings) => {
    // The empty string is the picker's `Custom` option
    // (src/components/ToolbarsRight/Paint/Paint.tsx:142-145), so a hand-tuned bar says
    // Custom rather than claiming the name of a tip it is not. All four fields are part
    // of the comparison: dropping the blend mode from it would label a Multiply stroke
    // `Hard Round`.
    expect(matchPaintPreset([{ label: 'Hard Round', ...hardRound }], settings)).toBe('');
  });

  it('names the Custom option the empty string renders as', () => {
    expect(CUSTOM_PRESET_LABEL).toBe('Custom');
    expect(matchPaintPreset([], anyBarSettings)).toBe('');
  });

  it('matches a preset whose smoothing is 0', () => {
    // 0 is a real preset value, not "unset": every opening tip declares it. A truthiness
    // check on the field - `preset.smoothing && ...` - would make the two opening tips
    // unreachable and show Custom on a bar that is sitting on Hard Round.
    const raw: readonly PaintPreset[] = [
      { label: 'Raw', lineWidth: 4, alpha: 1, smoothing: 0, blendMode: 'source-over' },
    ];

    expect(matchPaintPreset(raw, { lineWidth: 4, alpha: 1, smoothing: 0, blendMode: 'source-over' })).toBe('Raw');
  });

  it('does not match a smoothed preset against an unsmoothed bar', () => {
    const raw: readonly PaintPreset[] = [
      { label: 'Raw', lineWidth: 4, alpha: 1, smoothing: 60, blendMode: 'source-over' },
    ];

    expect(matchPaintPreset(raw, { lineWidth: 4, alpha: 1, smoothing: 0, blendMode: 'source-over' })).toBe('');
  });

  it('matches an opacity that came back from the slider as a decimal', () => {
    const marker: readonly PaintPreset[] = [
      { label: 'Marker', lineWidth: 24, alpha: 0.42, smoothing: 0, blendMode: 'source-over' },
    ];
    const fromSlider: BarSettings = { lineWidth: 24, alpha: 42 / 100, smoothing: 0, blendMode: 'source-over' };

    expect(matchPaintPreset(marker, fromSlider)).toBe('Marker');
  });

  it('matches within the comparison epsilon and not outside it', () => {
    // `sameNumber` compares with `Math.abs(a - b) < 1e-9` (src/tools/brush.ts:150)
    // because the bar's values are parsed out of the DOM and divide into decimals
    // (src/components/ToolbarsRight/Paint/Paint.tsx:110). A bare `===` would flip the
    // picker to Custom on a value that is a preset to any number of decimal places.
    const marker: readonly PaintPreset[] = [
      { label: 'Marker', lineWidth: 24, alpha: 0.42, smoothing: 0, blendMode: 'source-over' },
    ];
    const base: BarSettings = { lineWidth: 24, alpha: 0.42, smoothing: 0, blendMode: 'source-over' };

    expect(matchPaintPreset(marker, { ...base, alpha: 0.42 + 1e-12 })).toBe('Marker');
    expect(matchPaintPreset(marker, { ...base, alpha: 0.42 + 1e-8 })).toBe('');
  });

  it('returns the empty string for an empty preset list rather than throwing', () => {
    expect(matchPaintPreset([], anyBarSettings)).toBe('');
  });

  it('returns the first match when a list declares the same preset twice', () => {
    // `find` over the list, in the order the picker renders the options, so a duplicated
    // name resolves to a single displayed value instead of flickering between two.
    const duplicated: readonly PaintPreset[] = [
      { label: 'First', lineWidth: 10, alpha: 1, smoothing: 0, blendMode: 'source-over' },
      { label: 'Second', lineWidth: 10, alpha: 1, smoothing: 0, blendMode: 'source-over' },
    ];

    expect(matchPaintPreset(duplicated, hardRound)).toBe('First');
  });

  it('reads a freshly seeded paint bar as Custom', () => {
    // The seeded brush is 10px at 0.9 opacity with `PAINT_SMOOTHING_DEFAULT` smoothing
    // (src/tools/settings.ts:115-124) and the opening preset is 10px at 1.0 with no
    // smoothing, so no preset describes the bar as it is first shown.
    expect(matchPaintPreset(brushPresets, defaultSettings.brush)).toBe('');
    expect(matchPaintPreset(pencilPresets, defaultSettings.pencil)).toBe('');
  });
});

describe('clampPaintSize', () => {
  it('raises a size below the minimum to the minimum', () => {
    expect(clampPaintSize(0)).toBe(PAINT_SIZE_MIN);
    expect(clampPaintSize(-40)).toBe(PAINT_SIZE_MIN);
  });

  it('lowers a size above the maximum to the maximum', () => {
    // Photoshop's own Size field goes to 5000; the bar's slider cannot be dragged past
    // `PAINT_SIZE_MAX` and a stroke that size is a 10000px padded canvas for one dot
    // (src/tools/brush.ts:54-61), so a value that arrives from anywhere else is capped
    // to the same ceiling the slider enforces.
    expect(clampPaintSize(5000)).toBe(PAINT_SIZE_MAX);
    expect(clampPaintSize(PAINT_SIZE_MAX + 1)).toBe(PAINT_SIZE_MAX);
  });

  it.each([PAINT_SIZE_MIN, 2, 24, 120, PAINT_SIZE_MAX])('passes an in-range size of %i through unchanged', (value) => {
    expect(clampPaintSize(value)).toBe(value);
  });

  it.each([
    ['NaN', Number.NaN],
    ['positive Infinity', Number.POSITIVE_INFINITY],
    ['negative Infinity', Number.NEGATIVE_INFINITY],
  ])('returns the minimum for %s, which a Number() of a cleared field produces', (_name, value) => {
    // The bar reads its input with `Number(event.target.value)`
    // (src/components/ToolbarsRight/Paint/Paint.tsx:106), and an emptied number input
    // parses to NaN. Clamping to the minimum keeps the stroke renderable; NaN as a
    // lineWidth would produce an empty canvas and a blank layer.
    expect(clampPaintSize(value)).toBe(PAINT_SIZE_MIN);
  });
});

describe('PAINT_SIZE_MIN, PAINT_SIZE_MAX and PAINT_SMOOTHING_DEFAULT', () => {
  it('bounds the Size slider at 1 and 500', () => {
    // Photoshop's brush Size range is 1-5000, but strokes here are rasterized into a
    // canvas padded by the full `lineWidth` on every side
    // (`pointsBoundingPos`, src/util/draw.ts:6-26) and committed as their own layer, so
    // a 5000px tip would allocate a 10000px square for a single dot. 500 is the ceiling
    // the legacy `Draw` bar already used, which keeps a stroke's layer proportional to
    // the canvas it was drawn on (src/tools/brush.ts:54-63).
    expect(PAINT_SIZE_MIN).toBe(1);
    expect(PAINT_SIZE_MAX).toBe(500);
  });

  it('defaults Smoothing to Photoshop documented 10%', () => {
    // What the bar reads on first load for both paint tools
    // (src/tools/settings.ts:121,131) and what the e2e suite asserts as the control's
    // accessible name, "Smoothing 10%" (e2e/paint-options.spec.ts:28-31).
    expect(PAINT_SMOOTHING_DEFAULT).toBe(10);
  });

  it('keeps the minimum below the maximum, so the slider is not inverted', () => {
    expect(PAINT_SIZE_MIN).toBeLessThan(PAINT_SIZE_MAX);
  });
});
