import { fireEvent, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DrawToolArea } from '../DrawToolArea.tsx';
import { drawLine } from '../../../util/draw.ts';

const createLayerFromToolMock = vi.hoisted(() => vi.fn());
const pointerState = vi.hoisted(() => ({ isMouseDown: { current: false } }));

vi.mock('../../../contexts/StoreContext.tsx', () => ({
  useStore: () => [
    {
      containerRef: { current: document.createElement('div') },
      totalSize: { width: 300, height: 200 },
    },
    vi.fn(),
  ],
}));

vi.mock('../../../contexts/useLayer.ts', () => ({
  useLayers: () => ({
    createLayerFromTool: createLayerFromToolMock,
  }),
}));

vi.mock('../../../contexts/useCurrentTool.tsx', () => ({
  useCurrentTool: () => ({
    toolArgs: {
      toolName: 'draw',
      alpha: 1,
      color: '#000000',
      penType: 'pen',
      lineWidth: 10,
      points: [],
    },
  }),
}));

vi.mock('../../../hooks/usePointerPosition.ts', () => ({
  usePointerPosition: () => ({
    isPointerDownValid: vi.fn((event: PointerEvent) => {
      if (event.button !== 0) return false;
      pointerState.isMouseDown.current = true;
      return true;
    }),
    isPointerMoveValid: vi.fn(() => pointerState.isMouseDown.current),
    isPointerUpValid: vi.fn((event: PointerEvent) => {
      if (event.button !== 0) return false;
      pointerState.isMouseDown.current = false;
      return true;
    }),
    getLocalCoords: (event: PointerEvent) => ({ x: event.clientX, y: event.clientY }),
    isMouseDown: pointerState.isMouseDown,
  }),
}));

vi.mock('../../../util/draw.ts', async () => {
  const actual = await vi.importActual<typeof import('../../../util/draw.ts')>('../../../util/draw.ts');
  return {
    ...actual,
    drawLine: vi.fn(),
  };
});

const makeMockContext = () => ({
  clearRect: vi.fn(),
  beginPath: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  bezierCurveTo: vi.fn(),
  quadraticCurveTo: vi.fn(),
  stroke: vi.fn(),
  arc: vi.fn(),
  fill: vi.fn(),
  createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
  setLineDash: vi.fn(),
  fillRect: vi.fn(),
  strokeRect: vi.fn(),
  ellipse: vi.fn(),
  save: vi.fn(),
  restore: vi.fn(),
  closePath: vi.fn(),
  clip: vi.fn(),
  drawImage: vi.fn(),
  setTransform: vi.fn(),
  resetTransform: vi.fn(),
  canvas: document.createElement('canvas'),
  strokeStyle: '#000000',
  fillStyle: '#000000',
  lineWidth: 1,
  lineCap: 'round',
  lineJoin: 'round',
  globalAlpha: 1,
  imageSmoothingEnabled: true,
  imageSmoothingQuality: 'low',
});

describe('DrawToolArea', () => {
  beforeEach(() => {
    createLayerFromToolMock.mockClear();
    vi.mocked(drawLine).mockClear();
    pointerState.isMouseDown.current = false;
  });

  it('normalizes a finished stroke to its bounding box instead of snapping it to the origin', () => {
    const overlayCtx = makeMockContext() as unknown as CanvasRenderingContext2D;
    const { container } = render(<DrawToolArea className="test-draw-area" overlayCtxRef={{ current: overlayCtx }} />);
    const toolArea = container.firstElementChild as HTMLDivElement;

    fireEvent.pointerDown(toolArea, { button: 0, clientX: 40, clientY: 50 });
    fireEvent.pointerMove(toolArea, { button: 0, clientX: 120, clientY: 80 });
    fireEvent.pointerMove(toolArea, { button: 0, clientX: 200, clientY: 110 });
    fireEvent.pointerUp(toolArea, { button: 0, clientX: 200, clientY: 110 });

    expect(createLayerFromToolMock).toHaveBeenCalledTimes(1);
    expect(createLayerFromToolMock).toHaveBeenCalledWith(
      expect.objectContaining({
        pos: { x: 30, y: 40, width: 180, height: 80 },
        args: expect.objectContaining({
          points: [
            { x: 10, y: 10 },
            { x: 90, y: 40 },
            { x: 170, y: 70 },
          ],
        }),
      })
    );
  });

  it('draws the preview while the pointer is dragging', () => {
    const overlayCtx = makeMockContext() as unknown as CanvasRenderingContext2D;
    const { container } = render(<DrawToolArea className="test-draw-area" overlayCtxRef={{ current: overlayCtx }} />);
    const toolArea = container.firstElementChild as HTMLDivElement;

    fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 20 });
    fireEvent.pointerMove(toolArea, { button: 0, clientX: 30, clientY: 50 });

    expect(drawLine).toHaveBeenCalled();
  });
});
