/**
 * WCAG 2.x contrast arithmetic, as pure functions.
 *
 * This exists so the numbers in `e2e/toolbar-contrast.spec.ts` are produced by code with its own
 * unit tests rather than asserted by eye, and so the same math can be quoted in a source comment
 * next to the decision it justifies. Every ratio attributed to a colour pair in this repository's
 * stylesheets came from here.
 *
 * The method is the one in WCAG 2.2 §"relative luminance": sRGB channels are linearised with the
 * `0.04045` / `12.92` breakpoint, weighted `0.2126 R + 0.7152 G + 0.0722 B`, and the ratio is
 * `(L_lighter + 0.05) / (L_darker + 0.05)`.
 *
 * Nothing here knows about the DOM. Resolving what a pixel is actually painted over — an element's
 * own background, its ancestors' backgrounds, and any alpha in between — is the page's job, and
 * `e2e/toolbar-contrast.spec.ts` does it there. Keeping the split sharp is what lets this file be
 * tested without a browser, which is why its tests live in `e2e/helpers/__tests__/`.
 */

/** Straight 8-bit sRGB. Alpha is kept separately because compositing is not the same operation. */
export interface Rgb {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** A colour string as `getComputedStyle` returns it, plus the alpha `rgb()` leaves implicit. */
export interface PaintedColor {
  color: string;
  opacity: number;
}

/** A colour `parseColor` cannot read. Raised rather than defaulted away. */
export class UnreadableColorError extends Error {
  constructor(value: string) {
    super(
      `contrast arithmetic cannot read the colour "${value}". Every form Chrome reports from ` +
        `getComputedStyle has to be handled here: returning a default for a form this file does ` +
        `not know would silently measure a pair the user never sees, which is how the first version ` +
        `of this file reported an active tool tile as 1.54:1 when it is nothing like that.`
    );
    this.name = 'UnreadableColorError';
  }
}

/**
 * The alpha `rgb(r, g, b)` stands for.
 *
 * It is 1, and getting that wrong is the whole bug this exists to prevent: a `background-color` that
 * is `rgb(31, 41, 55)` is opaque, and treating it as translucent makes every ratio computed against
 * it wrong in the direction that flatters the result.
 */
export const parseColor = (value: string): Rgb => {
  const text = value.trim();

  const rgbMatch = text.match(/^rgba?\(([^)]+)\)$/i);
  if (rgbMatch) {
    const parts = rgbMatch[1].split(/[,/\s]+/).filter((part) => part.length > 0);
    const channel = (index: number) => Number.parseFloat(parts[index] ?? '0');
    const alpha = parts.length > 3 ? channel(3) : 1;
    return { r: channel(0), g: channel(1), b: channel(2), a: Number.isNaN(alpha) ? 1 : alpha };
  }

  // Chrome serialises `color-mix(in oklab, …)` as `oklab(L a b / alpha)` rather than as sRGB, so a
  // parser that only knows `rgb()` reads it as NOTHING AT ALL — and a background read as nothing
  // falls through the whole chain to the white default. On this rail that is not an edge case:
  // `dark:bg-blue-500/20` on a selected tile, and every `/NN` opacity utility in the repository, comes
  // back in this form.
  const oklab = text.match(/^oklab\(\s*([-\d.e+%]+)\s+([-\d.e+%]+)\s+([-\d.e+%]+)(?:\s*\/\s*([-\d.e+%]+))?\s*\)$/i);
  if (oklab) {
    const alpha = oklab[4] === undefined ? 1 : asNumber(oklab[4]);
    return {
      ...oklabToSrgb(asNumber(oklab[1]), asNumber(oklab[2]), asNumber(oklab[3])),
      a: alpha,
    };
  }

  const oklch = text.match(/^oklch\(\s*([-\d.e+%]+)\s+([-\d.e+%]+)\s+([-\d.e+%]+)(?:\s*\/\s*([-\d.e+%]+))?\s*\)$/i);
  if (oklch) {
    const alpha = oklch[4] === undefined ? 1 : asNumber(oklch[4]);
    const chroma = asNumber(oklch[2]);
    const hue = (asNumber(oklch[3]) * Math.PI) / 180;
    return { ...oklabToSrgb(asNumber(oklch[1]), chroma * Math.cos(hue), chroma * Math.sin(hue)), a: alpha };
  }

  // `transparent` is a real colour and compositing it changes nothing, so it is handled rather than
  // rejected — but it is handled HERE, after the numeric forms, not as a catch-all default.
  if (text.toLowerCase() === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };

  throw new UnreadableColorError(value);
};

/** A `<number>` or a `<percentage>` as one number, so `50%` and `0.5` agree. */
const asNumber = (token: string): number => {
  const text = token.trim();
  if (!text.endsWith('%')) return Number.parseFloat(text);
  return Number.parseFloat(text) / 100;
};

/** OKLab to sRGB, by the matrices in CSS Color 4 §12, then the linear-to-sRGB gamma. */
const oklabToSrgb = (lightness: number, a: number, b: number): { r: number; g: number; b: number } => {
  const l_ = lightness + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = lightness - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = lightness - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;
  const linear = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return { r: toSrgbChannel(linear[0]), g: toSrgbChannel(linear[1]), b: toSrgbChannel(linear[2]) };
};

/**
 * Linear to sRGB, clamping an out-of-gamut result to the channel.
 *
 * The clamp is not a fudge: the browser clamps too, so the clamped value is the colour that reaches
 * the screen, and it is the one the ratio has to be taken against.
 */
const toSrgbChannel = (channel: number): number => {
  const clamped = channel < 0 ? 0 : channel > 1 ? 1 : channel;
  const encoded = clamped <= 0.0031308 ? clamped * 12.92 : 1.055 * clamped ** (1 / 2.4) - 0.055;
  return Math.round(encoded * 255);
};

/** Composites `source` over `backdrop` in straight (non-premultiplied) alpha. */
export const compositeOver = (source: Rgb, backdrop: Rgb): Rgb => {
  if (source.a >= 1) return { ...source, a: 1 };
  const mix = (top: number, bottom: number) => top * source.a + bottom * (1 - source.a);
  return { r: mix(source.r, backdrop.r), g: mix(source.g, backdrop.g), b: mix(source.b, backdrop.b), a: 1 };
};

/**
 * Flattens a chain of backgrounds, nearest first, into the single opaque colour that is behind them.
 *
 * An empty chain resolves to white rather than to transparent-black, because an element with no
 * painted background at all is painted on the canvas — and every element in these two toolbars has
 * one, so the default only decides what an unscoped fallback reports.
 */
export const flattenBackgrounds = (chain: readonly Rgb[]): Rgb => {
  let result: Rgb = { r: 255, g: 255, b: 255, a: 1 };
  for (let index = chain.length - 1; index >= 0; index -= 1) {
    result = compositeOver(chain[index], result);
  }
  return result;
};

/** The relative luminance of an opaque colour. */
export const relativeLuminance = (color: Rgb): number => {
  const channel = (value: number) => {
    const scaled = value / 255;
    return scaled <= 0.04045 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
};

/**
 * The contrast ratio between two colours, 1 to 21.
 *
 * Both are composited onto `backdrop` first when they carry alpha, because a ratio between a
 * translucent colour and an opaque one is not a ratio between two things the user can see.
 */
export const contrastRatio = (foreground: Rgb, backdrop: Rgb): number => {
  const back = flattenBackgrounds([backdrop]);
  const front = compositeOver(foreground, back);
  const a = relativeLuminance(front);
  const b = relativeLuminance(back);
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
};

/** The ratio of a text colour against the flattened background chain behind its element. */
export const contrastRatioOver = (text: Rgb, backgroundChain: readonly Rgb[]): number =>
  contrastRatio(text, flattenBackgrounds(backgroundChain));

/**
 * The floor that applies to a run of text: 3.0 for large text, 4.5 otherwise.
 *
 * "Large" is WCAG's own definition and not a round number chosen here: 18.66px, or 14px when bold
 * at 700 or heavier. A gate that hardcoded 4.5 for everything would be stricter than the standard on
 * the headings it happened to cover, which is a different defect from being too lax.
 */
export const textContrastFloor = (fontSizePx: number, fontWeight: number): number => {
  const bold = fontWeight >= 700;
  return fontSizePx >= (bold ? 14 : 18.66) ? 3 : 4.5;
};

/** The floor for the boundary of a user-interface component: WCAG 1.4.11. */
export const NON_TEXT_FLOOR = 3;

/**
 * Formats a ratio for a failure message.
 *
 * Two decimal places, because the numbers quoted in source comments are quoted to two, so a reader
 * comparing a message against a comment is comparing like with like.
 */
export const formatRatio = (ratio: number): string => `${ratio.toFixed(2)}:1`;

/** The two filter components `SidebarLeft.scss` actually uses, and nothing else. */
export interface PaintFilter {
  opacity: number;
  grayscale: number;
}

/**
 * Reads `opacity(p) grayscale(g)` out of a computed `filter` value.
 *
 * Only those two components are read, and anything else is IGNORED rather than rejected — a
 * `blur(1px)` on a dimmed row would change the pixels without changing the contrast, and refusing to
 * model it would make this file fail on a filter that is not its subject.
 *
 * `none` is the identity, which is what an element with no filter at all reports.
 */
export const parseFilter = (value: string): PaintFilter => {
  const opacity = value.match(/opacity\(\s*([\d.]+)\s*\)/);
  const grayscale = value.match(/grayscale\(\s*([\d.]+)\s*\)/);
  return {
    opacity: opacity ? Number.parseFloat(opacity[1]) : 1,
    grayscale: grayscale ? Number.parseFloat(grayscale[1]) : 0,
  };
};

/** Moves a colour toward its own luminance, which is what `grayscale(n)` does. */
const grayscaleOf = (color: Rgb, amount: number): Rgb => {
  const y = 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;
  const mixed = (channel: number) => channel + (y - channel) * amount;
  return { r: mixed(color.r), g: mixed(color.g), b: mixed(color.b), a: color.a };
};

/**
 * The ratio of `text` against its background, as the pixels come out after a CSS filter.
 *
 * `getComputedStyle` reports the UNFILTERED colour, because a filter is applied when the element is
 * painted and never becomes part of its computed style. So a dimmed row cannot be measured by reading
 * it — this is what measures it instead, by modelling the two operations the filter performs:
 *
 * 1. The element renders its own background, border and glyph, and `grayscale(g)` moves all three
 *    toward their common luminance by the fraction `g`.
 * 2. `opacity(p)` composites that WHOLE rendering over whatever is behind the element — so the
 *    background chain is flattened and then used twice: once as the fill the element paints, and once
 *    as the backdrop the faded result lands on.
 *
 * Getting that double role wrong is exactly why the dim figures in `SidebarLeft.scss` had to be
 * recomputed by hand the first time, and why they are modelled here instead.
 */
export const contrastRatioUnderFilter = (text: Rgb, backgroundChain: readonly Rgb[], filter: PaintFilter): number => {
  const behind = flattenBackgrounds(backgroundChain.slice(1));
  const ownBackground = compositeOver(backgroundChain[0] ?? { r: 0, g: 0, b: 0, a: 0 }, behind);
  const fadedSurface = compositeOver({ ...grayscaleOf(ownBackground, filter.grayscale), a: filter.opacity }, behind);
  const glyph = compositeOver({ ...grayscaleOf(text, filter.grayscale), a: filter.opacity }, fadedSurface);
  const a = relativeLuminance(glyph);
  const b = relativeLuminance(fadedSurface);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
};
