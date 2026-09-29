import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { setViewportWidth } from '../../../test/setup.ts';
import SidebarLeft from '../SidebarLeft.tsx';

const goToTool = vi.fn();
const patchToolArgsMock = vi.fn();

const storeStateRef = vi.hoisted(() => ({
  toolName: 'draw',
  color: '#000000',
  backgroundColor: '#ffffff',
  hasImage: true,
  dispatch: vi.fn(),
}));

const toolArgsRef = vi.hoisted(() => ({
  toolName: 'draw' as string,
  figure: undefined as string | undefined,
}));

vi.mock('../../../contexts/StoreContext.tsx', () => ({
  useStore: () => [storeStateRef, storeStateRef.dispatch],
}));

vi.mock('../../../hooks/useApp.ts', () => ({
  useApp: () => ({ goToTool }),
}));

vi.mock('../../../contexts/useCurrentTool.tsx', () => ({
  useCurrentTool: () => ({
    toolArgs: toolArgsRef,
    patchToolArgs: patchToolArgsMock,
  }),
}));

vi.mock('../toolIcons.tsx', () => {
  const Icon = ({ title }: { title: string }) => <svg aria-hidden="true">{title}</svg>;

  return {
    toolIcons: {
      reposition: Icon,
      'rectangular-selection': Icon,
      'elliptical-selection': Icon,
      'freehand-lasso': Icon,
      'polygonal-lasso': Icon,
      'feather-magnetic-lasso': Icon,
      'magic-wand': Icon,
      'quick-selection': Icon,
      eyedropper: Icon,
      eraser: Icon,
      'clone-stamp': Icon,
      'paint-bucket': Icon,
      gradient: Icon,
      sharpen: Icon,
      smudge: Icon,
      dodge: Icon,
      burn: Icon,
      crop: Icon,
      draw: Icon,
      shape: Icon,
      text: Icon,
      color: Icon,
      blur: Icon,
      levels: Icon,
      transform: Icon,
      brush: Icon,
      pencil: Icon,
      'color-replacement': Icon,
      'magic-eraser': Icon,
      pen: Icon,
      'freeform-pen': Icon,
      'curvature-pen': Icon,
      'add-anchor-point': Icon,
      'delete-anchor-point': Icon,
      'convert-point': Icon,
      rectangle: Icon,
      ellipse: Icon,
      triangle: Icon,
      polygon: Icon,
      line: Icon,
      'custom-shape': Icon,
    },
  };
});

const DESKTOP_WIDTH = 1280;
const DESKTOP_HEIGHT = 800;
// The first width inside `TABLET_MEDIA_QUERY`, so the rail switches to its one-column
// layout and every group key changes with it.
const TABLET_WIDTH = 900;
// The first width inside `MOBILE_MEDIA_QUERY`, where the rail is hidden outright rather than
// restyled. Nothing about the menu's own placement changes, because it is portalled to the
// body and the hiding is a class on the rail.
const MOBILE_WIDTH = 600;

/** A rail tile: the `<li>` a flyout is anchored to is 56px wide, as a real tile is. */
const TILE_WIDTH = 56;
const TILE_HEIGHT = 44;
/** `AnchoredOverlay`'s default gap, in its own right. */
const FLYOUT_GAP = 8;

/** Each tile is given a distinct x, so the overlay's placement names the tile it measured. */
const TILE_STEP = 60;
/**
 * … and a distinct y, for the same reason on the axis that actually failed in a real
 * browser: with every tile at `top: 0` the vertical placement was degenerate, and a tall
 * menu anchored to the WRONG tile's top edge ran off the bottom of the window while still
 * being correct on x. One tile height per group keeps the deepest of the sixteen inside the
 * 720px layout viewport, so the expectation below is the placement and not the clamp.
 */
const TILE_ROW_STEP = TILE_HEIGHT;

/** The rail's own width, which is the horizontal anchor a flyout now hangs from. */
const RAIL_WIDTH = 108;

const toolbarButtonByName = (name: string) => screen.getByTestId(`tool-button-${name}`);

/** The flyout for a tool group, by the `aria-label` the group renders it with. */
const menuByName = (name: string) => screen.queryByRole('menu', { name });

/**
 * `onContextMenu` rather than the long press, because it reaches the same `openFlyout` in
 * one event and leaves no timer running across an assertion. The long-press path is
 * covered by `SidebarLeft.flyout.test.tsx`.
 */
const openFlyout = (tile: HTMLElement): void => {
  act(() => {
    fireEvent.contextMenu(tile);
  });
};

/** The wrapper `AnchoredOverlay` positions, portalled into `document.body`. */
const overlayWrapper = (): HTMLElement => screen.getByRole('menu').parentElement as HTMLElement;

const tileRect = (left: number, top: number, width = TILE_WIDTH): DOMRect =>
  ({
    left,
    top,
    width,
    height: TILE_HEIGHT,
    right: left + width,
    bottom: top + TILE_HEIGHT,
    x: left,
    y: top,
    toJSON: () => ({}),
  }) as DOMRect;

/**
 * jsdom has no layout engine, so every box is zeroed and the overlay's placement — the only
 * observable that says WHICH tile a flyout is measured against — is collapsed to the viewport
 * padding for all of them. Each tool group's `<li>` is therefore given a distinct x AND a
 * distinct y, and `AnchoredOverlay` is placed at `anchorRight + gap` and `anchorTop`, which
 * names the anchor in both results.
 *
 * The stub is installed on the elements themselves rather than on the prototype, so it does
 * not reach anything else in the suite, and it has to be installed after the render and
 * before the flyout mounts: the overlay measures its anchor in a layout effect on mount.
 *
 * EVERY `<ul>` is walked, not just the first. The one-column rail renders one `<ul>` per
 * toolbar section, so reading `querySelector('ul')` used to hand back section 0's tiles and
 * nothing else: `boxOf('shape')` came back `undefined` and the placement assertion compared
 * against `NaN`, which fails loudly. The louder failure is the lucky case — a reader who had
 * stubbed a `<ul>` holding every tile, and a reader who had not, differ only in which
 * assertions degrade to `not.toBe` rather than in which tiles are stubbed at all. A missing
 * entry is also invisible in the positive direction: `undefined !== number` fails, but a stub
 * that never saw the tile cannot fail at all.
 *
 * The returned reader maps a tile button to the box its group was given, so a test can state
 * the placement as "beside THAT tile" instead of a magic number.
 */
const stubTileBoxes = (): ((tile: HTMLElement) => { left: number; top: number }) => {
  const groups = Array.from(screen.getByTestId('left-toolbar-tools').querySelectorAll('ul > li')) as HTMLElement[];
  const boxByGroup = new Map<HTMLElement, { left: number; top: number }>();

  groups.forEach((group, index) => {
    const left = index * TILE_STEP;
    const top = index * TILE_ROW_STEP;
    boxByGroup.set(group, { left, top });
    group.getBoundingClientRect = () => tileRect(left, top);
  });

  // The rail is the HORIZONTAL anchor: a flyout hangs off the panel's edge rather than off a
  // tile's, because the tiles sit on a 108px grid inside a narrower content box and a
  // second-column tile can start past the rail's own right edge — which would put the flyout
  // back over the rail's first column. jsdom measures the rail as nothing, so it is stubbed
  // here for the same reason the tiles are.
  screen.getByTestId('left-sidebar').getBoundingClientRect = () => tileRect(0, 0, RAIL_WIDTH);

  // The tile button is wrapped in the tooltip's own span, so the anchor is the group `<li>`
  // above it rather than its direct parent.
  return (tile) => boxByGroup.get(tile.closest('li') as HTMLElement)!;
};

/**
 * `AnchoredOverlay` clamps against `documentElement.client*`, which jsdom reports as 0 for
 * every box. Left at 0 the clamp collapses to the viewport padding on every placement, so
 * the clamp is measured against a real viewport here — see `AnchoredOverlay.test.tsx` for the
 * same reason.
 */
const setLayoutViewport = (width: number, height: number): void => {
  Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: width });
  Object.defineProperty(document.documentElement, 'clientHeight', { configurable: true, value: height });
};

const resetMocks = () => {
  goToTool.mockReset();
  Object.assign(toolArgsRef, { toolName: 'draw', figure: undefined });
  Object.assign(storeStateRef, {
    hasImage: true,
    toolName: 'draw',
    color: '#000000',
    backgroundColor: '#ffffff',
  });
  storeStateRef.dispatch.mockClear();
  patchToolArgsMock.mockClear();
};

const cleanupTimers = () => {
  vi.clearAllTimers();
  vi.useRealTimers();
};

describe('SidebarLeft flyout hardening', () => {
  beforeEach(() => {
    resetMocks();
    setViewportWidth(DESKTOP_WIDTH, DESKTOP_HEIGHT);
    setLayoutViewport(DESKTOP_WIDTH, 720);
  });

  afterEach(() => {
    cleanupTimers();
    setViewportWidth(DESKTOP_WIDTH, DESKTOP_HEIGHT);
  });

  it('closes an open flyout on Tab, so the menu cannot outlive the focus that opened it', () => {
    render(<SidebarLeft />);
    openFlyout(toolbarButtonByName('brush'));
    expect(menuByName('Brush Tool tools')).not.toBeNull();

    const menu = screen.getByRole('menu');
    act(() => {
      fireEvent.keyDown(menu, { key: 'Tab' });
    });

    expect(screen.queryByRole('menu')).toBeNull();
    // Leaving the menu is not selecting anything: the flyout is a pointer menu first.
    expect(goToTool).not.toHaveBeenCalled();
  });

  it('keeps the flyout open and moves focus with ArrowDown and ArrowUp', () => {
    render(<SidebarLeft />);
    openFlyout(toolbarButtonByName('brush'));

    const items = screen.getAllByRole('menuitemradio');
    expect(items.length).toBeGreaterThanOrEqual(2);
    const menu = screen.getByRole('menu');

    items[0].focus();
    act(() => {
      fireEvent.keyDown(menu, { key: 'ArrowDown' });
    });
    expect(items[1]).toHaveFocus();
    expect(screen.getByRole('menu')).toBe(menu);

    act(() => {
      fireEvent.keyDown(menu, { key: 'ArrowUp' });
    });
    expect(items[0]).toHaveFocus();
    expect(screen.getByRole('menu')).toBe(menu);
  });

  it('closes an open flyout on Escape without selecting a tool', () => {
    render(<SidebarLeft />);
    openFlyout(toolbarButtonByName('brush'));
    expect(menuByName('Brush Tool tools')).not.toBeNull();

    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });

    expect(screen.queryByRole('menu')).toBeNull();
    expect(goToTool).not.toHaveBeenCalled();
  });

  it('closes an open flyout on a click outside the rail', () => {
    render(<SidebarLeft />);
    openFlyout(toolbarButtonByName('brush'));
    expect(menuByName('Brush Tool tools')).not.toBeNull();

    act(() => {
      fireEvent.click(document.body);
    });

    expect(screen.queryByRole('menu')).toBeNull();
  });

  /**
   * The flyout is portalled into `document.body`, so a click on it is not inside the `<li>`
   * that holds the tile and the outside-click handler has to recognise it by its own
   * attribute. Clicking the menu's own padding is the case where the target is the `<ul>`
   * itself, which is why the handler resolves `closest()` rather than a ref to the list.
   */
  it('keeps the flyout open when the click lands inside the menu but not on an item', () => {
    render(<SidebarLeft />);
    openFlyout(toolbarButtonByName('brush'));
    const menu = screen.getByRole('menu');

    act(() => {
      fireEvent.click(menu);
    });

    expect(screen.getByRole('menu')).toBe(menu);
    expect(goToTool).not.toHaveBeenCalled();
    expect(patchToolArgsMock).not.toHaveBeenCalled();
  });

  it('anchors the next group flyout to its own tile after the previous one closed', () => {
    render(<SidebarLeft />);
    // Tall enough that neither group's top is clamped. `AnchoredOverlay` clamps a placement
    // that would run past the viewport, and a clamp would move the flyout's top onto a value
    // that names no tile at all — which is exactly the assertion this test makes.
    setLayoutViewport(1280, 4000);
    const boxOf = stubTileBoxes();

    const brushTile = toolbarButtonByName('brush');
    openFlyout(brushTile);
    expect(menuByName('Brush Tool tools')).not.toBeNull();

    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    expect(screen.queryByRole('menu')).toBeNull();

    const shapeTile = toolbarButtonByName('shape');
    openFlyout(shapeTile);

    expect(menuByName('Shape tools')).not.toBeNull();
    expect(menuByName('Brush Tool tools')).toBeNull();
    expect(screen.getByRole('menuitemradio', { name: 'Rectangle Tool' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitemradio', { name: 'Brush Tool' })).toBeNull();
    // VERTICAL placement is what names the tile. The HORIZONTAL placement is the RAIL's edge
    // rather than the tile's — a tool flyout hangs off the panel, because the tiles sit on a
    // 108px grid inside a narrower content box and a second-column tile can start past the
    // rail's own right edge, which would put the flyout back over the rail's first column. So
    // `left` is now identical for every group and cannot name one, and asserting it to name a
    // tile would pass for the previous group exactly as readily as for the current one.
    expect(overlayWrapper().style.left).toBe(`${RAIL_WIDTH + FLYOUT_GAP}px`);
    // On both axes for the vertical, which is where a tall menu anchored to the wrong tile went
    // off the bottom of the window in a real browser, and it stayed invisible to every
    // assertion the suite had, because the stub gave every tile the same top.
    expect(overlayWrapper().style.top).toBe(`${boxOf(shapeTile).top}px`);
    expect(overlayWrapper().style.top).not.toBe(`${boxOf(brushTile).top}px`);
    // The rail box is stubbed, so this is a real number rather than a zero-width element the
    // placement would have collapsed against.
    expect(boxOf(shapeTile).left).not.toBe(boxOf(brushTile).left);
  });

  /**
   * The vertical axis on its own, because the axis that failed is the one the file left
   * degenerate. `openFlyout` is the file's own helper — `onContextMenu`, which reaches the
   * same `openFlyout` in one event — so no test here schedules the tile's animation frame and
   * leaves a pending timer behind for a later one to trip over.
   *
   * The pair matters more than either value: with every tile at `top: 0` both flyouts read
   * the same thing — the viewport padding, because a 0 anchored against a 0-tall box is what
   * the clamp is asked to place — and so any anchor matched any of them. Asserting an exact
   * top for a tile near the top of the rail and a different exact top for one near the bottom
   * of it is what makes the placement name its anchor.
   *
   * The clamping half — a menu that would run past the bottom of the window — is NOT
   * observable here: `offsetHeight` is 0 in jsdom without a stub, so a flyout measures as
   * nothing tall and never binds the clamp. The real geometry is `e2e/sidebar-flyout.spec.ts`;
   * the arithmetic is the subject of `AnchoredOverlay.test.tsx`, which stubs the size.
   */
  it('places the flyout on the vertical axis of the tile it was opened from, not the rail top', () => {
    render(<SidebarLeft />);
    const boxOf = stubTileBoxes();

    // The first group in the rail that has a flyout at all: `reposition` above it is a
    // single-tool tile, and a group of one opens no menu.
    const highTile = toolbarButtonByName('rectangular-selection');
    openFlyout(highTile);
    const highTop = boxOf(highTile).top;
    expect(overlayWrapper().style.top).toBe(`${highTop}px`);

    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    expect(screen.queryByRole('menu')).toBeNull();

    // The last group in the rail, so the two tops are as far apart as the rail can put them.
    const lowTile = toolbarButtonByName('shape');
    openFlyout(lowTile);
    const lowTop = boxOf(lowTile).top;
    expect(overlayWrapper().style.top).toBe(`${lowTop}px`);

    expect(lowTop).toBeGreaterThan(highTop);
    expect(overlayWrapper().style.top).not.toBe(`${highTop}px`);
    // And never the value the old shared stub collapsed every anchor to, which is the
    // viewport PADDING rather than a literal 0: `AnchoredOverlay` clamps, so a 0 anchored
    // top for a box it measured as 0 tall comes out as `padding`, not as `0px`.
    expect(overlayWrapper().style.top).not.toBe('8px');
  });

  /**
   * The toggle renames every group key too, so the first click alone proves nothing: the
   * menu stops matching whether or not anything closed it. Toggling back restores the
   * `two-column-N` keys, and a group that was never closed matches itself again — so the
   * pair is what separates "closed" from "merely out of key range".
   */
  it('closes an open flyout when the rail layout is toggled, so it cannot come back on the next toggle', () => {
    render(<SidebarLeft />);
    const toggle = screen.getByTestId('toolbar-layout-toggle');

    openFlyout(toolbarButtonByName('brush'));
    expect(menuByName('Brush Tool tools')).not.toBeNull();

    act(() => {
      fireEvent.click(toggle);
    });
    expect(screen.queryByRole('menu')).toBeNull();

    act(() => {
      fireEvent.click(toggle);
    });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  /**
   * The two layouts number the same groups differently, so crossing the tablet boundary
   * renames every open group out of existence: the flyout vanishes on the way down and,
   * without a close, the SAME `openGroup` matches again on the way back up and the menu
   * reopens itself with nothing the user did. It comes back as an orphan — the `<li>` it was
   * anchored to unmounted with the two-column tree, so the anchor is a detached node whose
   * zeroed box drops the overlay onto the viewport padding.
   */
  it('closes an open flyout when the tablet boundary is crossed, so it cannot reopen on the way back', () => {
    render(<SidebarLeft />);
    openFlyout(toolbarButtonByName('brush'));
    expect(menuByName('Brush Tool tools')).not.toBeNull();

    act(() => {
      setViewportWidth(TABLET_WIDTH);
    });
    expect(screen.queryByRole('menu')).toBeNull();

    act(() => {
      setViewportWidth(DESKTOP_WIDTH);
    });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  /**
   * Below `md` the rail is `display: none`, not restyled, and the portal escapes that — so
   * nothing about the menu's own placement stops it. Measured in Chrome, a flyout opened at
   * desktop width stayed painted and clickable at the top-left of the mobile shell with no
   * tile under it, because the hidden tile's zeroed box clamped the menu into the corner.
   * The tablet boundary above is a different failure with the same cause: there the menu
   * vanishes and comes BACK. This one needs closing explicitly.
   */
  it('closes an open flyout when the rail is hidden by the mobile breakpoint', () => {
    render(<SidebarLeft />);
    openFlyout(toolbarButtonByName('brush'));
    expect(menuByName('Brush Tool tools')).not.toBeNull();

    act(() => {
      setViewportWidth(MOBILE_WIDTH);
    });

    expect(screen.queryByRole('menu')).toBeNull();
  });

  it.each(['Escape', 'Tab'])('hands focus back to the tile when %s closes the menu', (key) => {
    render(<SidebarLeft />);
    const tile = toolbarButtonByName('brush');
    openFlyout(tile);

    const menu = screen.getByRole('menu');
    screen.getAllByRole('menuitemradio')[0].focus();
    act(() => {
      // Escape is bound on the window; Tab is the menu's own keydown, because that is the
      // element holding focus when the user presses it.
      if (key === 'Escape') fireEvent.keyDown(window, { key });
      else fireEvent.keyDown(menu, { key });
    });

    expect(screen.queryByRole('menu')).toBeNull();
    // The menu is portalled into `document.body`, so unmounting it takes the focused item
    // with it. Without this, focus lands on `document.body` and the next Tab restarts at the
    // document's first tabbable — 16 tab stops before the rail the user was choosing from.
    expect(tile).toHaveFocus();
  });

  it('hands focus back to the tile when the KEYBOARD picks an item, the path that stranded it furthest', () => {
    render(<SidebarLeft />);
    const tile = toolbarButtonByName('brush');
    openFlyout(tile);

    // Driven through the menu's own keydown, because that is where the restore lives: the
    // item's `onClick` serves the mouse too, and restoring there would put focus on the
    // tile for a mouse pick as well.
    const pencil = screen.getByRole('menuitemradio', { name: 'Pencil Tool' });
    const menu = screen.getByRole('menu');
    act(() => {
      pencil.focus();
    });
    act(() => {
      fireEvent.keyDown(menu, { key: 'Enter' });
    });

    expect(screen.queryByRole('menu')).toBeNull();
    expect(goToTool).toHaveBeenCalledWith('pencil');
    // Choosing a tool is the menu's primary action, and the unmount takes the focused item
    // with it. Without this, focus lands on `document.body` and the next Tab restarts at the
    // document's first tabbable — 16 tab stops before the rail the user was choosing from.
    expect(tile).toHaveFocus();
  });

  it('leaves focus on the picked item when a MOUSE chooses one, because a restore would arm the tooltip', () => {
    render(<SidebarLeft />);
    const tile = toolbarButtonByName('brush');
    openFlyout(tile);

    const pencil = screen.getByRole('menuitemradio', { name: 'Pencil Tool' });
    // What a real mouse does on mousedown, and what `locator.click()` does in the e2e suite.
    act(() => {
      pencil.focus();
    });
    act(() => {
      fireEvent.click(pencil);
    });

    expect(screen.queryByRole('menu')).toBeNull();
    expect(goToTool).toHaveBeenCalledWith('pencil');
    // The same `onClick` serves the mouse and the keyboard's Enter, and Enter restores focus
    // from its own keydown where the gesture is known. Restoring here instead would put focus
    // on the tile, whose `onFocus` arms ToolTooltip's 250ms timer — a tooltip appearing over a
    // selection the mouse user never asked to see.
    expect(tile).not.toHaveFocus();
  });

  it('leaves focus alone when a pointer closes the menu, so the click target keeps it', () => {
    render(<SidebarLeft />);
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    openFlyout(toolbarButtonByName('brush'));

    act(() => {
      outside.focus();
      fireEvent.click(outside);
    });

    expect(screen.queryByRole('menu')).toBeNull();
    // Stealing focus back to the tile here would undo the click the user just made.
    expect(outside).toHaveFocus();

    act(() => {
      outside.remove();
    });
  });
});
