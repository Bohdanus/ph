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

function ViewButtons({ fitScale, devicePixelRatio }: { fitScale: number; devicePixelRatio: number }) {
  const [{ setViewState }] = useStore();
  return (
    <div className="flex items-center gap-1">
      <button type="button" onClick={() => setViewState(DEFAULT_VIEW_STATE)}>
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
  const fitScale = useWorkspaceFitScale();
  const devicePixelRatio = useDevicePixelRatio();
  return <ViewButtons devicePixelRatio={devicePixelRatio} fitScale={fitScale} />;
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
  return (
    <div className="flex items-center gap-1">
      <label htmlFor="view-rotation-slider">Rotation {Math.round(rotation)}°</label>
      <input
        id="view-rotation-slider"
        type="range"
        min={-180}
        max={180}
        value={rotation}
        onChange={(event) => setViewState({ rotation: Number(event.target.value) })}
      />
      <button type="button" onClick={() => setViewState({ rotation: 0 })}>
        Reset View
      </button>
    </div>
  );
}
