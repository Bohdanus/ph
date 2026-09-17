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
      'text',
      'shape',
    ]);
    expect(screen.queryByText('Artboard Tool')).toBeNull();
  });

  it('toggles between two-column and one-column layouts', () => {
    render(<SidebarLeft />);

    const toggle = screen.getByTestId('toolbar-layout-toggle');
    const toolbar = screen.getByTestId('left-toolbar-tools');
    const firstSection = toolbar.querySelector('ul')!;

    expect(toggle).toHaveAttribute('aria-label', 'Use one-column toolbar');
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(firstSection).toHaveClass('grid-cols-2');
    expect(toolbar).toHaveClass('w-[6.5rem]');

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute('aria-label', 'Use two-column toolbar');
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(firstSection).toHaveClass('grid-cols-1');
    expect(toolbar).toHaveClass('w-14');
  });

  it('opens grouped tools on hover and closes them on mouse leave', () => {
    vi.useFakeTimers();
    render(<SidebarLeft />);

    const lassoButton = screen.getByTestId('tool-button-freehand-lasso');
    const lassoGroup = lassoButton.closest('li');
    expect(lassoGroup).not.toBeNull();

    fireEvent.mouseEnter(lassoGroup!);
    expect(screen.getByTestId('tool-flyout-0-2')).toBeTruthy();
    expect(screen.getByRole('menuitemradio', { name: 'Polygonal Lasso' })).toBeTruthy();

    act(() => {
      fireEvent.mouseLeave(lassoGroup!);
      vi.advanceTimersByTime(150);
    });
    expect(screen.queryByTestId('tool-flyout-0-2')).toBeNull();
  });

  it('opens a flyout from keyboard focus and closes it with Escape', () => {
    render(<SidebarLeft />);

    const shapeButton = screen.getByTestId('tool-button-shape');
    fireEvent.focus(shapeButton);

    expect(screen.getByTestId('tool-flyout-4-1')).toBeTruthy();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('tool-flyout-4-1')).toBeNull();
  });

  it('selects a tool from a flyout', () => {
    render(<SidebarLeft />);

    const lassoButton = screen.getByTestId('tool-button-freehand-lasso');
    fireEvent.mouseEnter(lassoButton.closest('li')!);
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Polygonal Lasso' }));

    expect(goToTool).toHaveBeenCalledWith('polygonal-lasso');
    expect(screen.queryByTestId('tool-flyout-0-2')).toBeNull();
  });

  it('renders color pickers and the swap control', () => {
    render(<SidebarLeft />);

    expect(screen.getByTestId('color-pickers')).toBeTruthy();
    expect(screen.getByTestId('foreground-color-swatch')).toBeTruthy();
    expect(screen.getByTestId('background-color-swatch')).toBeTruthy();
    expect(screen.getByTestId('swap-colors-button')).toBeTruthy();
  });

  it('shape flyout entries reflect active figure via aria-checked', () => {
    Object.assign(toolArgsMutable, { toolName: 'shape', figure: 'rectangle' });
    Object.assign(storeStateMutable, { toolName: 'shape' });
    render(<SidebarLeft />);

    const shapeLi = screen.getByTestId('tool-button-shape').closest('li') as HTMLElement;
    fireEvent.mouseEnter(shapeLi);

    const rectangleItem = screen.getByTestId('tool-flyout-item-shape-rectangle-tool');
    const ellipseItem = screen.getByTestId('tool-flyout-item-shape-ellipse-tool');
    const squareItem = screen.getByTestId('tool-flyout-item-shape-square-tool');
    const circleItem = screen.getByTestId('tool-flyout-item-shape-circle-tool');
    const lineItem = screen.getByTestId('tool-flyout-item-shape-line-tool');

    expect(rectangleItem).toHaveAttribute('aria-checked', 'true');
    expect(ellipseItem).toHaveAttribute('aria-checked', 'false');
    expect(squareItem).toHaveAttribute('aria-checked', 'false');
    expect(circleItem).toHaveAttribute('aria-checked', 'false');
    expect(lineItem).toHaveAttribute('aria-checked', 'false');
  });
});
