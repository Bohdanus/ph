import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render } from '@testing-library/react';
import type { Selection } from '../../../contexts/general-types.ts';
import type { FeatherMagneticLassoToolArgs } from '../../../tools/featherMagneticLasso.ts';
import { SELECTION_ACTION } from '../../../util/constants.ts';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { FeatherMagneticLassoToolArea } from '../FeatherMagneticLassoToolArea.tsx';

/**
 * The registration shape `useKeyDownShortcut` is handed. `mutatesDocument` is
 * the flag `useKeyboardEvents` gates on while a pointer gesture owns the
 * document, so it has to survive into the captured object for a test to pin it.
 */
type MockShortcut = {
  key: string;
  enabled?: boolean;
  mutatesDocument?: boolean;
  onKeyDown: () => void;
};

const h = vi.hoisted(() => ({
  activeSelectionId: null as string | null,
  dispatch: vi.fn(),
  selectionDraft: { status: 'idle' as 'idle' | 'draft' },
  shortcutHandlers: new Map<string, () => void>(),
  rawShortcuts: new Map<string, MockShortcut>(),
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
  useKeyDownShortcut: (shortcut: MockShortcut) => {
    // `rawShortcuts` keeps the registration object so a test can assert what the
    // hook was handed, and the mock runs on every render, so it tracks the live
    // gate as the draft's anchor mirror re-renders this component. The mocked
    // store never re-renders it on its own, so a test that needs one stands in
    // an interaction that does. `shortcutHandlers` stays a direct call into
    // `onKeyDown` so the handler itself can be exercised on its own.
    h.rawShortcuts.set(shortcut.key, shortcut);
    h.shortcutHandlers.set(shortcut.key, shortcut.onKeyDown);
  },
}));

vi.mock('../../../contexts/StoreContext.tsx', () => ({
  useStore: () => [
    {
      activeSelectionId: h.activeSelectionId,
      canvasRef: { current: h.canvas },
      containerRef: { current: document.createElement('div') },
      history: [],
      historyIndex: -1,
      // The Backspace/Delete registrations no longer gate on this field, but a
      // test still sets it to model what the sidebar deselect leaves in the
      // store.
      selectionDraft: h.selectionDraft,
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
    h.selectionDraft = { status: 'idle' };
    h.shortcutHandlers.clear();
    h.rawShortcuts.clear();
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

  const renderArea = (overlayCtxRef: { current: CanvasRenderingContext2D | null }) => {
    const { container, rerender, unmount } = render(
      <FeatherMagneticLassoToolArea overlayCtxRef={overlayCtxRef} className="test-feather-lasso-area" />
    );
    return {
      ctx: container.firstElementChild as HTMLDivElement,
      // Stands in for the render the mocked store cannot perform on a dispatch.
      rerenderStore: () =>
        rerender(<FeatherMagneticLassoToolArea overlayCtxRef={overlayCtxRef} className="test-feather-lasso-area" />),
      unmount,
    };
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

  describe('shortcut registration', () => {
    it('exempts all four of its own-gesture shortcuts from the document-mutation gate', () => {
      const mockCtx = createMockContext();
      renderArea({ current: mockCtx });

      // `useKeyboardEvents` refuses a `mutatesDocument` shortcut while a pointer
      // gesture owns the document, and a lasso is built click by click with its
      // anchors on the overlay: gating these four would leave no way to cancel the
      // draft, finish it, or remove a vertex placed against the wrong edge. The
      // exemption is only sound because this component claims no gesture of its
      // own — every step before `finishSelection` mutates refs and the overlay
      // and dispatches nothing — so there is no window for a shortcut to corrupt.
      expect([...h.rawShortcuts.keys()].sort()).toEqual(['Backspace', 'Delete', 'Enter', 'Escape']);
      for (const [key, shortcut] of h.rawShortcuts) {
        expect(shortcut.mutatesDocument, `${key} must claim the document-gate exemption`).toBe(false);
      }
    });

    it('keeps the exemption on Backspace and Delete while a draft is in progress', () => {
      const mockCtx = createMockContext();
      const toolArea = renderArea({ current: mockCtx }).ctx;

      fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 10 });
      fireEvent.pointerDown(toolArea, { button: 0, clientX: 80, clientY: 10 });

      // The `enabled` gate and the `mutatesDocument` flag are independent: a
      // gated-off Backspace is no shortcut at all, and a live one must still be
      // exempt.
      expect(h.rawShortcuts.get('Backspace')?.enabled).toBe(true);
      expect(h.rawShortcuts.get('Backspace')?.mutatesDocument).toBe(false);
      expect(h.rawShortcuts.get('Delete')?.mutatesDocument).toBe(false);
    });
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

    it('dispatches nothing with Backspace or Delete when no draft exists', () => {
      setStoreSelections([LASSO_SELECTION], 'sel-1');
      const mockCtx = createMockContext();
      renderArea({ current: mockCtx });

      h.dispatch.mockClear();
      h.shortcutHandlers.get('Backspace')?.();
      h.shortcutHandlers.get('Delete')?.();

      // These keys reach the whole app rather than the canvas, so with no draft
      // in progress they must leave the committed selection alone instead of
      // appending a deselect the user never asked for.
      expect(h.dispatch).not.toHaveBeenCalled();
      // Both registrations are gated on a draft as well, so the key is not even
      // consumed — no `preventDefault` and no `allowInInput`, which is what keeps
      // a Backspace inside a text field deleting the character it was aimed at.
      expect(h.rawShortcuts.get('Backspace')?.enabled).toBe(false);
      expect(h.rawShortcuts.get('Delete')?.enabled).toBe(false);
    });

    it('registers Backspace and Delete only while a draft is in progress', () => {
      const mockCtx = createMockContext();
      const toolArea = renderArea({ current: mockCtx }).ctx;

      // No draft, so no anchor to pop and the keys are not even consumed.
      expect(h.rawShortcuts.get('Backspace')?.enabled).toBe(false);
      expect(h.rawShortcuts.get('Delete')?.enabled).toBe(false);

      // One click is the draft's first anchor, which is all the gate needs: the
      // handler pops while there is anything left to pop.
      fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 10 });

      // The other half of the gate: with a draft there is an anchor to pop, so
      // the keys have to be live — see the anchor cases above.
      expect(h.rawShortcuts.get('Backspace')?.enabled).toBe(true);
      expect(h.rawShortcuts.get('Delete')?.enabled).toBe(true);
    });

    it('keeps Backspace and Delete live when the store draft is cleared mid-draft', () => {
      const mockCtx = createMockContext();
      const { ctx: toolArea, rerenderStore } = renderArea({ current: mockCtx });

      fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 10 });
      fireEvent.pointerDown(toolArea, { button: 0, clientX: 80, clientY: 10 });
      // `START_SELECTION_DRAFT` is what sets the store flag in production.
      h.selectionDraft = { status: 'draft' };

      expect(h.rawShortcuts.get('Backspace')?.enabled).toBe(true);

      // The sidebar Deselect button runs `clearSelections()`, whose update
      // carries `selectionDraft: { status: 'idle' }` without touching the draft's
      // anchors, which are still on the overlay. The mock store cannot re-render
      // on a dispatch, so `rerenderStore` stands in for the render the real store
      // performs once the deselect lands.
      h.selectionDraft = { status: 'idle' };
      rerenderStore();

      // The gate follows the draft's own anchors, so the store field cannot take
      // it away while the draft is live.
      expect(h.rawShortcuts.get('Backspace')?.enabled).toBe(true);
      expect(h.rawShortcuts.get('Delete')?.enabled).toBe(true);

      h.dispatch.mockClear();
      act(() => {
        h.shortcutHandlers.get('Backspace')?.();
      });
      act(() => {
        h.shortcutHandlers.get('Backspace')?.();
      });

      // The first press popped the last segment, the second found no segment
      // left and cancelled the draft — only reachable if the key was live.
      expect(h.dispatch).toHaveBeenCalledWith({ type: 'CANCEL_SELECTION_DRAFT' });
      // And the gate closes again with the draft, so the mirror is not stuck on.
      expect(h.rawShortcuts.get('Backspace')?.enabled).toBe(false);
    });

    it('dispatches nothing with Backspace when there is neither a draft nor a selection', () => {
      setStoreSelections([], null);
      const mockCtx = createMockContext();
      renderArea({ current: mockCtx });

      h.dispatch.mockClear();
      h.shortcutHandlers.get('Backspace')?.();

      // Nothing to remove and nothing to deselect, so the document records no
      // edit: no history entry describing a change that did not happen, and no
      // edit flagging the document dirty.
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
