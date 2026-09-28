import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import type { Point, Selection } from '../../../contexts/general-types.ts';
import { pointsBoundingPos } from '../../../util/draw.ts';
import { SELECTION_ACTION } from '../../../util/constants.ts';
import { PolygonClickToolArea } from '../PolygonClickToolArea.tsx';
import type { PointerEvent as ReactPointerEvent } from 'react';

const dispatchMock = vi.hoisted(() => vi.fn());
const storeState = vi.hoisted(
  (): {
    activeSelectionId: string | null;
    selectionDraft: { status: 'idle' | 'draft'; sourceTool?: 'polygonal-lasso' | 'freehand-lasso' };
    selections: Selection[];
  } => ({
    activeSelectionId: null,
    selectionDraft: { status: 'idle' },
    selections: [],
  })
);
const currentToolState = vi.hoisted(() => ({ toolName: 'polygonal-lasso' }));
const shortcutHandlers = vi.hoisted(() => new Map<string, () => void>());
const rawShortcuts = vi.hoisted(() => new Map<string, { key: string; enabled?: boolean; onKeyDown: () => void }>());

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
  useKeyDownShortcut: (shortcut: { key: string; enabled?: boolean; onKeyDown: () => void }) => {
    // `rawShortcuts` keeps the registration object so a test can assert what the
    // hook was handed, and the mock runs on every render, so it tracks the live
    // gate as the draft's anchor mirror re-renders this component. The mocked
    // store never re-renders it on its own, so a test that needs one stands in
    // an interaction that does. `shortcutHandlers` stays a direct call into
    // `onKeyDown` so the handler itself can be exercised on its own.
    rawShortcuts.set(shortcut.key, shortcut);
    shortcutHandlers.set(shortcut.key, shortcut.onKeyDown);
  },
}));

vi.mock('../../../contexts/StoreContext.tsx', () => ({
  useStore: () => [
    {
      activeSelectionId: storeState.activeSelectionId,
      containerRef: { current: document.createElement('div') },
      history: [],
      historyIndex: -1,
      // The Backspace/Delete registrations no longer gate on this field, but a
      // test still sets it to model what a mid-draft `'move'` commit or the
      // sidebar deselect leaves in the store.
      selectionDraft: storeState.selectionDraft,
      selections: storeState.selections,
      toolOverlayRef: { current: document.createElement('canvas') },
      totalSize: { width: 800, height: 600 },
      // Explicit, so the hook derives the same frame the tool area does rather
      // than relying on an absent key.
      documentFrame: null,
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
    storeState.selectionDraft = { status: 'idle' };
    storeState.selections = [];
    currentToolState.toolName = 'polygonal-lasso';
    shortcutHandlers.clear();
    rawShortcuts.clear();
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
              pos: { x: 9, y: 9, width: 92, height: 92 },
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
      pos: { x: 9, y: 9, width: 32, height: 42 },
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
      pos: { x: 9, y: 9, width: 792, height: 592 },
      sourceTool: 'freehand-lasso',
    });
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

  it('commits a reshape when an individual anchor is dragged and the pointer is released', () => {
    storeState.activeSelectionId = 'selection-1';
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

    // The drag is overlay-only: a move writes no history, it previews one.
    expect(selectionEdits()).toHaveLength(0);

    fireEvent.pointerUp(toolArea, { clientX: 20, clientY: 20 });

    expect(selectionEdits()).toHaveLength(1);
    // The same selection id, with the dragged anchor re-bounding the selection —
    // a reshape, so `'move'` is the mode and the entry is undoable on its own.
    expect(committedSelection()).toMatchObject({
      id: 'selection-1',
      metadata: { movedAtVersion: 1 },
      pos: { x: 19, y: 9, width: 82, height: 92 },
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

    expect(selectionEdits()).toHaveLength(0);

    fireEvent.pointerUp(toolArea, { clientX: 90, clientY: 55 });

    expect(selectionEdits()).toHaveLength(1);
    expect(committedSelection()).toMatchObject({
      id: 'selection-1',
      metadata: { movedAtVersion: 1 },
      // +10/+15, applied to the origin rather than to the stored position.
      pos: { x: 19, y: 24, width: 92, height: 92 },
      points: [
        { x: 1, y: 1 },
        { x: 91, y: 1 },
        { x: 91, y: 91 },
      ],
    });
  });

  it('commits the drag on the release that follows a pointer leave', () => {
    // §34 parity. This used to be 'drops an abandoned drag when the pointer
    // leaves the surface', which pinned the OPPOSITE of the rectangle: the
    // rectangle captures its pointer, so a release outside the surface still
    // reaches `useRect` and commits, while this surface aborted on
    // `pointerleave` and the move was lost with no history entry at all. The drag
    // now takes the surface's capture on `pointerdown`, so leaving is an
    // interruption the browser follows with a release here.
    storeState.activeSelectionId = 'selection-1';
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

    fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, clientX: 80, clientY: 40 });
    fireEvent.pointerMove(toolArea, { pointerId: 1, clientX: 90, clientY: 55 });
    vi.mocked(mockCtx.moveTo).mockClear();

    fireEvent.pointerLeave(toolArea, { pointerId: 1, clientX: 90, clientY: 55 });

    // The leave is not the end of the gesture, so nothing is written yet — the
    // drag is still running and the preview still stands.
    expect(selectionEdits()).toHaveLength(0);

    fireEvent.pointerUp(toolArea, { pointerId: 1, clientX: 90, clientY: 55 });

    // The move the user watched happen commits, as one `'move'` entry. The
    // previous comment here claimed the drop "needs no rollback" because the move
    // only ever lived in the drag ref; that was true of the geometry and false
    // about the consequence — the work was gone, and no entry recorded it.
    expect(selectionEdits()).toHaveLength(1);
    expect(committedSelection()).toMatchObject({
      id: 'selection-1',
      metadata: { movedAtVersion: 1 },
      pos: { x: 19, y: 24, width: 92, height: 92 },
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

    it('dispatches nothing with Backspace or Delete when no draft is in progress', () => {
      storeState.selections = [LASSO_SELECTION];
      storeState.activeSelectionId = 'sel-1';
      const mockCtx = createMockContext();
      render(<PolygonClickToolArea overlayCtxRef={{ current: mockCtx }} className="test-lasso-area" />);

      dispatchMock.mockClear();
      shortcutHandlers.get('Backspace')?.();
      shortcutHandlers.get('Delete')?.();

      // These keys reach the whole app rather than the canvas, so with no draft
      // in progress they must leave the committed selection alone instead of
      // appending a deselect the user never asked for.
      expect(dispatchMock).not.toHaveBeenCalled();
      // Both registrations are gated on a draft as well, so the key is not even
      // consumed — no `preventDefault` and no `allowInInput`, which is what keeps
      // a Backspace inside a text field deleting the character it was aimed at.
      expect(rawShortcuts.get('Backspace')?.enabled).toBe(false);
      expect(rawShortcuts.get('Delete')?.enabled).toBe(false);
    });

    it('registers Backspace and Delete only while a draft is in progress', () => {
      const mockCtx = createMockContext();
      const { container } = render(
        <PolygonClickToolArea overlayCtxRef={{ current: mockCtx }} className="test-lasso-area" />
      );
      const toolArea = container.firstElementChild as HTMLDivElement;

      // No draft, so no anchor to pop and the keys are not even consumed.
      expect(rawShortcuts.get('Backspace')?.enabled).toBe(false);
      expect(rawShortcuts.get('Delete')?.enabled).toBe(false);

      // One click is the draft's first anchor, which is all the gate needs: the
      // handler pops while there is anything left to pop.
      fireEvent.pointerDown(toolArea, { button: 0, clientX: 400, clientY: 400 });

      // The other half of the gate: with a draft there is an anchor to pop, so
      // the keys have to be live — see the removal cases above.
      expect(rawShortcuts.get('Backspace')?.enabled).toBe(true);
      expect(rawShortcuts.get('Delete')?.enabled).toBe(true);
    });

    it('keeps Backspace and Delete live when the store draft is cleared mid-draft', () => {
      const mockCtx = createMockContext();
      const overlayCtxRef = { current: mockCtx };
      const { container, rerender } = render(
        <PolygonClickToolArea overlayCtxRef={overlayCtxRef} className="test-lasso-area" />
      );
      const toolArea = container.firstElementChild as HTMLDivElement;
      const storeRerender = () =>
        rerender(<PolygonClickToolArea overlayCtxRef={overlayCtxRef} className="test-lasso-area" />);

      // A polygonal draft of three anchors, drawn with no committed selection:
      // the tool refuses to start a draft while one is active.
      fireEvent.pointerDown(toolArea, { button: 0, clientX: 400, clientY: 400 });
      fireEvent.pointerDown(toolArea, { button: 0, clientX: 500, clientY: 400 });
      fireEvent.pointerDown(toolArea, { button: 0, clientX: 500, clientY: 500 });
      // `START_SELECTION_DRAFT` is what sets the store flag in production.
      storeState.selectionDraft = { status: 'draft', sourceTool: 'polygonal-lasso' };

      expect(rawShortcuts.get('Backspace')?.enabled).toBe(true);

      // Now a committed selection appears and the user drags it. The drag no
      // longer writes the store per pointer move: it accumulates in a ref and is
      // published once, at release, as a `'move'` commit — and that single commit
      // is what carries `selectionDraft: { status: 'idle' }` into the store while
      // the polygonal draft's own anchors are still on the overlay. The drag is
      // reachable mid-draft because `handlePointerDown` hit-tests committed
      // selections before it refuses to start a point.
      storeState.selections = [LASSO_SELECTION];
      storeState.activeSelectionId = 'sel-1';
      storeRerender();

      fireEvent.pointerDown(toolArea, { button: 0, clientX: 12, clientY: 15 });
      fireEvent.pointerMove(toolArea, { clientX: 14, clientY: 18 });
      // Mid-drag nothing has reached the store: the preview is painted from the
      // ref, so this is the gesture main deliberately made free of dispatch.
      expect(selectionEdits()).toHaveLength(0);

      fireEvent.pointerUp(toolArea, { clientX: 14, clientY: 18 });

      // One commit for the whole gesture, and it is the store's draft field
      // being closed from under the live draft.
      expect(selectionEdits()).toHaveLength(1);
      expect(selectionEdits()[0].payload.updates.selectionDraft).toEqual({ status: 'idle' });
      // The mocked store does not reduce, so apply what the real reducer would.
      storeState.selectionDraft = { status: 'idle' };
      storeRerender();

      // The gate follows the draft's own anchors, so neither this writer nor the
      // sidebar deselect can take it away while the draft is live.
      expect(rawShortcuts.get('Backspace')?.enabled).toBe(true);
      expect(rawShortcuts.get('Delete')?.enabled).toBe(true);

      // And the key still removes the anchor it was aimed at.
      dispatchMock.mockClear();
      vi.mocked(mockCtx.clearRect).mockClear();

      shortcutHandlers.get('Backspace')?.();

      expect(mockCtx.clearRect).toHaveBeenCalled();
      expect(dispatchMock).not.toHaveBeenCalled();
    });

    it('dispatches nothing with Backspace when there is neither a draft nor a selection', () => {
      const mockCtx = createMockContext();
      render(<PolygonClickToolArea overlayCtxRef={{ current: mockCtx }} className="test-lasso-area" />);

      dispatchMock.mockClear();
      shortcutHandlers.get('Backspace')?.();

      // Nothing to remove and nothing to deselect, so the document records no
      // edit: no history entry describing a change that did not happen, and no
      // edit flagging the document dirty.
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
