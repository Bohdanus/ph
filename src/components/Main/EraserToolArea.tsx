import { type PointerEvent, useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { type EraserToolArgs } from '../../tools/eraser.ts';
import { usePointerPosition } from '../../hooks/usePointerPosition.ts';
import { claimDocumentGesture, releaseDocumentGesture } from '../../hooks/document-gesture.ts';
import { useStore } from '../../contexts/StoreContext.tsx';
import { useLayers } from '../../contexts/useLayer.ts';
import { useCurrentTool } from '../../contexts/useCurrentTool.tsx';
import type { Point } from '../../contexts/general-types.ts';
import { processorPresentationBounds } from '../../contexts/presentation-evaluator.ts';
import { canvasToDocumentPoint, documentFrameFromSize } from '../../contexts/document-frame.ts';
import { getActiveSelection, getSelectionProcessorSnapshot } from '../../util/selection.ts';

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
  const [
    { containerRef, layers, activeLayerId, totalSize, documentFrame: currentFrame, selections, activeSelectionId },
  ] = useStore();
  const documentFrame = currentFrame ?? documentFrameFromSize(totalSize);
  const { updateLayerByTool, tempUpdateLayer, cancelLayerPreview } = useLayers();
  const { toolArgs } = useCurrentTool();

  const args = toolArgs as EraserToolArgs;
  const pointsRef = useRef<Point[]>([]);
  const frameRequested = useRef<number | null>(null);
  /**
   * Where a Shift-clicked straight line would start, set by the last press that carried no Shift.
   *
   * Adobe's gesture is two clicks, not a constrained drag: "place the pointer where you want the
   * line to start, press and hold Shift, and then click where you want the line to end". So the
   * anchor is a press the user has already committed a stroke at, and the Shift-click is a second
   * stroke of its own — which is why it also produces a second undo step, exactly as in Photoshop.
   */
  const anchorRef = useRef<Point | null>(null);
  /**
   * Set while the Shift-click is being handled, so the drag that would otherwise start on the same
   * press, and the release that would otherwise commit its single point, both stand down. A ref
   * rather than the `pointsRef` length because the Shift-click CLEARS `pointsRef` on its way out,
   * and a release that then pushed a point back in would erase the end of the line a second time.
   */
  const lineCommittedRef = useRef(false);
  const selectionSnapshotRef = useRef<EraserToolArgs['selection']>(undefined);
  /**
   * The pointer id this component's own claim was taken with. The cancel handler and the unmount
   * cleanup never see a pointer event, so the id is kept here for every release route to name the
   * claim it is releasing.
   */
  const claimedPointerIdRef = useRef<number | null>(null);
  const anchorBeforeGestureRef = useRef<Point | null>(null);
  const previewLayerIdRef = useRef<typeof activeLayerId>(null);
  const gestureLayerIdRef = useRef<typeof activeLayerId>(null);
  const cancelLayerPreviewRef = useRef(cancelLayerPreview);
  useLayoutEffect(() => {
    cancelLayerPreviewRef.current = cancelLayerPreview;
  }, [cancelLayerPreview]);

  const { isPointerDownValid, isPointerMoveValid, isPointerUpValid, getLocalCoords, isMouseDown, releasePointer } =
    usePointerPosition({
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
   * The processor addresses the PRESENTED LAYER's own raster, whose pixel (0, 0) is the origin of
   * that presentation: `pos` for a layer that presents nothing, its EVALUATED extent for one
   * carrying a transform or a filter, since the processor is handed that presentation rather than
   * the raw layer. So a document point becomes `point - rasterBounds` and a layer at the origin
   * passes through unchanged. The same translation is applied to the preview and to the commit: a
   * preview in canvas space against a commit in layer space would show the stroke at one place and
   * put it somewhere else the moment the pointer came up.
   */
  const rasterBounds = activeLayer ? processorPresentationBounds(activeLayer) : { x: 0, y: 0 };

  const toLayerPoints = (points: Point[]): Point[] =>
    points.map((point) => {
      const document = canvasToDocumentPoint(point, documentFrame);
      return { x: document.x - rasterBounds.x, y: document.y - rasterBounds.y };
    });

  const snapshotSelection = (): EraserToolArgs['selection'] => {
    const activeSelection = getActiveSelection(selections ?? [], activeSelectionId ?? null);
    if (!activeSelection) return undefined;

    return {
      ...getSelectionProcessorSnapshot(activeSelection, rasterBounds),
      featherRadius: activeSelection.metadata?.featherRadius ?? 0,
      antiAlias: activeSelection.metadata?.magneticLasso?.antiAlias ?? true,
    };
  };

  const argsWithSelection = (points: Point[]) => ({
    ...args,
    points: toLayerPoints(points),
    ...(selectionSnapshotRef.current ? { selection: selectionSnapshotRef.current } : {}),
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
      toolArgs: argsWithSelection(pointsRef.current),
    });
  };

  const releaseDocumentClaim = useCallback(() => {
    releaseDocumentGesture('eraser-stroke', claimedPointerIdRef.current);
    claimedPointerIdRef.current = null;
  }, []);

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
    if (!claimDocumentGesture('eraser-stroke', event.pointerId)) {
      releasePointer();
      return;
    }
    claimedPointerIdRef.current = event.pointerId;
    gestureLayerIdRef.current = activeLayerId;
    anchorBeforeGestureRef.current = anchorRef.current ? { ...anchorRef.current } : null;
    previewLayerIdRef.current = null;

    // After the claim, deliberately. A press with no editable layer can still commit nothing, and
    // the release has to run its first statement on every path out of this handler — including
    // this one — or the claim taken above would be held until some unrelated gesture released it.
    if (!isEnabled) return;

    selectionSnapshotRef.current = snapshotSelection();

    const coords = getLocalCoords(event);

    // Shift-clicking an anchor is the END of a straight line, not the start of a drag. The commit
    // happens on the press rather than the release so the line appears under the cursor the
    // instant the user clicks, and so a press that is then abandoned has still committed the
    // stroke Photoshop would have committed.
    if (event.shiftKey && anchorRef.current) {
      const line = [anchorRef.current, coords];
      anchorRef.current = null;
      lineCommittedRef.current = true;
      pointsRef.current = [];
      updateLayerByTool({ toolArgs: argsWithSelection(line) });
      return;
    }

    anchorRef.current = coords;
    previewLayerIdRef.current = activeLayerId;
    pointsRef.current = [coords];

    // Synchronous, deliberately: this is the only paint a single-point stroke gets, and waiting for
    // a frame would leave a click with no visible mark until the pointer moved again.
    flushDrawingFrame();
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (lineCommittedRef.current) return;
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

    // Cancel AND null, as `useRect` does. Nulling alone would leave `frameRequested`
    // permanently non-null and every later stroke's preview silently dropped; cancelling alone would
    // drop the last preview, because the frame that would have painted the final point is the one
    // being cancelled.
    if (frameRequested.current !== null) {
      cancelAnimationFrame(frameRequested.current);
      flushDrawingFrame();
    }

    // The Shift-click already committed its line on the press. Its release must commit nothing:
    // the `pointsRef` push below would re-add the end point and erase it a second time, under a
    // second history entry.
    if (lineCommittedRef.current) {
      lineCommittedRef.current = false;
      anchorBeforeGestureRef.current = null;
      previewLayerIdRef.current = null;
      pointsRef.current = [];
      selectionSnapshotRef.current = undefined;
      gestureLayerIdRef.current = null;
      return;
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
      updateLayerByTool({ toolArgs: argsWithSelection(pointsRef.current) });
    }

    pointsRef.current = [];
    selectionSnapshotRef.current = undefined;
    anchorBeforeGestureRef.current = null;
    previewLayerIdRef.current = null;
    gestureLayerIdRef.current = null;
  };

  const cancelActiveGesture = useCallback(() => {
    if (claimedPointerIdRef.current === null) return;
    releasePointer();
    releaseDocumentClaim();
    if (frameRequested.current !== null) {
      cancelAnimationFrame(frameRequested.current);
      frameRequested.current = null;
    }

    const wasAlreadyCommitted = lineCommittedRef.current;
    lineCommittedRef.current = false;
    if (!wasAlreadyCommitted) {
      anchorRef.current = anchorBeforeGestureRef.current ? { ...anchorBeforeGestureRef.current } : null;
      const previewLayerId = previewLayerIdRef.current;
      if (previewLayerId) cancelLayerPreview(previewLayerId);
    }

    pointsRef.current = [];
    selectionSnapshotRef.current = undefined;
    anchorBeforeGestureRef.current = null;
    previewLayerIdRef.current = null;
    gestureLayerIdRef.current = null;
  }, [releaseDocumentClaim, releasePointer]);

  useLayoutEffect(() => {
    // Every preview and the eventual raster replacement must address the same
    // active layer. If a second interaction changes that identity mid-stroke,
    // release the captured stream and roll its preview back before another move
    // or release can target the newly active layer.
    if (
      claimedPointerIdRef.current === null ||
      lineCommittedRef.current ||
      gestureLayerIdRef.current === activeLayerId
    ) {
      return;
    }
    cancelActiveGesture();
  }, [activeLayerId, cancelActiveGesture]);

  const handlePointerCancel = (event: PointerEvent<HTMLDivElement>) => {
    // Cancellation belongs to one pointer stream. A foreign pointer must not release the claim,
    // erase the live layer preview, or roll back the last committed Shift-click anchor.
    if (claimedPointerIdRef.current !== event.pointerId) return;
    cancelActiveGesture();
  };

  useEffect(() => {
    // An unmount between claim and commit is an abort like any other. Paired with the provider-level
    // `resetDocumentGestures`, this is what bounds a leaked claim to the mount that leaked it.
    return () => {
      releaseDocumentClaim();
      selectionSnapshotRef.current = undefined;

      // A frame left pending across an unmount would write to a layer this component no longer
      // owns, so it is cancelled before the preview is rolled back.
      if (frameRequested.current !== null) {
        cancelAnimationFrame(frameRequested.current);
        frameRequested.current = null;
      }
      const previewLayerId = previewLayerIdRef.current;
      if (previewLayerId) cancelLayerPreviewRef.current(previewLayerId);
      previewLayerIdRef.current = null;
      anchorBeforeGestureRef.current = null;
      pointsRef.current = [];
      lineCommittedRef.current = false;
      gestureLayerIdRef.current = null;
    };
  }, [releaseDocumentClaim]);

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
