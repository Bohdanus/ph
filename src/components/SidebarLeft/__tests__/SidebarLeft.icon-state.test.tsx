import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import type { ReactElement } from 'react';
import SidebarLeft from '../SidebarLeft.tsx';
import { toolIcons } from '../toolIcons.tsx';
import { toolbarMap } from '../../../../toolbar-mapping.ts';
import type { ToolbarTool } from '../../../../toolbar-mapping.ts';

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
  const iconNames = [
    'reposition',
    'rectangular-selection',
    'elliptical-selection',
    'freehand-lasso',
    'polygonal-lasso',
    'feather-magnetic-lasso',
    'magic-wand',
    'quick-selection',
    'eyedropper',
    'eraser',
    'clone-stamp',
    'paint-bucket',
    'gradient',
    'sharpen',
    'smudge',
    'dodge',
    'burn',
    'crop',
    'draw',
    'shape',
    'shape-rectangle',
    'shape-oval',
    'shape-line',
    'shape-triangle',
    'shape-polygon',
    'text',
    'color',
    'blur',
    'levels',
    'transform',
    'brush',
    'pencil',
    'color-replacement',
    'eraser',
    'magic-eraser',
    'paint-bucket',
    'eyedropper',
    'pen',
    'freeform-pen',
    'curvature-pen',
    'add-anchor-point',
    'delete-anchor-point',
    'convert-point',
    'rectangle',
    'ellipse',
    'triangle',
    'polygon',
    'line',
    'custom-shape',
  ];

  return {
    toolIcons: Object.fromEntries(
      iconNames.map((iconName) => {
        const Icon = ({ title }: { title: string }) => (
          <svg aria-hidden="true" data-icon={iconName}>
            {title}
          </svg>
        );
        return [iconName, Icon];
      })
    ),
  };
});

const toolbarButtonByName = (name: string) => screen.getByTestId(`tool-button-${name}`);

const mockedIcons = toolIcons as Record<string, ((props: { title: string }) => ReactElement) | undefined>;

const iconNameIn = (element: HTMLElement) => element.querySelector('svg')?.getAttribute('data-icon') ?? null;

const openShapeFlyout = () => {
  act(() => {
    fireEvent.contextMenu(toolbarButtonByName('shape'));
  });
  return screen.getByRole('menu', { name: 'Shape tools' });
};

const shapeGroup = (toolbarMap.flat() as readonly (readonly ToolbarTool[])[])
  .flat()
  .filter((tool) => tool.name === 'shape' || tool.name === 'custom-shape');

const expectedIconNames = shapeGroup.map((tool) => (tool.figure ? `shape-${tool.figure}` : tool.name));

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

describe('SidebarLeft icon and selection state', () => {
  beforeEach(() => {
    resetMocks();
  });

  afterEach(() => {
    cleanupTimers();
  });

  it('marks the grouped button as pressed when a tool in the group is active', () => {
    Object.assign(storeStateRef, { toolName: 'brush' });
    render(<SidebarLeft />);

    const brushButton = toolbarButtonByName('brush');
    expect(brushButton).toHaveAttribute('aria-pressed', 'true');
  });

  it('marks the grouped button as not pressed when no tool in the group is active', () => {
    render(<SidebarLeft />);

    expect(toolbarButtonByName('brush')).toHaveAttribute('aria-pressed', 'false');
  });

  it('shows the rectangle figure icon on the default shape tile', () => {
    render(<SidebarLeft />);

    expect(iconNameIn(toolbarButtonByName('shape'))).toBe('shape-rectangle');
  });

  it('renders the figure specific icon for every entry of the shape flyout', () => {
    render(<SidebarLeft />);
    const menu = openShapeFlyout();
    const items = within(menu).getAllByRole('menuitemradio');

    expect(items).toHaveLength(expectedIconNames.length);
    expect(items.map((item) => iconNameIn(item))).toEqual(expectedIconNames);

    for (const tool of shapeGroup) {
      const item = within(menu).getByRole('menuitemradio', { name: new RegExp(tool.label) });

      expect(iconNameIn(item)).toBe(tool.figure ? `shape-${tool.figure}` : tool.name);
    }
  });

  it('falls back to the shared shape icon when a figure has no dedicated icon entry', () => {
    const removed = mockedIcons['shape-line'];
    delete mockedIcons['shape-line'];

    try {
      render(<SidebarLeft />);
      const menu = openShapeFlyout();
      const lineItem = within(menu).getByRole('menuitemradio', { name: /Line Tool/ });

      expect(iconNameIn(lineItem)).toBe('shape');
      expect(
        within(menu)
          .getAllByRole('menuitemradio')
          .map((item) => iconNameIn(item))
      ).not.toContain('shape-line');
    } finally {
      mockedIcons['shape-line'] = removed;
    }
  });

  it('renders the custom shape icon for the flyout entry without a figure', () => {
    render(<SidebarLeft />);
    const menu = openShapeFlyout();
    const customShapeItem = within(menu).getByRole('menuitemradio', { name: /Custom Shape Tool/ });

    expect(iconNameIn(customShapeItem)).toBe('custom-shape');
  });

  it('keeps the checked flyout entry on the icon of the active figure', () => {
    Object.assign(storeStateRef, { toolName: 'shape' });
    Object.assign(toolArgsRef, { toolName: 'shape', figure: 'oval' });
    render(<SidebarLeft />);

    const menu = openShapeFlyout();
    const items = within(menu).getAllByRole('menuitemradio');
    const selectedItems = items.filter((item) => item.getAttribute('aria-checked') === 'true');

    expect(selectedItems).toHaveLength(1);
    expect(iconNameIn(selectedItems[0])).toBe('shape-oval');
  });
});
