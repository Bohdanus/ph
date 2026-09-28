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

const tileRect = (left: number): DOMRect =>
  ({
    left,
    top: 0,
    width: TILE_WIDTH,
    height: TILE_HEIGHT,
    right: left + TILE_WIDTH,
    bottom: TILE_HEIGHT,
    x: left,
    y: 0,
    toJSON: () => ({}),
  }) as DOMRect;

/**
 * jsdom has no layout engine, so every box is zeroed and the overlay's placement — the only
 * observable that says WHICH tile a flyout is measured against — is collapsed to the viewport
 * padding for all of them. Each tool group's `<li>` is therefore given a distinct x, and
 * `AnchoredOverlay` is placed at `anchorRight + gap`, which names the anchor in the result.
 *
 * The stub is installed on the elements themselves rather than on the prototype, so it does
 * not reach anything else in the suite, and it has to be installed after the render and
 * before the flyout mounts: the overlay measures its anchor in a layout effect on mount.
 *
 * The returned reader maps a tile button to the x its group was given, so a test can state
 * the placement as "beside THAT tile" instead of a magic number.
 */
const stubTileBoxes = (): ((tile: HTMLElement) => number) => {
  const groups = Array.from(screen.getByTestId('left-toolbar-tools').querySelector('ul')!.children) as HTMLElement[];
  const leftByGroup = new Map<HTMLElement, number>();

  groups.forEach((group, index) => {
    const left = index * TILE_STEP;
    leftByGroup.set(group, left);
    group.getBoundingClientRect = () => tileRect(left);
  });

  // The tile button is wrapped in the tooltip's own span, so the anchor is the group `<li>`
  // above it rather than its direct parent.
  return (tile) => leftByGroup.get(tile.closest('li') as HTMLElement)!;
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
    const leftOf = stubTileBoxes();

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
    // Placed beside the SHAPE tile, not the brush one the menu was open on a moment ago.
    expect(overlayWrapper().style.left).toBe(`${leftOf(shapeTile) + TILE_WIDTH + FLYOUT_GAP}px`);
    expect(overlayWrapper().style.left).not.toBe(`${leftOf(brushTile) + TILE_WIDTH + FLYOUT_GAP}px`);
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

  it.each([
    ['Escape', (_menu: HTMLElement) => fireEvent.keyDown(window, { key: 'Escape' })],
    ['Tab', (menu: HTMLElement) => fireEvent.keyDown(menu, { key: 'Tab' })],
  ])('hands focus back to the tile when %s closes the menu', (_label, close) => {
    render(<SidebarLeft />);
    const tile = toolbarButtonByName('brush');
    openFlyout(tile);

    const menu = screen.getByRole('menu');
    screen.getAllByRole('menuitemradio')[0].focus();
    act(() => {
      close(menu);
    });

    expect(screen.queryByRole('menu')).toBeNull();
    // The menu is portalled into `document.body`, so unmounting it takes the focused item
    // with it. Without this, focus lands on `document.body` and the next Tab restarts at the
    // document's first tabbable — 16 tab stops before the rail the user was choosing from.
    expect(tile).toHaveFocus();
  });

  it('hands focus back to the tile when an item is chosen, which is the path that stranded it furthest', () => {
    render(<SidebarLeft />);
    const tile = toolbarButtonByName('brush');
    openFlyout(tile);

    const pencil = screen.getByRole('menuitemradio', { name: 'Pencil Tool' });
    act(() => {
      pencil.focus();
    });
    act(() => {
      fireEvent.click(pencil);
    });

    expect(screen.queryByRole('menu')).toBeNull();
    expect(goToTool).toHaveBeenCalledWith('pencil');
    expect(tile).toHaveFocus();
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
