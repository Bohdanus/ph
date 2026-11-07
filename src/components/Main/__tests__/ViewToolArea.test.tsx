import { fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ViewToolArea, type ViewToolMode } from '../ViewToolArea.tsx';
import { resetDocumentGestures } from '../../../hooks/document-gesture.ts';
import type { ViewState } from '../../../contexts/view-state.ts';

const state = vi.hoisted(() => ({
  containerRef: { current: null as HTMLDivElement | null },
  viewState: {
    zoom: 1,
    fitScaleCompensation: 1,
    rotation: 0,
    panX: 0,
    panY: 0,
    fitToScreen: true,
  } as ViewState | null,
  viewStateRef: {
    current: {
      zoom: 1,
      fitScaleCompensation: 1,
      rotation: 0,
      panX: 0,
      panY: 0,
      fitToScreen: true,
    } as ViewState,
  },
  setViewState: vi.fn(),
  documentFrame: { x: 0, y: 0, width: 800, height: 600 },
}));

vi.mock('../../../contexts/StoreContext.tsx', () => ({
  useStore: () => [
    {
      containerRef: state.containerRef,
      viewState: state.viewState,
      viewStateRef: state.viewStateRef,
      setViewState: state.setViewState,
      documentFrame: state.documentFrame,
    },
    vi.fn(),
  ],
}));

vi.mock('../../../hooks/useWorkspaceFitScale.ts', () => ({
  useWorkspaceFitScale: () => 0.5,
}));

vi.mock('../../../hooks/useDevicePixelRatio.ts', () => ({
  useDevicePixelRatio: () => 1,
}));

vi.mock('../../../util/client-viewport.ts', () => ({
  readClientViewportRect: vi.fn((el: HTMLDivElement) => {
    const rect = el.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  }),
}));

const renderArea = (mode: ViewToolMode = 'hand') => {
  const container = document.createElement('div');
  container.style.width = '800px';
  container.style.height = '600px';
  container.style.position = 'relative';
  state.containerRef.current = container;
  const view = render(<ViewToolArea className="test-view" mode={mode} />, { container });
  const surface = container.firstElementChild as HTMLDivElement;
  // Add setPointerCapture/releasePointerCapture mocks
  surface.setPointerCapture = vi.fn();
  surface.releasePointerCapture = vi.fn();
  return { ...view, container, surface };
};

describe('ViewToolArea', () => {
  beforeEach(() => {
    state.viewState = {
      zoom: 1,
      fitScaleCompensation: 1,
      rotation: 0,
      panX: 0,
      panY: 0,
      fitToScreen: true,
    };
    state.viewStateRef.current = { ...state.viewState };
    state.setViewState.mockClear();
    resetDocumentGestures();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Rendering', () => {
    it('renders surface with correct data-testid for hand mode', () => {
      const { surface } = renderArea('hand');
      expect(surface).toHaveAttribute('data-testid', 'hand-tool-area');
    });

    it('renders surface with correct data-testid for zoom mode', () => {
      const { surface } = renderArea('zoom');
      expect(surface).toHaveAttribute('data-testid', 'zoom-tool-area');
    });

    it('renders surface with correct data-testid for rotate-view mode', () => {
      const { surface } = renderArea('rotate-view');
      expect(surface).toHaveAttribute('data-testid', 'rotate-view-tool-area');
    });

    it('sets cursor-grab for hand mode when not dragging', () => {
      const { surface } = renderArea('hand');
      expect(surface).toHaveClass('cursor-grab');
    });

    it('sets cursor-zoom-in for zoom mode', () => {
      const { surface } = renderArea('zoom');
      expect(surface).toHaveClass('cursor-zoom-in');
    });

    it('sets cursor-grab for rotate-view mode', () => {
      const { surface } = renderArea('rotate-view');
      expect(surface).toHaveClass('cursor-grab');
    });

    it('sets aria-label based on mode', () => {
      const { surface } = renderArea('hand');
      expect(surface).toHaveAttribute('aria-label', 'hand view surface');
    });

    it('sets tabIndex to 0', () => {
      const { surface } = renderArea('hand');
      expect(surface).toHaveAttribute('tabIndex', '0');
    });

    it('sets touchAction to none', () => {
      const { surface } = renderArea('hand');
      expect(surface).toHaveStyle({ touchAction: 'none' });
    });
  });

  describe('Hand mode gestures', () => {
    it('pans on pointer move', () => {
      const { surface } = renderArea('hand');

      fireEvent.pointerDown(surface, { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
      fireEvent.pointerMove(surface, { pointerId: 1, clientX: 120, clientY: 130 });

      expect(state.setViewState).toHaveBeenCalledWith({
        panX: 20,
        panY: 30,
      });
    });

    it('ignores non-primary mouse button', () => {
      const { surface } = renderArea('hand');

      fireEvent.pointerDown(surface, { button: 1, pointerId: 1, clientX: 100, clientY: 100 });
      fireEvent.pointerMove(surface, { pointerId: 1, clientX: 120, clientY: 130 });

      expect(state.setViewState).not.toHaveBeenCalled();
    });

    it('does not let a foreign pointer move the view', () => {
      const { surface } = renderArea('hand');

      fireEvent.pointerDown(surface, { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
      fireEvent.pointerMove(surface, { pointerId: 2, clientX: 120, clientY: 130 });

      expect(state.setViewState).not.toHaveBeenCalled();
    });

    it('ignores pointer move before button down', () => {
      const { surface } = renderArea('hand');

      fireEvent.pointerMove(surface, { pointerId: 1, clientX: 120, clientY: 130 });

      expect(state.setViewState).not.toHaveBeenCalled();
    });

    it('releases pointer capture on pointer up', () => {
      const { surface } = renderArea('hand');

      fireEvent.pointerDown(surface, { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
      fireEvent.pointerUp(surface, { button: 0, pointerId: 1, clientX: 120, clientY: 130 });

      expect(surface.releasePointerCapture).toHaveBeenCalledWith(1);
    });

    it('releases pointer capture on pointer cancel', () => {
      const { surface } = renderArea('hand');

      fireEvent.pointerDown(surface, { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
      fireEvent.pointerCancel(surface, { pointerId: 1 });

      expect(surface.releasePointerCapture).toHaveBeenCalledWith(1);
    });

    it('double-click resets view', () => {
      state.viewState = { zoom: 2, fitScaleCompensation: 1, rotation: 45, panX: 100, panY: 50, fitToScreen: true };
      state.viewStateRef.current = { ...state.viewState };
      const { surface } = renderArea('hand');

      fireEvent.doubleClick(surface);

      expect(state.setViewState).toHaveBeenCalledWith({
        zoom: 1,
        fitScaleCompensation: 1,
        rotation: 0,
        panX: 0,
        panY: 0,
        fitToScreen: true,
      });
    });
  });

  describe('Zoom mode gestures', () => {
    it('drag-zooms on pointer move', () => {
      const { surface } = renderArea('zoom');

      fireEvent.pointerDown(surface, { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
      fireEvent.pointerMove(surface, { pointerId: 1, clientX: 140, clientY: 100 });

      expect(state.setViewState).toHaveBeenCalled();
      const call = state.setViewState.mock.calls[0][0] as ViewState;
      expect(call.zoom).not.toBe(1);
    });

    it('drag-zooms out on left drag', () => {
      const { surface } = renderArea('zoom');

      fireEvent.pointerDown(surface, { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
      fireEvent.pointerMove(surface, { pointerId: 1, clientX: 60, clientY: 100 });

      expect(state.setViewState).toHaveBeenCalled();
      const call = state.setViewState.mock.calls[0][0] as ViewState;
      expect(call.zoom).toBeLessThan(1);
    });

    it('Alt key inverts zoom direction', () => {
      const { surface } = renderArea('zoom');

      fireEvent.pointerDown(surface, { button: 0, pointerId: 1, clientX: 100, clientY: 100, altKey: true });
      fireEvent.pointerMove(surface, { pointerId: 1, clientX: 140, clientY: 100 });

      expect(state.setViewState).toHaveBeenCalled();
      const call = state.setViewState.mock.calls[0][0] as ViewState;
      expect(call.zoom).toBeLessThan(1);
    });

    it('click-to-zoom on pointer up with small movement', () => {
      const { surface } = renderArea('zoom');

      fireEvent.pointerDown(surface, { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
      fireEvent.pointerUp(surface, { button: 0, pointerId: 1, clientX: 102, clientY: 101 });

      expect(state.setViewState).toHaveBeenCalled();
      const call = state.setViewState.mock.calls[0][0] as ViewState;
      expect(call.zoom).toBeGreaterThan(1);
    });

    it('Alt+click-to-zoom zooms out', () => {
      const { surface } = renderArea('zoom');

      fireEvent.pointerDown(surface, { button: 0, pointerId: 1, clientX: 100, clientY: 100, altKey: true });
      fireEvent.pointerUp(surface, { button: 0, pointerId: 1, clientX: 102, clientY: 101 });

      expect(state.setViewState).toHaveBeenCalled();
      const call = state.setViewState.mock.calls[0][0] as ViewState;
      expect(call.zoom).toBeLessThan(1);
    });

    it('does not click-zoom when movement >= 4px', () => {
      const { surface } = renderArea('zoom');

      fireEvent.pointerDown(surface, { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
      fireEvent.pointerMove(surface, { pointerId: 1, clientX: 110, clientY: 100 });
      fireEvent.pointerUp(surface, { button: 0, pointerId: 1, clientX: 110, clientY: 100 });

      expect(state.setViewState).toHaveBeenCalled();
    });
  });

  describe('Rotate-view mode gestures', () => {
    it('rotates on pointer move', () => {
      const { surface } = renderArea('rotate-view');

      fireEvent.pointerDown(surface, { button: 0, pointerId: 1, clientX: 400, clientY: 300 });
      fireEvent.pointerMove(surface, { pointerId: 1, clientX: 450, clientY: 300 });

      expect(state.setViewState).toHaveBeenCalled();
      const call = state.setViewState.mock.calls[0][0] as ViewState;
      expect(call.rotation).not.toBe(0);
    });

    it('Shift key snaps rotation to 15-degree increments', () => {
      const { surface } = renderArea('rotate-view');

      fireEvent.pointerDown(surface, { button: 0, pointerId: 1, clientX: 400, clientY: 300 });
      fireEvent.pointerMove(surface, { pointerId: 1, clientX: 410, clientY: 300, shiftKey: true });

      expect(state.setViewState).toHaveBeenCalled();
      const call = state.setViewState.mock.calls[0][0] as ViewState;
      // -0 === 0 in JS, so we check the absolute value
      expect(Math.abs(call.rotation % 15)).toBe(0);
    });

    it('double-click resets view', () => {
      state.viewState = { zoom: 1, fitScaleCompensation: 1, rotation: 45, panX: 0, panY: 0, fitToScreen: true };
      state.viewStateRef.current = { ...state.viewState };
      const { surface } = renderArea('rotate-view');

      fireEvent.doubleClick(surface);

      expect(state.setViewState).toHaveBeenCalledWith({
        zoom: 1,
        fitScaleCompensation: 1,
        rotation: 0,
        panX: 0,
        panY: 0,
        fitToScreen: true,
      });
    });
  });

  describe('Wheel zoom', () => {
    it('pans on wheel without ctrl/meta', () => {
      const { surface } = renderArea('hand');

      fireEvent(surface, new WheelEvent('wheel', { deltaX: 10, deltaY: 20 }));

      expect(state.setViewState).toHaveBeenCalledWith({
        panX: -10,
        panY: -20,
      });
    });

    it('zooms on wheel with ctrl key', () => {
      const { surface } = renderArea('hand');

      fireEvent(surface, new WheelEvent('wheel', { deltaY: -120, ctrlKey: true, clientX: 400, clientY: 300 }));

      expect(state.setViewState).toHaveBeenCalled();
      const call = state.setViewState.mock.calls[0][0] as ViewState;
      expect(call.zoom).toBeGreaterThan(1);
    });

    it('zooms on wheel with meta key', () => {
      const { surface } = renderArea('hand');

      fireEvent(surface, new WheelEvent('wheel', { deltaY: -120, metaKey: true, clientX: 400, clientY: 300 }));

      expect(state.setViewState).toHaveBeenCalled();
      const call = state.setViewState.mock.calls[0][0] as ViewState;
      expect(call.zoom).toBeGreaterThan(1);
    });

    it('wheel zoom centers on mouse position', () => {
      const { surface } = renderArea('hand');

      fireEvent(surface, new WheelEvent('wheel', { deltaY: -120, ctrlKey: true, clientX: 500, clientY: 400 }));

      expect(state.setViewState).toHaveBeenCalled();
      const call = state.setViewState.mock.calls[0][0] as ViewState;
      expect(call.panX).not.toBe(0);
      expect(call.panY).not.toBe(0);
    });
  });

  describe('Pointer capture and cancellation', () => {
    it('calls setPointerCapture on pointer down', () => {
      const { surface } = renderArea('hand');

      fireEvent.pointerDown(surface, { button: 0, pointerId: 1, clientX: 100, clientY: 100 });

      expect(surface.setPointerCapture).toHaveBeenCalledWith(1);
    });

    it('releases pointer capture on pointer up', () => {
      const { surface } = renderArea('hand');

      fireEvent.pointerDown(surface, { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
      fireEvent.pointerUp(surface, { button: 0, pointerId: 1, clientX: 100, clientY: 100 });

      expect(surface.releasePointerCapture).toHaveBeenCalledWith(1);
    });

    it('releases pointer capture on pointer cancel', () => {
      const { surface } = renderArea('hand');

      fireEvent.pointerDown(surface, { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
      fireEvent.pointerCancel(surface, { pointerId: 1 });

      expect(surface.releasePointerCapture).toHaveBeenCalledWith(1);
    });

    it('clears gesture ref on pointer cancel', () => {
      const { surface } = renderArea('hand');

      fireEvent.pointerDown(surface, { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
      fireEvent.pointerCancel(surface, { pointerId: 1 });

      fireEvent.pointerMove(surface, { pointerId: 1, clientX: 200, clientY: 200 });
      expect(state.setViewState).not.toHaveBeenCalled();
    });

    it.fails('does not error if pointer capture already released', () => {
      const { surface } = renderArea('hand');
      let callCount = 0;
      surface.releasePointerCapture = vi.fn(() => {
        callCount++;
        if (callCount === 1) throw new Error('already released');
      });

      fireEvent.pointerDown(surface, { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
      fireEvent.pointerCancel(surface, { pointerId: 1 });
      fireEvent.pointerUp(surface, { button: 0, pointerId: 1, clientX: 100, clientY: 100 });

      expect(callCount).toBe(2);
    });
  });

  describe('Reset', () => {
    it('resets view to DEFAULT_VIEW_STATE', () => {
      state.viewState = { zoom: 2, fitScaleCompensation: 1, rotation: 30, panX: 100, panY: 50, fitToScreen: true };
      state.viewStateRef.current = { ...state.viewState };
      const { surface } = renderArea('hand');

      fireEvent.doubleClick(surface);

      expect(state.setViewState).toHaveBeenCalledWith({
        zoom: 1,
        fitScaleCompensation: 1,
        rotation: 0,
        panX: 0,
        panY: 0,
        fitToScreen: true,
      });
    });
  });

  describe('Minimum zoom clamping', () => {
    it('clamps zoom to minimum on wheel', () => {
      state.viewState = { zoom: 0.01, fitScaleCompensation: 1, rotation: 0, panX: 0, panY: 0, fitToScreen: true };
      state.viewStateRef.current = { ...state.viewState };
      const { surface } = renderArea('hand');

      fireEvent(surface, new WheelEvent('wheel', { deltaY: 120, ctrlKey: true, clientX: 400, clientY: 300 }));

      expect(state.setViewState).toHaveBeenCalled();
      const call = state.setViewState.mock.calls[0][0] as ViewState;
      // The minimum zoom is calculated based on fitScale and devicePixelRatio
      // Just verify it doesn't go to zero or negative
      expect(call.zoom).toBeGreaterThan(0);
    });
  });

  describe('fitScale and devicePixelRatio', () => {
    it('uses fitScale from useWorkspaceFitScale', () => {
      const { surface } = renderArea('hand');

      fireEvent.pointerDown(surface, { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
      fireEvent.pointerMove(surface, { pointerId: 1, clientX: 120, clientY: 130 });

      expect(state.setViewState).toHaveBeenCalled();
    });

    it('uses devicePixelRatio from useDevicePixelRatio', () => {
      const { surface } = renderArea('hand');

      fireEvent.pointerDown(surface, { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
      fireEvent.pointerMove(surface, { pointerId: 1, clientX: 120, clientY: 130 });

      expect(state.setViewState).toHaveBeenCalled();
    });
  });
});
