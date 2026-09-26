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
      'freehand-lasso': Icon,
      'polygonal-lasso': Icon,
      'feather-magnetic-lasso': Icon,
      'magic-wand': Icon,
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

describe('SidebarLeft right-click (context menu)', () => {
  beforeEach(() => {
    resetMocks();
  });

  afterEach(() => {
    cleanupTimers();
  });

  it('opens flyout on right-click for grouped tools', () => {
    render(<SidebarLeft />);

    act(() => {
      fireEvent.contextMenu(toolbarButtonByName('brush'));
    });
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  it('does not open flyout on right-click for single-tool groups', () => {
    render(<SidebarLeft />);

    act(() => {
      fireEvent.contextMenu(toolbarButtonByName('draw'));
    });
    expect(screen.queryByRole('menu')).toBeNull();
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

    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(goToTool).not.toHaveBeenCalled();
  });

  it('does not open a flyout on a long press for single-tool groups and selects the tool instead', () => {
    vi.useFakeTimers();
    render(<SidebarLeft />);

    longPress(toolbarButtonByName('draw'));

    expect(screen.queryByRole('menu')).toBeNull();
    expect(goToTool).toHaveBeenCalledWith('draw');
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
