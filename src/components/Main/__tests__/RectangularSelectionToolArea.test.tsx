import { act, fireEvent, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UseRectProps } from '../../../hooks/useRect.ts';
import type { Selection } from '../../../contexts/general-types.ts';
import { SELECTION_ACTION } from '../../../util/constants.ts';
import { RectangularSelectionToolArea } from '../RectangularSelectionToolArea.tsx';

const dispatchMock = vi.hoisted(() => vi.fn());
const storeState = vi.hoisted((): { selections: Selection[]; activeSelectionId: string | null } => ({
  selections: [],
  activeSelectionId: null,
}));
const useRectProps = vi.hoisted((): { current: UseRectProps | null } => ({ current: null }));
const useRectPointerDownMock = vi.hoisted(() => vi.fn(() => false));

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
    },
    dispatchMock,
  ],
}));

vi.mock('../../../hooks/useRect.ts', () => ({
  useRect: (props: UseRectProps) => {
    useRectProps.current = props;

    return {
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
                pos: { x: 20, y: 10, width: 80, height: 50 },
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

    expect(useRectProps.current!.initialRect).toEqual({ x1: 10, y1: 20, x2: 40, y2: 60 });
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
                pos: { x: 20, y: 30, width: 30, height: 40 },
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
});
