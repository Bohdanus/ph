import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import SidebarLeft, { FLYOUT_LONG_PRESS_MS } from '../SidebarLeft.tsx';

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

const LONG_PRESS_DELAY = FLYOUT_LONG_PRESS_MS;

const longPress = (button: HTMLElement) => {
  fireEvent.pointerDown(button, { button: 0 });
  act(() => {
    vi.advanceTimersByTime(LONG_PRESS_DELAY);
  });
  fireEvent.pointerUp(button, { button: 0 });
  fireEvent.click(button);
};

const toolbarButtonByName = (name: string) => screen.getByTestId(`tool-button-${name}`);

const groupedToolCases = [
  { title: 'Lasso Tool', name: 'freehand-lasso', item: 'Lasso Tool' },
  { title: 'Colors', name: 'color', item: 'Colors' },
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

describe('SidebarLeft primary tool selection', () => {
  beforeEach(() => {
    resetMocks();
  });

  afterEach(() => {
    cleanupTimers();
  });

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

  it.each(groupedToolCases)('resolves the long-press only at the exported threshold ($title)', ({ name }) => {
    vi.useFakeTimers();
    render(<SidebarLeft />);

    const rootButton = toolbarButtonByName(name);
    act(() => {
      fireEvent.pointerDown(rootButton, { button: 0 });
    });
    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_DELAY - 1);
    });
    expect(screen.queryByRole('menu')).toBeNull();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

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
    expect(patchToolArgsMock).not.toHaveBeenCalled();
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

    expect(patchToolArgsMock).toHaveBeenCalledWith('shape', { figure: 'oval' });
    expect(goToTool).toHaveBeenCalledWith('shape');
    expect(screen.queryByRole('menu')).toBeNull();

    const rootButton = toolbarButtonByName('shape');
    expect(within(rootButton).getByText('Ellipse Tool')).toBeInTheDocument();

    act(() => {
      fireEvent.click(rootButton);
    });
    expect(goToTool).toHaveBeenCalledWith('shape');
    expect(patchToolArgsMock).toHaveBeenLastCalledWith('shape', { figure: 'oval' });
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
    expect(patchToolArgsMock).not.toHaveBeenCalledWith('shape', { figure: 'circle' });
    expect(patchToolArgsMock).not.toHaveBeenCalledWith('shape', { figure: 'square' });
  });

  it.each(nonPrimaryCases)(
    'defaults to the first item (%s) as primary even when another group member is active',
    (activeTool, name, expectedPrimary) => {
      Object.assign(storeStateRef, { toolName: activeTool });
      Object.assign(toolArgsRef, { toolName: activeTool, figure: undefined });
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
