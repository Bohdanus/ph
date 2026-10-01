import type { DocumentFrame } from './document-frame.ts';
import { documentFrameFromSize, documentFrameSize, isValidDocumentFrame } from './document-frame.ts';
import type { LayersRecord } from './layer-types.ts';
import type { Size } from './general-types.ts';
import { drawLayersToCanvas } from './layer-renderer.ts';
import { getSortedLayersArray } from './layer-utils.ts';

/**
 * Builds the surface a raster export encodes from.
 *
 * WHY THIS EXISTS. Export used to be handed the visible workspace canvas
 * (`canvasRef.current`) by `DesktopHeader`, `MobileHeader` and `MobileMenuDrawer`, which
 * made the surface that decides exported file dimensions the same surface the user looks
 * at. That is a real product invariant today — the export is the document at the document
 * resolution, so image pixels are document pixels — but it is only incidental: nothing
 * stopped a change to the DISPLAY canvas from silently changing what every export
 * produced, and three gates (`e2e/export/visual-regression.spec.ts`,
 * `e2e/export/helpers.ts`, `e2e/helpers/image-comparison.ts`) would all have gone red
 * together. `CANVAS-RESOLUTION-PLAN.md` records this as D1.
 *
 * The export path is now the same shape as the PSD path, which has always been decoupled:
 * `psd-utils.ts` takes `(layers, size, documentFrame)` and rasterizes through
 * `drawLayerSource` into its own canvases. Neither branch reads the display surface any
 * more, so raising the display resolution is a display-only change.
 *
 * THE TWO BRANCHES SIZE DIFFERENTLY, AND THAT IS NOT SETTLED. This one takes its extent
 * from `documentFrame` and ignores `size`; `savePsd` takes its extent from `size` and uses
 * the frame only for layer offsets (`psd-utils.ts:239`). They agree on every reachable
 * input because every store writer that sets a frame re-derives `totalSize` from it, and
 * the one reducer arm that could set `size` alone (`SET_SIZE`) has no dispatcher. If that
 * ever changes, one document would raster-export at the frame's extent and PSD-export at
 * `size`'s — two pixel dimensions for one document, silently. Reconciling them is the
 * fix; a comment is not.
 *
 * THE FRAME IS NOT OPTIONAL IN EFFECT. `documentFrame` supplies both the output extent
 * (`documentFrameSize`) and the coordinate origin (`drawLayersToCanvas` stamps every layer
 * at `position.x - documentFrame.x`), so passing the wrong one crops or offsets the export.
 * It is therefore validated here rather than trusted, and a caller that omitted it is
 * given the frame its own `size` implies — the fallback `savePsd` applies when its frame
 * argument is absent, though not when one is passed invalid, which is why the asymmetry
 * exists at all.
 */
export function renderExportCanvas(layers: LayersRecord, size: Size, frame?: DocumentFrame): HTMLCanvasElement {
  const documentFrame = frame && isValidDocumentFrame(frame) ? frame : documentFrameFromSize(size);
  const canvas = document.createElement('canvas');
  const published = drawLayersToCanvas(canvas, getSortedLayersArray(layers), documentFrame);
  // `drawLayersToCanvas` reports false when a source or the 2d context fails. Its staging
  // discipline does NOT always leave the target untouched: only the two early returns
  // (layer-renderer.ts:123, :132) do, while the publish failures at :138 and :142-144 run
  // after `resizeCanvas` and `clearRect` have already written to it. Either way the
  // surface is untrustworthy — a fresh canvas holds nothing stale, so it would encode a
  // BLANK document at the right dimensions. Throwing puts the failure on the path the
  // save dialog already handles: the promise resolves `null`, the dialog stays up, and
  // the user can change format and retry. Nothing tells them it failed; see HANDOFF.md.
  if (!published || canvas.width !== documentFrameSize(documentFrame).width) {
    throw new Error('Unable to render the document for export');
  }
  return canvas;
}
