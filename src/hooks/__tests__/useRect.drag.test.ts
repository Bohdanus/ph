import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { CURSOR_MAP, HANDLE_SIZE } from '../../util/constants.ts';
import { createMockLayer } from '@/__tests__/fixtures/layer.ts';
import { createPointerEvent } from '@/__tests__/fixtures/pointer.ts';
import { createMockCanvasContext } from '../../test/setup.ts';
import { useRect, type UseRectProps } from '../useRect.ts';

/**
 * Interaction coverage for `useRect`.
 *
 * Unlike `useRect.test.ts` (smoke level, whose `util/rect` and `util/constants`
 * mocks never resolve and are therefore inert), this file drives the hook the
 * way the editor does: real pointer events in, real `sortRect`/`trimRect`
 * geometry, real `HANDLE_SIZE`/`CURSOR_MAP`, and only `usePointerPosition`
 * replaced by a controllable double (the drag guards it owns are asserted in
 * `usePointerPosition.test.ts`).
 */

const RECT = { x1: 100, y1: 100, x2: 300, y2: 250 };
const RATIO_RECT = { x1: 100, y1: 100, x2: 300, y2: 200 };
/** Already 1:1, so the aspect-ratio patch on mount leaves it untouched. */
const SQUARE_RECT = { x1: 100, y1: 100, x2: 300, y2: 300 };

const pointer = vi.hoisted(() => {
  const state = {
    downValid: true,
    moveValid: true,
    upValid: true,
    onResize: null as null | (() => void),
  };

  const data = {
    isPointerDownValid: vi.fn(() => state.downValid),
    isPointerMoveValid: vi.fn(() => state.moveValid),
    isPointerUpValid: vi.fn(() => state.upValid),
    getLocalCoords: vi.fn((event: { clientX: number; clientY: number }) => ({
      x: event.clientX,
      y: event.clientY,
    })),
    isMouseDown: { current: false },
    dimensionsRef: { current: { scale: 1 } },
    pointerIdRef: { current: null as number | null },
  };

  return {
    state,
    data,
    usePointerPosition: vi.fn((props: { onResize?: () => void }) => {
      state.onResize = props.onResize ?? null;
      return data;
    }),
  };
});

vi.mock('../usePointerPosition.ts', () => ({ usePointerPosition: pointer.usePointerPosition }));

type PointerFactory = (x: number, y: number, overrides?: Record<string, unknown>) => ReactPointerEvent<HTMLDivElement>;

function setup(props: Partial<UseRectProps> = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = 800;
  canvas.height = 600;
  const ctx = createMockCanvasContext(canvas);
  vi.spyOn(canvas, 'getContext').mockReturnValue(ctx);

  const target = document.createElement('div');
  document.body.append(target);

  const initialProps: UseRectProps = {
    imageSize: { width: 800, height: 600 },
    initialRect: null,
    hideBlend: false,
    isMoveTool: false,
    containerRef: { current: document.createElement('div') },
    overlayRef: { current: canvas },
    onRepaint: vi.fn(),
    onChange: vi.fn(),
    onChangeEnd: vi.fn(),
    ...props,
  };

  const hook = renderHook((current: UseRectProps) => useRect(current), { initialProps });

  const event: PointerFactory = (x, y, overrides = {}) =>
    createPointerEvent<HTMLDivElement>({ target, clientX: x, clientY: y, ...overrides });

  const flushFrame = () =>
    act(() => {
      vi.advanceTimersByTime(32);
    });

  return { ...hook, ctx, canvas, target, event, flushFrame, initialProps };
}

type DragApi = {
  result: { current: ReturnType<typeof useRect> };
  event: PointerFactory;
};

function startDrag(api: DragApi, from: { x: number; y: number }, layer?: ReturnType<typeof createMockLayer>) {
  act(() => {
    api.result.current.pointerHandlers.onPointerDown(api.event(from.x, from.y), layer);
  });
  pointer.data.isMouseDown.current = true;
}

function resetPointerMock() {
  vi.useFakeTimers();
  pointer.state.downValid = true;
  pointer.state.moveValid = true;
  pointer.state.upValid = true;
  pointer.state.onResize = null;
  pointer.data.isMouseDown.current = false;
  pointer.data.dimensionsRef.current.scale = 1;
  vi.clearAllMocks();
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('useRect mask drawing', () => {
  beforeEach(resetPointerMock);

  it('paints the initial selection, its blend cut-out, and the four handles', () => {
    const { ctx } = setup({ initialRect: RECT });

    expect(ctx.clearRect).toHaveBeenCalledWith(0, 0, 800, 600);
    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 800, 600);
    expect(ctx.clearRect).toHaveBeenCalledWith(100, 100, 200, 150);
    expect(ctx.strokeRect).toHaveBeenCalledWith(100, 100, 200, 150);
    expect(ctx.setLineDash).toHaveBeenCalledWith([5, 5]);
    expect(ctx.lineWidth).toBe(2);

    const handle = HANDLE_SIZE;
    const half = handle / 2;
    expect(ctx.fillRect).toHaveBeenCalledWith(100 - half, 100 - half, handle, handle);
    expect(ctx.fillRect).toHaveBeenCalledWith(300 - half, 100 - half, handle, handle);
    expect(ctx.fillRect).toHaveBeenCalledWith(100 - half, 250 - half, handle, handle);
    expect(ctx.fillRect).toHaveBeenCalledWith(300 - half, 250 - half, handle, handle);
  });

  /**
   * `handlesOutside` is the Type tool's alone, and the default above is Adobe's: a grip straddling
   * the corner is grabbable across its whole width, because `edgeAtPoint` takes
   * `HANDLE_SIZE / scale / 2` either side of the corner either way. Painting the grip wholly outside
   * left the outer half of every visible handle unclickable on the marquee, the crop and the Move
   * tool, and `e2e/select-move.spec.ts` — `stretches selected line` — caught exactly that.
   */
  it('paints the handles whole outside the rect for a consumer that opts in', () => {
    const { ctx } = setup({ initialRect: RECT, handlesOutside: true });

    const handle = HANDLE_SIZE;
    expect(ctx.fillRect).toHaveBeenCalledWith(100 - handle, 100 - handle, handle, handle);
    expect(ctx.fillRect).toHaveBeenCalledWith(300, 100 - handle, handle, handle);
    expect(ctx.fillRect).toHaveBeenCalledWith(100 - handle, 250, handle, handle);
    expect(ctx.fillRect).toHaveBeenCalledWith(300, 250, handle, handle);
  });

  it('reports the sorted rect to onRepaint but not to onChange while idle', () => {
    const onRepaint = vi.fn();
    const onChange = vi.fn();
    setup({ initialRect: { x1: 300, y1: 250, x2: 100, y2: 100 }, onRepaint, onChange });

    expect(onRepaint).toHaveBeenCalledWith(RECT);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('clears the overlay and repaints nothing when there is no selection', () => {
    const onRepaint = vi.fn();
    const { ctx, result } = setup({ onRepaint });

    // Nothing is drawn on mount: there is no rect to draw.
    expect(ctx.clearRect).not.toHaveBeenCalled();

    act(() => {
      result.current.rectHandles.redraw();
    });

    expect(ctx.clearRect).toHaveBeenCalledExactlyOnceWith(0, 0, 800, 600);
    expect(ctx.strokeRect).not.toHaveBeenCalled();
    expect(onRepaint).not.toHaveBeenCalled();
  });

  it('skips the dimming overlay when hideBlend is set', () => {
    const { ctx } = setup({ initialRect: RECT, hideBlend: true });

    // Only the four handles are filled; the full-canvas dimming fill is skipped.
    expect(ctx.fillRect).not.toHaveBeenCalledWith(0, 0, 800, 600);
    // The selection cut-out is only performed for the blend, so one clearRect remains.
    expect(ctx.clearRect).toHaveBeenCalledExactlyOnceWith(0, 0, 800, 600);
    expect(ctx.strokeRect).toHaveBeenCalledWith(100, 100, 200, 150);
  });

  it('draws nothing when the overlay canvas has no 2d context', () => {
    const onRepaint = vi.fn();
    const canvas = document.createElement('canvas');
    vi.spyOn(canvas, 'getContext').mockReturnValue(null);

    expect(() =>
      renderHook(() =>
        useRect({
          imageSize: { width: 800, height: 600 },
          initialRect: RECT,
          containerRef: { current: document.createElement('div') },
          overlayRef: { current: canvas },
          onRepaint,
          onChangeEnd: vi.fn(),
        })
      )
    ).not.toThrow();

    expect(onRepaint).not.toHaveBeenCalled();
  });

  it('repaints through the pointer-position resize callback', () => {
    const onRepaint = vi.fn();
    setup({ initialRect: RECT, onRepaint });
    onRepaint.mockClear();

    expect(pointer.state.onResize).toBeTypeOf('function');
    act(() => {
      pointer.state.onResize?.();
    });

    expect(onRepaint).toHaveBeenCalledWith(RECT);
  });

  it('re-paints only when the initial rect prop actually changes', () => {
    const onRepaint = vi.fn();
    const { rerender, initialProps } = setup({ initialRect: RECT, onRepaint });
    onRepaint.mockClear();

    rerender({ ...initialProps });
    expect(onRepaint).not.toHaveBeenCalled();

    rerender({ ...initialProps, initialRect: { x1: 10, y1: 20, x2: 110, y2: 120 } });
    expect(onRepaint).toHaveBeenCalledWith({ x1: 10, y1: 20, x2: 110, y2: 120 });
  });

  it('clears the painted selection when the initial rect prop becomes null', () => {
    const onRepaint = vi.fn();
    const { ctx, rerender, initialProps } = setup({ initialRect: RECT, onRepaint });
    onRepaint.mockClear();
    vi.mocked(ctx.clearRect).mockClear();

    rerender({ ...initialProps, initialRect: null });

    expect(onRepaint).not.toHaveBeenCalled();
    expect(ctx.clearRect).toHaveBeenCalledExactlyOnceWith(0, 0, 800, 600);
  });

  it('widens an inverted initial rect to the requested aspect ratio', () => {
    const onRepaint = vi.fn();
    setup({ aspectRatio: 1, initialRect: { x1: 300, y1: 100, x2: 100, y2: 200 }, onRepaint });

    // height 100 at ratio 1 => width 100, centred on the original 200px span.
    expect(onRepaint).toHaveBeenCalledWith({ x1: 150, y1: 100, x2: 250, y2: 200 });
  });

  it('scales the dash and the handles by the container scale', () => {
    pointer.data.dimensionsRef.current.scale = 2;
    const { ctx } = setup({ initialRect: RECT });

    expect(ctx.setLineDash).toHaveBeenCalledWith([2.5, 2.5]);
    expect(ctx.lineWidth).toBe(1);
    const handle = HANDLE_SIZE / 2;
    expect(ctx.fillRect).toHaveBeenCalledWith(100 - handle / 2, 100 - handle / 2, handle, handle);
  });
});

/**
 * The overlay canvas is shared and long-lived: `Main.tsx:239-284` renders both overlay canvases
 * unconditionally and only toggles `display`, which never touches a backing store. So an area that
 * goes away has to clear the canvas itself.
 *
 * It cannot lean on the effect at `useRect.ts:58-70` seeing `initialRect` turn null. `goToTool`
 * (`goToTool()`) appends the selection clear and dispatches `SET_TOOL_NAME` from
 * one function body, React batches them, and the marquee's component unmounts in the same commit
 * that nulls the selection — and an unmounted component's effects do not run. That is what left the
 * `#007bff` outline, the four handles and the `rgba(0, 0, 0, 0.7)` blend on the next tool's
 * document.
 *
 * Every case here passes an `imageSize` that is NOT the canvas's size, so an assertion that the
 * clear covers the backing store also fails a clear that read the render-scope `imageSize` — the
 * mistake a cleanup closing over it makes, freezing the first render's value and under-clearing
 * after a document resize.
 */
describe('useRect overlay teardown', () => {
  beforeEach(resetPointerMock);

  it('clears the whole backing store on unmount, so a marquee cannot outlive the tool switch', () => {
    const { ctx, unmount } = setup({ imageSize: { width: 320, height: 240 }, initialRect: RECT });
    // The mount paint is cleared from the record so the assertion can only be about the teardown.
    vi.mocked(ctx.clearRect).mockClear();

    unmount();

    // 800x600 is the CANVAS, and `imageSize` above is 320x240.
    expect(ctx.clearRect).toHaveBeenCalledExactlyOnceWith(0, 0, 800, 600);
  });

  it('clears the whole backing store on unmount even when nothing was ever painted', () => {
    // Unconditional on purpose. A teardown gated on "did this instance paint something" is a
    // landmine, and the abandoned-drag case is precisely the one where the content was painted by
    // a frame that never became `initialRect`.
    const { ctx, unmount } = setup({ imageSize: { width: 320, height: 240 }, initialRect: null });
    expect(ctx.clearRect).not.toHaveBeenCalled();

    unmount();

    expect(ctx.clearRect).toHaveBeenCalledExactlyOnceWith(0, 0, 800, 600);
  });

  it('drops a queued repaint rather than letting it repaint the marquee over the teardown clear', () => {
    const { ctx, result, event, flushFrame, unmount } = setup({
      imageSize: { width: 320, height: 240 },
      initialRect: RECT,
    });
    pointer.data.isMouseDown.current = true;
    act(() => {
      result.current.pointerHandlers.onPointerMove(event(200, 175));
    });
    // A frame is queued and not fired, so the repaint is still pending.
    vi.mocked(ctx.clearRect).mockClear();
    vi.mocked(ctx.strokeRect).mockClear();

    unmount();
    flushFrame();

    // Cancel FIRST, then clear: a frame that survived would have repainted after the clear.
    expect(ctx.strokeRect).not.toHaveBeenCalled();
    expect(ctx.clearRect).toHaveBeenCalledExactlyOnceWith(0, 0, 800, 600);
  });

  it('does not throw on unmount when the overlay canvas has no 2d context', () => {
    // The supported null-context state the guard exists for. Without it the teardown throws while
    // React is already unmounting, which is a crash the user cannot act on.
    const canvas = document.createElement('canvas');
    vi.spyOn(canvas, 'getContext').mockReturnValue(null);

    const { unmount } = renderHook(() =>
      useRect({
        imageSize: { width: 800, height: 600 },
        initialRect: RECT,
        containerRef: { current: document.createElement('div') },
        overlayRef: { current: canvas },
        onChangeEnd: vi.fn(),
      })
    );

    expect(() => unmount()).not.toThrow();
  });
});

describe('useRect handle detection', () => {
  beforeEach(resetPointerMock);

  it.each([
    ['top-left corner', 100, 100],
    ['top-right corner', 300, 100],
    ['bottom-left corner', 100, 250],
    ['bottom-right corner', 300, 250],
  ])('reports a handle click for the %s', (_name, x, y) => {
    const { result, event, target } = setup({ initialRect: RECT });

    let handled: boolean | undefined;
    act(() => {
      handled = result.current.pointerHandlers.onPointerDown(event(x as number, y as number));
    });

    expect(handled).toBe(true);
    expect(target.style.cursor).not.toBe('');
  });

  it('grabs the selection interior instead of starting a new selection', () => {
    const { result, event } = setup({ initialRect: RECT });

    let handled: boolean | undefined;
    act(() => {
      handled = result.current.pointerHandlers.onPointerDown(event(200, 175));
    });

    // An interior click is reported as a handle grab so callers can tell the
    // difference from a click on empty canvas (which starts a new selection).
    expect(handled).toBe(true);
  });

  it.each([
    ['top-left', 100, 100],
    ['top-right', 300, 100],
    ['bottom-left', 100, 250],
    ['bottom-right', 300, 250],
    ['top', 200, 100],
    ['right', 300, 175],
    ['bottom', 200, 250],
    ['left', 100, 175],
    ['inside', 200, 175],
  ] as const)('hovers the %s edge and applies its cursor', (edge, x, y) => {
    const { result, event, target } = setup({ initialRect: RECT });

    let hovered: boolean | undefined;
    act(() => {
      hovered = result.current.pointerHandlers.onPointerMove(event(x, y));
    });

    expect(hovered).toBe(true);
    expect(target.style.cursor).toBe(CURSOR_MAP[edge]);
  });

  it('clears the cursor when hovering outside the selection', () => {
    const { result, event, target } = setup({ initialRect: RECT });

    let hovered: boolean | undefined;
    act(() => {
      hovered = result.current.pointerHandlers.onPointerMove(event(500, 400));
    });

    expect(hovered).toBe(false);
    expect(target.style.cursor).toBe('');
  });

  it('halves the hit radius when the container is scaled', () => {
    pointer.data.dimensionsRef.current.scale = 2;
    const { result, event, target } = setup({ initialRect: RECT });

    // h2 = HANDLE_SIZE / scale / 2 = 3, so 103px is still on the left edge...
    act(() => {
      result.current.pointerHandlers.onPointerMove(event(103, 175));
    });
    expect(target.style.cursor).toBe(CURSOR_MAP.left);

    // ...while a point outside the rect has no edge at all.
    act(() => {
      result.current.pointerHandlers.onPointerMove(event(104, 400));
    });
    expect(target.style.cursor).toBe('');
  });

  it('rejects a pointer down that the capture layer refused', () => {
    pointer.state.downValid = false;
    const { result, event, target } = setup({ initialRect: RECT });

    let handled: boolean | undefined;
    act(() => {
      handled = result.current.pointerHandlers.onPointerDown(event(100, 100));
    });

    expect(handled).toBe(false);
    expect(target.style.cursor).toBe('');
    // The guard rejects before the coordinates are even read.
    expect(pointer.data.getLocalCoords).not.toHaveBeenCalled();
  });
});

describe('useRect drag geometry', () => {
  beforeEach(resetPointerMock);

  it('creates a free selection from a drag when no rect exists yet', () => {
    const onChange = vi.fn();
    const { result, event, flushFrame } = setup({ onChange });

    startDrag({ result, event }, { x: 50, y: 60 });
    act(() => {
      result.current.pointerHandlers.onPointerMove(event(150, 120));
    });
    flushFrame();

    expect(onChange).toHaveBeenCalledExactlyOnceWith({ x1: 50, y1: 60, x2: 150, y2: 120 });
  });

  it('sorts an inverted drag into a positive rect', () => {
    const onChange = vi.fn();
    const { result, event, flushFrame } = setup({ onChange });

    startDrag({ result, event }, { x: 150, y: 120 });
    act(() => {
      result.current.pointerHandlers.onPointerMove(event(50, 60));
    });
    flushFrame();

    expect(onChange).toHaveBeenCalledExactlyOnceWith({ x1: 50, y1: 60, x2: 150, y2: 120 });
  });

  it('paints a zero-size rect for a drag without movement', () => {
    const onChange = vi.fn();
    const { ctx, result, event, flushFrame } = setup({ onChange });

    startDrag({ result, event }, { x: 50, y: 60 });
    act(() => {
      result.current.pointerHandlers.onPointerMove(event(50, 60));
    });
    flushFrame();

    expect(onChange).toHaveBeenCalledExactlyOnceWith({ x1: 50, y1: 60, x2: 50, y2: 60 });
    expect(ctx.strokeRect).toHaveBeenLastCalledWith(50, 60, 0, 0);
  });

  it('clamps the painted geometry to the canvas but reports the unclamped rect', () => {
    const onChange = vi.fn();
    const { ctx, result, event, flushFrame } = setup({ onChange });

    startDrag({ result, event }, { x: 50, y: 60 });
    act(() => {
      result.current.pointerHandlers.onPointerMove(event(-100, -50));
    });
    flushFrame();

    expect(onChange).toHaveBeenCalledExactlyOnceWith({ x1: -100, y1: -50, x2: 50, y2: 60 });
    expect(ctx.strokeRect).toHaveBeenLastCalledWith(0, 0, 50, 60);
  });

  it('throttles pointer moves to one frame and uses the newest point', () => {
    const onChange = vi.fn();
    const { result, event, flushFrame } = setup({ onChange });

    startDrag({ result, event }, { x: 10, y: 10 });
    act(() => {
      result.current.pointerHandlers.onPointerMove(event(20, 20));
    });
    act(() => {
      result.current.pointerHandlers.onPointerMove(event(30, 40));
    });
    flushFrame();

    expect(onChange).toHaveBeenCalledExactlyOnceWith({ x1: 10, y1: 10, x2: 30, y2: 40 });
  });

  it('ignores moves the capture layer refused', () => {
    const onChange = vi.fn();
    const { result, event, flushFrame } = setup({ onChange });

    startDrag({ result, event }, { x: 10, y: 10 });
    pointer.state.moveValid = false;
    act(() => {
      result.current.pointerHandlers.onPointerMove(event(20, 20));
    });
    flushFrame();

    expect(onChange).not.toHaveBeenCalled();
  });

  it('moves the whole selection when dragging its interior', () => {
    const onChange = vi.fn();
    const { result, event, flushFrame } = setup({ initialRect: RECT, onChange });

    startDrag({ result, event }, { x: 200, y: 175 });
    act(() => {
      result.current.pointerHandlers.onPointerMove(event(220, 195));
    });
    flushFrame();

    expect(onChange).toHaveBeenCalledExactlyOnceWith({ x1: 120, y1: 120, x2: 320, y2: 270 });
  });

  it.each([
    ['left', 100, 175, 60, 175, { x1: 60, y1: 100, x2: 300, y2: 250 }],
    ['right', 300, 175, 350, 175, { x1: 100, y1: 100, x2: 350, y2: 250 }],
    ['top', 200, 100, 200, 50, { x1: 100, y1: 50, x2: 300, y2: 250 }],
    ['bottom', 200, 250, 200, 300, { x1: 100, y1: 100, x2: 300, y2: 300 }],
  ] as const)('resizes from the %s edge', (_edge, fromX, fromY, toX, toY, expected) => {
    const onChange = vi.fn();
    const { result, event, flushFrame } = setup({ initialRect: RECT, onChange });

    startDrag({ result, event }, { x: fromX, y: fromY });
    act(() => {
      result.current.pointerHandlers.onPointerMove(event(toX, toY));
    });
    flushFrame();

    expect(onChange).toHaveBeenCalledExactlyOnceWith(expected);
  });

  it.each([
    [80, 60, { x1: 80, y1: 60, x2: 300, y2: 250 }],
    [320, 60, { x1: 300, y1: 60, x2: 320, y2: 250 }],
    [80, 260, { x1: 80, y1: 250, x2: 300, y2: 260 }],
    [320, 260, { x1: 300, y1: 250, x2: 320, y2: 260 }],
  ] as const)('anchors a top-left corner drag on the opposite corner (move to %i,%i)', (toX, toY, expected) => {
    const onChange = vi.fn();
    const { result, event, flushFrame } = setup({ initialRect: RECT, onChange });

    startDrag({ result, event }, { x: 100, y: 100 });
    act(() => {
      result.current.pointerHandlers.onPointerMove(event(toX, toY));
    });
    flushFrame();

    expect(onChange).toHaveBeenCalledExactlyOnceWith(expected);
  });

  it('resizes a left edge while keeping the aspect ratio', () => {
    const onChange = vi.fn();
    const { result, event, flushFrame } = setup({ initialRect: SQUARE_RECT, aspectRatio: 1, onChange });

    startDrag({ result, event }, { x: 100, y: 200 });
    act(() => {
      result.current.pointerHandlers.onPointerMove(event(60, 200));
    });
    flushFrame();

    // width becomes 240 => the 200px tall rect grows 20px on each side.
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ x1: 60, y1: 80, x2: 300, y2: 320 });
  });

  it('resizes a top edge while keeping the aspect ratio', () => {
    const onChange = vi.fn();
    const { result, event, flushFrame } = setup({ initialRect: SQUARE_RECT, aspectRatio: 1, onChange });

    startDrag({ result, event }, { x: 200, y: 100 });
    act(() => {
      result.current.pointerHandlers.onPointerMove(event(200, 50));
    });
    flushFrame();

    // height becomes 250, so the 200px width is widened by 25px on each side.
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ x1: 75, y1: 50, x2: 325, y2: 300 });
  });

  it('constrains a free drag to the configured aspect ratio', () => {
    const onChange = vi.fn();
    const { result, event, flushFrame } = setup({ aspectRatio: 1, onChange });

    startDrag({ result, event }, { x: 100, y: 100 });
    act(() => {
      result.current.pointerHandlers.onPointerMove(event(300, 150));
    });
    flushFrame();

    // 200x50 is wider than 1:1, so the width collapses to the 50px height.
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ x1: 100, y1: 100, x2: 150, y2: 150 });
  });

  it('locks the current ratio with a modifier key for a corner drag', () => {
    const onChange = vi.fn();
    const { result, event, flushFrame } = setup({ initialRect: RATIO_RECT, onChange });

    // The 200x100 selection implies 2:1, locked here with ctrlKey.
    startDrag({ result, event }, { x: 100, y: 100 });
    act(() => {
      result.current.pointerHandlers.onPointerDown(event(100, 100, { ctrlKey: true }));
    });
    act(() => {
      result.current.pointerHandlers.onPointerMove(event(200, 190));
    });
    flushFrame();

    // The raw drag from the (300,200) anchor is 100x10, so x2 is pulled to 300 - 20.
    expect(onChange).toHaveBeenLastCalledWith({ x1: 280, y1: 190, x2: 300, y2: 200 });
  });

  it('constrains the height when a locked-ratio drag is taller than wide', () => {
    const onChange = vi.fn();
    const { result, event, flushFrame } = setup({ initialRect: RATIO_RECT, onChange });

    act(() => {
      result.current.pointerHandlers.onPointerDown(event(100, 100, { shiftKey: true }));
    });
    pointer.data.isMouseDown.current = true;
    act(() => {
      result.current.pointerHandlers.onPointerMove(event(280, 210));
    });
    flushFrame();

    // 20x10 from the anchor is exactly 2:1, so the height is derived instead.
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ x1: 280, y1: 200, x2: 300, y2: 210 });
  });

  it('keeps the locked ratio when the corner drag grows to the right', () => {
    const onChange = vi.fn();
    const { result, event, flushFrame } = setup({ initialRect: RATIO_RECT, onChange });

    act(() => {
      result.current.pointerHandlers.onPointerDown(event(100, 100, { metaKey: true }));
    });
    pointer.data.isMouseDown.current = true;
    act(() => {
      result.current.pointerHandlers.onPointerMove(event(320, 195));
    });
    flushFrame();

    // 20x5 from the anchor is too wide, so x2 grows to 300 + 5 * 2.
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ x1: 300, y1: 195, x2: 310, y2: 200 });
  });

  it('forgets the locked ratio once the gesture ends', () => {
    const onChange = vi.fn();
    const { result, event, flushFrame } = setup({ initialRect: RATIO_RECT, onChange });

    act(() => {
      result.current.pointerHandlers.onPointerDown(event(100, 100, { ctrlKey: true }));
    });
    pointer.data.isMouseDown.current = true;
    act(() => {
      result.current.pointerHandlers.onPointerUp(event(120, 110));
    });

    // The committed rect anchors the next gesture, and the click below is
    // interior to it (not on a handle), so the selection is translated freely.
    startDrag({ result, event }, { x: 200, y: 150 });
    act(() => {
      result.current.pointerHandlers.onPointerMove(event(220, 170));
    });
    flushFrame();

    // No modifier this time: the free rect is unrestricted.
    expect(onChange).toHaveBeenLastCalledWith({ x1: 140, y1: 130, x2: 320, y2: 220 });
  });

  it('adopts the position of a layer under the pointer and moves it as a whole', () => {
    const onRepaint = vi.fn();
    const onChange = vi.fn();
    const layer = createMockLayer({ pos: { x: 100, y: 100, width: 200, height: 150 } });
    const { result, event, flushFrame, target } = setup({ onRepaint, onChange });

    act(() => {
      result.current.pointerHandlers.onPointerDown(event(0, 0), layer);
    });
    expect(onRepaint).toHaveBeenLastCalledWith({ x1: 100, y1: 100, x2: 300, y2: 250 });
    expect(target.style.cursor).toBe(CURSOR_MAP.inside);

    pointer.data.isMouseDown.current = true;
    act(() => {
      result.current.pointerHandlers.onPointerMove(event(10, 20));
    });
    flushFrame();

    expect(onChange).toHaveBeenCalledExactlyOnceWith({ x1: 110, y1: 120, x2: 310, y2: 270 });
  });

  it('ignores a bedrock layer and falls back to a free drag', () => {
    const onChange = vi.fn();
    const layer = createMockLayer({ isBedrock: true, pos: { x: 100, y: 100, width: 200, height: 150 } });
    const { result, event, flushFrame } = setup({ onChange });

    act(() => {
      result.current.pointerHandlers.onPointerDown(event(10, 20), layer);
    });
    pointer.data.isMouseDown.current = true;
    act(() => {
      result.current.pointerHandlers.onPointerMove(event(60, 80));
    });
    flushFrame();

    expect(onChange).toHaveBeenCalledExactlyOnceWith({ x1: 10, y1: 20, x2: 60, y2: 80 });
  });

  it('keeps the current selection when a handle was clicked instead of a layer', () => {
    const onChange = vi.fn();
    const layer = createMockLayer({ pos: { x: 400, y: 400, width: 50, height: 50 } });
    const { result, event, flushFrame } = setup({ initialRect: RECT, onChange });

    startDrag({ result, event }, { x: 100, y: 100 }, layer);
    act(() => {
      result.current.pointerHandlers.onPointerMove(event(80, 60));
    });
    flushFrame();

    // The layer position never replaces the grabbed selection.
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ x1: 80, y1: 60, x2: 300, y2: 250 });
  });
});

/**
 * `allowOutsideCanvas` changes the PAINTED geometry, and only for the one consumer that asks.
 *
 * By default the rect is clamped to the canvas before it is painted, so a marquee, a Move box or a
 * text box dragged past the image edge snaps back to it. That is what every consumer wants and
 * what `useRect drag geometry` above pins. Crop's box is a window onto a canvas that extends past
 * the image, and there the clamp was the wrong answer: the box shrank on screen while the rect
 * `onChange`/`onChangeEnd` reported — and the crop committed — kept the overhang, so the two
 * disagreed. With the prop the true rect is painted and the backing store clips it, which is why
 * the overhang is still legible and why the DOM frame (a separate area's job) is needed at all.
 */
describe('useRect painting outside the canvas', () => {
  beforeEach(resetPointerMock);

  /** A drag from inside the document to up and to the left of its origin corner. */
  function dragOutOfBounds(props: Partial<UseRectProps>) {
    const { ctx, result, event, flushFrame } = setup(props);

    startDrag({ result, event }, { x: 50, y: 60 });
    act(() => {
      result.current.pointerHandlers.onPointerMove(event(-100, -50));
    });
    flushFrame();

    return { ctx, result, event };
  }

  it('paints the true rect, its blend cut-out and its four handles where the pointer left it', () => {
    const { ctx } = dragOutOfBounds({ allowOutsideCanvas: true });

    // -100,-50 with a 150x110 extent: the overhang is painted, not pulled back to the origin.
    expect(ctx.strokeRect).toHaveBeenLastCalledWith(-100, -50, 150, 110);
    // The cut-out follows the true rect, and the backing store clips it to the document.
    expect(ctx.clearRect).toHaveBeenLastCalledWith(-100, -50, 150, 110);
    // The dim is the document, not the selection, so it is unchanged by the prop.
    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 800, 600);

    const handle = HANDLE_SIZE;
    const half = handle / 2;
    expect(ctx.fillRect).toHaveBeenCalledWith(-100 - half, -50 - half, handle, handle);
    expect(ctx.fillRect).toHaveBeenCalledWith(50 - half, -50 - half, handle, handle);
    expect(ctx.fillRect).toHaveBeenCalledWith(-100 - half, 60 - half, handle, handle);
    expect(ctx.fillRect).toHaveBeenCalledWith(50 - half, 60 - half, handle, handle);
  });

  it('leaves the clamped painting and handles in place for a consumer that does not opt in', () => {
    const { ctx } = dragOutOfBounds({});

    expect(ctx.strokeRect).toHaveBeenLastCalledWith(0, 0, 50, 60);
    expect(ctx.clearRect).toHaveBeenLastCalledWith(0, 0, 50, 60);

    // The handles are derived from the painted rect, so the clamp moves them too — which is the
    // snap-back this prop exists to switch off, pinned for everyone who does not set it.
    const handle = HANDLE_SIZE;
    const half = handle / 2;
    expect(ctx.fillRect).toHaveBeenCalledWith(-half, -half, handle, handle);
    expect(ctx.fillRect).toHaveBeenCalledWith(50 - half, -half, handle, handle);
    expect(ctx.fillRect).toHaveBeenCalledWith(-half, 60 - half, handle, handle);
    expect(ctx.fillRect).toHaveBeenCalledWith(50 - half, 60 - half, handle, handle);
  });

  it('paints a rect that stays inside the document identically with and without the prop', () => {
    const painted = (props: Partial<UseRectProps>) => {
      const { ctx, result, event, flushFrame } = setup(props);

      // Fractional pointer coords, so this also pins that the prop does not smuggle a second
      // rounding rule in: both paths round each edge once and derive the extent from the rounds.
      startDrag({ result, event }, { x: 100.4, y: 100.6 });
      act(() => {
        result.current.pointerHandlers.onPointerMove(event(300.4, 250.6));
      });
      flushFrame();

      return vi.mocked(ctx.strokeRect).mock.calls.at(-1);
    };

    const clamped = painted({});
    expect(clamped).toEqual([100, 101, 200, 150]);
    expect(painted({ allowOutsideCanvas: true })).toEqual(clamped);
  });

  it('still reports the unclamped rect to onChange and onChangeEnd', () => {
    const onChange = vi.fn();
    const onChangeEnd = vi.fn();
    const { result, event, flushFrame } = setup({ allowOutsideCanvas: true, onChange, onChangeEnd });

    startDrag({ result, event }, { x: 50, y: 60 });
    act(() => {
      result.current.pointerHandlers.onPointerMove(event(-100, -50));
    });
    flushFrame();
    act(() => {
      result.current.pointerHandlers.onPointerUp(event(-100, -50));
    });

    // The reports were never clamped — this prop must not have changed what crop commits either.
    const expected = { x1: -100, y1: -50, x2: 50, y2: 60 };
    expect(onChange).toHaveBeenCalledExactlyOnceWith(expected);
    expect(onChangeEnd).toHaveBeenCalledExactlyOnceWith(expected);
  });
});

describe('useRect pointer up and move tool', () => {
  beforeEach(resetPointerMock);

  it('commits the sorted rect on pointer up and continues from it', () => {
    const onChange = vi.fn();
    const onChangeEnd = vi.fn();
    const onRepaint = vi.fn();
    const { result, event, flushFrame, target } = setup({ initialRect: RECT, onChange, onChangeEnd, onRepaint });

    act(() => {
      result.current.pointerHandlers.onPointerDown(event(100, 100));
    });
    act(() => {
      result.current.pointerHandlers.onPointerUp(event(150, 120));
    });

    expect(onChangeEnd).toHaveBeenCalledExactlyOnceWith({ x1: 150, y1: 120, x2: 300, y2: 250 });
    expect(onRepaint).toHaveBeenLastCalledWith({ x1: 150, y1: 120, x2: 300, y2: 250 });
    expect(target.style.cursor).toBe('');

    // The committed rect becomes the anchor for the next gesture.
    startDrag({ result, event }, { x: 200, y: 180 });
    act(() => {
      result.current.pointerHandlers.onPointerMove(event(210, 190));
    });
    flushFrame();

    expect(onChange).toHaveBeenCalledExactlyOnceWith({ x1: 160, y1: 130, x2: 310, y2: 260 });
  });

  it('drops a move that was still waiting for its frame', () => {
    const onChange = vi.fn();
    const onChangeEnd = vi.fn();
    const { result, event, flushFrame } = setup({ initialRect: RECT, onChange, onChangeEnd });

    act(() => {
      result.current.pointerHandlers.onPointerDown(event(100, 100));
    });
    pointer.data.isMouseDown.current = true;
    act(() => {
      result.current.pointerHandlers.onPointerMove(event(200, 150));
    });
    act(() => {
      result.current.pointerHandlers.onPointerUp(event(180, 140));
    });
    flushFrame();

    expect(onChange).not.toHaveBeenCalled();
    expect(onChangeEnd).toHaveBeenCalledExactlyOnceWith({ x1: 180, y1: 140, x2: 300, y2: 250 });
  });

  it('ignores a pointer up that the capture layer refused', () => {
    const onChangeEnd = vi.fn();
    const { result, event, target } = setup({ initialRect: RECT, onChangeEnd });

    act(() => {
      result.current.pointerHandlers.onPointerDown(event(200, 175));
    });
    expect(target.style.cursor).toBe(CURSOR_MAP.inside);

    pointer.state.upValid = false;
    act(() => {
      result.current.pointerHandlers.onPointerUp(event(180, 155));
    });

    expect(onChangeEnd).not.toHaveBeenCalled();
    expect(target.style.cursor).toBe(CURSOR_MAP.inside);
  });

  it('does nothing on move or up while the move tool has no selection', () => {
    const onChange = vi.fn();
    const onChangeEnd = vi.fn();
    const { result, event, flushFrame } = setup({ isMoveTool: true, onChange, onChangeEnd });

    act(() => {
      result.current.pointerHandlers.onPointerDown(event(10, 10));
    });
    pointer.data.isMouseDown.current = true;
    act(() => {
      result.current.pointerHandlers.onPointerMove(event(50, 50));
    });
    flushFrame();
    act(() => {
      result.current.pointerHandlers.onPointerUp(event(60, 60));
    });

    expect(onChange).not.toHaveBeenCalled();
    expect(onChangeEnd).not.toHaveBeenCalled();
  });

  it('allows a move-tool drag once a selection exists', () => {
    const onChange = vi.fn();
    const { result, event, flushFrame } = setup({ isMoveTool: true, initialRect: RECT, onChange });

    startDrag({ result, event }, { x: 200, y: 175 });
    act(() => {
      result.current.pointerHandlers.onPointerMove(event(210, 185));
    });
    flushFrame();

    expect(onChange).toHaveBeenCalledExactlyOnceWith({ x1: 110, y1: 110, x2: 310, y2: 260 });
  });

  it('clears the selection so the next drag starts fresh', () => {
    const onRepaint = vi.fn();
    const onChange = vi.fn();
    const { ctx, result, event, flushFrame } = setup({ initialRect: RECT, onRepaint, onChange });
    onRepaint.mockClear();

    act(() => {
      result.current.rectHandles.clearSelection();
    });
    expect(onRepaint).not.toHaveBeenCalled();
    expect(ctx.clearRect).toHaveBeenLastCalledWith(0, 0, 800, 600);

    startDrag({ result, event }, { x: 10, y: 10 });
    act(() => {
      result.current.pointerHandlers.onPointerMove(event(20, 30));
    });
    flushFrame();

    expect(onChange).toHaveBeenCalledExactlyOnceWith({ x1: 10, y1: 10, x2: 20, y2: 30 });
  });

  it('redraws the current selection on demand', () => {
    const onRepaint = vi.fn();
    const { result } = setup({ initialRect: RECT, onRepaint });
    onRepaint.mockClear();

    act(() => {
      result.current.rectHandles.redraw();
    });

    expect(onRepaint).toHaveBeenCalledWith(RECT);
  });
});

/**
 * Photoshop's rectangular marquee modifiers: Shift holds the drag to a square, Alt grows the
 * rectangle out from the press point, and both at once is a square centred on it.
 *
 * They are per-consumer props rather than a behaviour of the hook, because `useRect` is shared
 * with the Move tool and the text tool and neither of them constrains a drag. The crop is the
 * second consumer to opt in, beside the rectangular marquee, and it is the one that carries an
 * aspect ratio of its own — so the cases below also pin that Shift is a square rather than
 * "whatever ratio is in play", and that the ratio a marquee is NOT given is not read from the
 * press either. The first case is the regression guard for the consumers that opt out: the same
 * gesture with neither prop set is the pre-existing `adjustFreePoint` path, byte for byte.
 */
describe('useRect fresh-drag modifiers', () => {
  beforeEach(resetPointerMock);

  function dragFrom(
    {
      from,
      to,
      down,
      move,
    }: {
      from: { x: number; y: number };
      to: { x: number; y: number };
      down?: Record<string, unknown>;
      move?: Record<string, unknown>;
    },
    props: Partial<UseRectProps> = {}
  ) {
    const onChange = vi.fn();
    const { result, event, flushFrame } = setup({ ...props, onChange });

    act(() => {
      result.current.pointerHandlers.onPointerDown(event(from.x, from.y, down));
    });
    pointer.data.isMouseDown.current = true;
    act(() => {
      result.current.pointerHandlers.onPointerMove(event(to.x, to.y, move));
    });
    flushFrame();

    return onChange;
  }

  it.each([
    ['neither modifier leaves the drag a plain 200x50 rectangle', {}, {}, { x1: 100, y1: 100, x2: 300, y2: 150 }],
    [
      'shift grows the short side into a square anchored on the press point',
      { shiftKey: true },
      { shiftKey: true },
      { x1: 100, y1: 100, x2: 300, y2: 300 },
    ],
    [
      'alt mirrors the drag through the press point',
      { altKey: true },
      { altKey: true },
      { x1: -100, y1: 50, x2: 300, y2: 150 },
    ],
    [
      'shift and alt together are a square centred on the press point',
      { shiftKey: true, altKey: true },
      { shiftKey: true, altKey: true },
      { x1: -100, y1: -100, x2: 300, y2: 300 },
    ],
  ] as const)('%s', (_name, down, move, expected) => {
    const onChange = dragFrom(
      { from: { x: 100, y: 100 }, to: { x: 300, y: 150 }, down, move },
      {
        constrainToSquare: true,
        fromCentre: true,
      }
    );

    expect(onChange).toHaveBeenCalledExactlyOnceWith(expected);
  });

  it('mirrors a drag that runs up and to the left as well as down and right', () => {
    const onChange = dragFrom(
      { from: { x: 400, y: 300 }, to: { x: 250, y: 250 }, down: { altKey: true }, move: { altKey: true } },
      { fromCentre: true }
    );

    // 150x50 from the press point, mirrored, so (400,300) is the centre of a 300x100 rect.
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ x1: 250, y1: 250, x2: 550, y2: 350 });
  });

  it('leaves a consumer that opts out of both modifiers completely alone', () => {
    const onChange = dragFrom({
      from: { x: 100, y: 100 },
      to: { x: 300, y: 150 },
      down: { altKey: true, shiftKey: true },
      move: { altKey: true, shiftKey: true },
    });

    // The Move tool and the text tool: the modifiers are pressed and nothing about the rect
    // changes.
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ x1: 100, y1: 100, x2: 300, y2: 150 });
  });

  it('prefers the square over the ratio an existing selection implies', () => {
    // A fresh drag that lands outside an existing 2:1 selection. `getEdgeAtPoint` still reads
    // the pressed shift and records the selection's own ratio, which would otherwise win.
    const onChange = dragFrom(
      { from: { x: 500, y: 500 }, to: { x: 700, y: 550 }, down: { shiftKey: true }, move: { shiftKey: true } },
      { initialRect: RATIO_RECT, constrainToSquare: true }
    );

    expect(onChange).toHaveBeenCalledExactlyOnceWith({ x1: 500, y1: 500, x2: 700, y2: 700 });
  });

  it('leaves a corner-handle resize on its own aspect lock, square or not', () => {
    // Resizing the existing 2:1 selection by its top-left corner with shift held keeps the
    // ratio `getEdgeAtPoint` captured, because this is a resize and not a fresh drag.
    const onChange = dragFrom(
      { from: { x: 100, y: 100 }, to: { x: 50, y: 75 }, down: { shiftKey: true }, move: { shiftKey: true } },
      { initialRect: RATIO_RECT, constrainToSquare: true, fromCentre: true }
    );

    // A 2:1 rect dragged by its top-left corner is still 2:1, measured from the shared
    // opposite corner the handle anchored it to: 250 wide, 125 tall.
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ x1: 50, y1: 75, x2: 300, y2: 200 });
  });

  it.each([
    ['Command', { metaKey: true }],
    ['Control', { ctrlKey: true }],
  ] as const)('%s is not the aspect-ratio modifier on a fresh drag', (_name, modifier) => {
    // The crop's own modifier table gives Command to Straighten and to disabling edge snapping,
    // and neither Command nor Control constrains proportions on a marquee anywhere in Adobe's
    // geometry modifiers — Shift is that key. So a fresh drag out of the existing 2:1 selection
    // must take no ratio from it: before the gate in `getEdgeAtPoint`, this press recorded the
    // selection's ratio as well and the drag out of it came out 2:1.
    const onChange = dragFrom(
      { from: { x: 500, y: 500 }, to: { x: 700, y: 550 }, down: modifier, move: modifier },
      { initialRect: RATIO_RECT, constrainToSquare: true, fromCentre: true }
    );

    expect(onChange).toHaveBeenCalledExactlyOnceWith({ x1: 500, y1: 500, x2: 700, y2: 550 });
  });

  it('keeps a Command corner resize on the ratio the box already has', () => {
    // The gate is on WHERE the press landed, not on WHICH key was held: a resize still pins the
    // box's own ratio, which is what the Move tool, the text tool and the marquees read it for.
    const onChange = dragFrom(
      { from: { x: 100, y: 100 }, to: { x: 320, y: 195 }, down: { metaKey: true }, move: { metaKey: true } },
      { initialRect: RATIO_RECT, constrainToSquare: true, fromCentre: true }
    );

    expect(onChange).toHaveBeenCalledExactlyOnceWith({ x1: 300, y1: 195, x2: 310, y2: 200 });
  });

  it('prefers the square over the ratio the consumer is configured with', () => {
    // The crop's options bar can hold a Ratio while a fresh box is drawn, and Shift is Adobe's
    // square rather than "the ratio, whichever it is".
    const onChange = dragFrom(
      { from: { x: 100, y: 100 }, to: { x: 300, y: 150 }, down: { shiftKey: true }, move: { shiftKey: true } },
      { aspectRatio: 2, constrainToSquare: true, fromCentre: true }
    );

    expect(onChange).toHaveBeenCalledExactlyOnceWith({ x1: 100, y1: 100, x2: 300, y2: 300 });
  });

  it('keeps the configured ratio on a fresh drag held under no modifier', () => {
    const onChange = dragFrom({ from: { x: 100, y: 100 }, to: { x: 300, y: 150 } }, { aspectRatio: 2 });

    // 200x50 is wider than 2:1, so the width collapses to the 50px height doubled.
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ x1: 100, y1: 100, x2: 200, y2: 150 });
  });
});
