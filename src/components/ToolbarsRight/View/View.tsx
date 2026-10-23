import { useStore } from '../../../contexts/StoreContext.tsx';
import { DEFAULT_VIEW_STATE, MAX_VIEW_ZOOM, MIN_VIEW_ZOOM } from '../../../contexts/view-state.ts';

function ViewButtons() {
  const [{ setViewState }] = useStore();
  return (
    <div className="flex items-center gap-1">
      <button type="button" onClick={() => setViewState(DEFAULT_VIEW_STATE)}>
        Fit On Screen
      </button>
      <button
        type="button"
        onClick={() => setViewState({ panX: 0, panY: 0, zoom: 1, fitScaleCompensation: 1, rotation: 0 })}
      >
        100%
      </button>
    </div>
  );
}

export function Hand() {
  return <ViewButtons />;
}

export function Zoom() {
  const [{ viewState, setViewState }] = useStore();
  const zoom = (viewState ?? DEFAULT_VIEW_STATE).zoom;
  return (
    <div className="flex items-center gap-1">
      <label htmlFor="view-zoom-slider">Zoom {Math.round(zoom * 100)}%</label>
      <input
        id="view-zoom-slider"
        type="range"
        min={MIN_VIEW_ZOOM}
        max={MAX_VIEW_ZOOM}
        step={0.1}
        value={zoom}
        onChange={(event) => setViewState({ zoom: Number(event.target.value) })}
      />
      <ViewButtons />
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
