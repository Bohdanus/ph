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

const LONG_PRESS_DELAY = 300;

const longPress = (button: HTMLElement) => {
  fireEvent.pointerDown(button, { button: 0 });
  act(() => {
    vi.advanceTimersByTime(LONG_PRESS_DELAY);
  });
  fireEvent.pointerUp(button, { button: 0 });
  fireEvent.click(button);
};

const toolbarButtonByName = (name: string) => screen.getByTestId(`tool-button-${name}`);

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

describe('SidebarLeft keyboard activation', () => {
  beforeEach(() => {
    resetMocks();
  });

  afterEach(() => {
    cleanupTimers();
  });

  it.each(['ArrowDown', 'ArrowUp', 'Enter', ' '])('opens flyout via %s on a grouped tool button', (key) => {
    render(<SidebarLeft />);

    const brushButton = toolbarButtonByName('brush');
    act(() => {
      fireEvent.keyDown(brushButton, { key });
    });

    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  it('does not open flyout via keyboard on single-tool group buttons', () => {
    render(<SidebarLeft />);

    const drawButton = toolbarButtonByName('draw');
    act(() => {
      fireEvent.keyDown(drawButton, { key: 'ArrowDown' });
    });
    act(() => {
      fireEvent.keyDown(drawButton, { key: 'Enter' });
    });

    expect(screen.queryByRole('menu')).toBeNull();
  });

  describe('flyout keyboard navigation', () => {
    it('moves focus with ArrowDown within the flyout', () => {
      render(<SidebarLeft />);

      act(() => {
        fireEvent.contextMenu(toolbarButtonByName('brush'));
      });

      const items = screen.getAllByRole('menuitemradio');
      expect(items.length).toBeGreaterThanOrEqual(2);

      items[0].focus();
      expect(items[0]).toHaveFocus();

      act(() => {
        fireEvent.keyDown(items[0], { key: 'ArrowDown' });
      });
      expect(items[1]).toHaveFocus();
    });

    it('moves focus with ArrowUp wrapping to the last item', () => {
      render(<SidebarLeft />);

      act(() => {
        fireEvent.contextMenu(toolbarButtonByName('brush'));
      });

      const items = screen.getAllByRole('menuitemradio');
      const lastItem = items[items.length - 1];

      items[0].focus();
      act(() => {
        fireEvent.keyDown(items[0], { key: 'ArrowUp' });
      });
      expect(lastItem).toHaveFocus();
    });

    it('wraps ArrowDown from last item to first', () => {
      render(<SidebarLeft />);

      act(() => {
        fireEvent.contextMenu(toolbarButtonByName('brush'));
      });

      const items = screen.getAllByRole('menuitemradio');
      const lastItem = items[items.length - 1];

      lastItem.focus();
      act(() => {
        fireEvent.keyDown(lastItem, { key: 'ArrowDown' });
      });
      expect(items[0]).toHaveFocus();
    });

    it('activates the focused item with Enter', () => {
      render(<SidebarLeft />);

      act(() => {
        fireEvent.contextMenu(toolbarButtonByName('brush'));
      });

      const pencilItem = screen.getByRole('menuitemradio', { name: 'Pencil Tool' });
      pencilItem.focus();
      act(() => {
        fireEvent.keyDown(screen.getByRole('menu'), { key: 'Enter' });
      });

      expect(goToTool).toHaveBeenCalledWith('pencil');
      expect(screen.queryByRole('menu')).toBeNull();
    });

    it('keeps focus on the tile after a long press and focuses the first item on ArrowDown', () => {
      vi.useFakeTimers();
      render(<SidebarLeft />);

      const brushButton = toolbarButtonByName('brush');
      brushButton.focus();
      longPress(brushButton);

      const menu = screen.getByRole('menu');
      expect(brushButton).toHaveFocus();

      act(() => {
        fireEvent.keyDown(menu, { key: 'ArrowDown' });
      });

      expect(screen.getAllByRole('menuitemradio')[0]).toHaveFocus();
    });

    it('focuses the first flyout item on the next frame when the tile is opened from the keyboard', () => {
      const frames: FrameRequestCallback[] = [];
      vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
        frames.push(callback);
        return frames.length;
      });

      try {
        render(<SidebarLeft />);

        const brushButton = toolbarButtonByName('brush');
        act(() => {
          fireEvent.keyDown(brushButton, { key: 'ArrowDown' });
        });

        expect(frames).toHaveLength(1);
        expect(screen.getAllByRole('menuitemradio')[0]).not.toHaveFocus();

        act(() => {
          frames.forEach((frame) => frame(0));
        });

        expect(screen.getAllByRole('menuitemradio')[0]).toHaveFocus();
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });
});
