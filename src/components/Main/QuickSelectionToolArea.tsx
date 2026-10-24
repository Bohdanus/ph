import { type PointerEvent, type RefObject, useCallback, useEffect, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useCurrentTool } from '../../contexts/useCurrentTool.tsx';
import { useStore } from '../../contexts/StoreContext.tsx';
import { useSelectionHistory } from '../../contexts/useSelectionHistory.ts';
import { usePointerPosition } from '../../hooks/usePointerPosition.ts';
import type { Point, Size } from '../../contexts/general-types.ts';
import {
  createCommittedRasterSelection,
  createCommittedPolygonSelectionFromContours,
  getActiveSelection,
} from '../../util/selection.ts';
import { canvasToDocumentPoint, documentFrameFromSize, type DocumentFrame } from '../../contexts/document-frame.ts';
import { resetOverlayAlpha } from '../../util/canvas.ts';
import { readCanvasImageDataAtLogicalSize } from '../../util/canvas-image-data.ts';
import { createSelectionRasterOutlineCanvas, type SelectionRasterOutline } from '../../hooks/useSelectionAnts.ts';
import {
  QUICK_SELECTION_SOURCE_TOOL,
  appendQuickSelectionStrokeSeeds,
  createQuickSelectionAccumulator,
  createQuickSelectionPolygon,
  createQuickSelectionStrokeSeedSampler,
  growAlongStroke,
  rasterizeSelectionState,
  type QuickSelectionAccumulator,
  type QuickSelectionStrokeSeedSampler,
  type QuickSelectionToolArgs,
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
/**
 * The grown region's outline, drawn as a closed path.
 *
 * The transient picture of a stroke in progress: the committed border is the ants canvas's
 * job — `quick-selection` is in `Main.tsx`'s `SELECTION_INTERACTION_MODES`, so
 * `useSelectionMarchingAnts` owns it on a canvas of its own (`useSelectionAnts.ts:51`-`:58`)
 * — and nothing painted here survives release. Hand-rolled rather than a call into
 * `util/selection.ts`'s outline painters because those put a white anchor dot on every
 * vertex, and a traced mask boundary is a staircase with a vertex per step.
 */
function drawRegionPreview(ctx: CanvasRenderingContext2D, contours: Point[][]): void {
  if (!contours.some((points) => points.length >= 2)) return;

  ctx.save();
  ctx.beginPath();
  for (const points of contours) {
    if (points.length < 2) continue;
    ctx.moveTo(points[0].x, points[0].y);
    for (let index = 1; index < points.length; index++) {
      ctx.lineTo(points[index].x, points[index].y);
    }
    ctx.closePath();
  }
  ctx.strokeStyle = 'rgba(0,123,255,0.95)';
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

function drawRasterRegionPreview(
  ctx: CanvasRenderingContext2D,
  preview: { outline: SelectionRasterOutline; x: number; y: number }
): void {
  ctx.save();
  ctx.drawImage(preview.outline.canvas, preview.x, preview.y, preview.outline.width, preview.outline.height);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = 'rgba(0,123,255,0.95)';
  ctx.fillRect(preview.x, preview.y, preview.outline.width, preview.outline.height);
  ctx.restore();
}

export const QuickSelectionToolArea = ({ className, overlayCtxRef }: QuickSelectionToolAreaProps) => {
  const [
    {
      canvasRef,
      containerRef,
      selections,
      totalSize,
      documentFrame: currentFrame,
      activeSelectionId,
      documentId,
      documentRevision,
      historyIndex,
      branchRevision,
    },
    dispatch,
  ] = useStore();
  const documentFrame = currentFrame ?? documentFrameFromSize(totalSize);
  const { getToolArgs } = useCurrentTool();
  const { clearSelections, commitSelection } = useSelectionHistory();
  const args = getToolArgs('quick-selection');

  const { getLocalCoords, isPointerDownValid, isPointerMoveValid, isPointerUpValid, releasePointer } =
    usePointerPosition({
      ref: containerRef,
      imageSize: totalSize,
    });

  const pointerIdRef = useRef<number | null>(null);
  const strokeDocumentContextRef = useRef<{
    documentId: string;
    documentRevision: number;
    historyIndex: number;
    branchRevision: number;
    totalSize: Size;
    imageSize: Size;
    documentFrame: DocumentFrame;
  } | null>(null);
  const seedSamplerRef = useRef<QuickSelectionStrokeSeedSampler | null>(null);
  const imageDataRef = useRef<ImageData | null>(null);
  const accumulatorRef = useRef<QuickSelectionAccumulator | null>(null);
  const baseSelectionIdRef = useRef<string | null>(null);
  const strokeModeRef = useRef<QuickSelectionToolArgs['mode'] | null>(null);
  const strokeToleranceRef = useRef<number>(args?.tolerance ?? 0);
  const selectionChangedRef = useRef(false);
  const previewPointsRef = useRef<Point[][] | null>(null);
  const previewRasterRef = useRef<{ outline: SelectionRasterOutline; x: number; y: number } | null>(null);

  /**
   * Repaint the whole overlay: the live preview, and nothing else.
   *
   * The committed border is not painted here. `quick-selection` is in `Main.tsx`'s
   * `SELECTION_INTERACTION_MODES`, so `useSelectionMarchingAnts` owns that border on a canvas
   * of its own, and the static stroke this used to draw put two outlines of one selection on
   * screen in two colours on two canvases. It has no move arm, so unlike the elliptical marquee
   * it publishes nothing to the ants and has no drag representation on this overlay.
   *
   * The single dependency is why the effect at the bottom of this component is now
   * mount-only: nothing read here moves when the store does, so a store change has nothing to
   * repaint. That is sound because every stroke's exit route calls this explicitly, and the
   * committed geometry follows the store on the ants loop instead.
   */
  const redrawOverlay = useCallback(
    ({
      previewPoints,
      previewRaster,
    }: {
      previewPoints?: Point[][] | null;
      previewRaster?: { outline: SelectionRasterOutline; x: number; y: number } | null;
    } = {}) => {
      const ctx = overlayCtxRef.current;
      if (!ctx) return;

      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      resetOverlayAlpha(ctx);
      if (previewRaster) drawRasterRegionPreview(ctx, previewRaster);
      else if (previewPoints && previewPoints.length > 0) drawRegionPreview(ctx, previewPoints);
    },
    [overlayCtxRef]
  );

  /**
   * Re-seed along the stroke and repaint what grew.
   *
   * The trace is the expensive half of this, and it only runs when the accumulated mask
   * changes. Overlapping fills may still run because a different seed colour can extend a
   * selection across a gradient, but they do not retrace or repaint an unchanged outline.
   */
  function growStroke(point: Point, includeEndpoint = false): boolean {
    const accumulator = accumulatorRef.current;
    const imageData = imageDataRef.current;
    const seedSampler = seedSamplerRef.current;
    if (!accumulator || !imageData || !seedSampler) return false;

    const seeds = appendQuickSelectionStrokeSeeds(seedSampler, point, includeEndpoint);
    if (seeds.length === 0) return false;
    const grownRegions = growAlongStroke(accumulator, imageData, seeds, {
      tolerance: strokeToleranceRef.current,
      mode: strokeModeRef.current ?? 'add',
    });
    if (grownRegions === 0) return false;
    selectionChangedRef.current = true;

    const polygon = createQuickSelectionPolygon(accumulator.mask, accumulator.width, accumulator.height);
    if (polygon?.rasterMask) {
      const outline = createSelectionRasterOutlineCanvas(polygon.rasterMask);
      previewRasterRef.current = outline ? { outline, x: polygon.bounds.x - 1, y: polygon.bounds.y - 1 } : null;
      previewPointsRef.current = null;
    } else {
      previewRasterRef.current = null;
      previewPointsRef.current = polygon ? polygon.points : null;
    }
    redrawOverlay({ previewPoints: previewPointsRef.current, previewRaster: previewRasterRef.current });
    return true;
  }

  function resetGesture() {
    pointerIdRef.current = null;
    strokeDocumentContextRef.current = null;
    seedSamplerRef.current = null;
    imageDataRef.current = null;
    accumulatorRef.current = null;
    baseSelectionIdRef.current = null;
    strokeModeRef.current = null;
    selectionChangedRef.current = false;
    previewPointsRef.current = null;
    previewRasterRef.current = null;
  }

  function isStrokeDocumentContextCurrent(): boolean {
    const context = strokeDocumentContextRef.current;
    return (
      context !== null &&
      context.documentId === documentId &&
      context.documentRevision === documentRevision &&
      context.historyIndex === historyIndex &&
      context.branchRevision === branchRevision &&
      context.totalSize.width === totalSize.width &&
      context.totalSize.height === totalSize.height &&
      context.imageSize.width === totalSize.width &&
      context.imageSize.height === totalSize.height &&
      context.documentFrame.x === documentFrame.x &&
      context.documentFrame.y === documentFrame.y &&
      context.documentFrame.width === documentFrame.width &&
      context.documentFrame.height === documentFrame.height
    );
  }

  function cancelCurrentStroke() {
    const hadGesture = pointerIdRef.current !== null;
    resetGesture();
    releasePointer();
    redrawOverlay();
    if (hadGesture) dispatch({ type: 'CANCEL_SELECTION_DRAFT' });
  }

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !args) return;
    if (!isPointerDownValid(event)) return;

    event.preventDefault();

    let draftStarted = false;
    try {
      const imageData = readCanvasImageDataAtLogicalSize(canvasRef.current, totalSize);
      if (!imageData) {
        // The hook captured the pointer before the readback. No component pointer id has
        // been installed yet, so pointer-up cannot reach its normal release path.
        releasePointer();
        return;
      }

      const size = { width: imageData.width, height: imageData.height };
      strokeDocumentContextRef.current = {
        documentId,
        documentRevision,
        historyIndex,
        branchRevision,
        totalSize: { ...totalSize },
        imageSize: size,
        documentFrame: { ...documentFrame },
      };
      // The active selection is the stroke's starting mask, which is what makes `add` extend
      // it and `subtract` shrink it. With nothing active the base is empty, and an empty
      // base makes a `subtract` stroke select nothing — the same no-op Photoshop gives a
      // subtract brush with no selection to subtract from.
      const activeSelection = getActiveSelection(selections, activeSelectionId);
      // Stored points are document-space; the rasterizer and stroke seeds use frame-local coordinates.
      const baseMask = activeSelection
        ? rasterizeSelectionState(activeSelection, size, { x: documentFrame.x, y: documentFrame.y })
        : null;
      const accumulator = createQuickSelectionAccumulator(size, baseMask);
      const seedSampler = createQuickSelectionStrokeSeedSampler(args.size);
      const point = getLocalCoords(event);

      pointerIdRef.current = typeof event.pointerId === 'number' ? event.pointerId : null;
      imageDataRef.current = imageData;
      accumulatorRef.current = accumulator;
      baseSelectionIdRef.current = activeSelection?.id ?? null;
      strokeModeRef.current = args.mode;
      strokeToleranceRef.current = args.tolerance;
      seedSamplerRef.current = seedSampler;
      selectionChangedRef.current = false;
      previewPointsRef.current = null;
      previewRasterRef.current = null;

      dispatch({ type: 'START_SELECTION_DRAFT', payload: { sourceTool: QUICK_SELECTION_SOURCE_TOOL } });
      draftStarted = true;

      // A click is a complete stroke here, so the press point's own dab is grown before
      // the pointer has moved at all.
      growStroke(point);
    } catch (error) {
      // Setup or the initial preview can fail after the hook has captured the pointer. Give
      // it back even when the component never reaches its pointer-up handler.
      resetGesture();
      releasePointer();
      if (draftStarted) dispatch({ type: 'CANCEL_SELECTION_DRAFT' });
      redrawOverlay();
      console.error('Unable to start Quick Selection stroke', error);
    }
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (pointerIdRef.current === null) return;
    if (pointerIdRef.current !== (typeof event.pointerId === 'number' ? event.pointerId : null)) return;
    if (!isPointerMoveValid(event)) return;
    if (!isStrokeDocumentContextCurrent()) {
      cancelCurrentStroke();
      return;
    }

    growStroke(getLocalCoords(event));
  };

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (pointerIdRef.current === null) return;
    if (pointerIdRef.current !== (typeof event.pointerId === 'number' ? event.pointerId : null)) return;
    if (!isPointerUpValid(event)) return;
    if (!isStrokeDocumentContextCurrent()) {
      cancelCurrentStroke();
      return;
    }

    // The release position can carry a seed the last move did not, so the stroke is grown
    // once more before it is read for the commit. Nothing is written by that call.
    growStroke(getLocalCoords(event), true);

    const accumulator = accumulatorRef.current;
    const selectionChanged = selectionChangedRef.current;
    const polygon =
      accumulator && selectionChanged
        ? createQuickSelectionPolygon(accumulator.mask, accumulator.width, accumulator.height)
        : null;
    const hasSelectedPixels = accumulator?.mask.some((pixel) => pixel === 1) ?? false;
    const shouldClearSubtractedSelection =
      selectionChanged &&
      !hasSelectedPixels &&
      strokeModeRef.current === 'subtract' &&
      baseSelectionIdRef.current !== null;
    resetGesture();

    const selection = polygon
      ? polygon.rasterMask
        ? createCommittedRasterSelection({
            id: uuidv4(),
            rasterMask: polygon.rasterMask,
            pos: {
              x: polygon.bounds.x + documentFrame.x,
              y: polygon.bounds.y + documentFrame.y,
              width: polygon.bounds.width,
              height: polygon.bounds.height,
            },
            sourceTool: QUICK_SELECTION_SOURCE_TOOL,
          })
        : createCommittedPolygonSelectionFromContours({
            id: uuidv4(),
            points: polygon.points.map((contour) =>
              contour.map((point) => canvasToDocumentPoint(point, documentFrame))
            ),
            sourceTool: QUICK_SELECTION_SOURCE_TOOL,
          })
      : null;

    if (!selection || !selectionChanged) {
      if (shouldClearSubtractedSelection) clearSelections();
      else dispatch({ type: 'CANCEL_SELECTION_DRAFT' });
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

    cancelCurrentStroke();
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
