import { type PointerEvent, type RefObject, useCallback, useEffect, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useCurrentTool } from '../../contexts/useCurrentTool.tsx';
import { useStore } from '../../contexts/StoreContext.tsx';
import { useSelectionHistory } from '../../contexts/useSelectionHistory.ts';
import { usePointerPosition } from '../../hooks/usePointerPosition.ts';
import { useContainScale } from '../../hooks/useContainScale.ts';
import type { Point, Selection } from '../../contexts/general-types.ts';
import {
  createCommittedPolygonSelection,
  drawSelectionOutline,
  getActiveSelection,
  getSelectionAbsolutePoints,
  hasSameSelectionGeometry,
  isPointInPolygon,
  moveSelectionByDelta,
} from '../../util/selection.ts';
import { canvasToDocumentPoint, documentFrameFromSize } from '../../contexts/document-frame.ts';
import { resetOverlayAlpha } from '../../util/canvas.ts';
import {
  ELLIPTICAL_SELECTION_SOURCE_TOOL,
  ellipsePointsFromDrag,
  type EllipticalMarqueeDrag,
} from '../../tools/ellipticalSelection.ts';

type EllipticalSelectionToolAreaProps = {
  className?: string;
  canvasCtxRef?: RefObject<CanvasRenderingContext2D | null>;
  overlayCtxRef: RefObject<CanvasRenderingContext2D | null>;
};

/**
 * A running gesture. Both arms carry the pointer id, because this surface takes no
 * capture of its own beyond what `usePointerPosition` sets and a second pointer's move
 * or release would otherwise steer a drag it did not start.
 */
type EllipseDrag =
  | {
      mode: 'create';
      pointerId: number | null;
      start: Point;
      end: Point;
      constrainToCircle: boolean;
      fromCentre: boolean;
      /** The last computed path, so the commit is the preview rather than a second guess. */
      previewPoints: Point[] | null;
    }
  | { mode: 'move'; pointerId: number | null; origin: Point; baseline: Selection; preview: Selection };

/**
 * The live marquee, drawn as a closed path.
 *
 * It is deliberately NOT `drawSelectionOutline`: that draws a white anchor dot on every
 * vertex, and a tessellated ellipse has between 16 and 720 of them depending on its
 * radius. The committed outline is the store's business; this is the transient picture
 * of the drag, and it is the same dashed closed path a committed marquee shows without
 * the handles.
 */
function drawMarqueePreview(ctx: CanvasRenderingContext2D, points: Point[]): void {
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

export const EllipticalSelectionToolArea = ({ className, overlayCtxRef }: EllipticalSelectionToolAreaProps) => {
  const [{ containerRef, selections, totalSize, documentFrame: currentFrame, activeSelectionId }, dispatch] =
    useStore();
  const documentFrame = currentFrame ?? documentFrameFromSize(totalSize);
  const { getToolArgs } = useCurrentTool();
  const { commitSelection } = useSelectionHistory();
  const args = getToolArgs('elliptical-selection');

  const dragRef = useRef<EllipseDrag | null>(null);
  const { getLocalCoords, isPointerDownValid, isPointerMoveValid, isPointerUpValid } = usePointerPosition({
    ref: containerRef,
    imageSize: totalSize,
  });
  const containScale = useContainScale(containerRef, totalSize);

  /**
   * Repaint the whole overlay: every committed selection's outline, then the live
   * marquee on top of it.
   *
   * `selectionOverride` exists for the move arm only. A drag never reaches the store, so
   * the store still shows the selection at its pre-drag geometry; substituting the
   * dragged one in the array is the whole difference between previewing the drag and
   * repainting the un-moved selection underneath it.
   */
  const redrawOverlay = useCallback(
    ({
      selectionOverride,
      previewPoints,
    }: {
      selectionOverride?: Selection[];
      previewPoints?: Point[] | null;
    } = {}) => {
      const ctx = overlayCtxRef.current;
      if (!ctx) return;

      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      resetOverlayAlpha(ctx);
      (selectionOverride ?? selections).forEach((selection) =>
        drawSelectionOutline(ctx, selection, documentFrame, containScale.current)
      );
      if (previewPoints && previewPoints.length > 0) drawMarqueePreview(ctx, previewPoints);
    },
    [documentFrame, overlayCtxRef, selections, containScale]
  );

  /** Read and clear in one step, so two routes out of a gesture cannot both commit it. */
  function takeDrag(): EllipseDrag | null {
    const drag = dragRef.current;
    dragRef.current = null;

    return drag;
  }

  function dragParams(drag: EllipseDrag): EllipticalMarqueeDrag | null {
    if (!args || drag.mode !== 'create') return null;

    return {
      start: drag.start,
      end: drag.end,
      style: args.style,
      fixedRatio: args.fixedRatio,
      fixedWidth: args.fixedWidth,
      fixedHeight: args.fixedHeight,
      constrainToCircle: drag.constrainToCircle,
      fromCentre: drag.fromCentre,
    };
  }

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !args) return;
    if (!isPointerDownValid(event)) return;

    event.preventDefault();

    const pointerId = typeof event.pointerId === 'number' ? event.pointerId : null;
    const start = getLocalCoords(event);
    const documentStart = canvasToDocumentPoint(start, documentFrame);
    const activeSelection = getActiveSelection(selections, activeSelectionId);

    // A press inside the existing selection moves it, as every selection tool in this
    // editor does. It is also the one route that dispatches no draft, because there is
    // nothing being drawn — the same split `RectangularSelectionToolArea:91` makes.
    if (activeSelection && isPointInPolygon(documentStart, getSelectionAbsolutePoints(activeSelection))) {
      dragRef.current = {
        mode: 'move',
        pointerId,
        origin: documentStart,
        baseline: activeSelection,
        preview: activeSelection,
      };
      redrawOverlay();
      return;
    }

    dragRef.current = {
      mode: 'create',
      pointerId,
      start,
      end: start,
      constrainToCircle: event.shiftKey,
      fromCentre: event.altKey,
      previewPoints: null,
    };
    dispatch({ type: 'START_SELECTION_DRAFT', payload: { sourceTool: ELLIPTICAL_SELECTION_SOURCE_TOOL } });
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== (typeof event.pointerId === 'number' ? event.pointerId : null)) return;

    if (drag.mode === 'create') {
      // The modifier state is read per move, not once at press time, so pressing Shift
      // halfway through a drag snaps the preview to a circle exactly as it snaps the
      // commit — the two are the same call with the same arguments.
      drag.end = getLocalCoords(event);
      drag.constrainToCircle = event.shiftKey;
      drag.fromCentre = event.altKey;
      if (!isPointerMoveValid(event)) return;

      const params = dragParams(drag);
      drag.previewPoints = params ? ellipsePointsFromDrag(params) : null;
      redrawOverlay({ previewPoints: drag.previewPoints });
      return;
    }

    if (!isPointerMoveValid(event)) return;

    const documentPoint = canvasToDocumentPoint(getLocalCoords(event), documentFrame);
    const delta = { x: documentPoint.x - drag.origin.x, y: documentPoint.y - drag.origin.y };
    const preview = moveSelectionByDelta(drag.baseline, delta);
    drag.origin = documentPoint;
    drag.preview = preview;
    redrawOverlay({
      selectionOverride: selections.map((selection) => (selection.id === preview.id ? preview : selection)),
    });
  };

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== (typeof event.pointerId === 'number' ? event.pointerId : null)) return;
    if (!isPointerUpValid(event)) return;

    takeDrag();

    if (drag.mode === 'move') {
      // Gated on GEOMETRY, not on the drag having happened: both move builders bump
      // `metadata.movedAtVersion` on every call, so a deep comparison of the dragged
      // selection against its baseline could never report "unchanged", and every
      // `COMMIT_DOCUMENT_EDIT` marks the document dirty and adds an undo step.
      if (!hasSameSelectionGeometry(drag.baseline, drag.preview)) {
        commitSelection(drag.preview, 'move');
      }
      return;
    }

    // A drag that never moved commits from the press point, which is what makes
    // `fixed-size` a complete gesture on a click and `normal` / `fixed-ratio` a no-op.
    if (!drag.previewPoints) {
      drag.end = getLocalCoords(event);
      drag.constrainToCircle = event.shiftKey;
      drag.fromCentre = event.altKey;
      const params = dragParams(drag);
      drag.previewPoints = params ? ellipsePointsFromDrag(params) : null;
    }

    const points = drag.previewPoints;
    const selection = points
      ? createCommittedPolygonSelection({
          id: uuidv4(),
          points: points.map((point) => canvasToDocumentPoint(point, documentFrame)),
          sourceTool: ELLIPTICAL_SELECTION_SOURCE_TOOL,
        })
      : null;

    if (!selection) {
      dispatch({ type: 'CANCEL_SELECTION_DRAFT' });
      redrawOverlay();
      return;
    }

    // The single commit point for the whole drag. `usePointerPosition` hands over the
    // pointer in its `isPointerUpValid`, the store has been untouched since
    // `START_SELECTION_DRAFT`, and every pointer move in between only wrote the overlay —
    // so this is one undoable edit per completed gesture and never one per move.
    commitSelection(selection, 'create');
    redrawOverlay();
  };

  const abortDrag = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== (typeof event.pointerId === 'number' ? event.pointerId : null)) return;

    takeDrag();
    // The store still shows the un-moved selection, so the repaint below is the
    // snap-back an abandoned drag gets.
    redrawOverlay();
    if (drag.mode === 'create') {
      dispatch({ type: 'CANCEL_SELECTION_DRAFT' });
    }
  };

  useEffect(() => {
    redrawOverlay();
  }, [redrawOverlay]);

  useEffect(() => {
    const ctx = overlayCtxRef.current;

    return () => {
      // An unmount mid-drag is an abort like any other: the running drag is dropped
      // through the same primitive, so a gesture that ends here can never commit.
      takeDrag();
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
      onPointerLeave={abortDrag}
      onPointerCancel={abortDrag}
      style={{ userSelect: 'none' }}
    />
  );
};
