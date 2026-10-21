import { type PointerEvent, useRef } from 'react';
import { usePointerPosition } from '../../hooks/usePointerPosition.ts';
import { useStore } from '../../contexts/StoreContext.tsx';
import { useLayers } from '../../contexts/useLayer.ts';
import { useCurrentTool } from '../../contexts/useCurrentTool.tsx';
import {
  createColorReplacementPlan,
  readLayerImageData,
  samplePixelAt,
  type ColorReplacementToolArgs,
} from '../../tools/colorReplacement.ts';
import type { Point } from '../../contexts/general-types.ts';
import type { Layer } from '../../contexts/layer-types.ts';
import {
  processorPresentationBounds,
  stageProcessorInput,
  type ProcessorStaging,
} from '../../contexts/presentation-evaluator.ts';
import { canvasToDocumentPoint, documentFrameFromSize } from '../../contexts/document-frame.ts';

type ColorReplacementToolAreaProps = {
  className?: string;
};

/**
 * Refusal reasons, named and exported so a test pins the exact string rather than "some console
 * error", on the same contract as `FillToolArea`'s two readback checks: a tool that
 * cannot read its own destination must fail LOUDLY and write NO history, because a commit that
 * silently changed nothing is a tool that looks alive and is not.
 */
export const COLOR_REPLACEMENT_NO_LAYER_PIXELS = 'color-replacement-no-layer-pixels';
export const COLOR_REPLACEMENT_READBACK_UNAVAILABLE = 'color-replacement-readback-unavailable';
export const COLOR_REPLACEMENT_PRESENTATION_UNAVAILABLE = 'color-replacement-presentation-unavailable';

/**
 * The Color Replacement Tool: CLICK to choose the colour to replace, then DRAG to paint the
 * replacement over the pixels close to it.
 *
 * Two gestures in one area, and which one a click means is decided entirely by whether a sample
 * exists yet. Photoshop's cursor is an eyedropper until the sample is taken and a brush after it,
 * and `sampleColor === null` is that state. There is no mode flag to keep in sync with it.
 *
 * It edits the ACTIVE layer and never creates one, so it commits through `updateLayerByTool` and
 * not `createLayerFromTool` — the same distinction `EraserToolArea` draws, and for the same
 * reason: a new transparent layer holding a hole composites as nothing. `commit: 'raster'`
 * replaces the active layer's pixels with the canvas the processor returns, so the points are the
 * layer's own local coordinates and no bounding-box crop happens, exactly as in the eraser.
 *
 * The replacement colour is read off the live store at the pointer-up, never mirrored into the
 * args by a bar or a context write. `FillToolArea` is the precedent and the reason is
 * specific: the user can change the foreground while this tool stays selected, and a value
 * captured when the bar mounted would replace with the colour that was current at the time.
 */
export const ColorReplacementToolArea = ({ className }: ColorReplacementToolAreaProps) => {
  // The state object is kept whole as well as destructured, for the same reason `FillToolArea`
  // keeps it: the foreground colour is read off it inside the handler.
  const [store] = useStore();
  const { containerRef, layers, activeLayerId, totalSize, documentFrame: currentFrame } = store;
  const documentFrame = currentFrame ?? documentFrameFromSize(totalSize);
  const { updateLayerByTool } = useLayers();
  const { toolArgs, patchToolArgs } = useCurrentTool();

  const args = toolArgs as ColorReplacementToolArgs;
  const pointsRef = useRef<Point[]>([]);

  const { isPointerDownValid, isPointerMoveValid, isPointerUpValid, getLocalCoords, isMouseDown } = usePointerPosition({
    ref: containerRef,
    imageSize: totalSize,
  });

  // `isMouseDown` is READ, never written: `isPointerDownValid` sets it and `isPointerUpValid`
  // clears it in `usePointerPosition`, and the React compiler lint rules reject
  // writing through a destructured hook return. `EraserToolArea` and `DrawToolArea` only read it
  // for the same reason.

  /** The active layer, or undefined — the two refusals below both need to name it. */
  const activeLayer = activeLayerId ? layers[activeLayerId] : undefined;

  /**
   * The origin of the raster the processor is handed: `pos` for a layer that presents nothing,
   * its EVALUATED extent for one carrying a transform or a filter. Every point below is rebased
   * through it, so a stroke on a transformed layer addresses the buffer the layer is drawn from.
   */
  const rasterBounds = activeLayer ? processorPresentationBounds(activeLayer) : null;

  /**
   * The PRESENTED raster and its size, which is what the two decisions below must be made on and
   * what the processor will be handed. Reading the raw layer instead would sample and plan against
   * pixels the commit is not going to touch.
   *
   * `null` is a refusal rather than a throw, on the same contract as the two exported names above:
   * the tool cannot read its own destination, so it says so and writes no history.
   */
  const stageLayerPresentation = (layer: Layer, bitmap: NonNullable<Layer['bitmap']>): ProcessorStaging | null => {
    try {
      return stageProcessorInput(layer, bitmap);
    } catch (error) {
      console.error(
        COLOR_REPLACEMENT_PRESENTATION_UNAVAILABLE,
        `the active layer ${layer.id} cannot be staged for ${args.toolName}`,
        error
      );
      return null;
    }
  };

  /** Canvas space to the presented raster's local frame, the space the processor reads. */
  const toLayerPoint = (point: Point, origin: { x: number; y: number } | null): Point => {
    const documentPoint = canvasToDocumentPoint(point, documentFrame);

    return { x: documentPoint.x - (origin?.x ?? 0), y: documentPoint.y - (origin?.y ?? 0) };
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (args.toolName !== 'color-replacement') return;
    if (!isPointerDownValid(event)) return;
    if (!activeLayer) return;

    event.preventDefault();

    const layerPoint = toLayerPoint(getLocalCoords(event), rasterBounds);

    // Sampled already: this press opens a drag, and the points accumulate on pointer-move.
    if (args.sampleColor) {
      pointsRef.current = [layerPoint];
      return;
    }

    // Not sampled: this press IS the eyedropper. It must not also lay down a stroke, so the drag
    // list stays empty and the pointer-up below has nothing to commit.
    const bitmap = activeLayer.tmpCanvas ?? activeLayer.bitmap;
    if (!bitmap) {
      console.error(COLOR_REPLACEMENT_NO_LAYER_PIXELS, `the active layer ${activeLayer.id} has no bitmap to sample`);
      return;
    }

    const staged = stageLayerPresentation(activeLayer, bitmap);
    if (!staged) return;

    const imageData = readLayerImageData(staged.bitmap, { width: staged.bounds.width, height: staged.bounds.height });
    if (!imageData) {
      console.error(COLOR_REPLACEMENT_READBACK_UNAVAILABLE, `${args.toolName} cannot read the active layer's pixels`);
      return;
    }

    const sampled = samplePixelAt(imageData, layerPoint);
    // Outside the layer, or a fully transparent pixel: no colour to remember, so the tool stays in
    // its asking state rather than arming itself with a colour the user never chose.
    if (!sampled || sampled.a === 0) return;

    // `patchToolArgs`, not `setToolArgs`: this is a tool SETTING the user picks by clicking, the
    // same channel Tolerance and Limits travel on, and `util/settings.ts`'s arm for this tool omits
    // it — so switching away and back returns the tool to asking, which is what Photoshop does.
    patchToolArgs('color-replacement', { sampleColor: sampled });
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (args.toolName !== 'color-replacement') return;
    if (!args.sampleColor) return;
    if (!isMouseDown.current || !isPointerMoveValid(event)) return;
    if (!activeLayer) return;

    pointsRef.current.push(toLayerPoint(getLocalCoords(event), rasterBounds));
  };

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (args.toolName !== 'color-replacement') return;
    if (!isPointerUpValid(event)) return;

    const points = pointsRef.current;
    pointsRef.current = [];
    if (!args.sampleColor || points.length === 0) return;
    if (!activeLayer) return;

    const coords = toLayerPoint(getLocalCoords(event), rasterBounds);
    const lastPoint = points[points.length - 1];
    if (!lastPoint || lastPoint.x !== coords.x || lastPoint.y !== coords.y) points.push(coords);

    const commitArgs: ColorReplacementToolArgs = { ...args, color: store.color, points };

    // Whether the drag replaced anything is decided HERE, on the same pixels, with the same
    // predicate and the same settings the processor will use. A drag that matched nothing ends the
    // gesture with no `updateLayerByTool`, so no `TOOL_ACTION` and no history row that changed
    // nothing. The plan is pure, so the two answers cannot disagree.
    const bitmap = activeLayer.tmpCanvas ?? activeLayer.bitmap;
    if (!bitmap) {
      console.error(
        COLOR_REPLACEMENT_NO_LAYER_PIXELS,
        `the active layer ${activeLayer.id} has no bitmap to replace in`
      );
      return;
    }

    const staged = stageLayerPresentation(activeLayer, bitmap);
    if (!staged) return;

    const size = { width: staged.bounds.width, height: staged.bounds.height };
    const imageData = readLayerImageData(staged.bitmap, size);
    if (!imageData) {
      console.error(COLOR_REPLACEMENT_READBACK_UNAVAILABLE, `${args.toolName} cannot read the active layer's pixels`);
      return;
    }

    const plan = createColorReplacementPlan(imageData, commitArgs);
    if (!plan) return;

    updateLayerByTool({ toolArgs: commitArgs });
  };

  // No drag preview. Photoshop repaints the replaced pixels live on the overlay, and doing that
  // honestly needs the full-layer plan recomputed on every pointer move, which is a multi-megapixel
  // tolerance scan plus flood per move. A cheaper overlay that painted the brush swath regardless
  // of tolerance would show colour over pixels the commit is about to leave alone, which is a worse
  // lie than none. The commit happens on pointer-up, like the fill tools'.
  return (
    <div
      className={`${className} ${args.sampleColor ? 'cursor-crosshair' : 'cursor-cell'}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      style={{ userSelect: 'none' }}
    />
  );
};
