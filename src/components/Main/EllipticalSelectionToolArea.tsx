import { type PointerEvent, type RefObject, useCallback, useEffect, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useCurrentTool } from '../../contexts/useCurrentTool.tsx';
import { useStore } from '../../contexts/StoreContext.tsx';
import { useSelectionHistory } from '../../contexts/useSelectionHistory.ts';
import { usePointerPosition } from '../../hooks/usePointerPosition.ts';
import { clearSelectionDragPreview, publishSelectionDragPreview } from '../../hooks/selection-drag-preview.ts';
import type { Point, Selection } from '../../contexts/general-types.ts';
import {
  createCommittedPolygonSelection,
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
 * Hand-rolled rather than a call into `util/selection.ts`'s outline painters, because they draw
 * a white anchor dot on every vertex and a tessellated ellipse has between 16 and 720 of them
 * depending on its radius. This file calls neither of them. The committed border is the ants
 * canvas's business now, and the committed one never had dots to give up: an ellipse commits
 * with the borrowed `sourceTool: 'magic-wand'` (`ellipticalSelection.ts:48`), which is the one
 * source those painters skip. What this paints is the transient picture of the drag, and it is
 * the same dashed closed path a committed marquee shows without the handles.
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

  /**
   * Repaint the whole overlay: the live marquee, and nothing else.
   *
   * The committed border is not painted here any more. This tool is in `Main.tsx`'s
   * `SELECTION_INTERACTION_MODES`, so `useSelectionMarchingAnts` owns that border on a canvas of
   * its own, and the static stroke here put two outlines of one selection on screen in two
   * colours on two canvases. The drag that used to arrive as `selectionOverride` goes to the
   * ants too — it is published to them instead of drawn — so the move arm has no representation
   * on this overlay at all.
   */
  const redrawOverlay = useCallback(
    ({ previewPoints }: { previewPoints?: Point[] | null } = {}) => {
      const ctx = overlayCtxRef.current;
      if (!ctx) return;

      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      // Not optional, and not `drawMarqueePreview`'s to do: the tool overlay is one 2D context
      // for the whole session and the preview painter is `save()`/`restore()`, so it inherits
      // whatever `globalAlpha` the last painting tool left behind. Nothing else in this
      // repository skips the reset before painting an overlay (`useSelectionAnts.ts:137`-`:143`).
      resetOverlayAlpha(ctx);
      if (previewPoints && previewPoints.length > 0) drawMarqueePreview(ctx, previewPoints);
    },
    [overlayCtxRef]
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
      // Nothing published, and that is the whole difference between this arm and the move arm
      // below: a NEW ellipse is being drawn rather than a committed one moved, so the committed
      // border behind it is still true and keeps marching under the marquee. That is what
      // Photoshop shows when a new selection is dragged across an existing one, and
      // `selection-drag-preview.ts:19`-`:21` states the same rule for the polygon tools.
      redrawOverlay({ previewPoints: drag.previewPoints });
      return;
    }

    if (!isPointerMoveValid(event)) return;

    const documentPoint = canvasToDocumentPoint(getLocalCoords(event), documentFrame);
    const delta = { x: documentPoint.x - drag.origin.x, y: documentPoint.y - drag.origin.y };
    const preview = moveSelectionByDelta(drag.preview, delta);
    drag.origin = documentPoint;
    drag.preview = preview;
    // The ants canvas is what follows the selection, not this overlay. It owns the committed
    // border and reads this channel every frame, painting `preview` in place of the committed one
    // with the dash offset held, so the ants freeze rather than crawl away from the pointer
    // (`useSelectionAnts.ts:163`-`:191`). Publishing exactly what the overlay used to draw is
    // what keeps one selection to one outline.
    publishSelectionDragPreview({ kind: 'follow', selection: preview });
    redrawOverlay();
  };

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== (typeof event.pointerId === 'number' ? event.pointerId : null)) return;
    if (!isPointerUpValid(event)) return;

    takeDrag();
    // Unconditional, and here before either arm can return: the create arm never publishes, so
    // the slot may already be empty, and clearing it anyway is what lets the route that did
    // publish be written without asking which arm ran.
    clearSelectionDragPreview();

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
    clearSelectionDragPreview();
    // What the repaint still has to do is drop the create arm's marquee. The snap-back an
    // abandoned MOVE gets is not drawn here: the store still shows the un-moved selection, and
    // the ants canvas picks that geometry up again the moment the preview above is gone.
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
      // The route easiest to miss, because nothing about an unmount looks like a gesture. The
      // preview slot is a module-level variable that outlives this mount, so an entry left
      // behind would freeze the ants on a selection that no longer exists for every later tool
      // — `selection-drag-preview.ts:56`-`:64`.
      clearSelectionDragPreview();
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
      onPointerCancel={abortDrag}
      style={{ userSelect: 'none' }}
    />
  );
};
