import { type RefObject, useRef } from 'react';
import { useLayers } from '../../contexts/useLayer.ts';
import { useStore } from '../../contexts/StoreContext.tsx';
import { getLayerIdByPoint } from '../../contexts/layer-utils.ts';
import type { Pos, RectXYSorted } from '../../contexts/general-types.ts';
import { useMarchingAnts } from '../../hooks/useAnts.ts';
import type { LayerId } from '../../contexts/layer-types.ts';
import { useRect } from '../../hooks/useRect.ts';
import { sortedRectToPos } from '../../util/rect.ts';
import type { RepositionToolArgs } from '../../tools/reposition.ts';

type moveToolAreaProps = {
  className?: string;
  canvasCtxRef: RefObject<CanvasRenderingContext2D | null>;
};

export const MoveToolArea = ({ className }: moveToolAreaProps) => {
  const [{ containerRef, toolOverlayRef, rectOverlayRef, activeLayerId, layers, totalSize }] = useStore();
  const { tempUpdateLayer, setActiveLayer, updateLayerByTool } = useLayers();
  const ants = useMarchingAnts({ overlayRef: toolOverlayRef, containerRef });

  const hoveredLayerIdRef = useRef<LayerId | null>(null);
  const selectedLayerIdRef = useRef<LayerId | null>(null);

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
    hideBlend: true,
    isMoveTool: true,

    containerRef,
    overlayRef: rectOverlayRef,
    onChange: (sortedRect: RectXYSorted) => {
      const newPos = sortedRectToPos(sortedRect);
      const toolArgs: RepositionToolArgs = wasCurrentLayerResized(newPos) ? { resize: newPos } : { move: newPos };
      tempUpdateLayer({ id: selectedLayerIdRef.current, toolName: 'reposition', toolArgs });
    },
    onChangeEnd: (sortedRect: RectXYSorted) => {
      const newPos = sortedRectToPos(sortedRect);
      const toolArgs: RepositionToolArgs = wasCurrentLayerResized(newPos) ? { resize: newPos } : { move: newPos };
      updateLayerByTool({ id: selectedLayerIdRef.current, toolName: 'reposition', toolArgs });
    },
  });

  function wasCurrentLayerResized(newPos: Pos) {
    if (!selectedLayerIdRef.current) return false;
    const oldPos = layers[selectedLayerIdRef.current].pos;
    return oldPos.width !== newPos.width || oldPos.height !== newPos.height;
  }

  // todo in future when optimizing this do cache all the layers below the active one and above, to only  reposition the current

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    // secondly, if we are still here, handle the layer selection
    const point = getLocalCoords(event);
    const layerUnderPointerId = getLayerIdByPoint(layers, point);
    const layer = layers[layerUnderPointerId!] ?? null;

    const dragHandleClicked = handlePointerDown_useRect(event, layer);
    if (dragHandleClicked) return;

    if (layer && layer.isBedrock) {
      clearSelection();
      selectedLayerIdRef.current = null;
      // indicate somehow bedrock is selected
    } else {
      selectedLayerIdRef.current = layerUnderPointerId;
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

      hoveredLayerId ? ants.draw(layers[hoveredLayerId]) : ants.clear();
      hoveredLayerIdRef.current = hoveredLayerId;
    }
  }

  function handlePointerUp(event: React.PointerEvent<HTMLDivElement>) {
    handlePointerUp_useRect(event);

    containerRef.current!.classList.remove('cursor-grabbing');
  }

  function handlePointerLeave(event: React.PointerEvent) {
    if (pointerIdRef.current !== event.pointerId) return;

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
