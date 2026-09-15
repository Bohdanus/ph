import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import type { Selection } from '../../../contexts/general-types.ts';
import { MagicWandToolArea } from '../MagicWandToolArea.tsx';

const dispatchMock = vi.hoisted(() => vi.fn());
const sourceCanvas = vi.hoisted(() => document.createElement('canvas'));
const storeState = vi.hoisted((): { selections: Selection[] } => ({ selections: [] }));

vi.mock('../../../hooks/usePointerPosition.ts', () => ({
  usePointerPosition: () => ({
    getLocalCoords: (event: any) => ({ x: event.clientX, y: event.clientY }),
  }),
}));

vi.mock('../../../contexts/StoreContext.tsx', () => ({
  useStore: () => [
    {
      canvasRef: { current: sourceCanvas },
      containerRef: { current: document.createElement('div') },
      selections: storeState.selections,
      totalSize: { width: 6, height: 6 },
    },
    dispatchMock,
  ],
}));

vi.mock('../../../contexts/useCurrentTool.tsx', () => ({
  useCurrentTool: () => ({
    toolArgs: {
      smoothing: 1,
      tolerance: 0,
      toolName: 'magic-wand',
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
});
