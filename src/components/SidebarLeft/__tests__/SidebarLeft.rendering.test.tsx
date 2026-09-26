import { render, screen } from '@testing-library/react';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
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

const toolbarButtonByName = (name: string) => screen.getByTestId(`tool-button-${name}`);

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

describe('SidebarLeft rendering', () => {
  beforeEach(() => {
    resetMocks();
  });

  afterEach(() => {
    cleanupTimers();
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
      'brush',
      'blur',
      'draw',
      'pen',
      'text',
      'shape',
    ]);
    expect(screen.queryByText('Artboard Tool')).toBeNull();
  });

  it('does not render anything when there is no image', () => {
    Object.assign(storeStateRef, { hasImage: false });
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

  it('names every tool tile after its primary tool', () => {
    render(<SidebarLeft />);

    expect(toolbarButtonByName('reposition')).toHaveAccessibleName('Move Tool');
    expect(toolbarButtonByName('rectangular-selection')).toHaveAccessibleName('Rectangular Marquee Tool');
    expect(toolbarButtonByName('freehand-lasso')).toHaveAccessibleName('Lasso Tool');
    expect(toolbarButtonByName('magic-wand')).toHaveAccessibleName('Magic Wand Tool');
    expect(toolbarButtonByName('crop')).toHaveAccessibleName('Crop Tool');
    expect(toolbarButtonByName('color')).toHaveAccessibleName('Colors');
    expect(toolbarButtonByName('brush')).toHaveAccessibleName('Brush Tool');
    expect(toolbarButtonByName('blur')).toHaveAccessibleName('Blur Tool');
    expect(toolbarButtonByName('draw')).toHaveAccessibleName('Draw Tool');
    expect(toolbarButtonByName('pen')).toHaveAccessibleName('Pen Tool');
    expect(toolbarButtonByName('text')).toHaveAccessibleName('Horizontal Type Tool');
    expect(toolbarButtonByName('shape')).toHaveAccessibleName('Rectangle Tool');
  });

  it('marks flyout groups with a corner indicator and leaves single-tool tiles plain', () => {
    render(<SidebarLeft />);

    const hasFlyoutIndicator = (name: string) =>
      toolbarButtonByName(name).querySelector('span[aria-hidden="true"]') !== null;

    expect(hasFlyoutIndicator('freehand-lasso')).toBe(true);
    expect(hasFlyoutIndicator('color')).toBe(true);
    expect(hasFlyoutIndicator('brush')).toBe(true);
    expect(hasFlyoutIndicator('pen')).toBe(true);
    expect(hasFlyoutIndicator('shape')).toBe(true);

    expect(hasFlyoutIndicator('reposition')).toBe(false);
    expect(hasFlyoutIndicator('crop')).toBe(false);
    expect(hasFlyoutIndicator('blur')).toBe(false);
    expect(hasFlyoutIndicator('draw')).toBe(false);
    expect(hasFlyoutIndicator('text')).toBe(false);
  });
});
