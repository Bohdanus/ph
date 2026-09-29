import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useRect, type UseRectProps } from '../useRect.ts';
import { createPointerEvent } from '@/__tests__/fixtures/pointer.ts';
import { createMockCanvas, createMockCanvasContext } from '@/__tests__/fixtures/canvas.ts';
import { refitRectWidthToAspect } from '@/util/rect-aspect.ts';
import type { Point } from '@/contexts/general-types.ts';

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
  };
});

vi.mock('../usePointerPosition.ts', () => usePointerPositionMock);

const rectUtilsMock = vi.hoisted(() => ({
  getCanvasSize: vi.fn(() => ({ width: 800, height: 600 })),
  posToSortedRect: vi.fn((pos) => ({ x1: pos.x, y1: pos.y, x2: pos.x + pos.width, y2: pos.y + pos.height })),
}));

// The path resolves: `useRect.ts` imports `'../util/rect.ts'` from `src/hooks/`, which is
// the same `src/util/rect.ts` this resolves to, so the mock IS live. Only the two
// geometry helpers are stubbed, and only because the canvas size they are trimmed
// against is otherwise read off a real canvas. `sortRect` and `trimRect` delegate to the
// real implementations: stubbing them as identity made the whole aspect-ratio block
// invariant to whether sorting ran at all, which is the one thing that block exists to
// pin. `trimRect` internally calls `sortRect` as well, so an identity stub there
// neutralised both the commit path and the paint path.
vi.mock('../../util/rect.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../util/rect.ts')>();
  return {
    ...actual,
    getCanvasSize: rectUtilsMock.getCanvasSize,
    posToSortedRect: rectUtilsMock.posToSortedRect,
  };
});

const constantsMock = vi.hoisted(() => {
  const CURSOR_MAP = {
    'top-left': 'nw-resize',
    'top-right': 'ne-resize',
    'bottom-left': 'sw-resize',
    'bottom-right': 'se-resize',
    top: 'n-resize',
    right: 'e-resize',
    bottom: 's-resize',
    left: 'w-resize',
    inside: 'move',
  } as const;

  return {
    CURSOR_MAP,
    HANDLE_SIZE: 8,
  };
});

vi.mock('../../util/constants.ts', () => constantsMock);

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
    return renderHook(() => useRect(props));
  }

  it('initializes without initial rect', () => {
    const { result } = renderUseRect();
    expect(result.current.onPointerDown).toBeDefined();
    expect(result.current.onPointerMove).toBeDefined();
    expect(result.current.onPointerUp).toBeDefined();
    expect(result.current.redraw).toBeDefined();
    expect(result.current.clearSelection).toBeDefined();
  });

  it('initializes with initial rect', () => {
    const initialRect = { x1: 100, y1: 100, x2: 300, y2: 250 };
    const { result } = renderUseRect({ initialRect });
    expect(result.current.onPointerDown).toBeDefined();
  });

  it('returns false for pointer down on non-left button', () => {
    const { result } = renderUseRect();
    const event = createPointerEvent({ button: 1, target: createMockTarget() });
    act(() => {
      const res = result.current.onPointerDown(event);
      expect(res).toBe(false);
    });
  });

  it('clears selection on clearSelection', () => {
    const onRepaint = vi.fn();
    const { result } = renderUseRect({
      initialRect: { x1: 100, y1: 100, x2: 300, y2: 250 },
      onRepaint,
    });
    // Seed the rect so the clear is observable at all: the mount effect paints it.
    expect(onRepaint).toHaveBeenLastCalledWith({ x1: 100, y1: 100, x2: 300, y2: 250 });
    onRepaint.mockClear();

    act(() => {
      result.current.clearSelection();
    });

    // `drawMask` returns at `if (!rect) return`, which is above the `onRepaint` call, so
    // a cleared selection is observable as the repainting of the rect stopping. An
    // empty `clearSelection` would leave the rect in place and repaint it.
    expect(onRepaint).not.toHaveBeenCalled();
  });

  it('redraws on redraw call', () => {
    const onRepaint = vi.fn();
    // A rect is required: with none, `drawMask` returns before `onRepaint` and the call
    // would be indistinguishable from a no-op.
    const { result } = renderUseRect({
      initialRect: { x1: 100, y1: 100, x2: 300, y2: 250 },
      onRepaint,
    });
    onRepaint.mockClear();

    act(() => {
      result.current.redraw();
    });

    expect(onRepaint).toHaveBeenCalledExactlyOnceWith({ x1: 100, y1: 100, x2: 300, y2: 250 });
  });

  describe('handlePointerDown', () => {
    it('detects handle clicks on existing rect', () => {
      const initialRect = { x1: 100, y1: 100, x2: 300, y2: 250 };
      const { result } = renderUseRect({ initialRect });

      const event = createPointerEvent({ button: 0, clientX: 100, clientY: 100, target: createMockTarget() });
      act(() => {
        const res = result.current.onPointerDown(event);
        expect(typeof res).toBe('boolean');
      });
    });

    it('creates rect from layer when clicking on layer', () => {
      const layer = createMockLayer();
      const { result } = renderUseRect();

      const event = createPointerEvent({ button: 0, clientX: 150, clientY: 150, target: createMockTarget() });
      act(() => {
        const res = result.current.onPointerDown(event, layer);
        expect(typeof res).toBe('boolean');
      });

      // Proves the rect-helper mock is live and the layer position was converted.
      expect(rectUtilsMock.posToSortedRect).toHaveBeenCalledWith(layer.pos);
      expect(result.current.onPointerUp).toBeDefined();
    });

    it('respects aspect ratio modifier keys on drag start', () => {
      const initialRect = { x1: 100, y1: 100, x2: 300, y2: 250 };
      const { result } = renderUseRect({ initialRect });

      const event = createPointerEvent({
        button: 0,
        clientX: 100,
        clientY: 100,
        ctrlKey: true,
        target: createMockTarget(),
      });
      act(() => {
        const res = result.current.onPointerDown(event);
        expect(typeof res).toBe('boolean');
      });
    });

    it('starts drag on handle click', () => {
      const initialRect = { x1: 100, y1: 100, x2: 300, y2: 250 };
      const { result } = renderUseRect({ initialRect });

      const target = createMockTarget();
      const downEvent = createPointerEvent({ button: 0, clientX: 100, clientY: 100, target });
      act(() => {
        result.current.onPointerDown(downEvent);
      });

      const moveEvent = createPointerEvent({ button: 0, clientX: 120, clientY: 120, target });
      act(() => {
        const res = result.current.onPointerMove(moveEvent);
        expect(typeof res).toBe('boolean');
      });
    });
  });

  describe('handlePointerMove', () => {
    it('updates cursor on hover over handles', () => {
      const initialRect = { x1: 100, y1: 100, x2: 300, y2: 250 };
      const { result } = renderUseRect({ initialRect });

      const event = createPointerEvent({ clientX: 100, clientY: 100, target: createMockTarget() });
      act(() => {
        const res = result.current.onPointerMove(event);
        expect(typeof res).toBe('boolean');
      });
    });

    it('returns false when not dragging and no hover handler', () => {
      const { result } = renderUseRect();
      const event = createPointerEvent({ clientX: 100, clientY: 100, target: createMockTarget() });
      act(() => {
        const res = result.current.onPointerMove(event);
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
        result.current.onPointerDown(downEvent);
      });

      const upEvent = createPointerEvent({ button: 0, clientX: 150, clientY: 150, target });
      expect(() => {
        act(() => {
          result.current.onPointerUp(upEvent);
        });
      }).not.toThrow();
    });

    it('does nothing on non-left button', () => {
      const onChangeEnd = vi.fn();
      const { result } = renderUseRect({ onChangeEnd });

      const event = createPointerEvent({ button: 1, target: createMockTarget() });
      act(() => {
        result.current.onPointerUp(event);
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
        result.current.redraw();
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
        result.current.redraw();
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
        result.current.redraw();
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
        result.current.redraw();
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
        result.current.onPointerDown(createPointerEvent({ button: 0, clientX: from.x, clientY: from.y, target }));
      });
      act(() => {
        result.current.onPointerMove(createPointerEvent({ clientX: to.x, clientY: to.y, target }));
      });
      act(() => {
        vi.advanceTimersByTime(20);
      });
      act(() => {
        result.current.onPointerUp(createPointerEvent({ button: 0, clientX: to.x, clientY: to.y, target }));
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
        result.current.redraw();
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
        result.current.redraw();
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
        result.current.redraw();
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
        result.current.onPointerDown(
          createPointerEvent({ button: 0, clientX: 100, clientY: 100, ctrlKey: true, target })
        );
      });
      act(() => {
        result.current.onPointerMove(createPointerEvent({ clientX: 200, clientY: 200, target }));
      });
      act(() => {
        result.current.onPointerUp(createPointerEvent({ button: 0, clientX: 200, clientY: 200, target }));
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
        result.current.onPointerDown(createPointerEvent({ button: 0, clientX: 200, clientY: 100, target }));
      });
      act(() => {
        result.current.onPointerMove(createPointerEvent({ clientX: 200, clientY: 50, target }));
      });
      act(() => {
        result.current.onPointerUp(createPointerEvent({ button: 0, clientX: 200, clientY: 50, target }));
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
        result.current.onPointerDown(createPointerEvent({ button: 0, clientX: 275, clientY: 175, target }));
      });
      act(() => {
        result.current.onPointerMove(createPointerEvent({ clientX: 475, clientY: 175, target }));
      });
      act(() => {
        result.current.onPointerUp(createPointerEvent({ button: 0, clientX: 475, clientY: 175, target }));
      });

      const committed = onChangeEnd.mock.lastCall?.[0] as SortedRect;
      expectSorted(committed, 'right-edge resize');
      expect(width(committed)).toBe(350);
      expect(height(committed)).toBe(350);
    });
  });
});
