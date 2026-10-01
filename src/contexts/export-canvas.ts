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
 * `drawLayerSource` into its own canvases. Both branches now read the same inputs, so
 * raising the display resolution is a display-only change.
 *
 * THE FRAME IS NOT OPTIONAL IN EFFECT. `documentFrame` supplies both the output extent
 * (`documentFrameSize`) and the coordinate origin (`drawLayersToCanvas` stamps every layer
 * at `position.x - documentFrame.x`), so passing the wrong one crops or offsets the export.
 * It is therefore validated here rather than trusted, and a caller that omitted it is
 * given the frame its own `size` implies — the same fallback `savePsd` applies.
 */
export function renderExportCanvas(layers: LayersRecord, size: Size, frame?: DocumentFrame): HTMLCanvasElement {
  const documentFrame = frame && isValidDocumentFrame(frame) ? frame : documentFrameFromSize(size);
  const canvas = document.createElement('canvas');
  const published = drawLayersToCanvas(canvas, getSortedLayersArray(layers), documentFrame);
  // `drawLayersToCanvas` reports false when a source or the 2d context fails, and its
  // staging discipline means a false return leaves the target untouched — so a canvas
  // handed on here would encode a blank or stale document. Throwing puts the failure on
  // the path the save dialog already handles: the promise resolves `null`, the dialog
  // stays up, and the user can change format and retry.
  if (!published || canvas.width !== documentFrameSize(documentFrame).width) {
    throw new Error('Unable to render the document for export');
  }
  return canvas;
}
