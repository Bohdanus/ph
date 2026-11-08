import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  absoluteViewZoom,
  DEFAULT_VIEW_STATE,
  minimumSliderZoomForCurrentView,
  minimumZoomOverrideForMagnification,
  relativeViewZoomForMagnification,
  sliderPositionToViewZoom,
  viewZoomToSliderPosition,
} from '../../../contexts/view-state.ts';
import { Hand, RotateView, Zoom } from './View.tsx';

const viewHarness = vi.hoisted(() => ({
  fitScale: 0.1,
  devicePixelRatio: 1,
  store: {
    setViewState: vi.fn(),
    viewState: { zoom: 1, fitScaleCompensation: 1, rotation: 0, panX: 0, panY: 0 } as
      | {
          zoom: number;
          fitScaleCompensation: number;
          rotation: number;
          panX: number;
          panY: number;
          minimumZoomOverride?: number;
        }
      | undefined
      | null,
    documentFrame: { width: 1, height: 1 } as { width: number; height: number } | null | undefined,
    containerRef: {
      current: {
        getBoundingClientRect: () => ({ width: 400, height: 300 }),
      },
    },
    totalSize: { width: 800, height: 600 },
  },
}));
const store = viewHarness.store;

vi.mock('../../../contexts/StoreContext.tsx', () => ({
  useStore: () => [store],
}));
vi.mock('../../../hooks/useWorkspaceFitScale.ts', () => ({
  useWorkspaceFitScale: () => viewHarness.fitScale,
}));
vi.mock('../../../hooks/useDevicePixelRatio.ts', () => ({
  useDevicePixelRatio: () => viewHarness.devicePixelRatio,
}));

describe('view toolbar', () => {
  beforeEach(() => {
    viewHarness.fitScale = 0.1;
    viewHarness.devicePixelRatio = 1;
    store.viewState = { zoom: 1, fitScaleCompensation: 1, rotation: 0, panX: 0, panY: 0 };
    store.documentFrame = { width: 1, height: 1 };
    store.setViewState.mockClear();
  });

  it('sets the displayed document scale to one image pixel per CSS pixel at 100%', () => {
    viewHarness.fitScale = 0.5;
    render(<Hand />);

    fireEvent.click(screen.getByRole('button', { name: '100%' }));

    expect(store.setViewState).toHaveBeenCalledWith({
      panX: 0,
      panY: 0,
      zoom: 2,
      fitScaleCompensation: 1,
      rotation: 0,
      minimumZoomOverride: undefined,
    });
  });

  it('keeps the zoom slider floor owned by its pointer through foreign pointer endings', () => {
    const { rerender } = render(<Zoom />);
    const slider = screen.getByRole('slider', { name: /Zoom/ });
    expect(slider).toHaveValue('0');

    fireEvent.pointerDown(slider, { pointerId: 1 });
    viewHarness.fitScale = 1;
    rerender(<Zoom />);
    expect(slider).toHaveValue('399');

    fireEvent.pointerUp(slider, { pointerId: 2 });
    fireEvent.pointerCancel(slider, { pointerId: 2 });
    rerender(<Zoom />);
    expect(slider).toHaveValue('399');

    fireEvent.pointerUp(slider, { pointerId: 1 });
    rerender(<Zoom />);
    expect(slider).toHaveValue('0');
  });

  it('keeps the pointer-owned zoom floor through blur until that pointer ends', () => {
    const { rerender } = render(<Zoom />);
    const slider = screen.getByRole('slider', { name: /Zoom/ });
    const setPointerCapture = vi.fn();
    Object.defineProperty(slider, 'setPointerCapture', { configurable: true, value: setPointerCapture });

    fireEvent.pointerDown(slider, { pointerId: 1 });
    expect(setPointerCapture).toHaveBeenCalledWith(1);
    viewHarness.fitScale = 1;
    rerender(<Zoom />);
    expect(slider).toHaveValue('399');

    fireEvent.blur(slider);
    rerender(<Zoom />);
    expect(slider).toHaveValue('399');

    fireEvent.pointerUp(slider, { pointerId: 1 });
    rerender(<Zoom />);
    expect(slider).toHaveValue('0');
  });

  it('releases the frozen zoom floor if pointer capture is lost', () => {
    const { rerender } = render(<Zoom />);
    const slider = screen.getByRole('slider', { name: /Zoom/ });

    fireEvent.pointerDown(slider, { pointerId: 1 });
    viewHarness.fitScale = 1;
    rerender(<Zoom />);
    expect(slider).toHaveValue('399');

    const lostCapture = new Event('lostpointercapture', { bubbles: true });
    Object.defineProperty(lostCapture, 'pointerId', { value: 1 });
    fireEvent(slider, lostCapture);
    rerender(<Zoom />);
    expect(slider).toHaveValue('0');
  });

  it('keeps keyboard endings from releasing a pointer-owned floor and clears it on owner cancel', () => {
    const { rerender } = render(<Zoom />);
    const slider = screen.getByRole('slider', { name: /Zoom/ });

    fireEvent.pointerDown(slider, { pointerId: 1 });
    viewHarness.fitScale = 1;
    rerender(<Zoom />);
    expect(slider).toHaveValue('399');

    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    fireEvent.keyUp(slider, { key: 'ArrowRight' });
    rerender(<Zoom />);
    expect(slider).toHaveValue('399');

    fireEvent.pointerCancel(slider, { pointerId: 1 });
    rerender(<Zoom />);
    expect(slider).toHaveValue('0');
  });

  it('steps Hand zoom in and out by the fixed factors and computes minimum zoom override', () => {
    store.documentFrame = { width: 100, height: 100 };
    viewHarness.fitScale = 1;
    store.viewState = { zoom: 1, fitScaleCompensation: 1, rotation: 0, panX: 0, panY: 0 };
    render(<Hand />);

    const state = store.viewState!;
    const magnification = absoluteViewZoom(state, viewHarness.fitScale, viewHarness.devicePixelRatio);
    const minimumZoom = minimumSliderZoomForCurrentView(store.documentFrame, magnification, state.minimumZoomOverride);

    fireEvent.click(screen.getByTestId('hand-zoom-in'));
    const zoomIn = store.setViewState.mock.calls[0][0] as Record<string, unknown>;
    const nextIn = Math.min(32, Math.max(minimumZoom, magnification * 1.25));
    expect(zoomIn.zoom).toBe(
      relativeViewZoomForMagnification(
        nextIn,
        viewHarness.fitScale,
        state.fitScaleCompensation,
        viewHarness.devicePixelRatio
      )
    );
    expect(zoomIn.minimumZoomOverride).toBe(
      minimumZoomOverrideForMagnification(store.documentFrame, nextIn, minimumZoom, state.minimumZoomOverride)
    );

    store.setViewState.mockClear();
    fireEvent.click(screen.getByTestId('hand-zoom-out'));
    const zoomOut = store.setViewState.mock.calls[0][0] as Record<string, unknown>;
    const nextOut = Math.min(32, Math.max(minimumZoom, magnification * 0.8));
    expect(zoomOut.zoom).toBe(
      relativeViewZoomForMagnification(
        nextOut,
        viewHarness.fitScale,
        state.fitScaleCompensation,
        viewHarness.devicePixelRatio
      )
    );
    expect(zoomOut.minimumZoomOverride).toBe(
      minimumZoomOverrideForMagnification(store.documentFrame, nextOut, minimumZoom, state.minimumZoomOverride)
    );
  });

  it('resets view from Hand Fit On Screen to default view state', () => {
    render(<Hand />);

    fireEvent.click(screen.getByTestId('hand-fit-on-screen'));

    expect(store.setViewState).toHaveBeenCalledWith(DEFAULT_VIEW_STATE);
  });

  it('writes Zoom slider changes through slider-to-magnification conversion and override calculation', () => {
    store.documentFrame = { width: 100, height: 100 };
    render(<Zoom />);
    const slider = screen.getByRole('slider', { name: /Zoom/ });

    const state = store.viewState!;
    const magnification = absoluteViewZoom(state, viewHarness.fitScale, viewHarness.devicePixelRatio);
    const minimumZoom = minimumSliderZoomForCurrentView(store.documentFrame, magnification, state.minimumZoomOverride);
    const position = 700;

    fireEvent.change(slider, { target: { value: String(position) } });

    const nextMagnification = sliderPositionToViewZoom(position, minimumZoom);
    expect(store.setViewState).toHaveBeenCalledWith({
      zoom: relativeViewZoomForMagnification(
        nextMagnification,
        viewHarness.fitScale,
        state.fitScaleCompensation,
        viewHarness.devicePixelRatio
      ),
      minimumZoomOverride: minimumZoomOverrideForMagnification(
        store.documentFrame,
        nextMagnification,
        minimumZoom,
        state.minimumZoomOverride
      ),
    });
  });

  it('formats Zoom label from the current absolute magnification and updates slider position from state', () => {
    viewHarness.fitScale = 0.5;
    store.viewState = { zoom: 2, fitScaleCompensation: 1, rotation: 0, panX: 0, panY: 0 };
    render(<Zoom />);

    expect(screen.getByLabelText(/Zoom 100%/)).toBeInTheDocument();
    const slider = screen.getByRole('slider', { name: /Zoom/ });
    const state = store.viewState!;
    const magnification = absoluteViewZoom(state, viewHarness.fitScale, viewHarness.devicePixelRatio);
    const minimumZoom = minimumSliderZoomForCurrentView(store.documentFrame, magnification, state.minimumZoomOverride);
    expect(slider).toHaveValue(String(viewZoomToSliderPosition(magnification, minimumZoom)));
  });

  it('falls back to DEFAULT_VIEW_STATE when viewState is undefined or null', () => {
    store.viewState = undefined;
    const { unmount } = render(<Hand />);
    expect(screen.getByTestId('hand-zoom-level')).toHaveTextContent('10%');
    unmount();

    store.viewState = null;
    render(<Zoom />);
    expect(screen.getByLabelText(/Zoom 10%/)).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: /Zoom/ })).toHaveValue('0');
  });

  it('applies devicePixelRatio when computing Hand zoom steps and 100% magnification', () => {
    viewHarness.fitScale = 0.5;
    viewHarness.devicePixelRatio = 2;
    store.viewState = { zoom: 1, fitScaleCompensation: 1, rotation: 0, panX: 0, panY: 0 };
    render(<Hand />);

    fireEvent.click(screen.getByRole('button', { name: '100%' }));
    expect(store.setViewState).toHaveBeenCalledWith({
      panX: 0,
      panY: 0,
      zoom: relativeViewZoomForMagnification(1, viewHarness.fitScale, 1, viewHarness.devicePixelRatio),
      fitScaleCompensation: 1,
      rotation: 0,
      minimumZoomOverride: undefined,
    });

    store.setViewState.mockClear();
    const state = store.viewState!;
    const magnification = absoluteViewZoom(state, viewHarness.fitScale, viewHarness.devicePixelRatio);
    const minimumZoom = minimumSliderZoomForCurrentView(store.documentFrame, magnification, state.minimumZoomOverride);
    fireEvent.click(screen.getByTestId('hand-zoom-in'));
    const next = Math.min(32, Math.max(minimumZoom, magnification * 1.25));
    expect((store.setViewState.mock.calls[0][0] as { zoom: number }).zoom).toBe(
      relativeViewZoomForMagnification(
        next,
        viewHarness.fitScale,
        state.fitScaleCompensation,
        viewHarness.devicePixelRatio
      )
    );
  });

  it('clamps Hand zoom steps to the current view minimum zoom in the UI', () => {
    store.documentFrame = { width: 1, height: 1 };
    viewHarness.fitScale = 1;
    store.viewState = { zoom: 1, fitScaleCompensation: 1, rotation: 0, panX: 0, panY: 0 };
    render(<Hand />);

    fireEvent.click(screen.getByTestId('hand-zoom-out'));

    const state = store.viewState!;
    const magnification = absoluteViewZoom(state, viewHarness.fitScale, viewHarness.devicePixelRatio);
    const minimumZoom = minimumSliderZoomForCurrentView(store.documentFrame, magnification, state.minimumZoomOverride);
    expect(magnification * 0.8).toBeLessThan(minimumZoom);
    const call = store.setViewState.mock.calls[0][0] as { zoom: number; minimumZoomOverride?: number };
    expect(call.zoom).toBe(
      relativeViewZoomForMagnification(
        minimumZoom,
        viewHarness.fitScale,
        state.fitScaleCompensation,
        viewHarness.devicePixelRatio
      )
    );
    expect(call.minimumZoomOverride).toBe(
      minimumZoomOverrideForMagnification(store.documentFrame, minimumZoom, minimumZoom, state.minimumZoomOverride)
    );
  });

  it('tolerates missing setPointerCapture during Zoom slider interaction', () => {
    const { rerender } = render(<Zoom />);
    const slider = screen.getByRole('slider', { name: /Zoom/ });
    Object.defineProperty(slider, 'setPointerCapture', { configurable: true, value: undefined });

    fireEvent.pointerDown(slider, { pointerId: 7 });
    viewHarness.fitScale = 1;
    rerender(<Zoom />);
    expect(slider).toHaveValue('399');

    fireEvent.pointerUp(slider, { pointerId: 7 });
    rerender(<Zoom />);
    expect(slider).toHaveValue('0');
  });

  it('normalizes RotateView input, wraps out-of-range angles, and treats non-finite values as zero', () => {
    render(<RotateView />);
    const input = screen.getByTestId('rotate-view-angle');

    fireEvent.change(input, { target: { value: '200' } });
    expect(store.setViewState).toHaveBeenLastCalledWith({ rotation: -160 });

    fireEvent.change(input, { target: { value: '-181' } });
    expect(store.setViewState).toHaveBeenLastCalledWith({ rotation: 179 });

    fireEvent.change(input, { target: { value: 'NaN' } });
    expect(store.setViewState).toHaveBeenLastCalledWith({ rotation: 0 });

    fireEvent.change(input, { target: { value: 'Infinity' } });
    expect(store.setViewState).toHaveBeenLastCalledWith({ rotation: 0 });
  });

  it('resets RotateView rotation to zero', () => {
    store.viewState = { zoom: 1, fitScaleCompensation: 1, rotation: 33, panX: 0, panY: 0 };
    render(<RotateView />);

    expect(screen.getByLabelText(/Rotation 33°/)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('rotate-view-reset'));

    expect(store.setViewState).toHaveBeenCalledWith({ rotation: 0 });
  });
});
