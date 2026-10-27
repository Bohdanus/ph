import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { toolbarMap } from '../../../../toolbar-mapping.ts';
import { toolbarButtonByName, longPress, useSidebarLeftHarness } from './harness.tsx';
import SidebarLeft from '../SidebarLeft.tsx';

/**
 * The hold the app arms on `pointerdown`, read from the component rather than restated, so
 * this suite cannot open a flyout the app has not opened yet.
 *
 * The advance stops AT the threshold, not past it: the timer fires on that tick, so the
 * smallest advance that opens the menu is also the one that proves the app's own number
 * opens it. The trailing click is delivered on purpose — it is the click `onPointerUp`
 * marks to be ignored, so the menu is still open when the assertion reads it.
 */
/**
 * The rail's declared width in rem, from its inline style.
 *
 * `getBoundingClientRect` is zero for every box in jsdom, so this is the only width a unit
 * test can read. Both layouts declare rem, so the magnitudes are comparable; a layout that
 * declared px would make the comparison meaningless, which is the trade this helper names
 * rather than hides.
 */
const declaredRailWidthRem = (sidebar: HTMLElement): number => {
  const declared = sidebar.style.width;
  const magnitude = Number.parseFloat(declared);
  expect(declared, 'the rail declares its width in rem, which is what makes two of them comparable').toMatch(/rem$/);
  return magnitude;
};

/**
 * The text of a control, as a reader receives it.
 *
 * `textContent` rather than a character class, because the glyph is wrapped in a decorative
 * `aria-hidden` span inside the button, so this is what ends up on screen and nothing else about
 * the control states a direction.
 */
const glyphOf = (button: HTMLElement): string => button.textContent?.trim() ?? '';

describe('SidebarLeft layout toggle', () => {
  useSidebarLeftHarness();
  it('starts in one column, and the toggle reaches the two-column rail', () => {
    render(<SidebarLeft />);

    const toggle = screen.getByTestId('toolbar-layout-toggle');
    const toolbar = screen.getByTestId('left-toolbar-tools');
    const sidebar = screen.getByTestId('left-sidebar');
    const oneColumnWidth = declaredRailWidthRem(sidebar);
    const getPrimaryNames = () =>
      [...toolbar.querySelectorAll<HTMLButtonElement>(':scope > ul > li > button')].map((button) =>
        button.dataset.testid?.replace('tool-button-', '')
      );
    const oneColumnOrder = getPrimaryNames();

    // ONE COLUMN IS THE DEFAULT, because that is Photoshop's default: the double-chevron at
    // the top of the Tools panel switches to two columns to save vertical room, which only
    // means anything if one column is where you start.
    //
    // Every assertion below is about the LAYOUT: the toggle's own state, the number of
    // section lists, the grid's track count, and the fact that one column is narrower than
    // two. What is deliberately absent is the rail's width in ABSOLUTE terms — neither as the
    // utility that spells it (`w-14` is a name the stylesheet can change) nor as a pixel count
    // (`56px` is a number a design change moves without the layout behaving differently at
    // all). Pinning those made a one-column default cost five assertions and a rail width cost
    // five more, none of which described anything a user can see. `grid-cols-1`/`grid-cols-2`
    // survive that rule because a track count is the layout's own shape rather than a size,
    // and the width at the bottom is compared as a relation for the same reason.
    expect(toggle).toHaveAttribute('aria-label', 'Use two-column toolbar');
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    // THE GLYPH, because it is the one thing on this control a user reads and nothing else here
    // does. It points the way the rail is about to MOVE, which is why one column shows `»`: a
    // second column grows to the right. It was the other way round — one column showed `«`, which
    // says "press me and the rail moves left" — and no assertion in this repository noticed, which
    // is what a character in a JSX span is worth. Photoshop's own mapping is the same: the Tools
    // panel's double chevrons face right in one column and left once the toolbar is two columns.
    expect(glyphOf(toggle), 'one column: the chevrons point the way pressing this grows the rail').toBe('»');
    // One `<ul>` per toolbar section; the two-column rail interleaves them into one grid.
    expect(toolbar.querySelectorAll(':scope > ul')).toHaveLength(toolbarMap.length);
    expect(toolbar.querySelector('ul')).toHaveClass('grid-cols-1');

    act(() => {
      fireEvent.click(toggle);
    });

    expect(toggle).toHaveAttribute('aria-label', 'Use one-column toolbar');
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(glyphOf(toggle), 'two columns: and now the other way, because the rail shrinks back').toBe('«');
    expect(toolbar.querySelector('ul')).toHaveClass('grid-cols-2');
    expect(toolbar.querySelectorAll(':scope > ul')).toHaveLength(1);

    // The point of two columns, stated as the relation it exists to produce: the same tools
    // in less height, bought with width — which is the whole reason the toggle is there, and
    // the reason the tablet band refuses it.
    //
    // Read from the rail's DECLARED width rather than a measured one, because jsdom has no
    // layout and every rect is zeroed — a measured comparison here passes on `0 > -1` and
    // proves nothing. Both widths are in rem, so comparing the magnitudes compares the
    // widths; the assertion is deliberately the relation and not either value, because the
    // absolute rem is a design number and "two columns is wider" is the behaviour.
    const twoColumnWidth = declaredRailWidthRem(sidebar);
    expect(twoColumnWidth, 'two columns is wider than one, not narrower').toBeGreaterThan(oneColumnWidth);
    // And the tool order is untouched by the layout, which is what makes the toggle a
    // preference rather than a rearrangement.
    expect(getPrimaryNames()).toEqual(oneColumnOrder);
  });

  it('renders the rail as ONE flat panel, with no padding around the tools', () => {
    render(<SidebarLeft />);

    const sidebar = screen.getByTestId('left-sidebar');
    // The slot's parent, NOT the aside's first child: a re-dock renders `rail-drop-line` as
    // the first child of the aside, so a first-child read silently starts asserting the drop
    // line's classes, which have neither `px-3` nor `py-4`, and the test passes on any rail.
    // This test does not itself open a re-dock, so that state is not exercised here — the
    // read is chosen because the drop line is a SIBLING of the column, not an ancestor of it,
    // so it is the column either way.
    const column = screen.getByTestId('left-toolbar-slot').parentElement as HTMLElement;
    const tools = screen.getByTestId('left-toolbar-tools');

    // THE THING THIS FILE EXISTS TO PROTECT. The rail used to draw a framed panel inside
    // itself — a second fill, a border, a radius, an inset shadow and 6px of padding — so the
    // tools read as a small card floating in a wider grey column rather than as tiles on a
    // panel.
    //
    // This matches the SHAPE of a decoration, not the spellings that were there before. A list
    // of the old class names would pass on a rail reframed with `ring-1 rounded-md p-1
    // bg-gray-200/50` and looking exactly as card-like as it did before, which is the whole
    // failure the assertion is for. A prefix match is what the claim actually is.
    //
    // Three holes a naive prefix match leaves open, all closed here: a VARIANT (`dark:`,
    // `hover:`, `focus:`) is stripped first, because the old framing's dark half is exactly as
    // card-like as its light half and would otherwise sail through; `bg-transparent` is not a
    // second fill; and `inset-*` is a positioning utility, not an inner shadow, so flagging it
    // would fail a test for positioning a child.
    const frameTokens = (tools.getAttribute('class') ?? '')
      .split(/\s+/)
      .filter(Boolean)
      .map((token) => token.replace(/^(?:dark|hover|focus|active|group-hover|peer-focus):/, ''))
      .filter((token) => token !== 'bg-transparent')
      .filter((token) => /^(border|rounded|shadow|ring|outline|p-|ps-|pe-|px-|py-|pt-|pr-|pb-|pl-|bg-)/.test(token));
    expect(frameTokens, 'the tools sit on the panel, not inside a second framed, filled or padded surface').toEqual([]);

    // The width is the one thing the box must keep, because the box being exactly the rail's
    // width is what puts its content flush to both edges — and a narrower box would re-open
    // the gap this test is about. Read through the helper, which guards that the rail still
    // declares rem: a bare `parseFloat` of a px width would pick the wrong class and fail on
    // the class instead of on the reason.
    expect(tools).toHaveClass(declaredRailWidthRem(sidebar) === 3.5 ? 'w-14' : 'w-[6.75rem]');

    // No horizontal padding on the column, and half the vertical padding it used to have: the
    // column declares `py-2` where it used to declare `py-4`, and the assertion is on the
    // `py-4` that must not come back rather than on the `py-2`. The horizontal half was
    // provably inert: the tools box is as wide as the rail, so a padded, centred child
    // overflows symmetrically and the padding moves nothing — it only ever squeezed the header
    // row. What is left is what it costs: `py-4` spent 32px of window on air above and below
    // the rail's only content, and the slot is `flex-1`, so that padding is a direct term in
    // the fit's `availableHeight`.
    expect(column, 'the horizontal padding moved no box and only squeezed the header').not.toHaveClass('px-3');
    expect(column, '32px of vertical air is a real cost on the axis the fit measures').not.toHaveClass('py-4');

    // And the tiles are centred in what is left of the track, so removing the box's padding
    // did not leave them hard against one edge.
    expect(tools.querySelector('ul')).toHaveClass('justify-items-center');
  });

  it('closes any open flyout when toggling layout', () => {
    vi.useFakeTimers();
    render(<SidebarLeft />);

    longPress(toolbarButtonByName('brush'));
    expect(screen.getByRole('menu')).toBeInTheDocument();

    act(() => {
      fireEvent.click(screen.getByTestId('toolbar-layout-toggle'));
    });
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
