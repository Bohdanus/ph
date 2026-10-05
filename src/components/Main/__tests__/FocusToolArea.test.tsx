import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { FocusToolArea } from '../FocusToolArea.tsx';
import { FOCUS_STROKE_BRUSH_SIZE } from '../../../util/focus-stroke-mask.ts';
import type { Layer, LayersRecord } from '../../../contexts/layer-types.ts';
import type { Pos } from '../../../contexts/general-types.ts';
import type { BlurToolArgs } from '../../../tools/blur.ts';
import type { SharpenToolArgs } from '../../../tools/sharpen.ts';

const tempUpdateLayerMock = vi.hoisted(() => vi.fn());
const updateLayerByToolMock = vi.hoisted(() => vi.fn());
/**
 * `createLayerFromTool` is on the mock even though this component must never reach it. A `useLayers`
 * double that simply omitted it would turn a regression that committed through the layer-CREATING
 * path into a `TypeError` rather than a failing assertion, and a test that cannot fail on the
 * defect is not a pin. `SmudgeToolArea.test.tsx` carries it for the same reason.
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
const toolState = vi.hoisted((): { toolName: string; toolArgs: BlurToolArgs | SharpenToolArgs } => ({
  toolName: 'blur',
  toolArgs: { toolName: 'blur', radius: 8 },
}));

vi.mock('../../../contexts/StoreContext.tsx', () => ({
  useStore: () => [
    {
      // The store's own container, not a fresh node per render: `usePaintStroke` attaches the
      // native `pointercancel` abort listener to `containerRef.current`, and a store handing out a
      // different div each render would move that listener under every event.
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
 * `getToolArgs` and not a bare `toolArgs`, and the `toolName === name` gate is LOAD-BEARING rather
 * than incidental. It is what `useCurrentTool.tsx` actually does, and it is the only thing that
 * stops a `SharpenToolArea` reaching for the Blur's args — which is why one test below renders a
 * sharpen area while Blur is the selected tool and requires that nothing at all is written. A
 * double that returned the args regardless of the name would make that test vacuously true.
 */
vi.mock('../../../contexts/useCurrentTool.tsx', () => ({
  useCurrentTool: () => ({
    getToolArgs: (name: string) => (toolState.toolName === name ? toolState.toolArgs : null),
  }),
}));

/**
 * A faithful stand-in for `usePointerPosition`'s capture contract: the first `pointerDown` claims
 * the pointer, and only that pointer's move/up are valid. `getLocalCoords` returns the RAW client
 * coordinate, which is the whole reason every expected number in this file is about rebase and
 * frame rather than about coordinate mapping — the mapping itself is covered by
 * `src/hooks/__tests__/usePointerPosition.test.ts` and by the e2e suite.
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

/**
 * Production tool args never carry a `rasterBounds` key — nothing writes one back into the tool's
 * settings — so these factories must not invent one. The component adds it; the store does not.
 */
const blurArgs = (): BlurToolArgs => ({ toolName: 'blur', radius: 8 });
const sharpenArgs = (): SharpenToolArgs => ({ toolName: 'sharpen', amount: 50, radius: 2 });

const renderArea = (toolName: 'blur' | 'sharpen') => {
  const view = render(
    <FocusToolArea toolName={toolName} className="test-focus-area" overlayCtxRef={{ current: null }} />
  );

  return { toolArea: view.container.firstElementChild as HTMLDivElement, view };
};

/**
 * One press/move/release on the same pointer id.
 *
 * With `documentFrame: null` and a 200x120 document, `usePaintStroke` resolves the frame as
 * `{x:0,y:0,width:200,height:120}`, and the pointer double hands back raw client coordinates, so
 * client, canvas and document coordinates are one number here. Every rebase case below therefore
 * moves the LAYER off the origin, which is what makes the frame computation observable at all.
 */
const stroke = (toolArea: HTMLDivElement, from: [number, number], to: [number, number]) => {
  fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, clientX: from[0], clientY: from[1] });
  fireEvent.pointerMove(toolArea, { button: 0, pointerId: 1, clientX: to[0], clientY: to[1] });
  fireEvent.pointerUp(toolArea, { button: 0, pointerId: 1, clientX: to[0], clientY: to[1] });
};

/**
 * `points` is required in this test's view of a call because the component ALWAYS sets it, on
 * every preview and every commit. The tool args types keep it optional because the legacy
 * whole-layer form carries no stroke at all, and that optionality is exactly what `isRasterStrokeArgs`
 * tests — so the types must not be changed to make a test compile, and the narrowing belongs here.
 * A union rather than an intersection: the two tools disagree on `toolName`, so intersecting them
 * would reduce to `never`.
 */
type StrokeCall = { points: { x: number; y: number }[]; rasterBounds: Pos };

type ToolLayerCall = {
  id?: string;
  toolArgs: (BlurToolArgs | SharpenToolArgs) & StrokeCall;
};

const previewCalls = (): ToolLayerCall[] => tempUpdateLayerMock.mock.calls.map((call) => call[0] as ToolLayerCall);
const commitCalls = (): ToolLayerCall[] => updateLayerByToolMock.mock.calls.map((call) => call[0] as ToolLayerCall);

const attachedHosts: HTMLDivElement[] = [];
afterEach(() => {
  while (attachedHosts.length) attachedHosts.pop()?.remove();
});

describe('FocusToolArea', () => {
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
    toolState.toolName = 'blur';
    toolState.toolArgs = blurArgs();
  });

  /** A layer tight around its content, so a stroke leaving it has to widen the frame. */
  const useTightLayer = () => {
    storeState.layers = { base: makeLayer('base', { pos: { x: 40, y: 30, width: 60, height: 40 } }) };
    storeState.activeLayerId = 'base';
  };

  it.each([
    // Blur widens by tip + KERNEL, because a canvas `filter: blur()` samples the transparent
    // surround instead of clamping at the surface edge: reach 20 + radius 8 = 28.
    [
      'blur',
      { x: -18, y: -18, width: 136, height: 116 },
      [
        { x: 28, y: 28 },
        { x: 108, y: 88 },
      ],
    ],
    // Sharpen needs no kernel margin — its box passes replicate the edge row and column — so it
    // widens by the tip alone: reach 20.
    [
      'sharpen',
      { x: -10, y: -10, width: 120, height: 100 },
      [
        { x: 20, y: 20 },
        { x: 100, y: 80 },
      ],
    ],
  ] as const)(
    'widens a tight layer into the %s stroke frame and rebases onto it on the preview and the commit alike',
    (toolName, rasterBounds, points) => {
      useTightLayer();
      toolState.toolName = toolName;
      toolState.toolArgs = toolName === 'blur' ? blurArgs() : sharpenArgs();
      const { toolArea } = renderArea(toolName);

      stroke(toolArea, [10, 10], [90, 70]);

      // Three wrong answers are excluded and each is a different pair of numbers: no widening
      // would rebase by `layer.pos` and give [{20,20},{80,60}]; no rebase at all would give the
      // raw client points; and rebase-without-widen would produce the sharpen pair while the
      // kernel demands the blur one.
      for (const call of [...previewCalls(), ...commitCalls()]) {
        expect(call.toolArgs.rasterBounds).toEqual(rasterBounds);
        expect(call.toolArgs.points).toEqual(points);
      }
      // The preview and the commit must name ONE frame, or the pixels the user saw and the pixels
      // history replays are not the same edit.
      expect(previewCalls()[0]!.toolArgs.rasterBounds).toEqual(commitCalls()[0]!.toolArgs.rasterBounds);
    }
  );

  it('widens the Blur frame by its kernel radius, so a stroke inside the layer cannot erode its edge', () => {
    useTightLayer();
    toolState.toolName = 'blur';
    toolState.toolArgs = { toolName: 'blur', radius: 8 };
    const wide = renderArea('blur');
    stroke(wide.toolArea, [10, 10], [90, 70]);
    const wideFrame = commitCalls()[0]!.toolArgs.rasterBounds;

    updateLayerByToolMock.mockClear();
    toolState.toolArgs = { toolName: 'blur', radius: 0 };
    const narrow = renderArea('blur');
    stroke(narrow.toolArea, [10, 10], [90, 70]);
    const narrowFrame = commitCalls()[0]!.toolArgs.rasterBounds;

    // Radius 0 widens by the tip alone.
    expect(narrowFrame).toEqual({ x: -10, y: -10, width: 120, height: 100 });
    // The kernel-reach frame must strictly contain it on every side, because the kernel samples
    // that far beyond the tip.
    expect(wideFrame!.x).toBeLessThan(narrowFrame!.x);
    expect(wideFrame!.y).toBeLessThan(narrowFrame!.y);
    expect(wideFrame!.width).toBeGreaterThan(narrowFrame!.width);
    expect(wideFrame!.height).toBeGreaterThan(narrowFrame!.height);
  });

  it('gives Sharpen no kernel margin, because its box passes replicate the edge rather than sampling past it', () => {
    useTightLayer();
    toolState.toolName = 'sharpen';

    toolState.toolArgs = { toolName: 'sharpen', amount: 50, radius: 2 };
    const small = renderArea('sharpen');
    stroke(small.toolArea, [10, 10], [90, 70]);
    const smallFrame = commitCalls()[0]!.toolArgs.rasterBounds;

    updateLayerByToolMock.mockClear();
    toolState.toolArgs = { toolName: 'sharpen', amount: 400, radius: 50 };
    const large = renderArea('sharpen');
    stroke(large.toolArea, [10, 10], [90, 70]);

    // The frame must NOT track `radius`: widening by it would grow the layer with the slider for
    // no reason, since the convolution already clamps at the raster edge.
    expect(commitCalls()[0]!.toolArgs.rasterBounds).toEqual(smallFrame);
  });

  it.each([
    // Radius 0, so the frame is the layer's own: this test is about the KEY being present at all,
    // and a blur radius would legitimately widen the frame past the layer even for this stroke.
    ['blur', { toolName: 'blur', radius: 0 } as BlurToolArgs],
    ['sharpen', { toolName: 'sharpen', amount: 50, radius: 2 } as SharpenToolArgs],
  ] as const)('carries the frame as rasterBounds for a %s stroke that never leaves the layer', (toolName, args) => {
    storeState.layers = { base: makeLayer('base') };
    toolState.toolName = toolName;
    toolState.toolArgs = args;
    const { toolArea } = renderArea(toolName);

    stroke(toolArea, [20, 20], [100, 60]);

    // The KEY is present unconditionally here, and that presence is load-bearing: it is the only
    // thing that makes `isRasterStrokeArgs` true, which is what records the stroke as an
    // `apply-raster-processor` instead of a retained whole-layer `apply-filter`. Making this key
    // conditional — as `SmudgeToolArea` does, for its own reasons — would silently turn every
    // in-bounds focus stroke back into a filter of the whole layer.
    expect('rasterBounds' in commitCalls()[0]!.toolArgs).toBe(true);
    expect(commitCalls()[0]!.toolArgs.rasterBounds).toEqual({ x: 0, y: 0, width: 200, height: 120 });
    expect(commitCalls()[0]!.toolArgs.points).toEqual([
      { x: 20, y: 20 },
      { x: 100, y: 60 },
    ]);
  });

  it.each(['blur', 'sharpen'] as const)('writes nothing for a %s area while another tool is selected', (toolName) => {
    // The reason this component reads through `getToolArgs` rather than the raw `toolArgs`. A
    // sharpen area reached for Blur's args here would blur the layer with sharpen settings, and
    // every other test in this file would still pass.
    toolState.toolName = toolName === 'blur' ? 'sharpen' : 'blur';
    toolState.toolArgs = toolName === 'blur' ? sharpenArgs() : blurArgs();
    const { toolArea } = renderArea(toolName);

    stroke(toolArea, [20, 20], [100, 60]);

    expect(tempUpdateLayerMock).not.toHaveBeenCalled();
    expect(updateLayerByToolMock).not.toHaveBeenCalled();
    expect(createLayerFromToolMock).not.toHaveBeenCalled();
    expect(pointerState.activePointer).toBeNull();
  });

  it.each(['blur', 'sharpen'] as const)('writes nothing for a %s stroke over the bedrock layer', (toolName) => {
    // Bedrock is the document's own backing image. Blur and Sharpen read it and write the result
    // into a layer; there is no layer here to write into, and sampling the backing image would
    // quietly repaint the document itself.
    storeState.layers = { base: makeLayer('base', { isBedrock: true }) };
    toolState.toolName = toolName;
    toolState.toolArgs = toolName === 'blur' ? blurArgs() : sharpenArgs();
    const { toolArea } = renderArea(toolName);

    stroke(toolArea, [20, 20], [100, 60]);

    expect(tempUpdateLayerMock).not.toHaveBeenCalled();
    expect(updateLayerByToolMock).not.toHaveBeenCalled();
  });

  it.each(['blur', 'sharpen'] as const)('commits nothing for a %s stroke with no active layer', (toolName) => {
    storeState.activeLayerId = null;
    toolState.toolName = toolName;
    toolState.toolArgs = toolName === 'blur' ? blurArgs() : sharpenArgs();
    const { toolArea } = renderArea(toolName);

    stroke(toolArea, [20, 20], [100, 60]);

    expect(tempUpdateLayerMock).not.toHaveBeenCalled();
    expect(updateLayerByToolMock).not.toHaveBeenCalled();
    expect(pointerState.activePointer).toBeNull();
  });

  it.each(['blur', 'sharpen'] as const)(
    'previews once per pointer move and commits once per %s gesture',
    (toolName) => {
      toolState.toolName = toolName;
      toolState.toolArgs = toolName === 'blur' ? blurArgs() : sharpenArgs();
      const { toolArea } = renderArea(toolName);

      fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, clientX: 10, clientY: 20 });
      fireEvent.pointerMove(toolArea, { button: 0, pointerId: 1, clientX: 30, clientY: 50 });
      fireEvent.pointerMove(toolArea, { button: 0, pointerId: 1, clientX: 60, clientY: 70 });
      fireEvent.pointerMove(toolArea, { button: 0, pointerId: 1, clientX: 90, clientY: 90 });
      fireEvent.pointerUp(toolArea, { button: 0, pointerId: 1, clientX: 90, clientY: 90 });

      // A preview per move is the contract, not a defect: the preview is a whole-gesture replay, not
      // an incremental patch. One commit, because the undo boundary is the release alone.
      expect(tempUpdateLayerMock).toHaveBeenCalledTimes(3);
      expect(previewCalls().map((call) => call.toolArgs.points.length)).toEqual([2, 3, 4]);
      expect(updateLayerByToolMock).toHaveBeenCalledTimes(1);
    }
  );

  it.each([
    // radius 17 -> kernel reach 17, so the frame widens by 20 + 17 = 37 around the tip.
    [
      'blur',
      { toolName: 'blur', radius: 17 } as BlurToolArgs,
      { x: -17, y: -17, width: 217, height: 137 },
      [
        { x: 37, y: 37 },
        { x: 117, y: 77 },
      ],
    ],
    // Sharpen has no kernel reach, so its frame is the layer's own.
    [
      'sharpen',
      { toolName: 'sharpen', amount: 120, radius: 5 } as SharpenToolArgs,
      { x: 0, y: 0, width: 200, height: 120 },
      [
        { x: 20, y: 20 },
        { x: 100, y: 60 },
      ],
    ],
  ] as const)(
    'hands the %s settings through untouched, alongside the rebased points',
    (toolName, args, rasterBounds, points) => {
      // Every field differs from the seed, so the payload is distinguishable field by field. The
      // whole object is asserted rather than `points` alone because a spread applied BEFORE the
      // rebase — `{ ...points, ...args }` — yields the same `points` and a wrong `rasterBounds`,
      // and only a full comparison separates the two orders.
      storeState.layers = { base: makeLayer('base') };
      toolState.toolName = toolName;
      toolState.toolArgs = args;
      const { toolArea } = renderArea(toolName);

      stroke(toolArea, [20, 20], [100, 60]);

      expect(commitCalls()[0]!.toolArgs).toEqual({ ...args, points, rasterBounds });
    }
  );

  it.each(['blur', 'sharpen'] as const)('gives each %s preview its own points array', (toolName) => {
    toolState.toolName = toolName;
    toolState.toolArgs = toolName === 'blur' ? blurArgs() : sharpenArgs();
    const { toolArea } = renderArea(toolName);

    fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, clientX: 10, clientY: 20 });
    fireEvent.pointerMove(toolArea, { button: 0, pointerId: 1, clientX: 30, clientY: 50 });
    fireEvent.pointerMove(toolArea, { button: 0, pointerId: 1, clientX: 60, clientY: 70 });

    const [first, second] = previewCalls();
    // `usePaintStroke` hands `onMove` the LIVE accumulating array, and `tempUpdateLayer` runs the
    // processor synchronously over it. If the component forwarded that array by reference, both
    // previews would alias it and the first would retroactively show the second's geometry.
    expect(first!.toolArgs.points).not.toBe(second!.toolArgs.points);
    expect(first!.toolArgs.points).toHaveLength(2);
    expect(second!.toolArgs.points).toHaveLength(3);
  });

  it.each(['blur', 'sharpen'] as const)(
    'binds the %s gesture to the store container and the store total size',
    (toolName) => {
      toolState.toolName = toolName;
      toolState.toolArgs = toolName === 'blur' ? blurArgs() : sharpenArgs();
      renderArea(toolName);

      // A component deriving either for itself would look identical in the DOM and be silently wrong
      // in a cropped document, and the `pointercancel` abort listener would land on the wrong node.
      expect(pointerState.hookOptions?.imageSize).toEqual({ width: 200, height: 120 });
      expect(pointerState.hookOptions?.ref).toBe(storeState.containerRef);
    }
  );

  it.each(['blur', 'sharpen'] as const)(
    'renders a %s surface carrying the supplied className and a crosshair cursor',
    (toolName) => {
      toolState.toolName = toolName;
      toolState.toolArgs = toolName === 'blur' ? blurArgs() : sharpenArgs();
      const { toolArea } = renderArea(toolName);

      expect(toolArea.className).toBe('test-focus-area cursor-crosshair');
    }
  );

  it('pins the tip radius the frame and the mask must agree on', () => {
    // The frame this area allocates is `FOCUS_STROKE_BRUSH_SIZE / 2` wider than the stroke, and the
    // processors clip to that same radius. A drift in either direction is invisible everywhere
    // else — it clips a tip against the frame, or grows padding nobody painted — so the shared
    // constant is asserted rather than left to two literals agreeing.
    expect(FOCUS_STROKE_BRUSH_SIZE / 2).toBe(20);
  });
});
