import { act, fireEvent, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UseRectProps } from '../../../hooks/useRect.ts';
import type { Selection } from '../../../contexts/general-types.ts';
import { SELECTION_ACTION } from '../../../util/constants.ts';
import { isDocumentGestureOpen, readDocumentGesture, resetDocumentGestures } from '../../../hooks/document-gesture.ts';
import { RectangularSelectionToolArea } from '../RectangularSelectionToolArea.tsx';

const dispatchMock = vi.hoisted(() => vi.fn());
const storeState = vi.hoisted((): { selections: Selection[]; activeSelectionId: string | null } => ({
  selections: [],
  activeSelectionId: null,
}));
const useRectProps = vi.hoisted((): { current: UseRectProps | null } => ({ current: null }));
const useRectPointerDownMock = vi.hoisted(() => vi.fn(() => false));
/**
 * `isMouseDown` is part of what `useRect` returns, and the component reads it
 * BEFORE delegating, to tell a press that starts a gesture from one `useRect`
 * refuses (a non-primary button, or a second pointer while one is already down).
 */
const useRectIsMouseDown = vi.hoisted(() => ({ current: false }));

/**
 * The rectangle commit is routed through `useSelectionHistory`, which reads the
 * selection baseline AND the legacy append point (`history`/`historyIndex`) off
 * the same store tuple the tool area reads, so the mock carries every field the
 * single-writer hook destructures.
 */
vi.mock('../../../contexts/StoreContext.tsx', () => ({
  useStore: () => [
    {
      containerRef: { current: document.createElement('div') },
      toolOverlayRef: { current: document.createElement('canvas') },
      totalSize: { width: 800, height: 600 },
      selections: storeState.selections,
      activeSelectionId: storeState.activeSelectionId,
      history: [],
      historyIndex: 0,
      // Non-zero on purpose: a zero-origin frame makes document and canvas
      // coordinates identical, so a conversion that dropped the offset would
      // still satisfy every assertion in this file.
      documentFrame: { x: 30, y: 40, width: 800, height: 600 },
    },
    dispatchMock,
  ],
}));

vi.mock('../../../hooks/useRect.ts', () => ({
  useRect: (props: UseRectProps) => {
    useRectProps.current = props;

    return {
      isMouseDown: useRectIsMouseDown,
      onPointerDown: useRectPointerDownMock,
      onPointerMove: vi.fn(),
      onPointerUp: vi.fn(),
    };
  },
}));

/**
 * A rectangle draw is no longer a raw `COMMIT_SELECTION`: it is a document edit
 * that appends to history, so the drawn selection is undoable on its own. The
 * contract is one `COMMIT_DOCUMENT_EDIT` carrying both the history item and the
 * resulting selection state.
 *
 * `durableEntry` is deliberately not part of the pin: the store publishes the
 * planned entry only when its durable document still describes the timeline the
 * plan was made against, and the boundary's failure fallback omits it entirely —
 * both are correct, so the pin asserts the contract the two paths share.
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
 * `updates.activeSelectionId` cannot be pinned to a literal for a draw, because
 * the selection id is a fresh uuid minted per call. What is a real contract is the
 * linkage between the pointer and the selection it points at, so the test reads
 * both values off the dispatched action and compares them.
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

describe('RectangularSelectionToolArea', () => {
  beforeEach(() => {
    dispatchMock.mockClear();
    useRectPointerDownMock.mockReset();
    useRectPointerDownMock.mockReturnValue(false);
    useRectIsMouseDown.current = false;
    storeState.selections = [];
    storeState.activeSelectionId = null;
    useRectProps.current = null;
  });

  it('commits a normalized rectangular selection when drawing completes', () => {
    const { container } = render(<RectangularSelectionToolArea className="test-rectangular-selection-area" />);
    const toolArea = container.firstElementChild as HTMLDivElement;

    fireEvent.pointerDown(toolArea, { button: 0, clientX: 20, clientY: 10 });
    act(() => {
      useRectProps.current!.onChangeEnd({ x1: 20, y1: 10, x2: 100, y2: 60 });
    });

    expect(dispatchMock).toHaveBeenNthCalledWith(1, {
      type: 'START_SELECTION_DRAFT',
      payload: { sourceTool: 'rectangular-selection' },
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
            // Exactly one selection, appended and normalised: the raw
            // `COMMIT_SELECTION` payload used to carry these fields itself.
            selections: [
              expect.objectContaining({
                geometry: 'rectangle',
                lifecycle: 'committed',
                isActive: true,
                sourceTool: 'rectangular-selection',
                // 20,10 -> 100,60 in canvas space is 50,50 -> 130,100 in
                // document space once the frame origin is added.
                pos: { x: 50, y: 50, width: 80, height: 50 },
                points: [
                  { x: 0, y: 0 },
                  { x: 80, y: 0 },
                  { x: 80, y: 50 },
                  { x: 0, y: 50 },
                ],
              }),
            ],
          }),
        }),
      })
    );
    // The appended selection is the active one, so a draw is what activates what
    // it drew. Both ids are per-call uuids, so only their equality is pinnable.
    const draw = singleSelectionEdit();
    expect(draw.payload.updates.activeSelectionId).toBe(draw.payload.updates.selections[0].id);
  });

  it('hydrates the rectangular overlay from the active committed rectangle selection', () => {
    storeState.activeSelectionId = 'selection-1';
    storeState.selections = [
      {
        id: 'selection-1',
        geometry: 'rectangle',
        sourceTool: 'rectangular-selection',
        lifecycle: 'committed',
        isActive: true,
        pos: { x: 10, y: 20, width: 30, height: 40 },
        points: [
          { x: 0, y: 0 },
          { x: 30, y: 0 },
          { x: 30, y: 40 },
          { x: 0, y: 40 },
        ],
      },
    ];

    render(<RectangularSelectionToolArea className="test-rectangular-selection-area" />);

    // The stored selection is in document space and the rect handle is in canvas
    // space, so the 10,20 origin sits 30,40 further along the canvas axis.
    expect(useRectProps.current!.initialRect).toEqual({ x1: -20, y1: -20, x2: 10, y2: 20 });
  });

  it('updates an active committed rectangle instead of storing moved geometry in tool args', () => {
    useRectPointerDownMock.mockReturnValue(true);
    storeState.activeSelectionId = 'selection-1';
    storeState.selections = [
      {
        id: 'selection-1',
        geometry: 'rectangle',
        sourceTool: 'rectangular-selection',
        lifecycle: 'committed',
        isActive: true,
        metadata: { copiedAtVersion: 2 },
        pos: { x: 10, y: 20, width: 30, height: 40 },
        points: [
          { x: 0, y: 0 },
          { x: 30, y: 0 },
          { x: 30, y: 40 },
          { x: 0, y: 40 },
        ],
      },
    ];

    const { container } = render(<RectangularSelectionToolArea className="test-rectangular-selection-area" />);
    const toolArea = container.firstElementChild as HTMLDivElement;

    fireEvent.pointerDown(toolArea, { button: 0, clientX: 15, clientY: 25 });
    act(() => {
      useRectProps.current!.onChangeEnd({ x1: 20, y1: 30, x2: 50, y2: 70 });
    });

    expect(dispatchMock).not.toHaveBeenCalledWith({
      type: 'START_SELECTION_DRAFT',
      payload: { sourceTool: 'rectangular-selection' },
    });
    // A drag over a committed selection is `'move'`: it replaces that selection's
    // geometry in place, so there is still exactly one selection and it keeps its
    // id. The old raw `MOVE_SELECTION` payload used to carry the geometry.
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
                id: 'selection-1',
                geometry: 'rectangle',
                lifecycle: 'committed',
                isActive: true,
                sourceTool: 'rectangular-selection',
                // 20,30 -> 50,70 in canvas space is 50,70 -> 80,110 in
                // document space once the frame origin is added.
                pos: { x: 50, y: 70, width: 30, height: 40 },
                points: [
                  { x: 0, y: 0 },
                  { x: 30, y: 0 },
                  { x: 30, y: 40 },
                  { x: 0, y: 40 },
                ],
                metadata: { copiedAtVersion: 2, movedAtVersion: 1 },
              }),
            ],
            activeSelectionId: 'selection-1',
          }),
        }),
      })
    );
    // The moved geometry lives only in the document edit. A drag dispatches
    // nothing else — no draft, and no write of the live rect into the tool args —
    // so one call is the whole gesture.
    expect(dispatchMock).toHaveBeenCalledTimes(1);
  });

  /**
   * §47: the rectangle is the gesture the keyboard race is reachable on, because
   * it is the one that opens a draft on `pointerdown` and commits from
   * `useRect.handlePointerUp` — a real time boundary. An undo/redo in that window
   * replaces `selections` from the SAME `history` array, so `history.length` never
   * moves and the pending commit's `entries.slice(0, cursor + 1)` then truncates
   * the redo tail with no other symptom. The fix is at the input layer, so what is
   * pinned here is the claim this surface takes and every route that gives it
   * back — a gate with no cancel route is worse than no gate, because the claim
   * would outlive the gesture and the keyboard would stay dead.
   */
  describe('document gesture gate', () => {
    beforeEach(() => {
      // The slot is module-level, so a leaked claim would refuse every later
      // claim in this file and read as a dozen unrelated failures.
      resetDocumentGestures();
    });

    it('claims the document on the press that opens a draft, and releases it when the drag commits', () => {
      const { container } = render(<RectangularSelectionToolArea className="test-rectangular-selection-area" />);
      const toolArea = container.firstElementChild as HTMLDivElement;

      fireEvent.pointerDown(toolArea, { button: 0, pointerId: 4, clientX: 20, clientY: 10 });

      // Held for the whole drag, which is the window a document-mutating
      // shortcut must not reach.
      expect(isDocumentGestureOpen()).toBe(true);
      expect(readDocumentGesture()).toEqual({ kind: 'rectangular-selection', pointerId: 4 });

      act(() => {
        useRectProps.current!.onChangeEnd({ x1: 20, y1: 10, x2: 100, y2: 60 });
      });

      // Released by the time `commitSelection` appends, so the keyboard is open
      // again for the entry this gesture just wrote.
      expect(isDocumentGestureOpen()).toBe(false);
      expect(singleSelectionEdit().payload.historyItem.actionName).toBe(SELECTION_ACTION);
    });

    it('claims the document for a drag of an already-committed selection too', () => {
      useRectPointerDownMock.mockReturnValue(true);
      const { container } = render(<RectangularSelectionToolArea className="test-rectangular-selection-area" />);
      const toolArea = container.firstElementChild as HTMLDivElement;

      fireEvent.pointerDown(toolArea, { button: 0, pointerId: 5, clientX: 15, clientY: 25 });

      expect(readDocumentGesture()).toEqual({ kind: 'rectangular-selection', pointerId: 5 });
    });

    it('releases the claim on the path that commits nothing, so a zero-size drag cannot leave the keyboard dead', () => {
      const { container } = render(<RectangularSelectionToolArea className="test-rectangular-selection-area" />);
      const toolArea = container.firstElementChild as HTMLDivElement;

      fireEvent.pointerDown(toolArea, { button: 0, pointerId: 6, clientX: 20, clientY: 10 });
      expect(isDocumentGestureOpen()).toBe(true);

      // A rect whose width and height are both zero is what a press and release in
      // the same place produce, and `createCommittedRectangleSelection` returns
      // null for it — so `onChangeEnd` returns early WITHOUT committing. Releasing
      // only at the commit statement would leave the claim set forever here; that
      // is why the release is the first statement of the function.
      act(() => {
        useRectProps.current!.onChangeEnd({ x1: 20, y1: 10, x2: 20, y2: 10 });
      });

      expect(isDocumentGestureOpen()).toBe(false);
      expect(selectionEdits()).toHaveLength(0);
    });

    it('releases the claim on pointer cancel, which surfaces no onChangeEnd', () => {
      const { container } = render(<RectangularSelectionToolArea className="test-rectangular-selection-area" />);
      const toolArea = container.firstElementChild as HTMLDivElement;

      fireEvent.pointerDown(toolArea, { button: 0, pointerId: 7, clientX: 20, clientY: 10 });
      expect(isDocumentGestureOpen()).toBe(true);

      // `useRect` does not surface its internal `onPointerCancel`, so no
      // `onChangeEnd` follows a cancel and the claim has to be dropped here.
      fireEvent.pointerCancel(toolArea, { pointerId: 7, clientX: 20, clientY: 10 });

      expect(isDocumentGestureOpen()).toBe(false);
    });

    it('releases the claim on unmount, so a gesture that dies mid-drag cannot leave the keyboard dead', () => {
      const { container, unmount } = render(
        <RectangularSelectionToolArea className="test-rectangular-selection-area" />
      );
      const toolArea = container.firstElementChild as HTMLDivElement;

      fireEvent.pointerDown(toolArea, { button: 0, pointerId: 8, clientX: 20, clientY: 10 });
      expect(isDocumentGestureOpen()).toBe(true);

      unmount();

      expect(isDocumentGestureOpen()).toBe(false);
    });

    it('claims nothing for a press `useRect` refuses, so a right-click cannot hold the document', () => {
      const { container } = render(<RectangularSelectionToolArea className="test-rectangular-selection-area" />);
      const toolArea = container.firstElementChild as HTMLDivElement;

      // A non-primary button starts no rectangle, so there is no gesture for the
      // keyboard to wait on — and a claim taken here would refuse every shortcut
      // until some unrelated drag happened to release it.
      fireEvent.pointerDown(toolArea, { button: 2, pointerId: 9, clientX: 20, clientY: 10 });

      expect(isDocumentGestureOpen()).toBe(false);
    });

    it('claims nothing for a second pointer while one is already down', () => {
      const { container } = render(<RectangularSelectionToolArea className="test-rectangular-selection-area" />);
      const toolArea = container.firstElementChild as HTMLDivElement;

      fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, clientX: 20, clientY: 10 });
      expect(isDocumentGestureOpen()).toBe(true);

      // `usePointerPosition.isPointerDownValid` refuses a second pointer, and
      // that is the rule the claim follows: the document still belongs to the
      // first drag, not to this press.
      useRectIsMouseDown.current = true;
      fireEvent.pointerDown(toolArea, { button: 0, pointerId: 2, clientX: 40, clientY: 40 });

      expect(readDocumentGesture()).toEqual({ kind: 'rectangular-selection', pointerId: 1 });
    });
  });
});
