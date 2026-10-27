import { act, fireEvent, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RefObject } from 'react';

import { usePaintStroke, type PaintStrokeCallbacks } from '../usePaintStroke.ts';
import type { Point, Size } from '../../contexts/general-types.ts';
import type { DocumentFrame } from '../../contexts/document-frame.ts';
import {
  createPointerDownEvent,
  createPointerLeaveEvent,
  createPointerMoveEvent,
  createPointerUpEvent,
} from '@/__tests__/fixtures/pointer.ts';
import { claimDocumentGesture, isDocumentGestureOpen, resetDocumentGestures } from '../document-gesture.ts';

const CANVAS_SIZE: Size = { width: 400, height: 300 };
/** A crop whose origin is not zero, which is the whole point of the conversion. */
const CROP_FRAME: DocumentFrame = { x: 40, y: 25, width: 400, height: 300 };

const storeStateMock = vi.hoisted(() => ({
  totalSize: { width: 400, height: 300 } as { width: number; height: number },
  documentFrame: null as DocumentFrame | null,
}));

// Mocked directly rather than through `renderHook` + `StoreProvider`: the
// provider pulls in the durable replay/materialization path, which does not
// survive the test environment, and this hook's contract is the point
// conversion it performs on the way out.
vi.mock('../../contexts/StoreContext.tsx', () => ({
  useStore: () => [storeStateMock, vi.fn()],
}));

const pointerPositionMock = vi.hoisted(() => {
  const isMouseDown = { current: false };
  const pointerIdRef = { current: null as number | null };
  return {
    isPointerDownValid: vi.fn(() => true),
    isPointerMoveValid: vi.fn(() => true),
    isPointerUpValid: vi.fn(() => true),
    releasePointer: vi.fn(() => {
      pointerIdRef.current = null;
      isMouseDown.current = false;
    }),
    // Mirrors the real hook's contract: canvas coordinates out of the event, not
    // document coordinates, so the conversion under test is the hook's own.
    getLocalCoords: vi.fn((event: PointerEvent) => ({ x: event.clientX, y: event.clientY })),
    isMouseDown,
    dimensionsRef: { current: null },
    pointerIdRef,
  };
});

vi.mock('../usePointerPosition.ts', () => ({
  usePointerPosition: vi.fn(() => pointerPositionMock),
}));

type RecordedCallbacks = PaintStrokeCallbacks & {
  onStart: ReturnType<typeof vi.fn<(points: Point[]) => void>>;
  onMove: ReturnType<typeof vi.fn<(points: Point[]) => void>>;
  onCommit: ReturnType<typeof vi.fn<(points: Point[]) => void>>;
  onCancel: ReturnType<typeof vi.fn<() => void>>;
  /** One entry per call, copied at call time. */
  starts: Point[][];
  moves: Point[][];
  commits: Point[][];
};

/**
 * `onMove` receives the live accumulating array, which keeps growing for the
 * rest of the gesture. A recorder that stored the reference and copied it at
 * assertion time would show every call looking like the final one, so the copy
 * has to happen where the call happens.
 */
const makeCallbacks = (): RecordedCallbacks => {
  const starts: Point[][] = [];
  const moves: Point[][] = [];
  const commits: Point[][] = [];

  return {
    starts,
    moves,
    commits,
    onStart: vi.fn((points: Point[]) => {
      starts.push([...points]);
    }),
    onMove: vi.fn((points: Point[]) => {
      moves.push([...points]);
    }),
    onCommit: vi.fn((points: Point[]) => {
      commits.push([...points]);
    }),
    onCancel: vi.fn(),
  };
};

const down = (x: number, y: number) => createPointerDownEvent({ clientX: x, clientY: y });
const move = (x: number, y: number) => createPointerMoveEvent({ clientX: x, clientY: y });
const up = (x: number, y: number) => createPointerUpEvent({ clientX: x, clientY: y });
const leave = (x: number, y: number) => createPointerLeaveEvent({ clientX: x, clientY: y });

describe('usePaintStroke', () => {
  let container: HTMLDivElement;
  let containerRef: RefObject<HTMLElement | null>;

  beforeEach(() => {
    vi.clearAllMocks();
    pointerPositionMock.isPointerDownValid.mockReturnValue(true);
    pointerPositionMock.isPointerMoveValid.mockReturnValue(true);
    pointerPositionMock.isPointerUpValid.mockReturnValue(true);
    storeStateMock.totalSize = { ...CANVAS_SIZE };
    storeStateMock.documentFrame = CROP_FRAME;

    container = document.createElement('div');
    document.body.appendChild(container);
    containerRef = { current: container };
  });

  afterEach(() => {
    resetDocumentGestures();
    container.remove();
  });

  const renderStroke = (
    callbacks: PaintStrokeCallbacks,
    options: { onPreview?: (points: Point[]) => void; enabled?: boolean; gestureKey?: unknown } = {}
  ) => {
    const renderCount = { value: 0 };
    const view = renderHook<ReturnType<typeof usePaintStroke>, { enabled: boolean; gestureKey?: unknown }>(
      ({ enabled, gestureKey }: { enabled: boolean; gestureKey?: unknown }) => {
        renderCount.value += 1;
        return usePaintStroke({ imageSize: CANVAS_SIZE, containerRef, ...options, enabled, gestureKey }, callbacks);
      },
      { initialProps: { enabled: options.enabled ?? true, gestureKey: options.gestureKey } }
    );
    return { ...view, renderCount };
  };

  it('hands callbacks document-space points, not canvas-space ones', () => {
    const callbacks = makeCallbacks();
    const { result } = renderStroke(callbacks);

    act(() => result.current.onPointerDown(down(10, 20)));
    act(() => result.current.onPointerMove(move(30, 40)));

    // The crop origin has to be added: canvas (10,20) is document (50,45).
    expect(callbacks.starts).toEqual([[{ x: 50, y: 45 }]]);
    expect(callbacks.moves).toEqual([
      [
        { x: 50, y: 45 },
        { x: 70, y: 65 },
      ],
    ]);
  });

  it('falls back to a zero-origin frame when the document has never been cropped', () => {
    storeStateMock.documentFrame = null;
    const callbacks = makeCallbacks();
    const { result } = renderStroke(callbacks);

    act(() => result.current.onPointerDown(down(10, 20)));

    expect(callbacks.starts).toEqual([[{ x: 10, y: 20 }]]);
  });

  it('gives every move the whole gesture so far', () => {
    const callbacks = makeCallbacks();
    const { result } = renderStroke(callbacks);

    act(() => result.current.onPointerDown(down(0, 0)));
    act(() => result.current.onPointerMove(move(1, 1)));
    act(() => result.current.onPointerMove(move(2, 2)));
    act(() => result.current.onPointerMove(move(3, 3)));

    expect(callbacks.moves).toEqual([
      [
        { x: 40, y: 25 },
        { x: 41, y: 26 },
      ],
      [
        { x: 40, y: 25 },
        { x: 41, y: 26 },
        { x: 42, y: 27 },
      ],
      [
        { x: 40, y: 25 },
        { x: 41, y: 26 },
        { x: 42, y: 27 },
        { x: 43, y: 28 },
      ],
    ]);
  });

  it('commits exactly once, on pointer-up, and never per move', () => {
    const callbacks = makeCallbacks();
    const { result } = renderStroke(callbacks);

    act(() => result.current.onPointerDown(down(0, 0)));
    act(() => result.current.onPointerMove(move(5, 5)));
    act(() => result.current.onPointerMove(move(6, 6)));

    expect(callbacks.onCommit).not.toHaveBeenCalled();

    act(() => result.current.onPointerUp(up(7, 7)));
    expect(callbacks.onCommit).toHaveBeenCalledTimes(1);
    expect(isDocumentGestureOpen()).toBe(false);

    // A second up is not a second commit: `usePointerPosition` owns the
    // pointer, and the hook refuses to commit a gesture it does not own.
    pointerPositionMock.isPointerUpValid.mockReturnValue(false);
    act(() => result.current.onPointerUp(up(8, 8)));
    expect(callbacks.onCommit).toHaveBeenCalledTimes(1);
  });

  it('rolls back and releases capture when the preview target changes mid-gesture', () => {
    const callbacks = makeCallbacks();
    const { result, rerender } = renderStroke(callbacks, { gestureKey: 'layer-a' });

    act(() => result.current.onPointerDown(down(0, 0)));
    act(() => result.current.onPointerMove(move(5, 5)));
    expect(isDocumentGestureOpen()).toBe(true);

    rerender({ enabled: true, gestureKey: 'layer-b' });

    expect(callbacks.onCancel).toHaveBeenCalledOnce();
    expect(callbacks.onCommit).not.toHaveBeenCalled();
    expect(pointerPositionMock.releasePointer).toHaveBeenCalledOnce();
    expect(result.current.isMouseDown).toBe(false);
    expect(result.current.points).toEqual([]);
    expect(isDocumentGestureOpen()).toBe(false);

    act(() => result.current.onPointerUp(up(10, 10)));
    expect(callbacks.onCommit).not.toHaveBeenCalled();
  });

  it('appends the release point only when it differs from the last move', () => {
    const callbacks = makeCallbacks();
    const { result } = renderStroke(callbacks);

    act(() => result.current.onPointerDown(down(0, 0)));
    act(() => result.current.onPointerMove(move(10, 10)));
    act(() => result.current.onPointerUp(up(10, 10)));

    expect(callbacks.commits).toEqual([
      [
        { x: 40, y: 25 },
        { x: 50, y: 35 },
      ],
    ]);
  });

  it('appends a release point that did move', () => {
    const callbacks = makeCallbacks();
    const { result } = renderStroke(callbacks);

    act(() => result.current.onPointerDown(down(0, 0)));
    act(() => result.current.onPointerUp(up(12, 13)));

    expect(callbacks.commits).toEqual([
      [
        { x: 40, y: 25 },
        { x: 52, y: 38 },
      ],
    ]);
  });

  it('hands onStart and onCommit copies that outlive the gesture', () => {
    const callbacks = makeCallbacks();
    const { result } = renderStroke(callbacks);

    act(() => result.current.onPointerDown(down(0, 0)));
    act(() => result.current.onPointerMove(move(4, 4)));
    act(() => result.current.onPointerUp(up(4, 4)));

    const started = callbacks.onStart.mock.calls[0][0];
    const committed = callbacks.onCommit.mock.calls[0][0];
    act(() => result.current.onPointerDown(down(100, 100)));
    act(() => result.current.onPointerMove(move(120, 120)));

    // Both become tool args, and the committed one is what a history item
    // retains, so a later gesture must not be able to append into either.
    expect(started).toEqual([{ x: 40, y: 25 }]);
    expect(committed).toEqual([
      { x: 40, y: 25 },
      { x: 44, y: 29 },
    ]);
  });

  it('ignores pointers the gesture does not own', () => {
    const callbacks = makeCallbacks();
    const { result } = renderStroke(callbacks);

    pointerPositionMock.isPointerDownValid.mockReturnValue(false);
    act(() => result.current.onPointerDown(down(0, 0)));

    pointerPositionMock.isPointerMoveValid.mockReturnValue(false);
    act(() => result.current.onPointerMove(move(5, 5)));

    pointerPositionMock.isPointerUpValid.mockReturnValue(false);
    act(() => result.current.onPointerUp(up(9, 9)));

    expect(callbacks.onStart).not.toHaveBeenCalled();
    expect(callbacks.onMove).not.toHaveBeenCalled();
    expect(callbacks.onCommit).not.toHaveBeenCalled();
    expect(result.current.isMouseDown).toBe(false);
    expect(isDocumentGestureOpen()).toBe(false);
  });

  it('refuses a paint stroke while another document gesture owns the gate', () => {
    claimDocumentGesture('layer-transform', 99);
    const callbacks = makeCallbacks();
    const { result } = renderStroke(callbacks);

    act(() => result.current.onPointerDown(down(0, 0)));

    expect(pointerPositionMock.isPointerDownValid).not.toHaveBeenCalled();
    expect(callbacks.onStart).not.toHaveBeenCalled();
    expect(result.current.isMouseDown).toBe(false);
  });

  it('is inert while disabled', () => {
    const callbacks = makeCallbacks();
    const { result } = renderStroke(callbacks, { enabled: false });

    act(() => result.current.onPointerDown(down(0, 0)));
    act(() => result.current.onPointerMove(move(5, 5)));
    act(() => result.current.onPointerUp(up(9, 9)));
    act(() => result.current.onPointerLeave(leave(9, 9)));

    expect(callbacks.onStart).not.toHaveBeenCalled();
    expect(callbacks.onMove).not.toHaveBeenCalled();
    expect(callbacks.onCommit).not.toHaveBeenCalled();
    expect(callbacks.onCancel).not.toHaveBeenCalled();
    expect(result.current.isMouseDown).toBe(false);
    expect(result.current.points).toEqual([]);
    // Never asked the pointer layer to capture anything, so a disabled tool
    // cannot hold the container's pointer hostage.
    expect(pointerPositionMock.isPointerDownValid).not.toHaveBeenCalled();
  });

  it('reports the in-flight gesture and clears it after the commit', () => {
    const callbacks = makeCallbacks();
    const { result } = renderStroke(callbacks);

    expect(result.current.isMouseDown).toBe(false);
    expect(result.current.points).toEqual([]);

    act(() => result.current.onPointerDown(down(1, 1)));
    act(() => result.current.onPointerMove(move(2, 2)));

    expect(result.current.isMouseDown).toBe(true);
    // `points` mirrors nothing without a preview, so the only thing to read
    // mid-gesture is the flag; the shape is in the callbacks.
    expect(result.current.points).toEqual([]);

    act(() => result.current.onPointerUp(up(2, 2)));

    expect(result.current.isMouseDown).toBe(false);
    expect(result.current.points).toEqual([]);
  });

  it('cancels a gesture that leaves the surface, without committing', () => {
    const callbacks = makeCallbacks();
    const { result } = renderStroke(callbacks);

    act(() => result.current.onPointerDown(down(0, 0)));
    act(() => result.current.onPointerLeave(leave(50, 50)));

    expect(callbacks.onCancel).toHaveBeenCalledTimes(1);
    expect(callbacks.onCommit).not.toHaveBeenCalled();
    expect(result.current.isMouseDown).toBe(false);
    expect(isDocumentGestureOpen()).toBe(false);
    expect(result.current.points).toEqual([]);
    // The capture `usePointerPosition` took has to be released, or it refuses
    // every later pointer-down.
    expect(pointerPositionMock.isPointerUpValid).toHaveBeenCalledTimes(1);
  });

  it('keeps the gesture when a leave arrives for a pointer that does not own it', () => {
    const callbacks = makeCallbacks();
    const { result } = renderStroke(callbacks);

    act(() => result.current.onPointerDown(down(0, 0)));
    pointerPositionMock.isPointerUpValid.mockReturnValue(false);
    act(() => result.current.onPointerLeave(leave(50, 50)));

    expect(callbacks.onCancel).not.toHaveBeenCalled();
    expect(result.current.isMouseDown).toBe(true);
  });

  it('ignores a leave when no gesture is in flight', () => {
    const callbacks = makeCallbacks();
    const { result } = renderStroke(callbacks);

    act(() => result.current.onPointerLeave(leave(50, 50)));

    expect(callbacks.onCancel).not.toHaveBeenCalled();
  });

  it('cancels on a native pointercancel, which has no React handler', () => {
    const callbacks = makeCallbacks();
    const { result } = renderStroke(callbacks);

    act(() => result.current.onPointerDown(down(0, 0)));
    act(() => result.current.onPointerMove(move(5, 5)));
    act(() => {
      fireEvent.pointerCancel(container, { pointerId: 1 });
    });

    expect(callbacks.onCancel).toHaveBeenCalledTimes(1);
    expect(callbacks.onCommit).not.toHaveBeenCalled();
    expect(result.current.isMouseDown).toBe(false);
    expect(isDocumentGestureOpen()).toBe(false);
  });

  it.each(['pointerup', 'pointercancel'] as const)(
    'aborts and releases its claim when disabled before the owning %s',
    (ending) => {
      const callbacks = makeCallbacks();
      const { result, rerender } = renderStroke(callbacks);

      act(() => result.current.onPointerDown(down(0, 0)));
      expect(isDocumentGestureOpen()).toBe(true);

      rerender({ enabled: false });
      act(() => {
        if (ending === 'pointerup') result.current.onPointerUp(up(5, 5));
        else fireEvent.pointerCancel(container, { pointerId: 1 });
      });

      expect(callbacks.onCancel).toHaveBeenCalledTimes(1);
      expect(callbacks.onCommit).not.toHaveBeenCalled();
      expect(result.current.isMouseDown).toBe(false);
      expect(result.current.points).toEqual([]);
      expect(isDocumentGestureOpen()).toBe(false);
    }
  );

  it('ignores a native pointercancel from a different pointer', () => {
    const callbacks = makeCallbacks();
    const { result } = renderStroke(callbacks);

    act(() => result.current.onPointerDown(down(0, 0)));
    act(() => result.current.onPointerMove(move(5, 5)));
    act(() => {
      fireEvent.pointerCancel(container, { pointerId: 99 });
    });

    expect(callbacks.onCancel).not.toHaveBeenCalled();
    expect(result.current.isMouseDown).toBe(true);
    expect(isDocumentGestureOpen()).toBe(true);

    act(() => result.current.onPointerUp(up(10, 10)));

    expect(callbacks.onCommit).toHaveBeenCalledTimes(1);
    expect(isDocumentGestureOpen()).toBe(false);
  });

  it('cancels through the imperative handle while a gesture is in flight', () => {
    const callbacks = makeCallbacks();
    const { result } = renderStroke(callbacks);

    act(() => result.current.onPointerDown(down(0, 0)));
    act(() => result.current.cancel());

    expect(callbacks.onCancel).toHaveBeenCalledTimes(1);
    expect(callbacks.onCommit).not.toHaveBeenCalled();
    expect(result.current.isMouseDown).toBe(false);
    expect(isDocumentGestureOpen()).toBe(false);
  });

  it('does not fire onCancel when cancel is called with nothing in flight', () => {
    const callbacks = makeCallbacks();
    const { result } = renderStroke(callbacks);

    act(() => result.current.cancel());

    expect(callbacks.onCancel).not.toHaveBeenCalled();
  });

  it('releases the document claim when the stroke surface unmounts mid-gesture', () => {
    const callbacks = makeCallbacks();
    const addEventListener = vi.spyOn(container, 'addEventListener');
    const removeEventListener = vi.spyOn(container, 'removeEventListener');
    const { result, unmount } = renderStroke(callbacks);

    act(() => result.current.onPointerDown(down(0, 0)));
    expect(isDocumentGestureOpen()).toBe(true);
    const pointerCancelRegistration = addEventListener.mock.calls.find(([type]) => type === 'pointercancel');
    expect(pointerCancelRegistration).toBeDefined();

    unmount();

    expect(isDocumentGestureOpen()).toBe(false);
    expect(callbacks.onCancel).toHaveBeenCalledTimes(1);
    expect(removeEventListener).toHaveBeenCalledWith('pointercancel', pointerCancelRegistration?.[1]);

    act(() => fireEvent.pointerCancel(container, { pointerId: 1 }));
    expect(callbacks.onCancel).toHaveBeenCalledTimes(1);
  });

  it('does not re-render per move when no preview is supplied', () => {
    const callbacks = makeCallbacks();
    const { result, renderCount } = renderStroke(callbacks);

    const afterMount = renderCount.value;
    act(() => result.current.onPointerDown(down(0, 0)));
    const afterDown = renderCount.value;
    act(() => result.current.onPointerMove(move(1, 1)));
    act(() => result.current.onPointerMove(move(2, 2)));
    act(() => result.current.onPointerMove(move(3, 3)));

    // The hot path is a ref and a callback, exactly like
    // `DrawToolArea.tsx:32-44`; five tools doing a render per move is felt.
    expect(afterDown).toBe(afterMount + 1);
    expect(renderCount.value).toBe(afterDown);

    act(() => result.current.onPointerUp(up(3, 3)));
    expect(renderCount.value).toBe(afterDown + 1);
  });

  it('re-renders per move and drives onPreview when a preview is supplied', () => {
    const callbacks = makeCallbacks();
    const onPreview = vi.fn<(points: Point[]) => void>();
    const { result, renderCount } = renderStroke(callbacks, { onPreview });

    act(() => result.current.onPointerDown(down(0, 0)));
    const afterDown = renderCount.value;
    act(() => result.current.onPointerMove(move(1, 1)));
    act(() => result.current.onPointerMove(move(2, 2)));

    expect(renderCount.value).toBe(afterDown + 2);
    expect(onPreview.mock.calls.map(([call]) => [...call])).toEqual([
      [{ x: 40, y: 25 }],
      [
        { x: 40, y: 25 },
        { x: 41, y: 26 },
      ],
      [
        { x: 40, y: 25 },
        { x: 41, y: 26 },
        { x: 42, y: 27 },
      ],
    ]);
    // The preview state is a snapshot, so two moves cannot share an identity
    // and leave the second one with nothing to re-render for.
    expect(result.current.points).toEqual([
      { x: 40, y: 25 },
      { x: 41, y: 26 },
      { x: 42, y: 27 },
    ]);
  });

  it('runs a full gesture without leaking state into the next one', () => {
    const callbacks = makeCallbacks();
    const { result } = renderStroke(callbacks);

    act(() => result.current.onPointerDown(down(0, 0)));
    act(() => result.current.onPointerMove(move(1, 1)));
    act(() => result.current.onPointerUp(up(1, 1)));

    act(() => result.current.onPointerDown(down(60, 70)));
    act(() => result.current.onPointerUp(up(60, 70)));

    // The second stroke starts where the first ended and gets no tail from its
    // release, which is the leak this asserts: nothing from gesture one is left
    // to make gesture two's commit wrong.
    expect(callbacks.commits).toEqual([
      [
        { x: 40, y: 25 },
        { x: 41, y: 26 },
      ],
      [{ x: 100, y: 95 }],
    ]);
    expect(result.current.points).toEqual([]);
  });

  it('forwards non-finite NaN coordinates through to onStart and onCommit', () => {
    const callbacks = makeCallbacks();
    const { result } = renderStroke(callbacks);

    act(() => result.current.onPointerDown(down(NaN, NaN)));
    act(() => result.current.onPointerUp(up(NaN, NaN)));

    expect(callbacks.starts).toHaveLength(1);
    expect(Number.isNaN(callbacks.starts[0][0].x)).toBe(true);
    expect(Number.isNaN(callbacks.starts[0][0].y)).toBe(true);

    expect(callbacks.commits).toHaveLength(1);
    expect(callbacks.commits[0]).toHaveLength(2);
    expect(Number.isNaN(callbacks.commits[0][1].x)).toBe(true);
  });

  it('forwards non-finite Infinity coordinates through to onStart and onCommit', () => {
    const callbacks = makeCallbacks();
    const { result } = renderStroke(callbacks);

    act(() => result.current.onPointerDown(down(Infinity, 0)));
    act(() => result.current.onPointerUp(up(Infinity, 0)));

    expect(callbacks.starts).toHaveLength(1);
    expect(callbacks.starts[0][0].x).toBe(Infinity);

    expect(callbacks.commits).toHaveLength(1);
    expect(callbacks.commits[0]).toHaveLength(1);
    expect(callbacks.commits[0][0].x).toBe(Infinity);
  });

  it('treats pointer-up with no active gesture as a no-op', () => {
    const callbacks = makeCallbacks();
    const { result } = renderStroke(callbacks);

    pointerPositionMock.isPointerUpValid.mockReturnValue(false);
    act(() => result.current.onPointerUp(up(10, 20)));

    expect(callbacks.onCommit).not.toHaveBeenCalled();
    expect(callbacks.onStart).not.toHaveBeenCalled();
    expect(result.current.isMouseDown).toBe(false);
    expect(isDocumentGestureOpen()).toBe(false);
  });

  it('commits a single-point stroke when the release lands on the start point', () => {
    const callbacks = makeCallbacks();
    const { result } = renderStroke(callbacks);

    act(() => result.current.onPointerDown(down(10, 20)));
    act(() => result.current.onPointerUp(up(10, 20)));

    expect(callbacks.commits).toEqual([[{ x: 50, y: 45 }]]);
  });

  it.fails('should reject NaN coordinates instead of forwarding them to onStart', () => {
    const callbacks = makeCallbacks();
    const { result } = renderStroke(callbacks);

    act(() => result.current.onPointerDown(down(NaN, NaN)));

    expect(callbacks.onStart).not.toHaveBeenCalled();
  });

  it.fails('should reject Infinity coordinates instead of forwarding them to onStart', () => {
    const callbacks = makeCallbacks();
    const { result } = renderStroke(callbacks);

    act(() => result.current.onPointerDown(down(Infinity, 0)));

    expect(callbacks.onStart).not.toHaveBeenCalled();
  });
});
