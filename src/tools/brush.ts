import type { Point } from '../contexts/general-types.ts';

/**
 * The paint tools whose Photoshop options bar this module describes.
 *
 * `draw` is deliberately absent: it is the legacy vector pen and keeps its own
 * `Pen Type` bar (`src/components/ToolbarsRight/Draw/Draw.tsx`).
 *
 * `color-replacement` was a member of this union and is not any more. It is a SUBSTITUTION,
 * not a stamp: it samples a colour on click and then offsets luminance across a drag, so it
 * has a different args type (`src/tools/colorReplacement.ts`), a different processor and a
 * different options bar. Sharing the union is what let its processor force a `'spray'`
 * `penType` onto `PaintToolArgs` and ignore every other control, which is how Tolerance and
 * Limits ended up with nowhere to live. A tool whose settings do not fit the paint bar must
 * not be in the paint bar's union — see `src/tools/draw.ts:47-61`.
 */
export type PaintToolName = 'brush' | 'pencil';

/**
 * The blend modes a canvas can actually composite a layer with, in the order
 * Photoshop's `Mode` dropdown lists them.
 *
 * Photoshop offers twenty-nine for the painting tools — the twenty-seven layer blend
 * modes, Dissolve among them, plus the two the painting tools add, Behind and Clear —
 * and this list is the sixteen of them this renderer OFFERS. The thirteen it leaves out
 * are Dissolve, Linear Burn, Darker Color, Linear Dodge (Add), Lighter Color, Vivid Light,
 * Linear Light, Pin Light, Hard Mix, Subtract and Divide, plus Behind and Clear, and the
 * reason differs across them, so the enumeration is here rather than derived:
 *
 * - Most have no canvas counterpart at all. `dissolve` is not a `GlobalCompositeOperation`
 *   value, and assigning it is silently ignored by the browser rather than erroring, so it
 *   would ship a dead option rather than a wrong one.
 * - Two have a canvas value that matches only sometimes, which is worse than none: a blend
 *   control that is right for opaque pixels and wrong for translucent ones cannot be chosen
 *   from. `plus-lighter` sums source and destination, which is what Linear Dodge (Add)
 *   does, and `destination-over` draws beneath the destination, which is what Behind does.
 * - Clear is a canvas value and is simply not offered here, which is a choice about this
 *   list rather than a limit on the canvas.
 *
 * `src/contexts/layer-utils.ts` also has to read a value back off stored history, which is
 * why the list is a closed literal union rather than a free string.
 *
 * The enumeration is here so a reader can check the count rather than trust it, and
 * nothing enforces it staying in step with `PAINT_BLEND_MODES` — a mode added to that
 * array does not have to be one Photoshop lists, and this comment would then be quietly
 * wrong. `src/tools/__tests__/brush.test.ts` pins the sixteen values themselves.
 */
export const PAINT_BLEND_MODES = [
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
] as const;

export type PaintBlendMode = (typeof PAINT_BLEND_MODES)[number]['value'];

const PAINT_BLEND_MODE_VALUES: ReadonlySet<string> = new Set(PAINT_BLEND_MODES.map((mode) => mode.value));

/**
 * Guard for a blend mode read back off history. A document written by a build that
 * offered a mode this one does not must fall back to Normal rather than hand the
 * renderer an operation it will quietly ignore.
 */
export const isPaintBlendMode = (value: unknown): value is PaintBlendMode =>
  typeof value === 'string' && PAINT_BLEND_MODE_VALUES.has(value);

/**
 * Photoshop's brush Size range is 1-5000px, but this editor's strokes are
 * rasterized into a canvas padded by the full `lineWidth` on every side
 * (`pointsBoundingPos`, src/util/draw.ts:5-26) and committed as their own layer, so
 * a 5000px tip allocates a 10000px square for a single dot. 1-500 is the ceiling
 * the existing `Draw` bar already uses, and it keeps a stroke's layer proportional
 * to the canvas it was drawn on.
 */
export const PAINT_SIZE_MIN = 1;
export const PAINT_SIZE_MAX = 500;

/** Photoshop's documented default for the options-bar Smoothing control. */
export const PAINT_SMOOTHING_DEFAULT = 10;

const clampPercent = (value: number): number => (Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0);

export const clampPaintSize = (value: number): number =>
  Number.isFinite(value) ? Math.min(PAINT_SIZE_MAX, Math.max(PAINT_SIZE_MIN, value)) : PAINT_SIZE_MIN;

/**
 * The options a Photoshop paint bar edits, beyond the `DrawToolArgs` the stroke is
 * rasterized from.
 *
 * `Smoothing` and `Mode` are optional on `DrawToolArgs` and required here, because
 * the legacy `draw` tool's per-pen presets (`src/tools/settings.ts:21-25`) predate
 * both and must keep rendering exactly as they do today.
 */
export type PaintSettings = {
  /** Photoshop `Smoothing`, 0-100. See `smoothStrokePoints`. */
  smoothing: number;
  /** Photoshop `Mode`. Applied when the stroke's layer is created. */
  blendMode: PaintBlendMode;
};

/**
 * Photoshop's pulled-string stroke smoothing, applied to the sampled path rather
 * than to a stamped tip.
 *
 * The stroke is one `ctx.stroke()` over the whole polyline
 * (`src/util/draw.ts:96-104`), so smoothing has to happen in point space: every
 * interior sample is pulled toward the midpoint of its neighbours by `pull` of the
 * remaining distance. `pull` of 0 is the identity, so the legacy `draw` tool and
 * every unpinned stroke render byte-for-byte as before. `pull` of 1 snaps every
 * interior sample fully onto its neighbours' midpoint. The first and last samples
 * are left alone so the stroke still starts and ends where the pointer did, which
 * is also what keeps `beginPath`/`moveTo`/`stroke` at one call each.
 */
export const smoothStrokePoints = (points: Point[], smoothing: number): Point[] => {
  const pull = clampPercent(smoothing) / 100;
  if (pull === 0 || points.length < 3) return points;

  const smoothed: Point[] = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const previous = points[i - 1];
    const current = points[i];
    const next = points[i + 1];

    smoothed.push({
      x: current.x + pull * ((previous.x + next.x) / 2 - current.x),
      y: current.y + pull * ((previous.y + next.y) / 2 - current.y),
    });
  }
  smoothed.push(points[points.length - 1]);

  return smoothed;
};

/**
 * One entry of the options bar's `Brush Preset` picker. A preset is a named
 * snapshot of the four controls the bar exposes, which is all this renderer can
 * carry: a Photoshop tip also stores hardness, spacing, shape dynamics and texture,
 * and those have no representation in the args or in `drawPen`.
 */
export type PaintPreset = PaintSettings & {
  label: string;
  lineWidth: number;
  alpha: number;
};

export const CUSTOM_PRESET_LABEL = 'Custom';

export const PAINT_PRESETS = {
  brush: [
    { label: 'Hard Round', lineWidth: 10, alpha: 1, smoothing: 0, blendMode: 'source-over' },
    { label: 'Soft Round', lineWidth: 40, alpha: 1, smoothing: 60, blendMode: 'source-over' },
    { label: 'Marker', lineWidth: 24, alpha: 0.45, smoothing: 25, blendMode: 'source-over' },
  ],
  pencil: [
    { label: 'Hard Pencil', lineWidth: 3, alpha: 1, smoothing: 0, blendMode: 'source-over' },
    { label: 'Soft Pencil', lineWidth: 12, alpha: 0.7, smoothing: 50, blendMode: 'source-over' },
    { label: 'Marker', lineWidth: 24, alpha: 0.45, smoothing: 25, blendMode: 'source-over' },
  ],
} as const satisfies Record<'brush' | 'pencil', readonly PaintPreset[]>;

export type PaintPresetLabel = (typeof PAINT_PRESETS)['brush'][number]['label'] | 'Marker';

const sameNumber = (a: number, b: number): boolean => Math.abs(a - b) < 1e-9;

/**
 * The preset whose four settings the current args match, or `''` when the args have
 * been edited into a combination no preset describes. `''` is the picker's `Custom`
 * option, so a hand-tuned bar shows Custom rather than claiming to be a preset it
 * is not.
 */
export const matchPaintPreset = (
  presets: readonly PaintPreset[],
  settings: { lineWidth: number; alpha: number } & PaintSettings
): string =>
  presets.find(
    (preset) =>
      sameNumber(preset.lineWidth, settings.lineWidth) &&
      sameNumber(preset.alpha, settings.alpha) &&
      sameNumber(preset.smoothing, settings.smoothing) &&
      preset.blendMode === settings.blendMode
  )?.label ?? '';
