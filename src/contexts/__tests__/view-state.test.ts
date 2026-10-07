import { describe, expect, it } from 'vitest';
import { DEFAULT_VIEW_STATE, inverseViewPoint, viewportCenter, zoomAroundViewportPoint } from '../view-state.ts';

describe('view state transforms', () => {
  it('round-trips a viewport point through a rotated and panned view', () => {
    const state = { panX: 18, panY: -11, zoom: 1.8, rotation: 32 };
    const center = viewportCenter(800, 600);
    const source = { x: 173, y: 411 };
    const angle = (state.rotation * Math.PI) / 180;
    const relative = { x: source.x - center.x, y: source.y - center.y };
    const transformed = {
      x: center.x + state.panX + state.zoom * (relative.x * Math.cos(angle) - relative.y * Math.sin(angle)),
      y: center.y + state.panY + state.zoom * (relative.x * Math.sin(angle) + relative.y * Math.cos(angle)),
    };

    expect(inverseViewPoint(transformed, state, center)).toEqual({
      x: expect.closeTo(source.x, 8),
      y: expect.closeTo(source.y, 8),
    });
  });

  it('keeps the pointer anchor fixed when zoom changes', () => {
    const state = { ...DEFAULT_VIEW_STATE, panX: 21, panY: -9, rotation: -18, zoom: 1.2 };
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
});
