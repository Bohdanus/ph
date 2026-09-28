import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PointerEvent } from 'react';
import { ShapeToolArea } from '../ShapeToolArea.tsx';
import { normalizeShapeGeometry, shapeGeometryBounds, type FigureType } from '../../../tools/shape.ts';

const createLayerFromToolMock = vi.hoisted(() => vi.fn());
const drawShapeMock = vi.hoisted(() => vi.fn());
const setShapeCtxMock = vi.hoisted(() => vi.fn());

const createPointerState = vi.hoisted(() => () => ({ isMouseDown: { current: false }, moveValid: true }));
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
  canvas.width = 800;
  canvas.height = 600;
  const ctx = {
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

/**
 * The frame every store in this file publishes, and the origin every committed
 * shape is offset by. Non-zero on purpose: a zero-origin frame makes document
 * and canvas coordinates identical, so a conversion that dropped the offset
 * would still satisfy every assertion below. The shape tool commits document
 * space while it previews and drags in canvas space, so a non-zero frame makes
 * the two distinguishable.
 */
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

vi.mock('../../../hooks/usePointerPosition.ts', () => ({
  usePointerPosition: () => ({
    pointerIdRef: { current: null },
    isPointerDownValid: vi.fn((event: PointerEvent) => {
      if (event.button !== 0) return false;
      pointerState.isMouseDown.current = true;
      return true;
    }),
    isPointerMoveValid: vi.fn(() => pointerState.isMouseDown.current && pointerState.moveValid),
    isPointerUpValid: vi.fn((event: PointerEvent) => {
      if (event.button !== 0) return false;
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
const committedDocumentGeometry = ({ args, pos }: CommittedLayer) => ({
  start: { x: args.start.x + pos.x, y: args.start.y + pos.y },
  end: { x: args.end.x + pos.x, y: args.end.y + pos.y },
});

/** The same geometry in canvas space, which is where a drag's pointer coords and a preview live. */
const committedGeometry = ({ args, pos }: CommittedLayer) => ({
  start: { x: args.start.x + pos.x - DOCUMENT_FRAME.x, y: args.start.y + pos.y - DOCUMENT_FRAME.y },
  end: { x: args.end.x + pos.x - DOCUMENT_FRAME.x, y: args.end.y + pos.y - DOCUMENT_FRAME.y },
});

/** The document-space bounds a canvas-space box commits to. */
const documentBounds = (bounds: { x: number; y: number; width: number; height: number }) => ({
  ...bounds,
  x: bounds.x + DOCUMENT_FRAME.x,
  y: bounds.y + DOCUMENT_FRAME.y,
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
    storeState.documentFrame = { ...DOCUMENT_FRAME };
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
      // After pan: start = (130, 130), end = (150, 140) in canvas space
      // pos = { min(160,180)-2, min(170,180)-2, |180-160|+4, |180-170|+4 } = {158, 168, 24, 14}
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
      // Normal mode: start = (200, 200), pos = {228, 238, 44, 34}
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

    it('sets shape context and stores refs on valid pointer down', () => {
      const { container } = render(<ShapeToolArea overlayCtxRef={{ current: storeMocks.ctx }} />);
      const toolArea = container.firstElementChild as HTMLDivElement;

      act(() => {
        fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 20 });
      });

      expect(setShapeCtxMock).toHaveBeenCalledTimes(1);
      expect(setShapeCtxMock).toHaveBeenCalledWith(storeMocks.ctx, expect.objectContaining({ toolName: 'shape' }));
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
      // fromCenter: start = anchor * 2 - end = {0, 0}, then adjusted by pos
      // pos = { -2, -2, 104, 104 }, so start = { 0-(-2), 0-(-2) } = { 2, 2 }
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
      // pos = { 10 - 2, 20 - 2, 60 + 4, 60 + 4 } = { 8, 18, 64, 64 }
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

      // Anchor (50, 50) is the fixed center in canvas space, so (80, 90) in
      // document space once the frame origin is added: half = max(50, 30) = 50
      // → start = (30, 40), end = (130, 140)
      // pos = { 30 - 2, 40 - 2, 100 + 4, 100 + 4 } = { 28, 38, 104, 104 }
      expect(fullArgs.pos).toEqual({ x: 28, y: 38, width: 104, height: 104 });
      expect(fullArgs.args.start).toEqual({ x: 2, y: 2 });
      expect(fullArgs.args.end).toEqual({ x: 102, y: 102 });
      // The anchor stays the exact center of the committed shape.
      const centerX = fullArgs.pos.x + (fullArgs.args.start.x + fullArgs.args.end.x) / 2;
      const centerY = fullArgs.pos.y + (fullArgs.args.start.y + fullArgs.args.end.y) / 2;
      expect(centerX).toBe(80);
      expect(centerY).toBe(90);
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

      // The preview is in canvas space; the commit rebases it into document-space
      // layer space. side = max(|90-30|, |70-40|) = 60 → end = (90, 100) canvas,
      // (120, 140) document, against a (60, 80) document start.
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

    it('drops the previewed constraint when Shift is released before pointer up', () => {
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

      // handlePointerUp re-runs normalizeShapeGeometry with the release event's
      // shiftKey, so the committed layer is the unconstrained 10,20 -> 50,80
      // drag and no longer matches the square the preview drew.
      expect(fullArgs.pos).toEqual({ x: 38, y: 58, width: 44, height: 64 });
      expect(fullArgs.pos.width).not.toBe(fullArgs.pos.height);
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

    it('keeps fractional drag geometry inside the fractional layer box', () => {
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

      // shapeGeometryBounds returns the raw padded extent, so a zoomed drag
      // commits a fractional box rather than rounding to whole pixels.
      expect(fullArgs.pos.x).toBeCloseTo(38.4, 10);
      expect(fullArgs.pos.y).toBeCloseTo(58.6, 10);
      expect(width).toBeCloseTo(43.8, 10);
      expect(height).toBeCloseTo(64.3, 10);

      // The layer-local geometry stays inside [0, width] x [0, height].
      const localStart = fullArgs.args.start as { x: number; y: number };
      const localEnd = fullArgs.args.end as { x: number; y: number };
      expect(localStart.x).toBeCloseTo(2, 10);
      expect(localStart.y).toBeCloseTo(2, 10);
      expect(localEnd.x).toBeCloseTo(41.8, 10);
      expect(localEnd.y).toBeCloseTo(62.3, 10);
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
      // end = (10+100, 20+100) = (110, 120) canvas, (140, 160) document,
      // adjusted by pos {x:38, y:58} → (102, 102)
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

  describe('shared shape geometry wiring', () => {
    it('derives a plain drag from normalizeShapeGeometry without constraints', () => {
      const { view, toolArea } = renderToolArea();
      const anchor = { x: 30, y: 40 };
      const pointer = { x: 90, y: 70 };

      const fullArgs = dragOnce(toolArea, anchor, pointer);

      const expected = normalizeShapeGeometry(anchor, pointer, 'rectangle', { shiftKey: false, altKey: false });
      expect(expected).toEqual({ start: { x: 30, y: 40 }, end: { x: 90, y: 70 } });
      expect(committedGeometry(fullArgs)).toEqual(expected);
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
        expect(geometry).toEqual(expected);
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
      expect(geometry).toEqual(normalizeShapeGeometry(anchor, pointer, 'line', { shiftKey: true, altKey: false }));
      expect(geometry).toEqual({ start: { x: 10, y: 20 }, end: { x: 50, y: 80 } });
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
      expect(geometry).toEqual(normalizeShapeGeometry(anchor, pointer, 'rectangle', { shiftKey: false, altKey: true }));
      expect(geometry).toEqual({ start: { x: -20, y: 10 }, end: { x: 120, y: 90 } });
      expect(midPoint(geometry)).toEqual(anchor);
      expect(geometry.end).toEqual(pointer);
      view.unmount();
    });

    it('produces a centered box with equal half-extents for alt+shift', () => {
      const { view, toolArea } = renderToolArea();
      const anchor = { x: 50, y: 50 };
      const pointer = { x: 100, y: 80 };

      const fullArgs = dragOnce(toolArea, anchor, pointer, { altKey: true, shiftKey: true });

      const geometry = committedGeometry(fullArgs);
      expect(geometry).toEqual(normalizeShapeGeometry(anchor, pointer, 'rectangle', { shiftKey: true, altKey: true }));
      // half = max(|100-50|, |80-50|) = 50 in both directions.
      expect(geometry).toEqual({ start: { x: 0, y: 0 }, end: { x: 100, y: 100 } });
      expect(midPoint(geometry)).toEqual(anchor);
      expect(Math.abs(geometry.end.x - geometry.start.x)).toBe(Math.abs(geometry.end.y - geometry.start.y));
      // The layer-local midpoint is the anchor in document space, less the layer
      // origin: (50, 50) canvas is (80, 90) document once the frame is applied.
      expect(midPoint(fullArgs.args)).toEqual({
        x: anchor.x + DOCUMENT_FRAME.x - fullArgs.pos.x,
        y: anchor.y + DOCUMENT_FRAME.y - fullArgs.pos.y,
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
      const geometry = normalizeShapeGeometry(anchor, pointer, 'rectangle', {
        shiftKey: Boolean(modifiers.shiftKey),
        altKey: Boolean(modifiers.altKey),
      });
      expect(committedGeometry(fullArgs)).toEqual(geometry);
      expect(fullArgs.pos).toEqual(documentBounds(shapeGeometryBounds(geometry, lineWidth)));
      // Padding is half the stroke plus one pixel of antialiasing slack.
      expect(fullArgs.pos.x).toBe(Math.min(geometry.start.x, geometry.end.x) - lineWidth / 2 - 1 + DOCUMENT_FRAME.x);
      expect(fullArgs.pos.width).toBe(Math.abs(geometry.end.x - geometry.start.x) + lineWidth + 2);
      view.unmount();
    });

    it('scales the committed bounds with the tool line width', () => {
      toolArgsState.toolArgs.lineWidth = 7.5;
      const { view, toolArea } = renderToolArea();
      const anchor = { x: 30, y: 40 };
      const pointer = { x: 90, y: 70 };

      const fullArgs = dragOnce(toolArea, anchor, pointer);

      const geometry = { start: anchor, end: pointer };
      expect(fullArgs.pos).toEqual({ x: 55.25, y: 75.25, width: 69.5, height: 39.5 });
      expect(fullArgs.pos).toEqual(documentBounds(shapeGeometryBounds(geometry, 7.5)));
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

      const geometry = committedDocumentGeometry(fullArgs);
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

        const geometry = committedDocumentGeometry(fullArgs);
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
      expect(geometry).toEqual({ start: { x: 130, y: 130 }, end: { x: 150, y: 140 } });
      expect(geometry).not.toEqual(
        normalizeShapeGeometry({ x: 100, y: 100 }, { x: 400, y: 320 }, 'rectangle', { shiftKey: true, altKey: false })
      );
      expect(fullArgs.pos).toEqual(documentBounds(shapeGeometryBounds(geometry, toolArgsState.toolArgs.lineWidth)));
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
      expect(geometry).toEqual({ start: { x: 130, y: 130 }, end: { x: 150, y: 140 } });
      expect(fullArgs.pos).toEqual(documentBounds(shapeGeometryBounds(geometry, toolArgsState.toolArgs.lineWidth)));

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
      expect(nextGeometry).toEqual({ start: { x: 100, y: 100 }, end: { x: 200, y: 260 } });
      expect(nextArgs.pos).toEqual(documentBounds(shapeGeometryBounds(nextGeometry, toolArgsState.toolArgs.lineWidth)));
      view.unmount();
    });
  });
});
