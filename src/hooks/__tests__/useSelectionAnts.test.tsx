import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Selection } from '../../contexts/general-types.ts';
import type { DocumentFrame } from '../../contexts/document-frame.ts';
import { DASH_LENGTH, GAP_LENGTH, SPEED } from '../useAnts.ts';
import {
  ANT_GAP_COLOR,
  ANT_STROKE_COLOR,
  type SelectionMarchingAntsProps,
  useSelectionMarchingAnts,
} from '../useSelectionAnts.ts';
import {
  clearSelectionDragPreview,
  publishSelectionDragPreview,
  readSelectionDragPreview,
} from '../selection-drag-preview.ts';
import { createMockCanvasContext } from '../../test/setup.ts';

const FRAME: DocumentFrame = { x: 0, y: 0, width: 200, height: 120 };
const CANVAS_SIZE = { width: 200, height: 120 };

/**
 * A committed triangle whose normalized points sit inside `pos`, which is how the
 * store keeps them: absolute vertices are `points + pos`.
 */
function polygon(overrides: Partial<Selection> = {}): Selection {
  return {
    id: 'sel-1',
    isActive: true,
    lifecycle: 'committed',
    geometry: 'polygon',
    sourceTool: 'polygonal-lasso',
    pos: { x: 10, y: 20, width: 30, height: 40 },
    points: [
      { x: 0, y: 0 },
      { x: 30, y: 0 },
      { x: 30, y: 40 },
    ],
    ...overrides,
  };
}

function createRafMocks() {
  const frames: Map<number, FrameRequestCallback> = new Map();
  let nextId = 1;

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

describe('useSelectionMarchingAnts', () => {
  let rafMocks: ReturnType<typeof createRafMocks>;
  let origRaf: typeof requestAnimationFrame;
  let origCancel: typeof cancelAnimationFrame;

  beforeEach(() => {
    origRaf = globalThis.requestAnimationFrame;
    origCancel = globalThis.cancelAnimationFrame;

    rafMocks = createRafMocks();
    globalThis.requestAnimationFrame = rafMocks.requestAnimationFrame;
    globalThis.cancelAnimationFrame = rafMocks.cancelAnimationFrame;
    // The drag channel is a module-level slot on purpose, so it outlives this hook exactly as it
    // outlives a tool area. Nothing resets it for us between cases, and a leaked entry freezes the
    // ants for every test that follows — which reads as a mysteriously wrong speed, not as a leak.
    clearSelectionDragPreview();
  });

  afterEach(() => {
    globalThis.requestAnimationFrame = origRaf;
    globalThis.cancelAnimationFrame = origCancel;
    clearSelectionDragPreview();
    vi.restoreAllMocks();
  });

  function frame() {
    const pending = [...rafMocks.frames.values()];
    rafMocks.frames.clear();
    act(() => pending.forEach((callback) => callback(0)));
  }

  function setup(overrides: Partial<SelectionMarchingAntsProps> = {}) {
    const canvas = document.createElement('canvas');
    canvas.width = CANVAS_SIZE.width;
    canvas.height = CANVAS_SIZE.height;
    const ctx = createMockCanvasContext(canvas);
    // A plain assignment rather than `vi.spyOn`: `vi.restoreAllMocks` in the
    // teardown runs before React unmounts, so a spy would be restored to jsdom's
    // unimplemented `getContext` and the hook's unmount cleanup would call it.
    canvas.getContext = vi.fn(() => ctx) as unknown as HTMLCanvasElement['getContext'];

    const overlayRef = { current: canvas as HTMLCanvasElement | null };
    const props: SelectionMarchingAntsProps = {
      overlayRef,
      selections: [polygon()],
      documentFrame: FRAME,
      enabled: true,
      ...overrides,
    };
    const hook = renderHook((current: SelectionMarchingAntsProps) => useSelectionMarchingAnts(current), {
      initialProps: props,
    });

    return { ...hook, ctx, overlayRef, props };
  }

  /** The two colours, in paint order, for every stroke of the first frame. */
  function recordStrokes(ctx: CanvasRenderingContext2D) {
    const offsets: number[] = [];
    const colors: string[] = [];
    vi.mocked(ctx.stroke).mockImplementation(() => {
      offsets.push(ctx.lineDashOffset);
      colors.push(String(ctx.strokeStyle));
    });
    return { offsets, colors };
  }

  it('marches a two-tone dash along the closed contour and keeps marching', () => {
    const { ctx } = setup();
    expect(rafMocks.frames.size).toBe(1);

    const { offsets, colors } = recordStrokes(ctx);
    frame();

    expect(ctx.clearRect).toHaveBeenCalledWith(0, 0, CANVAS_SIZE.width, CANVAS_SIZE.height);
    expect(ctx.setLineDash).toHaveBeenCalledWith([DASH_LENGTH, GAP_LENGTH]);
    expect(colors).toEqual([ANT_STROKE_COLOR, ANT_GAP_COLOR]);
    expect(offsets).toEqual([0, DASH_LENGTH]);
    expect(ctx.save).toHaveBeenCalled();
    expect(ctx.restore).toHaveBeenCalled();

    const path = vi.mocked(ctx.stroke).mock.calls.at(-1)![0] as Path2D;
    expect(path.moveTo).toHaveBeenCalledWith(10, 20);
    expect(path.lineTo).toHaveBeenCalledWith(40, 20);
    expect(path.lineTo).toHaveBeenCalledWith(40, 60);
    expect(path.closePath).toHaveBeenCalledOnce();

    frame();

    expect(offsets).toEqual([0, DASH_LENGTH, -SPEED, DASH_LENGTH - SPEED]);
    expect(rafMocks.frames.size).toBe(1);
  });

  it('clears logical frame bounds instead of the DPR-scaled backing store', () => {
    const { ctx, overlayRef } = setup();
    overlayRef.current!.width = CANVAS_SIZE.width * 2;
    overlayRef.current!.height = CANVAS_SIZE.height * 2;

    frame();

    expect(ctx.clearRect).toHaveBeenCalledWith(0, 0, FRAME.width, FRAME.height);
  });

  describe('a selection drag', () => {
    /**
     * The whole of the drag-freeze rule in one assertion set: the offset is HELD, the border is
     * still STROKED, the loop is still ALIVE, and the phase is picked up again unchanged on
     * release.
     *
     * Each of those four is load-bearing and each fails differently. Holding the offset in a
     * cancelled frame would park the ants mid-drag; holding it by clearing the canvas would
     * satisfy "stop animating" by hiding the border, which is the opposite of the requirement;
     * and a loop that stopped instead of being fed a held offset would need a re-render to
     * restart, which a drag never produces — the tool area keeps the drag in a ref precisely so
     * the store does not change.
     */
    it('freezes the crawl, keeps painting the border, and resumes on the phase it left', () => {
      const { ctx } = setup();
      const { offsets } = recordStrokes(ctx);
      publishSelectionDragPreview({ kind: 'follow', selection: polygon() });

      frame();
      frame();
      frame();

      // Three frames, six strokes, and every offset identical: still dashed, no longer crawling.
      expect(offsets).toEqual([0, DASH_LENGTH, 0, DASH_LENGTH, 0, DASH_LENGTH]);
      // A live loop behind the hold. A cancelled frame leaves nothing scheduled, and the ants
      // would not come back until a re-render.
      expect(rafMocks.frames.size).toBe(1);

      clearSelectionDragPreview();
      frame();

      // Still 0 rather than a jump: nothing advanced the offset while the drag held it.
      expect(offsets).toEqual([0, DASH_LENGTH, 0, DASH_LENGTH, 0, DASH_LENGTH, 0, DASH_LENGTH]);
      expect(rafMocks.frames.size).toBe(1);
    });

    it('paints the dragged contour where the pointer put it, in place of the committed one', () => {
      const { ctx } = setup();
      publishSelectionDragPreview({
        kind: 'follow',
        selection: polygon({ pos: { x: 100, y: 200, width: 30, height: 40 } }),
      });

      frame();

      // Two strokes — the black/white pair — and one path. The committed contour is filtered out
      // by id, because painting it too would outline the same selection twice: once where the
      // pointer left it and once where it went.
      expect(ctx.stroke).toHaveBeenCalledTimes(2);
      const path = vi.mocked(ctx.stroke).mock.calls[0][0] as Path2D;
      expect(path.moveTo).toHaveBeenCalledWith(100, 200);
      expect(path.lineTo).toHaveBeenCalledWith(130, 200);
    });

    it('leaves every other selection crawling, because only the dragged one is frozen', () => {
      const other = polygon({ id: 'sel-2', pos: { x: 80, y: 90, width: 10, height: 10 } });
      const { ctx } = setup({ selections: [polygon(), other] });
      publishSelectionDragPreview({ kind: 'follow', selection: polygon() });

      frame();

      // Three contours' worth of strokes for two selections — the dragged pair plus the
      // untouched one — is the proof the filter is by id and not "replace the whole list".
      expect(ctx.stroke).toHaveBeenCalledTimes(4);
    });

    /**
     * A marquee being drawn is already on the tool overlay, one canvas ABOVE this one, and it is
     * the same rectangle the ants would otherwise outline. So the ants stand down rather than
     * draw a second, stale border beside it — which is what Adobe's `Select > Transform
     * Selection` does, swapping the ants for the transform box and restoring them on commit.
     *
     * The dash offset is deliberately left alone here too, so the restored ants pick up on the
     * phase they left instead of snapping to the top of the cycle.
     */
    it('stands down for a marquee on the tool overlay, then comes back on release', () => {
      const { ctx } = setup();
      frame();
      vi.mocked(ctx.stroke).mockClear();

      publishSelectionDragPreview({ kind: 'marquee' });
      frame();

      expect(ctx.stroke).not.toHaveBeenCalled();
      expect(ctx.clearRect).toHaveBeenLastCalledWith(0, 0, CANVAS_SIZE.width, CANVAS_SIZE.height);
      // Alive, so the release below repaints without needing a re-render to wake the loop.
      expect(rafMocks.frames.size).toBe(1);

      clearSelectionDragPreview();
      frame();

      expect(vi.mocked(ctx.stroke).mock.calls.length).toBeGreaterThan(0);
      const path = vi.mocked(ctx.stroke).mock.calls[0][0] as Path2D;
      expect(path.moveTo).toHaveBeenCalledWith(10, 20);
      // `-SPEED + DASH_LENGTH`, not `DASH_LENGTH`: the offset the stand-down left in place is `0`
      // and only the frame after the release advanced it. A discarded phase would restart at 0
      // and read here as exactly `DASH_LENGTH`, which is what makes this a pin.
      expect(ctx.lineDashOffset).toBeCloseTo(DASH_LENGTH - SPEED, 6);
    });

    it('reads the slot rather than a value closed over at render', () => {
      const { ctx } = setup();
      frame();
      vi.mocked(ctx.stroke).mockClear();

      // Published after the hook rendered, with no re-render in between. This is exactly how a
      // drag reaches the loop: `publishSelectionDragPreview` is called from a pointermove inside
      // a ref, so nothing about the hook's props ever changes.
      publishSelectionDragPreview({ kind: 'marquee' });
      frame();

      expect(ctx.stroke).not.toHaveBeenCalled();
      expect(readSelectionDragPreview()).toEqual({ kind: 'marquee' });
    });
  });

  describe('the contain fit divisor', () => {
    // This canvas is sized to the DOCUMENT and displayed with `object-contain`, so a context draws
    // in document px while `LINE_WIDTH`/`DASH_LENGTH`/`GAP_LENGTH`/`SPEED` are CSS px. Every
    // assertion below is stated as a NUMBER THAT CHANGES WITH THE SCALE, because a test that
    // hardcodes 6 asserts only that the code still runs.
    it('divides the chrome and the crawl rate by a scale below 1', () => {
      const { ctx } = setup({ scaleRef: { current: 0.5 } });
      const { offsets } = recordStrokes(ctx);

      frame();

      // Undivivided this is [6, 6] and `lineWidth` 1 — a sub-pixel stroke at half zoom.
      expect(ctx.setLineDash).toHaveBeenCalledWith([DASH_LENGTH / 0.5, GAP_LENGTH / 0.5]);
      expect(ctx.lineWidth).toBe(2);
      expect(offsets).toEqual([0, DASH_LENGTH / 0.5]);

      frame();

      // `SPEED` is a per-frame distance, so it is divided by the same factor: undivided this is
      // -1, which crawls at half the apparent speed.
      expect(offsets).toEqual([0, 12, -SPEED / 0.5, DASH_LENGTH / 0.5 - SPEED / 0.5]);
    });

    it('divides the chrome and the crawl rate by a scale above 1', () => {
      const { ctx } = setup({ scaleRef: { current: 2 } });
      const { offsets } = recordStrokes(ctx);

      frame();

      expect(ctx.setLineDash).toHaveBeenCalledWith([DASH_LENGTH / 2, GAP_LENGTH / 2]);
      expect(ctx.lineWidth).toBe(0.5);
      expect(offsets).toEqual([0, DASH_LENGTH / 2]);

      frame();

      expect(offsets).toEqual([0, 3, -SPEED / 2, DASH_LENGTH / 2 - SPEED / 2]);
    });

    it('wraps the dash offset on the DIVIDED cycle, not the constant one', () => {
      // The trap: `DASH_CYCLE` was a module constant equal to the UNDIVIDED cycle. At a scale below
      // 1 the dashes are LONGER in document px than that, so offsetting by the constant wraps the
      // offset in the middle of a dash and the pattern jumps twice per cycle — a visible stutter,
      // and one that no assertion on the first two frames can see.
      const scale = 0.5;
      const { ctx } = setup({ scaleRef: { current: scale } });
      const seen: number[] = [];
      vi.mocked(ctx.stroke).mockImplementation(() => seen.push(ctx.lineDashOffset));

      const cycle = (DASH_LENGTH + GAP_LENGTH) / scale;
      for (let i = 0; i < Math.ceil(cycle / (SPEED / scale)) + 1; i++) frame();

      // Every offset stays inside one divided cycle, in the negative half-open range JS `%` gives.
      expect(Math.min(...seen)).toBeGreaterThanOrEqual(-cycle);
      // And the modulo is the DIVIDED cycle: an undivided modulus could not hold this bound, since
      // the offsets would have run on to -24 while the bound it can prove is -12.
      expect(Math.min(...seen)).toBeLessThan(-(DASH_LENGTH + GAP_LENGTH));
    });

    it('reads 1 and draws exactly what it drew before the divisor existed', () => {
      // The omitted `scaleRef` is the case every existing caller hits until `useContainScale` has
      // measured, and 1 is the identity divisor. This is the control for the three above: if the
      // divisor were read from anywhere else, this would go red with them.
      const { ctx } = setup();
      const { offsets } = recordStrokes(ctx);

      frame();

      expect(ctx.setLineDash).toHaveBeenCalledWith([DASH_LENGTH, GAP_LENGTH]);
      expect(ctx.lineWidth).toBe(1);
      expect(offsets).toEqual([0, DASH_LENGTH]);
    });
  });

  it('paints at full opacity, whatever globalAlpha the context was left holding', () => {
    // The merge added `resetOverlayAlpha` to this loop, and this is what holds it. Without the
    // reset the ants inherit whatever the context's current alpha is, and two 1px strokes are
    // the first thing that would show it: the layer-outline loop this one sits beside resets for
    // the same reason (`useAnts.ts:57`).
    //
    // The precondition is the load-bearing half. `createMockCanvasContext` initialises
    // `globalAlpha` to 1, so asserting 1 afterwards would pass whether or not the reset exists —
    // the context has to be handed a value to lose.
    const { ctx } = setup();
    ctx.globalAlpha = 0.2;
    const alphaAtStroke: number[] = [];
    vi.mocked(ctx.stroke).mockImplementation(() => {
      alphaAtStroke.push(ctx.globalAlpha);
    });

    frame();

    expect(alphaAtStroke.length).toBeGreaterThan(0);
    expect(alphaAtStroke.every((alpha) => alpha === 1)).toBe(true);
  });

  it('marches every active selection, and a boundary traced by the magic wand included', () => {
    const { ctx } = setup({ selections: [polygon(), polygon({ id: 'sel-2', sourceTool: 'magic-wand' })] });
    frame();

    expect(ctx.stroke).toHaveBeenCalledTimes(4);
    expect(rafMocks.frames.size).toBe(1);
  });

  it('converts document points to canvas coordinates through the frame', () => {
    const { ctx } = setup({ documentFrame: { x: 100, y: 50, width: 300, height: 300 } });
    frame();

    const path = vi.mocked(ctx.stroke).mock.calls.at(-1)![0] as Path2D;
    expect(path.moveTo).toHaveBeenCalledWith(-90, -30);
    expect(path.lineTo).toHaveBeenCalledWith(-60, -30);
  });

  it('repaints replacement geometry on the next frame rather than restarting the loop', () => {
    const { ctx, props, rerender } = setup();
    frame();
    const scheduled = rafMocks.requestAnimationFrame.mock.calls.length;
    vi.mocked(ctx.stroke).mockClear();

    rerender({
      ...props,
      selections: [
        polygon({
          id: 'sel-2',
          pos: { x: 60, y: 0, width: 10, height: 10 },
          points: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
          ],
        }),
      ],
    });

    // The loop was already running, so replacing a selection must not cancel it and
    // queue a second one — two loops would march at double speed.
    expect(rafMocks.requestAnimationFrame).toHaveBeenCalledTimes(scheduled);

    frame();

    const path = vi.mocked(ctx.stroke).mock.calls.at(-1)![0] as Path2D;
    expect(path.moveTo).toHaveBeenCalledWith(60, 0);
  });

  it('cancels the loop and clears the canvas once nothing is left to animate', () => {
    const { ctx, props, rerender } = setup();
    frame();
    expect(rafMocks.frames.size).toBe(1);

    rerender({ ...props, selections: [] });

    expect(rafMocks.frames.size).toBe(0);
    expect(rafMocks.cancelAnimationFrame).toHaveBeenCalled();
    expect(ctx.clearRect).toHaveBeenLastCalledWith(0, 0, CANVAS_SIZE.width, CANVAS_SIZE.height);

    vi.mocked(ctx.stroke).mockClear();
    frame();

    expect(ctx.stroke).not.toHaveBeenCalled();
  });

  it('never schedules a frame while disabled', () => {
    const { ctx } = setup({ enabled: false });

    expect(rafMocks.frames.size).toBe(0);
    expect(ctx.stroke).not.toHaveBeenCalled();
  });

  it.each([
    ['an inactive selection', { isActive: false }],
    ['a degenerate selection', { points: [{ x: 0, y: 0 }] }],
  ])('ignores %s', (_label, overrides) => {
    const { ctx } = setup({ selections: [polygon(overrides)] });

    expect(rafMocks.frames.size).toBe(0);
    expect(ctx.stroke).not.toHaveBeenCalled();
  });

  /**
   * The rectangle case used to sit in the table above as a third row, asserting the ants
   * skipped `geometry: 'rectangle'` on the stated ground that `useRect` strokes that border on
   * the tool overlay. It is a pin on behaviour that has deliberately changed, so it is removed
   * here rather than weakened, and this is the test that took its place: the rectangle marches
   * like everything else.
   *
   * It matters that the CONTOUR is checked and not merely that something was stroked. A
   * rectangle's normalized `points` are its four corners, so a path through them at
   * `pos + point` is the rectangle, and reading those coordinates back off the recorded calls
   * is what proves the border is in the right place rather than merely present.
   */
  it('marches a rectangle selection, the way it marches a polygon', () => {
    const { ctx } = setup({
      selections: [
        polygon({
          geometry: 'rectangle',
          sourceTool: 'rectangular-selection',
          // The four corners, normalized into `pos`, which is the shape
          // `createCommittedRectangleSelection` commits and the only thing that makes this a
          // rectangle rather than the triangle the fixture above describes.
          points: [
            { x: 0, y: 0 },
            { x: 30, y: 0 },
            { x: 30, y: 40 },
            { x: 0, y: 40 },
          ],
        }),
      ],
    });

    expect(rafMocks.frames.size).toBe(1);
    frame();

    const path = vi.mocked(ctx.stroke).mock.calls[0][0] as Path2D;
    expect(path.moveTo).toHaveBeenCalledWith(10, 20);
    expect(path.lineTo).toHaveBeenCalledWith(40, 20);
    expect(path.lineTo).toHaveBeenCalledWith(40, 60);
    expect(path.lineTo).toHaveBeenCalledWith(10, 60);
    expect(path.closePath).toHaveBeenCalledOnce();
  });

  it('cancels the pending frame and clears the canvas on unmount', () => {
    const { ctx, unmount } = setup();
    unmount();

    expect(rafMocks.frames.size).toBe(0);
    expect(rafMocks.cancelAnimationFrame).toHaveBeenCalled();
    expect(ctx.clearRect).toHaveBeenLastCalledWith(0, 0, CANVAS_SIZE.width, CANVAS_SIZE.height);
  });

  it('halts instead of spinning when the overlay canvas is gone', () => {
    const { overlayRef } = setup();
    frame();
    expect(rafMocks.frames.size).toBe(1);

    overlayRef.current = null;
    frame();

    expect(rafMocks.frames.size).toBe(0);
  });

  it('tolerates mounting without a canvas at all', () => {
    const { unmount } = renderHook(() =>
      useSelectionMarchingAnts({ overlayRef: { current: null }, selections: [polygon()], documentFrame: FRAME })
    );

    expect(rafMocks.frames.size).toBe(1);
    expect(() => frame()).not.toThrow();
    expect(rafMocks.frames.size).toBe(0);
    unmount();
  });
});
