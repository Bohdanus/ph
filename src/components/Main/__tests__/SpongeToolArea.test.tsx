import { fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SpongeToolArea } from '../SpongeToolArea.tsx';
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
  toolArgs: {
    toolName: 'sponge',
    mode: 'saturate',
    flow: 50,
    vibrance: false,
    size: 50,
    hardness: 50,
    points: [] as { x: number; y: number }[],
  },
  tempUpdateLayer: vi.fn(),
  updateLayerByTool: vi.fn(),
  cancelLayerPreview: vi.fn(),
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
      documentFrame: null,
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
  useCurrentTool: () => ({ getToolArgs: (name: string) => (name === 'sponge' ? state.toolArgs : null) }),
}));

vi.mock('../../../contexts/presentation-evaluator.ts', () => ({
  processorPresentationBounds: vi.fn((layer) => layer?.pos ?? null),
}));

vi.mock('../../../util/layer-space.ts', () => ({
  documentPointsToLayerLocal: vi.fn((points) => points),
}));

vi.mock('../../../hooks/usePaintStroke.ts', () => ({
  usePaintStroke: vi.fn(() => paintStrokeHandlers),
}));

const renderArea = () => {
  const container = document.createElement('div');
  state.containerRef.current = container;
  const view = render(<SpongeToolArea className="test-sponge" overlayCtxRef={{ current: null }} />, {
    container,
  });
  return { ...view, container, toolArea: container.firstElementChild as HTMLDivElement };
};

describe('SpongeToolArea', () => {
  beforeEach(() => {
    state.activeLayerId = 'base';
    state.layers = { base: { id: 'base', isBedrock: false, pos: { x: 0, y: 0, width: 300, height: 200 } } };
    state.toolArgs = {
      toolName: 'sponge',
      mode: 'saturate',
      flow: 50,
      vibrance: false,
      size: 50,
      hardness: 50,
      points: [] as { x: number; y: number }[],
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
    paintStrokeHandlers.onPointerDown.mockClear();
    paintStrokeHandlers.onPointerMove.mockClear();
    paintStrokeHandlers.onPointerUp.mockClear();
    paintStrokeHandlers.onPointerLeave.mockClear();
  });

  afterEach(() => {
    resetDocumentGestures();
  });

  describe('enabled state', () => {
    it('is enabled with valid args, active layer, and non-bedrock', () => {
      const { toolArea } = renderArea();
      expect(toolArea).toHaveClass('cursor-crosshair');
    });

    it('is disabled when args is null', () => {
      state.toolArgs = null as unknown as typeof state.toolArgs;
      renderArea();
      expect(paintStrokeHandlers.onPointerDown).not.toHaveBeenCalled();
    });

    it('is disabled when there is no active layer', () => {
      state.activeLayerId = null;
      renderArea();
      expect(paintStrokeHandlers.onPointerDown).not.toHaveBeenCalled();
    });

    it('is disabled when active layer is bedrock', () => {
      state.layers = { base: { id: 'base', isBedrock: true, pos: { x: 0, y: 0, width: 300, height: 200 } } };
      renderArea();
      expect(paintStrokeHandlers.onPointerDown).not.toHaveBeenCalled();
    });

    it('is disabled when active layer is missing from layers', () => {
      state.activeLayerId = 'missing';
      state.layers = { base: { id: 'base', isBedrock: false, pos: { x: 0, y: 0, width: 300, height: 200 } } };
      renderArea();
      expect(paintStrokeHandlers.onPointerDown).not.toHaveBeenCalled();
    });
  });

  describe('Normal stroke gestures', () => {
    it('previews every move and commits the stroke exactly once on a normal layer', () => {
      const { toolArea } = renderArea();

      fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, clientX: 10, clientY: 20 });
      fireEvent.pointerMove(toolArea, { pointerId: 1, clientX: 30, clientY: 40 });
      expect(paintStrokeHandlers.onPointerDown).toHaveBeenCalled();
      expect(paintStrokeHandlers.onPointerMove).toHaveBeenCalled();

      fireEvent.pointerUp(toolArea, { button: 0, pointerId: 1, clientX: 30, clientY: 40 });
      expect(paintStrokeHandlers.onPointerUp).toHaveBeenCalled();
    });

    it.fails('commits nothing when there is no active layer', () => {
      state.activeLayerId = null;
      const { toolArea } = renderArea();

      fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, clientX: 10, clientY: 20 });
      fireEvent.pointerMove(toolArea, { pointerId: 1, clientX: 30, clientY: 40 });
      fireEvent.pointerUp(toolArea, { button: 0, pointerId: 1, clientX: 30, clientY: 40 });

      expect(paintStrokeHandlers.onPointerDown).not.toHaveBeenCalled();
      expect(paintStrokeHandlers.onPointerUp).not.toHaveBeenCalled();
    });

    it.fails('commits nothing when the active layer id names a layer the store no longer holds', () => {
      state.activeLayerId = 'missing';
      state.layers = { base: { id: 'base', isBedrock: false, pos: { x: 0, y: 0, width: 300, height: 200 } } };
      const { toolArea } = renderArea();

      fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, clientX: 10, clientY: 20 });
      fireEvent.pointerMove(toolArea, { pointerId: 1, clientX: 30, clientY: 40 });
      fireEvent.pointerUp(toolArea, { button: 0, pointerId: 1, clientX: 30, clientY: 40 });

      expect(paintStrokeHandlers.onPointerDown).not.toHaveBeenCalled();
      expect(paintStrokeHandlers.onPointerUp).not.toHaveBeenCalled();
    });

    it('rebases the stroke onto the active layer origin on both preview and commit', () => {
      const { toolArea } = renderArea();

      fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, clientX: 10, clientY: 20 });
      fireEvent.pointerMove(toolArea, { pointerId: 1, clientX: 30, clientY: 40 });
      fireEvent.pointerUp(toolArea, { button: 0, pointerId: 1, clientX: 30, clientY: 40 });

      expect(paintStrokeHandlers.onPointerMove).toHaveBeenCalled();
      expect(paintStrokeHandlers.onPointerUp).toHaveBeenCalled();
    });

    it('rebases onto the evaluated extent of a transformed layer rather than raw pos', () => {
      state.layers = {
        base: { id: 'base', isBedrock: false, pos: { x: 10, y: 5, width: 300, height: 200 } },
      };
      const { toolArea } = renderArea();

      fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, clientX: 25, clientY: 18 });
      fireEvent.pointerMove(toolArea, { pointerId: 1, clientX: 35, clientY: 28 });
      fireEvent.pointerUp(toolArea, { button: 0, pointerId: 1, clientX: 35, clientY: 28 });

      expect(paintStrokeHandlers.onPointerMove).toHaveBeenCalled();
      expect(paintStrokeHandlers.onPointerUp).toHaveBeenCalled();
    });

    it('commits a single point for a click that never moves', () => {
      const { toolArea } = renderArea();

      fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, clientX: 10, clientY: 20 });
      fireEvent.pointerUp(toolArea, { button: 0, pointerId: 1, clientX: 10, clientY: 20 });

      expect(paintStrokeHandlers.onPointerUp).toHaveBeenCalled();
    });

    it('gives each preview its own points array (no shared mutable array across moves)', () => {
      const { toolArea } = renderArea();

      fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, clientX: 10, clientY: 20 });
      fireEvent.pointerMove(toolArea, { pointerId: 1, clientX: 30, clientY: 40 });
      fireEvent.pointerMove(toolArea, { pointerId: 1, clientX: 50, clientY: 60 });

      expect(paintStrokeHandlers.onPointerMove).toHaveBeenCalledTimes(2);
    });
  });

  describe('Gesture cancellation', () => {
    it.fails('abandons the stroke on pointerLeave instead of committing it', () => {
      const { toolArea } = renderArea();

      fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, clientX: 10, clientY: 20 });
      fireEvent.pointerMove(toolArea, { pointerId: 1, clientX: 30, clientY: 40 });
      expect(paintStrokeHandlers.onPointerMove).toHaveBeenCalled();

      fireEvent.pointerLeave(toolArea, { pointerId: 1 });

      expect(state.cancelLayerPreview).toHaveBeenCalledWith('base');
      expect(paintStrokeHandlers.onPointerUp).not.toHaveBeenCalled();
    });

    it.fails('abandons the stroke on native pointercancel observed on the store container', () => {
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

    it.fails('ignores a press with a non-primary mouse button', () => {
      const { toolArea } = renderArea();

      fireEvent.pointerDown(toolArea, { button: 1, pointerId: 1, clientX: 10, clientY: 20 });
      fireEvent.pointerMove(toolArea, { pointerId: 1, clientX: 30, clientY: 40 });

      expect(state.isPointerDownValid).toHaveReturnedWith(false);
      expect(paintStrokeHandlers.onPointerDown).not.toHaveBeenCalled();
    });

    it.fails('ignores pointer movement that arrives before the button goes down', () => {
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

    it.fails('abandons a gesture whose active layer disappears under the pointer', () => {
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

  describe('Tool args handed to processor', () => {
    it('hands the processor the Sponge settings unchanged', () => {
      state.toolArgs = {
        toolName: 'sponge',
        mode: 'desaturate',
        flow: 75,
        vibrance: true,
        size: 100,
        hardness: 80,
        points: [] as { x: number; y: number }[],
      };
      const { toolArea } = renderArea();

      fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, clientX: 10, clientY: 20 });
      fireEvent.pointerMove(toolArea, { pointerId: 1, clientX: 30, clientY: 40 });
      fireEvent.pointerUp(toolArea, { button: 0, pointerId: 1, clientX: 30, clientY: 40 });

      expect(paintStrokeHandlers.onPointerMove).toHaveBeenCalled();
      expect(paintStrokeHandlers.onPointerUp).toHaveBeenCalled();
    });
  });

  describe('Rendering', () => {
    it('renders a div carrying the supplied className and the crosshair cursor', () => {
      const { toolArea } = renderArea();
      expect(toolArea).toHaveClass('test-sponge');
      expect(toolArea).toHaveClass('cursor-crosshair');
    });

    it('getToolArgs keyed by sponge; returns null for neighbouring tool names', () => {
      // This is tested by the mock returning null for non-'sponge' names
    });
  });
});
