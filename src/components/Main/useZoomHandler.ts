import { type PointerEvent, useContext, useRef } from 'react';
import { ImageContext } from '../../contexts/ImageContext';

export const useZoomHandler = () => {
  const { zoomDataRef, setZoomData, interactionMode } = useContext(ImageContext);
  const isPanning = useRef(false);
  const lastPoint = useRef({ x: 0, y: 0 });
  const activePointers = useRef<Map<number, { x: number; y: number }>>(new Map());
  const lastPinchDistance = useRef<number | null>(null);

  const handleWheel = (event: React.WheelEvent) => {
    // event.preventDefault(); // handled by the caller or browser
    const delta = event.deltaY;
    const zoomStep = 0.1;
    const { zoom } = zoomDataRef.current;
    const newZoom = delta > 0 ? zoom / (1 + zoomStep) : zoom * (1 + zoomStep);

    // Limit zoom level
    const clampedZoom = Math.min(Math.max(newZoom, 0.1), 10);
    setZoomData({ ...zoomDataRef.current, zoom: clampedZoom });
  };

  const handlePointerDown = (event: PointerEvent<HTMLElement>) => {
    activePointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (activePointers.current.size === 1) {
      if (interactionMode !== 'zoom') return;
      if (event.button !== 0 && event.button !== 1) return; // Left or middle click

      isPanning.current = true;
      lastPoint.current = { x: event.clientX, y: event.clientY };
    } else if (activePointers.current.size === 2) {
      isPanning.current = false; // Disable panning when pinching
      const points = Array.from(activePointers.current.values());
      lastPinchDistance.current = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
    }
  };

  const handlePointerMove = (event: PointerEvent<HTMLElement>) => {
    if (!activePointers.current.has(event.pointerId)) return;
    activePointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (activePointers.current.size === 1 && isPanning.current) {
      const dx = event.clientX - lastPoint.current.x;
      const dy = event.clientY - lastPoint.current.y;

      const { dx: prevDx, dy: prevDy, zoom } = zoomDataRef.current;
      setZoomData({
        zoom,
        dx: prevDx + dx,
        dy: prevDy + dy,
      });

      lastPoint.current = { x: event.clientX, y: event.clientY };
    } else if (activePointers.current.size === 2 && lastPinchDistance.current !== null) {
      const points = Array.from(activePointers.current.values());
      const distance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
      const delta = distance - lastPinchDistance.current;

      if (Math.abs(delta) > 1) {
        const zoomStep = delta > 0 ? 1.05 : 0.95;
        const { zoom } = zoomDataRef.current;
        const newZoom = zoom * zoomStep;
        const clampedZoom = Math.min(Math.max(newZoom, 0.1), 10);

        setZoomData({ ...zoomDataRef.current, zoom: clampedZoom });
        lastPinchDistance.current = distance;
      }
    }
  };

  const handlePointerUp = (event: PointerEvent<HTMLElement>) => {
    activePointers.current.delete(event.pointerId);
    if (activePointers.current.size < 2) {
      lastPinchDistance.current = null;
    }
    if (activePointers.current.size === 0) {
      isPanning.current = false;
    }
  };

  return {
    handleWheel,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
  };
};
