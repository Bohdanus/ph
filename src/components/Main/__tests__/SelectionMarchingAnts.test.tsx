import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Selection } from '../../../contexts/general-types.ts';
import { createMockCanvasContext } from '../../../test/setup.ts';
import { SelectionMarchingAnts } from '../SelectionMarchingAnts.tsx';

/**
 * The store-to-canvas wiring for the polygon selection border: whatever the store
 * holds is what marches, on the canvas `Main` hands over, and only while the
 * polygon selection tools are up.
 */

const storeState = vi.hoisted(
  () =>
    ({
      selections: [] as Selection[],
      totalSize: { width: 200, height: 120 },
      documentFrame: { x: 0, y: 0, width: 200, height: 120 },
      // The component measures the contain fit off this to divide the chrome, and it reads it off
      // the store rather than taking a prop — the same source every tool area's
      // `usePointerPosition({ ref: containerRef })` reads. A mock without it is not a thinner
      // mock, it is a `ref.current` on `undefined` inside `useContainScale`'s first layout effect.
      containerRef: { current: null },
    }) as Record<string, unknown>
);

vi.mock('../../../contexts/StoreContext.tsx', () => ({
  useStore: () => [storeState],
}));

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

describe('SelectionMarchingAnts', () => {
  let rafMocks: ReturnType<typeof createRafMocks>;
  let origRaf: typeof requestAnimationFrame;
  let origCancel: typeof cancelAnimationFrame;

  beforeEach(() => {
    origRaf = globalThis.requestAnimationFrame;
    origCancel = globalThis.cancelAnimationFrame;

    rafMocks = createRafMocks();
    globalThis.requestAnimationFrame = rafMocks.requestAnimationFrame;
    globalThis.cancelAnimationFrame = rafMocks.cancelAnimationFrame;

    storeState.selections = [];
    storeState.documentFrame = { x: 0, y: 0, width: 200, height: 120 };
    // At FILE scope rather than at the end of the one case that sets it: a case that fails
    // before its own reset would otherwise hand the next case a measured container and every
    // dash and divisor would come out divided by 2. This is the un-measured identity state.
    storeState.containerRef = { current: null };
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

  function setup(enabled = true) {
    const canvas = document.createElement('canvas');
    canvas.width = 200;
    canvas.height = 120;
    const ctx = createMockCanvasContext(canvas);
    canvas.getContext = vi.fn(() => ctx) as unknown as HTMLCanvasElement['getContext'];

    /**
     * `lineDashOffset` is a plain data property on the mock context, so the hook writes it and
     * the LAST value survives the frame. That is not enough to read the march from: the loop
     * sets it twice per shape (once per stroke) and leaves the second one behind, and the value
     * it steps BY is only in the difference between frames. So each `stroke` records the offset
     * it was handed, which is the per-frame sample the march is made of.
     *
     * The `+ 0` normalises the sign of zero. A walk that comes home to `(0 - dashCycle) %
     * dashCycle` lands on `-0`, which the canvas treats as the same dash start as `0` but which
     * `Object.is` — and therefore `toBe` and `toEqual` — reports as different. Normalising at the
     * recorder keeps the assertions reading as the number they mean.
     */
    const strokes: { offset: number; style: string }[] = [];
    const baseStroke = ctx.stroke;
    ctx.stroke = vi.fn((path: Path2D) => {
      strokes.push({
        offset: (ctx as unknown as { lineDashOffset: number }).lineDashOffset + 0,
        style: ctx.strokeStyle as unknown as string,
      });
      return (baseStroke as unknown as (p: Path2D) => void)(path);
    }) as unknown as typeof ctx.stroke;

    const overlayRef = { current: canvas };
    const { unmount, rerender } = render(<SelectionMarchingAnts overlayRef={overlayRef} enabled={enabled} />);

    return { ctx, strokes, unmount, rerender, overlayRef };
  }

  it('marches the committed polygon the store holds', () => {
    storeState.selections = [polygon()];
    const { ctx } = setup();

    expect(rafMocks.frames.size).toBe(1);

    frame();

    expect(ctx.setLineDash).toHaveBeenCalled();
    const path = vi.mocked(ctx.stroke).mock.calls.at(-1)![0] as Path2D;
    expect(path.moveTo).toHaveBeenCalledWith(10, 20);
    expect(path.closePath).toHaveBeenCalledOnce();
  });

  it('offsets the border by the store document frame', () => {
    storeState.selections = [polygon()];
    storeState.documentFrame = { x: 100, y: 50, width: 300, height: 300 };
    const { ctx } = setup();

    frame();

    const path = vi.mocked(ctx.stroke).mock.calls.at(-1)![0] as Path2D;
    expect(path.moveTo).toHaveBeenCalledWith(-90, -30);
  });

  it('paints nothing while the polygon selection tools are not up', () => {
    storeState.selections = [polygon()];
    const { ctx } = setup(false);

    expect(rafMocks.frames.size).toBe(0);
    expect(ctx.stroke).not.toHaveBeenCalled();
  });

  it('paints nothing when the document holds no selection', () => {
    const { ctx } = setup();

    expect(rafMocks.frames.size).toBe(0);
    expect(ctx.stroke).not.toHaveBeenCalled();
  });

  it('divides the chrome by the measured contain fit, not by a hardcoded 1', () => {
    // The component now measures the workspace container, so the border is a screen-constant
    // thickness at any zoom rather than a document-px one. `current: null` is the un-measured
    // state and yields the identity divisor; this drives the measured one by giving the container
    // a real box half the document's size.
    storeState.selections = [polygon()];
    const container = document.createElement('div');
    container.getBoundingClientRect = () => ({ width: 100, height: 60 }) as DOMRect;
    storeState.containerRef = { current: container };

    const { ctx } = setup();
    frame();

    // 200x120 document in a 100x60 box is a fit of 0.5, so the 6 CSS px dash is 12 document px.
    expect(ctx.setLineDash).toHaveBeenCalledWith([12, 12]);
    expect(ctx.lineWidth).toBe(2);
  });

  /**
   * The march itself. Everything above proves the ants PAINT; nothing above proves they MOVE,
   * and a frozen dash offset is the one defect a border of marching ants cannot survive.
   *
   * The offsets are read at scale 1 — `containerRef.current` is `null`, so `useContainScale`
   * leaves its ref at the identity divisor — which makes the arithmetic exact rather than
   * approximate: `DASH_LENGTH`/`GAP_LENGTH` are 6 and `SPEED` is `0.4` (both exported from
   * `src/hooks/useAnts.ts`), so one frame steps the offset by exactly `0.4` modulo a `12`
   * cycle, and the second stroke of the pair sits exactly one dash along from the first.
   */
  it('advances the dash offset by exactly one frame step, so the border marches rather than sitting still', () => {
    storeState.selections = [polygon()];
    const { strokes } = setup();

    frame();
    // First frame: the offset starts at 0, and the pair is (0, 0 + dashLength) = (0, 6).
    expect(strokes).toEqual([
      { offset: 0, style: 'black' },
      { offset: 6, style: 'white' },
    ]);

    frame();
    // Second frame: `(0 - SPEED) % (dash + gap)` = `-0.4 % 12` = `-0.4`, and the pair's
    // second stroke is that plus the dash length, `5.6`. Reading the LAST value alone would
    // miss this entirely, because the loop leaves `offset + dashLength` behind.
    expect(strokes.slice(2)).toEqual([
      { offset: -0.4, style: 'black' },
      { offset: 5.6, style: 'white' },
    ]);
  });

  it('paints two strokes a half dash apart, black then white, so the border reads over any artwork', () => {
    storeState.selections = [polygon()];
    const { ctx, strokes } = setup();

    frame();

    // Exactly two per shape, in that order. A single solid stroke, or two at the SAME offset,
    // both leave the user with one colour instead of the classic black/white dash pair.
    expect(ctx.stroke).toHaveBeenCalledTimes(2);
    expect(strokes.map((stroke) => stroke.style)).toEqual(['black', 'white']);
    expect(strokes[1].offset - strokes[0].offset).toBe(6);
    // Both strokes address the SAME path, which is what makes the pair interleave into a dash
    // rather than painting two outlines.
    const paths = vi.mocked(ctx.stroke).mock.calls.map((call) => call[0]);
    expect(paths[0]).toBe(paths[1]);
  });

  it('keeps the dash cycle the modulus, so the offset cannot grow without bound at a scale below 1', () => {
    // At scale 1 the undivided cycle would also be 12, so the interior proves nothing: the
    // modulus only differs from the naive one when the divide is real. A 200x120 document in a
    // 50x30 box is a fit of 0.25, so the dash is 24 document px and the cycle is 48, and one
    // frame's step is `SPEED / 0.25` = 1.6. Under the undivided cycle the step would be 0.4
    // and the modulo a no-op.
    storeState.selections = [polygon()];
    const container = document.createElement('div');
    container.getBoundingClientRect = () => ({ width: 50, height: 30 }) as DOMRect;
    storeState.containerRef = { current: container };

    const { strokes } = setup();
    frame();

    expect(strokes).toEqual([
      { offset: 0, style: 'black' },
      { offset: 24, style: 'white' },
    ]);

    // Thirty frames at 1.6px each is exactly the 48px cycle, so the sixtieth stroke is the
    // first pair again — the modulus is what brings the walk home rather than letting it
    // drift without bound. The frame count is `cycle / step`, not a round twelve: at the
    // current `SPEED` a cycle is 30 frames, and a twelve-frame walk covers only 19.2 of the
    // 48 and would pass a broken modulus for many steps before it drifted far enough to be
    // noticed.
    //
    // Compared with a tolerance rather than exactly. `SPEED` is 0.4, which no double
    // represents, so thirty accumulations of it land on -2.13e-14 instead of 0 — the walk
    // does come home, and it comes home to the same place every cycle, which is the whole
    // claim. The tolerance is 1e-9 rather than a loose one on purpose: an UNDIVIDED
    // modulus drifts by 48 per cycle and is nowhere near it.
    for (let i = 0; i < 30; i++) frame();
    const cycled = strokes.slice(60);
    expect(cycled.map((stroke) => stroke.style)).toEqual(['black', 'white']);
    expect(cycled[0]?.offset).toBeCloseTo(strokes[0]?.offset ?? Number.NaN, 9);
    expect(cycled[1]?.offset).toBeCloseTo(strokes[1]?.offset ?? Number.NaN, 9);
  });

  it('marches a rectangular selection the way it marches a polygon', () => {
    // A RECTANGLE is marched like every other selection, and that is the deliberate contract
    // rather than an oversight. `useSelectionMarchingAnts` filters on `isActive` alone and
    // never inspects `geometry`, so every active selection is drawn — Adobe documents the
    // border as the universal display of a pixel selection, listing all nine marquee and
    // lasso tools as making selections, with none of them documented as producing a
    // different kind of border. This test used to assert the OPPOSITE (that a rectangle is
    // skipped), which pinned the pre-Adobe behaviour.
    //
    // What it does NOT prove, stated here because the old comment claimed the opposite:
    // nothing here detects a doubled border. `useRect` is not mounted in this test and paints
    // into a different canvas with a different context, so no assertion on this mock could
    // see it. That the marquee does not draw its own border at rest is `useRect`'s
    // `borderMode: 'while-dragging'` wiring, which belongs to the tool area's suite.
    storeState.selections = [
      polygon({
        geometry: 'rectangle',
        sourceTool: 'rectangular-selection',
        // Four corners, normalised into `pos` above — the shape
        // `createCommittedRectangleSelection` commits, and the only thing that makes this a
        // rectangle rather than the three-point triangle the default fixture describes.
        points: [
          { x: 0, y: 0 },
          { x: 30, y: 0 },
          { x: 30, y: 40 },
          { x: 0, y: 40 },
        ],
      }),
    ];
    const { ctx, strokes } = setup();

    frame();

    // The CONTOUR, not merely that something was stroked. Reading the coordinates back off
    // the recorded path is what puts the border in the right place; a count or a colour
    // would pass for a rectangle drawn anywhere.
    const path = vi.mocked(ctx.stroke).mock.calls[0][0] as Path2D;
    expect(path.moveTo).toHaveBeenCalledWith(10, 20);
    expect(path.lineTo).toHaveBeenCalledWith(40, 20);
    expect(path.lineTo).toHaveBeenCalledWith(40, 60);
    expect(path.lineTo).toHaveBeenCalledWith(10, 60);
    expect(path.closePath).toHaveBeenCalledOnce();

    // And the dashed pair on that ONE path, so the border interleaves instead of painting
    // two outlines.
    expect(ctx.stroke).toHaveBeenCalledTimes(2);
    expect(strokes.map((stroke) => stroke.style)).toEqual(['black', 'white']);
    const paths = vi.mocked(ctx.stroke).mock.calls.map((call) => call[0]);
    expect(paths[0]).toBe(paths[1]);
  });

  it('ignores a selection the store has deactivated', () => {
    storeState.selections = [polygon({ isActive: false })];
    const { ctx } = setup();

    expect(rafMocks.frames.size).toBe(0);
    frame();
    expect(ctx.stroke).not.toHaveBeenCalled();
  });

  it('paints nothing for a two-point polygon, because a contour needs three points to close', () => {
    // `shapePath` returns `null` below three points.
    // A two-point "polygon" is reachable: a lasso click sequence abandoned after two anchors
    // commits its points as they stand, and stroking the two of them as a degenerate outline
    // would draw a visible line along a selection that was never closed.
    storeState.selections = [
      polygon({
        points: [
          { x: 0, y: 0 },
          { x: 30, y: 0 },
        ],
      }),
    ];
    const { ctx } = setup();

    expect(rafMocks.frames.size).toBe(0);
    frame();
    expect(ctx.stroke).not.toHaveBeenCalled();
  });

  it('cancels the pending frame on unmount, so the loop cannot outlive the canvas it paints', () => {
    storeState.selections = [polygon()];
    const { ctx, unmount } = setup();

    frame();
    const pending = [...rafMocks.frames.keys()];
    expect(pending).toHaveLength(1);
    rafMocks.cancelAnimationFrame.mockClear();

    unmount();

    // The exact id, not merely "something was cancelled": a guard that passed `0` or a fresh
    // id would leave the live loop running against a canvas React has already detached.
    expect(rafMocks.cancelAnimationFrame).toHaveBeenCalledExactlyOnceWith(pending[0]);
    expect(rafMocks.frames.size).toBe(0);
    // The teardown clears the canvas it was holding, so a mount elsewhere does not inherit the
    // last frame's dashes.
    expect(ctx.clearRect).toHaveBeenCalledWith(0, 0, 200, 120);
  });

  it('stops the loop when the last polygon selection goes away, and clears what it painted', () => {
    storeState.selections = [polygon()];
    const { ctx, rerender, overlayRef } = setup();

    frame();
    expect(vi.mocked(ctx.stroke)).toHaveBeenCalledTimes(2);
    rafMocks.cancelAnimationFrame.mockClear();

    // The store empties and a re-render follows — the shape a Delete-selection or a tool switch
    // produces. The effect that starts the loop has to cancel it, not merely stop re-requesting:
    // a live loop with `shapesRef.current` empty calls `clearCanvas` and returns forever, which
    // is a full-canvas clear sixty times a second for a document with nothing selected.
    storeState.selections = [];
    act(() => {
      rerender(<SelectionMarchingAnts overlayRef={overlayRef} enabled />);
    });

    expect(rafMocks.cancelAnimationFrame).toHaveBeenCalledTimes(1);
    expect(rafMocks.frames.size).toBe(0);
    expect(ctx.clearRect).toHaveBeenCalled();
  });
});
