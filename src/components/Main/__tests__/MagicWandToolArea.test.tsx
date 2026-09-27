import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import type { Selection } from '../../../contexts/general-types.ts';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { MagicWandToolArea } from '../MagicWandToolArea.tsx';

const dispatchMock = vi.hoisted(() => vi.fn());
const sourceCanvas = vi.hoisted(() => document.createElement('canvas'));
const storeState = vi.hoisted(
  (): {
    selections: Selection[];
    documentFrame: { x: number; y: number; width: number; height: number } | null;
  } => ({ selections: [], documentFrame: null })
);
const toolState = vi.hoisted((): { toolArgs: { smoothing: number; tolerance: number; toolName: string } } => ({
  toolArgs: { smoothing: 1, tolerance: 0, toolName: 'magic-wand' },
}));

vi.mock('../../../hooks/usePointerPosition.ts', () => ({
  usePointerPosition: () => ({
    getLocalCoords: (event: ReactPointerEvent<HTMLElement>) => ({ x: event.clientX, y: event.clientY }),
  }),
}));

vi.mock('../../../contexts/StoreContext.tsx', () => ({
  useStore: () => [
    {
      canvasRef: { current: sourceCanvas },
      containerRef: { current: document.createElement('div') },
      selections: storeState.selections,
      totalSize: { width: 6, height: 6 },
      documentFrame: storeState.documentFrame,
    },
    dispatchMock,
  ],
}));

vi.mock('../../../contexts/useCurrentTool.tsx', () => ({
  useCurrentTool: () => ({
    get toolArgs() {
      return toolState.toolArgs;
    },
  }),
}));

function createImageData(width: number, height: number): ImageData {
  const imageData = {
    colorSpace: 'srgb',
    data: new Uint8ClampedArray(width * height * 4),
    height,
    width,
  } as ImageData;

  for (let i = 0; i < width * height; i++) {
    imageData.data[i * 4] = 0;
    imageData.data[i * 4 + 1] = 0;
    imageData.data[i * 4 + 2] = 255;
    imageData.data[i * 4 + 3] = 255;
  }

  for (const [x, y] of [
    [2, 2],
    [3, 2],
    [2, 3],
    [3, 3],
  ]) {
    const index = (y * width + x) * 4;
    imageData.data[index] = 255;
    imageData.data[index + 1] = 0;
    imageData.data[index + 2] = 0;
    imageData.data[index + 3] = 255;
  }

  return imageData;
}

function createMockContext() {
  return {
    canvas: { width: 6, height: 6 },
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    arc: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    setLineDash: vi.fn(),
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 1,
  } as unknown as CanvasRenderingContext2D;
}

describe('MagicWandToolArea', () => {
  let getContextSpy: ReturnType<typeof vi.spyOn> | null = null;

  beforeEach(() => {
    dispatchMock.mockClear();
    storeState.selections = [];
    storeState.documentFrame = null;
    toolState.toolArgs = { smoothing: 1, tolerance: 0, toolName: 'magic-wand' };
    sourceCanvas.width = 6;
    sourceCanvas.height = 6;
    getContextSpy = vi.spyOn(sourceCanvas, 'getContext').mockReturnValue({
      getImageData: vi.fn(() => createImageData(6, 6)),
    } as unknown as CanvasRenderingContext2D);
  });

  afterEach(() => {
    getContextSpy?.mockRestore();
    getContextSpy = null;
  });

  it('commits a magic wand polygon selection with metadata on click', () => {
    const mockCtx = createMockContext();
    const { container } = render(
      <MagicWandToolArea overlayCtxRef={{ current: mockCtx }} className="test-magic-wand-area" />
    );
    const toolArea = container.firstElementChild as HTMLDivElement;

    fireEvent.pointerDown(toolArea, { button: 0, clientX: 2, clientY: 2 });

    expect(dispatchMock).toHaveBeenNthCalledWith(1, {
      type: 'START_SELECTION_DRAFT',
      payload: { sourceTool: 'magic-wand' },
    });
    expect(dispatchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'COMMIT_SELECTION',
        payload: expect.objectContaining({
          geometry: 'polygon',
          lifecycle: 'committed',
          metadata: expect.objectContaining({
            magicWand: expect.objectContaining({
              boundaryPointCount: 4,
              selectedPixelCount: 4,
              tolerance: 0,
            }),
          }),
          sourceTool: 'magic-wand',
        }),
      })
    );
    expect(mockCtx.closePath).toHaveBeenCalled();
  });

  it('ignores clicks outside image bounds', () => {
    const mockCtx = createMockContext();
    const { container } = render(
      <MagicWandToolArea overlayCtxRef={{ current: mockCtx }} className="test-magic-wand-area" />
    );
    const toolArea = container.firstElementChild as HTMLDivElement;

    fireEvent.pointerDown(toolArea, { button: 0, clientX: -1, clientY: 2 });

    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it('ignores non-primary mouse buttons', () => {
    const mockCtx = createMockContext();
    const { container } = render(
      <MagicWandToolArea overlayCtxRef={{ current: mockCtx }} className="test-magic-wand-area" />
    );
    const toolArea = container.firstElementChild as HTMLDivElement;

    fireEvent.pointerDown(toolArea, { button: 2, clientX: 2, clientY: 2 });

    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it('ignores clicks when the current tool is not the magic wand', () => {
    toolState.toolArgs = { smoothing: 1, tolerance: 0, toolName: 'rectangular-selection' };
    const mockCtx = createMockContext();
    const { container } = render(
      <MagicWandToolArea overlayCtxRef={{ current: mockCtx }} className="test-magic-wand-area" />
    );
    const toolArea = container.firstElementChild as HTMLDivElement;

    fireEvent.pointerDown(toolArea, { button: 0, clientX: 2, clientY: 2 });

    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it('cancels the draft when no closed boundary can be traced', () => {
    // A zero-sized source canvas short-circuits to a null wand result.
    sourceCanvas.width = 0;
    sourceCanvas.height = 0;
    const mockCtx = createMockContext();
    const { container } = render(
      <MagicWandToolArea overlayCtxRef={{ current: mockCtx }} className="test-magic-wand-area" />
    );
    const toolArea = container.firstElementChild as HTMLDivElement;

    fireEvent.pointerDown(toolArea, { button: 0, clientX: 2, clientY: 2 });

    expect(dispatchMock).toHaveBeenNthCalledWith(1, {
      type: 'START_SELECTION_DRAFT',
      payload: { sourceTool: 'magic-wand' },
    });
    expect(dispatchMock).toHaveBeenNthCalledWith(2, { type: 'CANCEL_SELECTION_DRAFT' });
    expect(dispatchMock).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'COMMIT_SELECTION' }));
  });

  it('records the seed in document space', () => {
    storeState.documentFrame = { x: 3, y: 4, width: 6, height: 6 };
    const mockCtx = createMockContext();
    const { container } = render(
      <MagicWandToolArea overlayCtxRef={{ current: mockCtx }} className="test-magic-wand-area" />
    );
    const toolArea = container.firstElementChild as HTMLDivElement;

    fireEvent.pointerDown(toolArea, { button: 0, clientX: 2, clientY: 2 });

    expect(dispatchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'COMMIT_SELECTION',
        payload: expect.objectContaining({
          metadata: expect.objectContaining({ magicWand: expect.objectContaining({ seed: { x: 5, y: 6 } }) }),
        }),
      })
    );
  });

  it('repaints committed selections from the store on mount', () => {
    storeState.selections = [
      {
        id: 'selection-1',
        isActive: true,
        geometry: 'polygon',
        sourceTool: 'freehand-lasso',
        lifecycle: 'committed',
        pos: { x: 0, y: 0, width: 4, height: 4 },
        points: [
          { x: 0, y: 0 },
          { x: 4, y: 0 },
          { x: 4, y: 4 },
        ],
      },
    ];
    const mockCtx = createMockContext();

    render(<MagicWandToolArea overlayCtxRef={{ current: mockCtx }} className="test-magic-wand-area" />);

    expect(mockCtx.moveTo).toHaveBeenCalledWith(0, 0);
    expect(mockCtx.lineTo).toHaveBeenCalledWith(4, 0);
    expect(mockCtx.closePath).toHaveBeenCalled();
  });

  it('clears the overlay on unmount', () => {
    const mockCtx = createMockContext();
    const { container, unmount } = render(
      <MagicWandToolArea overlayCtxRef={{ current: mockCtx }} className="test-magic-wand-area" />
    );
    expect(container.firstElementChild).toBeInTheDocument();

    vi.mocked(mockCtx.clearRect).mockClear();
    unmount();

    expect(mockCtx.clearRect).toHaveBeenCalledWith(0, 0, 6, 6);
  });
});
