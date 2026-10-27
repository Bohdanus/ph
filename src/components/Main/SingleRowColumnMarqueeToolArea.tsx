import { type PointerEvent, type RefObject, useCallback, useEffect, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useStore } from '../../contexts/StoreContext.tsx';
import { useSelectionHistory } from '../../contexts/useSelectionHistory.ts';
import { usePointerPosition } from '../../hooks/usePointerPosition.ts';
import { clearSelectionDragPreview, publishSelectionDragPreview } from '../../hooks/selection-drag-preview.ts';
import {
  claimDocumentGesture,
  releaseDocumentGesture,
  type DocumentGestureKind,
} from '../../hooks/document-gesture.ts';
import type { Point, Selection } from '../../contexts/general-types.ts';
import {
  createCommittedRectangleSelection,
  getActiveSelection,
  hasSameSelectionGeometry,
  isPointInSelection,
} from '../../util/selection.ts';
import { canvasToDocumentPoint, documentFrameFromSize, documentToCanvasPoint } from '../../contexts/document-frame.ts';
import { resetOverlayAlpha } from '../../util/canvas.ts';
import {
  SINGLE_COLUMN_MARQUEE_SOURCE_TOOL,
  SINGLE_ROW_MARQUEE_SOURCE_TOOL,
  bandOrientation,
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
 * what every selection tool in this editor does (`EllipticalSelectionToolArea.tsx:155`).
 * It matters here more than it does elsewhere: the committed selection spans the whole
 * document on one axis, so a press that misses the 1-pixel band is the ONLY way to draw a
 * new one, and the band-hit test below is what keeps the two apart.
 *
 * `preview` is the band this gesture has built SO FAR, and it is the only place the
 * running state lives. There is deliberately no `origin` and no accumulating delta: the
 * band is a pure function of where the pointer IS (see `movedBand`), so a drag that goes
 * out and comes back ends where it started no matter how many frames it took. A field
 * holding an advancing origin would look like the obvious way to extend the gesture and
 * would reintroduce exactly the defect `EllipticalSelectionToolArea.test.tsx:347` pins
 * for that tool, so it is not here to be found.
 */
type MarqueeDrag =
  | { mode: 'create'; pointerId: number | null; axis: number }
  | { mode: 'move'; pointerId: number | null; baseline: Selection; preview: Selection };

/**
 * The transient 1-pixel band, drawn as a dashed closed path.
 *
 * Hand-rolled rather than a call into `util/selection.ts`'s outline painters, because they draw
 * a white anchor dot on every vertex and the corners of a 1-pixel band are not draggable in
 * Photoshop — the band is placed by the press, not by dragging its handles. This file calls
 * neither of them, so that was true of the four discs the committed outline painted here as well
 * as of the band: decoration on a hit target one pixel tall, which is why
 * `e2e/single-row-column-marquee.spec.ts:36`-`:50` excludes a frame from its scan and reads ~3
 * document px where the discs themselves measure ~13. The committed border is the ants canvas's
 * business now; this is the same dashed closed path a committed marquee shows, without the
 * handles.
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
  /** The kind the OPEN claim was taken under, so the release cannot name a different one. */
  const claimedKindRef = useRef<DocumentGestureKind | null>(null);
  const { getLocalCoords, isPointerDownValid, isPointerMoveValid, isPointerUpValid, releasePointer } =
    usePointerPosition({
      ref: containerRef,
      imageSize: totalSize,
    });

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
    // but a re-selection at a different shape.
    //
    // Asked through `bandOrientation` rather than off the rect's thickness, and that is the
    // whole point: on a document ONE PIXEL WIDE a row band is also one pixel wide, so a
    // thickness-only rule reads it as a column and turns a vertical drag into a transposed
    // band. `bandOrientation` is the same function the hit test used to accept this press, so
    // the two cannot disagree about what was grabbed.
    //
    // `null` means no move, and it is deliberately NOT a fallback to the active tool: this
    // function is unreachable with a rect the predicate rejects — `isPressOnActiveBand` gated
    // the press on the same call — but a fallback to `isColumn` would re-introduce exactly the
    // transposition the paragraph above rules out, silently, the day that gate ever drifts.
    // Returning null makes the drift a dropped drag instead.
    const orientation = bandOrientation(getRectOf(baseline), totalSize);
    if (!orientation) return null;

    const axis = orientation === 'column' ? pointer.x : pointer.y;

    const rebuilt = createCommittedRectangleSelection({
      id: baseline.id,
      rect: orientation === 'column' ? singleColumnMarqueeRect(axis, totalSize) : singleRowMarqueeRect(axis, totalSize),
      imageSize: totalSize,
    });

    // Carried over rather than rebuilt: `isActive` is how the store decides which selection a
    // later press grabs. `movedAtVersion` is bumped per FRAME, not per commit, because this
    // builder runs on every pointermove; its consumers only ever test it for inequality, so
    // a five-frame drag leaving it five higher says nothing false — but read it as a frame
    // counter, not a version of the document.
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
      const ctx = overlayCtxRef?.current;
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

    return isPointInSelection(point, selection);
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
   *
   * The kind is computed from the gesture's own record rather than from `isColumn`, which
   * reads the CURRENT `toolName`: both tools share one mounted component (Main.tsx maps
   * them to one interaction mode), so a tool switch mid-gesture would otherwise release a
   * kind the claim was never taken under and the claim would leak. A pointer press cannot
   * switch tools — the claim refuses the document-mutating shortcuts — so this is a
   * belt-and-braces read rather than a reachable case, and it costs one field.
   */
  const releaseDocumentClaim = useCallback(() => {
    const kind = claimedKindRef.current ?? (isColumn ? 'single-column-marquee' : 'single-row-marquee');
    releaseDocumentGesture(kind, claimedPointerIdRef.current);
    claimedKindRef.current = null;
    claimedPointerIdRef.current = null;
  }, [isColumn]);

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
    const gestureKind: DocumentGestureKind = isColumn ? 'single-column-marquee' : 'single-row-marquee';
    if (claimDocumentGesture(gestureKind, pointerId)) {
      claimedKindRef.current = gestureKind;
      claimedPointerIdRef.current = pointerId;
    }

    if (isPressOnActiveBand(documentStart, activeSelection)) {
      dragRef.current = {
        mode: 'move',
        pointerId,
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
      // The preview painter draws straight into the overlay context, which is CANVAS space. A
      // committed selection's stored points are DOCUMENT space, and every painter of them maps
      // them back with `documentToCanvasPoint` before stroking — `useSelectionAnts.ts:40` for
      // the ants canvas this tool's border now lives on — so this preview converts the same way.
      // Feeding it `rectForAxis`'s document-space corners directly would draw the band a frame
      // origin off from where the same gesture commits.
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
    // one frame's worth, which is the defect `EllipticalSelectionToolArea.test.tsx:347` pins for
    // that tool, and with a single-frame drag the two forms coincide, so it is invisible there.
    //
    // `drag.preview` is passed only so the BAND'S ORIENTATION survives the gesture: the hit test
    // is orientation-agnostic, so the column tool can be handed a row band, and re-deriving from
    // the previous frame's band is what keeps a row band a row band under the column tool.
    const preview = movedBand(drag.preview, documentPoint);
    if (!preview) return;
    drag.preview = preview;
    // The ants canvas is what follows the band, not this overlay. It owns the committed border
    // and reads this channel every frame, painting `preview` in place of the committed one with
    // the dash offset held, so the ants freeze rather than crawl away from the pointer
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

    // FIRST, before anything can return — see the note on `releaseDocumentClaim`.
    releaseDocumentClaim();

    if (drag.mode === 'move') {
      // Gated on GEOMETRY — `pos` and `points`, nothing else — because the alternative
      // answers the wrong question. A deep comparison can never report "unchanged" here, since
      // `movedBand` bumps `metadata.movedAtVersion` on every frame; and every
      // `COMMIT_DOCUMENT_EDIT` marks the document dirty and adds an undo step, so a drag that
      // returned to where it started would leave an undo entry for a move that never happened.
      // This is the arm that makes "drag out and drag back" commit nothing.
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
    // frame origin below the row that was pressed. `EllipticalSelectionToolArea.tsx:255` is
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
    clearSelectionDragPreview();
    // What the repaint still has to do is drop the create arm's band. The snap-back an
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
    const ctx = overlayCtxRef?.current;

    return () => {
      // An unmount mid-gesture is an abort like any other: the running drag is dropped
      // through the same primitive, so a gesture that ends here can never commit.
      takeDrag();
      releaseDocumentClaim();
      // The route easiest to miss, because nothing about an unmount looks like a gesture. The
      // preview slot is a module-level variable that outlives this mount, so an entry left
      // behind would freeze the ants on a selection that no longer exists for every later tool
      // — `selection-drag-preview.ts:56`-`:64`.
      clearSelectionDragPreview();
      if (ctx) {
        ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      }
    };
  }, [overlayCtxRef, releaseDocumentClaim]);

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
