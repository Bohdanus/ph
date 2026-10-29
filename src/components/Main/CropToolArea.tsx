import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { isEqual } from 'lodash-es';
import { ROTATE_HANDLE_OFFSET, useRect } from '../../hooks/useRect.ts';
import { MAX_DOCUMENT_FRAME_SIDE, useLayers } from '../../contexts/useLayer.ts';
import { sortRoundRect } from '../../util/rect.ts';
import { HANDLE_SIZE, SET_DOCUMENT_FRAME_ACTION } from '../../util/constants.ts';
import type { ContainDimensions } from '../../util/contain-fit.ts';
import { CROP_OVERLAYS, type CropToolArgs, type CropOverlayType } from '../../tools/crop.ts';
import { getCropOverlayGeometry, sampleCropGuideColor, type CropGuideSample } from '../../tools/crop-overlay.ts';
import { useStore } from '../../contexts/StoreContext.tsx';
import { useCurrentTool } from '../../contexts/useCurrentTool.tsx';
import type { Pos, RectXYSorted, Size } from '../../contexts/general-types.ts';
import type { DocumentFrameHistoryArgs, HistoryItem } from '../../contexts/history-types.ts';
import {
  documentFrameFromSize,
  documentFrameSize,
  isValidDocumentFrame,
  type DocumentFrame,
} from '../../contexts/document-frame.ts';
import { drawLayersToCanvas } from '../../contexts/layer-renderer.ts';
import { getSortedLayersArray } from '../../contexts/layer-utils.ts';
import { useDevicePixelRatio } from '../../hooks/useDevicePixelRatio.ts';
import { effectiveViewZoom } from '../../contexts/view-state.ts';

type cropToolAreaProps = {
  className?: string;
  overlayCtxRef: RefObject<CanvasRenderingContext2D | null>;
};

/** `useRect`'s `drawMask` fills the document frame with this alpha on every repaint. */
const DIM = 'rgba(0, 0, 0, 0.7)';
/** Crop outline and handle colour. */
const OUTLINE = '#007bff';
/** Crop outline width, kept at two CSS px at every contain fit. */
const OUTLINE_WIDTH = 2;
/** Crop outline dash length, kept at five CSS px at every contain fit. */
const OUTLINE_DASH = 5;
/** Keep a tiny color snapshot so changing the crop does not read pixels from the full canvas. */
const GUIDE_SAMPLE_MAX_SIDE = 96;
const ROTATE_HANDLE_RADIUS = 4;

type OverhangPiece = Pos;

/**
 * `base` minus `cut`, as the rects that cover what is left.
 *
 * Up to four pieces, disjoint and non-overlapping, and `[]` when `cut` swallows `base`. This is
 * the only shape the overhang overlay needs: both of its parts are "something minus something" —
 * the letterbox minus the crop box — and both of those `something`s can overlap, which a
 * single-rect subtraction cannot express. Crop chrome itself is rendered by one overflow-safe
 * surface so the guide and outline are not split at the frame edge.
 *
 * A rect wholly inside `cut` has to come back empty rather than unchanged, so every piece is
 * measured against `cut`'s overlap rather than emitted whole.
 */
function subtractRect(base: Pos, cut: Pos): Pos[] {
  const right = base.x + base.width;
  const bottom = base.y + base.height;
  const cutRight = cut.x + cut.width;
  const cutBottom = cut.y + cut.height;

  const left = Math.max(base.x, cut.x);
  const top = Math.max(base.y, cut.y);
  const innerRight = Math.min(right, cutRight);
  const innerBottom = Math.min(bottom, cutBottom);

  // Disjoint, so `base` survives whole.
  if (left >= innerRight || top >= innerBottom) return [base];

  const pieces: Pos[] = [
    { x: base.x, y: base.y, width: base.width, height: top - base.y },
    { x: base.x, y: innerBottom, width: base.width, height: bottom - innerBottom },
    { x: base.x, y: top, width: left - base.x, height: innerBottom - top },
    { x: innerRight, y: top, width: right - innerRight, height: innerBottom - top },
  ];

  return pieces.filter((piece) => piece.width > 0 && piece.height > 0);
}

function subtractRects(bases: readonly Pos[], cuts: readonly Pos[]): Pos[] {
  return cuts.reduce((pieces, cut) => pieces.flatMap((piece) => subtractRect(piece, cut)), [...bases]);
}

const MAX_RECOVERY_PREVIEW_BACKING_SIDE = MAX_DOCUMENT_FRAME_SIDE;

/** The extent represented by the active crop history and the currently visible frame. */
function getHistoryFrameBounds(
  history: readonly HistoryItem[],
  historyIndex: number,
  currentFrame: DocumentFrame
): DocumentFrame {
  let x = currentFrame.x;
  let y = currentFrame.y;
  let right = currentFrame.x + currentFrame.width;
  let bottom = currentFrame.y + currentFrame.height;
  const includeFrame = (candidate: unknown) => {
    if (!isValidDocumentFrame(candidate)) return;
    x = Math.min(x, candidate.x);
    y = Math.min(y, candidate.y);
    right = Math.max(right, candidate.x + candidate.width);
    bottom = Math.max(bottom, candidate.y + candidate.height);
  };

  for (const item of history.slice(0, historyIndex + 1)) {
    if (item.actionName !== SET_DOCUMENT_FRAME_ACTION) continue;
    const args = item.args as DocumentFrameHistoryArgs | undefined;
    // A disabled frame action still establishes the replay baseline and its pixels remain in the
    // layer sources. Later active crops can therefore leave those original bounds recoverable.
    includeFrame(args?.previousFrame);
    includeFrame(args?.nextFrame);
  }

  return { x, y, width: right - x, height: bottom - y };
}

/** The fixed frame containing the visible frame and retained pixels used by the live preview. */
function getRecoveryPreviewFrame(
  frame: DocumentFrame,
  retainedFrame: DocumentFrame,
  angle: number
): DocumentFrame | null {
  if (angle !== 0) return null;

  // Crop movement changes the window, not the pixels available to preview. Keeping this frame
  // fixed to the current and retained source bounds prevents every pointer frame from resizing
  // the preview canvas and recompositing the complete layer stack. Areas beyond these bounds are
  // transparent; the pending crop can still grow over them without allocating another preview.
  const x = Math.min(frame.x, retainedFrame.x);
  const y = Math.min(frame.y, retainedFrame.y);
  const right = Math.max(frame.x + frame.width, retainedFrame.x + retainedFrame.width);
  const bottom = Math.max(frame.y + frame.height, retainedFrame.y + retainedFrame.height);
  const previewFrame = { x, y, width: right - x, height: bottom - y };
  if (![x, y, previewFrame.width, previewFrame.height].every(Number.isFinite)) return null;

  const retainedPixelsExtendFrame =
    retainedFrame.x < frame.x ||
    retainedFrame.y < frame.y ||
    retainedFrame.x + retainedFrame.width > frame.x + frame.width ||
    retainedFrame.y + retainedFrame.height > frame.y + frame.height;
  if (!retainedPixelsExtendFrame) return null;

  const { width, height } = documentFrameSize(previewFrame);
  const shorterSide = Math.min(width, height);
  const longerSide = Math.max(width, height);
  // At more extreme aspect ratios, even the longest safe backing edge cannot represent one
  // backing pixel on the short edge. Do not mount an empty preview canvas in that case.
  if (shorterSide <= 0 || longerSide / shorterSide > MAX_RECOVERY_PREVIEW_BACKING_SIDE * 2) return null;

  return previewFrame;
}

// drawLayersToCanvas can hold a target, staging surface, snapshot, and fallback snapshot at once.
// Budget their aggregate frame-sized backing stores; resizeCanvas rounds each dimension separately.
const MAX_RECOVERY_PREVIEW_TOTAL_BACKING_PIXELS = 16_777_216;
// drawLayersToCanvas uses the source canvas as its target plus staging/snapshot surfaces. The
// visible masked preview is one additional frame-sized surface, so include it in the budget.
const MAX_RECOVERY_PREVIEW_SURFACES = 5;
const MAX_RECOVERY_PREVIEW_BACKING_PIXELS = Math.floor(
  MAX_RECOVERY_PREVIEW_TOTAL_BACKING_PIXELS / MAX_RECOVERY_PREVIEW_SURFACES
);
function getRecoveryPreviewBackingScale(frame: DocumentFrame, dpr: number): number {
  const { width, height } = documentFrameSize(frame);
  const fitsBackingBudget = (scale: number) => {
    const backingWidth = Math.round(width * scale);
    const backingHeight = Math.round(height * scale);
    return (
      backingWidth > 0 &&
      backingHeight > 0 &&
      backingWidth <= MAX_RECOVERY_PREVIEW_BACKING_SIDE &&
      backingHeight <= MAX_RECOVERY_PREVIEW_BACKING_SIDE &&
      backingWidth * backingHeight <= MAX_RECOVERY_PREVIEW_BACKING_PIXELS
    );
  };
  let low = 0;
  // Divide the square roots separately so a large finite frame does not overflow width*height.
  const areaScale = Math.sqrt(MAX_RECOVERY_PREVIEW_BACKING_PIXELS) / Math.sqrt(width) / Math.sqrt(height);
  const sideScale = Math.min(MAX_RECOVERY_PREVIEW_BACKING_SIDE / width, MAX_RECOVERY_PREVIEW_BACKING_SIDE / height);
  // A valid backing canvas needs at least one pixel on both sides. At very low DPR, preserve that
  // minimum rather than handing drawLayersToCanvas a zero-sized surface for an otherwise supported
  // retained frame.
  const minimumNonZeroScale = 0.5 / Math.min(width, height);
  let high = Math.min(Math.max(dpr, minimumNonZeroScale), areaScale, sideScale);
  if (fitsBackingBudget(high)) return high;

  // Ideal width*height sizing is not enough: independently rounded canvas edges can exceed it.
  for (let attempt = 0; attempt < 32; attempt++) {
    const middle = (low + high) / 2;
    if (fitsBackingBudget(middle)) low = middle;
    else high = middle;
  }
  return low;
}

/**
 * CANVAS px, not document px: every number below is in the frame's own space, whose origin is the
 * frame origin. `onRepaint`'s rect comes from `getLocalCoords()`
 * and `fit` from `containFit()` over the same `totalSize`, and
 * `totalSize` is `documentFrameSize(documentFrame)` — so neither of them carries `documentFrame.x`
 * and nothing here may subtract it. Document space is one call away, `canvasRectToDocumentFrame`
 * (`canvasRectToDocumentFrame()`), and this layer sits BEFORE that call, not after it.
 *
 * The part of a crop box that has left the frame, as CSS rectangles.
 *
 * Everything is in canvas px because that is the coordinate system `useRect` paints in, and the
 * caller puts these under a single `translate(offsetX, offsetY) scale(scale)` layer — the same fit
 * `getLocalCoords` divides by, read out of the same `dimensionsRef`. A canvas coordinate and a
 * position inside this overlay are therefore two names for one place, not two measurements that
 * have to be kept in agreement.
 *
 * The document frame is `[0, 0, totalSize]` here, exactly, in canvas px, which is why no clamping
 * is needed anywhere below: an overhang is a NEGATIVE coordinate, and the only question is whether
 * anything is painted at it.
 *
 * `[]` when the box fits inside the frame and there are no retained pixels beyond it. A reopened
 * non-destructive crop is different: the retained preview occupies the letterbox and needs the
 * same dim layer even before the user moves a handle.
 */
function cropOverhangPieces(
  rect: RectXYSorted,
  frameSize: Size,
  fit: ContainDimensions,
  shadeLetterboxForRetainedPixels: boolean,
  retainedPixelsOutsideFrame: readonly Pos[]
): OverhangPiece[] {
  const frameRect: Pos = { x: 0, y: 0, width: frameSize.width, height: frameSize.height };

  const box = sortRoundRect(rect);

  const overhangs =
    box.x < frameRect.x ||
    box.y < frameRect.y ||
    box.x + box.width > frameRect.x + frameRect.width ||
    box.y + box.height > frameRect.y + frameRect.height;
  if (!overhangs && !shadeLetterboxForRetainedPixels) return [];

  // An unmeasured fit reports `outerWidth` 0, and the frame rect can be degenerate on a 0-size
  // frame. Either way there is no letterbox to shade, and dividing by a 0 scale is not a
  // number this can recover from.
  if (!fit.scale || !fit.outerWidth || !fit.outerHeight) return [];

  // Each letterbox side, measured in canvas px: the gap the contain fit leaves around the frame,
  // divided by the divisor that gap was computed with. Exact rather than a round number, so the
  // bands stop at the container edge instead of being clipped there.
  const above = fit.offsetY / fit.scale;
  const left = fit.offsetX / fit.scale;
  const right = fit.outerWidth / fit.scale - left - frameRect.width;
  const below = fit.outerHeight / fit.scale - above - frameRect.height;

  const bands: Pos[] = [
    { x: -left, y: -above, width: frameRect.width + left + right, height: above },
    { x: -left, y: frameRect.height, width: frameRect.width + left + right, height: below },
    { x: -left, y: 0, width: left, height: frameRect.height },
    { x: frameRect.x + frameRect.width, y: 0, width: right, height: frameRect.height },
  ];

  // The dim, minus the box: outside the frame AND outside the box is what Photoshop darkens, and
  // the part of the frame that overhangs is not dark. The canvas darkens the in-frame side of
  // that pair already, which is why the frame is subtracted out of these bands rather than
  // shaded along with them — overlapping two `DIM` layers would render at 0.91.
  const dims = subtractRects(
    bands.flatMap((band) => subtractRect(band, box)),
    retainedPixelsOutsideFrame
  );

  return dims.filter((piece) => piece.width > 0 && piece.height > 0);
}

export const CropToolArea = ({ className }: cropToolAreaProps) => {
  const [
    { containerRef, toolOverlayRef, canvasRef, totalSize, documentFrame, layers, history, historyIndex, viewState },
  ] = useStore();
  const { toolArgs, setToolArgs } = useCurrentTool();
  const { applyDocumentCrop } = useLayers();
  const dpr = useDevicePixelRatio();

  const args = toolArgs as CropToolArgs;
  const {
    aspectRatio,
    rect,
    angle = 0,
    overlayType = 'ruleOfThirds',
    overlayOrientation = 0,
    overlayVisibility = 'always',
    gridDivisions = 10,
  } = args;
  const frameWidth = totalSize.width;
  const frameHeight = totalSize.height;
  const viewTransform = `translate(${viewState.panX}px, ${viewState.panY}px) scale(${effectiveViewZoom(viewState)}) rotate(${viewState.rotation}deg)`;
  const currentFrame = useMemo(
    () => documentFrame ?? documentFrameFromSize({ width: frameWidth, height: frameHeight }),
    [documentFrame, frameHeight, frameWidth]
  );
  const initialFrameRect = useMemo(
    () => ({ x1: 0, y1: 0, x2: frameWidth, y2: frameHeight }),
    [frameHeight, frameWidth]
  );
  const hasAppliedFrameChange = useMemo(
    () =>
      history
        .slice(0, historyIndex + 1)
        .some((item) => item.actionName === SET_DOCUMENT_FRAME_ACTION && !item.disabled),
    [history, historyIndex]
  );
  // Applying a crop leaves this tool mounted. Show retained pixels when Crop is opened after a
  // frame change, but wait until it is reopened instead of changing the just-applied result in place.
  const [openedWithFrameChange] = useState(hasAppliedFrameChange);
  const canPreviewRetainedPixels = openedWithFrameChange && hasAppliedFrameChange;
  const initialRect = rect ?? (hasAppliedFrameChange ? initialFrameRect : null);

  const clearDraft = () =>
    args.angle === undefined
      ? { ...args, rect: null, preRatioRect: null }
      : { ...args, angle: 0, rect: null, preRatioRect: null };

  /**
   * Photoshop commits a crop with Enter and abandons it with Escape, so the panel's Apply and Clear
   * are not the only two ways in. The listener lives here rather than in the shared keyboard table
   * because `Main` mounts this component only while the crop tool owns the gesture surface
   * (the crop event handler is selected by interaction mode in `Main`): the binding is scoped to the tool by construction, so no
   * table entry is added and no other tool can reach it.
   *
   * The two actions go through a ref rather than closing over the values because the crop args are
   * replaced on every pointer move and `applyDocumentCrop` is rebuilt on every render; depending on
   * either would tear the window listener down and re-add it on every frame of a drag. The ref is
   * refreshed in an effect, the same shape `TextToolArea` uses for its own args ref.
   */
  const cropKeysRef = useRef({ commit: () => {}, cancel: () => {} });
  const overlayKeysRef = useRef({ args, overlayType, overlayOrientation });
  const setCurrentCropArgs = (nextArgs: typeof args) => {
    overlayKeysRef.current = { ...overlayKeysRef.current, args: nextArgs };
    setToolArgs(nextArgs);
  };

  useEffect(() => {
    overlayKeysRef.current = { args, overlayType, overlayOrientation };
  });

  useEffect(() => {
    cropKeysRef.current = {
      commit: () => {
        if (
          args.rect &&
          (args.angle === undefined ? applyDocumentCrop(args.rect) : applyDocumentCrop(args.rect, args.angle))
        ) {
          setToolArgs(clearDraft());
        }
      },
      cancel: () => {
        if (!args.rect && !args.preRatioRect) return;
        setToolArgs(clearDraft());
      },
    };
  });

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        event.target instanceof HTMLSelectElement
      )
        return;
      if (event.key.toLowerCase() === 'o') {
        event.preventDefault();
        event.stopPropagation();
        const current = overlayKeysRef.current;
        if (event.shiftKey && (current.overlayType === 'triangle' || current.overlayType === 'goldenSpiral')) {
          const orientationCount = current.overlayType === 'triangle' ? 4 : 8;
          const currentOrientation =
            typeof current.overlayOrientation === 'number'
              ? current.overlayOrientation
              : current.overlayOrientation === 'flipped'
                ? 1
                : 0;
          setToolArgs({
            ...current.args,
            overlayType: current.overlayType,
            overlayOrientation: (currentOrientation + 1) % orientationCount,
          });
        } else if (!event.shiftKey) {
          const index = CROP_OVERLAYS.indexOf(current.overlayType);
          setToolArgs({
            ...current.args,
            overlayType: CROP_OVERLAYS[(index + 1) % CROP_OVERLAYS.length] as CropOverlayType,
            overlayOrientation: 0,
          });
        }
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        event.stopPropagation();
        cropKeysRef.current.commit();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        cropKeysRef.current.cancel();
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [setToolArgs]);

  /**
   * What `useRect`'s painter last drew, and the contain fit it drew it with.
   *
   * `onRepaint` is the only reading of the geometry in this file, and it is a reading taken INSIDE
   * the painter: `drawMask` has already resolved `dimensionsRef.current` for this frame and has
   * already decided which corners to stroke at, and `onRepaint` hands back the rect it used. So the
   * overhang overlay below is not a second opinion about where the box is — it is the painter's own
   * answer, carried across to a surface that is not clipped by the frame-sized backing store.
   *
   * That is also why nothing here re-measures the container, re-runs `containFit`, or keeps a
   * `useState` copy of the rect that a drag or the panel writes: a second measurement path is a
   * second thing that can disagree with the canvas, and the whole point is that this cannot.
   */
  const [painted, setPainted] = useState<{
    rect: RectXYSorted;
    fit: ContainDimensions;
    isDragging: boolean;
  } | null>(null);
  const previousRectRef = useRef(rect);
  useEffect(() => {
    if (previousRectRef.current && !rect) setPainted(null);
    previousRectRef.current = rect;
  }, [rect]);

  const recoveryPreviewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const recoveryPreviewSourceCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const guideSampleCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const renderedRecoveryPreviewRef = useRef<{ frame: DocumentFrame; backingScale: number } | null>(null);
  const [renderedRecoveryPreview, setRenderedRecoveryPreview] = useState<{
    frame: DocumentFrame;
    backingScale: number;
  } | null>(null);
  const [cropGuideSample, setCropGuideSample] = useState<CropGuideSample | null>(null);
  const retainedFrame = useMemo(
    () => getHistoryFrameBounds(history, historyIndex, currentFrame),
    [currentFrame, history, historyIndex]
  );
  const recoveryPreviewFrame = useMemo(
    () => (canPreviewRetainedPixels ? getRecoveryPreviewFrame(currentFrame, retainedFrame, angle) : null),
    [angle, canPreviewRetainedPixels, currentFrame, retainedFrame]
  );
  const hasRecoveryPreview = recoveryPreviewFrame !== null;
  const [hadRecoveryPreview, setHadRecoveryPreview] = useState(hasRecoveryPreview);
  if (hadRecoveryPreview !== hasRecoveryPreview) {
    setHadRecoveryPreview(hasRecoveryPreview);
    if (!hasRecoveryPreview) setRenderedRecoveryPreview(null);
  }
  // A failed recomposition leaves the previous canvas pixels in place. Keep their frame alongside
  // them so a history/frame change cannot stretch those pixels into the new preview geometry.
  const visibleRecoveryPreviewFrame = recoveryPreviewFrame
    ? (renderedRecoveryPreview?.frame ?? recoveryPreviewFrame)
    : null;
  const hasPaintedRect = painted !== null;
  const retainedPixelsOutsideFrame = useMemo(() => {
    if (!painted || !visibleRecoveryPreviewFrame || angle !== 0) return [];
    const previewRect: Pos = {
      x: visibleRecoveryPreviewFrame.x - currentFrame.x,
      y: visibleRecoveryPreviewFrame.y - currentFrame.y,
      width: visibleRecoveryPreviewFrame.width,
      height: visibleRecoveryPreviewFrame.height,
    };
    const currentFrameRect: Pos = { x: 0, y: 0, width: totalSize.width, height: totalSize.height };
    return subtractRects([previewRect], [currentFrameRect, sortRoundRect(painted.rect)]);
  }, [angle, currentFrame, painted, totalSize.height, totalSize.width, visibleRecoveryPreviewFrame]);
  const recoveryPreviewBackingScale = recoveryPreviewFrame
    ? getRecoveryPreviewBackingScale(recoveryPreviewFrame, dpr)
    : 1;

  useEffect(() => {
    if (!recoveryPreviewFrame) {
      renderedRecoveryPreviewRef.current = null;
      const sourceCanvas = recoveryPreviewSourceCanvasRef.current;
      if (sourceCanvas) {
        // A crop can remain mounted while undo removes the last retained area. Drop its potentially
        // large backing store instead of holding it for the rest of the tool session.
        sourceCanvas.width = 1;
        sourceCanvas.height = 1;
        sourceCanvas.removeAttribute('data-hidpi-ratio');
      }
      return;
    }
    const previewCanvas = recoveryPreviewCanvasRef.current;
    if (!previewCanvas) return;
    const sourceCanvas = (recoveryPreviewSourceCanvasRef.current ??= document.createElement('canvas'));

    const presentPreview = () => {
      const previewContext = previewCanvas.getContext('2d');
      if (!previewContext) return false;
      if (previewCanvas.width !== sourceCanvas.width) previewCanvas.width = sourceCanvas.width;
      if (previewCanvas.height !== sourceCanvas.height) previewCanvas.height = sourceCanvas.height;
      previewContext.setTransform(1, 0, 0, 1, 0, 0);
      previewContext.drawImage(sourceCanvas, 0, 0);
      // The main canvas already shows this portion. Clear it so semi-transparent layers are not
      // composited twice; only retained pixels beyond the current frame belong on this overlay.
      previewContext.setTransform(recoveryPreviewBackingScale, 0, 0, recoveryPreviewBackingScale, 0, 0);
      previewContext.clearRect(
        currentFrame.x - recoveryPreviewFrame.x,
        currentFrame.y - recoveryPreviewFrame.y,
        currentFrame.width,
        currentFrame.height
      );
      previewContext.setTransform(1, 0, 0, 1, 0, 0);
      return true;
    };

    // Keep the composed source uncut. The visible preview clears the current frame to avoid
    // double-compositing, but a later frame shrink can expose pixels that were cleared during the
    // previous crop. Recopying from this source restores those pixels without recomposing when a
    // subsequent composition fails.
    const composed = drawLayersToCanvas(
      sourceCanvas,
      getSortedLayersArray(layers),
      recoveryPreviewFrame,
      undefined,
      recoveryPreviewBackingScale
    );
    if (!composed) {
      const previous = renderedRecoveryPreviewRef.current;
      if (
        previous &&
        previous.backingScale === recoveryPreviewBackingScale &&
        isEqual(previous.frame, recoveryPreviewFrame)
      )
        presentPreview();
      return;
    }

    if (!presentPreview()) return;
    const previous = renderedRecoveryPreviewRef.current;
    const rendered =
      previous && previous.backingScale === recoveryPreviewBackingScale && isEqual(previous.frame, recoveryPreviewFrame)
        ? previous
        : { frame: recoveryPreviewFrame, backingScale: recoveryPreviewBackingScale };
    renderedRecoveryPreviewRef.current = rendered;
    setRenderedRecoveryPreview(rendered);
  }, [currentFrame, hasPaintedRect, layers, recoveryPreviewBackingScale, recoveryPreviewFrame]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const documentCanvas = canvasRef.current;
      if (!documentCanvas || !totalSize.width || !totalSize.height) {
        setCropGuideSample(null);
        return;
      }

      let sampleCanvas = guideSampleCanvasRef.current;
      if (!sampleCanvas) {
        sampleCanvas = document.createElement('canvas');
        guideSampleCanvasRef.current = sampleCanvas;
      }
      const sampleScale = Math.min(
        1,
        GUIDE_SAMPLE_MAX_SIDE / totalSize.width,
        GUIDE_SAMPLE_MAX_SIDE / totalSize.height
      );
      const width = Math.max(1, Math.round(totalSize.width * sampleScale));
      const height = Math.max(1, Math.round(totalSize.height * sampleScale));
      if (sampleCanvas.width !== width) sampleCanvas.width = width;
      if (sampleCanvas.height !== height) sampleCanvas.height = height;

      const context = sampleCanvas.getContext('2d', { willReadFrequently: true });
      if (!context) return;
      try {
        context.clearRect(0, 0, width, height);
        context.drawImage(documentCanvas, 0, 0, width, height);
        const imageData = context.getImageData(0, 0, width, height);
        setCropGuideSample({ data: imageData.data, width, height });
      } catch {
        setCropGuideSample(null);
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [canvasRef, dpr, layers, totalSize.height, totalSize.width]);

  const paintedCropRect = painted ? sortRoundRect(painted.rect) : null;
  const cropGuideColor = useMemo(
    () =>
      paintedCropRect ? sampleCropGuideColor(cropGuideSample, paintedCropRect, totalSize) : 'rgba(255, 255, 255, 0.8)',
    [cropGuideSample, paintedCropRect, totalSize]
  );
  const sampleCropOverlayColor = useCallback(
    (sampleRect: Pos) => sampleCropGuideColor(cropGuideSample, sampleRect, totalSize),
    [cropGuideSample, totalSize.height, totalSize.width]
  );

  const { pointerHandlers, rectHandles, pointerState } = useRect({
    imageSize: totalSize,
    initialRect,
    containerRef,
    overlayRef: toolOverlayRef,
    aspectRatio,
    // Adobe's crop modifiers, and the reason `useRect` asks per consumer rather than deciding:
    // Shift holds a FRESH drag to a square whatever the bar's Ratio says, Option/Alt grows it out
    // from the press point, and the pair is a square centred on that point. The rectangular
    // marquee already passes the same two; the Move and text tools deliberately pass neither, and
    // a handle resize keeps the ratio `getEdgeAtPoint` captures on its own.
    constrainToSquare: true,
    fromCentre: true,
    // Crop is the one consumer whose box may run off the frame, so it keeps the overhang instead
    // of snapping back to the frame edge.
    allowOutsideCanvas: true,
    // The frame-sized overlay canvas clips crop chrome at the document edge. At angle zero the
    // overflow-safe surface below owns the shade, guides and handles across the full crop rect;
    // rotated crops keep the canvas painter, which repaints only the previous crop's dirty bounds.
    hideBlend: angle === 0,
    externalOverlay: angle === 0,
    incrementalOverlay: angle !== 0,
    hideBorder: angle === 0,
    hideHandles: angle === 0,
    hideRotationHandle: angle === 0,
    rotationEnabled: true,
    rotation: angle,
    onRotationChange: (nextAngle: number) => setCurrentCropArgs({ ...overlayKeysRef.current.args, angle: nextAngle }),
    overlayType: angle === 0 ? undefined : overlayType,
    overlayColorForRect: angle === 0 ? undefined : sampleCropOverlayColor,
    overlayOrientation,
    overlayVisibility,
    gridDivisions,

    documentCanvasRef: canvasRef,

    onRepaint: (sortedRect: RectXYSorted) => {
      // Read after this render has bound `pointerState`. The closure runs from inside `drawMask`,
      // never during render, so the binding is always initialised by the time it is read.
      const fit = pointerState.dimensionsRef.current;
      const isDragging = pointerState.isMouseDown.current;

      setPainted((current) =>
        current && current.fit === fit && current.isDragging === isDragging && isEqual(current.rect, sortedRect)
          ? current
          : { rect: sortedRect, fit, isDragging }
      );
    },

    onChangeEnd: (newRect: RectXYSorted) => {
      // Degenerate, not "does not fit". `trimRect` answered the wrong question: a box dragged past
      // one edge was clamped against the opposite one, and a box lying wholly outside collapsed onto
      // a point — so a rect with a real 200px of extent was discarded as empty exactly when the
      // overhang feature needs it kept. `sortRoundRect` is the same sort and the same one-round-
      // per-edge rounding with the clamp dropped, so only a genuinely collapsed rect is nulled.
      const { width, height } = sortRoundRect(newRect);

      // `preRatioRect` is cleared on both paths. The panel clears it on its own writes, and this
      // writer is the one a drag goes through: a drag while a ratio is set refits the rect, so the
      // framing recorded before that ratio is no longer what the next `Free`/`Original` should
      // restore. Left in place, it survives into the next ratio change as a stale framing.
      if (width === 0 || height === 0) {
        // return null if nothing selected or if selection is degenerate
        setCurrentCropArgs({ ...overlayKeysRef.current.args, rect: null, preRatioRect: null });
      } else {
        setCurrentCropArgs({ ...overlayKeysRef.current.args, rect: newRect, preRatioRect: null });
      }
    },
    onCancel: () => setPainted(null),
  });

  const previousDprRef = useRef(dpr);
  useEffect(() => {
    if (previousDprRef.current === dpr) return;
    previousDprRef.current = dpr;

    // Main resizes the shared overlay backing store when DPR changes. Canvas resize resets its
    // pixels, so restore rotated crop chrome in the next frame after that resize has run.
    const frame = requestAnimationFrame(() => rectHandles.redraw());
    return () => cancelAnimationFrame(frame);
  }, [dpr, rectHandles.redraw]);

  // `painted` tracks pointer motion before `onChangeEnd` publishes the draft rect, so the crop box
  // and its retained-pixel preview can follow the pointer live. A committed/cancelled draft clears
  // the last painted geometry when `rect` transitions back to null.
  const overhangPieces = painted
    ? cropOverhangPieces(
        painted.rect,
        totalSize,
        painted.fit,
        visibleRecoveryPreviewFrame !== null,
        retainedPixelsOutsideFrame
      )
    : [];
  const cropChromeRect = paintedCropRect && angle === 0 ? paintedCropRect : null;
  const inFrameDimPieces =
    paintedCropRect && angle === 0
      ? subtractRect({ x: 0, y: 0, width: totalSize.width, height: totalSize.height }, paintedCropRect)
      : [];
  const cropOutlineWidth = painted ? OUTLINE_WIDTH / painted.fit.scale : 0;
  const cropOutlineDash = painted ? OUTLINE_DASH / painted.fit.scale : 0;
  const cropHandleSize = painted ? HANDLE_SIZE / painted.fit.scale : 0;
  const cropGuideWidth = painted ? 1 / painted.fit.scale : 1;
  const cropGuideGeometry = cropChromeRect
    ? getCropOverlayGeometry(
        cropChromeRect.width,
        cropChromeRect.height,
        overlayType,
        overlayOrientation,
        gridDivisions
      )
    : null;
  const showCropGuide =
    painted && overlayVisibility !== 'never' && !(overlayVisibility === 'auto' && !painted.isDragging);
  const cropCorners = cropChromeRect
    ? [
        { name: 'top-left', x: cropChromeRect.x, y: cropChromeRect.y },
        { name: 'top-right', x: cropChromeRect.x + cropChromeRect.width, y: cropChromeRect.y },
        { name: 'bottom-left', x: cropChromeRect.x, y: cropChromeRect.y + cropChromeRect.height },
        {
          name: 'bottom-right',
          x: cropChromeRect.x + cropChromeRect.width,
          y: cropChromeRect.y + cropChromeRect.height,
        },
      ]
    : [];

  return (
    <div
      className={`${className} cursor-crop`}
      data-rotation={angle}
      {...pointerHandlers}
      onDragStart={(event) => event.preventDefault()}
    >
      {painted && angle === 0 && (
        /**
         * `pointer-events: none` is inherited, so this one declaration takes the whole subtree out
         * of hit testing and the three `useRect` handlers above stay reachable everywhere. The
         * `overflow-hidden` confines the DOM shade and crop chrome to the workspace; a drag that
         * leaves the container leaves the overlay behind it.
         */
        <div
          data-testid="crop-overhang-overlay"
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 overflow-hidden"
        >
          <div className="absolute inset-0" style={{ transform: viewTransform }}>
            {/*
              The contain fit, applied once to a frame-sized layer, so everything inside is in
              canvas px. The retained preview, composition guide, and crop chrome share this
              coordinate plane; the default rule-of-thirds guide and SVG outline stay vector sharp
              across the old frame edge. The parent view transform matches the workspace canvases,
              while the outer wrapper clips the result to the workspace bounds.
            */}
            <div
              className="absolute left-0 top-0 origin-top-left"
              style={{
                width: totalSize.width,
                height: totalSize.height,
                transformOrigin: 'top left',
                transform: `translate(${painted.fit.offsetX}px, ${painted.fit.offsetY}px) scale(${painted.fit.scale})`,
              }}
            >
              {visibleRecoveryPreviewFrame && (
                <canvas
                  ref={recoveryPreviewCanvasRef}
                  data-testid="crop-retained-pixels-preview"
                  aria-hidden="true"
                  className="pointer-events-none absolute"
                  style={{
                    left: visibleRecoveryPreviewFrame.x - currentFrame.x,
                    top: visibleRecoveryPreviewFrame.y - currentFrame.y,
                    width: visibleRecoveryPreviewFrame.width,
                    height: visibleRecoveryPreviewFrame.height,
                  }}
                />
              )}
              {retainedPixelsOutsideFrame.map((piece, index) => (
                <div
                  key={`retained-dim-${index}-${piece.x}-${piece.y}-${piece.width}-${piece.height}`}
                  data-testid="crop-retained-pixels-dim"
                  aria-hidden="true"
                  className="pointer-events-none absolute"
                  style={{
                    left: piece.x,
                    top: piece.y,
                    width: piece.width,
                    height: piece.height,
                    backgroundColor: DIM,
                  }}
                />
              ))}
              {overhangPieces.map((piece) => (
                <div
                  key={`${piece.x}-${piece.y}-${piece.width}-${piece.height}`}
                  data-testid="crop-overhang-dim"
                  aria-hidden="true"
                  className="pointer-events-none absolute"
                  style={{
                    left: piece.x,
                    top: piece.y,
                    width: piece.width,
                    height: piece.height,
                    backgroundColor: DIM,
                  }}
                />
              ))}
              {inFrameDimPieces.map((piece) => (
                <div
                  key={`crop-frame-dim-${piece.x}-${piece.y}-${piece.width}-${piece.height}`}
                  data-testid="crop-frame-dim"
                  aria-hidden="true"
                  className="pointer-events-none absolute"
                  style={{
                    left: piece.x,
                    top: piece.y,
                    width: piece.width,
                    height: piece.height,
                    backgroundColor: DIM,
                  }}
                />
              ))}
              {cropChromeRect && (
                <>
                  <svg
                    data-testid="crop-composition-guide"
                    aria-hidden="true"
                    className="pointer-events-none absolute"
                    viewBox={`0 0 ${cropChromeRect.width} ${cropChromeRect.height}`}
                    style={{
                      left: cropChromeRect.x,
                      top: cropChromeRect.y,
                      width: cropChromeRect.width,
                      height: cropChromeRect.height,
                      overflow: 'visible',
                    }}
                  >
                    {showCropGuide && cropGuideGeometry && (
                      <g transform={cropGuideGeometry.transform}>
                        <path
                          d={cropGuideGeometry.path}
                          fill="none"
                          stroke={cropGuideColor}
                          strokeWidth={cropGuideWidth}
                          strokeLinecap="butt"
                          strokeLinejoin="miter"
                        />
                      </g>
                    )}
                  </svg>
                  <svg
                    data-testid="crop-selection-outline"
                    aria-hidden="true"
                    className="pointer-events-none absolute"
                    viewBox={`0 0 ${cropChromeRect.width + cropOutlineWidth} ${cropChromeRect.height + cropOutlineWidth}`}
                    style={{
                      left: cropChromeRect.x - cropOutlineWidth / 2,
                      top: cropChromeRect.y - cropOutlineWidth / 2,
                      width: cropChromeRect.width + cropOutlineWidth,
                      height: cropChromeRect.height + cropOutlineWidth,
                      overflow: 'visible',
                    }}
                  >
                    <rect
                      x={cropOutlineWidth / 2}
                      y={cropOutlineWidth / 2}
                      width={cropChromeRect.width}
                      height={cropChromeRect.height}
                      fill="none"
                      stroke={OUTLINE}
                      strokeWidth={cropOutlineWidth}
                      strokeDasharray={`${cropOutlineDash} ${cropOutlineDash}`}
                      strokeLinecap="butt"
                      strokeLinejoin="miter"
                    />
                  </svg>
                  {cropCorners.map((corner) => (
                    <div
                      key={corner.name}
                      data-testid="crop-selection-handle"
                      data-corner={corner.name}
                      aria-hidden="true"
                      className="pointer-events-none absolute"
                      style={{
                        left: corner.x - cropHandleSize / 2,
                        top: corner.y - cropHandleSize / 2,
                        width: cropHandleSize,
                        height: cropHandleSize,
                        backgroundColor: OUTLINE,
                      }}
                    />
                  ))}
                  {painted && (
                    <svg
                      data-testid="crop-rotation-handle"
                      aria-hidden="true"
                      className="pointer-events-none absolute"
                      viewBox="0 0 8 8"
                      style={{
                        left: cropChromeRect.x + cropChromeRect.width / 2 - ROTATE_HANDLE_RADIUS / painted.fit.scale,
                        top:
                          cropChromeRect.y -
                          ROTATE_HANDLE_OFFSET / painted.fit.scale -
                          ROTATE_HANDLE_RADIUS / painted.fit.scale,
                        width: (ROTATE_HANDLE_RADIUS * 2) / painted.fit.scale,
                        height: (ROTATE_HANDLE_RADIUS * 2) / painted.fit.scale,
                        overflow: 'visible',
                      }}
                    >
                      <path d="M 7.236 6.351 A 4 4 0 1 1 7.236 1.649" fill="none" stroke={OUTLINE} strokeWidth={1} />
                    </svg>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
