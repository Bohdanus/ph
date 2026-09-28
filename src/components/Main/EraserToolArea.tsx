import { type PointerEvent, useEffect, useRef } from 'react';
import { type EraserToolArgs } from '../../tools/eraser.ts';
import { usePointerPosition } from '../../hooks/usePointerPosition.ts';
import { claimDocumentGesture, releaseDocumentGesture } from '../../hooks/document-gesture.ts';
import { useStore } from '../../contexts/StoreContext.tsx';
import { useLayers } from '../../contexts/useLayer.ts';
import { useCurrentTool } from '../../contexts/useCurrentTool.tsx';
import type { Point } from '../../contexts/general-types.ts';
import { canvasToDocumentPoint, documentFrameFromSize } from '../../contexts/document-frame.ts';

type EraserToolAreaProps = {
  className?: string;
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
 * The preview goes through `tempUpdateLayer`, the sanctioned live-pixel writer, and NOT through the
 * shared overlay canvas. The overlay starts every frame empty and transparent, and
 * `destination-out` computes `da' = da * (1 - sa)`; with `da = 0` that is `0` for every pixel, so an
 * overlay preview is arithmetically incapable of drawing anything and the stroke only appeared on
 * pointer-up. That shipped, and no assertion on `globalCompositeOperation` could see it.
 * Previewing by mutating the layer makes the preview and the commit the same operation, which is
 * why they cannot drift.
 */
export const EraserToolArea = ({ className }: EraserToolAreaProps) => {
  const [{ containerRef, layers, activeLayerId, totalSize, documentFrame: currentFrame }] = useStore();
  const documentFrame = currentFrame ?? documentFrameFromSize(totalSize);
  const { updateLayerByTool, tempUpdateLayer } = useLayers();
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

  const activeLayer = activeLayerId ? layers[activeLayerId] : undefined;

  /**
   * A raster edit to the BEDROCK layer is wrong, not merely surprising: bedrock is the document's
   * own backing image — the floor every other layer composites over — and the Eraser is the one
   * tool whose whole job is to punch holes. Erasing it changes the colour of the transparent
   * regions the rest of the stack is judged against, and there is no layer left to restore it from.
   * `MoveToolArea.tsx:35` reads the same flag for the same reason, as do the other raster tools.
   */
  const isEnabled = Boolean(activeLayerId && activeLayer && !activeLayer.isBedrock);

  /**
   * The processor addresses the LAYER's own raster, whose pixel (0, 0) is `activeLayer.pos`, so a
   * document point becomes `point - activeLayer.pos` and a layer at the origin passes through
   * unchanged. The same translation is applied to the preview and to the commit: a preview in canvas
   * space against a commit in layer space would show the stroke at one place and put it somewhere
   * else the moment the pointer came up.
   */
  const toLayerPoints = (points: Point[]): Point[] =>
    points.map((point) => {
      const document = canvasToDocumentPoint(point, documentFrame);
      return { x: document.x - activeLayer!.pos.x, y: document.y - activeLayer!.pos.y };
    });

  /**
   * One stroke, one write, coalesced into a single animation frame, so a fast drag does not run the
   * flood-and-write pipeline once per pointer event.
   *
   * The ACCUMULATED path is resent every time, not just the newest point: `commit: 'raster'`
   * REPLACES the layer's pixels with the canvas the processor returns, so sending one point would
   * erase one point.
   */
  const flushDrawingFrame = () => {
    frameRequested.current = null;
    if (!isEnabled || pointsRef.current.length === 0) return;

    tempUpdateLayer({
      id: activeLayerId!,
      toolArgs: { ...args, points: toLayerPoints(pointsRef.current) },
    });
  };

  function releaseDocumentClaim() {
    releaseDocumentGesture('eraser-stroke', claimedPointerIdRef.current);
    claimedPointerIdRef.current = null;
  }

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (args.toolName !== 'eraser') return;
    if (!isPointerDownValid(event)) return;

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

    // After the claim, deliberately. A press with no editable layer can still commit nothing, and
    // the release has to run its first statement on every path out of this handler — including
    // this one — or the claim taken above would be held until some unrelated gesture released it.
    if (!isEnabled) return;

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

    // `updateLayerByTool` takes no `pos`: `commit: 'raster'` REPLACES the layer's pixels with the
    // canvas the processor returns, which is the whole layer. Cropping the stroke to its bounding
    // box the way `DrawToolArea` does would therefore shrink the layer out from under the erase,
    // so the points are the layer's own local coordinates and nothing is cropped.
    if (isEnabled && pointsRef.current.length > 0) {
      // `id` is deliberately left to the hook's `= activeLayerId` default: the layer whose `pos`
      // the conversion above used is the one that must receive the edit.
      updateLayerByTool({ toolArgs: { ...args, points: toLayerPoints(pointsRef.current) } });
    }

    pointsRef.current = [];
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

      // A frame left pending across an unmount would write to a layer this component no longer
      // owns, so it is cancelled rather than left to run.
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
