import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import type { Selection } from '../../../contexts/general-types.ts';
import { QuickSelectionToolArea } from '../QuickSelectionToolArea.tsx';
import { rasterizeSelectionState } from '../../../tools/quickSelection.ts';

/**
 * The base mask and stroke seeds use frame-local coordinates, so the active selection must
 * be rasterized against the frame origin. With a nonzero frame origin the two spaces diverge,
 * and without that conversion the base mask lands on the wrong pixels (an empty base for `add`,
 * a no-op for `subtract`).
 *
 * The selection-state rasterizer is spied, so no real pixel buffer is required — the
 * component contract is that it passes the active document-space selection and frame
 * origin to the shared mask conversion. Exact pixel coverage is tested in
 * `quick-selection.test.ts`.
 */
const IMAGE_SIZE = { width: 50, height: 50 };

const dispatchMock = vi.hoisted(() => vi.fn());
const sourceCanvas = vi.hoisted(() => document.createElement('canvas'));
const pointerState = vi.hoisted(() => ({ activePointerId: null as number | null, releaseCalls: 0 }));
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

// Only the active-selection rasterizer is replaced: every helper it feeds (createQuickSelectionAccumulator,
// growAlongStroke, createQuickSelectionPolygon, sampleStrokeSeeds) and the
// QUICK_SELECTION_SOURCE_TOOL constant stay real, so a pointer-down still runs the full
// grow/preview path and the spy is exercised in context rather than isolation.
vi.mock('../../../tools/quickSelection.ts', async () => {
  const actual = await vi.importActual<typeof import('../../../tools/quickSelection.ts')>(
    '../../../tools/quickSelection.ts'
  );
  return {
    ...actual,
    rasterizeSelectionState: vi.fn(),
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
    isPointerDownValid: vi.fn((event: PointerEvent) => {
      if (event.button !== 0 || pointerState.activePointerId !== null) return false;
      pointerState.activePointerId = event.pointerId;
      return true;
    }),
    isPointerMoveValid: vi.fn(() => true),
    isPointerUpValid: vi.fn((event: PointerEvent) => {
      if (event.button !== 0 || pointerState.activePointerId !== event.pointerId) return false;
      pointerState.activePointerId = null;
      return true;
    }),
    releasePointer: vi.fn(() => {
      pointerState.releaseCalls += 1;
      pointerState.activePointerId = null;
    }),
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
    pointerState.activePointerId = null;
    pointerState.releaseCalls = 0;
    vi.mocked(rasterizeSelectionState).mockReset();
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
    sourceTool: 'quick-selection',
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

  it('passes a nonzero-frame active selection and its document origin to the shared rasterizer', () => {
    storeState.documentFrame = FRAME_WITH_ORIGIN;
    storeState.activeSelectionId = 'active-selection';
    storeState.selections = [activeSelectionInFrame];

    const toolArea = renderQuickSelectionArea();
    fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, clientX: 5, clientY: 5 });

    expect(rasterizeSelectionState).toHaveBeenCalledTimes(1);
    expect(rasterizeSelectionState).toHaveBeenCalledWith(activeSelectionInFrame, IMAGE_SIZE, { x: 100, y: 40 });
  });

  it('skips rasterizing the base mask when no selection is active', () => {
    const toolArea = renderQuickSelectionArea();
    fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, clientX: 5, clientY: 5 });

    // `getActiveSelection` returns null, so there is no stored mask to rasterize.
    expect(rasterizeSelectionState).not.toHaveBeenCalled();
  });

  it('releases a captured pointer when readback fails so a later Quick Selection stroke can start', () => {
    getContextSpy!.mockReturnValueOnce(null as unknown as CanvasRenderingContext2D);
    const toolArea = renderQuickSelectionArea();

    fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, clientX: 5, clientY: 5 });
    fireEvent.pointerUp(toolArea, { button: 0, pointerId: 1, clientX: 5, clientY: 5 });

    expect(pointerState.releaseCalls).toBe(1);
    expect(pointerState.activePointerId).toBeNull();

    fireEvent.pointerDown(toolArea, { button: 0, pointerId: 2, clientX: 8, clientY: 8 });

    expect(
      dispatchMock.mock.calls.some(([action]) => (action as { type: string }).type === 'START_SELECTION_DRAFT')
    ).toBe(true);
  });

  it('releases a captured pointer when preparing the base mask throws', () => {
    storeState.selections = [activeSelectionInFrame];
    storeState.activeSelectionId = activeSelectionInFrame.id;
    vi.mocked(rasterizeSelectionState).mockImplementationOnce(() => {
      throw new RangeError('simulated base-mask allocation failure');
    });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const toolArea = renderQuickSelectionArea();

      fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, clientX: 5, clientY: 5 });
      fireEvent.pointerUp(toolArea, { button: 0, pointerId: 1, clientX: 5, clientY: 5 });

      expect(pointerState.releaseCalls).toBe(1);
      expect(pointerState.activePointerId).toBeNull();

      fireEvent.pointerDown(toolArea, { button: 0, pointerId: 2, clientX: 8, clientY: 8 });

      expect(
        dispatchMock.mock.calls.some(([action]) => (action as { type: string }).type === 'START_SELECTION_DRAFT')
      ).toBe(true);
    } finally {
      consoleError.mockRestore();
    }
  });

  it('stores Quick Selection provenance on the committed selection', () => {
    const toolArea = renderQuickSelectionArea();
    fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, clientX: 5, clientY: 5 });
    fireEvent.pointerUp(toolArea, { button: 0, pointerId: 1, clientX: 5, clientY: 5 });

    const actions = dispatchMock.mock.calls.map(
      ([action]) =>
        action as {
          type: string;
          payload?: { sourceTool?: string; updates?: { selections?: Selection[] } };
        }
    );
    expect(actions.find((action) => action.type === 'START_SELECTION_DRAFT')?.payload).toEqual({
      sourceTool: 'quick-selection',
    });
    expect(
      actions.find((action) => action.type === 'COMMIT_DOCUMENT_EDIT')?.payload?.updates?.selections?.[0]
    ).toMatchObject({ sourceTool: 'quick-selection', lifecycle: 'committed' });
  });

  it('clears the active selection when a subtract stroke removes its last selected pixel', () => {
    storeState.selections = [activeSelectionInFrame];
    storeState.activeSelectionId = activeSelectionInFrame.id;
    toolState.toolArgs = { size: 16, tolerance: 0, mode: 'subtract', alpha: 1, toolName: 'quick-selection' };
    vi.mocked(rasterizeSelectionState).mockReturnValue(new Uint8Array(IMAGE_SIZE.width * IMAGE_SIZE.height).fill(1));

    const toolArea = renderQuickSelectionArea();
    fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, clientX: 5, clientY: 5 });
    fireEvent.pointerUp(toolArea, { button: 0, pointerId: 1, clientX: 5, clientY: 5 });

    const actions = dispatchMock.mock.calls.map(([action]) => action as { type: string; payload?: unknown });
    const clear = actions.find((action) => action.type === 'COMMIT_DOCUMENT_EDIT');
    expect(clear).toBeDefined();
    expect(clear?.payload).toMatchObject({
      updates: { selections: [], activeSelectionId: null, selectionDraft: { status: 'idle' } },
    });
    expect(actions.some((action) => action.type === 'CANCEL_SELECTION_DRAFT')).toBe(false);
  });

  it('does not clear an off-frame selection when a subtract stroke has no selected base pixels', () => {
    storeState.documentFrame = FRAME_WITH_ORIGIN;
    const offFrameSelection = {
      ...activeSelectionInFrame,
      pos: { x: 20, y: 20, width: 20, height: 20 },
    };
    storeState.selections = [offFrameSelection];
    storeState.activeSelectionId = offFrameSelection.id;
    toolState.toolArgs = { size: 16, tolerance: 0, mode: 'subtract', alpha: 1, toolName: 'quick-selection' };
    vi.mocked(rasterizeSelectionState).mockReturnValue(new Uint8Array(IMAGE_SIZE.width * IMAGE_SIZE.height));

    const toolArea = renderQuickSelectionArea();
    fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, clientX: 5, clientY: 5 });
    fireEvent.pointerUp(toolArea, { button: 0, pointerId: 1, clientX: 5, clientY: 5 });

    const actions = dispatchMock.mock.calls.map(([action]) => action as { type: string });
    expect(actions.some((action) => action.type === 'COMMIT_DOCUMENT_EDIT')).toBe(false);
    expect(actions.some((action) => action.type === 'CANCEL_SELECTION_DRAFT')).toBe(true);
  });

  it('does not commit an Add stroke that leaves the active selection unchanged', () => {
    storeState.selections = [activeSelectionInFrame];
    storeState.activeSelectionId = activeSelectionInFrame.id;
    vi.mocked(rasterizeSelectionState).mockReturnValue(new Uint8Array(IMAGE_SIZE.width * IMAGE_SIZE.height).fill(1));

    const toolArea = renderQuickSelectionArea();
    fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, clientX: 5, clientY: 5 });
    fireEvent.pointerUp(toolArea, { button: 0, pointerId: 1, clientX: 5, clientY: 5 });

    const actions = dispatchMock.mock.calls.map(([action]) => action as { type: string });
    expect(actions.some((action) => action.type === 'COMMIT_DOCUMENT_EDIT')).toBe(false);
    expect(actions.some((action) => action.type === 'CANCEL_SELECTION_DRAFT')).toBe(true);
  });
});
