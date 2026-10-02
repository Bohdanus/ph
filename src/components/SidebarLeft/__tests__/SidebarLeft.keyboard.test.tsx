import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { toolbarMap } from '../../../../toolbar-mapping.ts';
// The harness registers this suite's `vi.mock` calls inside its own module and vitest
// hoists them, so it has to be imported BEFORE `../SidebarLeft.tsx` for them to apply — see
// the harness's own docstring, which is where that requirement is written down.
import { goToTool, longPress, toolbarButtonByName, useSidebarLeftHarness } from './harness.tsx';
import SidebarLeft from '../SidebarLeft.tsx';

/**
 * The Brush tile's own flyout, read from the mapping rather than counted here. The
 * assertion below derives its index from this group, so a tool added to the group moves the
 * expected index with it instead of quietly making the test assert the wrong one.
 */
const brushGroup = toolbarMap.flat().find((group) => group.some((tool) => tool.name === 'brush'))!;

/**
 * Which end of the flyout each opening key targets, stated as the data the assertion reads
 * rather than as arithmetic inside it. `last` is resolved against the flyout's REAL item
 * count, so a tool added to the group moves the expected index with it instead of quietly
 * making the test assert the wrong item.
 */
const FOCUS_TARGET: readonly (readonly [string, 'first' | 'last'])[] = [
  ['ArrowDown', 'first'],
  ['ArrowUp', 'last'],
  ['Enter', 'first'],
  [' ', 'first'],
];

describe('SidebarLeft keyboard activation', () => {
  useSidebarLeftHarness();

  beforeEach(() => {
    // Fake timers for the whole file, because the tile's open handler schedules an animation
    // frame and never cancels it, and `requestAnimationFrame` is polyfilled as a 16ms
    // `setTimeout` (`src/test/setup.ts`). Under real timers every keyboard open therefore
    // left a real macrotask behind: it fired during a LATER test and called `.focus()` on
    // whatever flyout happened to exist at that moment. `vi.clearAllTimers()` in `afterEach`
    // could not see any of it — it is a no-op unless fake timers were installed — and it
    // does nothing to a real pending timer even then. With the clock faked, a frame is
    // something this file owns: it is either driven here or discarded when the file ends.
    vi.useFakeTimers();
  });

  afterEach(() => {
    // The capture stub below replaces a global, so it does not come back on its own.
    vi.unstubAllGlobals();
  });

  /**
   * The tile's own open handler, and the only path in this suite that moves focus INSIDE a
   * flyout. `SidebarLeft.tsx:309` is a three-way branch: `ArrowUp` targets the LAST item,
   * everything else keeps the focused item when one is already focused among the flyout's
   * items and otherwise takes the first — and for a key pressed on the tile nothing is
   * focused inside the menu yet, so the first is what the other three get. The middle case
   * is unreachable rather than merely untested: the menu is portalled out of the tile, so a
   * key pressed while an item holds focus never reaches this handler. Playwright's
   * `sidebar-keyboard` spec exercises the MENU's own arrow handler further down the same
   * file — a different `onKeyDown` — which is why the ArrowUp branch of THIS one had no
   * jsdom coverage at all.
   *
   * The frame is captured rather than waited for, because the deferral is half the
   * behaviour: the flyout is mounted in the same commit the key was handled in, so the items
   * exist immediately, and the focus lands a frame later. Asserting that nothing is focused
   * before the frame runs is what separates "deferred by one frame" from "focused
   * synchronously" — and the deferral is load-bearing, since measuring in a passive effect
   * would cost a frame of `visibility: hidden` in which the overlay cannot take focus at all.
   */
  it.each(FOCUS_TARGET)('opens the flyout on %s and focuses the item that key targets', (key, end) => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });

    render(<SidebarLeft />);

    const brushButton = toolbarButtonByName('brush');
    // What a real keyboard has done before the key: the tile holds focus, which is the
    // state the handler's `document.activeElement` lookup reads.
    act(() => {
      brushButton.focus();
    });
    act(() => {
      fireEvent.keyDown(brushButton, { key });
    });

    expect(screen.getByRole('menu')).toBeInTheDocument();
    const items = screen.getAllByRole('menuitemradio');
    expect(items).toHaveLength(brushGroup.length);
    // Not yet. One frame from now.
    items.forEach((item) => {
      expect(item).not.toHaveFocus();
    });

    expect(frames).toHaveLength(1);
    act(() => {
      frames.forEach((frame) => frame(0));
    });

    expect(items[end === 'last' ? items.length - 1 : 0]).toHaveFocus();
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
  });
});
