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
      // Derived from the selections rather than hardcoded, because the store keeps
      // the two in step: a selection is `isActive` exactly when it is the active
      // one. A `null` next to an active selection is a state the store cannot hold,
      // and it made a click that moved nothing look like an activation — a real
      // post-state change the writer's deep-equal guard then had to commit.
      activeSelectionId: storeState.selections.find((selection) => selection.isActive)?.id ?? null,
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

/**
 * Every action type the mocked dispatch has seen, in order.
 *
 * Used to pin a whole gesture's dispatch set, so reading the types rather than
 * matching one action keeps the pin honest if an action is renamed or re-wrapped
 * — and comparing the whole list against `['COMMIT_DOCUMENT_EDIT']` fails on an
 * extra dispatch of any name, which a `not.toContain` on a single alias cannot
 * do.
 */
const dispatchedActionTypes = (): string[] =>
  (dispatchMock.mock.calls as unknown[][]).map(([action]) => (action as { type: string }).type);

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

      // The whole drag is one gesture, so the store is untouched until it ends.
      expect(selectionEdits()).toHaveLength(0);

      fireEvent.pointerUp(toolArea, { clientX: 95, clientY: 60 });

      expect(selectionEdits()).toHaveLength(1);
      // First move: +10/+15 from the press origin. Second move: +5/+5 from the
      // previous position, so the selection has travelled +15/+20 in total, and
      // `movedAtVersion` has been bumped once per move.
      expect(selectionEdits()[0].payload.updates.selections[0]).toMatchObject({
        id: 'selection-1',
        pos: { x: 24, y: 29, width: 92, height: 92 },
        points: [
          { x: 1, y: 1 },
          { x: 91, y: 1 },
          { x: 91, y: 91 },
        ],
        metadata: { movedAtVersion: 2 },
      });
    });

    it('appends one history entry for a drag of any length and dispatches nothing until the release', () => {
      storeState.selections = [committedTriangle()];
      const ctx = createMockContext();
      const toolArea = renderArea({ current: ctx }).ctx;

      fireEvent.pointerDown(toolArea, { button: 0, clientX: 80, clientY: 40 });
      for (let step = 1; step <= 5; step += 1) {
        fireEvent.pointerMove(toolArea, { clientX: 80 + step * 3, clientY: 40 + step * 2 });
        // The tripwire. A per-move dispatch is what made this gesture write
        // history once per pointer event, so its return must fail this test — and
        // naming an action type is not enough, because `StoreContext` maps both
        // `UPDATE_SELECTION` and `MOVE_SELECTION` to the same reducer arm
        // (`StoreContext.tsx:517-519`), so the per-move write can return under
        // either name with the suite green. Asserting the dispatch received
        // nothing at all is alias-immune and strictly stronger.
        expect(dispatchMock).not.toHaveBeenCalled();
        expect(selectionEdits()).toHaveLength(0);
      }
      fireEvent.pointerUp(toolArea, { clientX: 95, clientY: 50 });

      expect(selectionEdits()).toHaveLength(1);
      // The whole gesture dispatched exactly this, so the commit is the single
      // write and nothing rode along with it.
      expect(dispatchedActionTypes()).toEqual(['COMMIT_DOCUMENT_EDIT']);
      expect(selectionEdits()[0].payload.historyItem).toMatchObject({
        actionName: SELECTION_ACTION,
        id: expect.any(String),
      });
    });

    it('commits an anchor drag as a move that keeps the selection it reshaped', () => {
      storeState.selections = [committedTriangle()];
      const ctx = createMockContext();
      const toolArea = renderArea({ current: ctx }).ctx;

      // Anchor 0 sits at (10,10) in canvas space; dragging it to (60,40) re-bounds
      // the selection, which is what makes this a reshape and not a translation.
      fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 10 });
      fireEvent.pointerMove(toolArea, { clientX: 60, clientY: 40 });
      fireEvent.pointerUp(toolArea, { clientX: 60, clientY: 40 });

      expect(selectionEdits()).toHaveLength(1);
      const { updates } = selectionEdits()[0].payload;
      // The id is the committed selection's own, which is what makes this a `'move'`
      // rather than a `'create'`: a creation would mint a second selection instead of
      // replacing this one's geometry.
      expect(updates.selections).toHaveLength(1);
      expect(updates.selections[0]).toMatchObject({
        id: 'selection-1',
        isActive: true,
        pos: { x: 59, y: 9, width: 42, height: 92 },
        points: [
          { x: 1, y: 31 },
          { x: 41, y: 1 },
          { x: 41, y: 91 },
        ],
        metadata: { movedAtVersion: 1 },
      });
      expect(updates.activeSelectionId).toBe('selection-1');
      // A move leaves the `selectionCleared` repaint marker alone, exactly as the
      // reducer's `updateCommittedSelection` did. A `'create'` would clear it.
      expect(updates).not.toHaveProperty('selectionCleared');
    });

    it('commits nothing when a drag ends without a movement', () => {
      storeState.selections = [committedTriangle()];
      const ctx = createMockContext();
      const toolArea = renderArea({ current: ctx }).ctx;

      fireEvent.pointerDown(toolArea, { button: 0, clientX: 80, clientY: 40 });
      fireEvent.pointerUp(toolArea, { clientX: 80, clientY: 40 });

      // The dragged selection is value-identical to the stored one, so the
      // component's displacement gate drops the commit before the writer sees it.
      // This is deliberately asymmetric with the rectangle, whose `onChangeEnd`
      // bumps `movedAtVersion` itself and therefore appends a no-op.
      expect(selectionEdits()).toHaveLength(0);
      expect(dispatchMock).not.toHaveBeenCalled();
    });

    it('commits nothing when the only pointer moves a committed selection by zero', () => {
      storeState.selections = [committedTriangle()];
      const ctx = createMockContext();
      const toolArea = renderArea({ current: ctx }).ctx;

      // The case above fires no pointer move at all; a real click fires one or
      // more, and every one of them rebuilds the selection through a builder that
      // bumps `metadata.movedAtVersion`. So the writer's deep-equal guard cannot
      // suppress this one, which is why the gate is on GEOMETRY in the component
      // rather than on metadata in the writer.
      fireEvent.pointerDown(toolArea, { button: 0, clientX: 80, clientY: 40 });
      fireEvent.pointerMove(toolArea, { clientX: 80, clientY: 40 });
      fireEvent.pointerMove(toolArea, { clientX: 80, clientY: 40 });
      fireEvent.pointerUp(toolArea, { clientX: 80, clientY: 40 });

      expect(selectionEdits()).toHaveLength(0);
      // `COMMIT_DOCUMENT_EDIT` is the only action that flags unsaved changes, so
      // "no dispatch at all" is what "the document is not dirtied" means here:
      // clicking a selection to select it must not add an undo step or raise the
      // discard-unsaved-changes prompt.
      expect(dispatchMock).not.toHaveBeenCalled();
    });

    it('commits nothing when a drag is released where it started', () => {
      storeState.selections = [committedTriangle()];
      const ctx = createMockContext();
      const toolArea = renderArea({ current: ctx }).ctx;

      fireEvent.pointerDown(toolArea, { button: 0, clientX: 80, clientY: 40 });
      fireEvent.pointerMove(toolArea, { clientX: 95, clientY: 60 });
      // The preview tracked the drag...
      expect(ctx.moveTo).toHaveBeenCalledWith(25, 30);
      // ...and the drag came back to the origin, so the geometry is the state the
      // store never left. An entry here would describe a change that did not
      // happen, and `COMMIT_DOCUMENT_EDIT` always flags unsaved changes.
      fireEvent.pointerMove(toolArea, { clientX: 80, clientY: 40 });
      fireEvent.pointerUp(toolArea, { clientX: 80, clientY: 40 });

      expect(selectionEdits()).toHaveLength(0);
      expect(dispatchMock).not.toHaveBeenCalled();
    });

    it.each([
      [
        'a pointer leave',
        (toolArea: HTMLElement) => {
          fireEvent.pointerLeave(toolArea, { clientX: 40, clientY: 40 });
        },
      ],
      [
        'a pointer cancel',
        (toolArea: HTMLElement) => {
          fireEvent.pointerCancel(toolArea, { clientX: 40, clientY: 40 });
        },
      ],
      [
        'Escape',
        () => {
          shortcutHandlers.get('Escape')?.();
        },
      ],
    ])('abandons a moved anchor drag on %s without committing or touching the store', (_label, endDrag) => {
      storeState.selections = [committedTriangle()];
      const ctx = createMockContext();
      const toolArea = renderArea({ current: ctx }).ctx;

      fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 10 });
      fireEvent.pointerMove(toolArea, { clientX: 40, clientY: 40 });

      // Everything drawn so far is the preview, so the repaint that follows the
      // abort can only be read against a cleared mock.
      vi.mocked(ctx.moveTo).mockClear();
      vi.mocked(ctx.clearRect).mockClear();

      endDrag(toolArea);

      expect(selectionEdits()).toHaveLength(0);
      // The store is only ever written through dispatch, so this is the
      // assertion that can actually fail about the store having been left alone:
      // the abort writes nothing at all, and the one action any of the three
      // routes may emit is the draft cancel, which touches `selectionDraft`
      // alone. Comparing the mocked store object to itself proved nothing — the
      // component only ever reads it.
      expect(dispatchedActionTypes().filter((type) => type !== 'CANCEL_SELECTION_DRAFT')).toEqual([]);
      // A clear alone would leave the committed outline wiped with nothing to put
      // it back, because an abort changes no store state. The repaint is what
      // makes the dropped drag snap back instead of taking the outline with it.
      expect(ctx.clearRect).toHaveBeenCalledWith(0, 0, 800, 600);
      expect(ctx.moveTo).toHaveBeenCalledWith(10, 10);
      expect(ctx.lineTo).toHaveBeenCalledWith(100, 10);
      expect(ctx.lineTo).toHaveBeenCalledWith(100, 100);

      // The drag is over: a later move and release belong to no gesture.
      vi.mocked(ctx.moveTo).mockClear();
      fireEvent.pointerMove(toolArea, { clientX: 60, clientY: 60 });
      fireEvent.pointerUp(toolArea, { clientX: 60, clientY: 60 });
      expect(selectionEdits()).toHaveLength(0);
    });

    it('discards a displaced drag, and lets only the pointer that replaced it commit', () => {
      storeState.selections = [committedTriangle()];
      const ctx = createMockContext();
      const toolArea = renderArea({ current: ctx }).ctx;

      // Pointer 1 starts a drag on the selection and previews a move.
      fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, clientX: 80, clientY: 40 });
      fireEvent.pointerMove(toolArea, { pointerId: 1, clientX: 90, clientY: 55 });

      // Pointer 2 then presses inside the same selection. The press ends the
      // running drag rather than overwriting the ref with no commit, and it
      // hit-tests against the geometry the store is still showing — which the
      // first drag never touched — so this drag's origin is (90,55).
      fireEvent.pointerDown(toolArea, { button: 0, pointerId: 2, clientX: 90, clientY: 55 });
      vi.mocked(ctx.moveTo).mockClear();
      fireEvent.pointerMove(toolArea, { pointerId: 1, clientX: 130, clientY: 95 });

      // Pointer 1's release belongs to a drag that no longer exists, so it must
      // not commit pointer 2's gesture — and it must not consume it either.
      fireEvent.pointerUp(toolArea, { pointerId: 1, clientX: 130, clientY: 95 });
      expect(selectionEdits()).toHaveLength(0);

      // The displaced geometry is gone: the preview followed pointer 2's own
      // origin, +10/+15, and never the foreign move to (130,95).
      fireEvent.pointerMove(toolArea, { pointerId: 2, clientX: 100, clientY: 70 });
      expect(ctx.moveTo).toHaveBeenCalledWith(20, 25);

      fireEvent.pointerUp(toolArea, { pointerId: 2, clientX: 100, clientY: 70 });

      expect(selectionEdits()).toHaveLength(1);
      expect(selectionEdits()[0].payload.updates.selections[0]).toMatchObject({
        id: 'selection-1',
        pos: { x: 19, y: 24, width: 92, height: 92 },
      });
    });

    it('repaints the dragged geometry on every pointer move, not once', () => {
      storeState.selections = [committedTriangle()];
      const ctx = createMockContext();
      const toolArea = renderArea({ current: ctx }).ctx;

      fireEvent.pointerDown(toolArea, { button: 0, clientX: 80, clientY: 40 });

      vi.mocked(ctx.moveTo).mockClear();
      fireEvent.pointerMove(toolArea, { clientX: 90, clientY: 55 });
      // The dragged selection, not the stored one: its first anchor is at
      // (1,1) + pos (19,24) after a +10/+15 move.
      expect(ctx.moveTo).toHaveBeenCalledWith(20, 25);
      expect(ctx.clearRect).toHaveBeenCalledWith(0, 0, 800, 600);

      vi.mocked(ctx.moveTo).mockClear();
      fireEvent.pointerMove(toolArea, { clientX: 95, clientY: 60 });
      // A further +5/+5, so the repaint tracked the second move too. A single
      // repaint at gesture start would leave this at (10,10).
      expect(ctx.moveTo).toHaveBeenCalledWith(25, 30);
    });

    it('commits the drag as a move when the pointer is released', () => {
      storeState.selections = [committedTriangle()];
      const ctx = createMockContext();
      const toolArea = renderArea({ current: ctx }).ctx;

      fireEvent.pointerDown(toolArea, { button: 0, clientX: 80, clientY: 40 });
      fireEvent.pointerMove(toolArea, { clientX: 95, clientY: 60 });
      fireEvent.pointerUp(toolArea, { clientX: 95, clientY: 60 });

      // Release is the commit route, so this is a `'move'` and not the abandon the
      // old test name claimed. One move, one entry.
      expect(selectionEdits()).toHaveLength(1);
      expect(selectionEdits()[0].payload.updates.selections[0]).toMatchObject({
        id: 'selection-1',
        pos: { x: 24, y: 29, width: 92, height: 92 },
        metadata: { movedAtVersion: 1 },
      });
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

    it('strokes at full opacity when the shared overlay was left at a tool alpha', () => {
      const ctx = createMockContext();
      const alphaAtStroke: number[] = [];
      vi.mocked(ctx.stroke).mockImplementation(() => {
        alphaAtStroke.push(ctx.globalAlpha);
      });
      ctx.globalAlpha = 0.2;
      const toolArea = renderArea({ current: ctx }).ctx;

      fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 10 });
      fireEvent.pointerMove(toolArea, { clientX: 60, clientY: 10 });
      fireEvent.pointerMove(toolArea, { clientX: 60, clientY: 60 });

      expect(alphaAtStroke.length).toBeGreaterThan(0);
      expect(alphaAtStroke.every((alpha) => alpha === 1)).toBe(true);
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
