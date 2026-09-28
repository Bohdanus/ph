import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import type { Selection } from '../../../contexts/general-types.ts';
import { SELECTION_ACTION } from '../../../util/constants.ts';
import { PolygonClickToolArea } from '../PolygonClickToolArea.tsx';
import type { PointerEvent as ReactPointerEvent } from 'react';

const dispatchMock = vi.hoisted(() => vi.fn());
const storeState = vi.hoisted((): { activeSelectionId: string | null; selections: Selection[] } => ({
  activeSelectionId: null,
  selections: [],
}));
const currentToolState = vi.hoisted(() => ({ toolName: 'polygonal-lasso' }));
const shortcutHandlers = vi.hoisted(() => new Map<string, () => void>());

// Mock dependencies
vi.mock('../../../hooks/usePointerPosition.ts', () => ({
  usePointerPosition: () => ({
    getLocalCoords: (event: ReactPointerEvent<HTMLElement>) => ({ x: event.clientX, y: event.clientY }),
    isMouseDown: { current: true },
  }),
}));

vi.mock('../../../hooks/usePolylineAnts.ts', () => ({
  useMarchingPath: () => ({
    draw: vi.fn(),
    clear: vi.fn(),
  }),
}));

vi.mock('../../../hooks/useKeyboardEvents.tsx', () => ({
  useKeyDownShortcut: (shortcut: { key: string; onKeyDown: () => void }) => {
    shortcutHandlers.set(shortcut.key, shortcut.onKeyDown);
  },
}));

vi.mock('../../../contexts/StoreContext.tsx', () => ({
  useStore: () => [
    {
      activeSelectionId: storeState.activeSelectionId,
      containerRef: { current: document.createElement('div') },
      // The single-writer hook reads the legacy timeline so it can plan the
      // append. An empty timeline at cursor -1 is what a store with nothing
      // appended yet actually looks like, and `planHistoryAppend` reports the
      // out-of-range cursor as a diagnostic rather than refusing the edit.
      history: [],
      historyIndex: -1,
      selections: storeState.selections,
      toolOverlayRef: { current: document.createElement('canvas') },
      totalSize: { width: 800, height: 600 },
      // Explicit, so the hook derives the same frame the tool area does rather
      // than relying on an absent key. Non-zero on purpose: a zero-origin frame
      // makes document and canvas coordinates identical, so a conversion that
      // dropped the offset would still satisfy every assertion in this file.
      documentFrame: { x: 30, y: 40, width: 800, height: 600 },
    },
    dispatchMock,
  ],
}));

vi.mock('../../../contexts/useCurrentTool.tsx', () => ({
  useCurrentTool: () => ({
    toolArgs: { toolName: currentToolState.toolName, mode: 'outline' },
  }),
}));

describe('PolygonClickToolArea', () => {
  beforeEach(() => {
    dispatchMock.mockClear();
    storeState.activeSelectionId = null;
    storeState.selections = [];
    currentToolState.toolName = 'polygonal-lasso';
    shortcutHandlers.clear();
  });

  const createMockContext = () =>
    ({
      canvas: { width: 800, height: 600 },
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
    }) as unknown as CanvasRenderingContext2D;

  const LASSO_SELECTION: Selection = {
    id: 'sel-1',
    geometry: 'polygon',
    sourceTool: 'polygonal-lasso',
    lifecycle: 'committed',
    isActive: true,
    pos: { x: 4, y: 8, width: 16, height: 24 },
    points: [
      { x: 4, y: 8 },
      { x: 20, y: 8 },
      { x: 20, y: 32 },
    ],
  };

  /**
   * A lasso commit is no longer a raw `COMMIT_SELECTION`: it is a document edit
   * that appends to history, so a drawn selection is undoable on its own instead
   * of surviving only as the `previousSelectionState` of whatever clears it later.
   * The contract is ONE `COMMIT_DOCUMENT_EDIT` carrying both the history item and
   * the resulting selection state, which is what the hook's
   * `committedSelectionUpdate` derived — the raw action is no longer dispatched,
   * so `updates.selections` IS the store state.
   *
   * `durableEntry` is deliberately not part of the pin, and `id` is a fresh uuid
   * per call; the reasons are the same as the clear pin below.
   */
  type SelectionEdit = {
    type: string;
    payload: {
      historyItem: { actionName: string; id: string };
      updates: {
        activeSelectionId: string | null;
        selections: Selection[];
        selectionCleared: null;
        selectionDraft: { status: string };
      };
    };
  };

  const selectionEdits = (): SelectionEdit[] =>
    (dispatchMock.mock.calls as unknown[][])
      .map(([action]) => action as SelectionEdit)
      .filter((action) => action.type === 'COMMIT_DOCUMENT_EDIT');

  /** The single selection a `COMMIT_DOCUMENT_EDIT` published, which is the drawn lasso. */
  const committedSelection = (): Selection => selectionEdits()[0].payload.updates.selections[0];

  it('finishes a polygonal selection on double-click without adding a duplicate final point', () => {
    const mockCtx = createMockContext();

    const { container } = render(
      <PolygonClickToolArea overlayCtxRef={{ current: mockCtx }} className="test-lasso-area" />
    );

    const toolArea = container.firstElementChild as HTMLDivElement;

    fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerDown(toolArea, { button: 0, clientX: 100, clientY: 10 });
    fireEvent.pointerDown(toolArea, { button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerDown(toolArea, { button: 0, clientX: 101, clientY: 101 });

    expect(dispatchMock).toHaveBeenCalledTimes(2);
    expect(dispatchMock).toHaveBeenNthCalledWith(1, {
      type: 'START_SELECTION_DRAFT',
      payload: { sourceTool: 'polygonal-lasso' },
    });
    expect(selectionEdits()).toHaveLength(1);
    expect(selectionEdits()[0]).toMatchObject({
      type: 'COMMIT_DOCUMENT_EDIT',
      payload: {
        historyItem: { actionName: SELECTION_ACTION, id: expect.any(String) },
        // The visible half of the same transition. `selectionDraft` and
        // `selectionCleared` are asserted because they are the other two fields
        // the raw `COMMIT_SELECTION` reducer arm moved, so leaving them out
        // would let the hook silently stop resetting the draft or repainting the
        // overlay.
        updates: {
          selectionCleared: null,
          selectionDraft: { status: 'idle' },
          selections: [
            expect.objectContaining({
              geometry: 'polygon',
              lifecycle: 'committed',
              isActive: true,
              sourceTool: 'polygonal-lasso',
              points: [
                { x: 1, y: 1 },
                { x: 91, y: 1 },
                { x: 91, y: 91 },
              ],
              pos: { x: 39, y: 49, width: 92, height: 92 },
            }),
          ],
        },
      },
    });
    // The pointer maps to exactly the appended selection, which is what activates
    // it: the two uuids cannot be pinned literally, their equality can.
    expect(selectionEdits()[0].payload.updates.activeSelectionId).toBe(
      selectionEdits()[0].payload.updates.selections[0].id
    );
  });

  it('finishes a freehand selection on pointer up and commits normalized points', () => {
    currentToolState.toolName = 'freehand-lasso';
    const mockCtx = createMockContext();

    const { container } = render(
      <PolygonClickToolArea overlayCtxRef={{ current: mockCtx }} className="test-lasso-area" />
    );

    const toolArea = container.firstElementChild as HTMLDivElement;

    fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(toolArea, { clientX: 30, clientY: 20 });
    fireEvent.pointerMove(toolArea, { clientX: 40, clientY: 50 });
    fireEvent.pointerUp(toolArea, { clientX: 40, clientY: 50 });

    expect(dispatchMock).toHaveBeenCalledWith({
      type: 'START_SELECTION_DRAFT',
      payload: { sourceTool: 'freehand-lasso' },
    });
    expect(selectionEdits()).toHaveLength(1);
    expect(committedSelection()).toMatchObject({
      geometry: 'polygon',
      lifecycle: 'committed',
      isActive: true,
      sourceTool: 'freehand-lasso',
      points: [
        { x: 1, y: 1 },
        { x: 21, y: 11 },
        { x: 31, y: 41 },
      ],
      pos: { x: 39, y: 49, width: 32, height: 42 },
    });
  });

  it('cancels a freehand draft when the drag is too short to form a selection', () => {
    currentToolState.toolName = 'freehand-lasso';
    const mockCtx = createMockContext();

    const { container } = render(
      <PolygonClickToolArea overlayCtxRef={{ current: mockCtx }} className="test-lasso-area" />
    );

    const toolArea = container.firstElementChild as HTMLDivElement;

    fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(toolArea, { clientX: 11, clientY: 11 });
    fireEvent.pointerUp(toolArea, { clientX: 11, clientY: 11 });

    expect(dispatchMock).toHaveBeenCalledWith({
      type: 'START_SELECTION_DRAFT',
      payload: { sourceTool: 'freehand-lasso' },
    });
    expect(dispatchMock).toHaveBeenCalledWith({ type: 'CANCEL_SELECTION_DRAFT' });
    expect(selectionEdits()).toHaveLength(0);
  });

  it('does not collect freehand points after the pointer is released', () => {
    currentToolState.toolName = 'freehand-lasso';
    const mockCtx = createMockContext();

    const { container } = render(
      <PolygonClickToolArea overlayCtxRef={{ current: mockCtx }} className="test-lasso-area" />
    );

    const toolArea = container.firstElementChild as HTMLDivElement;

    fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(toolArea, { clientX: 30, clientY: 20 });
    fireEvent.pointerMove(toolArea, { clientX: 40, clientY: 50 });
    fireEvent.pointerUp(toolArea, { clientX: 40, clientY: 50 });
    dispatchMock.mockClear();

    fireEvent.pointerMove(toolArea, { clientX: 120, clientY: 120 });
    fireEvent.pointerUp(toolArea, { clientX: 120, clientY: 120 });

    expect(selectionEdits()).toHaveLength(0);
    expect(dispatchMock).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'START_SELECTION_DRAFT' }));
  });

  it('ignores freehand drags that start outside image bounds', () => {
    currentToolState.toolName = 'freehand-lasso';
    const mockCtx = createMockContext();

    const { container } = render(
      <PolygonClickToolArea overlayCtxRef={{ current: mockCtx }} className="test-lasso-area" />
    );

    const toolArea = container.firstElementChild as HTMLDivElement;

    fireEvent.pointerDown(toolArea, { button: 0, clientX: -20, clientY: -20 });
    fireEvent.pointerMove(toolArea, { clientX: 20, clientY: 20 });
    fireEvent.pointerUp(toolArea, { clientX: 20, clientY: 20 });

    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it('clamps freehand samples to the image bounds and previews the automatic closing edge', () => {
    currentToolState.toolName = 'freehand-lasso';
    const mockCtx = createMockContext();

    const { container } = render(
      <PolygonClickToolArea overlayCtxRef={{ current: mockCtx }} className="test-lasso-area" />
    );

    const toolArea = container.firstElementChild as HTMLDivElement;

    fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(toolArea, { clientX: 900, clientY: 700 });
    fireEvent.pointerMove(toolArea, { clientX: 400, clientY: 300 });

    expect(mockCtx.lineTo).toHaveBeenCalledWith(10, 10);

    fireEvent.pointerUp(toolArea, { clientX: 400, clientY: 300 });

    expect(selectionEdits()).toHaveLength(1);
    expect(committedSelection()).toMatchObject({
      points: [
        { x: 1, y: 1 },
        { x: 791, y: 591 },
        { x: 391, y: 291 },
      ],
      pos: { x: 39, y: 49, width: 792, height: 592 },
      sourceTool: 'freehand-lasso',
    });
  });

  it('draws active committed selections from store state so the lasso stays visible after finishing', () => {
    storeState.selections = [
      {
        id: 'selection-1',
        isActive: true,
        pos: { x: 39, y: 49, width: 92, height: 92 },
        points: [
          { x: 1, y: 1 },
          { x: 91, y: 1 },
          { x: 91, y: 91 },
        ],
      },
    ];

    const mockCtx = createMockContext();

    render(<PolygonClickToolArea overlayCtxRef={{ current: mockCtx }} className="test-lasso-area" />);

    expect(mockCtx.moveTo).toHaveBeenCalledWith(10, 10);
    expect(mockCtx.lineTo).toHaveBeenCalledWith(100, 10);
    expect(mockCtx.lineTo).toHaveBeenCalledWith(100, 100);
    expect(mockCtx.closePath).toHaveBeenCalled();
    expect(mockCtx.stroke).toHaveBeenCalled();
  });

  it('commits a reshape when an individual anchor is dragged and the pointer is released', () => {
    storeState.activeSelectionId = 'selection-1';
    storeState.selections = [
      {
        id: 'selection-1',
        isActive: true,
        pos: { x: 39, y: 49, width: 92, height: 92 },
        points: [
          { x: 1, y: 1 },
          { x: 91, y: 1 },
          { x: 91, y: 91 },
        ],
      },
    ];

    const mockCtx = createMockContext();
    const { container } = render(
      <PolygonClickToolArea overlayCtxRef={{ current: mockCtx }} className="test-lasso-area" />
    );
    const toolArea = container.firstElementChild as HTMLDivElement;

    fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(toolArea, { clientX: 20, clientY: 20 });

    // The drag is overlay-only: a move writes no history, it previews one.
    expect(selectionEdits()).toHaveLength(0);

    fireEvent.pointerUp(toolArea, { clientX: 20, clientY: 20 });

    expect(selectionEdits()).toHaveLength(1);
    // The same selection id, with the dragged anchor re-bounding the selection —
    // a reshape, so `'move'` is the mode and the entry is undoable on its own.
    expect(committedSelection()).toMatchObject({
      id: 'selection-1',
      metadata: { movedAtVersion: 1 },
      pos: { x: 49, y: 49, width: 82, height: 92 },
      points: [
        { x: 1, y: 11 },
        { x: 81, y: 1 },
        { x: 81, y: 91 },
      ],
    });
  });

  it('commits a translation when the selection is dragged from inside and the pointer is released', () => {
    storeState.activeSelectionId = 'selection-1';
    storeState.selections = [
      {
        id: 'selection-1',
        isActive: true,
        pos: { x: 39, y: 49, width: 92, height: 92 },
        points: [
          { x: 1, y: 1 },
          { x: 91, y: 1 },
          { x: 91, y: 91 },
        ],
      },
    ];

    const mockCtx = createMockContext();
    const { container } = render(
      <PolygonClickToolArea overlayCtxRef={{ current: mockCtx }} className="test-lasso-area" />
    );
    const toolArea = container.firstElementChild as HTMLDivElement;

    fireEvent.pointerDown(toolArea, { button: 0, clientX: 80, clientY: 40 });
    fireEvent.pointerMove(toolArea, { clientX: 90, clientY: 55 });

    expect(selectionEdits()).toHaveLength(0);

    fireEvent.pointerUp(toolArea, { clientX: 90, clientY: 55 });

    expect(selectionEdits()).toHaveLength(1);
    expect(committedSelection()).toMatchObject({
      id: 'selection-1',
      metadata: { movedAtVersion: 1 },
      // +10/+15, applied to the origin rather than to the stored position.
      pos: { x: 49, y: 64, width: 92, height: 92 },
      points: [
        { x: 1, y: 1 },
        { x: 91, y: 1 },
        { x: 91, y: 91 },
      ],
    });
  });

  it('drops an abandoned drag when the pointer leaves the surface', () => {
    storeState.activeSelectionId = 'selection-1';
    storeState.selections = [
      {
        id: 'selection-1',
        isActive: true,
        pos: { x: 39, y: 49, width: 92, height: 92 },
        points: [
          { x: 1, y: 1 },
          { x: 91, y: 1 },
          { x: 91, y: 91 },
        ],
      },
    ];

    const mockCtx = createMockContext();
    const { container } = render(
      <PolygonClickToolArea overlayCtxRef={{ current: mockCtx }} className="test-lasso-area" />
    );
    const toolArea = container.firstElementChild as HTMLDivElement;

    fireEvent.pointerDown(toolArea, { button: 0, clientX: 80, clientY: 40 });
    fireEvent.pointerMove(toolArea, { clientX: 90, clientY: 55 });
    vi.mocked(mockCtx.moveTo).mockClear();

    fireEvent.pointerLeave(toolArea, { clientX: 90, clientY: 55 });

    // No history, and the overlay is back to the stored geometry: the move only
    // ever lived in the drag ref, so dropping it needs no rollback.
    expect(selectionEdits()).toHaveLength(0);
    expect(mockCtx.moveTo).toHaveBeenCalledWith(10, 10);
  });

  it('changes cursor when hovering a committed anchor point', () => {
    storeState.selections = [
      {
        id: 'selection-1',
        isActive: true,
        pos: { x: 39, y: 49, width: 92, height: 92 },
        points: [
          { x: 1, y: 1 },
          { x: 91, y: 1 },
          { x: 91, y: 91 },
        ],
      },
    ];

    const mockCtx = createMockContext();
    const { container } = render(
      <PolygonClickToolArea overlayCtxRef={{ current: mockCtx }} className="test-lasso-area" />
    );
    const toolArea = container.firstElementChild as HTMLDivElement;

    fireEvent.pointerMove(toolArea, { clientX: 10, clientY: 10 });

    expect(toolArea.style.cursor).toBe('grab');
  });

  it('ignores outside canvas clicks while an active committed selection is closed', () => {
    storeState.selections = [
      {
        id: 'selection-1',
        isActive: true,
        pos: { x: 39, y: 49, width: 92, height: 92 },
        points: [
          { x: 1, y: 1 },
          { x: 91, y: 1 },
          { x: 91, y: 91 },
        ],
      },
    ];

    const mockCtx = createMockContext();
    const { container } = render(
      <PolygonClickToolArea overlayCtxRef={{ current: mockCtx }} className="test-lasso-area" />
    );
    const toolArea = container.firstElementChild as HTMLDivElement;

    fireEvent.pointerDown(toolArea, { button: 0, clientX: 300, clientY: 300 });
    fireEvent.pointerDown(toolArea, { button: 0, clientX: 350, clientY: 300 });
    fireEvent.pointerDown(toolArea, { button: 0, clientX: 350, clientY: 350 });
    fireEvent.pointerDown(toolArea, { button: 0, clientX: 351, clientY: 351 });

    expect(dispatchMock).not.toHaveBeenCalled();
  });

  describe('keyboard shortcuts', () => {
    it('cancels a polygonal lasso draft with Escape', () => {
      const mockCtx = createMockContext();
      const { container } = render(
        <PolygonClickToolArea overlayCtxRef={{ current: mockCtx }} className="test-lasso-area" />
      );
      const toolArea = container.firstElementChild as HTMLDivElement;

      fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 10 });
      fireEvent.pointerDown(toolArea, { button: 0, clientX: 100, clientY: 10 });
      fireEvent.pointerDown(toolArea, { button: 0, clientX: 100, clientY: 100 });

      expect(dispatchMock).toHaveBeenCalledWith({
        type: 'START_SELECTION_DRAFT',
        payload: { sourceTool: 'polygonal-lasso' },
      });

      dispatchMock.mockClear();
      shortcutHandlers.get('Escape')?.();

      expect(dispatchMock).toHaveBeenCalledWith({ type: 'CANCEL_SELECTION_DRAFT' });
    });

    it('does nothing with Escape when no draft is in progress', () => {
      const mockCtx = createMockContext();
      render(<PolygonClickToolArea overlayCtxRef={{ current: mockCtx }} className="test-lasso-area" />);

      dispatchMock.mockClear();
      shortcutHandlers.get('Escape')?.();

      expect(dispatchMock).not.toHaveBeenCalled();
    });

    it('removes the last anchor with Backspace in polygonal mode', () => {
      const mockCtx = createMockContext();
      const { container } = render(
        <PolygonClickToolArea overlayCtxRef={{ current: mockCtx }} className="test-lasso-area" />
      );
      const toolArea = container.firstElementChild as HTMLDivElement;

      fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 10 });
      fireEvent.pointerDown(toolArea, { button: 0, clientX: 100, clientY: 10 });
      fireEvent.pointerDown(toolArea, { button: 0, clientX: 100, clientY: 100 });

      dispatchMock.mockClear();
      vi.mocked(mockCtx.clearRect).mockClear();

      shortcutHandlers.get('Backspace')?.();

      // Popping an anchor only redraws the draft; it is not a gesture end, so it
      // must never append a history entry.
      expect(selectionEdits()).toHaveLength(0);
      expect(mockCtx.clearRect).toHaveBeenCalled();
    });

    it('does not remove anchors with Backspace in freehand mode', () => {
      currentToolState.toolName = 'freehand-lasso';
      const mockCtx = createMockContext();
      const { container } = render(
        <PolygonClickToolArea overlayCtxRef={{ current: mockCtx }} className="test-lasso-area" />
      );
      const toolArea = container.firstElementChild as HTMLDivElement;

      fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 10 });
      fireEvent.pointerMove(toolArea, { clientX: 30, clientY: 20 });

      dispatchMock.mockClear();
      shortcutHandlers.get('Backspace')?.();

      expect(dispatchMock).not.toHaveBeenCalled();
    });

    it('clears selections with Backspace when no draft in progress', () => {
      storeState.selections = [LASSO_SELECTION];
      storeState.activeSelectionId = 'sel-1';
      const mockCtx = createMockContext();
      render(<PolygonClickToolArea overlayCtxRef={{ current: mockCtx }} className="test-lasso-area" />);

      dispatchMock.mockClear();
      shortcutHandlers.get('Backspace')?.();

      // Backspace over an empty draft no longer dispatches a raw
      // `CLEAR_SELECTIONS` reducer action: it is a document edit that appends to
      // history, so the deselect is undoable like any other. One dispatch carries
      // both the history item and the resulting selection state, so the two
      // cannot disagree.
      //
      // `durableEntry` is deliberately not matched. The store publishes the
      // planned entry only when its durable document still describes the
      // timeline the plan was made against, and the boundary's failure fallback
      // omits it entirely; both are correct. `id` is a fresh uuid per call.
      expect(dispatchMock).toHaveBeenCalledTimes(1);
      expect(dispatchMock).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'COMMIT_DOCUMENT_EDIT',
          payload: expect.objectContaining({
            historyItem: expect.objectContaining({
              id: expect.any(String),
              actionName: SELECTION_ACTION,
              args: expect.objectContaining({
                previousSelectionState: {
                  selections: [LASSO_SELECTION],
                  activeSelectionId: 'sel-1',
                },
                nextSelectionState: { selections: [], activeSelectionId: null },
              }),
            }),
            // The visible half of the same transition. `selectionDraft` and
            // `selectionCleared` are asserted too: they are the other two fields
            // the raw reducer arm moved, so leaving them out would let the hook
            // silently stop resetting the draft or repainting the overlay.
            updates: expect.objectContaining({
              activeSelectionId: null,
              selectionCleared: expect.objectContaining({ status: 'cleared', version: 1 }),
              selectionDraft: { status: 'idle' },
              selections: [],
            }),
          }),
        })
      );
    });

    it('dispatches nothing with Backspace when there is neither a draft nor a selection', () => {
      const mockCtx = createMockContext();
      render(<PolygonClickToolArea overlayCtxRef={{ current: mockCtx }} className="test-lasso-area" />);

      dispatchMock.mockClear();
      shortcutHandlers.get('Backspace')?.();

      // The writer guards on the selection state itself, so an already-empty
      // document records nothing: no history entry describing a change that did
      // not happen, and no edit flagging the document dirty.
      expect(dispatchMock).not.toHaveBeenCalled();
    });

    it('completes a polygonal selection with Enter', () => {
      const mockCtx = createMockContext();
      const { container } = render(
        <PolygonClickToolArea overlayCtxRef={{ current: mockCtx }} className="test-lasso-area" />
      );
      const toolArea = container.firstElementChild as HTMLDivElement;

      fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 10 });
      fireEvent.pointerDown(toolArea, { button: 0, clientX: 100, clientY: 10 });
      fireEvent.pointerDown(toolArea, { button: 0, clientX: 100, clientY: 100 });

      dispatchMock.mockClear();
      shortcutHandlers.get('Enter')?.();

      expect(selectionEdits()).toHaveLength(1);
      expect(committedSelection()).toMatchObject({
        geometry: 'polygon',
        sourceTool: 'polygonal-lasso',
      });
    });

    it('completes a freehand selection with Enter', () => {
      currentToolState.toolName = 'freehand-lasso';
      const mockCtx = createMockContext();
      const { container } = render(
        <PolygonClickToolArea overlayCtxRef={{ current: mockCtx }} className="test-lasso-area" />
      );
      const toolArea = container.firstElementChild as HTMLDivElement;

      fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 10 });
      fireEvent.pointerMove(toolArea, { clientX: 30, clientY: 20 });
      fireEvent.pointerMove(toolArea, { clientX: 40, clientY: 50 });

      dispatchMock.mockClear();
      shortcutHandlers.get('Enter')?.();

      expect(selectionEdits()).toHaveLength(1);
      expect(committedSelection()).toMatchObject({
        geometry: 'polygon',
        sourceTool: 'freehand-lasso',
      });
    });

    it('cancels a freehand draft with Escape', () => {
      currentToolState.toolName = 'freehand-lasso';
      const mockCtx = createMockContext();
      const { container } = render(
        <PolygonClickToolArea overlayCtxRef={{ current: mockCtx }} className="test-lasso-area" />
      );
      const toolArea = container.firstElementChild as HTMLDivElement;

      fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 10 });
      fireEvent.pointerMove(toolArea, { clientX: 30, clientY: 20 });

      dispatchMock.mockClear();
      shortcutHandlers.get('Escape')?.();

      expect(dispatchMock).toHaveBeenCalledWith({ type: 'CANCEL_SELECTION_DRAFT', payload: undefined });
    });

    it('Delete works the same as Backspace', () => {
      const mockCtx = createMockContext();
      const { container } = render(
        <PolygonClickToolArea overlayCtxRef={{ current: mockCtx }} className="test-lasso-area" />
      );
      const toolArea = container.firstElementChild as HTMLDivElement;

      fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 10 });
      fireEvent.pointerDown(toolArea, { button: 0, clientX: 100, clientY: 10 });
      fireEvent.pointerDown(toolArea, { button: 0, clientX: 100, clientY: 100 });

      dispatchMock.mockClear();
      vi.mocked(mockCtx.clearRect).mockClear();

      shortcutHandlers.get('Delete')?.();

      // Popping an anchor only redraws the draft; it is not a gesture end, so it
      // must never append a history entry.
      expect(selectionEdits()).toHaveLength(0);
      expect(mockCtx.clearRect).toHaveBeenCalled();
    });
  });
});
