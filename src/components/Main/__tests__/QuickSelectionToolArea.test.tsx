import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import type { Selection } from '../../../contexts/general-types.ts';
import { QuickSelectionToolArea } from '../QuickSelectionToolArea.tsx';
import { rasterizeSelectionMask } from '../../../tools/quickSelection.ts';

/**
 * The base mask and stroke seeds use frame-local coordinates, so each document-space contour from
 * `getActiveSelection` + `getSelectionAbsoluteContours` MUST be mapped through
 * `documentToCanvasPoint` before `rasterizeSelectionMask` sees them. With a nonzero
 * frame origin the two spaces diverge, and without that single conversion the base
 * mask lands on the wrong pixels (an empty base for `add`, a no-op for `subtract`).
 *
 * The rasterizer is spied, so no real pixel buffer is required — the contract under
 * test is the argument list, not the filled mask. A closed four-vertex rectangle is
 * used deliberately: it is one point short of the five-vertex closed form
 * `normalizeSelectionPoints` would reject and exactly the path Photoshop hands a
 * traced selection, so the conversion is pinned at every corner of the frame shift.
 */
const IMAGE_SIZE = { width: 50, height: 50 };

const dispatchMock = vi.hoisted(() => vi.fn());
const sourceCanvas = vi.hoisted(() => document.createElement('canvas'));
const storeState = vi.hoisted(
  (): {
    selections: Selection[];
    activeSelectionId: string | null;
    documentFrame: { x: number; y: number; width: number; height: number } | null;
  } => ({
    selections: [],
    activeSelectionId: null,
    documentFrame: null,
  })
);
const toolState = vi.hoisted(
  (): {
    toolArgs: {
      size: number;
      tolerance: number;
      mode: 'add' | 'subtract';
      alpha: number;
      toolName: 'quick-selection';
    } | null;
  } => ({
    toolArgs: null,
  })
);

// Only the rasterizer is replaced: every helper it feeds (createQuickSelectionAccumulator,
// growAlongStroke, createQuickSelectionPolygon, sampleStrokeSeeds) and the
// QUICK_SELECTION_SOURCE_TOOL constant stay real, so a pointer-down still runs the full
// grow/preview path and the spy is exercised in context rather than isolation.
vi.mock('../../../tools/quickSelection.ts', async () => {
  const actual = await vi.importActual<typeof import('../../../tools/quickSelection.ts')>(
    '../../../tools/quickSelection.ts'
  );
  return {
    ...actual,
    rasterizeSelectionMask: vi.fn(),
  };
});

vi.mock('../../../contexts/StoreContext.tsx', () => ({
  useStore: () => [
    {
      canvasRef: { current: sourceCanvas },
      containerRef: { current: document.createElement('div') },
      selections: storeState.selections,
      activeSelectionId: storeState.activeSelectionId,
      selectionCleared: null,
      totalSize: IMAGE_SIZE,
      documentFrame: storeState.documentFrame,
      history: [],
      historyIndex: 0,
      branchRevision: 0,
    },
    dispatchMock,
  ],
}));

vi.mock('../../../contexts/useCurrentTool.tsx', () => ({
  useCurrentTool: () => ({
    getToolArgs: (toolName: string) => (toolName === 'quick-selection' ? toolState.toolArgs : null),
  }),
}));

vi.mock('../../../hooks/usePointerPosition.ts', () => ({
  usePointerPosition: () => ({
    isPointerDownValid: vi.fn((event: PointerEvent) => event.button === 0),
    isPointerMoveValid: vi.fn(() => true),
    isPointerUpValid: vi.fn(() => true),
    getLocalCoords: (event: PointerEvent) => ({ x: event.clientX, y: event.clientY }),
    isMouseDown: { current: false },
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

  return imageData;
}

function createOverlayContext(): CanvasRenderingContext2D {
  return {
    canvas: { width: IMAGE_SIZE.width, height: IMAGE_SIZE.height },
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
    getLineDash: vi.fn(() => []),
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 1,
    globalAlpha: 1,
  } as unknown as CanvasRenderingContext2D;
}

function renderQuickSelectionArea(): HTMLDivElement {
  const { container } = render(
    <QuickSelectionToolArea overlayCtxRef={{ current: createOverlayContext() }} className="test-quick-selection-area" />
  );
  return container.firstElementChild as HTMLDivElement;
}

describe('QuickSelectionToolArea', () => {
  let getContextSpy: Mock | null = null;

  beforeEach(() => {
    dispatchMock.mockClear();
    vi.mocked(rasterizeSelectionMask).mockClear();
    storeState.selections = [];
    storeState.activeSelectionId = null;
    storeState.documentFrame = null;
    toolState.toolArgs = { size: 16, tolerance: 0, mode: 'add', alpha: 1, toolName: 'quick-selection' };
    sourceCanvas.width = IMAGE_SIZE.width;
    sourceCanvas.height = IMAGE_SIZE.height;
    getContextSpy = vi.spyOn(sourceCanvas, 'getContext').mockReturnValue({
      getImageData: vi.fn(() => createImageData(IMAGE_SIZE.width, IMAGE_SIZE.height)),
    } as unknown as CanvasRenderingContext2D);
  });

  afterEach(() => {
    getContextSpy?.mockRestore();
    getContextSpy = null;
  });

  // Frame origin (100, 40); a closed four-vertex selection whose document-space absolute
  // corners are (120,60)..(140,80). `getSelectionAbsolutePoints` offsets each relative
  // vertex by `pos`, and `documentToCanvasPoint` subtracts the frame origin, so every
  // corner lands frame-local exactly once: (120,60)->(20,20), (140,60)->(40,20),
  // (140,80)->(40,40), (120,80)->(20,40).
  const FRAME_WITH_ORIGIN = { x: 100, y: 40, width: IMAGE_SIZE.width, height: IMAGE_SIZE.height };
  const activeSelectionInFrame: Selection = {
    id: 'active-selection',
    isActive: true,
    geometry: 'polygon',
    sourceTool: 'magic-wand',
    lifecycle: 'committed',
    pos: { x: 120, y: 60, width: 20, height: 20 },
    points: [
      [
        { x: 0, y: 0 },
        { x: 20, y: 0 },
        { x: 20, y: 20 },
        { x: 0, y: 20 },
      ],
    ],
  };

  it('translates a nonzero-frame active selection from document-space vertices to frame-local canvas vertices before rasterizing the base mask', () => {
    storeState.documentFrame = FRAME_WITH_ORIGIN;
    storeState.activeSelectionId = 'active-selection';
    storeState.selections = [activeSelectionInFrame];

    const toolArea = renderQuickSelectionArea();
    fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, clientX: 5, clientY: 5 });

    // The base mask is rasterized exactly once, and it carries one contour with the frame-subtracted
    // vertices rather than the raw document points. The "exactly once" pin is
    // mutation-sensitive on two axes: a missing map leaves the origin un-stripped
    // (120/140 survive), and a doubled map pushes every coordinate negative
    // (120-100-100 = -80), so neither the zero-mapping nor the double-mapping
    // mutation can pass.
    expect(rasterizeSelectionMask).toHaveBeenCalledTimes(1);
    expect(rasterizeSelectionMask).toHaveBeenCalledWith(
      [
        [
          { x: 20, y: 20 },
          { x: 40, y: 20 },
          { x: 40, y: 40 },
          { x: 20, y: 40 },
        ],
      ],
      { width: IMAGE_SIZE.width, height: IMAGE_SIZE.height }
    );
  });

  it('skips rasterizing the base mask when no selection is active', () => {
    const toolArea = renderQuickSelectionArea();
    fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, clientX: 5, clientY: 5 });

    // `getActiveSelection` returns null, so `baseContours` is `[]` and the
    // `>= 3` guard short-circuits before the rasterizer is ever reached.
    expect(rasterizeSelectionMask).not.toHaveBeenCalled();
  });
});
