import { type PointerEvent, type RefObject, useCallback, useEffect, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useCurrentTool } from '../../contexts/useCurrentTool.tsx';
import { useStore } from '../../contexts/StoreContext.tsx';
import { useSelectionHistory } from '../../contexts/useSelectionHistory.ts';
import { usePointerPosition } from '../../hooks/usePointerPosition.ts';
import type { Point } from '../../contexts/general-types.ts';
import {
  createCommittedPolygonSelection,
  drawSelectionOutline,
  getActiveSelection,
  getSelectionAbsolutePoints,
} from '../../util/selection.ts';
import { canvasToDocumentPoint, documentFrameFromSize } from '../../contexts/document-frame.ts';
import { resetOverlayAlpha } from '../../util/canvas.ts';
import {
  QUICK_SELECTION_SOURCE_TOOL,
  createQuickSelectionAccumulator,
  createQuickSelectionPolygon,
  growAlongStroke,
  rasterizeSelectionMask,
  sampleStrokeSeeds,
  type QuickSelectionAccumulator,
} from '../../tools/quickSelection.ts';

type QuickSelectionToolAreaProps = {
  className?: string;
  canvasCtxRef?: RefObject<CanvasRenderingContext2D | null>;
  overlayCtxRef: RefObject<CanvasRenderingContext2D | null>;
};

/**
 * The document's pixels, read once per gesture.
 *
 * A `null` here is a real state and not a failure to report: a canvas with no 2D context,
 * a zero-sized one, and a canvas tainted by a cross-origin draw all refuse to hand back
 * pixels, and the right answer for a selection tool in all three is a stroke that selects
 * nothing rather than a throw mid-gesture.
 */
function readDocumentImageData(canvas: HTMLCanvasElement | null): ImageData | null {
  if (!canvas || canvas.width <= 0 || canvas.height <= 0) return null;

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;

  try {
    return ctx.getImageData(0, 0, canvas.width, canvas.height);
  } catch {
    return null;
  }
}

/**
 * The grown region's outline, drawn as a closed path.
 *
 * Same choice as the elliptical marquee and for the same reason: `drawSelectionOutline`
 * puts a white anchor dot on every vertex of a polygon selection, and a traced mask
 * boundary is a staircase with a vertex per step.
 */
function drawRegionPreview(ctx: CanvasRenderingContext2D, points: Point[]): void {
  if (points.length < 2) return;

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let index = 1; index < points.length; index++) {
    ctx.lineTo(points[index].x, points[index].y);
  }
  ctx.closePath();
  ctx.strokeStyle = 'rgba(0,123,255,0.95)';
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

export const QuickSelectionToolArea = ({ className, overlayCtxRef }: QuickSelectionToolAreaProps) => {
  const [{ canvasRef, containerRef, selections, totalSize, documentFrame: currentFrame, activeSelectionId }, dispatch] =
    useStore();
  const documentFrame = currentFrame ?? documentFrameFromSize(totalSize);
  const { getToolArgs } = useCurrentTool();
  const { commitSelection } = useSelectionHistory();
  const args = getToolArgs('quick-selection');

  const { getLocalCoords, isPointerDownValid, isPointerMoveValid, isPointerUpValid } = usePointerPosition({
    ref: containerRef,
    imageSize: totalSize,
  });

  const pointerIdRef = useRef<number | null>(null);
  const strokeRef = useRef<Point[]>([]);
  const imageDataRef = useRef<ImageData | null>(null);
  const accumulatorRef = useRef<QuickSelectionAccumulator | null>(null);
  const previewPointsRef = useRef<Point[] | null>(null);

  const redrawOverlay = useCallback(
    ({ previewPoints }: { previewPoints?: Point[] | null } = {}) => {
      const ctx = overlayCtxRef.current;
      if (!ctx) return;

      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      resetOverlayAlpha(ctx);
      selections.forEach((selection) => drawSelectionOutline(ctx, selection, documentFrame));
      if (previewPoints && previewPoints.length > 0) drawRegionPreview(ctx, previewPoints);
    },
    [documentFrame, overlayCtxRef, selections]
  );

  /**
   * Re-seed along the stroke and repaint what grew.
   *
   * The trace is the expensive half of this, and it only runs when a seed actually
   * contributed a region: a dab that lands on pixels the accumulator already holds is
   * skipped inside `growAlongStroke`, so the pointer moving over its own selection
   * repaints nothing.
   */
  function growStroke(): void {
    const accumulator = accumulatorRef.current;
    const imageData = imageDataRef.current;
    if (!accumulator || !imageData || !args) return;

    const seeds = sampleStrokeSeeds(strokeRef.current, args.size);
    const grownRegions = growAlongStroke(accumulator, imageData, seeds, {
      tolerance: args.tolerance,
      mode: args.mode,
    });
    if (grownRegions === 0) return;

    const polygon = createQuickSelectionPolygon(accumulator.mask, accumulator.width, accumulator.height);
    previewPointsRef.current = polygon ? polygon.points : null;
    redrawOverlay({ previewPoints: previewPointsRef.current });
  }

  function resetGesture() {
    pointerIdRef.current = null;
    strokeRef.current = [];
    imageDataRef.current = null;
    accumulatorRef.current = null;
    previewPointsRef.current = null;
  }

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !args) return;
    if (!isPointerDownValid(event)) return;

    event.preventDefault();

    const imageData = readDocumentImageData(canvasRef.current);
    if (!imageData) return;

    const size = { width: imageData.width, height: imageData.height };
    // The active selection is the stroke's starting mask, which is what makes `add` extend
    // it and `subtract` shrink it. With nothing active the base is empty, and an empty
    // base makes a `subtract` stroke select nothing — the same no-op Photoshop gives a
    // subtract brush with no selection to subtract from.
    const activeSelection = getActiveSelection(selections, activeSelectionId);
    const basePoints = activeSelection ? getSelectionAbsolutePoints(activeSelection) : [];
    const baseMask = basePoints.length >= 3 ? rasterizeSelectionMask(basePoints, size) : null;

    pointerIdRef.current = typeof event.pointerId === 'number' ? event.pointerId : null;
    strokeRef.current = [getLocalCoords(event)];
    imageDataRef.current = imageData;
    accumulatorRef.current = createQuickSelectionAccumulator(size, baseMask);
    previewPointsRef.current = null;

    dispatch({ type: 'START_SELECTION_DRAFT', payload: { sourceTool: QUICK_SELECTION_SOURCE_TOOL } });

    // A click is a complete stroke here, so the press point's own dab is grown before
    // the pointer has moved at all.
    growStroke();
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (pointerIdRef.current === null) return;
    if (pointerIdRef.current !== (typeof event.pointerId === 'number' ? event.pointerId : null)) return;
    if (!isPointerMoveValid(event)) return;

    strokeRef.current.push(getLocalCoords(event));
    growStroke();
  };

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (pointerIdRef.current === null) return;
    if (pointerIdRef.current !== (typeof event.pointerId === 'number' ? event.pointerId : null)) return;
    if (!isPointerUpValid(event)) return;

    // The release position can carry a seed the last move did not, so the stroke is grown
    // once more before it is read for the commit. Nothing is written by that call.
    growStroke();

    const accumulator = accumulatorRef.current;
    const polygon = accumulator
      ? createQuickSelectionPolygon(accumulator.mask, accumulator.width, accumulator.height)
      : null;
    resetGesture();

    // A hole is reported, never papered over: committing the outer contour alone would
    // cover the pixels the mask reports as unselected, so the stroke is dropped and the
    // reason is logged. A `Selection` is one point path; see
    // `createQuickSelectionPolygon`'s doc for the shape that would fix it.
    if (polygon?.hasHoles) {
      console.warn(
        `quick-selection: the grown region has an enclosed hole, which a single-polygon selection cannot ` +
          `represent, so nothing was committed (${polygon.pixelCount} pixels grown)`
      );
    }

    const selection =
      polygon && !polygon.hasHoles
        ? createCommittedPolygonSelection({
            id: uuidv4(),
            points: polygon.points.map((point) => canvasToDocumentPoint(point, documentFrame)),
            sourceTool: QUICK_SELECTION_SOURCE_TOOL,
          })
        : null;

    if (!selection) {
      dispatch({ type: 'CANCEL_SELECTION_DRAFT' });
      redrawOverlay();
      return;
    }

    // The single commit point for the stroke. Every pointer move in between grew pixels
    // into a local mask and repainted the overlay; the store saw nothing until here, so a
    // drag of any length is one undoable edit.
    commitSelection(selection, 'create');
    redrawOverlay();
  };

  const abortStroke = (event: PointerEvent<HTMLDivElement>) => {
    if (pointerIdRef.current === null) return;
    if (pointerIdRef.current !== (typeof event.pointerId === 'number' ? event.pointerId : null)) return;

    resetGesture();
    redrawOverlay();
    dispatch({ type: 'CANCEL_SELECTION_DRAFT' });
  };

  useEffect(() => {
    redrawOverlay();
  }, [redrawOverlay]);

  useEffect(() => {
    const ctx = overlayCtxRef.current;

    return () => {
      // An unmount mid-stroke is an abort like any other: the grown region never reached
      // the store, so dropping it here cannot lose a commit. The clear below tears the
      // overlay down, so there is nothing left to repaint.
      resetGesture();
      if (ctx) {
        ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      }
    };
  }, [overlayCtxRef]);

  return (
    <div
      className={`${className} cursor-crosshair`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={abortStroke}
      style={{ userSelect: 'none' }}
    />
  );
};
