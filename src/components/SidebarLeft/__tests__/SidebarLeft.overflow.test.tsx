import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toolbarMap, type ToolbarTool } from '../../../../toolbar-mapping.ts';
import { goToTool, useSidebarLeftHarness } from './harness.tsx';
import SidebarLeft from '../SidebarLeft.tsx';

/**
 * What the rail looks like at a given tool-slot height.
 *
 * The behaviour under test is entirely a function of ONE measurement — how tall the slot
 * the tiles live in is — so the harness is a single number and a prototype spy that answers
 * it. A spy rather than per-element assignment because the set of tiles changes with the
 * plan: at a height that collapses everything, the three-dots tile is the only tile left,
 * and an element-by-element stub installed before the collapse would have left the one tile
 * that re-measures the rail unstubbed. That is not hypothetical in jsdom — the tile would
 * measure zero, the plan would read "nothing measurable", every tile would come back, and
 * the next measure would collapse them again.
 *
 * The spy delegates for everything that is not a tile or the slot, so `AnchoredOverlay`'s
 * own measurement — which needs real boxes — is untouched.
 */
const TILE_HEIGHT = 44;
const SLOT_WIDTH = 56;

type Geometry = { slotHeight: number };

const geometry: Geometry = { slotHeight: Number.NaN };

const rect = (width: number, height: number, top: number) =>
  ({
    x: 0,
    y: top,
    top,
    left: 0,
    right: width,
    bottom: top + height,
    width,
    height,
    toJSON: () => ({}),
  }) as DOMRect;

const installGeometry = (): void => {
  const original = Element.prototype.getBoundingClientRect;
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    if (this.getAttribute('data-testid') === 'left-toolbar-slot') {
      return rect(SLOT_WIDTH, geometry.slotHeight, 100);
    }
    if (this.hasAttribute('data-toolbar-tile')) return rect(TILE_HEIGHT, TILE_HEIGHT, 100);
    return original.call(this);
  });
};

/**
 * A controllable `ResizeObserver`, standing in for the browser's.
 *
 * The fit re-measures when the slot resizes and for no other reason, so a test that changed
 * the geometry and then re-rendered would be testing a path that does not exist — the real
 * one is a notification from the observer, and the jsdom polyfill never fires. Firing it by
 * hand exercises the actual path: `publish` re-measures, compares, bumps the version, and
 * notifies, and React re-renders because the snapshot changed.
 */
class ManualResizeObserver {
  static instances: ManualResizeObserver[] = [];

  /**
   * Public and declared as a field rather than a constructor parameter property, because
   * `erasableSyntaxOnly` is on in this project and a parameter property does not erase.
   */
  readonly callback: () => void;

  constructor(callback: () => void) {
    this.callback = callback;
    ManualResizeObserver.instances.push(this);
  }

  observe(target: Element) {
    this.targets.add(target);
  }

  unobserve(target: Element) {
    this.targets.delete(target);
  }

  disconnect() {
    this.targets.clear();
    ManualResizeObserver.instances = ManualResizeObserver.instances.filter((one) => one !== this);
  }

  readonly targets = new Set<Element>();
}

const flushObservers = (): void => {
  for (const observer of [...ManualResizeObserver.instances]) observer.callback();
};

/**
 * Set the slot height the way the browser would: the layout changed, the observer fires,
 * the rail refits. No re-render is requested, because nothing outside the rail changed.
 */
const setSlotHeight = (slotHeight: number): void => {
  act(() => {
    geometry.slotHeight = slotHeight;
    flushObservers();
  });
};

/** The tool tiles currently on the rail, in the order the rail renders them. */
const visibleTools = (): string[] =>
  Array.from(
    screen.getByTestId('left-toolbar-tools').querySelectorAll<HTMLButtonElement>('[data-testid^="tool-button-"]')
  ).map((button) => button.dataset.testid!.replace('tool-button-', ''));

/**
 * Every tool in the toolbar map, flattened.
 *
 * `toolbarMap` is groups-of-groups: a section is a `ToolbarToolGroup[]` and a group is a
 * `ToolbarTool[]`, so flattening one level lands on the GROUPS and not the tools. The first
 * version of this returned 16 — the group count — and compared it against a 40-tool flyout,
 * which is a difference in depth rather than a defect in the rail.
 */
const allTools = (): ToolbarTool[] => toolbarMap.flat(2);

/**
 * How many TOOLS the tiles on the rail account for, not how many tiles there are.
 *
 * A tile is a group, and a group holds a primary plus its nested tools — so "four tiles" is
 * eight tools. Comparing a tile count against the map's tool total is the arithmetic that made
 * this test fail for a reason that had nothing to do with the rule: the two numbers are in
 * different units, and the unit the contract is written in is tools. Matching a tile back to
 * its group is by the primary's name, which is the test id; two groups sharing a primary name
 * would double-count here, and that is a defect in the map this test would be right to fail on.
 */
const toolsOnTiles = (): number => {
  const primaries = new Set(visibleTools());
  return toolbarMap
    .flat()
    .filter((group) => primaries.has(group[0].name))
    .reduce((total, group) => total + group.length, 0);
};

const overflowTile = () => screen.queryByTestId('tool-overflow-tile');

/**
 * Open the three-dots flyout the way a user does, and return its item labels.
 *
 * `contextMenu` rather than the long press, because it reaches the same `openFlyout` in one
 * event and leaves no timer running — which is also why this needs no fake timers. The
 * long-press path into the very same `openFlyout` is covered by `SidebarLeft.flyout.test.tsx`.
 */
const openOverflowFlyout = (): string[] => {
  act(() => {
    fireEvent.contextMenu(overflowTile()!);
  });
  return screen.getAllByRole('menuitemradio').map((item) => item.getAttribute('aria-label') ?? '');
};

describe('SidebarLeft overflow', () => {
  useSidebarLeftHarness();

  beforeEach(() => {
    geometry.slotHeight = Number.NaN;
    ManualResizeObserver.instances = [];
    vi.stubGlobal('ResizeObserver', ManualResizeObserver);
    installGeometry();
  });

  afterEach(() => {
    // `unstubGlobals` as well as `restoreAllMocks`: the geometry is a `spyOn` and the
    // observer is a `stubGlobal`, and leaving the observer installed would let a later test
    // in this file believe a re-measure had fired when it had not.
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('shows every tool when the rail is tall enough, and no three-dots tile at all', () => {
    render(<SidebarLeft />);
    setSlotHeight(2000);

    // Sixteen groups of 44px with no room lost to a gap: a tall slot fits all of them, and
    // a three-dots tile with nothing in it is noise, so it is not rendered.
    expect(visibleTools()).toHaveLength(toolbarMap.flat().length);
    expect(overflowTile()).toBeNull();
  });

  it('moves the tiles that do not fit into a three-dots tile, and only those', () => {
    render(<SidebarLeft />);
    setSlotHeight(2000);
    const before = visibleTools();

    // Five rows at 44px. The plan renders exactly the rows the budget holds and makes the
    // LAST of them the three-dots tile, so four tool rows survive out of sixteen.
    setSlotHeight(300);

    const after = visibleTools();
    expect(after).toHaveLength(4);
    // A PREFIX of the list, from the top: the top of a tool rail is the most-used end, and a
    // collapse that made holes would move tools around under the user's cursor.
    expect(after).toEqual(before.slice(0, 4));
    expect(overflowTile(), 'the tile appears exactly when it has something to hold').not.toBeNull();
  });

  it('keeps every tool reachable through the three-dots tile, nested ones included', () => {
    render(<SidebarLeft />);
    setSlotHeight(300);

    const items = openOverflowFlyout();

    // Every tool that lost its tile is in the flyout, INCLUDING the ones nested inside a
    // collapsed group. A flyout listing one entry per collapsed GROUP would put the Pencil
    // and the Eraser out of reach for as long as the window is short, which is the defect
    // the two-column rail exists to avoid and the three-dots tile must not reintroduce.
    for (const label of ['Eyedropper Tool', 'Brush Tool', 'Pencil Tool', 'Eraser Tool', 'Horizontal Type Tool']) {
      expect(items, `${label} must be reachable from the three-dots tile`).toContain(label);
    }
    // And nothing that still has a tile is offered again — a tool with two ways in is a tool
    // whose identity is ambiguous.
    expect(items).not.toContain('Move Tool');
    expect(items).not.toContain('Magic Wand Tool');

    // Every tool in the map is reachable from EITHER a tile or the flyout, and from exactly
    // one of them. That is the whole contract the feature exists to keep, so it is stated as
    // the arithmetic rather than left to the two assertions above.
    const inFlyout = openOverflowFlyout().length;
    expect(toolsOnTiles() + inFlyout, 'every tool is reachable exactly once').toBe(allTools().length);
  });

  it('selects a tool from the three-dots tile', () => {
    render(<SidebarLeft />);
    setSlotHeight(300);
    openOverflowFlyout();

    act(() => {
      fireEvent.click(screen.getByTestId('tool-flyout-item-pencil-pencil-tool'));
    });

    expect(goToTool).toHaveBeenCalledWith('pencil');
  });

  it('does not rewrite its own identity when a tool is picked from it', () => {
    render(<SidebarLeft />);
    setSlotHeight(300);
    openOverflowFlyout();

    act(() => {
      fireEvent.click(screen.getByTestId('tool-flyout-item-pencil-pencil-tool'));
    });

    // The tile is the three-dots tile before the pick and after it. A tile that adopted the
    // picked tool's icon would be a Brush tile wearing a Pencil, and the promotion it
    // performs belongs to the Brush GROUP's own tile.
    expect(screen.getByTestId('tool-overflow-tile')).toHaveAttribute('aria-label', 'More Tools');
  });

  it('restores the tiles when the rail grows back', () => {
    render(<SidebarLeft />);
    setSlotHeight(300);
    expect(overflowTile()).not.toBeNull();

    setSlotHeight(2000);

    expect(overflowTile()).toBeNull();
    expect(visibleTools()).toHaveLength(toolbarMap.flat().length);
  });

  it('closes an open flyout whose tile the collapse swallows', () => {
    render(<SidebarLeft />);
    setSlotHeight(2000);

    // The Pen tile: a group of six, so it HAS a flyout to open, unlike the single-tool tiles
    // where `contextMenu` is a no-op. It also sits far enough down that a 300px slot swallows it.
    act(() => {
      fireEvent.contextMenu(screen.getByTestId('tool-button-pen'));
    });
    expect(screen.getByRole('menu')).toBeInTheDocument();

    setSlotHeight(300);

    // The tile unmounted with the menu, and `openGroup` no longer names a rendered group — so
    // the flyout cannot reappear by itself when the window grows back.
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.queryByTestId('tool-button-pen')).toBeNull();

    setSlotHeight(2000);
    expect(screen.getByTestId('tool-button-pen')).toBeInTheDocument();
    expect(screen.queryByRole('menu'), 'the flyout must not reopen by itself').toBeNull();
  });

  it('reaches every tool from exactly one of a tile or the three-dots tile, at every slot height', () => {
    // The property the whole feature exists to keep, swept rather than sampled at a height
    // somebody chose. The arithmetic is exact: a tile is a group's primary, the flyout lists
    // every tool of a collapsed group including that primary, so the tools the tiles account
    // for plus the flyout entries must equal the map's total at every height. Too few means a
    // tool is unreachable; too many means one is reachable twice and its identity is ambiguous.
    const toolCount = allTools().length;

    for (const slotHeight of [120, 200, 300, 500, 700, 1200]) {
      const { unmount } = render(<SidebarLeft />);
      setSlotHeight(slotHeight);

      const inFlyout = overflowTile() === null ? 0 : openOverflowFlyout().length;

      expect(toolsOnTiles() + inFlyout, `tools reachable at ${slotHeight}px of slot`).toBe(toolCount);
      unmount();
    }
  });

  it('bounds the three-dots menu to the window and lets it scroll', () => {
    // The defect this pins: a menu as tall as its contents, in a `position: fixed` overlay
    // that clamps POSITION and never size. Thirty-odd tools is about 1374px of menu in a
    // 720px window, so the clamp resolved to the top padding, the menu started at the
    // viewport's top edge and ran off the bottom, and there was no ancestor to scroll — the
    // tail of the list was off-screen and unreachable with nothing in the DOM to say so.
    // That defeats the whole point of a tile whose only job is to keep tools reachable.
    //
    // The class is the contract jsdom can see; whether the scroll actually works is an
    // e2e question, and `e2e/toolbar-overflow.spec.ts` asks it by reaching the LAST item.
    render(<SidebarLeft />);
    setSlotHeight(300);
    openOverflowFlyout();

    const menu = screen.getByRole('menu');
    expect(menu, 'the menu is bounded by the window, not by its contents').toHaveClass('max-h-[calc(100vh-1rem)]');
    expect(menu, 'and scrolls inside that bound').toHaveClass('overflow-y-auto');
    // `overscroll-contain` so reaching the end of a long menu does not start scrolling the
    // page behind it, which is the same trap the rail's own scroll container had.
    expect(menu).toHaveClass('overscroll-contain');
  });

  it('does not depend on the window, only on the slot it is given', () => {
    // READINESS FOR A MOVABLE PANEL, asserted rather than promised.
    //
    // A left panel the user can drag off the left edge and resize will not be a grid cell
    // filling a row: it will be a floating element with a height of its own. The one thing
    // that must survive that is this rule, because it is the only part of the rail that
    // reacts to height at all. It is written against the slot — the element the tiles live
    // in — and never against `innerHeight`, `documentElement.clientHeight` or the rail's own
    // box, so a panel that is given a height uses the same code path a docked one does.
    const { rerender } = render(<SidebarLeft />);
    setSlotHeight(300);
    const collapsed = visibleTools();
    expect(collapsed).toHaveLength(4);

    // A different window at the same slot height changes nothing, which is exactly what a
    // panel that is no longer the window's child would do: the same slot, a different page
    // around it. Nothing here reads the window, so a re-render at a new height is inert.
    const previousHeight = window.innerHeight;
    act(() => {
      window.innerHeight = previousHeight - 400;
      rerender(<SidebarLeft />);
    });
    expect(visibleTools(), 'a shorter window with the same slot must not change the fit').toEqual(collapsed);

    act(() => {
      window.innerHeight = previousHeight;
      rerender(<SidebarLeft />);
    });
    expect(visibleTools()).toEqual(collapsed);
  });
});
