import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useStore } from '../../contexts/StoreContext.tsx';
import {
  absoluteViewZoom,
  clampAbsoluteViewZoom,
  DEFAULT_VIEW_STATE,
  relativeViewZoomForMagnification,
  viewportCenter,
  zoomAroundViewportPoint,
  type ViewState,
} from '../../contexts/view-state.ts';
import { useDevicePixelRatio } from '../../hooks/useDevicePixelRatio.ts';
import { useWorkspaceFitScale } from '../../hooks/useWorkspaceFitScale.ts';

export type ViewToolMode = 'hand' | 'zoom' | 'rotate-view';

type ViewGesture = {
  pointerId: number;
  startX: number;
  startY: number;
  startState: ViewState;
  startMagnification: number;
  alternate: boolean;
};

export function ViewToolArea({ className, mode }: { className?: string; mode: ViewToolMode }) {
  const [{ containerRef, viewStateRef, setViewState }] = useStore();
  const fitScale = useWorkspaceFitScale();
  const devicePixelRatio = useDevicePixelRatio();
  const gestureRef = useRef<ViewGesture | null>(null);
  const [dragging, setDragging] = useState(false);

  const relativeZoomAtMagnification = (magnification: number, compensation: number) =>
    relativeViewZoomForMagnification(magnification, fitScale, compensation, devicePixelRatio);

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
    gestureRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startState,
      startMagnification: clampAbsoluteViewZoom(absoluteViewZoom(startState, fitScale, devicePixelRatio)),
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
      setViewState({ rotation: gesture.startState.rotation + dx * 0.5 });
      return;
    }
    const factor = Math.pow(2, dx / 160);
    const currentState = viewStateRef.current;
    const startZoom = relativeZoomAtMagnification(gesture.startMagnification, currentState.fitScaleCompensation);
    const zoom = relativeZoomAtMagnification(
      clampAbsoluteViewZoom(gesture.startMagnification * (gesture.alternate ? 1 / factor : factor)),
      currentState.fitScaleCompensation
    );
    const rebasedStartState = {
      ...gesture.startState,
      zoom: startZoom,
      fitScaleCompensation: currentState.fitScaleCompensation,
    };
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setViewState(
      zoomAroundViewportPoint(
        rebasedStartState,
        zoom,
        { x: gesture.startX - rect.left, y: gesture.startY - rect.top },
        viewportCenter(rect.width, rect.height)
      )
    );
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (mode === 'zoom' && Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) < 4) {
      const rect = containerRef.current?.getBoundingClientRect();
      if (rect) {
        const factor = gesture.alternate ? 0.8 : 1.25;
        const currentState = viewStateRef.current;
        const rebasedStartState = {
          ...gesture.startState,
          zoom: relativeZoomAtMagnification(gesture.startMagnification, currentState.fitScaleCompensation),
          fitScaleCompensation: currentState.fitScaleCompensation,
        };
        setViewState(
          zoomAroundViewportPoint(
            rebasedStartState,
            relativeZoomAtMagnification(
              clampAbsoluteViewZoom(gesture.startMagnification * factor),
              currentState.fitScaleCompensation
            ),
            { x: gesture.startX - rect.left, y: gesture.startY - rect.top },
            viewportCenter(rect.width, rect.height)
          )
        );
      }
    }
    finish(event);
  };

  return (
    <div
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
    />
  );
}
