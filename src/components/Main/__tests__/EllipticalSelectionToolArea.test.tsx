import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { EllipticalSelectionToolArea } from '../EllipticalSelectionToolArea.tsx';
import {
  ELLIPTICAL_SELECTION_SOURCE_TOOL,
  type EllipticalSelectionToolArgs,
} from '../../../tools/ellipticalSelection.ts';
import { clearSelectionDragPreview, readSelectionDragPreview } from '../../../hooks/selection-drag-preview.ts';
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
 * on its own drag record and refuses a move, a release or an abort whose id is not the one the
 * press took (`EllipticalSelectionToolArea.tsx:181`, `:221`, `:276`). A double that let every
 * event through would let a second pointer steer a drag it did not start, and every case below
 * would still pass.
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

/**
 * A committed polygon over the TOP-LEFT 20x20 of the document, so a case can press outside it.
 *
 * `points` are NORMALIZED to the selection's own origin and `pos` offsets them
 * (`getSelectionAbsolutePoints`), so its absolute corners are (0,0) to (20,20) — which is what
 * makes the hit test's answer readable, and why a press at (100, 60) opens a draft while a press
 * at (10, 10) grabs this one.
 */
const cornerSelection = (): Selection => ({
  ...coveringSelection(),
  pos: { x: 0, y: 0, width: 20, height: 20 },
  points: [
    { x: 0, y: 0 },
    { x: 20, y: 0 },
    { x: 20, y: 20 },
    { x: 0, y: 20 },
  ],
});

const renderArea = (ctx = createOverlayContext()) => {
  const { container } = render(
    <EllipticalSelectionToolArea className="test-elliptical-selection-area" overlayCtxRef={{ current: ctx }} />
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
    // The drag channel is a module-level slot that outlives any one mount, so an entry a case
    // leaves behind is read by the ants loop of the NEXT one — which is the same reason
    // `document-gesture.ts` needs its own reset. Cleared on both sides of every case so neither a
    // leak out of one nor an inherited entry into another can be what an assertion below sees.
    clearSelectionDragPreview();
  });

  afterEach(() => {
    clearSelectionDragPreview();
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
    // that is also the right behaviour — it is what `drawSelectionAnchors` returns before painting
    // for, and what `findSelectionAnchorAtPoint` returns `null` for, and a tessellated ellipse must
    // carry neither per-vertex handles nor an anchor hit-test. `src/tools/ellipticalSelection.ts:37`-`:48`
    // is where that rule is stated once; the border itself no longer consults the source at all,
    // because the marching ants stroke every active selection whatever made it.
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

  /**
   * TRIPWIRE — a known-broken behaviour, pinned as `it.fails`. Remove this case in the same
   * change that fixes the move arm; `AGENTS.md` is explicit that a `test.fails` is a tripwire
   * for broken behaviour and is deleted, not reworded, by the fix.
   *
   * `EllipticalSelectionToolArea.tsx:205-209` computes each frame's `delta` against `drag.origin`,
   * which line 208 then ADVANCES, and applies it to `drag.baseline`, which never advances. So the
   * net displacement of a multi-frame drag is not the sum of its frames — it is the LAST frame
   * alone. A user who drags a selection out and back releases it somewhere they never took it.
   *
   * The one-frame move case above cannot see this, and the reason is arithmetic rather than a
   * missing branch: with a single `pointerMove` the last delta IS the whole delta, so
   * `moveSelectionByDelta(baseline, delta)` and `moveSelectionByDelta(preview, delta)` return the
   * same selection. Every move-drag case in this file issues exactly one move, so the suite is
   * blind to the difference by construction rather than by accident.
   */
  it.fails('commits nothing for a move drag that went out and came back to the press point', () => {
    storeState.selections = [coveringSelection()];
    storeState.activeSelectionId = 'selection-1';
    const baseline = storeState.selections[0];
    const toolArea = renderArea();

    fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, clientX: 100, clientY: 60 });
    // OUT to (160, 100): the first frame's delta is (+60, +40).
    fireEvent.pointerMove(toolArea, { button: 0, pointerId: 1, clientX: 160, clientY: 100 });
    // BACK to the press point: the second frame's delta is (-60, -40), and the two sum to zero.
    fireEvent.pointerMove(toolArea, { button: 0, pointerId: 1, clientX: 100, clientY: 60 });
    fireEvent.pointerUp(toolArea, { button: 0, pointerId: 1, clientX: 100, clientY: 60 });

    // The claim is that the NET displacement is zero, and a zero net displacement is observed
    // through the release gate rather than through a committed position: the preview ends back on
    // the baseline's own geometry, `hasSameSelectionGeometry` suppresses the commit
    // (`EllipticalSelectionToolArea.tsx:235`), and the gesture writes nothing at all — the same
    // contract the zero-delta case below pins for the one-frame shape of the same gesture.
    //
    // What it does today instead: `drag.origin` advanced to (160, 100) and then to (100, 60), so
    // the second frame's delta of (-60, -40) is applied to the never-moved `drag.baseline`, and
    // the commit lands the selection at (-60, -40) — off the top-left corner of a document that
    // starts at the origin, for a gesture the user drew out and retracted in one piece.
    expect(selectionEdits()).toEqual([]);

    // The control that makes the assertion above about the out-and-back and nothing else: a
    // second, ordinary single-frame drag on the same mount, with the same pointer and the same
    // store, still enters the move arm and still commits — so the empty assertion above is not
    // passing because the arm never ran. This is independent of the defect, which is the property
    // that makes it a control.
    fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, clientX: 100, clientY: 60 });
    fireEvent.pointerMove(toolArea, { button: 0, pointerId: 1, clientX: 120, clientY: 80 });
    fireEvent.pointerUp(toolArea, { button: 0, pointerId: 1, clientX: 120, clientY: 80 });

    const [moved] = singleSelectionEdit().payload.updates.selections;
    expect(moved.pos).toEqual({ x: 20, y: 20, width: 200, height: 120 });
    // And the control's whole delta is still the whole delta, because with one frame the two
    // accumulators agree — which is exactly why the one-frame cases above cannot pin the defect.
    expect(moved.pos).not.toEqual(baseline.pos);
  });

  it('commits the whole drag for a move drag whose frames all travel the same way', () => {
    storeState.selections = [coveringSelection()];
    storeState.activeSelectionId = 'selection-1';
    const toolArea = renderArea();

    fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, clientX: 100, clientY: 60 });
    fireEvent.pointerMove(toolArea, { button: 0, pointerId: 1, clientX: 120, clientY: 80 });
    fireEvent.pointerMove(toolArea, { button: 0, pointerId: 1, clientX: 140, clientY: 100 });
    fireEvent.pointerMove(toolArea, { button: 0, pointerId: 1, clientX: 160, clientY: 120 });
    fireEvent.pointerUp(toolArea, { button: 0, pointerId: 1, clientX: 160, clientY: 120 });

    const [moved] = singleSelectionEdit().payload.updates.selections;
    expect(moved.pos).toEqual({ x: 60, y: 60, width: 200, height: 120 });
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

  /**
   * THE tripwire for the border's ownership — inverted, because the ownership moved.
   *
   * The ants canvas is the selection border for EVERY selection tool, this one included, and not
   * for the polygon ones alone; the reasoning and Adobe's own selection-tools table behind that are
   * `Main.tsx:39`-`:51`. So the claim here is a NEGATIVE one: a committed selection sitting in the
   * store puts nothing on this overlay. The static stroke that used to stand here painted the same
   * selection twice, in two colours on two canvases, and the second copy could not follow the
   * pointer — which is why the move arm has no representation here at all and publishes instead.
   *
   * The fixture is a selection this tool ITSELF commits, carrying `ELLIPTICAL_SELECTION_SOURCE_TOOL`
   * rather than the polygonal lasso the shared fixture uses, so that the case stays about the tool
   * that produces the selection it is asked to ignore. `points` are NORMALIZED to the selection's
   * own origin and `pos` offsets them (`getSelectionAbsolutePoints`), so its border would have been
   * drawn at pos + points — the coordinate the first assertion below is written against, and the
   * one a re-added stroke would come back with.
   */
  it('paints no committed border on the tool overlay, because the ants canvas owns it', () => {
    storeState.selections = [
      {
        ...coveringSelection(),
        sourceTool: ELLIPTICAL_SELECTION_SOURCE_TOOL,
        pos: { x: 20, y: 30, width: 100, height: 60 },
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 100, y: 60 },
          { x: 0, y: 60 },
        ],
      },
    ];
    storeState.activeSelectionId = 'selection-1';
    const ctx = createOverlayContext();
    const toolArea = renderArea(ctx);

    // The mount repaint is the observation. Not one dash, not one vertex, not one `arc`: this
    // overlay paints the live marquee or nothing at all.
    expect(ctx.moveTo).not.toHaveBeenCalledWith(20, 30);
    expect(ctx.lineTo).not.toHaveBeenCalled();
    expect(ctx.stroke).not.toHaveBeenCalled();
    expect(ctx.setLineDash).not.toHaveBeenCalled();
    expect(ctx.arc).not.toHaveBeenCalled();

    // The control that makes those five mean something: the SAME context, on the SAME mount,
    // strokes the dashed marquee as soon as a NEW ellipse is being dragged — and the committed
    // selection's own corner is still absent from it. So the overlay is not silent because it
    // cannot paint; it is silent about the committed border specifically.
    fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(toolArea, { button: 0, pointerId: 1, clientX: 60, clientY: 40 });

    expect(ctx.setLineDash).toHaveBeenCalledWith([6, 4]);
    expect(ctx.stroke).toHaveBeenCalled();
    expect(ctx.moveTo).not.toHaveBeenCalledWith(20, 30);
  });

  it('publishes the DRAGGED selection to the ants channel, and the release clears it', () => {
    storeState.selections = [coveringSelection()];
    storeState.activeSelectionId = 'selection-1';
    const toolArea = renderArea();

    fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, clientX: 100, clientY: 60 });
    // The press alone publishes nothing: a preview exists only once a frame has run, and the ants
    // have the committed selection to paint until then.
    expect(readSelectionDragPreview()).toBeNull();

    fireEvent.pointerMove(toolArea, { button: 0, pointerId: 1, clientX: 120, clientY: 80 });

    // `follow`, not `marquee`: the ants must keep showing THIS selection's border and hold its dash
    // while it moves, rather than clearing their canvas for a draft nobody drew. And the geometry
    // is the dragged one — the stored baseline was at (0, 0) and the pointer moved it by (20, 20).
    expect(readSelectionDragPreview()).toEqual({
      kind: 'follow',
      selection: expect.objectContaining({
        id: 'selection-1',
        pos: { x: 20, y: 20, width: 200, height: 120 },
      }),
    });

    fireEvent.pointerUp(toolArea, { button: 0, pointerId: 1, clientX: 120, clientY: 80 });

    // The slot is a module-level variable that outlives the gesture, so the release is what gives
    // the ants their crawl back; a stale `follow` would freeze the border for every later tool.
    expect(readSelectionDragPreview()).toBeNull();
  });

  it('clears the ants channel on the abort route, which leaves the store holding the un-moved band', () => {
    storeState.selections = [coveringSelection()];
    storeState.activeSelectionId = 'selection-1';
    const toolArea = renderArea();

    fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, clientX: 100, clientY: 60 });
    fireEvent.pointerMove(toolArea, { button: 0, pointerId: 1, clientX: 120, clientY: 80 });
    // Read before the abort, so the `null` below is a clearing rather than a slot that was empty.
    expect(readSelectionDragPreview()).not.toBeNull();

    fireEvent.pointerCancel(toolArea, { button: 0, pointerId: 1, clientX: 120, clientY: 80 });

    expect(readSelectionDragPreview()).toBeNull();
    // Nothing was committed either, and nothing needed to be: the store still shows the un-moved
    // selection, so the ants pick its geometry up again the moment the preview above is gone.
    expect(selectionEdits()).toEqual([]);
  });

  it('clears the ants channel on unmount, which is the route that looks least like a gesture', () => {
    storeState.selections = [coveringSelection()];
    storeState.activeSelectionId = 'selection-1';
    // Rendered here rather than through `renderArea` because this is the one case that needs the
    // `unmount` handle; every other case only wants the element.
    const { container, unmount } = render(
      <EllipticalSelectionToolArea className="test-elliptical-selection-area" overlayCtxRef={{ current: null }} />
    );
    const toolArea = container.firstElementChild as HTMLDivElement;

    fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, clientX: 100, clientY: 60 });
    fireEvent.pointerMove(toolArea, { button: 0, pointerId: 1, clientX: 120, clientY: 80 });
    expect(readSelectionDragPreview()).not.toBeNull();

    unmount();

    // Nothing about an unmount looks like a pointer event, so this is the route that gets dropped
    // when the other three are wired. The slot outlives the mount; an entry left in it would freeze
    // the ants on a selection this tool no longer serves.
    expect(readSelectionDragPreview()).toBeNull();
  });

  it('publishes NOTHING during a create gesture, so the committed border behind it keeps marching', () => {
    storeState.selections = [cornerSelection()];
    storeState.activeSelectionId = 'selection-1';
    const toolArea = renderArea();

    // (100, 60) is outside the 20x20 committed polygon, so this press opens a draft and aims a
    // NEW ellipse rather than moving the committed one.
    fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, clientX: 100, clientY: 60 });
    fireEvent.pointerMove(toolArea, { button: 0, pointerId: 1, clientX: 120, clientY: 80 });

    // Silence, and it is deliberate: a new ellipse is a different shape from the committed one, so
    // both are true at once and Photoshop shows both — the marquee on the overlay and the committed
    // border crawling behind it. Publishing `marquee` instead would tell the ants to clear their
    // canvas (`selection-drag-preview.ts:19`-`:21`, and the branch that reads it at
    // `useSelectionAnts.ts:129`), and the committed border would blink out under the drag.
    expect(readSelectionDragPreview()).toBeNull();
    expect(draftDispatches()).toHaveLength(1);

    // The control that makes the `null` above mean something: the press INSIDE the same committed
    // polygon on the same mount is the move arm, and the very same reader returns its band. So the
    // create arm is silent, not the channel.
    fireEvent.pointerUp(toolArea, { button: 0, pointerId: 1, clientX: 120, clientY: 80 });
    fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(toolArea, { button: 0, pointerId: 1, clientX: 30, clientY: 10 });

    expect(readSelectionDragPreview()).toEqual({
      kind: 'follow',
      selection: expect.objectContaining({
        id: 'selection-1',
        pos: { x: 20, y: 0, width: 20, height: 20 },
      }),
    });
  });
});
