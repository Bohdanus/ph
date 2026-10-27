import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import type { Selection } from '../../../contexts/general-types.ts';
import { QuickSelectionToolArea } from '../QuickSelectionToolArea.tsx';
import { rasterizeSelectionState } from '../../../tools/quickSelection.ts';
import * as quickSelectionUtil from '../../../tools/quickSelection.ts';
import { decodeRasterSelectionMask, isRasterSelectionPixelSelected } from '../../../util/selection-mask.ts';

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
const dispatchOverride = vi.hoisted(() => ({ current: null as ((action: unknown) => void) | null }));
const createQuickSelectionPolygonMock = vi.hoisted(() => vi.fn());
const createSelectionRasterOutlineMock = vi.hoisted(() => vi.fn());
const sourceCanvas = vi.hoisted(() => document.createElement('canvas'));
const pointerState = vi.hoisted(() => ({ activePointerId: null as number | null, releaseCalls: 0 }));
const storeState = vi.hoisted(
  (): {
    selections: Selection[];
    activeSelectionId: string | null;
    totalSize: { width: number; height: number };
    documentFrame: { x: number; y: number; width: number; height: number } | null;
    documentId: string;
    documentRevision: number;
    historyIndex: number;
    branchRevision: number;
    renderSelector: { source: 'legacy' | 'pending' | 'durable' };
  } => ({
    selections: [],
    activeSelectionId: null,
    totalSize: { width: 50, height: 50 },
    documentFrame: null,
    documentId: 'quick-selection-document',
    documentRevision: 0,
    historyIndex: 0,
    branchRevision: 0,
    renderSelector: { source: 'legacy' },
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
  createQuickSelectionPolygonMock.mockImplementation(actual.createQuickSelectionPolygon);
  return {
    ...actual,
    createQuickSelectionPolygon: createQuickSelectionPolygonMock,
    rasterizeSelectionState: vi.fn(),
  };
});

vi.mock('../../../hooks/useSelectionAnts.ts', async () => {
  const actual = await vi.importActual<typeof import('../../../hooks/useSelectionAnts.ts')>(
    '../../../hooks/useSelectionAnts.ts'
  );
  return { ...actual, createSelectionRasterOutlineCanvas: createSelectionRasterOutlineMock };
});

vi.mock('../../../contexts/StoreContext.tsx', () => ({
  useStore: () => [
    {
      canvasRef: { current: sourceCanvas },
      containerRef: { current: document.createElement('div') },
      selections: storeState.selections,
      activeSelectionId: storeState.activeSelectionId,
      selectionCleared: null,
      totalSize: storeState.totalSize,
      documentFrame: storeState.documentFrame,
      history: [],
      documentId: storeState.documentId,
      documentRevision: storeState.documentRevision,
      historyIndex: storeState.historyIndex,
      branchRevision: storeState.branchRevision,
      renderSelector: storeState.renderSelector,
    },
    dispatchOverride.current ?? dispatchMock,
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
    canvas: { width: storeState.totalSize.width, height: storeState.totalSize.height },
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    arc: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    setLineDash: vi.fn(),
    getLineDash: vi.fn(() => []),
    drawImage: vi.fn(),
    fillRect: vi.fn(),
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 1,
    globalAlpha: 1,
  } as unknown as CanvasRenderingContext2D;
}

function renderQuickSelectionArea(): HTMLDivElement {
  return renderQuickSelectionView().toolArea;
}

function renderQuickSelectionView() {
  const overlayCtxRef = { current: createOverlayContext() };
  const makeElement = () => (
    <QuickSelectionToolArea overlayCtxRef={overlayCtxRef} className="test-quick-selection-area" />
  );
  const view = render(makeElement());
  return {
    toolArea: view.container.firstElementChild as HTMLDivElement,
    overlayCtx: overlayCtxRef.current,
    rerender: () => view.rerender(makeElement()),
    unmount: view.unmount,
  };
}

describe('QuickSelectionToolArea', () => {
  let getContextSpy: Mock | null = null;
  let growAlongStrokeSpy: ReturnType<typeof vi.spyOn> | null = null;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn> | null = null;

  beforeEach(() => {
    dispatchMock.mockReset();
    dispatchOverride.current = null;
    createQuickSelectionPolygonMock.mockClear();
    createSelectionRasterOutlineMock.mockReset();
    pointerState.activePointerId = null;
    pointerState.releaseCalls = 0;
    vi.mocked(rasterizeSelectionState).mockReset();
    storeState.selections = [];
    storeState.activeSelectionId = null;
    storeState.totalSize = IMAGE_SIZE;
    storeState.documentFrame = null;
    storeState.documentId = 'quick-selection-document';
    storeState.documentRevision = 0;
    storeState.historyIndex = 0;
    storeState.branchRevision = 0;
    storeState.renderSelector = { source: 'legacy' };
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
    growAlongStrokeSpy?.mockRestore();
    growAlongStrokeSpy = null;
    consoleErrorSpy?.mockRestore();
    consoleErrorSpy = null;
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

  it('does not capture the pointer or read stale pixels while replay is pending', () => {
    storeState.renderSelector = { source: 'pending' };
    const toolArea = renderQuickSelectionArea();

    fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, clientX: 5, clientY: 5 });

    expect(pointerState.activePointerId).toBeNull();
    expect(getContextSpy).not.toHaveBeenCalled();
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it('releases the pointer and cancels the draft when a later growth throws', () => {
    const realGrowAlongStroke = quickSelectionUtil.growAlongStroke;
    growAlongStrokeSpy = vi
      .spyOn(quickSelectionUtil, 'growAlongStroke')
      .mockImplementationOnce(realGrowAlongStroke)
      .mockImplementation(() => {
        throw new RangeError('simulated allocation failure');
      });
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const toolArea = renderQuickSelectionArea();

    fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, clientX: 5, clientY: 5 });
    fireEvent.pointerMove(toolArea, { button: 0, pointerId: 1, clientX: 8, clientY: 8 });

    const actions = dispatchMock.mock.calls.map(([action]) => action as { type: string });
    expect(actions.filter((action) => action.type === 'START_SELECTION_DRAFT')).toHaveLength(1);
    expect(actions.filter((action) => action.type === 'CANCEL_SELECTION_DRAFT')).toHaveLength(1);
    expect(actions.some((action) => action.type === 'COMMIT_DOCUMENT_EDIT')).toBe(false);
    expect(pointerState.releaseCalls).toBe(1);
    expect(pointerState.activePointerId).toBeNull();
  });

  it('cancels the draft and releases the pointer when unmounted mid-stroke', () => {
    const view = renderQuickSelectionView();
    fireEvent.pointerDown(view.toolArea, { button: 0, pointerId: 1, clientX: 5, clientY: 5 });

    view.unmount();

    const actions = dispatchMock.mock.calls.map(([action]) => action as { type: string });
    expect(actions.filter((action) => action.type === 'START_SELECTION_DRAFT')).toHaveLength(1);
    expect(actions.filter((action) => action.type === 'CANCEL_SELECTION_DRAFT')).toHaveLength(1);
    expect(actions.some((action) => action.type === 'COMMIT_DOCUMENT_EDIT')).toBe(false);
    expect(pointerState.releaseCalls).toBe(1);
    expect(pointerState.activePointerId).toBeNull();
  });

  it('keeps an in-flight stroke when the store supplies a new dispatch function', () => {
    const view = renderQuickSelectionView();
    const nextDispatch = vi.fn();

    fireEvent.pointerDown(view.toolArea, { button: 0, pointerId: 1, clientX: 5, clientY: 5 });
    dispatchOverride.current = nextDispatch;
    view.rerender();

    expect(
      dispatchMock.mock.calls.some(([action]) => (action as { type: string }).type === 'CANCEL_SELECTION_DRAFT')
    ).toBe(false);
    expect(pointerState.activePointerId).toBe(1);

    fireEvent.pointerMove(view.toolArea, { button: 0, pointerId: 1, clientX: 8, clientY: 8 });
    fireEvent.pointerUp(view.toolArea, { button: 0, pointerId: 1, clientX: 8, clientY: 8 });

    expect(
      nextDispatch.mock.calls.some(([action]) => (action as { type: string }).type === 'COMMIT_DOCUMENT_EDIT')
    ).toBe(true);
    expect(pointerState.activePointerId).toBeNull();
  });

  it('uses the latest dispatch to cancel a stroke when unmounted after a store update', () => {
    const view = renderQuickSelectionView();
    const nextDispatch = vi.fn();

    fireEvent.pointerDown(view.toolArea, { button: 0, pointerId: 1, clientX: 5, clientY: 5 });
    dispatchOverride.current = nextDispatch;
    view.rerender();
    view.unmount();

    expect(
      dispatchMock.mock.calls.some(([action]) => (action as { type: string }).type === 'CANCEL_SELECTION_DRAFT')
    ).toBe(false);
    expect(
      nextDispatch.mock.calls.some(([action]) => (action as { type: string }).type === 'CANCEL_SELECTION_DRAFT')
    ).toBe(true);
    expect(pointerState.activePointerId).toBeNull();
  });

  it('cancels the draft when release-time outline construction throws', () => {
    createQuickSelectionPolygonMock.mockImplementationOnce(() => {
      throw new RangeError('simulated outline allocation failure');
    });
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const toolArea = renderQuickSelectionArea();

    fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, clientX: 5, clientY: 5 });
    fireEvent.pointerUp(toolArea, { button: 0, pointerId: 1, clientX: 5, clientY: 5 });

    const actions = dispatchMock.mock.calls.map(([action]) => action as { type: string });
    expect(actions.filter((action) => action.type === 'START_SELECTION_DRAFT')).toHaveLength(1);
    expect(actions.filter((action) => action.type === 'CANCEL_SELECTION_DRAFT')).toHaveLength(1);
    expect(actions.some((action) => action.type === 'COMMIT_DOCUMENT_EDIT')).toBe(false);
    expect(pointerState.releaseCalls).toBe(1);
    expect(pointerState.activePointerId).toBeNull();
  });

  it('cancels the draft and releases the pointer when the selection writer throws', () => {
    dispatchMock.mockImplementation((action: { type: string }) => {
      if (action.type === 'COMMIT_DOCUMENT_EDIT') throw new Error('simulated selection writer failure');
    });
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const toolArea = renderQuickSelectionArea();

    fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, clientX: 5, clientY: 5 });
    fireEvent.pointerUp(toolArea, { button: 0, pointerId: 1, clientX: 5, clientY: 5 });

    const actions = dispatchMock.mock.calls.map(([action]) => action as { type: string });
    expect(actions.filter((action) => action.type === 'START_SELECTION_DRAFT')).toHaveLength(1);
    expect(actions.filter((action) => action.type === 'COMMIT_DOCUMENT_EDIT')).toHaveLength(2);
    expect(actions.filter((action) => action.type === 'CANCEL_SELECTION_DRAFT')).toHaveLength(1);
    expect(pointerState.releaseCalls).toBe(1);
    expect(pointerState.activePointerId).toBeNull();
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

  it.each([
    [
      'crop changes the frame origin',
      () => {
        storeState.documentFrame = { x: 12, y: 7, ...IMAGE_SIZE };
        storeState.documentRevision += 1;
      },
    ],
    [
      'resize changes the logical image size',
      () => {
        storeState.totalSize = { width: 60, height: 50 };
        storeState.documentFrame = { x: 0, y: 0, width: 60, height: 50 };
        storeState.documentRevision += 1;
      },
    ],
    [
      'document pixels change without changing geometry',
      () => {
        storeState.documentRevision += 1;
      },
    ],
    [
      'the document identity changes',
      () => {
        storeState.documentId = 'replacement-quick-selection-document';
      },
    ],
    [
      'the history cursor changes',
      () => {
        storeState.historyIndex += 1;
      },
    ],
    [
      'the branch revision changes',
      () => {
        storeState.branchRevision += 1;
      },
    ],
  ] as const)('cancels an in-flight stroke when %s', (_label, changeDocument) => {
    const view = renderQuickSelectionView();

    fireEvent.pointerDown(view.toolArea, { button: 0, pointerId: 1, clientX: 5, clientY: 5 });
    changeDocument();
    view.rerender();
    fireEvent.pointerUp(view.toolArea, { button: 0, pointerId: 1, clientX: 8, clientY: 8 });

    const actions = dispatchMock.mock.calls.map(([action]) => action as { type: string });
    expect(actions.some((action) => action.type === 'COMMIT_DOCUMENT_EDIT')).toBe(false);
    expect(actions.some((action) => action.type === 'CANCEL_SELECTION_DRAFT')).toBe(true);
    expect(pointerState.activePointerId).toBeNull();
  });

  it('clears a queued preview when document pixels change before the animation frame', () => {
    const frames: FrameRequestCallback[] = [];
    const requestFrame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    const cancelFrame = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);

    try {
      const { toolArea, rerender, overlayCtx } = renderQuickSelectionView();
      fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, clientX: 5, clientY: 5 });
      expect(frames).toHaveLength(1);

      storeState.documentRevision += 1;
      rerender();
      frames.shift()?.(0);

      expect(createQuickSelectionPolygonMock).not.toHaveBeenCalled();
      expect(vi.mocked(overlayCtx.clearRect)).toHaveBeenCalled();
      expect(dispatchMock.mock.calls.map(([action]) => (action as { type: string }).type)).toContain(
        'CANCEL_SELECTION_DRAFT'
      );
      expect(pointerState.releaseCalls).toBe(1);
    } finally {
      requestFrame.mockRestore();
      cancelFrame.mockRestore();
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

  it('commits an over-budget Quick Selection through the raster representation', () => {
    const size = { width: 200, height: 200 };
    const imageData = createImageData(size.width, size.height);
    for (let y = 0; y < size.height; y += 1) {
      for (let x = 0; x < size.width; x += 1) {
        const index = (y * size.width + x) * 4;
        const selected = x % 2 === 0 || y % 2 === 0;
        imageData.data[index] = selected ? 204 : 255;
        imageData.data[index + 1] = selected ? 0 : 255;
        imageData.data[index + 2] = selected ? 0 : 255;
        imageData.data[index + 3] = 255;
      }
    }
    storeState.totalSize = size;
    sourceCanvas.width = size.width;
    sourceCanvas.height = size.height;
    toolState.toolArgs = { size: 1, tolerance: 0, mode: 'add', alpha: 1, toolName: 'quick-selection' };
    getContextSpy?.mockReturnValue({ getImageData: vi.fn(() => imageData) } as unknown as CanvasRenderingContext2D);

    const toolArea = renderQuickSelectionArea();
    fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, clientX: 4, clientY: 1 });
    fireEvent.pointerMove(toolArea, { button: 0, pointerId: 1, clientX: 4, clientY: 5 });
    fireEvent.pointerUp(toolArea, { button: 0, pointerId: 1, clientX: 4, clientY: 5 });

    const trace = createQuickSelectionPolygonMock.mock.results.at(-1)?.value as
      | { boundaryEdgeCount: number; points: unknown[]; rasterMask?: { width: number; height: number; data: string } }
      | undefined;
    expect(trace?.boundaryEdgeCount).toBeGreaterThan(32_768);
    expect(trace?.rasterMask).toMatchObject({ width: size.width, height: size.height });
    expect(trace?.points).toEqual([]);

    const actions = dispatchMock.mock.calls.map(
      ([action]) =>
        action as {
          type: string;
          payload?: { updates?: { selections?: Selection[] } };
        }
    );
    const committed = actions.find((action) => action.type === 'COMMIT_DOCUMENT_EDIT')?.payload?.updates
      ?.selections?.[0];
    expect(committed).toMatchObject({ sourceTool: 'quick-selection', lifecycle: 'committed' });
    expect(committed?.rasterMask).toMatchObject({ width: size.width, height: size.height });
    expect(committed?.points).toEqual([]);

    const rasterMask = committed?.rasterMask;
    expect(rasterMask).toBeDefined();
    if (!rasterMask) throw new Error('the committed selection has no raster mask');
    const packed = decodeRasterSelectionMask(rasterMask);
    expect(packed).not.toBeNull();
    if (!packed) throw new Error('the committed selection raster mask is not canonical');
    expect(isRasterSelectionPixelSelected(rasterMask, packed, 100, 100)).toBe(true);
    expect(isRasterSelectionPixelSelected(rasterMask, packed, 101, 100)).toBe(true);
    expect(isRasterSelectionPixelSelected(rasterMask, packed, 100, 101)).toBe(true);
    expect(isRasterSelectionPixelSelected(rasterMask, packed, 101, 101)).toBe(false);
  });

  it('coalesces drag previews and traces the exact full-resolution mask on release', () => {
    const size = { width: 501, height: 500 };
    const imageData = createImageData(size.width, size.height);
    for (let y = 0; y < size.height; y += 1) {
      for (let x = 0; x < size.width; x += 1) {
        imageData.data[(y * size.width + x) * 4] = x < 170 ? 10 : x < 340 ? 20 : 30;
      }
    }
    storeState.totalSize = size;
    sourceCanvas.width = size.width;
    sourceCanvas.height = size.height;
    getContextSpy?.mockReturnValue({ getImageData: vi.fn(() => imageData) } as unknown as CanvasRenderingContext2D);

    const frames: FrameRequestCallback[] = [];
    const requestFrame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    const cancelFrame = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);

    try {
      const toolArea = renderQuickSelectionArea();
      fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, clientX: 5, clientY: 25 });
      fireEvent.pointerMove(toolArea, { button: 0, pointerId: 1, clientX: 250, clientY: 25 });
      fireEvent.pointerMove(toolArea, { button: 0, pointerId: 1, clientX: 490, clientY: 25 });

      expect(requestFrame).toHaveBeenCalledTimes(1);
      expect(createQuickSelectionPolygonMock).not.toHaveBeenCalled();

      const drawPreview = frames.shift();
      expect(drawPreview).toBeDefined();
      drawPreview?.(0);

      expect(createQuickSelectionPolygonMock).toHaveBeenCalledTimes(1);
      expect(createQuickSelectionPolygonMock.mock.calls[0]?.[0]).toHaveLength(251 * 250);
      expect(createQuickSelectionPolygonMock.mock.calls[0]?.[1]).toBe(251);
      expect(createQuickSelectionPolygonMock.mock.calls[0]?.[2]).toBe(250);

      fireEvent.pointerUp(toolArea, { button: 0, pointerId: 1, clientX: 490, clientY: 25 });

      expect(createQuickSelectionPolygonMock).toHaveBeenCalledTimes(2);
      expect(createQuickSelectionPolygonMock.mock.calls[1]?.[0]).toHaveLength(size.width * size.height);
      expect(createQuickSelectionPolygonMock.mock.calls[1]?.[1]).toBe(size.width);
      expect(createQuickSelectionPolygonMock.mock.calls[1]?.[2]).toBe(size.height);
    } finally {
      requestFrame.mockRestore();
      cancelFrame.mockRestore();
    }
  });

  it('keeps a coarse preview touching odd-sized document edges inside the source bounds', () => {
    const size = { width: 501, height: 500 };
    const imageData = createImageData(size.width, size.height);
    storeState.totalSize = size;
    sourceCanvas.width = size.width;
    sourceCanvas.height = size.height;
    getContextSpy?.mockReturnValue({ getImageData: vi.fn(() => imageData) } as unknown as CanvasRenderingContext2D);

    const frames: FrameRequestCallback[] = [];
    const requestFrame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    const cancelFrame = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);

    try {
      const { toolArea, overlayCtx } = renderQuickSelectionView();
      const moveTo = vi.mocked(overlayCtx.moveTo);
      const lineTo = vi.mocked(overlayCtx.lineTo);
      fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, clientX: 500, clientY: 499 });

      expect(frames).toHaveLength(1);
      frames.shift()?.(0);

      const coordinates = [...moveTo.mock.calls, ...lineTo.mock.calls];
      expect(coordinates.length).toBeGreaterThan(0);
      expect(Math.max(...coordinates.map(([x]) => x))).toBe(size.width);
      expect(Math.max(...coordinates.map(([, y]) => y))).toBe(size.height);
      expect(vi.mocked(overlayCtx.rect)).toHaveBeenCalledWith(0, 0, size.width, size.height);
      expect(vi.mocked(overlayCtx.clip)).toHaveBeenCalledTimes(1);

      fireEvent.pointerUp(toolArea, { button: 0, pointerId: 1, clientX: 500, clientY: 499 });
    } finally {
      requestFrame.mockRestore();
      cancelFrame.mockRestore();
    }
  });

  it('clips raster fallback previews that extend past odd-sized document edges', () => {
    const size = { width: 501, height: 500 };
    storeState.totalSize = size;
    sourceCanvas.width = size.width;
    sourceCanvas.height = size.height;
    getContextSpy?.mockReturnValue({
      getImageData: vi.fn(() => createImageData(size.width, size.height)),
    } as unknown as CanvasRenderingContext2D);
    createQuickSelectionPolygonMock.mockReturnValueOnce({
      points: [],
      rasterMask: { width: 1, height: 1, data: 'AA==' },
      pixelCount: 1,
      bounds: { x: 250, y: 249, width: 1, height: 1 },
      boundaryEdgeCount: 4,
      hasHoles: null,
    });
    const outlineCanvas = document.createElement('canvas');
    createSelectionRasterOutlineMock.mockReturnValueOnce({
      canvas: outlineCanvas,
      width: 5,
      height: 4,
      scaleFactor: 1,
    });

    const frames: FrameRequestCallback[] = [];
    const requestFrame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    const cancelFrame = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);

    try {
      const { toolArea, overlayCtx } = renderQuickSelectionView();
      fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, clientX: 500, clientY: 499 });
      frames.shift()?.(0);

      expect(vi.mocked(overlayCtx.drawImage)).toHaveBeenCalledWith(outlineCanvas, 498, 496, 10, 8);
      expect(vi.mocked(overlayCtx.rect)).toHaveBeenCalledWith(0, 0, size.width, size.height);
      expect(vi.mocked(overlayCtx.clip)).toHaveBeenCalledTimes(1);
      fireEvent.pointerUp(toolArea, { button: 0, pointerId: 1, clientX: 500, clientY: 499 });
    } finally {
      requestFrame.mockRestore();
      cancelFrame.mockRestore();
    }
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
