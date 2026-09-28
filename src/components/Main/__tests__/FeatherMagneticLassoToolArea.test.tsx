import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import type { Selection } from '../../../contexts/general-types.ts';
import type { FeatherMagneticLassoToolArgs } from '../../../tools/featherMagneticLasso.ts';
import { SELECTION_ACTION } from '../../../util/constants.ts';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { FeatherMagneticLassoToolArea } from '../FeatherMagneticLassoToolArea.tsx';

const h = vi.hoisted(() => ({
  activeSelectionId: null as string | null,
  dispatch: vi.fn(),
  shortcutHandlers: new Map<string, () => void>(),
  selections: [] as Selection[],
  canvas: null as HTMLCanvasElement | null,
  toolArgs: {
    antiAlias: true,
    edgeContrast: 100,
    featherRadius: 8,
    frequency: 1000,
    magneticWidth: 10,
    previewFeather: true,
    smoothing: 0,
    snapStrength: 1,
    toolName: 'feather-magnetic-lasso',
  } as unknown as FeatherMagneticLassoToolArgs,
}));

vi.mock('../../../hooks/usePointerPosition.ts', () => ({
  usePointerPosition: () => ({
    getLocalCoords: (event: ReactPointerEvent<HTMLElement>) => ({ x: event.clientX, y: event.clientY }),
  }),
}));

vi.mock('../../../hooks/useKeyboardEvents.tsx', () => ({
  useKeyDownShortcut: (shortcut: { key: string; onKeyDown: () => void }) => {
    h.shortcutHandlers.set(shortcut.key, shortcut.onKeyDown);
  },
}));

vi.mock('../../../contexts/StoreContext.tsx', () => ({
  useStore: () => [
    {
      activeSelectionId: h.activeSelectionId,
      canvasRef: { current: h.canvas },
      containerRef: { current: document.createElement('div') },
      // The single-writer hook reads the legacy timeline so it can plan the
      // append. An empty timeline at cursor -1 is what a store with nothing
      // appended yet actually looks like, and `planHistoryAppend` reports the
      // out-of-range cursor as a diagnostic rather than refusing the edit.
      history: [],
      historyIndex: -1,
      selections: h.selections,
      totalSize: { width: 200, height: 120 },
      // Explicit, so the hook derives the same frame the tool area does rather
      // than relying on an absent key.
      documentFrame: null,
    },
    h.dispatch,
  ],
}));

vi.mock('../../../contexts/useCurrentTool.tsx', () => ({
  useCurrentTool: () => ({
    get toolArgs() {
      return h.toolArgs;
    },
  }),
}));

describe('FeatherMagneticLassoToolArea', () => {
  let rafCallbacks: FrameRequestCallback[] = [];
  let requestAnimationFrameSpy: ReturnType<typeof vi.spyOn> | null = null;
  let cancelAnimationFrameSpy: ReturnType<typeof vi.spyOn> | null = null;
  let getContextSpy: ReturnType<typeof vi.spyOn> | null = null;

  beforeEach(() => {
    h.activeSelectionId = null;
    h.dispatch.mockClear();
    h.shortcutHandlers.clear();
    h.selections = [];
    h.canvas = null;
    h.toolArgs = {
      antiAlias: true,
      edgeContrast: 100,
      featherRadius: 8,
      frequency: 1000,
      magneticWidth: 10,
      previewFeather: true,
      smoothing: 0,
      snapStrength: 1,
      toolName: 'feather-magnetic-lasso',
    };
    rafCallbacks = [];
  });

  afterEach(() => {
    requestAnimationFrameSpy?.mockRestore();
    cancelAnimationFrameSpy?.mockRestore();
    getContextSpy?.mockRestore();
    requestAnimationFrameSpy = null;
    cancelAnimationFrameSpy = null;
    getContextSpy = null;
    vi.unstubAllGlobals();
  });

  function installManualRaf() {
    requestAnimationFrameSpy = vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback) => {
      rafCallbacks.push(callback);
      return rafCallbacks.length;
    });
    cancelAnimationFrameSpy = vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation((id) => {
      rafCallbacks[id - 1] = () => undefined;
    });
  }

  const createMockContext = () =>
    ({
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
    }) as unknown as CanvasRenderingContext2D;

  /**
   * Same canvas surface, plus a record of every `strokeStyle`/`lineWidth`
   * assignment. The preview colour and the feather halo width are the only
   * observable difference between the magnetic/fallback and feather/no-feather
   * branches, and they are expressed as style writes.
   */
  const createRecordingContext = () => {
    const state = { strokeStyle: '', lineWidth: 1 };
    const strokeStyles: string[] = [];
    const lineWidths: number[] = [];
    const ctx = {
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
      fillStyle: '',
      get strokeStyle() {
        return state.strokeStyle;
      },
      set strokeStyle(value: string) {
        state.strokeStyle = value;
        strokeStyles.push(value);
      },
      get lineWidth() {
        return state.lineWidth;
      },
      set lineWidth(value: number) {
        state.lineWidth = value;
        lineWidths.push(value);
      },
    } as unknown as CanvasRenderingContext2D;

    return { ctx, strokeStyles, lineWidths };
  };

  /** A 100x100 image with a hard vertical edge at x = 50 so magnetic snapping has something to find. */
  const installEdgeMapCanvas = () => {
    const canvas = document.createElement('canvas');
    canvas.width = 100;
    canvas.height = 100;
    const data = new Uint8ClampedArray(100 * 100 * 4);
    for (let y = 0; y < 100; y++) {
      for (let x = 0; x < 100; x++) {
        const index = (y * 100 + x) * 4;
        const value = x < 50 ? 0 : 255;
        data[index] = value;
        data[index + 1] = value;
        data[index + 2] = value;
        data[index + 3] = 255;
      }
    }

    getContextSpy = vi.spyOn(canvas, 'getContext').mockReturnValue({
      getImageData: vi.fn(() => ({ data, width: 100, height: 100, colorSpace: 'srgb' })),
    } as unknown as CanvasRenderingContext2D);
    h.canvas = canvas;

    return canvas;
  };

  /**
   * A lasso commit is no longer a raw `COMMIT_SELECTION`: it is a document edit
   * that appends to history, so a drawn selection is undoable on its own instead
   * of surviving only as the `previousSelectionState` of whatever clears it later.
   * The contract is ONE `COMMIT_DOCUMENT_EDIT` carrying both the history item and
   * the resulting selection state, which is what the hook's
   * `committedSelectionUpdate` derived — the raw action is no longer dispatched,
   * so `updates.selections` IS the store state.
   *
   * `durableEntry` is deliberately not part of the pin, and `id` is a fresh uuid
   * per call; the reasons are the same as `CLEAR_SELECTION_EDIT` above.
   */
  type SelectionEdit = {
    type: string;
    payload: {
      historyItem: { actionName: string; id: string };
      updates: {
        activeSelectionId: string | null;
        selections: Selection[];
        selectionCleared: null;
        selectionDraft: { status: string };
      };
    };
  };

  const selectionEdits = (): SelectionEdit[] =>
    (h.dispatch.mock.calls as unknown[][])
      .map(([action]) => action as SelectionEdit)
      .filter((action) => action.type === 'COMMIT_DOCUMENT_EDIT');

  /** The single selection a `COMMIT_DOCUMENT_EDIT` published, which is the drawn lasso. */
  const committedSelection = (): Selection => selectionEdits()[0].payload.updates.selections[0];

  const LASSO_SELECTION: Selection = {
    id: 'sel-1',
    geometry: 'polygon',
    sourceTool: 'feather-magnetic-lasso',
    lifecycle: 'committed',
    isActive: true,
    pos: { x: 4, y: 8, width: 16, height: 24 },
    points: [
      { x: 4, y: 8 },
      { x: 20, y: 8 },
      { x: 20, y: 32 },
    ],
  };

  const setStoreSelections = (selections: Selection[], activeSelectionId: string | null = null) => {
    h.selections = selections;
    h.activeSelectionId = activeSelectionId;
  };

  /**
   * Backspace over an empty draft no longer dispatches a raw `CLEAR_SELECTIONS`
   * reducer action: it is a document edit that appends to history, so the
   * deselect is undoable like any other. One dispatch carries both the history
   * item and the resulting selection state, so the two cannot disagree.
   *
   * `durableEntry` is deliberately not matched. The store publishes the planned
   * entry only when its durable document still describes the timeline the plan
   * was made against, and the boundary's failure fallback omits it entirely;
   * both are correct, so the pin asserts the contract the two paths share. `id`
   * is a fresh uuid per call, hence `expect.any(String)`.
   */
  const CLEAR_SELECTION_EDIT = expect.objectContaining({
    type: 'COMMIT_DOCUMENT_EDIT',
    payload: expect.objectContaining({
      historyItem: expect.objectContaining({
        id: expect.any(String),
        actionName: SELECTION_ACTION,
        args: expect.objectContaining({
          previousSelectionState: {
            selections: [LASSO_SELECTION],
            activeSelectionId: 'sel-1',
          },
          nextSelectionState: { selections: [], activeSelectionId: null },
        }),
      }),
      // The visible half of the same transition. `selectionDraft` and
      // `selectionCleared` are asserted too: they are the other two fields the
      // raw reducer arm moved, so leaving them out would let the hook silently
      // stop resetting the draft or repainting the overlay.
      updates: expect.objectContaining({
        activeSelectionId: null,
        selectionCleared: expect.objectContaining({ status: 'cleared', version: 1 }),
        selectionDraft: { status: 'idle' },
        selections: [],
      }),
    }),
  });

  const renderArea = (overlayCtxRef: { current: CanvasRenderingContext2D | null }) => {
    const { container, unmount } = render(
      <FeatherMagneticLassoToolArea overlayCtxRef={overlayCtxRef} className="test-feather-lasso-area" />
    );
    return { ctx: container.firstElementChild as HTMLDivElement, unmount };
  };

  it('commits a feathered magnetic lasso selection with metadata on Enter', () => {
    const mockCtx = createMockContext();
    const { container } = render(
      <FeatherMagneticLassoToolArea overlayCtxRef={{ current: mockCtx }} className="test-feather-lasso-area" />
    );
    const toolArea = container.firstElementChild as HTMLDivElement;

    fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerDown(toolArea, { button: 0, clientX: 60, clientY: 10 });
    fireEvent.pointerDown(toolArea, { button: 0, clientX: 60, clientY: 60 });
    h.shortcutHandlers.get('Enter')?.();

    expect(h.dispatch).toHaveBeenCalledWith({
      type: 'START_SELECTION_DRAFT',
      payload: { sourceTool: 'feather-magnetic-lasso' },
    });
    expect(selectionEdits()).toHaveLength(1);
    expect(selectionEdits()[0]).toMatchObject({
      type: 'COMMIT_DOCUMENT_EDIT',
      payload: {
        historyItem: { actionName: SELECTION_ACTION, id: expect.any(String) },
        // The visible half of the same transition. `selectionDraft` and
        // `selectionCleared` are asserted because they are the other two fields
        // the raw `COMMIT_SELECTION` reducer arm moved, so leaving them out
        // would let the hook silently stop resetting the draft or repainting the
        // overlay.
        updates: {
          selectionCleared: null,
          selectionDraft: { status: 'idle' },
          selections: [
            expect.objectContaining({
              geometry: 'polygon',
              lifecycle: 'committed',
              isActive: true,
              metadata: expect.objectContaining({
                featherRadius: 8,
                magneticLasso: expect.objectContaining({
                  antiAlias: true,
                  contrast: 100,
                  width: 10,
                }),
              }),
              sourceTool: 'feather-magnetic-lasso',
            }),
          ],
        },
      },
    });
    // The pointer maps to exactly the appended selection, which is what activates
    // it: the two uuids cannot be pinned literally, their equality can.
    expect(selectionEdits()[0].payload.updates.activeSelectionId).toBe(
      selectionEdits()[0].payload.updates.selections[0].id
    );
  });

  it('appends exactly one history entry for a multi-click, multi-pointermove lasso gesture', () => {
    installManualRaf();
    const mockCtx = createMockContext();
    const toolArea = renderArea({ current: mockCtx }).ctx;

    // Three anchors, each with several pointer moves behind it. Every click and
    // every pointer move is one step of the SAME gesture, and none of them may
    // append: they only mutate refs and the overlay.
    for (const [x, y] of [
      [10, 10],
      [60, 10],
      [60, 60],
    ]) {
      fireEvent.pointerDown(toolArea, { button: 0, clientX: x, clientY: y });
      for (let step = 1; step <= 3; step++) {
        fireEvent.pointerMove(toolArea, { clientX: x + step, clientY: y + step });
        rafCallbacks[rafCallbacks.length - 1]?.(performance.now());
        expect(selectionEdits()).toHaveLength(0);
      }
    }

    h.shortcutHandlers.get('Enter')?.();

    expect(selectionEdits()).toHaveLength(1);
    expect(selectionEdits()[0].payload.historyItem).toMatchObject({
      actionName: SELECTION_ACTION,
      id: expect.any(String),
    });
    expect(committedSelection()).toMatchObject({
      sourceTool: 'feather-magnetic-lasso',
      isActive: true,
    });
  });

  it('removes the previous anchor with Backspace before finishing', () => {
    const mockCtx = createMockContext();
    const { container } = render(
      <FeatherMagneticLassoToolArea overlayCtxRef={{ current: mockCtx }} className="test-feather-lasso-area" />
    );
    const toolArea = container.firstElementChild as HTMLDivElement;

    fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerDown(toolArea, { button: 0, clientX: 80, clientY: 10 });
    h.shortcutHandlers.get('Backspace')?.();
    h.shortcutHandlers.get('Enter')?.();

    // Dropping an anchor leaves one click's worth of geometry, below the
    // three-point minimum, so the gesture never reaches the commit point and
    // appends nothing.
    expect(selectionEdits()).toHaveLength(0);
  });

  it('cancels the current draft with Escape', () => {
    const mockCtx = createMockContext();
    const { container } = render(
      <FeatherMagneticLassoToolArea overlayCtxRef={{ current: mockCtx }} className="test-feather-lasso-area" />
    );
    const toolArea = container.firstElementChild as HTMLDivElement;

    fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 10 });
    h.shortcutHandlers.get('Escape')?.();

    expect(h.dispatch).toHaveBeenCalledWith({ type: 'CANCEL_SELECTION_DRAFT' });
  });

  it('throttles magnetic pointer-move preview work to one requestAnimationFrame', () => {
    installManualRaf();

    const mockCtx = createMockContext();
    const { container } = render(
      <FeatherMagneticLassoToolArea overlayCtxRef={{ current: mockCtx }} className="test-feather-lasso-area" />
    );
    const toolArea = container.firstElementChild as HTMLDivElement;

    fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 10 });
    vi.mocked(mockCtx.lineTo).mockClear();

    fireEvent.pointerMove(toolArea, { clientX: 20, clientY: 10 });
    fireEvent.pointerMove(toolArea, { clientX: 30, clientY: 10 });
    fireEvent.pointerMove(toolArea, { clientX: 40, clientY: 10 });

    expect(requestAnimationFrameSpy).toHaveBeenCalledTimes(1);
    expect(mockCtx.lineTo).not.toHaveBeenCalled();

    rafCallbacks[0](performance.now());

    expect(mockCtx.lineTo).toHaveBeenCalledWith(40, 10);

    fireEvent.pointerMove(toolArea, { clientX: 50, clientY: 10 });

    expect(requestAnimationFrameSpy).toHaveBeenCalledTimes(2);
  });

  describe('pointer guards', () => {
    it('ignores non-primary mouse buttons', () => {
      const mockCtx = createMockContext();
      const toolArea = renderArea({ current: mockCtx }).ctx;

      fireEvent.pointerDown(toolArea, { button: 2, clientX: 10, clientY: 10 });

      expect(h.dispatch).not.toHaveBeenCalled();
    });

    it('ignores pointer movement before a draft has started', () => {
      installManualRaf();
      const mockCtx = createMockContext();
      const toolArea = renderArea({ current: mockCtx }).ctx;

      fireEvent.pointerMove(toolArea, { clientX: 40, clientY: 40 });

      expect(requestAnimationFrameSpy).not.toHaveBeenCalled();
    });
  });

  describe('closing the selection', () => {
    it('closes the selection on right click', () => {
      const mockCtx = createMockContext();
      const toolArea = renderArea({ current: mockCtx }).ctx;

      fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 10 });
      fireEvent.pointerDown(toolArea, { button: 0, clientX: 60, clientY: 10 });
      fireEvent.pointerDown(toolArea, { button: 0, clientX: 60, clientY: 60 });
      fireEvent.contextMenu(toolArea);

      expect(selectionEdits()).toHaveLength(1);
    });

    it('closes the selection when a click lands back on the first anchor', () => {
      const mockCtx = createMockContext();
      const toolArea = renderArea({ current: mockCtx }).ctx;

      fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 10 });
      fireEvent.pointerDown(toolArea, { button: 0, clientX: 60, clientY: 10 });
      fireEvent.pointerDown(toolArea, { button: 0, clientX: 60, clientY: 60 });
      fireEvent.pointerDown(toolArea, { button: 0, clientX: 12, clientY: 11 });

      expect(selectionEdits()).toHaveLength(1);
    });

    it('closes the selection on a double click', () => {
      const mockCtx = createMockContext();
      const toolArea = renderArea({ current: mockCtx }).ctx;

      fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 10 });
      fireEvent.pointerDown(toolArea, { button: 0, clientX: 60, clientY: 10 });
      fireEvent.pointerDown(toolArea, { button: 0, clientX: 60, clientY: 60 });
      fireEvent.pointerDown(toolArea, { button: 0, clientX: 90, clientY: 90 });
      fireEvent.pointerDown(toolArea, { button: 0, clientX: 90, clientY: 90 });

      expect(selectionEdits()).toHaveLength(1);
    });

    it('does nothing on Enter or Escape without an active draft', () => {
      const mockCtx = createMockContext();
      renderArea({ current: mockCtx });

      h.shortcutHandlers.get('Enter')?.();
      h.shortcutHandlers.get('Escape')?.();

      expect(h.dispatch).not.toHaveBeenCalled();
      expect(selectionEdits()).toHaveLength(0);
    });

    it('commits a selection even when no overlay context is mounted', () => {
      const toolArea = renderArea({ current: null }).ctx;

      expect(() => {
        fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 10 });
        fireEvent.pointerDown(toolArea, { button: 0, clientX: 60, clientY: 10 });
        fireEvent.pointerDown(toolArea, { button: 0, clientX: 60, clientY: 60 });
        h.shortcutHandlers.get('Enter')?.();
      }).not.toThrow();

      expect(selectionEdits()).toHaveLength(1);
    });
  });

  describe('anchors', () => {
    it('clamps the first anchor to the image bounds', () => {
      const mockCtx = createMockContext();
      const toolArea = renderArea({ current: mockCtx }).ctx;

      fireEvent.pointerDown(toolArea, { button: 0, clientX: 500, clientY: 500 });

      // totalSize is 200x120, so the anchor lands on the last addressable pixel.
      expect(mockCtx.arc).toHaveBeenCalledWith(199, 119, 6, 0, Math.PI * 2);
    });

    it('cancels the draft with Backspace when only the first anchor exists', () => {
      const mockCtx = createMockContext();
      const toolArea = renderArea({ current: mockCtx }).ctx;

      fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 10 });
      h.dispatch.mockClear();
      h.shortcutHandlers.get('Backspace')?.();

      expect(h.dispatch).toHaveBeenCalledWith({ type: 'CANCEL_SELECTION_DRAFT' });
    });

    it('clears existing selections with Backspace when no draft exists', () => {
      setStoreSelections([LASSO_SELECTION], 'sel-1');
      const mockCtx = createMockContext();
      renderArea({ current: mockCtx });

      h.dispatch.mockClear();
      h.shortcutHandlers.get('Backspace')?.();

      // Exactly one dispatch: the history append and the cleared selection ride
      // on the same action, so there is no window in which one has landed
      // without the other.
      expect(h.dispatch).toHaveBeenCalledTimes(1);
      expect(h.dispatch).toHaveBeenCalledWith(CLEAR_SELECTION_EDIT);
    });

    it('dispatches nothing with Backspace when there is neither a draft nor a selection', () => {
      setStoreSelections([], null);
      const mockCtx = createMockContext();
      renderArea({ current: mockCtx });

      h.dispatch.mockClear();
      h.shortcutHandlers.get('Backspace')?.();

      // The writer guards on the selection state itself, so an already-empty
      // document records nothing: no history entry describing a change that did
      // not happen, and no edit flagging the document dirty.
      expect(h.dispatch).not.toHaveBeenCalled();
    });

    it('treats Delete exactly like Backspace', () => {
      const mockCtx = createMockContext();
      const toolArea = renderArea({ current: mockCtx }).ctx;

      fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 10 });
      fireEvent.pointerDown(toolArea, { button: 0, clientX: 80, clientY: 10 });
      h.shortcutHandlers.get('Delete')?.();
      h.shortcutHandlers.get('Enter')?.();

      expect(selectionEdits()).toHaveLength(0);
    });
  });

  describe('magnetic snapping', () => {
    const startTriangle = (toolArea: HTMLElement) => {
      fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 10 });
      fireEvent.pointerDown(toolArea, { button: 0, clientX: 60, clientY: 10 });
      fireEvent.pointerDown(toolArea, { button: 0, clientX: 60, clientY: 60 });
    };

    const previewNearEdge = (toolArea: HTMLElement, altKey = false) => {
      fireEvent.pointerMove(toolArea, { clientX: 52, clientY: 50, altKey });
      rafCallbacks[rafCallbacks.length - 1](performance.now());
    };

    it('snaps the preview onto a strong edge when magnetism is enabled', () => {
      installManualRaf();
      installEdgeMapCanvas();
      const { ctx, strokeStyles } = createRecordingContext();
      const toolArea = renderArea({ current: ctx }).ctx;

      startTriangle(toolArea);
      previewNearEdge(toolArea);

      expect(strokeStyles).toContain('rgba(0,170,90,0.95)');
    });

    it('falls back to a straight preview when Alt suppresses magnetism', () => {
      installManualRaf();
      installEdgeMapCanvas();
      const { ctx, strokeStyles } = createRecordingContext();
      const toolArea = renderArea({ current: ctx }).ctx;

      startTriangle(toolArea);
      previewNearEdge(toolArea, true);

      expect(strokeStyles).toContain('rgba(230,130,0,0.95)');
      expect(strokeStyles).not.toContain('rgba(0,170,90,0.95)');
    });

    it('skips the magnetic snap entirely when no edge map is available', () => {
      installManualRaf();
      h.canvas = null;
      const { ctx, strokeStyles } = createRecordingContext();
      const toolArea = renderArea({ current: ctx }).ctx;

      startTriangle(toolArea);
      previewNearEdge(toolArea);

      expect(strokeStyles).toContain('rgba(230,130,0,0.95)');
    });
  });

  describe('overlay painting', () => {
    it('paints a feather halo as wide as twice the feather radius', () => {
      h.toolArgs.featherRadius = 5;
      const { ctx, lineWidths } = createRecordingContext();
      const toolArea = renderArea({ current: ctx }).ctx;

      fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 10 });
      fireEvent.pointerDown(toolArea, { button: 0, clientX: 60, clientY: 10 });
      fireEvent.pointerDown(toolArea, { button: 0, clientX: 60, clientY: 60 });

      expect(lineWidths).toContain(10);
    });

    it('omits the feather halo when the preview is disabled', () => {
      h.toolArgs.previewFeather = false;
      const { ctx, lineWidths } = createRecordingContext();
      const toolArea = renderArea({ current: ctx }).ctx;

      fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 10 });
      fireEvent.pointerDown(toolArea, { button: 0, clientX: 60, clientY: 10 });
      fireEvent.pointerDown(toolArea, { button: 0, clientX: 60, clientY: 60 });

      expect(lineWidths).not.toContain(16);
    });

    it('omits the feather halo when the radius is zero', () => {
      h.toolArgs.featherRadius = 0;
      const { ctx, lineWidths } = createRecordingContext();
      const toolArea = renderArea({ current: ctx }).ctx;

      fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 10 });
      fireEvent.pointerDown(toolArea, { button: 0, clientX: 60, clientY: 10 });
      fireEvent.pointerDown(toolArea, { button: 0, clientX: 60, clientY: 60 });

      // Only the 1px minimum and the 2px path width remain.
      expect(lineWidths).not.toContain(1);
      expect(lineWidths.every((width) => width === 2)).toBe(true);
    });

    it('marks the first anchor as a close target when the preview returns to it', () => {
      installManualRaf();
      const { ctx } = createRecordingContext();
      const toolArea = renderArea({ current: ctx }).ctx;

      fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 10 });
      fireEvent.pointerDown(toolArea, { button: 0, clientX: 60, clientY: 10 });
      fireEvent.pointerDown(toolArea, { button: 0, clientX: 60, clientY: 60 });
      fireEvent.pointerMove(toolArea, { clientX: 14, clientY: 12 });
      rafCallbacks[rafCallbacks.length - 1](performance.now());

      expect(ctx.arc).toHaveBeenCalledWith(10, 10, 8, 0, Math.PI * 2);
    });

    it('strokes at full opacity when the shared overlay was left at a tool alpha', () => {
      const { ctx } = createRecordingContext();
      const alphaAtStroke: number[] = [];
      vi.mocked(ctx.stroke).mockImplementation(() => {
        alphaAtStroke.push(ctx.globalAlpha);
      });
      ctx.globalAlpha = 0.2;
      const toolArea = renderArea({ current: ctx }).ctx;

      fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 10 });
      fireEvent.pointerDown(toolArea, { button: 0, clientX: 60, clientY: 10 });
      fireEvent.pointerDown(toolArea, { button: 0, clientX: 60, clientY: 60 });

      expect(alphaAtStroke.length).toBeGreaterThan(0);
      expect(alphaAtStroke.every((alpha) => alpha === 1)).toBe(true);
    });
  });

  describe('teardown', () => {
    it('cancels a queued pointer-move frame and clears the overlay on unmount', () => {
      installManualRaf();
      const mockCtx = createMockContext();
      const { ctx, unmount } = renderArea({ current: mockCtx });

      fireEvent.pointerDown(ctx, { button: 0, clientX: 10, clientY: 10 });
      fireEvent.pointerMove(ctx, { clientX: 50, clientY: 10 });

      expect(requestAnimationFrameSpy).toHaveBeenCalledTimes(1);
      vi.mocked(mockCtx.clearRect).mockClear();

      unmount();

      expect(cancelAnimationFrameSpy).toHaveBeenCalledWith(1);
      expect(mockCtx.clearRect).toHaveBeenCalledWith(0, 0, 200, 120);
    });
  });
});
