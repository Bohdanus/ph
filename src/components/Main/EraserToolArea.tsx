import { type PointerEvent, type RefObject, useEffect, useRef } from 'react';
import { buildEraseArgs, type EraserToolArgs } from '../../tools/eraser.ts';
import { setupDrawCtx } from '../../tools/draw.ts';
import { usePointerPosition } from '../../hooks/usePointerPosition.ts';
import { claimDocumentGesture, releaseDocumentGesture } from '../../hooks/document-gesture.ts';
import { useStore } from '../../contexts/StoreContext.tsx';
import { useLayers } from '../../contexts/useLayer.ts';
import { useCurrentTool } from '../../contexts/useCurrentTool.tsx';
import { drawLine } from '../../util/draw.ts';
import type { Point } from '../../contexts/general-types.ts';
import { canvasToDocumentPoint, documentFrameFromSize } from '../../contexts/document-frame.ts';

type EraserToolAreaProps = {
  className?: string;
  overlayCtxRef: RefObject<CanvasRenderingContext2D | null>;
};

/**
 * The Eraser edits the ACTIVE layer; it never creates one.
 *
 * `DrawToolArea` commits through `createLayerFromTool`, which is right for a painting tool: a new
 * layer is the paint. It is wrong for the eraser, which subtracts alpha from the layer that is
 * already there. A "new layer holding a transparent hole" composites as nothing, so the tool would
 * be selectable, draggable, and visibly dead. `updateLayerByTool` is the ACTIVE-LAYER path, and it
 * is the one that produces exactly one `TOOL_ACTION` per call — which is what makes one history
 * state per stroke (per mouse-up) possible, rather than one per pointer move.
 *
 * The preview and the commit are kept from drifting by both going through `buildEraseArgs`, the
 * single place that turns `EraserToolArgs` into the shared painter's `DrawToolArgs`:
 * `setupDrawCtx` reads `composite` off it, and `drawLine` reads `blockStamp` off it
 * (`src/util/draw.ts:136`). Passing the raw `EraserToolArgs` to either would silently drop a flag —
 * `composite` would read as absent and the preview would paint instead of erasing.
 */
export const EraserToolArea = ({ className, overlayCtxRef }: EraserToolAreaProps) => {
  const [{ containerRef, layers, activeLayerId, totalSize, documentFrame: currentFrame }] = useStore();
  const documentFrame = currentFrame ?? documentFrameFromSize(totalSize);
  const { updateLayerByTool } = useLayers();
  const { toolArgs } = useCurrentTool();

  const args = toolArgs as EraserToolArgs;
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

  // One stroke, one bracket, one repaint, exactly as `DrawToolArea` does. The overlay repaint
  // re-strokes the whole accumulated path, so it is coalesced into a single animation frame rather
  // than run per pointer event.
  //
  // The `save()`/`restore()` is not optional decoration, and for this tool it is the sharper of
  // the two leaks: `setupDrawCtx` writes `globalCompositeOperation: 'destination-out'` and leaves
  // it, and the overlay context is ONE object for the whole session that every tool area is
  // handed. A later painter's `fillRect` / `fillText` / `stroke` — the crop dim, the selection
  // outline, the next tool's stroke — would then ERASE the overlay instead of drawing on it. The
  // bracket cannot live inside `setupDrawCtx`, because `drawLine` reads what it wrote and this runs
  // once per frame against one context; and it cannot be fixed by writing `globalAlpha = 1` at the
  // top of `setupDrawCtx`, because `eraser()` runs that function on a FRESH canvas at the slider's
  // alpha, where forcing 1 would flatten the committed layer.
  const flushDrawingFrame = () => {
    frameRequested.current = null;

    const ctx = overlayCtxRef.current;
    if (!ctx) return;

    ctx.clearRect(0, 0, totalSize.width, totalSize.height);

    // Overlay coordinates are canvas/image coordinates; the commit below converts to the active
    // layer's local space. Repainting the whole accumulated path is what makes `destination-out`
    // readable at all: erasing from the live overlay rather than accumulating into it is the only
    // way a repeated stamp of the same path does not punch through twice.
    //
    // Both eraser flags reach the overlay here, and only here. `setupDrawCtx` reads `composite` off
    // the args and `drawLine` reads `blockStamp` off it, so the preview subtracts alpha exactly as
    // the commit will.
    const drawArgs = buildEraseArgs({ ...args, points: pointsRef.current });
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
    releaseDocumentGesture('eraser-stroke', claimedPointerIdRef.current);
    claimedPointerIdRef.current = null;
  }

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (args.toolName !== 'eraser') return;
    if (!isPointerDownValid(event)) return;

    if (!overlayCtxRef.current) return;

    // The stroke commits from `handlePointerUp` through `updateLayerByTool`, so the
    // press-to-release window is exactly the window a document-mutating shortcut would
    // corrupt: an undo there replaces `selections` from the SAME history array, so
    // `history.length` never moves and the pending commit's
    // `entries.slice(0, cursor + 1)` truncates the redo tail with no other symptom.
    // Claimed after `isPointerDownValid`, so a refused press claims nothing, and only
    // when the claim succeeded, so a loser never records an id it does not own.
    if (claimDocumentGesture('eraser-stroke', event.pointerId)) {
      claimedPointerIdRef.current = event.pointerId;
    }

    pointsRef.current = [getLocalCoords(event)];

    // Synchronous, deliberately: this is the only paint a single-point stroke gets, and waiting for
    // a frame would leave a click with no visible mark until the pointer moved again.
    flushDrawingFrame();
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!isMouseDown.current || !isPointerMoveValid(event)) return;

    pointsRef.current.push(getLocalCoords(event));

    if (frameRequested.current !== null) return;

    frameRequested.current = requestAnimationFrame(flushDrawingFrame);
  };

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (args.toolName !== 'eraser') return;
    if (!isPointerUpValid(event)) return;

    // First, and inside the branch: a release the validator refuses — a foreign pointer — must not
    // hand the document back on the first pointer's behalf, and this runs before every early return
    // in the commit path below, the missing-active-layer one among them.
    releaseDocumentClaim();

    // Cancel AND null, as `useDrag`/`useRect` do. Nulling alone would leave `frameRequested`
    // permanently non-null and every later stroke's preview silently dropped; cancelling alone would
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

    const layer = activeLayerId ? layers[activeLayerId] : undefined;

    // `updateLayerByTool` takes no `pos`: `commit: 'raster'` REPLACES the layer's pixels with the
    // canvas the processor returns, which is the whole layer. Cropping the stroke to its bounding
    // box the way `DrawToolArea` does would therefore shrink the layer out from under the erase,
    // so the points are the layer's own local coordinates and nothing is cropped.
    if (layer) {
      const documentPoints = pointsRef.current.map((point) => canvasToDocumentPoint(point, documentFrame));
      const layerPoints = documentPoints.map((point) => ({ x: point.x - layer.pos.x, y: point.y - layer.pos.y }));

      // `id` is deliberately left to the hook's `= activeLayerId` default: the layer whose `pos`
      // the conversion above used is the one that must receive the edit.
      updateLayerByTool({ toolArgs: { ...args, points: layerPoints } });
    }

    pointsRef.current = [];
    overlayCtxRef.current?.clearRect(0, 0, totalSize.width, totalSize.height);
  };

  const handlePointerCancel = () => {
    // Paired with the abort the hook already performs: a cancel is a gesture that will never commit,
    // so a claim left open here would gate every later keystroke for a stroke that does not exist.
    releaseDocumentClaim();
  };

  useEffect(() => {
    // An unmount between claim and commit is an abort like any other. Paired with the provider-level
    // `resetDocumentGestures`, this is what bounds a leaked claim to the mount that leaked it.
    return () => {
      releaseDocumentClaim();

      // The frame this component queued repaints the session's ONE shared overlay context, so a
      // frame left pending across an unmount paints into an overlay nobody is drawing any more.
      // `ShapeToolArea` and `useRect` carry the same pre-existing gap; this is defence in depth.
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
    />
  );
};
