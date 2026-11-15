import { fireEvent, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SpongeToolArea } from '../SpongeToolArea.tsx';
import { resetDocumentGestures } from '../../../hooks/document-gesture.ts';

const state = vi.hoisted(() => ({
  activeLayerId: 'layer-1' as string | null,
  containerRef: { current: null as HTMLDivElement | null },
  documentFrame: { x: 10, y: 15, width: 200, height: 120 } as {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null,
  layers: {
    'layer-1': { id: 'layer-1', isBedrock: false, pos: { x: 30, y: 20, width: 200, height: 120 } },
  } as Record<string, { id: string; isBedrock: boolean; pos: { x: number; y: number; width: number; height: number } }>,
  toolArgs: {
    toolName: 'sponge',
    mode: 'saturate',
    flow: 50,
    vibrance: false,
    size: 50,
    hardness: 50,
    points: [] as { x: number; y: number }[],
  },
  activePointerId: null as number | null,
  tempUpdateLayer: vi.fn(),
  updateLayerByTool: vi.fn(),
  cancelLayerPreview: vi.fn(),
}));

vi.mock('../../../contexts/StoreContext.tsx', () => ({
  useStore: () => [
    {
      activeLayerId: state.activeLayerId,
      containerRef: state.containerRef,
      documentFrame: state.documentFrame,
      layers: state.layers,
      totalSize: { width: 200, height: 120 },
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

// These cases cover document-frame conversion and layer-local rebasing; viewport-to-canvas
// mapping belongs to usePointerPosition's separate contract.
vi.mock('../../../hooks/usePointerPosition.ts', () => ({
  usePointerPosition: () => ({
    isPointerDownValid: vi.fn((event: PointerEvent) => {
      if (event.button !== 0 || state.activePointerId !== null) return false;
      state.activePointerId = event.pointerId;
      return true;
    }),
    isPointerMoveValid: vi.fn((event: PointerEvent) => state.activePointerId === event.pointerId),
    isPointerUpValid: vi.fn((event: PointerEvent) => {
      if (event.button !== 0 || state.activePointerId !== event.pointerId) return false;
      state.activePointerId = null;
      return true;
    }),
    getLocalCoords: (event: PointerEvent) => ({ x: event.clientX, y: event.clientY }),
    releasePointer: () => {
      state.activePointerId = null;
    },
  }),
}));

const renderArea = () => {
  const container = document.createElement('div');
  state.containerRef.current = container;
  const view = render(<SpongeToolArea className="test-sponge" overlayCtxRef={{ current: null }} />, { container });
  return { ...view, container, area: container.firstElementChild as HTMLDivElement };
};

describe('SpongeToolArea gesture integration', () => {
  beforeEach(() => {
    resetDocumentGestures();
    state.activeLayerId = 'layer-1';
    state.documentFrame = { x: 10, y: 15, width: 200, height: 120 };
    state.layers = {
      'layer-1': { id: 'layer-1', isBedrock: false, pos: { x: 30, y: 20, width: 200, height: 120 } },
    };
    state.activePointerId = null;
    state.tempUpdateLayer.mockClear();
    state.updateLayerByTool.mockClear();
    state.cancelLayerPreview.mockClear();
  });

  it('previews moves and commits one layer-local stroke including its distinct release point', () => {
    const { area } = renderArea();

    fireEvent.pointerDown(area, { button: 0, pointerId: 1, clientX: 10, clientY: 20 });
    fireEvent.pointerMove(area, { pointerId: 1, clientX: 30, clientY: 40 });
    fireEvent.pointerMove(area, { pointerId: 1, clientX: 50, clientY: 60 });
    fireEvent.pointerUp(area, { button: 0, pointerId: 1, clientX: 60, clientY: 70 });

    expect(state.tempUpdateLayer).toHaveBeenCalledTimes(2);
    expect(state.tempUpdateLayer).toHaveBeenLastCalledWith({
      id: 'layer-1',
      toolArgs: expect.objectContaining({
        toolName: 'sponge',
        points: [
          { x: -10, y: 15 },
          { x: 10, y: 35 },
          { x: 30, y: 55 },
        ],
      }),
    });
    expect(state.updateLayerByTool).toHaveBeenCalledTimes(1);
    expect(state.updateLayerByTool).toHaveBeenCalledWith({
      id: 'layer-1',
      toolArgs: expect.objectContaining({
        toolName: 'sponge',
        points: [
          { x: -10, y: 15 },
          { x: 10, y: 35 },
          { x: 30, y: 55 },
          { x: 40, y: 65 },
        ],
      }),
    });
  });

  it('does not preview or commit when the active layer is bedrock', () => {
    state.layers['layer-1'].isBedrock = true;
    const { area } = renderArea();

    fireEvent.pointerDown(area, { button: 0, pointerId: 1, clientX: 10, clientY: 20 });
    fireEvent.pointerMove(area, { pointerId: 1, clientX: 30, clientY: 40 });
    fireEvent.pointerUp(area, { button: 0, pointerId: 1, clientX: 30, clientY: 40 });

    expect(state.tempUpdateLayer).not.toHaveBeenCalled();
    expect(state.updateLayerByTool).not.toHaveBeenCalled();
  });

  it('cancels the preview on native pointercancel without committing', () => {
    const { area, container } = renderArea();

    fireEvent.pointerDown(area, { button: 0, pointerId: 7, clientX: 10, clientY: 20 });
    fireEvent.pointerMove(area, { pointerId: 7, clientX: 30, clientY: 40 });
    fireEvent.pointerCancel(container, { pointerId: 7 });
    fireEvent.pointerUp(area, { button: 0, pointerId: 7, clientX: 30, clientY: 40 });

    expect(state.tempUpdateLayer).toHaveBeenCalledOnce();
    expect(state.cancelLayerPreview).toHaveBeenCalledExactlyOnceWith('layer-1');
    expect(state.updateLayerByTool).not.toHaveBeenCalled();
  });

  it('cancels the preview when the owning pointer leaves the tool surface', () => {
    const { area } = renderArea();

    fireEvent.pointerDown(area, { button: 0, pointerId: 3, clientX: 10, clientY: 20 });
    fireEvent.pointerMove(area, { pointerId: 3, clientX: 30, clientY: 40 });
    fireEvent.pointerLeave(area, { button: 0, pointerId: 3 });
    fireEvent.pointerUp(area, { button: 0, pointerId: 3, clientX: 30, clientY: 40 });

    expect(state.tempUpdateLayer).toHaveBeenCalledOnce();
    expect(state.cancelLayerPreview).toHaveBeenCalledExactlyOnceWith('layer-1');
    expect(state.updateLayerByTool).not.toHaveBeenCalled();
  });
});
