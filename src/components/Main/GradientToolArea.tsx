import { type RefObject } from 'react';
import { useCurrentTool } from '../../contexts/useCurrentTool.tsx';
import { useLayers } from '../../contexts/useLayer.ts';
import { useStore } from '../../contexts/StoreContext.tsx';
import { usePaintStroke } from '../../hooks/usePaintStroke.ts';
import { documentPointToLayerLocal } from '../../util/layer-space.ts';
import type { Point } from '../../contexts/general-types.ts';
import type { GradientToolArgs } from '../../tools/gradient.ts';

type gradientToolAreaProps = {
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

/** Layer-local endpoints for a drag that began and ended at these DOCUMENT-space points. */
type GradientEndpoints = { from: Point; to: Point };

/**
 * The Gradient tool area: one drag, one gradient, one undo entry.
 *
 * ## The preview is `tempUpdateLayer`'s, not the tool overlay
 *
 * `usePaintStroke` offers two ways to show a live preview — an `onPreview` callback that repaints
 * `overlayCtxRef`, or `onMove` -> `tempUpdateLayer` — and this tool takes the second. The reason
 * is that the two are not equivalent for a full-layer raster: the gradient's preview IS the
 * finished layer, pixel for pixel, so drawing it a second time on the overlay composites the
 * same gradient twice and then has to be cleared again on commit and on cancel. `tempUpdateLayer`
 * is also the only writer of `previewLayersRef`, which is what lets `commitDirtyTool` promote the
 * preview into a real layer with a history entry; a preview that only ever touched the overlay
 * would be an un-undoable fill. `src/hooks/usePaintStroke.ts:146-159` documents that contract.
 *
 * `overlayCtxRef` is therefore accepted and unused: the mount signature in
 * `src/components/Main/Main.tsx` passes both contexts to every tool area, and declining one is
 * not a reason to change that.
 *
 * ## No local `documentFrame`
 *
 * Every other tool area in this directory spells out
 * `documentFrame ?? documentFrameFromSize(totalSize)`, and this one deliberately does not:
 * `usePaintStroke` resolves the frame itself (`src/hooks/usePaintStroke.ts:141-145`) and
 * converts every pointer sample through it before any callback here runs. A second resolution
 * would be a second place for the crop offset to be got wrong, and it would be dead — the value
 * would never be read.
 *
 * ## `from`/`to` are stored layer-local
 *
 * The args are documented as a document-space drag, and they are: `usePaintStroke` converts every
 * pointer sample through `canvasToDocumentPoint` before any callback sees it. They are then
 * rebased onto the active layer's own raster before they reach the processor, because the
 * processor is handed a buffer with no document origin in it. A layer at a non-zero document
 * origin would otherwise have its gradient shifted off the layer by that origin. Rebasing happens
 * here rather than in the processor because this is the only place that knows the layer's `pos`,
 * and it is deterministic: the rebased numbers are what the history entry retains, and replay
 * feeds them back to this processor over the same layer-local buffer
 * (`src/contexts/useHistory.ts:169`), so a replay reproduces the same fill.
 * `src/util/layer-space.ts` states the two spaces; the stroke tools
 * that were missing this rebase are `EraserToolArea`, `SmudgeToolArea`, `DodgeToolArea` and
 * `BurnToolArea`.
 *
 * ## One full-layer rasterization per pointer move
 *
 * `tempUpdateLayer` re-runs the processor over the whole layer, so the preview costs one
 * `getImageData`/`putImageData` round trip plus a per-pixel walk per move. That is deliberately
 * NOT coalesced behind a `requestAnimationFrame` here: a preview frame still pending when the
 * pointer comes up would fire after `updateLayerByTool` had already committed, re-writing
 * `previewLayersRef` with the pre-release args and leaving a stale raster for the NEXT
 * `commitDirtyTool` to promote. That failure is worse than the cost it hides, and the five
 * existing paint tools share the same per-move shape.
 */
export const GradientToolArea = ({ className }: gradientToolAreaProps) => {
  const [{ containerRef, activeLayerId, layers, totalSize }] = useStore();
  const { tempUpdateLayer, updateLayerByTool } = useLayers();
  const { getToolArgs } = useCurrentTool();

  const args = getToolArgs('gradient');
  const activeLayer = activeLayerId ? layers[activeLayerId] : null;
  const isEnabled = !!activeLayer && !activeLayer.isBedrock;

  /**
   * The processor's own raster is the LAYER's, addressed from `activeLayer.pos`, so a
   * document point becomes `point - activeLayer.pos` and a layer at the origin passes
   * through unchanged. `from` and `to` are the SAME drag as the gesture the hook reports —
   * the first and last of it — so they take the identical rebase; there is no `points`
   * field on `GradientToolArgs`, and these two points are the whole of the stroke geometry
   * the processor sees.
   */
  const buildArgs = (points: Point[]): GradientToolArgs | null => {
    if (!args || !activeLayer) return null;

    const first = points[0];
    if (!first) return null;
    const last = points[points.length - 1] ?? first;

    return {
      ...args,
      from: documentPointToLayerLocal(first, activeLayer.pos),
      to: documentPointToLayerLocal(last, activeLayer.pos),
    };
  };

  /**
   * A click with no drag produces a zero-length axis, which the processor treats as a no-op.
   * Committing it would still write a `TOOL_ACTION` history entry for a fill that changed
   * nothing, so an undo would appear to do nothing either. The drag is therefore refused at
   * both ends rather than only at the commit, which also keeps the preview from flashing a
   * no-op raster on every stray click.
   */
  const isZeroLength = (endpoints: GradientEndpoints): boolean =>
    endpoints.from.x === endpoints.to.x && endpoints.from.y === endpoints.to.y;

  const { onPointerDown, onPointerMove, onPointerUp, onPointerLeave } = usePaintStroke(
    { imageSize: totalSize, containerRef, enabled: isEnabled },
    {
      onMove: (points) => {
        if (!activeLayerId) return;

        const toolArgs = buildArgs(points);
        if (!toolArgs || isZeroLength(toolArgs)) return;

        tempUpdateLayer({ id: activeLayerId, toolArgs });
      },
      onCommit: (points) => {
        if (!activeLayerId) return;

        // `onCommit` gets a copy, so these args are the ones the history entry keeps.
        const toolArgs = buildArgs(points);
        if (!toolArgs || isZeroLength(toolArgs)) return;

        void updateLayerByTool({ id: activeLayerId, toolArgs });
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
      style={{ userSelect: 'none' }}
    />
  );
};
