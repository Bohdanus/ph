import { type PointerEvent, type RefObject, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useCurrentTool } from '../../contexts/useCurrentTool.tsx';
import { useStore } from '../../contexts/StoreContext.tsx';
import { useSelectionHistory } from '../../contexts/useSelectionHistory.ts';
import type { Point, Selection } from '../../contexts/general-types.ts';
import { usePointerPosition } from '../../hooks/usePointerPosition.ts';
import { useContainScale } from '../../hooks/useContainScale.ts';
import type { MagicWandToolArgs } from '../../tools/magicWand.ts';
import { createMagicWandSelectionFromCanvas } from '../../util/magicWand.ts';
import {
  createCommittedPolygonSelectionFromContours,
  createCommittedRasterSelection,
  drawSelectionAnchors,
} from '../../util/selection.ts';
import { canvasToDocumentPoint, documentFrameFromSize } from '../../contexts/document-frame.ts';

type MagicWandToolAreaProps = {
  className?: string;
  overlayCtxRef: RefObject<CanvasRenderingContext2D | null>;
};

export const MagicWandToolArea = ({ className, overlayCtxRef }: MagicWandToolAreaProps) => {
  const [{ canvasRef, containerRef, selections, totalSize, documentFrame: currentFrame, renderSelector }, dispatch] =
    useStore();
  const documentFrame = currentFrame ?? documentFrameFromSize(totalSize);
  const { toolArgs } = useCurrentTool();
  const args = toolArgs as MagicWandToolArgs;
  const { commitSelection } = useSelectionHistory();

  const { getLocalCoords } = usePointerPosition({
    ref: containerRef,
    imageSize: totalSize,
  });
  const containScale = useContainScale(containerRef, totalSize);

  // The tool overlay carries no border of its own: a committed polygon's marching
  // ants are painted on their own canvas, so this only has to keep the anchors of
  // any interactive selection — a lasso committed before the wand was picked — up to
  // date. A wand selection itself has no anchors, so committing one is a clear.
  function redrawOverlay() {
    const ctx = overlayCtxRef.current;
    if (!ctx) return;

    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    selections.forEach((selection) => drawSelectionAnchors(ctx, selection, documentFrame, containScale.current));
  }

  function isPointInsideImage(point: Point): boolean {
    return point.x >= 0 && point.y >= 0 && point.x < totalSize.width && point.y < totalSize.height;
  }

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || args.toolName !== 'magic-wand') return;
    if (renderSelector.source === 'pending') return;

    event.preventDefault();

    const seed = getLocalCoords(event);
    if (!isPointInsideImage(seed)) return;

    dispatch({ type: 'START_SELECTION_DRAFT', payload: { sourceTool: 'magic-wand' } });

    let selection: Selection | null;
    try {
      const result = createMagicWandSelectionFromCanvas(canvasRef.current, seed, totalSize, {
        smoothing: args.smoothing,
        tolerance: args.tolerance,
        contiguous: args.contiguous,
      });

      if (!result) {
        dispatch({ type: 'CANCEL_SELECTION_DRAFT' });
        redrawOverlay();
        return;
      }

      const metadata = {
        magicWand: {
          boundaryEdgeCount: result.boundaryEdgeCount,
          sampleColor: result.sampleColor,
          seed: { x: Math.floor(seed.x + documentFrame.x), y: Math.floor(seed.y + documentFrame.y) },
          selectedPixelCount: result.selectedPixelCount,
          smoothing: args.smoothing,
          tolerance: args.tolerance,
        },
      };
      selection = result.rasterMask
        ? createCommittedRasterSelection({
            id: uuidv4(),
            metadata,
            rasterMask: result.rasterMask,
            pos: {
              x: result.bounds.x + documentFrame.x,
              y: result.bounds.y + documentFrame.y,
              width: result.bounds.width,
              height: result.bounds.height,
            },
            sourceTool: 'magic-wand',
          })
        : createCommittedPolygonSelectionFromContours({
            id: uuidv4(),
            metadata,
            points: result.points.map((contour) => contour.map((point) => canvasToDocumentPoint(point, documentFrame))),
            sourceTool: 'magic-wand',
          });
    } catch (error) {
      dispatch({ type: 'CANCEL_SELECTION_DRAFT' });
      redrawOverlay();
      console.error('Unable to create Magic Wand selection', error);
      return;
    }

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
    try {
      commitSelection(selection, 'create');
    } catch (error) {
      dispatch({ type: 'CANCEL_SELECTION_DRAFT' });
      redrawOverlay();
      console.error('Unable to commit Magic Wand selection', error);
      return;
    }
    redrawOverlay();
  };

  useEffect(() => {
    const ctx = overlayCtxRef.current;
    if (!ctx) return;

    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    selections.forEach((selection) => drawSelectionAnchors(ctx, selection, documentFrame, containScale.current));
  }, [documentFrame, overlayCtxRef, selections, containScale]);

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
