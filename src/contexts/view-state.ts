import type { Point } from './general-types.ts';

export type ViewState = {
  panX: number;
  panY: number;
  zoom: number;
  rotation: number;
};

export const DEFAULT_VIEW_STATE: ViewState = { panX: 0, panY: 0, zoom: 1, rotation: 0 };
export const MIN_VIEW_ZOOM = 0.1;
export const MAX_VIEW_ZOOM = 16;

export const viewStateRef: { current: ViewState } = { current: DEFAULT_VIEW_STATE };

export function clampViewZoom(zoom: number): number {
  return Math.min(MAX_VIEW_ZOOM, Math.max(MIN_VIEW_ZOOM, zoom));
}

export function viewportCenter(width: number, height: number): Point {
  return { x: width / 2, y: height / 2 };
}

export function inverseViewPoint(point: Point, state: ViewState, center: Point): Point {
  const translated = {
    x: (point.x - center.x - state.panX) / state.zoom,
    y: (point.y - center.y - state.panY) / state.zoom,
  };
  const angle = (-state.rotation * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: center.x + translated.x * cos - translated.y * sin,
    y: center.y + translated.x * sin + translated.y * cos,
  };
}

export function zoomAroundViewportPoint(state: ViewState, zoom: number, point: Point, center: Point): ViewState {
  const nextZoom = clampViewZoom(zoom);
  const documentPoint = inverseViewPoint(point, state, center);
  const angle = (state.rotation * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const relative = { x: documentPoint.x - center.x, y: documentPoint.y - center.y };
  const rotated = {
    x: relative.x * cos - relative.y * sin,
    y: relative.x * sin + relative.y * cos,
  };
  return {
    ...state,
    zoom: nextZoom,
    panX: point.x - center.x - nextZoom * rotated.x,
    panY: point.y - center.y - nextZoom * rotated.y,
  };
}
