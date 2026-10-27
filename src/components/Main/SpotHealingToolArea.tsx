import { useRef, type RefObject } from 'react';
import { useStore } from '../../contexts/StoreContext.tsx';
import { useLayers } from '../../contexts/useLayer.ts';
import { useCurrentTool } from '../../contexts/useCurrentTool.tsx';
import { usePaintStroke } from '../../hooks/usePaintStroke.ts';
import { processorPresentationBounds } from '../../contexts/presentation-evaluator.ts';
import { documentPointsToLayerLocal } from '../../util/layer-space.ts';
import type { SpotHealingToolArgs } from '../../tools/spotHealing.ts';

type SpotHealingToolAreaProps = {
  className?: string;
  canvasCtxRef?: RefObject<CanvasRenderingContext2D | null>;
  overlayCtxRef: RefObject<CanvasRenderingContext2D | null>;
};

export const SpotHealingToolArea = ({ className }: SpotHealingToolAreaProps) => {
  const [{ containerRef, activeLayerId, layers, totalSize }] = useStore();
  const { tempUpdateLayer, updateLayerByTool, cancelLayerPreview } = useLayers();
  const { toolArgs } = useCurrentTool();
  const args = toolArgs as SpotHealingToolArgs;
  const activeLayer = activeLayerId ? layers[activeLayerId] : undefined;
  const rasterBounds = activeLayer ? processorPresentationBounds(activeLayer) : null;
  const isEnabled = Boolean(activeLayerId && activeLayer && !activeLayer.isBedrock);
  const previewLayerIdRef = useRef<typeof activeLayerId>(null);

  const { onPointerDown, onPointerMove, onPointerUp, onPointerLeave } = usePaintStroke(
    { imageSize: totalSize, containerRef, enabled: isEnabled, gestureKey: activeLayerId },
    {
      onStart: () => {
        previewLayerIdRef.current = activeLayerId;
      },
      onMove: (points) => {
        tempUpdateLayer({
          id: activeLayerId!,
          toolArgs: { ...args, points: documentPointsToLayerLocal(points, rasterBounds) },
        });
      },
      onCommit: async (points) => {
        await updateLayerByTool({
          id: activeLayerId!,
          toolArgs: { ...args, points: documentPointsToLayerLocal(points, rasterBounds) },
        });
        previewLayerIdRef.current = null;
      },
      onCancel: () => {
        const layerId = previewLayerIdRef.current;
        previewLayerIdRef.current = null;
        if (layerId) cancelLayerPreview(layerId);
      },
    }
  );

  return (
    <div
      className={`${className} cursor-crosshair`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerLeave}
      data-testid="spot-healing-tool-area"
    />
  );
};
