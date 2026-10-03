import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AUTO_LEADING,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  TRACKING_MAX,
  TRACKING_MIN,
  fontShorthand,
  getTextLineCount,
  getTextWidth,
  layoutText,
  renderText,
  requiredHeightForLines,
  resolveTextKind,
  resolveTextStyle,
  text,
  textWrapWidth,
  trackingPx,
  type TextToolArgs,
} from '../text.ts';
import { TEXT_PADDING } from '../../util/constants.ts';
import { makeMockCtx } from '../../__tests__/canvas-mock.ts';
import type { RectXYSorted } from '../../contexts/general-types.ts';

/** Ten pixels per character, so every width in this file is a character count times ten. */
const CH = 10;

const metrics = (width: number, extra: Partial<TextMetrics> = {}): TextMetrics => ({ width, ...extra }) as TextMetrics;

/**
 * The default measurer: a width and NOTHING else.
 *
 * This is the shape a bare canvas mock reports, and it is the shape `src/tools/text.ts` is written
 * to survive — `finiteMetric` guards the ascent and the x-height against exactly this, because a
 * baseline computed from `undefined` is `NaN`, and `fillText` at `y = NaN` draws nothing at all
 * rather than something wrong that anybody could see.
 */
const widthOnlyMeasure = (value: string): TextMetrics => metrics(value.length * CH);

/**
 * A measurer that also reports the font metrics the decorations are placed from: the baseline drops
 * by `fontBoundingBoxAscent`, and the strikethrough sits half an `actualBoundingBoxAscent` of 'x'
 * above it. The numbers are Chrome's at 64px Arial (58px ascent), chosen to be DISTINCT from the
 * 0.8em and 0.5em fallbacks so no assertion below can pass on a fallback that should not have run.
 * They are markers rather than a font model: at the 20px these cases use they are not a consistent
 * pair, and nothing here depends on them being one.
 */
const metricMeasure = (value: string): TextMetrics =>
  metrics(value.length * CH, {
    fontBoundingBoxAscent: 58,
    actualBoundingBoxAscent: value === 'x' ? 20 : 10,
  });

/**
 * `modern: true` puts `letterSpacing` and `fontVariantCaps` on the context, as Chrome 154 does.
 *
 * `'letterSpacing' in ctx` is the only feature test the renderer can use — `delete
 * CanvasRenderingContext2D.prototype.letterSpacing` reports success on Chrome and leaves the
 * property present and fully functional, so a prototype-deletion test of the manual fallback is a
 * FALSE PASS on the real browser. Omitting the key is what exercises the fallback, and that is the
 * default here for exactly that reason.
 *
 * `save` and `restore` are modelled over the properties `applyTextStyle` writes, rather than being
 * left as bare spies. Every bracket in this file — `renderText`'s and the three measurers' — is
 * load-bearing, because each of them is handed the live tool overlay, and a spy cannot tell a
 * bracket that works from a bracket that was never written. Modelling them HERE rather than in the
 * shared `canvas-mock` keeps the change inside this file: the shared mock's no-op brackets are
 * asserted by call COUNT elsewhere, and giving them state would be a wider change than this
 * assertion needs.
 */
const RESTORED_BY_SAVE = [
  'font',
  'textBaseline',
  'textAlign',
  'letterSpacing',
  'fontVariantCaps',
  'fillStyle',
  'globalAlpha',
] as const;

/** Per-context log of the style state at each measurement, written by `makeTextCtx`. */
const appliedDuring = new WeakMap<CanvasRenderingContext2D, Record<string, unknown>[]>();

const makeTextCtx = ({
  measure = widthOnlyMeasure,
  modern = false,
}: { measure?: (value: string) => TextMetrics; modern?: boolean } = {}): CanvasRenderingContext2D => {
  const ctx = makeMockCtx({
    measureText: vi.fn(measure),
    ...(modern ? { letterSpacing: '0px', fontVariantCaps: 'normal' } : {}),
  }) as unknown as CanvasRenderingContext2D & Record<string, unknown>;

  const stack: Partial<Record<(typeof RESTORED_BY_SAVE)[number], unknown>>[] = [];
  // A union-keyed write into the intersection type resolves the target to the intersection of every
  // property's type, which `unknown` is not assignable to. The writes are string-keyed at runtime.
  const target = ctx as unknown as Record<string, unknown>;
  ctx.save = vi.fn(() => {
    // Only the keys the context ACTUALLY carries, and presence is what is recorded: restoring an
    // absent key by assigning `undefined` would CREATE it, which is precisely what
    // `it('never creates a letterSpacing property on a context that lacks one')` exists to catch —
    // a test helper that manufactures the property it is guarding against would be worse than none.
    const frame: Partial<Record<(typeof RESTORED_BY_SAVE)[number], unknown>> = {};
    for (const key of RESTORED_BY_SAVE) {
      if (Object.hasOwn(ctx, key)) frame[key] = target[key];
    }
    stack.push(frame);
  });
  ctx.restore = vi.fn(() => {
    const frame = stack.pop();
    if (!frame) return;
    for (const key of RESTORED_BY_SAVE) {
      if (Object.hasOwn(frame, key)) target[key] = frame[key];
    }
  });

  // Every property value in effect at each `measureText`, which is the one moment guaranteed to be
  // inside the bracket: the style is applied before the first measurement and restored after the
  // last. Anything the renderer APPLIED has to be asserted against this, because by the time
  // `renderText` returns the context is back to its seed — which is the fix, and reading the
  // post-return value instead is how two cases here came to pin the value the renderer used to
  // LEAK into a shared context as though it were the feature.
  const log: Record<string, unknown>[] = [];
  appliedDuring.set(ctx, log);
  vi.mocked(ctx.measureText).mockImplementation((value: string) => {
    log.push(Object.fromEntries(RESTORED_BY_SAVE.map((key) => [key, target[key]])) as Record<string, unknown>);
    return measure(value);
  });

  return ctx;
};

/**
 * The context state as it stood during the LAST measurement the renderer made.
 *
 * Empty until something measured, so a test that consults it without drawing reads `{}` rather than
 * a plausible-looking value — an assertion that can pass without the renderer having run at all is
 * the failure mode this whole file has been audited for.
 */
const styledDuringDraw = (ctx: CanvasRenderingContext2D, key: string): unknown => {
  const log = appliedDuring.get(ctx);
  const last = log?.[log.length - 1];
  return last ? last[key] : undefined;
};

/** Every string the renderer handed to `measureText`, in call order. */
const measured = (ctx: CanvasRenderingContext2D): string[] =>
  vi.mocked(ctx.measureText).mock.calls.map((call) => call[0]);

/** One `fillText` argument triple: the line, and where its left ink edge was anchored. */
type FilledCall = [string, number, number];

/**
 * Every line the renderer actually drew, with its anchor, in call order.
 *
 * Read from the call log rather than recomputed from the args, because the WRAPPED line count and
 * the `\n` count are different numbers for a paragraph box — the log is the only place the two
 * layouts are distinguishable.
 */
const filled = (ctx: CanvasRenderingContext2D): FilledCall[] =>
  vi.mocked(ctx.fillText).mock.calls.map(([line, x, y]) => [line, x, y] as FilledCall);

/**
 * The right INK edge of each drawn line: the anchor plus the measured width, which this file's
 * measurer makes a character count times `CH`.
 */
const inkRights = (calls: FilledCall[]): number[] => calls.map(([line, x]) => x + line.length * CH);

const rect: RectXYSorted = { x1: 0, y1: 0, x2: 200, y2: 120 };

/**
 * A box whose padded interior is 30px wide, against a 90px-wide line — the overflow case the right
 * and centre anchors are measured on. `rect.x1` stays 0 so an anchor that lands left of it is a
 * NEGATIVE coordinate rather than a merely small one.
 */
const narrowRect: RectXYSorted = { x1: 0, y1: 0, x2: 40, y2: 120 };

/**
 * A paragraph box whose padded interior is 100px wide — exactly ten characters at `CH` — and 120px
 * tall, which holds four lines of the 20px/1.1 type below it (`4 * 22 + 10 = 98`).
 */
const paraRect: RectXYSorted = { x1: 0, y1: 0, x2: 110, y2: 120 };

/** `paraRect` shortened to 60px, which the same four lines no longer fit: `98 > 60`. */
const shortParaRect: RectXYSorted = { x1: 0, y1: 0, x2: 110, y2: 60 };

/**
 * Two paragraphs, each of whose hard-broken lines is 13 characters — 130px, wider than
 * `paraRect`'s 100px of wrap width. So the same string is four drawn lines as paragraph type and
 * two over-wide ones as point type, which is what makes the two kinds distinguishable here.
 */
const wrappedText = 'one two three\nfour five six';

const baseArgs: TextToolArgs = {
  text: 'Photoshop',
  align: 'left',
  bold: false,
  color: '#ff0000',
  fontFamily: 'Arial',
  fontSize: 20,
  italic: false,
  lineHeight: 1.1,
  rect,
  toolName: 'text',
};

/**
 * `text` constructs `new OffscreenCanvas(...)`, so the global stub has to be a real class and not a
 * factory — and the replay tripwire below needs an ALLOCATION COUNT, which the shared
 * `makeMockOffscreenCanvas` factory has nowhere to record. Hence a local class; its context still
 * comes from `makeMockCtx`, so it stays a width-only measurer and every baseline asserted through
 * the creator goes down the same 0.8em ascent fallback as the direct `renderText` cases.
 */
class RecordingOffscreenCanvas {
  static instances: RecordingOffscreenCanvas[] = [];

  width: number;
  height: number;
  readonly ctx: CanvasRenderingContext2D;

  constructor(width: number, height: number) {
    this.width = Math.max(1, Math.ceil(width));
    this.height = Math.max(1, Math.ceil(height));
    this.ctx = makeMockCtx({
      canvas: this as unknown as HTMLCanvasElement,
      measureText: vi.fn(widthOnlyMeasure),
    });
    RecordingOffscreenCanvas.instances.push(this);
  }

  getContext(): CanvasRenderingContext2D {
    return this.ctx;
  }
}

describe('fontShorthand', () => {
  it('puts the style and the weight BEFORE the size', () => {
    // The reverse order — `${size}px ${weight} ${family}`, e.g. `64px bold Arial` — is what the CSS
    // font shorthand grammar REJECTS: after the size only a line-height is legal, so `bold` is read
    // as the tail of the family name and the whole declaration is invalid. Chrome does not throw on
    // an invalid `ctx.font`; it silently keeps the previous font, and measured on this host
    // `64px bold Arial` and `64px italic Arial` render pixel-identically to the serif fallback. A
    // failure here means the Bold and Italic buttons swap the typeface instead of weighting it, and
    // nothing anywhere reports an error.
    expect(fontShorthand({ fontFamily: 'Arial', fontSize: 64, bold: false, italic: false })).toBe('64px Arial');
    expect(fontShorthand({ fontFamily: 'Arial', fontSize: 64, bold: true, italic: false })).toBe('bold 64px Arial');
    expect(fontShorthand({ fontFamily: 'Arial', fontSize: 64, bold: false, italic: true })).toBe('italic 64px Arial');
    expect(fontShorthand({ fontFamily: 'Arial', fontSize: 64, bold: true, italic: true })).toBe(
      'italic bold 64px Arial'
    );
  });

  it('emits only the grammar-legal shape, so a multi-word family can never be read as a weight', () => {
    // A weight after the size is not merely unused here — `bold 700 64px Arial` is invalid for the
    // same reason `64px bold Arial` is — which is why there is no numeric weight in the shorthand.
    // A family name with a space in it (`Arial Black`, `Times New Roman`) is the shape that most
    // easily hides a transposed field, so it is the one this walks.
    for (const bold of [false, true]) {
      for (const italic of [false, true]) {
        const shorthand = fontShorthand({ fontFamily: 'Times New Roman', fontSize: 12, bold, italic });

        expect(shorthand).toMatch(/^(italic )?(bold )?\d+(\.\d+)?px .+$/);
        // And the size is the ONLY thing before the family, so a transposition cannot hide behind
        // the family name: `'12px bold Times New Roman'` fails the same anchor as `'12px Arial'`.
        expect(shorthand.slice(0, shorthand.indexOf('px') + 2)).not.toMatch(/px .+/);
      }
    }
  });
});

describe('the Adobe bounds this tool reproduces', () => {
  it('reproduces CharacterStyle.size, CharacterStyle.tracking and autoLeadingAmount exactly', () => {
    // `0.01..1296` is `CharacterStyle.size` "in pixels for a 72ppi document"
    // (https://developer.adobe.com/photoshop/uxp/2022/ps-reference/classes/characterstyle). The bound
    // is on the FIELD, not on rendering, so this is the field's range and nothing else.
    expect(FONT_SIZE_MIN).toBe(0.01);
    expect(FONT_SIZE_MAX).toBe(1296);
    // `-1000..1000` is `CharacterStyle.tracking`
    // (https://helpx.adobe.com/photoshop/using/line-character-spacing.html).
    expect(TRACKING_MIN).toBe(-1000);
    expect(TRACKING_MAX).toBe(1000);
    // `120` is the default of `JustificationProperties.autoLeadingAmount`, configured in the
    // Paragraph panel's flyout under *Justification…*
    // (https://developer.adobe.com/photoshop/uxp/2022/ps_reference/objects/options/justificationproperties/).
    // This app's `lineHeight` is a RATIO rather than an absolute baseline-to-baseline distance, so
    // `AUTO_LEADING` carries the 120% and the semantics stay divergent. A failure here means the
    // seed, the options bar and every line step disagree with Adobe — and nothing about a leading
    // of 1.1 looks wrong to the eye that has to spot it.
    expect(AUTO_LEADING).toBe(1.2);
  });

  it('converts tracking from 1/1000 em into CSS px at the CURRENT type size', () => {
    // "Tracking and kerning are both measured in 1/1000 em… 100 tracking units in a 10-point font
    // are equivalent to 1 point" (Adobe, the page cited for TRACKING_MIN). So the unit is not a
    // length: the same setting moves twice as far at 20px as at 10px. A failure here makes the
    // tracking control scale with nothing at all — tracking that ignores the Size box, or overflows
    // its box at a large size while looking correct at 10px.
    expect(trackingPx({ fontSize: 10, tracking: 100 })).toBe(1);
    expect(trackingPx({ fontSize: 20, tracking: 100 })).toBe(2);
    expect(trackingPx({ fontSize: 20, tracking: -100 })).toBe(-2);
    expect(trackingPx({ fontSize: 64, tracking: TRACKING_MAX })).toBe(64);
    expect(trackingPx({ fontSize: 64, tracking: TRACKING_MIN })).toBe(-64);
    expect(trackingPx({ fontSize: 20, tracking: 0 })).toBe(0);
  });
});

describe('resolveTextStyle', () => {
  it('turns every absent optional into a value', () => {
    // `saveLastSettings` persists the text record VERBATIM, so a settings object written before the
    // character attributes existed comes back without them, and it has to keep working. A renderer
    // reading the raw args got `undefined`, and `undefined * fontSize` is `NaN` — a line at y=NaN,
    // not a visible "no tracking" default. `resolveTextStyle` is the one place that answer lives;
    // a failure here is a restored session that draws nothing, silently.
    expect(resolveTextStyle(baseArgs)).toEqual({
      align: 'left',
      allCaps: false,
      bold: false,
      color: '#ff0000',
      fontFamily: 'Arial',
      fontSize: 20,
      italic: false,
      lineHeight: 1.1,
      smallCaps: false,
      strikethrough: false,
      tracking: 0,
      underline: false,
    });
  });

  it('defaults the line height to the Adobe auto-leading as well', () => {
    // `lineHeight` is REQUIRED on the type, so this `??` cannot be reached from a well-typed
    // record — it is asserted anyway because the alternative is an `undefined` leading that
    // collapses every line onto the first baseline, and a type is not a runtime guarantee. A failure
    // here means the guard was dropped over a branch nothing currently exercises, which is exactly
    // how a guard gets dropped while the branch stays unreached.
    const withoutLeading: Partial<TextToolArgs> = { ...baseArgs };
    delete withoutLeading.lineHeight;

    expect(resolveTextStyle(withoutLeading as TextToolArgs).lineHeight).toBe(AUTO_LEADING);
  });

  it('keeps every value the record does carry', () => {
    // Without this, a resolver that ignored its input and always returned the defaults would pass
    // the assertion above, and the migration would be indistinguishable from a discard of the
    // user's settings. A failure here means the options bar's own values are being thrown away.
    const style = resolveTextStyle({
      ...baseArgs,
      align: 'center',
      bold: true,
      italic: true,
      allCaps: true,
      smallCaps: true,
      strikethrough: true,
      tracking: -40,
      underline: true,
    });

    expect(style).toMatchObject({
      align: 'center',
      bold: true,
      italic: true,
      allCaps: true,
      smallCaps: true,
      strikethrough: true,
      tracking: -40,
      underline: true,
    });
  });

  it('does not mutate or alias the record it resolves', () => {
    // The record is FROZEN, so a single write into it throws rather than passing quietly. If the
    // resolver returned its input (or filled the gaps back in), the resolved defaults would leak
    // into `lastSavedSettings` on the next save and "optional means absent" would quietly stop
    // holding for every later read — which is the whole reason the fields are optional.
    const args = Object.freeze({ ...baseArgs }) as TextToolArgs;

    const style = resolveTextStyle(args);

    expect(style).not.toBe(args);
    expect(Object.hasOwn(args, 'allCaps')).toBe(false);
    expect(Object.hasOwn(args, 'smallCaps')).toBe(false);
    expect(Object.hasOwn(args, 'strikethrough')).toBe(false);
    expect(Object.hasOwn(args, 'tracking')).toBe(false);
    expect(Object.hasOwn(args, 'underline')).toBe(false);
  });

  // A MISSING field and a CORRUPT one are different failures, and `??` only answered the first. A
  // hand-edited or forward-version settings record is an input this resolver's own contract
  // promises to survive, and every way it broke was silent rather than loud.
  const nonFinite = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];

  it.each(nonFinite)('folds a non-finite fontSize (%p) into a drawable size', (bad) => {
    // `fontSize: NaN` built the shorthand `'NaNpx Arial'`, which the CSS grammar REJECTS — and
    // Chrome does not throw on a rejected `ctx.font`, it keeps the previous one. So the drawing
    // context carried on using an older face while `fontSize` itself still reached
    // `calculateNewRect`, and the two halves disagreed about the size of the type.
    const style = resolveTextStyle({ ...baseArgs, fontSize: bad });

    expect(Number.isFinite(style.fontSize)).toBe(true);
    expect(fontShorthand(style)).not.toContain('NaN');
    expect(fontShorthand(style)).not.toContain('Infinity');
  });

  it.each(nonFinite)('folds a non-finite lineHeight (%p) into a drawable leading', (bad) => {
    // `lineHeight: NaN` made every baseline `NaN`, and `fillText` at a `NaN` y draws NOTHING at
    // all — an empty layer, with no error thrown anywhere.
    const style = resolveTextStyle({ ...baseArgs, lineHeight: bad });

    expect(Number.isFinite(style.lineHeight)).toBe(true);
    expect(style.lineHeight).toBe(AUTO_LEADING);
  });

  it.each(nonFinite)('folds a non-finite tracking (%p) into zero', (bad) => {
    // `tracking: NaN` produced `'NaNpx'`, which `ctx.letterSpacing` also rejects silently, and sent
    // `inkWidth` down its per-cluster fallback with a `NaN` cursor.
    expect(resolveTextStyle({ ...baseArgs, tracking: bad }).tracking).toBe(0);
  });

  it('clamps a fontSize to the Adobe bounds rather than only rejecting a bad type', () => {
    // `0.01` and `1296` are Adobe's own `CharacterStyle.size` range, so folding to them is the same
    // rule the options bar applies on entry rather than a second policy. `NaN` is not in either
    // list, which is why the two are separate cases above.
    expect(resolveTextStyle({ ...baseArgs, fontSize: 1e9 }).fontSize).toBe(FONT_SIZE_MAX);
    expect(resolveTextStyle({ ...baseArgs, fontSize: -12 }).fontSize).toBe(FONT_SIZE_MIN);
  });

  it('leaves a leading of zero alone, because zero is finite and drawable', () => {
    // The guard is about DRAWABILITY, not about the bar's range: `MIN_LINE_HEIGHT` belongs to the
    // slider, and folding 0 up to 0.5 would have silently changed the arithmetic that
    // `it('stacks lines on top of each other for a zero line height')` pins.
    expect(resolveTextStyle({ ...baseArgs, lineHeight: 0 }).lineHeight).toBe(0);
  });
});

describe('resolveTextKind', () => {
  it('resolves a record with no kind to point, and an explicit kind to itself', () => {
    // The default is a MIGRATION decision, not a design one: every text layer, history entry and
    // settings record written before this field existed was laid out by a renderer that grew its
    // box to the widest line and never wrapped — point type by Adobe's own words ("Text that does
    // not wrap"). `saveLastSettings` persists the record verbatim, so the gap is real and
    // permanent, and resolving it as `paragraph` would re-flow every existing document's text the
    // moment it was loaded.
    expect(Object.hasOwn(baseArgs, 'kind')).toBe(false);
    expect(resolveTextKind(baseArgs)).toBe('point');
    expect(resolveTextKind({ ...baseArgs, kind: 'point' })).toBe('point');
    expect(resolveTextKind({ ...baseArgs, kind: 'paragraph' })).toBe('paragraph');
  });
});

describe('textWrapWidth', () => {
  it('offers the text the box less the padding on BOTH sides', () => {
    // 110 - 10 - 10 = 90, and 200 - 100 - 10 = 90: the second case puts `x1` somewhere other
    // than zero, so a width measured from the ORIGIN or a subtraction of one padding instead of
    // two would pass the first and fail the second.
    expect(textWrapWidth({ x1: 10, y1: 0, x2: 110, y2: 120 })).toBe(90);
    expect(textWrapWidth({ x1: 100, y1: 0, x2: 200, y2: 120 })).toBe(90);
    expect(textWrapWidth(narrowRect)).toBe(30);
  });
});

describe('requiredHeightForLines', () => {
  // The box has to contain the INK, and the ink is taller than the line SPACING whenever the
  // leading is under the font's own ascent: the first baseline sits at `y1 + TEXT_PADDING + ascent`,
  // so a step shorter than the ascent put that baseline below the box the layer is sized from. The
  // committed layer's canvas IS the box, so this was missing pixels in the FILE rather than a
  // drawing artifact — and the leading slider's floor is far under the threshold, so every draft
  // at a low leading hit it.
  const context = makeTextCtx({ measure: metricMeasure });
  const style = (lineHeight: number) => resolveTextStyle({ ...baseArgs, fontSize: 20, lineHeight });

  it('holds the ascent and the descent when the leading is below the ascent', () => {
    // metricMeasure reports 58px of ascent and no descent, so the fallback descent applies:
    // 58 + 0.2 * 20 = 62 of ink against a step of 20 * 0.5 = 10.
    const height = requiredHeightForLines(context, style(0.5), 1);

    expect(height).toBe(Math.max(10, 58 + 4) + TEXT_PADDING * 2);
    // And the box is tall enough that a baseline at `y1 + PAD + ascent` still lands inside it.
    expect(height - TEXT_PADDING).toBeGreaterThan(58);
  });

  it('uses the line step when the leading is the generous one', () => {
    // 4 lines at 20px and 1.2 is 96 of step, well over the 62 of ink, so nothing changes for an
    // ordinary leading — which is why this was only ever visible at the bottom of the slider.
    expect(requiredHeightForLines(context, style(1.2), 4)).toBe(4 * 20 * 1.2 + TEXT_PADDING * 2);
  });

  it('never reports a height smaller than one line of ink, whatever the count', () => {
    for (const lineHeight of [0, 0.5, 1, 1.2, 2.25]) {
      expect(requiredHeightForLines(context, style(lineHeight), 1)).toBeGreaterThan(58);
    }
  });

  it('grows with the line count once the ink stops being the binding term', () => {
    // Both ends have to sit ABOVE the ink height of 62, or the difference is not the step: at one
    // line and 1.2 the box is ink-bound (72) while at four it is step-bound (106), and their
    // difference is 34 rather than three steps of 24 — which is exactly why the ink term exists.
    const five = requiredHeightForLines(context, style(1.2), 5);
    const eight = requiredHeightForLines(context, style(1.2), 8);

    expect(five).toBe(5 * 20 * 1.2 + TEXT_PADDING * 2);
    expect(eight - five).toBe(3 * 20 * 1.2);
  });
});

describe('layoutText', () => {
  it('lays out point type as hard breaks only, whatever the box would have been', () => {
    // `wrapWidth` is `Infinity` for point type, which makes every line fit by construction — so
    // `'a\nb'` is two lines and a line far wider than any box is still ONE line. Asserting the
    // absence of measurements as well is what proves the breaker was skipped rather than fed an
    // infinite width: the fit test it runs would measure every line once to prove it fits.
    const ctx = makeTextCtx();
    const style = resolveTextStyle(baseArgs);

    const layout = layoutText(ctx, style, 'a\nb', Infinity);

    expect(layout.lines).toEqual(['a', 'b']);
    expect(layoutText(ctx, style, 'Photoshop is longer than any box', Infinity).lines).toEqual([
      'Photoshop is longer than any box',
    ]);
    expect(measured(ctx)).toEqual([]);
  });

  it('wraps a paragraph into lines that each fit the width, losing no word', () => {
    // Adobe's paragraph type is "Text that wraps within a bounding box", and `wrapWidth` is what
    // the box offers it. 'a bb ccc d eee' is 140px at `CH`, so at 50px it cannot be one line, and
    // 'ccc d' lands EXACTLY on the limit — which is what pins the comparison as `<=` rather
    // than `<`.
    const ctx = makeTextCtx();
    const style = resolveTextStyle(baseArgs);
    const body = 'a bb ccc d eee';

    const layout = layoutText(ctx, style, body, 5 * CH);

    expect(layout.lines).toEqual(['a bb', 'ccc d', 'eee']);
    expect(layout.lines.length).toBeGreaterThan(1);
    for (const line of layout.lines) {
      expect(line.length * CH).toBeLessThanOrEqual(50);
    }
    // Every word survives, in order. This is a REFLOW, not a truncation, and a breaker that
    // dropped the overflowing word — or measured one twice and kept the stale copy — would keep
    // the line count and lose this.
    expect(layout.lines.join(' ')).toBe(body);
  });

  it('keeps a hard break a hard break, and never merges two paragraphs onto one line', () => {
    // Canvas has no hard break of its own: measured on Chromium, `measureText('a\nb')` equals
    // `measureText('a b')` and `fillText('a\nb')` inks the same pixels. So a line that kept its
    // '\n' would be drawn as ONE line with a space where the break should be, which is the
    // failure this asserts against — the joined `paragraph 1paragraph 2` a naive splitter produces.
    const ctx = makeTextCtx();
    const style = resolveTextStyle(baseArgs);

    const layout = layoutText(ctx, style, 'a bb ccc\nd e f', 5 * CH);

    expect(layout.lines).toEqual(['a bb', 'ccc', 'd e f']);
    expect(layout.lines.some((line) => line.includes('\n'))).toBe(false);
  });

  it('never breaks or hyphenates a word too wide for the box', () => {
    // Adobe's hyphenation is off by default — `ParagraphStyle.hyphenation` is "boolean … Default
    // false" — so a word wider than the box overflows instead of being divided. A substring test
    // cannot tell 'Photosh' + 'op' from the whole word, so the intact token is asserted as a
    // line of its own.
    const ctx = makeTextCtx();
    const style = resolveTextStyle(baseArgs);

    const layout = layoutText(ctx, style, 'hi Photoshop there', 3 * CH);

    expect(layout.lines).toEqual(['hi', 'Photoshop', 'there']);
    expect(layout.lines.filter((line) => line.includes('Photosh'))).toEqual(['Photoshop']);
    expect(layout.lines.every((line) => !line.includes('-'))).toBe(true);
  });

  it('does not break early on a trailing space, which canvas measures and CSS does not', () => {
    // CSS removes a collapsible space at the end of a line; canvas does not, and the measured
    // difference is real (`measureText('ab ') - measureText('ab')` is 5.557px at 64px). Without the
    // trim before the fit test this first paragraph breaks after 'ab' AND the trailing empty token
    // opens a blank line — four lines where Photoshop has two.
    const ctx = makeTextCtx();
    const style = resolveTextStyle(baseArgs);

    const layout = layoutText(ctx, style, 'ab cd \nef gh ', 5 * CH);

    expect(layout.lines).toEqual(['ab cd ', 'ef gh ']);
    expect(layout.lines).toHaveLength(2);
  });

  it('reports overflow only against a box height it was actually given', () => {
    // Three wrapped lines at 20px/1.1 need `3 * 22 + 10 = 76`. The absent `boxHeight` is the
    // CREATOR's case — the layer canvas IS the box, so every line fits it by construction — and it
    // must not be read as zero, which the 0px case below distinguishes.
    const ctx = makeTextCtx();
    const style = resolveTextStyle(baseArgs);
    const body = 'a bb ccc d eee';
    const required = 76;

    expect(layoutText(ctx, style, body, 5 * CH).overflow).toBe(false);
    expect(layoutText(ctx, style, body, 5 * CH, 0).overflow).toBe(true);
    // The comparison is `>`, so a box exactly the required height is not an overflow…
    expect(layoutText(ctx, style, body, 5 * CH, required).overflow).toBe(false);
    // …and one pixel short of it is.
    expect(layoutText(ctx, style, body, 5 * CH, required - 1).overflow).toBe(true);
  });

  it('measures the box against the WRAPPED line count, not the hard-break count', () => {
    // The height of a paragraph box is a function of its WIDTH, so it cannot be read off
    // `text.split('\n').length`: this string has no '\n' at all and is three lines once laid out,
    // and 60px of box is plenty for the 32px a single line would need.
    const ctx = makeTextCtx();
    const style = resolveTextStyle(baseArgs);
    const body = 'a bb ccc d eee';

    expect(body.split('\n')).toHaveLength(1);
    expect(getTextLineCount(ctx, { ...baseArgs, text: body }, 5 * CH)).toBe(3);
    expect(layoutText(ctx, style, body, 5 * CH, 60).lines).toHaveLength(3);
    expect(layoutText(ctx, style, body, 5 * CH, 60).overflow).toBe(true);
  });

  it('reports an overflow for a line too WIDE for the box, not only for one too tall', () => {
    // Adobe's condition is "more text than can fit within a paragraph boundary", which is about the
    // BOUNDARY rather than about the number of lines. A single token too wide for the box overflows
    // it sideways while the line count stays at one and the height fits perfectly — so the height
    // comparison alone could never raise the icon for the very case Adobe documents as the expected
    // outcome of his off-by-default hyphenation, and the icon is the only signal the user gets.
    const ctx = makeTextCtx();
    const style = resolveTextStyle(baseArgs);
    // 'Photoshop' is one token; a box two characters wide cannot hold it and must not break it.
    const tooNarrow = 2 * CH;

    const layout = layoutText(ctx, style, 'Photoshop', tooNarrow, 1000);

    expect(layout.lines).toEqual(['Photoshop']);
    expect(layout.lines).toHaveLength(1);
    // A box a thousand tall, so the height cannot be what is reporting this.
    expect(layout.overflow).toBe(true);
    // And the same text in a box that holds it reports nothing.
    expect(layoutText(ctx, style, 'Photoshop', 20 * CH, 1000).overflow).toBe(false);
  });

  it('breaks at a tab and at a run of spaces, and not at a non-breaking space', () => {
    // A pattern rather than `split(' ')`, because Photoshop breaks paragraph type at a whitespace
    // RUN: three tab-separated columns are one U+0020-free token under the old rule, so they could
    // never be broken, were emitted alone, overflowed by hundreds of pixels and reported nothing.
    const ctx = makeTextCtx();
    const style = resolveTextStyle(baseArgs);
    // Three characters wide, so a two-word candidate (five characters) cannot fit and every word
    // has to start a line of its own.
    const wrap = 3 * CH;

    expect(layoutText(ctx, style, 'ab\tcd\tef', wrap).lines).toEqual(['ab', 'cd', 'ef']);
    expect(layoutText(ctx, style, 'ab   cd   ef', wrap).lines).toEqual(['ab', 'cd', 'ef']);
    // NBSP is in `\s`, so it is excluded by character class rather than stripped afterwards —
    // `1 kg` is one token, and the line overflows rather than breaking at the space.
    expect(layoutText(ctx, style, '1 kg', wrap).lines).toEqual(['1 kg']);
    // Whatever the run, the words survive: the breaker splits between tokens and never inside one.
    const rejoined = layoutText(ctx, style, 'ab\tcd\tef', wrap).lines.join(' ');
    expect(rejoined).toBe('ab cd ef');
  });

  it('keeps a whitespace-only body to one line rather than one line per space', () => {
    // Three spaces split into four empty tokens under the old rule, and each was measured and
    // emitted as its own line — three blank lines of height for a body with no ink in it.
    const ctx = makeTextCtx();
    const style = resolveTextStyle(baseArgs);

    expect(layoutText(ctx, style, '   ', 5 * CH).lines).toHaveLength(1);
  });

  it('does not trim a non-breaking space out of the fit test', () => {
    // `String.prototype.trimEnd` deletes U+00A0 — it is in the ES `WhiteSpace` production — so the
    // old trim measured the fit against a line one space narrower than the one `fillLine` drew, an
    // overflow the layout could not see and the box could not grow to cover.
    const ctx = makeTextCtx();
    const style = resolveTextStyle(baseArgs);

    // 'ab' plus a trailing NBSP is three characters, which is wider than the two-character
    // box that holds the plain 'ab' exactly. The escape is SPELLED OUT rather than pasted, because
    // an invisible NBSP in a source file is indistinguishable from the very space this case is
    // about — and it is the collapsible space's behaviour that is the control.
    expect(layoutText(ctx, style, 'ab\u00A0', 2 * CH).overflow).toBe(true);
    expect(layoutText(ctx, style, 'ab ', 2 * CH).overflow).toBe(false);
    expect(layoutText(ctx, style, 'ab ', 2 * CH).overflow).toBe(true);
  });
});

describe('renderText', () => {
  describe('the guard on a draft with nothing to draw', () => {
    it('draws nothing at all for an empty string', () => {
      // The guard is `!text`, so an empty draft returns before `resetOverlayAlpha` and before any
      // style assignment — `fillStyle` is still the mock's initial ''. A failure means a committed
      // empty text layer stamps a no-op pass over the shared overlay alpha, which is how a ghosted
      // draft at another tool's alpha gets introduced.
      const ctx = makeTextCtx();

      renderText(ctx, { ...baseArgs, text: '' });

      expect(ctx.fillText).not.toHaveBeenCalled();
      expect(ctx.fillRect).not.toHaveBeenCalled();
      expect(ctx.fillStyle).toBe('');
    });

    it('draws nothing when the text is missing entirely', () => {
      // `text` is optional on the args, so "no text" has two spellings: `''` and absent. Only the
      // first is falsy-but-present, and a guard written as `'text' in args` would pass this file
      // and still fail on the other.
      const ctx = makeTextCtx();

      renderText(ctx, { ...baseArgs, text: undefined });

      expect(ctx.fillText).not.toHaveBeenCalled();
      expect(ctx.fillRect).not.toHaveBeenCalled();
    });

    it('draws nothing without a rect, whether it is null or absent', () => {
      // A text layer outlives the drag that made it, and `rect` is optional on the args for the
      // same reason `text` is. Either spelling has to leave the canvas untouched.
      for (const withoutRect of [null, undefined] as const) {
        const ctx = makeTextCtx();

        renderText(ctx, { ...baseArgs, rect: withoutRect });

        expect(ctx.fillText).not.toHaveBeenCalled();
        expect(ctx.fillRect).not.toHaveBeenCalled();
      }
    });

    it('draws nothing when both the text and the rect are absent', () => {
      // Exactly the seed a fresh switch to the Text tool arrives with: `defaultSettings.text`
      // carries `text: ''` and `rect: null` (`src/tools/settings.ts:83-100`). It is the ONE state
      // both halves of the guard agree on, so it is asserted on its own rather than only as a
      // combination of the two cases above.
      const ctx = makeTextCtx();

      renderText(ctx, { ...baseArgs, text: '', rect: null });

      expect(ctx.fillText).not.toHaveBeenCalled();
      expect(ctx.fillRect).not.toHaveBeenCalled();
      expect(ctx.fillStyle).toBe('');
    });
  });

  describe('the shared overlay alpha', () => {
    it('fills at full opacity when the shared overlay was left at another tool alpha', () => {
      // The overlay canvas is shared by every overlay tool, and the pen deliberately leaves its own
      // Opacity written on it rather than bracketing it back (`src/tools/draw.ts:91`), so
      // `globalAlpha` arrives here as whatever that tool's slider says. Captured INSIDE `fillText`,
      // because reading `ctx.globalAlpha` afterwards would pass even if the reset happened after the
      // draw — which is the order that matters for what the user sees.
      const ctx = makeTextCtx();
      const alphaAtFill: number[] = [];
      vi.mocked(ctx.fillText).mockImplementation(() => {
        alphaAtFill.push(ctx.globalAlpha);
      });
      ctx.globalAlpha = 0.2;

      renderText(ctx, baseArgs);

      expect(alphaAtFill).toEqual([1]);
      expect(ctx.globalAlpha).toBe(1);
    });

    it('does not resurrect a leaked alpha for a draft with nothing to draw', () => {
      // The flip side of the guard above, and the reason the guard is ABOVE `resetOverlayAlpha`: a
      // draft that draws nothing must leave the shared alpha exactly as it found it, because the
      // next overlay tool to paint inherits it.
      const ctx = makeTextCtx();
      ctx.globalAlpha = 0.2;

      renderText(ctx, { ...baseArgs, text: '' });

      expect(ctx.fillText).not.toHaveBeenCalled();
      expect(ctx.globalAlpha).toBe(0.2);
    });
  });

  describe('the context state a glyph is drawn with', () => {
    it('composes the font shorthand through fontShorthand', () => {
      // Not a restatement of the fontShorthand suite: this is the wiring. A renderer that built the
      // string itself, or skipped the helper, would reintroduce the transposed order that helper
      // exists to prevent — and every assertion in this file would still pass, because they assert
      // coordinates and not typefaces.
      const ctx = makeTextCtx();

      renderText(ctx, { ...baseArgs, italic: true, bold: true });

      // Read DURING the draw, through `applied`. `renderText` brackets itself, so by the time it
      // returns the context is back to its seed — and reading it then would measure the restore
      // rather than the drawing, which is how this case came to pin the value the renderer used to
      // LEAK into the shared overlay as though the leak were the feature.
      expect(styledDuringDraw(ctx, 'font')).toBe('italic bold 20px Arial');
      // And the seed is what the caller gets back, which is the other half of the same fix.
      expect(ctx.font).toBe('10px sans-serif');
    });

    it('anchors every line at "start" and measures every y from the alphabetic baseline', () => {
      // Both of these used to be per-alignment and `'top'`. `textAlign` is now always `'start'`
      // because the anchor is computed from the measured ink width and the browser is never asked
      // to place the glyphs; `textBaseline` is `'alphabetic'` because every decoration this tool
      // draws is positioned relative to a baseline it can NAME — and `'top'` is a font-dependent
      // constant no exposed metric reproduces (0.7627em for Times, 0.8760em for Impact, 0.75em for
      // the generic families, all at 64px). A failure here means an underline or a strikethrough
      // placed against an offset this app cannot compute for the family in use.
      for (const align of ['left', 'center', 'right'] as const) {
        const ctx = makeTextCtx();

        renderText(ctx, { ...baseArgs, align });

        expect(ctx.textBaseline).toBe('alphabetic');
        expect(ctx.textAlign).toBe('start');
      }
    });

    it("leaves the caller's typography alone when it returns", () => {
      // The one assertion that would have caught the leak. `applyTextStyle` is not a measurement, it
      // writes `font`, `textBaseline`, `textAlign`, `letterSpacing` and `fontVariantCaps` onto the
      // caller's context — and `renderText` is handed the LIVE tool overlay, the same object
      // `overlayCtxRef` and `toolOverlayRef` resolve to, which lives for the whole session. So an
      // unbracketed version left the overlay wearing the draft's typeface, tracking and caps variant
      // after the user left the Type tool, for every later overlay painter to inherit. The three
      // measurers in this file were bracketed for exactly this reason and this one was not.
      //
      // `makeTextCtx` models `save`/`restore` as bare spies, so the bracket has to be asserted
      // through its EFFECT on a real property rather than by counting the calls.
      const ctx = makeTextCtx();
      ctx.font = '10px sans-serif';

      renderText(ctx, { ...baseArgs, tracking: 250, allCaps: true });

      expect(ctx.font).toBe('10px sans-serif');
      // And the state `applyTextStyle` wrote is visible while the type is being drawn, which is what
      // makes the restore above a restore rather than a no-op that never applied anything.
      expect(ctx.fontVariantCaps).not.toBe('normal');
      expect(ctx.letterSpacing).not.toBe('0px');
    });

    it("restores the caller's alpha after rendering a draft", () => {
      // `resetOverlayAlpha` is a WRITE and not a restore, so it has to sit OUTSIDE the bracket —
      // `restore()` would undo it — and it has to stay after the `!text || !rect` guard so a no-op
      // draft leaves the shared alpha as it found it. Both directions are pinned below.
      const ctx = makeTextCtx();
      ctx.globalAlpha = 0.2;

      renderText(ctx, baseArgs);

      expect(ctx.globalAlpha).toBe(1);

      const untouched = makeTextCtx();
      untouched.globalAlpha = 0.2;
      renderText(untouched, { ...baseArgs, text: '' });
      expect(untouched.globalAlpha).toBe(0.2);
    });
  });

  describe('the per-line baseline', () => {
    it('drops the first baseline by the measured font ascent below the padded top', () => {
      // `rect.y1 + TEXT_PADDING + fontBoundingBoxAscent`: the line box is `fontSize * lineHeight`
      // tall and the font's own ascent fills it from the top, so the baseline sits one ascent down.
      // `fontBoundingBoxAscent` is size-dependent (58px for Arial at 64px, 0.90625em), which is why
      // it is measured per render instead of assumed to be a constant fraction. 5 + 58 = 63.
      const ctx = makeTextCtx({ measure: metricMeasure });

      renderText(ctx, baseArgs);

      expect(ctx.fillText).toHaveBeenCalledWith('Photoshop', TEXT_PADDING, 63);
    });

    it('falls back to 0.8em when the context reports no font metrics', () => {
      // A measurer that reports `{ width }` and nothing else is the shape a bare canvas mock has,
      // and without the fallback this coordinate is `NaN` — which `fillText` accepts silently and
      // draws nothing for. 5 + 0.8 * 20 = 21.
      const ctx = makeTextCtx();

      renderText(ctx, baseArgs);

      expect(measured(ctx)).toContain('');
      expect(ctx.fillText).toHaveBeenCalledWith('Photoshop', TEXT_PADDING, 21);
    });

    it('steps consecutive lines by fontSize * lineHeight', () => {
      // 20 * 1.1 = 22 per step on top of the 21 first baseline: 21, 43, 65. A lineStep computed
      // from anything else — a fixed offset, the ascent, the leading alone without the size —
      // moves the second line and leaves the first where it was, so all three are asserted.
      const ctx = makeTextCtx();

      renderText(ctx, { ...baseArgs, text: 'one\ntwo\nthree' });

      expect(ctx.fillText).toHaveBeenCalledTimes(3);
      expect(ctx.fillText).toHaveBeenNthCalledWith(1, 'one', TEXT_PADDING, 21);
      expect(ctx.fillText).toHaveBeenNthCalledWith(2, 'two', TEXT_PADDING, 43);
      expect(ctx.fillText).toHaveBeenNthCalledWith(3, 'three', TEXT_PADDING, 65);
    });

    it('stacks lines on top of each other for a zero line height', () => {
      // A leading of 0 is not reachable from the bar — its slider stops at 0.5
      // (`src/components/ToolbarsRight/Text/Text.tsx:172`) — so this pins the ARITHMETIC for a
      // persisted or hand-edited record: the step is `fontSize * lineHeight`, and 0 is a legitimate
      // value of that expression, not a special case the renderer has to recognise. It is not a
      // behaviour that matches Photoshop.
      const ctx = makeTextCtx();

      renderText(ctx, { ...baseArgs, text: 'a\nb', lineHeight: 0 });

      expect(ctx.fillText).toHaveBeenNthCalledWith(1, 'a', TEXT_PADDING, 21);
      expect(ctx.fillText).toHaveBeenNthCalledWith(2, 'b', TEXT_PADDING, 21);
    });
  });

  describe('the per-line anchor', () => {
    it('puts a left-aligned line at the padded left edge', () => {
      // 5 + 0 = 5: the anchor is the box, not the glyph, and `textAlign` is `'start'` so the
      // browser adds nothing of its own.
      const ctx = makeTextCtx();

      renderText(ctx, baseArgs);

      expect(ctx.fillText).toHaveBeenCalledWith('Photoshop', TEXT_PADDING, 21);
    });

    it('centres a line on the PADDED box, not on the rect', () => {
      // `boxLeft + (boxRight - boxLeft - width) / 2` = 5 + (195 - 5 - 90) / 2 = 55. Centring on the
      // rect midpoint (100) instead would leave every centred line a half-padding off, and the
      // error grows with the padding rather than staying constant.
      const ctx = makeTextCtx();

      renderText(ctx, { ...baseArgs, align: 'center' });

      expect(ctx.fillText).toHaveBeenCalledWith('Photoshop', 55, 21);
    });

    it('anchors a right-aligned line to the padded right edge', () => {
      // `boxRight - width` = 195 - 90 = 105, which is the right ink edge rather than the right
      // edge of the advance: the same measured width the underline is drawn to.
      const ctx = makeTextCtx();

      renderText(ctx, { ...baseArgs, align: 'right' });

      expect(ctx.fillText).toHaveBeenCalledWith('Photoshop', 105, 21);
    });

    it('anchors an over-wide right-aligned line LEFT of x1 instead of clamping it', () => {
      // A line wider than its box has no answer inside the box, so it overflows: 35 - 90 = -55, on
      // a box that starts at x1 = 0. The arithmetic is asserted EXACTLY and deliberately UNCLAMPED,
      // because a clamp would silently re-anchor the line to the box edge — turning an overflow into
      // something else — and no other assertion in this file would notice.
      const ctx = makeTextCtx();

      renderText(ctx, { ...baseArgs, align: 'right', rect: narrowRect });

      expect(ctx.fillText).toHaveBeenCalledWith('Photoshop', -55, 21);
    });

    it('centres an over-wide line on the padded box, which also puts it left of x1', () => {
      // 5 + (30 - 90) / 2 = -25. Centring on the box rather than on the line's own midpoint is what
      // keeps the overflow SYMMETRIC: 30px sticks out of each side, so a growing string does not
      // walk across the canvas.
      const ctx = makeTextCtx();

      renderText(ctx, { ...baseArgs, align: 'center', rect: narrowRect });

      expect(ctx.fillText).toHaveBeenCalledWith('Photoshop', -25, 21);
    });
  });

  describe('the two kinds of type layer', () => {
    it('draws one fillText per WRAPPED line, stepping the baselines by fontSize * lineHeight', () => {
      // `paraRect` offers 100px of wrap width and `wrappedText`'s hard-broken lines are 130px, so
      // 'one two three' becomes 'one two' (70px) and 'three' (50px), and 'four five six' becomes
      // 'four five' (90px) and 'six' (30px) — four calls, on a 22px step off the 21px first
      // baseline. A renderer that split only on '\n' would draw two lines and step nothing.
      const ctx = makeTextCtx();

      renderText(ctx, { ...baseArgs, text: wrappedText, rect: paraRect, kind: 'paragraph' });

      expect(filled(ctx)).toEqual([
        ['one two', TEXT_PADDING, 21],
        ['three', TEXT_PADDING, 43],
        ['four five', TEXT_PADDING, 65],
        ['six', TEXT_PADDING, 87],
      ]);
    });

    it('keeps every wrapped line inside the box it was laid out for', () => {
      // Left-aligned, so each line's ink runs from the padded left edge to `x + measured width`,
      // and `paraRect`'s padded right edge is 105. Every one of these is at or inside it; point type
      // puts the same text 135px out. A wrap width taken from the box rather than its PADDED
      // interior would put 'four five' 5px past the edge, which is the size of one padding and so
      // the one error this arithmetic can hide.
      const ctx = makeTextCtx();

      renderText(ctx, { ...baseArgs, text: wrappedText, rect: paraRect, kind: 'paragraph' });

      expect(inkRights(filled(ctx))).toEqual([75, 55, 95, 35]);
      expect(inkRights(filled(ctx)).every((right) => right <= paraRect.x2 - TEXT_PADDING)).toBe(true);
    });

    it('draws point type one line per hard break, overflowing rather than wrapping', () => {
      // "each line of type is independent — the line expands or shrinks as you edit it, but it
      // doesn't wrap to the next line" (Adobe). Same text, same box as the two cases above: two
      // calls instead of four, each 130px of ink in a 100px wrap width — which is the overflow the
      // paragraph case does not have. The second context has NO `kind` at all, because that is
      // every record written before the field existed and the migration has to be exact.
      const args = { ...baseArgs, text: wrappedText, rect: paraRect };
      const ctx = makeTextCtx();
      const migrated = makeTextCtx();

      renderText(ctx, { ...args, kind: 'point' });
      renderText(migrated, args);

      expect(filled(ctx)).toEqual([
        ['one two three', TEXT_PADDING, 21],
        ['four five six', TEXT_PADDING, 43],
      ]);
      expect(filled(migrated)).toEqual(filled(ctx));
      expect(Math.max(...inkRights(filled(ctx)))).toBeGreaterThan(paraRect.x2 - TEXT_PADDING);
    });
  });

  describe('the overflow icon', () => {
    it('draws nothing when the text fits the box', () => {
      // Four lines is `4 * 22 + 10 = 98` of a 120px box: the same text and the same width as the
      // case below, differing ONLY in the height the box offers, so the icon is pinned to the fit
      // and not to the presence of a paragraph.
      const ctx = makeTextCtx();

      renderText(
        ctx,
        { ...baseArgs, text: wrappedText, rect: paraRect, kind: 'paragraph' },
        { overflowIndicator: true }
      );

      expect(ctx.fillText).toHaveBeenCalledTimes(4);
      expect(ctx.strokeRect).not.toHaveBeenCalled();
      expect(ctx.beginPath).not.toHaveBeenCalled();
      expect(ctx.stroke).not.toHaveBeenCalled();
    });

    it('strokes a boxed plus in the bottom-right corner of the box the text outgrew', () => {
      // Adobe: "If you enter more text that can fit within a paragraph boundary…, a small box or
      // circle containing a plus symbol (+) appears in place of a handle in the corner of the
      // boundary" (https://helpx.adobe.com/photoshop/using/creating-type.html). An 8px box whose
      // top-left is (97.5, 47.5) — the padded bottom-right corner of a 110x60 box is (105, 55),
      // less the icon's own 8px, snapped onto the half-pixel grid so a 1px rule is not smeared
      // over two rows.
      const ctx = makeTextCtx();
      const order: string[] = [];
      let styleAtStroke = '';
      vi.mocked(ctx.save).mockImplementation(() => void order.push('save'));
      vi.mocked(ctx.restore).mockImplementation(() => void order.push('restore'));
      vi.mocked(ctx.stroke).mockImplementation(() => {
        order.push('stroke');
        styleAtStroke = String(ctx.strokeStyle);
      });

      renderText(
        ctx,
        { ...baseArgs, text: wrappedText, rect: shortParaRect, kind: 'paragraph' },
        { overflowIndicator: true }
      );

      expect(ctx.strokeRect).toHaveBeenCalledTimes(1);
      expect(ctx.strokeRect).toHaveBeenCalledWith(97.5, 47.5, 8, 8);
      // And the plus inside it: two arms through the centre of that box, 2px each way.
      expect(vi.mocked(ctx.moveTo).mock.calls).toEqual([
        [99, 51],
        [101, 49],
      ]);
      expect(vi.mocked(ctx.lineTo).mock.calls).toEqual([
        [103, 51],
        [101, 53],
      ]);
      // The icon is chrome, not ink, so it is drawn in the TYPE colour and bracketed by
      // save/restore — an unbracketed `strokeStyle` would leave the shared overlay wearing it for
      // the next tool, and the order is what proves the bracket rather than a trailing restore.
      //
      // The BRACKET is the assertion, not a particular number of them, so it is stated as one:
      // the stroke happens at a non-zero save depth, and every save is matched by a restore. An exact
      // sequence would be over-specified — `renderText`, `layoutText` and `requiredHeightForLines`
      // each open a bracket now, because each of them MEASURES and a context measures in whatever
      // face it is wearing — so pinning the count would break on the next honest bracket rather
      // than on a defect.
      expect(styleAtStroke).toBe('#ff0000');
      const depthBefore = order.slice(0, order.indexOf('stroke')).filter((op) => op === 'save').length;
      expect(depthBefore).toBeGreaterThan(0);
      const saves = order.filter((op) => op === 'save').length;
      const restores = order.filter((op) => op === 'restore').length;
      expect({ saves, restores }).toEqual({ saves: restores, restores });
      expect(order.lastIndexOf('restore')).toBeGreaterThan(order.indexOf('stroke'));
    });

    it('draws no indicator on the default call, even for text that overflows', () => {
      // The creator renders through this same default call, and a committed layer's canvas IS its
      // own box: an icon baked into a layer would be painted into the image, where Photoshop has
      // no such thing. The four `fillText` calls are asserted so this cannot pass by drawing
      // nothing at all.
      const ctx = makeTextCtx();

      renderText(ctx, { ...baseArgs, text: wrappedText, rect: shortParaRect, kind: 'paragraph' });

      expect(ctx.fillText).toHaveBeenCalledTimes(4);
      expect(ctx.strokeRect).not.toHaveBeenCalled();
      expect(ctx.stroke).not.toHaveBeenCalled();
    });
  });

  describe('tracking', () => {
    it.each([
      [0, '0px'],
      [100, '2px'],
      [-100, '-2px'],
      [1000, '20px'],
    ])('writes %i tracking units as the exact string %s', (tracking, expected) => {
      // The string is asserted for SHAPE as well as value. Chrome silently rejects a `letterSpacing`
      // value carrying surrounding whitespace — the property keeps its previous value, the tracking
      // control does nothing, and nothing throws — so `'2px '` would pass any check that merely
      // looked for `px` while the feature was broken on every render.
      const ctx = makeTextCtx({ modern: true });

      renderText(ctx, { ...baseArgs, tracking });

      // `applied`, not `ctx.letterSpacing`: the renderer restores the context before it returns, so
      // the value that proves the string was WRITTEN is the one in effect while it drew. Reading the
      // property afterwards read the seed and this case pinned a leak.
      expect(styledDuringDraw(ctx, 'letterSpacing')).toBe(expected);
      expect(styledDuringDraw(ctx, 'letterSpacing')).toMatch(/^-?\d+(\.\d+)?px$/);
    });

    it('never creates a letterSpacing property on a context that lacks one', () => {
      // The guard is `'letterSpacing' in ctx`, because a prototype-deletion test on the real
      // browser is a false pass. Assigning the property anyway would defeat the guard: the fallback
      // branch downstream reads the SAME test, so a stray assignment would flip it and the manual
      // cluster placement would never run on a context that needed it.
      const ctx = makeTextCtx();

      expect('letterSpacing' in ctx).toBe(false);
      renderText(ctx, { ...baseArgs, tracking: 100 });
      expect('letterSpacing' in ctx).toBe(false);
    });

    it('anchors and underlines to the INK width, not to the advance the shaper reports', () => {
      // Chrome's `letterSpacing` adds the gap to the LAST character's advance too, so the advance
      // over-reports by exactly one spacing: 90 measured, 88 of ink. Every coordinate derived from
      // the line has to use the ink, or a tracked line grows a gap at its right edge that no glyph
      // ever fills — and the underline would be drawn a gap longer than the text above it.
      const ctx = makeTextCtx({ modern: true });

      renderText(ctx, { ...baseArgs, tracking: 100, underline: true });

      expect(ctx.fillText).toHaveBeenCalledWith('Photoshop', TEXT_PADDING, 21);
      expect(ctx.fillRect).toHaveBeenCalledWith(TEXT_PADDING, 23, 88, 1);
    });

    it('places each grapheme cluster itself when the platform has no letterSpacing', () => {
      // The honest degradation: no API asks for one kerned pair at a time, so measuring a string
      // cluster by cluster is measuring its parts — on 'WAVE AV' at 64px the manual total is 11.875px
      // wider than the kerned one, and any ligature the font would have formed across a boundary is
      // gone. The cursor steps by each cluster's own advance plus one gap: 5, then 5 + 10 + 2 = 17.
      const ctx = makeTextCtx();

      renderText(ctx, { ...baseArgs, text: 'Hi', tracking: 100 });

      expect(ctx.fillText).toHaveBeenNthCalledWith(1, 'H', 5, 21);
      expect(ctx.fillText).toHaveBeenNthCalledWith(2, 'i', 17, 21);
      expect(ctx.fillText).toHaveBeenCalledTimes(2);
      expect(measured(ctx)).toContain('H');
      expect(measured(ctx)).toContain('i');
    });

    it('draws the whole line in one fillText at zero tracking, so kerning costs nothing', () => {
      // Tracking at zero is the overwhelmingly common case and it must not take the cluster path:
      // that path throws kerning away for no reason at all. Asserted by the ABSENCE of per-cluster
      // measurements, which is the only thing that distinguishes the two paths in the call log.
      const ctx = makeTextCtx();

      renderText(ctx, { ...baseArgs, text: 'Hi' });

      expect(measured(ctx).filter((value) => value === 'Hi')).toEqual(['Hi']);
      expect(measured(ctx)).not.toContain('H');
      expect(measured(ctx)).not.toContain('i');
      expect(ctx.fillText).toHaveBeenCalledTimes(1);
    });
  });

  describe('caps', () => {
    // Read DURING the draw, not after it: `renderText` restores the context before returning, so
    // the property afterwards is the seed and every case here would have read `'normal'`. `applied`
    // is the value in effect while the glyphs were drawn, which is what the caps question is about.
    const capsFor = (overrides: Partial<TextToolArgs>): unknown => {
      const ctx = makeTextCtx({ modern: true });
      renderText(ctx, { ...baseArgs, ...overrides });
      return styledDuringDraw(ctx, 'fontVariantCaps');
    };

    it('caps the whole line for All Caps, only the lowercase for Small Caps, and nothing otherwise', () => {
      // `'all-small-caps'` covers Adobe's All Caps, which renders every character as a capital;
      // `'small-caps'` leaves characters already typed as capitals alone and synthesises only the
      // lowercase, which is Adobe's documented rule ("if the font does not include small caps,
      // Photoshop generates faux small caps",
      // https://helpx.adobe.com/photoshop/using/formatting-characters.html). The last case is the
      // one that matters for a migrated record: a settings object carrying neither toggle must
      // render un-capsed, and not small-capsed — which is what using `'small-caps'` as the
      // fallback for "neither" would do.
      expect(capsFor({ allCaps: true })).toBe('all-small-caps');
      expect(capsFor({ allCaps: true, smallCaps: true })).toBe('all-small-caps');
      expect(capsFor({ smallCaps: true })).toBe('small-caps');
      expect(capsFor({})).toBe('normal');
    });

    it('assigns fontVariantCaps AFTER ctx.font, because assigning the font resets it', () => {
      // This is the order the whole caps feature hangs on. Assigning `ctx.font` RESETS
      // `fontVariantCaps` to `'normal'` on Chrome 154 — `letterSpacing`, `wordSpacing` and
      // `fontKerning` survive a font assignment and `fontVariantCaps` does not — so a caps toggle
      // applied before the font is silently discarded on EVERY redraw, with no error anywhere. The
      // recorded font at the moment of the caps assignment is what proves the order, and the mock's
      // starting value is `'10px sans-serif'` so a reversal is unmistakable.
      const ctx = makeTextCtx({ modern: true });
      const assignments: { value: string; fontAtAssignment: string }[] = [];
      Object.defineProperty(ctx, 'fontVariantCaps', {
        configurable: true,
        get: () => 'normal',
        set: (value: string) => {
          assignments.push({ value, fontAtAssignment: ctx.font });
        },
      });

      renderText(ctx, { ...baseArgs, italic: true, bold: true, allCaps: true });

      // ORDER, and RESTORE — both as properties rather than as a sequence, because the number of
      // style applications is not fixed: `layoutText` and `requiredHeightForLines` each measure and
      // so each style the context inside its own bracket.
      //
      // The order is the point the whole caps feature hangs on: EVERY write of the caps value must
      // see the styled font, or a caps assignment made before the font would be reset by it.
      const applied = assignments.filter((entry) => entry.value === 'all-small-caps');
      expect(applied.length).toBeGreaterThan(0);
      expect(applied.every((entry) => entry.fontAtAssignment === 'italic bold 20px Arial')).toBe(true);
      // And the last write restores the context, with the seed font already back in place — which
      // is the other half of the bracket, and the reason the overlay is not left wearing the draft's
      // caps variant after the user leaves the tool.
      expect(assignments.at(-1)).toEqual({ value: 'normal', fontAtAssignment: '10px sans-serif' });
    });

    it('never creates a fontVariantCaps property on a context that lacks one', () => {
      // Same reasoning as `letterSpacing`: `'fontVariantCaps' in ctx` is the whole feature test, so
      // this context has to OMIT the key, and the renderer has to leave it omitted — a stray
      // assignment would create the property and silently take the caps branch on a context that
      // cannot honour it.
      const ctx = makeTextCtx();

      expect('fontVariantCaps' in ctx).toBe(false);
      renderText(ctx, { ...baseArgs, allCaps: true });
      expect('fontVariantCaps' in ctx).toBe(false);
    });
  });

  describe('the underline and the strikethrough', () => {
    it('draws the underline one rule thickness below the baseline, rounded to a whole pixel', () => {
      // `round(baseline + 0.1em - thickness / 2)` = round(21 + 2 - 0.5) = 23, and the rule is
      // `fontSize / 16` = 1.25 → 1px thick. The half-thickness is what centres the rule ON the
      // 0.1em line rather than hanging it below it, and the rounding is what keeps a fractional
      // baseline from producing a half-covered row of pixels that differ per device scale factor.
      // The 0.1em offset itself is a RECONSTRUCTION, not an Adobe figure — Adobe documents only the
      // colour (https://developer.adobe.com/photoshop/uxp/2022/ps-reference/modules/constants) — so
      // this pins the app's choice at a named number, not a claim about Photoshop.
      const ctx = makeTextCtx();

      renderText(ctx, { ...baseArgs, underline: true });

      expect(ctx.fillRect).toHaveBeenCalledTimes(1);
      expect(ctx.fillRect).toHaveBeenCalledWith(TEXT_PADDING, 23, 90, 1);
    });

    it('scales the rule with the type size, at a thickness of a sixteenth of it', () => {
      // 64px: thickness = 64 / 16 = 4, underline offset = 6.4, and round(56.2 + 6.4 - 2) = 61. A
      // constant 1px rule reads as a hairline at 10px and vanishes at 200px, and `max(1, …)` is
      // what keeps a size below 16px from rounding the rule to zero pixels, which `fillRect` draws
      // as nothing at all.
      const ctx = makeTextCtx();

      renderText(ctx, { ...baseArgs, fontSize: 64, underline: true });

      expect(ctx.fillRect).toHaveBeenCalledWith(TEXT_PADDING, 61, 90, 4);
    });

    it('draws the strikethrough half the measured x-height above the baseline', () => {
      // `round(baseline - actualBoundingBoxAscent('x') / 2 - thickness / 2)` = round(63 - 10 - 0.5)
      // = 53 against a 63 baseline. Half the x-height is where the glyph mass is, which is the whole
      // definition of a strikethrough: a rule through the ascenders reads as a bar over the word.
      const ctx = makeTextCtx({ measure: metricMeasure });

      renderText(ctx, { ...baseArgs, strikethrough: true });

      expect(ctx.fillRect).toHaveBeenCalledTimes(1);
      expect(ctx.fillRect).toHaveBeenCalledWith(TEXT_PADDING, 53, 90, 1);
    });

    it('falls back to half of 0.5em when the measurer reports no x-height', () => {
      // Real x-heights across the shipped fonts run 0.44–0.52em (Arial is 0.518555em), so 0.5em is
      // the middle of that band rather than a claim about any one font. 21 - 5 - 0.5 = 15.5 → 16.
      const ctx = makeTextCtx();

      renderText(ctx, { ...baseArgs, strikethrough: true });

      expect(ctx.fillRect).toHaveBeenCalledWith(TEXT_PADDING, 16, 90, 1);
    });

    it('draws both rules once per line, in the type colour, with no separate stroke', () => {
      // Adobe's underline has no style, weight or colour of its own
      // (https://developer.adobe.com/photoshop/uxp/2022/ps-reference/modules/constants), so both
      // rules are `fillRect` in the type colour — `fillStyle` is captured INSIDE `fillRect`, because
      // reading it afterwards would pass even if the colour were assigned after the rules were
      // drawn. `stroke` is asserted untouched: a rule drawn as a stroke would need a `strokeStyle`
      // nobody sets, and would come out black.
      const ctx = makeTextCtx();
      const colourAtFill: string[] = [];
      vi.mocked(ctx.fillRect).mockImplementation(() => {
        colourAtFill.push(String(ctx.fillStyle));
      });

      renderText(ctx, { ...baseArgs, text: 'a\nb', underline: true, strikethrough: true });

      expect(ctx.fillRect).toHaveBeenCalledTimes(4);
      expect(ctx.fillRect).toHaveBeenNthCalledWith(1, TEXT_PADDING, 23, 10, 1);
      expect(ctx.fillRect).toHaveBeenNthCalledWith(2, TEXT_PADDING, 16, 10, 1);
      expect(ctx.fillRect).toHaveBeenNthCalledWith(3, TEXT_PADDING, 45, 10, 1);
      expect(ctx.fillRect).toHaveBeenNthCalledWith(4, TEXT_PADDING, 38, 10, 1);
      expect(colourAtFill).toEqual(['#ff0000', '#ff0000', '#ff0000', '#ff0000']);
      expect(ctx.stroke).not.toHaveBeenCalled();
    });

    it('draws neither rule when the toggles are off', () => {
      // The default state of every migrated settings record, so this is the case that decides
      // whether a restored session shows rules nobody asked for.
      const ctx = makeTextCtx();

      renderText(ctx, baseArgs);

      expect(ctx.fillRect).not.toHaveBeenCalled();
      expect(ctx.stroke).not.toHaveBeenCalled();
    });
  });
});

describe('getTextWidth', () => {
  it('returns the widest measured line', () => {
    // The box has to fit the LONGEST line: a width taken from the first line ('a', 10px) would
    // leave the second one outside the frame the width was used to build.
    const ctx = makeTextCtx();

    const width = getTextWidth(ctx, { ...baseArgs, text: 'a\nlongest\nmid' });

    expect(width).toBe(70);
  });

  it('measures a single line', () => {
    const ctx = makeTextCtx();

    expect(getTextWidth(ctx, { ...baseArgs, text: 'abc' })).toBe(30);
  });

  it('returns zero for absent text, having measured the empty string', () => {
    // `(args.text ?? '').split('\n')` yields one empty line, whose ink is 0 — and it is 0 because
    // the measurer was ASKING, down the same `inkWidth` path every other line takes, rather than
    // from a special case that could disagree with it.
    const ctx = makeTextCtx();

    expect(getTextWidth(ctx, { ...baseArgs, text: undefined })).toBe(0);
    expect(measured(ctx)).toEqual(['']);
  });

  it('subtracts the trailing tracking gap from the advance Chrome reports', () => {
    // With `letterSpacing` on the context the shaper does the placing, and it adds the gap to the
    // LAST character too: 20 measured for 'Hi' at 2px of tracking, 18 of ink. Returning the advance
    // would grow the box by a gap the text never fills, which then shows up as a permanently loose
    // frame and a wider export crop.
    const ctx = makeTextCtx({ modern: true });

    expect(getTextWidth(ctx, { ...baseArgs, text: 'Hi', tracking: 100 })).toBe(18);
    expect(measured(ctx)).toEqual(['Hi']);
  });

  it('sums cluster advances and adds (n - 1) gaps when the platform has no letterSpacing', () => {
    // 10 + 10 + (2 - 1) * 2 = 22. `(n - 1)` and not `n` for the same reason the correction above
    // exists: a single glyph has no gap in front of it. Asserting the per-cluster CALLS as well is
    // what proves the fallback ran, because 22 is also what a `n`-gapped total would produce at a
    // different spacing.
    const ctx = makeTextCtx();

    expect(getTextWidth(ctx, { ...baseArgs, text: 'Hi', tracking: 100 })).toBe(22);
    expect(measured(ctx)).toEqual(['H', 'i']);
  });

  it('never returns a negative ink width when a line is shorter than one gap', () => {
    // `max(0, advance - spacing)`: a 1px-wide glyph at 2px of tracking would otherwise measure
    // -1, and every consumer of this number subtracts it from an anchor — a negative width moves a
    // right-aligned line RIGHT of the box and asks `fillRect` for a negative extent, which Chrome
    // treats as a mirrored rectangle rather than an error.
    const ctx = makeTextCtx({ modern: true, measure: () => metrics(1) });

    expect(getTextWidth(ctx, { ...baseArgs, text: 'H', tracking: 100 })).toBe(0);
  });

  it('measures the whole line once at zero tracking, so kerning is not thrown away for nothing', () => {
    // The overwhelmingly common case. The cluster path exists only to place gaps by hand, so taking
    // it with nothing to place throws kerning away for free — measured on 'WAVE AV' at 64px, 11.875px
    // of it. One whole-line call is the observable difference.
    const ctx = makeTextCtx();

    expect(getTextWidth(ctx, { ...baseArgs, text: 'Hi' })).toBe(20);
    expect(measured(ctx)).toEqual(['Hi']);
  });

  it('matches the font AND the tracking used by renderText, so measured bounds stay valid', () => {
    // `getTextWidth` runs `applyTextStyle` too, and the box it is used to build has to be measured
    // in the same face and at the same tracking the renderer will draw in. A width measured in a
    // different face is wrong by however much the two faces differ, which is invisible until export.
    const ctx = makeTextCtx({ modern: true });

    getTextWidth(ctx, { ...baseArgs, italic: true, bold: true, tracking: 100, text: 'x' });

    // `applied`, because `getTextWidth` brackets its own style writes and the context is back to its
    // seed by the time it returns. The question this case asks is what the measurer measured IN.
    expect(styledDuringDraw(ctx, 'font')).toBe('italic bold 20px Arial');
    expect(styledDuringDraw(ctx, 'letterSpacing')).toBe('2px');
  });

  it('brackets its style writes in save/restore, because the caller owns the context', () => {
    // `calculateNewRect` calls this with the live tool overlay (`TextToolArea` hands the same ref
    // to both), and `applyTextStyle` writes `font`, `textBaseline`, `textAlign`, `letterSpacing` and
    // `fontVariantCaps` onto whatever context it is given. Unbracketed, the overlay would come out
    // of every box recomputation wearing the Type tool's typography.
    //
    // The order is the assertion, and reading `font` back at the moment `restore` runs is how it is
    // pinned: a trailing `restore()` after the writes would report the PRE-save value and fail.
    const ctx = makeTextCtx({ modern: true });
    const order: string[] = [];
    let fontAtRestore = '';
    vi.mocked(ctx.save).mockImplementation(() => void order.push('save'));
    vi.mocked(ctx.restore).mockImplementation(() => {
      order.push('restore');
      fontAtRestore = ctx.font;
    });

    getTextWidth(ctx, { ...baseArgs, text: 'Hi' });

    expect(order).toEqual(['save', 'restore']);
    expect(fontAtRestore).toBe(fontShorthand(resolveTextStyle({ ...baseArgs, text: 'Hi' })));
  });

  it('restores the context even when measuring throws', () => {
    // A `try/finally` rather than a trailing call, because an un-restored context on the error path
    // is the same leak with nothing left to notice it.
    const ctx = makeTextCtx({ modern: true });
    vi.mocked(ctx.measureText).mockImplementation(() => {
      throw new Error('measureText failed');
    });

    expect(() => getTextWidth(ctx, { ...baseArgs, text: 'Hi' })).toThrow('measureText failed');
    expect(ctx.restore).toHaveBeenCalledTimes(1);
  });
});

describe('text processor', () => {
  beforeEach(() => {
    RecordingOffscreenCanvas.instances = [];
    vi.stubGlobal('OffscreenCanvas', RecordingOffscreenCanvas as unknown as typeof OffscreenCanvas);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('allocates a creator canvas sized to the document and rasterizes the text', () => {
    // The creator is one of two production callers of `renderText` — the other is the live draft
    // preview on the overlay (`src/components/Main/TextToolArea.tsx:58`) — and it is the one that
    // decides what a committed text layer IS. So this asserts a full-document canvas at the
    // document's own size, rasterised through the same renderer, positioned at 5 + 0.8 * 20 = 21
    // because the stub's measurer reports no font metrics.
    const [result] = text({ size: { width: 300, height: 150 } })(baseArgs);

    const canvas = RecordingOffscreenCanvas.instances.at(-1)!;
    expect(canvas.width).toBe(300);
    expect(canvas.height).toBe(150);
    expect(canvas.ctx.fillText).toHaveBeenCalledWith('Photoshop', TEXT_PADDING, 21);
    expect(result).toBe(canvas as unknown as OffscreenCanvas);
  });

  it('returns a full-size canvas even when the default empty text renders nothing', () => {
    // A text layer is created before anything is typed, so the empty draft must still produce a
    // canvas of the document's size. Returning nothing here would make the layer unconstructible.
    const [result] = text({ size: { width: 300, height: 150 } })({
      ...baseArgs,
      text: '',
      rect: null,
    });

    const canvas = RecordingOffscreenCanvas.instances.at(-1)!;
    expect(canvas.ctx.fillText).not.toHaveBeenCalled();
    expect(canvas.width).toBe(300);
    expect(result).toBeTruthy();
  });

  it('survives a degenerate document size and still returns one canvas', () => {
    // The clamp to a 1px axis is the STUB's, mirroring what a real `OffscreenCanvas` does with a
    // zero dimension; what this pins is that the creator neither throws nor returns an empty list
    // for a degenerate size, which is the part that belongs to the tool.
    const [result] = text({ size: { width: 0, height: 0 } })(baseArgs);

    const canvas = RecordingOffscreenCanvas.instances.at(-1)!;
    expect(canvas.width).toBe(1);
    expect(canvas.height).toBe(1);
    expect(result).toBeTruthy();
  });

  it('documents the current cost: a fresh full-document canvas and a fresh fillText pass on every replay (src/tools/text.ts:334-339)', () => {
    const params = { size: { width: 40, height: 20 } };
    const processor = text(params);

    const first = processor(baseArgs);
    const second = processor(baseArgs);

    // Each replay allocates a fresh canvas and re-runs the font rasterization, so an
    // N-step undo history re-renders the same glyphs N times. There is no vector-durable
    // source to re-materialize from, so this cost is structural, not a caching oversight.
    expect(RecordingOffscreenCanvas.instances).toHaveLength(2);
    expect(first[0]).not.toBe(second[0]);
    expect((first[0] as unknown as RecordingOffscreenCanvas).ctx.fillText).toHaveBeenCalledTimes(1);
    expect((second[0] as unknown as RecordingOffscreenCanvas).ctx.fillText).toHaveBeenCalledTimes(1);
  });

  it.fails('replays text from a durable vector source without re-rasterizing (src/tools/text.ts:331-340)', () => {
    const params = { size: { width: 40, height: 20 } };
    const processor = text(params);

    const first = processor(baseArgs);
    const second = processor(baseArgs);

    // Desired: an identical replay reuses the already-rasterized source instead of
    // allocating a second full-document OffscreenCanvas and re-running renderText.
    expect(RecordingOffscreenCanvas.instances).toHaveLength(1);
    expect(first[0]).toBe(second[0]);
  });
});
