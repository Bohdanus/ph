import type { PointerEvent, RefObject } from 'react';
import { useStore } from '../../contexts/StoreContext.tsx';
import { useLayers } from '../../contexts/useLayer.ts';
import { useCurrentTool } from '../../contexts/useCurrentTool.tsx';
import { usePaintStroke } from '../../hooks/usePaintStroke.ts';
import { usePointerPosition } from '../../hooks/usePointerPosition.ts';
import { processorPresentationBounds } from '../../contexts/presentation-evaluator.ts';
import { canvasToDocumentPoint, documentFrameFromSize } from '../../contexts/document-frame.ts';
import { documentPointToLayerLocal, documentPointsToLayerLocal } from '../../util/layer-space.ts';
import type { Point } from '../../contexts/general-types.ts';
import type { HealingBrushToolArgs } from '../../tools/healingBrush.ts';

type HealingBrushToolAreaProps = {
  className?: string;
  canvasCtxRef?: RefObject<CanvasRenderingContext2D | null>;
  overlayCtxRef: RefObject<CanvasRenderingContext2D | null>;
};

export const HealingBrushToolArea = ({ className }: HealingBrushToolAreaProps) => {
  const [{ containerRef, activeLayerId, layers, totalSize, documentFrame: currentFrame }] = useStore();
  const { tempUpdateLayer, updateLayerByTool } = useLayers();
  const { toolArgs, patchToolArgs } = useCurrentTool();
  const args = toolArgs as HealingBrushToolArgs;
  const activeLayer = activeLayerId ? layers[activeLayerId] : undefined;
  const origin = activeLayer ? processorPresentationBounds(activeLayer) : null;
  const frame = currentFrame ?? documentFrameFromSize(totalSize);
  const isEnabled = Boolean(activeLayerId && activeLayer && !activeLayer.isBedrock && args.source);
  const { getLocalCoords } = usePointerPosition({ ref: containerRef, imageSize: totalSize });

  const buildLayerArgs = (points: Point[]): HealingBrushToolArgs | null => {
    if (!args.source || !activeLayer) return null;
    return {
      ...args,
      source: documentPointToLayerLocal(args.source, origin),
      points: documentPointsToLayerLocal(points, origin),
    };
  };

  const { onPointerDown, onPointerMove, onPointerUp, onPointerLeave } = usePaintStroke(
    { imageSize: totalSize, containerRef, enabled: isEnabled },
    {
      onMove: (points) => {
        if (!activeLayerId) return;
        const layerArgs = buildLayerArgs(points);
        if (layerArgs) tempUpdateLayer({ id: activeLayerId, toolArgs: layerArgs });
      },
      onCommit: async (points) => {
        if (!activeLayerId) return;
        const layerArgs = buildLayerArgs(points);
        if (layerArgs) await updateLayerByTool({ id: activeLayerId, toolArgs: layerArgs });
      },
    }
  );

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.altKey) {
      event.preventDefault();
      patchToolArgs('healing-brush', { source: canvasToDocumentPoint(getLocalCoords(event), frame) });
      return;
    }
    onPointerDown(event);
  };

  return (
    <div
      className={`${className} ${isEnabled ? 'cursor-crosshair' : 'cursor-not-allowed'}`}
      onPointerDown={handlePointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerLeave}
      style={{ userSelect: 'none' }}
      data-testid="healing-brush-tool-area"
    />
  );
};
