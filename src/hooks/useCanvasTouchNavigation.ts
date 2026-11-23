import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { useStore } from '../contexts/StoreContext.tsx';
import {
  absoluteViewZoom,
  clampAbsoluteViewZoom,
  minimumSliderZoomForCurrentView,
  minimumZoomOverrideForMagnification,
  relativeViewZoomForMagnification,
  viewportCenter,
  zoomAroundViewportPoint,
  type ViewState,
} from '../contexts/view-state.ts';
import { useDevicePixelRatio } from './useDevicePixelRatio.ts';
import { useWorkspaceFitScale } from './useWorkspaceFitScale.ts';
import { readClientViewportRect } from '../util/client-viewport.ts';

type TouchPoint = {
  pointerId: number;
  clientX: number;
  clientY: number;
  target: EventTarget;
};

type PinchBaseline = {
  viewState: ViewState;
  center: { x: number; y: number };
  distance: number;
  magnification: number;
  minimumZoom: number;
  fitScale: number;
  devicePixelRatio: number;
  documentFrame: { x: number; y: number; width: number; height: number };
};

type PanBaseline = {
  pointerId: number;
  clientX: number;
  clientY: number;
  panX: number;
  panY: number;
};

type TouchGesture = {
  phase: 'idle' | 'pending' | 'pinch' | 'pan' | 'blocked';
  points: Map<number, TouchPoint>;
  pinchIds: [number, number] | null;
  pinch: PinchBaseline | null;
  pan: PanBaseline | null;
};

const IDLE_GESTURE: TouchGesture = {
  phase: 'idle',
  points: new Map(),
  pinchIds: null,
  pinch: null,
  pan: null,
};

function distance(a: TouchPoint, b: TouchPoint): number {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

function center(a: TouchPoint, b: TouchPoint) {
  return { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 };
}

function createPointerCancel(point: TouchPoint): Event {
  const init: PointerEventInit = {
    bubbles: true,
    cancelable: false,
    pointerId: point.pointerId,
    pointerType: 'touch',
    button: 0,
    buttons: 0,
    clientX: point.clientX,
    clientY: point.clientY,
  };

  if (typeof PointerEvent !== 'undefined') return new PointerEvent('pointercancel', init);

  // jsdom versions without PointerEvent still dispatch the same event name through React's
  // delegated pointer-event plugin. Define only the attributes the tool cancellation paths read.
  const event = new Event('pointercancel', { bubbles: true, cancelable: false });
  for (const [key, value] of Object.entries(init)) {
    Object.defineProperty(event, key, { configurable: true, value });
  }
  return event;
}

function isTextEntryTarget(target: EventTarget): boolean {
  if (!(target instanceof Element)) return false;
  return target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]') !== null;
}

/**
 * Adds Photoshop-style two-finger pan and pinch zoom to the tablet canvas while leaving
 * one-finger input with the selected tool. A second touch cancels the first tool's in-flight
 * pointer through its existing `pointercancel` contract before the canvas takes capture.
 */
export function useCanvasTouchNavigation() {
  const [{ containerRef, documentFrame, hasImage, setViewState, viewStateRef }] = useStore();
  const fitScale = useWorkspaceFitScale();
  const devicePixelRatio = useDevicePixelRatio();
  const gestureRef = useRef<TouchGesture>({ ...IDLE_GESTURE, points: new Map() });
  const terminatingPointerIdRef = useRef<number | null>(null);
  const captureRootRef = useRef<HTMLDivElement | null>(null);

  const releaseCaptures = (root: HTMLDivElement, pointerIds: Iterable<number>) => {
    for (const pointerId of pointerIds) {
      try {
        root.releasePointerCapture(pointerId);
      } catch {
        // Capture may already have been released by pointerup, cancellation, or browser cleanup.
      }
    }
  };

  const cancelToolPointer = (point: TouchPoint) => {
    terminatingPointerIdRef.current = point.pointerId;
    try {
      point.target.dispatchEvent(createPointerCancel(point));
    } finally {
      terminatingPointerIdRef.current = null;
    }
  };

  const capturePointers = (root: HTMLDivElement, points: Iterable<TouchPoint>): boolean => {
    const captured: number[] = [];
    try {
      for (const point of points) {
        root.setPointerCapture(point.pointerId);
        captured.push(point.pointerId);
        if (root.hasPointerCapture && !root.hasPointerCapture(point.pointerId)) {
          throw new Error(`Pointer capture was not set for ${point.pointerId}`);
        }
      }
      return true;
    } catch {
      releaseCaptures(root, captured);
      return false;
    }
  };

  const pointInViewport = (point: { x: number; y: number }) => {
    const viewport = containerRef.current ? readClientViewportRect(containerRef.current) : null;
    if (!viewport) return null;
    return { x: point.x - viewport.x, y: point.y - viewport.y };
  };

  const startPinch = (gesture: TouchGesture) => {
    const ids = [...gesture.points.keys()].slice(0, 2);
    if (ids.length !== 2) return;
    gesture.pinchIds = [ids[0], ids[1]];
    gesture.phase = 'pinch';
    gesture.pan = null;

    const first = gesture.points.get(ids[0])!;
    const second = gesture.points.get(ids[1])!;
    const startDistance = distance(first, second);
    if (startDistance < 1 || fitScale <= 0 || devicePixelRatio <= 0) {
      gesture.pinch = null;
      return;
    }

    const state = { ...viewStateRef.current };
    const magnification = absoluteViewZoom(state, fitScale, devicePixelRatio);
    gesture.pinch = {
      viewState: state,
      center: center(first, second),
      distance: startDistance,
      magnification,
      minimumZoom: minimumSliderZoomForCurrentView(documentFrame, magnification, state.minimumZoomOverride),
      fitScale,
      devicePixelRatio,
      documentFrame: { ...documentFrame },
    };
  };

  const initializeWaitingPinch = (gesture: TouchGesture) => {
    if (gesture.pinch || !gesture.pinchIds) return;
    const first = gesture.points.get(gesture.pinchIds[0]);
    const second = gesture.points.get(gesture.pinchIds[1]);
    if (!first || !second || distance(first, second) < 1) return;
    startPinch(gesture);
  };

  const updatePinch = (gesture: TouchGesture) => {
    if (!gesture.pinch || !gesture.pinchIds) {
      initializeWaitingPinch(gesture);
      return;
    }
    const first = gesture.points.get(gesture.pinchIds[0]);
    const second = gesture.points.get(gesture.pinchIds[1]);
    if (!first || !second) return;

    const currentCenter = center(first, second);
    const startCenter = pointInViewport(gesture.pinch.center);
    const nextCenter = pointInViewport(currentCenter);
    const viewport = containerRef.current ? readClientViewportRect(containerRef.current) : null;
    if (!startCenter || !nextCenter || !viewport) return;

    const baseline = gesture.pinch;
    const state = viewStateRef.current;
    const documentFrameChanged =
      baseline.documentFrame.x !== documentFrame.x ||
      baseline.documentFrame.y !== documentFrame.y ||
      baseline.documentFrame.width !== documentFrame.width ||
      baseline.documentFrame.height !== documentFrame.height;
    if (
      baseline.fitScale !== fitScale ||
      baseline.devicePixelRatio !== devicePixelRatio ||
      baseline.viewState.fitScaleCompensation !== state.fitScaleCompensation ||
      documentFrameChanged
    ) {
      // Rebase against the new display transform so a resize or display-density change does
      // not mix a pre-change zoom baseline with the current fit compensation.
      startPinch(gesture);
      return;
    }

    const magnification = clampAbsoluteViewZoom(
      baseline.magnification * (distance(first, second) / baseline.distance),
      baseline.minimumZoom
    );
    const zoom = relativeViewZoomForMagnification(
      magnification,
      fitScale,
      baseline.viewState.fitScaleCompensation,
      devicePixelRatio
    );
    const minimumZoomOverride = minimumZoomOverrideForMagnification(
      documentFrame,
      magnification,
      baseline.minimumZoom,
      baseline.viewState.minimumZoomOverride
    );
    const anchored = zoomAroundViewportPoint(
      { ...baseline.viewState, minimumZoomOverride },
      zoom,
      startCenter,
      viewportCenter(viewport.width, viewport.height)
    );

    setViewState({
      zoom: anchored.zoom,
      panX: anchored.panX + nextCenter.x - startCenter.x,
      panY: anchored.panY + nextCenter.y - startCenter.y,
      minimumZoomOverride: anchored.minimumZoomOverride,
    });
  };

  const onPointerDownCapture = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!hasImage || event.pointerType !== 'touch' || event.button !== 0 || isTextEntryTarget(event.target)) return;

    const gesture = gestureRef.current;
    if (gesture.phase === 'idle') gesture.phase = 'pending';
    if (gesture.points.has(event.pointerId)) return;

    const point: TouchPoint = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      target: event.target,
    };
    gesture.points.set(point.pointerId, point);

    if (gesture.phase === 'pending' && gesture.points.size === 1) return;

    event.preventDefault();
    event.stopPropagation();

    if (gesture.phase === 'pending' && gesture.points.size === 2) {
      const first = gesture.points.values().next().value as TouchPoint | undefined;
      const root = event.currentTarget;
      if (!first) return;
      cancelToolPointer(first);
      if (!capturePointers(root, gesture.points.values())) {
        gestureRef.current = { ...IDLE_GESTURE, points: new Map() };
        return;
      }
      captureRootRef.current = root;
      startPinch(gesture);
      return;
    }

    // A third touch intentionally suspends navigation until every contact is lifted; this avoids
    // changing which pair controls the canvas halfway through one gesture.
    gesture.phase = 'blocked';
    gesture.pinch = null;
    gesture.pan = null;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // The third pointer never reached a tool surface, so a failed capture cannot strand a tool.
    }
  };

  const onPointerMoveCapture = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current;
    const point = gesture.points.get(event.pointerId);
    if (!point) return;
    point.clientX = event.clientX;
    point.clientY = event.clientY;

    if (gesture.phase === 'pending') return;
    event.preventDefault();
    event.stopPropagation();

    if (gesture.phase === 'pinch') {
      updatePinch(gesture);
    } else if (gesture.phase === 'pan' && gesture.pan?.pointerId === event.pointerId) {
      const viewportDelta = pointInViewport({ x: event.clientX, y: event.clientY });
      const startPoint = pointInViewport({ x: gesture.pan.clientX, y: gesture.pan.clientY });
      if (!viewportDelta || !startPoint) return;
      setViewState({
        panX: gesture.pan.panX + viewportDelta.x - startPoint.x,
        panY: gesture.pan.panY + viewportDelta.y - startPoint.y,
      });
    }
  };

  const onPointerUpCapture = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current;
    if (!gesture.points.has(event.pointerId)) return;
    const point = gesture.points.get(event.pointerId)!;
    point.clientX = event.clientX;
    point.clientY = event.clientY;

    if (gesture.phase === 'pending') {
      gesture.points.delete(event.pointerId);
      if (gesture.points.size === 0) gestureRef.current = { ...IDLE_GESTURE, points: new Map() };
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    if (gesture.phase === 'pinch') updatePinch(gesture);
    gesture.points.delete(event.pointerId);
    releaseCaptures(event.currentTarget, [event.pointerId]);

    if (gesture.phase === 'pinch' && gesture.points.size === 1) {
      const remaining = gesture.points.values().next().value as TouchPoint;
      const state = viewStateRef.current;
      gesture.phase = 'pan';
      gesture.pinch = null;
      gesture.pan = {
        pointerId: remaining.pointerId,
        clientX: remaining.clientX,
        clientY: remaining.clientY,
        panX: state.panX,
        panY: state.panY,
      };
    } else if (gesture.points.size === 0) {
      gestureRef.current = { ...IDLE_GESTURE, points: new Map() };
      captureRootRef.current = null;
    }
  };

  const onPointerCancelCapture = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (terminatingPointerIdRef.current === event.pointerId) return;
    const gesture = gestureRef.current;
    if (!gesture.points.has(event.pointerId)) return;

    if (gesture.phase === 'pending') {
      gesture.points.delete(event.pointerId);
      if (gesture.points.size === 0) gestureRef.current = { ...IDLE_GESTURE, points: new Map() };
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    gesture.points.delete(event.pointerId);
    releaseCaptures(event.currentTarget, [event.pointerId]);
    gesture.phase = 'blocked';
    gesture.pinch = null;
    gesture.pan = null;
    if (gesture.points.size === 0) gestureRef.current = { ...IDLE_GESTURE, points: new Map() };
  };

  const onLostPointerCaptureCapture = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current;
    if (event.target !== event.currentTarget || !gesture.points.has(event.pointerId)) return;
    gesture.phase = 'blocked';
    gesture.pinch = null;
    gesture.pan = null;
  };

  useEffect(() => {
    const handleBlockedPointer = (event: globalThis.PointerEvent) => {
      const gesture = gestureRef.current;
      if (gesture.phase !== 'blocked' || !gesture.points.has(event.pointerId)) return;

      event.preventDefault();
      event.stopPropagation();
      if (event.type === 'pointermove') return;

      gesture.points.delete(event.pointerId);
      const root = captureRootRef.current;
      if (root) releaseCaptures(root, [event.pointerId]);
      if (gesture.points.size === 0) {
        gestureRef.current = { ...IDLE_GESTURE, points: new Map() };
        captureRootRef.current = null;
      }
    };
    const clearOnBlur = () => {
      const gesture = gestureRef.current;
      const root = captureRootRef.current;
      if (root) releaseCaptures(root, gesture.points.keys());
      captureRootRef.current = null;
      gestureRef.current = { ...IDLE_GESTURE, points: new Map() };
    };

    // Pointer capture can be lost when the browser takes over a touch stream. Once the gesture
    // is blocked, document capture still observes its terminal events even if hit-testing moved
    // the pointer outside the canvas surface.
    document.addEventListener('pointermove', handleBlockedPointer, true);
    document.addEventListener('pointerup', handleBlockedPointer, true);
    document.addEventListener('pointercancel', handleBlockedPointer, true);
    window.addEventListener('blur', clearOnBlur);
    return () => {
      document.removeEventListener('pointermove', handleBlockedPointer, true);
      document.removeEventListener('pointerup', handleBlockedPointer, true);
      document.removeEventListener('pointercancel', handleBlockedPointer, true);
      window.removeEventListener('blur', clearOnBlur);
      clearOnBlur();
    };
  }, []);

  return {
    onPointerDownCapture,
    onPointerMoveCapture,
    onPointerUpCapture,
    onPointerCancelCapture,
    onLostPointerCaptureCapture,
  };
}
