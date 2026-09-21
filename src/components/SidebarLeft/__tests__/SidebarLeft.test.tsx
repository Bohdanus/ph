import { act, fireEvent, render, screen } from '@testing-library/react';
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
  useStore: () => [storeStateMutable],
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

describe('SidebarLeft', () => {
  beforeEach(() => {
    goToTool.mockClear();
    Object.assign(toolArgsMutable, { toolName: 'draw' });
    Object.assign(storeStateMutable, { toolName: 'draw' });
    patchToolArgsMock.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

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

  it('opens grouped tools on hover and closes them on mouse leave', () => {
    vi.useFakeTimers();
    render(<SidebarLeft />);

    const brushButton = screen.getByTestId('tool-button-brush');
    const brushGroup = brushButton.closest('li');
    expect(brushGroup).not.toBeNull();

    fireEvent.mouseEnter(brushGroup!);
    expect(screen.getByTestId('tool-flyout-3-2')).toBeTruthy();
    expect(screen.getByRole('menuitemradio', { name: 'Pencil Tool' })).toBeTruthy();

    act(() => {
      fireEvent.mouseLeave(brushGroup!);
      vi.advanceTimersByTime(150);
    });
    expect(screen.queryByTestId('tool-flyout-3-2')).toBeNull();
  });

  it('opens a flyout from keyboard focus and closes it with Escape', () => {
    render(<SidebarLeft />);

    const shapeButton = screen.getByTestId('tool-button-shape');
    fireEvent.focus(shapeButton);

    expect(screen.getByTestId('tool-flyout-4-2')).toBeTruthy();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('tool-flyout-4-2')).toBeNull();
  });

  it('selects a tool from a flyout', () => {
    render(<SidebarLeft />);

    const brushButton = screen.getByTestId('tool-button-brush');
    fireEvent.mouseEnter(brushButton.closest('li')!);
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Pencil Tool' }));

    expect(goToTool).toHaveBeenCalledWith('pencil');
    expect(screen.queryByTestId('tool-flyout-3-2')).toBeNull();
  });

  it('renders color pickers and the swap control', () => {
    render(<SidebarLeft />);

    expect(screen.getByTestId('color-pickers')).toBeTruthy();
    expect(screen.getByTestId('foreground-color-swatch')).toBeTruthy();
    expect(screen.getByTestId('background-color-swatch')).toBeTruthy();
    expect(screen.getByTestId('swap-colors-button')).toBeTruthy();
  });

  it('brush flyout entries reflect the selected tool state', () => {
    Object.assign(storeStateMutable, { toolName: 'brush' });
    render(<SidebarLeft />);

    const brushLi = screen.getByTestId('tool-button-brush').closest('li') as HTMLElement;
    fireEvent.mouseEnter(brushLi);

    const brushItem = screen.getByTestId('tool-flyout-item-brush-brush-tool');
    const pencilItem = screen.getByTestId('tool-flyout-item-pencil-pencil-tool');
    const replacementItem = screen.getByTestId('tool-flyout-item-color-replacement-color-replacement-tool');

    expect(brushItem).toHaveAttribute('aria-checked', 'true');
    expect(pencilItem).toHaveAttribute('aria-checked', 'false');
    expect(replacementItem).toHaveAttribute('aria-checked', 'false');
  });
});
