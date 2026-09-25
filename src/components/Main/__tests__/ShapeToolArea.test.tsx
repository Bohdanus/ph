import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PointerEvent } from 'react';
import { ShapeToolArea } from '../ShapeToolArea.tsx';

const createLayerFromToolMock = vi.hoisted(() => vi.fn());
const drawShapeMock = vi.hoisted(() => vi.fn());
const setShapeCtxMock = vi.hoisted(() => vi.fn());

const pointerState = vi.hoisted(() => ({ isMouseDown: { current: false }, moveValid: true }));

const toolArgsState = vi.hoisted(
  (): {
    toolArgs: {
      toolName: 'shape';
      figure: 'line' | 'circle' | 'rectangle' | 'square' | 'oval' | 'triangle' | 'polygon';
      color: string;
      backgroundColor: string | null;
      alpha: number;
      lineWidth: number;
      cornerRadius: number;
    };
  } => ({
    toolArgs: {
      toolName: 'shape',
      figure: 'rectangle',
      color: '#000000',
      backgroundColor: null,
      alpha: 1,
      lineWidth: 2,
      cornerRadius: 0,
    },
  })
);

const storeMocks = vi.hoisted(() => {
  const canvas = document.createElement('canvas');
  canvas.width = 800;
  canvas.height = 600;
  const ctx = canvas.getContext('2d');
  const container = document.createElement('div');
  const cr = { left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0, toJSON: () => {} };
  container.getBoundingClientRect = vi.fn(() => cr);
  return { canvas, ctx, container, cr };
});

vi.mock('../../../contexts/StoreContext.tsx', () => ({
  useStore: () => [
    {
      containerRef: { current: storeMocks.container },
      toolOverlayRef: { current: storeMocks.canvas },
      totalSize: { width: 800, height: 600 },
      documentFrame: null,
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

vi.mock('../../../tools/shape.ts', () => ({
  drawShape: drawShapeMock,
  setShapeCtx: setShapeCtxMock,
}));

describe('ShapeToolArea', () => {
  beforeEach(() => {
    createLayerFromToolMock.mockClear();
    drawShapeMock.mockClear();
    setShapeCtxMock.mockClear();
    pointerState.isMouseDown.current = false;
    pointerState.moveValid = true;
    toolArgsState.toolArgs.figure = 'rectangle';
    toolArgsState.toolArgs.lineWidth = 2;
    toolArgsState.toolArgs.color = '#000000';
    toolArgsState.toolArgs.backgroundColor = null;
    vi.stubGlobal(
      'prompt',
      vi.fn().mockImplementation(() => null)
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
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
      fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 20 });
      fireEvent.pointerMove(toolArea, { button: 0, clientX: 50, clientY: 60 });
      fireEvent.pointerUp(toolArea, { button: 0, clientX: 50, clientY: 60 });

      expect(createLayerFromToolMock).toHaveBeenCalledTimes(1);
      const firstCall = createLayerFromToolMock.mock.calls[0][0];
      expect(firstCall.args.start).toEqual({ x: 2, y: 2 });
      expect(firstCall.args.end).toEqual({ x: 42, y: 42 });

      // Press Space — first move sets originalShapeRef, second move pans
      act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }));
      });

      fireEvent.pointerDown(toolArea, { button: 0, clientX: 100, clientY: 100 });
      fireEvent.pointerMove(toolArea, { button: 0, clientX: 120, clientY: 110 });
      fireEvent.pointerMove(toolArea, { button: 0, clientX: 150, clientY: 140 });
      fireEvent.pointerUp(toolArea, { button: 0, clientX: 150, clientY: 140 });

      const secondCall = createLayerFromToolMock.mock.calls[1][0];
      // Pan: delta from second move = (150-120, 140-110) = (30, 30)
      // start was (100, 100), end was (120, 110)
      // After pan: start = (130, 130), end = (150, 140)
      // pos = { min(130,150)-2, min(130,140)-2, |130-150|+4, |130-140|+4 } = {128, 128, 24, 14}
      // adjusted start = (130-128, 130-128) = (2, 2)
      // adjusted end = (150-128, 140-128) = (22, 12)
      expect(secondCall.args.start).toEqual({ x: 2, y: 2 });
      expect(secondCall.args.end).toEqual({ x: 22, y: 12 });

      // Release Space — pan mode disabled
      act(() => {
        window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space' }));
      });

      fireEvent.pointerDown(toolArea, { button: 0, clientX: 200, clientY: 200 });
      fireEvent.pointerMove(toolArea, { button: 0, clientX: 240, clientY: 230 });
      fireEvent.pointerUp(toolArea, { button: 0, clientX: 240, clientY: 230 });

      const thirdCall = createLayerFromToolMock.mock.calls[2][0];
      // Normal mode: start = (200, 200), pos = {198, 198, 44, 34}
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
      fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 20 });
      fireEvent.pointerMove(toolArea, { button: 0, clientX: 50, clientY: 60 });
      fireEvent.pointerUp(toolArea, { button: 0, clientX: 50, clientY: 60 });

      const callArgs = createLayerFromToolMock.mock.calls[0][0];
      expect(callArgs.args.start).toEqual({ x: 2, y: 2 });
      expect(callArgs.args.end).toEqual({ x: 42, y: 42 });
    });
  });

  describe('pointer down', () => {
    it('ignores pointer down with non-left button', () => {
      const { container } = render(<ShapeToolArea overlayCtxRef={{ current: storeMocks.ctx }} />);
      const toolArea = container.firstElementChild as HTMLDivElement;

      fireEvent.pointerDown(toolArea, { button: 1, clientX: 10, clientY: 20 });

      expect(setShapeCtxMock).not.toHaveBeenCalled();
    });

    it('sets shape context and stores refs on valid pointer down', () => {
      const { container } = render(<ShapeToolArea overlayCtxRef={{ current: storeMocks.ctx }} />);
      const toolArea = container.firstElementChild as HTMLDivElement;

      fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 20 });

      expect(setShapeCtxMock).toHaveBeenCalledTimes(1);
      expect(setShapeCtxMock).toHaveBeenCalledWith(storeMocks.ctx, expect.objectContaining({ toolName: 'shape' }));
    });

    it('stores fromCenter flag based on altKey', () => {
      const { container } = render(<ShapeToolArea overlayCtxRef={{ current: storeMocks.ctx }} />);
      const toolArea = container.firstElementChild as HTMLDivElement;

      fireEvent.pointerDown(toolArea, { button: 0, clientX: 50, clientY: 50, altKey: true });
      fireEvent.pointerMove(toolArea, { button: 0, clientX: 100, clientY: 100 });
      fireEvent.pointerUp(toolArea, { button: 0, clientX: 100, clientY: 100 });

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
      fireEvent.pointerMove(toolArea, { button: 0, clientX: 50, clientY: 60 });

      expect(drawShapeMock).not.toHaveBeenCalled();
    });

    it('ignores pointer move when mouse is down but move is invalid', () => {
      const { container } = render(<ShapeToolArea overlayCtxRef={{ current: storeMocks.ctx }} />);
      const toolArea = container.firstElementChild as HTMLDivElement;

      fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 20 });
      pointerState.moveValid = false;

      fireEvent.pointerMove(toolArea, { button: 0, clientX: 50, clientY: 60 });

      expect(drawShapeMock).not.toHaveBeenCalled();
    });

    it('schedules RAF and calls drawShape on valid pointer move with mouse down', () => {
      vi.useFakeTimers();
      const { container } = render(<ShapeToolArea overlayCtxRef={{ current: storeMocks.ctx }} />);
      const toolArea = container.firstElementChild as HTMLDivElement;

      fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 20 });
      fireEvent.pointerMove(toolArea, { button: 0, clientX: 50, clientY: 60 });

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

      fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 20 });
      fireEvent.pointerMove(toolArea, { button: 0, clientX: 50, clientY: 60 });
      fireEvent.pointerMove(toolArea, { button: 0, clientX: 80, clientY: 90 });

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

      fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 20 });
      fireEvent.pointerMove(toolArea, { button: 0, clientX: 50, clientY: 80, shiftKey: true });

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

      fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 20 });
      fireEvent.pointerUp(toolArea, { button: 1, clientX: 50, clientY: 60 });

      expect(createLayerFromToolMock).not.toHaveBeenCalled();
    });

    it('creates a layer with correct pos for a rectangle figure', () => {
      const { container } = render(<ShapeToolArea overlayCtxRef={{ current: storeMocks.ctx }} />);
      const toolArea = container.firstElementChild as HTMLDivElement;

      fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 20 });
      fireEvent.pointerMove(toolArea, { button: 0, clientX: 50, clientY: 60 });
      fireEvent.pointerUp(toolArea, { button: 0, clientX: 50, clientY: 60 });

      expect(createLayerFromToolMock).toHaveBeenCalledTimes(1);
      const fullArgs = createLayerFromToolMock.mock.calls[0][0];

      expect(fullArgs.pos).toEqual({ x: 8, y: 18, width: 44, height: 44 });
      expect(fullArgs.args.start).toEqual({ x: 2, y: 2 });
      expect(fullArgs.args.end).toEqual({ x: 42, y: 42 });
      expect(fullArgs.args.figure).toBe('rectangle');
    });

    it('creates a layer for a line figure without bounding-box recalculation', () => {
      toolArgsState.toolArgs.figure = 'line';
      const { container } = render(<ShapeToolArea overlayCtxRef={{ current: storeMocks.ctx }} />);
      const toolArea = container.firstElementChild as HTMLDivElement;

      fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 20 });
      fireEvent.pointerMove(toolArea, { button: 0, clientX: 50, clientY: 60 });
      fireEvent.pointerUp(toolArea, { button: 0, clientX: 50, clientY: 60 });

      expect(createLayerFromToolMock).toHaveBeenCalledTimes(1);
      const fullArgs = createLayerFromToolMock.mock.calls[0][0];
      expect(fullArgs.pos).toEqual({ x: 8, y: 18, width: 44, height: 44 });
      expect(fullArgs.args.figure).toBe('line');
    });

    it('recalculates bounding box to a square for a circle figure', () => {
      toolArgsState.toolArgs.figure = 'circle';
      const { container } = render(<ShapeToolArea overlayCtxRef={{ current: storeMocks.ctx }} />);
      const toolArea = container.firstElementChild as HTMLDivElement;

      fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 20 });
      fireEvent.pointerMove(toolArea, { button: 0, clientX: 50, clientY: 80 });
      fireEvent.pointerUp(toolArea, { button: 0, clientX: 50, clientY: 80 });

      expect(createLayerFromToolMock).toHaveBeenCalledTimes(1);
      const fullArgs = createLayerFromToolMock.mock.calls[0][0];

      // cx=30, cy=50, rx=20, ry=30 → r=max(20,30)=30
      expect(fullArgs.pos).toEqual({ x: -2, y: 18, width: 64, height: 64 });
      expect(fullArgs.pos.width).toBe(fullArgs.pos.height);
      expect(fullArgs.args.figure).toBe('circle');
    });

    it('recalculates bounding box to a square for a square figure', () => {
      toolArgsState.toolArgs.figure = 'square';
      const { container } = render(<ShapeToolArea overlayCtxRef={{ current: storeMocks.ctx }} />);
      const toolArea = container.firstElementChild as HTMLDivElement;

      fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 20 });
      fireEvent.pointerMove(toolArea, { button: 0, clientX: 50, clientY: 80 });
      fireEvent.pointerUp(toolArea, { button: 0, clientX: 50, clientY: 80 });

      expect(createLayerFromToolMock).toHaveBeenCalledTimes(1);
      const fullArgs = createLayerFromToolMock.mock.calls[0][0];

      // w=40, h=60, side=60, newEnd={70,80}
      expect(fullArgs.pos).toEqual({ x: 8, y: 18, width: 64, height: 64 });
      expect(fullArgs.pos.width).toBe(fullArgs.pos.height);
      expect(fullArgs.args.figure).toBe('square');
    });

    it('recalculates bounding box for an oval figure (no circle clamping)', () => {
      toolArgsState.toolArgs.figure = 'oval';
      const { container } = render(<ShapeToolArea overlayCtxRef={{ current: storeMocks.ctx }} />);
      const toolArea = container.firstElementChild as HTMLDivElement;

      fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 20 });
      fireEvent.pointerMove(toolArea, { button: 0, clientX: 50, clientY: 80 });
      fireEvent.pointerUp(toolArea, { button: 0, clientX: 50, clientY: 80 });

      expect(createLayerFromToolMock).toHaveBeenCalledTimes(1);
      const fullArgs = createLayerFromToolMock.mock.calls[0][0];

      // rx=20, ry=30 (no clamping)
      expect(fullArgs.pos).toEqual({ x: 8, y: 18, width: 44, height: 64 });
      expect(fullArgs.args.figure).toBe('oval');
    });

    it('prompts for dimensions on a click with no movement and expands the shape', () => {
      const promptMock = vi.fn().mockImplementation(() => '100');
      vi.stubGlobal('prompt', promptMock);

      const { container } = render(<ShapeToolArea overlayCtxRef={{ current: storeMocks.ctx }} />);
      const toolArea = container.firstElementChild as HTMLDivElement;

      fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 20 });
      fireEvent.pointerUp(toolArea, { button: 0, clientX: 10, clientY: 20 });

      expect(promptMock).toHaveBeenCalledTimes(2);
      expect(createLayerFromToolMock).toHaveBeenCalledTimes(1);
      const fullArgs = createLayerFromToolMock.mock.calls[0][0];
      // Click at (10,20) → prompt returns 100 for width/height
      // end = (10+100, 20+100) = (110, 120), adjusted by pos {x:8, y:18} → (102, 102)
      expect(fullArgs.args.start).toEqual({ x: 2, y: 2 });
      expect(fullArgs.args.end).toEqual({ x: 102, y: 102 });
      expect(fullArgs.pos).toEqual({ x: 8, y: 18, width: 104, height: 104 });
    });

    it('does not create a layer when the prompt returns null', () => {
      const { container } = render(<ShapeToolArea overlayCtxRef={{ current: storeMocks.ctx }} />);
      const toolArea = container.firstElementChild as HTMLDivElement;

      fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 20 });
      fireEvent.pointerUp(toolArea, { button: 0, clientX: 10, clientY: 20 });

      expect(createLayerFromToolMock).not.toHaveBeenCalled();
    });

    it('does not create a layer when prompt values are zero or negative', () => {
      vi.stubGlobal(
        'prompt',
        vi
          .fn()
          .mockImplementationOnce(() => '0')
          .mockImplementationOnce(() => '100')
      );

      const { container } = render(<ShapeToolArea overlayCtxRef={{ current: storeMocks.ctx }} />);
      const toolArea = container.firstElementChild as HTMLDivElement;

      fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 20 });
      fireEvent.pointerUp(toolArea, { button: 0, clientX: 10, clientY: 20 });

      expect(createLayerFromToolMock).not.toHaveBeenCalled();
    });

    it('does not create a layer when prompt values are non-numeric', () => {
      vi.stubGlobal(
        'prompt',
        vi
          .fn()
          .mockImplementationOnce(() => 'abc')
          .mockImplementationOnce(() => '100')
      );

      const { container } = render(<ShapeToolArea overlayCtxRef={{ current: storeMocks.ctx }} />);
      const toolArea = container.firstElementChild as HTMLDivElement;

      fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 20 });
      fireEvent.pointerUp(toolArea, { button: 0, clientX: 10, clientY: 20 });

      expect(createLayerFromToolMock).not.toHaveBeenCalled();
    });

    it('cancels a pending animation frame on pointer up', () => {
      vi.useFakeTimers();
      const cancelSpy = vi.spyOn(globalThis, 'cancelAnimationFrame');
      const { container } = render(<ShapeToolArea overlayCtxRef={{ current: storeMocks.ctx }} />);
      const toolArea = container.firstElementChild as HTMLDivElement;

      fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 20 });
      fireEvent.pointerMove(toolArea, { button: 0, clientX: 50, clientY: 60 });

      fireEvent.pointerUp(toolArea, { button: 0, clientX: 50, clientY: 60 });

      expect(cancelSpy).toHaveBeenCalled();
    });

    it('falls back to documentFrameFromSize when currentFrame is null', () => {
      const { container } = render(<ShapeToolArea overlayCtxRef={{ current: storeMocks.ctx }} />);
      const toolArea = container.firstElementChild as HTMLDivElement;

      fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 20 });
      fireEvent.pointerMove(toolArea, { button: 0, clientX: 50, clientY: 60 });
      fireEvent.pointerUp(toolArea, { button: 0, clientX: 50, clientY: 60 });

      const fullArgs = createLayerFromToolMock.mock.calls[0][0];
      // With documentFrame x=0, y=0 (from documentFrameFromSize), canvas coords == document coords
      expect(fullArgs.args.start).toEqual({ x: 2, y: 2 });
      expect(fullArgs.pos).toEqual({ x: 8, y: 18, width: 44, height: 44 });
    });
  });
});
