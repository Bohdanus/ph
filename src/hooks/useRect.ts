import { type PointerEvent, type RefObject, useEffect, useRef } from 'react';
import type { Point, RectXY, RectXYSorted, Size } from '../contexts/general-types.ts';
import { usePointerPosition } from './usePointerPosition.ts';
import { getCanvasSize, posToSortedRect, sortRect, trimRect } from '../util/rect.ts';
import { CURSOR_MAP, HANDLE_SIZE } from '../util/constants.ts';
import { resetOverlayAlpha } from '../util/canvas.ts';
import { refitRectWidthToAspect } from '../util/rect-aspect.ts';
import { isEqual } from 'lodash-es';
import type { Layer } from '../contexts/layer-types.ts';

export type UseRectProps = {
  aspectRatio?: number | null;
  imageSize: Size;
  initialRect?: RectXYSorted | null; // can be set using props

  hideBlend?: boolean;
  isMoveTool?: boolean;

  /**
   * Shift: hold a FRESH drag to a square, whatever `aspectRatio` says.
   *
   * Opt-in per consumer because this hook is shared: crop and the Move tool pass neither this
   * nor `fromCentre`, and a drag with both unset runs `adjustFreePoint` exactly as it always
   * has. A handle RESIZE is not a fresh drag and is not affected either — the modifier that
   * locks a resize is the aspect ratio `getEdgeAtPoint` already captures.
   */
  constrainToSquare?: boolean;
  /** Alt: grow a fresh drag out from the press point instead of away from it. */
  fromCentre?: boolean;

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

export function useRect({
  aspectRatio = null,
  imageSize,
  initialRect,

  hideBlend,
  isMoveTool,
  constrainToSquare = false,
  fromCentre = false,

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

  const pendingPoint = useRef<Point | null>(null);
  const frameRequested = useRef<number | null>(null);

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

  /**
   * The overlay canvas outlives this hook: `Main.tsx:239-284` renders both overlay canvases
   * unconditionally and only toggles `display`, and toggling `display` never touches a backing
   * store. The effect above is the only other thing that clears it, and it cannot cover the AREA
   * going away — `goToTool` (`src/hooks/useApp.ts:167-196`) appends the selection clear and
   * dispatches `SET_TOOL_NAME` from one function body, React batches them, and the marquee's
   * component unmounts in the same commit that nulls the selection. An unmounted component's
   * effects do not run, so `initialRect` is never observed going null and the `#007bff` outline,
   * the four `#007bff` handles and the `rgba(0, 0, 0, 0.7)` blend all survive the tool switch
   * that deselected them, sitting on the overlay the next tool previews into.
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
   *     effect BODY.
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

      if (ctx) {
        ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      }
    };
  }, [overlayRef]);

  const pointerPositionData = usePointerPosition({
    ref: containerRef,
    imageSize,
    onResize: () => {
      drawMask();
    },
  });

  const { isPointerDownValid, isPointerMoveValid, isPointerUpValid, getLocalCoords, isMouseDown, dimensionsRef } =
    pointerPositionData;

  function getEdgeAtPoint(point: Point, event?: PointerEvent<HTMLDivElement>): string | null {
    const _initialRect = startRectRef.current;
    if (_initialRect) {
      const { x1, y1, x2, y2 } = _initialRect;
      const { scale } = dimensionsRef.current;
      const h2 = HANDLE_SIZE / scale / 2;

      // Detect modifier keys to lock aspect ratio, if not set already
      if (!aspectRatio && event && (event.ctrlKey || event.metaKey || event.shiftKey)) {
        customAspectRatioRef.current = (x2 - x1) / (y2 - y1);
      }

      // check for tops
      if (point.x >= x1 - h2 && point.x <= x1 + h2 && point.y >= y1 - h2 && point.y <= y1 + h2) {
        return 'top-left';
      }
      if (point.x >= x2 - h2 && point.x <= x2 + h2 && point.y >= y1 - h2 && point.y <= y1 + h2) {
        return 'top-right';
      }
      if (point.x >= x1 - h2 && point.x <= x1 + h2 && point.y >= y2 - h2 && point.y <= y2 + h2) {
        return 'bottom-left';
      }
      if (point.x >= x2 - h2 && point.x <= x2 + h2 && point.y >= y2 - h2 && point.y <= y2 + h2) {
        return 'bottom-right';
      }

      // check for line
      if (point.x >= x1 && point.x <= x2 && point.y >= y1 - h2 && point.y <= y1 + h2) {
        return 'top';
      }
      if (point.x >= x2 - h2 && point.x <= x2 + h2 && point.y >= y1 && point.y <= y2) {
        return 'right';
      }
      if (point.x >= x1 - h2 && point.x <= x1 + h2 && point.y >= y1 && point.y <= y2) {
        return 'left';
      }
      if (point.x >= x1 && point.x <= x2 && point.y >= y2 - h2 && point.y <= y2 + h2) {
        return 'bottom';
      }

      // inside the resize square
      if (point.x > x1 && point.x < x2 && point.y > y1 && point.y < y2) {
        return 'inside';
      }
    }

    return null;
  }

  function setMouseCursor(edge: string | null, event: PointerEvent<HTMLDivElement>) {
    const eventTarget = event.target as HTMLDivElement;
    const cursor = CURSOR_MAP[edge as keyof typeof CURSOR_MAP];

    eventTarget.style.cursor = cursor ?? '';
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

    const { x, y, width, height } = trimRect(sortRect(rect), getCanvasSize(overlayRef));

    if (!hideBlend) {
      // Draw semi-transparent overlay

      ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.fillRect(0, 0, imageSize.width, imageSize.height);

      // Clear the selection area
      ctx.clearRect(x, y, width, height);
    }

    ctx.strokeStyle = '#007bff';
    ctx.lineWidth = 2 / scale;
    ctx.setLineDash([5 / scale, 5 / scale]);
    ctx.strokeRect(x, y, width, height);
    ctx.setLineDash([]);

    // Draw handles
    const h1 = HANDLE_SIZE / scale;
    const h2 = h1 / 2;
    ctx.fillStyle = '#007bff';
    ctx.fillRect(x - h2, y - h2, h1, h1);
    ctx.fillRect(x + width - h2, y - h2, h1, h1);
    ctx.fillRect(x - h2, y + height - h2, h1, h1);
    ctx.fillRect(x + width - h2, y + height - h2, h1, h1);

    // todo update status bar - add func on each update
    const sortedRect = sortRect(rect);
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
          x1 = point.x;
          ({ y1, y2 } = adjustHeightRatio({ x1, y1, x2, y2 }, _aspectRatio));
          break;
        case 'right':
          x2 = point.x;
          ({ y1, y2 } = adjustHeightRatio({ x1, y1, x2, y2 }, _aspectRatio));
          break;
        case 'top':
          y1 = point.y;
          ({ x1, x2 } = refitRectWidthToAspect({ x1, y1, x2, y2 }, _aspectRatio));
          break;
        case 'bottom':
          y2 = point.y;
          ({ x1, x2 } = refitRectWidthToAspect({ x1, y1, x2, y2 }, _aspectRatio));
          break;
        default:
          ({ x1, y1, x2, y2 } = adjustFreePoint(point, _aspectRatio));
      }
    } else {
      // The ratio is deliberately not consulted when a modifier is held: `getEdgeAtPoint` still
      // records a fresh press outside the current selection as locking THAT selection's aspect,
      // and a marquee that is being constrained to a square is not being held to the last one.
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
    if (!isPointerDownValid(event)) return false;

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
      }
    }

    if (!isHandleClicked && layerUnderPointer && !layerUnderPointer.isBedrock) {
      rectUnsortedRef.current = posToSortedRect(layerUnderPointer.pos);
      startRectRef.current = { ...rectUnsortedRef.current };

      currentEdgeRef.current = 'inside';
      setMouseCursor('inside', event);
      drawMask();
    }

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
    });

    return false;
  };

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (!isPointerUpValid(event)) return;

    (event.target as HTMLDivElement).style.cursor = '';

    if (isMoveTool && !startRectRef.current) return;

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
    pointerState: { ...pointerPositionData },
  };
}
