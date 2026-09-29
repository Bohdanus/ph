import { act, fireEvent, render } from '@testing-library/react';
import { useEffect } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isDocumentGestureOpen, readDocumentGesture, resetDocumentGestures } from '../../../hooks/document-gesture.ts';
import { DrawToolArea } from '../DrawToolArea.tsx';
import { drawLine } from '../../../util/draw.ts';

const createLayerFromToolMock = vi.hoisted(() => vi.fn());
const pointerState = vi.hoisted(() => ({
  isMouseDown: { current: false },
  activePointer: null as number | null | undefined,
}));
const storeState = vi.hoisted(
  (): { documentFrame: { x: number; y: number; width: number; height: number } | null } => ({
    documentFrame: null,
  })
);

vi.mock('../../../contexts/StoreContext.tsx', () => ({
  useStore: () => [
    {
      containerRef: { current: document.createElement('div') },
      totalSize: { width: 300, height: 200 },
      get documentFrame() {
        return storeState.documentFrame;
      },
    },
    vi.fn(),
  ],
}));

vi.mock('../../../contexts/useLayer.ts', () => ({
  useLayers: () => ({
    createLayerFromTool: createLayerFromToolMock,
  }),
}));

vi.mock('../../../contexts/useCurrentTool.tsx', () => ({
  useCurrentTool: () => ({
    toolArgs: {
      toolName: 'draw',
      alpha: 1,
      color: '#000000',
      penType: 'pen',
      lineWidth: 10,
      points: [],
    },
  }),
}));

/**
 * The pointer capture contract, faithfully: the first press claims the pointer and only that
 * pointer's move and release are valid. A mock that accepted every event would make "a foreign
 * pointer's release must not hand the document back" unobservable, which is one of the things the
 * gate below pins.
 *
 * The `button` check on the release mirrors `usePointerPosition.isPointerUpValid`, which now
 * refuses a non-primary release exactly as `isPointerDownValid` refuses a non-primary press. The
 * check used to be stricter than the real hook, which made a suite asserting a non-primary release
 * as ignored a guard for behaviour the product did not have; the hook was made symmetric instead.
 */
vi.mock('../../../hooks/usePointerPosition.ts', () => ({
  usePointerPosition: () => ({
    isPointerDownValid: vi.fn((event: PointerEvent) => {
      if (event.button !== 0) return false;
      if (pointerState.activePointer !== null) return false;
      pointerState.isMouseDown.current = true;
      pointerState.activePointer = event.pointerId;
      return true;
    }),
    isPointerMoveValid: vi.fn(() => pointerState.isMouseDown.current),
    isPointerUpValid: vi.fn((event: PointerEvent) => {
      if (event.button !== 0) return false;
      if (pointerState.activePointer !== event.pointerId) return false;
      pointerState.activePointer = null;
      pointerState.isMouseDown.current = false;
      return true;
    }),
    getLocalCoords: (event: PointerEvent) => ({ x: event.clientX, y: event.clientY }),
    isMouseDown: pointerState.isMouseDown,
  }),
}));

vi.mock('../../../util/draw.ts', async () => {
  const actual = await vi.importActual<typeof import('../../../util/draw.ts')>('../../../util/draw.ts');
  return {
    ...actual,
    drawLine: vi.fn(),
  };
});

const makeMockContext = () => ({
  clearRect: vi.fn(),
  beginPath: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  bezierCurveTo: vi.fn(),
  quadraticCurveTo: vi.fn(),
  stroke: vi.fn(),
  arc: vi.fn(),
  fill: vi.fn(),
  createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
  setLineDash: vi.fn(),
  fillRect: vi.fn(),
  strokeRect: vi.fn(),
  ellipse: vi.fn(),
  save: vi.fn(),
  restore: vi.fn(),
  closePath: vi.fn(),
  clip: vi.fn(),
  drawImage: vi.fn(),
  setTransform: vi.fn(),
  resetTransform: vi.fn(),
  // The overlay backing store, and deliberately NOT the store's `totalSize` (300x200) below. A
  // teardown that read a render-scope size would clear 300x200 and leave the right-hand and
  // bottom strips of the real backing store painted, so the two have to be distinguishable.
  canvas: Object.assign(document.createElement('canvas'), { width: 640, height: 480 }),
  strokeStyle: '#000000',
  fillStyle: '#000000',
  lineWidth: 1,
  lineCap: 'round',
  lineJoin: 'round',
  globalAlpha: 1,
  imageSmoothingEnabled: true,
  imageSmoothingQuality: 'low',
});

describe('DrawToolArea', () => {
  beforeEach(() => {
    createLayerFromToolMock.mockClear();
    vi.mocked(drawLine).mockClear();
    pointerState.isMouseDown.current = false;
    pointerState.activePointer = null;
    storeState.documentFrame = null;
  });

  it('normalizes a finished stroke to its bounding box instead of snapping it to the origin', () => {
    const overlayCtx = makeMockContext() as unknown as CanvasRenderingContext2D;
    const { container } = render(<DrawToolArea className="test-draw-area" overlayCtxRef={{ current: overlayCtx }} />);
    const toolArea = container.firstElementChild as HTMLDivElement;

    fireEvent.pointerDown(toolArea, { button: 0, clientX: 40, clientY: 50 });
    fireEvent.pointerMove(toolArea, { button: 0, clientX: 120, clientY: 80 });
    fireEvent.pointerMove(toolArea, { button: 0, clientX: 200, clientY: 110 });
    fireEvent.pointerUp(toolArea, { button: 0, clientX: 200, clientY: 110 });

    expect(createLayerFromToolMock).toHaveBeenCalledTimes(1);
    expect(createLayerFromToolMock).toHaveBeenCalledWith(
      expect.objectContaining({
        pos: { x: 30, y: 40, width: 180, height: 80 },
        args: expect.objectContaining({
          points: [
            { x: 10, y: 10 },
            { x: 90, y: 40 },
            { x: 170, y: 70 },
          ],
        }),
      })
    );
  });

  it('draws the preview while the pointer is dragging', () => {
    vi.useFakeTimers();
    const overlayCtx = makeMockContext() as unknown as CanvasRenderingContext2D;
    const { container } = render(<DrawToolArea className="test-draw-area" overlayCtxRef={{ current: overlayCtx }} />);
    const toolArea = container.firstElementChild as HTMLDivElement;

    fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 20 });
    fireEvent.pointerMove(toolArea, { button: 0, clientX: 30, clientY: 50 });
    act(() => {
      vi.advanceTimersByTime(20);
    });

    expect(drawLine).toHaveBeenCalled();
  });

  it('paints the single-point stroke on pointer down, before any frame has fired', () => {
    // The pointerdown repaint is deliberately synchronous: batch it and a click with no movement
    // leaves no visible mark at all, because nothing else would ever flush it.
    const overlayCtx = makeMockContext() as unknown as CanvasRenderingContext2D;
    const { container } = render(<DrawToolArea className="test-draw-area" overlayCtxRef={{ current: overlayCtx }} />);
    const toolArea = container.firstElementChild as HTMLDivElement;

    fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 20 });

    expect(drawLine).toHaveBeenCalledWith(
      expect.objectContaining({ args: expect.objectContaining({ points: [{ x: 10, y: 20 }] }) })
    );
  });

  it('coalesces a burst of pointer moves into exactly one overlay repaint', () => {
    // `drawLine` re-strokes the WHOLE accumulated path, so a repaint per pointer event costs more
    // the longer the stroke gets, and a pointer that carries several moves per display frame was
    // repainting several times for one visible frame.
    vi.useFakeTimers();
    const overlayCtx = makeMockContext() as unknown as CanvasRenderingContext2D;
    const { container } = render(<DrawToolArea className="test-draw-area" overlayCtxRef={{ current: overlayCtx }} />);
    const toolArea = container.firstElementChild as HTMLDivElement;

    fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 20 });
    expect(vi.mocked(drawLine)).toHaveBeenCalledTimes(1);

    act(() => {
      for (let step = 1; step <= 8; step += 1) {
        fireEvent.pointerMove(toolArea, { button: 0, clientX: 10 + step * 10, clientY: 20 + step * 5 });
      }
    });

    // Still one: the repaint is a frame, not an event.
    expect(vi.mocked(drawLine)).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(20);
    });

    expect(vi.mocked(drawLine)).toHaveBeenCalledTimes(2);
    // And the single repaint carried every accumulated point, not just the last one.
    expect(vi.mocked(drawLine).mock.lastCall?.[0]).toEqual(
      expect.objectContaining({
        args: expect.objectContaining({
          points: [
            { x: 10, y: 20 },
            { x: 20, y: 25 },
            { x: 30, y: 30 },
            { x: 40, y: 35 },
            { x: 50, y: 40 },
            { x: 60, y: 45 },
            { x: 70, y: 50 },
            { x: 80, y: 55 },
            { x: 90, y: 60 },
          ],
        }),
      })
    );
  });

  it('flushes the pending preview on pointer up instead of dropping it', () => {
    // The frame that would have painted the final point is the one pointer up cancels, so it has
    // to be painted synchronously before the commit. Cancelling without flushing loses the tail of
    // every stroke.
    vi.useFakeTimers();
    const overlayCtx = makeMockContext() as unknown as CanvasRenderingContext2D;
    const { container } = render(<DrawToolArea className="test-draw-area" overlayCtxRef={{ current: overlayCtx }} />);
    const toolArea = container.firstElementChild as HTMLDivElement;

    fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 20 });
    fireEvent.pointerMove(toolArea, { button: 0, clientX: 60, clientY: 40 });
    vi.mocked(drawLine).mockClear();

    fireEvent.pointerUp(toolArea, { button: 0, clientX: 60, clientY: 40 });

    expect(drawLine).toHaveBeenCalledWith(
      expect.objectContaining({
        args: expect.objectContaining({
          points: [
            { x: 10, y: 20 },
            { x: 60, y: 40 },
          ],
        }),
      })
    );
  });

  it('previews a second stroke after the first one was committed', () => {
    // The frame slot has to be released on pointer up. A ref that is cancelled but never nulled
    // stays non-null for the component's lifetime, and every later move then short-circuits: the
    // second stroke shows nothing until it is released.
    vi.useFakeTimers();
    const overlayCtx = makeMockContext() as unknown as CanvasRenderingContext2D;
    const { container } = render(<DrawToolArea className="test-draw-area" overlayCtxRef={{ current: overlayCtx }} />);
    const toolArea = container.firstElementChild as HTMLDivElement;

    fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 20 });
    fireEvent.pointerMove(toolArea, { button: 0, clientX: 60, clientY: 40 });
    fireEvent.pointerUp(toolArea, { button: 0, clientX: 60, clientY: 40 });

    vi.mocked(drawLine).mockClear();
    fireEvent.pointerDown(toolArea, { button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(toolArea, { button: 0, clientX: 140, clientY: 130 });
    vi.mocked(drawLine).mockClear();
    act(() => {
      vi.advanceTimersByTime(20);
    });

    expect(drawLine).toHaveBeenCalledWith(
      expect.objectContaining({
        args: expect.objectContaining({
          points: [
            { x: 100, y: 100 },
            { x: 140, y: 130 },
          ],
        }),
      })
    );
  });

  describe('a frame pending across an unmount', () => {
    // The overlay is ONE 2D context for the whole session, handed to whichever tool is active, and
    // it stays mounted while only its `display` is toggled. So a repaint that survives this
    // component's unmount does not draw into a dead canvas — it draws into the one the NEXT tool is
    // about to paint into, with a stroke this component has not finished.
    it('cancels the pending frame on unmount, so no stroke is painted afterwards', () => {
      vi.useFakeTimers();
      const overlayCtx = makeMockContext() as unknown as CanvasRenderingContext2D;
      const { container, unmount } = render(
        <DrawToolArea className="test-draw-area" overlayCtxRef={{ current: overlayCtx }} />
      );
      const toolArea = container.firstElementChild as HTMLDivElement;

      fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 20 });
      fireEvent.pointerMove(toolArea, { button: 0, clientX: 60, clientY: 40 });
      vi.mocked(drawLine).mockClear();
      // The restore has to run whatever the assertions do: a red assertion above the `finally`
      // would otherwise skip `mockRestore()` entirely, and that is the shape that matters — it is
      // exactly what a future edit to these assertions would do. This is the right shape on its
      // own terms, not because this file leaks without it.
      //
      // An earlier version of this comment claimed the opposite: that this file has no `afterEach`,
      // so the leak would persist for every following test. That was wrong, and it was worth
      // checking rather than restating. The global `afterEach` in `src/test/setup.ts:6` calls
      // `vi.useRealTimers()`, which re-installs a real `cancelAnimationFrame` and drops the spy.
      // Measured with a probe pair of tests here — install the spy, do not restore it, then observe
      // from the next test — `vi.isMockFunction(globalThis.cancelAnimationFrame)` is `false` and
      // the function is not the pre-spy reference either. So the leak IS currently masked here,
      // which is exactly why a comment asserting it was worth correcting: a false rationale is
      // worse than no rationale, because the next reader trusts it and stops checking.
      //
      // Same shape as `FreehandLasso.test.tsx:226-239`.
      const cancelSpy = vi.spyOn(globalThis, 'cancelAnimationFrame');

      try {
        unmount();
        act(() => {
          vi.advanceTimersByTime(20);
        });

        expect(cancelSpy).toHaveBeenCalled();
        expect(drawLine).not.toHaveBeenCalled();
      } finally {
        cancelSpy.mockRestore();
      }
    });

    it('leaves the frame slot released, so a later mount previews on the shared overlay again', () => {
      // The same shape as the "frozen for the component's lifetime" bug this file already pins for
      // pointer up: a slot that is left non-null makes every later move short-circuit. Here the
      // consequence is visible on the OTHER side of the unmount, because the queue is shared.
      vi.useFakeTimers();
      const overlayCtx = makeMockContext() as unknown as CanvasRenderingContext2D;
      const overlayCtxRef = { current: overlayCtx };
      const first = render(<DrawToolArea className="test-draw-area" overlayCtxRef={overlayCtxRef} />);
      const firstArea = first.container.firstElementChild as HTMLDivElement;

      fireEvent.pointerDown(firstArea, { button: 0, clientX: 10, clientY: 20 });
      fireEvent.pointerMove(firstArea, { button: 0, clientX: 60, clientY: 40 });
      first.unmount();
      // The pointer double is module-level and only a release the validator accepts clears it,
      // which an unmount is not: switching tools mid-drag aborts the gesture, and the next press has
      // to be a first press or the second area's stroke is never started.
      pointerState.activePointer = null;
      pointerState.isMouseDown.current = false;

      // A fresh area over the same context: what switching tools mid-drag actually is.
      const second = render(<DrawToolArea className="test-draw-area" overlayCtxRef={overlayCtxRef} />);
      const secondArea = second.container.firstElementChild as HTMLDivElement;
      fireEvent.pointerDown(secondArea, { button: 0, clientX: 100, clientY: 100 });
      fireEvent.pointerMove(secondArea, { button: 0, clientX: 140, clientY: 130 });
      vi.mocked(drawLine).mockClear();
      act(() => {
        vi.advanceTimersByTime(20);
      });

      // One paint, and it is the new stroke's. A repaint carried over from the unmounted area
      // lands on the same context and reads here as a second, wrong repaint.
      expect(vi.mocked(drawLine)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(drawLine).mock.lastCall?.[0]).toEqual(
        expect.objectContaining({
          args: expect.objectContaining({
            points: [
              { x: 100, y: 100 },
              { x: 140, y: 130 },
            ],
          }),
        })
      );
      second.unmount();
    });
  });

  it('brackets the stroke so setupDrawCtx cannot leave its alpha on the shared overlay', () => {
    // The overlay is ONE 2D context for the whole session and every tool area is handed the same
    // object, so a writer that leaves `globalAlpha` behind dictates the alpha of the next tool. The
    // bracket is the fix; a `ctx.globalAlpha = 1` at the top of the writer is not, and would also
    // flatten the committed layer.
    const overlayCtx = makeMockContext() as unknown as CanvasRenderingContext2D;
    const { container } = render(<DrawToolArea className="test-draw-area" overlayCtxRef={{ current: overlayCtx }} />);
    const toolArea = container.firstElementChild as HTMLDivElement;

    fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 20 });

    const saves = vi.mocked(overlayCtx.save).mock.invocationCallOrder;
    const restores = vi.mocked(overlayCtx.restore).mock.invocationCallOrder;
    expect(saves).toHaveLength(1);
    expect(restores).toHaveLength(1);
    expect(saves[0]).toBeLessThan(restores[0]);
  });

  it('does not grow the save stack across a long stroke', () => {
    // Bracketing per paint is what makes the bracket leak-proof: a thousand frames leave the
    // context exactly where the session started, and no pending save level can outlive the
    // gesture whatever the pointer does.
    vi.useFakeTimers();
    const overlayCtx = makeMockContext() as unknown as CanvasRenderingContext2D;
    const { container } = render(<DrawToolArea className="test-draw-area" overlayCtxRef={{ current: overlayCtx }} />);
    const toolArea = container.firstElementChild as HTMLDivElement;

    fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 20 });
    for (let step = 1; step <= 20; step += 1) {
      act(() => {
        fireEvent.pointerMove(toolArea, { button: 0, clientX: 10 + step, clientY: 20 + step });
        vi.advanceTimersByTime(20);
      });
    }

    expect(vi.mocked(overlayCtx.save)).toHaveBeenCalledTimes(21);
    expect(vi.mocked(overlayCtx.restore)).toHaveBeenCalledTimes(21);
  });

  it('ignores a stroke that starts with a non-primary mouse button', () => {
    const overlayCtx = makeMockContext() as unknown as CanvasRenderingContext2D;
    const { container } = render(<DrawToolArea className="test-draw-area" overlayCtxRef={{ current: overlayCtx }} />);
    const toolArea = container.firstElementChild as HTMLDivElement;

    fireEvent.pointerDown(toolArea, { button: 2, clientX: 10, clientY: 20 });
    fireEvent.pointerMove(toolArea, { button: 2, clientX: 30, clientY: 50 });

    expect(drawLine).not.toHaveBeenCalled();
  });

  it('ignores pointer movement before the button goes down', () => {
    const overlayCtx = makeMockContext() as unknown as CanvasRenderingContext2D;
    const { container } = render(<DrawToolArea className="test-draw-area" overlayCtxRef={{ current: overlayCtx }} />);
    const toolArea = container.firstElementChild as HTMLDivElement;

    fireEvent.pointerMove(toolArea, { button: 0, clientX: 30, clientY: 50 });

    expect(drawLine).not.toHaveBeenCalled();
  });

  it('shifts the committed bounding box by the document frame origin', () => {
    storeState.documentFrame = { x: 12, y: 8, width: 300, height: 200 };
    const overlayCtx = makeMockContext() as unknown as CanvasRenderingContext2D;
    const { container } = render(<DrawToolArea className="test-draw-area" overlayCtxRef={{ current: overlayCtx }} />);
    const toolArea = container.firstElementChild as HTMLDivElement;

    fireEvent.pointerDown(toolArea, { button: 0, clientX: 40, clientY: 50 });
    fireEvent.pointerMove(toolArea, { button: 0, clientX: 200, clientY: 110 });
    fireEvent.pointerUp(toolArea, { button: 0, clientX: 200, clientY: 110 });

    expect(createLayerFromToolMock).toHaveBeenCalledWith(
      expect.objectContaining({
        pos: { x: 42, y: 48, width: 180, height: 80 },
        args: expect.objectContaining({
          points: [
            { x: 10, y: 10 },
            { x: 170, y: 70 },
          ],
        }),
      })
    );
  });

  it('clears the overlay once the stroke has been committed', () => {
    const overlayCtx = makeMockContext() as unknown as CanvasRenderingContext2D;
    const { container } = render(<DrawToolArea className="test-draw-area" overlayCtxRef={{ current: overlayCtx }} />);
    const toolArea = container.firstElementChild as HTMLDivElement;

    fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 20 });
    fireEvent.pointerMove(toolArea, { button: 0, clientX: 30, clientY: 50 });
    vi.mocked(overlayCtx.clearRect).mockClear();

    fireEvent.pointerUp(toolArea, { button: 0, clientX: 30, clientY: 50 });

    expect(overlayCtx.clearRect).toHaveBeenCalledWith(0, 0, 300, 200);
  });

  it('starts a fresh preview after a stroke was committed', () => {
    const overlayCtx = makeMockContext() as unknown as CanvasRenderingContext2D;
    const { container } = render(<DrawToolArea className="test-draw-area" overlayCtxRef={{ current: overlayCtx }} />);
    const toolArea = container.firstElementChild as HTMLDivElement;

    fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 20 });
    fireEvent.pointerMove(toolArea, { button: 0, clientX: 30, clientY: 50 });
    fireEvent.pointerUp(toolArea, { button: 0, clientX: 30, clientY: 50 });

    vi.mocked(drawLine).mockClear();
    fireEvent.pointerDown(toolArea, { button: 0, clientX: 100, clientY: 100 });

    expect(drawLine).toHaveBeenCalledWith(
      expect.objectContaining({ args: expect.objectContaining({ points: [{ x: 100, y: 100 }] }) })
    );
  });

  it('renders a div carrying the supplied className and the draw cursor', () => {
    const overlayCtx = makeMockContext() as unknown as CanvasRenderingContext2D;
    const { container } = render(<DrawToolArea className="test-draw-area" overlayCtxRef={{ current: overlayCtx }} />);

    expect(container.firstElementChild).toHaveClass('test-draw-area', 'cursor-draw');
  });

  describe('document gesture gate', () => {
    beforeEach(() => {
      // The slot is module-level, so a leaked claim would refuse every later claim in this file
      // and read as a dozen unrelated failures.
      resetDocumentGestures();
    });

    const renderArea = () => {
      const overlayCtx = makeMockContext() as unknown as CanvasRenderingContext2D;
      const view = render(<DrawToolArea className="test-draw-area" overlayCtxRef={{ current: overlayCtx }} />);
      return { view, toolArea: view.container.firstElementChild as HTMLDivElement };
    };

    it('claims the document for a brush stroke and releases it on the release', () => {
      // A stroke commits from `createLayerFromTool` on release, so a document-mutating shortcut
      // pressed mid-stroke mutates the document behind the gesture's back: an undo replaces
      // `selections` from the SAME history array, so the pending commit then truncates the redo
      // tail with no other symptom.
      const { toolArea } = renderArea();

      fireEvent.pointerDown(toolArea, { button: 0, pointerId: 7, clientX: 10, clientY: 20 });

      expect(isDocumentGestureOpen()).toBe(true);
      expect(readDocumentGesture()).toEqual({ kind: 'brush-stroke', pointerId: 7 });

      fireEvent.pointerUp(toolArea, { button: 0, pointerId: 7, clientX: 60, clientY: 40 });

      // Released before the commit, so the keyboard is open again for the very next keystroke and
      // this gesture's own entry is the one an undo would target.
      expect(createLayerFromToolMock).toHaveBeenCalledTimes(1);
      expect(isDocumentGestureOpen()).toBe(false);
    });

    it('releases the claim before the commit path, so a release that commits nothing still frees the keyboard', () => {
      // The release is the first statement inside the `isPointerUpValid` branch, which is what
      // covers the early returns in the commit path.
      const { toolArea } = renderArea();

      fireEvent.pointerDown(toolArea, { button: 0, pointerId: 7, clientX: 10, clientY: 20 });
      expect(isDocumentGestureOpen()).toBe(true);

      fireEvent.pointerUp(toolArea, { button: 0, pointerId: 7, clientX: 10, clientY: 20 });

      expect(isDocumentGestureOpen()).toBe(false);
    });

    it('does not let a foreign pointer release the claim it never took', () => {
      const { toolArea } = renderArea();

      fireEvent.pointerDown(toolArea, { button: 0, pointerId: 7, clientX: 10, clientY: 20 });
      expect(isDocumentGestureOpen()).toBe(true);

      // A second surface's release arriving here, or a second pointer on the same one. The claim is
      // released inside the `isPointerUpValid` branch, so a release the validator refuses cannot hand
      // the document back on the first pointer's behalf.
      fireEvent.pointerUp(toolArea, { button: 0, pointerId: 99, clientX: 60, clientY: 40 });

      expect(createLayerFromToolMock).not.toHaveBeenCalled();
      expect(isDocumentGestureOpen()).toBe(true);
    });

    it('releases the claim on a pointer cancel, which is the abort route', () => {
      const { toolArea } = renderArea();

      fireEvent.pointerDown(toolArea, { button: 0, pointerId: 7, clientX: 10, clientY: 20 });
      expect(isDocumentGestureOpen()).toBe(true);

      fireEvent.pointerCancel(toolArea, { button: 0, pointerId: 7 });

      expect(isDocumentGestureOpen()).toBe(false);
    });

    it('releases the claim on unmount, so a gesture that dies mid-stroke cannot leave the keyboard dead', () => {
      const { view, toolArea } = renderArea();

      fireEvent.pointerDown(toolArea, { button: 0, pointerId: 7, clientX: 10, clientY: 20 });
      expect(isDocumentGestureOpen()).toBe(true);

      view.unmount();

      expect(isDocumentGestureOpen()).toBe(false);
    });

    it('claims nothing for a press the pointer validator refuses', () => {
      // `isPointerDownValid` has already refused a non-primary button and a second pointer, and the
      // claim is taken after it, so a refused press starts no gesture to wait on.
      const { toolArea } = renderArea();

      fireEvent.pointerDown(toolArea, { button: 2, pointerId: 7, clientX: 10, clientY: 20 });

      expect(isDocumentGestureOpen()).toBe(false);
    });
  });

  /**
   * The overlay canvas is shared, long-lived and only ever `display`-toggled
   * (`Main.tsx:239-284`), and toggling `display` never touches a backing store. The pointer-up clear
   * in `handlePointerUp` covers a committed stroke, so what it cannot cover is the ordinary way a
   * stroke ends: the user switching tools with the button still down. Nothing else in the gesture
   * clears the overlay, so the last previewed stroke stayed painted over the next tool's document.
   */
  describe('overlay teardown', () => {
    it('clears the whole backing store on unmount, so an abandoned stroke cannot survive a tool switch', () => {
      const overlayCtx = makeMockContext() as unknown as CanvasRenderingContext2D;
      const { container, unmount } = render(
        <DrawToolArea className="test-draw-area" overlayCtxRef={{ current: overlayCtx }} />
      );
      const toolArea = container.firstElementChild as HTMLDivElement;

      // The gesture is abandoned mid-drag: the pointer-up clear never runs for it.
      fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 20 });
      fireEvent.pointerMove(toolArea, { button: 0, clientX: 30, clientY: 50 });
      expect(drawLine).toHaveBeenCalled();

      vi.mocked(overlayCtx.clearRect).mockClear();
      unmount();

      // 640x480 is the mock CANVAS, and the store's `totalSize` is 300x200: this asserts the
      // backing store was read at call time rather than a render-scope size captured earlier, which
      // would have frozen the first render's value and under-cleared after a document resize.
      expect(overlayCtx.clearRect).toHaveBeenCalledExactlyOnceWith(0, 0, 640, 480);
    });

    it('drops a queued preview frame so it cannot repaint over the teardown clear', () => {
      vi.useFakeTimers();
      const overlayCtx = makeMockContext() as unknown as CanvasRenderingContext2D;
      const { container, unmount } = render(
        <DrawToolArea className="test-draw-area" overlayCtxRef={{ current: overlayCtx }} />
      );
      const toolArea = container.firstElementChild as HTMLDivElement;

      fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 20 });
      fireEvent.pointerMove(toolArea, { button: 0, clientX: 30, clientY: 50 });
      // A frame is queued and NOT fired, so the preview is still pending.
      vi.mocked(drawLine).mockClear();
      vi.mocked(overlayCtx.clearRect).mockClear();

      unmount();
      act(() => {
        vi.advanceTimersByTime(32);
      });

      // Cancel FIRST, then clear: a frame that survived would have repainted after the clear.
      expect(drawLine).not.toHaveBeenCalled();
      expect(overlayCtx.clearRect).toHaveBeenCalledExactlyOnceWith(0, 0, 640, 480);
    });

    it('clears nothing on mount, so the clear is unambiguously a teardown', () => {
      const overlayCtx = makeMockContext() as unknown as CanvasRenderingContext2D;
      render(<DrawToolArea className="test-draw-area" overlayCtxRef={{ current: overlayCtx }} />);

      expect(overlayCtx.clearRect).not.toHaveBeenCalled();
    });

    it("does not wipe the incoming area's mount paint, because destroys run before creates", () => {
      // The safety argument for clearing a SHARED canvas on unmount is an ordering claim, so it is
      // pinned rather than asserted in prose: exactly one tool area is mounted at a time
      // (`Main.tsx:220-288` picks a single `EventHandler`), and React runs every passive destroy
      // before every passive create. A tool area that paints in a mount effect —
      // `MagicWandToolArea`, `EllipticalSelectionToolArea`, `QuickSelectionToolArea` — therefore
      // paints AFTER this area's teardown clear, not before it. Flip the order in React and this
      // test fails, which is the signal that the clear is no longer safe.
      const order: string[] = [];
      const overlayCtx = makeMockContext() as unknown as CanvasRenderingContext2D;
      vi.mocked(overlayCtx.clearRect).mockImplementation(() => {
        order.push('teardown-clear');
      });
      vi.mocked(overlayCtx.fillRect).mockImplementation(() => {
        order.push('incoming-mount-paint');
      });

      function IncomingArea() {
        const ctx = overlayCtx;
        useEffect(() => {
          ctx.fillRect(0, 0, 640, 480);
        }, [ctx]);
        return <div data-testid="incoming-area" />;
      }

      function Host({ phase }: { phase: 'outgoing' | 'incoming' }) {
        return phase === 'outgoing' ? (
          <DrawToolArea className="test-draw-area" overlayCtxRef={{ current: overlayCtx }} />
        ) : (
          <IncomingArea />
        );
      }

      const { rerender } = render(<Host phase="outgoing" />);
      rerender(<Host phase="incoming" />);

      expect(overlayCtx.clearRect).toHaveBeenCalledExactlyOnceWith(0, 0, 640, 480);
      expect(order).toEqual(['teardown-clear', 'incoming-mount-paint']);
    });
  });
});
