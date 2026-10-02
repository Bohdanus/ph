import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AUTO_LEADING,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  TRACKING_MAX,
  TRACKING_MIN,
  fontShorthand,
  getTextWidth,
  renderText,
  resolveTextStyle,
  text,
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
 */
const makeTextCtx = ({
  measure = widthOnlyMeasure,
  modern = false,
}: { measure?: (value: string) => TextMetrics; modern?: boolean } = {}): CanvasRenderingContext2D =>
  makeMockCtx({
    measureText: vi.fn(measure),
    ...(modern ? { letterSpacing: '0px', fontVariantCaps: 'normal' } : {}),
  });

/** Every string the renderer handed to `measureText`, in call order. */
const measured = (ctx: CanvasRenderingContext2D): string[] =>
  vi.mocked(ctx.measureText).mock.calls.map((call) => call[0]);

const rect: RectXYSorted = { x1: 0, y1: 0, x2: 200, y2: 120 };

/**
 * A box whose padded interior is 30px wide, against a 90px-wide line — the overflow case the right
 * and centre anchors are measured on. `rect.x1` stays 0 so an anchor that lands left of it is a
 * NEGATIVE coordinate rather than a merely small one.
 */
const narrowRect: RectXYSorted = { x1: 0, y1: 0, x2: 40, y2: 120 };

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

      expect(ctx.font).toBe('italic bold 20px Arial');
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

      expect(ctx.letterSpacing).toBe(expected);
      expect(ctx.letterSpacing).toMatch(/^-?\d+(\.\d+)?px$/);
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
    const capsFor = (overrides: Partial<TextToolArgs>): string => {
      const ctx = makeTextCtx({ modern: true });
      renderText(ctx, { ...baseArgs, ...overrides });
      return ctx.fontVariantCaps;
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

      expect(assignments).toEqual([{ value: 'all-small-caps', fontAtAssignment: 'italic bold 20px Arial' }]);
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

    expect(ctx.font).toBe('italic bold 20px Arial');
    expect(ctx.letterSpacing).toBe('2px');
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
