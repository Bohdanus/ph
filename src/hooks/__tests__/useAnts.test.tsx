import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import type { Layer } from '../../contexts/layer-types.ts';
import { DASH_LENGTH, GAP_LENGTH, LINE_WIDTH, SPEED, useMarchingAnts } from '../useAnts.ts';
import { createMockCanvasContext } from '../../test/setup.ts';

function createRafMocks() {
  const frames: Map<number, FrameRequestCallback> = new Map();
  let nextId = 0;

  const requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
    const id = nextId++;
    frames.set(id, callback);
    return id;
  });

  const cancelAnimationFrame = vi.fn((id: number) => {
    frames.delete(id);
  });

  return { requestAnimationFrame, cancelAnimationFrame, frames };
}

describe('useMarchingAnts', () => {
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
    vi.restoreAllMocks();
  });

  function frame() {
    const pending = [...rafMocks.frames.values()];
    rafMocks.frames.clear();
    act(() => pending.forEach((callback) => callback(0)));
  }

  function setup(scale?: number) {
    const canvas = document.createElement('canvas');
    const ctx = createMockCanvasContext(canvas);
    vi.spyOn(canvas, 'getContext').mockReturnValue(ctx);
    const overlayRef = { current: canvas as HTMLCanvasElement | null };
    const containerRef = { current: document.createElement('div') };
    const scaleRef = scale === undefined ? undefined : { current: scale };
    const hook = renderHook(() => useMarchingAnts({ overlayRef, containerRef, scaleRef }));
    return { ...hook, ctx, overlayRef, containerRef, scaleRef };
  }

  /**
   * The ants are drawn into a DOCUMENT-sized overlay that CSS displays with `object-contain`, so
   * the context draws in document px. `DASH_LENGTH` and friends are CSS px, which means they are
   * only the right size at scale 1 — below it the outline is sub-pixel and smears, and the crawl
   * rate slows down with it. This is the whole of defect D3: the marquee in `useRect` has always
   * divided by the contain fit (`2 / scale`), and these two painters did not.
   */
  it('divides its dash, gap and line width by the contain scale', () => {
    const { result, ctx } = setup(0.5);
    act(() =>
      result.current.drawPoints([
        { x: 10, y: 20 },
        { x: 40, y: 25 },
      ])
    );
    frame();

    // At scale 0.5 the document is drawn at half size, so a 6 CSS px dash is 12 document px.
    expect(ctx.setLineDash).toHaveBeenCalledWith([12, 12]);
    expect(ctx.lineWidth).toBe(2);
  });

  it('keeps the crawl rate a screen speed, so the ants do not slow down when zoomed out', () => {
    const scaled = setup(0.5);
    const offsets: number[] = [];
    vi.mocked(scaled.ctx.stroke).mockImplementation(() => offsets.push(scaled.ctx.lineDashOffset));
    act(() =>
      scaled.result.current.drawPoints([
        { x: 10, y: 20 },
        { x: 40, y: 25 },
      ])
    );
    frame();
    frame();

    // `SPEED` is a CSS px per frame, so at scale 0.5 it is twice as many document px; the
    // black/white half-shift is the whole dash (12), not the undivided 6. Written against the
    // constant rather than its value on purpose: a rate change must not be a number here that
    // silently stops being the rate.
    expect(offsets).toEqual([0, 12, -SPEED / 0.5, 12 - SPEED / 0.5]);
  });

  it('pads the erase by the scaled line width, so the clear covers what was stroked', () => {
    const { result, ctx } = setup(0.5);
    // The same three points as the scale-1 test above, so the bounds are identical (10,20,30x30)
    // and the only difference between the two clearRects is the padding.
    act(() =>
      result.current.drawPoints([
        { x: 10, y: 20 },
        { x: 40, y: 25 },
        { x: 15, y: 50 },
      ])
    );
    frame();
    // The first frame paints and records what it painted; the erase runs at the top of the next
    // one, so a second frame is what actually issues the clearRect.
    frame();

    // The undivided version clears (9, 19, 32, 32); at scale 0.5 the 2px line needs 2px of padding.
    expect(ctx.clearRect).toHaveBeenCalledWith(8, 18, 34, 34);
  });

  it('keeps the ants at the same on-screen size when zoomed IN, not just when zoomed out', () => {
    // The divisor's other direction. `useSelectionAnts.test.tsx` covers both sides of 1;
    // this file only ever went below, so an inverted divisor (`scale` instead of `/ scale`)
    // would have gone red there and stayed green here.
    const { result, ctx } = setup(2);
    const offsets: number[] = [];
    vi.mocked(ctx.stroke).mockImplementation(() => offsets.push(ctx.lineDashOffset));
    act(() =>
      result.current.drawPoints([
        { x: 10, y: 20 },
        { x: 40, y: 25 },
      ])
    );
    frame();
    frame();

    // At scale 2 a 6 CSS px dash is 3 document px, and the crawl is half a document px.
    expect(ctx.setLineDash).toHaveBeenCalledWith([DASH_LENGTH / 2, GAP_LENGTH / 2]);
    expect(ctx.lineWidth).toBe(LINE_WIDTH / 2);
    expect(offsets).toEqual([0, DASH_LENGTH / 2, -SPEED / 2, DASH_LENGTH / 2 - SPEED / 2]);
  });

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
    expect(offsets).toEqual([0, DASH_LENGTH, -SPEED, DASH_LENGTH - SPEED]);
    expect(ctx.clearRect).toHaveBeenCalledWith(9, 19, 32, 32);
    // One bracket per FRAME, around both ant passes: the loop rewrites `lineWidth`,
    // `lineJoin`, `lineCap` and `setLineDash` on a context the whole session shares, so a
    // missing or doubled pair leaves the last painter's state behind. A bare "was called"
    // is satisfied by the balanced case and by both broken ones. Two frames run above, and
    // the four offsets are the two paints of each, so the count has to be two and not four.
    expect(ctx.save).toHaveBeenCalledTimes(2);
    expect(ctx.restore).toHaveBeenCalledTimes(2);
    // And the bracket actually brackets: the restore has to come after the LAST stroke, not
    // before the first, or the second pass paints with whatever the previous painter left.
    expect((ctx.restore as unknown as Mock).mock.invocationCallOrder.at(-1)).toBeGreaterThan(
      (ctx.stroke as unknown as Mock).mock.invocationCallOrder.at(-1)!
    );
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
    expect(rafMocks.frames.size).toBe(1);
    frame();
    expect(ctx.clearRect).toHaveBeenCalledWith(-1, -1, 12, 22);
    expect(ctx.stroke).toHaveBeenLastCalledWith(custom);
    act(() => result.current.clear());
    expect(ctx.clearRect).toHaveBeenLastCalledWith(99, 99, 32, 42);
    expect(rafMocks.frames.size).toBe(0);
  });

  it('preserves layer rectangles and cancels even before the first frame', () => {
    const { result, ctx, containerRef } = setup();
    const layer = { pos: { x: 1, y: 2, width: 30, height: 40 } } as Layer;
    act(() => result.current.draw(layer));
    expect(containerRef.current.classList.contains('cursor-grab')).toBe(true);
    act(() => result.current.clear());
    expect(rafMocks.frames.size).toBe(0);
    expect(containerRef.current.classList.contains('cursor-grab')).toBe(false);
    act(() => result.current.draw(layer, { x: 20 }));
    frame();
    expect(ctx.strokeRect).toHaveBeenLastCalledWith(20, 2, 30, 40);
    act(() => result.current.drawPoints([]));
    expect(rafMocks.frames.size).toBe(0);
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
    expect(rafMocks.frames.size).toBe(0);
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
    expect(rafMocks.frames.size).toBe(0);
    unmount();
  });

  it('strokes at full opacity when the shared overlay was left at a tool alpha', () => {
    const { result, ctx } = setup();
    const alphaAtStroke: number[] = [];
    vi.mocked(ctx.stroke).mockImplementation(() => {
      alphaAtStroke.push(ctx.globalAlpha);
    });
    ctx.globalAlpha = 0.2;

    act(() =>
      result.current.drawPoints([
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ])
    );
    frame();

    expect(alphaAtStroke).toEqual([1, 1]);
  });
});
