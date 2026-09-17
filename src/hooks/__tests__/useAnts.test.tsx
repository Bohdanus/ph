import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Layer } from '../../contexts/layer-types.ts';
import { useMarchingAnts } from '../useAnts.ts';

describe('useMarchingAnts', () => {
  let frames: Map<number, FrameRequestCallback>;
  let nextId: number;

  beforeEach(() => {
    frames = new Map();
    nextId = 0;
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((callback: FrameRequestCallback) => {
        const id = nextId++;
        frames.set(id, callback);
        return id;
      })
    );
    vi.stubGlobal(
      'cancelAnimationFrame',
      vi.fn((id: number) => frames.delete(id))
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  function frame() {
    const pending = [...frames.values()];
    frames.clear();
    act(() => pending.forEach((callback) => callback(0)));
  }

  function setup() {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    vi.spyOn(canvas, 'getContext').mockReturnValue(ctx);
    const overlayRef = { current: canvas as HTMLCanvasElement | null };
    const containerRef = { current: document.createElement('div') };
    const hook = renderHook(() => useMarchingAnts({ overlayRef, containerRef }));
    return { ...hook, ctx, overlayRef, containerRef };
  }

  it('closes arbitrary contours and animates both strokes without changing the cursor', () => {
    const { result, ctx, containerRef } = setup();
    const offsets: number[] = [];
    vi.mocked(ctx.stroke).mockImplementation(() => {
      offsets.push(ctx.lineDashOffset);
    });
    act(() =>
      result.current.drawPoints([
        { x: 10, y: 20 },
        { x: 40, y: 25 },
        { x: 15, y: 50 },
      ])
    );
    frame();
    const path = vi.mocked(ctx.stroke).mock.calls.at(-1)![0] as Path2D;
    expect(path.moveTo).toHaveBeenCalledWith(10, 20);
    expect(path.lineTo).toHaveBeenCalledWith(40, 25);
    expect(path.lineTo).toHaveBeenCalledWith(15, 50);
    expect(path.closePath).toHaveBeenCalledOnce();
    expect(containerRef.current.classList.contains('cursor-grab')).toBe(false);
    frame();
    expect(offsets).toEqual([0, 6, -1, 5]);
    expect(ctx.clearRect).toHaveBeenCalledWith(9, 19, 32, 32);
    expect(ctx.save).toHaveBeenCalled();
    expect(ctx.restore).toHaveBeenCalled();
  });

  it('supports open drafts and clears old geometry when replaced by a custom path', () => {
    const { result, ctx } = setup();
    act(() =>
      result.current.drawPoints(
        [
          { x: 0, y: 0 },
          { x: 10, y: 20 },
        ],
        false
      )
    );
    frame();
    const draft = vi.mocked(ctx.stroke).mock.calls.at(-1)![0] as Path2D;
    expect(draft.closePath).not.toHaveBeenCalled();
    const custom = new Path2D();
    act(() => result.current.drawPath(custom, { x: 100, y: 100, width: 30, height: 40 }));
    expect(frames.size).toBe(1);
    frame();
    expect(ctx.clearRect).toHaveBeenCalledWith(-1, -1, 12, 22);
    expect(ctx.stroke).toHaveBeenLastCalledWith(custom);
    act(() => result.current.clear());
    expect(ctx.clearRect).toHaveBeenLastCalledWith(99, 99, 32, 42);
    expect(frames.size).toBe(0);
  });

  it('preserves layer rectangles and cancels even before the first frame', () => {
    const { result, ctx, containerRef } = setup();
    const layer = { pos: { x: 1, y: 2, width: 30, height: 40 } } as Layer;
    act(() => result.current.draw(layer));
    expect(containerRef.current.classList.contains('cursor-grab')).toBe(true);
    act(() => result.current.clear());
    expect(frames.size).toBe(0);
    expect(containerRef.current.classList.contains('cursor-grab')).toBe(false);
    act(() => result.current.draw(layer, { x: 20 }));
    frame();
    expect(ctx.strokeRect).toHaveBeenLastCalledWith(20, 2, 30, 40);
    act(() => result.current.drawPoints([]));
    expect(frames.size).toBe(0);
    expect(ctx.clearRect).toHaveBeenLastCalledWith(19, 1, 32, 42);
  });

  it('cleans up a painted canvas even after its ref is detached', () => {
    const { result, ctx, overlayRef, unmount } = setup();
    act(() =>
      result.current.drawPoints([
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ])
    );
    frame();
    overlayRef.current = null;
    unmount();
    expect(frames.size).toBe(0);
    expect(ctx.clearRect).toHaveBeenLastCalledWith(-1, -1, 12, 12);
  });

  it('can mount without a canvas or container', () => {
    const { result, unmount } = renderHook(() => useMarchingAnts({ overlayRef: { current: null } }));
    act(() =>
      result.current.drawPoints([
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ])
    );
    frame();
    expect(frames.size).toBe(0);
    unmount();
  });
});
