import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, afterEach, vi } from 'vitest';
import { storeState, useSidebarLeftHarness } from './harness.tsx';
import SidebarLeft from '../SidebarLeft.tsx';

let restoreRects: (() => void) | null = null;
let restoreClickSpy: (() => void) | null = null;

const domRect = (left: number, top: number, width: number, height: number) =>
  ({
    x: left,
    y: top,
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
    toJSON: () => ({}),
  }) as DOMRect;

describe('SidebarLeft color pickers', () => {
  useSidebarLeftHarness();
  afterEach(() => {
    restoreRects?.();
    restoreRects = null;
    restoreClickSpy?.();
    restoreClickSpy = null;
  });

  it('dispatches SET_COLOR when foreground color input changes', () => {
    render(<SidebarLeft />);

    const input = screen.getByTestId('foreground-color-input');
    act(() => {
      fireEvent.change(input, { target: { value: '#ff0000' } });
    });

    expect(storeState.dispatch).toHaveBeenCalledWith({ type: 'SET_COLOR', payload: '#ff0000' });
  });

  it('dispatches SET_BACKGROUND_COLOR when background color input changes', () => {
    render(<SidebarLeft />);

    const input = screen.getByTestId('background-color-input');
    act(() => {
      fireEvent.change(input, { target: { value: '#00ff00' } });
    });

    expect(storeState.dispatch).toHaveBeenCalledWith({
      type: 'SET_BACKGROUND_COLOR',
      payload: '#00ff00',
    });
  });

  it('swaps foreground and background colors', () => {
    render(<SidebarLeft />);

    act(() => {
      fireEvent.click(screen.getByTestId('swap-colors-button'));
    });

    expect(storeState.dispatch).toHaveBeenCalledWith({ type: 'SET_COLOR', payload: '#ffffff' });
    expect(storeState.dispatch).toHaveBeenCalledWith({
      type: 'SET_BACKGROUND_COLOR',
      payload: '#000000',
    });
  });

  it('clicking foreground swatch triggers the foreground color input click', () => {
    render(<SidebarLeft />);

    const swatch = screen.getByTestId('foreground-color-swatch');
    const input = screen.getByTestId('foreground-color-input') as HTMLInputElement;
    const clickSpy = vi.spyOn(input, 'click');
    restoreClickSpy = () => clickSpy.mockRestore();

    act(() => {
      fireEvent.click(swatch);
    });
    expect(clickSpy).toHaveBeenCalled();
  });

  it('clicking background swatch triggers the background color input click', () => {
    render(<SidebarLeft />);

    const swatch = screen.getByTestId('background-color-swatch');
    const input = screen.getByTestId('background-color-input') as HTMLInputElement;
    const clickSpy = vi.spyOn(input, 'click');
    restoreClickSpy = () => clickSpy.mockRestore();

    act(() => {
      fireEvent.click(swatch);
    });
    expect(clickSpy).toHaveBeenCalled();
  });

  it('positions the color input near the foreground swatch on click', () => {
    render(<SidebarLeft />);

    const swatch = screen.getByTestId('foreground-color-swatch');
    const input = screen.getByTestId('foreground-color-input') as HTMLInputElement;
    const container = swatch.parentElement!;

    const rectSpy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      if (this === swatch) return domRect(126.25, 248.5, 32, 32);
      if (this === container) return domRect(118.5, 244.25, 56, 56);
      return domRect(0, 0, 0, 0);
    });
    restoreRects = () => rectSpy.mockRestore();

    act(() => {
      fireEvent.click(swatch);
    });

    expect(input.style.left).toBe('7.75px');
    expect(input.style.top).toBe('9.25px');
  });
});
