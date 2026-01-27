import React, { type RefObject, useEffect, useRef } from 'react';
import { useResizeObserverRAF } from './useResizeObserver.ts';
import type { Point, Rect, Size } from '../contexts/ImageContext.tsx';

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
    enabled = true,
    ref,
    imageSize,
    onResize,
  }: {
    enabled?: boolean;
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
  const containerRectRef = useRef<Rect | null>(null);
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
    // todo move this fn down
    if (!enabled) return;

    // prevent calculation before resizeObserver first run
    if (!containerRectRef.current) return;

    const { width: outerWidth, height: outerHeight } = containerRectRef.current;
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
    if (!enabled) {
      // dropCurrentEvent();
      return;
    }

    calculateDimensions();
  }, [enabled, imageSize]);

  useResizeObserverRAF(ref, (rect: Rect) => {
    // For simplicity, leave resize observer working and calculating tiny things.
    // The plus od doing this is the instant response having rect in place.
    containerRectRef.current = rect;
    if (!enabled) return;

    calculateDimensions();
  });

  function clearEvent(e: React.PointerEvent<T>) {
    // Safe even if capture was already lost
    try {
      e.currentTarget.releasePointerCapture(activePointerId.current!);
    } catch {
      // ignore
    }

    isMouseDown.current = false;
    activePointerId.current = null;
  }

  const onPointerDown = (e: React.PointerEvent<T>) => {
    if (e.button !== 0) return false; // Only handle left click

    // First pointer wins
    if (activePointerId.current !== null) return false;

    isMouseDown.current = true;
    activePointerId.current = e.pointerId;
    e.currentTarget.setPointerCapture(e.pointerId);

    return true;
  };

  const onPointerUp = (e: React.PointerEvent<T>) => {
    if (activePointerId.current !== e.pointerId) return false;
    if (!isMouseDown.current) {
      throw 'this should never happen, very interesting, todo kill this check';
    }

    clearEvent(e);

    return true;
  };

  const onPointerCancel = (e: PointerEvent) => {
    if (activePointerId.current === e.pointerId) {
      activePointerId.current = null;
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
    dimensionsRef,
    getLocalCoords,
    isMouseDown,
    onPointerCancel,
    onPointerDown,
    onPointerUp,
  };
}
