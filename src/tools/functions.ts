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
 * Adobe's current desktop Help page lists Brightness `-150..+150` and Contrast `-50..+100`:
 * <https://helpx.adobe.com/photoshop/desktop/adjust-color/color-corrections/apply-brightness-and-contrast-adjustment.html>
 *
 * These constants define the app's slider bounds and its CSS-factor mapping. Adobe does not
 * publish the default-mode transfer formula on that page, so the app's mapping is not evidence
 * of Photoshop pixel parity.
 */
export const BRIGHTNESS_SLIDER_RANGE = { min: -150, max: 150 } as const;
export const CONTRAST_SLIDER_RANGE = { min: -50, max: 100 } as const;

/**
 * The app's chosen scale for mapping each slider value to a CSS factor. Brightness divides
 * by the absolute value of its minimum; Contrast divides by its maximum. Thus the app maps
 * Brightness `-150/0/+150` to factors `0/1/2` and Contrast `-50/0/+100` to `0.5/1/2`.
 * These are implementation choices for the app's CSS filters, not Photoshop transfer values.
 */
const BRIGHTNESS_FACTOR_SPAN = -BRIGHTNESS_SLIDER_RANGE.min;
const CONTRAST_FACTOR_SPAN = CONTRAST_SLIDER_RANGE.max;

/**
 * The app's linear mapping from a slider value to a CSS filter factor. An older Adobe Help
 * page describes Photoshop's normal mode as proportionate and nonlinear, but publishes no
 * equation for that curve; this function is not a reconstruction of it. See the boundary note
 * on `buildLevelsFilter`.
 *
 * | control    | slider | app factor |
 * | ---------- | ------ | ---------- |
 * | Brightness | `-150` | `0`        |
 * | Brightness | `0`    | `1`        |
 * | Brightness | `+150` | `2`        |
 * | Contrast   | `-50`  | `0.5`      |
 * | Contrast   | `0`    | `1`        |
 * | Contrast   | `+100` | `2`        |
 *
 * Each integer step changes the emitted factor by a constant amount. This describes the app's
 * scalar mapping; it does not imply an equal perceptual or rasterized pixel change. Non-finite
 * input propagates at this low-level formatter. `normalizeLevelsToolArgs()` handles malformed
 * values at the Levels tool boundary, while `presentation-evaluator.ts`'s `numericFilterArg`
 * continues to refuse corrupt retained operations.
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
 * This is the app's CSS factor mapping, not a reconstruction of Photoshop's transfer curve.
 * The W3C Filter Effects Level 1 Working Draft describes `brightness(f)` as a linear
 * multiplier and permits factors above 1. For a normalized channel value `x` and `f > 1`,
 * brightness reaches white when `x >= 1/f`. `contrast(f)` maps `x` to
 * `(x - 0.5) * f + 0.5`; for `f > 1`, values at or below `0.5 - 0.5/f` clamp to black and
 * values at or above `0.5 + 0.5/f` clamp to white.
 * These are CSS filter results after color-range clamping, not Photoshop behavior.
 * <https://www.w3.org/TR/filter-effects-1/>
 *
 * Adobe's current desktop Help page documents the slider ranges and qualitative adjustment
 * behavior but does not publish the default-mode transfer formula:
 * <https://helpx.adobe.com/photoshop/desktop/adjust-color/color-corrections/apply-brightness-and-contrast-adjustment.html>
 * The CSS mapping therefore does not establish pixel parity with Photoshop. Matching a
 * measured Photoshop curve would require a per-channel pixel operation; a filter string cannot
 * express an arbitrary lookup table.
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
