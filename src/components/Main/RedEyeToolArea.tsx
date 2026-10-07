import { type PointerEvent } from 'react';

import { usePointerPosition } from '../../hooks/usePointerPosition.ts';
import { useStore } from '../../contexts/StoreContext.tsx';
import { useLayers } from '../../contexts/useLayer.ts';
import { useCurrentTool } from '../../contexts/useCurrentTool.tsx';
import type { Point } from '../../contexts/general-types.ts';
import { processorPresentationBounds, stageProcessorInput } from '../../contexts/presentation-evaluator.ts';
import { canvasToDocumentPoint, documentFrameFromSize } from '../../contexts/document-frame.ts';
import { readLayerImageData } from '../../tools/colorReplacement.ts';
import { correctRedEyePixels, type RedEyeToolArgs } from '../../tools/redEye.ts';

type RedEyeToolAreaProps = { className?: string };

export const RED_EYE_NO_LAYER_PIXELS = 'red-eye-no-layer-pixels';
export const RED_EYE_READBACK_UNAVAILABLE = 'red-eye-readback-unavailable';
export const RED_EYE_REGION_TOO_LARGE = 'red-eye-region-too-large';

export const RedEyeToolArea = ({ className }: RedEyeToolAreaProps) => {
  const [store] = useStore();
  const { containerRef, layers, activeLayerId, totalSize, documentFrame: currentFrame } = store;
  const documentFrame = currentFrame ?? documentFrameFromSize(totalSize);
  const { updateLayerByTool } = useLayers();
  const { toolArgs } = useCurrentTool();
  const args = toolArgs as RedEyeToolArgs;
  const activeLayer = activeLayerId ? layers[activeLayerId] : undefined;
  const rasterBounds = activeLayer ? processorPresentationBounds(activeLayer) : null;
  const { isPointerDownValid, getLocalCoords } = usePointerPosition({ ref: containerRef, imageSize: totalSize });

  const toLayerPoint = (point: Point): Point => {
    const documentPoint = canvasToDocumentPoint(point, documentFrame);
    return { x: documentPoint.x - (rasterBounds?.x ?? 0), y: documentPoint.y - (rasterBounds?.y ?? 0) };
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (args.toolName !== 'red-eye' || event.button !== 0 || !isPointerDownValid(event)) return;
    event.preventDefault();
    if (!activeLayerId || !activeLayer) return;

    const bitmap = activeLayer.tmpCanvas ?? activeLayer.bitmap;
    if (!bitmap) {
      console.error(RED_EYE_NO_LAYER_PIXELS, `the active layer ${activeLayer.id} has no bitmap to correct`);
      return;
    }

    let staged;
    try {
      staged = stageProcessorInput(activeLayer, bitmap);
    } catch (error) {
      console.error(RED_EYE_READBACK_UNAVAILABLE, `the active layer ${activeLayer.id} cannot be staged`, error);
      return;
    }

    const size = { width: staged.bounds.width, height: staged.bounds.height };
    const image = readLayerImageData(staged.bitmap, size);
    if (!image) {
      console.error(RED_EYE_READBACK_UNAVAILABLE, `the active layer ${activeLayer.id} cannot be read`);
      return;
    }

    const point = toLayerPoint(getLocalCoords(event));
    const correction = correctRedEyePixels(image, point, args.pupilSize, args.darkenAmount);
    if (correction.status === 'too-large') {
      console.error(RED_EYE_REGION_TOO_LARGE, `the red region at ${point.x}, ${point.y} exceeds the correction limit`);
      return;
    }
    if (correction.status === 'unchanged') return;

    updateLayerByTool({ toolArgs: { ...args, point } });
  };

  return <div className={`${className} cursor-crosshair`} onPointerDown={handlePointerDown} />;
};
