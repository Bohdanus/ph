import React, { type RefObject, useCallback, useEffect, useRef } from 'react';
import { useResizeObserverRAF } from './useResizeObserver.ts';
import type { Point, Pos, Size } from '../contexts/general-types.ts';

export type ContainDimensions = {
  innerWidth: number; // inner image
  innerHeight: number;
  outerWidth: number; // container
  outerHeight: number;
  offsetX: number; // gap between image and container
  offsetY: number;
  scale: number; // how much is image scaled to be contained
};

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
      publishedFitRef.current = signature;

      const node = ref.current;
      if (!node) return;
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
      const { width: imageWidth, height: imageHeight } = imageSize;

      const scaleX = outerWidth / imageWidth;
      const scaleY = outerHeight / imageHeight;

      const scale = Math.min(scaleX, scaleY);

      const innerWidth = imageWidth * scale;
      const innerHeight = imageHeight * scale;
      const offsetX = (outerWidth - innerWidth) / 2;
      const offsetY = (outerHeight - innerHeight) / 2;

      dimensionsRef.current = {
        innerWidth,
        innerHeight,
        outerWidth,
        outerHeight,
        offsetX,
        offsetY,
        scale,
      };

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

  function clearEvent(e: React.PointerEvent<T>) {
    // Safe even if capture was already lost
    try {
      // Only the `null` sentinel means "no active pointer" -- a truthiness test also
      // reads a pointer numbered 0 as absent, because Pointer Events reserves only `-1`
      // and a UA may number from 0. Defensive rather than a fix for a reported engine.
      if (activePointerId.current !== null) {
        e.currentTarget.releasePointerCapture(activePointerId.current);
      }
    } catch {
      // ignore
    }

    isMouseDown.current = false;
    activePointerId.current = null;
  }

  const isPointerDownValid = (e: React.PointerEvent<T>) => {
    if (e.button !== 0) return false; // Only handle left click

    // First pointer wins (this should prevent against multiclick??)
    if (activePointerId.current !== null) return false;

    isMouseDown.current = true;
    activePointerId.current = e.pointerId;
    e.currentTarget.setPointerCapture(e.pointerId);

    return true;
  };

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

    clearEvent(e);

    return true;
  };

  // in theory its managed internally by this hook, so not exposed outside
  const onPointerCancel = useCallback((e: PointerEvent) => {
    if (activePointerId.current === e.pointerId) {
      activePointerId.current = null;
      isMouseDown.current = false;
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
    isPointerDownValid, // tells if the event was captured (therefore should be handled)
    isPointerMoveValid, // tells if the event was captured (therefore should be handled)
    isPointerUpValid, // tells if the event was captured (therefore should be handled)
  };
}
