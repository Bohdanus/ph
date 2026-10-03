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
 * The leading range the options bar offers, and the bounds a corrupt record is folded into.
 *
 * **A RECONSTRUCTION, NOT AN ADOBE FIGURE.** Adobe's leading is an absolute baseline-to-baseline
 * distance or *Auto*, not a multiplier, so there is no Adobe range to copy — the requirement doc
 * (`TEXT_TOOL_REQUIREMENTS.md` §5, §16 item 9) carries the divergence and the case for making it
 * a length. The numbers are the app's own, and they live here rather than inline in the bar
 * because `resolveTextStyle` needs the same two numbers to fold a corrupt record into, and two
 * copies of a range is one copy too many.
 *
 * The floor is not arbitrary in the way it looks: below roughly `0.85` the line step falls under
 * the font's own ascent and the FIRST baseline lands below the box the layer is sized from, so the
 * reachable part of the slider used to crop committed glyphs. The value is left where the bar put
 * it, because `renderText` now sizes the box to contain the ink whatever the ratio, and moving the
 * slider's floor is a product decision rather than part of that fix.
 */
export const MIN_LINE_HEIGHT = 0.5;
export const MAX_LINE_HEIGHT = 2.25;

/**
 * The size a record with no usable `fontSize` resolves to, and the seed the bar opens at.
 *
 * Sixty-four is what `defaultSettings` seeds and what every screenshot of the tool shows, so a
 * corrupt or absent size lands where the tool starts rather than at Adobe's `0.01` — a technically
 * valid value that renders nothing a user can see.
 */
export const DEFAULT_FONT_SIZE = 64;

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

/**
 * A number from a record that may be corrupt, folded into a range this renderer can draw.
 *
 * The seam exists for the same reason {@link resolveTextStyle} does, and it closes the half of the
 * question that function's own contract left open: `??` answers what a MISSING field means, and
 * said nothing about a field carrying a value no geometry can use. A hand-edited or
 * forward-version settings record is an input this file explicitly promises to survive, and three
 * of the ways it failed were silent rather than loud:
 *
 * - `fontSize: NaN` built the shorthand `'NaNpx Arial'`, which the CSS grammar REJECTS — and Chrome
 *   does not throw on a rejected `ctx.font`, it keeps the previous one. So the drawing context went
 *   on using an older face while `fontSize` itself still reached `calculateNewRect`, and the two
 *   halves disagreed about the size of the type.
 * - `lineHeight: NaN` made every baseline `NaN`, and `fillText` at a `NaN` y draws NOTHING at all:
 *   an empty layer, with no error anywhere.
 * - `tracking: NaN` produced `'NaNpx'`, which `ctx.letterSpacing` also rejects silently, and sent
 *   `inkWidth` down its per-cluster fallback with a `NaN` cursor.
 *
 * `Number.isFinite` rather than a truthiness or `isNaN` test, because `Infinity` is just as
 * undrawable as `NaN` and `??` admits neither.
 */
function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * A number from a record that may be corrupt, folded into a range.
 *
 * Distinct from {@link finiteOr} because the size and the leading both have a legal RANGE as well
 * as a legal type, and a record carrying `fontSize: 1e9` or `lineHeight: 0` is as unusable as one
 * carrying `NaN`: the first allocates a layer of astronomical size, the second overlaps every pair
 * of lines and pushes the first baseline below the box the layer is sized from. `FONT_SIZE_MIN` and
 * `FONT_SIZE_MAX` are Adobe's own `CharacterStyle.size` bounds, so clamping to them is the same
 * rule the options bar applies on entry rather than a second policy.
 */
function finiteInRangeOr(value: number | undefined, min: number, max: number, fallback: number): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value as number)) : fallback;
}

export function resolveTextStyle(args: TextToolArgs): ResolvedTextStyle {
  return {
    align: args.align,
    allCaps: args.allCaps ?? false,
    bold: args.bold ?? false,
    color: args.color,
    fontFamily: args.fontFamily,
    fontSize: finiteInRangeOr(args.fontSize, FONT_SIZE_MIN, FONT_SIZE_MAX, DEFAULT_FONT_SIZE),
    italic: args.italic ?? false,
    // Finiteness only, and deliberately NOT {@link MIN_LINE_HEIGHT}..{@link MAX_LINE_HEIGHT}:
    // those two are the BAR's range and the bar owns them, while this seam exists to make the value
    // drawable. A leading of 0 is finite and drawable — it stacks every line on the first baseline,
    // which is what `renderText` does with it and what the `it('stacks lines on top of each other
    // for a zero line height')` case pins as the arithmetic rather than a special case. Only a
    // non-finite leading is undrawable, and it is undrawable SILENTLY: every baseline becomes
    // `NaN` and `fillText` draws nothing at all.
    lineHeight: finiteOr(args.lineHeight, AUTO_LEADING),
    smallCaps: args.smallCaps ?? false,
    strikethrough: args.strikethrough ?? false,
    tracking: finiteOr(args.tracking, 0),
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

/**
 * Fallback descent, as a fraction of the type size, paired with {@link ASCENT_FALLBACK_EM}.
 *
 * Real descents across the shipped families run a little over a fifth of the em, so 0.2em is the
 * rounded middle of that band rather than a claim about any one font. It exists so the ink-height
 * calculation below has a number even where `measureText` reports no `fontBoundingBoxDescent`.
 */
const DESCENT_FALLBACK_EM = 0.2;

/**
 * How much vertical room ONE line of this type occupies as INK rather than as line spacing.
 *
 * The ascent plus the descent, because a glyph's ink reaches above the baseline as well as below
 * it, and a box sized from the line step alone put the first baseline below its own bottom edge
 * whenever the leading fell under the ascent. Measured from the live context so it follows the face
 * and the size, and folded through {@link finiteMetric} in both halves so a context that reports
 * nothing — every canvas mock in this repo's tests — still yields a finite, drawable number rather
 * than a `NaN` baseline, which draws NOTHING rather than something visibly wrong.
 */
function inkHeight(ctx: Ctx2D | null | undefined, style: ResolvedTextStyle): number {
  // Zero rather than a fallback guess when there is no context to ask. `calculateNewRect` is handed
  // a ref it may not have — `Text.tsx` passes the tool overlay, which is null on the very first
  // render and in every test that does not mount a canvas — and the ink term exists to stop the
  // FIRST line being cropped, which needs a measured ascent to mean anything. Without a measurer the
  // honest answer is the line step alone, which is what this box sized from before the ink term was
  // added and is never smaller than a single line's worth of spacing.
  if (!ctx) return 0;
  const metrics = ctx.measureText('');
  return (
    finiteMetric(metrics.fontBoundingBoxAscent, ASCENT_FALLBACK_EM, style.fontSize) +
    finiteMetric(metrics.fontBoundingBoxDescent, DESCENT_FALLBACK_EM, style.fontSize)
  );
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
 * Where a line of type MAY be broken, as a pattern rather than a character.
 *
 * A pattern rather than `' '` because Photoshop breaks paragraph type at a whitespace RUN, not at
 * U+0020 specifically: a paragraph of tab-separated columns is one U+0020-free token under the old
 * rule, so it could never be broken, was emitted alone, overflowed its box by hundreds of pixels,
 * and reported no overflow at all. Every `\s` character EXCEPT NBSP is an opportunity, which is
 * the whole of the NBSP rule: `\s` matches U+00A0, so it is excluded by character class rather than
 * stripped afterwards, and `1\u00A0kg` stays one token because the intent is inseparable. The
 * exclusion is written as the ESCAPE rather than as a pasted NBSP, which is indistinguishable from
 * the ordinary space in a diff, in a review and to `no-irregular-whitespace`.
 */
const BREAK_OPPORTUNITY = /[^\S\u00A0]+/;

/**
 * What a break opportunity becomes when the line is put back together.
 *
 * A single U+0020. The pattern above matches a RUN of whitespace, so a run that was one tab or
 * three spaces rejoins as one space — the same collapse CSS performs at the end of a line, applied
 * here to the interior where a renderer draws a space of its own choosing anyway.
 */
const BREAK_OPPORTUNITY_REPLACEMENT = ' ';

/**
 * Strips the collapsible space from the end of a candidate line, and ONLY the collapsible space.
 *
 * `String.prototype.trimEnd` is the wrong tool and was measurably so: U+00A0 is in the ES
 * `WhiteSpace` production, so `trimEnd()` deleted a trailing NBSP as well, and the fit test then
 * ran against a line one space narrower than the one `fillLine` drew — an overflow the layout could
 * not see and the box could not grow to cover.
 */
function trimTrailingCollapsibleSpace(candidate: string): string {
  return candidate.replace(/[ \t]+$/, '');
}

/** One hard-broken line's greedy wrap, and whether any token in it outgrew the box. */
type WrapLineResult = {
  lines: string[];
  /** True when a single token is wider than `wrapWidth` and so had to overflow unbroken. */
  widthOverflowed: boolean;
};

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
 *   metrics cannot tell the two apart and the distinction has to be a code-point check — which is
 *   what {@link BREAK_OPPORTUNITY} and {@link trimTrailingCollapsibleSpace} are. `trimEnd()` is
 *   emphatically NOT the trim: NBSP is in the ES `WhiteSpace` production, so `trimEnd()` deleted a
 *   non-breaking space too, measuring the fit against a line one space narrower than the one
 *   {@link fillLine} then drew.
 * - **Greedy first fit, not optimal.** Nothing in Adobe's documentation describes the composer;
 *   Photoshop's Every-line and Single-line composers are paragraph-level and are not exposed in
 *   Adobe's API at all. Measured cost of the naive breaker on this path is ~2µs per paragraph.
 */
function wrapLine(ctx: Ctx2D, line: string, wrapWidth: number, spacing: number): WrapLineResult {
  const fits = (candidate: string) => inkWidth(ctx, trimTrailingCollapsibleSpace(candidate), spacing) <= wrapWidth;
  if (fits(line)) return { lines: [line], widthOverflowed: false };

  // A single token that cannot fit is not broken. It is emitted alone and overflows, and the
  // caller is told so — this is Adobe's off-by-default hyphenation, not a failure, and the
  // overflow flag is what puts Adobe's overflow icon on screen for it.
  const tokens = line.split(BREAK_OPPORTUNITY);
  const wrapped: string[] = [];
  let current = '';
  let widthOverflowed = false;
  for (const token of tokens) {
    const candidate = current === '' ? token : `${current}${BREAK_OPPORTUNITY_REPLACEMENT}${token}`;
    if (current !== '' && !fits(candidate)) {
      wrapped.push(current);
      current = token;
    } else {
      current = candidate;
    }
    // The token is never subdivided, so a NBSP inside it keeps it whole without a further check:
    // `BREAK_OPPORTUNITY` does not match NBSP.
    if (!fits(token)) widthOverflowed = true;
  }
  wrapped.push(current);
  return { lines: wrapped, widthOverflowed };
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
  const wrapped = Number.isFinite(wrapWidth)
    ? hardBroken.flatMap((line) => wrapLine(ctx, line, wrapWidth, spacing))
    : null;
  const lines = wrapped ? wrapped.flatMap((result) => result.lines) : hardBroken;

  // Adobe's condition is "more text than can fit within a paragraph boundary", which is about the
  // BOUNDARY and not about the number of lines: a single token too wide for the box overflows it
  // horizontally while `lines.length` stays at one and the height fits perfectly. So the height
  // comparison alone could never raise the icon for the very case this file documents as expected —
  // an unbroken word wider than its box — and the icon is the only signal the user gets.
  //
  // The width flag needs no measurement, so it is settled first and unconditionally. The height
  // probe is a `measureText('')` and is taken ONLY when a caller asked about a box at all: with no
  // `boxHeight` there is nothing to overflow, and `getTextWidth` — the hot path, once per keystroke
  // per line — must not pay a per-font metric read it will not look at.
  const widthOverflowed = wrapped ? wrapped.some((result) => result.widthOverflowed) : false;
  const overflow =
    widthOverflowed || (boxHeight !== undefined && requiredHeightForLines(ctx, style, lines.length) > boxHeight);

  return { lines, overflow };
}

/**
 * The height a box has to be to hold `lineCount` lines of this type, padding included.
 *
 * **The box has to contain the INK, and the ink is taller than the line spacing whenever the leading
 * is under the font's own ascent.** The first baseline sits at `y1 + TEXT_PADDING + ascent`, so a
 * leading whose step is under that ascent put the baseline BELOW the box the layer is sized from —
 * and the committed layer's canvas IS the box, since `createLayerFromTool` takes `pos` from the rect
 * and `layer-utils`' `createLayerSource` sizes the creator's canvas at `size: pos`. The crop was
 * therefore not a drawing artifact but missing pixels in the file. The leading slider's floor is
 * well under the threshold, so this was reachable on every draft at a low leading.
 *
 * Exported rather than folded into {@link layoutText} because it is BOX POLICY, not layout: only
 * `calculateNewRect` needs it, and keeping it here gives `layoutText` a `measureText('')` it can
 * skip entirely when no caller asked about a box.
 */
export function requiredHeightForLines(
  ctx: Ctx2D | null | undefined,
  style: ResolvedTextStyle,
  lineCount: number
): number {
  const lineStep = style.fontSize * style.lineHeight;
  return Math.max(lineCount * lineStep, inkHeight(ctx, style)) + TEXT_PADDING * 2;
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

export function renderText(ctx: Ctx2D, args: TextToolArgs, options: RenderTextOptions = {}): void {
  const style = resolveTextStyle(args);
  const kind = resolveTextKind(args);
  const { text, rect } = args;
  if (!text || !rect) return;

  // OUTSIDE the bracket, and deliberately so. `resetOverlayAlpha` is a WRITE and not a restore, and
  // it belongs after the `!text || !rect` return above so that a no-op draft leaves the shared
  // overlay's alpha exactly as it found it. Were it inside, `restore()` would undo it.
  resetOverlayAlpha(ctx);

  // Bracketed, and the bracket is load-bearing rather than defensive, for the reason
  // `getTextWidth`'s is: `applyTextStyle` is not a measurement, it writes `font`, `textBaseline`,
  // `textAlign`, `letterSpacing` and `fontVariantCaps` onto the caller's context, and this one is
  // handed the LIVE tool overlay — the same object `overlayCtxRef` and `toolOverlayRef` resolve to.
  // So an unbracketed version left the session-long overlay wearing the draft's typeface,
  // tracking and caps variant after the user left the Type tool, for every later overlay painter
  // to inherit. The three measurers in this file were closed for exactly this reason; this one was
  // the only context-touching function left open, and it is the one that runs most often.
  ctx.save();
  try {
    renderTextInto(ctx, style, kind, text, rect, options);
  } finally {
    ctx.restore();
  }
}

/**
 * The body of {@link renderText}, with the canvas already styled and already bracketed.
 *
 * Split out so the bracket is one thing this file owns rather than something each branch of a long
 * function has to remember, and so the style is resolved once for both halves.
 */
function renderTextInto(
  ctx: Ctx2D,
  style: ResolvedTextStyle,
  kind: TextKind,
  text: string,
  rect: RectXYSorted,
  options: RenderTextOptions
): void {
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
