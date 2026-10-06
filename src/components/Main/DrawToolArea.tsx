import { type PointerEvent, type RefObject, useEffect, useRef } from 'react';
import { type DrawToolArgs, setupDrawCtx } from '../../tools/draw.ts';
import { usePointerPosition } from '../../hooks/usePointerPosition.ts';
import { claimDocumentGesture, releaseDocumentGesture } from '../../hooks/document-gesture.ts';
import { useStore } from '../../contexts/StoreContext.tsx';
import { useLayers } from '../../contexts/useLayer.ts';
import { useCurrentTool } from '../../contexts/useCurrentTool.tsx';
import { drawLine, pointsBoundingPosOutward } from '../../util/draw.ts';
import type { Point } from '../../contexts/general-types.ts';
import type { FullArgs } from '../../contexts/tool-types.ts';
import { canvasToDocumentPoint, documentFrameFromSize } from '../../contexts/document-frame.ts';

type DrawHandlerProps = {
  className?: string;
  overlayCtxRef: RefObject<CanvasRenderingContext2D | null>;
};

export const DrawToolArea = ({ className, overlayCtxRef }: DrawHandlerProps) => {
  const [{ containerRef, totalSize, documentFrame: currentFrame }] = useStore();
  const documentFrame = currentFrame ?? documentFrameFromSize(totalSize);
  const { createLayerFromTool } = useLayers();
  const { toolArgs } = useCurrentTool();

  const args = toolArgs as DrawToolArgs;
  const pointsRef = useRef<Point[]>([]);
  const frameRequested = useRef<number | null>(null);
  /**
   * The pointer id this component's own claim was taken with. The cancel handler and the unmount
   * cleanup never see a pointer event, so the id is kept here for every release route to name the
   * claim it is releasing.
   */
  const claimedPointerIdRef = useRef<number | null>(null);

  const { isPointerDownValid, isPointerMoveValid, isPointerUpValid, getLocalCoords, isMouseDown } = usePointerPosition({
    ref: containerRef,
    imageSize: totalSize,
  });

  // One stroke, one bracket, one repaint. `drawLine` re-strokes the whole accumulated path on
  // every call, so the repaint is coalesced into a single animation frame exactly as
  // `ShapeToolArea`/`useDrag`/`useRect` already do: a pointer that carries several moves per display
  // frame otherwise repaints several times for one visible frame, and each repaint costs more than
  // the last.
  //
  // The `save()`/`restore()` around `setupDrawCtx` is not optional decoration. The tool overlay is
  // ONE 2D context for the whole session that every tool area is handed, `setupDrawCtx` writes
  // `globalAlpha` (and the composite operator) and leaves them, and the brush default is 0.9 — so
  // an unbracketed writer leaves the next tool painting at the previous tool's alpha. It cannot
  // live inside `setupDrawCtx` itself: `drawLine` reads what it wrote, and this function is called
  // once per frame against one context. Bracketing per paint also means no save level can outlive
  // the gesture, whatever happens to the pointer.
  const flushDrawingFrame = () => {
    frameRequested.current = null;

    const ctx = overlayCtxRef.current;
    if (!ctx) return;

    ctx.clearRect(0, 0, totalSize.width, totalSize.height);

    const drawArgs = { ...args, points: pointsRef.current };
    ctx.save();
    try {
      setupDrawCtx(ctx, drawArgs);
      drawLine({
        args: drawArgs,
        ctx,
      });
    } finally {
      ctx.restore();
    }
  };

  function releaseDocumentClaim() {
    releaseDocumentGesture('brush-stroke', claimedPointerIdRef.current);
    claimedPointerIdRef.current = null;
  }

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!isPointerDownValid(event)) return;

    if (!overlayCtxRef.current) return;

    // The stroke commits from `handlePointerUp`, so the press-to-release window is exactly the
    // window a document-mutating shortcut would corrupt: an undo there replaces `selections` from
    // the SAME history array, so `history.length` never moves and the pending commit's
    // `entries.slice(0, cursor + 1)` truncates the redo tail with no other symptom. Claimed after
    // `isPointerDownValid`, so a refused press claims nothing, and only when the claim succeeded, so
    // a loser never records an id it does not own.
    if (claimDocumentGesture('brush-stroke', event.pointerId)) {
      claimedPointerIdRef.current = event.pointerId;
    }

    pointsRef.current = [getLocalCoords(event)];

    // Synchronous, deliberately: this is the only paint a single-point stroke gets, and waiting
    // for a frame would leave a click with no visible mark until the pointer moved again.
    flushDrawingFrame();
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!isMouseDown.current || !isPointerMoveValid(event)) return;

    pointsRef.current.push(getLocalCoords(event));

    if (frameRequested.current !== null) return;

    frameRequested.current = requestAnimationFrame(flushDrawingFrame);
  };

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (!isPointerUpValid(event)) return;

    // First, and inside the branch: a release the validator refuses — a foreign pointer — must not
    // hand the document back on the first pointer's behalf, and this runs before every early return
    // in the commit path below.
    releaseDocumentClaim();

    // Cancel AND null, as `useDrag`/`useRect` do. Nulling alone would leave `frameRequested`
    // permanently non-null and every later drag's preview silently dropped; cancelling alone would
    // drop the last preview, because the frame that would have painted the final point is the one
    // being cancelled.
    if (frameRequested.current !== null) {
      cancelAnimationFrame(frameRequested.current);
      flushDrawingFrame();
    }

    const coords = getLocalCoords(event);
    const lastPoint = pointsRef.current[pointsRef.current.length - 1];
    if (!lastPoint || lastPoint.x !== coords.x || lastPoint.y !== coords.y) {
      pointsRef.current.push(coords);
    }

    const oldPoints = pointsRef.current.map((point) => canvasToDocumentPoint(point, documentFrame));
    const pos = pointsBoundingPosOutward({ points: oldPoints, lineWidth: args.lineWidth });
    const newPoints = oldPoints.map((point) => ({ x: point.x - pos.x, y: point.y - pos.y }));

    const finalArgs = { ...args, points: newPoints };
    const fullArgs: FullArgs = {
      args: finalArgs,
      pos,
    };

    createLayerFromTool(fullArgs);

    pointsRef.current = [];
    overlayCtxRef.current?.clearRect(0, 0, totalSize.width, totalSize.height);
  };

  const handlePointerCancel = () => {
    // Paired with the abort the hook already performs: a cancel is a gesture that will never commit,
    // so a claim left open here would gate every later keystroke for a stroke that does not exist.
    releaseDocumentClaim();
  };

  useEffect(() => {
    // Captured in the BODY, not read in the cleanup: React detaches refs in the mutation phase,
    // before passive destroys run, so `overlayCtxRef.current` is already null by the time this
    // returns.
    const ctx = overlayCtxRef.current;

    return () => {
      // An unmount between claim and commit is an abort like any other. Paired with the provider-level
      // `resetDocumentGestures`, this is what bounds a leaked claim to the mount that leaked it.
      releaseDocumentClaim();

      // Cancel FIRST, then clear: a frame still queued for `flushDrawingFrame` would otherwise
      // repaint the stroke AFTER the clear and resurrect it. Cancel AND null, as the pointer-up
      // route does, so nothing is left believing a frame is pending.
      if (frameRequested.current !== null) {
        cancelAnimationFrame(frameRequested.current);
        frameRequested.current = null;
      }

      // The overlay canvas is shared, long-lived and only ever `display`-toggled
      // (`Main.tsx:239-284`), which never touches a backing store, and the pointer-up clear at :146
      // never runs for a gesture the user abandoned by switching tools — which is the ordinary way a
      // stroke ends. Without this the last previewed stroke stays painted over the next tool's
      // document. Safe for the reason it is safe in `useRect` and `MagicWandToolArea`: exactly one
      // tool area is mounted at a time, and React runs passive destroys before passive creates, so
      // an outgoing area's cleanup cannot wipe the incoming area's mount paint. The size is read off
      // `ctx.canvas` at call time rather than off `totalSize` for the same reason as in `useRect`:
      // a render-scope size frozen into this cleanup under-clears after a document resize.
      if (ctx) {
        ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      }
    };
  }, [overlayCtxRef]);

  return (
    <div
      className={`${className} cursor-draw`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
    />
  );
};
