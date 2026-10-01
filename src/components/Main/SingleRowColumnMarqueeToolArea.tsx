import { type PointerEvent, type RefObject, useCallback, useEffect, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useStore } from '../../contexts/StoreContext.tsx';
import { useSelectionHistory } from '../../contexts/useSelectionHistory.ts';
import { usePointerPosition } from '../../hooks/usePointerPosition.ts';
import { useContainScale } from '../../hooks/useContainScale.ts';
import { claimDocumentGesture, releaseDocumentGesture } from '../../hooks/document-gesture.ts';
import type { Point, Selection } from '../../contexts/general-types.ts';
import {
  createCommittedRectangleSelection,
  drawSelectionOutline,
  getActiveSelection,
  getSelectionAbsolutePoints,
  hasSameSelectionGeometry,
  isPointInPolygon,
  moveSelectionByDelta,
} from '../../util/selection.ts';
import { canvasToDocumentPoint, documentFrameFromSize, documentToCanvasPoint } from '../../contexts/document-frame.ts';
import { resetOverlayAlpha } from '../../util/canvas.ts';
import {
  SINGLE_COLUMN_MARQUEE_SOURCE_TOOL,
  SINGLE_ROW_MARQUEE_SOURCE_TOOL,
  isSingleRowOrColumnMarqueeRect,
  singleColumnMarqueeRect,
  singleRowMarqueeRect,
} from '../../tools/singleRowColumnMarquee.ts';
import type { RectXYSorted } from '../../contexts/general-types.ts';

type SingleRowColumnMarqueeToolAreaProps = {
  className?: string;
  overlayCtxRef?: RefObject<CanvasRenderingContext2D | null>;
};

/**
 * A running gesture, in both arms.
 *
 * The `move` arm exists because a press inside the active selection moves it, which is
 * what every selection tool in this editor does (`EllipticalSelectionToolArea.tsx:159`).
 * It matters here more than it does elsewhere: the committed selection spans the whole
 * document on one axis, so a press that misses the 1-pixel band is the ONLY way to draw a
 * new one, and the band-hit test below is what keeps the two apart.
 *
 * `pressAxis` is the axis value at the press and NEVER advances. That is the whole fix for
 * the defect the elliptical marquee carries: it recomputes each frame's delta against the
 * PREVIOUS frame, so a multi-frame drag's net displacement is its last frame alone rather
 * than the sum (`EllipticalSelectionToolArea.tsx:205`-`:208`, pinned by the `it.fails` at
 * `EllipticalSelectionToolArea.test.tsx:318`). Every delta here is measured from the press,
 * so a drag that goes out and comes back commits nothing and one that goes out twice lands
 * where it was released.
 */
type MarqueeDrag =
  | { mode: 'create'; pointerId: number | null; pressAxis: number }
  | { mode: 'move'; pointerId: number | null; pressAxis: number; baseline: Selection };

/**
 * The transient 1-pixel band, drawn as a dashed closed path.
 *
 * Deliberately not `drawSelectionOutline`: that draws a white anchor dot on every vertex,
 * and the corners of a 1-pixel band are not draggable in Photoshop — the band is placed by
 * the press, not by dragging its handles.
 *
 * The geometry is divided by the contain scale, which `drawSelectionOutline` also does, so
 * the preview's chrome is the same weight on screen at any zoom as the outline it becomes.
 */
function drawMarqueePreview(ctx: CanvasRenderingContext2D, points: Point[], scale: number): void {
  if (points.length < 2) return;

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let index = 1; index < points.length; index++) {
    ctx.lineTo(points[index].x, points[index].y);
  }
  ctx.closePath();
  ctx.strokeStyle = 'rgba(0,123,255,0.95)';
  ctx.lineWidth = 2 / scale;
  ctx.setLineDash([6 / scale, 4 / scale]);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

export const SingleRowColumnMarqueeToolArea = ({ className, overlayCtxRef }: SingleRowColumnMarqueeToolAreaProps) => {
  const [{ toolName, containerRef, selections, totalSize, documentFrame: currentFrame, activeSelectionId }, dispatch] =
    useStore();
  const documentFrame = currentFrame ?? documentFrameFromSize(totalSize);
  const { commitSelection } = useSelectionHistory();

  const isColumn = toolName === 'single-column-marquee';
  const dragRef = useRef<MarqueeDrag | null>(null);
  const claimedPointerIdRef = useRef<number | null>(null);
  const { getLocalCoords, isPointerDownValid, isPointerMoveValid, isPointerUpValid, releasePointer } =
    usePointerPosition({
      ref: containerRef,
      imageSize: totalSize,
    });
  const containScale = useContainScale(containerRef, totalSize);

  /**
   * The band this tool commits from a DOCUMENT-space axis value.
   *
   * One function rather than two call sites, so the row and the column cannot drift into
   * two different rules about flooring and clamping. `axis` is the pointer's Y for a row
   * and its X for a column.
   */
  function rectForAxis(axis: number): RectXYSorted {
    return isColumn ? singleColumnMarqueeRect(axis, totalSize) : singleRowMarqueeRect(axis, totalSize);
  }

  /**
   * The pointer axis this tool reads, in DOCUMENT coordinates.
   *
   * `getLocalCoords` measures against the container and hands over CANVAS coordinates, so
   * every axis value is converted once here and everything downstream is document space.
   * `totalSize` is the DOCUMENT's extent (`StoreContext.tsx:357` derives it from the frame),
   * so clamping the document axis against it is the right comparison.
   */
  function pointerAxis(event: PointerEvent<HTMLDivElement>): number {
    const documentPoint = canvasToDocumentPoint(getLocalCoords(event), documentFrame);

    return isColumn ? documentPoint.x : documentPoint.y;
  }

  /** The four corners of a DOCUMENT-space rect, converted to canvas for painting. */
  function canvasCorners(rect: RectXYSorted): Point[] {
    return [
      { x: rect.x1, y: rect.y1 },
      { x: rect.x2, y: rect.y1 },
      { x: rect.x2, y: rect.y2 },
      { x: rect.x1, y: rect.y2 },
    ].map((point) => documentToCanvasPoint(point, documentFrame));
  }

  const redrawOverlay = useCallback(
    ({
      selectionOverride,
      previewRect,
    }: { selectionOverride?: Selection[]; previewRect?: RectXYSorted | null } = {}) => {
      const ctx = overlayCtxRef?.current;
      if (!ctx) return;

      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      resetOverlayAlpha(ctx);
      (selectionOverride ?? selections).forEach((selection) =>
        drawSelectionOutline(ctx, selection, documentFrame, containScale.current)
      );
      if (previewRect) drawMarqueePreview(ctx, canvasCorners(previewRect), containScale.current);
    },
    [containScale, documentFrame, overlayCtxRef, selections]
  );

  /** Read and clear in one step, so two routes out of a gesture cannot both commit it. */
  function takeDrag(): MarqueeDrag | null {
    const drag = dragRef.current;
    dragRef.current = null;

    return drag;
  }

  /**
   * Give up this component's claim, and only this one.
   *
   * `releaseDocumentGesture` ignores a release that names no open claim, a different kind
   * or a different pointer, so every abort route can call this unconditionally — including
   * the unmount cleanup, which is what bounds a leaked claim to the mount that leaked it.
   */
  function releaseDocumentClaim() {
    releaseDocumentGesture(isColumn ? 'single-column-marquee' : 'single-row-marquee', claimedPointerIdRef.current);
    claimedPointerIdRef.current = null;
  }

  /**
   * Whether a press at this point is on the active band rather than off it.
   *
   * The point test is what `EllipticalSelectionToolArea` does, and for a 1-pixel band it
   * is the whole of the distinction: the band covers one row (or column) across the entire
   * document, so "inside" is exactly one pixel of hit area and "outside" is everything
   * else. `isSingleRowOrColumnMarqueeRect` narrows it further — a rectangular-marquee
   * selection is NOT grabbed by a 1-pixel tool's press, because dragging it would move a
   * rectangle the user drew with a different tool and no drag of this tool's own preview
   * would replace it.
   */
  function isPressOnActiveBand(point: Point, selection: Selection | null): boolean {
    if (!selection || selection.geometry !== 'rectangle') return false;

    const { x, y, width, height } = selection.pos;
    if (!isSingleRowOrColumnMarqueeRect({ x1: x, y1: y, x2: x + width, y2: y + height }, totalSize)) return false;

    // BOTH sides are document space: `getSelectionAbsolutePoints` is `points + pos`
    // (`selection.ts:127`), and its callers convert it TO canvas rather than from it —
    // `drawSelectionOutline` at `selection.ts:176`, `drawSelectionAnchors` at `:237`,
    // `useSelectionAnts.ts:82`. `findSelectionAnchorAtPoint`'s own doc says the same
    // ("that function and that one receive a document-space point"). Converting the press
    // here instead would compare canvas against document, which on a shifted frame misses
    // the band the user is pressing and hits one frame away from it.
    return isPointInPolygon(point, getSelectionAbsolutePoints(selection));
  }

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    if (!isPointerDownValid(event)) return;

    event.preventDefault();

    const pointerId = typeof event.pointerId === 'number' ? event.pointerId : null;
    const local = getLocalCoords(event);
    const documentStart = canvasToDocumentPoint(local, documentFrame);
    const pressAxis = isColumn ? documentStart.x : documentStart.y;
    const activeSelection = getActiveSelection(selections, activeSelectionId);

    // The claim is taken BEFORE the two arms are decided, because the commit lands on
    // release either way and a shortcut pressed in between would clear or mutate the
    // document the pending commit then truncates.
    if (claimDocumentGesture(isColumn ? 'single-column-marquee' : 'single-row-marquee', pointerId)) {
      claimedPointerIdRef.current = pointerId;
    }

    if (isPressOnActiveBand(documentStart, activeSelection)) {
      dragRef.current = { mode: 'move', pointerId, pressAxis, baseline: activeSelection as Selection };
      redrawOverlay();
      return;
    }

    dragRef.current = { mode: 'create', pointerId, pressAxis };
    dispatch({
      type: 'START_SELECTION_DRAFT',
      payload: {
        sourceTool: isColumn ? SINGLE_COLUMN_MARQUEE_SOURCE_TOOL : SINGLE_ROW_MARQUEE_SOURCE_TOOL,
      },
    });
  };

  /**
   * The band a drag is proposing, in DOCUMENT space, for either arm.
   *
   * Both arms reduce to the same expression, and that is deliberate. A move of a 1-pixel
   * band is not a free translation: a full-width row that is dragged sideways becomes a
   * rectangle that overhangs the document and is no longer a band at all, which would break
   * `isSingleRowOrColumnMarqueeRect` for every later press. Rebuilding the band from the
   * pointer axis instead of translating the old one makes the "one pixel on one axis, the
   * whole document on the other" invariant hold by construction, and it is the same rule
   * the create arm uses, so the two cannot disagree about what a row is.
   */
  function rectForDrag(event: PointerEvent<HTMLDivElement>): RectXYSorted {
    return rectForAxis(pointerAxis(event));
  }

  /**
   * The preview selection for a move, or null when the band has not actually moved.
   *
   * `moveSelectionByDelta` is what carries the metadata and lifecycle bookkeeping of a
   * move, so the delta is expressed as the distance from the baseline's band to the band
   * the pointer is now on — measured from the PRESS, so a drag that returns to where it
   * started produces no delta at all.
   */
  function movePreviewFor(
    drag: Extract<MarqueeDrag, { mode: 'move' }>,
    event: PointerEvent<HTMLDivElement>
  ): Selection {
    const target = rectForDrag(event);
    const current = rectForAxis(drag.pressAxis);

    return moveSelectionByDelta(drag.baseline, {
      x: target.x1 - current.x1,
      y: target.y1 - current.y1,
    });
  }

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== (typeof event.pointerId === 'number' ? event.pointerId : null)) return;
    if (!isPointerMoveValid(event)) return;

    if (drag.mode === 'create') {
      redrawOverlay({ previewRect: rectForDrag(event) });
      return;
    }

    redrawOverlay({
      selectionOverride: selections.map((selection) =>
        selection.id === drag.baseline.id ? movePreviewFor(drag, event) : selection
      ),
    });
  };

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== (typeof event.pointerId === 'number' ? event.pointerId : null)) return;
    if (!isPointerUpValid(event)) return;

    takeDrag();

    // The two returns above are the pointer-id and primary-button gates, and both are
    // correct: a foreign pointer or a non-primary release is not this gesture's, and the
    // genuine release still arrives afterwards. The claim is released on every path from
    // here down — the move arm, the null-return arm and the success arm.
    releaseDocumentClaim();

    if (drag.mode === 'move') {
      // The baseline must still be IN the store. If it was cleared or retired mid-gesture
      // there is nothing to move, and `committedSelectionUpdate` maps over `selections`
      // without appending, so committing would publish a history entry and an
      // `activeSelectionId` naming a selection that does not exist.
      if (!selections.some((selection) => selection.id === drag.baseline.id)) {
        redrawOverlay();
        return;
      }

      const preview = movePreviewFor(drag, event);

      // Gated on GEOMETRY, not on the drag having happened: every move builder bumps
      // `metadata.movedAtVersion`, so a deep comparison could never report "unchanged",
      // and every `COMMIT_DOCUMENT_EDIT` marks the document dirty and adds an undo step.
      // This is the arm that makes "drag out and drag back" commit nothing.
      if (!hasSameSelectionGeometry(drag.baseline, preview)) {
        commitSelection(preview, 'move');
      }
      redrawOverlay();
      return;
    }

    // A press that never moved commits from the press point, which is the whole gesture
    // in Photoshop: these tools are clicked, not dragged. A drag that DID move commits
    // from the pointer's position on release, because "drag the marquee to the exact
    // location" is Adobe's own wording for the same gesture
    // (`helpx.adobe.com/photoshop/using/selecting-marquee-tools.html`).
    const selection = createCommittedRectangleSelection({
      id: uuidv4(),
      rect: rectForDrag(event),
      imageSize: totalSize,
    });

    if (!selection) {
      // A zero-width or zero-height document has no band to commit: `trimRect` clamps to
      // the document, so the rect collapses and the builder returns `null`.
      dispatch({ type: 'CANCEL_SELECTION_DRAFT' });
      redrawOverlay();
      return;
    }

    // NO frame offset is applied here. `createCommittedRectangleSelection` performs no
    // coordinate conversion — its `pos` is `trimRect(rect)` verbatim — so the rect is
    // already in document space because `rectForAxis` was handed a document axis, and
    // adding `documentFrame` here would convert twice and land the band one frame away
    // from the press. `RectangularSelectionToolArea.tsx:107`-`:112` re-adds the frame
    // legitimately because `useRect` hands IT a canvas-space rect; the elliptical and quick
    // selection tools convert up front and commit with no re-add, as this does.
    commitSelection(selection, 'create');
    redrawOverlay();
  };

  const abortDrag = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== (typeof event.pointerId === 'number' ? event.pointerId : null)) return;

    takeDrag();
    // Both, and in this order. `releasePointer` clears the hook's captured pointer, which
    // `handlePointerUp` cannot reach once `takeDrag` has emptied the ref -- the up handler
    // returns before `isPointerUpValid`, so a leave-then-release left the capture held and
    // every later press was refused by `isPointerDownValid`'s first-pointer-wins check.
    releasePointer();
    releaseDocumentClaim();
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
    const ctx = overlayCtxRef?.current;

    return () => {
      // An unmount mid-gesture is an abort like any other: the running drag is dropped
      // through the same primitive, so a gesture that ends here can never commit.
      takeDrag();
      releaseDocumentClaim();
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
