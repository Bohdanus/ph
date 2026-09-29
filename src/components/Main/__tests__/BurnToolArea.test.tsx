import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { BurnToolArea } from '../BurnToolArea.tsx';
import type { Layer, LayersRecord } from '../../../contexts/layer-types.ts';
import type { DodgeBurnToolArgs } from '../../../tools/dodgeBurn.ts';

const tempUpdateLayerMock = vi.hoisted(() => vi.fn());
const updateLayerByToolMock = vi.hoisted(() => vi.fn());
/**
 * `createLayerFromTool` is present in the mock on purpose even though the component must never
 * reach it. A `useLayers` mock that simply omitted it would make a regression that committed
 * through the layer-CREATING path a `TypeError` rather than an assertion, and a test that
 * cannot fail on the defect is not a pin. `EraserToolArea.test.tsx` carries it for the same
 * reason: a "new layer holding the burn" composites as its own opaque patch rather than as an
 * edit to the layer the user selected, so the tool would be selectable, draggable and wrong.
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
const toolState = vi.hoisted((): { toolArgs: DodgeBurnToolArgs | null } => ({ toolArgs: null }));

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
 * a wrong key mount a working area — and `BurnToolArea` is `DodgeToolArea` with the string
 * `'burn'` in place of `'dodge'`, so the two keys are the entire difference between them.
 */
vi.mock('../../../contexts/useCurrentTool.tsx', () => ({
  useCurrentTool: () => ({ getToolArgs: (toolName: string) => (toolName === 'burn' ? toolState.toolArgs : null) }),
}));

/**
 * A faithful stand-in for the real `usePointerPosition` capture contract: the first `pointerDown`
 * claims the pointer, and only that pointer's move/up are valid. A mock that let every event
 * through would make "a stroke gesture that the tool never sees" unobservable, which is exactly
 * the state a disabled `usePaintStroke` produces — the whole point of the bedrock case below is
 * that the hook's handlers return before the validators are ever consulted, and this double is
 * what proves it: nothing claims the pointer, because nothing is called.
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

const burnArgs = (): DodgeBurnToolArgs => ({
  toolName: 'burn',
  exposure: 30,
  range: 'highlights',
  size: 15,
  hardness: 0.25,
  points: [],
});

const renderArea = () => {
  const { container } = render(<BurnToolArea className="test-burn-area" overlayCtxRef={{ current: null }} />);

  return container.firstElementChild as HTMLDivElement;
};

/**
 * One press/move/release, all on the same pointer id.
 *
 * ## Why the coordinates here are the coordinates that reach the processor
 *
 * `usePaintStroke` resolves the document frame itself as
 * `currentFrame ?? documentFrameFromSize(totalSize)` (`src/hooks/usePaintStroke.ts:145`), and
 * this store hands it `documentFrame: null` with a 200x120 document, so the frame is
 * `{ x: 0, y: 0, width: 200, height: 120 }` (`src/contexts/document-frame.ts:5`).
 * `canvasToDocumentPoint` then ADDS that origin (`document-frame.ts:32-34`), and the layer sits
 * at `pos: { x: 0, y: 0 }`, so `documentPointsToLayerLocal` subtracts nothing
 * (`src/util/layer-space.ts:74-77`). Canvas, document and layer-local therefore coincide HERE, by
 * the arithmetic rather than by luck — which is the one configuration in which a dropped
 * conversion is invisible. The rebasing itself is pinned where the layer origin is non-zero, in
 * `GradientToolArea.test.tsx`.
 */
const stroke = (toolArea: HTMLDivElement, from: [number, number], to: [number, number]) => {
  fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, clientX: from[0], clientY: from[1] });
  fireEvent.pointerMove(toolArea, { button: 0, pointerId: 1, clientX: to[0], clientY: to[1] });
  fireEvent.pointerUp(toolArea, { button: 0, pointerId: 1, clientX: to[0], clientY: to[1] });
};

type ToolLayerCall = { id?: string; toolArgs: { points: { x: number; y: number }[] } };

describe('BurnToolArea', () => {
  beforeEach(() => {
    tempUpdateLayerMock.mockClear();
    updateLayerByToolMock.mockClear();
    createLayerFromToolMock.mockClear();
    pointerState.isMouseDown.current = false;
    pointerState.activePointer = null;
    storeState.documentFrame = null;
    storeState.layers = { base: makeLayer('base') };
    storeState.activeLayerId = 'base';
    toolState.toolArgs = burnArgs();
  });

  it('writes nothing at all for a stroke over the bedrock layer', () => {
    // Bedrock is the document's own backing image — the floor every other layer composites over,
    // and the surface whose pixels are the judge of every transparent region above it. There is
    // no layer beneath it, so there is nothing to composite a burn back onto and nothing to
    // restore from. `MoveToolArea.tsx:35` and `EraserToolArea.tsx:56-63` read the same flag for
    // the same reason, and so do `DodgeToolArea`, `SmudgeToolArea`, `CloneStampToolArea`,
    // `GradientToolArea` and `FillToolArea`.
    storeState.layers = { base: makeLayer('base', { isBedrock: true }) };
    storeState.activeLayerId = 'base';
    const toolArea = renderArea();

    stroke(toolArea, [20, 20], [100, 60]);

    // BOTH writers, and the preview is the load-bearing half. `enabled` is false, and
    // `usePaintStroke` returns from every handler before reaching a callback — so this is an
    // exact total no-op, not an approximation. Asserting only the commit would pass on a
    // regression that let the preview run: `tempUpdateLayer` is the only writer of
    // `previewLayersRef` (`src/contexts/useLayer.ts:473`), so a preview that reached it would
    // repaint the bedrock, and `commitDirtyTool` would then promote a preview no gesture ever
    // committed. The user would see a burn they cannot undo.
    expect(tempUpdateLayerMock).not.toHaveBeenCalled();
    expect(updateLayerByToolMock).not.toHaveBeenCalled();
    // Nothing was ever claimed, because the validators were never consulted: the refusal
    // happens above them, not inside the pointer double.
    expect(pointerState.activePointer).toBeNull();
  });

  it('previews every move and commits the stroke exactly once on a normal layer', () => {
    const toolArea = renderArea();

    stroke(toolArea, [20, 20], [100, 60]);

    // The split is the whole contract. `tempUpdateLayer` is the live-pixel writer the options
    // bar previews through; `updateLayerByTool` is the undo boundary, and it must be reached
    // ONCE per gesture or one stroke becomes one `TOOL_ACTION` per pointer event.
    const [preview] = tempUpdateLayerMock.mock.calls[0] as [ToolLayerCall];
    expect(preview.id).toBe('base');
    expect(preview.toolArgs.points).toEqual([
      { x: 20, y: 20 },
      { x: 100, y: 60 },
    ]);

    expect(updateLayerByToolMock).toHaveBeenCalledTimes(1);
    const [commit] = updateLayerByToolMock.mock.calls[0] as [ToolLayerCall];
    // `usePaintStroke` appends the release point to the gesture before calling `onCommit`
    // (`src/hooks/usePaintStroke.ts:226-237`), so the committed stroke is the drag plus the
    // point it ended on.
    expect(commit.id).toBe('base');
    expect(commit.toolArgs.points).toEqual([
      { x: 20, y: 20 },
      { x: 100, y: 60 },
    ]);
  });
});
