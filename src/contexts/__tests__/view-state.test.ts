import { describe, expect, it } from 'vitest';
import {
  absoluteViewZoom,
  clampAbsoluteViewZoom,
  DEFAULT_VIEW_STATE,
  formatViewZoomPercent,
  MAX_VIEW_ZOOM,
  MIN_VIEW_ZOOM,
  MAX_SLIDER_ZOOM,
  MIN_SLIDER_ZOOM,
  minimumSliderZoomForDocumentSize,
  VIEW_ZOOM_SLIDER_STEPS,
  inverseViewPoint,
  preserveViewScaleCompensationAcrossDisplayScaleChange,
  preserveViewScaleCompensationAcrossFrameChange,
  relativeViewZoomForMagnification,
  sliderPositionToViewZoom,
  viewportCenter,
  viewZoomToSliderPosition,
  zoomAroundViewportPoint,
} from '../view-state.ts';

describe('view state transforms', () => {
  it('maps the slider endpoints to the supported zoom range', () => {
    expect(viewZoomToSliderPosition(MIN_SLIDER_ZOOM)).toBe(0);
    expect(viewZoomToSliderPosition(MAX_SLIDER_ZOOM)).toBe(VIEW_ZOOM_SLIDER_STEPS);
    expect(sliderPositionToViewZoom(0)).toBe(MIN_SLIDER_ZOOM);
    expect(sliderPositionToViewZoom(VIEW_ZOOM_SLIDER_STEPS)).toBe(MAX_SLIDER_ZOOM);
    expect(sliderPositionToViewZoom(-1)).toBe(MIN_SLIDER_ZOOM);
    expect(sliderPositionToViewZoom(VIEW_ZOOM_SLIDER_STEPS + 1)).toBe(MAX_SLIDER_ZOOM);
    expect(sliderPositionToViewZoom(Number.NaN)).toBeCloseTo(1);
  });

  it('sets the slider floor where the shorter document edge reaches one physical pixel', () => {
    const minimumZoom = minimumSliderZoomForDocumentSize({ width: 1200, height: 600 });
    expect(minimumZoom).toBeCloseTo(1 / 600);
    expect(viewZoomToSliderPosition(minimumZoom, minimumZoom)).toBe(0);
    expect(sliderPositionToViewZoom(0, minimumZoom)).toBeCloseTo(minimumZoom);
    expect(clampAbsoluteViewZoom(minimumZoom / 2, minimumZoom)).toBeCloseTo(minimumZoom);
    expect(sliderPositionToViewZoom(VIEW_ZOOM_SLIDER_STEPS, minimumZoom)).toBe(MAX_SLIDER_ZOOM);
  });

  it('uses the fallback range without a document and keeps tiny zoom labels visible', () => {
    expect(minimumSliderZoomForDocumentSize({ width: 0, height: 0 })).toBe(MIN_SLIDER_ZOOM);
    expect(formatViewZoomPercent(1 / 600)).toBe('0.1667%');
    expect(formatViewZoomPercent(0.99)).toBe('99%');
    expect(formatViewZoomPercent(1)).toBe('100%');
    expect(formatViewZoomPercent(MAX_SLIDER_ZOOM)).toBe('3200%');
  });

  it.each([0.25, 0.99, 1, 1.01, 2, 8])('preserves useful precision around %s magnification', (zoom) => {
    const position = viewZoomToSliderPosition(zoom);
    expect(Math.abs(sliderPositionToViewZoom(position) / zoom - 1)).toBeLessThan(0.005);
  });

  it('keeps slider positions immediately around 100% on opposite sides of 1x', () => {
    const atOne = viewZoomToSliderPosition(1);
    expect(sliderPositionToViewZoom(atOne - 1)).toBeLessThan(1);
    expect(sliderPositionToViewZoom(atOne + 1)).toBeGreaterThan(1);
  });

  it('converts between absolute magnification and the fit-relative view transform', () => {
    expect(absoluteViewZoom({ zoom: 2, fitScaleCompensation: 0.5 }, 0.4)).toBeCloseTo(0.4);
    expect(relativeViewZoomForMagnification(1, 0.4)).toBeCloseTo(2.5);
    expect(relativeViewZoomForMagnification(2, 0.4, 0.5)).toBeCloseTo(10);
    expect(absoluteViewZoom({ zoom: 0.5, fitScaleCompensation: 1 }, 1, 2)).toBeCloseTo(1);
    expect(relativeViewZoomForMagnification(1, 0.5, 1, 2)).toBeCloseTo(1);
  });

  it('uses the toolbar magnification bounds for both the slider and view gestures', () => {
    expect(clampAbsoluteViewZoom(0)).toBe(MIN_SLIDER_ZOOM);
    expect(clampAbsoluteViewZoom(99)).toBe(MAX_SLIDER_ZOOM);
    expect(clampAbsoluteViewZoom(Number.NaN)).toBe(1);
  });

  it('round-trips a viewport point through a rotated and panned view', () => {
    const state = { panX: 18, panY: -11, zoom: 1.8, fitScaleCompensation: 1, rotation: 32, fitToScreen: false };
    const center = viewportCenter(800, 600);
    const source = { x: 173, y: 411 };
    const angle = (state.rotation * Math.PI) / 180;
    const relative = { x: source.x - center.x, y: source.y - center.y };
    const transformed = {
      x:
        center.x +
        state.panX +
        state.zoom * state.fitScaleCompensation * (relative.x * Math.cos(angle) - relative.y * Math.sin(angle)),
      y:
        center.y +
        state.panY +
        state.zoom * state.fitScaleCompensation * (relative.x * Math.sin(angle) + relative.y * Math.cos(angle)),
    };

    expect(inverseViewPoint(transformed, state, center)).toEqual({
      x: expect.closeTo(source.x, 8),
      y: expect.closeTo(source.y, 8),
    });
  });

  it('keeps the pointer anchor fixed when zoom changes', () => {
    const state = { ...DEFAULT_VIEW_STATE, panX: 21, panY: -9, rotation: -18, zoom: 1.2, fitScaleCompensation: 0.75 };
    const center = viewportCenter(900, 700);
    const anchor = { x: 244, y: 318 };
    const next = zoomAroundViewportPoint(state, 2.4, anchor, center);

    expect(inverseViewPoint(anchor, next, center)).toEqual({
      x: expect.closeTo(inverseViewPoint(anchor, state, center).x, 8),
      y: expect.closeTo(inverseViewPoint(anchor, state, center).y, 8),
    });
    expect(next.zoom).toBe(2.4);
    expect(next.fitToScreen).toBe(false);
  });

  it('starts in Fit on Screen mode and exits it when zoom is applied', () => {
    expect(DEFAULT_VIEW_STATE.fitToScreen).toBe(true);
    expect(
      zoomAroundViewportPoint(DEFAULT_VIEW_STATE, 1.25, { x: 100, y: 80 }, viewportCenter(400, 300)).fitToScreen
    ).toBe(false);
  });

  it('clamps zoom to the supported presentation range', () => {
    const center = viewportCenter(100, 100);
    expect(zoomAroundViewportPoint(DEFAULT_VIEW_STATE, 0, { x: 50, y: 50 }, center).zoom).toBe(MIN_VIEW_ZOOM);
    expect(zoomAroundViewportPoint(DEFAULT_VIEW_STATE, Number.POSITIVE_INFINITY, { x: 50, y: 50 }, center).zoom).toBe(
      MAX_VIEW_ZOOM
    );
  });

  it('preserves effective pixel scale when a frame shrinks or grows', () => {
    const viewport = { width: 800, height: 600 };
    const previousFrame = { width: 400, height: 300 };
    const shrunkFrame = { width: 200, height: 150 };
    const grownFrame = { width: 800, height: 600 };

    const afterShrink = preserveViewScaleCompensationAcrossFrameChange(1.25, 1, viewport, previousFrame, shrunkFrame);
    expect(afterShrink).toBe(0.5);
    expect((800 / previousFrame.width) * 1.25).toBe((800 / shrunkFrame.width) * 1.25 * afterShrink);

    const afterGrowth = preserveViewScaleCompensationAcrossFrameChange(1.25, 1, viewport, previousFrame, grownFrame);
    expect(afterGrowth).toBe(2);
    expect((800 / previousFrame.width) * 1.25).toBe((800 / grownFrame.width) * 1.25 * afterGrowth);
  });

  it('preserves physical pixel magnification when the workspace fit or display density changes', () => {
    const afterResize = preserveViewScaleCompensationAcrossDisplayScaleChange(1.25, 1, 0.8, 0.4, 2, 2);
    expect(1.25 * afterResize * 0.4 * 2).toBeCloseTo(1.25 * 0.8 * 2);

    const afterDprChange = preserveViewScaleCompensationAcrossDisplayScaleChange(1, 1, 0.8, 0.8, 1, 2);
    expect(1 * afterDprChange * 0.8 * 2).toBeCloseTo(1 * 1 * 0.8 * 1);
  });

  it('keeps zoom within the supported range when the frame change exceeds it', () => {
    expect(
      preserveViewScaleCompensationAcrossFrameChange(
        1,
        1,
        { width: 800, height: 600 },
        { width: 400, height: 300 },
        { width: 1000000000000000, height: 750000000000000 }
      )
    ).toBe(MAX_VIEW_ZOOM);
  });

  it('preserves the existing compensation when frame geometry is invalid', () => {
    expect(
      preserveViewScaleCompensationAcrossFrameChange(
        1.25,
        0.5,
        { width: 800, height: 600 },
        { width: 400, height: 300 },
        { width: 0, height: 0 }
      )
    ).toBe(0.5);
  });
});
