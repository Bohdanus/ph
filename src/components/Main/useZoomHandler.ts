import { type PointerEvent, useContext, useRef } from 'react';
import { type Delta, ImageContext } from '../../contexts/ImageContext';

export const useZoomHandler = () => {
  const { zoomData, setZoomData, interactionMode } = useContext(ImageContext);
  const isMouseDown = useRef(false);
  const panRef = useRef<Delta | null>(null);
  const isPanning = useRef(false);
  const lastPoint = useRef({ x: 0, y: 0 });

  const handleWheel = (event: React.WheelEvent) => {
    event.preventDefault();
    const delta = event.deltaY;
    const zoomStep = 0.1;
    const { zoom } = zoomData;
    const newZoom = delta > 0 ? zoom / (1 + zoomStep) : zoom * (1 + zoomStep);

    // Limit zoom level
    const clampedZoom = Math.min(Math.max(newZoom, 0.1), 10);
    setZoomData(clampedZoom);
  };

  const handleMouseDown = (event: PointerEvent<HTMLCanvasElement>) => {
    if (interactionMode !== 'pan') return;
    if (event.button !== 0 && event.button !== 1) return; // Left or middle click

    isPanning.current = true;
    lastPoint.current = { x: event.clientX, y: event.clientY };
  };

  const handleMouseMove = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!isPanning.current) return;

    const dx = event.clientX - lastPoint.current.x;
    const dy = event.clientY - lastPoint.current.y;

    setPan({
      x: pan.x + dx,
      y: pan.y + dy,
    });

    lastPoint.current = { x: event.clientX, y: event.clientY };
  };

  const handleMouseUp = () => {
    isPanning.current = false;
  };

  return {
    handleWheel,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
  };
};
