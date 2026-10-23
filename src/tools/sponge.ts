import { BRUSH_SPACING_DEFAULT, clampBrushTipSettings, type BrushTipSettings } from '../util/brush-engine.ts';
import { buildStrokeCoverage } from '../util/stroke-coverage.ts';
import { clampChannel, forEachPixelInSize, readRgba, writeRgba } from '../util/pixels.ts';
import type { BitmapSource, Point, Size } from '../contexts/general-types.ts';
import type { Rgba } from '../util/pixels.ts';
import type { ProcessorToolParams, ToolResult } from './toolProcessors.ts';

/**
 * The Sponge: the third tool in Photoshop's toning flyout, beside the Dodge and the Burn,
 * and the only one of the three that is a CHROMA operation rather than a tone operation.
 *
 * Where the Dodge and the Burn scale a channel towards white or towards black inside a
 * chosen tonal band, the Sponge scales a pixel's distance from its own luminance. That is
 * the whole difference, and it is why this module shares the Dodge's stroke geometry and
 * none of its curve.
 *
 * The algorithm is a chroma scale about a fixed luma pivot, which is what the community
 * reimplementation of this family states and what Adobe's own option semantics imply:
 *
 * ```
 *   Saturate    c' = L + (c - L) * (1 + amount)
 *   Desaturate  c' = L + (c - L) * (1 - amount)
 * ```
 *
 * Adobe publishes no per-pixel specification for this tool. `§Sponge Tool` in
 * `src/tools/descriptions/focus.notes.md` records what is sourced, what is inferred, and what
 * this module therefore treats as a recorded choice rather than as an Adobe fact.
 */

/** Adobe's `Mode` dropdown, in the order Adobe's own page lists the two choices. */
export const SPONGE_MODES: readonly { value: SpongeMode; label: string }[] = [
  { value: 'saturate', label: 'Saturate' },
  { value: 'desaturate', label: 'Desaturate' },
];

/**
 * Adobe names exactly two modes: _"Saturate: Intensifies the color's saturation"_ and
 * _"Desaturate: Dilutes the color's saturation"_. There is no third.
 */
export type SpongeMode = 'saturate' | 'desaturate';

/** Narrow an arbitrary string off the dropdown, for a `<select>` that only knows strings. */
export const isSpongeMode = (value: string): value is SpongeMode => SPONGE_MODES.some((entry) => entry.value === value);

/**
 * **`Desaturate`, and this is a recorded choice rather than an Adobe fact.**
 *
 * Adobe's user guide never states a default for this dropdown; its page is imperative
 * throughout ("Select Saturate or Desaturate from the Mode option as per your
 * requirement"), which is equally consistent with either. Exactly one non-Adobe source
 * asserts Desaturate, and no second source was found after a dedicated search. Desaturate
 * is chosen because it is the non-destructive direction: a saturated stroke that clips a
 * channel cannot be undone by painting back, and a tool whose default can destroy data is
 * the wrong default for a control Adobe declined to document.
 *
 * `docs/OVERRIDES.md` is deliberately NOT touched, because there is no Adobe behaviour
 * here to deviate FROM — the source is silent, not contradicted. `HANDOFF.md` records the
 * gap so an operator can settle it against a live Photoshop.
 */
export const SPONGE_MODE_DEFAULT: SpongeMode = 'desaturate';

/**
 * Photoshop's `Flow` slider, 1-100%.
 *
 * The 1% floor is the CS2 Bible's statement and is repeated by a 2009 report on the tool;
 * **no current Adobe page gives the range either way.** It is carried because a control
 * labelled "the rate of saturation change" that cannot be turned off is not the control
 * Adobe documents. There is no other 1-100 percentage control in this app to appeal to
 * instead: the Blur's only slider is `Blur Radius` at 0-100 **px**, the Eraser's `Flow` runs
 * 1-100 with a midpoint of 50.5, and the `color` tool's `Saturation` is -100..100. So the
 * floor rests on the CS-era source alone.
 */
export const SPONGE_FLOW_MIN = 1;
export const SPONGE_FLOW_MAX = 100;

/**
 * Flow's seeded default, and what a non-finite `flow` falls back to.
 *
 * 50% is a single third-party source ("a lower Flow than the default value of 50%"), and
 * it is corroborated only by the CS2 Bible's statement that Flow is what the digit keys
 * step, which fixes no value. **Adobe states no default, and 50 is not the midpoint of this
 * control's own range** — `(1 + 100) / 2` is 50.5. It is nonetheless the value that reads as
 * a neutral seed, because 50 is the near-midpoint the two percentage controls in this family
 * use (the Dodge's and the Burn's `Exposure` both seed at 50 on a 0-100 range) and it is the
 * only figure any source gives.
 */
export const SPONGE_FLOW_DEFAULT = 50;

/**
 * Adobe's Grayscale-mode rule, verbatim: _"When an image is in Grayscale mode, the tool
 * increases or decreases contrast by moving gray levels away from or toward the middle
 * gray."_
 *
 * **This app has no Grayscale document mode, so that branch does not exist and is NOT
 * implemented here.** `Image > Mode` is not a surface this application has; `color`'s
 * `grayscale` is a per-layer filter amount, not a document mode, and a layer made grey by
 * it is still an RGB layer — where Photoshop's own rule does not apply, because on an RGB
 * pixel with no chroma the chroma scale below is an exact no-op. Implementing the tonal
 * pivot anyway would make this tool behave the way Photoshop behaves in a mode this app
 * does not have, which is a deviation `docs/OVERRIDES.md` would have to authorise and no
 * agent may authorise. Recorded in `HANDOFF.md` instead.
 */
/**
 * NOT READ BY ANY PRODUCT CODE, and that is deliberate. It is the Adobe sentence's own number,
 * published as a constant so the unimplemented rule has one named anchor instead of a number
 * repeated in prose, and `HANDOFF.md` §147 cites it as the record of the branch that is absent.
 * Deleting it loses that anchor; wiring it up would be implementing a mode this app does not
 * have, which is the thing the comment above refuses.
 */
export const SPONGE_MIDDLE_GREY = 128;

export type SpongeToolArgs = {
  mode: SpongeMode;
  flow: number;
  vibrance: boolean;
  size: number;
  hardness: number;
  points: Point[];
  toolName: 'sponge';
};

export type SpongeToolSettings = Omit<SpongeToolArgs, 'points'>;

/**
 * Rec.709 luma of one pixel's STORED channels, 0-255, in the encoded sRGB this editor
 * keeps — deliberately not linear light, and deliberately not `computeLuma`.
 *
 * **Encoded, not linear.** The same argument `dodgeBurn.ts` makes for its own pivot: this
 * repo has no colour-space module, and scaling chroma in linear light would move every
 * result this tool produces away from what the reference tool does, in exchange for a
 * photometric correctness the feature does not claim.
 *
 * **`computeLuma` is not used because it folds alpha in.** It composites a partly
 * transparent pixel towards WHITE before returning, which is the right reading for the
 * Dodge and the Burn — a transparent pixel must not be lightened as though it were black.
 * It is the wrong reading here, because the Sponge's pivot is the quantity the chroma is
 * measured FROM: folding alpha in moves the pivot toward 255 on a cut-out edge and so drains
 * a partly transparent pixel toward white. **That is a change of LIGHTNESS, not of hue** —
 * both pivots leave hue exact, because a chroma scale about a pivot multiplies every channel's
 * deviation by the same factor and so cannot rotate the point — but lightness is exactly what
 * this tool must not move.
 *
 * The undisclosed consequence of reading stored channels is that a nearly transparent pixel's
 * stroke is nearly invisible: at `a: 17` the on-screen composite of `(250, 10, 10)` is
 * already `(254.7, 238.7, 238.7)`, so a Saturate pass driving stored red from 250 to 255 moves
 * what the user can see by under 1/255. Acting on the layer's stored colour rather than on the
 * backdrop it happens to sit over is the right call — the Dodge's and the Burn's reading would
 * make the stroke stronger the MORE transparent the pixel, which is backwards — but the effect
 * being invisible is the price, and it is worth knowing rather than discovering.
 *
 * This function reads the stored channels only; alpha is preserved untouched and a fully
 * transparent pixel is skipped by `chromaScale`.
 */
export const spongeLuma = (red: number, green: number, blue: number): number =>
  red * 0.2126 + green * 0.7152 + blue * 0.0722;

/** Clamp `flow` into the slider's range, substituting the default for a non-finite value. */
const clampFlow = (flow: number): number =>
  Number.isFinite(flow) ? Math.min(SPONGE_FLOW_MAX, Math.max(SPONGE_FLOW_MIN, flow)) : SPONGE_FLOW_DEFAULT;

/**
 * The effective strength of one stroke at one pixel, 0-1.
 *
 * `flow` is the slider and `coverage` is the tip's falloff, and they multiply rather than
 * compose: a soft rim and a mid-stroke pixel run the same arithmetic at different
 * strengths, which is what makes the brush edge and the Flow slider the same control seen
 * from two directions.
 *
 * `flow` is divided by the slider's own MAX rather than by 100, so widening the range widens
 * the scale with it. A non-finite `coverage` yields 0 — a stroke that does nothing beats one
 * that moves an arbitrary amount — but a non-finite **`flow` does not**, and must not: it falls
 * back to `SPONGE_FLOW_DEFAULT` through `clampFlow`, because a corrupt persisted Flow that
 * silently disabled the tool would be worse than one that used the seeded value. `amount` is
 * always in `[0, 1]`, which is what lets `chromaScale`'s Desaturate branch reach `k = 0` (full
 * grey) and no further.
 */
export const spongeAmount = (flow: number, coverage: number = 1): number => {
  const paint = Number.isFinite(coverage) ? Math.min(1, Math.max(0, coverage)) : 0;
  if (!(paint > 0)) return 0;

  const rate = clampFlow(flow) / SPONGE_FLOW_MAX;
  return paint * rate;
};

/**
 * The largest chroma scale about `luma` that keeps every channel inside `[0, 255]`, or
 * `Infinity` for a pixel with no deviation to amplify.
 *
 * Solving `0 <= L + (c - L) * k <= 255` per channel for `k` gives one upper bound per
 * channel, and the tightest of the three is the answer:
 *
 * ```
 *   c > L    k <= (255 - L) / (c - L)
 *   c < L    k <= L / (L - c)
 *   c = L    no bound
 * ```
 *
 * The `c = L` arm is why this never divides by zero, and it is also why the answer is
 * `>= 1` for every valid pixel: at `k = 1` the result is `c`, which is in range by
 * construction.
 *
 * This is what Adobe's `Vibrance` option is described as doing — _"Select the Vibrance
 * option to minimize clipping for fully saturated or desaturated colors"_ — read as the
 * single geometric quantity it names. Capping the scale at the gamut boundary is the
 * strictest reading of "minimize clipping": the result cannot clip at all.
 */
export const chromaHeadroom = (red: number, green: number, blue: number, luma: number): number => {
  const channels = [red, green, blue];
  let headroom = Infinity;

  for (const channel of channels) {
    const deviation = channel - luma;
    if (deviation === 0) continue;

    headroom = Math.min(headroom, deviation > 0 ? (255 - luma) / deviation : luma / -deviation);
  }

  return headroom;
};

/**
 * The tool, as one pure function of a pixel: scale its chroma about its own luma.
 *
 * `amount` is `spongeAmount`'s output, so `0` is an exact no-op and `1` is the slider at
 * its maximum. The two modes are one formula with `1 + amount` and `1 - amount`, which is
 * the same reason one module serves both names here as it does for the Dodge and the Burn.
 *
 * Three properties are deliberate and each is pinned by a unit test:
 *
 * - **`amount === 0` returns the pixel untouched, not re-derived.** `L + (c - L) * 1` is
 *   `c` in exact arithmetic, but the pivot is a float sum and `L + fl(c - L)` is not
 *   guaranteed to round back to `c`, so the identity case returns rather than round-trips.
 * - **A pixel with no chroma is untouched in BOTH modes**, and returns early for it. `r ===
 *   g === b` gives `deviation === 0` on every channel, so Saturate has nothing to amplify
 *   and Desaturate has nothing to remove. The early return is not an optimisation on a path
 *   the arithmetic already gets right — it is what makes the claim TRUE rather than
 *   accidentally true: `0.2126 + 0.7152 + 0.0722` is not exactly `1.0` in binary, so
 *   `spongeLuma(255, 255, 255)` is `254.99999999999997` and white's deviation is `2.8e-14`
 *   rather than `0`. Left to the arithmetic, pure white came back as
 *   `254.99999999999997` at full Desaturate. `writeRgba` rounds it back to `255` on the way
 *   into the buffer, so no pixel was ever visibly wrong — but "pure white is an exact no-op"
 *   would have been a statement about `Uint8ClampedArray` rounding rather than about this
 *   function, and the same drift applies to other levels. It is also the honest consequence
 *   of Adobe scoping its Grayscale rule to a document MODE this app does not have — see
 *   `SPONGE_MIDDLE_GREY`.
 * - **`alpha === 0` returns untouched.** The channels under a fully transparent pixel are
 *   undefined, and there is no visible colour there to change.
 *
 * **`amount` is clamped here, not only at `spongeAmount`.** The slider cannot produce a value
 * above 1, but `chromaScale` is exported and a caller that hands it `amount > 1` would put
 * Desaturate's scale below zero — a NEGATIVE factor, which mirrors the pixel across its own
 * luma instead of draining it. That is the wrong answer by a wide margin and it is reachable
 * without any bug in `spongeAmount` at all, so the guard belongs on this side of the boundary.
 *
 * `vibrance` caps `applied` at `chromaHeadroom`, which is the scale that puts the binding
 * channel exactly ON its gamut boundary and no further, so with it on **no channel ever leaves
 * `[0, 255]`**. With it off the channels are simply clamped, which is the clipping the option
 * exists to prevent.
 *
 * **The consequence worth stating plainly: a pixel with any channel already ON a rail does not
 * move at all.** `chromaHeadroom` for `(255, 128, 64)` — luma `150.3794`, red above it — is
 * `(255 - 150.3794) / 104.6206`, which is exactly `1`, and `applied === 1` returns the input.
 * Saturating further is not possible under a chroma scale without pushing red past 255, so
 * "no change" is the only answer the model has, and it is the right one: it is the difference
 * between refusing to clip and silently discarding the difference. It does mean a stroke with
 * Vibrance on can look like it did nothing on an already-clipped region, which is why the
 * second-stroke behaviour is pinned end-to-end in `e2e/sponge-tool.spec.ts`.
 *
 * Under Desaturate the cap is inert by construction rather than by omission: every channel
 * moves TOWARD `luma`, so the result is the convex combination `(1 - amount) * c + amount * luma`
 * of two in-range values and cannot leave `[0, 255]`.
 *
 * **An unrecognised `mode` falls to the Desaturate branch**, because that is what the `? :`
 * below gives a string that is not `'saturate'`, and `SPONGE_MODE_DEFAULT` is `'desaturate'`.
 * So a corrupt persisted value cannot invert the tool — it can only fail toward the seeded
 * mode. `isSpongeMode` guards the `<select>`; nothing guards the persisted value, and this is
 * the guard.
 */
export const chromaScale = (rgba: Rgba, mode: SpongeMode, amount: number, vibrance: boolean): Rgba => {
  if (!(amount > 0)) return rgba;
  if (rgba.a === 0) return rgba;
  if (rgba.r === rgba.g && rgba.g === rgba.b) return rgba;

  const luma = spongeLuma(rgba.r, rgba.g, rgba.b);

  // Saturate amplifies, Desaturate attenuates, and only Saturate can ever need the cap.
  const appliedAmount = Math.min(amount, 1);
  const scale = mode === 'saturate' ? 1 + appliedAmount : 1 - appliedAmount;

  const headroom = vibrance && mode === 'saturate' ? chromaHeadroom(rgba.r, rgba.g, rgba.b, luma) : Infinity;
  const applied = Math.min(scale, headroom);
  if (applied === 1) return rgba;

  return {
    r: clampChannel(luma + (rgba.r - luma) * applied),
    g: clampChannel(luma + (rgba.g - luma) * applied),
    b: clampChannel(luma + (rgba.b - luma) * applied),
    a: rgba.a,
  };
};

/**
 * The tip settings a sponge stroke runs with.
 *
 * `SpongeToolArgs` has no `spacing` and no opacity field — Photoshop's Sponge bar has
 * neither, so the stroke is as strong as the tip's falloff allows wherever the Flow puts
 * it. The clamp is not decoration: `size` and `hardness` arrive from persisted settings,
 * and a `NaN` radius would make every bounding-box bound `NaN`, which is a loop that
 * silently paints nothing.
 */
const tipSettings = (args: SpongeToolArgs): BrushTipSettings =>
  clampBrushTipSettings({
    size: args.size,
    hardness: args.hardness,
    opacity: 1,
    spacing: BRUSH_SPACING_DEFAULT,
  });

/** A `Size` reduced to the integer extents a pixel buffer can be addressed with. */
const pixelExtent = (size: Size): Size => ({
  width: Number.isFinite(size.width) ? Math.max(0, Math.floor(size.width)) : 0,
  height: Number.isFinite(size.height) ? Math.max(0, Math.floor(size.height)) : 0,
});

/** Scale the chroma of every pixel the tip covers, in place. */
const scalePaintedChroma = (
  data: Uint8ClampedArray,
  size: Size,
  coverage: Float32Array,
  args: SpongeToolArgs
): void => {
  forEachPixelInSize(size, (x, y) => {
    const paint = coverage[y * size.width + x];
    if (!(paint > 0)) return;

    const rgba = readRgba(data, x, y, size.width);
    const next = chromaScale(rgba, args.mode, spongeAmount(args.flow, paint), args.vibrance);
    if (next === rgba) return;

    writeRgba(data, x, y, size.width, next);
  });
};

/**
 * The one implementation the exported processor reaches.
 *
 * `points` are in the same space as `size` and the buffer: the registry hands a raster tool
 * the layer's own bitmap and extent through `stageProcessorInput()`, so a point is
 * addressed against this buffer and not against the document.
 *
 * **There is no build-up.** Photoshop's Sponge compounds for as long as the button is held
 * and every tutorial retouches it at low Flow with repeated passes, which is a per-frame
 * effect with no single end value; a one-shot commit has to be a pure function of its args
 * instead, which is also what lets the registry's `requiresRaster: true` replay reproduce
 * the commit exactly. This is the same recorded absence as the Dodge, the Burn and the
 * Smudge (`docs/TOOLS-TOO-HARD.md`), and it is why the description files this tool
 * `partial` rather than `implemented`.
 */
const applySponge = (
  bitmap: BitmapSource,
  size: Size,
  args: SpongeToolArgs,
  previousCanvas?: BitmapSource
): ToolResult => {
  const canvas = new OffscreenCanvas(size.width, size.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) return [canvas];

  // Use previousCanvas as the source for incremental rendering, otherwise use the layer bitmap
  const source = previousCanvas ?? bitmap;
  ctx.drawImage(source, 0, 0);

  // A reduced canvas environment has no read-back at all (the default test canvas mock
  // documents that the global mock deliberately omits it, and production guards on
  // exactly this). The drawn source is then the best answer available.
  if (typeof ctx.getImageData !== 'function' || typeof ctx.putImageData !== 'function') return [canvas];

  const extent = pixelExtent(size);
  if (extent.width === 0 || extent.height === 0) return [canvas];

  const coverage = buildStrokeCoverage(extent, Array.isArray(args.points) ? args.points : [], tipSettings(args));
  if (!coverage) return [canvas];

  const imageData = ctx.getImageData(0, 0, extent.width, extent.height);
  if (!imageData.data || imageData.data.length === 0) return [canvas];

  scalePaintedChroma(imageData.data, extent, coverage, args);
  ctx.putImageData(imageData, 0, 0);

  return [canvas];
};

/**
 * The Sponge. Returns a full-`size` raster, and is its own function reference rather than
 * a shared one: `src/tools/__tests__/tool-processors.test.ts` allows two tools to share a
 * processor only where they are the same operation (`selection`, `shape`), and the Sponge
 * is a third operation with a third curve.
 */
export const sponge =
  ({ bitmap, size, previousCanvas }: ProcessorToolParams) =>
  (args: SpongeToolArgs): ToolResult =>
    applySponge(bitmap, size, args, previousCanvas);
