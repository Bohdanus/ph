import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import type { RefObject } from 'react';
import { CloneStampToolArea } from '../CloneStampToolArea.tsx';
import type { Layer, LayersRecord } from '../../../contexts/layer-types.ts';
import type { CloneStampToolArgs } from '../../../tools/cloneStamp.ts';

const tempUpdateLayerMock = vi.hoisted(() => vi.fn());
const updateLayerByToolMock = vi.hoisted(() => vi.fn());
/**
 * `createLayerFromTool` is in the mock on purpose even though the Clone Stamp must never reach
 * it: a mock that simply omitted it would turn a regression that cloned through the
 * layer-CREATING path into a `TypeError` rather than an assertion, and a test that cannot fail
 * on the defect is not a pin. `EraserToolArea.test.tsx` and `SmudgeToolArea.test.tsx` carry it
 * for the same reason — a Clone Stamp that created a new layer would composite its copy over a
 * transparent hole, which looks alive, drags nothing, and cannot be undone.
 */
const createLayerFromToolMock = vi.hoisted(() => vi.fn());
const patchToolArgsMock = vi.hoisted(() => vi.fn());

const pointerState = vi.hoisted(() => ({
  isMouseDown: { current: false },
  activePointer: null as number | null,
  /**
   * Every `usePointerPosition` instantiation this component tree makes, in call order. There are
   * two, and the first is the component's OWN instance: `CloneStampToolArea` reaches for a second
   * one purely to get `getLocalCoords` for the Alt branch, because `usePaintStroke` does not
   * expose it. The second is `usePaintStroke`'s, which is the one that ever captures a pointer.
   */
  hookCalls: [] as { ref: unknown; imageSize: unknown }[],
}));

/**
 * A controllable `requestAnimationFrame`. `requestMarkerRedraw` schedules through it, so a
 * jsdom frame timer would make every marker assertion a race; the handle map also makes the
 * `markerFrameRef.current = null` reset inside `redrawMarker` observable, because a handle whose
 * frame was flushed must be schedulable again.
 */
const frameState = vi.hoisted(() => ({
  pending: new Map<number, FrameRequestCallback>(),
  nextHandle: 1,
}));
const rafMock = vi.hoisted(() => vi.fn());
const cancelFrameMock = vi.hoisted(() => vi.fn());
rafMock.mockImplementation((callback: FrameRequestCallback) => {
  const handle = frameState.nextHandle++;
  frameState.pending.set(handle, callback);
  return handle;
});
cancelFrameMock.mockImplementation((handle: number) => {
  frameState.pending.delete(handle);
});

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

const toolState = vi.hoisted((): { toolArgs: CloneStampToolArgs } => ({
  toolArgs: {
    toolName: 'clone-stamp',
    size: 33,
    hardness: 40,
    alpha: 0.75,
    source: null,
    aligned: true,
    points: [],
  },
}));

vi.mock('../../../contexts/StoreContext.tsx', () => ({
  useStore: () => [
    {
      // The store's own container, not a fresh node per render: `usePaintStroke` attaches its
      // native `pointercancel` abort listener to `containerRef.current`, and a store handing out a
      // different div on every render would move that listener under each event.
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
 * The Clone Stamp is the ONE tool area that WRITES tool args: `patchToolArgs('clone-stamp', …)`
 * is the Alt-click's only effect, so both halves of `useCurrentTool` are mocked. A mock carrying
 * only `toolArgs` would make the Alt branch a `TypeError`, which is a crash, not a pin.
 */
vi.mock('../../../contexts/useCurrentTool.tsx', () => ({
  useCurrentTool: () => ({ toolArgs: toolState.toolArgs, patchToolArgs: patchToolArgsMock }),
}));

/**
 * A faithful stand-in for the real `usePointerPosition` capture contract: the first `pointerDown`
 * claims the pointer and only that pointer's move/up are valid. A mock that let everything through
 * would make "a gesture the tool never saw" unobservable, which is exactly the state a disabled
 * `usePaintStroke` produces — and every refusal case below is proved by the claim never being
 * taken.
 *
 * `getLocalCoords` is the IDENTITY function here, not production's
 * `(clientX - offsetX - rect.x) / scale`. Every expected coordinate in this file is therefore a
 * product of that mock, and the file consequently covers no client-to-canvas conversion at all:
 * the contain fit in `src/hooks/usePointerPosition.ts` — the scale, the offset, the rect — is
 * asserted nowhere below. Production's conversion could not be exercised here even in principle,
 * because it divides by the measured rect, and this store's `containerRef` is a bare div whose
 * jsdom rect is all zeroes. The rebase cases below move the LAYER origin or the CROP origin off
 * zero to keep the crop translation and the layer rebase from cancelling out.
 */
vi.mock('../../../hooks/usePointerPosition.ts', () => ({
  usePointerPosition: (options: { ref: unknown; imageSize: unknown }) => {
    pointerState.hookCalls.push(options);
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
  presentationBounds: null,
  operations: [],
  ...overrides,
});

/** A layer carrying a retained translation: the evaluated extent moves the raster's origin. */
const TRANSLATED_LAYER: Layer = makeLayer('base', {
  pos: { x: 30, y: 20, width: 200, height: 120 },
  operations: [
    {
      id: 'op-1',
      kind: 'affine-transform',
      enabled: true,
      transform: { a: 1, b: 0, c: 0, d: 1, e: 20, f: 10 },
    },
  ],
});

/** The sampled source, and every setting the Clone Stamp bar owns, in document space. */
const cloneArgs = (overrides: Partial<CloneStampToolArgs> = {}): CloneStampToolArgs => ({
  toolName: 'clone-stamp',
  size: 33,
  hardness: 40,
  alpha: 0.75,
  source: { x: 150, y: 90 },
  aligned: true,
  points: [],
  ...overrides,
});

/** Every paint-family method a raster tool or the overlay chrome could reach for, as spies. */
const CONTEXT_METHODS = [
  'drawImage',
  'putImageData',
  'getImageData',
  'clearRect',
  'fillRect',
  'strokeRect',
  'beginPath',
  'arc',
  'moveTo',
  'lineTo',
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
  canvas: { width: number; height: number };
  globalCompositeOperation: GlobalCompositeOperation;
  strokeStyle: string;
  lineWidth: number;
  lineCap: CanvasLineCap;
};

/**
 * The overlay context double. The `stroke` spy records the style it was CALLED with rather than
 * the style left behind, because `drawCloneSourceMarker` paints every stroke twice — a wide dark
 * halo and then a white hairline — so the only way to assert both is to sample at the moment of
 * the call.
 *
 * Every own-state field is SEEDED, and the seeds are asserted as seeds. `strokeStyle: ''` and
 * `lineWidth: 0` are falsifiable already, because `drawCloneSourceMarker` writes both before every
 * stroke. `lineCap` is seeded `'round'` for the same reason and on purpose: `drawCloneSourceMarker`
 * assigns `'butt'`, so an assertion of `'butt'` can no longer pass on the seed and now says "wrote
 * butt" rather than "wrote nothing". `globalCompositeOperation` is the one field NO painting path
 * here ever writes, so it carries no per-field claim and is asserted only as part of the canvas
 * double's whole untouched state.
 */
const makeSpyContext = (): { context: SpyContext; strokes: { strokeStyle: string; lineWidth: number }[] } => {
  const strokes: { strokeStyle: string; lineWidth: number }[] = [];
  const context = {
    canvas: { width: 640, height: 480 },
    globalCompositeOperation: 'source-over' as GlobalCompositeOperation,
    strokeStyle: '',
    lineWidth: 0,
    lineCap: 'round' as CanvasLineCap,
  } as SpyContext;
  for (const method of CONTEXT_METHODS) context[method] = vi.fn();
  context.stroke.mockImplementation(() => {
    strokes.push({ strokeStyle: context.strokeStyle, lineWidth: context.lineWidth });
  });
  return { context, strokes };
};

const paintedMethods = (context: SpyContext): string[] =>
  CONTEXT_METHODS.filter((method) => context[method].mock.calls.length > 0);

const clearContextLog = (context: SpyContext, strokes: { strokeStyle: string; lineWidth: number }[]): void => {
  for (const method of CONTEXT_METHODS) context[method].mockClear();
  strokes.length = 0;
};

/**
 * The double is a plain object of spies rather than a real `CanvasRenderingContext2D`, so it is
 * handed to the component through the prop's own type. The assertion side needs the real method
 * names (`clearRect`, `arc`, …), which is why it is spelled out rather than proxied.
 */
const asOverlayRef = (context: SpyContext): RefObject<CanvasRenderingContext2D | null> =>
  ({ current: context }) as unknown as RefObject<CanvasRenderingContext2D | null>;

/** One identity for the whole file, so the marker's effect deps do not churn between renders. */
const NO_OVERLAY = { current: null } as RefObject<CanvasRenderingContext2D | null>;

const areaElement = (overlayCtxRef: RefObject<CanvasRenderingContext2D | null>) => (
  <CloneStampToolArea className="test-clone-stamp-area" overlayCtxRef={overlayCtxRef} />
);

const renderArea = (
  overlayCtxRef: RefObject<CanvasRenderingContext2D | null> = NO_OVERLAY,
  options: { container?: HTMLElement } = {}
) => {
  const view = render(areaElement(overlayCtxRef), options);
  return { toolArea: view.container.firstElementChild as HTMLDivElement, view };
};

/**
 * One press/move/release on the same pointer id. The `clientX`/`clientY` given here arrive at the
 * component as canvas coordinates unchanged, because the mocked `getLocalCoords` is the identity
 * function described above — NOT because the frames agree. So every expected point in this file is
 * a mock product, and what the rebase cases below actually measure is the crop translation and the
 * layer origin, each moved off zero on its own.
 */
const stroke = (toolArea: HTMLDivElement, from: [number, number], to: [number, number]) => {
  fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, clientX: from[0], clientY: from[1] });
  fireEvent.pointerMove(toolArea, { button: 0, pointerId: 1, clientX: to[0], clientY: to[1] });
  fireEvent.pointerUp(toolArea, { button: 0, pointerId: 1, clientX: to[0], clientY: to[1] });
};

type ToolLayerCall = { id: string; toolArgs: CloneStampToolArgs };

const previewCalls = (): ToolLayerCall[] => tempUpdateLayerMock.mock.calls.map((call) => call[0] as ToolLayerCall);
const commitCalls = (): ToolLayerCall[] => updateLayerByToolMock.mock.calls.map((call) => call[0] as ToolLayerCall);

/** Run every queued frame callback, as the browser would on the next tick. */
const flushFrames = (): void => {
  const queued = [...frameState.pending.values()];
  frameState.pending.clear();
  for (const callback of queued) callback(16);
};

/** Hold Alt the way a user does, then let the marker paint. */
const pressAlt = (): void => {
  fireEvent.keyDown(window, { key: 'Alt' });
};

/** Hosts this file attached to `document.body`, for the native `pointercancel` route. */
const attachedHosts: HTMLDivElement[] = [];
afterEach(() => {
  while (attachedHosts.length) attachedHosts.pop()?.remove();
  vi.unstubAllGlobals();
});

describe('CloneStampToolArea', () => {
  beforeEach(() => {
    tempUpdateLayerMock.mockClear();
    updateLayerByToolMock.mockClear();
    createLayerFromToolMock.mockClear();
    patchToolArgsMock.mockClear();
    rafMock.mockClear();
    cancelFrameMock.mockClear();
    frameState.pending.clear();
    frameState.nextHandle = 1;
    pointerState.isMouseDown.current = false;
    pointerState.activePointer = null;
    pointerState.hookCalls = [];
    storeState.documentFrame = null;
    storeState.containerRef = { current: document.createElement('div') };
    storeState.layers = { base: makeLayer('base') };
    storeState.activeLayerId = 'base';
    toolState.toolArgs = cloneArgs();
    vi.stubGlobal('requestAnimationFrame', rafMock);
    vi.stubGlobal('cancelAnimationFrame', cancelFrameMock);
  });

  describe('the clone gesture', () => {
    it('previews every move and commits the stroke exactly once on a normal layer', () => {
      const { toolArea } = renderArea();

      stroke(toolArea, [20, 20], [100, 60]);

      // The whole payload, both writers. `tempUpdateLayer` is the only writer of
      // `previewLayersRef`, so a commit reached without a preview would write a `TOOL_ACTION` whose
      // pixels `commitDirtyTool` cannot promote — silently and permanently un-undoable.
      // `bitmap: null` throughout: the component gates on the layer RECORD, never on its raster.
      expect(previewCalls()).toEqual([
        {
          id: 'base',
          toolArgs: {
            ...cloneArgs(),
            source: { x: 150, y: 90 },
            points: [
              { x: 20, y: 20 },
              { x: 100, y: 60 },
            ],
          },
        },
      ]);
      expect(commitCalls()).toEqual([
        {
          id: 'base',
          toolArgs: {
            ...cloneArgs(),
            source: { x: 150, y: 90 },
            points: [
              { x: 20, y: 20 },
              { x: 100, y: 60 },
            ],
          },
        },
      ]);
      expect(createLayerFromToolMock).not.toHaveBeenCalled();
    });

    it('rebases the source and the stroke by the layer origin, in one translation', () => {
      // The layer sits off the origin, so the rebase has to be applied to the SOURCE as well as
      // the stroke or the copy would be read from the wrong place entirely.
      storeState.layers = { base: makeLayer('base', { pos: { x: 30, y: 20, width: 200, height: 120 } }) };
      const { toolArea } = renderArea();

      fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, clientX: 40, clientY: 50 });
      fireEvent.pointerMove(toolArea, { button: 0, pointerId: 1, clientX: 120, clientY: 80 });
      fireEvent.pointerUp(toolArea, { button: 0, pointerId: 1, clientX: 150, clientY: 110 });

      const [commit] = commitCalls();
      // Document (150, 90) − (30, 20), and the three document samples shifted by the same origin.
      // The SAME translation on both is the claim: a rebase that moved one and not the other would
      // leave the pair describing two different points of the document.
      expect(commit.toolArgs.source).toEqual({ x: 120, y: 70 });
      expect(commit.toolArgs.points).toEqual([
        { x: 10, y: 30 },
        { x: 90, y: 60 },
        { x: 120, y: 90 },
      ]);
      // Which point the processor anchors on is `cloneOffset`'s business in
      // `src/tools/cloneStamp.ts`, not this component's: the component's part is that it neither
      // reorders `points` nor measures anything itself, and `aligned` reaches the processor as it
      // was stored. Both are pinned by the exact payload assertions above and in the settings test.
    });

    it('carries aligned: false through the same rebase unchanged', () => {
      toolState.toolArgs = cloneArgs({ aligned: false });
      storeState.layers = { base: makeLayer('base', { pos: { x: 30, y: 20, width: 200, height: 120 } }) };
      const { toolArea } = renderArea();

      fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, clientX: 40, clientY: 50 });
      fireEvent.pointerMove(toolArea, { button: 0, pointerId: 1, clientX: 120, clientY: 80 });
      fireEvent.pointerUp(toolArea, { button: 0, pointerId: 1, clientX: 150, clientY: 110 });

      const [commit] = commitCalls();
      // The flag is handed over as stored…
      expect(commit.toolArgs.aligned).toBe(false);
      // …and it changes NOTHING about the translation: the payload is the aligned case's, minus
      // the flag. A component that consumed the flag into a different anchor, a shifted stroke, or
      // a dropped field would show one of these three numbers move.
      expect(commit.toolArgs.source).toEqual({ x: 120, y: 70 });
      expect(commit.toolArgs.points).toEqual([
        { x: 10, y: 30 },
        { x: 90, y: 60 },
        { x: 120, y: 90 },
      ]);
    });

    it('hands the processor the Clone Stamp settings unchanged', () => {
      toolState.toolArgs = cloneArgs({ size: 47, hardness: 10, alpha: 0.4, aligned: false });
      const { toolArea } = renderArea();

      stroke(toolArea, [20, 20], [100, 60]);

      // The whole args object, not only `source` and `points`. `cloneStamp` reads `size` as the
      // tip DIAMETER, `hardness` as the 0-100 falloff and `alpha` as the per-dab copy strength it
      // maps onto the engine's `opacity`; a spread that dropped one, or spread the rebased points
      // over them, would clone with the wrong tip and no assertion here would notice.
      expect(commitCalls()[0].toolArgs).toEqual({
        toolName: 'clone-stamp',
        size: 47,
        hardness: 10,
        alpha: 0.4,
        source: { x: 150, y: 90 },
        aligned: false,
        points: [
          { x: 20, y: 20 },
          { x: 100, y: 60 },
        ],
      });
    });

    it('rebases onto the EVALUATED extent of a transformed layer rather than its raw pos', () => {
      storeState.layers = { base: TRANSLATED_LAYER };
      const { toolArea } = renderArea();

      stroke(toolArea, [40, 50], [120, 80]);

      // A layer carrying a retained affine is handed a buffer staged at its evaluated extent, so
      // `processorPresentationBounds` is the origin: `pos` says (30, 20), the evaluated extent
      // says (50, 30), and the source is rebased with them.
      expect(commitCalls()[0].toolArgs.source).toEqual({ x: 100, y: 60 });
      expect(commitCalls()[0].toolArgs.points).toEqual([
        { x: -10, y: 20 },
        { x: 70, y: 50 },
      ]);
    });

    it('converts canvas coordinates through the crop frame before reaching the layer', () => {
      // `usePaintStroke` ADDS the crop origin to every canvas sample and the component SUBTRACTS
      // the layer's own, so a layer sitting on the crop origin hands the processor exactly the
      // canvas coordinates. Subtracting from the raw client coordinate instead would land the
      // press at (30, 35).
      storeState.documentFrame = { x: 10, y: 15, width: 200, height: 120 };
      storeState.layers = { base: makeLayer('base', { pos: { x: 10, y: 15, width: 200, height: 120 } }) };
      const { toolArea } = renderArea();

      stroke(toolArea, [40, 50], [120, 80]);

      expect(commitCalls()[0].toolArgs.points).toEqual([
        { x: 40, y: 50 },
        { x: 120, y: 80 },
      ]);
      // The source is a DOCUMENT point, so it takes the crop origin on and the layer's off:
      // (150 + 10 − 10, 90 + 15 − 15).
      expect(commitCalls()[0].toolArgs.source).toEqual({ x: 140, y: 75 });
    });

    it('gives each preview its own points array, so a later move cannot shift an earlier one', () => {
      storeState.layers = { base: makeLayer('base', { pos: { x: 30, y: 20, width: 200, height: 120 } }) };
      const { toolArea } = renderArea();

      fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, clientX: 40, clientY: 50 });
      fireEvent.pointerMove(toolArea, { button: 0, pointerId: 1, clientX: 60, clientY: 70 });
      fireEvent.pointerMove(toolArea, { button: 0, pointerId: 1, clientX: 90, clientY: 90 });
      fireEvent.pointerUp(toolArea, { button: 0, pointerId: 1, clientX: 90, clientY: 90 });

      // `onMove` receives the hook's LIVE accumulating array, which every later move appends to.
      // `documentPointsToLayerLocal` maps it into a new array of new points, so the first preview
      // still reads as the two points it was when it was made: a rebase written in place would
      // show (10, 30), (30, 50) AND (90, 90) here, and the stroke would creep diagonally.
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
      expect(first.toolArgs.points).not.toBe(second.toolArgs.points);
      expect(commitCalls()[0].toolArgs.points).toEqual([
        { x: 10, y: 30 },
        { x: 30, y: 50 },
        { x: 60, y: 70 },
      ]);
    });

    it('commits a single point for a click that never moves', () => {
      const { toolArea } = renderArea();

      fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, clientX: 70, clientY: 70 });
      fireEvent.pointerUp(toolArea, { button: 0, pointerId: 1, clientX: 70, clientY: 70 });

      // A release that lands where the stroke already is adds nothing, and a duplicated point
      // doubles the width of a size-varying tip. `cloneStroke` still copies one dab, so the click
      // is a real edit — one point, and no preview for a gesture that never moved.
      expect(commitCalls()[0].toolArgs.points).toEqual([{ x: 70, y: 70 }]);
      // The sampled source is handed over untouched: a layer on the origin has nothing to rebase,
      // so the document point is the point the processor gets.
      expect(commitCalls()[0].toolArgs.source).toEqual({ x: 150, y: 90 });
      expect(tempUpdateLayerMock).not.toHaveBeenCalled();
    });

    it('binds both of its pointer-position instances to the store container and the store total size', () => {
      renderArea();

      // Two instances, in a fixed order: the component's own (for the Alt branch's `getLocalCoords`)
      // first, then the one inside `usePaintStroke`. Both compute their contain dimensions from
      // the same `getBoundingClientRect`, so a component that sized its Alt conversions from
      // anything but the store would look identical in the DOM and be wrong in a cropped document.
      expect(pointerState.hookCalls).toHaveLength(2);
      expect(pointerState.hookCalls.map((call) => call.ref)).toEqual([
        storeState.containerRef,
        storeState.containerRef,
      ]);
      expect(pointerState.hookCalls.map((call) => call.imageSize)).toEqual([
        { width: 200, height: 120 },
        { width: 200, height: 120 },
      ]);
    });

    it('clones a layer flagged locked, because only bedrock is gated', () => {
      // `isEnabled` reads `isBedrock` and nothing else about the layer: no `bitmap`, no `locked`,
      // no `visible`. Pinning the absence is the point — a future gate added here would be a
      // behaviour change, and this test is the thing that would have to change with it.
      storeState.layers = { base: makeLayer('base', { locked: true, visible: false, bitmap: null }) };
      const { toolArea } = renderArea();

      stroke(toolArea, [20, 20], [100, 60]);

      expect(commitCalls()).toEqual([
        {
          id: 'base',
          toolArgs: {
            ...cloneArgs(),
            source: { x: 150, y: 90 },
            points: [
              { x: 20, y: 20 },
              { x: 100, y: 60 },
            ],
          },
        },
      ]);
    });
  });

  /**
   * Every case below asserts that NOTHING happened, so each one ends by making the same gesture
   * through an enabled configuration and showing the exact payload it must produce. A gate that
   * disabled the surface altogether could not be distinguished from a gate that disabled the
   * surface correctly.
   */
  describe('the gates that refuse the gesture', () => {
    const enableNormal = () => {
      storeState.layers = { base: makeLayer('base') };
      storeState.activeLayerId = 'base';
      toolState.toolArgs = cloneArgs();
    };

    const strokeAndProve = (view: ReturnType<typeof render>, toolArea: HTMLDivElement) => {
      enableNormal();
      view.rerender(areaElement(NO_OVERLAY));
      stroke(toolArea, [20, 20], [100, 60]);
      expect(commitCalls()).toEqual([
        {
          id: 'base',
          toolArgs: {
            ...cloneArgs(),
            source: { x: 150, y: 90 },
            points: [
              { x: 20, y: 20 },
              { x: 100, y: 60 },
            ],
          },
        },
      ]);
    };

    it('writes nothing at all for a stroke over the bedrock layer', () => {
      // Bedrock is the document's own backing image: there is no layer to commit onto, so a stroke
      // over it would have nowhere to go.
      storeState.layers = { base: makeLayer('base', { isBedrock: true }) };
      const { toolArea, view } = renderArea();

      stroke(toolArea, [20, 20], [100, 60]);

      // BOTH writers, and the preview is the load-bearing half: it is the only writer of
      // `previewLayersRef`, so a preview that reached it would already have destroyed the pixels
      // the stroke is about to sample. Nothing claimed the pointer either, because the refusal
      // happens above `usePointerPosition`'s validators.
      expect(tempUpdateLayerMock).not.toHaveBeenCalled();
      expect(updateLayerByToolMock).not.toHaveBeenCalled();
      expect(createLayerFromToolMock).not.toHaveBeenCalled();
      expect(pointerState.activePointer).toBeNull();
      strokeAndProve(view, toolArea);
    });

    it('proves usePaintStroke is disabled on a bedrock layer and enabled on a non-bedrock layer', () => {
      // Bedrock: `enabled` is false, so `usePaintStroke` returns from every handler before
      // reaching a callback — nothing claims the pointer, and both writers are silent.
      storeState.layers = { base: makeLayer('base', { isBedrock: true }) };
      storeState.activeLayerId = 'base';
      const { toolArea } = renderArea(NO_OVERLAY);

      stroke(toolArea, [20, 20], [100, 60]);

      expect(tempUpdateLayerMock).not.toHaveBeenCalled();
      expect(updateLayerByToolMock).not.toHaveBeenCalled();
      expect(pointerState.activePointer).toBeNull();

      // Non-bedrock: `enabled` is true, so `usePaintStroke` captures the pointer and fires
      // both the preview and the commit callbacks exactly once.
      storeState.layers = { base: makeLayer('base') };
      storeState.activeLayerId = 'base';
      const { toolArea: toolArea2 } = renderArea(NO_OVERLAY);

      stroke(toolArea2, [20, 20], [100, 60]);

      expect(tempUpdateLayerMock).toHaveBeenCalledTimes(1);
      expect(updateLayerByToolMock).toHaveBeenCalledTimes(1);
      expect(pointerState.activePointer).toBeNull();
    });

    it('commits nothing when there is no active layer', () => {
      storeState.activeLayerId = null;
      const { toolArea, view } = renderArea();

      stroke(toolArea, [20, 20], [100, 60]);

      // `activeLayerId` is the first term of `isEnabled`, and with it gone there is also no raster
      // to rebase onto — `buildLayerArgs` would have no layer and would refuse anyway.
      expect(tempUpdateLayerMock).not.toHaveBeenCalled();
      expect(updateLayerByToolMock).not.toHaveBeenCalled();
      expect(createLayerFromToolMock).not.toHaveBeenCalled();
      expect(pointerState.activePointer).toBeNull();
      strokeAndProve(view, toolArea);
    });

    it('commits nothing when the active layer id names a layer the store no longer holds', () => {
      // A layer deleted from under the pointer leaves the id behind for a render or two.
      // `isEnabled` consults the LAYER, not the id, so a stale id alone must not hand a clone to a
      // layer that does not exist.
      storeState.layers = {};
      storeState.activeLayerId = 'deleted-under-the-pointer';
      const { toolArea, view } = renderArea();

      stroke(toolArea, [20, 20], [100, 60]);

      expect(tempUpdateLayerMock).not.toHaveBeenCalled();
      expect(updateLayerByToolMock).not.toHaveBeenCalled();
      expect(createLayerFromToolMock).not.toHaveBeenCalled();
      strokeAndProve(view, toolArea);
    });

    it('commits nothing until the user has Alt-clicked a source', () => {
      // The third gate is the tool's own: with no source there is nothing to copy FROM, so every
      // stroke would be a no-op. Refusing the gesture beats committing a `TOOL_ACTION` for an edit
      // that changed no pixels, which is what would make undo appear to do nothing.
      toolState.toolArgs = cloneArgs({ source: null });
      const { toolArea, view } = renderArea();

      stroke(toolArea, [20, 20], [100, 60]);

      expect(tempUpdateLayerMock).not.toHaveBeenCalled();
      expect(updateLayerByToolMock).not.toHaveBeenCalled();
      expect(createLayerFromToolMock).not.toHaveBeenCalled();
      strokeAndProve(view, toolArea);
    });

    it('renders the not-allowed cursor for every refused configuration, and the crosshair once enabled', () => {
      toolState.toolArgs = cloneArgs({ source: null });
      const { toolArea, view } = renderArea();

      // The class is the only place the refusal is visible to a user who is not dragging.
      expect(toolArea.tagName).toBe('DIV');
      expect(toolArea).toHaveClass('test-clone-stamp-area', 'cursor-not-allowed');
      expect(toolArea).not.toHaveClass('cursor-crosshair');

      enableNormal();
      view.rerender(areaElement(NO_OVERLAY));

      expect(toolArea).toHaveClass('test-clone-stamp-area', 'cursor-crosshair');
      expect(toolArea).not.toHaveClass('cursor-not-allowed');
      expect(toolArea.style.userSelect).toBe('none');
    });

    it('records the Alt-clicked source on a bedrock layer, because that branch is not gated', () => {
      // The two gestures are decided at pointer-DOWN by the modifier, not by `isEnabled`, so a
      // source can be sampled over a layer the tool refuses to clone onto. Pinned as behaviour,
      // not as an endorsement: it is what a user who Alt-clicked the bedrock and switched to a
      // layer above it actually gets.
      storeState.layers = { base: makeLayer('base', { isBedrock: true }) };
      const { toolArea } = renderArea();

      fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, altKey: true, clientX: 40, clientY: 50 });

      expect(patchToolArgsMock.mock.calls).toEqual([['clone-stamp', { source: { x: 40, y: 50 } }]]);
      expect(updateLayerByToolMock).not.toHaveBeenCalled();
      expect(tempUpdateLayerMock).not.toHaveBeenCalled();
    });
  });

  describe('the Alt-click and its source marker', () => {
    it('records the sampled source in document space and starts no stroke', () => {
      const overlay = makeSpyContext();
      const { toolArea } = renderArea(asOverlayRef(overlay.context));

      fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, altKey: true, clientX: 40, clientY: 50 });
      fireEvent.pointerMove(toolArea, { button: 0, pointerId: 1, altKey: true, clientX: 90, clientY: 70 });
      fireEvent.pointerUp(toolArea, { button: 0, pointerId: 1, altKey: true, clientX: 90, clientY: 70 });

      // The ONE write the Alt branch makes, in the same document space `points` will be in — which
      // is the only reason the offset arithmetic is readable at all.
      expect(patchToolArgsMock.mock.calls).toEqual([['clone-stamp', { source: { x: 40, y: 50 } }]]);
      // No stroke: the press never reached `usePaintStroke`, so nothing claimed the pointer and
      // every later event of that drag was refused by the hook's own validators.
      expect(pointerState.activePointer).toBeNull();
      expect(tempUpdateLayerMock).not.toHaveBeenCalled();
      expect(updateLayerByToolMock).not.toHaveBeenCalled();
      // Mounting with Alt up draws the overlay's clear and nothing else — the `if (!visible)`
      // early return — so no ring and no crosshair exist yet.
      expect(overlay.context.clearRect.mock.calls).toEqual([[0, 0, 640, 480]]);
      expect(overlay.context.save).not.toHaveBeenCalled();
      expect(overlay.strokes).toEqual([]);
    });

    it('takes the Alt-click through the crop origin, because the source is stored in document space', () => {
      storeState.documentFrame = { x: 10, y: 15, width: 200, height: 120 };
      const { toolArea } = renderArea();

      fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, altKey: true, clientX: 40, clientY: 50 });

      // `canvasToDocumentPoint` ADDS the crop origin here, exactly as `usePaintStroke` adds it to
      // every stroke sample. Storing the raw canvas coordinate instead would make the offset
      // against `points` wrong by the crop.
      expect(patchToolArgsMock.mock.calls).toEqual([['clone-stamp', { source: { x: 50, y: 65 } }]]);
    });

    it('prevents the browser default on the Alt-click press, so an Option-drag cannot start', () => {
      const { toolArea } = renderArea();

      // `fireEvent` returns `dispatchEvent`'s verdict, which is false only for a cancelable event
      // whose default someone prevented. That makes the two lines a measurement of the Alt branch
      // rather than a claim about it.
      expect(fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, altKey: true, clientX: 40, clientY: 50 })).toBe(
        false
      );
      // The plain press on the same element is NOT prevented, so the contrast is the Alt branch's
      // doing rather than the harness's.
      expect(fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, clientX: 60, clientY: 60 })).toBe(true);
      expect(pointerState.activePointer).toBe(1);
    });

    it('takes the Alt gesture from the held-key state too, for a press reported without the flag', () => {
      const { toolArea } = renderArea();
      // The state is read at press as well as the flag, so a press the browser reported without
      // `altKey` still refuses to paint rather than cloning with a stale source.
      pressAlt();
      patchToolArgsMock.mockClear();

      fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, clientX: 40, clientY: 50 });
      fireEvent.pointerMove(toolArea, { button: 0, pointerId: 1, clientX: 90, clientY: 70 });
      fireEvent.pointerUp(toolArea, { button: 0, pointerId: 1, clientX: 90, clientY: 70 });

      expect(patchToolArgsMock.mock.calls).toEqual([['clone-stamp', { source: { x: 40, y: 50 } }]]);
      expect(pointerState.activePointer).toBeNull();
      expect(updateLayerByToolMock).not.toHaveBeenCalled();
    });

    it('draws the ring at the source and the crosshair under the cursor, halo then hairline', () => {
      const overlay = makeSpyContext();
      const { toolArea } = renderArea(asOverlayRef(overlay.context));
      pressAlt();
      clearContextLog(overlay.context, overlay.strokes);

      fireEvent.pointerMove(toolArea, { button: 0, pointerId: 1, altKey: true, clientX: 40, clientY: 50 });
      flushFrames();

      // The crosshair's four endpoints around the pointer at (40, 50): six pixels each way, which
      // is `CROSSHAIR_ARM`.
      expect(overlay.context.moveTo.mock.calls).toEqual([
        [34, 50],
        [40, 44],
      ]);
      expect(overlay.context.lineTo.mock.calls).toEqual([
        [46, 50],
        [40, 56],
      ]);
      // The ring at the sampled source, in CANVAS space, radius ten.
      expect(overlay.context.arc.mock.calls).toEqual([[150, 90, 10, 0, Math.PI * 2]]);
      // Every stroke is painted twice — a 3px `rgba(0, 0, 0, 0.85)` halo and a 1px white hairline —
      // because a single-colour ring is invisible over half of any photograph. Four strokes, in
      // that order, for the crosshair then the ring.
      expect(overlay.strokes).toEqual([
        { strokeStyle: 'rgba(0, 0, 0, 0.85)', lineWidth: 3 },
        { strokeStyle: '#ffffff', lineWidth: 1 },
        { strokeStyle: 'rgba(0, 0, 0, 0.85)', lineWidth: 3 },
        { strokeStyle: '#ffffff', lineWidth: 1 },
      ]);
      // Drawn inside one save/restore pair, so the shared overlay's own state survives.
      expect(overlay.context.save).toHaveBeenCalledTimes(1);
      expect(overlay.context.restore).toHaveBeenCalledTimes(1);
      // The double seeds `'round'`, so this is the marker's own write and not the seed: deleting
      // `ctx.lineCap = 'butt'` leaves `'round'` here and fails.
      expect(overlay.context.lineCap).toBe('butt');
      // The overlay is shared, so the marker owns a FULL clear rather than its own bounding box.
      expect(overlay.context.clearRect.mock.calls).toEqual([[0, 0, 640, 480]]);
    });

    it('draws the ring at the source in canvas space, subtracting the crop origin', () => {
      storeState.documentFrame = { x: 10, y: 15, width: 200, height: 120 };
      const overlay = makeSpyContext();
      renderArea(asOverlayRef(overlay.context));

      // No pointer move, so there is no crosshair: the ring alone is the marker saying "a source is
      // sampled" before the user has pointed anywhere. Alt going down repaints through the effect
      // rather than through a frame — the marker has to appear the instant the key does, before
      // any pointer has moved.
      pressAlt();

      // `documentToCanvasPoint` is the INVERSE of the conversion the Alt-click applied, so the
      // ring lands under the sampled pixel: (150, 90) document is (140, 75) canvas.
      expect(overlay.context.arc.mock.calls).toEqual([[140, 75, 10, 0, Math.PI * 2]]);
      expect(overlay.context.moveTo).not.toHaveBeenCalled();
      expect(overlay.strokes).toEqual([
        { strokeStyle: 'rgba(0, 0, 0, 0.85)', lineWidth: 3 },
        { strokeStyle: '#ffffff', lineWidth: 1 },
      ]);
    });

    it('coalesces the redraws of a moving pointer into one animation frame and releases the slot', () => {
      const overlay = makeSpyContext();
      const { toolArea } = renderArea(asOverlayRef(overlay.context));
      pressAlt();

      fireEvent.pointerMove(toolArea, { button: 0, pointerId: 1, altKey: true, clientX: 40, clientY: 50 });
      fireEvent.pointerMove(toolArea, { button: 0, pointerId: 1, altKey: true, clientX: 60, clientY: 70 });

      // Two moves, one frame: a state write per move would re-render the whole tool area per move
      // to move a crosshair, which is why the hover is a ref.
      expect(rafMock).toHaveBeenCalledTimes(1);
      expect(frameState.pending.size).toBe(1);

      clearContextLog(overlay.context, overlay.strokes);
      flushFrames();

      // The coalesced frame drew the NEWEST hover, read at call time rather than captured.
      expect(overlay.context.moveTo.mock.calls).toEqual([
        [54, 70],
        [60, 64],
      ]);

      fireEvent.pointerMove(toolArea, { button: 0, pointerId: 1, altKey: true, clientX: 90, clientY: 90 });

      // The slot was released inside `redrawMarker`, so the next move schedules a NEW frame under a
      // different handle rather than being dropped forever by a marker that looked pending.
      expect(rafMock).toHaveBeenCalledTimes(2);
      expect(rafMock.mock.calls.map((call) => call[0])).toEqual([expect.any(Function), expect.any(Function)]);
      expect(frameState.pending.size).toBe(1);
    });

    it('drops the crosshair when the pointer leaves, keeping the ring', () => {
      const overlay = makeSpyContext();
      const { toolArea } = renderArea(asOverlayRef(overlay.context));
      pressAlt();
      fireEvent.pointerMove(toolArea, { button: 0, pointerId: 1, altKey: true, clientX: 40, clientY: 50 });
      flushFrames();
      clearContextLog(overlay.context, overlay.strokes);

      fireEvent.pointerLeave(toolArea, { button: 0, pointerId: 1, altKey: true, clientX: 40, clientY: 50 });
      flushFrames();

      // The hover ref is nulled and the redraw happens because Alt is still held: the ring stays
      // and only the crosshair goes, which is the marker saying "source set, pointer off canvas".
      expect(overlay.context.moveTo).not.toHaveBeenCalled();
      expect(overlay.context.arc.mock.calls).toEqual([[150, 90, 10, 0, Math.PI * 2]]);
      expect(overlay.context.clearRect.mock.calls).toEqual([[0, 0, 640, 480]]);
    });

    it('draws the crosshair but no ring while Alt is held and no source has been sampled', () => {
      // The state a user is in for the whole of their first second with the tool: Alt held, no
      // source yet. The crosshair is feedback for the GESTURE, and the ring is feedback for a
      // source, so there is nothing to put one at.
      toolState.toolArgs = cloneArgs({ source: null });
      const overlay = makeSpyContext();
      const { toolArea } = renderArea(asOverlayRef(overlay.context));
      pressAlt();
      clearContextLog(overlay.context, overlay.strokes);

      fireEvent.pointerMove(toolArea, { button: 0, pointerId: 1, altKey: true, clientX: 40, clientY: 50 });
      flushFrames();

      expect(overlay.context.moveTo.mock.calls).toEqual([
        [34, 50],
        [40, 44],
      ]);
      expect(overlay.context.lineTo.mock.calls).toEqual([
        [46, 50],
        [40, 56],
      ]);
      expect(overlay.context.arc).not.toHaveBeenCalled();
      expect(overlay.strokes).toEqual([
        { strokeStyle: 'rgba(0, 0, 0, 0.85)', lineWidth: 3 },
        { strokeStyle: '#ffffff', lineWidth: 1 },
      ]);
    });

    it('does not read an unrelated key press as Alt', () => {
      const overlay = makeSpyContext();
      renderArea(asOverlayRef(overlay.context));

      // `event.key === 'Alt' || event.altKey` — a keydown for a different key, carrying no Alt
      // flag, is neither arm. So the marker is not raised: only the mount's full clear happened.
      fireEvent.keyDown(window, { key: 'Shift' });

      expect(overlay.context.arc).not.toHaveBeenCalled();
      expect(overlay.context.clearRect.mock.calls).toEqual([[0, 0, 640, 480]]);
      expect(overlay.strokes).toEqual([]);

      pressAlt();

      // Anti-vacuity: the same listener DOES raise the marker for the real modifier, so the
      // zeroes above are the predicate's doing rather than a listener that was never wired.
      expect(overlay.context.arc.mock.calls).toEqual([[150, 90, 10, 0, Math.PI * 2]]);
      expect(overlay.strokes).toHaveLength(2);
    });

    it('accepts a keydown that carries only the altKey flag, which is what a synthetic modifier is', () => {
      const overlay = makeSpyContext();
      renderArea(asOverlayRef(overlay.context));
      clearContextLog(overlay.context, overlay.strokes);

      // `event.key` is the layout-independent name for the modifier, but `altKey` is checked too so
      // an event carrying only the flag still lands.
      fireEvent.keyDown(window, { key: 'Control', altKey: true });

      expect(overlay.context.arc.mock.calls).toEqual([[150, 90, 10, 0, Math.PI * 2]]);
      expect(overlay.strokes).toHaveLength(2);
    });

    it('keeps the marker up for a keyup that still carries Alt, and drops it for the Alt keyup', () => {
      const overlay = makeSpyContext();
      const { toolArea } = renderArea(asOverlayRef(overlay.context));
      pressAlt();

      // Releasing ANOTHER key while Alt is held still reports `altKey`, and the keyup arm is the
      // negation of the keydown arm's flag test — so this must not clear the marker.
      fireEvent.keyUp(window, { key: 'Shift', altKey: true });
      clearContextLog(overlay.context, overlay.strokes);
      fireEvent.pointerMove(toolArea, { button: 0, pointerId: 1, altKey: true, clientX: 70, clientY: 80 });
      flushFrames();

      // Alt is still down: the crosshair is drawn at the new hover.
      expect(overlay.context.moveTo.mock.calls).toEqual([
        [64, 80],
        [70, 74],
      ]);

      clearContextLog(overlay.context, overlay.strokes);
      fireEvent.keyUp(window, { key: 'Alt' });

      // Alt released: the overlay is cleared and NOTHING is stroked, because the marker is chrome
      // that exists only while the modifier is held. The ring must not be left over the next tool.
      expect(overlay.context.clearRect.mock.calls).toEqual([[0, 0, 640, 480]]);
      expect(overlay.strokes).toEqual([]);
      expect(overlay.context.restore).not.toHaveBeenCalled();
    });

    it('clears the marker when the window loses focus with Alt held', () => {
      const overlay = makeSpyContext();
      renderArea(asOverlayRef(overlay.context));
      pressAlt();
      expect(overlay.context.arc).toHaveBeenCalledTimes(1);
      clearContextLog(overlay.context, overlay.strokes);

      // A `keyup` never arrives if the window loses focus mid-hold, so a marker stuck on screen
      // with no Alt down is worse than no marker.
      fireEvent.blur(window);

      expect(overlay.context.clearRect.mock.calls).toEqual([[0, 0, 640, 480]]);
      expect(overlay.strokes).toEqual([]);
    });

    it('clears the overlay and cancels a pending frame on unmount', () => {
      const overlay = makeSpyContext();
      const { toolArea, view } = renderArea(asOverlayRef(overlay.context));
      pressAlt();
      fireEvent.pointerMove(toolArea, { button: 0, pointerId: 1, altKey: true, clientX: 40, clientY: 50 });

      // Anti-vacuity: the frame really is pending, so the cancel below is a measurement.
      expect(frameState.pending.size).toBe(1);
      expect(rafMock).toHaveBeenCalledTimes(1);
      clearContextLog(overlay.context, overlay.strokes);

      view.unmount();

      // A frame left pending across an unmount would draw a marker over whatever tool comes next,
      // onto a context this component no longer owns.
      expect(cancelFrameMock).toHaveBeenCalledWith(1);
      expect(frameState.pending.size).toBe(0);
      expect(overlay.context.clearRect.mock.calls).toEqual([[0, 0, 640, 480]]);
    });

    it('draws nothing at all when the overlay context is null, and still clones', () => {
      const { toolArea } = renderArea(NO_OVERLAY);

      // `overlayCtxRef.current` is null at mount, so `redrawMarker` returns before touching a
      // context — and the Alt-click below still records its source, because the source write is
      // chrome-independent.
      stroke(toolArea, [20, 20], [100, 60]);
      expect(commitCalls()[0].toolArgs.points).toEqual([
        { x: 20, y: 20 },
        { x: 100, y: 60 },
      ]);

      pressAlt();
      fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, altKey: true, clientX: 40, clientY: 50 });
      fireEvent.pointerMove(toolArea, { button: 0, pointerId: 1, altKey: true, clientX: 90, clientY: 70 });
      flushFrames();

      expect(patchToolArgsMock.mock.calls).toEqual([['clone-stamp', { source: { x: 40, y: 50 } }]]);
      expect(rafMock).toHaveBeenCalledTimes(1);
      // The frame ran and drew nothing, rather than throwing or leaving the slot occupied.
      expect(frameState.pending.size).toBe(0);
    });

    it('never paints into the canvas context it was handed, only chrome into the overlay', () => {
      const canvasCtx = makeSpyContext();
      const overlay = makeSpyContext();
      // `canvasCtxRef` is accepted and never read, which is the documented contract: the Clone
      // Stamp edits the active layer's own raster through `tempUpdateLayer` / `updateLayerByTool`,
      // which republish and redraw themselves. A tool painting into either context by hand produces
      // pixels with no history entry, and `commitDirtyTool` takes its
      // `PUBLISH_RUNTIME_PRESENTATION` branch and never warns — so the stroke would be un-undoable
      // forever, silently.
      const view = render(
        <CloneStampToolArea
          className="test-clone-stamp-area"
          canvasCtxRef={asOverlayRef(canvasCtx.context)}
          overlayCtxRef={asOverlayRef(overlay.context)}
        />
      );
      const toolArea = view.container.firstElementChild as HTMLDivElement;

      stroke(toolArea, [20, 20], [100, 60]);

      // Anti-vacuity first: the gesture really happened, so the zeroes below are the component's.
      expect(commitCalls()[0].toolArgs.points).toEqual([
        { x: 20, y: 20 },
        { x: 100, y: 60 },
      ]);
      expect(paintedMethods(canvasCtx.context)).toEqual([]);
      // The own-state fields are asserted as the double's SEEDS rather than one field at a time,
      // so a single write to ANY of them — a composite mode with no paint call after it included
      // — moves this. Asserting `globalCompositeOperation` on its own could not: nothing in
      // `drawCloneSourceMarker` writes it, so the seeded value and the asserted value were the
      // same string and the line passed on the seed.
      expect({
        globalCompositeOperation: canvasCtx.context.globalCompositeOperation,
        strokeStyle: canvasCtx.context.strokeStyle,
        lineWidth: canvasCtx.context.lineWidth,
        lineCap: canvasCtx.context.lineCap,
      }).toEqual({
        globalCompositeOperation: 'source-over',
        strokeStyle: '',
        lineWidth: 0,
        lineCap: 'round',
      });
      // The overlay holds chrome only: a clear, and nothing that writes or reads pixels. It is
      // cleared once per render rather than once per mount, because `documentFrameFromSize`
      // allocates a fresh frame object whenever the store has no crop and `redrawMarker` depends
      // on it — and every clear is the FULL overlay, never a bounding box, because the overlay is
      // shared and a stale ring left behind is the failure the marker exists to prevent.
      expect(overlay.context.clearRect.mock.calls.length).toBeGreaterThan(0);
      for (const call of overlay.context.clearRect.mock.calls) expect(call).toEqual([0, 0, 640, 480]);
      expect(overlay.context.drawImage).not.toHaveBeenCalled();
      expect(overlay.context.putImageData).not.toHaveBeenCalled();
      expect(overlay.context.getImageData).not.toHaveBeenCalled();
    });
  });

  describe('the two gestures are mutually exclusive', () => {
    it('keeps a drag that began without Alt cloning after Alt is released mid-stroke', () => {
      const overlay = makeSpyContext();
      const { toolArea } = renderArea(asOverlayRef(overlay.context));
      fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, clientX: 20, clientY: 20 });

      pressAlt();
      fireEvent.pointerMove(toolArea, { button: 0, pointerId: 1, altKey: true, clientX: 60, clientY: 40 });
      fireEvent.pointerUp(toolArea, { button: 0, pointerId: 1, altKey: true, clientX: 60, clientY: 40 });

      // The switch is at pointer-DOWN only, and `handlePointerMove` delegates unconditionally, so
      // Alt arriving mid-stroke cannot cancel a gesture the Alt branch never owned.
      expect(previewCalls()[0].toolArgs.points).toEqual([
        { x: 20, y: 20 },
        { x: 60, y: 40 },
      ]);
      expect(commitCalls()[0].toolArgs.points).toEqual([
        { x: 20, y: 20 },
        { x: 60, y: 40 },
      ]);
      // The marker was still being drawn under the pointer all the while, which is the chrome half
      // of the same gesture and must not disturb the pixels.
      expect(rafMock).toHaveBeenCalledTimes(1);
    });

    it('starts no stroke at all for a press with Alt down, so the next press is a fresh gesture', () => {
      const { toolArea } = renderArea();

      fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, altKey: true, clientX: 40, clientY: 50 });
      fireEvent.pointerMove(toolArea, { button: 0, pointerId: 1, altKey: true, clientX: 90, clientY: 70 });
      fireEvent.pointerUp(toolArea, { button: 0, pointerId: 1, altKey: true, clientX: 90, clientY: 70 });

      // Every event of that drag was refused: the press never reached the hook, so there was no
      // capture and `isPointerMoveValid` had nothing to match.
      expect(tempUpdateLayerMock).not.toHaveBeenCalled();
      expect(updateLayerByToolMock).not.toHaveBeenCalled();
      expect(pointerState.activePointer).toBeNull();

      stroke(toolArea, [20, 20], [100, 60]);

      // Anti-vacuity: the surface is alive, so the zeroes above are the Alt branch's doing.
      expect(commitCalls()[0].toolArgs.points).toEqual([
        { x: 20, y: 20 },
        { x: 100, y: 60 },
      ]);
    });
  });

  describe('cancel routes', () => {
    it('abandons the stroke when the pointer leaves the surface instead of committing it', () => {
      const { toolArea } = renderArea();

      fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, clientX: 20, clientY: 20 });
      fireEvent.pointerMove(toolArea, { button: 0, pointerId: 1, clientX: 60, clientY: 40 });
      fireEvent.pointerLeave(toolArea, { button: 0, pointerId: 1, clientX: 60, clientY: 40 });

      // Dragging off the canvas is not a completed stroke, and committing it would put a half-drag
      // on the timeline. The capture went with it: `isPointerUpValid` is the only way to release the
      // pointer `usePointerPosition` took, and a leave that skipped it would refuse every later
      // press.
      expect(updateLayerByToolMock).not.toHaveBeenCalled();
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
      // The real `usePointerPosition` puts its OWN `pointercancel` listener on that node and clears
      // its tracking there. The double registers nothing, so it is registered here: the abort route
      // is only faithful if the capture is released the way the real hook releases it.
      host.addEventListener('pointercancel', () => {
        pointerState.activePointer = null;
        pointerState.isMouseDown.current = false;
      });
      const { view, toolArea } = renderArea(NO_OVERLAY, { container: host });
      expect(view.container).toBe(host);

      fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, clientX: 20, clientY: 20 });
      fireEvent.pointerMove(toolArea, { button: 0, pointerId: 1, clientX: 60, clientY: 40 });
      expect(tempUpdateLayerMock).toHaveBeenCalledTimes(1);
      fireEvent.pointerCancel(host);
      fireEvent.pointerUp(toolArea, { button: 0, pointerId: 1, clientX: 60, clientY: 40 });

      // The abort committed nothing, threw away the partial preview rather than leaving it, and
      // cannot be resurrected by the release that would have ended the gesture.
      expect(updateLayerByToolMock).not.toHaveBeenCalled();
      expect(tempUpdateLayerMock).toHaveBeenCalledTimes(1);
      expect(pointerState.activePointer).toBeNull();
    });

    it('ignores a press with a non-primary mouse button', () => {
      const { toolArea } = renderArea();

      fireEvent.pointerDown(toolArea, { button: 2, pointerId: 1, clientX: 10, clientY: 20 });
      fireEvent.pointerMove(toolArea, { button: 2, pointerId: 1, clientX: 60, clientY: 70 });
      fireEvent.pointerUp(toolArea, { button: 2, pointerId: 1, clientX: 60, clientY: 70 });

      // A right-click drag is not a clone, and claiming the capture for one would block the left
      // button until the element unmounted.
      expect(tempUpdateLayerMock).not.toHaveBeenCalled();
      expect(updateLayerByToolMock).not.toHaveBeenCalled();
      expect(pointerState.activePointer).toBeNull();
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
      expect(commitCalls()[0].toolArgs.points).toEqual([
        { x: 20, y: 20 },
        { x: 60, y: 40 },
      ]);
    });

    it('ignores pointer movement that arrives before the button goes down', () => {
      const { toolArea } = renderArea();

      fireEvent.pointerMove(toolArea, { button: 0, pointerId: 1, clientX: 30, clientY: 50 });
      fireEvent.pointerUp(toolArea, { button: 0, pointerId: 1, clientX: 30, clientY: 50 });

      // Hovering the surface is not a stroke: with no press there is no gesture to append to, and a
      // release with nothing in flight must not commit a one-point click at the cursor.
      expect(tempUpdateLayerMock).not.toHaveBeenCalled();
      expect(updateLayerByToolMock).not.toHaveBeenCalled();
      expect(pointerState.activePointer).toBeNull();
    });

    it('abandons a gesture whose active layer disappears under the pointer', () => {
      const { toolArea, view } = renderArea();

      fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, clientX: 20, clientY: 20 });
      fireEvent.pointerMove(toolArea, { button: 0, pointerId: 1, clientX: 60, clientY: 40 });
      expect(tempUpdateLayerMock).toHaveBeenCalledTimes(1);

      // The layer is deleted while the button is held. `enabled` is read at gesture boundaries only,
      // so the release below is refused wholesale rather than committing a stroke into a layer that
      // no longer exists — half-committing it would be the worse of the two.
      storeState.layers = {};
      view.rerender(areaElement(NO_OVERLAY));
      fireEvent.pointerUp(toolArea, { button: 0, pointerId: 1, clientX: 60, clientY: 40 });

      expect(updateLayerByToolMock).not.toHaveBeenCalled();
      expect(createLayerFromToolMock).not.toHaveBeenCalled();
      // The refusal happens ABOVE the validators, so the capture is still held — the same ordering
      // the bedrock case pins from the other side.
      expect(pointerState.activePointer).toBe(1);
    });
  });
});
