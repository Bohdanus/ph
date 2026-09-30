import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { EraserToolArea } from '../EraserToolArea.tsx';
import { isDocumentGestureOpen, readDocumentGesture, resetDocumentGestures } from '../../../hooks/document-gesture.ts';
import type { Layer, LayersRecord } from '../../../contexts/layer-types.ts';

const updateLayerByToolMock = vi.hoisted(() => vi.fn());
const tempUpdateLayerMock = vi.hoisted(() => vi.fn());
const createLayerFromToolMock = vi.hoisted(() => vi.fn());
const pointerState = vi.hoisted(() => ({ isMouseDown: { current: false }, activePointer: null as number | null }));
const storeState = vi.hoisted(
  (): {
    documentFrame: { x: number; y: number; width: number; height: number } | null;
    layers: LayersRecord;
    activeLayerId: string | null;
  } => ({
    documentFrame: null,
    layers: {},
    activeLayerId: null,
  })
);
const toolState = vi.hoisted((): { toolArgs: Record<string, unknown> } => ({
  toolArgs: { toolName: 'eraser', mode: 'pencil', alpha: 1, color: '#000000', lineWidth: 10, points: [] },
}));

vi.mock('../../../contexts/StoreContext.tsx', () => ({
  useStore: () => [
    {
      containerRef: { current: document.createElement('div') },
      totalSize: { width: 300, height: 200 },
      get layers() {
        return storeState.layers;
      },
      get activeLayerId() {
        return storeState.activeLayerId;
      },
      get documentFrame() {
        return storeState.documentFrame;
      },
    },
    vi.fn(),
  ],
}));

/**
 * `createLayerFromTool` is present in the mock on purpose even though the component must never
 * reach it. A `useLayers` mock that simply omitted it would make the dead-eraser bug a `TypeError`
 * rather than an assertion, and a test that cannot fail on the defect is not a pin.
 */
vi.mock('../../../contexts/useLayer.ts', () => ({
  useLayers: () => ({
    updateLayerByTool: updateLayerByToolMock,
    tempUpdateLayer: tempUpdateLayerMock,
    createLayerFromTool: createLayerFromToolMock,
  }),
}));

vi.mock('../../../contexts/useCurrentTool.tsx', () => ({
  useCurrentTool: () => ({ toolArgs: toolState.toolArgs }),
}));

/**
 * A faithful stand-in for the real `usePointerPosition` capture contract: the first `pointerDown`
 * claims the pointer, and only that pointer's move/up are valid. A mock that let every event
 * through would make "a stray pointerup with no gesture in flight commits a stroke" unobservable,
 * which is exactly the shape the guards exist to prevent. The pointer ID is tracked rather than a
 * boolean, so "a foreign pointer's release must not hand the document back" is observable too —
 * which the document gesture gate below pins.
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

const makeLayer = (id: string, pos: Layer['pos']): Layer => ({
  id,
  name: id,
  isBedrock: false,
  tmpCanvas: null,
  bitmap: null,
  visible: true,
  opacity: 1,
  locked: false,
  blendMode: 'source-over',
  order: 0,
  pos,
  operations: [],
});

const renderArea = () => {
  const { container, unmount } = render(<EraserToolArea className="test-eraser-area" />);
  return { toolArea: container.firstElementChild as HTMLDivElement, unmount };
};

const stroke = (toolArea: HTMLDivElement, from: number[], ...to: number[][]) => {
  fireEvent.pointerDown(toolArea, { button: 0, clientX: from[0], clientY: from[1] });
  for (const [clientX, clientY] of to) {
    fireEvent.pointerMove(toolArea, { button: 0, clientX, clientY });
  }
  const [lastX, lastY] = to[to.length - 1] ?? from;
  fireEvent.pointerUp(toolArea, { button: 0, clientX: lastX, clientY: lastY });
};
describe('EraserToolArea', () => {
  beforeEach(() => {
    updateLayerByToolMock.mockClear();
    createLayerFromToolMock.mockClear();
    pointerState.isMouseDown.current = false;
    pointerState.activePointer = null;
    storeState.documentFrame = null;
    storeState.layers = { base: makeLayer('base', { x: 0, y: 0, width: 300, height: 200 }) };
    storeState.activeLayerId = 'base';
    toolState.toolArgs = {
      toolName: 'eraser',
      mode: 'pencil',
      alpha: 1,
      color: '#000000',
      lineWidth: 10,
      points: [],
    };
  });

  it('edits the active layer instead of creating one', () => {
    const { toolArea } = renderArea();

    stroke(toolArea, [40, 50], [120, 80], [200, 110]);

    // The assertion that would have caught the dead eraser. `DrawToolArea` commits through
    // `createLayerFromTool`, which yields a NEW layer holding a transparent hole — that composites
    // as nothing, so the tool would be selectable, draggable and visibly inert.
    expect(createLayerFromToolMock).not.toHaveBeenCalled();
    expect(updateLayerByToolMock).toHaveBeenCalledTimes(1);

    // No `id` is passed: the hook's own `= activeLayerId` default is what targets the active layer,
    // so a commit that named no layer at all is still unambiguously an ACTIVE-LAYER edit.
    const [params] = updateLayerByToolMock.mock.calls[0] as [{ id?: unknown; toolArgs: Record<string, unknown> }];
    expect(params.id).toBeUndefined();
    expect(params.toolArgs).toMatchObject({ toolName: 'eraser', mode: 'pencil', lineWidth: 10 });
  });

  it('records one commit per gesture rather than one per pointer event', () => {
    const { toolArea } = renderArea();

    stroke(toolArea, [10, 20], [30, 50], [60, 70], [90, 100], [120, 130], [150, 160]);

    // Four pointer moves and a release. A commit per pointer event is the exact defect the
    // architecture constraints forbid, and it would make a single stroke five history states.
    expect(updateLayerByToolMock).toHaveBeenCalledTimes(1);
  });

  it('records one commit for a click that never moves', () => {
    const { toolArea } = renderArea();

    stroke(toolArea, [70, 70]);

    expect(updateLayerByToolMock).toHaveBeenCalledTimes(1);
    const [params] = updateLayerByToolMock.mock.calls[0] as [{ toolArgs: { points: { x: number; y: number }[] } }];
    expect(params.toolArgs.points).toEqual([{ x: 70, y: 70 }]);
  });

  it('commits the stroke in the active layer local frame and never crops it', () => {
    storeState.layers = { base: makeLayer('base', { x: 30, y: 20, width: 300, height: 200 }) };
    storeState.activeLayerId = 'base';
    const { toolArea } = renderArea();

    stroke(toolArea, [40, 50], [120, 80], [200, 110]);

    // `updateLayerByTool` takes no `pos`, so the layer cannot be resized by a stroke. The points
    // are shifted into the layer's own frame and the stroke is NOT cropped to its bounding box the
    // way `DrawToolArea` does — cropping would shrink the destination out from under the erase.
    const [params] = updateLayerByToolMock.mock.calls[0] as [{ toolArgs: { points: { x: number; y: number }[] } }];
    expect(params.toolArgs.points).toEqual([
      { x: 10, y: 30 },
      { x: 90, y: 60 },
      { x: 170, y: 90 },
    ]);
  });

  it('converts canvas coordinates through the document frame before reaching the layer', () => {
    storeState.documentFrame = { x: 10, y: 15, width: 300, height: 200 };
    storeState.layers = { base: makeLayer('base', { x: 10, y: 15, width: 300, height: 200 }) };
    storeState.activeLayerId = 'base';
    const { toolArea } = renderArea();

    stroke(toolArea, [40, 50], [120, 80]);

    const [params] = updateLayerByToolMock.mock.calls[0] as [{ toolArgs: { points: { x: number; y: number }[] } }];
    expect(params.toolArgs.points).toEqual([
      { x: 40, y: 50 },
      { x: 120, y: 80 },
    ]);
  });

  it('ignores a stroke that starts with a non-primary mouse button', () => {
    const { toolArea } = renderArea();

    fireEvent.pointerDown(toolArea, { button: 2, clientX: 10, clientY: 20 });
    fireEvent.pointerUp(toolArea, { button: 2, clientX: 60, clientY: 70 });

    expect(updateLayerByToolMock).not.toHaveBeenCalled();
    expect(tempUpdateLayerMock).not.toHaveBeenCalled();
  });

  it('ignores pointer movement before the button goes down', () => {
    const { toolArea } = renderArea();

    fireEvent.pointerMove(toolArea, { button: 0, clientX: 30, clientY: 50 });
    fireEvent.pointerUp(toolArea, { button: 0, clientX: 30, clientY: 50 });

    expect(updateLayerByToolMock).not.toHaveBeenCalled();
  });

  it('commits nothing when there is no active layer', () => {
    storeState.activeLayerId = null;
    const { toolArea } = renderArea();

    stroke(toolArea, [20, 20], [90, 60]);

    expect(updateLayerByToolMock).not.toHaveBeenCalled();
  });

  it('ignores the gesture when the current tool is not the eraser', () => {
    toolState.toolArgs = {
      toolName: 'draw',
      alpha: 1,
      color: '#000000',
      penType: 'pen',
      lineWidth: 10,
      points: [],
    };
    const { toolArea } = renderArea();

    stroke(toolArea, [20, 20], [90, 60]);

    expect(updateLayerByToolMock).not.toHaveBeenCalled();
    expect(tempUpdateLayerMock).not.toHaveBeenCalled();
  });

  it('coalesces a burst of pointer moves into exactly one live-layer write', () => {
    // The faked clock does NOT confine itself to this test, and the reason it is
    // confined is THIS REPO, not Vitest: `src/test/setup.ts:8` has an
    // `afterEach(() => { cleanup(); vi.useRealTimers(); })`, so the clock is restored
    // after every test in every file. The runner does not do this — measured both
    // ways with a two-test probe, one faking the clock and the next reporting
    // `vi.isFakeTimers()`: with that setup file `false` and both pass, and with a
    // config that omits it `true` and the second test FAILS. Vitest's own teardown
    // restores timers per FILE, not per test, and `isolate: true` is what closes the
    // cross-file direction, not the pool choice.
    //
    // So there is deliberately no `afterEach(() => vi.useRealTimers())` here, and
    // adding one would be noise that reads as a fix. But the guarantee is only as
    // strong as its owner: if `src/test/setup.ts` loses that line, every test after
    // this one in this file inherits a faked clock, and the next reader who trusts
    // this comment instead of the setup file will be wrong. A grep for
    // `useFakeTimers` without a matching `useRealTimers` in the same file reports
    // this as a leak; it is not one, and an earlier pass of this file's own audit
    // reported it as one and wrote a guard for it that could not have failed (it was
    // reverted before it reached a commit, so nothing shipped).
    //
    // Ask with `vi.isFakeTimers()` rather than by waiting on a timer: under a faked
    // clock a `setTimeout` does not merely run late, it does not run, and a test
    // that waits for one fails as a TIMEOUT, which reads like a slow machine rather
    // than like a leak.
    vi.useFakeTimers();
    const { toolArea } = renderArea();

    fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, clientX: 10, clientY: 20 });
    fireEvent.pointerMove(toolArea, { button: 0, pointerId: 1, clientX: 30, clientY: 50 });
    fireEvent.pointerMove(toolArea, { button: 0, pointerId: 1, clientX: 60, clientY: 70 });
    fireEvent.pointerMove(toolArea, { button: 0, pointerId: 1, clientX: 90, clientY: 90 });

    // One write for four events: the pipeline is a flood fill plus a layer-sized canvas, so
    // running it per pointer event is the difference between a smooth stroke and a stuttering
    // one. The ACCUMULATED path is what makes the single write correct — `commit: 'raster'`
    // REPLACES the layer's pixels, so one write carrying only the newest point erases one point.
    vi.advanceTimersByTime(20);

    // The press paints synchronously — it is the only paint a click ever gets — and the three
    // moves share one frame. Two writes, not four: the pipeline is a flood fill plus a
    // layer-sized canvas, so running it per pointer event is the difference between a smooth
    // stroke and a stuttering one.
    expect(tempUpdateLayerMock).toHaveBeenCalledTimes(2);
    const [coalesced] = tempUpdateLayerMock.mock.calls[1] as [{ toolArgs: { points: unknown[] } }];
    // The ACCUMULATED path is what makes the single write correct: `commit: 'raster'`
    // REPLACES the layer's pixels, so one write carrying only the newest point erases one point.
    expect(coalesced.toolArgs.points).toHaveLength(4);
  });

  it('flushes the pending preview on pointer up instead of dropping it', () => {
    const { toolArea } = renderArea();

    fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, clientX: 10, clientY: 20 });
    fireEvent.pointerMove(toolArea, { button: 0, pointerId: 1, clientX: 40, clientY: 60 });
    tempUpdateLayerMock.mockClear();

    // The queued frame is the one that would paint the last point, so the release flushes it
    // before cancelling. Cancelling without flushing silently drops the tail of every stroke.
    fireEvent.pointerUp(toolArea, { button: 0, pointerId: 1, clientX: 40, clientY: 60 });

    expect(tempUpdateLayerMock).toHaveBeenCalledTimes(1);
  });

  it('releases the frame slot on release, so a second stroke previews again', () => {
    const { toolArea } = renderArea();

    stroke(toolArea, [10, 20], [30, 50]);
    tempUpdateLayerMock.mockClear();

    fireEvent.pointerDown(toolArea, { button: 0, pointerId: 2, clientX: 60, clientY: 70 });

    // Cancelling the frame without also clearing the slot would leave it permanently non-null,
    // and every later stroke's preview would be dropped without a word.
    expect(tempUpdateLayerMock).toHaveBeenCalledTimes(1);
  });

  it('does not commit a second time for a release with no gesture in flight', () => {
    const { toolArea } = renderArea();

    stroke(toolArea, [10, 20], [30, 50]);
    fireEvent.pointerUp(toolArea, { button: 0, clientX: 80, clientY: 90 });

    expect(updateLayerByToolMock).toHaveBeenCalledTimes(1);
  });

  it('starts a fresh preview after a stroke was committed', () => {
    const { toolArea } = renderArea();

    stroke(toolArea, [10, 20], [30, 50]);
    tempUpdateLayerMock.mockClear();

    fireEvent.pointerDown(toolArea, { button: 0, pointerId: 3, clientX: 100, clientY: 100 });

    // One point, not the tail of the previous stroke. A points array that survived the commit
    // would re-erase everything already erased on every later stroke.
    const [press] = tempUpdateLayerMock.mock.calls[0] as [{ toolArgs: { points: { x: number; y: number }[] } }];
    expect(press.toolArgs.points).toEqual([{ x: 100, y: 100 }]);
  });

  it('cancels the pending preview frame on unmount', () => {
    const { toolArea, unmount } = renderArea();

    fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, clientX: 10, clientY: 20 });
    fireEvent.pointerMove(toolArea, { button: 0, pointerId: 1, clientX: 40, clientY: 60 });
    const cancel = vi.spyOn(window, 'cancelAnimationFrame');
    tempUpdateLayerMock.mockClear();

    unmount();

    // A frame left pending across an unmount would write to a layer this component no longer
    // owns. `ShapeToolArea` and `useRect` carry the same gap; this is defence in depth.
    expect(cancel).toHaveBeenCalled();
    expect(tempUpdateLayerMock).not.toHaveBeenCalled();
  });

  it('renders a div carrying the supplied className and the draw cursor', () => {
    const { container } = render(<EraserToolArea className="test-eraser-area" />);

    expect(container.firstElementChild).toHaveClass('test-eraser-area', 'cursor-draw');
  });
  it('refuses to erase the bedrock layer, which has nothing beneath it to restore from', () => {
    storeState.layers = { base: { ...makeLayer('base', { x: 0, y: 0, width: 300, height: 200 }), isBedrock: true } };
    storeState.activeLayerId = 'base';
    const { toolArea } = renderArea();

    stroke(toolArea, [20, 20], [90, 60]);

    // Bedrock is the document's own backing image and the floor every other layer composites
    // over. The Eraser is the one tool whose whole job is to punch holes, so erasing it changes
    // the colour of the transparent regions the rest of the stack is judged against and leaves
    // no layer to restore from. `MoveToolArea.tsx:35` reads the same flag for the same reason,
    // as do `SmudgeToolArea`, `DodgeToolArea`, `CloneStampToolArea` and `FillToolArea`.
    expect(tempUpdateLayerMock).not.toHaveBeenCalled();
    expect(updateLayerByToolMock).not.toHaveBeenCalled();
  });
});

it('refuses to erase the bedrock layer, which has nothing beneath it to restore from', () => {
  storeState.layers = { base: { ...makeLayer('base', { x: 0, y: 0, width: 300, height: 200 }), isBedrock: true } };
  storeState.activeLayerId = 'base';
  const { toolArea } = renderArea();

  stroke(toolArea, [20, 20], [90, 60]);

  // Bedrock is the document's own backing image and the floor every other layer composites
  // over. The Eraser is the one tool whose whole job is to punch holes, so erasing it changes
  // the colour of the transparent regions the rest of the stack is judged against and leaves
  // no layer to restore from. `MoveToolArea.tsx:35` reads the same flag for the same reason,
  // as do `SmudgeToolArea`, `DodgeToolArea`, `CloneStampToolArea` and `FillToolArea`.
  expect(tempUpdateLayerMock).not.toHaveBeenCalled();
  expect(updateLayerByToolMock).not.toHaveBeenCalled();
});

describe('document gesture gate', () => {
  beforeEach(() => {
    // The slot is module-level, so a leaked claim would refuse every later claim in this file
    // and read as a dozen unrelated failures.
    resetDocumentGestures();
    // The pointer double is module-level for the same reason, and this describe is a SIBLING of
    // the one that resets it: without this a case that ends in a cancel — which the double does
    // not model, because the hook's own tracking is what a cancel clears — would leave the next
    // case's press refused and read as a claim that was never taken.
    pointerState.activePointer = null;
    pointerState.isMouseDown.current = false;
    storeState.activeLayerId = 'base';
    storeState.layers = { base: makeLayer('base', { x: 0, y: 0, width: 300, height: 200 }) };
  });

  const renderGate = () => {
    const view = render(<EraserToolArea className="test-eraser-area" />);
    return { view, toolArea: view.container.firstElementChild as HTMLDivElement };
  };

  it('claims the document for an eraser stroke and releases it on the release', () => {
    const { toolArea } = renderGate();

    fireEvent.pointerDown(toolArea, { button: 0, pointerId: 7, clientX: 10, clientY: 20 });
    expect(isDocumentGestureOpen()).toBe(true);
    expect(readDocumentGesture()).toEqual({ kind: 'eraser-stroke', pointerId: 7 });

    fireEvent.pointerMove(toolArea, { button: 0, pointerId: 7, clientX: 60, clientY: 40 });
    // Still held mid-stroke, which is the entire window the gate exists for.
    expect(isDocumentGestureOpen()).toBe(true);

    fireEvent.pointerUp(toolArea, { button: 0, pointerId: 7, clientX: 60, clientY: 40 });

    expect(updateLayerByToolMock).toHaveBeenCalledTimes(1);
    expect(isDocumentGestureOpen()).toBe(false);
  });

  it('releases the claim before the commit path, so a release that commits nothing still frees the keyboard', () => {
    storeState.activeLayerId = null;
    const { toolArea } = renderGate();

    fireEvent.pointerDown(toolArea, { button: 0, pointerId: 7, clientX: 10, clientY: 20 });
    expect(isDocumentGestureOpen()).toBe(true);

    fireEvent.pointerUp(toolArea, { button: 0, pointerId: 7, clientX: 10, clientY: 20 });

    // No active layer, so `updateLayerByTool` is never reached — and the release is
    // the first statement inside the `isPointerUpValid` branch, which is what covers
    // that early return and every other one like it.
    expect(updateLayerByToolMock).not.toHaveBeenCalled();
    expect(isDocumentGestureOpen()).toBe(false);
  });

  it('does not let a foreign pointer release the claim it never took', () => {
    const { toolArea } = renderGate();

    fireEvent.pointerDown(toolArea, { button: 0, pointerId: 7, clientX: 10, clientY: 20 });
    expect(isDocumentGestureOpen()).toBe(true);

    // A second pointer on this surface. The claim is released inside the
    // `isPointerUpValid` branch, so a release the validator refuses cannot hand the
    // document back on the first pointer's behalf.
    fireEvent.pointerUp(toolArea, { button: 0, pointerId: 99, clientX: 60, clientY: 40 });

    expect(updateLayerByToolMock).not.toHaveBeenCalled();
    expect(isDocumentGestureOpen()).toBe(true);
  });

  it('releases the claim on a pointer cancel, which is the abort route', () => {
    const { toolArea } = renderGate();

    fireEvent.pointerDown(toolArea, { button: 0, pointerId: 7, clientX: 10, clientY: 20 });
    expect(isDocumentGestureOpen()).toBe(true);

    // A cancel is a gesture that will never commit, so a claim left open here would
    // gate every later keystroke for a stroke that does not exist.
    fireEvent.pointerCancel(toolArea, { button: 0, pointerId: 7 });

    expect(isDocumentGestureOpen()).toBe(false);
  });

  it('releases the claim on unmount, so a gesture that dies mid-stroke cannot leave the keyboard dead', () => {
    const { view, toolArea } = renderGate();

    fireEvent.pointerDown(toolArea, { button: 0, pointerId: 7, clientX: 10, clientY: 20 });
    expect(isDocumentGestureOpen()).toBe(true);

    view.unmount();

    expect(isDocumentGestureOpen()).toBe(false);
  });

  it('claims nothing for a press the pointer validator refuses', () => {
    const { toolArea } = renderGate();

    // `isPointerDownValid` has already refused a non-primary button and a second
    // pointer, and the claim is taken after it, so a refused press starts no
    // gesture to wait on.
    fireEvent.pointerDown(toolArea, { button: 2, pointerId: 7, clientX: 10, clientY: 20 });

    expect(isDocumentGestureOpen()).toBe(false);
  });
});

/**
 * Adobe's straight line: "place the pointer where you want the line to start, press and hold
 * Shift, and then click where you want the line to end".
 * <https://helpx.adobe.com/photoshop/using/painting-tools.html>
 *
 * A two-CLICK gesture, so it cannot live in the drag: the press that arms it is a full stroke of
 * its own in Photoshop, and the Shift-click that finishes it replaces the drag rather than
 * starting one. Both halves are asserted, because a component that drew the line but also
 * committed the freehand stroke that came with it would erase twice and cost two undo steps.
 */
describe('EraserToolArea straight line', () => {
  beforeEach(() => {
    updateLayerByToolMock.mockClear();
    tempUpdateLayerMock.mockClear();
    pointerState.isMouseDown.current = false;
    pointerState.activePointer = null;
    storeState.documentFrame = null;
    storeState.layers = { base: makeLayer('base', { x: 0, y: 0, width: 300, height: 200 }) };
    storeState.activeLayerId = 'base';
    toolState.toolArgs = {
      toolName: 'eraser',
      mode: 'brush',
      alpha: 1,
      hardness: 50,
      spacing: 25,
      color: '#000000',
      lineWidth: 10,
      points: [],
    };
  });

  const committedPoints = () => {
    const calls = updateLayerByToolMock.mock.calls as [{ toolArgs: { points: { x: number; y: number }[] } }][];
    return calls.map(([params]) => params.toolArgs.points);
  };

  it('commits one straight stroke between the first press and the Shift-click, and nothing else', () => {
    const { toolArea } = renderArea();

    // The arming press: an ordinary stroke, which is also the anchor the line starts from.
    fireEvent.pointerDown(toolArea, { button: 0, clientX: 20, clientY: 30 });
    fireEvent.pointerUp(toolArea, { button: 0, clientX: 20, clientY: 30 });
    expect(committedPoints()).toEqual([[{ x: 20, y: 30 }]]);

    // The Shift-click: two points, not one, and the whole path between them.
    fireEvent.pointerDown(toolArea, { button: 0, shiftKey: true, clientX: 200, clientY: 130 });
    fireEvent.pointerUp(toolArea, { button: 0, shiftKey: true, clientX: 200, clientY: 130 });

    expect(committedPoints()).toEqual([
      [{ x: 20, y: 30 }],
      [
        { x: 20, y: 30 },
        { x: 200, y: 130 },
      ],
    ]);
  });

  it('does not start a freehand stroke on the Shift-click, so a held pointer cannot bend the line', () => {
    const { toolArea } = renderArea();

    fireEvent.pointerDown(toolArea, { button: 0, clientX: 20, clientY: 30 });
    fireEvent.pointerUp(toolArea, { button: 0, clientX: 20, clientY: 30 });
    updateLayerByToolMock.mockClear();
    tempUpdateLayerMock.mockClear();

    fireEvent.pointerDown(toolArea, { button: 0, shiftKey: true, clientX: 200, clientY: 130 });
    fireEvent.pointerMove(toolArea, { button: 0, clientX: 210, clientY: 140 });
    fireEvent.pointerUp(toolArea, { button: 0, clientX: 200, clientY: 130 });

    // The preview is the whole story here: `tempUpdateLayer` IS the live pixel write, so a move
    // that reached it would bend the line the commit then contradicted.
    expect(tempUpdateLayerMock).not.toHaveBeenCalled();
    expect(committedPoints()).toEqual([
      [
        { x: 20, y: 30 },
        { x: 200, y: 130 },
      ],
    ]);
  });

  it('clears the anchor afterwards, so a third click starts a new gesture rather than a second line', () => {
    const { toolArea } = renderArea();

    fireEvent.pointerDown(toolArea, { button: 0, clientX: 20, clientY: 30 });
    fireEvent.pointerUp(toolArea, { button: 0, clientX: 20, clientY: 30 });
    fireEvent.pointerDown(toolArea, { button: 0, shiftKey: true, clientX: 200, clientY: 130 });
    fireEvent.pointerUp(toolArea, { button: 0, shiftKey: true, clientX: 200, clientY: 130 });
    updateLayerByToolMock.mockClear();

    fireEvent.pointerDown(toolArea, { button: 0, shiftKey: true, clientX: 60, clientY: 90 });
    fireEvent.pointerUp(toolArea, { button: 0, shiftKey: true, clientX: 60, clientY: 90 });

    // One point, not two: with no anchor a Shift-click is an ordinary click, which is what keeps
    // a Shift-held pointer from chaining lines off the end of the last one.
    expect(committedPoints()).toEqual([[{ x: 60, y: 90 }]]);
  });

  it('an unshifted press re-anchors, so the line starts from the last place the user clicked', () => {
    const { toolArea } = renderArea();

    fireEvent.pointerDown(toolArea, { button: 0, clientX: 20, clientY: 30 });
    fireEvent.pointerUp(toolArea, { button: 0, clientX: 20, clientY: 30 });
    fireEvent.pointerDown(toolArea, { button: 0, clientX: 90, clientY: 90 });
    fireEvent.pointerUp(toolArea, { button: 0, clientX: 90, clientY: 90 });
    updateLayerByToolMock.mockClear();

    fireEvent.pointerDown(toolArea, { button: 0, shiftKey: true, clientX: 200, clientY: 130 });
    fireEvent.pointerUp(toolArea, { button: 0, shiftKey: true, clientX: 200, clientY: 130 });

    expect(committedPoints()).toEqual([
      [
        { x: 90, y: 90 },
        { x: 200, y: 130 },
      ],
    ]);
  });

  it('converts the line into the layer frame, like every other point the tool commits', () => {
    storeState.layers = { base: makeLayer('base', { x: 30, y: 20, width: 300, height: 200 }) };
    storeState.activeLayerId = 'base';
    const { toolArea } = renderArea();

    fireEvent.pointerDown(toolArea, { button: 0, clientX: 40, clientY: 50 });
    fireEvent.pointerUp(toolArea, { button: 0, clientX: 40, clientY: 50 });
    updateLayerByToolMock.mockClear();

    fireEvent.pointerDown(toolArea, { button: 0, shiftKey: true, clientX: 200, clientY: 130 });
    fireEvent.pointerUp(toolArea, { button: 0, shiftKey: true, clientX: 200, clientY: 130 });

    expect(committedPoints()).toEqual([
      [
        { x: 10, y: 30 },
        { x: 170, y: 110 },
      ],
    ]);
  });

  it('still erases freehand when Shift is held with no anchor, which is the first click of a line', () => {
    const { toolArea } = renderArea();

    // Shift on the arming press must not be a special case of its own: there is nothing to
    // constrain to yet, and refusing the stroke would be a dead key.
    fireEvent.pointerDown(toolArea, { button: 0, shiftKey: true, clientX: 40, clientY: 50 });
    fireEvent.pointerMove(toolArea, { button: 0, clientX: 60, clientY: 70 });
    fireEvent.pointerUp(toolArea, { button: 0, clientX: 60, clientY: 70 });

    expect(committedPoints()).toEqual([
      [
        { x: 40, y: 50 },
        { x: 60, y: 70 },
      ],
    ]);
  });
});
