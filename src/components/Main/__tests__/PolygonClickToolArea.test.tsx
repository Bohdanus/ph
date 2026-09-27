import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { Selection } from '../../../contexts/general-types.ts';
import { SELECTION_ACTION } from '../../../util/constants.ts';
import { PolygonClickToolArea } from '../PolygonClickToolArea.tsx';

const dispatchMock = vi.hoisted(() => vi.fn());
const storeState = vi.hoisted(
  (): { selections: Selection[]; documentFrame: { x: number; y: number; width: number; height: number } | null } => ({
    selections: [],
    documentFrame: null,
  })
);
const toolState = vi.hoisted((): { toolArgs: { toolName?: string } | null } => ({
  toolArgs: { toolName: 'polygonal-lasso' },
}));
const shortcutHandlers = vi.hoisted(() => new Map<string, () => void>());

vi.mock('../../../hooks/usePointerPosition.ts', () => ({
  usePointerPosition: () => ({
    getLocalCoords: (event: ReactPointerEvent<HTMLElement>) => ({ x: event.clientX, y: event.clientY }),
  }),
}));

vi.mock('../../../hooks/useKeyboardEvents.tsx', () => ({
  useKeyDownShortcut: (shortcut: { key: string; onKeyDown: () => void }) => {
    shortcutHandlers.set(shortcut.key, shortcut.onKeyDown);
  },
}));

/**
 * The polygon commit is routed through `useSelectionHistory`, which reads the
 * selection baseline AND the legacy append point (`history`/`historyIndex`) off
 * the same store tuple this tool area reads, so the mock carries every field the
 * single-writer hook destructures — a missing `activeSelectionId` would arrive as
 * `undefined` inside the recorded `previousSelectionState`, and a missing
 * `history` would make `planHistoryAppend` throw and drop every test onto the
 * hook's failure fallback instead of its real success path.
 */
vi.mock('../../../contexts/StoreContext.tsx', () => ({
  useStore: () => [
    {
      activeSelectionId: null,
      containerRef: { current: document.createElement('div') },
      selections: storeState.selections,
      totalSize: { width: 800, height: 600 },
      documentFrame: storeState.documentFrame,
      // An empty timeline at cursor -1 is what a store with nothing appended yet
      // actually looks like, and `planHistoryAppend` reports the out-of-range
      // cursor as a diagnostic rather than refusing the edit.
      history: [],
      historyIndex: -1,
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

const committedTriangle = (overrides: Partial<Selection> = {}): Selection =>
  ({
    id: 'selection-1',
    isActive: true,
    geometry: 'polygon',
    sourceTool: 'polygonal-lasso',
    lifecycle: 'committed',
    pos: { x: 9, y: 9, width: 92, height: 92 },
    points: [
      { x: 1, y: 1 },
      { x: 91, y: 1 },
      { x: 91, y: 91 },
    ],
    ...overrides,
  }) as Selection;

function renderArea(overlayCtxRef: { current: CanvasRenderingContext2D | null }) {
  const { container, unmount } = render(
    <PolygonClickToolArea overlayCtxRef={overlayCtxRef} className="test-polygon-click-area" />
  );
  return { ctx: container.firstElementChild as HTMLDivElement, unmount };
}

/**
 * A polygon commit is no longer a raw `COMMIT_SELECTION`: it is a document edit
 * that appends to history, so a drawn selection is undoable on its own instead of
 * surviving only as the `previousSelectionState` of whatever clears it later. The
 * contract is ONE `COMMIT_DOCUMENT_EDIT` carrying both the history item and the
 * resulting selection state, which is what the hook's `committedSelectionUpdate`
 * derived — the raw action is no longer dispatched, so `updates.selections` IS
 * the store state.
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

/**
 * The `COMMIT_DOCUMENT_EDIT` actions the mocked dispatch received.
 *
 * `durableEntry` is deliberately not part of the pin: the store publishes the
 * planned entry only when its durable document still describes the timeline the
 * plan was made against, and the append boundary's failure fallback omits it
 * entirely — both are correct. `id` and the selection `id` are fresh uuids per
 * call, so they are matched as `expect.any(String)` or compared for equality.
 */
const selectionEdits = (): SelectionEdit[] =>
  (dispatchMock.mock.calls as unknown[][])
    .map(([action]) => action as SelectionEdit)
    .filter((action) => action.type === 'COMMIT_DOCUMENT_EDIT');

/** The single selection a `COMMIT_DOCUMENT_EDIT` published, which is the drawn polygon. */
const committedSelection = (): Selection => selectionEdits()[0].payload.updates.selections[0];

describe('PolygonClickToolArea', () => {
  beforeEach(() => {
    dispatchMock.mockClear();
    shortcutHandlers.clear();
    storeState.selections = [];
    storeState.documentFrame = null;
    toolState.toolArgs = { toolName: 'polygonal-lasso' };
  });

  describe('adding vertices', () => {
    it('appends one vertex per primary click and draws an anchor per vertex', () => {
      const ctx = createMockContext();
      const toolArea = renderArea({ current: ctx }).ctx;

      fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 10 });
      fireEvent.pointerDown(toolArea, { button: 0, clientX: 100, clientY: 10 });
      fireEvent.pointerDown(toolArea, { button: 0, clientX: 100, clientY: 100 });

      expect(dispatchMock).toHaveBeenCalledTimes(1);
      expect(dispatchMock).toHaveBeenCalledWith({
        type: 'START_SELECTION_DRAFT',
        payload: { sourceTool: 'polygonal-lasso' },
      });
      // Only the first click opens the draft; later clicks must not re-dispatch it.
      expect(ctx.moveTo).toHaveBeenCalledWith(10, 10);
      expect(ctx.lineTo).toHaveBeenCalledWith(100, 10);
      expect(ctx.lineTo).toHaveBeenCalledWith(100, 100);
    });

    it('ignores non-primary mouse buttons', () => {
      const ctx = createMockContext();
      const toolArea = renderArea({ current: ctx }).ctx;

      fireEvent.pointerDown(toolArea, { button: 2, clientX: 10, clientY: 10 });
      fireEvent.pointerDown(toolArea, { button: 1, clientX: 20, clientY: 20 });

      expect(dispatchMock).not.toHaveBeenCalled();
      expect(ctx.lineTo).not.toHaveBeenCalled();
    });

    it('treats a missing tool name as the polygonal tool', () => {
      toolState.toolArgs = {};
      const ctx = createMockContext();
      const toolArea = renderArea({ current: ctx }).ctx;

      fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 10 });
      fireEvent.pointerDown(toolArea, { button: 0, clientX: 100, clientY: 10 });
      fireEvent.pointerDown(toolArea, { button: 0, clientX: 100, clientY: 100 });

      expect(dispatchMock).toHaveBeenCalledWith({
        type: 'START_SELECTION_DRAFT',
        payload: { sourceTool: 'polygonal-lasso' },
      });
    });
  });

  describe('closing the polygon', () => {
    it('closes the polygon on right click', () => {
      const ctx = createMockContext();
      const toolArea = renderArea({ current: ctx }).ctx;

      fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 10 });
      fireEvent.pointerDown(toolArea, { button: 0, clientX: 100, clientY: 10 });
      fireEvent.pointerDown(toolArea, { button: 0, clientX: 100, clientY: 100 });
      fireEvent.contextMenu(toolArea);

      expect(selectionEdits()).toHaveLength(1);
      expect(selectionEdits()[0]).toMatchObject({
        type: 'COMMIT_DOCUMENT_EDIT',
        payload: {
          historyItem: { actionName: SELECTION_ACTION, id: expect.any(String) },
          // The visible half of the same transition. `selectionDraft` and
          // `selectionCleared` are asserted because they are the other two fields
          // the raw `COMMIT_SELECTION` reducer arm moved, so leaving them out
          // would let the hook silently stop resetting the draft or repainting
          // the overlay.
          updates: {
            selectionCleared: null,
            selectionDraft: { status: 'idle' },
            selections: [
              expect.objectContaining({
                geometry: 'polygon',
                lifecycle: 'committed',
                isActive: true,
                sourceTool: 'polygonal-lasso',
              }),
            ],
          },
        },
      });
      // The pointer maps to exactly the appended selection, which is what
      // activates it: the two uuids cannot be pinned literally, their equality can.
      expect(selectionEdits()[0].payload.updates.activeSelectionId).toBe(
        selectionEdits()[0].payload.updates.selections[0].id
      );
    });

    it('refuses to close below the three-vertex minimum on right click', () => {
      const ctx = createMockContext();
      const toolArea = renderArea({ current: ctx }).ctx;

      fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 10 });
      fireEvent.pointerDown(toolArea, { button: 0, clientX: 100, clientY: 10 });
      fireEvent.contextMenu(toolArea);

      // A polygon below the minimum never reaches the commit point, so it
      // appends no history entry describing a change that did not happen.
      expect(selectionEdits()).toHaveLength(0);
      // The draft survives a rejected close so the user can keep adding vertices.
      expect(dispatchMock).not.toHaveBeenCalledWith({ type: 'CANCEL_SELECTION_DRAFT' });
    });

    it('refuses to close below the three-vertex minimum on Enter', () => {
      const ctx = createMockContext();
      const toolArea = renderArea({ current: ctx }).ctx;

      fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 10 });
      fireEvent.pointerDown(toolArea, { button: 0, clientX: 100, clientY: 10 });

      shortcutHandlers.get('Enter')?.();

      expect(selectionEdits()).toHaveLength(0);
    });

    it('maps canvas vertices into document space using a non-zero document frame', () => {
      storeState.documentFrame = { x: 4, y: 6, width: 800, height: 600 };
      const ctx = createMockContext();
      const toolArea = renderArea({ current: ctx }).ctx;

      fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 10 });
      fireEvent.pointerDown(toolArea, { button: 0, clientX: 100, clientY: 10 });
      fireEvent.pointerDown(toolArea, { button: 0, clientX: 100, clientY: 100 });
      fireEvent.contextMenu(toolArea);

      expect(committedSelection()).toMatchObject({
        pos: { x: 13, y: 15, width: 92, height: 92 },
        points: [
          { x: 1, y: 1 },
          { x: 91, y: 1 },
          { x: 91, y: 91 },
        ],
      });
    });

    it('appends exactly one history entry for a multi-click polygonal gesture', () => {
      const ctx = createMockContext();
      const toolArea = renderArea({ current: ctx }).ctx;

      // Six anchors, each far enough from the last that none of them reads as the
      // double-click close, so the whole run is one unfinished gesture.
      for (const [x, y] of [
        [10, 10],
        [100, 10],
        [100, 100],
        [10, 100],
        [200, 100],
        [200, 200],
      ]) {
        fireEvent.pointerDown(toolArea, { button: 0, clientX: x, clientY: y });
        // Pointer moves during the gesture must stay transient: they update the
        // preview only and may never append a history entry.
        fireEvent.pointerMove(toolArea, { clientX: x + 5, clientY: y + 5 });
        expect(selectionEdits()).toHaveLength(0);
      }

      shortcutHandlers.get('Enter')?.();

      expect(selectionEdits()).toHaveLength(1);
      expect(selectionEdits()[0].payload.historyItem).toMatchObject({
        actionName: SELECTION_ACTION,
        id: expect.any(String),
      });
      // Exactly the one commit, over every anchor the gesture accumulated.
      expect(committedSelection().points).toHaveLength(6);
    });
  });

  describe('close hint near the first vertex', () => {
    it('shows a pointer cursor and the green closing marker inside the snap radius', () => {
      const ctx = createMockContext();
      const toolArea = renderArea({ current: ctx }).ctx;

      fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 10 });
      fireEvent.pointerDown(toolArea, { button: 0, clientX: 100, clientY: 10 });
      fireEvent.pointerDown(toolArea, { button: 0, clientX: 100, clientY: 100 });

      fireEvent.pointerMove(toolArea, { clientX: 15, clientY: 12 });

      expect(toolArea.style.cursor).toBe('pointer');
      expect(ctx.arc).toHaveBeenCalledWith(10, 10, 7, 0, Math.PI * 2);
    });

    it('keeps the crosshair cursor outside the snap radius', () => {
      const ctx = createMockContext();
      const toolArea = renderArea({ current: ctx }).ctx;

      fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 10 });
      fireEvent.pointerDown(toolArea, { button: 0, clientX: 100, clientY: 10 });
      fireEvent.pointerDown(toolArea, { button: 0, clientX: 100, clientY: 100 });

      fireEvent.pointerMove(toolArea, { clientX: 150, clientY: 150 });

      expect(toolArea.style.cursor).toBe('crosshair');
      expect(ctx.arc).not.toHaveBeenCalledWith(10, 10, 7, 0, Math.PI * 2);
    });

    it('never offers the closing hint below the three-vertex minimum', () => {
      const ctx = createMockContext();
      const toolArea = renderArea({ current: ctx }).ctx;

      fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 10 });
      fireEvent.pointerDown(toolArea, { button: 0, clientX: 100, clientY: 10 });

      fireEvent.pointerMove(toolArea, { clientX: 11, clientY: 11 });

      expect(toolArea.style.cursor).toBe('crosshair');
    });
  });

  describe('committed selection interaction', () => {
    it('offers a move cursor inside a committed selection but away from its anchors', () => {
      storeState.selections = [committedTriangle()];
      const ctx = createMockContext();
      const toolArea = renderArea({ current: ctx }).ctx;

      fireEvent.pointerMove(toolArea, { clientX: 80, clientY: 40 });

      expect(toolArea.style.cursor).toBe('move');
    });

    it('ignores an inactive committed selection for both hover and drag', () => {
      storeState.selections = [committedTriangle({ isActive: false })];
      const ctx = createMockContext();
      const toolArea = renderArea({ current: ctx }).ctx;

      fireEvent.pointerMove(toolArea, { clientX: 10, clientY: 10 });
      expect(toolArea.style.cursor).toBe('crosshair');

      fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 10 });

      expect(dispatchMock).toHaveBeenCalledWith({
        type: 'START_SELECTION_DRAFT',
        payload: { sourceTool: 'polygonal-lasso' },
      });
    });

    it('accumulates consecutive selection drags relative to the previous move', () => {
      storeState.selections = [committedTriangle()];
      const ctx = createMockContext();
      const toolArea = renderArea({ current: ctx }).ctx;

      fireEvent.pointerDown(toolArea, { button: 0, clientX: 80, clientY: 40 });
      fireEvent.pointerMove(toolArea, { clientX: 90, clientY: 55 });
      fireEvent.pointerMove(toolArea, { clientX: 95, clientY: 60 });

      const updates = dispatchMock.mock.calls.filter(
        ([action]) => (action as { type: string }).type === 'UPDATE_SELECTION'
      );
      expect(updates).toHaveLength(2);
      // First move: +10/+15 from the press origin. Second move: +5/+5 from the
      // previous position, so the selection has travelled +15/+20 in total.
      expect(updates[1][0]).toMatchObject({
        payload: {
          pos: { x: 24, y: 29, width: 92, height: 92 },
          points: [
            { x: 1, y: 1 },
            { x: 91, y: 1 },
            { x: 91, y: 91 },
          ],
        },
      });
    });

    it('abandons an anchor drag when the pointer leaves the surface', () => {
      storeState.selections = [committedTriangle()];
      const ctx = createMockContext();
      const toolArea = renderArea({ current: ctx }).ctx;

      fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 10 });
      fireEvent.pointerLeave(toolArea, { clientX: 10, clientY: 10 });
      fireEvent.pointerMove(toolArea, { clientX: 40, clientY: 40 });

      expect(dispatchMock).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'UPDATE_SELECTION' }));
    });

    it('abandons a selection drag when the pointer is released', () => {
      storeState.selections = [committedTriangle()];
      const ctx = createMockContext();
      const toolArea = renderArea({ current: ctx }).ctx;

      fireEvent.pointerDown(toolArea, { button: 0, clientX: 80, clientY: 40 });
      fireEvent.pointerUp(toolArea, { button: 0, clientX: 80, clientY: 40 });
      fireEvent.pointerMove(toolArea, { clientX: 95, clientY: 60 });

      expect(dispatchMock).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'UPDATE_SELECTION' }));
    });
  });

  describe('freehand mode', () => {
    beforeEach(() => {
      toolState.toolArgs = { toolName: 'freehand-lasso' };
    });

    it('ignores non-primary mouse buttons', () => {
      const ctx = createMockContext();
      const toolArea = renderArea({ current: ctx }).ctx;

      fireEvent.pointerDown(toolArea, { button: 2, clientX: 10, clientY: 10 });

      expect(dispatchMock).not.toHaveBeenCalled();
    });

    it('finishes the selection when the pointer leaves instead of being released', () => {
      const ctx = createMockContext();
      const toolArea = renderArea({ current: ctx }).ctx;

      fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 10 });
      fireEvent.pointerMove(toolArea, { clientX: 30, clientY: 20 });
      fireEvent.pointerMove(toolArea, { clientX: 40, clientY: 50 });
      fireEvent.pointerLeave(toolArea, { clientX: 40, clientY: 50 });

      expect(selectionEdits()).toHaveLength(1);
      expect(committedSelection()).toMatchObject({ sourceTool: 'freehand-lasso', isActive: true });
    });

    it('cancels the draft on pointer cancel', () => {
      const ctx = createMockContext();
      const toolArea = renderArea({ current: ctx }).ctx;

      fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 10 });
      fireEvent.pointerMove(toolArea, { clientX: 30, clientY: 20 });
      fireEvent.pointerCancel(toolArea, { clientX: 30, clientY: 20 });

      expect(dispatchMock).toHaveBeenCalledWith({ type: 'CANCEL_SELECTION_DRAFT' });
      expect(selectionEdits()).toHaveLength(0);
    });

    it('does not cancel anything when pointer cancel arrives without an active draft', () => {
      const ctx = createMockContext();
      const toolArea = renderArea({ current: ctx }).ctx;

      fireEvent.pointerCancel(toolArea, { clientX: 30, clientY: 20 });

      expect(dispatchMock).not.toHaveBeenCalled();
    });

    it('drops samples that sit under the minimum point distance', () => {
      const ctx = createMockContext();
      const toolArea = renderArea({ current: ctx }).ctx;

      fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 10 });
      vi.mocked(ctx.clearRect).mockClear();

      fireEvent.pointerMove(toolArea, { clientX: 10, clientY: 10 });
      expect(ctx.clearRect).not.toHaveBeenCalled();

      fireEvent.pointerMove(toolArea, { clientX: 10, clientY: 11 });
      expect(ctx.clearRect).not.toHaveBeenCalled();

      fireEvent.pointerMove(toolArea, { clientX: 10, clientY: 12 });
      expect(ctx.clearRect).toHaveBeenCalled();
    });

    it('previews the automatic closing edge as a dashed line back to the first point', () => {
      const ctx = createMockContext();
      const toolArea = renderArea({ current: ctx }).ctx;

      fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 10 });
      fireEvent.pointerMove(toolArea, { clientX: 60, clientY: 10 });
      fireEvent.pointerMove(toolArea, { clientX: 60, clientY: 60 });

      expect(ctx.setLineDash).toHaveBeenCalledWith([4, 4]);
      expect(ctx.moveTo).toHaveBeenCalledWith(60, 60);
      expect(ctx.lineTo).toHaveBeenCalledWith(10, 10);
    });

    it('draws only the start and end handles for a long freehand path', () => {
      const ctx = createMockContext();
      const toolArea = renderArea({ current: ctx }).ctx;

      fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 10 });
      fireEvent.pointerMove(toolArea, { clientX: 60, clientY: 10 });
      fireEvent.pointerMove(toolArea, { clientX: 60, clientY: 60 });
      vi.mocked(ctx.arc).mockClear();

      fireEvent.pointerMove(toolArea, { clientX: 20, clientY: 60 });

      // Two anchors only (start radius 5, end radius 3) — never one per sampled point.
      expect(ctx.arc).toHaveBeenCalledTimes(2);
    });

    it('never exposes the close hint cursor while freehand drawing is active', () => {
      const ctx = createMockContext();
      const toolArea = renderArea({ current: ctx }).ctx;

      fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 10 });
      fireEvent.pointerMove(toolArea, { clientX: 11, clientY: 10 });

      expect(toolArea.style.cursor).toBe('');
    });
  });

  describe('lifecycle', () => {
    it('clears the overlay on unmount', () => {
      const ctx = createMockContext();
      const { ctx: toolArea, unmount } = renderArea({ current: ctx });

      fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 10 });
      vi.mocked(ctx.clearRect).mockClear();

      unmount();

      expect(ctx.clearRect).toHaveBeenCalledWith(0, 0, 800, 600);
    });

    it('still tracks and dispatches the draft when no overlay context exists', () => {
      const toolArea = renderArea({ current: null }).ctx;

      expect(() => {
        fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 10 });
        fireEvent.pointerDown(toolArea, { button: 0, clientX: 100, clientY: 10 });
        fireEvent.pointerDown(toolArea, { button: 0, clientX: 100, clientY: 100 });
        fireEvent.contextMenu(toolArea);
      }).not.toThrow();

      expect(selectionEdits()).toHaveLength(1);
    });

    it('applies the class name and the crosshair cursor to the surface', () => {
      const toolArea = renderArea({ current: createMockContext() }).ctx;

      expect(toolArea).toHaveClass('test-polygon-click-area');
      expect(toolArea).toHaveClass('cursor-crosshair');
      expect(toolArea).toHaveStyle({ userSelect: 'none' });
    });
  });
});
