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

describe('SidebarLeft tablet band', () => {
  useSidebarLeftHarness();

  beforeEach(() => setViewportWidth(DESKTOP_WIDTH, 800));
  afterEach(() => setViewportWidth(DESKTOP_WIDTH, 800));

  it('forces the one-column rail in the tablet band, whatever the desktop preference is', () => {
    render(<SidebarLeft />);

    // The user asked for two columns on desktop.
    act(() => {
      fireEvent.click(layoutToggle()!);
    });
    expect(sidebar()).toHaveStyle({ width: '108px' });

    // In the tablet band the 108px rail leaves the canvas 410px at 768px wide, so the
    // two-column choice does not exist there. The preference is not overwritten — the
    // effective layout is.
    act(() => {
      setViewportWidth(TABLET_WIDTH);
    });

    expect(sidebar()).toHaveStyle({ width: '56px' });
    expect(toolbar()).toHaveClass('w-14');
    expect(firstGroupList()).toHaveClass('grid-cols-1');
  });

  it('restores the desktop preference when the window widens back to desktop', () => {
    render(<SidebarLeft />);
    act(() => {
      fireEvent.click(layoutToggle()!);
    });

    act(() => setViewportWidth(TABLET_WIDTH));
    expect(sidebar()).toHaveStyle({ width: '56px' });

    act(() => setViewportWidth(DESKTOP_WIDTH));
    expect(sidebar()).toHaveStyle({ width: '108px' });
    expect(firstGroupList()).toHaveClass('grid-cols-2');
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
    act(() => {
      fireEvent.click(layoutToggle()!);
    });
    expect(sidebar()).toHaveStyle({ width: '108px' });

    for (const [width, expectedWidth] of [
      [767, '108px'], // below the mobile boundary: the user's preference applies
      [768, '56px'], // first tablet width: forced
      [1023, '56px'], // last tablet width: forced
      [1024, '108px'], // back to desktop: the preference applies again
    ] as const) {
      act(() => setViewportWidth(width));
      expect(sidebar()).toHaveStyle({ width: expectedWidth });
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

    // `h-full` on a child of a scroll container resolves against the container's own
    // height, which leaves the swatches unpainted at the bottom of a long rail.
    // `min-h-full` fills it when the rail is tall and grows past it when it is not.
    const content = sidebar().firstElementChild as HTMLElement;
    expect(content).toHaveClass('min-h-full');
    expect(content).not.toHaveClass('h-full');
  });
});
