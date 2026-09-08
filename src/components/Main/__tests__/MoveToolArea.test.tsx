import { act, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MoveToolArea } from '../MoveToolArea.tsx';

const tempUpdateLayer = vi.fn();
const updateLayerByTool = vi.fn();
const setActiveLayer = vi.fn();

const container = document.createElement('div');
const toolOverlay = document.createElement('canvas');
const rectOverlay = document.createElement('canvas');

const layers = {
  'layer-1': {
    id: 'layer-1',
    isBedrock: false,
    pos: { x: 10, y: 20, width: 30, height: 40 },
  },
  'layer-2': {
    id: 'layer-2',
    isBedrock: false,
    pos: { x: 100, y: 120, width: 50, height: 60 },
  },
};

const storeState = {
  containerRef: { current: container },
  toolOverlayRef: { current: toolOverlay },
  rectOverlayRef: { current: rectOverlay },
  activeLayerId: 'layer-1',
  layers,
  totalSize: { width: 800, height: 600 },
};

let latestUseRectProps: any = null;

vi.mock('../../../contexts/StoreContext.tsx', () => ({
  useStore: () => [storeState, vi.fn()],
}));

vi.mock('../../../contexts/useLayer.ts', () => ({
  useLayers: () => ({
    tempUpdateLayer,
    updateLayerByTool,
    setActiveLayer,
  }),
}));

vi.mock('../../../hooks/useAnts.ts', () => ({
  useMarchingAnts: () => ({
    draw: vi.fn(),
    clear: vi.fn(),
  }),
}));

vi.mock('../../../contexts/layer-utils.ts', () => ({
  getLayerIdByPoint: vi.fn(() => null),
}));

vi.mock('../../../hooks/useRect.ts', () => ({
  useRect: (props: any) => {
    latestUseRectProps = props;
    props.onRepaint?.(props.initialRect);

    return {
      getLocalCoords: vi.fn(() => ({ x: 0, y: 0 })),
      isMouseDown: { current: false },
      pointerIdRef: { current: null },
      onPointerDown: vi.fn(() => false),
      onPointerMove: vi.fn(() => false),
      onPointerUp: vi.fn(),
      clearSelection: vi.fn(),
    };
  },
}));

describe('MoveToolArea', () => {
  beforeEach(() => {
    tempUpdateLayer.mockReset();
    updateLayerByTool.mockReset();
    setActiveLayer.mockReset();
    latestUseRectProps = null;
    storeState.activeLayerId = 'layer-1';
  });

  it('does not apply repaint updates while only switching active layer', () => {
    const { rerender } = render(<MoveToolArea className="test" canvasCtxRef={{ current: null }} />);

    tempUpdateLayer.mockClear();

    storeState.activeLayerId = 'layer-2';
    rerender(<MoveToolArea className="test" canvasCtxRef={{ current: null }} />);

    expect(tempUpdateLayer).not.toHaveBeenCalled();
  });

  it('does not commit update when pointer up keeps the same rectangle', () => {
    render(<MoveToolArea className="test" canvasCtxRef={{ current: null }} />);

    act(() => {
      latestUseRectProps.onChangeEnd({ x1: 10, y1: 20, x2: 40, y2: 60 });
    });

    expect(updateLayerByTool).not.toHaveBeenCalled();
  });
});
