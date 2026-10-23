import { useState } from 'react';
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
  const activeMinimumZoom = interactionMinimumZoom ?? minimumZoom;

  const beginSliderInteraction = () => setInteractionMinimumZoom((current) => current ?? minimumZoom);
  const endSliderInteraction = () => setInteractionMinimumZoom(null);

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
        onPointerDown={beginSliderInteraction}
        onPointerUp={endSliderInteraction}
        onPointerCancel={endSliderInteraction}
        onKeyDown={beginSliderInteraction}
        onKeyUp={endSliderInteraction}
        onBlur={endSliderInteraction}
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
