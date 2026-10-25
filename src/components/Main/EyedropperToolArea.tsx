import { type PointerEvent, type RefObject } from 'react';
import { usePointerPosition } from '../../hooks/usePointerPosition.ts';
import { useStore } from '../../contexts/StoreContext.tsx';
import { useCurrentTool } from '../../contexts/useCurrentTool.tsx';
import type { EyedropperToolArgs } from '../../tools/eyedropper.ts';
import { readColorSampler } from '../../tools/color-sampler-readback.ts';
import { addColorSampler, colorSamplerAt, removeColorSampler } from '../../tools/color-sampler-store.ts';
import { documentFrameSize } from '../../contexts/document-frame.ts';

type EyedropperToolAreaProps = {
  className?: string;
  overlayCtxRef?: RefObject<CanvasRenderingContext2D | null>;
};

/**
 * Refusal reasons, named and exported so a test pins the exact string. See
 * `FILL_TOOL_READBACK_UNAVAILABLE` in `./FillToolArea.tsx` for why a refusal must be loud and must
 * write no history.
 */
export const EYEDROPPER_READBACK_UNAVAILABLE = 'eyedropper-readback-unavailable';

/**
 * `Sample All Layers` has NO control on the options bar: it needs a composite read of every visible
 * layer, and the single workspace canvas is not that, so a permanently `disabled` box was a
 * promise the app could not keep and has been removed. The value survives in the args because
 * `settings.ts` still seeds it, so this stays the loud refusal rather than a silent no-op: a `true`
 * arriving from any other writer reports why nothing happened instead of sampling the composited
 * canvas and presenting it as the whole document's.
 */
export const EYEDROPPER_ALL_LAYERS_UNSUPPORTED = 'eyedropper-sample-all-layers-unsupported';

/**
 * Adobe's second way to place a sampler, and it is on THIS tool's page:
 * "To add new color samplers, select the Color Sampler tool and click in the image, or select the
 * Eyedropper tool and Shift-click in the image."
 * <https://helpx.adobe.com/photoshop/using/viewing-histograms-pixel-values.html>
 *
 * **Shift-click is this tool's, so Alt still means background colour.** Adobe's two gestures are
 * distinct on the same key combination: a bare Shift-click places a sampler and an Alt-click samples
 * to the background, so the check is on `shiftKey` alone and the `altKey` branch below is untouched.
 *
 * Adobe's third gesture is the matching delete — "Option + Shift (Mac) | Alt + Shift (Win) -click on
 * the Color Sampler to delete a Color Sampler (With the Eyedropper tool selected)" — so Shift-Alt
 * over an existing marker removes it rather than placing a second one on the same pixel. It is
 * implemented here rather than in `ColorSamplerToolArea` because the tool area is not mounted while
 * the Eyedropper holds the tile.
 */
const shiftClickPlacesSampler = (event: PointerEvent<HTMLDivElement>): boolean => event.shiftKey;

/**
 * The Eyedropper records NO history state.
 *
 * Adobe's rule is that a history state comes from a change to pixels; sampling changes only the
 * application foreground colour, so a click here is not an undoable edit. Concretely, this area
 * dispatches `SET_COLOR` and nothing else: no `COMMIT_DOCUMENT_EDIT`, no `TOOL_ACTION`, no layer,
 * and no durable operation. That is also why the eyedropper has no entry in
 * `src/tools/toolProcessors.ts` — it is in `PIXEL_FREE_TOOLS` — and why there is no
 * `updateLayerByTool`/`createLayerFromTool` call to make here.
 *
 * The sample is read from the COMPOSITED workspace canvas (`canvasRef`, the element
 * `drawLayersToCanvas` composes every visible layer into), not from the active layer, because that
 * is the pixel the user actually clicked. `drawLayersToCanvas` sizes that canvas to the document
 * frame and draws each layer at `position.x - documentFrame.x`, so the canvas's own pixel (0,0) IS
 * the frame origin. Sampling stays in frame pixels; `readColorSampler` maps those logical pixels to
 * the rounded backing bitmap.
 */
export const EyedropperToolArea = ({ className }: EyedropperToolAreaProps) => {
  const [{ canvasRef, containerRef, totalSize, documentFrame, renderSelector }, dispatch] = useStore();
  const { toolArgs } = useCurrentTool();

  const args = toolArgs as EyedropperToolArgs;

  const { getLocalCoords } = usePointerPosition({
    ref: containerRef,
    imageSize: totalSize,
  });

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    if (args.toolName !== 'eyedropper') return;

    event.preventDefault();

    if (args.sampleAllLayers) {
      console.error(EYEDROPPER_ALL_LAYERS_UNSUPPORTED, 'the eyedropper samples the composited canvas only');
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) return;

    // The composited canvas is drawn in FRAME space: it is sized by `documentFrameSize` and each
    // layer is stamped at `position.x - documentFrame.x` by `evaluatePresentation()`.
    // So the canvas's own pixel (0,0) is the frame origin, and `getLocalCoords` is already the
    // index `getImageData` wants. Running it through `canvasToDocumentPoint` first would ADD the
    // frame origin a second time: after a crop that trims 100px off the left, a click on canvas
    // x=100 read canvas x=200, and a click past 600 read entirely outside the bitmap and silently
    // dispatched nothing, which reads as a dead tool.
    const canvasSeed = getLocalCoords(event);
    const centerX = Math.floor(canvasSeed.x);
    const centerY = Math.floor(canvasSeed.y);
    const frameSize = documentFrameSize(documentFrame);
    const shiftClick = shiftClickPlacesSampler(event);
    const hit = shiftClick ? colorSamplerAt(canvasSeed) : null;
    if (hit && event.altKey) {
      // Marker deletion does not read pixels, so it remains available while the previous canvas
      // is visible during replay.
      removeColorSampler(hit.id);
      return;
    }

    // A pending replay keeps the previous accepted pixels visible until the target is rendered.
    // Refuse foreground samples and sampler placements during that interval.
    if (renderSelector.source === 'pending') return;

    // Adobe's Shift-click path, resolved BEFORE the readback below because it does not use this
    // tool's sample at all: it places a sampler, which is the Color Sampler's store and overlay.
    // The readback module is shared so the two call sites cannot disagree about which document
    // pixel a point names.
    if (shiftClick) {
      const samplerReadback = readColorSampler(canvas, { x: centerX, y: centerY }, args.sampleSize, frameSize);
      if (!samplerReadback.ok) {
        console.error(samplerReadback.reason, 'the color sampler cannot read the composited canvas');
        return;
      }
      if (samplerReadback.color === null) return;
      const placed = addColorSampler({ x: centerX, y: centerY }, samplerReadback.color);
      if (!placed.ok) console.error(placed.reason, `the color sampler holds ${placed.samplers.length} samples`);
      return;
    }

    const readback = readColorSampler(canvas, { x: centerX, y: centerY }, args.sampleSize, frameSize);
    if (!readback.ok) {
      console.error(EYEDROPPER_READBACK_UNAVAILABLE, 'the eyedropper cannot read the composited canvas');
      return;
    }
    if (readback.color === null) return;

    // Alpha is dropped: the store's foreground is a CSS colour consumed by an `<input type="color">`,
    // which cannot express it, and the composited canvas has already resolved it.
    //
    // Alt-click writes the BACKGROUND swatch instead, which is Adobe's own rule: "Alt-click
    // (Windows) / Command-Option-click (Mac) to sample to the background color"
    // (https://helpx.adobe.com/photoshop/using/tool-techniques/eyedropper-tool.html). The modifier
    // is `altKey` on both platforms, so there is no platform branch here.
    dispatch({ type: event.altKey ? 'SET_BACKGROUND_COLOR' : 'SET_COLOR', payload: readback.color });
  };

  return (
    <div className={`${className} cursor-crosshair`} onPointerDown={handlePointerDown} style={{ userSelect: 'none' }} />
  );
};
