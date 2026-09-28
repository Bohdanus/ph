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
// these into one constant changes how hard all three sliders feel.
const SATURATION_EXPONENT = 2.1;
const BRIGHTNESS_EXPONENT = 1.9;
const CONTRAST_EXPONENT = 2.2;

/**
 * The CSS filter multiplier for a signed percentage adjustment, over the `-100..100`
 * travel that every Colors and Levels slider is labelled in.
 *
 * This is the exponential `exp(k * val / 100)` re-anchored so that all three of its
 * contractual endpoints are exact rather than approximate:
 *
 * | `val`  | factor | emitted  |
 * | ------ | ------ | -------- |
 * | `-100` | `0`    | `0%`     |
 * | `0`    | `1`    | `100%`   |
 * | `+100` | `> 1`  | `> 100%` |
 *
 * A bare `exp(k * val / 100)` cannot carry this contract: it is strictly positive for
 * every finite input and at least `1` for every non-negative one, so no slider range
 * can make Brightness reach black or Saturation desaturate, and the neutral that the
 * default settings depend on only lands on `1` by accident of the curve's origin.
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

/** @see buildColorsFilter */
export function buildLevelsFilter({ brightness, contrast }: LevelsFilterArgs): string {
  const light = adjustmentPercent(expAdjustment(brightness, BRIGHTNESS_EXPONENT));
  const punch = adjustmentPercent(expAdjustment(contrast, CONTRAST_EXPONENT));
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
