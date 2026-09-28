import { act, fireEvent, render, screen } from '@testing-library/react';
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
      eraser: Icon,
      'magic-eraser': Icon,
      'paint-bucket': Icon,
      eyedropper: Icon,
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

  it('toggles between two-column and one-column layouts', () => {
    render(<SidebarLeft />);

    const toggle = screen.getByTestId('toolbar-layout-toggle');
    const toolbar = screen.getByTestId('left-toolbar-tools');
    const sidebar = screen.getByTestId('left-sidebar');
    const firstSection = toolbar.querySelector('ul')!;
    const getPrimaryNames = () =>
      [...toolbar.querySelectorAll<HTMLButtonElement>(':scope > ul > li > button')].map((button) =>
        button.dataset.testid?.replace('tool-button-', '')
      );
    const oneColumnOrder = getPrimaryNames();

    expect(toggle).toHaveAttribute('aria-label', 'Use two-column toolbar');
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(firstSection).toHaveClass('grid-cols-1');
    expect(toolbar).toHaveClass('w-14');
    expect(sidebar).toHaveStyle({ width: '56px' });

    act(() => {
      fireEvent.click(toggle);
    });

    expect(toggle).toHaveAttribute('aria-label', 'Use one-column toolbar');
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(toolbar.querySelector('ul')).toHaveClass('grid-cols-2');
    expect(toolbar).toHaveClass('w-[6.75rem]');
    expect(sidebar).toHaveStyle({ width: '108px' });
    expect(toolbar.querySelectorAll(':scope > ul')).toHaveLength(1);
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
