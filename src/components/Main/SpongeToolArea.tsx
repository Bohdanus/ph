import type { RefObject } from 'react';
import { useLayers } from '../../contexts/useLayer.ts';
import { useStore } from '../../contexts/StoreContext.tsx';
import { useCurrentTool } from '../../contexts/useCurrentTool.tsx';
import { usePaintStroke } from '../../hooks/usePaintStroke.ts';
import { processorPresentationBounds } from '../../contexts/presentation-evaluator.ts';
import { documentPointsToLayerLocal } from '../../util/layer-space.ts';
import type { SpongeToolArgs } from '../../tools/sponge.ts';

/**
 * Props are the three `Main.tsx` mounts every tool area with. Only `className` is
 * destructured, for the reason `DodgeToolArea` gives: this component previews
 * through `tempUpdateLayer` rather than by painting the overlay, so `canvasCtxRef` and
 * `overlayCtxRef` are part of the mount contract and nothing else. Declaring them keeps
 * this component assignable to the union `Main.tsx` narrows `EventHandler` over.
 */
type SpongeToolAreaProps = {
  className?: string;
  /** `Main` passes only `overlayCtxRef`, as it does for `DodgeToolArea`. */
  canvasCtxRef?: RefObject<CanvasRenderingContext2D | null>;
  overlayCtxRef: RefObject<CanvasRenderingContext2D | null>;
};

/**
 * The Sponge's gesture surface: one press/move/release over the document edits the ACTIVE
 * LAYER, it does not create one.
 *
 * This is `DodgeToolArea.tsx` with the tool name changed, and that is deliberate rather
 * than lazy — `BurnToolArea` records the same decision for the pair beside it, and
 * the two reasons are load-bearing:
 *
 * - **`tempUpdateLayer` is the only writer of `previewLayersRef`**
 *   through `tempUpdateLayer()`, so every move has to go through it or
 *   `commitDirtyTool` takes its `PUBLISH_RUNTIME_PRESENTATION` branch, writes no history
 *   item, and the sponge becomes silently and permanently un-undoable.
 * - **`updateLayerByTool` is the undo boundary and must be reached exactly ONCE per
 *   gesture.** `usePaintStroke` appends the release point and then calls `onCommit`, so
 *   committing from `onMove` as well would write one `TOOL_ACTION` per pointer event.
 *
 * The canvas-to-document conversion is `usePaintStroke`'s job, so `points` arrives in
 * document space; the layer-local conversion is this file's, for the reason
 * `DodgeToolArea.tsx` states — the processor addresses the PRESENTED layer's own raster,
 * whose pixel (0, 0) is `rasterBounds`.
 *
 * Bedrock is refused for the same reason it is on the Dodge: it is the document background,
 * there is no layer to commit onto, and a stroke over it would have nowhere to go.
 */
export const SpongeToolArea = ({ className }: SpongeToolAreaProps) => {
  const [{ containerRef, activeLayerId, layers, totalSize }] = useStore();
  const { tempUpdateLayer, updateLayerByTool } = useLayers();
  const { getToolArgs } = useCurrentTool();

  const args = getToolArgs('sponge') as SpongeToolArgs | null;
  const activeLayer = activeLayerId ? layers[activeLayerId] : null;
  const enabled = Boolean(args && activeLayerId && activeLayer && !activeLayer.isBedrock);
  // The origin of the raster the processor is handed: `pos` for a layer that presents
  // nothing, its EVALUATED extent for one carrying a transform or a filter.
  const rasterBounds = activeLayer ? processorPresentationBounds(activeLayer) : null;

  const { onPointerDown, onPointerMove, onPointerUp, onPointerLeave } = usePaintStroke(
    { imageSize: totalSize, containerRef, enabled },
    {
      onMove: (points) => {
        if (!args || !activeLayerId) return;
        tempUpdateLayer({
          id: activeLayerId,
          toolArgs: { ...args, points: documentPointsToLayerLocal(points, rasterBounds) },
        });
      },
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
