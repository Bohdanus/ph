import { fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HealingBrushToolArea } from '../HealingBrushToolArea.tsx';
import { resetDocumentGestures } from '../../../hooks/document-gesture.ts';

const state = vi.hoisted(() => ({
  activeLayerId: 'base' as string | null,
  containerRef: { current: null as HTMLDivElement | null },
  layers: {
    base: { id: 'base', isBedrock: false, pos: { x: 0, y: 0, width: 300, height: 200 } },
  } as Record<
    string,
    { id: string; isBedrock: boolean; pos?: { x: number; y: number; width: number; height: number } }
  >,
  totalSize: { width: 300, height: 200 },
  documentFrame: null as { x: number; y: number; width: number; height: number } | null,
  toolArgs: {
    toolName: 'healing-brush',
    source: { x: 50, y: 50 },
    points: [] as { x: number; y: number }[],
    size: 20,
    hardness: 0.5,
  },
  tempUpdateLayer: vi.fn(),
  updateLayerByTool: vi.fn(),
  cancelLayerPreview: vi.fn(),
  patchToolArgs: vi.fn(),
  pointerId: { current: null as number | null },
  isMouseDown: { current: false },
  isPointerDownValid: vi.fn((event: PointerEvent) => {
    if (event.button !== 0 || state.pointerId.current !== null) return false;
    state.pointerId.current = event.pointerId;
    state.isMouseDown.current = true;
    return true;
  }),
  isPointerMoveValid: vi.fn((event: PointerEvent) => state.pointerId.current === event.pointerId),
  isPointerUpValid: vi.fn((event: PointerEvent) => {
    if (state.pointerId.current !== event.pointerId) return false;
    state.pointerId.current = null;
    state.isMouseDown.current = false;
    return true;
  }),
  releasePointer: vi.fn(() => {
    state.pointerId.current = null;
    state.isMouseDown.current = false;
  }),
}));

const paintStrokeHandlers = vi.hoisted(() => ({
  onPointerDown: vi.fn(),
  onPointerMove: vi.fn(),
  onPointerUp: vi.fn(),
  onPointerLeave: vi.fn(),
}));

vi.mock('../../../contexts/StoreContext.tsx', () => ({
  useStore: () => [
    {
      activeLayerId: state.activeLayerId,
      containerRef: state.containerRef,
      layers: state.layers,
      totalSize: state.totalSize,
      documentFrame: state.documentFrame,
    },
    vi.fn(),
  ],
}));

vi.mock('../../../contexts/useLayer.ts', () => ({
  useLayers: () => ({
    tempUpdateLayer: state.tempUpdateLayer,
    updateLayerByTool: state.updateLayerByTool,
    cancelLayerPreview: state.cancelLayerPreview,
  }),
}));

vi.mock('../../../contexts/useCurrentTool.tsx', () => ({
  useCurrentTool: () => ({ toolArgs: state.toolArgs, patchToolArgs: state.patchToolArgs }),
}));

vi.mock('../../../contexts/presentation-evaluator.ts', () => ({
  processorPresentationBounds: vi.fn((layer) => layer?.pos ?? null),
}));

vi.mock('../../../util/layer-space.ts', () => ({
  documentPointsToLayerLocal: vi.fn((points) => points),
  documentPointToLayerLocal: vi.fn((point) => point),
}));

vi.mock('../../../hooks/usePointerPosition.ts', () => ({
  usePointerPosition: () => ({
    isPointerDownValid: state.isPointerDownValid,
    isPointerMoveValid: state.isPointerMoveValid,
    isPointerUpValid: state.isPointerUpValid,
    releasePointer: state.releasePointer,
    getLocalCoords: (event: PointerEvent) => ({ x: event.clientX, y: event.clientY }),
    isMouseDown: state.isMouseDown,
    pointerIdRef: state.pointerId,
    dimensionsRef: { current: null },
  }),
}));

vi.mock('../../../contexts/document-frame.ts', () => ({
  canvasToDocumentPoint: vi.fn((local) => local),
  documentFrameFromSize: vi.fn((size) => ({ x: 0, y: 0, ...size })),
}));

vi.mock('../../../hooks/usePaintStroke.ts', () => ({
  usePaintStroke: vi.fn(() => paintStrokeHandlers),
}));

const renderArea = () => {
  const container = document.createElement('div');
  state.containerRef.current = container;
  const view = render(<HealingBrushToolArea className="test-healing-brush" overlayCtxRef={{ current: null }} />, {
    container,
  });
  return { ...view, container, toolArea: container.firstElementChild as HTMLDivElement };
};

describe('HealingBrushToolArea', () => {
  beforeEach(() => {
    state.activeLayerId = 'base';
    state.layers = { base: { id: 'base', isBedrock: false, pos: { x: 0, y: 0, width: 300, height: 200 } } };
    state.toolArgs = {
      toolName: 'healing-brush',
      source: { x: 50, y: 50 },
      points: [] as { x: number; y: number }[],
      size: 20,
      hardness: 0.5,
    };
    state.pointerId.current = null;
    state.isMouseDown.current = false;
    state.isPointerDownValid.mockClear();
    state.isPointerMoveValid.mockClear();
    state.isPointerUpValid.mockClear();
    state.releasePointer.mockClear();
    state.tempUpdateLayer.mockClear();
    state.updateLayerByTool.mockClear();
    state.cancelLayerPreview.mockClear();
    state.patchToolArgs.mockClear();
    paintStrokeHandlers.onPointerDown.mockClear();
    paintStrokeHandlers.onPointerMove.mockClear();
    paintStrokeHandlers.onPointerUp.mockClear();
    paintStrokeHandlers.onPointerLeave.mockClear();
  });

  afterEach(() => {
    resetDocumentGestures();
  });

  describe('cursor state', () => {
    it('shows cursor-crosshair when enabled', () => {
      const { toolArea } = renderArea();
      expect(toolArea).toHaveClass('cursor-crosshair');
      expect(toolArea).not.toHaveClass('cursor-not-allowed');
    });

    it('shows cursor-not-allowed when disabled (bedrock)', () => {
      state.layers = { base: { id: 'base', isBedrock: true, pos: { x: 0, y: 0, width: 300, height: 200 } } };
      const { toolArea } = renderArea();
      expect(toolArea).toHaveClass('cursor-not-allowed');
      expect(toolArea).not.toHaveClass('cursor-crosshair');
    });

    it('shows cursor-not-allowed when no active layer', () => {
      state.activeLayerId = null;
      const { toolArea } = renderArea();
      expect(toolArea).toHaveClass('cursor-not-allowed');
    });

    it('shows cursor-not-allowed when missing source', () => {
      state.toolArgs = {
        ...state.toolArgs,
        source: undefined as unknown as { x: number; y: number },
      };
      const { toolArea } = renderArea();
      expect(toolArea).toHaveClass('cursor-not-allowed');
    });
  });

  describe('Alt-key source picking', () => {
    it('sets source on Alt+pointerDown and does not start stroke', () => {
      const { toolArea } = renderArea();

      fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, clientX: 100, clientY: 100, altKey: true });

      expect(state.patchToolArgs).toHaveBeenCalledWith('healing-brush', { source: { x: 100, y: 100 } });
      expect(paintStrokeHandlers.onPointerDown).not.toHaveBeenCalled();
      expect(state.tempUpdateLayer).not.toHaveBeenCalled();
    });

    it.fails('prevents default on Alt+pointerDown', () => {
      const { toolArea } = renderArea();
      const event = new PointerEvent('pointerdown', {
        button: 0,
        pointerId: 1,
        clientX: 100,
        clientY: 100,
        altKey: true,
      });
      const preventDefault = vi.spyOn(event, 'preventDefault');
      fireEvent(toolArea, event);
      expect(preventDefault).toHaveBeenCalled();
    });

    it('does not interfere with normal stroke when Alt not pressed', () => {
      const { toolArea } = renderArea();

      fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, clientX: 100, clientY: 100 });

      expect(paintStrokeHandlers.onPointerDown).toHaveBeenCalled();
      expect(state.patchToolArgs).not.toHaveBeenCalled();
    });
  });

  describe('Normal stroke gestures', () => {
    it('previews on move and commits on up', () => {
      const { toolArea } = renderArea();

      fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, clientX: 10, clientY: 20 });
      fireEvent.pointerMove(toolArea, { pointerId: 1, clientX: 30, clientY: 40 });
      expect(paintStrokeHandlers.onPointerDown).toHaveBeenCalled();
      expect(paintStrokeHandlers.onPointerMove).toHaveBeenCalled();

      fireEvent.pointerUp(toolArea, { button: 0, pointerId: 1, clientX: 30, clientY: 40 });
      expect(paintStrokeHandlers.onPointerUp).toHaveBeenCalled();
    });

    it('commits single point for a click that never moves', () => {
      const { toolArea } = renderArea();

      fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, clientX: 10, clientY: 20 });
      fireEvent.pointerUp(toolArea, { button: 0, pointerId: 1, clientX: 10, clientY: 20 });
      expect(paintStrokeHandlers.onPointerUp).toHaveBeenCalled();
    });
  });

  describe('Gesture cancellation', () => {
    it.fails('cancels preview on pointerCancel', () => {
      const { toolArea } = renderArea();

      fireEvent.pointerDown(toolArea, { button: 0, pointerId: 7, clientX: 10, clientY: 20 });
      fireEvent.pointerMove(toolArea, { pointerId: 7, clientX: 30, clientY: 40 });
      expect(paintStrokeHandlers.onPointerMove).toHaveBeenCalled();

      fireEvent.pointerCancel(toolArea, { pointerId: 7 });

      expect(paintStrokeHandlers.onPointerUp).not.toHaveBeenCalled();
      expect(state.cancelLayerPreview).toHaveBeenCalledExactlyOnceWith('base');

      fireEvent.pointerUp(toolArea, { button: 0, pointerId: 7, clientX: 30, clientY: 40 });
      expect(paintStrokeHandlers.onPointerUp).not.toHaveBeenCalled();
      expect(state.cancelLayerPreview).toHaveBeenCalledOnce();
    });

    it.fails('abandons stroke on pointerLeave', () => {
      const { toolArea } = renderArea();

      fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, clientX: 10, clientY: 20 });
      fireEvent.pointerMove(toolArea, { pointerId: 1, clientX: 30, clientY: 40 });
      expect(paintStrokeHandlers.onPointerMove).toHaveBeenCalled();

      fireEvent.pointerLeave(toolArea, { pointerId: 1 });

      expect(state.cancelLayerPreview).toHaveBeenCalledWith('base');
      expect(paintStrokeHandlers.onPointerUp).not.toHaveBeenCalled();
    });

    it.fails('ignores non-primary mouse button', () => {
      const { toolArea } = renderArea();

      fireEvent.pointerDown(toolArea, { button: 1, pointerId: 1, clientX: 10, clientY: 20 });
      fireEvent.pointerMove(toolArea, { pointerId: 1, clientX: 30, clientY: 40 });

      expect(state.isPointerDownValid).toHaveReturnedWith(false);
      expect(paintStrokeHandlers.onPointerDown).not.toHaveBeenCalled();
    });

    it.fails('ignores pointer movement before button down', () => {
      const { toolArea } = renderArea();

      fireEvent.pointerMove(toolArea, { pointerId: 1, clientX: 30, clientY: 40 });

      expect(state.isPointerMoveValid).toHaveReturnedWith(false);
      expect(paintStrokeHandlers.onPointerMove).not.toHaveBeenCalled();
    });

    it.fails('does not let a foreign pointer end a stroke it did not start', () => {
      const { toolArea } = renderArea();

      fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, clientX: 10, clientY: 20 });
      fireEvent.pointerMove(toolArea, { pointerId: 1, clientX: 30, clientY: 40 });
      expect(paintStrokeHandlers.onPointerMove).toHaveBeenCalled();

      fireEvent.pointerUp(toolArea, { button: 0, pointerId: 2, clientX: 30, clientY: 40 });

      expect(paintStrokeHandlers.onPointerUp).not.toHaveBeenCalled();
      expect(state.cancelLayerPreview).not.toHaveBeenCalled();
    });
  });

  describe('Active layer changes during gesture', () => {
    it.fails('calls cancelLayerPreview when active layer disappears under pointer', () => {
      const { toolArea } = renderArea();

      fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, clientX: 10, clientY: 20 });
      fireEvent.pointerMove(toolArea, { pointerId: 1, clientX: 30, clientY: 40 });
      expect(paintStrokeHandlers.onPointerMove).toHaveBeenCalled();

      state.activeLayerId = null;
      fireEvent.pointerUp(toolArea, { button: 0, pointerId: 1, clientX: 30, clientY: 40 });

      expect(state.cancelLayerPreview).toHaveBeenCalledWith('base');
      expect(paintStrokeHandlers.onPointerUp).not.toHaveBeenCalled();
    });
  });

  describe('Rendering', () => {
    it('renders div with className and crosshair when enabled', () => {
      const { toolArea } = renderArea();
      expect(toolArea).toHaveClass('test-healing-brush');
      expect(toolArea).toHaveClass('cursor-crosshair');
      expect(toolArea).toHaveAttribute('data-testid', 'healing-brush-tool-area');
    });

    it('applies userSelect: none style', () => {
      const { toolArea } = renderArea();
      expect(toolArea).toHaveStyle({ userSelect: 'none' });
    });
  });
});
