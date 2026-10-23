import type { Point, Size } from './general-types.ts';
import { containFit } from '../util/contain-fit.ts';

export type ViewState = {
  panX: number;
  panY: number;
  zoom: number;
  /** Internal compensation for a document-frame contain-fit change. */
  fitScaleCompensation: number;
  rotation: number;
  /** Whether the view follows contain-fit when the available workspace changes. */
  fitToScreen: boolean;
  /** Temporary slider floor carried from a Fit On Screen view below the one-pixel limit. */
  minimumZoomOverride?: number;
};

export const DEFAULT_VIEW_STATE: ViewState = {
  panX: 0,
  panY: 0,
  zoom: 1,
  fitScaleCompensation: 1,
  rotation: 0,
  fitToScreen: true,
};
/** Relative view transform limits. The displayed zoom percentage is fit-scale aware. */
export const MIN_VIEW_ZOOM = 1e-12;
export const MAX_VIEW_ZOOM = 1e12;
/** Used only when no document size is available. */
export const MIN_SLIDER_ZOOM = 0.1;
export const MAX_SLIDER_ZOOM = 32;
export const VIEW_ZOOM_SLIDER_STEPS = 1000;

/** Adobe documents a one-pixel zoom floor; this maps it to the shorter document edge. */
export function minimumSliderZoomForDocumentSize(size: Pick<Size, 'width' | 'height'> | null | undefined): number {
  const minimumDimension = Math.min(size?.width ?? 0, size?.height ?? 0);
  if (!Number.isFinite(minimumDimension) || minimumDimension <= 0) return MIN_SLIDER_ZOOM;
  return Math.min(MAX_SLIDER_ZOOM, 1 / Math.max(1, minimumDimension));
}

/** Keep an already-visible subpixel Fit scale representable until the user zooms back above the floor. */
export function minimumSliderZoomForCurrentView(
  size: Pick<Size, 'width' | 'height'> | null | undefined,
  magnification: number,
  minimumZoomOverride?: number
): number {
  const documentMinimum = minimumSliderZoomForDocumentSize(size);
  if (!Number.isFinite(magnification) || magnification <= 0) return documentMinimum;
  if (magnification >= documentMinimum) return documentMinimum;
  if (Number.isFinite(minimumZoomOverride) && minimumZoomOverride! > 0) {
    return Math.min(documentMinimum, minimumZoomOverride!);
  }
  return magnification;
}

/** Keep a fixed subpixel floor while zooming until the document's one-pixel floor is reached. */
export function minimumZoomOverrideForMagnification(
  size: Pick<Size, 'width' | 'height'> | null | undefined,
  magnification: number,
  gestureMinimum: number,
  previousOverride?: number
): number | undefined {
  const documentMinimum = minimumSliderZoomForDocumentSize(size);
  if (!Number.isFinite(magnification) || magnification >= documentMinimum) return undefined;
  if (Number.isFinite(previousOverride) && previousOverride! > 0) {
    return Math.min(documentMinimum, previousOverride!);
  }
  return Number.isFinite(gestureMinimum) && gestureMinimum > 0
    ? Math.min(documentMinimum, gestureMinimum)
    : magnification;
}

function boundedSliderMinimum(minimumZoom: number): number {
  const finiteMinimum = Number.isFinite(minimumZoom) ? minimumZoom : MIN_SLIDER_ZOOM;
  return Math.min(MAX_SLIDER_ZOOM, Math.max(MIN_VIEW_ZOOM, finiteMinimum));
}

export const viewStateRef: { current: ViewState } = { current: DEFAULT_VIEW_STATE };

export function clampViewZoom(zoom: number): number {
  return Math.min(MAX_VIEW_ZOOM, Math.max(MIN_VIEW_ZOOM, zoom));
}

/** Clamp the absolute document-pixel-to-monitor-pixel magnification used by the toolbar and Zoom Tool. */
export function clampAbsoluteViewZoom(magnification: number, minimumZoom = MIN_SLIDER_ZOOM): number {
  const finiteZoom = Number.isFinite(magnification) ? magnification : 1;
  const boundedMinimum = boundedSliderMinimum(minimumZoom);
  return Math.min(MAX_SLIDER_ZOOM, Math.max(boundedMinimum, finiteZoom));
}

/**
 * Map absolute image-pixels-per-monitor-pixel magnification to a logarithmic slider position.
 * Equal pointer travel then makes an equal proportional zoom change across the full range.
 */
export function viewZoomToSliderPosition(magnification: number, minimumZoom = MIN_SLIDER_ZOOM): number {
  const boundedMinimum = boundedSliderMinimum(minimumZoom);
  const boundedZoom = clampAbsoluteViewZoom(magnification, boundedMinimum);
  const progress = Math.log(boundedZoom / boundedMinimum) / Math.log(MAX_SLIDER_ZOOM / boundedMinimum);
  return Math.round(progress * VIEW_ZOOM_SLIDER_STEPS);
}

/** Convert one logarithmic slider position to absolute image-pixels-per-monitor-pixel magnification. */
export function sliderPositionToViewZoom(position: number, minimumZoom = MIN_SLIDER_ZOOM): number {
  const boundedMinimum = boundedSliderMinimum(minimumZoom);
  const boundedPosition = Math.min(
    VIEW_ZOOM_SLIDER_STEPS,
    Math.max(0, Number.isFinite(position) ? position : viewZoomToSliderPosition(1, boundedMinimum))
  );
  return boundedMinimum * Math.pow(MAX_SLIDER_ZOOM / boundedMinimum, boundedPosition / VIEW_ZOOM_SLIDER_STEPS);
}

/** Format the physical magnification as a percentage without rounding sub-1% zoom to zero. */
export function formatViewZoomPercent(magnification: number): string {
  const percentage = magnification * 100;
  return `${percentage >= 1 ? Math.round(percentage) : viewZoomPercentFormatter.format(percentage)}%`;
}

const viewZoomPercentFormatter = new Intl.NumberFormat('en-US', {
  maximumSignificantDigits: 4,
  useGrouping: false,
});

export function effectiveViewZoom(state: Pick<ViewState, 'zoom' | 'fitScaleCompensation'>): number {
  return state.zoom * state.fitScaleCompensation;
}

/** The displayed magnification: document pixels per monitor pixel after fit, view transform, and DPR. */
export function absoluteViewZoom(
  state: Pick<ViewState, 'zoom' | 'fitScaleCompensation'>,
  fitScale: number,
  devicePixelRatio = 1
): number {
  return effectiveViewZoom(state) * fitScale * devicePixelRatio;
}

/** Convert a toolbar magnification back to the view transform multiplier. */
export function relativeViewZoomForMagnification(
  magnification: number,
  fitScale: number,
  fitScaleCompensation = 1,
  devicePixelRatio = 1
): number {
  if (
    !Number.isFinite(magnification) ||
    magnification <= 0 ||
    !Number.isFinite(fitScale) ||
    fitScale <= 0 ||
    !Number.isFinite(fitScaleCompensation) ||
    fitScaleCompensation <= 0 ||
    !Number.isFinite(devicePixelRatio) ||
    devicePixelRatio <= 0
  ) {
    return 1;
  }
  return clampViewZoom(magnification / (fitScale * fitScaleCompensation * devicePixelRatio));
}

/** Preserve image pixels per physical display pixel as the workspace fit or display density changes. */
export function preserveViewScaleCompensationAcrossDisplayScaleChange(
  zoom: number,
  currentCompensation: number,
  previousFitScale: number,
  nextFitScale: number,
  previousDevicePixelRatio = 1,
  nextDevicePixelRatio = previousDevicePixelRatio
): number {
  if (
    ![zoom, currentCompensation, previousFitScale, nextFitScale, previousDevicePixelRatio, nextDevicePixelRatio].every(
      Number.isFinite
    ) ||
    zoom <= 0 ||
    currentCompensation <= 0 ||
    previousFitScale <= 0 ||
    nextFitScale <= 0 ||
    previousDevicePixelRatio <= 0 ||
    nextDevicePixelRatio <= 0
  ) {
    return Number.isFinite(currentCompensation) && currentCompensation > 0 ? currentCompensation : 1;
  }

  const nextEffectiveZoom = clampViewZoom(
    (zoom * currentCompensation * previousFitScale * previousDevicePixelRatio) / (nextFitScale * nextDevicePixelRatio)
  );
  return nextEffectiveZoom / zoom;
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
  nextFrame: Size,
  previousDevicePixelRatio = 1,
  nextDevicePixelRatio = previousDevicePixelRatio
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
      previousDevicePixelRatio,
      nextDevicePixelRatio,
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
  return preserveViewScaleCompensationAcrossDisplayScaleChange(
    zoom,
    currentCompensation,
    previousFit,
    nextFit,
    previousDevicePixelRatio,
    nextDevicePixelRatio
  );
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
    fitToScreen: false,
  };
}
