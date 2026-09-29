import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import type { Selection } from '../../../contexts/general-types.ts';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { SELECTION_ACTION } from '../../../util/constants.ts';
import { MagicWandToolArea } from '../MagicWandToolArea.tsx';

const dispatchMock = vi.hoisted(() => vi.fn());
const sourceCanvas = vi.hoisted(() => document.createElement('canvas'));
const storeState = vi.hoisted(
  (): {
    selections: Selection[];
    documentFrame: { x: number; y: number; width: number; height: number } | null;
  } => ({ selections: [], documentFrame: null })
);
const toolState = vi.hoisted(
  (): { toolArgs: { contiguous: boolean; smoothing: number; tolerance: number; toolName: string } } => ({
    toolArgs: { contiguous: true, smoothing: 1, tolerance: 0, toolName: 'magic-wand' },
  })
);

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

  // Two red 2x2 blocks of the identical colour, deliberately not sharing an edge. A
  // contiguous fill reaches only the block under the seed; an all-matching fill takes both,
  // which is the whole difference `Contiguous` makes.
  for (const [x, y] of [
    [2, 2],
    [3, 2],
    [2, 3],
    [3, 3],
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
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
    // The leaked value: the tool overlay is one 2D context for the whole session, and the brush
    // default is 0.9. 0.2 is the worst case worth naming — the Opacity slider at its floor.
    globalAlpha: 0.2,
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
    toolState.toolArgs = { contiguous: true, smoothing: 1, tolerance: 0, toolName: 'magic-wand' };
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
    expect(mockCtx.closePath).toHaveBeenCalled();
  });

  /**
   * Adobe: "Uncheck Contiguous if you want to select nonadjacent areas of similar color."
   *
   * The image carries two red blocks of the identical colour that share no edge, so the seed's
   * own block is four pixels and the whole image's red is eight. The count the wand reports is
   * read off the committed metadata, which is the same number the user sees in the bar.
   */
  describe('contiguous', () => {
    function clickSeedWith(contiguous: boolean) {
      toolState.toolArgs = { contiguous, smoothing: 1, tolerance: 0, toolName: 'magic-wand' };
      const mockCtx = createMockContext();
      const { container } = render(
        <MagicWandToolArea overlayCtxRef={{ current: mockCtx }} className="test-magic-wand-area" />
      );
      const toolArea = container.firstElementChild as HTMLDivElement;

      fireEvent.pointerDown(toolArea, { button: 0, clientX: 2, clientY: 2 });

      const selection = singleSelectionEdit().payload.updates.selections[0] as Selection;
      return selection.metadata?.magicWand?.selectedPixelCount;
    }

    it('selects only the connected region under the seed when contiguous is on', () => {
      expect(clickSeedWith(true)).toBe(4);
    });

    it('selects every region of the seed colour when contiguous is off', () => {
      expect(clickSeedWith(false)).toBe(8);
    });
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
    toolState.toolArgs = { contiguous: true, smoothing: 1, tolerance: 0, toolName: 'rectangular-selection' };
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

  it('strokes the selection outline at full opacity, whatever alpha a previous tool left', () => {
    // The reset lives inside `drawSelectionOutline` rather than in each caller, because the
    // per-caller version had to be added one tool at a time and the magic wand's two loops were
    // the ones that never got it. 0.95 x 0.2 is an outline you cannot see.
    storeState.selections = [
      {
        id: 'selection-1',
        isActive: true,
        geometry: 'polygon',
        sourceTool: 'magic-wand',
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
    const alphaAtStroke: number[] = [];
    vi.mocked(mockCtx.stroke).mockImplementation(() => {
      alphaAtStroke.push(mockCtx.globalAlpha);
    });

    render(<MagicWandToolArea overlayCtxRef={{ current: mockCtx }} className="test-magic-wand-area" />);

    expect(alphaAtStroke).toEqual([1]);
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
