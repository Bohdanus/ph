import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import type { Selection } from '../../../contexts/general-types.ts';
import type { FeatherMagneticLassoToolArgs } from '../../../tools/featherMagneticLasso.ts';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { FeatherMagneticLassoToolArea } from '../FeatherMagneticLassoToolArea.tsx';

const h = vi.hoisted(() => ({
  activeSelectionId: null as string | null,
  dispatch: vi.fn(),
  selectionDraft: { status: 'idle' as 'idle' | 'draft' },
  shortcutHandlers: new Map<string, () => void>(),
  rawShortcuts: new Map<string, { key: string; enabled?: boolean; onKeyDown: () => void }>(),
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
  useKeyDownShortcut: (shortcut: { key: string; enabled?: boolean; onKeyDown: () => void }) => {
    // `rawShortcuts` keeps the registration object so a test can assert what the
    // hook was handed. `shortcutHandlers` stays a direct call into `onKeyDown`:
    // the mocked store never re-renders this component, so a render-time
    // `enabled` here can only ever describe the initial render, and reproducing
    // the hook's gate on top of that would make the draft cases unreachable.
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
      // The Backspace/Delete registrations are gated on this field, and a test
      // that wants a live one sets it before rendering.
      selectionDraft: h.selectionDraft,
      selections: h.selections,
      totalSize: { width: 200, height: 120 },
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

  const committed = () =>
    h.dispatch.mock.calls.filter(([action]) => (action as { type: string }).type === 'COMMIT_SELECTION');

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
    expect(h.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'COMMIT_SELECTION',
        payload: expect.objectContaining({
          geometry: 'polygon',
          lifecycle: 'committed',
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
      })
    );
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

    expect(h.dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'COMMIT_SELECTION' }));
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

      expect(committed()).toHaveLength(1);
    });

    it('closes the selection when a click lands back on the first anchor', () => {
      const mockCtx = createMockContext();
      const toolArea = renderArea({ current: mockCtx }).ctx;

      fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 10 });
      fireEvent.pointerDown(toolArea, { button: 0, clientX: 60, clientY: 10 });
      fireEvent.pointerDown(toolArea, { button: 0, clientX: 60, clientY: 60 });
      fireEvent.pointerDown(toolArea, { button: 0, clientX: 12, clientY: 11 });

      expect(committed()).toHaveLength(1);
    });

    it('closes the selection on a double click', () => {
      const mockCtx = createMockContext();
      const toolArea = renderArea({ current: mockCtx }).ctx;

      fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 10 });
      fireEvent.pointerDown(toolArea, { button: 0, clientX: 60, clientY: 10 });
      fireEvent.pointerDown(toolArea, { button: 0, clientX: 60, clientY: 60 });
      fireEvent.pointerDown(toolArea, { button: 0, clientX: 90, clientY: 90 });
      fireEvent.pointerDown(toolArea, { button: 0, clientX: 90, clientY: 90 });

      expect(committed()).toHaveLength(1);
    });

    it('does nothing on Enter or Escape without an active draft', () => {
      const mockCtx = createMockContext();
      renderArea({ current: mockCtx });

      h.shortcutHandlers.get('Enter')?.();
      h.shortcutHandlers.get('Escape')?.();

      expect(h.dispatch).not.toHaveBeenCalled();
      expect(committed()).toHaveLength(0);
    });

    it('commits a selection even when no overlay context is mounted', () => {
      const toolArea = renderArea({ current: null }).ctx;

      expect(() => {
        fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 10 });
        fireEvent.pointerDown(toolArea, { button: 0, clientX: 60, clientY: 10 });
        fireEvent.pointerDown(toolArea, { button: 0, clientX: 60, clientY: 60 });
        h.shortcutHandlers.get('Enter')?.();
      }).not.toThrow();

      expect(committed()).toHaveLength(1);
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
      h.selectionDraft = { status: 'draft' };
      const mockCtx = createMockContext();
      renderArea({ current: mockCtx });

      // The other half of the gate: with a draft there is an anchor to pop, so
      // the keys have to be live — see the anchor cases above.
      expect(h.rawShortcuts.get('Backspace')?.enabled).toBe(true);
      expect(h.rawShortcuts.get('Delete')?.enabled).toBe(true);
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

      expect(committed()).toHaveLength(0);
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
