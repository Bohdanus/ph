import { useRef, type RefObject } from 'react';
import { useLayers } from '../../contexts/useLayer.ts';
import { useStore } from '../../contexts/StoreContext.tsx';
import { useCurrentTool } from '../../contexts/useCurrentTool.tsx';
import { usePaintStroke } from '../../hooks/usePaintStroke.ts';
import { processorPresentationBounds } from '../../contexts/presentation-evaluator.ts';
import { documentPointsToLayerLocal } from '../../util/layer-space.ts';
import type { DodgeBurnToolArgs } from '../../tools/dodgeBurn.ts';

/**
 * Props are the three `Main.tsx` mounts every tool area with. Only `className` is
 * destructured: burn previews through `tempUpdateLayer` rather than by painting the
 * overlay, so `canvasCtxRef` and `overlayCtxRef` are part of the mount contract and
 * nothing else. Declaring them keeps this component assignable to the union `Main.tsx`
 * narrows `EventHandler` over.
 */
type BurnToolAreaProps = {
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
 * The Burn tool's gesture surface: one press/move/release over the document edits the
 * ACTIVE LAYER, it does not create one.
 *
 * This is `DodgeToolArea.tsx` with `'burn'` in place of `'dodge'`, and the duplication
 * is intentional. The two are separate components because `Main.tsx` selects one
 * `EventHandler` per tool, and merging them behind a `toolName` prop would put the
 * selection that already exists in one place into a second place that could disagree
 * with it. The lasso pair (`PolygonalSelectionToolArea` / `FeatherMagneticLassoToolArea`)
 * are the same shape, for the same reason.
 *
 * The commit split is the load-bearing part. `tempUpdateLayer` is the only writer of
 * `previewLayersRef` through `tempUpdateLayer()`, so every move has to go through
 * it or `commitDirtyTool` takes its `PUBLISH_RUNTIME_PRESENTATION` branch, writes no
 * history item, and the burn becomes silently and permanently un-undoable. Conversely
 * `updateLayerByTool` is the undo boundary and must be reached exactly ONCE per gesture,
 * which `usePaintStroke` arranges by appending the release point and then calling
 * `onCommit`.
 *
 * The coordinate conversion is the other half. `usePaintStroke` yields document-space
 * points; the processor is handed the PRESENTED layer's own raster in that
 * presentation's space, so the frame the processor addresses starts at
 * `rasterBounds` and a document point has to become `point - rasterBounds` before it
 * is used as a pixel address.
 * `src/util/layer-space.ts` states the two spaces; `DodgeToolArea.tsx` carries the
 * identical conversion and the argument for making it at this callback boundary.
 */
export const BurnToolArea = ({ className }: BurnToolAreaProps) => {
  const [{ containerRef, activeLayerId, layers, totalSize }] = useStore();
  const { tempUpdateLayer, updateLayerByTool, cancelLayerPreview } = useLayers();
  const { getToolArgs } = useCurrentTool();

  const args = getToolArgs('burn') as DodgeBurnToolArgs | null;
  const activeLayer = activeLayerId ? layers[activeLayerId] : null;
  // Bedrock is the document's background and is not addressable by a raster tool: there
  // is no layer to commit onto, so a stroke over it would have nowhere to go.
  const enabled = Boolean(args && activeLayerId && activeLayer && !activeLayer.isBedrock);
  // The origin of the raster the processor is handed: `pos` for a layer that presents
  // nothing, its EVALUATED extent for one carrying a transform or a filter.
  const rasterBounds = activeLayer ? processorPresentationBounds(activeLayer) : null;
  const previewLayerIdRef = useRef<typeof activeLayerId>(null);

  const { onPointerDown, onPointerMove, onPointerUp, onPointerLeave } = usePaintStroke(
    { imageSize: totalSize, containerRef, enabled, gestureKey: activeLayerId },
    {
      onStart: () => {
        previewLayerIdRef.current = activeLayerId;
      },
      onMove: (points) => {
        if (!args || !activeLayerId) return;
        /**
         * The invariant this establishes: the processor addresses the LAYER's own raster,
         * whose pixel (0, 0) is `rasterBounds`, so a document point becomes
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
        previewLayerIdRef.current = null;
      },
      onCancel: () => {
        const layerId = previewLayerIdRef.current;
        previewLayerIdRef.current = null;
        if (layerId) cancelLayerPreview(layerId);
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
