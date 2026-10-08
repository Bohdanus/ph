import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useStore } from '../../contexts/StoreContext.tsx';
import {
  clampViewZoom,
  DEFAULT_VIEW_STATE,
  viewportCenter,
  zoomAroundViewportPoint,
  type ViewState,
} from '../../contexts/view-state.ts';

export type ViewToolMode = 'hand' | 'zoom' | 'rotate-view';

type ViewGesture = {
  pointerId: number;
  startX: number;
  startY: number;
  startState: ViewState;
  anchor: { x: number; y: number };
  alternate: boolean;
};

export function ViewToolArea({ className, mode }: { className?: string; mode: ViewToolMode }) {
  const [{ containerRef, viewStateRef, setViewState }] = useStore();
  const gestureRef = useRef<ViewGesture | null>(null);
  const [dragging, setDragging] = useState(false);

  const viewportPoint = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = containerRef.current?.getBoundingClientRect();
    return rect ? { x: event.clientX - rect.left, y: event.clientY - rect.top } : { x: 0, y: 0 };
  };

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
    const anchor = viewportPoint(event);
    gestureRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startState: { ...viewStateRef.current },
      anchor,
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
    const zoom = clampViewZoom(gesture.startState.zoom * (gesture.alternate ? 1 / factor : factor));
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setViewState(
      zoomAroundViewportPoint(gesture.startState, zoom, gesture.anchor, viewportCenter(rect.width, rect.height))
    );
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (mode === 'zoom' && Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) < 4) {
      const rect = containerRef.current?.getBoundingClientRect();
      if (rect) {
        const factor = gesture.alternate ? 0.8 : 1.25;
        setViewState(
          zoomAroundViewportPoint(
            gesture.startState,
            gesture.startState.zoom * factor,
            gesture.anchor,
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
