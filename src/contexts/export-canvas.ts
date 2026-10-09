import type { DocumentFrame } from './document-frame.ts';
import { documentFrameSize, resolveDocumentFrame } from './document-frame.ts';
import type { LayersRecord } from './layer-types.ts';
import type { Size } from './general-types.ts';
import type { DurableComposite } from './durable-compositor.ts';
import type { DurableReplayResult } from './durable-replay.ts';
import { drawLayersToCanvas } from './layer-renderer.ts';
import { getSortedLayersArray } from './layer-utils.ts';

export type DurableExportRecords = Readonly<{
  layers: LayersRecord;
  size: Size;
  frame: DocumentFrame;
}>;

/**
 * Adapts a complete durable replay/materialization pair to the existing raster
 * and PSD export contracts. The composite owns the bitmaps; this adapter only
 * borrows them until the caller releases the composite after encoding.
 */
export function durableExportRecords(replay: DurableReplayResult, composite: DurableComposite): DurableExportRecords {
  const layers: LayersRecord = {};
  for (const { snapshot } of Object.values(replay.layers)) {
    const materialized = composite.layers[snapshot.id];
    layers[snapshot.id] = {
      id: snapshot.id,
      name: snapshot.name,
      isBedrock: snapshot.isBedrock,
      bitmap: null,
      tmpCanvas: materialized?.bitmap ?? null,
      visible: snapshot.visible,
      opacity: snapshot.opacity,
      locked: snapshot.locked,
      blendMode: snapshot.blendMode,
      order: snapshot.order,
      pos: materialized?.bounds ?? snapshot.pos,
      presentationBounds: null,
      operations: [],
    };
  }
  return {
    layers,
    size: documentFrameSize(replay.frame),
    frame: replay.frame,
  };
}

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
 * Both export formats resolve the same document frame: a valid frame owns the output extent
 * and coordinate origin, while a missing or invalid frame falls back to the frame implied
 * by `size`. `resolveDocumentFrame()` is the shared boundary so raster and PSD exports cannot
 * disagree about frame validity or document dimensions.
 */
export function renderExportCanvas(layers: LayersRecord, size: Size, frame?: DocumentFrame): HTMLCanvasElement {
  const documentFrame = resolveDocumentFrame(size, frame);
  const canvas = document.createElement('canvas');
  const published = drawLayersToCanvas(canvas, getSortedLayersArray(layers), documentFrame);
  // `drawLayersToCanvas` reports false when a source or the 2d context fails. Its staging
  // discipline does NOT always leave the target untouched: the early returns
  // (layer-renderer.ts:137, :160) and the compose-time catch (:152-155) do, while the
  // publish catch (:165-175) runs after `resizeCanvas` and `clearRect` have already written
  // to it — it now restores the previous extent before returning (:166-172). Either way the
  // surface is untrustworthy — a fresh canvas holds nothing stale, so it would encode a
  // BLANK document at the right dimensions. Throwing puts the failure on the path the
  // save dialog already handles: the promise resolves `null`, the dialog stays up, and
  // the user can change format and retry. Nothing tells them it failed; see HANDOFF.md.
  // Both axes, not one. `drawLayersToCanvas` derives the extent it resizes to from the very
  // frame this compares against, so a mismatch means the compositor ignored the frame — and a
  // compositor that sized the target to the right width and the wrong height is the shape a
  // height-blind check accepts, which is how a file of the wrong dimensions gets encoded from
  // a surface that reported success. `documentFrameSize` is read once so both comparisons
  // name the same size.
  const { width, height } = documentFrameSize(documentFrame);
  if (!published || canvas.width !== width || canvas.height !== height) {
    throw new Error('Unable to render the document for export');
  }
  return canvas;
}
