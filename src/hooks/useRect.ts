import { type PointerEvent, type RefObject, useCallback, useEffect, useRef } from 'react';
import type { Point, Pos, RectXY, RectXYSorted, Size } from '../contexts/general-types.ts';
import { usePointerPosition } from './usePointerPosition.ts';
import { clearSelectionDragPreview, publishSelectionDragPreview } from './selection-drag-preview.ts';
import {
  angleFromCenter,
  posToSortedRect,
  rectCenter,
  rotatePointAround,
  sortRect,
  sortRoundRect,
  trimRect,
} from '../util/rect.ts';
import { CURSOR_MAP, HANDLE_SIZE } from '../util/constants.ts';
import { resetOverlayAlpha } from '../util/canvas.ts';
import { refitRectWidthToAspect } from '../util/rect-aspect.ts';
import { isEqual } from 'lodash-es';
import type { Layer } from '../contexts/layer-types.ts';
import type { CropOverlayOrientation, CropOverlayType, CropOverlayVisibility } from '../tools/crop.ts';

export type UseRectProps = {
  aspectRatio?: number | null;
  /** A fixed-size fresh drag, centred on the press point. */
  fixedSize?: Size | null;
  /** The frame's size in CANVAS px, so the frame rect here is `[0, 0, imageSize]`. */
  imageSize: Size;
  initialRect?: RectXYSorted | null; // can be set using props, in canvas px like everything else

  hideBlend?: boolean;
  isMoveTool?: boolean;

  /**
   * Shift: hold a FRESH drag to a square, whatever `aspectRatio` says.
   *
   * Opt-in per consumer because this hook is shared: the crop and the rectangular marquee pass
   * both this and `fromCentre`, the Move tool and the text tool pass neither, and a drag with
   * both unset runs `adjustFreePoint` exactly as it always has. A handle RESIZE is not a fresh
   * drag and is not affected either — the modifier that locks a resize is the aspect ratio
   * `getEdgeAtPoint` captures.
   */
  constrainToSquare?: boolean;
  /** Alt: grow a fresh drag out from the press point instead of away from it. */
  fromCentre?: boolean;

  /**
   * When the `#007bff` dashed border is stroked. `'always'` is the default and is correct for
   * every consumer but one: the Move tool, Crop and Text draw a rect that is not a selection, so
   * the marching-ants canvas has nothing to say about it and this border is the only thing on
   * screen that says where the rect is.
   *
   * `'while-dragging'` is the rectangular marquee's, because Adobe documents the ants as the
   * display of a selection rather than a per-tool option
   * (`helpx.adobe.com/photoshop/desktop/make-selections/get-started-selections/selection-tools-overview.html`
   * lists all nine marquee and lasso tools as making selections, none of them as producing a
   * different kind of border) and this hook's stroke would be a second outline of the same
   * rectangle, one canvas above. It cannot simply be switched off, because a marquee in flight is
   * not committed yet and so has nothing for the ants to draw — hence a mode rather than an off
   * switch.
   *
   * Opt-in per consumer for the same reason `constrainToSquare` is: the hook is shared, and this
   * behaviour must be reached by asking for it rather than by a default that would change three
   * tools.
   */
  borderMode?: 'always' | 'while-dragging';

  /**
   * Paint the TRUE rect where the pointer left it, including the part that has left the canvas
   * frame.
   *
   * Opt-in per consumer because this hook is shared: crop's box is a window onto a canvas that
   * extends past the image, so a box dragged past the frame edge has to keep the overhang — the
   * clamp below made it snap back to the edge while `onChange`/`onChangeEnd` still reported the
   * unclamped rect, so the two disagreed on screen. Every other consumer wants the clamp, and
   * passes this alone.
   *
   * PAINTING ONLY. The reported rect is `sortRect(rect)` with no clamp in any case, so
   * `onRepaint`, `onChange` and `onChangeEnd` are untouched by this prop; the backing store clips
   * whatever falls outside the frame, which is why the overhang is still legible rather than drawn.
   */
  allowOutsideCanvas?: boolean;

  /**
   * Paint and hit-test each corner handle WHOLE outside the rect, instead of straddling its corner.
   *
   * Opt-in per consumer because this hook is shared, and only the Type tool has a reason. Its
   * contenteditable overlay occupies the whole box, so a handle centred on a corner puts its inner
   * half under the editor, where a press places a caret instead of resizing. Crop, the marquee and
   * the Move tool have no overlay over their box, so their grip continues to straddle its corner.
   * The Type tool's hit area matches the entire outside grip; other consumers retain the centred
   * hit area.
   */
  handlesOutside?: boolean;
  rotationEnabled?: boolean;
  rotation?: number;
  onRotationChange?: (degrees: number) => void;
  /** Optional composition guide for the crop consumer. Other rectangle tools leave this absent. */
  overlayType?: CropOverlayType;
  overlayOrientation?: CropOverlayOrientation;
  overlayVisibility?: CropOverlayVisibility;
  gridDivisions?: number;

  /** The document canvas, sampled to pick an overlay-guide color that inverts the underlying pixels. */
  documentCanvasRef?: RefObject<HTMLCanvasElement | null>;

  containerRef: RefObject<HTMLDivElement | null>;
  overlayRef: RefObject<HTMLCanvasElement | null>;

  onRepaint?: (sortedRect: RectXYSorted) => void; // is called on redraw (RAF throttled)
  onChange?: (sortedRect: RectXYSorted) => void; // is called on resize (RAF throttled)
  onChangeEnd: (sortedRect: RectXYSorted) => void; // is called after final change, when mouse is up
};

/** The modifier state a fresh drag reads, sampled from the pointer event that carries it. */
type FreshDragModifiers = {
  constrainToSquare: boolean;
  fromCentre: boolean;
};

const NO_MODIFIERS: FreshDragModifiers = { constrainToSquare: false, fromCentre: false };
const RECT_BORDER_DASH_LENGTH = 5;
const RECT_BORDER_DASH_SPEED = 0.4;
const ROTATE_HOTZONE = 24;

/**
 * Samples the document canvas at strategic points within the crop rect and returns
 * an inverted color for the overlay guides, so they stay visible on both light and
 * dark image content — matching Photoshop's behavior.
 *
 * Returns white as a fallback when no document canvas is available or when sampling
 * fails (e.g. cross-origin canvas).
 */
function computeOverlayColor(documentCanvas: HTMLCanvasElement | null, rect: Pos): string {
  if (!documentCanvas) return 'rgba(255, 255, 255, 0.8)';

  const ctx = documentCanvas.getContext('2d');
  if (!ctx) return 'rgba(255, 255, 255, 0.8)';

  const { x, y, width, height } = rect;
  const samplePoints = [
    { x: x + width / 3, y: y + height / 3 },
    { x: x + (2 * width) / 3, y: y + height / 3 },
    { x: x + width / 2, y: y + height / 2 },
    { x: x + width / 3, y: y + (2 * height) / 3 },
    { x: x + (2 * width) / 3, y: y + (2 * height) / 3 },
  ];

  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;
  for (const point of samplePoints) {
    try {
      const pixel = ctx.getImageData(Math.round(point.x), Math.round(point.y), 1, 1);
      r += pixel.data[0];
      g += pixel.data[1];
      b += pixel.data[2];
      count += 1;
    } catch {
      // skip out-of-bounds or tainted samples
    }
  }

  if (count === 0) return 'rgba(255, 255, 255, 0.8)';

  const avgR = Math.round(r / count);
  const avgG = Math.round(g / count);
  const avgB = Math.round(b / count);
  return `rgba(${255 - avgR}, ${255 - avgG}, ${255 - avgB}, 0.8)`;
}

/** Paints Photoshop's crop composition guide in canvas pixels. */
export function drawCropOverlay(
  ctx: CanvasRenderingContext2D,
  rect: Pos,
  overlayType: CropOverlayType = 'ruleOfThirds',
  orientation: CropOverlayOrientation = 'normal',
  scale = 1,
  documentCanvas: HTMLCanvasElement | null = null,
  overlayVisibility: CropOverlayVisibility = 'always',
  gridDivisions = 10,
  isDragging = true
) {
  // Respect overlay visibility setting
  if (overlayVisibility === 'never' || (overlayVisibility === 'auto' && !isDragging)) return;

  const { x, y, width, height } = rect;
  const vertical = (ratio: number) => x + width * ratio;
  const horizontal = (ratio: number) => y + height * ratio;
  const line = (x1: number, y1: number, x2: number, y2: number) => {
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
  };

  const overlayColor = computeOverlayColor(documentCanvas, rect);
  ctx.save();
  ctx.strokeStyle = overlayColor;
  ctx.lineWidth = 1 / scale;
  ctx.setLineDash([]);
  ctx.beginPath();
  switch (overlayType) {
    case 'ruleOfThirds':
      line(vertical(1 / 3), y, vertical(1 / 3), y + height);
      line(vertical(2 / 3), y, vertical(2 / 3), y + height);
      line(x, horizontal(1 / 3), x + width, horizontal(1 / 3));
      line(x, horizontal(2 / 3), x + width, horizontal(2 / 3));
      break;
    case 'grid': {
      const divisions = Math.max(2, Math.min(100, gridDivisions));
      for (let index = 1; index < divisions; index += 1) {
        const ratio = index / divisions;
        line(vertical(ratio), y, vertical(ratio), y + height);
        line(x, horizontal(ratio), x + width, horizontal(ratio));
      }
      break;
    }
    case 'diagonal':
      line(x, y, x + width, y + height);
      line(x + width, y, x, y + height);
      break;
    case 'triangle': {
      const orientationCount = 4;
      const currentOrientation =
        typeof orientation === 'number' ? orientation % orientationCount : orientation === 'flipped' ? 1 : 0;
      // 0: top-left to bottom-right diagonal, anchor at bottom-right
      // 1: top-right to bottom-left diagonal (flipped), anchor at bottom-left
      // 2: bottom-left to top-right diagonal, anchor at top-right
      // 3: bottom-right to top-left diagonal, anchor at top-left
      const flip = currentOrientation === 1 || currentOrientation === 3;
      const diagonalStart = flip ? { x: x + width, y } : { x, y };
      const diagonalEnd = flip ? { x, y: y + height } : { x: x + width, y: y + height };
      const anchor = flip
        ? { x: x + width * 0.382, y: y + height * 0.618 }
        : { x: x + width * 0.618, y: y + height * 0.618 };
      // Rotate anchor for orientations 2 and 3
      if (currentOrientation >= 2) {
        anchor.x = x + width - anchor.x + x;
        anchor.y = y + height - anchor.y + y;
      }
      line(diagonalStart.x, diagonalStart.y, diagonalEnd.x, diagonalEnd.y);
      line(flip ? x : x + width, y, anchor.x, anchor.y);
      line(flip ? x + width : x, y + height, anchor.x, anchor.y);
      break;
    }
    case 'goldenRatio':
      line(vertical(0.382), y, vertical(0.382), y + height);
      line(vertical(0.618), y, vertical(0.618), y + height);
      line(x, horizontal(0.382), x + width, horizontal(0.382));
      line(x, horizontal(0.618), x + width, horizontal(0.618));
      break;
    case 'goldenSpiral': {
      const orientationCount = 8;
      const currentOrientation =
        typeof orientation === 'number' ? orientation % orientationCount : orientation === 'flipped' ? 4 : 0;
      // 8 orientations: 4 rotations × 2 flips
      const flip = currentOrientation >= 4;
      const rotation = (currentOrientation % 4) * (Math.PI / 2);
      const cx = x + width / 2;
      const cy = y + height / 2;
      const radius = Math.min(width, height) / 2;

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(rotation);
      if (flip) ctx.scale(-1, 1);

      ctx.arc(0, 0, radius, 0, Math.PI * 1.5);
      ctx.arc(0, 0, radius * 0.618, Math.PI * 1.5, Math.PI * 2);
      ctx.arc(0, 0, radius * 0.382, 0, Math.PI / 2);

      ctx.restore();
      break;
    }
  }
  ctx.stroke();
  ctx.restore();
}

/**
 * CANVAS px throughout: every point, size and rect read or computed below — and every rect handed
 * to `onRepaint`/`onChange`/`onChangeEnd` — is in the frame's own space, whose origin is the frame
 * origin, so the frame rect is exactly `[0, 0, imageSize]`. Nothing in this file may add or
 * subtract `documentFrame.x`/`.y`: those are DOCUMENT coordinates, they are the only thing negative
 * about a grown frame, and folding them in here is an off-by-frame-origin bug that is invisible on
 * a zero-origin document. Document space is one `canvasRectToDocumentFrame` call away
 * (`src/contexts/document-frame.ts:52`), and making it is the consumer's job.
 */
export function useRect({
  aspectRatio = null,
  fixedSize = null,
  imageSize,
  initialRect,

  hideBlend,
  isMoveTool,
  constrainToSquare = false,
  fromCentre = false,
  borderMode = 'always',
  allowOutsideCanvas = false,
  handlesOutside = false,
  rotationEnabled = false,
  rotation = 0,
  onRotationChange,
  overlayType,
  overlayOrientation = 'normal',
  overlayVisibility = 'always',
  gridDivisions = 10,
  documentCanvasRef,

  containerRef,
  overlayRef,

  onRepaint,
  onChange,
  onChangeEnd,
}: UseRectProps) {
  const startRectRef = useRef<RectXYSorted | null>(null);
  const rectUnsortedRef = useRef<RectXY | null>(null); // might become unsorted while dragging

  const startPointRef = useRef<Point | null>(null);
  const currentEdgeRef = useRef<string | null>(null);
  const customAspectRatioRef = useRef<number | null>(null);
  const freshDragModifiersRef = useRef<FreshDragModifiers>({ ...NO_MODIFIERS });
  const rotationRef = useRef(rotation);
  const lastRotationRef = useRef(rotation);
  const startRotationRef = useRef(rotation);
  const rotationStartAngleRef = useRef(0);

  const pendingPoint = useRef<Point | null>(null);
  const frameRequested = useRef<number | null>(null);
  const borderAnimationFrameRef = useRef<number | null>(null);
  const borderDashOffsetRef = useRef(0);

  /** Whether a pointer gesture this hook owns is in flight. See `beginGesture`. */
  const isGestureActiveRef = useRef(false);

  /**
   * A pointer gesture this hook owns, and the two things that follow from it: what the tool overlay
   * paints, and what the marching-ants loop is told. One ref, written by `beginGesture` and
   * `endGesture` and read by `drawMask`, so there is no second copy of "is a drag happening" that
   * can drift out of step with it. That drift is the failure this mode could otherwise produce —
   * two canvases disagreeing about one rectangle — and it is produced by exactly the two other
   * answers this hook could be reading.
   *
   * Each of those is a DIFFERENT question, and conflating them is what this hook must not do:
   *   - `drawMask`'s `hasRectChanged` means "the geometry moved since the last paint", which is
   *     what `onChange` fires from. It is true on the drag path AND on `handlePointerUp`'s final
   *     paint, so overloading it would make `onChange`'s firing and the border's visibility a
   *     single decision and the border would outlive the pointer by one paint.
   *   - `pointerState.isMouseDown` answers this ref's question on every route this hook can see,
   *     and on one more it cannot: `usePointerPosition` flips it from its own `pointercancel`
   *     listener (`usePointerPosition.ts:238`-`:242`), which runs no code of this hook's and cannot
   *     be reached from it. So the border is stroked while BOTH hold — a gesture of ours is open
   *     AND the pointer channel still tracks the primary press that opened it. The second term is
   *     what stops a cancel this hook never hears about from leaving the marquee's border painted on
   *     the committed selection while the tool area's own `onPointerCancel` has already handed the
   *     ants back: the two canvases would then disagree about one rectangle, which is the whole
   *     thing this mode exists to prevent.
   *
   * Gated on `borderMode` because the channel is ONE shared slot: published from the Move tool it
   * would stand the ants down for a selection the user is not touching, and crop and Text have no
   * selection to stand them down for at all.
   */
  function beginGesture() {
    isGestureActiveRef.current = true;
    if (borderMode === 'while-dragging') publishSelectionDragPreview({ kind: 'marquee' });
  }

  const endGesture = useCallback(() => {
    isGestureActiveRef.current = false;
    if (borderAnimationFrameRef.current !== null) {
      cancelAnimationFrame(borderAnimationFrameRef.current);
      borderAnimationFrameRef.current = null;
    }
    if (borderMode === 'while-dragging') clearSelectionDragPreview();
    // `borderMode` is the only dependency because it is the only thing here that is not a ref or a
    // module function, and no consumer of this hook ever changes it — three pass nothing and the
    // fourth passes a literal. That is what lets the unmount effect below list this without
    // re-registering its cleanup on every render, which would cancel the pending frame each time.
  }, [borderMode]);

  const drawMaskRef = useRef<((hasRectChanged?: boolean) => void) | null>(null);

  useEffect(() => {
    drawMaskRef.current = drawMask;
  });

  useEffect(() => {
    if (aspectRatio && initialRect) {
      const patch = refitRectWidthToAspect(initialRect, aspectRatio);
      startRectRef.current = { ...initialRect, ...patch };
    } else {
      startRectRef.current = initialRect ? { ...initialRect } : null;
    }

    if (!isEqual(startRectRef.current, rectUnsortedRef.current)) {
      rectUnsortedRef.current = startRectRef.current ? { ...startRectRef.current } : null;
      drawMaskRef.current?.();
    }
  }, [aspectRatio, initialRect]);

  useEffect(() => {
    rotationRef.current = rotation;
    if (lastRotationRef.current !== rotation && rectUnsortedRef.current) drawMaskRef.current?.();
    lastRotationRef.current = rotation;
  }, [rotation]);

  /**
   * The overlay canvas outlives this hook: `Main.tsx:239-284` renders both overlay canvases
   * unconditionally and only toggles `display`, and toggling `display` never touches a backing
   * store. The effect above is the only other thing that clears it, and it cannot cover the AREA
   * going away — `goToTool` (`src/hooks/useApp.ts:167-196`) appends the selection clear and
   * dispatches `SET_TOOL_NAME` from one function body, React batches them, and the marquee's
   * component unmounts in the same commit that nulls the selection. An unmounted component's
   * effects do not run, so `initialRect` is never observed going null and the four `#007bff`
   * handles, the `rgba(0, 0, 0, 0.7)` blend and — for the three consumers that pass no
   * `borderMode` — the `#007bff` outline all survive the tool switch that deselected them,
   * sitting on the overlay the next tool previews into.
   *
   * The shape is `MagicWandToolArea.tsx:105-113`'s, and each of the three constraints below is one
   * a naive version of it gets wrong:
   *   - the frame is cancelled FIRST. A request still queued by `handlePointerMove` would
   *     otherwise repaint after this clear and resurrect the marquee.
   *   - the size is read off `ctx.canvas` at CALL time, not off `imageSize`. `imageSize` is a
   *     render-scope binding, so a cleanup closing over it freezes the first render's value and
   *     under-clears after a document resize. `getCanvasSize(overlayRef)` is not usable either:
   *     React detaches refs in the mutation phase, before passive destroys run, so
   *     `overlayRef.current` is already null here — which is also why the ctx is captured in the
   *     effect BODY. With DPR scaling, `getCanvasSize` would also return backing-store dimensions
   *     (device px) rather than the frame size (document px), so `imageSize` is the correct source.
   *   - `dimensionsRef` is deliberately NOT referenced. It is destructured below this effect, so a
   *     closure over it is built in TDZ: a runtime ReferenceError `tsc` cannot see and that no
   *     test which does not unmount would reach.
   *
   * The clear is guarded because a canvas with no 2d context is a supported state
   * (`useRect.drag.test.ts` pins it), and unconditional because a conditional one keyed on what
   * this instance painted is a landmine: the abandoned-drag case is exactly the case where the
   * content was painted by a frame that never became `initialRect`.
   */
  useEffect(() => {
    const ctx = overlayRef.current?.getContext('2d');

    return () => {
      cancelAnimationFrame(frameRequested.current!);

      // An unmount mid-gesture is an abort like any other, and it is the route easiest to miss
      // because nothing about an unmount looks like a gesture: the preview slot is a module-level
      // variable that outlives this mount, so an entry left behind would stand the ants down for
      // every later tool
      // (`selection-drag-preview.ts:58`-`:63`). It runs before the canvas clear so the pixels that
      // are about to be wiped and the entry that is about to be dropped are one teardown.
      //
      // `borderMode` here is this effect's first-render value, which is the only one any consumer
      // has: three of the four pass no `borderMode` at all and the fourth passes a literal, so
      // there is nothing for it to go stale to.
      endGesture();

      if (ctx) {
        // The overlay context is scaled by DPR (via resizeCanvas in Main.tsx), so clearRect
        // coordinates are in logical/frame pixels. Use imageSize (logical frame bounds) rather
        // than ctx.canvas.width/height (backing-store device pixels) to avoid over-clearing.
        ctx.clearRect(0, 0, imageSize.width, imageSize.height);
      }
    };
  }, [endGesture, overlayRef]);

  const pointerPositionData = usePointerPosition({
    ref: containerRef,
    imageSize,
    onResize: () => {
      drawMask();
    },
  });

  const { isPointerDownValid, isPointerMoveValid, isPointerUpValid, getLocalCoords, isMouseDown, dimensionsRef } =
    pointerPositionData;

  function animateBorder() {
    borderAnimationFrameRef.current = null;
    if (borderMode !== 'while-dragging' || !isGestureActiveRef.current) return;

    if (!isMouseDown.current || !rectUnsortedRef.current) {
      if (rectUnsortedRef.current) drawMaskRef.current?.();
      return;
    }

    const scale = dimensionsRef.current.scale;
    const dashLength = RECT_BORDER_DASH_LENGTH / scale;
    borderDashOffsetRef.current = (borderDashOffsetRef.current - RECT_BORDER_DASH_SPEED / scale) % (dashLength * 2);
    drawMaskRef.current?.();
    borderAnimationFrameRef.current = requestAnimationFrame(animateBorder);
  }

  function scheduleBorderAnimation() {
    if (
      borderMode === 'while-dragging' &&
      isGestureActiveRef.current &&
      isMouseDown.current &&
      rectUnsortedRef.current &&
      overlayRef.current?.getContext('2d') &&
      borderAnimationFrameRef.current === null
    ) {
      borderAnimationFrameRef.current = requestAnimationFrame(animateBorder);
    }
  }

  /**
   * Where in the existing box a point lands, and NOTHING else — no decision, no recorded state.
   *
   * Split out of `getEdgeAtPoint` because the aspect-ratio capture that wraps it has to know the
   * ANSWER before it may record anything: whether the press landed on the box decides whether the
   * gesture is a resize of that box at all.
   */
  function edgeAtPoint(point: Point): string | null {
    const _initialRect = startRectRef.current;
    if (_initialRect) {
      const { x1, y1, x2, y2 } = _initialRect;
      const { scale } = dimensionsRef.current;
      const h1 = HANDLE_SIZE / scale;
      const h2 = HANDLE_SIZE / scale / 2;
      const hitPoint = rotationEnabled
        ? rotatePointAround(point, rectCenter(_initialRect), -rotationRef.current)
        : point;

      if (rotationEnabled) {
        const localPoint = hitPoint;
        const outside = localPoint.x < x1 || localPoint.x > x2 || localPoint.y < y1 || localPoint.y > y2;
        if (outside) {
          const corners = [
            { x: x1, y: y1 },
            { x: x2, y: y1 },
            { x: x2, y: y2 },
            { x: x1, y: y2 },
          ];
          if (
            corners.some(
              (corner) => Math.hypot(localPoint.x - corner.x, localPoint.y - corner.y) <= ROTATE_HOTZONE / scale
            )
          ) {
            return 'rotate';
          }
        }
      }

      if (handlesOutside) {
        if (hitPoint.x >= x1 - h1 && hitPoint.x <= x1 && hitPoint.y >= y1 - h1 && hitPoint.y <= y1) return 'top-left';
        if (hitPoint.x >= x2 && hitPoint.x <= x2 + h1 && hitPoint.y >= y1 - h1 && hitPoint.y <= y1) return 'top-right';
        if (hitPoint.x >= x1 - h1 && hitPoint.x <= x1 && hitPoint.y >= y2 && hitPoint.y <= y2 + h1)
          return 'bottom-left';
        if (hitPoint.x >= x2 && hitPoint.x <= x2 + h1 && hitPoint.y >= y2 && hitPoint.y <= y2 + h1)
          return 'bottom-right';
      } else {
        // check for tops
        if (hitPoint.x >= x1 - h2 && hitPoint.x <= x1 + h2 && hitPoint.y >= y1 - h2 && hitPoint.y <= y1 + h2) {
          return 'top-left';
        }
        if (hitPoint.x >= x2 - h2 && hitPoint.x <= x2 + h2 && hitPoint.y >= y1 - h2 && hitPoint.y <= y1 + h2) {
          return 'top-right';
        }
        if (hitPoint.x >= x1 - h2 && hitPoint.x <= x1 + h2 && hitPoint.y >= y2 - h2 && hitPoint.y <= y2 + h2) {
          return 'bottom-left';
        }
        if (hitPoint.x >= x2 - h2 && hitPoint.x <= x2 + h2 && hitPoint.y >= y2 - h2 && hitPoint.y <= y2 + h2) {
          return 'bottom-right';
        }
      }

      // check for line
      if (hitPoint.x >= x1 && hitPoint.x <= x2 && hitPoint.y >= y1 - h2 && hitPoint.y <= y1 + h2) {
        return 'top';
      }
      if (hitPoint.x >= x2 - h2 && hitPoint.x <= x2 + h2 && hitPoint.y >= y1 && hitPoint.y <= y2) {
        return 'right';
      }
      if (hitPoint.x >= x1 - h2 && hitPoint.x <= x1 + h2 && hitPoint.y >= y1 && hitPoint.y <= y2) {
        return 'left';
      }
      if (hitPoint.x >= x1 && hitPoint.x <= x2 && hitPoint.y >= y2 - h2 && hitPoint.y <= y2 + h2) {
        return 'bottom';
      }

      // inside the resize square
      if (hitPoint.x > x1 && hitPoint.x < x2 && hitPoint.y > y1 && hitPoint.y < y2) {
        return 'inside';
      }
    }

    return null;
  }

  /**
   * The hit test, plus the one thing it is allowed to decide: a press that LANDS ON the box, with
   * a modifier held, pins that box's own ratio for the whole gesture.
   *
   * The gate on `edge` is load-bearing, and it is a defect fix rather than a tidy-up. The capture
   * used to be unconditional, so a press on EMPTY canvas — a fresh drag, the gesture
   * `adjustFreshPoint` exists to constrain — recorded the previous box's ratio as well, and the
   * fresh drag inherited it whenever no other modifier was set. For the crop that made Command the
   * aspect-ratio modifier: `sampleFreshDragModifiers` reads `shiftKey` and `altKey` only, so
   * Command reached the geometry solely through here, and a Command-drag out of an existing 2:1
   * crop box produced another 2:1 box. Adobe gives Command to the crop for two other things —
   * invoking Straighten and temporarily disabling snapping to the crop box edge — and to neither
   * marquee as a proportion lock, where Shift is the key.
   *
   * What a resize does with a modifier is untouched, on purpose: `constrainToSquare`/`fromCentre`
   * are about a fresh drag, and the ratio a HANDLE drag locks is this line.
   */
  function getEdgeAtPoint(point: Point, event?: PointerEvent<HTMLDivElement>): string | null {
    const edge = edgeAtPoint(point);

    // Detect modifier keys to lock aspect ratio, if not set already
    if (edge && !aspectRatio && event && (event.ctrlKey || event.metaKey || event.shiftKey)) {
      const { x1, y1, x2, y2 } = startRectRef.current!;
      customAspectRatioRef.current = (x2 - x1) / (y2 - y1);
    }

    return edge;
  }

  function setMouseCursor(edge: string | null, event: PointerEvent<HTMLDivElement>) {
    const eventTarget = event.target as HTMLDivElement;
    let cursor = CURSOR_MAP[edge as keyof typeof CURSOR_MAP];

    if (edge === 'rotate' && rotationEnabled) {
      const angle = rotationRef.current;
      const baseSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none" stroke="black" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M24 16a8 8 0 1 1-1.7-5.9"/><path d="M8 16a8 8 0 1 0 1.7 5.9"/><path d="M24 8l4-4-4-4"/><path d="M8 24l-4 4 4 4"/></svg>`;
      const rotatedSvg = baseSvg.replace('<svg ', `<svg transform="rotate(${angle} 16 16)" `);
      const encodedSvg = encodeURIComponent(rotatedSvg);
      cursor = `url("data:image/svg+xml,${encodedSvg}") 16 16, ew-resize`;
    }

    eventTarget.style.cursor = cursor ?? '';
    if (event.currentTarget) event.currentTarget.style.cursor = cursor ?? '';
  }

  function drawMask(hasRectChanged?: boolean) {
    const { scale } = dimensionsRef.current;
    const ctx = overlayRef.current?.getContext('2d');
    if (!ctx) return;

    // The tool overlay is ONE 2D context for the whole session, and every tool area is handed the
    // same object, so the `rgba(0, 0, 0, 0.7)` dim below renders at `0.7 x whatever globalAlpha
    // the last tool left` — 0.63 after any default brush stroke, 0.14 at 20% opacity. Reset here
    // rather than at each call site, and BEFORE the `hideBlend` block so the dim and the stroke are
    // both covered. The dash this function owns is written after, deliberately.
    resetOverlayAlpha(ctx);

    ctx.clearRect(0, 0, imageSize.width, imageSize.height);

    const rect = rectUnsortedRef.current;
    if (!rect) return;

    // Sorted once and used twice: the paint below and the report at the bottom, which is the
    // sorted rect UNCLAMPED in every case. Only the paint has a choice of geometry.
    //
    // `trimRect` clamps the painted rect to the frame — `[0, 0, overlay canvas size]`, in canvas
    // px — so a box dragged past the frame edge snapped back to it while the reported rect kept
    // the overhang. `sortRoundRect` is the same sort and the same one-round-per-edge rounding with
    // the clamp dropped, so a rect that lies inside the frame paints identically on both paths and
    // only the part that leaves it differs.
    const sortedRect = sortRect(rect);
    const { x, y, width, height } = allowOutsideCanvas ? sortRoundRect(sortedRect) : trimRect(sortedRect, imageSize);
    const angle = rotationEnabled ? rotationRef.current : 0;
    const centerX = x + width / 2;
    const centerY = y + height / 2;

    if (!hideBlend) {
      // Draw semi-transparent overlay

      ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.fillRect(0, 0, imageSize.width, imageSize.height);

      // Clear the selection area. The DIM is the frame, not the selection — the `fillRect` above
      // is `[0, 0, imageSize]`, the frame rect in canvas px — so the cut-out is against the frame
      // rectangle in both modes, and this line is the only part of the blend the prop reaches: a
      // negative CANVAS-origin `clearRect` is clipped by the backing store to exactly the part of
      // the true rect that overlaps the frame, which is the cut-out wanted.
      if (angle === 0) {
        ctx.clearRect(x, y, width, height);
      } else {
        ctx.save();
        ctx.translate(centerX, centerY);
        ctx.rotate((angle * Math.PI) / 180);
        ctx.clearRect(-width / 2, -height / 2, width, height);
        ctx.restore();
      }
    }

    if (overlayType) {
      if (angle === 0) {
        drawCropOverlay(
          ctx,
          { x, y, width, height },
          overlayType,
          overlayOrientation,
          scale,
          documentCanvasRef?.current,
          overlayVisibility,
          gridDivisions,
          isMouseDown.current
        );
      } else {
        ctx.save();
        ctx.translate(centerX, centerY);
        ctx.rotate((angle * Math.PI) / 180);
        drawCropOverlay(
          ctx,
          { x: -width / 2, y: -height / 2, width, height },
          overlayType,
          overlayOrientation,
          scale,
          documentCanvasRef?.current,
          overlayVisibility,
          gridDivisions,
          isMouseDown.current
        );
        ctx.restore();
      }
    }

    // The one thing on this overlay that another canvas can also draw, and so the reason
    // `borderMode` exists: for a selection, the ants canvas strokes the same rectangle one layer
    // up in black and white, and two outlines of one selection is worse than either alone.
    // `'while-dragging'` keeps the stroke only while a gesture is in flight, which is the whole of
    // the time there is no committed selection for the ants to draw instead
    // (`selection-drag-preview.ts:16`-`:17` for Adobe's own answer to the same two-outlines
    // problem, `Select > Transform Selection`). Both terms of that condition are explained on
    // `beginGesture` — they are read rather than passed in because all seven of this function's
    // call sites would otherwise have to be told which of the two questions they were answering,
    // and the drag path and the final paint answer different ones.
    if (borderMode === 'always' || (isGestureActiveRef.current && isMouseDown.current)) {
      ctx.strokeStyle = '#007bff';
      ctx.lineWidth = 2 / scale;
      ctx.setLineDash([RECT_BORDER_DASH_LENGTH / scale, RECT_BORDER_DASH_LENGTH / scale]);
      ctx.lineDashOffset =
        borderMode === 'while-dragging' && isGestureActiveRef.current && isMouseDown.current
          ? borderDashOffsetRef.current
          : 0;
      if (angle === 0) {
        ctx.strokeRect(x, y, width, height);
      } else {
        ctx.save();
        ctx.translate(centerX, centerY);
        ctx.rotate((angle * Math.PI) / 180);
        ctx.strokeRect(-width / 2, -height / 2, width, height);
        ctx.restore();
      }
    }
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;

    // The handles stay in both modes, deliberately: they are the resize hit area and this hook's
    // only interactive affordance, and `'while-dragging'` stands the ants DOWN for the duration
    // of the very gesture that needs them. Gating them with the border would leave a resize with
    // nothing to grab.
    //
    // Draw handles. `hIn` is the offset from the rect's LEFT and TOP edge and `hOut` the one added to
    // its RIGHT and BOTTOM edge. Outside grips end at their corners; the matching hit areas in
    // `edgeAtPoint` cover those same squares. Other consumers keep a straddling grip and hit area.
    const h1 = HANDLE_SIZE / scale;
    const hIn = handlesOutside ? -h1 : -h1 / 2;
    const hOut = handlesOutside ? 0 : -h1 / 2;
    ctx.fillStyle = '#007bff';
    if (angle === 0) {
      ctx.fillRect(x + hIn, y + hIn, h1, h1);
      ctx.fillRect(x + width + hOut, y + hIn, h1, h1);
      ctx.fillRect(x + hIn, y + height + hOut, h1, h1);
      ctx.fillRect(x + width + hOut, y + height + hOut, h1, h1);
    } else {
      ctx.save();
      ctx.translate(centerX, centerY);
      ctx.rotate((angle * Math.PI) / 180);
      ctx.fillRect(-width / 2 + hIn, -height / 2 + hIn, h1, h1);
      ctx.fillRect(width / 2 + hOut, -height / 2 + hIn, h1, h1);
      ctx.fillRect(-width / 2 + hIn, height / 2 + hOut, h1, h1);
      ctx.fillRect(width / 2 + hOut, height / 2 + hOut, h1, h1);
      ctx.restore();
    }

    if (rotationEnabled) {
      ctx.save();
      ctx.translate(centerX, centerY);
      ctx.rotate((angle * Math.PI) / 180);
      ctx.strokeStyle = '#007bff';
      ctx.lineWidth = 1 / scale;
      ctx.beginPath();
      ctx.arc(0, -height / 2 - ROTATE_HOTZONE / scale / 2, 4 / scale, Math.PI * 0.2, Math.PI * 1.8);
      ctx.stroke();
      ctx.restore();
    }

    // todo update status bar - add func on each update
    onRepaint?.(sortedRect);

    if (hasRectChanged) {
      onChange?.(sortedRect);
    }
  }

  function adjustHeightRatio({ x1, y1, x2, y2 }: RectXY, _aspectRatio: number | null) {
    if (_aspectRatio) {
      const width = Math.abs(x2 - x1);
      const currentHeight = Math.abs(y2 - y1);
      const wantedHeight = width / _aspectRatio;
      const diff = (wantedHeight - currentHeight) / 2;
      if (y1 < y2) {
        y1 -= diff;
        y2 += diff;
      } else {
        y1 += diff;
        y2 -= diff;
      }
    }
    return { y1, y2 };
  }

  /**
   * A free drag's own aspect constraint: whichever axis is proportionally too long is shortened,
   * so the result always satisfies `width / height === _aspectRatio`.
   *
   * `refitRectWidthToAspect` enforces the same relation from the other side, and this function's
   * output is a fixed point of it. That fixed point is the load-bearing property: the effect above
   * refits `initialRect` through `refitRectWidthToAspect` on every render, so a disagreement here
   * refitted the rect the overlay had just published into a different shape and repainted it, and
   * the refitted rect is the one `onChangeEnd` committed.
   */
  function adjustFreePoint(point: Point, _aspectRatio: number | null) {
    const x1 = startPointRef.current!.x;
    const y1 = startPointRef.current!.y;
    let x2 = point.x;
    let y2 = point.y;

    if (_aspectRatio) {
      const width = Math.abs(x2 - x1);
      const height = Math.abs(y2 - y1);
      if (width / height > _aspectRatio) {
        x2 = x1 + height * _aspectRatio * (x2 < x1 ? -1 : 1);
      } else {
        y2 = y1 + (width / _aspectRatio) * (y2 < y1 ? -1 : 1);
      }
    }
    return { x1, y1, x2, y2 };
  }

  /**
   * A fresh drag under Photoshop's marquee modifiers.
   *
   * The square is taken on the RADIUS per axis, before the drag is mirrored, so Shift+Alt is a
   * square centred on the press point rather than a square that has drifted off it. Both axes
   * are half-extents here; `sortRect` at the caller is what turns the mirrored form into the
   * sorted rect the rest of the hook works with.
   *
   * A drag with neither modifier set returns `adjustFreePoint`'s result unchanged, which is why
   * this can be an opt-in rather than a change of behaviour for the two consumers that pass
   * neither prop.
   */
  function adjustFreshPoint(point: Point, modifiers: FreshDragModifiers, _aspectRatio: number | null) {
    if (fixedSize && fixedSize.width > 0 && fixedSize.height > 0) {
      const halfWidth = fixedSize.width / 2;
      const halfHeight = fixedSize.height / 2;
      return {
        x1: startPointRef.current!.x - halfWidth,
        y1: startPointRef.current!.y - halfHeight,
        x2: startPointRef.current!.x + halfWidth,
        y2: startPointRef.current!.y + halfHeight,
      };
    }

    if (!modifiers.constrainToSquare && !modifiers.fromCentre) return adjustFreePoint(point, _aspectRatio);

    const x1 = startPointRef.current!.x;
    const y1 = startPointRef.current!.y;
    const halfWidth = Math.abs(point.x - x1);
    const halfHeight = Math.abs(point.y - y1);
    const half = modifiers.constrainToSquare ? Math.max(halfWidth, halfHeight) : null;

    const x2 = x1 + (half ?? halfWidth) * (point.x < x1 ? -1 : 1);
    const y2 = y1 + (half ?? halfHeight) * (point.y < y1 ? -1 : 1);

    if (!modifiers.fromCentre) return { x1, y1, x2, y2 };

    return { x1: 2 * x1 - x2, y1: 2 * y1 - y2, x2, y2 };
  }

  function calculateMaskRect(point: Point) {
    let x1, x2, y1, y2;
    const _initialRect = startRectRef.current;
    const startPoint = startPointRef.current!;
    const edge = currentEdgeRef.current;

    const _aspectRatio = customAspectRatioRef.current ?? aspectRatio;
    const localPoint =
      _initialRect && rotationEnabled
        ? rotatePointAround(point, rectCenter(_initialRect), -rotationRef.current)
        : point;

    if (_initialRect && edge) {
      ({ x1, y1, x2, y2 } = _initialRect);
      switch (edge) {
        case 'inside': {
          const dx = point.x - startPoint.x;
          const dy = point.y - startPoint.y;
          x1 += dx;
          y1 += dy;
          x2 += dx;
          y2 += dy;
          break;
        }
        case 'left':
          x1 = localPoint.x;
          ({ y1, y2 } = adjustHeightRatio({ x1, y1, x2, y2 }, _aspectRatio));
          break;
        case 'right':
          x2 = localPoint.x;
          ({ y1, y2 } = adjustHeightRatio({ x1, y1, x2, y2 }, _aspectRatio));
          break;
        case 'top':
          y1 = localPoint.y;
          ({ x1, x2 } = refitRectWidthToAspect({ x1, y1, x2, y2 }, _aspectRatio));
          break;
        case 'bottom':
          y2 = localPoint.y;
          ({ x1, x2 } = refitRectWidthToAspect({ x1, y1, x2, y2 }, _aspectRatio));
          break;
        case 'rotate': {
          const center = rectCenter(_initialRect);
          rotationRef.current =
            startRotationRef.current + angleFromCenter(center, point) - rotationStartAngleRef.current;
          onRotationChange?.(rotationRef.current);
          ({ x1, y1, x2, y2 } = _initialRect);
          break;
        }
        default:
          ({ x1, y1, x2, y2 } = adjustFreePoint(localPoint, _aspectRatio));
      }
    } else {
      // A marquee under a modifier is not held to the last one's ratio: `adjustFreshPoint` takes
      // the square on its own, and `getEdgeAtPoint` no longer records anything for a press that
      // landed on empty canvas, so `customAspectRatioRef` can only hold a RESIZE's ratio here.
      const modifiers = freshDragModifiersRef.current;
      const isModified = modifiers.constrainToSquare || modifiers.fromCentre;
      ({ x1, y1, x2, y2 } = adjustFreshPoint(point, modifiers, isModified ? null : _aspectRatio));
    }

    const result = {
      x1,
      y1,
      x2,
      y2,
    };
    rectUnsortedRef.current = result; // save for resize to work

    return result;
  }

  ////////////////////////////

  /**
   * Sample the modifiers a fresh drag is being held under, and forget them again on release.
   *
   * Read per event rather than once at press time, so pressing Shift or Alt halfway through a
   * drag takes hold immediately — the same call produces the preview and the commit, exactly as
   * `EllipticalSelectionToolArea` does it. Sampled into a ref because the move handler hands the
   * work to a frame, and an event object read across that boundary is a stale read.
   */
  function sampleFreshDragModifiers(event: PointerEvent<HTMLDivElement>) {
    freshDragModifiersRef.current.constrainToSquare = constrainToSquare && event.shiftKey;
    freshDragModifiersRef.current.fromCentre = fromCentre && event.altKey;
  }

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>, layerUnderPointer?: Layer): boolean => {
    if (!isPointerDownValid(event)) {
      // A press this hook refused — a non-primary button, or a second pointer — starts nothing,
      // so this is where an entry left over from an earlier gesture gets swept. Guarded on
      // nothing of ours being in flight, because a second pointer arriving mid-drag lands on this
      // same line: clearing there would put the committed border back on screen beside the
      // rectangle being dragged, which is the one thing this channel exists to prevent.
      if (!isGestureActiveRef.current) endGesture();

      return false;
    }

    // The gesture starts here, at the one point that knows a primary pointer was accepted, and
    // before the `drawMask()` further down in this function so the Move tool's own press-time
    // paint already belongs to a gesture rather than to an idle rect.
    beginGesture();

    let isHandleClicked = false;

    currentEdgeRef.current = null;
    sampleFreshDragModifiers(event);

    const point = getLocalCoords(event);
    startPointRef.current = point;

    const selectionRect = startRectRef.current;

    if (selectionRect) {
      const edge = getEdgeAtPoint(point, event);
      currentEdgeRef.current = edge;

      isHandleClicked = !!edge;

      setMouseCursor(edge, event);

      switch (edge) {
        case 'top-left':
          startPointRef.current = {
            x: selectionRect.x2,
            y: selectionRect.y2,
          };
          break;
        case 'top-right':
          startPointRef.current = {
            x: selectionRect.x1,
            y: selectionRect.y2,
          };
          break;
        case 'bottom-left':
          startPointRef.current = {
            x: selectionRect.x2,
            y: selectionRect.y1,
          };
          break;
        case 'bottom-right':
          startPointRef.current = {
            x: selectionRect.x1,
            y: selectionRect.y1,
          };
          break;
        case 'rotate':
          startRotationRef.current = rotationRef.current;
          rotationStartAngleRef.current = angleFromCenter(rectCenter(selectionRect), point);
          break;
      }
    }

    if (!isHandleClicked && layerUnderPointer && !layerUnderPointer.isBedrock) {
      rectUnsortedRef.current = posToSortedRect(layerUnderPointer.pos);
      startRectRef.current = { ...rectUnsortedRef.current };

      currentEdgeRef.current = 'inside';
      setMouseCursor('inside', event);
      drawMask();
    }

    // An existing rect is already painted when the press is accepted, so do not wait for the
    // first pointer move to start the marquee's crawl. Fresh drags have no rect yet and are
    // started by the pointer-move frame after `calculateMaskRect` creates one.
    scheduleBorderAnimation();

    return isHandleClicked;
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>): boolean => {
    const point = getLocalCoords(event);

    // detect mouse over drag handles
    if (!isMouseDown.current) {
      const edge = getEdgeAtPoint(point);
      setMouseCursor(edge, event);
      return !!edge;
    }

    if (!isPointerMoveValid(event)) return false;
    if (isMoveTool && !startRectRef.current) return false;

    sampleFreshDragModifiers(event);
    pendingPoint.current = point;
    if (frameRequested.current !== null) return false;

    frameRequested.current = requestAnimationFrame(() => {
      frameRequested.current = null;

      calculateMaskRect(pendingPoint.current!);
      drawMask(true);
      scheduleBorderAnimation();
    });

    return false;
  };

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    // Deliberately NOT `endGesture()` on this refusal. A release this hook does not own is not
    // the end of this gesture: a non-primary-button release shares the tracked pointer's id and is
    // refused by the button check (`usePointerPosition.ts:228`), and the genuine primary release
    // still arrives after it. Clearing here would bring the ants back for the rest of a drag that
    // is still running.
    if (!isPointerUpValid(event)) return;

    (event.target as HTMLDivElement).style.cursor = '';
    if (event.currentTarget) event.currentTarget.style.cursor = '';

    if (isMoveTool && !startRectRef.current) {
      // A release this hook DID accept, so nothing of ours is in flight afterwards whatever this
      // branch skips — the same reason the run below ends the gesture.
      endGesture();

      return;
    }

    // Sampled before the geometry is computed, so a modifier released between the last move and
    // the release governs the rect that is actually committed.
    sampleFreshDragModifiers(event);

    const point = getLocalCoords(event);
    const sortedRect = sortRect(calculateMaskRect(point));
    onChangeEnd(sortedRect);

    startRectRef.current = { ...sortedRect };
    startPointRef.current = null;
    currentEdgeRef.current = null;
    customAspectRatioRef.current = null;
    Object.assign(freshDragModifiersRef.current, NO_MODIFIERS);

    cancelAnimationFrame(frameRequested.current!);
    frameRequested.current = null;

    // With the rest of the gesture's own state, and before the final paint: the paint below is
    // of a finished gesture, not of a live one.
    endGesture();

    drawMask();
  };

  // The return is GROUPED, and the grouping is the point.
  //
  // It used to be one flat object that three components spread straight onto a
  // `<div>`: `<div {...pointerEvents}>`. That put nine members of this hook's
  // internal API on a DOM node, and React logged an error for each of them on
  // every render of the Crop, Rectangular Selection and Text tools:
  //
  //   "Invalid value for prop `redraw` on <div> tag"        (a function)
  //   "React does not recognize the `clearSelection` prop"  ... and the same for
  //   `dimensionsRef`, `getLocalCoords`, `isMouseDown`, `isPointerDownValid`,
  //   `isPointerMoveValid`, `isPointerUpValid` and `pointerIdRef`.
  //
  // No test could see it: `e2e/` had no `console` listener. It was found by a
  // headless probe (scripts/probe-console.mjs) and is now pinned by the shared
  // `ConsolePolice` fixture.
  //
  // `pointerHandlers` is the only group any caller may spread onto an element,
  // and it holds only the three DOM handlers. The other two are named so that
  // spreading the hook's result is a type error rather than nine console errors.
  //
  // `pointerState.currentEdgeRef` is exposed as a FACT about the press and NOT as a
  // gesture classifier: it is `null` while the current press began on empty canvas, and holds
  // `'inside'` or one of the nine edge names when it began on an existing box. Only this hook knows
  // which of those happened, because only it runs `getEdgeAtPoint`. A caller that needs to tell a
  // fresh placement from a move or a resize — the Type tool, to decide whether the gesture may
  // CHANGE what kind of box it is — reads it. What that gesture MEANS stays with the caller: the
  // 3px click/drag threshold the Type tool applies is not here, because this hook is also the
  // crop's, the move's and every selection tool's.
  return {
    pointerHandlers: {
      onPointerDown: handlePointerDown,
      onPointerMove: handlePointerMove,
      onPointerUp: handlePointerUp,
    },
    rectHandles: {
      redraw: () => drawMask(),
      clearSelection: () => {
        startRectRef.current = null;
        rectUnsortedRef.current = null;
        currentEdgeRef.current = null;
        customAspectRatioRef.current = null;
        Object.assign(freshDragModifiersRef.current, NO_MODIFIERS);
        drawMask();
      },
    },
    pointerState: { ...pointerPositionData, currentEdgeRef },
  };
}
