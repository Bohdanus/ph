import { type PointerEvent, type RefObject } from 'react';
import { usePointerPosition } from '../../hooks/usePointerPosition.ts';
import { useStore } from '../../contexts/StoreContext.tsx';
import { useCurrentTool } from '../../contexts/useCurrentTool.tsx';
import type { EyedropperSampleSize, EyedropperToolArgs } from '../../tools/eyedropper.ts';
import { readColorSampler } from '../../tools/color-sampler-readback.ts';
import { addColorSampler, colorSamplerAt, removeColorSampler } from '../../tools/color-sampler-store.ts';

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

const toHexColor = (red: number, green: number, blue: number): string =>
  `#${[red, green, blue].map((channel) => Math.max(0, Math.min(255, channel)).toString(16).padStart(2, '0')).join('')}`;

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
 * the frame origin, and `getLocalCoords` (which returns frame-space coordinates) is already the index
 * `getImageData` wants.
 */
export const EyedropperToolArea = ({ className }: EyedropperToolAreaProps) => {
  const [{ canvasRef, containerRef, totalSize }, dispatch] = useStore();
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

    const ctx = canvas.getContext('2d');
    if (!ctx || typeof ctx.getImageData !== 'function') {
      console.error(EYEDROPPER_READBACK_UNAVAILABLE, 'the eyedropper cannot read the composited canvas');
      return;
    }

    // The composited canvas is drawn in FRAME space: it is sized by `documentFrameSize` and each
    // layer is stamped at `position.x - documentFrame.x` (`src/contexts/layer-renderer.ts:78-79,119`).
    // So the canvas's own pixel (0,0) is the frame origin, and `getLocalCoords` is already the
    // index `getImageData` wants. Running it through `canvasToDocumentPoint` first would ADD the
    // frame origin a second time: after a crop that trims 100px off the left, a click on canvas
    // x=100 read canvas x=200, and a click past 600 read entirely outside the bitmap and silently
    // dispatched nothing, which reads as a dead tool.
    const canvasSeed = getLocalCoords(event);
    const centerX = Math.floor(canvasSeed.x);
    const centerY = Math.floor(canvasSeed.y);

    // Adobe's Shift-click path, resolved BEFORE the readback below because it does not use this
    // tool's sample at all: it places a sampler, which is the Color Sampler's store and overlay.
    // The readback module is shared so the two call sites cannot disagree about which document
    // pixel a point names.
    if (shiftClickPlacesSampler(event)) {
      const hit = colorSamplerAt({ x: centerX, y: centerY });
      if (hit && event.altKey) {
        removeColorSampler(hit.id);
        return;
      }
      const samplerReadback = readColorSampler(canvas, { x: centerX, y: centerY }, args.sampleSize);
      if (!samplerReadback.ok) {
        console.error(samplerReadback.reason, 'the color sampler cannot read the composited canvas');
        return;
      }
      if (samplerReadback.color === null) return;
      const placed = addColorSampler({ x: centerX, y: centerY }, samplerReadback.color);
      if (!placed.ok) console.error(placed.reason, `the color sampler holds ${placed.samplers.length} samples`);
      return;
    }

    // Sample Size is the side of the square averaged around the click, and all seven values Adobe
    // offers are odd, so the block is centred. The block is then CLIPPED to the canvas rather than
    // shifted inward: a click on the border averages the pixels that exist instead of reading out
    // of bounds or quietly sliding the sample off the edge the user clicked.
    //
    // The centre pixel must be inside the canvas before the clipping math below is safe: `getLocalCoords`
    // returns frame-space coordinates, and a click in the contain-fit padding (outside the canvas bitmap
    // but inside the container) can be negative or past `canvas.width`. With `sampleSize === 1` the
    // `right <= left` guard at the next step catches every out-of-bounds case, but with a larger sample
    // size the clipped block CAN be non-empty while the centre pixel is outside it, which would index
    // a negative offset into the pixel array — `Uint8ClampedArray` returns `undefined` for negative
    // indices, so the alpha check would read the wrong byte and the average would include padding.
    // `sampleColorAt` makes the same check (`src/tools/colorSampler.ts:146`).
    if (centerX < 0 || centerY < 0 || centerX >= canvas.width || centerY >= canvas.height) return;

    const sampleSize: EyedropperSampleSize = args.sampleSize;
    const half = Math.floor(sampleSize / 2);
    const left = Math.max(0, centerX - half);
    const top = Math.max(0, centerY - half);
    const right = Math.min(canvas.width, centerX + half + 1);
    const bottom = Math.min(canvas.height, centerY + half + 1);
    if (right <= left || bottom <= top) return;

    const { data } = ctx.getImageData(left, top, right - left, bottom - top);
    const sampleCount = Math.floor(data.length / 4);
    if (sampleCount === 0) return;

    // A fully transparent pixel has no colour to report. The app's foreground is a CSS colour on
    // an `<input type="color">`, which cannot express transparency, so averaging one in would
    // silently set the foreground to black. Photoshop shows a crossed-out swatch and changes
    // nothing, so nothing is dispatched here either.
    if (data[(centerY - top) * (right - left) * 4 + (centerX - left) * 4 + 3] === 0) return;

    let red = 0;
    let green = 0;
    let blue = 0;
    for (let index = 0; index < sampleCount; index++) {
      red += data[index * 4];
      green += data[index * 4 + 1];
      blue += data[index * 4 + 2];
    }

    // Alpha is dropped: the store's foreground is a CSS colour consumed by an `<input type="color">`,
    // which cannot express it, and the composited canvas has already resolved it.
    //
    // Alt-click writes the BACKGROUND swatch instead, which is Adobe's own rule: "Alt-click
    // (Windows) / Command-Option-click (Mac) to sample to the background color"
    // (https://helpx.adobe.com/photoshop/using/tool-techniques/eyedropper-tool.html). The modifier
    // is `altKey` on both platforms, so there is no platform branch here.
    const sampledColor = toHexColor(
      Math.round(red / sampleCount),
      Math.round(green / sampleCount),
      Math.round(blue / sampleCount)
    );
    dispatch({ type: event.altKey ? 'SET_BACKGROUND_COLOR' : 'SET_COLOR', payload: sampledColor });
  };

  return (
    <div className={`${className} cursor-crosshair`} onPointerDown={handlePointerDown} style={{ userSelect: 'none' }} />
  );
};
