import type { Point, Size } from '../contexts/general-types.ts';
import { type EyedropperSampleSize } from './eyedropper.ts';
import { colorSampleBounds, sampleColorAtMappedPixels } from './colorSampler.ts';

/**
 * Reading a document pixel for a sampler, out of one canvas.
 *
 * **This is the composited workspace canvas** — the element `drawLayersToCanvas` composites every
 * visible layer into — and not the active layer, for the Eyedropper's reason: it is the pixel the
 * user actually clicked. `drawLayersToCanvas` sizes that canvas to the document FRAME and stamps
 * each layer at `position.x - documentFrame.x`, so the canvas's own pixel (0,0) IS the frame origin.
 * A frame-space point names a logical pixel and must be mapped to the rounded backing bitmap before
 * `getImageData`; running a document-space point through `canvasToDocumentPoint` first would add the
 * frame origin a second time.
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
 * document frame, or the representative center texel is transparent. Transparent-center refusal is
 * an app policy; the reviewed Adobe help pages do not define that behavior.
 */
export type ColorSamplerReadback = { ok: true; color: string | null } | { ok: false; reason: string };

/**
 * The colour at `point`, or why there is not one. The point and sample size are in document pixels;
 * `getImageData` reads only the backing-pixel rectangle representing that logical sample.
 *
 * The `getImageData` existence check is the Eyedropper's and it is not defensive noise: a 2D context
 * without `getImageData` is reachable under a test stub, and the app's own colour tools guard the
 * same way (`FillToolArea.tsx`, `EyedropperToolArea.tsx`). Without the check this would throw a
 * `TypeError` instead of naming the reason.
 */
export const readColorSampler = (
  canvas: HTMLCanvasElement | null,
  point: Point,
  sampleSize: EyedropperSampleSize,
  frameSize: Size
): ColorSamplerReadback => {
  if (!canvas) return { ok: false, reason: COLOR_SAMPLER_READBACK_UNAVAILABLE };

  const ctx = canvas.getContext('2d');
  if (!ctx || typeof ctx.getImageData !== 'function') {
    return { ok: false, reason: COLOR_SAMPLER_READBACK_UNAVAILABLE };
  }

  const bounds = colorSampleBounds(frameSize, point, sampleSize);
  if (!bounds || canvas.width < 1 || canvas.height < 1) return { ok: true, color: null };

  // `resizeCanvas` removes the published attribute at 1×, so an absent value means the backing
  // bitmap is in document pixels. The caller's DPR hook can lag the canvas resize and is not an
  // authority for readback coordinates.
  const publishedScale = canvas.getAttribute('data-hidpi-ratio');
  const scale = publishedScale === null ? 1 : Number(publishedScale);
  if (
    !Number.isFinite(scale) ||
    scale <= 0 ||
    !Number.isSafeInteger(frameSize.width) ||
    !Number.isSafeInteger(frameSize.height) ||
    frameSize.width < 1 ||
    frameSize.height < 1 ||
    canvas.width !== Math.round(frameSize.width * scale) ||
    canvas.height !== Math.round(frameSize.height * scale)
  ) {
    return { ok: false, reason: COLOR_SAMPLER_READBACK_UNAVAILABLE };
  }

  // At scales below 1×, multiple logical pixels can resolve to the same backing texel. That is the
  // visible composited value available from this canvas; sample each logical document pixel once
  // rather than claiming to reconstruct source-layer pixels the canvas no longer contains.
  const toBitmapCoordinate = (documentPixel: number, extent: number): number =>
    Math.max(0, Math.min(extent - 1, Math.floor((documentPixel + 0.5) * scale)));
  const readLeft = toBitmapCoordinate(bounds.left, canvas.width);
  const readTop = toBitmapCoordinate(bounds.top, canvas.height);
  const readRight = toBitmapCoordinate(bounds.right - 1, canvas.width) + 1;
  const readBottom = toBitmapCoordinate(bounds.bottom - 1, canvas.height) + 1;
  if (readRight <= readLeft || readBottom <= readTop) return { ok: true, color: null };

  let imageData: ImageData;
  try {
    imageData = ctx.getImageData(readLeft, readTop, readRight - readLeft, readBottom - readTop);
  } catch {
    return { ok: false, reason: COLOR_SAMPLER_READBACK_UNAVAILABLE };
  }

  return {
    ok: true,
    color: sampleColorAtMappedPixels(
      imageData.data,
      imageData.width,
      imageData.height,
      frameSize,
      point,
      sampleSize,
      (documentX, documentY) => ({
        x: toBitmapCoordinate(documentX, canvas.width) - readLeft,
        y: toBitmapCoordinate(documentY, canvas.height) - readTop,
      })
    ),
  };
};
