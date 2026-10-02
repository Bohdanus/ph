import { type PointerEvent, type RefObject, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePointerPosition } from '../../hooks/usePointerPosition.ts';
import CreateShapeDialog, {
  type CreateShapeFigure,
  type CreateShapeParams,
} from '../CreateShapeDialog/CreateShapeDialog.tsx';
import { claimDocumentGesture, releaseDocumentGesture } from '../../hooks/document-gesture.ts';
import {
  drawShape,
  normalizeShapeGeometry,
  setShapeCtx,
  shapeGeometryBounds,
  type ShapeToolArgs,
} from '../../tools/shape.ts';
import { useLayers } from '../../contexts/useLayer.ts';
import { useCurrentTool } from '../../contexts/useCurrentTool.tsx';
import { useStore } from '../../contexts/StoreContext.tsx';
import type { Point } from '../../contexts/general-types.ts';
import type { FullArgs } from '../../contexts/tool-types.ts';
import { canvasToDocumentPoint, documentFrameFromSize } from '../../contexts/document-frame.ts';

type ShapeHandlerProps = {
  className?: string;
  overlayCtxRef: RefObject<CanvasRenderingContext2D | null>;
};

export const ShapeToolArea = ({ className, overlayCtxRef }: ShapeHandlerProps) => {
  const [{ containerRef, toolOverlayRef, totalSize, documentFrame: currentFrame }] = useStore();
  const documentFrame = currentFrame ?? documentFrameFromSize(totalSize);
  const { createLayerFromTool } = useLayers();
  const { toolArgs } = useCurrentTool();

  const args = toolArgs as ShapeToolArgs;
  const startRef = useRef<Point | null>(null);
  const endRef = useRef<Point | null>(null);
  const frameRequested = useRef<number | null>(null);
  const spacePressedRef = useRef(false);
  const lastPointRef = useRef<Point | null>(null);
  const originalShapeRef = useRef<{ start: Point; end: Point } | null>(null);
  const anchorRef = useRef<Point | null>(null);
  const fromCenterRef = useRef(false);
  /**
   * The pointer id this component's own claim was taken with. The cancel handler and the unmount
   * cleanup never see a pointer event, so the id is kept here for every release route to name the
   * claim it is releasing.
   */
  const claimedPointerIdRef = useRef<number | null>(null);

  /**
   * The bare click awaiting a size, and the two facts about it that are latched rather than
   * read: the clicked point in DOCUMENT space (the dialog can outlive a document resize, so
   * it keeps the point it was given rather than re-deriving it from a frame that may have
   * moved) and whether Alt/Option was held at the press.
   *
   * `null` is the closed state, and it is what makes the dialog's mount conditional in the
   * render below rather than a hidden panel that still owns the keyboard.
   */
  const [pendingShape, setPendingShape] = useState<{ anchor: Point; fromCenter: boolean } | null>(null);

  function releaseDocumentClaim() {
    releaseDocumentGesture('shape-draw', claimedPointerIdRef.current);
    claimedPointerIdRef.current = null;
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Space') spacePressedRef.current = true;
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space') spacePressedRef.current = false;
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  const { isPointerDownValid, isPointerMoveValid, isPointerUpValid, getLocalCoords, isMouseDown } = usePointerPosition({
    ref: containerRef,
    imageSize: totalSize,
  });

  const flushDrawingFrame = () => {
    frameRequested.current = null;

    const ctx = overlayCtxRef.current!;
    ctx.clearRect(0, 0, toolOverlayRef.current!.width, toolOverlayRef.current!.height); // todo you can clear smaller shape

    const shape = { start: startRef.current!, end: endRef.current! };
    const newArgs = { ...args, ...shape };
    // `setShapeCtx` writes stroke, fill, alpha and the dash onto the SHARED overlay context and
    // leaves them, so the bracket is what stops this tool from dictating the alpha every later tool
    // paints at. It cannot live inside `setShapeCtx`: `drawShape` reads what it wrote, and this
    // runs once per frame. See `DrawToolArea.flushDrawingFrame` for the same bracket.
    ctx.save();
    try {
      setShapeCtx(ctx, newArgs);
      drawShape(ctx, newArgs);
    } finally {
      ctx.restore();
    }
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!isPointerDownValid(event)) return;

    if (!overlayCtxRef.current) return;

    // The shape commits from `handlePointerUp`, so the press-to-release window is exactly the window
    // a document-mutating shortcut would corrupt: an undo there replaces `selections` from the SAME
    // history array, so `history.length` never moves and the pending commit's
    // `entries.slice(0, cursor + 1)` truncates the redo tail with no other symptom. Claimed after
    // `isPointerDownValid`, so a refused press claims nothing, and only when the claim succeeded, so
    // a loser never records an id it does not own.
    if (claimDocumentGesture('shape-draw', event.pointerId)) {
      claimedPointerIdRef.current = event.pointerId;
    }

    const point = getLocalCoords(event);
    startRef.current = point;
    endRef.current = point;
    anchorRef.current = point;
    fromCenterRef.current = event.altKey;
    lastPointRef.current = point;
    originalShapeRef.current = null;
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!isMouseDown.current || !isPointerMoveValid(event)) return;

    const point = getLocalCoords(event);
    if (spacePressedRef.current && lastPointRef.current && originalShapeRef.current) {
      const dx = point.x - lastPointRef.current.x;
      const dy = point.y - lastPointRef.current.y;
      startRef.current = { x: startRef.current!.x + dx, y: startRef.current!.y + dy };
      endRef.current = { x: endRef.current!.x + dx, y: endRef.current!.y + dy };
    } else {
      const shape = normalizeShapeGeometry(anchorRef.current!, point, args.figure, {
        shiftKey: event.shiftKey,
        altKey: fromCenterRef.current,
      });
      startRef.current = shape.start;
      endRef.current = shape.end;
      originalShapeRef.current = shape;
    }
    lastPointRef.current = point;

    if (frameRequested.current !== null) return;

    frameRequested.current = requestAnimationFrame(flushDrawingFrame);
  };

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (!isPointerUpValid(event)) return;

    // First, and inside the branch: a release the validator refuses — a foreign pointer — must not
    // hand the document back on the first pointer's behalf, and this runs before every early return
    // in the commit path below, the dismissed size prompt among them.
    releaseDocumentClaim();

    const point = getLocalCoords(event);
    // Re-derive the geometry only when there is NO preview to commit — a bare press-and-release
    // with no move, which would otherwise commit a zero-size shape and prompt for a size.
    //
    // The old gate was `if (!movedBySpace)`, which conflated "the user space-panned" with "every
    // ordinary drag", because `startRef` only leaves `anchorRef` when a pan has moved it. So for an
    // ordinary previewed drag the recompute ran and overwrote the previewed `startRef`/`endRef`
    // with the RELEASE event's `event.shiftKey`: releasing Shift before the mouse committed an
    // unconstrained rectangle for a square the user watched being previewed, and the committed
    // layer is the one that lands.
    if (originalShapeRef.current === null) {
      const shape = normalizeShapeGeometry(anchorRef.current!, point, args.figure, {
        shiftKey: event.shiftKey,
        altKey: fromCenterRef.current,
      });
      startRef.current = shape.start;
      endRef.current = shape.end;
    }

    // Cancel AND null, and then paint what the cancelled frame would have painted. Cancelling
    // without nulling left `frameRequested` non-null for the component's lifetime, and
    // `handlePointerMove` short-circuits on exactly that, so every drag after the first showed
    // nothing until release.
    if (frameRequested.current !== null) {
      cancelAnimationFrame(frameRequested.current);
      frameRequested.current = null;
      flushDrawingFrame();
    }

    const start = canvasToDocumentPoint({ ...startRef.current! }, documentFrame);
    const end = canvasToDocumentPoint({ ...endRef.current! }, documentFrame);

    // A click with no drag has no size, and Adobe answers that with the `Create <Figure>`
    // dialog rather than a drag or a refusal: "Click on the canvas to bring up the Create
    // Rectangle dialog" (https://helpx.adobe.com/photoshop/using/modify-shapes.html). The
    // dialog owns the geometry from here, so this path commits nothing itself.
    //
    // The Line tool is the exception and is excluded by contract, not by judgement: Adobe
    // documents drag-and-release only for it and never names a Create Line dialog
    // (https://helpx.adobe.com/photoshop/using/tool-techniques/line-tool.html), so a click
    // with the Line tool still refuses rather than inventing a dialog Adobe has not got.
    if (start.x === end.x && start.y === end.y) {
      if (args.figure !== 'line') setPendingShape({ anchor: start, fromCenter: fromCenterRef.current });
      else console.error('The Line tool needs a drag: a click with no movement has no length to draw');
      return;
    }

    commitShape(start, end);
  };

  /**
   * The one commit path, shared by the drag and by the dialog's OK.
   *
   * Both routes produce a document-space `start`/`end` and nothing else, so the padding, the
   * rebase into layer space and the commit cannot drift between them. `cornerRadius` is
   * applied to the ARGS the layer is created from, not to the tool's own settings: the
   * dialog's radius describes the shape it is about to create, and committing it into
   * `args` would silently rewrite the bar's Radius slider behind the user's back.
   */
  const commitShape = (start: Point, end: Point, cornerRadius?: number) => {
    const pos = shapeGeometryBounds({ start, end }, args.lineWidth);

    start.x -= pos.x;
    start.y -= pos.y;
    end.x -= pos.x;
    end.y -= pos.y;
    const newArgs = { ...args, ...(cornerRadius === undefined ? {} : { cornerRadius }), start, end };

    const fullArgs: FullArgs = {
      args: newArgs,
      pos: pos,
    };
    createLayerFromTool(fullArgs);
  };

  const handleDialogCreate = ({ width, height, fromCenter, cornerRadius }: CreateShapeParams) => {
    if (!pendingShape) return;
    const { anchor } = pendingShape;

    // Adobe's From Center is the drag's Alt/Option, applied to a size the dialog supplied.
    // The anchor is the midpoint in that mode and the corner otherwise — the same two
    // geometries `normalizeShapeGeometry` produces for `altKey` true and false, written out
    // here because the dialog's size is not a pointer position to normalize against.
    const start = fromCenter ? { x: anchor.x - width / 2, y: anchor.y - height / 2 } : { ...anchor };
    const end = fromCenter
      ? { x: anchor.x + width / 2, y: anchor.y + height / 2 }
      : { x: anchor.x + width, y: anchor.y + height };

    commitShape(start, end, cornerRadius);
  };

  const handlePointerCancel = () => {
    // Paired with the abort the hook already performs: a cancel is a gesture that will never commit,
    // so a claim left open here would gate every later keystroke for a shape that does not exist.
    releaseDocumentClaim();
  };

  useEffect(() => {
    // Captured in the BODY, not read in the cleanup: React detaches refs in the mutation phase,
    // before passive destroys run, so `overlayCtxRef.current` is already null by the time this
    // returns.
    const ctx = overlayCtxRef.current;

    return () => {
      // An unmount between claim and commit is an abort like any other — switching tools mid-drag is
      // exactly how it happens. Paired with the provider-level `resetDocumentGestures`, this is what
      // bounds a leaked claim to the mount that leaked it.
      releaseDocumentClaim();

      // Cancel FIRST, then clear. A frame still queued for the batched `flushDrawingFrame` would
      // otherwise repaint after the clear below and resurrect the preview.
      if (frameRequested.current !== null) {
        cancelAnimationFrame(frameRequested.current);
        frameRequested.current = null;
      }

      // This area never clears the overlay on pointer up at all: `handlePointerUp`'s last
      // `flushDrawingFrame` REDRAWS the shape and the commit at :200 leaves it there, so the
      // teardown below is the only thing that ever removes it. The overlay canvas is shared,
      // long-lived and only ever `display`-toggled (`Main.tsx:239-284`), which never touches a
      // backing store, so without it the preview stays painted over the next tool's document — and
      // over this one, for as long as the shape tool stays selected. Safe for the reason it is safe
      // in `useRect` and `DrawToolArea`: exactly one tool area is mounted at a time, and React runs
      // passive destroys before passive creates, so an outgoing area's cleanup cannot wipe the
      // incoming area's mount paint. The size is read off `ctx.canvas` at call time rather than off
      // `totalSize` for the same reason as in `useRect`: a render-scope size frozen into this
      // cleanup under-clears after a document resize.
      if (ctx) {
        ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      }
    };
  }, [overlayCtxRef]);

  /**
   * The figure the dialog may open for, and `null` for the Line.
   *
   * Typed rather than inferred from the boolean, so the render below cannot widen it back to
   * `FigureType`: a separate `openDialog` flag would leave `args.figure` un-narrowed at the
   * prop, which is exactly the hole a `figure !== 'line'` test elsewhere in the file could
   * fall through.
   */
  const dialogFigure: CreateShapeFigure | null = args.figure === 'line' ? null : args.figure;

  return (
    <>
      <div
        className={`${className} cursor-draw`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
      ></div>
      {/* PORTALLED to `document.body`, and that is load-bearing rather than stylistic. The
      div above carries the pointer handlers, so a `fixed inset-0` panel rendered inside it
      would make every click in the dialog — the backdrop and the OK button included — hit
`handlePointerDown` and `handlePointerUp` on the way up, claiming the document gesture and
      committing a shape per click. `useDialogFocusContainment` stops KEY propagation and
      nothing else. The precedent for escaping a component's own DOM is the same
      `createPortal(..., document.body)` that `FeatherMagneticLasso.tsx:213` and
      `FontSelect.tsx:181` use.

      The fragment keeps the tool area's own root a single childless div, which is the shape
      every other tool area in `src/components/Main/` has and what
      `ShapeToolArea.test.tsx:224` reads `firstElementChild.className` off.

      `args.figure !== 'line'` is repeated here as well as at the call site, because this is
the render and the figure can change under an open dialog: the dialog's own prop type
      excludes Line, and a stale `pendingShape` must not render a dialog for a figure Adobe
      has no click dialog for. */}
      {pendingShape !== null &&
        dialogFigure !== null &&
        createPortal(
          <CreateShapeDialog
            figure={dialogFigure}
            cornerRadius={args.cornerRadius}
            initialFromCenter={pendingShape.fromCenter}
            onClose={() => setPendingShape(null)}
            onCreate={handleDialogCreate}
          />,
          document.body
        )}
    </>
  );
};
