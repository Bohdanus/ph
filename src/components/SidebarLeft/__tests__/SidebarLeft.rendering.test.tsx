import { act, fireEvent, render, screen, within } from '@testing-library/react';
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
    const buttonNames = [
      ...toolbar.querySelectorAll<HTMLButtonElement>('button[data-testid^="tool-button-"]'),
    ].map((button) => button.dataset.testid?.replace('tool-button-', ''));

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
});