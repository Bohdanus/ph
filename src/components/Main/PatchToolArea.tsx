import { useRef, type PointerEvent, type RefObject } from 'react';
import { useStore } from '../../contexts/StoreContext.tsx';
import { useLayers } from '../../contexts/useLayer.ts';
import { useCurrentTool } from '../../contexts/useCurrentTool.tsx';
import { usePointerPosition } from '../../hooks/usePointerPosition.ts';
import { processorPresentationBounds } from '../../contexts/presentation-evaluator.ts';
import { documentPointToLayerLocal } from '../../util/layer-space.ts';
import type { Point, Selection } from '../../contexts/general-types.ts';
import type { PatchToolArgs } from '../../tools/patch.ts';

type PatchToolAreaProps = {
  className?: string;
  canvasCtxRef?: RefObject<CanvasRenderingContext2D | null>;
  overlayCtxRef: RefObject<CanvasRenderingContext2D | null>;
};

type DragState = { pointerId: number; start: Point; selection: Selection };

export const PatchToolArea = ({ className }: PatchToolAreaProps) => {
  const [{ containerRef, activeLayerId, activeSelectionId, layers, selections, totalSize }] = useStore();
  const { cancelLayerPreview, tempUpdateLayer, updateLayerByTool } = useLayers();
  const { toolArgs } = useCurrentTool();
  const args = toolArgs as PatchToolArgs;
  const dragRef = useRef<DragState | null>(null);
  const { getLocalCoords } = usePointerPosition({ ref: containerRef, imageSize: totalSize });
  const activeLayer = activeLayerId ? layers[activeLayerId] : undefined;
  const selection = selections.find((candidate) => candidate.id === activeSelectionId && candidate.isActive);
  const origin = activeLayer ? processorPresentationBounds(activeLayer) : null;
  const enabled = Boolean(activeLayerId && activeLayer && !activeLayer.isBedrock && selection);

  const buildArgs = (donorPoint: Point, target: Selection): PatchToolArgs => ({
    ...args,
    sourceRect: {
      x: target.pos.x - (origin?.x ?? 0),
      y: target.pos.y - (origin?.y ?? 0),
      width: target.pos.width,
      height: target.pos.height,
    },
    donorPoint: documentPointToLayerLocal(donorPoint, origin),
  });

  const donorForEvent = (event: PointerEvent<HTMLDivElement>, state: DragState) => {
    const current = getLocalCoords(event);
    return {
      x: state.selection.pos.x + current.x - state.start.x,
      y: state.selection.pos.y + current.y - state.start.y,
    };
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!enabled || event.button !== 0 || !selection || dragRef.current) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, start: getLocalCoords(event), selection };
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const state = dragRef.current;
    if (!state || state.pointerId !== event.pointerId || !activeLayerId) return;
    tempUpdateLayer({ id: activeLayerId, toolArgs: buildArgs(donorForEvent(event, state), state.selection) });
  };

  const finish = async (event: PointerEvent<HTMLDivElement>) => {
    const state = dragRef.current;
    if (!state || state.pointerId !== event.pointerId || !activeLayerId) return;
    const donorPoint = donorForEvent(event, state);
    dragRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    await updateLayerByTool({ id: activeLayerId, toolArgs: buildArgs(donorPoint, state.selection) });
  };

  const cancel = (event: PointerEvent<HTMLDivElement>) => {
    const state = dragRef.current;
    if (!state || state.pointerId !== event.pointerId) return;
    dragRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    if (activeLayerId) cancelLayerPreview(activeLayerId);
  };

  return (
    <div
      className={`${className} ${enabled ? 'cursor-move' : 'cursor-not-allowed'}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finish}
      onPointerCancel={cancel}
      style={{ userSelect: 'none' }}
      data-testid="patch-tool-area"
    />
  );
};
