import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PointerEvent } from 'react';
import { isDocumentGestureOpen, readDocumentGesture, resetDocumentGestures } from '../../../hooks/document-gesture.ts';
import { ShapeToolArea } from '../ShapeToolArea.tsx';
import { normalizeShapeGeometry, shapeGeometryBounds, type FigureType } from '../../../tools/shape.ts';

const createLayerFromToolMock = vi.hoisted(() => vi.fn());
const drawShapeMock = vi.hoisted(() => vi.fn());
const setShapeCtxMock = vi.hoisted(() => vi.fn());

const createPointerState = vi.hoisted(() => () => ({
  isMouseDown: { current: false },
  moveValid: true,
  activePointer: null as number | null | undefined,
}));
const createToolArgsState = vi.hoisted(() => () => ({
  toolArgs: {
    toolName: 'shape',
    figure: 'rectangle',
    color: '#000000',
    backgroundColor: null,
    alpha: 1,
    lineWidth: 2,
    cornerRadius: 0,
  },
}));
const createStoreMocks = vi.hoisted(() => () => {
  const canvas = document.createElement('canvas');
  // Deliberately NOT the store's `totalSize` (800x600) below. The teardown clears the whole
  // backing store, and a clear sized off a render-scope value would cover a different region than
  // the one the preview is painted on, so the two must be distinguishable in the assertions. The
  // container's rect stays 800x600 because that is what `getLocalCoords` reads and therefore what
  // fixes the dragged geometry.
  canvas.width = 640;
  canvas.height = 480;
  const ctx = {
    canvas,
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    arc: vi.fn(),
    closePath: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    scale: vi.fn(),
    rotate: vi.fn(),
    setTransform: vi.fn(),
    drawImage: vi.fn(),
    getImageData: vi.fn(),
    putImageData: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
  const container = document.createElement('div');
  const cr = { left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0, toJSON: () => {} };
  container.getBoundingClientRect = vi.fn(() => cr);
  return { canvas, ctx, container, cr };
});

const promptMock = vi.hoisted(() => vi.fn());

// Non-zero on purpose: a zero-origin frame makes document and canvas coordinates identical, so a
// conversion that dropped the offset would still satisfy every assertion in this file.
const DOCUMENT_FRAME = { x: 30, y: 40, width: 800, height: 600 };

const storeState = vi.hoisted(
  (): { documentFrame: { x: number; y: number; width: number; height: number } | null } => ({
    documentFrame: null,
  })
);

vi.mock('../../../contexts/StoreContext.tsx', () => ({
  useStore: () => [
    {
      containerRef: { current: storeMocks.container },
      toolOverlayRef: { current: storeMocks.canvas },
      totalSize: { width: 800, height: 600 },
      get documentFrame() {
        return storeState.documentFrame;
      },
    },
    vi.fn(),
  ],
}));

vi.mock('../../../contexts/useLayer.ts', () => ({
  useLayers: () => ({ createLayerFromTool: createLayerFromToolMock }),
}));

vi.mock('../../../contexts/useCurrentTool.tsx', () => ({
  useCurrentTool: () => ({
    toolArgs: toolArgsState.toolArgs,
  }),
}));

/**
 * The pointer capture contract, faithfully: the first press claims the pointer and only that
 * pointer's move and release are valid. A mock that accepted every event would make "a foreign
 * pointer's release must not hand the document back" unobservable, which is one of the things the
 * gesture gate pins.
 *
 * The `button` check on the release mirrors `usePointerPosition.isPointerUpValid`, which now
 * refuses a non-primary release exactly as `isPointerDownValid` refuses a non-primary press. The
 * check used to be stricter than the real hook, which made a suite asserting a non-primary release
 * as ignored a guard for behaviour the product did not have; the hook was made symmetric instead.
 */
vi.mock('../../../hooks/usePointerPosition.ts', () => ({
  usePointerPosition: () => ({
    pointerIdRef: { current: null },
    isPointerDownValid: vi.fn((event: PointerEvent) => {
      if (event.button !== 0) return false;
      if (pointerState.activePointer !== null) return false;
      pointerState.isMouseDown.current = true;
      pointerState.activePointer = event.pointerId;
      return true;
    }),
    isPointerMoveValid: vi.fn(() => pointerState.isMouseDown.current && pointerState.moveValid),
    isPointerUpValid: vi.fn((event: PointerEvent) => {
      if (event.button !== 0) return false;
      if (pointerState.activePointer !== event.pointerId) return false;
      pointerState.activePointer = null;
      pointerState.isMouseDown.current = false;
      return true;
    }),
    getLocalCoords: vi.fn((event: PointerEvent) => ({ x: event.clientX, y: event.clientY })),
    isMouseDown: pointerState.isMouseDown,
  }),
}));

vi.mock('../../../tools/shape.ts', async () => ({
  ...(await vi.importActual<typeof import('../../../tools/shape.ts')>('../../../tools/shape.ts')),
  drawShape: drawShapeMock,
  setShapeCtx: setShapeCtxMock,
}));

let pointerState: ReturnType<typeof createPointerState>;
let toolArgsState: ReturnType<typeof createToolArgsState>;
let storeMocks: ReturnType<typeof createStoreMocks>;

type Point = { x: number; y: number };
type DragModifiers = { shiftKey?: boolean; altKey?: boolean };
type CommittedLayer = {
  args: { start: Point; end: Point };
  pos: { x: number; y: number; width: number; height: number };
};

const renderToolArea = () => {
  const view = render(<ShapeToolArea overlayCtxRef={{ current: storeMocks.ctx }} />);
  return { view, toolArea: view.container.firstElementChild as HTMLDivElement };
};

/**
 * Presses, drags and releases once. `altKey` is only read on pointer down
 * (it latches `fromCenterRef`), but it is forwarded on every event the way a
 * real pointer would.
 */
const dragOnce = (
  toolArea: HTMLElement,
  from: Point,
  to: Point,
  { shiftKey = false, altKey = false }: DragModifiers = {}
) => {
  act(() => {
    fireEvent.pointerDown(toolArea, { button: 0, clientX: from.x, clientY: from.y, altKey });
  });
  act(() => {
    fireEvent.pointerMove(toolArea, { button: 0, clientX: to.x, clientY: to.y, shiftKey, altKey });
  });
  act(() => {
    fireEvent.pointerUp(toolArea, { button: 0, clientX: to.x, clientY: to.y, shiftKey, altKey });
  });
  return createLayerFromToolMock.mock.calls[0][0] as {
    args: { start: Point; end: Point; figure: FigureType };
    pos: { x: number; y: number; width: number; height: number };
  };
};

/** Recovers the document-space geometry from the rebased layer args and their origin. */
const committedGeometry = ({ args, pos }: CommittedLayer) => ({
  start: { x: args.start.x + pos.x, y: args.start.y + pos.y },
  end: { x: args.end.x + pos.x, y: args.end.y + pos.y },
});

const toDocument = (point: Point): Point => ({
  x: point.x + DOCUMENT_FRAME.x,
  y: point.y + DOCUMENT_FRAME.y,
});

const toDocumentShape = ({ start, end }: { start: Point; end: Point }) => ({
  start: toDocument(start),
  end: toDocument(end),
});

const midPoint = ({ start, end }: { start: Point; end: Point }): Point => ({
  x: (start.x + end.x) / 2,
  y: (start.y + end.y) / 2,
});

describe('ShapeToolArea', () => {
  beforeEach(() => {
    pointerState = createPointerState();
    toolArgsState = createToolArgsState();
    storeMocks = createStoreMocks();
    storeState.documentFrame = DOCUMENT_FRAME;
    createLayerFromToolMock.mockClear();
    drawShapeMock.mockClear();
    setShapeCtxMock.mockClear();
    promptMock.mockReset();
    vi.spyOn(globalThis, 'prompt').mockImplementation(promptMock);
    promptMock.mockReturnValue(null);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('rendering', () => {
    it('renders a div with the provided className and cursor-draw class', () => {
      const { container } = render(<ShapeToolArea className="my-shape" overlayCtxRef={{ current: storeMocks.ctx }} />);
      const el = container.firstElementChild as HTMLDivElement;
      expect(el).not.toBeNull();
      expect(el.className).toBe('my-shape cursor-draw');
    });

    it('does not throw when className is omitted', () => {
      expect(() => render(<ShapeToolArea overlayCtxRef={{ current: storeMocks.ctx }} />)).not.toThrow();
    });
  });

  describe('keyboard handling', () => {
    it('registers and removes window keydown/keyup listeners', () => {
      const addSpy = vi.spyOn(window, 'addEventListener');
      const removeSpy = vi.spyOn(window, 'removeEventListener');

      const { unmount } = render(<ShapeToolArea overlayCtxRef={{ current: storeMocks.ctx }} />);

      expect(addSpy).toHaveBeenCalledWith('keydown', expect.any(Function));
      expect(addSpy).toHaveBeenCalledWith('keyup', expect.any(Function));

      unmount();

      expect(removeSpy).toHaveBeenCalledWith('keydown', expect.any(Function));
      expect(removeSpy).toHaveBeenCalledWith('keyup', expect.any(Function));
    });

    it('toggles pan mode via Space key', () => {
      vi.useFakeTimers();
      const { container } = render(<ShapeToolArea overlayCtxRef={{ current: storeMocks.ctx }} />);
      const toolArea = container.firstElementChild as HTMLDivElement;

      // Normal shape (no Space)
      act(() => {
        fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 20 });
      });
      act(() => {
        fireEvent.pointerMove(toolArea, { button: 0, clientX: 50, clientY: 60 });
      });
      act(() => {
        fireEvent.pointerUp(toolArea, { button: 0, clientX: 50, clientY: 60 });
      });

      expect(createLayerFromToolMock).toHaveBeenCalledTimes(1);
      const firstCall = createLayerFromToolMock.mock.calls[0][0];
      expect(firstCall.args.start).toEqual({ x: 2, y: 2 });
      expect(firstCall.args.end).toEqual({ x: 42, y: 42 });

      // Press Space — first move sets originalShapeRef, second move pans
      act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }));
      });

      act(() => {
        fireEvent.pointerDown(toolArea, { button: 0, clientX: 100, clientY: 100 });
      });
      act(() => {
        fireEvent.pointerMove(toolArea, { button: 0, clientX: 120, clientY: 110 });
      });
      act(() => {
        fireEvent.pointerMove(toolArea, { button: 0, clientX: 150, clientY: 140 });
      });
      act(() => {
        fireEvent.pointerUp(toolArea, { button: 0, clientX: 150, clientY: 140 });
      });

      const secondCall = createLayerFromToolMock.mock.calls[1][0];
      // Pan: delta from second move = (150-120, 140-110) = (30, 30)
      // start was (100, 100), end was (120, 110)
      // After pan: start = (130, 130), end = (150, 140)
      // pos = { min(130,150)-2+30, min(130,140)-2+40, |130-150|+4, |130-140|+4 } = {158, 168, 24, 14}
      // adjusted start = (160-158, 170-168) = (2, 2)
      // adjusted end = (180-158, 180-168) = (22, 12)
      expect(secondCall.args.start).toEqual({ x: 2, y: 2 });
      expect(secondCall.args.end).toEqual({ x: 22, y: 12 });

      // Release Space — pan mode disabled
      act(() => {
        window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space' }));
      });

      act(() => {
        fireEvent.pointerDown(toolArea, { button: 0, clientX: 200, clientY: 200 });
      });
      act(() => {
        fireEvent.pointerMove(toolArea, { button: 0, clientX: 240, clientY: 230 });
      });
      act(() => {
        fireEvent.pointerUp(toolArea, { button: 0, clientX: 240, clientY: 230 });
      });

      const thirdCall = createLayerFromToolMock.mock.calls[2][0];
      // Normal mode: start = (200, 200), pos = {198+30, 198+40, 44, 34}
      expect(thirdCall.args.start).toEqual({ x: 2, y: 2 });
      expect(thirdCall.args.end).toEqual({ x: 42, y: 32 });
    });

    it('ignores key events that are not Space', () => {
      const { container } = render(<ShapeToolArea overlayCtxRef={{ current: storeMocks.ctx }} />);
      const toolArea = container.firstElementChild as HTMLDivElement;

      act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyA' }));
        window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyA' }));
      });

      // Normal shape — start should match the pointer-down point (not panned)
      act(() => {
        fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 20 });
      });
      act(() => {
        fireEvent.pointerMove(toolArea, { button: 0, clientX: 50, clientY: 60 });
      });
      act(() => {
        fireEvent.pointerUp(toolArea, { button: 0, clientX: 50, clientY: 60 });
      });

      const callArgs = createLayerFromToolMock.mock.calls[0][0];
      expect(callArgs.args.start).toEqual({ x: 2, y: 2 });
      expect(callArgs.args.end).toEqual({ x: 42, y: 42 });
    });
  });

  describe('pointer down', () => {
    it('ignores pointer down with non-left button', () => {
      const { container } = render(<ShapeToolArea overlayCtxRef={{ current: storeMocks.ctx }} />);
      const toolArea = container.firstElementChild as HTMLDivElement;

      act(() => {
        fireEvent.pointerDown(toolArea, { button: 1, clientX: 10, clientY: 20 });
      });

      expect(setShapeCtxMock).not.toHaveBeenCalled();
    });

    it('configures the shape context for the preview paint, not once at pointer down', () => {
      vi.useFakeTimers();
      const { container } = render(<ShapeToolArea overlayCtxRef={{ current: storeMocks.ctx }} />);
      const toolArea = container.firstElementChild as HTMLDivElement;

      act(() => {
        fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 20 });
      });

      // Nothing is painted yet, so nothing is configured yet either. The bracket that keeps
      // `setShapeCtx`'s alpha off the shared overlay lives around the paint, which is what makes
      // per-paint bracketing possible at all.
      expect(setShapeCtxMock).not.toHaveBeenCalled();

      act(() => {
        fireEvent.pointerMove(toolArea, { button: 0, clientX: 50, clientY: 60 });
      });
      act(() => {
        vi.advanceTimersByTime(20);
      });

      expect(setShapeCtxMock).toHaveBeenCalledTimes(1);
      expect(setShapeCtxMock).toHaveBeenCalledWith(
        storeMocks.ctx,
        expect.objectContaining({ toolName: 'shape', start: { x: 10, y: 20 }, end: { x: 50, y: 60 } })
      );
    });

    it('brackets the preview paint so setShapeCtx cannot leave its alpha on the shared overlay', () => {
      vi.useFakeTimers();
      const { container } = render(<ShapeToolArea overlayCtxRef={{ current: storeMocks.ctx }} />);
      const toolArea = container.firstElementChild as HTMLDivElement;

      act(() => {
        fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 20 });
      });
      act(() => {
        fireEvent.pointerMove(toolArea, { button: 0, clientX: 50, clientY: 60 });
      });
      act(() => {
        vi.advanceTimersByTime(20);
      });

      const saves = vi.mocked(storeMocks.ctx.save).mock.invocationCallOrder;
      const restores = vi.mocked(storeMocks.ctx.restore).mock.invocationCallOrder;
      expect(saves).toHaveLength(1);
      expect(restores).toHaveLength(1);
      // `setShapeCtx` runs INSIDE the bracket, not before it: configured outside, the `restore()`
      // would discard exactly the stroke settings `drawShape` reads.
      expect(vi.mocked(setShapeCtxMock).mock.invocationCallOrder[0]).toBeGreaterThan(saves[0]);
      expect(vi.mocked(drawShapeMock).mock.invocationCallOrder[0]).toBeLessThan(restores[0]);
    });

    it('stores fromCenter flag based on altKey', () => {
      const { container } = render(<ShapeToolArea overlayCtxRef={{ current: storeMocks.ctx }} />);
      const toolArea = container.firstElementChild as HTMLDivElement;

      act(() => {
        fireEvent.pointerDown(toolArea, { button: 0, clientX: 50, clientY: 50, altKey: true });
      });
      act(() => {
        fireEvent.pointerMove(toolArea, { button: 0, clientX: 100, clientY: 100 });
      });
      act(() => {
        fireEvent.pointerUp(toolArea, { button: 0, clientX: 100, clientY: 100 });
      });

      const callArgs = createLayerFromToolMock.mock.calls[0][0];
      // fromCenter: start = anchor * 2 - end = {30, 40} in document space, then adjusted by pos
      // pos = { 30 - 2, 40 - 2, 104, 104 }, so start = { 30-28, 40-38 } = { 2, 2 }
      expect(callArgs.args.start).toEqual({ x: 2, y: 2 });
    });
  });

  describe('pointer move', () => {
    it('ignores pointer move when mouse is not down', () => {
      const { container } = render(<ShapeToolArea overlayCtxRef={{ current: storeMocks.ctx }} />);
      const toolArea = container.firstElementChild as HTMLDivElement;

      // No pointer down — isMouseDown.current is false
      act(() => {
        fireEvent.pointerMove(toolArea, { button: 0, clientX: 50, clientY: 60 });
      });

      expect(drawShapeMock).not.toHaveBeenCalled();
    });

    it('ignores pointer move when mouse is down but move is invalid', () => {
      const { container } = render(<ShapeToolArea overlayCtxRef={{ current: storeMocks.ctx }} />);
      const toolArea = container.firstElementChild as HTMLDivElement;

      act(() => {
        fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 20 });
      });
      pointerState.moveValid = false;

      act(() => {
        fireEvent.pointerMove(toolArea, { button: 0, clientX: 50, clientY: 60 });
      });

      expect(drawShapeMock).not.toHaveBeenCalled();
    });

    it('schedules RAF and calls drawShape on valid pointer move with mouse down', () => {
      vi.useFakeTimers();
      const { container } = render(<ShapeToolArea overlayCtxRef={{ current: storeMocks.ctx }} />);
      const toolArea = container.firstElementChild as HTMLDivElement;

      act(() => {
        fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 20 });
      });
      act(() => {
        fireEvent.pointerMove(toolArea, { button: 0, clientX: 50, clientY: 60 });
      });

      // drawShape not called yet (RAF pending)
      expect(drawShapeMock).not.toHaveBeenCalled();

      act(() => {
        vi.advanceTimersByTime(20);
      });

      expect(drawShapeMock).toHaveBeenCalledTimes(1);
      expect(drawShapeMock).toHaveBeenCalledWith(
        storeMocks.ctx,
        expect.objectContaining({ start: { x: 10, y: 20 }, end: { x: 50, y: 60 } })
      );
    });

    it('throttles RAF so a second move before the frame fires does not schedule a new frame', () => {
      vi.useFakeTimers();
      const { container } = render(<ShapeToolArea overlayCtxRef={{ current: storeMocks.ctx }} />);
      const toolArea = container.firstElementChild as HTMLDivElement;

      act(() => {
        fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 20 });
      });
      act(() => {
        fireEvent.pointerMove(toolArea, { button: 0, clientX: 50, clientY: 60 });
      });
      act(() => {
        fireEvent.pointerMove(toolArea, { button: 0, clientX: 80, clientY: 90 });
      });

      act(() => {
        vi.advanceTimersByTime(20);
      });

      expect(drawShapeMock).toHaveBeenCalledTimes(1);
      expect(drawShapeMock).toHaveBeenCalledWith(
        storeMocks.ctx,
        expect.objectContaining({ start: { x: 10, y: 20 }, end: { x: 80, y: 90 } })
      );
    });

    it('constrains non-line figures to a square when shift is held', () => {
      vi.useFakeTimers();
      const { container } = render(<ShapeToolArea overlayCtxRef={{ current: storeMocks.ctx }} />);
      const toolArea = container.firstElementChild as HTMLDivElement;

      act(() => {
        fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 20 });
      });
      act(() => {
        fireEvent.pointerMove(toolArea, { button: 0, clientX: 50, clientY: 80, shiftKey: true });
      });

      act(() => {
        vi.advanceTimersByTime(20);
      });

      const shapeArg = drawShapeMock.mock.calls[0][1] as {
        start: { x: number; y: number };
        end: { x: number; y: number };
      };
      const dx = shapeArg.end.x - shapeArg.start.x;
      const dy = shapeArg.end.y - shapeArg.start.y;
      expect(Math.abs(dx)).toBeCloseTo(Math.abs(dy), 5);
    });
  });

  describe('pointer up', () => {
    it('ignores pointer up with non-left button', () => {
      const { container } = render(<ShapeToolArea overlayCtxRef={{ current: storeMocks.ctx }} />);
      const toolArea = container.firstElementChild as HTMLDivElement;

      act(() => {
        fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 20 });
      });
      act(() => {
        fireEvent.pointerUp(toolArea, { button: 1, clientX: 50, clientY: 60 });
      });

      expect(createLayerFromToolMock).not.toHaveBeenCalled();
    });

    it('creates a layer with correct pos for a rectangle figure', () => {
      const { container } = render(<ShapeToolArea overlayCtxRef={{ current: storeMocks.ctx }} />);
      const toolArea = container.firstElementChild as HTMLDivElement;

      act(() => {
        fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 20 });
      });
      act(() => {
        fireEvent.pointerMove(toolArea, { button: 0, clientX: 50, clientY: 60 });
      });
      act(() => {
        fireEvent.pointerUp(toolArea, { button: 0, clientX: 50, clientY: 60 });
      });

      expect(createLayerFromToolMock).toHaveBeenCalledTimes(1);
      const fullArgs = createLayerFromToolMock.mock.calls[0][0];

      expect(fullArgs.pos).toEqual({ x: 38, y: 58, width: 44, height: 44 });
      expect(fullArgs.args.start).toEqual({ x: 2, y: 2 });
      expect(fullArgs.args.end).toEqual({ x: 42, y: 42 });
      expect(fullArgs.args.figure).toBe('rectangle');
    });

    it('creates a layer for a line figure without bounding-box recalculation', () => {
      toolArgsState.toolArgs.figure = 'line';
      const { container } = render(<ShapeToolArea overlayCtxRef={{ current: storeMocks.ctx }} />);
      const toolArea = container.firstElementChild as HTMLDivElement;

      act(() => {
        fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 20 });
      });
      act(() => {
        fireEvent.pointerMove(toolArea, { button: 0, clientX: 50, clientY: 60 });
      });
      act(() => {
        fireEvent.pointerUp(toolArea, { button: 0, clientX: 50, clientY: 60 });
      });

      expect(createLayerFromToolMock).toHaveBeenCalledTimes(1);
      const fullArgs = createLayerFromToolMock.mock.calls[0][0];
      expect(fullArgs.pos).toEqual({ x: 38, y: 58, width: 44, height: 44 });
      expect(fullArgs.args.figure).toBe('line');
    });

    it('commits a square when shift is held, matching the preview geometry', () => {
      const { container } = render(<ShapeToolArea overlayCtxRef={{ current: storeMocks.ctx }} />);
      const toolArea = container.firstElementChild as HTMLDivElement;

      act(() => {
        fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 20 });
      });
      act(() => {
        fireEvent.pointerMove(toolArea, { button: 0, clientX: 50, clientY: 80, shiftKey: true });
      });
      act(() => {
        fireEvent.pointerUp(toolArea, { button: 0, clientX: 50, clientY: 80, shiftKey: true });
      });

      expect(createLayerFromToolMock).toHaveBeenCalledTimes(1);
      const fullArgs = createLayerFromToolMock.mock.calls[0][0];

      // Normalized: side = max(|50-10|, |80-20|) = 60 → end = (70, 80)
      // pos = { 10 - 2 + 30, 20 - 2 + 40, 60 + 4, 60 + 4 } = { 38, 58, 64, 64 }
      expect(fullArgs.pos).toEqual({ x: 38, y: 58, width: 64, height: 64 });
      expect(fullArgs.args.start).toEqual({ x: 2, y: 2 });
      expect(fullArgs.args.end).toEqual({ x: 62, y: 62 });
      expect(fullArgs.args.figure).toBe('rectangle');
    });

    it('commits a circle for the oval figure when shift is held', () => {
      toolArgsState.toolArgs.figure = 'oval';
      const { container } = render(<ShapeToolArea overlayCtxRef={{ current: storeMocks.ctx }} />);
      const toolArea = container.firstElementChild as HTMLDivElement;

      act(() => {
        fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 20 });
      });
      act(() => {
        fireEvent.pointerMove(toolArea, { button: 0, clientX: 50, clientY: 80, shiftKey: true });
      });
      act(() => {
        fireEvent.pointerUp(toolArea, { button: 0, clientX: 50, clientY: 80, shiftKey: true });
      });

      const fullArgs = createLayerFromToolMock.mock.calls[0][0];
      expect(fullArgs.pos).toEqual({ x: 38, y: 58, width: 64, height: 64 });
      expect(fullArgs.args.figure).toBe('oval');
    });

    it('commits a centered square when shift and alt are held', () => {
      const { container } = render(<ShapeToolArea overlayCtxRef={{ current: storeMocks.ctx }} />);
      const toolArea = container.firstElementChild as HTMLDivElement;

      act(() => {
        fireEvent.pointerDown(toolArea, { button: 0, clientX: 50, clientY: 50, altKey: true });
      });
      act(() => {
        fireEvent.pointerMove(toolArea, { button: 0, clientX: 100, clientY: 80, shiftKey: true });
      });
      act(() => {
        fireEvent.pointerUp(toolArea, { button: 0, clientX: 100, clientY: 80, shiftKey: true });
      });

      const fullArgs = createLayerFromToolMock.mock.calls[0][0];

      // Anchor (50, 50) is the fixed center: half = max(50, 30) = 50
      // → start = (0, 0), end = (100, 100), so in document space start = (30, 40), end = (130, 140)
      // pos = { 30 - 2, 40 - 2, 100 + 4 + 30, 100 + 4 + 40 } = { 28, 38, 104, 104 }
      expect(fullArgs.pos).toEqual({ x: 28, y: 38, width: 104, height: 104 });
      expect(fullArgs.args.start).toEqual({ x: 2, y: 2 });
      expect(fullArgs.args.end).toEqual({ x: 102, y: 102 });
      // The anchor stays the exact center of the committed shape.
      const centerX = fullArgs.pos.x + (fullArgs.args.start.x + fullArgs.args.end.x) / 2;
      const centerY = fullArgs.pos.y + (fullArgs.args.start.y + fullArgs.args.end.y) / 2;
      expect(centerX).toBe(50 + DOCUMENT_FRAME.x);
      expect(centerY).toBe(50 + DOCUMENT_FRAME.y);
    });

    it('preserves the drag quadrant when shift is held in all four directions', () => {
      const { container } = render(<ShapeToolArea overlayCtxRef={{ current: storeMocks.ctx }} />);
      const toolArea = container.firstElementChild as HTMLDivElement;

      // Anchor (100, 50) with a 100x60 drag: shift expands the short axis to 100
      // while keeping the drag direction.
      const quadrants = [
        { name: 'south-east', pointer: { x: 200, y: 110 }, end: { x: 200, y: 150 } },
        { name: 'south-west', pointer: { x: 0, y: 110 }, end: { x: 0, y: 150 } },
        { name: 'north-east', pointer: { x: 200, y: -10 }, end: { x: 200, y: -50 } },
        { name: 'north-west', pointer: { x: 0, y: -10 }, end: { x: 0, y: -50 } },
      ];

      quadrants.forEach(({ name, pointer, end }) => {
        createLayerFromToolMock.mockClear();
        act(() => {
          fireEvent.pointerDown(toolArea, { button: 0, clientX: 100, clientY: 50 });
        });
        act(() => {
          fireEvent.pointerMove(toolArea, { button: 0, clientX: pointer.x, clientY: pointer.y, shiftKey: true });
        });
        act(() => {
          fireEvent.pointerUp(toolArea, { button: 0, clientX: pointer.x, clientY: pointer.y, shiftKey: true });
        });

        const fullArgs = createLayerFromToolMock.mock.calls[0][0];
        expect(fullArgs.pos.width, `${name} pos width`).toBe(104);
        expect(fullArgs.pos.height, `${name} pos height`).toBe(104);

        const localWidth = fullArgs.args.end.x - fullArgs.args.start.x;
        const localHeight = fullArgs.args.end.y - fullArgs.args.start.y;
        expect(Math.abs(localWidth), `${name} local width`).toBe(100);
        expect(Math.abs(localHeight), `${name} local height`).toBe(100);

        // The committed end point sits on the same side of the anchor as the pointer.
        expect(Math.sign(end.x - 100), `${name} x direction`).toBe(Math.sign(pointer.x - 100));
        expect(Math.sign(end.y - 50), `${name} y direction`).toBe(Math.sign(pointer.y - 50));
        expect(Math.sign(localWidth), `${name} committed x direction`).toBe(Math.sign(pointer.x - 100));
        expect(Math.sign(localHeight), `${name} committed y direction`).toBe(Math.sign(pointer.y - 50));
      });
    });

    it('ignores the shift square constraint for the line figure at commit time', () => {
      toolArgsState.toolArgs.figure = 'line';
      const { container } = render(<ShapeToolArea overlayCtxRef={{ current: storeMocks.ctx }} />);
      const toolArea = container.firstElementChild as HTMLDivElement;

      act(() => {
        fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 20 });
      });
      act(() => {
        fireEvent.pointerMove(toolArea, { button: 0, clientX: 50, clientY: 80, shiftKey: true });
      });
      act(() => {
        fireEvent.pointerUp(toolArea, { button: 0, clientX: 50, clientY: 80, shiftKey: true });
      });

      const fullArgs = createLayerFromToolMock.mock.calls[0][0];

      // Free angle preserved: no square clamping, no ellipse recomputation.
      expect(fullArgs.pos).toEqual({ x: 38, y: 58, width: 44, height: 64 });
      expect(fullArgs.args.figure).toBe('line');
    });

    it('computes the committed bounds from the same geometry the preview draws', () => {
      vi.useFakeTimers();
      const { container } = render(<ShapeToolArea overlayCtxRef={{ current: storeMocks.ctx }} />);
      const toolArea = container.firstElementChild as HTMLDivElement;

      act(() => {
        fireEvent.pointerDown(toolArea, { button: 0, clientX: 30, clientY: 40 });
      });
      act(() => {
        fireEvent.pointerMove(toolArea, { button: 0, clientX: 90, clientY: 70, shiftKey: true });
      });
      act(() => {
        vi.advanceTimersByTime(20);
      });
      act(() => {
        fireEvent.pointerUp(toolArea, { button: 0, clientX: 90, clientY: 70, shiftKey: true });
      });

      const preview = drawShapeMock.mock.calls[0][1] as {
        start: { x: number; y: number };
        end: { x: number; y: number };
      };
      const fullArgs = createLayerFromToolMock.mock.calls[0][0];

      // The preview is in canvas space; the commit rebases it into layer space through the document
      // frame. side = max(|90-30|, |70-40|) = 60 → end = (90, 100)
      expect(preview.start).toEqual({ x: 30, y: 40 });
      expect(preview.end).toEqual({ x: 90, y: 100 });
      expect(fullArgs.pos).toEqual({ x: 58, y: 78, width: 64, height: 64 });
      expect(fullArgs.args.start).toEqual({
        x: preview.start.x + DOCUMENT_FRAME.x - fullArgs.pos.x,
        y: preview.start.y + DOCUMENT_FRAME.y - fullArgs.pos.y,
      });
      expect(fullArgs.args.end).toEqual({
        x: preview.end.x + DOCUMENT_FRAME.x - fullArgs.pos.x,
        y: preview.end.y + DOCUMENT_FRAME.y - fullArgs.pos.y,
      });
    });

    it('commits the previewed square when Shift is released before pointer up', () => {
      // Releasing Shift before the button comes up used to re-run normalizeShapeGeometry with the
      // RELEASE event's shiftKey, so a square the user watched being previewed committed as an
      // unconstrained rectangle. The commit now takes the previewed geometry as it stands.
      vi.useFakeTimers();
      const { container } = render(<ShapeToolArea overlayCtxRef={{ current: storeMocks.ctx }} />);
      const toolArea = container.firstElementChild as HTMLDivElement;

      act(() => {
        fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 20 });
      });
      act(() => {
        fireEvent.pointerMove(toolArea, { button: 0, clientX: 50, clientY: 80, shiftKey: true });
      });
      act(() => {
        vi.advanceTimersByTime(20);
      });
      // Shift is released before the button comes up.
      act(() => {
        fireEvent.pointerUp(toolArea, { button: 0, clientX: 50, clientY: 80 });
      });

      const preview = drawShapeMock.mock.calls[0][1] as {
        start: { x: number; y: number };
        end: { x: number; y: number };
      };
      const fullArgs = createLayerFromToolMock.mock.calls[0][0];

      // The preview was Shift-constrained to a 60x60 square: half = max(40, 60).
      expect(preview.start).toEqual({ x: 10, y: 20 });
      expect(preview.end).toEqual({ x: 70, y: 80 });
      expect(preview.end.x - preview.start.x).toBe(preview.end.y - preview.start.y);

      // The committed layer is that same square, in document space.
      expect(fullArgs.pos).toEqual({ x: 38, y: 58, width: 64, height: 64 });
      expect(fullArgs.args.start).toEqual({ x: 2, y: 2 });
      expect(fullArgs.args.end).toEqual({ x: 62, y: 62 });
      expect(committedGeometry(fullArgs)).toEqual({ start: toDocument(preview.start), end: toDocument(preview.end) });
    });

    it('flushes the pending preview frame on pointer up', () => {
      // The frame pointer up cancels is the one that would have painted the final geometry, so it
      // is painted synchronously before the commit instead of being thrown away.
      vi.useFakeTimers();
      const { container } = render(<ShapeToolArea overlayCtxRef={{ current: storeMocks.ctx }} />);
      const toolArea = container.firstElementChild as HTMLDivElement;

      act(() => {
        fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 20 });
      });
      act(() => {
        fireEvent.pointerMove(toolArea, { button: 0, clientX: 50, clientY: 60 });
      });
      expect(drawShapeMock).not.toHaveBeenCalled();

      act(() => {
        fireEvent.pointerUp(toolArea, { button: 0, clientX: 50, clientY: 60 });
      });

      expect(drawShapeMock).toHaveBeenCalledTimes(1);
      expect(drawShapeMock).toHaveBeenCalledWith(
        storeMocks.ctx,
        expect.objectContaining({ start: { x: 10, y: 20 }, end: { x: 50, y: 60 } })
      );
    });

    it('previews a second drag after a first one was committed', () => {
      // The frame slot has to be released on pointer up. It used to be cancelled but never nulled,
      // so it stayed non-null for the component's lifetime and `handlePointerMove` short-circuited
      // on it: after the very first drag, every later drag showed nothing until it was released.
      vi.useFakeTimers();
      const { container } = render(<ShapeToolArea overlayCtxRef={{ current: storeMocks.ctx }} />);
      const toolArea = container.firstElementChild as HTMLDivElement;

      act(() => {
        fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 20 });
      });
      act(() => {
        fireEvent.pointerMove(toolArea, { button: 0, clientX: 50, clientY: 60 });
      });
      act(() => {
        fireEvent.pointerUp(toolArea, { button: 0, clientX: 50, clientY: 60 });
      });
      expect(createLayerFromToolMock).toHaveBeenCalledTimes(1);

      act(() => {
        fireEvent.pointerDown(toolArea, { button: 0, clientX: 200, clientY: 200 });
      });
      act(() => {
        fireEvent.pointerMove(toolArea, { button: 0, clientX: 260, clientY: 240 });
      });
      act(() => {
        vi.advanceTimersByTime(20);
      });

      expect(drawShapeMock).toHaveBeenLastCalledWith(
        storeMocks.ctx,
        expect.objectContaining({ start: { x: 200, y: 200 }, end: { x: 260, y: 240 } })
      );
    });

    it('creates a layer from a bare pointer-up without prompting or previewing', () => {
      promptMock.mockReturnValue(null);
      const { container } = render(<ShapeToolArea overlayCtxRef={{ current: storeMocks.ctx }} />);
      const toolArea = container.firstElementChild as HTMLDivElement;

      act(() => {
        fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 20 });
      });
      // Releasing at a different position with no pointermove leaves
      // originalShapeRef null, so handlePointerUp re-derives the geometry from
      // the release coordinate. That makes start != end, which skips the
      // click-size prompt and commits a drag the user never previewed.
      act(() => {
        fireEvent.pointerUp(toolArea, { button: 0, clientX: 200, clientY: 260 });
      });

      expect(promptMock).not.toHaveBeenCalled();
      expect(drawShapeMock).not.toHaveBeenCalled();
      expect(createLayerFromToolMock).toHaveBeenCalledTimes(1);

      const fullArgs = createLayerFromToolMock.mock.calls[0][0];
      expect(fullArgs.pos).toEqual({ x: 38, y: 58, width: 194, height: 244 });
      expect(fullArgs.args.start).toEqual({ x: 2, y: 2 });
      expect(fullArgs.args.end).toEqual({ x: 192, y: 242 });
    });

    it('rounds a fractional drag outward to an integral layer box', () => {
      const { container } = render(<ShapeToolArea overlayCtxRef={{ current: storeMocks.ctx }} />);
      const toolArea = container.firstElementChild as HTMLDivElement;

      act(() => {
        fireEvent.pointerDown(toolArea, { button: 0, clientX: 10.4, clientY: 20.6 });
      });
      act(() => {
        fireEvent.pointerMove(toolArea, { button: 0, clientX: 50.2, clientY: 80.9 });
      });
      act(() => {
        fireEvent.pointerUp(toolArea, { button: 0, clientX: 50.2, clientY: 80.9 });
      });

      const fullArgs = createLayerFromToolMock.mock.calls[0][0];
      const { width, height } = fullArgs.pos;

      // shapeGeometryBounds rounds outward — the origin down, the far edge up — so all four
      // fields are integers. The box sizes the layer bitmap via `new OffscreenCanvas(w, h)`,
      // whose constructor truncates, so a fractional box declared an extent its own raster
      // disagreed with. `pad = 2 / 2 + 1 = 2`, so in document space the near edge is
      // (40.4, 60.6) floored and the far edge is (82.2, 122.9) ceiled.
      expect(fullArgs.pos.x).toBe(38);
      expect(fullArgs.pos.y).toBe(58);
      expect(width).toBe(45);
      expect(height).toBe(65);
      expect(Number.isInteger(fullArgs.pos.x)).toBe(true);
      expect(Number.isInteger(fullArgs.pos.y)).toBe(true);
      expect(Number.isInteger(width)).toBe(true);
      expect(Number.isInteger(height)).toBe(true);

      // The rebase subtracts the same box the bounds were measured with, so the layer-local
      // geometry is still the fractional drag, and it still sits inside the box.
      const localStart = fullArgs.args.start as { x: number; y: number };
      const localEnd = fullArgs.args.end as { x: number; y: number };
      expect(localStart.x).toBeCloseTo(2.4, 10);
      expect(localStart.y).toBeCloseTo(2.6, 10);
      expect(localEnd.x).toBeCloseTo(42.2, 10);
      expect(localEnd.y).toBeCloseTo(62.9, 10);
      expect(localStart.x).toBeGreaterThanOrEqual(0);
      expect(localStart.y).toBeGreaterThanOrEqual(0);
      expect(localEnd.x).toBeLessThanOrEqual(width);
      expect(localEnd.y).toBeLessThanOrEqual(height);
    });

    it('computes bounds for an oval figure without clamping (no circle branch)', () => {
      toolArgsState.toolArgs.figure = 'oval';
      const { container } = render(<ShapeToolArea overlayCtxRef={{ current: storeMocks.ctx }} />);
      const toolArea = container.firstElementChild as HTMLDivElement;

      act(() => {
        fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 20 });
      });
      act(() => {
        fireEvent.pointerMove(toolArea, { button: 0, clientX: 50, clientY: 80 });
      });
      act(() => {
        fireEvent.pointerUp(toolArea, { button: 0, clientX: 50, clientY: 80 });
      });

      expect(createLayerFromToolMock).toHaveBeenCalledTimes(1);
      const fullArgs = createLayerFromToolMock.mock.calls[0][0];

      // rx=20, ry=30 (no clamping)
      expect(fullArgs.pos).toEqual({ x: 38, y: 58, width: 44, height: 64 });
      expect(fullArgs.args.figure).toBe('oval');
    });

    it('prompts for dimensions on a click with no movement and expands the shape', () => {
      promptMock.mockReturnValue('100');

      const { container } = render(<ShapeToolArea overlayCtxRef={{ current: storeMocks.ctx }} />);
      const toolArea = container.firstElementChild as HTMLDivElement;

      act(() => {
        fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 20 });
      });
      act(() => {
        fireEvent.pointerUp(toolArea, { button: 0, clientX: 10, clientY: 20 });
      });

      expect(promptMock).toHaveBeenCalledTimes(2);
      expect(createLayerFromToolMock).toHaveBeenCalledTimes(1);
      const fullArgs = createLayerFromToolMock.mock.calls[0][0];
      // Click at (10,20) → prompt returns 100 for width/height
      // end = (40+100, 60+100) = (140, 160), adjusted by pos {x:38, y:58} → (102, 102)
      expect(fullArgs.args.start).toEqual({ x: 2, y: 2 });
      expect(fullArgs.args.end).toEqual({ x: 102, y: 102 });
      expect(fullArgs.pos).toEqual({ x: 38, y: 58, width: 104, height: 104 });
    });

    it('does not create a layer when the prompt returns null', () => {
      promptMock.mockReturnValue(null);
      const { container } = render(<ShapeToolArea overlayCtxRef={{ current: storeMocks.ctx }} />);
      const toolArea = container.firstElementChild as HTMLDivElement;

      act(() => {
        fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 20 });
      });
      act(() => {
        fireEvent.pointerUp(toolArea, { button: 0, clientX: 10, clientY: 20 });
      });

      expect(createLayerFromToolMock).not.toHaveBeenCalled();
    });

    it('does not create a layer when prompt values are zero or negative', () => {
      promptMock.mockReturnValueOnce('0').mockReturnValueOnce('100');

      const { container } = render(<ShapeToolArea overlayCtxRef={{ current: storeMocks.ctx }} />);
      const toolArea = container.firstElementChild as HTMLDivElement;

      act(() => {
        fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 20 });
      });
      act(() => {
        fireEvent.pointerUp(toolArea, { button: 0, clientX: 10, clientY: 20 });
      });

      expect(createLayerFromToolMock).not.toHaveBeenCalled();
    });

    it('does not create a layer when prompt values are non-numeric', () => {
      promptMock.mockReturnValueOnce('abc').mockReturnValueOnce('100');

      const { container } = render(<ShapeToolArea overlayCtxRef={{ current: storeMocks.ctx }} />);
      const toolArea = container.firstElementChild as HTMLDivElement;

      act(() => {
        fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 20 });
      });
      act(() => {
        fireEvent.pointerUp(toolArea, { button: 0, clientX: 10, clientY: 20 });
      });

      expect(createLayerFromToolMock).not.toHaveBeenCalled();
    });

    it('cancels a pending animation frame on pointer up', () => {
      vi.useFakeTimers();
      const cancelSpy = vi.spyOn(globalThis, 'cancelAnimationFrame');
      const { container } = render(<ShapeToolArea overlayCtxRef={{ current: storeMocks.ctx }} />);
      const toolArea = container.firstElementChild as HTMLDivElement;

      act(() => {
        fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 20 });
      });
      act(() => {
        fireEvent.pointerMove(toolArea, { button: 0, clientX: 50, clientY: 60 });
      });

      act(() => {
        fireEvent.pointerUp(toolArea, { button: 0, clientX: 50, clientY: 60 });
      });

      expect(cancelSpy).toHaveBeenCalled();
    });

    it('falls back to documentFrameFromSize when currentFrame is null', () => {
      storeState.documentFrame = null;
      const { container } = render(<ShapeToolArea overlayCtxRef={{ current: storeMocks.ctx }} />);
      const toolArea = container.firstElementChild as HTMLDivElement;

      act(() => {
        fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 20 });
      });
      act(() => {
        fireEvent.pointerMove(toolArea, { button: 0, clientX: 50, clientY: 60 });
      });
      act(() => {
        fireEvent.pointerUp(toolArea, { button: 0, clientX: 50, clientY: 60 });
      });

      const fullArgs = createLayerFromToolMock.mock.calls[0][0];
      // With documentFrame x=0, y=0 (from documentFrameFromSize), canvas coords == document coords
      expect(fullArgs.args.start).toEqual({ x: 2, y: 2 });
      expect(fullArgs.pos).toEqual({ x: 8, y: 18, width: 44, height: 44 });
    });
  });

  /**
   * The overlay canvas is shared, long-lived and only ever `display`-toggled
   * (`Main.tsx:239-284`), and toggling `display` never touches a backing store. This area never
   * clears it on pointer up at all — the last `flushDrawingFrame` in `handlePointerUp` REDRAWS the
   * shape and the commit leaves it there — so the unmount teardown is the only thing that ever
   * removes the preview. Without it the shape stays painted over the next tool's document.
   */
  describe('overlay teardown', () => {
    it('clears the whole backing store on unmount', () => {
      vi.useFakeTimers();
      const { view, toolArea } = renderToolArea();

      act(() => {
        fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 20 });
      });
      act(() => {
        fireEvent.pointerMove(toolArea, { button: 0, clientX: 50, clientY: 60 });
      });
      act(() => {
        vi.advanceTimersByTime(20);
      });
      expect(drawShapeMock).toHaveBeenCalled();

      vi.mocked(storeMocks.ctx.clearRect).mockClear();
      view.unmount();

      // 640x480 is the CANVAS, and totalSize is 800x600: this asserts the backing store was read at
      // call time, which a closure over a render-scope size could not do after a document resize.
      expect(storeMocks.ctx.clearRect).toHaveBeenCalledExactlyOnceWith(0, 0, 640, 480);
    });

    it('cancels a queued preview frame so it cannot repaint over the teardown clear', () => {
      vi.useFakeTimers();
      const { view, toolArea } = renderToolArea();

      act(() => {
        fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 20 });
      });
      act(() => {
        fireEvent.pointerMove(toolArea, { button: 0, clientX: 50, clientY: 60 });
      });
      // The frame is queued and NOT fired, so the preview is still pending.
      expect(drawShapeMock).not.toHaveBeenCalled();

      vi.mocked(storeMocks.ctx.clearRect).mockClear();
      view.unmount();
      act(() => {
        vi.advanceTimersByTime(20);
      });

      // Cancel first, then clear: a frame that survived would have repainted after the clear.
      expect(drawShapeMock).not.toHaveBeenCalled();
      expect(storeMocks.ctx.clearRect).toHaveBeenCalledWith(0, 0, 640, 480);
    });

    it('clears the preview a committed shape leaves painted, which nothing else removes', () => {
      vi.useFakeTimers();
      const { view, toolArea } = renderToolArea();

      act(() => {
        fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 20 });
      });
      act(() => {
        fireEvent.pointerMove(toolArea, { button: 0, clientX: 50, clientY: 60 });
      });
      act(() => {
        vi.advanceTimersByTime(20);
      });
      act(() => {
        fireEvent.pointerUp(toolArea, { button: 0, clientX: 50, clientY: 60 });
      });

      // The commit ran and left the preview on the overlay: `handlePointerUp`'s last
      // `flushDrawingFrame` redraws it and `createLayerFromTool` does not clear it. The shape is
      // now a layer AND is painted twice, and the overlay keeps painting over the next tool's
      // document because toggling `display` never touches a backing store.
      expect(createLayerFromToolMock).toHaveBeenCalledTimes(1);
      expect(drawShapeMock).toHaveBeenCalled();

      vi.mocked(storeMocks.ctx.clearRect).mockClear();
      view.unmount();

      expect(storeMocks.ctx.clearRect).toHaveBeenCalledExactlyOnceWith(0, 0, 640, 480);
    });

    it('clears nothing on mount, so the clear is unambiguously a teardown', () => {
      const { view } = renderToolArea();
      expect(storeMocks.ctx.clearRect).not.toHaveBeenCalled();
      view.unmount();
    });
  });

  describe('shared shape geometry wiring', () => {
    it('derives a plain drag from normalizeShapeGeometry without constraints', () => {
      const { view, toolArea } = renderToolArea();
      const anchor = { x: 30, y: 40 };
      const pointer = { x: 90, y: 70 };

      const fullArgs = dragOnce(toolArea, anchor, pointer);

      const expected = normalizeShapeGeometry(anchor, pointer, 'rectangle', { shiftKey: false, altKey: false });
      expect(expected).toEqual({ start: { x: 30, y: 40 }, end: { x: 90, y: 70 } });
      expect(committedGeometry(fullArgs)).toEqual(toDocumentShape(expected));
      view.unmount();
    });

    it.each(['rectangle', 'oval', 'triangle', 'polygon'] as const)(
      'applies the aspect constraint to %s when shift is held',
      (figure) => {
        toolArgsState.toolArgs.figure = figure;
        const { view, toolArea } = renderToolArea();
        const anchor = { x: 10, y: 20 };
        const pointer = { x: 50, y: 80 };

        const fullArgs = dragOnce(toolArea, anchor, pointer, { shiftKey: true });

        const expected = normalizeShapeGeometry(anchor, pointer, figure, { shiftKey: true, altKey: false });
        // The short axis grows to the long one, so both extents are 60.
        expect(expected).toEqual({ start: { x: 10, y: 20 }, end: { x: 70, y: 80 } });

        const geometry = committedGeometry(fullArgs);
        expect(geometry).toEqual(toDocumentShape(expected));
        expect(Math.abs(geometry.end.x - geometry.start.x)).toBe(60);
        expect(Math.abs(geometry.end.y - geometry.start.y)).toBe(60);
        expect(fullArgs.args.figure).toBe(figure);
        view.unmount();
      }
    );

    it('leaves the line figure unconstrained when shift is held', () => {
      toolArgsState.toolArgs.figure = 'line';
      const { view, toolArea } = renderToolArea();
      const anchor = { x: 10, y: 20 };
      const pointer = { x: 50, y: 80 };

      const fullArgs = dragOnce(toolArea, anchor, pointer, { shiftKey: true });

      const geometry = committedGeometry(fullArgs);
      expect(geometry).toEqual(
        toDocumentShape(normalizeShapeGeometry(anchor, pointer, 'line', { shiftKey: true, altKey: false }))
      );
      expect(geometry).toEqual(toDocumentShape({ start: { x: 10, y: 20 }, end: { x: 50, y: 80 } }));
      // A free angle must survive Shift: clamping it to 60x60 would be a square.
      expect(Math.abs(geometry.end.x - geometry.start.x)).toBe(40);
      expect(Math.abs(geometry.end.y - geometry.start.y)).toBe(60);
      view.unmount();
    });

    it('draws from the center when alt is held, so the anchor is the box midpoint', () => {
      const { view, toolArea } = renderToolArea();
      const anchor = { x: 50, y: 50 };
      const pointer = { x: 120, y: 90 };

      const fullArgs = dragOnce(toolArea, anchor, pointer, { altKey: true });

      const geometry = committedGeometry(fullArgs);
      expect(geometry).toEqual(
        toDocumentShape(normalizeShapeGeometry(anchor, pointer, 'rectangle', { shiftKey: false, altKey: true }))
      );
      expect(geometry).toEqual(toDocumentShape({ start: { x: -20, y: 10 }, end: { x: 120, y: 90 } }));
      expect(midPoint(geometry)).toEqual(toDocument(anchor));
      expect(geometry.end).toEqual(toDocument(pointer));
      view.unmount();
    });

    it('produces a centered box with equal half-extents for alt+shift', () => {
      const { view, toolArea } = renderToolArea();
      const anchor = { x: 50, y: 50 };
      const pointer = { x: 100, y: 80 };

      const fullArgs = dragOnce(toolArea, anchor, pointer, { altKey: true, shiftKey: true });

      const geometry = committedGeometry(fullArgs);
      expect(geometry).toEqual(
        toDocumentShape(normalizeShapeGeometry(anchor, pointer, 'rectangle', { shiftKey: true, altKey: true }))
      );
      // half = max(|100-50|, |80-50|) = 50 in both directions.
      expect(geometry).toEqual(toDocumentShape({ start: { x: 0, y: 0 }, end: { x: 100, y: 100 } }));
      expect(midPoint(geometry)).toEqual(toDocument(anchor));
      expect(Math.abs(geometry.end.x - geometry.start.x)).toBe(Math.abs(geometry.end.y - geometry.start.y));
      const documentAnchor = toDocument(anchor);
      expect(midPoint(fullArgs.args)).toEqual({
        x: documentAnchor.x - fullArgs.pos.x,
        y: documentAnchor.y - fullArgs.pos.y,
      });
      view.unmount();
    });

    it.each([
      { name: 'plain', modifiers: {} as DragModifiers, anchor: { x: 30, y: 40 }, pointer: { x: 90, y: 70 } },
      {
        name: 'shift',
        modifiers: { shiftKey: true } as DragModifiers,
        anchor: { x: 30, y: 40 },
        pointer: { x: 90, y: 70 },
      },
      {
        name: 'alt',
        modifiers: { altKey: true } as DragModifiers,
        anchor: { x: 30, y: 40 },
        pointer: { x: 90, y: 70 },
      },
      {
        name: 'alt+shift',
        modifiers: { altKey: true, shiftKey: true } as DragModifiers,
        anchor: { x: 30, y: 40 },
        pointer: { x: 90, y: 70 },
      },
    ])('computes the layer pos from shapeGeometryBounds for a $name drag', ({ modifiers, anchor, pointer }) => {
      const { view, toolArea } = renderToolArea();

      const fullArgs = dragOnce(toolArea, anchor, pointer, modifiers);

      const lineWidth = toolArgsState.toolArgs.lineWidth;
      const documentGeometry = toDocumentShape(
        normalizeShapeGeometry(anchor, pointer, 'rectangle', {
          shiftKey: Boolean(modifiers.shiftKey),
          altKey: Boolean(modifiers.altKey),
        })
      );
      expect(committedGeometry(fullArgs)).toEqual(documentGeometry);
      expect(fullArgs.pos).toEqual(shapeGeometryBounds(documentGeometry, lineWidth));
      // Padding is half the stroke plus one pixel of antialiasing slack.
      expect(fullArgs.pos.x).toBe(Math.min(documentGeometry.start.x, documentGeometry.end.x) - lineWidth / 2 - 1);
      expect(fullArgs.pos.width).toBe(Math.abs(documentGeometry.end.x - documentGeometry.start.x) + lineWidth + 2);
      view.unmount();
    });

    it('scales the committed bounds with the tool line width', () => {
      toolArgsState.toolArgs.lineWidth = 7.5;
      const { view, toolArea } = renderToolArea();
      const anchor = { x: 30, y: 40 };
      const pointer = { x: 90, y: 70 };

      const fullArgs = dragOnce(toolArea, anchor, pointer);

      const geometry = { start: anchor, end: pointer };
      const documentGeometry = toDocumentShape(geometry);
      // `pad = 7.5 / 2 + 1 = 4.75`, so in document space the near edge is (55.25, 75.25) floored
      // and the far edge is (124.75, 114.75) ceiled. The extent is the difference of the two
      // rounded edges, which is what keeps a half-pixel line width from declaring a fractional
      // bitmap size.
      expect(fullArgs.pos).toEqual({ x: 55, y: 75, width: 70, height: 40 });
      expect(fullArgs.pos).toEqual(shapeGeometryBounds(documentGeometry, 7.5));
      // Still contains the padded geometry, so the rounding did not clip the stroke.
      expect(fullArgs.pos.x).toBeLessThanOrEqual(documentGeometry.start.x - 4.75);
      expect(fullArgs.pos.y).toBeLessThanOrEqual(documentGeometry.start.y - 4.75);
      expect(fullArgs.pos.x + fullArgs.pos.width).toBeGreaterThanOrEqual(documentGeometry.end.x + 4.75);
      expect(fullArgs.pos.y + fullArgs.pos.height).toBeGreaterThanOrEqual(documentGeometry.end.y + 4.75);
      view.unmount();
    });

    it.each([
      { name: 'plain', modifiers: {} as DragModifiers },
      { name: 'shift', modifiers: { shiftKey: true } as DragModifiers },
      { name: 'alt', modifiers: { altKey: true } as DragModifiers },
    ])('rebases the committed start and end by -pos for a $name drag', ({ modifiers }) => {
      const { view, toolArea } = renderToolArea();
      const anchor = { x: 30, y: 40 };
      const pointer = { x: 90, y: 70 };

      const fullArgs = dragOnce(toolArea, anchor, pointer, modifiers);

      const geometry = committedGeometry(fullArgs);
      expect(fullArgs.args.start).toEqual({
        x: geometry.start.x - fullArgs.pos.x,
        y: geometry.start.y - fullArgs.pos.y,
      });
      expect(fullArgs.args.end).toEqual({ x: geometry.end.x - fullArgs.pos.x, y: geometry.end.y - fullArgs.pos.y });
      // The rebased min corner lands on the padding inset (lineWidth / 2 + 1).
      expect(fullArgs.args.start.x).toBe(toolArgsState.toolArgs.lineWidth / 2 + 1);
      expect(fullArgs.args.start.y).toBe(toolArgsState.toolArgs.lineWidth / 2 + 1);
      view.unmount();
    });

    it('rebases the committed start and end by -pos for every figure', () => {
      for (const figure of ['rectangle', 'oval', 'triangle', 'polygon', 'line'] as const) {
        toolArgsState.toolArgs.figure = figure;
        createLayerFromToolMock.mockClear();
        const { view, toolArea } = renderToolArea();
        const anchor = { x: 40, y: 30 };
        const pointer = { x: 120, y: 95 };

        const fullArgs = dragOnce(toolArea, anchor, pointer, { shiftKey: true });

        const geometry = committedGeometry(fullArgs);
        expect(fullArgs.args.start, figure).toEqual({
          x: geometry.start.x - fullArgs.pos.x,
          y: geometry.start.y - fullArgs.pos.y,
        });
        expect(fullArgs.args.end, figure).toEqual({
          x: geometry.end.x - fullArgs.pos.x,
          y: geometry.end.y - fullArgs.pos.y,
        });
        expect(fullArgs.args.figure, figure).toBe(figure);
        view.unmount();
      }
    });

    it('keeps a space-drag translation without re-normalizing on release', () => {
      const { view, toolArea } = renderToolArea();

      act(() => {
        fireEvent.pointerDown(toolArea, { button: 0, clientX: 100, clientY: 100 });
      });
      act(() => {
        fireEvent.pointerMove(toolArea, { button: 0, clientX: 120, clientY: 110 });
      });
      act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }));
      });
      act(() => {
        fireEvent.pointerMove(toolArea, { button: 0, clientX: 150, clientY: 140 });
      });
      // Releasing far away with Shift held must not snap the translated shape
      // back to the pointer: the moved geometry wins.
      act(() => {
        fireEvent.pointerUp(toolArea, { button: 0, clientX: 400, clientY: 320, shiftKey: true });
      });
      act(() => {
        window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space' }));
      });

      const fullArgs = createLayerFromToolMock.mock.calls[0][0] as CommittedLayer;
      const geometry = committedGeometry(fullArgs);
      expect(geometry).toEqual(toDocumentShape({ start: { x: 130, y: 130 }, end: { x: 150, y: 140 } }));
      expect(geometry).not.toEqual(
        toDocumentShape(
          normalizeShapeGeometry({ x: 100, y: 100 }, { x: 400, y: 320 }, 'rectangle', { shiftKey: true, altKey: false })
        )
      );
      expect(fullArgs.pos).toEqual(shapeGeometryBounds(geometry, toolArgsState.toolArgs.lineWidth));
      view.unmount();
    });

    it('keeps the translated geometry for the rest of the gesture after Space is released', () => {
      // `movedBySpace` only compares startRef against the anchor, so releasing
      // Space mid-gesture does not re-anchor the shape on pointer up.
      const { view, toolArea } = renderToolArea();

      act(() => {
        fireEvent.pointerDown(toolArea, { button: 0, clientX: 100, clientY: 100 });
      });
      act(() => {
        fireEvent.pointerMove(toolArea, { button: 0, clientX: 120, clientY: 110 });
      });
      act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }));
      });
      act(() => {
        fireEvent.pointerMove(toolArea, { button: 0, clientX: 150, clientY: 140 });
      });
      act(() => {
        window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space' }));
      });
      act(() => {
        fireEvent.pointerUp(toolArea, { button: 0, clientX: 200, clientY: 260 });
      });

      const fullArgs = createLayerFromToolMock.mock.calls[0][0] as CommittedLayer;
      const geometry = committedGeometry(fullArgs);
      expect(geometry).toEqual(toDocumentShape({ start: { x: 130, y: 130 }, end: { x: 150, y: 140 } }));
      expect(fullArgs.pos).toEqual(shapeGeometryBounds(geometry, toolArgsState.toolArgs.lineWidth));

      // A fresh gesture after Space is released re-anchors on the new drag.
      createLayerFromToolMock.mockClear();
      act(() => {
        fireEvent.pointerDown(toolArea, { button: 0, clientX: 100, clientY: 100 });
      });
      act(() => {
        fireEvent.pointerMove(toolArea, { button: 0, clientX: 200, clientY: 260 });
      });
      act(() => {
        fireEvent.pointerUp(toolArea, { button: 0, clientX: 200, clientY: 260 });
      });

      const nextArgs = createLayerFromToolMock.mock.calls[0][0] as CommittedLayer;
      const nextGeometry = committedGeometry(nextArgs);
      expect(nextGeometry).toEqual(toDocumentShape({ start: { x: 100, y: 100 }, end: { x: 200, y: 260 } }));
      expect(nextArgs.pos).toEqual(shapeGeometryBounds(nextGeometry, toolArgsState.toolArgs.lineWidth));
      view.unmount();
    });
  });

  describe('document gesture gate', () => {
    beforeEach(() => {
      // The slot is module-level, so a leaked claim would refuse every later claim in this file and
      // read as a dozen unrelated failures.
      resetDocumentGestures();
    });

    it('claims the document for a shape drag and releases it on the release', () => {
      // A shape commits from `createLayerFromTool` on release, so a document-mutating shortcut
      // pressed mid-drag mutates the document behind the gesture's back, and an undo there replaces
      // `selections` from the SAME history array, so the pending commit then truncates the redo tail
      // with no other symptom.
      const { toolArea } = renderToolArea();

      fireEvent.pointerDown(toolArea, { button: 0, pointerId: 4, clientX: 100, clientY: 100 });
      expect(isDocumentGestureOpen()).toBe(true);
      expect(readDocumentGesture()).toEqual({ kind: 'shape-draw', pointerId: 4 });

      fireEvent.pointerUp(toolArea, { button: 0, pointerId: 4, clientX: 200, clientY: 260 });

      expect(createLayerFromToolMock).toHaveBeenCalledTimes(1);
      expect(isDocumentGestureOpen()).toBe(false);
    });

    it('releases the claim before the commit path, so a release that commits nothing still frees the keyboard', () => {
      // The release is the first statement inside the `isPointerUpValid` branch, which is what covers
      // the prompt early-return below: a click the user dismisses must not leave the keyboard dead.
      promptMock.mockReturnValue(null);
      const { toolArea } = renderToolArea();

      fireEvent.pointerDown(toolArea, { button: 0, pointerId: 4, clientX: 100, clientY: 100 });
      expect(isDocumentGestureOpen()).toBe(true);

      fireEvent.pointerUp(toolArea, { button: 0, pointerId: 4, clientX: 100, clientY: 100 });

      expect(createLayerFromToolMock).not.toHaveBeenCalled();
      expect(isDocumentGestureOpen()).toBe(false);
    });

    it('does not let a foreign pointer release the claim it never took', () => {
      const { toolArea } = renderToolArea();

      fireEvent.pointerDown(toolArea, { button: 0, pointerId: 4, clientX: 100, clientY: 100 });
      expect(isDocumentGestureOpen()).toBe(true);

      // The claim is released inside the `isPointerUpValid` branch, so a release the validator
      // refuses cannot hand the document back on the first pointer's behalf.
      fireEvent.pointerUp(toolArea, { button: 0, pointerId: 42, clientX: 200, clientY: 260 });

      expect(createLayerFromToolMock).not.toHaveBeenCalled();
      expect(isDocumentGestureOpen()).toBe(true);
    });

    it('releases the claim on a pointer cancel, which is the abort route', () => {
      const { toolArea } = renderToolArea();

      fireEvent.pointerDown(toolArea, { button: 0, pointerId: 4, clientX: 100, clientY: 100 });
      expect(isDocumentGestureOpen()).toBe(true);

      fireEvent.pointerCancel(toolArea, { button: 0, pointerId: 4 });

      expect(isDocumentGestureOpen()).toBe(false);
    });

    it('releases the claim on unmount, so a gesture that dies mid-drag cannot leave the keyboard dead', () => {
      const { view, toolArea } = renderToolArea();

      fireEvent.pointerDown(toolArea, { button: 0, pointerId: 4, clientX: 100, clientY: 100 });
      expect(isDocumentGestureOpen()).toBe(true);

      view.unmount();

      expect(isDocumentGestureOpen()).toBe(false);
    });

    it('claims nothing for a press the pointer validator refuses', () => {
      // `isPointerDownValid` has already refused a non-primary button and a second pointer, and the
      // claim is taken after it, so a refused press starts no gesture to wait on.
      const { toolArea } = renderToolArea();

      fireEvent.pointerDown(toolArea, { button: 2, pointerId: 4, clientX: 100, clientY: 100 });

      expect(isDocumentGestureOpen()).toBe(false);
    });
  });
});
