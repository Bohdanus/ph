import React, { type RefObject, useCallback, useEffect, useRef } from 'react';
import { useResizeObserverRAF } from './useResizeObserver.ts';
import { containFit, type ContainDimensions } from '../util/contain-fit.ts';
import type { Point, Pos, Size } from '../contexts/general-types.ts';

export type { ContainDimensions } from '../util/contain-fit.ts';

/**
 * The `data-*` attributes this hook publishes on its container, and what each one is.
 *
 * The e2e suite's `documentToCanvasOffset` re-implements the contain fit below, and until
 * now nothing compared the two: the round-trip test that claimed to was comparing that
 * helper against its own algebraic inverse, so it could not fail and never asked the app
 * anything. These attributes are the app ANSWERING, at runtime, from the same values
 * `getLocalCoords` uses, so `e2e/export/visual-regression.spec.ts` can assert the two
 * agree — at more than one rect size, including one that differs only in width.
 *
 * A `data-*` attribute rather than a `window` global on purpose: it cannot be read by
 * anything but a test that already has the element, it survives no reload state, and there
 * is no production branch to guard.
 */
export const FIT_ATTRIBUTES = {
  scale: 'data-fit-scale',
  offsetX: 'data-fit-offset-x',
  offsetY: 'data-fit-offset-y',
  outerWidth: 'data-fit-outer-width',
  outerHeight: 'data-fit-outer-height',
  documentWidth: 'data-fit-document-width',
  documentHeight: 'data-fit-document-height',
  /** The container's own viewport rect, so a reader can prove WHICH element was measured. */
  rectX: 'data-fit-rect-x',
  rectY: 'data-fit-rect-y',
} as const;

export function usePointerPosition<T extends HTMLElement>(
  {
    ref,
    imageSize,
    onResize,
  }: {
    ref: RefObject<T | null>;
    imageSize: Size;
    onResize?: (rect: ContainDimensions) => void;
  }
  // {
  //   zoom = 1,
  //   panX = 0,
  //   panY = 0,
  // } = {}
) {
  const containerRectRef = useRef<Pos | null>(null);
  const activePointerId = useRef<number | null>(null);
  /** The element the capture was taken on, so a release without an event can name it. */
  const captureTargetRef = useRef<{ releasePointerCapture?: (id: number) => void } | null>(null);
  const isMouseDown = useRef(false);

  // coordinates of the contained image within container
  const dimensionsRef = useRef<ContainDimensions>({
    innerWidth: 0,
    innerHeight: 0,
    outerWidth: 0,
    outerHeight: 0,
    offsetX: 0,
    offsetY: 0,
    scale: 1,
  });

  const onResizeRef = useRef(onResize);
  useEffect(() => {
    onResizeRef.current = onResize;
  }, [onResize]);

  /**
   * The last set of values written to the `data-fit-*` attributes, as one string.
   *
   * `getLocalCoords` calls `calculateDimensions()` on every pointer event, so publishing
   * unconditionally would be nine `setAttribute` calls per `pointermove` in production. The
   * dimensions only change on a resize, so this signature makes the write path cold: nine
   * number-to-string conversions and one comparison per event, zero DOM writes.
   */
  const publishedFitRef = useRef<string | null>(null);

  const publishFit = useCallback(
    (dimensions: ContainDimensions, rect: Pos, image: Size) => {
      const signature =
        `${dimensions.scale}|${dimensions.offsetX}|${dimensions.offsetY}|` +
        `${dimensions.outerWidth}|${dimensions.outerHeight}|` +
        `${image.width}|${image.height}|${rect.x}|${rect.y}`;
      if (signature === publishedFitRef.current) return;

      const node = ref.current;
      // Not `if (!node)`: the ref is generic over `T extends HTMLElement` and callers and
      // tests put a measured stub in it, so a truthy node is not necessarily an element, and
      // the caller has no interest in the attributes at all.
      if (typeof node?.setAttribute !== 'function') return;

      // Recorded only once the write has actually happened. Recording before the node check
      // marked the values published for a call that wrote nothing, and the signature then
      // matched for every later call with the same dimensions - so a first `calculateDimensions`
      // that ran before the element was attached suppressed the publish for good, and the
      // attributes never appeared at all.
      publishedFitRef.current = signature;

      node.setAttribute(FIT_ATTRIBUTES.scale, String(dimensions.scale));
      node.setAttribute(FIT_ATTRIBUTES.offsetX, String(dimensions.offsetX));
      node.setAttribute(FIT_ATTRIBUTES.offsetY, String(dimensions.offsetY));
      node.setAttribute(FIT_ATTRIBUTES.outerWidth, String(dimensions.outerWidth));
      node.setAttribute(FIT_ATTRIBUTES.outerHeight, String(dimensions.outerHeight));
      node.setAttribute(FIT_ATTRIBUTES.documentWidth, String(image.width));
      node.setAttribute(FIT_ATTRIBUTES.documentHeight, String(image.height));
      node.setAttribute(FIT_ATTRIBUTES.rectX, String(rect.x));
      node.setAttribute(FIT_ATTRIBUTES.rectY, String(rect.y));
    },
    [ref]
  );

  const readContainerRect = useCallback((): Pos | null => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return containerRectRef.current;

    const nextRect: Pos = { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
    containerRectRef.current = nextRect;
    return nextRect;
  }, [ref]);

  const calculateDimensions = useCallback(
    (observed?: Pos) => {
      // A rect handed in by the ResizeObserver is the measurement for this event,
      // so it is used as is. Re-reading `getBoundingClientRect()` here discarded
      // the observed size and substituted a second, possibly different one.
      if (observed) containerRectRef.current = observed;
      const rect = observed ?? readContainerRect() ?? containerRectRef.current;
      if (!rect) return;

      const { width: outerWidth, height: outerHeight } = rect;

      dimensionsRef.current = containFit({ width: outerWidth, height: outerHeight }, imageSize);

      publishFit(dimensionsRef.current, rect, imageSize);
      onResizeRef.current?.(dimensionsRef.current);
    },
    [imageSize, publishFit, readContainerRect]
  );

  useEffect(() => {
    calculateDimensions();
  }, [calculateDimensions]);

  useResizeObserverRAF(ref, (rect: Pos) => {
    calculateDimensions(rect);
  });

  /**
   * Drop the tracked pointer, releasing the capture if it is still held.
   *
   * `target` is the element the capture was taken ON, which is `e.currentTarget` and not
   * necessarily `ref.current`: `useRect` and the tool areas put their handlers on their own
   * element while `ref` is the container. Release has to name the capturing element, so
   * `captureTarget` records it at press time.
   *
   * Passing no target uses the recorded one, which is what lets an abort route call this
   * without holding an event.
   */
  function clearEvent(target?: { releasePointerCapture?: (id: number) => void } | null) {
    const captureTarget = target ?? captureTargetRef.current;

    // Safe even if capture was already lost
    try {
      // Only the `null` sentinel means "no active pointer" -- a truthiness test also
      // reads a pointer numbered 0 as absent, because Pointer Events reserves only `-1`
      // and a UA may number from 0. Defensive rather than a fix for a reported engine.
      if (activePointerId.current !== null && typeof captureTarget?.releasePointerCapture === 'function') {
        captureTarget.releasePointerCapture(activePointerId.current);
      }
    } catch {
      // ignore
    }

    isMouseDown.current = false;
    activePointerId.current = null;
    captureTargetRef.current = null;
  }

  const isPointerDownValid = (e: React.PointerEvent<T>) => {
    if (e.button !== 0) return false; // Only handle left click

    // First pointer wins (this should prevent against multiclick??)
    if (activePointerId.current !== null) return false;

    isMouseDown.current = true;
    activePointerId.current = e.pointerId;
    captureTargetRef.current = e.currentTarget as unknown as { releasePointerCapture?: (id: number) => void };
    e.currentTarget.setPointerCapture(e.pointerId);

    return true;
  };

  /**
   * Give up the captured pointer when no release event will arrive.
   *
   * `clearEvent` used to be reachable only from `isPointerUpValid`, so a gesture that ended
   * any OTHER way -- the pointer leaving the element, `pointercancel`, a caller abandoning
   * the drag -- left `activePointerId` set. While the capture is held the browser delivers
   * `pointerup` to the capture target even when the pointer was released elsewhere, so the
   * hook's ref survived and every later `isPointerDownValid` returned `false` at the
   * first-pointer-wins check: the element stopped responding to presses until it unmounted.
   * Every abort route must therefore call this, which is why it is exposed rather than left
   * inside the up path.
   */
  const releasePointer = useCallback(() => {
    clearEvent();
  }, []);

  const isPointerMoveValid = (e: React.PointerEvent<T>) => {
    if (activePointerId.current !== e.pointerId) return false;

    return true;
  };

  // heads up, we rely on this being called
  const isPointerUpValid = (e: React.PointerEvent<T>) => {
    // Symmetric with `isPointerDownValid`, and the symmetry is load-bearing: a
    // right-button release that arrives while a left drag is in flight shares the
    // left pointer's id, so matching on the id alone handed it to every caller's
    // release path — a commit, a claim release, all of it — for a release this
    // press never made. Refusing it leaves the captured pointer tracked, so the
    // genuine primary release still arrives and is the one that ends the gesture.
    if (e.button !== 0) return false; // Only handle left click

    if (activePointerId.current !== e.pointerId) return false;

    clearEvent(e.currentTarget as unknown as { releasePointerCapture?: (id: number) => void });

    return true;
  };

  // in theory its managed internally by this hook, so not exposed outside
  const onPointerCancel = useCallback((e: PointerEvent) => {
    if (activePointerId.current === e.pointerId) {
      clearEvent();
    }
  }, []);

  useEffect(() => {
    const node = ref.current;
    node?.addEventListener('pointercancel', onPointerCancel);

    return () => {
      node?.removeEventListener('pointercancel', onPointerCancel);
    };
  }, [ref, onPointerCancel]);

  const getLocalCoords = (e: React.PointerEvent<T>): Point => {
    calculateDimensions();

    const rect = readContainerRect() ?? containerRectRef.current;
    if (!rect) return { x: 0, y: 0 };

    const { offsetX, offsetY, scale } = dimensionsRef.current;

    const xCss = (e.clientX - offsetX - rect.x) / scale;
    const yCss = (e.clientY - offsetY - rect.y) / scale;

    return {
      x: xCss,
      y: yCss,
    };
  };

  return {
    pointerIdRef: activePointerId,
    dimensionsRef,
    getLocalCoords,
    isMouseDown,
    releasePointer,
    isPointerDownValid, // tells if the event was captured (therefore should be handled)
    isPointerMoveValid, // tells if the event was captured (therefore should be handled)
    isPointerUpValid, // tells if the event was captured (therefore should be handled)
  };
}
