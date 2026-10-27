import { fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SpotHealingToolArea } from '../SpotHealingToolArea.tsx';
import { isDocumentGestureOpen, resetDocumentGestures } from '../../../hooks/document-gesture.ts';

const state = vi.hoisted(() => ({
  activeLayerId: 'base' as string | null,
  containerRef: { current: null as HTMLDivElement | null },
  layers: {
    base: { id: 'base', isBedrock: false },
  } as Record<string, { id: string; isBedrock: boolean }>,
  totalSize: { width: 300, height: 200 },
  toolArgs: { toolName: 'spot-healing', points: [] as { x: number; y: number }[] },
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
  useCurrentTool: () => ({ toolArgs: state.toolArgs }),
}));

vi.mock('../../../contexts/presentation-evaluator.ts', () => ({
  processorPresentationBounds: vi.fn(() => null),
}));

vi.mock('../../../util/layer-space.ts', () => ({
  documentPointsToLayerLocal: vi.fn((points) => points),
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

const renderArea = () => {
  const container = document.createElement('div');
  state.containerRef.current = container;
  const view = render(<SpotHealingToolArea className="test-spot-healing" overlayCtxRef={{ current: null }} />, {
    container,
  });
  return { ...view, container, toolArea: container.firstElementChild as HTMLDivElement };
};

describe('SpotHealingToolArea pointer cancellation', () => {
  beforeEach(() => {
    state.activeLayerId = 'base';
    state.layers = { base: { id: 'base', isBedrock: false } };
    state.pointerId.current = null;
    state.isMouseDown.current = false;
    state.isPointerDownValid.mockClear();
    state.isPointerMoveValid.mockClear();
    state.isPointerUpValid.mockClear();
    state.releasePointer.mockClear();
    state.tempUpdateLayer.mockClear();
    state.updateLayerByTool.mockClear();
    state.cancelLayerPreview.mockClear();
  });

  afterEach(() => {
    resetDocumentGestures();
  });

  it('rolls back the preview when the owning pointer is cancelled', () => {
    const { container, toolArea } = renderArea();

    fireEvent.pointerDown(toolArea, { button: 0, pointerId: 7, clientX: 10, clientY: 20 });
    fireEvent.pointerMove(toolArea, { pointerId: 7, clientX: 30, clientY: 40 });
    expect(state.tempUpdateLayer).toHaveBeenCalledOnce();
    expect(isDocumentGestureOpen()).toBe(true);

    fireEvent.pointerCancel(container, { pointerId: 7 });

    expect(state.updateLayerByTool).not.toHaveBeenCalled();
    expect(state.cancelLayerPreview).toHaveBeenCalledExactlyOnceWith('base');
    expect(isDocumentGestureOpen()).toBe(false);

    fireEvent.pointerUp(toolArea, { button: 0, pointerId: 7, clientX: 30, clientY: 40 });
    expect(state.updateLayerByTool).not.toHaveBeenCalled();
    expect(state.cancelLayerPreview).toHaveBeenCalledOnce();
  });
});
