import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SidebarLeft from '../SidebarLeft.tsx';

const goToTool = vi.fn();

const toolArgsMutable: { toolName: string; figure?: string } = { toolName: 'draw' };
const patchToolArgsMock = vi.fn();

const storeStateMutable: {
  hasImage: boolean;
  toolName: string;
  color: string;
  backgroundColor: string;
  dispatch: ReturnType<typeof vi.fn>;
} = {
  hasImage: true,
  toolName: 'draw',
  color: '#000000',
  backgroundColor: '#ffffff',
  dispatch: vi.fn(),
};

vi.mock('../../../contexts/StoreContext.tsx', () => ({
  useStore: () => [storeStateMutable, storeStateMutable.dispatch],
}));

vi.mock('../../../hooks/useApp.ts', () => ({
  useApp: () => ({ goToTool }),
}));

vi.mock('../../../contexts/useCurrentTool.tsx', () => ({
  useCurrentTool: () => ({
    toolArgs: toolArgsMutable,
    patchToolArgs: patchToolArgsMock,
  }),
}));

vi.mock('../toolIcons.tsx', () => {
  const Icon = ({ title }: { title: string }) => <svg aria-hidden="true">{title}</svg>;

  return {
    toolIcons: {
      reposition: Icon,
      'rectangular-selection': Icon,
      'freehand-lasso': Icon,
      'polygonal-lasso': Icon,
      'feather-magnetic-lasso': Icon,
      'magic-wand': Icon,
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

/** Opens a grouped flyout via long-press and consumes the synthetic click from pointer release. */
const longPress = (button: HTMLElement) => {
  fireEvent.pointerDown(button, { button: 0 });
  act(() => {
    vi.advanceTimersByTime(LONG_PRESS_DELAY);
  });
  fireEvent.pointerUp(button, { button: 0 });
  fireEvent.click(button);
};

const toolbarButtonByName = (name: string) => screen.getByTestId(`tool-button-${name}`);

describe('SidebarLeft', () => {
  beforeEach(() => {
    goToTool.mockReset();
    Object.assign(toolArgsMutable, { toolName: 'draw', figure: undefined });
    Object.assign(storeStateMutable, {
      hasImage: true,
      toolName: 'draw',
      color: '#000000',
      backgroundColor: '#ffffff',
    });
    storeStateMutable.dispatch.mockClear();
    patchToolArgsMock.mockClear();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  describe('rendering', () => {
    it('renders the available tools in Photoshop-inspired order', () => {
      render(<SidebarLeft />);

      const toolbar = screen.getByTestId('left-toolbar-tools');
      const buttonNames = [...toolbar.querySelectorAll<HTMLButtonElement>('button[data-testid^="tool-button-"]')].map(
        (button) => button.dataset.testid?.replace('tool-button-', '')
      );

      expect(buttonNames).toEqual([
        'reposition',
        'rectangular-selection',
        'freehand-lasso',
        'magic-wand',
        'crop',
        'color',
        'draw',
        'blur',
        'brush',
        'text',
        'pen',
        'shape',
        'custom-shape',
      ]);
      expect(screen.queryByText('Artboard Tool')).toBeNull();
    });

    it('does not render anything when there is no image', () => {
      Object.assign(storeStateMutable, { hasImage: false });
      const { container } = render(<SidebarLeft />);
      expect(container.firstChild).toBeNull();
    });

    it('renders color pickers and the swap control', () => {
      render(<SidebarLeft />);

      expect(screen.getByTestId('color-pickers')).toBeInTheDocument();
      expect(screen.getByTestId('foreground-color-swatch')).toBeInTheDocument();
      expect(screen.getByTestId('background-color-swatch')).toBeInTheDocument();
      expect(screen.getByTestId('swap-colors-button')).toBeInTheDocument();
    });
  });

  describe('layout toggle', () => {
    it('toggles between two-column and one-column layouts', () => {
      render(<SidebarLeft />);

      const toggle = screen.getByTestId('toolbar-layout-toggle');
      const toolbar = screen.getByTestId('left-toolbar-tools');
      const sidebar = screen.getByTestId('left-sidebar');
      const firstSection = toolbar.querySelector('ul')!;

      expect(toggle).toHaveAttribute('aria-label', 'Use one-column toolbar');
      expect(toggle).toHaveAttribute('aria-pressed', 'false');
      expect(firstSection).toHaveClass('grid-cols-2');
      expect(toolbar).toHaveClass('w-[6.5rem]');
      expect(sidebar).toHaveStyle({ width: '104px' });

      fireEvent.click(toggle);

      expect(toggle).toHaveAttribute('aria-label', 'Use two-column toolbar');
      expect(toggle).toHaveAttribute('aria-pressed', 'true');
      expect(firstSection).toHaveClass('grid-cols-1');
      expect(toolbar).toHaveClass('w-14');
      expect(sidebar).toHaveStyle({ width: '56px' });
    });

    it('closes any open flyout when toggling layout', () => {
      vi.useFakeTimers();
      render(<SidebarLeft />);

      longPress(toolbarButtonByName('brush'));
      expect(screen.getByRole('menu')).toBeInTheDocument();

      fireEvent.click(screen.getByTestId('toolbar-layout-toggle'));
      expect(screen.queryByRole('menu')).toBeNull();
    });
  });

  describe('primary tool selection', () => {
    const groupedToolCases = [
      { title: 'Freehand Lasso', name: 'freehand-lasso', item: 'Freehand Lasso' },
      { title: 'Colors', name: 'color', item: 'Colors' },
      { title: 'Brush', name: 'brush', item: 'Brush Tool' },
      { title: 'Pen', name: 'pen', item: 'Pen Tool' },
      { title: 'Rectangle Tool', name: 'shape', item: 'Rectangle Tool' },
    ];

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

      fireEvent.click(toolbarButtonByName('brush'));

      expect(goToTool).toHaveBeenCalledTimes(1);
      expect(goToTool).toHaveBeenCalledWith('brush');
      expect(screen.queryByRole('menu')).toBeNull();
    });

    it('selects a single-tool group on click without a flyout', () => {
      render(<SidebarLeft />);

      fireEvent.click(toolbarButtonByName('draw'));

      expect(goToTool).toHaveBeenCalledWith('draw');
      expect(screen.queryByRole('menu')).toBeNull();
    });

    it('cancels a pending long-press on pointer-up and selects the primary via a short click', () => {
      vi.useFakeTimers();
      render(<SidebarLeft />);

      const brushButton = toolbarButtonByName('brush');
      fireEvent.pointerDown(brushButton, { button: 0 });
      fireEvent.pointerUp(brushButton, { button: 0 });
      fireEvent.click(brushButton);

      expect(goToTool).toHaveBeenCalledWith('brush');
      expect(screen.queryByRole('menu')).toBeNull();

      act(() => {
        vi.advanceTimersByTime(350);
      });
      expect(screen.queryByRole('menu')).toBeNull();
    });

    it.each(groupedToolCases)('does not resolve the long-press until 300ms elapses ($title)', ({ name }) => {
      vi.useFakeTimers();
      render(<SidebarLeft />);

      const rootButton = toolbarButtonByName(name);
      fireEvent.pointerDown(rootButton, { button: 0 });
      act(() => {
        vi.advanceTimersByTime(299);
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

      fireEvent.mouseEnter(brushGroup);
      fireEvent.mouseMove(brushGroup);
      fireEvent.mouseLeave(brushGroup);
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
      fireEvent.mouseEnter(menu);
      fireEvent.mouseLeave(menu);
      act(() => {
        vi.advanceTimersByTime(200);
      });

      expect(screen.getByRole('menu')).toBeInTheDocument();
    });

    it('selects a non-shape submenu item and makes it the new primary', () => {
      vi.useFakeTimers();
      render(<SidebarLeft />);

      longPress(toolbarButtonByName('brush'));
      fireEvent.click(screen.getByRole('menuitemradio', { name: 'Pencil Tool' }));

      expect(goToTool).toHaveBeenCalledWith('pencil');
      expect(patchToolArgsMock).not.toHaveBeenCalled();
      expect(screen.queryByRole('menu')).toBeNull();

      const rootButton = toolbarButtonByName('pencil');
      expect(within(rootButton).getByText('Pencil Tool')).toBeInTheDocument();

      fireEvent.click(rootButton);
      expect(goToTool).toHaveBeenCalledWith('pencil');
      expect(goToTool).toHaveBeenCalledTimes(2);
    });

    it('selects a shape submenu item, patches the figure, and keeps it as primary', () => {
      vi.useFakeTimers();
      render(<SidebarLeft />);

      longPress(toolbarButtonByName('shape'));
      fireEvent.click(screen.getByRole('menuitemradio', { name: 'Ellipse Tool' }));

      expect(patchToolArgsMock).toHaveBeenCalledWith('shape', { figure: 'oval' });
      expect(goToTool).toHaveBeenCalledWith('shape');
      expect(screen.queryByRole('menu')).toBeNull();

      const rootButton = toolbarButtonByName('shape');
      expect(within(rootButton).getByText('Ellipse Tool')).toBeInTheDocument();

      fireEvent.click(rootButton);
      expect(goToTool).toHaveBeenCalledWith('shape');
      expect(patchToolArgsMock).toHaveBeenLastCalledWith('shape', { figure: 'oval' });
    });

    const nonPrimaryCases: ReadonlyArray<[string, string, string]> = [
      ['pencil', 'brush', 'brush'],
      ['color-replacement', 'brush', 'brush'],
      ['freeform-pen', 'pen', 'pen'],
      ['curvature-pen', 'pen', 'pen'],
      ['ellipse', 'shape', 'shape'],
    ];

    it.each(nonPrimaryCases)(
      'defaults to the first item (%s) as primary even when another group member is active',
      (activeTool, name, expectedPrimary) => {
        Object.assign(storeStateMutable, { toolName: activeTool });
        Object.assign(toolArgsMutable, { toolName: activeTool, figure: undefined });
        render(<SidebarLeft />);

        const rootButton = toolbarButtonByName(name);
        expect(toolbarButtonByName(name)).toBeInTheDocument();

        fireEvent.click(rootButton);
        expect(goToTool).toHaveBeenCalledWith(expectedPrimary);
      }
    );
  });

  describe('flyout closing', () => {
    it.each([
      ['outside click', () => fireEvent.click(document.body)],
      ['Escape', () => fireEvent.keyDown(window, { key: 'Escape' })],
    ])('closes an open submenu on %s', (_label, close) => {
      vi.useFakeTimers();
      render(<SidebarLeft />);

      longPress(toolbarButtonByName('brush'));
      expect(screen.getByRole('menu')).toBeInTheDocument();

      close();
      expect(screen.queryByRole('menu')).toBeNull();
    });

    it('closes the open submenu when clicking the active grouped tile', () => {
      vi.useFakeTimers();
      render(<SidebarLeft />);

      longPress(toolbarButtonByName('brush'));
      expect(screen.getByRole('menu')).toBeInTheDocument();

      fireEvent.click(toolbarButtonByName('brush'));
      expect(screen.queryByRole('menu')).toBeNull();
      expect(goToTool).not.toHaveBeenCalled();
    });

    it('closes the open submenu when a different grouped tile is long-pressed', () => {
      vi.useFakeTimers();
      render(<SidebarLeft />);

      longPress(toolbarButtonByName('brush'));
      expect(screen.getByRole('menu')).toBeInTheDocument();

      longPress(toolbarButtonByName('shape'));

      expect(screen.queryByRole('menu', { name: 'Brush Tool tools' })).toBeNull();
      expect(screen.getByRole('menu', { name: 'Shape tools' })).toBeInTheDocument();
    });

    it('cancels a pending long-press when the pointer leaves before the timeout', () => {
      vi.useFakeTimers();
      render(<SidebarLeft />);

      const brushButton = toolbarButtonByName('brush');
      fireEvent.pointerDown(brushButton, { button: 0 });
      fireEvent.pointerLeave(brushButton);

      act(() => {
        vi.advanceTimersByTime(LONG_PRESS_DELAY);
      });

      expect(screen.queryByRole('menu')).toBeNull();
    });
  });

  describe('right-click (context menu)', () => {
    it('opens flyout on right-click for grouped tools', () => {
      render(<SidebarLeft />);

      fireEvent.contextMenu(toolbarButtonByName('brush'));
      expect(screen.getByRole('menu')).toBeInTheDocument();
    });

    it('does not open flyout on right-click for single-tool groups', () => {
      render(<SidebarLeft />);

      fireEvent.contextMenu(toolbarButtonByName('draw'));
      expect(screen.queryByRole('menu')).toBeNull();
    });

    it('prevents default browser context menu on right-click for grouped tools', () => {
      render(<SidebarLeft />);

      const brushButton = toolbarButtonByName('brush');
      const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
      fireEvent(brushButton, event);

      expect(event.defaultPrevented).toBe(true);
    });
  });

  describe('keyboard activation', () => {
    it.each(['ArrowDown', 'ArrowUp', 'Enter', ' '])('opens flyout via %s on a grouped tool button', (key) => {
      render(<SidebarLeft />);

      const brushButton = toolbarButtonByName('brush');
      fireEvent.keyDown(brushButton, { key });

      expect(screen.getByRole('menu')).toBeInTheDocument();
    });

    it('does not open flyout via keyboard on single-tool group buttons', () => {
      render(<SidebarLeft />);

      const drawButton = toolbarButtonByName('draw');
      fireEvent.keyDown(drawButton, { key: 'ArrowDown' });
      fireEvent.keyDown(drawButton, { key: 'Enter' });

      expect(screen.queryByRole('menu')).toBeNull();
    });
  });

  describe('flyout keyboard navigation', () => {
    it('moves focus with ArrowDown within the flyout', () => {
      render(<SidebarLeft />);

      fireEvent.contextMenu(toolbarButtonByName('brush'));

      const items = screen.getAllByRole('menuitemradio');
      expect(items.length).toBeGreaterThanOrEqual(2);

      items[0].focus();
      expect(items[0]).toHaveFocus();

      fireEvent.keyDown(items[0], { key: 'ArrowDown' });
      expect(items[1]).toHaveFocus();
    });

    it('moves focus with ArrowUp wrapping to the last item', () => {
      render(<SidebarLeft />);

      fireEvent.contextMenu(toolbarButtonByName('brush'));

      const items = screen.getAllByRole('menuitemradio');
      const lastItem = items[items.length - 1];

      items[0].focus();
      fireEvent.keyDown(items[0], { key: 'ArrowUp' });
      expect(lastItem).toHaveFocus();
    });

    it('wraps ArrowDown from last item to first', () => {
      render(<SidebarLeft />);

      fireEvent.contextMenu(toolbarButtonByName('brush'));

      const items = screen.getAllByRole('menuitemradio');
      const lastItem = items[items.length - 1];

      lastItem.focus();
      fireEvent.keyDown(lastItem, { key: 'ArrowDown' });
      expect(items[0]).toHaveFocus();
    });

    it('activates the focused item with Enter', () => {
      render(<SidebarLeft />);

      fireEvent.contextMenu(toolbarButtonByName('brush'));

      const pencilItem = screen.getByRole('menuitemradio', { name: 'Pencil Tool' });
      pencilItem.focus();
      fireEvent.keyDown(screen.getByRole('menu'), { key: 'Enter' });

      expect(goToTool).toHaveBeenCalledWith('pencil');
      expect(screen.queryByRole('menu')).toBeNull();
    });
  });

  describe('icon and selection state', () => {
    it('marks the grouped button as pressed when a tool in the group is active', () => {
      Object.assign(storeStateMutable, { toolName: 'brush' });
      render(<SidebarLeft />);

      const brushButton = toolbarButtonByName('brush');
      expect(brushButton).toHaveAttribute('aria-pressed', 'true');
    });

    it('marks the grouped button as not pressed when no tool in the group is active', () => {
      render(<SidebarLeft />);

      expect(toolbarButtonByName('brush')).toHaveAttribute('aria-pressed', 'false');
    });
  });

  describe('color pickers', () => {
    it('dispatches SET_COLOR when foreground color input changes', () => {
      render(<SidebarLeft />);

      const input = screen.getByTestId('foreground-color-input');
      fireEvent.change(input, { target: { value: '#ff0000' } });

      expect(storeStateMutable.dispatch).toHaveBeenCalledWith({ type: 'SET_COLOR', payload: '#ff0000' });
    });

    it('dispatches SET_BACKGROUND_COLOR when background color input changes', () => {
      render(<SidebarLeft />);

      const input = screen.getByTestId('background-color-input');
      fireEvent.change(input, { target: { value: '#00ff00' } });

      expect(storeStateMutable.dispatch).toHaveBeenCalledWith({
        type: 'SET_BACKGROUND_COLOR',
        payload: '#00ff00',
      });
    });

    it('swaps foreground and background colors', () => {
      render(<SidebarLeft />);

      fireEvent.click(screen.getByTestId('swap-colors-button'));

      expect(storeStateMutable.dispatch).toHaveBeenCalledWith({ type: 'SET_COLOR', payload: '#ffffff' });
      expect(storeStateMutable.dispatch).toHaveBeenCalledWith({
        type: 'SET_BACKGROUND_COLOR',
        payload: '#000000',
      });
    });

    it('clicking foreground swatch triggers the foreground color input click', () => {
      render(<SidebarLeft />);

      const swatch = screen.getByTestId('foreground-color-swatch');
      const input = screen.getByTestId('foreground-color-input') as HTMLInputElement;
      const clickSpy = vi.spyOn(input, 'click');

      fireEvent.click(swatch);
      expect(clickSpy).toHaveBeenCalled();
      clickSpy.mockRestore();
    });

    it('clicking background swatch triggers the background color input click', () => {
      render(<SidebarLeft />);

      const swatch = screen.getByTestId('background-color-swatch');
      const input = screen.getByTestId('background-color-input') as HTMLInputElement;
      const clickSpy = vi.spyOn(input, 'click');

      fireEvent.click(swatch);
      expect(clickSpy).toHaveBeenCalled();
      clickSpy.mockRestore();
    });

    it('positions the color input near the foreground swatch on click', () => {
      render(<SidebarLeft />);

      const swatch = screen.getByTestId('foreground-color-swatch');
      const input = screen.getByTestId('foreground-color-input') as HTMLInputElement;

      // jsdom returns zero rects, so offsets are 0; top is offsetY + 5 = 5
      fireEvent.click(swatch);

      expect(input.style.left).toBe('0px');
      expect(input.style.top).toBe('5px');
    });
  });

  describe('cleanup', () => {
    it('clears the long-press timeout on unmount', () => {
      vi.useFakeTimers();
      const { unmount } = render(<SidebarLeft />);

      const brushButton = toolbarButtonByName('brush');
      fireEvent.pointerDown(brushButton, { button: 0 });

      unmount();

      act(() => {
        vi.advanceTimersByTime(350);
      });

      expect(screen.queryByRole('menu')).toBeNull();
    });
  });
});
