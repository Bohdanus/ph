import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { goToTool, toolbarButtonByName, longPress, useSidebarLeftHarness } from './harness.tsx';
import SidebarLeft from '../SidebarLeft.tsx';

describe('SidebarLeft right-click (context menu)', () => {
  useSidebarLeftHarness();
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
