import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { Selection } from '../../../contexts/general-types.ts';
import { PolygonClickToolArea } from '../PolygonClickToolArea.tsx';

const dispatchMock = vi.hoisted(() => vi.fn());
const storeState = vi.hoisted(
  (): { selections: Selection[]; documentFrame: { x: number; y: number; width: number; height: number } | null } => ({
    selections: [],
    documentFrame: null,
  })
);
const toolState = vi.hoisted((): { toolArgs: { toolName?: string } | null } => ({
  toolArgs: { toolName: 'polygonal-lasso' },
}));
const shortcutHandlers = vi.hoisted(() => new Map<string, () => void>());

vi.mock('../../../hooks/usePointerPosition.ts', () => ({
  usePointerPosition: () => ({
    getLocalCoords: (event: ReactPointerEvent<HTMLElement>) => ({ x: event.clientX, y: event.clientY }),
  }),
}));

vi.mock('../../../hooks/useKeyboardEvents.tsx', () => ({
  useKeyDownShortcut: (shortcut: { key: string; onKeyDown: () => void }) => {
    shortcutHandlers.set(shortcut.key, shortcut.onKeyDown);
  },
}));

vi.mock('../../../contexts/StoreContext.tsx', () => ({
  useStore: () => [
    {
      containerRef: { current: document.createElement('div') },
      selections: storeState.selections,
      totalSize: { width: 800, height: 600 },
      documentFrame: storeState.documentFrame,
    },
    dispatchMock,
  ],
}));

vi.mock('../../../contexts/useCurrentTool.tsx', () => ({
  useCurrentTool: () => ({
    get toolArgs() {
      return toolState.toolArgs;
    },
  }),
}));

const createMockContext = () =>
  ({
    canvas: { width: 800, height: 600 },
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

const committedTriangle = (overrides: Partial<Selection> = {}): Selection =>
  ({
    id: 'selection-1',
    isActive: true,
    geometry: 'polygon',
    sourceTool: 'polygonal-lasso',
    lifecycle: 'committed',
    pos: { x: 9, y: 9, width: 92, height: 92 },
    points: [
      { x: 1, y: 1 },
      { x: 91, y: 1 },
      { x: 91, y: 91 },
    ],
    ...overrides,
  }) as Selection;

function renderArea(overlayCtxRef: { current: CanvasRenderingContext2D | null }) {
  const { container, unmount } = render(
    <PolygonClickToolArea overlayCtxRef={overlayCtxRef} className="test-polygon-click-area" />
  );
  return { ctx: container.firstElementChild as HTMLDivElement, unmount };
}

const committed = () =>
  dispatchMock.mock.calls.filter(([action]) => (action as { type: string }).type === 'COMMIT_SELECTION');

describe('PolygonClickToolArea', () => {
  beforeEach(() => {
    dispatchMock.mockClear();
    shortcutHandlers.clear();
    storeState.selections = [];
    storeState.documentFrame = null;
    toolState.toolArgs = { toolName: 'polygonal-lasso' };
  });

  describe('adding vertices', () => {
    it('appends one vertex per primary click and draws an anchor per vertex', () => {
      const ctx = createMockContext();
      const toolArea = renderArea({ current: ctx }).ctx;

      fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 10 });
      fireEvent.pointerDown(toolArea, { button: 0, clientX: 100, clientY: 10 });
      fireEvent.pointerDown(toolArea, { button: 0, clientX: 100, clientY: 100 });

      expect(dispatchMock).toHaveBeenCalledTimes(1);
      expect(dispatchMock).toHaveBeenCalledWith({
        type: 'START_SELECTION_DRAFT',
        payload: { sourceTool: 'polygonal-lasso' },
      });
      // Only the first click opens the draft; later clicks must not re-dispatch it.
      expect(ctx.moveTo).toHaveBeenCalledWith(10, 10);
      expect(ctx.lineTo).toHaveBeenCalledWith(100, 10);
      expect(ctx.lineTo).toHaveBeenCalledWith(100, 100);
    });

    it('ignores non-primary mouse buttons', () => {
      const ctx = createMockContext();
      const toolArea = renderArea({ current: ctx }).ctx;

      fireEvent.pointerDown(toolArea, { button: 2, clientX: 10, clientY: 10 });
      fireEvent.pointerDown(toolArea, { button: 1, clientX: 20, clientY: 20 });

      expect(dispatchMock).not.toHaveBeenCalled();
      expect(ctx.lineTo).not.toHaveBeenCalled();
    });

    it('treats a missing tool name as the polygonal tool', () => {
      toolState.toolArgs = {};
      const ctx = createMockContext();
      const toolArea = renderArea({ current: ctx }).ctx;

      fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 10 });
      fireEvent.pointerDown(toolArea, { button: 0, clientX: 100, clientY: 10 });
      fireEvent.pointerDown(toolArea, { button: 0, clientX: 100, clientY: 100 });

      expect(dispatchMock).toHaveBeenCalledWith({
        type: 'START_SELECTION_DRAFT',
        payload: { sourceTool: 'polygonal-lasso' },
      });
    });
  });

  describe('closing the polygon', () => {
    it('closes the polygon on right click', () => {
      const ctx = createMockContext();
      const toolArea = renderArea({ current: ctx }).ctx;

      fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 10 });
      fireEvent.pointerDown(toolArea, { button: 0, clientX: 100, clientY: 10 });
      fireEvent.pointerDown(toolArea, { button: 0, clientX: 100, clientY: 100 });
      fireEvent.contextMenu(toolArea);

      expect(committed()).toHaveLength(1);
      expect(committed()[0][0]).toMatchObject({
        type: 'COMMIT_SELECTION',
        payload: { sourceTool: 'polygonal-lasso', geometry: 'polygon' },
      });
    });

    it('refuses to close below the three-vertex minimum on right click', () => {
      const ctx = createMockContext();
      const toolArea = renderArea({ current: ctx }).ctx;

      fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 10 });
      fireEvent.pointerDown(toolArea, { button: 0, clientX: 100, clientY: 10 });
      fireEvent.contextMenu(toolArea);

      expect(committed()).toHaveLength(0);
      // The draft survives a rejected close so the user can keep adding vertices.
      expect(dispatchMock).not.toHaveBeenCalledWith({ type: 'CANCEL_SELECTION_DRAFT' });
    });

    it('refuses to close below the three-vertex minimum on Enter', () => {
      const ctx = createMockContext();
      const toolArea = renderArea({ current: ctx }).ctx;

      fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 10 });
      fireEvent.pointerDown(toolArea, { button: 0, clientX: 100, clientY: 10 });

      shortcutHandlers.get('Enter')?.();

      expect(committed()).toHaveLength(0);
    });

    it('maps canvas vertices into document space using a non-zero document frame', () => {
      storeState.documentFrame = { x: 4, y: 6, width: 800, height: 600 };
      const ctx = createMockContext();
      const toolArea = renderArea({ current: ctx }).ctx;

      fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 10 });
      fireEvent.pointerDown(toolArea, { button: 0, clientX: 100, clientY: 10 });
      fireEvent.pointerDown(toolArea, { button: 0, clientX: 100, clientY: 100 });
      fireEvent.contextMenu(toolArea);

      expect(committed()[0][0]).toMatchObject({
        payload: {
          pos: { x: 13, y: 15, width: 92, height: 92 },
          points: [
            { x: 1, y: 1 },
            { x: 91, y: 1 },
            { x: 91, y: 91 },
          ],
        },
      });
    });
  });

  describe('close hint near the first vertex', () => {
    it('shows a pointer cursor and the green closing marker inside the snap radius', () => {
      const ctx = createMockContext();
      const toolArea = renderArea({ current: ctx }).ctx;

      fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 10 });
      fireEvent.pointerDown(toolArea, { button: 0, clientX: 100, clientY: 10 });
      fireEvent.pointerDown(toolArea, { button: 0, clientX: 100, clientY: 100 });

      fireEvent.pointerMove(toolArea, { clientX: 15, clientY: 12 });

      expect(toolArea.style.cursor).toBe('pointer');
      expect(ctx.arc).toHaveBeenCalledWith(10, 10, 7, 0, Math.PI * 2);
    });

    it('keeps the crosshair cursor outside the snap radius', () => {
      const ctx = createMockContext();
      const toolArea = renderArea({ current: ctx }).ctx;

      fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 10 });
      fireEvent.pointerDown(toolArea, { button: 0, clientX: 100, clientY: 10 });
      fireEvent.pointerDown(toolArea, { button: 0, clientX: 100, clientY: 100 });

      fireEvent.pointerMove(toolArea, { clientX: 150, clientY: 150 });

      expect(toolArea.style.cursor).toBe('crosshair');
      expect(ctx.arc).not.toHaveBeenCalledWith(10, 10, 7, 0, Math.PI * 2);
    });

    it('never offers the closing hint below the three-vertex minimum', () => {
      const ctx = createMockContext();
      const toolArea = renderArea({ current: ctx }).ctx;

      fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 10 });
      fireEvent.pointerDown(toolArea, { button: 0, clientX: 100, clientY: 10 });

      fireEvent.pointerMove(toolArea, { clientX: 11, clientY: 11 });

      expect(toolArea.style.cursor).toBe('crosshair');
    });
  });

  describe('committed selection interaction', () => {
    it('offers a move cursor inside a committed selection but away from its anchors', () => {
      storeState.selections = [committedTriangle()];
      const ctx = createMockContext();
      const toolArea = renderArea({ current: ctx }).ctx;

      fireEvent.pointerMove(toolArea, { clientX: 80, clientY: 40 });

      expect(toolArea.style.cursor).toBe('move');
    });

    it('ignores an inactive committed selection for both hover and drag', () => {
      storeState.selections = [committedTriangle({ isActive: false })];
      const ctx = createMockContext();
      const toolArea = renderArea({ current: ctx }).ctx;

      fireEvent.pointerMove(toolArea, { clientX: 10, clientY: 10 });
      expect(toolArea.style.cursor).toBe('crosshair');

      fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 10 });

      expect(dispatchMock).toHaveBeenCalledWith({
        type: 'START_SELECTION_DRAFT',
        payload: { sourceTool: 'polygonal-lasso' },
      });
    });

    it('accumulates consecutive selection drags relative to the previous move', () => {
      storeState.selections = [committedTriangle()];
      const ctx = createMockContext();
      const toolArea = renderArea({ current: ctx }).ctx;

      fireEvent.pointerDown(toolArea, { button: 0, clientX: 80, clientY: 40 });
      fireEvent.pointerMove(toolArea, { clientX: 90, clientY: 55 });
      fireEvent.pointerMove(toolArea, { clientX: 95, clientY: 60 });

      const updates = dispatchMock.mock.calls.filter(
        ([action]) => (action as { type: string }).type === 'UPDATE_SELECTION'
      );
      expect(updates).toHaveLength(2);
      // First move: +10/+15 from the press origin. Second move: +5/+5 from the
      // previous position, so the selection has travelled +15/+20 in total.
      expect(updates[1][0]).toMatchObject({
        payload: {
          pos: { x: 24, y: 29, width: 92, height: 92 },
          points: [
            { x: 1, y: 1 },
            { x: 91, y: 1 },
            { x: 91, y: 91 },
          ],
        },
      });
    });

    it('abandons an anchor drag when the pointer leaves the surface', () => {
      storeState.selections = [committedTriangle()];
      const ctx = createMockContext();
      const toolArea = renderArea({ current: ctx }).ctx;

      fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 10 });
      fireEvent.pointerLeave(toolArea, { clientX: 10, clientY: 10 });
      fireEvent.pointerMove(toolArea, { clientX: 40, clientY: 40 });

      expect(dispatchMock).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'UPDATE_SELECTION' }));
    });

    it('abandons a selection drag when the pointer is released', () => {
      storeState.selections = [committedTriangle()];
      const ctx = createMockContext();
      const toolArea = renderArea({ current: ctx }).ctx;

      fireEvent.pointerDown(toolArea, { button: 0, clientX: 80, clientY: 40 });
      fireEvent.pointerUp(toolArea, { button: 0, clientX: 80, clientY: 40 });
      fireEvent.pointerMove(toolArea, { clientX: 95, clientY: 60 });

      expect(dispatchMock).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'UPDATE_SELECTION' }));
    });
  });

  describe('freehand mode', () => {
    beforeEach(() => {
      toolState.toolArgs = { toolName: 'freehand-lasso' };
    });

    it('ignores non-primary mouse buttons', () => {
      const ctx = createMockContext();
      const toolArea = renderArea({ current: ctx }).ctx;

      fireEvent.pointerDown(toolArea, { button: 2, clientX: 10, clientY: 10 });

      expect(dispatchMock).not.toHaveBeenCalled();
    });

    it('finishes the selection when the pointer leaves instead of being released', () => {
      const ctx = createMockContext();
      const toolArea = renderArea({ current: ctx }).ctx;

      fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 10 });
      fireEvent.pointerMove(toolArea, { clientX: 30, clientY: 20 });
      fireEvent.pointerMove(toolArea, { clientX: 40, clientY: 50 });
      fireEvent.pointerLeave(toolArea, { clientX: 40, clientY: 50 });

      expect(committed()).toHaveLength(1);
    });

    it('cancels the draft on pointer cancel', () => {
      const ctx = createMockContext();
      const toolArea = renderArea({ current: ctx }).ctx;

      fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 10 });
      fireEvent.pointerMove(toolArea, { clientX: 30, clientY: 20 });
      fireEvent.pointerCancel(toolArea, { clientX: 30, clientY: 20 });

      expect(dispatchMock).toHaveBeenCalledWith({ type: 'CANCEL_SELECTION_DRAFT' });
      expect(committed()).toHaveLength(0);
    });

    it('does not cancel anything when pointer cancel arrives without an active draft', () => {
      const ctx = createMockContext();
      const toolArea = renderArea({ current: ctx }).ctx;

      fireEvent.pointerCancel(toolArea, { clientX: 30, clientY: 20 });

      expect(dispatchMock).not.toHaveBeenCalled();
    });

    it('drops samples that sit under the minimum point distance', () => {
      const ctx = createMockContext();
      const toolArea = renderArea({ current: ctx }).ctx;

      fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 10 });
      vi.mocked(ctx.clearRect).mockClear();

      fireEvent.pointerMove(toolArea, { clientX: 10, clientY: 10 });
      expect(ctx.clearRect).not.toHaveBeenCalled();

      fireEvent.pointerMove(toolArea, { clientX: 10, clientY: 11 });
      expect(ctx.clearRect).not.toHaveBeenCalled();

      fireEvent.pointerMove(toolArea, { clientX: 10, clientY: 12 });
      expect(ctx.clearRect).toHaveBeenCalled();
    });

    it('previews the automatic closing edge as a dashed line back to the first point', () => {
      const ctx = createMockContext();
      const toolArea = renderArea({ current: ctx }).ctx;

      fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 10 });
      fireEvent.pointerMove(toolArea, { clientX: 60, clientY: 10 });
      fireEvent.pointerMove(toolArea, { clientX: 60, clientY: 60 });

      expect(ctx.setLineDash).toHaveBeenCalledWith([4, 4]);
      expect(ctx.moveTo).toHaveBeenCalledWith(60, 60);
      expect(ctx.lineTo).toHaveBeenCalledWith(10, 10);
    });

    it('draws only the start and end handles for a long freehand path', () => {
      const ctx = createMockContext();
      const toolArea = renderArea({ current: ctx }).ctx;

      fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 10 });
      fireEvent.pointerMove(toolArea, { clientX: 60, clientY: 10 });
      fireEvent.pointerMove(toolArea, { clientX: 60, clientY: 60 });
      vi.mocked(ctx.arc).mockClear();

      fireEvent.pointerMove(toolArea, { clientX: 20, clientY: 60 });

      // Two anchors only (start radius 5, end radius 3) — never one per sampled point.
      expect(ctx.arc).toHaveBeenCalledTimes(2);
    });

    it('never exposes the close hint cursor while freehand drawing is active', () => {
      const ctx = createMockContext();
      const toolArea = renderArea({ current: ctx }).ctx;

      fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 10 });
      fireEvent.pointerMove(toolArea, { clientX: 11, clientY: 10 });

      expect(toolArea.style.cursor).toBe('');
    });
  });

  describe('lifecycle', () => {
    it('clears the overlay on unmount', () => {
      const ctx = createMockContext();
      const { ctx: toolArea, unmount } = renderArea({ current: ctx });

      fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 10 });
      vi.mocked(ctx.clearRect).mockClear();

      unmount();

      expect(ctx.clearRect).toHaveBeenCalledWith(0, 0, 800, 600);
    });

    it('still tracks and dispatches the draft when no overlay context exists', () => {
      const toolArea = renderArea({ current: null }).ctx;

      expect(() => {
        fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 10 });
        fireEvent.pointerDown(toolArea, { button: 0, clientX: 100, clientY: 10 });
        fireEvent.pointerDown(toolArea, { button: 0, clientX: 100, clientY: 100 });
        fireEvent.contextMenu(toolArea);
      }).not.toThrow();

      expect(committed()).toHaveLength(1);
    });

    it('applies the class name and the crosshair cursor to the surface', () => {
      const toolArea = renderArea({ current: createMockContext() }).ctx;

      expect(toolArea).toHaveClass('test-polygon-click-area');
      expect(toolArea).toHaveClass('cursor-crosshair');
      expect(toolArea).toHaveStyle({ userSelect: 'none' });
    });
  });
});
