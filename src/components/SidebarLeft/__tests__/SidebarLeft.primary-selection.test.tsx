import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  goToTool,
  patchToolArgs,
  storeState,
  toolArgs,
  toolbarButtonByName,
  longPress,
  useSidebarLeftHarness,
} from './harness.tsx';
import SidebarLeft, { FLYOUT_LONG_PRESS_MS } from '../SidebarLeft.tsx';

const LONG_PRESS_DELAY = FLYOUT_LONG_PRESS_MS;

/**
 * The "a flyout tile is named and captioned by its first entry" rule, over every flyout that
 * is still on the rail.
 *
 * `color` is not here: it was the first entry of a three-wide flyout that also carried `levels`
 * and `transform`, and all three are now `Image ▸ Adjustments` / `Edit ▸ Transform` COMMANDS
 * with no Tools-panel tile. The rule itself is unchanged and still live here — the four
 * remaining cases are all real multi-entry groups of `toolbarMap`, and the Brush and Pen cases
 * are the ones that carry the rule for a group whose members are distinct tools rather than
 * five figures of one `shape` name.
 */
const groupedToolCases = [
  { title: 'Lasso Tool', name: 'freehand-lasso', item: 'Lasso Tool' },
  { title: 'Brush', name: 'brush', item: 'Brush Tool' },
  { title: 'Pen', name: 'pen', item: 'Pen Tool' },
  { title: 'Rectangle Tool', name: 'shape', item: 'Rectangle Tool' },
] as const;

const nonPrimaryCases: ReadonlyArray<[string, string, string]> = [
  ['pencil', 'brush', 'brush'],
  ['color-replacement', 'brush', 'brush'],
  ['freeform-pen', 'pen', 'pen'],
  ['curvature-pen', 'pen', 'pen'],
  ['ellipse', 'shape', 'shape'],
];

describe('SidebarLeft primary tool selection', () => {
  useSidebarLeftHarness();
  it.each(groupedToolCases)(
    'uses the first submenu item "$item" as the primary for the grouped tile',
    ({ name, item }) => {
      render(<SidebarLeft />);

      const rootButton = toolbarButtonByName(name);
      expect(rootButton).toHaveAttribute('aria-haspopup', 'menu');
      expect(rootButton).toHaveAttribute('aria-expanded', 'false');
      expect(within(rootButton).getByText(item)).toBeInTheDocument();
    }
  );

  it('selects the primary tool on a click without opening the submenu', () => {
    render(<SidebarLeft />);

    act(() => {
      fireEvent.click(toolbarButtonByName('brush'));
    });

    expect(goToTool).toHaveBeenCalledTimes(1);
    expect(goToTool).toHaveBeenCalledWith('brush');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('selects a single-tool group on click without a flyout', () => {
    render(<SidebarLeft />);

    act(() => {
      fireEvent.click(toolbarButtonByName('draw'));
    });

    expect(goToTool).toHaveBeenCalledWith('draw');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('cancels a pending long-press on pointer-up and selects the primary via a short click', () => {
    vi.useFakeTimers();
    render(<SidebarLeft />);

    const brushButton = toolbarButtonByName('brush');
    act(() => {
      fireEvent.pointerDown(brushButton, { button: 0 });
    });
    act(() => {
      fireEvent.pointerUp(brushButton, { button: 0 });
    });
    act(() => {
      fireEvent.click(brushButton);
    });

    expect(goToTool).toHaveBeenCalledWith('brush');
    expect(screen.queryByRole('menu')).toBeNull();

    act(() => {
      vi.advanceTimersByTime(350);
    });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it.each(groupedToolCases)(
    'arms the long-press timer at 250ms, and opens the flyout on the tick that reaches it ($title)',
    ({ name }) => {
      vi.useFakeTimers();
      render(<SidebarLeft />);

      // The NUMBER, pinned here rather than derived, and this is the whole reason the test has
      // a literal in it. A bracket written as `LONG_PRESS_DELAY - 1` then `+1` looks like it
      // guards the threshold and in fact does not: every term comes from the same export the
      // app schedules with, so the bracket is [T−1, T] for whatever T is. Measured — set
      // `FLYOUT_LONG_PRESS_MS` to 5000 and all of these cases stay green, so a five-second
      // hold would have shipped behind a test named after the hold. One assertion on the
      // value makes the bracket mean what its name says.
      expect(
        LONG_PRESS_DELAY,
        'the app long-press threshold is 250ms; changing it is a decision, not a refactor, and this is the assertion that notices'
      ).toBe(250);

      const rootButton = toolbarButtonByName(name);
      act(() => {
        fireEvent.pointerDown(rootButton, { button: 0 });
      });
      act(() => {
        vi.advanceTimersByTime(LONG_PRESS_DELAY - 1);
      });
      expect(screen.queryByRole('menu'), 'one millisecond short of the threshold, nothing may have opened').toBeNull();

      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(
        screen.getByRole('menu'),
        'the very next tick is the threshold, and the flyout opens on it'
      ).toBeInTheDocument();
    }
  );

  it('does not open the submenu on hover', () => {
    vi.useFakeTimers();
    render(<SidebarLeft />);

    const brushButton = toolbarButtonByName('brush');
    const brushGroup = brushButton.closest('li')!;

    act(() => {
      fireEvent.mouseEnter(brushGroup);
    });
    act(() => {
      fireEvent.mouseMove(brushGroup);
    });
    act(() => {
      fireEvent.mouseLeave(brushGroup);
    });
    act(() => {
      vi.advanceTimersByTime(350);
    });

    expect(screen.queryByRole('menu')).toBeNull();
    expect(goToTool).not.toHaveBeenCalled();
  });

  it('does not close the submenu while the pointer moves over its items', () => {
    vi.useFakeTimers();
    render(<SidebarLeft />);

    longPress(toolbarButtonByName('brush'));

    const menu = screen.getByRole('menu');
    act(() => {
      fireEvent.mouseEnter(menu);
    });
    act(() => {
      fireEvent.mouseLeave(menu);
    });
    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  it('selects a non-shape submenu item and makes it the new primary', () => {
    vi.useFakeTimers();
    render(<SidebarLeft />);

    longPress(toolbarButtonByName('brush'));
    act(() => {
      fireEvent.click(screen.getByRole('menuitemradio', { name: 'Pencil Tool' }));
    });

    expect(goToTool).toHaveBeenCalledWith('pencil');
    expect(patchToolArgs).not.toHaveBeenCalled();
    expect(screen.queryByRole('menu')).toBeNull();

    const rootButton = toolbarButtonByName('pencil');
    expect(within(rootButton).getByText('Pencil Tool')).toBeInTheDocument();

    act(() => {
      fireEvent.click(rootButton);
    });
    expect(goToTool).toHaveBeenCalledWith('pencil');
    expect(goToTool).toHaveBeenCalledTimes(2);
  });

  it('selects a shape submenu item, patches the figure, and keeps it as primary', () => {
    vi.useFakeTimers();
    render(<SidebarLeft />);

    longPress(toolbarButtonByName('shape'));
    act(() => {
      fireEvent.click(screen.getByRole('menuitemradio', { name: 'Ellipse Tool' }));
    });

    expect(patchToolArgs).toHaveBeenCalledWith('shape', { figure: 'oval' });
    expect(goToTool).toHaveBeenCalledWith('shape');
    expect(goToTool.mock.invocationCallOrder[0]).toBeLessThan(patchToolArgs.mock.invocationCallOrder[0]);
    expect(screen.queryByRole('menu')).toBeNull();

    const rootButton = toolbarButtonByName('shape');
    expect(within(rootButton).getByText('Ellipse Tool')).toBeInTheDocument();

    act(() => {
      fireEvent.click(rootButton);
    });
    expect(goToTool).toHaveBeenCalledWith('shape');
    expect(patchToolArgs).toHaveBeenLastCalledWith('shape', { figure: 'oval' });
  });

  it('keeps the Photoshop shape flyout: Rectangle then Ellipse, and no Circle or Square tools', () => {
    vi.useFakeTimers();
    render(<SidebarLeft />);

    longPress(toolbarButtonByName('shape'));

    const menu = screen.getByRole('menu', { name: 'Shape tools' });
    for (const label of [
      'Rectangle Tool',
      'Ellipse Tool',
      'Triangle Tool',
      'Polygon Tool',
      'Line Tool',
      'Custom Shape Tool',
    ]) {
      expect(within(menu).getByRole('menuitemradio', { name: label })).toBeInTheDocument();
    }

    // Circle and Square are Shift-constrained outcomes, not dedicated tools.
    expect(within(menu).queryByRole('menuitemradio', { name: 'Circle Tool' })).toBeNull();
    expect(within(menu).queryByRole('menuitemradio', { name: 'Square Tool' })).toBeNull();

    const items = within(menu).getAllByRole('menuitemradio');
    expect(items[0]).toHaveAccessibleName('Rectangle Tool');
    expect(items[1]).toHaveAccessibleName('Ellipse Tool');
  });

  it('uses Rectangle as the default shape tile so the flyout starts with the base tools', () => {
    render(<SidebarLeft />);

    const rootButton = toolbarButtonByName('shape');
    expect(within(rootButton).getByText('Rectangle Tool')).toBeInTheDocument();

    act(() => {
      fireEvent.click(rootButton);
    });
    expect(goToTool).toHaveBeenCalledWith('shape');
    expect(patchToolArgs).not.toHaveBeenCalledWith('shape', { figure: 'circle' });
    expect(patchToolArgs).not.toHaveBeenCalledWith('shape', { figure: 'square' });
  });

  it.each(nonPrimaryCases)(
    'defaults to the first item (%s) as primary even when another group member is active',
    (activeTool, name, expectedPrimary) => {
      Object.assign(storeState, { toolName: activeTool });
      Object.assign(toolArgs, { toolName: activeTool, figure: undefined });
      render(<SidebarLeft />);

      const rootButton = toolbarButtonByName(name);
      expect(toolbarButtonByName(name)).toBeInTheDocument();

      act(() => {
        fireEvent.click(rootButton);
      });
      expect(goToTool).toHaveBeenCalledWith(expectedPrimary);
    }
  );
});
