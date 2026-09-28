import { type PointerEvent, type RefObject } from 'react';
import { useStore } from '../../contexts/StoreContext.tsx';
import { usePointerPosition } from '../../hooks/usePointerPosition.ts';
import { canvasToDocumentPoint, documentFrameFromSize } from '../../contexts/document-frame.ts';
import type { Point } from '../../contexts/general-types.ts';
import { sampleColorAt } from '../../tools/eyedropper.ts';
import { toHex } from '../../util/pixels.ts';

/**
 * Props are the three `Main.tsx` mounts every tool area with. Only `className` is
 * destructured: this tool samples a layer's cached raster and writes a colour into the
 * store, so it paints nothing onto either context and `canvasCtxRef`/`overlayCtxRef` are
 * part of the mount contract and nothing else.
 */
type eyedropperToolAreaProps = {
  className?: string;
  canvasCtxRef: RefObject<CanvasRenderingContext2D | null>;
  overlayCtxRef: RefObject<CanvasRenderingContext2D | null>;
};

/**
 * The Eyedropper's gesture surface: one click, one sampled colour, and no history entry.
 *
 * ## No `usePaintStroke`, and no layer write at all
 *
 * Every other tool area in this directory either previews through `tempUpdateLayer` or
 * commits through `updateLayerByTool`, because both of those are the only ways pixels
 * reach a layer. This one has no pixels. `SET_COLOR` is a store field write with no
 * `TOOL_ACTION` history item behind it, which is correct: a colour picked from the canvas
 * is not an edit to the canvas, so Ctrl-Z must not walk it back, and the durable
 * `commit: 'unimplemented'` registration (`src/tools/toolProcessors.ts:246-250`) is what
 * says so to the shadow document as well. Reaching for a gesture hook whose `onCommit`
 * contract implies an undoable edit would be the wrong shape for the job.
 *
 * ## The pointer API, and why there is no global listener
 *
 * `usePointerPosition`'s `isPointerDownValid` takes the pointer and `isPointerUpValid`
 * releases it, so a second finger cannot start a second sample and the release is delivered
 * even when the pointer has left the element. There is deliberately no `onPointerMove`:
 * Photoshop keeps sampling for as long as the button is held, and v1 is one click = one
 * sample. The drag-to-sample follow-up belongs in a move handler against the
 * `isPointerMoveValid` gesture this hook already tracks, and it must NOT be a `window`
 * mousemove listener — that would make it possible immediately at the cost of a lifetime
 * that outlives the tool.
 *
 * ## The frame
 *
 * The frame is resolved as `currentFrame ?? documentFrameFromSize(totalSize)`, which is
 * what every other `useStore`-derived frame in the repo does (`MoveToolArea.tsx:28`,
 * `MagicWandToolArea.tsx:20`). After a crop the canvas origin is the frame offset, so a
 * click converted without it lands beside the document.
 */
export const EyedropperToolArea = ({ className }: eyedropperToolAreaProps) => {
  const [{ containerRef, activeLayerId, layers, totalSize, documentFrame: currentFrame }, dispatch] = useStore();
  const documentFrame = currentFrame ?? documentFrameFromSize(totalSize);

  const { getLocalCoords, isPointerDownValid, isPointerUpValid } = usePointerPosition({
    ref: containerRef,
    imageSize: totalSize,
  });

  const activeLayer = activeLayerId ? layers[activeLayerId] : null;

  /**
   * Sample the active layer at a document point and set it as the foreground colour.
   *
   * The layer's raster is the same one the preview and commit paths read
   * (`layer.tmpCanvas ?? layer.bitmap`, `src/contexts/useLayer.ts:530`), so a click reads
   * the pixels the user is looking at rather than a re-rasterized copy of them. A vector
   * layer whose `tmpCanvas` is null is the one case this does not cover:
   * `getLayerBitmap` in `src/contexts/layer-renderer.ts:51-56` re-runs the creator
   * processor for that layer on every draw, and it is private to that module.
   *
   * Bedrock is NOT excluded, unlike in `PaintBucketToolArea`: a bucket needs somewhere to
   * put the colour it finds, and the backdrop is not somewhere. Sampling the document's
   * own image is the eyedropper's most ordinary use.
   *
   * The click is expressed in the LAYER's pixel space, because that is the space
   * `sampleColorAt`'s `size` is in and the one its half-open containment test is against.
   * A click on a layer that does not cover that document point reports no colour, which is
   * Photoshop's behaviour: there is no pixel under the pointer to read.
   */
  const sampleAt = (documentPoint: Point) => {
    if (!activeLayer) return;

    const source = activeLayer.tmpCanvas ?? activeLayer.bitmap;
    if (!source) return;

    const local = { x: documentPoint.x - activeLayer.pos.x, y: documentPoint.y - activeLayer.pos.y };
    const rgba = sampleColorAt({ bitmap: source, size: activeLayer.pos })(local);
    if (!rgba) return;

    dispatch({ type: 'SET_COLOR', payload: toHex(rgba) });
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!isPointerDownValid(event)) return;

    sampleAt(canvasToDocumentPoint(getLocalCoords(event), documentFrame));
  };

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    // Releases the capture `isPointerDownValid` took. The release is not a commit: the
    // sample happened on the press, where the pointer was.
    isPointerUpValid(event);
  };

  return (
    <div
      className={`${className} cursor-copy`}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      style={{ userSelect: 'none' }}
    />
  );
};
