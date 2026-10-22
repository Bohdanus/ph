import { describe, expect, it } from 'vitest';
import {
  DEFAULT_VIEW_STATE,
  inverseViewPoint,
  preserveViewScaleCompensationAcrossFrameChange,
  viewportCenter,
  zoomAroundViewportPoint,
} from '../view-state.ts';

describe('view state transforms', () => {
  it('round-trips a viewport point through a rotated and panned view', () => {
    const state = { panX: 18, panY: -11, zoom: 1.8, fitScaleCompensation: 1, rotation: 32 };
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
  });

  it('clamps zoom to the supported presentation range', () => {
    const center = viewportCenter(100, 100);
    expect(zoomAroundViewportPoint(DEFAULT_VIEW_STATE, 0, { x: 50, y: 50 }, center).zoom).toBe(0.1);
    expect(zoomAroundViewportPoint(DEFAULT_VIEW_STATE, 99, { x: 50, y: 50 }, center).zoom).toBe(16);
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

  it('keeps zoom within the supported range when the frame change exceeds it', () => {
    expect(
      preserveViewScaleCompensationAcrossFrameChange(
        1,
        1,
        { width: 800, height: 600 },
        { width: 400, height: 300 },
        { width: 40000, height: 30000 }
      )
    ).toBe(16);
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
