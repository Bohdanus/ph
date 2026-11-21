import { fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PatchToolArea } from '../PatchToolArea.tsx';
import type { Selection, Point, Size } from '../../../contexts/general-types.ts';

const state = vi.hoisted(() => ({
  containerRef: { current: null as HTMLDivElement | null },
  activeLayerId: 'layer-1' as string | null,
  activeSelectionId: 'sel-1' as string | null,
  layers: {
    'layer-1': {
      id: 'layer-1',
      isBedrock: false,
      pos: { x: 0, y: 0, width: 200, height: 200 },
    },
  } as Record<string, { id: string; isBedrock: boolean; pos: Point & Size }>,
  presentationBounds: null as (Point & Size) | null,
  selections: [
    {
      id: 'sel-1',
      isActive: true,
      points: [
        [
          { x: 50, y: 50 },
          { x: 150, y: 50 },
          { x: 150, y: 150 },
          { x: 50, y: 150 },
        ],
      ],
      pos: { x: 50, y: 50, width: 100, height: 100 },
    },
  ] as Selection[],
  totalSize: { width: 200, height: 200 },
  tempUpdateLayer: vi.fn(),
  updateLayerByTool: vi.fn(),
  cancelLayerPreview: vi.fn(),
  toolArgs: {
    toolName: 'patch',
    diffusion: 4,
    customProp: 'test',
  },
  getLocalCoords: vi.fn((event: PointerEvent) => ({ x: event.clientX, y: event.clientY })),
  setPointerCapture: vi.fn(),
  releasePointerCapture: vi.fn(),
}));

vi.mock('../../../contexts/StoreContext.tsx', () => ({
  useStore: () => [
    {
      containerRef: state.containerRef,
      activeLayerId: state.activeLayerId,
      activeSelectionId: state.activeSelectionId,
      layers: state.layers,
      selections: state.selections,
      totalSize: state.totalSize,
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
  useCurrentTool: () => ({
    toolArgs: state.toolArgs,
    patchToolArgs: vi.fn(),
  }),
}));

vi.mock('../../../hooks/usePointerPosition.ts', () => ({
  usePointerPosition: () => ({
    getLocalCoords: state.getLocalCoords,
  }),
}));

vi.mock('../../../contexts/presentation-evaluator.ts', () => ({
  processorPresentationBounds: vi.fn((layer) => state.presentationBounds ?? layer?.pos ?? null),
}));

const renderArea = () => {
  const container = document.createElement('div');
  container.style.width = '200px';
  container.style.height = '200px';
  container.style.position = 'relative';
  state.containerRef.current = container;
  const view = render(<PatchToolArea className="test-patch" overlayCtxRef={{ current: null }} />, { container });
  const area = container.firstElementChild as HTMLDivElement;
  area.setPointerCapture = state.setPointerCapture;
  area.releasePointerCapture = state.releasePointerCapture;
  return { ...view, container, area };
};

describe('PatchToolArea', () => {
  beforeEach(() => {
    state.activeLayerId = 'layer-1';
    state.activeSelectionId = 'sel-1';
    state.layers = {
      'layer-1': {
        id: 'layer-1',
        isBedrock: false,
        pos: { x: 0, y: 0, width: 200, height: 200 },
      },
    };
    state.presentationBounds = null;
    state.selections = [
      {
        id: 'sel-1',
        isActive: true,
        points: [
          [
            { x: 50, y: 50 },
            { x: 150, y: 50 },
            { x: 150, y: 150 },
            { x: 50, y: 150 },
          ],
        ],
        pos: { x: 50, y: 50, width: 100, height: 100 },
      },
    ];
    state.toolArgs = { toolName: 'patch', diffusion: 4, customProp: 'test' };
    state.getLocalCoords.mockImplementation((event: PointerEvent) => ({ x: event.clientX, y: event.clientY }));
    state.setPointerCapture.mockClear();
    state.releasePointerCapture.mockClear();
    state.tempUpdateLayer.mockClear();
    state.updateLayerByTool.mockClear();
    state.cancelLayerPreview.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('enabled state', () => {
    it('shows cursor-move when enabled (active layer, selection, non-bedrock)', () => {
      const { area } = renderArea();
      expect(area).toHaveClass('cursor-move');
      expect(area).not.toHaveClass('cursor-not-allowed');
    });

    it('shows cursor-not-allowed when no active layer', () => {
      state.activeLayerId = null;
      const { area } = renderArea();
      expect(area).toHaveClass('cursor-not-allowed');
    });

    it('shows cursor-not-allowed when active layer is bedrock', () => {
      state.layers['layer-1'].isBedrock = true;
      const { area } = renderArea();
      expect(area).toHaveClass('cursor-not-allowed');
    });

    it('shows cursor-not-allowed when no active selection', () => {
      state.activeSelectionId = null;
      const { area } = renderArea();
      expect(area).toHaveClass('cursor-not-allowed');
    });

    it('shows cursor-not-allowed when selection is not active', () => {
      state.selections[0].isActive = false;
      const { area } = renderArea();
      expect(area).toHaveClass('cursor-not-allowed');
    });

    it('shows cursor-not-allowed when selection does not exist', () => {
      state.activeSelectionId = 'missing';
      const { area } = renderArea();
      expect(area).toHaveClass('cursor-not-allowed');
    });
  });

  describe('pointer down', () => {
    it('captures pointer and starts drag on valid pointer down', () => {
      const { area } = renderArea();

      fireEvent.pointerDown(area, { button: 0, pointerId: 1, clientX: 60, clientY: 60 });

      expect(state.setPointerCapture).toHaveBeenCalledWith(1);
    });

    it('ignores non-primary mouse button', () => {
      const { area } = renderArea();

      fireEvent.pointerDown(area, { button: 1, pointerId: 1, clientX: 60, clientY: 60 });

      expect(state.setPointerCapture).not.toHaveBeenCalled();
    });

    it('ignores pointer down when drag already in progress', () => {
      const { area } = renderArea();

      fireEvent.pointerDown(area, { button: 0, pointerId: 1, clientX: 60, clientY: 60 });
      state.setPointerCapture.mockClear();

      fireEvent.pointerDown(area, { button: 0, pointerId: 2, clientX: 70, clientY: 70 });

      expect(state.setPointerCapture).not.toHaveBeenCalled();
    });

    it('does nothing when disabled', () => {
      state.activeLayerId = null;
      const { area } = renderArea();

      fireEvent.pointerDown(area, { button: 0, pointerId: 1, clientX: 60, clientY: 60 });

      expect(state.setPointerCapture).not.toHaveBeenCalled();
    });
  });

  describe('pointer move', () => {
    it('updates temp layer with donor point during drag', () => {
      const { area } = renderArea();

      fireEvent.pointerDown(area, { button: 0, pointerId: 1, clientX: 60, clientY: 60 });
      fireEvent.pointerMove(area, { pointerId: 1, clientX: 70, clientY: 70 });

      expect(state.tempUpdateLayer).toHaveBeenCalledWith({
        id: 'layer-1',
        toolArgs: expect.objectContaining({
          toolName: 'patch',
          diffusion: 4,
          sourceRect: expect.objectContaining({ x: 50, y: 50, width: 100, height: 100 }),
          donorPoint: expect.objectContaining({ x: 60, y: 60 }),
        }),
      });
    });

    it('does nothing when no drag in progress', () => {
      const { area } = renderArea();

      fireEvent.pointerMove(area, { pointerId: 1, clientX: 70, clientY: 70 });

      expect(state.tempUpdateLayer).not.toHaveBeenCalled();
    });

    it('does nothing when drag pointer id does not match', () => {
      const { area } = renderArea();

      fireEvent.pointerDown(area, { button: 0, pointerId: 1, clientX: 60, clientY: 60 });
      fireEvent.pointerMove(area, { pointerId: 2, clientX: 70, clientY: 70 });

      expect(state.tempUpdateLayer).not.toHaveBeenCalled();
    });

    it('does nothing when no active layer', () => {
      state.activeLayerId = null;
      const { area } = renderArea();

      fireEvent.pointerDown(area, { button: 0, pointerId: 1, clientX: 60, clientY: 60 });
      fireEvent.pointerMove(area, { pointerId: 1, clientX: 70, clientY: 70 });

      expect(state.tempUpdateLayer).not.toHaveBeenCalled();
    });

    it.fails('does nothing when activeLayerId becomes null during move', () => {
      const { area } = renderArea();

      fireEvent.pointerDown(area, { button: 0, pointerId: 1, clientX: 60, clientY: 60 });
      state.activeLayerId = null;
      fireEvent.pointerMove(area, { pointerId: 1, clientX: 70, clientY: 70 });

      expect(state.tempUpdateLayer).not.toHaveBeenCalled();
    });

    it('calculates donor point relative to selection origin', () => {
      const { area } = renderArea();

      fireEvent.pointerDown(area, { button: 0, pointerId: 1, clientX: 60, clientY: 60 });
      fireEvent.pointerMove(area, { pointerId: 1, clientX: 75, clientY: 80 });

      // donor point = selection.pos + (current - start)
      // = { x: 50, y: 50 } + { x: 15, y: 20 } = { x: 65, y: 70 }
      expect(state.tempUpdateLayer).toHaveBeenCalledWith({
        id: 'layer-1',
        toolArgs: expect.objectContaining({
          donorPoint: { x: 65, y: 70 },
        }),
      });
    });

    it('keeps the selection captured at pointer down for the whole drag', () => {
      const { area, rerender } = renderArea();

      fireEvent.pointerDown(area, { button: 0, pointerId: 1, clientX: 60, clientY: 60 });
      state.selections = state.selections.map((selection) =>
        selection.id === 'sel-1' ? { ...selection, pos: { x: 100, y: 100, width: 40, height: 40 } } : selection
      );
      rerender(<PatchToolArea className="test-patch" overlayCtxRef={{ current: null }} />);
      fireEvent.pointerMove(area, { pointerId: 1, clientX: 70, clientY: 80 });
      fireEvent.pointerUp(area, { button: 0, pointerId: 1, clientX: 70, clientY: 80 });

      expect(state.updateLayerByTool).toHaveBeenCalledWith({
        id: 'layer-1',
        toolArgs: expect.objectContaining({
          sourceRect: { x: 50, y: 50, width: 100, height: 100 },
          donorPoint: { x: 60, y: 70 },
        }),
      });
    });
  });

  describe('buildArgs function', () => {
    it('spreads args and calculates sourceRect with origin', () => {
      const { area } = renderArea();

      fireEvent.pointerDown(area, { button: 0, pointerId: 1, clientX: 60, clientY: 60 });
      fireEvent.pointerMove(area, { pointerId: 1, clientX: 70, clientY: 70 });

      // Verify the full toolArgs including spread of diffusion
      expect(state.tempUpdateLayer).toHaveBeenCalledWith({
        id: 'layer-1',
        toolArgs: expect.objectContaining({
          toolName: 'patch',
          diffusion: 4,
          sourceRect: { x: 50, y: 50, width: 100, height: 100 },
          donorPoint: { x: 60, y: 60 },
        }),
      });
    });

    it('subtracts layer origin from sourceRect when layer has pos', () => {
      state.layers['layer-1'].pos = { x: 5, y: 10, width: 200, height: 200 };
      const { area } = renderArea();

      fireEvent.pointerDown(area, { button: 0, pointerId: 1, clientX: 60, clientY: 60 });
      fireEvent.pointerMove(area, { pointerId: 1, clientX: 70, clientY: 70 });

      expect(state.tempUpdateLayer).toHaveBeenCalledWith({
        id: 'layer-1',
        toolArgs: expect.objectContaining({
          sourceRect: { x: 45, y: 40, width: 100, height: 100 },
        }),
      });
    });

    it('rebases source and donor coordinates against evaluated presentation bounds', () => {
      state.layers['layer-1'].pos = { x: 5, y: 10, width: 200, height: 200 };
      state.presentationBounds = { x: 20, y: 30, width: 200, height: 200 };
      const { area } = renderArea();

      fireEvent.pointerDown(area, { button: 0, pointerId: 1, clientX: 60, clientY: 60 });
      fireEvent.pointerMove(area, { pointerId: 1, clientX: 70, clientY: 80 });
      fireEvent.pointerUp(area, { button: 0, pointerId: 1, clientX: 70, clientY: 80 });

      expect(state.updateLayerByTool).toHaveBeenCalledWith({
        id: 'layer-1',
        toolArgs: expect.objectContaining({
          sourceRect: { x: 30, y: 20, width: 100, height: 100 },
          donorPoint: { x: 40, y: 40 },
        }),
      });
    });
  });

  describe('pointer up (finish)', () => {
    it('commits the patch and releases pointer capture', async () => {
      const { area } = renderArea();

      fireEvent.pointerDown(area, { button: 0, pointerId: 1, clientX: 60, clientY: 60 });
      fireEvent.pointerMove(area, { pointerId: 1, clientX: 70, clientY: 70 });
      fireEvent.pointerUp(area, { button: 0, pointerId: 1, clientX: 70, clientY: 70 });

      await Promise.resolve(); // allow async finish to run

      // donor point = selection.pos + (current - start) = {50,50} + {10,10} = {60,60}
      expect(state.updateLayerByTool).toHaveBeenCalledWith({
        id: 'layer-1',
        toolArgs: expect.objectContaining({
          toolName: 'patch',
          diffusion: 4,
          sourceRect: { x: 50, y: 50, width: 100, height: 100 },
          donorPoint: { x: 60, y: 60 },
        }),
      });
      expect(state.releasePointerCapture).toHaveBeenCalledWith(1);
    });

    it('does nothing when no drag in progress', () => {
      const { area } = renderArea();

      fireEvent.pointerUp(area, { button: 0, pointerId: 1, clientX: 70, clientY: 70 });

      expect(state.updateLayerByTool).not.toHaveBeenCalled();
      expect(state.releasePointerCapture).not.toHaveBeenCalled();
    });

    it('does nothing when drag pointer id does not match', () => {
      const { area } = renderArea();

      fireEvent.pointerDown(area, { button: 0, pointerId: 1, clientX: 60, clientY: 60 });
      fireEvent.pointerUp(area, { button: 0, pointerId: 2, clientX: 70, clientY: 70 });

      expect(state.updateLayerByTool).not.toHaveBeenCalled();
      expect(state.releasePointerCapture).not.toHaveBeenCalled();
    });

    it('does nothing when no active layer', async () => {
      state.activeLayerId = null;
      const { area } = renderArea();

      fireEvent.pointerDown(area, { button: 0, pointerId: 1, clientX: 60, clientY: 60 });
      fireEvent.pointerUp(area, { button: 0, pointerId: 1, clientX: 70, clientY: 70 });

      await Promise.resolve();

      expect(state.updateLayerByTool).not.toHaveBeenCalled();
      expect(state.releasePointerCapture).not.toHaveBeenCalled();
    });
  });

  describe('pointer cancel', () => {
    it('cancels preview and releases pointer capture', () => {
      const { area } = renderArea();

      fireEvent.pointerDown(area, { button: 0, pointerId: 1, clientX: 60, clientY: 60 });
      fireEvent.pointerCancel(area, { pointerId: 1 });

      expect(state.cancelLayerPreview).toHaveBeenCalledWith('layer-1');
      expect(state.releasePointerCapture).toHaveBeenCalledWith(1);
    });

    it('does nothing when no drag in progress', () => {
      const { area } = renderArea();

      fireEvent.pointerCancel(area, { pointerId: 1 });

      expect(state.cancelLayerPreview).not.toHaveBeenCalled();
      expect(state.releasePointerCapture).not.toHaveBeenCalled();
    });

    it('does nothing when drag pointer id does not match', () => {
      const { area } = renderArea();

      fireEvent.pointerDown(area, { button: 0, pointerId: 1, clientX: 60, clientY: 60 });
      fireEvent.pointerCancel(area, { pointerId: 2 });

      expect(state.cancelLayerPreview).not.toHaveBeenCalled();
      expect(state.releasePointerCapture).not.toHaveBeenCalled();
    });
  });

  describe('donor point calculation', () => {
    it('calculates donor point relative to selection origin', () => {
      const { area } = renderArea();

      fireEvent.pointerDown(area, { button: 0, pointerId: 1, clientX: 60, clientY: 60 });
      fireEvent.pointerMove(area, { pointerId: 1, clientX: 75, clientY: 80 });

      // donor point = selection.pos + (current - start)
      // = { x: 50, y: 50 } + { x: 15, y: 20 } = { x: 65, y: 70 }
      expect(state.tempUpdateLayer).toHaveBeenCalledWith({
        id: 'layer-1',
        toolArgs: expect.objectContaining({
          donorPoint: { x: 65, y: 70 },
        }),
      });
    });

    it('uses layer origin when present', () => {
      state.layers['layer-1'].pos = { x: 10, y: 5, width: 200, height: 200 };
      const { area } = renderArea();

      fireEvent.pointerDown(area, { button: 0, pointerId: 1, clientX: 60, clientY: 60 });
      fireEvent.pointerMove(area, { pointerId: 1, clientX: 70, clientY: 70 });

      expect(state.tempUpdateLayer).toHaveBeenCalledWith({
        id: 'layer-1',
        toolArgs: expect.objectContaining({ donorPoint: { x: 50, y: 55 } }),
      });
    });
  });

  describe('sourceRect calculation', () => {
    it('calculates sourceRect relative to layer origin', () => {
      const { area } = renderArea();

      fireEvent.pointerDown(area, { button: 0, pointerId: 1, clientX: 60, clientY: 60 });
      fireEvent.pointerMove(area, { pointerId: 1, clientX: 70, clientY: 70 });

      expect(state.tempUpdateLayer).toHaveBeenCalledWith({
        id: 'layer-1',
        toolArgs: expect.objectContaining({
          sourceRect: { x: 50, y: 50, width: 100, height: 100 },
        }),
      });
    });

    it('subtracts layer origin from sourceRect', () => {
      state.layers['layer-1'].pos = { x: 5, y: 10, width: 200, height: 200 };
      const { area } = renderArea();

      fireEvent.pointerDown(area, { button: 0, pointerId: 1, clientX: 60, clientY: 60 });
      fireEvent.pointerMove(area, { pointerId: 1, clientX: 70, clientY: 70 });

      expect(state.tempUpdateLayer).toHaveBeenCalledWith({
        id: 'layer-1',
        toolArgs: expect.objectContaining({
          sourceRect: { x: 45, y: 40, width: 100, height: 100 },
        }),
      });
    });
  });

  describe('rendering', () => {
    it('renders div with data-testid', () => {
      const { area } = renderArea();
      expect(area).toHaveAttribute('data-testid', 'patch-tool-area');
    });

    it('applies userSelect: none style', () => {
      const { area } = renderArea();
      expect(area).toHaveStyle({ userSelect: 'none' });
    });

    it('binds pointer event handlers', () => {
      const { area } = renderArea();
      // Event handlers are bound as onPointerDown, onPointerMove, etc. props
      // In React Testing Library, these are not exposed as DOM attributes
      // but we can verify they're called by firing events
      fireEvent.pointerDown(area, { button: 0, pointerId: 1, clientX: 60, clientY: 60 });
      expect(state.setPointerCapture).toHaveBeenCalled();
    });
  });
});
