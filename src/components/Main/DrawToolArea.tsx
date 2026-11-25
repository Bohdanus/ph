import { type PointerEvent, type RefObject, useEffect, useRef } from 'react';
import {
  capturePaintSelectionSnapshot,
  createSelectionMaskCanvas,
  paintSelectionOverlapsRaster,
  rebasePaintSelectionSnapshot,
  type DrawToolArgs,
  type PaintSelectionSnapshot,
  setupDrawCtx,
} from '../../tools/draw.ts';
import { usePointerPosition } from '../../hooks/usePointerPosition.ts';
import { claimDocumentGesture, releaseDocumentGesture } from '../../hooks/document-gesture.ts';
import { useStore } from '../../contexts/StoreContext.tsx';
import { useLayers } from '../../contexts/useLayer.ts';
import { useCurrentTool } from '../../contexts/useCurrentTool.tsx';
import { drawLine, pointsBoundingPosOutward } from '../../util/draw.ts';
import type { Point } from '../../contexts/general-types.ts';
import type { FullArgs } from '../../contexts/tool-types.ts';
import { canvasToDocumentPoint, documentFrameFromSize } from '../../contexts/document-frame.ts';
import { clearCanvasBackingStore } from '../../util/canvas.ts';
import { getActiveSelection } from '../../util/selection.ts';

const SELECTION_MASK_TILE_SIZE = 256;

type DrawHandlerProps = {
  className?: string;
  overlayCtxRef: RefObject<CanvasRenderingContext2D | null>;
};

export const DrawToolArea = ({ className, overlayCtxRef }: DrawHandlerProps) => {
  const [{ containerRef, totalSize, documentFrame: currentFrame, selections, activeSelectionId }] = useStore();
  const documentFrame = currentFrame ?? documentFrameFromSize(totalSize);
  const { createLayerFromTool } = useLayers();
  const { toolArgs } = useCurrentTool();

  const args = toolArgs as DrawToolArgs;
  const isPaintTool = toolArgs.toolName === 'brush' || toolArgs.toolName === 'pencil';
  const pointsRef = useRef<Point[]>([]);
  const pointTimesRef = useRef<number[]>([]);
  const currentPointRef = useRef<Point | null>(null);
  const sprayStartedAtRef = useRef<number | null>(null);
  const sprayStrokeActiveRef = useRef(false);
  const frameRequested = useRef<number | null>(null);
  const strokeSelectionRef = useRef<PaintSelectionSnapshot | null>(null);
  const selectionMaskTilesRef = useRef<Map<string, OffscreenCanvas>>(new Map());
  /**
   * The pointer id this component's own claim was taken with. The cancel handler and the unmount
   * cleanup never see a pointer event, so the id is kept here for every release route to name the
   * claim it is releasing.
   */
  const claimedPointerIdRef = useRef<number | null>(null);

  const { isPointerDownValid, isPointerMoveValid, isPointerUpValid, getLocalCoords, isMouseDown, releasePointer } =
    usePointerPosition({
      ref: containerRef,
      imageSize: totalSize,
    });

  const appendSpraySample = (point: Point, time: number) => {
    const startedAt = sprayStartedAtRef.current;
    if (startedAt === null) return;

    // Preserve the initial dab, then extend one stationary endpoint so held Flow accrues without
    // storing a point for every animation frame.
    const elapsed = Math.max(pointTimesRef.current[pointTimesRef.current.length - 1] ?? 0, time - startedAt);
    const points = pointsRef.current;
    const lastPoint = points[points.length - 1];
    if (!lastPoint || lastPoint.x !== point.x || lastPoint.y !== point.y) {
      points.push(point);
      pointTimesRef.current.push(elapsed);
    } else if (points.length === 1 && elapsed > (pointTimesRef.current[0] ?? 0)) {
      points.push(point);
      pointTimesRef.current.push(elapsed);
    } else if (points.length > 1) {
      pointTimesRef.current[pointTimesRef.current.length - 1] = elapsed;
    }
  };

  const getSelectionMaskTile = (
    selection: PaintSelectionSnapshot,
    tileX: number,
    tileY: number
  ): OffscreenCanvas => {
    const key = `${tileX}:${tileY}`;
    const cached = selectionMaskTilesRef.current.get(key);
    if (cached) return cached;

    const tileSize = {
      width: Math.min(SELECTION_MASK_TILE_SIZE, totalSize.width - tileX),
      height: Math.min(SELECTION_MASK_TILE_SIZE, totalSize.height - tileY),
    };
    const documentOrigin = canvasToDocumentPoint({ x: tileX, y: tileY }, documentFrame);
    const snapshot = rebasePaintSelectionSnapshot(selection, documentOrigin);
    const canvas = createSelectionMaskCanvas(snapshot, tileSize);
    selectionMaskTilesRef.current.set(key, canvas);
    return canvas;
  };

  const clipPreviewToSelection = (ctx: CanvasRenderingContext2D) => {
    const selection = strokeSelectionRef.current;
    if (!isPaintTool || !selection || pointsRef.current.length === 0) return;

    const bounds = pointsBoundingPosOutward({ points: pointsRef.current, lineWidth: args.lineWidth });
    const left = Math.max(0, Math.floor(bounds.x));
    const top = Math.max(0, Math.floor(bounds.y));
    const right = Math.min(totalSize.width, Math.ceil(bounds.x + bounds.width));
    const bottom = Math.min(totalSize.height, Math.ceil(bounds.y + bounds.height));
    if (right <= left || bottom <= top) {
      clearCanvasBackingStore(ctx);
      return;
    }

    const firstTileX = Math.floor(left / SELECTION_MASK_TILE_SIZE) * SELECTION_MASK_TILE_SIZE;
    const firstTileY = Math.floor(top / SELECTION_MASK_TILE_SIZE) * SELECTION_MASK_TILE_SIZE;
    for (let tileY = firstTileY; tileY < bottom; tileY += SELECTION_MASK_TILE_SIZE) {
      for (let tileX = firstTileX; tileX < right; tileX += SELECTION_MASK_TILE_SIZE) {
        const tile = getSelectionMaskTile(selection, tileX, tileY);
        ctx.save();
        try {
          // Porter-Duff destination-in is unbounded: without this clip each tile draw would
          // clear destination pixels outside its own rectangle and erase prior tiles.
          ctx.beginPath();
          ctx.rect(tileX, tileY, tile.width, tile.height);
          ctx.clip();
          ctx.globalCompositeOperation = 'destination-in';
          ctx.globalAlpha = 1;
          ctx.drawImage(tile, tileX, tileY);
        } finally {
          ctx.restore();
        }
      }
    }
  };

  // One stroke, one bracket, one repaint. `drawLine` re-strokes the whole accumulated path on
  // every call, so the repaint is coalesced into a single animation frame exactly as
  // `ShapeToolArea`/`useRect` already do: a pointer that carries several moves per display
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
  const flushDrawingFrame = (frameTime?: number) => {
    frameRequested.current = null;

    if (frameTime !== undefined && sprayStrokeActiveRef.current && currentPointRef.current) {
      appendSpraySample(currentPointRef.current, frameTime);
    }

    const ctx = overlayCtxRef.current;
    if (!ctx) return;

    clearCanvasBackingStore(ctx);

    const drawArgs = {
      ...args,
      points: pointsRef.current,
      ...(args.penType === 'spray' ? { pointTimes: pointTimesRef.current } : {}),
    };
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
    clipPreviewToSelection(ctx);

    if (sprayStrokeActiveRef.current) {
      frameRequested.current = requestAnimationFrame(flushDrawingFrame);
    }
  };

  function releaseDocumentClaim() {
    releaseDocumentGesture('brush-stroke', claimedPointerIdRef.current);
    claimedPointerIdRef.current = null;
  }

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!overlayCtxRef.current) return;
    if (!isPointerDownValid(event)) return;

    // The stroke commits from `handlePointerUp`, so the press-to-release window is exactly the
    // window a document-mutating shortcut would corrupt: an undo there replaces `selections` from
    // the SAME history array, so `history.length` never moves and the pending commit's
    // `entries.slice(0, cursor + 1)` truncates the redo tail with no other symptom. Claimed after
    // `isPointerDownValid`, so a refused press claims nothing, and only when the claim succeeded, so
    // a loser never records an id it does not own.
    if (!claimDocumentGesture('brush-stroke', event.pointerId)) {
      releasePointer();
      return;
    }
    claimedPointerIdRef.current = event.pointerId;

    const activeSelection = isPaintTool
      ? getActiveSelection(selections ?? [], activeSelectionId ?? null)
      : null;
    strokeSelectionRef.current = activeSelection ? capturePaintSelectionSnapshot(activeSelection) : null;
    selectionMaskTilesRef.current.clear();

    const point = getLocalCoords(event);
    pointsRef.current = [point];
    currentPointRef.current = point;
    pointTimesRef.current = args.penType === 'spray' ? [0] : [];
    sprayStartedAtRef.current = args.penType === 'spray' ? performance.now() : null;
    sprayStrokeActiveRef.current = args.penType === 'spray';

    // Synchronous, deliberately: this is the only paint a single-point stroke gets, and waiting
    // for a frame would leave a click with no visible mark until the pointer moved again.
    flushDrawingFrame();
    if (sprayStrokeActiveRef.current && frameRequested.current === null) {
      frameRequested.current = requestAnimationFrame(flushDrawingFrame);
    }
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!isMouseDown.current || !isPointerMoveValid(event)) return;

    const point = getLocalCoords(event);
    currentPointRef.current = point;
    if (sprayStrokeActiveRef.current) appendSpraySample(point, performance.now());
    else pointsRef.current.push(point);

    if (frameRequested.current !== null) return;

    frameRequested.current = requestAnimationFrame(flushDrawingFrame);
  };

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (!isPointerUpValid(event)) return;

    // First, and inside the branch: a release the validator refuses — a foreign pointer — must not
    // hand the document back on the first pointer's behalf, and this runs before every early return
    // in the commit path below.
    releaseDocumentClaim();
    const wasSpray = sprayStrokeActiveRef.current;
    sprayStrokeActiveRef.current = false;

    // Cancel AND null, as `useRect` does. Nulling alone would leave `frameRequested`
    // permanently non-null and every later drag's preview silently dropped; cancelling alone would
    // drop the last preview, because the frame that would have painted the final point is the one
    // being cancelled.
    if (frameRequested.current !== null) {
      cancelAnimationFrame(frameRequested.current);
      flushDrawingFrame();
    }

    const coords = getLocalCoords(event);
    currentPointRef.current = coords;
    const lastPoint = pointsRef.current[pointsRef.current.length - 1];
    if (wasSpray) {
      appendSpraySample(coords, performance.now());
    } else if (!lastPoint || lastPoint.x !== coords.x || lastPoint.y !== coords.y) {
      pointsRef.current.push(coords);
    }

    const oldPoints = pointsRef.current.map((point) => canvasToDocumentPoint(point, documentFrame));
    const pos = pointsBoundingPosOutward({ points: oldPoints, lineWidth: args.lineWidth });
    const newPoints = oldPoints.map((point) => ({ x: point.x - pos.x, y: point.y - pos.y }));
    const capturedSelection = isPaintTool ? strokeSelectionRef.current : null;
    const selection = capturedSelection
      ? rebasePaintSelectionSnapshot(capturedSelection, pos)
      : undefined;

    if (selection && !paintSelectionOverlapsRaster(selection, { width: pos.width, height: pos.height })) {
      pointsRef.current = [];
      pointTimesRef.current = [];
      currentPointRef.current = null;
      sprayStartedAtRef.current = null;
      strokeSelectionRef.current = null;
      selectionMaskTilesRef.current.clear();
      if (overlayCtxRef.current) clearCanvasBackingStore(overlayCtxRef.current);
      return;
    }

    const finalArgs = {
      ...toolArgs,
      points: newPoints,
      ...(wasSpray ? { pointTimes: [...pointTimesRef.current] } : {}),
      ...(selection ? { selection } : {}),
    } as FullArgs['args'];
    const fullArgs: FullArgs = {
      args: finalArgs,
      pos,
    };

    createLayerFromTool(fullArgs);

    pointsRef.current = [];
    pointTimesRef.current = [];
    currentPointRef.current = null;
    sprayStartedAtRef.current = null;
    strokeSelectionRef.current = null;
    selectionMaskTilesRef.current.clear();
    if (overlayCtxRef.current) clearCanvasBackingStore(overlayCtxRef.current);
  };

  const handlePointerCancel = (event: PointerEvent<HTMLDivElement>) => {
    // Cancellation belongs to one pointer stream. A second pointer can cancel while this stroke
    // still owns the document, so only the pointer that opened this claim may abort its preview.
    if (claimedPointerIdRef.current !== event.pointerId) return;

    releasePointer();
    releaseDocumentClaim();
    sprayStrokeActiveRef.current = false;
    if (frameRequested.current !== null) {
      cancelAnimationFrame(frameRequested.current);
      frameRequested.current = null;
    }
    pointsRef.current = [];
    pointTimesRef.current = [];
    currentPointRef.current = null;
    sprayStartedAtRef.current = null;
    strokeSelectionRef.current = null;
    selectionMaskTilesRef.current.clear();
    if (overlayCtxRef.current) clearCanvasBackingStore(overlayCtxRef.current);
  };

  useEffect(() => {
    // Captured in the BODY, not read in the cleanup: React detaches refs in the mutation phase,
    // before passive destroys run, so `overlayCtxRef.current` is already null by the time this
    // returns.
    const ctx = overlayCtxRef.current;

    return () => {
      // Cancel FIRST, then clear the captured stroke state: a frame still queued for
      // `flushDrawingFrame` would otherwise repaint the stroke AFTER the clear and resurrect it.
      // Cancel AND null, as the pointer-up route does, so nothing is left believing a frame is pending.
      if (frameRequested.current !== null) {
        cancelAnimationFrame(frameRequested.current);
        frameRequested.current = null;
      }

      // An unmount between claim and commit is an abort like any other. Paired with the provider-level
      // `resetDocumentGestures`, this is what bounds a leaked claim to the mount that leaked it.
      releaseDocumentClaim();
      sprayStrokeActiveRef.current = false;
      strokeSelectionRef.current = null;
      selectionMaskTilesRef.current.clear();

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
        clearCanvasBackingStore(ctx);
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
