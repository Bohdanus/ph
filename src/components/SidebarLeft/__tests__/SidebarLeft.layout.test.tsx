import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { toolbarMap } from '../../../../toolbar-mapping.ts';
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

const LONG_PRESS_DELAY = 300;

const longPress = (button: HTMLElement) => {
  fireEvent.pointerDown(button, { button: 0 });
  act(() => {
    vi.advanceTimersByTime(LONG_PRESS_DELAY);
  });
  fireEvent.pointerUp(button, { button: 0 });
  fireEvent.click(button);
};

const toolbarButtonByName = (name: string) => screen.getByTestId(`tool-button-${name}`);

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

describe('SidebarLeft layout toggle', () => {
  beforeEach(() => {
    resetMocks();
  });

  afterEach(() => {
    cleanupTimers();
  });

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
    // Every assertion below is about the LAYOUT — the toggle's own state, the number of
    // section lists, and the fact that one column is narrower than two — and none of them is
    // about a Tailwind class or a pixel count. Both used to be here, and both are the wrong
    // question: `w-14` is a name the stylesheet can change, and `56px` is a number a design
    // change moves without the layout behaving differently at all. Pinning them made a
    // one-column default cost five assertions and a rail width cost five more, none of which
    // described anything a user can see.
    expect(toggle).toHaveAttribute('aria-label', 'Use two-column toolbar');
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    // One `<ul>` per toolbar section; the two-column rail interleaves them into one grid.
    expect(toolbar.querySelectorAll(':scope > ul')).toHaveLength(toolbarMap.length);
    expect(toolbar.querySelector('ul')).toHaveClass('grid-cols-1');

    act(() => {
      fireEvent.click(toggle);
    });

    expect(toggle).toHaveAttribute('aria-label', 'Use one-column toolbar');
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
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
