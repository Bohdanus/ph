import { type PointerEvent as ReactPointerEvent, useRef, useState } from 'react';
import { useStore } from '../../../contexts/StoreContext.tsx';
import {
  absoluteViewZoom,
  DEFAULT_VIEW_STATE,
  formatViewZoomPercent,
  minimumSliderZoomForCurrentView,
  minimumZoomOverrideForMagnification,
  VIEW_ZOOM_SLIDER_STEPS,
  relativeViewZoomForMagnification,
  sliderPositionToViewZoom,
  viewZoomToSliderPosition,
} from '../../../contexts/view-state.ts';
import { useDevicePixelRatio } from '../../../hooks/useDevicePixelRatio.ts';
import { useWorkspaceFitScale } from '../../../hooks/useWorkspaceFitScale.ts';

function ViewButtons({
  fitScale,
  devicePixelRatio,
  testIdPrefix,
}: {
  fitScale: number;
  devicePixelRatio: number;
  testIdPrefix?: string;
}) {
  const [{ setViewState }] = useStore();
  return (
    <div className="flex items-center gap-1">
      <button
        data-testid={testIdPrefix ? `${testIdPrefix}-fit-on-screen` : undefined}
        type="button"
        onClick={() => setViewState(DEFAULT_VIEW_STATE)}
      >
        Fit On Screen
      </button>
      <button
        type="button"
        onClick={() =>
          setViewState({
            panX: 0,
            panY: 0,
            zoom: relativeViewZoomForMagnification(1, fitScale, 1, devicePixelRatio),
            fitScaleCompensation: 1,
            rotation: 0,
            minimumZoomOverride: undefined,
          })
        }
      >
        100%
      </button>
    </div>
  );
}

export function Hand() {
  const [{ viewState, setViewState, documentFrame }] = useStore();
  const fitScale = useWorkspaceFitScale();
  const devicePixelRatio = useDevicePixelRatio();
  const state = viewState ?? DEFAULT_VIEW_STATE;
  const magnification = absoluteViewZoom(state, fitScale, devicePixelRatio);
  const minimumZoom = minimumSliderZoomForCurrentView(documentFrame, magnification, state.minimumZoomOverride);
  const step = (factor: number) => {
    const next = Math.min(32, Math.max(minimumZoom, magnification * factor));
    setViewState({
      zoom: relativeViewZoomForMagnification(next, fitScale, state.fitScaleCompensation, devicePixelRatio),
      minimumZoomOverride: minimumZoomOverrideForMagnification(
        documentFrame,
        next,
        minimumZoom,
        state.minimumZoomOverride
      ),
    });
  };

  return (
    <div className="flex items-center gap-2">
      <span data-testid="hand-zoom-level">{formatViewZoomPercent(magnification)}</span>
      <button data-testid="hand-zoom-out" type="button" onClick={() => step(0.8)}>
        −
      </button>
      <button data-testid="hand-zoom-in" type="button" onClick={() => step(1.25)}>
        +
      </button>
      <ViewButtons devicePixelRatio={devicePixelRatio} fitScale={fitScale} testIdPrefix="hand" />
    </div>
  );
}

export function Zoom() {
  const [{ viewState, setViewState, documentFrame }] = useStore();
  const fitScale = useWorkspaceFitScale();
  const devicePixelRatio = useDevicePixelRatio();
  const state = viewState ?? DEFAULT_VIEW_STATE;
  const zoom = absoluteViewZoom(state, fitScale, devicePixelRatio);
  const minimumZoom = minimumSliderZoomForCurrentView(documentFrame, zoom, state.minimumZoomOverride);
  const [interactionMinimumZoom, setInteractionMinimumZoom] = useState<number | null>(null);
  const sliderPointerIdRef = useRef<number | null>(null);
  const activeMinimumZoom = interactionMinimumZoom ?? minimumZoom;

  const beginSliderInteraction = () => setInteractionMinimumZoom((current) => current ?? minimumZoom);
  const endSliderInteraction = () => setInteractionMinimumZoom(null);
  const beginPointerInteraction = (event: ReactPointerEvent<HTMLInputElement>) => {
    if (sliderPointerIdRef.current !== null && sliderPointerIdRef.current !== event.pointerId) {
      event.preventDefault();
      return;
    }
    sliderPointerIdRef.current = event.pointerId;
    // Range inputs have optional implicit capture. Pin the owner explicitly so
    // dragging off the control cannot strand the frozen zoom floor after blur.
    event.currentTarget.setPointerCapture?.(event.pointerId);
    beginSliderInteraction();
  };
  const endPointerInteraction = (event: ReactPointerEvent<HTMLInputElement>) => {
    if (sliderPointerIdRef.current !== event.pointerId) return;
    sliderPointerIdRef.current = null;
    endSliderInteraction();
  };
  const beginKeyboardInteraction = () => {
    if (sliderPointerIdRef.current === null) beginSliderInteraction();
  };
  const endKeyboardInteraction = () => {
    if (sliderPointerIdRef.current === null) endSliderInteraction();
  };
  const endBlurInteraction = () => {
    // Blur carries no pointer identity. Keep the frozen zoom floor until the
    // pointer that started the interaction ends it.
    if (sliderPointerIdRef.current !== null) return;
    endSliderInteraction();
  };

  return (
    <div className="flex items-center gap-2">
      <label className="w-24 shrink-0 whitespace-nowrap text-right tabular-nums" htmlFor="view-zoom-slider">
        Zoom {formatViewZoomPercent(zoom)}
      </label>
      <input
        className="w-80 shrink-0"
        id="view-zoom-slider"
        type="range"
        min={0}
        max={VIEW_ZOOM_SLIDER_STEPS}
        step={1}
        value={viewZoomToSliderPosition(zoom, activeMinimumZoom)}
        onPointerDown={beginPointerInteraction}
        onPointerUp={endPointerInteraction}
        onPointerCancel={endPointerInteraction}
        onLostPointerCapture={endPointerInteraction}
        onKeyDown={beginKeyboardInteraction}
        onKeyUp={endKeyboardInteraction}
        onBlur={endBlurInteraction}
        onChange={(event) => {
          const magnification = sliderPositionToViewZoom(Number(event.currentTarget.value), activeMinimumZoom);
          setViewState({
            zoom: relativeViewZoomForMagnification(
              magnification,
              fitScale,
              state.fitScaleCompensation,
              devicePixelRatio
            ),
            minimumZoomOverride: minimumZoomOverrideForMagnification(
              documentFrame,
              magnification,
              activeMinimumZoom,
              state.minimumZoomOverride
            ),
          });
        }}
      />
      <ViewButtons devicePixelRatio={devicePixelRatio} fitScale={fitScale} />
    </div>
  );
}

export function RotateView() {
  const [{ viewState, setViewState }] = useStore();
  const rotation = (viewState ?? DEFAULT_VIEW_STATE).rotation;
  const normalizeRotation = (degrees: number) => {
    if (!Number.isFinite(degrees)) return 0;
    const wrapped = ((((degrees + 180) % 360) + 360) % 360) - 180;
    return wrapped === -180 ? 180 : wrapped;
  };
  return (
    <div className="flex items-center gap-1">
      <label htmlFor="view-rotation-slider">Rotation {Math.round(rotation)}°</label>
      <input
        data-testid="rotate-view-angle"
        id="view-rotation-slider"
        type="number"
        min={-180}
        max={180}
        step="any"
        value={rotation}
        onChange={(event) => setViewState({ rotation: normalizeRotation(Number(event.target.value)) })}
      />
      <button data-testid="rotate-view-reset" type="button" onClick={() => setViewState({ rotation: 0 })}>
        Reset View
      </button>
    </div>
  );
}
