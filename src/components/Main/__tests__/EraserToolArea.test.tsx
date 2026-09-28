import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { EraserToolArea } from '../EraserToolArea.tsx';
import type { Layer, LayersRecord } from '../../../contexts/layer-types.ts';

const updateLayerByToolMock = vi.hoisted(() => vi.fn());
const tempUpdateLayerMock = vi.hoisted(() => vi.fn());
const createLayerFromToolMock = vi.hoisted(() => vi.fn());
const pointerState = vi.hoisted(() => ({ isMouseDown: { current: false }, activePointer: false }));
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
 *
 * `tempUpdateLayer` is the LIVE-PIXEL writer and the preview goes through it. A mock that omitted
 * it would make the preview a `TypeError` rather than the assertion below.
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
 * which is exactly the shape the guards exist to prevent.
 */
vi.mock('../../../hooks/usePointerPosition.ts', () => ({
  usePointerPosition: () => ({
    isPointerDownValid: vi.fn((event: PointerEvent) => {
      if (event.button !== 0) return false;
      if (pointerState.activePointer) return false;
      pointerState.activePointer = true;
      pointerState.isMouseDown.current = true;
      return true;
    }),
    isPointerMoveValid: vi.fn(() => pointerState.activePointer && pointerState.isMouseDown.current),
    isPointerUpValid: vi.fn((event: PointerEvent) => {
      if (event.button !== 0) return false;
      if (!pointerState.activePointer) return false;
      pointerState.activePointer = false;
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

/**
 * `drawLine` is NOT mocked. The Block-mode and `destination-out` assertions are only worth anything
 * if the real `drawPen` reads the real `DrawToolArgs`, which is the whole question: does the
 * preview path reach the branch the commit path reaches?
 */
const renderArea = () => {
  const { container } = render(<EraserToolArea className="test-eraser-area" />);
  return container.firstElementChild as HTMLDivElement;
};

/** A click with no travel is a one-point stroke: release where the pointer went down. */
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
    tempUpdateLayerMock.mockClear();
    createLayerFromToolMock.mockClear();
    pointerState.isMouseDown.current = false;
    pointerState.activePointer = false;
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
    const toolArea = renderArea();

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
    const toolArea = renderArea();

    stroke(toolArea, [10, 20], [30, 50], [60, 70], [90, 100], [120, 130], [150, 160]);

    // Four pointer moves and a release. A commit per pointer event is the exact defect the
    // architecture constraints forbid, and it would make a single stroke five history states.
    expect(updateLayerByToolMock).toHaveBeenCalledTimes(1);
  });

  it('records one commit for a click that never moves', () => {
    const toolArea = renderArea();

    stroke(toolArea, [70, 70]);

    expect(updateLayerByToolMock).toHaveBeenCalledTimes(1);
    const [params] = updateLayerByToolMock.mock.calls[0] as [{ toolArgs: { points: { x: number; y: number }[] } }];
    expect(params.toolArgs.points).toEqual([{ x: 70, y: 70 }]);
  });

  it('commits the stroke in the active layer local frame and never crops it', () => {
    storeState.layers = { base: makeLayer('base', { x: 30, y: 20, width: 300, height: 200 }) };
    storeState.activeLayerId = 'base';
    const toolArea = renderArea();

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
    const toolArea = renderArea();

    stroke(toolArea, [40, 50], [120, 80]);

    const [params] = updateLayerByToolMock.mock.calls[0] as [{ toolArgs: { points: { x: number; y: number }[] } }];
    expect(params.toolArgs.points).toEqual([
      { x: 40, y: 50 },
      { x: 120, y: 80 },
    ]);
  });

  it('previews through the live layer writer rather than the overlay canvas', () => {
    const toolArea = renderArea();

    fireEvent.pointerDown(toolArea, { button: 0, clientX: 40, clientY: 50 });

    // The preview MUST go through `tempUpdateLayer`. An overlay preview cannot work: the
    // overlay is cleared to fully transparent every frame, and `destination-out` computes
    // `da' = da * (1 - sa)`, so with `da = 0` the result is `0` for every pixel and the stroke
    // is arithmetically incapable of drawing anything. That defect shipped as a tool that
    // showed no feedback until pointer-up, and an assertion on `globalCompositeOperation`
    // could not see it.
    expect(tempUpdateLayerMock).toHaveBeenCalledTimes(1);
    expect(updateLayerByToolMock).not.toHaveBeenCalled();
  });

  it('previews in the same layer-local frame it commits in, so the stroke cannot jump on release', () => {
    storeState.layers = { base: makeLayer('base', { x: 30, y: 20, width: 300, height: 200 }) };
    storeState.activeLayerId = 'base';
    const toolArea = renderArea();

    stroke(toolArea, [40, 50], [120, 80]);

    const [preview] = tempUpdateLayerMock.mock.calls.at(-1)! as [{ toolArgs: { points: { x: number; y: number }[] } }];
    const [commit] = updateLayerByToolMock.mock.calls[0] as [{ toolArgs: { points: { x: number; y: number }[] } }];
    expect(preview.toolArgs.points).toEqual([
      { x: 10, y: 30 },
      { x: 90, y: 60 },
    ]);
    // Same numbers the user just saw. A canvas-space preview against a layer-space commit puts
    // the stroke somewhere else the moment the finger lifts.
    expect(commit.toolArgs.points).toEqual(preview.toolArgs.points);
  });

  it('resends the accumulated path on every move, because raster commits replace the whole layer', () => {
    const toolArea = renderArea();

    fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 20 });
    fireEvent.pointerMove(toolArea, { button: 0, clientX: 30, clientY: 50 });
    fireEvent.pointerMove(toolArea, { button: 0, clientX: 60, clientY: 70 });

    const lengths = tempUpdateLayerMock.mock.calls.map(
      ([p]) => (p as { toolArgs: { points: unknown[] } }).toolArgs.points.length
    );
    // 1, 2, 3 — growing. `commit: 'raster'` REPLACES the layer's pixels with the canvas the
    // processor returns, so sending only the newest point would erase exactly one point.
    expect(lengths).toEqual([1, 2, 3]);
  });

  it('refuses to erase the bedrock layer, which has nothing beneath it to restore from', () => {
    storeState.layers = { base: { ...makeLayer('base', { x: 0, y: 0, width: 300, height: 200 }), isBedrock: true } };
    storeState.activeLayerId = 'base';
    const toolArea = renderArea();

    stroke(toolArea, [20, 20], [90, 60]);

    // Bedrock is the document's own backing image and the floor every other layer composites
    // over. The Eraser is the one tool whose whole job is to punch holes, so erasing it changes
    // the colour of the transparent regions the rest of the stack is judged against and leaves
    // no layer to restore from. `MoveToolArea.tsx:35` reads the same flag for the same reason.
    expect(tempUpdateLayerMock).not.toHaveBeenCalled();
    expect(updateLayerByToolMock).not.toHaveBeenCalled();
  });

  it('ignores a stroke that starts with a non-primary mouse button', () => {
    const toolArea = renderArea();

    fireEvent.pointerDown(toolArea, { button: 2, clientX: 10, clientY: 20 });
    fireEvent.pointerUp(toolArea, { button: 2, clientX: 60, clientY: 70 });

    expect(updateLayerByToolMock).not.toHaveBeenCalled();
    expect(tempUpdateLayerMock).not.toHaveBeenCalled();
  });

  it('ignores pointer movement before the button goes down', () => {
    const toolArea = renderArea();

    fireEvent.pointerMove(toolArea, { button: 0, clientX: 30, clientY: 50 });
    fireEvent.pointerUp(toolArea, { button: 0, clientX: 30, clientY: 50 });

    expect(updateLayerByToolMock).not.toHaveBeenCalled();
  });

  it('commits nothing when there is no active layer', () => {
    storeState.activeLayerId = null;
    const toolArea = renderArea();

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
    const toolArea = renderArea();

    stroke(toolArea, [20, 20], [90, 60]);

    expect(updateLayerByToolMock).not.toHaveBeenCalled();
    expect(tempUpdateLayerMock).not.toHaveBeenCalled();
  });

  it('does not commit a second time for a release with no gesture in flight', () => {
    const toolArea = renderArea();

    stroke(toolArea, [10, 20], [30, 50]);
    fireEvent.pointerUp(toolArea, { button: 0, clientX: 80, clientY: 90 });

    expect(updateLayerByToolMock).toHaveBeenCalledTimes(1);
  });

  it('starts a fresh stroke from the new press rather than continuing the committed one', () => {
    const toolArea = renderArea();

    stroke(toolArea, [10, 20], [30, 50]);
    const afterFirst = tempUpdateLayerMock.mock.calls.length;
    tempUpdateLayerMock.mockClear();

    fireEvent.pointerDown(toolArea, { button: 0, clientX: 100, clientY: 100 });

    // One point, not the tail of the previous stroke. A points array that survived the commit
    // would re-erase everything already erased on every later stroke.
    const [press] = tempUpdateLayerMock.mock.calls[0] as [{ toolArgs: { points: { x: number; y: number }[] } }];
    expect(press.toolArgs.points).toEqual([{ x: 100, y: 100 }]);
    expect(tempUpdateLayerMock.mock.calls.length).toBe(1);
    expect(afterFirst).toBeGreaterThan(0);
  });

  it('renders a div carrying the supplied className and the draw cursor', () => {
    const { container } = render(<EraserToolArea className="test-eraser-area" />);

    expect(container.firstElementChild).toHaveClass('test-eraser-area', 'cursor-draw');
  });
});
