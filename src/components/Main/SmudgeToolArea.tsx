import type { RefObject } from 'react';
import { useStore } from '../../contexts/StoreContext.tsx';
import { useLayers } from '../../contexts/useLayer.ts';
import { useCurrentTool } from '../../contexts/useCurrentTool.tsx';
import { usePaintStroke } from '../../hooks/usePaintStroke.ts';
import { documentPointsToLayerLocal } from '../../util/layer-space.ts';
import type { SmudgeToolArgs } from '../../tools/smudge.ts';

type smudgeToolAreaProps = {
  className?: string;
  /**
   * Accepted for the mount contract and deliberately not read. The Smudge edits the active
   * layer's own raster through `tempUpdateLayer` / `updateLayerByTool`, which republish the
   * layer and redraw the document canvas themselves; unlike the Move tool there is no drag
   * geometry drawn straight onto a context here, so a tool painting into either context by
   * hand is the un-undoable defect `usePaintStroke`'s JSDoc warns about.
   */
  canvasCtxRef: RefObject<CanvasRenderingContext2D | null>;
  /** The sibling of `canvasCtxRef`, unused for the same reason. */
  overlayCtxRef: RefObject<CanvasRenderingContext2D | null>;
};

/**
 * The Smudge's gesture surface: one undoable edit per press/move/release on the active
 * layer.
 *
 * The two callbacks are the whole contract, and the split between them is the part that is
 * easy to get silently wrong:
 *
 * - `onMove` goes to `tempUpdateLayer` (`src/contexts/useLayer.ts:473`), the only writer of
 *   `previewLayersRef`. A tool that painted anywhere else would produce pixels with no history
 *   entry, and `commitDirtyTool` (`:323`) would then take its `PUBLISH_RUNTIME_PRESENTATION`
 *   branch and never warn — the strokes would be un-undoable forever, with no error and no
 *   visible sign of it.
 * - `onCommit` goes to `updateLayerByTool` (`:264`), which writes the single `TOOL_ACTION`
 *   history item that makes the stroke undoable. It fires exactly once, on pointer-up, so
 *   calling it from a move handler would put one history entry per pointer event on the
 *   timeline.
 *
 * Neither callback is a no-op for a Smudge specifically: the processor re-runs its whole drag
 * from the SOURCE raster on every call, so a preview is the full stroke as it stands rather
 * than an incremental patch. That is why `onMove` is a preview and `onCommit` is a replay of
 * the same args and not an accumulation of them.
 *
 * `points` arrives in DOCUMENT space (`usePaintStroke` converts through the document frame,
 * which is the crop origin), and the processor does not speak that space: `tempUpdateLayer`
 * hands it the layer's OWN raster with `size: layer.pos` (`src/contexts/useLayer.ts:544`), so
 * the frame it addresses is layer-local and carries no document origin. Every stroke is
 * therefore rebased onto the active layer at the callback boundary, which is the last point
 * where this component still knows which layer it is editing; `src/util/layer-space.ts`
 * states the two spaces and why the conversion is made here rather than in the hook or in
 * the processor. No `onPreview` is passed: the live pixels come from `tempUpdateLayer`, so a
 * second repaint path would only add a re-render per pointer move for the same result.
 */
export const SmudgeToolArea = ({ className }: smudgeToolAreaProps) => {
  const [{ containerRef, activeLayerId, layers, totalSize }] = useStore();
  const { tempUpdateLayer, updateLayerByTool } = useLayers();
  const { toolArgs } = useCurrentTool();

  const args = toolArgs as SmudgeToolArgs;
  const activeLayer = activeLayerId ? layers[activeLayerId] : undefined;

  /**
   * A raster edit to the BEDROCK layer is wrong, not merely surprising: bedrock is the
   * document's own backing image — the floor every other layer composites over — and the
   * Smudge drags pixels out of the document, so there would be no layer left to drag them
   * from. `MoveToolArea.tsx:35` reads the same flag for the same reason.
   *
   * `usePaintStroke` reads `enabled` at gesture boundaries only, so a layer that disappears
   * under the pointer abandons the gesture rather than half-committing it.
   */
  const isEnabled = Boolean(activeLayerId && activeLayer && !activeLayer.isBedrock);

  const { onPointerDown, onPointerMove, onPointerUp, onPointerLeave } = usePaintStroke(
    { imageSize: totalSize, containerRef, enabled: isEnabled },
    {
      onMove: (points) => {
        /**
         * The invariant this establishes: the processor addresses the LAYER's own raster,
         * whose pixel (0, 0) is `activeLayer.pos`, so a document point becomes
         * `point - activeLayer.pos` and a layer at the origin passes through unchanged. A
         * Smudge reads and writes the same buffer, so an un-rebased point smudged the wrong
         * pixels entirely rather than merely offsetting the stroke. `onMove` gets the LIVE
         * accumulating array, which the rebase copies rather than writes into;
         * `tempUpdateLayer` runs the processor synchronously over the copy, so nothing here
         * retains it.
         */
        tempUpdateLayer({
          id: activeLayerId!,
          toolArgs: { ...args, points: documentPointsToLayerLocal(points, activeLayer?.pos) },
        });
      },
      onCommit: async (points) => {
        // A fresh copy from the hook, so the history item this reaches does not alias a ref
        // the hook is about to reset, and the same rebase as the preview, so what history
        // retains is what the processor addresses on replay
        // (`src/contexts/useHistory.ts:98-108`).
        await updateLayerByTool({
          id: activeLayerId!,
          toolArgs: { ...args, points: documentPointsToLayerLocal(points, activeLayer?.pos) },
        });
      },
    }
  );

  return (
    <div
      className={`${className} cursor-crosshair`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerLeave}
    />
  );
};
