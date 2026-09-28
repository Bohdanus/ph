import { type PointerEvent, type RefObject, useRef } from 'react';
import { buildEraseArgs, type EraserToolArgs } from '../../tools/eraser.ts';
import { setupDrawCtx } from '../../tools/draw.ts';
import { usePointerPosition } from '../../hooks/usePointerPosition.ts';
import { useStore } from '../../contexts/StoreContext.tsx';
import { useLayers } from '../../contexts/useLayer.ts';
import { useCurrentTool } from '../../contexts/useCurrentTool.tsx';
import { drawLine } from '../../util/draw.ts';
import type { Point } from '../../contexts/general-types.ts';
import { canvasToDocumentPoint, documentFrameFromSize } from '../../contexts/document-frame.ts';

type EraserToolAreaProps = {
  className?: string;
  overlayCtxRef: RefObject<CanvasRenderingContext2D | null>;
};

/**
 * The Eraser edits the ACTIVE layer; it never creates one.
 *
 * `DrawToolArea` commits through `createLayerFromTool`, which is right for a painting tool: a new
 * layer is the paint. It is wrong for the eraser, which subtracts alpha from the layer that is
 * already there. A "new layer holding a transparent hole" composites as nothing, so the tool would
 * be selectable, draggable, and visibly dead. `updateLayerByTool` is the ACTIVE-LAYER path, and it
 * is the one that produces exactly one `TOOL_ACTION` per call — which is what makes one history
 * state per stroke (per mouse-up) possible, rather than one per pointer move.
 *
 * The preview and the commit are kept from drifting by both going through `buildEraseArgs`, the
 * single place that turns `EraserToolArgs` into the shared painter's `DrawToolArgs`:
 * `setupDrawCtx` reads `composite` off it, and `drawLine` reads `blockStamp` off it
 * (`src/util/draw.ts:136`). Passing the raw `EraserToolArgs` to either would silently drop a flag —
 * `composite` would read as absent and the preview would paint instead of erasing.
 */
export const EraserToolArea = ({ className, overlayCtxRef }: EraserToolAreaProps) => {
  const [{ containerRef, layers, activeLayerId, totalSize, documentFrame: currentFrame }] = useStore();
  const documentFrame = currentFrame ?? documentFrameFromSize(totalSize);
  const { updateLayerByTool } = useLayers();
  const { toolArgs } = useCurrentTool();

  const args = toolArgs as EraserToolArgs;
  const pointsRef = useRef<Point[]>([]);

  const { isPointerDownValid, isPointerMoveValid, isPointerUpValid, getLocalCoords, isMouseDown } = usePointerPosition({
    ref: containerRef,
    imageSize: totalSize,
  });

  // Repaints synchronously on every pointer move, exactly as `DrawToolArea` does: the overlay is a
  // clearRect plus one stroke of the accumulated points, so frame batching buys nothing here.
  const flushDrawingFrame = () => {
    const ctx = overlayCtxRef.current;
    if (!ctx) return;

    ctx.clearRect(0, 0, totalSize.width, totalSize.height);

    // Overlay coordinates are canvas/image coordinates; the commit below converts to the active
    // layer's local space. Repainting the whole accumulated path is what makes `destination-out`
    // readable at all: erasing from the live overlay rather than accumulating into it is the only
    // way a repeated stamp of the same path does not punch through twice.
    drawLine({
      args: buildEraseArgs({ ...args, points: pointsRef.current }),
      ctx,
    });
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (args.toolName !== 'eraser') return;
    if (!isPointerDownValid(event)) return;

    const ctx = overlayCtxRef.current;
    if (!ctx) return;

    const coords = getLocalCoords(event);
    pointsRef.current = [coords];

    // Both eraser flags reach the overlay here, and only here. `setupDrawCtx` is shared with the
    // committed raster, so the preview subtracts alpha exactly as the commit will.
    setupDrawCtx(ctx, buildEraseArgs({ ...args, points: [coords] }));

    flushDrawingFrame();
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!isMouseDown.current || !isPointerMoveValid(event)) return;

    pointsRef.current.push(getLocalCoords(event));

    flushDrawingFrame();
  };

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (args.toolName !== 'eraser') return;
    if (!isPointerUpValid(event)) return;

    const coords = getLocalCoords(event);
    const lastPoint = pointsRef.current[pointsRef.current.length - 1];
    if (!lastPoint || lastPoint.x !== coords.x || lastPoint.y !== coords.y) {
      pointsRef.current.push(coords);
    }

    const layer = activeLayerId ? layers[activeLayerId] : undefined;

    // `updateLayerByTool` takes no `pos`: `commit: 'raster'` REPLACES the layer's pixels with the
    // canvas the processor returns, which is the whole layer. Cropping the stroke to its bounding
    // box the way `DrawToolArea` does would therefore shrink the layer out from under the erase,
    // so the points are the layer's own local coordinates and nothing is cropped.
    if (layer) {
      const documentPoints = pointsRef.current.map((point) => canvasToDocumentPoint(point, documentFrame));
      const layerPoints = documentPoints.map((point) => ({ x: point.x - layer.pos.x, y: point.y - layer.pos.y }));

      // `id` is deliberately left to the hook's `= activeLayerId` default: the layer whose `pos`
      // the conversion above used is the one that must receive the edit.
      updateLayerByTool({ toolArgs: { ...args, points: layerPoints } });
    }

    pointsRef.current = [];
    overlayCtxRef.current?.clearRect(0, 0, totalSize.width, totalSize.height);
  };

  return (
    <div
      className={`${className} cursor-draw`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    />
  );
};
