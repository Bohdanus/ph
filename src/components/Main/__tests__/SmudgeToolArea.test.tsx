import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { SmudgeToolArea } from '../SmudgeToolArea.tsx';
import type { Layer, LayersRecord } from '../../../contexts/layer-types.ts';
import type { SmudgeToolArgs } from '../../../tools/smudge.ts';

const tempUpdateLayerMock = vi.hoisted(() => vi.fn());
const updateLayerByToolMock = vi.hoisted(() => vi.fn());
/**
 * `createLayerFromTool` is present in the mock on purpose even though the component must never
 * reach it. A `useLayers` mock that simply omitted it would make a regression that committed
 * through the layer-CREATING path a `TypeError` rather than an assertion, and a test that
 * cannot fail on the defect is not a pin. `EraserToolArea.test.tsx` carries it for the same
 * reason: a Smudge reads and writes one buffer, so a "new layer" smudge would composite a copy
 * of the pixels over themselves — a tool that looks alive, drags nothing, and cannot be undone.
 */
const createLayerFromToolMock = vi.hoisted(() => vi.fn());
const pointerState = vi.hoisted(() => ({
  isMouseDown: { current: false },
  activePointer: null as number | null,
  /** The options `usePaintStroke` handed the gesture hook on its last render. */
  hookOptions: null as { ref: unknown; imageSize: unknown } | null,
}));
const storeState = vi.hoisted(
  (): {
    documentFrame: { x: number; y: number; width: number; height: number } | null;
    layers: LayersRecord;
    activeLayerId: string | null;
    containerRef: { current: HTMLDivElement };
  } => ({
    documentFrame: null,
    layers: {},
    activeLayerId: null,
    containerRef: { current: document.createElement('div') },
  })
);
const toolState = vi.hoisted((): { toolArgs: SmudgeToolArgs | null } => ({ toolArgs: null }));

vi.mock('../../../contexts/StoreContext.tsx', () => ({
  useStore: () => [
    {
      // The store's own container, not a fresh node per render: `usePaintStroke` attaches the
      // native `pointercancel` abort listener to `containerRef.current`, and a store that handed
      // out a different div on every render would move that listener under each event.
      containerRef: storeState.containerRef,
      totalSize: { width: 200, height: 120 },
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

vi.mock('../../../contexts/useLayer.ts', () => ({
  useLayers: () => ({
    tempUpdateLayer: tempUpdateLayerMock,
    updateLayerByTool: updateLayerByToolMock,
    createLayerFromTool: createLayerFromToolMock,
  }),
}));

/**
 * The Smudge reads `toolArgs` directly rather than through `getToolArgs` — it is the one area
 * of the three that does, because the tool is single-purpose and there is no neighbouring name
 * to confuse it with. The mock therefore exposes only `toolArgs`, and a `getToolArgs` here would
 * be a shape this component never asks for, which is the honest reason it is absent.
 */
vi.mock('../../../contexts/useCurrentTool.tsx', () => ({
  useCurrentTool: () => ({ toolArgs: toolState.toolArgs }),
}));

/**
 * A faithful stand-in for the real `usePointerPosition` capture contract: the first `pointerDown`
 * claims the pointer, and only that pointer's move/up are valid. A mock that let every event
 * through would make "a stroke gesture that the tool never sees" unobservable, which is exactly
 * the state a disabled `usePaintStroke` produces — the whole point of the bedrock case below is
 * that the hook's handlers return before the validators are ever consulted, and this double is
 * what proves it: nothing claims the pointer, because nothing is called.
 *
 * The options are recorded rather than discarded, because two of them are the component's own
 * contract: the gesture is bound to the STORE's container (which is where the abort listener
 * lives) and to the store's `totalSize`. A component that derived either for itself would look
 * identical in the DOM and be silently wrong in a cropped document.
 */
vi.mock('../../../hooks/usePointerPosition.ts', () => ({
  usePointerPosition: (options: { ref: unknown; imageSize: unknown }) => {
    pointerState.hookOptions = options;
    return {
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
    };
  },
}));

const makeLayer = (id: string, overrides: Partial<Layer> = {}): Layer => ({
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
  pos: { x: 0, y: 0, width: 200, height: 120 },
  operations: [],
  ...overrides,
});

const smudgeArgs = (): SmudgeToolArgs => ({
  toolName: 'smudge',
  size: 24,
  hardness: 0.5,
  strength: 60,
  points: [],
});

const renderArea = (options: { container?: HTMLElement } = {}) => {
  const view = render(<SmudgeToolArea className="test-smudge-area" overlayCtxRef={{ current: null }} />, options);

  return { toolArea: view.container.firstElementChild as HTMLDivElement, view };
};

/**
 * One press/move/release, all on the same pointer id.
 *
 * ## Why the coordinates here are the coordinates that reach the processor
 *
 * `usePaintStroke` resolves the document frame itself as
 * `currentFrame ?? documentFrameFromSize(totalSize)`, and this store hands it `documentFrame: null`
 * with a 200x120 document, so the frame is `{ x: 0, y: 0, width: 200, height: 120 }`.
 * `canvasToDocumentPoint` then ADDS that origin, and the default layer sits at
 * `pos: { x: 0, y: 0 }`, so `documentPointsToLayerLocal` subtracts nothing: client, canvas,
 * document and layer-local coordinates are all one number here.
 *
 * That is not an accident of this store's configuration, it is what the MOCK does. The
 * `usePointerPosition` double above returns the raw client coordinate, where production returns
 * `(clientX - offsetX - rect.x) / scale` — and against this store's detached container, jsdom's
 * all-zero `getBoundingClientRect()` gives `containFit` a zero scale to divide by, so the real
 * hook could not produce these numbers in this file under any assertion. Every coordinate below
 * is therefore a product of the double. The coordinate-space conversion itself is covered only by
 * `src/hooks/__tests__/usePointerPosition.test.ts`, which measures a real rect, and by the e2e
 * suite. What this file pins is everything downstream of that conversion — the document frame,
 * the layer rebase, and the two cancelling — which is why every rebase case moves the layer or
 * the crop off the origin instead of testing the mapping.
 */
const stroke = (toolArea: HTMLDivElement, from: [number, number], to: [number, number]) => {
  fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, clientX: from[0], clientY: from[1] });
  fireEvent.pointerMove(toolArea, { button: 0, pointerId: 1, clientX: to[0], clientY: to[1] });
  fireEvent.pointerUp(toolArea, { button: 0, pointerId: 1, clientX: to[0], clientY: to[1] });
};

type ToolLayerCall = { id?: string; toolArgs: SmudgeToolArgs };

/**
 * The single argument each writer was called with, in call order. `mock.calls` holds one ARRAY
 * per call, so the payload is the first element of each — a `mock.calls[i]` read directly as an
 * object would silently yield `undefined` for every field and read as a broken component.
 */
const previewCalls = (): ToolLayerCall[] => tempUpdateLayerMock.mock.calls.map((call) => call[0] as ToolLayerCall);
const commitCalls = (): ToolLayerCall[] => updateLayerByToolMock.mock.calls.map((call) => call[0] as ToolLayerCall);

/**
 * Hosts this file attached to `document.body`, for the native `pointercancel` route. RTL's
 * `cleanup()` unmounts the component but does not remove a container it was handed, so the
 * removal belongs here rather than at the end of the one test that needs it — a failed assertion
 * in that test would otherwise leak the node.
 */
const attachedHosts: HTMLDivElement[] = [];
afterEach(() => {
  while (attachedHosts.length) attachedHosts.pop()?.remove();
});

/**
 * Every method a paint tool reaches for, as spies on one object. Built explicitly rather than
 * with a `Proxy` so the assertion can NAME the method that painted: a bare `toHaveBeenCalled()`
 * with no arguments would pass just as happily on a component that painted nothing at all.
 */
const CONTEXT_METHODS = [
  'drawImage',
  'putImageData',
  'getImageData',
  'clearRect',
  'fillRect',
  'strokeRect',
  'beginPath',
  'arc',
  'fill',
  'stroke',
  'save',
  'restore',
  'translate',
  'transform',
  'scale',
  'setLineDash',
  'rect',
] as const;

type SpyContext = Record<(typeof CONTEXT_METHODS)[number], ReturnType<typeof vi.fn>> & {
  globalCompositeOperation: GlobalCompositeOperation;
  /** Every value assigned to `globalCompositeOperation`, in call order. */
  compositeWrites: GlobalCompositeOperation[];
};

const makeSpyContext = (): SpyContext => {
  const context = { compositeWrites: [] } as unknown as SpyContext;
  for (const method of CONTEXT_METHODS) context[method] = vi.fn();
  // The composite operation is tracked as a WRITE, not as a value, because a value comparison
  // against a value the double itself starts on is a comparison the double can satisfy alone: a
  // component that wrote nothing would read exactly like a component that wrote 'source-over'.
  // A recording accessor is what separates the two, and it replaces the data property rather than
  // shadowing it, so an assignment reaches the setter instead of overwriting the recorder.
  let operation: GlobalCompositeOperation = 'source-over';
  Object.defineProperty(context, 'globalCompositeOperation', {
    get: () => operation,
    set: (next: GlobalCompositeOperation) => {
      context.compositeWrites.push(next);
      operation = next;
    },
  });
  return context;
};

const paintedMethods = (context: SpyContext): string[] =>
  CONTEXT_METHODS.filter((method) => context[method].mock.calls.length > 0);

describe('SmudgeToolArea', () => {
  beforeEach(() => {
    tempUpdateLayerMock.mockClear();
    updateLayerByToolMock.mockClear();
    createLayerFromToolMock.mockClear();
    pointerState.isMouseDown.current = false;
    pointerState.activePointer = null;
    pointerState.hookOptions = null;
    storeState.documentFrame = null;
    storeState.containerRef = { current: document.createElement('div') };
    storeState.layers = { base: makeLayer('base') };
    storeState.activeLayerId = 'base';
    toolState.toolArgs = smudgeArgs();
  });

  it('writes nothing at all for a stroke over the bedrock layer', () => {
    // Bedrock is the document's own backing image — the floor every other layer composites over,
    // and the surface whose pixels are the judge of every transparent region above it. A Smudge
    // DRAGS pixels out of the document, so on bedrock there is no layer left to drag them from:
    // the stroke would sample the backing image and have nowhere to put what it carried.
    // `MoveToolArea` — `isEnabled` and `EraserToolArea` read the same flag for the same
    // reason, and so do `DodgeToolArea`, `BurnToolArea`, `CloneStampToolArea`,
    // `GradientToolArea` and `FillToolArea`.
    storeState.layers = { base: makeLayer('base', { isBedrock: true }) };
    storeState.activeLayerId = 'base';
    const { toolArea } = renderArea();

    stroke(toolArea, [20, 20], [100, 60]);

    // BOTH writers, and the preview is the load-bearing half. `enabled` is false, and
    // `usePaintStroke` returns from every handler before reaching a callback — so this is an
    // exact total no-op, not an approximation. Asserting only the commit would pass on a
    // regression that let the preview run: `tempUpdateLayer` is the only writer of
    // `previewLayersRef`, and a Smudge re-runs its whole drag from the SOURCE raster on every
    // call, so a preview that reached it would already have destroyed the pixels it was going
    // to sample. The layer-creating writer is named too, for the reason the mock carries it.
    expect(tempUpdateLayerMock).not.toHaveBeenCalled();
    expect(updateLayerByToolMock).not.toHaveBeenCalled();
    expect(createLayerFromToolMock).not.toHaveBeenCalled();
    // Nothing was ever claimed, because the validators were never consulted: the refusal
    // happens above them, not inside the pointer double.
    expect(pointerState.activePointer).toBeNull();
  });

  it('previews every move and commits the stroke exactly once on a normal layer', () => {
    const { toolArea } = renderArea();

    stroke(toolArea, [20, 20], [100, 60]);

    // The split is the whole contract. `tempUpdateLayer` is the live-pixel writer the options
    // bar previews through; `updateLayerByTool` is the undo boundary, and it must be reached
    // ONCE per gesture or one stroke becomes one `TOOL_ACTION` per pointer event.
    expect(tempUpdateLayerMock).toHaveBeenCalledTimes(1);
    const [preview] = previewCalls();
    expect(preview.id).toBe('base');
    expect(preview.toolArgs.points).toEqual([
      { x: 20, y: 20 },
      { x: 100, y: 60 },
    ]);

    expect(updateLayerByToolMock).toHaveBeenCalledTimes(1);
    const [commit] = commitCalls();
    // `usePaintStroke` appends the release point to the gesture before calling `onCommit`,
    // so the committed stroke is the drag plus the point it ended on — which here is the point
    // the drag already ended on, so it is not appended twice.
    expect(commit.id).toBe('base');
    expect(commit.toolArgs.points).toEqual([
      { x: 20, y: 20 },
      { x: 100, y: 60 },
    ]);
  });

  it('commits nothing when there is no active layer', () => {
    storeState.activeLayerId = null;
    const { toolArea } = renderArea();

    stroke(toolArea, [20, 20], [100, 60]);

    // With no active layer there is also no raster to rebase onto: `rasterBounds` is `null`, and
    // a stroke that reached a writer would be addressing a buffer nobody named. Both writers,
    // because the preview is the one that repaints.
    expect(tempUpdateLayerMock).not.toHaveBeenCalled();
    expect(updateLayerByToolMock).not.toHaveBeenCalled();
    expect(createLayerFromToolMock).not.toHaveBeenCalled();
    expect(pointerState.activePointer).toBeNull();
  });

  it('commits nothing when the active layer id names a layer the store no longer holds', () => {
    // A layer deleted from under the pointer leaves the id behind for a render or two. `isEnabled`
    // consults the LAYER, not the id: `Boolean(activeLayerId && activeLayer && ...)` — so a
    // stale id alone must not hand a smudge to a layer that does not exist.
    storeState.layers = {};
    storeState.activeLayerId = 'deleted-under-the-pointer';
    const { toolArea } = renderArea();

    stroke(toolArea, [20, 20], [100, 60]);

    expect(tempUpdateLayerMock).not.toHaveBeenCalled();
    expect(updateLayerByToolMock).not.toHaveBeenCalled();
    expect(createLayerFromToolMock).not.toHaveBeenCalled();
  });

  it('rebases the stroke onto the active layer origin on BOTH the preview and the commit', () => {
    storeState.layers = { base: makeLayer('base', { pos: { x: 30, y: 20, width: 200, height: 120 } }) };
    storeState.activeLayerId = 'base';
    const { toolArea } = renderArea();

    stroke(toolArea, [40, 50], [120, 80]);

    // The processor addresses the LAYER's own raster, whose pixel (0, 0) is `rasterBounds`, so a
    // document point becomes `point - rasterBounds`. Un-rebased these would be (40, 50) and
    // (120, 80): a smudge reads and writes the same buffer, so an un-rebased point does not
    // merely offset the stroke, it smudges the wrong pixels entirely.
    expect(previewCalls()[0].toolArgs.points).toEqual([
      { x: 10, y: 30 },
      { x: 90, y: 60 },
    ]);
    // The commit is a REPLAY of the same args, not an accumulation: a history item that retained
    // document-space points would replay the stroke 30px right and 20px down of where it was drawn.
    expect(commitCalls()[0].toolArgs.points).toEqual([
      { x: 10, y: 30 },
      { x: 90, y: 60 },
    ]);
  });

  it('rebases onto the EVALUATED extent of a transformed layer rather than its raw pos', () => {
    // A layer carrying a retained affine is handed a buffer staged at its evaluated extent, so
    // `processorPresentationBounds` is the origin — passing `layer.pos` to a transformed layer is
    // the defect `src/util/layer-space.ts` exists to make impossible. A pure translation by
    // (20, 10) moves the raster's top-left without resizing it, which is the smallest transform
    // that separates the two answers: `pos` says (30, 20), the evaluated extent says (50, 30).
    storeState.layers = {
      base: makeLayer('base', {
        pos: { x: 30, y: 20, width: 200, height: 120 },
        operations: [
          {
            id: 'op-1',
            kind: 'affine-transform',
            enabled: true,
            transform: { a: 1, b: 0, c: 0, d: 1, e: 20, f: 10 },
          },
        ],
      }),
    };
    storeState.activeLayerId = 'base';
    const { toolArea } = renderArea();

    stroke(toolArea, [40, 50], [120, 80]);

    // (-10, 20) and (70, 50): the evaluated origin. Rebasing by the raw `pos` would give
    // (10, 30) and (90, 60), and rebasing not at all would give (40, 50) and (120, 80), so each
    // of the three possible answers is a different pair of numbers here.
    expect(previewCalls()[0].toolArgs.points).toEqual([
      { x: -10, y: 20 },
      { x: 70, y: 50 },
    ]);
    expect(commitCalls()[0].toolArgs.points).toEqual([
      { x: -10, y: 20 },
      { x: 70, y: 50 },
    ]);
  });

  it('rebases the document frame back off a layer that sits on the crop origin', () => {
    // The hook ADDS the crop origin to every canvas sample and the component SUBTRACTS the
    // layer's origin, so a layer sitting on the crop origin hands the processor exactly the
    // canvas coordinates. It holds only if the subtraction is applied to the hook's DOCUMENT
    // point: subtracting from the raw client coordinate instead would land the stroke at
    // (30, 35) for a press at (40, 50).
    storeState.documentFrame = { x: 10, y: 15, width: 200, height: 120 };
    storeState.layers = { base: makeLayer('base', { pos: { x: 10, y: 15, width: 200, height: 120 } }) };
    storeState.activeLayerId = 'base';
    const { toolArea } = renderArea();

    stroke(toolArea, [40, 50], [120, 80]);

    expect(commitCalls()[0].toolArgs.points).toEqual([
      { x: 40, y: 50 },
      { x: 120, y: 80 },
    ]);
  });

  it('hands the processor the Smudge settings unchanged', () => {
    toolState.toolArgs = { ...smudgeArgs(), size: 41, hardness: 0.25, strength: 90 };
    const { toolArea } = renderArea();

    stroke(toolArea, [20, 20], [100, 60]);

    // The whole args object, not only `points`. `smudge()` reads `size` for the tip diameter,
    // `hardness` for the falloff and `strength` as a 0-100 percentage it maps onto per-dab
    // coverage; a spread that dropped one of them, or spread the args BEFORE the rebased points
    // over them, would smudge with the wrong tip and no test would notice.
    expect(commitCalls()[0].toolArgs).toEqual({
      toolName: 'smudge',
      size: 41,
      hardness: 0.25,
      strength: 90,
      points: [
        { x: 20, y: 20 },
        { x: 100, y: 60 },
      ],
    });
  });

  it('previews once per pointer move and commits once per gesture', () => {
    const { toolArea } = renderArea();

    fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, clientX: 10, clientY: 20 });
    fireEvent.pointerMove(toolArea, { button: 0, pointerId: 1, clientX: 30, clientY: 50 });
    fireEvent.pointerMove(toolArea, { button: 0, pointerId: 1, clientX: 60, clientY: 70 });
    fireEvent.pointerMove(toolArea, { button: 0, pointerId: 1, clientX: 90, clientY: 90 });
    fireEvent.pointerUp(toolArea, { button: 0, pointerId: 1, clientX: 90, clientY: 90 });

    // Four events, three of them moves. `usePaintStroke` coalesces nothing, so a preview per
    // move is the contract and NOT a defect — the preview is a whole-gesture replay, not an
    // incremental patch. One commit, because the undo boundary is the release alone.
    expect(tempUpdateLayerMock).toHaveBeenCalledTimes(3);
    expect(previewCalls().map((call) => call.toolArgs.points.length)).toEqual([2, 3, 4]);
    expect(updateLayerByToolMock).toHaveBeenCalledTimes(1);
    expect(commitCalls()[0].toolArgs.points).toEqual([
      { x: 10, y: 20 },
      { x: 30, y: 50 },
      { x: 60, y: 70 },
      { x: 90, y: 90 },
    ]);
  });

  it('commits a single point for a click that never moves', () => {
    const { toolArea } = renderArea();

    fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, clientX: 70, clientY: 70 });
    fireEvent.pointerUp(toolArea, { button: 0, pointerId: 1, clientX: 70, clientY: 70 });

    // A release that lands where the stroke already is adds nothing, and a duplicated point
    // doubles the width of a size-varying tip. One point, not the same point twice.
    expect(updateLayerByToolMock).toHaveBeenCalledTimes(1);
    expect(commitCalls()[0].toolArgs.points).toEqual([{ x: 70, y: 70 }]);
    expect(tempUpdateLayerMock).not.toHaveBeenCalled();
  });

  it('gives each preview its own points, so a later move cannot shift an earlier one', () => {
    storeState.layers = { base: makeLayer('base', { pos: { x: 30, y: 20, width: 200, height: 120 } }) };
    storeState.activeLayerId = 'base';
    const { toolArea } = renderArea();

    fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, clientX: 40, clientY: 50 });
    fireEvent.pointerMove(toolArea, { button: 0, pointerId: 1, clientX: 60, clientY: 70 });
    fireEvent.pointerMove(toolArea, { button: 0, pointerId: 1, clientX: 90, clientY: 90 });
    fireEvent.pointerUp(toolArea, { button: 0, pointerId: 1, clientX: 90, clientY: 90 });

    // `onMove` receives the hook's LIVE accumulating array, which every later move appends to.
    // `documentPointsToLayerLocal` maps it into a new array of new points, so the first preview
    // still reads as the two points it was when it was made. A rebase written in place would show
    // (10, 30), (30, 50) AND (90, 90) here — the second move subtracting the origin from a point
    // the first move had already shifted, so the stroke walks up and to the left on every frame.
    const [first, second] = previewCalls();
    expect(first.toolArgs.points).toEqual([
      { x: 10, y: 30 },
      { x: 30, y: 50 },
    ]);
    expect(second.toolArgs.points).toEqual([
      { x: 10, y: 30 },
      { x: 30, y: 50 },
      { x: 60, y: 70 },
    ]);
    // Two distinct arrays, which is the mechanism behind the numbers above: sharing one would
    // make the first preview's contents a function of how far the drag later went.
    expect(first.toolArgs.points).not.toBe(second.toolArgs.points);
    expect(commitCalls()[0].toolArgs.points).toEqual([
      { x: 10, y: 30 },
      { x: 30, y: 50 },
      { x: 60, y: 70 },
    ]);
  });

  it('abandons the stroke when the pointer leaves the surface instead of committing it', () => {
    const { toolArea } = renderArea();

    fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, clientX: 20, clientY: 20 });
    fireEvent.pointerMove(toolArea, { button: 0, pointerId: 1, clientX: 60, clientY: 40 });
    fireEvent.pointerLeave(toolArea, { button: 0, pointerId: 1, clientX: 60, clientY: 40 });

    // `onPointerLeave` clears the gesture and never reaches `onCommit`: dragging off the canvas
    // is not a completed stroke, and committing it would put a half-drag on the timeline.
    expect(updateLayerByToolMock).not.toHaveBeenCalled();
    // The capture went with it. `isPointerUpValid` is the only way to release the pointer
    // `usePointerPosition` took, and a release that skipped it would refuse every later press.
    expect(pointerState.activePointer).toBeNull();
    expect(pointerState.isMouseDown.current).toBe(false);

    fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, clientX: 90, clientY: 80 });
    fireEvent.pointerMove(toolArea, { button: 0, pointerId: 1, clientX: 120, clientY: 100 });

    // The surface still works, which is what "released" means as an observable: the abandoned
    // gesture's points are gone and the new press previews on its own.
    expect(tempUpdateLayerMock).toHaveBeenCalledTimes(2);
    expect(previewCalls()[1].toolArgs.points).toEqual([
      { x: 90, y: 80 },
      { x: 120, y: 100 },
    ]);
  });

  it('abandons the stroke on a native pointer cancel, which the store container observes', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    attachedHosts.push(host);
    // The component's own div is a child of the store's container in the app, which is where
    // `usePaintStroke` attaches the abort listener — this hook has no React handler for
    // `pointercancel`, so rendering anywhere else would leave the abort route untested.
    storeState.containerRef = { current: host };
    // `usePointerPosition` puts its OWN `pointercancel` listener on that same node and clears its
    // tracking there. The double registers nothing, so it is registered here: the abort route is
    // only faithful if the capture is released the way the real hook releases it.
    host.addEventListener('pointercancel', () => {
      pointerState.activePointer = null;
      pointerState.isMouseDown.current = false;
    });
    const { view, toolArea } = renderArea({ container: host });
    expect(view.container).toBe(host);

    fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, clientX: 20, clientY: 20 });
    fireEvent.pointerMove(toolArea, { button: 0, pointerId: 1, clientX: 60, clientY: 40 });
    fireEvent.pointerCancel(host);

    // The abort committed nothing and threw away the partial preview rather than leaving it.
    expect(updateLayerByToolMock).not.toHaveBeenCalled();
    expect(tempUpdateLayerMock).toHaveBeenCalledTimes(1);

    fireEvent.pointerUp(toolArea, { button: 0, pointerId: 1, clientX: 60, clientY: 40 });

    // Still nothing: a gesture that was abandoned cannot be resurrected by the release that
    // would have ended it. A hook that cleared nothing here would commit the whole drag.
    expect(updateLayerByToolMock).not.toHaveBeenCalled();
  });

  it('ignores a press with a non-primary mouse button', () => {
    const { toolArea } = renderArea();

    fireEvent.pointerDown(toolArea, { button: 2, pointerId: 1, clientX: 10, clientY: 20 });
    fireEvent.pointerMove(toolArea, { button: 2, pointerId: 1, clientX: 60, clientY: 70 });
    fireEvent.pointerUp(toolArea, { button: 2, pointerId: 1, clientX: 60, clientY: 70 });

    // A right-click drag is not a smudge, and claiming the capture for one would block the left
    // button until the element unmounted.
    expect(tempUpdateLayerMock).not.toHaveBeenCalled();
    expect(updateLayerByToolMock).not.toHaveBeenCalled();
    expect(pointerState.activePointer).toBeNull();
  });

  it('ignores pointer movement that arrives before the button goes down', () => {
    const { toolArea } = renderArea();

    fireEvent.pointerMove(toolArea, { button: 0, pointerId: 1, clientX: 30, clientY: 50 });
    fireEvent.pointerUp(toolArea, { button: 0, pointerId: 1, clientX: 30, clientY: 50 });

    // Hovering the surface is not a stroke: with no press there is no gesture to append to, and
    // a release with nothing in flight must not commit a one-point click at the cursor.
    expect(tempUpdateLayerMock).not.toHaveBeenCalled();
    expect(updateLayerByToolMock).not.toHaveBeenCalled();
  });

  it('does not let a foreign pointer end a stroke it did not start', () => {
    const { toolArea } = renderArea();

    fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, clientX: 20, clientY: 20 });
    fireEvent.pointerMove(toolArea, { button: 0, pointerId: 1, clientX: 60, clientY: 40 });
    fireEvent.pointerUp(toolArea, { button: 0, pointerId: 99, clientX: 60, clientY: 40 });

    // A second pointer releasing on this surface must not commit the first pointer's drag, and
    // must not hand the document back on its behalf either.
    expect(updateLayerByToolMock).not.toHaveBeenCalled();
    expect(pointerState.activePointer).toBe(1);

    fireEvent.pointerUp(toolArea, { button: 0, pointerId: 1, clientX: 60, clientY: 40 });

    // The owning pointer's own release still commits exactly the stroke it started.
    expect(updateLayerByToolMock).toHaveBeenCalledTimes(1);
    expect(commitCalls()[0].toolArgs.points).toEqual([
      { x: 20, y: 20 },
      { x: 60, y: 40 },
    ]);
  });

  it('abandons a gesture whose active layer disappears under the pointer', () => {
    const { toolArea, view } = renderArea();

    fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, clientX: 20, clientY: 20 });
    fireEvent.pointerMove(toolArea, { button: 0, pointerId: 1, clientX: 60, clientY: 40 });
    expect(tempUpdateLayerMock).toHaveBeenCalledTimes(1);

    // The layer is deleted while the button is held. `enabled` is read at gesture boundaries
    // only, so the release below is refused wholesale rather than committing a stroke into a
    // layer that no longer exists — half-committing it would be the worse of the two.
    storeState.layers = {};
    view.rerender(<SmudgeToolArea className="test-smudge-area" overlayCtxRef={{ current: null }} />);
    fireEvent.pointerUp(toolArea, { button: 0, pointerId: 1, clientX: 60, clientY: 40 });

    expect(updateLayerByToolMock).not.toHaveBeenCalled();
    expect(createLayerFromToolMock).not.toHaveBeenCalled();
    // The refusal happens ABOVE the validators, so the capture is still held — the same ordering
    // the bedrock case pins from the other side.
    expect(pointerState.activePointer).toBe(1);
  });

  it('never paints into the canvas or overlay context it was handed', () => {
    const canvasCtx = makeSpyContext();
    const overlayCtx = makeSpyContext();
    const view = render(
      <SmudgeToolArea
        className="test-smudge-area"
        canvasCtxRef={{ current: canvasCtx as unknown as CanvasRenderingContext2D }}
        overlayCtxRef={{ current: overlayCtx as unknown as CanvasRenderingContext2D }}
      />
    );
    const toolArea = view.container.firstElementChild as HTMLDivElement;

    stroke(toolArea, [20, 20], [100, 60]);

    // Anti-vacuity first: the gesture really did happen, so the zeroes below are a property of
    // the component and not of a test that never drove it.
    expect(updateLayerByToolMock).toHaveBeenCalledTimes(1);
    expect(commitCalls()[0].toolArgs.points).toEqual([
      { x: 20, y: 20 },
      { x: 100, y: 60 },
    ]);
    // Neither prop is read, and that is the documented contract rather than an oversight: the
    // Smudge edits the layer's own raster through `tempUpdateLayer` / `updateLayerByTool`, which
    // republish and redraw themselves. A tool painting into either context by hand produces
    // pixels with no history entry, and `commitDirtyTool` takes its `PUBLISH_RUNTIME_PRESENTATION`
    // branch and never warns — so the stroke would be un-undoable forever, silently.
    expect(paintedMethods(canvasCtx)).toEqual([]);
    expect(paintedMethods(overlayCtx)).toEqual([]);
    // The composite operation, asserted as the WRITES it received rather than as a value. The
    // double still starts on the real canvas default, so `toBe('source-over')` is a comparison
    // the initialiser alone satisfies and no component behaviour can disturb; the recorded
    // writes are empty only while the component leaves the property alone, so a single
    // assignment of ANY value — 'source-over' included — fails here.
    expect(canvasCtx.compositeWrites).toEqual([]);
    expect(overlayCtx.compositeWrites).toEqual([]);
  });

  it('renders a div carrying the supplied className and the crosshair cursor', () => {
    const { toolArea, view } = renderArea();

    // The surface, as the source actually builds it: ONE element, directly under the container.
    // The whole file addresses `firstElementChild`, so a wrapper element inserted here would
    // silently become the element every case below drives its pointer events at, and nothing else
    // in this file would notice. The className is compared as the composed STRING the source
    // interpolates rather than as two presence checks, because presence also survives a dropped
    // class, a reordered pair and a third class appended to it. The component binds no ref to
    // this element and sets no `role` or `data-*` on it, so there is nothing further to read off
    // the DOM: the claim that the gesture handlers are bound to THIS element is carried by the
    // stroke cases above, which dispatch real pointer events at it and observe the writers fire.
    expect(view.container.childElementCount).toBe(1);
    expect(toolArea.tagName).toBe('DIV');
    expect(toolArea.className).toBe('test-smudge-area cursor-crosshair');
  });

  it('binds the gesture to the store container and the store total size', () => {
    renderArea();

    // The gesture surface is the store's own container at the store's own size, and the crop
    // conversion depends on the latter: `usePaintStroke` hands `imageSize` to
    // `usePointerPosition` and resolves the document frame against it. A component that sized
    // the surface from anything else would look identical in the DOM and be wrong in a
    // cropped document.
    expect(pointerState.hookOptions?.ref).toBe(storeState.containerRef);
    expect(pointerState.hookOptions?.imageSize).toEqual({ width: 200, height: 120 });
  });
});
