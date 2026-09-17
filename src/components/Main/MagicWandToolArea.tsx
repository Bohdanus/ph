import { type PointerEvent, type RefObject, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useCurrentTool } from '../../contexts/useCurrentTool.tsx';
import { useStore } from '../../contexts/StoreContext.tsx';
import type { Point, Selection } from '../../contexts/general-types.ts';
import { usePointerPosition } from '../../hooks/usePointerPosition.ts';
import type { MagicWandToolArgs } from '../../tools/magicWand.ts';
import { createMagicWandSelectionFromCanvas } from '../../util/magicWand.ts';
import { createCommittedPolygonSelection, drawSelectionOutline } from '../../util/selection.ts';

type MagicWandToolAreaProps = {
  className?: string;
  overlayCtxRef: RefObject<CanvasRenderingContext2D | null>;
};

export const MagicWandToolArea = ({ className, overlayCtxRef }: MagicWandToolAreaProps) => {
  const [{ canvasRef, containerRef, selections, totalSize }, dispatch] = useStore();
  const { toolArgs } = useCurrentTool();
  const args = toolArgs as MagicWandToolArgs;

  const { getLocalCoords } = usePointerPosition({
    ref: containerRef,
    imageSize: totalSize,
  });

  function clearOverlay() {
    const ctx = overlayCtxRef.current;
    if (!ctx) return;

    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  }

  function redrawOverlay(extraSelection?: Selection) {
    const ctx = overlayCtxRef.current;
    if (!ctx) return;

    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    selections.forEach((selection) => drawSelectionOutline(ctx, selection));
    if (extraSelection) {
      drawSelectionOutline(ctx, extraSelection);
    }
  }

  function isPointInsideImage(point: Point): boolean {
    return point.x >= 0 && point.y >= 0 && point.x < totalSize.width && point.y < totalSize.height;
  }

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || args.toolName !== 'magic-wand') return;

    event.preventDefault();

    const seed = getLocalCoords(event);
    if (!isPointInsideImage(seed)) return;

    dispatch({ type: 'START_SELECTION_DRAFT', payload: { sourceTool: 'magic-wand' } });

    const result = createMagicWandSelectionFromCanvas(canvasRef.current, seed, {
      smoothing: args.smoothing,
      tolerance: args.tolerance,
    });

    if (!result) {
      dispatch({ type: 'CANCEL_SELECTION_DRAFT' });
      redrawOverlay();
      return;
    }

    const selection = createCommittedPolygonSelection({
      id: uuidv4(),
      metadata: {
        magicWand: {
          boundaryPointCount: result.points.length,
          sampleColor: result.sampleColor,
          seed: { x: Math.floor(seed.x), y: Math.floor(seed.y) },
          selectedPixelCount: result.selectedPixelCount,
          smoothing: args.smoothing,
          tolerance: args.tolerance,
        },
      },
      points: result.points,
      sourceTool: 'magic-wand',
    });

    if (!selection) {
      dispatch({ type: 'CANCEL_SELECTION_DRAFT' });
      redrawOverlay();
      return;
    }

    dispatch({ type: 'COMMIT_SELECTION', payload: selection });
    redrawOverlay(selection);
  };

  useEffect(() => {
    redrawOverlay();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selections]);

  useEffect(() => {
    return () => {
      clearOverlay();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={`${className} cursor-crosshair`} onPointerDown={handlePointerDown} style={{ userSelect: 'none' }} />
  );
};
