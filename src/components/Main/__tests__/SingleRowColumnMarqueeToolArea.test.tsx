import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import type { RefObject } from 'react';
import { SingleRowColumnMarqueeToolArea } from '../SingleRowColumnMarqueeToolArea.tsx';
import {
  SINGLE_COLUMN_MARQUEE_SOURCE_TOOL,
  SINGLE_ROW_MARQUEE_SOURCE_TOOL,
  isSingleRowOrColumnMarqueeRect,
} from '../../../tools/singleRowColumnMarquee.ts';
import { SELECTION_ACTION } from '../../../util/constants.ts';
import { isDocumentGestureOpen, resetDocumentGestures } from '../../../hooks/document-gesture.ts';
import { makeMockCtx } from '../../../__tests__/canvas-mock.ts';
import type { Selection, SelectionSourceTool, Size } from '../../../contexts/general-types.ts';

const dispatchMock = vi.hoisted(() => vi.fn());
const pointerState = vi.hoisted(() => ({ isMouseDown: { current: false }, activePointer: null as number | null }));

const storeState = vi.hoisted(
  (): {
    toolName: string;
    selections: Selection[];
    activeSelectionId: string | null;
    totalSize: { width: number; height: number };
    documentFrame: { x: number; y: number; width: number; height: number } | null;
  } => ({
    toolName: 'single-row-marquee',
    selections: [],
    activeSelectionId: null,
    totalSize: { width: 200, height: 120 },
    // Null, so the component derives the frame from `totalSize` and canvas coordinates and
    // document coordinates are the same numbers here. A shifted frame is the one thing that
    // would make a committed position ambiguous between the two spaces — which is why this
    // default is the reason the `documentFrame` cases below have to set it deliberately:
    // leaving it null here is what let a double conversion through 13 cases unnoticed.
    documentFrame: null,
  })
);

/**
 * `useSelectionHistory` is NOT mocked, and that is the point: the commit these cases pin is
 * the real one, so "this gesture wrote nothing" is observed as the absence of a
 * `COMMIT_DOCUMENT_EDIT` rather than as the absence of a mock call. The store mock therefore
 * carries every field the single-writer hook destructures, not only the ones the tool area
 * reads — `history` / `historyIndex` are the legacy append point it plans against, and
 * omitting them would make every commit read as a corrupt timeline and take the writer's
 * failure path.
 */
vi.mock('../../../contexts/StoreContext.tsx', () => ({
  useStore: () => [
    {
      containerRef: { current: document.createElement('div') },
      get totalSize() {
        return storeState.totalSize;
      },
      get toolName() {
        return storeState.toolName;
      },
      get selections() {
        return storeState.selections;
      },
      get activeSelectionId() {
        return storeState.activeSelectionId;
      },
      get documentFrame() {
        return storeState.documentFrame;
      },
      history: [],
      historyIndex: -1,
      branchRevision: 0,
    },
    dispatchMock,
  ],
}));

/**
 * Both source-tool constants are `'rectangular-selection'` — truthfully, since a 1-pixel band
 * IS a rectangle, and pinned as such in `src/tools/__tests__/singleRowColumnMarquee.test.ts`.
 * That makes a draft payload compared against either of them pass whichever ARM dispatched it,
 * so this mock hands the two DISTINGUISHABLE values and the cases can see which one ran. Only
 * the constants are replaced; the geometry functions are the originals, so the bands these
 * cases commit are the real ones.
 */
vi.mock('../../../tools/singleRowColumnMarquee.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../tools/singleRowColumnMarquee.ts')>()),
  SINGLE_ROW_MARQUEE_SOURCE_TOOL: 'rectangular-selection' as SelectionSourceTool,
  SINGLE_COLUMN_MARQUEE_SOURCE_TOOL: '__column-source-tool__' as SelectionSourceTool,
}));

/**
 * A faithful stand-in for the real `usePointerPosition` capture contract, with ONE documented
 * omission: it does not refuse a non-primary button. The real hook does, so a right-click is
 * gated twice in production — once by the hook and once by the component's own first line.
 * Leaving the button check out of the mock is what makes the component's own gate the one the
 * non-primary case actually pins, instead of a case that passes whichever of the two survives.
 *
 * The pointer id is honoured exactly as the real hook honours it, because this surface carries
 * the id on its own drag record and refuses a move or a release whose id is not the one the
 * press took.
 */
vi.mock('../../../hooks/usePointerPosition.ts', () => ({
  usePointerPosition: () => ({
    isPointerDownValid: vi.fn((event: PointerEvent) => {
      if (pointerState.activePointer !== null) return false;
      pointerState.activePointer = event.pointerId;
      pointerState.isMouseDown.current = true;
      return true;
    }),
    isPointerMoveValid: vi.fn(() => pointerState.activePointer !== null && pointerState.isMouseDown.current),
    isPointerUpValid: vi.fn((event: PointerEvent) => {
      if (pointerState.activePointer !== event.pointerId) return false;
      pointerState.activePointer = null;
      pointerState.isMouseDown.current = false;
      return true;
    }),
    getLocalCoords: (event: PointerEvent) => ({ x: event.clientX, y: event.clientY }),
    // Mirrors the real hook's `releasePointer` (`usePointerPosition.ts:203`): clears the
    // tracked pointer without a release event. Without this the mock leaves the capture
    // set forever, which is exactly the wedge the real hook grew this to close, so the
    // mock would have hidden the very defect the abort route exists to prevent.
    releasePointer: vi.fn(() => {
      pointerState.activePointer = null;
      pointerState.isMouseDown.current = false;
    }),
    isMouseDown: pointerState.isMouseDown,
  }),
}));

type SelectionEdit = {
  type: string;
  payload: {
    historyItem: { actionName: string; id: string };
    updates: { selections: Selection[]; activeSelectionId: string | null };
  };
};

function dispatchedActions(): SelectionEdit[] {
  return (dispatchMock.mock.calls as unknown[][]).map(([action]) => action as SelectionEdit);
}

function selectionEdits(): SelectionEdit[] {
  return dispatchedActions().filter((action) => action.type === 'COMMIT_DOCUMENT_EDIT');
}

function singleSelectionEdit(): SelectionEdit {
  const edits = selectionEdits();
  expect(edits).toHaveLength(1);

  return edits[0];
}

function draftDispatches(): string[] {
  return (dispatchMock.mock.calls as unknown[][])
    .map(([action]) => action as { type: string; payload?: { sourceTool?: string } })
    .filter((action) => action.type === 'START_SELECTION_DRAFT')
    .map((action) => action.payload?.sourceTool as string);
}

/**
 * A cropped document: the frame origin is off the canvas origin, which is the ONLY state in
 * which canvas and document coordinates differ, and therefore the only state in which a commit
 * that forgets to convert — or converts twice — is visible at all.
 *
 * `totalSize` is the DOCUMENT's extent, not the canvas's: `StoreContext.tsx:357` derives it from
 * the frame on every commit, so a 700x550 document with a frame at (100, 50) occupies canvas
 * (100,50)-(800,600) and document (0,0)-(700,550). Every expectation below is computed in
 * DOCUMENT space and a press is given in CANVAS space, and the difference between the two is
 * exactly the frame origin.
 */
const SHIFTED_FRAME = { x: 100, y: 50, width: 700, height: 550 };
const SHIFTED_DOCUMENT: Size = { width: 700, height: 550 };

function useShiftedDocument(): void {
  storeState.documentFrame = { ...SHIFTED_FRAME };
  storeState.totalSize = { ...SHIFTED_DOCUMENT };
}

/** A committed 1-pixel row band, as the tool itself would have produced it. */
const rowBand = (overrides: Partial<Selection> = {}): Selection => ({
  id: 'band-1',
  isActive: true,
  geometry: 'rectangle',
  sourceTool: SINGLE_ROW_MARQUEE_SOURCE_TOOL,
  lifecycle: 'committed',
  pos: { x: 0, y: 40, width: 200, height: 1 },
  points: [
    { x: 0, y: 0 },
    { x: 200, y: 0 },
    { x: 200, y: 1 },
    { x: 0, y: 1 },
  ],
  ...overrides,
});

const renderArea = (toolName?: string, overlayCtxRef?: RefObject<CanvasRenderingContext2D | null>) => {
  if (toolName) storeState.toolName = toolName;
  const { container } = render(
    <SingleRowColumnMarqueeToolArea className="test-marquee-area" overlayCtxRef={overlayCtxRef} />
  );

  return container.firstElementChild as HTMLDivElement;
};

describe('SingleRowColumnMarqueeToolArea', () => {
  beforeEach(() => {
    dispatchMock.mockClear();
    pointerState.isMouseDown.current = false;
    pointerState.activePointer = null;
    storeState.toolName = 'single-row-marquee';
    storeState.selections = [];
    storeState.activeSelectionId = null;
    storeState.totalSize = { width: 200, height: 120 };
    storeState.documentFrame = null;
    // The document-gesture slot is module-level, so a claim leaked by one case would refuse
    // every later press in this file and read as a dozen unrelated failures.
    resetDocumentGestures();
  });

  it('commits exactly one selection from a click, at the row under the press', () => {
    const toolArea = renderArea();

    fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, clientX: 100, clientY: 60 });
    fireEvent.pointerUp(toolArea, { button: 0, pointerId: 1, clientX: 100, clientY: 60 });

    const edit = singleSelectionEdit();
    const [selection] = edit.payload.updates.selections;

    expect(selection.pos).toEqual({ x: 0, y: 60, width: 200, height: 1 });
    expect(selection.geometry).toBe('rectangle');
    expect(selection.sourceTool).toBe(SINGLE_ROW_MARQUEE_SOURCE_TOOL);
    expect(edit.payload.updates.activeSelectionId).toBe(selection.id);
    expect(edit.payload.historyItem.actionName).toBe(SELECTION_ACTION);
    // `isActive` and `lifecycle` are deliberately NOT asserted here: `createCommittedRectangleSelection`
    // sets both AND `committedSelectionUpdate` re-forces both on a create, so no single mutation can
    // falsify an assertion on them in this file. The writer's own suite
    // (`src/contexts/__tests__/useSelectionHistory.test.ts`) is where that contract is pinned.
    // One create and one draft: the whole click is two dispatches and no more.
    expect(draftDispatches()).toEqual([SINGLE_ROW_MARQUEE_SOURCE_TOOL]);
    expect(dispatchMock).toHaveBeenCalledTimes(2);
  });

  it('dispatches nothing per pointer move, so a completed gesture writes one edit', () => {
    const toolArea = renderArea();

    fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, clientX: 100, clientY: 20 });

    for (let y = 25; y <= 90; y += 5) {
      fireEvent.pointerMove(toolArea, { button: 0, pointerId: 1, clientX: 100, clientY: y });
    }

    // The draft the press opened, and nothing else: every move in between was overlay, and a
    // commit per move would put fourteen undo steps on one drag and dirty the document
    // fourteen times.
    expect(dispatchMock).toHaveBeenCalledTimes(1);
    expect(draftDispatches()).toEqual([SINGLE_ROW_MARQUEE_SOURCE_TOOL]);

    fireEvent.pointerUp(toolArea, { button: 0, pointerId: 1, clientX: 100, clientY: 90 });

    expect(selectionEdits()).toHaveLength(1);
    expect(dispatchMock).toHaveBeenCalledTimes(2);
  });

  it('commits the release position, not the press position, for a drag', () => {
    const toolArea = renderArea();

    fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, clientX: 100, clientY: 20 });
    fireEvent.pointerMove(toolArea, { button: 0, pointerId: 1, clientX: 100, clientY: 70 });
    fireEvent.pointerUp(toolArea, { button: 0, pointerId: 1, clientX: 100, clientY: 70 });

    // Row 70, which is the pointer on release. A commit built from the press would land on
    // row 20 — the row the user dragged AWAY from.
    const [selection] = singleSelectionEdit().payload.updates.selections;
    expect(selection.pos).toEqual({ x: 0, y: 70, width: 200, height: 1 });
  });

  it('commits the press position for a press that never moved', () => {
    const toolArea = renderArea();

    fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, clientX: 100, clientY: 20 });
    fireEvent.pointerUp(toolArea, { button: 0, pointerId: 1, clientX: 100, clientY: 20 });

    // The control for the case above: with no move at all the press position is the whole
    // gesture, so the pair says "release wins, press when there is no other release" rather
    // than "the release is ignored".
    const [selection] = singleSelectionEdit().payload.updates.selections;
    expect(selection.pos).toEqual({ x: 0, y: 20, width: 200, height: 1 });
  });

  it('reads X and ignores Y under the column tool', () => {
    const toolArea = renderArea('single-column-marquee');

    // A drag that moves 70px down and not at all sideways.
    fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, clientX: 40, clientY: 20 });
    fireEvent.pointerMove(toolArea, { button: 0, pointerId: 1, clientX: 40, clientY: 90 });
    fireEvent.pointerUp(toolArea, { button: 0, pointerId: 1, clientX: 40, clientY: 90 });

    // Column 40, whole document tall, one pixel wide. Had the tool read Y it would have
    // committed row 90, and had it read X while the row tool also read X the two bars would
    // be the same tool.
    const [first] = singleSelectionEdit().payload.updates.selections;
    expect(first.pos).toEqual({ x: 40, y: 0, width: 1, height: 120 });

    // The other half: a drag that DOES move sideways moves the column. Without it the
    // assertion above would be satisfied by a tool that never commits a second column.
    dispatchMock.mockClear();
    fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(toolArea, { button: 0, pointerId: 1, clientX: 70, clientY: 10 });
    fireEvent.pointerUp(toolArea, { button: 0, pointerId: 1, clientX: 70, clientY: 10 });

    const [second] = singleSelectionEdit().payload.updates.selections;
    expect(second.pos).toEqual({ x: 70, y: 0, width: 1, height: 120 });
  });

  it('moves the committed band for a press inside it, instead of creating a second selection', () => {
    storeState.selections = [rowBand()];
    storeState.activeSelectionId = 'band-1';
    const toolArea = renderArea();

    fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, clientX: 100, clientY: 40.5 });
    fireEvent.pointerMove(toolArea, { button: 0, pointerId: 1, clientX: 100, clientY: 60.5 });
    fireEvent.pointerUp(toolArea, { button: 0, pointerId: 1, clientX: 100, clientY: 60.5 });

    const edit = singleSelectionEdit();

    // Still one selection, still carrying the id the band already had — a create would have
    // appended a second one, and the count is what tells the two commits apart.
    expect(edit.payload.updates.selections).toHaveLength(1);
    expect(edit.payload.updates.selections[0].id).toBe('band-1');
    expect(edit.payload.updates.selections[0].pos).toEqual({ x: 0, y: 60, width: 200, height: 1 });
    expect(edit.payload.updates.activeSelectionId).toBe('band-1');
    // The move arm returns before the draft, so a drag of a committed band opens no second
    // draft over the selection it is about to replace.
    expect(draftDispatches()).toEqual([]);
    expect(dispatchMock).toHaveBeenCalledTimes(1);
  });

  /**
   * The hit test is the one place in the file where two coordinate spaces meet, and
   * `getSelectionAbsolutePoints` is DOCUMENT space (`selection.ts:127` — its callers convert
   * it TO canvas, at `selection.ts:176`, `:237` and `useSelectionAnts.ts:82`). With the frame
   * shifted, converting the press to canvas here instead compares canvas against document:
   * the press misses the band it is on and hits one frame below it, so the move gesture
   * becomes unreachable on any cropped document while a phantom hit appears 50 rows down.
   */
  it('moves the committed band for a press inside it on a document whose frame origin is non-zero', () => {
    useShiftedDocument();
    expect(storeState.documentFrame).toEqual(SHIFTED_FRAME);

    // A band already committed on the shifted document: document row 350, whole 700 width.
    const band: Selection = {
      ...rowBand(),
      pos: { x: 0, y: 350, width: 700, height: 1 },
      points: [
        { x: 0, y: 0 },
        { x: 700, y: 0 },
        { x: 700, y: 1 },
        { x: 0, y: 1 },
      ],
    };
    storeState.selections = [band];
    storeState.activeSelectionId = 'band-1';

    const toolArea = renderArea();

    // Canvas y=300 is document y=350, which is INSIDE the band (document 350..351). A press
    // at canvas y=300 that is treated as a miss creates a second selection instead.
    fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, clientX: 250, clientY: 300 });
    fireEvent.pointerMove(toolArea, { button: 0, pointerId: 1, clientX: 250, clientY: 340 });
    fireEvent.pointerUp(toolArea, { button: 0, pointerId: 1, clientX: 250, clientY: 340 });

    const edit = singleSelectionEdit();

    // Canvas y=340 -> document y=390 -> row 390. One selection, same id: a create would have
    // appended a second one at row 50 (canvas 340 misread as document 340 clamped, or the
    // frame applied twice), which is what the miss path produces.
    expect(edit.payload.updates.selections).toHaveLength(1);
    expect(edit.payload.updates.selections[0].id).toBe('band-1');
    expect(edit.payload.updates.selections[0].pos).toEqual({ x: 0, y: 390, width: 700, height: 1 });
    expect(draftDispatches()).toEqual([]);
  });

  it('creates a new selection for a press that misses the committed band', () => {
    storeState.selections = [rowBand()];
    storeState.activeSelectionId = 'band-1';
    const toolArea = renderArea();

    // Row 20, six rows clear of the committed band: the only way to draw a new one, because
    // a press on the band is a move.
    fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, clientX: 100, clientY: 20 });
    fireEvent.pointerUp(toolArea, { button: 0, pointerId: 1, clientX: 100, clientY: 20 });

    const edit = singleSelectionEdit();

    // The control for the move case: two selections now, the band deactivated and the new
    // row appended and active.
    expect(edit.payload.updates.selections).toHaveLength(2);
    expect(edit.payload.updates.selections[0].isActive).toBe(false);
    expect(edit.payload.updates.selections[1].pos).toEqual({ x: 0, y: 20, width: 200, height: 1 });
    expect(edit.payload.updates.activeSelectionId).toBe(edit.payload.updates.selections[1].id);
    expect(draftDispatches()).toEqual([SINGLE_ROW_MARQUEE_SOURCE_TOOL]);
  });

  it('commits nothing for a move that leaves the band where it was', () => {
    storeState.selections = [rowBand()];
    storeState.activeSelectionId = 'band-1';
    const toolArea = renderArea();

    fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, clientX: 100, clientY: 40.5 });
    // A pointer that reports a move without changing position: the ordinary case of a device
    // rounding a drag onto the same pixel, and the only way this gesture ends on a zero delta.
    fireEvent.pointerMove(toolArea, { button: 0, pointerId: 1, clientX: 100, clientY: 40.5 });
    fireEvent.pointerUp(toolArea, { button: 0, pointerId: 1, clientX: 100, clientY: 40.5 });

    // Nothing. The move builder bumps `metadata.movedAtVersion` on every call, so the
    // selection the drag built is never deep-equal to the one it came from — and a commit
    // for it would add an undo step and mark the document dirty for a drag that moved
    // nothing. The guard is on geometry for exactly that reason.
    expect(selectionEdits()).toEqual([]);
    expect(draftDispatches()).toEqual([]);
  });

  it('cancels the draft and commits nothing when the pointer leaves mid-create-gesture', () => {
    const toolArea = renderArea();

    fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, clientX: 100, clientY: 60 });
    fireEvent.pointerLeave(toolArea, { pointerId: 1, clientX: 100, clientY: 60 });

    // The hook's captured pointer goes with the gesture. While it is held, `pointerup` is
    // delivered to the capture target even when the pointer was released elsewhere — and
    // `handlePointerUp` returns before `isPointerUpValid` once the drag ref is empty — so
    // without this the ref survived and every later press was refused by
    // `isPointerDownValid`'s first-pointer-wins check: the tool stopped responding until
    // it was unmounted. Asserted by pressing again on the SAME element afterwards and
    // getting a real gesture rather than a refused one.
    expect(pointerState.activePointer).toBe(null);
    expect(pointerState.isMouseDown.current).toBe(false);

    expect(selectionEdits()).toEqual([]);
    expect(dispatchMock).toHaveBeenLastCalledWith({ type: 'CANCEL_SELECTION_DRAFT' });
    // The claim goes with the gesture, or every document-mutating shortcut stays dead for
    // the rest of the session.
    expect(isDocumentGestureOpen()).toBe(false);

    // The drag really was dropped rather than merely un-drafted: a release that arrives
    // after the leave has no gesture left to commit.
    fireEvent.pointerUp(toolArea, { button: 0, pointerId: 1, clientX: 100, clientY: 60 });
    expect(selectionEdits()).toEqual([]);

    // And the tool is still usable. This is the observable half of the capture: a second
    // press on the SAME mounted element reaches the create arm instead of being refused by
    // `isPointerDownValid`, which is what a surviving `activePointerId` produces.
    dispatchMock.mockClear();
    fireEvent.pointerDown(toolArea, { button: 0, pointerId: 2, clientX: 100, clientY: 90 });
    fireEvent.pointerUp(toolArea, { button: 0, pointerId: 2, clientX: 100, clientY: 90 });

    expect(selectionEdits().map((edit) => edit.payload.updates.selections[0]?.pos)).toEqual([
      { x: 0, y: 90, width: 200, height: 1 },
    ]);
  });

  it('ignores a non-primary button', () => {
    const toolArea = renderArea();

    fireEvent.pointerDown(toolArea, { button: 2, pointerId: 1, clientX: 100, clientY: 60 });
    fireEvent.pointerUp(toolArea, { button: 2, pointerId: 1, clientX: 100, clientY: 60 });

    // Not a single dispatch: a right-click starts no draft, claims no document, and
    // commits no band.
    expect(dispatchMock).not.toHaveBeenCalled();
    expect(isDocumentGestureOpen()).toBe(false);
  });

  it('claims the document for the press and gives the claim back when the band commits', () => {
    const toolArea = renderArea();

    fireEvent.pointerDown(toolArea, { button: 0, pointerId: 4, clientX: 100, clientY: 60 });

    // Held for the whole gesture, which is the window a document-mutating shortcut must not
    // reach: the commit lands on release, and a shortcut in between would mutate the
    // document the pending commit then truncates.
    expect(isDocumentGestureOpen()).toBe(true);

    fireEvent.pointerUp(toolArea, { button: 0, pointerId: 4, clientX: 100, clientY: 60 });

    expect(isDocumentGestureOpen()).toBe(false);
    expect(singleSelectionEdit().payload.historyItem.actionName).toBe(SELECTION_ACTION);
  });

  it('starts a draft naming the column source tool under the column tool', () => {
    const toolArea = renderArea('single-column-marquee');

    fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, clientX: 40, clientY: 60 });

    // The two constants carry distinct values under the mock above, so this can tell the
    // column arm from the row arm; against the real module both are `'rectangular-selection'`
    // and either arm would satisfy the assertion.
    expect(SINGLE_COLUMN_MARQUEE_SOURCE_TOOL).not.toBe(SINGLE_ROW_MARQUEE_SOURCE_TOOL);
    expect(draftDispatches()).toEqual([SINGLE_COLUMN_MARQUEE_SOURCE_TOOL]);
  });

  it('starts a draft naming the row source tool under the row tool', () => {
    const toolArea = renderArea('single-row-marquee');

    fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, clientX: 100, clientY: 60 });

    expect(draftDispatches()).toEqual([SINGLE_ROW_MARQUEE_SOURCE_TOOL]);
  });

  it('lands a row band under the press when the document frame origin is non-zero', () => {
    useShiftedDocument();

    // The fixture IS the claim, so it is asserted rather than assumed: a frame that had quietly
    // reverted to null would leave every expectation below passing while the tool committed
    // canvas coordinates — which is precisely how 13 cases came to miss the double conversion.
    expect(storeState.documentFrame).toEqual(SHIFTED_FRAME);
    expect(storeState.totalSize).toEqual(SHIFTED_DOCUMENT);

    const toolArea = renderArea();

    // Inside the frame. Canvas y=300 -> document y = 300 + frame.y 50 = 350 -> row 350, and the
    // band is the whole 700-wide document from document y=350 to 351. Converting a second time
    // would land it on document y=400, one whole frame below the press.
    fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, clientX: 250, clientY: 300 });
    fireEvent.pointerUp(toolArea, { button: 0, pointerId: 1, clientX: 250, clientY: 300 });

    expect(singleSelectionEdit().payload.updates.selections[0].pos).toEqual({ x: 0, y: 350, width: 700, height: 1 });

    // Near the far edge. Canvas y=545 -> document y = 545 + 50 = 595, which is 45 rows past the
    // 550-row document, so `clampPixelIndex` (`src/tools/singleRowColumnMarquee.ts`:66) pins it
    // to 550 - 1 = 549: the last row of the DOCUMENT. The clamp is against the document extent
    // and not against the canvas, which is what distinguishes it from the press above.
    dispatchMock.mockClear();
    fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, clientX: 250, clientY: 545 });
    fireEvent.pointerUp(toolArea, { button: 0, pointerId: 1, clientX: 250, clientY: 545 });

    expect(singleSelectionEdit().payload.updates.selections[0].pos).toEqual({ x: 0, y: 549, width: 700, height: 1 });

    // The other end of the same clamp. Canvas y=-60 is above the frame's top edge by 60 rows, so
    // document y = -60 + 50 = -10, and a press off the top of the document is row 0 rather than
    // no selection at all.
    dispatchMock.mockClear();
    fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, clientX: 250, clientY: -60 });
    fireEvent.pointerUp(toolArea, { button: 0, pointerId: 1, clientX: 250, clientY: -60 });

    expect(singleSelectionEdit().payload.updates.selections[0].pos).toEqual({ x: 0, y: 0, width: 700, height: 1 });
  });

  it('lands a column band under the press when the document frame origin is non-zero', () => {
    useShiftedDocument();

    expect(storeState.documentFrame).toEqual(SHIFTED_FRAME);

    const toolArea = renderArea('single-column-marquee');

    // Inside the frame. Canvas x=250 -> document x = 250 + frame.x 100 = 350 -> column 350, the
    // whole 550-tall document. A second conversion would put it at document x=450.
    fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, clientX: 250, clientY: 300 });
    fireEvent.pointerUp(toolArea, { button: 0, pointerId: 1, clientX: 250, clientY: 300 });

    expect(singleSelectionEdit().payload.updates.selections[0].pos).toEqual({ x: 350, y: 0, width: 1, height: 550 });

    // Near the far edge. Canvas x=690 -> document x = 690 + 100 = 790, which is 90 columns past
    // the 700-column document, so the clamp pins it to 700 - 1 = 699.
    dispatchMock.mockClear();
    fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, clientX: 690, clientY: 300 });
    fireEvent.pointerUp(toolArea, { button: 0, pointerId: 1, clientX: 690, clientY: 300 });

    expect(singleSelectionEdit().payload.updates.selections[0].pos).toEqual({ x: 699, y: 0, width: 1, height: 550 });

    // The other end. Canvas x=-150 -> document x = -150 + 100 = -50 -> column 0.
    dispatchMock.mockClear();
    fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, clientX: -150, clientY: 300 });
    fireEvent.pointerUp(toolArea, { button: 0, pointerId: 1, clientX: -150, clientY: 300 });

    expect(singleSelectionEdit().payload.updates.selections[0].pos).toEqual({ x: 0, y: 0, width: 1, height: 550 });
  });

  it('paints the drag preview in canvas space, so a shifted frame does not displace the outline', () => {
    useShiftedDocument();

    const ctx = makeMockCtx();
    const toolArea = renderArea(undefined, { current: ctx });

    fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, clientX: 250, clientY: 50 });
    // Canvas y=50 -> document y = 50 + 50 = 100 -> the row band at document y=100..101, spanning
    // document x=0..700. Painting it back into canvas space subtracts the frame origin ONCE:
    // x from 0-100 = -100 to 700-100 = 600, y from 100-50 = 50 to 51.
    fireEvent.pointerMove(toolArea, { button: 0, pointerId: 1, clientX: 250, clientY: 50 });

    // The actual coordinates handed to the context — the numbers the press was given in, so the
    // preview sits exactly under the pointer. Stroking the document-space rect instead would
    // draw this band at (0..700, 100..101), a whole frame below and to the right of the press.
    expect(ctx.moveTo).toHaveBeenCalledExactlyOnceWith(-100, 50);
    expect(ctx.lineTo).toHaveBeenNthCalledWith(1, 600, 50);
    expect(ctx.lineTo).toHaveBeenNthCalledWith(2, 600, 51);
    expect(ctx.lineTo).toHaveBeenNthCalledWith(3, -100, 51);
    expect(ctx.closePath).toHaveBeenCalledOnce();
    expect(ctx.stroke).toHaveBeenCalledOnce();

    // The half that pins the frame's contribution on its own: canvas y=0 -> document y=50 -> the
    // row band at document y=50, painted at canvas y=0..1. So the preview TRACKS the pointer, and
    // the conversion is not a constant offset that happened to agree on one row.
    fireEvent.pointerMove(toolArea, { button: 0, pointerId: 1, clientX: 250, clientY: 0 });

    // `lineTo` is called three times per preview, so the second move's corners are calls 4 to 6.
    expect(ctx.moveTo).toHaveBeenNthCalledWith(2, -100, 0);
    expect(ctx.lineTo).toHaveBeenNthCalledWith(4, 600, 0);
    expect(ctx.lineTo).toHaveBeenNthCalledWith(5, 600, 1);
    expect(ctx.lineTo).toHaveBeenNthCalledWith(6, -100, 1);
    expect(ctx.stroke).toHaveBeenCalledTimes(2);
  });

  it('commits the sum of a multi-frame drag of a band, not its last frame alone', () => {
    storeState.selections = [rowBand()];
    storeState.activeSelectionId = 'band-1';
    const toolArea = renderArea();

    // The press is inside the committed band at document y=40..41, so the move arm takes it and
    // every delta is measured from the press axis 40.5 for the whole gesture.
    fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, clientX: 100, clientY: 40.5 });
    // Frame 1 out to row 70. Frame 2 out to row 90. The release is at row 110, which the pointer
    // reaches between the last move and the release.
    fireEvent.pointerMove(toolArea, { button: 0, pointerId: 1, clientX: 100, clientY: 70.5 });
    fireEvent.pointerMove(toolArea, { button: 0, pointerId: 1, clientX: 100, clientY: 90.5 });
    fireEvent.pointerUp(toolArea, { button: 0, pointerId: 1, clientX: 100, clientY: 110.5 });

    // Row 110: the release measured from the PRESS — 110.5 - 40.5 is 70 rows, and 40 + 70 is 110
    // — and rebuilt as a band. Re-basing each frame on the frame before it instead commits the
    // LAST displacement alone (110 - 90 = 20 rows), which lands the band on row 60.
    const [selection] = singleSelectionEdit().payload.updates.selections;
    expect(selection.id).toBe('band-1');
    expect(selection.pos).toEqual({ x: 0, y: 110, width: 200, height: 1 });
  });

  it('commits nothing for a move of a band that went out and came back to the press point', () => {
    storeState.selections = [rowBand()];
    storeState.activeSelectionId = 'band-1';
    const toolArea = renderArea();

    fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, clientX: 100, clientY: 40.5 });
    // OUT to row 70 (+30) and BACK to the press axis (-30). Measured from the press the two net
    // zero, so the band ends exactly where it started; a drag that re-bases on the previous frame
    // commits the way back out instead, which is a band the user never drew.
    fireEvent.pointerMove(toolArea, { button: 0, pointerId: 1, clientX: 100, clientY: 70.5 });
    fireEvent.pointerMove(toolArea, { button: 0, pointerId: 1, clientX: 100, clientY: 40.5 });
    fireEvent.pointerUp(toolArea, { button: 0, pointerId: 1, clientX: 100, clientY: 40.5 });

    // Not one dispatch: the geometry gate is against the baseline, so a gesture that returns to
    // its own press is not a commit, an undo step, or a modified-file marker.
    expect(dispatchMock).not.toHaveBeenCalled();

    // The control that makes the empty assertion above about the out-and-back and nothing else:
    // an ordinary single-frame drag on the same mount, with the same pointer and the same store,
    // still enters the move arm and still commits — so the gesture above did not pass because
    // the arm never ran.
    fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, clientX: 100, clientY: 40.5 });
    fireEvent.pointerMove(toolArea, { button: 0, pointerId: 1, clientX: 100, clientY: 90.5 });
    fireEvent.pointerUp(toolArea, { button: 0, pointerId: 1, clientX: 100, clientY: 90.5 });

    const [moved] = singleSelectionEdit().payload.updates.selections;
    expect(moved.pos).toEqual({ x: 0, y: 90, width: 200, height: 1 });
  });

  it('keeps a full-width row a band after a sideways drag, so it can still be moved', () => {
    storeState.selections = [rowBand()];
    storeState.activeSelectionId = 'band-1';
    const toolArea = renderArea();

    // A diagonal drag: 200 columns right and 60 rows down from the press on the band at row 40,
    // the last row of the 120-row document reached from row 40 without leaving it. Translating the
    // band by that displacement would leave pos.x = 200, and a full-width band that does not
    // start at document x=0 is not a band at all — every later press on it would create a second
    // selection instead of moving it.
    fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, clientX: 150, clientY: 40.5 });
    fireEvent.pointerMove(toolArea, { button: 0, pointerId: 1, clientX: 350, clientY: 100.5 });
    fireEvent.pointerUp(toolArea, { button: 0, pointerId: 1, clientX: 350, clientY: 100.5 });

    const [moved] = singleSelectionEdit().payload.updates.selections;

    // Rebuilt from the pointer's axis: row 100, still the whole 200-wide document from x=0.
    expect(moved.pos).toEqual({ x: 0, y: 100, width: 200, height: 1 });
    expect(isSingleRowOrColumnMarqueeRect({ x1: 0, y1: 100, x2: 200, y2: 101 }, storeState.totalSize)).toBe(true);

    // The property that matters is the NEXT gesture, not the rect, so the selection this drag
    // committed is mounted back as the store's own state — which is what it becomes.
    storeState.selections = [moved];
    storeState.activeSelectionId = moved.id;
    dispatchMock.mockClear();
    const secondArea = renderArea();

    // A press inside the moved band at row 100 is a MOVE: no draft, and one edit carrying the
    // same id rather than a second selection.
    fireEvent.pointerDown(secondArea, { button: 0, pointerId: 1, clientX: 100, clientY: 100.5 });
    fireEvent.pointerMove(secondArea, { button: 0, pointerId: 1, clientX: 100, clientY: 60.5 });
    fireEvent.pointerUp(secondArea, { button: 0, pointerId: 1, clientX: 100, clientY: 60.5 });

    const edit = singleSelectionEdit();
    expect(edit.payload.updates.selections).toHaveLength(1);
    expect(edit.payload.updates.selections[0].id).toBe('band-1');
    expect(edit.payload.updates.selections[0].pos).toEqual({ x: 0, y: 60, width: 200, height: 1 });
  });

  it('cancels the draft and commits nothing on a document with no rows or no columns to select', () => {
    // A zero-height document. The frame stays null so it is DERIVED from `totalSize`, which is
    // the production shape of the state rather than a fixture shortcut.
    storeState.totalSize = { width: 200, height: 0 };

    const toolArea = renderArea();

    fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, clientX: 100, clientY: 0 });
    fireEvent.pointerUp(toolArea, { button: 0, pointerId: 1, clientX: 100, clientY: 0 });

    // `singleRowMarqueeRect(0, {width:200, height:0})` is a NON-empty rect — (0,0) to (200,1) —
    // and it is `trimRect` that collapses it: the bottom edge clamps to a document height of 0, so
    // the band comes out 200x0 and `createCommittedRectangleSelection` returns null. There is
    // nothing to commit, and the draft the press opened is closed rather than left half-built.
    expect(selectionEdits()).toEqual([]);
    expect(dispatchMock).toHaveBeenCalledTimes(2);
    expect(dispatchMock).toHaveBeenLastCalledWith({ type: 'CANCEL_SELECTION_DRAFT' });

    // The transpose, which is a different collapse: a zero-WIDTH document under the column tool
    // produces the band (0,0)-(1,120), and `trimRect` zeroes its WIDTH instead.
    storeState.totalSize = { width: 0, height: 120 };
    dispatchMock.mockClear();
    const columnArea = renderArea('single-column-marquee');

    fireEvent.pointerDown(columnArea, { button: 0, pointerId: 1, clientX: 0, clientY: 60 });
    fireEvent.pointerUp(columnArea, { button: 0, pointerId: 1, clientX: 0, clientY: 60 });

    expect(selectionEdits()).toEqual([]);
    expect(dispatchMock).toHaveBeenCalledTimes(2);
    expect(dispatchMock).toHaveBeenLastCalledWith({ type: 'CANCEL_SELECTION_DRAFT' });
  });
});
