import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import SidebarLeft, { FLYOUT_LONG_PRESS_MS } from '../SidebarLeft.tsx';

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

const LONG_PRESS_DELAY = FLYOUT_LONG_PRESS_MS;

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

describe('SidebarLeft right-click (context menu)', () => {
  beforeEach(() => {
    resetMocks();
  });

  afterEach(() => {
    cleanupTimers();
  });

  it("opens the flyout of the tile that was right-clicked, with that group's own tools in it", () => {
    render(<SidebarLeft />);

    act(() => {
      fireEvent.contextMenu(toolbarButtonByName('brush'));
    });

    // WHICH flyout, and WHICH tools: `getByRole('menu')` alone would pass on any flyout the
    // rail can open, so a handler that ignored the tile and opened the last-registered group
    // would satisfy it. The Brush group's six entries, in the order `toolbarMap` declares them,
    // are the whole claim.
    const menu = screen.getByRole('menu', { name: 'Brush Tool tools' });
    expect(
      within(menu)
        .getAllByRole('menuitemradio')
        .map((item) => item.getAttribute('aria-label'))
    ).toEqual([
      'Brush Tool',
      'Pencil Tool',
      'Color Replacement Tool',
      'Eraser Tool',
      'Magic Eraser Tool',
      'Paint Bucket Tool',
    ]);
    // A right-click opens a menu; it never selects. The selection half belongs to a click.
    expect(goToTool).not.toHaveBeenCalled();
    expect(patchToolArgsMock).not.toHaveBeenCalled();
  });

  it('does not open flyout on right-click for single-tool groups', () => {
    render(<SidebarLeft />);

    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    act(() => {
      fireEvent(toolbarButtonByName('draw'), event);
    });

    expect(screen.queryByRole('menu')).toBeNull();
    // The browser menu is left alone here — unlike the grouped tile, which suppresses it —
    // and the tool is not selected by a right-click either.
    expect(event.defaultPrevented).toBe(false);
    expect(goToTool).not.toHaveBeenCalled();
  });

  it('prevents default browser context menu on right-click for grouped tools', () => {
    render(<SidebarLeft />);

    const brushButton = toolbarButtonByName('brush');
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    act(() => {
      fireEvent(brushButton, event);
    });

    expect(event.defaultPrevented).toBe(true);
  });

  it('opens the flyout on a long press and swallows the trailing click', () => {
    vi.useFakeTimers();
    render(<SidebarLeft />);

    longPress(toolbarButtonByName('brush'));

    expect(screen.getByRole('menu', { name: 'Brush Tool tools' })).toBeInTheDocument();
    expect(goToTool).not.toHaveBeenCalled();
  });

  it('does not open a flyout on a long press for single-tool groups and selects the tool instead', () => {
    vi.useFakeTimers();
    render(<SidebarLeft />);

    longPress(toolbarButtonByName('draw'));

    expect(screen.queryByRole('menu')).toBeNull();
    expect(goToTool).toHaveBeenCalledExactlyOnceWith('draw');
  });

  it('replaces the open flyout when another grouped tile is right-clicked', () => {
    render(<SidebarLeft />);

    act(() => {
      fireEvent.contextMenu(toolbarButtonByName('brush'));
    });
    expect(screen.getByRole('menu', { name: 'Brush Tool tools' })).toBeInTheDocument();

    act(() => {
      fireEvent.contextMenu(toolbarButtonByName('shape'));
    });

    expect(screen.queryByRole('menu', { name: 'Brush Tool tools' })).toBeNull();
    expect(screen.getByRole('menu', { name: 'Shape tools' })).toBeInTheDocument();
    expect(goToTool).not.toHaveBeenCalled();
  });
});
