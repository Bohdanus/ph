import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { isEqual } from 'lodash-es';
import { useRect } from '../../hooks/useRect.ts';
import { MAX_DOCUMENT_FRAME_AREA, MAX_DOCUMENT_FRAME_SIDE, useLayers } from '../../contexts/useLayer.ts';
import { sortRoundRect } from '../../util/rect.ts';
import { HANDLE_SIZE, SET_DOCUMENT_FRAME_ACTION } from '../../util/constants.ts';
import type { ContainDimensions } from '../../util/contain-fit.ts';
import { CROP_OVERLAYS, type CropToolArgs, type CropOverlayType } from '../../tools/crop.ts';
import { useStore } from '../../contexts/StoreContext.tsx';
import { useCurrentTool } from '../../contexts/useCurrentTool.tsx';
import type { Point, Pos, RectXYSorted, Size } from '../../contexts/general-types.ts';
import type { DocumentFrameHistoryArgs, HistoryItem } from '../../contexts/history-types.ts';
import {
  canvasRectToDocumentFrame,
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
/** `drawMask`'s `strokeStyle`. */
const OUTLINE = '#007bff';
/** `drawMask`'s `2 / scale` line width, which is 2 CSS px at every contain fit. */
const OUTLINE_WIDTH = 2;
/** `drawMask`'s `setLineDash([5 / scale, 5 / scale])` dash, likewise 5 CSS px. */
const OUTLINE_DASH = 5;

type OverhangPiece = Pos & { kind: 'dim' | 'outline' | 'handle' };

const PIECE_TEST_ID = {
  dim: 'crop-overhang-dim',
  outline: 'crop-overhang-outline',
  handle: 'crop-overhang-handle',
} as const;

/**
 * `base` minus `cut`, as the rects that cover what is left.
 *
 * Up to four pieces, disjoint and non-overlapping, and `[]` when `cut` swallows `base`. This is
 * the only shape the overhang overlay needs: both of its parts are "something minus something" —
 * the letterbox minus the crop box, and the box's edges minus the document frame — and both of
 * those `something`s can overlap, which a single-rect subtraction cannot express.
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

/** The smallest frame containing the visible frame, retained pixels, and pending crop. */
function getRecoveryPreviewFrame(
  rect: RectXYSorted | null,
  frame: DocumentFrame,
  retainedFrame: DocumentFrame,
  angle: number
): DocumentFrame | null {
  if (!rect || angle !== 0) return null;

  const cropFrame = canvasRectToDocumentFrame(sortRoundRect(rect), frame);
  const x = Math.min(frame.x, retainedFrame.x, cropFrame.x);
  const y = Math.min(frame.y, retainedFrame.y, cropFrame.y);
  const right = Math.max(frame.x + frame.width, retainedFrame.x + retainedFrame.width, cropFrame.x + cropFrame.width);
  const bottom = Math.max(
    frame.y + frame.height,
    retainedFrame.y + retainedFrame.height,
    cropFrame.y + cropFrame.height
  );
  const previewFrame = { x, y, width: right - x, height: bottom - y };
  if (![x, y, previewFrame.width, previewFrame.height].every(Number.isFinite)) return null;

  const cropExtendsFrame =
    cropFrame.x < frame.x ||
    cropFrame.y < frame.y ||
    cropFrame.x + cropFrame.width > frame.x + frame.width ||
    cropFrame.y + cropFrame.height > frame.y + frame.height;
  const retainedPixelsExtendFrame =
    retainedFrame.x < frame.x ||
    retainedFrame.y < frame.y ||
    retainedFrame.x + retainedFrame.width > frame.x + frame.width ||
    retainedFrame.y + retainedFrame.height > frame.y + frame.height;
  if (!cropExtendsFrame && !retainedPixelsExtendFrame) return null;

  const { width, height } = documentFrameSize(previewFrame);
  if (width > MAX_DOCUMENT_FRAME_SIDE || height > MAX_DOCUMENT_FRAME_SIDE || width * height > MAX_DOCUMENT_FRAME_AREA)
    return null;

  return previewFrame;
}

// drawLayersToCanvas can hold a target, staging surface, snapshot, and fallback snapshot at once.
// Budget their aggregate frame-sized backing stores; resizeCanvas rounds each dimension separately.
const MAX_RECOVERY_PREVIEW_TOTAL_BACKING_PIXELS = 16_777_216;
const MAX_RECOVERY_PREVIEW_SURFACES = 4;
const MAX_RECOVERY_PREVIEW_BACKING_PIXELS = Math.floor(
  MAX_RECOVERY_PREVIEW_TOTAL_BACKING_PIXELS / MAX_RECOVERY_PREVIEW_SURFACES
);

function getRecoveryPreviewBackingScale(frame: DocumentFrame, dpr: number): number {
  const { width, height } = documentFrameSize(frame);
  const fitsBackingBudget = (scale: number) =>
    Math.round(width * scale) * Math.round(height * scale) <= MAX_RECOVERY_PREVIEW_BACKING_PIXELS;
  let low = 0;
  let high = Math.min(dpr, Math.sqrt(MAX_RECOVERY_PREVIEW_BACKING_PIXELS / (width * height)));
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

  // The frame, minus the box. The canvas strokes the outline at the same rect and the backing
  // store clips whatever falls outside, so only the overhang half is drawn here; stroking the whole
  // box would double the in-frame half, where the two dashes would not even share a phase.
  //
  // The verticals start below the top edge rather than at the corner, so the two horizontals own all
  // four corners and no pixel is painted twice.
  const line = OUTLINE_WIDTH / fit.scale;
  const edges: Pos[] = [
    { x: box.x, y: box.y, width: box.width, height: line },
    { x: box.x, y: box.y + box.height - line, width: box.width, height: line },
    { x: box.x, y: box.y + line, width: line, height: box.height - 2 * line },
    { x: box.x + box.width - line, y: box.y + line, width: line, height: box.height - 2 * line },
  ];
  const outlines = overhangs ? edges.flatMap((edge) => subtractRect(edge, frameRect)) : [];

  // The four corner handles, minus the frame.
  //
  // `drawMask` fills each one as a `HANDLE_SIZE / scale` square CENTRED on its corner — `h2` out on
  // every side, so the square straddles the corner rather than sitting inside it — and the backing
  // store clips whatever falls outside the frame. That clipping is what made an extended box a
  // dead end: the handle was still there, and `getEdgeAtPoint` still found it, but nothing was drawn
  // where the user was being asked to click.
  //
  // The same numbers, not similar ones: `getEdgeAtPoint` hit-tests with `HANDLE_SIZE / scale / 2`
  // for the same four corners (`drawCropOverlay()`), which is this `inset`. So the painted
  // square and the hit square are the same square, and drawing it adds nothing to the hit path — it
  // only makes the hit path visible. The centre is what is shared; the size is `drawMask`'s, and
  // both are `HANDLE_SIZE` over the same divisor.
  const handle = HANDLE_SIZE / fit.scale;
  const inset = handle / 2;
  const corners: Point[] = [
    { x: box.x, y: box.y },
    { x: box.x + box.width, y: box.y },
    { x: box.x, y: box.y + box.height },
    { x: box.x + box.width, y: box.y + box.height },
  ];
  const handles = overhangs
    ? corners.flatMap((corner) =>
        subtractRect({ x: corner.x - inset, y: corner.y - inset, width: handle, height: handle }, frameRect)
      )
    : [];

  // Dim, then outline, then handles: the order `drawMask` paints them in, so the handles sit on top
  // of the outline exactly where the canvas would have put them.
  return [
    ...dims.map((piece) => ({ ...piece, kind: 'dim' as const })),
    ...outlines.map((piece) => ({ ...piece, kind: 'outline' as const })),
    ...handles.map((piece) => ({ ...piece, kind: 'handle' as const })),
  ].filter((piece) => piece.width > 0 && piece.height > 0);
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
  const [painted, setPainted] = useState<{ rect: RectXYSorted; fit: ContainDimensions } | null>(null);
  const previousRectRef = useRef(rect);
  useEffect(() => {
    if (previousRectRef.current && !rect) setPainted(null);
    previousRectRef.current = rect;
  }, [rect]);

  const recoveryPreviewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const paintedRect = painted?.rect ?? null;
  const retainedFrame = useMemo(
    () => getHistoryFrameBounds(history, historyIndex, currentFrame),
    [currentFrame, history, historyIndex]
  );
  const recoveryPreviewFrame = useMemo(
    () => (canPreviewRetainedPixels ? getRecoveryPreviewFrame(paintedRect, currentFrame, retainedFrame, angle) : null),
    [angle, canPreviewRetainedPixels, currentFrame, paintedRect, retainedFrame]
  );
  const retainedPixelsOutsideFrame = useMemo(() => {
    if (!painted || !recoveryPreviewFrame || angle !== 0) return [];
    const previewRect: Pos = {
      x: recoveryPreviewFrame.x - currentFrame.x,
      y: recoveryPreviewFrame.y - currentFrame.y,
      width: recoveryPreviewFrame.width,
      height: recoveryPreviewFrame.height,
    };
    const currentFrameRect: Pos = { x: 0, y: 0, width: totalSize.width, height: totalSize.height };
    return subtractRects([previewRect], [currentFrameRect, sortRoundRect(painted.rect)]);
  }, [angle, currentFrame, painted, recoveryPreviewFrame, totalSize.height, totalSize.width]);
  const recoveryPreviewBackingScale = recoveryPreviewFrame
    ? getRecoveryPreviewBackingScale(recoveryPreviewFrame, dpr)
    : 1;

  useEffect(() => {
    const canvas = recoveryPreviewCanvasRef.current;
    if (!canvas || !recoveryPreviewFrame) return;
    const context = canvas.getContext('2d');
    if (!context) return;

    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (
      !drawLayersToCanvas(
        canvas,
        getSortedLayersArray(layers),
        recoveryPreviewFrame,
        undefined,
        recoveryPreviewBackingScale
      )
    )
      return;

    const previewContext = canvas.getContext('2d');
    if (!previewContext) return;
    previewContext.setTransform(recoveryPreviewBackingScale, 0, 0, recoveryPreviewBackingScale, 0, 0);
    // The main canvas already shows this portion. Clear it so semi-transparent layers are not
    // composited twice; only retained pixels beyond the current frame belong on this overlay.
    previewContext.clearRect(
      currentFrame.x - recoveryPreviewFrame.x,
      currentFrame.y - recoveryPreviewFrame.y,
      currentFrame.width,
      currentFrame.height
    );
    previewContext.setTransform(1, 0, 0, 1, 0, 0);
  }, [currentFrame, layers, recoveryPreviewBackingScale, recoveryPreviewFrame]);

  const { pointerHandlers, pointerState } = useRect({
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
    rotationEnabled: true,
    rotation: angle,
    onRotationChange: (nextAngle: number) => setToolArgs({ ...overlayKeysRef.current.args, angle: nextAngle }),
    overlayType,
    overlayOrientation,
    overlayVisibility,
    gridDivisions,

    documentCanvasRef: canvasRef,

    onRepaint: (sortedRect: RectXYSorted) => {
      // Read after this render has bound `pointerState`. The closure runs from inside `drawMask`,
      // never during render, so the binding is always initialised by the time it is read.
      const fit = pointerState.dimensionsRef.current;

      setPainted((current) =>
        current && current.fit === fit && isEqual(current.rect, sortedRect) ? current : { rect: sortedRect, fit }
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
        setToolArgs({ ...args, rect: null, preRatioRect: null });
      } else {
        setToolArgs({ ...args, rect: newRect, preRatioRect: null });
      }
    },
  });

  // `painted` tracks pointer motion before `onChangeEnd` publishes the draft rect, so the crop box
  // and its retained-pixel preview can follow the pointer live. A committed/cancelled draft clears
  // the last painted geometry when `rect` transitions back to null.
  const overhangPieces = painted
    ? cropOverhangPieces(
        painted.rect,
        totalSize,
        painted.fit,
        recoveryPreviewFrame !== null,
        retainedPixelsOutsideFrame
      )
    : [];
  const dash = painted ? OUTLINE_DASH / painted.fit.scale : 0;

  return (
    <div className={`${className} cursor-crop`} data-rotation={angle} {...pointerHandlers}>
      {/* Overhang pieces subtract axis-aligned frames; suppress them until rotated clip geometry exists. */}
      {(overhangPieces.length > 0 || recoveryPreviewFrame !== null) && painted && angle === 0 && (
        /**
         * `pointer-events: none` is inherited, so this one declaration takes the whole subtree out
         * of hit testing and the three `useRect` handlers above stay reachable everywhere. The
         * `overflow-hidden` is what confines the bands to the workspace: they are sized to the
         * letterbox exactly, and a drag that leaves the container leaves the overlay behind it.
         */
        <div
          data-testid="crop-overhang-overlay"
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 overflow-hidden"
        >
          <div className="absolute inset-0" style={{ transform: viewTransform }}>
            {/*
              The contain fit, applied once to a frame-sized layer, so everything inside is in
              canvas px and the box div below carries the same numbers `drawMask` stroked. Starting
              at the top left matches the canvas's contain-fit transform; this wrapper's parent
              applies the workspace view transform, while the outer wrapper keeps the result
              clipped to the untransformed workspace bounds.
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
              {recoveryPreviewFrame && (
                <canvas
                  ref={recoveryPreviewCanvasRef}
                  data-testid="crop-retained-pixels-preview"
                  aria-hidden="true"
                  className="pointer-events-none absolute"
                  style={{
                    left: recoveryPreviewFrame.x - currentFrame.x,
                    top: recoveryPreviewFrame.y - currentFrame.y,
                    width: recoveryPreviewFrame.width,
                    height: recoveryPreviewFrame.height,
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
                  key={`${piece.kind}-${piece.x}-${piece.y}-${piece.width}-${piece.height}`}
                  data-testid={PIECE_TEST_ID[piece.kind]}
                  // Visual only, on every piece and not just the handles: the whole subtree is already
                  // out of hit testing through the wrapper, and a piece that became a hit target would
                  // be a second, silent answer to "which edge is under the pointer" competing with
                  // `getEdgeAtPoint`.
                  className="pointer-events-none absolute"
                  style={{
                    left: piece.x,
                    top: piece.y,
                    width: piece.width,
                    height: piece.height,
                    backgroundColor: piece.kind === 'dim' ? DIM : piece.kind === 'handle' ? OUTLINE : undefined,
                    // `drawMask` strokes a dashed line at `[5 / scale, 5 / scale]` canvas px. The
                    // same dash in CSS px is the same pattern, and it starts at the box corner here
                    // for the same reason the path starts there. A handle is a `fillRect`, so it is
                    // solid and never reaches this branch.
                    backgroundImage:
                      piece.kind === 'outline'
                        ? `repeating-linear-gradient(${piece.width >= piece.height ? 'to right' : 'to bottom'}, ${OUTLINE} 0 ${dash}px, transparent ${dash}px ${dash * 2}px)`
                        : undefined,
                  }}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
