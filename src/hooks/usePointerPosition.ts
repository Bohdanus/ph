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

      onResizeRef.current?.(dimensionsRef.current);
    },
    [imageSize, readContainerRect]
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
      // `0` is a valid pointerId, so only the `null` sentinel means "no active
      // pointer" -- a truthiness test leaks the capture of a pointer numbered 0.
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
