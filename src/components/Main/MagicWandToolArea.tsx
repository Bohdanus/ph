import { type PointerEvent, type RefObject, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useCurrentTool } from '../../contexts/useCurrentTool.tsx';
import { useStore } from '../../contexts/StoreContext.tsx';
import { useSelectionHistory } from '../../contexts/useSelectionHistory.ts';
import type { Point, Selection } from '../../contexts/general-types.ts';
import { usePointerPosition } from '../../hooks/usePointerPosition.ts';
import type { MagicWandToolArgs } from '../../tools/magicWand.ts';
import { createMagicWandSelectionFromCanvas } from '../../util/magicWand.ts';
import { createCommittedPolygonSelection, drawSelectionOutline } from '../../util/selection.ts';
import { canvasToDocumentPoint, documentFrameFromSize } from '../../contexts/document-frame.ts';

type MagicWandToolAreaProps = {
  className?: string;
  overlayCtxRef: RefObject<CanvasRenderingContext2D | null>;
};

export const MagicWandToolArea = ({ className, overlayCtxRef }: MagicWandToolAreaProps) => {
  const [{ canvasRef, containerRef, selections, totalSize, documentFrame: currentFrame }, dispatch] = useStore();
  const documentFrame = currentFrame ?? documentFrameFromSize(totalSize);
  const { toolArgs } = useCurrentTool();
  const args = toolArgs as MagicWandToolArgs;
  const { commitSelection } = useSelectionHistory();

  const { getLocalCoords } = usePointerPosition({
    ref: containerRef,
    imageSize: totalSize,
  });

  function redrawOverlay(extraSelection?: Selection) {
    const ctx = overlayCtxRef.current;
    if (!ctx) return;

    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    selections.forEach((selection) => drawSelectionOutline(ctx, selection, documentFrame));
    if (extraSelection) {
      drawSelectionOutline(ctx, extraSelection, documentFrame);
    }
  }

  function isPointInsideImage(point: Point): boolean {
    return point.x >= 0 && point.y >= 0 && point.x < totalSize.width && point.y < totalSize.height;
  }

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || args.toolName !== 'magic-wand') return;

    event.preventDefault();

    const seed = getLocalCoords(event);
    if (!isPointInsideImage(seed)) return;

    dispatch({ type: 'START_SELECTION_DRAFT', payload: { sourceTool: 'magic-wand' } });

    const result = createMagicWandSelectionFromCanvas(canvasRef.current, seed, {
      smoothing: args.smoothing,
      tolerance: args.tolerance,
      contiguous: args.contiguous,
    });

    if (!result) {
      dispatch({ type: 'CANCEL_SELECTION_DRAFT' });
      redrawOverlay();
      return;
    }

    const selection = createCommittedPolygonSelection({
      id: uuidv4(),
      metadata: {
        magicWand: {
          boundaryPointCount: result.points.length,
          sampleColor: result.sampleColor,
          seed: { x: Math.floor(seed.x + documentFrame.x), y: Math.floor(seed.y + documentFrame.y) },
          selectedPixelCount: result.selectedPixelCount,
          smoothing: args.smoothing,
          tolerance: args.tolerance,
        },
      },
      points: result.points.map((point) => canvasToDocumentPoint(point, documentFrame)),
      sourceTool: 'magic-wand',
    });

    if (!selection) {
      dispatch({ type: 'CANCEL_SELECTION_DRAFT' });
      redrawOverlay();
      return;
    }

    // The gesture is a single click, so this is both its only pointer handler
    // and its end-of-gesture commit point: there is no drag phase to keep
    // transient, and `START_SELECTION_DRAFT` above is the only earlier dispatch.
    // Routed through the single-writer hook so the drawn selection becomes one
    // undoable document edit instead of living only on a later clear entry.
    commitSelection(selection, 'create');
    redrawOverlay(selection);
  };

  useEffect(() => {
    const ctx = overlayCtxRef.current;
    if (!ctx) return;

    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    selections.forEach((selection) => drawSelectionOutline(ctx, selection, documentFrame));
  }, [documentFrame, overlayCtxRef, selections]);

  useEffect(() => {
    const ctx = overlayCtxRef.current;

    return () => {
      if (ctx) {
        ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      }
    };
  }, [overlayCtxRef]);

  return (
    <div className={`${className} cursor-crosshair`} onPointerDown={handlePointerDown} style={{ userSelect: 'none' }} />
  );
};
