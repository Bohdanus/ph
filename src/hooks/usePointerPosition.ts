import React, { type RefObject, useEffect, useRef } from 'react';
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

  const calculateDimensions = () => {
    // todo reposition this fn down
    const rect = containerRectRef.current || ref.current?.getBoundingClientRect();
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

    onResize?.(dimensionsRef.current);
  };

  useEffect(() => {
    calculateDimensions();
  }, [imageSize]);

  useResizeObserverRAF(ref, (rect: Pos) => {
    containerRectRef.current = rect;
    calculateDimensions();
  });

  function clearEvent(e: React.PointerEvent<T>) {
    // Safe even if capture was already lost
    try {
      if (activePointerId.current) {
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
  const onPointerCancel = (e: PointerEvent) => {
    if (activePointerId.current === e.pointerId) {
      activePointerId.current = null;
      isMouseDown.current = false;
    }
  };

  useEffect(() => {
    ref.current?.addEventListener('pointercancel', onPointerCancel);

    return () => {
      ref.current?.removeEventListener('pointercancel', onPointerCancel);
    };
  }, [ref]);

  const getLocalCoords = (e: React.PointerEvent<T>): Point => {
    const rect = containerRectRef.current;
    // prevent calculation before ResizeObserver first run
    if (!rect) return { x: 0, y: 0 };

    const { offsetX, offsetY, scale } = dimensionsRef.current;

    // Element-relative CSS pixels
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
