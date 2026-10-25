import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { toolbarMap } from '../../../../toolbar-mapping.ts';
// The harness registers this suite's `vi.mock` calls inside its own module and vitest
// hoists them, so it has to be imported BEFORE `../SidebarLeft.tsx` for them to apply — see
// the harness's own docstring, which is where that requirement is written down.
import { goToTool, longPress, patchToolArgs, toolbarButtonByName, useSidebarLeftHarness } from './harness.tsx';
import SidebarLeft from '../SidebarLeft.tsx';

/**
 * The Brush tile's own flyout, read from the mapping rather than counted here. The
 * assertions below address its rows THROUGH this group, so a tool added to the group moves
 * the row under discussion with it instead of quietly making a test assert a different one.
 */
const brushGroup = toolbarMap.flat().find((group) => group.some((tool) => tool.name === 'brush'))!;

/**
 * One row of the Brush flyout, addressed by the ACCESSIBLE NAME the item renders rather than
 * by its position in the list.
 *
 * `role="menuitemradio"` is rendered per entry of a data-driven group, so `[0]` names a
 * POSITION and not a tool: insert a tool above a row and every index-based assertion in this
 * file silently retargets onto a different element while still passing. The item's
 * `aria-label` is the tool's own `label` from the mapping, which makes the name the row's
 * identity — so this query cannot be retargeted by a row being added, removed or reordered
 * above it, and a row that loses its name fails here instead of being skipped.
 *
 * The index parameter picks WHICH row of the group is under discussion; it does not pick the
 * element. It is read from {@link brushGroup} for the reason that file gives: a tool added to
 * the group moves the expectation with it rather than leaving a hardcoded name to rot.
 */
const brushRow = (index: number): HTMLElement => screen.getByRole('menuitemradio', { name: brushGroup[index].label });

/**
 * The tool NAME behind one row of the Brush flyout — the exact argument `goToTool` is expected
 * to receive for that row. Read from the same group as {@link brushRow}, so the row the test
 * navigates to and the tool it expects to be given are one fact rather than two.
 */
const brushToolName = (index: number): string => brushGroup[index].name;

/** The last row of the Brush flyout, by identity — the wrap-around target. */
const lastBrushRow = (): HTMLElement => brushRow(brushGroup.length - 1);

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

function flushFrames(frames: FrameRequestCallback[], maxFrames = 5) {
  for (let attempt = 0; attempt < maxFrames && frames.length > 0; attempt += 1) {
    const pending = frames.splice(0);
    pending.forEach((frame) => frame(0));
  }
}

describe('SidebarLeft keyboard activation', () => {
  useSidebarLeftHarness();

  beforeEach(() => {
    // Fake timers for the whole file, because the tile's open handler schedules bounded animation
    // frame retries and `requestAnimationFrame` is polyfilled as a 16ms
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
   * flyout. `renderToolGroup`'s `onKeyDown` in `SidebarLeft.tsx` is a three-way branch:
   * `ArrowUp` targets the LAST item, everything else keeps the focused item when one is
   * already focused among the flyout's items and otherwise takes the first — and for a key
   * pressed on the tile nothing is focused inside the menu yet, so the first is what the
   * other three get. The middle case is unreachable rather than merely untested: the menu is
   * portalled out of the tile, so a key pressed while an item holds focus never reaches this
   * handler. The `<ul>`'s own arrow handler — the other `onKeyDown`, further down the same
   * file — is what Playwright's `sidebar-keyboard` spec exercises, which is why the ArrowUp
   * branch of THIS one had no jsdom coverage at all.
   *
   * The test advances frames explicitly so it can distinguish deferred focus from synchronous
   * focus. The anchored portal may need another frame before its visibility is ready.
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
    // Not yet. The first attempt is deferred.
    items.forEach((item) => {
      expect(item).not.toHaveFocus();
    });

    expect(frames).toHaveLength(1);
    act(() => flushFrames(frames));

    expect(end === 'last' ? lastBrushRow() : brushRow(0)).toHaveFocus();
  });

  it('retries briefly when the flyout portal has not exposed its items on the first frame', () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });

    render(<SidebarLeft />);
    const brushButton = toolbarButtonByName('brush');
    brushButton.focus();
    fireEvent.keyDown(brushButton, { key: 'ArrowDown' });

    const menu = screen.getByRole('menu');
    const queryItems = menu.querySelectorAll.bind(menu);
    let firstRead = true;
    vi.spyOn(menu, 'querySelectorAll').mockImplementation((selector: string) => {
      if (selector === '[role="menuitemradio"]' && firstRead) {
        firstRead = false;
        return [] as unknown as NodeListOf<Element>;
      }
      return queryItems(selector);
    });

    act(() => frames.shift()?.(0));
    expect(frames).toHaveLength(1);
    expect(brushRow(0)).not.toHaveFocus();

    act(() => frames.shift()?.(16));
    expect(brushRow(0)).toHaveFocus();
  });

  it('retries while the mounted flyout is hidden until its position is ready', () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });

    render(<SidebarLeft />);
    const brushButton = toolbarButtonByName('brush');
    brushButton.focus();
    fireEvent.keyDown(brushButton, { key: 'ArrowDown' });

    const menu = screen.getByRole('menu');
    const firstItem = brushRow(0);
    const focus = vi.spyOn(firstItem, 'focus');
    menu.style.visibility = 'hidden';

    act(() => frames.shift()?.(0));
    expect(frames).toHaveLength(1);
    expect(focus).not.toHaveBeenCalled();
    expect(firstItem).not.toHaveFocus();

    menu.style.visibility = 'visible';
    act(() => frames.shift()?.(16));
    expect(focus).toHaveBeenCalledOnce();
    expect(firstItem).toHaveFocus();
  });

  it('does not apply a stale keyboard focus retry after a pointer reopen', () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });

    render(<SidebarLeft />);
    const brushButton = toolbarButtonByName('brush');
    brushButton.focus();
    fireEvent.keyDown(brushButton, { key: 'ArrowDown' });

    const keyboardMenu = screen.getByRole('menu');
    keyboardMenu.style.visibility = 'hidden';
    act(() => frames.shift()?.(0));
    expect(frames).toHaveLength(1);

    act(() => fireEvent.keyDown(window, { key: 'Escape' }));
    expect(screen.queryByRole('menu')).toBeNull();

    longPress(brushButton);
    const pointerMenu = screen.getByRole('menu');
    pointerMenu.style.visibility = 'visible';
    const pointerItem = brushRow(0);
    const focus = vi.spyOn(pointerItem, 'focus');

    act(() => flushFrames(frames));

    expect(focus).not.toHaveBeenCalled();
    expect(brushButton).toHaveFocus();
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

  /**
   * The tile's own `Tab` branch, which is the one key the handler deals with that is not an
   * opening key: `Tab` off a tile with a flyout open CLOSES it.
   *
   * A long press is how that state is reached with focus on the tile — the pointer opens the
   * flyout and the tile keeps focus, which the test above pins — and Tab from there is the
   * ordinary way out of a menu the mouse opened. The close takes no `restoreFocus`, and must
   * not: focus never left the tile, so "restoring" it would be a no-op at best. What has to
   * hold is that the menu goes away and the tile is still the focused element afterwards.
   */
  it('closes an open flyout on Tab from the tile, and leaves focus on the tile', () => {
    render(<SidebarLeft />);

    const brushButton = toolbarButtonByName('brush');
    brushButton.focus();
    longPress(brushButton);
    expect(screen.getByRole('menu')).toBeInTheDocument();

    // Not prevented: the tile closes the menu and then lets the browser move focus on, which
    // is what makes this an exit rather than a dismissal in place.
    expect(fireEvent.keyDown(brushButton, { key: 'Tab' })).toBe(true);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(brushButton).toHaveFocus();
    // Closing is not choosing: the tile's own default tool is still not selected.
    expect(goToTool).not.toHaveBeenCalled();
  });

  /**
   * The same branch with nothing open, where its whole body is skipped.
   *
   * The two halves belong together because the difference between them is the `isOpen` test,
   * and the half that is easy to get wrong is this one: a handler that treated Tab as "close
   * whatever is open" unconditionally would swallow Tab on every tile in the rail, and a rail
   * that eats Tab is a rail no keyboard user can leave. `fireEvent` returning `true` is the
   * default-was-not-prevented signal, which is the only observable here — jsdom has no tab
   * order to advance.
   */
  it('leaves Tab to the browser when no flyout is open, so the rail cannot trap the keyboard', () => {
    render(<SidebarLeft />);

    const brushButton = toolbarButtonByName('brush');
    act(() => {
      brushButton.focus();
    });

    expect(fireEvent.keyDown(brushButton, { key: 'Tab' })).toBe(true);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(brushButton).toHaveFocus();
  });

  /**
   * Which keys the tile's handler consumes, which is a contract rather than a detail: the
   * four opening keys are prevented so the browser does not ALSO activate the tile.
   *
   * `preventDefault` on a keydown is the only thing standing between "opens the flyout" and
   * "opens the flyout and selects the tile's default tool", because `<button>` synthesises its
   * click from Enter and Space on keyup and a prevented keydown never produces it. Nothing
   * else in this file can see that: jsdom does not turn a keydown into a click, so an
   * un-prevented Enter here would look identical to a prevented one.
   *
   * The other half of the contract is that nothing ELSE is consumed. Every key the handler
   * does not name stays with the browser, which is what keeps the rail's own single-key tool
   * shortcuts and the browser's Tab working; a handler that prevented every key would pass a
   * test written only for the four.
   */
  it('swallows the four opening keys on a GROUPED tile, and nothing else', () => {
    render(<SidebarLeft />);

    // A single-tool tile returns before any of it, so its Enter and Space keep reaching the
    // browser as the plain activation a lone button is supposed to get — and none of the four
    // opens anything.
    const drawButton = toolbarButtonByName('draw');
    for (const key of ['ArrowDown', 'ArrowUp', 'Enter', ' ']) {
      expect(fireEvent.keyDown(drawButton, { key }), `${key} must reach the browser on a single-tool tile`).toBe(true);
    }
    expect(screen.queryByRole('menu')).toBeNull();

    const brushButton = toolbarButtonByName('brush');
    // What a keyboard user has already done: the tile holds focus, which is the state the
    // handler reads and the state the assertions below end on.
    act(() => {
      brushButton.focus();
    });
    for (const key of ['ArrowDown', 'ArrowUp', 'Enter', ' ']) {
      expect(fireEvent.keyDown(brushButton, { key }), `${key} must be prevented on a grouped tile`).toBe(false);
    }
    // A key the handler does not name. The rail's tool shortcuts are single letters, so this
    // is the case where over-eager preventDefault would be noticed.
    expect(fireEvent.keyDown(brushButton, { key: 'b' })).toBe(true);
    // The four prevented keys are OPENING keys, so this tile's flyout is open by now, and the
    // key the handler ignores neither closes it nor moves focus.
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(brushButton).toHaveFocus();
  });

  /**
   * Escape landing INSIDE the window the tile's deferred focus opens.
   *
   * The tile schedules its focus move on an animation frame, so for one frame after ArrowDown
   * the menu is mounted and focusable while focus is still on the tile. A user who presses
   * Escape in that frame gets the window-level handler, which closes the menu and hands focus
   * back to the tile — and then the frame that was already scheduled runs against a menu that
   * no longer exists. That is the race the deferral itself is load-bearing for (the overlay
   * spends a frame at `visibility: hidden`, during which the focus lands on something that
   * cannot take it), so the stale callback is the half worth pinning: it must find nothing to
   * focus and leave the tile alone.
   */
  it('closes a keyboard-opened flyout on Escape before the deferred focus frame, and the frame cannot steal focus back', () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });

    render(<SidebarLeft />);
    const brushButton = toolbarButtonByName('brush');
    act(() => {
      brushButton.focus();
    });
    act(() => {
      fireEvent.keyDown(brushButton, { key: 'ArrowDown' });
    });
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(brushButton).toHaveFocus();
    expect(frames).toHaveLength(1);

    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(brushButton).toHaveFocus();
    expect(goToTool).not.toHaveBeenCalled();

    // The frame the key press scheduled still fires, now against an unmounted menu.
    act(() => {
      flushFrames(frames);
    });
    expect(brushButton).toHaveFocus();
    expect(goToTool).not.toHaveBeenCalled();
  });

  describe('flyout keyboard navigation', () => {
    it('moves focus with ArrowDown within the flyout', () => {
      render(<SidebarLeft />);

      act(() => {
        fireEvent.contextMenu(toolbarButtonByName('brush'));
      });

      const items = screen.getAllByRole('menuitemradio');
      expect(items.length).toBeGreaterThanOrEqual(2);

      // The row is named, not indexed: an `items[0]`/`items[1]` pair says "the first two
      // rows", which stays true after a tool is inserted above them and so cannot tell the
      // difference between the source walking the group and the source walking the wrong one.
      const firstRow = brushRow(0);
      firstRow.focus();
      expect(firstRow).toHaveFocus();

      act(() => {
        fireEvent.keyDown(firstRow, { key: 'ArrowDown' });
      });
      expect(brushRow(1)).toHaveFocus();
      expect(firstRow).not.toHaveFocus();
    });

    it('moves focus with ArrowUp wrapping to the last item', () => {
      render(<SidebarLeft />);

      act(() => {
        fireEvent.contextMenu(toolbarButtonByName('brush'));
      });

      const firstRow = brushRow(0);
      firstRow.focus();
      act(() => {
        fireEvent.keyDown(firstRow, { key: 'ArrowUp' });
      });
      expect(lastBrushRow()).toHaveFocus();
      // The wrap target is a real other row, not the row it came from: an index that
      // resolved to the same element would satisfy `toHaveFocus()` after any arrow key.
      expect(lastBrushRow()).not.toBe(firstRow);
    });

    it('wraps ArrowDown from last item to first', () => {
      render(<SidebarLeft />);

      act(() => {
        fireEvent.contextMenu(toolbarButtonByName('brush'));
      });

      const lastRow = lastBrushRow();
      lastRow.focus();
      act(() => {
        fireEvent.keyDown(lastRow, { key: 'ArrowDown' });
      });
      expect(brushRow(0)).toHaveFocus();
      expect(lastRow).not.toHaveFocus();
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

      expect(brushRow(0)).toHaveFocus();
    });

    /**
     * The arrow rule for a menu with NO focused row, which is the tile's rule NOT applied.
     *
     * `renderToolGroup`'s `onKeyDown` sends `ArrowUp` to the LAST row, because a key pressed
     * on the tile means "enter the menu from the top". The `<ul>`'s own handler has no such
     * case: its index lookup returns -1 when nothing inside the menu holds focus, and -1
     * takes row 0 for BOTH arrows. That asymmetry is the whole claim — an implementation that
     * reused the tile's "ArrowUp means the end" rule here would send a user who pressed ArrowUp
     * into the end of the group, and only the tile's own tests would still be green.
     *
     * Driven through the `<ul>`'s handler with focus deliberately outside every row, which is
     * how the branch is reached: the handler reads `document.activeElement`, not the event
     * target, so the two are separable here in a way a real keypress cannot separate.
     */
    it('focuses the first flyout row from EITHER arrow when no row holds focus', () => {
      render(<SidebarLeft />);

      act(() => {
        fireEvent.contextMenu(toolbarButtonByName('brush'));
      });
      const menu = screen.getByRole('menu');
      const brushButton = toolbarButtonByName('brush');
      // Nothing inside the menu holds focus: a right-click opened the flyout, and the pointer
      // left focus where it was. `document.activeElement` is the body, which is what the
      // handler's index lookup turns into -1.
      expect(document.activeElement).not.toBe(brushRow(0));

      act(() => {
        fireEvent.keyDown(menu, { key: 'ArrowUp' });
      });
      expect(brushRow(0)).toHaveFocus();
      // Explicitly NOT the tile's ArrowUp target, which is the row this assertion would
      // silently become if the two handlers ever shared one rule.
      expect(lastBrushRow()).not.toHaveFocus();

      // Focus leaves the menu again — back on the tile, as a Tab out of a portalled menu
      // ends — so the second arrow is read from the same "no row holds focus" state and is
      // not answered by the row the first arrow left focused.
      act(() => {
        brushButton.focus();
      });
      act(() => {
        fireEvent.keyDown(menu, { key: 'ArrowDown' });
      });
      expect(brushRow(0)).toHaveFocus();
      expect(brushRow(1)).not.toHaveFocus();
    });

    /**
     * Enter with no focused row, which is the `instanceof HTMLButtonElement` guard on the
     * menu's activation branch.
     *
     * The guard is what keeps Enter from activating something outside the menu. Without it the
     * handler clicks whatever `document.activeElement` is — the body — and the body click lands
     * on the rail's own outside-click handler, so a stray Enter would DISMISS the menu instead
     * of doing nothing. The menu staying open is therefore the assertion that carries this
     * branch, and the empty dispatch list is what says it selected nothing on the way.
     */
    it('selects nothing on Enter when no row holds focus, and leaves the menu open', () => {
      render(<SidebarLeft />);

      act(() => {
        fireEvent.contextMenu(toolbarButtonByName('brush'));
      });
      const menu = screen.getByRole('menu');

      // `fireEvent` returns `false` for a keydown whose default was prevented, so this says
      // the handler declined the key rather than consuming it.
      expect(fireEvent.keyDown(menu, { key: 'Enter' })).toBe(true);
      expect(goToTool).not.toHaveBeenCalled();
      expect(patchToolArgs).not.toHaveBeenCalled();
      expect(screen.getByRole('menu')).toBe(menu);
    });

    /**
     * The end of a keyboard journey: navigate to a row BY ITS NAME and activate THAT tool.
     *
     * The existing Enter test focuses a row and presses Enter, which proves the activation
     * branch fires. It cannot prove the branch acts on the row the user navigated to rather
     * than on whatever occupies a position: both rows would produce a `goToTool` call, and a
     * handler reading a stale index would still pass. This walks two rows down from the one
     * the frame focused and pins the tool NAME that comes out, so a focus or index that drifts
     * is a failing assertion about a named tool.
     */
    it('activates the row the arrows walked to, by name, and hands focus back to the tile', () => {
      const frames: FrameRequestCallback[] = [];
      vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
        frames.push(callback);
        return frames.length;
      });

      render(<SidebarLeft />);
      const brushButton = toolbarButtonByName('brush');
      act(() => {
        brushButton.focus();
      });
      act(() => {
        fireEvent.keyDown(brushButton, { key: 'ArrowDown' });
      });
      act(() => {
        flushFrames(frames);
      });
      expect(brushRow(0)).toHaveFocus();

      const menu = screen.getByRole('menu');
      act(() => {
        fireEvent.keyDown(menu, { key: 'ArrowDown' });
      });
      act(() => {
        fireEvent.keyDown(menu, { key: 'ArrowDown' });
      });
      const target = brushRow(2);
      expect(target).toHaveFocus();

      act(() => {
        fireEvent.keyDown(menu, { key: 'Enter' });
      });

      expect(goToTool).toHaveBeenCalledTimes(1);
      expect(goToTool).toHaveBeenCalledWith(brushToolName(2));
      expect(screen.queryByRole('menu')).toBeNull();
      expect(brushButton).toHaveFocus();
    });
  });
});
