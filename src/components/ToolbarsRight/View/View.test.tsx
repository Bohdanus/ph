import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hand, Zoom } from './View.tsx';

const viewHarness = vi.hoisted(() => ({
  fitScale: 0.1,
  store: {
    setViewState: vi.fn(),
    viewState: { zoom: 1, fitScaleCompensation: 1, rotation: 0, panX: 0, panY: 0 },
    documentFrame: { width: 1, height: 1 },
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
  useDevicePixelRatio: () => 1,
}));

describe('view toolbar', () => {
  beforeEach(() => {
    viewHarness.fitScale = 0.1;
    store.viewState = { zoom: 1, fitScaleCompensation: 1, rotation: 0, panX: 0, panY: 0 };
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
});
