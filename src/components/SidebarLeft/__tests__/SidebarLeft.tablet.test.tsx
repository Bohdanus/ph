import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setViewportWidth } from '../../../test/setup.ts';
import { useSidebarLeftHarness } from './harness.tsx';
import SidebarLeft from '../SidebarLeft.tsx';

const DESKTOP_WIDTH = 1280;
const TABLET_WIDTH = 900;

const sidebar = () => screen.getByTestId('left-sidebar');
const toolbar = () => screen.getByTestId('left-toolbar-tools');
const layoutToggle = () => screen.queryByTestId('toolbar-layout-toggle');

/** The `<ul>` grid that holds the tool groups: one per section, or a single two-column list. */
const firstGroupList = () => toolbar().querySelector('ul') as HTMLElement;

/**
 * Put the rail into the two-column desktop preference, whichever way the default currently
 * points. These tests are about the tablet band's override, not about the default, so reading
 * the toggle's own state and clicking only when needed keeps them honest: the setup used to
 * assume a one-column default and click once, which silently became a request for one column
 * the moment the default changed to two.
 *
 * The two-column state is asserted through the toggle and the GRID rather than a width. The
 * rail is a pixel narrower for a second column of labels nobody has room to read, and that is
 * the real reason the band forces one column — but the number moves with the tile size, and a
 * test that pinned `108px` broke on a design change that changed no behaviour.
 */
const preferTwoColumns = () => {
  const toggle = layoutToggle()!;
  if (toggle.getAttribute('aria-pressed') !== 'false') {
    act(() => {
      fireEvent.click(toggle);
    });
  }
  expect(toggle).toHaveAttribute('aria-pressed', 'false');
  expect(firstGroupList()).toHaveClass('grid-cols-2');
  expect(toolbar().querySelectorAll(':scope > ul')).toHaveLength(1);
};

/** The tablet band's effective layout, which is forced to one column whatever the preference. */
const expectOneColumnRail = () => {
  expect(firstGroupList()).toHaveClass('grid-cols-1');
  expect(toolbar().querySelectorAll(':scope > ul').length).toBeGreaterThan(1);
};

describe('SidebarLeft tablet band', () => {
  useSidebarLeftHarness();

  beforeEach(() => setViewportWidth(DESKTOP_WIDTH, 800));
  afterEach(() => setViewportWidth(DESKTOP_WIDTH, 800));

  it('forces the one-column rail in the tablet band, whatever the desktop preference is', () => {
    render(<SidebarLeft />);

    // The user asked for two columns on desktop.
    preferTwoColumns();

    // In the tablet band the two-column rail would cost the canvas a second column of
    // labels nobody has room to read, so the choice does not exist there. The preference is
    // not overwritten — the effective layout is.
    act(() => {
      setViewportWidth(TABLET_WIDTH);
    });

    expectOneColumnRail();
  });

  it('restores the desktop preference when the window widens back to desktop', () => {
    render(<SidebarLeft />);
    preferTwoColumns();

    act(() => setViewportWidth(TABLET_WIDTH));
    expectOneColumnRail();

    act(() => setViewportWidth(DESKTOP_WIDTH));
    expect(firstGroupList()).toHaveClass('grid-cols-2');
    expect(toolbar().querySelectorAll(':scope > ul')).toHaveLength(1);
  });

  it('hides the layout toggle in the tablet band instead of showing it inert', () => {
    render(<SidebarLeft />);
    expect(layoutToggle()).not.toBeNull();

    act(() => setViewportWidth(TABLET_WIDTH));
    expect(layoutToggle()).toBeNull();

    act(() => setViewportWidth(DESKTOP_WIDTH));
    expect(layoutToggle()).not.toBeNull();
  });

  it('uses the tablet rail at both edges of the band and the desktop rail outside it', () => {
    render(<SidebarLeft />);

    // Give the rail a two-column desktop preference first, otherwise every width agrees
    // and the test proves nothing.
    preferTwoColumns();

    for (const [width, inBand] of [
      [767, false], // below the mobile boundary: the user's preference applies
      [768, true], // first tablet width: forced
      [1023, true], // last tablet width: forced
      [1024, false], // back to desktop: the preference applies again
    ] as const) {
      act(() => setViewportWidth(width));
      if (inBand) expectOneColumnRail();
      else expect(firstGroupList()).toHaveClass('grid-cols-2');
    }
  });
});

describe('SidebarLeft owns its scrolling', () => {
  useSidebarLeftHarness();

  beforeEach(() => setViewportWidth(DESKTOP_WIDTH, 800));
  afterEach(() => setViewportWidth(DESKTOP_WIDTH, 800));

  /**
   * The rail holds 12 tool groups plus the colour swatches, roughly 840px of min-content,
   * inside the `1fr` row of a grid whose container is `height: 100%`. A `1fr` track is
   * `minmax(auto, 1fr)`, so the rail floors that row: the grid outgrows the viewport and
   * the bottom of the rail — the foreground/background swatches, and at shorter windows
   * the Text, Draw, Pen and Shape groups — lands below the fold.
   *
   * The page used to scroll, so it was reachable. Adding a global `overflow: hidden` to
   * `html, body, #root` removed that scroll and turned the overflow into unreachable
   * content with no scrollbar. The fix is not a global exception but the grid's own
   * contract: `min-h-0` lets the track shrink below min-content, and `overflow-y-auto`
   * gives the rail the scroll it now needs.
   */
  it('lets the rail shrink and scroll instead of flooring the grid row', () => {
    render(<SidebarLeft />);

    const rail = sidebar();
    expect(rail).toHaveClass('min-h-0');
    expect(rail).toHaveClass('overflow-y-auto');
    // `overscroll-contain` stops a rail scrolled to its end from chaining the gesture to
    // the page behind it.
    expect(rail).toHaveClass('overscroll-contain');
  });

  it('sizes the rail content to the rail, not to the viewport', () => {
    render(<SidebarLeft />);

    // `h-full`, and this is the change that made the overflow fit possible at all.
    //
    // It used to be `min-h-full`, deliberately: the rail scrolls, and `h-full` on a child of
    // a scroll container resolves against the container's own height, which left the colour
    // swatches unpainted at the bottom of a long rail. That reasoning was sound and it has
    // stopped applying, because nothing in the rail is long any more — the tiles are fitted
    // to the space they have and the rest move into the three-dots tile.
    //
    // A flex column sized by its CONTENT has no height for `flex-1` to divide. The tools slot
    // would be handed whatever the tiles happened to need, so the fit would measure its own
    // output, agree with it, and never collapse anything. Sizing the column to the rail makes
    // the slot the leftover after the chrome, which is a number nothing inside the slot can
    // influence — which is the entire precondition for the rule being able to mean anything.
    const content = sidebar().firstElementChild as HTMLElement;
    expect(content).toHaveClass('h-full');
    expect(content).not.toHaveClass('min-h-full');

    // And the slot that carries the tiles is a shrinkable, scrollable leftover rather than a
    // box that grows with them — which is the part that actually bounds the fit.
    const slot = screen.getByTestId('left-toolbar-slot');
    expect(slot).toHaveClass('flex-1');
    expect(slot).toHaveClass('min-h-0');
    // `auto` and not `hidden`: a rail that clipped a misjudged tile would have made it
    // unreachable, and a scroll is a way back.
    expect(slot).toHaveClass('overflow-y-auto');
    expect(slot).not.toHaveClass('overflow-hidden');
  });
});
