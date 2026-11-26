import { useEffect, useRef, type PointerEvent, type RefObject } from 'react';
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

type HealingBrushStrokeSampling = {
  source: Point;
  samplingSource: Point;
  samplingOffset: Point;
  start: Point;
  aligned: boolean;
};

export const HealingBrushToolArea = ({ className }: HealingBrushToolAreaProps) => {
  const [{ containerRef, activeLayerId, layers, totalSize, documentFrame: currentFrame }] = useStore();
  const { tempUpdateLayer, updateLayerByTool, cancelLayerPreview } = useLayers();
  const { toolArgs, patchToolArgs } = useCurrentTool();
  const args = toolArgs as HealingBrushToolArgs;
  const activeLayer = activeLayerId ? layers[activeLayerId] : undefined;
  const origin = activeLayer ? processorPresentationBounds(activeLayer) : null;
  const frame = currentFrame ?? documentFrameFromSize(totalSize);
  const isEnabled = Boolean(
    activeLayerId && activeLayer && !activeLayer.isBedrock && !activeLayer.locked && args.source
  );
  const previewLayerIdRef = useRef<typeof activeLayerId>(null);
  const alignedSourceRef = useRef<Point | null>(args.alignedSource ?? args.source);
  const strokeSamplingRef = useRef<HealingBrushStrokeSampling | null>(null);
  const { getLocalCoords } = usePointerPosition({ ref: containerRef, imageSize: totalSize });

  useEffect(() => {
    alignedSourceRef.current = args.alignedSource ?? args.source;
  }, [args.alignedSource, args.source]);

  const beginStrokeSampling = (points: Point[]): HealingBrushStrokeSampling | null => {
    const source = args.source;
    const start = points[0];
    if (!source || !start) return null;
    const samplingSource = args.aligned ? (alignedSourceRef.current ?? args.alignedSource ?? source) : source;

    return {
      source: { ...source },
      samplingSource: { ...samplingSource },
      samplingOffset: { x: samplingSource.x - start.x, y: samplingSource.y - start.y },
      start: { ...start },
      aligned: args.aligned,
    };
  };

  const buildLayerArgs = (
    points: Point[],
    sampling: HealingBrushStrokeSampling | null
  ): HealingBrushToolArgs | null => {
    if (!sampling || !activeLayer) return null;
    const processorArgs = { ...args, aligned: sampling.aligned };
    delete processorArgs.alignedSource;
    return {
      ...processorArgs,
      source: documentPointToLayerLocal(sampling.source, origin),
      samplingOffset: sampling.samplingOffset,
      points: documentPointsToLayerLocal(points, origin),
    };
  };

  const { onPointerDown, onPointerMove, onPointerUp, onPointerLeave } = usePaintStroke(
    { imageSize: totalSize, containerRef, enabled: isEnabled, gestureKey: activeLayerId },
    {
      onStart: (points) => {
        previewLayerIdRef.current = activeLayerId;
        strokeSamplingRef.current = beginStrokeSampling(points);
      },
      onMove: (points) => {
        if (!activeLayerId) return;
        const layerArgs = buildLayerArgs(points, strokeSamplingRef.current);
        if (layerArgs) tempUpdateLayer({ id: activeLayerId, toolArgs: layerArgs });
      },
      onCommit: async (points) => {
        if (!activeLayerId) return;
        const sampling = strokeSamplingRef.current;
        const layerArgs = buildLayerArgs(points, sampling);
        strokeSamplingRef.current = null;
        if (layerArgs && sampling?.aligned) {
          const end = points[points.length - 1];
          if (end) {
            const alignedSource = {
              x: sampling.samplingSource.x + end.x - sampling.start.x,
              y: sampling.samplingSource.y + end.y - sampling.start.y,
            };
            alignedSourceRef.current = alignedSource;
            patchToolArgs('healing-brush', { alignedSource });
          }
        }
        if (layerArgs) await updateLayerByTool({ id: activeLayerId, toolArgs: layerArgs });
        previewLayerIdRef.current = null;
      },
      onCancel: () => {
        strokeSamplingRef.current = null;
        const layerId = previewLayerIdRef.current;
        previewLayerIdRef.current = null;
        if (layerId) cancelLayerPreview(layerId);
      },
    }
  );

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.altKey) {
      event.preventDefault();
      const source = canvasToDocumentPoint(getLocalCoords(event), frame);
      alignedSourceRef.current = source;
      patchToolArgs('healing-brush', { source, alignedSource: source });
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
