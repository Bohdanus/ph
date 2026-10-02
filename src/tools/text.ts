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

/**
 * How far the pointer may travel during a press and still count as a click, in CSS px.
 *
 * **A RECONSTRUCTION.** Adobe distinguishes the two gestures by intent — "Select anywhere in the
 * document and start typing to add point text" versus "Drag anywhere in the document to add
 * paragraph text" (https://helpx.adobe.com/photoshop/desktop/text-typography/get-started-with-text/add-text.html)
 * — and documents **no threshold at all**: no distance, no time, no tie-break for a one-pixel drag.
 * This value is therefore this app's own, and it is a named constant so it is one edit rather than
 * a search. It is measured against BOTH axes, and the box it guards is what makes it matter: a
 * one-pixel drag accepted as a paragraph gesture would hand the text a one-pixel-wide box, and
 * every line would overflow it.
 */
export const POINT_TYPE_MAX_DRAG_PX = 3;

/**
 * Adobe's two kinds of type layer.
 *
 * `POINTTEXT` is "Text that does not wrap" and `PARAGRAPHTEXT` is "Text that wraps within a
 * bounding box" — Adobe's own words for the ExtendScript `TextType` enum, which is the only
 * reference that publishes the pair as an enum at all; the current UXP reference exposes it as two
 * read-only booleans, `TextItem.isPointText` and `TextItem.isParagraphText`, and no enum
 * (https://developer.adobe.com/photoshop/uxp/2022/ps-reference/classes/textitem).
 *
 * The default is **`point`**, and that is a migration decision rather than a design one: every text
 * layer in every document, history entry and settings record written before this field existed
 * behaves as point type, because that is the only thing this app could draw. See
 * {@link resolveTextKind}.
 */
export type TextKind = 'point' | 'paragraph';

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

  /**
   * Which of Adobe's two kinds of type layer this is. Optional for the same reason the five above
   * are: `saveLastSettings` persists this record verbatim and a record written before the field
   * existed has no key for it at all. It is OMITTED from persistence — see
   * {@link TextToolSettings} — because it belongs to the gesture that placed the draft, not to the
   * tool: a new draft is a point layer until a drag says otherwise.
   */
  kind?: TextKind;

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
 * The one place an absent `kind` becomes a value, for the same reason {@link resolveTextStyle}
 * exists: a `??` missed at one of the call sites produced a `NaN` line coordinate rather than a
 * visible default, and there are now three readers of this field.
 *
 * **`point` is the migration default, and it is the only defensible one.** A record with no `kind`
 * came from a build whose renderer grew its box to the widest line and never wrapped — that is
 * point type by Adobe's definition, so resolving it as `paragraph` would re-flow every existing
 * document's text at the moment it is loaded.
 */
export function resolveTextKind(args: TextToolArgs): TextKind {
  return args.kind === 'paragraph' ? 'paragraph' : 'point';
}

/**
 * `color` is a setting, not a derivation. It used to be omitted because the bar mirrored the store's
 * foreground into the args on every render, so the value was never the tool's to keep; it is the
 * tool's own swatch now, and `saveLastSettings` already persists it (`src/util/settings.ts` omits
 * `text` and `rect` and, since this revision, `kind`), so this type has to say the same thing.
 *
 * `kind` is omitted rather than persisted for a different reason: it is decided by the gesture that
 * placed the draft, so a remembered `paragraph` would make the next draft wrap inside the last
 * layer's box before the user has dragged anything.
 */
export type TextToolSettings = Omit<TextToolArgs, 'text' | 'rect' | 'kind'>;

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

/**
 * One laid-out line, and whether the text outgrew the box it was laid out into.
 *
 * `overflow` is the fact Adobe's overflow icon reports: "If you enter more text that can fit within
 * a paragraph boundary…, a small box or circle containing a plus symbol (+) appears in place of a
 * handle in the corner of the boundary"
 * (https://helpx.adobe.com/photoshop/using/creating-type.html). It is carried here rather than
 * recomputed by the caller because the caller would have to reproduce the whole layout to get it.
 */
export type TextLayout = {
  lines: string[];
  overflow: boolean;
};

/**
 * What a caller wants that is not part of the ink.
 *
 * The overflow icon is the only member, and it is opt-in because it is chrome rather than type:
 * the draft's overlay asks for it, the creator does not. See {@link drawOverflowIndicator}.
 */
export type RenderTextOptions = {
  overflowIndicator?: boolean;
};

/** The width a paragraph box offers its text, which is the box less the padding on both sides. */
export function textWrapWidth(rect: RectXYSorted): number {
  return rect.x2 - rect.x1 - TEXT_PADDING * 2;
}

/**
 * Splits one hard-broken line into the greedy set of lines that fit `wrapWidth`.
 *
 * **Every decision in here is forced by something Adobe says or something the platform measures.**
 *
 * - **Break at spaces only, and never inside a word.** Adobe's hyphenation is off by default —
 *   `ParagraphStyle.hyphenation` is "boolean … Default false"
 *   (https://developer.adobe.com/photoshop/uxp/2022/ps-reference/classes/paragraphstyle) — and a
 *   word too wide for the box is therefore not broken and not hyphenated: it overflows. Photoshop
 *   documents the same outcome from the other end, where converting paragraph type to point type
 *   "all characters that overflow the bounding box are deleted".
 * - **`\n` is a hard break handled by the caller**, because canvas does not implement one:
 *   measured on Chromium 153, `measureText('a\nb')` equals `measureText('a b')` and the inked pixels
 *   of `fillText('a\nb')` equal those of `fillText('a b')`. A renderer that passed a multi-line
 *   string to `fillText` would draw one line with a space where the newline is.
 * - **The trailing space is trimmed before the fit test.** CSS removes a collapsible space at the
 *   end of a line, and canvas does not: measured, `measureText('ab ')` is 5.557px wider than
 *   `measureText('ab')`. Without the trim, a line that ends in a space breaks one word early.
 * - **A non-breaking space is not an opportunity.** NBSP measures identically to a space, so
 *   metrics cannot tell the two apart and the distinction has to be a code-point check.
 * - **Greedy first fit, not optimal.** Nothing in Adobe's documentation describes the composer;
 *   Photoshop's Every-line and Single-line composers are paragraph-level and are not exposed in
 *   Adobe's API at all. Measured cost of the naive breaker on this path is ~2µs per paragraph.
 */
function wrapLine(ctx: Ctx2D, line: string, wrapWidth: number, spacing: number): string[] {
  const fits = (candidate: string) => inkWidth(ctx, candidate.trimEnd(), spacing) <= wrapWidth;
  if (fits(line)) return [line];

  // A single token that cannot fit is not broken. It is emitted alone and overflows, and the
  // caller reports the overflow — this is Adobe's off-by-default hyphenation, not a failure.
  const tokens = line.split(' ');
  const wrapped: string[] = [];
  let current = '';
  for (const token of tokens) {
    const candidate = current === '' ? token : `${current} ${token}`;
    if (current !== '' && !fits(candidate)) {
      wrapped.push(current);
      current = token;
    } else {
      current = candidate;
    }
    // A no-break space inside `token` keeps the token whole, and `split(' ')` already does: the
    // token is never subdivided, so no further check is needed for the token itself.
  }
  wrapped.push(current);
  return wrapped;
}

/**
 * Lays the draft out into the lines that will actually be drawn.
 *
 * **This is the single layout authority.** `renderText` draws what this returns and
 * `calculateNewRect` sizes the box from it, which is the only way the box and the ink can agree —
 * the durable materializer re-runs the creator from the retained args
 * (`materialization.ts`), so a second implementation would be a second opinion about where the
 * lines fall.
 *
 * `wrapWidth` is `Infinity` for point type, which makes every line fit by construction and reduces
 * this to a split on hard breaks — byte-for-byte the behaviour point type has always had.
 *
 * `boxHeight` is the height available. Its absence (`undefined`) means "no box to overflow", which
 * is the case for the creator: the layer canvas IS the box, so every line fits it by construction.
 */
export function layoutText(
  ctx: Ctx2D,
  style: ResolvedTextStyle,
  text: string,
  wrapWidth: number,
  boxHeight?: number
): TextLayout {
  const spacing = trackingPx(style);
  // An unbounded width makes every line fit by construction, so the breaker is not merely a no-op
  // there — running it would measure each line twice, once to prove it fits and once to place it,
  // and the measurement is the expensive half. Point type therefore skips it entirely and the
  // caller's single measurement per line stands.
  const hardBroken = text.split('\n');
  const lines = Number.isFinite(wrapWidth)
    ? hardBroken.flatMap((line) => wrapLine(ctx, line, wrapWidth, spacing))
    : hardBroken;
  const requiredHeight = lines.length * style.fontSize * style.lineHeight + TEXT_PADDING * 2;
  return { lines, overflow: boxHeight !== undefined && requiredHeight > boxHeight };
}

/**
 * The overflow icon's edge, in CSS px.
 *
 * **A RECONSTRUCTION.** Adobe documents the icon's existence and its appearance — "a small box or
 * circle containing a plus symbol (+) appears in place of a handle in the corner of the boundary" —
 * and neither the size nor the corner, so 8px in the bottom-right is this app's choice. It is a
 * named constant so it is one edit rather than a search, and it is fixed rather than derived from
 * the box: an icon that changed size with the box would not be the same object at two sizes.
 */
const OVERFLOW_INDICATOR_PX = 8;

/**
 * Adobe's overflow icon: a small box containing a plus, in the bottom-right corner of the boundary,
 * in place of the handle that would be there.
 *
 * **It is box chrome, not ink**, so it is drawn only on the draft's overlay and never by the
 * creator — a committed layer's canvas is its own box, and baking the icon into the layer would
 * paint it into the image, where Photoshop has no such thing.
 *
 * Adobe does not state the corner, the size or the colour (§17 of
 * `TEXT_TOOL_REQUIREMENTS.md` records the silence); bottom-right is the corner the overflow is
 * read from in every other application, and both figures are named constants so they are one edit.
 */
export function drawOverflowIndicator(ctx: Ctx2D, rect: RectXYSorted, color: string): void {
  const size = OVERFLOW_INDICATOR_PX;
  const boxRight = rect.x2 - TEXT_PADDING;
  const boxBottom = rect.y2 - TEXT_PADDING;
  const x = boxRight - size;
  const y = boxBottom - size;

  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, size, size);
  const arm = Math.max(1, Math.round(size / 4));
  const midX = Math.round(x + size / 2);
  const midY = Math.round(y + size / 2);
  ctx.beginPath();
  ctx.moveTo(midX - arm, midY);
  ctx.lineTo(midX + arm, midY);
  ctx.moveTo(midX, midY - arm);
  ctx.lineTo(midX, midY + arm);
  ctx.stroke();
  ctx.restore();
}

export function renderText(ctx: Ctx2D, args: TextToolArgs, options: RenderTextOptions = {}) {
  const style = resolveTextStyle(args);
  const kind = resolveTextKind(args);
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

  // Point type is the case where the box has no authority over the text — "each line of type is
  // independent — the line expands or shrinks as you edit it, but it doesn't wrap to the next
  // line" (https://helpx.adobe.com/photoshop/using/creating-type.html) — so it is laid out against
  // an infinite width, which reduces the layout to the hard breaks it has always had.
  const wrapWidth = kind === 'paragraph' ? textWrapWidth(rect) : Infinity;
  const layout = layoutText(ctx, style, text, wrapWidth, rect.y2 - rect.y1);

  layout.lines.forEach((line, index) => {
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

  if (options.overflowIndicator && layout.overflow) {
    drawOverflowIndicator(ctx, rect, style.color);
  }
}

/**
 * How many lines the draft occupies once it is laid out, which is what sizes a paragraph box.
 *
 * The count is a function of the box's WIDTH, so it cannot be read off `text.split('\n').length`:
 * that is the number of hard breaks, not of lines. Exported separately from {@link getTextWidth}
 * because `calculateNewRect` needs the count and nothing else, and measuring the width as well
 * would double the `measureText` calls on every keystroke.
 */
export function getTextLineCount(ctx: Ctx2D, args: TextToolArgs, wrapWidth: number): number {
  const style = resolveTextStyle(args);
  const text = args.text ?? '';
  // Bracketed, and the bracket is load-bearing rather than defensive: `calculateNewRect` hands this
  // the live tool overlay, whose context carries whatever the last tool left on it — measured in the
  // browser, the overlay reports `10px sans-serif` and counts the test string at 162.9px against the
  // renderer's 64px Arial. Measuring unstyled makes every candidate fit, so a paragraph box sized by
  // this grew to one line and committed two wrapped lines of ink as a single band that overflowed it.
  // An unbracketed version would additionally leave the Type tool's typography on the shared overlay.
  ctx.save();
  try {
    applyTextStyle(ctx, style);
    return layoutText(ctx, style, text, wrapWidth).lines.length;
  } finally {
    ctx.restore();
  }
}

export function getTextWidth(ctx: CanvasRenderingContext2D, args: TextToolArgs): number {
  const style = resolveTextStyle(args);
  const kind = resolveTextKind(args);

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
    // The widest WRAPPED line for a paragraph box, and the widest explicit line for a point box —
    // which is the same number as before this revision, because an infinite wrap width leaves the
    // layout a plain split on hard breaks.
    const wrapWidth = kind === 'paragraph' && args.rect ? textWrapWidth(args.rect) : Infinity;
    const { lines } = layoutText(ctx as Ctx2D, style, args.text ?? '', wrapWidth);

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
