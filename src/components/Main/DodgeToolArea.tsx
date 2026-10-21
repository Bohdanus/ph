import type { RefObject } from 'react';
import { useLayers } from '../../contexts/useLayer.ts';
import { useStore } from '../../contexts/StoreContext.tsx';
import { useCurrentTool } from '../../contexts/useCurrentTool.tsx';
import { usePaintStroke } from '../../hooks/usePaintStroke.ts';
import { processorPresentationBounds } from '../../contexts/presentation-evaluator.ts';
import { documentPointsToLayerLocal } from '../../util/layer-space.ts';
import type { DodgeBurnToolArgs } from '../../tools/dodgeBurn.ts';

/**
 * Props are the three `Main.tsx` mounts every tool area with. Only `className` is
 * destructured: dodge previews through `tempUpdateLayer` rather than by painting the
 * overlay, so `canvasCtxRef` and `overlayCtxRef` are part of the mount contract and
 * nothing else. Declaring them keeps this component assignable to the union
 * `Main.tsx` narrows `EventHandler` over.
 */
type DodgeToolAreaProps = {
  className?: string;
  /**
   * Optional: accepted so every tool area in the union can be rendered with one prop set, and
   * read from the store rather than the prop when it is needed. `Main` passes only
   * `overlayCtxRef`, so a required declaration here is a type error at the call site and an
   * `undefined` at runtime. `EllipticalSelectionToolArea` and `QuickSelectionToolArea` already
   * declare it this way.
   */
  canvasCtxRef?: RefObject<CanvasRenderingContext2D | null>;
  overlayCtxRef: RefObject<CanvasRenderingContext2D | null>;
};

/**
 * The Dodge tool's gesture surface: one press/move/release over the document edits the
 * ACTIVE LAYER, it does not create one.
 *
 * The commit split is the whole file. `tempUpdateLayer` is the only writer of
 * `previewLayersRef` through `tempUpdateLayer()`, so every move has to go through
 * it or `commitDirtyTool` takes its `PUBLISH_RUNTIME_PRESENTATION` branch, writes no
 * history item, and the dodge becomes silently and permanently un-undoable. Conversely
 * `updateLayerByTool` is the undo boundary and must be reached exactly ONCE per gesture
 * — `usePaintStroke` appends the release point and then calls `onCommit`, so committing
 * from `onMove` as well would write one `TOOL_ACTION` per pointer event.
 *
 * The canvas-to-document conversion is `usePaintStroke`'s job
 * under `usePaintStroke()`'s contract, so `points` arrives in document space. The
 * layer-local conversion is this file's: the processor is handed a buffer in the PRESENTED
 * layer's own space, so the frame the processor addresses starts at that presentation's origin
 * and carries no document origin, and a document point has to become `point - origin` before
 * it is used as a pixel address. `src/util/layer-space.ts` states the two spaces and why the
 * conversion is made at this callback boundary rather than in the hook or in the processor.
 */
export const DodgeToolArea = ({ className }: DodgeToolAreaProps) => {
  const [{ containerRef, activeLayerId, layers, totalSize }] = useStore();
  const { tempUpdateLayer, updateLayerByTool } = useLayers();
  const { getToolArgs } = useCurrentTool();

  const args = getToolArgs('dodge') as DodgeBurnToolArgs | null;
  const activeLayer = activeLayerId ? layers[activeLayerId] : null;
  // Bedrock is the document's background and is not addressable by a raster tool: there
  // is no layer to commit onto, so a stroke over it would have nowhere to go.
  const enabled = Boolean(args && activeLayerId && activeLayer && !activeLayer.isBedrock);
  // The origin of the raster the processor is handed, which is `pos` for a layer that
  // presents nothing and its EVALUATED extent for one carrying a transform or a filter.
  const rasterBounds = activeLayer ? processorPresentationBounds(activeLayer) : null;

  const { onPointerDown, onPointerMove, onPointerUp, onPointerLeave } = usePaintStroke(
    { imageSize: totalSize, containerRef, enabled },
    {
      onMove: (points) => {
        if (!args || !activeLayerId) return;
        /**
         * The invariant this establishes: the processor addresses the PRESENTED layer's own
         * raster, whose pixel (0, 0) is `rasterBounds`, so a document point becomes
         * `point - rasterBounds` and a layer at the origin passes through unchanged. The
         * live array is read here and never retained — the rebase allocates a fresh array,
         * so the hook's own accumulator is left alone and the processor runs synchronously
         * over the copy.
         */
        tempUpdateLayer({
          id: activeLayerId,
          toolArgs: { ...args, points: documentPointsToLayerLocal(points, rasterBounds) },
        });
      },
      // A fresh copy, so the history entry retains a stroke that will not keep growing, and
      // the same rebase as the preview, so what history retains is what the processor
      // addresses on replay (`src/contexts/useHistory.ts` — `applyRasterTool`).
      onCommit: (points) => {
        if (!args || !activeLayerId) return;
        void updateLayerByTool({
          id: activeLayerId,
          toolArgs: { ...args, points: documentPointsToLayerLocal(points, rasterBounds) },
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
