import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import SidebarLeft from '../SidebarLeft.tsx';

const goToTool = vi.fn();
const patchToolArgsMock = vi.fn();

const storeStateRef = vi.hoisted(() => ({
  toolName: 'draw',
  color: '#000000',
  backgroundColor: '#ffffff',
  hasImage: true,
  dispatch: vi.fn(),
}));

const toolArgsRef = vi.hoisted(() => ({
  toolName: 'draw' as string,
  figure: undefined as string | undefined,
}));

vi.mock('../../../contexts/StoreContext.tsx', () => ({
  useStore: () => [storeStateRef, storeStateRef.dispatch],
}));

vi.mock('../../../hooks/useApp.ts', () => ({
  useApp: () => ({ goToTool }),
}));

vi.mock('../../../contexts/useCurrentTool.tsx', () => ({
  useCurrentTool: () => ({
    toolArgs: toolArgsRef,
    patchToolArgs: patchToolArgsMock,
  }),
}));

vi.mock('../toolIcons.tsx', () => {
  const Icon = ({ title }: { title: string }) => <svg aria-hidden="true">{title}</svg>;

  return {
    toolIcons: {
      reposition: Icon,
      'red-eye': Icon,
      'spot-healing': Icon,
      'healing-brush': Icon,
      patch: Icon,
      hand: Icon,
      zoom: Icon,
      'rotate-view': Icon,
      'rectangular-selection': Icon,
      'elliptical-selection': Icon,
      'freehand-lasso': Icon,
      'polygonal-lasso': Icon,
      'feather-magnetic-lasso': Icon,
      'magic-wand': Icon,
      'quick-selection': Icon,
      eyedropper: Icon,
      eraser: Icon,
      'clone-stamp': Icon,
      'paint-bucket': Icon,
      gradient: Icon,
      sharpen: Icon,
      smudge: Icon,
      dodge: Icon,
      burn: Icon,
      crop: Icon,
      draw: Icon,
      shape: Icon,
      text: Icon,
      color: Icon,
      blur: Icon,
      levels: Icon,
      transform: Icon,
      brush: Icon,
      pencil: Icon,
      'color-replacement': Icon,
      'magic-eraser': Icon,
      pen: Icon,
      'freeform-pen': Icon,
      'curvature-pen': Icon,
      'add-anchor-point': Icon,
      'delete-anchor-point': Icon,
      'convert-point': Icon,
      rectangle: Icon,
      ellipse: Icon,
      triangle: Icon,
      polygon: Icon,
      line: Icon,
      'custom-shape': Icon,
    },
  };
});

const resetMocks = () => {
  goToTool.mockReset();
  Object.assign(toolArgsRef, { toolName: 'draw', figure: undefined });
  Object.assign(storeStateRef, {
    hasImage: true,
    toolName: 'draw',
    color: '#000000',
    backgroundColor: '#ffffff',
  });
  storeStateRef.dispatch.mockClear();
  patchToolArgsMock.mockClear();
};

const cleanupTimers = () => {
  vi.clearAllTimers();
  vi.useRealTimers();
};

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
  beforeEach(() => {
    resetMocks();
  });

  afterEach(() => {
    cleanupTimers();
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

    expect(storeStateRef.dispatch).toHaveBeenCalledWith({ type: 'SET_COLOR', payload: '#ff0000' });
  });

  it('dispatches SET_BACKGROUND_COLOR when background color input changes', () => {
    render(<SidebarLeft />);

    const input = screen.getByTestId('background-color-input');
    act(() => {
      fireEvent.change(input, { target: { value: '#00ff00' } });
    });

    expect(storeStateRef.dispatch).toHaveBeenCalledWith({
      type: 'SET_BACKGROUND_COLOR',
      payload: '#00ff00',
    });
  });

  it('swaps foreground and background colors', () => {
    render(<SidebarLeft />);

    act(() => {
      fireEvent.click(screen.getByTestId('swap-colors-button'));
    });

    expect(storeStateRef.dispatch).toHaveBeenCalledWith({ type: 'SET_COLOR', payload: '#ffffff' });
    expect(storeStateRef.dispatch).toHaveBeenCalledWith({
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
