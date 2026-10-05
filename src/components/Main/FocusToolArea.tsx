import type { RefObject } from 'react';
import { useStore } from '../../contexts/StoreContext.tsx';
import { useLayers } from '../../contexts/useLayer.ts';
import { useCurrentTool } from '../../contexts/useCurrentTool.tsx';
import { usePaintStroke } from '../../hooks/usePaintStroke.ts';
import { processorPresentationBounds } from '../../contexts/presentation-evaluator.ts';
import { documentPointsToLayerLocal } from '../../util/layer-space.ts';
import { rasterBoundsForStroke } from '../../util/raster-bounds.ts';
import type { BlurToolArgs } from '../../tools/blur.ts';
import type { SharpenToolArgs } from '../../tools/sharpen.ts';

export const FOCUS_BRUSH_SIZE = 40;

type FocusToolName = 'blur' | 'sharpen';
type FocusToolArgs = BlurToolArgs | SharpenToolArgs;

type FocusToolAreaProps = {
  toolName: FocusToolName;
  className?: string;
  canvasCtxRef?: RefObject<CanvasRenderingContext2D | null>;
  overlayCtxRef: RefObject<CanvasRenderingContext2D | null>;
};

/**
 * Shared gesture surface for Blur and Sharpen.
 *
 * These tools used to be whole-layer processors with no pointer owner.  A stroke now carries
 * the absolute processing frame it needs, which lets a tight layer grow its disposable raster
 * without changing the document frame or sampling another layer.  The frame is retained in the
 * history args so legacy replay and the live preview call the processor with the same origin.
 */
export const FocusToolArea = ({ toolName, className }: FocusToolAreaProps) => {
  const [{ containerRef, activeLayerId, layers, totalSize }] = useStore();
  const { tempUpdateLayer, updateLayerByTool } = useLayers();
  const { getToolArgs } = useCurrentTool();

  const args = getToolArgs(toolName) as FocusToolArgs | null;
  const activeLayer = activeLayerId ? layers[activeLayerId] : null;
  const enabled = Boolean(args && activeLayerId && activeLayer && !activeLayer.isBedrock);
  const sourceBounds = activeLayer ? processorPresentationBounds(activeLayer) : null;

  const strokeArgs = (points: Parameters<typeof documentPointsToLayerLocal>[0]): FocusToolArgs | null => {
    if (!args || !sourceBounds) return null;
    const bounds = rasterBoundsForStroke(
      sourceBounds,
      points,
      FOCUS_BRUSH_SIZE / 2,
      'rasterBounds' in args ? args.rasterBounds : undefined
    );
    return {
      ...args,
      points: documentPointsToLayerLocal(points, bounds),
      rasterBounds: bounds,
    } as FocusToolArgs;
  };

  const { onPointerDown, onPointerMove, onPointerUp, onPointerLeave } = usePaintStroke(
    { imageSize: totalSize, containerRef, enabled },
    {
      onMove: (points) => {
        if (!activeLayerId) return;
        const toolArgs = strokeArgs(points);
        if (toolArgs) tempUpdateLayer({ id: activeLayerId, toolArgs });
      },
      onCommit: (points) => {
        if (!activeLayerId) return;
        const toolArgs = strokeArgs(points);
        if (toolArgs) void updateLayerByTool({ id: activeLayerId, toolArgs });
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
    />
  );
};
