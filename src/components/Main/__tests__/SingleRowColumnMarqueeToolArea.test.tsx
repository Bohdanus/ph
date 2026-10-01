import { act, fireEvent, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SingleRowColumnMarqueeToolArea } from '../SingleRowColumnMarqueeToolArea.tsx';
import {
  MARQUEE_THICKNESS_PX,
  SINGLE_COLUMN_MARQUEE_SOURCE_TOOL,
  SINGLE_ROW_MARQUEE_SOURCE_TOOL,
} from '../../../tools/singleRowColumnMarquee.ts';
import { isDocumentGestureOpen, readDocumentGesture, resetDocumentGestures } from '../../../hooks/document-gesture.ts';
import { SELECTION_ACTION } from '../../../util/constants.ts';
import type { Point, Selection, Size } from '../../../contexts/general-types.ts';
import type { SingleRowOrColumnMarqueeToolName } from '../../../tools/singleRowColumnMarquee.ts';

/** The two names the geometry module declares, spelled out so a case can index them. */
const BOTH_TOOL_NAMES: SingleRowOrColumnMarqueeToolName[] = ['single-row-marquee', 'single-column-marquee'];

const dispatchMock = vi.hoisted(() => vi.fn());
const pointerState = vi.hoisted(() => ({ activePointer: null as number | null }));
const storeState = vi.hoisted(
  (): {
    toolName: SingleRowOrColumnMarqueeToolName;
    totalSize: Size;
    selections: Selection[];
    activeSelectionId: string | null;
    documentFrame: { x: number; y: number; width: number; height: number } | null;
  } => ({
    toolName: 'single-row-marquee' as SingleRowOrColumnMarqueeToolName,
    totalSize: { width: 200, height: 120 },
    selections: [],
    activeSelectionId: null,
    documentFrame: null,
  })
);

/**
 * `useSelectionHistory` is NOT mocked, and that is the point: the commit this file pins is the
 * real one, so a gesture that should write nothing is observed as the absence of a
 * `COMMIT_DOCUMENT_EDIT` rather than as the absence of a mock call. The store mock therefore
 * carries every field the single-writer hook destructures — `history` / `historyIndex` /
 * `branchRevision` are what it plans the append against, and omitting them makes every commit
 * read as a corrupt timeline and take the `catch` fallback instead.
 *
 * The values are GETTERS because the hook closes over them per render: a plain property copied
 * once at mock time would freeze the state the moment `useStore()` was first called, and a test
 * that reassigns `storeState.selections` afterwards would drive a component still holding the
 * array it mounted with.
 */
vi.mock('../../../contexts/StoreContext.tsx', () => ({
  useStore: () => [
    {
      containerRef: { current: document.createElement('div') },
      get toolName() {
        return storeState.toolName;
      },
      get totalSize() {
        return storeState.totalSize;
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
      selectionCleared: 0,
      history: [] as unknown[],
      historyIndex: 0,
      branchRevision: 0,
    },
    dispatchMock,
  ],
}));

/**
 * A faithful stand-in for the real `usePointerPosition` capture contract: the first `pointerDown`
 * claims the pointer, and only that pointer's move/up are valid.
 *
 * The pointer ID is load-bearing here, because this surface carries the id on its own drag record
 * and refuses a move or a release whose id is not the one the press took. A double that let every
 * event through would let a second pointer steer a drag it did not start, and every case below
 * would still pass.
 *
 * `getLocalCoords` is the identity on `clientX`/`clientY`, i.e. an UNZOOMED, UNPANNED container at
 * the canvas origin — so a canvas coordinate and a client coordinate are the same number here, and
 * every offset in the assertions below is the document frame's, which is the only offset the
 * component adds itself.
 */
vi.mock('../../../hooks/usePointerPosition.ts', () => ({
  usePointerPosition: () => ({
    isPointerDownValid: vi.fn((event: PointerEvent) => {
      if (event.button !== 0) return false;
      if (pointerState.activePointer !== null) return false;
      pointerState.activePointer = event.pointerId;
      return true;
    }),
    isPointerMoveValid: vi.fn(() => pointerState.activePointer !== null),
    isPointerUpValid: vi.fn((event: PointerEvent) => {
      if (event.button !== 0) return false;
      if (pointerState.activePointer !== event.pointerId) return false;
      pointerState.activePointer = null;
      return true;
    }),
    getLocalCoords: (event: PointerEvent) => ({ x: event.clientX, y: event.clientY }),
    isMouseDown: { current: false },
  }),
}));

/**
 * The tool overlay is one 2D context for the whole session, and this area repaints it on mount,
 * on every move and on every release. A context short of these calls would make the repaint a
 * `TypeError`, which is a failure that says nothing about the behaviour under test.
 */
function createOverlayContext() {
  return {
    canvas: { width: 400, height: 300 },
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    setLineDash: vi.fn(),
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 1,
    globalAlpha: 1,
  } as unknown as CanvasRenderingContext2D;
}

/**
 * The frame offset used by every case that has one.
 *
 * Non-zero on purpose: a zero-origin frame makes document and canvas coordinates identical, so a
 * conversion that dropped the offset — or, worse, applied it twice — would satisfy every assertion
 * written against a frame at (0, 0).
 */
const OFFSET_FRAME = { x: 30, y: 40, width: 200, height: 120 };

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

function dispatchedTypes(): string[] {
  return (dispatchMock.mock.calls as unknown[][]).map(([action]) => (action as { type: string }).type);
}

/**
 * The selection a commit left ACTIVE.
 *
 * Not `selections[0]`: a create APPENDS, and the band it replaced is kept in the array with
 * `isActive: false`, so the first element of a replacing commit is the OLD selection. Reading
 * index 0 is how a "the press replaced it" case reports the selection it meant to have replaced.
 */
function committedSelection(edit: SelectionEdit): Selection {
  const { selections, activeSelectionId } = edit.payload.updates;
  const active = selections.find((selection) => selection.id === activeSelectionId);

  expect(active, `no active selection in a commit of ${selections.map((s) => s.id).join(', ')}`).toBeDefined();

  return active as Selection;
}

/**
 * The four corners of a full-width band, RELATIVE to its own origin.
 *
 * `getSelectionAbsolutePoints` offsets them by `pos`, so a selection's `points` are its local
 * corners and not its absolute ones — writing absolute coordinates in both would double the
 * offset, and this case is what says which of the two a commit stores.
 */
function bandPoints(): Point[] {
  return [
    { x: 0, y: 0 },
    { x: 200, y: 0 },
    { x: 200, y: MARQUEE_THICKNESS_PX },
    { x: 0, y: MARQUEE_THICKNESS_PX },
  ];
}

/** The same band as a committed store selection, for the move arm's fixture. */
function bandSelection(row: number, id = 'selection-1'): Selection {
  return {
    id,
    isActive: true,
    geometry: 'rectangle',
    sourceTool: 'rectangular-selection',
    lifecycle: 'committed',
    pos: { x: 0, y: row, width: 200, height: MARQUEE_THICKNESS_PX },
    points: bandPoints(),
  };
}

/** The band a COLUMN press makes, as a committed store selection. */
function columnBandSelection(column: number, id = 'selection-1'): Selection {
  return {
    id,
    isActive: true,
    geometry: 'rectangle',
    sourceTool: 'rectangular-selection',
    lifecycle: 'committed',
    pos: { x: column, y: 0, width: MARQUEE_THICKNESS_PX, height: 120 },
    points: [
      { x: 0, y: 0 },
      { x: MARQUEE_THICKNESS_PX, y: 0 },
      { x: MARQUEE_THICKNESS_PX, y: 120 },
      { x: 0, y: 120 },
    ],
  };
}

/** A point in CANVAS space, so a case reads as the pixel the user pressed. */
function canvas(x: number, y: number): { clientX: number; clientY: number } {
  return { clientX: x, clientY: y };
}

function renderArea(ctx = createOverlayContext()): HTMLDivElement {
  const { container } = render(
    <SingleRowColumnMarqueeToolArea className="test-single-row-column-area" overlayCtxRef={{ current: ctx }} />
  );

  return container.firstElementChild as HTMLDivElement;
}

/** press → (optional move) → release, the whole gesture, on one pointer id. */
function gesture(toolArea: HTMLDivElement, points: Array<{ clientX: number; clientY: number }>, pointerId = 1): void {
  const [down, ...rest] = points;

  fireEvent.pointerDown(toolArea, { button: 0, pointerId, ...down });
  rest.forEach((point) => fireEvent.pointerMove(toolArea, { button: 0, pointerId, ...point }));
  fireEvent.pointerUp(toolArea, { button: 0, pointerId, ...points[points.length - 1] });
}

describe('SingleRowColumnMarqueeToolArea', () => {
  beforeEach(() => {
    dispatchMock.mockClear();
    pointerState.activePointer = null;
    storeState.toolName = 'single-row-marquee';
    storeState.totalSize = { width: 200, height: 120 };
    storeState.selections = [];
    storeState.activeSelectionId = null;
    storeState.documentFrame = null;
    // The claim is module-level, so a leaked one refuses every later claim in this file and
    // reads as a dozen unrelated failures.
    resetDocumentGestures();
  });

  describe('a press and release on the canvas', () => {
    it('commits one document-pixel band spanning the full document width, on the pressed row', () => {
      const toolArea = renderArea();

      // No frame here so the row rule is read on its own; the frame offset is the tripwire at the
      // end of this describe.
      gesture(toolArea, [canvas(5, 20)]);

      const selection = committedSelection(singleSelectionEdit());
      expect(selection.pos).toEqual({ x: 0, y: 20, width: 200, height: MARQUEE_THICKNESS_PX });
      expect(selection.geometry).toBe('rectangle');
      expect(selection.lifecycle).toBe('committed');
      expect(selection.isActive).toBe(true);
      expect(selection.sourceTool).toBe('rectangular-selection');
      expect(selection.points).toEqual(bandPoints());
    });

    it('is exactly one document pixel tall, whatever row it lands on', () => {
      const toolArea = renderArea();

      gesture(toolArea, [canvas(5, 60)]);

      const [selection] = singleSelectionEdit().payload.updates.selections;
      expect(selection.pos.height).toBe(MARQUEE_THICKNESS_PX);
      expect(selection.pos.height).toBe(1);
      // The far edge is exclusive, so the band covers row 60 and not row 61 — which is the same
      // half-open interval the hit test reads.
      expect(selection.pos.y + selection.pos.height).toBe(61);
    });

    it('spans the full document WIDTH, not the width of the press', () => {
      const toolArea = renderArea();

      // Pressed 3px from the left edge; the band still reaches the far edge.
      gesture(toolArea, [canvas(3, 40)]);

      const [selection] = singleSelectionEdit().payload.updates.selections;
      expect(selection.pos.width).toBe(storeState.totalSize.width);
      expect(selection.pos.x).toBe(0);
    });

    it('opens the selection draft once on the press, and never per pointer move', () => {
      const toolArea = renderArea();

      gesture(toolArea, [canvas(5, 20), canvas(60, 30), canvas(120, 45)]);

      // Adobe: "click near the area you want to select, and then drag the marquee to the exact
      // location" — one selection is being aimed, so the draft opens once, on the press.
      expect(dispatchedTypes()).toEqual(['START_SELECTION_DRAFT', 'COMMIT_DOCUMENT_EDIT']);
      expect(dispatchMock).toHaveBeenNthCalledWith(1, {
        type: 'START_SELECTION_DRAFT',
        payload: { sourceTool: SINGLE_ROW_MARQUEE_SOURCE_TOOL },
      });
    });

    it("commits on RELEASE from the pointer's position there, which is what the drag is for", () => {
      const toolArea = renderArea();

      // Pressed row 20, dragged down to row 50. Adobe's own wording for the gesture is "drag the
      // marquee to the exact location", so the release row is the one that commits — NOT the
      // press row.
      gesture(toolArea, [canvas(5, 20), canvas(5, 50)]);

      const selection = committedSelection(singleSelectionEdit());
      expect(selection.pos).toEqual({ x: 0, y: 50, width: 200, height: MARQUEE_THICKNESS_PX });
    });

    it('anchors to the row the pointer is INSIDE, flooring a fractional press', () => {
      const toolArea = renderArea();

      // 12.9 is inside row 12. `Math.round` would answer 13 and every half-pixel press would
      // select the row below the one the user actually clicked.
      gesture(toolArea, [canvas(5, 12.9)]);

      const [selection] = singleSelectionEdit().payload.updates.selections;
      expect(selection.pos.y).toBe(12);
      expect(selection.pos.height).toBe(1);
    });

    it('clamps a press below the document to the last row rather than committing nothing', () => {
      const toolArea = renderArea();

      gesture(toolArea, [canvas(5, 400)]);

      const [selection] = singleSelectionEdit().payload.updates.selections;
      expect(selection.pos.y).toBe(119);
      expect(selection.pos.height).toBe(1);
    });

    it('clamps a press above the document to the first row', () => {
      const toolArea = renderArea();

      gesture(toolArea, [canvas(5, -30)]);

      const [selection] = singleSelectionEdit().payload.updates.selections;
      expect(selection.pos).toEqual({ x: 0, y: 0, width: 200, height: 1 });
    });

    it('appends and activates the band, and retires the previous one', () => {
      const toolArea = renderArea();

      gesture(toolArea, [canvas(5, 20)]);

      const edit = singleSelectionEdit();
      expect(edit.payload.updates.selections).toHaveLength(1);
      expect(edit.payload.updates.activeSelectionId).toBe(edit.payload.updates.selections[0].id);
      expect(edit.payload.historyItem.actionName).toBe(SELECTION_ACTION);
    });

    /**
     * A committed selection's `pos` is its DOCUMENT-space origin: `RectangularSelectionToolArea`
     * adds the frame to a CANVAS rect for exactly that reason, and `drawSelectionOutline` maps the
     * stored points back to canvas with `documentToCanvasPoint` before painting them. Here the
     * press is canvas (0, 0), so document (30, 40), so document row 40 — and 40 is the row the
     * band must carry.
     *
     * This case was a `it.fails` tripwire: the commit added the frame a second time on top of a
     * rect that `rectForAxis` had already built in document space, so on a cropped document the
     * band committed — and therefore drew — a whole frame origin below the row that was pressed.
     * Invisible on an uncropped document, where the frame is (0, 0) and the two forms agree.
     */
    it('commits the band at the pressed row on a cropped document, not one frame origin lower', () => {
      storeState.documentFrame = OFFSET_FRAME;
      const toolArea = renderArea();

      gesture(toolArea, [canvas(0, 0)]);

      const selection = committedSelection(singleSelectionEdit());
      // `x: 0`, not the frame's 30: a row band starts at the DOCUMENT's left edge, and a stored
      // `pos` is document space, so the band is `{0, 40}` there and canvas `(-30, 0)` once
      // `drawSelectionOutline` maps it back — which is the canvas the press happened on.
      expect(selection.pos).toEqual({ x: 0, y: 40, width: 200, height: 1 });
    });
  });

  describe('the single column marquee', () => {
    beforeEach(() => {
      storeState.toolName = 'single-column-marquee';
    });

    it('commits a one-pixel band spanning the full document HEIGHT, on the pressed column', () => {
      const toolArea = renderArea();

      // The mirror of the row case: the press's X picks the column and the span is the height.
      gesture(toolArea, [canvas(70, 5)]);

      const [selection] = singleSelectionEdit().payload.updates.selections;
      expect(selection.pos).toEqual({ x: 70, y: 0, width: MARQUEE_THICKNESS_PX, height: 120 });
      expect(selection.pos.width).toBe(1);
    });

    it('opens the draft with the COLUMN source tool, not the row one', () => {
      const toolArea = renderArea();

      gesture(toolArea, [canvas(70, 5)]);

      expect(dispatchMock).toHaveBeenNthCalledWith(1, {
        type: 'START_SELECTION_DRAFT',
        payload: { sourceTool: SINGLE_COLUMN_MARQUEE_SOURCE_TOOL },
      });
    });

    it('reads X, not Y: dragging down does not move the band it is aiming', () => {
      const toolArea = renderArea();

      gesture(toolArea, [canvas(70, 5), canvas(70, 100)]);

      const [selection] = singleSelectionEdit().payload.updates.selections;
      expect(selection.pos.x).toBe(70);
      expect(selection.pos.height).toBe(120);
    });

    it('clamps a press right of the document to the last column', () => {
      const toolArea = renderArea();

      gesture(toolArea, [canvas(999, 5)]);

      const [selection] = singleSelectionEdit().payload.updates.selections;
      expect(selection.pos.x).toBe(199);
      expect(selection.pos.width).toBe(1);
    });

    it('commits at the release position, transposed exactly as the row does', () => {
      const toolArea = renderArea();

      // Pressed at column 5 and released at column 95: the released column is what commits, which
      // is Adobe's "drag the marquee to the exact location" and the transpose of the row case
      // above. No frame here so the axis rule is read on its own — the frame offset is the
      // separate case two below.
      gesture(toolArea, [canvas(5, 5), canvas(95, 5)]);

      const selection = committedSelection(singleSelectionEdit());
      expect(selection.pos).toEqual({ x: 95, y: 0, width: 1, height: 120 });
    });

    /**
     * `Selection.pos` is the DOCUMENT-space origin of a selection, and that is what every other
     * writer in this app commits: `RectangularSelectionToolArea.tsx:105`-`:112` takes a CANVAS
     * rect from `useRect` and adds the frame, because canvas + frame is document — and its own
     * test pins that identity (`{x: 20, y: 10} -> {x: 50, y: 50}` with the frame at (30, 40)).
     *
     * This tool does not have a canvas rect to convert. `rectForAxis` builds its rect from a
     * DOCUMENT-space axis value (`canvasToDocumentPoint` already added the frame), so the rect is
     * ALREADY in document space and the commit must add nothing to it. It was a `it.fails`
     * tripwire because it did: on any cropped document the band committed, and therefore drew,
     * one whole frame origin from where the user pressed. Here the press is canvas x=95, which is
     * document column 125, and 125 is the document-space `pos.x` the band must carry.
     */
    it('commits the released column at its document position, not one frame origin further', () => {
      storeState.documentFrame = OFFSET_FRAME;
      const toolArea = renderArea();

      gesture(toolArea, [canvas(5, 5), canvas(95, 5)]);

      const selection = committedSelection(singleSelectionEdit());
      // `y: 0`, not the frame's 40: a column band starts at the DOCUMENT's top edge, for the same
      // reason the row band starts at its left one.
      expect(selection.pos).toEqual({ x: 125, y: 0, width: 1, height: 120 });
    });
  });

  describe('a press inside the active band', () => {
    it('MOVES the band rather than replacing it, on a drag', () => {
      storeState.selections = [bandSelection(60)];
      storeState.activeSelectionId = 'selection-1';
      const toolArea = renderArea();

      gesture(toolArea, [canvas(100, 60), canvas(100, 80)]);

      // No draft: the press is not opening a new selection, it is grabbing the existing one.
      expect(dispatchedTypes()).toEqual(['COMMIT_DOCUMENT_EDIT']);
      const edit = singleSelectionEdit();
      // Still exactly one selection, still carrying its OWN id — a create would have appended a
      // second, and the count is what tells the two apart.
      expect(edit.payload.updates.selections).toHaveLength(1);
      expect(edit.payload.updates.selections[0].id).toBe('selection-1');
      expect(edit.payload.updates.activeSelectionId).toBe('selection-1');
      expect(edit.payload.updates.selections[0].pos).toEqual({ x: 0, y: 80, width: 200, height: 1 });
      // The move builders stamp every call, so `movedAtVersion` is the visible evidence that the
      // production builder ran rather than that the test wrote the geometry.
      expect(edit.payload.updates.selections[0].metadata?.movedAtVersion).toBe(1);
    });

    it('moves only on the document delta, never on the frame offset', () => {
      storeState.documentFrame = OFFSET_FRAME;
      storeState.selections = [bandSelection(60)];
      storeState.activeSelectionId = 'selection-1';
      const toolArea = renderArea();

      // Pressed and released at the same canvas y, so the delta is zero in canvas space and in
      // document space alike — and the band must not jump by the frame's 40px.
      gesture(toolArea, [canvas(100, 20), canvas(100, 20)]);

      // The gate is GEOMETRY, not "the drag happened", so a zero delta writes nothing at all.
      expect(selectionEdits()).toEqual([]);
    });

    it('moves the band down by exactly the pointer delta', () => {
      storeState.documentFrame = OFFSET_FRAME;
      storeState.selections = [bandSelection(60)];
      storeState.activeSelectionId = 'selection-1';
      const toolArea = renderArea();

      // Canvas y 20 → 50 is document y 60 → 90, a delta of +30 rows.
      gesture(toolArea, [canvas(100, 20), canvas(100, 50)]);

      const [moved] = singleSelectionEdit().payload.updates.selections;
      expect(moved.pos).toEqual({ x: 0, y: 90, width: 200, height: 1 });
    });

    it('commits nothing when the drag ends where it started', () => {
      storeState.selections = [bandSelection(60)];
      storeState.activeSelectionId = 'selection-1';
      const toolArea = renderArea();

      gesture(toolArea, [canvas(100, 60), canvas(100, 60)]);

      // `hasSameSelectionGeometry` is the gate, and `metadata.movedAtVersion` is why a deep
      // comparison could never be: every builder call bumps it, so a drag that moved nothing is
      // different AND geometrically identical at the same time. `COMMIT_DOCUMENT_EDIT` always
      // flags unsaved changes, so committing here would mark the document dirty for nothing.
      expect(selectionEdits()).toEqual([]);
    });

    /**
     * The single-frame move cases cannot see this, and the reason is arithmetic rather than a
     * missing branch: with one `pointerMove` the last delta IS the whole delta, so
     * `moveSelectionByDelta(baseline, delta)` and `moveSelectionByDelta(preview, delta)` agree.
     * Every move case above issues exactly one move, so the suite was blind to the difference by
     * construction. This is the same defect `EllipticalSelectionToolArea.test.tsx:318` pins as a
     * tripwire for that tool, and this tool had no such case at all.
     */
    it('accumulates a multi-frame move instead of committing the last frame alone', () => {
      storeState.selections = [bandSelection(60)];
      storeState.activeSelectionId = 'selection-1';
      const toolArea = renderArea();

      // OUT to +30 rows, then a further +30: two frames of +30 must land on the band at the
      // SECOND frame's row (90), not the first's (which the last-frame-only form gives).
      gesture(toolArea, [canvas(100, 60), canvas(100, 90), canvas(100, 120)]);

      // Row 120 is one past the last row of this 120-tall document, so the clamp lands it on 119.
      // That is the clamp doing its job, and the value that distinguishes the two forms is 119
      // rather than 90: a last-frame-only delta would have committed row 90.
      const [moved] = singleSelectionEdit().payload.updates.selections;
      expect(moved.pos).toEqual({ x: 0, y: 119, width: 200, height: 1 });
    });

    it('commits nothing for a move drag that went out and came back to the press point', () => {
      storeState.selections = [bandSelection(60)];
      storeState.activeSelectionId = 'selection-1';
      const toolArea = renderArea();

      gesture(toolArea, [canvas(100, 60), canvas(100, 90), canvas(100, 60)]);

      // The net displacement is zero, so the preview ends on the baseline's own geometry and the
      // `hasSameSelectionGeometry` gate suppresses the commit — the same contract the one-frame
      // case above pins, for the gesture's two-frame shape.
      expect(selectionEdits()).toEqual([]);
    });

    it('keeps the band one pixel tall and full width when dragged along its own X', () => {
      storeState.selections = [bandSelection(60)];
      storeState.activeSelectionId = 'selection-1';
      const toolArea = renderArea();

      // A horizontal drag of a ROW band must change nothing about it: the band is placed by its Y,
      // and letting X into the commit would leave `y1: 0` with a width of one, which
      // `isSingleRowOrColumnMarqueeRect` rejects — so the band could never be grabbed again.
      gesture(toolArea, [canvas(100, 60), canvas(160, 60)]);

      expect(selectionEdits()).toEqual([]);
    });

    it('never commits a band off the top of the document, however far it is dragged', () => {
      storeState.selections = [bandSelection(60)];
      storeState.activeSelectionId = 'selection-1';
      const toolArea = renderArea();

      gesture(toolArea, [canvas(100, 60), canvas(100, -900)]);

      // `rectForAxis` clamps, so the band lands on the first row rather than at y = -840.
      const [moved] = singleSelectionEdit().payload.updates.selections;
      expect(moved.pos).toEqual({ x: 0, y: 0, width: 200, height: 1 });
    });

    it('lands a moved band on an integral row even from a fractional pointer', () => {
      storeState.documentFrame = OFFSET_FRAME;
      storeState.selections = [bandSelection(60)];
      storeState.activeSelectionId = 'selection-1';
      const toolArea = renderArea();

      // Any real pointer at a non-integer contain scale arrives between pixels. A band whose
      // `pos.y` is 80.4 covers half of row 80 and half of row 81, so it is neither row.
      gesture(toolArea, [canvas(100, 20), canvas(100, 40.4)]);

      const [moved] = singleSelectionEdit().payload.updates.selections;
      expect(moved.pos).toEqual({ x: 0, y: 80, width: 200, height: 1 });
    });

    it('treats a press one row ABOVE the band as a fresh draw, because the hit area is one pixel', () => {
      storeState.selections = [bandSelection(60)];
      storeState.activeSelectionId = 'selection-1';
      const toolArea = renderArea();

      // Row 61 is outside the band, and a band is exactly one row tall, so there is no
      // tolerance: outside is the ONLY way to draw a new one. `isPointInPolygon` is a ray cast
      // over `[60, 61)`, so 61 is already out — the band does not reach its own far edge.
      gesture(toolArea, [canvas(100, 61)]);

      expect(dispatchMock).toHaveBeenNthCalledWith(1, {
        type: 'START_SELECTION_DRAFT',
        payload: { sourceTool: SINGLE_ROW_MARQUEE_SOURCE_TOOL },
      });
      const edit = singleSelectionEdit();
      // A create APPENDS: the band it replaced stays in the array, deactivated, and the new one
      // is the active id. Two selections is what distinguishes this from a move.
      expect(edit.payload.updates.selections).toHaveLength(2);
      expect(committedSelection(edit).id).not.toBe('selection-1');
      expect(committedSelection(edit).pos.y).toBe(61);
      expect(edit.payload.updates.selections[0].isActive).toBe(false);
    });

    it('treats a press one row BELOW the band as a fresh draw too', () => {
      storeState.selections = [bandSelection(60)];
      storeState.activeSelectionId = 'selection-1';
      const toolArea = renderArea();

      gesture(toolArea, [canvas(100, 59)]);

      expect(dispatchedTypes()).toEqual(['START_SELECTION_DRAFT', 'COMMIT_DOCUMENT_EDIT']);
      expect(committedSelection(singleSelectionEdit()).pos.y).toBe(59);
    });

    it("treats a press exactly ON the band's first row as inside, edge included", () => {
      // The near edge is part of the hit area, so the band is grabbable across `[y1, y2)`: its
      // own first row is inside it. The half-open convention is what makes the row ABOVE it
      // outside, and pinning both together is what stops a future edit from quietly making the
      // band grabbable on both sides and leaving no way to draw a band next to it.
      storeState.selections = [bandSelection(60)];
      storeState.activeSelectionId = 'selection-1';
      const toolArea = renderArea();

      fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, ...canvas(100, 60) });

      expect(dispatchedTypes()).toEqual([]);
    });

    it('treats a press halfway down the single row as inside', () => {
      storeState.selections = [bandSelection(60)];
      storeState.activeSelectionId = 'selection-1';
      const toolArea = renderArea();

      fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, ...canvas(100, 60.5) });

      expect(dispatchedTypes()).toEqual([]);
    });

    it("treats a press horizontally outside the band's row as a fresh draw", () => {
      storeState.selections = [bandSelection(60)];
      storeState.activeSelectionId = 'selection-1';
      const toolArea = renderArea();

      // The band spans the whole width, so there is no "outside" horizontally — which is the
      // property that makes one pixel of row the whole hit target.
      gesture(toolArea, [canvas(0, 60), canvas(199, 60), canvas(100, 75)]);

      // Pressed inside the row, so the drag MOVED it rather than drawing on top of it.
      expect(dispatchedTypes()).toEqual(['COMMIT_DOCUMENT_EDIT']);
      expect(singleSelectionEdit().payload.updates.selections[0].pos.y).toBe(75);
    });

    it('does NOT grab a rectangle the Rectangular Marquee drew, however small the press', () => {
      // The distinction that makes the move arm safe: moving a selection the user made with a
      // different tool would relocate a rectangle, and no drag of this tool's own preview would
      // ever replace it.
      storeState.selections = [
        {
          ...bandSelection(40),
          pos: { x: 10, y: 40, width: 30, height: 20 },
          points: [
            { x: 0, y: 0 },
            { x: 30, y: 0 },
            { x: 30, y: 20 },
            { x: 0, y: 20 },
          ],
        },
      ];
      storeState.activeSelectionId = 'selection-1';
      const toolArea = renderArea();

      // Pressed dead centre of that rectangle.
      gesture(toolArea, [canvas(25, 50)]);

      expect(dispatchMock).toHaveBeenNthCalledWith(1, {
        type: 'START_SELECTION_DRAFT',
        payload: { sourceTool: SINGLE_ROW_MARQUEE_SOURCE_TOOL },
      });
      const edit = singleSelectionEdit();
      expect(committedSelection(edit).id).not.toBe('selection-1');
      // The band that replaced it commits on the PRESS row, which is inside the old rectangle —
      // a 200-wide, 1-tall band, not the 30x20 the other tool drew.
      expect(committedSelection(edit).pos).toEqual({ x: 0, y: 50, width: 200, height: 1 });
    });

    it('does NOT grab a full-document rectangle that is not one pixel thin', () => {
      // The second shape an ordinary marquee can have: every dimension of the document. Both
      // clauses of `isSingleRowOrColumnMarqueeRect` require a thickness of exactly one, so
      // Select-All-shaped selection is still a draw, not a grab.
      storeState.selections = [
        {
          ...bandSelection(0),
          pos: { x: 0, y: 0, width: 200, height: 120 },
          points: [
            { x: 0, y: 0 },
            { x: 200, y: 0 },
            { x: 200, y: 120 },
            { x: 0, y: 120 },
          ],
        },
      ];
      storeState.activeSelectionId = 'selection-1';
      const toolArea = renderArea();

      gesture(toolArea, [canvas(100, 60)]);

      expect(dispatchMock).toHaveBeenNthCalledWith(1, {
        type: 'START_SELECTION_DRAFT',
        payload: { sourceTool: SINGLE_ROW_MARQUEE_SOURCE_TOOL },
      });
      expect(singleSelectionEdit().payload.updates.selections).toHaveLength(2);
    });

    it('moves a COLUMN band on its X, not on its Y', () => {
      storeState.toolName = 'single-column-marquee';
      storeState.selections = [columnBandSelection(70)];
      storeState.activeSelectionId = 'selection-1';
      const toolArea = renderArea();

      // Pressed on column 70 and dragged to column 90, without touching Y at all.
      gesture(toolArea, [canvas(70, 60), canvas(90, 60)]);

      const [moved] = singleSelectionEdit().payload.updates.selections;
      expect(moved.pos).toEqual({ x: 90, y: 0, width: 1, height: 120 });
    });

    it('grabs a ROW band on its own row while the COLUMN tool is active, because the hit test is orientation-agnostic', () => {
      // `isSingleRowOrColumnMarqueeRect` names BOTH orientations and the tool area applies it
      // whichever tool is mounted, so the move arm is not restricted to the band its own tool
      // made. The spec these two tools implement says "a press INSIDE the existing band MOVES the
      // selection" without qualifying the orientation, so this is the current contract rather
      // than a defect — but it is a contract, and a press on row 60 with the column tool moves the
      // row band vertically rather than drawing a column over it.
      storeState.toolName = 'single-column-marquee';
      storeState.selections = [bandSelection(60)];
      storeState.activeSelectionId = 'selection-1';
      const toolArea = renderArea();

      // Pressed ON row 60 — inside the band's half-open `[60, 61)` — and dragged down 30 rows.
      gesture(toolArea, [canvas(100, 60), canvas(100, 90)]);

      expect(dispatchedTypes()).toEqual(['COMMIT_DOCUMENT_EDIT']);
      const [moved] = singleSelectionEdit().payload.updates.selections;
      expect(moved.id).toBe('selection-1');
      expect(moved.pos).toEqual({ x: 0, y: 90, width: 200, height: 1 });
    });

    it('draws a fresh band with the COLUMN tool from a row the row band does not cover', () => {
      // The other half of the same rule, and the reason the case above is not a trap: one row off
      // the band there is no hit at all, so the column tool still draws where the user asked.
      storeState.toolName = 'single-column-marquee';
      storeState.selections = [bandSelection(60)];
      storeState.activeSelectionId = 'selection-1';
      const toolArea = renderArea();

      gesture(toolArea, [canvas(100, 61)]);

      expect(dispatchMock).toHaveBeenNthCalledWith(1, {
        type: 'START_SELECTION_DRAFT',
        payload: { sourceTool: SINGLE_COLUMN_MARQUEE_SOURCE_TOOL },
      });
      const selection = committedSelection(singleSelectionEdit());
      expect(selection.id).not.toBe('selection-1');
      expect(selection.pos).toEqual({ x: 100, y: 0, width: 1, height: 120 });
    });

    it('grabs a COLUMN band on its own column while the ROW tool is active', () => {
      // The transpose of the case two above, and it shows the cross-tool move is a plain 2D
      // translation: the row tool's press lands inside the column band's one-pixel width, and the
      // drag then moves that band sideways even though the row tool has no X axis at all.
      storeState.selections = [columnBandSelection(70)];
      storeState.activeSelectionId = 'selection-1';
      const toolArea = renderArea();

      gesture(toolArea, [canvas(70.5, 60), canvas(95.5, 60)]);

      expect(dispatchedTypes()).toEqual(['COMMIT_DOCUMENT_EDIT']);
      const [moved] = singleSelectionEdit().payload.updates.selections;
      expect(moved.id).toBe('selection-1');
      expect(moved.pos).toEqual({ x: 95, y: 0, width: 1, height: 120 });
    });

    it('replaces rather than moves when there is no active selection to grab', () => {
      // `getActiveSelection` falls back to the first `isActive` selection, so the fixture does not
      // have to set `activeSelectionId` for the move arm to engage — and this pins that fallback
      // from the other side: a store whose id points at nothing still finds the flagged band.
      storeState.selections = [bandSelection(60, 'selection-1')];
      storeState.activeSelectionId = null;
      const toolArea = renderArea();

      gesture(toolArea, [canvas(100, 60), canvas(100, 61)]);

      expect(dispatchedTypes()).toEqual(['COMMIT_DOCUMENT_EDIT']);
      expect(singleSelectionEdit().payload.updates.selections[0].id).toBe('selection-1');
    });
  });

  describe('abort routes', () => {
    it('cancels the draft and commits nothing when the pointer leaves mid-draw', () => {
      const toolArea = renderArea();

      fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, ...canvas(5, 20) });
      fireEvent.pointerMove(toolArea, { button: 0, pointerId: 1, ...canvas(5, 60) });
      fireEvent.pointerLeave(toolArea, { button: 0, pointerId: 1, ...canvas(5, 60) });

      expect(selectionEdits()).toEqual([]);
      expect(dispatchMock).toHaveBeenLastCalledWith({ type: 'CANCEL_SELECTION_DRAFT' });
    });

    it('cancels the draft on a pointer cancel, which surfaces no release either', () => {
      const toolArea = renderArea();

      fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, ...canvas(5, 20) });
      fireEvent.pointerCancel(toolArea, { button: 0, pointerId: 1, ...canvas(5, 20) });

      expect(selectionEdits()).toEqual([]);
      expect(dispatchMock).toHaveBeenLastCalledWith({ type: 'CANCEL_SELECTION_DRAFT' });
    });

    it('snaps an abandoned MOVE back without writing anything', () => {
      storeState.selections = [bandSelection(60)];
      storeState.activeSelectionId = 'selection-1';
      const toolArea = renderArea();

      fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, ...canvas(100, 60) });
      fireEvent.pointerMove(toolArea, { button: 0, pointerId: 1, ...canvas(100, 90) });
      fireEvent.pointerCancel(toolArea, { button: 0, pointerId: 1, ...canvas(100, 90) });

      // The store still shows the un-moved band, so the repaint is the snap-back. No draft was
      // opened by this press, so none is cancelled — the cancel dispatch is the create arm's.
      expect(dispatchedTypes()).toEqual([]);
    });

    it('commits nothing on the release of a press it refused', () => {
      const toolArea = renderArea();

      // A right-button press is refused by `isPointerDownValid`, so no gesture ever opened and
      // the release that follows it has nothing to commit.
      fireEvent.pointerDown(toolArea, { button: 2, pointerId: 1, ...canvas(5, 20) });
      fireEvent.pointerUp(toolArea, { button: 2, pointerId: 1, ...canvas(5, 20) });

      expect(dispatchMock).not.toHaveBeenCalled();
    });

    it('commits nothing for a release from a pointer that never pressed', () => {
      const toolArea = renderArea();

      fireEvent.pointerUp(toolArea, { button: 0, pointerId: 9, ...canvas(5, 20) });

      expect(dispatchMock).not.toHaveBeenCalled();
    });

    it('commits nothing for a move from a pointer that never pressed', () => {
      const toolArea = renderArea();

      fireEvent.pointerMove(toolArea, { button: 0, pointerId: 9, ...canvas(5, 20) });

      expect(dispatchMock).not.toHaveBeenCalled();
    });

    it("ignores a second pointer's release while the first drag is still open", () => {
      const toolArea = renderArea();

      fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, ...canvas(5, 20) });
      fireEvent.pointerUp(toolArea, { button: 0, pointerId: 2, ...canvas(5, 90) });

      // The drag carries the pointer id it was taken with, so a release from anywhere else is
      // dropped before `takeDrag()` — the pending commit stays pending.
      expect(dispatchMock).toHaveBeenCalledTimes(1);
      expect(dispatchedTypes()).toEqual(['START_SELECTION_DRAFT']);
    });

    it('commits nothing on a degenerate document, and cancels the draft instead', () => {
      // A zero-width document yields a zero-area rect from the geometry, and
      // `createCommittedRectangleSelection` returns null for it. The draft the press opened is
      // then closed rather than left half-built in the store.
      storeState.totalSize = { width: 0, height: 120 };
      const toolArea = renderArea();

      gesture(toolArea, [canvas(0, 20)]);

      expect(selectionEdits()).toEqual([]);
      expect(dispatchMock).toHaveBeenLastCalledWith({ type: 'CANCEL_SELECTION_DRAFT' });
    });

    it('drops a running gesture on unmount, so it can never commit after the tool changed', () => {
      const ctx = createOverlayContext();
      const { container, unmount } = render(
        <SingleRowColumnMarqueeToolArea className="test-single-row-column-area" overlayCtxRef={{ current: ctx }} />
      );
      const toolArea = container.firstElementChild as HTMLDivElement;

      fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, ...canvas(5, 20) });
      fireEvent.pointerMove(toolArea, { button: 0, pointerId: 1, ...canvas(5, 60) });

      unmount();

      // The overlay is cleared on the way out too, so a band aimed at the old tool does not stay
      // painted over the next tool's canvas.
      expect(selectionEdits()).toEqual([]);
      expect(ctx.clearRect).toHaveBeenCalled();
    });
  });

  describe('the document gesture gate', () => {
    it('claims the document on the press that opens a draft, and releases it on the release', () => {
      const toolArea = renderArea();

      fireEvent.pointerDown(toolArea, { button: 0, pointerId: 4, ...canvas(5, 20) });

      // Held for the whole gesture, which is the window a document-mutating shortcut must not
      // reach — the commit lands on release, so a shortcut in between would truncate the very
      // timeline the pending commit appends to.
      expect(isDocumentGestureOpen()).toBe(true);
      expect(readDocumentGesture()).toEqual({ kind: 'single-row-marquee', pointerId: 4 });

      act(() => {
        fireEvent.pointerUp(toolArea, { button: 0, pointerId: 4, ...canvas(5, 20) });
      });

      expect(isDocumentGestureOpen()).toBe(false);
    });

    it('claims under the COLUMN kind while the column tool is active', () => {
      storeState.toolName = 'single-column-marquee';
      const toolArea = renderArea();

      fireEvent.pointerDown(toolArea, { button: 0, pointerId: 5, ...canvas(5, 20) });

      expect(readDocumentGesture()).toEqual({ kind: 'single-column-marquee', pointerId: 5 });
    });

    it('claims the document for a press that moves an existing band too', () => {
      storeState.selections = [bandSelection(60)];
      storeState.activeSelectionId = 'selection-1';
      const toolArea = renderArea();

      fireEvent.pointerDown(toolArea, { button: 0, pointerId: 6, ...canvas(100, 60) });

      // The move arm commits a document edit too, so the claim is not a property of the create arm.
      expect(readDocumentGesture()).toEqual({ kind: 'single-row-marquee', pointerId: 6 });
    });

    it('releases the claim on the path that commits nothing', () => {
      storeState.totalSize = { width: 0, height: 120 };
      const toolArea = renderArea();

      fireEvent.pointerDown(toolArea, { button: 0, pointerId: 7, ...canvas(0, 20) });
      expect(isDocumentGestureOpen()).toBe(true);

      act(() => {
        fireEvent.pointerUp(toolArea, { button: 0, pointerId: 7, ...canvas(0, 20) });
      });

      // The release is the FIRST statement of the handler, ahead of the commit, so this path gives
      // the claim back too.
      expect(isDocumentGestureOpen()).toBe(false);
    });

    it('releases the claim on pointer leave and on pointer cancel', () => {
      const toolArea = renderArea();

      fireEvent.pointerDown(toolArea, { button: 0, pointerId: 8, ...canvas(5, 20) });
      fireEvent.pointerLeave(toolArea, { button: 0, pointerId: 8, ...canvas(5, 20) });
      expect(isDocumentGestureOpen()).toBe(false);

      fireEvent.pointerDown(toolArea, { button: 0, pointerId: 9, ...canvas(5, 20) });
      fireEvent.pointerCancel(toolArea, { button: 0, pointerId: 9, ...canvas(5, 20) });
      expect(isDocumentGestureOpen()).toBe(false);
    });

    it('releases the claim on unmount, so a gesture that dies mid-drag cannot leave the keyboard dead', () => {
      const { container, unmount } = render(
        <SingleRowColumnMarqueeToolArea
          className="test-single-row-column-area"
          overlayCtxRef={{ current: createOverlayContext() }}
        />
      );
      const toolArea = container.firstElementChild as HTMLDivElement;

      fireEvent.pointerDown(toolArea, { button: 0, pointerId: 10, ...canvas(5, 20) });
      expect(isDocumentGestureOpen()).toBe(true);

      unmount();

      expect(isDocumentGestureOpen()).toBe(false);
    });

    it('claims nothing for a press the pointer pipeline refuses', () => {
      const toolArea = renderArea();

      // A non-primary button starts no band, so there is no gesture for the keyboard to wait on —
      // and a claim taken here would refuse every shortcut until some unrelated drag released it.
      fireEvent.pointerDown(toolArea, { button: 2, pointerId: 11, ...canvas(5, 20) });
      expect(isDocumentGestureOpen()).toBe(false);
    });

    it('claims nothing for a second pointer while one is already down', () => {
      const toolArea = renderArea();

      fireEvent.pointerDown(toolArea, { button: 0, pointerId: 12, ...canvas(5, 20) });
      expect(isDocumentGestureOpen()).toBe(true);

      // `usePointerPosition.isPointerDownValid` refuses a second pointer, and the claim follows
      // that rule: the document still belongs to the first press, not to this one.
      fireEvent.pointerDown(toolArea, { button: 0, pointerId: 13, ...canvas(80, 80) });

      expect(readDocumentGesture()).toEqual({ kind: 'single-row-marquee', pointerId: 12 });
    });

    it('gives the claim to a second tool once the first one has released it', () => {
      const toolArea = renderArea();

      // The control for the two cases above: the same surface claims again immediately after a
      // release, so the refusals read as refusals and not as a permanently dead slot.
      gesture(toolArea, [canvas(5, 20)], 14);
      expect(isDocumentGestureOpen()).toBe(false);

      fireEvent.pointerDown(toolArea, { button: 0, pointerId: 15, ...canvas(5, 40) });
      expect(readDocumentGesture()).toEqual({ kind: 'single-row-marquee', pointerId: 15 });
    });
  });

  describe('the live-aim preview', () => {
    it('strokes the band being aimed as a dashed closed path, with no anchor dots', () => {
      const ctx = createOverlayContext();
      const toolArea = renderArea(ctx);

      fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, ...canvas(5, 20) });
      fireEvent.pointerMove(toolArea, { button: 0, pointerId: 1, ...canvas(5, 40) });

      // The band for row 40 is (0,40) to (200,41), and the preview is its four corners as a
      // closed path. Deliberately not `drawSelectionOutline`: that draws a white dot on every
      // vertex, and the corners of a 1-pixel band are not draggable in Photoshop — the band is
      // placed by the press, not by dragging its handles.
      expect(ctx.moveTo).toHaveBeenCalledWith(0, 40);
      expect(ctx.lineTo).toHaveBeenCalledWith(200, 40);
      expect(ctx.lineTo).toHaveBeenCalledWith(200, 41);
      expect(ctx.lineTo).toHaveBeenCalledWith(0, 41);
      expect(ctx.closePath).toHaveBeenCalled();
      expect(ctx.setLineDash).toHaveBeenCalledWith([6, 4]);
      expect(ctx.stroke).toHaveBeenCalled();
    });

    it('re-aims the preview on every move, so the band follows the pointer during the drag', () => {
      const ctx = createOverlayContext();
      const toolArea = renderArea(ctx);

      fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, ...canvas(5, 20) });
      fireEvent.pointerMove(toolArea, { button: 0, pointerId: 1, ...canvas(5, 40) });
      fireEvent.pointerMove(toolArea, { button: 0, pointerId: 1, ...canvas(5, 70) });

      // Two previews, each a full repaint of the one shared overlay context.
      expect(ctx.clearRect).toHaveBeenCalledTimes(3); // mount + one per move
      expect(ctx.moveTo).toHaveBeenCalledWith(0, 70);
    });

    it('previews a COLUMN band as the transposed rectangle', () => {
      storeState.toolName = 'single-column-marquee';
      const ctx = createOverlayContext();
      const toolArea = renderArea(ctx);

      fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, ...canvas(70, 5) });
      fireEvent.pointerMove(toolArea, { button: 0, pointerId: 1, ...canvas(90, 5) });

      expect(ctx.moveTo).toHaveBeenCalledWith(90, 0);
      expect(ctx.lineTo).toHaveBeenCalledWith(91, 0);
      expect(ctx.lineTo).toHaveBeenCalledWith(91, 120);
      expect(ctx.lineTo).toHaveBeenCalledWith(90, 120);
    });

    /**
     * The overlay is painted in CANVAS coordinates: `drawSelectionOutline` maps each stored point
     * through `documentToCanvasPoint` before it draws, and `useRect` is handed `initialRect` as
     * `pos - frame` (`RectangularSelectionToolArea.test.tsx:196` pins that subtraction). The live
     * preview is the transient twin of that outline, so it converts the same way; it was a
     * `it.fails` tripwire because it handed `rectCorners(rectForAxis(axis))` — a DOCUMENT-space
     * rect — straight to the painter, so on a cropped document the band being aimed at was drawn a
     * whole frame origin away from the pointer aiming it.
     *
     * The press below is canvas (5, 40) with the frame at (30, 40), i.e. document row 80, and
     * document row 80 sits at canvas y=40. That is where the preview belongs and where the
     * committed band's outline lands too, since both convert once and only once.
     */
    it('paints the live preview where the pointer is, on a cropped document', () => {
      storeState.documentFrame = OFFSET_FRAME;
      const ctx = createOverlayContext();
      const toolArea = renderArea(ctx);

      fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, ...canvas(5, 40) });
      fireEvent.pointerMove(toolArea, { button: 0, pointerId: 1, ...canvas(5, 40) });

      expect(ctx.moveTo).toHaveBeenCalledWith(-30, 40);
      expect(ctx.lineTo).toHaveBeenCalledWith(170, 40);
      expect(ctx.lineTo).toHaveBeenCalledWith(170, 41);
      expect(ctx.lineTo).toHaveBeenCalledWith(-30, 41);
    });

    it('clears the overlay on release, so the preview does not outlive the gesture', () => {
      const ctx = createOverlayContext();
      const toolArea = renderArea(ctx);

      gesture(toolArea, [canvas(5, 20), canvas(5, 40)]);

      // Mount, one move, and the release's repaint. The release repaints from the store, which
      // does not have the committed band yet in this mocked store, so the overlay ends empty —
      // which is the correct thing for a context the store has not caught up with.
      expect(ctx.clearRect).toHaveBeenCalledTimes(3);
    });

    it('paints the moved band during a move drag, in place of the stored one', () => {
      storeState.selections = [bandSelection(60)];
      storeState.activeSelectionId = 'selection-1';
      const ctx = createOverlayContext();
      const toolArea = renderArea(ctx);

      fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, ...canvas(100, 60) });
      fireEvent.pointerMove(toolArea, { button: 0, pointerId: 1, ...canvas(100, 90) });

      // The move arm overrides the selection in the repaint rather than drawing a preview path,
      // so the band's own outline is drawn at the dragged position — the same painter the
      // committed selection uses, which is why there is no second dash pattern to look for.
      expect(ctx.moveTo).toHaveBeenCalledWith(0, 90);
      expect(ctx.lineTo).toHaveBeenCalledWith(200, 90);
      expect(ctx.lineTo).toHaveBeenCalledWith(200, 91);
      expect(ctx.lineTo).toHaveBeenCalledWith(0, 91);
    });
  });

  describe('the shared tool-name surface', () => {
    it('answers to exactly the two names its geometry module declares', () => {
      // The store mock answers with `storeState.toolName`, so a name the module does not declare
      // could not be set here at all; this case pins the pair the component reads.
      expect(BOTH_TOOL_NAMES).toEqual(['single-row-marquee', 'single-column-marquee']);
    });

    it('treats any other tool name as the ROW tool, because the column is the only exception', () => {
      // `isColumn` is one `===`, so the row is the default arm and every other name behaves like
      // a row rather than mounting a dead surface. The cast is what a caller passing a third name
      // would have to write, and it is why the narrowing is pinned.
      storeState.toolName = 'rectangular-selection' as SingleRowOrColumnMarqueeToolName;
      const toolArea = renderArea();

      gesture(toolArea, [canvas(5, 20)]);

      expect(dispatchMock).toHaveBeenNthCalledWith(1, {
        type: 'START_SELECTION_DRAFT',
        payload: { sourceTool: SINGLE_ROW_MARQUEE_SOURCE_TOOL },
      });
      expect(singleSelectionEdit().payload.updates.selections[0].pos).toEqual({
        x: 0,
        y: 20,
        width: 200,
        height: 1,
      });
    });
  });
});

/**
 * The exactness of the committed geometry, read back through the store's own readers rather than
 * through the component's builders. `Point` is imported for that reason and nothing else: a band
 * described by its absolute corners is the one shape a reader can check by eye.
 */
describe('committed band geometry, read through the store readers', () => {
  beforeEach(() => {
    dispatchMock.mockClear();
    pointerState.activePointer = null;
    storeState.toolName = 'single-row-marquee';
    storeState.totalSize = { width: 200, height: 120 };
    storeState.selections = [];
    storeState.activeSelectionId = null;
    storeState.documentFrame = null;
    resetDocumentGestures();
  });

  it('has absolute corners on the two rows the band covers, and on no others', () => {
    const toolArea = renderArea();

    gesture(toolArea, [canvas(5, 30)]);

    const [selection] = singleSelectionEdit().payload.updates.selections;
    const corners: Point[] = selection.points.map((point) => ({
      x: point.x + selection.pos.x,
      y: point.y + selection.pos.y,
    }));
    const rows = corners.map((point) => point.y);

    expect([...new Set(rows)].sort()).toEqual([30, 31]);
    expect([...new Set(corners.map((point) => point.x))].sort()).toEqual([0, 200]);
  });
});
