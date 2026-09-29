import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { GradientToolArea } from '../GradientToolArea.tsx';
import type { Layer, LayersRecord } from '../../../contexts/layer-types.ts';
import type { GradientToolArgs } from '../../../tools/gradient.ts';

const tempUpdateLayerMock = vi.hoisted(() => vi.fn());
const updateLayerByToolMock = vi.hoisted(() => vi.fn());
/**
 * `createLayerFromTool` is present in the mock on purpose even though the component must never
 * reach it. A `useLayers` mock that simply omitted it would make a regression that committed
 * through the layer-CREATING path a `TypeError` rather than an assertion, and a test that
 * cannot fail on the defect is not a pin. `EraserToolArea.test.tsx` carries it for the same
 * reason, and for a gradient it is worse than inert: a "new layer" gradient would be a separate
 * opaque rectangle the user could move away from the document, hiding the fill rather than
 * applying it.
 */
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
const toolState = vi.hoisted((): { toolArgs: GradientToolArgs | null } => ({ toolArgs: null }));

vi.mock('../../../contexts/StoreContext.tsx', () => ({
  useStore: () => [
    {
      containerRef: { current: document.createElement('div') },
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
 * `getToolArgs` is keyed by tool name, and the key is load-bearing twice over: it is how the
 * component finds its own args at all, and returning `null` for a name that is not this file's
 * is what makes a neighbouring area's args unreachable. A mock that ignored the name would let
 * a wrong key mount a working area.
 */
vi.mock('../../../contexts/useCurrentTool.tsx', () => ({
  useCurrentTool: () => ({ getToolArgs: (toolName: string) => (toolName === 'gradient' ? toolState.toolArgs : null) }),
}));

/**
 * A faithful stand-in for the real `usePointerPosition` capture contract: the first `pointerDown`
 * claims the pointer, and only that pointer's move/up are valid. A mock that let every event
 * through would make "a gesture the tool never saw" unobservable — which is the state a disabled
 * `usePaintStroke` produces, and the only thing that makes the bedrock case below an assertion
 * rather than a description of intent.
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

/** Deliberately NOT at the origin: the rebasing under test is invisible at `pos: {x:0,y:0}`. */
const LAYER_ORIGIN = { x: 20, y: 15 } as const;

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
  pos: { x: LAYER_ORIGIN.x, y: LAYER_ORIGIN.y, width: 180, height: 105 },
  operations: [],
  ...overrides,
});

const gradientArgs = (): GradientToolArgs => ({
  toolName: 'gradient',
  type: 'linear',
  from: { x: 0, y: 0 },
  to: { x: 1, y: 1 },
  colorA: '#000000',
  colorB: '#ffffff',
  alpha: 1,
});

const renderArea = () => {
  const { container } = render(<GradientToolArea className="test-gradient-area" overlayCtxRef={{ current: null }} />);

  return container.firstElementChild as HTMLDivElement;
};

type ToolLayerCall = { id?: string; toolArgs: { from: { x: number; y: number }; to: { x: number; y: number } } };

describe('GradientToolArea', () => {
  beforeEach(() => {
    tempUpdateLayerMock.mockClear();
    updateLayerByToolMock.mockClear();
    createLayerFromToolMock.mockClear();
    pointerState.isMouseDown.current = false;
    pointerState.activePointer = null;
    storeState.documentFrame = null;
    storeState.layers = { base: makeLayer('base') };
    storeState.activeLayerId = 'base';
    toolState.toolArgs = gradientArgs();
  });

  it('writes no commit call at all for a click that never moved', () => {
    // A click produces a zero-length axis. `isZeroLength` (`GradientToolArea.tsx:116-117`)
    // refuses it, and the refusal has to be BEFORE the write rather than a no-op write: a
    // `TOOL_ACTION` for a fill that changed nothing would put an entry on the timeline whose
    // undo appears to do nothing, and it would mark the document dirty for a gesture the user
    // would not recognise as an edit.
    const toolArea = renderArea();

    fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, clientX: 70, clientY: 45 });
    fireEvent.pointerUp(toolArea, { button: 0, pointerId: 1, clientX: 70, clientY: 45 });

    // Zero calls, not one call with a degenerate axis. The distinction is the whole rule.
    expect(updateLayerByToolMock).not.toHaveBeenCalled();
    expect(tempUpdateLayerMock).not.toHaveBeenCalled();
  });

  it('refuses the preview as well, for a drag whose two ends coincide', () => {
    // The drag ends where it started, which is a real gesture — the pointer moved and came
    // back — and it has to be refused at the PREVIEW end too, not only at the commit. A preview
    // of a zero-length axis would be `tempUpdateLayer` re-running the processor over the whole
    // layer, and `gradient.ts`'s own `readAxis` treats a zero-length axis as degenerate.
    const toolArea = renderArea();

    fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, clientX: 70, clientY: 45 });
    fireEvent.pointerMove(toolArea, { button: 0, pointerId: 1, clientX: 70, clientY: 45 });
    fireEvent.pointerUp(toolArea, { button: 0, pointerId: 1, clientX: 70, clientY: 45 });

    expect(tempUpdateLayerMock).not.toHaveBeenCalled();
    expect(updateLayerByToolMock).not.toHaveBeenCalled();
  });

  it('writes nothing at all for a stroke over the bedrock layer', () => {
    // Bedrock is the document's own backing image — the floor every other layer composites over,
    // and the surface whose pixels are the judge of every transparent region above it. There is
    // no layer beneath it to composite a fill back onto and nothing to restore from.
    // `MoveToolArea.tsx:35` and `EraserToolArea.tsx:56-63` read the same flag for the same
    // reason, and so do `DodgeToolArea`, `BurnToolArea`, `SmudgeToolArea` and
    // `CloneStampToolArea`.
    storeState.layers = { base: makeLayer('base', { isBedrock: true }) };
    storeState.activeLayerId = 'base';
    const toolArea = renderArea();

    fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, clientX: 60, clientY: 40 });
    fireEvent.pointerMove(toolArea, { button: 0, pointerId: 1, clientX: 140, clientY: 90 });
    fireEvent.pointerUp(toolArea, { button: 0, pointerId: 1, clientX: 140, clientY: 90 });

    // BOTH writers: asserting only the commit would pass on a regression that let the preview
    // run, and `tempUpdateLayer` is the only writer of `previewLayersRef`
    // (`src/contexts/useLayer.ts:473`), so a preview there is pixels no gesture committed.
    expect(tempUpdateLayerMock).not.toHaveBeenCalled();
    expect(updateLayerByToolMock).not.toHaveBeenCalled();
    expect(pointerState.activePointer).toBeNull();
  });

  it('commits the drag once, with from and to rebased onto the layer origin', () => {
    const toolArea = renderArea();

    fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, clientX: 60, clientY: 40 });
    fireEvent.pointerMove(toolArea, { button: 0, pointerId: 1, clientX: 100, clientY: 70 });
    fireEvent.pointerUp(toolArea, { button: 0, pointerId: 1, clientX: 140, clientY: 90 });

    // The store carries `documentFrame: null` and a 200x120 document, so `usePaintStroke`
    // resolves the frame to `{x:0,y:0}` (`document-frame.ts:5`) and `canvasToDocumentPoint`
    // adds that origin — canvas and document are the same numbers here, by the arithmetic
    // rather than by luck. The layer is the only offset in play, at `pos: {x:20, y:15}`, and
    // the processor addresses the LAYER's own raster with `size: layer.pos`
    // (`src/contexts/useLayer.ts:544`), which carries no document origin at all. So a document
    // point has to become `point - activeLayer.pos` at this callback boundary
    // (`src/util/layer-space.ts:74-77`) or the gradient lands 20px right and 15px below where
    // the user dragged it.
    expect(tempUpdateLayerMock).toHaveBeenCalledTimes(1);
    const [preview] = tempUpdateLayerMock.mock.calls[0] as [ToolLayerCall];
    expect(preview.id).toBe('base');
    // The preview's drag so far is press-to-move: 60,40 and 100,70 in document space.
    expect(preview.toolArgs.from).toEqual({ x: 40, y: 25 });
    expect(preview.toolArgs.to).toEqual({ x: 80, y: 55 });

    // Once per gesture, and only once: `onCommit` is the undo boundary, so a commit per
    // pointer event would put three `TOOL_ACTION` entries on the timeline for one drag.
    expect(updateLayerByToolMock).toHaveBeenCalledTimes(1);
    const [commit] = updateLayerByToolMock.mock.calls[0] as [ToolLayerCall];
    expect(commit.id).toBe('base');
    // First and last of the whole gesture: 60,40 and 140,90 in document space.
    expect(commit.toolArgs.from).toEqual({ x: 40, y: 25 });
    expect(commit.toolArgs.to).toEqual({ x: 120, y: 75 });
  });
});
