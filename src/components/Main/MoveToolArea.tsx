import { useEffect, useMemo, useRef } from 'react';
import { useLayers } from '../../contexts/useLayer.ts';
import { useStore } from '../../contexts/StoreContext.tsx';
import { getLayerIdByPoint } from '../../contexts/layer-utils.ts';
import type { Pos, RectXYSorted } from '../../contexts/general-types.ts';
import { useMarchingAnts } from '../../hooks/useAnts.ts';
import { useContainScale } from '../../hooks/useContainScale.ts';
import type { LayerId } from '../../contexts/layer-types.ts';
import { useRect } from '../../hooks/useRect.ts';
import { claimDocumentGesture, releaseDocumentGesture } from '../../hooks/document-gesture.ts';
import { posToSortedRect, sortedRectToPos } from '../../util/rect.ts';
import type { RepositionToolArgs } from '../../tools/reposition.ts';
import {
  canvasToDocumentPoint,
  canvasToDocumentPos,
  documentFrameFromSize,
  documentToCanvasPos,
} from '../../contexts/document-frame.ts';
import { getLayerPresentationBounds } from '../../contexts/affine-transform.ts';

type moveToolAreaProps = {
  className?: string;
};

export const MoveToolArea = ({ className }: moveToolAreaProps) => {
  const [
    { containerRef, toolOverlayRef, rectOverlayRef, activeLayerId, layers, totalSize, documentFrame: currentFrame },
  ] = useStore();
  const documentFrame = currentFrame ?? documentFrameFromSize(totalSize);
  const { tempUpdateLayer, setActiveLayer, updateLayerByTool } = useLayers();
  const containScale = useContainScale(containerRef, totalSize);
  const ants = useMarchingAnts({ overlayRef: toolOverlayRef, containerRef, scaleRef: containScale });

  const activeLayer = activeLayerId ? layers[activeLayerId] : null;
  const activeLayerRect = useMemo(
    () =>
      activeLayer && !activeLayer.isBedrock
        ? posToSortedRect(documentToCanvasPos(getLayerPresentationBounds(activeLayer), documentFrame))
        : null,
    [activeLayer, documentFrame]
  );

  const hoveredLayerIdRef = useRef<LayerId | null>(null);
  const selectedLayerIdRef = useRef<LayerId | null>(null);
  const interactionLayerIdRef = useRef<LayerId | null>(null);
  const interactionStartPosRef = useRef<Pos | null>(null);
  const interactionStartBoundsRef = useRef<Pos | null>(null);
  const isInteractionActiveRef = useRef(false);
  /**
   * The pointer id this component's own claim was taken with. The layer move and
   * the layer resize are one gesture with two shapes, and neither `onChangeEnd`
   * nor `onRepaint` receives the event, so the id is kept here for every release
   * route to name the claim it is releasing.
   */
  const claimedPointerIdRef = useRef<number | null>(null);

  function releaseDocumentClaim() {
    releaseDocumentGesture('layer-transform', claimedPointerIdRef.current);
    claimedPointerIdRef.current = null;
  }

  /**
   * A layer move and a layer resize both write the document from
   * `onChangeEnd`, which `useRect` calls on release, so the press-to-release
   * window is exactly the window a document-mutating shortcut would corrupt. The
   * claim is taken only when an interaction is actually active AND the press was
   * one `useRect` could have started: a press that hit no layer starts no gesture,
   * and a non-primary or second press is refused by `useRect.onPointerDown` —
   * but that refusal is not visible here, because its return value cannot tell
   * "refused" from "swallowed the press as a layer selection", both of which are
   * `false`. So the same rule is read directly, BEFORE the delegation flips
   * `isMouseDown` and after which the flag can no longer tell the two apart. This
   * is `RectangularSelectionToolArea`'s rule, for the same reason.
   */
  function claimDocumentGestureForPress(pointerId: number | null, startsGesture: boolean) {
    if (!startsGesture) return;
    if (!isInteractionActiveRef.current) return;
    if (claimDocumentGesture('layer-transform', pointerId)) {
      claimedPointerIdRef.current = pointerId;
    }
  }

  function getPointerId(event: React.PointerEvent<HTMLDivElement>): number | null {
    return typeof event.pointerId === 'number' ? event.pointerId : null;
  }

  function getArgs(sortedRect: RectXYSorted, layerId: LayerId): RepositionToolArgs {
    const newPos = canvasToDocumentPos(sortedRectToPos(sortedRect), documentFrame);
    const layer = layers[layerId];
    if (!layer) return { move: { x: newPos.x, y: newPos.y }, toolName: 'reposition' };
    const presentation = getLayerPresentationBounds(layer);
    if (!wasLayerResized(layerId, newPos)) {
      return {
        move: { x: layer.pos.x + newPos.x - presentation.x, y: layer.pos.y + newPos.y - presentation.y },
        toolName: 'reposition',
      };
    }

    return {
      resize: {
        x: layer.pos.x + newPos.x - presentation.x,
        y: layer.pos.y + newPos.y - presentation.y,
        width: layer.pos.width * (newPos.width / presentation.width),
        height: layer.pos.height * (newPos.height / presentation.height),
      },
      toolName: 'reposition',
    };
  }

  const {
    pointerHandlers: {
      onPointerDown: handlePointerDown_useRect,
      onPointerMove: handlePointerMove_useRect,
      onPointerUp: handlePointerUp_useRect,
    },
    rectHandles: { clearSelection },
    pointerState: { getLocalCoords, isMouseDown, pointerIdRef },
  } = useRect({
    imageSize: totalSize,
    // no initial rect here, instead passing rect in mouseDown
    initialRect: activeLayerRect,
    hideBlend: true,
    isMoveTool: true,

    containerRef,
    overlayRef: rectOverlayRef,
    onRepaint: (sortedRect: RectXYSorted) => {
      const layerId = interactionLayerIdRef.current;
      if (!isInteractionActiveRef.current || !layerId) return;

      const toolArgs = getArgs(sortedRect, layerId);
      tempUpdateLayer({ id: layerId, toolArgs });
    },
    onChangeEnd: async (sortedRect: RectXYSorted) => {
      const layerId = interactionLayerIdRef.current;
      const startPos = interactionStartPosRef.current;
      if (!layerId || !startPos) return;

      const newPos = canvasToDocumentPos(sortedRectToPos(sortedRect), documentFrame);
      const startBounds = interactionStartBoundsRef.current ?? startPos;
      const didPosChange =
        startBounds.x !== newPos.x ||
        startBounds.y !== newPos.y ||
        startBounds.width !== newPos.width ||
        startBounds.height !== newPos.height;

      if (!didPosChange) return;

      const toolArgs = getArgs(sortedRect, layerId);
      await updateLayerByTool({ id: layerId, toolArgs });
    },
  });

  useEffect(() => {
    selectedLayerIdRef.current = activeLayer && !activeLayer.isBedrock ? activeLayer.id : null;
  }, [activeLayer]);

  function wasLayerResized(layerId: LayerId, newPos: Pos) {
    const oldPos =
      interactionStartBoundsRef.current ?? (layers[layerId] && getLayerPresentationBounds(layers[layerId]));
    if (!oldPos) return false;

    return oldPos.width !== newPos.width || oldPos.height !== newPos.height;
  }

  // todo in future when optimizing this do cache all the layers below the active one and above, to only  reposition the current

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    // Whether this press could start a gesture at all, read BEFORE the delegation.
    // `useRect.onPointerDown` refuses a non-primary button and a second pointer, and
    // a press it refused starts nothing — so a right-click on a layer must not
    // claim here either, or the claim would refuse every document-mutating
    // shortcut until some later drag happened to release it.
    const startsGesture = event.button === 0 && !isMouseDown.current;

    // secondly, if we are still here, handle the layer selection
    const point = canvasToDocumentPoint(getLocalCoords(event), documentFrame);
    const layerUnderPointerId = getLayerIdByPoint(layers, point);
    const layer = layers[layerUnderPointerId!] ?? null;
    const pointerId = getPointerId(event);

    const dragHandleClicked = handlePointerDown_useRect(
      event,
      layer ? { ...layer, pos: documentToCanvasPos(getLayerPresentationBounds(layer), documentFrame) } : layer
    );
    if (dragHandleClicked) {
      const layerId = selectedLayerIdRef.current;
      interactionLayerIdRef.current = layerId;
      interactionStartPosRef.current = layerId ? { ...layers[layerId].pos } : null;
      interactionStartBoundsRef.current = layerId ? getLayerPresentationBounds(layers[layerId]) : null;
      isInteractionActiveRef.current = !!layerId;
      // The resize half of the gesture, and the reason this claim is taken on
      // both exits of the press rather than at the end of this function: the
      // drag-handle branch returns here, and it is a drag like any other.
      claimDocumentGestureForPress(pointerId, startsGesture);
      return;
    }

    if (layer && layer.isBedrock) {
      clearSelection();
      selectedLayerIdRef.current = null;
      interactionLayerIdRef.current = null;
      interactionStartPosRef.current = null;
      interactionStartBoundsRef.current = null;
      isInteractionActiveRef.current = false;
      // indicate somehow bedrock is selected
    } else {
      selectedLayerIdRef.current = layerUnderPointerId;
      interactionLayerIdRef.current = layerUnderPointerId;
      interactionStartPosRef.current = layerUnderPointerId ? { ...layers[layerUnderPointerId].pos } : null;
      interactionStartBoundsRef.current = layerUnderPointerId
        ? getLayerPresentationBounds(layers[layerUnderPointerId])
        : null;
      isInteractionActiveRef.current = !!layerUnderPointerId;
      containerRef.current!.classList.add('cursor-grabbing');
    }

    hoveredLayerIdRef.current = null;
    ants.clear();

    if (layerUnderPointerId !== activeLayerId) {
      setActiveLayer(layerUnderPointerId);
    }

    // The selection half. A press on no layer and a press on the bedrock layer
    // both leave `isInteractionActiveRef` false, so neither takes a claim: there
    // is no gesture here for the keyboard to wait on.
    claimDocumentGestureForPress(pointerId, startsGesture);
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    // firstly, handle drag handles by useRect
    const isHandleHovered = handlePointerMove_useRect(event);
    if (isHandleHovered) return;

    // secondly, if we are still here, handle the layer hovering
    if (!isMouseDown.current) {
      // if mouse is down then dont bother here
      const point = canvasToDocumentPoint(getLocalCoords(event), documentFrame);

      let hoveredLayerId = getLayerIdByPoint(layers, point);
      if (hoveredLayerId && layers[hoveredLayerId].isBedrock) {
        hoveredLayerId = null;
      }

      if (hoveredLayerId) {
        const layer = layers[hoveredLayerId];
        ants.draw({ ...layer, pos: documentToCanvasPos(layer.pos, documentFrame) });
      } else ants.clear();
      hoveredLayerIdRef.current = hoveredLayerId;
    }
  }

  function handlePointerUp(event: React.PointerEvent<HTMLDivElement>) {
    // Whether this release is the one that owns the claim and the interaction
    // teardown, read BEFORE the delegation: `useRect`'s pointer-up nulls the
    // pointer it tracked, so after the call the id is gone and the comparison can
    // no longer be made. A stranger's release must not hand the document back
    // while the owning pointer is still dragging toward a commit that truncates
    // the redo tail.
    //
    // Both halves are load-bearing for the reason `isPointerUpValid` needs both:
    // a mouse is ONE pointer whose id is constant across buttons, so a
    // right-button release that arrives while a left drag is in flight shares the
    // left pointer's id, and matching on the id alone handed that release to
    // every caller's teardown for a release this press never made. The id match
    // alone is a second hole in the other direction — a release from a pointer
    // this surface never tracked cannot end a drag it does not own — so only the
    // primary release of the tracked pointer is one this gesture ends on. Its
    // refusal leaves the gesture armed, so the genuine primary release still
    // arrives, and `pointercancel`, the leave route and the unmount route carry
    // the aborts that have no primary release to wait for.
    const isOwningRelease =
      event.button === 0 && pointerIdRef.current !== null && pointerIdRef.current === getPointerId(event);

    handlePointerUp_useRect(event);

    // After `handlePointerUp_useRect`, not before: that call is what runs
    // `onChangeEnd` and therefore `updateLayerByTool`, so releasing first would
    // open the keyboard for the one dispatch this gesture exists to make. The
    // release covers the commit path and every early return inside `onChangeEnd`
    // (no layer, no start position, no displacement) with one call. The teardown
    // below rides the same condition: ending the interaction and ending the claim
    // are one event, so a release that ends neither hands back nothing.
    if (!isOwningRelease) return;

    releaseDocumentClaim();

    isInteractionActiveRef.current = false;
    interactionLayerIdRef.current = null;
    interactionStartPosRef.current = null;
    interactionStartBoundsRef.current = null;

    containerRef.current!.classList.remove('cursor-grabbing');
  }

  /**
   * Give the document back and drop the running interaction, which is what both
   * abort routes — the pointer leaving the surface and the UA cancelling the
   * pointer outright — have in common.
   */
  function abandonInteraction() {
    // Paired with the interaction teardown rather than left to pointerup: these
    // handlers are the abort routes that already abandon the drag, so a document
    // claim left open here would outlive a gesture that is over.
    releaseDocumentClaim();

    isInteractionActiveRef.current = false;
    interactionLayerIdRef.current = null;
    interactionStartPosRef.current = null;
    interactionStartBoundsRef.current = null;
  }

  function handlePointerLeave(event: React.PointerEvent) {
    if (pointerIdRef.current !== event.pointerId) return;

    abandonInteraction();

    hoveredLayerIdRef.current = null;
    ants.clear();
  }

  function handlePointerCancel() {
    // The route `handlePointerLeave` cannot cover. `usePointerPosition` nulls its
    // own tracking from a NATIVE `pointercancel` listener, so `useRect`'s
    // `isPointerUpValid` is false from that moment on and no `pointerup` ever
    // follows; and the leave handler early-returns on a pointerId mismatch, which
    // is exactly what a cancelled touch pointer leaves behind. Without this, a
    // UA-cancelled pan kept the claim live and every document-mutating shortcut
    // stayed dead until the next press.
    abandonInteraction();

    containerRef.current?.classList.remove('cursor-grabbing');
  }

  useEffect(() => {
    // An unmount between claim and commit is an abort like any other. Paired
    // with the provider-level `resetDocumentGestures`, this is what bounds a
    // leaked claim to the mount that leaked it.
    return () => {
      releaseDocumentClaim();
    };
  }, []);

  return (
    <div
      className={`${className} cursor-move`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerLeave}
      onPointerCancel={handlePointerCancel}
    />
  );
};
