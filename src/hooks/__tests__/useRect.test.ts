import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useRect, type UseRectProps } from '../useRect.ts';
import { createPointerEvent } from '@/__tests__/fixtures/pointer.ts';
import { createMockCanvas, createMockCanvasContext } from '@/__tests__/fixtures/canvas.ts';
import { refitRectWidthToAspect } from '@/util/rect-aspect.ts';
import type { Point } from '@/contexts/general-types.ts';
// `util/constants` is deliberately NOT mocked, and it used to be — with a `CURSOR_MAP` whose eight
// of nine entries disagreed with the real one and a `HANDLE_SIZE` of 8 against the real 12. That
// made the cursor assertion below a claim about the mock's `nw-resize`, a string no user ever sees
// (the real top-left cursor is `nwse-resize`), and falsifiable only against the mock. `useRect.drag.test.ts`
// already asserts `CURSOR_MAP[edge]` against this same real import; this file is the hover half.
import { CURSOR_MAP } from '../../util/constants.ts';

const usePointerPositionMock = vi.hoisted(() => {
  const mockData = {
    isPointerDownValid: vi.fn((event: PointerEvent) => event.button === 0),
    isPointerMoveValid: vi.fn(() => true),
    isPointerUpValid: vi.fn((event: PointerEvent) => event.button === 0),
    getLocalCoords: vi.fn((event: PointerEvent) => ({ x: event.clientX, y: event.clientY })),
    isMouseDown: { current: false },
    dimensionsRef: { current: { scale: 1, offset: { x: 0, y: 0 } } },
    onResize: vi.fn(),
    pointerIdRef: { current: null },
  };
  return {
    usePointerPosition: vi.fn(() => mockData),
    // Exposed because `isMouseDown` is the one drag input no pointer event can set: the real hook
    // owns the ref and this mock's `isPointerDownValid` is a pure predicate that ignores it, so
    // `handlePointerMove` returns at its hover branch on every event a test can synthesise.
    mockData,
  };
});

vi.mock('../usePointerPosition.ts', () => usePointerPositionMock);

const rectUtilsMock = vi.hoisted(() => ({
  getCanvasSize: vi.fn(() => ({ width: 800, height: 600 })),
}));

// The path resolves: `useRect.ts` imports `'../util/rect.ts'` from `src/hooks/`, which is
// the same `src/util/rect.ts` this resolves to, so the mock IS live. `getCanvasSize` is a
// MEASUREMENT, not geometry — it is the one thing here that would otherwise be read off a
// real canvas — and it is the only export left stubbed.
//
// Every other export delegates to the real implementation, and each one that did not was
// the same hazard the aspect-ratio stubs were: a stub that agrees with production today
// makes every assertion about the result invariant to whether the real code ran, so a
// regression in the real code ships green. `sortRect` and `trimRect` were identity stubs
// and made the whole aspect-ratio block blind to whether sorting ran at all, which is the
// one thing that block exists to pin; `trimRect` internally calls `sortRect`, so an
// identity stub there neutralised both the commit path and the paint path. `posToSortedRect`
// was a byte-equivalent hand-copy of `util/rect.ts:95-104`, which is the strongest version
// of the same defect: it is guaranteed to agree with production, so it can never fail and
// can never catch anything.
vi.mock('../../util/rect.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../util/rect.ts')>();
  return {
    ...actual,
    getCanvasSize: rectUtilsMock.getCanvasSize,
  };
});

// No `vi.mock('../../util/constants.ts', ...)` here, and that is the point — see the import above.

function createMockLayer(pos = { x: 100, y: 100, width: 200, height: 150 }) {
  return {
    id: 'layer-1',
    name: 'Test Layer',
    pos,
    isBedrock: false,
    visible: true,
    opacity: 1,
    locked: false,
    blendMode: 'source-over' as const,
    order: 0,
    bitmap: null,
    tmpCanvas: null,
    operations: [],
  };
}

const createMockTarget = () => {
  const div = document.createElement('div');
  div.style.cursor = '';
  return div;
};

const createTestContext = () => {
  const overlayCanvas = createMockCanvas({ width: 800, height: 600 });
  const containerElement = document.createElement('div');
  containerElement.style.cursor = '';
  return { overlayCanvas, containerElement };
};

describe('useRect', () => {
  let testContext: ReturnType<typeof createTestContext>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    // `mockData` is module scope and `clearAllMocks` does not touch a plain object's property, so a
    // test that drives a real drag has to be undone here or it decides the branch every later test
    // takes — in whatever order the runner happens to use.
    usePointerPositionMock.mockData.isMouseDown.current = false;
    testContext = createTestContext();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function renderUseRect(
    options: {
      aspectRatio?: number | null;
      initialRect?: { x1: number; y1: number; x2: number; y2: number } | null;
      isMoveTool?: boolean;
      hideBlend?: boolean;
      onRepaint?: UseRectProps['onRepaint'];
      onChange?: UseRectProps['onChange'];
      onChangeEnd?: UseRectProps['onChangeEnd'];
    } = {}
  ) {
    const { overlayCanvas, containerElement } = testContext;
    const props: UseRectProps = {
      aspectRatio: options.aspectRatio ?? null,
      imageSize: { width: 800, height: 600 },
      initialRect: options.initialRect ?? null,
      hideBlend: options.hideBlend ?? false,
      isMoveTool: options.isMoveTool ?? false,
      containerRef: { current: containerElement },
      overlayRef: { current: overlayCanvas },
      onRepaint: options.onRepaint ?? vi.fn(),
      onChange: options.onChange ?? vi.fn(),
      onChangeEnd: options.onChangeEnd ?? vi.fn(),
    };
    // The refs are handed back by identity, so a mocked rect util can be asserted against the
    // very object the hook measures through rather than against a re-derived `{ current: canvas }`.
    return { ...renderHook(() => useRect(props)), containerRef: props.containerRef, overlayRef: props.overlayRef };
  }

  it('initializes without initial rect', () => {
    const onRepaint = vi.fn();
    const onChangeEnd = vi.fn();
    const { result } = renderUseRect({ onRepaint, onChangeEnd });
    const target = createMockTarget();

    // Nothing to initialise FROM: with no rect the mount effect finds its two refs already equal
    // and paints nothing, so there is no selection to report either.
    expect(onRepaint).not.toHaveBeenCalled();

    // A press with no box under it finds no edge, so the gesture is a fresh drag and the press is
    // recorded as having landed on nothing — `currentEdgeRef` is `null` for exactly this reason.
    act(() => {
      expect(
        result.current.pointerHandlers.onPointerDown(
          createPointerEvent({ button: 0, clientX: 150, clientY: 150, target })
        )
      ).toBe(false);
    });
    expect(result.current.pointerState.currentEdgeRef.current).toBeNull();

    // The release is the whole gesture: it commits a fresh drag anchored at the press point,
    // which is the only rect this hook ever had.
    act(() => {
      result.current.pointerHandlers.onPointerUp(createPointerEvent({ button: 0, clientX: 300, clientY: 250, target }));
    });
    expect(onChangeEnd).toHaveBeenCalledExactlyOnceWith({ x1: 150, y1: 150, x2: 300, y2: 250 });

    // A hover reports the edge it found to its CALLER and records none: `currentEdgeRef` is a
    // fact about the press, and this hook's only press was erased by its own release. A hover
    // that stored its edge would hand the next `TextToolArea` placement a stale one, and the
    // boolean above already shows the hover found the interior of the rect the release committed.
    act(() => {
      expect(
        result.current.pointerHandlers.onPointerMove(createPointerEvent({ clientX: 200, clientY: 200, target }))
      ).toBe(true);
    });
    expect(result.current.pointerState.currentEdgeRef.current).toBeNull();
  });

  it('initializes with initial rect', () => {
    const initialRect = { x1: 100, y1: 100, x2: 300, y2: 250 };
    const { result } = renderUseRect({ initialRect });
    const target = createMockTarget();

    // The incoming rect IS the box, so a press names the edge it landed on rather than reporting
    // only that it found one. `TextToolArea` decides a fresh placement from
    // `pointerState.currentEdgeRef.current === null`, so the NAME is the contract and the boolean
    // every other suite already reads is not enough to pin it.
    act(() => {
      expect(
        result.current.pointerHandlers.onPointerDown(
          createPointerEvent({ button: 0, clientX: 100, clientY: 100, target })
        )
      ).toBe(true);
    });
    expect(result.current.pointerState.currentEdgeRef.current).toBe('top-left');

    // Interior press on the same box: a move, not a resize, and a different name for it.
    act(() => {
      expect(
        result.current.pointerHandlers.onPointerDown(
          createPointerEvent({ button: 0, clientX: 200, clientY: 175, target })
        )
      ).toBe(true);
    });
    expect(result.current.pointerState.currentEdgeRef.current).toBe('inside');
  });

  it('returns false for pointer down on non-left button', () => {
    const { result } = renderUseRect();
    const event = createPointerEvent({ button: 1, target: createMockTarget() });
    act(() => {
      const res = result.current.pointerHandlers.onPointerDown(event);
      expect(res).toBe(false);
    });
  });

  it('clears selection on clearSelection', () => {
    const onRepaint = vi.fn();
    const { result } = renderUseRect({ initialRect: { x1: 100, y1: 100, x2: 300, y2: 250 }, onRepaint });

    const target = createMockTarget();
    const onCorner = createPointerEvent({ button: 0, clientX: 100, clientY: 100, target });
    act(() => {
      expect(result.current.pointerHandlers.onPointerDown(onCorner)).toBe(true);
    });

    // Both counts are absolute. The relative form below only says the clear published nothing MORE,
    // which any starting count satisfies — including zero, on a hook that never published at all.
    // The mount effect does publish the incoming rect, exactly once, and that is stated here rather
    // than left to be inferred from a number the test reads back off the mock it is asserting on.
    expect(onRepaint).toHaveBeenCalledTimes(1);
    const publishedBeforeClear = onRepaint.mock.calls.length;
    act(() => {
      result.current.rectHandles.clearSelection();
    });
    expect(onRepaint).toHaveBeenCalledTimes(publishedBeforeClear);
    expect(onRepaint).toHaveBeenCalledExactlyOnceWith({ x1: 100, y1: 100, x2: 300, y2: 250 });

    // The selection is gone, so the corner that was a handle no longer reports one.
    act(() => {
      expect(result.current.pointerHandlers.onPointerDown(onCorner)).toBe(false);
    });
  });

  it('redraws on redraw call', () => {
    const initialRect = { x1: 100, y1: 100, x2: 300, y2: 250 };
    const onRepaint = vi.fn();
    const { result } = renderUseRect({ initialRect, onRepaint });

    // Drop the mount effect's own publication, so the count below is the redraw's.
    onRepaint.mockClear();
    act(() => {
      result.current.rectHandles.redraw();
    });

    expect(onRepaint).toHaveBeenCalledExactlyOnceWith(initialRect);
  });

  describe('handlePointerDown', () => {
    it('detects handle clicks on existing rect', () => {
      const initialRect = { x1: 100, y1: 100, x2: 300, y2: 250 };
      const { result } = renderUseRect({ initialRect });

      // (100, 100) is the rect's top-left corner, so it is inside the top-left handle.
      const onCorner = createPointerEvent({ button: 0, clientX: 100, clientY: 100, target: createMockTarget() });
      act(() => {
        expect(result.current.pointerHandlers.onPointerDown(onCorner)).toBe(true);
      });

      // (400, 400) misses the rect entirely, so no edge is found and no resize starts.
      act(() => {
        const onMiss = createPointerEvent({ button: 0, clientX: 400, clientY: 400, target: createMockTarget() });
        expect(result.current.pointerHandlers.onPointerDown(onMiss)).toBe(false);
      });
    });

    it('creates rect from layer when clicking on layer', () => {
      const layer = createMockLayer();
      const onRepaint = vi.fn();
      const { result, overlayRef } = renderUseRect({ onRepaint });

      const event = createPointerEvent({ button: 0, clientX: 150, clientY: 150, target: createMockTarget() });
      act(() => {
        // No selection rect exists yet, so the layer rect is adopted as a move: the pointer is
        // inside it, not on a handle, which is what `isHandleClicked` reports.
        expect(result.current.pointerHandlers.onPointerDown(event, layer)).toBe(false);
      });

      // Proves the layer position was converted and that the adopted rect is what the
      // overlay publishes. `posToSortedRect` is no longer stubbed — the real implementation
      // runs — so this asserts the conversion END TO END instead of that a hand-copy mock was
      // called. The old form (`expect(rectUtilsMock.posToSortedRect).toHaveBeenCalledWith(...)`)
      // could only ever prove the mock was live, never that the conversion was right.
      expect(onRepaint).toHaveBeenLastCalledWith({ x1: 100, y1: 100, x2: 300, y2: 250 });

      // The paint is clamped by a measurement of the hook's own OVERLAY ref, and the real
      // `getCanvasSize(canvasRef)` reads `canvasRef.current.width/height` — so the argument is
      // the REF, by identity, and neither the size it returns nor the `imageSize` prop. A bare
      // `toHaveBeenCalled()` accepted the container ref, a freshly built ref object, or any size.
      // Exactly once, because this hook had no rect on mount and the adoption is the one paint.
      //
      // That one line also rules out the container ref, so a `not.toHaveBeenCalledWith(containerRef)`
      // beside it said nothing the call count and identity had not already said. The claim it did
      // not reach is the one the sibling suite owns: that the measurement is what CLAMPS the paint
      // rather than `imageSize`, which `useRect.drag.test.ts` pins in
      // `clamps the painted geometry to the canvas but reports the unclamped rect` with an
      // `imageSize` deliberately unlike the canvas.
      expect(rectUtilsMock.getCanvasSize).toHaveBeenCalledExactlyOnceWith(overlayRef);
    });

    it('respects aspect ratio modifier keys on drag start', () => {
      const initialRect = { x1: 100, y1: 100, x2: 300, y2: 250 };
      const onChangeEnd = vi.fn();
      const { result } = renderUseRect({ initialRect, onChangeEnd });

      const target = createMockTarget();
      const downEvent = createPointerEvent({
        button: 0,
        clientX: 100,
        clientY: 100,
        ctrlKey: true,
        target,
      });
      act(() => {
        // Ctrl is held over the top-left handle, so the drag starts as a handle resize.
        expect(result.current.pointerHandlers.onPointerDown(downEvent)).toBe(true);
      });
      act(() => {
        result.current.pointerHandlers.onPointerUp(
          createPointerEvent({ button: 0, clientX: 200, clientY: 200, target })
        );
      });

      const committed = onChangeEnd.mock.lastCall?.[0] as { x1: number; y1: number; x2: number; y2: number };
      const width = Math.abs(committed.x2 - committed.x1);
      const height = Math.abs(committed.y2 - committed.y1);
      // 200x150 is the rect's own ratio. A top-left handle drag anchors at the opposite corner
      // (300, 250), so the free drag to (200, 200) would have committed 100x50 = 2:1.
      expect(width / height).toBeCloseTo(200 / 150, 10);
    });
  });

  describe('handlePointerMove', () => {
    it('reports a hit for every handle and edge of the rect, and a miss off it', () => {
      // `isMouseDown` is owned by the (mocked) pointer-position hook and is false here, so a move is
      // a HOVER: it reports whether an edge is under the pointer and resizes nothing. The drag
      // branch is the test below.
      const { result } = renderUseRect({ initialRect: { x1: 100, y1: 100, x2: 300, y2: 250 } });

      // The four corner centres and the four edge midpoints of (100,100)-(300,250) each sit inside
      // their own hit region — the real HANDLE_SIZE is 12, so `HANDLE_SIZE / scale / 2` is 6 here —
      // and (400, 400) is off the rect entirely.
      const hits: Array<[number, number]> = [
        [100, 100],
        [300, 100],
        [100, 250],
        [300, 250],
        [200, 100],
        [300, 175],
        [200, 250],
        [100, 175],
      ];
      for (const [clientX, clientY] of hits) {
        act(() => {
          expect(
            result.current.pointerHandlers.onPointerMove(
              createPointerEvent({ clientX, clientY, target: createMockTarget() })
            ),
            `${clientX},${clientY}`
          ).toBe(true);
        });
      }

      act(() => {
        expect(
          result.current.pointerHandlers.onPointerMove(
            createPointerEvent({ clientX: 400, clientY: 400, target: createMockTarget() })
          )
        ).toBe(false);
      });
    });

    it('resizes on a drag, coalescing the moves that share one animation frame', () => {
      const onChange = vi.fn();
      const onChangeEnd = vi.fn();
      const { result } = renderUseRect({
        initialRect: { x1: 100, y1: 100, x2: 300, y2: 250 },
        onChange,
        onChangeEnd,
      });
      const target = createMockTarget();

      act(() => {
        expect(
          result.current.pointerHandlers.onPointerDown(
            createPointerEvent({ button: 0, clientX: 100, clientY: 100, target })
          )
        ).toBe(true);
      });
      usePointerPositionMock.mockData.isMouseDown.current = true;

      // A handle drag anchors at the opposite corner, so pulling the top-left handle out to (400, 350)
      // grows the rect to (300, 250)-(400, 350).
      act(() => {
        result.current.pointerHandlers.onPointerMove(createPointerEvent({ clientX: 350, clientY: 300, target }));
        result.current.pointerHandlers.onPointerMove(createPointerEvent({ clientX: 400, clientY: 350, target }));
      });
      // Nothing is painted on the event itself, and the two moves share one frame: a single
      // publication, at the LAST point, so a fast drag cannot outrun the frame it scheduled.
      expect(onChange).not.toHaveBeenCalled();
      act(() => {
        vi.advanceTimersByTime(20);
      });
      expect(onChange).toHaveBeenCalledExactlyOnceWith({ x1: 300, y1: 250, x2: 400, y2: 350 });

      act(() => {
        result.current.pointerHandlers.onPointerUp(
          createPointerEvent({ button: 0, clientX: 400, clientY: 350, target })
        );
      });
      expect(onChangeEnd).toHaveBeenCalledExactlyOnceWith({ x1: 300, y1: 250, x2: 400, y2: 350 });
    });

    it('updates cursor on hover over handles', () => {
      const initialRect = { x1: 100, y1: 100, x2: 300, y2: 250 };
      const { result } = renderUseRect({ initialRect });

      // Hovering the top-left handle reports an edge and sets that handle's resize cursor.
      const target = createMockTarget();
      act(() => {
        const res = result.current.pointerHandlers.onPointerMove(
          createPointerEvent({ clientX: 100, clientY: 100, target })
        );
        expect(res).toBe(true);
      });
      // The real `CURSOR_MAP`, so this is the cursor a user gets hovering the top-left handle, not
      // a string this file's own mock invented.
      expect(target.style.cursor).toBe(CURSOR_MAP['top-left']);

      // Off the rect there is no edge and the hover reports none, so the SAME target — which is
      // carrying the handle cursor the hover above just set — has to lose it. A fresh element would
      // satisfy this before the hook ever ran.
      act(() => {
        const res = result.current.pointerHandlers.onPointerMove(
          createPointerEvent({ clientX: 400, clientY: 400, target })
        );
        expect(res).toBe(false);
      });
      expect(target.style.cursor).toBe('');
    });

    it('returns false when not dragging and no hover handler', () => {
      const { result } = renderUseRect();
      const event = createPointerEvent({ clientX: 100, clientY: 100, target: createMockTarget() });
      act(() => {
        const res = result.current.pointerHandlers.onPointerMove(event);
        expect(res).toBe(false);
      });
    });
  });

  describe('handlePointerUp', () => {
    it('does not throw on pointer up after pointer down', () => {
      const onChangeEnd = vi.fn();
      const { result } = renderUseRect({
        initialRect: { x1: 100, y1: 100, x2: 300, y2: 250 },
        onChangeEnd,
      });

      const target = createMockTarget();
      const downEvent = createPointerEvent({ button: 0, clientX: 100, clientY: 100, target });
      act(() => {
        result.current.pointerHandlers.onPointerDown(downEvent);
      });

      const upEvent = createPointerEvent({ button: 0, clientX: 150, clientY: 150, target });
      expect(() => {
        act(() => {
          result.current.pointerHandlers.onPointerUp(upEvent);
        });
      }).not.toThrow();
    });

    it('does nothing on non-left button', () => {
      const onChangeEnd = vi.fn();
      const { result } = renderUseRect({ onChangeEnd });

      const event = createPointerEvent({ button: 1, target: createMockTarget() });
      act(() => {
        result.current.pointerHandlers.onPointerUp(event);
      });

      expect(onChangeEnd).not.toHaveBeenCalled();
    });
  });

  describe('drawMask overlay alpha', () => {
    /**
     * The tool overlay is ONE 2D context for the whole session and every tool area is handed the
     * same object, so a painter that inherits `globalAlpha` renders at a fraction of its intended
     * opacity. The brush default is 0.9, so this is wrong on any session that has drawn anything,
     * not only on one where the user dragged the Opacity slider to 20%.
     */
    function renderWithLeakedAlpha(initialAlpha: number, options: Parameters<typeof renderUseRect>[0] = {}) {
      const { overlayCanvas } = createTestContext();
      const ctx = createMockCanvasContext({ canvas: overlayCanvas, globalAlpha: initialAlpha });
      vi.mocked(overlayCanvas.getContext).mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
      // `renderUseRect` reads `testContext`, so point it at the canvas just rewired.
      testContext.overlayCanvas = overlayCanvas;

      return { ctx, ...renderUseRect({ initialRect: { x1: 100, y1: 100, x2: 300, y2: 250 }, ...options }) };
    }

    it('resets the alpha before the dim fill, so the dim is not scaled by the last stroke', () => {
      const { ctx, result } = renderWithLeakedAlpha(0.2);
      const alphasAtFill: number[] = [];
      vi.mocked(ctx.fillRect).mockImplementation(() => {
        alphasAtFill.push(ctx.globalAlpha);
      });

      act(() => {
        result.current.rectHandles.redraw();
      });

      // 0.7 x 0.2 = 0.14 is a crop boundary the user can barely see.
      expect(alphasAtFill[0]).toBe(1);
      expect(ctx.globalAlpha).toBe(1);
    });

    it('resets the alpha before the stroke and the handles too, not only before the dim', () => {
      const { ctx, result } = renderWithLeakedAlpha(0.2);
      const alphasAtStroke: number[] = [];
      vi.mocked(ctx.strokeRect).mockImplementation(() => {
        alphasAtStroke.push(ctx.globalAlpha);
      });

      act(() => {
        result.current.rectHandles.redraw();
      });

      expect(alphasAtStroke[0]).toBe(1);
    });

    it('resets the alpha on a hideBlend paint, which never fills the dim', () => {
      const { ctx, result } = renderWithLeakedAlpha(0.2, { hideBlend: true });
      const alphasAtStroke: number[] = [];
      vi.mocked(ctx.strokeRect).mockImplementation(() => {
        alphasAtStroke.push(ctx.globalAlpha);
      });

      act(() => {
        result.current.rectHandles.redraw();
      });

      // The reset has to sit BEFORE the `hideBlend` branch, not inside it, or the text tool's
      // border inherits the leak exactly as the crop's dim does.
      expect(alphasAtStroke[0]).toBe(1);
    });

    it('keeps the dash it owns, written after the reset', () => {
      const { ctx, result } = renderWithLeakedAlpha(0.2);
      const alphasAtDash: number[] = [];
      vi.mocked(ctx.setLineDash).mockImplementation(() => {
        alphasAtDash.push(ctx.globalAlpha);
      });

      act(() => {
        result.current.rectHandles.redraw();
      });

      // The dash is `drawMask`'s own state, deliberately not part of the reset, and it is written
      // after it — an outline stroked at the leaked alpha is just as invisible as a dim at it.
      expect(ctx.setLineDash).toHaveBeenCalledWith([5, 5]);
      expect(ctx.setLineDash).toHaveBeenLastCalledWith([]);
      expect(alphasAtDash).toEqual([1, 1]);
    });
  });

  describe('aspect ratio', () => {
    const PRESETS = [
      { label: 'Square 1:1', ratio: 1 },
      { label: '3:4', ratio: 3 / 4 },
      { label: '4:3', ratio: 4 / 3 },
      { label: '16:9', ratio: 16 / 9 },
      { label: '9:16', ratio: 9 / 16 },
    ];

    type SortedRect = { x1: number; y1: number; x2: number; y2: number };

    /**
     * One drag in each direction `adjustFreePoint` branches on, plus one that does not start
     * at the origin, so the quadrant and the anchor handling are both exercised.
     */
    const DRAGS = [
      { from: { x: 0, y: 0 }, to: { x: 200, y: 200 } },
      { from: { x: 200, y: 200 }, to: { x: 0, y: 0 } },
      { from: { x: 0, y: 200 }, to: { x: 200, y: 0 } },
      { from: { x: 200, y: 0 }, to: { x: 0, y: 200 } },
      { from: { x: 40, y: 90 }, to: { x: 310, y: 130 } },
    ];

    /**
     * Drives one free drag and returns the two rects the user could disagree about: the one
     * `onChangeEnd` commits (which becomes the store's `rect`, and what `Apply` hands to
     * `applyDocumentCrop`) and the one the overlay actually paints (the last `onRepaint`).
     */
    function dragWithRatio(aspectRatio: number, from: Point, to: Point) {
      const onChangeEnd = vi.fn();
      const onRepaint = vi.fn();
      const { result } = renderUseRect({ aspectRatio, onChangeEnd, onRepaint });
      const target = createMockTarget();

      act(() => {
        result.current.pointerHandlers.onPointerDown(
          createPointerEvent({ button: 0, clientX: from.x, clientY: from.y, target })
        );
      });
      act(() => {
        result.current.pointerHandlers.onPointerMove(createPointerEvent({ clientX: to.x, clientY: to.y, target }));
      });
      act(() => {
        vi.advanceTimersByTime(20);
      });
      act(() => {
        result.current.pointerHandlers.onPointerUp(
          createPointerEvent({ button: 0, clientX: to.x, clientY: to.y, target })
        );
      });

      return {
        committed: onChangeEnd.mock.lastCall?.[0] as SortedRect,
        painted: onRepaint.mock.lastCall?.[0] as SortedRect,
      };
    }

    /**
     * Width and height WITHOUT `Math.abs`. These are only the width and height of a rect
     * that is sorted, so they assert sortedness as a side effect: an unsorted rect gives
     * a negative extent and every ratio below fails. Computing them with `Math.abs` made
     * the assertions true whether or not the real geometry ran, which is what let the
     * inverted drags in `DRAGS` pass under an identity `sortRect` stub.
     */
    const width = ({ x1, x2 }: SortedRect) => x2 - x1;
    const height = ({ y1, y2 }: SortedRect) => y2 - y1;

    /** The one property the identity stub used to neutralise. */
    const expectSorted = (rect: SortedRect, context: string) => {
      expect(rect.x2, `x2 >= x1 (${context})`).toBeGreaterThanOrEqual(rect.x1);
      expect(rect.y2, `y2 >= y1 (${context})`).toBeGreaterThanOrEqual(rect.y1);
    };

    it.each(PRESETS)('constrains a $label free drag to the preset in every direction', ({ ratio }) => {
      // Documents `adjustFreePoint`'s own relation, which was always right. The defect was
      // elsewhere: the effect's refit enforced the RECIPROCAL, so this rect was reshaped on the
      // way back in. See the round-trip test below for the guard on that.
      for (const { from, to } of DRAGS) {
        const { committed } = dragWithRatio(ratio, from, to);
        const label = `${from.x},${from.y} -> ${to.x},${to.y}`;

        expectSorted(committed, label);
        expect(width(committed) / height(committed), label).toBeCloseTo(ratio, 10);
      }
    });

    it.each(DRAGS)('commits a sorted rect for the $from -> $to drag', ({ from, to }) => {
      // The inverted drags are the whole point: `adjustFreePoint` returns `x2 < x1` for a
      // right-to-left drag, and the ONLY thing that turns that into a usable rect is the
      // `sortRect` in `handlePointerUp`. Under an identity stub the commit path published
      // the inverted rect unchanged, and every ratio assertion still passed because it
      // measured with `Math.abs`.
      const { committed } = dragWithRatio(1, from, to);

      expectSorted(committed, `${from.x},${from.y} -> ${to.x},${to.y}`);
      expect(width(committed)).toBeGreaterThan(0);
      expect(height(committed)).toBeGreaterThan(0);
    });

    it.each(PRESETS)('commits and repaints the same $label rect across the store round trip', ({ ratio }) => {
      // The regression this replaces, and the reproduction of it: `adjustWidthRatio` enforced
      // `width = height / ratio` while the drag that produced the rect enforced the reciprocal, so
      // the effect that refits `initialRect` reshaped the rect the overlay had just published and
      // repainted it. Measured on a (0,0) -> (200,200) drag, the old code gave 3:4 as store
      // w=150 / painted w=266.67 and 16:9 as store w=200 / painted w=63.28. The user saw one
      // shape, `Apply` committed another, and the committed one won.
      //
      // `CropToolArea` performs exactly this round trip: `onChangeEnd`'s payload becomes the next
      // `initialRect`. One drag per preset is enough here — the refit is the same helper for every
      // direction, and `adjustFreePoint`'s direction handling is covered above, so multiplying this
      // by the drag matrix only multiplied render cost.
      const { committed, painted } = dragWithRatio(ratio, DRAGS[0].from, DRAGS[0].to);

      // The overlay already painted the committed shape, so the two the user could disagree
      // about are equal before the round trip even happens.
      expect(painted).toEqual(committed);

      const onRepaint = vi.fn();
      const { result } = renderUseRect({ aspectRatio: ratio, initialRect: committed, onRepaint });
      act(() => {
        result.current.rectHandles.redraw();
      });

      // The fixed point, stated against the shared helper the hook now uses, and then the
      // effect's observable consequence: feeding the committed rect back in repaints it
      // unchanged instead of refitting it to the reciprocal.
      expect(committed).toEqual({ ...committed, ...refitRectWidthToAspect(committed, ratio) });
      expect(onRepaint).toHaveBeenLastCalledWith(committed);
    });

    it('derives the width from the height and keeps the drag anchor, rather than recentring', () => {
      // A free drag is ANCHORED at the pointer down, so it is not the same operation as the
      // panel's refit, which recentres about the horizontal middle. The two share only the
      // `width = height * ratio` relation, and conflating them is how the refit ends up a second
      // copy of the drag.
      const { committed } = dragWithRatio(1, { x: 0, y: 40 }, { x: 300, y: 240 });

      expect(committed).toEqual({ x1: 0, y1: 40, x2: 200, y2: 240 });
    });

    it('fits a 3:4 drag to 3:4, not to its 4:3 reciprocal', () => {
      // The panel's own refit used to mirror the hook's, so picking "3:4" in the panel yielded a
      // 4:3 rect: a second, independent user-visible half of the same inversion.
      const { committed } = dragWithRatio(3 / 4, { x: 0, y: 0 }, { x: 300, y: 200 });

      // width/height = 1.5 > 0.75, so the width is derived: 200 * 0.75 = 150, anchored at x1 = 0.
      expect(committed).toEqual({ x1: 0, y1: 0, x2: 150, y2: 200 });
    });

    it('leaves a Free (null ratio) drag unconstrained', () => {
      const { committed } = dragWithRatio(0, { x: 0, y: 0 }, { x: 200, y: 200 });

      // 0 is falsy, so it is the "no constraint" case and not a zero-width collapse.
      expect(committed).toEqual({ x1: 0, y1: 0, x2: 200, y2: 200 });
    });

    it('repaints an unchanged rect when the committed one is fed back as initialRect', () => {
      // The single-preset form of the round trip above, kept because 16:9 is the preset a real
      // session hits first and its failure was the most extreme (painted w=63.28 for a store
      // w=200 on a 112.5-tall rect).
      const onRepaint = vi.fn();
      const { committed } = dragWithRatio(16 / 9, { x: 20, y: 30 }, { x: 220, y: 230 });

      onRepaint.mockClear();
      const { result } = renderUseRect({ aspectRatio: 16 / 9, initialRect: committed, onRepaint });
      act(() => {
        result.current.rectHandles.redraw();
      });

      expect(onRepaint).toHaveBeenLastCalledWith(committed);
    });

    it('refits a wide incoming rect by narrowing it, leaving the height alone', () => {
      // The panel's case: a rect the user drew free, refitted because a ratio was just chosen.
      // 16:9 rather than 1:1, because 1:1 is a fixed point of the old inverted refit too — which
      // is why the inversion survived as long as it did.
      const initialRect = { x1: 0, y1: 40, x2: 300, y2: 240 };
      const onRepaint = vi.fn();
      const { result } = renderUseRect({ aspectRatio: 16 / 9, initialRect, onRepaint });

      act(() => {
        result.current.rectHandles.redraw();
      });

      // Height 200 held, width 200 * 16/9 = 355.555…, centred on x=150. The old inverted refit
      // asked for `200 / (16/9)` = 112.5 and NARROWED the rect instead, which is how picking
      // "16:9" could leave a 300-wide rect 112 wide.
      expect(onRepaint).toHaveBeenLastCalledWith(
        expect.objectContaining({ x1: -27.77777777777777, y1: 40, x2: 327.77777777777777, y2: 240 })
      );
      expect(onRepaint).toHaveBeenLastCalledWith({ ...initialRect, ...refitRectWidthToAspect(initialRect, 16 / 9) });
    });

    it('locks the aspect ratio from a modifier key pressed at drag start', () => {
      // Ctrl/Shift/Command on pointer down pins the ratio to the rect's own, so a free drag then
      // keeps that shape whatever the pointer does. Without a constraint the drag would reshape
      // it, which is the difference between locking and not.
      const initialRect = { x1: 100, y1: 100, x2: 300, y2: 250 };
      const onChangeEnd = vi.fn();
      const { result } = renderUseRect({ initialRect, onChangeEnd });
      const target = createMockTarget();

      act(() => {
        result.current.pointerHandlers.onPointerDown(
          createPointerEvent({ button: 0, clientX: 100, clientY: 100, ctrlKey: true, target })
        );
      });
      act(() => {
        result.current.pointerHandlers.onPointerMove(createPointerEvent({ clientX: 200, clientY: 200, target }));
      });
      act(() => {
        result.current.pointerHandlers.onPointerUp(
          createPointerEvent({ button: 0, clientX: 200, clientY: 200, target })
        );
      });

      const committed = onChangeEnd.mock.lastCall?.[0] as SortedRect;
      // 200x150 is the initial rect's own ratio, held through a drag that is not 4:3.
      expectSorted(committed, 'ctrl-locked drag');
      expect(width(committed) / height(committed)).toBeCloseTo(200 / 150, 10);
    });

    it('keeps a top-edge resize at the ratio while the width is derived from the height', () => {
      // The `top`/`bottom` branch derives the width, so it is the one that shares
      // `refitRectWidthToAspect` with a free drag. Dragging the top edge of a 200x150 rect (4:3)
      // up by 50 must give a 200x200 square, not a 4:3 one.
      const initialRect = { x1: 100, y1: 100, x2: 300, y2: 250 };
      const onChangeEnd = vi.fn();
      const { result } = renderUseRect({ initialRect, aspectRatio: 1, onChangeEnd });
      const target = createMockTarget();

      act(() => {
        result.current.pointerHandlers.onPointerDown(
          createPointerEvent({ button: 0, clientX: 200, clientY: 100, target })
        );
      });
      act(() => {
        result.current.pointerHandlers.onPointerMove(createPointerEvent({ clientX: 200, clientY: 50, target }));
      });
      act(() => {
        result.current.pointerHandlers.onPointerUp(
          createPointerEvent({ button: 0, clientX: 200, clientY: 50, target })
        );
      });

      const committed = onChangeEnd.mock.lastCall?.[0] as SortedRect;
      expectSorted(committed, 'top-edge resize');
      expect(height(committed)).toBe(200);
      expect(width(committed)).toBe(200);
    });

    it('keeps a right-edge resize at the ratio while the height is derived from the width', () => {
      // The `left`/`right` branch is the mirror: the width is free, so the height is derived as
      // `width / ratio`, which is the convention `adjustHeightRatio` already used correctly. The
      // handle is on the ratio-ALREADY-REFITTED rect, because the mount effect refits
      // `initialRect` before the first pointer down.
      const onChangeEnd = vi.fn();
      const { result } = renderUseRect({
        initialRect: { x1: 100, y1: 100, x2: 300, y2: 250 },
        aspectRatio: 1,
        onChangeEnd,
      });
      const target = createMockTarget();

      act(() => {
        result.current.pointerHandlers.onPointerDown(
          createPointerEvent({ button: 0, clientX: 275, clientY: 175, target })
        );
      });
      act(() => {
        result.current.pointerHandlers.onPointerMove(createPointerEvent({ clientX: 475, clientY: 175, target }));
      });
      act(() => {
        result.current.pointerHandlers.onPointerUp(
          createPointerEvent({ button: 0, clientX: 475, clientY: 175, target })
        );
      });

      const committed = onChangeEnd.mock.lastCall?.[0] as SortedRect;
      expectSorted(committed, 'right-edge resize');
      expect(width(committed)).toBe(350);
      expect(height(committed)).toBe(350);
    });
  });
});
