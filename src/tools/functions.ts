// import { EXP_K } from './constants.ts';
//
// export function exp0_1(val: number) {
//   val = val / 100;
//   const res = Math.pow(2, 4 * val);
//   return res;
// }

import type { ResizeCb } from '../components/ToolbarsRight/types.ts';
import type { BitmapSource } from '../contexts/general-types.ts';

// Deliberately distinct: each adjustment gets its own rate of change, and collapsing
// these into one constant changes how hard all three sliders feel. Only the Colors
// chain is exponential: Brightness and Contrast are proportionate (see
// `proportionateFactor`), so they carry no exponent at all.
const SATURATION_EXPONENT = 2.1;

/**
 * The CSS filter multiplier for a signed percentage adjustment, over the `-100..100` travel
 * the Colors slider is labelled in. Saturation is the only consumer left: Brightness and
 * Contrast are proportionate (see `proportionateFactor`) and carry no exponent.
 *
 * This is the exponential `exp(k * val / 100)` re-anchored so that both of its contractual
 * endpoints are exact rather than approximate:
 *
 * | `val`  | factor | emitted  |
 * | ------ | ------ | -------- |
 * | `-100` | `0`    | `0%`     |
 * | `0`    | `1`    | `100%`   |
 * | `+100` | `> 1`  | `> 100%` |
 *
 * A bare `exp(k * val / 100)` cannot carry this contract: it is strictly positive for
 * every finite input and at least `1` for every non-negative one, so no slider range
 * can make Saturation desaturate, and the neutral that the default settings depend on
 * only lands on `1` by accident of the curve's origin.
 */
export function expAdjustment(val: number, k: number = 2): number {
  const floor = Math.exp(-k);
  return (Math.exp((k * val) / 100) - floor) / (1 - floor);
}

/**
 * CSS filter-effects reads a bare `<number>` in `saturate()`, `brightness()` and
 * `contrast()` as a percentage, so every emitted amount carries an explicit `%` — the
 * unit `grayscale` and `sepia` already used. Two decimals with trailing zeros stripped,
 * so the neutral emits exactly `100%` and the extreme exactly `0%`.
 */
function adjustmentPercent(factor: number): string {
  return `${Number((factor * 100).toFixed(2))}%`;
}

/**
 * Adobe's two slider travels for Brightness/Contrast, in the adjustment's default — Adobe
 * calls it "normal mode" — rather than its Legacy form. Adobe states the numbers without
 * naming a mode: "Values can range from ‑150 to +150 for Brightness, ‑50 to +100 for
 * Contrast." (<https://helpx.adobe.com/photoshop/using/apply-brightness-contrast-adjustment.html>)
 *
 * These are the one home for both halves of the contract: the panel's `min`/`max` and the
 * spans `buildLevelsFilter` divides by are derived from them, so a slider cannot reach a
 * value the curve was not written for.
 */
export const BRIGHTNESS_SLIDER_RANGE = { min: -150, max: 150 } as const;
export const CONTRAST_SLIDER_RANGE = { min: -50, max: 100 } as const;

/**
 * The factor each control's travel is divided by, and why the two differ.
 *
 * **Brightness** divides by its own negative travel, so `BRIGHTNESS_SLIDER_RANGE.min`
 * lands on a factor of exactly `0`: Adobe's dark endpoint is black, and a multiply that
 * reaches zero is the one thing `brightness()` does exactly right.
 *
 * **Contrast** divides by `100`, NOT by its own `-50` travel, because the two ends are not
 * the same kind of endpoint. Adobe's own Legacy contrast at `+100` is a measured gain of
 * exactly `2` — it collapses every channel to `0` or `255` — so `2` is the gain this very
 * slider reaches at its own maximum, and the proportionate law through it puts `-50` at
 * `0.5`. Dividing by `50` instead would put `-50` on a factor of `0`, which is
 * `contrast(0%)`: every pixel becomes the same mid-grey. That is the Legacy clipping
 * defect Adobe names ("this can cause clipping or loss of image detail in highlight or
 * shadow areas"), and it is what `expAdjustment`'s re-anchored zero reached.
 */
const BRIGHTNESS_FACTOR_SPAN = -BRIGHTNESS_SLIDER_RANGE.min;
const CONTRAST_FACTOR_SPAN = CONTRAST_SLIDER_RANGE.max;

/**
 * Adobe's normal-mode curve, in the part of it a CSS filter can carry.
 *
 * Adobe: "In normal mode, Brightness/Contrast applies proportionate (nonlinear) adjustments
 * to the image layer, as with Levels and Curves adjustments." This is the LINEAR member of
 * that family and the whole of what `brightness()`/`contrast()` can express — Adobe also
 * calls the curve nonlinear, and that half needs a per-pixel LUT this pipeline has no path
 * for. See the boundary note on `buildLevelsFilter`.
 *
 * Each slider unit is a constant fraction of the neutral factor, which is what "proportionate"
 * buys over the exponential this replaced: the response is linear, so the same slider step is
 * the same visual step everywhere on the travel, instead of a curve that is gentle at one end
 * and abrupt at the other.
 *
 * | control    | slider | factor |
 * | ---------- | ------ | ------ |
 * | Brightness | `-150` | `0`    |
 * | Brightness | `0`    | `1`    |
 * | Brightness | `+150` | `2`    |
 * | Contrast   | `-50`  | `0.5`  |
 * | Contrast   | `0`    | `1`    |
 * | Contrast   | `+100` | `2`    |
 *
 * Non-finite input propagates at this low-level formatter. `normalizeLevelsToolArgs()` handles
 * malformed values at the Levels tool boundary, while `presentation-evaluator.ts`'s
 * `numericFilterArg` continues to refuse corrupt retained operations.
 */
export function proportionateFactor(value: number, span: number): number {
  return 1 + value / span;
}

export type ColorsFilterArgs = { grayscale: number; sepia: number; saturation: number };
export type LevelsFilterArgs = { brightness: number; contrast: number };

/**
 * The single source of the Colors CSS filter string. The live preview renderer
 * (`layer-renderer.ts`) and the durable materializer (`materialization.ts`) both route
 * through here, alongside the committing processors, so a layer and its own preview
 * cannot disagree — the drift that four independent copies of this template allowed.
 */
export function buildColorsFilter({ grayscale, sepia, saturation }: ColorsFilterArgs): string {
  const saturate = adjustmentPercent(expAdjustment(saturation, SATURATION_EXPONENT));
  return `grayscale(${grayscale}%) sepia(${sepia}%) saturate(${saturate})`;
}

/**
 * The single source of the Brightness/Contrast CSS filter string, with the same routing
 * guarantee `buildColorsFilter` has: the live preview renderer (`layer-renderer.ts`), the
 * durable materializer (`materialization.ts`) and the committing processor (`levels.ts`) all
 * build through here, so a layer and its own preview cannot disagree.
 *
 * **What this reproduces of Adobe, and what it cannot.** The two terms keep Adobe's own
 * order — brightness first, contrast second — and the pivot `contrast()` provides about
 * mid-grey is the same fixed pivot Photoshop's contrast expands about. Two properties of
 * normal mode come out exact, and they are the two the exponential curve broke:
 *
 * - **The neutral.** `0` is a factor of exactly `1` on both controls, so the default
 *   settings apply nothing. Four suites pin that; a proportionate curve that did not land on
 *   `1` would open every freshly opened document colour-shifted.
 * - **A non-clipping negative half on both controls.** `brightness(0%..100%)` is a monotone
 *   contraction to black and `contrast(0%..100%)` is a monotone contraction about the pivot,
 *   so neither can move a value outside `[0, 1]`. Adobe's contrast minimum reduces the
 *   tonal range and keeps every value where it was; the removed `expAdjustment` reached a
 *   factor of `0` there and flattened the whole image to one grey.
 *
 * **The remaining boundary is the positive half of both controls.** Adobe's normal mode is
 * non-clipping in BOTH directions — "anything that was not white or not black before the move
 * will remain so" — and its measured response is nonlinear (a `+20` brightness reads
 * `10→11`, `128→145`, `250→253`, which no constant scale and no constant offset can produce).
 * A CSS `brightness(f)` is a clamped pure multiply and a CSS `contrast(f)` is a clamped
 * affine pivot, so for any `f > 1` both clip: `contrast(f)` clips every input past
 * `0.5 + 0.5/f`, and `brightness(f)` cannot create a white that was not already white.
 * Reproducing Adobe exactly needs a per-channel lookup table applied per pixel, which is the
 * same absent mechanism `docs/TOOLS-TOO-HARD.md` names for Adobe's real Levels — a filter
 * string cannot express an arbitrary LUT.
 */
export function buildLevelsFilter({ brightness, contrast }: LevelsFilterArgs): string {
  const light = adjustmentPercent(proportionateFactor(brightness, BRIGHTNESS_FACTOR_SPAN));
  const punch = adjustmentPercent(proportionateFactor(contrast, CONTRAST_FACTOR_SPAN));
  return `brightness(${light}) contrast(${punch})`;
}

export function writeImageToCanvas(
  image: BitmapSource,
  canvas: HTMLCanvasElement,
  callback?: ResizeCb
): CanvasRenderingContext2D {
  canvas.width = image.width;
  canvas.height = image.height;

  const ctx = canvas.getContext('2d');
  ctx!.drawImage(image, 0, 0);

  callback?.(image.width, image.height);

  return ctx!;
}

// function base64ToUint8Array(base64) {
//   const binary = atob(base64);
//   const bytes = new Uint8Array(binary.length);
//
//   for (let i = 0; i < binary.length; i++) {
//     bytes[i] = binary.charCodeAt(i);
//   }
//
//   return bytes;
// }
//
// function base64ToBlob(base64, type = 'image/png') {
//   const bytes = base64ToUint8Array(base64);
//   return new Blob([bytes], { type });
// }
