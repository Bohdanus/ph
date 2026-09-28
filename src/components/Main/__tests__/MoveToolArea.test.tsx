import { act, fireEvent, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UseRectProps } from '../../../hooks/useRect.ts';
import { isDocumentGestureOpen, readDocumentGesture, resetDocumentGestures } from '../../../hooks/document-gesture.ts';
import { MoveToolArea } from '../MoveToolArea.tsx';

type LayerId = 'layer-1' | 'layer-2' | 'bedrock-1';

const h = vi.hoisted(() => {
  const isMouseDownRef = { current: false };
  const pointerIdRef = { current: 1 as number | null };

  return {
    tempUpdateLayer: vi.fn(),
    updateLayerByTool: vi.fn(),
    setActiveLayer: vi.fn(),
    clearSelection: vi.fn(),
    dispatch: vi.fn(),
    antsDraw: vi.fn(),
    antsClear: vi.fn(),
    getLayerIdByPoint: vi.fn<(layers: unknown, point: { x: number; y: number }) => string | null>(() => null),
    getLocalCoords: vi.fn<(event: { clientX: number; clientY: number }) => { x: number; y: number }>(() => ({
      x: 0,
      y: 0,
    })),
    isMouseDownRef,
    pointerIdRef,
    useRectPointerDown: vi.fn(() => false),
    useRectPointerMove: vi.fn(() => false),
    useRectPointerUp: vi.fn(),
    useRectProps: { current: null as UseRectProps | null },
  };
});

const container = document.createElement('div');
const toolOverlay = document.createElement('canvas');
const rectOverlay = document.createElement('canvas');

const layers: Record<
  LayerId,
  { id: LayerId; isBedrock: boolean; pos: { x: number; y: number; width: number; height: number } }
> = {
  'layer-1': {
    id: 'layer-1',
    isBedrock: false,
    pos: { x: 10, y: 20, width: 30, height: 40 },
  },
  'layer-2': {
    id: 'layer-2',
    isBedrock: false,
    pos: { x: 100, y: 120, width: 50, height: 60 },
  },
  'bedrock-1': {
    id: 'bedrock-1',
    isBedrock: true,
    pos: { x: 0, y: 0, width: 800, height: 600 },
  },
};

const storeState = {
  containerRef: { current: container },
  toolOverlayRef: { current: toolOverlay },
  rectOverlayRef: { current: rectOverlay },
  activeLayerId: 'layer-1' as LayerId | null,
  layers,
  totalSize: { width: 800, height: 600 },
  documentFrame: null as { x: number; y: number; width: number; height: number } | null,
};

vi.mock('../../../contexts/StoreContext.tsx', () => ({
  useStore: () => [storeState, h.dispatch],
}));

vi.mock('../../../contexts/useLayer.ts', () => ({
  useLayers: () => ({
    tempUpdateLayer: h.tempUpdateLayer,
    updateLayerByTool: h.updateLayerByTool,
    setActiveLayer: h.setActiveLayer,
  }),
}));

vi.mock('../../../hooks/useAnts.ts', () => ({
  useMarchingAnts: () => ({
    draw: h.antsDraw,
    clear: h.antsClear,
  }),
}));

vi.mock('../../../contexts/layer-utils.ts', () => ({
  getLayerIdByPoint: h.getLayerIdByPoint,
}));

vi.mock('../../../hooks/useRect.ts', () => ({
  useRect: (props: UseRectProps) => {
    h.useRectProps.current = props;
    if (props.initialRect) props.onRepaint?.(props.initialRect);

    return {
      getLocalCoords: h.getLocalCoords,
      isMouseDown: h.isMouseDownRef,
      pointerIdRef: h.pointerIdRef,
      onPointerDown: h.useRectPointerDown,
      onPointerMove: h.useRectPointerMove,
      onPointerUp: h.useRectPointerUp,
      clearSelection: h.clearSelection,
    };
  },
}));

const renderArea = () => render(<MoveToolArea className="test" />);

const toolAreaOf = (containerEl: HTMLElement) => containerEl.firstElementChild as HTMLDivElement;

/** Points the mocked hit test at a layer and simulates a plain left-button press. */
function pressOn(layerId: LayerId | null, point = { x: 5, y: 5 }) {
  h.getLayerIdByPoint.mockReturnValue(layerId);
  h.getLocalCoords.mockReturnValue(point);
  const { container: el } = renderArea();
  fireEvent.pointerDown(toolAreaOf(el), { button: 0, pointerId: 1 });
  return toolAreaOf(el);
}

describe('MoveToolArea', () => {
  beforeEach(() => {
    h.tempUpdateLayer.mockReset();
    h.updateLayerByTool.mockReset();
    h.setActiveLayer.mockReset();
    h.clearSelection.mockReset();
    h.dispatch.mockReset();
    h.antsDraw.mockReset();
    h.antsClear.mockReset();
    h.useRectPointerDown.mockReset();
    h.useRectPointerDown.mockReturnValue(false);
    h.useRectPointerMove.mockReset();
    h.useRectPointerMove.mockReturnValue(false);
    h.useRectPointerUp.mockReset();
    h.getLayerIdByPoint.mockReset();
    h.getLayerIdByPoint.mockReturnValue(null);
    h.getLocalCoords.mockReset();
    h.getLocalCoords.mockReturnValue({ x: 0, y: 0 });
    h.isMouseDownRef.current = false;
    h.pointerIdRef.current = 1;
    h.useRectProps.current = null;

    storeState.activeLayerId = 'layer-1';
    storeState.documentFrame = null;
    container.className = '';
  });

  it('does not apply repaint updates while only switching active layer', () => {
    const { rerender } = renderArea();

    h.tempUpdateLayer.mockClear();

    storeState.activeLayerId = 'layer-2';
    rerender(<MoveToolArea className="test" />);

    expect(h.tempUpdateLayer).not.toHaveBeenCalled();
  });

  it('does not commit update when pointer up keeps the same rectangle', () => {
    renderArea();

    act(() => {
      h.useRectProps.current!.onChangeEnd({ x1: 10, y1: 20, x2: 40, y2: 60 });
    });

    expect(h.updateLayerByTool).not.toHaveBeenCalled();
  });

  describe('useRect wiring', () => {
    it('passes the active layer presentation rect as the initial selection', () => {
      renderArea();

      expect(h.useRectProps.current!.initialRect).toEqual({ x1: 10, y1: 20, x2: 40, y2: 60 });
    });

    it('maps the presentation rect through a non-zero document frame offset', () => {
      storeState.documentFrame = { x: 5, y: 7, width: 800, height: 600 };

      renderArea();

      expect(h.useRectProps.current!.initialRect).toEqual({ x1: 5, y1: 13, x2: 35, y2: 53 });
    });

    it('derives a zero-origin document frame from totalSize when the store has none', () => {
      storeState.documentFrame = null;

      renderArea();

      // A frame derived from totalSize is identity, so the canvas rect equals the document rect.
      expect(h.useRectProps.current!.initialRect).toEqual({ x1: 10, y1: 20, x2: 40, y2: 60 });
    });

    it('passes no initial rect when the active layer is the bedrock layer', () => {
      storeState.activeLayerId = 'bedrock-1';

      renderArea();

      expect(h.useRectProps.current!.initialRect).toBeNull();
    });

    it('passes no initial rect when no layer is active', () => {
      storeState.activeLayerId = null;

      renderArea();

      expect(h.useRectProps.current!.initialRect).toBeNull();
    });

    it('configures useRect for the move tool against the rect overlay', () => {
      renderArea();

      expect(h.useRectProps.current).toMatchObject({
        imageSize: { width: 800, height: 600 },
        containerRef: storeState.containerRef,
        overlayRef: storeState.rectOverlayRef,
        hideBlend: true,
        isMoveTool: true,
      });
      expect(h.useRectProps.current!.onChangeEnd).toEqual(expect.any(Function));
    });
  });

  describe('pointer down', () => {
    it('activates the layer under the pointer and shows the grabbing cursor', () => {
      const toolArea = pressOn('layer-2');

      expect(h.setActiveLayer).toHaveBeenCalledWith('layer-2');
      expect(toolArea).toBeInTheDocument();
      expect(storeState.containerRef.current.classList.contains('cursor-grabbing')).toBe(true);
    });

    it('adds the grabbing cursor even when the press lands on empty space', () => {
      const toolArea = pressOn(null);

      expect(h.setActiveLayer).toHaveBeenCalledWith(null);
      expect(storeState.containerRef.current.classList.contains('cursor-grabbing')).toBe(true);
      expect(toolArea).toBeInTheDocument();
    });

    it('does not re-activate a layer that is already active', () => {
      pressOn('layer-1');

      expect(h.setActiveLayer).not.toHaveBeenCalled();
    });

    it('clears the rect selection instead of dragging when the press lands on bedrock', () => {
      pressOn('bedrock-1');

      expect(h.clearSelection).toHaveBeenCalledTimes(1);
      expect(h.setActiveLayer).toHaveBeenCalledWith('bedrock-1');
      expect(storeState.containerRef.current.classList.contains('cursor-grabbing')).toBe(false);
    });

    it('does not arm a bedrock press for repainting', () => {
      pressOn('bedrock-1');

      act(() => {
        h.useRectProps.current!.onRepaint!({ x1: 40, y1: 40, x2: 90, y2: 90 });
      });

      expect(h.tempUpdateLayer).not.toHaveBeenCalled();
    });

    it('leaves layer selection untouched when a drag handle swallows the press', () => {
      h.useRectPointerDown.mockReturnValue(true);

      const toolArea = pressOn('layer-2');

      expect(h.setActiveLayer).not.toHaveBeenCalled();
      expect(h.clearSelection).not.toHaveBeenCalled();
      expect(storeState.containerRef.current.classList.contains('cursor-grabbing')).toBe(false);
      expect(toolArea).toBeInTheDocument();
    });

    it('arms the already-selected layer for repainting when a drag handle is clicked', () => {
      h.useRectPointerDown.mockReturnValue(true);
      pressOn('layer-2');

      act(() => {
        h.useRectProps.current!.onRepaint!({ x1: 105, y1: 125, x2: 135, y2: 165 });
      });

      // interactionLayerIdRef stays on the previously selected layer, not the pressed one.
      expect(h.tempUpdateLayer).toHaveBeenCalledWith({
        id: 'layer-1',
        toolArgs: { move: { x: 105, y: 125 }, toolName: 'reposition' },
      });
    });
  });

  describe('repaint preview', () => {
    it('previews a move through tempUpdateLayer while dragging', () => {
      pressOn('layer-1');

      act(() => {
        h.useRectProps.current!.onRepaint!({ x1: 15, y1: 25, x2: 45, y2: 65 });
      });

      expect(h.tempUpdateLayer).toHaveBeenCalledWith({
        id: 'layer-1',
        toolArgs: { move: { x: 15, y: 25 }, toolName: 'reposition' },
      });
    });

    it('previews a resize through tempUpdateLayer when the dragged rect changes size', () => {
      pressOn('layer-1');

      act(() => {
        h.useRectProps.current!.onRepaint!({ x1: 15, y1: 25, x2: 55, y2: 65 });
      });

      expect(h.tempUpdateLayer).toHaveBeenCalledWith({
        id: 'layer-1',
        toolArgs: { resize: { x: 15, y: 25, width: 40, height: 40 }, toolName: 'reposition' },
      });
    });

    it('never repaints a layer before any pointer interaction happened', () => {
      renderArea();

      act(() => {
        h.useRectProps.current!.onRepaint!({ x1: 15, y1: 25, x2: 45, y2: 65 });
      });

      expect(h.tempUpdateLayer).not.toHaveBeenCalled();
    });
  });

  describe('change end', () => {
    it('commits a pure move through updateLayerByTool', async () => {
      pressOn('layer-1');

      await act(async () => {
        await h.useRectProps.current!.onChangeEnd({ x1: 15, y1: 25, x2: 45, y2: 65 });
      });

      expect(h.updateLayerByTool).toHaveBeenCalledWith({
        id: 'layer-1',
        toolArgs: { move: { x: 15, y: 25 }, toolName: 'reposition' },
      });
    });

    it('commits a resize through updateLayerByTool', async () => {
      pressOn('layer-1');

      await act(async () => {
        await h.useRectProps.current!.onChangeEnd({ x1: 15, y1: 25, x2: 55, y2: 65 });
      });

      expect(h.updateLayerByTool).toHaveBeenCalledWith({
        id: 'layer-1',
        toolArgs: { resize: { x: 15, y: 25, width: 40, height: 40 }, toolName: 'reposition' },
      });
    });

    it('does not commit when the interaction ends on the rectangle it started from', async () => {
      pressOn('layer-1');

      await act(async () => {
        await h.useRectProps.current!.onChangeEnd({ x1: 10, y1: 20, x2: 40, y2: 60 });
      });

      expect(h.updateLayerByTool).not.toHaveBeenCalled();
    });
  });

  describe('pointer up', () => {
    it('removes the grabbing cursor and forwards the event to useRect', () => {
      const toolArea = pressOn('layer-1');
      expect(storeState.containerRef.current.classList.contains('cursor-grabbing')).toBe(true);

      fireEvent.pointerUp(toolArea, { button: 0, pointerId: 1 });

      expect(h.useRectPointerUp).toHaveBeenCalledTimes(1);
      expect(storeState.containerRef.current.classList.contains('cursor-grabbing')).toBe(false);
    });

    it('disarms the interaction so a later repaint cannot mutate a layer', () => {
      const toolArea = pressOn('layer-1');

      fireEvent.pointerUp(toolArea, { button: 0, pointerId: 1 });
      act(() => {
        h.useRectProps.current!.onRepaint!({ x1: 15, y1: 25, x2: 45, y2: 65 });
      });

      expect(h.tempUpdateLayer).not.toHaveBeenCalled();
    });
  });

  describe('pointer leave', () => {
    it('clears the hover outline for the pointer that owns the interaction', () => {
      const { container: el } = renderArea();
      const toolArea = toolAreaOf(el);

      fireEvent.pointerLeave(toolArea, { pointerId: 1 });

      expect(h.antsClear).toHaveBeenCalled();
    });

    it('ignores a leave event from a different pointer id', () => {
      const { container: el } = renderArea();
      const toolArea = toolAreaOf(el);

      fireEvent.pointerLeave(toolArea, { pointerId: 2 });

      expect(h.antsClear).not.toHaveBeenCalled();
    });

    it('clears the hover outline when a bedrock layer is hovered', () => {
      const { container: el } = renderArea();
      const toolArea = toolAreaOf(el);
      h.getLayerIdByPoint.mockReturnValue('bedrock-1');

      fireEvent.pointerMove(toolArea, { clientX: 4, clientY: 4 });

      expect(h.antsDraw).not.toHaveBeenCalled();
      expect(h.antsClear).toHaveBeenCalled();
    });
  });

  describe('hover', () => {
    it('draws the marching ants outline for the hovered layer', () => {
      const { container: el } = renderArea();
      const toolArea = toolAreaOf(el);
      h.getLayerIdByPoint.mockReturnValue('layer-2');

      fireEvent.pointerMove(toolArea, { clientX: 4, clientY: 4 });

      expect(h.antsDraw).toHaveBeenCalledWith({
        id: 'layer-2',
        isBedrock: false,
        pos: { x: 100, y: 120, width: 50, height: 60 },
      });
    });

    it('shifts the hovered outline by the document frame offset', () => {
      storeState.documentFrame = { x: 5, y: 7, width: 800, height: 600 };
      const { container: el } = renderArea();
      const toolArea = toolAreaOf(el);
      h.getLayerIdByPoint.mockReturnValue('layer-2');

      fireEvent.pointerMove(toolArea, { clientX: 4, clientY: 4 });

      expect(h.antsDraw).toHaveBeenCalledWith({
        id: 'layer-2',
        isBedrock: false,
        pos: { x: 95, y: 113, width: 50, height: 60 },
      });
    });

    it('clears the outline when the pointer is over no layer', () => {
      const { container: el } = renderArea();
      const toolArea = toolAreaOf(el);
      h.getLayerIdByPoint.mockReturnValue(null);

      fireEvent.pointerMove(toolArea, { clientX: 4, clientY: 4 });

      expect(h.antsDraw).not.toHaveBeenCalled();
      expect(h.antsClear).toHaveBeenCalled();
    });

    it('does not track hover while the mouse is still down', () => {
      const { container: el } = renderArea();
      const toolArea = toolAreaOf(el);
      h.isMouseDownRef.current = true;
      h.getLayerIdByPoint.mockReturnValue('layer-2');

      fireEvent.pointerMove(toolArea, { clientX: 4, clientY: 4 });

      expect(h.antsDraw).not.toHaveBeenCalled();
      expect(h.antsClear).not.toHaveBeenCalled();
    });

    it('skips layer hovering entirely while a drag handle is under the pointer', () => {
      const { container: el } = renderArea();
      const toolArea = toolAreaOf(el);
      h.useRectPointerMove.mockReturnValue(true);
      h.getLayerIdByPoint.mockReturnValue('layer-2');

      fireEvent.pointerMove(toolArea, { clientX: 4, clientY: 4 });

      expect(h.antsDraw).not.toHaveBeenCalled();
      expect(h.antsClear).not.toHaveBeenCalled();
    });
  });

  /**
   * §47: a layer move and a layer resize both write the document from
   * `onChangeEnd`, which `useRect` calls on release, so the press-to-release
   * window is exactly the one a document-mutating shortcut would corrupt. What is
   * pinned here is the claim and every route that gives it back.
   */
  describe('document gesture gate', () => {
    beforeEach(() => {
      // The slot is module-level, so a leaked claim would refuse every later
      // claim in this file and read as a dozen unrelated failures.
      resetDocumentGestures();
    });

    it('claims the document for a layer move and releases it on the release', () => {
      const toolArea = pressOn('layer-1');

      expect(isDocumentGestureOpen()).toBe(true);
      expect(readDocumentGesture()).toEqual({ kind: 'layer-transform', pointerId: 1 });

      fireEvent.pointerUp(toolArea, { button: 0, pointerId: 1 });

      // Released AFTER `useRect`'s pointer-up, which is what runs `onChangeEnd` and
      // therefore `updateLayerByTool` — releasing first would open the keyboard for
      // the one dispatch this gesture exists to make.
      expect(isDocumentGestureOpen()).toBe(false);
    });

    it('claims the document for a drag-handle resize as well', () => {
      h.useRectPointerDown.mockReturnValue(true);

      pressOn('layer-1');

      // Same gesture, different shape: the claim is on the interaction, not on
      // the tool that produced it.
      expect(readDocumentGesture()).toEqual({ kind: 'layer-transform', pointerId: 1 });
    });

    it('releases the claim on the path that commits nothing', async () => {
      const toolArea = pressOn('layer-1');

      // Released on the rectangle it started on: `onChangeEnd` returns early
      // without writing, and the release still has to happen or the keyboard
      // would stay dead after a click that changed nothing.
      await act(async () => {
        await h.useRectProps.current!.onChangeEnd({ x1: 10, y1: 20, x2: 40, y2: 60 });
      });
      expect(h.updateLayerByTool).not.toHaveBeenCalled();
      expect(isDocumentGestureOpen()).toBe(true);

      fireEvent.pointerUp(toolArea, { button: 0, pointerId: 1 });

      expect(isDocumentGestureOpen()).toBe(false);
    });

    it('releases the claim when the pointer leaves, which is the abort route', () => {
      const toolArea = pressOn('layer-1');
      expect(isDocumentGestureOpen()).toBe(true);

      // Paired with the interaction teardown this handler already does, so the
      // claim cannot outlive a gesture the component itself has abandoned.
      fireEvent.pointerLeave(toolArea, { pointerId: 1 });

      expect(isDocumentGestureOpen()).toBe(false);
    });

    it('releases the claim on unmount, so a gesture that dies mid-drag cannot leave the keyboard dead', () => {
      const { container: el, unmount } = renderArea();
      h.getLayerIdByPoint.mockReturnValue('layer-1');
      fireEvent.pointerDown(toolAreaOf(el), { button: 0, pointerId: 1 });
      expect(isDocumentGestureOpen()).toBe(true);

      unmount();

      expect(isDocumentGestureOpen()).toBe(false);
    });

    it('releases the claim on a pointer cancel, the route the leave handler cannot cover', () => {
      // `usePointerPosition` nulls its own tracking from a NATIVE pointercancel
      // listener, so `isPointerUpValid` is false from that moment on and no
      // `pointerup` ever follows. `handlePointerLeave` cannot stand in: it
      // early-returns on a pointerId mismatch, and boundary events are suppressed
      // while the capture is held. Without this route a UA-cancelled touch pan
      // left the claim live and every document-mutating shortcut stayed dead
      // until the next press.
      const toolArea = pressOn('layer-1');
      expect(isDocumentGestureOpen()).toBe(true);
      expect(storeState.containerRef.current.classList.contains('cursor-grabbing')).toBe(true);

      fireEvent.pointerCancel(toolArea, { button: 0, pointerId: 1 });

      expect(isDocumentGestureOpen()).toBe(false);
      // The drag is over, so the grab cursor this very press added cannot outlive it.
      expect(storeState.containerRef.current.classList.contains('cursor-grabbing')).toBe(false);
    });

    it('does not let a foreign pointer release the claim it never took', () => {
      const toolArea = pressOn('layer-1');
      expect(readDocumentGesture()).toEqual({ kind: 'layer-transform', pointerId: 1 });

      // A second pointer's release reaching this surface. The claim is released
      // only for a release this component's own gesture owns, so a stranger
      // cannot hand the document back while the first pointer is still dragging
      // toward a commit that truncates the redo tail.
      fireEvent.pointerUp(toolArea, { button: 0, pointerId: 99 });

      expect(isDocumentGestureOpen()).toBe(true);
    });

    it('claims nothing for a press with a non-primary button', () => {
      // `useRect.onPointerDown` returns false for a non-primary press, but a
      // false return cannot tell "refused" from "swallowed the press as a layer
      // selection", and the handler below does not return on it — a right-click
      // on a layer used to reach the claim through the else branch. A claim
      // nothing will release is a document with no shortcuts until some later
      // drag happens to release it.
      h.getLayerIdByPoint.mockReturnValue('layer-1');
      h.getLocalCoords.mockReturnValue({ x: 5, y: 5 });
      const { container: el } = renderArea();

      fireEvent.pointerDown(toolAreaOf(el), { button: 2, pointerId: 1 });

      expect(isDocumentGestureOpen()).toBe(false);
    });

    it('claims nothing for a press that started no interaction', () => {
      // A press over no layer starts no gesture, so there is nothing to hold the
      // document for. A non-primary press is refused by the same rule, one case up.
      h.getLayerIdByPoint.mockReturnValue(null);
      h.getLocalCoords.mockReturnValue({ x: 500, y: 500 });
      const { container: el } = renderArea();

      fireEvent.pointerDown(toolAreaOf(el), { button: 0, pointerId: 1 });

      expect(isDocumentGestureOpen()).toBe(false);
    });

    it('claims nothing for a press on the bedrock layer, which starts no interaction', () => {
      pressOn('bedrock-1');

      expect(isDocumentGestureOpen()).toBe(false);
    });
  });
});
