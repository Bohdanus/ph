import { type PointerEvent, type RefObject } from 'react';
import { usePointerPosition } from '../../hooks/usePointerPosition.ts';
import { useStore } from '../../contexts/StoreContext.tsx';
import { useCurrentTool } from '../../contexts/useCurrentTool.tsx';
import type { EyedropperSampleSize, EyedropperToolArgs } from '../../tools/eyedropper.ts';
import { canvasToDocumentPoint, documentFrameFromSize } from '../../contexts/document-frame.ts';

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
 * `Sample All Layers` renders `disabled` in the options bar because it needs a composite read of
 * every visible layer, and the single workspace canvas is not that. It is a no-op input, not a
 * silently-ignored one: a `true` here reports why nothing happened instead of sampling the active
 * layer's pixels and presenting them as the whole document's.
 */
export const EYEDROPPER_ALL_LAYERS_UNSUPPORTED = 'eyedropper-sample-all-layers-unsupported';

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
 * frame and draws each layer at `position.x - documentFrame.x`, so a document-space point IS a
 * canvas pixel.
 */
export const EyedropperToolArea = ({ className }: EyedropperToolAreaProps) => {
  const [{ canvasRef, containerRef, totalSize, documentFrame: currentFrame }, dispatch] = useStore();
  const documentFrame = currentFrame ?? documentFrameFromSize(totalSize);
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

    const documentSeed = canvasToDocumentPoint(getLocalCoords(event), documentFrame);
    const centerX = Math.floor(documentSeed.x);
    const centerY = Math.floor(documentSeed.y);

    // Sample Size is the side of the square averaged around the click, and all three values are
    // odd, so the block is centred. The block is then CLIPPED to the canvas rather than shifted
    // inward: a click on the border averages the pixels that exist instead of reading out of
    // bounds or quietly sliding the sample off the edge the user clicked.
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
    dispatch({
      type: 'SET_COLOR',
      payload: toHexColor(
        Math.round(red / sampleCount),
        Math.round(green / sampleCount),
        Math.round(blue / sampleCount)
      ),
    });
  };

  return (
    <div className={`${className} cursor-crosshair`} onPointerDown={handlePointerDown} style={{ userSelect: 'none' }} />
  );
};
