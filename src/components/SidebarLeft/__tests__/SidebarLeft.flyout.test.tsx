import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  advanceThroughLongPress,
  goToTool,
  toolbarButtonByName,
  longPress,
  useSidebarLeftHarness,
} from './harness.tsx';
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
      fireEvent.pointerDown(brushButton, { button: 0, pointerId: 1 });
    });
    act(() => {
      fireEvent.pointerLeave(brushButton, { pointerId: 1 });
    });

    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_DELAY);
    });

    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('ignores foreign pointer endings while a long-press is pending', () => {
    vi.useFakeTimers();
    render(<SidebarLeft />);

    const brushButton = toolbarButtonByName('brush');
    act(() => {
      fireEvent.pointerDown(brushButton, { button: 0, pointerId: 1 });
      fireEvent.pointerLeave(brushButton, { pointerId: 2 });
      fireEvent.pointerUp(brushButton, { pointerId: 2 });
      fireEvent.pointerCancel(brushButton, { pointerId: 2 });
    });

    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_DELAY);
    });

    expect(screen.getByRole('menu', { name: 'Brush Tool tools' })).toBeInTheDocument();
    fireEvent.pointerUp(brushButton, { pointerId: 1 });
  });

  it('keeps the original tile as owner when a different tile gets a simultaneous pointer', () => {
    vi.useFakeTimers();
    render(<SidebarLeft />);

    const brushButton = toolbarButtonByName('brush');
    const shapeButton = toolbarButtonByName('shape');
    fireEvent.pointerDown(brushButton, { button: 0, pointerId: 1 });
    fireEvent.pointerDown(shapeButton, { button: 0, pointerId: 2 });
    fireEvent.pointerCancel(shapeButton, { pointerId: 2 });

    advanceThroughLongPress();
    expect(screen.getByRole('menu', { name: 'Brush Tool tools' })).toBeInTheDocument();
    expect(screen.queryByRole('menu', { name: 'Shape tools' })).toBeNull();

    fireEvent.pointerCancel(document.body, { pointerId: 1 });
    expect(screen.getByRole('menu', { name: 'Brush Tool tools' })).toBeInTheDocument();

    fireEvent.pointerDown(shapeButton, { button: 0, pointerId: 3 });
    advanceThroughLongPress();
    expect(screen.getByRole('menu', { name: 'Shape tools' })).toBeInTheDocument();
  });

  it('ignores an unowned click while another pointer owns the long-press', () => {
    vi.useFakeTimers();
    render(<SidebarLeft />);

    const brushButton = toolbarButtonByName('brush');
    act(() => {
      fireEvent.pointerDown(brushButton, { button: 0, pointerId: 1 });
      fireEvent.pointerDown(brushButton, { button: 0, pointerId: 2 });
      fireEvent.pointerUp(brushButton, { pointerId: 2 });
      fireEvent.click(brushButton, { detail: 1 });
    });

    expect(screen.queryByRole('menu')).toBeNull();
    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_DELAY);
    });
    expect(screen.getByRole('menu', { name: 'Brush Tool tools' })).toBeInTheDocument();

    fireEvent.pointerUp(brushButton, { pointerId: 1 });
    fireEvent.click(brushButton, { detail: 1 });
    expect(screen.getByRole('menu', { name: 'Brush Tool tools' })).toBeInTheDocument();
  });

  it('keeps a pressless activation open when its active pointer later releases', () => {
    vi.useFakeTimers();
    render(<SidebarLeft />);

    const brushButton = toolbarButtonByName('brush');
    fireEvent.pointerDown(brushButton, { button: 0, pointerId: 1 });
    fireEvent.pointerLeave(brushButton, { pointerId: 1 });
    fireEvent.pointerEnter(brushButton, { pointerId: 1 });
    fireEvent.click(brushButton, { detail: 0 });
    expect(screen.getByRole('menu', { name: 'Brush Tool tools' })).toBeInTheDocument();

    fireEvent.pointerUp(brushButton, { pointerId: 1 });
    fireEvent.click(brushButton, { detail: 1 });

    expect(screen.getByRole('menu', { name: 'Brush Tool tools' })).toBeInTheDocument();
  });

  it('suppresses the owner click after leaving and returning to an opened flyout', () => {
    vi.useFakeTimers();
    render(<SidebarLeft />);

    const brushButton = toolbarButtonByName('brush');
    fireEvent.pointerDown(brushButton, { button: 0, pointerId: 1 });
    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_DELAY);
    });
    expect(screen.getByRole('menu', { name: 'Brush Tool tools' })).toBeInTheDocument();

    fireEvent.pointerLeave(brushButton, { pointerId: 1 });
    fireEvent.pointerEnter(brushButton, { pointerId: 1 });
    fireEvent.pointerUp(brushButton, { pointerId: 1 });
    fireEvent.click(brushButton, { detail: 1 });

    expect(screen.getByRole('menu', { name: 'Brush Tool tools' })).toBeInTheDocument();
    expect(goToTool).not.toHaveBeenCalled();
  });

  it('releases a long-press owner when it ends outside the tile', () => {
    vi.useFakeTimers();
    render(<SidebarLeft />);

    const brushButton = toolbarButtonByName('brush');
    fireEvent.pointerDown(brushButton, { button: 0, pointerId: 1 });
    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_DELAY);
    });
    expect(screen.getByRole('menu', { name: 'Brush Tool tools' })).toBeInTheDocument();

    fireEvent.pointerLeave(brushButton, { pointerId: 1 });
    fireEvent.pointerUp(document.body, { pointerId: 1 });
    fireEvent.keyDown(window, { key: 'Escape' });

    expect(screen.queryByRole('menu')).toBeNull();

    fireEvent.pointerDown(brushButton, { button: 0, pointerId: 2 });
    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_DELAY);
    });
    expect(screen.getByRole('menu', { name: 'Brush Tool tools' })).toBeInTheDocument();
    fireEvent.pointerUp(brushButton, { pointerId: 2 });
    fireEvent.click(brushButton, { detail: 1 });
    expect(screen.getByRole('menu', { name: 'Brush Tool tools' })).toBeInTheDocument();
  });

  it('releases a flyout owner cancelled outside the tile', () => {
    vi.useFakeTimers();
    render(<SidebarLeft />);

    const brushButton = toolbarButtonByName('brush');
    fireEvent.pointerDown(brushButton, { button: 0, pointerId: 1 });
    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_DELAY);
    });
    expect(screen.getByRole('menu', { name: 'Brush Tool tools' })).toBeInTheDocument();

    fireEvent.pointerLeave(brushButton, { pointerId: 1 });
    fireEvent.pointerCancel(document.body, { pointerId: 1 });
    fireEvent.keyDown(window, { key: 'Escape' });

    expect(screen.queryByRole('menu')).toBeNull();

    fireEvent.pointerDown(brushButton, { button: 0, pointerId: 2 });
    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_DELAY);
    });
    expect(screen.getByRole('menu', { name: 'Brush Tool tools' })).toBeInTheDocument();
    fireEvent.pointerUp(brushButton, { pointerId: 2 });
    fireEvent.click(brushButton, { detail: 1 });
    expect(screen.getByRole('menu', { name: 'Brush Tool tools' })).toBeInTheDocument();
  });
});
