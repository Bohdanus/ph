import { TEXT_PADDING } from '../util/constants.ts';
import { resetOverlayAlpha } from '../util/canvas.ts';
import { graphemes } from '../util/string.ts';
import type { CreatorToolParams } from './toolProcessors.ts';
import type { Ctx2D, RectXYSorted } from '../contexts/general-types.ts';

/**
 * Adobe's `CharacterStyle.size` is `0.01..1296` "in pixels for a 72ppi document"
 * (https://developer.adobe.com/photoshop/uxp/2022/ps-reference/classes/characterstyle). The bound
 * is on the FIELD, not on rendering — Free Transform scales a type layer past it — so what this
 * app reproduces is the field's range. The unit stays CSS px: the canvas carries no document
 * resolution, so a point has no denominator here (see `TEXT_TOOL_REQUIREMENTS.md` §11).
 */
export const FONT_SIZE_MIN = 0.01;
export const FONT_SIZE_MAX = 1296;

/**
 * Adobe's `CharacterStyle.tracking` is `-1000..1000`, and the unit is 1/1000 em relative to the
 * current type size: "Tracking and kerning are both measured in 1/1000 em… 100 tracking units in
 * a 10-point font are equivalent to 1 point"
 * (https://helpx.adobe.com/photoshop/using/line-character-spacing.html).
 */
export const TRACKING_MIN = -1000;
export const TRACKING_MAX = 1000;

/**
 * Adobe's default leading is Auto, and auto-leading is 120% of the type size —
 * `JustificationProperties.autoLeadingAmount` defaults to `120` and is configured in the
 * Paragraph panel's flyout under *Justification…*, not in Preferences
 * (https://developer.adobe.com/photoshop/uxp/2022/ps_reference/objects/options/justificationproperties/).
 * This app's `lineHeight` is a ratio rather than an absolute baseline-to-baseline distance, so
 * the default reproduces the 120% and the semantics stay divergent.
 */
export const AUTO_LEADING = 1.2;

/**
 * Where the underline sits below the baseline, as a fraction of the type size.
 *
 * **A RECONSTRUCTION, NOT AN ADOBE FIGURE.** Adobe documents that the underline is drawn in the
 * type colour and nothing else: its `Underline` enum is `NONE / LEFTINVERTICAL /
 * RIGHTINVERTICAL`, with no style, weight, offset or colour of its own
 * (https://developer.adobe.com/photoshop/uxp/2022/ps-reference/modules/constants), and the
 * Underline Options dialog with its offset control is InDesign/InCopy. No Adobe page states where
 * the rule sits relative to the baseline, so 0.1em is this app's choice, in the band browsers and
 * print conventions use. It is a named constant precisely so it is one edit rather than a search.
 */
const UNDERLINE_BELOW_BASELINE_EM = 0.1;

/**
 * Fallback ascent, as a fraction of the type size, for a context whose `measureText` reports no
 * `fontBoundingBoxAscent`. The test harnesses model `measureText` as `{ width }` alone, and a real
 * `undefined` there would put every baseline at `NaN`.
 */
const ASCENT_FALLBACK_EM = 0.8;

/**
 * Fallback x-height, as a fraction of the type size, for the same reason. Measured across the
 * fonts this app ships, real x-heights run 0.44–0.52em (Arial is 0.518555em), so 0.5em is the
 * middle of that band rather than a claim about any one font.
 */
const X_HEIGHT_FALLBACK_EM = 0.5;

export type TextToolArgs = {
  align: 'left' | 'center' | 'right';
  bold: boolean;
  color: string;
  fontFamily: string;
  fontSize: number;
  italic: boolean;
  lineHeight: number;
  text?: string;
  rect?: RectXYSorted | null;

  /**
   * Adobe's character attributes that arrived after the first version of this tool. Every one is
   * OPTIONAL, because `saveLastSettings` persists this record verbatim and a settings object
   * written before a field existed has to keep working: `resolveTextStyle` is the single place a
   * missing field becomes a value.
   */
  allCaps?: boolean;
  smallCaps?: boolean;
  strikethrough?: boolean;
  /** Looseness in 1/1000 em. Adobe's field is `-1000..1000`; see {@link TRACKING_MIN}. */
  tracking?: number;
  underline?: boolean;

  toolName: 'text';
};

/**
 * Every field of {@link TextToolArgs} except the draft itself, with the optionals resolved.
 *
 * This is the seam the renderer, the measurer and the options bar all read through, and it exists
 * so that "what happens when a settings object predates a field" is answered in exactly one place
 * rather than by a `?? 0` at each of the eight call sites — a `??` that was missed produced a
 * `NaN` line coordinate rather than a visible default.
 */
export type ResolvedTextStyle = {
  align: TextToolArgs['align'];
  allCaps: boolean;
  bold: boolean;
  color: string;
  fontFamily: string;
  fontSize: number;
  italic: boolean;
  lineHeight: number;
  smallCaps: boolean;
  strikethrough: boolean;
  tracking: number;
  underline: boolean;
};

export function resolveTextStyle(args: TextToolArgs): ResolvedTextStyle {
  return {
    align: args.align,
    allCaps: args.allCaps ?? false,
    bold: args.bold ?? false,
    color: args.color,
    fontFamily: args.fontFamily,
    fontSize: args.fontSize,
    italic: args.italic ?? false,
    lineHeight: args.lineHeight ?? AUTO_LEADING,
    smallCaps: args.smallCaps ?? false,
    strikethrough: args.strikethrough ?? false,
    tracking: args.tracking ?? 0,
    underline: args.underline ?? false,
  };
}

/**
 * `color` is a setting, not a derivation. It used to be omitted because the bar mirrored the store's
 * foreground into the args on every render, so the value was never the tool's to keep; it is the
 * tool's own swatch now, and `saveLastSettings` already persists it (`src/util/settings.ts` omits
 * only `text` and `rect`), so this type has to say the same thing.
 */
export type TextToolSettings = Omit<TextToolArgs, 'text' | 'rect'>;

/**
 * The CSS font shorthand, with style and weight BEFORE the size.
 *
 * The order is load-bearing and was wrong before: `${italic}${bold}${size}px ${family}` produced
 * strings like `64px bold Arial`, which the CSS grammar rejects as a family name. Chrome does not
 * throw on a rejected `ctx.font` — it silently keeps the previous font, and measured on this host
 * `64px bold Arial` and `64px italic Arial` render pixel-identically to the serif fallback. The
 * Bold and Italic buttons therefore swapped the typeface instead of weighting it.
 *
 * The same grammar rejects a weight AFTER the size (`bold 700 64px Arial`), which is why there is
 * no numeric weight here.
 */
export function fontShorthand(style: Pick<ResolvedTextStyle, 'fontFamily' | 'fontSize' | 'bold' | 'italic'>): string {
  return `${style.italic ? 'italic ' : ''}${style.bold ? 'bold ' : ''}${style.fontSize}px ${style.fontFamily}`;
}

/** Tracking as a CSS length: 1/1000 em of the current type size, per Adobe. */
export function trackingPx(style: Pick<ResolvedTextStyle, 'fontSize' | 'tracking'>): number {
  return (style.tracking / 1000) * style.fontSize;
}

/**
 * `'letterSpacing' in ctx` is the only reliable test. `delete
 * CanvasRenderingContext2D.prototype.letterSpacing` reports success on Chrome 154 and leaves the
 * property present and fully functional, so a prototype-deletion test of the fallback below is a
 * false pass on the real browser. A harness that simply omits the key is what exercises it.
 */
function hasLetterSpacing(ctx: Ctx2D): boolean {
  return 'letterSpacing' in ctx;
}

function hasFontVariantCaps(ctx: Ctx2D): boolean {
  return 'fontVariantCaps' in ctx;
}

/**
 * Everything about the context that has to be true before a glyph is drawn, in the order that
 * order matters.
 *
 * `ctx.font` is assigned FIRST because assigning it RESETS `ctx.fontVariantCaps` to `'normal'` on
 * Chrome 154 — `letterSpacing`, `wordSpacing` and `fontKerning` survive a font assignment and
 * `fontVariantCaps` does not, so a caps toggle set before the font is silently lost on every redraw.
 *
 * `textBaseline` is `'alphabetic'` and every y below is measured from the baseline. It used to be
 * `'top'`, which is a font-dependent constant that no exposed metric reproduces: measured across
 * fourteen families at 64px, the `'top'` offset runs 0.7627em (Times) to 0.8760em (Impact), with
 * Arial at 0.78125em and the generic families at exactly 0.75em. Every decoration this tool draws
 * relative to a baseline — the underline, the strikethrough — needs a baseline it can name.
 *
 * `textAlign` is `'start'` for the same reason: the anchor is computed from the measured ink width
 * so that the box and the glyphs cannot disagree, and `textAlign` is only ever read by the manual
 * fallback that positions each cluster itself.
 */
function applyTextStyle(ctx: Ctx2D, style: ResolvedTextStyle): void {
  ctx.font = fontShorthand(style);
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'start';
  if (hasLetterSpacing(ctx)) {
    ctx.letterSpacing = `${trackingPx(style)}px`;
  }
  if (hasFontVariantCaps(ctx)) {
    // 'all-small-caps' covers Adobe's All Caps, which renders every character as a capital.
    // 'small-caps' leaves characters already typed as capitals alone and synthesises only the
    // lowercase, which is Adobe's documented rule: "if the font does not include small caps,
    // Photoshop generates faux small caps"
    // (https://helpx.adobe.com/photoshop/using/formatting-characters.html). Chrome synthesises
    // both — measured at 64px Arial, synthesised capitals are exactly 0.703125 of the real cap
    // height and lowercase renders identically to uppercase under 'all-small-caps'.
    //
    // All Caps wins the pair, and that is not an arbitrary precedence: with BOTH Adobe toggles on
    // Photoshop renders every character as a small capital, which is precisely what
    // 'all-small-caps' does to an uppercase character. The two are independent booleans here and
    // the bar can hold both; only the resolved variant is single-valued.
    ctx.fontVariantCaps = style.allCaps ? 'all-small-caps' : style.smallCaps ? 'small-caps' : 'normal';
  }
}

function finiteMetric(value: number | undefined, fallbackEm: number, fontSize: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallbackEm * fontSize;
}

/**
 * Distance from the top of a line box down to that line's baseline.
 *
 * The line box is `fontSize * lineHeight` tall and the font's own ascent fills it from the top, so
 * the baseline is `ascent` below the line's top. `fontBoundingBoxAscent` is the font's ascent as
 * Chrome reports it (58px for Arial at 64px, 0.90625em) and it is size-dependent, which is why it
 * is measured per render rather than assumed to be a constant fraction.
 */
function baselineOffset(ctx: Ctx2D, fontSize: number): number {
  return finiteMetric(ctx.measureText('').fontBoundingBoxAscent, ASCENT_FALLBACK_EM, fontSize);
}

/** Half the rendered x-height, which is where a strikethrough belongs. */
function xHeightHalf(ctx: Ctx2D, fontSize: number): number {
  const metrics = ctx.measureText('x');
  return finiteMetric(metrics.actualBoundingBoxAscent, X_HEIGHT_FALLBACK_EM, fontSize) / 2;
}

/**
 * The width of the INK a line puts down, as opposed to the advance the shaper reports.
 *
 * These differ, and the difference is exactly one tracking gap: Chrome's `letterSpacing` adds the
 * spacing to every character's advance INCLUDING the last one, so `measureText('H').width` at
 * 10px of tracking is 10px wider than the 46.21875px of untracked Arial even though a single
 * glyph has no gap in front of it. Measured at 64px Arial, the advance grows by `n * spacing` for
 * n = 1 through 10 while the ink grows by `(n - 1) * spacing`. Every number that positions
 * something relative to the line — the alignment anchors, the underline's extent — has to use the
 * ink width, and `getTextWidth` has to use it too or the box grows by a gap the text never fills.
 *
 * Without `letterSpacing` the shaper reports no spacing at all, so the fallback adds `(n - 1)`
 * gaps itself. That fallback also drops kerning, because measuring a string one cluster at a time
 * is measuring its parts: on 'WAVE AV' at 64px the manual total is 11.875px wider than the kerned
 * one. It is the honest degradation and it is documented, not hidden.
 */
function inkWidth(ctx: Ctx2D, line: string, spacing: number): number {
  // Tracking at zero is the overwhelmingly common case and it must not cost anything: the
  // fallback below measures a string one cluster at a time, which throws away kerning, and there
  // is no reason to throw it away when there is no spacing to place by hand.
  if (spacing === 0) return ctx.measureText(line).width;
  if (hasLetterSpacing(ctx)) {
    return Math.max(0, ctx.measureText(line).width - spacing);
  }
  const clusters = graphemes(line);
  if (clusters.length === 0) return 0;
  const unshaped = clusters.reduce((total, cluster) => total + ctx.measureText(cluster).width, 0);
  return unshaped + (clusters.length - 1) * spacing;
}

/**
 * Draws one line from its left ink edge.
 *
 * With `letterSpacing` the whole line goes down in one `fillText` and the shaper handles it. Without
 * it — and only when there is tracking to place by hand — the fallback positions each grapheme
 * cluster itself, which is the price of a control the platform will not provide: kerning and any
 * ligature the font was going to form across the boundary are gone, because there is no API to ask
 * for one pair at a time.
 */
function fillLine(ctx: Ctx2D, line: string, x: number, y: number, spacing: number): void {
  if (spacing === 0 || hasLetterSpacing(ctx)) {
    ctx.fillText(line, x, y);
    return;
  }
  let cursor = x;
  for (const cluster of graphemes(line)) {
    ctx.fillText(cluster, cursor, y);
    cursor += ctx.measureText(cluster).width + spacing;
  }
}

function decorationThickness(fontSize: number): number {
  return Math.max(1, Math.round(fontSize / 16));
}

export function renderText(ctx: Ctx2D, args: TextToolArgs) {
  const style = resolveTextStyle(args);
  const { text, rect } = args;
  if (!text || !rect) return;

  resetOverlayAlpha(ctx);
  applyTextStyle(ctx, style);

  ctx.fillStyle = style.color;
  const spacing = trackingPx(style);
  const lineStep = style.fontSize * style.lineHeight;
  const boxLeft = rect.x1 + TEXT_PADDING;
  const boxRight = rect.x2 - TEXT_PADDING;
  const underlineTop = UNDERLINE_BELOW_BASELINE_EM * style.fontSize;
  const strikeAbove = style.strikethrough ? xHeightHalf(ctx, style.fontSize) : 0;
  const thickness = decorationThickness(style.fontSize);
  // Measured once, not once per line: the offset depends on the font and the size and nothing
  // else, and this runs on every keystroke of a draft.
  const ascent = baselineOffset(ctx, style.fontSize);

  text.split('\n').forEach((line, index) => {
    const baseline = rect.y1 + TEXT_PADDING + ascent + index * lineStep;
    const width = inkWidth(ctx, line, spacing);
    // `'left'` is the fallthrough rather than `'right'` because an unrecognised value — a
    // hand-edited or forward-version settings record — should land where the tool starts rather
    // than silently flip the alignment.
    const x =
      style.align === 'center'
        ? boxLeft + (boxRight - boxLeft - width) / 2
        : style.align === 'right'
          ? boxRight - width
          : boxLeft;

    fillLine(ctx, line, x, baseline, spacing);

    if (style.underline) {
      ctx.fillRect(x, Math.round(baseline + underlineTop - thickness / 2), width, thickness);
    }
    if (style.strikethrough) {
      ctx.fillRect(x, Math.round(baseline - strikeAbove - thickness / 2), width, thickness);
    }
  });
}

export function getTextWidth(ctx: CanvasRenderingContext2D, args: TextToolArgs): number {
  const style = resolveTextStyle(args);

  // Bracketed, because this is a MEASUREMENT and `applyTextStyle` is not a measurement: it writes
  // `font`, `textBaseline`, `textAlign`, `letterSpacing` and `fontVariantCaps` onto the caller's
  // context. `calculateNewRect` calls this with the live tool overlay
  // (`TextToolArea.tsx` hands the same ref to both), so an unbracketed version would leave the
  // overlay wearing the Type tool's typography every time a box was recomputed. This is the same
  // leak `resetOverlayAlpha` exists for, and unlike that helper it was not closed.
  ctx.save();
  try {
    applyTextStyle(ctx as Ctx2D, style);

    const spacing = trackingPx(style);
    const lines = (args.text ?? '').split('\n');

    return lines.reduce((widest, line) => Math.max(widest, inkWidth(ctx as Ctx2D, line, spacing)), 0);
  } finally {
    ctx.restore();
  }
}

export const text =
  ({ size }: CreatorToolParams) =>
  (args: TextToolArgs) => {
    const canvas = new OffscreenCanvas(size.width, size.height);
    const ctx = canvas.getContext('2d')!;

    renderText(ctx, args);

    return [canvas];
  };
