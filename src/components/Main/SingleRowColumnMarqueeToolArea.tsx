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
} from '../../util/selection.ts';
import { canvasToDocumentPoint, documentFrameFromSize, documentToCanvasPoint } from '../../contexts/document-frame.ts';
import { resetOverlayAlpha } from '../../util/canvas.ts';
import {
  MARQUEE_THICKNESS_PX,
  SINGLE_COLUMN_MARQUEE_SOURCE_TOOL,
  SINGLE_ROW_MARQUEE_SOURCE_TOOL,
  isSingleRowOrColumnMarqueeRect,
  singleColumnMarqueeRect,
  singleRowMarqueeRect,
} from '../../tools/singleRowColumnMarquee.ts';

type SingleRowColumnMarqueeToolAreaProps = {
  className?: string;
  overlayCtxRef?: RefObject<CanvasRenderingContext2D | null>;
};

/**
 * A running gesture, in both arms, carrying the pointer id it was taken with.
 *
 * The `move` arm exists because a press inside the active selection moves it, which is
 * what every selection tool in this editor does (`EllipticalSelectionToolArea.tsx:159`).
 * It matters here more than it does elsewhere: the committed selection spans the whole
 * document on one axis, so a press that misses the 1-pixel band is the ONLY way to draw a
 * new one, and the band-hit test below is what keeps the two apart.
 */
type MarqueeDrag =
  | { mode: 'create'; pointerId: number | null; axis: number }
  | { mode: 'move'; pointerId: number | null; origin: Point; baseline: Selection; preview: Selection };

/**
 * The transient 1-pixel band, drawn as a dashed closed path.
 *
 * Deliberately not `drawSelectionOutline`: that draws a white anchor dot on every vertex,
 * and the corners of a 1-pixel band are not draggable in Photoshop — the band is placed by
 * the press, not by dragging its handles. The committed outline is the store's business;
 * this is the same dashed closed path a committed marquee shows, without the handles.
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

/** The four corners of a rect in canvas space, for the preview painter. */
function rectCorners(rect: { x1: number; y1: number; x2: number; y2: number }): Point[] {
  return [
    { x: rect.x1, y: rect.y1 },
    { x: rect.x2, y: rect.y1 },
    { x: rect.x2, y: rect.y2 },
    { x: rect.x1, y: rect.y2 },
  ];
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
   * The band this tool would commit from a document-space axis value.
   *
   * One function rather than two call sites, so the row and the column cannot drift into
   * two different rules about flooring and clamping. `axis` is the pointer's Y for a row
   * and its X for a column, in DOCUMENT coordinates.
   */
  function rectForAxis(axis: number) {
    return isColumn ? singleColumnMarqueeRect(axis, totalSize) : singleRowMarqueeRect(axis, totalSize);
  }

  /**
   * The band a MOVE gesture commits, which is not `moveSelectionByDelta` of a free delta.
   *
   * A band is only a band while it keeps the contract `rectForAxis` builds it to: one document
   * pixel on its thin axis, spanning the whole document on the other, starting at the origin. A
   * free 2-D delta breaks all three — dragging a row band sideways leaves `y1: 0` and a width of
   * one, so `isSingleRowOrColumnMarqueeRect` rejects it forever after and the band can never be
   * grabbed again; dragging off the canvas leaves a selection entirely outside the document; and a
   * fractional drag at any non-integer zoom puts `pos` between two pixels, so the band covers
   * half of each of two rows instead of one row.
   *
   * So the move is re-derived from the axis rather than translated: the thin coordinate comes from
   * `rectForAxis`, which floors and clamps it, and the pointer's movement along the band's OWN
   * axis is discarded. A row band can only move vertically and a column band only horizontally,
   * which is also the only movement Photoshop gives them — its selection-move machinery
   * ("Move a selection or selection border") moves the whole border, and for a strip one pixel
   * thick the thin axis is where the whole border is.
   */
  function movedBand(baseline: Selection, pointer: Point): Selection | null {
    // The BAND's own orientation, not the active tool's. The hit test is deliberately
    // orientation-agnostic, so the column tool can be handed a row band to move; rebuilding that
    // band from `isColumn` would silently TRANSPOSE it into a column, which is not a move at all
    // but a re-selection at a different shape. Reading the orientation off the rect the band
    // already has is what makes the cross-tool gesture move the band the user grabbed.
    const rect = getRectOf(baseline);
    const thinInX = rect.x2 - rect.x1 === MARQUEE_THICKNESS_PX;
    const thinInY = rect.y2 - rect.y1 === MARQUEE_THICKNESS_PX;
    const bandIsColumn = thinInX && !thinInY;
    const axis = bandIsColumn ? pointer.x : pointer.y;

    const rebuilt = createCommittedRectangleSelection({
      id: baseline.id,
      rect: bandIsColumn ? singleColumnMarqueeRect(axis, totalSize) : singleRowMarqueeRect(axis, totalSize),
      imageSize: totalSize,
    });

    // Carried over rather than rebuilt: `isActive` is how the store decides which selection a
    // later press grabs, and `movedAtVersion` is what every move builder bumps so the
    // `hasSameSelectionGeometry` gate can tell a real move from a re-render.
    return rebuilt
      ? {
          ...rebuilt,
          isActive: baseline.isActive,
          metadata: {
            ...baseline.metadata,
            movedAtVersion: (baseline.metadata?.movedAtVersion ?? 0) + 1,
          },
        }
      : null;
  }

  const redrawOverlay = useCallback(
    ({
      selectionOverride,
      previewPoints,
    }: { selectionOverride?: Selection[]; previewPoints?: Point[] | null } = {}) => {
      const ctx = overlayCtxRef?.current;
      if (!ctx) return;

      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      resetOverlayAlpha(ctx);
      (selectionOverride ?? selections).forEach((selection) =>
        drawSelectionOutline(ctx, selection, documentFrame, containScale.current)
      );
      if (previewPoints && previewPoints.length > 0) drawMarqueePreview(ctx, previewPoints);
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
   * Whether a press at this point is on the active selection rather than off it.
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
    if (!isSingleRowOrColumnMarqueeRect(getRectOf(selection), totalSize)) return false;

    return isPointInPolygon(point, getSelectionAbsolutePoints(selection));
  }

  function getRectOf(selection: Selection) {
    const { x, y, width, height } = selection.pos;

    return { x1: x, y1: y, x2: x + width, y2: y + height };
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

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    if (!isPointerDownValid(event)) return;

    event.preventDefault();

    const pointerId = typeof event.pointerId === 'number' ? event.pointerId : null;
    const local = getLocalCoords(event);
    const documentStart = canvasToDocumentPoint(local, documentFrame);
    const activeSelection = getActiveSelection(selections, activeSelectionId);

    // The claim is taken BEFORE the two arms are decided, because the commit lands on
    // release either way and a shortcut pressed in between would clear or mutate the
    // document the pending commit then truncates.
    if (claimDocumentGesture(isColumn ? 'single-column-marquee' : 'single-row-marquee', pointerId)) {
      claimedPointerIdRef.current = pointerId;
    }

    if (isPressOnActiveBand(documentStart, activeSelection)) {
      dragRef.current = {
        mode: 'move',
        pointerId,
        origin: documentStart,
        baseline: activeSelection as Selection,
        preview: activeSelection as Selection,
      };
      redrawOverlay();
      return;
    }

    dragRef.current = { mode: 'create', pointerId, axis: isColumn ? documentStart.x : documentStart.y };
    dispatch({
      type: 'START_SELECTION_DRAFT',
      payload: {
        sourceTool: isColumn ? SINGLE_COLUMN_MARQUEE_SOURCE_TOOL : SINGLE_ROW_MARQUEE_SOURCE_TOOL,
      },
    });
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== (typeof event.pointerId === 'number' ? event.pointerId : null)) return;
    if (!isPointerMoveValid(event)) return;

    const documentPoint = canvasToDocumentPoint(getLocalCoords(event), documentFrame);

    if (drag.mode === 'create') {
      drag.axis = isColumn ? documentPoint.x : documentPoint.y;
      // The preview painter draws straight into the overlay context, which is CANVAS space:
      // `drawSelectionOutline` maps a committed selection's stored document points back with
      // `documentToCanvasPoint` before painting (`selection.ts:176`-`:178`), and this preview
      // is the transient twin of that outline, so it converts the same way. Feeding it
      // `rectForAxis`'s document-space corners directly would draw the band a frame origin
      // off from where the same gesture commits.
      redrawOverlay({
        previewPoints: rectCorners(rectForAxis(drag.axis)).map((point) => documentToCanvasPoint(point, documentFrame)),
      });
      return;
    }

    // The band is RE-DERIVED from the pointer's absolute axis every frame, never translated by a
    // delta — see `movedBand`. That is what makes a multi-frame drag correct by construction
    // rather than by accumulation: each frame's band is a pure function of where the pointer IS,
    // so a drag that goes out and comes back ends on the band it started from no matter how many
    // frames it took. Accumulating a delta instead — each frame measured against an advancing
    // origin and applied to the baseline — makes the net displacement of such a drag equal to
    // one frame's worth, which is the defect `EllipticalSelectionToolArea.test.tsx:318` pins for
    // that tool, and with a single-frame drag the two forms coincide, so it is invisible there.
    //
    // `drag.preview` is passed only so the BAND'S ORIENTATION survives the gesture: the hit test
    // is orientation-agnostic, so the column tool can be handed a row band, and re-deriving from
    // the previous frame's band is what keeps a row band a row band under the column tool.
    const preview = movedBand(drag.preview, documentPoint);
    drag.origin = documentPoint;
    if (!preview) return;
    drag.preview = preview;
    redrawOverlay({ selectionOverride: selections.map((s) => (s.id === preview.id ? preview : s)) });
  };

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== (typeof event.pointerId === 'number' ? event.pointerId : null)) return;
    if (!isPointerUpValid(event)) return;

    takeDrag();

    // FIRST, before anything can return — see the note on `releaseDocumentClaim`.
    releaseDocumentClaim();

    if (drag.mode === 'move') {
      // Gated on GEOMETRY, not on the drag having happened: every move builder bumps
      // `metadata.movedAtVersion`, so a deep comparison could never report "unchanged",
      // and every `COMMIT_DOCUMENT_EDIT` marks the document dirty and adds an undo step.
      if (!hasSameSelectionGeometry(drag.baseline, drag.preview)) {
        commitSelection(drag.preview, 'move');
      }
      redrawOverlay();
      return;
    }

    // A press that never moved commits from the press point, which is the whole gesture
    // in Photoshop: these tools are clicked, not dragged. A drag that DID move commits
    // from the pointer's position on release, because "drag the marquee to the exact
    // location" is Adobe's own wording for the same gesture
    // (`helpx.adobe.com/photoshop/using/selecting-marquee-tools.html`).
    const axis = drag.axis;
    const selection = createCommittedRectangleSelection({
      id: uuidv4(),
      rect: rectForAxis(axis),
      imageSize: totalSize,
    });

    if (!selection) {
      dispatch({ type: 'CANCEL_SELECTION_DRAFT' });
      redrawOverlay();
      return;
    }

    // `rectForAxis` was handed a DOCUMENT-space axis (`canvasToDocumentPoint` already added
    // the frame), so the rect it built is already in document space and `pos` — which
    // `normalizeRectangleSelectionRect` derives from it — needs no conversion.
    //
    // It is tempting to mirror `RectangularSelectionToolArea.tsx:105`-`:112`, which does add
    // the frame, but that tool starts from a CANVAS-space rect out of `useRect`, and
    // canvas + frame is document. Adding the frame to a rect that is already document space
    // applies the same offset twice, which on a cropped document commits the band one whole
    // frame origin below the row that was pressed. `EllipticalSelectionToolArea.tsx:246` is
    // the same rule stated the other way round: it maps canvas points to document
    // (`canvasToDocumentPoint`) and then commits, with nothing added afterwards.
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
