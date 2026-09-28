import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { EraserToolArea } from '../EraserToolArea.tsx';
import { buildEraseArgs } from '../../../tools/eraser.ts';
import type { Layer, LayersRecord } from '../../../contexts/layer-types.ts';

const updateLayerByToolMock = vi.hoisted(() => vi.fn());
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
 */
vi.mock('../../../contexts/useLayer.ts', () => ({
  useLayers: () => ({
    updateLayerByTool: updateLayerByToolMock,
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
const makeOverlayContext = () =>
  ({
    canvas: document.createElement('canvas'),
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    bezierCurveTo: vi.fn(),
    quadraticCurveTo: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    arc: vi.fn(),
    fillRect: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    setLineDash: vi.fn(),
    getLineDash: vi.fn(() => [] as number[]),
    drawImage: vi.fn(),
    clip: vi.fn(),
    setTransform: vi.fn(),
    resetTransform: vi.fn(),
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 1,
    lineCap: 'round',
    lineJoin: 'round',
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    imageSmoothingEnabled: true,
    imageSmoothingQuality: 'low',
  }) as unknown as CanvasRenderingContext2D;

const renderArea = (overlayCtx: CanvasRenderingContext2D) => {
  const { container } = render(<EraserToolArea className="test-eraser-area" overlayCtxRef={{ current: overlayCtx }} />);
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
    const overlayCtx = makeOverlayContext();
    const toolArea = renderArea(overlayCtx);

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
    const overlayCtx = makeOverlayContext();
    const toolArea = renderArea(overlayCtx);

    stroke(toolArea, [10, 20], [30, 50], [60, 70], [90, 100], [120, 130], [150, 160]);

    // Four pointer moves and a release. A commit per pointer event is the exact defect the
    // architecture constraints forbid, and it would make a single stroke five history states.
    expect(updateLayerByToolMock).toHaveBeenCalledTimes(1);
  });

  it('records one commit for a click that never moves', () => {
    const overlayCtx = makeOverlayContext();
    const toolArea = renderArea(overlayCtx);

    stroke(toolArea, [70, 70]);

    expect(updateLayerByToolMock).toHaveBeenCalledTimes(1);
    const [params] = updateLayerByToolMock.mock.calls[0] as [{ toolArgs: { points: { x: number; y: number }[] } }];
    expect(params.toolArgs.points).toEqual([{ x: 70, y: 70 }]);
  });

  it('commits the stroke in the active layer local frame and never crops it', () => {
    storeState.layers = { base: makeLayer('base', { x: 30, y: 20, width: 300, height: 200 }) };
    storeState.activeLayerId = 'base';
    const overlayCtx = makeOverlayContext();
    const toolArea = renderArea(overlayCtx);

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
    const overlayCtx = makeOverlayContext();
    const toolArea = renderArea(overlayCtx);

    stroke(toolArea, [40, 50], [120, 80]);

    const [params] = updateLayerByToolMock.mock.calls[0] as [{ toolArgs: { points: { x: number; y: number }[] } }];
    expect(params.toolArgs.points).toEqual([
      { x: 40, y: 50 },
      { x: 120, y: 80 },
    ]);
  });

  it('previews with destination-out so the overlay erases instead of painting', () => {
    const overlayCtx = makeOverlayContext();
    const toolArea = renderArea(overlayCtx);

    fireEvent.pointerDown(toolArea, { button: 0, clientX: 40, clientY: 50 });

    // `composite` is read by `setupDrawCtx` (`src/tools/draw.ts:49`). EraserToolArgs has no
    // `composite` field of its own — only `buildEraseArgs` writes it — so this is the pin that the
    // preview goes through `buildEraseArgs` and cannot fall back to a plain `source-over` paint.
    expect(overlayCtx.globalCompositeOperation).toBe('destination-out');
    expect(overlayCtx.stroke).toHaveBeenCalled();
  });

  it('previews Block mode by stamping squares rather than stroking the path', () => {
    toolState.toolArgs = {
      toolName: 'eraser',
      mode: 'block',
      alpha: 1,
      color: '#000000',
      lineWidth: 10,
      points: [],
    };
    const overlayCtx = makeOverlayContext();
    const toolArea = renderArea(overlayCtx);

    stroke(toolArea, [20, 20], [90, 60]);

    // `blockStamp` is read at `src/util/draw.ts:136`, inside `drawPen` — the function `drawLine`
    // dispatches to for `penType: 'pen'`, which is the only pen type `buildEraseArgs` emits. Block
    // mode must therefore reach `drawBlockStamps` on the PREVIEW, not only on the commit: a
    // preview-blind flag renders a Pencil-looking stroke that commits as a hard Block stamp, which
    // is the tool looking broken. Asserting the commit instead would pass with the preview broken.
    expect(overlayCtx.fillRect).toHaveBeenCalled();
    expect(overlayCtx.stroke).not.toHaveBeenCalled();
    expect(overlayCtx.globalCompositeOperation).toBe('destination-out');
  });

  it('previews Pencil mode by stroking the path rather than stamping', () => {
    const overlayCtx = makeOverlayContext();
    const toolArea = renderArea(overlayCtx);

    stroke(toolArea, [20, 20], [90, 60]);

    expect(overlayCtx.stroke).toHaveBeenCalled();
    expect(overlayCtx.fillRect).not.toHaveBeenCalled();
  });

  it('builds the preview stroke from the same args builder the processor uses', () => {
    const overlayCtx = makeOverlayContext();
    const toolArea = renderArea(overlayCtx);

    fireEvent.pointerDown(toolArea, { button: 0, clientX: 40, clientY: 50 });
    fireEvent.pointerMove(toolArea, { button: 0, clientX: 90, clientY: 70 });

    // Same `composite` and same `blockStamp` as the committed raster: `eraser` calls
    // `buildEraseArgs` and hands the result to `setupDrawCtx` and `drawLine`
    // (`src/tools/eraser.ts:70-72`).
    const args = toolState.toolArgs as unknown as Parameters<typeof buildEraseArgs>[0];
    const strokeArgs = {
      ...args,
      points: [
        { x: 40, y: 50 },
        { x: 90, y: 70 },
      ],
    } as unknown as Parameters<typeof buildEraseArgs>[0];
    expect(buildEraseArgs(strokeArgs)).toMatchObject({
      composite: 'destination-out',
      blockStamp: false,
      penType: 'pen',
    });
  });

  it('ignores a stroke that starts with a non-primary mouse button', () => {
    const overlayCtx = makeOverlayContext();
    const toolArea = renderArea(overlayCtx);

    fireEvent.pointerDown(toolArea, { button: 2, clientX: 10, clientY: 20 });
    fireEvent.pointerUp(toolArea, { button: 2, clientX: 60, clientY: 70 });

    expect(updateLayerByToolMock).not.toHaveBeenCalled();
    expect(overlayCtx.stroke).not.toHaveBeenCalled();
  });

  it('ignores pointer movement before the button goes down', () => {
    const overlayCtx = makeOverlayContext();
    const toolArea = renderArea(overlayCtx);

    fireEvent.pointerMove(toolArea, { button: 0, clientX: 30, clientY: 50 });
    fireEvent.pointerUp(toolArea, { button: 0, clientX: 30, clientY: 50 });

    expect(updateLayerByToolMock).not.toHaveBeenCalled();
  });

  it('commits nothing when there is no active layer', () => {
    storeState.activeLayerId = null;
    const overlayCtx = makeOverlayContext();
    const toolArea = renderArea(overlayCtx);

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
    const overlayCtx = makeOverlayContext();
    const toolArea = renderArea(overlayCtx);

    stroke(toolArea, [20, 20], [90, 60]);

    expect(updateLayerByToolMock).not.toHaveBeenCalled();
    expect(overlayCtx.stroke).not.toHaveBeenCalled();
  });

  it('clears the overlay once the stroke is committed', () => {
    const overlayCtx = makeOverlayContext();
    const toolArea = renderArea(overlayCtx);

    fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 20 });
    fireEvent.pointerMove(toolArea, { button: 0, clientX: 30, clientY: 50 });
    fireEvent.pointerMove(toolArea, { button: 0, clientX: 60, clientY: 70 });
    // Every move already repaints the same rectangle, so only the release is observable here.
    vi.mocked(overlayCtx.clearRect).mockClear();

    fireEvent.pointerUp(toolArea, { button: 0, clientX: 60, clientY: 70 });

    expect(overlayCtx.clearRect).toHaveBeenCalledWith(0, 0, 300, 200);
    expect(updateLayerByToolMock).toHaveBeenCalledTimes(1);
  });

  it('does not commit a second time for a release with no gesture in flight', () => {
    const overlayCtx = makeOverlayContext();
    const toolArea = renderArea(overlayCtx);

    stroke(toolArea, [10, 20], [30, 50]);
    fireEvent.pointerUp(toolArea, { button: 0, clientX: 80, clientY: 90 });

    expect(updateLayerByToolMock).toHaveBeenCalledTimes(1);
  });

  it('starts a fresh preview after a stroke was committed', () => {
    const overlayCtx = makeOverlayContext();
    const toolArea = renderArea(overlayCtx);

    stroke(toolArea, [10, 20], [30, 50]);
    vi.mocked(overlayCtx.stroke).mockClear();

    fireEvent.pointerDown(toolArea, { button: 0, clientX: 100, clientY: 100 });

    expect(overlayCtx.moveTo).toHaveBeenLastCalledWith(100, 100);
  });

  it('renders a div carrying the supplied className and the draw cursor', () => {
    const { container } = render(
      <EraserToolArea className="test-eraser-area" overlayCtxRef={{ current: makeOverlayContext() }} />
    );

    expect(container.firstElementChild).toHaveClass('test-eraser-area', 'cursor-draw');
  });
});
