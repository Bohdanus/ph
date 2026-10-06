import type { Point } from '../contexts/general-types.ts';
import { type EyedropperSampleSize } from './eyedropper.ts';
import { sampleColorAt } from './colorSampler.ts';

/**
 * Reading a document pixel for a sampler, out of one canvas.
 *
 * **This is the composited workspace canvas** — the element `drawLayersToCanvas` composites every
 * visible layer into — and not the active layer, for the Eyedropper's reason: it is the pixel the
 * user actually clicked. `drawLayersToCanvas` sizes that canvas to the document FRAME and stamps
 * each layer at `position.x - documentFrame.x`, so a document-space point IS a canvas pixel and
 * running it through `canvasToDocumentPoint` first would add the frame origin a second time.
 * (`EyedropperToolArea.tsx` states that arithmetic at length; this is its own sentence so the two
 * call sites cannot drift apart on it.)
 *
 * It lives in its own module rather than inside `ColorSamplerToolArea` because **two different tool
 * areas place samplers** — this one, and the Eyedropper under `Shift`, which is Adobe's own
 * sentence: "To add new color samplers, select the Color Sampler tool and click in the image, or
 * select the Eyedropper tool and Shift-click in the image."
 * <https://helpx.adobe.com/photoshop/using/viewing-histograms-pixel-values.html>
 */
export const COLOR_SAMPLER_READBACK_UNAVAILABLE = 'color-sampler-readback-unavailable';

/**
 * The result of one read.
 *
 * The two failure kinds are DIFFERENT and are deliberately not merged. `ok: false` is a refusal the
 * caller must report loudly: the canvas could not be read at all, and a sampler with no colour is a
 * tool that looks broken. `ok: true, color: null` is a quiet nothing: the point was outside the
 * bitmap, or the pixel under it is fully transparent and has no colour to report. Photoshop shows a
 * crossed-out swatch there and changes nothing, so nothing is returned and nothing is drawn.
 */
export type ColorSamplerReadback = { ok: true; color: string | null } | { ok: false; reason: string };

/**
 * The colour at `point`, or why there is not one.
 *
 * The `getImageData` existence check is the Eyedropper's and it is not defensive noise: a 2D context
 * without `getImageData` is reachable under a test stub, and the app's own colour tools guard the
 * same way (`FillToolArea.tsx`, `EyedropperToolArea.tsx`). Without the check this would throw a
 * `TypeError` instead of naming the reason.
 */
export const readColorSampler = (
  canvas: HTMLCanvasElement | null,
  point: Point,
  sampleSize: EyedropperSampleSize
): ColorSamplerReadback => {
  if (!canvas) return { ok: false, reason: COLOR_SAMPLER_READBACK_UNAVAILABLE };

  const ctx = canvas.getContext('2d');
  if (!ctx || typeof ctx.getImageData !== 'function') {
    return { ok: false, reason: COLOR_SAMPLER_READBACK_UNAVAILABLE };
  }

  return {
    ok: true,
    color: sampleColorAt(
      ctx.getImageData(0, 0, canvas.width, canvas.height).data,
      canvas.width,
      canvas.height,
      point,
      sampleSize
    ),
  };
};
