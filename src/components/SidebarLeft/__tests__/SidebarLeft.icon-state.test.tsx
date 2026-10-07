import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import type { ReactElement } from 'react';
import SidebarLeft from '../SidebarLeft.tsx';
import { toolIcons } from '../toolIcons.tsx';
import { slugifyToolLabel, toolbarMap } from '../../../../toolbar-mapping.ts';
import type { ToolbarTool, ToolbarToolGroup } from '../../../../toolbar-mapping.ts';
import { descriptionKeyFor } from '../../../tools/descriptions/tooltips.ts';
import { findToolProcessor } from '../../../tools/toolProcessors.ts';

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
    'hand',
    'zoom',
    'rotate-view',
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
    'sponge',
    'crop',
    'draw',
    'shape',
    'shape-rectangle',
    'shape-oval',
    'shape-line',
    'shape-triangle',
    'shape-polygon',
    'shape-star',
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

/**
 * The class `SidebarLeft` puts on a tile and on a flyout row for a tool the registry registers
 * as unimplemented, spelled out rather than imported from the component.
 *
 * The component keeps the constant private, and the string is a DOM contract now — it is what
 * this file selects on, and it is what an e2e spec would select on — so a rename has to fail
 * something rather than pass quietly.
 */
const UNIMPLEMENTED_CLASS = 'tool-unimplemented';

/**
 * "Does this tool work yet", read the way the component reads it: the registry's own
 * `commit: 'unimplemented'`, through the same `figure` resolution, because the five shape
 * entries all carry the name `shape`. The registry is the ORACLE here rather than the
 * component's own derived set — a test that imported that set would agree with the component
 * by construction and would catch nothing at all.
 */
const isUnimplemented = (tool: ToolbarTool): boolean =>
  findToolProcessor(descriptionKeyFor(tool.name, tool.figure))?.commit === 'unimplemented';

const toolbarGroups = toolbarMap.flat() as readonly ToolbarToolGroup[];

/** Every rail tile, in rail order, as the button itself. */
const railTiles = (): HTMLElement[] => [
  ...screen
    .getByTestId('left-toolbar-tools')
    .querySelectorAll<HTMLButtonElement>('button[data-testid^="tool-button-"]'),
];

/** The row test id the component mints for a tool: `tool-flyout-item-<name>-<slugified label>`. */
const flyoutItemTestId = (tool: ToolbarTool): string => `tool-flyout-item-${tool.name}-${slugifyToolLabel(tool.label)}`;

/** Opens a tile's flyout the way a right-click does — no timer, so no fake clock needed. */
const openFlyoutOf = (tile: HTMLElement): HTMLElement => {
  act(() => {
    fireEvent.contextMenu(tile);
  });
  return screen.getByRole('menu');
};

/** The `data-testid` of every rail tile that carries the dim, in rail order. */
const dimmedTileTestIds = (): (string | undefined)[] =>
  railTiles()
    .filter((tile) => tile.classList.contains(UNIMPLEMENTED_CLASS))
    .map((tile) => tile.dataset.testid);

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

  /**
   * The dim, which is VISUAL ONLY. Every assertion below that the click still selects is the
   * load-bearing half: a `disabled` attribute would satisfy all the class assertions and take
   * away the placeholder options bar a selected placeholder tool opens, which is the roster's
   * existing documented behaviour.
   */
  describe('tools the registry registers as unimplemented', () => {
    it('dims every rail tile whose default tool is unimplemented and no other tile', () => {
      render(<SidebarLeft />);

      // The registry is the oracle for every tile in `toolbarMap`, so a tool that is
      // implemented but dimmed fails here just as loudly as one that is unimplemented and
      // dimmed correctly for the wrong reason. `wrong` collects names rather than asserting per
      // tile, so the failure says which tool disagrees with the registry instead of which index
      // of a list.
      const expected = new Map<string, boolean>(
        toolbarGroups.map((group): [string, boolean] => [group[0].name, isUnimplemented(group[0])])
      );
      const wrong: string[] = [];

      for (const tile of railTiles()) {
        const name = tile.dataset.testid?.replace('tool-button-', '') ?? '';
        const shouldBeDimmed = expected.get(name);
        if (shouldBeDimmed === undefined) {
          wrong.push(`${tile.dataset.testid} is the default tool of no group`);
        } else if (tile.classList.contains(UNIMPLEMENTED_CLASS) !== shouldBeDimmed) {
          wrong.push(name);
        }
      }

      expect(wrong).toEqual([]);
    });

    it('pins the dimmed rail tile to the Pen tile alone, and not to the Shape tile beside it', () => {
      render(<SidebarLeft />);

      // Hard-coded rather than derived, because the shape case is the one a derivation cannot
      // see: the Shape tile's group is six entries long and the sixth of them is the unimplemented
      // Custom Shape, so "does any tool in this group work" is true and "is the group's tool
      // unimplemented" has to be answered from its FIRST entry — the Rectangle, which commits
      // pixels. Nothing else in the rail would catch that error.
      expect(dimmedTileTestIds()).toEqual(['tool-button-pen']);
      expect(screen.getByTestId('tool-button-shape')).not.toHaveClass(UNIMPLEMENTED_CLASS);
    });

    it('dims every unimplemented flyout row and no implemented row beside it', () => {
      render(<SidebarLeft />);
      const wrong: string[] = [];

      // Only the groups that HOLD an unimplemented tool, which is every place a dimmed row can
      // be: a group of implemented rows has nothing to dim, and the predicate under test is
      // already exercised against every tile by the test above. The walk is not over every group
      // because this file mirrors `toolIcons` with a local list, and a group whose icon that
      // mirror does not carry fails to render a row at all — which is a fixture's problem, not
      // this suite's subject.
      const groupsWithAPlaceholder = toolbarGroups.filter((group) => group.some(isUnimplemented));

      for (const group of groupsWithAPlaceholder) {
        const menu = openFlyoutOf(screen.getByTestId(`tool-button-${group[0].name}`));
        for (const tool of group) {
          const row = within(menu).getByTestId(flyoutItemTestId(tool));
          if (row.classList.contains(UNIMPLEMENTED_CLASS) !== isUnimplemented(tool)) wrong.push(tool.label);
        }
        act(() => {
          fireEvent.click(document.body);
        });
      }

      expect(groupsWithAPlaceholder.map((group) => group[0].name)).toEqual(['pen', 'shape']);
      expect(wrong).toEqual([]);
    });

    it('dims all six Pen rows, which are the unimplemented roster in one flyout', () => {
      render(<SidebarLeft />);

      const menu = openFlyoutOf(screen.getByTestId('tool-button-pen'));
      const rows = within(menu).getAllByRole('menuitemradio');

      expect(rows.map((row) => row.dataset.testid)).toEqual([
        'tool-flyout-item-pen-pen-tool',
        'tool-flyout-item-freeform-pen-freeform-pen-tool',
        'tool-flyout-item-curvature-pen-curvature-pen-tool',
        'tool-flyout-item-add-anchor-point-add-anchor-point-tool',
        'tool-flyout-item-delete-anchor-point-delete-anchor-point-tool',
        'tool-flyout-item-convert-point-convert-point-tool',
      ]);
      expect(rows.filter((row) => !row.classList.contains(UNIMPLEMENTED_CLASS))).toEqual([]);
    });

    it('dims the Custom Shape row and none of the five figure rows above it', () => {
      render(<SidebarLeft />);

      const menu = openShapeFlyout();
      const dimmed = within(menu)
        .getAllByRole('menuitemradio')
        .filter((row) => row.classList.contains(UNIMPLEMENTED_CLASS))
        .map((row) => row.dataset.testid);

      expect(dimmed).toEqual(['tool-flyout-item-custom-shape-custom-shape-tool']);
      expect(within(menu).getByTestId('tool-flyout-item-shape-rectangle-tool')).not.toHaveClass(UNIMPLEMENTED_CLASS);
    });

    it('keeps a dimmed tile clickable and still selects its tool', () => {
      render(<SidebarLeft />);

      const penTile = screen.getByTestId('tool-button-pen');
      expect(penTile).toHaveClass(UNIMPLEMENTED_CLASS);
      expect(penTile).not.toBeDisabled();
      expect(penTile).not.toHaveAttribute('aria-disabled');

      act(() => {
        fireEvent.click(penTile);
      });

      expect(goToTool).toHaveBeenCalledWith('pen');
    });

    it('keeps a dimmed flyout row clickable and still selects its tool', () => {
      render(<SidebarLeft />);

      const menu = openShapeFlyout();
      const customShapeRow = within(menu).getByTestId('tool-flyout-item-custom-shape-custom-shape-tool');
      expect(customShapeRow).toHaveClass(UNIMPLEMENTED_CLASS);
      expect(customShapeRow).not.toBeDisabled();
      expect(customShapeRow).not.toHaveAttribute('aria-disabled');

      act(() => {
        fireEvent.click(customShapeRow);
      });

      expect(goToTool).toHaveBeenCalledWith('custom-shape');
      // Unchanged behaviour, asserted so the dim cannot be reintroduced as something that also
      // stopped the pick from closing the menu.
      expect(screen.queryByRole('menu')).toBeNull();
    });

    it('titles a dimmed row with the reason and leaves an implemented row untitled', () => {
      render(<SidebarLeft />);

      const menu = openShapeFlyout();

      expect(within(menu).getByTestId('tool-flyout-item-custom-shape-custom-shape-tool')).toHaveAttribute(
        'title',
        'Custom Shape Tool — not implemented yet'
      );
      expect(within(menu).getByTestId('tool-flyout-item-shape-rectangle-tool')).not.toHaveAttribute('title');
    });

    it('leaves the dimmed tile own tooltip at full strength and stating the reason', () => {
      vi.useFakeTimers();
      render(<SidebarLeft />);

      act(() => {
        fireEvent.mouseEnter(screen.getByTestId('tool-button-pen'));
      });
      act(() => {
        vi.advanceTimersByTime(250);
      });

      // The tooltip is portalled to `document.body`, so the filter on the tile does not reach
      // it — which is what makes it the one thing about a dimmed tile still drawn at full
      // strength. The note itself is `ToolTooltip`'s own status line, read from the description
      // record's `implementation`, so it is that component's behaviour rather than this rail's.
      expect(within(screen.getByRole('tooltip')).getByTestId('tool-tooltip-implementation-note')).toHaveTextContent(
        'Not implemented'
      );
    });
  });
});
