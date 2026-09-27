import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import type { Point, Selection } from '../../../contexts/general-types.ts';
import { pointsBoundingPos } from '../../../util/draw.ts';
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

  it('pointsBoundingPos calculates correct bounding box', () => {
    const points: Point[] = [
      { x: 10, y: 20 },
      { x: 100, y: 150 },
      { x: 50, y: 75 },
    ];

    const pos = pointsBoundingPos({ points, lineWidth: 1 });

    expect(pos.x).toBe(9); // 10 - 1
    expect(pos.y).toBe(19); // 20 - 1
    expect(pos.width).toBe(92); // 100 - 10 + 2*1
    expect(pos.height).toBe(132); // 150 - 20 + 2*1
  });

  it('pointsBoundingPos handles single point', () => {
    const points: Point[] = [{ x: 50, y: 50 }];
    const pos = pointsBoundingPos({ points, lineWidth: 2 });

    expect(pos.x).toBe(48); // 50 - 2
    expect(pos.y).toBe(48); // 50 - 2
    expect(pos.width).toBe(4); // 0 + 2*2
    expect(pos.height).toBe(4); // 0 + 2*2
  });

  it('pointsBoundingPos handles negative coordinates', () => {
    const points: Point[] = [
      { x: -100, y: -50 },
      { x: 100, y: 50 },
    ];

    const pos = pointsBoundingPos({ points, lineWidth: 5 });

    expect(pos.x).toBe(-105); // -100 - 5
    expect(pos.y).toBe(-55); // -50 - 5
    expect(pos.width).toBe(210); // 200 + 2*5
    expect(pos.height).toBe(110); // 100 + 2*5
  });

  it('pointsBoundingPos handles large line widths', () => {
    const points: Point[] = [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
    ];

    const pos = pointsBoundingPos({ points, lineWidth: 20 });

    expect(pos.x).toBe(-20);
    expect(pos.y).toBe(-20);
    expect(pos.width).toBe(50); // 10 + 2*20
    expect(pos.height).toBe(50); // 10 + 2*20
  });

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
    expect(dispatchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'COMMIT_SELECTION',
        payload: expect.objectContaining({
          geometry: 'polygon',
          lifecycle: 'committed',
          sourceTool: 'polygonal-lasso',
          points: [
            { x: 1, y: 1 },
            { x: 91, y: 1 },
            { x: 91, y: 91 },
          ],
          pos: { x: 9, y: 9, width: 92, height: 92 },
        }),
      })
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
    expect(dispatchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'COMMIT_SELECTION',
        payload: expect.objectContaining({
          geometry: 'polygon',
          lifecycle: 'committed',
          sourceTool: 'freehand-lasso',
          points: [
            { x: 1, y: 1 },
            { x: 21, y: 11 },
            { x: 31, y: 41 },
          ],
          pos: { x: 9, y: 9, width: 32, height: 42 },
        }),
      })
    );
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
    expect(dispatchMock).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'COMMIT_SELECTION' }));
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

    expect(dispatchMock).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'COMMIT_SELECTION' }));
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

    expect(dispatchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'COMMIT_SELECTION',
        payload: expect.objectContaining({
          points: [
            { x: 1, y: 1 },
            { x: 791, y: 591 },
            { x: 391, y: 291 },
          ],
          pos: { x: 9, y: 9, width: 792, height: 592 },
          sourceTool: 'freehand-lasso',
        }),
      })
    );
  });

  it('draws active committed selections from store state so the lasso stays visible after finishing', () => {
    storeState.selections = [
      {
        id: 'selection-1',
        isActive: true,
        pos: { x: 9, y: 9, width: 92, height: 92 },
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

  it('updates an active committed anchor when dragging an individual point', () => {
    storeState.selections = [
      {
        id: 'selection-1',
        isActive: true,
        pos: { x: 9, y: 9, width: 92, height: 92 },
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

    expect(dispatchMock).toHaveBeenCalledWith({
      type: 'UPDATE_SELECTION',
      payload: expect.objectContaining({
        id: 'selection-1',
        metadata: { movedAtVersion: 1 },
        pos: { x: 19, y: 9, width: 82, height: 92 },
        points: [
          { x: 1, y: 11 },
          { x: 81, y: 1 },
          { x: 81, y: 91 },
        ],
      }),
    });
  });

  it('moves the whole active committed selection when dragging inside the polygon', () => {
    storeState.selections = [
      {
        id: 'selection-1',
        isActive: true,
        pos: { x: 9, y: 9, width: 92, height: 92 },
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

    expect(dispatchMock).toHaveBeenCalledWith({
      type: 'UPDATE_SELECTION',
      payload: expect.objectContaining({
        id: 'selection-1',
        metadata: { movedAtVersion: 1 },
        pos: { x: 19, y: 24, width: 92, height: 92 },
        points: [
          { x: 1, y: 1 },
          { x: 91, y: 1 },
          { x: 91, y: 91 },
        ],
      }),
    });
  });

  it('changes cursor when hovering a committed anchor point', () => {
    storeState.selections = [
      {
        id: 'selection-1',
        isActive: true,
        pos: { x: 9, y: 9, width: 92, height: 92 },
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
        pos: { x: 9, y: 9, width: 92, height: 92 },
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

      expect(dispatchMock).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'COMMIT_SELECTION' }));
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

      expect(dispatchMock).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'COMMIT_SELECTION',
          payload: expect.objectContaining({
            geometry: 'polygon',
            sourceTool: 'polygonal-lasso',
          }),
        })
      );
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

      expect(dispatchMock).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'COMMIT_SELECTION',
          payload: expect.objectContaining({
            geometry: 'polygon',
            sourceTool: 'freehand-lasso',
          }),
        })
      );
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

      expect(dispatchMock).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'COMMIT_SELECTION' }));
      expect(mockCtx.clearRect).toHaveBeenCalled();
    });
  });
});
