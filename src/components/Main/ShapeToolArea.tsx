import { type PointerEvent, type RefObject, useEffect, useRef } from 'react';
import { usePointerPosition } from '../../hooks/usePointerPosition.ts';
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
    // A click creates a precise shape, matching Photoshop's single-click workflow.
    if (start.x === end.x && start.y === end.y) {
      const width = Number(window.prompt('Width (px)', '100'));
      const height = Number(window.prompt('Height (px)', '100'));
      if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return;
      end.x += width;
      end.y += height;
    }

    const pos = shapeGeometryBounds({ start, end }, args.lineWidth);

    start.x -= pos.x;
    start.y -= pos.y;
    end.x -= pos.x;
    end.y -= pos.y;
    const newArgs = { ...args, start, end };

    const fullArgs: FullArgs = {
      args: newArgs,
      pos: pos,
    };
    createLayerFromTool(fullArgs);
  };

  const handlePointerCancel = () => {
    // Paired with the abort the hook already performs: a cancel is a gesture that will never commit,
    // so a claim left open here would gate every later keystroke for a shape that does not exist.
    releaseDocumentClaim();
  };

  useEffect(() => {
    // An unmount between claim and commit is an abort like any other — switching tools mid-drag is
    // exactly how it happens. Paired with the provider-level `resetDocumentGestures`, this is what
    // bounds a leaked claim to the mount that leaked it.
    return () => {
      releaseDocumentClaim();

      // A frame left pending across an unmount would paint into the overlay, which is ONE context
      // for the whole session and is handed to the next tool, so a shape from an area that no
      // longer owns it lands on the next tool's canvas. Cancelled and nulled, as `EraserToolArea`
      // does.
      if (frameRequested.current !== null) {
        cancelAnimationFrame(frameRequested.current);
        frameRequested.current = null;
      }
    };
  }, []);

  return (
    <div
      className={`${className} cursor-draw`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
    ></div>
  );
};
