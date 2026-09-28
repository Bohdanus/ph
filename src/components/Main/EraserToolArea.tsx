import { type PointerEvent, useRef } from 'react';
import { type EraserToolArgs } from '../../tools/eraser.ts';
import { usePointerPosition } from '../../hooks/usePointerPosition.ts';
import { useStore } from '../../contexts/StoreContext.tsx';
import { useLayers } from '../../contexts/useLayer.ts';
import { useCurrentTool } from '../../contexts/useCurrentTool.tsx';
import type { Point } from '../../contexts/general-types.ts';
import { canvasToDocumentPoint, documentFrameFromSize } from '../../contexts/document-frame.ts';

type EraserToolAreaProps = {
  className?: string;
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
 * The preview goes through `tempUpdateLayer`, the sanctioned live-pixel writer, and NOT through
 * the shared overlay canvas. The overlay starts every frame empty and transparent, and
 * `destination-out` computes `da' = da * (1 - sa)`; with `da = 0` that is `0` for every pixel, so
 * an overlay preview is arithmetically incapable of drawing anything and the stroke only appeared
 * on pointer-up. Previewing by mutating the layer makes the preview and the commit the same
 * operation, which is why they cannot drift.
 */
export const EraserToolArea = ({ className }: EraserToolAreaProps) => {
  const [{ containerRef, layers, activeLayerId, totalSize, documentFrame: currentFrame }] = useStore();
  const documentFrame = currentFrame ?? documentFrameFromSize(totalSize);
  const { updateLayerByTool, tempUpdateLayer } = useLayers();
  const { toolArgs } = useCurrentTool();

  const args = toolArgs as EraserToolArgs;
  const pointsRef = useRef<Point[]>([]);
  const activeLayer = activeLayerId ? layers[activeLayerId] : undefined;

  /**
   * A raster edit to the BEDROCK layer is wrong, not merely surprising: bedrock is the document's
   * own backing image — the floor every other layer composites over — and the Eraser is the one
   * tool whose whole job is to punch holes. Erasing it changes the colour of the transparent
   * regions the rest of the stack is judged against, and there is no layer left to restore it
   * from. `MoveToolArea.tsx:35` reads the same flag for the same reason.
   */
  const isEnabled = Boolean(activeLayerId && activeLayer && !activeLayer.isBedrock);

  const { isPointerDownValid, isPointerMoveValid, isPointerUpValid, getLocalCoords, isMouseDown } = usePointerPosition({
    ref: containerRef,
    imageSize: totalSize,
  });

  /**
   * The processor addresses the LAYER's own raster, whose pixel (0, 0) is `activeLayer.pos`, so a
   * document point becomes `point - activeLayer.pos` and a layer at the origin passes through
   * unchanged. The same translation is applied to the preview and to the commit: a preview in
   * canvas space and a commit in layer space would show the stroke at one place and put it
   * somewhere else.
   */
  const toLayerPoints = (points: Point[]) =>
    points.map((point) => {
      const document = canvasToDocumentPoint(point, documentFrame);
      return { x: document.x - activeLayer!.pos.x, y: document.y - activeLayer!.pos.y };
    });

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (args.toolName !== 'eraser') return;
    if (!isEnabled) return;
    if (!isPointerDownValid(event)) return;

    pointsRef.current = [getLocalCoords(event)];

    tempUpdateLayer({
      id: activeLayerId!,
      toolArgs: { ...args, points: toLayerPoints(pointsRef.current) },
    });
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!isMouseDown.current || !isPointerMoveValid(event)) return;
    if (!isEnabled) return;

    pointsRef.current.push(getLocalCoords(event));

    // The accumulated path is resent every move rather than only the new point, because
    // `commit: 'raster'` REPLACES the whole layer with the canvas the processor returns. Sending
    // one point would erase one point.
    tempUpdateLayer({
      id: activeLayerId!,
      toolArgs: { ...args, points: toLayerPoints(pointsRef.current) },
    });
  };

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (args.toolName !== 'eraser') return;
    if (!isPointerUpValid(event)) return;

    const coords = getLocalCoords(event);
    const lastPoint = pointsRef.current[pointsRef.current.length - 1];
    if (!lastPoint || lastPoint.x !== coords.x || lastPoint.y !== coords.y) {
      pointsRef.current.push(coords);
    }

    // `updateLayerByTool` takes no `pos`: `commit: 'raster'` REPLACES the layer's pixels with the
    // canvas the processor returns, which is the whole layer. Cropping the stroke to its bounding
    // box the way `DrawToolArea` does would therefore shrink the layer out from under the erase.
    if (pointsRef.current.length > 0 && activeLayer && !activeLayer.isBedrock) {
      // `id` is deliberately left to the hook's `= activeLayerId` default: the layer whose `pos`
      // the conversion above used is the one that must receive the edit.
      updateLayerByTool({ toolArgs: { ...args, points: toLayerPoints(pointsRef.current) } });
    }

    pointsRef.current = [];
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
