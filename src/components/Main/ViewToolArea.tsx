import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useStore } from '../../contexts/StoreContext.tsx';
import {
  absoluteViewZoom,
  clampAbsoluteViewZoom,
  DEFAULT_VIEW_STATE,
  minimumSliderZoomForCurrentView,
  minimumZoomOverrideForMagnification,
  relativeViewZoomForMagnification,
  viewportCenter,
  zoomAroundViewportPoint,
  type ViewState,
} from '../../contexts/view-state.ts';
import { useDevicePixelRatio } from '../../hooks/useDevicePixelRatio.ts';
import { useWorkspaceFitScale } from '../../hooks/useWorkspaceFitScale.ts';
import { readClientViewportRect } from '../../util/client-viewport.ts';

export type ViewToolMode = 'hand' | 'zoom' | 'rotate-view';

function shortestAngleDelta(fromDegrees: number, toDegrees: number): number {
  const delta = toDegrees - fromDegrees;
  if (delta > 180) return delta - 360;
  if (delta < -180) return delta + 360;
  return delta;
}

type ViewGesture = {
  pointerId: number;
  startX: number;
  startY: number;
  startState: ViewState;
  lastAngle: number;
  rotationDelta: number;
  startMagnification: number;
  minimumZoom: number;
  alternate: boolean;
};

export function ViewToolArea({ className, mode }: { className?: string; mode: ViewToolMode }) {
  const [{ containerRef, viewState, viewStateRef, setViewState, documentFrame }] = useStore();
  const fitScale = useWorkspaceFitScale();
  const devicePixelRatio = useDevicePixelRatio();
  const currentViewState = viewState ?? DEFAULT_VIEW_STATE;
  const minimumZoom = minimumSliderZoomForCurrentView(
    documentFrame,
    absoluteViewZoom(currentViewState, fitScale, devicePixelRatio),
    currentViewState.minimumZoomOverride
  );
  const gestureRef = useRef<ViewGesture | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);

  const relativeZoomAtMagnification = (magnification: number, compensation: number) =>
    relativeViewZoomForMagnification(magnification, fitScale, compensation, devicePixelRatio);
  const angleAboutCenter = (clientX: number, clientY: number, rect: DOMRect) =>
    (Math.atan2(clientY - (rect.y + rect.height / 2), clientX - (rect.x + rect.width / 2)) * 180) / Math.PI;

  const finish = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (gestureRef.current?.pointerId !== event.pointerId) return;
    try {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    } catch {
      // Pointer capture may already have been released by cancellation.
    }
    gestureRef.current = null;
    setDragging(false);
  };

  const reset = () => setViewState(DEFAULT_VIEW_STATE);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || gestureRef.current) return;
    const startState = { ...viewStateRef.current };
    const rect = event.currentTarget.getBoundingClientRect();
    gestureRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startState,
      lastAngle: angleAboutCenter(event.clientX, event.clientY, rect),
      rotationDelta: 0,
      startMagnification: clampAbsoluteViewZoom(absoluteViewZoom(startState, fitScale, devicePixelRatio), minimumZoom),
      minimumZoom,
      alternate: event.altKey,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const dx = event.clientX - gesture.startX;
    const dy = event.clientY - gesture.startY;
    if (mode === 'hand') {
      setViewState({ panX: gesture.startState.panX + dx, panY: gesture.startState.panY + dy });
      return;
    }
    if (mode === 'rotate-view') {
      const rect = event.currentTarget.getBoundingClientRect();
      const angle = angleAboutCenter(event.clientX, event.clientY, rect);
      gesture.rotationDelta += shortestAngleDelta(gesture.lastAngle, angle);
      gesture.lastAngle = angle;
      const rotation = gesture.startState.rotation + gesture.rotationDelta;
      setViewState({ rotation: event.shiftKey ? Math.round(rotation / 15) * 15 : rotation });
      return;
    }
    const factor = Math.pow(2, dx / 160);
    const currentState = viewStateRef.current;
    const startZoom = relativeZoomAtMagnification(gesture.startMagnification, currentState.fitScaleCompensation);
    const magnification = clampAbsoluteViewZoom(
      gesture.startMagnification * (gesture.alternate ? 1 / factor : factor),
      gesture.minimumZoom
    );
    const zoom = relativeZoomAtMagnification(magnification, currentState.fitScaleCompensation);
    const minimumZoomOverride = minimumZoomOverrideForMagnification(
      documentFrame,
      magnification,
      gesture.minimumZoom,
      currentState.minimumZoomOverride ?? gesture.startState.minimumZoomOverride
    );
    const rebasedStartState = {
      ...gesture.startState,
      zoom: startZoom,
      fitScaleCompensation: currentState.fitScaleCompensation,
      minimumZoomOverride,
    };
    const rect = containerRef.current ? readClientViewportRect(containerRef.current) : null;
    if (!rect) return;
    setViewState(
      zoomAroundViewportPoint(
        rebasedStartState,
        zoom,
        { x: gesture.startX - rect.x, y: gesture.startY - rect.y },
        viewportCenter(rect.width, rect.height)
      )
    );
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    // Pointer-up can be the final sampled position for hand, rotate, and drag-zoom input.
    // A click-to-zoom is handled separately below so it remains one fixed-step zoom.
    if (mode !== 'zoom' || Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) >= 4) {
      onPointerMove(event);
    }
    if (mode === 'zoom' && Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) < 4) {
      const rect = containerRef.current ? readClientViewportRect(containerRef.current) : null;
      if (rect) {
        const factor = gesture.alternate ? 0.8 : 1.25;
        const currentState = viewStateRef.current;
        const magnification = clampAbsoluteViewZoom(gesture.startMagnification * factor, gesture.minimumZoom);
        const minimumZoomOverride = minimumZoomOverrideForMagnification(
          documentFrame,
          magnification,
          gesture.minimumZoom,
          currentState.minimumZoomOverride ?? gesture.startState.minimumZoomOverride
        );
        const rebasedStartState = {
          ...gesture.startState,
          zoom: relativeZoomAtMagnification(gesture.startMagnification, currentState.fitScaleCompensation),
          fitScaleCompensation: currentState.fitScaleCompensation,
          minimumZoomOverride,
        };
        setViewState(
          zoomAroundViewportPoint(
            rebasedStartState,
            relativeZoomAtMagnification(magnification, currentState.fitScaleCompensation),
            { x: gesture.startX - rect.x, y: gesture.startY - rect.y },
            viewportCenter(rect.width, rect.height)
          )
        );
      }
    }
    finish(event);
  };

  const onWheel = (event: WheelEvent) => {
    event.preventDefault();
    const currentState = viewStateRef.current;
    if (!event.ctrlKey && !event.metaKey) {
      setViewState({
        panX: currentState.panX - event.deltaX,
        panY: currentState.panY - event.deltaY,
      });
      return;
    }

    const surface = surfaceRef.current;
    if (!surface) return;
    const rect = readClientViewportRect(surface);
    const currentMagnification = absoluteViewZoom(currentState, fitScale, devicePixelRatio);
    const magnification = clampAbsoluteViewZoom(currentMagnification * Math.pow(2, -event.deltaY / 240), minimumZoom);
    setViewState(
      zoomAroundViewportPoint(
        currentState,
        relativeZoomAtMagnification(magnification, currentState.fitScaleCompensation),
        { x: event.clientX - rect.x, y: event.clientY - rect.y },
        viewportCenter(rect.width, rect.height)
      )
    );
  };

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    surface.addEventListener('wheel', onWheel, { passive: false });
    return () => surface.removeEventListener('wheel', onWheel);
  });

  return (
    <div
      ref={surfaceRef}
      aria-label={`${mode} view surface`}
      className={`${className ?? ''} ${dragging ? 'cursor-grabbing' : mode === 'zoom' ? 'cursor-zoom-in' : 'cursor-grab'}`}
      onDoubleClick={mode === 'hand' || mode === 'rotate-view' ? reset : undefined}
      onPointerCancel={finish}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      role="application"
      style={{ touchAction: 'none' }}
      tabIndex={0}
      data-testid={`${mode}-tool-area`}
      data-workspace-fit-scale={String(fitScale)}
    />
  );
}
