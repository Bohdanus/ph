import type { Point, Size } from './general-types.ts';
import { containFit } from '../util/contain-fit.ts';

export type ViewState = {
  panX: number;
  panY: number;
  zoom: number;
  /** Internal compensation for a document-frame contain-fit change. */
  fitScaleCompensation: number;
  rotation: number;
};

export const DEFAULT_VIEW_STATE: ViewState = {
  panX: 0,
  panY: 0,
  zoom: 1,
  fitScaleCompensation: 1,
  rotation: 0,
};
export const MIN_VIEW_ZOOM = 0.1;
export const MAX_VIEW_ZOOM = 16;

export const viewStateRef: { current: ViewState } = { current: DEFAULT_VIEW_STATE };

export function clampViewZoom(zoom: number): number {
  return Math.min(MAX_VIEW_ZOOM, Math.max(MIN_VIEW_ZOOM, zoom));
}

export function effectiveViewZoom(state: Pick<ViewState, 'zoom' | 'fitScaleCompensation'>): number {
  return state.zoom * state.fitScaleCompensation;
}

/**
 * Keep the displayed size of a document pixel stable when a crop changes the frame.
 * The workspace fits each frame into its viewport before applying view zoom, so
 * preserving the numeric zoom alone would make smaller crops appear enlarged.
 */
export function preserveViewScaleCompensationAcrossFrameChange(
  zoom: number,
  currentCompensation: number,
  viewport: Size,
  previousFrame: Size,
  nextFrame: Size
): number {
  if (
    ![
      zoom,
      currentCompensation,
      viewport.width,
      viewport.height,
      previousFrame.width,
      previousFrame.height,
      nextFrame.width,
      nextFrame.height,
    ].every(Number.isFinite) ||
    viewport.width <= 0 ||
    viewport.height <= 0 ||
    zoom <= 0 ||
    currentCompensation <= 0 ||
    previousFrame.width <= 0 ||
    previousFrame.height <= 0 ||
    nextFrame.width <= 0 ||
    nextFrame.height <= 0
  ) {
    return Number.isFinite(currentCompensation) && currentCompensation > 0 ? currentCompensation : 1;
  }

  const previousFit = containFit(viewport, previousFrame).scale;
  const nextFit = containFit(viewport, nextFrame).scale;
  const nextEffectiveZoom = clampViewZoom((zoom * currentCompensation * previousFit) / nextFit);
  return nextEffectiveZoom / zoom;
}

export function viewportCenter(width: number, height: number): Point {
  return { x: width / 2, y: height / 2 };
}

export function inverseViewPoint(point: Point, state: ViewState, center: Point): Point {
  const translated = {
    x: (point.x - center.x - state.panX) / effectiveViewZoom(state),
    y: (point.y - center.y - state.panY) / effectiveViewZoom(state),
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
  const nextEffectiveZoom = nextZoom * state.fitScaleCompensation;
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
    panX: point.x - center.x - nextEffectiveZoom * rotated.x,
    panY: point.y - center.y - nextEffectiveZoom * rotated.y,
  };
}
