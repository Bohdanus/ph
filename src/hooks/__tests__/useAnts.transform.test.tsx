import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AffineTransform } from '../../contexts/affine-transform.ts';
import { DASH_LENGTH, LINE_WIDTH, SPEED, useMarchingAnts } from '../useAnts.ts';
import { createMockLayer } from '@/__tests__/fixtures/layer.ts';
import { createMockCanvasContext } from '../../test/setup.ts';

/**
 * Transformed-layer coverage for `useMarchingAnts`.
 *
 * `useAnts.test.tsx` is a protected gold file that pins the untransformed
 * `strokeRect` path; this file covers the other half of `draw()`: a layer with
 * a live affine operation, which is stroked as a closed `Path2D` whose bounds
 * are the axis-aligned hull of the transformed corners.
 */

function createRafMocks() {
  const frames = new Map<number, FrameRequestCallback>();
  let nextId = 0;

  return {
    requestAnimationFrame: vi.fn((callback: FrameRequestCallback) => {
      const id = nextId++;
      frames.set(id, callback);
      return id;
    }),
    cancelAnimationFrame: vi.fn((id: number) => {
      frames.delete(id);
    }),
    frames,
  };
}

function withTransform(transform: AffineTransform, enabled = true) {
  return createMockLayer({
    pos: { x: 0, y: 0, width: 100, height: 100 },
    operations: [{ id: 'op-1', kind: 'affine-transform', transform, enabled }],
  });
}

describe('useMarchingAnts transformed layers', () => {
  let rafMocks: ReturnType<typeof createRafMocks>;
  let origRaf: typeof requestAnimationFrame;
  let origCancel: typeof cancelAnimationFrame;

  beforeEach(() => {
    origRaf = globalThis.requestAnimationFrame;
    origCancel = globalThis.cancelAnimationFrame;
    rafMocks = createRafMocks();
    globalThis.requestAnimationFrame = rafMocks.requestAnimationFrame;
    globalThis.cancelAnimationFrame = rafMocks.cancelAnimationFrame;
  });

  afterEach(() => {
    globalThis.requestAnimationFrame = origRaf;
    globalThis.cancelAnimationFrame = origCancel;
    // NOTE: `vi.restoreAllMocks()` must not run before RTL unmounts the hook --
    // the hook's unmount cleanup calls `canvas.getContext('2d')`, and with the
    // prototype stub from `src/test/setup.ts` already restored that reaches
    // jsdom's unimplemented canvas context. The setup file re-installs its stub
    // on every `beforeEach`, so nothing leaks between tests.
  });

  function frame() {
    const pending = [...rafMocks.frames.values()];
    rafMocks.frames.clear();
    act(() => pending.forEach((callback) => callback(0)));
  }

  function setup() {
    const canvas = document.createElement('canvas');
    const ctx = createMockCanvasContext(canvas);
    vi.spyOn(canvas, 'getContext').mockReturnValue(ctx);
    const container = document.createElement('div');
    const hook = renderHook(() =>
      useMarchingAnts({ overlayRef: { current: canvas }, containerRef: { current: container } })
    );
    return { ...hook, ctx, container };
  }

  it('strokes a closed path through the transformed corners instead of the layer rect', () => {
    const { result, ctx, container } = setup();
    // Translate by (10, -5): every corner shifts, nothing rotates.
    const layer = withTransform({ a: 1, b: 0, c: 0, d: 1, e: 10, f: -5 });

    act(() => result.current.draw(layer));
    frame();

    const path = vi.mocked(ctx.stroke).mock.calls.at(-1)![0] as Path2D;
    expect(ctx.strokeRect).not.toHaveBeenCalled();
    expect(path.moveTo).toHaveBeenCalledWith(10, -5);
    expect(path.lineTo).toHaveBeenCalledWith(110, -5);
    expect(path.lineTo).toHaveBeenCalledWith(110, 95);
    expect(path.lineTo).toHaveBeenCalledWith(10, 95);
    expect(path.closePath).toHaveBeenCalledOnce();
    expect(container.classList.contains('cursor-grab')).toBe(true);
  });

  it('erases the axis-aligned hull of a mirrored layer', () => {
    const { result, ctx } = setup();
    // Mirror horizontally around the 100px-wide layer: x runs 0..100 -> -100..0.
    const layer = withTransform({ a: -1, b: 0, c: 0, d: 1, e: 0, f: 0 });

    act(() => result.current.draw(layer));
    frame();
    // The first frame paints, the second erases the previous hull.
    frame();

    expect(ctx.clearRect).toHaveBeenLastCalledWith(
      -100 - LINE_WIDTH,
      -LINE_WIDTH,
      100 + LINE_WIDTH * 2,
      100 + LINE_WIDTH * 2
    );
  });

  it('bounds a scaled layer by its transformed hull and not by the source rect', () => {
    const { result, ctx } = setup();
    // 2x horizontally, 0.5x vertically: the 100x100 source becomes a 200x50 hull.
    const layer = withTransform({ a: 2, b: 0, c: 0, d: 0.5, e: 0, f: 0 });

    act(() => result.current.draw(layer));
    frame();
    // The first frame paints, the second erases the previous hull.
    frame();

    expect(ctx.clearRect).toHaveBeenLastCalledWith(-LINE_WIDTH, -LINE_WIDTH, 200 + LINE_WIDTH * 2, 50 + LINE_WIDTH * 2);
  });

  it('bounds a rotated layer by the corners, not by the source rect', () => {
    const { result, ctx } = setup();
    const root2Over2 = Math.SQRT1_2;
    const layer = withTransform({ a: root2Over2, b: root2Over2, c: -root2Over2, d: root2Over2, e: 0, f: 0 });

    act(() => result.current.draw(layer));
    frame();
    frame();

    const [x, y, width, height] = vi.mocked(ctx.clearRect).mock.calls.at(-1)!;
    // 45 degrees turns the 100x100 square into a 141.42px diamond.
    expect(x).toBeCloseTo(-70.71 - LINE_WIDTH, 2);
    expect(y).toBeCloseTo(-LINE_WIDTH, 2);
    expect(width).toBeCloseTo(141.42 + LINE_WIDTH * 2, 2);
    expect(height).toBeCloseTo(141.42 + LINE_WIDTH * 2, 2);
  });

  it('honours a position patch when building the transformed path', () => {
    const { result, ctx } = setup();
    const layer = withTransform({ a: 1, b: 0, c: 0, d: 1, e: 10, f: -5 });

    act(() => result.current.draw(layer, { x: 200, y: 300 }));
    frame();

    const path = vi.mocked(ctx.stroke).mock.calls.at(-1)![0] as Path2D;
    expect(path.moveTo).toHaveBeenCalledWith(210, 295);
    expect(path.lineTo).toHaveBeenCalledWith(310, 295);
  });

  it('falls back to the layer rect while a transform operation is disabled', () => {
    const { result, ctx } = setup();
    const layer = withTransform({ a: 1, b: 0, c: 0, d: 1, e: 10, f: -5 }, false);

    act(() => result.current.draw(layer));
    frame();

    expect(ctx.strokeRect).toHaveBeenLastCalledWith(0, 0, 100, 100);
  });

  it('does not add a grab cursor when the container ref is not attached', () => {
    const canvas = document.createElement('canvas');
    const ctx = createMockCanvasContext(canvas);
    vi.spyOn(canvas, 'getContext').mockReturnValue(ctx);
    const { result } = renderHook(() =>
      useMarchingAnts({ overlayRef: { current: canvas }, containerRef: { current: null } })
    );

    act(() => result.current.draw(withTransform({ a: 1, b: 0, c: 0, d: 1, e: 10, f: -5 })));

    // Nothing to attach the class to: `clear()` must stay a no-op, not throw.
    expect(() => {
      act(() => result.current.clear());
    }).not.toThrow();

    // ...and a no-op for the LOCK too, not just for the class. `clear()` reaches the cursor
    // through the same optional chain that skipped the container, so a version that gave up
    // early on the missing element instead of on the missing class would also stop the
    // animation — and `frames.size` is what says it did not.
    expect(rafMocks.frames.size).toBe(0);
    // Nothing was painted, so there is nothing to erase either.
    expect(ctx.clearRect).not.toHaveBeenCalled();
  });

  it('animates the transformed path and keeps marching until cleared', () => {
    const { result, ctx } = setup();
    const offsets: number[] = [];
    vi.mocked(ctx.stroke).mockImplementation(() => {
      offsets.push(ctx.lineDashOffset);
    });

    act(() => result.current.draw(withTransform({ a: 1, b: 0, c: 0, d: 1, e: 10, f: -5 })));
    frame();
    frame();

    // black, white, black, white -- advancing by SPEED each frame, written against the
    // constant so a rate change is not a number in this file that stops being the rate.
    expect(offsets).toEqual([0, DASH_LENGTH, -SPEED, DASH_LENGTH - SPEED]);
    expect(rafMocks.frames.size).toBe(1);

    act(() => result.current.clear());
    expect(rafMocks.frames.size).toBe(0);
  });
});
