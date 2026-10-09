import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { goToTool, toolbarButtonByName, longPress, useSidebarLeftHarness } from './harness.tsx';
import SidebarLeft, { FLYOUT_LONG_PRESS_MS } from '../SidebarLeft.tsx';

const LONG_PRESS_DELAY = FLYOUT_LONG_PRESS_MS;

describe('SidebarLeft flyout closing', () => {
  useSidebarLeftHarness();
  it.each([
    ['outside click', () => act(() => fireEvent.click(document.body))],
    ['Escape', () => act(() => fireEvent.keyDown(window, { key: 'Escape' }))],
  ])('closes an open submenu on %s', (_label, close) => {
    vi.useFakeTimers();
    render(<SidebarLeft />);

    longPress(toolbarButtonByName('brush'));
    expect(screen.getByRole('menu')).toBeInTheDocument();

    close();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes the open submenu when clicking the active grouped tile', () => {
    vi.useFakeTimers();
    render(<SidebarLeft />);

    longPress(toolbarButtonByName('brush'));
    expect(screen.getByRole('menu')).toBeInTheDocument();

    act(() => {
      fireEvent.click(toolbarButtonByName('brush'));
    });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(goToTool).not.toHaveBeenCalled();
  });

  it('closes the open submenu when a different grouped tile is long-pressed', () => {
    vi.useFakeTimers();
    render(<SidebarLeft />);

    longPress(toolbarButtonByName('brush'));
    expect(screen.getByRole('menu')).toBeInTheDocument();

    longPress(toolbarButtonByName('shape'));

    expect(screen.queryByRole('menu', { name: 'Brush Tool tools' })).toBeNull();
    expect(screen.getByRole('menu', { name: 'Shape tools' })).toBeInTheDocument();
  });

  it('cancels a pending long-press when the pointer leaves before the timeout', () => {
    vi.useFakeTimers();
    render(<SidebarLeft />);

    const brushButton = toolbarButtonByName('brush');
    act(() => {
      fireEvent.pointerDown(brushButton, { button: 0 });
    });
    act(() => {
      fireEvent.pointerLeave(brushButton);
    });

    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_DELAY);
    });

    expect(screen.queryByRole('menu')).toBeNull();
  });
});
