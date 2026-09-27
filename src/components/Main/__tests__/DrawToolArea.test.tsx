import { fireEvent, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DrawToolArea } from '../DrawToolArea.tsx';
import { drawLine } from '../../../util/draw.ts';

const createLayerFromToolMock = vi.hoisted(() => vi.fn());
const pointerState = vi.hoisted(() => ({ isMouseDown: { current: false } }));
const storeState = vi.hoisted(
  (): { documentFrame: { x: number; y: number; width: number; height: number } | null } => ({
    documentFrame: null,
  })
);

vi.mock('../../../contexts/StoreContext.tsx', () => ({
  useStore: () => [
    {
      containerRef: { current: document.createElement('div') },
      totalSize: { width: 300, height: 200 },
      get documentFrame() {
        return storeState.documentFrame;
      },
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
    storeState.documentFrame = null;
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

  it('ignores a stroke that starts with a non-primary mouse button', () => {
    const overlayCtx = makeMockContext() as unknown as CanvasRenderingContext2D;
    const { container } = render(<DrawToolArea className="test-draw-area" overlayCtxRef={{ current: overlayCtx }} />);
    const toolArea = container.firstElementChild as HTMLDivElement;

    fireEvent.pointerDown(toolArea, { button: 2, clientX: 10, clientY: 20 });
    fireEvent.pointerMove(toolArea, { button: 2, clientX: 30, clientY: 50 });

    expect(drawLine).not.toHaveBeenCalled();
  });

  it('ignores pointer movement before the button goes down', () => {
    const overlayCtx = makeMockContext() as unknown as CanvasRenderingContext2D;
    const { container } = render(<DrawToolArea className="test-draw-area" overlayCtxRef={{ current: overlayCtx }} />);
    const toolArea = container.firstElementChild as HTMLDivElement;

    fireEvent.pointerMove(toolArea, { button: 0, clientX: 30, clientY: 50 });

    expect(drawLine).not.toHaveBeenCalled();
  });

  it('shifts the committed bounding box by the document frame origin', () => {
    storeState.documentFrame = { x: 12, y: 8, width: 300, height: 200 };
    const overlayCtx = makeMockContext() as unknown as CanvasRenderingContext2D;
    const { container } = render(<DrawToolArea className="test-draw-area" overlayCtxRef={{ current: overlayCtx }} />);
    const toolArea = container.firstElementChild as HTMLDivElement;

    fireEvent.pointerDown(toolArea, { button: 0, clientX: 40, clientY: 50 });
    fireEvent.pointerMove(toolArea, { button: 0, clientX: 200, clientY: 110 });
    fireEvent.pointerUp(toolArea, { button: 0, clientX: 200, clientY: 110 });

    expect(createLayerFromToolMock).toHaveBeenCalledWith(
      expect.objectContaining({
        pos: { x: 42, y: 48, width: 180, height: 80 },
        args: expect.objectContaining({
          points: [
            { x: 10, y: 10 },
            { x: 170, y: 70 },
          ],
        }),
      })
    );
  });

  it('clears the overlay once the stroke has been committed', () => {
    const overlayCtx = makeMockContext() as unknown as CanvasRenderingContext2D;
    const { container } = render(<DrawToolArea className="test-draw-area" overlayCtxRef={{ current: overlayCtx }} />);
    const toolArea = container.firstElementChild as HTMLDivElement;

    fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 20 });
    fireEvent.pointerMove(toolArea, { button: 0, clientX: 30, clientY: 50 });
    vi.mocked(overlayCtx.clearRect).mockClear();

    fireEvent.pointerUp(toolArea, { button: 0, clientX: 30, clientY: 50 });

    expect(overlayCtx.clearRect).toHaveBeenCalledWith(0, 0, 300, 200);
  });

  it('starts a fresh preview after a stroke was committed', () => {
    const overlayCtx = makeMockContext() as unknown as CanvasRenderingContext2D;
    const { container } = render(<DrawToolArea className="test-draw-area" overlayCtxRef={{ current: overlayCtx }} />);
    const toolArea = container.firstElementChild as HTMLDivElement;

    fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 20 });
    fireEvent.pointerMove(toolArea, { button: 0, clientX: 30, clientY: 50 });
    fireEvent.pointerUp(toolArea, { button: 0, clientX: 30, clientY: 50 });

    vi.mocked(drawLine).mockClear();
    fireEvent.pointerDown(toolArea, { button: 0, clientX: 100, clientY: 100 });

    expect(drawLine).toHaveBeenCalledWith(
      expect.objectContaining({ args: expect.objectContaining({ points: [{ x: 100, y: 100 }] }) })
    );
  });

  it('renders a div carrying the supplied className and the draw cursor', () => {
    const overlayCtx = makeMockContext() as unknown as CanvasRenderingContext2D;
    const { container } = render(<DrawToolArea className="test-draw-area" overlayCtxRef={{ current: overlayCtx }} />);

    expect(container.firstElementChild).toHaveClass('test-draw-area', 'cursor-draw');
  });
});
