import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { EllipticalSelectionToolArea } from '../EllipticalSelectionToolArea.tsx';
import {
  ELLIPTICAL_SELECTION_SOURCE_TOOL,
  type EllipticalSelectionToolArgs,
} from '../../../tools/ellipticalSelection.ts';
import { getSelectionAbsolutePoints, hasSameSelectionGeometry, moveSelectionByDelta } from '../../../util/selection.ts';
import type { Point, Selection } from '../../../contexts/general-types.ts';

const dispatchMock = vi.hoisted(() => vi.fn());
const pointerState = vi.hoisted(() => ({ isMouseDown: { current: false }, activePointer: null as number | null }));
const storeState = vi.hoisted(
  (): {
    selections: Selection[];
    activeSelectionId: string | null;
    documentFrame: { x: number; y: number; width: number; height: number } | null;
  } => ({ selections: [], activeSelectionId: null, documentFrame: null })
);

/**
 * `useSelectionHistory` is NOT mocked, and that is the point: the commit this file pins is the
 * real one, so a gesture that should write nothing is observed as the absence of a
 * `COMMIT_DOCUMENT_EDIT` rather than as the absence of a mock call. The store mock therefore
 * carries every field the single-writer hook destructures, not only the ones the tool area reads
 * — `history` / `historyIndex` are the legacy append point it plans against, and omitting them
 * would make every commit read as a corrupt timeline.
 */
vi.mock('../../../contexts/StoreContext.tsx', () => ({
  useStore: () => [
    {
      containerRef: { current: document.createElement('div') },
      totalSize: { width: 200, height: 120 },
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
      historyIndex: 0,
    },
    dispatchMock,
  ],
}));

/**
 * `getToolArgs` is keyed by tool name, and the key is load-bearing: returning `null` for a name
 * that is not this file's is what makes a neighbouring area's args unreachable, and a mock that
 * ignored the name would let a wrong key mount a working marquee.
 */
vi.mock('../../../contexts/useCurrentTool.tsx', () => ({
  useCurrentTool: () => ({
    getToolArgs: (toolName: string) =>
      toolName === 'elliptical-selection'
        ? ({
            toolName: 'elliptical-selection',
            style: 'normal',
            fixedRatio: 1,
            fixedWidth: 80,
            fixedHeight: 60,
          } as EllipticalSelectionToolArgs)
        : null,
  }),
}));

/**
 * A faithful stand-in for the real `usePointerPosition` capture contract: the first `pointerDown`
 * claims the pointer, and only that pointer's move/up are valid.
 *
 * The pointer ID matters more here than in the paint areas, because this surface carries the id
 * on its own drag record and refuses a move or a release whose id is not the one the press took
 * (`EllipticalSelectionToolArea.tsx:181, 212, 263`). A double that let every event through would
 * let a second pointer steer a drag it did not start, and every case below would still pass.
 */
vi.mock('../../../hooks/usePointerPosition.ts', () => ({
  usePointerPosition: () => ({
    isPointerDownValid: vi.fn((event: PointerEvent) => {
      if (event.button !== 0) return false;
      if (pointerState.activePointer !== null) return false;
      pointerState.activePointer = event.pointerId;
      pointerState.isMouseDown.current = true;
      return true;
    }),
    isPointerMoveValid: vi.fn(() => pointerState.activePointer !== null && pointerState.isMouseDown.current),
    isPointerUpValid: vi.fn((event: PointerEvent) => {
      if (event.button !== 0) return false;
      if (pointerState.activePointer !== event.pointerId) return false;
      pointerState.activePointer = null;
      pointerState.isMouseDown.current = false;
      return true;
    }),
    getLocalCoords: (event: PointerEvent) => ({ x: event.clientX, y: event.clientY }),
    isMouseDown: pointerState.isMouseDown,
  }),
}));

/**
 * The tool overlay is one 2D context for the whole session, and this area repaints it on mount,
 * on every move and on every release. A context short of these calls would make the repaint a
 * `TypeError`, which is a failure that says nothing about the behaviour under test.
 */
function createOverlayContext() {
  return {
    canvas: { width: 200, height: 120 },
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
    globalAlpha: 1,
  } as unknown as CanvasRenderingContext2D;
}

/** A committed polygon covering the whole 200x120 document, with the document frame at (0,0). */
const coveringSelection = (): Selection => ({
  id: 'selection-1',
  isActive: true,
  geometry: 'polygon',
  sourceTool: 'polygonal-lasso',
  lifecycle: 'committed',
  pos: { x: 0, y: 0, width: 200, height: 120 },
  points: [
    { x: 0, y: 0 },
    { x: 200, y: 0 },
    { x: 200, y: 120 },
    { x: 0, y: 120 },
  ],
});

const renderArea = () => {
  const { container } = render(
    <EllipticalSelectionToolArea
      className="test-elliptical-selection-area"
      overlayCtxRef={{ current: createOverlayContext() }}
    />
  );

  return container.firstElementChild as HTMLDivElement;
};

/**
 * One `COMMIT_DOCUMENT_EDIT` the mocked dispatch received. `durableEntry` is deliberately not
 * narrowed: the store publishes the planned entry only when its durable document still describes
 * the timeline the plan was made against, and the append boundary's failure fallback omits it
 * entirely — both are correct, so the pin asserts the contract the two paths share.
 */
type SelectionEdit = {
  type: string;
  payload: {
    historyItem: { actionName: string; id: string };
    updates: { selections: Selection[]; activeSelectionId: string | null };
  };
};

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

function draftDispatches(): unknown[] {
  return (dispatchMock.mock.calls as unknown[][])
    .map(([action]) => action)
    .filter((action) => (action as { type: string }).type === 'START_SELECTION_DRAFT');
}

describe('EllipticalSelectionToolArea', () => {
  beforeEach(() => {
    dispatchMock.mockClear();
    pointerState.isMouseDown.current = false;
    pointerState.activePointer = null;
    storeState.selections = [];
    storeState.activeSelectionId = null;
    storeState.documentFrame = null;
  });

  it('starts no selection draft for a press inside the active selection, because that press moves it', () => {
    storeState.selections = [coveringSelection()];
    storeState.activeSelectionId = 'selection-1';
    const toolArea = renderArea();

    fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, clientX: 100, clientY: 60 });

    // The arm that returns before the draft dispatch (`EllipticalSelectionToolArea.tsx:155-165`).
    // A draft dispatched here would put a second, half-built selection into the store over the
    // one the drag is about to replace, and the drag's own commit would then resolve against a
    // selection the user never made.
    expect(draftDispatches()).toEqual([]);
    // The press is not a dead end either: it is the only route by which a committed selection
    // can be repositioned with this tool.
    expect(dispatchMock).not.toHaveBeenCalled();

    fireEvent.pointerMove(toolArea, { button: 0, pointerId: 1, clientX: 120, clientY: 80 });
    fireEvent.pointerUp(toolArea, { button: 0, pointerId: 1, clientX: 120, clientY: 80 });

    // One commit, and it is a MOVE: still exactly one selection, still carrying its own id. A
    // create would have appended a second, and the count is what distinguishes them.
    const edit = singleSelectionEdit();
    expect(edit.payload.updates.selections).toHaveLength(1);
    expect(edit.payload.updates.selections[0].id).toBe('selection-1');
    // The delta is document-space, and the frame is at the origin here, so the selection's own
    // origin moves by exactly what the pointer did.
    expect(edit.payload.updates.selections[0].pos).toEqual({ x: 20, y: 20, width: 200, height: 120 });
    expect(edit.payload.updates.activeSelectionId).toBe('selection-1');
  });

  it('starts the selection draft exactly once for a press on empty canvas', () => {
    const toolArea = renderArea();

    fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, clientX: 100, clientY: 60 });

    // The source tool is a BORROWED value, deliberately: `SelectionSourceTool` has no
    // `'elliptical-selection'` member, and borrowing `'magic-wand'` is the one borrowed value
    // that is also the right behaviour — `drawSelectionOutline` and `findSelectionAnchorAtPoint`
    // both skip the per-vertex anchor dots for it, and a tessellated ellipse must carry neither
    // 141 draggable handles nor an anchor hit-test (`src/tools/ellipticalSelection.ts:38-48`).
    // Pinned through the constant so the day the real member lands, this is the one place to read.
    expect(draftDispatches()).toEqual([
      { type: 'START_SELECTION_DRAFT', payload: { sourceTool: ELLIPTICAL_SELECTION_SOURCE_TOOL } },
    ]);
    expect(ELLIPTICAL_SELECTION_SOURCE_TOOL).toBe('magic-wand');
    expect(dispatchMock).toHaveBeenCalledTimes(1);
  });

  it('commits one selection per drag, with its points in document space', () => {
    // A crop moves the document's origin off the canvas origin, which is the only state in which
    // canvas and document coordinates differ. A commit that stored canvas points would place the
    // marquee 30px left of and 40px above where the user dragged it — off by exactly the frame
    // offset, so it would look right on an uncropped document and wrong on every cropped one.
    storeState.documentFrame = { x: 30, y: 40, width: 200, height: 120 };
    const toolArea = renderArea();

    fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, clientX: 20, clientY: 10 });
    fireEvent.pointerMove(toolArea, { button: 0, pointerId: 1, clientX: 100, clientY: 80 });
    fireEvent.pointerUp(toolArea, { button: 0, pointerId: 1, clientX: 100, clientY: 80 });

    // One commit for one drag, and the move in between wrote only the overlay: the store has
    // been untouched since the draft.
    const edit = singleSelectionEdit();
    const [selection] = edit.payload.updates.selections;
    expect(selection.geometry).toBe('polygon');
    expect(selection.lifecycle).toBe('committed');
    expect(selection.isActive).toBe(true);
    expect(selection.sourceTool).toBe(ELLIPTICAL_SELECTION_SOURCE_TOOL);
    expect(edit.payload.updates.activeSelectionId).toBe(selection.id);

    // The drag's rect in canvas space is (20,10) to (100,80), whose centre is (60,45). A
    // tessellated ellipse's vertex MEAN is exactly its centre for any vertex count, so the
    // centre recovered from the stored selection is the one number that says which space the
    // geometry is in. `pos` is the document-space origin of the normalised polygon and `points`
    // are relative to it, so the absolute centre is `pos` plus the mean of `points`.
    const centre = (axis: 'x' | 'y'): number =>
      selection.pos[axis] + selection.points.reduce((sum, point) => sum + point[axis], 0) / selection.points.length;

    // Document space: the canvas centre plus the frame origin. The canvas answer would be
    // (60, 45) and the test would fail, which is the whole claim.
    expect(centre('x')).toBeCloseTo(90, 6);
    expect(centre('y')).toBeCloseTo(85, 6);

    // And the far edge, independently of the centroid: the ellipse is inscribed in a rect whose
    // right edge is canvas x=100, so in document space its rightmost vertex is exactly 130 — the
    // first vertex sits at angle 0, so this one is exact rather than approximate. In canvas space
    // it would be exactly 100.
    const absolute: Point[] = getSelectionAbsolutePoints(selection);
    expect(Math.max(...absolute.map((point) => point.x))).toBe(130);
    // The tessellated polygon's leftmost vertex stops short of the rect's left edge by the chord
    // sagitta, so this one is a bound rather than a literal.
    expect(Math.min(...absolute.map((point) => point.x))).toBeGreaterThanOrEqual(50);
  });

  it('commits nothing for a marquee drag that never moved, and cancels the draft instead', () => {
    const toolArea = renderArea();

    fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, clientX: 60, clientY: 40 });
    fireEvent.pointerUp(toolArea, { button: 0, pointerId: 1, clientX: 60, clientY: 40 });

    // `resolveEllipseRect` returns null for a zero-extent box, so there is no ellipse to commit
    // — and the draft the press opened is closed rather than left half-built.
    expect(selectionEdits()).toEqual([]);
    expect(dispatchMock).toHaveBeenLastCalledWith({ type: 'CANCEL_SELECTION_DRAFT' });
  });

  it('commits nothing for a selection drag whose last move had no delta', () => {
    storeState.selections = [coveringSelection()];
    storeState.activeSelectionId = 'selection-1';
    const baseline = storeState.selections[0];
    const toolArea = renderArea();

    fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, clientX: 110, clientY: 70 });
    // A pointer that reports a move without changing position: the ordinary case of a device
    // rounding a drag onto the same pixel, and the only way a selection drag ends on a zero
    // delta. The move is real, so the run really does call `moveSelectionByDelta`.
    fireEvent.pointerMove(toolArea, { button: 0, pointerId: 1, clientX: 110, clientY: 70 });
    fireEvent.pointerUp(toolArea, { button: 0, pointerId: 1, clientX: 110, clientY: 70 });

    // Nothing, and the reason is arithmetic rather than a flag. Both move builders bump
    // `metadata.movedAtVersion` on EVERY call, so the selection the drag built is never deep-equal
    // to the one it came from — it is different AND geometrically identical at the same time. A
    // deep comparison could therefore never report "unchanged", and every `COMMIT_DOCUMENT_EDIT`
    // marks the document dirty and adds an undo step, so a drag that moved nothing would write a
    // history entry and label the file modified.
    expect(selectionEdits()).toEqual([]);

    // The control that makes the assertion above meaningful: the same zero delta through the
    // production builder, showing the marker moved while the geometry did not.
    const jittered = moveSelectionByDelta(baseline, { x: 0, y: 0 });
    expect(jittered).not.toBe(baseline);
    expect(jittered.metadata?.movedAtVersion).toBe(1);
    expect(jittered).not.toEqual(baseline);
    expect(hasSameSelectionGeometry(baseline, jittered)).toBe(true);
  });
});
