import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render } from '@testing-library/react';
import { EraserToolArea } from '../EraserToolArea.tsx';
import { buildEraseArgs, eraser } from '../../../tools/eraser.ts';
import { createMockCanvasContext } from '../../../test/setup.ts';
import { isDocumentGestureOpen, readDocumentGesture, resetDocumentGestures } from '../../../hooks/document-gesture.ts';
import type { ToolArgs } from '../../../contexts/tool-types.ts';
import type { Layer, LayersRecord } from '../../../contexts/layer-types.ts';

const updateLayerByToolMock = vi.hoisted(() => vi.fn());
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

/** The writer state a bracket has to hand back untouched. */
const CONTEXT_STATE_KEYS = [
  'strokeStyle',
  'fillStyle',
  'lineWidth',
  'lineCap',
  'lineJoin',
  'globalAlpha',
  'globalCompositeOperation',
] as const;

type TrackedOverlayCtx = CanvasRenderingContext2D & {
  /**
   * The writer state in effect at the moment a paint op ran. The eraser is only the tool that
   * previews with `destination-out`, so the state's value AFTER the paint says nothing about
   * whether the preview erased — and once the paint is bracketed it is always the caller's value
   * again. This is where the flag is read.
   */
  observedAtPaint: { composite: GlobalCompositeOperation; alpha: number };
};

/**
 * `drawLine` is NOT mocked. The Block-mode and `destination-out` assertions are only worth anything
 * if the real `drawPen` reads the real `DrawToolArgs`, which is the whole question: does the
 * preview path reach the branch the commit path reaches?
 *
 * Unlike the sibling tool areas' mocks, this one gives `save`/`restore` a real state stack. A spy
 * pair that restores nothing cannot observe a bracket at all: every assertion about "the context
 * kept its composite operator" would pass against an unbracketed writer, because the writer's last
 * write is simply still there.
 */
const makeOverlayContext = (initial: Partial<Record<(typeof CONTEXT_STATE_KEYS)[number], unknown>> = {}) => {
  const state: Record<string, unknown> = {
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 1,
    lineCap: 'round',
    lineJoin: 'round',
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    ...initial,
  };
  const stack: Record<string, unknown>[] = [];
  const lineDash = { value: [] as number[] };
  const observedAtPaint: TrackedOverlayCtx['observedAtPaint'] = { composite: 'source-over', alpha: 1 };
  const recordPaint = () => {
    observedAtPaint.composite = state.globalCompositeOperation as GlobalCompositeOperation;
    observedAtPaint.alpha = state.globalAlpha as number;
  };

  const ctx: Record<string, unknown> = {
    canvas: document.createElement('canvas'),
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    bezierCurveTo: vi.fn(),
    quadraticCurveTo: vi.fn(),
    stroke: vi.fn(recordPaint),
    fill: vi.fn(recordPaint),
    arc: vi.fn(),
    fillRect: vi.fn(recordPaint),
    strokeRect: vi.fn(),
    save: vi.fn(() => {
      stack.push({ ...state });
    }),
    restore: vi.fn(() => {
      const previous = stack.pop();
      if (previous) Object.assign(state, previous);
    }),
    setLineDash: vi.fn((dash: number[]) => {
      lineDash.value = [...dash];
    }),
    getLineDash: vi.fn(() => [...lineDash.value]),
    drawImage: vi.fn(),
    clip: vi.fn(),
    setTransform: vi.fn(),
    resetTransform: vi.fn(),
    imageSmoothingEnabled: true,
    imageSmoothingQuality: 'low',
    observedAtPaint,
  };

  for (const key of CONTEXT_STATE_KEYS) {
    Object.defineProperty(ctx, key, {
      get: () => state[key],
      set: (value: unknown) => {
        state[key] = value;
      },
      enumerable: true,
    });
  }

  return ctx as unknown as TrackedOverlayCtx;
};

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
    // Read while the path is stroked, not after: the paint is bracketed, so after it the context
    // holds whatever the caller had.
    expect(overlayCtx.observedAtPaint.composite).toBe('destination-out');
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
    expect(overlayCtx.observedAtPaint.composite).toBe('destination-out');
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
    // `buildEraseArgs` and hands the result to `setupDrawCtx` and `drawLine`, and so does
    // `EraserToolArea.flushDrawingFrame`.
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
    // Moves batch into an animation frame, so with no frame flushed only the release repaints.
    vi.mocked(overlayCtx.clearRect).mockClear();

    fireEvent.pointerUp(toolArea, { button: 0, clientX: 60, clientY: 70 });

    expect(overlayCtx.clearRect).toHaveBeenCalledWith(0, 0, 300, 200);
    expect(updateLayerByToolMock).toHaveBeenCalledTimes(1);
  });

  it('coalesces a burst of pointer moves into exactly one overlay repaint', () => {
    // `drawLine` re-strokes the WHOLE accumulated path, so a repaint per pointer event costs more
    // the longer the stroke gets. Pointer events are delivered at input rate and frames are not.
    vi.useFakeTimers();
    const overlayCtx = makeOverlayContext();
    const toolArea = renderArea(overlayCtx);

    fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 20 });
    // Synchronous, as everywhere else: a click with no travel gets no other chance to paint.
    expect(overlayCtx.stroke).toHaveBeenCalledTimes(1);

    act(() => {
      for (let step = 1; step <= 8; step += 1) {
        fireEvent.pointerMove(toolArea, { button: 0, clientX: 10 + step * 10, clientY: 20 + step * 5 });
      }
    });

    expect(overlayCtx.stroke).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(20);
    });

    expect(overlayCtx.stroke).toHaveBeenCalledTimes(2);
    // And that one repaint carried the whole accumulated path, not just the last point.
    expect(overlayCtx.bezierCurveTo).toHaveBeenCalled();
  });

  it('flushes the pending preview on pointer up instead of dropping it', () => {
    vi.useFakeTimers();
    const overlayCtx = makeOverlayContext();
    const toolArea = renderArea(overlayCtx);

    fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 20 });
    fireEvent.pointerMove(toolArea, { button: 0, clientX: 60, clientY: 40 });
    vi.mocked(overlayCtx.stroke).mockClear();

    fireEvent.pointerUp(toolArea, { button: 0, clientX: 60, clientY: 40 });

    // The frame that would have painted the tail is the one the release cancels, so it is painted
    // synchronously first. Without this the visible stroke stops one point short of the commit.
    expect(overlayCtx.stroke).toHaveBeenCalledTimes(1);
  });

  it('releases the frame slot on release, so a second stroke previews again', () => {
    vi.useFakeTimers();
    const overlayCtx = makeOverlayContext();
    const toolArea = renderArea(overlayCtx);

    stroke(toolArea, [10, 20], [30, 50]);
    vi.mocked(overlayCtx.stroke).mockClear();

    fireEvent.pointerDown(toolArea, { button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(toolArea, { button: 0, clientX: 140, clientY: 130 });
    act(() => {
      vi.advanceTimersByTime(20);
    });

    expect(overlayCtx.moveTo).toHaveBeenLastCalledWith(100, 100);
  });

  it('hands the shared overlay context back exactly as it found it', () => {
    // The overlay is ONE 2D context for the whole session and every tool area is handed the same
    // object, so an unbracketed eraser leaves `destination-out` behind: the crop dim, the selection
    // outline and the next tool's `fillRect`/`fillText`/`stroke` would then ERASE the overlay
    // instead of drawing on it, which is worse than a leaked alpha. The bracket is the fix; a
    // `ctx.globalAlpha = 1` at the top of `setupDrawCtx` is not, because the committed raster runs
    // the same function on a fresh canvas at the slider's alpha.
    const overlayCtx = makeOverlayContext({ globalAlpha: 0.25 });
    const toolArea = renderArea(overlayCtx);

    stroke(toolArea, [20, 20], [90, 60], [150, 120]);

    expect(overlayCtx.globalCompositeOperation).toBe('source-over');
    expect(overlayCtx.globalAlpha).toBe(0.25);
    // The paint itself still happened in the eraser's state.
    expect(overlayCtx.observedAtPaint.composite).toBe('destination-out');
    expect(overlayCtx.observedAtPaint.alpha).toBe(1);
    // Every save is matched by a restore, so no save level outlives the gesture.
    expect(vi.mocked(overlayCtx.save).mock.calls.length).toBeGreaterThan(0);
    expect(overlayCtx.restore).toHaveBeenCalledTimes(vi.mocked(overlayCtx.save).mock.calls.length);
  });

  it('does not grow the save stack across a long stroke', () => {
    vi.useFakeTimers();
    const overlayCtx = makeOverlayContext();
    const toolArea = renderArea(overlayCtx);

    fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 20 });
    for (let step = 1; step <= 20; step += 1) {
      act(() => {
        fireEvent.pointerMove(toolArea, { button: 0, clientX: 10 + step, clientY: 20 + step });
        vi.advanceTimersByTime(20);
      });
    }

    expect(overlayCtx.restore).toHaveBeenCalledTimes(vi.mocked(overlayCtx.save).mock.calls.length);
    expect(overlayCtx.globalCompositeOperation).toBe('source-over');
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

  it('cancels the pending preview frame on unmount', () => {
    vi.useFakeTimers();
    const overlayCtx = makeOverlayContext();
    const { container, unmount } = render(
      <EraserToolArea className="test-eraser-area" overlayCtxRef={{ current: overlayCtx }} />
    );
    const toolArea = container.firstElementChild as HTMLDivElement;

    fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 20 });
    fireEvent.pointerMove(toolArea, { button: 0, clientX: 60, clientY: 40 });
    vi.mocked(overlayCtx.stroke).mockClear();

    unmount();
    act(() => {
      vi.advanceTimersByTime(50);
    });

    // The frame queued by the last move would otherwise repaint the session's ONE
    // shared overlay context after this tool area was gone. `ShapeToolArea` and
    // `useRect` share the gap; this is defence in depth, not a regression fix.
    expect(overlayCtx.stroke).not.toHaveBeenCalled();
  });

  it('renders a div carrying the supplied className and the draw cursor', () => {
    const { container } = render(
      <EraserToolArea className="test-eraser-area" overlayCtxRef={{ current: makeOverlayContext() }} />
    );

    expect(container.firstElementChild).toHaveClass('test-eraser-area', 'cursor-draw');
  });
});

/**
 * §47: `updateLayerByTool` on pointer-up is a `COMMIT_DOCUMENT_EDIT` — a
 * release-time append, exactly the window the document gate exists to close. The
 * eraser was claiming nothing at all, so pressing `mod+z` mid-drag was let
 * through, the undo replaced `selections` from the SAME history array (so
 * `history.length` never moved), and the release's commit then truncated the redo
 * tail with no other symptom. Mirrors `DrawToolArea`'s gate: claim after
 * `isPointerDownValid` accepts, release as the first statement inside the
 * `isPointerUpValid` branch, plus a cancel route and an unmount route.
 */
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
    const overlayCtx = makeOverlayContext();
    const view = render(<EraserToolArea className="test-eraser-area" overlayCtxRef={{ current: overlayCtx }} />);
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

describe('eraser committed raster', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('brackets the committed stroke, so the writer state cannot outlive the paint', () => {
    // Same contract as `draw()` and `shape()`: `setupDrawCtx` writes the composite operator and
    // the alpha and deliberately leaves them, so the caller owns the bracket. Pencil mode issues no
    // `save()` of its own, so this count is the eraser's bracket and nothing else.
    const ctx = createMockCanvasContext();
    class RecordingOffscreenCanvas {
      width: number;
      height: number;

      constructor(width: number, height: number) {
        this.width = width;
        this.height = height;
      }

      getContext() {
        return ctx;
      }
    }
    vi.stubGlobal('OffscreenCanvas', RecordingOffscreenCanvas as unknown as typeof OffscreenCanvas);

    const args = {
      toolName: 'eraser',
      mode: 'pencil',
      alpha: 1,
      color: '#000000',
      lineWidth: 10,
      points: [
        { x: 2, y: 3 },
        { x: 9, y: 11 },
      ],
    } as unknown as ToolArgs;
    eraser({ size: { width: 40, height: 24 } })(args);

    expect(ctx.save).toHaveBeenCalledTimes(1);
    expect(ctx.restore).toHaveBeenCalledTimes(1);
    expect(vi.mocked(ctx.save).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(ctx.restore).mock.invocationCallOrder[0]
    );
    // The paint still ran at the tool's own alpha: the bracket bounds the state, it does not
    // neutralise the stroke.
    expect(ctx.globalAlpha).toBe(1);
  });
});
