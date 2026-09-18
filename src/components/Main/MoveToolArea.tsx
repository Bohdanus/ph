import { type RefObject, useEffect, useMemo, useRef } from 'react';
import { useLayers } from '../../contexts/useLayer.ts';
import { useStore } from '../../contexts/StoreContext.tsx';
import { getLayerIdByPoint } from '../../contexts/layer-utils.ts';
import type { Pos, RectXYSorted } from '../../contexts/general-types.ts';
import { useMarchingAnts } from '../../hooks/useAnts.ts';
import type { LayerId } from '../../contexts/layer-types.ts';
import { useRect } from '../../hooks/useRect.ts';
import { posToSortedRect, sortedRectToPos } from '../../util/rect.ts';
import type { RepositionToolArgs } from '../../tools/reposition.ts';

type moveToolAreaProps = {
  className?: string;
  canvasCtxRef: RefObject<CanvasRenderingContext2D | null>;
};

export const MoveToolArea = ({ className }: moveToolAreaProps) => {
  const [{ containerRef, toolOverlayRef, rectOverlayRef, activeLayerId, layers, totalSize }] = useStore();
  const { tempUpdateLayer, setActiveLayer, updateLayerByTool } = useLayers();
  const ants = useMarchingAnts({ overlayRef: toolOverlayRef, containerRef });

  const activeLayer = activeLayerId ? layers[activeLayerId] : null;
  const activeLayerRect = useMemo(
    () => (activeLayer && !activeLayer.isBedrock ? posToSortedRect(activeLayer.pos) : null),
    [activeLayer]
  );

  const hoveredLayerIdRef = useRef<LayerId | null>(null);
  const selectedLayerIdRef = useRef<LayerId | null>(null);
  const interactionLayerIdRef = useRef<LayerId | null>(null);
  const interactionStartPosRef = useRef<Pos | null>(null);
  const isInteractionActiveRef = useRef(false);

  function getArgs(sortedRect: RectXYSorted, layerId: LayerId): RepositionToolArgs {
    const newPos = sortedRectToPos(sortedRect);
    return wasLayerResized(layerId, newPos)
      ? { resize: newPos, toolName: 'reposition' }
      : { move: newPos, toolName: 'reposition' };
  }

  const {
    // no initial rect here, instead passing rect in mouseDown
    getLocalCoords,
    isMouseDown,
    pointerIdRef,
    onPointerDown: handlePointerDown_useRect,
    onPointerMove: handlePointerMove_useRect,
    onPointerUp: handlePointerUp_useRect,
    clearSelection,
  } = useRect({
    imageSize: totalSize,
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

      const newPos = sortedRectToPos(sortedRect);
      const didPosChange =
        startPos.x !== newPos.x ||
        startPos.y !== newPos.y ||
        startPos.width !== newPos.width ||
        startPos.height !== newPos.height;

      if (!didPosChange) return;

      const toolArgs = getArgs(sortedRect, layerId);
      await updateLayerByTool({ id: layerId, toolArgs });
    },
  });

  useEffect(() => {
    selectedLayerIdRef.current = activeLayer && !activeLayer.isBedrock ? activeLayer.id : null;
  }, [activeLayer]);

  function wasLayerResized(layerId: LayerId, newPos: Pos) {
    const oldPos = interactionStartPosRef.current ?? layers[layerId]?.pos;
    if (!oldPos) return false;

    return oldPos.width !== newPos.width || oldPos.height !== newPos.height;
  }

  // todo in future when optimizing this do cache all the layers below the active one and above, to only  reposition the current

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    // secondly, if we are still here, handle the layer selection
    const point = getLocalCoords(event);
    const layerUnderPointerId = getLayerIdByPoint(layers, point);
    const layer = layers[layerUnderPointerId!] ?? null;

    const dragHandleClicked = handlePointerDown_useRect(event, layer);
    if (dragHandleClicked) {
      const layerId = selectedLayerIdRef.current;
      interactionLayerIdRef.current = layerId;
      interactionStartPosRef.current = layerId ? { ...layers[layerId].pos } : null;
      isInteractionActiveRef.current = !!layerId;
      return;
    }

    if (layer && layer.isBedrock) {
      clearSelection();
      selectedLayerIdRef.current = null;
      interactionLayerIdRef.current = null;
      interactionStartPosRef.current = null;
      isInteractionActiveRef.current = false;
      // indicate somehow bedrock is selected
    } else {
      selectedLayerIdRef.current = layerUnderPointerId;
      interactionLayerIdRef.current = layerUnderPointerId;
      interactionStartPosRef.current = layerUnderPointerId ? { ...layers[layerUnderPointerId].pos } : null;
      isInteractionActiveRef.current = !!layerUnderPointerId;
      containerRef.current!.classList.add('cursor-grabbing');
    }

    hoveredLayerIdRef.current = null;
    ants.clear();

    if (layerUnderPointerId !== activeLayerId) {
      setActiveLayer(layerUnderPointerId);
    }
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    // firstly, handle drag handles by useRect
    const isHandleHovered = handlePointerMove_useRect(event);
    if (isHandleHovered) return;

    // secondly, if we are still here, handle the layer hovering
    if (!isMouseDown.current) {
      // if mouse is down then dont bother here
      const point = getLocalCoords(event);

      let hoveredLayerId = getLayerIdByPoint(layers, point);
      if (hoveredLayerId && layers[hoveredLayerId].isBedrock) {
        hoveredLayerId = null;
      }

      if (hoveredLayerId) ants.draw(layers[hoveredLayerId]);
      else ants.clear();
      hoveredLayerIdRef.current = hoveredLayerId;
    }
  }

  function handlePointerUp(event: React.PointerEvent<HTMLDivElement>) {
    handlePointerUp_useRect(event);

    isInteractionActiveRef.current = false;
    interactionLayerIdRef.current = null;
    interactionStartPosRef.current = null;

    containerRef.current!.classList.remove('cursor-grabbing');
  }

  function handlePointerLeave(event: React.PointerEvent) {
    if (pointerIdRef.current !== event.pointerId) return;

    isInteractionActiveRef.current = false;
    interactionLayerIdRef.current = null;
    interactionStartPosRef.current = null;

    hoveredLayerIdRef.current = null;
    ants.clear();
  }

  return (
    <div
      className={`${className} cursor-move`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerLeave}
    />
  );
};
