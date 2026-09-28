import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import type { Selection } from '../../../contexts/general-types.ts';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { SELECTION_ACTION } from '../../../util/constants.ts';
import { SELECTION_ANCHOR_RADIUS } from '../../../util/selection.ts';
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

/**
 * The wand commit is routed through `useSelectionHistory`, which reads the
 * selection baseline AND the legacy append point (`history`/`historyIndex`) off
 * the same store tuple the tool area reads, so the mock carries every field the
 * single-writer hook destructures — a missing `activeSelectionId` would arrive
 * as `undefined` inside the recorded `previousSelectionState`.
 */
vi.mock('../../../contexts/StoreContext.tsx', () => ({
  useStore: () => [
    {
      canvasRef: { current: sourceCanvas },
      containerRef: { current: document.createElement('div') },
      selections: storeState.selections,
      activeSelectionId: null,
      totalSize: { width: 6, height: 6 },
      documentFrame: storeState.documentFrame,
      history: [],
      historyIndex: 0,
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

/**
 * The wand commit is no longer a raw `COMMIT_SELECTION`: it is a document edit
 * that appends to history, so a drawn selection is undoable on its own instead of
 * surviving only as the `previousSelectionState` of whatever clears it later. The
 * contract is one `COMMIT_DOCUMENT_EDIT` carrying both the history item and the
 * resulting selection state.
 *
 * Only the fields below are narrowed: `durableEntry` is deliberately not part of
 * the pin, because the store publishes the planned entry only when its durable
 * document still describes the timeline the plan was made against, and the
 * boundary's failure fallback omits it entirely — both are correct.
 */
type SelectionEdit = {
  type: string;
  payload: {
    historyItem: { actionName: string; id: string };
    updates: { selections: { id: string }[]; activeSelectionId: string | null };
  };
};

/**
 * The `COMMIT_DOCUMENT_EDIT` actions the mocked dispatch received.
 *
 * `updates.activeSelectionId` cannot be pinned to a literal, because both the
 * history id and the selection id are fresh uuids minted per call. What is a real
 * contract is the linkage between them, so the tests read the two values off the
 * dispatched action and compare them.
 */
function selectionEdits(): SelectionEdit[] {
  return (dispatchMock.mock.calls as unknown[][])
    .map(([action]) => action as SelectionEdit)
    .filter((action) => action.type === 'COMMIT_DOCUMENT_EDIT');
}

function singleSelectionEdit(): SelectionEdit {
  const edits = selectionEdits();
  expect(edits).toHaveLength(1);
  return edits[0];
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

    // Read the commit's own repaint, not the mount effect's clear.
    vi.mocked(mockCtx.clearRect).mockClear();
    fireEvent.pointerDown(toolArea, { button: 0, clientX: 2, clientY: 2 });

    expect(dispatchMock).toHaveBeenNthCalledWith(1, {
      type: 'START_SELECTION_DRAFT',
      payload: { sourceTool: 'magic-wand' },
    });
    expect(dispatchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'COMMIT_DOCUMENT_EDIT',
        payload: expect.objectContaining({
          historyItem: expect.objectContaining({
            id: expect.any(String),
            actionName: SELECTION_ACTION,
          }),
          updates: expect.objectContaining({
            // Exactly one selection, appended: the raw `COMMIT_SELECTION` payload
            // used to carry these fields itself.
            selections: [
              expect.objectContaining({
                geometry: 'polygon',
                lifecycle: 'committed',
                isActive: true,
                sourceTool: 'magic-wand',
                points: [
                  { x: 1, y: 1 },
                  { x: 3, y: 1 },
                  { x: 3, y: 3 },
                  { x: 1, y: 3 },
                ],
                pos: { x: 1, y: 1, width: 4, height: 4 },
                metadata: expect.objectContaining({
                  magicWand: expect.objectContaining({
                    boundaryPointCount: 4,
                    selectedPixelCount: 4,
                    tolerance: 0,
                  }),
                }),
              }),
            ],
          }),
        }),
      })
    );
    // The pointer maps to exactly the appended selection, which is what activates
    // it: the two uuids cannot be pinned literally, their equality can.
    expect(singleSelectionEdit().payload.updates.activeSelectionId).toBe(
      singleSelectionEdit().payload.updates.selections[0].id
    );
    // A wand selection has no anchors and its border belongs to the marching-ants
    // canvas, so the tool overlay's whole contribution to a commit is the clear.
    expect(mockCtx.clearRect).toHaveBeenCalledWith(0, 0, 6, 6);
    expect(mockCtx.arc).not.toHaveBeenCalled();
    expect(mockCtx.moveTo).not.toHaveBeenCalled();
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
    // No history entry for a boundary that was never traced. `COMMIT_DOCUMENT_EDIT`
    // is the only path that appends one, so this is the guard that survived the move
    // off the raw `COMMIT_SELECTION` action.
    expect(selectionEdits()).toEqual([]);
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
        type: 'COMMIT_DOCUMENT_EDIT',
        payload: expect.objectContaining({
          historyItem: expect.objectContaining({
            id: expect.any(String),
            actionName: SELECTION_ACTION,
          }),
          updates: expect.objectContaining({
            selections: [
              expect.objectContaining({
                geometry: 'polygon',
                lifecycle: 'committed',
                isActive: true,
                // The frame offsets the seed and the geometry together, so a
                // seed converted without the bounds would leave the two in
                // different spaces. Both are pinned here for that reason.
                pos: { x: 4, y: 5, width: 4, height: 4 },
                metadata: expect.objectContaining({
                  magicWand: expect.objectContaining({
                    seed: { x: 5, y: 6 },
                  }),
                }),
              }),
            ],
          }),
        }),
      })
    );
  });

  it("repaints an interactive committed selection's anchors from the store on mount", () => {
    // A wand selection has no anchors, so the only thing a tool area can repaint is
    // a selection another tool made: its border is the marching-ants canvas's job.
    storeState.selections = [
      {
        id: 'selection-1',
        isActive: true,
        geometry: 'polygon',
        sourceTool: 'polygonal-lasso',
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

    expect(mockCtx.clearRect).toHaveBeenCalledWith(0, 0, 6, 6);
    expect(mockCtx.arc).toHaveBeenNthCalledWith(1, 0, 0, SELECTION_ANCHOR_RADIUS, 0, Math.PI * 2);
    expect(mockCtx.arc).toHaveBeenNthCalledWith(2, 4, 0, SELECTION_ANCHOR_RADIUS, 0, Math.PI * 2);
    expect(mockCtx.arc).toHaveBeenNthCalledWith(3, 4, 4, SELECTION_ANCHOR_RADIUS, 0, Math.PI * 2);
    // The handles are the whole picture the tool overlay paints of a committed
    // selection: no path, so no double-drawn border.
    expect(mockCtx.moveTo).not.toHaveBeenCalled();
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
